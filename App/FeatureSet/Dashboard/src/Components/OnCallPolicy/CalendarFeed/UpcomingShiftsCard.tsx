import CalendarFeedAPI from "./CalendarFeedAPI";
import { MyShiftsResponse } from "./CalendarFeedTypes";
import {
  STANDING_ASSIGNMENTS_COPY,
  ShiftDayGroup,
  UPCOMING_SHIFTS_CARD_TITLE,
  getUpcomingShiftsWindow,
  groupShiftsByDay,
  isCoveringShift,
} from "./CalendarFeedUtil";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import { Blue500, Purple500 } from "Common/Types/BrandColors";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { MaterializedShiftJson } from "Common/Types/OnCallDutyPolicy/MaterializedShift";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Link from "Common/UI/Components/Link/Link";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import API from "Common/UI/Utils/API/API";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * "Upcoming shifts" from the same materializer the feed is rendered from, so
 * that what this card shows and what lands in somebody's calendar cannot
 * disagree. It is the in-app answer to the feed's one weakness: a calendar
 * client polls on its own schedule, this card is live.
 *
 * Standing assignments (a user or a team named directly on an escalation
 * rule) are deliberately absent, and the card says so, because a reader who
 * knows they are on a policy and sees no row would otherwise assume the list
 * is broken.
 */
export interface ComponentProps {
  /** Injected by tests; the page passes nothing and gets the real clock. */
  now?: Date | undefined;
}

const UpcomingShiftsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [response, setResponse] = useState<MyShiftsResponse | null>(null);

  const now: Date = props.now || OneUptimeDate.getCurrentDate();

  const load: () => Promise<void> = async (): Promise<void> => {
    setIsLoading(true);
    setError("");

    try {
      const result: MyShiftsResponse = await CalendarFeedAPI.getMyShifts(
        getUpcomingShiftsWindow(now),
      );
      setResponse(result);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setResponse(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load().catch(() => {
      // load routes every failure into the error state.
    });
  }, []);

  const overridesRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.ON_CALL_DUTY_POLICY_USER_OVERRIDES] as Route,
  );

  const renderShift: (shift: MaterializedShiftJson) => ReactElement = (
    shift: MaterializedShiftJson,
  ): ReactElement => {
    const start: Date = OneUptimeDate.fromString(shift.start);
    const end: Date = OneUptimeDate.fromString(shift.end);

    return (
      <div
        key={shift.shiftKey}
        className="flex flex-wrap items-center justify-between gap-2 py-2"
        data-testid="upcoming-shift-row"
      >
        <div className="min-w-0">
          <div className="text-sm text-gray-900">
            <span className="font-medium">
              {OneUptimeDate.toTimeString(start)}
            </span>
            {" – "}
            <span className="font-medium">
              {OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(end)}
            </span>
            {" · "}
            <span>{shift.scheduleName}</span>
            {shift.projectName && (
              <span className="text-gray-500"> · {shift.projectName}</span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {isCoveringShift(shift) && shift.override && (
              <Pill
                text={`${translateString("Covering for")} ${shift.override.originalUserName}`}
                color={Blue500}
                size={PillSize.Small}
                isMinimal={true}
              />
            )}
            {shift.policyVariantOf && (
              <Pill
                text={`${translateString("Only on policy")} ${shift.policyVariantOf.policyName}`}
                color={Purple500}
                size={PillSize.Small}
                isMinimal={true}
              />
            )}
            {shift.layerName && (
              <span className="text-xs text-gray-500">{shift.layerName}</span>
            )}
          </div>
        </div>
        <Link
          to={overridesRoute}
          className="text-sm text-indigo-600 hover:underline"
        >
          {translateString("Get cover")}
        </Link>
      </div>
    );
  };

  let body: ReactElement;

  if (isLoading) {
    body = <ComponentLoader />;
  } else if (error) {
    body = (
      <ErrorMessage
        message={error}
        onRefreshClick={() => {
          load().catch(() => {
            // handled by load
          });
        }}
      />
    );
  } else if (!response || response.shifts.length === 0) {
    body = (
      <div
        className="text-sm text-gray-500"
        data-testid="upcoming-shifts-empty"
      >
        {translateString(
          "You have no shifts on any schedule in the next 30 days.",
        )}
      </div>
    );
  } else {
    const groups: Array<ShiftDayGroup> = groupShiftsByDay(response.shifts);

    body = (
      <div className="space-y-4">
        {response.truncated && (
          <div
            className="text-sm text-amber-700"
            data-testid="upcoming-shifts-truncated"
          >
            {translateString(
              "One of your schedules is too complex to compute fully; some shifts may be missing.",
            )}
          </div>
        )}
        {groups.map((group: ShiftDayGroup): ReactElement => {
          return (
            <div key={group.dayKey} data-testid="upcoming-shift-day">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                {OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                  group.day,
                  true,
                )}
              </div>
              <div className="divide-y divide-gray-100">
                {group.shifts.map(renderShift)}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <Card
      title={UPCOMING_SHIFTS_CARD_TITLE}
      description={STANDING_ASSIGNMENTS_COPY}
      buttons={[
        {
          title: "Refresh",
          icon: IconProp.Refresh,
          onClick: () => {
            load().catch(() => {
              // handled by load
            });
          },
        },
      ]}
    >
      {body}
    </Card>
  );
};

export default UpcomingShiftsCard;
