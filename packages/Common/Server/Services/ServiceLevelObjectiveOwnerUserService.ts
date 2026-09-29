import { ServiceLevelObjectiveFeedEventType } from "../../Models/DatabaseModels/ServiceLevelObjectiveFeed";
import Model from "../../Models/DatabaseModels/ServiceLevelObjectiveOwnerUser";
import User from "../../Models/DatabaseModels/User";
import { Gray500, Red500 } from "../../Types/BrandColors";
import ObjectID from "../../Types/ObjectID";
import { escapeMarkdownInline } from "../../Utils/Markdown/MarkdownEscape";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import logger, { LogAttributes } from "../Utils/Logger";
import SloFeedUtil from "../Utils/Slo/SloFeedUtil";
import SloOwnerReferenceValidator from "../Utils/Slo/SloOwnerReferenceValidator";
import SloRecordReferenceValidator from "../Utils/Slo/SloRecordReferenceValidator";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import DatabaseService from "./DatabaseService";
import ServiceLevelObjectiveFeedService from "./ServiceLevelObjectiveFeedService";
import ServiceLevelObjectiveService from "./ServiceLevelObjectiveService";
import UserService from "./UserService";

const SLO_OWNER_USER_SUBJECT: string = "SLO owner user";

/*
 * Owners are who gets paged when an SLO goes at risk, so who was added and who
 * was removed - and by whom - is part of the SLO's history. Same hooks as
 * ServiceOwnerUserService, with three differences that matter here:
 *
 *   - the SLO and the user are checked against the row's project on create;
 *   - every user-controlled name is escaped, because the feed renders without
 *     safe mode and a name is the user's to set;
 *   - a feed failure is logged, never thrown: these hooks run after the owner
 *     row was already written or deleted, and failing the request then would
 *     report an error for a change that went through.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * DatabaseService stamps the row's projectId from the caller and checks
   * nothing else, so without this an owner row could point at another
   * project's SLO or name a user from outside the project:
   *
   * - a foreign SLO: ServiceLevelObjectiveService.findOwners reads owners by
   *   SLO id alone, so the user would join that SLO's burn rate alerts and
   *   incidents, and SendOwnerAddedNotification would email them its name,
   *   its project's name and its link;
   * - a user outside the project: they would be emailed this project's SLO,
   *   and the feed would print their name - and email, on removal.
   *
   * serviceLevelObjectiveId and userId (and their relations) are create-only -
   * update is [] in their column ACL - so create is the one write to check.
   * Both spellings of each are checked, because the id column and the relation
   * write the same join column. Neither lookup reads anything but ids from
   * outside the project, and neither error names or confirms a foreign SLO or
   * user (see SloRecordReferenceValidator and SloOwnerReferenceValidator).
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    // A root write with no tenant is checked against the row's own project.
    const projectId: ObjectID | undefined =
      createBy.props.tenantId || createBy.data.projectId;

    await SloRecordReferenceValidator.validateServiceLevelObjectivesBelongToProject(
      {
        projectId: projectId,
        serviceLevelObjectives: [
          createBy.data.serviceLevelObjectiveId,
          createBy.data.serviceLevelObjective,
        ],
        subject: SLO_OWNER_USER_SUBJECT,
      },
    );

    await SloOwnerReferenceValidator.validateUsersAreProjectMembers({
      projectId: projectId,
      users: [createBy.data.userId, createBy.data.user],
      subject: SLO_OWNER_USER_SUBJECT,
    });

    return {
      createBy: createBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    /*
     * The rows are gone by the time onDeleteSuccess runs, so the feed item has
     * to be built from what was read here. The read only feeds the feed, so a
     * failure must not block the delete itself. It runs before permissions
     * are applied, hence the tenant pin (see SloFeedUtil).
     */
    let itemsToDelete: Array<Model> = [];

    try {
      itemsToDelete = await this.findBy({
        query: SloFeedUtil.getTenantPinnedQuery({
          query: deleteBy.query,
          tenantId: deleteBy.props.tenantId,
        }),
        limit: deleteBy.limit,
        skip: deleteBy.skip,
        props: {
          isRoot: true,
        },
        select: {
          // Matched against the ids the delete really removed.
          _id: true,
          serviceLevelObjectiveId: true,
          projectId: true,
          userId: true,
        },
      });
    } catch (err) {
      logger.error(
        `Error reading SLO owner users before delete for the SLO feed: ${err}`,
      );
    }

    return {
      carryForward: {
        itemsToDelete: itemsToDelete,
      },
      deleteBy: deleteBy,
    };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    const deletedByUserId: ObjectID | undefined =
      onDelete.deleteBy.deletedByUser?.id || onDelete.deleteBy.props.userId;

    // Only the owners this delete really removed (see SloFeedUtil).
    const itemsToDelete: Array<Model> = SloFeedUtil.getRowsActuallyDeleted({
      rows:
        (onDelete.carryForward?.itemsToDelete as Array<Model> | undefined) ||
        [],
      deletedIds: itemIdsBeforeDelete,
    });

    for (const item of itemsToDelete) {
      const serviceLevelObjectiveId: ObjectID | undefined =
        item.serviceLevelObjectiveId;
      const projectId: ObjectID | undefined = item.projectId;
      const userId: ObjectID | undefined = item.userId;

      if (!serviceLevelObjectiveId || !projectId || !userId) {
        continue;
      }

      try {
        const user: User | null = await UserService.findOneById({
          id: userId,
          select: {
            name: true,
            email: true,
          },
          props: {
            isRoot: true,
          },
        });

        const displayName: string = SloFeedUtil.getUserDisplayName(user);

        if (!user || !displayName) {
          continue;
        }

        const email: string = escapeMarkdownInline(
          user.email?.toString() || "",
        ).trim();

        // The email is only worth repeating when the name is not the email.
        const emailSuffix: string =
          email && email !== displayName ? ` (${email})` : "";

        await ServiceLevelObjectiveFeedService.createServiceLevelObjectiveFeedItem(
          {
            serviceLevelObjectiveId: serviceLevelObjectiveId,
            projectId: projectId,
            serviceLevelObjectiveFeedEventType:
              ServiceLevelObjectiveFeedEventType.OwnerUserRemoved,
            displayColor: Red500,
            feedInfoInMarkdown: `👨🏻‍💻 Removed **${displayName}**${emailSuffix} as an owner of ${await ServiceLevelObjectiveService.getSloMarkdownLink(
              {
                projectId: projectId,
                sloId: serviceLevelObjectiveId,
              },
            )}.`,
            userId: deletedByUserId || undefined,
          },
        );
      } catch (err) {
        logger.error(
          `Error writing the owner-removed feed item for SLO ${serviceLevelObjectiveId.toString()}: ${err}`,
          { projectId: projectId.toString() } as LogAttributes,
        );
      }
    }

    return onDelete;
  }

  @CaptureSpan()
  public override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    const serviceLevelObjectiveId: ObjectID | undefined =
      createdItem.serviceLevelObjectiveId;
    const projectId: ObjectID | undefined = createdItem.projectId;
    const userId: ObjectID | undefined = createdItem.userId;
    const createdByUserId: ObjectID | undefined =
      createdItem.createdByUserId || onCreate.createBy.props.userId;

    if (!serviceLevelObjectiveId || !userId || !projectId) {
      return createdItem;
    }

    try {
      const userMarkdown: string | null = await SloFeedUtil.getUserMarkdown({
        userId: userId,
        projectId: projectId,
      });

      if (!userMarkdown) {
        return createdItem;
      }

      await ServiceLevelObjectiveFeedService.createServiceLevelObjectiveFeedItem(
        {
          serviceLevelObjectiveId: serviceLevelObjectiveId,
          projectId: projectId,
          serviceLevelObjectiveFeedEventType:
            ServiceLevelObjectiveFeedEventType.OwnerUserAdded,
          displayColor: Gray500,
          feedInfoInMarkdown: `👨🏻‍💻 Added **${userMarkdown}** as an owner of ${await ServiceLevelObjectiveService.getSloMarkdownLink(
            {
              projectId: projectId,
              sloId: serviceLevelObjectiveId,
            },
          )}.`,
          userId: createdByUserId || undefined,
        },
      );
    } catch (err) {
      logger.error(
        `Error writing the owner-added feed item for SLO ${serviceLevelObjectiveId.toString()}: ${err}`,
        { projectId: projectId.toString() } as LogAttributes,
      );
    }

    return createdItem;
  }
}

export default new Service();
