import GoogleSecOpsConnection from "../../../Models/DatabaseModels/GoogleSecOpsConnection";
import GoogleSecOpsConnectionRun from "../../../Models/DatabaseModels/GoogleSecOpsConnectionRun";
import GoogleSecOpsConnectionService from "../../../Server/Services/GoogleSecOpsConnectionService";
import GoogleSecOpsClient from "../../../Server/Utils/SecurityEvent/GoogleSecOps/GoogleSecOpsClient";
import Permission from "../../../Types/Permission";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

interface ConnectionHooks {
  onBeforeCreate: (data: unknown) => Promise<unknown>;
  onBeforeUpdate: (data: unknown) => Promise<unknown>;
}

const hooks: ConnectionHooks =
  GoogleSecOpsConnectionService as unknown as ConnectionHooks;

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Google SecOps diagnostics access boundaries", () => {
  test("run history is tenant scoped and cannot be created, changed or deleted through CRUD", () => {
    const run: GoogleSecOpsConnectionRun = new GoogleSecOpsConnectionRun();
    expect(run.getTenantColumn()).toBe("projectId");
    expect(run.getCrudApiPath()?.toString()).toBe(
      "/google-secops-connection-run",
    );
    expect(run.createRecordPermissions).toEqual([]);
    expect(run.updateRecordPermissions).toEqual([]);
    expect(run.deleteRecordPermissions).toEqual([]);
    expect(run.readRecordPermissions).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.SecurityAdmin,
      Permission.SecurityMember,
      Permission.SecurityViewer,
    ]);
    expect(run.readRecordPermissions).not.toContain(Permission.Public);
  });

  test.each([
    "projectId",
    "googleSecOpsConnectionId",
    "requestedByUserId",
    "type",
    "status",
    "request",
    "result",
    "error",
    "startedAt",
    "completedAt",
  ])(
    "run field %s is readable by security viewers and writable only internally",
    (field: string) => {
      const control: ReturnType<
        GoogleSecOpsConnection["getColumnAccessControlFor"]
      > = new GoogleSecOpsConnectionRun().getColumnAccessControlFor(field);
      expect(control?.create).toEqual([]);
      expect(control?.update).toEqual([]);
      expect(control?.read).toContain(Permission.SecurityViewer);
    },
  );

  test.each(["lastSuccessfulPollAt", "lastEventIngestedAt", "lastPollResult"])(
    "clients cannot forge the connection's %s",
    (field: string) => {
      const control: ReturnType<
        GoogleSecOpsConnection["getColumnAccessControlFor"]
      > = new GoogleSecOpsConnection().getColumnAccessControlFor(field);
      expect(control?.create).toEqual([]);
      expect(control?.update).toEqual([]);
      expect(control?.read).toContain(Permission.SecurityMember);
    },
  );

  test("only connector administrators can change the detection scope", () => {
    const control: ReturnType<
      GoogleSecOpsConnection["getColumnAccessControlFor"]
    > = new GoogleSecOpsConnection().getColumnAccessControlFor(
      "includeNonAlertingDetections",
    );
    expect(control?.update).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.SecurityAdmin,
    ]);
    expect(control?.create).toEqual(control?.update);
    expect(control?.read).toContain(Permission.SecurityViewer);
  });

  test("diagnostics do not make the service account readable or add it to run history", () => {
    const connection: GoogleSecOpsConnection = new GoogleSecOpsConnection();
    expect(
      connection.getColumnAccessControlFor("serviceAccountJson")?.read,
    ).toEqual([]);
    expect(Object.keys(new GoogleSecOpsConnectionRun())).not.toContain(
      "serviceAccountJson",
    );
  });
});

describe("Google SecOps detection scope validation", () => {
  test.each([true, false, undefined])(
    "accepts scope %s on update",
    async (value: boolean | undefined) => {
      await expect(
        hooks.onBeforeUpdate({ data: { includeNonAlertingDetections: value } }),
      ).resolves.toBeDefined();
    },
  );

  test.each([null, "true", "false", "", 0, 1, [], {}])(
    "rejects non-boolean scope %p on update",
    async (value: unknown) => {
      await expect(
        hooks.onBeforeUpdate({ data: { includeNonAlertingDetections: value } }),
      ).rejects.toThrow("must be true or false");
    },
  );

  test.each([true, false])(
    "accepts scope %s when creating a connection",
    async (value: boolean) => {
      jest
        .spyOn(GoogleSecOpsClient, "parseServiceAccountJson")
        .mockReturnValue({
          clientEmail: "test@example.com",
          privateKey: "test",
          tokenUri: "https://oauth2.googleapis.com/token",
        });
      await expect(
        hooks.onBeforeCreate({
          data: {
            serviceAccountJson: "{}",
            includeNonAlertingDetections: value,
          },
        }),
      ).resolves.toBeDefined();
    },
  );

  test("rejects invalid scope on create before processing credentials", async () => {
    jest.spyOn(GoogleSecOpsClient, "parseServiceAccountJson");
    await expect(
      hooks.onBeforeCreate({
        data: {
          serviceAccountJson: "{}",
          includeNonAlertingDetections: "false",
        },
      }),
    ).rejects.toThrow("must be true or false");
    expect(GoogleSecOpsClient.parseServiceAccountJson).not.toHaveBeenCalled();
  });
});
