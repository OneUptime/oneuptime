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
 */

export const REMEDIATION_ROUND_POLL_INTERVAL_MS: number = 15 * 1000;

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

        readKeysRef.current.set(suggestionId, getRoundReadKey(suggestion));

        try {
          const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
            await API.post<JSONObject>({
              url: URL.fromString(
                APP_API_URL.toString() + REMEDIATION_ROUND_PATH,
              ),
              data: { suggestionId },
              headers: ModelAPI.getCommonHeaders(),
            });

          if (
            response instanceof HTTPErrorResponse ||
            subjectKeyRef.current !== requestedSubjectKey
          ) {
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
      [],
    );

  // A fix with a run whose run or status changed since it was read.
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
  }, [data.suggestions, readRound]);

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
