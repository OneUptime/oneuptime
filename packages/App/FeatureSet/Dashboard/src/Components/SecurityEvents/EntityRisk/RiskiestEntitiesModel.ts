import {
  getEntityRiskLevelColor,
  getEntityRiskMeterPercent,
} from "./EntityRiskModel";
import { SecurityEntityType } from "Common/Types/SecurityCase/SecurityEntity";
import {
  SecurityEntityRiskLevel,
  SecurityRiskiestEntities,
  SecurityRiskiestEntity,
} from "Common/Types/SecurityCase/SecurityEntityRisk";
import { getEntityRiskLevel } from "Common/Utils/SecurityCase/SecurityEntityRiskScore";

/*
 * The Overview's Riskiest Entities, worked out from what the overview sent:
 * each entity's level against the project's threshold, in its level's
 * colour, and its bar filled as Entity Risk's meter is - against twice the
 * threshold, so the mark halfway along is where a case opens. The same
 * entity reads the same on the Overview, on Entity Risk and on its page.
 * React-free, so it is pinned in a plain test against the server's own
 * arithmetic (Common/Utils/SecurityCase/SecurityEntityRiskScore).
 */

export interface RiskiestEntityRow {
  value: string;
  type: SecurityEntityType | null;
  score: number;
  level: SecurityEntityRiskLevel;
  // The level's colour, as Entity Risk draws a level.
  color: string;
  // How full its bar is, from 0 to 100: Entity Risk's meter.
  fillPercent: number;
}

export function getRiskiestEntityRows(
  riskiest: SecurityRiskiestEntities,
): Array<RiskiestEntityRow> {
  return riskiest.entities.map(
    (entity: SecurityRiskiestEntity): RiskiestEntityRow => {
      const level: SecurityEntityRiskLevel = getEntityRiskLevel(
        entity.score,
        riskiest.threshold,
      );

      return {
        value: entity.value,
        type: entity.type,
        score: entity.score,
        level,
        color: getEntityRiskLevelColor(level).toString(),
        fillPercent: getEntityRiskMeterPercent(
          entity.score,
          riskiest.threshold,
        ),
      };
    },
  );
}

/*
 * How many more entities Entity Risk lists than the card shows: the card
 * offers the whole list only when there is more of it.
 */
export function getMoreRiskyEntityCount(
  riskiest: SecurityRiskiestEntities,
): number {
  return Math.max(0, riskiest.total - riskiest.entities.length);
}
