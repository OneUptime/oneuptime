import DatabaseService from "./DatabaseService";
import { Service as SecurityEventConnectionService } from "./SecurityEventConnectionService";
import Model from "../../Models/DatabaseModels/AuditLogExport";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import AuditLogExportSettingsUtil, {
  AuditLogExportSettings,
} from "../Utils/AuditLog/Export/AuditLogExportSettings";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import AuditLogExportDestinationType from "../../Types/AuditLog/Export/AuditLogExportDestinationType";
import { AuditLogExportDestinationDefinition } from "../../Types/AuditLog/Export/AuditLogExportDestinationCatalog";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";

// Why a create of an export without a project is refused.
export const INSTANCE_AUDIT_LOG_EXPORT_REFUSED_MESSAGE: string =
  "Only a master admin can export the audit log of the whole instance. Set up a project's export in its Project Settings.";

/*
 * How far ahead of now an Export From may be: a clock a little ahead of the
 * server's is not a date in the future.
 */
const STARTS_AT_CLOCK_SKEW_IN_MINUTES: number = 5;

/*
 * The bookkeeping onUpdatePermitted writes once an update is permitted,
 * named so they are still checked against the model. Spelt out rather than
 * reached through Partial<Model>, like the measurement services' backfill
 * fields.
 */
interface ExporterResetFields {
  cursorCreatedAt?: Date | undefined;
  cursorEntryId?: ObjectID | undefined;
  nextAttemptAt?: Date | undefined;
  consecutiveFailureCount?: number | undefined;
}

// What an update asked of the exporter, decided in onBeforeUpdate.
interface ExporterReset {
  // Export From changed: start again from it.
  restartFromStartsAt: boolean;
  // The settings changed, or the export was switched back on: try at once.
  retryNow: boolean;
}

/*
 * Audit log exports: validated at save time, so an export that stores is one
 * the exporter can send to - an unknown destination, a missing key, a bucket
 * name S3 would refuse or an address the egress policy blocks is an error on
 * the form, not a lastError an hour later.
 *
 * Secrets are write-only and merged on update like a SIEM destination's: a
 * non-empty value replaces the stored one, "" or undefined keeps it, null
 * removes it (SecurityEventConnectionService.mergeSecrets).
 *
 * A new export starts from the moment it is saved, unless it names an
 * earlier Export From (a backfill of the entries still kept). Changing
 * Export From later starts the export again from there. Changing the
 * settings, or switching a paused export back on, tries at once instead of
 * waiting out a failing destination's backoff.
 *
 * An export without a project exports the whole instance: only a master
 * admin may create one (or OneUptime itself).
 */
export class Service extends DatabaseService<Model> {
  private readonly exporterResets: WeakMap<UpdateBy<Model>, ExporterReset> =
    new WeakMap<UpdateBy<Model>, ExporterReset>();

  public constructor() {
    super(Model);
  }

  // Whether an export (read with projectId) is the instance's.
  public static isInstanceExport(item: Pick<Model, "projectId">): boolean {
    return !item.projectId;
  }

  private static isCreateWithoutProject(createBy: CreateBy<Model>): boolean {
    return !createBy.data.projectId && !createBy.props.tenantId;
  }

  private static assertMayCreateInstanceExport(
    props: DatabaseCommonInteractionProps,
  ): void {
    if (!props.isRoot && !props.isMasterAdmin) {
      throw new NotAuthorizedException(INSTANCE_AUDIT_LOG_EXPORT_REFUSED_MESSAGE);
    }
  }

  private static readStartsAt(value: unknown): Date | null {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    const date: Date =
      value instanceof Date ? value : new Date(value as string | number);

    if (Number.isNaN(date.getTime())) {
      throw new BadDataException(
        "Export From must be a date and time, such as 2026-01-31T00:00:00Z.",
      );
    }

    const latest: Date = OneUptimeDate.addRemoveMinutes(
      OneUptimeDate.getCurrentDate(),
      STARTS_AT_CLOCK_SKEW_IN_MINUTES,
    );

    if (OneUptimeDate.isAfter(date, latest)) {
      throw new BadDataException(
        "Export From cannot be in the future. Leave it empty to export from now on.",
      );
    }

    return date;
  }

  private static parseConfig(value: unknown): JSONObject {
    return SecurityEventConnectionService.parseJsonObject(value, "Configuration");
  }

  private static parseSecrets(value: unknown): JSONObject {
    return SecurityEventConnectionService.parseJsonObject(value, "Credentials");
  }

  /*
   * Full validation of settings never saved, or merged with the stored
   * ones: the catalog's shape, the destination's rules and the egress
   * policy. Returns the settings as they are stored.
   */
  public static async validateSettings(data: {
    type: unknown;
    config: JSONObject;
    secrets: JSONObject;
    isInstanceExport: boolean;
  }): Promise<AuditLogExportSettings> {
    const settings: AuditLogExportSettings = AuditLogExportSettingsUtil.validate(
      {
        type: data.type,
        config: data.config,
        secrets: data.secrets,
        requireRequiredSecrets: true,
      },
    );

    await AuditLogExportSettingsUtil.assertTargetsAllowed(settings, {
      isInstanceExport: data.isInstanceExport,
    });

    return settings;
  }

  /*
   * The stored secrets with an edit's unsaved ones over them, by the rule a
   * save applies (mergeSecrets).
   */
  public static mergeSecrets(data: {
    type: unknown;
    stored: unknown;
    provided: unknown;
  }): JSONObject {
    const definition: AuditLogExportDestinationDefinition =
      AuditLogExportSettingsUtil.getDefinitionOrThrow(data.type);

    return SecurityEventConnectionService.mergeSecrets({
      definition,
      stored: Service.parseSecrets(data.stored),
      provided: Service.parseSecrets(data.provided),
    });
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    const isInstanceExport: boolean = Service.isCreateWithoutProject(createBy);

    if (isInstanceExport) {
      Service.assertMayCreateInstanceExport(createBy.props);
    }

    const definition: AuditLogExportDestinationDefinition =
      AuditLogExportSettingsUtil.getDefinitionOrThrow(
        createBy.data.destinationType,
      );

    const settings: AuditLogExportSettings = await Service.validateSettings({
      type: definition.type,
      config: Service.parseConfig(createBy.data.config),
      secrets: Service.parseSecrets(createBy.data.secrets),
      isInstanceExport,
    });

    createBy.data.destinationType = definition.type;
    createBy.data.config = settings.config;
    createBy.data.secrets = (
      Object.keys(settings.secrets).length > 0
        ? JSON.stringify(settings.secrets)
        : null
    ) as unknown as string;

    // An export saved without saying so is on: that is why it was saved.
    if (createBy.data.isEnabled === undefined) {
      createBy.data.isEnabled = true;
    }

    // From now on, unless the create asks for the entries since an earlier date.
    createBy.data.startsAt =
      Service.readStartsAt(createBy.data.startsAt) ||
      OneUptimeDate.getCurrentDate();

    return { createBy, carryForward: null };
  }

  /*
   * The tenant has been stamped by now, so this is the last word on whether
   * the export is the instance's: a create left without a project by
   * anyone but a master admin is refused.
   */
  protected override async onCreatePermitted(
    onCreate: OnCreate<Model>,
  ): Promise<void> {
    if (!onCreate.createBy.data.projectId) {
      Service.assertMayCreateInstanceExport(onCreate.createBy.props);
    }
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    // A plain JSON view: the typed partial of a model with JSON columns is too deep for TypeScript.
    const incoming: JSONObject = updateBy.data as unknown as JSONObject;

    if (incoming["destinationType"] !== undefined) {
      throw new BadDataException(
        "The destination of an export cannot be changed. Create a new export instead.",
      );
    }

    const reset: ExporterReset = {
      restartFromStartsAt: false,
      retryNow: false,
    };

    if (incoming["startsAt"] !== undefined) {
      const startsAt: Date | null = Service.readStartsAt(incoming["startsAt"]);

      if (!startsAt) {
        throw new BadDataException(
          "Export From needs a date. To export from now on, set it to now.",
        );
      }

      updateBy.data.startsAt = startsAt;
      reset.restartFromStartsAt = true;
      reset.retryNow = true;
    }

    if (incoming["isEnabled"] === true) {
      reset.retryNow = true;
    }

    const touchesSettings: boolean =
      incoming["config"] !== undefined || incoming["secrets"] !== undefined;

    if (touchesSettings) {
      const exportId: string | undefined = Service.getOneRowIdNamedBy(
        updateBy.query,
      )?.toString();

      if (!exportId || !ObjectID.isValidUUID(exportId)) {
        throw new BadDataException(
          "Settings and credentials can only be updated one export at a time.",
        );
      }

      const current: Model | null = await this.findOneById({
        id: new ObjectID(exportId),
        select: {
          _id: true,
          projectId: true,
          destinationType: true,
          config: true,
          secrets: true,
        },
        props: { isRoot: true },
      });

      if (!current || !current.destinationType) {
        throw new BadDataException("The export no longer exists.");
      }

      const config: JSONObject =
        incoming["config"] !== undefined
          ? Service.parseConfig(incoming["config"])
          : Service.parseConfig(current.config);

      const secrets: JSONObject = Service.mergeSecrets({
        type: current.destinationType,
        stored: current.secrets,
        provided:
          incoming["secrets"] !== undefined ? incoming["secrets"] : undefined,
      });

      const settings: AuditLogExportSettings = await Service.validateSettings({
        type: current.destinationType,
        config,
        secrets,
        isInstanceExport: Service.isInstanceExport(current),
      });

      incoming["config"] = settings.config;
      incoming["secrets"] = (
        Object.keys(settings.secrets).length > 0
          ? JSON.stringify(settings.secrets)
          : null
      ) as unknown as string;
      reset.retryNow = true;
    }

    if (reset.restartFromStartsAt || reset.retryNow) {
      this.exporterResets.set(updateBy, reset);
    }

    return { updateBy, carryForward: null };
  }

  /*
   * The exporter's bookkeeping is OneUptime's to write, so it is reset here,
   * once the caller's column permissions have let the update through.
   */
  protected override async onUpdatePermitted(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    const reset: ExporterReset | undefined = this.exporterResets.get(updateBy);

    if (!reset) {
      return;
    }

    this.exporterResets.delete(updateBy);

    const fields: ExporterResetFields =
      updateBy.data as unknown as ExporterResetFields;

    if (reset.restartFromStartsAt) {
      // Cleared, not left stale: the export starts again from Export From.
      fields.cursorCreatedAt = null as unknown as Date;
      fields.cursorEntryId = null as unknown as ObjectID;
    }

    if (reset.retryNow) {
      fields.nextAttemptAt = null as unknown as Date;
      fields.consecutiveFailureCount = 0;
    }
  }

  /*
   * Decrypted settings for the exporter and the test. Root read; never
   * serialize the result into a response or a log.
   */
  public async getSettings(item: Model): Promise<AuditLogExportSettings> {
    let destinationType: AuditLogExportDestinationType | undefined =
      item.destinationType;
    let config: JSONObject | undefined = item.config;
    let secrets: string | undefined = item.secrets;

    if (
      (destinationType === undefined ||
        config === undefined ||
        secrets === undefined) &&
      item.id
    ) {
      const loaded: Model | null = await this.findOneById({
        id: item.id,
        select: {
          _id: true,
          destinationType: true,
          config: true,
          secrets: true,
        },
        props: { isRoot: true },
      });

      if (!loaded) {
        throw new BadDataException("The export no longer exists.");
      }

      destinationType = loaded.destinationType;
      config = loaded.config;
      secrets = loaded.secrets;
    }

    const definition: AuditLogExportDestinationDefinition =
      AuditLogExportSettingsUtil.getDefinitionOrThrow(destinationType);

    return {
      type: definition.type,
      config: Service.parseConfig(config),
      secrets: Service.parseSecrets(secrets),
    };
  }
}

export default new Service();
