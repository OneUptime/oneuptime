import User from "../../../Models/DatabaseModels/User";
import EnterpriseEdition from "../../../Server/Enterprise/EnterpriseEdition";
import UserService from "../../../Server/Services/UserService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import {
  getTableColumn,
  TableColumnMetadata,
} from "../../../Types/Database/TableColumn";
import Email from "../../../Types/Email";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import Dictionary from "../../../Types/Dictionary";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import { getColumnAccessControlForAllColumns } from "../../../Types/Database/AccessControl/ColumnAccessControl";
import { READER_LANGUAGE_CODES } from "../../../Types/ReaderLanguage";
import { UNSUPPORTED_USER_LANGUAGE_MESSAGE } from "../../../Types/UserLanguage";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A PERSON'S LANGUAGE, AS A WRITE STORES IT (fu-i18n-larger).
 *
 * User.language is theirs to set - User Profile's Language, the Dashboard's
 * language menu, the API - and holds one of the codes OneUptime writes in,
 * or nothing. UserService's create and update hooks rewrite what a write
 * sends ("de-AT" is "de", an empty one none) and refuse a language
 * OneUptime does not write in, before any permission check reads it. A
 * write that does not name a language is left alone.
 *
 * No database: the hooks are reached through a structural cast, and the
 * Enterprise seat check a create runs is stubbed.
 */

interface UserServiceHooks {
  onBeforeCreate: (createBy: CreateBy<User>) => Promise<OnCreate<User>>;
  onBeforeUpdate: (updateBy: UpdateBy<User>) => Promise<OnUpdate<User>>;
}

const hooks: UserServiceHooks = UserService as unknown as UserServiceHooks;

const USER_ID: ObjectID = new ObjectID("6d1d4a10-7a3b-4c2e-9f0a-2b5e8c1d3f01");

const update: (data: Record<string, unknown>) => UpdateBy<User> = (
  data: Record<string, unknown>,
): UpdateBy<User> => {
  return {
    query: { _id: USER_ID.toString() },
    data: data as UpdateBy<User>["data"],
    props: { isRoot: true },
  } as UpdateBy<User>;
};

const updatedLanguage: (value: unknown) => Promise<unknown> = async (
  value: unknown,
): Promise<unknown> => {
  const onUpdate: OnUpdate<User> = await hooks.onBeforeUpdate(
    update({ language: value }),
  );

  return (onUpdate.updateBy.data as Record<string, unknown>)["language"];
};

const created: (user: User) => Promise<User> = async (
  user: User,
): Promise<User> => {
  const onCreate: OnCreate<User> = await hooks.onBeforeCreate({
    data: user,
    props: { isRoot: true },
  });

  return onCreate.createBy.data;
};

beforeEach(() => {
  jest
    .spyOn(EnterpriseEdition, "assertSeatAvailableForNewUser")
    .mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the column", () => {
  test("is the person's own to read and change, and nobody's to set on create", () => {
    const access: Dictionary<ColumnAccessControl> =
      getColumnAccessControlForAllColumns(new User());

    expect(access["language"]?.read).toEqual([Permission.CurrentUser]);
    expect(access["language"]?.update).toEqual([Permission.CurrentUser]);
    expect(access["language"]?.create).toEqual([]);
  });

  test("says what it is for in the API reference, within a field's two lines", () => {
    const column: TableColumnMetadata = getTableColumn(new User(), "language");

    expect(column.title).toBe("Language");
    expect(column.example).toBe("de");
    expect(column.description).toContain("on-call pages");
    expect((column.description || "").length).toBeLessThanOrEqual(150);
  });
});

describe("an update that names a language", () => {
  test("keeps each of the codes OneUptime writes in", async () => {
    for (const code of READER_LANGUAGE_CODES) {
      expect([code, await updatedLanguage(code)]).toEqual([code, code]);
    }
  });

  test("stores a regional tag as its language", async () => {
    expect(await updatedLanguage("de-AT")).toBe("de");
    expect(await updatedLanguage("zh-HK")).toBe("zh-TW");
    expect(await updatedLanguage(" nb-NO ")).toBe("no");
  });

  test("stores an empty one, or null, as none", async () => {
    expect(await updatedLanguage("")).toBeNull();
    expect(await updatedLanguage("   ")).toBeNull();
    expect(await updatedLanguage(null)).toBeNull();
  });

  test("refuses a language OneUptime does not write in, naming the ones it does", async () => {
    for (const value of ["xx", "klingon", 7, { code: "de" }, ["de"]]) {
      await expect(updatedLanguage(value)).rejects.toThrow(BadDataException);
      await expect(updatedLanguage(value)).rejects.toThrow(
        UNSUPPORTED_USER_LANGUAGE_MESSAGE,
      );
    }
  });
});

describe("an update that does not name a language", () => {
  test("is left as it is: the language is not touched", async () => {
    const onUpdate: OnUpdate<User> = await hooks.onBeforeUpdate(
      update({ name: "Ana Lima" }),
    );

    expect(
      Object.prototype.hasOwnProperty.call(onUpdate.updateBy.data, "language"),
    ).toBe(false);
  });
});

describe("a new account", () => {
  test("keeps no language unless the write names one", async () => {
    const user: User = new User();
    user.email = new Email("ana@example.com");

    const data: User = await created(user);

    expect(data.language).toBeUndefined();
  });

  test("stores a named language as one of OneUptime's codes", async () => {
    const user: User = new User();
    user.email = new Email("ana@example.com");
    user.language = "fr-CA";

    expect((await created(user)).language).toBe("fr");
  });

  test("refuses a language OneUptime does not write in", async () => {
    const user: User = new User();
    user.email = new Email("ana@example.com");
    user.language = "xx";

    await expect(created(user)).rejects.toThrow(
      UNSUPPORTED_USER_LANGUAGE_MESSAGE,
    );
  });
});
