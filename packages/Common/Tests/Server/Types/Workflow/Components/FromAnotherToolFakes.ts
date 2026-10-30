/*
 * A project's incidents or alerts, held in memory, behind the five services
 * Incident From Another Tool and Alert From Another Tool work through
 * (FromAnotherToolServices). Enough of DatabaseService to answer what the
 * steps ask: one record by its ID or by a custom field, the project's states
 * and severities in order, and a new record, state change or note - which
 * moves the record, as IncidentStateTimelineService does.
 *
 * Every call is kept, with the props it came with, so a suite can check what
 * the step read and wrote, and as whom. Not a test file itself (jest only
 * collects *.test.ts).
 */

import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Alert from "../../../../../Models/DatabaseModels/Alert";
import AlertInternalNote from "../../../../../Models/DatabaseModels/AlertInternalNote";
import AlertSeverity from "../../../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../../../Models/DatabaseModels/AlertState";
import AlertStateTimeline from "../../../../../Models/DatabaseModels/AlertStateTimeline";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import IncidentInternalNote from "../../../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentSeverity from "../../../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../../../../Models/DatabaseModels/IncidentStateTimeline";
import DatabaseService from "../../../../../Server/Services/DatabaseService";
import NotNull from "../../../../../Types/BaseDatabase/NotNull";
import {
  ALERT_RECORD_MODEL,
  FromAnotherToolRecordModel,
  FromAnotherToolServices,
  INCIDENT_RECORD_MODEL,
} from "../../../../../Server/Types/Workflow/Components/FromAnotherTool/RecordFromAnotherTool";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";

export const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-2222-4333-8444-555555555555",
);

export interface StateSpec {
  name: string;
  order: number;
  isAcknowledgedState?: boolean;
  isResolvedState?: boolean;
}

export interface SeveritySpec {
  name: string;
  order: number;
  // Its ID, when a test needs to know it; otherwise one is made up.
  id?: string | undefined;
}

export interface FakeCall {
  method: "findOneBy" | "findBy" | "create";
  query?: JSONObject | undefined;
  data?: JSONObject | undefined;
  props: unknown;
  // When it was made, across every table: which of two calls came first.
  sequence: number;
}

let callSequence: number = 0;

const nextCallSequence: () => number = (): number => {
  callSequence++;
  return callSequence;
};

type ModelType = { new (): BaseModel };

let idCounter: number = 0;

const nextId: () => string = (): string => {
  idCounter++;
  const tail: string = String(idCounter).padStart(12, "0");
  return `aaaaaaaa-bbbb-4ccc-8ddd-${tail}`;
};

/*
 * One table: its rows, and what was asked of it. Only the methods the step
 * calls; anything else it calls is a test failure.
 */
export class FakeTable {
  public rows: Array<BaseModel> = [];
  public calls: Array<FakeCall> = [];
  public modelType: ModelType;
  public failNext: Error | null = null;
  public onCreate: ((row: BaseModel) => void) | null = null;

  public constructor(modelType: ModelType) {
    this.modelType = modelType;
  }

  public getModel(): BaseModel {
    return new this.modelType();
  }

  private failIfAsked(): void {
    if (this.failNext) {
      const error: Error = this.failNext;
      this.failNext = null;
      throw error;
    }
  }

  private matches(row: BaseModel, query: JSONObject): boolean {
    for (const key of Object.keys(query)) {
      const wanted: unknown = query[key];

      if (key === "customFields") {
        const fields: JSONObject =
          (row.getColumnValue("customFields") as JSONObject) || {};

        for (const field of Object.keys(wanted as JSONObject)) {
          if (fields[field] !== (wanted as JSONObject)[field]) {
            return false;
          }
        }

        continue;
      }

      const value: unknown =
        key === "_id" ? row.id?.toString() : row.getColumnValue(key);

      /*
       * "Has a value", as a database step's query writes it: the old
       * templates read every state and severity with _id NotNull.
       */
      if (
        wanted instanceof NotNull ||
        (Boolean(wanted) &&
          typeof wanted === "object" &&
          (wanted as JSONObject)["_type"] === "NotNull")
      ) {
        if (value === null || value === undefined) {
          return false;
        }

        continue;
      }

      if (String(value) !== String(wanted)) {
        return false;
      }
    }

    return true;
  }

  public async findOneBy(findBy: {
    query: JSONObject;
    props: unknown;
  }): Promise<BaseModel | null> {
    this.calls.push({
      method: "findOneBy",
      query: findBy.query,
      props: findBy.props,
      sequence: nextCallSequence(),
    });
    this.failIfAsked();

    const found: Array<BaseModel> = this.rows.filter((row: BaseModel) => {
      return this.matches(row, findBy.query);
    });

    // Newest first, as the step asks.
    return found[found.length - 1] || null;
  }

  public async findBy(findBy: {
    query: JSONObject;
    props: unknown;
  }): Promise<Array<BaseModel>> {
    this.calls.push({
      method: "findBy",
      query: findBy.query,
      props: findBy.props,
      sequence: nextCallSequence(),
    });
    this.failIfAsked();

    return this.rows
      .filter((row: BaseModel) => {
        return this.matches(row, findBy.query);
      })
      .sort((a: BaseModel, b: BaseModel): number => {
        return (
          Number(a.getColumnValue("order")) - Number(b.getColumnValue("order"))
        );
      });
  }

  public async create(createBy: {
    data: BaseModel;
    props: unknown;
  }): Promise<BaseModel> {
    this.calls.push({
      method: "create",
      data: BaseModel.toJSON(createBy.data, this.modelType),
      props: createBy.props,
      sequence: nextCallSequence(),
    });
    this.failIfAsked();

    const row: BaseModel = createBy.data;
    row.id = new ObjectID(nextId());
    this.rows.push(row);

    if (this.onCreate) {
      this.onCreate(row);
    }

    return row;
  }

  public creates(): Array<JSONObject> {
    return this.calls
      .filter((call: FakeCall): boolean => {
        return call.method === "create";
      })
      .map((call: FakeCall): JSONObject => {
        return call.data as JSONObject;
      });
  }
}

export interface FakeProject {
  records: FakeTable;
  states: FakeTable;
  severities: FakeTable;
  timeline: FakeTable;
  notes: FakeTable;
  services: FromAnotherToolServices;
  model: FromAnotherToolRecordModel;
  // The record's state's name now.
  stateOf: (record: BaseModel) => string;
}

interface KindSpec {
  record: ModelType;
  state: ModelType;
  severity: ModelType;
  timeline: ModelType;
  note: ModelType;
  model: FromAnotherToolRecordModel;
  prefix: string;
}

export const INCIDENT_SPEC: KindSpec = {
  record: Incident,
  state: IncidentState,
  severity: IncidentSeverity,
  timeline: IncidentStateTimeline,
  note: IncidentInternalNote,
  prefix: "INC-",
  model: INCIDENT_RECORD_MODEL,
};

export const ALERT_SPEC: KindSpec = {
  record: Alert,
  state: AlertState,
  severity: AlertSeverity,
  timeline: AlertStateTimeline,
  note: AlertInternalNote,
  prefix: "ALT-",
  model: ALERT_RECORD_MODEL,
};

export const DEFAULT_INCIDENT_STATES: Array<StateSpec> = [
  { name: "Identified", order: 1 },
  { name: "Acknowledged", order: 2, isAcknowledgedState: true },
  { name: "Monitoring", order: 3 },
  { name: "Resolved", order: 4, isResolvedState: true },
];

export const DEFAULT_INCIDENT_SEVERITIES: Array<SeveritySpec> = [
  { name: "Critical Incident", order: 1 },
  { name: "Major Incident", order: 2 },
  { name: "Minor Incident", order: 3 },
];

export const DEFAULT_ALERT_STATES: Array<StateSpec> = [
  { name: "Created", order: 1 },
  { name: "Acknowledged", order: 2, isAcknowledgedState: true },
  { name: "Resolved", order: 3, isResolvedState: true },
];

export const DEFAULT_ALERT_SEVERITIES: Array<SeveritySpec> = [
  { name: "High", order: 1 },
  { name: "Low", order: 2 },
];

export type MakeFakeProjectFunction = (data: {
  spec: KindSpec;
  states?: Array<StateSpec>;
  severities?: Array<SeveritySpec>;
}) => FakeProject;

export const makeFakeProject: MakeFakeProjectFunction = (data: {
  spec: KindSpec;
  states?: Array<StateSpec>;
  severities?: Array<SeveritySpec>;
}): FakeProject => {
  const spec: KindSpec = data.spec;
  const records: FakeTable = new FakeTable(spec.record);
  const states: FakeTable = new FakeTable(spec.state);
  const severities: FakeTable = new FakeTable(spec.severity);
  const timeline: FakeTable = new FakeTable(spec.timeline);
  const notes: FakeTable = new FakeTable(spec.note);

  for (const state of data.states ||
    (spec.record === Incident
      ? DEFAULT_INCIDENT_STATES
      : DEFAULT_ALERT_STATES)) {
    const row: BaseModel = new spec.state();
    row.id = new ObjectID(nextId());
    row.setColumnValue("name", state.name);
    row.setColumnValue("order", state.order);
    row.setColumnValue("isAcknowledgedState", state.isAcknowledgedState === true);
    row.setColumnValue("isResolvedState", state.isResolvedState === true);
    row.setColumnValue("projectId", PROJECT_ID);
    states.rows.push(row);
  }

  for (const severity of data.severities ||
    (spec.record === Incident
      ? DEFAULT_INCIDENT_SEVERITIES
      : DEFAULT_ALERT_SEVERITIES)) {
    const row: BaseModel = new spec.severity();
    row.id = new ObjectID(severity.id || nextId());
    row.setColumnValue("name", severity.name);
    row.setColumnValue("order", severity.order);
    row.setColumnValue("projectId", PROJECT_ID);
    severities.rows.push(row);
  }

  let number: number = 0;

  // A new record starts at the project's first state, and gets its number.
  records.onCreate = (row: BaseModel): void => {
    number++;
    row.setColumnValue(spec.model.numberColumn, number);
    row.setColumnValue(
      spec.model.numberWithPrefixColumn,
      `${spec.prefix}${number}`,
    );
    row.setColumnValue(spec.model.stateRelation, states.rows[0]);

    const severityId: unknown = row.getColumnValue(
      spec.model.severityIdColumn,
    );
    row.setColumnValue(
      spec.model.severityRelation,
      severities.rows.find((severity: BaseModel): boolean => {
        return severity.id?.toString() === String(severityId);
      }) || null,
    );
  };

  // A state change moves its record, as the timeline service does.
  timeline.onCreate = (row: BaseModel): void => {
    const recordId: string = String(
      row.getColumnValue(spec.model.recordIdColumn),
    );
    const stateId: string = String(
      row.getColumnValue(spec.model.timelineStateIdColumn),
    );
    const record: BaseModel | undefined = records.rows.find(
      (candidate: BaseModel): boolean => {
        return candidate.id?.toString() === recordId;
      },
    );
    const state: BaseModel | undefined = states.rows.find(
      (candidate: BaseModel): boolean => {
        return candidate.id?.toString() === stateId;
      },
    );

    if (record && state) {
      record.setColumnValue(spec.model.stateRelation, state);
    }
  };

  return {
    records,
    states,
    severities,
    timeline,
    notes,
    model: spec.model,
    services: {
      record: records as unknown as DatabaseService<any>,
      state: states as unknown as DatabaseService<any>,
      severity: severities as unknown as DatabaseService<any>,
      timeline: timeline as unknown as DatabaseService<any>,
      note: notes as unknown as DatabaseService<any>,
    },
    stateOf: (record: BaseModel): string => {
      const state: unknown = record.getColumnValue(spec.model.stateRelation);

      return state instanceof BaseModel
        ? String(state.getColumnValue("name"))
        : "";
    },
  };
};

// A record already in the project, with an outside ID in a custom field.
export const addRecord: (data: {
  project: FakeProject;
  spec: KindSpec;
  customFields?: JSONObject;
  stateName?: string;
  title?: string;
}) => BaseModel = (data: {
  project: FakeProject;
  spec: KindSpec;
  customFields?: JSONObject;
  stateName?: string;
  title?: string;
}): BaseModel => {
  const row: BaseModel = new data.spec.record();
  row.setColumnValue("title", data.title || "Existing");
  row.setColumnValue("projectId", PROJECT_ID);
  row.setColumnValue("customFields", data.customFields || {});
  row.setColumnValue(
    data.spec.model.severityIdColumn,
    data.project.severities.rows[0]!.id,
  );
  data.project.records.onCreate!(row);
  row.id = new ObjectID(nextId());
  data.project.records.rows.push(row);

  if (data.stateName) {
    row.setColumnValue(
      data.spec.model.stateRelation,
      data.project.states.rows.find((state: BaseModel): boolean => {
        return state.getColumnValue("name") === data.stateName;
      }),
    );
  }

  return row;
};
