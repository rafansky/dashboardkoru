"""Run only against a throwaway DB: KORU_DB_PATH=... python tests/seed_potw_e2e.py."""
import json
import os
import sys
from contextlib import closing
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_potw import sample
from app import potw, storage

if not os.getenv("KORU_DB_PATH") or storage.DB_PATH.resolve() == (Path(__file__).resolve().parents[1] / "data/koru.db").resolve():
    raise SystemExit("Use an explicit throwaway KORU_DB_PATH, never the club DB")
potw.init_potw()
fixtures, reports = sample()
with closing(potw.connection()) as conn, conn:
    for f in fixtures:
        conn.execute("INSERT OR REPLACE INTO potw_fixtures VALUES (?,?,?)", (f["id"], "2026-10-19", json.dumps(f)))
        conn.execute("INSERT OR REPLACE INTO potw_reports VALUES (?,?,?)", (f["id"], json.dumps(reports[f["id"]]), potw.now().isoformat()))
potw.open_week("2026-10-19", potw.rank_week(fixtures, reports, potw.TEAM), potw.now())
older_fixtures, older_reports = sample()
for fixture in older_fixtures:
    old_id=fixture["id"]
    report=older_reports.pop(old_id)
    fixture["id"]+=100
    fixture["date"]=(datetime.fromisoformat(fixture["date"].replace("Z","+00:00"))-timedelta(days=7)).isoformat()
    report["match"].update(fixture)
    older_reports[fixture["id"]]=report
with closing(potw.connection()) as conn, conn:
    for f in older_fixtures:
        conn.execute("INSERT OR REPLACE INTO potw_fixtures VALUES (?,?,?)", (f["id"], "2026-10-12", json.dumps(f)))
        conn.execute("INSERT OR REPLACE INTO potw_reports VALUES (?,?,?)", (f["id"], json.dumps(older_reports[f["id"]]), potw.now().isoformat()))
potw.open_week("2026-10-12", potw.rank_week(older_fixtures, older_reports, potw.TEAM), potw.now())
print("POTW disposable fixtures seeded")
