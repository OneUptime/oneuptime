import ProfileAggregationService, {
  FunctionFocusResult,
  FunctionListItem,
  FunctionListResult,
} from "../../Services/ProfileAggregationService";
import { TelemetryServiceFilter } from "../Telemetry/TelemetryReadScope";
import CaptureSpan from "../Telemetry/CaptureSpan";
import ObjectID from "../../../Types/ObjectID";
import {
  ProfileFrameOrigin,
  getProfileFrameOrigin,
} from "../../../Utils/Profiles/ProfileFrames";
import {
  ProfileCallChain,
  ProfileCallee,
  getOwnCodeValue,
  getShareOfWindow,
  getTopCallerChains,
  getTopCallees,
} from "../../../Utils/Profiles/ProfileHotspot";
import {
  DEFAULT_PROFILE_CATEGORY,
  ProfileCategory,
  ProfileCategoryAvailability,
  ProfileTypeActivity,
  ProfileValueUnit,
  formatProfileShare,
  formatProfileValue,
  getAvailableProfileCategories,
  getProfileCategory,
  getProfileCategoryNoun,
  getProfileValueUnit,
  isProfileCategory,
} from "../../../Utils/Profiles/ProfileTypes";

/*
 * WHAT A PROFILE SAYS ABOUT A SERVICE OR ONE OF ITS FUNCTIONS, AS EVIDENCE.
 *
 * The AI tools (Toolbox/ProfileTools), the Code task's Profile context
 * (CodeTaskContextBuilder) and the Profiler's "Fix with AI"
 * (ProfileFixTaskTrigger) read the same figures the same way:
 *
 *   - which kind of profile to read (CPU time unless asked otherwise, in
 *     the one unit the scope's data is in), resolveKind;
 *   - one function's share of the window - self, total and own-code time -
 *     with who calls it and what it calls, readFunction;
 *   - the same, as text an engineer or a model reads, toText.
 *
 * Every read takes the caller's service filter (TelemetryReadScope): the
 * callers work it out from TelemetryReadAccess before they get here.
 */

export interface ProfileKind {
  // What was asked for: a kind ("cpu") or one raw type ("alloc_objects").
  selection: string;
  // The kind read; null for a raw type of no kind.
  category: ProfileCategory | null;
  queryTypes: Array<string>;
  unit: ProfileValueUnit;
  /*
   * When CPU time was the default and the scope had none, the kind read
   * instead - the first the scope has.
   */
  insteadOf?: ProfileCategory | undefined;
}

export interface ProfileWindow {
  startTime: Date;
  endTime: Date;
}

export interface ProfileFunctionEvidence {
  functionName: string;
  fileName: string;
  lineNumber: number;
  frameType: string;
  origin: ProfileFrameOrigin;
  kind: ProfileKind;
  window: ProfileWindow;
  selfValue: number;
  totalValue: number;
  // Time in it and in other code it calls, down to the next own function.
  ownValue: number;
  sampleCount: number;
  windowTotal: number;
  windowSampleCount: number;
  // 0-100, of the window.
  selfShare: number;
  totalShare: number;
  ownShare: number;
  // The window it is compared with, when there is one.
  before?:
    | {
        window: ProfileWindow;
        selfShare: number;
        totalShare: number;
        ownShare: number;
        sampleCount: number;
        windowSampleCount: number;
      }
    | undefined;
  callerChains: Array<ProfileCallChain>;
  callees: Array<ProfileCallee>;
  // Other files a function of this name was found in (the file was not given).
  otherFiles: Array<string>;
  truncated: boolean;
}

export default class ProfileEvidence {
  /*
   * The kind to read and its raw types: what the scope has data for, in one
   * unit. A kind the scope has no data for reads as nothing - except the
   * default (CPU time), which gives way to the first kind the scope has, so
   * "where does this service spend its time?" answers for a service that
   * is profiled for memory only.
   */
  @CaptureSpan()
  public static async resolveKind(data: {
    projectId: ObjectID;
    window: ProfileWindow;
    serviceFilter: TelemetryServiceFilter;
    selection?: string | undefined;
  }): Promise<ProfileKind | null> {
    const asked: string = (data.selection || "").trim();
    const selection: string = asked || DEFAULT_PROFILE_CATEGORY;

    const activity: Array<ProfileTypeActivity> =
      await ProfileAggregationService.getProfileTypeActivity({
        projectId: data.projectId,
        startTime: data.window.startTime,
        endTime: data.window.endTime,
        ...data.serviceFilter,
      });

    if (isProfileCategory(selection.toLowerCase())) {
      const category: ProfileCategory = selection.toLowerCase() as ProfileCategory;
      const available: Array<ProfileCategoryAvailability> =
        getAvailableProfileCategories(activity);
      const match: ProfileCategoryAvailability | undefined = available.find(
        (entry: ProfileCategoryAvailability): boolean => {
          return entry.category === category;
        },
      );

      if (match) {
        return {
          selection: category,
          category,
          queryTypes: match.queryTypes,
          unit: match.unit,
        };
      }

      if (!asked && available[0]) {
        return {
          selection: available[0].category,
          category: available[0].category,
          queryTypes: available[0].queryTypes,
          unit: available[0].unit,
          insteadOf: category,
        };
      }

      return null;
    }

    const row: ProfileTypeActivity | undefined = activity.find(
      (entry: ProfileTypeActivity): boolean => {
        return entry.profileType === selection;
      },
    );

    if (!row) {
      return null;
    }

    const category: ProfileCategory = getProfileCategory(selection);

    return {
      selection,
      category: category === ProfileCategory.Other ? null : category,
      queryTypes: [selection],
      unit: getProfileValueUnit(selection, row.unit),
    };
  }

  /*
   * One function's part of the window, with its callers and callees. The
   * file, when not given, is the one the function takes the most time in;
   * the others are listed. Null when the function took no time there.
   */
  @CaptureSpan()
  public static async readFunction(data: {
    projectId: ObjectID;
    serviceFilter: TelemetryServiceFilter;
    kind: ProfileKind;
    functionName: string;
    fileName?: string | undefined;
    window: ProfileWindow;
    beforeWindow?: ProfileWindow | undefined;
  }): Promise<ProfileFunctionEvidence | null> {
    let fileName: string | undefined = data.fileName;
    let otherFiles: Array<string> = [];

    if (fileName === undefined) {
      const list: FunctionListResult =
        await ProfileAggregationService.getFunctionList({
          projectId: data.projectId,
          startTime: data.window.startTime,
          endTime: data.window.endTime,
          ...data.serviceFilter,
          profileTypes: data.kind.queryTypes,
          limit: 1000,
          sortBy: "totalValue",
        });

      const sameName: Array<FunctionListItem> = list.functions.filter(
        (item: FunctionListItem): boolean => {
          return item.functionName === data.functionName;
        },
      );

      if (sameName.length === 0) {
        return null;
      }

      fileName = sameName[0]!.fileName;
      otherFiles = sameName.slice(1, 6).map((item: FunctionListItem) => {
        return item.fileName;
      });
    }

    const focus: FunctionFocusResult =
      await ProfileAggregationService.getFunctionFocus({
        projectId: data.projectId,
        functionName: data.functionName,
        fileName,
        startTime: data.window.startTime,
        endTime: data.window.endTime,
        ...data.serviceFilter,
        profileTypes: data.kind.queryTypes,
      });

    if (focus.totalValue <= 0) {
      return null;
    }

    const ownValue: number = getOwnCodeValue(focus.callees);

    const evidence: ProfileFunctionEvidence = {
      functionName: data.functionName,
      fileName,
      lineNumber: focus.lineNumber,
      frameType: focus.callees.frameType || "",
      origin: getProfileFrameOrigin(
        fileName,
        data.functionName,
        focus.callees.frameType,
      ),
      kind: data.kind,
      window: data.window,
      selfValue: focus.selfValue,
      totalValue: focus.totalValue,
      ownValue,
      sampleCount: focus.sampleCount,
      windowTotal: focus.windowTotal,
      windowSampleCount: focus.windowSampleCount,
      selfShare: getShareOfWindow(focus.selfValue, focus.windowTotal),
      totalShare: getShareOfWindow(focus.totalValue, focus.windowTotal),
      ownShare: getShareOfWindow(ownValue, focus.windowTotal),
      callerChains: getTopCallerChains(focus.callers, { limit: 5, depth: 4 }),
      callees: getTopCallees(focus.callees, { limit: 8 }),
      otherFiles,
      truncated: focus.truncated,
    };

    if (data.beforeWindow) {
      const before: FunctionFocusResult =
        await ProfileAggregationService.getFunctionFocus({
          projectId: data.projectId,
          functionName: data.functionName,
          fileName,
          startTime: data.beforeWindow.startTime,
          endTime: data.beforeWindow.endTime,
          ...data.serviceFilter,
          profileTypes: data.kind.queryTypes,
        });

      evidence.before = {
        window: data.beforeWindow,
        selfShare: getShareOfWindow(before.selfValue, before.windowTotal),
        totalShare: getShareOfWindow(before.totalValue, before.windowTotal),
        ownShare: getShareOfWindow(
          getOwnCodeValue(before.callees),
          before.windowTotal,
        ),
        sampleCount: before.sampleCount,
        windowSampleCount: before.windowSampleCount,
      };
      evidence.truncated = evidence.truncated || before.truncated;
    }

    return evidence;
  }

  // What a kind measures, in a sentence: "CPU time", "memory in use".
  public static describeKind(kind: ProfileKind): string {
    return kind.category
      ? getProfileCategoryNoun(kind.category)
      : `the "${kind.selection}" profile`;
  }

  // The function's evidence as text an engineer or a model reads.
  public static toText(
    evidence: ProfileFunctionEvidence,
    options?: { serviceName?: string | undefined },
  ): string {
    const where: string = evidence.fileName
      ? `${evidence.fileName}${evidence.lineNumber > 0 ? `:${evidence.lineNumber}` : ""}`
      : "(no file recorded)";
    const of: string = ProfileEvidence.describeKind(evidence.kind);
    const service: string = options?.serviceName
      ? ` of ${options.serviceName}`
      : "";
    const unit: ProfileValueUnit = evidence.kind.unit;

    const lines: Array<string> = [
      `Function: ${evidence.functionName || "(anonymous)"}`,
      `File: ${where}`,
      `Whose code: ${ProfileEvidence.describeOrigin(evidence.origin)}`,
      `Profile: ${of}${service}, ${evidence.window.startTime.toISOString()} to ${evidence.window.endTime.toISOString()} (${evidence.windowSampleCount} samples)`,
      `Self: ${formatProfileShare(evidence.selfShare)} of the window (${formatProfileValue(evidence.selfValue, unit)}) - time in the function's own code.`,
      `Total: ${formatProfileShare(evidence.totalShare)} (${formatProfileValue(evidence.totalValue, unit)}) - the function and everything it calls.`,
      `Own-code time: ${formatProfileShare(evidence.ownShare)} (${formatProfileValue(evidence.ownValue, unit)}) - the function and the library, runtime and system code it calls, down to the next function of the application's own: what a change to this function can win back.`,
      `Samples through it: ${evidence.sampleCount}`,
    ];

    if (evidence.before) {
      lines.push(
        `Compared with ${evidence.before.window.startTime.toISOString()} to ${evidence.before.window.endTime.toISOString()} (${evidence.before.windowSampleCount} samples): own-code time ${formatProfileShare(evidence.before.ownShare)} -> ${formatProfileShare(evidence.ownShare)}, self ${formatProfileShare(evidence.before.selfShare)} -> ${formatProfileShare(evidence.selfShare)}, total ${formatProfileShare(evidence.before.totalShare)} -> ${formatProfileShare(evidence.totalShare)}.`,
      );
    }

    if (evidence.callerChains.length > 0) {
      lines.push("Called from (heaviest chains, direct caller first):");

      for (const chain of evidence.callerChains) {
        lines.push(
          `- ${formatProfileShare(getShareOfWindow(chain.value, evidence.windowTotal))}: ${chain.frames
            .map((frame: { functionName: string; fileName: string }) => {
              return ProfileEvidence.describeFrame(frame);
            })
            .join(" <- ")}`,
        );
      }
    }

    if (evidence.callees.length > 0) {
      lines.push("Spends its time calling:");

      for (const callee of evidence.callees) {
        lines.push(
          `- ${formatProfileShare(getShareOfWindow(callee.value, evidence.windowTotal))}: ${ProfileEvidence.describeFrame(callee)} (${ProfileEvidence.describeOrigin(
            getProfileFrameOrigin(
              callee.fileName,
              callee.functionName,
              callee.frameType,
            ),
          )})`,
        );
      }
    }

    if (evidence.otherFiles.length > 0) {
      lines.push(
        `A function of the same name also ran in: ${evidence.otherFiles.join(", ")}`,
      );
    }

    if (evidence.truncated) {
      lines.push(
        "The window held more distinct stacks than are read at once: the smallest ones are left out of these figures.",
      );
    }

    return lines.join("\n");
  }

  public static describeOrigin(origin: ProfileFrameOrigin): string {
    switch (origin) {
      case ProfileFrameOrigin.Own:
        return "the application's own code";
      case ProfileFrameOrigin.Dependency:
        return "a library";
      case ProfileFrameOrigin.Runtime:
        return "the language runtime";
      case ProfileFrameOrigin.Native:
        return "the operating system";
      default:
        return "unknown";
    }
  }

  private static describeFrame(frame: {
    functionName: string;
    fileName: string;
  }): string {
    return frame.fileName
      ? `${frame.functionName || "(anonymous)"} (${frame.fileName})`
      : frame.functionName || "(anonymous)";
  }
}
