import { NextResponse } from "next/server";
import { auth } from "@/server/auth";

/**
 * Next 16 proxy（middleware 已廢棄 → proxy，TASK-002）
 * - 未登入存取受保護頁面 → /login?callbackUrl=...
 * - 已登入存取 /login → /
 * - 僅做 redirect 防護；procedure 層仍由 protectedProcedure 把關（proxy 不能取代）
 */
export default auth((req) => {
  const { pathname, search } = req.nextUrl;
  const isLoggedIn = Boolean(req.auth?.user);

  if (!isLoggedIn && pathname !== "/login") {
    const loginUrl = new URL("/login", req.nextUrl);
    if (pathname !== "/") loginUrl.searchParams.set("callbackUrl", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }
  if (isLoggedIn && pathname === "/login") {
    return NextResponse.redirect(new URL("/", req.nextUrl));
  }
  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"],
};
