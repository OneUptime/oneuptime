import {
  URL_CARD_DESCRIPTION,
  URL_CARD_TITLE,
  URL_KEEPS_VALUES_FROM,
  URL_LAST_READ,
  URL_LAST_READ_FAILED,
  URL_LINES_LEFT_OUT,
  URL_NO_GOOD_READ,
  URL_READ_NOW,
  URL_READ_NOW_DONE,
  URL_WAITING,
  URL_WAITING_DESCRIPTION,
  WATCHLISTS_TEST_IDS,
} from "./WatchlistsCopy";
import {
  WatchlistImportSummary,
  describeWatchlistImportSummary,
  readWatchlistImportSummary,
} from "./WatchlistImportModal";
import SecurityCaseApi from "../../SecurityCase/SecurityCaseApi";
import SecurityWatchlist from "Common/Models/DatabaseModels/SecurityWatchlist";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  DEFAULT_SECURITY_WATCHLIST_IMPORT_SCHEDULE,
  isSecurityWatchlistImportSchedule,
} from "Common/Types/SecurityEvent/SecurityWatchlist";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import API from "Common/UI/Utils/API/API";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

// What the card reads of a list read from an address.
export interface WatchlistUrlFacts {
  importUrl?: string | undefined;
  importSchedule?: string | undefined;
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

export interface ComponentProps {
  watchlistId: ObjectID;
  watchlist: WatchlistUrlFacts;
  // After a read that changed the list: its page reads it again.
  onRead: () => void;
}

/*
 * READ FROM AN ADDRESS, on a list read from one: the address (it opens in
 * a new tab), how often it is read, and how its reads stand - waiting for
 * the first, when the last worked and how many of the file's lines it left
 * out, or why the last failed with what the address said, and which read
 * the list's values are from. Read Now reads it at once, for whoever may
 * edit watchlists, and says what it did.
 */
const WatchlistUrlCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isReading, setIsReading] = useState<boolean>(false);
  const [readError, setReadError] = useState<string>("");
  const [readSummary, setReadSummary] = useState<WatchlistImportSummary | null>(
    null,
  );

  const facts: WatchlistUrlFacts = props.watchlist;
  const url: string = (facts.importUrl || "").trim();
  const state: WatchlistUrlReadState = getWatchlistUrlReadState(facts);
  const scheduleKey: string = getWatchlistUrlScheduleKey(facts.importSchedule);

  const readNow: () => Promise<void> = async (): Promise<void> => {
    setIsReading(true);
    setReadError("");
    setReadSummary(null);

    try {
      const answer: JSONObject = await SecurityCaseApi.readWatchlistNow({
        watchlistId: props.watchlistId,
      });

      // A read that failed says why on the card, as a scheduled one does.
      if (!answer["error"]) {
        setReadSummary(readWatchlistImportSummary(answer));
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

  const lastReadAt: Date | undefined =
    state === WatchlistUrlReadState.Failed
      ? facts.lastImportAt
      : facts.lastImportSucceededAt;

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
           * An address reads left to right on any page, and breaks anywhere
           * rather than run past the card. Only an https address is a link:
           * the API keeps no other, and the page never trusts that it did.
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
              {url}
            </a>
          ) : (
            <span
              dir="ltr"
              className="min-w-0 font-mono text-sm text-gray-700 [overflow-wrap:anywhere]"
              data-testid={WATCHLISTS_TEST_IDS.urlAddress}
            >
              {url}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 text-gray-600">
          <Icon
            icon={IconProp.Clock}
            className="h-4 w-4 flex-shrink-0 text-gray-400"
          />
          <span>{translator.translateText(scheduleKey) || scheduleKey}</span>
        </div>

        <div data-testid={WATCHLISTS_TEST_IDS.urlStatus}>
          {state === WatchlistUrlReadState.Waiting ? (
            <p className="text-gray-600">
              <span className="font-medium text-gray-900">
                {translator.translateText(URL_WAITING)}
              </span>
              {" - "}
              {translator.translateText(URL_WAITING_DESCRIPTION)}
            </p>
          ) : (
            <></>
          )}

          {state === WatchlistUrlReadState.Read ? (
            <p className="text-gray-600">
              <span
                title={
                  lastReadAt
                    ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                        lastReadAt,
                      )
                    : undefined
                }
              >
                {translator.translateTemplate(URL_LAST_READ, {
                  time: lastReadAt ? OneUptimeDate.fromNow(lastReadAt) : "",
                })}
              </span>
              {(facts.lastImportLinesLeftOut || 0) > 0 ? (
                <>
                  {". "}
                  {translator.translatePlural(
                    URL_LINES_LEFT_OUT,
                    facts.lastImportLinesLeftOut || 0,
                    {
                      count: translator.formatNumber(
                        facts.lastImportLinesLeftOut || 0,
                      ),
                    },
                  )}
                </>
              ) : (
                <>.</>
              )}
            </p>
          ) : (
            <></>
          )}

          {state === WatchlistUrlReadState.Failed ? (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-800">
              <p className="font-medium">
                {translator.translateTemplate(URL_LAST_READ_FAILED, {
                  time: lastReadAt ? OneUptimeDate.fromNow(lastReadAt) : "",
                })}
              </p>
              <p className="mt-1">
                {translator.translateText(facts.lastImportError || "") ||
                  facts.lastImportError}
              </p>
              {facts.lastImportErrorDetail ? (
                <p
                  className="mt-1 font-mono text-xs text-red-700 [overflow-wrap:anywhere]"
                  dir="ltr"
                >
                  {facts.lastImportErrorDetail}
                </p>
              ) : (
                <></>
              )}
              <p className="mt-1">
                {facts.lastImportSucceededAt
                  ? translator.translateTemplate(URL_KEEPS_VALUES_FROM, {
                      time: OneUptimeDate.fromNow(facts.lastImportSucceededAt),
                    })
                  : translator.translateText(URL_NO_GOOD_READ)}
              </p>
            </div>
          ) : (
            <></>
          )}
        </div>

        {readSummary ? (
          <div
            className="rounded-md bg-gray-50 p-3"
            data-testid={WATCHLISTS_TEST_IDS.urlReadNowResult}
          >
            <p className="font-medium text-gray-900">
              {translator.translateText(URL_READ_NOW_DONE)}
            </p>
            <ul className="mt-1 space-y-0.5 text-gray-700">
              {describeWatchlistImportSummary(translator, readSummary).map(
                (line: string, index: number): ReactElement => {
                  return <li key={index}>{line}</li>;
                },
              )}
            </ul>
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
