import { Blue500, BrightColors } from "Common/Types/BrandColors";
import CalendarEvent from "Common/Types/Calendar/CalendarEvent";
import Color from "Common/Types/Color";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import HashCode from "Common/Types/HashCode";
import LayerUtil, { LayerProps } from "Common/Types/OnCallDutyPolicy/Layer";
import StartAndEndTime from "Common/Types/Time/StartAndEndTime";
import Calendar from "Common/UI/Components/Calendar/Calendar";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import OnCallDutyPolicyScheduleLayer from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import User from "Common/Models/DatabaseModels/User";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";

export interface ComponentProps {
  layers: Array<OnCallDutyPolicyScheduleLayer>;
  allLayerUsers: Dictionary<Array<OnCallDutyPolicyScheduleLayerUser>>;
  showFieldLabel?: boolean;
  id?: string | undefined;
}

interface UserColorAssignment {
  userId: string;
  name: string;
  email: string;
  color: string;
}

const getColorForUserId: (userId: string) => string = (
  userId: string,
): string => {
  const colorListLength: number = BrightColors.length;
  const colorIndex: number = HashCode.fromString(userId) % colorListLength;
  return (BrightColors[colorIndex] as Color)?.toString() || Blue500.toString();
};

const LayersPreview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [startTime, setStartTime] = useState<Date>(
    OneUptimeDate.getStartOfDay(OneUptimeDate.getCurrentDate()),
  );
  const [endTime, setEndTime] = useState<Date>(
    OneUptimeDate.getEndOfDay(OneUptimeDate.getCurrentDate()),
  );

  const [calendarEvents, setCalendarEvents] = useState<Array<CalendarEvent>>(
    [],
  );

  const layerUtil: LayerUtil = new LayerUtil();

  const uniqueUsers: Array<UserColorAssignment> = useMemo(() => {
    const seen: Set<string> = new Set<string>();
    const result: Array<UserColorAssignment> = [];

    for (const key in props.allLayerUsers) {
      const layerUsers: Array<OnCallDutyPolicyScheduleLayerUser> =
        props.allLayerUsers[key] || [];

      for (const layerUser of layerUsers) {
        const user: User | undefined = layerUser.user;
        const userId: string = user?.id?.toString() || "";

        if (!user || !userId || seen.has(userId)) {
          continue;
        }

        seen.add(userId);
        result.push({
          userId,
          name: user.name?.toString() || "Unknown",
          email: user.email?.toString() || "",
          color: getColorForUserId(userId),
        });
      }
    }

    return result;
  }, [props.allLayerUsers]);

  useEffect(() => {
    setCalendarEvents(getCalendarEvents(startTime, endTime));
  }, [props.layers, props.allLayerUsers, startTime, endTime]);

  type GetCalendarEventsFunction = (
    calendarStartTime: Date,
    calendarEndTime: Date,
  ) => Array<CalendarEvent>;

  const getCalendarEvents: GetCalendarEventsFunction = (
    calendarStartTime: Date,
    calendarEndTime: Date,
  ): Array<CalendarEvent> => {
    const layerProps: Array<LayerProps> = [];

    const users: Array<User> = [];

    for (const key in props.allLayerUsers) {
      const layerUsers: Array<OnCallDutyPolicyScheduleLayerUser> =
        props.allLayerUsers[key] || [];

      for (const layerUser of layerUsers) {
        users.push(layerUser.user!);
      }
    }

    for (const layer of props.layers) {
      const layerUsers: Array<OnCallDutyPolicyScheduleLayerUser> =
        props.allLayerUsers[layer.id?.toString() || ""] || [];

      layerProps.push({
        users: layerUsers.map(
          (layerUser: OnCallDutyPolicyScheduleLayerUser) => {
            return layerUser.user!;
          },
        ),
        startDateTimeOfLayer: layer.startsAt!,
        handOffTime: layer.handOffTime!,
        rotation: layer.rotation!,
        restrictionTimes: layer.restrictionTimes!,
      });
    }

    const events: Array<CalendarEvent> = layerUtil.getMultiLayerEvents({
      calendarEndDate: calendarEndTime,
      calendarStartDate: calendarStartTime,
      layers: layerProps,
    });

    events.forEach((event: CalendarEvent) => {
      const userId: string = event.title;

      const user: User | undefined = users.find((user: User) => {
        return user.id?.toString() === userId;
      });

      if (!user) {
        return;
      }

      event.color = getColorForUserId(userId);

      event.title = `${
        (user.name?.toString() || "") +
        " " +
        "(" +
        (user.email?.toString() || "") +
        ")"
      }`;
    });

    return events;
  };

  return (
    <div id={props.id}>
      {props.showFieldLabel && (
        <FieldLabelElement
          required={true}
          title="Layer Preview"
          description={
            "Here is a preview of who is on call and when. This is based on your local timezone - " +
            OneUptimeDate.getCurrentTimezoneString()
          }
        />
      )}

      {uniqueUsers.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            On-Call Users
          </span>
          {uniqueUsers.map((u: UserColorAssignment) => {
            return (
              <div
                key={u.userId}
                className="inline-flex items-center gap-1.5 rounded-md bg-white px-2 py-1 text-xs text-gray-700 ring-1 ring-inset ring-gray-200"
                title={u.email}
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: u.color }}
                />
                <span className="font-medium text-gray-900">{u.name}</span>
              </div>
            );
          })}
        </div>
      )}

      <Calendar
        events={calendarEvents}
        onRangeChange={(startEndTime: StartAndEndTime) => {
          setStartTime(startEndTime.startTime);
          setEndTime(startEndTime.endTime);
        }}
      />
    </div>
  );
};

export default LayersPreview;
