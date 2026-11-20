import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import CreateBy from "../Types/Database/CreateBy";
import Query from "../Types/Database/Query";
import QueryHelper from "../Types/Database/QueryHelper";
import Select from "../Types/Database/Select";
import UpdateBy from "../Types/Database/UpdateBy";
import ProjectScopedReferenceValidator, {
  HeldRelationIds,
  ProjectScopedRelation,
  resolveReferenceIds,
} from "../Utils/Database/ProjectScopedReferenceValidator";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import WriteOnlyCredentialChanges from "../Utils/AuditLog/WriteOnlyCredentialChanges";
import ProjectReferencesService from "./ProjectReferencesService";
import LabelService from "./LabelService";
import MonitorService from "./MonitorService";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import Dictionary from "../../Types/Dictionary";
import BadDataException from "../../Types/Exception/BadDataException";
import MonitorSecretAccess, {
  MonitorSecretAccessList,
  MonitorSecretAccessUtil,
  MonitorSecretGrantee,
} from "../../Types/Monitor/MonitorSecretAccess";
import MonitorSecretType, {
  MonitorSecretTypeUtil,
} from "../../Types/Monitor/MonitorSecretType";
import ObjectID from "../../Types/ObjectID";
import {
  TotpSecretReading,
  readTotpSecret,
  writeStoredTotpSecret,
  writeTotpSecretProblem,
} from "../../Utils/Totp/TotpSecret";
import Label from "../../Models/DatabaseModels/Label";
import Monitor from "../../Models/DatabaseModels/Monitor";
import MonitorSecret from "../../Models/DatabaseModels/MonitorSecret";

// The column the value is kept in: nobody reads it, and it is kept encrypted.
const MONITOR_SECRET_VALUE_COLUMN: string = "secretValue";

/*
 * Said when a write changes a secret's type without a new value, or with an
 * empty one, for the new type (issue #9760).
 */
export const TYPE_CHANGE_NEEDS_VALUE_MESSAGE: string =
  "A secret's type changes only together with a new value, because the value it holds means something else in the other type. Enter the new value along with the type.";

/*
 * Said when a one-time code secret would become Text with the setup key it
 * holds as its value: a Text secret is sent as written, so the key itself
 * would go where the code went.
 */
export const SETUP_KEY_AS_TEXT_MESSAGE: string =
  "This is the setup key the secret holds now. A Text secret is sent as written, so the key itself would be sent where the one-time code went. Enter the new text value, or keep the type One-time code (TOTP).";

export class Service extends ProjectReferencesService<MonitorSecret> {
  public constructor() {
    super(MonitorSecret);
  }

  /*
   * The monitors and labels a secret is shared with are checked by this
   * service's own hooks below, with ProjectScopedReferenceValidator and its
   * own words.
   */
  protected override getListsCheckedByService(): Array<string> {
    return ["monitors", "labels"];
  }

  /*
   * A new secret always gets a mode: the one asked for, or Specific Monitors,
   * which is what the column defaults to and what a client that predates the
   * column means. Nothing is stored yet, so a list the mode will never read is
   * dropped rather than written.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<MonitorSecret>,
  ): Promise<OnCreate<MonitorSecret>> {
    await super.onBeforeCreate(createBy);

    /*
     * A new secret always gets a type: the one asked for, or Text, which is
     * what the column defaults to and what a client that predates the
     * column means. A one-time code secret's value must be a setup key or
     * an otpauth://totp link the probe can make codes from, and is stored
     * in one canonical form (issue #9703).
     */
    const requestedType: unknown = createBy.data.secretType;

    const secretType: MonitorSecretType =
      requestedType === undefined || requestedType === null
        ? MonitorSecretTypeUtil.DEFAULT_TYPE
        : this.readSecretType(requestedType);

    createBy.data.secretType = secretType;

    if (secretType === MonitorSecretType.TOTP) {
      createBy.data.secretValue = this.readTotpSecretValue(
        createBy.data.secretValue,
      );
    }

    const requested: unknown = createBy.data.monitorAccess;

    const access: MonitorSecretAccess =
      requested === undefined || requested === null
        ? MonitorSecretAccessUtil.DEFAULT_ACCESS
        : this.readMonitorAccess(requested);

    createBy.data.monitorAccess = access;

    for (const list of MonitorSecretAccessUtil.getListsUnusedBy(access)) {
      (createBy.data as unknown as Dictionary<unknown>)[list] = undefined;
    }

    await ProjectScopedReferenceValidator.validateReferencesBelongToProject({
      projectId: createBy.props.tenantId || createBy.data.projectId,
      subject: "monitor secret",
      references: ProjectScopedReferenceValidator.getRelationReferences({
        payload: createBy.data,
        relations: this.getProjectScopedRelations(),
      }),
    });

    return { createBy, carryForward: null };
  }

  /*
   * Writing the mode empties the lists it does not read, so a secret never
   * keeps an old list around that a later switch back would quietly bring
   * into force again. A write without the mode leaves the lists alone: the
   * "Update Secret Value" button, a rename, or an API client that sets a list
   * first and flips the mode in a second request.
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<MonitorSecret>,
  ): Promise<OnUpdate<MonitorSecret>> {
    await super.onBeforeUpdate(updateBy);

    const data: Dictionary<unknown> = updateBy.data as Dictionary<unknown>;

    /*
     * The value is nobody's to read, so the audit log leaves it out of
     * every entry: a value replaced is recorded as changed - by whom, and
     * when - and never with either value (WriteOnlyCredentialChanges).
     */
    WriteOnlyCredentialChanges.recordInAuditLog(updateBy, [
      MONITOR_SECRET_VALUE_COLUMN,
    ]);

    if (data["secretType"] !== undefined) {
      await this.readTypeChange(updateBy, data);
    } else if (data["secretValue"] !== undefined) {
      /*
       * A new value for a one-time code secret is read as a setup key or
       * an otpauth://totp link, as one is on create - Update Secret Value
       * sends the value alone when the type stays, so the type is the
       * stored one.
       */
      const rows: Array<MonitorSecret> = await this.findRowsAndHoldUpdateToThem(
        updateBy,
        {
          _id: true,
          secretType: true,
        },
      );

      const totpRows: Array<MonitorSecret> = rows.filter(
        (row: MonitorSecret): boolean => {
          return MonitorSecretTypeUtil.isTotp(row.secretType);
        },
      );

      if (totpRows.length > 0) {
        if (totpRows.length !== rows.length) {
          throw new BadDataException(
            "This update gives one value to one-time code (TOTP) secrets and other secrets together. Update the one-time code secrets on their own.",
          );
        }

        data["secretValue"] = this.readTotpSecretValue(data["secretValue"]);
      }
    }

    if (data["monitorAccess"] !== undefined) {
      const access: MonitorSecretAccess = this.readMonitorAccess(
        data["monitorAccess"],
      );

      data["monitorAccess"] = access;

      for (const list of MonitorSecretAccessUtil.getListsUnusedBy(access)) {
        data[list] = [];
      }
    }

    // An empty list only removes rows and needs no check.
    const relations: Array<ProjectScopedRelation> =
      this.getProjectScopedRelations().filter(
        (relation: ProjectScopedRelation): boolean => {
          return resolveReferenceIds(data[relation.column]).length > 0;
        },
      );

    if (relations.length === 0) {
      return { updateBy, carryForward: null };
    }

    /*
     * The project of every secret the update writes: the request's
     * project for a teammate, whose update is kept to it, and each
     * secret's own project for OneUptime and a master admin
     * (findProjectsToCheckUpdateIn).
     */
    const projectIds: Array<ObjectID> =
      await this.findProjectsToCheckUpdateIn(updateBy);

    // See ProjectScopedReferenceValidator.getRelationReferences.
    const heldIds: HeldRelationIds =
      await ProjectScopedReferenceValidator.getHeldRelationIds({
        service: this,
        updateBy: updateBy,
        columns: relations.map((relation: ProjectScopedRelation): string => {
          return relation.column;
        }),
      });

    for (const projectId of projectIds) {
      await ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: projectId,
        subject: "monitor secret",
        references: ProjectScopedReferenceValidator.getRelationReferences({
          payload: updateBy.data,
          relations: relations,
          projectId: projectId,
          heldIds: heldIds,
        }),
      });
    }

    return { updateBy, carryForward: null };
  }

  /*
   * Every secret each of these monitors may use, keyed by monitor id. Monitors
   * that may use none have no entry.
   *
   * Built for the probe's fetch cycle, which resolves a whole batch of
   * monitors at once, so the number of queries does not grow with the batch:
   * one for the monitors, then one per access mode (the label query only when
   * a monitor in the batch carries a label).
   *
   * The monitors' project and labels are read here rather than taken from the
   * caller: they are what decides access, and a caller holding a half-selected
   * monitor must not be able to widen it.
   */
  @CaptureSpan()
  public async getSecretsForMonitors(data: {
    monitorIds: Array<ObjectID>;
    /*
     * Resolve only for monitors in this project. A monitor test names its
     * monitor by id, and nothing checks that id against the test's own
     * project when the test is written - without this, a test written in one
     * project could run with another project's secrets.
     */
    projectId?: ObjectID | undefined;
  }): Promise<Map<string, Array<MonitorSecret>>> {
    const secretsByMonitorId: Map<string, Array<MonitorSecret>> = new Map();

    if (data.monitorIds.length === 0) {
      return secretsByMonitorId;
    }

    const monitorQuery: Query<Monitor> = {
      _id: QueryHelper.any(data.monitorIds),
    };

    if (data.projectId) {
      monitorQuery.projectId = data.projectId;
    }

    const monitors: Array<Monitor> = await MonitorService.findBy({
      query: monitorQuery,
      select: {
        _id: true,
        projectId: true,
        labels: {
          _id: true,
        },
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const grantees: Array<MonitorSecretGrantee> = [];
    const monitorIds: Array<ObjectID> = [];
    const projectIds: Map<string, ObjectID> = new Map();
    const labelIds: Map<string, ObjectID> = new Map();

    for (const monitor of monitors) {
      if (!monitor.id || !monitor.projectId) {
        continue;
      }

      monitorIds.push(monitor.id);

      const monitorLabelIds: Array<string> = [];

      for (const label of monitor.labels || []) {
        if (label.id) {
          monitorLabelIds.push(label.id.toString());
          labelIds.set(label.id.toString(), label.id);
        }
      }

      projectIds.set(monitor.projectId.toString(), monitor.projectId);

      grantees.push({
        monitorId: monitor.id.toString(),
        projectId: monitor.projectId.toString(),
        labelIds: monitorLabelIds,
      });
    }

    if (grantees.length === 0) {
      return secretsByMonitorId;
    }

    const projectIdList: Array<ObjectID> = Array.from(projectIds.values());

    /*
     * One query per mode, and each secret has exactly one mode, so a secret
     * comes back at most once. Each query asks only for the list its mode
     * reads, and filters on it, so a secret attached to thousands of monitors
     * brings back only the ones in this batch.
     */
    const queries: Array<Promise<Array<MonitorSecret>>> = [
      this.findSecretsForAccess({
        projectIds: projectIdList,
        access: MonitorSecretAccess.AllMonitors,
      }),
      this.findSecretsForAccess({
        projectIds: projectIdList,
        access: MonitorSecretAccess.SpecificMonitors,
        list: "monitors",
        listIds: monitorIds,
      }),
    ];

    if (labelIds.size > 0) {
      queries.push(
        this.findSecretsForAccess({
          projectIds: projectIdList,
          access: MonitorSecretAccess.MonitorsWithLabels,
          list: "labels",
          listIds: Array.from(labelIds.values()),
        }),
      );
    }

    const secrets: Array<MonitorSecret> = (await Promise.all(queries)).flat();

    for (const grantee of grantees) {
      const usable: Array<MonitorSecret> = secrets.filter(
        (secret: MonitorSecret): boolean => {
          return MonitorSecretAccessUtil.canMonitorUseSecret({
            secret: {
              projectId: secret.projectId?.toString(),
              monitorAccess: secret.monitorAccess,
              monitorIds: this.getIds(secret.monitors),
              labelIds: this.getIds(secret.labels),
            },
            monitor: grantee,
          });
        },
      );

      if (usable.length > 0) {
        secretsByMonitorId.set(grantee.monitorId!, this.sortByName(usable));
      }
    }

    return secretsByMonitorId;
  }

  /*
   * The secrets a monitor that is not saved yet may use: a test run from the
   * Create Monitor form. It belongs to the project, so the secrets every
   * monitor in the project may use apply; it is nobody's listed monitor and
   * carries no labels yet, so nothing else does.
   */
  @CaptureSpan()
  public async getSecretsForUnsavedMonitor(data: {
    projectId: ObjectID;
  }): Promise<Array<MonitorSecret>> {
    const secrets: Array<MonitorSecret> = await this.findSecretsForAccess({
      projectIds: [data.projectId],
      access: MonitorSecretAccess.AllMonitors,
    });

    return this.sortByName(
      secrets.filter((secret: MonitorSecret): boolean => {
        return MonitorSecretAccessUtil.canMonitorUseSecret({
          secret: {
            projectId: secret.projectId?.toString(),
            monitorAccess: secret.monitorAccess,
            monitorIds: [],
            labelIds: [],
          },
          monitor: {
            monitorId: undefined,
            projectId: data.projectId.toString(),
            labelIds: [],
          },
        });
      }),
    );
  }

  private async findSecretsForAccess(data: {
    projectIds: Array<ObjectID>;
    access: MonitorSecretAccess;
    list?: MonitorSecretAccessList | undefined;
    listIds?: Array<ObjectID> | undefined;
  }): Promise<Array<MonitorSecret>> {
    const query: Query<MonitorSecret> = {
      projectId: QueryHelper.any(data.projectIds),
      monitorAccess: data.access,
    };

    const select: Select<MonitorSecret> = {
      _id: true,
      name: true,
      secretValue: true,
      secretType: true,
      projectId: true,
      monitorAccess: true,
    };

    if (data.list) {
      (query as Dictionary<unknown>)[data.list] = QueryHelper.inRelationArray(
        data.listIds || [],
      );
      (select as Dictionary<unknown>)[data.list] = {
        _id: true,
      };
    }

    return await this.findBy({
      query: query,
      select: select,
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * A secret's type changes only together with a new value, read for the
   * new type (issue #9760). The value a secret holds means something else
   * in the other type, so the one it held is never read as the new type: a
   * Text secret's password is never made into codes, and a setup key is
   * never filled into a monitor as text, where a check's log could show it.
   * Both are written in the one statement, so no check ever reads the new
   * type with the old value: a monitor that uses the secret takes the new
   * type at its next check, when the server fills its secrets in again.
   *
   * The value is read as it is on create: for One-time code, a setup key or
   * an otpauth://totp link, stored canonically; for Text, any value but an
   * empty one - and never the setup key the secret holds now, which as text
   * would be sent where the code went.
   */
  private async readTypeChange(
    updateBy: UpdateBy<MonitorSecret>,
    data: Dictionary<unknown>,
  ): Promise<void> {
    const secretType: MonitorSecretType = this.readSecretType(
      data["secretType"],
    );

    data["secretType"] = secretType;

    const value: unknown = data["secretValue"];

    if (value === undefined) {
      throw new BadDataException(TYPE_CHANGE_NEEDS_VALUE_MESSAGE);
    }

    if (secretType === MonitorSecretType.TOTP) {
      data["secretValue"] = this.readTotpSecretValue(value);
      return;
    }

    if (typeof value !== "string" || !value.trim()) {
      throw new BadDataException(TYPE_CHANGE_NEEDS_VALUE_MESSAGE);
    }

    const asSetupKey: TotpSecretReading = readTotpSecret(value);

    if (!asSetupKey.parameters) {
      return;
    }

    const rows: Array<MonitorSecret> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        secretType: true,
        secretValue: true,
      },
    );

    for (const row of rows) {
      if (!MonitorSecretTypeUtil.isTotp(row.secretType)) {
        continue;
      }

      const held: TotpSecretReading = readTotpSecret(row.secretValue);

      if (held.parameters?.secret === asSetupKey.parameters.secret) {
        throw new BadDataException(SETUP_KEY_AS_TEXT_MESSAGE);
      }
    }
  }

  private readSecretType(value: unknown): MonitorSecretType {
    if (MonitorSecretTypeUtil.isValid(value)) {
      return value;
    }

    throw new BadDataException(
      `Secret type must be one of: ${MonitorSecretTypeUtil.ALL_TYPES.join(", ")}.`,
    );
  }

  /*
   * A one-time code secret's value as it is stored: the setup key or link
   * read, and written back in the one form the probe reads
   * (writeStoredTotpSecret) - or the reason it cannot be, in a sentence.
   */
  private readTotpSecretValue(value: unknown): string {
    const reading: TotpSecretReading = readTotpSecret(value);

    if (reading.problem) {
      throw new BadDataException(writeTotpSecretProblem(reading.problem));
    }

    return writeStoredTotpSecret(reading.parameters);
  }

  private readMonitorAccess(value: unknown): MonitorSecretAccess {
    if (MonitorSecretAccessUtil.isValid(value)) {
      return value;
    }

    throw new BadDataException(
      `Monitor access must be one of: ${MonitorSecretAccessUtil.ALL_ACCESS_MODES.join(", ")}.`,
    );
  }

  private getIds(items: Array<Monitor | Label> | undefined): Array<string> {
    const ids: Array<string> = [];

    for (const item of items || []) {
      if (item.id) {
        ids.push(item.id.toString());
      }
    }

    return ids;
  }

  private sortByName(secrets: Array<MonitorSecret>): Array<MonitorSecret> {
    return [...secrets].sort((a: MonitorSecret, b: MonitorSecret): number => {
      return (a.name || "").localeCompare(b.name || "");
    });
  }

  /*
   * The two lists whose ids must belong to the secret's project. Built per
   * call rather than at module load: these services sit in an import graph
   * that loops back to this one, and a module-level table would capture
   * whichever of them had not finished loading yet as undefined.
   */
  private getProjectScopedRelations(): Array<ProjectScopedRelation> {
    return [
      {
        column: "monitors",
        modelName: "Monitor",
        service: MonitorService,
      },
      {
        column: "labels",
        modelName: "Label",
        service: LabelService,
      },
    ];
  }
}

export default new Service();
