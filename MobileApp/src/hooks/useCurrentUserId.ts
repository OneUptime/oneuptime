import { useEffect, useState } from "react";
import { useAuth } from "./useAuth";
import { getCurrentUserIdSync, loadCurrentUserId } from "../auth/currentUser";

/**
 * The signed-in user's id, available on a cold start.
 *
 * `useAuth().user` is only populated by a login that happened in this process,
 * so it is null whenever the app restored a session from storage - which is
 * most launches. It is still preferred when present (it is already in memory
 * and needs no async read); the token is the fallback that makes the value
 * survive a restart.
 */
export function useCurrentUserId(): string | null {
  const { user, isAuthenticated } = useAuth();

  /*
   * Seeded from the token already in memory so the id is there on the FIRST
   * render whenever the keychain has been read (which it has, on every launch
   * past the startup check). Callers that key a cache on this value would
   * otherwise spend one render on a null-keyed entry that nobody wants and
   * every user shares. The async read below still runs, and still wins.
   */
  const [tokenUserId, setTokenUserId] = useState<string | null>(
    (): string | null => {
      return getCurrentUserIdSync();
    },
  );

  useEffect((): (() => void) => {
    let cancelled: boolean = false;

    if (!isAuthenticated) {
      setTokenUserId(null);

      return (): void => {
        cancelled = true;
      };
    }

    loadCurrentUserId()
      .then((userId: string | null) => {
        if (!cancelled) {
          setTokenUserId(userId);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTokenUserId(null);
        }
      });

    return (): void => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  return user?._id ?? tokenUserId;
}
