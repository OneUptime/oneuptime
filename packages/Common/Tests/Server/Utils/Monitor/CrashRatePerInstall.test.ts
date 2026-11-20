import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import ExceptionMonitorMeasureReader, {
  ExceptionMonitorMeasures,
} from "../../../../Server/Utils/Monitor/ExceptionMonitorMeasures";
import ExceptionMonitorCriteria from "../../../../Server/Utils/Monitor/Criteria/ExceptionMonitorCriteria";
import MonitorCriteriaObservationBuilder from "../../../../Server/Utils/Monitor/MonitorCriteriaObservationBuilder";
import ExceptionInstanceService from "../../../../Server/Services/ExceptionInstanceService";
import SpanService from "../../../../Server/Services/SpanService";
import ModelPermission from "../../../../Server/Types/AnalyticsDatabase/ModelPermission";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import Includes from "../../../../Types/BaseDatabase/Includes";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import ExceptionMonitorResponse from "../../../../Types/Monitor/ExceptionMonitor/ExceptionMonitorResponse";
import MonitorCriteria from "../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorStepExceptionMonitor, {
  MonitorStepExceptionMonitorUtil,
} from "../../../../Types/Monitor/MonitorStepExceptionMonitor";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import {
  STORED_APP_INSTALL_ATTRIBUTES,
  STORED_APP_INSTALL_SQL,
  STORED_APP_INSTALLATION_ID_ATTRIBUTE,
  STORED_DEVICE_ID_ATTRIBUTE,
  readStoredAppInstall,
  withAppInstallationId,
} from "../../../../Types/Rum/MobileAppTelemetry";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";

/*
 * #9924: a mobile app's crash rate per install, beside its rate per session.
 *
 * An install is what the SDK names on its resource: OpenTelemetry Android's
 * app.installation.id, else the device.id opentelemetry-swift's releases set
 * (identifierForVendor). Installs With Exceptions (in %) is the share of the
 * window's installs a matching exception happened on - over a day, the
 * user-perceived crash rate Android vitals judges - and Installs how many
 * there were, the fewest a share is judged on.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const APP_ID: ObjectID = ObjectID.generate();
const UNTIL: Date = new Date("2026-11-20T12:00:00.000Z");
const DAY_SECONDS: number = 86400;

const ANDROID_INSTALL: string = "1b4e28ba-2fa1-11d2-883f-0016d3cca427";
const ANDROID_REINSTALL: string = "9c858901-8a57-4791-81fe-4c455b099bc9";
const IPHONE_VENDOR_ID: string = "E621E1F8-C36C-495A-93FC-0C247A3E6E5F";
const IPHONE_NEW_VENDOR_ID: string = "5B1F6D2E-0D5A-4A7B-9E3C-2F8B6A1D4C70";

// The distinct installs of rows, as ClickHouse counts them.
function countInstalls(rows: Array<Record<string, unknown>>): number {
  const installs: Set<string> = new Set<string>();

  for (const row of rows) {
    const install: string = readStoredAppInstall(row);

    if (install) {
      installs.add(install);
    }
  }

  return installs.size;
}

describe("what an install is", () => {
  test("the resource's app.installation.id, else its device.id, else none", () => {
    expect(STORED_APP_INSTALL_ATTRIBUTES).toEqual([
      "resource.app.installation.id",
      "resource.device.id",
    ]);
    expect(
      readStoredAppInstall({
        [STORED_APP_INSTALLATION_ID_ATTRIBUTE]: ANDROID_INSTALL,
      }),
    ).toBe(ANDROID_INSTALL);
    // opentelemetry-swift 2.x: identifierForVendor as device.id alone.
    expect(
      readStoredAppInstall({ [STORED_DEVICE_ID_ATTRIBUTE]: IPHONE_VENDOR_ID }),
    ).toBe(IPHONE_VENDOR_ID);
    // opentelemetry-swift 3.0 sets both, to the same value.
    expect(
      readStoredAppInstall({
        [STORED_APP_INSTALLATION_ID_ATTRIBUTE]: IPHONE_VENDOR_ID,
        [STORED_DEVICE_ID_ATTRIBUTE]: IPHONE_VENDOR_ID,
      }),
    ).toBe(IPHONE_VENDOR_ID);
    // The installation id wins over any other device id.
    expect(
      readStoredAppInstall({
        [STORED_APP_INSTALLATION_ID_ATTRIBUTE]: ANDROID_INSTALL,
        [STORED_DEVICE_ID_ATTRIBUTE]: "serial-123",
      }),
    ).toBe(ANDROID_INSTALL);
  });

  test("a row that names neither is no install", () => {
    expect(readStoredAppInstall({})).toBe("");
    expect(readStoredAppInstall(undefined)).toBe("");
    expect(readStoredAppInstall(null)).toBe("");
    expect(
      readStoredAppInstall({
        [STORED_APP_INSTALLATION_ID_ATTRIBUTE]: "",
        [STORED_DEVICE_ID_ATTRIBUTE]: "",
      }),
    ).toBe("");
    // An empty installation id falls through to the device id.
    expect(
      readStoredAppInstall({
        [STORED_APP_INSTALLATION_ID_ATTRIBUTE]: "",
        [STORED_DEVICE_ID_ATTRIBUTE]: IPHONE_VENDOR_ID,
      }),
    ).toBe(IPHONE_VENDOR_ID);
    expect(
      readStoredAppInstall({
        [STORED_APP_INSTALLATION_ID_ATTRIBUTE]: 42,
        [STORED_DEVICE_ID_ATTRIBUTE]: true,
      }),
    ).toBe("");
  });

  test("ClickHouse reads it the same way, from constant keys", () => {
    expect(STORED_APP_INSTALL_SQL).toBe(
      "if(attributes['resource.app.installation.id'] != '', attributes['resource.app.installation.id'], attributes['resource.device.id'])",
    );
  });

  test("an Android reinstall is a new install: a new app.installation.id", () => {
    expect(
      countInstalls([
        { [STORED_APP_INSTALLATION_ID_ATTRIBUTE]: ANDROID_INSTALL },
        { [STORED_APP_INSTALLATION_ID_ATTRIBUTE]: ANDROID_INSTALL },
        { [STORED_APP_INSTALLATION_ID_ATTRIBUTE]: ANDROID_REINSTALL },
      ]),
    ).toBe(2);
  });

  test("an iOS reinstall is the same install while another of the vendor's apps stays, a new one after the last went", () => {
    // identifierForVendor survives while the vendor keeps an app installed.
    expect(
      countInstalls([
        { [STORED_DEVICE_ID_ATTRIBUTE]: IPHONE_VENDOR_ID },
        { [STORED_DEVICE_ID_ATTRIBUTE]: IPHONE_VENDOR_ID },
      ]),
    ).toBe(1);
    // ...and is reset once every app of the vendor was removed.
    expect(
      countInstalls([
        { [STORED_DEVICE_ID_ATTRIBUTE]: IPHONE_VENDOR_ID },
        { [STORED_DEVICE_ID_ATTRIBUTE]: IPHONE_NEW_VENDOR_ID },
      ]),
    ).toBe(2);
  });

  test("an app moving from opentelemetry-swift 2.x to 3.0 keeps its installs", () => {
    expect(
      countInstalls([
        { [STORED_DEVICE_ID_ATTRIBUTE]: IPHONE_VENDOR_ID },
        {
          [STORED_APP_INSTALLATION_ID_ATTRIBUTE]: IPHONE_VENDOR_ID,
          [STORED_DEVICE_ID_ATTRIBUTE]: IPHONE_VENDOR_ID,
        },
      ]),
    ).toBe(1);
  });

  test("a mixed fleet counts its Android and its iOS installs, and none for rows that name none", () => {
    expect(
      countInstalls([
        { [STORED_APP_INSTALLATION_ID_ATTRIBUTE]: ANDROID_INSTALL },
        { [STORED_DEVICE_ID_ATTRIBUTE]: IPHONE_VENDOR_ID },
        {},
        { "resource.os.name": "iOS" },
      ]),
    ).toBe(2);
  });
});

describe("a crash's occurrence keeps its install", () => {
  test("both attributes are copied from the span or log, each that it names", () => {
    expect(
      withAppInstallationId({
        attributes: { "exception.source": "log" },
        from: {
          [STORED_DEVICE_ID_ATTRIBUTE]: IPHONE_VENDOR_ID,
          "resource.os.name": "iOS",
        },
      }),
    ).toEqual({
      "exception.source": "log",
      [STORED_DEVICE_ID_ATTRIBUTE]: IPHONE_VENDOR_ID,
    });
    expect(
      withAppInstallationId({
        attributes: {},
        from: {
          [STORED_APP_INSTALLATION_ID_ATTRIBUTE]: ANDROID_INSTALL,
          [STORED_DEVICE_ID_ATTRIBUTE]: "serial-123",
        },
      }),
    ).toEqual({
      [STORED_APP_INSTALLATION_ID_ATTRIBUTE]: ANDROID_INSTALL,
      [STORED_DEVICE_ID_ATTRIBUTE]: "serial-123",
    });
  });

  test("the row's own values win, empty ones are not copied, and the input is never changed", () => {
    const attributes: Record<string, string> = {
      [STORED_DEVICE_ID_ATTRIBUTE]: "own",
    };
    const result: Record<string, string> = withAppInstallationId({
      attributes,
      from: {
        [STORED_APP_INSTALLATION_ID_ATTRIBUTE]: "",
        [STORED_DEVICE_ID_ATTRIBUTE]: IPHONE_VENDOR_ID,
      },
    });

    expect(result).toEqual({ [STORED_DEVICE_ID_ATTRIBUTE]: "own" });
    expect(result).toBe(attributes);

    const copied: Record<string, string> = withAppInstallationId({
      attributes,
      from: { [STORED_APP_INSTALLATION_ID_ATTRIBUTE]: ANDROID_INSTALL },
    });

    expect(copied).not.toBe(attributes);
    expect(attributes).toEqual({ [STORED_DEVICE_ID_ATTRIBUTE]: "own" });
    expect(
      withAppInstallationId({ attributes: { a: "b" }, from: undefined }),
    ).toEqual({ a: "b" });
  });
});

function stepWith(checkOns: Array<CheckOn>): MonitorStep {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = {
    ...instance.data!,
    filters: checkOns.map((checkOn: CheckOn): CriteriaFilter => {
      return { checkOn, filterType: FilterType.GreaterThan, value: 1 };
    }),
  };
  const criteria: MonitorCriteria = new MonitorCriteria();
  criteria.data = { monitorCriteriaInstanceArray: [instance] };

  const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
    monitorType: MonitorType.Exceptions,
    monitorName: "Storefront",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
  });
  step.data!.monitorCriteria = criteria;

  return step;
}

function config(
  overrides: Partial<MonitorStepExceptionMonitor> = {},
): MonitorStepExceptionMonitor {
  return {
    ...MonitorStepExceptionMonitorUtil.getDefault(),
    telemetryServiceIds: [APP_ID],
    unhandledOnly: true,
    excludedExceptionTypes: ["ANR", "Hang"],
    lastXSecondsOfExceptions: DAY_SECONDS,
    ...overrides,
  };
}

interface DistinctRead {
  query: Record<string, unknown>;
  expression: string;
}

describe("the installs a share is taken of", () => {
  let spanReads: Array<DistinctRead>;
  let exceptionReads: Array<DistinctRead>;
  let sessionReads: number;
  let spanInstalls: number;
  let exceptionInstalls: number;

  beforeEach(() => {
    spanReads = [];
    exceptionReads = [];
    sessionReads = 0;
    spanInstalls = 400;
    exceptionInstalls = 6;

    jest.spyOn(SpanService, "countDistinctNonEmpty").mockImplementation((async (
      args: DistinctRead,
    ) => {
      spanReads.push({ query: args.query, expression: args.expression });
      return spanInstalls;
    }) as never);
    jest
      .spyOn(ExceptionInstanceService, "countDistinctNonEmpty")
      .mockImplementation((async (args: DistinctRead) => {
        exceptionReads.push({
          query: args.query,
          expression: args.expression,
        });
        return exceptionInstalls;
      }) as never);
    jest.spyOn(SpanService, "countBy").mockImplementation((async () => {
      sessionReads++;
      return new PositiveNumber(900);
    }) as never);
    jest
      .spyOn(ExceptionInstanceService, "countBy")
      .mockImplementation((async () => {
        sessionReads++;
        return new PositiveNumber(9);
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const read: (
    checkOns: Array<CheckOn>,
    overrides?: Partial<MonitorStepExceptionMonitor>,
  ) => Promise<ExceptionMonitorMeasures> = async (
    checkOns: Array<CheckOn>,
    overrides: Partial<MonitorStepExceptionMonitor> = {},
  ): Promise<ExceptionMonitorMeasures> => {
    return await ExceptionMonitorMeasureReader.read({
      projectId: PROJECT_ID,
      monitorStep: stepWith(checkOns),
      config: config(overrides),
      countQuery: {
        projectId: PROJECT_ID,
        escaped: true,
        time: new InBetween(
          new Date(UNTIL.getTime() - DAY_SECONDS * 1000),
          UNTIL,
        ),
      },
      exceptionCount: 12,
      evaluateUntil: UNTIL,
    });
  };

  test("the share: installs with a matching exception over the window's installs", async () => {
    expect(await read([CheckOn.InstallsWithExceptionsPercent])).toEqual({
      installCount: 400,
      installsWithExceptionsCount: 6,
      installsWithExceptionsPercent: 1.5,
    });
  });

  test("the installs alone read the same two counts, and no session", async () => {
    expect(await read([CheckOn.InstallCount])).toEqual({
      installCount: 400,
      installsWithExceptionsCount: 6,
      installsWithExceptionsPercent: 1.5,
    });
    expect(sessionReads).toBe(0);
  });

  test("a plain count, or a share of sessions, reads no install", async () => {
    await read([CheckOn.ExceptionCount]);
    await read([CheckOn.SessionsWithExceptionsPercent]);

    expect(spanReads).toHaveLength(0);
    expect(exceptionReads).toHaveLength(0);
  });

  test("a rule on both shares reads both, each once", async () => {
    const measures: ExceptionMonitorMeasures = await read([
      CheckOn.SessionsWithExceptionsPercent,
      CheckOn.InstallsWithExceptionsPercent,
    ]);

    expect(spanReads).toHaveLength(1);
    expect(exceptionReads).toHaveLength(1);
    expect(sessionReads).toBe(2);
    expect(measures.installsWithExceptionsPercent).toBe(1.5);
    expect(measures.sessionsWithExceptionsPercent).toBe(1);
  });

  test("the window's installs are the distinct install of the app's spans over the monitor's whole window", async () => {
    await read([CheckOn.InstallsWithExceptionsPercent]);

    expect(spanReads).toHaveLength(1);
    expect(spanReads[0]!.expression).toBe(STORED_APP_INSTALL_SQL);
    expect(spanReads[0]!.query["projectId"]).toBe(PROJECT_ID);
    expect(spanReads[0]!.query["primaryEntityId"]).toEqual(
      new Includes([APP_ID]),
    );
    expect(spanReads[0]!.query["startTime"]).toEqual(
      new InBetween(new Date(UNTIL.getTime() - DAY_SECONDS * 1000), UNTIL),
    );
    // An install with no session.id is still an install.
    expect(spanReads[0]!.query).not.toHaveProperty("sessionId");
    expect(spanReads[0]!.query).not.toHaveProperty("entityKeys");
  });

  test("the crashed installs are the monitor's own occurrences', every filter with them", async () => {
    await read([CheckOn.InstallsWithExceptionsPercent]);

    expect(exceptionReads).toHaveLength(1);
    expect(exceptionReads[0]!.expression).toBe(STORED_APP_INSTALL_SQL);
    expect(exceptionReads[0]!.query["escaped"]).toBe(true);
    expect(exceptionReads[0]!.query["time"]).toEqual(
      new InBetween(new Date(UNTIL.getTime() - DAY_SECONDS * 1000), UNTIL),
    );
  });

  test("an entity filter narrows the installs as it narrows the count", async () => {
    await read([CheckOn.InstallsWithExceptionsPercent], {
      entityKeys: ["host:kiosk-12"],
    });

    expect(spanReads[0]!.query["entityKeys"]).toEqual(
      new Includes(["host:kiosk-12"]),
    );
  });

  test("an app that names no install has no share, never 0%", async () => {
    spanInstalls = 0;
    exceptionInstalls = 0;

    expect(await read([CheckOn.InstallsWithExceptionsPercent])).toEqual({
      installCount: 0,
      installsWithExceptionsCount: 0,
      installsWithExceptionsPercent: null,
    });
  });

  test("more crashed installs than the window's never reads above 100%", async () => {
    // A crash reported on an install that sent no span in the window.
    spanInstalls = 4;
    exceptionInstalls = 9;

    expect(await read([CheckOn.InstallsWithExceptionsPercent])).toEqual({
      installCount: 4,
      installsWithExceptionsCount: 4,
      installsWithExceptionsPercent: 100,
    });
  });
});

function response(
  measures: Partial<ExceptionMonitorResponse>,
): ExceptionMonitorResponse {
  return {
    projectId: PROJECT_ID,
    monitorId: ObjectID.generate(),
    exceptionCount: 12,
    exceptionQuery: {},
    evaluatedUntil: UNTIL,
    ...measures,
  } as unknown as ExceptionMonitorResponse;
}

function filter(
  checkOn: CheckOn,
  filterType: FilterType,
  value: string | number,
): CriteriaFilter {
  return { checkOn, filterType, value } as CriteriaFilter;
}

describe("the criteria judge a share of installs", () => {
  test("against a typed threshold with its fraction kept: 1.09 is not 1", async () => {
    const over: DataToProcess = response({
      installCount: 1000,
      installsWithExceptionsCount: 11,
      installsWithExceptionsPercent: 1.1,
    }) as unknown as DataToProcess;
    const under: DataToProcess = response({
      installCount: 1000,
      installsWithExceptionsCount: 10,
      installsWithExceptionsPercent: 1.05,
    }) as unknown as DataToProcess;

    for (const threshold of ["1.09", 1.09]) {
      const rule: CriteriaFilter = filter(
        CheckOn.InstallsWithExceptionsPercent,
        FilterType.GreaterThan,
        threshold,
      );

      expect(
        await ExceptionMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: over,
          criteriaFilter: rule,
        }),
      ).not.toBeNull();
      expect(
        await ExceptionMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: under,
          criteriaFilter: rule,
        }),
      ).toBeNull();
    }
  });

  test("no share matches no criteria, either way", async () => {
    const none: DataToProcess = response({
      installCount: 0,
      installsWithExceptionsCount: 0,
      installsWithExceptionsPercent: null,
    }) as unknown as DataToProcess;

    for (const filterType of [FilterType.GreaterThan, FilterType.LessThan]) {
      expect(
        await ExceptionMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: none,
          criteriaFilter: filter(
            CheckOn.InstallsWithExceptionsPercent,
            filterType,
            "5",
          ),
        }),
      ).toBeNull();
    }
  });

  test("the installs alone are the fewest a share is judged on", async () => {
    const day: DataToProcess = response({
      installCount: 249,
    }) as unknown as DataToProcess;

    expect(
      await ExceptionMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: day,
        criteriaFilter: filter(
          CheckOn.InstallCount,
          FilterType.GreaterThanOrEqualTo,
          250,
        ),
      }),
    ).toBeNull();
    expect(
      ExceptionMonitorCriteria.getMeasuredValue(
        response({}) as ExceptionMonitorResponse,
        CheckOn.InstallCount,
      ),
    ).toBe(0);
    expect(
      ExceptionMonitorCriteria.getMeasuredValue(
        response({}) as ExceptionMonitorResponse,
        CheckOn.InstallsWithExceptionsPercent,
      ),
    ).toBeNull();
  });

  test("the status timeline says what it measured", () => {
    const describe: (
      checkOn: CheckOn,
      measures: Partial<ExceptionMonitorResponse>,
    ) => string | null = (
      checkOn: CheckOn,
      measures: Partial<ExceptionMonitorResponse>,
    ): string | null => {
      return MonitorCriteriaObservationBuilder.describeExceptionCountObservation(
        {
          criteriaFilter: filter(checkOn, FilterType.GreaterThan, 1),
          dataToProcess: response(measures) as unknown as DataToProcess,
          checkOn: checkOn,
        },
      );
    };

    expect(
      describe(CheckOn.InstallsWithExceptionsPercent, {
        installCount: 400,
        installsWithExceptionsCount: 6,
        installsWithExceptionsPercent: 1.5,
      }),
    ).toBe(
      "1.5% of the window's installs had a matching exception: 6 of 400 installs.",
    );
    expect(
      describe(CheckOn.InstallsWithExceptionsPercent, {
        installsWithExceptionsPercent: null,
      }),
    ).toBe(
      "No install in the window to take a share of: the spans named no app.installation.id or device.id, or none arrived.",
    );
    expect(describe(CheckOn.InstallCount, { installCount: 1 })).toBe(
      "1 install was in the window.",
    );
    expect(describe(CheckOn.InstallCount, { installCount: 250 })).toBe(
      "250 installs were in the window.",
    );
  });
});

describe("the distinct count an install share is read with", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("counts the expression's distinct non-empty values, exactly, among the query's rows", () => {
    const statement: Statement = SpanService.toCountDistinctNonEmptyStatement({
      query: {
        projectId: PROJECT_ID,
        primaryEntityId: new Includes([APP_ID]),
      },
      expression: STORED_APP_INSTALL_SQL,
    });
    const sql: string = statement.query.replace(/\s+/g, " ");

    expect(sql).toContain(
      `SELECT uniqExactIf(${STORED_APP_INSTALL_SQL}, ${STORED_APP_INSTALL_SQL} != '') AS count`,
    );
    // The query's own filter, every column and value bound as a parameter.
    expect(sql).toMatch(
      / WHERE TRUE AND \{p\d+:Identifier\} = \{p\d+:String\} AND \{p\d+:Identifier\} IN \{p\d+:Array\(String\)\} AND retentionDate >= now\(\) /,
    );
    expect(sql).toContain("max_execution_time = 45");
    expect(sql).toContain("timeout_overflow_mode = 'break'");
  });

  test("reads the count through the count hooks and the read permission, and as a number however it arrives", async () => {
    const permission: ReturnType<typeof jest.spyOn> = jest.spyOn(
      ModelPermission,
      "checkReadPermission",
    );

    for (const [raw, expected] of [
      ["37", 37],
      [37, 37],
      [undefined, 0],
      ["not a number", 0],
      [-4, 0],
    ] as Array<[unknown, number]>) {
      jest.spyOn(SpanService, "executeQuery").mockImplementation((async () => {
        return {
          json: async () => {
            return { data: raw === undefined ? [] : [{ count: raw }] };
          },
        };
      }) as never);

      expect(
        await SpanService.countDistinctNonEmpty({
          query: { projectId: PROJECT_ID },
          expression: STORED_APP_INSTALL_SQL,
          props: { isRoot: true },
        }),
      ).toBe(expected);
    }

    expect(permission).toHaveBeenCalled();
  });
});
