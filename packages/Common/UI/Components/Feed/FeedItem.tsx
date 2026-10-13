import React, {
  FunctionComponent,
  ReactElement,
  useId,
  useMemo,
  useState,
} from "react";
import User from "../../../Models/DatabaseModels/User";
import Image from "../Image/Image";
import BlankProfilePic from "../../Images/users/blank-profile.svg";
import UserUtil from "../../Utils/User";
import ObjectID from "../../../Types/ObjectID";
import Tooltip from "../Tooltip/Tooltip";
import MarkdownViewer from "../Markdown.tsx/LazyMarkdownViewer";
import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import Color from "../../../Types/Color";
import { Translator, translationKey } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import { FeedTimelineEntry } from "./FeedTimeline";
import {
  FeedEntryLead,
  getFeedEntryText,
  hasFeedEntryDetails,
} from "./FeedEntryText";
import {
  FEED_BURST_COLLAPSE_LABEL,
  FEED_BURST_LABELS,
  FeedBurstKind,
} from "./FeedEntryKind";

export interface FeedItemProps {
  key: string;
  textInMarkdown: string;
  element?: ReactElement;
  // What "Show details" unfolds under the entry.
  moreTextInMarkdown?: string;
  // Who did it: their avatar and name lead the entry.
  user?: User | undefined;
  itemDateTime: Date;
  // The entry's kind (FeedEntryKind): its icon and colour in the rail.
  icon: IconProp;
  color: Color;
  safeMode?: boolean | undefined;
  /*
   * Entries of one kind that arrive together fold into the first of them
   * (FeedBurstKind). Unset, the entry always stands on its own.
   */
  burstKind?: FeedBurstKind | string | undefined;
  /*
   * The author of an entry written on someone's behalf, when they are not a
   * OneUptime user - a Slack member who has not connected their account.
   * Shown like a user's name, with a blank avatar.
   */
  authorName?: string | undefined;
  /*
   * Words that follow the author's name on a line of their own above the
   * entry: "via Slack (note added by Nitin)" for a note someone else saved
   * from a chat.
   */
  authorDetail?: string | undefined;
  // The words of the details toggle, where "Show details" is not the best.
  detailsLabel?: string | undefined;
  // The feed's event type, for tests and styling hooks.
  eventType?: string | undefined;
}

export interface ComponentProps {
  entry: FeedTimelineEntry<FeedItemProps>;
  // The last entry of its day draws no line down to the next one.
  isLastInDay: boolean;
  onToggleBurst?: ((burstKey: string) => void) | undefined;
}

const DEFAULT_DETAILS_LABEL: string = translationKey("Show details");
const HIDE_DETAILS_LABEL: string = translationKey("Hide details");

/*
 * The Markdown of an entry. Kept apart and memoised: a feed re-reads the
 * clock every minute so "12 min ago" moves on, and parsing every entry's
 * Markdown again each time would cost more than everything else together.
 */
const FeedMarkdown: FunctionComponent<{
  text: string;
  safeMode: boolean;
}> = React.memo((props: { text: string; safeMode: boolean }): ReactElement => {
  return <MarkdownViewer text={props.text} safeMode={props.safeMode} />;
});

FeedMarkdown.displayName = "FeedMarkdown";

/*
 * The name an entry's author goes by, or undefined for an entry nobody in
 * particular did (OneUptime itself, a rule, a schedule).
 */
const getAuthorName: (item: FeedItemProps) => string | undefined = (
  item: FeedItemProps,
): string | undefined => {
  const userName: string = (
    item.user?.name?.toString() ||
    item.user?.email?.toString() ||
    ""
  ).trim();

  if (userName) {
    return userName;
  }

  const authorName: string = (item.authorName || "").trim();

  return authorName || undefined;
};

const Avatar: FunctionComponent<{ user?: User | undefined }> = (props: {
  user?: User | undefined;
}): ReactElement => {
  const imageUrl: string = props.user?.id
    ? UserUtil.getProfilePictureRoute(props.user.id as ObjectID).toString()
    : BlankProfilePic;

  return (
    <Image
      className="mr-1.5 inline-block h-5 w-5 shrink-0 rounded-full bg-gray-200 align-[-0.3rem] object-cover"
      imageUrl={imageUrl}
      alt=""
      data-testid="feed-entry-avatar"
    />
  );
};

/*
 * One entry of an activity feed, as one row of its timeline:
 *
 *   3:25 PM   ( icon )   [avatar] Nitin posted a private note
 *   12 min ago            > Not sure what is happening here ...
 *                         ▸ Show details
 *
 * The time column is left of the rail from the sm breakpoint; on a phone it
 * sits above the entry, so the text keeps the screen's width. The icon and
 * its colour say what kind of entry it is (FeedEntryKind). The person who
 * did it leads the sentence (FeedEntryText). Details unfold in place rather
 * than in a dialog, so reading never leaves the timeline.
 */
const FeedItem: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const item: FeedItemProps = props.entry.item;
  const detailsId: string = useId();
  const [isDetailsOpen, setIsDetailsOpen] = useState<boolean>(false);

  const authorName: string | undefined = getAuthorName(item);
  const hasAuthorLine: boolean = Boolean(authorName && item.authorDetail);

  const text: FeedEntryLead = useMemo(() => {
    return getFeedEntryText({
      markdown: item.textInMarkdown || "",
      // An author line of its own takes the name out of the sentence.
      actorName: hasAuthorLine ? undefined : authorName,
    });
  }, [item.textInMarkdown, authorName, hasAuthorLine]);

  const hasDetails: boolean = hasFeedEntryDetails(item.moreTextInMarkdown);
  const color: string = item.color.toString();
  const safeMode: boolean = item.safeMode === true;

  const time: ReactElement = (
    <div
      className="col-start-2 row-start-1 flex items-baseline gap-x-2 pb-0.5 sm:col-start-1 sm:block sm:pb-0 sm:pt-1 sm:text-right"
      data-testid="feed-entry-time"
    >
      {props.entry.time.isShown && (
        <Tooltip text={props.entry.time.fullLabel}>
          <time
            dateTime={props.entry.time.isoString}
            className="whitespace-nowrap text-xs font-medium tabular-nums text-gray-600"
          >
            {props.entry.time.label}
            {props.entry.time.zoneName && (
              <span className="ml-1 font-normal text-gray-500">
                {props.entry.time.zoneName}
              </span>
            )}
          </time>
        </Tooltip>
      )}
      {props.entry.time.isShown && props.entry.time.relativeHint && (
        <div
          className="whitespace-nowrap text-xs text-gray-500 sm:mt-0.5"
          data-testid="feed-entry-relative-time"
        >
          {props.entry.time.relativeHint}
        </div>
      )}
    </div>
  );

  const rail: ReactElement = (
    <div className="relative col-start-1 row-span-2 row-start-1 flex justify-center sm:col-start-2 sm:row-span-1">
      {!props.isLastInDay && (
        <span
          className="absolute -bottom-5 top-8 w-px bg-gray-200"
          aria-hidden="true"
          data-testid="feed-entry-line"
        ></span>
      )}
      <span
        className="relative flex h-7 w-7 items-center justify-center rounded-full"
        style={{ backgroundColor: `${color}1f` }}
        data-testid="feed-entry-icon"
        aria-hidden="true"
      >
        <Icon className="h-4 w-4" icon={item.icon} color={item.color} />
      </span>
    </div>
  );

  const authorNameElement: ReactElement | null = authorName ? (
    <strong className="font-semibold text-gray-900">{authorName}</strong>
  ) : null;

  const getLead: () => ReactElement | null = (): ReactElement | null => {
    if (hasAuthorLine) {
      return (
        <div
          className="text-sm leading-6 text-gray-700"
          data-testid="feed-entry-author"
        >
          <Avatar user={item.user} />
          {authorNameElement}{" "}
          <span className="text-gray-500">{item.authorDetail}</span>
        </div>
      );
    }

    if (!authorName) {
      return null;
    }

    if (text.lead) {
      return (
        <div
          className="text-sm leading-6 text-gray-700 [&_div]:inline [&_p]:m-0 [&_p]:inline"
          data-testid="feed-entry-lead"
        >
          <Avatar user={item.user} />
          {!text.leadNamesActor && <>{authorNameElement} </>}
          <FeedMarkdown text={text.lead} safeMode={safeMode} />
        </div>
      );
    }

    return (
      <div
        className="text-sm leading-6 text-gray-700"
        data-testid="feed-entry-author"
      >
        <Avatar user={item.user} />
        {authorNameElement}
      </div>
    );
  };

  const burstToggle: ReactElement | null = props.entry.burstToggle ? (
    <button
      type="button"
      aria-expanded={props.entry.burstToggle.isExpanded}
      onClick={() => {
        props.onToggleBurst?.(props.entry.burstToggle!.burstKey);
      }}
      className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-dashed border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 transition-colors hover:border-gray-400 hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
      data-testid="feed-burst-toggle"
    >
      <Icon
        icon={
          props.entry.burstToggle.isExpanded
            ? IconProp.ChevronUp
            : IconProp.ChevronDown
        }
        className="h-3.5 w-3.5"
      />
      {props.entry.burstToggle.isExpanded
        ? translator.translateText(FEED_BURST_COLLAPSE_LABEL)
        : translator.translatePlural(
            FEED_BURST_LABELS[
              props.entry.burstToggle.burstKind as FeedBurstKind
            ] || FEED_BURST_LABELS[FeedBurstKind.Rule],
            props.entry.burstToggle.foldedCount,
          )}
    </button>
  ) : null;

  const body: string = text.body.trim();

  return (
    <li
      className="relative grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 pb-5 sm:grid-cols-[5.5rem_1.75rem_minmax(0,1fr)]"
      data-testid="feed-entry"
      data-event-type={item.eventType}
      data-in-burst={props.entry.isInBurst ? "true" : undefined}
    >
      {time}
      {rail}
      <div className="col-start-2 row-start-2 min-w-0 pt-1 sm:col-start-3 sm:row-start-1">
        {getLead()}
        {body && (
          <div
            className="text-sm text-gray-700 [&_.max-w-none>*:first-child]:mt-0"
            data-testid="feed-entry-body"
          >
            <FeedMarkdown text={body} safeMode={safeMode} />
          </div>
        )}
        {item.element && <div className="mt-1">{item.element}</div>}
        {hasDetails && (
          <div className="mt-1">
            <button
              type="button"
              aria-expanded={isDetailsOpen}
              aria-controls={detailsId}
              onClick={() => {
                setIsDetailsOpen(!isDetailsOpen);
              }}
              className="inline-flex items-center gap-1 rounded text-xs font-medium text-gray-500 transition-colors hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
              data-testid="feed-entry-details-toggle"
            >
              <Icon
                icon={
                  isDetailsOpen ? IconProp.ChevronDown : IconProp.ChevronRight
                }
                className="h-3.5 w-3.5"
              />
              {translator.translateText(
                isDetailsOpen
                  ? HIDE_DETAILS_LABEL
                  : item.detailsLabel || DEFAULT_DETAILS_LABEL,
              )}
            </button>
            {isDetailsOpen && (
              <div
                id={detailsId}
                className="mt-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 [&_.max-w-none>*:first-child]:mt-0"
                data-testid="feed-entry-details"
              >
                <FeedMarkdown
                  text={item.moreTextInMarkdown || ""}
                  safeMode={safeMode}
                />
              </div>
            )}
          </div>
        )}
        {burstToggle}
      </div>
    </li>
  );
};

export default FeedItem;
