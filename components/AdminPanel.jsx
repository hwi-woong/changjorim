"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

export default function AdminPanel() {
  return <DishManager />;
}

function DishManager() {
  const [dishes, setDishes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [weightGram, setWeightGram] = useState("");
  const [jobs, setJobs] = useState({});
  const [countsByDish, setCountsByDish] = useState({});

  async function refreshCounts(dishId) {
    const response = await fetch(`/api/dishes/${dishId}/samples`);
    if (!response.ok) throw new Error("사진 수를 불러오지 못했습니다.");
    const summary = await response.json();
    setCountsByDish((previous) => ({ ...previous, [dishId]: summary }));
  }

  useEffect(() => {
    let cancelled = false;

    fetch("/api/dishes")
      .then((res) => {
        if (!res.ok) throw new Error("반찬 목록을 불러오지 못했습니다.");
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setDishes(data.map((dish) => ({ ...dish, savedName: dish.name, savedWeight: dish.baseWeightGram })));
        data.forEach((dish) => refreshCounts(dish.id).catch(() => {}));
      })
      .catch((err) => !cancelled && setLoadError(err.message))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, []);

  function addBlankDish() {
    setDishes((prev) => [
      ...prev,
      {
        id: null,
        name: "",
        baseWeightGram: "",
        savedName: "",
        savedWeight: null,
        photoStatus: null,
      },
    ]);
  }

  function updateDishField(index, field, value) {
    setDishes((prev) => prev.map((dish, i) => (i === index ? { ...dish, [field]: value } : dish)));
  }

  async function saveDish(index) {
    const dish = dishes[index];
    const name = String(dish.name).trim();
    const baseWeightGram = Number(dish.baseWeightGram);

    if (!name || !Number.isFinite(baseWeightGram) || baseWeightGram <= 0) {
      updateDishField(index, "saveError", "반찬 이름과 기준 중량을 모두 입력해주세요.");
      return;
    }
    if (name === dish.savedName && baseWeightGram === dish.savedWeight) {
      return; // 변경 없음
    }

    try {
      if (dish.id) {
        const res = await fetch(`/api/dishes/${dish.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, baseWeightGram }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail || "저장에 실패했습니다.");
      } else {
        const res = await fetch("/api/dishes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, baseWeightGram }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail || "저장에 실패했습니다.");
        const created = await res.json();
        setDishes((prev) =>
          prev.map((d, i) => (i === index ? { ...d, id: created.id } : d)),
        );
        await refreshCounts(created.id);
      }
      setDishes((prev) =>
        prev.map((d, i) => (i === index ? { ...d, savedName: name, savedWeight: baseWeightGram, saveError: null } : d)),
      );
    } catch (err) {
      setDishes((prev) =>
        prev.map((d, i) =>
          i === index ? { ...d, saveError: err.message || "저장에 실패했습니다." } : d,
        ),
      );
    }
  }

  async function deleteDish(index) {
    const dish = dishes[index];
    if (dish.id) {
      try {
        const res = await fetch(`/api/dishes/${dish.id}`, { method: "DELETE" });
        if (!res.ok) throw new Error((await res.json()).detail || "삭제 실패");
      } catch (err) {
        updateDishField(index, "saveError", err.message);
        return;
      }
    }
    setDishes((prev) => prev.filter((_, i) => i !== index));
  }

  async function uploadPhotos(index, fileList) {
    const dish = dishes[index];
    if (!dish.id) {
      updateDishField(index, "photoStatus", "먼저 반찬 이름과 기준 중량을 입력해주세요.");
      return;
    }
    const files = Array.from(fileList);
    if (files.length === 0) return;
    if (!Number.isFinite(Number(weightGram)) || Number(weightGram) <= 0) {
      updateDishField(index, "photoStatus", "저울로 잰 실측 중량을 먼저 입력해주세요.");
      return;
    }

    updateDishField(index, "photoStatus", `${files.length}장 업로드 중...`);

    let uploaded = 0;
    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append("photo", file);
        formData.append("weightGram", weightGram);
        const res = await fetch(`/api/dishes/${dish.id}/reference-photos`, { method: "POST", body: formData });
        if (!res.ok) throw new Error((await res.json()).detail || "업로드 실패");
        uploaded += 1;
        updateDishField(index, "photoStatus", `${uploaded}/${files.length}장 저장됨...`);
      }
      await refreshCounts(dish.id);
      updateDishField(index, "photoStatus", `✓ ${uploaded}장 저장 완료 (${weightGram}g). 아래 최근 등록 사진을 확인하세요.`);
    } catch (err) {
      refreshCounts(dish.id).catch(() => {});
      updateDishField(index, "photoStatus", `업로드 실패 (${uploaded}/${files.length}장 저장됨): ${err.message || "오류가 발생했습니다."}`);
    }
  }

  async function trainDish(index) {
    const dish = dishes[index];
    if (!dish.id) {
      updateDishField(index, "saveError", "먼저 반찬 이름과 기준 중량을 저장해주세요.");
      return;
    }
    setJobs((prev) => ({ ...prev, [dish.id]: "학습 조건 확인 중..." }));
    try {
      const summaryResponse = await fetch(`/api/dishes/${dish.id}/samples`);
      if (!summaryResponse.ok) throw new Error("사진 수를 확인하지 못했습니다.");
      const summary = await summaryResponse.json();
      setCountsByDish((prev) => ({ ...prev, [dish.id]: summary }));
      const missing = ["under", "normal", "over"].filter((key) => summary.counts[key] < 5);
      if (missing.length) {
        const names = { under: "부족", normal: "정상", over: "초과" };
        throw new Error(`사진 부족: ${missing.map((key) => `${names[key]} ${summary.counts[key]}/5장`).join(", ")}. 정량 사진만으로는 현재 3분류 모델을 학습할 수 없습니다.`);
      }
      const res = await fetch(`/api/dishes/${dish.id}/train`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail || "학습 요청 실패");
      setJobs((prev) => ({ ...prev, [dish.id]: "학습 중..." }));
      const timer = setInterval(async () => {
        try {
          const response = await fetch(`/api/jobs/${body.jobId}`);
          const job = await response.json();
          if (!response.ok || job.status === "failed" || job.status === "completed") {
            clearInterval(timer);
            setJobs((prev) => ({ ...prev, [dish.id]: job.status === "completed" ? "학습 완료 — 판정 가능" : `학습 실패: ${job.message || job.detail}` }));
            if (job.status === "completed") refreshCounts(dish.id).catch(() => {});
          }
        } catch (err) {
          clearInterval(timer);
          setJobs((prev) => ({ ...prev, [dish.id]: `상태 조회 실패: ${err.message}` }));
        }
      }, 5000);
    } catch (err) {
      setJobs((prev) => ({ ...prev, [dish.id]: err.message }));
    }
  }

  return (
    <div className="mx-auto min-h-screen max-w-md bg-white px-5 py-8">
      <h1 className="text-2xl font-extrabold text-gray-900">관리자 화면</h1>
      <p className="mt-2 text-sm text-gray-500">
        실측 중량을 입력하고 사진을 등록하세요. 로컬 PC에만 저장됩니다.
      </p>

      {loading && <p className="mt-6 text-sm text-gray-400">불러오는 중...</p>}
      {loadError && <p className="mt-6 text-sm font-medium text-red-600">{loadError}</p>}

      <div className="mt-6 flex flex-col gap-4">
        {dishes.map((dish, index) => (
          <DishCard
            key={dish.id ?? `new-${index}`}
            dish={dish}
            onChangeName={(value) => updateDishField(index, "name", value)}
            onChangeWeight={(value) => updateDishField(index, "baseWeightGram", value)}
            onSave={() => saveDish(index)}
            onUploadPhotos={(files) => uploadPhotos(index, files)}
            weightGram={weightGram}
            onWeightGramChange={setWeightGram}
            onTrain={() => trainDish(index)}
            jobStatus={jobs[dish.id]}
            summary={countsByDish[dish.id]}
            onDelete={() => deleteDish(index)}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={addBlankDish}
        className="mt-6 w-full rounded-full bg-green-600 py-4 text-center text-base font-bold text-white transition hover:bg-green-700"
      >
        반찬 추가
      </button>

      <div className="mt-6 text-center">
        <Link
          href="/weight-check"
          className="text-sm font-semibold text-green-700 underline underline-offset-2"
        >
          사장님 화면으로
        </Link>
      </div>
    </div>
  );
}

function DishCard({ dish, onChangeName, onChangeWeight, onSave, onUploadPhotos, onDelete, weightGram, onWeightGramChange, onTrain, jobStatus, summary }) {
  const fileInputRef = useRef(null);

  return (
    <div className="rounded-2xl border border-gray-200 p-5">
      <label className="block text-sm font-bold text-gray-900">반찬 이름</label>
      <input
        type="text"
        value={dish.name}
        onChange={(e) => onChangeName(e.target.value)}
        placeholder="샘플 반찬"
        className="mt-2 w-full rounded-2xl border border-gray-200 px-4 py-3 text-base text-gray-900 focus:border-green-600 focus:outline-none"
      />

      <label className="mt-4 block text-sm font-bold text-gray-900">기준 중량 (g)</label>
      <input
        type="number"
        min="1"
        value={dish.baseWeightGram}
        onChange={(e) => onChangeWeight(e.target.value)}
        placeholder="25"
        className="mt-2 w-full rounded-2xl border border-gray-200 px-4 py-3 text-base text-gray-900 focus:border-green-600 focus:outline-none"
      />

      {dish.saveError && <p className="mt-2 text-xs font-medium text-red-600">{dish.saveError}</p>}
      <button type="button" onClick={onSave} className="mt-3 w-full rounded-full border border-gray-400 py-2 text-sm font-bold text-gray-800">반찬 정보 저장</button>
      <p className="mt-2 text-xs text-gray-500">{dish.id ? "반찬 정보 저장됨" : "저장 후 사진을 등록할 수 있습니다."}</p>

      <label className="mt-4 block text-sm font-bold text-gray-900">사진의 실측 중량 (g)</label>
      <input type="number" min="0.1" step="0.1" value={weightGram} onChange={(e) => onWeightGramChange(e.target.value)} placeholder="저울 측정값" className="mt-2 w-full rounded-2xl border border-gray-200 px-4 py-3 text-gray-900" />
      <label className="mt-4 block text-sm font-bold text-gray-900">학습 사진</label>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) onUploadPhotos(e.target.files);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="mt-2 w-full rounded-full border-2 border-green-600 py-3 text-center text-sm font-bold text-green-600 transition hover:bg-green-50"
      >
        사진 추가 (여러 장은 모두 같은 실측 중량)
      </button>
      {dish.photoStatus && <p role="status" aria-live="polite" className={`mt-2 rounded-lg p-3 text-sm font-semibold ${dish.photoStatus.includes("실패") ? "bg-red-50 text-red-700" : "bg-green-50 text-green-800"}`}>{dish.photoStatus}</p>}
      <p className="mt-1 text-xs text-gray-500">용기 무게를 제외한 반찬 중량을 입력하세요.</p>
      <div className="mt-4 rounded-xl bg-gray-50 p-3 text-sm text-gray-700" role="status">
        {summary ? `등록된 사진: 부족 ${summary.counts.under}장 · 정상 ${summary.counts.normal}장 · 초과 ${summary.counts.over}장` : "반찬 정보를 저장하면 사진 수가 표시됩니다."}
        {summary?.modelReady && <p className="mt-1 font-semibold text-green-700">학습된 모델 있음</p>}
      </div>
      {summary?.recent?.length > 0 && <section className="mt-4">
        <h3 className="text-sm font-bold text-gray-900">최근 등록 사진 ({summary.recent.length}장 표시)</h3>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {summary.recent.map((photo) => <div key={photo.id} className="overflow-hidden rounded-lg border border-gray-200">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.previewUrl} alt={`${photo.weightGram}g 반찬 사진`} className="aspect-square w-full object-cover" />
            <p className="p-1 text-center text-xs font-semibold text-gray-800">{photo.weightGram}g · {{ under: "부족", normal: "정상", over: "초과" }[photo.category]}</p>
          </div>)}
        </div>
      </section>}
      <button type="button" onClick={onTrain} className="mt-4 w-full rounded-full bg-gray-900 py-3 text-sm font-bold text-white">YOLO 모델 학습하기</button>
      <p className="mt-2 text-xs text-gray-500">현재 모델은 부족·정상·초과 사진을 각각 최소 5장 등록해야 학습할 수 있습니다.</p>
      {jobStatus && <p role="status" className="mt-2 text-sm font-semibold text-gray-800">{jobStatus}</p>}

      <div className="mt-4 text-center">
        <button
          type="button"
          onClick={onDelete}
          className="text-sm font-semibold text-red-600 underline underline-offset-2"
        >
          이 반찬 삭제
        </button>
      </div>
    </div>
  );
}
