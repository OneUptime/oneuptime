import {
  isSameRemediationFoldState,
  REMEDIATION_FOLD_LOADING,
  RemediationFoldState,
} from "./AiOffSummaryData";
import { useCallback, useState } from "react";

/*
 * What the AI card's Remediation step read about the record, kept for the
 * card (InvestigationPanel), so it can fold into one line - "AI
 * investigation is off", and why - only when fixing did nothing either:
 *
 *   - the step reports what it read (onRemediationStateChange, its
 *     onFoldStateChange), which the card reads (remediationState);
 *   - the card hands the step how it is drawn directly (its aiCardFold),
 *     since the step is drawn inside it.
 *
 * Kept for one record: a value never outlives the record it was reported
 * for, and a card that moves to the next record starts again from "still
 * reading".
 */
export interface AiCardFoldWiring {
  // For the card: what the step last said about this record.
  remediationState: RemediationFoldState;
  // For the step (RemediationStep's onFoldStateChange).
  onRemediationStateChange: (state: RemediationFoldState) => void;
}

interface KeptRemediationState {
  recordKey: string;
  state: RemediationFoldState;
}

const useAiCardFold: (recordKey: string) => AiCardFoldWiring = (
  recordKey: string,
): AiCardFoldWiring => {
  const [remediation, setRemediation] = useState<KeptRemediationState>({
    recordKey,
    state: REMEDIATION_FOLD_LOADING,
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

  return {
    remediationState:
      remediation.recordKey === recordKey
        ? remediation.state
        : REMEDIATION_FOLD_LOADING,
    onRemediationStateChange,
  };
};

export default useAiCardFold;
