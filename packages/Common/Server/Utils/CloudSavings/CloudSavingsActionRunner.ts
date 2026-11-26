import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import CloudSavingsAction from "../../../Models/DatabaseModels/CloudSavingsAction";
import LessThanOrEqual from "../../../Types/BaseDatabase/LessThanOrEqual";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  CloudSavingsActionKind,
  CloudSavingsActionOrigin,
  CloudSavingsActionStatus,
  CloudSavingsActionsAccess,
  CloudSavingsMeasurement,
  CloudSavingsTarget,
  getCloudSavingsActionsAccess,
  isCloudSavingsActionAllowed,
} from "../../../Types/Cloud/CloudSavingsAction";
import { SAVINGS_ACTIONS_FIELD_KEY } from "../../../Types/CloudConnection/CloudConnectionCatalog";
import ColumnLength from "../../../Types/Database/ColumnLength";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import CloudConnectionService from "../../Services/CloudConnectionService";
import CloudSavingsActionService, {
  CloudSavingsActionTransitionSet,
} from "../../Services/CloudSavingsActionService";
import {
  CloudConnectionSettings,
  CloudConnectorTransport,
} from "../CloudConnection/CloudConnectorTypes";
import logger from "../Logger";
import {
  applyAwsSavingsAction,
  undoAwsSavingsAction,
} from "./Cloud/AwsSavingsActions";
import {
  applyAzureSavingsAction,
  undoAzureSavingsAction,
} from "./Cloud/AzureSavingsActions";
import {
  applyGcpSavingsAction,
  undoGcpSavingsAction,
} from "./Cloud/GcpSavingsActions";
import {
  CLOUD_SAVINGS_MAX_WAITS,
  CloudSavingsProgress,
  CloudSavingsRun,
  CloudSavingsStepContext,
  CloudSavingsStepOutcome,
  CloudSavingsUndoRun,
} from "./CloudSavingsCloudTypes";
import {
  CloudSavingsFeedEvent,
  writeCloudSavingsFeed,
} from "./CloudSavingsFeed";

/*
 * TAKES A CHANGE FOR A SAVING THROUGH ITS STEPS (#11010).
 *
 * A change that is Applying (approved, or made without asking, or an
 * off-hours stop) or Undoing (being taken back, or an off-hours start) is
 * advanced here: its cloud's next steps are taken through the account's
 * connection, as far as they go without waiting (Cloud/*SavingsActions),
 * and where they stopped is kept on the row. One that waits - a snapshot
 * still being taken, an instance still stopping - is taken on a minute
 * later by the worker (runDue), which holds a lease on it first so two
 * workers never step it at once. A change waits at most an hour.
 *
 * The connection is read again on every step: a change approved before
 * someone turned Savings actions off fails, saying so, rather than being
 * made through access the account no longer gives.
 *
 * Done, it is Applied (AppliedWithoutAsking when an AI rule made it on its
 * own), read against the bill from then on (CloudSavingsMeasurement); taken
 * back, Undone - or Ended, for a schedule that started what it stopped,
 * with the hours it did not run. Each is a line on the resource's and the
 * account's timelines.
 */

// How long a step's lease is held: a worker that died lets go after it.
export const CLOUD_SAVINGS_STEP_LEASE_MS: number = 5 * 60 * 1000;

// When a step that waits is taken again.
export const CLOUD_SAVINGS_STEP_RETRY_MS: number = 60 * 1000;

// The changes the worker steps in one run, at most.
export const CLOUD_SAVINGS_STEPS_PER_RUN: number = 25;

export const CLOUD_SAVINGS_ACTION_RUN_SELECT: {
  [key: string]: true;
} = {
  _id: true,
  projectId: true,
  cloudAccountId: true,
  cloudConnectionId: true,
  cloudResourceId: true,
  cloudOffHoursScheduleId: true,
  provider: true,
  kind: true,
  status: true,
  origin: true,
  resourceId: true,
  resourceName: true,
  toConfiguration: true,
  finalSnapshot: true,
  undo: true,
  monthlySavings: true,
  currency: true,
  target: true,
  progress: true,
  undoProgress: true,
  summary: true,
  approvedByUserId: true,
  undoneByUserId: true,
  autoRemediationRuleName: true,
  appliedAt: true,
};

type CloudStep = (
  context: CloudSavingsStepContext,
  run: CloudSavingsRun,
) => Promise<CloudSavingsStepOutcome>;

type CloudUndoStep = (
  context: CloudSavingsStepContext,
  run: CloudSavingsUndoRun,
) => Promise<CloudSavingsStepOutcome>;

const APPLY: Readonly<Record<CloudProvider, CloudStep>> = {
  [CloudProvider.AWS]: applyAwsSavingsAction,
  [CloudProvider.Azure]: applyAzureSavingsAction,
  [CloudProvider.GCP]: applyGcpSavingsAction,
};

const UNDO: Readonly<Record<CloudProvider, CloudUndoStep>> = {
  [CloudProvider.AWS]: undoAwsSavingsAction,
  [CloudProvider.Azure]: undoAzureSavingsAction,
  [CloudProvider.GCP]: undoGcpSavingsAction,
};

// Text as a column holds it.
export function clampText(value: string, length: number): string {
  const text: string = (value || "").trim();
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface CloudSavingsRunnerOptions {
  now?: Date | undefined;
  // A test's fake cloud.
  transport?: CloudConnectorTransport | undefined;
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
}

export default class CloudSavingsActionRunner {
  /*
   * The changes due a step - Applying or Undoing, their next step due - each
   * leased, then stepped. Returns how many were stepped.
   */
  public static async runDue(
    options: CloudSavingsRunnerOptions = {},
  ): Promise<number> {
    const now: Date = options.now || OneUptimeDate.getCurrentDate();
    const due: Array<CloudSavingsAction> =
      await CloudSavingsActionService.findBy({
        query: {
          status: new Includes([
            CloudSavingsActionStatus.Applying,
            CloudSavingsActionStatus.Undoing,
          ]),
          nextStepAt: new LessThanOrEqual(now),
        },
        select: { _id: true, status: true },
        sort: { nextStepAt: SortOrder.Ascending },
        skip: 0,
        limit: CLOUD_SAVINGS_STEPS_PER_RUN,
        props: { isRoot: true },
      });
    let stepped: number = 0;

    for (const row of due) {
      if (!row.id || !row.status) {
        continue;
      }

      const leased: number = await CloudSavingsActionService.attemptTransition({
        actionId: row.id,
        fromStatuses: [row.status],
        set: {
          status: row.status,
          nextStepAt: OneUptimeDate.addRemoveSeconds(
            now,
            CLOUD_SAVINGS_STEP_LEASE_MS / 1000,
          ),
        },
        whileNextStepAtOrBefore: now,
      });

      if (leased === 0) {
        continue;
      }

      try {
        await CloudSavingsActionRunner.advance(row.id, options);
        stepped++;
      } catch (error) {
        logger.error(
          `Cloud savings: action ${row.id.toString()} could not be stepped: ${errorMessageOf(error)}`,
        );
      }
    }

    return stepped;
  }

  /*
   * Takes an Applying or Undoing change's next steps. The caller holds its
   * lease (an approval that just claimed it, or runDue).
   */
  public static async advance(
    actionId: ObjectID,
    options: CloudSavingsRunnerOptions = {},
  ): Promise<CloudSavingsAction | null> {
    const now: Date = options.now || OneUptimeDate.getCurrentDate();
    const action: CloudSavingsAction | null =
      await CloudSavingsActionService.findOneById({
        id: actionId,
        select: CLOUD_SAVINGS_ACTION_RUN_SELECT,
        props: { isRoot: true },
      });

    if (
      !action?.id ||
      (action.status !== CloudSavingsActionStatus.Applying &&
        action.status !== CloudSavingsActionStatus.Undoing)
    ) {
      return action;
    }

    const isUndo: boolean = action.status === CloudSavingsActionStatus.Undoing;
    const progress: CloudSavingsProgress = ((isUndo
      ? action.undoProgress
      : action.progress) || {}) as CloudSavingsProgress;
    let outcome: CloudSavingsStepOutcome;

    try {
      const context: CloudSavingsStepContext =
        await CloudSavingsActionRunner.getContext(action, options);
      const run: CloudSavingsRun = {
        actionId: action.id.toString(),
        kind: action.kind as CloudSavingsActionKind,
        target: action.target as unknown as CloudSavingsTarget,
        to: action.toConfiguration || undefined,
        finalSnapshot: Boolean(action.finalSnapshot),
        progress,
      };
      const provider: CloudProvider = action.provider as CloudProvider;

      if (!APPLY[provider]) {
        throw new BadDataException(
          `OneUptime does not act on savings in ${String(action.provider)}.`,
        );
      }

      outcome = isUndo
        ? await UNDO[provider](context, {
            ...run,
            applied: (action.progress || {}) as CloudSavingsProgress,
          })
        : await APPLY[provider](context, run);
    } catch (error) {
      return await CloudSavingsActionRunner.recordFailure({
        action,
        isUndo,
        message: errorMessageOf(error),
        now,
      });
    }

    if (
      outcome.state === "waiting" &&
      (outcome.progress.waits || 0) > CLOUD_SAVINGS_MAX_WAITS
    ) {
      return await CloudSavingsActionRunner.recordFailure({
        action,
        isUndo,
        message: `${outcome.summary} It did not finish within an hour, so OneUptime stopped waiting; check it in your cloud's console.`,
        now,
      });
    }

    if (outcome.state === "waiting") {
      await CloudSavingsActionService.attemptTransition({
        actionId: action.id,
        fromStatuses: [action.status],
        set: {
          status: action.status,
          ...(isUndo
            ? { undoProgress: outcome.progress as unknown as JSONObject }
            : { progress: outcome.progress as unknown as JSONObject }),
          summary: clampText(outcome.summary, ColumnLength.LongText),
          nextStepAt: OneUptimeDate.addRemoveSeconds(
            now,
            CLOUD_SAVINGS_STEP_RETRY_MS / 1000,
          ),
        },
      });

      return action;
    }

    return isUndo
      ? await CloudSavingsActionRunner.recordUndone({ action, outcome, now })
      : await CloudSavingsActionRunner.recordApplied({ action, outcome, now });
  }

  /*
   * The connection the change is made through, read again now: still
   * there, still on, and still letting OneUptime make this kind of change.
   */
  public static async getContext(
    action: CloudSavingsAction,
    options: CloudSavingsRunnerOptions,
  ): Promise<CloudSavingsStepContext> {
    const connection: CloudConnection | null = action.cloudConnectionId
      ? await CloudConnectionService.findOneById({
          id: action.cloudConnectionId,
          select: {
            _id: true,
            projectId: true,
            provider: true,
            config: true,
            secrets: true,
            isEnabled: true,
          },
          props: { isRoot: true },
        })
      : null;

    if (!connection?.id || connection.isEnabled === false) {
      throw new BadDataException(
        "The account's cloud connection is gone or turned off, so nothing was changed.",
      );
    }

    const access: CloudSavingsActionsAccess = getCloudSavingsActionsAccess(
      connection.config
        ? connection.config[SAVINGS_ACTIONS_FIELD_KEY]
        : undefined,
    );

    if (
      !isCloudSavingsActionAllowed(
        access,
        action.kind as CloudSavingsActionKind,
      )
    ) {
      throw new BadDataException(
        access === CloudSavingsActionsAccess.Off
          ? "Savings actions are off on the account's cloud connection, so nothing was changed. Turn them on and run its setup command again."
          : 'The account\'s cloud connection does not let OneUptime resize. Set its Savings actions to "Stop, start, clean up and resize" and run its setup command again.',
      );
    }

    const settings: CloudConnectionSettings =
      await CloudConnectionService.getConnectorSettings(connection);

    return {
      settings,
      connectionId: connection.id,
      transport: options.transport,
      sleep: options.sleep,
      now: options.now
        ? (): Date => {
            return options.now!;
          }
        : undefined,
    };
  }

  private static async recordApplied(data: {
    action: CloudSavingsAction;
    outcome: CloudSavingsStepOutcome;
    now: Date;
  }): Promise<CloudSavingsAction> {
    const action: CloudSavingsAction = data.action;
    const isSchedule: boolean =
      action.origin === CloudSavingsActionOrigin.Schedule;
    const madeWithoutAsking: boolean =
      action.origin === CloudSavingsActionOrigin.Rule &&
      !action.approvedByUserId;

    /*
     * A schedule's stop of something already stopped is not the schedule's:
     * it is left as it was, and never started by the schedule.
     */
    if (isSchedule && !data.outcome.changed) {
      await CloudSavingsActionService.attemptTransition({
        actionId: action.id!,
        fromStatuses: [CloudSavingsActionStatus.Applying],
        set: {
          status: CloudSavingsActionStatus.Expired,
          expiredAt: data.now,
          nextStepAt: null,
          summary: clampText(data.outcome.summary, ColumnLength.LongText),
        },
      });

      return action;
    }

    const set: CloudSavingsActionTransitionSet = {
      status: madeWithoutAsking
        ? CloudSavingsActionStatus.AppliedWithoutAsking
        : CloudSavingsActionStatus.Applied,
      appliedAt: data.now,
      nextStepAt: null,
      failureMessage: null,
      progress: data.outcome.progress as unknown as JSONObject,
      summary: clampText(data.outcome.summary, ColumnLength.LongText),
      // A schedule's saving is its hours; any other is read against the bill.
      measurement: isSchedule
        ? null
        : data.outcome.changed
          ? CloudSavingsMeasurement.Measuring
          : CloudSavingsMeasurement.CannotMeasure,
    };

    await CloudSavingsActionService.attemptTransition({
      actionId: action.id!,
      fromStatuses: [CloudSavingsActionStatus.Applying],
      set,
    });

    await writeCloudSavingsFeed({
      event: CloudSavingsFeedEvent.Applied,
      action: { ...action, ...set } as CloudSavingsAction,
      detail: data.outcome.summary,
      userId: action.approvedByUserId,
    });

    return action;
  }

  private static async recordUndone(data: {
    action: CloudSavingsAction;
    outcome: CloudSavingsStepOutcome;
    now: Date;
  }): Promise<CloudSavingsAction> {
    const action: CloudSavingsAction = data.action;
    const scheduleStart: boolean =
      action.origin === CloudSavingsActionOrigin.Schedule &&
      !action.undoneByUserId;
    const hours: number = action.appliedAt
      ? Math.max(
          0,
          (data.now.getTime() - new Date(action.appliedAt).getTime()) /
            (60 * 60 * 1000),
        )
      : 0;

    if (scheduleStart) {
      await CloudSavingsActionService.attemptTransition({
        actionId: action.id!,
        fromStatuses: [CloudSavingsActionStatus.Undoing],
        set: {
          status: CloudSavingsActionStatus.Ended,
          endedAt: data.now,
          savedHours: Math.round(hours * 100) / 100,
          nextStepAt: null,
          undoProgress: data.outcome.progress as unknown as JSONObject,
          summary: clampText(data.outcome.summary, ColumnLength.LongText),
        },
      });

      return action;
    }

    const set: CloudSavingsActionTransitionSet = {
      status: CloudSavingsActionStatus.Undone,
      undoneAt: data.now,
      nextStepAt: null,
      failureMessage: null,
      undoProgress: data.outcome.progress as unknown as JSONObject,
      summary: clampText(data.outcome.summary, ColumnLength.LongText),
    };

    await CloudSavingsActionService.attemptTransition({
      actionId: action.id!,
      fromStatuses: [CloudSavingsActionStatus.Undoing],
      set,
    });

    await writeCloudSavingsFeed({
      event: CloudSavingsFeedEvent.Undone,
      action: { ...action, ...set } as CloudSavingsAction,
      detail: data.outcome.summary,
      userId: action.undoneByUserId,
    });

    return action;
  }

  /*
   * A change that failed is Failed, with why. An undo that failed leaves
   * the change as it was - still in effect - and says why it was not
   * taken back.
   */
  private static async recordFailure(data: {
    action: CloudSavingsAction;
    isUndo: boolean;
    message: string;
    now: Date;
  }): Promise<CloudSavingsAction> {
    const action: CloudSavingsAction = data.action;
    const undoFrom: unknown = ((action.undoProgress || {}) as JSONObject)[
      "from"
    ];
    const message: string = clampText(
      data.isUndo ? `Undo failed: ${data.message}` : data.message,
      ColumnLength.LongText,
    );

    if (data.isUndo) {
      await CloudSavingsActionService.attemptTransition({
        actionId: action.id!,
        fromStatuses: [CloudSavingsActionStatus.Undoing],
        set: {
          status:
            undoFrom === CloudSavingsActionStatus.AppliedWithoutAsking
              ? CloudSavingsActionStatus.AppliedWithoutAsking
              : CloudSavingsActionStatus.Applied,
          undoneByUserId: null,
          undoneAt: null,
          nextStepAt: null,
          failureMessage: message,
        },
      });
    } else {
      await CloudSavingsActionService.attemptTransition({
        actionId: action.id!,
        fromStatuses: [CloudSavingsActionStatus.Applying],
        set: {
          status: CloudSavingsActionStatus.Failed,
          failedAt: data.now,
          nextStepAt: null,
          failureMessage: message,
        },
      });
    }

    await writeCloudSavingsFeed({
      event: CloudSavingsFeedEvent.Failed,
      action,
      detail: message,
    });

    return action;
  }
}
