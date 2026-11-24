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
import Includes from "../../../Types/BaseDatabase/Includes";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import { createTranslator, Translator } from "../../../Types/Translator";
import { ResourceAttentionDialogRead } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttentionDialog";
import {
  SYSTEMD_FAILED_UNITS_LISTED,
  loadSystemdFailedUnits,
  loadSystemdUnitFailure,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/Utils/SystemdUnitFailureDialog";
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
  SYSTEMD_UNIT_NO_REASON_IN_JOURNAL,
  SystemdUnitFailure,
  SystemdUnitJournalLine,
  getSignalName,
  getSystemdFailedUnitItems,
  getSystemdFailureReason,
  getSystemdUnitFailedItem,
  getSystemdUnitFailureItem,
  getSystemdUnitItemKey,
  getSystemdUnitLogsRoute,
  getSystemdUnitOwnLines,
  getSystemdUnitUnexplainedFailureItem,
  isSystemdOwnLine,
  readSystemdUnitFailure,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/Utils/SystemdUnitFailure";
import {
  SYSTEMD_FAILED_UNITS_JOURNAL_READ_LIMIT,
  getSystemdUnitJournalWindow,
  readSystemdFailedUnitsJournal,
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

/*
 * THE SYSTEMD UNITS LIST'S FAILED UNITS OPEN WHY (#9960).
 *
 * The list drew each failed unit's state as a plain "Failed". Its Failed
 * now opens the dialog the unit's page opens, read the same way, with View
 * to the unit's page; and its count of failed units opens all of them at
 * once, from one read of what systemd said of why they failed.
 */

// A unit's line, as the host's logs file it under its unit.
function unitLine(
  unit: string,
  time: string,
  body: string,
  attributes: Record<string, unknown> = {},
): SystemdUnitJournalLine {
  return {
    time: at(time),
    body: body,
    severityText: "INFO",
    attributes: {
      [JOURNALD_SYSTEMD_UNIT_ATTRIBUTE]: unit,
      "syslog.identifier": "systemd",
      "process.pid": "1",
      ...attributes,
    },
  };
}

function failedWith(
  unit: string,
  time: string,
  result: string,
  exit?: { code: string; status: string; name: string },
): Array<SystemdUnitJournalLine> {
  const lines: Array<SystemdUnitJournalLine> = [
    unitLine(unit, time, `${unit}: Failed with result '${result}'.`, {
      [JOURNALD_SYSTEMD_RESULT_ATTRIBUTE]: result,
    }),
  ];

  if (exit) {
    lines.push(
      unitLine(
        unit,
        time,
        `${unit}: Main process exited, code=${exit.code}, status=${exit.status}/${exit.name}`,
        {
          [JOURNALD_SYSTEMD_EXIT_CODE_ATTRIBUTE]: exit.code,
          [JOURNALD_SYSTEMD_EXIT_STATUS_ATTRIBUTE]: exit.status,
        },
      ),
    );
  }

  return lines;
}

const ENGLISH: Translator = createTranslator((): string | undefined => {
  return undefined;
}, "en");

function unitRoute(unit: string): Route {
  return new Route(`/dashboard/p/host/h/systemd-units/${unit}`);
}

const NO_REASON: string =
  "Its journal of the last 7 days does not say why. OneUptime's default collector config sends each journal line with its unit.";

describe("getSystemdUnitFailedItem: one unit's row, from its journal", () => {
  test("why it failed, when its journal says so: on its page the current row, from a list a row of its own with View", () => {
    const onItsPage: ResourceAttentionItem = getSystemdUnitFailedItem({
      unitName: UNIT,
      lines: EXIT_CODE_FAILURE,
      translator: ENGLISH,
    });

    expect(onItsPage).toEqual(
      getSystemdUnitFailureItem({
        unitName: UNIT,
        failure: readSystemdUnitFailure(EXIT_CODE_FAILURE)!,
        lines: EXIT_CODE_FAILURE,
      }),
    );
    expect(onItsPage.key).toBe(SYSTEMD_UNIT_CURRENT.key);
    expect(onItsPage.route).toBeUndefined();

    const fromAList: ResourceAttentionItem = getSystemdUnitFailedItem({
      unitName: UNIT,
      lines: EXIT_CODE_FAILURE,
      translator: ENGLISH,
      key: getSystemdUnitItemKey(UNIT),
      route: unitRoute(UNIT),
    });

    expect(fromAList.key).toBe(`systemd-unit:${UNIT}`);
    expect(fromAList.route?.toString()).toBe(unitRoute(UNIT).toString());
    expect(fromAList.reasons).toEqual(onItsPage.reasons);
  });

  test("Failed, and why its journal may not say, when it does not: with what it printed", () => {
    const printed: Array<SystemdUnitJournalLine> = [
      ownLine("10:00:02", "nginx: [warn] the configuration file is deprecated"),
      systemdLine("10:00:00", "Starting nginx.service...", {}),
    ];

    const item: ResourceAttentionItem = getSystemdUnitFailedItem({
      unitName: UNIT,
      lines: printed,
      translator: ENGLISH,
      key: getSystemdUnitItemKey(UNIT),
      route: unitRoute(UNIT),
    });

    expect(item).toEqual(
      getSystemdUnitUnexplainedFailureItem({
        unitName: UNIT,
        lines: printed,
        translator: ENGLISH,
        key: getSystemdUnitItemKey(UNIT),
        route: unitRoute(UNIT),
      }),
    );
    expect(item.reasons).toEqual([{ text: "Failed" }]);
    expect(item.explanation).toBe(NO_REASON);
    expect(item.facts).toBeUndefined();
    expect(item.since).toBeUndefined();
    // What it printed, never systemd's own lines.
    expect(item.events).toEqual([
      {
        key: `${at("10:00:02").getTime()}-0`,
        reason: "nginx",
        message: "nginx: [warn] the configuration file is deprecated",
        count: 1,
        lastSeenAt: at("10:00:02"),
      },
    ]);
    expect(item.route?.toString()).toBe(unitRoute(UNIT).toString());
  });

  test("the explanation is in the reader's words and digits", () => {
    const persian: Translator = createTranslator(
      (text: string): string | undefined => {
        return text === SYSTEMD_UNIT_NO_REASON_IN_JOURNAL
          ? "ژورنال {{days}} روز گذشته آن نمی‌گوید چرا."
          : undefined;
      },
      "fa",
    );

    expect(
      getSystemdUnitUnexplainedFailureItem({
        unitName: UNIT,
        lines: [],
        translator: persian,
      }).explanation,
    ).toContain("۷");
  });
});

describe("getSystemdFailedUnitItems: the list's failed units, each with why", () => {
  const LINES: Array<SystemdUnitJournalLine> = [
    ...failedWith("backup.service", "09:00:00", "signal", {
      code: "killed",
      status: "9",
      name: "KILL",
    }),
    ...failedWith("nginx.service", "10:00:03", "exit-code", {
      code: "exited",
      status: "1",
      name: "FAILURE",
    }),
    // An earlier failure of nginx: the newest one is why it is failed now.
    ...failedWith("nginx.service", "08:00:00", "timeout"),
    // A unit the list does not hold as failed now: none of its business.
    ...failedWith("api.service", "11:00:00", "exit-code", {
      code: "exited",
      status: "3",
      name: "NOTIMPLEMENTED",
    }),
  ];

  const items: Array<ResourceAttentionItem> = getSystemdFailedUnitItems({
    units: [
      { name: "worker.service", route: unitRoute("worker.service") },
      { name: "nginx.service", route: unitRoute("nginx.service") },
      { name: "backup.service", route: unitRoute("backup.service") },
      { name: "archive.service", route: unitRoute("archive.service") },
    ],
    lines: LINES,
    translator: ENGLISH,
  });

  test("the newest failure first, then the units whose journal does not say why, by name", () => {
    expect(
      items.map((item: ResourceAttentionItem): string => {
        return item.name;
      }),
    ).toEqual([
      "nginx.service",
      "backup.service",
      "archive.service",
      "worker.service",
    ]);
  });

  test("each its own row, why as systemd said it, since when, and View to its page", () => {
    const [nginx, backup, archive] = items as [
      ResourceAttentionItem,
      ResourceAttentionItem,
      ResourceAttentionItem,
    ];

    expect(nginx.key).toBe("systemd-unit:nginx.service");
    expect(nginx.reasons).toEqual([
      { text: "Exited with code {{code}}", values: { code: "1" } },
    ]);
    expect(nginx.since).toEqual({
      at: at("10:00:03"),
      template: "Failed {{time}}",
    });
    // Its own lines were not read: systemd's words say how it ended.
    expect(nginx.message).toBe(
      "nginx.service: Main process exited, code=exited, status=1/FAILURE",
    );
    expect(nginx.route?.toString()).toBe(unitRoute("nginx.service").toString());

    expect(backup.reasons).toEqual([
      { text: "Killed by {{signal}}", values: { signal: "SIGKILL" } },
    ]);
    expect(backup.facts).toEqual([
      { key: "result", label: "Result", value: "signal" },
      { key: "exit-status", label: "Exit status", value: "9/KILL" },
    ]);

    expect(archive.reasons).toEqual([{ text: "Failed" }]);
    expect(archive.explanation).toBe(NO_REASON);
    expect(archive.route?.toString()).toBe(
      unitRoute("archive.service").toString(),
    );
  });

  test("every key is its unit's, so no two rows share one", () => {
    expect(
      new Set(
        items.map((item: ResourceAttentionItem): string => {
          return item.key;
        }),
      ).size,
    ).toBe(items.length);
  });

  test("no unit, no row", () => {
    expect(
      getSystemdFailedUnitItems({
        units: [],
        lines: LINES,
        translator: ENGLISH,
      }),
    ).toEqual([]);
  });
});

interface FailedUnitsLogRequest {
  modelType: { name: string };
  query: {
    projectId: string;
    time: InBetween<Date>;
    attributes: Record<string, unknown>;
  };
  limit: number;
  sort: Record<string, unknown>;
}

function failedUnitsRequests(): Array<FailedUnitsLogRequest> {
  return getListMock.mock.calls.map(
    (args: Array<unknown>): FailedUnitsLogRequest => {
      return args[0] as FailedUnitsLogRequest;
    },
  );
}

describe("readSystemdFailedUnitsJournal: what systemd said of why the list's failed units failed", () => {
  const PROJECT_ID: ObjectID = new ObjectID(
    "10000000-0000-4000-8000-000000000001",
  );

  beforeEach(() => {
    getListMock.mockReset();
    getCurrentProjectIdMock.mockReset();
    getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);
  });

  test("one read of their result lines and one of their exit lines, at once, bounded, newest first", async () => {
    getListMock.mockReturnValue(Promise.resolve({ data: [] }));

    await readSystemdFailedUnitsJournal({
      hostIdentifier: "web-01",
      unitNames: ["backup.service", "nginx.service"],
      window: { startTime: at("09:00:00"), endTime: at("10:00:00") },
    });

    expect(failedUnitsRequests()).toHaveLength(2);

    const [results, exits] = failedUnitsRequests() as [
      FailedUnitsLogRequest,
      FailedUnitsLogRequest,
    ];

    for (const request of [results, exits]) {
      expect(request.modelType.name).toBe("Log");
      expect(request.query.projectId).toBe(PROJECT_ID.toString());
      expect(request.query.time).toEqual(
        new InBetween<Date>(at("09:00:00"), at("10:00:00")),
      );
      expect(request.limit).toBe(SYSTEMD_FAILED_UNITS_JOURNAL_READ_LIMIT);
      expect(request.sort).toEqual({ time: SortOrder.Descending });
      expect(request.query.attributes[HOST_NAME_LOG_ATTRIBUTE]).toBe("web-01");

      // Only these units' lines: another unit's never crowd them out.
      const units: unknown =
        request.query.attributes[JOURNALD_SYSTEMD_UNIT_ATTRIBUTE];
      expect(units).toBeInstanceOf(Includes);
      expect((units as Includes).values).toEqual([
        "backup.service",
        "nginx.service",
      ]);
    }

    expect(
      results.query.attributes[JOURNALD_SYSTEMD_RESULT_ATTRIBUTE],
    ).toBeInstanceOf(NotNull);
    expect(
      results.query.attributes[JOURNALD_SYSTEMD_EXIT_CODE_ATTRIBUTE],
    ).toBeUndefined();
    expect(
      exits.query.attributes[JOURNALD_SYSTEMD_EXIT_CODE_ATTRIBUTE],
    ).toBeInstanceOf(NotNull);
    expect(
      exits.query.attributes[JOURNALD_SYSTEMD_RESULT_ATTRIBUTE],
    ).toBeUndefined();
  });

  test("both reads' lines, each as a journal line", async () => {
    const [result, exit] = failedWith(
      "nginx.service",
      "10:00:03",
      "exit-code",
      { code: "exited", status: "1", name: "FAILURE" },
    ) as [SystemdUnitJournalLine, SystemdUnitJournalLine];

    getListMock.mockImplementation((request: unknown): Promise<unknown> => {
      const attributes: Record<string, unknown> = (
        request as FailedUnitsLogRequest
      ).query.attributes;
      return Promise.resolve({
        data: [attributes[JOURNALD_SYSTEMD_RESULT_ATTRIBUTE] ? result : exit],
      });
    });

    expect(
      await readSystemdFailedUnitsJournal({
        hostIdentifier: "web-01",
        unitNames: ["nginx.service"],
        window: { startTime: at("09:00:00"), endTime: at("11:00:00") },
      }),
    ).toEqual([result, exit]);
  });

  test("no unit: nothing asked", async () => {
    expect(
      await readSystemdFailedUnitsJournal({
        hostIdentifier: "web-01",
        unitNames: [],
        window: { startTime: at("09:00:00"), endTime: at("10:00:00") },
      }),
    ).toEqual([]);
    expect(getListMock).not.toHaveBeenCalled();
  });
});

describe("the dialogs' reads", () => {
  const PROJECT_ID: ObjectID = new ObjectID(
    "10000000-0000-4000-8000-000000000001",
  );

  beforeEach(() => {
    getListMock.mockReset();
    getCurrentProjectIdMock.mockReset();
    getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);
  });

  test("one unit's: its journal of the last days, its row from a list with View", async () => {
    getListMock.mockReturnValue(Promise.resolve({ data: EXIT_CODE_FAILURE }));

    const read: ResourceAttentionDialogRead = await loadSystemdUnitFailure({
      hostIdentifier: "web-01",
      unitName: UNIT,
      translator: ENGLISH,
      unitRoute: unitRoute(UNIT),
      now: at("12:00:00"),
    });

    const [request] = failedUnitsRequests() as [FailedUnitsLogRequest];

    expect(request.query.attributes).toEqual({
      [HOST_NAME_LOG_ATTRIBUTE]: "web-01",
      [JOURNALD_SYSTEMD_UNIT_ATTRIBUTE]: UNIT,
    });
    expect(request.query.time).toEqual(
      new InBetween<Date>(
        getSystemdUnitJournalWindow(at("12:00:00")).startTime,
        at("12:00:00"),
      ),
    );
    expect(read.items).toHaveLength(1);
    expect(read.items[0]!.key).toBe(getSystemdUnitItemKey(UNIT));
    expect(read.items[0]!.route?.toString()).toBe(unitRoute(UNIT).toString());
    expect(read.items[0]!.reasons).toEqual([
      { text: "Exited with code {{code}}", values: { code: "1" } },
    ]);
  });

  test("one unit's on its own page: the current row, no View", async () => {
    getListMock.mockReturnValue(Promise.resolve({ data: EXIT_CODE_FAILURE }));

    const read: ResourceAttentionDialogRead = await loadSystemdUnitFailure({
      hostIdentifier: "web-01",
      unitName: UNIT,
      translator: ENGLISH,
    });

    expect(read.items[0]!.key).toBe(SYSTEMD_UNIT_CURRENT.key);
    expect(read.items[0]!.route).toBeUndefined();
  });

  test("the list's failed units: at most the first by name, and says when there are more", async () => {
    getListMock.mockReturnValue(Promise.resolve({ data: [] }));

    const units: Array<{ name: string }> = [];
    for (let index: number = SYSTEMD_FAILED_UNITS_LISTED; index >= 0; index--) {
      units.push({ name: `unit-${String(index).padStart(3, "0")}.service` });
    }

    const read: ResourceAttentionDialogRead = await loadSystemdFailedUnits({
      hostIdentifier: "web-01",
      units: units,
      translator: ENGLISH,
    });

    expect(units).toHaveLength(SYSTEMD_FAILED_UNITS_LISTED + 1);
    expect(read.items).toHaveLength(SYSTEMD_FAILED_UNITS_LISTED);
    expect(read.isTruncated).toBe(true);

    const [request] = failedUnitsRequests() as [FailedUnitsLogRequest];
    const asked: Includes = request.query.attributes[
      JOURNALD_SYSTEMD_UNIT_ATTRIBUTE
    ] as Includes;

    expect(asked.values).toHaveLength(SYSTEMD_FAILED_UNITS_LISTED);
    expect(asked.values[0]).toBe("unit-000.service");
    // The last by name is the one left out.
    expect(asked.values).not.toContain(
      `unit-${String(SYSTEMD_FAILED_UNITS_LISTED).padStart(3, "0")}.service`,
    );
  });

  test("the list's failed units, few enough: every one, nothing cut", async () => {
    getListMock.mockReturnValue(
      Promise.resolve({
        data: failedWith("nginx.service", "10:00:03", "exit-code", {
          code: "exited",
          status: "1",
          name: "FAILURE",
        }),
      }),
    );

    const read: ResourceAttentionDialogRead = await loadSystemdFailedUnits({
      hostIdentifier: "web-01",
      units: [
        { name: "nginx.service", route: unitRoute("nginx.service") },
        { name: "worker.service", route: unitRoute("worker.service") },
      ],
      translator: ENGLISH,
    });

    expect(read.isTruncated).toBe(false);
    expect(
      read.items.map((item: ResourceAttentionItem): string => {
        return item.name;
      }),
    ).toEqual(["nginx.service", "worker.service"]);
  });
});
