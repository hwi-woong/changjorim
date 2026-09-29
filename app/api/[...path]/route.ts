import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

async function forward(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const backend = process.env.API_BASE_URL || "http://127.0.0.1:8000";
  const secret = process.env.API_SHARED_SECRET;
  if (process.env.VERCEL && (!process.env.APP_USER || !process.env.APP_PASSWORD || !secret || !process.env.API_BASE_URL)) {
    return NextResponse.json({ detail: "배포 환경 변수가 설정되지 않았습니다." }, { status: 503 });
  }
  const { path } = await context.params;
  const url = new URL(`/api/${path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`, backend);
  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  if (secret) headers.set("x-api-secret", secret);
  try {
    const response = await fetch(url, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer(),
      cache: "no-store",
    });
    const resultHeaders = new Headers();
    resultHeaders.set("content-type", response.headers.get("content-type") || "application/octet-stream");
    resultHeaders.set("cache-control", "no-store");
    return new NextResponse(response.body, { status: response.status, headers: resultHeaders });
  } catch {
    return NextResponse.json({ detail: "모델 서버에 연결할 수 없습니다." }, { status: 502 });
  }
}

export { forward as GET, forward as POST, forward as PATCH, forward as DELETE };
