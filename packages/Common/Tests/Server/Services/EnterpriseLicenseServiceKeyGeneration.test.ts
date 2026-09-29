import EnterpriseLicenseService, {
  ENTERPRISE_LICENSE_KEY_RANDOM_BYTES,
  generateEnterpriseLicenseKey,
} from "../../../Server/Services/EnterpriseLicenseService";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import EnterpriseLicense from "../../../Models/DatabaseModels/EnterpriseLicense";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ColumnLength from "../../../Types/Database/ColumnLength";
import crypto from "crypto";
import { afterEach, describe, expect, it, jest } from "@jest/globals";

/*
 * License keys are generated on the SERVER when the admin leaves the field
 * blank. They used to be made in the browser (UUID.generate() in the Admin
 * Dashboard's create form), so the only randomness guarding a customer's
 * license came from whatever the admin's browser supplied.
 *
 * Pinned: a blank key becomes 32 CSPRNG bytes (64 hex characters, within the
 * ShortText column), a typed key is kept (trimmed - installations trim what
 * they send, so stored whitespace would make a key unmatchable), and the hook
 * runs in onBeforeCreate - before DatabaseService's required-column check,
 * which would otherwise reject the blank key.
 */

type RunBeforeCreateFunction = (
  license: EnterpriseLicense,
) => Promise<EnterpriseLicense>;

const runBeforeCreate: RunBeforeCreateFunction = async (
  license: EnterpriseLicense,
): Promise<EnterpriseLicense> => {
  const result: OnCreate<EnterpriseLicense> = await (
    EnterpriseLicenseService as unknown as {
      onBeforeCreate: (
        createBy: unknown,
      ) => Promise<OnCreate<EnterpriseLicense>>;
    }
  ).onBeforeCreate({
    data: license,
    props: { isRoot: true },
  });

  return result.createBy.data;
};

const HEX_KEY: RegExp = /^[0-9a-f]{64}$/;

describe("EnterpriseLicenseService license key generation", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("generateEnterpriseLicenseKey", () => {
    it("is 32 random bytes written as 64 lower-case hex characters", () => {
      expect(ENTERPRISE_LICENSE_KEY_RANDOM_BYTES).toBe(32);
      expect(generateEnterpriseLicenseKey()).toMatch(HEX_KEY);
    });

    it("fits the licenseKey column", () => {
      expect(generateEnterpriseLicenseKey().length).toBeLessThanOrEqual(
        ColumnLength.ShortText,
      );
    });

    it("comes from crypto.randomBytes", () => {
      const randomBytes: ReturnType<typeof jest.spyOn> = jest.spyOn(
        crypto,
        "randomBytes",
      );

      generateEnterpriseLicenseKey();

      expect(randomBytes).toHaveBeenCalledWith(32);
    });

    it("never repeats", () => {
      const keys: Set<string> = new Set<string>();

      for (let index: number = 0; index < 500; index++) {
        keys.add(generateEnterpriseLicenseKey());
      }

      expect(keys.size).toBe(500);
    });
  });

  describe("onBeforeCreate", () => {
    it("generates a key when the admin left it out entirely", async () => {
      const license: EnterpriseLicense = BaseModel.fromJSON(
        { companyName: "Acme, Inc.", expiresAt: "2027-01-01" },
        EnterpriseLicense,
      ) as EnterpriseLicense;

      expect((await runBeforeCreate(license)).licenseKey).toMatch(HEX_KEY);
    });

    it.each([
      ["an empty string", ""],
      ["whitespace", "   \t "],
    ])(
      "generates a key when the admin submitted %s",
      async (_label: string, licenseKey: string) => {
        const license: EnterpriseLicense = new EnterpriseLicense();
        license.companyName = "Acme, Inc.";
        license.licenseKey = licenseKey;

        expect((await runBeforeCreate(license)).licenseKey).toMatch(HEX_KEY);
      },
    );

    it("keeps a key the admin typed, trimmed", async () => {
      const license: EnterpriseLicense = new EnterpriseLicense();
      license.companyName = "Acme, Inc.";
      license.licenseKey = "  b6f4c1a2-1111-2222-3333-444455556666\n";

      expect((await runBeforeCreate(license)).licenseKey).toBe(
        "b6f4c1a2-1111-2222-3333-444455556666",
      );
    });

    it("gives two blank-key licenses different keys", async () => {
      const first: EnterpriseLicense = new EnterpriseLicense();
      const second: EnterpriseLicense = new EnterpriseLicense();

      expect((await runBeforeCreate(first)).licenseKey).not.toBe(
        (await runBeforeCreate(second)).licenseKey,
      );
    });

    it("hands the same create request on, with nothing carried forward", async () => {
      const license: EnterpriseLicense = new EnterpriseLicense();
      const createBy: { data: EnterpriseLicense; props: { isRoot: boolean } } =
        {
          data: license,
          props: { isRoot: true },
        };

      const result: OnCreate<EnterpriseLicense> = await (
        EnterpriseLicenseService as unknown as {
          onBeforeCreate: (
            createBy: unknown,
          ) => Promise<OnCreate<EnterpriseLicense>>;
        }
      ).onBeforeCreate(createBy);

      expect(result.createBy).toBe(createBy);
      expect(result.createBy.data).toBe(license);
      expect(result.carryForward).toBeUndefined();
    });
  });
});
