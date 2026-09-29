import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const publicApi = (pathname === "/api/dishes" && request.method === "GET") ||
    (pathname === "/api/judge-weight" && request.method === "POST");
  const adminOnly = pathname === "/admin" || pathname.startsWith("/admin/") ||
    (pathname.startsWith("/api/") && !publicApi);
  const username = process.env.APP_USER;
  const password = process.env.APP_PASSWORD;
  if (process.env.VERCEL && (!username || !password)) {
    return new NextResponse("서버 인증 설정이 필요합니다.", { status: 503 });
  }
  if (!adminOnly || !username || !password) return NextResponse.next();
  const header = request.headers.get("authorization") || "";
  let supplied = "";
  if (header.startsWith("Basic ")) {
    try { supplied = atob(header.slice(6)); } catch { /* malformed header */ }
  }
  if (supplied !== `${username}:${password}`) {
    return new NextResponse("로그인이 필요합니다.", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="반찬량 체크", charset="UTF-8"', "Cache-Control": "no-store" },
    });
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
