import { describe, expect, test } from "@jest/globals";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { CriteriaAlert } from "../../../Types/Monitor/CriteriaAlert";
import { CheckOn, FilterType } from "../../../Types/Monitor/CriteriaFilter";
import { CriteriaIncident } from "../../../Types/Monitor/CriteriaIncident";
import MonitorCriteria from "../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";

/*
 * Issues #3410 and #3413: "Alert title is required for criteria X" / "Incident
 * title is required for criteria X" blocked Next on the monitor criteria step
 * with the matching switch turned OFF, and there was no way out of it.
 *
 * The mechanism was a mismatch between three layers that all describe the same
 * thing:
 *
 *   - the form seeds a blank incident / alert row when you flip a switch on,
 *     and deliberately keeps that row when you flip it back off so your typing
 *     survives a mis-click;
 *   - the evaluator ignores those rows entirely while the flag is off
 *     (MonitorIncident / MonitorAlert both return early on a falsy flag);
 *   - getValidationError walked both arrays unconditionally.
 *
 * So the form demanded a title for a row that does nothing, and rendered the
 * field to type it into only while the switch was on. Turning the switch back
 * on to clear the error re-armed an action the user did not want.
 *
 * This file pins the fixed contract at every level of the chain, because the
 * error the user sees is produced four levels above where the decision is made
 * (MonitorSteps -> MonitorStep -> MonitorCriteria -> MonitorCriteriaInstance)
 * and only the top level is what the form actually calls.
 */

const MONITOR_STATUS_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const INCIDENT_SEVERITY_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const ALERT_SEVERITY_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

// The row the criteria form seeds the moment a switch is flipped on.
function blankIncident(): CriteriaIncident {
  return {
    title: "",
    description: "",
    incidentSeverityId: undefined,
    id: ObjectID.generate().toString(),
  };
}

function blankAlert(): CriteriaAlert {
  return {
    title: "",
    description: "",
    alertSeverityId: undefined,
    id: ObjectID.generate().toString(),
  };
}

function filledIncident(): CriteriaIncident {
  return {
    title: "AWS Status Page has an active incident",
    description: "",
    incidentSeverityId: INCIDENT_SEVERITY_ID,
    id: ObjectID.generate().toString(),
  };
}

function filledAlert(): CriteriaAlert {
  return {
    title: "UND66DWANRTR01 is offline",
    description: "",
    alertSeverityId: ALERT_SEVERITY_ID,
    id: ObjectID.generate().toString(),
  };
}

/*
 * A criteria in the state the reporter's screenshot shows: only "change
 * monitor status" is on, and the two other actions are off.
 */
function buildCriteria(
  overrides?: Partial<MonitorCriteriaInstance["data"]>,
): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: MONITOR_STATUS_ID,
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
    changeMonitorStatus: true,
    createIncidents: false,
    createAlerts: false,
    isEnabled: true,
    name: "Check if AWS Status Page is operational",
    description: "Checks whether the external status page is healthy",
    ...(overrides || {}),
  };
  return instance;
}

function validate(instance: MonitorCriteriaInstance): string | null {
  return MonitorCriteriaInstance.getValidationError(instance, MonitorType.Ping);
}

describe("MonitorCriteriaInstance.getValidationError - per-action gating", () => {
  describe("declare an incident (createIncidents)", () => {
    test("a blank incident row left behind by the switch does not block while the switch is off", () => {
      const instance: MonitorCriteriaInstance = buildCriteria({
        createIncidents: false,
        incidents: [blankIncident()],
      });

      expect(validate(instance)).toBeNull();
    });

    test("the same blank row does block once the switch is on", () => {
      const instance: MonitorCriteriaInstance = buildCriteria({
        createIncidents: true,
        incidents: [blankIncident()],
      });

      expect(validate(instance)).toBe(
        'Incident title is required for criteria "Check if AWS Status Page is operational"',
      );
    });

    test("a missing severity blocks only while the switch is on", () => {
      const row: CriteriaIncident = {
        ...filledIncident(),
        incidentSeverityId: undefined,
      };

      expect(
        validate(buildCriteria({ createIncidents: false, incidents: [row] })),
      ).toBeNull();
      expect(
        validate(buildCriteria({ createIncidents: true, incidents: [row] })),
      ).toBe(
        'Incident severity is required for criteria "Check if AWS Status Page is operational"',
      );
    });

    test("a fully filled incident passes with the switch on", () => {
      expect(
        validate(
          buildCriteria({
            createIncidents: true,
            incidents: [filledIncident()],
          }),
        ),
      ).toBeNull();
    });
  });

  describe("the two actions are independent", () => {
    /*
     * The recommendation flow ships exactly this shape: both payloads
     * authored, one flag on. Whichever side is off must not be able to block
     * the other, in either direction.
     */
    test("incidents on and valid, alerts off and blank", () => {
      expect(
        validate(
          buildCriteria({
            createIncidents: true,
            incidents: [filledIncident()],
            createAlerts: false,
            alerts: [blankAlert()],
          }),
        ),
      ).toBeNull();
    });

    test("alerts on and valid, incidents off and blank", () => {
      expect(
        validate(
          buildCriteria({
            createAlerts: true,
            alerts: [filledAlert()],
            createIncidents: false,
            incidents: [blankIncident()],
          }),
        ),
      ).toBeNull();
    });

    test("both on and both blank reports the incident first", () => {
      expect(
        validate(
          buildCriteria({
            createIncidents: true,
            incidents: [blankIncident()],
            createAlerts: true,
            alerts: [blankAlert()],
          }),
        ),
      ).toBe(
        'Incident title is required for criteria "Check if AWS Status Page is operational"',
      );
    });
  });

  describe("create an alert (createAlerts)", () => {
    test("a blank alert row left behind by the switch does not block while the switch is off", () => {
      const instance: MonitorCriteriaInstance = buildCriteria({
        createAlerts: false,
        alerts: [blankAlert()],
      });

      expect(validate(instance)).toBeNull();
    });

    test("the same blank row does block once the switch is on", () => {
      const instance: MonitorCriteriaInstance = buildCriteria({
        createAlerts: true,
        alerts: [blankAlert()],
      });

      expect(validate(instance)).toBe(
        'Alert title is required for criteria "Check if AWS Status Page is operational"',
      );
    });

    test("typing the title clears the error - the whole of #3410 step 3", () => {
      const instance: MonitorCriteriaInstance = buildCriteria({
        createAlerts: true,
        alerts: [blankAlert()],
      });
      expect(validate(instance)).toContain("Alert title is required");

      instance.data!.alerts = [
        { ...instance.data!.alerts[0]!, title: "UND66DWANRTR01 is offline" },
      ];
      expect(validate(instance)).toContain("Alert severity is required");

      instance.data!.alerts = [
        { ...instance.data!.alerts[0]!, alertSeverityId: ALERT_SEVERITY_ID },
      ];
      expect(validate(instance)).toBeNull();
    });

    test("a missing severity blocks only while the switch is on", () => {
      const row: CriteriaAlert = {
        ...filledAlert(),
        alertSeverityId: undefined,
      };

      expect(
        validate(buildCriteria({ createAlerts: false, alerts: [row] })),
      ).toBeNull();
      expect(
        validate(buildCriteria({ createAlerts: true, alerts: [row] })),
      ).toBe(
        'Alert severity is required for criteria "Check if AWS Status Page is operational"',
      );
    });
  });

  describe("description is optional", () => {
    /*
     * The criteria form marks Title and Severity `required`; the description
     * sits in a collapsed section labelled "Optional incident description" /
     * "Optional alert description", and Incident.description and
     * Alert.description are both nullable columns. Requiring it here left the
     * form stuck on a field the UI calls optional and folds out of sight,
     * which is why #3410 reads "permanently stuck with no way to proceed".
     */
    test("an incident with a title and a severity passes with no description", () => {
      expect(
        validate(
          buildCriteria({
            createIncidents: true,
            incidents: [{ ...filledIncident(), description: "" }],
          }),
        ),
      ).toBeNull();
    });

    test("an alert with a title and a severity passes with no description", () => {
      expect(
        validate(
          buildCriteria({
            createAlerts: true,
            alerts: [{ ...filledAlert(), description: "" }],
          }),
        ),
      ).toBeNull();
    });

    test("an absent description is accepted too", () => {
      /*
       * CriteriaAlert types description as a string, but nothing enforces
       * that on the way in from the REST API, so the absent case is reachable
       * with a payload authored outside the form.
       */
      const row: CriteriaAlert = {
        ...filledAlert(),
        description: undefined as unknown as string,
      };

      expect(
        validate(buildCriteria({ createAlerts: true, alerts: [row] })),
      ).toBeNull();
    });
  });

  describe("every monitor type", () => {
    /*
     * #3410 reports this "affects most/all Monitor types during creation".
     * The gate lives above the per-type filter rules, so it should hold for
     * every type in the enum - driven from Object.values so a new monitor
     * type is covered the day it is added. IsOnline/True is the one filter
     * shape no type rejects.
     */
    const ALL_MONITOR_TYPES: Array<MonitorType> = Object.values(MonitorType);

    test("the enum is not empty, so the loops below mean something", () => {
      expect(ALL_MONITOR_TYPES.length).toBeGreaterThan(10);
    });

    test("a switched-off action never blocks, whatever the monitor type", () => {
      for (const monitorType of ALL_MONITOR_TYPES) {
        const instance: MonitorCriteriaInstance = buildCriteria({
          createIncidents: false,
          incidents: [blankIncident()],
          createAlerts: false,
          alerts: [blankAlert()],
        });

        expect(
          MonitorCriteriaInstance.getValidationError(instance, monitorType),
        ).toBeNull();
      }
    });

    test("a switched-on action still blocks, whatever the monitor type", () => {
      for (const monitorType of ALL_MONITOR_TYPES) {
        const instance: MonitorCriteriaInstance = buildCriteria({
          createAlerts: true,
          alerts: [blankAlert()],
        });

        expect(
          MonitorCriteriaInstance.getValidationError(instance, monitorType),
        ).toContain("Alert title is required");
      }
    });
  });

  describe("checks that are not action-gated still run", () => {
    test("the criteria's own name and description are still required", () => {
      expect(validate(buildCriteria({ name: "" }))).toContain(
        "Name is required",
      );
      expect(validate(buildCriteria({ description: "" }))).toContain(
        "Description is required",
      );
    });

    test("filters are still required and still type-checked", () => {
      expect(validate(buildCriteria({ filters: [] }))).toContain(
        "Filter is required",
      );
      expect(
        MonitorCriteriaInstance.getValidationError(
          buildCriteria({
            filters: [
              {
                checkOn: CheckOn.DiskUsagePercent,
                filterType: FilterType.GreaterThan,
                value: 90,
              },
            ],
          }),
          MonitorType.Ping,
        ),
      ).toContain("Ping Monitor cannot have filter type");
    });

    test("an empty array with the switch on is not an error", () => {
      /*
       * NetworkDeviceAlertPackUtil.buildCriteriaInstances ships exactly this:
       * createIncidents / createAlerts on with empty arrays, for the user to
       * fill in. Requiring a row here would break "Add Recommended Alerts".
       */
      expect(
        validate(
          buildCriteria({
            createIncidents: true,
            incidents: [],
            createAlerts: true,
            alerts: [],
          }),
        ),
      ).toBeNull();
    });

    test("a null row inside a populated array is still skipped", () => {
      const instance: MonitorCriteriaInstance = buildCriteria({
        createAlerts: true,
        alerts: [
          undefined as unknown as CriteriaAlert,
          filledAlert(),
        ] as Array<CriteriaAlert>,
      });

      expect(validate(instance)).toBeNull();
    });
  });

  describe("flag provenance", () => {
    test("a criteria saved before the flags existed is treated as off, exactly as the evaluator treats it", () => {
      /*
       * The predicate is the falsy one (`!data.createAlerts`), matching
       * MonitorAlert / MonitorIncident. A row written before these flags
       * shipped deserialises with the flag absent -> false, so it creates
       * nothing at runtime; validating it would block a save over a payload
       * that does nothing.
       */
      const json: JSONObject = buildCriteria({
        alerts: [blankAlert()],
      }).toJSON();
      delete (json["value"] as JSONObject)["createAlerts"];
      delete (json["value"] as JSONObject)["createIncidents"];

      const restored: MonitorCriteriaInstance =
        MonitorCriteriaInstance.fromJSON(json);

      expect(restored.data?.createAlerts).toBe(false);
      expect(validate(restored)).toBeNull();
    });

    test("the gate survives a toJSON / fromJSON round-trip in both directions", () => {
      const on: MonitorCriteriaInstance = MonitorCriteriaInstance.fromJSON(
        buildCriteria({
          createAlerts: true,
          alerts: [blankAlert()],
        }).toJSON(),
      );
      expect(validate(on)).toContain("Alert title is required");

      const off: MonitorCriteriaInstance = MonitorCriteriaInstance.fromJSON(
        buildCriteria({
          createAlerts: false,
          alerts: [blankAlert()],
        }).toJSON(),
      );
      expect(validate(off)).toBeNull();
    });

    test("clone() carries the gate", () => {
      const off: MonitorCriteriaInstance = MonitorCriteriaInstance.clone(
        buildCriteria({ createIncidents: false, incidents: [blankIncident()] }),
      );
      expect(validate(off)).toBeNull();
    });

    test("the setters flip the gate", () => {
      const instance: MonitorCriteriaInstance = buildCriteria({
        alerts: [blankAlert()],
      });

      instance.setCreateAlerts(true);
      expect(validate(instance)).toContain("Alert title is required");

      instance.setCreateAlerts(false);
      expect(validate(instance)).toBeNull();
    });
  });
});

/*
 * The form never calls MonitorCriteriaInstance.getValidationError directly -
 * it calls MonitorSteps.getValidationError, which walks down through
 * MonitorStep and MonitorCriteria. A gate that worked only at the bottom
 * level would still block Next, so each level is pinned here.
 */
describe("the gate reaches the error the form actually shows", () => {
  function stepsWith(instance: MonitorCriteriaInstance): MonitorSteps {
    const criteria: MonitorCriteria = new MonitorCriteria();
    criteria.data = { monitorCriteriaInstanceArray: [instance] };

    const step: MonitorStep = new MonitorStep();
    step.data = {
      ...step.data!,
      monitorDestination: undefined,
      monitorCriteria: criteria,
    };

    const steps: MonitorSteps = new MonitorSteps();
    steps.data = {
      monitorStepsInstanceArray: [step],
      defaultMonitorStatusId: MONITOR_STATUS_ID,
    };
    return steps;
  }

  test("MonitorCriteria.getValidationError respects the switch", () => {
    const criteria: MonitorCriteria = new MonitorCriteria();
    criteria.data = {
      monitorCriteriaInstanceArray: [
        buildCriteria({ createIncidents: false, incidents: [blankIncident()] }),
      ],
    };

    expect(
      MonitorCriteria.getValidationError(criteria, MonitorType.Manual),
    ).toBeNull();

    criteria.data.monitorCriteriaInstanceArray[0]!.setCreateIncidents(true);
    expect(
      MonitorCriteria.getValidationError(criteria, MonitorType.Manual),
    ).toContain("Incident title is required");
  });

  test("MonitorStep.getValidationError respects the switch", () => {
    const offInstance: MonitorCriteriaInstance = buildCriteria({
      createAlerts: false,
      alerts: [blankAlert()],
    });
    const step: MonitorStep =
      stepsWith(offInstance).data!.monitorStepsInstanceArray[0]!;

    expect(MonitorStep.getValidationError(step, MonitorType.Manual)).toBeNull();

    offInstance.setCreateAlerts(true);
    expect(MonitorStep.getValidationError(step, MonitorType.Manual)).toContain(
      "Alert title is required",
    );
  });

  test("MonitorSteps.getValidationError - the exact call the create form makes - respects the switch", () => {
    const instance: MonitorCriteriaInstance = buildCriteria({
      createIncidents: false,
      incidents: [blankIncident()],
      createAlerts: false,
      alerts: [blankAlert()],
    });

    const steps: MonitorSteps = stepsWith(instance);

    expect(
      MonitorSteps.getValidationError(steps, MonitorType.Manual),
    ).toBeNull();

    /*
     * And the other direction from the same object, so this pins the gate
     * rather than just "these steps happen to be valid".
     */
    instance.setCreateIncidents(true);
    expect(MonitorSteps.getValidationError(steps, MonitorType.Manual)).toBe(
      'Incident title is required for criteria "Check if AWS Status Page is operational"',
    );

    instance.setCreateIncidents(false);
    instance.setCreateAlerts(true);
    expect(MonitorSteps.getValidationError(steps, MonitorType.Manual)).toBe(
      'Alert title is required for criteria "Check if AWS Status Page is operational"',
    );
  });

  test("one criteria with its switch on still blocks the whole form", () => {
    const criteria: MonitorCriteria = new MonitorCriteria();
    criteria.data = {
      monitorCriteriaInstanceArray: [
        buildCriteria({ createAlerts: false, alerts: [blankAlert()] }),
        buildCriteria({
          name: "Check if AWS Status Page is down",
          createIncidents: true,
          incidents: [blankIncident()],
        }),
      ],
    };

    expect(
      MonitorCriteria.getValidationError(criteria, MonitorType.Manual),
    ).toBe(
      'Incident title is required for criteria "Check if AWS Status Page is down"',
    );
  });
});
