import CalendarFeedAPI from "./CalendarFeedAPI";
import { MyShiftsResponse } from "./CalendarFeedTypes";
import {
  STANDING_ASSIGNMENTS_COPY,
  UPCOMING_SHIFTS_CARD_TITLE,
  UPCOMING_SHIFTS_DESCRIPTION,
  UPCOMING_SHIFTS_EMPTY_DESCRIPTION,
  UPCOMING_SHIFTS_EMPTY_TITLE,
  UPCOMING_SHIFTS_TRUNCATED_COPY,
  UPCOMING_SHIFTS_TRUNCATED_EMPTY_COPY,
  UpcomingShiftsWindow,
  getUpcomingShiftsWindow,
} from "./CalendarFeedUtil";
import FeedCardFooter from "./FeedCardFooter";
import FeedEmptyState from "./FeedEmptyState";
import UpcomingShiftRow from "./UpcomingShiftRow";
import {
  UpcomingShiftSpan,
  buildUpcomingShiftSpans,
  getUpcomingShiftsFold,
  isUpcomingShiftsFoldable,
  shouldShowLayerName,
  shouldShowProjectNames,
} from "./UpcomingShiftSpans";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import { FeedClock, getFeedClock } from "Common/UI/Components/Feed/FeedTime";
import Icon from "Common/UI/Components/Icon/Icon";
import API from "Common/UI/Utils/API/API";
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
 * "Upcoming shifts", from the same materializer the feed is rendered from, so
 * that what this card shows and what lands in somebody's calendar cannot
 * disagree. It is the in-app answer to the feed's one weakness: a calendar
 * client polls on its own schedule, this card is live.
 *
 * It answers what a person comes to it with, at a glance: am I on call now,
 * and until when; when is my next shift, and how long is it. Back-to-back
 * turns read as one stretch (UpcomingShiftSpans), each row says its times in
 * the reader's zone and words (UpcomingShiftTime), the zone is named once,
 * and a long month folds after the first rows.
 *
 * Standing assignments (a user or a team named directly on an escalation
 * rule) are deliberately absent, and the card's footer says so, because a
 * reader who knows they are on a policy and sees no row would otherwise
 * assume the list is broken.
 */
export interface ComponentProps {
  /** Injected by tests; the page passes nothing and gets the real clock. */
  now?: Date | undefined;
}

/*
 * The card's body - its notices, the list, the empty panel - is no wider
 * than a comfortable reading measure, as the link card's subscribe block
 * on its own is (SUBSCRIBE_BLOCK_ALONE_CLASS_NAME): on a wide screen a row's
 * length and Get cover stay beside it rather than at the far edge of a
 * 1,900px card, where the maintainer found Get cover.
 */
export const UPCOMING_SHIFTS_BODY_CLASS_NAME: string = "max-w-4xl space-y-4";

const UpcomingShiftsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const listId: string = useId();

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [response, setResponse] = useState<MyShiftsResponse | null>(null);
  // The window the shown shifts were asked for.
  const [askedWindow, setAskedWindow] = useState<UpcomingShiftsWindow | null>(
    null,
  );
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  const now: Date = props.now || OneUptimeDate.getCurrentDate();

  /*
   * The first read, and Try again after one failed, show the loader. A
   * Refresh with shifts on screen keeps them there until the answer comes,
   * so the card does not collapse to a spinner under the reader's pointer
   * (as the link card above behaves since its redesign).
   */
  const load: () => Promise<void> = async (): Promise<void> => {
    const hasShifts: boolean = response !== null;

    if (hasShifts) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    setError("");

    try {
      const asked: UpcomingShiftsWindow = getUpcomingShiftsWindow(
        props.now || OneUptimeDate.getCurrentDate(),
      );
      const result: MyShiftsResponse = await CalendarFeedAPI.getMyShifts(asked);
      setResponse(result);
      setAskedWindow(asked);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  const reload: () => void = (): void => {
    load().catch(() => {
      // load routes every failure into the error state.
    });
  };

  useEffect(() => {
    reload();
  }, []);

  const clock: FeedClock = getFeedClock({
    language: translator.language,
    now: now,
  });

  const spans: Array<UpcomingShiftSpan> = response
    ? buildUpcomingShiftSpans(response.shifts, now, askedWindow?.to)
    : [];

  const showProjectNames: boolean = shouldShowProjectNames(spans);

  /*
   * The read failed: the server's reason, and a way to try again without
   * reloading the page. Shifts already on screen stay under it.
   */
  const loadError: ReactElement | null = error ? (
    <Alert
      type={AlertType.DANGER}
      strongTitle="Could not load your shifts."
      title={error}
      textOnRight="Try again"
      dataTestId="upcoming-shifts-load-error"
      onClick={reload}
    />
  ) : null;

  /*
   * The resolver reports `truncated` independently of how many shifts came
   * back: a schedule that hit the simulation cap emits NOTHING for the capped
   * layer rather than shifts attributed to the wrong person, so an empty list
   * can still be an incomplete answer. The notice therefore renders above the
   * empty state as well - "you have no shifts" on its own would be a lie.
   */
  const truncatedNotice: ReactElement | null =
    response && response.truncated ? (
      <Alert
        type={AlertType.WARNING}
        title={translator.translateText(UPCOMING_SHIFTS_TRUNCATED_COPY) || ""}
        dataTestId="upcoming-shifts-truncated"
      />
    ) : null;

  let list: ReactElement | null = null;

  if (response && spans.length === 0) {
    list = response.truncated ? (
      <p
        className="text-sm leading-6 text-gray-500"
        data-testid="upcoming-shifts-empty"
      >
        {translator.translateText(UPCOMING_SHIFTS_TRUNCATED_EMPTY_COPY)}
      </p>
    ) : (
      <div data-testid="upcoming-shifts-empty">
        <FeedEmptyState
          title={UPCOMING_SHIFTS_EMPTY_TITLE}
          description={UPCOMING_SHIFTS_EMPTY_DESCRIPTION}
          icon={IconProp.Calendar}
          idPrefix="upcoming-shifts"
        />
      </div>
    );
  } else if (spans.length > 0) {
    const fold: { shown: number; hidden: number } = getUpcomingShiftsFold({
      total: spans.length,
      isExpanded: isExpanded,
    });

    list = (
      <div>
        <ul
          id={listId}
          className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white"
          data-testid="upcoming-shifts-list"
          aria-label={translator.translateText(UPCOMING_SHIFTS_CARD_TITLE)}
        >
          {spans
            .slice(0, fold.shown)
            .map((span: UpcomingShiftSpan): ReactElement => {
              return (
                <UpcomingShiftRow
                  key={span.key}
                  span={span}
                  clock={clock}
                  showLayerName={shouldShowLayerName(span, spans)}
                  showProjectName={showProjectNames}
                />
              );
            })}
        </ul>

        {isUpcomingShiftsFoldable(spans.length) && (
          <button
            type="button"
            className="mt-3 inline-flex items-center gap-1 rounded-md text-sm font-medium text-indigo-600 hover:text-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
            aria-expanded={isExpanded}
            aria-controls={listId}
            data-testid="upcoming-shifts-fold"
            onClick={() => {
              setIsExpanded(!isExpanded);
            }}
          >
            <span>
              {isExpanded
                ? translator.translateText("Show fewer shifts")
                : translator.translatePlural(
                    {
                      one: "Show {{count}} more shift",
                      other: "Show {{count}} more shifts",
                    },
                    fold.hidden,
                  )}
            </span>
            <Icon
              icon={isExpanded ? IconProp.ChevronUp : IconProp.ChevronDown}
              className="h-4 w-4 flex-none"
            />
          </button>
        )}
      </div>
    );
  }

  let body: ReactElement;

  if (isLoading) {
    body = (
      <div data-testid="upcoming-shifts-loading">
        <ComponentLoader />
      </div>
    );
  } else {
    body = (
      <div className={UPCOMING_SHIFTS_BODY_CLASS_NAME}>
        {loadError}
        {truncatedNotice}
        {list}
      </div>
    );
  }

  return (
    <Card
      title={UPCOMING_SHIFTS_CARD_TITLE}
      description={translator.translateTemplate(UPCOMING_SHIFTS_DESCRIPTION, {
        timezone: clock.timezone,
      })}
      buttons={[
        {
          title: "Refresh",
          icon: IconProp.Refresh,
          isLoading: isRefreshing,
          disabled: isLoading || isRefreshing,
          onClick: reload,
        },
      ]}
    >
      <div data-testid="upcoming-shifts">
        {body}
        <FeedCardFooter
          icon={IconProp.Info}
          dataTestId="upcoming-shifts-footer"
        >
          {translator.translateText(STANDING_ASSIGNMENTS_COPY)}
        </FeedCardFooter>
      </div>
    </Card>
  );
};

export default UpcomingShiftsCard;
