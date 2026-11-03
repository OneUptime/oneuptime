import ObjectID from "Common/Types/ObjectID";
import API from "Common/UI/Utils/API/API";
import {
  MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ContainerHostReadings,
  loadContainerHostReadings,
} from "./ContainerHostReadings";
import { ContainerHostRuntime } from "./ContainerHostRuntime";

/*
 * Every container of a Docker or Podman host with its latest readings
 * (ContainerHostReadings), for a page: read once the host's host.name is
 * known, again on each refresh token and on refresh(). Only the newest read
 * may land, so a slow one never replaces a newer one; a failed read keeps
 * the last readings it had and says why.
 */
export interface ContainerHostReadingsState {
  readings: ContainerHostReadings | null;
  isLoading: boolean;
  error: string;
  refresh: () => void;
}

export default function useContainerHostReadings(data: {
  runtime: ContainerHostRuntime;
  hostId: ObjectID;
  // Undefined until the host is read; nothing is read before.
  hostIdentifier: string | undefined;
  refreshToken?: number | undefined;
}): ContainerHostReadingsState {
  const [readings, setReadings] = useState<ContainerHostReadings | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [retryToken, setRetryToken] = useState<number>(0);
  const sequence: MutableRefObject<number> = useRef<number>(0);

  const hostId: string = data.hostId.toString();

  useEffect(() => {
    if (!data.hostIdentifier) {
      return;
    }
    const current: number = ++sequence.current;
    setIsLoading(true);
    loadContainerHostReadings({
      runtime: data.runtime,
      hostId: data.hostId,
      hostIdentifier: data.hostIdentifier,
    })
      .then((result: ContainerHostReadings): void => {
        if (current !== sequence.current) {
          return;
        }
        setReadings(result);
        setError("");
        setIsLoading(false);
      })
      .catch((err: unknown): void => {
        if (current !== sequence.current) {
          return;
        }
        setError(API.getFriendlyMessage(err));
        setIsLoading(false);
      });
  }, [
    data.runtime.runtime,
    hostId,
    data.hostIdentifier,
    data.refreshToken,
    retryToken,
  ]);

  const refresh: () => void = useCallback((): void => {
    setRetryToken((token: number): number => {
      return token + 1;
    });
  }, []);

  return { readings, isLoading, error, refresh };
}
