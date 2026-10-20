import API from "Common/UI/Utils/API/API";
import {
  MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * One read of the Profiler: run when its key changes, the answer of an
 * older key thrown away when it arrives late (a person who clicks through
 * three windows sees the third, never the first), and a way to try again.
 * A null key reads nothing.
 */

export interface ProfileRequestState<T> {
  data: T | null;
  isLoading: boolean;
  error: string;
  reload: () => void;
}

const useProfileRequest: <T>(
  key: string | null,
  fetcher: () => Promise<T>,
) => ProfileRequestState<T> = <T>(
  key: string | null,
  fetcher: () => Promise<T>,
): ProfileRequestState<T> => {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(key !== null);
  const [error, setError] = useState<string>("");
  const [attempt, setAttempt] = useState<number>(0);
  const generationRef: MutableRefObject<number> = useRef<number>(0);
  const fetcherRef: MutableRefObject<() => Promise<T>> = useRef(fetcher);

  fetcherRef.current = fetcher;

  useEffect(() => {
    const generation: number = ++generationRef.current;

    if (key === null) {
      setData(null);
      setIsLoading(false);
      setError("");
      return;
    }

    setIsLoading(true);
    setError("");

    fetcherRef
      .current()
      .then((answer: T) => {
        if (generation !== generationRef.current) {
          return;
        }

        setData(answer);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (generation !== generationRef.current) {
          return;
        }

        setData(null);
        setError(API.getFriendlyMessage(err as Error));
        setIsLoading(false);
      });

    return () => {
      // A newer key, or the page leaving: an answer still on its way is old.
      generationRef.current += 1;
    };
  }, [key, attempt]);

  const reload: () => void = useCallback((): void => {
    setAttempt((value: number): number => {
      return value + 1;
    });
  }, []);

  return { data, isLoading, error, reload };
};

export default useProfileRequest;
