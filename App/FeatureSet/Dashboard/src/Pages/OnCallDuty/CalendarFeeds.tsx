import SharedCalendarFeedCard, {
  SharedCalendarFeedKind,
} from "../../Components/OnCallPolicy/CalendarFeed/SharedCalendarFeedCard";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Card from "Common/UI/Components/Card/Card";
import Link from "Common/UI/Components/Link/Link";
import Navigation from "Common/UI/Utils/Navigation";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * On-Call Duty > Calendar Feeds.
 *
 * The project-wide shared link lives here because it is not tied to any one
 * schedule, plus a short map of the other two places a calendar link can be
 * found: a reader's own link (User Settings) and the per-schedule team link
 * (each schedule's page). Without this map the feature is three unrelated
 * cards on three pages.
 */
const OnCallDutyCalendarFeeds: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { translateString } = useTranslateValue();

  const personalRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.USER_SETTINGS_ON_CALL_CALENDAR_FEED] as Route,
  );

  const schedulesRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.ON_CALL_DUTY_SCHEDULES] as Route,
  );

  return (
    <Fragment>
      <Card
        title="Calendar Feeds"
        description="Put on-call shifts in Google Calendar, Outlook, Apple Calendar or any app that can subscribe to a calendar link. Links are read-only and refresh on the calendar app's own schedule."
        buttons={[
          {
            title: "Your personal feed",
            icon: IconProp.User,
            onClick: () => {
              Navigation.navigate(personalRoute);
            },
          },
        ]}
      >
        <div className="space-y-2 text-sm text-gray-600">
          <div data-testid="calendar-feeds-personal-pointer">
            <span className="font-medium text-gray-900">
              {translateString("Your own shifts")}
            </span>
            {" - "}
            {translateString(
              "a private link with every shift you hold on this project, plus reminders before shifts.",
            )}{" "}
            <Link
              to={personalRoute}
              className="text-indigo-600 hover:underline"
            >
              {translateString("Open your calendar feed")}
            </Link>
          </div>
          <div data-testid="calendar-feeds-schedule-pointer">
            <span className="font-medium text-gray-900">
              {translateString("One schedule, everyone's shifts")}
            </span>
            {" - "}
            {translateString(
              "a shared team link published from the schedule's own page.",
            )}{" "}
            <Link
              to={schedulesRoute}
              className="text-indigo-600 hover:underline"
            >
              {translateString("Go to schedules")}
            </Link>
          </div>
          <div data-testid="calendar-feeds-project-pointer">
            <span className="font-medium text-gray-900">
              {translateString("The whole project")}
            </span>
            {" - "}
            {translateString(
              "one shared link with every shift on every schedule, published below.",
            )}
          </div>
        </div>
      </Card>

      <SharedCalendarFeedCard kind={SharedCalendarFeedKind.Project} />
    </Fragment>
  );
};

export default OnCallDutyCalendarFeeds;
