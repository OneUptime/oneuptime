import { describe, expect, test } from "@jest/globals";
import { FilterType } from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import {
  StorageArrayAlertTemplate,
  getAllStorageArrayAlertTemplates,
} from "../../../Types/Monitor/StorageArrayAlertTemplates";
import ObjectID from "../../../Types/ObjectID";
import DellPowerMaxPlatform from "../../../Types/StorageArray/Platforms/Dell/PowerMax/PowerMaxPlatform";
import {
  POWERMAX_RESPONSE_TIME_WARNING_USEC,
  POWERMAX_STORAGE_GROUP_RESPONSE_TIME_WARNING_USEC,
} from "../../../Types/StorageArray/Platforms/Dell/PowerMax/PowerMaxAlertTemplates";
import { POWERMAX_METRICS } from "../../../Types/StorageArray/Platforms/Dell/PowerMax/PowerMaxSeries";
import StorageSystem from "../../../Types/StorageArray/StorageSystem";

/*
 * The Dell PowerMax alert templates (#11004), as the monitors they build:
 * each fires where it says, and recovers at a value its series can take -
 * a 0-or-1 series at 1, never 1.1 - and its description says the
 * recovery the monitor really has (the builder recovers 10% past a
 * threshold: StorageArrayAlertTemplates).
 */

interface BuiltCriteria {
  fireType: FilterType;
  fireValue: number;
  recoverType: FilterType;
  recoverValue: number;
}

function built(template: StorageArrayAlertTemplate): BuiltCriteria {
  const step: MonitorStep = template.getMonitorStep({
    arrayIdentifier: "000220200269",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "PowerMax",
  });
  const instances: Array<MonitorCriteriaInstance> =
    step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray;
  return {
    fireType: instances[0]!.data!.filters[0]!.filterType as FilterType,
    fireValue: Number(instances[0]!.data!.filters[0]!.value),
    recoverType: instances[1]!.data!.filters[0]!.filterType as FilterType,
    recoverValue: Number(instances[1]!.data!.filters[0]!.value),
  };
}

const TEMPLATES: Array<StorageArrayAlertTemplate> =
  getAllStorageArrayAlertTemplates().filter(
    (template: StorageArrayAlertTemplate): boolean => {
      return template.storageSystems.includes(StorageSystem.DellPowerMax);
    },
  );

function template(id: string): StorageArrayAlertTemplate {
  const found: StorageArrayAlertTemplate | undefined = TEMPLATES.find(
    (entry: StorageArrayAlertTemplate): boolean => {
      return entry.id === id;
    },
  );
  expect(found).toBeDefined();
  return found!;
}

describe("the PowerMax alert templates", () => {
  test("are the heartbeat and the twelve the issue asks for, each PowerMax's alone", () => {
    expect(
      TEMPLATES.map((entry: StorageArrayAlertTemplate): string => {
        return entry.id;
      }).sort(),
    ).toEqual(
      [
        DellPowerMaxPlatform.heartbeat.templateId,
        ...DellPowerMaxPlatform.alertTemplates.map(
          (entry: { id: string }): string => {
            return entry.id;
          },
        ),
      ].sort(),
    );
    expect(TEMPLATES).toHaveLength(13);
    for (const entry of TEMPLATES) {
      expect(entry.storageSystems).toEqual([StorageSystem.DellPowerMax]);
    }
  });

  test.each([
    ["powermax-srp-capacity-high", FilterType.GreaterThan, 80, 72],
    ["powermax-srp-capacity-critical", FilterType.GreaterThan, 90, 81],
    ["powermax-srdf-lag-high", FilterType.GreaterThan, 120, 108],
    [
      "powermax-storage-group-response-time-high",
      FilterType.GreaterThan,
      POWERMAX_STORAGE_GROUP_RESPONSE_TIME_WARNING_USEC,
      4500,
    ],
    [
      "powermax-read-response-time-high",
      FilterType.GreaterThan,
      POWERMAX_RESPONSE_TIME_WARNING_USEC,
      2700,
    ],
    [
      "powermax-write-response-time-high",
      FilterType.GreaterThan,
      POWERMAX_RESPONSE_TIME_WARNING_USEC,
      2700,
    ],
  ])(
    "%s fires past its line and recovers 10% back from it",
    (id: string, fireType: FilterType, fire: number, recover: number) => {
      const criteria: BuiltCriteria = built(template(id));
      expect(criteria).toEqual({
        fireType: fireType,
        fireValue: fire,
        recoverType: FilterType.LessThanOrEqualTo,
        recoverValue: recover,
      });
    },
  );

  test("performance collection, a 0-or-1 series, fires at 0 and recovers at 1 - never at 1.1", () => {
    const off: StorageArrayAlertTemplate = template(
      "powermax-performance-collection-off",
    );
    expect(built(off)).toEqual({
      fireType: FilterType.LessThan,
      fireValue: 1,
      recoverType: FilterType.GreaterThanOrEqualTo,
      recoverValue: 1,
    });
  });

  test("a series that exists only while something is wrong fires above 0 and recovers once it is gone", () => {
    for (const id of [
      "powermax-critical-alerts",
      "powermax-warning-alerts",
      "powermax-director-offline",
      "powermax-port-offline",
      "powermax-srdf-group-not-healthy",
    ]) {
      expect({ id, criteria: built(template(id)) }).toEqual({
        id,
        criteria: {
          fireType: FilterType.GreaterThan,
          fireValue: 0,
          recoverType: FilterType.EqualTo,
          recoverValue: 0,
        },
      });
    }
  });

  test("each description says the recovery its monitor has", () => {
    for (const [id, words] of [
      ["powermax-srp-capacity-high", "recover at 72% or less"],
      ["powermax-srp-capacity-critical", "recover at 81% or less"],
      ["powermax-srdf-lag-high", "recover at 108 seconds or less"],
      [
        "powermax-storage-group-response-time-high",
        "recover at 4.5 ms or less",
      ],
      ["powermax-read-response-time-high", "recover at 2.7 ms or less"],
      ["powermax-write-response-time-high", "recover at 2.7 ms or less"],
    ] as Array<[string, string]>) {
      expect({ id, says: template(id).description.includes(words) }).toEqual({
        id,
        says: true,
      });
    }
  });

  test("the heartbeat counts the series every collection writes", () => {
    expect(DellPowerMaxPlatform.heartbeat.metricName).toBe(
      POWERMAX_METRICS.arrayInfo,
    );
  });
});
