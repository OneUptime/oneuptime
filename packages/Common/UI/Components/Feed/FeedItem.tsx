import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import User from "../../../Models/DatabaseModels/User";
import Image from "../Image/Image";
import BlankProfilePic from "../../Images/users/blank-profile.svg";
import UserUtil from "../../Utils/User";
import ObjectID from "../../../Types/ObjectID";
import Tooltip from "../Tooltip/Tooltip";
import MarkdownViewer from "../Markdown.tsx/LazyMarkdownViewer";
import { getShownMarkdownReadingDirection } from "../Markdown.tsx/MarkdownReadingDirection";
import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import Color from "../../../Types/Color";
import { Translator, translationKey } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import { FeedTimelineEntry } from "./FeedTimeline";
import {
  FeedEntryLead,
  FeedNoteParts,
  getFeedEntryText,
  getFeedNoteParts,
  hasFeedEntryDetails,
  tidyFeedEntryDetails,
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
  /*
   * The project API key that made the change, by the name it had then,
   * when no person did (IncidentFeed.apiKeyName): it leads the entry as a
   * person would, with a key for a picture, marked "API key".
   */
  apiKeyName?: string | undefined;
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
   * Shown like a user's name, with a blank avatar. It wins over `user`, who
   * is then whoever saved the entry for them (named in authorDetail).
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
  /*
   * What somebody wrote - a note, a root cause (FeedEntryKind.isNote): the
   * body is set apart in a card, as the Notes page draws a note.
   */
  isNote?: boolean | undefined;
  // The feed's event type, for tests and styling hooks.
  eventType?: string | undefined;
}

/*
 * What the feed asks an entry to take keyboard focus for: the entry itself
 * (the first one a burst unfolded) or its burst button (folded again).
 */
export type FeedItemFocusRequest = "entry" | "burst-toggle";

export interface ComponentProps {
  entry: FeedTimelineEntry<FeedItemProps>;
  // The last entry of its day draws no line down to the next one.
  isLastInDay: boolean;
  onToggleBurst?: ((burstKey: string) => void) | undefined;
  focusRequest?: FeedItemFocusRequest | undefined;
  // Called once the entry has taken the focus it was asked to.
  onFocusTaken?: (() => void) | undefined;
}

/*
 * The columns of a feed entry: on a phone the rail and the entry, from sm
 * the time, the rail and the entry. The time column is as wide as the
 * longest "N min. ago" the Dashboard's languages write ("for 24 min siden",
 * "24 min. geleden"), so none runs into the rail. FeedSkeleton draws the
 * same columns.
 */
export const FEED_ENTRY_GRID_CLASS_NAME: string =
  "grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 sm:grid-cols-[6.25rem_1.75rem_minmax(0,1fr)]";

const DEFAULT_DETAILS_LABEL: string = translationKey("Show details");
const HIDE_DETAILS_LABEL: string = translationKey("Hide details");
// Beside the name of an API key that made the change.
const API_KEY_LABEL: string = translationKey("API key");

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
 * Whether the entry names an author of its own: someone who is not a
 * OneUptime user, such as the Slack member whose message was saved as a note.
 */
const hasNamedAuthor: (item: FeedItemProps) => boolean = (
  item: FeedItemProps,
): boolean => {
  return Boolean((item.authorName || "").trim());
};

/*
 * The API key an entry is by: one no person and no named author made. A
 * user, when the entry has one, is who made it.
 */
const getApiKeyName: (item: FeedItemProps) => string | undefined = (
  item: FeedItemProps,
): string | undefined => {
  if (hasNamedAuthor(item) || item.user) {
    return undefined;
  }

  return (item.apiKeyName || "").trim() || undefined;
};

/*
 * The name an entry's author goes by, or undefined for an entry nobody in
 * particular did (OneUptime itself, a rule, a schedule). A named author wins
 * over the entry's user, who only saved it for them; an API key leads an
 * entry no person made.
 */
const getAuthorName: (item: FeedItemProps) => string | undefined = (
  item: FeedItemProps,
): string | undefined => {
  if (hasNamedAuthor(item)) {
    return (item.authorName || "").trim();
  }

  const userName: string = (
    item.user?.name?.toString() ||
    item.user?.email?.toString() ||
    ""
  ).trim();

  return userName || getApiKeyName(item);
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

// An API key's picture: a key, where a person's would be.
const ApiKeyAvatar: FunctionComponent = (): ReactElement => {
  return (
    <span
      className="mr-1.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-100 align-[-0.3rem]"
      data-testid="feed-entry-api-key-avatar"
      aria-hidden="true"
    >
      <Icon icon={IconProp.Key} className="h-3 w-3 text-gray-500" />
    </span>
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
  const entryRef: React.MutableRefObject<HTMLLIElement | null> =
    useRef<HTMLLIElement | null>(null);
  const burstToggleRef: React.MutableRefObject<HTMLButtonElement | null> =
    useRef<HTMLButtonElement | null>(null);

  /*
   * A burst's button goes away when it is pressed (it moves to the other
   * end of the group), so the feed hands focus on: to the first entry that
   * unfolded, without scrolling (it is where the button was), or back to
   * the button that unfolds them, scrolled into view when the reader had
   * read on past it.
   */
  useEffect(() => {
    if (!props.focusRequest) {
      return;
    }

    if (props.focusRequest === "entry") {
      entryRef.current?.focus({ preventScroll: true });
    } else {
      burstToggleRef.current?.focus();
    }

    props.onFocusTaken?.();
  }, [props.focusRequest]);

  const authorName: string | undefined = getAuthorName(item);
  const isApiKeyAuthor: boolean = Boolean(getApiKeyName(item));
  const hasAuthorLine: boolean = Boolean(authorName && item.authorDetail);
  // A named author is not the user: their picture would be someone else's.
  const avatarUser: User | undefined = hasNamedAuthor(item)
    ? undefined
    : item.user;

  const text: FeedEntryLead = useMemo(() => {
    return getFeedEntryText({
      markdown: item.textInMarkdown || "",
      // An author line of its own takes the name out of the sentence.
      actorName: hasAuthorLine ? undefined : authorName,
    });
  }, [item.textInMarkdown, authorName, hasAuthorLine]);

  const hasDetails: boolean = hasFeedEntryDetails(item.moreTextInMarkdown);
  // Who older owner notifications reached, as a list (tidyFeedEntryDetails).
  const details: string = useMemo(() => {
    return tidyFeedEntryDetails(item.moreTextInMarkdown);
  }, [item.moreTextInMarkdown]);
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
    <>
      <strong className="font-semibold text-gray-900">{authorName}</strong>
      {isApiKeyAuthor && (
        <span
          className="ml-1.5 inline-flex items-center rounded bg-gray-100 px-1.5 py-0.5 align-[0.05rem] text-xs font-medium text-gray-600"
          data-testid="feed-entry-api-key-badge"
        >
          {translator.translateText(API_KEY_LABEL)}
        </span>
      )}
    </>
  ) : null;

  const authorAvatar: ReactElement = isApiKeyAuthor ? (
    <ApiKeyAvatar />
  ) : (
    <Avatar user={avatarUser} />
  );

  const getLead: () => ReactElement | null = (): ReactElement | null => {
    if (hasAuthorLine) {
      return (
        <div
          className="text-sm leading-6 text-gray-700"
          data-testid="feed-entry-author"
        >
          {authorAvatar}
          {authorNameElement}{" "}
          <span className="text-gray-500">{item.authorDetail}</span>
        </div>
      );
    }

    if (!authorName) {
      return null;
    }

    if (text.lead) {
      /*
       * The name and the sentence after it are one line, read the way its
       * words are written: "Sara Ahmadi changed Monitor ..." left to right on
       * a Persian page too, its name first, as the entry's text under it.
       */
      return (
        <div
          className="text-sm leading-6 text-gray-700 [&_div]:inline [&_p]:m-0 [&_p]:inline"
          data-testid="feed-entry-lead"
          dir={getShownMarkdownReadingDirection(
            `${text.leadNamesActor ? "" : authorName} ${text.lead}`,
          )}
        >
          {authorAvatar}
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
        {authorAvatar}
        {authorNameElement}
      </div>
    );
  };

  const burstToggle: ReactElement | null = props.entry.burstToggle ? (
    <button
      ref={burstToggleRef}
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

  /*
   * What somebody wrote - a note, a root cause - goes in a card, as the
   * Notes page draws a note. The sentence that introduces it stays outside:
   * after the author's name, or on its own when nobody leads it.
   */
  const noteParts: FeedNoteParts | null =
    item.isNote && body
      ? text.lead
        ? { note: body }
        : getFeedNoteParts(body)
      : null;

  /*
   * The first entry a burst unfolds takes the focus of the button that
   * unfolded it (see the effect above): reachable by script, never by Tab.
   */
  return (
    <li
      ref={entryRef}
      tabIndex={props.entry.isFirstInFold ? -1 : undefined}
      className={`relative ${FEED_ENTRY_GRID_CLASS_NAME} rounded-lg pb-5 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500`}
      data-testid="feed-entry"
      data-event-type={item.eventType}
      data-in-burst={props.entry.isInBurst ? "true" : undefined}
    >
      {time}
      {rail}
      {/*
       * break-words: a long link or token pasted into a note wraps inside
       * the entry, instead of running out of its card on a phone.
       */}
      <div
        className="col-start-2 row-start-2 min-w-0 break-words pt-1 sm:col-start-3 sm:row-start-1"
        data-testid="feed-entry-content"
      >
        {getLead()}
        {noteParts && noteParts.intro && (
          <div
            className="text-sm text-gray-700 [&_.max-w-none>*:first-child]:mt-0 [&_.max-w-none>*:last-child]:mb-0"
            data-testid="feed-entry-intro"
          >
            <FeedMarkdown text={noteParts.intro} safeMode={safeMode} />
          </div>
        )}
        {noteParts && (
          <div
            className="mt-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 shadow-[0_1px_2px_rgba(16,24,40,0.04)] [&_.max-w-none>*:first-child]:mt-0 [&_.max-w-none>*:last-child]:mb-0"
            data-testid="feed-entry-body"
            data-note="true"
          >
            <FeedMarkdown text={noteParts.note} safeMode={safeMode} />
          </div>
        )}
        {!noteParts && body && (
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
                <FeedMarkdown text={details} safeMode={safeMode} />
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
