import Project from "Common/Models/DatabaseModels/Project";
import {
  TELEMETRY_AI_LANES,
  TelemetryAiLane,
} from "Common/Types/AI/TelemetryAi";
import AdvancedPageSection from "Common/UI/Components/AdvancedPageSection/AdvancedPageSection";
import {
  FoldedSectionItem,
  foldedSectionItem,
} from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import { ModelSwitchColumn } from "Common/UI/Components/ModelSwitch/ModelSwitchUtil";
import React, { FunctionComponent, ReactElement, useState } from "react";
import ProjectAiNotice from "../AISettings/ProjectAiNotice";
import ProjectAiSwitchesCard from "../AISettings/ProjectAiSwitchesCard";
import {
  TELEMETRY_AI_LANE_COPY,
  TELEMETRY_AI_RULES_CARD_TITLE,
  TELEMETRY_AI_SWITCHES,
  TELEMETRY_AI_SWITCHES_CARD_TITLE,
  TELEMETRY_AI_TEST_IDS,
  TelemetryAiLaneCopy,
  getTelemetryAiRulesTableId,
} from "./TelemetryAiCopy";
import TelemetryAiReadiness, {
  TelemetryAiReadinessState,
  isTelemetryAiReadinessShown,
  useTelemetryAiReadiness,
} from "./TelemetryAiReadiness";
import TelemetryAiRulesTable from "./TelemetryAiRulesTable";

/*
 * A telemetry product's AI → Settings - the Profiler's first: what
 * OneUptime AI does with the problems OneUptime finds in the product's data,
 * as the incidents' AI settings say it.
 *
 *   - Enable AI's notice, only while it is off (or the project has no LLM
 *     provider): with it off, the problems are still found, and nothing
 *     else happens;
 *   - the lane's switch - "Find and fix slow code" - which saves the moment
 *     it is flipped: on for new projects, the rule "turned on by default";
 *     and under it, inside its card, whether OneUptime AI can open pull
 *     requests now, and what to do first when it cannot
 *     (TelemetryAiReadiness) - only while the switch is on and Enable AI
 *     too, since with either off nothing is opened;
 *   - folded under More settings, the lane's AI rules (TelemetryAiRulesTable):
 *     which services' problems it works on, when, and whether it opens pull
 *     requests on its own. The folded header names the table, as a chip
 *     with how many rules are on once there are any, and - with none - says
 *     what OneUptime AI does without them.
 */

export interface ComponentProps {
  lane: TelemetryAiLane;
}

// The folded header's one card: the rules, as a chip once there are any.
export function getTelemetryAiAdvancedItems(
  lane: TelemetryAiLane,
  ruleCount: number | null,
): Array<FoldedSectionItem> {
  const count: number = ruleCount && ruleCount > 0 ? Math.floor(ruleCount) : 0;

  return [
    foldedSectionItem(TELEMETRY_AI_RULES_CARD_TITLE, {
      key: getTelemetryAiRulesTableId(lane),
      isSet: count > 0,
      value: count > 0 ? String(count) : undefined,
    }),
  ];
}

/*
 * What the folded header says the defaults do: only once the rules have
 * been counted and there are none.
 */
export function getTelemetryAiAdvancedSummary(
  lane: TelemetryAiLane,
  ruleCount: number | null,
): string | undefined {
  return ruleCount === 0
    ? TELEMETRY_AI_LANE_COPY[lane].advancedDefaultsSummary
    : undefined;
}

const TelemetryAiSettingsPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const copy: TelemetryAiLaneCopy = TELEMETRY_AI_LANE_COPY[props.lane];
  const [ruleCount, setRuleCount] = useState<number | null>(null);
  const readiness: TelemetryAiReadinessState = useTelemetryAiReadiness(
    props.lane,
  );
  // Where the lane's switch is on the screen: null until the card reads it.
  const [isLaneOn, setIsLaneOn] = useState<boolean | null>(null);

  return (
    <>
      <ProjectAiNotice context={copy.noticeContext} />

      <ProjectAiSwitchesCard
        cardTitle={TELEMETRY_AI_SWITCHES_CARD_TITLE}
        cardDescription={copy.switchesCardDescription}
        switches={TELEMETRY_AI_SWITCHES[props.lane]}
        onChange={(column: ModelSwitchColumn<Project>, isOn: boolean): void => {
          if (column === TELEMETRY_AI_LANES[props.lane].switchColumn) {
            setIsLaneOn(isOn);
          }
        }}
        details={
          isTelemetryAiReadinessShown(readiness, isLaneOn) ? (
            <TelemetryAiReadiness state={readiness} />
          ) : undefined
        }
        dataTestId={TELEMETRY_AI_TEST_IDS.switches}
      />

      <AdvancedPageSection
        description={copy.advancedDescription}
        items={getTelemetryAiAdvancedItems(props.lane, ruleCount)}
        summary={getTelemetryAiAdvancedSummary(props.lane, ruleCount)}
        dataTestId={TELEMETRY_AI_TEST_IDS.advancedSection}
      >
        <TelemetryAiRulesTable
          lane={props.lane}
          onRulesLoaded={(count: number): void => {
            setRuleCount(count);
          }}
        />
      </AdvancedPageSection>
    </>
  );
};

export default TelemetryAiSettingsPage;
