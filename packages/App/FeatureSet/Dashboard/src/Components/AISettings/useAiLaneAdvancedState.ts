import Project from "Common/Models/DatabaseModels/Project";
import { useState } from "react";
import {
  AiLane,
  AiLaneAdvancedCard,
  AiLaneAdvancedState,
  EMPTY_AI_LANE_ADVANCED_STATE,
  getAiLaneAdvancedItems,
  getAiLaneAdvancedSummary,
  isAiLaneAdvancedConfigured,
  recordAiLaneAdvancedCard,
} from "./ProjectAiSettingsCopy";
import { FoldedSectionItem } from "Common/UI/Components/FoldedSection/FoldedSectionItem";

/*
 * What the folded More settings section of Incidents (or Alerts) → Settings
 * → AI says about the cards in it, from what each card read: their titles,
 * the ones holding a value drawn as chips, and - once every card has read
 * and none holds one - what the defaults do, under them.
 *
 * Each card reports what it read through onCardLoaded, when it first loads
 * and again after each save. Recording a read also re-renders the page,
 * which reads the permission snapshot again: it arrives on an API response
 * header, so the cards' Edit gates can be empty on the first paint.
 */

export interface AiLaneAdvanced {
  isConfigured: boolean;
  // The cards, by title, for the folded header; a set one is a chip.
  items: Array<FoldedSectionItem>;
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
    items: getAiLaneAdvancedItems(lane, state),
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
