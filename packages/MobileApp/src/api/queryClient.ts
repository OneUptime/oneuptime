import { QueryClient } from "@tanstack/react-query";

/**
 * The one react-query cache the whole app shares.
 *
 * It lives in its own module rather than being constructed inside App.tsx
 * because signing out has to be able to EMPTY it, and AuthProvider - which is
 * rendered by App - has no way to reach a client that only exists as a local
 * inside its parent. Everything that reads data goes through the provider in
 * App.tsx, so this module is the single instance; importing it from anywhere
 * else must never mean constructing a second one.
 *
 * The 24 hour gcTime is what makes the sharing dangerous as well as useful. A
 * responder's alerts, incidents and internal notes stay resident for a day
 * after the last screen that wanted them unmounted, under keys that carry no
 * account identity at all - ["alerts", "all-projects"], ["incidents",
 * projectId, ...]. That is deliberate: an on-call phone that comes out of a
 * pocket on a dead cell connection should still show the page that woke its
 * owner. It also means the cache MUST be cleared when a session ends, which
 * AuthProvider does on both the sign-out and the auth-failure path.
 */
export const queryClient: QueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 1000 * 60 * 60 * 24, // 24 hours
    },
  },
});
