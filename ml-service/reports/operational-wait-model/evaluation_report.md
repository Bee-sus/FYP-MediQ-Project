# Operational wait model evaluation: F4 walk-in facility

This experiment uses the published [Medical Analytics Group Operational AI Challenge](https://medicalanalytics.group/operational-data-challenge/) workbook, F4 only. F4 represents walk-in imaging patients, which is closer to MediQ's walk-in queue than scheduled-delay targets in F1-F3. The paper defines F4 wait as physical arrival-to-exam-start time in minutes ([source paper](https://pmc.ncbi.nlm.nih.gov/articles/PMC7289434/)). That is a proxy for MediQ's remote queue-join-to-consultation interval, and the two may differ. The anonymized timestamp is used only to order whole clinic days for the chronological split; it is not a predictor and is not used to construct `Wait`.

## Data and split

- Rows read: 48,430; excluded for missing/invalid target or ordering timestamp: 0; excluded because all candidate predictors were missing: 0; used: 48,430. Remaining missing predictor values are imputed with training-set medians.
- Target range: 0–89 minutes; median: 6.0 minutes.
- Chronological whole-day split: train 33,218, validation 7,409, test 7,803. Test events: 2025-04-24 08:37:05 to 2025-07-20 18:32:03.
- Only features considered mappable to MediQ's queue database were included. Selection/model choice used training and validation rows; the final test block was held aside. For ranked filter/tree methods, the smallest feature count within 0.25 validation MAE minutes of each method's best score is preferred.

## Data-quality audit and preprocessing decisions

- Exact duplicate source rows: 0; duplicate records across the target, timestamp and candidate predictors: 6. No rows were removed as duplicates.
- Repeated arrival timestamps occur on 183 timestamp values (366 visit rows). A shared timestamp alone is not a duplicate key, and the source provides no patient identifier to prove otherwise.
- The workbook's `NoneCompleted` flag disagreed with `NumCompletedToday` on 16 rows. Since the workbook defines the flag as “no exams completed that day,” those flags are reconciled from the daily count; the visits are retained.
- `Wait` has 0 negative values. The upper 1.5-IQR fence is 20.5 minutes, flagging 2,614 records; 9 are over 60 minutes. Those over-60-minute records have at least 4 patients in line and 60 ahead, consistent with congestion. Long waits are retained rather than clipped or deleted solely because a statistical rule flags them.
- Missing values in the selected candidate predictors before imputation: 0. Missing `DayOfWeek`, `Month` and `DayOfYear` values in the workbook are not model inputs; the anonymized timestamp is used only for sorting.
- Numeric parsing and infinity-to-missing handling are applied before fitting. Median imputation is part of the training pipeline, so its values are learned from training data; the current candidate predictors contain no missing values.

## Feature-selection comparison

| Method | Validation MAE (min) | Features | Selected features |
|---|---:|---:|---|
| mutual_information_filter | 3.71 | 3 | LineCount0, NumCustomersInLastW1, AvgWaitLastW1 |
| elastic_net_embedded | 3.64 | 12 | LineCount0, AheadCount, NoneInLine, NoneInProgress, NoneCompleted, StartTime, StartTime4, InProgressSize, NumCompletedToday, NumCompletedInLastW1, NumCustomersInLastW1, AvgWaitLastW1 |
| extra_trees_embedded | 3.71 | 3 | LineCount0, NumCustomersInLastW1, AvgWaitLastW1 |

## Model comparison using the selected feature set

| Model | Validation MAE (min) |
|---|---:|
| linear_regression | 3.73 |
| random_forest | 3.74 |
| hist_gradient_boosting | 3.64 |

Selected: **elastic_net_embedded** with **hist_gradient_boosting**.

## Held-out chronological test block

- Model MAE: **4.16 minutes**.
- Model RMSE: **6.20 minutes**.
- Median-baseline MAE: **5.21 minutes**.
- Median-baseline RMSE: **8.17 minutes**.

These are offline results on an anonymized radiology walk-in dataset. They are not validated accuracy results for MediQ clinics. The challenge page does not state a formal reuse licence, so verify its terms before redistributing the workbook. This model predicts wait from an arrival-time queue snapshot; it is not validated for recalculating remaining wait after the patient has already waited.
