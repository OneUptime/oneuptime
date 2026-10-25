import {
  ENTITY_RISK_TEST_IDS,
  RISK_AGAINST_THRESHOLD,
} from "./EntityRiskCopy";
import {
  getEntityRiskLevelColor,
  getEntityRiskMeterPercent,
} from "./EntityRiskModel";
import Color from "Common/Types/Color";
import { SecurityEntityRiskLevel } from "Common/Types/SecurityCase/SecurityEntityRisk";
import { getEntityRiskLevel } from "Common/Utils/SecurityCase/SecurityEntityRiskScore";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  score: number;
  threshold: number;
  // A row of a list (the default), or the head of an entity's page.
  isLarge?: boolean | undefined;
}

// The level a score reads as, in its colour (Low, Medium, High, Critical).
export const EntityRiskLevelPill: FunctionComponent<{
  level: SecurityEntityRiskLevel;
  size?: PillSize | undefined;
}> = (props: {
  level: SecurityEntityRiskLevel;
  size?: PillSize | undefined;
}): ReactElement => {
  return (
    <span data-testid={ENTITY_RISK_TEST_IDS.levelPill}>
      <Pill
        text={props.level}
        color={getEntityRiskLevelColor(props.level)}
        size={props.size || PillSize.Small}
      />
    </span>
  );
};

/*
 * How full of risk an entity is: a bar from nothing to twice the threshold,
 * where Critical starts, with a mark at the threshold - where a case opens -
 * halfway along. Filled in the colour of the level.
 */
export const EntityRiskMeter: FunctionComponent<{
  score: number;
  threshold: number;
  className?: string | undefined;
}> = (props: {
  score: number;
  threshold: number;
  className?: string | undefined;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const level: SecurityEntityRiskLevel = getEntityRiskLevel(
    props.score,
    props.threshold,
  );
  const color: Color = getEntityRiskLevelColor(level);
  const percent: number = getEntityRiskMeterPercent(
    props.score,
    props.threshold,
  );

  return (
    <div
      className={`relative h-1.5 overflow-hidden rounded-full bg-gray-100 ${props.className || ""}`}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={props.threshold * 2}
      aria-valuenow={Math.min(props.score, props.threshold * 2)}
      aria-label={translator.translateTemplate(RISK_AGAINST_THRESHOLD, {
        threshold: translator.formatNumber(props.threshold),
      })}
      data-testid={ENTITY_RISK_TEST_IDS.meter}
    >
      <div
        className="absolute inset-y-0 start-0 rounded-full"
        style={{
          width: `${percent}%`,
          backgroundColor: color.toString(),
        }}
      />
      {/* The threshold, where a case opens. */}
      <div
        className="absolute inset-y-0 start-1/2 w-px bg-gray-400"
        aria-hidden="true"
      />
    </div>
  );
};

/*
 * An entity's risk as every Entity Risk surface draws it: the score, the
 * level it reads as against the project's threshold, and the meter.
 */
const EntityRiskScore: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const level: SecurityEntityRiskLevel = getEntityRiskLevel(
    props.score,
    props.threshold,
  );

  if (props.isLarge) {
    return (
      <div className="min-w-0" data-testid={ENTITY_RISK_TEST_IDS.score}>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-3xl font-semibold tabular-nums text-gray-900">
            {translator.formatNumber(props.score)}
          </span>
          <EntityRiskLevelPill level={level} size={PillSize.Normal} />
        </div>
        <EntityRiskMeter
          score={props.score}
          threshold={props.threshold}
          className="mt-2 w-full max-w-xs"
        />
        <p className="mt-1.5 text-xs text-gray-500">
          {translator.translateTemplate(RISK_AGAINST_THRESHOLD, {
            threshold: translator.formatNumber(props.threshold),
          })}
        </p>
      </div>
    );
  }

  return (
    <div className="min-w-0" data-testid={ENTITY_RISK_TEST_IDS.score}>
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold tabular-nums text-gray-900">
          {translator.formatNumber(props.score)}
        </span>
        <EntityRiskLevelPill level={level} />
      </div>
      <EntityRiskMeter
        score={props.score}
        threshold={props.threshold}
        className="mt-1.5 w-24"
      />
    </div>
  );
};

export default EntityRiskScore;
