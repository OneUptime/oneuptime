import { describe, expect, test } from "@jest/globals";

import MonitorCriteriaDuplicateUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/MonitorCriteriaDuplicate";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { CriteriaAlert } from "../../../Types/Monitor/CriteriaAlert";
import { CheckOn, FilterType } from "../../../Types/Monitor/CriteriaFilter";
import { CriteriaIncident } from "../../../Types/Monitor/CriteriaIncident";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import ObjectID from "../../../Types/ObjectID";

/*
 * "Warn at 80%, page at 95%" used to mean filling the whole criteria form
 * in twice. Duplicating it is only safe if every id in the copy is fresh:
 * alerts and incidents are deduped server-side on (criteria id, alert id),
 * so a copy that reused them would be swallowed as "already open" and the
 * second threshold would never fire.
 */

const ORIGINAL_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SECOND_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function criteria(
  overrides?: Partial<NonNullable<MonitorCriteriaInstance["data"]>>,
): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  instance.data = {
    id: ORIGINAL_ID,
    monitorStatusId: new ObjectID("cccccccc-cccc-4ccc-8ccc-cccccccccccc"),
    filterCondition: FilterCondition.All,
    filters: [
      {
        checkOn: CheckOn.CPUUsagePercent,
        filterType: FilterType.GreaterThan,
        value: "80",
      },
    ],
    incidents: [],
    alerts: [],
    name: "CPU Warning",
    description: "CPU above 80%",
    changeMonitorStatus: true,
    createAlerts: false,
    createIncidents: false,
    ...overrides,
  };

  return instance;
}

describe("MonitorCriteriaDuplicateUtil.duplicate", () => {
  test("the copy keeps everything the user configured", () => {
    const copy: MonitorCriteriaInstance =
      MonitorCriteriaDuplicateUtil.duplicate(criteria());

    expect(copy.data?.description).toBe("CPU above 80%");
    expect(copy.data?.filterCondition).toBe(FilterCondition.All);
    expect(copy.data?.filters).toHaveLength(1);
    expect(copy.data?.filters?.[0]?.checkOn).toBe(CheckOn.CPUUsagePercent);
    expect(copy.data?.filters?.[0]?.value).toBe("80");
    expect(copy.data?.changeMonitorStatus).toBe(true);
    expect(copy.data?.monitorStatusId?.toString()).toBe(
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    );
  });

  test("the copy is named so the two can be told apart in the list", () => {
    const copy: MonitorCriteriaInstance =
      MonitorCriteriaDuplicateUtil.duplicate(criteria());

    expect(copy.data?.name).toBe(
      `CPU Warning${MonitorCriteriaDuplicateUtil.COPY_SUFFIX}`,
    );
  });

  test("the copy gets its own criteria id", () => {
    const copy: MonitorCriteriaInstance =
      MonitorCriteriaDuplicateUtil.duplicate(criteria());

    expect(copy.data?.id).toBeTruthy();
    expect(copy.data?.id).not.toBe(ORIGINAL_ID);
  });

  test("every alert and incident id is regenerated", () => {
    const alerts: Array<CriteriaAlert> = [
      { title: "Alert A", description: "", id: "alert-1" },
      { title: "Alert B", description: "", id: "alert-2" },
    ];
    const incidents: Array<CriteriaIncident> = [
      { title: "Incident A", description: "", id: "incident-1" },
    ];

    const copy: MonitorCriteriaInstance =
      MonitorCriteriaDuplicateUtil.duplicate(
        criteria({
          createAlerts: true,
          alerts: alerts,
          createIncidents: true,
          incidents: incidents,
        }),
      );

    const copiedAlertIds: Array<string> = (copy.data?.alerts || []).map(
      (alert: CriteriaAlert) => {
        return alert.id;
      },
    );
    const copiedIncidentIds: Array<string> = (copy.data?.incidents || []).map(
      (incident: CriteriaIncident) => {
        return incident.id;
      },
    );

    expect(copiedAlertIds).toHaveLength(2);
    expect(copiedAlertIds).not.toContain("alert-1");
    expect(copiedAlertIds).not.toContain("alert-2");
    expect(new Set(copiedAlertIds).size).toBe(2);

    expect(copiedIncidentIds).toEqual([expect.any(String)]);
    expect(copiedIncidentIds).not.toContain("incident-1");

    // Everything except the id survives.
    expect(copy.data?.alerts?.[0]?.title).toBe("Alert A");
    expect(copy.data?.incidents?.[0]?.title).toBe("Incident A");
  });

  test("editing the copy does not reach back into the original", () => {
    const original: MonitorCriteriaInstance = criteria();
    const copy: MonitorCriteriaInstance =
      MonitorCriteriaDuplicateUtil.duplicate(original);

    copy.setName("Something else");
    if (copy.data?.filters?.[0]) {
      copy.data.filters[0].value = "95";
    }

    expect(original.data?.name).toBe("CPU Warning");
    expect(original.data?.filters?.[0]?.value).toBe("80");
  });

  test("two copies of the same criteria do not collide", () => {
    const original: MonitorCriteriaInstance = criteria({
      createAlerts: true,
      alerts: [{ title: "Alert", description: "", id: "alert-1" }],
    });

    const first: MonitorCriteriaInstance =
      MonitorCriteriaDuplicateUtil.duplicate(original);
    const second: MonitorCriteriaInstance =
      MonitorCriteriaDuplicateUtil.duplicate(original);

    expect(first.data?.id).not.toBe(second.data?.id);
    expect(first.data?.alerts?.[0]?.id).not.toBe(second.data?.alerts?.[0]?.id);
  });
});

describe("MonitorCriteriaDuplicateUtil.insertDuplicateAfter", () => {
  test("the copy lands directly after what it was copied from", () => {
    const first: MonitorCriteriaInstance = criteria({ name: "First" });
    const second: MonitorCriteriaInstance = criteria({
      id: SECOND_ID,
      name: "Second",
    });

    const result: {
      criteriaInstances: Array<MonitorCriteriaInstance>;
      duplicate: MonitorCriteriaInstance | undefined;
    } = MonitorCriteriaDuplicateUtil.insertDuplicateAfter({
      criteriaInstances: [first, second],
      criteriaId: ORIGINAL_ID,
    });

    expect(
      result.criteriaInstances.map((instance: MonitorCriteriaInstance) => {
        return instance.data?.name;
      }),
    ).toEqual([
      "First",
      `First${MonitorCriteriaDuplicateUtil.COPY_SUFFIX}`,
      "Second",
    ]);
  });

  test("the original array is left alone", () => {
    const instances: Array<MonitorCriteriaInstance> = [criteria()];

    MonitorCriteriaDuplicateUtil.insertDuplicateAfter({
      criteriaInstances: instances,
      criteriaId: ORIGINAL_ID,
    });

    expect(instances).toHaveLength(1);
  });

  test("an id that is not in the list changes nothing", () => {
    const instances: Array<MonitorCriteriaInstance> = [criteria()];

    const result: {
      criteriaInstances: Array<MonitorCriteriaInstance>;
      duplicate: MonitorCriteriaInstance | undefined;
    } = MonitorCriteriaDuplicateUtil.insertDuplicateAfter({
      criteriaInstances: instances,
      criteriaId: "not-a-real-id",
    });

    expect(result.duplicate).toBeUndefined();
    expect(result.criteriaInstances).toHaveLength(1);
  });

  test("an undefined id changes nothing", () => {
    const result: {
      criteriaInstances: Array<MonitorCriteriaInstance>;
      duplicate: MonitorCriteriaInstance | undefined;
    } = MonitorCriteriaDuplicateUtil.insertDuplicateAfter({
      criteriaInstances: [criteria()],
      criteriaId: undefined,
    });

    expect(result.duplicate).toBeUndefined();
    expect(result.criteriaInstances).toHaveLength(1);
  });
});
