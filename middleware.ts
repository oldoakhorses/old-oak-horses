import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect
} from "@convex-dev/auth/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

const isPublicRoute = createRouteMatcher(["/login"]);
const isAuthApiRoute = createRouteMatcher(["/api/auth(.*)"]);
const isAdminRoute = createRouteMatcher(["/", "/dashboard(.*)", "/upload(.*)", "/reports(.*)", "/veterinary(.*)"]);
const isInvestorRoute = createRouteMatcher(["/investor(.*)"]);

export default convexAuthNextjsMiddleware(async (request, { convexAuth }) => {
  if (isAuthApiRoute(request)) return;

  const isAuthenticated = await convexAuth.isAuthenticated();

  if (!isPublicRoute(request) && !isAuthenticated) {
    return nextjsMiddlewareRedirect(request, "/login");
  }

  if (!isAuthenticated) return;

  const token = await convexAuth.getToken();
  const viewer = await fetchQuery(api.users.currentUser, {}, token ? { token } : undefined).catch(() => null);
  const role = viewer?.role === "admin" ? "admin" : "investor";

  if (isPublicRoute(request)) {
    return nextjsMiddlewareRedirect(request, role === "admin" ? "/dashboard" : "/investor");
  }

  if (role === "investor" && isAdminRoute(request)) {
    return nextjsMiddlewareRedirect(request, "/investor");
  }

  if (role === "admin" && isInvestorRoute(request)) {
    return nextjsMiddlewareRedirect(request, "/dashboard");
  }
});

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"]
};
