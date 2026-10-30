import DatabaseService from "../../../../Services/DatabaseService";
import ComponentCode, { RunOptions, RunReturnType } from "../../ComponentCode";
import { linkAffectedResourcesFromSetting } from "../BaseModel/AffectedResourcesArgument";
import logComponentError from "../BaseModel/LogComponentError";
import CaptureSpan from "../../../../Utils/Telemetry/CaptureSpan";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import ComponentMetadata, {
  Port,
} from "../../../../../Types/Workflow/Component";
import { AFFECTED_RESOURCES_ARGUMENT_ID } from "../../../../../Types/Workflow/AffectedResourcesSetting";
import FromAnotherToolComponents, {
  FROM_ANOTHER_TOOL_ARGUMENT_IDS,
  FROM_ANOTHER_TOOL_PORT_IDS,
  FROM_ANOTHER_TOOL_RETURN_VALUE_IDS,
  FromAnotherToolAction,
  FromAnotherToolKind,
  MAX_OUTSIDE_ID_LENGTH,
  WhatHappened,
  readOutsideId,
  readOutsideIdField,
  readWhatHappened,
} from "../../../../../Types/Workflow/Components/FromAnotherTool";

/*
 * Incident From Another Tool and Alert From Another Tool, at run time
 * (Types/Workflow/Components/FromAnotherTool says what they are for).
 *
 * One class for both: what differs is the services it reads and writes
 * through and the names of a few columns (FromAnotherToolRecordModel). It
 * reads and writes as the step - a Project Admin of the workflow's project
 * (getStepProps) - through the records' own services, so everything that
 * happens when a person opens, moves or notes a record happens here too:
 * its feed, its notifications, its owners, its workflows.
 */

// The services the step works through, for one kind of record.
export interface FromAnotherToolServices {
  record: DatabaseService<any>;
  state: DatabaseService<any>;
  severity: DatabaseService<any>;
  timeline: DatabaseService<any>;
  note: DatabaseService<any>;
}

// The columns that are named differently on an incident and on an alert.
export interface FromAnotherToolRecordModel {
  severityIdColumn: string;
  severityRelation: string;
  stateRelation: string;
  numberWithPrefixColumn: string;
  numberColumn: string;
  // The column a state-timeline row and a note name their record by.
  recordIdColumn: string;
  // The column a state-timeline row names its new state by.
  timelineStateIdColumn: string;
  // Incident only: the columns that keep it off status pages.
  statusPageColumns: Array<string>;
}

interface StateRow {
  id: string;
  name: string;
  order: number;
  isAcknowledgedState: boolean;
  isResolvedState: boolean;
}

interface Outcome {
  port: string;
  summary: string;
  record: BaseModel | null;
}

// An outside ID or name, as a sentence quotes it: on one line, and short.
const quoted: (value: string) => string = (value: string): string => {
  let text: string = "";

  for (const character of value) {
    text += character === "\n" || character === "\r" ? " " : character;
  }

  return text.length > 100 ? text.slice(0, 99) + "…" : text;
};

const readText: (value: unknown) => string = (value: unknown): string => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return typeof value === "string" ? value.trim() : "";
};

// A setting that is on: true, or the text "true", as a checkbox stores it.
const isOn: (value: unknown) => boolean = (value: unknown): boolean => {
  return value === true || (typeof value === "string" && value === "true");
};

// The label IDs a setting holds: a list, or text separated by commas or lines.
const readIds: (value: unknown) => {
  ids: Array<string>;
  notIds: number;
} = (value: unknown): { ids: Array<string>; notIds: number } => {
  const entries: Array<unknown> = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",").flatMap((part: string): Array<string> => {
          return part.split("\n");
        })
      : [];
  const ids: Array<string> = [];
  let notIds: number = 0;

  for (const entry of entries) {
    const text: string =
      typeof entry === "string"
        ? entry.trim()
        : entry && typeof entry === "object"
          ? readText((entry as JSONObject)["_id"])
          : "";

    if (!text) {
      continue;
    }

    if (!ObjectID.isValidUUID(text)) {
      notIds++;
      continue;
    }

    if (!ids.includes(text)) {
      ids.push(text);
    }
  }

  return { ids, notIds };
};

export default class RecordFromAnotherTool extends ComponentCode {
  private kind: FromAnotherToolKind;
  private services: FromAnotherToolServices;
  private model: FromAnotherToolRecordModel;

  public constructor(data: {
    kind: FromAnotherToolKind;
    services: FromAnotherToolServices;
    model: FromAnotherToolRecordModel;
  }) {
    super();

    const component: ComponentMetadata | undefined =
      FromAnotherToolComponents.find((i: ComponentMetadata) => {
        return i.id === data.kind.componentId;
      });

    if (!component) {
      throw new BadDataException(`${data.kind.componentId} not found.`);
    }

    this.setMetadata(component);
    this.kind = data.kind;
    this.services = data.services;
    this.model = data.model;
  }

  private getPort(id: string): Port {
    const port: Port | undefined = this.getMetadata().outPorts.find(
      (candidate: Port) => {
        return candidate.id === id;
      },
    );

    if (!port) {
      throw new BadDataException(`${id} port not found`);
    }

    return port;
  }

  // What the step hands on: the record as the next steps read it.
  private getRecordSelect(): JSONObject {
    return {
      _id: true,
      title: true,
      [this.model.numberColumn]: true,
      [this.model.numberWithPrefixColumn]: true,
      [this.model.severityRelation]: { _id: true, name: true },
      [this.model.stateRelation]: {
        _id: true,
        name: true,
        order: true,
        isAcknowledgedState: true,
        isResolvedState: true,
      },
    };
  }

  private numberOf(record: BaseModel): string {
    const value: unknown = record.getColumnValue(
      this.model.numberWithPrefixColumn,
    );

    return typeof value === "string" && value
      ? value
      : `the ${this.kind.noun}`;
  }

  // The record's number at the start of a sentence: "INC-12", or "The incident".
  private numberAtStart(record: BaseModel): string {
    const number: string = this.numberOf(record);

    return number.charAt(0).toUpperCase() + number.slice(1);
  }

  private async readRecord(
    id: ObjectID,
    props: DatabaseCommonInteractionProps,
    projectId: ObjectID,
  ): Promise<BaseModel | null> {
    return await this.services.record.findOneBy({
      query: { _id: id.toString(), projectId: projectId } as never,
      select: this.getRecordSelect() as never,
      props: props,
    });
  }

  private async findRecord(data: {
    recordId: string;
    outsideId: string;
    field: string;
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
  }): Promise<BaseModel | null> {
    if (data.recordId) {
      return await this.readRecord(
        new ObjectID(data.recordId),
        data.props,
        data.projectId,
      );
    }

    /*
     * The newest record with the ID: there should be one, but a record
     * made by hand, or by a workflow that lost the race to make it, can
     * hold the same ID too.
     */
    return await this.services.record.findOneBy({
      query: {
        projectId: data.projectId,
        customFields: { [data.field]: data.outsideId },
      } as never,
      select: this.getRecordSelect() as never,
      sort: { createdAt: SortOrder.Descending } as never,
      props: data.props,
    });
  }

  @CaptureSpan()
  public override async run(
    args: JSONObject,
    options: RunOptions,
  ): Promise<RunReturnType> {
    const ids: typeof FROM_ANOTHER_TOOL_ARGUMENT_IDS =
      FROM_ANOTHER_TOOL_ARGUMENT_IDS;
    const errorPort: Port = this.getPort(FROM_ANOTHER_TOOL_PORT_IDS.error);

    const fail: (reason: string) => RunReturnType = (
      reason: string,
    ): RunReturnType => {
      options.log(reason);

      return {
        returnValues: {
          [FROM_ANOTHER_TOOL_RETURN_VALUE_IDS.record]: null,
          [FROM_ANOTHER_TOOL_RETURN_VALUE_IDS.summary]: reason,
        },
        executePort: errorPort,
        executePortReason: reason,
      };
    };

    try {
      const whatHappened: WhatHappened = readWhatHappened(
        args[ids.whatHappened],
      );

      if (whatHappened.action === FromAnotherToolAction.None) {
        return this.finish(
          {
            port: FROM_ANOTHER_TOOL_PORT_IDS.unchanged,
            summary: "What Happened is empty, so nothing changed.",
            record: null,
          },
          options,
        );
      }

      const field: string | null = readOutsideIdField(args[ids.outsideIdField]);

      if (field === null) {
        return fail(
          "Outside ID Field must be a custom field's key: letters, digits and underscores, starting with a letter.",
        );
      }

      const recordId: string = readText(args[ids.recordId]);
      const outsideId: string = readOutsideId(args[ids.outsideId]);

      if (recordId && !ObjectID.isValidUUID(recordId)) {
        return fail(
          `${this.kind.Noun} ID must be the ID of an ${this.kind.noun}, and "${quoted(recordId)}" is not one.`,
        );
      }

      if (!recordId && !outsideId) {
        return fail(
          `Outside ID is empty, so the step cannot tell which ${this.kind.noun} the event is about.`,
        );
      }

      if (outsideId.length > MAX_OUTSIDE_ID_LENGTH) {
        return fail(
          `Outside ID is longer than ${MAX_OUTSIDE_ID_LENGTH} characters, so it is not an ID.`,
        );
      }

      const props: DatabaseCommonInteractionProps =
        await this.getStepProps(options);
      const projectId: ObjectID = options.projectId;
      // "zabbixEventId 40312", or the record's own ID.
      const named: string = recordId
        ? `ID ${recordId}`
        : `${field} ${quoted(outsideId)}`;

      let record: BaseModel | null = null;

      try {
        record = await this.findRecord({
          recordId: recordId,
          outsideId: outsideId,
          field: field,
          props: props,
          projectId: projectId,
        });
      } catch (lookupError: unknown) {
        /*
         * Opening goes ahead when the check fails: a problem that pages
         * nobody is worse than a problem with two records. Anything else
         * needs the record it could not find.
         */
        if (whatHappened.action !== FromAnotherToolAction.Open || recordId) {
          throw lookupError;
        }

        options.log(
          `Could not check whether an ${this.kind.noun} has ${named} already, so a new one is ${this.kind.hasStatusPages ? "opened" : "created"}: ${
            lookupError instanceof Error
              ? lookupError.message
              : String(lookupError)
          }`,
        );
      }

      const outcome: Outcome = await this.act({
        args: args,
        whatHappened: whatHappened,
        record: record,
        named: named,
        field: field,
        outsideId: outsideId,
        props: props,
        projectId: projectId,
        options: options,
      });

      return this.finish(outcome, options);
    } catch (err: unknown) {
      return {
        ...fail(
          logComponentError({
            error: err,
            model: this.services.record.getModel(),
            log: options.log,
            stepTitle: this.getMetadata().title,
          }),
        ),
      };
    }
  }

  private finish(outcome: Outcome, options: RunOptions): RunReturnType {
    options.log(outcome.summary);

    return {
      returnValues: {
        [FROM_ANOTHER_TOOL_RETURN_VALUE_IDS.record]: outcome.record
          ? BaseModel.toJSON(
              outcome.record,
              this.services.record.modelType,
            )
          : null,
        [FROM_ANOTHER_TOOL_RETURN_VALUE_IDS.summary]: outcome.summary,
      },
      executePort: this.getPort(outcome.port),
      executePortReason: outcome.summary,
    };
  }

  private async act(data: {
    args: JSONObject;
    whatHappened: WhatHappened;
    record: BaseModel | null;
    named: string;
    field: string;
    outsideId: string;
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    options: RunOptions;
  }): Promise<Outcome> {
    const noun: string = this.kind.noun;
    const note: string = readText(
      data.args[FROM_ANOTHER_TOOL_ARGUMENT_IDS.note],
    );
    const record: BaseModel | null = data.record;

    if (data.whatHappened.action === FromAnotherToolAction.Open) {
      if (record) {
        return {
          port: FROM_ANOTHER_TOOL_PORT_IDS.unchanged,
          summary: `${this.numberAtStart(record)} already has ${data.named}, so no other ${noun} was ${this.kind.hasStatusPages ? "opened" : "created"}.`,
          record: record,
        };
      }

      return await this.open(data);
    }

    if (!record) {
      const doing: string =
        data.whatHappened.action === FromAnotherToolAction.Note
          ? "the note was not added"
          : data.whatHappened.action === FromAnotherToolAction.Acknowledge
            ? "there was nothing to acknowledge"
            : data.whatHappened.action === FromAnotherToolAction.Resolve
              ? "there was nothing to resolve"
              : "there was nothing to move";

      return {
        port: FROM_ANOTHER_TOOL_PORT_IDS.unchanged,
        summary: `No ${noun} has ${data.named}, so ${doing}.`,
        record: null,
      };
    }

    const resolvesByNote: boolean =
      data.whatHappened.action === FromAnotherToolAction.Resolve &&
      isOn(
        data.args[FROM_ANOTHER_TOOL_ARGUMENT_IDS.noteInsteadOfResolving],
      );

    if (
      data.whatHappened.action === FromAnotherToolAction.Note ||
      resolvesByNote
    ) {
      if (!note) {
        return {
          port: FROM_ANOTHER_TOOL_PORT_IDS.unchanged,
          summary: resolvesByNote
            ? `${this.numberAtStart(record)} was left for people to resolve, and Note is empty, so nothing was added.`
            : `Note is empty, so nothing was added to ${this.numberOf(record)}.`,
          record: record,
        };
      }

      await this.addNote({
        record: record,
        note: note,
        props: data.props,
        projectId: data.projectId,
      });

      return {
        port: FROM_ANOTHER_TOOL_PORT_IDS.updated,
        summary: resolvesByNote
          ? `Added the note to ${this.numberOf(record)}, and left it for people to resolve.`
          : `Added the note to ${this.numberOf(record)}.`,
        record: record,
      };
    }

    return await this.move({
      record: record,
      note: note,
      whatHappened: data.whatHappened,
      props: data.props,
      projectId: data.projectId,
    });
  }

  private async open(data: {
    args: JSONObject;
    named: string;
    field: string;
    outsideId: string;
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    options: RunOptions;
  }): Promise<Outcome> {
    const ids: typeof FROM_ANOTHER_TOOL_ARGUMENT_IDS =
      FROM_ANOTHER_TOOL_ARGUMENT_IDS;
    const noun: string = this.kind.noun;
    const title: string = readText(data.args[ids.title]);
    const opened: string = this.kind.hasStatusPages ? "opened" : "created";

    if (!title) {
      throw new BadDataException(
        `Title is empty, so no ${noun} was ${opened}.`,
      );
    }

    const severities: Array<BaseModel> = await this.services.severity.findBy({
      query: { projectId: data.projectId } as never,
      select: { _id: true, name: true, order: true } as never,
      sort: { order: SortOrder.Ascending } as never,
      limit: 100,
      skip: 0,
      props: data.props,
    });

    if (severities.length === 0) {
      throw new BadDataException(
        `This project has no ${noun} severities to put the ${noun} at.`,
      );
    }

    const severity: BaseModel = this.pickSeverity({
      severities: severities,
      given: readText(data.args[ids.severity]),
      log: data.options.log,
    });

    const json: JSONObject = {
      title: title,
      [this.model.severityIdColumn]: severity.id!.toString(),
      projectId: data.projectId.toString(),
    };

    const description: string = readText(data.args[ids.description]);

    if (description) {
      json["description"] = description;
    }

    if (data.outsideId) {
      json["customFields"] = { [data.field]: data.outsideId };
    }

    const labels: { ids: Array<string>; notIds: number } = readIds(
      data.args[ids.labels],
    );

    if (labels.notIds > 0) {
      data.options.log(
        `Labels: ${labels.notIds} ${labels.notIds === 1 ? "entry is" : "entries are"} not a label's ID and ${labels.notIds === 1 ? "was" : "were"} left out.`,
      );
    }

    if (labels.ids.length > 0) {
      json["labels"] = labels.ids.map((id: string): JSONObject => {
        return { _id: id };
      });
    }

    for (const column of this.model.statusPageColumns) {
      json[column] = isOn(data.args[ids.showOnStatusPages]);
    }

    const recordData: BaseModel = BaseModel.fromJSON(
      json,
      this.services.record.modelType,
    ) as BaseModel;

    await linkAffectedResourcesFromSetting({
      record: recordData,
      tableName: this.kind.tableName,
      value: data.args[AFFECTED_RESOURCES_ARGUMENT_ID],
      projectId: data.projectId,
      props: data.props,
      templateId: null,
      log: (message: string): void => {
        data.options.log(message);
      },
    });

    const created: BaseModel = await this.services.record.create({
      data: recordData,
      props: data.props,
    });

    const record: BaseModel =
      (await this.readRecord(created.id!, data.props, data.projectId)) ||
      created;

    return {
      port: FROM_ANOTHER_TOOL_PORT_IDS.opened,
      summary: `${this.kind.Opened} ${this.numberOf(record)} at ${quoted(
        String(severity.getColumnValue("name") || "its severity"),
      )}${data.outsideId ? ` for ${data.named}` : ""}.`,
      record: record,
    };
  }

  /*
   * The severity a new record opens at: the one the setting names, by ID or
   * by name, in any case. One that names none of them - a tool's own word,
   * or a severity this project renamed - is the most severe, and the run
   * log says so.
   */
  private pickSeverity(data: {
    severities: Array<BaseModel>;
    given: string;
    log: RunOptions["log"];
  }): BaseModel {
    const given: string = data.given.toLowerCase();

    if (given) {
      const found: BaseModel | undefined = data.severities.find(
        (severity: BaseModel): boolean => {
          const name: unknown = severity.getColumnValue("name");

          return (
            severity.id?.toString().toLowerCase() === given ||
            (typeof name === "string" && name.trim().toLowerCase() === given)
          );
        },
      );

      if (found) {
        return found;
      }
    }

    const mostSevere: BaseModel = data.severities[0] as BaseModel;

    data.log(
      given
        ? `Severity "${quoted(data.given)}" names none of this project's ${this.kind.noun} severities, so it is ${String(mostSevere.getColumnValue("name"))}, the most severe.`
        : `Severity is empty, so it is ${String(mostSevere.getColumnValue("name"))}, the most severe.`,
    );

    return mostSevere;
  }

  private async addNote(data: {
    record: BaseModel;
    note: string;
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
  }): Promise<void> {
    await this.services.note.create({
      data: BaseModel.fromJSON(
        {
          [this.model.recordIdColumn]: data.record.id!.toString(),
          note: data.note,
          projectId: data.projectId.toString(),
        },
        this.services.note.modelType,
      ) as BaseModel,
      props: data.props,
    });
  }

  private async readStates(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
  }): Promise<Array<StateRow>> {
    const states: Array<BaseModel> = await this.services.state.findBy({
      query: { projectId: data.projectId } as never,
      select: {
        _id: true,
        name: true,
        order: true,
        isAcknowledgedState: true,
        isResolvedState: true,
      } as never,
      sort: { order: SortOrder.Ascending } as never,
      limit: 100,
      skip: 0,
      props: data.props,
    });

    return states.map((state: BaseModel): StateRow => {
      return {
        id: state.id!.toString(),
        name: String(state.getColumnValue("name") || ""),
        order: Number(state.getColumnValue("order")),
        isAcknowledgedState: state.getColumnValue("isAcknowledgedState") === true,
        isResolvedState: state.getColumnValue("isResolvedState") === true,
      };
    });
  }

  /*
   * Acknowledge, resolve or a state's name: the record moves forward to the
   * state, by the rule every template moved records by - the first state
   * from the top flagged acknowledged or resolved, or the one named - and a
   * record at it or past it is left as it is. The Note is why, on its
   * timeline.
   */
  private async move(data: {
    record: BaseModel;
    note: string;
    whatHappened: WhatHappened;
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
  }): Promise<Outcome> {
    const noun: string = this.kind.noun;
    const states: Array<StateRow> = await this.readStates(data);
    const action: FromAnotherToolAction = data.whatHappened.action;
    let target: StateRow | undefined;

    if (action === FromAnotherToolAction.Acknowledge) {
      target = states.find((state: StateRow): boolean => {
        return state.isAcknowledgedState;
      });

      if (!target) {
        throw new BadDataException(
          `This project has no acknowledged ${noun} state.`,
        );
      }
    } else if (action === FromAnotherToolAction.Resolve) {
      target = states.find((state: StateRow): boolean => {
        return state.isResolvedState;
      });

      if (!target) {
        throw new BadDataException(`This project has no resolved ${noun} state.`);
      }
    } else {
      const wanted: string = data.whatHappened.given.trim().toLowerCase();

      target = states.find((state: StateRow): boolean => {
        return state.name.trim().toLowerCase() === wanted;
      });

      if (!target) {
        return {
          port: FROM_ANOTHER_TOOL_PORT_IDS.unchanged,
          summary: `"${quoted(data.whatHappened.given)}" is not open, acknowledge, resolve or note, nor one of this project's ${noun} states, so nothing changed.`,
          record: data.record,
        };
      }
    }

    const current: unknown = data.record.getColumnValue(
      this.model.stateRelation,
    );
    const currentName: string =
      current instanceof BaseModel
        ? String(current.getColumnValue("name") || "")
        : "";
    const currentOrder: number =
      current instanceof BaseModel
        ? Number(current.getColumnValue("order"))
        : Number.NaN;

    // A record never moves back: one at the state or past it stays.
    if (Number.isFinite(currentOrder) && currentOrder >= target.order) {
      return {
        port: FROM_ANOTHER_TOOL_PORT_IDS.unchanged,
        summary: `${this.numberAtStart(data.record)} is already ${quoted(currentName || "past " + target.name)}, so it was left as it is.`,
        record: data.record,
      };
    }

    const timeline: JSONObject = {
      [this.model.recordIdColumn]: data.record.id!.toString(),
      [this.model.timelineStateIdColumn]: target.id,
      projectId: data.projectId.toString(),
    };

    if (data.note) {
      timeline["rootCause"] = data.note;
    }

    await this.services.timeline.create({
      data: BaseModel.fromJSON(
        timeline,
        this.services.timeline.modelType,
      ) as BaseModel,
      props: data.props,
    });

    const moved: BaseModel =
      (await this.readRecord(data.record.id!, data.props, data.projectId)) ||
      data.record;

    return {
      port: FROM_ANOTHER_TOOL_PORT_IDS.updated,
      summary: `Moved ${this.numberOf(data.record)} to ${quoted(target.name)}.`,
      record: moved,
    };
  }
}
