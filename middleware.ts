import {
  convexAuthNextjsMiddleware
} from "@convex-dev/auth/nextjs/server";

// Temporary development bypass:
// keep auth endpoints/session plumbing active, but disable route guards and redirects.
export default convexAuthNextjsMiddleware(async () => {});

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"]
};
