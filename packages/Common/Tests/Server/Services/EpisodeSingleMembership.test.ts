import AlertEpisodeFeedService from "../../../Server/Services/AlertEpisodeFeedService";
import AlertEpisodeMemberService, {
  ALERT_ALREADY_IN_EPISODE_MESSAGE,
} from "../../../Server/Services/AlertEpisodeMemberService";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertService from "../../../Server/Services/AlertService";
import AlertSeverityService from "../../../Server/Services/AlertSeverityService";
import IncidentEpisodeFeedService from "../../../Server/Services/IncidentEpisodeFeedService";
import IncidentEpisodeMemberService, {
  INCIDENT_ALREADY_IN_EPISODE_MESSAGE,
} from "../../../Server/Services/IncidentEpisodeMemberService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import ProjectService from "../../../Server/Services/ProjectService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import EpisodeSingleMembershipCheck, {
  RecordInAnotherEpisodeException,
} from "../../../Server/Utils/Episode/EpisodeSingleMembershipCheck";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import AlertEpisodeMember, {
  AlertEpisodeMemberAddedBy,
} from "../../../Models/DatabaseModels/AlertEpisodeMember";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeMember, {
  IncidentEpisodeMemberAddedBy,
} from "../../../Models/DatabaseModels/IncidentEpisodeMember";
import Project from "../../../Models/DatabaseModels/Project";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { EpisodeMembersAddResult } from "../../../Types/Episode/EpisodeMembersAdd";
import {
  ALERT_IN_ANOTHER_EPISODE_REASON,
  ALERT_SINGLE_MEMBERSHIP,
  EpisodeSingleMembershipKind,
  INCIDENT_IN_ANOTHER_EPISODE_REASON,
  INCIDENT_SINGLE_MEMBERSHIP,
} from "../../../Types/Episode/EpisodeSingleMembership";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
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
 * ONE EPISODE PER INCIDENT, OR PER ALERT (EpisodeSingleMembership).
 *
 * The maintainer: "Currently, we are able to add one incident to many
 * incident episodes and one alert to many alert episode. Some customers dont
 * want that, so can we create a setting in alert / incident settings to
 * allow alert to be in only one episode and same for incidents."
 *
 * A project's switch - Project.limitIncidentsToOneEpisode /
 * limitAlertsToOneEpisode, off by default - and, while it is on, every way a
 * record joins an episode refuses one that is in another episode already:
 *
 *   - one member created on its own (the API, a workflow, Terraform, the
 *     grouping engine's own write): refused, naming the record and - when
 *     the caller can see it - the episode it is in;
 *   - several added together: each such one is not added, with a fixed
 *     reason, and the rest are;
 *   - an episode created with them: the whole create is refused, naming
 *     them.
 *
 * While it is off, nothing changes: a record joins as many episodes as
 * before. The project is read only for a record that is in an episode: the
 * usual add - one in no episode - never reads it.
 *
 * The member services' own code runs; the reads and writes they make are
 * stand-ins. EpisodeMembersBulkAddPostgres runs the same against a migrated
 * Postgres.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0194e9a1-51e0-4a00-8000-000000000001",
);
// The episode being added to.
const TARGET_EPISODE_ID: string = "0194e9a1-51e0-4a00-8000-0000000000e5";
// Two other episodes a record can be in already.
const OTHER_EPISODE_ID: string = "0194e9a1-51e0-4a00-8000-0000000000e3";
const LATER_EPISODE_ID: string = "0194e9a1-51e0-4a00-8000-0000000000e4";
const PERSON_ID: ObjectID = new ObjectID(
  "0194e9a1-51e0-4a00-8000-0000000000a1",
);

const EPISODE_NUMBERS: Record<string, number> = {
  [TARGET_EPISODE_ID]: 5,
  [OTHER_EPISODE_ID]: 3,
  [LATER_EPISODE_ID]: 4,
};

type RecordIdFunction = (index: number) => string;

const recordId: RecordIdFunction = (index: number): string => {
  return `0194e9a1-51e0-4a00-8000-${index.toString().padStart(12, "0")}`;
};

// Record n is number 10 + n: INC-11, ALT-11, ...
type RecordNumberFunction = (id: string) => number;

const recordNumber: RecordNumberFunction = (id: string): number => {
  return 10 + Number(id.slice(-3));
};

type AnyFunction = (...args: Array<any>) => any;
type AnyService = Record<string, AnyFunction>;

interface Kind {
  name: "incident" | "alert";
  title: "Incident" | "Alert";
  plural: "incidents" | "alerts";
  memberService: AnyService;
  episodeService: AnyService;
  recordService: AnyService;
  severityService: AnyService;
  episodeFeedService: AnyService;
  episodeFeedMethod: string;
  memberModel: new () => DatabaseBaseModel;
  episodeModel: new () => DatabaseBaseModel;
  recordModel: new () => DatabaseBaseModel;
  recordIdColumn: "incidentId" | "alertId";
  episodeIdColumn: "incidentEpisodeId" | "alertEpisodeId";
  numberColumn: "incidentNumber" | "alertNumber";
  numberWithPrefixColumn: "incidentNumberWithPrefix" | "alertNumberWithPrefix";
  heldMethod: "findIncidentIdsHeldInEpisodes" | "findAlertIdsHeldInEpisodes";
  addMethod: "addIncidentsToEpisode" | "addAlertsToEpisode";
  validateNewMethod:
    | "validateIncidentsForNewEpisode"
    | "validateAlertsForNewEpisode";
  countMethod: "updateIncidentCount" | "updateAlertCount";
  lastAddedMethod: "updateLastIncidentAddedAt" | "updateLastAlertAddedAt";
  episodeIdKey: "incidentEpisodeId" | "alertEpisodeId";
  idsKey: "incidentIds" | "alertIds";
  singleMembership: EpisodeSingleMembershipKind;
  inAnotherEpisodeReason: string;
  alreadyMessage: string;
  notVisibleRefusal: string;
  newEpisodeNotVisibleRefusal: string;
  recordPrefix: "INC-" | "ALT-";
  episodePrefix: "IE-" | "AE-";
  addedByApi: string;
}

const KINDS: Array<Kind> = [
  {
    name: "incident",
    title: "Incident",
    plural: "incidents",
    memberService: IncidentEpisodeMemberService as unknown as AnyService,
    episodeService: IncidentEpisodeService as unknown as AnyService,
    recordService: IncidentService as unknown as AnyService,
    severityService: IncidentSeverityService as unknown as AnyService,
    episodeFeedService: IncidentEpisodeFeedService as unknown as AnyService,
    episodeFeedMethod: "createIncidentEpisodeFeedItem",
    memberModel: IncidentEpisodeMember,
    episodeModel: IncidentEpisode,
    recordModel: Incident,
    recordIdColumn: "incidentId",
    episodeIdColumn: "incidentEpisodeId",
    numberColumn: "incidentNumber",
    numberWithPrefixColumn: "incidentNumberWithPrefix",
    heldMethod: "findIncidentIdsHeldInEpisodes",
    addMethod: "addIncidentsToEpisode",
    validateNewMethod: "validateIncidentsForNewEpisode",
    countMethod: "updateIncidentCount",
    lastAddedMethod: "updateLastIncidentAddedAt",
    episodeIdKey: "incidentEpisodeId",
    idsKey: "incidentIds",
    singleMembership: INCIDENT_SINGLE_MEMBERSHIP,
    inAnotherEpisodeReason: INCIDENT_IN_ANOTHER_EPISODE_REASON,
    alreadyMessage: INCIDENT_ALREADY_IN_EPISODE_MESSAGE,
    notVisibleRefusal:
      "The incident to add does not exist in this project, or you do not have access to it.",
    newEpisodeNotVisibleRefusal:
      "Some of the incidents to add to the episode do not exist in this project, or you do not have access to them.",
    recordPrefix: "INC-",
    episodePrefix: "IE-",
    addedByApi: IncidentEpisodeMemberAddedBy.API,
  },
  {
    name: "alert",
    title: "Alert",
    plural: "alerts",
    memberService: AlertEpisodeMemberService as unknown as AnyService,
    episodeService: AlertEpisodeService as unknown as AnyService,
    recordService: AlertService as unknown as AnyService,
    severityService: AlertSeverityService as unknown as AnyService,
    episodeFeedService: AlertEpisodeFeedService as unknown as AnyService,
    episodeFeedMethod: "createAlertEpisodeFeedItem",
    memberModel: AlertEpisodeMember,
    episodeModel: AlertEpisode,
    recordModel: Alert,
    recordIdColumn: "alertId",
    episodeIdColumn: "alertEpisodeId",
    numberColumn: "alertNumber",
    numberWithPrefixColumn: "alertNumberWithPrefix",
    heldMethod: "findAlertIdsHeldInEpisodes",
    addMethod: "addAlertsToEpisode",
    validateNewMethod: "validateAlertsForNewEpisode",
    countMethod: "updateAlertCount",
    lastAddedMethod: "updateLastAlertAddedAt",
    episodeIdKey: "alertEpisodeId",
    idsKey: "alertIds",
    singleMembership: ALERT_SINGLE_MEMBERSHIP,
    inAnotherEpisodeReason: ALERT_IN_ANOTHER_EPISODE_REASON,
    alreadyMessage: ALERT_ALREADY_IN_EPISODE_MESSAGE,
    notVisibleRefusal:
      "The alert to add does not exist in this project, or you do not have access to it.",
    newEpisodeNotVisibleRefusal:
      "Some of the alerts to add to the episode do not exist in this project, or you do not have access to them.",
    recordPrefix: "ALT-",
    episodePrefix: "AE-",
    addedByApi: AlertEpisodeMemberAddedBy.API,
  },
];

function userProps(): DatabaseCommonInteractionProps {
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
            permission: Permission.ProjectAdmin,
            labelIds: [],
            isBlockPermission: false,
          },
        ],
      },
    },
  };
}

function idOf(value: unknown): string {
  return String(value).toLowerCase();
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

// What the stand-in database holds, per test.
interface World {
  // The project's two switches; null when the project is not found.
  project: { incidents: boolean; alerts: boolean } | null;
  // Each record's episodes, oldest first.
  memberships: Record<string, Array<string>>;
  // Records that exist; the caller cannot see the hidden ones.
  records: Array<string>;
  hidden: Array<string>;
  // Episodes the caller cannot see.
  hiddenEpisodes: Array<string>;
  // Records whose member create fails, and with what.
  failures: Record<string, Error>;
}

let world: World;

// Every read of the project, with what it was asked.
let projectReads: Array<{
  id: string;
  select: Record<string, unknown>;
  props: DatabaseCommonInteractionProps;
}>;

// Every member created, by its record.
let creates: Array<string>;

// Every read of the member rows, with its query.
let memberReads: Array<{
  query: Record<string, unknown>;
  sort?: Record<string, unknown> | undefined;
  props: DatabaseCommonInteractionProps;
}>;

function member(
  kind: Kind,
  record: string,
  episode: string,
): DatabaseBaseModel {
  const row: DatabaseBaseModel = new kind.memberModel();
  const values: Record<string, unknown> = row as unknown as Record<
    string,
    unknown
  >;
  values["_id"] = ObjectID.generate().toString();
  values["projectId"] = PROJECT_ID;
  values[kind.recordIdColumn] = new ObjectID(record);
  values[kind.episodeIdColumn] = new ObjectID(episode);
  return row;
}

function recordModel(kind: Kind, id: string): DatabaseBaseModel {
  const model: DatabaseBaseModel = new kind.recordModel();
  const values: Record<string, unknown> = model as unknown as Record<
    string,
    unknown
  >;
  values["_id"] = id;
  values["projectId"] = PROJECT_ID;
  values["title"] = `Title of ${id.slice(-3)}`;
  values[kind.numberColumn] = recordNumber(id);
  values[kind.numberWithPrefixColumn] =
    `${kind.recordPrefix}${recordNumber(id)}`;
  return model;
}

function episodeModel(kind: Kind, id: string): DatabaseBaseModel {
  const model: DatabaseBaseModel = new kind.episodeModel();
  const values: Record<string, unknown> = model as unknown as Record<
    string,
    unknown
  >;
  values["_id"] = id;
  values["projectId"] = PROJECT_ID;
  values["episodeNumber"] = EPISODE_NUMBERS[id];
  values["episodeNumberWithPrefix"] =
    `${kind.episodePrefix}${EPISODE_NUMBERS[id]}`;
  return model;
}

function stubWorld(kind: Kind): void {
  stubProjectDirectory({});

  jest.spyOn(ProjectService, "findOneById").mockImplementation((async (data: {
    id: ObjectID;
    select: Record<string, unknown>;
    props: DatabaseCommonInteractionProps;
  }) => {
    projectReads.push({
      id: idOf(data.id),
      select: data.select,
      props: data.props,
    });

    if (!world.project) {
      return null;
    }

    const project: Project = new Project();
    project._id = PROJECT_ID.toString();
    project.limitIncidentsToOneEpisode = world.project.incidents;
    project.limitAlertsToOneEpisode = world.project.alerts;
    return project;
  }) as never);

  // One row: the duplicate check (this episode), or the latest membership.
  jest
    .spyOn(kind.memberService, "findOneBy")
    .mockImplementation((async (findBy: {
      query: Record<string, unknown>;
      sort?: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    }) => {
      memberReads.push({
        query: findBy.query,
        sort: findBy.sort,
        props: findBy.props,
      });

      const record: string = idOf(findBy.query[kind.recordIdColumn]);
      const episodes: Array<string> = world.memberships[record] || [];

      if (findBy.query[kind.episodeIdColumn] !== undefined) {
        const episode: string = idOf(findBy.query[kind.episodeIdColumn]);
        return episodes.includes(episode)
          ? member(kind, record, episode)
          : null;
      }

      const latest: string | undefined = episodes[episodes.length - 1];
      return latest ? member(kind, record, latest) : null;
    }) as never);

  // Several rows: of this episode, or of any.
  jest.spyOn(kind.memberService, "findBy").mockImplementation((async (findBy: {
    query: Record<string, unknown>;
    props: DatabaseCommonInteractionProps;
  }) => {
    memberReads.push({ query: findBy.query, props: findBy.props });

    const ids: Array<string> = idsOf(findBy.query[kind.recordIdColumn]);
    const inEpisode: string | null =
      findBy.query[kind.episodeIdColumn] !== undefined
        ? idOf(findBy.query[kind.episodeIdColumn])
        : null;
    const rows: Array<DatabaseBaseModel> = [];

    for (const id of ids) {
      for (const episode of world.memberships[id] || []) {
        if (inEpisode === null || episode === inEpisode) {
          rows.push(member(kind, id, episode));
        }
      }
    }

    return rows;
  }) as never);

  jest
    .spyOn(kind.memberService, "countBy")
    .mockResolvedValue(new PositiveNumber(1) as never);

  jest
    .spyOn(kind.memberService, "create")
    .mockImplementation((async (createBy: { data: DatabaseBaseModel }) => {
      const id: string = idOf(
        (createBy.data as unknown as Record<string, unknown>)[
          kind.recordIdColumn
        ],
      );

      if (world.failures[id]) {
        throw world.failures[id];
      }

      creates.push(id);
      return createBy.data;
    }) as never);

  jest
    .spyOn(kind.episodeService, "findOneById")
    .mockImplementation((async (data: {
      id: ObjectID;
      props: DatabaseCommonInteractionProps;
    }) => {
      const id: string = idOf(data.id);

      if (!data.props.isRoot && world.hiddenEpisodes.includes(id)) {
        return null;
      }

      return episodeModel(kind, id);
    }) as never);

  jest
    .spyOn(kind.recordService, "findOneById")
    .mockImplementation((async (data: {
      id: ObjectID;
      props: DatabaseCommonInteractionProps;
    }) => {
      const id: string = idOf(data.id);

      if (
        !world.records.includes(id) ||
        (!data.props.isRoot && world.hidden.includes(id))
      ) {
        return null;
      }

      return recordModel(kind, id);
    }) as never);

  jest.spyOn(kind.recordService, "findBy").mockImplementation((async (findBy: {
    query: Record<string, unknown>;
    props: DatabaseCommonInteractionProps;
  }) => {
    return idsOf(findBy.query["_id"])
      .filter((id: string): boolean => {
        return (
          world.records.includes(id) &&
          (findBy.props.isRoot === true || !world.hidden.includes(id))
        );
      })
      .map((id: string): DatabaseBaseModel => {
        return recordModel(kind, id);
      });
  }) as never);

  jest.spyOn(kind.severityService, "findBy").mockResolvedValue([] as never);
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

function switchOn(kind: Kind): void {
  world.project = {
    incidents: kind.name === "incident",
    alerts: kind.name === "alert",
  };
}

function switchOff(): void {
  world.project = { incidents: false, alerts: false };
}

type OnBeforeCreateFunction = (createBy: CreateBy<any>) => Promise<unknown>;

// One member, as the API, a workflow or Terraform creates it.
function createOne(
  kind: Kind,
  record: string,
  props: DatabaseCommonInteractionProps = userProps(),
): Promise<unknown> {
  const data: DatabaseBaseModel = new kind.memberModel();
  const values: Record<string, unknown> = data as unknown as Record<
    string,
    unknown
  >;
  values["projectId"] = PROJECT_ID;
  values[kind.episodeIdColumn] = new ObjectID(TARGET_EPISODE_ID);
  values[kind.recordIdColumn] = new ObjectID(record);
  values["addedBy"] = kind.addedByApi;

  return (
    kind.memberService as unknown as { onBeforeCreate: OnBeforeCreateFunction }
  ).onBeforeCreate({ data: data, props: props });
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

function add(kind: Kind, ids: Array<string>): Promise<EpisodeMembersAddResult> {
  return kind.memberService[kind.addMethod]!({
    [kind.episodeIdKey]: TARGET_EPISODE_ID,
    [kind.idsKey]: ids,
    props: userProps(),
  }) as Promise<EpisodeMembersAddResult>;
}

function validateNew(kind: Kind, ids: Array<string>): Promise<unknown> {
  return kind.memberService[kind.validateNewMethod]!({
    projectId: PROJECT_ID,
    [kind.idsKey]: ids,
    props: userProps(),
  }) as Promise<unknown>;
}

beforeEach(() => {
  world = {
    project: { incidents: false, alerts: false },
    memberships: {},
    records: [recordId(1), recordId(2), recordId(3), recordId(4)],
    hidden: [],
    hiddenEpisodes: [],
    failures: {},
  };
  projectReads = [];
  creates = [];
  memberReads = [];
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("whether a project allows a record in only one episode", () => {
  beforeEach(() => {
    stubWorld(KINDS[0]!);
  });

  test("is read from the project, as OneUptime, both switches at once", async () => {
    world.project = { incidents: true, alerts: false };

    await expect(
      EpisodeSingleMembershipCheck.isOn({
        projectId: PROJECT_ID,
        kind: INCIDENT_SINGLE_MEMBERSHIP,
      }),
    ).resolves.toBe(true);

    expect(projectReads).toEqual([
      {
        id: idOf(PROJECT_ID),
        select: {
          limitIncidentsToOneEpisode: true,
          limitAlertsToOneEpisode: true,
        },
        props: { isRoot: true },
      },
    ]);
  });

  test("each kind reads its own switch", async () => {
    world.project = { incidents: true, alerts: false };

    await expect(
      EpisodeSingleMembershipCheck.isOn({
        projectId: PROJECT_ID,
        kind: ALERT_SINGLE_MEMBERSHIP,
      }),
    ).resolves.toBe(false);

    world.project = { incidents: false, alerts: true };

    await expect(
      EpisodeSingleMembershipCheck.isOn({
        projectId: PROJECT_ID,
        kind: ALERT_SINGLE_MEMBERSHIP,
      }),
    ).resolves.toBe(true);
    await expect(
      EpisodeSingleMembershipCheck.isOn({
        projectId: PROJECT_ID,
        kind: INCIDENT_SINGLE_MEMBERSHIP,
      }),
    ).resolves.toBe(false);
  });

  test("a project that is not found allows several, as every project did", async () => {
    world.project = null;

    await expect(
      EpisodeSingleMembershipCheck.isOn({
        projectId: PROJECT_ID,
        kind: INCIDENT_SINGLE_MEMBERSHIP,
      }),
    ).resolves.toBe(false);
  });

  test("the refusal is a BadDataException, so the API answers 400 with its words", () => {
    const refusal: RecordInAnotherEpisodeException =
      new RecordInAnotherEpisodeException("why");

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal.message).toBe("why");
  });
});

describe.each(KINDS)("one $name added on its own", (kind: Kind) => {
  beforeEach(() => {
    stubWorld(kind);
  });

  test("in no episode: added, and the project's switch is never read", async () => {
    switchOn(kind);

    await expect(createOne(kind, recordId(1))).resolves.toBeDefined();

    expect(projectReads).toEqual([]);
  });

  test("in another episode, with the switch off: added, as always", async () => {
    switchOff();
    world.memberships[recordId(1)] = [OTHER_EPISODE_ID];

    await expect(createOne(kind, recordId(1))).resolves.toBeDefined();

    // Read once, to know.
    expect(projectReads).toHaveLength(1);
  });

  test("in another episode, with the switch on: refused, naming it and the episode it is in", async () => {
    switchOn(kind);
    world.memberships[recordId(1)] = [OTHER_EPISODE_ID];

    const error: Error = await refusalOf(createOne(kind, recordId(1)));

    expect(error).toBeInstanceOf(RecordInAnotherEpisodeException);
    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toBe(
      `${kind.title} ${kind.recordPrefix}11 is already in episode ${kind.episodePrefix}3, and ${kind.singleMembership.rule}. Remove it from episode ${kind.episodePrefix}3 first, or turn this off in ${kind.singleMembership.settingLocation}.`,
    );
  });

  test("the episode it is in is named only to a caller who can see it", async () => {
    switchOn(kind);
    world.memberships[recordId(1)] = [OTHER_EPISODE_ID];
    world.hiddenEpisodes = [OTHER_EPISODE_ID];

    const error: Error = await refusalOf(createOne(kind, recordId(1)));

    expect(error.message).toBe(
      `${kind.title} ${kind.recordPrefix}11 is already in another episode, and ${kind.singleMembership.rule}. Remove it from that episode first, or turn this off in ${kind.singleMembership.settingLocation}.`,
    );
    expect(error.message).not.toContain(`${kind.episodePrefix}3`);
  });

  test("OneUptime's own write - the grouping engine's - is refused the same way, and sees every episode", async () => {
    switchOn(kind);
    world.memberships[recordId(1)] = [OTHER_EPISODE_ID];
    world.hiddenEpisodes = [OTHER_EPISODE_ID];

    const error: Error = await refusalOf(
      createOne(kind, recordId(1), { isRoot: true }),
    );

    expect(error).toBeInstanceOf(RecordInAnotherEpisodeException);
    expect(error.message).toContain(
      `is already in episode ${kind.episodePrefix}3`,
    );
  });

  test("it names the latest episode the record is in", async () => {
    switchOn(kind);
    world.memberships[recordId(1)] = [OTHER_EPISODE_ID, LATER_EPISODE_ID];

    const error: Error = await refusalOf(createOne(kind, recordId(1)));

    expect(error.message).toContain(
      `is already in episode ${kind.episodePrefix}4`,
    );

    const latestRead: (typeof memberReads)[number] | undefined =
      memberReads.find((read: (typeof memberReads)[number]): boolean => {
        return read.query[kind.episodeIdColumn] === undefined;
      });

    expect(latestRead?.sort).toEqual({ createdAt: SortOrder.Descending });
    expect(idOf(latestRead?.query["projectId"])).toBe(idOf(PROJECT_ID));
    expect(idOf(latestRead?.query[kind.recordIdColumn])).toBe(recordId(1));
    expect(latestRead?.props).toEqual({ isRoot: true });
  });

  test("one in this episode already gets the answer it always got, whatever the switch", async () => {
    switchOn(kind);
    world.memberships[recordId(1)] = [OTHER_EPISODE_ID, TARGET_EPISODE_ID];

    const error: Error = await refusalOf(createOne(kind, recordId(1)));

    expect(error).not.toBeInstanceOf(RecordInAnotherEpisodeException);
    expect(error.message).toBe(kind.alreadyMessage);
    expect(projectReads).toEqual([]);
  });

  test("one the caller cannot see is answered as one that does not exist, before the switch is read", async () => {
    switchOn(kind);
    world.memberships[recordId(1)] = [OTHER_EPISODE_ID];
    world.hidden = [recordId(1)];

    const error: Error = await refusalOf(createOne(kind, recordId(1)));

    expect(error.message).toBe(kind.notVisibleRefusal);
    expect(projectReads).toEqual([]);
  });

  test("with the other kind's switch on, nothing is refused", async () => {
    world.project = {
      incidents: kind.name !== "incident",
      alerts: kind.name !== "alert",
    };
    world.memberships[recordId(1)] = [OTHER_EPISODE_ID];

    await expect(createOne(kind, recordId(1))).resolves.toBeDefined();
  });
});

/*
 * ITS FIRST MEMBERSHIP (isFirstMembership).
 *
 * Every member says whether its record was in no episode when it was added:
 * at most one membership of a record may be its first (a partial unique
 * index), so of two adds of one record racing each other, the database
 * refuses the second, which is checked again (EpisodeFirstMembershipRace).
 * Decided on every add by the same read of the member rows the check makes -
 * the project is still read only for a record in an episode - and never
 * taken from what a write sent.
 */
describe.each(KINDS)("an $name's first membership", (kind: Kind) => {
  beforeEach(() => {
    stubWorld(kind);
  });

  function memberData(record: string, sent?: boolean): DatabaseBaseModel {
    const data: DatabaseBaseModel = new kind.memberModel();
    const values: Record<string, unknown> = data as unknown as Record<
      string,
      unknown
    >;
    values["projectId"] = PROJECT_ID;
    values[kind.episodeIdColumn] = new ObjectID(TARGET_EPISODE_ID);
    values[kind.recordIdColumn] = new ObjectID(record);
    values["addedBy"] = kind.addedByApi;

    if (sent !== undefined) {
      values["isFirstMembership"] = sent;
    }

    return data;
  }

  async function marked(
    data: DatabaseBaseModel,
    props: DatabaseCommonInteractionProps = userProps(),
  ): Promise<unknown> {
    await (
      kind.memberService as unknown as {
        onBeforeCreate: OnBeforeCreateFunction;
      }
    ).onBeforeCreate({ data: data, props: props });

    return (data as unknown as Record<string, unknown>)["isFirstMembership"];
  }

  test.each([true, false])(
    "in no episode (switch on: %p): its first - and the project's switch is still never read",
    async (isOn: boolean) => {
      if (isOn) {
        switchOn(kind);
      } else {
        switchOff();
      }

      await expect(marked(memberData(recordId(1)))).resolves.toBe(true);
      expect(projectReads).toEqual([]);
    },
  );

  test("switch off, in another episode: added, and not its first", async () => {
    switchOff();
    world.memberships[recordId(1)] = [OTHER_EPISODE_ID];

    await expect(marked(memberData(recordId(1)))).resolves.toBe(false);
  });

  test("whatever the write sent, OneUptime decides it", async () => {
    switchOff();

    // Sent as a second membership, while it is in no episode: its first.
    await expect(marked(memberData(recordId(1), false))).resolves.toBe(true);

    // Sent as a first, while it is in another episode: not its first.
    world.memberships[recordId(2)] = [OTHER_EPISODE_ID];
    await expect(marked(memberData(recordId(2), true))).resolves.toBe(false);
  });

  test("OneUptime's own write - the grouping engine's - is decided the same way", async () => {
    switchOn(kind);

    await expect(
      marked(memberData(recordId(1)), { isRoot: true }),
    ).resolves.toBe(true);

    switchOff();
    world.memberships[recordId(2)] = [OTHER_EPISODE_ID];

    await expect(
      marked(memberData(recordId(2)), { isRoot: true }),
    ).resolves.toBe(false);
  });

  test("switch on, in another episode: refused before anything is decided", async () => {
    switchOn(kind);
    world.memberships[recordId(1)] = [OTHER_EPISODE_ID];

    const data: DatabaseBaseModel = memberData(recordId(1));
    const error: Error = await refusalOf(marked(data));

    expect(error).toBeInstanceOf(RecordInAnotherEpisodeException);
    expect(
      (data as unknown as Record<string, unknown>)["isFirstMembership"],
    ).toBeUndefined();
  });

  test("the member rows are read once to decide both", async () => {
    switchOff();

    await marked(memberData(recordId(1)));

    // The duplicate check (this episode), then the latest membership.
    expect(memberReads).toHaveLength(2);
    expect(memberReads[1]!.sort).toEqual({ createdAt: SortOrder.Descending });
  });
});

describe.each(KINDS)("the episode that holds an $name", (kind: Kind) => {
  type FindHoldingFunction = (
    data: Record<string, unknown>,
  ) => Promise<ObjectID | null>;

  function findHolding(record: string): Promise<ObjectID | null> {
    return (
      kind.memberService as unknown as {
        findHoldingEpisodeId: FindHoldingFunction;
      }
    ).findHoldingEpisodeId({
      projectId: PROJECT_ID,
      [kind.recordIdColumn]: new ObjectID(record),
    });
  }

  beforeEach(() => {
    stubWorld(kind);
  });

  test("none for one in no episode, without reading the project", async () => {
    switchOn(kind);

    await expect(findHolding(recordId(1))).resolves.toBeNull();
    expect(projectReads).toEqual([]);
  });

  test("none when the project allows several", async () => {
    switchOff();
    world.memberships[recordId(1)] = [OTHER_EPISODE_ID];

    await expect(findHolding(recordId(1))).resolves.toBeNull();
  });

  test("the latest episode it is in when the project allows one", async () => {
    switchOn(kind);
    world.memberships[recordId(1)] = [OTHER_EPISODE_ID, LATER_EPISODE_ID];

    const holding: ObjectID | null = await findHolding(recordId(1));

    expect(idOf(holding)).toBe(LATER_EPISODE_ID);
  });
});

describe.each(KINDS)("the $plural held in episodes", (kind: Kind) => {
  function findHeld(ids: Array<string>): Promise<Set<string>> {
    return kind.memberService[kind.heldMethod]!({
      projectId: PROJECT_ID,
      [kind.idsKey]: ids.map((id: string): ObjectID => {
        return new ObjectID(id);
      }),
    }) as Promise<Set<string>>;
  }

  beforeEach(() => {
    stubWorld(kind);
  });

  test("nothing asked: nothing read", async () => {
    switchOn(kind);

    await expect(findHeld([])).resolves.toEqual(new Set());
    expect(memberReads).toEqual([]);
    expect(projectReads).toEqual([]);
  });

  test("none in an episode: none, without reading the project", async () => {
    switchOn(kind);

    await expect(findHeld([recordId(1), recordId(2)])).resolves.toEqual(
      new Set(),
    );
    expect(projectReads).toEqual([]);
  });

  test("switch off: none, though some are in an episode", async () => {
    switchOff();
    world.memberships[recordId(2)] = [OTHER_EPISODE_ID];

    await expect(findHeld([recordId(1), recordId(2)])).resolves.toEqual(
      new Set(),
    );
  });

  test("switch on: the ones in an episode, each once, read in the project", async () => {
    switchOn(kind);
    world.memberships[recordId(2)] = [OTHER_EPISODE_ID, LATER_EPISODE_ID];
    world.memberships[recordId(3)] = [OTHER_EPISODE_ID];

    await expect(
      findHeld([recordId(1), recordId(2), recordId(3)]),
    ).resolves.toEqual(new Set([recordId(2), recordId(3)]));

    expect(idOf(memberReads[0]!.query["projectId"])).toBe(idOf(PROJECT_ID));
    expect(memberReads[0]!.props).toEqual({ isRoot: true });
    expect(projectReads).toHaveLength(1);
  });
});

describe.each(KINDS)("several $plural added together", (kind: Kind) => {
  beforeEach(() => {
    stubWorld(kind);
  });

  test("switch on: one in another episode is not added, and says why; the rest are", async () => {
    switchOn(kind);
    world.memberships[recordId(2)] = [OTHER_EPISODE_ID];
    world.memberships[recordId(3)] = [TARGET_EPISODE_ID];

    const result: EpisodeMembersAddResult = await add(kind, [
      recordId(1),
      recordId(2),
      recordId(3),
    ]);

    expect(result).toEqual({
      added: [recordId(1)],
      alreadyInEpisode: [recordId(3)],
      notAdded: [{ id: recordId(2), reason: kind.inAnotherEpisodeReason }],
    });
    // Never even attempted.
    expect(creates).toEqual([recordId(1)]);
    expect(projectReads).toHaveLength(1);
  });

  test("switch off: one in another episode is added, as always", async () => {
    switchOff();
    world.memberships[recordId(2)] = [OTHER_EPISODE_ID];

    const result: EpisodeMembersAddResult = await add(kind, [
      recordId(1),
      recordId(2),
    ]);

    expect(result).toEqual({
      added: [recordId(1), recordId(2)],
      alreadyInEpisode: [],
      notAdded: [],
    });
    expect(creates).toEqual([recordId(1), recordId(2)]);
  });

  test("none in another episode: the project is not read", async () => {
    switchOn(kind);

    const result: EpisodeMembersAddResult = await add(kind, [
      recordId(1),
      recordId(2),
    ]);

    expect(result.added).toEqual([recordId(1), recordId(2)]);
    expect(projectReads).toEqual([]);
  });

  test("put in another episode while the request ran: said as the one found before is", async () => {
    switchOn(kind);
    world.failures[recordId(1)] = new RecordInAnotherEpisodeException(
      `${kind.title} ${kind.recordPrefix}11 is already in episode ${kind.episodePrefix}3, and ${kind.singleMembership.rule}. Remove it from episode ${kind.episodePrefix}3 first, or turn this off in ${kind.singleMembership.settingLocation}.`,
    );

    const result: EpisodeMembersAddResult = await add(kind, [
      recordId(1),
      recordId(2),
    ]);

    expect(result.notAdded).toEqual([
      { id: recordId(1), reason: kind.inAnotherEpisodeReason },
    ]);
    expect(result.added).toEqual([recordId(2)]);
  });

  test("every one in another episode: nothing added, and nothing written on the episode", async () => {
    switchOn(kind);
    world.memberships[recordId(1)] = [OTHER_EPISODE_ID];
    world.memberships[recordId(2)] = [LATER_EPISODE_ID];

    const result: EpisodeMembersAddResult = await add(kind, [
      recordId(1),
      recordId(2),
    ]);

    expect(result.added).toEqual([]);
    expect(result.notAdded).toEqual([
      { id: recordId(1), reason: kind.inAnotherEpisodeReason },
      { id: recordId(2), reason: kind.inAnotherEpisodeReason },
    ]);
    expect(creates).toEqual([]);
    expect(kind.episodeService[kind.countMethod]).not.toHaveBeenCalled();
    expect(
      kind.episodeFeedService[kind.episodeFeedMethod],
    ).not.toHaveBeenCalled();
  });

  test("one the caller cannot see is answered as one that does not exist, never as one in another episode", async () => {
    switchOn(kind);
    world.memberships[recordId(1)] = [OTHER_EPISODE_ID];
    world.hidden = [recordId(1)];

    const result: EpisodeMembersAddResult = await add(kind, [recordId(1)]);

    expect(result.notAdded).toHaveLength(1);
    expect(result.notAdded[0]!.reason).not.toBe(kind.inAnotherEpisodeReason);
    expect(projectReads).toEqual([]);
  });
});

describe.each(KINDS)("an episode created with $plural", (kind: Kind) => {
  beforeEach(() => {
    stubWorld(kind);
  });

  test("switch on: one in an episode refuses the whole create, naming it", async () => {
    switchOn(kind);
    world.memberships[recordId(2)] = [OTHER_EPISODE_ID];

    const error: Error = await refusalOf(
      validateNew(kind, [recordId(1), recordId(2)]),
    );

    expect(error).toBeInstanceOf(RecordInAnotherEpisodeException);
    expect(error.message).toBe(
      `${kind.title} ${kind.recordPrefix}12 is already in an episode, and ${kind.singleMembership.rule}. Leave it out, or remove it from its episode first.`,
    );
  });

  test("switch on: several in an episode are named in the order asked", async () => {
    switchOn(kind);
    world.memberships[recordId(1)] = [OTHER_EPISODE_ID];
    world.memberships[recordId(3)] = [LATER_EPISODE_ID];

    const error: Error = await refusalOf(
      validateNew(kind, [recordId(3), recordId(2), recordId(1)]),
    );

    expect(error.message).toBe(
      `${kind.recordPrefix}13 and ${kind.recordPrefix}11 are already in an episode, and ${kind.singleMembership.rule}. Leave them out, or remove them from their episodes first.`,
    );
  });

  test("switch on, none in an episode: the ids come back", async () => {
    switchOn(kind);

    const validated: Record<string, unknown> = (await validateNew(kind, [
      recordId(1),
      recordId(2),
    ])) as Record<string, unknown>;

    expect(
      (validated[kind.idsKey] as Array<ObjectID>).map((id: ObjectID) => {
        return idOf(id);
      }),
    ).toEqual([recordId(1), recordId(2)]);
    expect(projectReads).toEqual([]);
  });

  test("switch off: one in another episode is welcome, as always", async () => {
    switchOff();
    world.memberships[recordId(1)] = [OTHER_EPISODE_ID];

    const validated: Record<string, unknown> = (await validateNew(kind, [
      recordId(1),
    ])) as Record<string, unknown>;

    expect(
      (validated[kind.idsKey] as Array<ObjectID>).map((id: ObjectID) => {
        return idOf(id);
      }),
    ).toEqual([recordId(1)]);
  });

  test("one the caller cannot see is refused as before, never named as in an episode", async () => {
    switchOn(kind);
    world.memberships[recordId(1)] = [OTHER_EPISODE_ID];
    world.hidden = [recordId(1)];

    const error: Error = await refusalOf(validateNew(kind, [recordId(1)]));

    expect(error.message).toBe(kind.newEpisodeNotVisibleRefusal);
    expect(projectReads).toEqual([]);
  });
});
