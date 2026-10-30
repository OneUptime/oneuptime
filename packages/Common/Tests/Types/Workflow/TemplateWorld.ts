/*
 * ONE PROJECT, HELD IN MEMORY, FOR A TEMPLATE AND THE TEMPLATE IT REPLACED.
 *
 * The equivalence suites (*TemplateEquivalence.test.ts) run a template as it
 * was before it was made simple (TemplateGraphsBeforeSimplifying) and as it
 * is now, on the same sample payloads, and expect the same outcome. Both have
 * to run against the same project for that to mean anything, so this is the
 * project: its incidents and alerts, their states and severities, their
 * state timelines and private notes (FromAnotherToolFakes' tables).
 *
 * The old graphs reached it through the database steps - Find One, Find Many
 * and Create One of each table - and the simulator runs those steps for real
 * against these tables (WorkflowTemplateSimulator, Scenario.world). The new
 * templates reach it through Incident and Alert From Another Tool, which run
 * for real against the same tables. What the two leave behind is compared by
 * snapshot(): what a person would see on the records.
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { FromAnotherToolServices } from "../../../Server/Types/Workflow/Components/FromAnotherTool/RecordFromAnotherTool";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import ComponentID from "../../../Types/Workflow/ComponentID";
import {
  ALERT_SPEC,
  FakeProject,
  FakeTable,
  INCIDENT_SPEC,
  SeveritySpec,
  StateSpec,
  addRecord,
  makeFakeProject,
} from "../../Server/Types/Workflow/Components/FromAnotherToolFakes";

export interface TemplateWorldOptions {
  incidentStates?: Array<StateSpec> | undefined;
  incidentSeverities?: Array<SeveritySpec> | undefined;
  alertStates?: Array<StateSpec> | undefined;
  alertSeverities?: Array<SeveritySpec> | undefined;
}

export interface ExistingRecord {
  customFields?: JSONObject | undefined;
  stateName?: string | undefined;
  title?: string | undefined;
}

const asText: (value: unknown) => string = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }

  if (value instanceof BaseModel) {
    return value.id?.toString() || "";
  }

  return String(value);
};

const nameOf: (value: unknown) => string | null = (
  value: unknown,
): string | null => {
  return value instanceof BaseModel
    ? String(value.getColumnValue("name"))
    : null;
};

export default class TemplateWorld {
  public incidents: FakeProject;
  public alerts: FakeProject;

  public constructor(options?: TemplateWorldOptions | undefined) {
    this.incidents = makeFakeProject({
      spec: INCIDENT_SPEC,
      ...(options?.incidentStates ? { states: options.incidentStates } : {}),
      ...(options?.incidentSeverities
        ? { severities: options.incidentSeverities }
        : {}),
    });
    this.alerts = makeFakeProject({
      spec: ALERT_SPEC,
      ...(options?.alertStates ? { states: options.alertStates } : {}),
      ...(options?.alertSeverities
        ? { severities: options.alertSeverities }
        : {}),
    });
  }

  /*
   * The table a database step works with, by the start of its component id:
   * "incident" for incident-find-one, "alert-state" for alert-state-find-many.
   */
  public tableFor(dashedTableName: string): FakeTable | null {
    const tables: Record<string, FakeTable> = {
      incident: this.incidents.records,
      "incident-state": this.incidents.states,
      "incident-severity": this.incidents.severities,
      "incident-state-timeline": this.incidents.timeline,
      "incident-internal-note": this.incidents.notes,
      alert: this.alerts.records,
      "alert-state": this.alerts.states,
      "alert-severity": this.alerts.severities,
      "alert-state-timeline": this.alerts.timeline,
      "alert-internal-note": this.alerts.notes,
    };

    return tables[dashedTableName] || null;
  }

  // What Incident or Alert From Another Tool works through.
  public servicesFor(componentId: string): FromAnotherToolServices {
    if (componentId === ComponentID.IncidentFromAnotherTool) {
      return this.incidents.services;
    }

    if (componentId === ComponentID.AlertFromAnotherTool) {
      return this.alerts.services;
    }

    throw new Error(`${componentId} works with no records of this world.`);
  }

  // An incident the project already has: INC-1, INC-2, ... in order.
  public addIncident(record?: ExistingRecord | undefined): BaseModel {
    return addRecord({
      project: this.incidents,
      spec: INCIDENT_SPEC,
      ...(record?.customFields ? { customFields: record.customFields } : {}),
      ...(record?.stateName ? { stateName: record.stateName } : {}),
      ...(record?.title ? { title: record.title } : {}),
    });
  }

  public addAlert(record?: ExistingRecord | undefined): BaseModel {
    return addRecord({
      project: this.alerts,
      spec: ALERT_SPEC,
      ...(record?.customFields ? { customFields: record.customFields } : {}),
      ...(record?.stateName ? { stateName: record.stateName } : {}),
      ...(record?.title ? { title: record.title } : {}),
    });
  }

  /*
   * What a person would see on the project's records once a run is over,
   * with the ids the database gave them left out: a record is named by its
   * number, a state and a severity by their names.
   */
  public snapshot(): JSONObject {
    return {
      incidents: this.recordsOf(this.incidents),
      incidentNotes: this.notesOf(this.incidents),
      incidentStateChanges: this.stateChangesOf(this.incidents),
      alerts: this.recordsOf(this.alerts),
      alertNotes: this.notesOf(this.alerts),
      alertStateChanges: this.stateChangesOf(this.alerts),
    };
  }

  private numberOf(project: FakeProject, recordId: unknown): string {
    const id: string = asText(recordId);
    const record: BaseModel | undefined = project.records.rows.find(
      (candidate: BaseModel): boolean => {
        return candidate.id?.toString() === id;
      },
    );

    return record
      ? String(record.getColumnValue(project.model.numberWithPrefixColumn))
      : `unknown record ${id}`;
  }

  private recordsOf(project: FakeProject): Array<JSONObject> {
    return project.records.rows.map((record: BaseModel): JSONObject => {
      const labels: unknown = record.getColumnValue("labels");
      const shown: JSONObject = {
        number: String(
          record.getColumnValue(project.model.numberWithPrefixColumn),
        ),
        title: (record.getColumnValue("title") as JSONValue) ?? null,
        description:
          (record.getColumnValue("description") as JSONValue) ?? null,
        severity: nameOf(record.getColumnValue(project.model.severityRelation)),
        state: nameOf(record.getColumnValue(project.model.stateRelation)),
        customFields:
          (record.getColumnValue("customFields") as JSONValue) ?? null,
        labels: Array.isArray(labels)
          ? labels
              .map((label: unknown): string => {
                return asText(
                  label instanceof BaseModel
                    ? label.id
                    : (label as JSONObject)?.["_id"],
                );
              })
              .sort()
          : [],
      };

      /*
       * Read as the record holds it: getColumnValue answers null for false,
       * and false - kept off status pages - is the value that matters here.
       */
      for (const column of project.model.statusPageColumns) {
        const value: unknown = (record as unknown as Record<string, unknown>)[
          column
        ];

        shown[column] = value === undefined ? null : (value as JSONValue);
      }

      return shown;
    });
  }

  private notesOf(project: FakeProject): Array<JSONObject> {
    return project.notes.rows.map((note: BaseModel): JSONObject => {
      return {
        record: this.numberOf(
          project,
          note.getColumnValue(project.model.recordIdColumn),
        ),
        note: (note.getColumnValue("note") as JSONValue) ?? null,
      };
    });
  }

  private stateChangesOf(project: FakeProject): Array<JSONObject> {
    return project.timeline.rows.map((change: BaseModel): JSONObject => {
      const stateId: string = asText(
        change.getColumnValue(project.model.timelineStateIdColumn),
      );
      const state: BaseModel | undefined = project.states.rows.find(
        (candidate: BaseModel): boolean => {
          return candidate.id?.toString() === stateId;
        },
      );

      return {
        record: this.numberOf(
          project,
          change.getColumnValue(project.model.recordIdColumn),
        ),
        state: state ? String(state.getColumnValue("name")) : stateId,
        rootCause: (change.getColumnValue("rootCause") as JSONValue) ?? null,
      };
    });
  }
}
