import UploadedCertificate, {
  UPLOADED_CERTIFICATE_MISSING_MESSAGE,
  UPLOADED_CERTIFICATE_REFUSALS,
  UPLOADED_CERTIFICATE_SELECT,
  UPLOADED_CERTIFICATE_UNREADABLE_MESSAGE,
  UPLOADED_KEY_DOES_NOT_MATCH_MESSAGE,
  UPLOADED_KEY_HAS_PASSPHRASE_MESSAGE,
  UPLOADED_KEY_UNREADABLE_MESSAGE,
  UploadedCertificateColumns,
} from "../../../../Server/Utils/CustomDomain/UploadedCertificate";
import BadDataException from "../../../../Types/Exception/BadDataException";
import {
  CertificatePair,
  inPkcs1,
  makeCertificatePair,
  publicHalfOf,
  withPassphrase,
} from "../../TestingUtils/UploadedCertificates";
import { beforeAll, describe, expect, jest, test } from "@jest/globals";

/*
 * What a custom domain's owner uploads to serve the domain with their own
 * certificate: the pair must be one nginx can serve, since its key is never
 * shown again once saved. Real certificates and keys, made as the suite
 * runs (TestingUtils/UploadedCertificates).
 */

let report: CertificatePair;
let other: CertificatePair;

beforeAll(async () => {
  report = await makeCertificatePair("report.acme.com");
  other = await makeCertificatePair("other.acme.com");
}, 60_000);

function refusalOf(run: () => void): Error | null {
  try {
    run();
  } catch (err) {
    return err as Error;
  }

  return null;
}

async function asyncRefusalOf(run: () => Promise<void>): Promise<Error | null> {
  try {
    await run();
  } catch (err) {
    return err as Error;
  }

  return null;
}

describe("a pair nginx can serve", () => {
  test("a certificate and the key it was issued for are served", () => {
    expect(
      refusalOf(() => {
        UploadedCertificate.assertServable({
          certificate: report.certificate,
          privateKey: report.privateKey,
        });
      }),
    ).toBeNull();
  });

  test("a chain is read by its first certificate, the domain's own", () => {
    expect(
      refusalOf(() => {
        UploadedCertificate.assertServable({
          certificate: `${report.certificate.trim()}\n${other.certificate}`,
          privateKey: report.privateKey,
        });
      }),
    ).toBeNull();

    // The intermediate's key is not the domain's.
    expect(
      refusalOf(() => {
        UploadedCertificate.assertServable({
          certificate: `${report.certificate.trim()}\n${other.certificate}`,
          privateKey: other.privateKey,
        });
      })?.message,
    ).toBe(UPLOADED_KEY_DOES_NOT_MATCH_MESSAGE);
  });

  test("the key in its traditional form (BEGIN RSA PRIVATE KEY) is served", () => {
    const pkcs1: string = inPkcs1(report.privateKey);

    expect(pkcs1).toContain("-----BEGIN RSA PRIVATE KEY-----");
    expect(
      refusalOf(() => {
        UploadedCertificate.assertServable({
          certificate: report.certificate,
          privateKey: pkcs1,
        });
      }),
    ).toBeNull();
  });

  test("blank lines and spaces a paste picks up around either half are fine", () => {
    expect(
      refusalOf(() => {
        UploadedCertificate.assertServable({
          certificate: `\n\n   ${report.certificate}\n\n`,
          privateKey: `  \n${report.privateKey}  \n`,
        });
      }),
    ).toBeNull();
  });
});

describe("a pair nginx cannot serve is refused, saying which half and why", () => {
  test("another certificate's key", () => {
    const error: Error | null = refusalOf(() => {
      UploadedCertificate.assertServable({
        certificate: report.certificate,
        privateKey: other.privateKey,
      });
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect(error?.message).toBe(UPLOADED_KEY_DOES_NOT_MATCH_MESSAGE);
  });

  test.each([
    ["no certificate", undefined, "key"],
    ["an empty certificate", "   ", "key"],
    ["no key", "certificate", undefined],
    ["an empty key", "certificate", ""],
    ["neither", undefined, null],
  ])("%s", (_name: string, certificate: unknown, privateKey: unknown) => {
    const error: Error | null = refusalOf(() => {
      UploadedCertificate.assertServable({
        certificate:
          certificate === "certificate" ? report.certificate : certificate,
        privateKey: privateKey === "key" ? report.privateKey : privateKey,
      });
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect(error?.message).toBe(UPLOADED_CERTIFICATE_MISSING_MESSAGE);
  });

  test.each([
    ["the PEM header alone", "-----BEGIN CERTIFICATE-----"],
    ["text that is no certificate", "this is not a certificate"],
    ["the private key pasted as the certificate", "KEY"],
  ])("a certificate that is %s", (_name: string, certificate: string) => {
    const error: Error | null = refusalOf(() => {
      UploadedCertificate.assertServable({
        certificate: certificate === "KEY" ? report.privateKey : certificate,
        privateKey: report.privateKey,
      });
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect(error?.message).toBe(UPLOADED_CERTIFICATE_UNREADABLE_MESSAGE);
  });

  test.each([
    ["the PEM header alone", "-----BEGIN PRIVATE KEY-----"],
    ["text that is no key", "this is not a key"],
    ["the certificate pasted as the key", "CERTIFICATE"],
    ["the key's public half", "PUBLIC"],
  ])("a key that is %s", (_name: string, privateKey: string) => {
    const error: Error | null = refusalOf(() => {
      UploadedCertificate.assertServable({
        certificate: report.certificate,
        privateKey:
          privateKey === "CERTIFICATE"
            ? report.certificate
            : privateKey === "PUBLIC"
              ? publicHalfOf(report.privateKey)
              : privateKey,
      });
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect(error?.message).toBe(UPLOADED_KEY_UNREADABLE_MESSAGE);
  });

  test.each([["pkcs8" as const], ["pkcs1" as const]])(
    "a key behind a passphrase (%s), which nginx cannot type",
    (format: "pkcs8" | "pkcs1") => {
      const error: Error | null = refusalOf(() => {
        UploadedCertificate.assertServable({
          certificate: report.certificate,
          privateKey: withPassphrase(report.privateKey, format),
        });
      });

      expect(error).toBeInstanceOf(BadDataException);
      expect(error?.message).toBe(UPLOADED_KEY_HAS_PASSPHRASE_MESSAGE);
    },
  );

  test("no refusal quotes what was pasted", () => {
    for (const message of UPLOADED_CERTIFICATE_REFUSALS) {
      expect(message).not.toContain(report.privateKey.slice(30, 60));
      expect(message.length).toBeLessThan(150);
    }
  });
});

describe("a new domain", () => {
  test("on the free certificate is not asked about a pair", () => {
    expect(
      refusalOf(() => {
        UploadedCertificate.assertCreateIsServable({
          isCustomCertificate: false,
          customCertificate: "whatever",
        });
      }),
    ).toBeNull();
  });

  test("serving its own certificate brings a pair that works", () => {
    expect(
      refusalOf(() => {
        UploadedCertificate.assertCreateIsServable({
          isCustomCertificate: true,
          customCertificate: report.certificate,
          customCertificateKey: report.privateKey,
        });
      }),
    ).toBeNull();

    expect(
      refusalOf(() => {
        UploadedCertificate.assertCreateIsServable({
          isCustomCertificate: true,
          customCertificate: report.certificate,
          customCertificateKey: other.privateKey,
        });
      })?.message,
    ).toBe(UPLOADED_KEY_DOES_NOT_MATCH_MESSAGE);

    expect(
      refusalOf(() => {
        UploadedCertificate.assertCreateIsServable({
          isCustomCertificate: true,
          customCertificate: report.certificate,
        });
      })?.message,
    ).toBe(UPLOADED_CERTIFICATE_MISSING_MESSAGE);
  });

  test("is stored without the whitespace around its halves", () => {
    const data: UploadedCertificateColumns = {
      isCustomCertificate: true,
      customCertificate: `\n  ${report.certificate}\n\n`,
      customCertificateKey: `\n${report.privateKey}   `,
    };

    UploadedCertificate.assertCreateIsServable(data);

    expect(data.customCertificate).toBe(report.certificate.trim());
    expect(data.customCertificateKey).toBe(report.privateKey.trim());
  });
});

describe("an update", () => {
  type Rows = Array<UploadedCertificateColumns>;

  function rowsOf(rows: Rows): {
    readRows: jest.Mock<() => Promise<Rows>>;
  } {
    return {
      readRows: jest.fn<() => Promise<Rows>>().mockResolvedValue(rows),
    };
  }

  test("that writes none of the three reads no row", async () => {
    const reader: { readRows: jest.Mock<() => Promise<Rows>> } = rowsOf([]);

    await UploadedCertificate.assertUpdateIsServable({
      data: {},
      readRows: reader.readRows,
    });

    expect(reader.readRows).not.toHaveBeenCalled();
  });

  test("that turns the switch off reads no row and is let through", async () => {
    const reader: { readRows: jest.Mock<() => Promise<Rows>> } = rowsOf([]);

    await UploadedCertificate.assertUpdateIsServable({
      data: { isCustomCertificate: false, customCertificateKey: "junk" },
      readRows: reader.readRows,
    });

    expect(reader.readRows).not.toHaveBeenCalled();
  });

  test("turning the switch on with nothing stored, and no key sent, is refused", async () => {
    const error: Error | null = await asyncRefusalOf(async () => {
      await UploadedCertificate.assertUpdateIsServable({
        data: {
          isCustomCertificate: true,
          customCertificate: report.certificate,
        },
        ...rowsOf([{ isCustomCertificate: false }]),
      });
    });

    expect(error?.message).toBe(UPLOADED_CERTIFICATE_MISSING_MESSAGE);
  });

  test("turning the switch on with the whole pair sent goes through", async () => {
    expect(
      await asyncRefusalOf(async () => {
        await UploadedCertificate.assertUpdateIsServable({
          data: {
            isCustomCertificate: true,
            customCertificate: report.certificate,
            customCertificateKey: report.privateKey,
          },
          ...rowsOf([{ isCustomCertificate: false }]),
        });
      }),
    ).toBeNull();
  });

  test("a renewed certificate for the key already stored goes through, the key left blank", async () => {
    const reader: { readRows: jest.Mock<() => Promise<Rows>> } = rowsOf([
      {
        isCustomCertificate: true,
        customCertificate: report.certificate,
        customCertificateKey: report.privateKey,
      },
    ]);

    expect(
      await asyncRefusalOf(async () => {
        await UploadedCertificate.assertUpdateIsServable({
          data: { customCertificate: report.certificate },
          readRows: reader.readRows,
        });
      }),
    ).toBeNull();
    expect(reader.readRows).toHaveBeenCalledTimes(1);
  });

  test("a new certificate whose key is not the one stored is refused", async () => {
    const error: Error | null = await asyncRefusalOf(async () => {
      await UploadedCertificate.assertUpdateIsServable({
        data: { customCertificate: other.certificate },
        ...rowsOf([
          {
            isCustomCertificate: true,
            customCertificate: report.certificate,
            customCertificateKey: report.privateKey,
          },
        ]),
      });
    });

    expect(error?.message).toBe(UPLOADED_KEY_DOES_NOT_MATCH_MESSAGE);
  });

  test("a new key that is not the stored certificate's is refused", async () => {
    const error: Error | null = await asyncRefusalOf(async () => {
      await UploadedCertificate.assertUpdateIsServable({
        data: { customCertificateKey: other.privateKey },
        ...rowsOf([
          {
            isCustomCertificate: true,
            customCertificate: report.certificate,
            customCertificateKey: report.privateKey,
          },
        ]),
      });
    });

    expect(error?.message).toBe(UPLOADED_KEY_DOES_NOT_MATCH_MESSAGE);
  });

  test("clearing the key of a domain that serves its own certificate is refused", async () => {
    const error: Error | null = await asyncRefusalOf(async () => {
      await UploadedCertificate.assertUpdateIsServable({
        data: { customCertificateKey: "" },
        ...rowsOf([
          {
            isCustomCertificate: true,
            customCertificate: report.certificate,
            customCertificateKey: report.privateKey,
          },
        ]),
      });
    });

    expect(error?.message).toBe(UPLOADED_CERTIFICATE_MISSING_MESSAGE);
  });

  test("a key written to a domain on the free certificate is not checked", async () => {
    expect(
      await asyncRefusalOf(async () => {
        await UploadedCertificate.assertUpdateIsServable({
          data: { customCertificateKey: "kept for later" },
          ...rowsOf([{ isCustomCertificate: false }]),
        });
      }),
    ).toBeNull();
  });

  test("every row the update writes is held to it", async () => {
    const error: Error | null = await asyncRefusalOf(async () => {
      await UploadedCertificate.assertUpdateIsServable({
        data: { customCertificateKey: report.privateKey },
        ...rowsOf([
          {
            isCustomCertificate: true,
            customCertificate: report.certificate,
          },
          {
            isCustomCertificate: true,
            customCertificate: other.certificate,
          },
        ]),
      });
    });

    expect(error?.message).toBe(UPLOADED_KEY_DOES_NOT_MATCH_MESSAGE);
  });

  test("the rows are read with the three columns the check needs", () => {
    expect(UPLOADED_CERTIFICATE_SELECT).toEqual({
      isCustomCertificate: true,
      customCertificate: true,
      customCertificateKey: true,
    });
  });
});
