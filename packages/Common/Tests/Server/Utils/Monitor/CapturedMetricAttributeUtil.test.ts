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
import { MONITOR_STEP_ID_ATTRIBUTE } from "../../../../Types/Monitor/MonitorStepSeries";
import { readOwnValue } from "../../../../Utils/LookupTable";
import { INHERITED_PROPERTY_NAMES } from "../../../Helpers/InheritedNames";
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
        "monitorStepId",
        "isCustomMetric",
      ]) {
        expect(CapturedMetricAttributeUtil.isReservedAttributeKey(key)).toBe(
          true,
        );
      }
    });

    test("refuses the step every row of a check is stamped with, by its one name (#10906)", () => {
      // A script that wrote it could file its datapoints under another step.
      expect(
        CapturedMetricAttributeUtil.isReservedAttributeKey(
          MONITOR_STEP_ID_ATTRIBUTE,
        ),
      ).toBe(true);
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
          "vmware.vcenter.name": "vcsa",
          "ceph.cluster.name": "ceph",
          "docker.swarm.cluster.name": "swarm",
          keep: "yes",
        });

      expect(result.attributes).toEqual({ keep: "yes" });
      expect(result.droppedReservedKeys).toHaveLength(8);
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

  /*
   * Issue #8136. `sanitize` kept the first of two keys that trim to one name
   * with a plain read of the attributes it had kept so far, a plain object.
   * For a name every object inherits, that read found the inherited method,
   * so the attribute was skipped. Not being reserved, it was not reported
   * either: `{ toString: "x", region: "eu" }` came back as `{ region: "eu" }`
   * with nothing dropped.
   */
  describe("attributes named like what every object inherits (issue #8136)", () => {
    const isReserved: (name: string) => boolean = (name: string): boolean => {
      return CapturedMetricAttributeUtil.isReservedAttributeKey(name);
    };

    const REFUSED: Array<string> = INHERITED_PROPERTY_NAMES.filter(isReserved);

    const KEPT: Array<string> = INHERITED_PROPERTY_NAMES.filter(
      (name: string): boolean => {
        return !isReserved(name);
      },
    );

    // A script's attributes, as the sandbox hands them over: JSON.
    const fromScript: (json: string) => JSONObject = (
      json: string,
    ): JSONObject => {
      return JSON.parse(json) as JSONObject;
    };

    test("only the names that walk the prototype are refused; toString, valueOf and the rest are ordinary dimensions", () => {
      expect(REFUSED).toEqual(["__proto__", "constructor"]);
      expect(KEPT).toEqual(
        expect.arrayContaining([
          "toString",
          "valueOf",
          "hasOwnProperty",
          "isPrototypeOf",
          "propertyIsEnumerable",
          "toLocaleString",
          "__defineGetter__",
          "__defineSetter__",
          "__lookupGetter__",
          "__lookupSetter__",
        ]),
      );
      expect(KEPT).toHaveLength(INHERITED_PROPERTY_NAMES.length - 2);
    });

    test("the issue's example keeps toString beside region", () => {
      expect(
        CapturedMetricAttributeUtil.sanitize(
          fromScript('{"toString":"x","region":"eu"}'),
        ),
      ).toEqual({
        attributes: { toString: "x", region: "eu" },
        droppedReservedKeys: [],
      });
    });

    test.each(KEPT)(
      "an attribute named %s is kept with its own value, and nothing is reported dropped",
      (name: string) => {
        const result: SanitizedCapturedMetricAttributes =
          CapturedMetricAttributeUtil.sanitize(
            fromScript(JSON.stringify({ [name]: `own ${name}`, region: "eu" })),
          );

        expect(readOwnValue(result.attributes, name)).toBe(`own ${name}`);
        expect(Object.keys(result.attributes)).toEqual([name, "region"]);
        expect(result.droppedReservedKeys).toEqual([]);
      },
    );

    test.each(KEPT)(
      "%s: of two keys that trim to it, the first is kept, in either order",
      (name: string) => {
        for (const [first, second] of [
          [name, `  ${name}  `],
          [` ${name}`, name],
        ] as Array<[string, string]>) {
          const result: SanitizedCapturedMetricAttributes =
            CapturedMetricAttributeUtil.sanitize(
              fromScript(
                JSON.stringify({ [first]: "first", [second]: "second" }),
              ),
            );

          expect(Object.keys(result.attributes)).toEqual([name]);
          expect(readOwnValue(result.attributes, name)).toBe("first");
        }
      },
    );

    test.each(KEPT)(
      "%s: a number or a boolean is kept as its text",
      (name: string) => {
        for (const [value, text] of [
          [3, "3"],
          [0, "0"],
          [true, "true"],
          [false, "false"],
        ] as Array<[number | boolean, string]>) {
          const result: SanitizedCapturedMetricAttributes =
            CapturedMetricAttributeUtil.sanitize(
              fromScript(JSON.stringify({ [name]: value })),
            );

          expect(readOwnValue(result.attributes, name)).toBe(text);
        }
      },
    );

    test("every such name at once is kept, in the script's order, and serialises as written", () => {
      const sent: JSONObject = {};

      for (const name of KEPT) {
        sent[name] = `own ${name}`;
      }

      const result: SanitizedCapturedMetricAttributes =
        CapturedMetricAttributeUtil.sanitize(fromScript(JSON.stringify(sent)));

      expect(Object.keys(result.attributes)).toEqual(KEPT);
      expect(JSON.stringify(result.attributes)).toBe(JSON.stringify(sent));
      expect(result.droppedReservedKeys).toEqual([]);
    });

    test("__proto__, constructor and prototype stay refused, and are named in droppedReservedKeys, beside a kept toString", () => {
      const result: SanitizedCapturedMetricAttributes =
        CapturedMetricAttributeUtil.sanitize(
          fromScript(
            '{"__proto__":"a","constructor":"b","prototype":"c"," constructor ":"d","a.constructor.b":"e","toString":"f"}',
          ),
        );

      expect(Object.keys(result.attributes)).toEqual(["toString"]);
      expect(readOwnValue(result.attributes, "toString")).toBe("f");
      expect(result.droppedReservedKeys).toEqual([
        "__proto__",
        "constructor",
        "prototype",
        "a.constructor.b",
      ]);
      expect(Object.getPrototypeOf(result.attributes)).toBe(Object.prototype);
    });

    test("a name an object inherits counts towards the cap like any other", () => {
      const sent: JSONObject = {};

      for (let i: number = 0; i < MaxCapturedMetricAttributes - 1; i++) {
        sent[`key${i}`] = "value";
      }

      sent["toString"] = "the last one kept";
      sent["valueOf"] = "over the cap";

      const result: SanitizedCapturedMetricAttributes =
        CapturedMetricAttributeUtil.sanitize(fromScript(JSON.stringify(sent)));

      expect(Object.keys(result.attributes)).toHaveLength(
        MaxCapturedMetricAttributes,
      );
      expect(readOwnValue(result.attributes, "toString")).toBe(
        "the last one kept",
      );
      expect(readOwnValue(result.attributes, "valueOf")).toBeUndefined();
    });
  });
});
