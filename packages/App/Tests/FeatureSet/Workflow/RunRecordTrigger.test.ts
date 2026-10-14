/*
 * Which trigger a workflow is run with, when it acts on a record, and the
 * service its records are read with (Utils/RunRecordTrigger). Generic: every
 * model a workflow can watch, found through the same registries the runner
 * uses, so a model added later is covered without a list here.
 */

import {
  RunRecordTrigger,
  getRunRecordService,
  getRunRecordTrigger,
} from "../../../FeatureSet/Workflow/Utils/RunRecordTrigger";
import { loadAllComponentMetadata } from "../../../FeatureSet/Workflow/Utils/ComponentMetadata";
import IncidentService from "Common/Server/Services/IncidentService";
import AlertService from "Common/Server/Services/AlertService";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import Dictionary from "Common/Types/Dictionary";
import ComponentMetadata, {
  ComponentType,
} from "Common/Types/Workflow/Component";
import ComponentID from "Common/Types/Workflow/ComponentID";
import { describe, expect, test } from "@jest/globals";

describe("the trigger a workflow is run with", () => {
  test.each([
    ["incident-on-create", IncidentService],
    ["incident-on-update", IncidentService],
    ["incident-on-delete", IncidentService],
    ["alert-on-create", AlertService],
    ["scheduled-maintenance-on-update", ScheduledMaintenanceService],
  ])(
    "%s runs with the records its model's service reads",
    (triggerId: string, service: unknown) => {
      const trigger: RunRecordTrigger | null = getRunRecordTrigger(triggerId);

      expect(trigger?.metadata.id).toBe(triggerId);
      expect(trigger?.service).toBe(service);
    },
  );

  test("a step that is no record trigger has none", () => {
    for (const id of [
      ComponentID.Webhook,
      ComponentID.Manual,
      ComponentID.Schedule,
      ComponentID.IncomingEmail,
      "incident-find-one",
      "incident-create-one",
      "no-such-step",
      "",
      null,
      undefined,
    ]) {
      expect([id, getRunRecordTrigger(id)]).toEqual([id, null]);
    }
  });

  test("a table nobody serves has no service", () => {
    expect(getRunRecordService("NoSuchTable")).toBeNull();
  });

  /*
   * The guard: every record trigger a workflow can start from - every
   * model's On Create, On Update and On Delete - has a service to read its
   * record with, so Run Workflow can look its records up.
   */
  test("every record trigger of every model can be run with a record", () => {
    const metadata: Dictionary<ComponentMetadata> = loadAllComponentMetadata();
    let triggers: number = 0;

    for (const component of Object.values(metadata)) {
      if (
        component.componentType !== ComponentType.Trigger ||
        !component.tableName
      ) {
        continue;
      }

      triggers++;

      const trigger: RunRecordTrigger | null = getRunRecordTrigger(
        component.id,
      );

      expect([component.id, trigger?.service.getModel().tableName]).toEqual([
        component.id,
        component.tableName,
      ]);
      // Records are looked up in the workflow's project.
      expect([
        component.id,
        Boolean(trigger?.service.getModel().getTenantColumn()),
      ]).toEqual([component.id, true]);
    }

    expect(triggers).toBeGreaterThan(100);
  });
});
