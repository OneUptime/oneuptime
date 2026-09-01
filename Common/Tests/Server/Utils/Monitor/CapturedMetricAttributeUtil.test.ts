import CapturedMetricAttributeUtil, {
  MaxCapturedMetricAttributes,
  MaxCapturedMetricAttributeKeyLength,
  MaxCapturedMetricAttributeValueLength,
  SanitizedCapturedMetricAttributes,
} from "../../../../Server/Utils/Monitor/CapturedMetricAttributeUtil";
import {
  AllResourceIdentityLabelKeys,
  ServiceNameLabelKeys,
} from "../../../../Server/Utils/Monitor/SeriesResourceLabels";
import { JSONObject } from "../../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * The guard in front of the ONE metric writer whose attribute KEYS are user
 * input: `oneuptime.captureMetric(name, value, attributes)` inside a custom
 * code or synthetic monitor script.
 *
 * The stakes are not cosmetic. An attribute such as `service.name` is read
 * back as a claim about which resource the datapoint describes: Service >
 * Metrics scopes its charts by the raw `resource.service.name` string, and
 * once any metric monitor groups by one of these keys it becomes a series
 * label, from where SeriesResourceLinker attaches the named Service to the
 * alerts and incidents that series opens, AlertOwnerRuleEngineService pages
 * that Service's owners, and MonitorMaintenanceSuppression silences the series
 * for the duration of a maintenance window on it.
 */
describe("CapturedMetricAttributeUtil", () => {
  describe("isReservedAttributeKey", () => {
    test("refuses every key the series-label resolver treats as resource identity", () => {
      // Derived from the read side so the two can never disagree.
      for (const key of AllResourceIdentityLabelKeys) {
        expect(CapturedMetricAttributeUtil.isReservedAttributeKey(key)).toBe(
          true,
        );
      }
    });

    test("refuses the monitor's own identity attributes", () => {
      for (const key of [
        "monitorId",
        "projectId",
        "monitorName",
        "probeName",
        "probeId",
        "isCustomMetric",
      ]) {
        expect(CapturedMetricAttributeUtil.isReservedAttributeKey(key)).toBe(
          true,
        );
      }
    });

    test("refuses the whole oneuptime.* namespace, not just the keys that collide today", () => {
      for (const key of [
        "oneuptime.service.id",
        "oneuptime.host.name",
        "oneuptime.label.product",
        "oneuptime.customField.team",
        "oneuptime.something.invented.later",
      ]) {
        expect(CapturedMetricAttributeUtil.isReservedAttributeKey(key)).toBe(
          true,
        );
      }
    });

    test("refuses the whole resource.* namespace — a monitor metric has no OTel resource", () => {
      for (const key of [
        "resource.service.name",
        "resource.host.name",
        "resource.telemetry.sdk.language",
        "resource.anything",
      ]) {
        expect(CapturedMetricAttributeUtil.isReservedAttributeKey(key)).toBe(
          true,
        );
      }
    });

    test("refuses dotted keys whose segments would walk the object prototype", () => {
      for (const key of [
        "__proto__",
        "__proto__.polluted",
        "constructor.prototype.polluted",
        "a.__proto__.b",
        "prototype",
      ]) {
        expect(CapturedMetricAttributeUtil.isReservedAttributeKey(key)).toBe(
          true,
        );
      }
    });

    test("allows ordinary script-chosen dimensions", () => {
      for (const key of [
        "region",
        "environment",
        "ai.tool",
        "cursor.team.id",
        "queue",
        "service_name",
        "myservice.name",
        "serviceName",
      ]) {
        expect(CapturedMetricAttributeUtil.isReservedAttributeKey(key)).toBe(
          false,
        );
      }
    });
  });

  describe("sanitize", () => {
    test("keeps ordinary attributes untouched", () => {
      const result: SanitizedCapturedMetricAttributes =
        CapturedMetricAttributeUtil.sanitize({
          region: "us-east-1",
          environment: "production",
          "ai.tool": "cursor",
        });

      expect(result.attributes).toEqual({
        region: "us-east-1",
        environment: "production",
        "ai.tool": "cursor",
      });
      expect(result.droppedReservedKeys).toEqual([]);
    });

    test("drops every resource-identity spelling of service.name and reports it", () => {
      const attributes: JSONObject = {};
      for (const key of ServiceNameLabelKeys) {
        attributes[key] = "payments-api";
      }
      attributes["region"] = "us-east-1";

      const result: SanitizedCapturedMetricAttributes =
        CapturedMetricAttributeUtil.sanitize(attributes);

      expect(result.attributes).toEqual({ region: "us-east-1" });
      expect(result.droppedReservedKeys.sort()).toEqual(
        [...ServiceNameLabelKeys].sort(),
      );
    });

    test("drops the host, kubernetes, iot and cluster identity keys too", () => {
      const result: SanitizedCapturedMetricAttributes =
        CapturedMetricAttributeUtil.sanitize({
          "host.name": "web-01",
          "oneuptime.host.id": "9c3a0c3e-0000-4000-8000-000000000001",
          "k8s.cluster.name": "prod",
          "iot.fleet.name": "fleet-a",
          "proxmox.cluster.name": "pve",
          "ceph.cluster.name": "ceph",
          "docker.swarm.cluster.name": "swarm",
          keep: "yes",
        });

      expect(result.attributes).toEqual({ keep: "yes" });
      expect(result.droppedReservedKeys).toHaveLength(7);
    });

    test("records numbers and booleans as text instead of dropping them", () => {
      const result: SanitizedCapturedMetricAttributes =
        CapturedMetricAttributeUtil.sanitize({
          shard: 3,
          ratio: 0.5,
          negative: -1,
          zero: 0,
          primary: true,
          replica: false,
        });

      expect(result.attributes).toEqual({
        shard: "3",
        ratio: "0.5",
        negative: "-1",
        zero: "0",
        primary: "true",
        replica: "false",
      });
    });

    test("drops values with no usable string form", () => {
      const result: SanitizedCapturedMetricAttributes =
        CapturedMetricAttributeUtil.sanitize({
          nested: { a: 1 },
          list: [1, 2],
          nothing: null,
          notANumber: Number.NaN,
          unbounded: Number.POSITIVE_INFINITY,
          kept: "yes",
        } as unknown as JSONObject);

      expect(result.attributes).toEqual({ kept: "yes" });
    });

    test("drops empty and whitespace-only keys, which no filter could ever select", () => {
      const result: SanitizedCapturedMetricAttributes =
        CapturedMetricAttributeUtil.sanitize({
          "": "a",
          "   ": "b",
          ok: "c",
        });

      expect(result.attributes).toEqual({ ok: "c" });
    });

    test("trims keys, so a padded spelling cannot slip past the reserved list", () => {
      const result: SanitizedCapturedMetricAttributes =
        CapturedMetricAttributeUtil.sanitize({
          "  service.name  ": "payments-api",
          "  region  ": "us-east-1",
        });

      expect(result.attributes).toEqual({ region: "us-east-1" });
      expect(result.droppedReservedKeys).toEqual(["service.name"]);
    });

    test("first key wins when two keys collide after trimming", () => {
      const result: SanitizedCapturedMetricAttributes =
        CapturedMetricAttributeUtil.sanitize({
          region: "first",
          " region": "second",
        });

      expect(result.attributes).toEqual({ region: "first" });
    });

    test("caps the attribute count, key length and value length", () => {
      const attributes: JSONObject = {};
      for (let i: number = 0; i < MaxCapturedMetricAttributes + 25; i++) {
        attributes[`key${i}`] = "value";
      }
      attributes["x".repeat(MaxCapturedMetricAttributeKeyLength + 50)] = "y";

      const result: SanitizedCapturedMetricAttributes =
        CapturedMetricAttributeUtil.sanitize(attributes);

      expect(Object.keys(result.attributes)).toHaveLength(
        MaxCapturedMetricAttributes,
      );

      const longValue: SanitizedCapturedMetricAttributes =
        CapturedMetricAttributeUtil.sanitize({
          long: "z".repeat(MaxCapturedMetricAttributeValueLength + 100),
        });

      expect((longValue.attributes["long"] as string).length).toBe(
        MaxCapturedMetricAttributeValueLength,
      );

      const longKey: SanitizedCapturedMetricAttributes =
        CapturedMetricAttributeUtil.sanitize({
          ["k".repeat(MaxCapturedMetricAttributeKeyLength + 100)]: "v",
        });

      expect(Object.keys(longKey.attributes)[0]!.length).toBe(
        MaxCapturedMetricAttributeKeyLength,
      );
    });

    test("returns an empty set for absent or non-object attributes", () => {
      expect(
        CapturedMetricAttributeUtil.sanitize(undefined).attributes,
      ).toEqual({});
      expect(CapturedMetricAttributeUtil.sanitize(null).attributes).toEqual({});
      expect(
        CapturedMetricAttributeUtil.sanitize(
          "not an object" as unknown as JSONObject,
        ).attributes,
      ).toEqual({});
    });

    test("does not pollute Object.prototype through a __proto__ key", () => {
      CapturedMetricAttributeUtil.sanitize({
        __proto__: "pwned",
        "__proto__.polluted": "pwned",
      } as unknown as JSONObject);

      expect(({} as JSONObject)["polluted"]).toBeUndefined();
    });
  });
});
