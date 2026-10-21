import ProjectReferencesService from "./ProjectReferencesService";
import RunbookLabelRuleEngineService from "./RunbookLabelRuleEngineService";
import RunbookOwnerRuleEngineService from "./RunbookOwnerRuleEngineService";
import Model from "../../Models/DatabaseModels/Runbook";
import ObjectID from "../../Types/ObjectID";
import RunbookStepType from "../../Types/Runbook/RunbookStepType";
import { parseSingleRunbookVariableReference } from "../../Types/Runbook/RunbookVariableReference";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import { normalizeReferenceId } from "../Utils/Database/ProjectScopedReferenceRefusal";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";
import BadDataException from "../../Types/Exception/BadDataException";
import PartialEntity from "../../Types/Database/PartialEntity";
import RunbookScheduler from "../Utils/Runbook/RunbookScheduler";
import RunbookTriggerAccess from "../Utils/Runbook/RunbookTriggerAccess";
import {
  RUNBOOK_WEBHOOK_SECRET_KEY_BYTES,
  isRunbookWebhookSecretKeyShape,
} from "../../Types/Runbook/RunbookWebhook";
import {
  RunbookScheduleMissedRunPolicy,
  RunbookScheduleOverlapPolicy,
  getRunbookScheduleCronError,
  isValidRunbookScheduleTimezone,
  normalizeRunbookScheduleCron,
} from "../../Types/Runbook/RunbookSchedule";
import crypto from "crypto";

// The steps that ran with a runbook credential: SSH and Kubernetes.
const CREDENTIAL_STEP_TYPES: Array<string> = [
  RunbookStepType.SSH,
  RunbookStepType.Kubernetes,
];

/*
 * The fields of a step that take a secret - an SSH step's key or password
 * and passphrase, a kubectl step's kubeconfig - by step type. Each holds
 * one reference to a secret runbook variable, never the secret itself:
 * everyone who may read the runbook reads its steps.
 */
const SECRET_FIELDS_BY_STEP_TYPE: Record<string, Array<string>> = {
  [RunbookStepType.SSH]: ["signIn", "passphrase"],
  [RunbookStepType.Kubernetes]: ["kubeconfig"],
};

export const STEP_SECRET_IN_STEP_MESSAGE: string =
  "keeps a key, a password or a kubeconfig in the step itself, where everyone who may read this runbook could read it. Keep it in a secret runbook variable and pick that variable in the step.";

/*
 * What a save that names a runbook credential the runbook does not hold
 * already is told. Runbook credentials are gone: an SSH or kubectl step
 * signs in with a secret runbook variable.
 */
export const STEP_NAMES_REMOVED_CREDENTIAL_MESSAGE: string =
  "names a runbook credential, and runbook credentials were removed. An SSH or kubectl step signs in with a secret runbook variable: give the step a script and pick the variable (for SSH, the host, user and the variable holding its key or password; for kubectl, the variable holding its kubeconfig). On the runbook's Steps page, Turn into a script step does this for a step written with a credential.";

/*
 * The columns whose change moves when the schedule next runs: the schedule
 * itself, its switch, and the runbook's own. A change to any of them clears
 * the next run and any run waiting for the one before it (onUpdatePermitted)
 * and works the next run out again from now (onUpdateSuccess): times that
 * passed while a schedule or its runbook was off are skipped, never made up.
 */
export const RUNBOOK_SCHEDULE_TIMING_COLUMNS: ReadonlyArray<string> = [
  "isEnabled",
  "isScheduleEnabled",
  "scheduleCron",
  "scheduleTimezone",
];

// What turning a schedule on without saying when it runs is answered.
export const RUNBOOK_SCHEDULE_NEEDS_CRON_MESSAGE: string =
  "Set when the runbook runs (Schedule Cron) before turning its schedule on.";

/*
 * A STEP NAMES NO RUNBOOK CREDENTIAL.
 *
 * A runbook's SSH and Kubernetes steps named the runbook credential they ran
 * with (an SSH key, a service account token) until runbook variables, and
 * runbook credentials are gone now: the data migrations moved every stored
 * step that named one to the secret variables its key, password or
 * kubeconfig went into (RunbookVariablesMove). So a create that names one is
 * refused, saying what a step signs in with instead, and so is an update
 * that names one some runbook it writes does not name already - an edit
 * that keeps a step the runbook holds as it is (one written through the API
 * and never moved) still saves; that step fails when it runs, saying to
 * turn it into a script step.
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * The runbook credentials `steps` name - the credentialId of each SSH and
   * Kubernetes step - each once, as written. A step that names none names
   * nothing.
   */
  public static getStepCredentialIds(steps: unknown): Array<string> {
    const ids: Array<string> = [];
    const seen: Set<string> = new Set<string>();

    for (const step of Array.isArray(steps) ? steps : []) {
      if (!step || typeof step !== "object") {
        continue;
      }

      const type: unknown = (step as Record<string, unknown>)["type"];
      const config: unknown = (step as Record<string, unknown>)["config"];

      if (
        typeof type !== "string" ||
        !CREDENTIAL_STEP_TYPES.includes(type) ||
        !config ||
        typeof config !== "object"
      ) {
        continue;
      }

      const value: unknown = (config as Record<string, unknown>)[
        "credentialId"
      ];

      const id: string =
        (typeof value === "string" || value instanceof ObjectID
          ? value.toString()
          : ""
        ).trim() || "";

      if (!id || seen.has(normalizeReferenceId(id))) {
        continue;
      }

      seen.add(normalizeReferenceId(id));
      ids.push(id);
    }

    return ids;
  }

  /*
   * Why `steps` may not be saved because one of them holds a secret where it
   * should name a secret variable, or null. A field that takes a secret is
   * empty or one reference ({{global.variables.NAME}} or
   * {{local.variables.NAME}}); whether that variable exists, and is a
   * secret, is asked when the step runs - a runbook may be written before
   * its variables, by the API or Terraform.
   */
  public static getStepSecretFieldRefusal(steps: unknown): string | null {
    for (const step of Array.isArray(steps) ? steps : []) {
      if (!step || typeof step !== "object") {
        continue;
      }

      const type: unknown = (step as Record<string, unknown>)["type"];
      const config: unknown = (step as Record<string, unknown>)["config"];

      if (typeof type !== "string" || !config || typeof config !== "object") {
        continue;
      }

      for (const field of SECRET_FIELDS_BY_STEP_TYPE[type] || []) {
        const value: unknown = (config as Record<string, unknown>)[field];

        if (value === undefined || value === null) {
          continue;
        }

        if (
          typeof value !== "string" ||
          (value.trim() !== "" && !parseSingleRunbookVariableReference(value))
        ) {
          const title: unknown = (step as Record<string, unknown>)["title"];
          const name: string =
            typeof title === "string" && title.trim()
              ? `"${title.trim().slice(0, 80)}"`
              : `of type ${type}`;

          return `The step ${name} ${STEP_SECRET_IN_STEP_MESSAGE}`;
        }
      }
    }

    return null;
  }

  /*
   * Why `steps` may not be saved because a step names a runbook credential
   * that is not one of `heldIds` - the ones every runbook the write writes
   * names already (none, for a create) - or null.
   */
  public static getRemovedCredentialRefusal(data: {
    steps: unknown;
    heldIds: Array<Set<string>>;
  }): string | null {
    for (const step of Array.isArray(data.steps) ? data.steps : []) {
      if (!step || typeof step !== "object") {
        continue;
      }

      const ids: Array<string> = Service.getStepCredentialIds([step]);

      const id: string | undefined = ids[0];

      if (
        id === undefined ||
        (data.heldIds.length > 0 &&
          data.heldIds.every((held: Set<string>): boolean => {
            return held.has(normalizeReferenceId(id));
          }))
      ) {
        continue;
      }

      const title: unknown = (step as Record<string, unknown>)["title"];
      const type: unknown = (step as Record<string, unknown>)["type"];
      const name: string =
        typeof title === "string" && title.trim()
          ? `"${title.trim().slice(0, 80)}"`
          : `of type ${String(type)}`;

      return `The step ${name} ${STEP_NAMES_REMOVED_CREDENTIAL_MESSAGE}`;
    }

    return null;
  }

  // Before the project check (the base hooks run this first). See the top of this file.
  protected override async checkCreateBeforeReferences(
    createBy: CreateBy<Model>,
  ): Promise<void> {
    const secretRefusal: string | null = Service.getStepSecretFieldRefusal(
      createBy.data.steps,
    );

    if (secretRefusal) {
      throw new BadDataException(secretRefusal);
    }

    // A new runbook holds no step yet, so it may name no runbook credential.
    const credentialRefusal: string | null =
      Service.getRemovedCredentialRefusal({
        steps: createBy.data.steps,
        heldIds: [],
      });

    if (credentialRefusal) {
      throw new BadDataException(credentialRefusal);
    }

    /*
     * A runbook created with a trigger on: its settings must be ones the
     * scheduler can read, and turning a trigger on takes permission to run
     * runbooks (RunbookTriggerAccess) - there are no labels to weigh yet.
     */
    const data: Record<string, unknown> = createBy.data as unknown as Record<
      string,
      unknown
    >;

    if (RunbookTriggerAccess.getTriggerColumnsWritten(data).length === 0) {
      return;
    }

    Service.checkTriggerSettings(data);

    if (data["isScheduleEnabled"] === true && !Service.hasCron(data)) {
      throw new BadDataException(RUNBOOK_SCHEDULE_NEEDS_CRON_MESSAGE);
    }

    if (RunbookTriggerAccess.turnsATriggerOn(data)) {
      RunbookTriggerAccess.assertMayRunTriggersIn({
        props: createBy.props,
        projectId: createBy.props.tenantId || createBy.data.projectId,
      });
    }
  }

  // As checkCreateBeforeReferences: before the project check.
  protected override async checkUpdateBeforeReferences(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    const secretRefusal: string | null = Service.getStepSecretFieldRefusal(
      (updateBy.data as unknown as Record<string, unknown>)["steps"],
    );

    if (secretRefusal) {
      throw new BadDataException(secretRefusal);
    }

    await this.assertNamesNoRemovedCredential(updateBy);

    await this.checkTriggerUpdate(updateBy);
  }

  /*
   * An update of the runbook's triggers: its settings must be ones the
   * scheduler can read, a schedule turned on must say when it runs, and -
   * unless it only turns triggers off - the caller must be allowed to start
   * runs of every runbook it writes (RunbookTriggerAccess).
   */
  private async checkTriggerUpdate(updateBy: UpdateBy<Model>): Promise<void> {
    const data: Record<string, unknown> = updateBy.data as unknown as Record<
      string,
      unknown
    >;

    if (RunbookTriggerAccess.getTriggerColumnsWritten(data).length === 0) {
      return;
    }

    Service.checkTriggerSettings(data);

    const turnsScheduleOnWithoutCron: boolean =
      data["isScheduleEnabled"] === true && !Service.hasCron(data);

    const asksToRun: boolean =
      !updateBy.props.isRoot &&
      !updateBy.props.isMasterAdmin &&
      !RunbookTriggerAccess.onlyTurnsTriggersOff(data);

    if (!turnsScheduleOnWithoutCron && !asksToRun) {
      return;
    }

    const runbooks: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        projectId: true,
        scheduleCron: true,
      },
    );

    for (const runbook of runbooks) {
      if (turnsScheduleOnWithoutCron && !runbook.scheduleCron) {
        throw new BadDataException(RUNBOOK_SCHEDULE_NEEDS_CRON_MESSAGE);
      }

      if (asksToRun) {
        await RunbookTriggerAccess.assertMayRunTriggersOf({
          props: updateBy.props,
          projectId: new ObjectID(runbook.projectId!.toString()),
          runbookId: new ObjectID(runbook._id!.toString()),
        });
      }
    }
  }

  // Whether a write gives the schedule a cron.
  private static hasCron(data: Record<string, unknown>): boolean {
    return (
      typeof data["scheduleCron"] === "string" &&
      data["scheduleCron"].trim().length > 0
    );
  }

  /*
   * Refuses trigger settings the scheduler could not read, in words that
   * say what would do, and writes the cron and time zone as they are kept:
   * the cron's fields one space apart, the time zone without surrounding
   * spaces. Only what the write sends is looked at.
   */
  public static checkTriggerSettings(data: Record<string, unknown>): void {
    if (data["scheduleCron"] !== undefined && data["scheduleCron"] !== null) {
      const error: string | null = getRunbookScheduleCronError(
        data["scheduleCron"],
      );

      if (error) {
        throw new BadDataException(error);
      }

      data["scheduleCron"] = normalizeRunbookScheduleCron(
        data["scheduleCron"] as string,
      );
    }

    if (
      data["scheduleTimezone"] !== undefined &&
      data["scheduleTimezone"] !== null
    ) {
      if (!isValidRunbookScheduleTimezone(data["scheduleTimezone"])) {
        throw new BadDataException(
          `"${String(data["scheduleTimezone"])}" is not a time zone. Use an IANA time zone, such as Europe/London or America/New_York.`,
        );
      }

      data["scheduleTimezone"] = (data["scheduleTimezone"] as string).trim();
    }

    if (
      data["scheduleOverlapPolicy"] !== undefined &&
      data["scheduleOverlapPolicy"] !== null &&
      !Object.values(RunbookScheduleOverlapPolicy).includes(
        data["scheduleOverlapPolicy"] as RunbookScheduleOverlapPolicy,
      )
    ) {
      throw new BadDataException(
        `What a schedule does while a run is still going must be "${RunbookScheduleOverlapPolicy.Skip}" or "${RunbookScheduleOverlapPolicy.RunAfter}".`,
      );
    }

    if (
      data["scheduleMissedRunPolicy"] !== undefined &&
      data["scheduleMissedRunPolicy"] !== null &&
      !Object.values(RunbookScheduleMissedRunPolicy).includes(
        data["scheduleMissedRunPolicy"] as RunbookScheduleMissedRunPolicy,
      )
    ) {
      throw new BadDataException(
        `What a schedule does with runs OneUptime missed must be "${RunbookScheduleMissedRunPolicy.RunOnce}" or "${RunbookScheduleMissedRunPolicy.Skip}".`,
      );
    }
  }

  /*
   * Whether an update changes when the schedule runs: it writes one of the
   * timing columns with a value some runbook it writes does not hold. A
   * save that sends a column unchanged moves nothing, so a run due this
   * minute is not lost to an edit of the runbook's name.
   */
  private async movesSchedule(updateBy: UpdateBy<Model>): Promise<boolean> {
    const data: Record<string, unknown> = updateBy.data as unknown as Record<
      string,
      unknown
    >;

    const columns: Array<string> = RUNBOOK_SCHEDULE_TIMING_COLUMNS.filter(
      (column: string) => {
        return data[column] !== undefined;
      },
    );

    if (columns.length === 0) {
      return false;
    }

    const runbooks: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        isEnabled: true,
        isScheduleEnabled: true,
        scheduleCron: true,
        scheduleTimezone: true,
      },
    );

    return runbooks.some((runbook: Model) => {
      return columns.some((column: string) => {
        const held: unknown = (runbook as unknown as Record<string, unknown>)[
          column
        ];

        return (held ?? null) !== (data[column] ?? null);
      });
    });
  }

  /*
   * A new secret key for a runbook's webhook URL: 32 random bytes as
   * base64url. Generated here, on the server, never by a browser.
   */
  public static generateWebhookSecretKey(): string {
    return crypto
      .randomBytes(RUNBOOK_WEBHOOK_SECRET_KEY_BYTES)
      .toString("base64url");
  }

  /*
   * The runbook's webhook key, given one first when it has none (the first
   * time its webhook is turned on). Written only over an empty column, so
   * turning the webhook off and on again keeps its URL, and two writers at
   * once agree on one key.
   */
  @CaptureSpan()
  public async ensureWebhookSecretKey(
    runbookId: ObjectID,
  ): Promise<string | null> {
    await this.compareAndSetColumnsByIdWithoutHooks({
      id: runbookId,
      data: {
        webhookSecretKey: Service.generateWebhookSecretKey(),
      } as PartialEntity<Model>,
      expectedData: { webhookSecretKey: null } as PartialEntity<Model>,
    });

    const runbook: Model | null = await this.findOneById({
      id: runbookId,
      select: { webhookSecretKey: true },
      props: { isRoot: true },
    });

    return isRunbookWebhookSecretKeyShape(runbook?.webhookSecretKey)
      ? runbook!.webhookSecretKey!
      : null;
  }

  /*
   * Gives the runbook's webhook a new key and returns it. The old URL stops
   * working at once: the webhook route compares the key in the URL with
   * this one, and nothing remembers the one before.
   */
  @CaptureSpan()
  public async resetWebhookSecretKey(runbookId: ObjectID): Promise<string> {
    const secretKey: string = Service.generateWebhookSecretKey();

    await this.updateColumnsByIdWithoutHooks({
      id: runbookId,
      data: { webhookSecretKey: secretKey } as PartialEntity<Model>,
    });

    return secretKey;
  }

  /*
   * Clears the next run, and a run waiting for the one before it, of a
   * schedule that is changing - here, after every permission check, and
   * never in onBeforeUpdate: both columns are OneUptime's (update: []), and
   * DatabaseService holds what onBeforeUpdate leaves to the caller's column
   * permissions. onUpdateSuccess works the next run out again.
   */
  @CaptureSpan()
  protected override async onUpdatePermitted(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    await super.onUpdatePermitted(updateBy);

    if (!(await this.movesSchedule(updateBy))) {
      return;
    }

    const data: Record<string, unknown> = updateBy.data as unknown as Record<
      string,
      unknown
    >;

    data["scheduleNextRunAt"] = null;
    data["scheduleQueuedRunAt"] = null;
  }

  /*
   * After an update that wrote when the schedule runs, its next run is
   * worked out again - only over an empty column, so it changes something
   * only when onUpdatePermitted cleared it. A webhook turned on is given its
   * key - only when it has none, so its URL stays the one it had. Both read
   * the update itself, so nothing is carried here from the earlier hooks.
   */
  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    const result: OnUpdate<Model> = await super.onUpdateSuccess(
      onUpdate,
      updatedItemIds,
    );

    const data: Record<string, unknown> = (onUpdate.updateBy.data ||
      {}) as unknown as Record<string, unknown>;

    const writesScheduleTiming: boolean = RUNBOOK_SCHEDULE_TIMING_COLUMNS.some(
      (column: string): boolean => {
        return data[column] !== undefined;
      },
    );
    const turnsWebhookOn: boolean = data["isWebhookEnabled"] === true;

    if (!writesScheduleTiming && !turnsWebhookOn) {
      return result;
    }

    for (const runbookId of updatedItemIds) {
      try {
        if (writesScheduleTiming) {
          await RunbookScheduler.planNextRun({ runbookId: runbookId });
        }

        if (turnsWebhookOn) {
          await this.ensureWebhookSecretKey(runbookId);
        }
      } catch (error) {
        logger.error(
          `RunbookService: could not set up the triggers of runbook ${runbookId.toString()} after an update; the scheduler works its next run out on its next pass.`,
          {
            runbookId: runbookId.toString(),
          } as LogAttributes,
        );
        logger.error(error);
      }
    }

    return result;
  }

  /*
   * Refuses an update whose steps name a runbook credential some runbook it
   * writes does not name already (getRemovedCredentialRefusal). The
   * runbooks are the ones the update writes - those its caller may write -
   * and the update is held to them (findRowsAndHoldUpdateToThem), so a
   * runbook the update cannot write says nothing and one this did not read
   * is not written. Reads nothing for steps that name no credential, or an
   * update that writes no steps.
   */
  private async assertNamesNoRemovedCredential(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    const steps: unknown = (updateBy.data as unknown as Record<string, unknown>)[
      "steps"
    ];

    if (Service.getStepCredentialIds(steps).length === 0) {
      return;
    }

    const runbooks: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        steps: true,
      },
    );

    const refusal: string | null = Service.getRemovedCredentialRefusal({
      steps,
      heldIds: runbooks.map((runbook: Model): Set<string> => {
        return new Set<string>(
          Service.getStepCredentialIds(runbook.steps).map(normalizeReferenceId),
        );
      }),
    });

    if (refusal) {
      throw new BadDataException(refusal);
    }
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (createdItem.id) {
      try {
        if (createdItem.isScheduleEnabled === true) {
          await RunbookScheduler.planNextRun({ runbookId: createdItem.id });
        }

        if (createdItem.isWebhookEnabled === true) {
          await this.ensureWebhookSecretKey(createdItem.id);
        }
      } catch (error) {
        logger.error(
          `RunbookService: could not set up the triggers of new runbook ${createdItem.id.toString()}.`,
        );
        logger.error(error);
      }
    }

    if (createdItem.projectId && createdItem.id) {
      /*
       * Run label rule first so rule-added labels are persisted before
       * owner rules run. Owner rules re-fetch labels, so this lets owner
       * rules key on rule-added labels.
       */
      Promise.resolve()
        .then(async () => {
          await RunbookLabelRuleEngineService.applyRulesToRunbook(createdItem);
        })
        .then(async () => {
          await RunbookOwnerRuleEngineService.applyRulesToRunbook(createdItem);
        })
        .catch((error: Error) => {
          logger.error(
            `Error applying runbook rules in RunbookService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              runbookId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        });
    }
    return createdItem;
  }
}

export default new Service();
