import ProfileSample from "../../../../Models/AnalyticsModels/ProfileSample";
import TelemetryReadAccess from "../../Telemetry/TelemetryReadAccess";
import {
  TelemetryReadScope,
  TelemetryServiceFilter,
} from "../../Telemetry/TelemetryReadScope";
import ProfileAggregationService, {
  FunctionComparisonResult,
  FunctionListItem,
  FunctionListResult,
} from "../../../Services/ProfileAggregationService";
import ProfileEvidence, {
  ProfileFunctionEvidence,
  ProfileKind,
  ProfileWindow,
} from "../../Profile/ProfileEvidence";
import BadDataException from "../../../../Types/Exception/BadDataException";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import {
  AIChatCitationTarget,
  AIChatCitationTargetType,
} from "../../../../Types/AI/AIChatTypes";
import {
  ProfileChangeDirection,
  ProfileFunctionChange,
  getFasterFunctions,
  getOwnCodeChanges,
  getSlowerFunctions,
} from "../../../../Utils/Profiles/ProfileComparison";
import {
  ProfileFrameOrigin,
  getProfileFrameOrigin,
} from "../../../../Utils/Profiles/ProfileFrames";
import {
  formatProfileShare,
  formatProfileValue,
} from "../../../../Utils/Profiles/ProfileTypes";
import { getShareOfWindow } from "../../../../Utils/Profiles/ProfileHotspot";
import ToolResultSerializer, { SerializedResult } from "./Serializer";
import WidgetBuilder from "./WidgetBuilder";
import {
  ObservabilityTool,
  TimeRangeSchemaProperties,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";

/*
 * CONTINUOUS PROFILING, FOR THE AI.
 *
 * Where a service spends its CPU time or memory, what got slower between
 * two windows (before and after a deploy, or a signal), and one function's
 * part with who calls it and what it calls. Investigations of incidents and
 * alerts, Ask AI, and the Code task the Profiler's "Fix with AI" starts all
 * read profiles through these tools, under the asker's own read scope.
 */

const PROFILE_READ_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.TelemetryAdmin,
  Permission.TelemetryMember,
  Permission.TelemetryViewer,
  Permission.ReadTelemetryServiceProfiles,
];

// The longest window a profile read covers.
const MAX_PROFILE_WINDOW_DAYS: number = 7;

const PROFILE_TYPE_ARGUMENT: JSONObject = {
  type: "string",
  description:
    "What to measure: cpu (CPU time, the default), wall (wall time, waiting included), memory (memory in use), allocations, locks (time waiting on locks) or goroutines - or one raw profile type such as alloc_objects.",
};

const SERVICE_ID_ARGUMENT: JSONObject = {
  type: "string",
  description:
    "Only profiles of this telemetry service, host or other resource (its OneUptime UUID, as lookup_context lists it). Leave it out for every profiled service.",
};

const SHARE_KEY_EXPLAINED: string =
  "self = time in the function's own code, total = the function and everything it calls, ownCode (the application's own functions only) = the function with the library, runtime and system code it calls down to the next function of the application's own - the time a change to it can win back - each as a share of the whole window.";

function originLabel(
  fileName: string,
  functionName: string,
  frameType: string,
): string {
  return ProfileEvidence.describeOrigin(
    getProfileFrameOrigin(fileName, functionName, frameType),
  );
}

function windowText(window: ProfileWindow): string {
  return `${window.startTime.toISOString()} to ${window.endTime.toISOString()}`;
}

/*
 * The Profiler page the evidence was read from: the service, the kind and
 * the window, so the citation opens the same view.
 */
function profilesTarget(data: {
  serviceId: ObjectID | undefined;
  kind: ProfileKind | null;
  window: ProfileWindow;
}): AIChatCitationTarget {
  const params: { [key: string]: string } = {
    startTime: data.window.startTime.toISOString(),
    endTime: data.window.endTime.toISOString(),
  };

  if (data.serviceId) {
    params["serviceId"] = data.serviceId.toString();
  }

  if (data.kind) {
    params["profileType"] = data.kind.selection;
  }

  return { type: AIChatCitationTargetType.Profiles, params };
}

function noProfilesResult(data: {
  serviceId: ObjectID | undefined;
  window: ProfileWindow;
  label: string;
}): ToolExecutionResult {
  return {
    dataForLlm: `No profiles were received ${
      data.serviceId ? "for this service " : ""
    }between ${windowText(data.window)}. The service may not be profiled (see the Profiler's setup guide), or this window may be before profiling started or past the data retention.`,
    rowCount: 0,
    citationLabel: data.label,
    citationTarget: profilesTarget({
      serviceId: data.serviceId,
      kind: null,
      window: data.window,
    }),
    redactionCount: 0,
    isTruncated: false,
  };
}

async function getScopedFilter(
  args: JSONObject,
  ctx: ToolContext,
): Promise<{
  serviceId: ObjectID | undefined;
  serviceFilter: TelemetryServiceFilter;
}> {
  const serviceId: ObjectID | undefined = ToolArgs.getObjectID(
    args,
    "serviceId",
  );

  /*
   * The aggregation reads build their own SQL, which the model layer never
   * narrows: they are narrowed here to the services this user may read.
   */
  const scope: TelemetryReadScope = await TelemetryReadAccess.getScope(
    ProfileSample,
    ctx.props,
  );

  return {
    serviceId,
    serviceFilter: ToolArgs.scopeServiceIds(scope, serviceId),
  };
}

function kindNote(kind: ProfileKind): string {
  if (kind.insteadOf) {
    return ` (no ${ProfileEvidence.describeKind({
      ...kind,
      category: kind.insteadOf,
    })} profiles in this window, so this reads ${ProfileEvidence.describeKind(kind)})`;
  }

  return "";
}

export const GetProfileHotspotsTool: ObservabilityTool = {
  name: "get_profile_hotspots",
  description:
    "Where a service spends its CPU time or memory, from continuous profiling: the functions that take the most of it in a time window, each with its self share (time in its own code), its total share (with everything it calls), its file and line, and whether it is the application's own code, a library, the runtime or the operating system. Use it when a service is slow, burns CPU or memory, or after a deploy; then compare_profiles shows what changed and get_profile_function shows who calls a function and what it calls.",
  inputSchema: {
    type: "object",
    properties: {
      ...TimeRangeSchemaProperties,
      serviceId: SERVICE_ID_ARGUMENT,
      profileType: PROFILE_TYPE_ARGUMENT,
      onlyOwnCode: {
        type: "boolean",
        description:
          "Only the application's own functions (no libraries, runtime or system code), ranked by their own-code time.",
      },
      limit: {
        type: "number",
        description: "How many functions to return (default 10, at most 25).",
      },
    },
  },
  requiredPermissions: PROFILE_READ_PERMISSIONS,
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const window: ProfileWindow = ToolArgs.getTimeRange(args, {
      defaultHours: 1,
      maxDays: MAX_PROFILE_WINDOW_DAYS,
    });
    const limit: number = ToolArgs.getNumber(args, "limit", {
      defaultValue: 10,
      min: 1,
      max: 25,
    });
    const onlyOwnCode: boolean =
      ToolArgs.getBoolean(args, "onlyOwnCode") === true;

    const { serviceId, serviceFilter } = await getScopedFilter(args, ctx);

    const label: string = `Profile hotspots, ${windowText(window)}`;

    const kind: ProfileKind | null = await ProfileEvidence.resolveKind({
      projectId: ctx.projectId,
      window,
      serviceFilter: serviceFilter,
      selection: ToolArgs.getString(args, "profileType"),
    });

    if (!kind) {
      return noProfilesResult({ serviceId, window, label });
    }

    const list: FunctionListResult =
      await ProfileAggregationService.getFunctionList({
        projectId: ctx.projectId,
        startTime: window.startTime,
        endTime: window.endTime,
        ...serviceFilter,
        profileTypes: kind.queryTypes,
        limit: 500,
        sortBy: "selfValue",
      });

    if (list.windowTotal <= 0) {
      return noProfilesResult({ serviceId, window, label });
    }

    /*
     * Asked for the application's own code, the functions are ranked by
     * their own-code time: a parser whose time all goes to JSON.parse leads,
     * though it has no self time of its own.
     */
    const functions: Array<FunctionListItem> = list.functions
      .filter((item: FunctionListItem): boolean => {
        return (
          !onlyOwnCode ||
          getProfileFrameOrigin(
            item.fileName,
            item.functionName,
            item.frameType,
          ) === ProfileFrameOrigin.Own
        );
      })
      .sort((a: FunctionListItem, b: FunctionListItem): number => {
        return onlyOwnCode ? b.ownValue - a.ownValue : 0;
      })
      .slice(0, limit);

    const rows: Array<JSONObject> = functions.map(
      (item: FunctionListItem, index: number): JSONObject => {
        return {
          rank: index + 1,
          function: item.functionName || "(anonymous)",
          file: item.fileName,
          line: item.lineNumber || "",
          code: originLabel(item.fileName, item.functionName, item.frameType),
          self: formatProfileShare(
            getShareOfWindow(item.selfValue, list.windowTotal),
          ),
          total: formatProfileShare(
            getShareOfWindow(item.totalValue, list.windowTotal),
          ),
          ownCode:
            item.ownValue > 0
              ? formatProfileShare(
                  getShareOfWindow(item.ownValue, list.windowTotal),
                )
              : "",
          selfValue: formatProfileValue(item.selfValue, kind.unit),
        };
      },
    );

    const header: string = `${ProfileEvidence.describeKind(kind)}${kindNote(kind)}, ${windowText(window)}: ${list.windowSampleCount} samples, ${formatProfileValue(list.windowTotal, kind.unit)} in all. ${SHARE_KEY_EXPLAINED}${
      list.truncated
        ? " The window held more distinct stacks than are read at once; the smallest are left out."
        : ""
    }`;

    const serialized: SerializedResult =
      ToolResultSerializer.serializeRows(rows);

    return {
      dataForLlm: `${header}\n${serialized.text}`,
      rowCount: serialized.rowCount,
      citationLabel: label,
      citationTarget: profilesTarget({ serviceId, kind, window }),
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
      widget:
        rows.length > 0
          ? WidgetBuilder.table({
              title: "Where the time goes",
              description: `${ProfileEvidence.describeKind(kind)} · ${windowText(window)}`,
              columns: [
                { key: "function", title: "Function", type: "text" },
                { key: "file", title: "File", type: "text" },
                { key: "code", title: "Code", type: "text" },
                { key: "self", title: "Self", type: "text" },
                { key: "total", title: "Total", type: "text" },
              ],
              rows: rows,
              link: profilesTarget({ serviceId, kind, window }),
            })
          : undefined,
    };
  },
};

/*
 * The two windows of a comparison: the ones asked for, or the hour around a
 * change (before it and after it), or the last hour and the one before.
 */
function getComparisonWindows(args: JSONObject): {
  before: ProfileWindow;
  after: ProfileWindow;
} {
  const changeTimeText: string | undefined = ToolArgs.getString(
    args,
    "changeTime",
  );

  if (changeTimeText) {
    const changeTime: Date = new Date(changeTimeText);

    if (isNaN(changeTime.getTime())) {
      throw new BadDataException(
        `changeTime "${changeTimeText}" is not a valid ISO 8601 timestamp (e.g. 2024-01-31T14:00:00Z).`,
      );
    }

    const now: Date = OneUptimeDate.getCurrentDate();
    const minutes: number = ToolArgs.getNumber(args, "windowMinutes", {
      defaultValue: 60,
      min: 5,
      max: 24 * 60,
    });
    const afterEnd: Date = new Date(
      Math.min(
        now.getTime(),
        OneUptimeDate.addRemoveMinutes(changeTime, minutes).getTime(),
      ),
    );

    if (afterEnd.getTime() <= changeTime.getTime()) {
      throw new BadDataException(
        "changeTime must be in the past: there is nothing after it to compare yet.",
      );
    }

    const length: number = afterEnd.getTime() - changeTime.getTime();

    return {
      before: {
        startTime: new Date(changeTime.getTime() - length),
        endTime: changeTime,
      },
      after: { startTime: changeTime, endTime: afterEnd },
    };
  }

  const after: ProfileWindow = ToolArgs.getTimeRange(
    {
      startTime: args["afterStartTime"],
      endTime: args["afterEndTime"],
    } as JSONObject,
    { defaultHours: 1, maxDays: MAX_PROFILE_WINDOW_DAYS },
  );

  const hasBefore: boolean = Boolean(
    ToolArgs.getString(args, "beforeStartTime") ||
      ToolArgs.getString(args, "beforeEndTime"),
  );

  if (hasBefore) {
    const before: ProfileWindow = ToolArgs.getTimeRange(
      {
        startTime: args["beforeStartTime"],
        endTime: args["beforeEndTime"],
      } as JSONObject,
      { defaultHours: 1, maxDays: MAX_PROFILE_WINDOW_DAYS },
    );

    return { before, after };
  }

  const length: number = after.endTime.getTime() - after.startTime.getTime();

  return {
    before: {
      startTime: new Date(after.startTime.getTime() - length),
      endTime: after.startTime,
    },
    after,
  };
}

// One of the application's own functions, by its own-code share.
function ownChangeRow(change: ProfileFunctionChange): JSONObject {
  return {
    function: change.functionName || "(anonymous)",
    file: change.fileName,
    ownCodeBefore: formatProfileShare(change.before?.ownShare || 0),
    ownCodeAfter: formatProfileShare(change.after?.ownShare || 0),
    change: `${change.ownShareChange >= 0 ? "+" : ""}${change.ownShareChange.toFixed(1)} points`,
  };
}

function changeRow(change: ProfileFunctionChange): JSONObject {
  return {
    function: change.functionName || "(anonymous)",
    file: change.fileName,
    code: originLabel(change.fileName, change.functionName, change.frameType),
    selfBefore: formatProfileShare(change.before?.selfShare || 0),
    selfAfter: formatProfileShare(change.after?.selfShare || 0),
    change: `${change.selfShareChange >= 0 ? "+" : ""}${change.selfShareChange.toFixed(1)} points`,
    totalBefore: formatProfileShare(change.before?.totalShare || 0),
    totalAfter: formatProfileShare(change.after?.totalShare || 0),
    status:
      change.direction === ProfileChangeDirection.New
        ? "new"
        : change.direction === ProfileChangeDirection.Gone
          ? "gone"
          : change.direction,
  };
}

export const CompareProfilesTool: ObservabilityTool = {
  name: "compare_profiles",
  description:
    "What got slower (or heavier on memory) between two windows of a service's continuous profile: before and after a deploy or a change (changeTime), or two windows you name, or the last hour and the hour before. Each function is measured as its share of its own window, so more traffic alone shows no change. Returns the functions whose self share grew the most, and those that shrank. Pair it with recent_changes: the deploy time is the changeTime.",
  inputSchema: {
    type: "object",
    properties: {
      serviceId: SERVICE_ID_ARGUMENT,
      profileType: PROFILE_TYPE_ARGUMENT,
      changeTime: {
        type: "string",
        description:
          "A deploy or change time (ISO 8601): compares the windowMinutes before it with the windowMinutes after it.",
      },
      windowMinutes: {
        type: "number",
        description:
          "With changeTime: how many minutes on each side (default 60, at most 1440).",
      },
      beforeStartTime: {
        type: "string",
        description: "Start of the earlier window (ISO 8601).",
      },
      beforeEndTime: {
        type: "string",
        description: "End of the earlier window (ISO 8601).",
      },
      afterStartTime: {
        type: "string",
        description:
          "Start of the later window (ISO 8601). Defaults to one hour before afterEndTime.",
      },
      afterEndTime: {
        type: "string",
        description: "End of the later window (ISO 8601). Defaults to now.",
      },
      limit: {
        type: "number",
        description:
          "How many grown and shrunk functions to return (default 8 each, at most 20).",
      },
    },
  },
  requiredPermissions: PROFILE_READ_PERMISSIONS,
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const { before, after } = getComparisonWindows(args);
    const limit: number = ToolArgs.getNumber(args, "limit", {
      defaultValue: 8,
      min: 1,
      max: 20,
    });

    const { serviceId, serviceFilter } = await getScopedFilter(args, ctx);

    const label: string = `Profile comparison, ${windowText(before)} vs ${windowText(after)}`;

    const kind: ProfileKind | null = await ProfileEvidence.resolveKind({
      projectId: ctx.projectId,
      window: { startTime: before.startTime, endTime: after.endTime },
      serviceFilter: serviceFilter,
      selection: ToolArgs.getString(args, "profileType"),
    });

    if (!kind) {
      return noProfilesResult({
        serviceId,
        window: { startTime: before.startTime, endTime: after.endTime },
        label,
      });
    }

    const comparison: FunctionComparisonResult =
      await ProfileAggregationService.getFunctionComparison({
        projectId: ctx.projectId,
        beforeStartTime: before.startTime,
        beforeEndTime: before.endTime,
        afterStartTime: after.startTime,
        afterEndTime: after.endTime,
        ...serviceFilter,
        profileTypes: kind.queryTypes,
        limit: 200,
      });

    const slower: Array<JSONObject> = getSlowerFunctions(comparison.changes)
      .slice(0, limit)
      .map(changeRow);
    const faster: Array<JSONObject> = getFasterFunctions(comparison.changes)
      .slice(0, limit)
      .map(changeRow);
    /*
     * The application's own functions whose own-code share grew: a parser
     * whose time went to JSON.parse shows no self growth of its own, but it
     * is the code to change.
     */
    const ownGrowth: Array<JSONObject> = getOwnCodeChanges(comparison.changes)
      .filter((change: ProfileFunctionChange): boolean => {
        return change.ownShareChange > 0;
      })
      .slice(0, limit)
      .map(ownChangeRow);

    const footing: string = comparison.isFooted
      ? ""
      : " One window holds too few samples for its shares to be compared with confidence; treat the changes as hints.";

    const header: string = `${ProfileEvidence.describeKind(kind)}${kindNote(kind)}. Before: ${windowText(before)} (${comparison.before.windowSampleCount} samples). After: ${windowText(after)} (${comparison.after.windowSampleCount} samples). Shares are of each window's own total; "points" are percentage points of self share.${footing}`;

    const slowerText: SerializedResult =
      ToolResultSerializer.serializeRows(slower);
    const fasterText: SerializedResult =
      ToolResultSerializer.serializeRows(faster);
    const ownText: SerializedResult =
      ToolResultSerializer.serializeRows(ownGrowth);

    const dataForLlm: string = [
      header,
      slower.length > 0
        ? `Took a bigger share after (slower or new):\n${slowerText.text}`
        : "No function's share grew past the noise floor.",
      faster.length > 0
        ? `Took a smaller share after (faster or gone):\n${fasterText.text}`
        : "No function's share shrank past the noise floor.",
      ownGrowth.length > 0
        ? `The application's own functions whose own-code share grew (the function with the library and runtime code it calls - the code to change):\n${ownText.text}`
        : "No function of the application's own code grew past the noise floor.",
    ].join("\n\n");

    return {
      dataForLlm,
      rowCount: slower.length + faster.length + ownGrowth.length,
      citationLabel: label,
      citationTarget: profilesTarget({ serviceId, kind, window: after }),
      redactionCount:
        slowerText.redactionCount +
        fasterText.redactionCount +
        ownText.redactionCount,
      isTruncated:
        slowerText.isTruncated || fasterText.isTruncated || ownText.isTruncated,
      widget:
        slower.length > 0
          ? WidgetBuilder.table({
              title: "What got slower",
              description: `${windowText(before)} → ${windowText(after)}`,
              columns: [
                { key: "function", title: "Function", type: "text" },
                { key: "code", title: "Code", type: "text" },
                { key: "selfBefore", title: "Before", type: "text" },
                { key: "selfAfter", title: "After", type: "text" },
                { key: "change", title: "Change", type: "text" },
              ],
              rows: slower,
              link: profilesTarget({ serviceId, kind, window: after }),
            })
          : undefined,
    };
  },
};

export const GetProfileFunctionTool: ObservabilityTool = {
  name: "get_profile_function",
  description:
    "One function's part of a service's continuous profile: its self, total and own-code share of the time (own-code time is the function and the library, runtime and system code it calls, down to the next function of the application's own - what a change to it can win back), its hottest line, the heaviest chains that call it, and what it spends its time calling. Give a before window to see how it changed. Use it after get_profile_hotspots or compare_profiles names a function.",
  inputSchema: {
    type: "object",
    properties: {
      ...TimeRangeSchemaProperties,
      functionName: {
        type: "string",
        description:
          "The function's name exactly as the profile shows it (required).",
      },
      fileName: {
        type: "string",
        description:
          "Its file as the profile shows it. Leave it out for the file the function takes the most time in.",
      },
      serviceId: SERVICE_ID_ARGUMENT,
      profileType: PROFILE_TYPE_ARGUMENT,
      beforeStartTime: {
        type: "string",
        description: "Start of a window to compare with (ISO 8601).",
      },
      beforeEndTime: {
        type: "string",
        description: "End of the window to compare with (ISO 8601).",
      },
    },
    required: ["functionName"],
  },
  requiredPermissions: PROFILE_READ_PERMISSIONS,
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const functionName: string | undefined = ToolArgs.getString(
      args,
      "functionName",
    );

    if (!functionName) {
      throw new BadDataException("functionName is required.");
    }

    const window: ProfileWindow = ToolArgs.getTimeRange(args, {
      defaultHours: 1,
      maxDays: MAX_PROFILE_WINDOW_DAYS,
    });

    const hasBefore: boolean = Boolean(
      ToolArgs.getString(args, "beforeStartTime") &&
        ToolArgs.getString(args, "beforeEndTime"),
    );
    const beforeWindow: ProfileWindow | undefined = hasBefore
      ? ToolArgs.getTimeRange(
          {
            startTime: args["beforeStartTime"],
            endTime: args["beforeEndTime"],
          } as JSONObject,
          { defaultHours: 1, maxDays: MAX_PROFILE_WINDOW_DAYS },
        )
      : undefined;

    const { serviceId, serviceFilter } = await getScopedFilter(args, ctx);

    const label: string = `Profile of ${functionName}, ${windowText(window)}`;

    const kind: ProfileKind | null = await ProfileEvidence.resolveKind({
      projectId: ctx.projectId,
      window,
      serviceFilter: serviceFilter,
      selection: ToolArgs.getString(args, "profileType"),
    });

    if (!kind) {
      return noProfilesResult({ serviceId, window, label });
    }

    const evidence: ProfileFunctionEvidence | null =
      await ProfileEvidence.readFunction({
        projectId: ctx.projectId,
        serviceFilter: serviceFilter,
        kind,
        functionName,
        fileName:
          typeof args["fileName"] === "string" ? args["fileName"] : undefined,
        window,
        beforeWindow,
      });

    if (!evidence) {
      return {
        dataForLlm: `${functionName} took no ${ProfileEvidence.describeKind(kind)} between ${windowText(window)}${
          serviceId ? " in this service" : ""
        }. Check its name against get_profile_hotspots, or try a wider window.`,
        rowCount: 0,
        citationLabel: label,
        citationTarget: profilesTarget({ serviceId, kind, window }),
        redactionCount: 0,
        isTruncated: false,
      };
    }

    const serialized: SerializedResult = ToolResultSerializer.serializeText(
      `${ProfileEvidence.toText(evidence)}${kindNote(kind) ? `\nNote:${kindNote(kind)}` : ""}`,
      1,
    );

    return {
      dataForLlm: serialized.text,
      rowCount: 1,
      citationLabel: label,
      citationTarget: profilesTarget({ serviceId, kind, window }),
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
    };
  },
};
