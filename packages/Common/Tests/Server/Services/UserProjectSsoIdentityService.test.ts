import UserProjectSsoIdentity from "../../../Models/DatabaseModels/UserProjectSsoIdentity";
import UserProjectSsoIdentityService from "../../../Server/Services/UserProjectSsoIdentityService";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";

/*
 * The object ID an account's sign-ins through a project's SAML provider are
 * bound to (UserProjectSsoIdentity). Read on every such sign-in that carries
 * one; written at the first that signs the account in.
 *
 * What has to hold:
 *
 *  - a binding is per (provider, account): the read is scoped to both, so
 *    another provider's binding - or another account's - decides nothing;
 *  - binding is first come: an account bound already stays bound to that
 *    object ID, and the caller is told which it is;
 *  - two first sign-ins at once end with one binding: the one that lost the
 *    insert to the unique index is told the object ID that won, and a real
 *    failure is not swallowed.
 */

const USER_ID: ObjectID = new ObjectID("6b000000-0000-4000-8000-000000000001");
const PROJECT_ID: ObjectID = new ObjectID(
  "6b000000-0000-4000-8000-000000000002",
);
const PROVIDER_ID: ObjectID = new ObjectID(
  "6b000000-0000-4000-8000-000000000003",
);
const OBJECT_ID: string = "8f3e8c2a-41d5-4c0b-9e8a-4a7d1c0f6b21";
const OTHER_OBJECT_ID: string = "1b2c3d4e-0000-4000-8000-0000000000aa";

// See UserProjectSsoConsentService.test.ts for why spies are held as this.
interface SpyCalls {
  mock: { calls: Array<Array<unknown>> };
}

function bound(objectId: string | null): UserProjectSsoIdentity | null {
  if (!objectId) {
    return null;
  }

  const row: UserProjectSsoIdentity = new UserProjectSsoIdentity();
  row.objectId = objectId;
  return row;
}

const BINDING: {
  projectId: ObjectID;
  projectSsoId: ObjectID;
  userId: ObjectID;
  objectId: string;
} = {
  projectId: PROJECT_ID,
  projectSsoId: PROVIDER_ID,
  userId: USER_ID,
  objectId: OBJECT_ID,
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("UserProjectSsoIdentityService.getBoundObjectId", () => {
  test("asks about this account through this provider, as root", async () => {
    const findOneBy: SpyCalls = jest
      .spyOn(UserProjectSsoIdentityService, "findOneBy")
      .mockResolvedValue(bound(OBJECT_ID)) as unknown as SpyCalls;

    await expect(
      UserProjectSsoIdentityService.getBoundObjectId({
        projectSsoId: PROVIDER_ID,
        userId: USER_ID,
      }),
    ).resolves.toBe(OBJECT_ID);

    const call: Record<string, any> = findOneBy.mock.calls[0]![0] as Record<
      string,
      any
    >;

    expect(call["query"]["projectSsoId"].toString()).toBe(
      PROVIDER_ID.toString(),
    );
    expect(call["query"]["userId"].toString()).toBe(USER_ID.toString());
    expect(call["select"]).toEqual({ objectId: true });
    expect(call["props"]["isRoot"]).toBe(true);
  });

  test("is null for an account bound to no one", async () => {
    jest
      .spyOn(UserProjectSsoIdentityService, "findOneBy")
      .mockResolvedValue(null);

    await expect(
      UserProjectSsoIdentityService.getBoundObjectId({
        projectSsoId: PROVIDER_ID,
        userId: USER_ID,
      }),
    ).resolves.toBe(null);
  });
});

describe("UserProjectSsoIdentityService.bind", () => {
  test("binds an account bound to no one, as root, and answers the object ID", async () => {
    jest
      .spyOn(UserProjectSsoIdentityService, "findOneBy")
      .mockResolvedValue(null);
    const create: SpyCalls = jest
      .spyOn(UserProjectSsoIdentityService, "create")
      .mockResolvedValue(new UserProjectSsoIdentity()) as unknown as SpyCalls;

    await expect(UserProjectSsoIdentityService.bind(BINDING)).resolves.toBe(
      OBJECT_ID,
    );

    const call: Record<string, any> = create.mock.calls[0]![0] as Record<
      string,
      any
    >;

    expect(call["data"]).toBeInstanceOf(UserProjectSsoIdentity);
    expect(call["data"]["projectId"].toString()).toBe(PROJECT_ID.toString());
    expect(call["data"]["projectSsoId"].toString()).toBe(
      PROVIDER_ID.toString(),
    );
    expect(call["data"]["userId"].toString()).toBe(USER_ID.toString());
    expect(call["data"]["objectId"]).toBe(OBJECT_ID);
    expect(call["props"]["isRoot"]).toBe(true);
  });

  test.each([
    ["the same person", OBJECT_ID],
    ["another person", OTHER_OBJECT_ID],
  ])(
    "writes nothing for an account bound already, to %s, and answers whom",
    async (_name: string, boundObjectId: string) => {
      jest
        .spyOn(UserProjectSsoIdentityService, "findOneBy")
        .mockResolvedValue(bound(boundObjectId));
      const create: SpyCalls = jest.spyOn(
        UserProjectSsoIdentityService,
        "create",
      ) as unknown as SpyCalls;

      await expect(UserProjectSsoIdentityService.bind(BINDING)).resolves.toBe(
        boundObjectId,
      );
      expect(create.mock.calls).toHaveLength(0);
    },
  );

  test("losing the insert to a concurrent first sign-in answers the object ID that won", async () => {
    // Unbound when read, bound by the time the insert was turned away.
    jest
      .spyOn(UserProjectSsoIdentityService, "findOneBy")
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(bound(OTHER_OBJECT_ID));
    jest
      .spyOn(UserProjectSsoIdentityService, "create")
      .mockRejectedValue(
        new Error("duplicate key value violates unique constraint"),
      );

    await expect(UserProjectSsoIdentityService.bind(BINDING)).resolves.toBe(
      OTHER_OBJECT_ID,
    );
  });

  test("does not swallow a write that failed for any other reason", async () => {
    jest
      .spyOn(UserProjectSsoIdentityService, "findOneBy")
      .mockResolvedValue(null);
    jest
      .spyOn(UserProjectSsoIdentityService, "create")
      .mockRejectedValue(new Error("connection terminated"));

    await expect(UserProjectSsoIdentityService.bind(BINDING)).rejects.toThrow(
      "connection terminated",
    );
  });
});

describe("UserProjectSsoIdentity model", () => {
  test("has no API: nobody but the server reads or writes it", () => {
    const model: UserProjectSsoIdentity = new UserProjectSsoIdentity();

    expect(model.createRecordPermissions).toEqual([]);
    expect(model.readRecordPermissions).toEqual([]);
    expect(model.updateRecordPermissions).toEqual([]);
    expect(model.deleteRecordPermissions).toEqual([]);
    expect(model.crudApiPath).toBeFalsy();
  });

  test("is one live row per provider and account, enforced by the database", () => {
    const index: IndexMetadataArgs | undefined = getMetadataArgsStorage()
      .indices.filter((candidate: IndexMetadataArgs) => {
        return candidate.target === UserProjectSsoIdentity;
      })
      .find((candidate: IndexMetadataArgs) => {
        return (
          candidate.name === "IDX_UserProjectSsoIdentity_projectSsoId_userId"
        );
      });

    expect(index).toBeDefined();
    expect(index!.unique).toBe(true);
    expect(index!.columns).toEqual(["projectSsoId", "userId"]);
    expect(index!.where).toBe('"deletedAt" IS NULL');
  });

  test("goes with the provider, the project and the account (the foreign keys cascade)", () => {
    const relations: Array<{
      propertyName: string;
      onDelete?: string | undefined;
    }> = getMetadataArgsStorage()
      .relations.filter((relation: { target: unknown }) => {
        return relation.target === UserProjectSsoIdentity;
      })
      .map(
        (relation: {
          propertyName: string;
          options: { onDelete?: string };
        }) => {
          return {
            propertyName: relation.propertyName,
            onDelete: relation.options.onDelete,
          };
        },
      );

    expect(
      relations.sort(
        (a: { propertyName: string }, b: { propertyName: string }): number => {
          return a.propertyName.localeCompare(b.propertyName);
        },
      ),
    ).toEqual([
      { propertyName: "project", onDelete: "CASCADE" },
      { propertyName: "projectSso", onDelete: "CASCADE" },
      { propertyName: "user", onDelete: "CASCADE" },
    ]);
  });
});
