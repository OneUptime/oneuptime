import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import { getScheduleSentence } from "./RunbookTriggersCopy";
import Runbook from "Common/Models/DatabaseModels/Runbook";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import {
  DEFAULT_RUNBOOK_SCHEDULE_TIMEZONE,
  getRunbookScheduleChoice,
} from "Common/Types/Runbook/RunbookSchedule";
import Link from "Common/UI/Components/Link/Link";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * WHAT STARTS A RUNBOOK ON ITS OWN, in one place on its Overview.
 *
 * A runbook's Triggers page sits in its menu's Settings section, folded
 * until opened, so the Overview says whether the runbook runs on a schedule
 * or from its webhook - or neither, and then what does start it - with the
 * way to change it. One line each, in the Overview's details:
 *
 *   - a schedule that is on: when it runs, in its time zone, as the
 *     Triggers page's schedule card says it ("Runs every weekday at 09:00
 *     · Europe/London");
 *   - a schedule that is set up and turned off: that it is paused;
 *   - a webhook that is on: that a call to its URL runs it (never the URL,
 *     which only the people who may edit and run the runbook see);
 *   - neither: that someone starts it, or a rule or OneUptime AI does.
 */

export const RUNBOOK_TRIGGERS_SUMMARY_TEST_ID: string =
  "runbook-overview-triggers";

export const RunbookTriggersSummaryCopy: {
  readonly title: string;
  readonly schedulePaused: string;
  readonly webhookOn: string;
  readonly none: string;
  readonly change: string;
  readonly location: string;
} = {
  title: translationKey("Triggers"),
  schedulePaused: translationKey("Its schedule is paused."),
  webhookOn: translationKey("Runs when its webhook URL is called."),
  none: translationKey(
    "No schedule or webhook: it runs when someone starts it, or when a rule or OneUptime AI does.",
  ),
  // {{location}} is a link to the runbook's Triggers page.
  change: translationKey("Change it under {{location}}."),
  // Where the Triggers page is in the runbook's own menu.
  location: translationKey("Settings › Triggers"),
};

// The parts of a runbook the summary reads.
export const RUNBOOK_TRIGGERS_SUMMARY_SELECT: {
  isScheduleEnabled: true;
  scheduleCron: true;
  scheduleTimezone: true;
  isWebhookEnabled: true;
} = {
  isScheduleEnabled: true,
  scheduleCron: true,
  scheduleTimezone: true,
  isWebhookEnabled: true,
};

export interface RunbookTriggersSummary {
  // On: when the schedule runs it, in its time zone. Off or none: undefined.
  scheduleOn?: { cron: string; timezone: string } | undefined;
  // A schedule is set up, and turned off.
  isSchedulePaused: boolean;
  isWebhookOn: boolean;
}

// What starts the runbook on its own, read from the runbook.
export function getRunbookTriggersSummary(
  runbook: Pick<
    Runbook,
    | "isScheduleEnabled"
    | "scheduleCron"
    | "scheduleTimezone"
    | "isWebhookEnabled"
  >,
): RunbookTriggersSummary {
  const cron: string = (runbook.scheduleCron || "").trim();
  const isScheduleOn: boolean =
    runbook.isScheduleEnabled === true && Boolean(cron);

  return {
    ...(isScheduleOn
      ? {
          scheduleOn: {
            cron,
            timezone:
              runbook.scheduleTimezone || DEFAULT_RUNBOOK_SCHEDULE_TIMEZONE,
          },
        }
      : {}),
    isSchedulePaused: !isScheduleOn && Boolean(cron),
    isWebhookOn: runbook.isWebhookEnabled === true,
  };
}

export interface ComponentProps {
  runbookId: ObjectID;
  runbook: Pick<
    Runbook,
    | "isScheduleEnabled"
    | "scheduleCron"
    | "scheduleTimezone"
    | "isWebhookEnabled"
  >;
}

const RunbookTriggersSummaryElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const summary: RunbookTriggersSummary = getRunbookTriggersSummary(
    props.runbook,
  );

  const triggersRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.RUNBOOK_VIEW_TRIGGERS] as Route,
    { modelId: props.runbookId },
  );

  const lines: Array<{ key: string; text: string }> = [];

  if (summary.scheduleOn) {
    lines.push({
      key: "schedule",
      // As the Triggers page's schedule card says it.
      text: `${getScheduleSentence(
        translator,
        getRunbookScheduleChoice(summary.scheduleOn.cron),
      )} · ${summary.scheduleOn.timezone}`,
    });
  } else if (summary.isSchedulePaused) {
    lines.push({
      key: "schedule-paused",
      text: translator.translateText(RunbookTriggersSummaryCopy.schedulePaused),
    });
  }

  if (summary.isWebhookOn) {
    lines.push({
      key: "webhook",
      text: translator.translateText(RunbookTriggersSummaryCopy.webhookOn),
    });
  }

  if (!summary.scheduleOn && !summary.isWebhookOn) {
    lines.push({
      key: "none",
      text: translator.translateText(RunbookTriggersSummaryCopy.none),
    });
  }

  return (
    <div
      className="flex flex-col gap-1 text-sm text-gray-900"
      data-testid={RUNBOOK_TRIGGERS_SUMMARY_TEST_ID}
    >
      {lines.map((line: { key: string; text: string }) => {
        return (
          <p
            key={line.key}
            data-testid={`${RUNBOOK_TRIGGERS_SUMMARY_TEST_ID}-${line.key}`}
          >
            {line.text}
          </p>
        );
      })}
      <p className="text-gray-500">
        <TranslatedSentence
          template={RunbookTriggersSummaryCopy.change}
          slots={{
            location: (
              <Link
                to={triggersRoute}
                className="font-medium text-indigo-600 hover:text-indigo-500 hover:underline"
                dataTestId={`${RUNBOOK_TRIGGERS_SUMMARY_TEST_ID}-link`}
              >
                {translator.translateText(RunbookTriggersSummaryCopy.location)}
              </Link>
            ),
          }}
        />
      </p>
    </div>
  );
};

export default RunbookTriggersSummaryElement;
