import React, { FunctionComponent, ReactElement } from "react";
import {
  CloudHealthAssessment,
  CloudHealthText,
  assessCloudResourceHealth,
} from "Common/Types/Cloud/CloudResourceHealth";
import BreakableName from "Common/UI/Components/BreakableName/BreakableName";
import Pill from "Common/UI/Components/Pill/Pill";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { withSentenceDigits } from "../ResourcePart/SentenceDigits";
import {
  CLOUD_HEALTH_COLORS,
  CloudAttentionRow,
  getCloudHealthReasonLine,
} from "./CloudResourceAttention";

/*
 * A cloud resource's Status in a list: its health in one word - Healthy,
 * Degraded, Unhealthy, Reporting, Not reporting - with the most telling
 * reason under it ("5% of requests failed"), so the row says why without
 * opening the resource. The Hosts list's Status cell, for clouds.
 */

/*
 * The reason under the pill wraps within its column rather than widening
 * it: a table's cell keeps its values on one line (whitespace-nowrap), so
 * the reason says it wraps.
 */
export const CLOUD_STATUS_REASON_CLASS_NAME: string =
  "whitespace-normal text-xs text-gray-600 [overflow-wrap:anywhere]";

/*
 * The Status column's width, named by the page so the table keeps it: the
 * pill with a reason of up to 10rem.
 */
export const CLOUD_STATUS_COLUMN_CLASS_NAME: string =
  "min-w-[7rem] max-w-[10rem]";

/*
 * A reason as the Needs attention card words it: its numbers in the
 * sentence's digits, each value set apart from the words around it.
 */
export function getCloudHealthText(
  translator: Translator,
  reason: CloudHealthText,
): string {
  if (reason.plural) {
    return translator.translatePlural(
      { one: reason.plural.one, other: reason.text },
      reason.plural.count,
      withSentenceDigits(reason.values),
      { setsValuesApart: true },
    );
  }

  return reason.values
    ? translator.translateTemplate(
        reason.text,
        withSentenceDigits(reason.values),
        { setsValuesApart: true },
      )
    : translator.translateText(reason.text) || reason.text;
}

export interface ComponentProps {
  resource: CloudAttentionRow;
  now: Date;
  // A line of the list's own under the reason: when it was last seen.
  footer?: ReactElement | undefined;
}

const CloudResourceStatusCell: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const assessment: CloudHealthAssessment = assessCloudResourceHealth(
    props.resource,
    { now: props.now },
  );
  const line: { first: CloudHealthText | null; more: number } =
    getCloudHealthReasonLine(assessment);

  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <span
        data-testid="cloud-resource-status"
        data-state={assessment.state}
        data-tone={assessment.tone}
      >
        <Pill
          text={assessment.status.text}
          color={CLOUD_HEALTH_COLORS[assessment.tone]}
        />
      </span>
      {line.first ? (
        <div
          data-testid="cloud-resource-status-reason"
          className={CLOUD_STATUS_REASON_CLASS_NAME}
        >
          <BreakableName text={getCloudHealthText(translator, line.first)} />
          {line.more > 0 ? (
            <>
              {/* A space, so "+1 more" may move to a line of its own. */}{" "}
              <span className="whitespace-nowrap text-gray-500">
                {translator.translatePlural(
                  { one: "+{{count}} more", other: "+{{count}} more" },
                  line.more,
                )}
              </span>
            </>
          ) : (
            <></>
          )}
        </div>
      ) : (
        <></>
      )}
      {props.footer || <></>}
    </div>
  );
};

export default CloudResourceStatusCell;
