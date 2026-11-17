import RelativeTime from "../EpisodeView/RelativeTime";
import {
  getFireDrillFailureLabel,
  getFireDrillPolicyName,
} from "./FireDrillModal";
import OnCallTestPageApi from "./OnCallTestPageApi";
import {
  FIRE_DRILL_LAST_ACKNOWLEDGED,
  FIRE_DRILL_LAST_ACKNOWLEDGED_SO_FAR,
  FIRE_DRILL_LAST_WORDS,
  RESULT_STATUS_WORDS,
} from "./OnCallTestPageWords";
import { getAcknowledgedSentence } from "./TestPageResult";
import Color from "Common/Types/Color";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { OnCallFireDrillRecord } from "Common/Types/OnCallDutyPolicy/OnCallFireDrill";
import {
  OnCallTestPageResultSummary,
  OnCallTestPageStatus,
} from "Common/Types/OnCallDutyPolicy/OnCallTestPage";
import Icon from "Common/UI/Components/Icon/Icon";
import InlineSeparator from "Common/UI/Components/InlineSeparator/InlineSeparator";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useState,
} from "react";

/*
 * A MONITOR'S LAST FIRE DRILL (#9386, Common/Types/OnCallDutyPolicy/
 * OnCallFireDrill), on its When this goes down card, once the drill's
 * dialog is closed: the failure it rehearsed, when and by whom, and how
 * many of its tests were acknowledged - and, folded until wanted, each
 * policy's: acknowledged or not, by whom, by what and how fast.
 *
 * Only the last drill: the line the card has room for. Each one before it
 * stays in its policies' execution logs, each test marked as part of a fire
 * drill of the monitor. Nothing is drawn while there is none the reader may
 * read (the server's rule, OnCallFireDrillHistoryService), or while it is
 * read: the line comes in at the card's end, below everything else on it,
 * so nothing it says moves. A drill whose tests still wait for somebody is
 * read again every little while, until each is over.
 */

export const LAST_FIRE_DRILL_POLL_INTERVAL_IN_MS: number = 15 * 1000;

/*
 * How long past its tests' answer window a drill is still read again: its
 * last runs end on the worker's next tick.
 */
const POLL_GRACE_IN_MS: number = 2 * 60 * 1000;

export interface ComponentProps {
  monitorId: string;
  // Changes when the card is read again, or a drill starts or its dialog closes.
  refreshToken?: number | string | undefined;
  // For tests: how often a drill still running is read again.
  pollIntervalInMs?: number | undefined;
}

// Whether a test of the drill still waits for somebody.
export function isLastFireDrillRunning(
  drill: Pick<OnCallFireDrillRecord, "runs">,
): boolean {
  return drill.runs.some((run: OnCallTestPageResultSummary): boolean => {
    return run.status === OnCallTestPageStatus.Paging;
  });
}

// The failure it rehearsed, as the drill's dialog named it.
export function getLastFireDrillFailure(
  translator: Translator,
  drill: Pick<OnCallFireDrillRecord, "failure">,
): string {
  return getFireDrillFailureLabel(translator, {
    criteriaName: drill.failure.criteriaName,
    recordKind: drill.failure.recordKind,
    severityName: drill.failure.severityName,
    declaredBy:
      typeof drill.failure.declaredAfterMinutes === "number"
        ? { waitInMinutes: drill.failure.declaredAfterMinutes }
        : undefined,
  });
}

/*
 * "1 of 2 tests acknowledged.", "... so far." while one still waits: how
 * many of its policies' tests somebody acknowledged, the second count in
 * the reader's digits too.
 */
export function getLastFireDrillOutcome(
  translator: Translator,
  drill: Pick<OnCallFireDrillRecord, "runs">,
): string {
  const acknowledged: number = drill.runs.filter(
    (run: OnCallTestPageResultSummary): boolean => {
      return run.status === OnCallTestPageStatus.Acknowledged;
    },
  ).length;

  return translator.translatePlural(
    isLastFireDrillRunning(drill)
      ? FIRE_DRILL_LAST_ACKNOWLEDGED_SO_FAR
      : FIRE_DRILL_LAST_ACKNOWLEDGED,
    drill.runs.length,
    { acknowledged: translator.formatNumber(acknowledged) },
  );
}

// Whether the drill is still worth reading again: running, and not long over.
function isWorthReadingAgain(drill: OnCallFireDrillRecord): boolean {
  if (!isLastFireDrillRunning(drill)) {
    return false;
  }

  const endsAt: number = Math.max(
    ...drill.runs.map((run: OnCallTestPageResultSummary): number => {
      return new Date(run.endsAt).getTime() || 0;
    }),
  );

  return OneUptimeDate.getCurrentDate().getTime() < endsAt + POLL_GRACE_IN_MS;
}

// One policy's test: its name, how it stands, and who acknowledged it.
const LastFireDrillRun: FunctionComponent<{
  run: OnCallTestPageResultSummary;
}> = (props: { run: OnCallTestPageResultSummary }): ReactElement => {
  const translator: Translator = useTranslator();
  const run: OnCallTestPageResultSummary = props.run;
  const status: { title: string; color: Color } =
    RESULT_STATUS_WORDS[run.status];

  return (
    <li
      className="flex flex-col gap-0.5 py-2"
      data-testid="last-fire-drill-result"
      data-status={run.status}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className="text-sm font-medium text-gray-900 break-words"
          data-testid="last-fire-drill-policy"
        >
          {getFireDrillPolicyName(translator, {
            policyName: run.policyName || "",
          })}
        </span>
        <Pill text={status.title} color={status.color} size={PillSize.Small} />
      </div>
      {run.status === OnCallTestPageStatus.Acknowledged ? (
        <p
          className="text-sm text-gray-600 break-words"
          data-testid="last-fire-drill-acknowledged"
        >
          {getAcknowledgedSentence(translator, run)}
        </p>
      ) : (
        <></>
      )}
    </li>
  );
};

const LastFireDrill: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [drill, setDrill] = useState<OnCallFireDrillRecord | null>(null);
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const titleId: string = useId();
  const pollIntervalInMs: number =
    props.pollIntervalInMs || LAST_FIRE_DRILL_POLL_INTERVAL_IN_MS;

  useEffect(() => {
    let isActive: boolean = true;
    let timer: ReturnType<typeof setTimeout> | undefined = undefined;

    const read: () => Promise<void> = async (): Promise<void> => {
      let next: OnCallFireDrillRecord | null;

      try {
        next = await OnCallTestPageApi.lastFireDrill(props.monitorId);
      } catch {
        /*
         * A drill that can't be read says nothing: the card's answer above
         * it stands on its own, and what was shown stays.
         */
        return;
      }

      if (!isActive) {
        return;
      }

      setDrill(next);

      if (next && isWorthReadingAgain(next)) {
        timer = setTimeout(() => {
          void read();
        }, pollIntervalInMs);
      }
    };

    void read();

    return () => {
      isActive = false;

      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [props.monitorId, props.refreshToken, pollIntervalInMs]);

  if (!drill || drill.runs.length === 0) {
    return <></>;
  }

  return (
    <section
      className="mt-3 border-t border-gray-100 pt-3"
      aria-labelledby={titleId}
      data-testid="last-fire-drill"
    >
      <h4 id={titleId} className="text-sm font-medium text-gray-900">
        {translator.translateText(FIRE_DRILL_LAST_WORDS.title)}
      </h4>
      {/*
       * Two facts, set apart: the failure it rehearsed, as the drill's
       * dialog named it, and when it was started and by whom.
       */}
      <p
        className="mt-0.5 text-sm text-gray-600 break-words"
        data-testid="last-fire-drill-ran"
      >
        <span data-testid="last-fire-drill-failure">
          {getLastFireDrillFailure(translator, drill)}
        </span>
        <InlineSeparator />
        <span data-testid="last-fire-drill-started">
          <TranslatedSentence
            template={
              drill.startedByName
                ? FIRE_DRILL_LAST_WORDS.startedBy
                : FIRE_DRILL_LAST_WORDS.started
            }
            slots={{
              time: (
                <RelativeTime
                  date={OneUptimeDate.fromString(drill.startedAt)}
                />
              ),
            }}
            values={drill.startedByName ? { name: drill.startedByName } : {}}
          />
        </span>
      </p>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <p
          className="text-sm text-gray-900"
          data-testid="last-fire-drill-outcome"
        >
          {getLastFireDrillOutcome(translator, drill)}
        </p>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-sm font-medium text-indigo-700 hover:underline"
          aria-expanded={isOpen}
          data-testid="last-fire-drill-toggle"
          onClick={() => {
            setIsOpen(!isOpen);
          }}
        >
          <Icon
            icon={isOpen ? IconProp.ChevronDown : IconProp.ChevronRight}
            className="h-4 w-4"
          />
          {isOpen
            ? translator.translateText("Hide details")
            : translator.translateText("Show details")}
        </button>
      </div>
      {isOpen ? (
        <div data-testid="last-fire-drill-details">
          <ul className="mt-1 divide-y divide-gray-100">
            {drill.runs.map((run: OnCallTestPageResultSummary) => {
              return <LastFireDrillRun key={run.executionLogId} run={run} />;
            })}
          </ul>
          {drill.walksEscalation ? (
            <p
              className="mt-1 text-xs text-gray-500"
              data-testid="last-fire-drill-walked"
            >
              {translator.translateText(FIRE_DRILL_LAST_WORDS.walked)}
            </p>
          ) : (
            <></>
          )}
        </div>
      ) : (
        <></>
      )}
    </section>
  );
};

export default LastFireDrill;
