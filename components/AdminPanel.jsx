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
      return; // 아직 두 값이 다 채워지지 않음 - 조용히 대기
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
      }
      setDishes((prev) =>
        prev.map((d, i) => (i === index ? { ...d, savedName: name, savedWeight: baseWeightGram } : d)),
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

    updateDishField(index, "photoStatus", "업로드 중...");

    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append("photo", file);
        formData.append("weightGram", weightGram);
        const res = await fetch(`/api/dishes/${dish.id}/reference-photos`, { method: "POST", body: formData });
        if (!res.ok) throw new Error((await res.json()).detail || "업로드 실패");
      }
      updateDishField(index, "photoStatus", `${files.length}장 업로드 완료 (${weightGram}g). 다른 중량도 등록해주세요.`);
    } catch (err) {
      updateDishField(index, "photoStatus", err.message || "업로드에 실패했습니다.");
    }
  }

  async function trainDish(index) {
    const dish = dishes[index];
    try {
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
            onBlurField={() => saveDish(index)}
            onUploadPhotos={(files) => uploadPhotos(index, files)}
            weightGram={weightGram}
            onWeightGramChange={setWeightGram}
            onTrain={() => trainDish(index)}
            jobStatus={jobs[dish.id]}
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

function DishCard({ dish, onChangeName, onChangeWeight, onBlurField, onUploadPhotos, onDelete, weightGram, onWeightGramChange, onTrain, jobStatus }) {
  const fileInputRef = useRef(null);

  return (
    <div className="rounded-2xl border border-gray-200 p-5">
      <label className="block text-sm font-bold text-gray-900">반찬 이름</label>
      <input
        type="text"
        value={dish.name}
        onChange={(e) => onChangeName(e.target.value)}
        onBlur={onBlurField}
        placeholder="샘플 반찬"
        className="mt-2 w-full rounded-2xl border border-gray-200 px-4 py-3 text-base text-gray-900 focus:border-green-600 focus:outline-none"
      />

      <label className="mt-4 block text-sm font-bold text-gray-900">기준 중량 (g)</label>
      <input
        type="number"
        min="1"
        value={dish.baseWeightGram}
        onChange={(e) => onChangeWeight(e.target.value)}
        onBlur={onBlurField}
        placeholder="25"
        className="mt-2 w-full rounded-2xl border border-gray-200 px-4 py-3 text-base text-gray-900 focus:border-green-600 focus:outline-none"
      />

      {dish.saveError && <p className="mt-2 text-xs font-medium text-red-600">{dish.saveError}</p>}

      <label className="mt-4 block text-sm font-bold text-gray-900">사진의 실측 중량 (g)</label>
      <input type="number" min="0.1" step="0.1" value={weightGram} onChange={(e) => onWeightGramChange(e.target.value)} placeholder="저울 측정값" className="mt-2 w-full rounded-2xl border border-gray-200 px-4 py-3 text-gray-900" />
      <label className="mt-4 block text-sm font-bold text-gray-900">학습 사진</label>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => e.target.files && onUploadPhotos(e.target.files)}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="mt-2 w-full rounded-full border-2 border-green-600 py-3 text-center text-sm font-bold text-green-600 transition hover:bg-green-50"
      >
        사진 추가 (여러 장은 모두 같은 실측 중량)
      </button>
      {dish.photoStatus && <p className="mt-2 text-xs text-gray-500">{dish.photoStatus}</p>}
      <p className="mt-1 text-xs text-gray-400">
        용기 무게를 제외한 반찬 중량을 입력하세요. 부족·정상·초과를 각각 최소 5장 등록해야 학습할 수 있습니다.
      </p>
      {dish.id && <button type="button" onClick={onTrain} className="mt-4 w-full rounded-full bg-gray-900 py-3 text-sm font-bold text-white">YOLO 모델 학습하기</button>}
      {jobStatus && <p className="mt-2 text-xs text-gray-600">{jobStatus}</p>}

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
