import {
  FOLLOWS_FEED,
  READ_BY_LABEL,
  READ_BY_MORE,
  READ_BY_NO_RULE,
  READ_BY_UNKNOWN,
  WATCHLISTS_TEST_IDS,
} from "./WatchlistsCopy";
import {
  WatchlistReaders,
  describeWatchlistValues,
  getWatchlistHoldsIcon,
  getWatchlistHoldsLabel,
  isFeedWatchlist,
  splitWatchlistName,
  summarizeWatchlistReaders,
} from "./WatchlistsModel";
import { SECURITY_LIST_NAME_DETAIL_CLASS_NAME } from "../SecurityListNameCell";
import { RuleExceptionAddedLine } from "../RuleExceptions/RuleExceptionCells";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
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

// The rules that read a list, and whether they could be read yet.
export interface WatchlistReadersState {
  readers: ReadonlyArray<{ id: string; name: string }> | undefined;
  isLoaded: boolean;
  hasError: boolean;
}

// What a list holds and where its values come from, as a row reads them.
export interface WatchlistValuesFacts {
  source: unknown;
  valueCount?: number | undefined;
  threatIntelFeedId?: unknown;
  feedName?: string | undefined;
}

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
      })}
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

  if (readers.names.length === 0) {
    return <>{translator.translateText(READ_BY_NO_RULE)}</>;
  }

  return (
    <>
      {translator.translateText(READ_BY_LABEL)}
      {": "}
      {readers.names.map((name: string, index: number): ReactElement => {
        return (
          <Fragment key={index}>
            {index > 0 ? ", " : ""}
            <IsolatedText text={name} />
          </Fragment>
        );
      })}
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

/*
 * Every rule that reads a list, by name (as written), on a list's page:
 * "VIP sign-in from outside the office, VIP new country". A list no rule
 * reads says so, quieter; while the rules are read, an ellipsis; when they
 * could not be read, it says so rather than "no rule".
 */
export const WatchlistReadersList: FunctionComponent<WatchlistReadersState> = (
  props: WatchlistReadersState,
): ReactElement => {
  const translator: Translator = useTranslator();
  const readers: ReadonlyArray<{ id: string; name: string }> =
    props.readers || [];

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
        (reader: { id: string; name: string }, index: number): ReactElement => {
          return (
            <Fragment key={reader.id || index}>
              {index > 0 ? ", " : ""}
              <IsolatedText text={reader.name} />
            </Fragment>
          );
        },
      )}
    </span>
  );
};

/*
 * Why a value is on the list, with who added it and when under it, as a
 * rule exception's reason reads: "Added by Maya Chen 3 days ago", or
 * "Added through the API" when no person did. A value with no note says
 * only who added it. The note reads the way it is written (IsolatedText);
 * the date whole is under the pointer.
 */
export const WatchlistValueNoteCell: FunctionComponent<{
  note?: string | undefined;
  addedBy?: string | undefined;
  createdAt?: Date | undefined;
}> = (props: {
  note?: string | undefined;
  addedBy?: string | undefined;
  createdAt?: Date | undefined;
}): ReactElement => {
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
        <RuleExceptionAddedLine
          addedBy={props.addedBy}
          createdAt={props.createdAt}
        />
      </span>
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
export const WatchlistValueCell: FunctionComponent<{
  value: string;
  note?: string | undefined;
  addedBy?: string | undefined;
  createdAt?: Date | undefined;
}> = (props: {
  value: string;
  note?: string | undefined;
  addedBy?: string | undefined;
  createdAt?: Date | undefined;
}): ReactElement => {
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

  if (readers.names.length === 0) {
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
      {readers.names.map((name: string, index: number): ReactElement => {
        return (
          <span key={index} className="block break-words">
            <IsolatedText text={name} />
          </span>
        );
      })}
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
