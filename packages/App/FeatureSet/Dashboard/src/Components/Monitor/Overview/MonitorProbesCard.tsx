import PageMap from "../../../Utils/PageMap";
import { OverviewSection } from "../../../Utils/OverviewSection";
import RelativeTime from "../../EpisodeView/RelativeTime";
import SloOverviewActionLink from "../../Slo/SloOverviewActionLink";
import { getMonitorPageRoute } from "./MonitorOverviewLinks";
import { PROBE_HEALTH_TEXT_CLASS } from "./MonitorOverviewTones";
import { MonitorOverviewProbeData } from "./MonitorOverviewTypes";
import Probe from "Common/Models/DatabaseModels/Probe";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import IsolatedLine from "Common/UI/Components/IsolatedText/IsolatedLine";
import ProbeElement from "Common/UI/Components/Probe/Probe";
import {
  MonitorOverviewProbeHealth,
  MonitorOverviewProbeRow,
  MonitorOverviewProbeSummary,
} from "Common/Utils/Monitor/MonitorOverviewProbeUtil";
import React, { FunctionComponent, ReactElement } from "react";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import {
  formatInline,
  getInlineSeparator,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import ErrorSentence from "Common/UI/Components/ErrorMessage/ErrorSentence";
import { getProbeFailureCauseText } from "Common/Utils/Monitor/ProbeFailureReading";
import { formatMilliseconds } from "../../../Utils/Milliseconds";

export interface ComponentProps {
  monitorId: ObjectID;
  probes: OverviewSection<MonitorOverviewProbeData>;
  // Null when the probes could not be read.
  summary: MonitorOverviewProbeSummary | null;
  /*
   * The moment the summary was judged at (the presentation input's now, on
   * the server's clock). Whether a probe's next check is still ahead is
   * decided against it, never the browser's clock, so the card and the
   * hero cannot disagree about it.
   */
  now: Date;
  minimumProbeAgreement?: number | undefined;
}

/*
 * What each probe's state is called on the right of its row. Up, Down,
 * Late and the rest are the words the overview's hero already says, so the
 * card and the hero name a state alike in every language.
 */
export const PROBE_HEALTH_WORDS: Record<MonitorOverviewProbeHealth, string> = {
  [MonitorOverviewProbeHealth.Up]: translationKey("Up"),
  [MonitorOverviewProbeHealth.Down]: translationKey("Down"),
  [MonitorOverviewProbeHealth.Disconnected]: translationKey("Disconnected"),
  [MonitorOverviewProbeHealth.Late]: translationKey("Late"),
  [MonitorOverviewProbeHealth.NoResultYet]: translationKey("No result yet"),
  [MonitorOverviewProbeHealth.TurnedOff]: translationKey(
    "Turned off for this monitor",
  ),
  [MonitorOverviewProbeHealth.Reported]: translationKey("Reported"),
};

/*
 * The facts on the right of a probe row, in the reader's language: the
 * state, and for a probe that is up its latest response time, written as
 * every monitor summary writes a duration (formatMilliseconds: "182 ms",
 * "۱۸۲ میلی‌ثانیه").
 */
export const getProbeHealthParts: (
  row: MonitorOverviewProbeRow,
  translator: Translator,
) => Array<string> = (
  row: MonitorOverviewProbeRow,
  translator: Translator,
): Array<string> => {
  const state: string = translator.translateTemplate(
    PROBE_HEALTH_WORDS[row.health] ||
      PROBE_HEALTH_WORDS[MonitorOverviewProbeHealth.Reported],
  );
  const responseTimeInMs: number | undefined =
    row.health === MonitorOverviewProbeHealth.Up
      ? row.latestResult?.responseTimeInMs
      : undefined;

  if (responseTimeInMs === undefined) {
    return [state];
  }

  return [
    state,
    formatMilliseconds(translator, responseTimeInMs, {
      maximumFractionDigits: 0,
    }),
  ];
};

/*
 * The words on the right of a probe row, as one line: the facts set apart
 * as the reader's language sets two facts on one line (formatInline: "Up ·
 * 182 ms", "فعال • ۱۸۲ میلی‌ثانیه").
 */
export const getProbeHealthText: (
  row: MonitorOverviewProbeRow,
  translator: Translator,
) => string = (
  row: MonitorOverviewProbeRow,
  translator: Translator,
): string => {
  return formatInline(getProbeHealthParts(row, translator), translator);
};

/*
 * A PROBE'S ROW, LAID OUT FOR THE WIDTH THE CARD HAS.
 *
 * The Probes card sits in a third of the overview at 1280px (a body about
 * 14rem wide) and full width on a phone. Its state used to sit beside the
 * probe's name, kept on one line, so a long one - "Turned off for this
 * monitor", "Für diesen Monitor ausgeschaltet", a Persian time with its
 * unit ("فعال • ۱٬۱۸۳ میلی‌ثانیه") - squeezed the name to a letter a line
 * ("At" / "tic" / "R" / "as..."), and even "Up · 182 ms" broke
 * "Frankfurt (eu-" / "central-1)".
 *
 * So the list is a container: in a card narrower than 22rem (the width a
 * monitor summary's facts go side by side from, SummaryFacts) the state is
 * a line of its own under the name, which keeps the whole row; from 22rem
 * it sits beside the name, at the row's end, as wide as at most 10rem
 * (longer states wrap at their words). Either way, when the check was made
 * and why it failed run under both, the full width of the row.
 */
export const PROBE_ROWS_CLASS_NAME: string =
  "[container-type:inline-size] divide-y divide-gray-100";

export const PROBE_ROW_CLASS_NAME: string =
  "grid grid-cols-1 items-start gap-x-3 py-2.5 [@container(min-width:22rem)]:grid-cols-[minmax(0,1fr)_auto]";

export const PROBE_HEALTH_CLASS_NAME: string =
  "mt-1 text-xs font-medium [@container(min-width:22rem)]:mt-0 [@container(min-width:22rem)]:max-w-[10rem] [@container(min-width:22rem)]:text-right";

export const PROBE_ROW_DETAILS_CLASS_NAME: string =
  "min-w-0 [@container(min-width:22rem)]:col-span-2";

/*
 * A duration is one figure with its unit: when the state wraps, it moves
 * to the next line whole ("Up ·" / "1,183 ms"), never "1,183" / "ms".
 */
export const PROBE_HEALTH_FIGURE_CLASS_NAME: string = "whitespace-nowrap";

/*
 * The probe agreement rule, worked out the way the server applies it
 * (MonitorResourceUtil.checkProbeAgreement): only enabled, connected probes
 * take part, an unset minimum means all of them must agree, and the minimum
 * is capped at how many take part. So 3 required with one of three probes
 * disconnected is 2 of 2, never "3 of 2". A probe whose connection is not
 * known counts as connected, as it does everywhere else on this card.
 * Null when no agreement is needed: one probe, or a minimum of one. Its
 * counts are written in the reader's digits ("۲ از ۳ پراب متصل").
 */
export const getProbeAgreementText: (data: {
  rows: Array<MonitorOverviewProbeRow>;
  minimumProbeAgreement: number | null | undefined;
  translator: Translator;
}) => string | null = (data: {
  rows: Array<MonitorOverviewProbeRow>;
  minimumProbeAgreement: number | null | undefined;
  translator: Translator;
}): string | null => {
  const translator: Translator = data.translator;
  const activeCount: number = data.rows.filter(
    (row: MonitorOverviewProbeRow) => {
      return row.isEnabled && row.isConnected !== false;
    },
  ).length;

  const minimum: number | null | undefined = data.minimumProbeAgreement;
  const requiredCount: number = Math.min(
    typeof minimum === "number" && Number.isFinite(minimum)
      ? minimum
      : activeCount,
    activeCount,
  );

  if (activeCount < 2 || requiredCount < 2) {
    return null;
  }

  if (requiredCount < activeCount) {
    return translator.translateTemplate(
      "A status change needs {{required}} of {{count}} connected probes to agree.",
      {
        required: translator.formatNumber(requiredCount),
        count: translator.formatNumber(activeCount),
      },
    );
  }

  return activeCount === 2
    ? translator.translateTemplate(
        "A status change needs both connected probes to agree.",
      )
    : translator.translateTemplate(
        "A status change needs all {{count}} connected probes to agree.",
        { count: translator.formatNumber(activeCount) },
      );
};

const toProbeModel: (row: MonitorOverviewProbeRow) => Probe = (
  row: MonitorOverviewProbeRow,
): Probe => {
  const probe: Probe = new Probe();
  probe._id = row.probeId;
  probe.name = row.name;

  if (row.iconFileId) {
    probe.iconFileId = new ObjectID(row.iconFileId);
  }

  return probe;
};

/*
 * Where this monitor is checked from, one row per attached probe, with the
 * ones that need attention first: down, disconnected, late, then those that
 * have not reported, then the healthy ones, and the switched-off ones last.
 * "Checked" is when the probe's last result reached the server, not when it
 * claimed the job.
 */
const MonitorProbesCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const probesRoute: Route = getMonitorPageRoute({
    pageMap: PageMap.MONITOR_VIEW_PROBES,
    monitorId: props.monitorId,
  });

  type GetRowFunction = (
    row: MonitorOverviewProbeRow,
    now: Date,
  ) => ReactElement;

  const getRow: GetRowFunction = (
    row: MonitorOverviewProbeRow,
    now: Date,
  ): ReactElement => {
    const monitoredAt: Date | undefined = row.latestResult?.monitoredAt;
    const isNextInFuture: boolean = Boolean(
      row.isEnabled &&
        row.nextPingAt &&
        row.nextPingAt.getTime() > now.getTime(),
    );
    /*
     * Why a down probe's check failed, as every monitor summary draws it:
     * the probe's own timeout sentence in the reader's words and digits,
     * any other message as the probe wrote it (getProbeFailureCauseText).
     */
    const failureCause: string | undefined =
      row.health === MonitorOverviewProbeHealth.Down &&
      row.latestResult?.failureCause
        ? getProbeFailureCauseText({
            translator: translator,
            failureCause: row.latestResult.failureCause,
          }) || undefined
        : undefined;
    const healthParts: Array<string> = getProbeHealthParts(row, translator);

    return (
      <li
        key={row.probeId}
        data-testid="monitor-probe-row"
        className={PROBE_ROW_CLASS_NAME}
      >
        <div className="min-w-0">
          <ProbeElement probe={toProbeModel(row)} />
        </div>
        <span
          data-testid="monitor-probe-health"
          className={`${PROBE_HEALTH_CLASS_NAME} ${
            PROBE_HEALTH_TEXT_CLASS[row.health]
          }`}
        >
          {healthParts.map((part: string, index: number): ReactElement => {
            return index === 0 ? (
              <React.Fragment key={index}>{part}</React.Fragment>
            ) : (
              <React.Fragment key={index}>
                {getInlineSeparator(translator.language)}
                <span className={PROBE_HEALTH_FIGURE_CLASS_NAME}>{part}</span>
              </React.Fragment>
            );
          })}
        </span>
        <div
          className={PROBE_ROW_DETAILS_CLASS_NAME}
          data-testid="monitor-probe-details"
        >
          {/*
           * When the check was made. A probe that has sent nothing says "No
           * result yet" once, as its state, not a second time on the line
           * under it: with a check ahead that line only says when it is due.
           */}
          {!monitoredAt &&
          !(isNextInFuture && row.nextPingAt) &&
          row.health === MonitorOverviewProbeHealth.NoResultYet ? (
            <></>
          ) : (
            <p className="mt-1 text-xs text-gray-500">
              {monitoredAt && isNextInFuture && row.nextPingAt ? (
                <TranslatedSentence
                  template="Checked {{time}} · next {{next}}"
                  slots={{
                    time: <RelativeTime date={monitoredAt} />,
                    next: <RelativeTime date={row.nextPingAt} />,
                  }}
                />
              ) : monitoredAt ? (
                <TranslatedSentence
                  template="Checked {{time}}"
                  slots={{ time: <RelativeTime date={monitoredAt} /> }}
                />
              ) : isNextInFuture &&
                row.nextPingAt &&
                row.health === MonitorOverviewProbeHealth.NoResultYet ? (
                <TranslatedSentence
                  template="Next check {{next}}"
                  slots={{ next: <RelativeTime date={row.nextPingAt} /> }}
                />
              ) : isNextInFuture && row.nextPingAt ? (
                <TranslatedSentence
                  template="No result yet · next {{next}}"
                  slots={{ next: <RelativeTime date={row.nextPingAt} /> }}
                />
              ) : (
                <>{translator.translateText("No result yet")}</>
              )}
            </p>
          )}
          {/*
           * A message the probe wrote in English is drawn the way its words
           * read, so on an Arabic or Persian page it starts at its start
           * and keeps its full stop at its end; the worded timeout sentence
           * reads as the page does.
           */}
          {failureCause ? (
            <IsolatedLine
              as="p"
              className="mt-0.5 line-clamp-2 break-words text-xs text-gray-500"
              title={failureCause}
              text={failureCause}
              dataTestId="monitor-probe-failure-cause"
            />
          ) : (
            <></>
          )}
        </div>
      </li>
    );
  };

  type GetBodyFunction = () => ReactElement;

  const getBody: GetBodyFunction = (): ReactElement => {
    if (!props.probes.value) {
      if (props.probes.status === "forbidden") {
        return (
          <p className="text-sm text-gray-500">
            {translator.translateText(
              "Probes are hidden: you need permission to read this monitor's probes.",
            )}
          </p>
        );
      }

      if (props.probes.status === "error") {
        return (
          <p className="text-sm text-red-700">
            <ErrorSentence
              template="Couldn't load probes. {{error}}"
              error={props.probes.error || ""}
            />
          </p>
        );
      }

      return (
        <div
          role="status"
          aria-label={translator.translateText("Loading probes")}
          className="space-y-2 animate-pulse"
        >
          <div className="h-4 w-5/6 rounded bg-gray-100"></div>
          <div className="h-4 w-2/3 rounded bg-gray-100"></div>
        </div>
      );
    }

    const rows: Array<MonitorOverviewProbeRow> = props.summary?.rows || [];

    if (rows.length === 0) {
      return (
        <div className="text-sm text-gray-500">
          <p>{translator.translateText("No probes attached.")}</p>
          <div className="mt-2">
            <SloOverviewActionLink
              variant="text"
              title="Add a probe"
              to={probesRoute}
            />
          </div>
        </div>
      );
    }

    const now: Date = props.now;
    const agreementText: string | null = getProbeAgreementText({
      rows: rows,
      minimumProbeAgreement: props.minimumProbeAgreement,
      translator: translator,
    });

    return (
      <div>
        <ul
          aria-label={translator.translateText("Probes")}
          className={PROBE_ROWS_CLASS_NAME}
        >
          {rows.map((row: MonitorOverviewProbeRow) => {
            return getRow(row, now);
          })}
        </ul>
        {agreementText ? (
          <p
            data-testid="monitor-probe-agreement"
            className="mt-3 border-t border-gray-100 pt-3 text-xs text-gray-500"
          >
            {agreementText}
          </p>
        ) : (
          <></>
        )}
        {props.probes.refreshError ? (
          <p className="mt-2 text-xs text-gray-500">
            <ErrorSentence
              template="Couldn't refresh probes. {{error}}"
              error={props.probes.refreshError || ""}
            />
          </p>
        ) : (
          <></>
        )}
      </div>
    );
  };

  return (
    <Card
      title="Probes"
      description="Where this monitor is checked from."
      headerLayout="stacked"
      rightElement={
        <SloOverviewActionLink variant="text" title="Manage" to={probesRoute} />
      }
    >
      {getBody()}
    </Card>
  );
};

export default MonitorProbesCard;
