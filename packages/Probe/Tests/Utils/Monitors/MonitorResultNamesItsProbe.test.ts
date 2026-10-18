process.env["ONEUPTIME_URL"] = "https://oneuptime.example.com";
process.env["PROBE_KEY"] = "test-probe-key";
process.env["PROBE_ID"] = "2b4d6f8a-0c1e-4a3c-9e5b-7d9f1b3d5f70";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import MonitorUtil from "../../../Utils/Monitors/Monitor";
import ProbeAPIRequest from "../../../Utils/ProbeAPIRequest";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorTest from "Common/Models/DatabaseModels/MonitorTest";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";
import logger from "Common/Server/Utils/Logger";

/*
 * A probe's results name the probe that sends them.
 *
 * OneUptime records a check result as the result of the probe that
 * authenticated the request (the body's top-level probeId and probeKey),
 * and refuses one whose own probeId names a different probe. So every
 * result this probe posts - a check it ran, a check that threw, a monitor
 * test - carries exactly the id it authenticates with, on the wire as JSON
 * writes it. A probe build that broke this would have every result refused.
 */

const PROBE_ID: string = "2b4d6f8a-0c1e-4a3c-9e5b-7d9f1b3d5f70";

// A step with nothing to check: the probe reports it without any network.
function makeMonitor(): Monitor {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.setMonitorStepsInstanceArray([new MonitorStep()]);

  return {
    id: ObjectID.generate(),
    projectId: ObjectID.generate(),
    monitorType: MonitorType.Website,
    monitorSteps,
  } as Monitor;
}

// eslint-disable-next-line @typescript-eslint/typedef
let fetchSpy = jest.spyOn(API, "fetch");

beforeEach(() => {
  fetchSpy = jest.spyOn(API, "fetch").mockResolvedValue({ data: {} } as never);
  jest.spyOn(logger, "debug").mockImplementation(() => {});
  jest.spyOn(logger, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// What the probe put on the wire for its n-th post.
function posted(index: number): JSONObject {
  const data: unknown = fetchSpy.mock.calls[index]![0].data;
  return JSON.parse(JSON.stringify(data)) as JSONObject;
}

function expectNamesItself(body: JSONObject): void {
  // Authenticated as this probe...
  expect(body["probeId"]).toBe(PROBE_ID);
  expect(body["probeKey"]).toBe("test-probe-key");

  // ...and the result inside names the same probe.
  expect((body["probeMonitorResponse"] as JSONObject)["probeId"]).toEqual({
    _type: "ObjectID",
    value: PROBE_ID,
  });
}

describe("a probe's results name the probe that sends them", () => {
  test("the id it authenticates with is its own", () => {
    expect(ProbeAPIRequest.getDefaultRequestBody()["probeId"]).toBe(PROBE_ID);
  });

  test("a check it ran", async () => {
    await MonitorUtil.probeMonitor(makeMonitor());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]![0].url.toString()).toBe(
      "https://oneuptime.example.com/probe-ingest/probe/response/ingest",
    );
    expectNamesItself(posted(0));
  });

  test("a check that threw is still reported as this probe's", async () => {
    jest
      .spyOn(MonitorUtil, "probeMonitorStep")
      .mockRejectedValue(new Error("boom") as never);

    await MonitorUtil.probeMonitor(makeMonitor());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expectNamesItself(posted(0));
    expect((posted(0)["probeMonitorResponse"] as JSONObject)["isOnline"]).toBe(
      false,
    );
  });

  test("a monitor test it ran", async () => {
    const monitor: Monitor = makeMonitor();

    await MonitorUtil.probeMonitorTest(monitor as unknown as MonitorTest);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]![0].url.toString()).toBe(
      `https://oneuptime.example.com/probe-ingest/probe/response/monitor-test-ingest/${monitor.id!.toString()}`,
    );
    expectNamesItself(posted(0));
  });
});
