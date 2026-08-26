import CriteriaFilterUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import { describe, expect, test } from "@jest/globals";

/*
 * Reported as #3412: on an External Status Page monitor, the seeded
 * "External Status Page Active Incidents" filter opened with its Filter
 * Condition dropdown showing an empty "Select...", while every other field
 * around it — including the sibling "Is Online" filter's condition and this
 * filter's own value — was already filled in.
 *
 * The criteria was NOT missing a condition. It was seeded with
 * FilterType.EqualTo and value 0 ("no active incidents"), but the dropdown
 * that renders the condition only offered Greater Than / Less Than / Greater
 * Than Or Equal To / Less Than Or Equal To for that check, so it could not
 * find an option matching the stored value and fell back to its placeholder.
 * The rule was fine; the form could not draw it.
 *
 * That is one instance of a class of defect, and this file locks the class
 * shut rather than the instance:
 *
 *   1. Every filter any default criteria seeds must be renderable — its
 *      "check on" has to be one the monitor type offers, and its filter type
 *      has to be one that check offers. Assertion (1) below sweeps every
 *      MonitorType and would have failed on the reported bug.
 *   2. Every filter the form hands the user must arrive with both dropdowns
 *      already chosen. Blank is not a neutral starting state: the server's
 *      comparators switch on the filter type and treat one they do not
 *      recognise as "no match", so a criteria saved with a blank condition
 *      silently never fires — and the empty dropdown is easy to walk past
 *      when every field around it is filled in.
 *
 * The instance-level regression tests for the External Status Page filter
 * itself live in ExternalStatusPageCriteriaFilter.test.ts. The same invariant
 * was pinned for two monitor types after an earlier instance of this bug, in
 * App/Tests/Dashboard/IncomingMonitorDefaultCriteriaForm.test.ts; this file is
 * that check widened to every monitor type, which is what it took to catch
 * this one.
 */

function optionValues(options: Array<DropdownOption>): Array<string> {
  return options.map((option: DropdownOption) => {
    return option.value.toString();
  });
}

function filterTypeOptionsFor(checkOn: CheckOn): Array<string> {
  return optionValues(
    CriteriaFilterUtil.getFilterTypeOptionsByCheckOn(checkOn),
  );
}

function checkOnOptionsFor(monitorType: MonitorType): Array<string> {
  return optionValues(
    CriteriaFilterUtil.getCheckOnOptionsByMonitorType(monitorType),
  );
}

const ALL_MONITOR_TYPES: Array<MonitorType> = Object.values(
  MonitorType,
) as Array<MonitorType>;

const ALL_CHECK_ONS: Array<CheckOn> = Object.values(CheckOn) as Array<CheckOn>;

/*
 * The default criteria a monitor of this type is created with, as the criteria
 * form would receive them. `getDefaultOnlineMonitorCriteriaInstance` returns
 * null for monitor types that only ship an offline criteria.
 */
function seededCriteriaInstances(
  monitorType: MonitorType,
): Array<MonitorCriteriaInstance> {
  const instances: Array<MonitorCriteriaInstance | null> = [
    MonitorCriteriaInstance.getDefaultOfflineMonitorCriteriaInstance({
      monitorType: monitorType,
      monitorStatusId: new ObjectID("aaaaaaaaaaaaaaaaaaaaaaaa"),
      incidentSeverityId: new ObjectID("bbbbbbbbbbbbbbbbbbbbbbbb"),
      alertSeverityId: new ObjectID("cccccccccccccccccccccccc"),
      monitorName: "Acme",
      metricOptions: { metricAliases: ["cpu"] },
    }),
    MonitorCriteriaInstance.getDefaultOnlineMonitorCriteriaInstance({
      monitorType: monitorType,
      monitorStatusId: new ObjectID("dddddddddddddddddddddddd"),
      monitorName: "Acme",
      metricOptions: { metricAliases: ["cpu"] },
    }),
  ];

  return instances.filter((instance: MonitorCriteriaInstance | null) => {
    return Boolean(instance?.data);
  }) as Array<MonitorCriteriaInstance>;
}

describe("Criteria filter defaults", () => {
  describe("every seeded default criteria is renderable in the criteria form", () => {
    test.each(ALL_MONITOR_TYPES)(
      "%s: every seeded filter's check is offered by the monitor type",
      (monitorType: MonitorType) => {
        const offeredChecks: Array<string> = checkOnOptionsFor(monitorType);

        const unrenderable: Array<string> = [];

        for (const instance of seededCriteriaInstances(monitorType)) {
          for (const filter of instance.data!.filters) {
            if (!offeredChecks.includes(filter.checkOn.toString())) {
              unrenderable.push(
                `"${instance.data!.name}" seeds check "${filter.checkOn}", which ${monitorType} does not offer`,
              );
            }
          }
        }

        expect(unrenderable).toEqual([]);
      },
    );

    test.each(ALL_MONITOR_TYPES)(
      "%s: every seeded filter's condition is offered by its check",
      (monitorType: MonitorType) => {
        const unrenderable: Array<string> = [];

        for (const instance of seededCriteriaInstances(monitorType)) {
          for (const filter of instance.data!.filters) {
            const offeredConditions: Array<string> = filterTypeOptionsFor(
              filter.checkOn,
            );

            if (!filter.filterType) {
              unrenderable.push(
                `"${instance.data!.name}" seeds check "${filter.checkOn}" with no condition at all`,
              );
              continue;
            }

            if (!offeredConditions.includes(filter.filterType.toString())) {
              unrenderable.push(
                `"${instance.data!.name}" seeds check "${filter.checkOn}" with condition "${filter.filterType}", which is not one of [${offeredConditions.join(", ")}]`,
              );
            }
          }
        }

        expect(unrenderable).toEqual([]);
      },
    );
  });

  describe("getDefaultFilterTypeByCheckOn", () => {
    test.each(ALL_CHECK_ONS)(
      "%s resolves to a condition the dropdown actually offers",
      (checkOn: CheckOn) => {
        const defaultFilterType: FilterType | undefined =
          CriteriaFilterUtil.getDefaultFilterTypeByCheckOn(checkOn);

        expect(defaultFilterType).toBeDefined();
        expect(filterTypeOptionsFor(checkOn)).toContain(
          defaultFilterType!.toString(),
        );
      },
    );

    /*
     * The default is the first option the check offers. Those lists are
     * written in FilterType declaration order and each is already led by the
     * condition that reads as the natural starting point for its kind of
     * check, so spot-check one of each kind rather than restating the table.
     */
    test.each([
      // Booleans start on True, not on "is not".
      [CheckOn.IsOnline, FilterType.True],
      [CheckOn.SqlIsOnline, FilterType.True],
      [CheckOn.ExternalStatusPageIsOnline, FilterType.True],
      [CheckOn.DomainIsExpired, FilterType.True],
      // Measurements start on a ceiling.
      [CheckOn.ResponseTime, FilterType.GreaterThan],
      [CheckOn.CPUUsagePercent, FilterType.GreaterThan],
      [CheckOn.ExpiresInDays, FilterType.GreaterThan],
      [CheckOn.ExternalStatusPageResponseTime, FilterType.GreaterThan],
      // Free text starts on a substring match.
      [CheckOn.ResponseBody, FilterType.Contains],
      [CheckOn.RequestHeaderValue, FilterType.Contains],
      // Counts and enumerated values start on an exact match.
      [CheckOn.ExternalStatusPageActiveIncidents, FilterType.EqualTo],
      [CheckOn.ExternalStatusPageComponentStatus, FilterType.EqualTo],
      [CheckOn.BrowserType, FilterType.EqualTo],
      [CheckOn.SqlQueryRowCount, FilterType.EqualTo],
      // Single-option and process checks have only one sensible start.
      [CheckOn.JavaScriptExpression, FilterType.EvaluatesToTrue],
      [CheckOn.ServerProcessName, FilterType.IsExecuting],
      [CheckOn.IncomingRequest, FilterType.NotRecievedInMinutes],
      [CheckOn.EmailReceivedAt, FilterType.NotRecievedInMinutes],
    ])("%s defaults to %s", (checkOn: CheckOn, expected: FilterType) => {
      expect(CriteriaFilterUtil.getDefaultFilterTypeByCheckOn(checkOn)).toBe(
        expected,
      );
    });
  });

  describe("getFilterTypeOrDefault", () => {
    test("keeps a condition that still applies to the new check", () => {
      expect(
        CriteriaFilterUtil.getFilterTypeOrDefault({
          checkOn: CheckOn.MetricValue,
          filterType: FilterType.LessThanOrEqualTo,
        }),
      ).toBe(FilterType.LessThanOrEqualTo);
    });

    test("replaces a condition the new check cannot use", () => {
      /*
       * A brand new criteria starts life on an "Is Online" / True filter.
       * Switching it to a metric threshold has to drop True, which numeric
       * comparison has no meaning for.
       */
      expect(filterTypeOptionsFor(CheckOn.MetricValue)).not.toContain(
        FilterType.True,
      );

      expect(
        CriteriaFilterUtil.getFilterTypeOrDefault({
          checkOn: CheckOn.MetricValue,
          filterType: FilterType.True,
        }),
      ).toBe(
        CriteriaFilterUtil.getDefaultFilterTypeByCheckOn(CheckOn.MetricValue),
      );
    });

    test("fills in a missing condition", () => {
      expect(
        CriteriaFilterUtil.getFilterTypeOrDefault({
          checkOn: CheckOn.IsOnline,
          filterType: undefined,
        }),
      ).toBe(FilterType.True);
    });

    test.each(ALL_CHECK_ONS)(
      "%s never resolves to a condition it does not offer, whatever it is handed",
      (checkOn: CheckOn) => {
        const handedIn: Array<FilterType | undefined> = [
          undefined,
          FilterType.True,
          FilterType.EvaluatesToTrue,
          FilterType.IsExecuting,
          FilterType.GreaterThan,
          FilterType.Contains,
          "Not A Real Filter Type" as FilterType,
        ];

        for (const filterType of handedIn) {
          const resolved: FilterType | undefined =
            CriteriaFilterUtil.getFilterTypeOrDefault({
              checkOn: checkOn,
              filterType: filterType,
            });

          expect(filterTypeOptionsFor(checkOn)).toContain(resolved!.toString());
        }
      },
    );
  });

  describe("getDefaultCheckOnByMonitorType", () => {
    test.each(ALL_MONITOR_TYPES)(
      "%s resolves to a check the monitor type actually offers",
      (monitorType: MonitorType) => {
        const defaultCheckOn: CheckOn | undefined =
          CriteriaFilterUtil.getDefaultCheckOnByMonitorType(monitorType);

        expect(defaultCheckOn).toBeDefined();
        expect(checkOnOptionsFor(monitorType)).toContain(
          defaultCheckOn!.toString(),
        );
      },
    );

    test.each([
      MonitorType.Website,
      MonitorType.API,
      MonitorType.Ping,
      MonitorType.IP,
      MonitorType.Port,
      MonitorType.Server,
      MonitorType.Domain,
    ])("%s prefers the up/down check", (monitorType: MonitorType) => {
      expect(
        CriteriaFilterUtil.getDefaultCheckOnByMonitorType(monitorType),
      ).toBe(CheckOn.IsOnline);
    });

    test.each([
      MonitorType.Kubernetes,
      MonitorType.Metrics,
      MonitorType.Docker,
      MonitorType.Host,
      MonitorType.Podman,
      MonitorType.DockerSwarm,
      MonitorType.Proxmox,
      MonitorType.Ceph,
    ])(
      "%s alerts on metrics, so it prefers the metric value check",
      (monitorType: MonitorType) => {
        expect(
          CriteriaFilterUtil.getDefaultCheckOnByMonitorType(monitorType),
        ).toBe(CheckOn.MetricValue);
      },
    );

    /*
     * The protocol-specific types have no up/down check on offer. Seeding one
     * anyway is what left the Filter Type dropdown blank as well as the
     * condition, on the very monitor type the bug was reported against.
     */
    test.each([
      [MonitorType.ExternalStatusPage, CheckOn.ExternalStatusPageIsOnline],
      [MonitorType.Logs, CheckOn.LogCount],
      [MonitorType.Traces, CheckOn.SpanCount],
      [MonitorType.Exceptions, CheckOn.ExceptionCount],
      [MonitorType.SecurityEvents, CheckOn.SecurityEventCount],
      [MonitorType.IncomingRequest, CheckOn.IncomingRequest],
    ])(
      "%s falls back to a check it does offer (%s)",
      (monitorType: MonitorType, expected: CheckOn) => {
        expect(checkOnOptionsFor(monitorType)).not.toContain(CheckOn.IsOnline);
        expect(
          CriteriaFilterUtil.getDefaultCheckOnByMonitorType(monitorType),
        ).toBe(expected);
      },
    );
  });

  describe("getDefaultCriteriaFilter", () => {
    test.each(ALL_MONITOR_TYPES)(
      "%s: a newly added filter arrives with both dropdowns already chosen",
      (monitorType: MonitorType) => {
        const criteriaFilter: CriteriaFilter =
          CriteriaFilterUtil.getDefaultCriteriaFilter(monitorType);

        expect(criteriaFilter.checkOn).toBeDefined();
        expect(criteriaFilter.filterType).toBeDefined();

        expect(checkOnOptionsFor(monitorType)).toContain(
          criteriaFilter.checkOn.toString(),
        );
        expect(filterTypeOptionsFor(criteriaFilter.checkOn)).toContain(
          criteriaFilter.filterType!.toString(),
        );
      },
    );

    test("External Status Page monitors get a status page check, not a bare Is Online", () => {
      const criteriaFilter: CriteriaFilter =
        CriteriaFilterUtil.getDefaultCriteriaFilter(
          MonitorType.ExternalStatusPage,
        );

      expect(criteriaFilter.checkOn).toBe(CheckOn.ExternalStatusPageIsOnline);
      expect(criteriaFilter.filterType).toBe(FilterType.True);
    });

    test("Website monitors keep the up/down check they had before", () => {
      const criteriaFilter: CriteriaFilter =
        CriteriaFilterUtil.getDefaultCriteriaFilter(MonitorType.Website);

      expect(criteriaFilter.checkOn).toBe(CheckOn.IsOnline);
      // Was FilterType.EqualTo, which "Is Online" has never accepted.
      expect(criteriaFilter.filterType).toBe(FilterType.True);
    });

    test("metric monitors keep their aggregation seeded alongside the threshold", () => {
      const criteriaFilter: CriteriaFilter =
        CriteriaFilterUtil.getDefaultCriteriaFilter(MonitorType.Kubernetes);

      expect(criteriaFilter.checkOn).toBe(CheckOn.MetricValue);
      expect(criteriaFilter.metricMonitorOptions?.metricAggregationType).toBe(
        EvaluateOverTimeType.AnyValue,
      );
    });

    test("non-metric monitors do not carry metric aggregation options", () => {
      expect(
        CriteriaFilterUtil.getDefaultCriteriaFilter(MonitorType.Website)
          .metricMonitorOptions,
      ).toBeUndefined();
    });

    test("returns a fresh object each call so added filters do not share state", () => {
      const first: CriteriaFilter = CriteriaFilterUtil.getDefaultCriteriaFilter(
        MonitorType.Website,
      );
      const second: CriteriaFilter =
        CriteriaFilterUtil.getDefaultCriteriaFilter(MonitorType.Website);

      expect(first).not.toBe(second);

      first.value = "changed";
      expect(second.value).toBe("");
    });
  });

  describe("isMetricOnlyMonitorType", () => {
    test.each([
      MonitorType.Kubernetes,
      MonitorType.Metrics,
      MonitorType.Docker,
      MonitorType.Host,
      MonitorType.Podman,
      MonitorType.DockerSwarm,
      MonitorType.Proxmox,
      MonitorType.Ceph,
    ])("%s is metric-only", (monitorType: MonitorType) => {
      expect(CriteriaFilterUtil.isMetricOnlyMonitorType(monitorType)).toBe(
        true,
      );
    });

    test.each([
      MonitorType.Website,
      MonitorType.API,
      MonitorType.Ping,
      MonitorType.Server,
      MonitorType.ExternalStatusPage,
      MonitorType.Logs,
      MonitorType.NetworkDevice,
    ])("%s is not metric-only", (monitorType: MonitorType) => {
      expect(CriteriaFilterUtil.isMetricOnlyMonitorType(monitorType)).toBe(
        false,
      );
    });
  });

  describe("the seed filter on a brand new criteria", () => {
    test("carries a condition, not just a check", () => {
      const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
      const filter: CriteriaFilter | undefined = instance.data?.filters[0];

      expect(filter?.checkOn).toBe(CheckOn.IsOnline);
      expect(filter?.filterType).toBe(FilterType.True);
      expect(filterTypeOptionsFor(filter!.checkOn)).toContain(
        filter!.filterType!.toString(),
      );
    });
  });
});
