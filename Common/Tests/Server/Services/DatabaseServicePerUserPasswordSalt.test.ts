import UserService from "../../../Server/Services/UserService";
import StatusPagePrivateUserService from "../../../Server/Services/StatusPagePrivateUserService";
import DashboardService from "../../../Server/Services/DashboardService";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import { EncryptionSecret } from "../../../Server/EnvironmentConfig";
import User from "../../../Models/DatabaseModels/User";
import StatusPagePrivateUser from "../../../Models/DatabaseModels/StatusPagePrivateUser";
import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import Email from "../../../Types/Email";
import HashedString from "../../../Types/HashedString";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import CryptoJS from "crypto-js";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Per-user password salts, at the layer that actually writes them.
 *
 * The salt is not something callers pass in — it is minted by the write path
 * itself, onto the same payload as the hash it was computed from, so the two
 * can never be persisted out of step. These tests exercise that from both
 * write paths (create goes through `hash()`, update through
 * `sanitizeCreateOrUpdate`) and pin the pieces that are easy to break
 * without noticing:
 *
 *   - a salt column that forgets `computed: true` breaks every non-root
 *     create of a row carrying a password, because the create permission
 *     check runs AFTER hashing and would reject a column nobody may write;
 *   - a hashed column with no declared salt column (session refresh tokens,
 *     master passwords) must keep hashing exactly as it always did;
 *   - an update that does not touch the password must not touch the salt,
 *     or every password in the affected rows stops verifying.
 *
 * No Postgres anywhere: the write pipeline's own hashing steps are called
 * directly, and the one method that would write is stubbed.
 */

type SanitizeFunction = (
  data: unknown,
  props: DatabaseCommonInteractionProps,
  isUpdate?: boolean,
) => Promise<JSONObject>;

const sanitize: SanitizeFunction = (
  data: unknown,
  props: DatabaseCommonInteractionProps,
  isUpdate: boolean = true,
): Promise<JSONObject> => {
  return (
    UserService as unknown as {
      sanitizeCreateOrUpdate: SanitizeFunction;
    }
  ).sanitizeCreateOrUpdate(data, props, isUpdate) as Promise<JSONObject>;
};

type HashFunction<T> = (data: T) => Promise<T>;

const hashUser: HashFunction<User> = (data: User): Promise<User> => {
  return (UserService as unknown as { hash: HashFunction<User> }).hash(data);
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Model metadata — the password columns declare their salt", () => {
  test("User.password points at User.passwordSalt", () => {
    const metadata: TableColumnMetadata = new User().getTableColumnMetadata(
      "password",
    );

    expect(metadata.hashed).toBe(true);
    expect(metadata.hashSaltColumn).toBe("passwordSalt");
  });

  test("StatusPagePrivateUser.password points at StatusPagePrivateUser.passwordSalt", () => {
    const metadata: TableColumnMetadata =
      new StatusPagePrivateUser().getTableColumnMetadata("password");

    expect(metadata.hashed).toBe(true);
    expect(metadata.hashSaltColumn).toBe("passwordSalt");
  });

  test("the salt columns actually exist on both models", () => {
    expect(new User().hasColumn("passwordSalt")).toBe(true);
    expect(new StatusPagePrivateUser().hasColumn("passwordSalt")).toBe(true);
  });

  test("both salt columns are marked computed", () => {
    /*
     * Load bearing. On create, hash() mints the salt BEFORE
     * checkCreatePermissions runs, and checkDataColumnPermissions only lets
     * an unpermitted column through on create when it is computed. Drop the
     * flag and every public signup starts failing with "User is not allowed
     * to create on passwordSalt column".
     */
    expect(new User().getTableColumnMetadata("passwordSalt").computed).toBe(
      true,
    );
    expect(
      new StatusPagePrivateUser().getTableColumnMetadata("passwordSalt")
        .computed,
    ).toBe(true);
  });

  test("nobody may create, read or update the salt through the API", () => {
    for (const model of [new User(), new StatusPagePrivateUser()]) {
      const accessControl: {
        create?: Array<unknown>;
        read?: Array<unknown>;
        update?: Array<unknown>;
      } = model.getColumnAccessControlFor("passwordSalt") as {
        create?: Array<unknown>;
        read?: Array<unknown>;
        update?: Array<unknown>;
      };

      expect(accessControl.create).toEqual([]);
      expect(accessControl.read).toEqual([]);
      expect(accessControl.update).toEqual([]);
    }
  });

  test("a salt fits the column that stores it", () => {
    const metadata: TableColumnMetadata = new User().getTableColumnMetadata(
      "passwordSalt",
    );

    // ShortText — 100 characters. A generated salt is 64.
    expect(metadata.type).toBe(TableColumnType.ShortText);
    expect(HashedString.generateSalt().length).toBeLessThanOrEqual(100);
  });
});

describe("Create path — hash() mints a per-record salt", () => {
  test("hashes the password and writes the salt it used onto the same model", async () => {
    const user: User = new User();
    user.email = new Email("salted@example.com");
    user.password = new HashedString("my-password");

    await hashUser(user);

    expect(user.passwordSalt).toMatch(/^[0-9a-f]{64}$/);
    expect(user.password!.isValueHashed()).toBe(true);
    expect(user.password!.toString()).not.toBe("my-password");

    await expect(
      HashedString.verifyValue({
        plainValue: "my-password",
        hashedValue: user.password!.toString(),
        encryptionSecret: EncryptionSecret,
        salt: user.passwordSalt || null,
      }),
    ).resolves.toBe(true);
  });

  test("two users signing up with the SAME password get different salts and different hashes", async () => {
    const first: User = new User();
    first.email = new Email("one@example.com");
    first.password = new HashedString("shared-password");

    const second: User = new User();
    second.email = new Email("two@example.com");
    second.password = new HashedString("shared-password");

    await hashUser(first);
    await hashUser(second);

    expect(first.passwordSalt).not.toBe(second.passwordSalt);
    expect(first.password!.toString()).not.toBe(second.password!.toString());
  });

  test("the stored hash is no longer the global-secret digest it used to be", async () => {
    const user: User = new User();
    user.password = new HashedString("my-password");

    await hashUser(user);

    const legacyDigest: string = CryptoJS.SHA256(
      EncryptionSecret.toString() + "my-password",
    ).toString();

    expect(user.password!.toString()).not.toBe(legacyDigest);
  });

  test("an already-hashed value is left alone and gets no new salt", async () => {
    const user: User = new User();
    user.password = new HashedString("already-a-digest", true);

    await hashUser(user);

    expect(user.password!.toString()).toBe("already-a-digest");
    expect(user.passwordSalt).toBeUndefined();
  });

  test("a user created without a password gets no salt", async () => {
    const user: User = new User();
    user.email = new Email("invited@example.com");

    await hashUser(user);

    expect(user.passwordSalt).toBeUndefined();
  });

  test("the minted salt survives the create permission check for a public signup", () => {
    /*
     * This is the ordering trap. Signup is not a root write, and
     * checkCreatePermissions runs after hash() has already put passwordSalt
     * on the payload.
     */
    const user: User = new User();
    user.email = new Email("signup@example.com");
    user.password = new HashedString("digest", true);
    user.passwordSalt = HashedString.generateSalt();

    expect(() => {
      ColumnPermissions.checkDataColumnPermissions(
        User,
        user,
        {} as DatabaseCommonInteractionProps,
        DatabaseRequestType.Create,
      );
    }).not.toThrow();
  });

  test("a caller still cannot smuggle a salt in on an update", () => {
    /*
     * The mirror of the test above, and the reason the update path adds the
     * salt AFTER its permission check rather than before: on update there is
     * no `computed` escape hatch.
     */
    const user: User = new User();
    user.passwordSalt = HashedString.generateSalt();

    expect(() => {
      ColumnPermissions.checkDataColumnPermissions(
        User,
        user,
        {} as DatabaseCommonInteractionProps,
        DatabaseRequestType.Update,
      );
    }).toThrow("not allowed to update on passwordSalt");
  });
});

describe("Update path — sanitizeCreateOrUpdate mints a per-record salt", () => {
  test("hashes the new password and adds the salt to the same update payload", async () => {
    const data: JSONObject = await sanitize(
      { password: new HashedString("new-password") },
      { isRoot: true },
    );

    expect(typeof data["password"]).toBe("string");
    expect(data["passwordSalt"]).toMatch(/^[0-9a-f]{64}$/);

    await expect(
      HashedString.verifyValue({
        plainValue: "new-password",
        hashedValue: data["password"] as string,
        encryptionSecret: EncryptionSecret,
        salt: data["passwordSalt"] as string,
      }),
    ).resolves.toBe(true);
  });

  test("two password updates to the same value produce different salts", async () => {
    const first: JSONObject = await sanitize(
      { password: new HashedString("same-password") },
      { isRoot: true },
    );
    const second: JSONObject = await sanitize(
      { password: new HashedString("same-password") },
      { isRoot: true },
    );

    expect(first["passwordSalt"]).not.toBe(second["passwordSalt"]);
    expect(first["password"]).not.toBe(second["password"]);
  });

  test("an update that does not touch the password does not touch the salt", async () => {
    /*
     * If an unrelated update stamped a fresh salt, it would be written next
     * to the OLD hash and lock the account out.
     */
    const data: JSONObject = await sanitize(
      { name: "Renamed User" },
      { isRoot: true },
    );

    expect(data["passwordSalt"]).toBeUndefined();
    expect(Object.keys(data)).not.toContain("passwordSalt");
  });

  test("refuses a pre-hashed bare string, which would desync hash and salt", async () => {
    await expect(
      sanitize({ password: "a-raw-digest-string" }, { isRoot: true }),
    ).rejects.toThrow("must be supplied as a HashedString");
  });

  test("status page private users are salted the same way", async () => {
    const data: JSONObject = (await (
      StatusPagePrivateUserService as unknown as {
        sanitizeCreateOrUpdate: SanitizeFunction;
      }
    ).sanitizeCreateOrUpdate(
      { password: new HashedString("sp-password") },
      { isRoot: true },
      true,
    )) as JSONObject;

    expect(data["passwordSalt"]).toMatch(/^[0-9a-f]{64}$/);

    await expect(
      HashedString.verifyValue({
        plainValue: "sp-password",
        hashedValue: data["password"] as string,
        encryptionSecret: EncryptionSecret,
        salt: data["passwordSalt"] as string,
      }),
    ).resolves.toBe(true);
  });
});

describe("Hashed columns that declare no salt column are untouched", () => {
  test("a dashboard master password still uses the legacy unsalted digest", async () => {
    /*
     * Dashboard.masterPassword is `hashed: true` with no hashSaltColumn — a
     * shared secret, not a per-user credential. Every master password
     * already stored has to keep verifying, so this digest must not move.
     */
    const dashboard: Dashboard = new Dashboard();
    dashboard.masterPassword = new HashedString("master-password");

    await (
      DashboardService as unknown as { hash: HashFunction<Dashboard> }
    ).hash(dashboard);

    expect(dashboard.masterPassword!.toString()).toBe(
      CryptoJS.SHA256(
        EncryptionSecret.toString() + "master-password",
      ).toString(),
    );
  });

  test("no stray salt column is invented for it", async () => {
    const dashboard: Dashboard = new Dashboard();
    dashboard.masterPassword = new HashedString("master-password");

    await (
      DashboardService as unknown as { hash: HashFunction<Dashboard> }
    ).hash(dashboard);

    expect(
      new Dashboard().getTableColumnMetadata("masterPassword").hashSaltColumn,
    ).toBeUndefined();
    expect(
      (dashboard as unknown as JSONObject)["passwordSalt"],
    ).toBeUndefined();
  });

  test("a bare string is still allowed on an unsalted hashed column", async () => {
    // The desync guard is scoped to salted columns only.
    const data: JSONObject = (await (
      DashboardService as unknown as {
        sanitizeCreateOrUpdate: SanitizeFunction;
      }
    ).sanitizeCreateOrUpdate(
      { masterPassword: "a-raw-digest" },
      { isRoot: true },
      true,
    )) as JSONObject;

    expect(data["masterPassword"]).toBe("a-raw-digest");
  });
});

/*
 * Records every write the upgrade path would make, without making one.
 * `captured` is reset by each call.
 */
type UpdateColumnsInput = {
  id: ObjectID;
  data: JSONObject;
  skipUpdateDateColumn?: boolean;
};

let captured: Array<UpdateColumnsInput> = [];

type SpyOnUpgradeWriteFunction = (options?: { fail?: boolean }) => void;

const spyOnUpgradeWrite: SpyOnUpgradeWriteFunction = (options?: {
  fail?: boolean;
}): void => {
  captured = [];

  jest
    .spyOn(
      UserService as unknown as {
        updateColumnsByIdWithoutHooks: (
          input: UpdateColumnsInput,
        ) => Promise<void>;
      },
      "updateColumnsByIdWithoutHooks",
    )
    .mockImplementation(((input: UpdateColumnsInput): Promise<void> => {
      captured.push(input);

      if (options?.fail) {
        return Promise.reject(new Error("database is on fire"));
      }

      return Promise.resolve();
    }) as never);
};

describe("verifyHashedColumnValue", () => {
  type BuildUserFunction = (data: {
    password: string;
    salt: string | null;
  }) => Promise<User>;

  const buildUser: BuildUserFunction = async (data: {
    password: string;
    salt: string | null;
  }): Promise<User> => {
    const user: User = new User();
    user._id = ObjectID.generate().toString();
    user.password = new HashedString(
      await HashedString.hashValue(data.password, EncryptionSecret, data.salt),
      true,
    );

    if (data.salt) {
      user.passwordSalt = data.salt;
    }

    return user;
  };

  test("accepts the correct password for a salted user", async () => {
    const salt: string = HashedString.generateSalt();
    const user: User = await buildUser({ password: "correct", salt });
    spyOnUpgradeWrite();

    await expect(
      UserService.verifyHashedColumnValue({
        item: user,
        columnName: "password",
        plainValue: "correct",
      }),
    ).resolves.toBe(true);

    // Already salted — nothing to upgrade.
    expect(captured).toHaveLength(0);
  });

  test("rejects the wrong password for a salted user", async () => {
    const salt: string = HashedString.generateSalt();
    const user: User = await buildUser({ password: "correct", salt });
    spyOnUpgradeWrite();

    await expect(
      UserService.verifyHashedColumnValue({
        item: user,
        columnName: "password",
        plainValue: "wrong",
      }),
    ).resolves.toBe(false);

    expect(captured).toHaveLength(0);
  });

  test("rejects one user's password against another user's salt", async () => {
    const user: User = await buildUser({
      password: "correct",
      salt: HashedString.generateSalt(),
    });
    spyOnUpgradeWrite();

    // Same password, someone else's salt.
    user.passwordSalt = HashedString.generateSalt();

    await expect(
      UserService.verifyHashedColumnValue({
        item: user,
        columnName: "password",
        plainValue: "correct",
      }),
    ).resolves.toBe(false);
  });

  test("rejects a row with no stored password at all", async () => {
    const user: User = new User();
    user._id = ObjectID.generate().toString();

    await expect(
      UserService.verifyHashedColumnValue({
        item: user,
        columnName: "password",
        plainValue: "anything",
      }),
    ).resolves.toBe(false);
  });

  test("rejects an empty submitted password", async () => {
    const user: User = await buildUser({
      password: "correct",
      salt: HashedString.generateSalt(),
    });

    await expect(
      UserService.verifyHashedColumnValue({
        item: user,
        columnName: "password",
        plainValue: "",
      }),
    ).resolves.toBe(false);
  });
});

describe("verifyHashedColumnValue — transparent upgrade of legacy hashes", () => {
  type LegacyUserFunction = (password: string) => Promise<User>;

  const legacyUser: LegacyUserFunction = async (
    password: string,
  ): Promise<User> => {
    const user: User = new User();
    user._id = ObjectID.generate().toString();
    // Hashed the way it was before salts existed: no salt column value.
    user.password = new HashedString(
      await HashedString.hashValue(password, EncryptionSecret),
      true,
    );
    return user;
  };

  test("a password stored before salts existed still logs in", async () => {
    spyOnUpgradeWrite();
    const user: User = await legacyUser("old-password");

    await expect(
      UserService.verifyHashedColumnValue({
        item: user,
        columnName: "password",
        plainValue: "old-password",
      }),
    ).resolves.toBe(true);
  });

  test("and is re-hashed with a fresh salt, both columns written together", async () => {
    spyOnUpgradeWrite();
    const user: User = await legacyUser("old-password");

    await UserService.verifyHashedColumnValue({
      item: user,
      columnName: "password",
      plainValue: "old-password",
    });

    expect(captured).toHaveLength(1);

    const write: UpdateColumnsInput = captured[0]!;

    expect(write.id.toString()).toBe(user._id);
    expect(write.data["passwordSalt"]).toMatch(/^[0-9a-f]{64}$/);

    // The written hash verifies under the written salt.
    await expect(
      HashedString.verifyValue({
        plainValue: "old-password",
        hashedValue: write.data["password"] as string,
        encryptionSecret: EncryptionSecret,
        salt: write.data["passwordSalt"] as string,
      }),
    ).resolves.toBe(true);

    // ...and is no longer the legacy digest.
    expect(write.data["password"]).not.toBe(user.password!.toString());
  });

  test("the upgrade does not masquerade as a user-initiated change", async () => {
    /*
     * No hooks (so no session revocation, no "your password changed" mail)
     * and no updatedAt bump. The user did not change their password.
     */
    spyOnUpgradeWrite();
    const user: User = await legacyUser("old-password");

    await UserService.verifyHashedColumnValue({
      item: user,
      columnName: "password",
      plainValue: "old-password",
    });

    expect(captured[0]!.skipUpdateDateColumn).toBe(true);
  });

  test("a wrong password against a legacy hash upgrades nothing", async () => {
    spyOnUpgradeWrite();
    const user: User = await legacyUser("old-password");

    await expect(
      UserService.verifyHashedColumnValue({
        item: user,
        columnName: "password",
        plainValue: "guess",
      }),
    ).resolves.toBe(false);

    expect(captured).toHaveLength(0);
  });

  test("a failed upgrade write never costs the user their login", async () => {
    spyOnUpgradeWrite({ fail: true });

    const user: User = await legacyUser("old-password");

    await expect(
      UserService.verifyHashedColumnValue({
        item: user,
        columnName: "password",
        plainValue: "old-password",
      }),
    ).resolves.toBe(true);
  });

  test("a failed upgrade leaves the in-memory row as a consistent legacy pair", async () => {
    spyOnUpgradeWrite({ fail: true });

    const user: User = await legacyUser("old-password");
    const originalHash: string = user.password!.toString();

    await UserService.verifyHashedColumnValue({
      item: user,
      columnName: "password",
      plainValue: "old-password",
    });

    expect(user.passwordSalt).toBeUndefined();
    expect(user.password!.toString()).toBe(originalHash);

    // Re-verifying the same in-memory row still works.
    await expect(
      UserService.verifyHashedColumnValue({
        item: user,
        columnName: "password",
        plainValue: "old-password",
      }),
    ).resolves.toBe(true);
  });

  test("a row with no id is verified but not upgraded", async () => {
    spyOnUpgradeWrite();

    const user: User = new User();
    user.password = new HashedString(
      await HashedString.hashValue("old-password", EncryptionSecret),
      true,
    );

    await expect(
      UserService.verifyHashedColumnValue({
        item: user,
        columnName: "password",
        plainValue: "old-password",
      }),
    ).resolves.toBe(true);

    expect(captured).toHaveLength(0);
  });
});
