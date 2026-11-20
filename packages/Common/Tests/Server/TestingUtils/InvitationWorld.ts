import { jest } from "@jest/globals";
import EmailVerificationToken from "../../../Models/DatabaseModels/EmailVerificationToken";
import Project from "../../../Models/DatabaseModels/Project";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import Semaphore, {
  SemaphoreMutex,
} from "../../../Server/Infrastructure/Semaphore";
import ServerSendingStatus from "../../../Server/Utils/ServerSending/ServerSendingStatus";
import EmailVerificationTokenService from "../../../Server/Services/EmailVerificationTokenService";
import MailService from "../../../Server/Services/MailService";
import ProjectSCIMService from "../../../Server/Services/ProjectSCIMService";
import ProjectService from "../../../Server/Services/ProjectService";
import TeamMemberService, {
  TeamMemberService as TeamMemberServiceClass,
} from "../../../Server/Services/TeamMemberService";
import TeamPermissionService from "../../../Server/Services/TeamPermissionService";
import TeamService from "../../../Server/Services/TeamService";
import UserNotificationSettingService from "../../../Server/Services/UserNotificationSettingService";
import UserService from "../../../Server/Services/UserService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import {
  OnCreate,
  OnDelete,
  OnUpdate,
} from "../../../Server/Types/Database/Hooks";
import ProductAnalytics from "../../../Server/Utils/ProductAnalytics";
import InvitationInviterUtil, {
  InvitationInviter,
} from "../../../Server/Utils/TeamMember/InvitationInviter";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "../../../Types/Email";
import EmailMessage from "../../../Types/Email/EmailMessage";
import Exception from "../../../Types/Exception/Exception";
import HashedString from "../../../Types/HashedString";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { stubProjectDirectory } from "./ProjectDirectory";

/*
 * THE ACCOUNTS AND MEMBERSHIPS AN INVITATION READS AND WRITES, IN MEMORY.
 *
 * TeamMemberService's invitation path - onBeforeCreate, the INSERT,
 * onCreateSuccess and onCreateError, as DatabaseService runs them, and the
 * invitation it sends after the request (#10180) - driven for real, with
 * the database stood in for: accounts by address, memberships, teams, the
 * registration tokens minted and the emails sent. Accepting (onUpdateSuccess)
 * and declining or removing (onDeleteSuccess) run their hooks too, with the
 * rest of what they do stood in for.
 *
 * Every read and write the path makes through the stood-in services goes
 * into `calls`, in order, by service and method, with a mark where the
 * request answers (REQUEST_ANSWERED): a suite holds two invitations to the
 * same work before the answer that way. `readDelayMs` slows every read and
 * write down, to time two invitations against each other.
 */

export const REQUEST_ANSWERED: string = "-- the request answers --";

export interface WorldAccount {
  id: ObjectID;
  email: string;
  // Set once someone has signed up to it (a password, or SCIM's random one).
  password: string | null;
  name: string | null;
  language: string | null;
}

export interface WorldMembership {
  id: ObjectID;
  projectId: ObjectID;
  teamId: ObjectID;
  userId: ObjectID;
  hasAcceptedInvitation: boolean;
  inviteeName: string | null;
}

export const PROJECT_NAME: string = "Acme Production";

const idOf: (value: unknown) => string = (value: unknown): string => {
  return String(value).toLowerCase();
};

export default class InvitationWorld {
  public accounts: Array<WorldAccount> = [];
  public memberships: Array<WorldMembership> = [];
  public calls: Array<string> = [];
  public readDelayMs: number = 0;
  // How long the last create took to answer, in milliseconds.
  public lastRequestMs: number = 0;
  public tokensMinted: Array<EmailVerificationToken> = [];
  public mails: Array<EmailMessage> = [];
  // What the mail service answers: sent, or refused.
  public mailAnswer: "sent" | "refused" = "sent";
  // Who the request names as having invited them, for the email.
  public inviterName: string | null = null;

  public install(): void {
    stubProjectDirectory({});

    this.spy(TeamService, "findOneBy", "TeamService", async () => {
      return new Team(ObjectID.generate());
    });
    this.spy(
      TeamPermissionService,
      "assertCanGrantTeamPermissions",
      "TeamPermissionService",
      async () => {
        return undefined;
      },
    );
    this.spy(ProjectSCIMService, "countBy", "ProjectSCIMService", async () => {
      return new PositiveNumber(0);
    });
    this.spy(ProjectService, "findOneById", "ProjectService", async () => {
      return { name: PROJECT_NAME } as Project;
    });

    jest
      .spyOn(DatabaseConfig, "getHost")
      .mockResolvedValue(new Hostname("oneuptime.test"));
    jest
      .spyOn(DatabaseConfig, "getHttpProtocol")
      .mockResolvedValue(Protocol.HTTPS);
    jest
      .spyOn(InvitationInviterUtil, "read")
      .mockImplementation(async (): Promise<InvitationInviter | null> => {
        return this.inviterName
          ? { name: this.inviterName, email: "inviter@acme.test" }
          : null;
      });
    jest
      .spyOn(TeamMemberServiceClass, "readInvitationSsoManagedBy")
      .mockResolvedValue(null);

    // The accounts.
    this.spy(UserService, "findOneBy", "UserService", async (args: unknown) => {
      const email: string = idOf(
        (args as { query: { email: unknown } }).query.email,
      );
      const account: WorldAccount | undefined = this.accounts.find(
        (item: WorldAccount): boolean => {
          return item.email === email;
        },
      );

      return account ? this.toUser(account) : null;
    });
    this.spy(
      UserService,
      "findOneById",
      "UserService",
      async (args: unknown) => {
        const account: WorldAccount | undefined = this.accountById(
          (args as { id: unknown }).id,
        );

        return account ? this.toUser(account) : null;
      },
    );
    this.spy(
      UserService,
      "createByEmail",
      "UserService",
      async (args: unknown) => {
        const data: { email: Email; name?: Name | undefined } = args as {
          email: Email;
          name?: Name | undefined;
        };
        const account: WorldAccount = {
          id: ObjectID.generate(),
          email: idOf(data.email),
          password: null,
          name: data.name?.toString() || null,
          language: null,
        };

        this.accounts.push(account);

        return this.toUser(account);
      },
    );
    this.spy(
      UserService,
      "updateOneById",
      "UserService",
      async (args: unknown) => {
        const data: { id: unknown; data: { name?: Name } } = args as {
          id: unknown;
          data: { name?: Name };
        };
        const account: WorldAccount | undefined = this.accountById(data.id);

        if (account && data.data.name) {
          account.name = data.data.name.toString();
        }

        return undefined;
      },
    );

    // The memberships.
    this.spy(
      TeamMemberService,
      "findOneBy",
      "TeamMemberService",
      async (args: unknown) => {
        const query: Record<string, unknown> = (
          args as { query: Record<string, unknown> }
        ).query;
        const found: WorldMembership | undefined = this.memberships.find(
          (item: WorldMembership): boolean => {
            return (
              idOf(item.userId) === idOf(query["userId"]) &&
              idOf(item.teamId) === idOf(query["teamId"])
            );
          },
        );

        return found ? new TeamMember(found.id) : null;
      },
    );
    this.spy(
      TeamMemberService,
      "countBy",
      "TeamMemberService",
      async (args: unknown) => {
        const query: Record<string, unknown> = (
          args as { query: Record<string, unknown> }
        ).query;

        return new PositiveNumber(
          this.memberships.filter((item: WorldMembership): boolean => {
            return (
              idOf(item.projectId) === idOf(query["projectId"]) &&
              idOf(item.userId) === idOf(query["userId"]) &&
              (query["hasAcceptedInvitation"] === undefined ||
                item.hasAcceptedInvitation ===
                  Boolean(query["hasAcceptedInvitation"]))
            );
          }).length,
        );
      },
    );
    this.spy(
      TeamMemberService,
      "getUniqueTeamMemberCountInProject",
      "TeamMemberService",
      async () => {
        return 1;
      },
    );
    this.spy(
      TeamMemberService,
      "readPeopleLimits",
      "TeamMemberService",
      async () => {
        return null;
      },
    );

    // What an invitation sends, after the request.
    this.spy(
      EmailVerificationTokenService,
      "create",
      "EmailVerificationTokenService",
      async (args: unknown) => {
        const token: EmailVerificationToken = (
          args as { data: EmailVerificationToken }
        ).data;

        this.tokensMinted.push(token);

        return token;
      },
    );
    this.spy(MailService, "sendMail", "MailService", async (mail: unknown) => {
      this.mails.push(mail as EmailMessage);

      if (this.mailAnswer === "refused") {
        return new HTTPErrorResponse(
          500,
          { message: "Refused" },
          {} as unknown as Headers,
        );
      }

      return undefined;
    });

    // What the rest of a create, an acceptance and a removal do.
    const elsewhere: Record<string, unknown> =
      TeamMemberService as unknown as Record<string, unknown>;

    for (const method of [
      "acceptPendingInvitationsInProject",
      "refreshTokens",
      "syncSubscriptionSeatsAfterMembershipChange",
      "addDefaultNotificationSettingsAndRules",
      "followUpWaitingPublicNotes",
      "noteSecondMemberJoined",
      "endOnCallTimeLogsOfRemovedMembers",
      "removeProjectAccessIfUserLeftProject",
      "cleanupOnCallAssignmentsIfUserLeftProject",
      "cleanupResourceAssignmentsIfUserLeftProject",
      "removeWorkspaceAccountLinksIfUserLeftProject",
      "removePersonalNotificationSettingsIfUserLeftProject",
    ]) {
      jest
        .spyOn(elsewhere as never, method as never)
        .mockImplementation((async () => {
          return 0;
        }) as never);
    }

    jest
      .spyOn(
        UserNotificationSettingService,
        "removeDefaultNotificationSettingsForUser",
      )
      .mockResolvedValue(undefined as never);
    jest.spyOn(ProductAnalytics, "captureForUser").mockReturnValue(undefined);

    // What Resend Invitation asks before it sends (resendInvitation).
    jest.spyOn(TeamMemberService, "findOneById").mockImplementation((async (
      args: unknown,
    ) => {
      const found: WorldMembership | undefined = this.memberships.find(
        (item: WorldMembership): boolean => {
          return idOf(item.id) === idOf((args as { id: unknown }).id);
        },
      );

      return found ? this.toMember(found) : null;
    }) as never);
    jest
      .spyOn(TeamMemberService, "checkCallerMayCreate")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(ServerSendingStatus, "isEmailKnownNotSetUp")
      .mockResolvedValue(false);
    jest
      .spyOn(Semaphore, "lock")
      .mockResolvedValue({ key: "resend" } as unknown as SemaphoreMutex);
    jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);
  }

  // Resend Invitation, from the person's pending row in the project.
  public async resend(data: {
    projectId: ObjectID;
    userId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const pending: WorldMembership | undefined = this.memberships.find(
      (item: WorldMembership): boolean => {
        return (
          idOf(item.projectId) === idOf(data.projectId) &&
          idOf(item.userId) === idOf(data.userId) &&
          !item.hasAcceptedInvitation
        );
      },
    );

    await TeamMemberService.resendInvitation({
      teamMemberId: pending!.id,
      projectId: data.projectId,
      props: data.props,
    });
  }

  // An account at `email`: one that has signed up, or one nobody has claimed.
  public seedAccount(data: {
    email: string;
    hasSignedUp: boolean;
    name?: string | null;
  }): WorldAccount {
    const account: WorldAccount = {
      id: ObjectID.generate(),
      email: data.email.toLowerCase(),
      password: data.hasSignedUp ? "signed-up" : null,
      name: data.name === undefined ? null : data.name,
      language: null,
    };

    this.accounts.push(account);

    return account;
  }

  public accountAt(email: string): WorldAccount | undefined {
    return this.accounts.find((item: WorldAccount): boolean => {
      return item.email === email.toLowerCase();
    });
  }

  /*
   * A membership's create, as DatabaseService runs it: onBeforeCreate, the
   * INSERT, onCreateSuccess - or onCreateError when any of them fails - and
   * the request answers; then what it sends after the request, settled.
   * `failInsert` fails the INSERT, as a refused or broken write does.
   */
  public async create(
    createBy: CreateBy<TeamMember>,
    options: { failInsert?: Error | undefined } = {},
  ): Promise<TeamMember> {
    const hooks: {
      onBeforeCreate: (
        c: CreateBy<TeamMember>,
      ) => Promise<OnCreate<TeamMember>>;
      onCreateSuccess: (
        o: OnCreate<TeamMember>,
        row: TeamMember,
      ) => Promise<TeamMember>;
      onCreateError: (
        e: Exception,
        o?: OnCreate<TeamMember> | undefined,
      ) => Promise<Exception>;
    } = TeamMemberService as unknown as {
      onBeforeCreate: (
        c: CreateBy<TeamMember>,
      ) => Promise<OnCreate<TeamMember>>;
      onCreateSuccess: (
        o: OnCreate<TeamMember>,
        row: TeamMember,
      ) => Promise<TeamMember>;
      onCreateError: (
        e: Exception,
        o?: OnCreate<TeamMember> | undefined,
      ) => Promise<Exception>;
    };

    let onCreate: OnCreate<TeamMember> | undefined = undefined;
    const startedAt: number = performance.now();

    try {
      onCreate = await hooks.onBeforeCreate(createBy);

      if (options.failInsert) {
        throw options.failInsert;
      }

      const row: TeamMember = this.insert(onCreate.createBy.data);

      return await hooks.onCreateSuccess(onCreate, row);
    } catch (error) {
      await hooks.onCreateError(error as Exception, onCreate);
      throw error;
    } finally {
      this.lastRequestMs = performance.now() - startedAt;
      this.calls.push(REQUEST_ANSWERED);
      await TeamMemberService.whenInvitationsSent();
    }
  }

  // The person accepts their invitations into the project (onUpdateSuccess).
  public async accept(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<void> {
    const rows: Array<WorldMembership> = this.memberships.filter(
      (item: WorldMembership): boolean => {
        return (
          idOf(item.projectId) === idOf(data.projectId) &&
          idOf(item.userId) === idOf(data.userId)
        );
      },
    );

    for (const row of rows) {
      row.hasAcceptedInvitation = true;
    }

    jest.spyOn(TeamMemberService, "findBy").mockResolvedValueOnce(
      rows.map((row: WorldMembership): TeamMember => {
        return this.toMember(row);
      }),
    );

    await (
      TeamMemberService as unknown as {
        onUpdateSuccess: (
          u: OnUpdate<TeamMember>,
          ids: Array<ObjectID>,
        ) => Promise<OnUpdate<TeamMember>>;
      }
    ).onUpdateSuccess(
      {
        updateBy: {
          query: {},
          data: { hasAcceptedInvitation: true },
          props: { userId: data.userId } as DatabaseCommonInteractionProps,
        },
        carryForward: null,
      } as unknown as OnUpdate<TeamMember>,
      rows.map((row: WorldMembership): ObjectID => {
        return row.id;
      }),
    );
  }

  /*
   * The person's memberships in the project are deleted (onDeleteSuccess):
   * by `by` - the person themselves, declining, or someone removing them.
   */
  public async deleteMemberships(data: {
    projectId: ObjectID;
    userId: ObjectID;
    by: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const removed: Array<WorldMembership> = this.memberships.filter(
      (item: WorldMembership): boolean => {
        return (
          idOf(item.projectId) === idOf(data.projectId) &&
          idOf(item.userId) === idOf(data.userId)
        );
      },
    );

    this.memberships = this.memberships.filter(
      (item: WorldMembership): boolean => {
        return !removed.includes(item);
      },
    );

    await (
      TeamMemberService as unknown as {
        onDeleteSuccess: (
          d: OnDelete<TeamMember>,
          ids: Array<ObjectID>,
        ) => Promise<OnDelete<TeamMember>>;
      }
    ).onDeleteSuccess(
      {
        deleteBy: { query: {}, props: data.by },
        carryForward: removed.map((row: WorldMembership): TeamMember => {
          return this.toMember(row);
        }),
      } as unknown as OnDelete<TeamMember>,
      removed.map((row: WorldMembership): ObjectID => {
        return row.id;
      }),
    );
  }

  // The calls a create made before its request answered.
  public callsBeforeAnswer(): Array<string> {
    const answeredAt: number = this.calls.indexOf(REQUEST_ANSWERED);

    return answeredAt === -1
      ? [...this.calls]
      : this.calls.slice(0, answeredAt);
  }

  // The calls made after the request answered: the invitation it sent.
  public callsAfterAnswer(): Array<string> {
    const answeredAt: number = this.calls.indexOf(REQUEST_ANSWERED);

    return answeredAt === -1 ? [] : this.calls.slice(answeredAt + 1);
  }

  private insert(data: TeamMember): TeamMember {
    const row: WorldMembership = {
      id: ObjectID.generate(),
      projectId: data.projectId!,
      teamId: data.teamId!,
      userId: data.userId!,
      hasAcceptedInvitation: Boolean(data.hasAcceptedInvitation),
      inviteeName: data.inviteeName || null,
    };

    this.memberships.push(row);

    const created: TeamMember = this.toMember(row);
    created.projectId = row.projectId;

    return created;
  }

  private accountById(id: unknown): WorldAccount | undefined {
    return this.accounts.find((item: WorldAccount): boolean => {
      return idOf(item.id) === idOf(id);
    });
  }

  private toUser(account: WorldAccount): User {
    const user: User = new User(account.id);
    user._id = account.id.toString();
    user.email = new Email(account.email);

    if (account.password) {
      user.password = new HashedString(account.password, true);
    }

    if (account.name) {
      user.name = new Name(account.name);
    }

    if (account.language) {
      user.language = account.language;
    }

    return user;
  }

  private toMember(row: WorldMembership): TeamMember {
    const member: TeamMember = new TeamMember(row.id);
    member.projectId = row.projectId;
    member.teamId = row.teamId;
    member.userId = row.userId;
    member.hasAcceptedInvitation = row.hasAcceptedInvitation;

    return member;
  }

  // A stood-in service method that records its call, and waits readDelayMs.
  private spy(
    service: unknown,
    method: string,
    serviceName: string,
    answer: (...args: Array<unknown>) => Promise<unknown>,
  ): void {
    jest.spyOn(service as never, method as never).mockImplementation((async (
      ...args: Array<unknown>
    ) => {
      this.calls.push(`${serviceName}.${method}`);

      if (this.readDelayMs > 0) {
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, this.readDelayMs);
        });
      }

      return await answer(...args);
    }) as never);
  }
}
