import CriteriaFilterUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter";
import ExternalStatusPageMonitorCriteria from "../../../Server/Utils/Monitor/Criteria/ExternalStatusPageMonitorCriteria";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import { describe, expect, test } from "@jest/globals";

/*
 * Regression cover for #3412.
 *
 * On an External Status Page monitor, the seeded "no active incidents" filter
 * rendered its Filter Condition dropdown as an empty "Select...", while the
 * sibling "Is Online" filter's condition read "True" and this filter's own
 * value already read 0.
 *
 * The criteria itself was correct — MonitorCriteriaInstance seeds it as
 * EqualTo 0 — but "External Status Page Active Incidents" was grouped with
 * "External Status Page Response Time" in the condition dropdown, and that
 * group only offers the four inequality comparators. With no option matching
 * the stored EqualTo, the dropdown fell through to its placeholder, so the
 * screen implied the condition was unset when it was not.
 *
 * Active incidents is a whole-number count, so "is exactly N" is a condition
 * it should offer; response time is a measurement, where it is noise. Split
 * the two, and the seeded criteria renders what it stores.
 *
 * The generalised invariants — every seeded criteria across every monitor type
 * must be renderable, and every filter the form hands the user must arrive
 * with both dropdowns chosen — live in CriteriaFilterDefaults.test.ts.
 */

function optionValues(options: Array<DropdownOption>): Array<string> {
  return options.map((option: DropdownOption) => {
    return option.value.toString();
  });
}

function conditionsOffered(checkOn: CheckOn): Array<string> {
  return optionValues(
    CriteriaFilterUtil.getFilterTypeOptionsByCheckOn(checkOn),
  );
}

/*
 * What the Filter Condition dropdown would display for a stored filter: the
 * option whose value matches, or undefined — which is what makes react-select
 * fall back to its "Select..." placeholder.
 */
function renderedCondition(
  criteriaFilter: CriteriaFilter,
): DropdownOption | undefined {
  return CriteriaFilterUtil.getFilterTypeOptionsByCheckOn(
    criteriaFilter.checkOn,
  ).find((option: DropdownOption) => {
    return option.value === criteriaFilter.filterType;
  });
}

function seededOnlineCriteria(): MonitorCriteriaInstance {
  return MonitorCriteriaInstance.getDefaultOnlineMonitorCriteriaInstance({
    monitorType: MonitorType.ExternalStatusPage,
    monitorStatusId: new ObjectID("aaaaaaaaaaaaaaaaaaaaaaaa"),
    monitorName: "Acme Status",
  })!;
}

function seededOfflineCriteria(): MonitorCriteriaInstance {
  return MonitorCriteriaInstance.getDefaultOfflineMonitorCriteriaInstance({
    monitorType: MonitorType.ExternalStatusPage,
    monitorStatusId: new ObjectID("bbbbbbbbbbbbbbbbbbbbbbbb"),
    incidentSeverityId: new ObjectID("cccccccccccccccccccccccc"),
    alertSeverityId: new ObjectID("dddddddddddddddddddddddd"),
    monitorName: "Acme Status",
  });
}

function activeIncidentsFilterOf(
  instance: MonitorCriteriaInstance,
): CriteriaFilter {
  return instance.data!.filters.find((filter: CriteriaFilter) => {
    return filter.checkOn === CheckOn.ExternalStatusPageActiveIncidents;
  })!;
}

async function evaluateActiveIncidents(input: {
  activeIncidentCount: number;
  criteriaFilter: CriteriaFilter;
}): Promise<string | null> {
  const dataToProcess: ProbeMonitorResponse = {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    monitorStepId: ObjectID.generate(),
    probeId: ObjectID.generate(),
    failureCause: "",
    isOnline: true,
    responseTimeInMs: 100,
    externalStatusPageResponse: {
      isOnline: true,
      overallStatus: "Operational",
      componentStatuses: [],
      activeIncidentCount: input.activeIncidentCount,
      responseTimeInMs: 100,
      failureCause: "",
    },
    monitoredAt: new Date(),
  };

  return ExternalStatusPageMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
    dataToProcess: dataToProcess,
    criteriaFilter: input.criteriaFilter,
  });
}

describe("External Status Page criteria filter conditions", () => {
  describe("the reported screen", () => {
    test("the seeded 'no active incidents' filter renders its condition instead of a placeholder", () => {
      const criteriaFilter: CriteriaFilter = activeIncidentsFilterOf(
        seededOnlineCriteria(),
      );

      // What is stored, unchanged by this fix.
      expect(criteriaFilter.filterType).toBe(FilterType.EqualTo);
      expect(criteriaFilter.value).toBe(0);

      // What the dropdown draws for it. Before the fix this was undefined.
      expect(renderedCondition(criteriaFilter)).toEqual({
        label: FilterType.EqualTo,
        value: FilterType.EqualTo,
      });
    });

    test("every filter in the seeded online criteria renders its condition", () => {
      const instance: MonitorCriteriaInstance = seededOnlineCriteria();

      expect(instance.data?.filterCondition).toBe(FilterCondition.All);
      expect(instance.data?.filters).toHaveLength(2);

      for (const criteriaFilter of instance.data!.filters) {
        expect(renderedCondition(criteriaFilter)).toBeDefined();
      }
    });

    test("every filter in the seeded offline criteria renders its condition", () => {
      const instance: MonitorCriteriaInstance = seededOfflineCriteria();

      expect(instance.data?.filterCondition).toBe(FilterCondition.Any);
      expect(instance.data!.filters.length).toBeGreaterThan(0);

      for (const criteriaFilter of instance.data!.filters) {
        expect(renderedCondition(criteriaFilter)).toBeDefined();
      }
    });

    test("the sibling 'is online' filter is unchanged", () => {
      const criteriaFilter: CriteriaFilter =
        seededOnlineCriteria().data!.filters[0]!;

      expect(criteriaFilter.checkOn).toBe(CheckOn.ExternalStatusPageIsOnline);
      expect(criteriaFilter.filterType).toBe(FilterType.True);
      expect(renderedCondition(criteriaFilter)).toBeDefined();
    });

    /*
     * The 0 the user saw in the Value box on the *newly added* filter is the
     * example placeholder, not a stored value. Keeping it pinned here so the
     * two are not conflated again: the value field was fine, the condition
     * dropdown was not.
     */
    test("the active incidents value box still shows 0 as its example", () => {
      expect(
        CriteriaFilterUtil.getFilterTypePlaceholderValueByCheckOn({
          monitorType: MonitorType.ExternalStatusPage,
          checkOn: CheckOn.ExternalStatusPageActiveIncidents,
        }),
      ).toBe("0");
    });
  });

  describe("conditions offered for active incidents", () => {
    test("offers exact match alongside the inequalities", () => {
      expect(
        conditionsOffered(CheckOn.ExternalStatusPageActiveIncidents),
      ).toEqual([
        FilterType.EqualTo,
        FilterType.NotEqualTo,
        FilterType.GreaterThan,
        FilterType.LessThan,
        FilterType.GreaterThanOrEqualTo,
        FilterType.LessThanOrEqualTo,
      ]);
    });

    test("defaults to exact match, which is how the seeded criteria is written", () => {
      expect(
        CriteriaFilterUtil.getDefaultFilterTypeByCheckOn(
          CheckOn.ExternalStatusPageActiveIncidents,
        ),
      ).toBe(FilterType.EqualTo);

      expect(activeIncidentsFilterOf(seededOnlineCriteria()).filterType).toBe(
        FilterType.EqualTo,
      );
    });

    test("offers no text or boolean conditions for a count", () => {
      const offered: Array<string> = conditionsOffered(
        CheckOn.ExternalStatusPageActiveIncidents,
      );

      expect(offered).not.toContain(FilterType.Contains);
      expect(offered).not.toContain(FilterType.True);
      expect(offered).not.toContain(FilterType.IsEmpty);
      expect(offered).not.toContain(FilterType.EvaluatesToTrue);
    });

    test("takes a value, so the Value box stays on screen", () => {
      expect(
        CriteriaFilterUtil.isDropdownValueField({
          checkOn: CheckOn.ExternalStatusPageActiveIncidents,
        }),
      ).toBe(false);
    });
  });

  describe("response time is a measurement, and keeps only inequalities", () => {
    test("is not swept along with the count", () => {
      expect(conditionsOffered(CheckOn.ExternalStatusPageResponseTime)).toEqual(
        [
          FilterType.GreaterThan,
          FilterType.LessThan,
          FilterType.GreaterThanOrEqualTo,
          FilterType.LessThanOrEqualTo,
        ],
      );
    });

    test("does not offer exact match on a millisecond reading", () => {
      const offered: Array<string> = conditionsOffered(
        CheckOn.ExternalStatusPageResponseTime,
      );

      expect(offered).not.toContain(FilterType.EqualTo);
      expect(offered).not.toContain(FilterType.NotEqualTo);
    });
  });

  describe("the other External Status Page checks are untouched", () => {
    test("is online stays boolean", () => {
      expect(conditionsOffered(CheckOn.ExternalStatusPageIsOnline)).toEqual([
        FilterType.True,
        FilterType.False,
      ]);
    });

    test.each([
      CheckOn.ExternalStatusPageOverallStatus,
      CheckOn.ExternalStatusPageComponentStatus,
    ])("%s stays a string comparison", (checkOn: CheckOn) => {
      expect(conditionsOffered(checkOn)).toEqual([
        FilterType.EqualTo,
        FilterType.NotEqualTo,
        FilterType.Contains,
        FilterType.NotContains,
        FilterType.StartsWith,
        FilterType.EndsWith,
      ]);
    });

    test("the monitor type still offers all five checks", () => {
      expect(
        optionValues(
          CriteriaFilterUtil.getCheckOnOptionsByMonitorType(
            MonitorType.ExternalStatusPage,
          ),
        ).sort(),
      ).toEqual(
        [
          CheckOn.ExternalStatusPageIsOnline,
          CheckOn.ExternalStatusPageOverallStatus,
          CheckOn.ExternalStatusPageComponentStatus,
          CheckOn.ExternalStatusPageActiveIncidents,
          CheckOn.ExternalStatusPageResponseTime,
        ].sort(),
      );
    });
  });

  /*
   * The dropdown must not offer a condition the evaluator will quietly ignore.
   * Exact match is newly on offer here, so prove the server actually decides
   * on it — including on the seeded criteria exactly as it is stored.
   */
  describe("the newly offered conditions are honoured by the evaluator", () => {
    test("the seeded 'no active incidents' filter is met when there are none", async () => {
      await expect(
        evaluateActiveIncidents({
          activeIncidentCount: 0,
          criteriaFilter: activeIncidentsFilterOf(seededOnlineCriteria()),
        }),
      ).resolves.toContain("equal to 0");
    });

    test("the seeded 'no active incidents' filter is not met once one opens", async () => {
      await expect(
        evaluateActiveIncidents({
          activeIncidentCount: 1,
          criteriaFilter: activeIncidentsFilterOf(seededOnlineCriteria()),
        }),
      ).resolves.toBeNull();
    });

    test("exact match fires on the matching count", async () => {
      await expect(
        evaluateActiveIncidents({
          activeIncidentCount: 3,
          criteriaFilter: {
            checkOn: CheckOn.ExternalStatusPageActiveIncidents,
            filterType: FilterType.EqualTo,
            value: 3,
          },
        }),
      ).resolves.toContain("equal to 3");
    });

    test("exact match stays quiet on a different count", async () => {
      await expect(
        evaluateActiveIncidents({
          activeIncidentCount: 4,
          criteriaFilter: {
            checkOn: CheckOn.ExternalStatusPageActiveIncidents,
            filterType: FilterType.EqualTo,
            value: 3,
          },
        }),
      ).resolves.toBeNull();
    });

    test("not-equal fires on a different count", async () => {
      await expect(
        evaluateActiveIncidents({
          activeIncidentCount: 2,
          criteriaFilter: {
            checkOn: CheckOn.ExternalStatusPageActiveIncidents,
            filterType: FilterType.NotEqualTo,
            value: 0,
          },
        }),
      ).resolves.toContain("not equal to 0");
    });

    test("not-equal stays quiet on the matching count", async () => {
      await expect(
        evaluateActiveIncidents({
          activeIncidentCount: 0,
          criteriaFilter: {
            checkOn: CheckOn.ExternalStatusPageActiveIncidents,
            filterType: FilterType.NotEqualTo,
            value: 0,
          },
        }),
      ).resolves.toBeNull();
    });

    /*
     * Every condition the dropdown offers has to reach a decision, otherwise
     * the form is inviting the user to build a rule that can never be true.
     */
    test.each([
      FilterType.EqualTo,
      FilterType.NotEqualTo,
      FilterType.GreaterThan,
      FilterType.LessThan,
      FilterType.GreaterThanOrEqualTo,
      FilterType.LessThanOrEqualTo,
    ])(
      "%s reaches a decision on some count",
      async (filterType: FilterType) => {
        const outcomes: Array<string | null> = await Promise.all(
          [0, 1, 2].map((activeIncidentCount: number) => {
            return evaluateActiveIncidents({
              activeIncidentCount: activeIncidentCount,
              criteriaFilter: {
                checkOn: CheckOn.ExternalStatusPageActiveIncidents,
                filterType: filterType,
                value: 1,
              },
            });
          }),
        );

        expect(
          outcomes.some((outcome: string | null) => {
            return Boolean(outcome);
          }),
        ).toBe(true);
      },
    );
  });
});
