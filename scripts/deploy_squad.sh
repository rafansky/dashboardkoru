#!/usr/bin/env bash
set -euo pipefail
cd /opt/koru-dashboard
backup="data/backups/squad-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup"
tar -czf "$backup/code.tar.gz" app static tests HANDOFF.md
git diff --binary > "$backup/uncommitted.patch"
.venv/bin/python - "$backup" <<'PY'
import sqlite3
import sys
from pathlib import Path
with sqlite3.connect('data/koru.db') as source:
    with sqlite3.connect(Path(sys.argv[1]) / 'koru.db') as target:
        source.backup(target)
PY
git pull --ff-only origin main
.venv/bin/python -m compileall -q app/squad.py app/main.py
sudo -S -p '' systemctl restart koru-dashboard
systemctl is-active koru-dashboard
printf 'Backup: %s\n' "$backup"
