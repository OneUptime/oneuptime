import DatabaseService from "../../../../Services/DatabaseService";
import RecordAttachments from "../../../../Utils/File/RecordAttachments";
import CaptureSpan from "../../../../Utils/Telemetry/CaptureSpan";
import ComponentCode, { RunOptions, RunReturnType } from "../../ComponentCode";
import logComponentError from "../BaseModel/LogComponentError";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import {
  AttachmentLeftOut,
  isAttachmentRecordType,
  RecordAttachmentsResult,
} from "../../../../../Types/File/RecordAttachments";
import { JSONArray, JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import ComponentMetadata, {
  Port,
} from "../../../../../Types/Workflow/Component";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import RecordAttachmentsComponents, {
  GET_ATTACHMENTS_FROM_RECORD_ARGUMENT_IDS,
  GET_ATTACHMENTS_FROM_RECORD_PORT_IDS,
  GET_ATTACHMENTS_FROM_RECORD_RETURN_VALUE_IDS,
} from "../../../../../Types/Workflow/Components/RecordAttachments";
import { parseTemplateExpressions } from "../../../../../Types/Workflow/TemplateSyntax";

/*
 * GET ATTACHMENTS FROM RECORD, run (#11477). Types/Workflow/Components/
 * RecordAttachments describes the step; Server/Utils/File/RecordAttachments
 * decides what it hands out.
 *
 * The record is read with the step's props (getStepProps): what the
 * workflow runs as, in its own project, never root. So a record a Find One
 * step could not read - another project's, a private incident, a table the
 * workflow's role may not read - is not read here either, and its files are
 * not handed out.
 *
 *   - Record Type that names no kind of record a workflow reads that can
 *     hold files, or Record ID left empty: the step cannot work as set up,
 *     and the run stops with why.
 *   - Record ID that is not an ID (a value from an earlier step), or a record
 *     that is not there for the workflow: Error, with why.
 *   - Otherwise Success, with every file the record holds in Files, and the
 *     files it holds that are not in Files under Left Out.
 */
export default class GetAttachmentsFromRecord extends ComponentCode {
  // The services of the record types the step reads, by table name.
  private servicesByTable: Map<string, DatabaseService<BaseModel>> = new Map();

  public constructor(services: Array<unknown>) {
    super();

    const metadata: ComponentMetadata | undefined =
      RecordAttachmentsComponents.find(
        (component: ComponentMetadata): boolean => {
          return component.id === ComponentID.GetAttachmentsFromRecord;
        },
      );

    if (!metadata) {
      throw new BadDataException(
        "Get Attachments From Record component not found.",
      );
    }

    this.setMetadata(metadata);

    for (const service of services) {
      if (!(service instanceof DatabaseService)) {
        continue;
      }

      const model: BaseModel = service.getModel();

      if (
        model.tableName &&
        isAttachmentRecordType(model) &&
        !this.servicesByTable.has(model.tableName)
      ) {
        this.servicesByTable.set(
          model.tableName,
          service as DatabaseService<BaseModel>,
        );
      }
    }
  }

  // The service of the record type a Record Type setting names, or null.
  public getRecordService(
    recordType: unknown,
  ): DatabaseService<BaseModel> | null {
    if (typeof recordType !== "string") {
      return null;
    }

    return this.servicesByTable.get(recordType.trim()) || null;
  }

  // The record types the step reads, by table name.
  public getRecordTypes(): Array<string> {
    return Array.from(this.servicesByTable.keys()).sort();
  }

  @CaptureSpan()
  public override async run(
    args: JSONObject,
    options: RunOptions,
  ): Promise<RunReturnType> {
    const successPort: Port | undefined = this.getPort(
      GET_ATTACHMENTS_FROM_RECORD_PORT_IDS.success,
    );
    const errorPort: Port | undefined = this.getPort(
      GET_ATTACHMENTS_FROM_RECORD_PORT_IDS.error,
    );

    if (!successPort || !errorPort) {
      throw options.onError(new BadDataException("Port not found."));
    }

    const recordType: unknown =
      args[GET_ATTACHMENTS_FROM_RECORD_ARGUMENT_IDS.recordType];

    const service: DatabaseService<BaseModel> | null =
      this.getRecordService(recordType);

    if (!service) {
      throw options.onError(
        new BadDataException(
          recordType === undefined || recordType === null || recordType === ""
            ? "Record Type is empty. Pick the kind of record that holds the files."
            : `Record Type "${String(recordType)}" is not a kind of record that holds files. Pick one from the list.`,
        ),
      );
    }

    const model: BaseModel = service.getModel();
    const recordIdValue: unknown =
      args[GET_ATTACHMENTS_FROM_RECORD_ARGUMENT_IDS.recordId];

    if (
      recordIdValue === undefined ||
      recordIdValue === null ||
      (typeof recordIdValue === "string" && recordIdValue.trim() === "")
    ) {
      throw options.onError(
        new BadDataException(
          `Record ID is empty. Pick the ID of the ${model.singularName || "record"} with { }, or paste one.`,
        ),
      );
    }

    const recordId: ObjectID | null = this.readRecordId(recordIdValue);

    if (!recordId) {
      return this.takeError({
        options: options,
        errorPort: errorPort,
        reason: this.describeNotAnId(recordIdValue, model),
      });
    }

    try {
      const result: RecordAttachmentsResult =
        await RecordAttachments.readRecordAttachments({
          service: service,
          recordId: recordId,
          // What the workflow runs as, in its own project. See getStepProps.
          props: await this.getStepProps(options),
        });

      this.logResult({ options, model, result });

      return {
        returnValues: {
          [GET_ATTACHMENTS_FROM_RECORD_RETURN_VALUE_IDS.files]:
            result.files as unknown as JSONArray,
          [GET_ATTACHMENTS_FROM_RECORD_RETURN_VALUE_IDS.count]:
            result.files.length,
          [GET_ATTACHMENTS_FROM_RECORD_RETURN_VALUE_IDS.leftOut]:
            result.leftOut as unknown as JSONArray,
        },
        executePort: successPort,
      };
    } catch (err: unknown) {
      // Said in the run log, and again under the step's Error output.
      const reason: string = logComponentError({
        error: err,
        model: model,
        log: options.log,
        stepTitle: this.getMetadata().title,
        runAs: options.runAs,
      });

      return {
        returnValues: {
          [GET_ATTACHMENTS_FROM_RECORD_RETURN_VALUE_IDS.error]: reason,
        },
        executePort: errorPort,
        executePortReason: reason,
      };
    }
  }

  private getPort(id: string): Port | undefined {
    return this.getMetadata().outPorts.find((port: Port): boolean => {
      return port.id === id;
    });
  }

  // A record's ID as a setting holds it: a uuid, in any case, with space around it.
  private readRecordId(value: unknown): ObjectID | null {
    const id: string =
      typeof value === "string" || value instanceof ObjectID
        ? value.toString().trim().toLowerCase()
        : "";

    return ObjectID.isValidUUID(id) ? new ObjectID(id) : null;
  }

  /*
   * Why a Record ID is not one: a {{...}} reference nothing filled in (the
   * step it names did not run, or gave back no such value), or a value that
   * is not an ID. The value itself is not repeated when it is long.
   */
  private describeNotAnId(value: unknown, model: BaseModel): string {
    const text: string = typeof value === "string" ? value.trim() : "";
    const name: string = model.singularName || "record";

    if (text && parseTemplateExpressions(text).length > 0) {
      return `Record ID is still ${text}: nothing filled it in when this step ran. Check that the step it names ran before this one, and gives back an ID of the ${name}.`;
    }

    const shown: string =
      text.length > 0 && text.length <= 80 ? ` "${text}"` : "";

    return `Record ID${shown} is not an ID. Pick the ID of the ${name} with { }, or paste one.`;
  }

  private takeError(data: {
    options: RunOptions;
    errorPort: Port;
    reason: string;
  }): RunReturnType {
    data.options.log(data.reason);

    return {
      returnValues: {
        [GET_ATTACHMENTS_FROM_RECORD_RETURN_VALUE_IDS.error]: data.reason,
      },
      executePort: data.errorPort,
      executePortReason: data.reason,
    };
  }

  // What the run's log says: how many files, and why any were left out.
  private logResult(data: {
    options: RunOptions;
    model: BaseModel;
    result: RecordAttachmentsResult;
  }): void {
    const name: string = data.model.singularName || "record";
    const count: number = data.result.files.length;

    data.options.log(
      count === 1
        ? `Found 1 file the ${name} holds.`
        : `Found ${count} files the ${name} holds.`,
    );

    for (const leftOut of data.result.leftOut as Array<AttachmentLeftOut>) {
      data.options.log(
        `Left out ${leftOut.name ? `"${leftOut.name}"` : `a file of ${leftOut.fields[0] || "the record"}`}: ${leftOut.message}`,
      );
    }
  }
}
