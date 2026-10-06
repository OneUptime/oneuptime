/*
 * A check result carrying a NUL character (U+0000), end to end through
 * MonitorResourceUtil.monitorResource.
 *
 * Production Postgres logged hundreds of these an hour:
 *
 *   ERROR:  unsupported Unicode escape sequence
 *   DETAIL: \u0000 cannot be converted to text.
 *   STATEMENT: UPDATE "MonitorProbe" SET "lastMonitoringLog" = $1, ...
 *
 * monitorResource writes a copy of the probe response to
 * MonitorProbe.lastMonitoringLog BEFORE it evaluates anything. The driver
 * binds a jsonb value as JSON.stringify(value), which writes a NUL as the
 * escape \u0000, and Postgres refuses that - so a response whose body or
 * headers held one threw from the UPDATE, failed the ingest job before the
 * criteria ran, and failed every retry the same way. That check result was
 * never evaluated.
 *
 * The writes here are stubbed to refuse exactly what Postgres refuses
 * (Tests/Helpers/PostgresJsonbInput), and the suite pins two things:
 *
 *   - every jsonb copy monitorResource writes is one Postgres accepts:
 *     MonitorProbe.lastMonitoringLog, Monitor.serverMonitorResponse,
 *     Monitor.incomingMonitorRequest and the revert-to-default
 *     MonitorStatusTimeline.statusChangeLog;
 *   - the result is still evaluated, against the payload exactly as it
 *     arrived. Only the stored copy changes, so a criteria that looks at the
 *     body sees what the endpoint actually sent.
 *
 * Everything heavy is mocked BEFORE importing MonitorResource, as in
 * MonitorResourceIngestedStepSelection.test.ts: the criteria evaluator
 * (native isolated-vm), the monitor and probe services (Postgres), the
 * per-monitor semaphore (Redis), the metric and log utils (ClickHouse) and
 * the logger.
 */

jest.mock("isolated-vm", () => {
  return {};
});

jest.mock("../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator", () => {
  return {
    __esModule: true,
    default: {
      processMonitorStep: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      updateColumnsByIdWithoutHooks: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Services/MonitorProbeService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      updateColumnsByIdWithoutHooks: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Infrastructure/Semaphore", () => {
  return {
    __esModule: true,
    default: {
      lock: jest.fn(),
      release: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Utils/Monitor/MonitorMetricUtil", () => {
  return {
    __esModule: true,
    default: {
      saveMonitorMetrics: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Utils/Monitor/MonitorLogUtil", () => {
  return {
    __esModule: true,
    default: {
      saveMonitorLog: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      trace: jest.fn(),
    },
  };
});

import MonitorResourceUtil from "../../../../Server/Utils/Monitor/MonitorResource";
import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import MonitorIncident from "../../../../Server/Utils/Monitor/MonitorIncident";
import MonitorAlert from "../../../../Server/Utils/Monitor/MonitorAlert";
import MonitorService from "../../../../Server/Services/MonitorService";
import MonitorProbeService from "../../../../Server/Services/MonitorProbeService";
import MonitorStatusService from "../../../../Server/Services/MonitorStatusService";
import MonitorStatusTimelineService from "../../../../Server/Services/MonitorStatusTimelineService";
import ProjectScopedReferenceValidator from "../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorProbe, {
  MonitorStepProbeResponse,
} from "../../../../Models/DatabaseModels/MonitorProbe";
import MonitorStatusTimeline from "../../../../Models/DatabaseModels/MonitorStatusTimeline";
import HTTPMethod from "../../../../Types/API/HTTPMethod";
import { JSONObject } from "../../../../Types/JSON";
import IncomingMonitorRequest from "../../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorCriteria from "../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ServerMonitorResponse from "../../../../Types/Monitor/ServerMonitor/ServerMonitorResponse";
import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import ProbeApiIngestResponse from "../../../../Types/Probe/ProbeApiIngestResponse";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import {
  assertJsonbAccepts,
  jsonbWouldRefuse,
} from "../../../Helpers/PostgresJsonbInput";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";

const processMonitorStepMock: jest.Mock =
  MonitorCriteriaEvaluator.processMonitorStep as unknown as jest.Mock;

const findMonitorMock: jest.Mock =
  MonitorService.findOneById as unknown as jest.Mock;

const updateMonitorColumnsMock: jest.Mock =
  MonitorService.updateColumnsByIdWithoutHooks as unknown as jest.Mock;

const findMonitorProbesMock: jest.Mock =
  MonitorProbeService.findBy as unknown as jest.Mock;

const updateMonitorProbeColumnsMock: jest.Mock =
  MonitorProbeService.updateColumnsByIdWithoutHooks as unknown as jest.Mock;

const lockMock: jest.Mock = Semaphore.lock as unknown as jest.Mock;

/*
 * The first bytes of a ZIP archive, as a probe decodes them: what a Website
 * monitor pointed at a download link gets back for a body.
 */
const ZIP_BODY: string = "PK\u0003\u0004\u0014\u0000\u0000\u0000\u0008\u0000";

// The first half of an emoji, left behind when a body is cut inside it.
const LONE_HIGH_SURROGATE: string = "\uD83D";

type ColumnsWrite = {
  id: ObjectID;
  data: JSONObject;
};

/*
 * Both raw-write mocks behave like Postgres for the columns they write:
 * any jsonb value it would refuse fails the call with Postgres' message.
 * Every value is JSON.stringify'd the way the driver binds it, so a value
 * that is not jsonb (a Date) is checked harmlessly as well.
 */
type RefuseLikePostgresFunction = (write: ColumnsWrite) => Promise<void>;

const refuseLikePostgres: RefuseLikePostgresFunction = (
  write: ColumnsWrite,
): Promise<void> => {
  for (const value of Object.values(write.data)) {
    assertJsonbAccepts(value);
  }

  return Promise.resolve();
};

type MakeStepFunction = () => MonitorStep;

const makeStep: MakeStepFunction = (): MonitorStep => {
  const criteriaInstance: MonitorCriteriaInstance =
    new MonitorCriteriaInstance();
  criteriaInstance.data!.name = "Is Online";

  const monitorCriteria: MonitorCriteria = new MonitorCriteria();
  monitorCriteria.data = {
    monitorCriteriaInstanceArray: [criteriaInstance],
  };

  const step: MonitorStep = new MonitorStep();
  step.data!.monitorCriteria = monitorCriteria;

  return step;
};

type MakeMonitorFunction = (input: {
  monitorType: MonitorType;
  step: MonitorStep;
  defaultMonitorStatusId?: ObjectID | undefined;
}) => Monitor;

const makeMonitor: MakeMonitorFunction = (input: {
  monitorType: MonitorType;
  step: MonitorStep;
  defaultMonitorStatusId?: ObjectID | undefined;
}): Monitor => {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: [input.step],
    /*
     * Undefined unless a test wants the revert-to-default path: a set
     * default status sends a no-criteria-met evaluation there.
     */
    defaultMonitorStatusId: input.defaultMonitorStatusId,
  };

  const monitor: Monitor = new Monitor();
  monitor.id = ObjectID.generate();
  monitor.projectId = ObjectID.generate();
  monitor.monitorType = input.monitorType;
  monitor.monitorSteps = monitorSteps;
  monitor.currentMonitorStatusId = ObjectID.generate();

  return monitor;
};

type MakeProbeResultFunction = (input: {
  monitor: Monitor;
  probeId: ObjectID;
  monitorStepId: ObjectID;
  responseBody: string | JSONObject;
  responseHeaders?: JSONObject | undefined;
}) => ProbeMonitorResponse;

const makeProbeResult: MakeProbeResultFunction = (input: {
  monitor: Monitor;
  probeId: ObjectID;
  monitorStepId: ObjectID;
  responseBody: string | JSONObject;
  responseHeaders?: JSONObject | undefined;
}): ProbeMonitorResponse => {
  return {
    projectId: input.monitor.projectId!,
    monitorId: input.monitor.id!,
    probeId: input.probeId,
    monitorStepId: input.monitorStepId,
    isOnline: true,
    responseCode: 200,
    responseTimeInMs: 120,
    responseBody: input.responseBody,
    responseHeaders: input.responseHeaders || {
      "content-type": "application/zip",
      "x-request\u0000id": "abc\u0000def",
    },
    failureCause: "",
    monitoredAt: OneUptimeDate.getCurrentDate(),
  } as unknown as ProbeMonitorResponse;
};

type EvaluatedPayloadFunction = () => DataToProcess;

// What the criteria evaluator was handed for this result.
const evaluatedPayload: EvaluatedPayloadFunction = (): DataToProcess => {
  return (
    processMonitorStepMock.mock.calls[0]![0] as { dataToProcess: DataToProcess }
  ).dataToProcess;
};

type StoredProbeLogFunction = () => MonitorStepProbeResponse;

// What monitorResource wrote to MonitorProbe.lastMonitoringLog.
const storedProbeLog: StoredProbeLogFunction = (): MonitorStepProbeResponse => {
  expect(updateMonitorProbeColumnsMock).toHaveBeenCalledTimes(1);

  return (
    updateMonitorProbeColumnsMock.mock.calls[0]![0] as {
      data: { lastMonitoringLog: MonitorStepProbeResponse };
    }
  ).data.lastMonitoringLog;
};

type StoredMonitorColumnFunction = (column: string) => unknown;

// What monitorResource wrote to one Monitor column.
const storedMonitorColumn: StoredMonitorColumnFunction = (
  column: string,
): unknown => {
  expect(updateMonitorColumnsMock).toHaveBeenCalledTimes(1);

  return (updateMonitorColumnsMock.mock.calls[0]![0] as ColumnsWrite).data[
    column
  ];
};

describe("MonitorResourceUtil.monitorResource stores payloads Postgres can hold", () => {
  let checkProbeAgreementSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    lockMock.mockResolvedValue({});

    updateMonitorProbeColumnsMock.mockImplementation(refuseLikePostgres);
    updateMonitorColumnsMock.mockImplementation(refuseLikePostgres);

    // No criteria met: nothing past the probe log and payload writes runs.
    processMonitorStepMock.mockImplementation(
      (input: {
        probeApiIngestResponse: ProbeApiIngestResponse;
      }): Promise<ProbeApiIngestResponse> => {
        return Promise.resolve({
          ...input.probeApiIngestResponse,
          criteriaMetId: undefined,
          rootCause: null,
        });
      },
    );

    // Agreement is covered elsewhere; pass this probe's verdict through.
    checkProbeAgreementSpy = jest
      .spyOn(MonitorResourceUtil as any, "checkProbeAgreement")
      .mockImplementation((input: any) => {
        return Promise.resolve({
          hasAgreement: true,
          agreementCount: 1,
          requiredCount: 1,
          totalActiveProbes: 1,
          agreedCriteriaId: input.currentCriteriaMetId,
          agreedRootCause: input.currentRootCause,
          agreedProbeNames: [],
        });
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("a probe result with NUL in its body and headers", () => {
    let step: MonitorStep;
    let monitor: Monitor;
    let probeId: ObjectID;
    let monitorProbe: MonitorProbe;

    beforeEach(() => {
      step = makeStep();
      monitor = makeMonitor({ monitorType: MonitorType.Website, step: step });
      probeId = ObjectID.generate();

      monitorProbe = new MonitorProbe();
      monitorProbe.id = ObjectID.generate();
      monitorProbe.probeId = probeId;
      monitorProbe.isEnabled = true;

      findMonitorMock.mockResolvedValue(monitor);
      findMonitorProbesMock.mockResolvedValue([monitorProbe]);
    });

    test("is exactly what Postgres refused - the fixture reproduces the incident", () => {
      const result: ProbeMonitorResponse = makeProbeResult({
        monitor,
        probeId,
        monitorStepId: step.id,
        responseBody: ZIP_BODY,
      });

      // The copy the old code stored: refused, as in production.
      expect(jsonbWouldRefuse(JSON.parse(JSON.stringify(result)))).toBe(true);
    });

    test("is stored, then evaluated - the job no longer fails before the criteria run", async () => {
      await expect(
        MonitorResourceUtil.monitorResource(
          makeProbeResult({
            monitor,
            probeId,
            monitorStepId: step.id,
            responseBody: ZIP_BODY,
          }),
        ),
      ).resolves.toBeDefined();

      expect(updateMonitorProbeColumnsMock).toHaveBeenCalledTimes(1);
      expect(processMonitorStepMock).toHaveBeenCalledTimes(1);
      expect(jsonbWouldRefuse(storedProbeLog())).toBe(false);
    });

    test("stores U+FFFD where the body and headers held NUL", async () => {
      await MonitorResourceUtil.monitorResource(
        makeProbeResult({
          monitor,
          probeId,
          monitorStepId: step.id,
          responseBody: ZIP_BODY,
        }),
      );

      const stored: ProbeMonitorResponse = storedProbeLog()[
        step.id.toString()
      ] as ProbeMonitorResponse;

      expect(stored.responseBody).toBe(
        "PK\u0003\u0004\u0014\uFFFD\uFFFD\uFFFD\u0008\uFFFD",
      );
      expect(stored.responseHeaders).toEqual({
        "content-type": "application/zip",
        "x-request\uFFFDid": "abc\uFFFDdef",
      });
    });

    test("stores the rest of the result exactly as before", async () => {
      const result: ProbeMonitorResponse = makeProbeResult({
        monitor,
        probeId,
        monitorStepId: step.id,
        responseBody: ZIP_BODY,
      });

      await MonitorResourceUtil.monitorResource(result);

      const stored: JSONObject = storedProbeLog()[
        step.id.toString()
      ] as unknown as JSONObject;

      // The JSON copy the old code made, minus the replaced characters.
      const previousCopy: JSONObject = JSON.parse(JSON.stringify(result));

      for (const key of [
        "projectId",
        "monitorId",
        "probeId",
        "monitorStepId",
        "isOnline",
        "responseCode",
        "responseTimeInMs",
        "failureCause",
      ]) {
        expect(stored[key]).toEqual(previousCopy[key]);
      }

      expect(stored["monitoredAt"]).toBeInstanceOf(Date);
    });

    test("evaluates the criteria against the result exactly as the probe sent it", async () => {
      const result: ProbeMonitorResponse = makeProbeResult({
        monitor,
        probeId,
        monitorStepId: step.id,
        responseBody: ZIP_BODY,
      });

      await MonitorResourceUtil.monitorResource(result);

      // The very object that came in, NULs and live ObjectIDs intact.
      const evaluated: ProbeMonitorResponse =
        evaluatedPayload() as ProbeMonitorResponse;

      expect(evaluated).toBe(result);
      expect(evaluated.responseBody).toBe(ZIP_BODY);
      expect(evaluated.responseHeaders).toEqual({
        "content-type": "application/zip",
        "x-request\u0000id": "abc\u0000def",
      });
      expect(evaluated.probeId).toBeInstanceOf(ObjectID);
    });

    test("an API body parsed as JSON has NUL replaced in its keys and values", async () => {
      await MonitorResourceUtil.monitorResource(
        makeProbeResult({
          monitor,
          probeId,
          monitorStepId: step.id,
          responseBody: {
            status: "degraded\u0000",
            checks: [{ ["disk\u0000"]: "full\u0000" }],
          },
        }),
      );

      const stored: ProbeMonitorResponse = storedProbeLog()[
        step.id.toString()
      ] as ProbeMonitorResponse;

      expect(stored.responseBody).toEqual({
        status: "degraded\uFFFD",
        checks: [{ ["disk\uFFFD"]: "full\uFFFD" }],
      });
      expect(jsonbWouldRefuse(storedProbeLog())).toBe(false);
    });

    test("a body cut inside an emoji is stored with U+FFFD for the lone half", async () => {
      await MonitorResourceUtil.monitorResource(
        makeProbeResult({
          monitor,
          probeId,
          monitorStepId: step.id,
          responseBody: `<p>deployed ${LONE_HIGH_SURROGATE}`,
          responseHeaders: { "content-type": "text/html" },
        }),
      );

      const stored: ProbeMonitorResponse = storedProbeLog()[
        step.id.toString()
      ] as ProbeMonitorResponse;

      expect(stored.responseBody).toBe("<p>deployed \uFFFD");
      expect(processMonitorStepMock).toHaveBeenCalledTimes(1);
    });

    test("keeps the other steps' entries already in the column as they were", async () => {
      const otherStepId: string = ObjectID.generate().toString();
      const otherStepEntry: JSONObject = {
        isOnline: false,
        responseCode: 503,
        monitoredAt: "2026-10-06T09:59:00.000Z",
      };

      monitorProbe.lastMonitoringLog = {
        [otherStepId]: otherStepEntry,
      } as unknown as MonitorStepProbeResponse;

      await MonitorResourceUtil.monitorResource(
        makeProbeResult({
          monitor,
          probeId,
          monitorStepId: step.id,
          responseBody: ZIP_BODY,
        }),
      );

      const stored: MonitorStepProbeResponse = storedProbeLog();

      expect(Object.keys(stored).sort()).toEqual(
        [otherStepId, step.id.toString()].sort(),
      );
      expect(stored[otherStepId]).toEqual(otherStepEntry);
    });

    test("probe agreement reads the stored copy, as a fresh read would return it", async () => {
      await MonitorResourceUtil.monitorResource(
        makeProbeResult({
          monitor,
          probeId,
          monitorStepId: step.id,
          responseBody: ZIP_BODY,
        }),
      );

      // The in-memory row is the stored value, not the live payload.
      expect(monitorProbe.lastMonitoringLog).toBe(storedProbeLog());

      const agreementInput: { monitorProbes: Array<MonitorProbe> } =
        checkProbeAgreementSpy.mock.calls[0]![0] as {
          monitorProbes: Array<MonitorProbe>;
        };

      expect(agreementInput.monitorProbes[0]).toBe(monitorProbe);
      expect(
        jsonbWouldRefuse(agreementInput.monitorProbes[0]!.lastMonitoringLog),
      ).toBe(false);
    });

    test("a result with nothing to replace is stored exactly as before", async () => {
      const result: ProbeMonitorResponse = makeProbeResult({
        monitor,
        probeId,
        monitorStepId: step.id,
        responseBody: "<html>ok</html>",
        responseHeaders: { "content-type": "text/html" },
      });

      /*
       * The copy the old code stored, taken at the moment of the write:
       * the evaluation that follows keeps adding events to the payload's
       * evaluationSummary, and the stored copy must not pick those up.
       */
      let previousCopy: JSONObject = {};

      updateMonitorProbeColumnsMock.mockImplementation(
        (write: ColumnsWrite): Promise<void> => {
          previousCopy = JSON.parse(JSON.stringify(result));
          return refuseLikePostgres(write);
        },
      );

      await MonitorResourceUtil.monitorResource(result);

      const stored: JSONObject = {
        ...(storedProbeLog()[step.id.toString()] as unknown as JSONObject),
      };
      delete stored["monitoredAt"];
      delete previousCopy["monitoredAt"];

      expect(stored).toEqual(previousCopy);
    });
  });

  describe("a server monitor report with NUL in a process command line", () => {
    /*
     * /proc/<pid>/cmdline separates arguments with NUL, so an agent that
     * reports it raw puts one between every argument.
     */
    type MakeReportFunction = (monitor: Monitor) => ServerMonitorResponse;

    const makeReport: MakeReportFunction = (
      monitor: Monitor,
    ): ServerMonitorResponse => {
      return {
        projectId: monitor.projectId!,
        monitorId: monitor.id!,
        hostname: "web-1",
        requestReceivedAt: OneUptimeDate.getCurrentDate(),
        onlyCheckRequestReceivedAt: false,
        processes: [
          {
            pid: 4242,
            name: "java",
            command: "java\u0000-jar\u0000app.jar",
          },
        ],
      };
    };

    let monitor: Monitor;

    beforeEach(() => {
      monitor = makeMonitor({
        monitorType: MonitorType.Server,
        step: makeStep(),
      });

      findMonitorMock.mockResolvedValue(monitor);
    });

    test("stores Monitor.serverMonitorResponse with U+FFFD for each NUL", async () => {
      const report: ServerMonitorResponse = makeReport(monitor);

      await expect(
        MonitorResourceUtil.monitorResource(report),
      ).resolves.toBeDefined();

      const stored: ServerMonitorResponse = storedMonitorColumn(
        "serverMonitorResponse",
      ) as ServerMonitorResponse;

      expect(stored.processes![0]!.command).toBe("java\uFFFD-jar\uFFFDapp.jar");
      expect(jsonbWouldRefuse(stored)).toBe(false);
    });

    test("still stamps the heartbeat time as the Date the report arrived", async () => {
      const report: ServerMonitorResponse = makeReport(monitor);

      await MonitorResourceUtil.monitorResource(report);

      expect(storedMonitorColumn("serverMonitorRequestReceivedAt")).toBe(
        report.requestReceivedAt,
      );
    });

    test("evaluates the report exactly as the agent sent it", async () => {
      const report: ServerMonitorResponse = makeReport(monitor);

      await MonitorResourceUtil.monitorResource(report);

      expect(evaluatedPayload()).toBe(report);
      expect(report.processes![0]!.command).toBe("java\u0000-jar\u0000app.jar");
    });
  });

  describe("an incoming request with NUL in its body and headers", () => {
    type MakeRequestFunction = (
      monitor: Monitor,
      requestBody: string | JSONObject,
    ) => IncomingMonitorRequest;

    const makeRequest: MakeRequestFunction = (
      monitor: Monitor,
      requestBody: string | JSONObject,
    ): IncomingMonitorRequest => {
      return {
        projectId: monitor.projectId!,
        monitorId: monitor.id!,
        requestHeaders: {
          "content-type": "application/octet-stream",
          "x-signature": "sig\u0000nature",
        },
        requestBody: requestBody,
        requestMethod: HTTPMethod.POST,
        incomingRequestReceivedAt: OneUptimeDate.getCurrentDate(),
        onlyCheckForIncomingRequestReceivedAt: false,
        checkedAt: OneUptimeDate.getCurrentDate(),
      };
    };

    let monitor: Monitor;

    beforeEach(() => {
      monitor = makeMonitor({
        monitorType: MonitorType.IncomingRequest,
        step: makeStep(),
      });

      findMonitorMock.mockResolvedValue(monitor);
    });

    test("stores Monitor.incomingMonitorRequest with U+FFFD for each NUL", async () => {
      await expect(
        MonitorResourceUtil.monitorResource(
          makeRequest(monitor, "binary\u0000payload"),
        ),
      ).resolves.toBeDefined();

      const stored: IncomingMonitorRequest = storedMonitorColumn(
        "incomingMonitorRequest",
      ) as IncomingMonitorRequest;

      expect(stored.requestBody).toBe("binary\uFFFDpayload");
      expect(stored.requestHeaders).toEqual({
        "content-type": "application/octet-stream",
        "x-signature": "sig\uFFFDnature",
      });
      expect(jsonbWouldRefuse(stored)).toBe(false);
    });

    test("a JSON body has NUL replaced in its keys and values", async () => {
      await MonitorResourceUtil.monitorResource(
        makeRequest(monitor, {
          alerts: [{ ["label\u0000"]: "value\u0000" }],
        }),
      );

      const stored: IncomingMonitorRequest = storedMonitorColumn(
        "incomingMonitorRequest",
      ) as IncomingMonitorRequest;

      expect(stored.requestBody).toEqual({
        alerts: [{ ["label\uFFFD"]: "value\uFFFD" }],
      });
    });

    test("evaluates the request exactly as it arrived", async () => {
      const request: IncomingMonitorRequest = makeRequest(
        monitor,
        "binary\u0000payload",
      );

      await MonitorResourceUtil.monitorResource(request);

      expect(evaluatedPayload()).toBe(request);
      expect(request.requestBody).toBe("binary\u0000payload");
    });
  });

  describe("reverting to the default status when no criteria is met", () => {
    let createdTimelines: Array<MonitorStatusTimeline>;
    let step: MonitorStep;
    let monitor: Monitor;
    let probeId: ObjectID;

    beforeEach(() => {
      createdTimelines = [];

      step = makeStep();
      monitor = makeMonitor({
        monitorType: MonitorType.Website,
        step: step,
        defaultMonitorStatusId: ObjectID.generate(),
      });
      probeId = ObjectID.generate();

      const monitorProbe: MonitorProbe = new MonitorProbe();
      monitorProbe.id = ObjectID.generate();
      monitorProbe.probeId = probeId;
      monitorProbe.isEnabled = true;

      findMonitorMock.mockResolvedValue(monitor);
      findMonitorProbesMock.mockResolvedValue([monitorProbe]);

      jest
        .spyOn(MonitorIncident, "checkOpenIncidentsAndCloseIfResolved")
        .mockResolvedValue([]);
      jest
        .spyOn(MonitorAlert, "checkOpenAlertsAndCloseIfResolved")
        .mockResolvedValue([]);
      jest.spyOn(MonitorStatusService, "findOneBy").mockResolvedValue(null);
      jest
        .spyOn(ProjectScopedReferenceValidator, "isUsableInProject")
        .mockResolvedValue(true);

      // No timeline yet, so the revert is written.
      jest
        .spyOn(MonitorStatusTimelineService, "findOneBy")
        .mockResolvedValue(null);

      jest
        .spyOn(MonitorStatusTimelineService, "create")
        .mockImplementation(
          (createBy: unknown): Promise<MonitorStatusTimeline> => {
            const timeline: MonitorStatusTimeline = (
              createBy as { data: MonitorStatusTimeline }
            ).data;

            assertJsonbAccepts(timeline.statusChangeLog);
            createdTimelines.push(timeline);

            return Promise.resolve(timeline);
          },
        );
    });

    test("writes MonitorStatusTimeline.statusChangeLog as a storable copy", async () => {
      await expect(
        MonitorResourceUtil.monitorResource(
          makeProbeResult({
            monitor,
            probeId,
            monitorStepId: step.id,
            responseBody: ZIP_BODY,
          }),
        ),
      ).resolves.toBeDefined();

      expect(createdTimelines).toHaveLength(1);

      const statusChangeLog: JSONObject = createdTimelines[0]!.statusChangeLog!;

      expect(statusChangeLog["responseBody"]).toBe(
        "PK\u0003\u0004\u0014\uFFFD\uFFFD\uFFFD\u0008\uFFFD",
      );
      expect(statusChangeLog["responseHeaders"]).toEqual({
        "content-type": "application/zip",
        "x-request\uFFFDid": "abc\uFFFDdef",
      });
      expect(jsonbWouldRefuse(statusChangeLog)).toBe(false);
    });

    test("the default status the monitor reverts to is the configured one", async () => {
      await MonitorResourceUtil.monitorResource(
        makeProbeResult({
          monitor,
          probeId,
          monitorStepId: step.id,
          responseBody: ZIP_BODY,
        }),
      );

      expect(createdTimelines[0]!.monitorStatusId?.toString()).toBe(
        monitor.monitorSteps!.data!.defaultMonitorStatusId!.toString(),
      );
    });
  });
});
