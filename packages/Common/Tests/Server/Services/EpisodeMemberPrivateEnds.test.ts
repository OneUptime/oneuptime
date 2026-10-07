import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import AlertEpisodeMember from "../../../Models/DatabaseModels/AlertEpisodeMember";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeMember from "../../../Models/DatabaseModels/IncidentEpisodeMember";
import AlertEpisodeFeedService from "../../../Server/Services/AlertEpisodeFeedService";
import AlertEpisodeMemberService from "../../../Server/Services/AlertEpisodeMemberService";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import AlertService from "../../../Server/Services/AlertService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentEpisodeFeedService from "../../../Server/Services/IncidentEpisodeFeedService";
import IncidentEpisodeMemberService from "../../../Server/Services/IncidentEpisodeMemberService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../Server/Services/IncidentService";
import { ProjectReferenceWrite } from "../../../Server/Services/ProjectReferencesService";
import WorkspaceNotificationRuleService from "../../../Server/Services/WorkspaceNotificationRuleService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnDelete } from "../../../Server/Types/Database/Hooks";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import { ProjectScopedReferenceException } from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import logger from "../../../Server/Utils/Logger";
import WorkflowPrincipal from "../../../Server/Utils/Workflow/WorkflowPrincipal";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import ForbiddenException from "../../../Types/Exception/ForbiddenException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import UserType from "../../../Types/UserType";
import { escapeMarkdownValue } from "../../../Utils/Markdown/MarkdownEscape";
import {
  ProjectDirectoryStub,
  stubProjectDirectory,
} from "../TestingUtils/ProjectDirectory";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { Token, Tokens, marked } from "marked";

/*
 * An episode member joins an incident (or an alert) to an episode, and
 * adding or removing one writes an entry on each side: on the episode, which
 * is also posted to the episode's Slack / Microsoft Teams channels, and on
 * the incident. Each is read by its own side's audience, so a private end's
 * title never goes into the other side's entry - the rule IncidentAlertService
 * keeps for an alert linked to an incident.
 *
 * And a person only adds an incident they can see to an episode they can
 * see: both are read as the caller, and a private one they cannot open, one
 * of another project and one that does not exist all get the same answer.
 * OneUptime's own writes - the grouping engine, adding by hand for the person
 * who asked - are made as root and read neither end as a user.
 *
 * EpisodeMemberPrivateEndsPostgres runs both against a migrated Postgres, with
 * the real privacy rules deciding who can see what.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0194a1e7-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "0194a1e7-0000-4000-8000-000000000002",
);
const RECORD_ID: ObjectID = new ObjectID(
  "0194a1e7-0000-4000-8000-0000000000a1",
);
const OTHER_RECORD_ID: ObjectID = new ObjectID(
  "0194a1e7-0000-4000-8000-0000000000a2",
);
// Another project's record, and one that is nobody's.
const FOREIGN_RECORD_ID: ObjectID = new ObjectID(
  "0194a1e7-0000-4000-8000-0000000000a3",
);
const MISSING_RECORD_ID: ObjectID = new ObjectID(
  "0194a1e7-0000-4000-8000-0000000000a4",
);
const EPISODE_ID: ObjectID = new ObjectID(
  "0194a1e7-0000-4000-8000-0000000000e1",
);
const FOREIGN_EPISODE_ID: ObjectID = new ObjectID(
  "0194a1e7-0000-4000-8000-0000000000e2",
);
const MISSING_EPISODE_ID: ObjectID = new ObjectID(
  "0194a1e7-0000-4000-8000-0000000000e3",
);
const USER_ID: ObjectID = new ObjectID("0194a1e7-0000-4000-8000-0000000000c1");

const RECORD_TITLE: string = "Payroll export is leaking salaries";
const EPISODE_TITLE: string = "Payroll data breach";

const HOSTILE_TITLE: string =
  "![](https://tracker.example/p.png) [Reset your password](https://evil.example/login)";

interface Kind {
  name: "Incident" | "Alert";
  noun: "incident" | "alert";
  memberService: DatabaseService<DatabaseBaseModel>;
  recordService: DatabaseService<DatabaseBaseModel>;
  episodeService: DatabaseService<DatabaseBaseModel>;
  episodeFeedService: DatabaseService<DatabaseBaseModel>;
  recordFeedService: DatabaseService<DatabaseBaseModel>;
  // The member's columns and relations, as its model names them.
  recordIdColumn: "incidentId" | "alertId";
  recordRelation: "incident" | "alert";
  episodeIdColumn: "incidentEpisodeId" | "alertEpisodeId";
  episodeRelation: "incidentEpisode" | "alertEpisode";
  // How the entries name the record: "Incident INC-42".
  recordLabel: string;
  // The role that works on these records without being a project admin.
  memberPermission: Permission;
  memberModel: { new (): DatabaseBaseModel };
  record: (data: RowData) => DatabaseBaseModel;
  episode: (data: RowData) => DatabaseBaseModel;
  // What the episode's counters do once a member joins or leaves.
  episodeCounters: Array<string>;
  // The refusals for a record, or an episode, the caller cannot see.
  hiddenRecord: string;
  hiddenEpisode: string;
}

interface RowData {
  title?: string | undefined;
  isPrivate?: boolean | undefined;
  projectId?: ObjectID | undefined;
}

const KINDS: Array<Kind> = [
  {
    name: "Incident",
    noun: "incident",
    memberService:
      IncidentEpisodeMemberService as unknown as DatabaseService<DatabaseBaseModel>,
    recordService:
      IncidentService as unknown as DatabaseService<DatabaseBaseModel>,
    episodeService:
      IncidentEpisodeService as unknown as DatabaseService<DatabaseBaseModel>,
    episodeFeedService:
      IncidentEpisodeFeedService as unknown as DatabaseService<DatabaseBaseModel>,
    recordFeedService:
      IncidentFeedService as unknown as DatabaseService<DatabaseBaseModel>,
    recordIdColumn: "incidentId",
    recordRelation: "incident",
    episodeIdColumn: "incidentEpisodeId",
    episodeRelation: "incidentEpisode",
    recordLabel: "Incident INC-42",
    memberPermission: Permission.IncidentMember,
    memberModel: IncidentEpisodeMember,
    record: (data: RowData): DatabaseBaseModel => {
      const incident: Incident = new Incident();
      incident._id = RECORD_ID.toString();
      incident.projectId = data.projectId || PROJECT_ID;
      incident.incidentNumber = 42;
      incident.incidentNumberWithPrefix = "INC-42";
      if (data.title !== undefined) {
        incident.title = data.title;
      }
      if (data.isPrivate !== undefined) {
        incident.isPrivate = data.isPrivate;
      }
      return incident;
    },
    episode: (data: RowData): DatabaseBaseModel => {
      const episode: IncidentEpisode = new IncidentEpisode();
      episode._id = EPISODE_ID.toString();
      episode.projectId = data.projectId || PROJECT_ID;
      episode.episodeNumber = 7;
      episode.episodeNumberWithPrefix = "EP-7";
      if (data.title !== undefined) {
        episode.title = data.title;
      }
      if (data.isPrivate !== undefined) {
        episode.isPrivate = data.isPrivate;
      }
      return episode;
    },
    episodeCounters: ["updateIncidentCount", "updateLastIncidentAddedAt"],
    hiddenRecord:
      "The incident to add does not exist in this project, or you do not have access to it.",
    hiddenEpisode:
      "The episode to add the incident to does not exist in this project, or you do not have access to it.",
  },
  {
    name: "Alert",
    noun: "alert",
    memberService:
      AlertEpisodeMemberService as unknown as DatabaseService<DatabaseBaseModel>,
    recordService:
      AlertService as unknown as DatabaseService<DatabaseBaseModel>,
    episodeService:
      AlertEpisodeService as unknown as DatabaseService<DatabaseBaseModel>,
    episodeFeedService:
      AlertEpisodeFeedService as unknown as DatabaseService<DatabaseBaseModel>,
    recordFeedService:
      AlertFeedService as unknown as DatabaseService<DatabaseBaseModel>,
    recordIdColumn: "alertId",
    recordRelation: "alert",
    episodeIdColumn: "alertEpisodeId",
    episodeRelation: "alertEpisode",
    recordLabel: "Alert ALT-3",
    memberPermission: Permission.AlertMember,
    memberModel: AlertEpisodeMember,
    record: (data: RowData): DatabaseBaseModel => {
      const alert: Alert = new Alert();
      alert._id = RECORD_ID.toString();
      alert.projectId = data.projectId || PROJECT_ID;
      alert.alertNumber = 3;
      alert.alertNumberWithPrefix = "ALT-3";
      if (data.title !== undefined) {
        alert.title = data.title;
      }
      if (data.isPrivate !== undefined) {
        alert.isPrivate = data.isPrivate;
      }
      return alert;
    },
    episode: (data: RowData): DatabaseBaseModel => {
      const episode: AlertEpisode = new AlertEpisode();
      episode._id = EPISODE_ID.toString();
      episode.projectId = data.projectId || PROJECT_ID;
      episode.episodeNumber = 7;
      episode.episodeNumberWithPrefix = "EP-7";
      if (data.title !== undefined) {
        episode.title = data.title;
      }
      if (data.isPrivate !== undefined) {
        episode.isPrivate = data.isPrivate;
      }
      return episode;
    },
    episodeCounters: ["updateAlertCount", "updateLastAlertAddedAt"],
    hiddenRecord:
      "The alert to add does not exist in this project, or you do not have access to it.",
    hiddenEpisode:
      "The episode to add the alert to does not exist in this project, or you do not have access to it.",
  },
];

type HookFunction = (...args: Array<unknown>) => Promise<unknown>;

function callHook<T>(
  service: unknown,
  name: string,
  ...args: Array<unknown>
): Promise<T> {
  const hooks: Record<string, HookFunction> = service as Record<
    string,
    HookFunction
  >;
  return hooks[name]!.apply(service, args) as Promise<T>;
}

// Pass null for an API key, which acts for no user.
function userProps(
  permission: Permission,
  userId: ObjectID | null = USER_ID,
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId: PROJECT_ID,
    _type: "UserTenantAccessPermission",
    permissions: [
      {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      },
    ],
  };

  return {
    tenantId: PROJECT_ID,
    userId: userId || undefined,
    userType: userId ? UserType.User : UserType.API,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission,
    },
  };
}

function member(
  kind: Kind,
  data: Record<string, unknown> = {},
): DatabaseBaseModel {
  const row: DatabaseBaseModel = new kind.memberModel();
  const record: Record<string, unknown> = row as unknown as Record<
    string,
    unknown
  >;
  record["projectId"] = PROJECT_ID;
  record[kind.episodeIdColumn] = EPISODE_ID;
  record[kind.recordIdColumn] = RECORD_ID;
  Object.assign(record, data);
  return row;
}

function valueOf(row: DatabaseBaseModel, column: string): unknown {
  return (row as unknown as Record<string, unknown>)[column];
}

beforeEach(() => {
  /*
   * The records these tests name are their project's own, unless a test
   * says otherwise: the generic check every service runs first
   * (ProjectReferencesService) has its own suites.
   */
  stubProjectDirectory({});
  jest.spyOn(logger, "debug").mockImplementation((() => {
    // quiet
  }) as never);
  jest.spyOn(logger, "error").mockImplementation((() => {
    // quiet
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(KINDS)(
  "$name episode members: a private end's title never reaches the other side's entry",
  (kind: Kind) => {
    let recordRead: jest.SpyInstance;
    let episodeRead: jest.SpyInstance;
    let episodeRows: jest.SpyInstance;
    let recordRows: jest.SpyInstance;
    let posts: jest.SpyInstance;

    function stubEnds(ends: {
      recordTitle?: string;
      episodeTitle?: string;
      recordIsPrivate?: boolean;
      episodeIsPrivate?: boolean;
    }): void {
      recordRead = jest
        .spyOn(kind.recordService, "findOneById")
        .mockResolvedValue(
          kind.record({
            title: ends.recordTitle ?? RECORD_TITLE,
            isPrivate: ends.recordIsPrivate,
          }) as never,
        );
      episodeRead = jest
        .spyOn(kind.episodeService, "findOneById")
        .mockResolvedValue(
          kind.episode({
            title: ends.episodeTitle ?? EPISODE_TITLE,
            isPrivate: ends.episodeIsPrivate,
          }) as never,
        );
    }

    beforeEach(() => {
      jest
        .spyOn(kind.recordService, "updateOneById")
        .mockResolvedValue(1 as never);

      for (const counter of kind.episodeCounters) {
        jest
          .spyOn(
            kind.episodeService as unknown as Record<string, HookFunction>,
            counter,
          )
          .mockResolvedValue(undefined as never);
      }

      // Removed from its only episode.
      jest.spyOn(kind.memberService, "findOneBy").mockResolvedValue(null);

      /*
       * The feed services run for real up to the database: what they would
       * store, and what they would post to Slack and Microsoft Teams.
       */
      episodeRows = jest
        .spyOn(kind.episodeFeedService, "create")
        .mockResolvedValue({} as never);
      recordRows = jest
        .spyOn(kind.recordFeedService, "create")
        .mockResolvedValue({} as never);
      posts = jest
        .spyOn(
          WorkspaceNotificationRuleService,
          "sendWorkspaceMarkdownNotification",
        )
        .mockResolvedValue(undefined as never);
    });

    async function add(): Promise<void> {
      await callHook(
        kind.memberService,
        "onCreateSuccess",
        { createBy: { data: member(kind), props: { isRoot: true } } },
        member(kind, { addedByUserId: USER_ID }),
      );
    }

    async function remove(): Promise<void> {
      await callHook(
        kind.memberService,
        "onDeleteSuccess",
        {
          deleteBy: { query: {}, props: { isRoot: true } },
          carryForward: [member(kind)],
        } as unknown as OnDelete<DatabaseBaseModel>,
        [],
      );
    }

    // What the episode's feed stores, and what is posted to its channels.
    function episodeEntry(): string {
      expect(episodeRows).toHaveBeenCalledTimes(1);
      return valueOf(
        episodeRows.mock.calls[0]![0].data,
        "feedInfoInMarkdown",
      ) as string;
    }

    function postedMarkdown(): Array<string> {
      return posts.mock.calls.map((args: Array<unknown>): string => {
        return (args[0] as { feedInfoInMarkdown: string }).feedInfoInMarkdown;
      });
    }

    function recordEntry(): string {
      expect(recordRows).toHaveBeenCalledTimes(1);
      return valueOf(
        recordRows.mock.calls[0]![0].data,
        "feedInfoInMarkdown",
      ) as string;
    }

    test("both ends are read, as root, with their privacy", async () => {
      stubEnds({});

      await add();

      for (const read of [recordRead, episodeRead]) {
        expect(read).toHaveBeenCalledTimes(1);
        expect(read.mock.calls[0]![0].select).toEqual(
          expect.objectContaining({ title: true, isPrivate: true }),
        );
        expect(read.mock.calls[0]![0].props).toEqual({ isRoot: true });
      }
    });

    test.each([
      ["add", add, "added to episode"],
      ["remove", remove, "removed from episode"],
    ])(
      `%s: a private ${kind.noun} is named by its number only, on the episode and in its Slack / Teams post`,
      async (_label: string, act: () => Promise<void>, verb: string) => {
        stubEnds({ recordIsPrivate: true });

        await act();

        const expected: string = `**${kind.recordLabel}** (private ${kind.noun}) ${verb}`;

        expect(episodeEntry()).toBe(expected);
        expect(postedMarkdown()).toEqual([expected]);
        expect(episodeEntry()).not.toContain("Payroll");

        // The episode is not private: the record's own entry may name it.
        expect(recordEntry()).toContain(`: ${EPISODE_TITLE}`);
      },
    );

    test.each([
      ["add", add, "Added to **Episode EP-7** (private episode)"],
      ["remove", remove, "Removed from **Episode EP-7** (private episode)"],
    ])(
      `%s: a private episode is named by its number only, on the ${kind.noun}`,
      async (_label: string, act: () => Promise<void>, expected: string) => {
        stubEnds({ episodeIsPrivate: true });

        await act();

        expect(recordEntry()).toBe(expected);
        expect(recordEntry()).not.toContain(EPISODE_TITLE);

        // The record is not private: the episode's entry, and its post, may name it.
        expect(episodeEntry()).toContain(`: ${RECORD_TITLE}`);
        expect(postedMarkdown()).toEqual([episodeEntry()]);
      },
    );

    test.each([
      ["add", add],
      ["remove", remove],
    ])(
      "%s: when both are private neither title crosses over (their owners can differ)",
      async (_label: string, act: () => Promise<void>) => {
        stubEnds({ recordIsPrivate: true, episodeIsPrivate: true });

        await act();

        for (const markdown of [
          episodeEntry(),
          recordEntry(),
          ...postedMarkdown(),
        ]) {
          expect(markdown).not.toContain(RECORD_TITLE);
          expect(markdown).not.toContain(EPISODE_TITLE);
        }

        expect(episodeEntry()).toContain(`(private ${kind.noun})`);
        expect(recordEntry()).toContain("(private episode)");
      },
    );

    test.each([
      [
        "add",
        add,
        `**${kind.recordLabel}** added to episode: ${RECORD_TITLE}`,
        `Added to **Episode EP-7**: ${EPISODE_TITLE}`,
      ],
      [
        "remove",
        remove,
        `**${kind.recordLabel}** removed from episode: ${RECORD_TITLE}`,
        `Removed from **Episode EP-7**: ${EPISODE_TITLE}`,
      ],
    ])(
      "%s: public titles are written in full",
      async (
        _label: string,
        act: () => Promise<void>,
        onEpisode: string,
        onRecord: string,
      ) => {
        stubEnds({ recordIsPrivate: false, episodeIsPrivate: false });

        await act();

        expect(episodeEntry()).toBe(onEpisode);
        expect(postedMarkdown()).toEqual([onEpisode]);
        expect(recordEntry()).toBe(onRecord);
      },
    );

    test("the record is named by the same number when it joins and when it leaves", async () => {
      stubEnds({});

      await add();
      await remove();

      expect(
        episodeRows.mock.calls.map((args: Array<unknown>): unknown => {
          return valueOf(
            (args[0] as { data: DatabaseBaseModel }).data,
            "feedInfoInMarkdown",
          );
        }),
      ).toEqual([
        `**${kind.recordLabel}** added to episode: ${RECORD_TITLE}`,
        `**${kind.recordLabel}** removed from episode: ${RECORD_TITLE}`,
      ]);
    });

    test("only the episode's entry is posted to Slack / Teams", async () => {
      stubEnds({});

      await add();

      expect(posts).toHaveBeenCalledTimes(1);
      expect(posts.mock.calls[0]![0].notificationFor).toEqual({
        [kind.episodeIdColumn]: EPISODE_ID,
      });
    });

    test.each([
      ["add", add],
      ["remove", remove],
    ])(
      "%s: a public title is quoted inertly - no image fetched, no link that hides where it goes",
      async (_label: string, act: () => Promise<void>) => {
        stubEnds({ recordTitle: HOSTILE_TITLE, episodeTitle: HOSTILE_TITLE });

        await act();

        for (const markdown of [episodeEntry(), recordEntry()]) {
          expect(markdown).toContain(escapeMarkdownValue(HOSTILE_TITLE));

          const tokens: Array<Token> = [];
          marked.walkTokens(marked.lexer(markdown), (token: Token): void => {
            tokens.push(token);
          });

          // A bare address may still be linked, showing where it goes.
          expect(
            tokens
              .filter((token: Token): boolean => {
                return (
                  token.type === "image" ||
                  (token.type === "link" &&
                    (token as Tokens.Link).text !== (token as Tokens.Link).href)
                );
              })
              .map((token: Token): string => {
                return token.raw;
              }),
          ).toEqual([]);
        }
      },
    );
  },
);

describe.each(KINDS)(
  "$name episode members: a person adds only what they can see",
  (kind: Kind) => {
    let recordRead: jest.SpyInstance;
    let episodeRead: jest.SpyInstance;
    let duplicateCheck: jest.SpyInstance;

    beforeEach(() => {
      recordRead = jest
        .spyOn(kind.recordService, "findOneById")
        .mockResolvedValue(kind.record({ isPrivate: true }) as never);
      episodeRead = jest
        .spyOn(kind.episodeService, "findOneById")
        .mockResolvedValue(kind.episode({ isPrivate: true }) as never);
      duplicateCheck = jest
        .spyOn(kind.memberService, "findOneBy")
        .mockResolvedValue(null);
      jest
        .spyOn(kind.memberService, "countBy")
        .mockResolvedValue(new PositiveNumber(1) as never);
    });

    function create(
      props: DatabaseCommonInteractionProps = userProps(
        Permission.ProjectMember,
      ),
      data: Record<string, unknown> = {},
    ): Promise<OnCreate<DatabaseBaseModel>> {
      return callHook<OnCreate<DatabaseBaseModel>>(
        kind.memberService,
        "onBeforeCreate",
        {
          data: member(kind, data),
          props: props,
        } as CreateBy<DatabaseBaseModel>,
      );
    }

    test("reads the episode and the record with the caller's own props", async () => {
      const props: DatabaseCommonInteractionProps = userProps(
        Permission.ProjectMember,
      );

      await create(props);

      expect(episodeRead).toHaveBeenCalledTimes(1);
      expect(episodeRead).toHaveBeenCalledWith(
        expect.objectContaining({ id: EPISODE_ID, props: props }),
      );
      expect(recordRead).toHaveBeenCalledTimes(1);
      expect(recordRead).toHaveBeenCalledWith(
        expect.objectContaining({ id: RECORD_ID, props: props }),
      );
    });

    test(`a private ${kind.noun} the caller cannot open is refused without saying why, before anything is said about the episode's members`, async () => {
      // As the caller's privacy rules answer for a private record they do not own.
      recordRead.mockResolvedValue(null as never);

      await expect(create()).rejects.toThrow(kind.hiddenRecord);
      expect(duplicateCheck).not.toHaveBeenCalled();
    });

    test("a private episode the caller cannot open is refused without saying why", async () => {
      episodeRead.mockResolvedValue(null as never);

      await expect(create()).rejects.toThrow(kind.hiddenEpisode);
      expect(recordRead).not.toHaveBeenCalled();
      expect(duplicateCheck).not.toHaveBeenCalled();
    });

    test("a read the permission layer refuses gets the same answer", async () => {
      recordRead.mockRejectedValue(
        new NotAuthorizedException(
          `You do not have permission to read ${kind.name}`,
        ) as never,
      );

      await expect(create()).rejects.toThrow(kind.hiddenRecord);

      episodeRead.mockRejectedValue(
        new ForbiddenException("A label you cannot see") as never,
      );

      await expect(create()).rejects.toThrow(kind.hiddenEpisode);
    });

    test("a record or an episode of another project gets the same answer", async () => {
      recordRead.mockResolvedValue(
        kind.record({ projectId: OTHER_PROJECT_ID }) as never,
      );

      await expect(create()).rejects.toThrow(kind.hiddenRecord);

      episodeRead.mockResolvedValue(
        kind.episode({ projectId: OTHER_PROJECT_ID }) as never,
      );

      await expect(create()).rejects.toThrow(kind.hiddenEpisode);
    });

    test("the project is the caller's tenant, whatever the payload says", async () => {
      await expect(
        create(userProps(Permission.ProjectMember), {
          projectId: OTHER_PROJECT_ID,
        }),
      ).resolves.toBeDefined();
    });

    test("a failure that is not about access is passed on unchanged", async () => {
      recordRead.mockRejectedValue(new Error("connection reset") as never);

      await expect(create()).rejects.toThrow("connection reset");
    });

    test(`the ${kind.noun} and the episode named by their relations are the ones checked, and stored`, async () => {
      const result: OnCreate<DatabaseBaseModel> = await create(
        userProps(Permission.ProjectMember),
        {
          [kind.recordIdColumn]: undefined,
          [kind.recordRelation]: { _id: OTHER_RECORD_ID.toString() },
          [kind.episodeIdColumn]: undefined,
          [kind.episodeRelation]: { _id: EPISODE_ID.toString() },
        },
      );

      expect(recordRead).toHaveBeenCalledWith(
        expect.objectContaining({ id: OTHER_RECORD_ID }),
      );
      expect(
        (valueOf(result.createBy.data, kind.recordIdColumn) as ObjectID)
          .toString()
          .toLowerCase(),
      ).toBe(OTHER_RECORD_ID.toString().toLowerCase());
      expect(
        valueOf(result.createBy.data, kind.recordRelation),
      ).toBeUndefined();
      expect(
        (valueOf(result.createBy.data, kind.episodeIdColumn) as ObjectID)
          .toString()
          .toLowerCase(),
      ).toBe(EPISODE_ID.toString().toLowerCase());
      expect(
        valueOf(result.createBy.data, kind.episodeRelation),
      ).toBeUndefined();
    });

    test(`two different ${kind.noun}s under its two names are refused before anything is read`, async () => {
      await expect(
        create(userProps(Permission.ProjectMember), {
          [kind.recordRelation]: { _id: OTHER_RECORD_ID.toString() },
        }),
      ).rejects.toThrow(`Conflicting ${kind.noun} references were provided.`);

      expect(recordRead).not.toHaveBeenCalled();
      expect(episodeRead).not.toHaveBeenCalled();
    });

    test.each([
      ["an owner of both, as a project member", Permission.ProjectMember],
      ["a project admin", Permission.ProjectAdmin],
      ["a project owner", Permission.ProjectOwner],
      [`an ${kind.noun} member`, kind.memberPermission],
    ])(
      "%s, who can see both, adds it",
      async (_who: string, permission: Permission) => {
        const props: DatabaseCommonInteractionProps = userProps(permission);
        const result: OnCreate<DatabaseBaseModel> = await create(props);

        // And what the hook returns passes the create permission check.
        expect(() => {
          ModelPermission.checkCreatePermissions(
            kind.memberModel as unknown as { new (): DatabaseBaseModel },
            result.createBy.data,
            result.createBy.props,
          );
        }).not.toThrow();
      },
    );

    test("a workflow step, which acts as a Project Admin of its project, is read like one", async () => {
      const props: DatabaseCommonInteractionProps =
        WorkflowPrincipal.getPropsWithoutPlan({
          projectId: PROJECT_ID,
          workflowId: ObjectID.generate(),
        });

      await expect(create(props)).resolves.toBeDefined();

      expect(episodeRead).toHaveBeenCalledWith(
        expect.objectContaining({ id: EPISODE_ID, props: props }),
      );
      expect(recordRead).toHaveBeenCalledWith(
        expect.objectContaining({ id: RECORD_ID, props: props }),
      );
    });

    test("an API key that can see both adds it", async () => {
      await expect(
        create(userProps(Permission.ProjectAdmin, null)),
      ).resolves.toBeDefined();
    });

    test("OneUptime's own writes - the grouping engine, adding by hand - read neither end as a user", async () => {
      recordRead.mockResolvedValue(null as never);
      episodeRead.mockResolvedValue(null as never);

      await expect(create({ isRoot: true })).resolves.toBeDefined();

      expect(recordRead).not.toHaveBeenCalled();
      expect(episodeRead).not.toHaveBeenCalled();
      // The duplicate check still runs, as root.
      expect(duplicateCheck).toHaveBeenCalledTimes(1);
    });
  },
);

/*
 * The project check every service runs first (ProjectReferencesService)
 * leaves the episode and the record of a person's write to the service's own
 * hook, so a person naming another project's record, or one that does not
 * exist, hears what a hidden one gets - never a sentence of its own. Root
 * writes have no person to read as, and get the project check. Here the
 * project check runs for real against a project directory: the project has
 * RECORD_ID and EPISODE_ID, the FOREIGN ids are another project's, and the
 * MISSING ids are nobody's.
 */
describe.each(KINDS)(
  "$name episode members: the project check and the service's own answer agree",
  (kind: Kind) => {
    let directory: ProjectDirectoryStub;

    beforeEach(() => {
      directory = stubProjectDirectory({
        projectId: PROJECT_ID,
        records: {
          [kind.name]: [RECORD_ID.toString()],
          [`${kind.name}Episode`]: [EPISODE_ID.toString()],
        },
        elsewhere: [
          FOREIGN_RECORD_ID.toString(),
          FOREIGN_EPISODE_ID.toString(),
        ],
      });

      // Read as the caller, which is pinned to their project.
      jest
        .spyOn(kind.recordService, "findOneById")
        .mockImplementation((async (findBy: { id: ObjectID }) => {
          return findBy.id.toString() === RECORD_ID.toString()
            ? kind.record({})
            : null;
        }) as never);
      jest
        .spyOn(kind.episodeService, "findOneById")
        .mockImplementation((async (findBy: { id: ObjectID }) => {
          return findBy.id.toString() === EPISODE_ID.toString()
            ? kind.episode({})
            : null;
        }) as never);
      jest.spyOn(kind.memberService, "findOneBy").mockResolvedValue(null);
      jest
        .spyOn(kind.memberService, "countBy")
        .mockResolvedValue(new PositiveNumber(1) as never);
    });

    function create(
      props: DatabaseCommonInteractionProps,
      data: Record<string, unknown>,
    ): Promise<OnCreate<DatabaseBaseModel>> {
      return callHook<OnCreate<DatabaseBaseModel>>(
        kind.memberService,
        "onBeforeCreate",
        {
          data: member(kind, data),
          props: props,
        } as CreateBy<DatabaseBaseModel>,
      );
    }

    test.each([
      ["another project's", FOREIGN_RECORD_ID],
      ["a missing", MISSING_RECORD_ID],
    ])(
      `a person naming %s ${kind.noun} hears what a hidden one gets`,
      async (_case: string, recordId: ObjectID) => {
        await expect(
          create(userProps(Permission.ProjectMember), {
            [kind.recordIdColumn]: recordId,
          }),
        ).rejects.toThrow(kind.hiddenRecord);

        // The project directory was never asked about either end.
        expect(
          directory.recordLookups.map((lookup: { model: string }): string => {
            return lookup.model;
          }),
        ).toEqual([]);
      },
    );

    test.each([
      ["another project's", FOREIGN_EPISODE_ID],
      ["a missing", MISSING_EPISODE_ID],
    ])(
      "a person naming %s episode hears what a hidden one gets",
      async (_case: string, episodeId: ObjectID) => {
        await expect(
          create(userProps(Permission.ProjectMember), {
            [kind.episodeIdColumn]: episodeId,
          }),
        ).rejects.toThrow(kind.hiddenEpisode);
      },
    );

    test.each([
      ["the grouping engine, as root", { isRoot: true }],
      [
        "a root write made in its project",
        { isRoot: true, tenantId: PROJECT_ID },
      ],
    ] as Array<[string, DatabaseCommonInteractionProps]>)(
      "%s may name only the project's episode and record",
      async (_who: string, props: DatabaseCommonInteractionProps) => {
        for (const data of [
          { [kind.recordIdColumn]: FOREIGN_RECORD_ID },
          { [kind.recordIdColumn]: MISSING_RECORD_ID },
          { [kind.episodeIdColumn]: FOREIGN_EPISODE_ID },
        ]) {
          const refusal: unknown = await create(props, data).catch(
            (error: unknown) => {
              return error;
            },
          );

          expect(refusal).toBeInstanceOf(ProjectScopedReferenceException);
          expect((refusal as Error).message).toContain(
            "references records that are not in this project",
          );
        }

        await expect(create(props, {})).resolves.toBeDefined();
      },
    );

    test("the service names both ends as its own to check, for a person's create only", () => {
      const declared: (write?: ProjectReferenceWrite) => Array<string> = (
        write?: ProjectReferenceWrite,
      ): Array<string> => {
        return (
          kind.memberService as unknown as {
            getRelationsCheckedByService: (
              write?: ProjectReferenceWrite,
            ) => Array<string>;
          }
        ).getRelationsCheckedByService(write);
      };

      const both: Array<string> = [kind.episodeRelation, kind.recordRelation];

      expect(declared()).toEqual(both);
      expect(
        declared({
          kind: "create",
          props: userProps(Permission.ProjectMember),
        }),
      ).toEqual(both);
      expect(
        declared({
          kind: "create",
          props: userProps(Permission.ProjectMember, null),
        }),
      ).toEqual(both);
      expect(
        declared({
          kind: "create",
          props: WorkflowPrincipal.getPropsWithoutPlan({
            projectId: PROJECT_ID,
            workflowId: ObjectID.generate(),
          }),
        }),
      ).toEqual(both);
      expect(declared({ kind: "create", props: { isRoot: true } })).toEqual([]);
      expect(
        declared({
          kind: "update",
          props: userProps(Permission.ProjectMember),
        }),
      ).toEqual([]);
    });

    test("a refusal is a BadDataException, as the dashboard shows it", async () => {
      const refusal: unknown = await create(
        userProps(Permission.ProjectMember),
        { [kind.recordIdColumn]: MISSING_RECORD_ID },
      ).catch((error: unknown) => {
        return error;
      });

      expect(refusal).toBeInstanceOf(BadDataException);
    });
  },
);
