import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it, and DatabaseService - the base class
 * of the service below - imports it.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import {
  ResolvedApiKey,
  Service as ApiKeyServiceClass,
} from "../../../Server/Services/ApiKeyService";
import ApiKey from "../../../Models/DatabaseModels/ApiKey";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";

/*
 * ApiKeyService.findApiKey is the cached lookup every API-key request goes
 * through. It now also returns the key's NAME, so the audit trail can say
 * which key made a change (ProjectAuthorization stamps it on the request).
 *
 * What is pinned: the name is selected and survives the cache; a key without
 * a name has no name rather than an empty one; and the name is as fresh as
 * the rest of the cached row - cleared on this node when a key is updated or
 * deleted, and at most a minute stale on the others.
 *
 * A fresh Service per test, so no test inherits another's cache.
 */

type SpyInstance = ReturnType<typeof getJestSpyOn>;

interface FindOneByCall {
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  props: Record<string, unknown>;
}

interface CacheClearingHooks {
  onBeforeUpdate: (updateBy: UpdateBy<ApiKey>) => Promise<unknown>;
  onBeforeDelete: (deleteBy: DeleteBy<ApiKey>) => Promise<unknown>;
}

const KEY_VALUE: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_KEY_VALUE: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const KEY_ROW_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const POSITIVE_TTL_MS: number = 60 * 1000;
const NEGATIVE_TTL_MS: number = 10 * 1000;

const keyRow: (name?: string | undefined) => ApiKey = (
  name?: string | undefined,
): ApiKey => {
  const row: ApiKey = new ApiKey();

  row._id = KEY_ROW_ID.toString();
  row.projectId = PROJECT_ID;

  if (name !== undefined) {
    row.name = name;
  }

  return row;
};

describe("ApiKeyService.findApiKey - the key's name, for the audit trail", () => {
  let service: ApiKeyServiceClass;
  let findOneBySpy: SpyInstance;
  let nowSpy: ReturnType<typeof jest.spyOn>;
  let currentTime: number;

  beforeEach(() => {
    service = new ApiKeyServiceClass();
    findOneBySpy = getJestSpyOn(service, "findOneBy").mockResolvedValue(null);

    currentTime = 1_800_000_000_000;
    nowSpy = jest.spyOn(Date, "now").mockImplementation((): number => {
      return currentTime;
    });
  });

  afterEach(() => {
    nowSpy.mockRestore();
    jest.restoreAllMocks();
  });

  test("selects the name along with the id and the project", async () => {
    await service.findApiKey(KEY_VALUE);

    expect(findOneBySpy).toHaveBeenCalledTimes(1);

    const call: FindOneByCall = findOneBySpy.mock.calls[0]![0] as FindOneByCall;

    expect(call.select).toEqual({
      _id: true,
      projectId: true,
      name: true,
    });
    expect(call.props).toEqual({ isRoot: true });
  });

  test("never selects the key value itself back out", async () => {
    await service.findApiKey(KEY_VALUE);

    const call: FindOneByCall = findOneBySpy.mock.calls[0]![0] as FindOneByCall;

    expect(call.select).not.toHaveProperty("apiKey");
  });

  test("still looks the key up by its value, and only while it has not expired", async () => {
    await service.findApiKey(KEY_VALUE);

    const call: FindOneByCall = findOneBySpy.mock.calls[0]![0] as FindOneByCall;

    expect(Object.keys(call.query).sort()).toEqual(["apiKey", "expiresAt"]);
    expect((call.query["apiKey"] as ObjectID).toString()).toBe(
      KEY_VALUE.toString(),
    );
  });

  test("returns the key's id, project and name", async () => {
    findOneBySpy.mockResolvedValue(keyRow("Terraform"));

    const resolved: ResolvedApiKey | null = await service.findApiKey(KEY_VALUE);

    expect(resolved?.id.toString()).toBe(KEY_ROW_ID.toString());
    expect(resolved?.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(resolved?.name).toBe("Terraform");
  });

  test("a key without a name has NO name property - not an empty string, not undefined", async () => {
    findOneBySpy.mockResolvedValue(keyRow(undefined));

    const resolved: ResolvedApiKey | null = await service.findApiKey(KEY_VALUE);

    expect(resolved).not.toBeNull();
    expect(resolved).not.toHaveProperty("name");
    expect(Object.keys(resolved!).sort()).toEqual(["id", "projectId"]);
  });

  test("an empty name is no name", async () => {
    findOneBySpy.mockResolvedValue(keyRow(""));

    const resolved: ResolvedApiKey | null = await service.findApiKey(KEY_VALUE);

    expect(resolved).not.toHaveProperty("name");
  });

  test("the name survives the cache: a second lookup costs no query and still names the key", async () => {
    findOneBySpy.mockResolvedValue(keyRow("Terraform"));

    await service.findApiKey(KEY_VALUE);
    const cached: ResolvedApiKey | null = await service.findApiKey(KEY_VALUE);

    expect(findOneBySpy).toHaveBeenCalledTimes(1);
    expect(cached?.name).toBe("Terraform");
    expect(cached?.id.toString()).toBe(KEY_ROW_ID.toString());
    expect(cached?.projectId.toString()).toBe(PROJECT_ID.toString());
    // ObjectIDs again, not the strings the cache holds.
    expect(cached?.id).toBeInstanceOf(ObjectID);
    expect(cached?.projectId).toBeInstanceOf(ObjectID);
  });

  test("a nameless key is still nameless from the cache", async () => {
    findOneBySpy.mockResolvedValue(keyRow(undefined));

    await service.findApiKey(KEY_VALUE);
    const cached: ResolvedApiKey | null = await service.findApiKey(KEY_VALUE);

    expect(findOneBySpy).toHaveBeenCalledTimes(1);
    expect(cached).not.toHaveProperty("name");
  });

  test("two keys are cached apart: one key's name is never served for another", async () => {
    findOneBySpy.mockImplementation(
      async (findOneBy: FindOneByCall): Promise<ApiKey> => {
        const row: ApiKey = keyRow(
          (findOneBy.query["apiKey"] as ObjectID).toString() ===
            KEY_VALUE.toString()
            ? "Terraform"
            : "CI",
        );

        return row;
      },
    );

    const first: ResolvedApiKey | null = await service.findApiKey(KEY_VALUE);
    const second: ResolvedApiKey | null =
      await service.findApiKey(OTHER_KEY_VALUE);
    const firstAgain: ResolvedApiKey | null =
      await service.findApiKey(KEY_VALUE);

    expect(first?.name).toBe("Terraform");
    expect(second?.name).toBe("CI");
    expect(firstAgain?.name).toBe("Terraform");
    expect(findOneBySpy).toHaveBeenCalledTimes(2);
  });

  test("a rename is picked up within a minute on a node that did not see the update", async () => {
    findOneBySpy.mockResolvedValue(keyRow("Terraform"));
    await service.findApiKey(KEY_VALUE);

    findOneBySpy.mockResolvedValue(keyRow("Terraform (prod)"));

    // Still inside the minute: the old name.
    currentTime += POSITIVE_TTL_MS;
    expect((await service.findApiKey(KEY_VALUE))?.name).toBe("Terraform");
    expect(findOneBySpy).toHaveBeenCalledTimes(1);

    // Past it: read again.
    currentTime += 1;
    expect((await service.findApiKey(KEY_VALUE))?.name).toBe(
      "Terraform (prod)",
    );
    expect(findOneBySpy).toHaveBeenCalledTimes(2);
  });

  test("a rename is picked up at once on the node that made it: updating any key clears the cache", async () => {
    findOneBySpy.mockResolvedValue(keyRow("Terraform"));
    await service.findApiKey(KEY_VALUE);

    await (service as unknown as CacheClearingHooks).onBeforeUpdate({
      query: {},
      data: {},
      props: { isRoot: true },
    } as unknown as UpdateBy<ApiKey>);

    findOneBySpy.mockResolvedValue(keyRow("Terraform (prod)"));

    expect((await service.findApiKey(KEY_VALUE))?.name).toBe(
      "Terraform (prod)",
    );
    expect(findOneBySpy).toHaveBeenCalledTimes(2);
  });

  test("a deleted key stops resolving at once on the node that deleted it", async () => {
    findOneBySpy.mockResolvedValue(keyRow("Terraform"));
    await service.findApiKey(KEY_VALUE);

    await (service as unknown as CacheClearingHooks).onBeforeDelete({
      query: {},
      props: { isRoot: true },
    } as unknown as DeleteBy<ApiKey>);

    findOneBySpy.mockResolvedValue(null);

    await expect(service.findApiKey(KEY_VALUE)).resolves.toBeNull();
    expect(findOneBySpy).toHaveBeenCalledTimes(2);
  });

  test("an unknown key is null, with no name to report", async () => {
    await expect(service.findApiKey(KEY_VALUE)).resolves.toBeNull();
  });

  test("an unknown key is remembered briefly, then looked up again", async () => {
    await service.findApiKey(KEY_VALUE);
    await service.findApiKey(KEY_VALUE);

    expect(findOneBySpy).toHaveBeenCalledTimes(1);

    currentTime += NEGATIVE_TTL_MS + 1;
    findOneBySpy.mockResolvedValue(keyRow("Terraform"));

    expect((await service.findApiKey(KEY_VALUE))?.name).toBe("Terraform");
    expect(findOneBySpy).toHaveBeenCalledTimes(2);
  });

  test("a row with no project is not a usable key, whatever it is called", async () => {
    const row: ApiKey = new ApiKey();
    row._id = KEY_ROW_ID.toString();
    row.name = "Orphan";

    findOneBySpy.mockResolvedValue(row);

    await expect(service.findApiKey(KEY_VALUE)).resolves.toBeNull();
  });
});
