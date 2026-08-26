import CriteriaFilterUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter";
import MonitorCriteriaAlignmentUtil, {
  CriteriaSeedOptions,
  MonitorStepsAlignmentResult,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/MonitorCriteriaAlignment";
import URL from "../../../Types/API/URL";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { CriteriaIncident } from "../../../Types/Monitor/CriteriaIncident";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType, {
  MonitorTypeHelper,
} from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import { describe, expect, test } from "@jest/globals";

/*
 * Monitor type and monitor criteria are on different steps of the monitor
 * create form, and the criteria step's fields unmount while the user is on
 * another step. So a user can seed criteria for one monitor type and then
 * change their mind: visit the criteria step, walk back, pick a different
 * type, come forward again. The criteria that come back with them were
 * written against the type they abandoned.
 *
 * Left alone, those criteria name checks the new monitor type does not
 * offer - "Is Online" on an External Status Page monitor, say - and the
 * criteria form's dropdowns fall back to react-select's empty "Select..."
 * placeholder because they cannot find an option matching what is stored.
 * The rule is not empty; the form cannot draw it. Saved as-is it also never
 * fires, because the server's comparators switch on a filter type they no
 * longer recognise.
 *
 * This is the same class of defect as #3412 (the Filter Condition dropdown
 * on the seeded External Status Page criteria, pinned in
 * CriteriaFilterDefaults.test.ts), arriving by a different route: there the
 * seed itself was unrenderable, here a renderable seed is outlived by the
 * monitor type it was written for.
 *
 * The fix has two halves, and this file pins both:
 *
 *   1. Criteria still identical to the defaults of the type they were
 *      seeded for carry nothing of the user's, so they are re-seeded
 *      outright for the new type - the user gets what picking that type
 *      first would have given them.
 *   2. Criteria the user has edited are repaired filter by filter instead.
 *      Their names, incidents, alerts and every filter that still applies
 *      to the new type survive; filters the new type cannot express are
 *      dropped, never swapped for a fabricated one - see the inversion
 *      test below for why that distinction is the important one.
 *
 * And over both halves, the invariant that matters: whatever monitor type
 * the criteria were seeded for and whichever one the user lands on, every
 * filter that reaches the form is renderable.
 */

const SEED_OPTIONS: CriteriaSeedOptions = {
  monitorName: "Acme",
  onlineMonitorStatusId: new ObjectID("aaaaaaaaaaaaaaaaaaaaaaaa"),
  offlineMonitorStatusId: new ObjectID("bbbbbbbbbbbbbbbbbbbbbbbb"),
  defaultIncidentSeverityId: new ObjectID("cccccccccccccccccccccccc"),
  defaultAlertSeverityId: new ObjectID("dddddddddddddddddddddddd"),
};

const ALL_MONITOR_TYPES: Array<MonitorType> = Object.values(
  MonitorType,
) as Array<MonitorType>;

function optionValues(options: Array<DropdownOption>): Array<string> {
  return options.map((option: DropdownOption) => {
    return option.value.toString();
  });
}

function checkOnOptionsFor(monitorType: MonitorType): Array<string> {
  return optionValues(
    CriteriaFilterUtil.getCheckOnOptionsByMonitorType(monitorType),
  );
}

function filterTypeOptionsFor(checkOn: CheckOn): Array<string> {
  return optionValues(
    CriteriaFilterUtil.getFilterTypeOptionsByCheckOn(checkOn),
  );
}

// The monitor steps the criteria form seeds when a monitor type is picked.
function stepsSeededFor(monitorType: MonitorType): MonitorSteps {
  return MonitorSteps.getDefaultMonitorSteps({
    monitorType: monitorType,
    monitorName: SEED_OPTIONS.monitorName,
    defaultMonitorStatusId: SEED_OPTIONS.onlineMonitorStatusId,
    onlineMonitorStatusId: SEED_OPTIONS.onlineMonitorStatusId,
    offlineMonitorStatusId: SEED_OPTIONS.offlineMonitorStatusId,
    defaultIncidentSeverityId: SEED_OPTIONS.defaultIncidentSeverityId,
    defaultAlertSeverityId: SEED_OPTIONS.defaultAlertSeverityId,
  });
}

/*
 * Monitor types the criteria form is ever drawn for. Manual is not one:
 * nothing polls a manual monitor, getCheckOnOptionsByMonitorType returns
 * an empty list for it, and the Criteria page renders an empty state in
 * place of the form - so "the criteria are renderable" is not a question
 * that can be asked of it.
 */
const MONITOR_TYPES_WITH_CRITERIA: Array<MonitorType> =
  ALL_MONITOR_TYPES.filter((monitorType: MonitorType) => {
    return MonitorTypeHelper.doesMonitorTypeHaveCriteria(monitorType);
  });

/*
 * Monitor types that seed no real criteria: they fall through
 * getDefaultOfflineMonitorCriteriaInstance to a blank criteria carrying
 * the constructor's placeholder "Is Online" filter, which their own
 * narrowed option lists do not offer, and their online half is null.
 *
 * That gap is not this change's to close, and closing it here would be
 * the wrong place: it reproduces with no monitor type change at all -
 * create a Docker monitor, open its criteria, and the Filter Type
 * dropdown is already blank - so it is a defect in the seeds, not in what
 * happens when the type changes underneath them. CriteriaFilterDefaults
 * .test.ts documents it and skips the same types, pinned from both sides
 * so a type cannot quietly join or leave the list.
 *
 * They are excluded as SOURCES below. As targets they are fine and are
 * swept: aligning a Website's criteria to Docker does produce something
 * renderable. What does not work is aligning BETWEEN two of them, because
 * they all seed the identical blank placeholder - so each one is already
 * "the untouched default" for the other, and the criteria are handed back
 * untouched by the no-churn contract, still carrying the placeholder.
 */
const MONITOR_TYPES_WITHOUT_SEEDED_CRITERIA: Array<MonitorType> = [
  MonitorType.Manual,
  MonitorType.Docker,
  MonitorType.Host,
  MonitorType.Podman,
  MonitorType.DockerSwarm,
  MonitorType.Proxmox,
  MonitorType.Ceph,
  MonitorType.IoTDevice,
  MonitorType.Profiles,
];

const MONITOR_TYPES_WITH_SEEDED_CRITERIA: Array<MonitorType> =
  MONITOR_TYPES_WITH_CRITERIA.filter((monitorType: MonitorType) => {
    return !MONITOR_TYPES_WITHOUT_SEEDED_CRITERIA.includes(monitorType);
  });

/*
 * The types a sweep starts from, given the type it is aligning to.
 * "Changing" to the type you are already on is the one case where nothing
 * is meant to happen, and it is pinned separately by the no-churn tests.
 */
function sourceTypesFor(monitorType: MonitorType): Array<MonitorType> {
  return MONITOR_TYPES_WITH_SEEDED_CRITERIA.filter((candidate: MonitorType) => {
    return candidate !== monitorType;
  });
}

function alignTo(
  monitorSteps: MonitorSteps,
  monitorType: MonitorType,
): MonitorStepsAlignmentResult {
  return MonitorCriteriaAlignmentUtil.alignMonitorStepsWithMonitorType({
    monitorSteps: monitorSteps,
    monitorType: monitorType,
    seedOptions: SEED_OPTIONS,
  });
}

function criteriaOf(
  monitorSteps: MonitorSteps,
): Array<MonitorCriteriaInstance> {
  return (monitorSteps.data?.monitorStepsInstanceArray || []).flatMap(
    (monitorStep: MonitorStep) => {
      return (
        monitorStep.data?.monitorCriteria.data?.monitorCriteriaInstanceArray ||
        []
      );
    },
  );
}

function filtersOf(monitorSteps: MonitorSteps): Array<CriteriaFilter> {
  return criteriaOf(monitorSteps).flatMap(
    (instance: MonitorCriteriaInstance) => {
      return instance.data?.filters || [];
    },
  );
}

function criteriaNamesOf(monitorSteps: MonitorSteps): Array<string> {
  return criteriaOf(monitorSteps).map((instance: MonitorCriteriaInstance) => {
    return instance.data!.name;
  });
}

// Every filter as "<check> <condition> <value>", so a failure reads.
function describeFilters(monitorSteps: MonitorSteps): Array<string> {
  return filtersOf(monitorSteps).map((filter: CriteriaFilter) => {
    return `${filter.checkOn} ${filter.filterType} ${filter.value}`;
  });
}

/*
 * Everything about `monitorSteps` the criteria form for `monitorType`
 * cannot draw, as readable sentences - an empty array is the assertion,
 * and anything else names what broke.
 */
function unrenderable(
  monitorSteps: MonitorSteps,
  monitorType: MonitorType,
): Array<string> {
  const offeredChecks: Array<string> = checkOnOptionsFor(monitorType);
  const problems: Array<string> = [];

  for (const instance of criteriaOf(monitorSteps)) {
    for (const filter of instance.data?.filters || []) {
      if (!offeredChecks.includes(filter.checkOn?.toString())) {
        problems.push(
          `"${instance.data!.name}" filters on check "${filter.checkOn}", which ${monitorType} does not offer`,
        );
        continue;
      }

      if (!filter.filterType) {
        problems.push(
          `"${instance.data!.name}" filters on check "${filter.checkOn}" with no condition at all`,
        );
        continue;
      }

      const offeredConditions: Array<string> = filterTypeOptionsFor(
        filter.checkOn,
      );

      if (!offeredConditions.includes(filter.filterType.toString())) {
        problems.push(
          `"${instance.data!.name}" filters on check "${filter.checkOn}" with condition "${filter.filterType}", which is not one of [${offeredConditions.join(", ")}]`,
        );
      }
    }
  }

  return problems;
}

describe("Criteria after the monitor type changes under them", () => {
  describe("the reported defect", () => {
    test("criteria seeded for a Website are unrenderable once the type is External Status Page", () => {
      const seededForWebsite: MonitorSteps = stepsSeededFor(
        MonitorType.Website,
      );

      /*
       * The bug, stated: a Website's criteria check "Is Online" and
       * "Response Status Code", and an External Status Page monitor offers
       * neither, so both of that filter's dropdowns render empty.
       */
      expect(
        unrenderable(seededForWebsite, MonitorType.ExternalStatusPage),
      ).not.toEqual([]);

      const aligned: MonitorStepsAlignmentResult = alignTo(
        seededForWebsite,
        MonitorType.ExternalStatusPage,
      );

      expect(aligned.didChange).toBe(true);
      expect(
        unrenderable(aligned.monitorSteps, MonitorType.ExternalStatusPage),
      ).toEqual([]);
    });

    test("the External Status Page criteria the user ends up with are the ones picking that type first would have given them", () => {
      const aligned: MonitorStepsAlignmentResult = alignTo(
        stepsSeededFor(MonitorType.Website),
        MonitorType.ExternalStatusPage,
      );

      expect(describeFilters(aligned.monitorSteps)).toEqual(
        describeFilters(stepsSeededFor(MonitorType.ExternalStatusPage)),
      );

      expect(criteriaNamesOf(aligned.monitorSteps)).toEqual(
        criteriaNamesOf(stepsSeededFor(MonitorType.ExternalStatusPage)),
      );
    });
  });

  describe("every monitor type change leaves criteria the form can draw", () => {
    test.each(MONITOR_TYPES_WITH_CRITERIA)(
      "criteria seeded for any other type are renderable once aligned to %s",
      (monitorType: MonitorType) => {
        const problems: Array<string> = [];

        for (const seededFor of sourceTypesFor(monitorType)) {
          const aligned: MonitorStepsAlignmentResult = alignTo(
            stepsSeededFor(seededFor),
            monitorType,
          );

          for (const problem of unrenderable(
            aligned.monitorSteps,
            monitorType,
          )) {
            problems.push(`seeded for ${seededFor}: ${problem}`);
          }
        }

        expect(problems).toEqual([]);
      },
    );

    test.each(MONITOR_TYPES_WITH_SEEDED_CRITERIA)(
      "%s: criteria the user has edited are still renderable once aligned to every other type",
      (seededFor: MonitorType) => {
        /*
         * An edited criteria takes the repair path rather than the
         * re-seed path, so sweep that path over every pair too. The edit
         * is deliberately one that survives - a renamed criteria - so what
         * is under test is the filters, not whether the edit was noticed.
         */
        const problems: Array<string> = [];

        for (const monitorType of sourceTypesFor(seededFor)) {
          const edited: MonitorSteps = stepsSeededFor(seededFor);
          criteriaOf(edited)[0]!.setName("My own rule");

          const aligned: MonitorStepsAlignmentResult = alignTo(
            edited,
            monitorType,
          );

          for (const problem of unrenderable(
            aligned.monitorSteps,
            monitorType,
          )) {
            problems.push(`aligned to ${monitorType}: ${problem}`);
          }
        }

        expect(problems).toEqual([]);
      },
    );
  });

  describe("criteria that already suit the monitor type are left alone", () => {
    test.each(ALL_MONITOR_TYPES)(
      "%s: its own freshly seeded criteria come back untouched",
      (monitorType: MonitorType) => {
        const seeded: MonitorSteps = stepsSeededFor(monitorType);

        const aligned: MonitorStepsAlignmentResult = alignTo(
          seeded,
          monitorType,
        );

        expect(aligned.didChange).toBe(false);
        /*
         * Same object, not just equal content. The criteria form writes
         * the result back into the form on change, and re-seeding criteria
         * that were already right would churn their generated ids and mark
         * an untouched form dirty every time it mounted.
         */
        expect(aligned.monitorSteps).toBe(seeded);
      },
    );

    test("criteria carrying an edit that is still valid are not re-seeded", () => {
      const edited: MonitorSteps = stepsSeededFor(MonitorType.Website);
      criteriaOf(edited)[0]!.setName("Down for two checks in a row");

      const aligned: MonitorStepsAlignmentResult = alignTo(
        edited,
        MonitorType.Website,
      );

      expect(aligned.didChange).toBe(false);
      expect(criteriaNamesOf(aligned.monitorSteps)).toContain(
        "Down for two checks in a row",
      );
    });
  });

  describe("untouched defaults are re-seeded for the new monitor type", () => {
    test("Website to Incoming Request swaps in the Incoming Request defaults wholesale", () => {
      const aligned: MonitorStepsAlignmentResult = alignTo(
        stepsSeededFor(MonitorType.Website),
        MonitorType.IncomingRequest,
      );

      /*
       * Repairing rather than re-seeding here would have left the user
       * with "Check if Acme is offline" over a blank "not received in
       * minutes" threshold - the first check Incoming Request offers -
       * which is not a rule anybody asked for. What they get instead is
       * the pair of request-body rules picking Incoming Request first
       * would have seeded.
       */
      expect(describeFilters(aligned.monitorSteps)).toEqual([
        `${CheckOn.RequestBody} ${FilterType.Contains} ${MonitorCriteriaInstance.DEFAULT_INCOMING_BODY_ERROR_KEYWORD}`,
        `${CheckOn.RequestBody} ${FilterType.NotContains} ${MonitorCriteriaInstance.DEFAULT_INCOMING_BODY_ERROR_KEYWORD}`,
      ]);

      expect(describeFilters(aligned.monitorSteps)).toEqual(
        describeFilters(stepsSeededFor(MonitorType.IncomingRequest)),
      );
    });

    test("the incidents the new monitor type seeds come with it", () => {
      /*
       * Re-seeding has to bring the whole criteria across, not just the
       * filters - a Logs monitor whose criteria change the monitor status
       * but open no incident is not what picking Logs gives you.
       */
      const aligned: MonitorStepsAlignmentResult = alignTo(
        stepsSeededFor(MonitorType.Ping),
        MonitorType.Logs,
      );

      expect(describeFilters(aligned.monitorSteps)).toEqual(
        describeFilters(stepsSeededFor(MonitorType.Logs)),
      );

      const incidents: Array<CriteriaIncident> = criteriaOf(
        aligned.monitorSteps,
      ).flatMap((instance: MonitorCriteriaInstance) => {
        return instance.data?.incidents || [];
      });

      expect(incidents.length).toBeGreaterThan(0);
      expect(incidents[0]!.incidentSeverityId?.toString()).toBe(
        SEED_OPTIONS.defaultIncidentSeverityId.toString(),
      );
    });

    test("what the user configured on the monitor step itself is not collateral damage", () => {
      /*
       * Only the criteria are re-seeded. The destination, request method
       * and everything else on the step belong to the user even when the
       * criteria on it are untouched defaults.
       *
       * The pair matters: Website and API seed byte-identical criteria, so
       * aligning between them short-circuits on "already untouched
       * defaults for this type" and hands the very same object back -
       * which would make this assertion pass no matter what the re-seed
       * branch did to the step. External Status Page actually re-seeds.
       */
      const seeded: MonitorSteps = stepsSeededFor(MonitorType.Website);
      seeded.data!.monitorStepsInstanceArray[0]!.setMonitorDestination(
        URL.fromString("https://acme.example.com/health"),
      );

      const aligned: MonitorStepsAlignmentResult = alignTo(
        seeded,
        MonitorType.ExternalStatusPage,
      );

      expect(aligned.didChange).toBe(true);

      expect(
        aligned.monitorSteps.data!.monitorStepsInstanceArray[0]!.data!.monitorDestination?.toString(),
      ).toBe("https://acme.example.com/health");

      // The step's other settings are not collateral damage either.
      expect(
        aligned.monitorSteps.data!.monitorStepsInstanceArray[0]!.data!
          .requestType,
      ).toBe(seeded.data!.monitorStepsInstanceArray[0]!.data!.requestType);

      expect(
        aligned.monitorSteps.data!.defaultMonitorStatusId?.toString(),
      ).toBe(SEED_OPTIONS.onlineMonitorStatusId.toString());
    });
  });

  describe("criteria the user has edited are repaired, not replaced", () => {
    function editedWebsiteSteps(): MonitorSteps {
      const monitorSteps: MonitorSteps = stepsSeededFor(MonitorType.Website);

      const offlineCriteria: MonitorCriteriaInstance =
        criteriaOf(monitorSteps)[0]!;

      offlineCriteria.setName("Acme is down and I want to know about it");
      offlineCriteria.setFilters([
        ...offlineCriteria.data!.filters,
        {
          checkOn: CheckOn.ResponseTime,
          filterType: FilterType.GreaterThan,
          value: 3000,
        },
      ]);

      return monitorSteps;
    }

    test("the name the user wrote survives a switch to a completely different monitor type", () => {
      const aligned: MonitorStepsAlignmentResult = alignTo(
        editedWebsiteSteps(),
        MonitorType.ExternalStatusPage,
      );

      expect(criteriaNamesOf(aligned.monitorSteps)).toContain(
        "Acme is down and I want to know about it",
      );
      expect(
        unrenderable(aligned.monitorSteps, MonitorType.ExternalStatusPage),
      ).toEqual([]);
    });

    test("the incident the user's criteria opens survives too", () => {
      const aligned: MonitorStepsAlignmentResult = alignTo(
        editedWebsiteSteps(),
        MonitorType.ExternalStatusPage,
      );

      const incidents: Array<CriteriaIncident> = criteriaOf(
        aligned.monitorSteps,
      ).flatMap((instance: MonitorCriteriaInstance) => {
        return instance.data?.incidents || [];
      });

      expect(
        incidents.map((incident: CriteriaIncident) => {
          return incident.title;
        }),
      ).toContain("Acme is offline");
    });

    test("a threshold the user typed survives when the new monitor type still offers that check", () => {
      /*
       * Website and API both offer Response Time, so switching between
       * them must not touch a threshold typed against it - the whole point
       * of repairing rather than re-seeding.
       */
      const aligned: MonitorStepsAlignmentResult = alignTo(
        editedWebsiteSteps(),
        MonitorType.API,
      );

      expect(
        filtersOf(aligned.monitorSteps).find((filter: CriteriaFilter) => {
          return filter.checkOn === CheckOn.ResponseTime;
        })?.value,
      ).toBe(3000);
    });

    test("only the filters the new monitor type cannot render are dropped", () => {
      /*
       * The edited criteria carries three filters: "Is Online" is false,
       * the status code is not 200, and the response took over three
       * seconds. A Server monitor offers Is Online but neither of the
       * other two checks, so the first filter should come through
       * untouched and the other two should simply go.
       */
      const aligned: MonitorStepsAlignmentResult = alignTo(
        editedWebsiteSteps(),
        MonitorType.Server,
      );

      const repairedCriteria: MonitorCriteriaInstance = criteriaOf(
        aligned.monitorSteps,
      ).find((instance: MonitorCriteriaInstance) => {
        return (
          instance.data!.name === "Acme is down and I want to know about it"
        );
      })!;

      expect(repairedCriteria.data!.filters).toEqual([
        {
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.False,
          value: undefined,
        },
      ]);

      expect(unrenderable(aligned.monitorSteps, MonitorType.Server)).toEqual(
        [],
      );
    });

    test("a filter the new monitor type cannot express is dropped, never swapped for one the user did not write", () => {
      /*
       * This is the regression that matters most in this file.
       *
       * The obvious repair - swap an unusable filter for this monitor
       * type's default - quietly INVERTS the criteria. Every monitor
       * type's default filter is a positive, immediately-matching rule
       * ("is online / True"), and every seeded offline criteria runs
       * under the "Any" filter condition, so one such filter is enough to
       * fire the whole criteria. The criteria keeps its name, its
       * "create incident" flag, its "Acme is offline" incident and its
       * offline monitor status - and now fires while Acme is perfectly
       * healthy.
       *
       * A stale filter at least failed safe by never matching. So: no
       * fabricated filter may ever be added alongside the user's
       * surviving ones.
       */
      const aligned: MonitorStepsAlignmentResult = alignTo(
        editedWebsiteSteps(),
        MonitorType.Server,
      );

      const repairedCriteria: MonitorCriteriaInstance = criteriaOf(
        aligned.monitorSteps,
      ).find((instance: MonitorCriteriaInstance) => {
        return (
          instance.data!.name === "Acme is down and I want to know about it"
        );
      })!;

      // The criteria still opens an incident, under "Any".
      expect(repairedCriteria.data!.createIncidents).toBe(true);
      expect(repairedCriteria.data!.filterCondition).toBe(FilterCondition.Any);

      const positiveFilters: Array<CriteriaFilter> =
        repairedCriteria.data!.filters.filter((filter: CriteriaFilter) => {
          return filter.filterType === FilterType.True;
        });

      expect(positiveFilters).toEqual([]);
      expect(repairedCriteria.data!.filters).not.toContainEqual(
        CriteriaFilterUtil.getDefaultCriteriaFilter(MonitorType.Server),
      );
    });

    test("a criteria left with nothing it can express is refilled from the matching half of the new type's defaults", () => {
      /*
       * Website to External Status Page drops every filter of the offline
       * criteria, and a criteria with no filters at all is not something
       * the form can show. It is refilled - but from the type's OFFLINE
       * defaults, because this criteria opens an incident. Refilling it
       * from the online defaults would produce the inversion above by
       * another route.
       */
      const aligned: MonitorStepsAlignmentResult = alignTo(
        editedWebsiteSteps(),
        MonitorType.ExternalStatusPage,
      );

      const repairedCriteria: MonitorCriteriaInstance = criteriaOf(
        aligned.monitorSteps,
      ).find((instance: MonitorCriteriaInstance) => {
        return (
          instance.data!.name === "Acme is down and I want to know about it"
        );
      })!;

      const offlineDefaults: MonitorCriteriaInstance =
        MonitorCriteriaInstance.getDefaultOfflineMonitorCriteriaInstance({
          monitorType: MonitorType.ExternalStatusPage,
          monitorStatusId: SEED_OPTIONS.offlineMonitorStatusId,
          incidentSeverityId: SEED_OPTIONS.defaultIncidentSeverityId,
          alertSeverityId: SEED_OPTIONS.defaultAlertSeverityId,
          monitorName: SEED_OPTIONS.monitorName,
        });

      expect(repairedCriteria.data!.filters).toEqual(
        offlineDefaults.data!.filters,
      );

      /*
       * Concretely: it fires when the status page is NOT online, which is
       * what a criteria named "Acme is down" and carrying an "Acme is
       * offline" incident has to do.
       */
      expect(repairedCriteria.data!.filters[0]).toEqual({
        checkOn: CheckOn.ExternalStatusPageIsOnline,
        filterType: FilterType.False,
        value: undefined,
      });

      // The user's own wording and incident are still theirs.
      expect(repairedCriteria.data!.name).toBe(
        "Acme is down and I want to know about it",
      );
      expect(repairedCriteria.data!.incidents[0]!.title).toBe(
        "Acme is offline",
      );
    });

    test("an up criteria left with nothing it can express is refilled from the online defaults", () => {
      /*
       * The other half of the same rule. The seeded "is online" criteria
       * raises nothing and parks the monitor on the operational status,
       * so it must come back matching when the target is UP.
       */
      const aligned: MonitorStepsAlignmentResult = alignTo(
        editedWebsiteSteps(),
        MonitorType.ExternalStatusPage,
      );

      const onlineCriteria: MonitorCriteriaInstance = criteriaOf(
        aligned.monitorSteps,
      ).find((instance: MonitorCriteriaInstance) => {
        return (
          instance.data!.monitorStatusId?.toString() ===
          SEED_OPTIONS.onlineMonitorStatusId.toString()
        );
      })!;

      const onlineDefaults: MonitorCriteriaInstance =
        MonitorCriteriaInstance.getDefaultOnlineMonitorCriteriaInstance({
          monitorType: MonitorType.ExternalStatusPage,
          monitorStatusId: SEED_OPTIONS.onlineMonitorStatusId,
          monitorName: SEED_OPTIONS.monitorName,
        })!;

      expect(onlineCriteria.data!.filters).toEqual(
        onlineDefaults.data!.filters,
      );
      expect(onlineCriteria.data!.filters[0]).toEqual({
        checkOn: CheckOn.ExternalStatusPageIsOnline,
        filterType: FilterType.True,
        value: undefined,
      });
    });

    test.each(MONITOR_TYPES_WITH_CRITERIA)(
      "no criteria is ever left with no filters at all, aligning to %s",
      (monitorType: MonitorType) => {
        const empty: Array<string> = [];

        for (const seededFor of sourceTypesFor(monitorType)) {
          const edited: MonitorSteps = stepsSeededFor(seededFor);
          criteriaOf(edited).forEach((instance: MonitorCriteriaInstance) => {
            instance.setName("My own rule");
          });

          const aligned: MonitorStepsAlignmentResult = alignTo(
            edited,
            monitorType,
          );

          for (const instance of criteriaOf(aligned.monitorSteps)) {
            if ((instance.data?.filters || []).length === 0) {
              empty.push(
                `seeded for ${seededFor}: "${instance.data!.name}" came back with no filters`,
              );
            }
          }
        }

        expect(empty).toEqual([]);
      },
    );

    test.each(MONITOR_TYPES_WITH_CRITERIA)(
      "an incident-raising criteria is never refilled with the up-rules, aligning to %s",
      (monitorType: MonitorType) => {
        /*
         * The inversion, swept over every pair. A criteria that opens an
         * incident and had to be refilled must not come back carrying the
         * rules this monitor type uses to decide it is UP - that is the
         * shape that alerts when all is well.
         *
         * Stated against the online defaults rather than against the
         * offline ones on purpose: "did not end up with the up-rules" is
         * the property that matters and is not a restatement of how the
         * replacement is chosen.
         */
        const onlineDefaults: string = JSON.stringify(
          MonitorCriteriaAlignmentUtil.renderableFilters(
            MonitorCriteriaInstance.getDefaultOnlineMonitorCriteriaInstance({
              monitorType: monitorType,
              monitorStatusId: SEED_OPTIONS.onlineMonitorStatusId,
              monitorName: SEED_OPTIONS.monitorName,
            })?.data?.filters || [],
            monitorType,
          ),
        );

        const offlineDefaults: string = JSON.stringify(
          MonitorCriteriaAlignmentUtil.renderableFilters(
            MonitorCriteriaInstance.getDefaultOfflineMonitorCriteriaInstance({
              monitorType: monitorType,
              monitorStatusId: SEED_OPTIONS.offlineMonitorStatusId,
              incidentSeverityId: SEED_OPTIONS.defaultIncidentSeverityId,
              alertSeverityId: SEED_OPTIONS.defaultAlertSeverityId,
              monitorName: SEED_OPTIONS.monitorName,
            }).data?.filters || [],
            monitorType,
          ),
        );

        /*
         * Nothing to get wrong on types whose two halves are the same
         * rules (or which seed only one half).
         */
        if (onlineDefaults === offlineDefaults || onlineDefaults === "[]") {
          return;
        }

        const inverted: Array<string> = [];

        for (const seededFor of sourceTypesFor(monitorType)) {
          const edited: MonitorSteps = stepsSeededFor(seededFor);
          criteriaOf(edited).forEach((instance: MonitorCriteriaInstance) => {
            instance.setName("My own rule");
          });

          const before: Map<string, string> = new Map<string, string>(
            criteriaOf(edited).map((instance: MonitorCriteriaInstance) => {
              return [
                instance.data!.id,
                JSON.stringify(instance.data!.filters),
              ];
            }),
          );

          const aligned: MonitorStepsAlignmentResult = alignTo(
            edited,
            monitorType,
          );

          for (const instance of criteriaOf(aligned.monitorSteps)) {
            if (!instance.data?.createIncidents) {
              continue;
            }

            const after: string = JSON.stringify(instance.data.filters);

            // Untouched criteria are not refills; nothing was chosen.
            if (before.get(instance.data.id) === after) {
              continue;
            }

            if (after === onlineDefaults) {
              inverted.push(
                `seeded for ${seededFor}: incident-raising "${instance.data.name}" was refilled with ${monitorType}'s up-rules`,
              );
            }
          }
        }

        expect(inverted).toEqual([]);
      },
    );
  });

  describe("the monitor types excluded from the sweeps above", () => {
    /*
     * The exclusion list is only honest while it is true. These two
     * assertions fail if a type on it grows real seeded criteria (at which
     * point it should come off, and the sweeps should cover it) or if a
     * type not on it loses them.
     */
    test.each(MONITOR_TYPES_WITHOUT_SEEDED_CRITERIA)(
      "%s really does seed nothing its own form can draw",
      (monitorType: MonitorType) => {
        expect(
          MonitorCriteriaAlignmentUtil.renderableFilters(
            MonitorCriteriaInstance.getDefaultOfflineMonitorCriteriaInstance({
              monitorType: monitorType,
              monitorStatusId: SEED_OPTIONS.offlineMonitorStatusId,
              incidentSeverityId: SEED_OPTIONS.defaultIncidentSeverityId,
              alertSeverityId: SEED_OPTIONS.defaultAlertSeverityId,
              monitorName: SEED_OPTIONS.monitorName,
            }).data?.filters || [],
            monitorType,
          ),
        ).toEqual([]);
      },
    );

    test.each(MONITOR_TYPES_WITH_SEEDED_CRITERIA)(
      "%s really does seed something its own form can draw",
      (monitorType: MonitorType) => {
        expect(
          MonitorCriteriaAlignmentUtil.renderableFilters(
            MonitorCriteriaInstance.getDefaultOfflineMonitorCriteriaInstance({
              monitorType: monitorType,
              monitorStatusId: SEED_OPTIONS.offlineMonitorStatusId,
              incidentSeverityId: SEED_OPTIONS.defaultIncidentSeverityId,
              alertSeverityId: SEED_OPTIONS.defaultAlertSeverityId,
              monitorName: SEED_OPTIONS.monitorName,
            }).data?.filters || [],
            monitorType,
          ).length,
        ).toBeGreaterThan(0);
      },
    );

    test("aligning TO one of them still produces something drawable", () => {
      /*
       * The half that does work, and the half this change is responsible
       * for: a Website's criteria arriving on a Docker monitor come back
       * on the metric check Docker offers, not on the placeholder Docker
       * would have seeded for itself.
       */
      const aligned: MonitorStepsAlignmentResult = alignTo(
        stepsSeededFor(MonitorType.Website),
        MonitorType.Docker,
      );

      expect(aligned.didChange).toBe(true);
      expect(unrenderable(aligned.monitorSteps, MonitorType.Docker)).toEqual(
        [],
      );
      expect(filtersOf(aligned.monitorSteps)[0]!.checkOn).toBe(
        CheckOn.MetricValue,
      );
    });
  });

  describe("repairCriteriaFilterForMonitorType", () => {
    test("a filter the monitor type can already draw comes back as the very same object", () => {
      const criteriaFilter: CriteriaFilter = {
        checkOn: CheckOn.ResponseTime,
        filterType: FilterType.GreaterThan,
        value: 5000,
      };

      expect(
        CriteriaFilterUtil.repairCriteriaFilterForMonitorType({
          criteriaFilter: criteriaFilter,
          monitorType: MonitorType.Website,
        }),
      ).toBe(criteriaFilter);
    });

    test("a check the monitor type still offers keeps its value, only the condition moves", () => {
      /*
       * "Is Online" has never accepted Equal To - criteria stored that way
       * predate the seed being fixed. The check is fine on a Website, so
       * only the condition is replaced.
       */
      const repaired: CriteriaFilter | null =
        CriteriaFilterUtil.repairCriteriaFilterForMonitorType({
          criteriaFilter: {
            checkOn: CheckOn.IsOnline,
            filterType: FilterType.EqualTo,
            value: "keep me",
          },
          monitorType: MonitorType.Website,
        });

      expect(repaired).not.toBeNull();
      expect(repaired!.checkOn).toBe(CheckOn.IsOnline);
      expect(repaired!.filterType).toBe(FilterType.True);
      expect(repaired!.value).toBe("keep me");
    });

    test("a check the monitor type does not offer has no repair at all", () => {
      /*
       * Not this monitor type's default filter - null. The value went
       * with the check (3000ms of response time means nothing as a status
       * page component status), and substituting the type's default here
       * would hand the caller a positive, immediately-matching rule the
       * user never wrote. Whether that rule belongs in this criteria
       * depends on the whole criteria, so the caller decides.
       */
      expect(
        CriteriaFilterUtil.repairCriteriaFilterForMonitorType({
          criteriaFilter: {
            checkOn: CheckOn.ResponseTime,
            filterType: FilterType.GreaterThan,
            value: 3000,
          },
          monitorType: MonitorType.ExternalStatusPage,
        }),
      ).toBeNull();
    });

    test.each(ALL_MONITOR_TYPES)(
      "%s: whatever filter it is handed, what comes back has both dropdowns chosen",
      (monitorType: MonitorType) => {
        const handedIn: Array<CriteriaFilter> = [
          ...ALL_MONITOR_TYPES.flatMap((seededFor: MonitorType) => {
            return filtersOf(stepsSeededFor(seededFor));
          }),
          // Not filters any seed produces: mismatched, blank, and nonsense.
          {
            checkOn: CheckOn.IsOnline,
            filterType: FilterType.EqualTo,
            value: undefined,
          },
          {
            checkOn: CheckOn.MetricValue,
            filterType: undefined,
            value: undefined,
          },
          {
            checkOn: "Not A Real Check" as CheckOn,
            filterType: "Not A Real Filter Type" as FilterType,
            value: undefined,
          },
        ];

        const offeredChecks: Array<string> = checkOnOptionsFor(monitorType);
        const problems: Array<string> = [];

        for (const criteriaFilter of handedIn) {
          const repaired: CriteriaFilter | null =
            CriteriaFilterUtil.repairCriteriaFilterForMonitorType({
              criteriaFilter: criteriaFilter,
              monitorType: monitorType,
            });

          if (!repaired) {
            // "cannot be expressed" is a valid answer; the caller handles it.
            continue;
          }

          if (!offeredChecks.includes(repaired.checkOn?.toString())) {
            problems.push(
              `"${criteriaFilter.checkOn}" was repaired to check "${repaired.checkOn}", which ${monitorType} does not offer`,
            );
            continue;
          }

          if (
            !repaired.filterType ||
            !filterTypeOptionsFor(repaired.checkOn).includes(
              repaired.filterType.toString(),
            )
          ) {
            problems.push(
              `"${criteriaFilter.checkOn}" was repaired to check "${repaired.checkOn}" with condition "${repaired.filterType}", which that check does not offer`,
            );
          }
        }

        expect(problems).toEqual([]);
      },
    );
  });

  describe("isUntouchedDefaultFor", () => {
    test.each(ALL_MONITOR_TYPES)(
      "%s recognises its own freshly seeded criteria",
      (monitorType: MonitorType) => {
        expect(
          MonitorCriteriaAlignmentUtil.isUntouchedDefaultFor({
            monitorCriteria:
              stepsSeededFor(monitorType).data!.monitorStepsInstanceArray[0]!
                .data!.monitorCriteria,
            monitorType: monitorType,
            seedOptions: SEED_OPTIONS,
          }),
        ).toBe(true);
      },
    );

    test("the ids generated fresh for every seed are not mistaken for edits", () => {
      /*
       * Each seed generates new ObjectIDs for its criteria, incidents and
       * alerts, so two seeds of the same type are never byte-identical.
       * Comparing on those would report every criteria as edited and turn
       * the re-seed path off entirely.
       */
      const first: MonitorSteps = stepsSeededFor(MonitorType.Website);
      const second: MonitorSteps = stepsSeededFor(MonitorType.Website);

      expect(criteriaOf(first)[0]!.data!.id).not.toBe(
        criteriaOf(second)[0]!.data!.id,
      );

      expect(
        MonitorCriteriaAlignmentUtil.isUntouchedDefaultFor({
          monitorCriteria:
            first.data!.monitorStepsInstanceArray[0]!.data!.monitorCriteria,
          monitorType: MonitorType.Website,
          seedOptions: SEED_OPTIONS,
        }),
      ).toBe(true);
    });

    test("a criteria the user renamed is not an untouched default", () => {
      const monitorSteps: MonitorSteps = stepsSeededFor(MonitorType.Website);
      criteriaOf(monitorSteps)[0]!.setName("Mine now");

      expect(
        MonitorCriteriaAlignmentUtil.isUntouchedDefaultFor({
          monitorCriteria:
            monitorSteps.data!.monitorStepsInstanceArray[0]!.data!
              .monitorCriteria,
          monitorType: MonitorType.Website,
          seedOptions: SEED_OPTIONS,
        }),
      ).toBe(false);
    });

    test("criteria that survived a round trip through the form's JSON are still untouched", () => {
      /*
       * The criteria the form hands back on mount have been serialized
       * into the form's value and read out again, which drops keys whose
       * value is undefined. That is not an edit, and treating it as one
       * would disable re-seeding on exactly the path the bug arrives by.
       */
      const roundTripped: MonitorSteps = MonitorSteps.fromJSON(
        stepsSeededFor(MonitorType.Website).toJSON(),
      );

      expect(
        MonitorCriteriaAlignmentUtil.isUntouchedDefaultFor({
          monitorCriteria:
            roundTripped.data!.monitorStepsInstanceArray[0]!.data!
              .monitorCriteria,
          monitorType: MonitorType.Website,
          seedOptions: SEED_OPTIONS,
        }),
      ).toBe(true);
    });

    test("the monitor name is part of what makes criteria untouched", () => {
      /*
       * The seeded names and incident titles quote the monitor's name, so
       * criteria seeded for one name are not the defaults for another.
       * Being wrong in this direction only costs a re-seed - the criteria
       * are repaired instead - which is the safe way to be wrong.
       */
      expect(
        MonitorCriteriaAlignmentUtil.isUntouchedDefaultFor({
          monitorCriteria: stepsSeededFor(MonitorType.Website).data!
            .monitorStepsInstanceArray[0]!.data!.monitorCriteria,
          monitorType: MonitorType.Website,
          seedOptions: { ...SEED_OPTIONS, monitorName: "Something else" },
        }),
      ).toBe(false);
    });
  });
});
