#!/usr/bin/env bash
# Run from the extracted potw-release folder, as the dashboard service owner.
# bash scripts/install_potw.sh /opt/koru-dashboard
set -euo pipefail
app_dir="${1:-/opt/koru-dashboard}"
release_dir="$(cd "$(dirname "$0")/.." && pwd)"
cd "$app_dir"
if [[ ! -f app/main.py || ! -f static/index.html || ! -x .venv/bin/python ]]; then
  echo "Expected an existing KORU installation with .venv in $app_dir" >&2
  exit 1
fi
if [[ ! -f "$release_dir/potw-integration.patch" ]]; then
  echo "Extract the complete potw-release.tar.gz before running the installer" >&2
  exit 1
fi
# Refuse a partial second install or unknown changed integration context.
for file in app/potw.py app/potw_scoring.py static/potw.html static/potw.css static/potw.js; do
  if [[ -e "$file" ]]; then
    echo "POTW file already exists: $file. Review the installed version before updating." >&2
    exit 1
  fi
done
git apply --check "$release_dir/potw-integration.patch"
backup="data/backups/potw-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup"
cp app/main.py "$backup/main.py"
cp static/index.html "$backup/index.html"
git diff --binary > "$backup/uncommitted.patch"
.venv/bin/python - "$backup" <<'PY'
import os, sqlite3, sys
from pathlib import Path
from contextlib import closing
db = Path(os.environ.get('KORU_DB_PATH', 'data/koru.db'))
if db.exists():
    with closing(sqlite3.connect(db)) as source, closing(sqlite3.connect(Path(sys.argv[1]) / 'koru.db')) as target:
        source.backup(target)
PY
for file in app/potw.py app/potw_scoring.py static/potw.html static/potw.css static/potw.js; do
  cp "$release_dir/$file" "$file"
done
git apply "$release_dir/potw-integration.patch"
.venv/bin/python -m compileall -q app/potw.py app/potw_scoring.py app/main.py
mkdir -p docs
cp "$release_dir/docs/player-of-the-week.md" docs/player-of-the-week.md
if [[ "$(id -u)" == 0 ]]; then
  systemctl restart koru-dashboard
else
  sudo systemctl restart koru-dashboard
fi
systemctl is-active koru-dashboard
echo "POTW installed. Backup: $app_dir/$backup"
echo "Open /potw. Obtain the private captain key using the service environment:"
echo "  cd $app_dir && .venv/bin/python -m app.potw --manager-key"
