import OneUptimeDate from "../../../Types/Date";
import { Red } from "../../../Types/BrandColors";
import { TelemetryIngestionQueueRefusalStatus } from "../../../Types/Telemetry/TelemetryIngestionBudget";
import { Translator } from "../../../Types/Translator";
import useTranslator from "../../Utils/UseTranslator";
import Card, { CardButtonSchema } from "../Card/Card";
import Pill from "../Pill/Pill";
import {
  getTelemetryQueueRefusalLines,
  QUEUE_REFUSALS_CARD_DESCRIPTION,
  QUEUE_REFUSALS_CARD_TITLE,
  QUEUE_REFUSING_NOW,
  TelemetryQueueRefusalLine,
} from "./TelemetryQueueRefusalWords";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What OneUptime refused of the project's telemetry in the past day while
 * it caught up on the telemetry queue (#11440): a line for each signal,
 * with why, how many requests and since when, and whether it is refusing
 * still. The budget card above the Usage page draws it from the status it
 * reads (TelemetryIngestionBudgetStatus.queueRefusals), so the page reads
 * the status once; nothing at all while nothing was refused.
 */

export const TELEMETRY_QUEUE_REFUSALS_TEST_ID: string =
  "telemetry-queue-refusals";

export interface ComponentProps {
  refusals: ReadonlyArray<TelemetryIngestionQueueRefusalStatus>;
  // The card's header buttons: the budget card's Refresh.
  buttons?: Array<CardButtonSchema | ReactElement> | undefined;
  // When the lines are said: for "the latest 3 minutes ago".
  now?: Date | undefined;
}

const TelemetryQueueRefusalsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.refusals.length === 0) {
    return <></>;
  }

  const lines: Array<TelemetryQueueRefusalLine> = getTelemetryQueueRefusalLines(
    {
      refusals: props.refusals,
      translator: translator,
      now: props.now || OneUptimeDate.getCurrentDate(),
    },
  );

  return (
    <div data-testid={TELEMETRY_QUEUE_REFUSALS_TEST_ID}>
      <Card
        title={QUEUE_REFUSALS_CARD_TITLE}
        description={QUEUE_REFUSALS_CARD_DESCRIPTION}
        headerLayout={props.buttons ? "toolbar" : undefined}
        buttons={props.buttons}
      >
        <ul className="divide-y divide-gray-100">
          {lines.map((line: TelemetryQueueRefusalLine): ReactElement => {
            return (
              <li
                key={line.id}
                className="py-3 first:pt-0 last:pb-0"
                data-testid={`telemetry-queue-refusal-${line.id}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-gray-900">
                    {line.signalTitle}
                  </span>
                  {line.isCurrent ? (
                    <Pill text={QUEUE_REFUSING_NOW} color={Red} />
                  ) : (
                    <></>
                  )}
                </div>
                <p className="mt-1 text-sm text-gray-700">{line.reasonText}</p>
                <p className="mt-1 text-xs text-gray-500">{line.countText}</p>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
};

export default TelemetryQueueRefusalsCard;
