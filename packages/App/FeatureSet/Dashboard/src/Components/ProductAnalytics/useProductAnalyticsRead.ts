import API from "Common/UI/Utils/API/API";
import {
  MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * One read of a product analytics page (issue #6444): its answer, whether
 * it is on its way, and the server's words when it failed - a role without
 * session replay access, a plan without it, a range too long. A slow answer
 * to an older question never replaces a newer one.
 *
 * `key` names the question: the read runs again whenever it changes, or on
 * `reload`. The previous answer stays on screen while the next one loads,
 * so a new range dims the page rather than emptying it.
 */

export interface ProductAnalyticsRead<T> {
  data: T | null;
  isLoading: boolean;
  error: string;
  reload: () => void;
}

export default function useProductAnalyticsRead<T>(
  key: string,
  read: () => Promise<T>,
): ProductAnalyticsRead<T> {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [reloadToken, setReloadToken] = useState<number>(0);
  const generation: MutableRefObject<number> = useRef<number>(0);
  const readRef: MutableRefObject<() => Promise<T>> = useRef(read);

  readRef.current = read;

  useEffect((): (() => void) => {
    generation.current += 1;
    const current: number = generation.current;

    setIsLoading(true);
    setError("");

    readRef
      .current()
      .then((answer: T): void => {
        if (current === generation.current) {
          setData(answer);
        }
      })
      .catch((err: unknown): void => {
        if (current === generation.current) {
          setError(API.getFriendlyMessage(err));
        }
      })
      .finally((): void => {
        if (current === generation.current) {
          setIsLoading(false);
        }
      });

    return (): void => {
      generation.current += 1;
    };
  }, [key, reloadToken]);

  const reload: () => void = useCallback((): void => {
    setReloadToken((token: number): number => {
      return token + 1;
    });
  }, []);

  return { data: data, isLoading: isLoading, error: error, reload: reload };
}
