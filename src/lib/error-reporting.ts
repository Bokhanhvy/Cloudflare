// Client-side error reporting hook used by the root error boundary.
//
// This used to forward errors to Lovable's preview dashboard via a
// window.__lovableEvents bridge it injected automatically. Now that the app
// no longer runs inside Lovable, that bridge doesn't exist, so we just log
// to the console. If you want centralized error monitoring (e.g. Sentry,
// Cloudflare Workers Logs, or a custom endpoint), this is the single place
// to add that — everything else in the app calls reportClientError() and
// doesn't need to know where errors end up.
export function reportClientError(error: unknown, context: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  console.error("[client error]", error, {
    route: window.location.pathname,
    ...context,
  });
}
