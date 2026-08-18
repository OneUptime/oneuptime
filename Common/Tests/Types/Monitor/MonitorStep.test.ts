import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import DomainLookupMethod from "../../../Types/Monitor/DomainMonitor/DomainLookupMethod";
import ObjectID from "../../../Types/ObjectID";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import { JSONObject, ObjectType } from "../../../Types/JSON";

/*
 * MonitorStep is the per-step config of a monitor (destination, request shape,
 * TLS material, per-protocol sub-configs and the nested MonitorCriteria).
 * These tests focus on the parts with real branching logic: getValidationError
 * (which is monitor-type dependent), the factory defaults, clone, the id
 * accessor, the fluent request setters and the toJSON/fromJSON round-trip.
 */

const DEFAULT_ARG: {
  monitorName: string;
  monitorType: MonitorType;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
} = {
  monitorName: "Web",
  monitorType: MonitorType.Manual,
  onlineMonitorStatusId: new ObjectID("100000000000000000000021"),
  offlineMonitorStatusId: new ObjectID("100000000000000000000022"),
  defaultIncidentSeverityId: new ObjectID("100000000000000000000023"),
  defaultAlertSeverityId: new ObjectID("100000000000000000000024"),
};

describe("MonitorStep", () => {
  describe("getNewMonitorStepAsJSON", () => {
    test("carries a fresh id, GET request type and nested criteria", () => {
      const json: JSONObject = MonitorStep.getNewMonitorStepAsJSON();
      expect(json["_type"]).toBe(ObjectType.MonitorStep);
      const value: JSONObject = json["value"] as JSONObject;
      expect(typeof value["id"]).toBe("string");
      expect(value["requestType"]).toBe(HTTPMethod.GET);
      expect(value["monitorCriteria"]).toBeDefined();
    });
  });

  describe("getDefaultMonitorStep", () => {
    test("populates a fresh id, GET request type and nested criteria", () => {
      const step: MonitorStep = MonitorStep.getDefaultMonitorStep(DEFAULT_ARG);
      expect(typeof step.data?.id).toBe("string");
      expect(step.data?.id?.length).toBeGreaterThan(0);
      expect(step.data?.requestType).toBe(HTTPMethod.GET);
      expect(step.data?.monitorCriteria).toBeDefined();
      // The default destination is left for the user to fill in.
      expect(step.data?.monitorDestination).toBeUndefined();
    });
  });

  describe("getValidationError", () => {
    test("errors when data is missing", () => {
      const step: MonitorStep = new MonitorStep();
      step.data = undefined;
      expect(MonitorStep.getValidationError(step, MonitorType.Ping)).toBe(
        "Monitor Step is required.",
      );
    });

    test("requires a destination for a Ping monitor", () => {
      // A default Ping step leaves monitorDestination undefined.
      const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
        ...DEFAULT_ARG,
        monitorType: MonitorType.Ping,
      });
      expect(MonitorStep.getValidationError(step, MonitorType.Ping)).toBe(
        "Monitor Destination is required.",
      );
    });

    test("requires a port for a Port monitor that has a destination", () => {
      const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
        ...DEFAULT_ARG,
        monitorType: MonitorType.Port,
      });
      /*
       * Give it a destination so we exercise the missing-port branch, not the
       * missing-destination branch that precedes it.
       */
      step.data!.monitorDestination = {
        toJSON: () => {
          return "1.2.3.4";
        },
      } as never;
      expect(MonitorStep.getValidationError(step, MonitorType.Port)).toBe(
        "Port is required",
      );
    });

    test("rejects a client certificate without its key on an API monitor", () => {
      const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
        ...DEFAULT_ARG,
        monitorType: MonitorType.API,
      });
      step.data!.monitorDestination = {
        toJSON: () => {
          return "https://x";
        },
      } as never;
      step.data!.requestType = HTTPMethod.GET;
      step.data!.tlsClientCertificate = "----CERT----";
      step.data!.tlsClientKey = undefined;
      expect(MonitorStep.getValidationError(step, MonitorType.API)).toBe(
        "Client private key is required when a client certificate is provided",
      );
    });

    test("rejects a client key without its certificate on an API monitor", () => {
      const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
        ...DEFAULT_ARG,
        monitorType: MonitorType.API,
      });
      step.data!.monitorDestination = {
        toJSON: () => {
          return "https://x";
        },
      } as never;
      step.data!.requestType = HTTPMethod.GET;
      step.data!.tlsClientCertificate = undefined;
      step.data!.tlsClientKey = "----KEY----";
      expect(MonitorStep.getValidationError(step, MonitorType.API)).toBe(
        "Client certificate is required when a client private key is provided",
      );
    });
  });

  describe("id accessor", () => {
    test("get/set round-trips through the underlying string", () => {
      const step: MonitorStep = new MonitorStep();
      const newId: ObjectID = new ObjectID("100000000000000000000099");
      step.id = newId;
      expect(step.data?.id).toBe("100000000000000000000099");
      expect(step.id.toString()).toBe("100000000000000000000099");
    });
  });

  describe("request setters", () => {
    test("chain and mutate the request config", () => {
      const step: MonitorStep = new MonitorStep()
        .setRequestType(HTTPMethod.POST)
        .setRequestHeaders({ "x-test": "1" })
        .setRequestBody('{"a":1}');
      expect(step.data?.requestType).toBe(HTTPMethod.POST);
      expect(step.data?.requestHeaders).toEqual({ "x-test": "1" });
      expect(step.data?.requestBody).toBe('{"a":1}');
    });
  });

  describe("toJSON / fromJSON / clone", () => {
    test("serializes with the MonitorStep type wrapper", () => {
      const step: MonitorStep = MonitorStep.getDefaultMonitorStep(DEFAULT_ARG);
      expect(step.toJSON()["_type"]).toBe(ObjectType.MonitorStep);
    });

    test("round-trips the step id", () => {
      const step: MonitorStep = MonitorStep.getDefaultMonitorStep(DEFAULT_ARG);
      const originalId: string | undefined = step.data?.id;
      const restored: MonitorStep = MonitorStep.fromJSON(step.toJSON());
      expect(restored.data?.id).toBe(originalId);
    });

    test("clone is an independent copy", () => {
      const step: MonitorStep = MonitorStep.getDefaultMonitorStep(DEFAULT_ARG);
      const cloned: MonitorStep = MonitorStep.clone(step);
      expect(cloned).not.toBe(step);
      expect(cloned.data?.id).toBe(step.data?.id);

      cloned.setRequestType(HTTPMethod.DELETE);
      // Mutating the clone must not touch the original.
      expect(step.data?.requestType).not.toBe(HTTPMethod.DELETE);
    });

    test("toString produces JSON that parses back to a MonitorStep wrapper", () => {
      const step: MonitorStep = MonitorStep.getDefaultMonitorStep(DEFAULT_ARG);
      const parsed: JSONObject = JSON.parse(step.toString()) as JSONObject;
      expect(parsed["_type"]).toBe(ObjectType.MonitorStep);
    });

    /*
     * Domain monitors saved before the lookupMethod option existed carry no
     * such key. fromJSON has to fill it in, because the probe reads the
     * deserialized config directly and its type says the field is present.
     */
    function restoreWithDomainMonitor(domainMonitor: JSONObject): JSONObject {
      const json: JSONObject =
        MonitorStep.getDefaultMonitorStep(DEFAULT_ARG).toJSON();

      (json["value"] as JSONObject)["domainMonitor"] = domainMonitor;

      return MonitorStep.fromJSON(json).data
        ?.domainMonitor as unknown as JSONObject;
    }

    test("fills in the domain monitor lookup method for a step saved without one", () => {
      const domainMonitor: JSONObject = restoreWithDomainMonitor({
        domainName: "identity.digital",
        timeout: 10000,
        retries: 3,
      });

      expect(domainMonitor["domainName"]).toBe("identity.digital");
      expect(domainMonitor["lookupMethod"]).toBe(DomainLookupMethod.Auto);
    });

    test("preserves an explicitly chosen domain monitor lookup method", () => {
      const domainMonitor: JSONObject = restoreWithDomainMonitor({
        domainName: "identity.digital",
        lookupMethod: DomainLookupMethod.WHOIS,
        timeout: 10000,
        retries: 3,
      });

      expect(domainMonitor["lookupMethod"]).toBe(DomainLookupMethod.WHOIS);
    });
  });

  /*
   * Regression suite for https://github.com/OneUptime/oneuptime/issues/3225.
   *
   * fromJSON normalizes metricMonitor and domainMonitor through their
   * Util.fromJSON/toJSON pair, each with a comment explaining that the probe
   * would otherwise receive a config that does not satisfy its own type.
   * dnssecMonitor was a raw passthrough.
   *
   * A DNSSEC config authored through the API, Terraform or an imported
   * template need not carry `resolvers`, and the probe iterates that list
   * without a guard - so it threw a TypeError BEFORE posting any result. The
   * monitor produced nothing at all, on every cycle, with no status change
   * and no error the user could see: the same silent-failure class the issue
   * reports for SSL Certificate monitors.
   */
  describe("dnssecMonitor normalization (issue #3225)", () => {
    /*
     * Built from a real default step for the same reason the domainMonitor
     * tests above are: fromJSON validates the whole envelope, so a hand-rolled
     * fragment would fail for reasons unrelated to what is under test.
     */
    function restoreWithDnssecMonitor(
      dnssecMonitor: JSONObject | undefined,
    ): JSONObject | undefined {
      const json: JSONObject =
        MonitorStep.getDefaultMonitorStep(DEFAULT_ARG).toJSON();

      if (dnssecMonitor) {
        (json["value"] as JSONObject)["dnssecMonitor"] = dnssecMonitor;
      }

      return MonitorStep.fromJSON(json).data?.dnssecMonitor as unknown as
        | JSONObject
        | undefined;
    }

    test("back-fills resolvers when the stored config has none", () => {
      const dnssec: JSONObject | undefined = restoreWithDnssecMonitor({
        domainName: "oneuptime.com",
      });

      expect(dnssec?.["resolvers"]).toEqual(["1.1.1.1", "8.8.8.8", "9.9.9.9"]);
    });

    test("back-fills resolvers when the stored list is empty", () => {
      const dnssec: JSONObject | undefined = restoreWithDnssecMonitor({
        domainName: "oneuptime.com",
        resolvers: [],
      });

      expect((dnssec?.["resolvers"] as Array<string>).length).toBeGreaterThan(
        0,
      );
    });

    test("preserves resolvers the caller actually supplied", () => {
      const dnssec: JSONObject | undefined = restoreWithDnssecMonitor({
        domainName: "oneuptime.com",
        resolvers: ["9.9.9.9"],
      });

      expect(dnssec?.["resolvers"]).toEqual(["9.9.9.9"]);
    });

    test("back-fills the rest of the config the probe relies on", () => {
      const dnssec: JSONObject | undefined = restoreWithDnssecMonitor({
        domainName: "oneuptime.com",
      });

      expect(dnssec?.["checkNameserverConsistency"]).toBe(true);
      expect(dnssec?.["signatureExpiryWarningDays"]).toBe(7);
      expect(dnssec?.["timeout"]).toBe(10000);
      expect(dnssec?.["retries"]).toBe(3);
    });

    test("a re-save repairs an already-stored row", () => {
      /*
       * toJSON(fromJSON(x)) is what a monitor edit performs, so rows
       * persisted before the fix heal the next time they are written.
       */
      const json: JSONObject =
        MonitorStep.getDefaultMonitorStep(DEFAULT_ARG).toJSON();

      (json["value"] as JSONObject)["dnssecMonitor"] = {
        domainName: "oneuptime.com",
      };

      const resaved: JSONObject = MonitorStep.fromJSON(json).toJSON()[
        "value"
      ] as JSONObject;
      const dnssec: JSONObject = resaved["dnssecMonitor"] as JSONObject;

      expect((dnssec["resolvers"] as Array<string>).length).toBeGreaterThan(0);
    });

    test("leaves a step without a dnssecMonitor untouched", () => {
      expect(restoreWithDnssecMonitor(undefined)).toBeUndefined();
    });
  });
});
