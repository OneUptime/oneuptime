import API from "Common/UI/Utils/API/API";
import {
  DependencyList,
  MutableRefObject,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * One read of what a page shows beside its row, kept to its own answer: the newest read
 * wins, and a failed one is the page's to say, in its own frame with a way to read again.
 */
export interface OpenStackRead<T> {
  data: T | null;
  error: string;
  isLoading: boolean;
  reload: () => void;
}

export default function useOpenStackRead<T>(
  read: () => Promise<T>,
  dependencies: DependencyList,
): OpenStackRead<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [token, setToken] = useState<number>(0);
  const sequence: MutableRefObject<number> = useRef<number>(0);

  useEffect(() => {
    const current: number = ++sequence.current;
    setIsLoading(true);
    read()
      .then((answer: T) => {
        if (current === sequence.current) {
          setData(answer);
          setError("");
          setIsLoading(false);
        }
      })
      .catch((err: Error) => {
        if (current === sequence.current) {
          setError(API.getFriendlyMessage(err));
          setIsLoading(false);
        }
      });
  }, [...dependencies, token]);

  return {
    data,
    error,
    isLoading,
    reload: (): void => {
      setToken((value: number): number => {
        return value + 1;
      });
    },
  };
}
