import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, AppStateStatus } from "react-native";
import {
  type TestPageResult,
  type TestPageSeverity,
  fetchTestPageResult,
  fetchTestPageSeverity,
  isTestPageResultFinal,
  sendTestPageToMyself,
} from "../api/onCallTestPageSend";
import {
  hasAcknowledgedTestPageFromApp,
  rememberTestPageAcknowledged,
} from "../storage/getReady";
import { GET_READY_TEXT } from "../onboarding/getReady";
import { getFriendlyErrorMessage } from "../utils/error";

/*
 * THE FIRST STEPS' TEST PAGE (#7041): send one to yourself from the app,
 * and follow it until somebody acknowledges it, it ends, or it fails - in
 * the server's own words (api/onCallTestPageSend.ts).
 *
 * While it pages, its result is read every few seconds, and at once when
 * the app comes back to the front: the person acknowledges it from its
 * notification, which takes them out of the app or over it. Acknowledged,
 * it is remembered for this person and project, so the step stays done.
 * It never says a test was acknowledged that the server did not.
 */

export const TEST_PAGE_POLL_INTERVAL_MS: number = 3000;

export type TestPageFromAppState =
  | { kind: "checking" }
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "paging"; executionLogId: string; statusMessage: string }
  | { kind: "acknowledged"; statusMessage: string }
  // Ended with nobody acknowledging it, or could not run: the server says why.
  | { kind: "ended"; statusMessage: string }
  // Not sent: why, in the reader's words.
  | { kind: "failed"; message: string };

export interface TestPageFromApp {
  state: TestPageFromAppState;
  send: () => Promise<void>;
}

export function useTestPageFromApp(data: {
  projectId: string | null;
  userId: string | null;
}): TestPageFromApp {
  const projectId: string = data.projectId || "";
  const userId: string = data.userId || "";

  const [state, setState] = useState<TestPageFromAppState>({
    kind: "checking",
  });
  const isMounted: React.MutableRefObject<boolean> = useRef<boolean>(true);
  // The run being followed: a send for another project is never shown here.
  const followed: React.MutableRefObject<string | null> = useRef<string | null>(
    null,
  );

  useEffect((): (() => void) => {
    isMounted.current = true;

    return (): void => {
      isMounted.current = false;
    };
  }, []);

  // Done before, from this app, for this person and project?
  useEffect((): (() => void) => {
    let isActive: boolean = true;
    followed.current = null;

    if (!projectId || !userId) {
      setState({ kind: "idle" });
      return (): void => {
        isActive = false;
      };
    }

    setState({ kind: "checking" });

    void hasAcknowledgedTestPageFromApp(projectId, userId).then(
      (isAcknowledged: boolean): void => {
        if (!isActive) {
          return;
        }

        setState(
          isAcknowledged
            ? {
                kind: "acknowledged",
                statusMessage: GET_READY_TEXT.acknowledgedBefore,
              }
            : { kind: "idle" },
        );
      },
    );

    return (): void => {
      isActive = false;
    };
  }, [projectId, userId]);

  const apply: (executionLogId: string, result: TestPageResult) => void =
    useCallback(
      (executionLogId: string, result: TestPageResult): void => {
        if (!isMounted.current || followed.current !== executionLogId) {
          return;
        }

        if (!isTestPageResultFinal(result)) {
          setState({
            kind: "paging",
            executionLogId: executionLogId,
            statusMessage: result.statusMessage,
          });
          return;
        }

        followed.current = null;

        if (result.status === "Acknowledged") {
          void rememberTestPageAcknowledged(projectId, userId);
          setState({
            kind: "acknowledged",
            statusMessage: result.statusMessage,
          });
          return;
        }

        setState({ kind: "ended", statusMessage: result.statusMessage });
      },
      [projectId, userId],
    );

  const readResult: (executionLogId: string) => Promise<void> = useCallback(
    async (executionLogId: string): Promise<void> => {
      try {
        apply(
          executionLogId,
          await fetchTestPageResult(projectId, executionLogId),
        );
      } catch {
        // A read that failed is read again: the test is still going.
      }
    },
    [projectId, apply],
  );

  // While it pages: read its result every few seconds, and on coming back.
  const pagingId: string | null =
    state.kind === "paging" ? state.executionLogId : null;

  useEffect((): (() => void) | undefined => {
    if (!pagingId) {
      return undefined;
    }

    const timer: ReturnType<typeof setInterval> = setInterval((): void => {
      void readResult(pagingId);
    }, TEST_PAGE_POLL_INTERVAL_MS);

    const subscription: { remove: () => void } = AppState.addEventListener(
      "change",
      (next: AppStateStatus): void => {
        if (next === "active") {
          void readResult(pagingId);
        }
      },
    );

    return (): void => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [pagingId, readResult]);

  const send: () => Promise<void> = useCallback(async (): Promise<void> => {
    if (!projectId) {
      setState({ kind: "failed", message: GET_READY_TEXT.noProject });
      return;
    }

    setState({ kind: "sending" });

    try {
      const severity: TestPageSeverity | null =
        await fetchTestPageSeverity(projectId);

      if (!severity) {
        if (isMounted.current) {
          setState({ kind: "failed", message: GET_READY_TEXT.noSeverity });
        }
        return;
      }

      const executionLogId: string = await sendTestPageToMyself(
        projectId,
        severity,
      );

      if (!isMounted.current) {
        return;
      }

      followed.current = executionLogId;
      setState({
        kind: "paging",
        executionLogId: executionLogId,
        statusMessage: "",
      });
    } catch (error: unknown) {
      if (isMounted.current) {
        setState({
          kind: "failed",
          message: getFriendlyErrorMessage(error),
        });
      }
    }
  }, [projectId]);

  return { state, send };
}
