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
      /*
       * The condition is seeded too. A filter carrying only a check shows
       * an empty "Filter Condition" dropdown in the criteria form, and is
       * dead on the server - every comparator in CompareCriteria switches
       * on the filter type and treats one it does not recognise as "no
       * match", so the criteria never fires. See #3412.
       */
      expect(instance.data?.filters[0]?.filterType).toBe(FilterType.True);
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

    test("IncomingRequest monitor is online while the request body carries no error", () => {
      const instance: MonitorCriteriaInstance | null =
        MonitorCriteriaInstance.getDefaultOnlineMonitorCriteriaInstance({
          monitorType: MonitorType.IncomingRequest,
          monitorStatusId,
          monitorName: "Heartbeat",
        });
      expect(instance).not.toBeNull();
      expect(instance?.data?.filters[0]?.checkOn).toBe(CheckOn.RequestBody);
      expect(instance?.data?.filters[0]?.filterType).toBe(
        FilterType.NotContains,
      );
      expect(instance?.data?.filters[0]?.value).toBe(
        MonitorCriteriaInstance.DEFAULT_INCOMING_BODY_ERROR_KEYWORD,
      );
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

    test("returns error when a filter has no condition", () => {
      /*
       * The blank "Filter Condition" dropdown reported in #3412 sat next to
       * fields that were all filled in, so it was easy to save past. A
       * criteria with no condition can never match, so refuse it rather
       * than accept a rule that silently does nothing.
       */
      const instance: MonitorCriteriaInstance = buildValidInstance();
      instance.data!.filters = [
        {
          checkOn: CheckOn.ExternalStatusPageActiveIncidents,
          filterType: undefined,
          value: 0,
        },
      ];
      const error: string | null = MonitorCriteriaInstance.getValidationError(
        instance,
        MonitorType.ExternalStatusPage,
      );
      expect(error).toContain("Filter Condition is required");
      expect(error).toContain(CheckOn.ExternalStatusPageActiveIncidents);
    });

    test("accepts the criteria an External Status Page monitor is created with", () => {
      const instance: MonitorCriteriaInstance =
        MonitorCriteriaInstance.getDefaultOnlineMonitorCriteriaInstance({
          monitorType: MonitorType.ExternalStatusPage,
          monitorStatusId: new ObjectID("aaaaaaaaaaaaaaaaaaaaaaaa"),
          monitorName: "Acme Status",
        })!;

      expect(
        MonitorCriteriaInstance.getValidationError(
          instance,
          MonitorType.ExternalStatusPage,
        ),
      ).toBeNull();
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
});
