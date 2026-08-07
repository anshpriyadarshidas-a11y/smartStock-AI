"""Train, compare, evaluate and persist the SmartStock AI demand model.

Workflow
--------
1. Load + clean + engineer the dataset
2. Chronological train/test split
3. Fit the preprocessing pipeline (encoding + scaling) on the train set only
4. Train three regressors and pick the best via 5-fold cross-validation
5. Report MAE / RMSE / R2 on the held-out test set
6. Compute feature importance and render diagnostic plots
7. Persist the best model, preprocessor, encoder, scaler and metadata

Run:
    python train.py
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Tuple

import matplotlib

matplotlib.use("Agg")  # headless backend so plots never open a window
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import cross_val_score

from preprocessing import (
    CATEGORICAL_FEATURES,
    NUMERIC_FEATURES,
    PreprocessingPipeline,
    engineer_features,
    load_and_clean_data,
    make_xy,
    split_data,
)
from utils import (
    DEFAULT_DATASET_PATH,
    ENCODER_FILE,
    LOG,
    METADATA_FILE,
    MODEL_FILE,
    MODELS_DIR,
    PLOTS_DIR,
    PREPROCESSOR_FILE,
    SCALER_FILE,
    save_object,
)

RANDOM_STATE = 42
CV_FOLDS = 5
TEST_RATIO = 0.2


# ----------------------------------------------------------------------------
# Model registry
# ----------------------------------------------------------------------------
def build_models() -> Dict[str, Any]:
    """Return the candidate regressors. XGBoost is added only if installed."""
    models: Dict[str, Any] = {
        "LinearRegression": LinearRegression(),
        "RandomForest": RandomForestRegressor(
            n_estimators=300, max_depth=12, min_samples_leaf=2,
            n_jobs=-1, random_state=RANDOM_STATE,
        ),
    }
    try:
        from xgboost import XGBRegressor  # type: ignore

        models["XGBoost"] = XGBRegressor(
            n_estimators=400, learning_rate=0.05, max_depth=7,
            subsample=0.9, colsample_bytree=0.8, random_state=RANDOM_STATE,
        )
        LOG.info("XGBoost available; added to the candidate pool.")
    except ImportError:
        LOG.warning("xgboost not installed; skipping XGBoost. (pip install xgboost)")
    return models


# ----------------------------------------------------------------------------
# Evaluation helpers
# ----------------------------------------------------------------------------
def regression_metrics(y_true: np.ndarray, y_pred: np.ndarray) -> Dict[str, float]:
    """Return MAE, RMSE and R2 for a prediction pair."""
    mae = float(mean_absolute_error(y_true, y_pred))
    rmse = float(np.sqrt(mean_squared_error(y_true, y_pred)))
    r2 = float(r2_score(y_true, y_pred))
    return {"MAE": round(mae, 3), "RMSE": round(rmse, 3), "R2": round(r2, 4)}


def cross_validate(model: Any, X: np.ndarray, y: np.ndarray) -> Dict[str, float]:
    """5-fold CV RMSE and R2 (negative MSE is converted to RMSE)."""
    cv_scores = cross_val_score(model, X, y, cv=CV_FOLDS, n_jobs=-1,
                                scoring="neg_mean_squared_error")
    rmse_scores = np.sqrt(-cv_scores)
    cv_r2 = cross_val_score(model, X, y, cv=CV_FOLDS, n_jobs=-1, scoring="r2")
    return {
        "cv_rmse_mean": round(float(rmse_scores.mean()), 3),
        "cv_rmse_std": round(float(rmse_scores.std()), 3),
        "cv_r2_mean": round(float(cv_r2.mean()), 4),
    }


def feature_importance(model: Any, feature_names: List[str]) -> Dict[str, float]:
    """Return normalized feature importance for linear or tree models."""
    importances: np.ndarray
    if isinstance(model, LinearRegression):
        importances = np.abs(np.asarray(model.coef_, dtype=float))
    else:
        importances = np.asarray(model.feature_importances_, dtype=float)

    total = importances.sum()
    if total <= 0:
        return {}
    importances = importances / total
    return dict(sorted(zip(feature_names, importances),
                       key=lambda kv: kv[1], reverse=True))


# ----------------------------------------------------------------------------
# Visualizations
# ----------------------------------------------------------------------------
def plot_actual_vs_predicted(y_test: np.ndarray, preds: np.ndarray, path: Path) -> None:
    plt.figure(figsize=(8, 8))
    max_val = max(float(y_test.max()), float(preds.max()), 1.0)
    plt.scatter(y_test, preds, alpha=0.35, s=12, label="Predictions")
    plt.plot([0, max_val], [0, max_val], "r--", lw=1.5, label="Ideal fit (y=x)")
    plt.xlabel("Actual Reorder Quantity")
    plt.ylabel("Predicted Reorder Quantity")
    plt.title("Actual vs Predicted Reorder Quantity")
    plt.legend()
    plt.tight_layout()
    plt.savefig(path, dpi=120)
    plt.close()
    LOG.info("Plot saved -> %s", path)


def plot_feature_importance(importance: Dict[str, float], path: Path, top: int = 15) -> None:
    items = list(importance.items())[:top]
    names = [k for k, _ in items][::-1]
    values = [v for _, v in items][::-1]
    plt.figure(figsize=(9, 6))
    plt.barh(names, values, color="#2a9d8f")
    plt.xlabel("Relative Importance")
    plt.title("Top Feature Importance")
    plt.tight_layout()
    plt.savefig(path, dpi=120)
    plt.close()
    LOG.info("Plot saved -> %s", path)


def plot_monthly_demand_trend(df: pd.DataFrame, path: Path) -> None:
    monthly = df.groupby(df["Date"].dt.to_period("M"))["Units_Sold"].sum()
    plt.figure(figsize=(11, 5))
    plt.plot(monthly.index.astype(str), monthly.values, marker="o", ms=3, lw=1.5)
    plt.xticks(rotation=45, ha="right")
    plt.xlabel("Month")
    plt.ylabel("Total Units Sold")
    plt.title("Monthly Demand Trend")
    plt.tight_layout()
    plt.savefig(path, dpi=120)
    plt.close()
    LOG.info("Plot saved -> %s", path)


def plot_inventory_risk_distribution(df: pd.DataFrame, path: Path) -> None:
    """Bucket products by months-of-stock coverage into risk bands."""
    cover = df["Current_Stock"] / (df["Units_Sold"] + 1e-6)
    buckets = {
        "Critical (<0.5mo)": (cover < 0.5).sum(),
        "Low (0.5-1mo)": ((cover >= 0.5) & (cover < 1.0)).sum(),
        "Healthy (1-2mo)": ((cover >= 1.0) & (cover < 2.0)).sum(),
        "Overstock (>=2mo)": (cover >= 2.0).sum(),
    }
    plt.figure(figsize=(8, 5))
    bars = plt.bar(buckets.keys(), buckets.values(), color=["#e63946", "#f4a261", "#2a9d8f", "#457b9d"])
    for bar, value in zip(bars, buckets.values()):
        plt.text(bar.get_x() + bar.get_width() / 2, bar.get_height(),
                 str(value), ha="center", va="bottom")
    plt.ylabel("Number of Records")
    plt.title("Inventory Risk Distribution (stock coverage)")
    plt.tight_layout()
    plt.savefig(path, dpi=120)
    plt.close()
    LOG.info("Plot saved -> %s", path)


# ----------------------------------------------------------------------------
# Persistence
# ----------------------------------------------------------------------------
def save_artifacts(model: Any, preprocessor: PreprocessingPipeline,
                   metadata: Dict[str, Any]) -> None:
    """Save the best model plus the encoder/scaler used at inference time."""
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    save_object(model, MODELS_DIR / MODEL_FILE)
    save_object(preprocessor, MODELS_DIR / PREPROCESSOR_FILE)
    save_object(preprocessor.encoder, MODELS_DIR / ENCODER_FILE)
    save_object(preprocessor.scaler, MODELS_DIR / SCALER_FILE)
    with open(MODELS_DIR / METADATA_FILE, "w", encoding="utf-8") as handle:
        json.dump(metadata, handle, indent=2, default=str)
    LOG.info("Metadata written -> %s", MODELS_DIR / METADATA_FILE)


def _print_results_table(results: Dict[str, Dict[str, Any]]) -> None:
    header = f"{'Model':<18}{'CV RMSE':>10}{'CV R2':>9}{'Test MAE':>10}{'Test RMSE':>10}{'Test R2':>9}"
    print("\n" + "=" * len(header))
    print("MODEL COMPARISON")
    print("=" * len(header))
    print(header)
    print("-" * len(header))
    for name, res in results.items():
        cv, test = res["cv"], res["test"]
        print(f"{name:<18}{cv['cv_rmse_mean']:>10.2f}{cv['cv_r2_mean']:>9.3f}"
              f"{test['MAE']:>10.2f}{test['RMSE']:>10.2f}{test['R2']:>9.3f}")
    print("=" * len(header) + "\n")


# ----------------------------------------------------------------------------
# Main training flow
# ----------------------------------------------------------------------------
def main(dataset_path: Path = DEFAULT_DATASET_PATH) -> None:
    LOG.info("=== SmartStock AI training run started ===")

    # 1. Load + clean + engineer ---------------------------------------------
    df = load_and_clean_data(dataset_path)
    df = engineer_features(df)

    # 2. Chronological split -------------------------------------------------
    train_df, test_df = split_data(df, test_ratio=TEST_RATIO)
    X_train, y_train = make_xy(train_df)
    X_test, y_test = make_xy(test_df)

    # 3. Preprocessing (fit on train only, to avoid leakage) -----------------
    preprocessor = PreprocessingPipeline()
    X_train_t = preprocessor.fit_transform(X_train, y_train)
    X_test_t = preprocessor.transform(X_test)
    feature_names = preprocessor.feature_names
    LOG.info("Feature matrix shape after transform: %s", X_train_t.shape)

    # 4. Train + cross-validate every candidate ------------------------------
    models = build_models()
    results: Dict[str, Dict[str, Any]] = {}

    for name, model in models.items():
        LOG.info("Training %s ...", name)
        cv = cross_validate(model, X_train_t, y_train.to_numpy())
        model.fit(X_train_t, y_train)
        preds = model.predict(X_test_t)
        test = regression_metrics(y_test.to_numpy(), preds)
        results[name] = {"model": model, "cv": cv, "test": test}

    _print_results_table(results)

    # 5. Automatic model selection (lowest CV RMSE wins) ----------------------
    best_name = min(results, key=lambda k: results[k]["cv"]["cv_rmse_mean"])
    best_model = results[best_name]["model"]
    LOG.info("Best model selected: %s (CV RMSE %.3f)",
             best_name, results[best_name]["cv"]["cv_rmse_mean"])

    # 6. Final evaluation on the held-out test set ---------------------------
    test_preds = best_model.predict(X_test_t)
    final_metrics = regression_metrics(y_test.to_numpy(), test_preds)
    print("\nBEST MODEL FINAL EVALUATION")
    print(f"  Model        : {best_name}")
    print(f"  Test MAE     : {final_metrics['MAE']}")
    print(f"  Test RMSE    : {final_metrics['RMSE']}")
    print(f"  Test R2      : {final_metrics['R2']}")
    print(f"  5-Fold CV    : RMSE {results[best_name]['cv']['cv_rmse_mean']} "
          f"+- {results[best_name]['cv']['cv_rmse_std']} | "
          f"R2 {results[best_name]['cv']['cv_r2_mean']}\n")

    # 7. Feature importance ---------------------------------------------------
    importance = feature_importance(best_model, feature_names)
    print("TOP FEATURE IMPORTANCE")
    for name, value in list(importance.items())[:10]:
        print(f"  {name:<32} {value:.3f}")
    print()

    # 8. Plots ------------------------------------------------------------------
    PLOTS_DIR.mkdir(parents=True, exist_ok=True)
    plot_actual_vs_predicted(y_test.to_numpy(), test_preds, PLOTS_DIR / "actual_vs_predicted.png")
    plot_feature_importance(importance, PLOTS_DIR / "feature_importance.png")
    plot_monthly_demand_trend(df, PLOTS_DIR / "monthly_demand_trend.png")
    plot_inventory_risk_distribution(df, PLOTS_DIR / "inventory_risk_distribution.png")

    # 9. Metadata + artifacts -----------------------------------------------------
    metadata = {
        "model": best_name,
        "model_type": type(best_model).__name__,
        "trained_at": datetime.now().isoformat(),
        "dataset": str(dataset_path),
        "rows": {"train": len(train_df), "test": len(test_df)},
        "features": feature_names,
        "final_metrics": final_metrics,
        "cross_validation": results[best_name]["cv"],
        "all_models": {
            name: {"cv": res["cv"], "test": res["test"]}
            for name, res in results.items()
        },
        "random_state": RANDOM_STATE,
    }
    save_artifacts(best_model, preprocessor, metadata)

    LOG.info("=== Training run complete. Artifacts in %s ===", MODELS_DIR)


if __name__ == "__main__":
    main()
