import AuditLogService from "../../../Server/Services/AuditLogService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import FileService from "../../../Server/Services/FileService";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import { FileOwners } from "../../../Server/Utils/File/FileOwnership";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import File from "../../../Models/DatabaseModels/File";
import IncidentPublicNote from "../../../Models/DatabaseModels/IncidentPublicNote";
import Probe from "../../../Models/DatabaseModels/Probe";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import User from "../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import { getJestSpyOn } from "../../Spy";
import { stubReadableParents } from "../TestingUtils/ReadableParents";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";
import { FindOperator } from "typeorm";

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

/*
 * A RECORD POINTS ONLY AT ITS OWN FILES (DatabaseService, FileOwnership).
 *
 * Every create and update that points one of a model's File columns at a
 * file is checked after the caller is known to be allowed the write: a
 * project's record only at files uploaded in its project, a person only at
 * a picture they uploaded. Another owner's file, a file with no owner and a
 * file that does not exist are refused with the same words. A file the
 * record already points at is not checked again, so a record saved before
 * files had owners keeps saving.
 *
 * The services here are DatabaseService itself, with no hooks of their
 * own, so what is tested is DatabaseService's write path. No database: the
 * repository is an in-memory list of rows, and FileService.getFileOwners
 * answers from a table of files.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const OTHER_USER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

const OWN_FILE_ID: string = "aaaaaaaa-0000-4000-8000-000000000001";
const SECOND_OWN_FILE_ID: string = "aaaaaaaa-0000-4000-8000-000000000002";
const OTHER_PROJECT_FILE_ID: string = "bbbbbbbb-0000-4000-8000-000000000001";
// Uploaded before files recorded their project, and used by nobody else.
const LEGACY_FILE_ID: string = "cccccccc-0000-4000-8000-000000000001";
const MISSING_FILE_ID: string = "dddddddd-0000-4000-8000-000000000001";

const FILES: Record<string, FileOwners> = {
  [OWN_FILE_ID]: { projectId: PROJECT_ID, createdByUserId: USER_ID },
  [SECOND_OWN_FILE_ID]: { projectId: PROJECT_ID, createdByUserId: USER_ID },
  [OTHER_PROJECT_FILE_ID]: {
    projectId: OTHER_PROJECT_ID,
    createdByUserId: OTHER_USER_ID,
  },
  [LEGACY_FILE_ID]: { projectId: null, createdByUserId: null },
};

const LOGO_REFUSAL: string =
  "The logo's file could not be found. Upload the logo again.";
const FAVICON_REFUSAL: string =
  "The favicon's file could not be found. Upload the favicon again.";
const ATTACHMENT_REFUSAL: string =
  "One of the attachments could not be found. Upload it again.";
const PICTURE_REFUSAL: string =
  "The profile picture's file could not be found. Upload the profile picture again.";

const STATUS_PAGE_ID: string = "eeeeeeee-0000-4000-8000-000000000001";
const OTHER_STATUS_PAGE_ID: string = "eeeeeeee-0000-4000-8000-000000000002";
const NOTE_ID: string = "eeeeeeee-0000-4000-8000-000000000003";

class StatusPageWrites extends DatabaseService<StatusPage> {
  public constructor() {
    super(StatusPage);
  }
}

class NoteWrites extends DatabaseService<IncidentPublicNote> {
  public constructor() {
    super(IncidentPublicNote);
  }
}

class UserWrites extends DatabaseService<User> {
  public constructor() {
    super(User);
  }
}

class ProbeWrites extends DatabaseService<Probe> {
  public constructor() {
    super(Probe);
  }
}

type GetFileOwnersMock = Mock<
  (fileIds: Array<ObjectID>) => Promise<Map<string, FileOwners>>
>;

let getFileOwners: GetFileOwnersMock;

function fileIdsAsked(): Array<Array<string>> {
  return getFileOwners.mock.calls.map(
    (call: [Array<ObjectID>]): Array<string> => {
      return call[0].map((fileId: ObjectID): string => {
        return fileId.toString().toLowerCase();
      });
    },
  );
}

function fileRef(fileId: string): File {
  const file: File = new File();
  file._id = fileId;
  return file;
}

/*
 * The values a where condition accepts: a plain value, or the operators
 * QueryHelper builds (`IN`, and its raw-SQL spellings).
 */
function acceptedValues(condition: unknown): Array<string> {
  if (!(condition instanceof FindOperator)) {
    return [String(condition).toLowerCase()];
  }

  const operator: FindOperator<unknown> = condition as FindOperator<unknown>;

  if (operator.type === "in") {
    return (operator.value as Array<unknown>).map((value: unknown): string => {
      return String(value).toLowerCase();
    });
  }

  if (operator.type === "equal") {
    return [String(operator.value).toLowerCase()];
  }

  const parameters: Record<string, unknown> =
    (operator.objectLiteralParameters as Record<string, unknown>) || {};
  const values: Array<string> = [];

  for (const value of Object.values(parameters)) {
    for (const entry of Array.isArray(value) ? value : [value]) {
      values.push(String(entry).toLowerCase());
    }
  }

  return values;
}

interface FakeRepository {
  rows: Array<BaseModel>;
  find: Mock<(options: { where?: unknown }) => Promise<Array<BaseModel>>>;
  save: Mock<(entity: unknown) => Promise<unknown>>;
  update: Mock<
    (criteria: unknown, data: unknown) => Promise<{ affected: number }>
  >;
}

// An in-memory repository serving `rows` to finds by _id (and projectId).
function fakeRepository(rows: Array<BaseModel>): FakeRepository {
  const repository: FakeRepository = {
    rows: rows,
    find: jest.fn(
      async (options: { where?: unknown }): Promise<Array<BaseModel>> => {
        const where: Record<string, unknown> = (options.where || {}) as Record<
          string,
          unknown
        >;

        return rows.filter((row: BaseModel): boolean => {
          for (const column of ["_id", "projectId"]) {
            if (where[column] === undefined) {
              continue;
            }

            const stored: string = String(
              (row as unknown as Record<string, unknown>)[column] || "",
            ).toLowerCase();

            if (!acceptedValues(where[column]).includes(stored)) {
              return false;
            }
          }

          return true;
        });
      },
    ),
    save: jest.fn(async (entity: unknown): Promise<unknown> => {
      return entity;
    }),
    update: jest.fn(async (): Promise<{ affected: number }> => {
      return { affected: 1 };
    }),
  };

  return repository;
}

// Wires a service to the fake repository, and quiets what a write touches besides it.
function useRepository(
  service: DatabaseService<BaseModel>,
  rows: Array<BaseModel> = [],
): FakeRepository {
  const repository: FakeRepository = fakeRepository(rows);

  getJestSpyOn(service, "getRepository").mockReturnValue(repository as never);
  getJestSpyOn(service, "countBy").mockResolvedValue(
    new PositiveNumber(0) as never,
  );
  getJestSpyOn(service, "checkRequiredFields").mockImplementation(((
    data: unknown,
  ) => {
    return data;
  }) as never);
  getJestSpyOn(service, "onTriggerWorkflow").mockResolvedValue(
    undefined as never,
  );
  getJestSpyOn(service, "onTriggerRealtime").mockResolvedValue(
    undefined as never,
  );
  // The creator becomes an owner of an operational resource, in its own table.
  getJestSpyOn(service, "autoOwnerOnCreate").mockResolvedValue(
    undefined as never,
  );

  return repository;
}

function rootProps(tenantId?: ObjectID): DatabaseCommonInteractionProps {
  return tenantId ? { isRoot: true, tenantId: tenantId } : { isRoot: true };
}

function userPermission(permission: Permission): UserPermission {
  return {
    permission: permission,
    labelIds: [],
    isBlockPermission: false,
    _type: "UserPermission",
  };
}

// A project owner signed in to PROJECT_ID, on a plan that has every feature.
function ownerProps(): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    currentPlan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
    userGlobalAccessPermission: {
      projectIds: [PROJECT_ID],
      globalPermissions: [Permission.Public, Permission.User],
      _type: "UserGlobalAccessPermission",
    },
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        projectId: PROJECT_ID,
        permissions: [userPermission(Permission.ProjectOwner)],
        _type: "UserTenantAccessPermission",
      },
    },
  };
}

async function refusalOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(BadDataException);
    return (error as Error).message;
  }

  throw new Error("The write was not refused.");
}

function statusPageRow(data: {
  id: string;
  projectId: ObjectID;
  logoFileId?: string;
  faviconFileId?: string;
}): StatusPage {
  const statusPage: StatusPage = new StatusPage();
  statusPage._id = data.id;
  statusPage.projectId = data.projectId;
  statusPage.name = "Status";

  if (data.logoFileId) {
    statusPage.logoFileId = new ObjectID(data.logoFileId);
  }

  if (data.faviconFileId) {
    statusPage.faviconFileId = new ObjectID(data.faviconFileId);
  }

  return statusPage;
}

function newStatusPage(projectId: ObjectID = PROJECT_ID): StatusPage {
  const statusPage: StatusPage = new StatusPage();
  statusPage.name = "Status";
  statusPage.projectId = projectId;
  return statusPage;
}

beforeEach(() => {
  getFileOwners = jest.fn(
    async (fileIds: Array<ObjectID>): Promise<Map<string, FileOwners>> => {
      const owners: Map<string, FileOwners> = new Map();

      for (const fileId of fileIds) {
        const key: string = fileId.toString().toLowerCase();

        if (FILES[key]) {
          owners.set(key, FILES[key]!);
        }
      }

      return owners;
    },
  );

  jest
    .spyOn(FileService, "getFileOwners")
    .mockImplementation(getFileOwners as never);
  jest
    .spyOn(AuditLogService, "recordCreate")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(AuditLogService, "recordUpdate")
    .mockResolvedValue(undefined as never);
  /*
   * A note is created under an incident its creator may read: the plain
   * services here check no reference themselves, so the incident is looked
   * up (CreatePermission.checkParentIds), and every one named is readable.
   */
  stubReadableParents();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("create: a record points only at files of its own project", () => {
  test("saves a status page whose logo, favicon and cover image are its project's", async () => {
    const service: StatusPageWrites = new StatusPageWrites();
    const repository: FakeRepository = useRepository(service);

    const statusPage: StatusPage = newStatusPage();
    statusPage.logoFile = fileRef(OWN_FILE_ID);
    statusPage.faviconFileId = new ObjectID(SECOND_OWN_FILE_ID);
    statusPage.coverImageFile = fileRef(OWN_FILE_ID);

    await service.create({ data: statusPage, props: rootProps(PROJECT_ID) });

    expect(repository.save).toHaveBeenCalledTimes(1);
    // One query, each file once.
    expect(fileIdsAsked().length).toBe(1);
    expect(fileIdsAsked()[0]!.sort()).toEqual([
      OWN_FILE_ID,
      SECOND_OWN_FILE_ID,
    ]);
  });

  test("refuses another project's logo, word for word like a missing one", async () => {
    const service: StatusPageWrites = new StatusPageWrites();
    const repository: FakeRepository = useRepository(service);

    const messages: Array<string> = [];

    for (const fileId of [
      OTHER_PROJECT_FILE_ID,
      MISSING_FILE_ID,
      LEGACY_FILE_ID,
    ]) {
      const statusPage: StatusPage = newStatusPage();
      statusPage.logoFile = fileRef(fileId);

      messages.push(
        await refusalOf(
          service.create({ data: statusPage, props: rootProps(PROJECT_ID) }),
        ),
      );
    }

    expect(messages).toEqual([LOGO_REFUSAL, LOGO_REFUSAL, LOGO_REFUSAL]);
    expect(repository.save).not.toHaveBeenCalled();
  });

  test("holds the record to the project it is saved in, not the one the body names", async () => {
    const service: StatusPageWrites = new StatusPageWrites();
    const repository: FakeRepository = useRepository(service);

    // The body names the other project; the request's project is stamped.
    const ownLogo: StatusPage = newStatusPage(OTHER_PROJECT_ID);
    ownLogo.logoFile = fileRef(OWN_FILE_ID);

    await service.create({ data: ownLogo, props: ownerProps() });

    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(
      String((repository.save.mock.calls[0]![0] as StatusPage).projectId),
    ).toBe(PROJECT_ID.toString());

    const foreignLogo: StatusPage = newStatusPage(OTHER_PROJECT_ID);
    foreignLogo.logoFile = fileRef(OTHER_PROJECT_FILE_ID);

    expect(
      await refusalOf(
        service.create({ data: foreignLogo, props: ownerProps() }),
      ),
    ).toBe(LOGO_REFUSAL);
    expect(repository.save).toHaveBeenCalledTimes(1);
  });

  test("checks a signed-in member's create once they may make it", async () => {
    const service: NoteWrites = new NoteWrites();
    const repository: FakeRepository = useRepository(service);

    const note: IncidentPublicNote = new IncidentPublicNote();
    note.note = "Mitigated.";
    note.incidentId = new ObjectID("eeeeeeee-0000-4000-8000-0000000000aa");
    note.attachments = [fileRef(OWN_FILE_ID), fileRef(OTHER_PROJECT_FILE_ID)];

    expect(
      await refusalOf(service.create({ data: note, props: ownerProps() })),
    ).toBe(ATTACHMENT_REFUSAL);
    expect(repository.save).not.toHaveBeenCalled();

    const ownNote: IncidentPublicNote = new IncidentPublicNote();
    ownNote.note = "Mitigated.";
    ownNote.incidentId = new ObjectID("eeeeeeee-0000-4000-8000-0000000000aa");
    ownNote.attachments = [fileRef(OWN_FILE_ID), fileRef(SECOND_OWN_FILE_ID)];

    await service.create({ data: ownNote, props: ownerProps() });

    expect(repository.save).toHaveBeenCalledTimes(1);
  });

  test("checks root and hook-free creates too: a workflow can carry any id", async () => {
    const service: StatusPageWrites = new StatusPageWrites();
    const repository: FakeRepository = useRepository(service);

    for (const props of [
      rootProps(PROJECT_ID),
      rootProps(),
      { ...rootProps(PROJECT_ID), ignoreHooks: true },
    ]) {
      const statusPage: StatusPage = newStatusPage();
      statusPage.faviconFileId = new ObjectID(OTHER_PROJECT_FILE_ID);

      expect(await refusalOf(service.create({ data: statusPage, props }))).toBe(
        FAVICON_REFUSAL,
      );
    }

    expect(repository.save).not.toHaveBeenCalled();
  });

  test("a write made in a project that names two files for one logo is refused before any file is read", async () => {
    const service: StatusPageWrites = new StatusPageWrites();
    const repository: FakeRepository = useRepository(service);
    const conflict: string =
      "Conflicting Logo references were provided. logoFileId and logoFile are names for the same field and must hold the same value: send only one of them, or the same id in each.";

    const foreignOneWay: StatusPage = newStatusPage();
    foreignOneWay.logoFile = fileRef(OWN_FILE_ID);
    foreignOneWay.logoFileId = new ObjectID(OTHER_PROJECT_FILE_ID);

    expect(
      await refusalOf(
        service.create({ data: foreignOneWay, props: rootProps(PROJECT_ID) }),
      ),
    ).toBe(conflict);

    // Two files of its own are two answers to one question as well.
    const ownBothWays: StatusPage = newStatusPage();
    ownBothWays.logoFile = fileRef(OWN_FILE_ID);
    ownBothWays.logoFileId = new ObjectID(SECOND_OWN_FILE_ID);

    expect(
      await refusalOf(
        service.create({ data: ownBothWays, props: rootProps(PROJECT_ID) }),
      ),
    ).toBe(conflict);

    expect(repository.save).not.toHaveBeenCalled();
    expect(getFileOwners).not.toHaveBeenCalled();

    // The same file under both names is one file.
    const sameBothWays: StatusPage = newStatusPage();
    sameBothWays.logoFile = fileRef(OWN_FILE_ID);
    sameBothWays.logoFileId = new ObjectID(OWN_FILE_ID);

    await service.create({ data: sameBothWays, props: rootProps(PROJECT_ID) });

    expect(repository.save).toHaveBeenCalledTimes(1);
  });

  test("checks both files when OneUptime's own write names one two different ways", async () => {
    const service: StatusPageWrites = new StatusPageWrites();
    const repository: FakeRepository = useRepository(service);

    const foreignOneWay: StatusPage = newStatusPage();
    foreignOneWay.logoFile = fileRef(OWN_FILE_ID);
    foreignOneWay.logoFileId = new ObjectID(OTHER_PROJECT_FILE_ID);

    expect(
      await refusalOf(
        service.create({ data: foreignOneWay, props: rootProps() }),
      ),
    ).toBe(LOGO_REFUSAL);
    expect(repository.save).not.toHaveBeenCalled();

    // Two files of its own: whichever the database keeps is its own.
    const ownBothWays: StatusPage = newStatusPage();
    ownBothWays.logoFile = fileRef(OWN_FILE_ID);
    ownBothWays.logoFileId = new ObjectID(SECOND_OWN_FILE_ID);

    await service.create({ data: ownBothWays, props: rootProps() });

    expect(repository.save).toHaveBeenCalledTimes(1);
  });

  test("reads no file for a create that points at none", async () => {
    const service: StatusPageWrites = new StatusPageWrites();
    const repository: FakeRepository = useRepository(service);

    await service.create({
      data: newStatusPage(),
      props: rootProps(PROJECT_ID),
    });

    const cleared: StatusPage = newStatusPage();
    (cleared as unknown as Record<string, unknown>)["logoFile"] = null;

    await service.create({ data: cleared, props: rootProps(PROJECT_ID) });

    expect(repository.save).toHaveBeenCalledTimes(2);
    expect(getFileOwners).not.toHaveBeenCalled();
  });

  test("leaves a record outside any project to its server admin", async () => {
    const service: ProbeWrites = new ProbeWrites();
    const repository: FakeRepository = useRepository(service);

    const probe: Probe = new Probe();
    probe.name = "Global probe";
    probe.iconFile = fileRef(OTHER_PROJECT_FILE_ID);

    await service.create({ data: probe, props: rootProps() });

    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(getFileOwners).not.toHaveBeenCalled();
  });

  test("holds a project's probe to its project like any other record", async () => {
    const service: ProbeWrites = new ProbeWrites();
    const repository: FakeRepository = useRepository(service);

    const probe: Probe = new Probe();
    probe.name = "Custom probe";
    probe.projectId = PROJECT_ID;
    probe.iconFile = fileRef(OTHER_PROJECT_FILE_ID);

    expect(
      await refusalOf(
        service.create({ data: probe, props: rootProps(PROJECT_ID) }),
      ),
    ).toBe("The icon's file could not be found. Upload the icon again.");
    expect(repository.save).not.toHaveBeenCalled();
  });
});

describe("update: only a file the record does not hold yet is checked", () => {
  test("saves a new logo of the page's own project", async () => {
    const service: StatusPageWrites = new StatusPageWrites();
    const repository: FakeRepository = useRepository(service, [
      statusPageRow({ id: STATUS_PAGE_ID, projectId: PROJECT_ID }),
    ]);

    await service.updateOneById({
      id: new ObjectID(STATUS_PAGE_ID),
      data: { logoFile: { _id: OWN_FILE_ID } } as never,
      props: rootProps(PROJECT_ID),
    });

    expect(repository.update).toHaveBeenCalledTimes(1);
    expect(fileIdsAsked()).toEqual([[OWN_FILE_ID]]);
  });

  test("refuses a new favicon of another project, as it refuses a missing one", async () => {
    const service: StatusPageWrites = new StatusPageWrites();
    const repository: FakeRepository = useRepository(service, [
      statusPageRow({ id: STATUS_PAGE_ID, projectId: PROJECT_ID }),
    ]);

    for (const fileId of [OTHER_PROJECT_FILE_ID, MISSING_FILE_ID]) {
      expect(
        await refusalOf(
          service.updateOneById({
            id: new ObjectID(STATUS_PAGE_ID),
            data: { faviconFileId: new ObjectID(fileId) } as never,
            props: rootProps(PROJECT_ID),
          }),
        ),
      ).toBe(FAVICON_REFUSAL);
    }

    expect(repository.update).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });

  /*
   * The dashboard's forms send every field back: a page whose logo was
   * uploaded before files had owners must keep saving it.
   */
  test("saves a logo the page already shows, even one with no project", async () => {
    const service: StatusPageWrites = new StatusPageWrites();
    const repository: FakeRepository = useRepository(service, [
      statusPageRow({
        id: STATUS_PAGE_ID,
        projectId: PROJECT_ID,
        logoFileId: LEGACY_FILE_ID,
      }),
    ]);

    await service.updateOneById({
      id: new ObjectID(STATUS_PAGE_ID),
      data: {
        logoFile: { _id: LEGACY_FILE_ID.toUpperCase() },
        logoAltText: "Our logo",
      } as never,
      props: rootProps(PROJECT_ID),
    });

    expect(repository.update).toHaveBeenCalledTimes(1);
    expect(getFileOwners).not.toHaveBeenCalled();
  });

  test("checks only the file that changes when the held one is sent back", async () => {
    const service: StatusPageWrites = new StatusPageWrites();
    const repository: FakeRepository = useRepository(service, [
      statusPageRow({
        id: STATUS_PAGE_ID,
        projectId: PROJECT_ID,
        logoFileId: LEGACY_FILE_ID,
      }),
    ]);

    expect(
      await refusalOf(
        service.updateOneById({
          id: new ObjectID(STATUS_PAGE_ID),
          data: {
            logoFileId: new ObjectID(LEGACY_FILE_ID),
            faviconFileId: new ObjectID(OTHER_PROJECT_FILE_ID),
          } as never,
          props: rootProps(PROJECT_ID),
        }),
      ),
    ).toBe(FAVICON_REFUSAL);

    expect(fileIdsAsked()).toEqual([[OTHER_PROJECT_FILE_ID]]);
    expect(repository.update).not.toHaveBeenCalled();
  });

  test("refuses a file with no project that the page does not hold", async () => {
    const service: StatusPageWrites = new StatusPageWrites();
    const repository: FakeRepository = useRepository(service, [
      statusPageRow({
        id: STATUS_PAGE_ID,
        projectId: PROJECT_ID,
        logoFileId: OWN_FILE_ID,
      }),
    ]);

    expect(
      await refusalOf(
        service.updateOneById({
          id: new ObjectID(STATUS_PAGE_ID),
          data: { logoFileId: new ObjectID(LEGACY_FILE_ID) } as never,
          props: rootProps(PROJECT_ID),
        }),
      ),
    ).toBe(LOGO_REFUSAL);

    expect(repository.update).not.toHaveBeenCalled();
  });

  test("reads no file for an update that clears one or touches none", async () => {
    const service: StatusPageWrites = new StatusPageWrites();
    const repository: FakeRepository = useRepository(service, [
      statusPageRow({
        id: STATUS_PAGE_ID,
        projectId: PROJECT_ID,
        logoFileId: OTHER_PROJECT_FILE_ID,
      }),
    ]);

    await service.updateOneById({
      id: new ObjectID(STATUS_PAGE_ID),
      data: { logoFileId: null } as never,
      props: rootProps(PROJECT_ID),
    });

    await service.updateOneById({
      id: new ObjectID(STATUS_PAGE_ID),
      data: { name: "Renamed" } as never,
      props: rootProps(PROJECT_ID),
    });

    expect(repository.update).toHaveBeenCalledTimes(2);
    expect(getFileOwners).not.toHaveBeenCalled();
  });

  test("holds each record an update writes to its own project", async () => {
    const service: StatusPageWrites = new StatusPageWrites();
    const repository: FakeRepository = useRepository(service, [
      statusPageRow({ id: STATUS_PAGE_ID, projectId: PROJECT_ID }),
      statusPageRow({ id: OTHER_STATUS_PAGE_ID, projectId: OTHER_PROJECT_ID }),
    ]);

    expect(
      await refusalOf(
        service.updateBy({
          query: {
            _id: QueryHelper.any([STATUS_PAGE_ID, OTHER_STATUS_PAGE_ID]),
          },
          data: { logoFileId: new ObjectID(OWN_FILE_ID) } as never,
          limit: 10,
          skip: 0,
          props: rootProps(),
        }),
      ),
    ).toBe(LOGO_REFUSAL);

    expect(repository.update).not.toHaveBeenCalled();
  });

  test("holds the stored record to its project, whatever project a root caller names", async () => {
    const service: StatusPageWrites = new StatusPageWrites();
    const repository: FakeRepository = useRepository(service, [
      statusPageRow({ id: STATUS_PAGE_ID, projectId: PROJECT_ID }),
    ]);

    expect(
      await refusalOf(
        service.updateOneById({
          id: new ObjectID(STATUS_PAGE_ID),
          data: { logoFileId: new ObjectID(OTHER_PROJECT_FILE_ID) } as never,
          props: rootProps(OTHER_PROJECT_ID),
        }),
      ),
    ).toBe(LOGO_REFUSAL);

    expect(repository.update).not.toHaveBeenCalled();
  });

  test("checks hook-free updates too", async () => {
    const service: StatusPageWrites = new StatusPageWrites();
    const repository: FakeRepository = useRepository(service, [
      statusPageRow({ id: STATUS_PAGE_ID, projectId: PROJECT_ID }),
    ]);

    expect(
      await refusalOf(
        service.updateOneById({
          id: new ObjectID(STATUS_PAGE_ID),
          data: { logoFileId: new ObjectID(OTHER_PROJECT_FILE_ID) } as never,
          props: { ...rootProps(PROJECT_ID), ignoreHooks: true },
        }),
      ),
    ).toBe(LOGO_REFUSAL);

    expect(repository.update).not.toHaveBeenCalled();
  });

  test("checks only the attachments a note gains", async () => {
    const note: IncidentPublicNote = new IncidentPublicNote();
    note._id = NOTE_ID;
    note.projectId = PROJECT_ID;
    note.attachments = [fileRef(LEGACY_FILE_ID)];

    const service: NoteWrites = new NoteWrites();
    const repository: FakeRepository = useRepository(service, [note]);

    await service.updateOneById({
      id: new ObjectID(NOTE_ID),
      data: {
        attachments: [{ _id: LEGACY_FILE_ID }, { _id: OWN_FILE_ID }],
      } as never,
      props: rootProps(PROJECT_ID),
    });

    expect(fileIdsAsked()).toEqual([[OWN_FILE_ID]]);
    expect(repository.save).toHaveBeenCalledTimes(1);

    expect(
      await refusalOf(
        service.updateOneById({
          id: new ObjectID(NOTE_ID),
          data: {
            attachments: [
              { _id: LEGACY_FILE_ID },
              { _id: OTHER_PROJECT_FILE_ID },
            ],
          } as never,
          props: rootProps(PROJECT_ID),
        }),
      ),
    ).toBe(ATTACHMENT_REFUSAL);

    expect(repository.save).toHaveBeenCalledTimes(1);
  });
});

describe("a person's profile picture is a file they uploaded", () => {
  function userRow(profilePictureId?: string): User {
    const user: User = new User();
    user._id = USER_ID.toString();

    if (profilePictureId) {
      user.profilePictureId = new ObjectID(profilePictureId);
    }

    return user;
  }

  test("saves a picture the user uploaded", async () => {
    const service: UserWrites = new UserWrites();
    const repository: FakeRepository = useRepository(service, [userRow()]);

    await service.updateOneById({
      id: USER_ID,
      data: { profilePictureFile: { _id: OWN_FILE_ID } } as never,
      props: rootProps(),
    });

    expect(repository.update).toHaveBeenCalledTimes(1);
  });

  test("refuses a file someone else uploaded, as it refuses a missing one", async () => {
    const service: UserWrites = new UserWrites();
    const repository: FakeRepository = useRepository(service, [userRow()]);

    for (const fileId of [
      OTHER_PROJECT_FILE_ID,
      LEGACY_FILE_ID,
      MISSING_FILE_ID,
    ]) {
      expect(
        await refusalOf(
          service.updateOneById({
            id: USER_ID,
            data: { profilePictureId: new ObjectID(fileId) } as never,
            props: rootProps(),
          }),
        ),
      ).toBe(PICTURE_REFUSAL);
    }

    expect(repository.update).not.toHaveBeenCalled();
  });

  test("keeps saving the picture a user already has", async () => {
    const service: UserWrites = new UserWrites();
    const repository: FakeRepository = useRepository(service, [
      userRow(LEGACY_FILE_ID),
    ]);

    await service.updateOneById({
      id: USER_ID,
      data: { profilePictureFile: { _id: LEGACY_FILE_ID } } as never,
      props: rootProps(),
    });

    expect(repository.update).toHaveBeenCalledTimes(1);
    expect(getFileOwners).not.toHaveBeenCalled();
  });
});
