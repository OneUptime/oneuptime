import IncomingRequestSecret from "../../../Models/DatabaseModels/IncomingRequestSecret";
import Project from "../../../Models/DatabaseModels/Project";
import IncomingRequestSecretService, {
  LAST_INCOMING_REQUEST_SECRET_MESSAGE,
  NO_INCOMING_REQUEST_SECRET_TO_REQUIRE_MESSAGE,
  Service as IncomingRequestSecretServiceClass,
} from "../../../Server/Services/IncomingRequestSecretService";
import ProjectService from "../../../Server/Services/ProjectService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import IncomingRequestSecretPolicy from "../../../Server/Utils/Monitor/IncomingRequestSecretPolicy";
import BadDataException from "../../../Types/Exception/BadDataException";
import IncomingRequestSecretRules, {
  IncomingRequestSecretValueProblem,
} from "../../../Types/Monitor/IncomingMonitor/IncomingRequestSecret";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A project's incoming request secrets, as IncomingRequestSecretService
 * writes them (issue #7526):
 *
 *   - a secret left empty is generated, strong; one someone typed is held to
 *     the rules the Dashboard shows, and kept trimmed;
 *   - the project's last secret cannot be deleted while the project requires
 *     one, since every request would then be refused;
 *   - every change forgets the project's cached policy, so the next request
 *     is judged by it;
 *   - and on Project: the requirement cannot be turned on with no secret.
 *
 * The rows a write reads, the counts and the project are stubs.
 */

jest.mock("../../../Server/Utils/Logger");

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-00000000000a",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "bbbbbbbb-0000-4000-8000-00000000000b",
);
const SECRET_ID: ObjectID = new ObjectID(
  "5ec2e700-0000-4000-8000-000000000001",
);

type OnBeforeCreate = (
  createBy: CreateBy<IncomingRequestSecret>,
) => Promise<OnCreate<IncomingRequestSecret>>;

type OnCreateSuccess = (
  onCreate: OnCreate<IncomingRequestSecret>,
  createdItem: IncomingRequestSecret,
) => Promise<IncomingRequestSecret>;

type OnBeforeDelete = (
  deleteBy: DeleteBy<IncomingRequestSecret>,
) => Promise<OnDelete<IncomingRequestSecret>>;

type OnDeleteSuccess = (
  onDelete: OnDelete<IncomingRequestSecret>,
  itemIdsBeforeDelete: Array<ObjectID>,
) => Promise<OnDelete<IncomingRequestSecret>>;

const hooks: {
  onBeforeCreate: OnBeforeCreate;
  onCreateSuccess: OnCreateSuccess;
  onBeforeDelete: OnBeforeDelete;
  onDeleteSuccess: OnDeleteSuccess;
} = IncomingRequestSecretService as unknown as {
  onBeforeCreate: OnBeforeCreate;
  onCreateSuccess: OnCreateSuccess;
  onBeforeDelete: OnBeforeDelete;
  onDeleteSuccess: OnDeleteSuccess;
};

const createBy: (data: Partial<IncomingRequestSecret>) => CreateBy<IncomingRequestSecret> = (
  data: Partial<IncomingRequestSecret>,
): CreateBy<IncomingRequestSecret> => {
  const secret: IncomingRequestSecret = new IncomingRequestSecret();
  Object.assign(secret, { projectId: PROJECT_ID, name: "Heartbeats", ...data });

  return {
    data: secret,
    props: { tenantId: PROJECT_ID },
  } as CreateBy<IncomingRequestSecret>;
};

let requireSecret: boolean;
let secretCount: number;
let rowsToDelete: Array<IncomingRequestSecret>;
let forget: jest.SpiedFunction<typeof IncomingRequestSecretPolicy.forget>;

beforeEach(() => {
  requireSecret = true;
  secretCount = 2;
  rowsToDelete = [];

  jest.spyOn(ProjectService, "findOneById").mockImplementation(async () => {
    const project: Project = new Project();
    project.requireIncomingRequestSecret = requireSecret;
    return project;
  });

  jest
    .spyOn(IncomingRequestSecretService, "countBy")
    .mockImplementation(async () => {
      return new PositiveNumber(secretCount);
    });

  jest
    .spyOn(IncomingRequestSecretService, "findRowsAndHoldDeleteToThem")
    .mockImplementation(async () => {
      return rowsToDelete;
    });

  forget = jest
    .spyOn(IncomingRequestSecretPolicy, "forget")
    .mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const row: (projectId: ObjectID, id?: ObjectID) => IncomingRequestSecret = (
  projectId: ObjectID,
  id?: ObjectID,
): IncomingRequestSecret => {
  const secret: IncomingRequestSecret = new IncomingRequestSecret();
  secret.id = id || ObjectID.generate();
  secret.projectId = projectId;
  return secret;
};

describe("generateSecretValue", () => {
  test("is 32 random bytes as 64 hex characters, a valid secret", () => {
    const value: string = IncomingRequestSecretServiceClass.generateSecretValue();

    expect(value).toMatch(/^[0-9a-f]{64}$/);
    expect(IncomingRequestSecretRules.getValueProblem(value)).toBeNull();
  });

  test("is different every time", () => {
    const values: Set<string> = new Set<string>();

    for (let i: number = 0; i < 50; i++) {
      values.add(IncomingRequestSecretServiceClass.generateSecretValue());
    }

    expect(values.size).toBe(50);
  });
});

describe("creating a secret", () => {
  test.each([[undefined], [""], ["    "]])(
    "a value left empty (%j) is generated",
    async (value: string | undefined) => {
      const onCreate: OnCreate<IncomingRequestSecret> =
        await hooks.onBeforeCreate(createBy({ secretValue: value }));

      expect(onCreate.createBy.data.secretValue).toMatch(/^[0-9a-f]{64}$/);
    },
  );

  test("a typed value is kept, trimmed as it is compared", async () => {
    const onCreate: OnCreate<IncomingRequestSecret> =
      await hooks.onBeforeCreate(
        createBy({ secretValue: "  my-own-secret-value-123  " }),
      );

    expect(onCreate.createBy.data.secretValue).toBe("my-own-secret-value-123");
  });

  test("a typed value that breaks the rules is refused with the rule's words", async () => {
    await expect(
      hooks.onBeforeCreate(createBy({ secretValue: "too-short" })),
    ).rejects.toThrow(
      new BadDataException(
        IncomingRequestSecretRules.getValueProblemMessage(
          IncomingRequestSecretValueProblem.TooShort,
        ),
      ),
    );

    await expect(
      hooks.onBeforeCreate(createBy({ secretValue: "has a space inside it" })),
    ).rejects.toThrow(
      IncomingRequestSecretRules.getValueProblemMessage(
        IncomingRequestSecretValueProblem.UnsupportedCharacters,
      ),
    );
  });

  test("the name is kept trimmed", async () => {
    const onCreate: OnCreate<IncomingRequestSecret> =
      await hooks.onBeforeCreate(createBy({ name: "  Heartbeats  " }));

    expect(onCreate.createBy.data.name).toBe("Heartbeats");
  });

  test("a new secret forgets the project's cached policy", async () => {
    const onCreate: OnCreate<IncomingRequestSecret> =
      await hooks.onBeforeCreate(createBy({}));

    const created: IncomingRequestSecret = row(PROJECT_ID, SECRET_ID);

    await hooks.onCreateSuccess(onCreate, created);

    expect(forget).toHaveBeenCalledTimes(1);
    expect(forget.mock.calls[0]![0].toString()).toBe(PROJECT_ID.toString());
  });
});

describe("deleting a secret", () => {
  const deleteBy: DeleteBy<IncomingRequestSecret> = {
    query: { _id: SECRET_ID.toString() },
    props: { tenantId: PROJECT_ID },
  } as DeleteBy<IncomingRequestSecret>;

  test("the project's last secret is not deleted while it requires one", async () => {
    rowsToDelete = [row(PROJECT_ID, SECRET_ID)];
    secretCount = 1;

    await expect(hooks.onBeforeDelete(deleteBy)).rejects.toThrow(
      LAST_INCOMING_REQUEST_SECRET_MESSAGE,
    );
  });

  test("deleting every secret at once is refused too", async () => {
    rowsToDelete = [row(PROJECT_ID), row(PROJECT_ID)];
    secretCount = 2;

    await expect(hooks.onBeforeDelete(deleteBy)).rejects.toThrow(
      LAST_INCOMING_REQUEST_SECRET_MESSAGE,
    );
  });

  test("a secret is deleted when another one remains", async () => {
    rowsToDelete = [row(PROJECT_ID, SECRET_ID)];
    secretCount = 2;

    const onDelete: OnDelete<IncomingRequestSecret> =
      await hooks.onBeforeDelete(deleteBy);

    expect(onDelete.carryForward).toEqual([PROJECT_ID.toString()]);
  });

  test("the last secret is deleted when the project does not require one", async () => {
    requireSecret = false;
    rowsToDelete = [row(PROJECT_ID, SECRET_ID)];
    secretCount = 1;

    await expect(hooks.onBeforeDelete(deleteBy)).resolves.toBeDefined();
  });

  test("each project a delete touches is judged by its own secrets", async () => {
    rowsToDelete = [row(PROJECT_ID), row(OTHER_PROJECT_ID)];
    secretCount = 2;

    const onDelete: OnDelete<IncomingRequestSecret> =
      await hooks.onBeforeDelete(deleteBy);

    expect(new Set(onDelete.carryForward as Array<string>)).toEqual(
      new Set([PROJECT_ID.toString(), OTHER_PROJECT_ID.toString()]),
    );
  });

  test("a delete forgets the cached policy of every project it touched", async () => {
    await hooks.onDeleteSuccess(
      {
        deleteBy,
        carryForward: [PROJECT_ID.toString(), OTHER_PROJECT_ID.toString()],
      },
      [],
    );

    expect(
      forget.mock.calls.map((call: [ObjectID | string]) => {
        return call[0].toString();
      }),
    ).toEqual([PROJECT_ID.toString(), OTHER_PROJECT_ID.toString()]);
  });
});

describe("turning the requirement on (ProjectService)", () => {
  type AssertCanTurnOn = (updateBy: UpdateBy<Project>) => Promise<void>;

  const assertCanTurnOn: AssertCanTurnOn = (
    updateBy: UpdateBy<Project>,
  ): Promise<void> => {
    return (
      ProjectService as unknown as {
        assertIncomingRequestSecretCanTurnOn: AssertCanTurnOn;
      }
    ).assertIncomingRequestSecretCanTurnOn(updateBy);
  };

  const turnOn: (value: boolean) => UpdateBy<Project> = (
    value: boolean,
  ): UpdateBy<Project> => {
    return {
      query: { _id: PROJECT_ID.toString() },
      data: { requireIncomingRequestSecret: value },
      props: { tenantId: PROJECT_ID },
    } as unknown as UpdateBy<Project>;
  };

  beforeEach(() => {
    jest
      .spyOn(ProjectService, "findRowsAndHoldUpdateToThem")
      .mockImplementation(async () => {
        const project: Project = new Project();
        project.id = PROJECT_ID;
        return [project];
      });
  });

  test("is refused while the project has no secret", async () => {
    secretCount = 0;

    await expect(assertCanTurnOn(turnOn(true))).rejects.toThrow(
      NO_INCOMING_REQUEST_SECRET_TO_REQUIRE_MESSAGE,
    );
  });

  test("goes ahead once the project has a secret", async () => {
    secretCount = 1;

    await expect(assertCanTurnOn(turnOn(true))).resolves.toBeUndefined();
  });

  test("turning it off is never refused, and reads nothing", async () => {
    secretCount = 0;

    await expect(assertCanTurnOn(turnOn(false))).resolves.toBeUndefined();
    expect(IncomingRequestSecretService.countBy).not.toHaveBeenCalled();
  });

  test("both refusals are sentences that say what to do next", () => {
    for (const message of [
      NO_INCOMING_REQUEST_SECRET_TO_REQUIRE_MESSAGE,
      LAST_INCOMING_REQUEST_SECRET_MESSAGE,
    ]) {
      expect(message).toMatch(/^[A-Z]/);
      expect(message.endsWith(".")).toBe(true);
    }

    expect(NO_INCOMING_REQUEST_SECRET_TO_REQUIRE_MESSAGE).toContain(
      "Create a secret",
    );
    expect(LAST_INCOMING_REQUEST_SECRET_MESSAGE).toContain(
      "Create another secret first",
    );
  });
});
