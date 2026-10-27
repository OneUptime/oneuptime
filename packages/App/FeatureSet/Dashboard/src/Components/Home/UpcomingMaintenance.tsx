import { formatRelativeTime, toDate } from "./HomeRelativeTime";
import { HOME_ROW_CARD_BODY_CLASS_NAME } from "./HomeRowCard";
import AppLink from "../AppLink/AppLink";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import ScheduledMaintenanceStateUtil from "../../Utils/ScheduledMaintenanceState";
import Route from "Common/Types/API/Route";
import Includes from "Common/Types/BaseDatabase/Includes";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * The next few maintenance windows, soonest first: what is about to change
 * for the people using this project's services. An event is upcoming while
 * it waits for its Starts At - in the scheduled state, or in a state of the
 * project's own placed after Scheduled and before Ongoing - exactly the
 * events its status pages list as upcoming.
 */

export const UPCOMING_MAINTENANCE_LIMIT: number = 3;

export const fetchUpcomingMaintenance: (
  projectId: ObjectID,
) => Promise<{ items: Array<ScheduledMaintenance>; count: number }> = async (
  projectId: ObjectID,
): Promise<{ items: Array<ScheduledMaintenance>; count: number }> => {
  const waitingStates: Array<ScheduledMaintenanceState> =
    await ScheduledMaintenanceStateUtil.getWaitingToStartScheduledMaintenanceStates(
      projectId,
    );

  if (waitingStates.length === 0) {
    return { items: [], count: 0 };
  }

  const result: ListResult<ScheduledMaintenance> =
    await ModelAPI.getList<ScheduledMaintenance>({
      modelType: ScheduledMaintenance,
      query: {
        projectId: projectId,
        currentScheduledMaintenanceStateId: new Includes(
          waitingStates
            .map((state: ScheduledMaintenanceState) => {
              return state.id;
            })
            .filter((id: ObjectID | null | undefined): id is ObjectID => {
              return Boolean(id);
            }),
        ),
      },
      select: {
        _id: true,
        title: true,
        startsAt: true,
        endsAt: true,
      },
      sort: {
        startsAt: SortOrder.Ascending,
      },
      limit: UPCOMING_MAINTENANCE_LIMIT,
      skip: 0,
    });

  return {
    items: result.data,
    count: typeof result.count === "number" ? result.count : result.data.length,
  };
};

/*
 * A part of the day an event starts on - its month ("Oct", "Okt.") or its
 * day of the month - in the reader's language and the time zone the
 * dashboard shows times in.
 */
export const formatCalendarPart: (data: {
  date: Date;
  part: "month" | "day";
  language: string;
}) => string = (data: {
  date: Date;
  part: "month" | "day";
  language: string;
}): string => {
  const options: Intl.DateTimeFormatOptions =
    data.part === "month" ? { month: "short" } : { day: "numeric" };

  try {
    return new Intl.DateTimeFormat(data.language || "en", {
      ...options,
      timeZone: OneUptimeDate.getCurrentTimezone().toString(),
    }).format(data.date);
  } catch {
    // An unknown language or zone: the browser's own, in English.
    return new Intl.DateTimeFormat("en", options).format(data.date);
  }
};

export interface ComponentProps {
  projectId: ObjectID;
  now: Date;
  refreshKey?: number | undefined;
}

type UpcomingState =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "loaded"; items: Array<ScheduledMaintenance>; count: number };

const UpcomingMaintenance: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const projectIdString: string = props.projectId.toString();
  const [state, setState] = useState<UpcomingState>({ status: "loading" });

  // The project the card last had an answer for.
  const answeredProjectId: MutableRefObject<string | null> = useRef<
    string | null
  >(null);

  useEffect(() => {
    let isCurrent: boolean = true;

    /*
     * Another project starts from nothing. Refresh keeps what is on screen
     * until the new answer lands, so the card does not blink out and back
     * while the same windows are read again.
     */
    if (answeredProjectId.current !== projectIdString) {
      setState({ status: "loading" });
    }

    fetchUpcomingMaintenance(new ObjectID(projectIdString))
      .then((result: { items: Array<ScheduledMaintenance>; count: number }) => {
        if (isCurrent) {
          answeredProjectId.current = projectIdString;
          setState({ status: "loaded", ...result });
        }
      })
      .catch(() => {
        if (isCurrent) {
          answeredProjectId.current = projectIdString;
          setState({ status: "failed" });
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [projectIdString, props.refreshKey]);

  /*
   * Nothing coming up, or a role that may not read maintenance: the card is
   * left out rather than drawn empty, so Home only shows what has something
   * to say. Scheduling one is a quick action at the top of the page.
   *
   * Nor is anything drawn while the windows are read. The card used to draw
   * placeholders that, for most projects - nothing scheduled - vanished a
   * moment later and moved the page up under the reader (#4918's review).
   * Now the card appears once, with its windows, when there are some; the
   * side column's card above it runs down to the row's end meanwhile.
   */
  if (state.status !== "loaded" || state.items.length === 0) {
    return <></>;
  }

  const items: Array<ScheduledMaintenance> = state.items;

  const listRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENTS] as Route,
  );

  const renderBody: () => ReactElement = (): ReactElement => {
    return (
      <ul className="divide-y divide-gray-100 border-t border-gray-100">
        {items.map((event: ScheduledMaintenance): ReactElement => {
          const id: string = event._id?.toString() || "";
          const startsAt: Date | undefined = toDate(event.startsAt);

          return (
            <li key={id}>
              <AppLink
                to={RouteUtil.populateRouteParams(
                  RouteMap[PageMap.SCHEDULED_MAINTENANCE_VIEW] as Route,
                  { modelId: id },
                )}
                className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 md:px-6"
              >
                <span
                  data-testid="home-upcoming-row"
                  data-id={id}
                  className="flex min-w-0 flex-1 items-center gap-3"
                >
                  {/*
                   * The day it starts, as a calendar leaf: month and day in
                   * the reader's language and time zone.
                   */}
                  <span
                    aria-hidden="true"
                    className="flex h-10 w-10 flex-none flex-col items-center justify-center rounded-lg bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200"
                  >
                    {startsAt ? (
                      <>
                        <span className="text-[10px] font-semibold uppercase leading-3">
                          {formatCalendarPart({
                            date: startsAt,
                            part: "month",
                            language: translator.language,
                          })}
                        </span>
                        <span className="text-sm font-semibold leading-4">
                          {formatCalendarPart({
                            date: startsAt,
                            part: "day",
                            language: translator.language,
                          })}
                        </span>
                      </>
                    ) : (
                      <Icon icon={IconProp.Clock} className="h-4 w-4" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-gray-900">
                      {event.title || translator.translateText("Untitled")}
                    </span>
                    {startsAt ? (
                      <span
                        className="mt-0.5 block truncate text-xs text-gray-500"
                        title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                          startsAt,
                        )}
                      >
                        {translator.translateTemplate(
                          /*
                           * Still waiting after its time: the clock starts
                           * it on its next pass.
                           */
                          startsAt.getTime() < props.now.getTime()
                            ? "Due to start {{time}}"
                            : "Starts {{time}}",
                          {
                            time: formatRelativeTime({
                              date: startsAt,
                              now: props.now,
                              language: translator.language,
                            }),
                          },
                        )}
                      </span>
                    ) : (
                      <></>
                    )}
                  </span>
                </span>
                <Icon
                  icon={IconProp.ChevronRight}
                  className="h-4 w-4 flex-none text-gray-400"
                />
              </AppLink>
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <div data-testid="home-upcoming-maintenance">
      {/*
       * The last card of Home's side column: it runs down to the end of the
       * row, level with Needs attention, with any room under its rows.
       */}
      <Card
        fillHeight={true}
        title="Upcoming maintenance"
        description="The next scheduled maintenance windows, soonest first."
        headerLayout="stacked"
        rightElement={
          <AppLink
            to={listRoute}
            className="text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
          >
            <span data-testid="home-upcoming-view-all">
              {translator.translateText("View all")}
            </span>
          </AppLink>
        }
        bodyClassName={HOME_ROW_CARD_BODY_CLASS_NAME}
      >
        {renderBody()}
      </Card>
    </div>
  );
};

export default UpcomingMaintenance;
