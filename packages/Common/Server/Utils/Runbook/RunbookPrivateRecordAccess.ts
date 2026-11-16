import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import RunbookExecution from "../../../Models/DatabaseModels/RunbookExecution";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import ObjectID from "../../../Types/ObjectID";
import AlertService from "../../Services/AlertService";
import DatabaseService from "../../Services/DatabaseService";
import IncidentService from "../../Services/IncidentService";
import RunbookExecutionService from "../../Services/RunbookExecutionService";
import DatabaseRequestType from "../../Types/BaseDatabase/DatabaseRequestType";
import PrivateRecordWriteCheck from "../Permission/PrivateRecordWriteCheck";
import CaptureSpan from "../Telemetry/CaptureSpan";

// The record a run is linked to: its service, its id and how it is named.
interface LinkedRecord {
  service: DatabaseService<DatabaseBaseModel>;
  id: ObjectID;
  noun: string;
}

/*
 * A RUNBOOK RUN LINKED TO A PRIVATE INCIDENT OR ALERT FOLLOWS ITS OWNERS
 * (#8913).
 *
 * A run is linked to the incident or alert it is for: OneUptime AI's
 * context for it reads the record, its steps may print what they found
 * about it, and the record's page lists it. On a private incident or alert
 * it is as much a part of the record as a note is
 * (PrivateRecordParts.ALSO_PART_OF):
 *
 *   - started only with the permissions of the teams that own the record,
 *     of the people named as its owners, and of Project Owners and Admins -
 *     the permission to start runbook executions (RunbookExecution's
 *     create list), team by team (PrivateRecordPermission). Another team's
 *     permission reaches none of it;
 *   - moved along (a step completed, approved or skipped, the run
 *     cancelled) the same way, with the permission to advance runs
 *     (RunbookExecution's create or update list);
 *   - read only by those who see the record (RunbookExecutionService's read
 *     hook): a run of a record someone does not see is answered to them as
 *     missing.
 *
 * The Dashboard's Run runbook (App/FeatureSet/Runbook/API/Runbook), the
 * steps of a run there, OneUptime AI's run_runbook and the API's create of a
 * run (DatabaseService.checkNamedPrivateRecords) all ask the same.
 */
export default class RunbookPrivateRecordAccess {
  // What "You do not have permission to ..." says of moving a run along.
  public static readonly ADVANCE_ACTION: string = "change this runbook run";

  // What it says of starting one for the record.
  public static getStartAction(noun: string): string {
    return `run a runbook for this ${noun}`;
  }

  /*
   * Throws NotAuthorizedException, saying why, unless the caller may start
   * a run linked to `incidentId` and `alertId` (either may be missing): a
   * record that is not private, or one their permission to start runs
   * reaches through its owners. The caller has read each record already -
   * one they do not see is answered as missing before this.
   */
  @CaptureSpan()
  public static async assertMayStartFor(data: {
    props: DatabaseCommonInteractionProps;
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
  }): Promise<void> {
    if (data.props.isRoot || data.props.isMasterAdmin) {
      return;
    }

    for (const record of RunbookPrivateRecordAccess.getLinkedRecords(data)) {
      await PrivateRecordWriteCheck.assertReaches({
        modelType: RunbookExecution,
        type: DatabaseRequestType.Create,
        recordService: record.service,
        recordId: record.id,
        props: data.props,
        action: RunbookPrivateRecordAccess.getStartAction(record.noun),
      });
    }
  }

  /*
   * Throws unless the caller may move `execution` along: a run linked to no
   * private record, or to one their permission to advance runs (create or
   * update) reaches through its owners. A run they may not even read - its
   * record is private and they do not see it - is answered as missing
   * (NotFoundException), as every route answers a record it does not show;
   * one they read is refused saying why. `execution` is the run as read by
   * OneUptime, with its incidentId and alertId.
   */
  @CaptureSpan()
  public static async assertMayAdvance(data: {
    props: DatabaseCommonInteractionProps;
    execution: RunbookExecution;
  }): Promise<void> {
    if (data.props.isRoot || data.props.isMasterAdmin) {
      return;
    }

    for (const record of RunbookPrivateRecordAccess.getLinkedRecords({
      incidentId: data.execution.incidentId,
      alertId: data.execution.alertId,
    })) {
      const reaches: boolean =
        (await PrivateRecordWriteCheck.reaches({
          modelType: RunbookExecution,
          type: DatabaseRequestType.Update,
          recordService: record.service,
          recordId: record.id,
          props: data.props,
        })) ||
        (await PrivateRecordWriteCheck.reaches({
          modelType: RunbookExecution,
          type: DatabaseRequestType.Create,
          recordService: record.service,
          recordId: record.id,
          props: data.props,
        }));

      if (reaches) {
        continue;
      }

      if (!(await RunbookPrivateRecordAccess.isRunReadable(data))) {
        throw new NotFoundException("Runbook execution not found");
      }

      throw new NotAuthorizedException(
        PrivateRecordWriteCheck.getRefusal({
          action: RunbookPrivateRecordAccess.ADVANCE_ACTION,
          recordModelType: record.service.modelType as {
            new (): DatabaseBaseModel;
          },
        }),
      );
    }
  }

  // Whether the caller reads the run: its record's privacy decides.
  private static async isRunReadable(data: {
    props: DatabaseCommonInteractionProps;
    execution: RunbookExecution;
  }): Promise<boolean> {
    if (!data.execution.id) {
      return false;
    }

    try {
      const readable: RunbookExecution | null =
        await RunbookExecutionService.findOneById({
          id: data.execution.id,
          select: { _id: true },
          props: { ...data.props, isMultiTenantRequest: false },
        });

      return Boolean(readable);
    } catch (error) {
      if (
        error instanceof NotAuthorizedException ||
        error instanceof NotFoundException
      ) {
        return false;
      }

      throw error;
    }
  }

  private static getLinkedRecords(data: {
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
  }): Array<LinkedRecord> {
    const records: Array<LinkedRecord> = [];

    if (data.incidentId) {
      records.push({
        service: IncidentService as unknown as DatabaseService<DatabaseBaseModel>,
        id: data.incidentId,
        noun: "incident",
      });
    }

    if (data.alertId) {
      records.push({
        service: AlertService as unknown as DatabaseService<DatabaseBaseModel>,
        id: data.alertId,
        noun: "alert",
      });
    }

    return records;
  }
}
