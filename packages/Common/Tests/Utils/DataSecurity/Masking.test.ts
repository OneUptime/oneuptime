import { describe, expect, test } from "@jest/globals";
import DataCategory from "../../../Types/DataSecurity/DataCategory";
import {
  DATA_TYPE_CATALOG,
  DataTypeInfo,
} from "../../../Types/DataSecurity/DataTypeCatalog";
import {
  MAX_MASKED_SAMPLE_LENGTH,
  maskCardNumber,
  maskCredentialsInText,
  maskEmail,
  maskSecret,
  maskValue,
} from "../../../Utils/DataSecurity/Masking";
import {
  findSensitiveValues,
  TextMatch,
} from "../../../Utils/DataSecurity/TextScanner";
import { generatedTexts } from "../../Helpers/GeneratedTexts";

/*
 * MASKED EVIDENCE: ENOUGH TO RECOGNISE A VALUE, NEVER ENOUGH TO USE IT.
 *
 * Each kind of value keeps only what Masking.ts says it may - an email its
 * first letters and top-level label, a card its last four digits, a secret
 * four characters at each end, a URL everything but its password - and no
 * sample is longer than MAX_MASKED_SAMPLE_LENGTH. Secrets here are put
 * together when the test runs, so no scanner reading this file sees one.
 */

const ALPHANUMERIC: Array<string> =
  "Fk7Qz2Lp9Xw4Rt6Hy3Nc8Vb5Jm1Gd0SaEiUoTyPq".split("");

function alphanumericCount(text: string): number {
  return text.replace(/[^A-Za-z0-9]/g, "").length;
}

describe("maskEmail", () => {
  test("keeps the first character of the name and the domain, and the top-level label", () => {
    expect(maskEmail("jane.doe@acme.io")).toBe("j***@a***.io");
    expect(maskEmail("j@a.io")).toBe("j***@a**.io");
    expect(maskEmail("jane@verylonghostname.co.uk")).toBe("j***@v********.uk");
    expect(maskEmail("jane@localhost")).toBe("j***@l********");
  });

  test("never shows more of a random address than that", () => {
    for (const local of generatedTexts(200, 821, ALPHANUMERIC, 30)) {
      if (local.length === 0) {
        continue;
      }

      const masked: string = maskEmail(`${local}@acme-mail.com`);

      expect(masked.startsWith(`${local[0]}***@a`)).toBe(true);
      expect(masked.endsWith(".com")).toBe(true);
      expect(alphanumericCount(masked)).toBe(2 + 3);
    }
  });

  test("masks a value with no @ as an ordinary value", () => {
    expect(maskEmail("noatsign")).toBe("******gn");
  });
});

describe("maskCardNumber", () => {
  test("keeps the last four digits only, however the number is written", () => {
    expect(maskCardNumber("4539 1488 0343 6467")).toBe("**** **** **** 6467");
    expect(maskCardNumber("4539-1488-0343-6467")).toBe("**** **** **** 6467");
    expect(maskCardNumber("378282246310005")).toBe("**** **** **** 0005");
    expect(maskValue("credit-card-number", "4539148803436467")).toBe(
      "**** **** **** 6467",
    );
  });
});

describe("maskSecret", () => {
  test("keeps four characters at each end of a long secret, with at most twelve stars between", () => {
    for (const secret of generatedTexts(300, 1601, ALPHANUMERIC, 80)) {
      if (secret.length < 16) {
        continue;
      }

      const masked: string = maskSecret(secret);

      expect(masked).toBe(
        secret.slice(0, 4) +
          "*".repeat(Math.min(secret.length - 8, 12)) +
          secret.slice(-4),
      );
      expect(alphanumericCount(masked)).toBe(8);
    }
  });

  test("keeps two characters of a short secret", () => {
    const secret: string = ["hun", "ter", "2xy"].join("");

    expect(maskSecret(secret)).toBe("hu*******");
  });

  test("shows nothing of a private key but the kind of key it is", () => {
    const body: string = ["MIIEow", "IBAAKCAQEA", "x".repeat(40)].join("");
    const key: string = `-----BEGIN RSA PRIVATE KEY-----\n${body}\n-----END RSA PRIVATE KEY-----`;

    expect(maskSecret(key)).toBe("-----BEGIN RSA PRIVATE KEY----- (hidden)");
    expect(maskValue("private-key", key)).toBe(
      "-----BEGIN RSA PRIVATE KEY----- (hidden)",
    );
    expect(maskSecret("-----BEGIN-----" + body)).toBe(
      "-----BEGIN PRIVATE KEY----- (hidden)",
    );
  });

  test("is how every type of the secrets category is masked", () => {
    const secret: string = ALPHANUMERIC.join("");

    for (const info of DATA_TYPE_CATALOG.filter((type: DataTypeInfo) => {
      return type.category === DataCategory.SecretsAndCredentials;
    })) {
      if (
        info.id === "password-in-url" ||
        info.id === "connection-string-password"
      ) {
        continue;
      }

      expect([info.id, maskValue(info.id, secret)]).toEqual([
        info.id,
        maskSecret(secret),
      ]);
    }
  });
});

describe("credentials in a URL or a connection string", () => {
  const password: string = ["Xk7Qz2", "Lp9Xw4"].join("");

  test("keep everything but the password", () => {
    expect(
      maskCredentialsInText(`postgres://admin:${password}@db.acme.io:5432/app`),
    ).toBe("postgres://admin:****@db.acme.io:5432/app");
    expect(
      maskCredentialsInText(`Server=db;User Id=sa;Password=${password};`),
    ).toBe("Server=db;User Id=sa;Password=****;");
    expect(maskCredentialsInText(`Pwd = ${password}`)).toBe("Pwd = ****");
  });

  test("mask a URL whose user is empty, as Redis writes them", () => {
    expect(
      maskCredentialsInText(`redis://:${password}@cache.acme.io:6379`),
    ).toBe("redis://:****@cache.acme.io:6379");
  });

  test("never put a password a scan found into its sample", () => {
    for (const text of [
      `DATABASE_URL=postgres://admin:${password}@db.acme.io:5432/app`,
      `REDIS_URL=redis://:${password}@cache.acme.io:6379/0`,
      `amqp://guest:${password}@mq.acme.io:5672`,
      `Server=db.acme.io;Database=app;User Id=sa;Password=${password};`,
    ]) {
      const matches: Array<TextMatch> = findSensitiveValues(text);

      expect([text, matches.length > 0]).toEqual([text, true]);

      for (const match of matches) {
        const masked: string = maskValue(
          match.dataTypeId,
          text.slice(match.start, match.end),
        );

        expect([text, match.dataTypeId, masked.includes(password)]).toEqual([
          text,
          match.dataTypeId,
          false,
        ]);
      }
    }
  });

  test("mask a password that is the whole value as a secret", () => {
    expect(maskValue("connection-string-password", password)).toBe(
      maskSecret(password),
    );
  });
});

describe("maskValue", () => {
  test("keeps the network of an IP address, not the host", () => {
    expect(maskValue("ip-address", "81.2.69.142")).toBe("81.***.***.***");
    expect(maskValue("ip-address", "2a00:1450:4001:81b::200e")).toBe(
      "2a00:***:***:***:***:***",
    );
  });

  test("keeps a name-only type's first character", () => {
    expect(maskValue("person-name", "Jane")).toBe("J****");
    expect(maskValue("gender", "female")).toBe("f****");
    expect(maskValue("religious-belief", "x")).toBe("x****");
    expect(maskValue("person-name", "")).toBe("");
  });

  test("keeps the last characters of any other value, and its separators", () => {
    expect(maskValue("us-ssn", "123-45-6789")).toBe("***-**-6789");
    expect(maskValue("phone-number", "+1 (415) 555-2671")).toBe(
      "+* (***) ***-2671",
    );
    expect(maskValue("postal-code", "94105")).toBe("***05");
    expect(maskValue("iban", "DE44500105175407324931")).toBe(
      "******************4931",
    );
    expect(maskValue("custom:employee-id", "EMP-104233")).toBe("***-**4233");
  });

  test("keeps a document's marking as written", () => {
    expect(maskValue("internal-document", "INTERNAL USE ONLY")).toBe(
      "INTERNAL USE ONLY",
    );
  });

  test(`cuts every sample to MAX_MASKED_SAMPLE_LENGTH (${MAX_MASKED_SAMPLE_LENGTH}) with an ellipsis`, () => {
    const marking: string = "Strictly Confidential ".repeat(20);
    const masked: string = maskValue("confidential-document", marking);

    expect(masked).toHaveLength(MAX_MASKED_SAMPLE_LENGTH);
    expect(masked.endsWith("…")).toBe(true);
    expect(
      maskValue("email-address", "a".repeat(600) + "@acme.io"),
    ).toHaveLength(MAX_MASKED_SAMPLE_LENGTH);
  });

  test("never keeps more than four characters of a long value of any value-found type", () => {
    const value: string = ALPHANUMERIC.join("") + "-" + ALPHANUMERIC.join("");

    for (const info of DATA_TYPE_CATALOG) {
      // An IP address keeps its first part, tested above on real addresses.
      if (
        info.foundBy === "name" ||
        info.category === DataCategory.BusinessConfidential ||
        info.id === "ip-address"
      ) {
        continue;
      }

      const masked: string = maskValue(info.id, value);
      // Secrets keep four at each end; everything else four at most.
      const allowed: number =
        info.category === DataCategory.SecretsAndCredentials ? 8 : 4;

      expect([info.id, alphanumericCount(masked) <= allowed]).toEqual([
        info.id,
        true,
      ]);
    }
  });
});
