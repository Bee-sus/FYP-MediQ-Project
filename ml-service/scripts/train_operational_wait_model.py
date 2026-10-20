"""Train a MediQ arrival-wait demo model on the published F4 walk-in data.

The workbook's x_ArrivalDTTM is used only to order rows before a chronological
train/validation/test split. It is never used as a model input or to derive the
target. F4's supplied Wait target is the elapsed wait for walk-in patients.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import ExtraTreesRegressor, HistGradientBoostingRegressor, RandomForestRegressor
from sklearn.feature_selection import mutual_info_regression
from sklearn.impute import SimpleImputer
from sklearn.linear_model import ElasticNetCV, LinearRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

SEED = 20261013
TARGET = "Wait"
ORDER_COLUMN = "x_ArrivalDTTM"

# These are available at arrival or can be calculated from MediQ queue records.
# F1-F3 are scheduled-delay workflows, so the walk-in F4 sheet is used here.
CANDIDATE_FEATURES = [
    "LineCount0",
    "AheadCount",
    "NoneInLine",
    "NoneInProgress",
    "NoneCompleted",
    "StartTime",
    "StartTime2",
    "StartTime3",
    "StartTime4",
    "InProgressSize",
    "NumCompletedToday",
    "NumCompletedInLastW1",
    "NumCustomersInLastW1",
    "AvgWaitLastW1",
]
K_VALUES = (3, 5, 8, 10, len(CANDIDATE_FEATURES))
MAX_VALIDATION_MAE_TRADEOFF_MINUTES = 0.25


def mae(y_true: pd.Series, prediction: np.ndarray) -> float:
    return float(mean_absolute_error(y_true, np.maximum(0.0, prediction)))


def rmse(y_true: pd.Series, prediction: np.ndarray) -> float:
    return float(np.sqrt(mean_squared_error(y_true, np.maximum(0.0, prediction))))


def chronological_split(data: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    ordered = data.sort_values(ORDER_COLUMN, kind="mergesort").reset_index(drop=True)
    # Keep all events from a clinic day in a single split. Daily operational
    # features are shared between visits, so row-level cutoffs could leak a day.
    days = ordered[ORDER_COLUMN].dt.normalize()
    unique_days = days.drop_duplicates().to_numpy()
    train_day_end = int(len(unique_days) * 0.70)
    validation_day_end = int(len(unique_days) * 0.85)
    train_days = set(unique_days[:train_day_end])
    validation_days = set(unique_days[train_day_end:validation_day_end])
    test_days = set(unique_days[validation_day_end:])
    return (
        ordered.loc[days.isin(train_days)].copy(),
        ordered.loc[days.isin(validation_days)].copy(),
        ordered.loc[days.isin(test_days)].copy(),
    )


def best_top_k(ranking: list[str], train: pd.DataFrame, valid: pd.DataFrame) -> dict:
    trials = []
    for k in K_VALUES:
        features = ranking[:k]
        model = make_pipeline(
            SimpleImputer(strategy="median"),
            HistGradientBoostingRegressor(
                loss="absolute_error", max_iter=160, max_leaf_nodes=15,
                min_samples_leaf=25, l2_regularization=1.0,
                early_stopping=False, random_state=SEED,
            ),
        )
        model.fit(train[features], train[TARGET])
        prediction = model.predict(valid[features])
        trials.append({"features": features, "validation_mae": mae(valid[TARGET], prediction)})
    best_score = min(row["validation_mae"] for row in trials)
    sufficient = [row for row in trials
                  if row["validation_mae"] <= best_score + MAX_VALIDATION_MAE_TRADEOFF_MINUTES]
    return min(sufficient, key=lambda row: (len(row["features"]), row["validation_mae"]))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workbook", required=True, type=Path, help="Path to WaitData.Published.xlsx")
    parser.add_argument("--output-root", type=Path, default=Path(__file__).resolve().parents[1] / "training-candidates")
    args = parser.parse_args()

    active_root = Path(__file__).resolve().parents[1]
    candidate_model = args.output_root / "models" / "operational_wait_f4_model.joblib"
    if candidate_model.resolve() == (active_root / "models" / "operational_wait_f4_model.joblib").resolve():
        parser.error("The active dataset-trained model is protected. Use a separate --output-root for candidate training.")
    if (args.output_root / "reports" / "operational-wait-model").resolve() == (active_root / "reports" / "operational-wait-model").resolve():
        parser.error("The original evaluation reports are protected. Use a separate --output-root.")

    raw = pd.read_excel(args.workbook, sheet_name="F4", engine="openpyxl")
    missing_columns = [name for name in [TARGET, ORDER_COLUMN, *CANDIDATE_FEATURES] if name not in raw.columns]
    if missing_columns:
        raise ValueError(f"F4 is missing expected fields: {missing_columns}")
    rows_read = len(raw)
    source_missing_by_column = {name: int(count) for name, count in raw.isna().sum().items() if count}
    exact_duplicate_rows = int(raw.duplicated().sum())
    parsed_order = pd.to_datetime(raw[ORDER_COLUMN], errors="coerce")
    repeated_timestamp_mask = parsed_order.duplicated(keep=False)
    repeated_timestamp_rows = int(repeated_timestamp_mask.sum())
    repeated_timestamp_values = int(parsed_order[repeated_timestamp_mask].nunique())

    raw = raw[[TARGET, ORDER_COLUMN, *CANDIDATE_FEATURES]].copy()
    raw[ORDER_COLUMN] = pd.to_datetime(raw[ORDER_COLUMN], errors="coerce")
    raw[TARGET] = pd.to_numeric(raw[TARGET], errors="coerce")
    for name in CANDIDATE_FEATURES:
        raw[name] = pd.to_numeric(raw[name], errors="coerce")
    raw = raw.replace([np.inf, -np.inf], np.nan)
    feature_missing_values = int(raw[CANDIDATE_FEATURES].isna().sum().sum())
    none_completed_conflict = (
        raw["NoneCompleted"].notna()
        & raw["NumCompletedToday"].notna()
        & (raw["NoneCompleted"] != (raw["NumCompletedToday"] == 0).astype(int))
    )
    none_completed_flag_corrections = int(none_completed_conflict.sum())
    # The workbook defines NoneCompleted as "no exams completed that day".
    # Reconcile this derived flag to the accompanying daily completion count.
    raw.loc[none_completed_conflict, "NoneCompleted"] = (
        raw.loc[none_completed_conflict, "NumCompletedToday"] == 0
    ).astype(int)
    rows_missing_target_or_timestamp = int(raw[[TARGET, ORDER_COLUMN]].isna().any(axis=1).sum())
    raw = raw.dropna(subset=[TARGET, ORDER_COLUMN])
    rows_all_features_missing = int(raw[CANDIDATE_FEATURES].isna().all(axis=1).sum())
    raw = raw.dropna(subset=CANDIDATE_FEATURES, how="all")
    if (raw[TARGET] < 0).any():
        raise ValueError("F4 walk-in Wait contains negative values; verify target semantics before training.")

    q1, q3 = raw[TARGET].quantile([0.25, 0.75])
    upper_iqr_fence = float(q3 + 1.5 * (q3 - q1))
    over_60 = raw.loc[raw[TARGET] > 60]
    model_row_duplicates = int(raw.duplicated(subset=[TARGET, ORDER_COLUMN, *CANDIDATE_FEATURES]).sum())

    train, valid, test = chronological_split(raw)
    if min(len(train), len(valid), len(test)) < 100:
        raise ValueError("Not enough rows in the chronological splits.")

    # Filter: mutual-information ranking, with the feature count chosen on validation.
    imputer = SimpleImputer(strategy="median")
    x_train = imputer.fit_transform(train[CANDIDATE_FEATURES])
    mi_scores = mutual_info_regression(x_train, train[TARGET], random_state=SEED)
    mi_ranking = [name for _, name in sorted(zip(mi_scores, CANDIDATE_FEATURES), reverse=True)]
    mi_choice = best_top_k(mi_ranking, train, valid)

    # Embedded: Elastic Net identifies a sparse linear subset using training data only.
    elastic = make_pipeline(
        SimpleImputer(strategy="median"), StandardScaler(),
        ElasticNetCV(l1_ratio=[0.5, 0.9], alphas=np.logspace(-2, 1, 12),
                     cv=3, max_iter=8000, selection="cyclic", n_jobs=-1),
    )
    elastic.fit(train[CANDIDATE_FEATURES], train[TARGET])
    coefficients = elastic[-1].coef_
    elastic_selected = [name for name, value in zip(CANDIDATE_FEATURES, coefficients) if abs(value) > 1e-8]
    if not elastic_selected:
        elastic_selected = [CANDIDATE_FEATURES[int(np.argmax(np.abs(coefficients)))]]
    elastic_model = make_pipeline(
        SimpleImputer(strategy="median"),
        HistGradientBoostingRegressor(loss="absolute_error", max_iter=160,
            max_leaf_nodes=15, min_samples_leaf=25, l2_regularization=1.0,
            early_stopping=False, random_state=SEED),
    )
    elastic_model.fit(train[elastic_selected], train[TARGET])
    elastic_choice = {"features": elastic_selected,
                      "validation_mae": mae(valid[TARGET], elastic_model.predict(valid[elastic_selected]))}

    # Embedded tree ranking: fit only on training rows and choose k on validation.
    trees = make_pipeline(
        SimpleImputer(strategy="median"),
        ExtraTreesRegressor(n_estimators=180, min_samples_leaf=5,
                            max_features=0.85, n_jobs=-1, random_state=SEED),
    )
    trees.fit(train[CANDIDATE_FEATURES], train[TARGET])
    tree_ranking = [name for _, name in sorted(zip(trees[-1].feature_importances_, CANDIDATE_FEATURES), reverse=True)]
    tree_choice = best_top_k(tree_ranking, train, valid)

    selections = {
        "mutual_information_filter": mi_choice,
        "elastic_net_embedded": elastic_choice,
        "extra_trees_embedded": tree_choice,
    }
    selected_method = min(selections, key=lambda method: selections[method]["validation_mae"])
    selected_features = selections[selected_method]["features"]

    validation_models = {}
    candidates = {
        "linear_regression": LinearRegression(),
        "random_forest": RandomForestRegressor(
            n_estimators=220, max_depth=16, min_samples_leaf=8,
            max_features=0.9, n_jobs=-1, random_state=SEED,
        ),
        "hist_gradient_boosting": HistGradientBoostingRegressor(
            loss="absolute_error", max_iter=180, max_leaf_nodes=15,
            min_samples_leaf=25, l2_regularization=1.0,
            early_stopping=False, random_state=SEED,
        ),
    }
    trained_candidates = {}
    for name, estimator in candidates.items():
        pipeline = make_pipeline(SimpleImputer(strategy="median"), estimator)
        pipeline.fit(train[selected_features], train[TARGET])
        validation_models[name] = mae(valid[TARGET], pipeline.predict(valid[selected_features]))
        trained_candidates[name] = estimator
    selected_model_name = min(validation_models, key=validation_models.get)

    train_valid = pd.concat([train, valid], ignore_index=True)
    final_model = make_pipeline(SimpleImputer(strategy="median"), trained_candidates[selected_model_name])
    final_model.fit(train_valid[selected_features], train_valid[TARGET])
    test_prediction = np.maximum(0.0, final_model.predict(test[selected_features]))
    baseline_value = float(train_valid[TARGET].median())
    metrics = {
        "dataset": "Medical Analytics Group Operational AI Challenge, F4 walk-in facility",
        "source_file": args.workbook.name,
        "source_sheet": "F4",
        "rows_read": int(rows_read),
        "rows_used": int(len(raw)),
        "rows_excluded_missing_target_or_timestamp": rows_missing_target_or_timestamp,
        "rows_excluded_all_candidate_features_missing": rows_all_features_missing,
        "source_missing_values_by_column": source_missing_by_column,
        "candidate_feature_missing_values_before_imputation": feature_missing_values,
        "predictor_missing_values_imputed_by": "training-set median",
        "data_quality_audit": {
            "exact_duplicate_source_rows": exact_duplicate_rows,
            "duplicate_rows_on_target_timestamp_and_candidate_features": model_row_duplicates,
            "rows_with_repeated_arrival_timestamp": repeated_timestamp_rows,
            "distinct_repeated_arrival_timestamps": repeated_timestamp_values,
            "negative_wait_values": int((raw[TARGET] < 0).sum()),
            "none_completed_flag_rows_corrected_from_daily_count": none_completed_flag_corrections,
            "wait_upper_iqr_fence_minutes": upper_iqr_fence,
            "wait_values_above_iqr_fence": int((raw[TARGET] > upper_iqr_fence).sum()),
            "wait_values_over_60_minutes": int(len(over_60)),
            "minimum_line_count_among_waits_over_60": None if over_60.empty else int(over_60["LineCount0"].min()),
            "minimum_ahead_count_among_waits_over_60": None if over_60.empty else int(over_60["AheadCount"].min()),
            "outlier_policy": "Retain plausible long waits; do not remove by an IQR rule alone.",
        },
        "target": TARGET,
        "target_note": "Supplied F4 wait target; do not derive from anonymized timestamps.",
        "split_method": "chronological by whole clinic day derived from x_ArrivalDTTM, used for ordering only",
        "split_rows": {"train": len(train), "validation": len(valid), "test": len(test)},
        "target_summary_minutes": {"min": float(raw[TARGET].min()), "median": float(raw[TARGET].median()),
                                   "mean": float(raw[TARGET].mean()), "max": float(raw[TARGET].max())},
        "feature_selection_validation": {
            method: {"validation_mae_minutes": float(choice["validation_mae"]),
                     "selected_features": choice["features"]}
            for method, choice in selections.items()
        },
        "feature_count_rule": f"Choose the smallest top-k set within {MAX_VALIDATION_MAE_TRADEOFF_MINUTES:.2f} validation MAE minutes of that method's best score.",
        "selected_feature_selection_method": selected_method,
        "selected_features": selected_features,
        "validation_model_mae_minutes": {key: float(value) for key, value in validation_models.items()},
        "selected_model": selected_model_name,
        "test_results": {
            "model_mae_minutes": mae(test[TARGET], test_prediction),
            "model_rmse_minutes": rmse(test[TARGET], test_prediction),
            "median_baseline_mae_minutes": mae(test[TARGET], np.full(len(test), baseline_value)),
            "median_baseline_rmse_minutes": rmse(test[TARGET], np.full(len(test), baseline_value)),
        },
        "test_order_range": {"first_event": str(test[ORDER_COLUMN].min()), "last_event": str(test[ORDER_COLUMN].max())},
        "limitations": [
            "F4 is an imaging-facility walk-in workflow; MediQ clinic transfer is not established.",
            "F4 Wait measures physical arrival-to-exam-start time; it may not match remote queue-join-to-consultation time.",
            "Only the supplied Wait target and arrival-time features are used; dynamic remaining-wait prediction is not validated.",
            "Features were limited to operational fields that can be mapped from MediQ queue records.",
            "The challenge page offers the dataset for download but does not identify a formal reuse licence; verify terms before redistribution.",
        ],
    }

    model_dir = args.output_root / "models"
    report_dir = args.output_root / "reports" / "operational-wait-model"
    model_dir.mkdir(parents=True, exist_ok=True)
    report_dir.mkdir(parents=True, exist_ok=True)
    model_path = model_dir / "operational_wait_f4_model.joblib"
    joblib.dump({"pipeline": final_model, "features": selected_features,
                 "model": selected_model_name, "target": TARGET}, model_path)
    (report_dir / "evaluation.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")

    method_rows = []
    for method, choice in selections.items():
        method_rows.append(f"| {method} | {choice['validation_mae']:.2f} | {len(choice['features'])} | {', '.join(choice['features'])} |")
    model_rows = [f"| {name} | {score:.2f} |" for name, score in validation_models.items()]
    report = f"""# Operational wait model evaluation: F4 walk-in facility

This experiment uses the published [Medical Analytics Group Operational AI Challenge](https://medicalanalytics.group/operational-data-challenge/) workbook, F4 only. F4 represents walk-in imaging patients, which is closer to MediQ's walk-in queue than scheduled-delay targets in F1-F3. The paper defines F4 wait as physical arrival-to-exam-start time in minutes ([source paper](https://pmc.ncbi.nlm.nih.gov/articles/PMC7289434/)). That is a proxy for MediQ's remote queue-join-to-consultation interval, and the two may differ. The anonymized timestamp is used only to order whole clinic days for the chronological split; it is not a predictor and is not used to construct `Wait`.

## Data and split

- Rows read: {rows_read:,}; excluded for missing/invalid target or ordering timestamp: {rows_missing_target_or_timestamp:,}; excluded because all candidate predictors were missing: {rows_all_features_missing:,}; used: {len(raw):,}. Remaining missing predictor values are imputed with training-set medians.
- Target range: {raw[TARGET].min():.0f}–{raw[TARGET].max():.0f} minutes; median: {raw[TARGET].median():.1f} minutes.
- Chronological whole-day split: train {len(train):,}, validation {len(valid):,}, test {len(test):,}. Test events: {metrics['test_order_range']['first_event']} to {metrics['test_order_range']['last_event']}.
- Only features considered mappable to MediQ's queue database were included. Selection/model choice used training and validation rows; the final test block was held aside. For ranked filter/tree methods, the smallest feature count within {MAX_VALIDATION_MAE_TRADEOFF_MINUTES:.2f} validation MAE minutes of each method's best score is preferred.

## Data-quality audit and preprocessing decisions

- Exact duplicate source rows: {exact_duplicate_rows}; duplicate records across the target, timestamp and candidate predictors: {model_row_duplicates}. No rows were removed as duplicates.
- Repeated arrival timestamps occur on {repeated_timestamp_values:,} timestamp values ({repeated_timestamp_rows:,} visit rows). A shared timestamp alone is not a duplicate key, and the source provides no patient identifier to prove otherwise.
- The workbook's `NoneCompleted` flag disagreed with `NumCompletedToday` on {none_completed_flag_corrections} rows. Since the workbook defines the flag as “no exams completed that day,” those flags are reconciled from the daily count; the visits are retained.
- `Wait` has {metrics['data_quality_audit']['negative_wait_values']} negative values. The upper 1.5-IQR fence is {upper_iqr_fence:.1f} minutes, flagging {metrics['data_quality_audit']['wait_values_above_iqr_fence']:,} records; {len(over_60)} are over 60 minutes. Those over-60-minute records have at least {metrics['data_quality_audit']['minimum_line_count_among_waits_over_60']} patients in line and {metrics['data_quality_audit']['minimum_ahead_count_among_waits_over_60']} ahead, consistent with congestion. Long waits are retained rather than clipped or deleted solely because a statistical rule flags them.
- Missing values in the selected candidate predictors before imputation: {feature_missing_values}. Missing `DayOfWeek`, `Month` and `DayOfYear` values in the workbook are not model inputs; the anonymized timestamp is used only for sorting.
- Numeric parsing and infinity-to-missing handling are applied before fitting. Median imputation is part of the training pipeline, so its values are learned from training data; the current candidate predictors contain no missing values.

## Feature-selection comparison

| Method | Validation MAE (min) | Features | Selected features |
|---|---:|---:|---|
{chr(10).join(method_rows)}

## Model comparison using the selected feature set

| Model | Validation MAE (min) |
|---|---:|
{chr(10).join(model_rows)}

Selected: **{selected_method}** with **{selected_model_name}**.

## Held-out chronological test block

- Model MAE: **{metrics['test_results']['model_mae_minutes']:.2f} minutes**.
- Model RMSE: **{metrics['test_results']['model_rmse_minutes']:.2f} minutes**.
- Median-baseline MAE: **{metrics['test_results']['median_baseline_mae_minutes']:.2f} minutes**.
- Median-baseline RMSE: **{metrics['test_results']['median_baseline_rmse_minutes']:.2f} minutes**.

These are offline results on an anonymized radiology walk-in dataset. They are not validated accuracy results for MediQ clinics. The challenge page does not state a formal reuse licence, so verify its terms before redistributing the workbook. This model predicts wait from an arrival-time queue snapshot; it is not validated for recalculating remaining wait after the patient has already waited.
"""
    (report_dir / "evaluation_report.md").write_text(report, encoding="utf-8")
    print(json.dumps(metrics, indent=2))
    print(f"Model: {model_path}")
    print(f"Report: {report_dir / 'evaluation_report.md'}")


if __name__ == "__main__":
    main()
