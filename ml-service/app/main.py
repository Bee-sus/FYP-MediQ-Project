from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI(title="MediQ Prediction Service", version="0.1.0")


class PredictionInput(BaseModel):
    patients_ahead: int = Field(ge=0)
    average_consultation_minutes: float = Field(gt=0)


@app.get("/health")
def health_check():
    return {"service": "MediQ prediction service", "status": "running", "model": "baseline"}


@app.post("/predict")
def predict_waiting_time(data: PredictionInput):
    # Temporary baseline for integration testing. It is not the final ML model.
    estimate = data.patients_ahead * data.average_consultation_minutes
    return {"estimated_waiting_minutes": round(estimate, 2), "model": "baseline-v0.1"}
