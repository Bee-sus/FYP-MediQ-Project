# Dataset-trained model protection

The active model is `models/operational_wait_f4_model.joblib`, trained offline on
the F4 worksheet of `WaitData.Published.xlsx`. Its SHA-256 is pinned in the
adjacent manifest. The API verifies it before loading and before predictions.
If verification fails, the ML endpoint returns unavailable; MediQ can use its
existing queue-duration fallback.

Queue testing supplies inference inputs only. Joining, calling, completing,
checking in, cancelling, or recalling a patient does not train the model, append
to the source workbook, or modify the original evaluation reports. Recorded
prediction-versus-actual statistics from demonstrations are separate from the
original dataset evaluation.

`/health` reports `online_training_enabled: false`, `model_integrity_ok`,
`model_sha256`, and the training source. These fields describe this service;
they do not prevent an administrator manually editing files outside it.

The training script defaults to `training-candidates/` and rejects the active
model/report destination. A future model replacement is a deliberate offline
operation: review the candidate and its evaluation, stop the service, back up
the active artifacts, replace them and their manifest together, then restart.
Normal application startup never performs training.

Live predictions and the remaining-wait calculation still change when queue
inputs change. This is expected inference behaviour, not learning from tests.
