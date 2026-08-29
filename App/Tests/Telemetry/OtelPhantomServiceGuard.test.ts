/*
 * Regression tests for issue #3468 - "Dozens of auto-created services
 * (pd-*, kubernetes-agent-*, etc.) have no owners and never receive any
 * telemetry data".
 *
 * The OneUptime Kubernetes agent's OTel collectors stamp an explicit
 * service.name on every infrastructure metric batch it emits
 * (`kubernetes-agent-<cluster>` by default, or a workload name via the
 * collector's transform processor). Before this fix the metrics ingest
 * honoured that stamped name, so `findOrCreateTelemetryService` synthesised a
 * Service row for every infra batch - a row that stays "Connected" via
 * lastSeenAt but never receives requests / latency / logs / errors.
 *
 * This suite pins the two new predicates that route those batches to their
 * Host / KubernetesCluster entity instead:
 *
 *   - OtelIngestBaseService.isInfraMetricBatch      - infra metric families
 *   - OtelIngestBaseService.shouldCreateServiceRow  - the phantom-service gate
 *
 * Same import strategy as Common/Tests/Server/Services/
 * OpenTelemetryResourceRetentionMemo.test.ts: PasswordHash carries a TS5.9
 * diagnostic that fails any suite whose require graph reaches DatabaseService
 * (the base class of every concrete service this module imports), so it is
 * replaced with a factory mock.
 */
jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import OtelIngestBaseService from "../../FeatureSet/Telemetry/Services/OtelIngestBaseService";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import { describe, expect, test } from "@jest/globals";

class OtelIngestBaseServiceHarness extends OtelIngestBaseService {
  public static isInfraMetricBatchPublic(
    scopeMetrics: JSONArray | undefined,
  ): boolean {
    return this.isInfraMetricBatch(scopeMetrics);
  }

  public static shouldCreateServiceRowPublic(data: {
    isInfraMetricBatch?: boolean | undefined;
    attributes: JSONArray;
  }): boolean {
    return this.shouldCreateServiceRow(data);
  }
}

function stringAttr(key: string, value: string): JSONObject {
  return { key, value: { stringValue: value } };
}

function scopeMetrics(names: Array<string>): JSONArray {
  const metrics: Array<JSONObject> = names.map((name: string) => {
    return { name };
  });
  return [
    {
      scope: {},
      metrics: metrics,
    } as unknown as JSONObject,
  ] as JSONArray;
}

describe("OtelIngestBaseService.isInfraMetricBatch", () => {
  test("flags kubeletstats k8s.* metric families", () => {
    const infra: boolean =
      OtelIngestBaseServiceHarness.isInfraMetricBatchPublic(
        scopeMetrics([
          "k8s.pod.cpu.usage",
          "k8s.node.memory.usage",
          "k8s.container.cpu.usage",
        ]),
      );
    expect(infra).toBe(true);
  });

  test("flags hostmetrics system.* and process.* families", () => {
    expect(
      OtelIngestBaseServiceHarness.isInfraMetricBatchPublic(
        scopeMetrics(["system.cpu.utilization", "system.memory.usage"]),
      ),
    ).toBe(true);
    expect(
      OtelIngestBaseServiceHarness.isInfraMetricBatchPublic(
        scopeMetrics(["process.cpu.time", "process.memory.usage"]),
      ),
    ).toBe(true);
  });

  test("does NOT flag app / Docker / OBI families", () => {
    expect(
      OtelIngestBaseServiceHarness.isInfraMetricBatchPublic(
        scopeMetrics([
          "http.server.request.duration",
          "rpc.client.duration",
          "db.client.operation.duration",
        ]),
      ),
    ).toBe(false);
    expect(
      OtelIngestBaseServiceHarness.isInfraMetricBatchPublic(
        scopeMetrics(["container.cpu.usage.seconds", "container.memory.usage"]),
      ),
    ).toBe(false);
  });

  test("returns false for empty or missing scope metrics", () => {
    expect(
      OtelIngestBaseServiceHarness.isInfraMetricBatchPublic(undefined),
    ).toBe(false);
    expect(OtelIngestBaseServiceHarness.isInfraMetricBatchPublic([])).toBe(
      false,
    );
    expect(
      OtelIngestBaseServiceHarness.isInfraMetricBatchPublic([
        { scope: {} } as unknown as JSONObject,
      ]),
    ).toBe(false);
  });
});

describe("OtelIngestBaseService.shouldCreateServiceRow (phantom-service gate)", () => {
  test("returns true when the batch was not flagged as infra metrics", () => {
    const appAttrs: JSONArray = [
      stringAttr("service.name", "my-api"),
      stringAttr("telemetry.sdk.language", "nodejs"),
    ];
    expect(
      OtelIngestBaseServiceHarness.shouldCreateServiceRowPublic({
        isInfraMetricBatch: false,
        attributes: appAttrs,
      }),
    ).toBe(true);
    // Unset flag (logs / traces / profiles paths) never triggers the gate.
    expect(
      OtelIngestBaseServiceHarness.shouldCreateServiceRowPublic({
        attributes: appAttrs,
      }),
    ).toBe(true);
  });

  test("returns true when an infra batch lacks the OneUptime agent marker", () => {
    // An app in a pod shipping k8s.* infra-looking families but no agent marker.
    const attrs: JSONArray = [
      stringAttr("service.name", "my-api"),
      stringAttr("k8s.cluster.name", "wbmonclusk8"),
      stringAttr("k8s.node.name", "node-1"),
      stringAttr("telemetry.sdk.language", "nodejs"),
    ];
    expect(
      OtelIngestBaseServiceHarness.shouldCreateServiceRowPublic({
        isInfraMetricBatch: true,
        attributes: attrs,
      }),
    ).toBe(true);
  });

  test("returns true when an infra agent batch has no host/k8s resource signal", () => {
    const attrs: JSONArray = [
      stringAttr("service.name", "kubernetes-agent-edge"),
      stringAttr("oneuptime.agent.version", "1.0.0"),
    ];
    expect(
      OtelIngestBaseServiceHarness.shouldCreateServiceRowPublic({
        isInfraMetricBatch: true,
        attributes: attrs,
      }),
    ).toBe(true);
  });

  test("THE BUG - returns false for a OneUptime agent kubeletstats batch (issue #3468)", () => {
    /*
     * configmap-daemonset.yaml stamps service.name = "kubernetes-agent-<cluster>"
     * (upsert) on every kubeletstats / hostmetrics batch, plus k8s.cluster.name
     * and oneuptime.agent.version; k8sattributes adds k8s.node.name.
     */
    const attrs: JSONArray = [
      stringAttr("service.name", "kubernetes-agent-wbmonclusk8"),
      stringAttr("k8s.cluster.name", "wbmonclusk8"),
      stringAttr("k8s.node.name", "aks-wbmon-12345678-vmss000001"),
      stringAttr("k8s.pod.name", "kubernetes-agent-wbmonclusk8-abc12"),
      stringAttr("k8s.namespace.name", "oneuptime"),
      stringAttr("oneuptime.agent.version", "1.0.0"),
    ];
    expect(
      OtelIngestBaseServiceHarness.shouldCreateServiceRowPublic({
        isInfraMetricBatch: true,
        attributes: attrs,
      }),
    ).toBe(false);
  });

  test("THE BUG - returns false for a workload-named kubeletstats batch (issue #3468)", () => {
    /*
     * configmap-daemonset.yaml's transform processor overwrites service.name
     * with the deployment name while the metric families stay k8s.* infra.
     */
    const attrs: JSONArray = [
      stringAttr("service.name", "pd-jas"),
      stringAttr("k8s.cluster.name", "wbmonclusk8"),
      stringAttr("k8s.namespace.name", "prod"),
      stringAttr("k8s.deployment.name", "pd-jas"),
      stringAttr("k8s.pod.name", "pd-jas-8098-abcde"),
      stringAttr("k8s.node.name", "aks-wbmon-12345678-vmss000001"),
      stringAttr("oneuptime.agent.version", "1.0.0"),
    ];
    expect(
      OtelIngestBaseServiceHarness.shouldCreateServiceRowPublic({
        isInfraMetricBatch: true,
        attributes: attrs,
      }),
    ).toBe(false);
  });

  test("OBI RED metrics keep their Service row (non-infra families)", () => {
    const attrs: JSONArray = [
      stringAttr("service.name", "pd-jas-8098"),
      stringAttr("k8s.cluster.name", "wbmonclusk8"),
      stringAttr("k8s.namespace.name", "prod"),
      stringAttr("k8s.pod.name", "pd-jas-8098-abcde"),
      stringAttr("oneuptime.agent.version", "1.0.0"),
    ];
    // http.* families are NOT infra, so the metrics path does not flag them.
    expect(
      OtelIngestBaseServiceHarness.shouldCreateServiceRowPublic({
        isInfraMetricBatch: false,
        attributes: attrs,
      }),
    ).toBe(true);
  });

  test("control cases from the reproduction remain intact", () => {
    /*
     * OneUptime agent hostmetrics batch (system.* families) - flagged infra,
     * agent marker present, host signal present => no Service row.
     */
    const hostAttrs: JSONArray = [
      stringAttr("os.type", "linux"),
      stringAttr("host.name", "web-1.internal"),
      stringAttr("oneuptime.agent.version", "1.0.0"),
    ];
    expect(
      OtelIngestBaseServiceHarness.shouldCreateServiceRowPublic({
        isInfraMetricBatch: true,
        attributes: hostAttrs,
      }),
    ).toBe(false);

    // Genuine app SDK batch - must still back a Service row.
    const appAttrs: JSONArray = [
      stringAttr("service.name", "my-api"),
      stringAttr("telemetry.sdk.language", "nodejs"),
    ];
    expect(
      OtelIngestBaseServiceHarness.shouldCreateServiceRowPublic({
        isInfraMetricBatch: false,
        attributes: appAttrs,
      }),
    ).toBe(true);
  });
});
