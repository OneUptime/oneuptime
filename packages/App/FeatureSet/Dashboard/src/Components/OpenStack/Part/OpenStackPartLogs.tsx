import Log from "Common/Models/AnalyticsModels/Log";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import Card from "Common/UI/Components/Card/Card";
import Link from "Common/UI/Components/Link/Link";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { OPENSTACK_CLOUD_LOG_ATTRIBUTE } from "Common/Utils/OpenStack/OpenStackLogs";
import {
  OpenStackPartLogFacts,
  getOpenStackPartLogAttributes,
} from "Common/Utils/OpenStack/OpenStackPartLogFacts";
import {
  OpenStackRequestSummary,
  OpenStackTrailRow,
  summarizeOpenStackRequests,
} from "Common/Utils/OpenStack/OpenStackRequestTrail";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import DashboardLogsViewer from "../../Logs/LogsViewer";
import { getOpenStackRequestRoute } from "../OpenStackRequestTrail";
import { OpenStackPart } from "./UseOpenStackPart";

/*
 * A part's Logs tab: an instance's shows what names its UUID, a hypervisor's what came from
 * it, and a service's its own. An instance's starts with the requests those lines belong to,
 * the failed ones first, each opening that request across every service: its failed build's
 * scheduler line is one click from here.
 */

// How far back an instance's requests are looked for, and how many are named.
const REQUESTS_WINDOW_IN_DAYS: number = 7;
const REQUEST_ROWS_READ: number = 500;
const REQUESTS_SHOWN: number = 8;

export function getOpenStackPartLogFacts(
  part: OpenStackPart,
  row: OpenStackResource,
): OpenStackPartLogFacts {
  const facts: JSONObject = (row.facts as JSONObject | undefined) || {};
  const host: JSONValue | undefined = facts["host"];

  return {
    kind: part.kind,
    externalId: part.externalId,
    name: row.name,
    hypervisorName: row.hypervisorName,
    workerHost: typeof host === "string" ? host : null,
  };
}

// Whether this part has a Logs tab at all.
export function hasOpenStackPartLogs(
  part: OpenStackPart,
  row: OpenStackResource,
): boolean {
  return (
    getOpenStackPartLogAttributes(getOpenStackPartLogFacts(part, row)) !== null
  );
}

const OpenStackInstanceRequests: FunctionComponent<{
  part: OpenStackPart;
  attributes: Record<string, string>;
}> = (props: {
  part: OpenStackPart;
  attributes: Record<string, string>;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const [requests, setRequests] = useState<Array<OpenStackRequestSummary>>([]);

  useEffect(() => {
    let isCurrent: boolean = true;

    const now: Date = OneUptimeDate.getCurrentDate();

    AnalyticsModelAPI.getList<Log>({
      modelType: Log,
      query: {
        attributes: props.attributes,
        time: new InBetween<Date>(
          OneUptimeDate.addRemoveDays(now, -REQUESTS_WINDOW_IN_DAYS),
          now,
        ),
      } as unknown as Query<Log>,
      select: { time: true, severityText: true, attributes: true },
      sort: { time: SortOrder.Descending },
      limit: REQUEST_ROWS_READ,
      skip: 0,
    })
      .then((result: ListResult<Log>): void => {
        if (isCurrent) {
          setRequests(
            summarizeOpenStackRequests(
              result.data.map((row: Log): OpenStackTrailRow => {
                return {
                  time: row.time,
                  severityText: row.severityText,
                  attributes:
                    (row.attributes as JSONObject | undefined) || null,
                };
              }),
            ),
          );
        }
      })
      .catch((): void => {
        // The lines below are what matters: this only saves finding the request in them.
      });

    return () => {
      isCurrent = false;
    };
  }, [JSON.stringify(props.attributes)]);

  if (requests.length === 0) {
    return <></>;
  }

  return (
    <Card
      title="Requests"
      description="The requests this instance's lines belong to, the ones that failed first. Open one to read it across every service, in time order."
    >
      <ul className="text-sm" data-testid="openstack-instance-requests">
        {requests
          .slice(0, REQUESTS_SHOWN)
          .map((request: OpenStackRequestSummary): ReactElement => {
            return (
              <li key={request.rootId} className="py-1">
                <Link
                  className={`font-mono hover:underline ${request.failed ? "text-red-700" : "text-indigo-600"}`}
                  to={getOpenStackRequestRoute({
                    openStackCloudId: props.part.openStackCloudId,
                    rootId: request.rootId,
                    at: request.firstAt,
                  })}
                >
                  <bdi>{request.rootId}</bdi>
                </Link>
                <span className="ms-2 text-gray-500">
                  <bdi>{request.services.join(", ")}</bdi>
                  {request.failed ? (
                    <span className="ms-2 text-red-700">
                      {translator.translateText("Failed")}
                    </span>
                  ) : (
                    <></>
                  )}
                  {request.lastAt ? (
                    <span className="ms-2">
                      {OneUptimeDate.fromNow(request.lastAt)}
                    </span>
                  ) : (
                    <></>
                  )}
                </span>
              </li>
            );
          })}
      </ul>
    </Card>
  );
};

export interface ComponentProps {
  part: OpenStackPart;
  row: OpenStackResource;
}

const OpenStackPartLogs: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { part, row } = props;
  const own: Record<string, string> | null = getOpenStackPartLogAttributes(
    getOpenStackPartLogFacts(part, row),
  );
  const attributes: Record<string, string> = useMemo(() => {
    return { [OPENSTACK_CLOUD_LOG_ATTRIBUTE]: part.cloudName, ...(own || {}) };
  }, [part.cloudName, JSON.stringify(own)]);

  const logQuery: Query<Log> = useMemo(() => {
    // `any`, as the cloud's Logs page: Query<Log> over inline attributes hits TS2589.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query: any = { attributes };

    return query as Query<Log>;
  }, [attributes]);

  if (!own) {
    return <></>;
  }

  return (
    <Fragment>
      {part.kind === OpenStackResourceKind.Instance ? (
        <OpenStackInstanceRequests part={part} attributes={attributes} />
      ) : (
        <></>
      )}
      <DashboardLogsViewer
        id={`openstack-part-logs-${part.kind}-${part.externalId}`}
        logQuery={logQuery}
        attributeFilterDisplayKeys={{
          [OPENSTACK_CLOUD_LOG_ATTRIBUTE]: "Cloud",
        }}
        showFilters={true}
        enableRealtime={true}
        noLogsMessage="Nothing here yet. A part's logs appear once the agent's logs profile runs on the cloud's machines: the OpenStack guide says how."
      />
    </Fragment>
  );
};

export default OpenStackPartLogs;
