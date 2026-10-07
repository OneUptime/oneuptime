import AuditLogService from "../../../Server/Services/AuditLogService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import FileService from "../../../Server/Services/FileService";
import { FileOwners } from "../../../Server/Utils/File/FileOwnership";
import PublishedImages from "../../../Server/Utils/File/PublishedImages";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Form from "../../../Models/DatabaseModels/Form";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";

jest.mock("../../../Server/Utils/Logger");

/*
 * A SWITCH WRITTEN AS TEXT IS THE SWITCH THE DATABASE STORES, FOR EVERY WRITE.
 *
 * Postgres stores "true", "yes", "on", "1" and the number 1 in a boolean
 * column as true, and "false", "no", "off", "0" and 0 as false. The API,
 * Terraform, a workflow step and a script pass a value through as it was
 * sent, and everything that read the write before the database did - the
 * images a record makes public, who archived it, the services' own hooks -
 * saw the text instead: a scheduled maintenance event created with Visible
 * on Status Page "true" was stored visible while its images stayed private,
 * and a monitor written with Archived "false" was stamped as archived.
 *
 * DatabaseService now turns every Boolean column of a create or an update
 * into the boolean the database stores before anything reads it, and refuses
 * a value the database would refuse with one plain message, before any hook
 * runs and before anything is written.
 *
 * The services here are DatabaseService itself, so what is tested is its
 * write path. No database: the repository records what it is handed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "b0010000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("b0010000-0000-4000-8000-000000000002");
const RECORD_ID: string = "b0010000-0000-4000-8000-0000000000a1";

const image: (token: string) => string = (token: string): string => {
  return `![shot](https://oneuptime.example/file/image/access-token/${token})`;
};

interface VisibilityRequest {
  projectId: unknown;
  publish: Iterable<string>;
  unpublish: Iterable<string>;
}

type SetImagesVisibilityMock = Mock<(data: VisibilityRequest) => Promise<void>>;

let setImagesVisibility: SetImagesVisibilityMock;

// What each image was asked to be, in order: "aaa:public", "bbb:private".
function visibilityAsked(): Array<string> {
  return setImagesVisibility.mock.calls.flatMap(
    (call: [VisibilityRequest]): Array<string> => {
      return [
        ...Array.from(call[0].publish).map((token: string): string => {
          return `${token}:public`;
        }),
        ...Array.from(call[0].unpublish).map((token: string): string => {
          return `${token}:private`;
        }),
      ];
    },
  );
}

interface FakeRepository {
  saved: Array<Record<string, unknown>>;
  written: Array<Record<string, unknown>>;
  find: Mock<(options: Record<string, unknown>) => Promise<Array<BaseModel>>>;
  save: Mock<(entity: unknown) => Promise<unknown>>;
  update: Mock<
    (
      criteria: unknown,
      data: unknown,
      options?: unknown,
    ) => Promise<{ affected: number; raw?: unknown }>
  >;
}

// Plain copies of what save() and update() were handed, functions left out.
function plainCopy(value: unknown): Record<string, unknown> {
  const copy: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry !== undefined && typeof entry !== "function") {
      copy[key] = entry;
    }
  }

  return copy;
}

function useRepository(
  service: DatabaseService<BaseModel>,
  rows: Array<BaseModel> = [],
): FakeRepository {
  const repository: FakeRepository = {
    saved: [],
    written: [],
    find: jest.fn(async (): Promise<Array<BaseModel>> => {
      return rows;
    }),
    save: jest.fn(async (entity: unknown): Promise<unknown> => {
      const saved: BaseModel = entity as BaseModel;

      if (!saved._id) {
        saved._id = RECORD_ID;
      }

      repository.saved.push(plainCopy(saved));

      return saved;
    }),
    update: jest.fn(
      async (
        _criteria: unknown,
        data: unknown,
      ): Promise<{ affected: number }> => {
        repository.written.push(plainCopy(data));
        return { affected: 1 };
      },
    ),
  };

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

  return repository;
}

function rootProps(): DatabaseCommonInteractionProps {
  return { isRoot: true, tenantId: PROJECT_ID };
}

class MaintenanceWrites extends DatabaseService<ScheduledMaintenance> {
  public constructor() {
    super(ScheduledMaintenance);
  }
}

class FormWrites extends DatabaseService<Form> {
  public constructor() {
    super(Form);
  }
}

class MonitorWrites extends DatabaseService<Monitor> {
  public constructor() {
    super(Monitor);
  }
}

// A new scheduled maintenance event whose description shows an image.
function newMaintenance(isVisibleOnStatusPage: unknown): ScheduledMaintenance {
  const event: ScheduledMaintenance = new ScheduledMaintenance();
  event.title = "Database upgrade";
  event.description = image("aaa111");
  event.projectId = PROJECT_ID;
  (event as unknown as Record<string, unknown>)["isVisibleOnStatusPage"] =
    isVisibleOnStatusPage;

  return event;
}

function storedMaintenance(
  isVisibleOnStatusPage: boolean,
): ScheduledMaintenance {
  const event: ScheduledMaintenance = new ScheduledMaintenance();
  event._id = RECORD_ID;
  event.projectId = PROJECT_ID;
  event.description = image("aaa111");
  event.isVisibleOnStatusPage = isVisibleOnStatusPage;

  return event;
}

beforeEach(() => {
  setImagesVisibility = jest.fn(async (): Promise<void> => {});

  jest
    .spyOn(PublishedImages, "setImagesVisibility")
    .mockImplementation(setImagesVisibility as never);
  jest
    .spyOn(FileService, "getFileOwners")
    .mockResolvedValue(new Map<string, FileOwners>() as never);
  jest
    .spyOn(AuditLogService, "recordCreate")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(AuditLogService, "recordUpdate")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const STORED_AS_TRUE: Array<[string, unknown]> = [
  ['"true"', "true"],
  ['"TRUE" with spaces around it', "  TRUE "],
  ['"yes"', "yes"],
  ['"t"', "t"],
  ['"on"', "on"],
  ['"1"', "1"],
  ["the number 1", 1],
];

const STORED_AS_FALSE: Array<[string, unknown]> = [
  ['"false"', "false"],
  ['"no"', "no"],
  ['"f"', "f"],
  ['"off"', "off"],
  ['"0"', "0"],
  ["the number 0", 0],
];

const REFUSED: Array<[string, unknown]> = [
  ['"maybe"', "maybe"],
  ['"" (an empty text)', ""],
  ['" "', " "],
  ['"o" (on or off)', "o"],
  ['"truex"', "truex"],
  ['"2"', "2"],
  ["the number 2", 2],
  ["the number 0.5", 0.5],
  ["an object", { value: true }],
  ["a list", [true]],
];

const REFUSED_MESSAGE: string = "isVisibleOnStatusPage must be true or false.";

describe("create: a switch written as text is the switch the database stores", () => {
  test.each(STORED_AS_TRUE)(
    "Visible on Status Page written as %s makes the event's images public",
    async (_label: string, value: unknown) => {
      const service: MaintenanceWrites = new MaintenanceWrites();
      const repository: FakeRepository = useRepository(service as never);

      await service.create({ data: newMaintenance(value), props: rootProps() });

      expect(visibilityAsked()).toEqual(["aaa111:public"]);
      // What reaches the database is the boolean it stores.
      expect(repository.saved).toHaveLength(1);
      expect(repository.saved[0]!["isVisibleOnStatusPage"]).toBe(true);
    },
  );

  test.each(STORED_AS_FALSE)(
    "Visible on Status Page written as %s keeps them private, and is stored false",
    async (_label: string, value: unknown) => {
      const service: MaintenanceWrites = new MaintenanceWrites();
      const repository: FakeRepository = useRepository(service as never);

      await service.create({ data: newMaintenance(value), props: rootProps() });

      expect(visibilityAsked()).toEqual([]);
      expect(repository.saved[0]!["isVisibleOnStatusPage"]).toBe(false);
    },
  );

  test('a form created accepting submissions with Enabled written as "yes" makes its texts\' images public', async () => {
    const service: FormWrites = new FormWrites();
    const repository: FakeRepository = useRepository(service as never);

    const form: Form = new Form();
    form.name = "Report an outage";
    form.projectId = PROJECT_ID;
    form.description = image("bbb222");
    form.successMessage = image("ccc333");
    (form as unknown as Record<string, unknown>)["isEnabled"] = "yes";

    await service.create({ data: form, props: rootProps() });

    expect(visibilityAsked().sort()).toEqual([
      "bbb222:public",
      "ccc333:public",
    ]);
    expect(repository.saved[0]!["isEnabled"]).toBe(true);
  });

  test.each(REFUSED)(
    "a switch written as %s, which the database refuses, is refused before anything is written",
    async (_label: string, value: unknown) => {
      const service: MaintenanceWrites = new MaintenanceWrites();
      const repository: FakeRepository = useRepository(service as never);

      const attempt: Promise<unknown> = service.create({
        data: newMaintenance(value),
        props: rootProps(),
      });

      await expect(attempt).rejects.toBeInstanceOf(BadDataException);
      await expect(attempt).rejects.toThrow(REFUSED_MESSAGE);
      expect(repository.save).not.toHaveBeenCalled();
      expect(setImagesVisibility).not.toHaveBeenCalled();
    },
  );

  test("null is no value, and is written as it is", async () => {
    const service: MaintenanceWrites = new MaintenanceWrites();
    const repository: FakeRepository = useRepository(service as never);

    const event: ScheduledMaintenance = newMaintenance(null);
    (event as unknown as Record<string, unknown>)[
      "shouldStatusPageSubscribersBeNotifiedOnEventCreated"
    ] = "no";

    await service.create({ data: event, props: rootProps() });

    expect(repository.saved[0]!["isVisibleOnStatusPage"]).toBeNull();
    expect(
      repository.saved[0]![
        "shouldStatusPageSubscribersBeNotifiedOnEventCreated"
      ],
    ).toBe(false);
  });

  test("columns that are not switches are left exactly as they were sent", async () => {
    const service: MaintenanceWrites = new MaintenanceWrites();
    const repository: FakeRepository = useRepository(service as never);

    const event: ScheduledMaintenance = newMaintenance(true);
    event.title = "yes";
    event.description = "0";

    await service.create({ data: event, props: rootProps() });

    expect(repository.saved[0]!["title"]).toBe("yes");
    expect(repository.saved[0]!["description"]).toBe("0");
  });
});

describe("update: a switch written as text is the switch the database stores", () => {
  test.each(STORED_AS_TRUE)(
    "Visible on Status Page written as %s is written as true",
    async (_label: string, value: unknown) => {
      const service: MaintenanceWrites = new MaintenanceWrites();
      const repository: FakeRepository = useRepository(service as never, [
        storedMaintenance(false),
      ]);

      await service.updateOneById({
        id: new ObjectID(RECORD_ID),
        data: { isVisibleOnStatusPage: value } as never,
        props: rootProps(),
      });

      expect(repository.written).toHaveLength(1);
      expect(repository.written[0]!["isVisibleOnStatusPage"]).toBe(true);
    },
  );

  test.each(STORED_AS_FALSE)(
    "Visible on Status Page written as %s is written as false",
    async (_label: string, value: unknown) => {
      const service: MaintenanceWrites = new MaintenanceWrites();
      const repository: FakeRepository = useRepository(service as never, [
        storedMaintenance(true),
      ]);

      await service.updateOneById({
        id: new ObjectID(RECORD_ID),
        data: { isVisibleOnStatusPage: value } as never,
        props: rootProps(),
      });

      expect(repository.written[0]!["isVisibleOnStatusPage"]).toBe(false);
    },
  );

  test.each(REFUSED)(
    "a switch written as %s is refused, and nothing is written",
    async (_label: string, value: unknown) => {
      const service: MaintenanceWrites = new MaintenanceWrites();
      const repository: FakeRepository = useRepository(service as never, [
        storedMaintenance(false),
      ]);

      const attempt: Promise<unknown> = service.updateOneById({
        id: new ObjectID(RECORD_ID),
        data: { isVisibleOnStatusPage: value } as never,
        props: rootProps(),
      });

      await expect(attempt).rejects.toBeInstanceOf(BadDataException);
      await expect(attempt).rejects.toThrow(REFUSED_MESSAGE);
      expect(repository.update).not.toHaveBeenCalled();
      expect(repository.save).not.toHaveBeenCalled();
    },
  );

  test("a workflow's Update step (updateOneBy, a plain object) is coerced the same way", async () => {
    const service: MaintenanceWrites = new MaintenanceWrites();
    const repository: FakeRepository = useRepository(service as never, [
      storedMaintenance(false),
    ]);

    await service.updateOneBy({
      query: { _id: RECORD_ID },
      data: {
        isVisibleOnStatusPage: "Yes",
        enableReminders: undefined,
      } as never,
      props: rootProps(),
    });

    expect(repository.written[0]!["isVisibleOnStatusPage"]).toBe(true);
  });

  test("an update written as a model is coerced too", async () => {
    const service: MaintenanceWrites = new MaintenanceWrites();
    const repository: FakeRepository = useRepository(service as never, [
      storedMaintenance(true),
    ]);

    const data: ScheduledMaintenance = new ScheduledMaintenance();
    (data as unknown as Record<string, unknown>)["isVisibleOnStatusPage"] =
      "off";

    await service.updateOneById({
      id: new ObjectID(RECORD_ID),
      data: data as never,
      props: rootProps(),
    });

    expect(repository.written[0]!["isVisibleOnStatusPage"]).toBe(false);
  });
});

describe("who archived a record follows the switch the database stores", () => {
  function notArchivedMonitor(): Monitor {
    const monitor: Monitor = new Monitor();
    monitor._id = RECORD_ID;
    monitor.projectId = PROJECT_ID;
    monitor.isArchived = false;

    return monitor;
  }

  function personProps(): DatabaseCommonInteractionProps {
    return { ...rootProps(), userId: USER_ID };
  }

  test.each(STORED_AS_FALSE)(
    "Archived written as %s over a monitor that is not archived stamps nothing",
    async (_label: string, value: unknown) => {
      const service: MonitorWrites = new MonitorWrites();
      const repository: FakeRepository = useRepository(service as never, [
        notArchivedMonitor(),
      ]);

      await service.updateOneById({
        id: new ObjectID(RECORD_ID),
        data: { isArchived: value } as never,
        props: personProps(),
      });

      const written: Record<string, unknown> = repository.written[0]!;

      // Nobody archived it, so nobody is recorded as having archived it.
      expect(written["archivedAt"]).toBeUndefined();
      expect(written["archivedByUserId"]).toBeUndefined();
      expect(written["isArchived"]).toBe(false);
    },
  );

  test.each(STORED_AS_TRUE)(
    "Archived written as %s archives it, and says when",
    async (_label: string, value: unknown) => {
      const service: MonitorWrites = new MonitorWrites();
      const repository: FakeRepository = useRepository(service as never, [
        notArchivedMonitor(),
      ]);

      await service.updateOneById({
        id: new ObjectID(RECORD_ID),
        data: { isArchived: value } as never,
        props: personProps(),
      });

      const written: Record<string, unknown> = repository.written[0]!;

      expect(written["isArchived"]).toBe(true);
      expect(written["archivedAt"]).toBeInstanceOf(Date);
    },
  );
});

describe("the refusal names the column, in one plain sentence", () => {
  test("for a monitor's switch", async () => {
    const service: MonitorWrites = new MonitorWrites();
    useRepository(service as never, []);

    const monitor: Monitor = new Monitor();
    monitor.name = "Checkout";
    monitor.projectId = PROJECT_ID;
    (monitor as unknown as Record<string, unknown>)["disableActiveMonitoring"] =
      "sometimes";

    await expect(
      service.create({ data: monitor, props: rootProps() }),
    ).rejects.toThrow("disableActiveMonitoring must be true or false.");
  });

  test("a write the API sent as JSON is refused the same way", async () => {
    const service: MonitorWrites = new MonitorWrites();
    useRepository(service as never, [new Monitor(new ObjectID(RECORD_ID))]);

    const body: JSONObject = { isArchived: "archived" };

    await expect(
      service.updateOneById({
        id: new ObjectID(RECORD_ID),
        data: body as never,
        props: rootProps(),
      }),
    ).rejects.toThrow("isArchived must be true or false.");
  });
});
