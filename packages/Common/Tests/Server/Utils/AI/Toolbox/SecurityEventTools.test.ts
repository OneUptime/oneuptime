import SecurityEvent from "../../../../../Models/AnalyticsModels/SecurityEvent";
import SecurityEventService from "../../../../../Server/Services/SecurityEventService";
import AIToolbox, {
  ToolCallOutcome,
} from "../../../../../Server/Utils/AI/Toolbox/Index";
import {
  SearchSecurityEventsTool,
  SecurityEventSummaryTool,
  securityEventSearchRow,
} from "../../../../../Server/Utils/AI/Toolbox/SecurityEventTools";
import {
  ObservabilityTool,
  ToolContext,
  ToolExecutionResult,
} from "../../../../../Server/Utils/AI/Toolbox/ToolTypes";
import {
  AIChatCitationTargetType,
  AIChatWidgetColumn,
  AIChatWidgetType,
} from "../../../../../Types/AI/AIChatTypes";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import InBetween from "../../../../../Types/BaseDatabase/InBetween";
import Includes from "../../../../../Types/BaseDatabase/Includes";
import Search from "../../../../../Types/BaseDatabase/Search";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../../Types/Date";
import BadDataException from "../../../../../Types/Exception/BadDataException";
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
const NOW: Date = new Date("2026-09-17T12:00:00.000Z");
const HOUR_MS: number = 60 * 60 * 1000;
const DEFAULT_START: Date = new Date(NOW.getTime() - 24 * HOUR_MS);

function context(
  allowed: Array<Permission> = [Permission.SecurityViewer],
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

function securityEvent(data: JSONObject): SecurityEvent {
  return data as unknown as SecurityEvent;
}

function callArg(spy: jest.SpyInstance, index: number = 0): JSONObject {
  return spy.mock.calls[index]![0] as JSONObject;
}

function queryOf(spy: jest.SpyInstance, index: number = 0): JSONObject {
  return callArg(spy, index)["query"] as JSONObject;
}

beforeEach(() => {
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("search_security_events", () => {
  test("defaults to the last 24h, 25 events, newest first, under the caller's props", async () => {
    const ctx: ToolContext = context();
    const findBy: jest.SpyInstance = jest
      .spyOn(SecurityEventService, "findBy")
      .mockResolvedValue([]);

    await SearchSecurityEventsTool.execute({}, ctx);

    const call: JSONObject = callArg(findBy);
    expect(call["props"]).toBe(ctx.props);
    expect(call["limit"]).toBe(25);
    expect(call["skip"]).toBe(0);
    expect(call["sort"]).toEqual({ time: SortOrder.Descending });
    expect(call["select"]).toEqual({
      time: true,
      severityName: true,
      className: true,
      activityName: true,
      statusName: true,
      message: true,
      principalUser: true,
      principalHost: true,
      principalIp: true,
      principalProcess: true,
      processName: true,
      processPath: true,
      processCommandLine: true,
      parentProcessName: true,
      parentProcessPath: true,
      parentProcessCommandLine: true,
      targetUser: true,
      targetHost: true,
      targetIp: true,
      targetPort: true,
      targetResource: true,
      vendorName: true,
      ruleName: true,
      mitreTechniques: true,
    });

    const query: JSONObject = call["query"] as JSONObject;
    expect(Object.keys(query)).toEqual(["time"]);
    const time: InBetween<Date> = query["time"] as InBetween<Date>;
    expect(time).toBeInstanceOf(InBetween);
    expect(time.startValue).toEqual(DEFAULT_START);
    expect(time.endValue).toEqual(NOW);
  });

  test("never lets arguments redirect the query to another project", async () => {
    const ctx: ToolContext = context();
    const findBy: jest.SpyInstance = jest
      .spyOn(SecurityEventService, "findBy")
      .mockResolvedValue([]);

    await SearchSecurityEventsTool.execute(
      {
        projectId: otherProjectId.toString(),
        tenantId: otherProjectId.toString(),
      },
      ctx,
    );

    const call: JSONObject = callArg(findBy);
    expect(call["props"]).toBe(ctx.props);
    expect(Object.keys(call["query"] as JSONObject)).toEqual(["time"]);
    expect(JSON.stringify(call)).not.toContain(otherProjectId.toString());
  });

  test("applies every supported filter", async () => {
    const findBy: jest.SpyInstance = jest
      .spyOn(SecurityEventService, "findBy")
      .mockResolvedValue([]);

    await SearchSecurityEventsTool.execute(
      {
        severityNames: ["Critical", "High", ""],
        classNames: ["Authentication"],
        messageSearchText: "  failed login ",
        principalUser: " alice ",
        principalHost: "web-01",
        observable: " 203.0.113.9 ",
        processName: " PowerShell ",
        commandLineSearchText: "-enc",
      },
      context(),
    );

    const query: JSONObject = queryOf(findBy);
    expect((query["severityName"] as Includes).values).toEqual([
      "Critical",
      "High",
    ]);
    expect((query["className"] as Includes).values).toEqual(["Authentication"]);
    expect(query["message"]).toBeInstanceOf(Search);
    expect((query["message"] as Search<string>).value).toBe("failed login");
    expect(query["principalUser"]).toBe("alice");
    expect(query["principalHost"]).toBe("web-01");
    expect(query["observables"]).toBeInstanceOf(Includes);
    expect((query["observables"] as Includes).values).toEqual(["203.0.113.9"]);
    // A process by part of its name and a command line by part of it, in any case.
    expect(query["processName"]).toBeInstanceOf(Search);
    expect((query["processName"] as Search<string>).value).toBe("PowerShell");
    expect(query["processCommandLine"]).toBeInstanceOf(Search);
    expect((query["processCommandLine"] as Search<string>).value).toBe("-enc");
  });

  test("describes the process filters to the model, and what each event carries", () => {
    const properties: JSONObject = (
      SearchSecurityEventsTool.inputSchema as JSONObject
    )["properties"] as JSONObject;

    expect(Object.keys(properties)).toEqual(
      expect.arrayContaining(["processName", "commandLineSearchText"]),
    );
    expect(SearchSecurityEventsTool.description).toContain("command line");
    expect(SearchSecurityEventsTool.description).toContain("principalProcess");
  });

  test("ignores blank and wrongly-typed filters", async () => {
    const findBy: jest.SpyInstance = jest
      .spyOn(SecurityEventService, "findBy")
      .mockResolvedValue([]);

    await SearchSecurityEventsTool.execute(
      {
        severityNames: [],
        classNames: "Authentication",
        messageSearchText: "   ",
        principalUser: 42,
        principalHost: null,
        observable: ["1.2.3.4"],
        processName: "   ",
        commandLineSearchText: 42,
      } as unknown as JSONObject,
      context(),
    );

    expect(Object.keys(queryOf(findBy))).toEqual(["time"]);
  });

  test.each([
    [1000, 50],
    [0, 1],
    [-10, 1],
    ["12", 12],
    [3.99, 3],
    [{}, 25],
  ])("clamps limit %p to %p", async (input: unknown, expected: number) => {
    const findBy: jest.SpyInstance = jest
      .spyOn(SecurityEventService, "findBy")
      .mockResolvedValue([]);

    await SearchSecurityEventsTool.execute(
      { limit: input } as unknown as JSONObject,
      context(),
    );

    expect(callArg(findBy)["limit"]).toBe(expected);
  });

  test("clamps windows longer than 30 days and rejects invalid timestamps", async () => {
    const findBy: jest.SpyInstance = jest
      .spyOn(SecurityEventService, "findBy")
      .mockResolvedValue([]);

    await SearchSecurityEventsTool.execute(
      { startTime: "2020-01-01T00:00:00Z" },
      context(),
    );
    const time: InBetween<Date> = queryOf(findBy)["time"] as InBetween<Date>;
    expect(time.startValue).toEqual(
      new Date(NOW.getTime() - 30 * 24 * HOUR_MS),
    );
    expect(time.endValue).toEqual(NOW);

    await expect(
      SearchSecurityEventsTool.execute({ endTime: "tomorrow" }, context()),
    ).rejects.toThrow(BadDataException);
    expect(findBy).toHaveBeenCalledTimes(1);
  });

  /*
   * A security question is about its observables: the model reads the
   * addresses and the emails (a sign-in from [redacted-ip] cannot be judged,
   * nor looked up in threat intel) - and the secrets stay redacted, as in
   * every other tool's results (keepSecurityObservables).
   */
  test("formats events for the model (observables kept, secrets redacted) and a table widget (raw)", async () => {
    const time: Date = new Date("2026-09-17T11:00:00.000Z");
    jest.spyOn(SecurityEventService, "findBy").mockResolvedValue([
      securityEvent({
        time: time,
        severityName: "High",
        className: "Authentication",
        message: "Failed login for alice@example.com password=hunter2hunter2",
        principalUser: "alice",
        principalHost: "web-01",
        principalIp: "203.0.113.9",
        targetHost: "db-01",
        vendorName: "Okta",
        ruleName: "Brute force",
      }),
    ]);

    const result: ToolExecutionResult = await SearchSecurityEventsTool.execute(
      {},
      context(),
    );

    expect(result.rowCount).toBe(1);
    expect(result.dataForLlm).toBe(
      `- time=${time.toISOString()} | severity=High | class=Authentication | message=Failed login for alice@example.com password=[redacted] | principalUser=alice | principalHost=web-01 | principalIp=203.0.113.9 | targetHost=db-01 | vendor=Okta | rule=Brute force`,
    );
    expect(result.redactionCount).toBe(1);
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.SecurityEvents,
    });
    expect(result.citationLabel).toBe(
      `Security events ${DEFAULT_START.toISOString()} – ${NOW.toISOString()} (1 shown)`,
    );

    expect(result.widget?.type).toBe(AIChatWidgetType.Table);
    expect(result.widget?.title).toBe("Security Events (1)");
    expect(
      (result.widget?.data.columns || []).map((column: AIChatWidgetColumn) => {
        return column.key;
      }),
    ).toEqual(["time", "severity", "class", "message", "principalHost"]);
    const rows: Array<JSONObject> = result.widget?.data.rows || [];
    expect(rows[0]!["principalIp"]).toBe("203.0.113.9");
    expect(rows[0]!["message"]).toBe(
      "Failed login for alice@example.com password=hunter2hunter2",
    );
    expect(result.widget?.data.link).toEqual({
      type: AIChatCitationTargetType.SecurityEvents,
    });
  });

  test("empty results produce no widget", async () => {
    jest.spyOn(SecurityEventService, "findBy").mockResolvedValue([]);

    const result: ToolExecutionResult = await SearchSecurityEventsTool.execute(
      {},
      context(),
    );

    expect(result.rowCount).toBe(0);
    expect(result.dataForLlm).toBe("(no rows found)");
    expect(result.widget).toBeUndefined();
  });

  test("propagates service failures", async () => {
    jest
      .spyOn(SecurityEventService, "findBy")
      .mockRejectedValue(new Error("clickhouse timeout"));

    await expect(
      SearchSecurityEventsTool.execute({}, context()),
    ).rejects.toThrow("clickhouse timeout");
  });
});

/*
 * What the model reads of an event decides what it can judge. A process
 * launch's message is often only its class ("Process Activity"): without
 * the command line and the parent, an encoded PowerShell command or a
 * credential dump read as nothing at all.
 */
describe("search_security_events rows", () => {
  const time: Date = new Date("2026-09-17T11:00:00.000Z");

  async function search(
    events: Array<JSONObject>,
    args: JSONObject = {},
  ): Promise<ToolExecutionResult> {
    jest
      .spyOn(SecurityEventService, "findBy")
      .mockResolvedValue(events.map(securityEvent));

    return SearchSecurityEventsTool.execute(args, context());
  }

  const ENCODED_POWERSHELL: JSONObject = {
    time: time,
    severityName: "High",
    className: "Process Activity",
    activityName: "Launch",
    statusName: "Success",
    message: "Process Activity",
    principalUser: "CORP\\alice",
    principalHost: "wkstn-042",
    principalIp: "10.0.4.42",
    principalProcess: "WINWORD.EXE",
    processName: "powershell.exe",
    processPath:
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    processCommandLine: "powershell.exe -nop -enc JABzAD0A",
    parentProcessName: "WINWORD.EXE",
    parentProcessPath:
      "C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE",
    parentProcessCommandLine: '"WINWORD.EXE" /n "C:\\Users\\a\\invoice.docm"',
    targetUser: "",
    targetHost: "",
    targetIp: "",
    targetPort: 0,
    targetResource: "",
    vendorName: "Microsoft",
    ruleName: "",
    mitreTechniques: ["T1059.001", "T1027"],
  };

  test("a launch carries what ran: its activity, status, process, command line and parent", async () => {
    const result: ToolExecutionResult = await search([ENCODED_POWERSHELL]);

    expect(result.dataForLlm).toBe(
      [
        `- time=${time.toISOString()}`,
        "severity=High",
        "class=Process Activity",
        "activity=Launch",
        "status=Success",
        "message=Process Activity",
        "principalUser=CORP\\alice",
        "principalHost=wkstn-042",
        "principalIp=10.0.4.42",
        "process=powershell.exe",
        "processPath=C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
        "commandLine=powershell.exe -nop -enc JABzAD0A",
        "parentProcess=WINWORD.EXE",
        "parentProcessPath=C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE",
        'parentCommandLine="WINWORD.EXE" /n "C:\\Users\\a\\invoice.docm"',
        "vendor=Microsoft",
        "techniques=T1059.001, T1027",
      ].join(" | "),
    );
  });

  test("in a launch the process that acted is the parent, named once", async () => {
    const result: ToolExecutionResult = await search([ENCODED_POWERSHELL]);

    expect(result.dataForLlm).not.toContain("principalProcess=");
  });

  test("in an open the process that acted is another one, and is named", async () => {
    const result: ToolExecutionResult = await search([
      {
        ...ENCODED_POWERSHELL,
        activityName: "Open",
        principalProcess: "mimikatz.exe sekurlsa::logonpasswords",
        processName: "lsass.exe",
        processPath: "C:\\Windows\\System32\\lsass.exe",
        processCommandLine: "",
        parentProcessName: "wininit.exe",
        parentProcessPath: "",
        parentProcessCommandLine: "",
      },
    ]);

    expect(result.dataForLlm).toContain("activity=Open");
    expect(result.dataForLlm).toContain(
      "principalProcess=mimikatz.exe sekurlsa::logonpasswords | process=lsass.exe",
    );
    expect(result.dataForLlm).toContain("parentProcess=wininit.exe");
    expect(result.dataForLlm).not.toContain("commandLine=");
  });

  test("any other event names the process that acted once: as its process", async () => {
    const result: ToolExecutionResult = await search([
      {
        time: time,
        className: "Network Activity",
        principalProcess: "POWERSHELL.EXE",
        processName: "powershell.exe",
        targetIp: "203.0.113.7",
        targetPort: 443,
      },
    ]);

    expect(result.dataForLlm).toBe(
      `- time=${time.toISOString()} | class=Network Activity | process=powershell.exe | targetIp=203.0.113.7 | targetPort=443`,
    );
  });

  test("an event stored before OneUptime read process fields keeps its process as principalProcess", async () => {
    const result: ToolExecutionResult = await search([
      {
        time: time,
        className: "Process Activity",
        principalProcess: "/usr/bin/cat /etc/shadow",
      },
    ]);

    expect(result.dataForLlm).toBe(
      `- time=${time.toISOString()} | class=Process Activity | principalProcess=/usr/bin/cat /etc/shadow`,
    );
  });

  test("what the event touched is named: the user, host, address, port and resource", async () => {
    const result: ToolExecutionResult = await search([
      {
        time: time,
        className: "Authentication",
        statusName: "Failure",
        principalIp: "203.0.113.9",
        targetUser: "root",
        targetHost: "web-03",
        targetIp: "192.0.2.10",
        targetPort: 22,
        targetResource: "sshd",
      },
    ]);

    expect(result.dataForLlm).toBe(
      `- time=${time.toISOString()} | class=Authentication | status=Failure | principalIp=203.0.113.9 | targetUser=root | targetHost=web-03 | targetIp=192.0.2.10 | targetPort=22 | targetResource=sshd`,
    );
  });

  test("blanks, a 0 port and empty lists are left out", async () => {
    const result: ToolExecutionResult = await search([
      {
        time: time,
        className: "Base Event",
        message: "   ",
        targetPort: 0,
        mitreTechniques: [],
        processName: "",
        activityName: "",
      },
    ]);

    expect(result.dataForLlm).toBe(
      `- time=${time.toISOString()} | class=Base Event`,
    );
  });

  test("a command line's secrets are redacted, its addresses kept", async () => {
    const result: ToolExecutionResult = await search([
      {
        ...ENCODED_POWERSHELL,
        processCommandLine:
          "curl -H 'Authorization: Bearer abcdefghijklmnop0123456789' http://203.0.113.7/x password=hunter2hunter2",
      },
    ]);

    expect(result.dataForLlm).toContain("http://203.0.113.7/x");
    expect(result.dataForLlm).toContain("[redacted-token]");
    expect(result.dataForLlm).toContain("password=[redacted]");
    expect(result.dataForLlm).not.toContain("hunter2hunter2");
    expect(result.dataForLlm).not.toContain("abcdefghijklmnop0123456789");
  });

  test("a very long command line is cut, and says so", async () => {
    const result: ToolExecutionResult = await search([
      {
        ...ENCODED_POWERSHELL,
        processCommandLine: `powershell.exe -enc ${"A".repeat(10000)}`,
      },
    ]);

    expect(result.isTruncated).toBe(true);
    expect(result.dataForLlm).toContain("… [truncated]");
  });

  describe("the table beside the answer", () => {
    function columnKeys(result: ToolExecutionResult): Array<string> {
      return (result.widget?.data.columns || []).map(
        (column: AIChatWidgetColumn) => {
          return column.key;
        },
      );
    }

    test("shows a Process column when an event names a process, its command line first", async () => {
      const result: ToolExecutionResult = await search([
        ENCODED_POWERSHELL,
        { time: time, className: "Authentication", principalHost: "web-01" },
      ]);

      expect(columnKeys(result)).toEqual([
        "time",
        "severity",
        "class",
        "message",
        "processShown",
        "principalHost",
      ]);
      expect(
        (result.widget?.data.columns || []).find(
          (column: AIChatWidgetColumn) => {
            return column.key === "processShown";
          },
        )?.title,
      ).toBe("Process");

      const rows: Array<JSONObject> = result.widget?.data.rows || [];
      expect(rows[0]!["processShown"]).toBe(
        "powershell.exe -nop -enc JABzAD0A",
      );
      expect(rows[1]!["processShown"]).toBeUndefined();
    });

    test("names a process by its name when there is no command line, else by the process that acted", async () => {
      const result: ToolExecutionResult = await search([
        { time: time, className: "Process Activity", processName: "lsass.exe" },
        {
          time: time,
          className: "Process Activity",
          principalProcess: "/usr/bin/cat /etc/shadow",
        },
      ]);

      const rows: Array<JSONObject> = result.widget?.data.rows || [];
      expect(rows[0]!["processShown"]).toBe("lsass.exe");
      expect(rows[1]!["processShown"]).toBe("/usr/bin/cat /etc/shadow");
    });

    test("keeps the table it had when no event names a process", async () => {
      const result: ToolExecutionResult = await search([
        { time: time, className: "Authentication", principalHost: "web-01" },
      ]);

      expect(columnKeys(result)).toEqual([
        "time",
        "severity",
        "class",
        "message",
        "principalHost",
      ]);
    });

    test("never shows the model the table's own column", async () => {
      const result: ToolExecutionResult = await search([ENCODED_POWERSHELL]);

      expect(result.dataForLlm).not.toContain("processShown");
    });
  });
});

describe("securityEventSearchRow", () => {
  test("is a row of only what the event says, in the order a responder reads it", () => {
    expect(
      Object.keys(
        securityEventSearchRow(
          securityEvent({
            time: new Date("2026-09-17T11:00:00.000Z"),
            severityName: "High",
            className: "Process Activity",
            activityName: "Inject",
            statusName: "Success",
            message: "Injected",
            principalUser: "alice",
            principalHost: "wkstn-042",
            principalIp: "10.0.4.42",
            principalProcess: "loader.exe",
            processName: "explorer.exe",
            processPath: "C:\\Windows\\explorer.exe",
            processCommandLine: "explorer.exe",
            parentProcessName: "userinit.exe",
            parentProcessPath: "C:\\Windows\\System32\\userinit.exe",
            parentProcessCommandLine: "userinit.exe",
            targetUser: "bob",
            targetHost: "dc-01",
            targetIp: "10.0.0.5",
            targetPort: 445,
            targetResource: "C$",
            vendorName: "Microsoft",
            ruleName: "Injection into explorer",
            mitreTechniques: ["T1055"],
          }),
        ),
      ),
    ).toEqual([
      "time",
      "severity",
      "class",
      "activity",
      "status",
      "message",
      "principalUser",
      "principalHost",
      "principalIp",
      "principalProcess",
      "process",
      "processPath",
      "commandLine",
      "parentProcess",
      "parentProcessPath",
      "parentCommandLine",
      "targetUser",
      "targetHost",
      "targetIp",
      "targetPort",
      "targetResource",
      "vendor",
      "rule",
      "techniques",
    ]);
  });

  test("reads the process that acted as the same one whatever its case", () => {
    expect(
      securityEventSearchRow(
        securityEvent({
          principalProcess: " C:\\WINDOWS\\SYSTEM32\\CMD.EXE ",
          parentProcessPath: "C:\\Windows\\System32\\cmd.exe",
        }),
      )["principalProcess"],
    ).toBeUndefined();
  });

  test("leaves out values that are not text, a number or a list", () => {
    expect(
      securityEventSearchRow(
        securityEvent({
          message: { nested: true },
          targetPort: Number.NaN,
          mitreTechniques: ["", "  ", 7],
        } as unknown as JSONObject),
      ),
    ).toEqual({});
  });
});

describe("security_event_summary", () => {
  test("samples at most 500 recent events through the permission-checked model layer", async () => {
    const ctx: ToolContext = context();
    const findBy: jest.SpyInstance = jest
      .spyOn(SecurityEventService, "findBy")
      .mockResolvedValue([]);

    await SecurityEventSummaryTool.execute(
      { limit: 5, projectId: otherProjectId.toString() },
      ctx,
    );

    const call: JSONObject = callArg(findBy);
    expect(call["props"]).toBe(ctx.props);
    expect(call["limit"]).toBe(500);
    expect(call["skip"]).toBe(0);
    expect(call["sort"]).toEqual({ time: SortOrder.Descending });
    expect(call["select"]).toEqual({ className: true, severityName: true });
    const query: JSONObject = call["query"] as JSONObject;
    expect(Object.keys(query)).toEqual(["time"]);
    expect((query["time"] as InBetween<Date>).startValue).toEqual(
      DEFAULT_START,
    );
  });

  test("scopes to an observable when given", async () => {
    const findBy: jest.SpyInstance = jest
      .spyOn(SecurityEventService, "findBy")
      .mockResolvedValue([]);

    await SecurityEventSummaryTool.execute(
      { observable: " web-01 " },
      context(),
    );
    await SecurityEventSummaryTool.execute({ observable: "  " }, context());

    expect((queryOf(findBy, 0)["observables"] as Includes).values).toEqual([
      "web-01",
    ]);
    expect(queryOf(findBy, 1)["observables"]).toBeUndefined();
  });

  test("counts events by class and severity, most frequent first, with fallbacks", async () => {
    const events: Array<SecurityEvent> = [
      securityEvent({ className: "Authentication", severityName: "High" }),
      securityEvent({ className: "Authentication", severityName: "High" }),
      securityEvent({ className: "Authentication", severityName: "High" }),
      securityEvent({ className: "Authentication", severityName: "Low" }),
      securityEvent({ className: "DNS Activity", severityName: "Low" }),
      securityEvent({ className: "DNS Activity", severityName: "Low" }),
      securityEvent({}),
    ];
    jest.spyOn(SecurityEventService, "findBy").mockResolvedValue(events);

    const result: ToolExecutionResult = await SecurityEventSummaryTool.execute(
      {},
      context(),
    );

    expect(result.rowCount).toBe(4);
    expect(result.dataForLlm).toBe(
      [
        "- class=Authentication | severity=High | count=3",
        "- class=DNS Activity | severity=Low | count=2",
        "- class=Authentication | severity=Low | count=1",
        "- class=Base Event | severity=Unknown | count=1",
      ].join("\n"),
    );
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.SecurityEvents,
    });
    expect(result.citationLabel).toBe(
      `Security event summary ${DEFAULT_START.toISOString()} – ${NOW.toISOString()}`,
    );
    expect(result.widget?.type).toBe(AIChatWidgetType.Table);
    expect(result.widget?.title).toBe("Security events by class and severity");
    expect(
      (result.widget?.data.columns || []).map((column: AIChatWidgetColumn) => {
        return column.key;
      }),
    ).toEqual(["class", "severity", "count"]);
    expect(result.widget?.data.rows).toHaveLength(4);
  });

  test("flags counts as a floor when the 500-event sample is full", async () => {
    const events: Array<SecurityEvent> = [];
    for (let i: number = 0; i < 500; i++) {
      events.push(
        securityEvent({
          className: "Detection Finding",
          severityName: i % 2 === 0 ? "Critical" : "Medium",
        }),
      );
    }
    jest.spyOn(SecurityEventService, "findBy").mockResolvedValue(events);

    const result: ToolExecutionResult = await SecurityEventSummaryTool.execute(
      {},
      context(),
    );

    const note: string =
      " (based on the most recent 500 events — counts are a floor)";
    expect(result.dataForLlm.endsWith(note)).toBe(true);
    expect(result.dataForLlm).toContain(
      "class=Detection Finding | severity=Critical | count=250",
    );
    expect(result.citationLabel.endsWith(note)).toBe(true);
    expect(result.widget?.description).toContain("counts are a floor");
  });

  test("does not claim sampling when fewer than 500 events were found", async () => {
    jest
      .spyOn(SecurityEventService, "findBy")
      .mockResolvedValue([
        securityEvent({ className: "Authentication", severityName: "High" }),
      ]);

    const result: ToolExecutionResult = await SecurityEventSummaryTool.execute(
      {},
      context(),
    );

    expect(result.dataForLlm).not.toContain("counts are a floor");
    expect(result.citationLabel).not.toContain("counts are a floor");
  });

  test("empty results produce no widget", async () => {
    jest.spyOn(SecurityEventService, "findBy").mockResolvedValue([]);

    const result: ToolExecutionResult = await SecurityEventSummaryTool.execute(
      {},
      context(),
    );

    expect(result.rowCount).toBe(0);
    expect(result.dataForLlm).toBe("(no rows found)");
    expect(result.widget).toBeUndefined();
  });

  test("rejects invalid windows and propagates service failures", async () => {
    const findBy: jest.SpyInstance = jest
      .spyOn(SecurityEventService, "findBy")
      .mockRejectedValue(new Error("boom"));

    await expect(
      SecurityEventSummaryTool.execute(
        {
          startTime: "2026-09-17T12:00:00Z",
          endTime: "2026-09-17T11:00:00Z",
        },
        context(),
      ),
    ).rejects.toThrow("startTime must be before endTime.");
    expect(findBy).not.toHaveBeenCalled();

    await expect(
      SecurityEventSummaryTool.execute({}, context()),
    ).rejects.toThrow("boom");
  });
});

describe("security event tools permission gate", () => {
  const tools: Array<ObservabilityTool> = [
    SearchSecurityEventsTool,
    SecurityEventSummaryTool,
  ];

  test("requiredPermissions mirror the SecurityEvent read ACL and are cached", () => {
    const expected: Array<Permission> =
      new SecurityEvent().getReadPermissions();
    for (const tool of tools) {
      const first: Array<Permission> = tool.requiredPermissions;
      expect(first).toEqual(expected);
      expect(tool.requiredPermissions).toBe(first);
    }
    expect(expected).toContain(Permission.SecurityViewer);
    expect(expected).not.toContain(Permission.TelemetryAdmin);
  });

  test("both tools are registered as read-only", () => {
    expect(AIToolbox.getToolByName("search_security_events")).toBe(
      SearchSecurityEventsTool,
    );
    expect(AIToolbox.getToolByName("security_event_summary")).toBe(
      SecurityEventSummaryTool,
    );
    expect(AIToolbox.isMutationTool("search_security_events")).toBe(false);
    expect(AIToolbox.isMutationTool("security_event_summary")).toBe(false);
  });

  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.SecurityAdmin,
    Permission.SecurityMember,
    Permission.SecurityViewer,
    Permission.ReadSecurityEvent,
  ])("grants the SIEM tools to %s", (permission: Permission) => {
    for (const tool of tools) {
      expect(AIToolbox.hasPermissionForTool(tool, context([permission]))).toBe(
        true,
      );
    }
  });

  test.each([
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.TelemetryAdmin,
    Permission.TelemetryMember,
    Permission.TelemetryViewer,
  ])(
    "does not grant the SIEM tools to %s (telemetry access is not SIEM access)",
    (permission: Permission) => {
      for (const tool of tools) {
        expect(
          AIToolbox.hasPermissionForTool(tool, context([permission])),
        ).toBe(false);
      }
    },
  );

  test("a blocked security permission denies the tools", () => {
    for (const tool of tools) {
      expect(
        AIToolbox.hasPermissionForTool(
          tool,
          context([Permission.ProjectAdmin], [Permission.SecurityViewer]),
        ),
      ).toBe(false);
    }
  });

  test.each(["search_security_events", "security_event_summary"])(
    "%s refuses cross-project, multi-tenant and unauthorized contexts without querying",
    async (name: string) => {
      const findBy: jest.SpyInstance = jest
        .spyOn(SecurityEventService, "findBy")
        .mockResolvedValue([]);
      const ctx: ToolContext = context();

      const outcomes: Array<ToolCallOutcome> = [
        await AIToolbox.executeTool({
          name: name,
          args: {},
          ctx: { ...ctx, projectId: otherProjectId },
        }),
        await AIToolbox.executeTool({
          name: name,
          args: {},
          ctx: {
            ...ctx,
            props: { ...ctx.props, isMultiTenantRequest: true },
          },
        }),
        await AIToolbox.executeTool({
          name: name,
          args: {},
          ctx: context([Permission.TelemetryAdmin]),
        }),
      ];

      for (const outcome of outcomes) {
        expect(outcome.success).toBe(false);
      }
      expect(outcomes[2]!.errorMessage).toBe(
        `Permission denied for tool: ${name}`,
      );
      expect(findBy).not.toHaveBeenCalled();
    },
  );
});
