import { QueryClient } from "@tanstack/react-query";

/*
 * The app's one query cache.
 *
 * It lives in a module rather than inside `App.tsx` for one reason: SIGNING
 * OUT has to be able to empty it, and the sign-out path (`useAuth`) is the
 * provider itself - it cannot call `useQueryClient()` on a client it renders.
 * A module-level client is also what the app already had; this only moves it
 * somewhere both sides can reach.
 *
 * The 24 hour `gcTime` is what makes the emptying matter. Entries survive a
 * screen unmount by a day, so without a clear on sign-out the next person to
 * sign in on the same handset reads the previous one's data - their shifts,
 * their pages, and (since calendar feeds) the secret URL of their personal
 * feed - out of the cache while their own request is still in flight.
 */
export const queryClient: QueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 1000 * 60 * 60 * 24, // 24 hours
    },
  },
});

/**
 * Drop everything the previous session cached.
 *
 * Called when a session ends in either of the two ways it can end: the user
 * signs out, or the server stops accepting the tokens. Never allowed to throw
 * - a failure to tidy the cache must not be what stops a sign-out.
 */
export function clearQueryCache(): void {
  try {
    queryClient.clear();
  } catch {
    /* Cache housekeeping is never the reason a sign-out fails. */
  }
}
