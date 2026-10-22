import Clipboard from "./Clipboard";
import {
  MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * The one behaviour every copy control shares (issue #5132): copy through
 * Clipboard.copyToClipboard - the async clipboard, then the legacy command
 * a plain-http page still has - say "Copied" only when the text reached the
 * clipboard, and otherwise say it could not. Never a tick over an empty
 * clipboard, and never silence.
 *
 * `copy(text, key?)` resolves whether the text was copied and sets the
 * status the control draws: Copied for `copiedForMs`, Failed for
 * `failedForMs` (null keeps it until the next copy - for a sentence that
 * tells the reader what to do, which must not vanish while it is read).
 * `key` tells apart the buttons of a list that share one hook (a chat's
 * answers, a catalog of variables): statusOf(key) is Idle for every key but
 * the one copied last. The latest copy wins - a slower earlier one never
 * overwrites what it said - and nothing is set once the control is gone.
 */
export enum ClipboardCopyStatus {
  Idle = "idle",
  Copied = "copied",
  Failed = "failed",
}

// How long "Copied" shows before the control reads "Copy" again.
export const COPIED_FEEDBACK_MS: number = 2000;

// How long "Copy failed" shows: longer than a tick, to be read.
export const COPY_FAILED_FEEDBACK_MS: number = 4000;

export interface ClipboardCopyOptions {
  copiedForMs?: number | undefined;
  // null: the failure stays until the next copy, or reset().
  failedForMs?: number | null | undefined;
}

export interface ClipboardCopy {
  // What the latest copy did, while it is shown.
  status: ClipboardCopyStatus;
  isCopied: boolean;
  isFailed: boolean;
  // The status for one button of a list: Idle unless it was copied last.
  statusOf: (key: string) => ClipboardCopyStatus;
  copy: (text: string, key?: string) => Promise<boolean>;
  // Back to Idle at once, and a copy still running is no longer reported.
  reset: () => void;
}

interface ShownCopy {
  status: ClipboardCopyStatus;
  key: string | null;
}

const IDLE: ShownCopy = { status: ClipboardCopyStatus.Idle, key: null };

const useClipboardCopy: (options?: ClipboardCopyOptions) => ClipboardCopy = (
  options?: ClipboardCopyOptions,
): ClipboardCopy => {
  const copiedForMs: number = options?.copiedForMs ?? COPIED_FEEDBACK_MS;
  const failedForMs: number | null =
    options?.failedForMs === undefined
      ? COPY_FAILED_FEEDBACK_MS
      : options.failedForMs;

  const [shown, setShown] = useState<ShownCopy>(IDLE);

  const timerRef: MutableRefObject<ReturnType<typeof setTimeout> | null> =
    useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef: MutableRefObject<number> = useRef<number>(0);
  const isMountedRef: MutableRefObject<boolean> = useRef<boolean>(true);

  type ClearTimerFunction = () => void;

  const clearTimer: ClearTimerFunction = useCallback((): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      clearTimer();
    };
  }, [clearTimer]);

  const copy: (text: string, key?: string) => Promise<boolean> = useCallback(
    async (text: string, key?: string): Promise<boolean> => {
      attemptRef.current += 1;
      const attempt: number = attemptRef.current;

      const hasCopied: boolean = await Clipboard.copyToClipboard(text);

      // Gone, or a later copy (or a reset) has the say now.
      if (!isMountedRef.current || attempt !== attemptRef.current) {
        return hasCopied;
      }

      clearTimer();
      setShown({
        status: hasCopied
          ? ClipboardCopyStatus.Copied
          : ClipboardCopyStatus.Failed,
        key: key ?? null,
      });

      const showFor: number | null = hasCopied ? copiedForMs : failedForMs;

      if (showFor !== null) {
        timerRef.current = setTimeout(() => {
          timerRef.current = null;

          if (isMountedRef.current) {
            setShown(IDLE);
          }
        }, showFor);
      }

      return hasCopied;
    },
    [clearTimer, copiedForMs, failedForMs],
  );

  const reset: () => void = useCallback((): void => {
    attemptRef.current += 1;
    clearTimer();
    setShown(IDLE);
  }, [clearTimer]);

  const statusOf: (key: string) => ClipboardCopyStatus = useCallback(
    (key: string): ClipboardCopyStatus => {
      return shown.key === key ? shown.status : ClipboardCopyStatus.Idle;
    },
    [shown],
  );

  return {
    status: shown.status,
    isCopied: shown.status === ClipboardCopyStatus.Copied,
    isFailed: shown.status === ClipboardCopyStatus.Failed,
    statusOf,
    copy,
    reset,
  };
};

export default useClipboardCopy;
