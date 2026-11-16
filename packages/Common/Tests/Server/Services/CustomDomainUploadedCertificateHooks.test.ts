import DashboardDomainService from "../../../Server/Services/DashboardDomainService";
import DomainService from "../../../Server/Services/DomainService";
import ProjectService from "../../../Server/Services/ProjectService";
import StatusPageDomainService from "../../../Server/Services/StatusPageDomainService";
import CustomDomainConflicts from "../../../Server/Utils/CustomDomain/CustomDomainConflicts";
import {
  UPLOADED_CERTIFICATE_MISSING_MESSAGE,
  UPLOADED_CERTIFICATE_SELECT,
  UPLOADED_KEY_DOES_NOT_MATCH_MESSAGE,
  UPLOADED_KEY_HAS_PASSPHRASE_MESSAGE,
} from "../../../Server/Utils/CustomDomain/UploadedCertificate";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import {
  CertificatePair,
  makeCertificatePair,
  withPassphrase,
} from "../TestingUtils/UploadedCertificates";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A status page's and a dashboard's custom domain that serve their owner's
 * own certificate serve a pair nginx can use - on the create, and on every
 * edit after it, whose form never shows the key it keeps
 * (UploadedCertificate). The form domain's twin of these is in
 * FormDomainService.test. The hooks run for real; the tables they read
 * are stand-ins.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-f0f0-4aaa-8bbb-000000000101",
);
const USER_ID: ObjectID = new ObjectID("0193c0de-f0f0-4aaa-8bbb-0000000001e1");
const DOMAIN_ID: string = "0193c0de-f0f0-4aaa-8bbb-0000000001d1";

type Hooks = {
  onBeforeCreate: (createBy: unknown) => Promise<{
    createBy: { data: Record<string, unknown> };
  }>;
  onBeforeUpdate: (updateBy: unknown) => Promise<{
    updateBy: { data: Record<string, unknown> };
  }>;
  findRowsAndHoldUpdateToThem: (
    updateBy: unknown,
    select: unknown,
  ) => Promise<Array<Record<string, unknown>>>;
};

const SERVICES: Array<[string, Hooks, Record<string, unknown>]> = [
  [
    "StatusPageDomainService",
    StatusPageDomainService as unknown as Hooks,
    { statusPageId: ObjectID.generate() },
  ],
  [
    "DashboardDomainService",
    DashboardDomainService as unknown as Hooks,
    { dashboardId: ObjectID.generate() },
  ],
];

let pair: CertificatePair;
let otherPair: CertificatePair;

beforeAll(async () => {
  pair = await makeCertificatePair("status.acme.com");
  otherPair = await makeCertificatePair("elsewhere.acme.com");
}, 60_000);

beforeEach(() => {
  // Every record a create names is the project's (ProjectReferenceCheck).
  stubProjectDirectory({});
  jest.spyOn(ProjectService, "isSampleProject").mockResolvedValue(false);
  jest.spyOn(DomainService, "findOneBy").mockResolvedValue({
    domain: "acme.com",
    isVerified: true,
  } as never);
  jest
    .spyOn(CustomDomainConflicts, "assertNameIsFree")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function refusal(run: Promise<unknown>): Promise<Error> {
  try {
    await run;
  } catch (err) {
    return err as Error;
  }

  throw new Error("expected a refusal");
}

describe.each(SERVICES)(
  "%s",
  (_name: string, hooks: Hooks, parent: Record<string, unknown>) => {
    function create(
      data: Record<string, unknown>,
    ): Promise<{ createBy: { data: Record<string, unknown> } }> {
      return hooks.onBeforeCreate({
        data: {
          projectId: PROJECT_ID,
          domainId: new ObjectID(DOMAIN_ID),
          subdomain: "status",
          ...parent,
          ...data,
        },
        props: { tenantId: PROJECT_ID, userId: USER_ID },
      });
    }

    function holdRows(
      rows: Array<Record<string, unknown>>,
    ): ReturnType<typeof jest.spyOn> {
      return jest
        .spyOn(hooks, "findRowsAndHoldUpdateToThem")
        .mockResolvedValue(rows as never);
    }

    function update(data: Record<string, unknown>): Promise<unknown> {
      return hooks.onBeforeUpdate({
        query: { _id: ObjectID.generate().toString() },
        data: data,
        props: { tenantId: PROJECT_ID, userId: USER_ID },
      });
    }

    describe("adding a domain", () => {
      test("on the free certificate needs no pair", async () => {
        const result: { createBy: { data: Record<string, unknown> } } =
          await create({ isCustomCertificate: false });

        expect(result.createBy.data["fullDomain"]).toBe("status.acme.com");
      });

      test("with its own certificate and the key it was issued for", async () => {
        const result: { createBy: { data: Record<string, unknown> } } =
          await create({
            isCustomCertificate: true,
            customCertificate: `\n${pair.certificate}\n`,
            customCertificateKey: `  ${pair.privateKey}`,
          });

        // Stored as nginx reads it: without what the paste picked up.
        expect(result.createBy.data["customCertificate"]).toBe(
          pair.certificate.trim(),
        );
        expect(result.createBy.data["customCertificateKey"]).toBe(
          pair.privateKey.trim(),
        );
      });

      test("is refused with its own certificate and no key", async () => {
        const error: Error = await refusal(
          create({
            isCustomCertificate: true,
            customCertificate: pair.certificate,
          }),
        );

        expect(error).toBeInstanceOf(BadDataException);
        expect(error.message).toBe(UPLOADED_CERTIFICATE_MISSING_MESSAGE);
      });

      test("is refused with another certificate's key", async () => {
        const error: Error = await refusal(
          create({
            isCustomCertificate: true,
            customCertificate: pair.certificate,
            customCertificateKey: otherPair.privateKey,
          }),
        );

        expect(error.message).toBe(UPLOADED_KEY_DOES_NOT_MATCH_MESSAGE);
      });

      test("is refused with a key behind a passphrase", async () => {
        const error: Error = await refusal(
          create({
            isCustomCertificate: true,
            customCertificate: pair.certificate,
            customCertificateKey: withPassphrase(pair.privateKey, "pkcs8"),
          }),
        );

        expect(error.message).toBe(UPLOADED_KEY_HAS_PASSPHRASE_MESSAGE);
      });
    });

    describe("editing a domain", () => {
      test("turning its own certificate on with no key stored or sent is refused", async () => {
        holdRows([{ isCustomCertificate: false }]);

        const error: Error = await refusal(
          update({
            isCustomCertificate: true,
            customCertificate: pair.certificate,
          }),
        );

        expect(error.message).toBe(UPLOADED_CERTIFICATE_MISSING_MESSAGE);
      });

      test("a renewed certificate with the key left blank keeps the stored key", async () => {
        const held: ReturnType<typeof jest.spyOn> = holdRows([
          {
            isCustomCertificate: true,
            customCertificate: pair.certificate,
            customCertificateKey: pair.privateKey,
          },
        ]);

        await expect(
          update({
            isCustomCertificate: true,
            customCertificate: pair.certificate,
          }),
        ).resolves.toBeDefined();

        expect(held).toHaveBeenCalledTimes(1);
        expect(held.mock.calls[0]![1]).toEqual(UPLOADED_CERTIFICATE_SELECT);
      });

      test("a certificate the stored key does not belong to is refused", async () => {
        holdRows([
          {
            isCustomCertificate: true,
            customCertificate: pair.certificate,
            customCertificateKey: pair.privateKey,
          },
        ]);

        const error: Error = await refusal(
          update({ customCertificate: otherPair.certificate }),
        );

        expect(error.message).toBe(UPLOADED_KEY_DOES_NOT_MATCH_MESSAGE);
      });

      test("turning its own certificate off is let through without reading a row", async () => {
        const held: ReturnType<typeof jest.spyOn> = holdRows([]);

        await expect(
          update({ isCustomCertificate: false }),
        ).resolves.toBeDefined();

        expect(held).not.toHaveBeenCalled();
      });

      test("an edit of something else reads no row", async () => {
        const held: ReturnType<typeof jest.spyOn> = holdRows([]);

        await expect(update({ subdomain: "status" })).resolves.toBeDefined();

        expect(held).not.toHaveBeenCalled();
      });
    });
  },
);
