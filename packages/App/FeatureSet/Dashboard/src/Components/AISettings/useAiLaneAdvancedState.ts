import Project from "Common/Models/DatabaseModels/Project";
import { useState } from "react";
import {
  AiLane,
  AiLaneAdvancedCard,
  AiLaneAdvancedState,
  EMPTY_AI_LANE_ADVANCED_STATE,
  getAiLaneAdvancedSummary,
  isAiLaneAdvancedConfigured,
  recordAiLaneAdvancedCard,
} from "./ProjectAiSettingsCopy";

/*
 * What the folded Advanced section of Incidents (or Alerts) → Settings → AI
 * says about the cards in it, from what each card read: "Configured" while
 * any of them holds a value, and - once every card has read and none holds
 * one - what the defaults do, under the folded header.
 *
 * Each card reports what it read through onCardLoaded, when it first loads
 * and again after each save. Recording a read also re-renders the page,
 * which reads the permission snapshot again: it arrives on an API response
 * header, so the cards' Edit gates can be empty on the first paint.
 */

export interface AiLaneAdvanced {
  isConfigured: boolean;
  // What the defaults do, for the folded header; nothing until it is so.
  summary: string | undefined;
  onCardLoaded: (card: AiLaneAdvancedCard) => (item: Project) => void;
}

const useAiLaneAdvancedState: (lane: AiLane) => AiLaneAdvanced = (
  lane: AiLane,
): AiLaneAdvanced => {
  const [state, setState] = useState<AiLaneAdvancedState>(
    EMPTY_AI_LANE_ADVANCED_STATE,
  );

  return {
    isConfigured: isAiLaneAdvancedConfigured(lane, state),
    summary: getAiLaneAdvancedSummary(lane, state),
    onCardLoaded: (card: AiLaneAdvancedCard): ((item: Project) => void) => {
      return (item: Project): void => {
        setState((previous: AiLaneAdvancedState): AiLaneAdvancedState => {
          return recordAiLaneAdvancedCard({
            state: previous,
            lane,
            card,
            item: item as unknown as Record<string, unknown>,
          });
        });
      };
    },
  };
};

export default useAiLaneAdvancedState;
