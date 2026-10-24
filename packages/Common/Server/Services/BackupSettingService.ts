import DatabaseService from "./DatabaseService";
import { Service as SecurityEventConnectionService } from "./SecurityEventConnectionService";
import Model, {
  BACKUP_SETTING_BOOKKEEPING_COLUMNS,
} from "../../Models/DatabaseModels/BackupSetting";
import CreateBy from "../Types/Database/CreateBy";
import FindBy from "../Types/Database/FindBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnFind, OnUpdate } from "../Types/Database/Hooks";
import BackupSettingsUtil, {
  BackupDestinationSettings,
} from "../Utils/Backup/BackupSettings";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import BackupDestinationType from "../../Types/Backup/BackupDestinationType";
import { BackupDestinationDefinition } from "../../Types/Backup/BackupDestinationCatalog";
import {
  BackupFrequency,
  BackupSchedule,
  DEFAULT_BACKUP_DAY_OF_WEEK,
  DEFAULT_BACKUP_FREQUENCY,
  DEFAULT_BACKUP_RETENTION_IN_DAYS,
  DEFAULT_BACKUP_TIME_OF_DAY,
  MAX_BACKUP_RETENTION_IN_DAYS,
  MIN_BACKUP_RETENTION_IN_DAYS,
  formatBackupTimeOfDay,
  getNextBackupAt,
  isBackupDayOfWeek,
  isBackupFrequency,
  parseBackupTimeOfDay,
  TimeOfDay,
} from "../../Types/Backup/BackupSchedule";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";

// Why anyone but a master admin is refused.
export const BACKUP_SETTING_REFUSED_MESSAGE: string =
  "Only a master admin can set up the instance's backups.";

export const BACKUP_SETTING_EXISTS_MESSAGE: string =
  "Backups are already set up. Edit the backup settings instead.";

export const BACKUP_SETTING_BOOKKEEPING_MESSAGE: string =
  "When the next backup runs and when admins were last told of a failure are written by OneUptime.";

// The schedule columns: a change to any of them moves the next backup.
const SCHEDULE_COLUMNS: Array<string> = ["frequency", "timeOfDay", "dayOfWeek"];

// What a change asked of the scheduler, decided in onBeforeUpdate.
interface ScheduleReset {
  schedule: BackupSchedule;
}

/*
 * The instance's backup settings: one row, set up by a master admin,
 * validated at save time so settings that store are settings a backup can
 * run with - an unknown destination, a missing key, a bucket name S3 would
 * refuse, an address the egress policy blocks, a time that is not one, a
 * retention outside 1 to 3650 days are form errors, not a backup that fails
 * at night.
 *
 * Secrets are write-only (the audit log export's rule): a non-empty value
 * replaces the stored one, "" or undefined keeps it, null removes it; a
 * change of destination starts from none. They are never returned by a
 * read, to anyone but OneUptime itself - not even a master admin.
 *
 * Saving the schedule moves the next backup to the schedule's next time.
 */
export class Service extends DatabaseService<Model> {
  private readonly scheduleResets: WeakMap<UpdateBy<Model>, ScheduleReset> =
    new WeakMap<UpdateBy<Model>, ScheduleReset>();

  public constructor() {
    super(Model);
  }

  private static assertMasterAdmin(props: DatabaseCommonInteractionProps): void {
    if (!props.isRoot && !props.isMasterAdmin) {
      throw new NotAuthorizedException(BACKUP_SETTING_REFUSED_MESSAGE);
    }
  }

  private static parseConfig(value: unknown): JSONObject {
    return SecurityEventConnectionService.parseJsonObject(
      value,
      "Configuration",
    );
  }

  private static parseSecrets(value: unknown): JSONObject {
    return SecurityEventConnectionService.parseJsonObject(value, "Credentials");
  }

  private static assertNoBookkeeping(
    data: JSONObject,
    props: DatabaseCommonInteractionProps,
  ): void {
    if (props.isRoot) {
      return;
    }

    for (const column of BACKUP_SETTING_BOOKKEEPING_COLUMNS) {
      if (data[column] !== undefined) {
        throw new BadDataException(BACKUP_SETTING_BOOKKEEPING_MESSAGE);
      }
    }
  }

  /*
   * A schedule as a save keeps it: a frequency the product knows, a time
   * "HH:MM" (written back with two-digit hours), a weekday 0-6, and a
   * retention of whole days from 1 to 3650. A value left out keeps the
   * current one (or the default); a value that is not one is refused.
   */
  public static validateSchedule(data: {
    frequency: unknown;
    timeOfDay: unknown;
    dayOfWeek: unknown;
    retentionInDays: unknown;
  }): BackupSchedule & { retentionInDays: number } {
    const frequency: unknown =
      data.frequency === undefined || data.frequency === null
        ? DEFAULT_BACKUP_FREQUENCY
        : data.frequency;

    if (!isBackupFrequency(frequency)) {
      throw new BadDataException(
        "Frequency must be one of: every-hour, every-6-hours, every-12-hours, daily or weekly.",
      );
    }

    const timeText: unknown =
      data.timeOfDay === undefined ||
      data.timeOfDay === null ||
      data.timeOfDay === ""
        ? DEFAULT_BACKUP_TIME_OF_DAY
        : data.timeOfDay;
    const time: TimeOfDay | null =
      typeof timeText === "string" ? parseBackupTimeOfDay(timeText) : null;

    if (!time) {
      throw new BadDataException(
        "Time must be a time of day as HH:MM, from 00:00 to 23:59 (UTC).",
      );
    }

    const dayValue: unknown =
      data.dayOfWeek === undefined || data.dayOfWeek === null
        ? DEFAULT_BACKUP_DAY_OF_WEEK
        : typeof data.dayOfWeek === "string" && data.dayOfWeek.trim() !== ""
          ? Number(data.dayOfWeek)
          : data.dayOfWeek;

    if (!isBackupDayOfWeek(dayValue)) {
      throw new BadDataException(
        "Day must be a day of the week, from 0 (Sunday) to 6 (Saturday).",
      );
    }

    const retentionValue: unknown =
      data.retentionInDays === undefined || data.retentionInDays === null
        ? DEFAULT_BACKUP_RETENTION_IN_DAYS
        : typeof data.retentionInDays === "string" &&
            data.retentionInDays.trim() !== ""
          ? Number(data.retentionInDays)
          : data.retentionInDays;

    if (
      typeof retentionValue !== "number" ||
      !Number.isInteger(retentionValue) ||
      retentionValue < MIN_BACKUP_RETENTION_IN_DAYS ||
      retentionValue > MAX_BACKUP_RETENTION_IN_DAYS
    ) {
      throw new BadDataException(
        `Keep backups for must be a whole number of days from ${MIN_BACKUP_RETENTION_IN_DAYS} to ${MAX_BACKUP_RETENTION_IN_DAYS}.`,
      );
    }

    return {
      frequency,
      timeOfDay: formatBackupTimeOfDay(time),
      dayOfWeek: dayValue,
      retentionInDays: retentionValue,
    };
  }

  /*
   * Full validation of settings never saved, or merged with the stored
   * ones: the catalog's shape, the storage's rules and the egress policy.
   * Returns the settings as they are stored.
   */
  public static async validateDestination(data: {
    type: unknown;
    provider: unknown;
    config: JSONObject;
    secrets: JSONObject;
  }): Promise<BackupDestinationSettings> {
    const settings: BackupDestinationSettings = BackupSettingsUtil.validate({
      type: data.type,
      provider: data.provider,
      config: data.config,
      secrets: data.secrets,
      requireRequiredSecrets: true,
    });

    await BackupSettingsUtil.assertTargetsAllowed(settings);

    return settings;
  }

  /*
   * The stored secrets with an edit's unsaved ones over them, by the rule
   * a save applies (mergeSecrets). A change of storage keeps nothing: the
   * stored keys belong to the other storage.
   */
  public static mergeSecrets(data: {
    type: unknown;
    storedType: unknown;
    stored: unknown;
    provided: unknown;
  }): JSONObject {
    const definition: BackupDestinationDefinition =
      BackupSettingsUtil.getDefinitionOrThrow(data.type);

    return SecurityEventConnectionService.mergeSecrets({
      definition,
      stored:
        data.storedType === data.type ? Service.parseSecrets(data.stored) : {},
      provided: Service.parseSecrets(data.provided),
    });
  }

  private static storeSecrets(secrets: JSONObject): string {
    return (Object.keys(secrets).length > 0
      ? JSON.stringify(secrets)
      : null) as unknown as string;
  }

  /*
   * Never the secrets, to anyone but OneUptime: a read that selects them,
   * or filters on them, has them taken out - so the Admin Dashboard, or any
   * API key of a master admin, gets everything else and never a key.
   */
  public dropSecretsFromRead(findBy: FindBy<Model>): FindBy<Model> {
    if (findBy.props.isRoot) {
      return findBy;
    }

    const without: <T>(value: T) => T = <T>(value: T): T => {
      if (!value || typeof value !== "object") {
        return value;
      }

      const copy: Record<string, unknown> = {
        ...(value as unknown as Record<string, unknown>),
      };

      delete copy["secrets"];

      return copy as unknown as T;
    };

    return {
      ...findBy,
      select: without(findBy.select),
      query: without(findBy.query),
    };
  }

  @CaptureSpan()
  protected override async onBeforeFind(
    findBy: FindBy<Model>,
  ): Promise<OnFind<Model>> {
    return { findBy: this.dropSecretsFromRead(findBy), carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    Service.assertMasterAdmin(createBy.props);
    Service.assertNoBookkeeping(
      createBy.data as unknown as JSONObject,
      createBy.props,
    );

    const existing: number = (
      await this.countBy({
        query: {},
        props: { isRoot: true },
      })
    ).toNumber();

    if (existing > 0) {
      throw new BadDataException(BACKUP_SETTING_EXISTS_MESSAGE);
    }

    const settings: BackupDestinationSettings =
      await Service.validateDestination({
        type: createBy.data.destinationType,
        provider: createBy.data.destinationProvider,
        config: Service.parseConfig(createBy.data.config),
        secrets: Service.parseSecrets(createBy.data.secrets),
      });

    const schedule: BackupSchedule & { retentionInDays: number } =
      Service.validateSchedule({
        frequency: createBy.data.frequency,
        timeOfDay: createBy.data.timeOfDay,
        dayOfWeek: createBy.data.dayOfWeek,
        retentionInDays: createBy.data.retentionInDays,
      });

    createBy.data.destinationType = settings.type;
    createBy.data.destinationProvider = settings.provider;
    createBy.data.config = settings.config;
    createBy.data.secrets = Service.storeSecrets(settings.secrets);
    createBy.data.frequency = schedule.frequency;
    createBy.data.timeOfDay = schedule.timeOfDay;
    createBy.data.dayOfWeek = schedule.dayOfWeek;
    createBy.data.retentionInDays = schedule.retentionInDays;

    // Settings saved without saying so back up on the schedule: that is why they were saved.
    if (createBy.data.isEnabled === undefined) {
      createBy.data.isEnabled = true;
    }

    if (createBy.data.includesClickhouse === undefined) {
      createBy.data.includesClickhouse = true;
    }

    return { createBy, carryForward: schedule };
  }

  // The next backup is OneUptime's to write, once the create is permitted.
  protected override async onCreatePermitted(
    onCreate: OnCreate<Model>,
  ): Promise<void> {
    Service.assertMasterAdmin(onCreate.createBy.props);

    const schedule: BackupSchedule | null =
      (onCreate.carryForward as BackupSchedule | null) || null;

    if (schedule) {
      onCreate.createBy.data.nextBackupAt = getNextBackupAt(
        schedule,
        OneUptimeDate.getCurrentDate(),
      );
    }
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    Service.assertMasterAdmin(updateBy.props);

    // A plain JSON view: the typed partial of a model with JSON columns is too deep for TypeScript.
    const incoming: JSONObject = updateBy.data as unknown as JSONObject;

    Service.assertNoBookkeeping(incoming, updateBy.props);

    const touchesDestination: boolean =
      incoming["destinationType"] !== undefined ||
      incoming["destinationProvider"] !== undefined ||
      incoming["config"] !== undefined ||
      incoming["secrets"] !== undefined;

    const touchesSchedule: boolean =
      SCHEDULE_COLUMNS.some((column: string): boolean => {
        return incoming[column] !== undefined;
      }) || incoming["retentionInDays"] !== undefined;

    // Turning the schedule back on starts it from now, not from a missed time.
    const turnsOn: boolean = incoming["isEnabled"] === true;

    if (!touchesDestination && !touchesSchedule && !turnsOn) {
      return { updateBy, carryForward: null };
    }

    const settingId: string | undefined = Service.getOneRowIdNamedBy(
      updateBy.query,
    )?.toString();

    if (!settingId || !ObjectID.isValidUUID(settingId)) {
      throw new BadDataException(
        "Backup settings can only be updated by their ID.",
      );
    }

    const current: Model | null = await this.findOneById({
      id: new ObjectID(settingId),
      select: {
        _id: true,
        destinationType: true,
        destinationProvider: true,
        config: true,
        secrets: true,
        frequency: true,
        timeOfDay: true,
        dayOfWeek: true,
        retentionInDays: true,
      },
      props: { isRoot: true },
    });

    if (!current || !current.destinationType) {
      throw new BadDataException("The backup settings no longer exist.");
    }

    if (touchesDestination) {
      const type: BackupDestinationType = (incoming["destinationType"] ??
        current.destinationType) as BackupDestinationType;
      const isSameType: boolean = type === current.destinationType;

      const settings: BackupDestinationSettings =
        await Service.validateDestination({
          type,
          provider:
            incoming["destinationProvider"] !== undefined
              ? incoming["destinationProvider"]
              : isSameType
                ? current.destinationProvider
                : undefined,
          config:
            incoming["config"] !== undefined
              ? Service.parseConfig(incoming["config"])
              : isSameType
                ? Service.parseConfig(current.config)
                : {},
          secrets: Service.mergeSecrets({
            type,
            storedType: current.destinationType,
            stored: current.secrets,
            provided:
              incoming["secrets"] !== undefined ? incoming["secrets"] : undefined,
          }),
        });

      incoming["destinationType"] = settings.type;
      incoming["destinationProvider"] = settings.provider;
      incoming["config"] = settings.config;
      incoming["secrets"] = Service.storeSecrets(settings.secrets);
    }

    let reset: ScheduleReset | null = null;

    if (touchesSchedule || turnsOn) {
      const schedule: BackupSchedule & { retentionInDays: number } =
        Service.validateSchedule({
          frequency: incoming["frequency"] ?? current.frequency,
          timeOfDay: incoming["timeOfDay"] ?? current.timeOfDay,
          dayOfWeek: incoming["dayOfWeek"] ?? current.dayOfWeek,
          retentionInDays:
            incoming["retentionInDays"] ?? current.retentionInDays,
        });

      for (const column of SCHEDULE_COLUMNS) {
        if (incoming[column] !== undefined) {
          incoming[column] = schedule[column as keyof BackupSchedule] as never;
        }
      }

      if (incoming["retentionInDays"] !== undefined) {
        incoming["retentionInDays"] = schedule.retentionInDays;
      }

      const movesSchedule: boolean =
        turnsOn ||
        SCHEDULE_COLUMNS.some((column: string): boolean => {
          return incoming[column] !== undefined;
        });

      if (movesSchedule) {
        reset = {
          schedule: {
            frequency: schedule.frequency as BackupFrequency,
            timeOfDay: schedule.timeOfDay,
            dayOfWeek: schedule.dayOfWeek,
          },
        };
      }
    }

    if (reset) {
      this.scheduleResets.set(updateBy, reset);
    }

    return { updateBy, carryForward: null };
  }

  /*
   * The next backup is OneUptime's bookkeeping, so it moves here, once the
   * caller's permissions have let the update through.
   */
  protected override async onUpdatePermitted(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    const reset: ScheduleReset | undefined = this.scheduleResets.get(updateBy);

    if (!reset) {
      return;
    }

    this.scheduleResets.delete(updateBy);

    (updateBy.data as unknown as { nextBackupAt?: Date }).nextBackupAt =
      getNextBackupAt(reset.schedule, OneUptimeDate.getCurrentDate());
  }

  // The one row of backup settings, or null when backups are not set up. Root read.
  public async getSetting(): Promise<Model | null> {
    return await this.findOneBy({
      query: {},
      select: {
        _id: true,
        destinationType: true,
        destinationProvider: true,
        config: true,
        isEnabled: true,
        frequency: true,
        timeOfDay: true,
        dayOfWeek: true,
        retentionInDays: true,
        includesClickhouse: true,
        nextBackupAt: true,
        lastFailureNotifiedAt: true,
      },
      props: { isRoot: true },
    });
  }

  /*
   * The decrypted destination settings the runner and the test connect
   * with. Root read; never serialize the result into a response or a log.
   */
  public async getDestinationSettings(
    settingId: ObjectID,
  ): Promise<BackupDestinationSettings> {
    const loaded: Model | null = await this.findOneById({
      id: settingId,
      select: {
        _id: true,
        destinationType: true,
        destinationProvider: true,
        config: true,
        secrets: true,
      },
      props: { isRoot: true },
    });

    if (!loaded || !loaded.destinationType) {
      throw new BadDataException("Backups are not set up.");
    }

    const definition: BackupDestinationDefinition =
      BackupSettingsUtil.getDefinitionOrThrow(loaded.destinationType);

    return {
      type: definition.type,
      provider: BackupSettingsUtil.getProvider({
        type: definition.type,
        provider: loaded.destinationProvider,
      }),
      config: Service.parseConfig(loaded.config),
      secrets: Service.parseSecrets(loaded.secrets),
    };
  }
}

export default new Service();
