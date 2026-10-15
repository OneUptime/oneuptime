import RunbookService from "../../Services/RunbookService";
import ModelPermission from "../../Types/Database/Permissions/Index";
import Query from "../../Types/Database/Query";
import QueryDeepPartialEntity from "../../../Types/Database/PartialEntity";
import CallerPermission from "../Permission/CallerPermission";
import RunbookRunAccess from "./RunbookRunAccess";
import Runbook from "../../../Models/DatabaseModels/Runbook";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import ObjectID from "../../../Types/ObjectID";
import { RUNBOOK_RUN_PERMISSIONS } from "../../../Types/Runbook/RunbookRunPermissions";

/*
 * WHO MAY SET UP A RUNBOOK'S TRIGGERS - its schedule and its webhook - AND
 * SEE ITS WEBHOOK URL.
 *
 * A trigger starts runs with nobody there: the schedule at its times, the
 * webhook whenever its URL is called. So setting one up is starting runs,
 * and it takes permission to run the runbook (RunbookRunAccess: the run
 * roles' labels and owned scope, or Create Runbook Execution) as well as
 * permission to change it (the trigger columns' update list, labels
 * included). Edit Runbook alone - which may change the runbook's steps but
 * not run them - does not turn a schedule on.
 *
 * Turning a trigger off is the exception: it starts nothing, so whoever may
 * change the runbook may switch its schedule or webhook off, as they may
 * turn the whole runbook off.
 *
 * The webhook URL holds the key that starts runs, so seeing it is held to
 * the same rule as setting it up (as a workflow's webhook key is held to
 * who may reset it). The runbook service's secret routes ask
 * assertMayManageWebhook; RunbookService asks assertMayRunTriggersOf for
 * every write to the trigger columns through the API.
 */

// The columns that set a runbook's triggers.
export const RUNBOOK_TRIGGER_COLUMNS: ReadonlyArray<string> = [
  "isScheduleEnabled",
  "scheduleCron",
  "scheduleTimezone",
  "scheduleOverlapPolicy",
  "scheduleMissedRunPolicy",
  "isWebhookEnabled",
];

// The switches among them: a write that only turns these off starts nothing.
export const RUNBOOK_TRIGGER_SWITCH_COLUMNS: ReadonlyArray<string> = [
  "isScheduleEnabled",
  "isWebhookEnabled",
];

// What a refused set-up says.
export const RUNBOOK_TRIGGER_REFUSED_MESSAGE: string =
  "You do not have permission to set up this runbook's schedule or webhook. They start runs of the runbook, so setting them up takes permission to run it as well as to edit it.";

// What a refused read or reset of the webhook URL says.
export const RUNBOOK_WEBHOOK_URL_REFUSED_MESSAGE: string =
  "You do not have permission to see or reset this runbook's webhook URL. It starts runs of the runbook, so it is shown only to people who may edit the runbook and run it.";

export default class RunbookTriggerAccess {
  // The trigger columns `data` writes.
  public static getTriggerColumnsWritten(data: unknown): Array<string> {
    if (!data || typeof data !== "object") {
      return [];
    }

    return RUNBOOK_TRIGGER_COLUMNS.filter((column: string) => {
      return (data as Record<string, unknown>)[column] !== undefined;
    });
  }

  /*
   * Whether a write to the triggers only turns them off: it names nothing
   * but the switches, each set to false.
   */
  public static onlyTurnsTriggersOff(data: unknown): boolean {
    const written: Array<string> =
      RunbookTriggerAccess.getTriggerColumnsWritten(data);

    return (
      written.length > 0 &&
      written.every((column: string) => {
        return (
          RUNBOOK_TRIGGER_SWITCH_COLUMNS.includes(column) &&
          (data as Record<string, unknown>)[column] === false
        );
      })
    );
  }

  /*
   * Whether a create turns a trigger on: a runbook created with its schedule
   * or webhook switched on.
   */
  public static turnsATriggerOn(data: unknown): boolean {
    if (!data || typeof data !== "object") {
      return false;
    }

    return RUNBOOK_TRIGGER_SWITCH_COLUMNS.some((column: string) => {
      return (data as Record<string, unknown>)[column] === true;
    });
  }

  /*
   * Whether the caller may run triggers in the project at all, before a
   * runbook exists to weigh labels against (a create).
   */
  public static assertMayRunTriggersIn(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID | undefined;
  }): void {
    if (data.props.isRoot || data.props.isMasterAdmin) {
      return;
    }

    if (
      !data.projectId ||
      !CallerPermission.holdsAnyOf(data.props, RUNBOOK_RUN_PERMISSIONS, {
        projectId: data.projectId,
      })
    ) {
      throw new NotAuthorizedException(RUNBOOK_TRIGGER_REFUSED_MESSAGE);
    }
  }

  // Whether the caller may start runs of this runbook, as its triggers would.
  public static async assertMayRunTriggersOf(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    runbookId: ObjectID;
  }): Promise<void> {
    if (data.props.isRoot || data.props.isMasterAdmin) {
      return;
    }

    RunbookTriggerAccess.assertMayRunTriggersIn(data);

    try {
      await RunbookRunAccess.assertMayStart({
        databaseProps: data.props,
        projectId: data.projectId,
        runbookId: data.runbookId,
      });
    } catch (error) {
      if (error instanceof NotAuthorizedException) {
        throw new NotAuthorizedException(RUNBOOK_TRIGGER_REFUSED_MESSAGE);
      }

      throw error;
    }
  }

  /*
   * Whether the caller may see and reset the runbook's webhook URL: change
   * its webhook switch - the column's own update list, with the runbook's
   * labels and team blocks as an update of it weighs them - and start runs
   * of it. A runbook of another project, one that does not exist and one
   * the caller may not reach are answered alike.
   */
  public static async assertMayManageWebhook(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    runbookId: ObjectID;
  }): Promise<void> {
    const runbook: Runbook | null = await RunbookService.findOneById({
      id: data.runbookId,
      select: { _id: true, projectId: true, labels: { _id: true } },
      props: { isRoot: true },
    });

    if (
      !runbook ||
      runbook.projectId?.toString() !== data.projectId.toString()
    ) {
      throw new NotFoundException("Runbook not found.");
    }

    if (data.props.isRoot || data.props.isMasterAdmin) {
      return;
    }

    const switchOn: QueryDeepPartialEntity<Runbook> = {
      isWebhookEnabled: true,
    } as unknown as QueryDeepPartialEntity<Runbook>;

    try {
      await ModelPermission.checkUpdatePermissionByModel<Runbook>({
        modelType: Runbook,
        fetchModelWithAccessControlIds: async (): Promise<Runbook> => {
          return runbook;
        },
        props: data.props,
        updateData: switchOn,
      });

      const permittedQuery: Query<Runbook> =
        await ModelPermission.checkUpdateQueryPermissions<Runbook>(
          Runbook,
          {
            _id: data.runbookId.toString(),
            projectId: data.projectId,
          } as Query<Runbook>,
          switchOn,
          data.props,
        );

      const permitted: Runbook | null = await RunbookService.findOneBy({
        query: permittedQuery,
        select: { _id: true },
        props: { isRoot: true },
      });

      if (!permitted) {
        throw new NotAuthorizedException(RUNBOOK_WEBHOOK_URL_REFUSED_MESSAGE);
      }

      await RunbookTriggerAccess.assertMayRunTriggersOf(data);
    } catch (error) {
      if (
        error instanceof NotAuthorizedException ||
        error instanceof BadDataException ||
        error instanceof NotFoundException
      ) {
        throw new NotAuthorizedException(RUNBOOK_WEBHOOK_URL_REFUSED_MESSAGE);
      }

      throw error;
    }
  }
}
