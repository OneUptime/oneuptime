import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import ProjectService from "./ProjectService";
import IncomingRequestSecretPolicy from "../Utils/Monitor/IncomingRequestSecretPolicy";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import BadDataException from "../../Types/Exception/BadDataException";
import IncomingRequestSecretRules, {
  IncomingRequestSecretValueProblem,
} from "../../Types/Monitor/IncomingMonitor/IncomingRequestSecret";
import ObjectID from "../../Types/ObjectID";
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
 *   - The last secret of a project that requires one cannot be deleted:
 *     every request to its monitors would be refused at once. Turn the
 *     requirement off first, or create another secret.
 *   - Every change forgets the project's cached policy
 *     (IncomingRequestSecretPolicy), so the next request is judged by it.
 *
 * Two owners deleting a project's last two secrets in the same instant
 * could both pass the check; the project then refuses every request until
 * one is created, which is what it would do anyway - it is still the
 * owners' setting, not a hole.
 */

export const LAST_INCOMING_REQUEST_SECRET_MESSAGE: string =
  'This is the project\'s last incoming request secret, and the project requires one on every incoming request, so deleting it would refuse every request to its Incoming Request monitors. Create another secret first, or turn off "Require a secret on every request".';

export const NO_INCOMING_REQUEST_SECRET_TO_REQUIRE_MESSAGE: string =
  "This project has no incoming request secret yet, so requiring one would refuse every request to its Incoming Request monitors. Create a secret, send it from your senders, then turn this on.";

export const GENERATED_SECRET_BYTES: number = 32;

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  // A strong secret, for one left empty.
  public static generateSecretValue(): string {
    return randomBytes(GENERATED_SECRET_BYTES).toString("hex");
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

    // A rename changes no policy, but costs nothing to forget.
    const secrets: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        projectId: true,
      },
    );

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

  private async assertNotLastSecretOfRequiringProject(data: {
    projectId: ObjectID;
    deletedSecretIds: Array<string>;
  }): Promise<void> {
    const project: Project | null = await ProjectService.findOneById({
      id: data.projectId,
      select: {
        requireIncomingRequestSecret: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!project?.requireIncomingRequestSecret) {
      return;
    }

    const count: number = await this.countSecretsOfProject(data.projectId);

    if (count - data.deletedSecretIds.length < 1) {
      throw new BadDataException(LAST_INCOMING_REQUEST_SECRET_MESSAGE);
    }
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
