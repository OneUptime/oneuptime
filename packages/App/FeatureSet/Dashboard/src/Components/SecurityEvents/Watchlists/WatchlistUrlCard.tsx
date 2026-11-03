import {
  IMPORT_PREVIEW_PROBLEMS,
  URL_CARD_DESCRIPTION,
  URL_CARD_TITLE,
  URL_KEEPS_VALUES_FROM,
  URL_LAST_READ,
  URL_LAST_READ_FAILED,
  URL_NEXT_READ,
  URL_NO_GOOD_READ,
  URL_READ_NOW,
  URL_WAITING,
  URL_WAITING_DESCRIPTION,
  WATCHLISTS_TEST_IDS,
} from "./WatchlistsCopy";
import {
  WatchlistImportProblemList,
  WatchlistImportSummary,
  describeWatchlistImportSummary,
  readWatchlistImportProblems,
  readWatchlistImportSummary,
} from "./WatchlistImportModal";
import SecurityCaseApi from "../../SecurityCase/SecurityCaseApi";
import RelativeTime from "../../EpisodeView/RelativeTime";
import SecurityWatchlist from "Common/Models/DatabaseModels/SecurityWatchlist";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  DEFAULT_SECURITY_WATCHLIST_IMPORT_SCHEDULE,
  SecurityWatchlistImportProblem,
  isSecurityWatchlistImportSchedule,
  readSecurityWatchlistDate,
} from "Common/Types/SecurityEvent/SecurityWatchlist";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import BreakableName from "Common/UI/Components/BreakableName/BreakableName";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import API from "Common/UI/Utils/API/API";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

// What the card reads of a list read from an address.
export interface WatchlistUrlFacts {
  importUrl?: string | undefined;
  importSchedule?: string | undefined;
  nextImportAt?: Date | undefined;
  lastImportAt?: Date | undefined;
  lastImportSucceededAt?: Date | undefined;
  lastImportError?: string | undefined;
  lastImportErrorDetail?: string | undefined;
  lastImportLinesLeftOut?: number | undefined;
}

// Where a list's reads stand: waiting for the first, last worked, or last failed.
export enum WatchlistUrlReadState {
  Waiting = "waiting",
  Read = "read",
  Failed = "failed",
}

export function getWatchlistUrlReadState(
  facts: WatchlistUrlFacts,
): WatchlistUrlReadState {
  if (facts.lastImportError) {
    return WatchlistUrlReadState.Failed;
  }

  return facts.lastImportSucceededAt
    ? WatchlistUrlReadState.Read
    : WatchlistUrlReadState.Waiting;
}

// Whether an address may be a link: an https one, nothing a browser would run.
export function isHttpsAddress(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

// How often the list is read, as the hunts' schedules say it: "Every Hour".
export function getWatchlistUrlScheduleKey(schedule: unknown): string {
  return isSecurityWatchlistImportSchedule(schedule)
    ? schedule
    : DEFAULT_SECURITY_WATCHLIST_IMPORT_SCHEDULE;
}

/*
 * When the list is read next, worth saying: a moment still to come. A list
 * waiting for its first read says so in its own words, and a read that is
 * due is being made - neither says "next read 2 minutes ago".
 */
export function getWatchlistNextReadAt(
  facts: WatchlistUrlFacts,
  now: Date,
): Date | null {
  if (getWatchlistUrlReadState(facts) === WatchlistUrlReadState.Waiting) {
    return null;
  }

  const next: Date | null = readSecurityWatchlistDate(facts.nextImportAt);

  return next && next.getTime() > now.getTime() ? next : null;
}

// What one Read Now did: its counts, and the lines of the file it left out.
export interface WatchlistReadNowResult {
  summary: WatchlistImportSummary;
  problems: Array<SecurityWatchlistImportProblem>;
}

/*
 * What Read Now did, a line each, as an import's are: what it added,
 * removed and found already there, what the list holds now, and how many
 * lines of the file it left out (each listed under it).
 */
export function describeWatchlistReadNowResult(
  translator: Translator,
  result: WatchlistReadNowResult,
): Array<string> {
  const lines: Array<string> = describeWatchlistImportSummary(
    translator,
    result.summary,
  );
  const leftOut: number = Math.max(
    result.summary.problemCount,
    result.problems.length,
  );

  if (leftOut > 0) {
    lines.push(
      translator.translatePlural(IMPORT_PREVIEW_PROBLEMS, leftOut, {
        count: translator.formatNumber(leftOut),
      }),
    );
  }

  return lines;
}

export interface ComponentProps {
  watchlistId: ObjectID;
  watchlist: WatchlistUrlFacts;
  // After a read that changed the list: its page reads it again.
  onRead: () => void;
}

/*
 * A moment in a sentence of the card: "Last read 2 hours ago", with the
 * whole moment under the pointer, in the sentence's language, kept up to
 * date while the page stays open (RelativeTime).
 */
const MomentSentence: FunctionComponent<{
  template: string;
  date: Date;
}> = (props: { template: string; date: Date }): ReactElement => {
  return (
    <TranslatedSentence
      template={props.template}
      slots={{
        time: <RelativeTime date={props.date} className="whitespace-nowrap" />,
      }}
    />
  );
};

/*
 * READ FROM AN ADDRESS, on a list read from one: the address (it opens in
 * a new tab, and breaks after its own slashes and dots on a narrow
 * screen), how often it is read and when next, and how its reads stand -
 * waiting for the first, when the last worked and how many of the file's
 * lines it left out, or why the last failed with what the address said,
 * and which read the list's values are from - each with its own mark, so
 * the state reads at a glance. Read Now reads it at once, for whoever may
 * edit watchlists, and says what it did, the lines it left out among it.
 */
const WatchlistUrlCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isReading, setIsReading] = useState<boolean>(false);
  const [readError, setReadError] = useState<string>("");
  const [readResult, setReadResult] = useState<WatchlistReadNowResult | null>(
    null,
  );

  const facts: WatchlistUrlFacts = props.watchlist;
  const url: string = (facts.importUrl || "").trim();
  const state: WatchlistUrlReadState = getWatchlistUrlReadState(facts);
  const scheduleKey: string = getWatchlistUrlScheduleKey(facts.importSchedule);
  const nextReadAt: Date | null = getWatchlistNextReadAt(
    facts,
    OneUptimeDate.getCurrentDate(),
  );
  const linesLeftOut: number = Math.max(
    0,
    Number(facts.lastImportLinesLeftOut) || 0,
  );

  const readNow: () => Promise<void> = async (): Promise<void> => {
    setIsReading(true);
    setReadError("");
    setReadResult(null);

    try {
      const answer: JSONObject = await SecurityCaseApi.readWatchlistNow({
        watchlistId: props.watchlistId,
      });

      // A read that failed says why on the card, as a scheduled one does.
      if (!answer["error"]) {
        setReadResult({
          summary: readWatchlistImportSummary(answer),
          problems: readWatchlistImportProblems(answer),
        });
      }

      props.onRead();
    } catch (err) {
      setReadError(API.getFriendlyMessage(err));
    }

    setIsReading(false);
  };

  const readNowButton: CardButtonSchema | null = PermissionGate.gateCardButton(
    {
      title: URL_READ_NOW,
      buttonStyle: ButtonStyleType.NORMAL,
      icon: IconProp.Refresh,
      isLoading: isReading,
      onClick: (): void => {
        void readNow();
      },
    },
    new SecurityWatchlist(),
    ModelAction.Update,
  );

  const lastReadAt: Date | null = readSecurityWatchlistDate(
    state === WatchlistUrlReadState.Failed
      ? facts.lastImportAt
      : facts.lastImportSucceededAt,
  );
  const lastGoodReadAt: Date | null = readSecurityWatchlistDate(
    facts.lastImportSucceededAt,
  );

  return (
    <Card
      title={URL_CARD_TITLE}
      description={URL_CARD_DESCRIPTION}
      buttons={readNowButton ? [readNowButton] : []}
    >
      <div
        className="space-y-3 text-sm text-gray-700"
        data-testid={WATCHLISTS_TEST_IDS.urlCard}
      >
        <div className="flex min-w-0 items-start gap-2">
          <Icon
            icon={IconProp.Link}
            className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
          />
          {/*
           * An address reads left to right on any page, and breaks after its
           * own slashes and dots first - "https://hr.example.com/exports/" /
           * "contractors.csv" - anywhere only where a part is still too long.
           * Only an https address is a link: the API keeps no other, and the
           * page never trusts that it did.
           */}
          {isHttpsAddress(url) ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              dir="ltr"
              className="min-w-0 font-mono text-sm text-indigo-600 [overflow-wrap:anywhere] hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              data-testid={WATCHLISTS_TEST_IDS.urlAddress}
            >
              <BreakableName text={url} breaksFromLength={0} />
            </a>
          ) : (
            <span
              dir="ltr"
              className="min-w-0 font-mono text-sm text-gray-700 [overflow-wrap:anywhere]"
              data-testid={WATCHLISTS_TEST_IDS.urlAddress}
            >
              <BreakableName text={url} breaksFromLength={0} />
            </span>
          )}
        </div>

        {/* How often, and when next: "Every Day · Next read in 22 hours". */}
        <div
          className="flex items-start gap-2 text-gray-600"
          data-testid={WATCHLISTS_TEST_IDS.urlSchedule}
        >
          <Icon
            icon={IconProp.Calendar}
            className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
          />
          <span className="min-w-0">
            <span>{translator.translateText(scheduleKey) || scheduleKey}</span>
            {nextReadAt ? (
              <>
                <span aria-hidden="true" className="text-gray-300">
                  {" · "}
                </span>
                <span className="text-gray-500">
                  <MomentSentence template={URL_NEXT_READ} date={nextReadAt} />
                </span>
              </>
            ) : (
              <></>
            )}
          </span>
        </div>

        <div data-testid={WATCHLISTS_TEST_IDS.urlStatus}>
          {state === WatchlistUrlReadState.Waiting ? (
            <div className="flex items-start gap-2 text-gray-600">
              <Icon
                icon={IconProp.Clock}
                className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
              />
              <span className="min-w-0">
                <span className="font-medium text-gray-900">
                  {translator.translateText(URL_WAITING)}
                </span>
                {" - "}
                {translator.translateText(URL_WAITING_DESCRIPTION)}
              </span>
            </div>
          ) : (
            <></>
          )}

          {state === WatchlistUrlReadState.Read ? (
            <div className="flex items-start gap-2 text-gray-700">
              <Icon
                icon={IconProp.CheckCircle}
                className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600"
              />
              <span className="min-w-0">
                {lastReadAt ? (
                  <MomentSentence template={URL_LAST_READ} date={lastReadAt} />
                ) : (
                  <></>
                )}
                {linesLeftOut > 0 ? (
                  <>
                    <span aria-hidden="true" className="text-gray-300">
                      {" · "}
                    </span>
                    <span className="text-gray-600">
                      {translator.translatePlural(
                        IMPORT_PREVIEW_PROBLEMS,
                        linesLeftOut,
                        { count: translator.formatNumber(linesLeftOut) },
                      )}
                    </span>
                  </>
                ) : (
                  <></>
                )}
              </span>
            </div>
          ) : (
            <></>
          )}

          {state === WatchlistUrlReadState.Failed ? (
            <div className="flex items-start gap-2 rounded-md bg-red-50 p-3 text-sm text-red-800">
              <Icon
                icon={IconProp.Alert}
                className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500"
              />
              <div className="min-w-0 space-y-1">
                <p className="font-medium">
                  {lastReadAt ? (
                    <MomentSentence
                      template={URL_LAST_READ_FAILED}
                      date={lastReadAt}
                    />
                  ) : (
                    translator.translateTemplate(URL_LAST_READ_FAILED, {
                      time: "",
                    })
                  )}
                </p>
                <p>
                  {translator.translateText(facts.lastImportError || "") ||
                    facts.lastImportError}
                </p>
                {facts.lastImportErrorDetail ? (
                  <p
                    className="font-mono text-xs text-red-700 [overflow-wrap:anywhere]"
                    dir="ltr"
                  >
                    {facts.lastImportErrorDetail}
                  </p>
                ) : (
                  <></>
                )}
                <p className="text-red-700">
                  {lastGoodReadAt ? (
                    <MomentSentence
                      template={URL_KEEPS_VALUES_FROM}
                      date={lastGoodReadAt}
                    />
                  ) : (
                    translator.translateText(URL_NO_GOOD_READ)
                  )}
                </p>
              </div>
            </div>
          ) : (
            <></>
          )}
        </div>

        {/*
         * What Read Now did, as Import Values says what an import did - the
         * status above already says when - with the lines of the file it
         * left out and why. Said to a screen reader as it appears.
         */}
        {readResult ? (
          <div
            className="space-y-2 rounded-md bg-gray-50 p-3"
            role="status"
            data-testid={WATCHLISTS_TEST_IDS.urlReadNowResult}
          >
            <ul className="space-y-1 text-gray-700">
              {describeWatchlistReadNowResult(translator, readResult).map(
                (line: string, index: number): ReactElement => {
                return (
                  <li key={index} className="flex items-start gap-2">
                    <Icon
                      icon={index === 0 ? IconProp.Check : IconProp.Info}
                      className={`mt-0.5 h-4 w-4 flex-shrink-0 ${
                        index === 0 ? "text-emerald-600" : "text-gray-400"
                      }`}
                    />
                    <span>{line}</span>
                  </li>
                );
                },
              )}
            </ul>
            {readResult.problems.length > 0 ? (
              <div className="ps-6">
                <WatchlistImportProblemList
                  problems={readResult.problems}
                  problemCount={Math.max(
                    readResult.summary.problemCount,
                    readResult.problems.length,
                  )}
                  dataTestId={WATCHLISTS_TEST_IDS.importProblems}
                />
              </div>
            ) : (
              <></>
            )}
          </div>
        ) : (
          <></>
        )}

        {readError ? (
          <Alert
            type={AlertType.DANGER}
            title={readError}
            onClose={() => {
              setReadError("");
            }}
            dataTestId={WATCHLISTS_TEST_IDS.urlReadNowResult}
          />
        ) : (
          <></>
        )}
      </div>
    </Card>
  );
};

export default WatchlistUrlCard;
