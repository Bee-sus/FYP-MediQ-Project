import hashlib
import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app import main
from app.model_integrity import verified_model_hash
import joblib
from fastapi import HTTPException


class ModelProtectionTests(unittest.TestCase):
    def test_health_exposes_fixed_model_policy(self):
        health = main.health_check()
        self.assertFalse(health["online_training_enabled"])
        self.assertTrue(health["model_integrity_ok"])
        self.assertTrue(health["operational_f4_model_available"])

    def test_different_queue_inputs_do_not_modify_model_or_evaluation(self):
        files = [main.OPERATIONAL_MODEL_PATH, main.MODEL_MANIFEST_PATH,
                 ROOT / "reports/operational-wait-model/evaluation.json"]
        before = [hashlib.sha256(path.read_bytes()).hexdigest() for path in files]
        learned_state = joblib.hash(main.OPERATIONAL_MODEL)
        for count in [0, 2, 12]:
            data = main.OperationalWaitInput(line_count0=count, ahead_count=count,
                none_in_line=count == 0, none_in_progress=True, none_completed=True,
                arrival_hour=10, arrival_minute=15, in_progress_size=0,
                num_completed_today=0, num_completed_last_30m=0,
                customers_arrived_last_30m=count, avg_wait_last_30m=None)
            self.assertGreaterEqual(main.predict_operational_wait(data)["estimated_wait_minutes"], 0)
        self.assertEqual(learned_state, joblib.hash(main.OPERATIONAL_MODEL))
        self.assertEqual(before, [hashlib.sha256(path.read_bytes()).hexdigest() for path in files])

    def test_tampered_artifact_fails_verification(self):
        artifact, manifest = Mock(spec=Path), Mock(spec=Path)
        artifact.read_bytes.return_value = b"original"
        manifest.read_text.return_value = json.dumps({"sha256": hashlib.sha256(b"original").hexdigest()})
        self.assertIsNotNone(verified_model_hash(artifact, manifest))
        artifact.read_bytes.return_value = b"changed"
        self.assertIsNone(verified_model_hash(artifact, manifest))

    def test_integrity_failure_disables_ml_predictions(self):
        data = main.OperationalWaitInput(line_count0=0, ahead_count=0,
            none_in_line=True, none_in_progress=True, none_completed=True,
            arrival_hour=10, arrival_minute=0, in_progress_size=0,
            num_completed_today=0, num_completed_last_30m=0, customers_arrived_last_30m=0)
        with patch.object(main, "verified_model_hash", return_value=None):
            self.assertFalse(main.health_check()["operational_f4_model_available"])
            with self.assertRaises(HTTPException) as error:
                main.predict_operational_wait(data)
            self.assertEqual(error.exception.status_code, 503)

    def test_training_cannot_overwrite_active_artifact(self):
        before = main.OPERATIONAL_MODEL_PATH.read_bytes()
        result = subprocess.run([sys.executable, str(ROOT / "scripts/train_operational_wait_model.py"),
            "--workbook", "nonexistent.xlsx", "--output-root", str(ROOT)], capture_output=True, text=True, timeout=60)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("active dataset-trained model is protected", result.stderr)
        self.assertEqual(before, main.OPERATIONAL_MODEL_PATH.read_bytes())


if __name__ == "__main__":
    unittest.main()
