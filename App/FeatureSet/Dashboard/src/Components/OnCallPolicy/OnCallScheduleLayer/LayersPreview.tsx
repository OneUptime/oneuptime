import { Blue500, BrightColors } from "Common/Types/BrandColors";
import CalendarEvent from "Common/Types/Calendar/CalendarEvent";
import Color from "Common/Types/Color";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import HashCode from "Common/Types/HashCode";
import LayerUtil, { LayerProps } from "Common/Types/OnCallDutyPolicy/Layer";
import UserOverrideUtil, {
  OverrideEventMeta,
  UserOverrideRecord,
} from "Common/Types/OnCallDutyPolicy/UserOverrideUtil";
import StartAndEndTime from "Common/Types/Time/StartAndEndTime";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import GreaterThanOrEqual from "Common/Types/BaseDatabase/GreaterThanOrEqual";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import LessThanOrEqual from "Common/Types/BaseDatabase/LessThanOrEqual";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import Calendar from "Common/UI/Components/Calendar/Calendar";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import OnCallDutyPolicyScheduleLayer from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import OnCallDutyPolicyUserOverride from "Common/Models/DatabaseModels/OnCallDutyPolicyUserOverride";
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

interface UserInfo {
  name: string;
  email: string;
}

interface UserColorAssignment {
  userId: string;
  name: string;
  email: string;
  color: string;
  isSubstitute?: boolean;
}

const getColorForUserId: (userId: string) => string = (
  userId: string,
): string => {
  const colorListLength: number = BrightColors.length;
  /*
   * HashCode.fromString may return a negative 32-bit int; abs first so the
   * modulo lands inside the BrightColors array instead of falling through to
   * the Blue500 default for every user with a negative hash.
   */
  const colorIndex: number =
    Math.abs(HashCode.fromString(userId)) % colorListLength;
  return (BrightColors[colorIndex] as Color)?.toString() || Blue500.toString();
};

const getDisplayName: (info: UserInfo | undefined) => string = (
  info: UserInfo | undefined,
): string => {
  if (!info) {
    return "Unknown user";
  }
  return info.name || info.email || "Unknown user";
};

const formatUserLabel: (info: UserInfo | undefined) => string = (
  info: UserInfo | undefined,
): string => {
  if (!info) {
    return "Unknown user";
  }
  if (info.name && info.email) {
    return `${info.name} (${info.email})`;
  }
  return info.name || info.email || "Unknown user";
};

const LayersPreview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  /*
   * Seed the visible range to the current week so the initial render generates
   * events for the whole week the calendar actually shows. The calendar below
   * uses react-big-calendar's default "week" view, but react-big-calendar does
   * not fire onRangeChange on initial mount (only on navigation / view switch).
   * Initializing to a single day made the calendar show just one occurrence
   * until a view was toggled. https://github.com/OneUptime/oneuptime/issues/2466
   */
  const [startTime, setStartTime] = useState<Date>(
    OneUptimeDate.getStartOfTheWeek(OneUptimeDate.getCurrentDate()),
  );
  const [endTime, setEndTime] = useState<Date>(
    OneUptimeDate.getEndOfTheWeek(OneUptimeDate.getCurrentDate()),
  );

  const [calendarEvents, setCalendarEvents] = useState<Array<CalendarEvent>>(
    [],
  );

  const [overrides, setOverrides] = useState<
    Array<OnCallDutyPolicyUserOverride>
  >([]);

  const [overrideUserInfo, setOverrideUserInfo] = useState<
    Dictionary<UserInfo>
  >({});

  const scheduleUsersById: Dictionary<UserInfo> = useMemo(() => {
    const map: Dictionary<UserInfo> = {};
    for (const key in props.allLayerUsers) {
      const layerUsers: Array<OnCallDutyPolicyScheduleLayerUser> =
        props.allLayerUsers[key] || [];
      for (const layerUser of layerUsers) {
        const user: User | undefined = layerUser.user;
        const userId: string = user?.id?.toString() || "";
        if (user && userId && !map[userId]) {
          map[userId] = {
            name: user.name?.toString() || "",
            email: user.email?.toString() || "",
          };
        }
      }
    }
    return map;
  }, [props.allLayerUsers]);

  const scheduleUserIds: Set<string> = useMemo(() => {
    return new Set<string>(Object.keys(scheduleUsersById));
  }, [scheduleUsersById]);

  /*
   * Fetch user overrides that touch this calendar window and apply to any
   * user already present in this schedule. Refetches when the range changes.
   *
   * The schedule preview has no policy context (a schedule can be referenced
   * by many policies via escalation rules), so only global overrides are
   * shown here. Policy-scoped overrides are intentionally excluded — surfacing
   * them in a policy-less view would misrepresent how they actually apply
   * during alert dispatch.
   */
  useEffect(() => {
    const projectId: string =
      ProjectUtil.getCurrentProjectId()?.toString() || "";
    if (!projectId || scheduleUserIds.size === 0) {
      setOverrides([]);
      setOverrideUserInfo({});
      return;
    }

    let isCancelled: boolean = false;

    const fetchOverrides: () => Promise<void> = async (): Promise<void> => {
      try {
        const result: ListResult<OnCallDutyPolicyUserOverride> =
          await ModelAPI.getList<OnCallDutyPolicyUserOverride>({
            modelType: OnCallDutyPolicyUserOverride,
            query: {
              projectId: ProjectUtil.getCurrentProjectId()!,
              startsAt: new LessThanOrEqual<Date>(endTime),
              endsAt: new GreaterThanOrEqual<Date>(startTime),
              onCallDutyPolicyId: new IsNull(),
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: {
              startsAt: true,
              endsAt: true,
              overrideUserId: true,
              routeAlertsToUserId: true,
              onCallDutyPolicyId: true,
              overrideUser: {
                name: true,
                email: true,
              },
              routeAlertsToUser: {
                name: true,
                email: true,
              },
            },
            sort: {
              startsAt: SortOrder.Ascending,
            },
          });

        if (isCancelled) {
          return;
        }

        const filtered: Array<OnCallDutyPolicyUserOverride> =
          result.data.filter((o: OnCallDutyPolicyUserOverride) => {
            return scheduleUserIds.has(o.overrideUserId?.toString() || "");
          });

        const userMap: Dictionary<UserInfo> = {};
        for (const o of filtered) {
          const overrideId: string = o.overrideUserId?.toString() || "";
          const routeId: string = o.routeAlertsToUserId?.toString() || "";
          if (overrideId && o.overrideUser && !userMap[overrideId]) {
            userMap[overrideId] = {
              name: o.overrideUser.name?.toString() || "",
              email: o.overrideUser.email?.toString() || "",
            };
          }
          if (routeId && o.routeAlertsToUser && !userMap[routeId]) {
            userMap[routeId] = {
              name: o.routeAlertsToUser.name?.toString() || "",
              email: o.routeAlertsToUser.email?.toString() || "",
            };
          }
        }

        setOverrides(filtered);
        setOverrideUserInfo(userMap);
      } catch {
        if (!isCancelled) {
          setOverrides([]);
          setOverrideUserInfo({});
        }
      }
    };

    fetchOverrides();

    return () => {
      isCancelled = true;
    };
  }, [startTime, endTime, scheduleUserIds]);

  const uniqueUsers: Array<UserColorAssignment> = useMemo(() => {
    const seen: Set<string> = new Set<string>();
    const result: Array<UserColorAssignment> = [];

    for (const userId in scheduleUsersById) {
      const info: UserInfo | undefined = scheduleUsersById[userId];
      if (!info || seen.has(userId)) {
        continue;
      }
      seen.add(userId);
      result.push({
        userId,
        name: getDisplayName(info),
        email: info.email,
        color: getColorForUserId(userId),
      });
    }

    for (const o of overrides) {
      const routeId: string = o.routeAlertsToUserId?.toString() || "";
      if (!routeId || seen.has(routeId)) {
        continue;
      }
      seen.add(routeId);
      const info: UserInfo | undefined = overrideUserInfo[routeId];
      result.push({
        userId: routeId,
        name: getDisplayName(info),
        email: info?.email || "",
        color: getColorForUserId(routeId),
        isSubstitute: true,
      });
    }

    return result;
  }, [scheduleUsersById, overrides, overrideUserInfo]);

  useEffect(() => {
    const layerUtil: LayerUtil = new LayerUtil();
    const layerProps: Array<LayerProps> = [];

    for (const layer of props.layers) {
      const layerUsers: Array<OnCallDutyPolicyScheduleLayerUser> =
        props.allLayerUsers[layer.id?.toString() || ""] || [];

      layerProps.push({
        users: layerUsers
          .map((layerUser: OnCallDutyPolicyScheduleLayerUser) => {
            return layerUser.user!;
          })
          .filter(Boolean),
        startDateTimeOfLayer: layer.startsAt!,
        handOffTime: layer.handOffTime!,
        rotation: layer.rotation!,
        restrictionTimes: layer.restrictionTimes!,
      });
    }

    let events: Array<CalendarEvent> = layerUtil.getMultiLayerEvents({
      calendarEndDate: endTime,
      calendarStartDate: startTime,
      layers: layerProps,
    });

    if (overrides.length > 0) {
      const overrideRecords: Array<UserOverrideRecord> = overrides.map(
        (o: OnCallDutyPolicyUserOverride): UserOverrideRecord => {
          return {
            overrideUserId: o.overrideUserId?.toString() || "",
            routeAlertsToUserId: o.routeAlertsToUserId?.toString() || "",
            startsAt: o.startsAt!,
            endsAt: o.endsAt!,
            onCallDutyPolicyId: o.onCallDutyPolicyId?.toString() || null,
          };
        },
      );

      events = UserOverrideUtil.applyOverridesToEvents({
        events,
        overrides: overrideRecords,
      });
    }

    const userById: Dictionary<UserInfo> = {
      ...scheduleUsersById,
      ...overrideUserInfo,
    };

    events.forEach((event: CalendarEvent) => {
      const meta: OverrideEventMeta | null =
        UserOverrideUtil.getOverrideMeta(event);
      const displayedUserId: string = event.title;
      const displayedInfo: UserInfo | undefined = userById[displayedUserId];

      event.color = getColorForUserId(displayedUserId);

      if (meta) {
        const originalInfo: UserInfo | undefined =
          userById[meta.originalUserId];
        const originalLabel: string =
          originalInfo?.name || originalInfo?.email || "original user";
        const substituteLabel: string =
          displayedInfo?.name || displayedInfo?.email || "substitute user";
        event.title = `${substituteLabel} (covering ${originalLabel})`;
        event.desc = `Override: ${substituteLabel} is covering for ${originalLabel}.`;
      } else {
        event.title = formatUserLabel(displayedInfo);
      }
    });

    setCalendarEvents(events);
  }, [
    props.layers,
    props.allLayerUsers,
    startTime,
    endTime,
    overrides,
    overrideUserInfo,
    scheduleUsersById,
  ]);

  const hasActiveOverrides: boolean = overrides.length > 0;

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
                {u.isSubstitute && (
                  <span className="text-[10px] font-medium uppercase tracking-wide text-indigo-600">
                    Covering
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {hasActiveOverrides && (
        <div className="mt-2 text-xs text-gray-500">
          Events labelled{" "}
          <span className="font-medium text-indigo-600">covering</span> are
          handled by a substitute user via an active override.
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
