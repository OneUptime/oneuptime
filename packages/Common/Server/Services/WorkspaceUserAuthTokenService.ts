import ObjectID from "../../Types/ObjectID";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import DatabaseService from "./DatabaseService";
import UserSlackService from "./UserSlackService";
import UserMicrosoftTeamsService from "./UserMicrosoftTeamsService";
import CountBy from "../Types/Database/CountBy";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import FindBy from "../Types/Database/FindBy";
import Query from "../Types/Database/Query";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnFind, OnUpdate } from "../Types/Database/Hooks";
import Model, {
  SlackMiscData,
} from "../../Models/DatabaseModels/WorkspaceUserAuthToken";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import QueryHelper from "../Types/Database/QueryHelper";
import logger from "../Utils/Logger";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import PositiveNumber from "../../Types/PositiveNumber";

// What removeLinksNotMadeBySignIn removed.
export interface LinksNotMadeBySignInCleanupResult {
  // Links a person wrote through the API, removed.
  removedLinkCount: number;
  // Slack notification methods that pointed at one of them, removed.
  removedSlackMethodCount: number;
  // Microsoft Teams notification methods that pointed at one of them, removed.
  removedMicrosoftTeamsMethodCount: number;
  // Links that could not be removed, each logged.
  failedLinkCount: number;
}

export class Service extends DatabaseService<Model> {
  // How many links removeLinksNotMadeBySignIn reads at a time.
  public static readonly CLEANUP_BATCH_SIZE: number = 100;

  // What a write of a link by anybody but the sign-ins is refused with.
  public static readonly WRITTEN_BY_SIGN_IN_ONLY_MESSAGE: string =
    "A Slack or Microsoft Teams account is connected only by signing in to it, under User Settings > Workspace.";

  public constructor() {
    super(Model);
  }

  /*
   * Only the sign-ins write a link - as OneUptime (refreshAuthToken), once
   * the chat has said which account signed in. The model's permissions keep
   * out every caller of the API; this keeps out whoever they do not hold to
   * (a server admin), and any later code that would write one as a person.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.props.isRoot) {
      throw new NotAuthorizedException(Service.WRITTEN_BY_SIGN_IN_ONLY_MESSAGE);
    }

    return { createBy, carryForward: null };
  }

  // Nor does anybody but a sign-in point a link at another account.
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    if (!updateBy.props.isRoot) {
      throw new NotAuthorizedException(Service.WRITTEN_BY_SIGN_IN_ONLY_MESSAGE);
    }

    return { updateBy, carryForward: null };
  }

  /*
   * A link counts only if a sign-in wrote it, so a read finds no other.
   *
   * One that names a creator was typed in through the API, when the API
   * still wrote links. The one-time cleanup removes those
   * (removeLinksNotMadeBySignIn), but one can outlive it: written by a
   * server still running the old version while an upgrade rolls out, after
   * the cleanup ran, or one the cleanup could not remove. Every read leaves
   * them out - who a press, a command or a reaction acts as, whom a direct
   * message or a channel invitation goes to, what a notification method is
   * made from, what a member sees as connected - so such an account is
   * nobody's, and is asked to connect. A read that asks about the creator
   * itself, as the cleanup's do, is left as it asks.
   */
  public static onlyLinksMadeBySignIn(
    query: Query<Model> | undefined,
  ): Query<Model> {
    const asked: Query<Model> = query || ({} as Query<Model>);

    if (
      Object.prototype.hasOwnProperty.call(asked, "createdByUserId") ||
      Object.prototype.hasOwnProperty.call(asked, "createdByUser")
    ) {
      return asked;
    }

    return {
      ...asked,
      createdByUserId: QueryHelper.isNull(),
    } as Query<Model>;
  }

  @CaptureSpan()
  protected override async onBeforeFind(
    findBy: FindBy<Model>,
  ): Promise<OnFind<Model>> {
    findBy.query = Service.onlyLinksMadeBySignIn(findBy.query);

    return { findBy, carryForward: null };
  }

  // Counted as they are read.
  @CaptureSpan()
  public override async countBy(
    countBy: CountBy<Model>,
  ): Promise<PositiveNumber> {
    return await super.countBy({
      ...countBy,
      query: Service.onlyLinksMadeBySignIn(countBy.query),
    });
  }

  /*
   * Who installs the Slack app is linked with no token of their own: the
   * app asks for no user scopes, so Slack's install names them
   * (authed_user.id) and gives no user token - OneUptime acts with the
   * project's bot token and their Slack user id. The required-column check
   * reads "" as missing, and would refuse that link, failing the install.
   * An empty token is a value of it; anything else is read as the check
   * reads it.
   */
  protected override isRequiredColumnValueGiven(
    column: string,
    value: unknown,
  ): boolean {
    if (column === "authToken" && typeof value === "string") {
      return true;
    }

    return super.isRequiredColumnValueGiven(column, value);
  }

  /*
   * A UserSlack / UserMicrosoftTeams notification method is a pointer at the
   * workspace link being deleted here, so it goes down with it (which also
   * deletes the notification rules routing to it, via that service's own
   * delete hook). Leaving the method row behind would be worse than deleting
   * it: a rule pointing at a dead link fails with an error row and no re-page,
   * while a user with NO matching rule is rescued by the verified-method
   * fallback.
   */
  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    // The tokens the delete removes, and the delete held to them.
    const itemsToDelete: Array<Model> = await this.findRowsAndHoldDeleteToThem(
      deleteBy,
      {
        _id: true,
        projectId: true,
        userId: true,
        workspaceType: true,
      },
    );

    for (const item of itemsToDelete) {
      if (!item.projectId || !item.userId) {
        continue;
      }

      if (item.workspaceType === WorkspaceType.Slack) {
        await UserSlackService.deleteBy({
          query: {
            projectId: item.projectId,
            userId: item.userId,
          },
          limit: LIMIT_MAX,
          skip: 0,
          props: {
            isRoot: true,
          },
        });
      }

      if (item.workspaceType === WorkspaceType.MicrosoftTeams) {
        await UserMicrosoftTeamsService.deleteBy({
          query: {
            projectId: item.projectId,
            userId: item.userId,
          },
          limit: LIMIT_MAX,
          skip: 0,
          props: {
            isRoot: true,
          },
        });
      }
    }

    return {
      deleteBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  public async getUserAuth(data: {
    projectId: ObjectID;
    userId: ObjectID;
    workspaceType: WorkspaceType;
  }): Promise<Model | null> {
    return await this.findOneBy({
      query: {
        userId: data.userId,
        projectId: data.projectId,
        workspaceType: data.workspaceType,
      },
      select: {
        authToken: true,
        workspaceUserId: true,
        miscData: true,
        workspaceType: true,
      },
      props: {
        isRoot: true,
      },
    });
  }

  @CaptureSpan()
  public async doesExist(data: {
    projectId: ObjectID;
    userId: ObjectID;
    workspaceType: WorkspaceType;
  }): Promise<boolean> {
    return (
      (
        await this.countBy({
          query: {
            projectId: data.projectId,
            userId: data.userId,
            workspaceType: data.workspaceType,
          },
          skip: 0,
          limit: 1,
          props: {
            isRoot: true,
          },
        })
      ).toNumber() > 0
    );
  }

  @CaptureSpan()
  public async refreshAuthToken(data: {
    projectId: ObjectID;
    userId: ObjectID;
    workspaceType: WorkspaceType;
    authToken: string;
    workspaceUserId: string;
    miscData: SlackMiscData;
  }): Promise<void> {
    let userAuth: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
        userId: data.userId,
        workspaceType: data.workspaceType,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!userAuth) {
      userAuth = new Model();

      userAuth.projectId = data.projectId;
      userAuth.userId = data.userId;
      userAuth.authToken = data.authToken;
      userAuth.workspaceType = data.workspaceType;
      userAuth.workspaceUserId = data.workspaceUserId;
      userAuth.miscData = data.miscData;

      await this.create({
        data: userAuth,
        props: {
          isRoot: true,
        },
      });
    } else {
      await this.updateOneById({
        id: userAuth.id!,
        data: {
          authToken: data.authToken,
          workspaceUserId: data.workspaceUserId,
          miscData: data.miscData,
        },
        props: {
          isRoot: true,
        },
      });
    }
  }

  /*
   * Removes every link no sign-in wrote, with the Slack and Microsoft Teams
   * notification methods that were made from one.
   *
   * A sign-in writes its link as OneUptime (refreshAuthToken), so the link
   * names no creator. One that names a creator was written by a person
   * through the API, which let anybody signed in write one - for an account
   * they never signed in to, and before ownership was checked on create, for
   * another member - until only the sign-ins could. Such a link proves
   * nothing about who holds the chat account, yet the chat acted on it.
   *
   * Each link goes on its own, without the delete hook: the hook removes
   * all of its member's methods in the project, and the member such a link
   * names may hold a method of their own, made from their own sign-in. Only
   * the methods that point at the removed link's chat account go, through
   * their own delete, which removes the notification rules that use them -
   * unless a sign-in connected the member to that same account too.
   *
   * Idempotent, and safe to run twice at once: it removes only links that
   * name a creator, which nothing writes any more. A link that cannot be
   * removed is logged and counted, and the rest go on.
   */
  @CaptureSpan()
  public async removeLinksNotMadeBySignIn(): Promise<LinksNotMadeBySignInCleanupResult> {
    const result: LinksNotMadeBySignInCleanupResult = {
      removedLinkCount: 0,
      removedSlackMethodCount: 0,
      removedMicrosoftTeamsMethodCount: 0,
      failedLinkCount: 0,
    };

    /*
     * Links that could not be removed, left out of the next read: every
     * read then returns links not tried yet, or none, and the walk ends.
     */
    const failedLinkIds: Array<string> = [];

    for (;;) {
      const links: Array<Model> = await this.findBy({
        query: {
          createdByUserId: QueryHelper.notNull(),
          _id: QueryHelper.notIn(failedLinkIds),
        },
        select: {
          _id: true,
          projectId: true,
          userId: true,
          workspaceType: true,
          workspaceUserId: true,
        },
        skip: 0,
        limit: Service.CLEANUP_BATCH_SIZE,
        props: {
          isRoot: true,
        },
      });

      const readLinks: Array<Model> = links.filter((link: Model): boolean => {
        return Boolean(link.id);
      });

      if (readLinks.length === 0) {
        return result;
      }

      for (const link of readLinks) {
        try {
          const removedMethods: {
            slack: number;
            microsoftTeams: number;
          } = await this.removeLinkNotMadeBySignIn(link);

          result.removedLinkCount++;
          result.removedSlackMethodCount += removedMethods.slack;
          result.removedMicrosoftTeamsMethodCount +=
            removedMethods.microsoftTeams;
        } catch (err) {
          failedLinkIds.push(link.id!.toString());
          result.failedLinkCount++;
          logger.error(
            `Could not remove the chat account link ${link.id!.toString()}, which no sign-in wrote.`,
          );
          logger.error(err);
        }
      }
    }
  }

  // One link no sign-in wrote, and the methods made from it.
  private async removeLinkNotMadeBySignIn(
    link: Model,
  ): Promise<{ slack: number; microsoftTeams: number }> {
    const deletedLinkCount: number = await this.deleteBy({
      query: {
        _id: link.id!,
      },
      limit: 1,
      skip: 0,
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    /*
     * A delete that removed nothing either lost a race to another run of
     * this walk, which removed the link first, or failed - and a link it
     * left would be read again. Asked as what it is, a link that names a
     * creator: a read leaves those out unless it asks about the creator.
     */
    if (
      deletedLinkCount === 0 &&
      (
        await this.countBy({
          query: {
            _id: link.id!,
            createdByUserId: QueryHelper.notNull(),
          },
          skip: 0,
          limit: 1,
          props: {
            isRoot: true,
          },
        })
      ).toNumber() > 0
    ) {
      throw new BadDataException(
        `The chat account link ${link.id!.toString()} was not removed.`,
      );
    }

    const removed: { slack: number; microsoftTeams: number } = {
      slack: 0,
      microsoftTeams: 0,
    };

    if (!link.projectId || !link.userId || !link.workspaceUserId) {
      return removed;
    }

    // A sign-in connected the member to this same account: its methods stay.
    const isAccountSignedInTo: boolean =
      (
        await this.countBy({
          query: {
            projectId: link.projectId,
            userId: link.userId,
            workspaceType: link.workspaceType!,
            workspaceUserId: link.workspaceUserId,
            createdByUserId: QueryHelper.isNull(),
          },
          skip: 0,
          limit: 1,
          props: {
            isRoot: true,
          },
        })
      ).toNumber() > 0;

    if (isAccountSignedInTo) {
      return removed;
    }

    if (link.workspaceType === WorkspaceType.Slack) {
      removed.slack = await UserSlackService.deleteBy({
        query: {
          projectId: link.projectId,
          userId: link.userId,
          slackUserId: link.workspaceUserId,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });
    }

    if (link.workspaceType === WorkspaceType.MicrosoftTeams) {
      removed.microsoftTeams = await UserMicrosoftTeamsService.deleteBy({
        query: {
          projectId: link.projectId,
          userId: link.userId,
          microsoftTeamsUserId: link.workspaceUserId,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });
    }

    return removed;
  }
}
export default new Service();
