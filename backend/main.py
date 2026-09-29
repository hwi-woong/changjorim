"""Local-only image collection and YOLO classification API."""
from __future__ import annotations

import json
import random
import sqlite3
import threading
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from PIL import Image, UnidentifiedImageError

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
DATA.mkdir(exist_ok=True)
DB = DATA / "samples.sqlite3"
ALLOWED = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp"}
MAX_SIZE = 10 * 1024 * 1024
LABELS = ("under", "normal", "over")
app = FastAPI(title="반찬량 체크 로컬 API")
jobs: dict[str, dict] = {}


def db():
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    con.execute("CREATE TABLE IF NOT EXISTS dishes (id TEXT PRIMARY KEY, name TEXT NOT NULL, base_weight REAL NOT NULL, tolerance REAL NOT NULL DEFAULT 10)")
    con.execute("CREATE TABLE IF NOT EXISTS photos (id TEXT PRIMARY KEY, dish_id TEXT NOT NULL, weight REAL NOT NULL, path TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP)")
    con.commit()
    return con


def dish_or_404(con, dish_id):
    row = con.execute("SELECT * FROM dishes WHERE id=?", (dish_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "등록되지 않은 반찬입니다.")
    return row


def dish_json(row):
    return {"id": row["id"], "name": row["name"], "baseWeightGram": row["base_weight"], "tolerancePercent": row["tolerance"]}


def label(weight, dish):
    lower = dish["base_weight"] * (1 - dish["tolerance"] / 100)
    upper = dish["base_weight"] * (1 + dish["tolerance"] / 100)
    return "under" if weight < lower else "over" if weight > upper else "normal"


async def save_image(photo: UploadFile, folder: Path):
    payload = await photo.read(MAX_SIZE + 1)
    if len(payload) > MAX_SIZE:
        raise HTTPException(413, "이미지는 10MB 이하여야 합니다.")
    try:
        from io import BytesIO
        with Image.open(BytesIO(payload)) as im:
            if im.format not in ALLOWED:
                raise HTTPException(400, "JPG, PNG, WEBP 이미지만 가능합니다.")
            im.verify()
        with Image.open(BytesIO(payload)) as im:
            im = im.convert("RGB")
            folder.mkdir(parents=True, exist_ok=True)
            path = folder / f"{uuid.uuid4().hex}.jpg"
            im.save(path, "JPEG", quality=90)
            return path
    except (UnidentifiedImageError, OSError, ValueError):
        raise HTTPException(400, "이미지를 읽을 수 없습니다.")


@app.get("/api/dishes")
def list_dishes():
    with db() as con:
        return [dish_json(row) for row in con.execute("SELECT * FROM dishes ORDER BY rowid")]


@app.post("/api/dishes", status_code=201)
def create_dish(body: dict):
    name = str(body.get("name") or "").strip()
    try:
        weight = float(body.get("baseWeightGram"))
        tolerance = float(body.get("tolerancePercent", 10))
    except (TypeError, ValueError):
        raise HTTPException(400, "기준 중량과 허용 오차를 입력해주세요.")
    if not name or not 0 < weight <= 10000 or not 0 <= tolerance <= 50:
        raise HTTPException(400, "반찬명, 기준 중량(0~10000g), 허용 오차(0~50%)를 확인해주세요.")
    dish_id = uuid.uuid4().hex
    with db() as con:
        con.execute("INSERT INTO dishes VALUES (?, ?, ?, ?)", (dish_id, name, weight, tolerance))
    return {"id": dish_id, "name": name, "baseWeightGram": weight, "tolerancePercent": tolerance}


@app.patch("/api/dishes/{dish_id}")
def update_dish(dish_id: str, body: dict):
    with db() as con:
        old = dish_or_404(con, dish_id)
        if con.execute("SELECT 1 FROM photos WHERE dish_id=? LIMIT 1", (dish_id,)).fetchone():
            raise HTTPException(409, "사진이 등록된 반찬의 기준값은 변경할 수 없습니다. 새 반찬으로 등록해주세요.")
        name = str(body.get("name", old["name"])).strip()
        try:
            weight = float(body.get("baseWeightGram", old["base_weight"]))
            tolerance = float(body.get("tolerancePercent", old["tolerance"]))
        except (TypeError, ValueError):
            raise HTTPException(400, "숫자를 확인해주세요.")
        if not name or not 0 < weight <= 10000 or not 0 <= tolerance <= 50:
            raise HTTPException(400, "입력값을 확인해주세요.")
        con.execute("UPDATE dishes SET name=?, base_weight=?, tolerance=? WHERE id=?", (name, weight, tolerance, dish_id))
        return dish_json(dish_or_404(con, dish_id))


@app.delete("/api/dishes/{dish_id}")
def delete_dish(dish_id: str):
    with db() as con:
        dish_or_404(con, dish_id)
        if con.execute("SELECT 1 FROM photos WHERE dish_id=? LIMIT 1", (dish_id,)).fetchone():
            raise HTTPException(409, "사진이 등록된 반찬은 삭제할 수 없습니다. 데이터를 별도로 백업한 뒤 관리해주세요.")
        con.execute("DELETE FROM dishes WHERE id=?", (dish_id,))
    return {"ok": True}


@app.get("/api/dishes/{dish_id}/samples")
def sample_counts(dish_id: str):
    with db() as con:
        dish = dish_or_404(con, dish_id)
        counts = dict.fromkeys(LABELS, 0)
        for photo in con.execute("SELECT weight FROM photos WHERE dish_id=?", (dish_id,)):
            counts[label(photo["weight"], dish)] += 1
        recent = [
            {
                "id": row["id"],
                "weightGram": row["weight"],
                "category": label(row["weight"], dish),
                "createdAt": row["created_at"],
                "previewUrl": f"/api/photos/{row['id']}",
            }
            for row in con.execute(
                "SELECT id, weight, created_at FROM photos WHERE dish_id=? ORDER BY created_at DESC, rowid DESC LIMIT 12",
                (dish_id,),
            )
        ]
        return {"counts": counts, "recent": recent, "modelReady": (DATA / "models" / dish_id / "best.pt").exists()}


@app.get("/api/photos/{photo_id}")
def view_photo(photo_id: str):
    with db() as con:
        row = con.execute("SELECT path FROM photos WHERE id=?", (photo_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "사진을 찾을 수 없습니다.")
    path = Path(row["path"])
    if not path.is_file() or not path.resolve().is_relative_to((DATA / "photos").resolve()):
        raise HTTPException(404, "사진 파일을 찾을 수 없습니다.")
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@app.post("/api/dishes/{dish_id}/reference-photos")
async def add_reference(dish_id: str, photo: UploadFile = File(...), weightGram: float = Form(...)):
    with db() as con:
        dish_or_404(con, dish_id)
        if not 0 < weightGram <= 10000:
            raise HTTPException(400, "실측 중량은 0~10000g이어야 합니다.")
        path = await save_image(photo, DATA / "photos" / dish_id)
        con.execute("INSERT INTO photos (id, dish_id, weight, path) VALUES (?, ?, ?, ?)", (uuid.uuid4().hex, dish_id, weightGram, str(path)))
        return {"uploaded": 1, "weightGram": weightGram, "category": label(weightGram, dish_or_404(con, dish_id))}


def train_worker(dish_id, job_id):
    from ultralytics import YOLO
    import shutil

    try:
        with db() as con:
            dish = dish_or_404(con, dish_id)
            grouped = {key: [] for key in LABELS}
            for row in con.execute("SELECT path, weight FROM photos WHERE dish_id=? ORDER BY id", (dish_id,)):
                grouped[label(row["weight"], dish)].append(Path(row["path"]))
        # Each class needs independent examples in both train and validation.
        if any(len(items) < 5 for items in grouped.values()):
            raise ValueError("부족·정상·초과 사진을 각각 최소 5장씩 등록해주세요.")
        dataset = DATA / "datasets" / job_id
        rng = random.Random(42)
        for category, paths in grouped.items():
            rng.shuffle(paths)
            val_count = max(1, round(len(paths) * 0.2))
            for split, items in (("val", paths[:val_count]), ("train", paths[val_count:])):
                target = dataset / split / category
                target.mkdir(parents=True, exist_ok=True)
                for path in items:
                    shutil.copy2(path, target / path.name)
        jobs[job_id]["status"] = "training"
        model = YOLO("yolo26n-cls.pt")
        result = model.train(data=str(dataset), epochs=30, imgsz=224, project=str(DATA / "training"), name=job_id, exist_ok=True)
        out = DATA / "models" / dish_id
        out.mkdir(parents=True, exist_ok=True)
        shutil.copy2(Path(result.save_dir) / "weights" / "best.pt", out / "best.pt")
        (out / "metadata.json").write_text(json.dumps({"counts": {k: len(v) for k, v in grouped.items()}, "jobId": job_id}), encoding="utf-8")
        jobs[job_id]["status"] = "completed"
    except Exception as exc:
        jobs[job_id].update(status="failed", message=str(exc))


@app.post("/api/dishes/{dish_id}/train", status_code=202)
def train(dish_id: str):
    with db() as con:
        dish_or_404(con, dish_id)
        counts = sample_counts(dish_id)["counts"]
    if min(counts.values()) < 5:
        raise HTTPException(409, "부족·정상·초과 사진을 각각 최소 5장씩 등록해주세요.")
    if any(job["dishId"] == dish_id and job["status"] in ("queued", "training") for job in jobs.values()):
        raise HTTPException(409, "이미 학습 중입니다.")
    job_id = uuid.uuid4().hex
    jobs[job_id] = {"dishId": dish_id, "status": "queued"}
    threading.Thread(target=train_worker, args=(dish_id, job_id), daemon=True).start()
    return {"jobId": job_id}


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str):
    if job_id not in jobs:
        raise HTTPException(404, "작업을 찾을 수 없습니다. 서버를 재시작했다면 다시 학습을 실행해주세요.")
    return jobs[job_id]


@app.post("/api/judge-weight")
async def judge(dishId: str = Form(...), photo: UploadFile = File(...)):
    with db() as con:
        dish_or_404(con, dishId)
    model_path = DATA / "models" / dishId / "best.pt"
    if not model_path.exists():
        raise HTTPException(409, "이 반찬은 아직 학습된 모델이 없습니다. 관리자 화면에서 사진을 등록하고 학습해주세요.")
    path = await save_image(photo, DATA / "predictions" / dishId)
    try:
        from ultralytics import YOLO
        result = YOLO(str(model_path)).predict(source=str(path), verbose=False)[0]
        probs = result.probs
        index = int(probs.top1)
        category = result.names[index]
        confidence = float(probs.top1conf)
        verdict = {"under": "정량 미달 의심", "normal": "정상 가능성 높음", "over": "초과 의심"}.get(category, "확인 필요")
        if confidence < 0.75:
            verdict = "확인 필요"
        return {"verdict": verdict, "confidencePercent": round(confidence * 100, 1), "reasoning": "사진 분류 결과입니다. 실제 중량은 저울로 확인하세요."}
    finally:
        path.unlink(missing_ok=True)
