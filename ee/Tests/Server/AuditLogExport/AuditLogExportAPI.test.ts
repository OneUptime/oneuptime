import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("Common/Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("Common/Tests/Server/Enterprise/TestBillingFlag") =
    jest.requireActual(
      "Common/Tests/Server/Enterprise/TestBillingFlag",
    ) as typeof import("Common/Tests/Server/Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

import AuditLogExportAPI, {
  AuditLogExportTest,
} from "../../../Server/AuditLogExport/API/AuditLogExportAPI";
import AuditLogExportArea from "../../../Server/AuditLogExport/Index";
import AuditLogExportDestinationRegistry from "../../../Server/AuditLogExport/Destinations/DestinationRegistry";
import { AuditLogExportDeliveryError } from "../../../Server/AuditLogExport/Destinations/Types";
import EnterpriseFeature from "Common/Server/Enterprise/EnterpriseFeature";
import { EnterpriseServerModuleShape } from "Common/Server/Enterprise/EnterpriseServerModule";
import MasterAdminAuthorization from "Common/Server/Middleware/MasterAdminAuthorization";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import AuditLogExportService from "Common/Server/Services/AuditLogExportService";
import { ExpressRouter } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import AuditLogExportDestinationType from "Common/Types/AuditLog/Export/AuditLogExportDestinationType";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Permission, { UserPermission } from "Common/Types/Permission";
import UserType from "Common/Types/UserType";
import {
  installFakeEnterpriseModuleWithFeatures,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import {
  InMemoryTable,
  useInMemoryTable,
} from "Common/Tests/Server/TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "Common/Tests/Server/TestingUtils/ProjectDirectory";
import { ON_HIGHEST_PLAN } from "Common/Tests/Server/TestingUtils/RequestPlan";
import { PROJECT_A, PROJECT_B } from "./AuditLogExportTestData";
import RecordingDestination from "./Fakes/RecordingDestination";

/*
 * Testing an export before anything real is sent: what the two routes
 * answer (AuditLogExportTest) as each caller, with exports kept in memory
 * behind the real AuditLogExportService and destinations that record what
 * they were sent; and the router as express sees it.
 */

const PROJECT_EXPORT_ID: string = "9ba7b811-9dad-41d1-80b4-00c04fd43101";
const OTHER_PROJECT_EXPORT_ID: string = "9ba7b812-9dad-41d1-80b4-00c04fd43101";
const INSTANCE_EXPORT_ID: string = "9ba7b813-9dad-41d1-80b4-00c04fd43101";

function member(
  permissions: Array<Permission>,
  projectId: string = PROJECT_A,
): DatabaseCommonInteractionProps {
  return {
    ...ON_HIGHEST_PLAN,
    tenantId: new ObjectID(projectId),
    userId: ObjectID.generate(),
    userType: UserType.User,
    userTenantAccessPermission: {
      [projectId]: {
        _type: "UserTenantAccessPermission",
        projectId: new ObjectID(projectId),
        permissions: permissions.map(
          (permission: Permission): UserPermission => {
            return {
              _type: "UserPermission",
              permission,
              labelIds: [],
              isBlockPermission: false,
            } as UserPermission;
          },
        ),
      },
    },
  } as unknown as DatabaseCommonInteractionProps;
}

const OWNER: DatabaseCommonInteractionProps = member([Permission.ProjectOwner]);

const MASTER_ADMIN: DatabaseCommonInteractionProps = {
  userId: ObjectID.generate(),
  userType: UserType.MasterAdmin,
  isMasterAdmin: true,
} as unknown as DatabaseCommonInteractionProps;

const WEBHOOK_BODY: JSONObject = {
  destinationType: "webhook",
  config: { url: "https://93.184.216.34/audit" },
  secrets: { headerValue: "Bearer typed-in-the-form" },
};

describe("testing an audit log export", () => {
  let webhook: RecordingDestination;
  let s3: RecordingDestination;
  let exports: InMemoryTable;

  beforeEach(() => {
    for (const silenced of ["debug", "info", "warn", "error"] as const) {
      jest.spyOn(logger, silenced).mockImplementation((): void => {
        return undefined;
      });
    }

    setTestBillingEnabled(false);
    installFakeEnterpriseModuleWithFeatures([EnterpriseFeature.AuditLogs]);
    stubProjectDirectory({});

    webhook = new RecordingDestination();
    s3 = new RecordingDestination();
    AuditLogExportDestinationRegistry.setDestination(
      AuditLogExportDestinationType.Webhook,
      webhook,
    );
    AuditLogExportDestinationRegistry.setDestination(
      AuditLogExportDestinationType.AmazonS3,
      s3,
    );

    exports = useInMemoryTable(AuditLogExportService, [
      {
        _id: PROJECT_EXPORT_ID,
        projectId: PROJECT_A,
        name: "Webhook",
        destinationType: "webhook",
        config: { url: "https://93.184.216.34/audit" },
        secrets: JSON.stringify({ headerValue: "Bearer stored-token" }),
        isEnabled: true,
        version: 1,
      },
      {
        _id: OTHER_PROJECT_EXPORT_ID,
        projectId: PROJECT_B,
        name: "Someone else's",
        destinationType: "webhook",
        config: { url: "https://93.184.216.34/other" },
        secrets: JSON.stringify({ headerValue: "Bearer their-token" }),
        isEnabled: true,
        version: 1,
      },
      {
        _id: INSTANCE_EXPORT_ID,
        projectId: null,
        name: "Every project",
        destinationType: "s3",
        config: {
          bucket: "acme-audit-logs",
          region: "eu-west-1",
          accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        },
        secrets: JSON.stringify({ secretAccessKey: "stored-secret" }),
        isEnabled: true,
        version: 1,
      },
    ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    AuditLogExportDestinationRegistry.reset();
    uninstallEnterpriseModule();
  });

  describe("a project's", () => {
    test.each([
      ["a project owner", [Permission.ProjectOwner]],
      ["a project admin", [Permission.ProjectAdmin]],
    ])(
      "%s tests settings never saved: one test entry arrives",
      async (_who: string, permissions: Array<Permission>) => {
        const answer: JSONObject = await AuditLogExportTest.testProjectExport({
          body: WEBHOOK_BODY,
          props: member(permissions),
        });

        // Where the destination says it went (the recording one names the batch).
        expect(answer).toEqual({
          isSuccessful: true,
          message: `A test entry was sent to recorded://${webhook.batches[0]!.id}. Its action is Test.`,
        });
        expect(webhook.batches).toHaveLength(1);
        expect(webhook.batches[0]!.isTest).toBe(true);
        expect(webhook.batches[0]!.records[0]!.action).toBe("Test");
        expect(webhook.batches[0]!.records[0]!.projectId).toBe(PROJECT_A);
        expect(webhook.deliveries[0]!.settings.secrets).toEqual({
          headerValue: "Bearer typed-in-the-form",
        });
      },
    );

    test("a file destination's test says where its file is", async () => {
      const answer: JSONObject = await AuditLogExportTest.testProjectExport({
        body: {
          destinationType: "s3",
          config: {
            bucket: "acme-audit-logs",
            region: "eu-west-1",
            accessKeyId: "AKIAIOSFODNN7EXAMPLE",
          },
          secrets: { secretAccessKey: "secret" },
        },
        props: OWNER,
      });

      expect(answer["isSuccessful"]).toBe(true);
      expect(answer["message"]).toBe(
        `A test file was written to recorded://${s3.batches[0]!.id}. Real entries are written next to it, in folders by date.`,
      );
    });

    test.each([
      ["a project member", [Permission.ProjectMember]],
      ["a settings admin", [Permission.SettingsAdmin]],
      ["someone who reads the audit log", [Permission.ReadAuditLog]],
    ])(
      "%s may not test, and nothing is sent",
      async (_who: string, permissions: Array<Permission>) => {
        await expect(
          AuditLogExportTest.testProjectExport({
            body: WEBHOOK_BODY,
            props: member(permissions),
          }),
        ).rejects.toThrow();
        expect(webhook.attempts).toBe(0);
      },
    );

    test("settings a save would refuse are refused, with the same message", async () => {
      await expect(
        AuditLogExportTest.testProjectExport({
          body: { ...WEBHOOK_BODY, config: { url: "ftp://logs.example.com" } },
          props: OWNER,
        }),
      ).rejects.toThrow(BadDataException);

      await expect(
        AuditLogExportTest.testProjectExport({
          body: { ...WEBHOOK_BODY, config: { url: "http://127.0.0.1/hook" } },
          props: OWNER,
        }),
      ).rejects.toThrow("URL host 127.0.0.1 is not allowed");
      expect(webhook.attempts).toBe(0);
    });

    test("a saved export is tested with its stored credential, which never comes back", async () => {
      const answer: JSONObject = await AuditLogExportTest.testProjectExport({
        body: { exportId: PROJECT_EXPORT_ID },
        props: OWNER,
      });

      expect(answer["isSuccessful"]).toBe(true);
      expect(JSON.stringify(answer)).not.toContain("stored-token");
      expect(webhook.deliveries[0]!.settings.secrets).toEqual({
        headerValue: "Bearer stored-token",
      });
    });

    test("an edit's unsaved values are tested over the stored ones", async () => {
      await AuditLogExportTest.testProjectExport({
        body: {
          exportId: PROJECT_EXPORT_ID,
          config: { url: "https://93.184.216.35/new" },
          secrets: { headerValue: "" },
        },
        props: OWNER,
      });

      expect(webhook.deliveries[0]!.settings.config).toEqual({
        url: "https://93.184.216.35/new",
      });
      // Left blank: the stored credential.
      expect(webhook.deliveries[0]!.settings.secrets).toEqual({
        headerValue: "Bearer stored-token",
      });
    });

    test("another project's export is never found, and nothing is sent", async () => {
      await expect(
        AuditLogExportTest.testProjectExport({
          body: { exportId: OTHER_PROJECT_EXPORT_ID },
          props: OWNER,
        }),
      ).rejects.toThrow();

      await expect(
        AuditLogExportTest.testProjectExport({
          body: { exportId: INSTANCE_EXPORT_ID },
          props: OWNER,
        }),
      ).rejects.toThrow();

      expect(webhook.attempts + s3.attempts).toBe(0);
    });

    test("a bad export id is a sentence, not a crash", async () => {
      await expect(
        AuditLogExportTest.testProjectExport({
          body: { exportId: "not-an-id" },
          props: OWNER,
        }),
      ).rejects.toThrow("A valid export ID is required.");
    });

    test("a destination that refuses answers what it said, without throwing", async () => {
      webhook.failNext(
        1,
        new AuditLogExportDeliveryError(
          "The webhook endpoint refused the credential (HTTP 401).",
          { retryable: false, status: 401 },
        ),
      );

      expect(
        await AuditLogExportTest.testProjectExport({
          body: WEBHOOK_BODY,
          props: OWNER,
        }),
      ).toEqual({
        isSuccessful: false,
        message: "The webhook endpoint refused the credential (HTTP 401).",
      });
    });

    test("the Community Edition cannot test", async () => {
      uninstallEnterpriseModule();

      await expect(
        AuditLogExportTest.testProjectExport({
          body: WEBHOOK_BODY,
          props: OWNER,
        }),
      ).rejects.toThrow();
      expect(webhook.attempts).toBe(0);
    });

    test("a request without a project is refused", async () => {
      await expect(
        AuditLogExportTest.testProjectExport({
          body: WEBHOOK_BODY,
          props: { ...OWNER, tenantId: undefined } as never,
        }),
      ).rejects.toThrow();
    });
  });

  describe("the instance's", () => {
    test("a master admin tests settings never saved, and the test names no project", async () => {
      const answer: JSONObject = await AuditLogExportTest.testInstanceExport({
        body: WEBHOOK_BODY,
        props: MASTER_ADMIN,
      });

      expect(answer["isSuccessful"]).toBe(true);
      expect(webhook.batches[0]!.records[0]!.projectId).toBeNull();
      // The instance's export may reach a private network on any deployment.
      expect(webhook.deliveries[0]!.egress.blockPrivateAddresses).toBe(false);
    });

    test("a saved instance export is tested with its stored credential", async () => {
      const answer: JSONObject = await AuditLogExportTest.testInstanceExport({
        body: { exportId: INSTANCE_EXPORT_ID },
        props: MASTER_ADMIN,
      });

      expect(answer["isSuccessful"]).toBe(true);
      expect(s3.deliveries[0]!.settings.secrets).toEqual({
        secretAccessKey: "stored-secret",
      });
    });

    test("the instance's route does not test a project's export", async () => {
      await expect(
        AuditLogExportTest.testInstanceExport({
          body: { exportId: PROJECT_EXPORT_ID },
          props: MASTER_ADMIN,
        }),
      ).rejects.toThrow("The export no longer exists.");
      expect(webhook.attempts).toBe(0);
    });

    test("without a license that includes audit logs it cannot test", async () => {
      installFakeEnterpriseModuleWithFeatures([EnterpriseFeature.SCIM]);

      await expect(
        AuditLogExportTest.testInstanceExport({
          body: WEBHOOK_BODY,
          props: MASTER_ADMIN,
        }),
      ).rejects.toThrow();
      expect(webhook.attempts).toBe(0);
    });
  });

  test("the exports were only read, never written", () => {
    expect(exports.updates).toEqual([]);
    expect(exports.inserts).toEqual([]);
  });
});

describe("the router", () => {
  interface RouteLayer {
    route?: {
      path: string;
      methods: Record<string, boolean>;
      stack: Array<{ handle: unknown }>;
    };
  }

  const layers: Array<RouteLayer> = (
    AuditLogExportAPI as unknown as { stack: Array<RouteLayer> }
  ).stack;

  test("is the area's one API router, and holds routes only", () => {
    const routers: Array<ExpressRouter> = AuditLogExportArea.getApiRouters!();

    expect(routers).toEqual([AuditLogExportAPI]);
    expect(
      EnterpriseServerModuleShape.findLayersWithoutRoute(AuditLogExportAPI),
    ).toEqual([]);
  });

  test("holds exactly the two test routes, both POST", () => {
    expect(
      layers.map((layer: RouteLayer): [string, Record<string, boolean>] => {
        return [layer.route!.path, layer.route!.methods];
      }),
    ).toEqual([
      ["/audit-log-export/test", { post: true }],
      ["/audit-log-export/instance/test", { post: true }],
    ]);
  });

  test("the project's route authenticates the user first; the instance's asks for a master admin first", () => {
    const projectStack: Array<{ handle: unknown }> = layers[0]!.route!.stack;
    const instanceStack: Array<{ handle: unknown }> = layers[1]!.route!.stack;

    expect(projectStack[0]!.handle).toBe(UserMiddleware.getUserMiddleware);
    expect(projectStack[1]!.handle).toBe(
      UserMiddleware.requireUserAuthentication,
    );
    expect(instanceStack[0]!.handle).toBe(
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
    );
  });

  test("leaves the CRUD routes of /audit-log-export to core", () => {
    const paths: Array<string> = layers.map((layer: RouteLayer): string => {
      return layer.route!.path;
    });

    for (const corePath of [
      "/audit-log-export",
      "/audit-log-export/get-list",
      "/audit-log-export/count",
      "/audit-log-export/:id",
    ]) {
      expect(paths).not.toContain(corePath);
    }
  });
});
