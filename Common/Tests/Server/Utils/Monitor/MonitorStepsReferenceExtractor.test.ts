import MonitorStepsReferenceExtractor, {
  MonitorStepsReference,
  MonitorStepsReferenceModel,
  toReferenceId,
} from "../../../../Server/Utils/Monitor/MonitorStepsReferenceExtractor";
import { JSONObject, JSONValue, ObjectType } from "../../../../Types/JSON";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, it } from "@jest/globals";

/*
 * Contract under test: tell a real reference inside monitorSteps apart from the
 * many uuids in there that are NOT references.
 *
 * This is the whole reason issue #3039 could not be fixed before. The old guard
 * scraped every uuid out of the serialized blob with a regex, so it could only
 * ever ask "does this happen to be another project's record?" — asking "does
 * this exist?" would have rejected every step id, criteria id and
 * incident/alert template id, none of which match a row anywhere.
 *
 * Reading the structure instead means every id that comes back is known to
 * point at a specific model, so it can be required to exist.
 */

const STATUS_ID: string = "0a3f7e0e-0a4a-4f3f-8b46-0f4f1e2d5c60";
const DEFAULT_STATUS_ID: string = "5e8b6bd1-3a09-4b0b-9a4e-2a76b0a1c111";
const INCIDENT_SEVERITY_ID: string = "9b1c1c1e-8a11-4a6f-9c31-6d2f0b6d4a22";
const ALERT_SEVERITY_ID: string = "c31b3a44-1f60-4a1d-95bb-3e0e6f9a7d33";
const ON_CALL_POLICY_ID: string = "d40e5c55-2b71-4b2e-86cc-4f1f7a0b8e44";
const LABEL_ID: string = "e51f6d66-3c82-4c3f-97dd-501a8b1c9f55";
const TEAM_ID: string = "f6207e77-4d93-4d40-a8ee-612b9c2daa66";
const USER_ID: string = "07318f88-5ea4-4e51-b9ff-723cad3ebb77";
const ROLE_ID: string = "1842909a-6fb5-4f62-8a00-834dbe4fcc88";
const TELEMETRY_SERVICE_ID: string = "29530aab-70c6-4073-9b11-945ecf50dd99";
const NETWORK_DEVICE_ID: string = "3a641bbc-81d7-4184-8c22-a56fd0610eaa";

// Local identity, not a pointer at another row. None of these may be returned.
const STEP_ID: string = "4b752ccd-92e8-4295-9d33-b670e1721fbb";
const CRITERIA_ID: string = "5c863dde-a3f9-43a6-8e44-c781f2832acc";
const INCIDENT_TEMPLATE_ID: string = "6d974eef-b40a-44b7-9f55-d892031943dd";
const ALERT_TEMPLATE_ID: string = "7ea85ff0-c51b-45c8-a066-e9a3142a54ee";

/*
 * `{"_type":"ObjectID","value":"…"}` — how JSONFunctions.serialize writes the
 * ObjectIDs nested inside the incidents and alerts arrays.
 */
const objectIdJSON: (id: string) => JSONObject = (id: string): JSONObject => {
  return { _type: ObjectType.ObjectID, value: id };
};

const criteriaInstance: (overrides: JSONObject) => JSONObject = (
  overrides: JSONObject,
): JSONObject => {
  return {
    _type: ObjectType.MonitorCriteriaInstance,
    value: {
      id: CRITERIA_ID,
      name: "Monitor is offline",
      description: "",
      filterCondition: "all",
      filters: [],
      incidents: [],
      alerts: [],
      ...overrides,
    },
  };
};

const stepsWithCriteria: (
  instances: Array<JSONObject>,
  stepOverrides?: JSONObject,
) => JSONObject = (
  instances: Array<JSONObject>,
  stepOverrides?: JSONObject,
): JSONObject => {
  return {
    _type: ObjectType.MonitorSteps,
    value: {
      defaultMonitorStatusId: DEFAULT_STATUS_ID,
      monitorStepsInstanceArray: [
        {
          _type: ObjectType.MonitorStep,
          value: {
            id: STEP_ID,
            ...(stepOverrides || {}),
            monitorCriteria: {
              _type: ObjectType.MonitorCriteria,
              value: {
                monitorCriteriaInstanceArray: instances,
              },
            },
          },
        },
      ],
    },
  };
};

const idsFor: (
  references: Array<MonitorStepsReference>,
  model: MonitorStepsReferenceModel,
) => Array<string> = (
  references: Array<MonitorStepsReference>,
  model: MonitorStepsReferenceModel,
): Array<string> => {
  return references
    .filter((reference: MonitorStepsReference) => {
      return reference.model === model;
    })
    .map((reference: MonitorStepsReference) => {
      return reference.id;
    });
};

const findById: (
  references: Array<MonitorStepsReference>,
  id: string,
) => MonitorStepsReference | undefined = (
  references: Array<MonitorStepsReference>,
  id: string,
): MonitorStepsReference | undefined => {
  return references.find((reference: MonitorStepsReference) => {
    return reference.id === id;
  });
};

describe("MonitorStepsReferenceExtractor", () => {
  describe("what counts as a reference", () => {
    it("returns the default monitor status", () => {
      const references: Array<MonitorStepsReference> =
        MonitorStepsReferenceExtractor.extract(stepsWithCriteria([]));

      expect(
        idsFor(references, MonitorStepsReferenceModel.MonitorStatus),
      ).toEqual([DEFAULT_STATUS_ID]);
    });

    it("returns the status a criteria switches the monitor to", () => {
      const references: Array<MonitorStepsReference> =
        MonitorStepsReferenceExtractor.extract(
          stepsWithCriteria([
            criteriaInstance({
              monitorStatusId: STATUS_ID,
              changeMonitorStatus: true,
            }),
          ]),
        );

      expect(
        idsFor(references, MonitorStepsReferenceModel.MonitorStatus),
      ).toContain(STATUS_ID);
    });

    it("returns every id a criteria's incident template carries", () => {
      const references: Array<MonitorStepsReference> =
        MonitorStepsReferenceExtractor.extract(
          stepsWithCriteria([
            criteriaInstance({
              createIncidents: true,
              incidents: [
                {
                  id: INCIDENT_TEMPLATE_ID,
                  title: "Down",
                  description: "",
                  incidentSeverityId: objectIdJSON(INCIDENT_SEVERITY_ID),
                  onCallPolicyIds: [objectIdJSON(ON_CALL_POLICY_ID)],
                  labelIds: [objectIdJSON(LABEL_ID)],
                  ownerTeamIds: [objectIdJSON(TEAM_ID)],
                  ownerUserIds: [objectIdJSON(USER_ID)],
                  incidentMemberRoles: [
                    {
                      roleId: objectIdJSON(ROLE_ID),
                      userId: objectIdJSON(USER_ID),
                    },
                  ],
                },
              ],
            }),
          ]),
        );

      expect(
        idsFor(references, MonitorStepsReferenceModel.IncidentSeverity),
      ).toEqual([INCIDENT_SEVERITY_ID]);
      expect(
        idsFor(references, MonitorStepsReferenceModel.OnCallDutyPolicy),
      ).toEqual([ON_CALL_POLICY_ID]);
      expect(idsFor(references, MonitorStepsReferenceModel.Label)).toEqual([
        LABEL_ID,
      ]);
      expect(idsFor(references, MonitorStepsReferenceModel.Team)).toEqual([
        TEAM_ID,
      ]);
      expect(
        idsFor(references, MonitorStepsReferenceModel.IncidentRole),
      ).toEqual([ROLE_ID]);
      // Once as an owner and once as the member the role is assigned to.
      expect(idsFor(references, MonitorStepsReferenceModel.User)).toEqual([
        USER_ID,
        USER_ID,
      ]);
    });

    it("returns every id a criteria's alert template carries", () => {
      const references: Array<MonitorStepsReference> =
        MonitorStepsReferenceExtractor.extract(
          stepsWithCriteria([
            criteriaInstance({
              createAlerts: true,
              alerts: [
                {
                  id: ALERT_TEMPLATE_ID,
                  title: "Down",
                  description: "",
                  alertSeverityId: objectIdJSON(ALERT_SEVERITY_ID),
                  onCallPolicyIds: [objectIdJSON(ON_CALL_POLICY_ID)],
                  labelIds: [objectIdJSON(LABEL_ID)],
                  ownerTeamIds: [objectIdJSON(TEAM_ID)],
                  ownerUserIds: [objectIdJSON(USER_ID)],
                },
              ],
            }),
          ]),
        );

      expect(
        idsFor(references, MonitorStepsReferenceModel.AlertSeverity),
      ).toEqual([ALERT_SEVERITY_ID]);
      expect(
        idsFor(references, MonitorStepsReferenceModel.OnCallDutyPolicy),
      ).toEqual([ON_CALL_POLICY_ID]);
      expect(idsFor(references, MonitorStepsReferenceModel.Label)).toEqual([
        LABEL_ID,
      ]);
      expect(idsFor(references, MonitorStepsReferenceModel.Team)).toEqual([
        TEAM_ID,
      ]);
      expect(idsFor(references, MonitorStepsReferenceModel.User)).toEqual([
        USER_ID,
      ]);
    });

    it("returns the telemetry services a step is scoped to, from every sub-config that carries them", () => {
      for (const field of [
        "logMonitor",
        "traceMonitor",
        "exceptionMonitor",
        "profileMonitor",
        "metricMonitor",
      ]) {
        const references: Array<MonitorStepsReference> =
          MonitorStepsReferenceExtractor.extract(
            stepsWithCriteria([], {
              [field]: {
                telemetryServiceIds: [objectIdJSON(TELEMETRY_SERVICE_ID)],
              },
            }),
          );

        expect(
          idsFor(references, MonitorStepsReferenceModel.TelemetryService),
        ).toEqual([TELEMETRY_SERVICE_ID]);
      }
    });

    it("returns the device a network device step walks", () => {
      const references: Array<MonitorStepsReference> =
        MonitorStepsReferenceExtractor.extract(
          stepsWithCriteria([], {
            networkDeviceMonitor: { networkDeviceId: NETWORK_DEVICE_ID },
          }),
        );

      expect(
        idsFor(references, MonitorStepsReferenceModel.NetworkDevice),
      ).toEqual([NETWORK_DEVICE_ID]);
    });
  });

  describe("what is NOT a reference", () => {
    it("never returns the step id, the criteria id, or an incident/alert template id", () => {
      /*
       * These are all `ObjectID.generate()` values minted client-side for local
       * identity — Terraform never sends them, so they are minted again on
       * every write. They match no row anywhere, and returning them is exactly
       * what stopped the old regex-based guard from checking existence.
       */
      const references: Array<MonitorStepsReference> =
        MonitorStepsReferenceExtractor.extract(
          stepsWithCriteria([
            criteriaInstance({
              createIncidents: true,
              createAlerts: true,
              incidents: [
                { id: INCIDENT_TEMPLATE_ID, title: "t", description: "" },
              ],
              alerts: [{ id: ALERT_TEMPLATE_ID, title: "t", description: "" }],
            }),
          ]),
        );

      const returned: Array<string> = references.map(
        (reference: MonitorStepsReference) => {
          return reference.id;
        },
      );

      expect(returned).not.toContain(STEP_ID);
      expect(returned).not.toContain(CRITERIA_ID);
      expect(returned).not.toContain(INCIDENT_TEMPLATE_ID);
      expect(returned).not.toContain(ALERT_TEMPLATE_ID);
    });

    it("skips a blank id rather than reporting it as a missing reference", () => {
      /*
       * A stored `{"_type":"ObjectID","value":""}` rehydrates to
       * `new ObjectID("")`, which is truthy. Reporting it as a missing
       * *reference* would be misleading — it is an unset field, and the
       * required-field checks own that case.
       */
      const references: Array<MonitorStepsReference> =
        MonitorStepsReferenceExtractor.extract(
          stepsWithCriteria([
            criteriaInstance({
              monitorStatusId: "",
              changeMonitorStatus: true,
              createIncidents: true,
              incidents: [
                {
                  id: INCIDENT_TEMPLATE_ID,
                  title: "t",
                  description: "",
                  incidentSeverityId: objectIdJSON(""),
                },
              ],
            }),
          ]),
        );

      expect(
        idsFor(references, MonitorStepsReferenceModel.IncidentSeverity),
      ).toEqual([]);
      expect(
        idsFor(references, MonitorStepsReferenceModel.MonitorStatus),
      ).toEqual([DEFAULT_STATUS_ID]);
    });
  });

  describe("isOperative — which references the monitor actually reads", () => {
    it("marks the default monitor status operative, because the monitor is stamped with it", () => {
      const references: Array<MonitorStepsReference> =
        MonitorStepsReferenceExtractor.extract(stepsWithCriteria([]));

      expect(findById(references, DEFAULT_STATUS_ID)?.isOperative).toBe(true);
    });

    it("marks a criteria status operative only when the criteria changes the status", () => {
      const on: Array<MonitorStepsReference> =
        MonitorStepsReferenceExtractor.extract(
          stepsWithCriteria([
            criteriaInstance({
              monitorStatusId: STATUS_ID,
              changeMonitorStatus: true,
            }),
          ]),
        );

      const off: Array<MonitorStepsReference> =
        MonitorStepsReferenceExtractor.extract(
          stepsWithCriteria([
            criteriaInstance({
              monitorStatusId: STATUS_ID,
              changeMonitorStatus: false,
            }),
          ]),
        );

      expect(findById(on, STATUS_ID)?.isOperative).toBe(true);
      expect(findById(off, STATUS_ID)?.isOperative).toBe(false);
    });

    it("marks incident template ids operative only when the criteria creates incidents", () => {
      const incidents: Array<JSONValue> = [
        {
          id: INCIDENT_TEMPLATE_ID,
          title: "t",
          description: "",
          incidentSeverityId: objectIdJSON(INCIDENT_SEVERITY_ID),
          onCallPolicyIds: [objectIdJSON(ON_CALL_POLICY_ID)],
        },
      ];

      const on: Array<MonitorStepsReference> =
        MonitorStepsReferenceExtractor.extract(
          stepsWithCriteria([
            criteriaInstance({ createIncidents: true, incidents: incidents }),
          ]),
        );

      const off: Array<MonitorStepsReference> =
        MonitorStepsReferenceExtractor.extract(
          stepsWithCriteria([
            criteriaInstance({ createIncidents: false, incidents: incidents }),
          ]),
        );

      expect(findById(on, INCIDENT_SEVERITY_ID)?.isOperative).toBe(true);
      expect(findById(on, ON_CALL_POLICY_ID)?.isOperative).toBe(true);
      expect(findById(off, INCIDENT_SEVERITY_ID)?.isOperative).toBe(false);
      expect(findById(off, ON_CALL_POLICY_ID)?.isOperative).toBe(false);
    });

    it("marks alert template ids operative only when the criteria creates alerts", () => {
      const alerts: Array<JSONValue> = [
        {
          id: ALERT_TEMPLATE_ID,
          title: "t",
          description: "",
          alertSeverityId: objectIdJSON(ALERT_SEVERITY_ID),
        },
      ];

      const on: Array<MonitorStepsReference> =
        MonitorStepsReferenceExtractor.extract(
          stepsWithCriteria([
            criteriaInstance({ createAlerts: true, alerts: alerts }),
          ]),
        );

      const off: Array<MonitorStepsReference> =
        MonitorStepsReferenceExtractor.extract(
          stepsWithCriteria([
            criteriaInstance({ createAlerts: false, alerts: alerts }),
          ]),
        );

      expect(findById(on, ALERT_SEVERITY_ID)?.isOperative).toBe(true);
      expect(findById(off, ALERT_SEVERITY_ID)?.isOperative).toBe(false);
    });

    it("never marks a telemetry service or network device operative", () => {
      /*
       * Neither can produce the foreign key violation this guard exists for,
       * both already degrade on their own when the target is gone, and
       * deleting a telemetry service is ordinary enough that requiring it would
       * refuse every later edit of a monitor that once watched it.
       */
      const references: Array<MonitorStepsReference> =
        MonitorStepsReferenceExtractor.extract(
          stepsWithCriteria([], {
            logMonitor: {
              telemetryServiceIds: [objectIdJSON(TELEMETRY_SERVICE_ID)],
            },
            networkDeviceMonitor: { networkDeviceId: NETWORK_DEVICE_ID },
          }),
        );

      expect(findById(references, TELEMETRY_SERVICE_ID)?.isOperative).toBe(
        false,
      );
      expect(findById(references, NETWORK_DEVICE_ID)?.isOperative).toBe(false);
    });
  });

  describe("the shapes monitorSteps actually arrives in", () => {
    it("walks a live MonitorSteps object, not just its serialized form", () => {
      const monitorSteps: MonitorSteps = MonitorSteps.fromJSON(
        stepsWithCriteria([
          criteriaInstance({
            monitorStatusId: STATUS_ID,
            changeMonitorStatus: true,
          }),
        ]),
      );

      const references: Array<MonitorStepsReference> =
        MonitorStepsReferenceExtractor.extract(monitorSteps);

      expect(
        idsFor(references, MonitorStepsReferenceModel.MonitorStatus).sort(),
      ).toEqual([DEFAULT_STATUS_ID, STATUS_ID].sort());
    });

    it("accepts a payload with no _type/value envelope", () => {
      /*
       * A hand-written REST body does not have to carry the envelopes the
       * dashboard emits, and it must be walked just as thoroughly.
       */
      const references: Array<MonitorStepsReference> =
        MonitorStepsReferenceExtractor.extract({
          defaultMonitorStatusId: DEFAULT_STATUS_ID,
          monitorStepsInstanceArray: [
            {
              id: STEP_ID,
              monitorCriteria: {
                monitorCriteriaInstanceArray: [
                  {
                    id: CRITERIA_ID,
                    monitorStatusId: STATUS_ID,
                    changeMonitorStatus: true,
                    incidents: [],
                    alerts: [],
                  },
                ],
              },
            },
          ],
        });

      expect(
        idsFor(references, MonitorStepsReferenceModel.MonitorStatus).sort(),
      ).toEqual([DEFAULT_STATUS_ID, STATUS_ID].sort());
    });

    it("reads an id whether it is a bare uuid or an ObjectID envelope", () => {
      const bare: Array<MonitorStepsReference> =
        MonitorStepsReferenceExtractor.extract(
          stepsWithCriteria([
            criteriaInstance({
              createIncidents: true,
              incidents: [
                {
                  id: INCIDENT_TEMPLATE_ID,
                  title: "t",
                  description: "",
                  incidentSeverityId: INCIDENT_SEVERITY_ID,
                },
              ],
            }),
          ]),
        );

      const wrapped: Array<MonitorStepsReference> =
        MonitorStepsReferenceExtractor.extract(
          stepsWithCriteria([
            criteriaInstance({
              createIncidents: true,
              incidents: [
                {
                  id: INCIDENT_TEMPLATE_ID,
                  title: "t",
                  description: "",
                  incidentSeverityId: objectIdJSON(INCIDENT_SEVERITY_ID),
                },
              ],
            }),
          ]),
        );

      expect(idsFor(bare, MonitorStepsReferenceModel.IncidentSeverity)).toEqual(
        [INCIDENT_SEVERITY_ID],
      );
      expect(
        idsFor(wrapped, MonitorStepsReferenceModel.IncidentSeverity),
      ).toEqual([INCIDENT_SEVERITY_ID]);
    });

    it("walks every step and every criteria, not just the first", () => {
      const references: Array<MonitorStepsReference> =
        MonitorStepsReferenceExtractor.extract({
          _type: ObjectType.MonitorSteps,
          value: {
            defaultMonitorStatusId: DEFAULT_STATUS_ID,
            monitorStepsInstanceArray: [
              {
                _type: ObjectType.MonitorStep,
                value: {
                  id: STEP_ID,
                  monitorCriteria: {
                    _type: ObjectType.MonitorCriteria,
                    value: {
                      monitorCriteriaInstanceArray: [
                        criteriaInstance({
                          monitorStatusId: STATUS_ID,
                          changeMonitorStatus: true,
                        }),
                      ],
                    },
                  },
                },
              },
              {
                _type: ObjectType.MonitorStep,
                value: {
                  id: STEP_ID,
                  monitorCriteria: {
                    _type: ObjectType.MonitorCriteria,
                    value: {
                      monitorCriteriaInstanceArray: [
                        criteriaInstance({
                          createAlerts: true,
                          alerts: [
                            {
                              id: ALERT_TEMPLATE_ID,
                              title: "t",
                              description: "",
                              alertSeverityId: objectIdJSON(ALERT_SEVERITY_ID),
                            },
                          ],
                        }),
                      ],
                    },
                  },
                },
              },
            ],
          },
        });

      expect(
        idsFor(references, MonitorStepsReferenceModel.MonitorStatus),
      ).toContain(STATUS_ID);
      expect(
        idsFor(references, MonitorStepsReferenceModel.AlertSeverity),
      ).toEqual([ALERT_SEVERITY_ID]);
    });

    it("returns nothing rather than throwing on absent or malformed input", () => {
      /*
       * monitorSteps is a free-form JSON column and older rows can be
       * malformed — MonitorSteps.fromDatabase is deliberately lenient about
       * that for the same reason. A guard that threw here would make such a row
       * impossible to save OR delete.
       */
      expect(MonitorStepsReferenceExtractor.extract(undefined)).toEqual([]);
      expect(MonitorStepsReferenceExtractor.extract(null)).toEqual([]);
      expect(MonitorStepsReferenceExtractor.extract({})).toEqual([]);
      expect(
        MonitorStepsReferenceExtractor.extract({
          _type: ObjectType.MonitorSteps,
          value: { monitorStepsInstanceArray: "not an array" },
        }),
      ).toEqual([]);
      expect(
        MonitorStepsReferenceExtractor.extract({
          _type: ObjectType.MonitorSteps,
          value: {
            monitorStepsInstanceArray: [null, 7, "nope", { value: null }],
          },
        }),
      ).toEqual([]);
      expect(
        MonitorStepsReferenceExtractor.extract(new MonitorSteps()),
      ).toEqual([]);
    });
  });

  describe("path — where the message points the user", () => {
    it("names the criteria and the field", () => {
      const references: Array<MonitorStepsReference> =
        MonitorStepsReferenceExtractor.extract(
          stepsWithCriteria([
            criteriaInstance({
              monitorStatusId: STATUS_ID,
              changeMonitorStatus: true,
              createIncidents: true,
              incidents: [
                {
                  id: INCIDENT_TEMPLATE_ID,
                  title: "t",
                  description: "",
                  incidentSeverityId: objectIdJSON(INCIDENT_SEVERITY_ID),
                  onCallPolicyIds: [objectIdJSON(ON_CALL_POLICY_ID)],
                },
              ],
            }),
          ]),
        );

      expect(findById(references, DEFAULT_STATUS_ID)?.path).toBe(
        "default monitor status",
      );
      expect(findById(references, STATUS_ID)?.path).toBe(
        'criteria "Monitor is offline" monitor status',
      );
      expect(findById(references, INCIDENT_SEVERITY_ID)?.path).toBe(
        'criteria "Monitor is offline" incident severity',
      );
      expect(findById(references, ON_CALL_POLICY_ID)?.path).toBe(
        'criteria "Monitor is offline" incident on-call policy',
      );
    });

    it("falls back to the criteria's position when it has no name", () => {
      const references: Array<MonitorStepsReference> =
        MonitorStepsReferenceExtractor.extract(
          stepsWithCriteria([
            criteriaInstance({
              name: "",
              monitorStatusId: STATUS_ID,
              changeMonitorStatus: true,
            }),
          ]),
        );

      expect(findById(references, STATUS_ID)?.path).toBe(
        'criteria "#1" monitor status',
      );
    });
  });

  describe("toReferenceId", () => {
    it("reads every shape an id arrives in", () => {
      expect(toReferenceId(STATUS_ID)).toBe(STATUS_ID);
      expect(toReferenceId(new ObjectID(STATUS_ID))).toBe(STATUS_ID);
      expect(toReferenceId(objectIdJSON(STATUS_ID))).toBe(STATUS_ID);
      // The marker-less `{ value }` shape MonitorCriteriaInstance.fromJSON accepts.
      expect(toReferenceId({ value: STATUS_ID })).toBe(STATUS_ID);
      expect(toReferenceId(`  ${STATUS_ID}  `)).toBe(STATUS_ID);
    });

    it("treats absent, blank and non-id values as no reference", () => {
      expect(toReferenceId(undefined)).toBeNull();
      expect(toReferenceId(null)).toBeNull();
      expect(toReferenceId("")).toBeNull();
      expect(toReferenceId("   ")).toBeNull();
      expect(toReferenceId(objectIdJSON(""))).toBeNull();
      expect(toReferenceId(new ObjectID(""))).toBeNull();
      expect(toReferenceId(42)).toBeNull();
      expect(toReferenceId([STATUS_ID] as unknown as JSONValue)).toBeNull();
      expect(toReferenceId({ notAValue: STATUS_ID })).toBeNull();
    });
  });
});
