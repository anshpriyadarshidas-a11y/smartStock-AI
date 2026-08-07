"""Shared utilities for the SmartStock AI machine learning service.

This module centralises:
  * path helpers (dataset / models / plots directories)
  * logging setup (console + rotating file handler)
  * pickling helpers with proper error handling
  * small numeric helpers reused across training and prediction
"""
from __future__ import annotations

import logging
import math
import os
import pickle
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any

# ----------------------------------------------------------------------------
# Paths
# ----------------------------------------------------------------------------
ROOT_DIR: Path = Path(__file__).resolve().parent
DATASET_DIR: Path = ROOT_DIR / "dataset"
MODELS_DIR: Path = ROOT_DIR / "models"
PLOTS_DIR: Path = ROOT_DIR / "plots"
LOGS_DIR: Path = ROOT_DIR / "logs"

DEFAULT_DATASET_PATH: Path = DATASET_DIR / "inventory_data.csv"

# Model artifact file names (used by train.py and predict.py)
MODEL_FILE = "inventory_model.pkl"
PREPROCESSOR_FILE = "preprocessor.pkl"
ENCODER_FILE = "encoder.pkl"
SCALER_FILE = "scaler.pkl"
METADATA_FILE = "model_metadata.json"


def ensure_dirs() -> None:
    """Create every directory the service needs if it does not exist yet."""
    for directory in (DATASET_DIR, MODELS_DIR, PLOTS_DIR, LOGS_DIR):
        directory.mkdir(parents=True, exist_ok=True)


# ----------------------------------------------------------------------------
# Logging
# ----------------------------------------------------------------------------
def get_logger(name: str = "smartstock") -> logging.Logger:
    """Return a configured logger with console and rotating file handlers.

    A logger is created once per name; subsequent calls reuse the same
    instance so we never stack duplicate handlers.
    """
    logger = logging.getLogger(name)
    if logger.handlers:
        return logger

    logger.setLevel(logging.DEBUG)

    fmt = logging.Formatter(
        fmt="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    console = logging.StreamHandler()
    console.setLevel(logging.INFO)
    console.setFormatter(fmt)
    logger.addHandler(console)

    try:
        ensure_dirs()
        file_handler = RotatingFileHandler(
            LOGS_DIR / "smartstock.log",
            maxBytes=2 * 1024 * 1024,
            backupCount=3,
            encoding="utf-8",
        )
        file_handler.setLevel(logging.DEBUG)
        file_handler.setFormatter(fmt)
        logger.addHandler(file_handler)
    except OSError:
        # Logging should never crash the application; fall back to console only.
        logger.warning("Could not attach file handler; console logging only.")

    return logger


LOG = get_logger("smartstock")


# ----------------------------------------------------------------------------
# Pickle helpers
# ----------------------------------------------------------------------------
def save_object(obj: Any, file_path: Path) -> Path:
    """Persist a Python object with pickle and return the target path."""
    file_path = Path(file_path)
    file_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with open(file_path, "wb") as handle:
            pickle.dump(obj, handle, protocol=pickle.HIGHEST_PROTOCOL)
        LOG.info("Saved object -> %s", file_path)
    except (pickle.PickleError, OSError) as exc:
        LOG.error("Failed to save object to %s: %s", file_path, exc)
        raise
    return file_path


def load_object(file_path: Path, default: Any = None) -> Any:
    """Load a pickled object, returning ``default`` when it is missing/corrupt.

    Loading never raises: a corrupt artifact is treated as "not trained yet"
    so the service can start and report a helpful error instead of crashing.
    """
    file_path = Path(file_path)
    if not file_path.exists():
        LOG.warning("Artifact not found: %s", file_path)
        return default
    try:
        with open(file_path, "rb") as handle:
            return pickle.load(handle)
    except (pickle.PickleError, OSError, EOFError) as exc:
        LOG.error("Failed to load artifact %s: %s", file_path, exc)
        return default


# ----------------------------------------------------------------------------
# Numeric helpers
# ----------------------------------------------------------------------------
def clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    """Constrain ``value`` to the inclusive range [low, high]."""
    return max(low, min(high, value))


def round_up(value: float) -> int:
    """Round a float up to the nearest integer (ceiling)."""
    return int(math.ceil(value))


def safe_div(numerator: float, denominator: float, fallback: float = 0.0) -> float:
    """Divide two numbers, returning ``fallback`` when the denominator is 0."""
    if denominator is None or denominator == 0:
        return fallback
    return float(numerator) / float(denominator)
