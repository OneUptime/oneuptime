import AlertMeasurementAnchorType from "../../../Types/Alerts/AlertMeasurementAnchorType";
import AlertStateRole from "../../../Types/Alerts/AlertStateRole";
import IncidentMeasurementAnchorType from "../../../Types/Incident/IncidentMeasurementAnchorType";
import IncidentStateRole from "../../../Types/Incident/IncidentStateRole";
import MeasurementOccurrence from "../../../Types/Measurement/MeasurementOccurrence";
import ScheduledMaintenanceMeasurementAnchorType from "../../../Types/ScheduledMaintenance/ScheduledMaintenanceMeasurementAnchorType";
import ScheduledMaintenanceStateRole from "../../../Types/ScheduledMaintenance/ScheduledMaintenanceStateRole";
import MeasurementDefinitionValidator from "../../../Server/Utils/Measurement/MeasurementDefinitionValidator";
import {
  CUSTOM_MEASUREMENT_PRESET_ID,
  MEASUREMENT_DELETED_STATE_LABEL,
  MEASUREMENT_LAST_TIME_TEMPLATE,
  MeasurementAnchor,
  MeasurementDomain,
  MeasurementMoment,
  MeasurementPreset,
  canMeasurementMomentRepeat,
  describeMeasurementEnd,
  findMeasurementMoment,
  getDefaultMeasurementStartMoment,
  getMeasurementAnchorForMoment,
  getMeasurementMoment,
  getMeasurementMomentValue,
  getMeasurementMoments,
  getMeasurementMomentsText,
  getMeasurementPreset,
  getMeasurementPresets,
  isPickedStateMeasurementMoment,
} from "../../../Utils/Measurement/MeasurementMoments";
import { describe, expect, test } from "@jest/globals";

/*
 * "I have no idea what these are. Please make it very easy to understand."
 * - the maintainer, on a form that asked for a "Start Anchor" of "State
 * Role Entered".
 *
 * The form now offers moments in plain words ("The incident is
 * acknowledged"); the API still stores anchors. These pin the two in step:
 * every anchor any measurement can hold is a moment the form can show and
 * the list can name, a moment is stored as exactly one anchor, and the
 * ready-made measurements are ones the server accepts.
 */

interface DomainCase {
  domain: MeasurementDomain;
  anchorTypes: Array<string>;
  roles: Array<string>;
  // The anchor type that is only another name for an earlier instant.
  aliasAnchorType: string;
  aliasOf: string;
  // Timestamp anchors that read the same column (the server's own table).
  timestampSources: Record<string, string>;
}

const CASES: Array<DomainCase> = [
  {
    domain: MeasurementDomain.Incident,
    anchorTypes: Object.values(IncidentMeasurementAnchorType),
    roles: Object.values(IncidentStateRole),
    aliasAnchorType: IncidentMeasurementAnchorType.TimelineStart,
    aliasOf: IncidentMeasurementAnchorType.DeclaredAt,
    timestampSources: {
      [IncidentMeasurementAnchorType.ImpactStartedAt]: "impactStartedAt",
      [IncidentMeasurementAnchorType.DeclaredAt]: "declaredAt",
      [IncidentMeasurementAnchorType.TimelineStart]: "declaredAt",
      [IncidentMeasurementAnchorType.CreatedAt]: "createdAt",
      [IncidentMeasurementAnchorType.PostmortemPostedAt]: "postmortemPostedAt",
    },
  },
  {
    domain: MeasurementDomain.Alert,
    anchorTypes: Object.values(AlertMeasurementAnchorType),
    roles: Object.values(AlertStateRole),
    aliasAnchorType: AlertMeasurementAnchorType.TimelineStart,
    aliasOf: AlertMeasurementAnchorType.CreatedAt,
    timestampSources: {
      [AlertMeasurementAnchorType.ImpactStartedAt]: "impactStartedAt",
      [AlertMeasurementAnchorType.TimelineStart]: "createdAt",
      [AlertMeasurementAnchorType.CreatedAt]: "createdAt",
    },
  },
  {
    domain: MeasurementDomain.ScheduledMaintenance,
    anchorTypes: Object.values(ScheduledMaintenanceMeasurementAnchorType),
    roles: Object.values(ScheduledMaintenanceStateRole),
    aliasAnchorType: ScheduledMaintenanceMeasurementAnchorType.TimelineStart,
    aliasOf: ScheduledMaintenanceMeasurementAnchorType.CreatedAt,
    timestampSources: {
      [ScheduledMaintenanceMeasurementAnchorType.TimelineStart]: "createdAt",
      [ScheduledMaintenanceMeasurementAnchorType.CreatedAt]: "createdAt",
      [ScheduledMaintenanceMeasurementAnchorType.ScheduledStartsAt]: "startsAt",
      [ScheduledMaintenanceMeasurementAnchorType.ScheduledEndsAt]: "endsAt",
    },
  },
];

const STATE_ENTERED: string = "State Entered";
const STATE_ROLE_ENTERED: string = "State Role Entered";

describe.each(CASES)("$domain measurement moments", (entry: DomainCase) => {
  const moments: Array<MeasurementMoment> = getMeasurementMoments(entry.domain);

  test("every anchor type the API can hold is a moment the form can show", () => {
    for (const anchorType of entry.anchorTypes) {
      if (anchorType === STATE_ROLE_ENTERED) {
        continue;
      }

      expect({
        anchorType,
        moment: findMeasurementMoment({ domain: entry.domain, anchorType })
          ?.value,
      }).toEqual({
        anchorType,
        moment: expect.any(String),
      });
    }
  });

  test("every state role is a moment of its own - no second dropdown for the role", () => {
    for (const role of entry.roles) {
      const moment: MeasurementMoment | null = findMeasurementMoment({
        domain: entry.domain,
        anchorType: STATE_ROLE_ENTERED,
        stateRole: role,
      });

      expect(moment?.stateRole).toBe(role);
      expect(moment?.anchorType).toBe(STATE_ROLE_ENTERED);
    }
  });

  test("lists only anchors of its own domain", () => {
    for (const moment of moments) {
      expect(entry.anchorTypes).toContain(moment.anchorType);

      if (moment.stateRole) {
        expect(entry.roles).toContain(moment.stateRole);
      }
    }
  });

  test("every moment has its own value and its own words", () => {
    const values: Array<string> = moments.map(
      (moment: MeasurementMoment): string => {
        return moment.value;
      },
    );
    const labels: Array<string> = moments.map(
      (moment: MeasurementMoment): string => {
        return moment.label;
      },
    );
    const shortLabels: Array<string> = moments.map(
      (moment: MeasurementMoment): string => {
        return moment.shortLabel;
      },
    );

    expect(new Set(values).size).toBe(moments.length);
    expect(new Set(labels).size).toBe(moments.length);
    expect(new Set(shortLabels).size).toBe(moments.length);

    for (const moment of moments) {
      expect(moment.label.length).toBeGreaterThan(0);
      expect(moment.description.length).toBeGreaterThan(10);
      // Plain words: no anchor vocabulary on screen.
      expect(moment.label).not.toMatch(/anchor|role|timeline start/i);
    }
  });

  test("a moment is stored as one anchor, and that anchor shows as the same moment", () => {
    for (const moment of moments) {
      const anchor: MeasurementAnchor | null = getMeasurementAnchorForMoment({
        domain: entry.domain,
        value: moment.value,
      });

      expect(anchor).toEqual({
        anchorType: moment.anchorType,
        stateRole: moment.stateRole || null,
      });

      expect(
        getMeasurementMomentValue({
          domain: entry.domain,
          anchorType: anchor!.anchorType,
          stateRole: anchor!.stateRole,
        }),
      ).toBe(moment.value);
    }
  });

  test("Timeline Start shows as the instant it always is, and is not offered on its own", () => {
    expect(
      getMeasurementMomentValue({
        domain: entry.domain,
        anchorType: entry.aliasAnchorType,
      }),
    ).toBe(entry.aliasOf);

    expect(
      moments.some((moment: MeasurementMoment): boolean => {
        return moment.anchorType === entry.aliasAnchorType;
      }),
    ).toBe(false);

    // The server reads the two as one point in time, too.
    expect(entry.timestampSources[entry.aliasAnchorType]).toBe(
      entry.timestampSources[entry.aliasOf],
    );
  });

  test("an anchor of no moment shows nothing, rather than a wrong moment", () => {
    expect(
      getMeasurementMomentValue({
        domain: entry.domain,
        anchorType: STATE_ROLE_ENTERED,
        stateRole: "Mitigated",
      }),
    ).toBeNull();
    expect(
      getMeasurementMomentValue({
        domain: entry.domain,
        anchorType: "Something Else At",
      }),
    ).toBeNull();
    expect(
      getMeasurementMomentValue({ domain: entry.domain, anchorType: "" }),
    ).toBeNull();
    expect(
      getMeasurementAnchorForMoment({ domain: entry.domain, value: "nope" }),
    ).toBeNull();
    expect(
      getMeasurementMoment({ domain: entry.domain, value: undefined }),
    ).toBeNull();
  });

  test("only a picked state asks which state, and only reaching a state can happen twice", () => {
    for (const moment of moments) {
      expect(
        isPickedStateMeasurementMoment({
          domain: entry.domain,
          value: moment.value,
        }),
      ).toBe(moment.anchorType === STATE_ENTERED);

      expect(
        canMeasurementMomentRepeat({
          domain: entry.domain,
          value: moment.value,
        }),
      ).toBe(
        moment.anchorType === STATE_ENTERED ||
          moment.anchorType === STATE_ROLE_ENTERED,
      );
    }
  });

  test("a new measurement starts at a timestamp every one of them has", () => {
    const start: MeasurementMoment = getDefaultMeasurementStartMoment(
      entry.domain,
    );

    expect(moments).toContain(start);
    expect(start.stateRole).toBeUndefined();
    expect(start.isPickedState).toBeFalsy();
    expect(entry.timestampSources[start.anchorType]).toBeDefined();
    // Not one somebody has to fill in by hand.
    expect(start.anchorType).not.toBe("Impact Started At");
  });

  describe("the ready-made measurements", () => {
    const presets: Array<MeasurementPreset> = getMeasurementPresets(
      entry.domain,
    );

    test("end with Something else, which sets nothing", () => {
      const custom: MeasurementPreset = presets[presets.length - 1]!;

      expect(custom.id).toBe(CUSTOM_MEASUREMENT_PRESET_ID);
      expect(custom.name).toBe("Something else");
      expect(custom.startMoment).toBeUndefined();
      expect(custom.endMoment).toBeUndefined();
    });

    test("have their own ids and names", () => {
      expect(
        new Set(
          presets.map((preset: MeasurementPreset): string => {
            return preset.id;
          }),
        ).size,
      ).toBe(presets.length);
      expect(
        new Set(
          presets.map((preset: MeasurementPreset): string => {
            return preset.name;
          }),
        ).size,
      ).toBe(presets.length);
      expect(presets.length).toBeGreaterThanOrEqual(3);
    });

    test("are measurements the server accepts: two moments that are not one", () => {
      for (const preset of presets) {
        if (preset.id === CUSTOM_MEASUREMENT_PRESET_ID) {
          continue;
        }

        const start: MeasurementAnchor | null = getMeasurementAnchorForMoment({
          domain: entry.domain,
          value: preset.startMoment,
        });
        const end: MeasurementAnchor | null = getMeasurementAnchorForMoment({
          domain: entry.domain,
          value: preset.endMoment,
        });

        expect(start).not.toBeNull();
        expect(end).not.toBeNull();
        expect(preset.startMoment).not.toBe(preset.endMoment);

        expect(() => {
          MeasurementDefinitionValidator.validateAnchorPair({
            startAnchorType: start!.anchorType,
            endAnchorType: end!.anchorType,
            stateEnteredAnchor: STATE_ENTERED,
            stateRoleEnteredAnchor: STATE_ROLE_ENTERED,
            timestampAnchorSources: entry.timestampSources,
            startStateRole: start!.stateRole || undefined,
            endStateRole: end!.stateRole || undefined,
          });
        }).not.toThrow();
      }
    });

    test("work out of the box: no picked state, and no time somebody records by hand", () => {
      for (const preset of presets) {
        for (const value of [preset.startMoment, preset.endMoment]) {
          if (!value) {
            continue;
          }

          const moment: MeasurementMoment | null = getMeasurementMoment({
            domain: entry.domain,
            value,
          });

          expect(moment?.isPickedState).toBeFalsy();
          expect(moment?.anchorType).not.toBe("Impact Started At");
        }
      }
    });

    test("can be found by id", () => {
      for (const preset of presets) {
        expect(
          getMeasurementPreset({ domain: entry.domain, id: preset.id }),
        ).toBe(preset);
      }

      expect(
        getMeasurementPreset({ domain: entry.domain, id: "nope" }),
      ).toBeNull();
    });
  });
});

describe("the ready-made measurements, by name", () => {
  const names: (domain: MeasurementDomain) => Array<string> = (
    domain: MeasurementDomain,
  ): Array<string> => {
    return getMeasurementPresets(domain).map(
      (preset: MeasurementPreset): string => {
        return preset.name;
      },
    );
  };

  test("incidents: time to acknowledge, resolve and postmortem", () => {
    expect(names(MeasurementDomain.Incident)).toEqual([
      "Time to acknowledge",
      "Time to resolve",
      "Time to postmortem",
      "Something else",
    ]);
  });

  test("alerts: time to acknowledge and resolve", () => {
    expect(names(MeasurementDomain.Alert)).toEqual([
      "Time to acknowledge",
      "Time to resolve",
      "Something else",
    ]);
  });

  test("scheduled maintenance: how late it starts, how long it overruns, how long it takes", () => {
    expect(names(MeasurementDomain.ScheduledMaintenance)).toEqual([
      "Start delay",
      "Overrun",
      "Maintenance duration",
      "Something else",
    ]);
  });

  test("time to acknowledge runs from when an incident is declared to when it is acknowledged", () => {
    const preset: MeasurementPreset = getMeasurementPresets(
      MeasurementDomain.Incident,
    )[0]!;

    expect(
      getMeasurementAnchorForMoment({
        domain: MeasurementDomain.Incident,
        value: preset.startMoment,
      }),
    ).toEqual({
      anchorType: IncidentMeasurementAnchorType.DeclaredAt,
      stateRole: null,
    });
    expect(
      getMeasurementAnchorForMoment({
        domain: MeasurementDomain.Incident,
        value: preset.endMoment,
      }),
    ).toEqual({
      anchorType: IncidentMeasurementAnchorType.StateRoleEntered,
      stateRole: IncidentStateRole.Acknowledged,
    });
  });
});

describe("describeMeasurementEnd, for the list", () => {
  test("says a moment in a word or two", () => {
    expect(
      describeMeasurementEnd({
        domain: MeasurementDomain.Incident,
        anchorType: IncidentMeasurementAnchorType.StateRoleEntered,
        stateRole: IncidentStateRole.Acknowledged,
      }),
    ).toEqual({ label: "Acknowledged", isStateName: false, isLastTime: false });

    expect(
      describeMeasurementEnd({
        domain: MeasurementDomain.Incident,
        anchorType: IncidentMeasurementAnchorType.TimelineStart,
      }),
    ).toEqual({ label: "Declared", isStateName: false, isLastTime: false });
  });

  test("names a picked state by its own name", () => {
    expect(
      describeMeasurementEnd({
        domain: MeasurementDomain.Alert,
        anchorType: AlertMeasurementAnchorType.StateEntered,
        stateName: " Investigating ",
      }),
    ).toEqual({
      label: "Investigating",
      isStateName: true,
      isLastTime: false,
    });
  });

  test("says when the picked state has been deleted, as the measurement's status does", () => {
    expect(
      describeMeasurementEnd({
        domain: MeasurementDomain.Alert,
        anchorType: AlertMeasurementAnchorType.StateEntered,
        stateName: null,
      }),
    ).toEqual({
      label: MEASUREMENT_DELETED_STATE_LABEL,
      isStateName: false,
      isLastTime: false,
    });
  });

  test("says when the last time a state is reached counts - only for reaching a state", () => {
    expect(
      describeMeasurementEnd({
        domain: MeasurementDomain.ScheduledMaintenance,
        anchorType: ScheduledMaintenanceMeasurementAnchorType.StateRoleEntered,
        stateRole: ScheduledMaintenanceStateRole.Ended,
        occurrence: MeasurementOccurrence.Last,
      })?.isLastTime,
    ).toBe(true);

    expect(
      describeMeasurementEnd({
        domain: MeasurementDomain.ScheduledMaintenance,
        anchorType: ScheduledMaintenanceMeasurementAnchorType.ScheduledEndsAt,
        occurrence: MeasurementOccurrence.Last,
      })?.isLastTime,
    ).toBe(false);

    expect(MEASUREMENT_LAST_TIME_TEMPLATE).toContain("{{moment}}");
  });

  test("has nothing to say for an anchor of no moment", () => {
    expect(
      describeMeasurementEnd({
        domain: MeasurementDomain.Incident,
        anchorType: "Scheduled Starts At",
      }),
    ).toBeNull();
  });
});

describe("getMeasurementMomentsText", () => {
  test("holds every word the moments and the ready-made measurements put on screen", () => {
    const text: Array<string> = getMeasurementMomentsText();

    for (const domain of Object.values(MeasurementDomain)) {
      for (const moment of getMeasurementMoments(domain)) {
        expect(text).toContain(moment.label);
        expect(text).toContain(moment.shortLabel);
        expect(text).toContain(moment.description);
      }

      for (const preset of getMeasurementPresets(domain)) {
        expect(text).toContain(preset.name);
        expect(text).toContain(preset.description);
      }
    }

    expect(text).toContain(MEASUREMENT_DELETED_STATE_LABEL);
    expect(text).toContain(MEASUREMENT_LAST_TIME_TEMPLATE);
    expect(new Set(text).size).toBe(text.length);
  });
});
