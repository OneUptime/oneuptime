import AutoRemediationSuggestion from "Common/Models/DatabaseModels/AutoRemediationSuggestion";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import AutoRemediationSuggestionStatus from "Common/Types/AutoRemediation/AutoRemediationSuggestionStatus";
import { REMEDIATION_ROUND_PATH } from "Common/Types/AutoRemediation/RemediationRound";
import { JSONObject } from "Common/Types/JSON";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import RetryAfter from "Common/Utils/RetryAfter";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  isRemediationRoundLive,
  parseRemediationRoundView,
  RemediationRoundView,
} from "./RemediationRoundView";

/*
 * The rounds of the fixes on the Remediation step (issues #6436, #6487):
 * each fix OneUptime AI worked out with a run is read once for where it
 * stands (its run and its status), again whenever either changes, and
 * every few seconds while its round is at work - the commands it checks
 * with arrive as it runs them. A read that fails leaves the fix as the
 * step drew it before: the round only adds to it.
 *
 * A read the server refuses because the person read rounds too often
 * (429, AutoRemediationRoundRateLimit, #6525) backs off instead of showing
 * anything: no round is read until the time its Retry-After names - at
 * least a minute, at most the limit's window - and then the fixes it did
 * not read are read, and the rounds at work are polled again.
 */

export const REMEDIATION_ROUND_POLL_INTERVAL_MS: number = 15 * 1000;

// How long the rounds wait after a refused read, when its answer names no time.
export const REMEDIATION_ROUND_BACKOFF_MIN_MS: number = 60 * 1000;

// The most they wait: the limit's whole window.
export const REMEDIATION_ROUND_BACKOFF_MAX_MS: number = 15 * 60 * 1000;

const TOO_MANY_REQUESTS_STATUS: number = 429;

/*
 * How long to wait after a read refused as too many (429): its Retry-After,
 * as RFC 9110 writes it (Common's RetryAfter) - whole seconds or an
 * HTTP-date - held between a minute and the limit's window. A minute when
 * it names no wait that can be read: Number() read "1e3" as a thousand
 * seconds and "+120" as two minutes. Null for any other answer, which is
 * not waited on.
 */
export function getRemediationRoundBackoffMs(
  response: HTTPErrorResponse,
): number | null {
  if (response.statusCode !== TOO_MANY_REQUESTS_STATUS) {
    return null;
  }

  return (
    RetryAfter.msFromHeaders(response.headers, {
      minMs: REMEDIATION_ROUND_BACKOFF_MIN_MS,
      maxMs: REMEDIATION_ROUND_BACKOFF_MAX_MS,
    }) ?? REMEDIATION_ROUND_BACKOFF_MIN_MS
  );
}

// What a read of the round was for: its run, and where the fix stood.
function getRoundReadKey(suggestion: AutoRemediationSuggestion): string {
  return `${suggestion.aiRunId?.toString() || ""}:${suggestion.status || ""}`;
}

export interface RemediationRounds {
  rounds: Map<string, RemediationRoundView>;
  // Read one fix's round again now: after Try again, say.
  reloadRound: (suggestion: AutoRemediationSuggestion) => Promise<void>;
}

export default function useRemediationRounds(data: {
  suggestions: Array<AutoRemediationSuggestion>;
  // The incident or alert they are for: another one starts from nothing.
  subjectKey: string;
}): RemediationRounds {
  const [rounds, setRounds] = useState<Map<string, RemediationRoundView>>(
    new Map<string, RemediationRoundView>(),
  );
  const readKeysRef: React.MutableRefObject<Map<string, string>> = useRef<
    Map<string, string>
  >(new Map<string, string>());
  const subjectKeyRef: React.MutableRefObject<string> = useRef<string>(
    data.subjectKey,
  );
  const roundsRef: React.MutableRefObject<Map<string, RemediationRoundView>> =
    useRef<Map<string, RemediationRoundView>>(rounds);
  roundsRef.current = rounds;

  /*
   * Until when no round is read, after the server refused a read as too
   * many (#6525), and the wait's end: it reads what was left unread.
   */
  const backoffUntilRef: React.MutableRefObject<number> = useRef<number>(0);
  const backoffTimerRef: React.MutableRefObject<ReturnType<
    typeof setTimeout
  > | null> = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [backoffEndCount, setBackoffEndCount] = useState<number>(0);

  useEffect(() => {
    return () => {
      if (backoffTimerRef.current) {
        clearTimeout(backoffTimerRef.current);
        backoffTimerRef.current = null;
      }
    };
  }, []);

  const backOff: (waitMs: number) => void = useCallback(
    (waitMs: number): void => {
      const until: number = Date.now() + waitMs;

      if (until <= backoffUntilRef.current) {
        return;
      }

      backoffUntilRef.current = until;

      if (backoffTimerRef.current) {
        clearTimeout(backoffTimerRef.current);
      }

      backoffTimerRef.current = setTimeout(() => {
        backoffTimerRef.current = null;
        setBackoffEndCount((count: number): number => {
          return count + 1;
        });
      }, waitMs);
    },
    [],
  );

  // Another incident or alert: what was read is not about it.
  useEffect(() => {
    subjectKeyRef.current = data.subjectKey;
    readKeysRef.current = new Map<string, string>();
    setRounds(new Map<string, RemediationRoundView>());
  }, [data.subjectKey]);

  const readRound: (suggestion: AutoRemediationSuggestion) => Promise<void> =
    useCallback(
      async (suggestion: AutoRemediationSuggestion): Promise<void> => {
        const suggestionId: string = suggestion.id?.toString() || "";
        const aiRunId: string = suggestion.aiRunId?.toString() || "";
        const requestedSubjectKey: string = subjectKeyRef.current;

        if (!suggestionId || !aiRunId) {
          return;
        }

        // Waiting out a refusal: the fix is read once the wait is over.
        if (Date.now() < backoffUntilRef.current) {
          return;
        }

        const readKey: string = getRoundReadKey(suggestion);

        readKeysRef.current.set(suggestionId, readKey);

        try {
          const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
            await API.post<JSONObject>({
              url: URL.fromString(
                APP_API_URL.toString() + REMEDIATION_ROUND_PATH,
              ),
              data: { suggestionId },
              headers: ModelAPI.getCommonHeaders(),
            });

          if (subjectKeyRef.current !== requestedSubjectKey) {
            return;
          }

          if (response instanceof HTTPErrorResponse) {
            const waitMs: number | null =
              getRemediationRoundBackoffMs(response);

            if (waitMs !== null) {
              // Not read: it is read again once the wait is over.
              if (readKeysRef.current.get(suggestionId) === readKey) {
                readKeysRef.current.delete(suggestionId);
              }

              backOff(waitMs);
            }

            return;
          }

          const round: RemediationRoundView = parseRemediationRoundView({
            json: response.data,
            suggestionId,
            aiRunId,
          });

          setRounds(
            (
              current: Map<string, RemediationRoundView>,
            ): Map<string, RemediationRoundView> => {
              const next: Map<string, RemediationRoundView> = new Map<
                string,
                RemediationRoundView
              >(current);
              next.set(suggestionId, round);
              return next;
            },
          );
        } catch {
          // The round only adds to the fix: a failed read leaves it as it was.
        }
      },
      [backOff],
    );

  /*
   * A fix with a run whose run or status changed since it was read - or
   * that was not read while the step waited out a refusal.
   */
  useEffect(() => {
    for (const suggestion of data.suggestions) {
      const suggestionId: string = suggestion.id?.toString() || "";

      if (
        suggestionId &&
        suggestion.aiRunId &&
        readKeysRef.current.get(suggestionId) !== getRoundReadKey(suggestion)
      ) {
        void readRound(suggestion);
      }
    }
  }, [data.suggestions, readRound, backoffEndCount]);

  // A round at work, read again every few seconds while it is.
  const hasLiveRound: boolean = data.suggestions.some(
    (suggestion: AutoRemediationSuggestion): boolean => {
      return (
        Boolean(suggestion.aiRunId) &&
        isRemediationRoundLive({
          status: suggestion.status as AutoRemediationSuggestionStatus,
          round: rounds.get(suggestion.id?.toString() || ""),
        })
      );
    },
  );

  const suggestionsRef: React.MutableRefObject<
    Array<AutoRemediationSuggestion>
  > = useRef<Array<AutoRemediationSuggestion>>(data.suggestions);
  suggestionsRef.current = data.suggestions;

  useEffect(() => {
    if (!hasLiveRound) {
      return;
    }

    const interval: ReturnType<typeof setInterval> = setInterval(() => {
      for (const suggestion of suggestionsRef.current) {
        if (
          suggestion.aiRunId &&
          isRemediationRoundLive({
            status: suggestion.status as AutoRemediationSuggestionStatus,
            round: roundsRef.current.get(suggestion.id?.toString() || ""),
          })
        ) {
          void readRound(suggestion);
        }
      }
    }, REMEDIATION_ROUND_POLL_INTERVAL_MS);

    return () => {
      clearInterval(interval);
    };
  }, [hasLiveRound, readRound]);

  return { rounds, reloadRound: readRound };
}
