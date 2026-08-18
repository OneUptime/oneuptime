import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import BadDataException from "../../../Types/Exception/BadDataException";

/*
 * MonitorCriteriaInstance is a DatabaseProperty that carries the "if these
 * filters match, then change status / open incidents / fire alerts" rule for a
 * single monitor status. The contract these tests lock in:
 *
 *   1. Factory defaults (getNewMonitorCriteriaInstanceAsJSON, and the
 *      per-monitor-type online/offline builders) produce well-formed criteria.
 *   2. getValidationError catches every missing-required-field case, and
 *      returns null only for a fully valid instance.
 *   3. toJSON <-> fromJSON is a lossless round-trip, fromJSON rejects malformed
 *      payloads, and clone() is a deep copy built on that round-trip.
 */

// A minimal, valid criteria instance for validation / serialization tests.
const buildValidInstance: () => MonitorCriteriaInstance =
  (): MonitorCriteriaInstance => {
    const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
    instance.data = {
      id: ObjectID.generate().toString(),
      monitorStatusId: new ObjectID("statusid1234567890abcdef"),
      filterCondition: FilterCondition.All,
      filters: [
        {
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.True,
          value: undefined,
        },
      ],
      incidents: [],
      alerts: [],
      createIncidents: false,
      createAlerts: false,
      changeMonitorStatus: true,
      isEnabled: true,
      name: "Online check",
      description: "Checks whether the monitor is online",
    };
    return instance;
  };

describe("MonitorCriteriaInstance", () => {
  describe("constructor", () => {
    test("seeds a default IsOnline filter and a fresh id", () => {
      const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
      expect(instance.data).toBeDefined();
      expect(instance.data?.filterCondition).toBe(FilterCondition.All);
      expect(instance.data?.filters).toHaveLength(1);
      expect(instance.data?.filters[0]?.checkOn).toBe(CheckOn.IsOnline);
      expect(instance.data?.isEnabled).toBe(true);
      // id should be a valid, non-empty ObjectID string.
      expect(typeof instance.data?.id).toBe("string");
      expect(instance.data?.id.length).toBeGreaterThan(0);
    });

    test("two instances get distinct ids", () => {
      const a: MonitorCriteriaInstance = new MonitorCriteriaInstance();
      const b: MonitorCriteriaInstance = new MonitorCriteriaInstance();
      expect(a.data?.id).not.toBe(b.data?.id);
    });
  });

  describe("getNewMonitorCriteriaInstanceAsJSON", () => {
    test("returns default JSON with an IsOnline/True filter", () => {
      const json: JSONObject =
        MonitorCriteriaInstance.getNewMonitorCriteriaInstanceAsJSON();
      expect(json["filterCondition"]).toBe(FilterCondition.All);
      expect(json["name"]).toBe("");
      expect(json["description"]).toBe("");
      expect(json["createIncidents"]).toBe(false);
      expect(json["changeMonitorStatus"]).toBe(false);
      expect(Array.isArray(json["filters"])).toBe(true);
      const filters: Array<CriteriaFilter> = json[
        "filters"
      ] as unknown as Array<CriteriaFilter>;
      expect(filters[0]?.checkOn).toBe(CheckOn.IsOnline);
      expect(filters[0]?.filterType).toBe(FilterType.True);
    });
  });

  describe("getDefaultOnlineMonitorCriteriaInstance", () => {
    const monitorStatusId: ObjectID = new ObjectID("aaaaaaaaaaaaaaaaaaaaaaaa");

    test("Ping monitor produces an IsOnline online criteria", () => {
      const instance: MonitorCriteriaInstance | null =
        MonitorCriteriaInstance.getDefaultOnlineMonitorCriteriaInstance({
          monitorType: MonitorType.Ping,
          monitorStatusId,
          monitorName: "My Server",
        });
      expect(instance).not.toBeNull();
      expect(instance?.data?.changeMonitorStatus).toBe(true);
      expect(instance?.data?.filters[0]?.checkOn).toBe(CheckOn.IsOnline);
      expect(instance?.data?.name).toContain("My Server");
      expect(instance?.data?.monitorStatusId?.toString()).toBe(
        monitorStatusId.toString(),
      );
    });

    test("IncomingRequest monitor uses a RecievedInMinutes filter", () => {
      const instance: MonitorCriteriaInstance | null =
        MonitorCriteriaInstance.getDefaultOnlineMonitorCriteriaInstance({
          monitorType: MonitorType.IncomingRequest,
          monitorStatusId,
          monitorName: "Heartbeat",
        });
      expect(instance).not.toBeNull();
      expect(instance?.data?.filters[0]?.checkOn).toBe(CheckOn.IncomingRequest);
      expect(instance?.data?.filters[0]?.filterType).toBe(
        FilterType.RecievedInMinutes,
      );
      expect(instance?.data?.filters[0]?.value).toBe(30);
    });

    test("Metrics monitor threads the first metric alias into options", () => {
      const instance: MonitorCriteriaInstance | null =
        MonitorCriteriaInstance.getDefaultOnlineMonitorCriteriaInstance({
          monitorType: MonitorType.Metrics,
          monitorStatusId,
          monitorName: "CPU",
          metricOptions: { metricAliases: ["cpu_usage", "mem_usage"] },
        });
      expect(instance).not.toBeNull();
      expect(
        instance?.data?.filters[0]?.metricMonitorOptions?.metricAlias,
      ).toBe("cpu_usage");
    });

    test("Manual monitor type has no online criteria (returns null)", () => {
      const instance: MonitorCriteriaInstance | null =
        MonitorCriteriaInstance.getDefaultOnlineMonitorCriteriaInstance({
          monitorType: MonitorType.Manual,
          monitorStatusId,
          monitorName: "Manual",
        });
      expect(instance).toBeNull();
    });

    /*
     * A domain whose registration data cannot be read has no expiry date, so
     * DomainIsExpired cannot decide anything. Requiring IsOnline as well is
     * what stops an unreadable registration from being reported as healthy
     * (issue #3046).
     */
    test("Domain monitor requires a successful lookup as well as a live registration", () => {
      const instance: MonitorCriteriaInstance | null =
        MonitorCriteriaInstance.getDefaultOnlineMonitorCriteriaInstance({
          monitorType: MonitorType.Domain,
          monitorStatusId,
          monitorName: "identity.digital",
        });

      expect(instance?.data?.filterCondition).toBe(FilterCondition.All);
      expect(instance?.data?.filters).toHaveLength(2);
      expect(instance?.data?.filters[0]?.checkOn).toBe(CheckOn.IsOnline);
      expect(instance?.data?.filters[0]?.filterType).toBe(FilterType.True);
      expect(instance?.data?.filters[1]?.checkOn).toBe(CheckOn.DomainIsExpired);
      expect(instance?.data?.filters[1]?.filterType).toBe(FilterType.False);
    });
  });

  describe("getDefaultOfflineMonitorCriteriaInstance", () => {
    test("Ping offline criteria populates incident and alert with severities", () => {
      const monitorStatusId: ObjectID = new ObjectID(
        "bbbbbbbbbbbbbbbbbbbbbbbb",
      );
      const incidentSeverityId: ObjectID = new ObjectID(
        "cccccccccccccccccccccccc",
      );
      const alertSeverityId: ObjectID = new ObjectID(
        "dddddddddddddddddddddddd",
      );

      const instance: MonitorCriteriaInstance =
        MonitorCriteriaInstance.getDefaultOfflineMonitorCriteriaInstance({
          monitorType: MonitorType.Ping,
          monitorStatusId,
          incidentSeverityId,
          alertSeverityId,
          monitorName: "Edge",
        });

      expect(instance.data?.createIncidents).toBe(true);
      expect(instance.data?.changeMonitorStatus).toBe(true);
      expect(instance.data?.filters[0]?.checkOn).toBe(CheckOn.IsOnline);
      expect(instance.data?.filters[0]?.filterType).toBe(FilterType.False);
      expect(instance.data?.incidents[0]?.incidentSeverityId?.toString()).toBe(
        incidentSeverityId.toString(),
      );
      expect(instance.data?.alerts[0]?.alertSeverityId?.toString()).toBe(
        alertSeverityId.toString(),
      );
      expect(instance.data?.incidents[0]?.title).toContain("Edge");
    });

    test("Domain offline criteria fires on an expired registration or a failed lookup", () => {
      const instance: MonitorCriteriaInstance =
        MonitorCriteriaInstance.getDefaultOfflineMonitorCriteriaInstance({
          monitorType: MonitorType.Domain,
          monitorStatusId: new ObjectID("bbbbbbbbbbbbbbbbbbbbbbbb"),
          incidentSeverityId: new ObjectID("cccccccccccccccccccccccc"),
          alertSeverityId: new ObjectID("dddddddddddddddddddddddd"),
          monitorName: "identity.digital",
        });

      expect(instance.data?.filterCondition).toBe(FilterCondition.Any);
      expect(instance.data?.filters).toHaveLength(2);
      expect(instance.data?.filters[0]?.checkOn).toBe(CheckOn.DomainIsExpired);
      expect(instance.data?.filters[0]?.filterType).toBe(FilterType.True);
      expect(instance.data?.filters[1]?.checkOn).toBe(CheckOn.IsOnline);
      expect(instance.data?.filters[1]?.filterType).toBe(FilterType.False);
      expect(instance.data?.createIncidents).toBe(true);
      expect(instance.data?.incidents[0]?.title).toContain("identity.digital");
    });
  });

  describe("getValidationError", () => {
    test("returns error when data is missing", () => {
      const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
      instance.data = undefined;
      expect(
        MonitorCriteriaInstance.getValidationError(instance, MonitorType.Ping),
      ).toBe("Monitor Step is required.");
    });

    test("returns error when there are no filters", () => {
      const instance: MonitorCriteriaInstance = buildValidInstance();
      instance.data!.filters = [];
      const error: string | null = MonitorCriteriaInstance.getValidationError(
        instance,
        MonitorType.Ping,
      );
      expect(error).toContain("Filter is required");
    });

    test("returns error when name is empty", () => {
      const instance: MonitorCriteriaInstance = buildValidInstance();
      instance.data!.name = "";
      const error: string | null = MonitorCriteriaInstance.getValidationError(
        instance,
        MonitorType.Ping,
      );
      expect(error).toContain("Name is required");
    });

    test("returns error when description is empty", () => {
      const instance: MonitorCriteriaInstance = buildValidInstance();
      instance.data!.description = "";
      const error: string | null = MonitorCriteriaInstance.getValidationError(
        instance,
        MonitorType.Ping,
      );
      expect(error).toContain("Description is required");
    });

    test("returns error when an incident is missing its severity", () => {
      const instance: MonitorCriteriaInstance = buildValidInstance();
      instance.data!.incidents = [
        {
          title: "Down",
          description: "It is down",
          incidentSeverityId: undefined,
          id: ObjectID.generate().toString(),
          onCallPolicyIds: [],
        },
      ];
      const error: string | null = MonitorCriteriaInstance.getValidationError(
        instance,
        MonitorType.Ping,
      );
      expect(error).toContain("Incident severity is required");
    });

    test("returns error when an alert is missing its title", () => {
      const instance: MonitorCriteriaInstance = buildValidInstance();
      instance.data!.alerts = [
        {
          title: "",
          description: "It is down",
          alertSeverityId: new ObjectID("eeeeeeeeeeeeeeeeeeeeeeee"),
          id: ObjectID.generate().toString(),
          onCallPolicyIds: [],
        },
      ];
      const error: string | null = MonitorCriteriaInstance.getValidationError(
        instance,
        MonitorType.Ping,
      );
      expect(error).toContain("Alert title is required");
    });

    test("rejects a filter type that a Ping monitor cannot support", () => {
      const instance: MonitorCriteriaInstance = buildValidInstance();
      instance.data!.filters = [
        {
          checkOn: CheckOn.DiskUsagePercent,
          filterType: FilterType.GreaterThan,
          value: 90,
        },
      ];
      const error: string | null = MonitorCriteriaInstance.getValidationError(
        instance,
        MonitorType.Ping,
      );
      expect(error).toContain("Ping Monitor cannot have filter type");
    });

    /*
     * Issue #3225. The Ping-only guard is now driven by
     * CriteriaFilterUtil.getSupportedCheckOns, so every audited type rejects a
     * checkOn its evaluator never reads. Saving one produced a criteria that
     * could never match in either direction - and a criteria set where nothing
     * matches is silent: the monitor sits at its default status forever with no
     * timeline event and no error to go on.
     */
    test("rejects a filter type that an SSL Certificate monitor cannot support", () => {
      const instance: MonitorCriteriaInstance = buildValidInstance();
      instance.data!.filters = [
        {
          checkOn: CheckOn.ResponseStatusCode,
          filterType: FilterType.EqualTo,
          value: 200,
        },
      ];
      const error: string | null = MonitorCriteriaInstance.getValidationError(
        instance,
        MonitorType.SSLCertificate,
      );
      expect(error).toContain(
        "SSL Certificate Monitor cannot have filter type",
      );
    });

    test("rejects a filter type that a DNSSEC monitor cannot support", () => {
      const instance: MonitorCriteriaInstance = buildValidInstance();
      instance.data!.filters = [
        {
          checkOn: CheckOn.IsValidCertificate,
          filterType: FilterType.True,
          value: undefined,
        },
      ];
      const error: string | null = MonitorCriteriaInstance.getValidationError(
        instance,
        MonitorType.DNSSEC,
      );
      expect(error).toContain("DNSSEC Monitor cannot have filter type");
    });

    /*
     * The reachability checks stay legal on both types: their evaluators have
     * always read them, and any monitor already carrying one has to remain
     * saveable.
     */
    test("accepts Is Online on an SSL Certificate monitor", () => {
      const instance: MonitorCriteriaInstance = buildValidInstance();
      instance.data!.filters = [
        {
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.False,
          value: undefined,
        },
      ];
      expect(
        MonitorCriteriaInstance.getValidationError(
          instance,
          MonitorType.SSLCertificate,
        ),
      ).toBeNull();
    });

    test("accepts Is Online on a DNSSEC monitor", () => {
      const instance: MonitorCriteriaInstance = buildValidInstance();
      instance.data!.filters = [
        {
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.False,
          value: undefined,
        },
      ];
      expect(
        MonitorCriteriaInstance.getValidationError(
          instance,
          MonitorType.DNSSEC,
        ),
      ).toBeNull();
    });

    // A type with no audited list is unconstrained, exactly as before.
    test("accepts any filter type on a monitor type that has not been audited", () => {
      const instance: MonitorCriteriaInstance = buildValidInstance();
      instance.data!.filters = [
        {
          checkOn: CheckOn.IsValidCertificate,
          filterType: FilterType.True,
          value: undefined,
        },
      ];
      expect(
        MonitorCriteriaInstance.getValidationError(
          instance,
          MonitorType.Website,
        ),
      ).toBeNull();
    });

    test("requires a disk path for Disk Usage Percent filters", () => {
      const instance: MonitorCriteriaInstance = buildValidInstance();
      instance.data!.filters = [
        {
          checkOn: CheckOn.DiskUsagePercent,
          filterType: FilterType.GreaterThan,
          value: 90,
        },
      ];
      const error: string | null = MonitorCriteriaInstance.getValidationError(
        instance,
        MonitorType.Server,
      );
      expect(error).toBe("Disk Path is required for Disk Usage Percent");
    });

    test("requires a value for filters that carry a threshold", () => {
      const instance: MonitorCriteriaInstance = buildValidInstance();
      instance.data!.filters = [
        {
          checkOn: CheckOn.ResponseTime,
          filterType: FilterType.GreaterThan,
          value: undefined,
        },
      ];
      const error: string | null = MonitorCriteriaInstance.getValidationError(
        instance,
        MonitorType.Ping,
      );
      expect(error).toContain("Value is required");
    });

    test("returns null for a fully valid instance", () => {
      const instance: MonitorCriteriaInstance = buildValidInstance();
      expect(
        MonitorCriteriaInstance.getValidationError(instance, MonitorType.Ping),
      ).toBeNull();
    });
  });

  describe("toJSON / fromJSON round-trip", () => {
    test("serializes with the MonitorCriteriaInstance object type wrapper", () => {
      const instance: MonitorCriteriaInstance = buildValidInstance();
      const json: JSONObject = instance.toJSON();
      expect(json["_type"]).toBe(ObjectType.MonitorCriteriaInstance);
      expect(json["value"]).toBeDefined();
    });

    test("round-trips core fields losslessly", () => {
      const instance: MonitorCriteriaInstance = buildValidInstance();
      instance.data!.name = "Round Trip";
      instance.data!.description = "A description";
      instance.data!.changeMonitorStatus = true;
      instance.data!.createIncidents = false;

      const restored: MonitorCriteriaInstance =
        MonitorCriteriaInstance.fromJSON(instance.toJSON());

      expect(restored.data?.name).toBe("Round Trip");
      expect(restored.data?.description).toBe("A description");
      expect(restored.data?.filterCondition).toBe(FilterCondition.All);
      expect(restored.data?.filters[0]?.checkOn).toBe(CheckOn.IsOnline);
      expect(restored.data?.changeMonitorStatus).toBe(true);
      expect(restored.data?.monitorStatusId?.toString()).toBe(
        instance.data?.monitorStatusId?.toString(),
      );
    });

    test("fromJSON defaults isEnabled to true when absent", () => {
      const instance: MonitorCriteriaInstance = buildValidInstance();
      const json: JSONObject = instance.toJSON();
      // Simulate a legacy payload that predates the isEnabled field.
      delete (json["value"] as JSONObject)["isEnabled"];
      const restored: MonitorCriteriaInstance =
        MonitorCriteriaInstance.fromJSON(json);
      expect(restored.data?.isEnabled).toBe(true);
    });

    test("fromJSON is idempotent when given an existing instance", () => {
      const instance: MonitorCriteriaInstance = buildValidInstance();
      const same: MonitorCriteriaInstance = MonitorCriteriaInstance.fromJSON(
        instance as unknown as JSONObject,
      );
      expect(same).toBe(instance);
    });
  });

  describe("fromJSON validation", () => {
    test("throws when _type is missing", () => {
      expect(() => {
        return MonitorCriteriaInstance.fromJSON({ value: {} });
      }).toThrow(BadDataException);
    });

    test("throws when _type is wrong", () => {
      expect(() => {
        return MonitorCriteriaInstance.fromJSON({
          _type: "SomethingElse",
          value: {},
        });
      }).toThrow("json._type should be MonitorCriteriaInstance");
    });

    test("throws when value is missing", () => {
      expect(() => {
        return MonitorCriteriaInstance.fromJSON({
          _type: ObjectType.MonitorCriteriaInstance,
        });
      }).toThrow("json.value is null");
    });

    test("throws when filterCondition is missing", () => {
      expect(() => {
        return MonitorCriteriaInstance.fromJSON({
          _type: ObjectType.MonitorCriteriaInstance,
          value: { filters: [] },
        });
      }).toThrow("json.filterCondition is null");
    });

    test("throws when filters is missing", () => {
      expect(() => {
        return MonitorCriteriaInstance.fromJSON({
          _type: ObjectType.MonitorCriteriaInstance,
          value: { filterCondition: FilterCondition.All },
        });
      }).toThrow("json.filters is null");
    });

    test("throws when filters is not an array", () => {
      expect(() => {
        return MonitorCriteriaInstance.fromJSON({
          _type: ObjectType.MonitorCriteriaInstance,
          value: {
            filterCondition: FilterCondition.All,
            filters: "not-an-array",
          },
        });
      }).toThrow("json.filters should be an array");
    });
  });

  describe("clone", () => {
    test("produces a deep, independent copy that carries equal data", () => {
      const instance: MonitorCriteriaInstance = buildValidInstance();
      instance.data!.name = "Original";

      const cloned: MonitorCriteriaInstance =
        MonitorCriteriaInstance.clone(instance);

      expect(cloned).not.toBe(instance);
      expect(cloned.data?.name).toBe("Original");

      // Mutating the clone must not affect the original.
      cloned.data!.name = "Mutated";
      expect(instance.data?.name).toBe("Original");
    });
  });

  describe("setters", () => {
    test("chain and mutate the underlying data", () => {
      const statusId: ObjectID = new ObjectID("ffffffffffffffffffffffff");
      const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance()
        .setName("Chained")
        .setDescription("Chained description")
        .setChangeMonitorStatus(true)
        .setCreateIncidents(true)
        .setCreateAlerts(false)
        .setIsEnabled(false)
        .setMonitorStatusId(statusId);

      expect(instance.data?.name).toBe("Chained");
      expect(instance.data?.description).toBe("Chained description");
      expect(instance.data?.changeMonitorStatus).toBe(true);
      expect(instance.data?.createIncidents).toBe(true);
      expect(instance.data?.createAlerts).toBe(false);
      expect(instance.data?.isEnabled).toBe(false);
      expect(instance.data?.monitorStatusId?.toString()).toBe(
        statusId.toString(),
      );
    });
  });

  describe("isValid", () => {
    test("returns true (permissive by contract)", () => {
      expect(MonitorCriteriaInstance.isValid({})).toBe(true);
    });
  });

  /*
   * Issue #3225. The dashboard's "Add Criteria" button used to push a bare
   * `new MonitorCriteriaInstance()`, whose hardcoded IsOnline filter is not in
   * the SSL Certificate or DNSSEC dropdowns - so the checkOn select rendered
   * blank over a live value, and a user who only touched the filterType select
   * saved a filter they never knowingly chose.
   */
  describe("getEmptyCriteriaInstance", () => {
    test("seeds an SSL Certificate criteria with a certificate check", () => {
      const instance: MonitorCriteriaInstance =
        MonitorCriteriaInstance.getEmptyCriteriaInstance(
          MonitorType.SSLCertificate,
        );

      expect(instance.data?.filters).toHaveLength(1);
      expect(instance.data?.filters[0]?.checkOn).toBe(
        CheckOn.IsValidCertificate,
      );
    });

    test("seeds a DNSSEC criteria with a DNSSEC check", () => {
      const instance: MonitorCriteriaInstance =
        MonitorCriteriaInstance.getEmptyCriteriaInstance(MonitorType.DNSSEC);

      expect(instance.data?.filters[0]?.checkOn).toBe(CheckOn.DnssecChainValid);
    });

    test("leaves filterType unset so the user has to pick one", () => {
      const instance: MonitorCriteriaInstance =
        MonitorCriteriaInstance.getEmptyCriteriaInstance(
          MonitorType.SSLCertificate,
        );

      expect(instance.data?.filters[0]?.filterType).toBeUndefined();
    });

    test("seeds a checkOn the type validates", () => {
      for (const monitorType of [
        MonitorType.SSLCertificate,
        MonitorType.DNSSEC,
        MonitorType.Ping,
        MonitorType.Website,
      ]) {
        const instance: MonitorCriteriaInstance =
          MonitorCriteriaInstance.getEmptyCriteriaInstance(monitorType);

        instance.data!.name = "Seeded";
        instance.data!.description = "Seeded";
        instance.data!.monitorStatusId = ObjectID.generate();
        instance.data!.filters[0]!.filterType = FilterType.True;

        expect(
          MonitorCriteriaInstance.getValidationError(instance, monitorType),
        ).toBeNull();
      }
    });

    /*
     * An un-audited type has no list to seed from, so it keeps the bare
     * constructor's shape.
     */
    test("falls back to the constructor default for an unaudited type", () => {
      const instance: MonitorCriteriaInstance =
        MonitorCriteriaInstance.getEmptyCriteriaInstance(MonitorType.Website);

      expect(instance.data?.filters[0]?.checkOn).toBe(CheckOn.IsOnline);
    });

    /*
     * The bare constructor is used in ~40 places by the alert-pack builders and
     * by fromJSON, which overwrite filters immediately and depend on its shape.
     */
    test("the bare constructor is unchanged", () => {
      const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();

      expect(instance.data?.filters).toHaveLength(1);
      expect(instance.data?.filters[0]?.checkOn).toBe(CheckOn.IsOnline);
    });
  });
});
