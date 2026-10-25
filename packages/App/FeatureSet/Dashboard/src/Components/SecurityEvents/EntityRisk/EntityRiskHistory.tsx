import StackedDayBars, {
  StackedSeries,
} from "../../SecurityOverview/StackedDayBars";
import {
  ENTITY_RISK_TEST_IDS,
  HISTORY_CARD_DESCRIPTION,
  HISTORY_CARD_TITLE,
  HISTORY_CHART_LABEL,
} from "./EntityRiskCopy";
import {
  ENTITY_RISK_HISTORY_LEVELS,
  getEntityRiskHistoryDays,
  getEntityRiskLevelColor,
} from "./EntityRiskModel";
import { SecurityEntityRiskLevel } from "Common/Types/SecurityCase/SecurityEntityRisk";
import Card from "Common/UI/Components/Card/Card";
import OneUptimeDate from "Common/Types/Date";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  history: unknown;
  threshold: number;
}

/*
 * An entity's risk over the last 30 days: a bar a day, its score at the end
 * of the day, in the colour of the level it read as - so the day it went
 * High is the day its bar turns orange. Drawn with the Overview's day bars,
 * which a screen reader reads as a table.
 */
const EntityRiskHistory: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const series: Array<StackedSeries> = ENTITY_RISK_HISTORY_LEVELS.map(
    (level: SecurityEntityRiskLevel): StackedSeries => {
      return {
        key: level,
        color: getEntityRiskLevelColor(level).toString(),
      };
    },
  );

  return (
    <Card title={HISTORY_CARD_TITLE} description={HISTORY_CARD_DESCRIPTION}>
      <div data-testid={ENTITY_RISK_TEST_IDS.history}>
        <StackedDayBars
          days={getEntityRiskHistoryDays({
            history: props.history,
            threshold: props.threshold,
            now: OneUptimeDate.getCurrentDate(),
          })}
          series={series}
          ariaLabel={HISTORY_CHART_LABEL}
          heightInPx={120}
        />
      </div>
    </Card>
  );
};

export default EntityRiskHistory;
