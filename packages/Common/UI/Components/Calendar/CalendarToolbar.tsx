import IconProp from "../../../Types/Icon/IconProp";
import Icon from "../Icon/Icon";
import ViewSwitch, { ViewSwitchOption } from "../ViewSwitch/ViewSwitch";
import CalendarEvent from "../../../Types/Calendar/CalendarEvent";
import { translationKey, Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, { createContext, ReactElement, useContext } from "react";
import {
  Messages,
  NavigateAction,
  ToolbarProps,
  View,
} from "react-big-calendar";

/*
 * The calendar's toolbar, drawn the way the on-call schedule timeline's is
 * (OnCallPolicy/ScheduleTimeline/TimelineToolbar): WHEN on the left - Today,
 * the two arrows, and the period in view, read where the arrows are - and
 * how much of it on the right, as the product's view switch (ViewSwitch,
 * the status timelines' Timeline | Table control).
 *
 * react-big-calendar's own toolbar wrote "Today | Back | Next" as three
 * words in a box, centred the period between two button groups, and filled
 * the chosen view in the accent colour: a second, different switch beside
 * the page's own.
 *
 * Each arrow is named for what it does in the view on screen - "Next month",
 * "Previous week" - for a screen reader and on hover. The agenda, which
 * moves by its own length, keeps react-big-calendar's words for them.
 */

export const CALENDAR_TOOLBAR_TEST_ID: string = "calendar-toolbar";
export const CALENDAR_TOOLBAR_LABEL_TEST_ID: string = "calendar-toolbar-label";
export const CALENDAR_VIEW_SWITCH_TEST_ID: string = "calendar-view-switch";

export const CALENDAR_RANGE_LABEL: string = translationKey("Calendar range");

// The arrows' names in each view: [back, forward].
const ARROW_LABELS: Partial<Record<View, [string, string]>> = {
  month: [translationKey("Previous month"), translationKey("Next month")],
  week: [translationKey("Previous week"), translationKey("Next week")],
  work_week: [translationKey("Previous week"), translationKey("Next week")],
  day: [translationKey("Previous day"), translationKey("Next day")],
};

// The views' names, in English for the switch to translate.
const VIEW_LABELS: Record<View, string> = {
  month: translationKey("Month"),
  week: translationKey("Week"),
  work_week: translationKey("Week"),
  day: translationKey("Day"),
  agenda: translationKey("Agenda"),
};

export const TODAY_BUTTON_CLASS_NAME: string =
  "inline-flex h-8 flex-none items-center rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

export const ARROW_GROUP_CLASS_NAME: string =
  "inline-flex flex-none divide-x divide-gray-200 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm";

export const ARROW_BUTTON_CLASS_NAME: string =
  "inline-flex h-8 w-8 items-center justify-center text-gray-500 hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500";

export interface CalendarToolbarExtraProps {
  /*
   * Drawn after the period's name: what the calendar is doing - "Loading
   * events..." while a new period is read.
   */
  status?: ReactElement | undefined;
}

export function getArrowLabels(data: {
  view: View;
  messages: Messages<CalendarEvent>;
  translator: Translator;
}): { back: string; forward: string } {
  const labels: [string, string] | undefined = ARROW_LABELS[data.view];

  if (labels) {
    return {
      back: data.translator.translateText(labels[0]) || labels[0],
      forward: data.translator.translateText(labels[1]) || labels[1],
    };
  }

  // The agenda: react-big-calendar's own words, already in the reader's language.
  return {
    back: String(data.messages.previous || ""),
    forward: String(data.messages.next || ""),
  };
}

function CalendarToolbar(
  props: ToolbarProps<CalendarEvent> & CalendarToolbarExtraProps,
): ReactElement {
  const translator: Translator = useTranslator();
  const messages: Messages<CalendarEvent> = props.localizer.messages;

  const arrows: { back: string; forward: string } = getArrowLabels({
    view: props.view,
    messages: messages,
    translator: translator,
  });

  const views: Array<View> = Array.isArray(props.views)
    ? (props.views as Array<View>)
    : (Object.keys(props.views || {}) as Array<View>);

  const viewOptions: Array<ViewSwitchOption<View>> = views.map(
    (view: View): ViewSwitchOption<View> => {
      return { value: view, label: VIEW_LABELS[view] || view };
    },
  );

  const navigate: (action: NavigateAction) => void = (
    action: NavigateAction,
  ): void => {
    props.onNavigate(action);
  };

  return (
    <div
      className="oneuptime-calendar-toolbar mb-4 flex flex-wrap items-center justify-between gap-3"
      data-testid={CALENDAR_TOOLBAR_TEST_ID}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <button
          type="button"
          className={TODAY_BUTTON_CLASS_NAME}
          data-testid="calendar-today"
          onClick={() => {
            navigate("TODAY");
          }}
        >
          {messages.today}
        </button>
        <div className={ARROW_GROUP_CLASS_NAME}>
          <button
            type="button"
            className={ARROW_BUTTON_CLASS_NAME}
            aria-label={arrows.back}
            title={arrows.back}
            data-testid="calendar-previous"
            onClick={() => {
              navigate("PREV");
            }}
          >
            <Icon icon={IconProp.ChevronLeft} className="h-4 w-4" />
          </button>
          <button
            type="button"
            className={ARROW_BUTTON_CLASS_NAME}
            aria-label={arrows.forward}
            title={arrows.forward}
            data-testid="calendar-next"
            onClick={() => {
              navigate("NEXT");
            }}
          >
            <Icon icon={IconProp.ChevronRight} className="h-4 w-4" />
          </button>
        </div>
        <h3
          className="ml-1 min-w-0 truncate text-base font-semibold text-gray-900"
          aria-live="polite"
          data-testid={CALENDAR_TOOLBAR_LABEL_TEST_ID}
        >
          {props.label}
        </h3>
        {props.status || <></>}
      </div>

      {viewOptions.length > 1 ? (
        <ViewSwitch<View>
          options={viewOptions}
          value={props.view}
          onChange={(view: View) => {
            props.onView(view);
          }}
          ariaLabel={CALENDAR_RANGE_LABEL}
          dataTestId={CALENDAR_VIEW_SWITCH_TEST_ID}
        />
      ) : (
        <></>
      )}
    </div>
  );
}

/*
 * What the calendar says beside the period (Calendar's toolbarStatus),
 * handed to the toolbar through a context rather than through a new
 * component: react-big-calendar remounts a toolbar whose component changed,
 * and the arrow a keyboard just pressed would lose its focus.
 */
export const CalendarToolbarStatusContext: React.Context<
  ReactElement | undefined
> = createContext<ReactElement | undefined>(undefined);

// The toolbar react-big-calendar draws: the same component for good.
export function ConnectedCalendarToolbar(
  props: ToolbarProps<CalendarEvent>,
): ReactElement {
  const status: ReactElement | undefined = useContext(
    CalendarToolbarStatusContext,
  );

  return <CalendarToolbar {...props} status={status} />;
}

export default CalendarToolbar;
