import { FeedStatus } from "./CalendarFeedTypes";
import {
  CALENDAR_FEED_DOCS_PATH,
  DISABLED_FEED_COPY,
  FEED_HEALTH_LABELS,
  FeedHealth,
  NOTHING_FETCHED_COPY,
  REACHABILITY_COPY,
  REFRESH_CADENCE_COPY,
  WAITING_FOR_FIRST_SYNC_COPY,
  getFeedClientName,
  getFeedHealth,
  getRotatedDaysAgo,
  isFetchedByGoogleCalendar,
} from "./CalendarFeedUtil";
import { FEED_SECTION_HEADING_CLASS_NAME } from "../CalendarFeedLinks";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import {
  FeedClock,
  formatFeedDay,
  formatFeedFullTime,
  formatFeedTimeAgo,
  getFeedClock,
} from "Common/UI/Components/Feed/FeedTime";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import { BILLING_ENABLED, DOCS_URL } from "Common/UI/Config";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Is the link working? The answer a reader comes back to the page for,
 * beside the subscribe options rather than under them in grey.
 *
 *   - A pill names the state (FeedHealth): Active, Waiting for first sync,
 *     Not fetched yet, Disabled, Needs regeneration.
 *   - One sentence says what it means: when the link was last read and by
 *     which app, in the reader's own language and words ("7 minutes ago"),
 *     or what is wrong and what to do.
 *   - The bookkeeping follows in grey: roughly how often it has been read,
 *     which link it is (the last four characters, never more) and, for a
 *     shared link, how long ago it was minted.
 *   - The state's one next step sits in the panel when it has one: Enable
 *     link on a disabled link, Regenerate link on one that cannot be read.
 *   - Google Calendar's slow refresh is said where it matters - to a reader
 *     whose link Google reads - instead of to everyone, always.
 *
 * The fetch count is prefixed with "~" on purpose. The server keeps it with a
 * read-modify-write it does not lock, and only stamps a fetch every five
 * minutes, so it is an order of magnitude, not a ledger.
 */
export interface ComponentProps {
  status: FeedStatus;
  // Injected by tests; the page passes nothing and gets the real clock.
  now?: Date | undefined;
  // "Last rotated N days ago" is for shared links, whose readers did not mint them.
  showRotatedAgo?: boolean | undefined;
  // What the rotated-out link does until {{date}}: personal or shared wording.
  previousLinkCopy: string;
  // Why the link cannot be shown: "until you regenerate it" or "an editor".
  needsRegenerationCopy: string;
  // The disabled state's next step; left out where the reader may not take it.
  onEnable?: (() => void) | undefined;
  // The unreadable state's next step; left out where the reader may not take it.
  onRegenerate?: (() => void) | undefined;
  isBusy?: boolean | undefined;
  // Prefix for the data-testids, so two panels on one page stay distinct.
  idPrefix: string;
}

interface HealthTone {
  pill: string;
  dot: string;
}

/*
 * The pill's colours per state, all classes Theme.css remaps for the dark
 * theme (the dots are mid-tone hues, which read the same in both).
 */
export const FEED_HEALTH_TONES: Record<FeedHealth, HealthTone> = {
  [FeedHealth.Active]: {
    pill: "bg-green-50 text-green-700 ring-green-200",
    dot: "bg-green-500",
  },
  [FeedHealth.WaitingForFirstSync]: {
    pill: "bg-blue-50 text-blue-700 ring-blue-200",
    dot: "bg-blue-500",
  },
  [FeedHealth.NotFetched]: {
    pill: "bg-amber-50 text-amber-800 ring-amber-200",
    dot: "bg-amber-500",
  },
  [FeedHealth.Disabled]: {
    pill: "bg-amber-50 text-amber-800 ring-amber-200",
    dot: "bg-amber-500",
  },
  [FeedHealth.NeedsRegeneration]: {
    pill: "bg-red-50 text-red-700 ring-red-200",
    dot: "bg-red-500",
  },
};

export interface FeedHealthPillProps {
  health: FeedHealth;
  idPrefix: string;
}

export const FeedHealthPill: FunctionComponent<FeedHealthPillProps> = (
  props: FeedHealthPillProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const tone: HealthTone = FEED_HEALTH_TONES[props.health];

  return (
    <span
      className={`inline-flex flex-none items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${tone.pill}`}
      data-testid={`${props.idPrefix}-status-pill`}
      data-health={props.health}
    >
      <span
        className={`h-1.5 w-1.5 flex-none rounded-full ${tone.dot}`}
        aria-hidden="true"
      ></span>
      {translator.translateText(FEED_HEALTH_LABELS[props.health])}
    </span>
  );
};

const FeedStatusPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const status: FeedStatus = props.status;
  const now: Date = props.now || OneUptimeDate.getCurrentDate();
  const clock: FeedClock = getFeedClock({
    language: translator.language,
    now: now,
  });
  const health: FeedHealth = getFeedHealth(status, now);
  const headingId: string = `${props.idPrefix}-status-heading`;

  const fetchedAt: Date | null = status.lastFetchedAt
    ? OneUptimeDate.fromString(status.lastFetchedAt)
    : null;
  const hasFetchTime: boolean = Boolean(
    fetchedAt && !Number.isNaN(fetchedAt.getTime()),
  );

  /*
   * "Last fetched 7 minutes ago by Google Calendar": one whole sentence per
   * shape, with {{placeholders}} a translator can move, and the distance in
   * the reader's language (FeedTime), never moment's English.
   */
  const lastFetchedSentence: string | null =
    fetchedAt && hasFetchTime
      ? ((): string => {
          const when: string =
            formatFeedTimeAgo(fetchedAt, clock) ||
            OneUptimeDate.fromNow(fetchedAt);
          const client: string | null = getFeedClientName(
            status.lastFetchedClient,
          );

          return client
            ? translator.translateTemplate(
                "Last fetched {{when}} by {{client}}",
                {
                  when: when,
                  client: translator.translateText(client) || client,
                },
              )
            : translator.translateTemplate("Last fetched {{when}}", {
                when: when,
              });
        })()
      : null;

  const fullFetchTime: string | undefined =
    fetchedAt && hasFetchTime
      ? formatFeedFullTime(fetchedAt, clock)
      : undefined;

  let headline: string;
  let headlineTestId: string = `${props.idPrefix}-status-headline`;

  if (health === FeedHealth.NeedsRegeneration) {
    headline = translator.translateText(props.needsRegenerationCopy) || "";
    headlineTestId = `${props.idPrefix}-needs-regeneration`;
  } else if (health === FeedHealth.Disabled) {
    headline = translator.translateText(DISABLED_FEED_COPY) || "";
    headlineTestId = `${props.idPrefix}-disabled`;
  } else if (health === FeedHealth.NotFetched) {
    headline = translator.translateText(NOTHING_FETCHED_COPY) || "";
    headlineTestId = `${props.idPrefix}-nothing-fetched-hint`;
  } else if (health === FeedHealth.WaitingForFirstSync) {
    headline = translator.translateText(WAITING_FOR_FIRST_SYNC_COPY) || "";
  } else {
    headline = lastFetchedSentence || "";
  }

  /*
   * When the sentence explains a problem, the last fetch gets a line of its
   * own under it, so it is never lost.
   */
  const lastFetchedDetail: string | null =
    health !== FeedHealth.Active ? lastFetchedSentence : null;

  // The bookkeeping, in grey: how often, which link, and how old.
  const details: Array<string> = [];

  if (status.fetchCount > 0) {
    details.push(
      translator.translateTemplate(
        status.fetchCount === 1 ? "~{{count}} fetch" : "~{{count}} fetches",
        { count: translator.formatNumber(status.fetchCount) },
      ),
    );
  }

  if (status.tokenHint) {
    details.push(
      translator.translateTemplate("link ending in …{{hint}}", {
        hint: status.tokenHint,
      }),
    );
  }

  const rotatedDaysAgo: number | null = props.showRotatedAgo
    ? getRotatedDaysAgo(status.rotatedAt, now)
    : null;

  if (rotatedDaysAgo !== null) {
    details.push(
      rotatedDaysAgo === 0
        ? translator.translateText("Last rotated today") || ""
        : translator.translateTemplate(
            rotatedDaysAgo === 1
              ? "Last rotated {{count}} day ago"
              : "Last rotated {{count}} days ago",
            { count: rotatedDaysAgo },
          ),
    );
  }

  /*
   * Google Calendar's schedule, to the readers it concerns: whose link it
   * reads. Before any app has read the link, the waiting sentence names
   * Google's delay instead.
   */
  const showsGoogleRefreshNote: boolean =
    health === FeedHealth.Active && isFetchedByGoogleCalendar(status);

  /*
   * OneUptime Cloud is always reachable from the internet, so this only earns
   * its place on a self-hosted install, while no app has read the link yet -
   * and not even then when a warning above already says this server cannot
   * be reached.
   */
  const showsReachability: boolean =
    !BILLING_ENABLED &&
    !status.hostWarning &&
    !status.privateHost &&
    (health === FeedHealth.WaitingForFirstSync ||
      health === FeedHealth.NotFetched);

  const previousLinkLine: string | null = status.previousTokenExpiresAt
    ? ((): string | null => {
        const expiresAt: Date = OneUptimeDate.fromString(
          status.previousTokenExpiresAt as string,
        );

        if (Number.isNaN(expiresAt.getTime())) {
          return null;
        }

        return translator.translateTemplate(props.previousLinkCopy, {
          date: formatFeedDay(expiresAt, clock),
        });
      })()
    : null;

  const docsUrl: URL = URL.fromString(DOCS_URL.toString()).addRoute(
    CALENDAR_FEED_DOCS_PATH,
  );

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-lg border border-gray-200 bg-gray-50 p-4 sm:p-5"
      data-testid={`${props.idPrefix}-status`}
      data-health={health}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={headingId} className={FEED_SECTION_HEADING_CLASS_NAME}>
          {translator.translateText("Status")}
        </h3>
        <FeedHealthPill health={health} idPrefix={props.idPrefix} />
      </div>

      <div className="mt-3 space-y-1" role="status" aria-live="polite">
        {/*
         * The last fetch is the news, so it is said in full weight; a
         * sentence that explains a state reads as prose beside the pill
         * that already names it.
         */}
        <p
          className={
            health === FeedHealth.Active
              ? "text-sm font-medium leading-6 text-gray-900"
              : "text-sm leading-6 text-gray-700"
          }
          data-testid={headlineTestId}
          title={health === FeedHealth.Active ? fullFetchTime : undefined}
        >
          {headline}
        </p>
        {lastFetchedDetail && (
          <p
            className="text-sm leading-6 text-gray-500"
            data-testid={`${props.idPrefix}-last-fetched`}
            title={fullFetchTime}
          >
            {lastFetchedDetail}
          </p>
        )}
        {details.length > 0 && (
          <p
            className="text-sm leading-6 text-gray-500"
            data-testid={`${props.idPrefix}-status-line`}
          >
            {details.map((detail: string, index: number): ReactElement => {
              /*
               * Each segment keeps its separator at its own end and never
               * breaks inside itself, so a line that wraps does so between
               * segments and no line starts with a "·".
               */
              return (
                <React.Fragment key={index}>
                  {index > 0 ? " " : ""}
                  <span className="whitespace-nowrap">
                    {detail}
                    {index < details.length - 1 ? " ·" : ""}
                  </span>
                </React.Fragment>
              );
            })}
          </p>
        )}
      </div>

      {health === FeedHealth.Disabled && props.onEnable && (
        <div className="mt-4">
          <Button
            title="Enable link"
            icon={IconProp.Bell}
            buttonStyle={ButtonStyleType.PRIMARY}
            buttonSize={ButtonSize.Small}
            isLoading={props.isBusy}
            disabled={props.isBusy}
            dataTestId={`${props.idPrefix}-enable`}
            className="md:!ml-0"
            onClick={() => {
              props.onEnable?.();
            }}
          />
        </div>
      )}

      {health === FeedHealth.NeedsRegeneration && props.onRegenerate && (
        <div className="mt-4">
          <Button
            title="Regenerate link"
            icon={IconProp.Refresh}
            buttonStyle={ButtonStyleType.PRIMARY}
            buttonSize={ButtonSize.Small}
            disabled={props.isBusy}
            dataTestId={`${props.idPrefix}-regenerate-now`}
            className="md:!ml-0"
            onClick={() => {
              props.onRegenerate?.();
            }}
          />
        </div>
      )}

      {(showsGoogleRefreshNote || showsReachability || previousLinkLine) && (
        <div className="mt-4 space-y-2 border-t border-gray-200 pt-4">
          {showsGoogleRefreshNote && (
            <div
              className="flex gap-2 text-sm leading-6 text-gray-500"
              data-testid={`${props.idPrefix}-google-refresh-note`}
            >
              <Icon
                icon={IconProp.Info}
                className="mt-1 h-4 w-4 flex-none text-gray-400"
              />
              <p>{translator.translateText(REFRESH_CADENCE_COPY)}</p>
            </div>
          )}
          {showsReachability && (
            <div
              className="flex gap-2 text-sm leading-6 text-gray-500"
              data-testid={`${props.idPrefix}-reachability`}
            >
              <Icon
                icon={IconProp.Globe}
                className="mt-1 h-4 w-4 flex-none text-gray-400"
              />
              <p>{translator.translateText(REACHABILITY_COPY)}</p>
            </div>
          )}
          {previousLinkLine && (
            <div
              className="flex gap-2 text-sm leading-6 text-gray-500"
              data-testid={`${props.idPrefix}-previous-link`}
            >
              <Icon
                icon={IconProp.Clock}
                className="mt-1 h-4 w-4 flex-none text-gray-400"
              />
              <p>{previousLinkLine}</p>
            </div>
          )}
        </div>
      )}

      <div className="mt-4" data-testid={`${props.idPrefix}-docs-link`}>
        <Link
          to={docsUrl}
          openInNewTab={true}
          className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline"
        >
          <span>
            {translator.translateText("Troubleshooting and per-app steps")}
          </span>
          <Icon
            icon={IconProp.ExternalLink}
            className="h-3.5 w-3.5 flex-none"
          />
        </Link>
      </div>
    </section>
  );
};

export default FeedStatusPanel;
