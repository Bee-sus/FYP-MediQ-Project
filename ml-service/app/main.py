from pathlib import Path

import joblib
import pandas as pd
from fastapi import FastAPI
from fastapi import HTTPException
from pydantic import BaseModel, Field

app = FastAPI(title="MediQ Prediction Service", version="0.1.0")
OPERATIONAL_MODEL_PATH = Path(__file__).resolve().parents[1] / "models" / "operational_wait_f4_model.joblib"
OPERATIONAL_MODEL = joblib.load(OPERATIONAL_MODEL_PATH) if OPERATIONAL_MODEL_PATH.exists() else None


class OperationalWaitInput(BaseModel):
    """MediQ queue state at patient arrival, mapped to the F4 walk-in model."""
    line_count0: int = Field(ge=0)
    ahead_count: int = Field(ge=0)
    none_in_line: bool
    none_in_progress: bool
    none_completed: bool
    arrival_hour: int = Field(ge=0, le=23)
    arrival_minute: int = Field(ge=0, le=59)
    arrival_second: int = Field(default=0, ge=0, le=59)
    in_progress_size: int = Field(ge=0)
    num_completed_today: int = Field(ge=0)
    num_completed_last_30m: int = Field(ge=0)
    customers_arrived_last_30m: int = Field(ge=0)
    avg_wait_last_30m: float | None = Field(default=None, ge=0)


@app.get("/health")
def health_check():
    return {"service": "MediQ prediction service", "status": "running",
        "model": "operational_f4" if OPERATIONAL_MODEL is not None else "unavailable",
        "operational_f4_model_available": OPERATIONAL_MODEL is not None}


@app.post("/predict-operational-wait")
def predict_operational_wait(data: OperationalWaitInput):
    """Predict total wait at queue entry using the published F4 walk-in model."""
    if OPERATIONAL_MODEL is None:
        raise HTTPException(status_code=503, detail="Operational F4 model artifact is not available")

    start_time = data.arrival_hour + data.arrival_minute / 60.0 + data.arrival_second / 3600.0
    values = {
        "LineCount0": data.line_count0,
        "AheadCount": data.ahead_count,
        "NoneInLine": int(data.none_in_line),
        "NoneInProgress": int(data.none_in_progress),
        "NoneCompleted": int(data.none_completed),
        "StartTime": start_time,
        "StartTime2": start_time ** 2,
        "StartTime3": start_time ** 3,
        "StartTime4": start_time ** 4,
        "InProgressSize": data.in_progress_size,
        "NumCompletedToday": data.num_completed_today,
        "NumCompletedInLastW1": data.num_completed_last_30m,
        "NumCustomersInLastW1": data.customers_arrived_last_30m,
        "AvgWaitLastW1": data.avg_wait_last_30m,
    }
    features = OPERATIONAL_MODEL["features"]
    prediction_frame = pd.DataFrame([{name: values[name] for name in features}], columns=features)
    estimate = max(0.0, float(OPERATIONAL_MODEL["pipeline"].predict(prediction_frame)[0]))
    return {
        "estimated_wait_minutes": round(estimate, 1),
        "model": "operational-f4-hist-gradient-boosting-v1",
        "data_notice": "Demo estimate trained on anonymized hospital imaging walk-in data; not validated for MediQ clinics.",
        "prediction_scope": "total wait estimated at queue entry",
    }
