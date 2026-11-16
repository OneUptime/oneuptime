import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import ProjectReferencesService from "./ProjectReferencesService";
import ProjectService from "./ProjectService";
import IncomingRequestSecretPolicy from "../Utils/Monitor/IncomingRequestSecretPolicy";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import Dictionary from "../../Types/Dictionary";
import BadDataException from "../../Types/Exception/BadDataException";
import IncomingRequestSecretRules, {
  INCOMING_REQUEST_SECRET_DEFAULT_ACCESS,
  IncomingRequestSecretValueProblem,
} from "../../Types/Monitor/IncomingMonitor/IncomingRequestSecret";
import MonitorSecretAccess, {
  MonitorSecretAccessUtil,
} from "../../Types/Monitor/MonitorSecretAccess";
import ObjectID from "../../Types/ObjectID";
import Label from "../../Models/DatabaseModels/Label";
import Monitor from "../../Models/DatabaseModels/Monitor";
import Project from "../../Models/DatabaseModels/Project";
import Model from "../../Models/DatabaseModels/IncomingRequestSecret";
import { randomBytes } from "crypto";

/*
 * A project's incoming request secrets (IncomingRequestSecret, issue #7526).
 *
 *   - A secret left empty is generated: 32 random bytes, as 64 hex
 *     characters - header-safe, shell-safe and far past guessing. One
 *     someone typed is held to IncomingRequestSecretRules, the rules the
 *     Dashboard shows, and kept trimmed, as it is compared.
 *   - A secret covers every Incoming Request monitor of the project, or the
 *     ones it is limited to (monitorAccess, issue #8501): a write of the mode
 *     empties the list the mode does not read, as monitor secrets do, and
 *     every monitor and label it names must be the project's
 *     (ProjectReferencesService).
 *   - While the project requires a secret, it keeps at least one secret that
 *     covers a monitor: one for all monitors, or one limited to some that
 *     names at least one monitor or label. Neither deleting secrets nor
 *     limiting one may leave it with none - every request to its monitors
 *     would be refused at once. Turn the requirement off first, or create
 *     another secret.
 *   - Every change forgets the project's cached policy
 *     (IncomingRequestSecretPolicy), so the next request is judged by it.
 *
 * Two people changing a project's last covering secrets in the same instant
 * could both pass the check; the project then refuses every request until
 * one is fixed, which is what it would do anyway - it is still the owners'
 * setting, not a hole.
 */

export const LAST_INCOMING_REQUEST_SECRET_MESSAGE: string =
  'This is the project\'s last incoming request secret that covers a monitor, and the project requires one on every incoming request, so deleting it would refuse every request to its Incoming Request monitors. Create another secret first, or turn off "Require a secret on every request".';

export const LAST_COVERING_INCOMING_REQUEST_SECRET_MESSAGE: string =
  'This change would leave the project with no incoming request secret that covers a monitor, and the project requires one on every incoming request, so every request to its Incoming Request monitors would be refused. Keep a secret for all monitors or for some, or turn off "Require a secret on every request" first.';

export const NO_INCOMING_REQUEST_SECRET_TO_REQUIRE_MESSAGE: string =
  "This project has no incoming request secret yet, so requiring one would refuse every request to its Incoming Request monitors. Create a secret, send it from your senders, then turn this on.";

export const NO_COVERING_INCOMING_REQUEST_SECRET_MESSAGE: string =
  "None of this project's incoming request secrets covers a monitor yet, so requiring one would refuse every request to its Incoming Request monitors. Give a secret the monitors or labels it is for, or create one for all monitors, then turn this on.";

export const GENERATED_SECRET_BYTES: number = 32;

// What decides whether a secret covers a monitor: its mode and its lists.
export interface IncomingRequestSecretCoverage {
  secretId: string;
  monitorAccess: string | undefined;
  monitorIds: Array<string>;
  labelIds: Array<string>;
}

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  // A strong secret, for one left empty.
  public static generateSecretValue(): string {
    return randomBytes(GENERATED_SECRET_BYTES).toString("hex");
  }

  /*
   * Whether a secret covers some monitor: every monitor, or a limited one
   * that names at least one monitor or label. A mode nobody knows covers
   * nothing, as MonitorSecretAccessUtil grants nothing for one.
   */
  public static coversSomeMonitor(
    secret: Pick<
      IncomingRequestSecretCoverage,
      "monitorAccess" | "monitorIds" | "labelIds"
    >,
  ): boolean {
    switch (secret.monitorAccess) {
      case MonitorSecretAccess.AllMonitors:
        return true;
      case MonitorSecretAccess.SpecificMonitors:
        return secret.monitorIds.length > 0;
      case MonitorSecretAccess.MonitorsWithLabels:
        return secret.labelIds.length > 0;
      default:
        return false;
    }
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    const typed: unknown = createBy.data.secretValue;

    if (typed === undefined || typed === null || String(typed).trim() === "") {
      createBy.data.secretValue = Service.generateSecretValue();
    } else {
      const value: string = String(typed).trim();

      const problem: IncomingRequestSecretValueProblem | null =
        IncomingRequestSecretRules.getValueProblem(value);

      if (problem) {
        throw new BadDataException(
          IncomingRequestSecretRules.getValueProblemMessage(problem),
        );
      }

      createBy.data.secretValue = value;
    }

    if (typeof createBy.data.name === "string") {
      createBy.data.name = createBy.data.name.trim();
    }

    /*
     * A new secret always gets a mode: the one asked for, or All Monitors -
     * what a client that never heard of the column means. Nothing is stored
     * yet, so a list the mode will never read is dropped.
     */
    const requested: unknown = createBy.data.monitorAccess;

    const access: MonitorSecretAccess =
      requested === undefined || requested === null
        ? INCOMING_REQUEST_SECRET_DEFAULT_ACCESS
        : Service.readMonitorAccess(requested);

    createBy.data.monitorAccess = access;

    for (const list of MonitorSecretAccessUtil.getListsUnusedBy(access)) {
      (createBy.data as unknown as Dictionary<unknown>)[list] = undefined;
    }

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    const projectId: ObjectID | undefined =
      createdItem.projectId ||
      onCreate.createBy.data.projectId ||
      onCreate.createBy.props.tenantId ||
      undefined;

    if (projectId) {
      await IncomingRequestSecretPolicy.forget(projectId);
    }

    return createdItem;
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    if (typeof updateBy.data.name === "string") {
      updateBy.data.name = updateBy.data.name.trim();
    }

    const data: Dictionary<unknown> = updateBy.data as Dictionary<unknown>;

    /*
     * Writing the mode empties the lists it does not read, so a secret never
     * keeps an old list that a later switch back would quietly bring into
     * force again. A write without the mode leaves the lists alone.
     */
    if (data["monitorAccess"] !== undefined) {
      const access: MonitorSecretAccess = Service.readMonitorAccess(
        data["monitorAccess"],
      );

      data["monitorAccess"] = access;

      for (const list of MonitorSecretAccessUtil.getListsUnusedBy(access)) {
        data[list] = [];
      }
    }

    const changesCoverage: boolean =
      data["monitorAccess"] !== undefined ||
      data["monitors"] !== undefined ||
      data["labels"] !== undefined;

    const secrets: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      changesCoverage
        ? {
            _id: true,
            projectId: true,
            monitorAccess: true,
            monitors: { _id: true },
            labels: { _id: true },
          }
        : {
            _id: true,
            projectId: true,
          },
    );

    if (changesCoverage) {
      await this.assertUpdateKeepsACoveringSecret({
        data: data,
        secrets: secrets,
      });
    }

    // A rename changes no policy, but costs nothing to forget.
    return { updateBy, carryForward: Service.getProjectIds(secrets) };
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    _updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    await Service.forgetPolicies(onUpdate.carryForward);

    return onUpdate;
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    await super.onBeforeDelete(deleteBy);

    const secrets: Array<Model> = await this.findRowsAndHoldDeleteToThem(
      deleteBy,
      {
        _id: true,
        projectId: true,
      },
    );

    const projectIds: Array<string> = Service.getProjectIds(secrets);

    for (const projectId of projectIds) {
      await this.assertNotLastSecretOfRequiringProject({
        projectId: new ObjectID(projectId),
        deletedSecretIds: secrets
          .filter((secret: Model): boolean => {
            return secret.projectId?.toString() === projectId;
          })
          .map((secret: Model): string => {
            return secret.id!.toString();
          }),
      });
    }

    return { deleteBy, carryForward: projectIds };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    await Service.forgetPolicies(onDelete.carryForward);

    return onDelete;
  }

  // How many secrets the project has: one is needed to require them.
  public async countSecretsOfProject(projectId: ObjectID): Promise<number> {
    const count: number = (
      await this.countBy({
        query: {
          projectId: projectId,
        },
        props: {
          isRoot: true,
        },
      })
    ).toNumber();

    return count;
  }

  // What decides which monitors each of the project's secrets covers.
  public async getCoverageOfProject(
    projectId: ObjectID,
  ): Promise<Array<IncomingRequestSecretCoverage>> {
    const secrets: Array<Model> = await this.findBy({
      query: {
        projectId: projectId,
      },
      select: {
        _id: true,
        monitorAccess: true,
        monitors: { _id: true },
        labels: { _id: true },
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    return secrets
      .filter((secret: Model): boolean => {
        return Boolean(secret.id);
      })
      .map((secret: Model): IncomingRequestSecretCoverage => {
        return Service.toCoverage(secret);
      });
  }

  /*
   * How many of the project's secrets cover some monitor
   * (coversSomeMonitor): at least one is needed to require them.
   */
  public async countCoveringSecretsOfProject(
    projectId: ObjectID,
  ): Promise<number> {
    return (await this.getCoverageOfProject(projectId)).filter(
      (secret: IncomingRequestSecretCoverage): boolean => {
        return Service.coversSomeMonitor(secret);
      },
    ).length;
  }

  public static toCoverage(secret: Model): IncomingRequestSecretCoverage {
    return {
      secretId: secret.id?.toString() || "",
      monitorAccess:
        secret.monitorAccess || INCOMING_REQUEST_SECRET_DEFAULT_ACCESS,
      monitorIds: Service.getIds(secret.monitors),
      labelIds: Service.getIds(secret.labels),
    };
  }

  public static readMonitorAccess(value: unknown): MonitorSecretAccess {
    if (MonitorSecretAccessUtil.isValid(value)) {
      return value;
    }

    throw new BadDataException(
      `Which monitors can use an incoming request secret must be one of: ${MonitorSecretAccessUtil.ALL_ACCESS_MODES.join(", ")}.`,
    );
  }

  private async isRequiredByProject(projectId: ObjectID): Promise<boolean> {
    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: {
        requireIncomingRequestSecret: true,
      },
      props: {
        isRoot: true,
      },
    });

    return Boolean(project?.requireIncomingRequestSecret);
  }

  private async assertNotLastSecretOfRequiringProject(data: {
    projectId: ObjectID;
    deletedSecretIds: Array<string>;
  }): Promise<void> {
    if (!(await this.isRequiredByProject(data.projectId))) {
      return;
    }

    const deleted: Set<string> = new Set<string>(
      data.deletedSecretIds.map((id: string): string => {
        return id.toLowerCase();
      }),
    );

    const remaining: Array<IncomingRequestSecretCoverage> = (
      await this.getCoverageOfProject(data.projectId)
    ).filter((secret: IncomingRequestSecretCoverage): boolean => {
      return !deleted.has(secret.secretId.toLowerCase());
    });

    if (
      !remaining.some((secret: IncomingRequestSecretCoverage): boolean => {
        return Service.coversSomeMonitor(secret);
      })
    ) {
      throw new BadDataException(LAST_INCOMING_REQUEST_SECRET_MESSAGE);
    }
  }

  /*
   * An update that changes which monitors secrets cover, in a project that
   * requires a secret, must leave one that covers some monitor: each secret
   * it writes is judged as it will be once written - its new mode, the list
   * the update gives it, or the one it has (a list the new mode does not
   * read was emptied above).
   */
  private async assertUpdateKeepsACoveringSecret(data: {
    data: Dictionary<unknown>;
    secrets: Array<Model>;
  }): Promise<void> {
    for (const projectId of Service.getProjectIds(data.secrets)) {
      if (!(await this.isRequiredByProject(new ObjectID(projectId)))) {
        continue;
      }

      const updated: Map<string, IncomingRequestSecretCoverage> = new Map();

      for (const secret of data.secrets) {
        if (secret.projectId?.toString() !== projectId || !secret.id) {
          continue;
        }

        const current: IncomingRequestSecretCoverage =
          Service.toCoverage(secret);

        updated.set(current.secretId.toLowerCase(), {
          secretId: current.secretId,
          monitorAccess:
            (data.data["monitorAccess"] as string | undefined) ||
            current.monitorAccess,
          monitorIds:
            data.data["monitors"] !== undefined
              ? Service.getWrittenIds(data.data["monitors"])
              : current.monitorIds,
          labelIds:
            data.data["labels"] !== undefined
              ? Service.getWrittenIds(data.data["labels"])
              : current.labelIds,
        });
      }

      const after: Array<IncomingRequestSecretCoverage> = (
        await this.getCoverageOfProject(new ObjectID(projectId))
      ).map(
        (
          secret: IncomingRequestSecretCoverage,
        ): IncomingRequestSecretCoverage => {
          return updated.get(secret.secretId.toLowerCase()) || secret;
        },
      );

      if (
        !after.some((secret: IncomingRequestSecretCoverage): boolean => {
          return Service.coversSomeMonitor(secret);
        })
      ) {
        throw new BadDataException(
          LAST_COVERING_INCOMING_REQUEST_SECRET_MESSAGE,
        );
      }
    }
  }

  private static getIds(
    items: Array<Monitor | Label> | undefined,
  ): Array<string> {
    const ids: Array<string> = [];

    for (const item of items || []) {
      if (item.id) {
        ids.push(item.id.toString());
      }
    }

    return ids;
  }

  // The ids a write gives a list: models, objects with an _id, or ids.
  private static getWrittenIds(value: unknown): Array<string> {
    if (!Array.isArray(value)) {
      return [];
    }

    const ids: Array<string> = [];

    for (const item of value) {
      const id: unknown =
        typeof item === "string" || item instanceof ObjectID
          ? item
          : (item as Dictionary<unknown> | null)?.["_id"] ||
            (item as Dictionary<unknown> | null)?.["id"];

      if (id) {
        ids.push(id.toString());
      }
    }

    return ids;
  }

  private static getProjectIds(secrets: Array<Model>): Array<string> {
    return Array.from(
      new Set<string>(
        secrets
          .map((secret: Model): string => {
            return secret.projectId?.toString() || "";
          })
          .filter(Boolean),
      ),
    );
  }

  private static async forgetPolicies(projectIds: unknown): Promise<void> {
    if (!Array.isArray(projectIds)) {
      return;
    }

    for (const projectId of projectIds) {
      if (typeof projectId === "string" && projectId) {
        await IncomingRequestSecretPolicy.forget(projectId);
      }
    }
  }
}

export default new Service();
