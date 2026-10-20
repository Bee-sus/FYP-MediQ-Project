import hashlib
import json
from pathlib import Path


def verified_model_hash(model_path: Path, manifest_path: Path) -> str | None:
    """Read-only verification of the pinned dataset-trained artifact."""
    try:
        expected = json.loads(manifest_path.read_text(encoding="utf-8"))["sha256"]
        actual = hashlib.sha256(model_path.read_bytes()).hexdigest()
        return actual if actual == expected else None
    except (OSError, ValueError, KeyError, TypeError):
        return None
