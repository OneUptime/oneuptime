import {
  FOLLOWS_FEED,
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
  summarizeWatchlistReaders,
} from "./WatchlistsModel";
import { SECURITY_LIST_NAME_DETAIL_CLASS_NAME } from "../SecurityListNameCell";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * The cells of Security Events > Detections > Watchlists: a list's name (as
 * rules write it), what it holds, its values, and the rules that read it.
 * What each says is worked out in WatchlistsModel (React-free); here it is
 * drawn.
 */

/*
 * A list's name in the mono type a rule's YAML is in - it is what a rule
 * writes between % signs - and what it is for under it. The mono type is on
 * the isolate itself: the page names every element's font (index.ejs), so
 * a parent's would not reach the text.
 */
export const WatchlistNameCell: FunctionComponent<{
  name: string;
  description?: string | undefined;
}> = (props: { name: string; description?: string | undefined }): ReactElement => {
  const description: string = (props.description || "").trim();

  return (
    <span className="block min-w-0" data-testid={WATCHLISTS_TEST_IDS.nameCell}>
      {/* A name has no spaces: a long one breaks anywhere rather than run past its column. */}
      <span className="block text-sm font-medium text-gray-900 [overflow-wrap:anywhere]">
        <IsolatedText text={props.name} className="font-mono" />
      </span>
      {description ? (
        <span className={SECURITY_LIST_NAME_DETAIL_CLASS_NAME}>
          <IsolatedText text={description} />
        </span>
      ) : (
        <></>
      )}
    </span>
  );
};

// What a list holds: the kind's icon and its name, "Users".
export const WatchlistHoldsCell: FunctionComponent<{ entityType: unknown }> = (
  props: { entityType: unknown },
): ReactElement => {
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
 * A list's values: how many it keeps ("12 values", "No values yet" in a
 * quieter grey), or the feed it follows - its name as written.
 */
export const WatchlistValuesCell: FunctionComponent<{
  source: unknown;
  valueCount?: number | undefined;
  threatIntelFeedId?: unknown;
  feedName?: string | undefined;
}> = (props: {
  source: unknown;
  valueCount?: number | undefined;
  threatIntelFeedId?: unknown;
  feedName?: string | undefined;
}): ReactElement => {
  const translator: Translator = useTranslator();
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
          <TranslatedSentence
            template={FOLLOWS_FEED}
            slots={{ feed: <IsolatedText text={feedName} /> }}
          />
        </span>
      </span>
    );
  }

  const isEmpty: boolean =
    !isFeedWatchlist(props.source) && !(Number(props.valueCount) > 0);

  return (
    <span
      className={`text-sm ${isEmpty ? "text-gray-400" : "text-gray-700"}`}
      data-testid={WATCHLISTS_TEST_IDS.valuesCell}
    >
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
 * The rules that read a list: the first two by name (as written), then how
 * many more; a list no rule reads says so, quieter. While the rules are
 * read, nothing; when they could not be read, it says so rather than "no
 * rule".
 */
export const WatchlistReadByCell: FunctionComponent<{
  readers: ReadonlyArray<{ id: string; name: string }> | undefined;
  isLoaded: boolean;
  hasError: boolean;
}> = (props: {
  readers: ReadonlyArray<{ id: string; name: string }> | undefined;
  isLoaded: boolean;
  hasError: boolean;
}): ReactElement => {
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
      className="block text-sm text-gray-700"
      data-testid={WATCHLISTS_TEST_IDS.readByCell}
    >
      {readers.names.map((name: string, index: number): ReactElement => {
        return (
          <Fragment key={index}>
            <span className="block truncate">
              <IsolatedText text={name} />
            </span>
          </Fragment>
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
