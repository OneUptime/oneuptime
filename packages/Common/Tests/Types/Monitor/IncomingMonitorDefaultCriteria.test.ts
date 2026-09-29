import FilterCondition from "../../../Types/Filter/FilterCondition";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteria from "../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";

/*
 * Incoming Request and Incoming Email monitors are push-driven: the sender
 * decides when data arrives and what it says. Their out-of-the-box criteria
 * therefore read the payload body rather than the arrival clock:
 *
 *   offline -> body CONTAINS "error"
 *   online  -> body DOES NOT CONTAIN "error"
 *
 * These tests pin that contract down (shape, wiring, incident/alert
 * templates, validation, serialization) so the defaults cannot silently
 * drift back to the old "received in the last 30 minutes" heartbeat check.
 */

const ONLINE_STATUS_ID: ObjectID = new ObjectID("100000000000000000000011");
const OFFLINE_STATUS_ID: ObjectID = new ObjectID("100000000000000000000012");
const INCIDENT_SEVERITY_ID: ObjectID = new ObjectID("100000000000000000000013");
const ALERT_SEVERITY_ID: ObjectID = new ObjectID("100000000000000000000014");

const KEYWORD: string =
  MonitorCriteriaInstance.DEFAULT_INCOMING_BODY_ERROR_KEYWORD;

interface IncomingMonitorCase {
  label: string;
  monitorType: MonitorType;
  bodyCheckOn: CheckOn;
  // How the body is named in the human-readable copy.
  bodyLabel: string;
  // The check the defaults deliberately no longer use.
  retiredCheckOn: CheckOn;
}

const CASES: Array<IncomingMonitorCase> = [
  {
    label: "Incoming Request",
    monitorType: MonitorType.IncomingRequest,
    bodyCheckOn: CheckOn.RequestBody,
    bodyLabel: "request body",
    retiredCheckOn: CheckOn.IncomingRequest,
  },
  {
    label: "Incoming Email",
    monitorType: MonitorType.IncomingEmail,
    bodyCheckOn: CheckOn.EmailBody,
    bodyLabel: "email body",
    retiredCheckOn: CheckOn.EmailReceivedAt,
  },
];

function buildOnline(
  testCase: IncomingMonitorCase,
  monitorName: string = "Payments API",
): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance | null =
    MonitorCriteriaInstance.getDefaultOnlineMonitorCriteriaInstance({
      monitorType: testCase.monitorType,
      monitorStatusId: ONLINE_STATUS_ID,
      monitorName: monitorName,
    });

  if (!instance) {
    throw new Error(`${testCase.label} has no default online criteria`);
  }

  return instance;
}

function buildOffline(
  testCase: IncomingMonitorCase,
  monitorName: string = "Payments API",
): MonitorCriteriaInstance {
  return MonitorCriteriaInstance.getDefaultOfflineMonitorCriteriaInstance({
    monitorType: testCase.monitorType,
    monitorStatusId: OFFLINE_STATUS_ID,
    incidentSeverityId: INCIDENT_SEVERITY_ID,
    alertSeverityId: ALERT_SEVERITY_ID,
    monitorName: monitorName,
  });
}

describe("Incoming monitor default criteria", () => {
  describe("DEFAULT_INCOMING_BODY_ERROR_KEYWORD", () => {
    test('is the lower-cased word "error"', () => {
      expect(KEYWORD).toBe("error");
    });
  });

  describe.each(CASES)(
    "$label monitor",
    (testCase: IncomingMonitorCase): void => {
      describe("online criteria", () => {
        test(`checks that the ${testCase.bodyLabel} does not contain the error keyword`, () => {
          const instance: MonitorCriteriaInstance = buildOnline(testCase);

          expect(instance.data?.filters).toHaveLength(1);

          const filter: CriteriaFilter = instance.data!.filters[0]!;

          expect(filter.checkOn).toBe(testCase.bodyCheckOn);
          expect(filter.filterType).toBe(FilterType.NotContains);
          expect(filter.value).toBe(KEYWORD);
        });

        test("no longer checks the arrival clock", () => {
          const instance: MonitorCriteriaInstance = buildOnline(testCase);

          const checkOns: Array<CheckOn> = instance.data!.filters.map(
            (filter: CriteriaFilter) => {
              return filter.checkOn;
            },
          );

          expect(checkOns).not.toContain(testCase.retiredCheckOn);

          const filterTypes: Array<FilterType | undefined> =
            instance.data!.filters.map((filter: CriteriaFilter) => {
              return filter.filterType;
            });

          expect(filterTypes).not.toContain(FilterType.RecievedInMinutes);
          expect(filterTypes).not.toContain(FilterType.NotRecievedInMinutes);
        });

        test("flips the monitor status but never opens incidents or alerts", () => {
          const instance: MonitorCriteriaInstance = buildOnline(testCase);

          expect(instance.data?.changeMonitorStatus).toBe(true);
          expect(instance.data?.createIncidents).toBe(false);
          expect(instance.data?.createAlerts).toBe(false);
          expect(instance.data?.incidents).toEqual([]);
          expect(instance.data?.alerts).toEqual([]);
        });

        test("points at the online monitor status and uses an All filter condition", () => {
          const instance: MonitorCriteriaInstance = buildOnline(testCase);

          expect(instance.data?.monitorStatusId?.toString()).toBe(
            ONLINE_STATUS_ID.toString(),
          );
          expect(instance.data?.filterCondition).toBe(FilterCondition.All);
        });

        test("names itself after the monitor and explains the body check", () => {
          const instance: MonitorCriteriaInstance = buildOnline(
            testCase,
            "Checkout Webhook",
          );

          expect(instance.data?.name).toBe(
            "Check if Checkout Webhook is online",
          );
          expect(instance.data?.description).toContain(testCase.bodyLabel);
          expect(instance.data?.description).toContain("does not contain");
          expect(instance.data?.description).toContain(KEYWORD);
        });

        test("gets a fresh id on every call", () => {
          const first: MonitorCriteriaInstance = buildOnline(testCase);
          const second: MonitorCriteriaInstance = buildOnline(testCase);

          expect(first.data?.id).toBeTruthy();
          expect(first.data?.id).not.toBe(second.data?.id);
        });
      });

      describe("offline criteria", () => {
        test(`checks that the ${testCase.bodyLabel} contains the error keyword`, () => {
          const instance: MonitorCriteriaInstance = buildOffline(testCase);

          expect(instance.data?.filters).toHaveLength(1);

          const filter: CriteriaFilter = instance.data!.filters[0]!;

          expect(filter.checkOn).toBe(testCase.bodyCheckOn);
          expect(filter.filterType).toBe(FilterType.Contains);
          expect(filter.value).toBe(KEYWORD);
        });

        test("no longer checks the arrival clock", () => {
          const instance: MonitorCriteriaInstance = buildOffline(testCase);

          const checkOns: Array<CheckOn> = instance.data!.filters.map(
            (filter: CriteriaFilter) => {
              return filter.checkOn;
            },
          );

          expect(checkOns).not.toContain(testCase.retiredCheckOn);

          const filterTypes: Array<FilterType | undefined> =
            instance.data!.filters.map((filter: CriteriaFilter) => {
              return filter.filterType;
            });

          expect(filterTypes).not.toContain(FilterType.NotRecievedInMinutes);
          expect(filterTypes).not.toContain(FilterType.RecievedInMinutes);
        });

        test("opens an auto-resolving incident with the configured severity", () => {
          const instance: MonitorCriteriaInstance = buildOffline(
            testCase,
            "Checkout Webhook",
          );

          expect(instance.data?.createIncidents).toBe(true);
          expect(instance.data?.incidents).toHaveLength(1);

          const incident: NonNullable<
            typeof instance.data
          >["incidents"][number] = instance.data!.incidents[0]!;

          expect(incident.title).toBe("Checkout Webhook is offline");
          expect(incident.autoResolveIncident).toBe(true);
          expect(incident.incidentSeverityId?.toString()).toBe(
            INCIDENT_SEVERITY_ID.toString(),
          );
          expect(incident.onCallPolicyIds).toEqual([]);
          expect(incident.description).toContain(testCase.bodyLabel);
          expect(incident.description).toContain(KEYWORD);
        });

        test("ships an alert template that stays switched off by default", () => {
          const instance: MonitorCriteriaInstance = buildOffline(
            testCase,
            "Checkout Webhook",
          );

          expect(instance.data?.createAlerts).toBe(false);
          expect(instance.data?.alerts).toHaveLength(1);

          const alert: NonNullable<typeof instance.data>["alerts"][number] =
            instance.data!.alerts[0]!;

          expect(alert.title).toBe("Checkout Webhook is offline");
          expect(alert.autoResolveAlert).toBe(true);
          expect(alert.alertSeverityId?.toString()).toBe(
            ALERT_SEVERITY_ID.toString(),
          );
          expect(alert.description).toContain(testCase.bodyLabel);
          expect(alert.description).toContain(KEYWORD);
        });

        test("does not claim that nothing was received", () => {
          const instance: MonitorCriteriaInstance = buildOffline(testCase);

          expect(instance.data?.incidents[0]?.description).not.toContain(
            "No email received",
          );
          expect(instance.data?.alerts[0]?.description).not.toContain(
            "No email received",
          );
        });

        test("points at the offline monitor status and uses an Any filter condition", () => {
          const instance: MonitorCriteriaInstance = buildOffline(testCase);

          expect(instance.data?.monitorStatusId?.toString()).toBe(
            OFFLINE_STATUS_ID.toString(),
          );
          expect(instance.data?.filterCondition).toBe(FilterCondition.Any);
          expect(instance.data?.changeMonitorStatus).toBe(true);
        });

        test("names itself after the monitor and explains the body check", () => {
          const instance: MonitorCriteriaInstance = buildOffline(
            testCase,
            "Checkout Webhook",
          );

          expect(instance.data?.name).toBe(
            "Check if Checkout Webhook is offline",
          );
          expect(instance.data?.description).toContain(testCase.bodyLabel);
          expect(instance.data?.description).toContain("contains");
          expect(instance.data?.description).toContain(KEYWORD);
        });
      });

      describe("online and offline together", () => {
        test("are exact complements of each other", () => {
          const online: CriteriaFilter =
            buildOnline(testCase).data!.filters[0]!;
          const offline: CriteriaFilter =
            buildOffline(testCase).data!.filters[0]!;

          expect(online.checkOn).toBe(offline.checkOn);
          expect(online.value).toBe(offline.value);
          expect(online.filterType).toBe(FilterType.NotContains);
          expect(offline.filterType).toBe(FilterType.Contains);
        });

        test("target different monitor statuses", () => {
          expect(
            buildOnline(testCase).data?.monitorStatusId?.toString(),
          ).not.toBe(buildOffline(testCase).data?.monitorStatusId?.toString());
        });

        test("neither evaluates over a time window", () => {
          for (const instance of [
            buildOnline(testCase),
            buildOffline(testCase),
          ]) {
            for (const filter of instance.data!.filters) {
              expect(filter.evaluateOverTime).toBeFalsy();
              expect(filter.evaluateOverTimeOptions).toBeUndefined();
            }
          }
        });
      });

      describe("validation", () => {
        test("the online criteria is valid", () => {
          expect(
            MonitorCriteriaInstance.getValidationError(
              buildOnline(testCase),
              testCase.monitorType,
            ),
          ).toBeNull();
        });

        test("the offline criteria is valid", () => {
          expect(
            MonitorCriteriaInstance.getValidationError(
              buildOffline(testCase),
              testCase.monitorType,
            ),
          ).toBeNull();
        });

        /*
         * Contains / Not Contains are value-carrying filter types, so an
         * empty default would trip getValidationError the moment a user
         * opened the monitor form. Guard the keyword against being emptied.
         */
        test("a blank keyword would fail validation - so the default must not be blank", () => {
          const instance: MonitorCriteriaInstance = buildOnline(testCase);
          instance.data!.filters[0]!.value = "";

          expect(
            MonitorCriteriaInstance.getValidationError(
              instance,
              testCase.monitorType,
            ),
          ).toContain("Value is required");
          expect(KEYWORD).not.toBe("");
        });
      });

      describe("serialization", () => {
        test("survives a toJSON / fromJSON round-trip", () => {
          const original: MonitorCriteriaInstance = buildOffline(testCase);
          const restored: MonitorCriteriaInstance =
            MonitorCriteriaInstance.fromJSON(original.toJSON());

          expect(restored.data?.filters[0]?.checkOn).toBe(testCase.bodyCheckOn);
          expect(restored.data?.filters[0]?.filterType).toBe(
            FilterType.Contains,
          );
          expect(restored.data?.filters[0]?.value).toBe(KEYWORD);
          expect(restored.data?.filterCondition).toBe(FilterCondition.Any);
        });

        test("clone() is a deep copy of the body filter", () => {
          const original: MonitorCriteriaInstance = buildOnline(testCase);
          const clone: MonitorCriteriaInstance =
            MonitorCriteriaInstance.clone(original);

          clone.data!.filters[0]!.value = "mutated";

          expect(original.data?.filters[0]?.value).toBe(KEYWORD);
        });
      });

      describe("MonitorCriteria.getDefaultMonitorCriteria", () => {
        test("composes the offline body check first and the online body check second", () => {
          const criteria: MonitorCriteria =
            MonitorCriteria.getDefaultMonitorCriteria({
              monitorType: testCase.monitorType,
              monitorName: "Payments API",
              onlineMonitorStatusId: ONLINE_STATUS_ID,
              offlineMonitorStatusId: OFFLINE_STATUS_ID,
              defaultIncidentSeverityId: INCIDENT_SEVERITY_ID,
              defaultAlertSeverityId: ALERT_SEVERITY_ID,
            });

          const instances: Array<MonitorCriteriaInstance> =
            criteria.data!.monitorCriteriaInstanceArray;

          expect(instances).toHaveLength(2);

          expect(instances[0]?.data?.filters[0]?.checkOn).toBe(
            testCase.bodyCheckOn,
          );
          expect(instances[0]?.data?.filters[0]?.filterType).toBe(
            FilterType.Contains,
          );
          expect(instances[0]?.data?.monitorStatusId?.toString()).toBe(
            OFFLINE_STATUS_ID.toString(),
          );

          expect(instances[1]?.data?.filters[0]?.checkOn).toBe(
            testCase.bodyCheckOn,
          );
          expect(instances[1]?.data?.filters[0]?.filterType).toBe(
            FilterType.NotContains,
          );
          expect(instances[1]?.data?.monitorStatusId?.toString()).toBe(
            ONLINE_STATUS_ID.toString(),
          );
        });

        test("passes validation as a whole", () => {
          const criteria: MonitorCriteria =
            MonitorCriteria.getDefaultMonitorCriteria({
              monitorType: testCase.monitorType,
              monitorName: "Payments API",
              onlineMonitorStatusId: ONLINE_STATUS_ID,
              offlineMonitorStatusId: OFFLINE_STATUS_ID,
              defaultIncidentSeverityId: INCIDENT_SEVERITY_ID,
              defaultAlertSeverityId: ALERT_SEVERITY_ID,
            });

          expect(
            MonitorCriteria.getValidationError(criteria, testCase.monitorType),
          ).toBeNull();
        });
      });
    },
  );

  /*
   * The two incoming monitor types now share a shape but must not share
   * a CheckOn - an email monitor reading "Request Body" would evaluate
   * nothing at all.
   */
  test("each incoming monitor type reads its own body field", () => {
    const requestOnline: MonitorCriteriaInstance = buildOnline(CASES[0]!);
    const emailOnline: MonitorCriteriaInstance = buildOnline(CASES[1]!);

    expect(requestOnline.data?.filters[0]?.checkOn).toBe(CheckOn.RequestBody);
    expect(emailOnline.data?.filters[0]?.checkOn).toBe(CheckOn.EmailBody);
  });

  /*
   * Other push-driven monitor types are untouched by this change; a
   * regression there would be easy to miss because they share the same
   * builder.
   */
  test("does not change the Ping defaults", () => {
    const online: MonitorCriteriaInstance | null =
      MonitorCriteriaInstance.getDefaultOnlineMonitorCriteriaInstance({
        monitorType: MonitorType.Ping,
        monitorStatusId: ONLINE_STATUS_ID,
        monitorName: "Gateway",
      });

    expect(online?.data?.filters[0]?.checkOn).toBe(CheckOn.IsOnline);
    expect(online?.data?.filters[0]?.filterType).toBe(FilterType.True);
  });
});
