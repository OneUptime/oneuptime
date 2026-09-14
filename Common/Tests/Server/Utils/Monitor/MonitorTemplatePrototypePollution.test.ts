import MonitorTemplateUtil from "../../../../Server/Utils/Monitor/MonitorTemplateUtil";
import { JSONObject } from "../../../../Types/JSON";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * A grouped metric monitor renders its incident/alert title per series, and
 * the series' labels are folded onto the template storage map so
 * `{{host.name}}` resolves as a nested path. The fold therefore walks
 * attacker-adjacent input: series label keys are whatever attribute names the
 * emitting telemetry chose, and for a custom code or synthetic monitor a
 * script picks them outright via `oneuptime.captureMetric()`.
 *
 * A key of `__proto__.polluted` used to aim that walk at Object.prototype —
 * `storageMap["__proto__"]` is truthy, an object and not an Array, so the
 * "reset to a fresh object" branch was skipped and the final assignment landed
 * on the prototype itself. This runs in the shared Workers process that
 * renders every project's templates, so one series label polluted every object
 * in it.
 */
describe("MonitorTemplateUtil series label fold", () => {
  const monitorId: ObjectID = new ObjectID(
    "22222222-2222-4222-8222-222222222222",
  );

  function buildStorageMap(seriesLabels: JSONObject): JSONObject {
    return MonitorTemplateUtil.buildTemplateStorageMap({
      monitorType: MonitorType.Metrics,
      dataToProcess: {
        monitorId: monitorId,
        projectId: new ObjectID("11111111-1111-4111-8111-111111111111"),
      } as unknown as ProbeMonitorResponse,
      seriesLabels: seriesLabels,
    });
  }

  afterEach(() => {
    // Never leave a polluted prototype behind for the rest of the suite.
    delete (Object.prototype as unknown as JSONObject)["polluted"];
  });

  test("does not pollute Object.prototype through a __proto__ segment", () => {
    buildStorageMap({ "__proto__.polluted": "pwned" });

    expect(({} as JSONObject)["polluted"]).toBeUndefined();
    expect(
      (Object.prototype as unknown as JSONObject)["polluted"],
    ).toBeUndefined();
  });

  test("does not pollute Object.prototype through a constructor.prototype segment", () => {
    buildStorageMap({ "constructor.prototype.polluted": "pwned" });

    expect(({} as JSONObject)["polluted"]).toBeUndefined();
  });

  test("does not pollute through a __proto__ segment buried mid-path", () => {
    buildStorageMap({ "host.__proto__.polluted": "pwned" });

    expect(({} as JSONObject)["polluted"]).toBeUndefined();
  });

  test("still exposes a refused label under seriesLabels, so nothing is lost", () => {
    const storageMap: JSONObject = buildStorageMap({
      "__proto__.polluted": "pwned",
      "host.name": "web-01",
    });

    const seriesLabels: JSONObject = storageMap["seriesLabels"] as JSONObject;

    expect(seriesLabels["__proto__.polluted"]).toBe("pwned");
    expect(seriesLabels["host.name"]).toBe("web-01");
  });

  test("still folds ordinary dotted labels into nested paths", () => {
    const storageMap: JSONObject = buildStorageMap({
      "host.name": "web-01",
      "k8s.pod.name": "checkout-abc",
      region: "us-east-1",
    });

    expect((storageMap["host"] as JSONObject)["name"]).toBe("web-01");
    expect(
      ((storageMap["k8s"] as JSONObject)["pod"] as JSONObject)["name"],
    ).toBe("checkout-abc");
    expect(storageMap["region"]).toBe("us-east-1");
  });

  test("renders a template against a folded label, with the refused one inert", () => {
    const storageMap: JSONObject = buildStorageMap({
      "host.name": "web-01",
      "__proto__.polluted": "pwned",
    });

    expect(
      MonitorTemplateUtil.processTemplateString({
        value: "Host {{host.name}} is down",
        storageMap: storageMap,
      }),
    ).toBe("Host web-01 is down");

    expect(({} as JSONObject)["polluted"]).toBeUndefined();
  });
});
