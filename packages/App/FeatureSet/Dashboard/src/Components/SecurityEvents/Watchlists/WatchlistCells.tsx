import {
  FOLLOWS_FEED,
  READ_BY_LABEL,
  READ_BY_MORE,
  READ_BY_NO_RULE,
  READ_BY_UNKNOWN,
  READ_FROM_ADDRESS,
  URL_READ_FAILED_SHORT,
  VALUE_EXPIRES,
  WATCHLISTS_TEST_IDS,
} from "./WatchlistsCopy";
import {
  ShownWatchlistReader,
  WatchlistReaders,
  describeWatchlistValues,
  getWatchlistHoldsIcon,
  getWatchlistHoldsLabel,
  getWatchlistReaderKindKey,
  isFeedWatchlist,
  isUrlWatchlist,
  splitWatchlistName,
  summarizeWatchlistReaders,
} from "./WatchlistsModel";
import { SECURITY_LIST_NAME_DETAIL_CLASS_NAME } from "../SecurityListNameCell";
import { RuleExceptionAddedLine } from "../RuleExceptions/RuleExceptionCells";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import {
  WatchlistReader,
  WatchlistReaderKind,
} from "Common/Types/SecurityEvent/SecurityWatchlistFilter";
import { readSecurityWatchlistDate } from "Common/Types/SecurityEvent/SecurityWatchlist";
import Link from "Common/UI/Components/Link/Link";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import { useAreTableColumnsFolded } from "Common/UI/Components/Table/TableCellContext";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * The cells of Security Events > Detections > Watchlists: a list's name (as
 * rules write it), what it holds with its values under it, and the rules
 * that read it. What each says is worked out in WatchlistsModel
 * (React-free); here it is drawn.
 */

/*
 * A list's name as rules write it: in the mono type a rule's YAML is in,
 * left to right on any page (letters, digits and underscores), and a long
 * one breaking after its underscores first (splitWatchlistName); the box
 * that holds it breaks a part still too long anywhere. A <wbr> adds no
 * character: a copy reads the name as written. The mono type is on the
 * isolate itself: the page names every element's font (index.ejs), so a
 * parent's would not reach the text.
 */
export const WatchlistNameText: FunctionComponent<{ name: string }> = (props: {
  name: string;
}): ReactElement => {
  const parts: Array<string> = splitWatchlistName(props.name);

  return (
    <bdi dir="ltr" className="font-mono">
      {parts.map((part: string, index: number): ReactElement => {
        return (
          <Fragment key={index}>
            {part}
            {index < parts.length - 1 ? <wbr /> : <></>}
          </Fragment>
        );
      })}
    </bdi>
  );
};

// What reads a list, and whether it could be read yet.
export interface WatchlistReadersState {
  readers:
    | ReadonlyArray<{
        id: string;
        name: string;
        kind?: WatchlistReaderKind | undefined;
      }>
    | undefined;
  isLoaded: boolean;
  hasError: boolean;
}

// What a list holds and where its values come from, as a row reads them.
export interface WatchlistValuesFacts {
  source: unknown;
  valueCount?: number | undefined;
  threatIntelFeedId?: unknown;
  feedName?: string | undefined;
  // A list read from an address: where, and how its reads went.
  importUrl?: string | undefined;
  lastImportSucceededAt?: Date | undefined;
  lastImportError?: string | undefined;
}

/*
 * What a monitor or a hunt is, after its name - "(Monitor)" - quieter than
 * the name; nothing after a rule's, the usual reader.
 */
export const WatchlistReaderKindWord: FunctionComponent<{
  kind?: WatchlistReaderKind | undefined;
}> = (props: { kind?: WatchlistReaderKind | undefined }): ReactElement => {
  const translator: Translator = useTranslator();
  const key: string | null = getWatchlistReaderKindKey(props.kind);

  if (!key) {
    return <></>;
  }

  return (
    <span
      className="whitespace-nowrap text-gray-400"
      data-testid={WATCHLISTS_TEST_IDS.readerKind}
    >
      {" "}
      ({translator.translateText(key) || key})
    </span>
  );
};

/*
 * A list's values in words, with no icon of their own: how many it keeps
 * ("12 values", "No values yet" in a quieter grey), or the feed it follows,
 * its name as written. The line under what a row holds, and the folded
 * row's facts.
 */
export interface WatchlistValuesTextProps extends WatchlistValuesFacts {
  dataTestId?: string | undefined;
  // The words' size and colour where they sit; none takes the holder's.
  className?: string | undefined;
}

export const WatchlistValuesText: FunctionComponent<
  WatchlistValuesTextProps
> = (props: WatchlistValuesTextProps): ReactElement => {
  const translator: Translator = useTranslator();
  const feedName: string = (props.feedName || "").trim();

  if (isFeedWatchlist(props.source) && props.threatIntelFeedId && feedName) {
    return (
      <span className={props.className} data-testid={props.dataTestId}>
        <TranslatedSentence
          template={FOLLOWS_FEED}
          slots={{ feed: <IsolatedText text={feedName} /> }}
        />
      </span>
    );
  }

  const isEmpty: boolean =
    !isFeedWatchlist(props.source) && !(Number(props.valueCount) > 0);

  // No values yet is quieter than a count, whatever grey the holder uses.
  const className: string = [
    props.className || "",
    isEmpty ? "text-gray-400" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={className || undefined} data-testid={props.dataTestId}>
      {describeWatchlistValues(translator, {
        source: props.source,
        valueCount: props.valueCount,
        threatIntelFeedId: props.threatIntelFeedId,
        feedName,
        importUrl: props.importUrl,
        lastImportSucceededAt: props.lastImportSucceededAt,
      })}
      {/* A list whose last read failed says so, in red, wherever its values are named. */}
      {isUrlWatchlist(props.source) && props.lastImportError ? (
        <span className="block text-red-700">
          {translator.translateText(URL_READ_FAILED_SHORT)}
        </span>
      ) : (
        <></>
      )}
    </span>
  );
};

/*
 * The rules that read a list, in one line: "Read by: VIP sign-in, VIP new
 * country and 2 more", each name as written; a list no rule reads says so.
 * While the rules are read, nothing; when they could not be read, it says
 * so rather than "no rule". Under a folded row's name.
 */
export const WatchlistReadByLine: FunctionComponent<WatchlistReadersState> = (
  props: WatchlistReadersState,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (!props.isLoaded) {
    return <></>;
  }

  if (props.hasError) {
    return <>{translator.translateText(READ_BY_UNKNOWN)}</>;
  }

  const readers: WatchlistReaders = summarizeWatchlistReaders(props.readers);

  if (readers.shown.length === 0) {
    return <>{translator.translateText(READ_BY_NO_RULE)}</>;
  }

  return (
    <>
      {translator.translateText(READ_BY_LABEL)}
      {": "}
      {readers.shown.map(
        (reader: ShownWatchlistReader, index: number): ReactElement => {
          return (
            <Fragment key={index}>
              {index > 0 ? ", " : ""}
              <IsolatedText text={reader.name} />
              <WatchlistReaderKindWord kind={reader.kind} />
            </Fragment>
          );
        },
      )}
      {readers.more > 0
        ? ` ${translator.translatePlural(READ_BY_MORE, readers.more, {
            count: translator.formatNumber(readers.more),
          })}`
        : ""}
    </>
  );
};

/*
 * A list's name in the mono type a rule's YAML is in - it is what a rule
 * writes between % signs - and what it is for under it. The mono type is on
 * the isolate itself: the page names every element's font (index.ejs), so
 * a parent's would not reach the text.
 *
 * Below lg - a tablet's row beside the side menu, a phone's card - the
 * Holds and Read By columns are left out (hideBelowLargeScreen), and what
 * they say goes under the name instead: what the list holds with its
 * values, then the rules that read it. The row says each once.
 */
export const WatchlistNameCell: FunctionComponent<{
  name: string;
  description?: string | undefined;
  // What the folded row says under the name; left out, it says nothing more.
  entityType?: unknown;
  values?: WatchlistValuesFacts | undefined;
  readers?: WatchlistReadersState | undefined;
}> = (props: {
  name: string;
  description?: string | undefined;
  entityType?: unknown;
  values?: WatchlistValuesFacts | undefined;
  readers?: WatchlistReadersState | undefined;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const areColumnsFolded: boolean = useAreTableColumnsFolded();
  const description: string = (props.description || "").trim();

  return (
    <span className="block min-w-0" data-testid={WATCHLISTS_TEST_IDS.nameCell}>
      {/* A name has no spaces: a long one breaks after its underscores, then anywhere, rather than run past its column. */}
      <span className="block text-sm font-medium text-gray-900 [overflow-wrap:anywhere]">
        <WatchlistNameText name={props.name} />
      </span>
      {description ? (
        <span className={SECURITY_LIST_NAME_DETAIL_CLASS_NAME}>
          <IsolatedText text={description} />
        </span>
      ) : (
        <></>
      )}
      {/*
       * One line of text, so a long feed's name wraps on after the dot
       * rather than taking a line of its own and leaving the dot behind.
       */}
      {areColumnsFolded && props.values ? (
        <span
          className="mt-1 block whitespace-normal text-xs font-normal leading-5 text-gray-600 [overflow-wrap:anywhere]"
          data-testid={WATCHLISTS_TEST_IDS.nameFacts}
        >
          <span className="inline-flex h-5 items-center gap-1 whitespace-nowrap align-top">
            <Icon
              icon={getWatchlistHoldsIcon(props.entityType)}
              className="h-3.5 w-3.5 flex-shrink-0 text-gray-400"
            />
            {getWatchlistHoldsLabel(translator, props.entityType)}
          </span>{" "}
          <span aria-hidden="true" className="text-gray-300">
            ·
          </span>{" "}
          <WatchlistValuesText {...props.values} />
        </span>
      ) : (
        <></>
      )}
      {areColumnsFolded && props.readers && props.readers.isLoaded ? (
        <span
          className="mt-0.5 block whitespace-normal text-xs font-normal leading-5 text-gray-500 [overflow-wrap:anywhere]"
          data-testid={WATCHLISTS_TEST_IDS.nameReadBy}
        >
          <WatchlistReadByLine {...props.readers} />
        </span>
      ) : (
        <></>
      )}
    </span>
  );
};

// What a list holds: the kind's icon and its name, "Users".
export const WatchlistHoldsCell: FunctionComponent<{
  entityType: unknown;
}> = (props: { entityType: unknown }): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-gray-700"
      data-testid={WATCHLISTS_TEST_IDS.holdsCell}
    >
      <Icon
        icon={getWatchlistHoldsIcon(props.entityType)}
        className="h-4 w-4 flex-shrink-0 text-gray-400"
      />
      {getWatchlistHoldsLabel(translator, props.entityType)}
    </span>
  );
};

/*
 * A row's Holds: what the list holds ("IP addresses"), and its values under
 * it - "3 values", "No values yet", or the feed it follows - lined up with
 * the kind's name. One column where there were two, so the list fits its
 * card beside the side menu at a laptop's width.
 */
export const WatchlistHoldsColumnCell: FunctionComponent<
  WatchlistValuesFacts & { entityType: unknown }
> = (props: WatchlistValuesFacts & { entityType: unknown }): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <span className="block min-w-0 whitespace-normal">
      {/* The kind's name wraps in a narrow column ("Hachages de" / "fichiers"), its icon by its first line. */}
      <span
        className="flex items-start gap-1.5 text-sm text-gray-700"
        data-testid={WATCHLISTS_TEST_IDS.holdsCell}
      >
        <Icon
          icon={getWatchlistHoldsIcon(props.entityType)}
          className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
        />
        <span className="min-w-0">
          {getWatchlistHoldsLabel(translator, props.entityType)}
        </span>
      </span>
      <span className="block ps-[1.375rem] text-xs leading-5 text-gray-500">
        <WatchlistValuesText
          source={props.source}
          valueCount={props.valueCount}
          threatIntelFeedId={props.threatIntelFeedId}
          feedName={props.feedName}
          importUrl={props.importUrl}
          lastImportSucceededAt={props.lastImportSucceededAt}
          lastImportError={props.lastImportError}
          dataTestId={WATCHLISTS_TEST_IDS.valuesCell}
        />
      </span>
    </span>
  );
};

/*
 * A list's values on its page: how many it keeps ("12 values", "No values
 * yet" in a quieter grey), or the feed it follows - its name as written,
 * after the feed's icon.
 */
export const WatchlistValuesCell: FunctionComponent<WatchlistValuesFacts> = (
  props: WatchlistValuesFacts,
): ReactElement => {
  const feedName: string = (props.feedName || "").trim();

  if (isFeedWatchlist(props.source) && props.threatIntelFeedId && feedName) {
    return (
      <span
        className="inline-flex items-start gap-1.5 text-sm text-gray-700"
        data-testid={WATCHLISTS_TEST_IDS.valuesCell}
      >
        <Icon
          icon={IconProp.Bug}
          className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
        />
        <span className="min-w-0">
          <WatchlistValuesText {...props} />
        </span>
      </span>
    );
  }

  const isEmpty: boolean =
    !isFeedWatchlist(props.source) && !(Number(props.valueCount) > 0);

  return (
    <WatchlistValuesText
      {...props}
      className={isEmpty ? "text-sm" : "text-sm text-gray-700"}
      dataTestId={WATCHLISTS_TEST_IDS.valuesCell}
    />
  );
};

// Where a monitor or a hunt that reads a list opens: its own page. A rule has none of its own.
export function getWatchlistReaderRoute(
  reader: Pick<WatchlistReader, "kind" | "id">,
): Route | null {
  if (!reader.id) {
    return null;
  }

  if (reader.kind === WatchlistReaderKind.Monitor) {
    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.MONITOR_VIEW] as Route,
      { modelId: reader.id },
    );
  }

  if (reader.kind === WatchlistReaderKind.Hunt) {
    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.SECURITY_EVENTS_HUNT_VIEW] as Route,
      { modelId: reader.id },
    );
  }

  return null;
}

/*
 * Everything that reads a list, by name (as written), on a list's page:
 * "VIP sign-in from outside the office, VIP failures (Monitor)". A monitor
 * or a hunt opens its own page. A list nothing reads says so, quieter;
 * while they are read, an ellipsis; when they could not be read, it says
 * so rather than "nothing".
 */
export const WatchlistReadersList: FunctionComponent<WatchlistReadersState> = (
  props: WatchlistReadersState,
): ReactElement => {
  const translator: Translator = useTranslator();
  const readers: ReadonlyArray<{
    id: string;
    name: string;
    kind?: WatchlistReaderKind | undefined;
  }> = props.readers || [];

  if (!props.isLoaded) {
    return (
      <span
        className="text-sm text-gray-400"
        data-testid={WATCHLISTS_TEST_IDS.readByLine}
      >
        …
      </span>
    );
  }

  if (props.hasError || readers.length === 0) {
    return (
      <span
        className="text-sm text-gray-500"
        data-testid={WATCHLISTS_TEST_IDS.readByLine}
      >
        {translator.translateText(
          props.hasError ? READ_BY_UNKNOWN : READ_BY_NO_RULE,
        )}
      </span>
    );
  }

  return (
    <span
      className="block text-sm text-gray-900 [overflow-wrap:anywhere]"
      data-testid={WATCHLISTS_TEST_IDS.readByLine}
    >
      {readers.map(
        (
          reader: {
            id: string;
            name: string;
            kind?: WatchlistReaderKind | undefined;
          },
          index: number,
        ): ReactElement => {
          const route: Route | null = getWatchlistReaderRoute({
            kind: reader.kind || WatchlistReaderKind.DetectionRule,
            id: reader.id,
          });

          return (
            <Fragment key={`${reader.kind || ""}-${reader.id || index}`}>
              {index > 0 ? ", " : ""}
              {route ? (
                <Link
                  to={route}
                  className="text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  <IsolatedText text={reader.name} />
                </Link>
              ) : (
                <IsolatedText text={reader.name} />
              )}
              <WatchlistReaderKindWord kind={reader.kind} />
            </Fragment>
          );
        },
      )}
    </span>
  );
};

// Who put a value on its list, and when it leaves it: what a value's cells say under it.
export interface WatchlistValueFacts {
  note?: string | undefined;
  addedBy?: string | undefined;
  createdAt?: Date | undefined;
  // When it leaves its list; none: it stays until someone removes it.
  expiresAt?: Date | string | undefined;
  // A list read from an address: its reads put every value there.
  isReadFromUrl?: boolean | undefined;
}

/*
 * When a value leaves its list, as a rule exception's expiry is written:
 * "Expires in 3 days", the moment whole under the pointer. Nothing for a
 * value that stays.
 */
export const WatchlistValueExpiresLine: FunctionComponent<{
  expiresAt?: Date | string | undefined;
}> = (props: { expiresAt?: Date | string | undefined }): ReactElement => {
  const translator: Translator = useTranslator();
  const expiresAt: Date | null = readSecurityWatchlistDate(props.expiresAt);

  if (!expiresAt) {
    return <></>;
  }

  return (
    <span
      className="mt-0.5 flex items-center gap-1 text-xs text-amber-700"
      data-testid={WATCHLISTS_TEST_IDS.expiresLine}
      title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(expiresAt)}
    >
      <Icon icon={IconProp.Clock} className="h-3.5 w-3.5 flex-shrink-0" />
      <span>
        {translator.translateTemplate(VALUE_EXPIRES, {
          time: OneUptimeDate.fromNow(expiresAt),
        })}
      </span>
    </span>
  );
};

/*
 * Why a value is on the list, with who added it and when under it, as a
 * rule exception's reason reads: "Added by Maya Chen 3 days ago", or
 * "Added through the API" when no person did - "Read from its address"
 * on a list read from one - and, for a value kept for a while, when it
 * leaves the list. A value with no note says only who added it. The note
 * reads the way it is written (IsolatedText); the date whole is under the
 * pointer.
 */
export const WatchlistValueNoteCell: FunctionComponent<WatchlistValueFacts> = (
  props: WatchlistValueFacts,
): ReactElement => {
  const translator: Translator = useTranslator();
  const note: string = (props.note || "").trim();

  return (
    <div
      className="min-w-0 font-normal"
      data-testid={WATCHLISTS_TEST_IDS.noteCell}
    >
      {note ? (
        <span className="block whitespace-pre-line break-words text-sm text-gray-700">
          <IsolatedText text={note} />
        </span>
      ) : (
        <></>
      )}
      <span
        className={`block text-xs text-gray-500 ${note ? "mt-0.5" : ""}`}
        data-testid={WATCHLISTS_TEST_IDS.addedLine}
        title={
          props.createdAt
            ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                props.createdAt,
              )
            : undefined
        }
      >
        {props.isReadFromUrl ? (
          translator.translateTemplate(READ_FROM_ADDRESS, {
            time: props.createdAt ? OneUptimeDate.fromNow(props.createdAt) : "",
          })
        ) : (
          <RuleExceptionAddedLine
            addedBy={props.addedBy}
            createdAt={props.createdAt}
          />
        )}
      </span>
      <WatchlistValueExpiresLine expiresAt={props.expiresAt} />
    </div>
  );
};

/*
 * A value as it is written, in the mono type: a long one (an address, a
 * SHA-512 digest) breaks after its own dots and slashes first, anywhere
 * only where a part is still too long for the line. Below lg - a tablet's
 * row beside the side menu, a phone's card - the Note column is left out
 * (hideBelowLargeScreen), and the note with who added it goes under the
 * value instead, so nothing runs under the row's buttons.
 */
export const WatchlistValueCell: FunctionComponent<
  WatchlistValueFacts & { value: string }
> = (props: WatchlistValueFacts & { value: string }): ReactElement => {
  const isNoteFolded: boolean = useAreTableColumnsFolded();

  return (
    <div className="min-w-0">
      <span className="block text-sm text-gray-900 [overflow-wrap:anywhere]">
        <IsolatedText
          text={props.value}
          className="font-mono"
          breaksLikeAName={true}
        />
      </span>
      {isNoteFolded ? (
        <div className="mt-1 whitespace-normal">
          <WatchlistValueNoteCell
            note={props.note}
            addedBy={props.addedBy}
            createdAt={props.createdAt}
            expiresAt={props.expiresAt}
            isReadFromUrl={props.isReadFromUrl}
          />
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

/*
 * The rules that read a list: the first two by name (as written), each on a
 * line of its own that wraps rather than ending in "...", then how many
 * more; a list no rule reads says so, quieter. While the rules are read,
 * nothing; when they could not be read, it says so rather than "no rule".
 */
export const WatchlistReadByCell: FunctionComponent<WatchlistReadersState> = (
  props: WatchlistReadersState,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (!props.isLoaded) {
    return <span data-testid={WATCHLISTS_TEST_IDS.readByCell} />;
  }

  if (props.hasError) {
    return (
      <span
        className="text-sm text-gray-400"
        data-testid={WATCHLISTS_TEST_IDS.readByCell}
      >
        {translator.translateText(READ_BY_UNKNOWN)}
      </span>
    );
  }

  const readers: WatchlistReaders = summarizeWatchlistReaders(props.readers);

  if (readers.shown.length === 0) {
    return (
      <span
        className="text-sm text-gray-400"
        data-testid={WATCHLISTS_TEST_IDS.readByCell}
      >
        {translator.translateText(READ_BY_NO_RULE)}
      </span>
    );
  }

  return (
    <span
      className="block space-y-0.5 whitespace-normal text-sm text-gray-700"
      data-testid={WATCHLISTS_TEST_IDS.readByCell}
    >
      {readers.shown.map(
        (reader: ShownWatchlistReader, index: number): ReactElement => {
          return (
            <span key={index} className="block break-words">
              <IsolatedText text={reader.name} />
              <WatchlistReaderKindWord kind={reader.kind} />
            </span>
          );
        },
      )}
      {readers.more > 0 ? (
        <span className="block text-xs text-gray-500">
          {translator.translatePlural(READ_BY_MORE, readers.more, {
            count: translator.formatNumber(readers.more),
          })}
        </span>
      ) : (
        <></>
      )}
    </span>
  );
};
