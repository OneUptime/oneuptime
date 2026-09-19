import TelemetryException from "../../../../../Models/DatabaseModels/TelemetryException";
import TelemetryExceptionService from "../../../../../Server/Services/TelemetryExceptionService";
import AIToolbox, {
  ToolCallOutcome,
} from "../../../../../Server/Utils/AI/Toolbox/Index";
import { TopExceptionsTool } from "../../../../../Server/Utils/AI/Toolbox/ExceptionTools";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../../Server/Utils/AI/Toolbox/ToolTypes";
import {
  AIChatCitationTargetType,
  AIChatWidgetType,
} from "../../../../../Types/AI/AIChatTypes";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../../Types/Date";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

const projectId: ObjectID = new ObjectID(
  "11111111-1111-1111-1111-111111111111",
);
const otherProjectId: ObjectID = new ObjectID(
  "99999999-9999-9999-9999-999999999999",
);
const exceptionId: ObjectID = new ObjectID(
  "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
);
const NOW: Date = new Date("2026-09-17T12:00:00.000Z");
const HOUR_MS: number = 60 * 60 * 1000;

/*
 * QueryHelper comparison helpers return TypeORM Raw operators whose bound
 * values live in objectLiteralParameters.
 */
interface RawOperator {
  objectLiteralParameters: Record<string, unknown>;
  getSql: (alias: string) => string;
}

function context(
  allowed: Array<Permission> = [Permission.ProjectMember],
  blocked: Array<Permission> = [],
): ToolContext {
  const toUserPermission: (
    isBlock: boolean,
  ) => (permission: Permission) => JSONObject = (
    isBlock: boolean,
  ): ((permission: Permission) => JSONObject) => {
    return (permission: Permission): JSONObject => {
      return {
        permission: permission,
        labelIds: [],
        isBlockPermission: isBlock,
        _type: "UserPermission",
      };
    };
  };
  return {
    projectId: projectId,
    props: {
      tenantId: projectId,
      userId: ObjectID.generate(),
      userGlobalAccessPermission: {
        globalPermissions: [Permission.Public],
        projectIds: [projectId],
        _type: "UserGlobalAccessPermission",
      },
      userTenantAccessPermission: {
        [projectId.toString()]: {
          projectId: projectId,
          permissions: [
            ...allowed.map(toUserPermission(false)),
            ...blocked.map(toUserPermission(true)),
          ],
          _type: "UserTenantAccessPermission",
        },
      },
    } as unknown as DatabaseCommonInteractionProps,
  };
}

function exception(data: {
  message?: string;
  exceptionType?: string;
  occuranceCount?: number;
  firstSeenAt?: Date;
  lastSeenAt?: Date;
  isResolved?: boolean;
  fingerprint?: string;
}): TelemetryException {
  const result: TelemetryException = new TelemetryException();
  result._id = exceptionId.toString();
  if (data.message !== undefined) {
    result.message = data.message;
  }
  if (data.exceptionType !== undefined) {
    result.exceptionType = data.exceptionType;
  }
  if (data.occuranceCount !== undefined) {
    result.occuranceCount = data.occuranceCount;
  }
  if (data.firstSeenAt !== undefined) {
    result.firstSeenAt = data.firstSeenAt;
  }
  if (data.lastSeenAt !== undefined) {
    result.lastSeenAt = data.lastSeenAt;
  }
  if (data.isResolved !== undefined) {
    result.isResolved = data.isResolved;
  }
  if (data.fingerprint !== undefined) {
    result.fingerprint = data.fingerprint;
  }
  return result;
}

function callArg(spy: jest.SpyInstance, index: number = 0): JSONObject {
  return spy.mock.calls[index]![0] as JSONObject;
}

function lastSeenBound(spy: jest.SpyInstance, index: number = 0): Date {
  const query: JSONObject = callArg(spy, index)["query"] as JSONObject;
  const operator: RawOperator = query["lastSeenAt"] as unknown as RawOperator;
  const values: Array<unknown> = Object.values(
    operator.objectLiteralParameters,
  );
  expect(values).toHaveLength(1);
  return values[0] as Date;
}

beforeEach(() => {
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("top_exceptions", () => {
  test("defaults to unresolved exceptions seen in the last 7 days, top 10 by count, under caller props", async () => {
    const ctx: ToolContext = context();
    const findBy: jest.SpyInstance = jest
      .spyOn(TelemetryExceptionService, "findBy")
      .mockResolvedValue([]);

    await TopExceptionsTool.execute({}, ctx);

    expect(findBy).toHaveBeenCalledTimes(1);
    const call: JSONObject = callArg(findBy);
    expect(call["props"]).toBe(ctx.props);
    expect(call["limit"]).toBe(10);
    expect(call["skip"]).toBe(0);
    expect(call["sort"]).toEqual({ occuranceCount: SortOrder.Descending });
    expect(call["select"]).toEqual({
      _id: true,
      message: true,
      exceptionType: true,
      fingerprint: true,
      occuranceCount: true,
      firstSeenAt: true,
      lastSeenAt: true,
      isResolved: true,
    });

    const query: JSONObject = call["query"] as JSONObject;
    expect(Object.keys(query).sort()).toEqual(["isResolved", "lastSeenAt"]);
    expect(query["isResolved"]).toBe(false);
    expect(lastSeenBound(findBy)).toEqual(
      new Date(NOW.getTime() - 168 * HOUR_MS),
    );
    const operator: RawOperator = query["lastSeenAt"] as unknown as RawOperator;
    expect(operator.getSql('"lastSeenAt"')).toContain(">=");
  });

  test("ignores project or tenant ids supplied as arguments", async () => {
    const ctx: ToolContext = context();
    const findBy: jest.SpyInstance = jest
      .spyOn(TelemetryExceptionService, "findBy")
      .mockResolvedValue([]);

    await TopExceptionsTool.execute(
      {
        projectId: otherProjectId.toString(),
        tenantId: otherProjectId.toString(),
      },
      ctx,
    );

    const call: JSONObject = callArg(findBy);
    const query: JSONObject = call["query"] as JSONObject;
    expect(query["projectId"]).toBeUndefined();
    expect(query["tenantId"]).toBeUndefined();
    expect(call["props"]).toBe(ctx.props);
    expect(
      (call["props"] as DatabaseCommonInteractionProps).tenantId?.toString(),
    ).toBe(projectId.toString());
  });

  test.each([true, "true"])(
    "includeResolved=%p drops the isResolved filter",
    async (value: boolean | string) => {
      const findBy: jest.SpyInstance = jest
        .spyOn(TelemetryExceptionService, "findBy")
        .mockResolvedValue([]);

      await TopExceptionsTool.execute({ includeResolved: value }, context());

      const query: JSONObject = callArg(findBy)["query"] as JSONObject;
      expect(query["isResolved"]).toBeUndefined();
    },
  );

  test.each([false, "false", "yes", 1, null])(
    "includeResolved=%p keeps resolved exceptions filtered out",
    async (value: unknown) => {
      const findBy: jest.SpyInstance = jest
        .spyOn(TelemetryExceptionService, "findBy")
        .mockResolvedValue([]);

      await TopExceptionsTool.execute(
        { includeResolved: value } as unknown as JSONObject,
        context(),
      );

      const query: JSONObject = callArg(findBy)["query"] as JSONObject;
      expect(query["isResolved"]).toBe(false);
    },
  );

  test.each([
    [5000, 720],
    [720, 720],
    [0, 1],
    [-24, 1],
    ["48", 48],
    [2.7, 2],
    ["soon", 168],
  ])(
    "clamps lastSeenWithinHours %p to %p",
    async (input: unknown, expected: number) => {
      const findBy: jest.SpyInstance = jest
        .spyOn(TelemetryExceptionService, "findBy")
        .mockResolvedValue([]);

      const result: ToolExecutionResult = await TopExceptionsTool.execute(
        { lastSeenWithinHours: input } as unknown as JSONObject,
        context(),
      );

      expect(lastSeenBound(findBy)).toEqual(
        new Date(NOW.getTime() - expected * HOUR_MS),
      );
      expect(result.citationLabel).toBe(
        `Top exceptions, last ${expected}h (0 found)`,
      );
    },
  );

  test.each([
    [100, 25],
    [25, 25],
    [0, 1],
    [-3, 1],
    ["5", 5],
    [undefined, 10],
  ])("clamps limit %p to %p", async (input: unknown, expected: number) => {
    const findBy: jest.SpyInstance = jest
      .spyOn(TelemetryExceptionService, "findBy")
      .mockResolvedValue([]);

    await TopExceptionsTool.execute(
      { limit: input } as unknown as JSONObject,
      context(),
    );

    expect(callArg(findBy)["limit"]).toBe(expected);
  });

  test("formats exception groups for the model and an exception-list widget", async () => {
    const firstSeen: Date = new Date("2026-09-10T08:00:00.000Z");
    const lastSeen: Date = new Date("2026-09-17T11:45:00.000Z");
    jest.spyOn(TelemetryExceptionService, "findBy").mockResolvedValue([
      exception({
        message: "Cannot read properties of undefined",
        exceptionType: "TypeError",
        occuranceCount: 420,
        firstSeenAt: firstSeen,
        lastSeenAt: lastSeen,
        isResolved: false,
        fingerprint: "fp-1",
      }),
    ]);

    const result: ToolExecutionResult = await TopExceptionsTool.execute(
      { lastSeenWithinHours: 24 },
      context(),
    );

    expect(result.rowCount).toBe(1);
    expect(result.dataForLlm).toBe(
      `- id=${exceptionId.toString()} | type=TypeError | message=Cannot read properties of undefined | occurrences=420 | firstSeenAt=${firstSeen.toISOString()} | lastSeenAt=${lastSeen.toISOString()} | isResolved=false | fingerprint=fp-1`,
    );
    expect(result.citationLabel).toBe("Top exceptions, last 24h (1 found)");
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.Exceptions,
    });
    expect(result.isTruncated).toBe(false);
    expect(result.redactionCount).toBe(0);

    expect(result.widget?.type).toBe(AIChatWidgetType.ExceptionList);
    expect(result.widget?.title).toBe("Top exceptions (1)");
    expect(result.widget?.description).toBe("Last 24h, by occurrence count");
    expect(result.widget?.data.link).toEqual({
      type: AIChatCitationTargetType.Exceptions,
    });
    expect(result.widget?.data.items).toEqual([
      {
        id: exceptionId.toString(),
        type: "TypeError",
        message: "Cannot read properties of undefined",
        occurrences: 420,
        firstSeenAt: firstSeen,
        lastSeenAt: lastSeen,
        isResolved: false,
        fingerprint: "fp-1",
      },
    ]);
  });

  test("redacts secrets in exception messages before they reach the model, but not in the widget", async () => {
    const message: string =
      "auth failed for ops@example.com with password=hunter22 from 10.0.0.5";
    jest
      .spyOn(TelemetryExceptionService, "findBy")
      .mockResolvedValue([exception({ message: message, occuranceCount: 1 })]);

    const result: ToolExecutionResult = await TopExceptionsTool.execute(
      {},
      context(),
    );

    expect(result.dataForLlm).not.toContain("ops@example.com");
    expect(result.dataForLlm).not.toContain("hunter22");
    expect(result.dataForLlm).not.toContain("10.0.0.5");
    expect(result.dataForLlm).toContain("[redacted-email]");
    expect(result.dataForLlm).toContain("password=[redacted]");
    expect(result.dataForLlm).toContain("[redacted-ip]");
    expect(result.redactionCount).toBe(3);
    expect((result.widget?.data.items || [])[0]!["message"]).toBe(message);
  });

  test("omits missing fields rather than printing placeholders", async () => {
    jest
      .spyOn(TelemetryExceptionService, "findBy")
      .mockResolvedValue([exception({ message: "boom" })]);

    const result: ToolExecutionResult = await TopExceptionsTool.execute(
      {},
      context(),
    );

    expect(result.dataForLlm).toBe(
      `- id=${exceptionId.toString()} | message=boom`,
    );
    expect(result.dataForLlm).not.toContain("undefined");
  });

  test("empty results produce no widget", async () => {
    jest.spyOn(TelemetryExceptionService, "findBy").mockResolvedValue([]);

    const result: ToolExecutionResult = await TopExceptionsTool.execute(
      {},
      context(),
    );

    expect(result.rowCount).toBe(0);
    expect(result.dataForLlm).toBe("(no rows found)");
    expect(result.widget).toBeUndefined();
    expect(result.citationLabel).toBe("Top exceptions, last 168h (0 found)");
  });

  test("propagates service failures", async () => {
    jest
      .spyOn(TelemetryExceptionService, "findBy")
      .mockRejectedValue(new Error("database down"));

    await expect(TopExceptionsTool.execute({}, context())).rejects.toThrow(
      "database down",
    );
  });
});

describe("top_exceptions permission gate", () => {
  test("requiredPermissions mirror the TelemetryException read ACL and are cached", () => {
    const expected: Array<Permission> =
      new TelemetryException().getReadPermissions();
    const first: Array<Permission> = TopExceptionsTool.requiredPermissions;
    expect(first).toEqual(expected);
    expect(first.length).toBeGreaterThan(0);
    expect(TopExceptionsTool.requiredPermissions).toBe(first);
    expect(first).toContain(Permission.ReadTelemetryException);
  });

  test("is registered in the toolbox as a read-only tool", () => {
    expect(AIToolbox.getToolByName("top_exceptions")).toBe(TopExceptionsTool);
    expect(AIToolbox.isMutationTool("top_exceptions")).toBe(false);
  });

  test("grants telemetry readers and denies everyone else", () => {
    expect(
      AIToolbox.hasPermissionForTool(
        TopExceptionsTool,
        context([Permission.TelemetryViewer]),
      ),
    ).toBe(true);
    expect(
      AIToolbox.hasPermissionForTool(
        TopExceptionsTool,
        context([Permission.ReadTelemetryException]),
      ),
    ).toBe(true);
    expect(AIToolbox.hasPermissionForTool(TopExceptionsTool, context([]))).toBe(
      false,
    );
    expect(
      AIToolbox.hasPermissionForTool(
        TopExceptionsTool,
        context([Permission.ProjectMember], [Permission.ProjectMember]),
      ),
    ).toBe(false);
  });

  test("refuses cross-project and multi-tenant contexts without querying", async () => {
    const findBy: jest.SpyInstance = jest
      .spyOn(TelemetryExceptionService, "findBy")
      .mockResolvedValue([]);
    const ctx: ToolContext = context();

    const crossProject: ToolCallOutcome = await AIToolbox.executeTool({
      name: "top_exceptions",
      args: {},
      ctx: { ...ctx, projectId: otherProjectId },
    });
    const multiTenant: ToolCallOutcome = await AIToolbox.executeTool({
      name: "top_exceptions",
      args: {},
      ctx: { ...ctx, props: { ...ctx.props, isMultiTenantRequest: true } },
    });

    expect(crossProject.success).toBe(false);
    expect(crossProject.textForLlm).toContain("single project");
    expect(multiTenant.success).toBe(false);
    expect(findBy).not.toHaveBeenCalled();
  });
});
