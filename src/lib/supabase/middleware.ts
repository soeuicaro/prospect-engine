import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/signup", "/auth", "/privacy", "/terms"];

function isPublicPath(pathname: string) {
  return (
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  );
}

// Of the public paths, only /login and /signup ever need to know who the
// user is (to bounce an already-authenticated visitor to /dashboard instead
// of showing them the login form again).
function isAuthRedirectPath(pathname: string) {
  return pathname === "/login" || pathname === "/signup";
}

// TEMPORARY DEV BYPASS — mirrors src/lib/workspace.ts. Set
// NEXT_PUBLIC_REQUIRE_AUTH=true in .env.local once real Supabase auth is
// connected; re-enable before any real deployment (see SECURITY.md).
const REQUIRE_AUTH = process.env.NEXT_PUBLIC_REQUIRE_AUTH === "true";

/**
 * Refreshes the Supabase auth session on every request and redirects
 * unauthenticated users away from protected routes. Called from proxy.ts.
 */
export async function updateSession(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // /privacy, /terms, and /auth/* (the e-mail confirmation callback, which
  // establishes its own session) never need to know who's asking and never
  // redirect an already-logged-in visitor away — skip the Supabase Auth
  // round trip entirely instead of paying its latency on every request to
  // these routes. Only /login and /signup need that check (see
  // isAuthRedirectPath), and every non-public route still goes through the
  // full check below.
  if (isPublicPath(pathname) && !isAuthRedirectPath(pathname)) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Fail soft here specifically: this runs on every request, including
  // static pages. A hard throw would take down the entire site instead of
  // just the pages that actually need Supabase — see lib/supabase/env.ts
  // for the strict version used by Server Components/Actions.
  if (!url || !anonKey) {
    return response;
  }

  const supabase = createServerClient(
    url,
    anonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (REQUIRE_AUTH && !user && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && (pathname === "/login" || pathname === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return response;
}
