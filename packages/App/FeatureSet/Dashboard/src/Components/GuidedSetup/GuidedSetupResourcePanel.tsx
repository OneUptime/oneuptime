import {
  GuidedSetupRunSync,
  GuidedSetupStepState,
} from "./GuidedSetupProgress";
import {
  GUIDED_SETUP_RESOURCE_STATUS_TONES,
  GUIDED_SETUP_RESOURCE_STATUS_WORDS,
  GuidedSetupResourceRow,
  countReadyResources,
} from "./GuidedSetupResources";
import { WELCOME_MINUTES_COPY } from "../Home/WelcomeChecklist/WelcomeChecklistCatalog";
import { GuidedSetupResourceStatus } from "Common/Types/GuidedSetup/GuidedSetupRun";
import IconProp from "Common/Types/Icon/IconProp";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { ErrorInSentence } from "Common/UI/Components/ErrorMessage/ErrorSentence";
import Icon from "Common/UI/Components/Icon/Icon";
import InlineSeparator from "Common/UI/Components/InlineSeparator/InlineSeparator";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import { PRODUCT_TEXT_CLASS_NAME } from "Common/UI/Utils/ProductText";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * THE PANEL BESIDE A GUIDED SETUP'S STEPS (#10276): what the setup sets up,
 * live. Each step's outcome heads the records that step makes (a monitor; an
 * on-call policy with its escalation rule and the rules that run it; a test
 * page), each with how it is getting on - waiting for its step, being made,
 * made or in use with Open, skipped, or failed with why and Try again
 * (GuidedSetupResources) - so the person always knows what exists and what
 * to do next. Under them, where the run stands with the server (#7253:
 * saved to their account, so another device picks it up) and about how long
 * the setup takes.
 *
 * GuidedSetupFrame draws it beside the steps from lg up, kept in view while
 * the steps scroll, and after them on a phone.
 */

export interface GuidedSetupPanelGroup {
  stepKey: string;
  // The step's outcome, in English: what the person has once it is done.
  outcome: string;
  state: GuidedSetupStepState;
  resources: Array<GuidedSetupResourceRow>;
}

export interface ComponentProps {
  groups: Array<GuidedSetupPanelGroup>;
  // Where the run stands with the server; left out, nothing is said of it.
  sync?: GuidedSetupRunSync | undefined;
  // Sends again what the server did not take.
  onRetrySync?: (() => void) | undefined;
  minutes?: number | undefined;
}

export const GUIDED_SETUP_PANEL_COPY: {
  title: string;
  description: string;
  ready: PluralTemplate;
  open: string;
  tryAgain: string;
  syncIdle: string;
  syncSaving: string;
  syncSaved: string;
  syncNotSaved: string;
} = {
  title: translationKey("What this sets up"),
  description: translationKey(
    "Each record shows here as it is made, with a link to open it.",
  ),
  ready: {
    one: "{{count}} of {{total}} ready",
    other: "{{count}} of {{total}} ready",
  },
  open: translationKey("Open"),
  tryAgain: translationKey("Try again"),
  syncIdle: translationKey(
    "Your progress is saved to your account as you go, so you can pick up on any device.",
  ),
  syncSaving: translationKey("Saving your progress…"),
  syncSaved: translationKey(
    "Saved to your account. Pick up where you left off on any device.",
  ),
  syncNotSaved: translationKey(
    "Not saved to your account yet: OneUptime could not be reached. This browser keeps your progress until it can.",
  ),
};

export const GUIDED_SETUP_PANEL_TEST_IDS: {
  panel: string;
  sync: string;
  syncRetry: string;
  minutes: string;
  ready: string;
} = {
  panel: "guided-setup-aside",
  sync: "guided-setup-sync",
  syncRetry: "guided-setup-sync-retry",
  minutes: "guided-setup-minutes",
  ready: "guided-setup-ready",
};

const linkClassName: string =
  "inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-800 underline-offset-2 hover:underline";

// The mark beside a step's outcome, by the state of its step.
export const OutcomeMark: FunctionComponent<{
  state: GuidedSetupStepState;
  number: number;
}> = (props: { state: GuidedSetupStepState; number: number }): ReactElement => {
  if (props.state === GuidedSetupStepState.Done) {
    return (
      <span
        aria-hidden="true"
        className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-emerald-500"
      >
        <Icon icon={IconProp.Check} className="h-3.5 w-3.5 text-white" />
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`flex h-6 w-6 flex-none items-center justify-center rounded-full border-2 bg-white text-xs font-semibold ${
        props.state === GuidedSetupStepState.Open
          ? "border-indigo-600 text-indigo-600"
          : "border-gray-300 text-gray-500"
      }`}
    >
      {props.number}
    </span>
  );
};

// The small mark beside a record, by how it is getting on.
const ResourceMark: FunctionComponent<{
  status: GuidedSetupResourceStatus;
}> = (props: { status: GuidedSetupResourceStatus }): ReactElement => {
  const box: string =
    "mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full";

  switch (props.status) {
    case GuidedSetupResourceStatus.Creating:
      return (
        <span
          aria-hidden="true"
          className={`${box} border-2 border-indigo-200 border-t-indigo-600 motion-safe:animate-spin`}
        ></span>
      );
    case GuidedSetupResourceStatus.Created:
    case GuidedSetupResourceStatus.Existing:
      return (
        <span aria-hidden="true" className={`${box} bg-emerald-500`}>
          <Icon icon={IconProp.Check} className="h-2.5 w-2.5 text-white" />
        </span>
      );
    case GuidedSetupResourceStatus.Failed:
      return (
        <span aria-hidden="true" className={`${box} bg-red-600`}>
          <Icon icon={IconProp.Close} className="h-2.5 w-2.5 text-white" />
        </span>
      );
    case GuidedSetupResourceStatus.Skipped:
      return (
        <span aria-hidden="true" className={`${box} bg-gray-300`}>
          <Icon icon={IconProp.Minus} className="h-2.5 w-2.5 text-white" />
        </span>
      );
    default:
      return (
        <span
          aria-hidden="true"
          className={`${box} border-2 border-gray-300 bg-white`}
        ></span>
      );
  }
};

const ResourceItem: FunctionComponent<{
  row: GuidedSetupResourceRow;
}> = (props: { row: GuidedSetupResourceRow }): ReactElement => {
  const translator: Translator = useTranslator();
  const row: GuidedSetupResourceRow = props.row;
  const statusWords: string =
    row.statusText || GUIDED_SETUP_RESOURCE_STATUS_WORDS[row.status];

  return (
    <li
      className="flex items-start gap-2.5"
      data-testid={`guided-setup-resource-${row.key}`}
      data-status={row.status}
    >
      <ResourceMark status={row.status} />
      <div className="min-w-0 flex-1">
        {/*
         * What it is and how it is getting on, said together as either
         * changes: "On-call policy, Created".
         */}
        <div
          className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1"
          aria-live="polite"
          aria-atomic="true"
        >
          <span
            className={`text-sm font-medium ${
              row.status === GuidedSetupResourceStatus.Waiting
                ? "text-gray-600"
                : "text-gray-900"
            } ${PRODUCT_TEXT_CLASS_NAME}`}
          >
            {translator.translateText(row.kind)}
          </span>
          {/*
           * A record still waiting for its step says so to a screen reader
           * only: a chip on every row to come would bury the ones that
           * changed. Its hollow mark says it to the eye.
           */}
          {row.status === GuidedSetupResourceStatus.Waiting ? (
            <span
              className="sr-only"
              data-testid={`guided-setup-resource-${row.key}-status`}
            >
              {translator.translateText(statusWords)}
            </span>
          ) : (
            <Pill
              text={statusWords}
              tone={GUIDED_SETUP_RESOURCE_STATUS_TONES[row.status]}
              size={PillSize.Small}
              isPulsing={row.status === GuidedSetupResourceStatus.Creating}
              dataTestId={`guided-setup-resource-${row.key}-status`}
            />
          )}
        </div>
        {row.name ? (
          <p
            className="mt-0.5 break-words text-sm text-gray-700"
            data-testid={`guided-setup-resource-${row.key}-name`}
          >
            {row.name}
          </p>
        ) : (
          <></>
        )}
        {row.detail ? (
          <p
            className="mt-0.5 break-words text-xs text-gray-500"
            data-testid={`guided-setup-resource-${row.key}-detail`}
          >
            {row.detail}
          </p>
        ) : (
          <></>
        )}
        {row.status === GuidedSetupResourceStatus.Failed && row.error ? (
          <p
            className="mt-1 break-words text-xs text-red-700"
            data-testid={`guided-setup-resource-${row.key}-error`}
          >
            <ErrorInSentence message={translator.translateText(row.error)} />
          </p>
        ) : (
          <></>
        )}
        {row.route ||
        (row.status === GuidedSetupResourceStatus.Failed && row.onRetry) ? (
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
            {row.route ? (
              /*
               * In a new tab, as the setup's other links to the records
               * open: the setup keeps its place, and its open step.
               */
              <a
                href={row.route.toString()}
                target="_blank"
                rel="noopener noreferrer"
                className={linkClassName}
                data-testid={`guided-setup-resource-${row.key}-open`}
              >
                {translator.translateText(GUIDED_SETUP_PANEL_COPY.open)}
                <Icon
                  icon={IconProp.ExternalLink}
                  className="h-3.5 w-3.5 flex-shrink-0"
                />
              </a>
            ) : (
              <></>
            )}
            {row.status === GuidedSetupResourceStatus.Failed && row.onRetry ? (
              <Button
                title={GUIDED_SETUP_PANEL_COPY.tryAgain}
                buttonStyle={ButtonStyleType.LINK}
                icon={IconProp.Refresh}
                dataTestId={`guided-setup-resource-${row.key}-retry`}
                onClick={() => {
                  row.onRetry?.();
                }}
              />
            ) : (
              <></>
            )}
          </div>
        ) : (
          <></>
        )}
      </div>
    </li>
  );
};

/*
 * THE OPEN STEP'S RECORDS, IN THE STEP, ON A PHONE: there the panel follows
 * the steps, out of sight while the person works in one, so the step itself
 * says what it made - "Monitor, acme.example, Created" - as soon as it has
 * made, is making or failed to make something. What waits for the step, was
 * there already or was skipped is left out: the step's own words say it.
 * From lg up the panel beside the steps says it, so this is not drawn. Not a
 * live region: the panel's rows are, and a screen reader hears each change
 * once.
 */
const STEP_RECORD_STATUSES: ReadonlyArray<GuidedSetupResourceStatus> = [
  GuidedSetupResourceStatus.Creating,
  GuidedSetupResourceStatus.Created,
  GuidedSetupResourceStatus.Failed,
];

export const GuidedSetupStepRecords: FunctionComponent<{
  stepKey: string;
  rows: Array<GuidedSetupResourceRow>;
}> = (props: {
  stepKey: string;
  rows: Array<GuidedSetupResourceRow>;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const rows: Array<GuidedSetupResourceRow> = props.rows.filter(
    (row: GuidedSetupResourceRow): boolean => {
      return STEP_RECORD_STATUSES.includes(row.status);
    },
  );

  if (rows.length === 0) {
    return <></>;
  }

  return (
    <ul
      className="mb-4 space-y-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 lg:hidden"
      data-testid={`guided-setup-step-${props.stepKey}-records`}
    >
      {rows.map((row: GuidedSetupResourceRow) => {
        return (
          <li
            key={row.key}
            className="flex items-start gap-2.5"
            data-testid={`guided-setup-step-record-${row.key}`}
            data-status={row.status}
          >
            <ResourceMark status={row.status} />
            <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-2 gap-y-1">
              <span className="min-w-0 break-words text-sm text-gray-900">
                <span className={`font-medium ${PRODUCT_TEXT_CLASS_NAME}`}>
                  {translator.translateText(row.kind)}
                </span>
                {row.name ? (
                  <span className="text-gray-600">
                    {/* Two facts set apart, as a row of facts is. */}
                    <InlineSeparator />
                    {row.name}
                  </span>
                ) : (
                  <></>
                )}
              </span>
              <Pill
                text={
                  row.statusText ||
                  GUIDED_SETUP_RESOURCE_STATUS_WORDS[row.status]
                }
                tone={GUIDED_SETUP_RESOURCE_STATUS_TONES[row.status]}
                size={PillSize.Small}
                isPulsing={row.status === GuidedSetupResourceStatus.Creating}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
};

const SYNC_WORDS: Readonly<Record<GuidedSetupRunSync, string>> = {
  [GuidedSetupRunSync.Idle]: GUIDED_SETUP_PANEL_COPY.syncIdle,
  [GuidedSetupRunSync.Saving]: GUIDED_SETUP_PANEL_COPY.syncSaving,
  [GuidedSetupRunSync.Saved]: GUIDED_SETUP_PANEL_COPY.syncSaved,
  [GuidedSetupRunSync.NotSaved]: GUIDED_SETUP_PANEL_COPY.syncNotSaved,
};

const GuidedSetupResourcePanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const rows: Array<GuidedSetupResourceRow> = props.groups.flatMap(
    (group: GuidedSetupPanelGroup): Array<GuidedSetupResourceRow> => {
      return group.resources;
    },
  );
  const counts: { ready: number; total: number } = countReadyResources(rows);

  return (
    <aside
      data-testid={GUIDED_SETUP_PANEL_TEST_IDS.panel}
      aria-label={translator.translateText(GUIDED_SETUP_PANEL_COPY.title) || ""}
      className="lg:sticky lg:top-6 lg:self-start"
    >
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="bg-gradient-to-br from-indigo-50 via-white to-white px-5 pb-3 pt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 className="text-sm font-semibold text-gray-900">
              {translator.translateText(GUIDED_SETUP_PANEL_COPY.title)}
            </h2>
            {counts.total > 0 ? (
              <span
                className="text-xs font-medium text-gray-600"
                data-testid={GUIDED_SETUP_PANEL_TEST_IDS.ready}
              >
                {translator.translatePlural(
                  GUIDED_SETUP_PANEL_COPY.ready,
                  counts.ready,
                  { total: translator.formatNumber(counts.total) },
                )}
              </span>
            ) : (
              <></>
            )}
          </div>
          {counts.total > 0 ? (
            <p className="mt-0.5 text-xs text-gray-500">
              {translator.translateText(GUIDED_SETUP_PANEL_COPY.description)}
            </p>
          ) : (
            <></>
          )}
        </div>
        <ol className="space-y-1 px-5 pb-4 pt-2">
          {props.groups.map((group: GuidedSetupPanelGroup, index: number) => {
            return (
              <li
                key={group.stepKey}
                className="py-2"
                data-testid={`guided-setup-outcome-${group.stepKey}`}
                data-state={group.state}
                aria-current={
                  group.state === GuidedSetupStepState.Open ? "step" : undefined
                }
              >
                <div className="flex items-start gap-3">
                  <OutcomeMark state={group.state} number={index + 1} />
                  <span
                    className={`pt-0.5 text-sm ${
                      group.state === GuidedSetupStepState.Upcoming
                        ? "text-gray-500"
                        : "font-medium text-gray-900"
                    }`}
                    data-testid={`guided-setup-outcome-${group.stepKey}-text`}
                  >
                    {translator.translateText(group.outcome)}
                  </span>
                </div>
                {group.resources.length > 0 ? (
                  <ul className="mt-2.5 space-y-3 ps-9">
                    {group.resources.map((row: GuidedSetupResourceRow) => {
                      return <ResourceItem key={row.key} row={row} />;
                    })}
                  </ul>
                ) : (
                  <></>
                )}
              </li>
            );
          })}
        </ol>
        {props.sync || props.minutes ? (
          <div className="space-y-2 border-t border-gray-100 bg-gray-50 px-5 py-3">
            {props.sync ? (
              <div
                className="flex items-start gap-2 text-xs text-gray-600"
                data-testid={GUIDED_SETUP_PANEL_TEST_IDS.sync}
                data-sync={props.sync}
                aria-live="polite"
              >
                <Icon
                  icon={
                    props.sync === GuidedSetupRunSync.NotSaved
                      ? IconProp.Alert
                      : IconProp.Cloud
                  }
                  className={`mt-px h-3.5 w-3.5 flex-none ${
                    props.sync === GuidedSetupRunSync.NotSaved
                      ? "text-amber-600"
                      : "text-gray-500"
                  }`}
                />
                <div className="min-w-0">
                  <span>
                    {translator.translateText(SYNC_WORDS[props.sync])}
                  </span>
                  {props.sync === GuidedSetupRunSync.NotSaved &&
                  props.onRetrySync ? (
                    <div className="mt-1">
                      <Button
                        title={GUIDED_SETUP_PANEL_COPY.tryAgain}
                        buttonStyle={ButtonStyleType.LINK}
                        dataTestId={GUIDED_SETUP_PANEL_TEST_IDS.syncRetry}
                        onClick={() => {
                          props.onRetrySync?.();
                        }}
                      />
                    </div>
                  ) : (
                    <></>
                  )}
                </div>
              </div>
            ) : (
              <></>
            )}
            {/* A div, not a p: an Icon draws a div around its svg. */}
            {props.minutes ? (
              <div
                data-testid={GUIDED_SETUP_PANEL_TEST_IDS.minutes}
                className="flex items-center gap-2 text-xs text-gray-600"
              >
                <Icon icon={IconProp.Clock} className="h-3.5 w-3.5 flex-none" />
                <span>
                  {translator.translatePlural(
                    WELCOME_MINUTES_COPY.about,
                    props.minutes,
                  )}
                </span>
              </div>
            ) : (
              <></>
            )}
          </div>
        ) : (
          <></>
        )}
      </div>
    </aside>
  );
};

export default GuidedSetupResourcePanel;
