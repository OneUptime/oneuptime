import Log from "Common/Models/AnalyticsModels/Log";
import Route from "Common/Types/API/Route";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import API from "Common/UI/Utils/API/API";
import Link from "Common/UI/Components/Link/Link";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  OPENSTACK_CLOUD_LOG_ATTRIBUTE,
  OpenStackLogAttribute,
} from "Common/Utils/OpenStack/OpenStackLogs";
import {
  OPENSTACK_REQUEST_QUERY_PARAM,
  OPENSTACK_REQUEST_TIME_QUERY_PARAM,
  OpenStackRequestJoin,
  OpenStackRequestJoinedService,
  OpenStackTrailRow,
  joinOpenStackRequest,
} from "Common/Utils/OpenStack/OpenStackRequestTrail";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import DashboardLogsViewer from "../Logs/LogsViewer";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import InlineSeparator from "Common/UI/Components/InlineSeparator/InlineSeparator";

/*
 * One request, followed across a cloud's services: every line holding its ID or its global
 * ID, in time order, and what can be said about how far that got. Cross-service correlation
 * relies on the caller having sent a global ID, so where it could not join a service this
 * says so, rather than leaving a person to wonder why Neutron's half is missing.
 */

// How far either side of the line a request is looked for: longer than any build takes.
const TRAIL_WINDOW_IN_HOURS: number = 6;
const MAX_TRAIL_ROWS: number = 1000;
// How far around the request a service counts as having been busy at the same moment.
const NOT_JOINED_WINDOW_IN_SECONDS: number = 30;

export function getOpenStackRequestRoute(data: {
  openStackCloudId: ObjectID;
  rootId: string;
  at?: Date | null | undefined;
}): Route {
  /*
   * A request ID comes off a log line, which anyone able to reach the API can shape, and
   * addQueryParams writes what it is given: so it is encoded here.
   */
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_LOGS] as Route,
    { modelId: data.openStackCloudId },
  ).addQueryParams({
    [OPENSTACK_REQUEST_QUERY_PARAM]: encodeURIComponent(data.rootId),
    ...(data.at
      ? {
          [OPENSTACK_REQUEST_TIME_QUERY_PARAM]: encodeURIComponent(
            data.at.toISOString(),
          ),
        }
      : {}),
  });
}

function toTrailRow(row: Log): OpenStackTrailRow {
  return {
    time: row.time,
    severityText: row.severityText,
    attributes: (row.attributes as JSONObject | undefined) || null,
  };
}

export interface ComponentProps {
  openStackCloudId: ObjectID;
  cloudName: string;
  rootId: string;
  at: Date | null;
}

const OpenStackRequestTrail: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [join, setJoin] = useState<OpenStackRequestJoin | null>(null);
  const [error, setError] = useState<string>("");

  const timeRange: InBetween<Date> = useMemo(() => {
    const around: Date = props.at || OneUptimeDate.getCurrentDate();

    return new InBetween<Date>(
      OneUptimeDate.addRemoveHours(around, -TRAIL_WINDOW_IN_HOURS),
      props.at
        ? OneUptimeDate.addRemoveHours(around, TRAIL_WINDOW_IN_HOURS)
        : around,
    );
  }, [props.at?.getTime()]);

  useEffect(() => {
    let isCurrent: boolean = true;

    const read: () => Promise<void> = async (): Promise<void> => {
      const requestRows: ListResult<Log> = await AnalyticsModelAPI.getList<Log>(
        {
          modelType: Log,
          query: {
            attributes: {
              [OPENSTACK_CLOUD_LOG_ATTRIBUTE]: props.cloudName,
              [OpenStackLogAttribute.RequestRootId]: props.rootId,
            },
            time: timeRange,
          } as unknown as Query<Log>,
          select: { time: true, severityText: true, attributes: true },
          sort: { time: SortOrder.Ascending },
          limit: MAX_TRAIL_ROWS,
          skip: 0,
        },
      );
      const rows: Array<OpenStackTrailRow> = requestRows.data.map(toTrailRow);
      const times: Array<number> = rows
        .map((row: OpenStackTrailRow): number => {
          return row.time ? new Date(row.time).getTime() : 0;
        })
        .filter((time: number): boolean => {
          return time > 0;
        });

      let windowRows: Array<OpenStackTrailRow> = [];

      if (times.length > 0) {
        const around: ListResult<Log> = await AnalyticsModelAPI.getList<Log>({
          modelType: Log,
          query: {
            attributes: {
              [OPENSTACK_CLOUD_LOG_ATTRIBUTE]: props.cloudName,
            },
            time: new InBetween<Date>(
              OneUptimeDate.addRemoveSeconds(
                new Date(Math.min(...times)),
                -NOT_JOINED_WINDOW_IN_SECONDS,
              ),
              OneUptimeDate.addRemoveSeconds(
                new Date(Math.max(...times)),
                NOT_JOINED_WINDOW_IN_SECONDS,
              ),
            ),
          } as unknown as Query<Log>,
          select: { attributes: true, time: true },
          sort: { time: SortOrder.Ascending },
          limit: MAX_TRAIL_ROWS,
          skip: 0,
        });

        windowRows = around.data.map(toTrailRow);
      }

      if (isCurrent) {
        setJoin(joinOpenStackRequest({ requestRows: rows, windowRows }));
      }
    };

    read().catch((err: unknown): void => {
      if (isCurrent) {
        setError(API.getFriendlyMessage(err));
      }
    });

    return () => {
      isCurrent = false;
    };
  }, [props.cloudName, props.rootId, timeRange]);

  const logQuery: Query<Log> = useMemo(() => {
    // `any`, as the cloud's Logs page: Query<Log> over inline attributes hits TS2589.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query: any = {
      attributes: {
        [OPENSTACK_CLOUD_LOG_ATTRIBUTE]: props.cloudName,
        [OpenStackLogAttribute.RequestRootId]: props.rootId,
      },
      time: timeRange,
    };

    return query as Query<Log>;
  }, [props.cloudName, props.rootId, timeRange]);

  return (
    <Fragment>
      <Card
        title={translator.translateTemplate("Following request {{request}}", {
          request: props.rootId,
        })}
        description="Every line holding this request's ID or its global ID, across every service, in time order."
        buttons={[]}
      >
        <div className="text-sm" data-testid="openstack-request-trail">
          <div className="mb-3">
            <Link
              className="text-indigo-600 hover:underline"
              to={
                RouteUtil.populateRouteParams(
                  RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_LOGS] as Route,
                  { modelId: props.openStackCloudId },
                ) as Route
              }
            >
              {translator.translateText("Back to all of this cloud's logs")}
            </Link>
          </div>
          {error ? <p className="text-red-700">{error}</p> : <></>}
          {join ? (
            <Fragment>
              <ul data-testid="openstack-request-joined">
                {join.joined.map(
                  (service: OpenStackRequestJoinedService): ReactElement => {
                    return (
                      <li
                        key={service.service}
                        className={`py-0.5 ${service.failed ? "text-red-700" : "text-gray-700"}`}
                      >
                        <bdi className="font-medium">{service.service}</bdi>
                        {service.hosts.length > 0 ? (
                          <span className="text-gray-500">
                            {" "}
                            <bdi>{service.hosts.join(", ")}</bdi>
                          </span>
                        ) : (
                          <></>
                        )}
                        <span className="text-gray-500">
                          <InlineSeparator />
                          {translator.translatePlural(
                            {
                              one: "{{count}} line",
                              other: "{{count}} lines",
                            },
                            service.lineCount,
                          )}
                        </span>
                      </li>
                    );
                  },
                )}
              </ul>
              {join.notJoined.length > 0 ? (
                <p
                  className="mt-3 text-gray-600"
                  data-testid="openstack-request-not-joined"
                >
                  {translator.translateTemplate(
                    "Could not join {{services}}: they wrote other requests' lines at the same moments, and none names this one. A service only joins when its caller sends a global request ID, so they may or may not have taken part.",
                    { services: join.notJoined.join(", ") },
                  )}
                </p>
              ) : (
                <p className="mt-3 text-gray-500">
                  {translator.translateText(
                    "No other service was writing about a request at the same moments.",
                  )}
                </p>
              )}
            </Fragment>
          ) : (
            <></>
          )}
        </div>
      </Card>
      <DashboardLogsViewer
        id={`openstack-request-trail-${props.rootId}`}
        logQuery={logQuery}
        initialSortOrder={SortOrder.Ascending}
        attributeFilterDisplayKeys={{
          [OPENSTACK_CLOUD_LOG_ATTRIBUTE]: "Cloud",
          [OpenStackLogAttribute.RequestRootId]: "Request",
        }}
        showFilters={true}
        noLogsMessage="No line of this cloud holds this request's ID in the time around it."
      />
    </Fragment>
  );
};

export default OpenStackRequestTrail;
