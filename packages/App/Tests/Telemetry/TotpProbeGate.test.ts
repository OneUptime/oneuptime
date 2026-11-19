import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { Mock } from "jest-mock";

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      error: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/ProbeService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
    },
  };
});

// The queue module pulls in BullMQ at import time.
jest.mock(
  "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService",
  () => {
    return {
      __esModule: true,
      default: {
        addProbeIngestJob: jest.fn(),
      },
    };
  },
);

import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorTest from "Common/Models/DatabaseModels/MonitorTest";
import Probe from "Common/Models/DatabaseModels/Probe";
import ProbeService from "Common/Server/Services/ProbeService";
import logger from "Common/Server/Utils/Logger";
import ProbeReportIdentity from "Common/Server/Utils/Probe/ProbeReportIdentity";
import URL from "Common/Types/API/URL";
import BrowserType from "Common/Types/BrowserType";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import { FIRST_PROBE_VERSION_WITH_TOTP_CODES } from "Common/Types/Probe/ProbeCapability";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import ScreenSizeType from "Common/Types/ScreenSizeType";
import {
  ProbeFailureCause,
  readProbeFailureCause,
} from "Common/Utils/Monitor/ProbeFailureCauses";
import { TotpAlgorithm, TotpSecrets } from "Common/Utils/Totp/TotpParameters";
import TelemetryQueueService from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import TotpProbeGate, {
  ItemForProbeKind,
  ONE_TIME_CODE_STEP_NOT_RUN_MESSAGE,
} from "../../FeatureSet/Telemetry/Utils/TotpProbeGate";

/*
 * A step that needs a one-time code goes only to a probe that makes one
 * (issue #9759). A custom probe older than 17.0.1 does not declare
 * totpCodes, would send {{monitorSecrets.NAME}} as written, and cannot be
 * changed: the server keeps such a step from it, and writes the step's
 * result itself, as the probe's, with a sentence saying to update the
 * probe. The probe's other steps are handed out as before, and a global
 * probe - OneUptime's own, always current - is never flagged.
 *
 * The probe lookup and the queue are mocked: what is pinned here is which
 * steps go out, and what the result written for the others says.
 */

type AnyMock = Mock<(...args: Array<any>) => any>;

const probeService: { findOneById: AnyMock } = ProbeService as unknown as {
  findOneById: AnyMock;
};

const queue: { addProbeIngestJob: AnyMock } =
  TelemetryQueueService as unknown as { addProbeIngestJob: AnyMock };

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-00000000000a",
);
const PROBE_ID: ObjectID = new ObjectID("bbbbbbbb-0000-4000-8000-00000000000b");

const CODE_PARAMETERS: TotpSecrets = {
  LoginCode: {
    secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
    algorithm: TotpAlgorithm.SHA1,
    digits: 6,
    periodInSeconds: 30,
  },
};

// The capabilities of a probe from before one-time codes, and of one after.
const OLD_PROBE_BODY: JSONObject = {
  probeCapabilities: ["networkDevicePing", "retryWhenBusy"],
};
const CURRENT_PROBE_BODY: JSONObject = {
  probeCapabilities: ["networkDevicePing", "retryWhenBusy", "totpCodes"],
  probeVersion: "17.0.1",
};

let nextId: number = 1;

function newId(): ObjectID {
  const id: string = String(nextId++).padStart(12, "0");
  return new ObjectID(`cccccccc-0000-4000-8000-${id}`);
}

function step(data: {
  needsCode: boolean;
  browserTypes?: Array<BrowserType>;
  screenSizeTypes?: Array<ScreenSizeType>;
}): MonitorStep {
  const monitorStep: MonitorStep = new MonitorStep();
  monitorStep.id = newId();
  monitorStep.data = {
    ...MonitorStep.getDefaultMonitorStep({
      monitorType: MonitorType.API,
      defaultMonitorStatusId: newId(),
      onlineMonitorStatusId: newId(),
      offlineMonitorStatusId: newId(),
      monitorName: "Sign-in",
    } as never).data!,
    id: monitorStep.id.toString(),
    monitorDestination: URL.fromString("https://example.com/login"),
    customCode: needsCodeScript(data.needsCode),
  };

  if (data.needsCode) {
    monitorStep.data.totpSecrets = CODE_PARAMETERS;
  }

  if (data.browserTypes) {
    monitorStep.data.browserTypes = data.browserTypes;
  }

  if (data.screenSizeTypes) {
    monitorStep.data.screenSizeTypes = data.screenSizeTypes;
  }

  return monitorStep;
}

function needsCodeScript(needsCode: boolean): string {
  return needsCode
    ? 'await page.fill("#otp", await oneuptime.getTotpCode("LoginCode"));'
    : 'await page.goto("https://example.com");';
}

function monitor(monitorType: MonitorType, steps: Array<MonitorStep>): Monitor {
  const item: Monitor = new Monitor(newId());
  item.projectId = PROJECT_ID;
  item.monitorType = monitorType;
  item.monitorSteps = new MonitorSteps();
  item.monitorSteps.data = {
    monitorStepsInstanceArray: steps,
    defaultMonitorStatusId: undefined,
  };
  return item;
}

function monitorTest(
  monitorType: MonitorType,
  steps: Array<MonitorStep>,
): MonitorTest {
  const item: MonitorTest = new MonitorTest(newId());
  item.projectId = PROJECT_ID;
  item.monitorType = monitorType;
  item.monitorSteps = new MonitorSteps();
  item.monitorSteps.data = {
    monitorStepsInstanceArray: steps,
    defaultMonitorStatusId: undefined,
  };
  return item;
}

function customProbe(): Probe {
  const probe: Probe = new Probe(PROBE_ID);
  probe.isGlobalProbe = false;
  return probe;
}

function globalProbe(): Probe {
  const probe: Probe = new Probe(PROBE_ID);
  probe.isGlobalProbe = true;
  return probe;
}

interface QueuedJob {
  probeId: ObjectID;
  probeMonitorResponse: JSONObject;
  jobType: string;
  testId?: string | undefined;
  receivedAt?: Date | undefined;
}

function queuedJobs(): Array<QueuedJob> {
  return queue.addProbeIngestJob.mock.calls.map(
    (call: Array<unknown>): QueuedJob => {
      return call[0] as QueuedJob;
    },
  );
}

// A queued result, as the probe-ingest worker reads it back.
function readBack(job: QueuedJob): ProbeMonitorResponse {
  return JSONFunctions.deserialize(
    job.probeMonitorResponse,
  ) as unknown as ProbeMonitorResponse;
}

function stepIds(item: Monitor | MonitorTest): Array<string> {
  return (item.monitorSteps?.data?.monitorStepsInstanceArray || []).map(
    (monitorStep: MonitorStep): string => {
      return monitorStep.id.toString();
    },
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  probeService.findOneById.mockResolvedValue(customProbe() as never);
  queue.addProbeIngestJob.mockResolvedValue(undefined as never);
});

describe("the sentence a step kept from an old probe says", () => {
  test("says what happened, why, and what to do, naming the first release that makes codes", () => {
    expect(FIRST_PROBE_VERSION_WITH_TOTP_CODES).toBe("17.0.1");
    expect(ONE_TIME_CODE_STEP_NOT_RUN_MESSAGE).toBe(
      "This check needs a one-time code, and this probe is too old to make one, so the check did not run. Update the probe to OneUptime 17.0.1 or later.",
    );
  });

  test("is one of the probe failure causes, so a summary words it in the reader's language", () => {
    expect(readProbeFailureCause(ONE_TIME_CODE_STEP_NOT_RUN_MESSAGE)).toEqual({
      cause: ProbeFailureCause.ProbeTooOldForOneTimeCodes,
      values: { version: "17.0.1" },
    });
  });
});

describe("TotpProbeGate.getStepsNeedingCodes", () => {
  test("is the steps the server handed code parameters to", () => {
    const withCode: MonitorStep = step({ needsCode: true });
    const withoutCode: MonitorStep = step({ needsCode: false });

    expect(
      TotpProbeGate.getStepsNeedingCodes(
        monitor(MonitorType.API, [withoutCode, withCode]),
      ),
    ).toEqual([withCode]);
  });

  test("an empty set of parameters, or none, needs no code", () => {
    const empty: MonitorStep = step({ needsCode: false });
    empty.data!.totpSecrets = {};

    expect(
      TotpProbeGate.getStepsNeedingCodes(monitor(MonitorType.API, [empty])),
    ).toEqual([]);
    expect(TotpProbeGate.getStepsNeedingCodes(new Monitor(newId()))).toEqual(
      [],
    );
  });
});

describe("TotpProbeGate.isDeclaredByRequest", () => {
  test("is true only for a request that declares totpCodes", () => {
    expect(TotpProbeGate.isDeclaredByRequest(CURRENT_PROBE_BODY)).toBe(true);
    expect(TotpProbeGate.isDeclaredByRequest(OLD_PROBE_BODY)).toBe(false);
    expect(TotpProbeGate.isDeclaredByRequest({})).toBe(false);
    expect(TotpProbeGate.isDeclaredByRequest(undefined)).toBe(false);
    expect(
      TotpProbeGate.isDeclaredByRequest({ probeCapabilities: "totpCodes" }),
    ).toBe(false);
  });
});

describe("a probe that makes one-time codes", () => {
  test("is handed every step, untouched, and nothing is written for it", async () => {
    const item: Monitor = monitor(MonitorType.SyntheticMonitor, [
      step({ needsCode: true }),
      step({ needsCode: false }),
    ]);
    const before: Array<string> = stepIds(item);

    const handedOut: Array<Monitor> =
      await TotpProbeGate.keepStepsFromProbesTooOld({
        items: [item],
        probeId: PROBE_ID,
        requestBody: CURRENT_PROBE_BODY,
        kind: ItemForProbeKind.Monitor,
      });

    expect(handedOut).toEqual([item]);
    expect(stepIds(item)).toEqual(before);
    expect(queue.addProbeIngestJob).not.toHaveBeenCalled();
    // Its request says so: the probe is never looked up.
    expect(probeService.findOneById).not.toHaveBeenCalled();
  });
});

describe("a batch that needs no one-time code", () => {
  test("goes to any probe, old ones too, without looking the probe up", async () => {
    const items: Array<Monitor> = [
      monitor(MonitorType.API, [step({ needsCode: false })]),
      monitor(MonitorType.Website, [step({ needsCode: false })]),
    ];

    expect(
      await TotpProbeGate.keepStepsFromProbesTooOld({
        items: items,
        probeId: PROBE_ID,
        requestBody: OLD_PROBE_BODY,
        kind: ItemForProbeKind.Monitor,
      }),
    ).toEqual(items);
    expect(probeService.findOneById).not.toHaveBeenCalled();
    expect(queue.addProbeIngestJob).not.toHaveBeenCalled();
  });
});

describe("a custom probe too old to make one-time codes", () => {
  test("is not handed an API monitor whose step needs a code; the step's result says why, as the probe's", async () => {
    const codeStep: MonitorStep = step({ needsCode: true });
    const item: Monitor = monitor(MonitorType.API, [codeStep]);

    const handedOut: Array<Monitor> =
      await TotpProbeGate.keepStepsFromProbesTooOld({
        items: [item],
        probeId: PROBE_ID,
        requestBody: OLD_PROBE_BODY,
        kind: ItemForProbeKind.Monitor,
      });

    expect(handedOut).toEqual([]);
    expect(probeService.findOneById).toHaveBeenCalledWith({
      id: PROBE_ID,
      select: { isGlobalProbe: true },
      props: { isRoot: true },
    });

    const jobs: Array<QueuedJob> = queuedJobs();

    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.jobType).toBe("probe-response");
    expect(jobs[0]!.testId).toBeUndefined();
    expect(jobs[0]!.probeId.toString()).toBe(PROBE_ID.toString());
    expect(jobs[0]!.receivedAt).toBeInstanceOf(Date);

    const result: ProbeMonitorResponse = readBack(jobs[0]!);

    expect(result.monitorId.toString()).toBe(item.id!.toString());
    expect(result.monitorStepId.toString()).toBe(codeStep.id.toString());
    expect(result.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(result.probeId.toString()).toBe(PROBE_ID.toString());
    // An API step fails as a request that failed does: offline, with why.
    expect(result.isOnline).toBe(false);
    expect(result.failureCause).toBe(ONE_TIME_CODE_STEP_NOT_RUN_MESSAGE);
    expect(result.syntheticMonitorResponse).toBeUndefined();
    expect(result.customCodeMonitorResponse).toBeUndefined();
    // The worker holds it to the probe that it is written for.
    expect(ProbeReportIdentity.isResultOf(result, PROBE_ID)).toBe(true);
  });

  test("is handed a monitor's other steps; only the one that needs a code is written as not run", async () => {
    const plainStep: MonitorStep = step({ needsCode: false });
    const codeStep: MonitorStep = step({ needsCode: true });
    const lastStep: MonitorStep = step({ needsCode: false });
    const item: Monitor = monitor(MonitorType.API, [
      plainStep,
      codeStep,
      lastStep,
    ]);

    const handedOut: Array<Monitor> =
      await TotpProbeGate.keepStepsFromProbesTooOld({
        items: [item],
        probeId: PROBE_ID,
        requestBody: OLD_PROBE_BODY,
        kind: ItemForProbeKind.Monitor,
      });

    expect(handedOut).toEqual([item]);
    expect(stepIds(item)).toEqual([
      plainStep.id.toString(),
      lastStep.id.toString(),
    ]);
    expect(queuedJobs()).toHaveLength(1);
    expect(readBack(queuedJobs()[0]!).monitorStepId.toString()).toBe(
      codeStep.id.toString(),
    );
  });

  test("is still handed the monitors in its batch that need no code", async () => {
    const plain: Monitor = monitor(MonitorType.Website, [
      step({ needsCode: false }),
    ]);
    const withCode: Monitor = monitor(MonitorType.API, [
      step({ needsCode: true }),
    ]);
    const alsoPlain: Monitor = monitor(MonitorType.Ping, [
      step({ needsCode: false }),
    ]);

    expect(
      await TotpProbeGate.keepStepsFromProbesTooOld({
        items: [plain, withCode, alsoPlain],
        probeId: PROBE_ID,
        requestBody: OLD_PROBE_BODY,
        kind: ItemForProbeKind.Monitor,
      }),
    ).toEqual([plain, alsoPlain]);
    // One look at the probe for the whole batch.
    expect(probeService.findOneById).toHaveBeenCalledTimes(1);
  });

  test("writes a Synthetic step's result as its script's error, on each browser and screen size it is checked on", async () => {
    const codeStep: MonitorStep = step({
      needsCode: true,
      browserTypes: [BrowserType.Chromium, BrowserType.Firefox],
      screenSizeTypes: [ScreenSizeType.Desktop, ScreenSizeType.Mobile],
    });

    await TotpProbeGate.keepStepsFromProbesTooOld({
      items: [monitor(MonitorType.SyntheticMonitor, [codeStep])],
      probeId: PROBE_ID,
      requestBody: OLD_PROBE_BODY,
      kind: ItemForProbeKind.Monitor,
    });

    const result: ProbeMonitorResponse = readBack(queuedJobs()[0]!);

    expect(result.failureCause).toBe(ONE_TIME_CODE_STEP_NOT_RUN_MESSAGE);
    // A script that failed: the default criteria read its error, not isOnline.
    expect(result.isOnline).toBeUndefined();
    expect(
      (result.syntheticMonitorResponse || []).map(
        (entry: {
          browserType: BrowserType;
          screenSizeType: ScreenSizeType;
          scriptError?: string | undefined;
          executionTimeInMS: number;
          logMessages: Array<string>;
        }) => {
          return [
            entry.browserType,
            entry.screenSizeType,
            entry.scriptError,
            entry.executionTimeInMS,
            entry.logMessages,
          ];
        },
      ),
    ).toEqual([
      [
        BrowserType.Chromium,
        ScreenSizeType.Desktop,
        ONE_TIME_CODE_STEP_NOT_RUN_MESSAGE,
        0,
        [],
      ],
      [
        BrowserType.Chromium,
        ScreenSizeType.Mobile,
        ONE_TIME_CODE_STEP_NOT_RUN_MESSAGE,
        0,
        [],
      ],
      [
        BrowserType.Firefox,
        ScreenSizeType.Desktop,
        ONE_TIME_CODE_STEP_NOT_RUN_MESSAGE,
        0,
        [],
      ],
      [
        BrowserType.Firefox,
        ScreenSizeType.Mobile,
        ONE_TIME_CODE_STEP_NOT_RUN_MESSAGE,
        0,
        [],
      ],
    ]);
  });

  test("writes a Synthetic step that names no browser once, so it still says why", async () => {
    await TotpProbeGate.keepStepsFromProbesTooOld({
      items: [
        monitor(MonitorType.SyntheticMonitor, [
          step({ needsCode: true, browserTypes: [], screenSizeTypes: [] }),
        ]),
      ],
      probeId: PROBE_ID,
      requestBody: OLD_PROBE_BODY,
      kind: ItemForProbeKind.Monitor,
    });

    const result: ProbeMonitorResponse = readBack(queuedJobs()[0]!);

    expect(result.syntheticMonitorResponse).toHaveLength(1);
    expect(result.syntheticMonitorResponse![0]!.scriptError).toBe(
      ONE_TIME_CODE_STEP_NOT_RUN_MESSAGE,
    );
  });

  test("writes a Custom Code step's result as its script's error", async () => {
    await TotpProbeGate.keepStepsFromProbesTooOld({
      items: [
        monitor(MonitorType.CustomJavaScriptCode, [step({ needsCode: true })]),
      ],
      probeId: PROBE_ID,
      requestBody: OLD_PROBE_BODY,
      kind: ItemForProbeKind.Monitor,
    });

    const result: ProbeMonitorResponse = readBack(queuedJobs()[0]!);

    expect(result.isOnline).toBeUndefined();
    expect(result.customCodeMonitorResponse).toEqual({
      result: undefined,
      scriptError: ONE_TIME_CODE_STEP_NOT_RUN_MESSAGE,
      logMessages: [],
      capturedMetrics: [],
      executionTimeInMS: 0,
    });
  });

  test("writes a monitor test's step as the test's result, named by the test", async () => {
    const codeStep: MonitorStep = step({ needsCode: true });
    const test: MonitorTest = monitorTest(MonitorType.API, [codeStep]);

    const handedOut: Array<MonitorTest> =
      await TotpProbeGate.keepStepsFromProbesTooOld({
        items: [test],
        probeId: PROBE_ID,
        requestBody: OLD_PROBE_BODY,
        kind: ItemForProbeKind.MonitorTest,
      });

    expect(handedOut).toEqual([]);

    const job: QueuedJob = queuedJobs()[0]!;

    expect(job.jobType).toBe("monitor-test");
    expect(job.testId).toBe(test.id!.toString());
    // The probe names a test's result by the test, as its monitor.
    expect(readBack(job).monitorId.toString()).toBe(test.id!.toString());
    expect(readBack(job).failureCause).toBe(ONE_TIME_CODE_STEP_NOT_RUN_MESSAGE);
  });

  test("a probe that cannot be found is no global probe: its steps are kept from it", async () => {
    probeService.findOneById.mockResolvedValue(null as never);

    expect(
      await TotpProbeGate.keepStepsFromProbesTooOld({
        items: [monitor(MonitorType.API, [step({ needsCode: true })])],
        probeId: PROBE_ID,
        requestBody: OLD_PROBE_BODY,
        kind: ItemForProbeKind.Monitor,
      }),
    ).toEqual([]);
    expect(queuedJobs()).toHaveLength(1);
  });

  test("a result that cannot be queued is logged; the step is kept from the probe and the batch goes on", async () => {
    queue.addProbeIngestJob
      .mockRejectedValueOnce(new Error("queue down") as never)
      .mockResolvedValue(undefined as never);

    const first: Monitor = monitor(MonitorType.API, [
      step({ needsCode: true }),
    ]);
    const second: Monitor = monitor(MonitorType.API, [
      step({ needsCode: true }),
    ]);
    const plain: Monitor = monitor(MonitorType.API, [
      step({ needsCode: false }),
    ]);

    expect(
      await TotpProbeGate.keepStepsFromProbesTooOld({
        items: [first, second, plain],
        probeId: PROBE_ID,
        requestBody: OLD_PROBE_BODY,
        kind: ItemForProbeKind.Monitor,
      }),
    ).toEqual([plain]);
    expect(queue.addProbeIngestJob).toHaveBeenCalledTimes(2);
    expect((logger as unknown as { error: AnyMock }).error).toHaveBeenCalled();
  });
});

describe("a global probe", () => {
  test("is never flagged: it is handed every step, whatever its request declares", async () => {
    probeService.findOneById.mockResolvedValue(globalProbe() as never);

    const item: Monitor = monitor(MonitorType.API, [
      step({ needsCode: true }),
      step({ needsCode: false }),
    ]);
    const before: Array<string> = stepIds(item);

    expect(
      await TotpProbeGate.keepStepsFromProbesTooOld({
        items: [item],
        probeId: PROBE_ID,
        requestBody: OLD_PROBE_BODY,
        kind: ItemForProbeKind.Monitor,
      }),
    ).toEqual([item]);
    expect(stepIds(item)).toEqual(before);
    expect(queue.addProbeIngestJob).not.toHaveBeenCalled();
  });
});
