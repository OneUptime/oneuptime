import ApiKeyPermissionService, {
  getApiKeyTakeRefusedMessage,
} from "../../../Server/Services/ApiKeyPermissionService";
import ApiKeyService from "../../../Server/Services/ApiKeyService";
import logger from "../../../Server/Utils/Logger";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { getJestSpyOn } from "../../Spy";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A KEY'S NEW VALUE GOES ONLY TO WHO COULD GIVE IT ALL IT HOLDS
 * (ApiKeyService.onUpdatePermitted, found with #9765).
 *
 * Resetting a key answers its new value to whoever resets it, and with it
 * everything the key may do. Anyone with Edit API Key (or a Project Admin)
 * used to reset any key of the project - the Project Owner key Terraform
 * runs with among them - and so held Project Owner through it. Once a key
 * may give a workflow its Run As, that would also let them change a
 * workflow only Project Owners may change. So a reset is held to the grant
 * ceiling each of the key's permissions met when it was given: a Project
 * Owner resets any key, anyone else only a key whose every allowed
 * permission they could give it themselves, at its labels. The real update
 * pipeline runs - its permission checks and hooks - over tables in memory.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "9b650000-0000-4000-8000-000000000001",
);
const OWNER_KEY_ID: string = "9b650000-0000-4000-8000-0000000000b1";
const INCIDENT_KEY_ID: string = "9b650000-0000-4000-8000-0000000000b2";
const BLOCKS_ONLY_KEY_ID: string = "9b650000-0000-4000-8000-0000000000b3";
const LABEL_A: string = "9b650000-0000-4000-8000-0000000000d1";
const LABEL_B: string = "9b650000-0000-4000-8000-0000000000d2";

function rows(
  permissions: Array<Permission>,
  labelIds: Array<string> = [],
): Array<UserPermission> {
  return permissions.map((permission: Permission): UserPermission => {
    return {
      _type: "UserPermission",
      permission: permission,
      labelIds: labelIds.map((id: string): ObjectID => {
        return new ObjectID(id);
      }),
      isBlockPermission: false,
    };
  });
}

// A person of the project holding `held`.
function member(held: Array<UserPermission>): DatabaseCommonInteractionProps {
  return {
    ...ON_HIGHEST_PLAN,
    tenantId: PROJECT_ID,
    userId: ObjectID.generate(),
    userType: UserType.User,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: held,
      },
    },
  };
}

// A request one of the project's API keys made, holding `held`.
function key(
  apiKeyId: string,
  held: Array<UserPermission>,
): DatabaseCommonInteractionProps {
  return {
    ...ON_HIGHEST_PLAN,
    tenantId: PROJECT_ID,
    userType: UserType.API,
    apiKeyId: new ObjectID(apiKeyId),
    apiKeyName: "Terraform",
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: held,
      },
    },
  };
}

async function refusal(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }

  throw new Error("It was not refused.");
}

describe("resetting an API key", () => {
  let keys: InMemoryTable;

  beforeEach(() => {
    for (const silenced of ["debug", "info", "warn", "error"]) {
      getJestSpyOn(logger, silenced).mockImplementation((): void => {
        return undefined;
      });
    }

    stubProjectDirectory({});

    const base: StoredRow = {
      projectId: PROJECT_ID.toString(),
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      apiKeyHint: "abcd",
      version: 1,
    };

    keys = useInMemoryTable(ApiKeyService, [
      { ...base, _id: OWNER_KEY_ID, name: "Terraform", slug: "terraform" },
      { ...base, _id: INCIDENT_KEY_ID, name: "Pager bridge", slug: "pager" },
      { ...base, _id: BLOCKS_ONLY_KEY_ID, name: "Read only", slug: "read" },
    ]);

    useInMemoryTable(ApiKeyPermissionService, [
      {
        _id: "9b650000-0000-4000-8000-0000000000c1",
        apiKeyId: OWNER_KEY_ID,
        projectId: PROJECT_ID.toString(),
        permission: Permission.ProjectOwner,
        isBlockPermission: false,
        labels: [],
      },
      {
        _id: "9b650000-0000-4000-8000-0000000000c2",
        apiKeyId: INCIDENT_KEY_ID,
        projectId: PROJECT_ID.toString(),
        permission: Permission.IncidentAdmin,
        isBlockPermission: false,
        labels: [{ _id: LABEL_A }],
      },
      {
        _id: "9b650000-0000-4000-8000-0000000000c3",
        apiKeyId: INCIDENT_KEY_ID,
        projectId: PROJECT_ID.toString(),
        permission: Permission.IncidentAdmin,
        isBlockPermission: true,
        labels: [{ _id: LABEL_B }],
      },
      {
        _id: "9b650000-0000-4000-8000-0000000000c4",
        apiKeyId: BLOCKS_ONLY_KEY_ID,
        projectId: PROJECT_ID.toString(),
        permission: Permission.ProjectOwner,
        isBlockPermission: true,
        labels: [],
      },
    ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function wasReset(apiKeyId: string): boolean {
    return keys.updates.some(
      (update: { id: string; set: StoredRow }): boolean => {
        return (
          update.id.toLowerCase() === apiKeyId &&
          update.set["apiKey"] !== undefined
        );
      },
    );
  }

  test("a Project Admin may not reset the Project Owner key: it would hand them Project Owner, and the refusal says so", async () => {
    const error: Error = await refusal(
      ApiKeyService.resetApiKey({
        id: new ObjectID(OWNER_KEY_ID),
        props: member(rows([Permission.ProjectAdmin])),
      }),
    );

    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect(error.message).toBe(
      getApiKeyTakeRefusedMessage({
        apiKeyName: "Terraform",
        permission: Permission.ProjectOwner,
      }),
    );
    expect(error.message).toBe(
      "You can't reset the API key \"Terraform\": it has Project Owner, and your own access doesn't include that permission at the same or a broader scope. Resetting a key hands you everything it can do, so ask someone who has all of its permissions, such as a Project Owner, to reset it.",
    );
    expect(wasReset(OWNER_KEY_ID)).toBe(false);
  });

  test("Edit API Key alone resets no key that holds more than its holder", async () => {
    const error: Error = await refusal(
      ApiKeyService.resetApiKey({
        id: new ObjectID(INCIDENT_KEY_ID),
        props: member(
          rows([Permission.EditProjectApiKey, Permission.ReadProjectApiKey]),
        ),
      }),
    );

    expect(error.message).toContain("it has Incident Admin");
    expect(wasReset(INCIDENT_KEY_ID)).toBe(false);
  });

  test("nor does someone who holds the permission on fewer labels than the key", async () => {
    const error: Error = await refusal(
      ApiKeyService.resetApiKey({
        id: new ObjectID(INCIDENT_KEY_ID),
        props: member([
          ...rows([Permission.EditProjectApiKey, Permission.ReadProjectApiKey]),
          ...rows([Permission.IncidentAdmin], [LABEL_B]),
        ]),
      }),
    );

    expect(error.message).toContain("it has Incident Admin");
    expect(wasReset(INCIDENT_KEY_ID)).toBe(false);
  });

  test("a Project Owner resets any key, and gets its new value", async () => {
    const made: { apiKey: string } = await ApiKeyService.resetApiKey({
      id: new ObjectID(OWNER_KEY_ID),
      props: member(rows([Permission.ProjectOwner])),
    });

    expect(made.apiKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(wasReset(OWNER_KEY_ID)).toBe(true);
  });

  test("someone with Edit API Key who holds every permission the key allows, at its labels, resets it: its blocks ask nothing", async () => {
    await ApiKeyService.resetApiKey({
      id: new ObjectID(INCIDENT_KEY_ID),
      props: member([
        ...rows([Permission.EditProjectApiKey, Permission.ReadProjectApiKey]),
        ...rows([Permission.IncidentAdmin], [LABEL_A]),
      ]),
    });

    expect(wasReset(INCIDENT_KEY_ID)).toBe(true);
  });

  test("a key that only blocks is reset by anyone who may change keys", async () => {
    await ApiKeyService.resetApiKey({
      id: new ObjectID(BLOCKS_ONLY_KEY_ID),
      props: member(
        rows([Permission.EditProjectApiKey, Permission.ReadProjectApiKey]),
      ),
    });

    expect(wasReset(BLOCKS_ONLY_KEY_ID)).toBe(true);
  });

  test("a key that may change keys rotates itself: it holds all of its own permissions", async () => {
    await ApiKeyService.resetApiKey({
      id: new ObjectID(INCIDENT_KEY_ID),
      props: key(INCIDENT_KEY_ID, [
        ...rows([Permission.EditProjectApiKey, Permission.ReadProjectApiKey]),
        ...rows([Permission.IncidentAdmin], [LABEL_A]),
      ]),
    });

    expect(wasReset(INCIDENT_KEY_ID)).toBe(true);
  });

  test("but a key resets no other key that holds more than it does", async () => {
    const error: Error = await refusal(
      ApiKeyService.resetApiKey({
        id: new ObjectID(OWNER_KEY_ID),
        props: key(INCIDENT_KEY_ID, [
          ...rows([Permission.EditProjectApiKey, Permission.ReadProjectApiKey]),
          ...rows([Permission.IncidentAdmin], [LABEL_A]),
        ]),
      }),
    );

    expect(error.message).toContain("it has Project Owner");
    expect(wasReset(OWNER_KEY_ID)).toBe(false);
  });

  test("a change of anything else - a name, an expiry - asks nothing of what the key holds", async () => {
    await ApiKeyService.updateOneById({
      id: new ObjectID(OWNER_KEY_ID),
      data: {
        name: "Terraform (old)",
        expiresAt: new Date("2098-01-01T00:00:00.000Z"),
      },
      props: member(
        rows([Permission.EditProjectApiKey, Permission.ReadProjectApiKey]),
      ),
    });

    expect(keys.get(OWNER_KEY_ID)?.["name"]).toBe("Terraform (old)");
    expect(wasReset(OWNER_KEY_ID)).toBe(false);
  });

  test("OneUptime's own reset, and a master admin's, are not held to it", async () => {
    await ApiKeyService.resetApiKey({
      id: new ObjectID(OWNER_KEY_ID),
      props: { isRoot: true },
    });

    expect(wasReset(OWNER_KEY_ID)).toBe(true);

    await ApiKeyPermissionService.assertCallerCanTakeKey({
      apiKeyId: new ObjectID(OWNER_KEY_ID),
      apiKeyName: "Terraform",
      projectId: PROJECT_ID,
      props: { ...member([]), isMasterAdmin: true },
    });
  });
});
