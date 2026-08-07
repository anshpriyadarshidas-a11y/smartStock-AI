"""Data preprocessing pipeline for the SmartStock AI forecasting models.

Responsibilities
----------------
* load & clean the raw CSV (missing values, duplicates, dtype fixes)
* feature engineering (calendar, ratios, per-product lags)
* chronological train/test split (correct for time-series data)
* categorical encoding (OneHotEncoder) + numeric standardization
  (StandardScaler) through a single fitted ColumnTransformer

The fitted pipeline object is persisted and reused at prediction time so
training and inference always transform inputs identically.
"""
from __future__ import annotations

from pathlib import Path
from typing import Tuple

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from utils import DEFAULT_DATASET_PATH, LOG

# Column groups -----------------------------------------------------------------
NUMERIC_FEATURES = [
    "Current_Stock", "Minimum_Stock", "Units_Sold", "Price",
    "Supplier_Lead_Time", "Market_Trend_Score", "Weather_Score",
    "Holiday_Flag", "month", "day_of_week", "is_weekend",
    "stock_cover_ratio", "units_sold_lag_1", "sales_growth",
]
CATEGORICAL_FEATURES = ["Category", "Season"]

DROPPED_COLUMNS = ["Product_ID", "Product_Name", "Date", "Reorder_Quantity"]
TARGET_COLUMN = "Reorder_Quantity"


# ----------------------------------------------------------------------------
# Load & clean
# ----------------------------------------------------------------------------
def load_and_clean_data(path: Path = DEFAULT_DATASET_PATH) -> pd.DataFrame:
    """Load the inventory CSV and return a cleaned DataFrame."""
    if not Path(path).exists():
        raise FileNotFoundError(
            f"Dataset not found at {path}. Run `python generate_dataset.py` first."
        )
    df = pd.read_csv(path)
    LOG.info("Loaded %d rows from %s", len(df), path)

    df = df.drop_duplicates()
    df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
    df = df.dropna(subset=["Date"])

    # --- Missing values: numeric -> median, categorical -> most frequent ---
    numeric_cols = df.select_dtypes(include=[np.number]).columns
    categorical_cols = df.select_dtypes(include=["object"]).columns
    df[numeric_cols] = df[numeric_cols].fillna(df[numeric_cols].median())
    df[categorical_cols] = df[categorical_cols].fillna(df[categorical_cols].mode().iloc[0])

    # --- Types ---------------------------------------------------------------
    df["Holiday_Flag"] = df["Holiday_Flag"].astype(int)
    df["Reorder_Quantity"] = pd.to_numeric(df["Reorder_Quantity"], errors="coerce")
    df["Reorder_Quantity"] = df["Reorder_Quantity"].fillna(0).clip(lower=0)

    LOG.info("Cleaned dataset: %d rows, %d features available", len(df), len(df.columns))
    return df


# ----------------------------------------------------------------------------
# Feature engineering
# ----------------------------------------------------------------------------
def engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    """Add calendar, ratio and lag features used by the models."""
    out = df.copy()

    # --- Calendar features ----------------------------------------------------
    out["year"] = out["Date"].dt.year
    out["month"] = out["Date"].dt.month
    out["day_of_week"] = out["Date"].dt.dayofweek
    out["is_weekend"] = (out["Date"].dt.dayofweek >= 5).astype(int)
    out["quarter"] = out["Date"].dt.quarter

    # --- Ratio features -------------------------------------------------------
    out["stock_cover_ratio"] = out["Current_Stock"] / (out["Units_Sold"] + 1e-6)
    out["stock_cover_ratio"] = out["stock_cover_ratio"].replace([np.inf, -np.inf], np.nan)

    # --- Per-product lag (previous month sales) -------------------------------
    out = out.sort_values(["Product_ID", "Date"])
    out["units_sold_lag_1"] = out.groupby("Product_ID")["Units_Sold"].shift(1)
    out["sales_growth"] = (out["Units_Sold"] - out["units_sold_lag_1"]) / (
        out["units_sold_lag_1"] + 1e-6
    )
    out["sales_growth"] = out["sales_growth"].replace([np.inf, -np.inf], np.nan)

    # Fill the lag/growth NaNs produced on the first month of each product.
    out[NUMERIC_FEATURES] = out[NUMERIC_FEATURES].fillna(out[NUMERIC_FEATURES].median())
    return out


# ----------------------------------------------------------------------------
# Train / test split (chronological)
# ----------------------------------------------------------------------------
def split_data(df: pd.DataFrame, test_ratio: float = 0.2) -> Tuple[pd.DataFrame, pd.DataFrame]:
    """Split by time: the last ``test_ratio`` of the timeline is the test set.

    A random split would leak the future into training; the chronological
    split mirrors how the model is actually used in production.
    """
    df = df.sort_values("Date").reset_index(drop=True)
    split_idx = int(len(df) * (1 - test_ratio))
    train_df = df.iloc[:split_idx].copy()
    test_df = df.iloc[split_idx:].copy()
    LOG.info("Split: %d train rows, %d test rows", len(train_df), len(test_df))
    return train_df, test_df


def make_xy(df: pd.DataFrame) -> Tuple[pd.DataFrame, pd.Series]:
    """Split a cleaned/engineered DataFrame into feature matrix X and target y."""
    X = df.drop(columns=DROPPED_COLUMNS, errors="ignore")
    y = df[TARGET_COLUMN].astype(float)
    return X, y


# ----------------------------------------------------------------------------
# Encoding / scaling pipeline
# ----------------------------------------------------------------------------
class PreprocessingPipeline:
    """Fits one ColumnTransformer that encodes categoricals and scales numerics."""

    def __init__(self) -> None:
        self._transformer: ColumnTransformer | None = None

    def _build_transformer(self) -> ColumnTransformer:
        numeric_pipeline = Pipeline(steps=[
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", StandardScaler()),
        ])
        categorical_pipeline = Pipeline(steps=[
            ("imputer", SimpleImputer(strategy="most_frequent")),
            ("onehot", OneHotEncoder(handle_unknown="ignore", sparse_output=False)),
        ])
        return ColumnTransformer(transformers=[
            ("num", numeric_pipeline, NUMERIC_FEATURES),
            ("cat", categorical_pipeline, CATEGORICAL_FEATURES),
        ])

    def fit(self, X: pd.DataFrame, y: pd.Series | None = None) -> "PreprocessingPipeline":
        """Fit the transformer on training data."""
        self._transformer = self._build_transformer()
        self._transformer.fit(X)
        LOG.info("Preprocessing pipeline fitted (%d features out)", len(self.feature_names))
        return self

    def transform(self, X: pd.DataFrame) -> np.ndarray:
        """Apply the fitted transformation to new data."""
        if self._transformer is None:
            raise RuntimeError("PreprocessingPipeline.fit() must be called before transform().")
        return self._transformer.transform(X)

    def fit_transform(self, X: pd.DataFrame, y: pd.Series | None = None) -> np.ndarray:
        """Fit and transform in one call."""
        self.fit(X, y)
        return self.transform(X)

    @property
    def feature_names(self) -> list[str]:
        """Human-readable names of the transformed columns."""
        if self._transformer is None:
            return []
        return list(self._transformer.get_feature_names_out())

    @property
    def encoder(self) -> OneHotEncoder:
        """Expose the fitted OneHotEncoder (saved separately as encoder.pkl)."""
        return self._transformer.named_transformers_["cat"].named_steps["onehot"]

    @property
    def scaler(self) -> StandardScaler:
        """Expose the fitted StandardScaler (saved separately as scaler.pkl)."""
        return self._transformer.named_transformers_["num"].named_steps["scaler"]
