"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

/**
 * 사장님용 반찬 정량 판정 업로드 플로우
 * 반찬 선택 -> 기준 정보 확인 -> 사진 촬영/업로드 -> AI 판정 결과를 한 화면에서 처리
 *
 * 반찬 목록은 /api/dishes(DB)에서 불러온다 - 관리자 화면에서 추가/수정한 내용이 바로 반영됨
 */

const VERDICT_STYLE = {
  "정상 가능성 높음": { bg: "bg-[#EAF3DE]", text: "text-[#173404]" },
  "확인 필요": { bg: "bg-[#FAEEDA]", text: "text-[#412402]" },
  "정량 미달 의심": { bg: "bg-[#FCEBEB]", text: "text-[#501313]" },
  "초과 의심": { bg: "bg-[#FAEEDA]", text: "text-[#412402]" },
};

export default function UploadFlow() {
  const [dishes, setDishes] = useState([]);
  const [dishesLoading, setDishesLoading] = useState(true);
  const [dishesError, setDishesError] = useState(null);
  const [dishId, setDishId] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [measuredWeight, setMeasuredWeight] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [savingFeedback, setSavingFeedback] = useState(false);
  const cameraInputRef = useRef(null);
  const galleryInputRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/dishes")
      .then((res) => {
        if (!res.ok) throw new Error("반찬 목록을 불러오지 못했습니다.");
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setDishes(data);
        if (data.length > 0) setDishId(data[0].id);
      })
      .catch((err) => !cancelled && setDishesError(err.message))
      .finally(() => !cancelled && setDishesLoading(false));

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedDish = useMemo(
    () => dishes.find((dish) => dish.id === dishId) ?? null,
    [dishes, dishId],
  );

  function handleDishChange(e) {
    setDishId(e.target.value);
    setResult(null);
    setError(null);
    setFeedback(null);
  }

  function handleFileChange(e) {
    const selected = e.target.files?.[0];
    setError(null);
    setResult(null);
    setFeedback(null);

    if (!selected) return;

    if (!selected.type.startsWith("image/")) {
      setError("이미지 파일만 업로드할 수 있습니다.");
      return;
    }
    if (selected.size > 10 * 1024 * 1024) {
      setError("파일 용량은 10MB 이하로 업로드해주세요.");
      return;
    }

    setFile(selected);
    setPreviewUrl(URL.createObjectURL(selected));
  }

  async function handleSubmit() {
    if (!file) {
      setError("사진을 먼저 촬영하거나 업로드해주세요.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("dishId", selectedDish.id);
      formData.append("photo", file);

      const res = await fetch("/api/judge-weight", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail || body?.message || "판정 요청이 실패했습니다.");
      }

      setResult(await res.json());
    } catch (err) {
      setError(err.message || "알 수 없는 오류가 발생했습니다.");
    } finally {
      setIsLoading(false);
    }
  }

  function handleReset() {
    setFile(null);
    setPreviewUrl(null);
    setResult(null);
    setFeedback(null);
    setMeasuredWeight("");
    setError(null);
    if (cameraInputRef.current) cameraInputRef.current.value = "";
    if (galleryInputRef.current) galleryInputRef.current.value = "";
  }

  async function saveMeasuredResult() {
    const weight = Number(measuredWeight);
    if (!file || !selectedDish || !Number.isFinite(weight) || weight <= 0) {
      setFeedback("저울로 잰 실제 중량을 입력해주세요.");
      return;
    }
    setSavingFeedback(true);
    setFeedback(null);
    try {
      const formData = new FormData();
      formData.append("photo", file);
      formData.append("weightGram", String(weight));
      const response = await fetch(`/api/dishes/${selectedDish.id}/reference-photos`, { method: "POST", body: formData });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.detail || "실측 결과를 저장하지 못했습니다.");
      }
      setFeedback(`실측 ${weight}g과 사진을 학습 데이터로 저장했습니다. 이후 관리자 화면에서 다시 학습하면 반영됩니다.`);
    } catch (err) {
      setFeedback(err.message || "저장에 실패했습니다.");
    } finally {
      setSavingFeedback(false);
    }
  }

  return (
    <div className="mx-auto min-h-screen max-w-md bg-white px-5 py-8">
      <h1 className="text-2xl font-extrabold text-gray-900">반찬량 체크</h1>
      <p className="mt-1 text-sm text-gray-500">실측 사진으로 학습한 모델의 제공량 판정</p>
      <span className="mt-3 inline-block rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-700">
        AI 자동 판정
      </span>

      {dishesLoading && <p className="mt-8 text-sm text-gray-400">반찬 목록을 불러오는 중...</p>}
      {dishesError && <p className="mt-8 text-sm font-medium text-red-600">{dishesError}</p>}
      {!dishesLoading && !dishesError && dishes.length === 0 && (
        <p className="mt-8 text-sm text-gray-500">
          등록된 반찬이 없습니다. 관리자 화면에서 추가해주세요.
        </p>
      )}

      {selectedDish && (
        <>
          {/* 1. 반찬 선택 */}
          <section className="mt-8">
            <h2 className="text-base font-bold text-gray-900">1. 반찬 선택</h2>
            <div className="relative mt-3">
              <select
                value={dishId}
                onChange={handleDishChange}
                className="w-full appearance-none rounded-2xl border border-gray-200 bg-white px-4 py-4 text-base font-medium text-gray-900 focus:border-green-600 focus:outline-none"
              >
                {dishes.map((dish) => (
                  <option key={dish.id} value={dish.id}>
                    {dish.name}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-gray-400">
                ▾
              </span>
            </div>
          </section>

          {/* 2. 기준 정보 */}
          <section className="mt-6 rounded-2xl border border-gray-200 p-5">
            <h2 className="text-base font-bold text-gray-900">2. 기준 정보</h2>
            <p className="mt-3 text-sm text-gray-600">
              기준 중량 <span className="font-bold text-gray-900">{selectedDish.baseWeightGram}g</span>
            </p>
            <p className="mt-2 text-xs text-gray-400">
              사진의 부족·정상·초과 상태를 분류합니다. 실제 중량은 저울로 확인해주세요.
            </p>
          </section>

          {/* 3. 사진 촬영 또는 업로드 */}
          <section className="mt-6">
            <h2 className="text-base font-bold text-gray-900">3. 사진 촬영 또는 업로드</h2>

            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileChange}
              className="hidden"
            />
            <input
              ref={galleryInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
            />

            <div className="mt-3 flex flex-col gap-3">
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                disabled={isLoading}
                className="rounded-full bg-green-600 py-4 text-center text-base font-bold text-white transition hover:bg-green-700 disabled:opacity-50"
              >
                사진 촬영하기
              </button>
              <button
                type="button"
                onClick={() => galleryInputRef.current?.click()}
                disabled={isLoading}
                className="rounded-full border-2 border-green-600 py-4 text-center text-base font-bold text-green-600 transition hover:bg-green-50 disabled:opacity-50"
              >
                사진 업로드하기
              </button>

              {previewUrl && (
                <img
                  src={previewUrl}
                  alt="업로드 미리보기"
                  className="w-full rounded-2xl border border-gray-200 object-cover"
                />
              )}

              {error && <p className="text-sm font-medium text-red-600">{error}</p>}

              <button
                type="button"
                onClick={handleSubmit}
                disabled={!file || isLoading}
                className="rounded-full bg-green-700 py-4 text-center text-base font-bold text-white transition hover:bg-green-800 disabled:bg-green-200 disabled:text-white"
              >
                {isLoading ? "판정 중..." : "제공량 확인하기"}
              </button>
            </div>
          </section>

          {/* 판정 결과 */}
          {result && (
            <section
              className={`mt-6 rounded-2xl p-5 ${VERDICT_STYLE[result.verdict]?.bg || "bg-gray-50"} ${
                VERDICT_STYLE[result.verdict]?.text || "text-gray-900"
              }`}
            >
              <h2 className="text-base font-bold">판정 결과</h2>
              <p className="mt-3 text-lg font-bold">{result.verdict}</p>
              <p className="mt-1 text-sm">기준 중량: {selectedDish.baseWeightGram}g</p>
              <p className="mt-1 text-sm">모델 출력 점수: {result.confidencePercent}%</p>
              <p className="mt-2 text-xs">이 점수는 실제 정확도나 중량 측정값이 아닙니다.</p>
              <div className="mt-5 border-t border-current/20 pt-4">
                <label htmlFor="measured-weight" className="block text-sm font-bold">저울로 확인한 실제 중량 (g)</label>
                <input id="measured-weight" type="number" min="0.1" step="0.1" value={measuredWeight} onChange={(e) => setMeasuredWeight(e.target.value)} placeholder="예: 25" className="mt-2 w-full rounded-xl border border-gray-300 bg-white p-3 text-gray-900" />
                <button type="button" onClick={saveMeasuredResult} disabled={savingFeedback || feedback?.includes("학습 데이터로 저장했습니다")} className="mt-3 w-full rounded-full bg-gray-900 p-3 font-bold text-white disabled:opacity-50">{savingFeedback ? "저장 중..." : "실측 사진을 학습 데이터에 추가"}</button>
                {feedback && <p role="status" className="mt-2 text-sm">{feedback}</p>}
              </div>
            </section>
          )}
        </>
      )}

      <div className="mt-8 flex items-center justify-center gap-4 text-center">
        <button
          type="button"
          onClick={handleReset}
          className="text-sm font-semibold text-green-700 underline underline-offset-2"
        >
          다시 하기
        </button>
        <Link
          href="/admin"
          className="text-sm font-semibold text-gray-400 underline underline-offset-2"
        >
          관리자 화면
        </Link>
      </div>
    </div>
  );
}
