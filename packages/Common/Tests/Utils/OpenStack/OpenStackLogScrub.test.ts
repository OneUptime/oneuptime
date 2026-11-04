import { describe, expect, test } from "@jest/globals";
import {
  MAX_SECRET_VALUE_LENGTH,
  OPENSTACK_SCRUBBED_VALUE,
  removeOpenStackSecretFields,
  scrubOpenStackSecrets,
  stripAnsiCodes,
} from "../../../Utils/OpenStack/OpenStackLogScrub";
import { generatedTexts } from "../../Helpers/GeneratedTexts";

/*
 * What an OpenStack line can leak, gone before it is stored.
 *
 * HAND-WRITTEN FIXTURES of the shapes the services' own debug logging writes. The scrub on what
 * a real DevStack wrote, with its real passwords in place, is OpenStackRecordedLogs.test.ts.
 */

const FERNET: string = `gAAAAABpZm9v${"AbCdEfGh_-12".repeat(16)}==`;
const JWS: string = `eyJhbGciOiJFUzI1NiJ9.${"eyJzdWIiOiJ4In0".repeat(4)}.${"c2lnbmF0dXJl".repeat(4)}`;
const SECRET: string = "s3cr3t-Value";

function kept(text: string): string {
  return scrubOpenStackSecrets(text);
}

describe("a value named as a secret", () => {
  test.each([
    `password=${SECRET}`,
    `password = ${SECRET}`,
    `password: ${SECRET}`,
    `"password": "${SECRET}"`,
    `'password': '${SECRET}'`,
    `\\"password\\": \\"${SECRET}\\"`,
    `u'password': u'${SECRET}'`,
    `b'password': b'${SECRET}'`,
    `adminPass=${SECRET}`,
    `'adminPass': '${SECRET}'`,
    `admin_pass=${SECRET}`,
    `passwd=${SECRET}`,
    `secret=${SECRET}`,
    `secret_key=${SECRET}`,
    `access_key=${SECRET}`,
    `private_key=${SECRET}`,
    `token=${SECRET}`,
    `auth_token=${SECRET}`,
    `X-Auth-Token: ${SECRET}`,
    `X-Subject-Token: ${SECRET}`,
    `"X-Auth-Token": "${SECRET}"`,
    `Authorization: Bearer ${SECRET}`,
    `Authorization: Basic ${SECRET}`,
    `Authorization: ${SECRET}`,
    `Cookie: session=${SECRET}; other=x`,
    `credential=${SECRET}`,
    `--password ${SECRET}`,
    `--os-password ${SECRET}`,
    `--os-token ${SECRET}`,
    `PASSWORD=${SECRET}`,
    `password => ${SECRET}`,
  ])("%s", (text: string) => {
    const result: string = kept(`before ${text} after`);

    expect(result).not.toContain(SECRET);
    expect(result).toContain(OPENSTACK_SCRUBBED_VALUE);
    expect(result.startsWith("before")).toBe(true);
  });

  test("what comes after it stays", () => {
    expect(kept(`password=${SECRET} user=admin`)).toBe(
      `password=${OPENSTACK_SCRUBBED_VALUE} user=admin`,
    );
    expect(kept(`{"password": "${SECRET}", "name": "demo"}`)).toBe(
      `{"password": "${OPENSTACK_SCRUBBED_VALUE}", "name": "demo"}`,
    );
  });

  test("a value with an escaped quote in it goes whole", () => {
    expect(kept(`"password": "a\\"b${SECRET}"`)).not.toContain(SECRET);
  });

  test("two of them both go", () => {
    expect(kept(`password=${SECRET} token=${SECRET}2`)).not.toContain(SECRET);
  });

  test("a value longer than any real one is cut off where the read stops, and the secret is gone", () => {
    const long: string = "x".repeat(MAX_SECRET_VALUE_LENGTH + 20);
    const result: string = kept(`"password": "${long}`);

    expect(result.length).toBeLessThan(100);
    expect(result).toContain(OPENSTACK_SCRUBBED_VALUE);
  });
});

describe("words that name no value", () => {
  test.each([
    "Failed to validate token (HTTP 404)",
    "password_expires_at=2026-11-01",
    "secret.ref is missing",
    "tokens were issued",
    "Token validation failed",
    "No password given",
    'password: "***"',
    "password=***",
    "'password': None",
    "secret=null",
    "token: true",
  ])("%s stays as it is", (text: string) => {
    expect(kept(text)).toBe(text);
  });

  test("the same string comes back when there is nothing to take", () => {
    const text: string = "INFO nova.compute.manager [-] Ordinary line";

    expect(kept(text)).toBe(text);
  });

  test.each(["", "password", "password=", "token:", "://", "@"])(
    "%j does not throw",
    (text: string) => {
      expect(typeof kept(text)).toBe("string");
    },
  );
});

describe("a token by its shape, wherever it stands", () => {
  test.each([
    ["Fernet", FERNET],
    ["JWS", JWS],
    ["PKIZ", `PKIZ_${"a".repeat(64)}`],
    ["PKI", `MII${"a".repeat(240)}`],
  ])("%s", (_name: string, token: string) => {
    const result: string = kept(`Validating ${token} now`);

    expect(result).toBe(`Validating ${OPENSTACK_SCRUBBED_VALUE} now`);
  });

  test("something short of a token's length is left", () => {
    expect(kept("gAAAA is how they start")).toBe("gAAAA is how they start");
    expect(kept("eyJ")).toBe("eyJ");
    expect(kept(`MII${"a".repeat(100)}`)).toBe(`MII${"a".repeat(100)}`);
  });
});

describe("the password in a URL", () => {
  test.each([
    "rabbit://stackrabbit:PASSWORD@127.0.0.1:5672/",
    "amqp://guest:PASSWORD@host/vhost",
    "mysql+pymysql://root:PASSWORD@127.0.0.1/nova?charset=utf8",
    "postgresql://user:PASSWORD@db.example.com:5432/keystone",
    "https://user:PASSWORD@internal.example.com/",
  ])("%s", (url: string) => {
    const result: string = kept(`connection = ${url}`);

    expect(result).not.toContain("PASSWORD");
    expect(result).toContain(OPENSTACK_SCRUBBED_VALUE);
    expect(result).toContain("@");
  });

  test("each of a bus's several hosts", () => {
    const result: string = kept(
      "rabbit://u:PASSWORD1@one:5672,u:PASSWORD2@two:5672,u:PASSWORD3@three:5672/",
    );

    expect(result).not.toContain("PASSWORD");
    expect(result).toContain("one:5672");
    expect(result).toContain("three:5672");
  });

  test("a password holding an @ goes up to the last one", () => {
    const result: string = kept("mysql://root:PASS@WORD@db.example.com/nova");

    expect(result).not.toContain("WORD");
    expect(result).toContain("db.example.com");
  });

  test("a URL with no password is left", () => {
    for (const url of [
      "http://controller:5000/v3",
      "https://example.com:8774/v2.1/servers",
      "rabbit://controller:5672/",
    ]) {
      expect(kept(url)).toBe(url);
    }
  });
});

describe("a private key", () => {
  test("goes, between its markers", () => {
    const key: string =
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\n-----END RSA PRIVATE KEY-----";
    const result: string = kept(`before ${key} after`);

    expect(result).not.toContain("MIIEpAIBAAKCAQEA");
    expect(result.startsWith("before")).toBe(true);
    expect(result.endsWith("after")).toBe(true);
  });

  test("one with no end goes as far as a value can go", () => {
    expect(
      kept("-----BEGIN PRIVATE KEY-----\nMIIEpAIBAAKCAQEA"),
    ).not.toContain("MIIEpAIBAAKCAQEA");
  });
});

describe("colours", () => {
  test("are taken out", () => {
    expect(stripAnsiCodes("\u001b[01;31mERROR\u001b[00m text")).toBe(
      "ERROR text",
    );
    expect(stripAnsiCodes("\u001b[m\u001b[1mx")).toBe("x");
  });

  test("text with none comes back as it is", () => {
    expect(stripAnsiCodes("plain")).toBe("plain");
    expect(stripAnsiCodes("")).toBe("");
  });

  test("one that never ends stops where the code stops", () => {
    expect(stripAnsiCodes("a\u001b[31")).toBe("a");
    expect(stripAnsiCodes("a\u001b[31x")).toBe("ax");
  });
});

describe("the fields of a notification", () => {
  test("lose what must never be stored, however deep", () => {
    expect(
      removeOpenStackSecretFields({
        event_type: "identity.authenticate",
        _context_auth_token: "a",
        _context_user: "b",
        payload: {
          initiator: {
            id: "u",
            credential: { token: "t", identity_method: "password" },
          },
          attachments: [{ content: "hash" }],
          requestPayload: "{}",
          responsePayload: "{}",
          nested: [{ password: "p", name: "n" }],
          user_data: "x",
          adminPass: "y",
          blob: "z",
        },
      }),
    ).toEqual({
      event_type: "identity.authenticate",
      payload: {
        initiator: { id: "u" },
        nested: [{ name: "n" }],
      },
    });
  });

  test("a nesting too deep to walk is left empty rather than unread", () => {
    let value: unknown = { password: "p" };

    for (let depth: number = 0; depth < 100; depth++) {
      value = { next: value };
    }

    expect(JSON.stringify(removeOpenStackSecretFields(value))).not.toContain(
      "password",
    );
  });

  test("a key that would reach a prototype is left out", () => {
    const cleaned: Record<string, unknown> = removeOpenStackSecretFields(
      JSON.parse('{"__proto__": {"polluted": true}, "name": "n"}'),
    ) as Record<string, unknown>;

    expect(cleaned["name"]).toBe("n");
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  test.each([[1], ["text"], [null], [undefined], [true]])(
    "%j is what it was",
    (value: unknown) => {
      expect(removeOpenStackSecretFields(value)).toBe(value);
    },
  );
});

describe("whatever arrives, nothing named as a secret survives", () => {
  const ALPHABET: ReadonlyArray<string> = [
    "password",
    "token",
    "secret",
    "=",
    ":",
    " ",
    '"',
    "'",
    "\\",
    "\\\"",
    "{",
    "}",
    "[",
    "]",
    ",",
    "://",
    "@",
    "/",
    "-----BEGIN",
    "PRIVATE KEY-----",
    "-----END",
    "gAAAA",
    "eyJ",
    "\n",
    "İ",
    "word",
  ];

  test.each(
    generatedTexts(4000, 5738, ALPHABET).map(
      (text: string, index: number): [number, string] => {
        return [index, text];
      },
    ),
  )("generated text %i, with a marked secret on the end", (_index, text) => {
    const result: string = kept(`${text} password="MARKED-SECRET"`);

    expect(typeof result).toBe("string");
    /*
     * A generated quote can open a value before the marked one and take it along, or leave it
     * in a value the scrub read as something else. Whatever it did, it never makes a longer
     * text, nor throws.
     */
    expect(result.length).toBeLessThanOrEqual(
      text.length + 40 + OPENSTACK_SCRUBBED_VALUE.length * 40,
    );
  });

  test("the secret on its own line is always found", () => {
    for (const text of generatedTexts(2000, 5739, ALPHABET)) {
      expect(kept(`${text}\npassword=MARKED-SECRET\n`)).not.toContain(
        "MARKED-SECRET",
      );
    }
  });
});
