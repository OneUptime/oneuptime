import { useEffect, useState } from "react";
import { useAuth } from "./useAuth";
import { loadCurrentUserId } from "../auth/currentUser";

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
  const [tokenUserId, setTokenUserId] = useState<string | null>(null);

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
