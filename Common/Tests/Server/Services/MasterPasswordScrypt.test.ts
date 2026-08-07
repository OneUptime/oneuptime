import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import { EncryptionSecret } from "../../../Server/EnvironmentConfig";
import DashboardService from "../../../Server/Services/DashboardService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import PasswordHash from "../../../Server/Utils/PasswordHash";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ColumnLength from "../../../Types/Database/ColumnLength";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import BadDataException from "../../../Types/Exception/BadDataException";
import HashedString from "../../../Types/HashedString";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import CryptoJS from "crypto-js";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Dashboard and status-page master passwords are human-chosen credentials,
 * just like account passwords. They therefore need the same deliberately
 * expensive password KDF, a unique salt per protected resource, and an
 * opportunistic upgrade path for the SHA-256 digests written by older
 * versions.
 *
 * These tests exercise the shared DatabaseService write and verification
 * pipeline directly. No Postgres is needed: upgrade writes are captured by a
 * stub so the hash/salt pair can be checked as one atomic payload.
 */

type ProtectedResource = Dashboard | StatusPage;

type HashFunction<T> = (data: T) => Promise<T>;

type SanitizeFunction = (
  data: unknown,
  props: DatabaseCommonInteractionProps,
  isUpdate?: boolean,
) => Promise<JSONObject>;

type UpdateColumnsInput = {
  id: ObjectID;
  data: JSONObject;
  expectedData?: JSONObject;
  skipUpdateDateColumn?: boolean;
};

type ResourceService = {
  hash: HashFunction<ProtectedResource>;
  sanitizeCreateOrUpdate: SanitizeFunction;
  verifyHashedColumnValue: (data: {
    item: ProtectedResource;
    columnName: string;
    plainValue: string;
  }) => Promise<boolean>;
  updateColumnsByIdWithoutHooks: (input: UpdateColumnsInput) => Promise<void>;
};

const dashboardService: ResourceService =
  DashboardService as unknown as ResourceService;
const statusPageService: ResourceService =
  StatusPageService as unknown as ResourceService;

type ResourceCase = {
  name: string;
  model: Dashboard | StatusPage;
  service: ResourceService;
};

type ResourceTestCase = {
  name: string;
  resource: ProtectedResource;
  service: ResourceService;
};

type ResourcePairTestCase = {
  name: string;
  first: ProtectedResource;
  second: ProtectedResource;
  service: ResourceService;
};

const resourceCases: Array<ResourceCase> = [
  {
    name: "Dashboard",
    model: new Dashboard(),
    service: dashboardService,
  },
  {
    name: "StatusPage",
    model: new StatusPage(),
    service: statusPageService,
  },
];

const setPlainMasterPassword: (
  resource: ProtectedResource,
  password: string,
) => void = (resource: ProtectedResource, password: string): void => {
  resource.masterPassword = new HashedString(password);
};

const setStoredMasterPassword: (
  resource: ProtectedResource,
  hash: string,
  salt?: string,
) => void = (
  resource: ProtectedResource,
  hash: string,
  salt?: string,
): void => {
  resource._id = ObjectID.generate().toString();
  resource.masterPassword = new HashedString(hash, true);
  resource.masterPasswordSalt = salt;
};

const makeCurrentResource: (data: {
  resource: ProtectedResource;
  password: string;
}) => Promise<ProtectedResource> = async (data: {
  resource: ProtectedResource;
  password: string;
}): Promise<ProtectedResource> => {
  const salt: string = PasswordHash.generateSalt();

  setStoredMasterPassword(
    data.resource,
    await PasswordHash.hash({
      plainValue: data.password,
      salt,
    }),
    salt,
  );

  return data.resource;
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Master-password model metadata", () => {
  test.each(resourceCases)(
    "$name.masterPassword declares masterPasswordSalt",
    ({ model }: ResourceCase) => {
      const metadata: TableColumnMetadata =
        model.getTableColumnMetadata("masterPassword");

      expect(metadata.hashed).toBe(true);
      expect(metadata.hashSaltColumn).toBe("masterPasswordSalt");
      expect(model.hasColumn("masterPasswordSalt")).toBe(true);
    },
  );

  test.each(resourceCases)(
    "$name.masterPasswordSalt is server-computed and API-inaccessible",
    ({ model }: ResourceCase) => {
      const metadata: TableColumnMetadata =
        model.getTableColumnMetadata("masterPasswordSalt");
      const accessControl: {
        create?: Array<unknown>;
        read?: Array<unknown>;
        update?: Array<unknown>;
      } = model.getColumnAccessControlFor("masterPasswordSalt") as {
        create?: Array<unknown>;
        read?: Array<unknown>;
        update?: Array<unknown>;
      };

      expect(metadata.computed).toBe(true);
      expect(metadata.type).toBe(TableColumnType.ShortText);
      expect(accessControl.create).toEqual([]);
      expect(accessControl.read).toEqual([]);
      expect(accessControl.update).toEqual([]);
    },
  );

  test("generated salts fit the declared database column", () => {
    expect(PasswordHash.generateSalt()).toMatch(/^[0-9a-f]{64}$/);
    expect(PasswordHash.generateSalt().length).toBeLessThanOrEqual(
      ColumnLength.ShortText,
    );
  });

  test.each(resourceCases)(
    "$name computed salt survives create permission validation",
    ({ model }: ResourceCase) => {
      model.masterPasswordSalt = PasswordHash.generateSalt();

      expect(() => {
        ColumnPermissions.checkDataColumnPermissions(
          model instanceof Dashboard ? Dashboard : StatusPage,
          model,
          {} as DatabaseCommonInteractionProps,
          DatabaseRequestType.Create,
        );
      }).not.toThrow();
    },
  );

  test.each(resourceCases)(
    "$name rejects a caller-supplied salt on update",
    ({ model }: ResourceCase) => {
      model.masterPasswordSalt = PasswordHash.generateSalt();

      expect(() => {
        ColumnPermissions.checkDataColumnPermissions(
          model instanceof Dashboard ? Dashboard : StatusPage,
          model,
          {} as DatabaseCommonInteractionProps,
          DatabaseRequestType.Update,
        );
      }).toThrow("not allowed to update on masterPasswordSalt");
    },
  );
});

describe("Master-password create path", () => {
  test.each([
    {
      name: "Dashboard",
      resource: new Dashboard() as ProtectedResource,
      service: dashboardService,
    },
    {
      name: "StatusPage",
      resource: new StatusPage() as ProtectedResource,
      service: statusPageService,
    },
  ])(
    "$name writes a salted scrypt hash instead of SHA-256",
    async ({ resource, service }: ResourceTestCase) => {
      setPlainMasterPassword(resource, "shared master password");

      await service.hash(resource);

      expect(resource.masterPasswordSalt).toMatch(/^[0-9a-f]{64}$/);
      expect(resource.masterPassword!.toString()).toMatch(
        /^scrypt\$N=\d+,r=\d+,p=\d+\$[0-9a-f]{64}$/,
      );
      expect(resource.masterPassword!.toString()).not.toBe(
        CryptoJS.SHA256(
          EncryptionSecret.toString() + "shared master password",
        ).toString(),
      );
      await expect(
        PasswordHash.verify({
          plainValue: "shared master password",
          storedValue: resource.masterPassword!.toString(),
          salt: resource.masterPasswordSalt,
        }),
      ).resolves.toBe(true);
    },
  );

  test.each([
    {
      name: "Dashboard",
      first: new Dashboard() as ProtectedResource,
      second: new Dashboard() as ProtectedResource,
      service: dashboardService,
    },
    {
      name: "StatusPage",
      first: new StatusPage() as ProtectedResource,
      second: new StatusPage() as ProtectedResource,
      service: statusPageService,
    },
  ])(
    "two $name resources with the same password get unique salts and hashes",
    async ({ first, second, service }: ResourcePairTestCase) => {
      setPlainMasterPassword(first, "same password");
      setPlainMasterPassword(second, "same password");

      await service.hash(first);
      await service.hash(second);

      expect(first.masterPasswordSalt).not.toBe(second.masterPasswordSalt);
      expect(first.masterPassword!.toString()).not.toBe(
        second.masterPassword!.toString(),
      );
    },
  );
});

describe("Master-password update path", () => {
  test.each(resourceCases)(
    "$name password updates write a new scrypt hash and salt together",
    async ({ service }: ResourceCase) => {
      const result: JSONObject = await service.sanitizeCreateOrUpdate(
        { masterPassword: new HashedString("replacement password") },
        { isRoot: true },
        true,
      );

      expect(result["masterPasswordSalt"]).toMatch(/^[0-9a-f]{64}$/);
      expect(result["masterPassword"]).toMatch(/^scrypt\$/);
      await expect(
        PasswordHash.verify({
          plainValue: "replacement password",
          storedValue: result["masterPassword"] as string,
          salt: result["masterPasswordSalt"] as string,
        }),
      ).resolves.toBe(true);
    },
  );

  test.each(resourceCases)(
    "$name unrelated updates do not rotate the master-password salt",
    async ({ service }: ResourceCase) => {
      const result: JSONObject = await service.sanitizeCreateOrUpdate(
        { name: "Renamed resource" },
        { isRoot: true },
        true,
      );

      expect(result["masterPasswordSalt"]).toBeUndefined();
      expect(Object.keys(result)).not.toContain("masterPasswordSalt");
    },
  );

  test.each(resourceCases)(
    "$name refuses a bare pre-hashed string that could desynchronise hash and salt",
    async ({ service }: ResourceCase) => {
      await expect(
        service.sanitizeCreateOrUpdate(
          { masterPassword: "pre-hashed-value" },
          { isRoot: true },
          true,
        ),
      ).rejects.toThrow("must be supplied as a HashedString");
    },
  );
});

describe("Master-password verification", () => {
  test.each([
    {
      name: "Dashboard",
      resource: new Dashboard() as ProtectedResource,
      service: dashboardService,
    },
    {
      name: "StatusPage",
      resource: new StatusPage() as ProtectedResource,
      service: statusPageService,
    },
  ])(
    "$name accepts the right scrypt password and rejects the wrong one without rewriting",
    async ({ resource, service }: ResourceTestCase) => {
      await makeCurrentResource({ resource, password: "correct password" });
      const update: jest.SpiedFunction<
        ResourceService["updateColumnsByIdWithoutHooks"]
      > = jest
        .spyOn(service, "updateColumnsByIdWithoutHooks")
        .mockResolvedValue(undefined);

      await expect(
        service.verifyHashedColumnValue({
          item: resource,
          columnName: "masterPassword",
          plainValue: "correct password",
        }),
      ).resolves.toBe(true);
      await expect(
        service.verifyHashedColumnValue({
          item: resource,
          columnName: "masterPassword",
          plainValue: "wrong password",
        }),
      ).resolves.toBe(false);

      expect(update).not.toHaveBeenCalled();
    },
  );

  test.each([
    {
      name: "Dashboard",
      resource: new Dashboard() as ProtectedResource,
      service: dashboardService,
    },
    {
      name: "StatusPage",
      resource: new StatusPage() as ProtectedResource,
      service: statusPageService,
    },
  ])(
    "$name transparently upgrades a valid legacy SHA-256 password",
    async ({ resource, service }: ResourceTestCase) => {
      const legacyHash: string = await HashedString.hashValue(
        "legacy password",
        EncryptionSecret,
      );
      setStoredMasterPassword(resource, legacyHash);

      const update: jest.SpiedFunction<
        ResourceService["updateColumnsByIdWithoutHooks"]
      > = jest
        .spyOn(service, "updateColumnsByIdWithoutHooks")
        .mockResolvedValue(undefined);

      await expect(
        service.verifyHashedColumnValue({
          item: resource,
          columnName: "masterPassword",
          plainValue: "legacy password",
        }),
      ).resolves.toBe(true);

      expect(update).toHaveBeenCalledTimes(1);
      const write: UpdateColumnsInput = update.mock.calls[0]![0];

      expect(write.id.toString()).toBe(resource._id);
      expect(write.skipUpdateDateColumn).toBe(true);
      expect(write.expectedData).toEqual({
        masterPassword: legacyHash,
        masterPasswordSalt: null,
      });
      expect(write.data["masterPasswordSalt"]).toMatch(/^[0-9a-f]{64}$/);
      expect(write.data["masterPassword"]).toMatch(/^scrypt\$/);
      await expect(
        PasswordHash.verify({
          plainValue: "legacy password",
          storedValue: write.data["masterPassword"] as string,
          salt: write.data["masterPasswordSalt"] as string,
        }),
      ).resolves.toBe(true);
    },
  );

  test.each([
    {
      name: "Dashboard",
      resource: new Dashboard() as ProtectedResource,
      service: dashboardService,
    },
    {
      name: "StatusPage",
      resource: new StatusPage() as ProtectedResource,
      service: statusPageService,
    },
  ])(
    "$name repairs a bare legacy hash left beside a stale salt by an old pod",
    async ({ resource, service }: ResourceTestCase) => {
      const legacyHash: string = await HashedString.hashValue(
        "rolling password",
        EncryptionSecret,
      );
      const staleSalt: string = PasswordHash.generateSalt();
      setStoredMasterPassword(resource, legacyHash, staleSalt);

      const update: jest.SpiedFunction<
        ResourceService["updateColumnsByIdWithoutHooks"]
      > = jest
        .spyOn(service, "updateColumnsByIdWithoutHooks")
        .mockResolvedValue(undefined);

      await expect(
        service.verifyHashedColumnValue({
          item: resource,
          columnName: "masterPassword",
          plainValue: "rolling password",
        }),
      ).resolves.toBe(true);

      expect(update).toHaveBeenCalledTimes(1);
      const write: UpdateColumnsInput = update.mock.calls[0]![0];

      expect(write.expectedData).toEqual({
        masterPassword: legacyHash,
        masterPasswordSalt: staleSalt,
      });
      expect(write.data["masterPassword"]).toMatch(/^scrypt\$/);
      expect(write.data["masterPasswordSalt"]).not.toBe(staleSalt);
    },
  );

  test.each([
    {
      name: "Dashboard",
      resource: new Dashboard() as ProtectedResource,
      service: dashboardService,
    },
    {
      name: "StatusPage",
      resource: new StatusPage() as ProtectedResource,
      service: statusPageService,
    },
  ])(
    "$name never upgrades a legacy hash after a wrong password",
    async ({ resource, service }: ResourceTestCase) => {
      setStoredMasterPassword(
        resource,
        await HashedString.hashValue("legacy password", EncryptionSecret),
      );

      const update: jest.SpiedFunction<
        ResourceService["updateColumnsByIdWithoutHooks"]
      > = jest
        .spyOn(service, "updateColumnsByIdWithoutHooks")
        .mockResolvedValue(undefined);

      await expect(
        service.verifyHashedColumnValue({
          item: resource,
          columnName: "masterPassword",
          plainValue: "wrong password",
        }),
      ).resolves.toBe(false);
      expect(update).not.toHaveBeenCalled();
    },
  );

  test.each([
    {
      name: "Dashboard",
      resource: new Dashboard() as ProtectedResource,
      service: dashboardService,
    },
    {
      name: "StatusPage",
      resource: new StatusPage() as ProtectedResource,
      service: statusPageService,
    },
  ])(
    "$name fails closed when a scrypt hash is read without its salt",
    async ({ resource, service }: ResourceTestCase) => {
      const salt: string = PasswordHash.generateSalt();
      setStoredMasterPassword(
        resource,
        await PasswordHash.hash({
          plainValue: "correct password",
          salt,
        }),
      );

      await expect(
        service.verifyHashedColumnValue({
          item: resource,
          columnName: "masterPassword",
          plainValue: "correct password",
        }),
      ).rejects.toBeInstanceOf(BadDataException);
    },
  );
});
