import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import {
  CloudCreateCall,
  getCloudActorEmail,
} from "../../../Types/Cloud/CloudResourceCreator";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  ChangeEventAttribute,
  ChangeEventSource,
  ChangeEventStatus,
} from "../../../Utils/Telemetry/ChangeEventFields";
import {
  DbJSONResponse,
  Results,
} from "../../Services/AnalyticsDatabaseService";
import ChangeEventService from "../../Services/ChangeEventService";
import TeamMemberService from "../../Services/TeamMemberService";
import UserService from "../../Services/UserService";
import QueryHelper from "../../Types/Database/QueryHelper";
import { getQuerySettings } from "../AnalyticsDatabase/QuerySettingsHelper";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";

/*
 * WHO CREATED THE NEW RESOURCES, AS THEIR ACCOUNTS' CHANGE LOGS SAY
 * (#11012): one read of the project's cloud change events over a window,
 * of those that name any of the resources - by the row they were tied to,
 * by their first resource, or by any resource they name
 * (oneuptime.cloud.resource_ids) - and, for a caller that carries an
 * email address, the member of the project it is.
 *
 * Which call is the creation is Types/Cloud/CloudResourceCreator's to say:
 * this only reads.
 */

const CHANGE_TABLE: string = AnalyticsTableName.ChangeEvent;

// The change events one read returns at most.
export const CLOUD_TAG_CREATOR_CALLS_READ: number = 2000;

const QUERY_SETTINGS: string = getQuerySettings({
  maxExecutionTimeInSeconds: 30,
  timeoutOverflowMode: "throw",
});

function text(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  return value === null || value === undefined ? "" : String(value);
}

// A time as ClickHouse writes one in JSON: a space where ISO writes a T.
const CLICKHOUSE_TIME: RegExp = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/;

/*
 * A time as ClickHouse writes one in JSON - "2026-11-24 10:00:00.123", in
 * UTC - or an ISO time; null for anything else.
 */
export function readClickHouseTime(value: unknown): Date | null {
  const raw: string = text(value).trim();

  if (!raw) {
    return null;
  }

  const iso: string = CLICKHOUSE_TIME.test(raw)
    ? `${raw.replace(" ", "T")}Z`
    : raw;
  const time: Date = new Date(iso);

  return Number.isNaN(time.getTime()) ? null : time;
}

export default class CloudTagCreators {
  /*
   * The change events of [start, end] that name any of these resources,
   * oldest first.
   */
  public static buildCallsStatement(data: {
    projectId: ObjectID;
    start: Date;
    end: Date;
    resourceRowIds: Array<string>;
    // Every name the logs may give them, in lower case (getCloudResourceLogIds).
    logIds: Array<string>;
  }): Statement {
    const statement: Statement = SQL`SELECT time, attributes[${{
      type: TableColumnType.Text,
      value: ChangeEventAttribute.CloudProvider,
    }}] AS provider, attributes[${{
      type: TableColumnType.Text,
      value: ChangeEventAttribute.CloudOperation,
    }}] AS operation, attributes[${{
      type: TableColumnType.Text,
      value: ChangeEventAttribute.CloudActor,
    }}] AS actor, attributes[${{
      type: TableColumnType.Text,
      value: ChangeEventAttribute.CloudResourceIds,
    }}] AS resourceIds, attributes[${{
      type: TableColumnType.Text,
      value: ChangeEventAttribute.CloudResourceId,
    }}] AS resourceId, attributes[${{
      type: TableColumnType.Text,
      value: ChangeEventAttribute.ResourceId,
    }}] AS resourceRowId, attributes[${{
      type: TableColumnType.Text,
      value: ChangeEventAttribute.Status,
    }}] AS status FROM ${CHANGE_TABLE} WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: data.projectId,
    }} AND time >= ${{
      type: TableColumnType.Date,
      value: data.start,
    }} AND time <= ${{
      type: TableColumnType.Date,
      value: data.end,
    }} AND attributes[${{
      type: TableColumnType.Text,
      value: ChangeEventAttribute.Source,
    }}] = ${{
      type: TableColumnType.Text,
      value: ChangeEventSource.Cloud,
    }} AND (has(${{
      type: TableColumnType.ArrayText,
      value: data.resourceRowIds,
    }}, attributes[${{
      type: TableColumnType.Text,
      value: ChangeEventAttribute.ResourceId,
    }}]) OR has(${{
      type: TableColumnType.ArrayText,
      value: data.logIds,
    }}, lower(attributes[${{
      type: TableColumnType.Text,
      value: ChangeEventAttribute.CloudResourceId,
    }}])) OR hasAny(splitByChar('\\n', attributes[${{
      type: TableColumnType.Text,
      value: ChangeEventAttribute.CloudResourceIds,
    }}]), ${{
      type: TableColumnType.ArrayText,
      value: data.logIds,
    }})) ORDER BY time ASC LIMIT ${{
      type: TableColumnType.Number,
      value: CLOUD_TAG_CREATOR_CALLS_READ,
    }}`;

    statement.append(QUERY_SETTINGS);

    return statement;
  }

  // The rows of the read as calls.
  public static readCalls(rows: Array<JSONObject>): Array<CloudCreateCall> {
    const calls: Array<CloudCreateCall> = [];

    for (const row of rows) {
      const time: Date | null = readClickHouseTime(row["time"]);

      if (!time) {
        continue;
      }

      const ids: Array<string> = [
        ...text(row["resourceIds"]).split("\n"),
        text(row["resourceId"]),
      ]
        .map((id: string): string => {
          return id.trim().toLowerCase();
        })
        .filter((id: string): boolean => {
          return id.length > 0;
        });

      calls.push({
        time,
        provider: text(row["provider"]),
        operation: text(row["operation"]),
        actor: text(row["actor"]),
        resourceIds: Array.from(new Set(ids)),
        resourceRowId: text(row["resourceRowId"]) || null,
        failed: text(row["status"]) === ChangeEventStatus.Failed,
      });
    }

    return calls;
  }

  public static async readCreateCalls(data: {
    projectId: ObjectID;
    start: Date;
    end: Date;
    resourceRowIds: Array<string>;
    logIds: Array<string>;
  }): Promise<Array<CloudCreateCall>> {
    if (data.resourceRowIds.length === 0 && data.logIds.length === 0) {
      return [];
    }

    const result: Results = await ChangeEventService.executeQuery(
      CloudTagCreators.buildCallsStatement(data),
    );
    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();

    return CloudTagCreators.readCalls(
      (response.data || []) as Array<JSONObject>,
    );
  }

  /*
   * The member of the project a caller is: the user whose email address
   * the caller carries, when they are on one of the project's teams. Null
   * for anyone else - a role, a service account, a stranger.
   */
  public static async findMember(data: {
    projectId: ObjectID;
    actor: string;
  }): Promise<User | null> {
    const email: string | null = getCloudActorEmail(data.actor);

    if (!email || !Email.isValid(email)) {
      return null;
    }

    const user: User | null = await UserService.findOneBy({
      query: { email: QueryHelper.findWithSameText(email) as never },
      select: { _id: true, email: true, name: true },
      props: { isRoot: true },
    });

    if (!user?.id) {
      return null;
    }

    const membership: TeamMember | null = await TeamMemberService.findOneBy({
      query: {
        projectId: data.projectId,
        userId: user.id,
        hasAcceptedInvitation: true,
      },
      select: { _id: true },
      props: { isRoot: true },
    });

    return membership ? user : null;
  }
}
