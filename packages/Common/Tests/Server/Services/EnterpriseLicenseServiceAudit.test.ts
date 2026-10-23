import EnterpriseLicenseService, {
  writeEnterpriseLicenseAuditLine,
} from "../../../Server/Services/EnterpriseLicenseService";
import MarketingEventUtil from "../../../Server/Utils/Marketing/MarketingEventUtil";
import logger from "../../../Server/Utils/Logger";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnDelete, OnUpdate } from "../../../Server/Types/Database/Hooks";
import EnterpriseLicense from "../../../Models/DatabaseModels/EnterpriseLicense";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Deleting and changing an enterprise license is audit logged.
 *
 * Only OneUptime's master admins write licenses (the model's access control
 * is empty), from the Admin Dashboard's Enterprise Licenses screens - one at
 * a time, or several at once from Bulk Actions (Delete, Change Expiry Date).
 * A license belongs to no project, so the per-project audit log cannot hold
 * it: the service writes a server log line for each license issued, changed
 * or deleted, naming the master admin, the license by company and masked key,
 * and what changed (Server/Utils/EnterpriseLicense/EnterpriseLicenseAudit).
 *
 * The hooks read the rows a write changes through the held-rows helpers
 * (DeleteChecksReadHeldRows, UpdateChecksReadHeldRows), and an audit line
 * never fails the write it describes.
 */

const LICENSE_A: string = "5a1d4f2e-6b3c-4d5e-8f70-112233445566";
const LICENSE_B: string = "5a1d4f2e-6b3c-4d5e-8f70-112233445577";
const ADMIN_ID: ObjectID = new ObjectID("0d9c8b7a-6f5e-4d3c-8b2a-19f8e7d6c5b4");
const KEY_A: string = `da74${"1".repeat(56)}7c7a`;
const KEY_B: string = `e639${"2".repeat(56)}e1f4`;

const license: (id: string, key: string) => EnterpriseLicense = (
  id: string,
  key: string,
): EnterpriseLicense => {
  const row: EnterpriseLicense = new EnterpriseLicense();
  row._id = id;
  row.companyName = "Netlock.hu";
  row.licenseKey = key;
  row.expiresAt = new Date("2026-09-30T00:00:00.000Z");
  row.userLimit = 50;
  return row;
};

interface Hooks {
  onBeforeDelete: (
    deleteBy: DeleteBy<EnterpriseLicense>,
  ) => Promise<OnDelete<EnterpriseLicense>>;
  onDeleteSuccess: (
    onDelete: OnDelete<EnterpriseLicense>,
    ids: Array<ObjectID>,
  ) => Promise<OnDelete<EnterpriseLicense>>;
  onBeforeUpdate: (
    updateBy: UpdateBy<EnterpriseLicense>,
  ) => Promise<OnUpdate<EnterpriseLicense>>;
  onUpdateSuccess: (
    onUpdate: OnUpdate<EnterpriseLicense>,
    ids: Array<ObjectID>,
  ) => Promise<OnUpdate<EnterpriseLicense>>;
  onCreateSuccess: (
    onCreate: unknown,
    createdItem: EnterpriseLicense,
  ) => Promise<EnterpriseLicense>;
}

// The hooks are protected; they are reached the way the framework reaches them.
const hooks: Hooks = EnterpriseLicenseService as unknown as Hooks;

const deleteBy: () => DeleteBy<EnterpriseLicense> =
  (): DeleteBy<EnterpriseLicense> => {
    return {
      query: { _id: LICENSE_A },
      limit: 2,
      skip: 0,
      props: { isMasterAdmin: true, userId: ADMIN_ID },
    } as unknown as DeleteBy<EnterpriseLicense>;
  };

const updateBy: (
  data: Record<string, unknown>,
) => UpdateBy<EnterpriseLicense> = (
  data: Record<string, unknown>,
): UpdateBy<EnterpriseLicense> => {
  return {
    query: { _id: LICENSE_A },
    data,
    limit: 1,
    skip: 0,
    props: { isMasterAdmin: true, userId: ADMIN_ID },
  } as unknown as UpdateBy<EnterpriseLicense>;
};

let infoLines: Array<string> = [];
let errorLines: Array<string> = [];

beforeEach(() => {
  infoLines = [];
  errorLines = [];

  jest.spyOn(logger, "info").mockImplementation((message: unknown) => {
    infoLines.push(String(message));
  });
  jest.spyOn(logger, "error").mockImplementation((message: unknown) => {
    errorLines.push(String(message));
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a license deleted", () => {
  it("reads the licenses the delete removes with the held-rows helper, with what names them", async () => {
    const held: jest.SpyInstance = jest
      .spyOn(EnterpriseLicenseService, "findRowsAndHoldDeleteToThem")
      .mockResolvedValue([license(LICENSE_A, KEY_A)] as never);

    const request: DeleteBy<EnterpriseLicense> = deleteBy();
    const result: OnDelete<EnterpriseLicense> =
      await hooks.onBeforeDelete(request);

    expect(held).toHaveBeenCalledTimes(1);
    expect(held.mock.calls[0]![0]).toBe(request);
    expect(held.mock.calls[0]![1]).toEqual(
      expect.objectContaining({
        _id: true,
        companyName: true,
        licenseKey: true,
        expiresAt: true,
      }),
    );
    expect(result.deleteBy).toBe(request);
    expect(result.carryForward).toEqual({
      licenses: [license(LICENSE_A, KEY_A)],
    });
  });

  it("writes one line for each license that went, naming the master admin and the masked key", async () => {
    jest
      .spyOn(EnterpriseLicenseService, "findRowsAndHoldDeleteToThem")
      .mockResolvedValue([
        license(LICENSE_A, KEY_A),
        license(LICENSE_B, KEY_B),
      ] as never);

    const onDelete: OnDelete<EnterpriseLicense> =
      await hooks.onBeforeDelete(deleteBy());

    // Only A was deleted (B went before this delete reached it).
    await hooks.onDeleteSuccess(onDelete, [new ObjectID(LICENSE_A)]);

    expect(infoLines).toEqual([
      `Enterprise license ${LICENSE_A} (Netlock.hu, key da74••••7c7a), expiring 2026-09-30, deleted by master admin ${ADMIN_ID.toString()}.`,
    ]);
    expect(infoLines.join("\n")).not.toContain(KEY_A);
  });

  it("a delete that removed nothing writes nothing", async () => {
    await hooks.onDeleteSuccess(
      { deleteBy: deleteBy(), carryForward: { licenses: [] } },
      [],
    );
    await hooks.onDeleteSuccess({ deleteBy: deleteBy(), carryForward: null }, [
      new ObjectID(LICENSE_A),
    ]);

    expect(infoLines).toEqual([]);
  });
});

describe("a license changed", () => {
  it("an update of the license server's own figures reads nothing and writes no line", async () => {
    const held: jest.SpyInstance = jest.spyOn(
      EnterpriseLicenseService,
      "findRowsAndHoldUpdateToThem",
    );

    const onUpdate: OnUpdate<EnterpriseLicense> = await hooks.onBeforeUpdate(
      updateBy({ currentUserCount: 12 }),
    );

    expect(held).not.toHaveBeenCalled();
    expect(onUpdate.carryForward).toBeNull();

    await hooks.onUpdateSuccess(onUpdate, [new ObjectID(LICENSE_A)]);

    expect(infoLines).toEqual([]);
  });

  it("a change of the expiry (the bulk Change Expiry Date) reads the license first and says old to new", async () => {
    const held: jest.SpyInstance = jest
      .spyOn(EnterpriseLicenseService, "findRowsAndHoldUpdateToThem")
      .mockResolvedValue([license(LICENSE_A, KEY_A)] as never);

    const request: UpdateBy<EnterpriseLicense> = updateBy({
      expiresAt: "2027-09-30",
    });
    const onUpdate: OnUpdate<EnterpriseLicense> =
      await hooks.onBeforeUpdate(request);

    expect(held).toHaveBeenCalledTimes(1);
    expect(held.mock.calls[0]![0]).toBe(request);
    expect(held.mock.calls[0]![1]).toEqual(
      expect.objectContaining({ expiresAt: true, licenseKey: true }),
    );

    await hooks.onUpdateSuccess(onUpdate, [new ObjectID(LICENSE_A)]);

    expect(infoLines).toEqual([
      `Enterprise license ${LICENSE_A} (Netlock.hu, key da74••••7c7a) changed by master admin ${ADMIN_ID.toString()}: expiresAt 2026-09-30 -> 2027-09-30.`,
    ]);
  });

  it("a license the update did not reach writes no line, and nor does a save that changed nothing", async () => {
    jest
      .spyOn(EnterpriseLicenseService, "findRowsAndHoldUpdateToThem")
      .mockResolvedValue([license(LICENSE_A, KEY_A)] as never);

    const onUpdate: OnUpdate<EnterpriseLicense> = await hooks.onBeforeUpdate(
      updateBy({ expiresAt: "2027-09-30" }),
    );

    await hooks.onUpdateSuccess(onUpdate, [new ObjectID(LICENSE_B)]);

    const unchanged: OnUpdate<EnterpriseLicense> = await hooks.onBeforeUpdate(
      updateBy({ expiresAt: "2026-09-30", userLimit: 50 }),
    );

    await hooks.onUpdateSuccess(unchanged, [new ObjectID(LICENSE_A)]);

    expect(infoLines).toEqual([]);
  });
});

describe("a license issued", () => {
  it("writes who issued it, and still emits the issued conversion", async () => {
    const emitted: jest.SpyInstance = jest
      .spyOn(MarketingEventUtil, "emitInBackground")
      .mockReturnValue(undefined);

    const created: EnterpriseLicense = license(LICENSE_A, KEY_A);

    await hooks.onCreateSuccess(
      {
        createBy: {
          data: created,
          props: { isMasterAdmin: true, userId: ADMIN_ID },
        },
      },
      created,
    );

    expect(infoLines).toEqual([
      `Enterprise license ${LICENSE_A} (Netlock.hu, key da74••••7c7a), expiring 2026-09-30, issued by master admin ${ADMIN_ID.toString()}.`,
    ]);
    expect(emitted).toHaveBeenCalledTimes(1);
  });

  it("a hook handed no create (as older callers do) still finishes", async () => {
    jest
      .spyOn(MarketingEventUtil, "emitInBackground")
      .mockReturnValue(undefined);

    const created: EnterpriseLicense = license(LICENSE_A, KEY_A);

    await expect(hooks.onCreateSuccess({}, created)).resolves.toBe(created);
    expect(infoLines[0]).toContain("issued by OneUptime.");
  });
});

describe("an audit line never fails the write it describes", () => {
  it("a line that cannot be built is reported, and nothing throws", () => {
    expect(() => {
      writeEnterpriseLicenseAuditLine((): string => {
        throw new TypeError("expiresAt.toISOString is not a function");
      });
    }).not.toThrow();

    expect(infoLines).toEqual([]);
    expect(errorLines).toEqual([
      "EnterpriseLicenseService: could not write an audit line for an enterprise license change: expiresAt.toISOString is not a function",
    ]);
  });

  it("no line, no log", () => {
    writeEnterpriseLicenseAuditLine((): null => {
      return null;
    });

    expect(infoLines).toEqual([]);
    expect(errorLines).toEqual([]);
  });
});
