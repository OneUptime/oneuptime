import ChangeEvent from "Common/Models/AnalyticsModels/ChangeEvent";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import { APP_API_URL } from "Common/UI/Config";
import AnalyticsModelAPI, {
  ListResult as AnalyticsListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { ProfileTypeActivity } from "Common/Utils/Profiles/ProfileTypes";
import { ProfileTreeNode } from "Common/Utils/Profiles/ProfileHotspot";
import {
  ProfileChangeDirection,
  ProfileFunctionChange,
} from "Common/Utils/Profiles/ProfileComparison";
import {
  ProfileFixSuggestion,
  parseProfileFixSuggestion,
} from "Common/Utils/Suggestions/ProfileFixSuggestion";
import { ProfileFunctionRow } from "../../Utils/ProfilesView";

/*
 * The Profiler's reads and writes, each one request to the server and its
 * answer read defensively: a field the answer lacks reads as nothing, never
 * as a crash.
 */

export interface ProfileScope {
  serviceIds?: Array<string> | undefined;
  profileTypes?: Array<string> | undefined;
}

export interface ProfileWindowRequest {
  startTime: Date;
  endTime: Date;
}

async function post(route: string, data: JSONObject): Promise<JSONObject> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
    {
      url: URL.fromString(APP_API_URL.toString()).addRoute(route),
      data: data,
      headers: {
        ...ModelAPI.getCommonHeaders(),
      },
    },
  );

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return (response.data || {}) as JSONObject;
}

function num(value: unknown): number {
  const parsed: number = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// Which raw profile types a scope has data for, in a window.
export async function fetchProfileTypes(data: {
  window: ProfileWindowRequest;
  serviceIds?: Array<string> | undefined;
}): Promise<Array<ProfileTypeActivity>> {
  const answer: JSONObject = await post("/telemetry/profiles/profile-types", {
    startTime: data.window.startTime.toISOString(),
    endTime: data.window.endTime.toISOString(),
    ...(data.serviceIds ? { serviceIds: data.serviceIds } : {}),
  });

  const rows: Array<unknown> = Array.isArray(answer["profileTypes"])
    ? (answer["profileTypes"] as Array<unknown>)
    : [];

  return rows
    .map((row: unknown): ProfileTypeActivity => {
      const record: JSONObject = (row || {}) as JSONObject;
      return {
        profileType: text(record["profileType"]),
        unit: text(record["unit"]),
        sampleCount: num(record["sampleCount"]),
        profileCount: num(record["profileCount"]),
      };
    })
    .filter((row: ProfileTypeActivity): boolean => {
      return row.profileType.length > 0;
    });
}

export interface ProfiledEntity {
  id: string;
  entityType: string;
  sampleCount: number;
  profileCount: number;
}

// The services (and hosts, clusters, ...) that sent profiles in a window.
export async function fetchProfiledEntities(data: {
  window: ProfileWindowRequest;
  profileTypes?: Array<string> | undefined;
}): Promise<Array<ProfiledEntity>> {
  const answer: JSONObject = await post(
    "/telemetry/profiles/service-activity",
    {
      startTime: data.window.startTime.toISOString(),
      endTime: data.window.endTime.toISOString(),
      ...(data.profileTypes ? { profileTypes: data.profileTypes } : {}),
    },
  );

  const rows: Array<unknown> = Array.isArray(answer["activity"])
    ? (answer["activity"] as Array<unknown>)
    : [];

  return rows
    .map((row: unknown): ProfiledEntity => {
      const record: JSONObject = (row || {}) as JSONObject;
      return {
        id: text(record["primaryEntityId"]),
        entityType: text(record["primaryEntityType"]),
        sampleCount: num(record["sampleCount"]),
        profileCount: num(record["profileCount"]),
      };
    })
    .filter((row: ProfiledEntity): boolean => {
      return row.id.length > 0 && row.sampleCount > 0;
    });
}

export interface ProfileFunctionListAnswer {
  functions: Array<ProfileFunctionRow>;
  windowTotal: number;
  windowSampleCount: number;
  truncated: boolean;
}

function readFunctionRow(row: unknown): ProfileFunctionRow {
  const record: JSONObject = (row || {}) as JSONObject;
  return {
    functionName: text(record["functionName"]),
    fileName: text(record["fileName"]),
    lineNumber: num(record["lineNumber"]),
    frameType: text(record["frameType"]),
    selfValue: num(record["selfValue"]),
    totalValue: num(record["totalValue"]),
    sampleCount: num(record["sampleCount"]),
    ownValue: num(record["ownValue"]),
  };
}

// The functions of a scope, ranked, with the window's total.
export async function fetchFunctionList(data: {
  window?: ProfileWindowRequest | undefined;
  profileId?: string | undefined;
  serviceIds?: Array<string> | undefined;
  profileTypes?: Array<string> | undefined;
  sortBy: "selfValue" | "totalValue" | "ownValue";
  limit: number;
}): Promise<ProfileFunctionListAnswer> {
  const answer: JSONObject = await post("/telemetry/profiles/function-list", {
    ...(data.window
      ? {
          startTime: data.window.startTime.toISOString(),
          endTime: data.window.endTime.toISOString(),
        }
      : {}),
    ...(data.profileId ? { profileId: data.profileId } : {}),
    ...(data.serviceIds ? { serviceIds: data.serviceIds } : {}),
    ...(data.profileTypes ? { profileTypes: data.profileTypes } : {}),
    sortBy: data.sortBy,
    limit: data.limit,
  });

  return {
    functions: (Array.isArray(answer["functions"])
      ? (answer["functions"] as Array<unknown>)
      : []
    ).map(readFunctionRow),
    windowTotal: num(answer["windowTotal"]),
    windowSampleCount: num(answer["windowSampleCount"]),
    truncated: answer["truncated"] === true,
  };
}

export interface ProfileComparisonAnswer {
  changes: Array<ProfileFunctionChange>;
  beforeSampleCount: number;
  afterSampleCount: number;
  isFooted: boolean;
  truncated: boolean;
}

function readShare(value: unknown): ProfileFunctionChange["before"] {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record: JSONObject = value as JSONObject;

  return {
    selfValue: num(record["selfValue"]),
    totalValue: num(record["totalValue"]),
    sampleCount: num(record["sampleCount"]),
    selfShare: num(record["selfShare"]),
    totalShare: num(record["totalShare"]),
    ownValue: num(record["ownValue"]),
    ownShare: num(record["ownShare"]),
  };
}

const DIRECTIONS: Array<string> = Object.values(ProfileChangeDirection);

// The same scope in two windows, its functions lined up by share.
export async function fetchFunctionComparison(data: {
  before: ProfileWindowRequest;
  after: ProfileWindowRequest;
  serviceIds?: Array<string> | undefined;
  profileTypes?: Array<string> | undefined;
  limit: number;
}): Promise<ProfileComparisonAnswer> {
  const answer: JSONObject = await post(
    "/telemetry/profiles/function-comparison",
    {
      beforeStartTime: data.before.startTime.toISOString(),
      beforeEndTime: data.before.endTime.toISOString(),
      afterStartTime: data.after.startTime.toISOString(),
      afterEndTime: data.after.endTime.toISOString(),
      ...(data.serviceIds ? { serviceIds: data.serviceIds } : {}),
      ...(data.profileTypes ? { profileTypes: data.profileTypes } : {}),
      limit: data.limit,
    },
  );

  const changes: Array<ProfileFunctionChange> = (
    Array.isArray(answer["changes"])
      ? (answer["changes"] as Array<unknown>)
      : []
  ).map((row: unknown): ProfileFunctionChange => {
    const record: JSONObject = (row || {}) as JSONObject;
    const direction: string = text(record["direction"]);

    return {
      functionName: text(record["functionName"]),
      fileName: text(record["fileName"]),
      lineNumber: num(record["lineNumber"]),
      frameType: text(record["frameType"]),
      before: readShare(record["before"]),
      after: readShare(record["after"]),
      selfShareChange: num(record["selfShareChange"]),
      totalShareChange: num(record["totalShareChange"]),
      ownShareChange: num(record["ownShareChange"]),
      direction: DIRECTIONS.includes(direction)
        ? (direction as ProfileChangeDirection)
        : ProfileChangeDirection.Same,
    };
  });

  const before: JSONObject = (answer["before"] || {}) as JSONObject;
  const after: JSONObject = (answer["after"] || {}) as JSONObject;

  return {
    changes,
    beforeSampleCount: num(before["windowSampleCount"]),
    afterSampleCount: num(after["windowSampleCount"]),
    isFooted: answer["isFooted"] === true,
    truncated: before["truncated"] === true || after["truncated"] === true,
  };
}

export interface ProfileSourceLink {
  fileName: string;
  lineNumber: number;
  repositoryName: string;
  path: string;
  url: string;
}

/*
 * Where files of running code live in the project's repositories. Nothing
 * when none holds them - or the reader may read none: a link is a bonus,
 * never an error.
 */
export async function fetchSourceLinks(
  frames: Array<{ fileName: string; lineNumber: number }>,
): Promise<Array<ProfileSourceLink>> {
  if (frames.length === 0) {
    return [];
  }

  const answer: JSONObject = await post("/code-task/source-links", {
    frames: frames as unknown as Array<JSONObject>,
  });

  return (
    Array.isArray(answer["links"]) ? (answer["links"] as Array<unknown>) : []
  )
    .map((row: unknown): ProfileSourceLink => {
      const record: JSONObject = (row || {}) as JSONObject;
      return {
        fileName: text(record["fileName"]),
        lineNumber: num(record["lineNumber"]),
        repositoryName: text(record["repositoryName"]),
        path: text(record["path"]),
        url: text(record["url"]),
      };
    })
    .filter((link: ProfileSourceLink): boolean => {
      return link.url.startsWith("https://");
    });
}

export interface ProfileFixRequestBody {
  serviceId: string;
  functionName: string;
  fileName: string;
  profileType: string;
  window: ProfileWindowRequest;
  beforeWindow?: ProfileWindowRequest | undefined;
}

function fixBody(request: ProfileFixRequestBody): JSONObject {
  return {
    serviceId: request.serviceId,
    functionName: request.functionName,
    fileName: request.fileName,
    profileType: request.profileType,
    startTime: request.window.startTime.toISOString(),
    endTime: request.window.endTime.toISOString(),
    ...(request.beforeWindow
      ? {
          beforeStartTime: request.beforeWindow.startTime.toISOString(),
          beforeEndTime: request.beforeWindow.endTime.toISOString(),
        }
      : {}),
  };
}

export const PROFILE_FIX_SUGGESTION_PATH: string =
  "/ai-investigation/profile-fix-suggestion";

export const PROFILE_FIX_CREATE_PATH: string =
  "/ai-investigation/create-profile-fix-task";

// What the function panel offers for "Fix with AI" (the server decides).
export async function fetchProfileFixSuggestion(
  request: ProfileFixRequestBody,
): Promise<ProfileFixSuggestion> {
  return parseProfileFixSuggestion(
    await post(PROFILE_FIX_SUGGESTION_PATH, fixBody(request)),
  );
}

/*
 * Start the fix: a Code task. Returns its id. From a slow-code finding
 * (insightId), the task names the finding and the finding links the task.
 */
export async function createProfileFixTask(
  request: ProfileFixRequestBody & {
    message?: string | undefined;
    repositoryId?: string | undefined;
    insightId?: string | undefined;
  },
): Promise<string> {
  const answer: JSONObject = await post(PROFILE_FIX_CREATE_PATH, {
    ...fixBody(request),
    ...(request.message ? { message: request.message } : {}),
    ...(request.repositoryId ? { repositoryId: request.repositoryId } : {}),
    ...(request.insightId ? { insightId: request.insightId } : {}),
  });

  return text(answer["taskId"]);
}

export interface ProfileFunctionFocus {
  lineNumber: number;
  selfValue: number;
  totalValue: number;
  sampleCount: number;
  windowTotal: number;
  windowSampleCount: number;
  // Rooted at the function: who calls it, and what it calls.
  callers: ProfileTreeNode | null;
  callees: ProfileTreeNode | null;
  truncated: boolean;
}

// The deepest a tree is read: deeper frames add nothing the panel shows.
const MAX_TREE_DEPTH: number = 64;

/*
 * A callers or callees tree from the answer, every field read defensively
 * and its depth bounded.
 */
export function readProfileTree(
  value: unknown,
  depth: number = 0,
): ProfileTreeNode | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record: JSONObject = value as JSONObject;
  const children: Array<ProfileTreeNode> = [];

  if (depth < MAX_TREE_DEPTH && Array.isArray(record["children"])) {
    for (const child of record["children"] as Array<unknown>) {
      const node: ProfileTreeNode | null = readProfileTree(child, depth + 1);

      if (node) {
        children.push(node);
      }
    }
  }

  return {
    functionName: text(record["functionName"]),
    fileName: text(record["fileName"]),
    frameType: text(record["frameType"]),
    selfValue: num(record["selfValue"]),
    totalValue: num(record["totalValue"]),
    children,
  };
}

// One function's callers and callees.
export async function fetchFunctionFocus(data: {
  functionName: string;
  fileName: string;
  window?: ProfileWindowRequest | undefined;
  profileId?: string | undefined;
  serviceIds?: Array<string> | undefined;
  profileTypes?: Array<string> | undefined;
}): Promise<ProfileFunctionFocus> {
  const answer: JSONObject = await post("/telemetry/profiles/function-focus", {
    functionName: data.functionName,
    fileName: data.fileName,
    ...(data.window
      ? {
          startTime: data.window.startTime.toISOString(),
          endTime: data.window.endTime.toISOString(),
        }
      : {}),
    ...(data.profileId ? { profileId: data.profileId } : {}),
    ...(data.serviceIds ? { serviceIds: data.serviceIds } : {}),
    ...(data.profileTypes ? { profileTypes: data.profileTypes } : {}),
  });

  return {
    lineNumber: num(answer["lineNumber"]),
    selfValue: num(answer["selfValue"]),
    totalValue: num(answer["totalValue"]),
    sampleCount: num(answer["sampleCount"]),
    windowTotal: num(answer["windowTotal"]),
    windowSampleCount: num(answer["windowSampleCount"]),
    callers: readProfileTree(answer["callers"]),
    callees: readProfileTree(answer["callees"]),
    truncated: answer["truncated"] === true,
  };
}

export interface ProfileRecentChange {
  time: Date;
  title: string;
  eventType: string;
}

// How far back the compare menu lists a service's changes.
export const RECENT_CHANGES_DAYS: number = 7;
export const RECENT_CHANGES_LIMIT: number = 10;

/*
 * A service's recorded changes - deploys, config changes, rollbacks - of
 * the last week, newest first: what the compare menu offers to read
 * "before and after". Nothing when the reader may read none.
 */
export async function fetchRecentChanges(data: {
  serviceId: string;
  now: Date;
}): Promise<Array<ProfileRecentChange>> {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId || !ObjectID.isValidUUID(data.serviceId)) {
    return [];
  }

  const result: AnalyticsListResult<ChangeEvent> =
    await AnalyticsModelAPI.getList<ChangeEvent>({
      modelType: ChangeEvent,
      query: {
        projectId: projectId,
        primaryEntityId: new ObjectID(data.serviceId),
        time: new InBetween(
          new Date(
            data.now.getTime() - RECENT_CHANGES_DAYS * 24 * 60 * 60 * 1000,
          ),
          data.now,
        ),
      } as Query<ChangeEvent>,
      select: {
        _id: true,
        time: true,
        title: true,
        eventType: true,
      },
      sort: {
        time: SortOrder.Descending,
      },
      limit: RECENT_CHANGES_LIMIT,
      skip: 0,
    });

  return (result.data || [])
    .map((change: ChangeEvent): ProfileRecentChange | null => {
      const time: Date | null = change.time ? new Date(change.time) : null;

      if (!time || isNaN(time.getTime())) {
        return null;
      }

      return {
        time,
        title: change.title || "",
        eventType: change.eventType || "",
      };
    })
    .filter(
      (change: ProfileRecentChange | null): change is ProfileRecentChange => {
        return change !== null;
      },
    );
}
