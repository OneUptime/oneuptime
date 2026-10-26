import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import DatabaseBaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Project from "../../../../Models/DatabaseModels/Project";
import WorkspaceNotificationLog from "../../../../Models/DatabaseModels/WorkspaceNotificationLog";
import WorkspaceProjectAuthToken from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import AlertEpisodeService from "../../../../Server/Services/AlertEpisodeService";
import AlertService from "../../../../Server/Services/AlertService";
import IncidentEpisodeService from "../../../../Server/Services/IncidentEpisodeService";
import IncidentService from "../../../../Server/Services/IncidentService";
import MonitorService from "../../../../Server/Services/MonitorService";
import OnCallDutyPolicyService from "../../../../Server/Services/OnCallDutyPolicyService";
import ProjectService from "../../../../Server/Services/ProjectService";
import ScheduledMaintenanceService from "../../../../Server/Services/ScheduledMaintenanceService";
import WorkspaceNotificationLogService from "../../../../Server/Services/WorkspaceNotificationLogService";
import WorkspaceProjectAuthTokenService from "../../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../../Server/Services/WorkspaceUserAuthTokenService";
import ProductBrandingText from "../../../../Server/Utils/ProductBrandingText";
import { WorkspaceAnswer } from "../../../../Server/Utils/Workspace/WorkspaceActionAnswers";
import WorkspaceActionAuthorization from "../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceProjectResolver, {
  WorkspaceAmbiguousRetry,
  WorkspaceAmbiguousRetryKind,
  WorkspaceProjectEvidence,
  WorkspaceProjectResolution,
} from "../../../../Server/Utils/Workspace/WorkspaceProjectResolution";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";

jest.mock("../../../../Server/Utils/Logger");

/*
 * WHICH ONEUPTIME PROJECT A CHAT REQUEST IS ABOUT.
 *
 * A Slack workspace or a Microsoft 365 organization can be connected to more
 * than one project, and a request names only the workspace. These pin how
 * the project is told apart - the record a press names, the project a form
 * was drawn for, the channel, the person - in that order, and that nothing
 * is guessed when none of those tells: the database is stood in for by the
 * rows each read would find.
 */

const TEAM_ID: string = "T0AVEPOINT";

const PLATFORM: ObjectID = new ObjectID("e1000000-0000-4000-8000-000000000001");
const NONPRD: ObjectID = new ObjectID("e1000000-0000-4000-8000-000000000002");
const SANDBOX: ObjectID = new ObjectID("e1000000-0000-4000-8000-000000000003");
// A project of another workspace altogether.
const ELSEWHERE: ObjectID = new ObjectID(
  "e1000000-0000-4000-8000-000000000009",
);

const DEANE: ObjectID = new ObjectID("e1000000-0000-4000-8000-0000000000a1");
const INCIDENT: ObjectID = new ObjectID("e1000000-0000-4000-8000-0000000000b1");
const ALERT: ObjectID = new ObjectID("e1000000-0000-4000-8000-0000000000b2");

const NAMES: Record<string, string> = {
  [PLATFORM.toString()]: "IRM Platform",
  [NONPRD.toString()]: "IRM Non-Prod",
  [SANDBOX.toString()]: "Sandbox",
};

// What each service's records are, as root reads them.
interface Row {
  id: ObjectID;
  projectId: ObjectID;
  channelIds?: Array<string> | undefined;
}

// The ids a query's value names: an id, or QueryHelper.any's IN (...).
function idsOf(value: unknown): Array<string> {
  if (value === undefined || value === null) {
    return [];
  }

  if (value instanceof ObjectID || typeof value === "string") {
    return [value.toString().toLowerCase()];
  }

  const parameters: JSONObject | undefined = (
    value as { objectLiteralParameters?: JSONObject }
  ).objectLiteralParameters;

  return Object.values(parameters || {})
    .flatMap((entry: unknown): Array<unknown> => {
      return Array.isArray(entry) ? entry : [entry];
    })
    .map((entry: unknown): string => {
      return String(entry).toLowerCase();
    });
}

function connectionOf(
  projectId: ObjectID,
  createdAt: string = "2026-10-01T00:00:00.000Z",
): WorkspaceProjectAuthToken {
  const connection: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
  connection.id = ObjectID.generate();
  connection.projectId = projectId;
  connection.workspaceProjectId = TEAM_ID;
  connection.workspaceType = WorkspaceType.Slack;
  connection.authToken = `xoxb-${projectId.toString().substring(30)}`;
  connection.createdAt = new Date(createdAt);
  return connection;
}

describe("WorkspaceProjectResolution", () => {
  let connections: Array<WorkspaceProjectAuthToken>;
  let records: Map<unknown, Array<Row>>;
  let logs: Array<{ projectId: ObjectID; channelId: string }>;
  let links: Array<{ projectId: ObjectID; userId: ObjectID; slackId: string }>;
  let members: Array<{ projectId: ObjectID; userId: ObjectID }>;
  let connectionReads: Array<JSONObject>;
  let recordReads: Array<{ service: unknown; query: JSONObject }>;
  let personReads: number;
  let channelReads: number;

  const RECORD_SERVICES: Array<unknown> = [
    IncidentService,
    AlertService,
    IncidentEpisodeService,
    AlertEpisodeService,
    ScheduledMaintenanceService,
    MonitorService,
    OnCallDutyPolicyService,
  ];

  // A record service's reads, answered from `records` as its query asks.
  function stubRecordService(service: unknown): void {
    const read: (query: JSONObject) => Array<DatabaseBaseModel> = (
      query: JSONObject,
    ): Array<DatabaseBaseModel> => {
      const projectIds: Array<string> = idsOf(query["projectId"]);
      const channel: string = JSON.stringify(
        idsOf(query["postUpdatesToWorkspaceChannels"]),
      );

      return (records.get(service) || [])
        .filter((row: Row): boolean => {
          return (
            projectIds.includes(row.projectId.toString().toLowerCase()) &&
            (query["_id"] === undefined ||
              idsOf(query["_id"]).includes(row.id.toString())) &&
            (query["postUpdatesToWorkspaceChannels"] === undefined ||
              (row.channelIds || []).some((channelId: string): boolean => {
                return channel.includes(channelId.toLowerCase());
              }))
          );
        })
        .map((row: Row): DatabaseBaseModel => {
          const model: Incident = new Incident();
          model.id = row.id;
          model.projectId = row.projectId;
          return model as unknown as DatabaseBaseModel;
        });
    };

    jest
      .spyOn(service as { findOneBy: () => Promise<unknown> }, "findOneBy")
      .mockImplementation((async (findOneBy: JSONObject) => {
        recordReads.push({
          service: service,
          query: findOneBy["query"] as JSONObject,
        });
        expect(findOneBy["props"]).toEqual({ isRoot: true });
        return read(findOneBy["query"] as JSONObject)[0] || null;
      }) as never);
    jest
      .spyOn(service as { findBy: () => Promise<unknown> }, "findBy")
      .mockImplementation((async (findBy: JSONObject) => {
        channelReads++;
        expect(findBy["props"]).toEqual({ isRoot: true });
        return read(findBy["query"] as JSONObject);
      }) as never);
  }

  beforeEach(() => {
    connections = [connectionOf(PLATFORM), connectionOf(NONPRD)];
    records = new Map<unknown, Array<Row>>();
    logs = [];
    links = [];
    members = [];
    connectionReads = [];
    recordReads = [];
    personReads = 0;
    channelReads = 0;

    jest
      .spyOn(ProductBrandingText, "getProductName")
      .mockReturnValue("OneUptime");

    jest
      .spyOn(WorkspaceProjectAuthTokenService, "findBy")
      .mockImplementation((async (findBy: JSONObject) => {
        connectionReads.push(findBy);
        const query: JSONObject = findBy["query"] as JSONObject;

        return connections.filter(
          (connection: WorkspaceProjectAuthToken): boolean => {
            return (
              query["workspaceProjectId"] === connection.workspaceProjectId &&
              query["workspaceType"] === connection.workspaceType
            );
          },
        );
      }) as never);

    for (const service of RECORD_SERVICES) {
      stubRecordService(service);
    }

    jest
      .spyOn(WorkspaceNotificationLogService, "findOneBy")
      .mockImplementation((async (findOneBy: { query: JSONObject }) => {
        const found: { projectId: ObjectID; channelId: string } | undefined =
          logs.find((log: { projectId: ObjectID; channelId: string }) => {
            return (
              idsOf(findOneBy.query["projectId"]).includes(
                log.projectId.toString(),
              ) && findOneBy.query["channelId"] === log.channelId
            );
          });

        if (!found) {
          return null;
        }

        const log: WorkspaceNotificationLog = new WorkspaceNotificationLog();
        log.id = ObjectID.generate();
        return log;
      }) as never);

    jest
      .spyOn(WorkspaceUserAuthTokenService, "findBy")
      .mockImplementation((async (findBy: { query: JSONObject }) => {
        personReads++;
        const projectIds: Array<string> = idsOf(findBy.query["projectId"]);

        return links
          .filter(
            (link: {
              projectId: ObjectID;
              userId: ObjectID;
              slackId: string;
            }): boolean => {
              return (
                link.slackId === findBy.query["workspaceUserId"] &&
                projectIds.includes(link.projectId.toString())
              );
            },
          )
          .map(
            (link: {
              projectId: ObjectID;
              userId: ObjectID;
            }): WorkspaceUserAuthToken => {
              const token: WorkspaceUserAuthToken =
                new WorkspaceUserAuthToken();
              token.projectId = link.projectId;
              token.userId = link.userId;
              return token;
            },
          );
      }) as never);

    jest
      .spyOn(WorkspaceActionAuthorization, "isProjectMember")
      .mockImplementation(
        async (data: { userId: ObjectID; projectId: ObjectID }) => {
          return members.some(
            (member: { projectId: ObjectID; userId: ObjectID }): boolean => {
              return (
                member.projectId.toString() === data.projectId.toString() &&
                member.userId.toString() === data.userId.toString()
              );
            },
          );
        },
      );

    jest.spyOn(ProjectService, "findBy").mockImplementation((async (findBy: {
      query: JSONObject;
    }) => {
      return idsOf(findBy.query["_id"])
        .filter((id: string): boolean => {
          return Boolean(NAMES[id]);
        })
        .map((id: string): Project => {
          const project: Project = new Project();
          project.id = new ObjectID(id);
          project.name = NAMES[id]!;
          return project;
        });
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function link(projectId: ObjectID, isMember: boolean = true): void {
    links.push({ projectId: projectId, userId: DEANE, slackId: "U0DEANE" });

    if (isMember) {
      members.push({ projectId: projectId, userId: DEANE });
    }
  }

  function resolve(
    clues: Parameters<typeof WorkspaceProjectResolver.resolve>[0]["clues"],
  ): Promise<WorkspaceProjectResolution> {
    return WorkspaceProjectResolver.resolve({
      workspaceType: WorkspaceType.Slack,
      workspaceId: TEAM_ID,
      clues: clues,
    });
  }

  function projectOf(resolution: WorkspaceProjectResolution): string | null {
    return resolution.projectAuth?.projectId?.toString() || null;
  }

  describe("the workspace's connections", () => {
    test("are read as OneUptime, every one of the workspace's kind, oldest first", async () => {
      await WorkspaceProjectResolver.findConnections({
        workspaceType: WorkspaceType.Slack,
        workspaceId: TEAM_ID,
      });

      expect(connectionReads).toHaveLength(1);
      expect(connectionReads[0]).toMatchObject({
        query: {
          workspaceType: WorkspaceType.Slack,
          workspaceProjectId: TEAM_ID,
        },
        sort: { createdAt: SortOrder.Ascending },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      });
    });

    test("a project connected twice is one project, and a row without a project is none", async () => {
      const orphan: WorkspaceProjectAuthToken = connectionOf(PLATFORM);
      delete orphan.projectId;
      connections = [
        connectionOf(PLATFORM),
        orphan,
        connectionOf(PLATFORM),
        connectionOf(NONPRD),
      ];

      const found: Array<WorkspaceProjectAuthToken> =
        await WorkspaceProjectResolver.findConnections({
          workspaceType: WorkspaceType.Slack,
          workspaceId: TEAM_ID,
        });

      expect(
        found.map((connection: WorkspaceProjectAuthToken): string => {
          return connection.projectId!.toString();
        }),
      ).toEqual([PLATFORM.toString(), NONPRD.toString()]);
    });

    test("a workspace with no id reads nothing", async () => {
      expect(
        await WorkspaceProjectResolver.findConnections({
          workspaceType: WorkspaceType.Slack,
          workspaceId: "",
        }),
      ).toEqual([]);
      expect(connectionReads).toHaveLength(0);
    });
  });

  describe("one project, or none", () => {
    test("a workspace connected to one project is about it, and nothing else is read", async () => {
      connections = [connectionOf(NONPRD)];

      const resolution: WorkspaceProjectResolution = await resolve({
        recordIds: [INCIDENT.toString()],
        channelId: "C0ANY",
        workspaceUserId: "U0DEANE",
      });

      expect(projectOf(resolution)).toBe(NONPRD.toString());
      expect(resolution.decidedBy).toBe(WorkspaceProjectEvidence.OnlyProject);
      expect(resolution.isAmbiguous).toBe(false);
      expect(recordReads).toHaveLength(0);
      expect(channelReads).toBe(0);
      expect(personReads).toBe(0);
    });

    test("a workspace connected to none is about none, and is not ambiguous", async () => {
      connections = [];

      const resolution: WorkspaceProjectResolution = await resolve({
        workspaceUserId: "U0DEANE",
      });

      expect(resolution.projectAuth).toBeNull();
      expect(resolution.isAmbiguous).toBe(false);
      expect(resolution.connections).toEqual([]);
    });
  });

  describe("the record a press names", () => {
    test("an incident's button acts in the incident's project, whichever connection comes first", async () => {
      records.set(IncidentService, [{ id: INCIDENT, projectId: NONPRD }]);

      for (const order of [
        [PLATFORM, NONPRD],
        [NONPRD, PLATFORM],
      ]) {
        connections = order.map((projectId: ObjectID) => {
          return connectionOf(projectId);
        });

        const resolution: WorkspaceProjectResolution = await resolve({
          recordIds: [INCIDENT.toString()],
        });

        expect(projectOf(resolution)).toBe(NONPRD.toString());
        expect(resolution.decidedBy).toBe(WorkspaceProjectEvidence.Record);
      }
    });

    test("every kind a button is on is asked: an alert's button acts in the alert's project", async () => {
      records.set(AlertService, [{ id: ALERT, projectId: PLATFORM }]);

      const resolution: WorkspaceProjectResolution = await resolve({
        recordIds: [ALERT.toString()],
      });

      expect(projectOf(resolution)).toBe(PLATFORM.toString());

      // Each kind, asked in the workspace's projects only, as OneUptime.
      expect(
        recordReads.map((read: { service: unknown }) => {
          return read.service;
        }),
      ).toEqual(RECORD_SERVICES);

      for (const read of recordReads) {
        expect(idsOf(read.query["projectId"]).sort()).toEqual(
          [PLATFORM.toString(), NONPRD.toString()].sort(),
        );
      }
    });

    test("a value that is not an id - a channel, a title - is read for nothing", async () => {
      link(NONPRD);

      await resolve({
        recordIds: ["C0INC12", "Checkout is down", "", undefined],
        workspaceUserId: "U0DEANE",
      });

      expect(recordReads).toHaveLength(0);
    });

    test("a record of a project the workspace is not connected to tells nothing", async () => {
      records.set(IncidentService, [{ id: INCIDENT, projectId: ELSEWHERE }]);
      link(PLATFORM);

      const resolution: WorkspaceProjectResolution = await resolve({
        recordIds: [INCIDENT.toString()],
        workspaceUserId: "U0DEANE",
      });

      // The person's project, then; the read there finds no such incident.
      expect(projectOf(resolution)).toBe(PLATFORM.toString());
      expect(resolution.decidedBy).toBe(WorkspaceProjectEvidence.Person);
    });

    test("the record is the most specific: it wins over the channel and the person", async () => {
      records.set(IncidentService, [
        { id: INCIDENT, projectId: NONPRD },
        {
          id: ObjectID.generate(),
          projectId: PLATFORM,
          channelIds: ["C0PLATFORM"],
        },
      ]);
      link(PLATFORM);

      const resolution: WorkspaceProjectResolution = await resolve({
        recordIds: [INCIDENT.toString()],
        channelId: "C0PLATFORM",
        workspaceUserId: "U0DEANE",
      });

      expect(projectOf(resolution)).toBe(NONPRD.toString());
      expect(resolution.decidedBy).toBe(WorkspaceProjectEvidence.Record);
      expect(channelReads).toBe(0);
      expect(personReads).toBe(0);
    });
  });

  describe("the project a form or Home was drawn for", () => {
    test("is the project, when it is one of the workspace's", async () => {
      link(PLATFORM);

      const resolution: WorkspaceProjectResolution = await resolve({
        recordIds: ["C0GENERAL"],
        drawnForProjectId: NONPRD.toString(),
        workspaceUserId: "U0DEANE",
      });

      expect(projectOf(resolution)).toBe(NONPRD.toString());
      expect(resolution.decidedBy).toBe(WorkspaceProjectEvidence.DrawnFor);
    });

    test("one that is not the workspace's is passed over", async () => {
      link(PLATFORM);

      const resolution: WorkspaceProjectResolution = await resolve({
        drawnForProjectId: ELSEWHERE,
        workspaceUserId: "U0DEANE",
      });

      expect(projectOf(resolution)).toBe(PLATFORM.toString());
      expect(resolution.decidedBy).toBe(WorkspaceProjectEvidence.Person);
    });
  });

  describe("the channel it was made in", () => {
    test("a record's own channel is the record's project's", async () => {
      records.set(IncidentService, [
        { id: INCIDENT, projectId: NONPRD, channelIds: ["C0IRMINC12"] },
      ]);
      link(PLATFORM);
      link(NONPRD);

      const resolution: WorkspaceProjectResolution = await resolve({
        channelId: "C0IRMINC12",
        workspaceUserId: "U0DEANE",
      });

      expect(projectOf(resolution)).toBe(NONPRD.toString());
      expect(resolution.decidedBy).toBe(WorkspaceProjectEvidence.Channel);
      expect(personReads).toBe(0);
    });

    test("a channel records of two projects claim tells nothing", async () => {
      records.set(IncidentService, [
        { id: INCIDENT, projectId: NONPRD, channelIds: ["C0SHARED"] },
      ]);
      records.set(AlertService, [
        { id: ALERT, projectId: PLATFORM, channelIds: ["C0SHARED"] },
      ]);
      link(PLATFORM);

      const resolution: WorkspaceProjectResolution = await resolve({
        channelId: "C0SHARED",
        workspaceUserId: "U0DEANE",
      });

      expect(projectOf(resolution)).toBe(PLATFORM.toString());
      expect(resolution.decidedBy).toBe(WorkspaceProjectEvidence.Person);
    });

    test("a channel only one project posts to is that project's", async () => {
      logs = [{ projectId: PLATFORM, channelId: "C0ALERTS" }];
      link(PLATFORM);
      link(NONPRD);

      const resolution: WorkspaceProjectResolution = await resolve({
        channelId: "C0ALERTS",
        workspaceUserId: "U0DEANE",
      });

      expect(projectOf(resolution)).toBe(PLATFORM.toString());
      expect(resolution.decidedBy).toBe(WorkspaceProjectEvidence.Channel);
    });

    test("a channel both projects post to tells nothing", async () => {
      logs = [
        { projectId: PLATFORM, channelId: "C0ALERTS" },
        { projectId: NONPRD, channelId: "C0ALERTS" },
      ];
      link(NONPRD);

      const resolution: WorkspaceProjectResolution = await resolve({
        channelId: "C0ALERTS",
        workspaceUserId: "U0DEANE",
      });

      expect(projectOf(resolution)).toBe(NONPRD.toString());
      expect(resolution.decidedBy).toBe(WorkspaceProjectEvidence.Person);
    });
  });

  describe("the person", () => {
    test("connected in one project, as a member: that project", async () => {
      link(NONPRD);

      const resolution: WorkspaceProjectResolution = await resolve({
        channelId: "C0GENERAL",
        workspaceUserId: "U0DEANE",
      });

      expect(projectOf(resolution)).toBe(NONPRD.toString());
      expect(resolution.decidedBy).toBe(WorkspaceProjectEvidence.Person);
      expect(resolution.isPersonConnected).toBe(true);
    });

    test("connected in two, a member of one: the one they are a member of", async () => {
      link(PLATFORM, false);
      link(NONPRD);

      const resolution: WorkspaceProjectResolution = await resolve({
        workspaceUserId: "U0DEANE",
      });

      expect(projectOf(resolution)).toBe(NONPRD.toString());
    });

    test("connected only where they are no member any more: read there, to be told so", async () => {
      link(NONPRD, false);

      const resolution: WorkspaceProjectResolution = await resolve({
        workspaceUserId: "U0DEANE",
      });

      expect(projectOf(resolution)).toBe(NONPRD.toString());
      expect(resolution.decidedBy).toBe(WorkspaceProjectEvidence.Person);
    });

    test("a member of both: ambiguous, naming both, and no project is guessed", async () => {
      link(PLATFORM);
      link(NONPRD);

      const resolution: WorkspaceProjectResolution = await resolve({
        channelId: "C0GENERAL",
        workspaceUserId: "U0DEANE",
      });

      expect(resolution.projectAuth).toBeNull();
      expect(resolution.isAmbiguous).toBe(true);
      expect(resolution.decidedBy).toBeNull();
      expect(resolution.isPersonConnected).toBe(true);
      expect(
        resolution.memberProjectIds.map((id: ObjectID): string => {
          return id.toString();
        }),
      ).toEqual([PLATFORM.toString(), NONPRD.toString()]);
    });

    test("connected in none: ambiguous, and said to be connected in none", async () => {
      const resolution: WorkspaceProjectResolution = await resolve({
        workspaceUserId: "U0DEANE",
      });

      expect(resolution.projectAuth).toBeNull();
      expect(resolution.isAmbiguous).toBe(true);
      expect(resolution.isPersonConnected).toBe(false);
      expect(resolution.memberProjectIds).toEqual([]);
    });

    test("a request with no person, nothing else telling: ambiguous", async () => {
      const resolution: WorkspaceProjectResolution = await resolve({});

      expect(resolution.isAmbiguous).toBe(true);
      expect(personReads).toBe(0);
    });
  });

  describe("getPersonProject: the project a Home shows a person", () => {
    test("the project told apart", async () => {
      link(NONPRD);

      expect(
        WorkspaceProjectResolver.getPersonProject(
          await resolve({ workspaceUserId: "U0DEANE" }),
        )?.projectId?.toString(),
      ).toBe(NONPRD.toString());
    });

    test("in several, the first they are in, in the order the projects were connected", async () => {
      connections = [
        connectionOf(SANDBOX),
        connectionOf(PLATFORM),
        connectionOf(NONPRD),
      ];
      link(NONPRD);
      link(PLATFORM);

      expect(
        WorkspaceProjectResolver.getPersonProject(
          await resolve({ workspaceUserId: "U0DEANE" }),
        )?.projectId?.toString(),
      ).toBe(PLATFORM.toString());
    });

    test("connected in none of several: none", async () => {
      expect(
        WorkspaceProjectResolver.getPersonProject(
          await resolve({ workspaceUserId: "U0DEANE" }),
        ),
      ).toBeNull();
    });
  });

  describe("getAmbiguousAnswer: what the person is told", () => {
    async function answerFor(
      workspaceType: WorkspaceType,
      retry?: WorkspaceAmbiguousRetry | undefined,
    ): Promise<WorkspaceAnswer> {
      return await WorkspaceProjectResolver.getAmbiguousAnswer({
        workspaceType: workspaceType,
        resolution: await resolve({ workspaceUserId: "U0DEANE" }),
        retry: retry,
      });
    }

    test("Slack, a member of two: the projects by name, and where to try again", async () => {
      link(PLATFORM);
      link(NONPRD);

      const answer: WorkspaceAnswer = await answerFor(WorkspaceType.Slack);

      expect(answer.text).toBe(
        "This Slack workspace is connected to more than one OneUptime project, so OneUptime can't tell which one you mean here. You're in IRM Platform and IRM Non-Prod: try it again in a channel of the project you mean, such as one of its incident channels.",
      );
      expect(answer.markdown).toContain("**IRM Platform**");
      expect(answer.markdown).toContain("Non");
      expect(answer.markdown).not.toContain("not found");
    });

    test("three projects are listed with commas and a last 'and'", async () => {
      connections = [
        connectionOf(PLATFORM),
        connectionOf(NONPRD),
        connectionOf(SANDBOX),
      ];
      link(PLATFORM);
      link(NONPRD);
      link(SANDBOX);

      expect((await answerFor(WorkspaceType.Slack)).text).toContain(
        "You're in IRM Platform, IRM Non-Prod and Sandbox:",
      );
    });

    test("connected in none: where to connect, not which project", async () => {
      const answer: WorkspaceAnswer = await answerFor(WorkspaceType.Slack);

      expect(answer.text).toBe(
        "This Slack workspace is connected to more than one OneUptime project, and your Slack account isn't connected in any of them yet. In OneUptime, open the project you use and connect your account under User Settings → Workspace → Slack, then try again.",
      );
      expect(answer.markdown).toContain(
        "**User Settings → Workspace → Slack**",
      );
    });

    test("Microsoft Teams speaks as the bot, from the words its troubleshooting entry quotes", async () => {
      link(PLATFORM);
      link(NONPRD);

      const answer: WorkspaceAnswer = await answerFor(
        WorkspaceType.MicrosoftTeams,
      );

      expect(
        answer.text.startsWith(WorkspaceProjectResolver.TEAMS_AMBIGUOUS_LEAD),
      ).toBe(true);
      expect(answer.text).toContain("so I can't tell which one you mean here.");
      expect(answer.text).toContain("You're in IRM Platform and IRM Non-Prod:");
      expect(answer.text).toContain(
        "try it again in a channel of the project you mean",
      );
    });

    test("Microsoft Teams: a question is asked again, in the bot's own words", async () => {
      link(PLATFORM);
      link(NONPRD);

      const answer: WorkspaceAnswer = await answerFor(
        WorkspaceType.MicrosoftTeams,
        { kind: WorkspaceAmbiguousRetryKind.Question },
      );

      expect(answer.text).toBe(
        `${WorkspaceProjectResolver.TEAMS_AMBIGUOUS_LEAD}, so I can't tell which one you mean here. You're in IRM Platform and IRM Non-Prod: ask again in a channel of the project you mean, such as one of its incident channels.`,
      );
    });

    test("Microsoft Teams, connected in none: where to connect", async () => {
      expect((await answerFor(WorkspaceType.MicrosoftTeams)).text).toContain(
        "your Microsoft Teams account isn't connected in any of them yet. In OneUptime, open the project you use and connect your account under User Settings → Workspace → Microsoft Teams",
      );
    });

    test("names that cannot be read leave the names out, never the answer", async () => {
      link(PLATFORM);
      link(NONPRD);
      jest
        .spyOn(ProjectService, "findBy")
        .mockRejectedValue(new Error("database is away"));

      expect((await answerFor(WorkspaceType.Slack)).text).toBe(
        "This Slack workspace is connected to more than one OneUptime project, so OneUptime can't tell which one you mean here. Try it again in a channel of the project you mean, such as one of its incident channels.",
      );
    });

    test("a question for OneUptime AI is asked again there - as told by default when nothing says how", async () => {
      link(PLATFORM);
      link(NONPRD);

      const asked: WorkspaceAnswer = await answerFor(WorkspaceType.Slack, {
        kind: WorkspaceAmbiguousRetryKind.Question,
      });

      expect(asked.text).toBe(
        "This Slack workspace is connected to more than one OneUptime project, so OneUptime can't tell which one you mean here. You're in IRM Platform and IRM Non-Prod: ask again in a channel of the project you mean, such as one of its incident channels.",
      );
      expect(asked.markdown).toContain(
        "ask again in a channel of the project you mean",
      );

      // Again, the default, says what no retry said.
      expect(
        (
          await answerFor(WorkspaceType.Slack, {
            kind: WorkspaceAmbiguousRetryKind.Again,
          })
        ).text,
      ).toBe((await answerFor(WorkspaceType.Slack)).text);
    });

    test("a Slack shortcut, which no channel tells apart, is pointed to its command - never to try the shortcut again", async () => {
      link(PLATFORM);
      link(NONPRD);

      const answer: WorkspaceAnswer = await answerFor(WorkspaceType.Slack, {
        kind: WorkspaceAmbiguousRetryKind.Command,
        command: "/oneuptime incident",
      });

      expect(answer.text).toBe(
        "This Slack workspace is connected to more than one OneUptime project, so OneUptime can't tell which one you mean here. You're in IRM Platform and IRM Non-Prod: use /oneuptime incident in a channel of the project you mean instead.",
      );
      // The command reads as typed, in bold, as every command the answers name.
      expect(answer.markdown).toContain(
        "use **/oneuptime incident** in a channel of the project you mean instead.",
      );
      expect(answer.text).not.toContain("try it again");
    });

    test("the command, without the names to start the sentence with, starts it", async () => {
      link(PLATFORM);
      link(NONPRD);
      jest
        .spyOn(ProjectService, "findBy")
        .mockRejectedValue(new Error("database is away"));

      const answer: WorkspaceAnswer = await answerFor(WorkspaceType.Slack, {
        kind: WorkspaceAmbiguousRetryKind.Command,
        command: "/oneuptime maintenance",
      });

      expect(answer.text).toBe(
        "This Slack workspace is connected to more than one OneUptime project, so OneUptime can't tell which one you mean here. Use /oneuptime maintenance in a channel of the project you mean instead.",
      );
      expect(answer.markdown).toContain(
        "Use **/oneuptime maintenance** in a channel",
      );

      // A question, the same way: capitalized where it starts the sentence.
      expect(
        (
          await answerFor(WorkspaceType.Slack, {
            kind: WorkspaceAmbiguousRetryKind.Question,
          })
        ).text,
      ).toContain(
        "which one you mean here. Ask again in a channel of the project you mean, such as one of its incident channels.",
      );
    });

    test("a Command retry without a command is tried again, as by default", async () => {
      link(PLATFORM);
      link(NONPRD);

      expect(
        (
          await answerFor(WorkspaceType.Slack, {
            kind: WorkspaceAmbiguousRetryKind.Command,
          })
        ).text,
      ).toBe((await answerFor(WorkspaceType.Slack)).text);
    });

    test("a command is text in Markdown: it cannot bold or link anything", async () => {
      link(PLATFORM);
      link(NONPRD);

      const answer: WorkspaceAnswer = await answerFor(WorkspaceType.Slack, {
        kind: WorkspaceAmbiguousRetryKind.Command,
        command: "/irm *incident* [x](https://evil.example)",
      });

      expect(answer.markdown).not.toContain("[x](https://evil.example)");
      expect(answer.text).toContain(
        "/irm *incident* [x](https://evil.example)",
      );
    });

    test("connected in none: where to connect, whatever the retry", async () => {
      const answer: WorkspaceAnswer = await answerFor(WorkspaceType.Slack, {
        kind: WorkspaceAmbiguousRetryKind.Command,
        command: "/oneuptime incident",
      });

      expect(answer.text).toBe(
        "This Slack workspace is connected to more than one OneUptime project, and your Slack account isn't connected in any of them yet. In OneUptime, open the project you use and connect your account under User Settings → Workspace → Slack, then try again.",
      );
    });

    test("the product is named as the installation names it", async () => {
      link(PLATFORM);
      link(NONPRD);
      jest
        .spyOn(ProductBrandingText, "getProductName")
        .mockReturnValue("Acme Status");

      const answer: WorkspaceAnswer = await answerFor(WorkspaceType.Slack);

      expect(answer.text).toContain("more than one Acme Status project");
      expect(answer.text).toContain("so Acme Status can't tell");
      expect(answer.text).not.toContain("OneUptime");
    });

    test("a project name is text in Markdown: it cannot bold or link anything", async () => {
      NAMES[PLATFORM.toString()] = "*Prod* [click](https://evil.example)";
      link(PLATFORM);
      link(NONPRD);

      try {
        const answer: WorkspaceAnswer = await answerFor(WorkspaceType.Slack);

        expect(answer.markdown).not.toContain("[click](https://evil.example)");
        expect(answer.text).toContain("*Prod* [click](https://evil.example)");
      } finally {
        NAMES[PLATFORM.toString()] = "IRM Platform";
      }
    });
  });

  /*
   * A Connect prompt in a workspace connected to more than one project names
   * the project (WorkspaceActionAnswers.getConnectPrompt): an account is
   * connected in each project on its own, so somebody connected in another
   * of them sees why they are asked again.
   */
  describe("getSharedWorkspaceProjectName: the project a Connect prompt names", () => {
    function nameOf(projectId: ObjectID): Promise<string | null> {
      return WorkspaceProjectResolver.getSharedWorkspaceProjectName({
        workspaceType: WorkspaceType.Slack,
        workspaceId: TEAM_ID,
        projectId: projectId,
      });
    }

    test("a workspace connected to two projects: the project's name", async () => {
      expect(await nameOf(NONPRD)).toBe("IRM Non-Prod");
      expect(await nameOf(PLATFORM)).toBe("IRM Platform");
    });

    test("a workspace connected to one project: none - nothing to tell apart, and its name is never read", async () => {
      connections = [connectionOf(NONPRD)];
      const nameReads: ReturnType<typeof jest.spyOn> = jest.spyOn(
        ProjectService,
        "findBy",
      );

      expect(await nameOf(NONPRD)).toBeNull();
      expect(nameReads).not.toHaveBeenCalled();
    });

    test("one project connected twice is one project: none", async () => {
      connections = [connectionOf(NONPRD), connectionOf(NONPRD)];

      expect(await nameOf(NONPRD)).toBeNull();
    });

    test("no workspace id: none, and nothing is read", async () => {
      for (const workspaceId of [undefined, ""]) {
        expect(
          await WorkspaceProjectResolver.getSharedWorkspaceProjectName({
            workspaceType: WorkspaceType.Slack,
            workspaceId: workspaceId,
            projectId: NONPRD,
          }),
        ).toBeNull();
      }

      expect(connectionReads).toEqual([]);
    });

    test("the connections or the name cannot be read: none, never a throw - the prompt stands without it", async () => {
      jest
        .spyOn(WorkspaceProjectAuthTokenService, "findBy")
        .mockRejectedValue(new Error("database is away"));

      expect(await nameOf(NONPRD)).toBeNull();

      jest.restoreAllMocks();
      jest
        .spyOn(WorkspaceProjectAuthTokenService, "findBy")
        .mockResolvedValue([
          connectionOf(PLATFORM),
          connectionOf(NONPRD),
        ] as never);
      jest
        .spyOn(ProjectService, "findBy")
        .mockRejectedValue(new Error("database is away"));

      expect(await nameOf(NONPRD)).toBeNull();
    });

    test("a project whose name is blank: none", async () => {
      const name: string = NAMES[NONPRD.toString()]!;
      NAMES[NONPRD.toString()] = "   ";

      try {
        expect(await nameOf(NONPRD)).toBeNull();
      } finally {
        NAMES[NONPRD.toString()] = name;
      }
    });
  });

  /*
   * The projects somebody is asked to choose among, with a button for each
   * (SlackProjectChoice): every button is named, or none is offered.
   */
  describe("getProjectChoices: the projects a person chooses among, named", () => {
    test("each project with its name, in the order given - the order the projects were connected", async () => {
      expect(
        await WorkspaceProjectResolver.getProjectChoices([NONPRD, PLATFORM]),
      ).toEqual([
        { projectId: NONPRD, name: "IRM Non-Prod" },
        { projectId: PLATFORM, name: "IRM Platform" },
      ]);
      expect(
        await WorkspaceProjectResolver.getProjectChoices([
          PLATFORM,
          NONPRD,
          SANDBOX,
        ]),
      ).toEqual([
        { projectId: PLATFORM, name: "IRM Platform" },
        { projectId: NONPRD, name: "IRM Non-Prod" },
        { projectId: SANDBOX, name: "Sandbox" },
      ]);
    });

    test("names are read in one read, and trimmed", async () => {
      const name: string = NAMES[NONPRD.toString()]!;
      NAMES[NONPRD.toString()] = "  IRM Non-Prod  ";
      const nameReads: ReturnType<typeof jest.spyOn> = jest.spyOn(
        ProjectService,
        "findBy",
      );

      try {
        expect(
          await WorkspaceProjectResolver.getProjectChoices([PLATFORM, NONPRD]),
        ).toEqual([
          { projectId: PLATFORM, name: "IRM Platform" },
          { projectId: NONPRD, name: "IRM Non-Prod" },
        ]);
        expect(nameReads).toHaveBeenCalledTimes(1);
      } finally {
        NAMES[NONPRD.toString()] = name;
      }
    });

    test("a project not found, or with a blank name: none - no button without a name", async () => {
      expect(
        await WorkspaceProjectResolver.getProjectChoices([PLATFORM, ELSEWHERE]),
      ).toBeNull();

      const name: string = NAMES[NONPRD.toString()]!;
      NAMES[NONPRD.toString()] = "   ";

      try {
        expect(
          await WorkspaceProjectResolver.getProjectChoices([PLATFORM, NONPRD]),
        ).toBeNull();
      } finally {
        NAMES[NONPRD.toString()] = name;
      }
    });

    test("no projects: none, and nothing is read", async () => {
      const nameReads: ReturnType<typeof jest.spyOn> = jest.spyOn(
        ProjectService,
        "findBy",
      );

      expect(await WorkspaceProjectResolver.getProjectChoices([])).toBeNull();
      expect(nameReads).not.toHaveBeenCalled();
    });

    test("names that cannot be read: none, never a throw", async () => {
      jest
        .spyOn(ProjectService, "findBy")
        .mockRejectedValue(new Error("database is away"));

      expect(
        await WorkspaceProjectResolver.getProjectChoices([PLATFORM, NONPRD]),
      ).toBeNull();
    });
  });

  describe("getAmbiguousLead: how an answer to such a request starts", () => {
    test("Slack names the product, as renamed", () => {
      expect(
        WorkspaceProjectResolver.getAmbiguousLead(WorkspaceType.Slack),
      ).toBe(
        "This Slack workspace is connected to more than one OneUptime project",
      );

      jest
        .spyOn(ProductBrandingText, "getProductName")
        .mockReturnValue("Acme Status");

      expect(
        WorkspaceProjectResolver.getAmbiguousLead(WorkspaceType.Slack),
      ).toBe(
        "This Slack workspace is connected to more than one Acme Status project",
      );
    });

    test("Microsoft Teams keeps the literal its docs quote", () => {
      expect(
        WorkspaceProjectResolver.getAmbiguousLead(WorkspaceType.MicrosoftTeams),
      ).toBe(WorkspaceProjectResolver.TEAMS_AMBIGUOUS_LEAD);
    });
  });
});
