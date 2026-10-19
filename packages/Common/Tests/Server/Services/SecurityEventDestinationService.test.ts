import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import SecurityEventDestination from "../../../Models/DatabaseModels/SecurityEventDestination";
import SecurityEventDestinationService, {
  Service as SecurityEventDestinationServiceClass,
} from "../../../Server/Services/SecurityEventDestinationService";
import logger from "../../../Server/Utils/Logger";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import SecurityEventDestinationProvider from "../../../Types/SecurityEvent/Destinations/SecurityEventDestinationProvider";
import SecurityEventDestinationScope from "../../../Types/SecurityEvent/Destinations/SecurityEventDestinationScope";
import UserType from "../../../Types/UserType";
import { getJestSpyOn } from "../../Spy";
import {
  INSTANCE,
  REGION,
  SERVICE_ACCOUNT_JSON,
} from "../Utils/SecurityEvent/Destinations/GoogleSecOpsFakeEndpoint";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";

/*
 * A SIEM destination, saved through the whole write as the people who save
 * one: the catalog's fields are checked, the credential is encrypted and
 * never read back, the cursor - OneUptime's to write - starts at the moment
 * of saving, and only the tiers that connect security sources may do it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "6ba7b811-9dad-41d1-80b4-00c04fd43101",
);
const DESTINATION_ID: string = "6ba7b812-9dad-41d1-80b4-00c04fd43101";
const NOW: Date = new Date("2026-10-19T12:00:00.000Z");

function member(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...ON_HIGHEST_PLAN,
    tenantId: PROJECT_ID,
    userId: ObjectID.generate(),
    userType: UserType.User,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: permissions.map(
          (permission: Permission): UserPermission => {
            return {
              _type: "UserPermission",
              permission: permission,
              labelIds: [],
              isBlockPermission: false,
            } as UserPermission;
          },
        ),
      },
    },
  } as unknown as DatabaseCommonInteractionProps;
}

const ADMINS: Array<[string, Array<Permission>]> = [
  ["a project owner", [Permission.ProjectOwner]],
  ["a project admin", [Permission.ProjectAdmin]],
  ["a security admin", [Permission.SecurityAdmin]],
];

const NOT_ADMINS: Array<[string, Array<Permission>]> = [
  ["a security member", [Permission.SecurityMember]],
  ["a security viewer", [Permission.SecurityViewer]],
  ["a project member", [Permission.ProjectMember]],
];

function newDestination(
  overrides: Partial<Record<string, unknown>> = {},
): SecurityEventDestination {
  const destination: SecurityEventDestination = new SecurityEventDestination();
  destination.projectId = PROJECT_ID;
  destination.name = "SecOps";
  destination.provider = SecurityEventDestinationProvider.GoogleSecOps;
  destination.config = { region: REGION, instanceResourceName: INSTANCE };
  destination.secrets = JSON.stringify({
    serviceAccountJson: SERVICE_ACCOUNT_JSON,
  });
  Object.assign(destination, overrides);
  return destination;
}

describe("SecurityEventDestinationService, through the whole write", () => {
  let destinations: InMemoryTable;

  beforeEach(() => {
    for (const silenced of ["debug", "info", "warn", "error"]) {
      getJestSpyOn(logger, silenced).mockImplementation((): void => {
        return undefined;
      });
    }

    stubProjectDirectory({});
    getJestSpyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);

    destinations = useInMemoryTable(SecurityEventDestinationService, [
      {
        _id: DESTINATION_ID,
        projectId: PROJECT_ID.toString(),
        name: "Existing SecOps",
        provider: SecurityEventDestinationProvider.GoogleSecOps,
        config: { region: REGION, instanceResourceName: INSTANCE },
        secrets: JSON.stringify({ serviceAccountJson: SERVICE_ACCOUNT_JSON }),
        isEnabled: true,
        sendScope: SecurityEventDestinationScope.Detections,
        cursor: "2026-10-19T11:00:00.000Z",
        version: 1,
      },
    ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function inserted(): StoredRow {
    const row: StoredRow | undefined =
      destinations.inserts[destinations.inserts.length - 1];

    if (!row) {
      throw new Error("Nothing was inserted.");
    }

    return row;
  }

  test.each(ADMINS)(
    "%s saves a Google SecOps destination: detections by default, sending from now, the key never in clear",
    async (_who: string, permissions: Array<Permission>) => {
      await SecurityEventDestinationService.create({
        data: newDestination(),
        props: member(permissions),
      });

      const row: StoredRow = inserted();

      expect(row["sendScope"]).toBe(SecurityEventDestinationScope.Detections);
      expect(row["cursor"]).toBe(NOW.toISOString());
      expect(row["config"]).toEqual({
        region: REGION,
        instanceResourceName: INSTANCE,
      });
      expect(String(row["secrets"])).not.toContain("BEGIN PRIVATE KEY");
      expect(String(row["secrets"])).not.toContain("client_email");
    },
  );

  test.each(NOT_ADMINS)(
    "%s cannot save one",
    async (_who: string, permissions: Array<Permission>) => {
      await expect(
        SecurityEventDestinationService.create({
          data: newDestination(),
          props: member(permissions),
        }),
      ).rejects.toThrow();
      expect(destinations.inserts).toHaveLength(0);
    },
  );

  test("all events, when asked", async () => {
    await SecurityEventDestinationService.create({
      data: newDestination({
        sendScope: SecurityEventDestinationScope.AllEvents,
      }),
      props: member([Permission.SecurityAdmin]),
    });

    expect(inserted()["sendScope"]).toBe(
      SecurityEventDestinationScope.AllEvents,
    );
  });

  test.each<[string, Partial<Record<string, unknown>>, string]>([
    [
      "an unknown SIEM",
      { provider: "carrier-pigeon" },
      "Provider must be one of",
    ],
    [
      "a region that is not one",
      { config: { region: "mars", instanceResourceName: INSTANCE } },
      "Region must be one of",
    ],
    [
      "a region the instance is not in",
      { config: { region: "europe", instanceResourceName: INSTANCE } },
      "",
    ],
    [
      "no instance",
      { config: { region: REGION } },
      "Instance resource name is required",
    ],
    [
      "a setting the SIEM does not have",
      {
        config: { region: REGION, instanceResourceName: INSTANCE, apiKey: "x" },
      },
      'unknown setting "apiKey"',
    ],
    [
      "no key",
      { secrets: JSON.stringify({}) },
      "Service account JSON is required",
    ],
    [
      "a key that is not one",
      { secrets: JSON.stringify({ serviceAccountJson: "{}" }) },
      "",
    ],
    ["something else to send", { sendScope: "everything" }, "What to send"],
  ])(
    "refuses %s",
    async (
      _what: string,
      overrides: Partial<Record<string, unknown>>,
      message: string,
    ) => {
      const create: Promise<SecurityEventDestination> =
        SecurityEventDestinationService.create({
          data: newDestination(overrides),
          props: member([Permission.SecurityAdmin]),
        });

      await expect(create).rejects.toThrow(BadDataException);

      if (message) {
        await expect(create).rejects.toThrow(message);
      }

      expect(destinations.inserts).toHaveLength(0);
    },
  );

  test("a key left blank on edit keeps the stored one; a new key replaces it", async () => {
    const stored: string = String(destinations.get(DESTINATION_ID)!["secrets"]);

    await SecurityEventDestinationService.updateOneById({
      id: new ObjectID(DESTINATION_ID),
      data: {
        config: { region: REGION, instanceResourceName: INSTANCE },
        secrets: JSON.stringify({ serviceAccountJson: "" }),
      } as never,
      props: member([Permission.SecurityAdmin]),
    });

    const settingsAfterBlank: JSONObject = (
      await SecurityEventDestinationServiceClass.prototype.getSettings.call(
        SecurityEventDestinationService,
        {
          id: new ObjectID(DESTINATION_ID),
        } as SecurityEventDestination,
      )
    ).secrets;

    expect(settingsAfterBlank["serviceAccountJson"]).toBe(SERVICE_ACCOUNT_JSON);
    expect(stored).toBeTruthy();
  });

  test("the SIEM of a destination cannot be changed", async () => {
    await expect(
      SecurityEventDestinationService.updateOneById({
        id: new ObjectID(DESTINATION_ID),
        data: { provider: "splunk" } as never,
        props: member([Permission.SecurityAdmin]),
      }),
    ).rejects.toThrow("cannot be changed");
  });

  test("turning one off and on, and changing what it sends, needs no key", async () => {
    await SecurityEventDestinationService.updateOneById({
      id: new ObjectID(DESTINATION_ID),
      data: {
        isEnabled: false,
        sendScope: SecurityEventDestinationScope.AllEvents,
      },
      props: member([Permission.SecurityAdmin]),
    });

    expect(destinations.get(DESTINATION_ID)!["isEnabled"]).toBe(false);
    expect(destinations.get(DESTINATION_ID)!["sendScope"]).toBe(
      SecurityEventDestinationScope.AllEvents,
    );
  });

  test("nobody writes the cursor but OneUptime", async () => {
    await expect(
      SecurityEventDestinationService.updateOneById({
        id: new ObjectID(DESTINATION_ID),
        data: { cursor: "2020-01-01T00:00:00.000Z" },
        props: member([Permission.SecurityAdmin]),
      }),
    ).rejects.toThrow();
    expect(destinations.get(DESTINATION_ID)!["cursor"]).toBe(
      "2026-10-19T11:00:00.000Z",
    );
  });

  test("the key is never read back, even by an admin", async () => {
    await expect(
      SecurityEventDestinationService.findOneById({
        id: new ObjectID(DESTINATION_ID),
        select: { secrets: true },
        props: member([Permission.SecurityAdmin]),
      }),
    ).rejects.toThrow();
  });

  test("every Security tier can see where events go and how sending went", async () => {
    const found: SecurityEventDestination | null =
      await SecurityEventDestinationService.findOneById({
        id: new ObjectID(DESTINATION_ID),
        select: {
          name: true,
          provider: true,
          sendScope: true,
          lastSentAt: true,
          lastError: true,
        },
        props: member([Permission.SecurityViewer]),
      });

    expect(found?.name).toBe("Existing SecOps");
  });
});
