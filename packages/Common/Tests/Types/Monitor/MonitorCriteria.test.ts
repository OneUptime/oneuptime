import MonitorCriteria from "../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import BadDataException from "../../../Types/Exception/BadDataException";

/*
 * MonitorCriteria wraps the ordered list of MonitorCriteriaInstance that a
 * monitor step evaluates. These tests lock in the default builder (which
 * composes the online + offline instances), the validation contract (which
 * delegates to each instance), and the toJSON/fromJSON round-trip.
 */

const DEFAULT_ARG: {
  monitorType: MonitorType;
  monitorName: string;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
} = {
  monitorType: MonitorType.Ping,
  monitorName: "Gateway",
  onlineMonitorStatusId: new ObjectID("100000000000000000000011"),
  offlineMonitorStatusId: new ObjectID("100000000000000000000012"),
  defaultIncidentSeverityId: new ObjectID("100000000000000000000013"),
  defaultAlertSeverityId: new ObjectID("100000000000000000000014"),
};

describe("MonitorCriteria", () => {
  describe("getDefaultMonitorCriteria", () => {
    test("composes both an offline and an online instance for Ping", () => {
      const criteria: MonitorCriteria =
        MonitorCriteria.getDefaultMonitorCriteria(DEFAULT_ARG);

      // Ping has both an offline (Disallow) and an online criteria instance.
      expect(criteria.data?.monitorCriteriaInstanceArray).toHaveLength(2);
      for (const instance of criteria.data!.monitorCriteriaInstanceArray) {
        expect(instance).toBeInstanceOf(MonitorCriteriaInstance);
      }
    });

    test("the default Ping criteria passes validation", () => {
      const criteria: MonitorCriteria =
        MonitorCriteria.getDefaultMonitorCriteria(DEFAULT_ARG);
      expect(
        MonitorCriteria.getValidationError(criteria, MonitorType.Ping),
      ).toBeNull();
    });

    /*
     * Only the first criteria that matches is acted on. A certificate that
     * is valid but about to expire matches the online criteria as well, so
     * the warning has to come before it - and after the offline one, so an
     * invalid certificate is never reported as merely expiring.
     */
    test.each([
      [
        MonitorType.SSLCertificate,
        [
          "Check if Gateway certificate is not valid",
          "Check if Gateway certificate expires soon",
          "Check if Gateway certificate is valid",
        ],
      ],
      [
        MonitorType.Domain,
        [
          "Check if Gateway domain check failed",
          "Check if Gateway domain expires soon",
          "Check if Gateway is not expired",
        ],
      ],
    ])(
      "%s starts with offline, then 'expires soon', then online",
      (monitorType: MonitorType, names: Array<string>) => {
        const criteria: MonitorCriteria =
          MonitorCriteria.getDefaultMonitorCriteria({
            ...DEFAULT_ARG,
            monitorType: monitorType,
          });

        expect(
          criteria.data!.monitorCriteriaInstanceArray.map(
            (instance: MonitorCriteriaInstance) => {
              return instance.data!.name;
            },
          ),
        ).toEqual(names);

        const [offline, warning, online] =
          criteria.data!.monitorCriteriaInstanceArray;

        expect(offline!.data!.monitorStatusId?.toString()).toBe(
          DEFAULT_ARG.offlineMonitorStatusId.toString(),
        );
        expect(offline!.data!.createIncidents).toBe(true);
        expect(warning!.data!.createAlerts).toBe(true);
        expect(warning!.data!.changeMonitorStatus).toBe(false);
        expect(online!.data!.monitorStatusId?.toString()).toBe(
          DEFAULT_ARG.onlineMonitorStatusId.toString(),
        );

        expect(
          MonitorCriteria.getValidationError(criteria, monitorType),
        ).toBeNull();
      },
    );

    test.each([MonitorType.SSLCertificate, MonitorType.Domain])(
      "%s warning alert takes the warning alert severity when one is given",
      (monitorType: MonitorType) => {
        const warningAlertSeverityId: ObjectID = new ObjectID(
          "100000000000000000000015",
        );

        const criteria: MonitorCriteria =
          MonitorCriteria.getDefaultMonitorCriteria({
            ...DEFAULT_ARG,
            monitorType: monitorType,
            warningAlertSeverityId: warningAlertSeverityId,
          });

        const [offline, warning] = criteria.data!.monitorCriteriaInstanceArray;

        expect(warning!.data!.alerts[0]!.alertSeverityId?.toString()).toBe(
          warningAlertSeverityId.toString(),
        );

        // Only the warning moves: the offline alert keeps the default.
        expect(offline!.data!.alerts[0]!.alertSeverityId?.toString()).toBe(
          DEFAULT_ARG.defaultAlertSeverityId.toString(),
        );
      },
    );

    test.each([MonitorType.SSLCertificate, MonitorType.Domain])(
      "%s warning alert falls back to the default alert severity",
      (monitorType: MonitorType) => {
        const criteria: MonitorCriteria =
          MonitorCriteria.getDefaultMonitorCriteria({
            ...DEFAULT_ARG,
            monitorType: monitorType,
          });

        expect(
          criteria.data!.monitorCriteriaInstanceArray[1]!.data!.alerts[0]!.alertSeverityId?.toString(),
        ).toBe(DEFAULT_ARG.defaultAlertSeverityId.toString());
      },
    );

    test("only SSL Certificate and Domain monitors start with an expiry warning", () => {
      const withWarning: Array<MonitorType> = (
        Object.values(MonitorType) as Array<MonitorType>
      ).filter((monitorType: MonitorType) => {
        return MonitorCriteria.getDefaultMonitorCriteria({
          ...DEFAULT_ARG,
          monitorType: monitorType,
        }).data!.monitorCriteriaInstanceArray.some(
          (instance: MonitorCriteriaInstance) => {
            return (
              instance.data!.createAlerts === true &&
              instance.data!.changeMonitorStatus === false &&
              instance.data!.createIncidents === false
            );
          },
        );
      });

      expect(withWarning.sort()).toEqual(
        [MonitorType.Domain, MonitorType.SSLCertificate].sort(),
      );
    });

    test.each([MonitorType.Website, MonitorType.API])(
      "%s starts with an offline and an online criteria, both passing validation",
      (monitorType: MonitorType) => {
        const criteria: MonitorCriteria =
          MonitorCriteria.getDefaultMonitorCriteria({
            ...DEFAULT_ARG,
            monitorType: monitorType,
          });

        expect(
          criteria.data!.monitorCriteriaInstanceArray.map(
            (instance: MonitorCriteriaInstance) => {
              return instance.data!.name;
            },
          ),
        ).toEqual([
          "Check if Gateway is offline",
          "Check if Gateway is online",
        ]);

        expect(
          MonitorCriteria.getValidationError(criteria, monitorType),
        ).toBeNull();
      },
    );
  });

  describe("getValidationError", () => {
    test("errors when data is missing", () => {
      const criteria: MonitorCriteria = new MonitorCriteria();
      criteria.data = undefined;
      expect(
        MonitorCriteria.getValidationError(criteria, MonitorType.Ping),
      ).toBe("Monitor Criteria is required");
    });

    test("errors when the instance array is empty", () => {
      const criteria: MonitorCriteria = new MonitorCriteria();
      criteria.data = { monitorCriteriaInstanceArray: [] };
      expect(
        MonitorCriteria.getValidationError(criteria, MonitorType.Ping),
      ).toBe("Monitor Criteria is required");
    });

    test("propagates a validation error from a contained instance", () => {
      const criteria: MonitorCriteria =
        MonitorCriteria.getDefaultMonitorCriteria(DEFAULT_ARG);
      // Corrupt a contained instance: strip its required name.
      criteria.data!.monitorCriteriaInstanceArray[0]!.data!.name = "";
      const error: string | null = MonitorCriteria.getValidationError(
        criteria,
        MonitorType.Ping,
      );
      expect(error).toContain("Name is required");
    });
  });

  describe("getNewMonitorCriteriaAsJSON", () => {
    test("wraps a single default instance", () => {
      const json: JSONObject = MonitorCriteria.getNewMonitorCriteriaAsJSON();
      expect(json["_type"]).toBe("MonitorCriteria");
      const value: JSONObject = json["value"] as JSONObject;
      expect(Array.isArray(value["monitorCriteriaInstanceArray"])).toBe(true);
      expect(
        (value["monitorCriteriaInstanceArray"] as Array<unknown>).length,
      ).toBe(1);
    });
  });

  describe("toJSON / fromJSON round-trip", () => {
    test("serializes with the MonitorCriteria type wrapper", () => {
      const criteria: MonitorCriteria =
        MonitorCriteria.getDefaultMonitorCriteria(DEFAULT_ARG);
      const json: JSONObject = criteria.toJSON();
      expect(json["_type"]).toBe(ObjectType.MonitorCriteria);
    });

    test("round-trips the instance count", () => {
      const criteria: MonitorCriteria =
        MonitorCriteria.getDefaultMonitorCriteria(DEFAULT_ARG);
      const restored: MonitorCriteria = MonitorCriteria.fromJSON(
        criteria.toJSON(),
      );
      expect(restored.data?.monitorCriteriaInstanceArray).toHaveLength(2);
      expect(restored.data?.monitorCriteriaInstanceArray[0]).toBeInstanceOf(
        MonitorCriteriaInstance,
      );
    });

    test("toString returns a JSON string of the serialized value", () => {
      const criteria: MonitorCriteria =
        MonitorCriteria.getDefaultMonitorCriteria(DEFAULT_ARG);
      const parsed: JSONObject = JSON.parse(criteria.toString()) as JSONObject;
      expect(parsed["_type"]).toBe(ObjectType.MonitorCriteria);
    });
  });

  describe("fromJSON validation", () => {
    test("returns the same instance when given a MonitorCriteria", () => {
      const criteria: MonitorCriteria =
        MonitorCriteria.getDefaultMonitorCriteria(DEFAULT_ARG);
      expect(MonitorCriteria.fromJSON(criteria as unknown as JSONObject)).toBe(
        criteria,
      );
    });

    test("throws on a wrong _type", () => {
      expect(() => {
        return MonitorCriteria.fromJSON({ _type: "Nope", value: {} });
      }).toThrow(BadDataException);
    });

    test("throws when value is missing", () => {
      expect(() => {
        return MonitorCriteria.fromJSON({
          _type: ObjectType.MonitorCriteria,
        });
      }).toThrow(BadDataException);
    });

    test("throws when monitorCriteriaInstanceArray is missing", () => {
      expect(() => {
        return MonitorCriteria.fromJSON({
          _type: ObjectType.MonitorCriteria,
          value: {},
        });
      }).toThrow(BadDataException);
    });
  });
});
