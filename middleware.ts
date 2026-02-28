import {
  convexAuthNextjsMiddleware,
  nextjsMiddlewareRedirect
} from "@convex-dev/auth/nextjs/server";

const PUBLIC_PATH_PREFIXES = ["/api/auth", "/sign-in", "/sign-up"];
const PUBLIC_PATHS = new Set(["/", "/login", "/investor"]);

export default convexAuthNextjsMiddleware(async (request, { convexAuth }) => {
  const { pathname } = request.nextUrl;
  const isPublic =
    PUBLIC_PATHS.has(pathname) || PUBLIC_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  const isAuthed = await convexAuth.isAuthenticated();

  if (!isAuthed && !isPublic) {
    return nextjsMiddlewareRedirect(request, "/login");
  }

  return undefined;
});

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"]
};
