import ChangeEvent from "../../../../../Models/AnalyticsModels/ChangeEvent";
import AIAgentTaskPullRequest from "../../../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import Service from "../../../../../Models/DatabaseModels/Service";
import InBetween from "../../../../../Types/BaseDatabase/InBetween";
import Includes from "../../../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import { CodeHost } from "../../../../../Types/CodeRepository/CodeHost";
import PullRequestState from "../../../../../Types/CodeRepository/PullRequestState";
import Dictionary from "../../../../../Types/Dictionary";
import ObjectID from "../../../../../Types/ObjectID";
import {
  ChangeEventFields,
  ChangeEventSource,
  ChangeEventStatus,
  ChangeEventType,
  readChangeEventFields,
  shortCommitSha,
} from "../../../../../Utils/Telemetry/ChangeEventFields";
import AIAgentTaskPullRequestService from "../../../../Services/AIAgentTaskPullRequestService";
import ChangeEventService from "../../../../Services/ChangeEventService";
import ServiceService from "../../../../Services/ServiceService";
import QueryHelper from "../../../../Types/Database/QueryHelper";

/*
 * WHAT SHIPPED TO THE SERVICE BEHIND A CASE'S ROUTE (#10347): the fixes
 * OneUptime AI opened for the case (AIAgentTaskPullRequest.securityCaseId:
 * Fix With AI's pull requests) with whether each merged and which deploy
 * carried it (FixProductionVerifier matches the merge commit to a recorded
 * deploy), and the deploys of the services that answered the case's
 * requests since the case opened - recorded deploys, and the new versions
 * the services' own telemetry reported (ChangeEventSource.ServiceVersion).
 *
 * A deploy alone is not a fix: the Fix step's check proves one only by the
 * attack being turned away after it (FixRouteStepCheck). A fix a person
 * shipped without a pull request on the case counts once its deploy is
 * recorded, as Fix With AI's does.
 */

// The most pull requests and deploys read.
export const FIX_CHANGES_MAX_PULL_REQUESTS: number = 20;
export const FIX_CHANGES_MAX_DEPLOYS: number = 50;

/*
 * How far before the case a deploy of its services says OneUptime records
 * them at all: one in this long means a fix would be seen shipping.
 */
export const FIX_CHANGES_DEPLOY_DATA_LOOKBACK_DAYS: number = 90;

// One of OneUptime AI's fixes for the case, as its pull request stands.
export interface FixPullRequest {
  id: string;
  number: number | null;
  // Its page on the code host, https; "" when it has none.
  url: string;
  // The code host, as it names itself: "GitHub", "GitLab".
  host: string;
  state: string;
  mergedAt: Date | null;
  // The recorded deploy that carried its merge commit, when one did.
  deployedAt: Date | null;
  deployedVersion: string;
  deployedCommitSha: string;
}

// One deploy of a service behind the route.
export interface ServiceDeploy {
  id: string;
  time: Date;
  serviceId: string;
  // What names it to a person: its version, revision, ReplicaSet or commit.
  label: string;
}

export interface FixChangesReading {
  pullRequests: Array<FixPullRequest>;
  // The services' deploys since the case opened, oldest first.
  deploys: Array<ServiceDeploy>;
  // OneUptime records the services' deploys at all: one since, or one in the lookback before.
  hasDeployData: boolean;
  // The services' names, by id.
  serviceNames: Record<string, string>;
}

// Changes OneUptime made itself are not a fix of the code.
const OWN_SOURCES: ReadonlyArray<string> = [
  ChangeEventSource.OneUptimeAi,
  ChangeEventSource.Runbook,
];

// Deploys that did not finish are no change that shipped.
const UNFINISHED_STATUSES: ReadonlyArray<string> = [
  ChangeEventStatus.Failed,
  ChangeEventStatus.Cancelled,
];

// What names a deploy to a person; "" when nothing does.
export function getDeployLabel(fields: ChangeEventFields): string {
  return (
    fields.version ||
    fields.appPlatformRevision ||
    fields.kubernetesReplicaSet ||
    (fields.commitSha ? shortCommitSha(fields.commitSha) : "")
  ).trim();
}

/*
 * A change event as a deploy of a service: null for one OneUptime made
 * itself, one that failed or was cancelled, and one nothing names.
 */
export function readServiceDeploy(row: ChangeEvent): ServiceDeploy | null {
  if (!row.time || !row.primaryEntityId) {
    return null;
  }

  const fields: ChangeEventFields = readChangeEventFields(
    (row.attributes as Dictionary<unknown>) || {},
  );

  if (
    OWN_SOURCES.includes(fields.source || "") ||
    UNFINISHED_STATUSES.includes((fields.status || "").toLowerCase())
  ) {
    return null;
  }

  const label: string = getDeployLabel(fields);
  const time: Date = new Date(row.time);

  if (!label || Number.isNaN(time.getTime())) {
    return null;
  }

  return {
    id: row._id?.toString() || "",
    time,
    serviceId: row.primaryEntityId.toString(),
    label,
  };
}

function readDate(value: Date | string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const time: Date = new Date(value);

  return Number.isNaN(time.getTime()) ? null : time;
}

// A pull request row as the check reads it.
export function readFixPullRequest(row: AIAgentTaskPullRequest): FixPullRequest {
  const url: string = row.pullRequestUrl?.toString() || "";

  return {
    id: row._id?.toString() || row.id?.toString() || "",
    number:
      typeof row.pullRequestNumber === "number" ? row.pullRequestNumber : null,
    url: /^https:\/\//i.test(url) ? url : "",
    host: CodeHost.getFacts(row.codeRepository?.repositoryHostedAt).name,
    state: row.pullRequestState || "",
    mergedAt: readDate(row.mergedAt),
    deployedAt:
      row.pullRequestState === PullRequestState.Merged
        ? readDate(row.deployedAt)
        : null,
    deployedVersion: (row.deployedVersion || "").trim(),
    deployedCommitSha: (row.deployedCommitSha || "").trim(),
  };
}

const DEPLOY_EVENT_TYPES: Array<string> = [
  ChangeEventType.Deployment,
  ChangeEventType.Rollback,
];

export default class FixChanges {
  /*
   * The case's fixes and the services' deploys since `since`, read as the
   * system. Throws when any could not be read: a check that cannot read its
   * data says it cannot tell.
   */
  public static async read(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    serviceIds: Array<string>;
    since: Date;
    now: Date;
  }): Promise<FixChangesReading> {
    const serviceIds: Array<ObjectID> = data.serviceIds
      .filter((id: string): boolean => {
        return ObjectID.isValidUUID(id);
      })
      .map((id: string): ObjectID => {
        return new ObjectID(id);
      });

    const [pullRequests, deployRows, services]: [
      Array<AIAgentTaskPullRequest>,
      Array<ChangeEvent>,
      Array<Service>,
    ] = await Promise.all([
      AIAgentTaskPullRequestService.findBy({
        query: {
          projectId: data.projectId,
          securityCaseId: data.securityCaseId,
        },
        select: {
          _id: true,
          pullRequestNumber: true,
          pullRequestUrl: true,
          pullRequestState: true,
          mergedAt: true,
          deployedAt: true,
          deployedVersion: true,
          deployedCommitSha: true,
          codeRepository: {
            repositoryHostedAt: true,
          },
        },
        sort: { createdAt: SortOrder.Ascending },
        skip: 0,
        limit: FIX_CHANGES_MAX_PULL_REQUESTS,
        props: { isRoot: true },
      }),
      serviceIds.length > 0
        ? FixChanges.readDeploys({
            projectId: data.projectId,
            serviceIds,
            start: data.since,
            end: data.now,
            sort: SortOrder.Ascending,
            limit: FIX_CHANGES_MAX_DEPLOYS,
          })
        : Promise.resolve([]),
      serviceIds.length > 0
        ? ServiceService.findBy({
            query: {
              _id: QueryHelper.any(serviceIds),
              projectId: data.projectId,
            },
            select: { _id: true, name: true },
            skip: 0,
            limit: serviceIds.length,
            props: { isRoot: true },
          })
        : Promise.resolve([]),
    ]);

    const deploys: Array<ServiceDeploy> = deployRows
      .map(readServiceDeploy)
      .filter((deploy: ServiceDeploy | null): deploy is ServiceDeploy => {
        return deploy !== null;
      })
      .sort((left: ServiceDeploy, right: ServiceDeploy): number => {
        return left.time.getTime() - right.time.getTime();
      });

    let hasDeployData: boolean = deploys.length > 0;

    // None since: whether OneUptime saw any before, so it knows a fix would show.
    if (!hasDeployData && serviceIds.length > 0) {
      const before: Array<ChangeEvent> = await FixChanges.readDeploys({
        projectId: data.projectId,
        serviceIds,
        start: new Date(
          data.since.getTime() -
            FIX_CHANGES_DEPLOY_DATA_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
        ),
        end: data.since,
        sort: SortOrder.Descending,
        limit: 5,
      });

      hasDeployData = before.some((row: ChangeEvent): boolean => {
        return readServiceDeploy(row) !== null;
      });
    }

    const serviceNames: Record<string, string> = {};

    for (const service of services) {
      const id: string = service._id?.toString() || service.id?.toString() || "";

      if (id && service.name) {
        serviceNames[id] = service.name;
      }
    }

    return {
      pullRequests: pullRequests.map(readFixPullRequest),
      deploys,
      hasDeployData,
      serviceNames,
    };
  }

  private static async readDeploys(data: {
    projectId: ObjectID;
    serviceIds: Array<ObjectID>;
    start: Date;
    end: Date;
    sort: SortOrder;
    limit: number;
  }): Promise<Array<ChangeEvent>> {
    return await ChangeEventService.findBy({
      query: {
        projectId: data.projectId,
        primaryEntityId: new Includes(data.serviceIds),
        eventType: new Includes(DEPLOY_EVENT_TYPES),
        time: new InBetween(data.start, data.end),
      } as never,
      select: {
        _id: true,
        time: true,
        primaryEntityId: true,
        attributes: true,
      } as never,
      sort: { time: data.sort } as never,
      skip: 0,
      limit: data.limit,
      props: { isRoot: true },
    });
  }
}
