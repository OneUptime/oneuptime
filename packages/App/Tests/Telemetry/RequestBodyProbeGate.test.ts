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
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorRequestBodyFormat from "Common/Types/Monitor/MonitorRequestBodyFormat";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import ProbeCapability, {
  FIRST_PROBE_VERSION_WITH_ANY_REQUEST_BODY,
} from "Common/Types/Probe/ProbeCapability";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import {
  ProbeFailureCause,
  readProbeFailureCause,
} from "Common/Utils/Monitor/ProbeFailureCauses";
import { TotpAlgorithm, TotpSecrets } from "Common/Utils/Totp/TotpParameters";
import TelemetryQueueService from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import ProbeStepGate, {
  ItemForProbe,
  ItemForProbeKind,
} from "../../FeatureSet/Telemetry/Utils/ProbeStepGate";
import PROBE_STEP_NEEDS from "../../FeatureSet/Telemetry/Utils/ProbeStepNeeds";
import {
  ANY_REQUEST_BODY_NEED,
  REQUEST_BODY_STEP_NOT_RUN_MESSAGE,
} from "../../FeatureSet/Telemetry/Utils/RequestBodyProbeGate";
import { ONE_TIME_CODE_STEP_NOT_RUN_MESSAGE } from "../../FeatureSet/Telemetry/Utils/TotpProbeGate";

/*
 * AN API STEP WHOSE BODY ONLY A NEWER PROBE SENDS GOES ONLY TO SUCH A
 * PROBE (issue #10737).
 *
 * A custom probe from before 17.2.0 reads every body as a JSON object, so
 * a check whose body is an array or a single value failed with "Expected
 * JSONObject, but got JSONArray", which said nothing of the probe being too
 * old. Such a probe does not declare anyRequestBody: the server keeps the
 * step from it and writes the step's result itself, offline, with a
 * sentence saying to update the probe. A probe that declares it, and a
 * global probe - OneUptime's own, always current - are handed every step.
 *
 * The gate is run as the route runs it, with every need (ProbeStepNeeds).
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

// A probe of 17.1.0: it makes one-time codes, and sends only object bodies.
const PROBE_BEFORE_ANY_BODY: JSONObject = {
  probeCapabilities: ["networkDevicePing", "retryWhenBusy", "totpCodes"],
  probeVersion: "17.1.0",
};
// A probe from before one-time codes too.
const PROBE_BEFORE_BOTH: JSONObject = {
  probeCapabilities: ["networkDevicePing", "retryWhenBusy"],
};
const CURRENT_PROBE: JSONObject = {
  probeCapabilities: [
    "networkDevicePing",
    "retryWhenBusy",
    "totpCodes",
    "anyRequestBody",
  ],
  probeVersion: "17.2.0",
};

let nextId: number = 1;

function newId(): ObjectID {
  const id: string = String(nextId++).padStart(12, "0");
  return new ObjectID(`cccccccc-0000-4000-8000-${id}`);
}

function apiStep(requestBody?: string | undefined): MonitorStep {
  const monitorStep: MonitorStep = new MonitorStep();
  monitorStep.id = newId();
  monitorStep.data = {
    ...MonitorStep.getDefaultMonitorStep({
      monitorType: MonitorType.API,
      defaultMonitorStatusId: newId(),
      onlineMonitorStatusId: newId(),
      offlineMonitorStatusId: newId(),
      monitorName: "Orders API",
    } as never).data!,
    id: monitorStep.id.toString(),
    monitorDestination: URL.fromString("https://api.example.com/orders"),
    requestBody: requestBody,
  };

  return monitorStep;
}

function asText(monitorStep: MonitorStep): MonitorStep {
  monitorStep.setRequestBodyFormat(MonitorRequestBodyFormat.Text);
  return monitorStep;
}

function withCode(monitorStep: MonitorStep): MonitorStep {
  monitorStep.data!.totpSecrets = CODE_PARAMETERS;
  return monitorStep;
}

function steps(items: Array<MonitorStep>): MonitorSteps {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: items,
    defaultMonitorStatusId: undefined,
  };
  return monitorSteps;
}

function monitor(
  items: Array<MonitorStep>,
  monitorType: MonitorType = MonitorType.API,
): Monitor {
  const item: Monitor = new Monitor(newId());
  item.projectId = PROJECT_ID;
  item.monitorType = monitorType;
  item.monitorSteps = steps(items);
  return item;
}

function monitorTest(items: Array<MonitorStep>): MonitorTest {
  const item: MonitorTest = new MonitorTest(newId());
  item.projectId = PROJECT_ID;
  item.monitorType = MonitorType.API;
  item.monitorSteps = steps(items);
  return item;
}

function probe(isGlobalProbe: boolean): Probe {
  const item: Probe = new Probe(PROBE_ID);
  item.isGlobalProbe = isGlobalProbe;
  return item;
}

async function handOut<T extends ItemForProbe>(
  items: Array<T>,
  requestBody: JSONObject,
  kind: ItemForProbeKind = ItemForProbeKind.Monitor,
): Promise<Array<T>> {
  return await ProbeStepGate.keepStepsFromProbesTooOld({
    items: items,
    probeId: PROBE_ID,
    requestBody: requestBody,
    kind: kind,
    needs: PROBE_STEP_NEEDS,
  });
}

interface QueuedJob {
  probeId: ObjectID;
  probeMonitorResponse: JSONObject;
  jobType: string;
  testId?: string | undefined;
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

function stepIds(item: ItemForProbe): Array<string> {
  return (item.monitorSteps?.data?.monitorStepsInstanceArray || []).map(
    (monitorStep: MonitorStep): string => {
      return monitorStep.id.toString();
    },
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  probeService.findOneById.mockResolvedValue(probe(false) as never);
  queue.addProbeIngestJob.mockResolvedValue(undefined as never);
});

describe("the sentence a step kept from an old probe says", () => {
  test("says what happened, why, and what to do, naming the first release that sends such a body", () => {
    expect(FIRST_PROBE_VERSION_WITH_ANY_REQUEST_BODY).toBe("17.2.0");
    expect(REQUEST_BODY_STEP_NOT_RUN_MESSAGE).toBe(
      "This probe is too old to send a request body that is a JSON array, a single value or text, so the check did not run. Update the probe to OneUptime 17.2.0 or later.",
    );
  });

  test("is one of the probe failure causes, so a summary words it in the reader's language", () => {
    expect(readProbeFailureCause(REQUEST_BODY_STEP_NOT_RUN_MESSAGE)).toEqual({
      cause: ProbeFailureCause.ProbeTooOldForRequestBody,
      values: { version: "17.2.0" },
    });
  });

  test("is asked of a probe by the capability it declares", () => {
    expect(ANY_REQUEST_BODY_NEED.capability).toBe(
      ProbeCapability.AnyRequestBody,
    );
    expect(
      ProbeStepGate.isDeclaredByRequest(
        CURRENT_PROBE,
        ProbeCapability.AnyRequestBody,
      ),
    ).toBe(true);
    expect(
      ProbeStepGate.isDeclaredByRequest(
        PROBE_BEFORE_ANY_BODY,
        ProbeCapability.AnyRequestBody,
      ),
    ).toBe(false);
  });
});

describe("a probe that sends any body", () => {
  test("is handed every step, an array body's too, and nothing is written for it", async () => {
    const item: Monitor = monitor([apiStep('[{"id": 1}]'), apiStep('"ping"')]);

    const handed: Array<Monitor> = await handOut([item], CURRENT_PROBE);

    expect(handed).toEqual([item]);
    expect(stepIds(handed[0]!)).toHaveLength(2);
    expect(queue.addProbeIngestJob).not.toHaveBeenCalled();
    expect(probeService.findOneById).not.toHaveBeenCalled();
  });
});

describe("a custom probe too old to send such a body", () => {
  test.each([
    { name: "an array", body: '[{"id": 1}, {"id": 2}]' },
    { name: "a string", body: '"ping"' },
    { name: "a number", body: "42" },
    { name: "null", body: "null" },
    { name: "an array a secret filled in", body: "[1,2,3]" },
    {
      name: "an array of a one-time code the probe makes",
      body: "[{{monitorSecrets.LoginCode}}]",
    },
  ])(
    "is not handed a step whose body is $name: its result is written, offline, saying why",
    async ({ body }: { name: string; body: string }) => {
      const kept: MonitorStep = apiStep(body);
      const item: Monitor = monitor([kept]);

      const handed: Array<Monitor> = await handOut(
        [item],
        PROBE_BEFORE_ANY_BODY,
      );

      // A monitor with no step left is not handed out.
      expect(handed).toEqual([]);
      expect(probeService.findOneById).toHaveBeenCalledWith({
        id: PROBE_ID,
        select: { isGlobalProbe: true },
        props: { isRoot: true },
      });

      const jobs: Array<QueuedJob> = queuedJobs();

      expect(jobs).toHaveLength(1);
      expect(jobs[0]!.jobType).toBe("probe-response");
      expect(jobs[0]!.probeId.toString()).toBe(PROBE_ID.toString());

      const result: ProbeMonitorResponse = readBack(jobs[0]!);

      expect(result.isOnline).toBe(false);
      expect(result.failureCause).toBe(REQUEST_BODY_STEP_NOT_RUN_MESSAGE);
      expect(result.monitorId.toString()).toBe(item.id!.toString());
      expect(result.monitorStepId.toString()).toBe(kept.id.toString());
      expect(result.projectId.toString()).toBe(PROJECT_ID.toString());
    },
  );

  test.each([
    { name: "an object", body: '{"status": "ok"}' },
    { name: "a JSON5 object", body: "{status: 'ok',}" },
    {
      name: "an object with a one-time code",
      body: '{"otp": "{{monitorSecrets.LoginCode}}"}',
    },
    { name: "no body", body: undefined },
    { name: "an empty body", body: "  " },
    { name: "a body that is no JSON, which fails on any probe", body: "<a/>" },
  ])(
    "is handed a step whose body is $name, as before",
    async ({ body }: { name: string; body: string | undefined }) => {
      const item: Monitor = monitor([apiStep(body)]);

      const handed: Array<Monitor> = await handOut(
        [item],
        PROBE_BEFORE_ANY_BODY,
      );

      expect(handed).toEqual([item]);
      expect(queue.addProbeIngestJob).not.toHaveBeenCalled();
      expect(probeService.findOneById).not.toHaveBeenCalled();
    },
  );

  test("is handed a monitor's other steps, and the monitors that need nothing more", async () => {
    const objectStep: MonitorStep = apiStep('{"a": 1}');
    const arrayStep: MonitorStep = apiStep("[1]");
    const mixed: Monitor = monitor([objectStep, arrayStep]);
    const plain: Monitor = monitor([apiStep('{"b": 2}')]);

    const handed: Array<Monitor> = await handOut(
      [mixed, plain],
      PROBE_BEFORE_ANY_BODY,
    );

    expect(handed).toEqual([mixed, plain]);
    expect(stepIds(mixed)).toEqual([objectStep.id.toString()]);
    expect(queuedJobs()).toHaveLength(1);
    expect(readBack(queuedJobs()[0]!).monitorStepId.toString()).toBe(
      arrayStep.id.toString(),
    );
  });

  test("a Test Monitor run's result is filed under the test it answers", async () => {
    const item: MonitorTest = monitorTest([apiStep('["ping"]')]);

    const handed: Array<MonitorTest> = await handOut(
      [item],
      PROBE_BEFORE_ANY_BODY,
      ItemForProbeKind.MonitorTest,
    );

    expect(handed).toEqual([]);

    const jobs: Array<QueuedJob> = queuedJobs();

    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.jobType).toBe("monitor-test");
    expect(jobs[0]!.testId).toBe(item.id!.toString());
    expect(readBack(jobs[0]!).failureCause).toBe(
      REQUEST_BODY_STEP_NOT_RUN_MESSAGE,
    );
  });

  test("only an API monitor sends a body: another type's leftover body needs nothing", async () => {
    const item: Monitor = monitor([apiStep("[1]")], MonitorType.Website);

    expect(await handOut([item], PROBE_BEFORE_ANY_BODY)).toEqual([item]);
    expect(queue.addProbeIngestJob).not.toHaveBeenCalled();
  });

  test("a result that cannot be queued never fails the batch, and the step is kept all the same", async () => {
    queue.addProbeIngestJob.mockRejectedValue(new Error("queue down") as never);

    const item: Monitor = monitor([apiStep("[1]"), apiStep('{"a": 1}')]);
    const handed: Array<Monitor> = await handOut([item], PROBE_BEFORE_ANY_BODY);

    expect(handed).toEqual([item]);
    expect(stepIds(item)).toHaveLength(1);
  });
});

describe("a text body (#10736)", () => {
  test.each([
    { name: "XML", body: "<ping/>" },
    { name: "form fields", body: "a=1&b=2" },
    { name: "text that reads as a JSON object", body: '{"a": 1}' },
  ])(
    "$name is kept from a probe too old to send it, its result written offline",
    async ({ body }: { name: string; body: string }) => {
      const item: Monitor = monitor([asText(apiStep(body))]);

      expect(await handOut([item], PROBE_BEFORE_ANY_BODY)).toEqual([]);

      const jobs: Array<QueuedJob> = queuedJobs();

      expect(jobs).toHaveLength(1);
      expect(readBack(jobs[0]!).isOnline).toBe(false);
      expect(readBack(jobs[0]!).failureCause).toBe(
        REQUEST_BODY_STEP_NOT_RUN_MESSAGE,
      );
    },
  );

  test("is handed to a probe that sends any body", async () => {
    const item: Monitor = monitor([asText(apiStep("<ping/>"))]);

    expect(await handOut([item], CURRENT_PROBE)).toEqual([item]);
    expect(queue.addProbeIngestJob).not.toHaveBeenCalled();
  });

  test("a text step with no body sends nothing, on any probe", async () => {
    const item: Monitor = monitor([asText(apiStep(undefined))]);

    expect(await handOut([item], PROBE_BEFORE_ANY_BODY)).toEqual([item]);
    expect(queue.addProbeIngestJob).not.toHaveBeenCalled();
  });
});

describe("a global probe", () => {
  test("is handed every step: OneUptime's own probes are current", async () => {
    probeService.findOneById.mockResolvedValue(probe(true) as never);

    const item: Monitor = monitor([apiStep("[1]")]);

    expect(await handOut([item], PROBE_BEFORE_ANY_BODY)).toEqual([item]);
    expect(stepIds(item)).toHaveLength(1);
    expect(queue.addProbeIngestJob).not.toHaveBeenCalled();
  });
});

describe("a step that needs both a one-time code and such a body", () => {
  test("on a probe older than both, says the release that runs it: the newer one", async () => {
    const item: Monitor = monitor([
      withCode(apiStep('["{{monitorSecrets.LoginCode}}"]')),
    ]);

    await handOut([item], PROBE_BEFORE_BOTH);

    expect(queuedJobs()).toHaveLength(1);
    expect(readBack(queuedJobs()[0]!).failureCause).toBe(
      REQUEST_BODY_STEP_NOT_RUN_MESSAGE,
    );
  });

  test("on a probe that makes codes but sends only objects, says the body", async () => {
    const item: Monitor = monitor([
      withCode(apiStep('["{{monitorSecrets.LoginCode}}"]')),
    ]);

    await handOut([item], PROBE_BEFORE_ANY_BODY);

    expect(readBack(queuedJobs()[0]!).failureCause).toBe(
      REQUEST_BODY_STEP_NOT_RUN_MESSAGE,
    );
  });

  test("an object body that needs a code, on a probe from before codes, says the code", async () => {
    const item: Monitor = monitor([
      withCode(apiStep('{"otp": "{{monitorSecrets.LoginCode}}"}')),
    ]);

    await handOut([item], PROBE_BEFORE_BOTH);

    expect(readBack(queuedJobs()[0]!).failureCause).toBe(
      ONE_TIME_CODE_STEP_NOT_RUN_MESSAGE,
    );
  });

  test("on a current probe, is handed out", async () => {
    const item: Monitor = monitor([
      withCode(apiStep('["{{monitorSecrets.LoginCode}}"]')),
    ]);

    expect(await handOut([item], CURRENT_PROBE)).toEqual([item]);
    expect(queue.addProbeIngestJob).not.toHaveBeenCalled();
  });
});
