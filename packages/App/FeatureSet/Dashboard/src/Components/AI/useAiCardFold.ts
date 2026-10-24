import {
  AiCardFold,
  isSameRemediationFoldState,
  REMEDIATION_FOLD_LOADING,
  RemediationFoldState,
} from "./AiOffSummaryData";
import { useCallback, useState } from "react";

/*
 * What an incident's or alert's page passes between its AI card and its
 * Remediation card, so the AI card can fold into one line - "AI
 * investigation is off", and why - only when fixing did nothing either, and
 * the Remediation card can leave saying so to that line:
 *
 *   - the Remediation card reports what it read (onRemediationStateChange),
 *     which the AI card reads (remediationState);
 *   - the AI card reports how it is drawn (onFoldChange), which the
 *     Remediation card reads (fold).
 *
 * Neither depends on what the other draws, so the two never wait on each
 * other in a loop. Both are kept for one record: a value never outlives the
 * record it was reported for, and a page that moves to the next record
 * starts again from "still reading".
 */
export interface AiCardFoldWiring {
  // For the AI card (InvestigationPanel's remediationState).
  remediationState: RemediationFoldState;
  // For the Remediation card (RemediationSuggestionCard's onFoldStateChange).
  onRemediationStateChange: (state: RemediationFoldState) => void;
  // For the Remediation card (RemediationSuggestionCard's aiCardFold).
  fold: AiCardFold;
  // For the AI card (InvestigationPanel's onCardFoldChange).
  onFoldChange: (fold: AiCardFold) => void;
}

interface KeptRemediationState {
  recordKey: string;
  state: RemediationFoldState;
}

interface KeptFold {
  recordKey: string;
  fold: AiCardFold;
}

const useAiCardFold: (recordKey: string) => AiCardFoldWiring = (
  recordKey: string,
): AiCardFoldWiring => {
  const [remediation, setRemediation] = useState<KeptRemediationState>({
    recordKey,
    state: REMEDIATION_FOLD_LOADING,
  });
  const [fold, setFold] = useState<KeptFold>({
    recordKey,
    fold: "checking",
  });

  const onRemediationStateChange: (state: RemediationFoldState) => void =
    useCallback(
      (state: RemediationFoldState): void => {
        setRemediation(
          (current: KeptRemediationState): KeptRemediationState => {
            if (
              current.recordKey === recordKey &&
              isSameRemediationFoldState(current.state, state)
            ) {
              return current;
            }

            return { recordKey, state };
          },
        );
      },
      [recordKey],
    );

  const onFoldChange: (next: AiCardFold) => void = useCallback(
    (next: AiCardFold): void => {
      setFold((current: KeptFold): KeptFold => {
        if (current.recordKey === recordKey && current.fold === next) {
          return current;
        }

        return { recordKey, fold: next };
      });
    },
    [recordKey],
  );

  return {
    remediationState:
      remediation.recordKey === recordKey
        ? remediation.state
        : REMEDIATION_FOLD_LOADING,
    onRemediationStateChange,
    fold: fold.recordKey === recordKey ? fold.fold : "checking",
    onFoldChange,
  };
};

export default useAiCardFold;
