import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import AuditLogExport from "../../../Models/DatabaseModels/AuditLogExport";
import AuditLogExportService, {
  INSTANCE_AUDIT_LOG_EXPORT_REFUSED_MESSAGE,
  Service as AuditLogExportServiceClass,
} from "../../../Server/Services/AuditLogExportService";
import EnterpriseFeature from "../../../Server/Enterprise/EnterpriseFeature";
import { AuditLogExportSettings } from "../../../Server/Utils/AuditLog/Export/AuditLogExportSettings";
import logger from "../../../Server/Utils/Logger";
import AuditLogExportDestinationType from "../../../Types/AuditLog/Export/AuditLogExportDestinationType";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import {
  installFakeEnterpriseModuleWithFeatures,
  uninstallEnterpriseModule,
} from "../Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import { getJestSpyOn } from "../../Spy";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { startEachTestOnSelfHostedEgressPolicy } from "../Utils/EgressPolicyEnvironment";

/*
 * An audit log export, saved through the whole write as the people who save
 * one: its settings are checked and kept as the exporter sends with them, the
 * credential is encrypted and never read back, the exporter's bookkeeping -
 * the cursor, the failure state - is OneUptime's alone and is reset only by
 * the changes that should reset it, only a project's owners and admins may
 * set one up, and only a master admin exports the whole instance.
 *
 * Self-hosted with the Enterprise Edition and a license that includes audit
 * logs, unless a test says otherwise.
 */

jest.mock("../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../Enterprise/TestBillingFlag",
    ) as typeof import("../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

const PROJECT_ID: ObjectID = new ObjectID(
  "7ba7b811-9dad-41d1-80b4-00c04fd43101",
);
const EXPORT_ID: string = "7ba7b812-9dad-41d1-80b4-00c04fd43101";
const INSTANCE_EXPORT_ID: string = "7ba7b813-9dad-41d1-80b4-00c04fd43101";
const NOW: Date = new Date("2026-10-24T12:00:00.000Z");
const SECRET: string = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";

function member(
  permissions: Array<Permission>,
  plan: Partial<DatabaseCommonInteractionProps> = ON_HIGHEST_PLAN,
): DatabaseCommonInteractionProps {
  return {
    ...plan,
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

const MASTER_ADMIN: DatabaseCommonInteractionProps = {
  ...ON_HIGHEST_PLAN,
  userId: ObjectID.generate(),
  userType: UserType.MasterAdmin,
  isMasterAdmin: true,
} as unknown as DatabaseCommonInteractionProps;

const OWNER: DatabaseCommonInteractionProps = member([Permission.ProjectOwner]);

/*
 * The plans, as CI's config.env defines them: set here (and restored) so the
 * suite does not depend on the file it runs with.
 */
const PLAN_ENVIRONMENT: Record<string, string> = {
  SUBSCRIPTION_PLAN_BASIC: "Free,price_free_month,price_free_year,0,0,1,0",
  SUBSCRIPTION_PLAN_GROWTH:
    "Growth,price_growth_month,price_growth_year,22,20,2,14",
  SUBSCRIPTION_PLAN_SCALE:
    "Scale,price_scale_month,price_scale_year,99,84,3,14",
  SUBSCRIPTION_PLAN_ENTERPRISE:
    "Enterprise,price_enterprise_month,price_enterprise_year,-1,-1,4,14",
};

const savedPlanEnvironment: Record<string, string | undefined> = {};

function usePlanEnvironment(): void {
  for (const [name, value] of Object.entries(PLAN_ENVIRONMENT)) {
    savedPlanEnvironment[name] = process.env[name];
    process.env[name] = value;
  }
}

function restorePlanEnvironment(): void {
  for (const name of Object.keys(PLAN_ENVIRONMENT)) {
    const value: string | undefined = savedPlanEnvironment[name];

    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
}

function newS3Export(
  overrides: Partial<Record<string, unknown>> = {},
): AuditLogExport {
  const item: AuditLogExport = new AuditLogExport();
  item.name = "Compliance archive";
  item.destinationType = AuditLogExportDestinationType.AmazonS3;
  item.config = {
    bucket: "acme-audit-logs",
    region: "eu-west-1",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  };
  item.secrets = JSON.stringify({ secretAccessKey: SECRET });
  Object.assign(item, overrides);
  return item;
}

describe("AuditLogExportService, through the whole write", () => {
  let exports: InMemoryTable;

  startEachTestOnSelfHostedEgressPolicy();

  beforeEach(() => {
    for (const silenced of ["debug", "info", "warn", "error"]) {
      getJestSpyOn(logger, silenced).mockImplementation((): void => {
        return undefined;
      });
    }

    setTestBillingEnabled(false);
    installFakeEnterpriseModuleWithFeatures([EnterpriseFeature.AuditLogs]);
    stubProjectDirectory({});
    getJestSpyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);

    exports = useInMemoryTable(AuditLogExportService, [
      {
        _id: EXPORT_ID,
        projectId: PROJECT_ID.toString(),
        name: "Existing archive",
        destinationType: AuditLogExportDestinationType.Webhook,
        config: { url: "https://93.184.216.34/oneuptime" },
        secrets: JSON.stringify({
          headerValue: "Bearer old-token",
          signingSecret: "old-signing-secret",
        }),
        isEnabled: true,
        startsAt: new Date("2026-10-01T00:00:00.000Z"),
        cursorCreatedAt: new Date("2026-10-23T10:00:00.000Z"),
        cursorEntryId: "0192f5a1-7c2e-7b1a-9c3d-4e5f60718293",
        exportedEntryCount: 120,
        lastError: "The webhook endpoint is busy or failing (HTTP 503).",
        failingSince: new Date("2026-10-24T11:00:00.000Z"),
        consecutiveFailureCount: 4,
        nextAttemptAt: new Date("2026-10-24T12:08:00.000Z"),
        version: 1,
      },
      {
        _id: INSTANCE_EXPORT_ID,
        projectId: null,
        name: "Instance archive",
        destinationType: AuditLogExportDestinationType.Syslog,
        config: { host: "syslog.example.com" },
        secrets: null,
        isEnabled: true,
        startsAt: new Date("2026-10-01T00:00:00.000Z"),
        exportedEntryCount: 0,
        consecutiveFailureCount: 0,
        version: 1,
      },
    ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    uninstallEnterpriseModule();
    restorePlanEnvironment();
  });

  function inserted(): StoredRow {
    const row: StoredRow | undefined =
      exports.inserts[exports.inserts.length - 1];

    if (!row) {
      throw new Error("Nothing was inserted.");
    }

    return row;
  }

  function lastUpdate(): StoredRow {
    const update: { id: string; set: StoredRow } | undefined =
      exports.updates[exports.updates.length - 1];

    if (!update) {
      throw new Error("Nothing was updated.");
    }

    return update.set;
  }

  describe("creating", () => {
    test.each([
      ["a project owner", [Permission.ProjectOwner]],
      ["a project admin", [Permission.ProjectAdmin]],
    ])(
      "%s saves an S3 export: on, from now, nothing exported yet, the secret never in clear",
      async (_who: string, permissions: Array<Permission>) => {
        await AuditLogExportService.create({
          data: newS3Export(),
          props: member(permissions),
        });

        const row: StoredRow = inserted();

        expect(row["projectId"]?.toString()).toBe(PROJECT_ID.toString());
        expect(row["destinationType"]).toBe("s3");
        expect(row["isEnabled"]).toBe(true);
        expect(new Date(row["startsAt"] as Date).toISOString()).toBe(
          NOW.toISOString(),
        );
        expect(row["cursorCreatedAt"] ?? null).toBeNull();
        expect(row["cursorEntryId"] ?? null).toBeNull();
        expect(row["config"]).toEqual({
          bucket: "acme-audit-logs",
          region: "eu-west-1",
          accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        });
        expect(String(row["secrets"])).not.toContain(SECRET);
        expect(String(row["secrets"])).not.toContain("secretAccessKey");
      },
    );

    test.each([
      ["a project member", [Permission.ProjectMember]],
      ["a settings admin", [Permission.SettingsAdmin]],
      ["someone who reads the audit log", [Permission.ReadAuditLog]],
      ["a viewer", [Permission.Viewer]],
    ])(
      "%s cannot set one up",
      async (_who: string, permissions: Array<Permission>) => {
        await expect(
          AuditLogExportService.create({
            data: newS3Export(),
            props: member(permissions),
          }),
        ).rejects.toThrow();
        expect(exports.inserts).toHaveLength(0);
      },
    );

    test("a backfill keeps its earlier Export From", async () => {
      await AuditLogExportService.create({
        data: newS3Export({ startsAt: new Date("2026-09-01T00:00:00.000Z") }),
        props: OWNER,
      });

      expect(new Date(inserted()["startsAt"] as Date).toISOString()).toBe(
        "2026-09-01T00:00:00.000Z",
      );
    });

    test("an Export From in the future is refused", async () => {
      await expect(
        AuditLogExportService.create({
          data: newS3Export({ startsAt: new Date("2026-11-01T00:00:00.000Z") }),
          props: OWNER,
        }),
      ).rejects.toThrow(
        "Export From cannot be in the future. Leave it empty to export from now on.",
      );
    });

    test.each<[string, Partial<Record<string, unknown>>, string]>([
      [
        "an unknown destination",
        { destinationType: "ftp" },
        "Destination must be one of",
      ],
      [
        "a bucket S3 would refuse",
        {
          config: {
            bucket: "Acme_Logs",
            region: "eu-west-1",
            accessKeyId: "AKIAEXAMPLE",
          },
        },
        "Bucket must be an S3 bucket name",
      ],
      [
        "no secret access key",
        { secrets: JSON.stringify({}) },
        "Secret access key is required for Amazon S3.",
      ],
      [
        "credentials that are not an object",
        { secrets: "[1, 2]" },
        "Credentials must be a JSON object.",
      ],
    ])(
      "refuses %s with what to change",
      async (
        _what: string,
        overrides: Partial<Record<string, unknown>>,
        message: string,
      ) => {
        const create: Promise<AuditLogExport> = AuditLogExportService.create({
          data: newS3Export(overrides),
          props: OWNER,
        });

        await expect(create).rejects.toThrow(BadDataException);
        await expect(create).rejects.toThrow(message);
        expect(exports.inserts).toHaveLength(0);
      },
    );

    test("a webhook to the server's own loopback is refused at save", async () => {
      await expect(
        AuditLogExportService.create({
          data: newS3Export({
            destinationType: AuditLogExportDestinationType.Webhook,
            config: { url: "http://127.0.0.1:3002/api" },
            secrets: undefined,
          }),
          props: OWNER,
        }),
      ).rejects.toThrow("URL host 127.0.0.1 is not allowed");
      expect(exports.inserts).toHaveLength(0);
    });

    test("a syslog export needs no credentials, and stores none", async () => {
      await AuditLogExportService.create({
        data: newS3Export({
          destinationType: AuditLogExportDestinationType.Syslog,
          config: { host: "93.184.216.36", port: 6514 },
          secrets: undefined,
        }),
        props: OWNER,
      });

      expect(inserted()["secrets"] ?? null).toBeNull();
    });
  });

  describe("the instance's export", () => {
    test("a master admin creates one without a project", async () => {
      await AuditLogExportService.create({
        data: newS3Export({ name: "Every project" }),
        props: MASTER_ADMIN,
      });

      expect(inserted()["projectId"] ?? null).toBeNull();
    });

    test("nobody else may create an export without a project", async () => {
      const props: DatabaseCommonInteractionProps = {
        ...OWNER,
        tenantId: undefined,
      } as unknown as DatabaseCommonInteractionProps;

      await expect(
        AuditLogExportService.create({ data: newS3Export(), props }),
      ).rejects.toThrow();
      expect(exports.inserts).toHaveLength(0);
    });

    test("the service itself refuses a project's member an export without a project, whatever the other checks say", async () => {
      const props: DatabaseCommonInteractionProps = {
        ...OWNER,
        tenantId: undefined,
      } as unknown as DatabaseCommonInteractionProps;

      const service: {
        onBeforeCreate: (createBy: unknown) => Promise<unknown>;
        onCreatePermitted: (onCreate: unknown) => Promise<void>;
      } = AuditLogExportService as unknown as {
        onBeforeCreate: (createBy: unknown) => Promise<unknown>;
        onCreatePermitted: (onCreate: unknown) => Promise<void>;
      };

      await expect(
        service.onBeforeCreate({ data: newS3Export(), props }),
      ).rejects.toThrow(INSTANCE_AUDIT_LOG_EXPORT_REFUSED_MESSAGE);

      // And once the tenant has been stamped, a row still without a project.
      await expect(
        service.onCreatePermitted({
          createBy: { data: newS3Export(), props },
          carryForward: null,
        }),
      ).rejects.toThrow(INSTANCE_AUDIT_LOG_EXPORT_REFUSED_MESSAGE);

      await expect(
        service.onCreatePermitted({
          createBy: { data: newS3Export(), props: MASTER_ADMIN },
          carryForward: null,
        }),
      ).resolves.toBeUndefined();
    });

    test("a master admin's instance export may reach a private address on OneUptime Cloud, a project's may not", async () => {
      setTestBillingEnabled(true);
      usePlanEnvironment();
      process.env["BILLING_ENABLED"] = "true";

      const webhook: (
        props: DatabaseCommonInteractionProps,
      ) => Promise<AuditLogExport> = (
        props: DatabaseCommonInteractionProps,
      ): Promise<AuditLogExport> => {
        return AuditLogExportService.create({
          data: newS3Export({
            destinationType: AuditLogExportDestinationType.Webhook,
            config: { url: "http://10.0.0.7:8080/audit" },
            secrets: undefined,
          }),
          props,
        });
      };

      await expect(webhook(OWNER)).rejects.toThrow("10.0.0.7 is not allowed");
      await webhook(MASTER_ADMIN);

      expect(inserted()["projectId"] ?? null).toBeNull();
    });

    test("isInstanceExport is true exactly for a row without a project", () => {
      expect(AuditLogExportServiceClass.isInstanceExport({})).toBe(true);
      expect(
        AuditLogExportServiceClass.isInstanceExport({ projectId: PROJECT_ID }),
      ).toBe(false);
    });
  });

  describe("updating", () => {
    test("the destination of an export cannot be changed", async () => {
      await expect(
        AuditLogExportService.updateOneById({
          id: new ObjectID(EXPORT_ID),
          data: { destinationType: "s3" } as never,
          props: OWNER,
        }),
      ).rejects.toThrow(
        "The destination of an export cannot be changed. Create a new export instead.",
      );
    });

    test("new settings are checked, keep the stored secrets left blank, and try again at once", async () => {
      await AuditLogExportService.updateOneById({
        id: new ObjectID(EXPORT_ID),
        data: {
          config: { url: "https://93.184.216.35/oneuptime" },
          secrets: JSON.stringify({ headerValue: "" }),
        } as never,
        props: OWNER,
      });

      const set: StoredRow = lastUpdate();

      expect(set["config"]).toEqual({
        url: "https://93.184.216.35/oneuptime",
      });
      expect(set["nextAttemptAt"] ?? null).toBeNull();
      expect(set["consecutiveFailureCount"]).toBe(0);
      // The cursor is where it was: new settings do not resend anything.
      expect(Object.keys(set)).not.toContain("cursorCreatedAt");

      const settings: AuditLogExportSettings =
        await AuditLogExportService.getSettings({
          id: new ObjectID(EXPORT_ID),
        } as AuditLogExport);

      expect(settings.secrets).toEqual({
        headerValue: "Bearer old-token",
        signingSecret: "old-signing-secret",
      });
    });

    test("a new secret replaces the stored one, and null removes an optional one", async () => {
      await AuditLogExportService.updateOneById({
        id: new ObjectID(EXPORT_ID),
        data: {
          secrets: JSON.stringify({
            headerValue: "Bearer new-token",
            signingSecret: null,
          }),
        } as never,
        props: OWNER,
      });

      const settings: AuditLogExportSettings =
        await AuditLogExportService.getSettings({
          id: new ObjectID(EXPORT_ID),
        } as AuditLogExport);

      expect(settings.secrets).toEqual({ headerValue: "Bearer new-token" });
    });

    test("new settings that are wrong are refused, and nothing is written", async () => {
      await expect(
        AuditLogExportService.updateOneById({
          id: new ObjectID(EXPORT_ID),
          data: { config: { url: "ftp://logs.example.com" } } as never,
          props: OWNER,
        }),
      ).rejects.toThrow("URL must be an http or https URL.");
      expect(exports.updates).toHaveLength(0);
    });

    test("a new Export From starts the export again from there", async () => {
      await AuditLogExportService.updateOneById({
        id: new ObjectID(EXPORT_ID),
        data: { startsAt: new Date("2026-09-15T00:00:00.000Z") },
        props: OWNER,
      });

      const set: StoredRow = lastUpdate();

      expect(new Date(set["startsAt"] as Date).toISOString()).toBe(
        "2026-09-15T00:00:00.000Z",
      );
      expect(set["cursorCreatedAt"] ?? null).toBeNull();
      expect(set["cursorEntryId"] ?? null).toBeNull();
      expect(set["nextAttemptAt"] ?? null).toBeNull();
    });

    test("Export From cannot be cleared or moved into the future", async () => {
      await expect(
        AuditLogExportService.updateOneById({
          id: new ObjectID(EXPORT_ID),
          data: { startsAt: null as unknown as Date },
          props: OWNER,
        }),
      ).rejects.toThrow("Export From needs a date.");

      await expect(
        AuditLogExportService.updateOneById({
          id: new ObjectID(EXPORT_ID),
          data: { startsAt: new Date("2027-01-01T00:00:00.000Z") },
          props: OWNER,
        }),
      ).rejects.toThrow("Export From cannot be in the future.");
    });

    test("switching it back on tries at once; pausing it changes nothing else", async () => {
      await AuditLogExportService.updateOneById({
        id: new ObjectID(EXPORT_ID),
        data: { isEnabled: false },
        props: OWNER,
      });

      expect(Object.keys(lastUpdate())).not.toContain("nextAttemptAt");
      expect(Object.keys(lastUpdate())).not.toContain("cursorCreatedAt");

      await AuditLogExportService.updateOneById({
        id: new ObjectID(EXPORT_ID),
        data: { isEnabled: true },
        props: OWNER,
      });

      expect(lastUpdate()["nextAttemptAt"] ?? null).toBeNull();
      expect(lastUpdate()["consecutiveFailureCount"]).toBe(0);
      expect(Object.keys(lastUpdate())).not.toContain("cursorCreatedAt");
    });

    test("renaming it changes nothing the exporter keeps", async () => {
      await AuditLogExportService.updateOneById({
        id: new ObjectID(EXPORT_ID),
        data: { name: "Renamed archive" },
        props: OWNER,
      });

      expect(Object.keys(lastUpdate())).toEqual(
        expect.not.arrayContaining([
          "nextAttemptAt",
          "consecutiveFailureCount",
          "cursorCreatedAt",
          "cursorEntryId",
        ]),
      );
    });

    test.each([
      ["the cursor", { cursorCreatedAt: new Date("2020-01-01T00:00:00Z") }],
      ["the count", { exportedEntryCount: 0 }],
      ["the error", { lastError: "" }],
      ["the next attempt", { nextAttemptAt: new Date() }],
    ])(
      "nobody but OneUptime writes %s",
      async (_what: string, data: JSONObject) => {
        await expect(
          AuditLogExportService.updateOneById({
            id: new ObjectID(EXPORT_ID),
            data: data as never,
            props: OWNER,
          }),
        ).rejects.toThrow();
        expect(exports.updates).toHaveLength(0);
      },
    );
  });

  describe("reading", () => {
    test("the credentials are never read back, even by an owner", async () => {
      await expect(
        AuditLogExportService.findOneById({
          id: new ObjectID(EXPORT_ID),
          select: { secrets: true },
          props: OWNER,
        }),
      ).rejects.toThrow();
    });

    test("a project's owners do not see the instance's export", async () => {
      const found: Array<AuditLogExport> = await AuditLogExportService.findBy({
        query: {},
        select: { _id: true, name: true },
        skip: 0,
        limit: 10,
        props: OWNER,
      });

      expect(
        found.map((item: AuditLogExport): string => {
          return item.id!.toString();
        }),
      ).toEqual([EXPORT_ID]);
    });

    test("getSettings hands the exporter the decrypted settings", async () => {
      const settings: AuditLogExportSettings =
        await AuditLogExportService.getSettings({
          id: new ObjectID(EXPORT_ID),
        } as AuditLogExport);

      expect(settings).toEqual({
        type: "webhook",
        config: { url: "https://93.184.216.34/oneuptime" },
        secrets: {
          headerValue: "Bearer old-token",
          signingSecret: "old-signing-secret",
        },
      });
    });
  });

  describe("the edition and the plan", () => {
    test("the Community Edition cannot set one up, and can still delete one", async () => {
      uninstallEnterpriseModule();

      await expect(
        AuditLogExportService.create({ data: newS3Export(), props: OWNER }),
      ).rejects.toThrow();
      expect(exports.inserts).toHaveLength(0);

      await AuditLogExportService.deleteOneById({
        id: new ObjectID(EXPORT_ID),
        props: OWNER,
      });
      expect(exports.deletes).toContain(EXPORT_ID);
    });

    test("a license without audit logs cannot set one up", async () => {
      installFakeEnterpriseModuleWithFeatures([EnterpriseFeature.SCIM]);

      await expect(
        AuditLogExportService.create({ data: newS3Export(), props: OWNER }),
      ).rejects.toThrow();
      expect(exports.inserts).toHaveLength(0);
    });

    test("on OneUptime Cloud it needs the Enterprise plan", async () => {
      setTestBillingEnabled(true);
      usePlanEnvironment();

      await expect(
        AuditLogExportService.create({
          data: newS3Export(),
          props: member([Permission.ProjectOwner], {
            currentPlan: PlanType.Scale,
            isSubscriptionUnpaid: false,
          }),
        }),
      ).rejects.toThrow();
      expect(exports.inserts).toHaveLength(0);

      await AuditLogExportService.create({
        data: newS3Export(),
        props: member([Permission.ProjectOwner], {
          currentPlan: PlanType.Enterprise,
          isSubscriptionUnpaid: false,
        }),
      });
      expect(exports.inserts).toHaveLength(1);
    });

    test("below the plan an export can still be switched off and deleted", async () => {
      setTestBillingEnabled(true);
      usePlanEnvironment();

      const belowPlan: DatabaseCommonInteractionProps = member(
        [Permission.ProjectOwner],
        { currentPlan: PlanType.Growth, isSubscriptionUnpaid: false },
      );

      await AuditLogExportService.updateOneById({
        id: new ObjectID(EXPORT_ID),
        data: { isEnabled: false },
        props: belowPlan,
      });
      expect(exports.get(EXPORT_ID)!["isEnabled"]).toBe(false);

      await AuditLogExportService.deleteOneById({
        id: new ObjectID(EXPORT_ID),
        props: belowPlan,
      });
      expect(exports.deletes).toContain(EXPORT_ID);
    });
  });
});
