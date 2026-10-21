import { ModelSchema } from "../../../Utils/Schema/ModelSchema";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Alert from "../../../Models/DatabaseModels/Alert";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import StatusPageAnnouncement from "../../../Models/DatabaseModels/StatusPageAnnouncement";
import { describe, expect, test } from "@jest/globals";

/*
 * What the public API - and the Terraform provider generated from it -
 * offers to write on create and on update, for the columns an update hook
 * used to react to by their mere presence.
 *
 * "Notify status page subscribers" is a create-time choice: it is in the
 * create schema and not in the update schema. So the generated provider
 * never sends it on update (a change replaces the resource), and an API
 * client gets it refused rather than stored; only a workflow (root) or a
 * master admin can write it later, and that write no longer queues the
 * 'created' message (NotifyFlagUpdateNoResend.test.ts).
 *
 * The severity ID columns are in the update schema: that is how the API and
 * Terraform change a severity, and its side effects follow such a change
 * (SeverityChangeSideEffects.test.ts).
 */

type ModelCtor = new () => DatabaseBaseModel;

interface ColumnCase {
  model: string;
  modelType: ModelCtor;
  column: string;
}

function shapeKeys(schema: unknown): Array<string> {
  return Object.keys((schema as { shape: Record<string, unknown> }).shape);
}

const CREATE_ONLY_NOTIFY_FLAGS: Array<ColumnCase> = [
  {
    model: "Incident",
    modelType: Incident,
    column: "shouldStatusPageSubscribersBeNotifiedOnIncidentCreated",
  },
  {
    model: "ScheduledMaintenance",
    modelType: ScheduledMaintenance,
    column: "shouldStatusPageSubscribersBeNotifiedOnEventCreated",
  },
  {
    model: "StatusPageAnnouncement",
    modelType: StatusPageAnnouncement,
    column: "shouldStatusPageSubscribersBeNotified",
  },
  {
    model: "IncidentEpisode",
    modelType: IncidentEpisode,
    column: "shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated",
  },
];

const SEVERITY_ID_COLUMNS: Array<ColumnCase> = [
  { model: "Incident", modelType: Incident, column: "incidentSeverityId" },
  { model: "Alert", modelType: Alert, column: "alertSeverityId" },
];

describe("notify flags are create-only in the public API", () => {
  test.each(CREATE_ONLY_NOTIFY_FLAGS)(
    "$column of $model is in the create schema",
    (columnCase: ColumnCase) => {
      expect(
        shapeKeys(
          ModelSchema.getCreateModelSchema({
            modelType: columnCase.modelType,
          }),
        ),
      ).toContain(columnCase.column);
    },
  );

  test.each(CREATE_ONLY_NOTIFY_FLAGS)(
    "$column of $model is not in the update schema",
    (columnCase: ColumnCase) => {
      expect(
        shapeKeys(
          ModelSchema.getUpdateModelSchema({
            modelType: columnCase.modelType,
          }),
        ),
      ).not.toContain(columnCase.column);
    },
  );

  test.each(CREATE_ONLY_NOTIFY_FLAGS)(
    "no role may update $column of $model",
    (columnCase: ColumnCase) => {
      expect(
        new columnCase.modelType().getColumnAccessControlForAllColumns()[
          columnCase.column
        ]?.update,
      ).toEqual([]);
    },
  );
});

describe("a severity is changed through its ID column", () => {
  test.each(SEVERITY_ID_COLUMNS)(
    "$column of $model is in the update schema",
    (columnCase: ColumnCase) => {
      expect(
        shapeKeys(
          ModelSchema.getUpdateModelSchema({
            modelType: columnCase.modelType,
          }),
        ),
      ).toContain(columnCase.column);
    },
  );
});
