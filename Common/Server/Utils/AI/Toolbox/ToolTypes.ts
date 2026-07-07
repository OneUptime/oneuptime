import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import Permission from "../../../../Types/Permission";
import { AIChatCitationTarget } from "../../../../Types/AI/AIChatTypes";

/*
 * The execution context for a tool call. projectId is ALWAYS the tenant from
 * the authenticated request props — it is never a tool argument, so the model
 * cannot point a tool at another project.
 */
export interface ToolContext {
  projectId: ObjectID;
  props: DatabaseCommonInteractionProps;
}

export interface ToolExecutionResult {
  // Serialized, truncated and redacted data that goes into the LLM prompt.
  dataForLlm: string;
  rowCount: number;
  citationLabel: string;
  citationTarget?: AIChatCitationTarget | undefined;
  redactionCount: number;
  isTruncated: boolean;
}

export interface ObservabilityTool {
  name: string;
  description: string;
  // JSON Schema for the tool arguments, handed to the LLM.
  inputSchema: JSONObject;
  /*
   * The user must hold at least one of these permissions for the tool to
   * execute. For tools that call permission-checked services this is
   * defense-in-depth; for tools that call raw-SQL aggregation services it is
   * the authorization.
   */
  requiredPermissions: Array<Permission>;
  execute(args: JSONObject, ctx: ToolContext): Promise<ToolExecutionResult>;
}

/*
 * Defensive argument readers. Tool arguments come from the LLM and are
 * untrusted: everything is type-checked, defaulted and clamped.
 */
export class ToolArgs {
  public static getString(args: JSONObject, key: string): string | undefined {
    const value: unknown = args[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    return undefined;
  }

  public static getStringArray(
    args: JSONObject,
    key: string,
  ): Array<string> | undefined {
    const value: unknown = args[key];
    if (Array.isArray(value)) {
      const strings: Array<string> = value.filter((item: unknown) => {
        return typeof item === "string" && item.trim().length > 0;
      }) as Array<string>;
      if (strings.length > 0) {
        return strings;
      }
    }
    return undefined;
  }

  public static getNumber(
    args: JSONObject,
    key: string,
    options: { defaultValue: number; min: number; max: number },
  ): number {
    const value: unknown = args[key];
    let parsed: number = options.defaultValue;

    if (typeof value === "number" && Number.isFinite(value)) {
      parsed = value;
    } else if (typeof value === "string" && value.trim().length > 0) {
      const fromString: number = Number(value);
      if (Number.isFinite(fromString)) {
        parsed = fromString;
      }
    }

    return Math.min(options.max, Math.max(options.min, Math.floor(parsed)));
  }

  public static getBoolean(args: JSONObject, key: string): boolean | undefined {
    const value: unknown = args[key];
    if (typeof value === "boolean") {
      return value;
    }
    if (value === "true") {
      return true;
    }
    if (value === "false") {
      return false;
    }
    return undefined;
  }

  public static getObjectID(
    args: JSONObject,
    key: string,
  ): ObjectID | undefined {
    const value: string | undefined = this.getString(args, key);
    if (!value) {
      return undefined;
    }
    return new ObjectID(value);
  }

  /*
   * Combines the caller's optional serviceId filter with the user's owned-scope
   * access (from ModelPermission.getAccessibleServiceIdsForAnalyticsModel) into
   * the `serviceIds` filter to hand an aggregation service.
   *
   * `allowed === null` means the user has project-wide access: pass only the
   * caller's own filter (or undefined for no filter). Otherwise the user is
   * label/owned-restricted: intersect with any requested service and NEVER
   * return undefined or an empty array — an empty result is forced to a
   * no-match sentinel, because the aggregation services treat a missing/empty
   * serviceIds as "no filter" (which would leak the whole project).
   */
  public static scopeServiceIds(
    allowed: Array<ObjectID> | null,
    requested: ObjectID | undefined,
  ): Array<ObjectID> | undefined {
    if (allowed === null) {
      return requested ? [requested] : undefined;
    }

    let effective: Array<ObjectID> = allowed;
    if (requested) {
      effective = allowed.filter((id: ObjectID) => {
        return id.toString() === requested.toString();
      });
    }

    if (effective.length === 0) {
      return [ObjectID.getZeroObjectID()];
    }

    return effective;
  }

  /*
   * Time range for a tool call: explicit ISO startTime/endTime arguments,
   * clamped to a maximum window, defaulting to the last hour.
   */
  public static getTimeRange(
    args: JSONObject,
    options?: { defaultHours?: number; maxDays?: number },
  ): { startTime: Date; endTime: Date } {
    const defaultHours: number = options?.defaultHours ?? 1;
    const maxDays: number = options?.maxDays ?? 30;

    const endTimeString: string | undefined = this.getString(args, "endTime");
    const startTimeString: string | undefined = this.getString(
      args,
      "startTime",
    );

    /*
     * Reject unparseable timestamps instead of silently falling back to the
     * default window — a silent fallback answers a different question than the
     * one asked. Throwing lets the model see the error and retry with a valid
     * ISO 8601 value.
     */
    let endTime: Date = OneUptimeDate.getCurrentDate();
    if (endTimeString) {
      const parsed: Date = new Date(endTimeString);
      if (isNaN(parsed.getTime())) {
        throw new BadDataException(
          `endTime "${endTimeString}" is not a valid ISO 8601 timestamp (e.g. 2024-01-31T14:00:00Z).`,
        );
      }
      endTime = parsed;
    }

    let startTime: Date = OneUptimeDate.addRemoveHours(
      endTime,
      -1 * defaultHours,
    );
    if (startTimeString) {
      const parsed: Date = new Date(startTimeString);
      if (isNaN(parsed.getTime())) {
        throw new BadDataException(
          `startTime "${startTimeString}" is not a valid ISO 8601 timestamp (e.g. 2024-01-31T13:00:00Z).`,
        );
      }
      startTime = parsed;
    }

    if (startTime.getTime() >= endTime.getTime()) {
      throw new BadDataException("startTime must be before endTime.");
    }

    const maxWindowMs: number = maxDays * 24 * 60 * 60 * 1000;
    if (endTime.getTime() - startTime.getTime() > maxWindowMs) {
      startTime = new Date(endTime.getTime() - maxWindowMs);
    }

    return { startTime, endTime };
  }
}

// Shared JSON-Schema fragments for tool input schemas.
export const TimeRangeSchemaProperties: JSONObject = {
  startTime: {
    type: "string",
    description:
      "Start of the time range as an ISO 8601 timestamp. Defaults to one hour before endTime.",
  },
  endTime: {
    type: "string",
    description:
      "End of the time range as an ISO 8601 timestamp. Defaults to now.",
  },
};
