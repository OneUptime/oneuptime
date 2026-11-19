import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import DomainModel from "../../../Models/DatabaseModels/Domain";
import DomainService, {
  Service as DomainServiceType,
} from "../../../Server/Services/DomainService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import ServerDomain from "../../../Server/Types/Domain";
import DomainType from "../../../Types/Domain";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";

/*
 * A DOMAIN IS VERIFIED BY ITS NAME (#9824).
 *
 * A project proves it owns a domain once, with a TXT record
 * (Project Settings > Advanced > Domains), and a verified domain now offers
 * the project's SSO providers to every address on it at Sign in with SSO.
 * A Project Admin could rename a verified domain through the API and keep
 * it verified: only an update that set isVerified looked for the record. So
 * a project could prove one name and carry the proof to any other - and
 * have its providers offered, under its name, to another organization's
 * people.
 *
 * Now a rename takes the verification away, and an update that renames a
 * domain cannot verify it in the same write: the new name's record is
 * looked for from its row. Saving the same name back (any case, spaces
 * around it) keeps it verified, and OneUptime's own writes are left alone.
 * These run DomainService's real update hook, with the rows it reads
 * stubbed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "c0000000-0000-4000-8000-000000000001",
);
const DOMAIN_ID: ObjectID = new ObjectID(
  "c0000000-0000-4000-8000-0000000000d1",
);

const ADMIN: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: new ObjectID("c0000000-0000-4000-8000-000000000002"),
};

const MASTER_ADMIN: DatabaseCommonInteractionProps = {
  isMasterAdmin: true,
  userId: new ObjectID("c0000000-0000-4000-8000-000000000003"),
};

const SERVER: DatabaseCommonInteractionProps = { isRoot: true };

let rowsRead: jest.SpiedFunction<
  DomainServiceType["findRowsAndHoldUpdateToThem"]
>;
let txtLookups: jest.SpiedFunction<typeof ServerDomain.verifyTxtRecord>;

// The domain as it is saved: verified, under `name`.
const savedAs: (name: string) => void = (name: string): void => {
  const row: DomainModel = new DomainModel(DOMAIN_ID);
  row.domain = new DomainType(name);
  row.isVerified = true;
  row.domainVerificationText = "oneuptime-verification-abc";

  rowsRead.mockResolvedValue([row]);
};

const update: (
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
) => Promise<UpdateBy<DomainModel>> = async (
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
): Promise<UpdateBy<DomainModel>> => {
  const updateBy: UpdateBy<DomainModel> = {
    query: { _id: DOMAIN_ID.toString() },
    data: data,
    props: props,
    limit: 1,
    skip: 0,
  } as unknown as UpdateBy<DomainModel>;

  const result: OnUpdate<DomainModel> = await (
    DomainService as unknown as {
      onBeforeUpdate: (
        updateBy: UpdateBy<DomainModel>,
      ) => Promise<OnUpdate<DomainModel>>;
    }
  ).onBeforeUpdate(updateBy);

  return result.updateBy;
};

beforeEach(() => {
  rowsRead = jest.spyOn(DomainService, "findRowsAndHoldUpdateToThem");
  txtLookups = jest
    .spyOn(ServerDomain, "verifyTxtRecord")
    .mockResolvedValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each([
  ["a Project Admin", ADMIN],
  ["a master admin", MASTER_ADMIN],
])(
  "%s renaming a verified domain",
  (_who: string, props: DatabaseCommonInteractionProps) => {
    test("takes its verification away", async () => {
      savedAs("acme.com");

      const written: UpdateBy<DomainModel> = await update(
        { domain: new DomainType("victim.com") },
        props,
      );

      expect(written.data.isVerified).toBe(false);
      expect(written.data.domain?.toString()).toBe("victim.com");
    });

    test("cannot verify the new name in the same write, and no record is looked up for the old one", async () => {
      savedAs("acme.com");

      const written: UpdateBy<DomainModel> = await update(
        { domain: new DomainType("victim.com"), isVerified: true },
        props,
      );

      expect(written.data.isVerified).toBe(false);
      expect(txtLookups).not.toHaveBeenCalled();
    });

    test("saves the new name as a new domain is saved: trimmed and lower-cased", async () => {
      savedAs("acme.com");

      const written: UpdateBy<DomainModel> = await update(
        { domain: "  Victim.COM " },
        props,
      );

      expect(written.data.domain).toBeInstanceOf(DomainType);
      expect(written.data.domain?.toString()).toBe("victim.com");
      expect(written.data.isVerified).toBe(false);
    });

    test("saving the same name back, in any case, keeps it verified", async () => {
      savedAs("acme.com");

      for (const name of ["acme.com", "ACME.com", " acme.com "]) {
        const written: UpdateBy<DomainModel> = await update(
          { domain: name },
          props,
        );

        expect({ name, isVerified: written.data.isVerified }).toEqual({
          name,
          isVerified: undefined,
        });
      }
    });

    test("reads the rows it writes, and holds the write to them", async () => {
      savedAs("acme.com");

      await update({ domain: new DomainType("victim.com") }, props);

      expect(rowsRead).toHaveBeenCalledTimes(1);
      expect(rowsRead.mock.calls[0]![1]).toEqual({ domain: true });
    });
  },
);

describe("an update that does not name the domain", () => {
  test("reads nothing for it, and verifies as before", async () => {
    savedAs("acme.com");

    const written: UpdateBy<DomainModel> = await update(
      { isVerified: true },
      ADMIN,
    );

    // The verification reads the row to look its record up: once.
    expect(rowsRead).toHaveBeenCalledTimes(1);
    expect(rowsRead.mock.calls[0]![1]).toEqual({
      domain: true,
      domainVerificationText: true,
    });
    expect(txtLookups).toHaveBeenCalledWith(
      "acme.com",
      "oneuptime-verification-abc",
    );
    expect(written.data.isVerified).toBe(true);
  });
});

describe("OneUptime's own write", () => {
  test("is left as it is", async () => {
    savedAs("acme.com");

    const written: UpdateBy<DomainModel> = await update(
      { domain: "victim.com", isVerified: true },
      SERVER,
    );

    expect(written.data.isVerified).toBe(true);
    expect(written.data.domain).toBe("victim.com");
    expect(rowsRead).not.toHaveBeenCalled();
  });
});
