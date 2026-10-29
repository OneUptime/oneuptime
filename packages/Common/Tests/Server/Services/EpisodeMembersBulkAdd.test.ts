import AlertEpisodeFeedService from "../../../Server/Services/AlertEpisodeFeedService";
import AlertEpisodeMemberService, {
  ALERT_ALREADY_IN_EPISODE_MESSAGE,
} from "../../../Server/Services/AlertEpisodeMemberService";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import AlertService from "../../../Server/Services/AlertService";
import AlertSeverityService from "../../../Server/Services/AlertSeverityService";
import IncidentEpisodeFeedService from "../../../Server/Services/IncidentEpisodeFeedService";
import IncidentEpisodeMemberService, {
  INCIDENT_ALREADY_IN_EPISODE_MESSAGE,
} from "../../../Server/Services/IncidentEpisodeMemberService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import { EPISODE_MEMBER_ADDED_TOGETHER_KEY } from "../../../Server/Utils/Episode/EpisodeMembersBatch";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import AlertEpisodeMember from "../../../Models/DatabaseModels/AlertEpisodeMember";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeMember from "../../../Models/DatabaseModels/IncidentEpisodeMember";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  ALERT_NOT_FOUND_REASON,
  EpisodeMembersAddResult,
  INCIDENT_NOT_FOUND_REASON,
} from "../../../Types/Episode/EpisodeMembersAdd";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

// Refusals below are deliberate; @CaptureSpan and the services log them.
jest.mock("../../../Server/Utils/Logger");

/*
 * Adding several incidents or alerts to an episode in one request
 * (EpisodeMembersAdd): POST /alert-episode-member/add-alerts and
 * /incident-episode-member/add-incidents, and an episode created with what
 * goes in it.
 *
 *   - Who may: the member model's create permission, asked before anything
 *     is read; the episode read as the caller (one they cannot see, or one of
 *     another project, refuses the whole request in the same words as one
 *     that does not exist); each record read as the caller - one they cannot
 *     see is not added, and says so in words that do not tell it from one
 *     that does not exist.
 *   - Each id is answered once, in the order named: added, in the episode
 *     already (left as it was), or not added and why.
 *   - Each one added is the member service's own create, as OneUptime's
 *     write for the person who asked, carrying the marker that leaves the
 *     episode's side to the batch; the episode's side is written once: one
 *     recount, one last-added time, its severity raised to the most severe
 *     one added, one feed entry (and one Slack / Teams post).
 *
 * The member services' own code runs; the reads and writes they make are
 * stand-ins. EpisodeMembersBulkAddPostgres runs the same against a migrated
 * Postgres.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-ba1c-4aaa-8bbb-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-ba1c-4aaa-8bbb-000000000002",
);
const EPISODE_ID: ObjectID = new ObjectID(
  "0193c0de-ba1c-4aaa-8bbb-0000000000e1",
);
const PERSON_ID: ObjectID = new ObjectID(
  "0193c0de-ba1c-4aaa-8bbb-0000000000a1",
);
const API_KEY_ID: ObjectID = new ObjectID(
  "0193c0de-ba1c-4aaa-8bbb-0000000000b1",
);

const CRITICAL_ID: string = "0193c0de-ba1c-4aaa-8bbb-0000000000c1";
const MAJOR_ID: string = "0193c0de-ba1c-4aaa-8bbb-0000000000c2";
const MINOR_ID: string = "0193c0de-ba1c-4aaa-8bbb-0000000000c3";

const SEVERITY_ORDER: Record<string, number> = {
  [CRITICAL_ID]: 1,
  [MAJOR_ID]: 2,
  [MINOR_ID]: 3,
};

type RecordIdFunction = (index: number) => string;

const recordId: RecordIdFunction = (index: number): string => {
  return `0193c0de-ba1c-4aaa-8bbb-${index.toString().padStart(12, "0")}`;
};

type AnyFunction = (...args: Array<any>) => any;
type AnyService = Record<string, AnyFunction>;

interface Kind {
  name: "alert" | "incident";
  memberService: AnyService;
  episodeService: AnyService;
  recordService: AnyService;
  severityService: AnyService;
  episodeFeedService: AnyService;
  episodeFeedMethod: string;
  recordFeedService: AnyService;
  recordFeedMethod: string;
  memberModel: new () => DatabaseBaseModel;
  episodeModel: new () => DatabaseBaseModel;
  recordModel: new () => DatabaseBaseModel;
  severityModel: new () => DatabaseBaseModel;
  addMethod: string;
  validateNewMethod: string;
  addNewMethod: string;
  createFeedMethod: string;
  countMethod: string;
  lastAddedMethod: string;
  episodeIdKey: string;
  idsKey: string;
  episodeIdColumn: string;
  recordIdColumn: string;
  recordSeverityIdColumn: string;
  founderFlag: string;
  numberWithPrefixColumn: string;
  numberColumn: string;
  notFoundReason: string;
  alreadyMessage: string;
  episodeRefusal: string;
  newEpisodeRefusal: string;
  // What the raise of the episode's severity was asked, as the kind asks it.
  severityRaise: (severityId: string) => Array<unknown>;
  // The new episode's validated answer's severity key.
  mostSevereKey: string;
  validatedIdsKey: string;
  addNewIdsKey: string;
  createFeedIdsKey: string;
  plural: string;
}

const KINDS: Array<Kind> = [
  {
    name: "alert",
    memberService: AlertEpisodeMemberService as unknown as AnyService,
    episodeService: AlertEpisodeService as unknown as AnyService,
    recordService: AlertService as unknown as AnyService,
    severityService: AlertSeverityService as unknown as AnyService,
    episodeFeedService: AlertEpisodeFeedService as unknown as AnyService,
    episodeFeedMethod: "createAlertEpisodeFeedItem",
    recordFeedService: AlertFeedService as unknown as AnyService,
    recordFeedMethod: "createAlertFeedItem",
    memberModel: AlertEpisodeMember,
    episodeModel: AlertEpisode,
    recordModel: Alert,
    severityModel: AlertSeverity,
    addMethod: "addAlertsToEpisode",
    validateNewMethod: "validateAlertsForNewEpisode",
    addNewMethod: "addAlertsToNewEpisode",
    createFeedMethod: "createAlertsAddedFeedItem",
    countMethod: "updateAlertCount",
    lastAddedMethod: "updateLastAlertAddedAt",
    episodeIdKey: "alertEpisodeId",
    idsKey: "alertIds",
    episodeIdColumn: "alertEpisodeId",
    recordIdColumn: "alertId",
    recordSeverityIdColumn: "alertSeverityId",
    founderFlag: "isOwnerNotifiedOfAlertAdded",
    numberWithPrefixColumn: "alertNumberWithPrefix",
    numberColumn: "alertNumber",
    notFoundReason: ALERT_NOT_FOUND_REASON,
    alreadyMessage: ALERT_ALREADY_IN_EPISODE_MESSAGE,
    episodeRefusal:
      "The episode to add the alerts to does not exist in this project, or you do not have access to it.",
    newEpisodeRefusal:
      "Some of the alerts to add to the episode do not exist in this project, or you do not have access to them.",
    severityRaise: (severityId: string): Array<unknown> => {
      return [
        {
          episodeId: EPISODE_ID,
          severityId: new ObjectID(severityId),
          onlyIfHigher: true,
        },
      ];
    },
    mostSevereKey: "mostSevereAlertSeverityId",
    validatedIdsKey: "alertIds",
    addNewIdsKey: "alertIds",
    createFeedIdsKey: "alertIds",
    plural: "alerts",
  },
  {
    name: "incident",
    memberService: IncidentEpisodeMemberService as unknown as AnyService,
    episodeService: IncidentEpisodeService as unknown as AnyService,
    recordService: IncidentService as unknown as AnyService,
    severityService: IncidentSeverityService as unknown as AnyService,
    episodeFeedService: IncidentEpisodeFeedService as unknown as AnyService,
    episodeFeedMethod: "createIncidentEpisodeFeedItem",
    recordFeedService: IncidentFeedService as unknown as AnyService,
    recordFeedMethod: "createIncidentFeedItem",
    memberModel: IncidentEpisodeMember,
    episodeModel: IncidentEpisode,
    recordModel: Incident,
    severityModel: IncidentSeverity,
    addMethod: "addIncidentsToEpisode",
    validateNewMethod: "validateIncidentsForNewEpisode",
    addNewMethod: "addIncidentsToNewEpisode",
    createFeedMethod: "createIncidentsAddedFeedItem",
    countMethod: "updateIncidentCount",
    lastAddedMethod: "updateLastIncidentAddedAt",
    episodeIdKey: "incidentEpisodeId",
    idsKey: "incidentIds",
    episodeIdColumn: "incidentEpisodeId",
    recordIdColumn: "incidentId",
    recordSeverityIdColumn: "incidentSeverityId",
    founderFlag: "isOwnerNotifiedOfIncidentAdded",
    numberWithPrefixColumn: "incidentNumberWithPrefix",
    numberColumn: "incidentNumber",
    notFoundReason: INCIDENT_NOT_FOUND_REASON,
    alreadyMessage: INCIDENT_ALREADY_IN_EPISODE_MESSAGE,
    episodeRefusal:
      "The episode to add the incidents to does not exist in this project, or you do not have access to it.",
    newEpisodeRefusal:
      "Some of the incidents to add to the episode do not exist in this project, or you do not have access to them.",
    severityRaise: (severityId: string): Array<unknown> => {
      return [EPISODE_ID, new ObjectID(severityId), true];
    },
    mostSevereKey: "mostSevereIncidentSeverityId",
    validatedIdsKey: "incidentIds",
    addNewIdsKey: "incidentIds",
    createFeedIdsKey: "incidentIds",
    plural: "incidents",
  },
];

function userProps(permission: Permission): DatabaseCommonInteractionProps {
  return {
    tenantId: PROJECT_ID,
    userId: PERSON_ID,
    userType: UserType.User,
    ...ON_HIGHEST_PLAN,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
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
      },
    },
  };
}

function apiKeyProps(): DatabaseCommonInteractionProps {
  const props: DatabaseCommonInteractionProps = userProps(
    Permission.ProjectAdmin,
  );
  delete props.userId;
  props.userType = UserType.API;
  props.apiKeyId = API_KEY_ID;
  props.apiKeyName = "Grafana bridge";
  return props;
}

function idOf(value: unknown): string {
  return String(value).toLowerCase();
}

// What the stand-in database holds, per test.
interface World {
  // The episode as the caller reads it; null when they cannot see it.
  episode: DatabaseBaseModel | null;
  // Records that exist in the project, and the severity each has.
  records: Record<string, string | undefined>;
  // Of those, the ones the caller cannot see.
  hidden: Array<string>;
  // Ids in the episode already.
  members: Array<string>;
  // Ids whose create fails, and with what.
  failures: Record<string, Error>;
}

let world: World;

// Each member create: the data, the props and the miscDataProps it was given.
let creates: Array<{
  data: Record<string, unknown>;
  props: DatabaseCommonInteractionProps;
  miscDataProps: Record<string, unknown> | undefined;
}>;

// Each read of the records: the query and the props it was made with.
let recordReads: Array<{
  query: Record<string, unknown>;
  props: DatabaseCommonInteractionProps;
}>;

function record(
  kind: Kind,
  id: string,
  extra: Record<string, unknown> = {},
): DatabaseBaseModel {
  const model: DatabaseBaseModel = new kind.recordModel();
  const values: Record<string, unknown> = model as unknown as Record<
    string,
    unknown
  >;
  values["_id"] = id;
  values["projectId"] = PROJECT_ID;
  values[kind.recordSeverityIdColumn] = world.records[id]
    ? new ObjectID(world.records[id]!)
    : undefined;
  Object.assign(values, extra);
  return model;
}

/*
 * The ids a QueryHelper.any filter asks for: a TypeORM Raw operator with
 * them as its one parameter.
 */
function idsOf(filter: unknown): Array<string> {
  const parameters: Record<string, unknown> =
    (filter as { objectLiteralParameters?: Record<string, unknown> })
      ?.objectLiteralParameters || {};
  const value: unknown = Object.values(parameters)[0];
  const ids: Array<unknown> = Array.isArray(value) ? value : [];
  return ids.map(idOf);
}

function idsIn(query: Record<string, unknown>): Array<string> {
  return idsOf(query["_id"]);
}

function stubWorld(kind: Kind): void {
  jest
    .spyOn(kind.episodeService, "findOneById")
    .mockImplementation((async () => {
      return world.episode;
    }) as never);

  jest.spyOn(kind.recordService, "findBy").mockImplementation((async (findBy: {
    query: Record<string, unknown>;
    props: DatabaseCommonInteractionProps;
  }) => {
    recordReads.push({ query: findBy.query, props: findBy.props });

    return idsIn(findBy.query)
      .filter((id: string): boolean => {
        return (
          Object.prototype.hasOwnProperty.call(world.records, id) &&
          (findBy.props.isRoot === true || !world.hidden.includes(id))
        );
      })
      .map((id: string): DatabaseBaseModel => {
        return record(kind, id, {
          title: `Title of ${id.slice(-3)}`,
          [kind.numberWithPrefixColumn]: `#${Number(id.slice(-3))}`,
        });
      });
  }) as never);

  jest.spyOn(kind.memberService, "findBy").mockImplementation((async (findBy: {
    query: Record<string, unknown>;
  }) => {
    const ids: Array<string> = idsOf(findBy.query[kind.recordIdColumn]);

    return world.members
      .filter((id: string): boolean => {
        return ids.includes(id);
      })
      .map((id: string): DatabaseBaseModel => {
        const member: DatabaseBaseModel = new kind.memberModel();
        (member as unknown as Record<string, unknown>)[kind.recordIdColumn] =
          new ObjectID(id);
        return member;
      });
  }) as never);

  jest
    .spyOn(kind.memberService, "create")
    .mockImplementation((async (createBy: {
      data: DatabaseBaseModel;
      props: DatabaseCommonInteractionProps;
      miscDataProps?: Record<string, unknown>;
    }) => {
      const data: Record<string, unknown> = createBy.data as unknown as Record<
        string,
        unknown
      >;
      creates.push({
        data: data,
        props: createBy.props,
        miscDataProps: createBy.miscDataProps,
      });

      const id: string = idOf(data[kind.recordIdColumn]);

      if (world.failures[id]) {
        throw world.failures[id];
      }

      return createBy.data;
    }) as never);

  jest
    .spyOn(kind.severityService, "findBy")
    .mockImplementation((async (findBy: { query: Record<string, unknown> }) => {
      return idsIn(findBy.query).map((id: string): DatabaseBaseModel => {
        const severity: DatabaseBaseModel = new kind.severityModel();
        (severity as unknown as Record<string, unknown>)["_id"] = id;
        (severity as unknown as Record<string, unknown>)["order"] =
          SEVERITY_ORDER[id];
        return severity;
      });
    }) as never);

  jest
    .spyOn(kind.episodeService, kind.countMethod)
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(kind.episodeService, kind.lastAddedMethod)
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(kind.episodeService, "updateEpisodeSeverity")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(kind.episodeFeedService, kind.episodeFeedMethod)
    .mockResolvedValue(undefined as never);
}

function theEpisode(kind: Kind, projectId: ObjectID): DatabaseBaseModel {
  const episode: DatabaseBaseModel = new kind.episodeModel();
  (episode as unknown as Record<string, unknown>)["_id"] =
    EPISODE_ID.toString();
  (episode as unknown as Record<string, unknown>)["projectId"] = projectId;
  return episode;
}

async function add(
  kind: Kind,
  ids: unknown,
  props: DatabaseCommonInteractionProps = userProps(Permission.ProjectAdmin),
): Promise<EpisodeMembersAddResult> {
  return (await kind.memberService[kind.addMethod]!({
    [kind.episodeIdKey]: EPISODE_ID.toString(),
    [kind.idsKey]: ids,
    props: props,
  })) as EpisodeMembersAddResult;
}

async function refusalOf(promise: Promise<unknown>): Promise<Error> {
  let outcome: unknown = "went on";

  try {
    await promise;
  } catch (error) {
    outcome = error;
  }

  expect(outcome).toBeInstanceOf(Error);
  return outcome as Error;
}

beforeEach(() => {
  stubProjectDirectory({});
  creates = [];
  recordReads = [];
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(KINDS)(
  "adding $plural to an episode that exists",
  (kind: Kind) => {
    beforeEach(() => {
      world = {
        episode: theEpisode(kind, PROJECT_ID),
        records: {
          [recordId(1)]: MINOR_ID,
          [recordId(2)]: CRITICAL_ID,
          [recordId(3)]: MAJOR_ID,
          [recordId(4)]: CRITICAL_ID,
          [recordId(5)]: undefined,
        },
        hidden: [],
        members: [],
        failures: {},
      };
      stubWorld(kind);
    });

    test("a person who may not add to episodes is refused before anything is read", async () => {
      const error: Error = await refusalOf(
        add(kind, [recordId(1)], userProps(Permission.Viewer)),
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect(kind.episodeService["findOneById"]).not.toHaveBeenCalled();
      expect(recordReads).toEqual([]);
      expect(creates).toEqual([]);
    });

    test("a read-only API key is refused before anything is read", async () => {
      const props: DatabaseCommonInteractionProps = apiKeyProps();
      props.isReadOnlyCredential = true;

      await refusalOf(add(kind, [recordId(1)], props));

      expect(creates).toEqual([]);
      expect(recordReads).toEqual([]);
    });

    test("an episode the person cannot see is refused as one that does not exist", async () => {
      world.episode = null;

      const error: Error = await refusalOf(add(kind, [recordId(1)]));

      expect(error).toBeInstanceOf(BadDataException);
      expect(error.message).toBe(kind.episodeRefusal);
      expect(creates).toEqual([]);
    });

    test("an episode whose read is refused gets the same answer", async () => {
      jest
        .spyOn(kind.episodeService, "findOneById")
        .mockRejectedValue(
          new NotAuthorizedException(
            "You do not have permission to read",
          ) as never,
        );

      const error: Error = await refusalOf(add(kind, [recordId(1)]));

      expect(error.message).toBe(kind.episodeRefusal);
    });

    test("an episode of another project gets the same answer", async () => {
      world.episode = theEpisode(kind, OTHER_PROJECT_ID);

      const error: Error = await refusalOf(add(kind, [recordId(1)]));

      expect(error.message).toBe(kind.episodeRefusal);
      expect(creates).toEqual([]);
    });

    test("a request with no project on it is refused", async () => {
      const props: DatabaseCommonInteractionProps = userProps(
        Permission.ProjectAdmin,
      );
      delete props.tenantId;

      const error: Error = await refusalOf(add(kind, [recordId(1)], props));

      expect(error.message).toBe(
        `A project is required to add ${kind.plural} to an episode.`,
      );
    });

    test("ids that are not ids are refused before anything is read", async () => {
      const error: Error = await refusalOf(add(kind, ["project-1"]));

      expect(error).toBeInstanceOf(BadDataException);
      expect(kind.episodeService["findOneById"]).not.toHaveBeenCalled();
    });

    test("each id is answered once, in the order named: added, in already, or not added and why", async () => {
      world.members = [recordId(3)];
      world.hidden = [recordId(4)];

      const result: EpisodeMembersAddResult = await add(kind, [
        recordId(2),
        recordId(3),
        recordId(4),
        recordId(9),
        recordId(1),
        recordId(2).toUpperCase(),
      ]);

      expect(result).toEqual({
        added: [recordId(2), recordId(1)],
        alreadyInEpisode: [recordId(3)],
        notAdded: [
          { id: recordId(4), reason: kind.notFoundReason },
          { id: recordId(9), reason: kind.notFoundReason },
        ],
      });
    });

    test("the records are read as the person, in the project", async () => {
      const props: DatabaseCommonInteractionProps = userProps(
        Permission.ProjectAdmin,
      );

      await add(kind, [recordId(1), recordId(2)], props);

      expect(recordReads[0]!.props).toBe(props);
      expect(idOf(recordReads[0]!.query["projectId"])).toBe(idOf(PROJECT_ID));
      expect(idsIn(recordReads[0]!.query)).toEqual([recordId(1), recordId(2)]);
    });

    test("each added one is the member service's own create, as OneUptime's write for the person, marked as added together", async () => {
      await add(kind, [recordId(1)]);

      expect(creates).toHaveLength(1);
      const created: (typeof creates)[number] = creates[0]!;

      expect(created.props).toEqual({ isRoot: true });
      expect(created.miscDataProps).toEqual({
        [EPISODE_MEMBER_ADDED_TOGETHER_KEY]: true,
      });
      expect(idOf(created.data["projectId"])).toBe(idOf(PROJECT_ID));
      expect(idOf(created.data[kind.episodeIdColumn])).toBe(idOf(EPISODE_ID));
      expect(idOf(created.data[kind.recordIdColumn])).toBe(recordId(1));
      expect(created.data["addedBy"]).toBe("manual");
      expect(idOf(created.data["addedByUserId"])).toBe(idOf(PERSON_ID));
      expect(idOf(created.data["createdByUserId"])).toBe(idOf(PERSON_ID));
      expect(created.data["addedAt"]).toBeInstanceOf(Date);
      // Not a founder: its owners are told it was added, as for one added alone.
      expect(created.data[kind.founderFlag]).toBeUndefined();
    });

    test("an API key adds as the API, naming no person", async () => {
      await add(kind, [recordId(1)], apiKeyProps());

      const created: (typeof creates)[number] = creates[0]!;

      expect(created.data["addedBy"]).toBe("api");
      expect(created.data["addedByUserId"]).toBeUndefined();
      expect(created.data["createdByUserId"]).toBeUndefined();

      if (kind.name === "incident") {
        // The incident's own entry names the key, as an incident added alone does.
        expect(created.props).toEqual({
          isRoot: true,
          apiKeyId: API_KEY_ID,
          apiKeyName: "Grafana bridge",
        });
      } else {
        expect(created.props).toEqual({ isRoot: true });
      }
    });

    test("one that turns out to be in the episode already - two adds racing - is in it already", async () => {
      world.failures[recordId(1)] = new BadDataException(kind.alreadyMessage);

      const result: EpisodeMembersAddResult = await add(kind, [
        recordId(1),
        recordId(2),
      ]);

      expect(result.added).toEqual([recordId(2)]);
      expect(result.alreadyInEpisode).toEqual([recordId(1)]);
      expect(result.notAdded).toEqual([]);
    });

    test("any other failure is that one's reason, and the rest are still added", async () => {
      world.failures[recordId(2)] = new BadDataException(
        "The alert was deleted a moment ago.",
      );

      const result: EpisodeMembersAddResult = await add(kind, [
        recordId(1),
        recordId(2),
        recordId(3),
      ]);

      expect(result.added).toEqual([recordId(1), recordId(3)]);
      expect(result.notAdded).toEqual([
        { id: recordId(2), reason: "The alert was deleted a moment ago." },
      ]);
    });

    test("the episode's side is written once for all of them", async () => {
      await add(kind, [recordId(1), recordId(2), recordId(3)]);

      expect(kind.episodeService[kind.countMethod]).toHaveBeenCalledTimes(1);
      expect(kind.episodeService[kind.countMethod]).toHaveBeenCalledWith(
        EPISODE_ID,
      );
      expect(kind.episodeService[kind.lastAddedMethod]).toHaveBeenCalledTimes(
        1,
      );
      expect(
        kind.episodeService["updateEpisodeSeverity"],
      ).toHaveBeenCalledTimes(1);
      expect(
        kind.episodeFeedService[kind.episodeFeedMethod],
      ).toHaveBeenCalledTimes(1);
    });

    test("the episode's severity rises to the most severe one added, only if higher", async () => {
      await add(kind, [recordId(1), recordId(3), recordId(2)]);

      expect(kind.episodeService["updateEpisodeSeverity"]).toHaveBeenCalledWith(
        ...kind.severityRaise(CRITICAL_ID),
      );
    });

    test("the entry naming them comes before the severity they raised", async () => {
      await add(kind, [recordId(1), recordId(2)]);

      const entryWritten: number = (
        kind.episodeFeedService[kind.episodeFeedMethod] as jest.Mock
      ).mock.invocationCallOrder[0]!;
      const severityRaised: number = (
        kind.episodeService["updateEpisodeSeverity"] as jest.Mock
      ).mock.invocationCallOrder[0]!;

      expect(entryWritten).toBeLessThan(severityRaised);
    });

    test("a more severe one that was not added does not raise it", async () => {
      // recordId(4) is critical, but hidden from the person.
      world.hidden = [recordId(4)];

      await add(kind, [recordId(1), recordId(4), recordId(3)]);

      expect(kind.episodeService["updateEpisodeSeverity"]).toHaveBeenCalledWith(
        ...kind.severityRaise(MAJOR_ID),
      );
    });

    test("no severity among those added leaves the episode's alone", async () => {
      await add(kind, [recordId(5)]);

      expect(
        kind.episodeService["updateEpisodeSeverity"],
      ).not.toHaveBeenCalled();
      expect(kind.episodeService[kind.countMethod]).toHaveBeenCalledTimes(1);
    });

    test("the one feed entry names every one added, by the person, and is posted to Slack and Teams once", async () => {
      await add(kind, [recordId(1), recordId(2), recordId(3)]);

      const entry: Record<string, unknown> = (
        kind.episodeFeedService[kind.episodeFeedMethod] as jest.Mock
      ).mock.calls[0]![0] as Record<string, unknown>;

      expect(String(entry["feedInfoInMarkdown"]).split("\n")[0]).toBe(
        `**3 ${kind.plural}** added to episode:`,
      );
      expect(String(entry["feedInfoInMarkdown"])).toContain(`: Title of 001`);
      expect(idOf(entry["userId"])).toBe(idOf(PERSON_ID));
      expect(entry["workspaceNotification"]).toEqual({
        sendWorkspaceNotification: true,
        leadWithAuthor: true,
      });
    });

    test("nothing added writes nothing on the episode", async () => {
      world.members = [recordId(1)];
      world.hidden = [recordId(2)];

      const result: EpisodeMembersAddResult = await add(kind, [
        recordId(1),
        recordId(2),
      ]);

      expect(result.added).toEqual([]);
      expect(creates).toEqual([]);
      expect(kind.episodeService[kind.countMethod]).not.toHaveBeenCalled();
      expect(kind.episodeService[kind.lastAddedMethod]).not.toHaveBeenCalled();
      expect(
        kind.episodeService["updateEpisodeSeverity"],
      ).not.toHaveBeenCalled();
      expect(
        kind.episodeFeedService[kind.episodeFeedMethod],
      ).not.toHaveBeenCalled();
    });

    test("a step of the episode's side that fails does not undo what was added", async () => {
      jest
        .spyOn(kind.episodeService, kind.countMethod)
        .mockRejectedValue(new Error("database hiccup") as never);

      const result: EpisodeMembersAddResult = await add(kind, [recordId(1)]);

      expect(result.added).toEqual([recordId(1)]);
      expect(
        kind.episodeFeedService[kind.episodeFeedMethod],
      ).toHaveBeenCalledTimes(1);
    });
  },
);

describe.each(KINDS)("creating an episode with $plural", (kind: Kind) => {
  beforeEach(() => {
    world = {
      episode: theEpisode(kind, PROJECT_ID),
      records: {
        [recordId(1)]: MINOR_ID,
        [recordId(2)]: CRITICAL_ID,
        [recordId(3)]: undefined,
      },
      hidden: [],
      members: [],
      failures: {},
    };
    stubWorld(kind);
  });

  test("every record must be one the person can see: the ids come back, with the most severe severity", async () => {
    const props: DatabaseCommonInteractionProps = userProps(
      Permission.ProjectAdmin,
    );

    const validated: Record<string, unknown> = (await kind.memberService[
      kind.validateNewMethod
    ]!({
      projectId: PROJECT_ID,
      [kind.idsKey]: [recordId(1), recordId(2), recordId(1)],
      props: props,
    })) as Record<string, unknown>;

    expect(
      (validated[kind.validatedIdsKey] as Array<ObjectID>).map(idOf),
    ).toEqual([recordId(1), recordId(2)]);
    expect(idOf(validated[kind.mostSevereKey])).toBe(CRITICAL_ID);
    expect(recordReads[0]!.props).toBe(props);
  });

  test("no severity among them is none", async () => {
    const validated: Record<string, unknown> = (await kind.memberService[
      kind.validateNewMethod
    ]!({
      projectId: PROJECT_ID,
      [kind.idsKey]: [recordId(3)],
      props: userProps(Permission.ProjectAdmin),
    })) as Record<string, unknown>;

    expect(validated[kind.mostSevereKey]).toBeNull();
  });

  test("one the person cannot see refuses the whole create", async () => {
    world.hidden = [recordId(2)];

    const error: Error = await refusalOf(
      kind.memberService[kind.validateNewMethod]!({
        projectId: PROJECT_ID,
        [kind.idsKey]: [recordId(1), recordId(2)],
        props: userProps(Permission.ProjectAdmin),
      }),
    );

    expect(error.message).toBe(kind.newEpisodeRefusal);
  });

  test("a person who may not add to episodes is refused before the records are read", async () => {
    const error: Error = await refusalOf(
      kind.memberService[kind.validateNewMethod]!({
        projectId: PROJECT_ID,
        [kind.idsKey]: [recordId(1)],
        props: userProps(Permission.Viewer),
      }),
    );

    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect(recordReads).toEqual([]);
  });

  test("they are added as founding members: the episode's created notification covers them", async () => {
    const added: Array<ObjectID> = (await kind.memberService[
      kind.addNewMethod
    ]!({
      projectId: PROJECT_ID,
      [kind.episodeIdKey]: EPISODE_ID,
      [kind.addNewIdsKey]: [
        new ObjectID(recordId(1)),
        new ObjectID(recordId(2)),
      ],
      addedByUserId: PERSON_ID,
    })) as Array<ObjectID>;

    expect(added.map(idOf)).toEqual([recordId(1), recordId(2)]);
    expect(creates).toHaveLength(2);

    for (const created of creates) {
      expect(created.data[kind.founderFlag]).toBe(true);
      expect(created.miscDataProps).toEqual({
        [EPISODE_MEMBER_ADDED_TOGETHER_KEY]: true,
      });
      expect(idOf(created.data["addedByUserId"])).toBe(idOf(PERSON_ID));
    }
  });

  test("the episode is recounted once, keeps the severity it was created with, and its entry is left to the create", async () => {
    await kind.memberService[kind.addNewMethod]!({
      projectId: PROJECT_ID,
      [kind.episodeIdKey]: EPISODE_ID,
      [kind.addNewIdsKey]: [
        new ObjectID(recordId(1)),
        new ObjectID(recordId(2)),
      ],
      addedByUserId: PERSON_ID,
    });

    expect(kind.episodeService[kind.countMethod]).toHaveBeenCalledTimes(1);
    expect(kind.episodeService[kind.lastAddedMethod]).toHaveBeenCalledTimes(1);
    expect(kind.episodeService["updateEpisodeSeverity"]).not.toHaveBeenCalled();
    expect(
      kind.episodeFeedService[kind.episodeFeedMethod],
    ).not.toHaveBeenCalled();
  });

  test("one that cannot be added is left out, and never fails the episode", async () => {
    world.failures[recordId(1)] = new Error("gone");

    const added: Array<ObjectID> = (await kind.memberService[
      kind.addNewMethod
    ]!({
      projectId: PROJECT_ID,
      [kind.episodeIdKey]: EPISODE_ID,
      [kind.addNewIdsKey]: [
        new ObjectID(recordId(1)),
        new ObjectID(recordId(2)),
      ],
      addedByUserId: undefined,
    })) as Array<ObjectID>;

    expect(added.map(idOf)).toEqual([recordId(2)]);
  });

  test("the entry naming them is read as OneUptime, in the order they were added, and is posted once", async () => {
    await kind.memberService[kind.createFeedMethod]!({
      projectId: PROJECT_ID,
      [kind.episodeIdKey]: EPISODE_ID,
      [kind.createFeedIdsKey]: [
        new ObjectID(recordId(2)),
        new ObjectID(recordId(1)),
      ],
      addedByUserId: PERSON_ID,
    });

    expect(recordReads[0]!.props).toEqual({ isRoot: true });

    const entry: Record<string, unknown> = (
      kind.episodeFeedService[kind.episodeFeedMethod] as jest.Mock
    ).mock.calls[0]![0] as Record<string, unknown>;

    const lines: Array<string> = String(entry["feedInfoInMarkdown"]).split(
      "\n",
    );

    expect(lines[0]).toBe(`**2 ${kind.plural}** added to episode:`);
    expect(lines[2]).toContain("Title of 002");
    expect(lines[3]).toContain("Title of 001");
  });

  test("no entry when none of them exists any more", async () => {
    await kind.memberService[kind.createFeedMethod]!({
      projectId: PROJECT_ID,
      [kind.episodeIdKey]: EPISODE_ID,
      [kind.createFeedIdsKey]: [new ObjectID(recordId(9))],
      addedByUserId: PERSON_ID,
    });

    expect(
      kind.episodeFeedService[kind.episodeFeedMethod],
    ).not.toHaveBeenCalled();
  });
});

describe.each(KINDS)(
  "a $name member created as one of several added together",
  (kind: Kind) => {
    type SuccessHook = (onCreate: unknown, item: unknown) => Promise<unknown>;

    beforeEach(() => {
      world = {
        episode: theEpisode(kind, PROJECT_ID),
        records: { [recordId(1)]: MINOR_ID },
        hidden: [],
        members: [],
        failures: {},
      };
      stubWorld(kind);

      jest
        .spyOn(kind.recordService, "updateOneById")
        .mockResolvedValue(1 as never);
      jest
        .spyOn(kind.recordService, "findOneById")
        .mockResolvedValue(record(kind, recordId(1)) as never);
      jest
        .spyOn(kind.recordFeedService, kind.recordFeedMethod)
        .mockResolvedValue(undefined as never);
    });

    function created(): DatabaseBaseModel {
      const member: DatabaseBaseModel = new kind.memberModel();
      const values: Record<string, unknown> = member as unknown as Record<
        string,
        unknown
      >;
      values["_id"] = ObjectID.generate().toString();
      values["projectId"] = PROJECT_ID;
      values[kind.episodeIdColumn] = EPISODE_ID;
      values[kind.recordIdColumn] = new ObjectID(recordId(1));
      return member;
    }

    async function succeed(
      props: DatabaseCommonInteractionProps,
      miscDataProps: Record<string, unknown> | undefined,
    ): Promise<void> {
      await (
        kind.memberService as unknown as { onCreateSuccess: SuccessHook }
      ).onCreateSuccess(
        { createBy: { data: created(), props, miscDataProps } },
        created(),
      );
    }

    test("writes its record's side - the episode it is in, its own entry - and leaves the episode's to the batch", async () => {
      await succeed(
        { isRoot: true },
        { [EPISODE_MEMBER_ADDED_TOGETHER_KEY]: true },
      );

      expect(kind.recordService["updateOneById"]).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { [kind.episodeIdColumn]: EPISODE_ID },
        }),
      );
      expect(
        kind.recordFeedService[kind.recordFeedMethod],
      ).toHaveBeenCalledTimes(1);
      expect(
        kind.episodeFeedService[kind.episodeFeedMethod],
      ).not.toHaveBeenCalled();
      expect(kind.episodeService[kind.countMethod]).not.toHaveBeenCalled();
      expect(kind.episodeService[kind.lastAddedMethod]).not.toHaveBeenCalled();
    });

    test("one added on its own still writes the episode's side, in the words it always did", async () => {
      await succeed({ isRoot: true }, undefined);

      expect(kind.episodeService[kind.countMethod]).toHaveBeenCalledTimes(1);
      expect(kind.episodeService[kind.lastAddedMethod]).toHaveBeenCalledTimes(
        1,
      );

      const entry: Record<string, unknown> = (
        kind.episodeFeedService[kind.episodeFeedMethod] as jest.Mock
      ).mock.calls[0]![0] as Record<string, unknown>;

      expect(String(entry["feedInfoInMarkdown"])).toMatch(
        / added to episode: Title of 001$|added to episode: No title$/,
      );
    });

    test("an API client sending the marker still gets the episode's entry", async () => {
      await succeed(userProps(Permission.ProjectAdmin), {
        [EPISODE_MEMBER_ADDED_TOGETHER_KEY]: true,
      });

      expect(
        kind.episodeFeedService[kind.episodeFeedMethod],
      ).toHaveBeenCalledTimes(1);
      expect(kind.episodeService[kind.countMethod]).toHaveBeenCalledTimes(1);
    });
  },
);
