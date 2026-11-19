import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * WHY A SYSTEMD UNIT FAILED, READ FROM ITS JOURNAL (#9748).
 *
 * A host's unit page said "Failed" and nothing else. The host collector's
 * default config now files each journal line under its unit, with
 * systemd's own result and exit status on systemd's lines about it
 * (HostCollectorDefaultConfig.test.ts); these helpers read them back:
 * which result, how the process ended, when, what the unit printed last,
 * and the unit's lines in the host's Logs.
 */

const getListMock: MockFunction = getJestMockFunction();
const getCurrentProjectIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        return getCurrentProjectIdMock();
      },
    },
  };
});

import Route from "../../../Types/API/Route";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import {
  JOURNALD_SYSTEMD_EXIT_CODE_ATTRIBUTE,
  JOURNALD_SYSTEMD_EXIT_STATUS_ATTRIBUTE,
  JOURNALD_SYSTEMD_RESULT_ATTRIBUTE,
  JOURNALD_SYSTEMD_UNIT_ATTRIBUTE,
} from "../../../Utils/HostCollector/HostCollectorDefaultConfig";
import {
  ResourceAttentionItem,
  ResourceAttentionSeverity,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttention";
import {
  HOST_NAME_LOG_ATTRIBUTE,
  SYSTEMD_UNIT_CURRENT,
  SYSTEMD_UNIT_JOURNAL_READ_LIMIT,
  SYSTEMD_UNIT_JOURNAL_WINDOW_DAYS,
  SystemdUnitFailure,
  SystemdUnitJournalLine,
  getSignalName,
  getSystemdFailureReason,
  getSystemdUnitFailureItem,
  getSystemdUnitLogsRoute,
  getSystemdUnitOwnLines,
  isSystemdOwnLine,
  readSystemdUnitFailure,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/Utils/SystemdUnitFailure";
import {
  getSystemdUnitJournalWindow,
  readSystemdUnitJournal,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/Utils/SystemdUnitJournal";

const UNIT: string = "nginx.service";

function at(time: string): Date {
  return new Date(`2026-11-19T${time}.000Z`);
}

// What systemd (PID 1) writes about the unit.
function systemdLine(
  time: string,
  body: string,
  attributes: Record<string, unknown>,
): SystemdUnitJournalLine {
  return {
    time: at(time),
    body: body,
    severityText: "INFO",
    attributes: {
      [JOURNALD_SYSTEMD_UNIT_ATTRIBUTE]: UNIT,
      "syslog.identifier": "systemd",
      "process.pid": "1",
      ...attributes,
    },
  };
}

// What the unit itself prints.
function ownLine(time: string, body: string): SystemdUnitJournalLine {
  return {
    time: at(time),
    body: body,
    severityText: "ERROR",
    attributes: {
      [JOURNALD_SYSTEMD_UNIT_ATTRIBUTE]: UNIT,
      "syslog.identifier": "nginx",
      "process.pid": "4242",
    },
  };
}

function exitLine(
  time: string,
  code: string,
  status: string,
  statusName: string,
): SystemdUnitJournalLine {
  return systemdLine(
    time,
    `${UNIT}: Main process exited, code=${code}, status=${status}/${statusName}`,
    {
      [JOURNALD_SYSTEMD_EXIT_CODE_ATTRIBUTE]: code,
      [JOURNALD_SYSTEMD_EXIT_STATUS_ATTRIBUTE]: status,
    },
  );
}

function resultLine(time: string, result: string): SystemdUnitJournalLine {
  return systemdLine(time, `${UNIT}: Failed with result '${result}'.`, {
    [JOURNALD_SYSTEMD_RESULT_ATTRIBUTE]: result,
  });
}

// nginx could not bind its port at 10:00:02 and systemd failed it.
const EXIT_CODE_FAILURE: Array<SystemdUnitJournalLine> = [
  resultLine("10:00:03", "exit-code"),
  exitLine("10:00:03", "exited", "1", "FAILURE"),
  ownLine(
    "10:00:02",
    "nginx: [emerg] bind() to 0.0.0.0:80 failed (98: Address already in use)",
  ),
  ownLine("10:00:01", "nginx: [warn] the configuration file is deprecated"),
  systemdLine(
    "10:00:00",
    "Starting nginx.service - A high performance web server...",
    {},
  ),
];

describe("readSystemdUnitFailure: the unit's newest failure, as systemd said it", () => {
  test("its result, when, and how its process ended just before", () => {
    const failure: SystemdUnitFailure | null =
      readSystemdUnitFailure(EXIT_CODE_FAILURE);

    expect(failure).toEqual({
      result: "exit-code",
      failedAt: at("10:00:03"),
      message: "nginx.service: Failed with result 'exit-code'.",
      exit: {
        code: "exited",
        status: "1",
        statusName: "FAILURE",
        at: at("10:00:03"),
        message:
          "nginx.service: Main process exited, code=exited, status=1/FAILURE",
      },
    });
  });

  test("lines in any order: the newest failure wins, with its own exit", () => {
    const lines: Array<SystemdUnitJournalLine> = [
      exitLine("08:00:00", "exited", "2", "INVALIDARGUMENT"),
      resultLine("08:00:00", "exit-code"),
      resultLine("09:30:05", "signal"),
      exitLine("09:30:04", "killed", "9", "KILL"),
    ];

    const failure: SystemdUnitFailure | null = readSystemdUnitFailure(lines);

    expect(failure?.result).toBe("signal");
    expect(failure?.failedAt).toEqual(at("09:30:05"));
    expect(failure?.exit?.code).toBe("killed");
    expect(failure?.exit?.statusName).toBe("KILL");
  });

  test("an exit long before the failure, or after it, is not the one that failed it", () => {
    const tooEarly: SystemdUnitFailure | null = readSystemdUnitFailure([
      resultLine("10:30:00", "timeout"),
      exitLine("10:15:00", "exited", "0", "SUCCESS"),
    ]);
    const after: SystemdUnitFailure | null = readSystemdUnitFailure([
      exitLine("10:31:00", "exited", "0", "SUCCESS"),
      resultLine("10:30:00", "timeout"),
    ]);

    expect(tooEarly?.result).toBe("timeout");
    expect(tooEarly?.exit).toBeUndefined();
    expect(after?.exit).toBeUndefined();
  });

  test("a stop timeout's kill, minutes before its result, still is", () => {
    const failure: SystemdUnitFailure | null = readSystemdUnitFailure([
      resultLine("10:31:30", "timeout"),
      exitLine("10:30:00", "killed", "9", "KILL"),
    ]);

    expect(failure?.exit?.status).toBe("9");
  });

  test("none when its journal holds no failure: never failed, or success", () => {
    expect(readSystemdUnitFailure([])).toBeNull();
    expect(
      readSystemdUnitFailure([
        ownLine("10:00:00", "nginx: started"),
        resultLine("10:01:00", "success"),
        exitLine("10:01:00", "exited", "0", "SUCCESS"),
      ]),
    ).toBeNull();
  });

  test("an exit status systemd gave no name keeps its number alone", () => {
    const failure: SystemdUnitFailure | null = readSystemdUnitFailure([
      resultLine("10:00:01", "exit-code"),
      systemdLine(
        "10:00:00",
        `${UNIT}: Main process exited, code=exited, status=203`,
        {
          [JOURNALD_SYSTEMD_EXIT_CODE_ATTRIBUTE]: "exited",
          [JOURNALD_SYSTEMD_EXIT_STATUS_ATTRIBUTE]: 203,
        },
      ),
    ]);

    expect(failure?.exit?.status).toBe("203");
    expect(failure?.exit?.statusName).toBe("");
  });
});

describe("isSystemdOwnLine: what systemd said, not what the unit printed", () => {
  test("PID 1's lines and those systemd signs are systemd's", () => {
    expect(isSystemdOwnLine(resultLine("10:00:00", "exit-code"))).toBe(true);
    expect(
      isSystemdOwnLine({
        time: at("10:00:00"),
        body: "x",
        attributes: { "syslog.identifier": "systemd" },
      }),
    ).toBe(true);
    expect(isSystemdOwnLine(ownLine("10:00:00", "nginx: up"))).toBe(false);
  });
});

describe("getSignalName: a signal by the name people know it by", () => {
  test("systemd's KILL is SIGKILL; a SIG name stays; no name is its number", () => {
    const exit: (statusName: string) => string = (
      statusName: string,
    ): string => {
      return getSignalName({
        code: "killed",
        status: "9",
        statusName: statusName,
        at: at("10:00:00"),
        message: "",
      });
    };

    expect(exit("KILL")).toBe("SIGKILL");
    expect(exit("SIGTERM")).toBe("SIGTERM");
    expect(exit("")).toBe("9");
    // Not a signal's name: its number.
    expect(exit("not<b>")).toBe("9");
  });
});

describe("getSystemdFailureReason: why it failed, in one chip", () => {
  function failure(
    result: string,
    exit?: { code: string; status: string; statusName: string },
  ): SystemdUnitFailure {
    return {
      result: result,
      failedAt: at("10:00:00"),
      message: "",
      exit: exit ? { ...exit, at: at("10:00:00"), message: "" } : undefined,
    };
  }

  test("an exit code, the signal that killed it, the signal it crashed on", () => {
    expect(
      getSystemdFailureReason(
        failure("exit-code", {
          code: "exited",
          status: "1",
          statusName: "FAILURE",
        }),
      ),
    ).toEqual({ text: "Exited with code {{code}}", values: { code: "1" } });
    expect(
      getSystemdFailureReason(
        failure("signal", { code: "killed", status: "9", statusName: "KILL" }),
      ),
    ).toEqual({ text: "Killed by {{signal}}", values: { signal: "SIGKILL" } });
    expect(
      getSystemdFailureReason(
        failure("core-dump", {
          code: "dumped",
          status: "11",
          statusName: "SEGV",
        }),
      ),
    ).toEqual({ text: "Crashed on {{signal}}", values: { signal: "SIGSEGV" } });
  });

  test("else what its result means, in OneUptime's words", () => {
    expect(getSystemdFailureReason(failure("exit-code"))).toEqual({
      text: "Exited with an error",
    });
    expect(getSystemdFailureReason(failure("timeout"))).toEqual({
      text: "Timed out",
    });
    expect(getSystemdFailureReason(failure("start-limit-hit"))).toEqual({
      text: "Restarted too often",
    });
    expect(getSystemdFailureReason(failure("oom-kill"))).toEqual({
      text: "Ran out of memory",
    });
    expect(getSystemdFailureReason(failure("watchdog"))).toEqual({
      text: "Stopped answering its watchdog",
    });
    // A process that ended otherwise than its result says is not quoted.
    expect(
      getSystemdFailureReason(
        failure("exit-code", {
          code: "killed",
          status: "9",
          statusName: "KILL",
        }),
      ),
    ).toEqual({ text: "Exited with an error" });
  });

  test("else its result as systemd wrote it", () => {
    expect(getSystemdFailureReason(failure("exec-condition"))).toEqual({
      text: "Failed with result {{result}}",
      values: { result: "exec-condition" },
    });
  });
});

describe("getSystemdUnitOwnLines: what the unit printed", () => {
  test("newest first, never systemd's, never an empty line, up to a time", () => {
    const lines: Array<SystemdUnitJournalLine> = getSystemdUnitOwnLines({
      lines: [
        ...EXIT_CODE_FAILURE,
        ownLine("10:05:00", ""),
        ownLine("10:06:00", "later"),
      ],
      until: at("10:00:03"),
    });

    expect(
      lines.map((line: SystemdUnitJournalLine): string => {
        return line.body;
      }),
    ).toEqual([
      "nginx: [emerg] bind() to 0.0.0.0:80 failed (98: Address already in use)",
      "nginx: [warn] the configuration file is deprecated",
    ]);
  });
});

describe("getSystemdUnitFailureItem: the unit, as the dialog behind Failed lists it", () => {
  test("why, systemd's result and exit status as written, what it printed last, since when, and before that", () => {
    const item: ResourceAttentionItem = getSystemdUnitFailureItem({
      unitName: UNIT,
      failure: readSystemdUnitFailure(EXIT_CODE_FAILURE)!,
      lines: EXIT_CODE_FAILURE,
    });

    expect(item.key).toBe(SYSTEMD_UNIT_CURRENT.key);
    expect(item.name).toBe(UNIT);
    expect(item.severity).toBe(ResourceAttentionSeverity.Critical);
    expect(item.reasons).toEqual([
      { text: "Exited with code {{code}}", values: { code: "1" } },
    ]);
    expect(item.facts).toEqual([
      { key: "result", label: "Result", value: "exit-code" },
      { key: "exit-status", label: "Exit status", value: "1/FAILURE" },
    ]);
    expect(item.message).toBe(
      "nginx: [emerg] bind() to 0.0.0.0:80 failed (98: Address already in use)",
    );
    expect(item.since).toEqual({
      at: at("10:00:03"),
      template: "Failed {{time}}",
    });
    expect(item.events).toEqual([
      {
        key: `${at("10:00:01").getTime()}-0`,
        reason: "nginx",
        message: "nginx: [warn] the configuration file is deprecated",
        count: 1,
        lastSeenAt: at("10:00:01"),
      },
    ]);
  });

  test("a unit that printed nothing: systemd's own words, and no exit status it never gave", () => {
    const lines: Array<SystemdUnitJournalLine> = [
      resultLine("10:00:00", "timeout"),
    ];
    const item: ResourceAttentionItem = getSystemdUnitFailureItem({
      unitName: UNIT,
      failure: readSystemdUnitFailure(lines)!,
      lines: lines,
    });

    expect(item.reasons).toEqual([{ text: "Timed out" }]);
    expect(item.facts).toEqual([
      { key: "result", label: "Result", value: "timeout" },
    ]);
    expect(item.message).toBe("nginx.service: Failed with result 'timeout'.");
    expect(item.events).toEqual([]);
  });
});

describe("getSystemdUnitLogsRoute: the unit's lines in the host's Logs", () => {
  test("the explorer's own chip for the unit, over the window read", () => {
    const route: Route = getSystemdUnitLogsRoute({
      hostLogsRoute: new Route("/dashboard/p1/hosts/h1/logs"),
      unitName: UNIT,
      startTime: at("09:00:00"),
      endTime: at("10:00:00"),
    });
    const [path, query] = route.toString().split("?") as [string, string];
    const params: URLSearchParams = new URLSearchParams(query);

    expect(path).toBe("/dashboard/p1/hosts/h1/logs");
    expect(JSON.parse(params.get("filters")!)).toEqual([
      [`attributes.${JOURNALD_SYSTEMD_UNIT_ATTRIBUTE}`, [UNIT]],
    ]);
    expect(params.get("range")).toBe("Custom");
    expect(new Date(params.get("start")!).toISOString()).toBe(
      at("09:00:00").toISOString(),
    );
    expect(new Date(params.get("end")!).toISOString()).toBe(
      at("10:00:00").toISOString(),
    );
  });
});

describe("readSystemdUnitJournal: the unit's newest lines, from the host's logs", () => {
  const PROJECT_ID: ObjectID = new ObjectID(
    "10000000-0000-4000-8000-000000000001",
  );

  beforeEach(() => {
    getListMock.mockReset();
    getCurrentProjectIdMock.mockReset();
    getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);
  });

  test("the window is the last days the page reads", () => {
    expect(getSystemdUnitJournalWindow(at("12:00:00"))).toEqual({
      startTime: new Date(
        at("12:00:00").getTime() -
          SYSTEMD_UNIT_JOURNAL_WINDOW_DAYS * 24 * 60 * 60 * 1000,
      ),
      endTime: at("12:00:00"),
    });
  });

  test("asks for this host's lines filed under this unit, newest first, a page of them", async () => {
    getListMock.mockReturnValue(Promise.resolve({ data: [] }));

    await readSystemdUnitJournal({
      hostIdentifier: "web-01",
      unitName: UNIT,
      window: { startTime: at("09:00:00"), endTime: at("10:00:00") },
    });

    const request: {
      modelType: { name: string };
      query: Record<string, unknown>;
      limit: number;
      sort: Record<string, unknown>;
    } = getListMock.mock.calls[0]![0] as never;

    expect(request.modelType.name).toBe("Log");
    expect(request.query["projectId"]).toBe(PROJECT_ID.toString());
    expect(request.query["attributes"]).toEqual({
      [HOST_NAME_LOG_ATTRIBUTE]: "web-01",
      [JOURNALD_SYSTEMD_UNIT_ATTRIBUTE]: UNIT,
    });
    expect(request.query["time"]).toEqual(
      new InBetween<Date>(at("09:00:00"), at("10:00:00")),
    );
    expect(request.limit).toBe(SYSTEMD_UNIT_JOURNAL_READ_LIMIT);
    expect(request.sort).toEqual({ time: SortOrder.Descending });
  });

  test("each line its time, text, level and attributes; one with no time is left out", async () => {
    getListMock.mockReturnValue(
      Promise.resolve({
        data: [
          {
            time: "2026-11-19T10:00:03.000Z",
            body: "nginx.service: Failed with result 'exit-code'.",
            severityText: "WARN",
            attributes: { [JOURNALD_SYSTEMD_RESULT_ATTRIBUTE]: "exit-code" },
          },
          { time: at("10:00:02"), body: { not: "text" } },
          { time: "not a time", body: "dropped" },
        ],
      }),
    );

    expect(
      await readSystemdUnitJournal({
        hostIdentifier: "web-01",
        unitName: UNIT,
        window: { startTime: at("09:00:00"), endTime: at("11:00:00") },
      }),
    ).toEqual([
      {
        time: at("10:00:03"),
        body: "nginx.service: Failed with result 'exit-code'.",
        severityText: "WARN",
        attributes: { [JOURNALD_SYSTEMD_RESULT_ATTRIBUTE]: "exit-code" },
      },
      {
        time: at("10:00:02"),
        body: "",
        severityText: undefined,
        attributes: {},
      },
    ]);
  });

  test("no project: nothing asked, nothing read", async () => {
    getCurrentProjectIdMock.mockReturnValue(null);

    expect(
      await readSystemdUnitJournal({
        hostIdentifier: "web-01",
        unitName: UNIT,
        window: { startTime: at("09:00:00"), endTime: at("10:00:00") },
      }),
    ).toEqual([]);
    expect(getListMock).not.toHaveBeenCalled();
  });
});
