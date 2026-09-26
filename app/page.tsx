import Link from "next/link";

export default function Home() {
  return <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center bg-white px-6 text-gray-900">
    <h1 className="text-3xl font-extrabold">반찬량 체크</h1>
    <p className="mt-3 text-gray-600">저울로 잰 사진을 모아 YOLO를 학습하고 새 사진의 제공량을 판정합니다.</p>
    <div className="mt-8 flex flex-col gap-3">
      <Link className="rounded-full bg-green-700 px-5 py-4 text-center font-bold text-white" href="/weight-check">사진 판정하기</Link>
      <Link className="rounded-full border border-green-700 px-5 py-4 text-center font-bold text-green-700" href="/admin">사진 등록·학습하기</Link>
    </div>
  </main>;
}
