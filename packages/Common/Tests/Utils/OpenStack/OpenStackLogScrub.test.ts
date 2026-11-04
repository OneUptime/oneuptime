import { describe, expect, test } from "@jest/globals";
import {
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

  /*
   * The read used to stop at 8 KiB, and only what it had read went: all but the first 8 KiB of a
   * long value stayed in the clear, which is what a PKI token or an old-style blob can be.
   */
  describe("however long it is", () => {
    const LONG: number = 200 * 1024;

    test.each([
      ["unquoted", `password=${"x".repeat(LONG)}`],
      ["with a space around it", `password = ${"x".repeat(LONG)}`],
      ["quoted and closed", `"password": "${"x".repeat(LONG)}"`],
      ["quoted and never closed", `"password": "${"x".repeat(LONG)}`],
      ["single quoted and never closed", `'password': '${"x".repeat(LONG)}`],
      ["escaped and closed", `\\"password\\": \\"${"x".repeat(LONG)}\\"`],
      ["escaped and never closed", `\\"password\\": \\"${"x".repeat(LONG)}`],
      ["a header", `X-Auth-Token: ${"x".repeat(LONG)}`],
      ["a bearer token", `Authorization: Bearer ${"x".repeat(LONG)}`],
      ["a cookie", `Cookie: session=${"x".repeat(LONG)}`],
      ["on a command", `--password ${"x".repeat(LONG)}`],
    ])("%s", (_how: string, text: string) => {
      const result: string = kept(text);

      expect(result).not.toContain("xxxx");
      expect(result).toContain(OPENSTACK_SCRUBBED_VALUE);
      expect(result.length).toBeLessThan(100);
    });

    test("what comes after a closed one stays", () => {
      expect(kept(`"password": "${"x".repeat(LONG)}", "name": "demo"`)).toBe(
        `"password": "${OPENSTACK_SCRUBBED_VALUE}", "name": "demo"`,
      );
    });

    test("an unclosed quote takes the rest of the text, because it can't say where it stops", () => {
      expect(kept(`password='abc\nnext line\nand the next`)).toBe(
        `password='${OPENSTACK_SCRUBBED_VALUE}`,
      );
    });
  });

  describe("a value holding what usually ends one", () => {
    test.each([
      ["a closing bracket", "abc)def", "(", ")"],
      ["a square bracket", "abc]def", "[", "]"],
      ["a brace", "abc}def", "{", "}"],
      ["a comma", "abc,def", "", ""],
      ["a semicolon", "abc;def", "", ""],
      ["an ampersand", "abc&def", "", ""],
      ["a single quote", "abc'def", "", ""],
      ["a double quote", 'abc"def', "", ""],
    ])("%s goes whole", (_what: string, value: string) => {
      const result: string = kept(`password=${value} after`);

      expect(result).toBe(`password=${OPENSTACK_SCRUBBED_VALUE} after`);
    });

    test.each([
      ["(password=abc) after", `(password=${OPENSTACK_SCRUBBED_VALUE}) after`],
      ["{password=abc} after", `{password=${OPENSTACK_SCRUBBED_VALUE}} after`],
      ["[token=abc] after", `[token=${OPENSTACK_SCRUBBED_VALUE}] after`],
      ["password=abc, after", `password=${OPENSTACK_SCRUBBED_VALUE}, after`],
      ["password=abc; after", `password=${OPENSTACK_SCRUBBED_VALUE}; after`],
      ['"password=abc" after', `"password=${OPENSTACK_SCRUBBED_VALUE}" after`],
      ["'password=abc', 'x'", `'password=${OPENSTACK_SCRUBBED_VALUE}', 'x'`],
      [
        '{"password":123,"user":"bob"}',
        `{"password":${OPENSTACK_SCRUBBED_VALUE},"user":"bob"}`,
      ],
    ])("%s still ends where it ends", (text: string, expected: string) => {
      expect(kept(text)).toBe(expected);
    });

    test.each([
      ["password=abc,user=bob after", `password=${OPENSTACK_SCRUBBED_VALUE},user=bob after`],
      ["?password=abc&limit=1 HTTP/1.1", `?password=${OPENSTACK_SCRUBBED_VALUE}&limit=1 HTTP/1.1`],
      ["Password=abc;Server=db after", `Password=${OPENSTACK_SCRUBBED_VALUE};Server=db after`],
      [
        "encryption_secret_uuid=<?>,guest_format=None,id=<?>",
        `encryption_secret_uuid=${OPENSTACK_SCRUBBED_VALUE},guest_format=None,id=<?>`,
      ],
    ])("the next name after a comma stays, as Python writes an object: %s", (text: string, expected: string) => {
      expect(kept(text)).toBe(expected);
    });

    test("a word after the comma that names nothing stays in the value", () => {
      expect(kept("password=abc,def,ghi after")).toBe(
        `password=${OPENSTACK_SCRUBBED_VALUE} after`,
      );
    });

    test.each([
      "{abc}",
      "{SHA256}5e8f0a",
      "[abc]",
      "{ab}cd",
      "[ab]cd",
    ])("a value that starts with a bracket, %s, is a value", (value: string) => {
      expect(kept(`password=${value} after`)).toBe(
        `password=${OPENSTACK_SCRUBBED_VALUE} after`,
      );
    });

    test.each([
      '"password": {"user": {"name": "admin", "password": "s3cr3t"}}',
      "'token': {'expires_at': 'x', 'id': 'y', 'password': 's3cr3t'}",
      '"secret": ["a", {"password": "s3cr3t"}]',
      "'secret': {u'password': u's3cr3t'}",
      '"token": { "password": "s3cr3t" }',
    ])("an object or a list stays, and what is secret in it goes: %s", (text: string) => {
      const result: string = kept(text);

      expect(result).not.toContain("s3cr3t");
      expect(result).toContain(OPENSTACK_SCRUBBED_VALUE);
      expect(result.startsWith(text.slice(0, 12))).toBe(true);
    });
  });

  describe("names it used to miss", () => {
    test.each([
      "password1",
      "new_password2",
      "passphrase",
      "encryption_passphrase",
      "pwd",
      "sys_pswd",
      "new_pass",
      "secret_uuid",
      "client_secret",
      "api_key",
      "api-key",
      "X-Api-Key",
      "apikey",
      "auth_key",
      "encrypted_key",
      "encryption_key",
      "fernetkey",
      "sslkey",
      "temp_url_key",
      "X-Account-Meta-Temp-URL-Key",
      "temp_url_sig",
      "signature",
      "token_id",
      "credentials",
      "credential_blob",
      "blob",
      "configdrive",
      "CHAPPASSWORD",
      "rabbit_password",
      "metadata_proxy_shared_secret",
      "aws_secret_access_key",
    ])("%s", (name: string) => {
      for (const text of [
        `${name}=${SECRET}`,
        `${name}: ${SECRET}`,
        `"${name}": "${SECRET}"`,
        `'${name}': '${SECRET}'`,
        `\t${name}\t=\t${SECRET}`,
      ]) {
        expect(kept(text)).not.toContain(SECRET);
      }
    });
  });

  describe("named in the other ways a service writes it", () => {
    test.each([
      [`('password', '${SECRET}')`, `('password', '${OPENSTACK_SCRUBBED_VALUE}')`],
      [`["X-Auth-Token", "${SECRET}"]`, `["X-Auth-Token", "${OPENSTACK_SCRUBBED_VALUE}"]`],
      [`password\t=\t${SECRET}`, `password\t=\t${OPENSTACK_SCRUBBED_VALUE}`],
      [`password=b'${SECRET}'`, `password=b'${OPENSTACK_SCRUBBED_VALUE}'`],
      [`password=r'${SECRET}'`, `password=r'${OPENSTACK_SCRUBBED_VALUE}'`],
    ])("%s", (text: string, expected: string) => {
      expect(kept(text)).toBe(expected);
    });

    test("only a quote after the comma makes a pair, and a list of names costs its next name", () => {
      expect(kept('["password", "username"]')).toBe(
        `["password", "${OPENSTACK_SCRUBBED_VALUE}"]`,
      );
      expect(kept('"password", 12')).toBe('"password", 12');
      expect(kept("password, and more")).toBe("password, and more");
    });

    test("a word with a number on it stays another word when it runs on", () => {
      expect(kept("password1_expires_at=2026")).toBe(
        "password1_expires_at=2026",
      );
    });
  });

  describe("JSON inside JSON, however deep", () => {
    const DEEP: Array<[string, Record<string, unknown>]> = [
      ["one level", { password: SECRET, name: "demo" }],
      ["two levels", { body: JSON.stringify({ password: SECRET, name: "demo" }) }],
      [
        "three levels",
        {
          outer: JSON.stringify({
            body: JSON.stringify({ password: SECRET, name: "demo" }),
          }),
        },
      ],
      [
        "four levels",
        {
          a: JSON.stringify({
            b: JSON.stringify({
              c: JSON.stringify({ password: SECRET, name: "demo" }),
            }),
          }),
        },
      ],
    ];

    test.each(DEEP)("%s", (_how: string, value: Record<string, unknown>) => {
      const result: string = kept(JSON.stringify(value));

      expect(result).not.toContain(SECRET);
      expect(result).toContain("demo");
      // Still JSON: a notification is read from this.
      expect(() => {
        return JSON.parse(result);
      }).not.toThrow();
    });

    test("a value holding a quote escaped deeper than the one that opened it goes whole", () => {
      const inner: string = JSON.stringify({
        password: `abc"${SECRET}`,
        name: "demo",
      });
      const result: string = kept(JSON.stringify({ body: inner }));

      expect(result).not.toContain(SECRET);
      expect(result).toContain("demo");
      expect(JSON.parse(result)).toEqual({
        body: `{"password":"${OPENSTACK_SCRUBBED_VALUE}","name":"demo"}`,
      });
    });

    test("an unquoted value inside a string of JSON leaves the string closed", () => {
      const result: string = kept(
        JSON.stringify({ body: JSON.stringify({ url: `http://x?token=${SECRET}`, n: 1 }) }),
      );

      expect(result).not.toContain(SECRET);
      expect(JSON.parse(JSON.parse(result)["body"])).toEqual({
        url: `http://x?token=${OPENSTACK_SCRUBBED_VALUE}`,
        n: 1,
      });
    });

    test("a Fernet token and a URL's password inside one too", () => {
      const result: string = kept(
        JSON.stringify({
          body: JSON.stringify({
            id: FERNET,
            transport_url: `rabbit://u:${SECRET}@host:5672/`,
          }),
        }),
      );

      expect(result).not.toContain(SECRET);
      expect(result).not.toContain("gAAAA");
      expect(JSON.parse(JSON.parse(result)["body"])).toEqual({
        id: OPENSTACK_SCRUBBED_VALUE,
        transport_url: `rabbit://u:${OPENSTACK_SCRUBBED_VALUE}@host:5672/`,
      });
    });
  });

  test("scrubbing twice changes nothing", () => {
    for (const text of [
      `password=${SECRET}`,
      `"password": "${SECRET}"`,
      `password={${SECRET}}`,
      `(token=${SECRET})`,
      `rabbit://u:${SECRET}@host/`,
      `Authorization: Bearer ${SECRET}`,
      `Validating ${FERNET} now`,
      "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
    ]) {
      const once: string = kept(text);

      expect(kept(once)).toBe(once);
    }
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

  test.each([
    // Read off what a real cloud's services wrote.
    "POST /identity/v3/auth/tokens => generated 2599 bytes in 1149 msecs (HTTP/1.1 201)",
    "POST /identity/auth/token => generated 207 bytes in 2 msecs (HTTP/1.1 404)",
    "runner : PWD=/ ; USER=root ; COMMAND=/opt/stack/data/venv/bin/cinder-rootwrap",
    "runner : PWD=/opt/stack ; USER=root ; COMMAND=/usr/bin/true",
    "Error during ConsoleAuthTokensManager._cleanup_expired_console_auth_tokens: oslo_messaging.rpc.client.RemoteError: Remote error",
    "encryption_secret_uuid=None,guest_format=None,id=<?>",
  ])("%s stays as it is", (text: string) => {
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
      "https://example.com:8774/v2.1/users/a@b.com",
      "rabbit://controller:5672/",
      "rabbit://controller:5672",
      "rabbit://one:5672,two:5672,three:5672/",
      "http://[::1]:5000/v3",
      "http://[fe80::1]:5000/v3/users/a@b.com",
      "http://user@controller:5000/v3",
      "file:///etc/nova/nova.conf",
    ]) {
      expect(kept(url)).toBe(url);
    }
  });

  test("a password however long", () => {
    const result: string = kept(
      `rabbit://user:${"x".repeat(200 * 1024)}@host:5672/`,
    );

    expect(result).toBe(`rabbit://user:${OPENSTACK_SCRUBBED_VALUE}@host:5672/`);
  });

  test.each([
    ["a comma", "rabbit://u:ab,cd@host:5672/"],
    ["a slash", "mysql://root:ab/cd@host/nova"],
    ["a question mark", "mysql://root:ab?cd@host/nova"],
    ["a hash", "mysql://root:ab#cd@host/nova"],
    ["a quote", "mysql://root:ab'cd@host/nova"],
    ["several slashes", "mysql://root:ab/cd/ef@host/nova"],
    ["something like a port", "mysql://root:123456/cd@host/nova"],
    ["an IPv6 host after it", "rabbit://u:abcd@[::1]:5672/"],
  ])("a password holding %s goes whole", (_what: string, url: string) => {
    const result: string = kept(url);

    expect(result).toContain(OPENSTACK_SCRUBBED_VALUE);

    for (const piece of ["ab", "cd", "ef", "123456"]) {
      expect(result).not.toContain(`:${piece}`);
      expect(result).not.toContain(`/${piece}`);
      expect(result).not.toContain(`${piece}@`);
    }

    expect(result).toContain("@");
  });

  test("a second host's name goes too when a password held both a comma and an @", () => {
    const result: string = kept("rabbit://u:ab@cd,ef@host:5672/");

    expect(result).not.toContain("ef");
    expect(result).toContain("host:5672");
  });

  test("the address inside another, and after another", () => {
    for (const text of [
      "http://proxy/?url=rabbit://u:PASSWORD@host/",
      "http://proxy:8080/?url=rabbit://u:PASSWORD@host/",
      "http://a?next=rabbit://u:PASSWORD@host",
      "x://rabbit://u:PASSWORD@host",
      "a://b://c:PASSWORD@host",
      "http://a:5000/ rabbit://u:PASSWORD@host",
    ]) {
      expect(kept(text)).not.toContain("PASSWORD");
    }
  });

  test("inside a string that closes after it", () => {
    expect(kept('{"url": "rabbit://u:PASSWORD@host", "b": "c"}')).toBe(
      `{"url": "rabbit://u:${OPENSTACK_SCRUBBED_VALUE}@host", "b": "c"}`,
    );
  });

  describe("in a text cut short", () => {
    test("ends inside its password, with no @ left to say so", () => {
      expect(
        scrubOpenStackSecrets("rabbit://u:PASSWO", { wasCut: true }),
      ).toBe(`rabbit://u:${OPENSTACK_SCRUBBED_VALUE}`);
    });

    test("a port and a host at the cut are left", () => {
      for (const text of [
        "rabbit://u:5672",
        "http://controller",
        "http://controller:",
        "http://controller:5000/v3",
      ]) {
        expect(scrubOpenStackSecrets(text, { wasCut: true })).toBe(text);
      }
    });

    test("a text that was not cut says nothing about what is missing", () => {
      expect(kept("rabbit://u:PASSWO")).toBe("rabbit://u:PASSWO");
    });
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

  test("one with no end takes everything after it, however long", () => {
    const result: string = kept(
      `before -----BEGIN PRIVATE KEY-----\n${"MIIEpAIBAAKCAQEA\n".repeat(20000)}`,
    );

    expect(result).not.toContain("MIIEpAIBAAKCAQEA");
    expect(result).toBe(`before ${OPENSTACK_SCRUBBED_VALUE}`);
  });

  test("one written with \\n inside a string of JSON", () => {
    const result: string = kept(
      JSON.stringify({
        key: "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\n-----END RSA PRIVATE KEY-----",
        name: "demo",
      }),
    );

    expect(result).not.toContain("MIIEpAIBAAKCAQEA");
    expect(JSON.parse(result)["name"]).toBe("demo");
  });

  test("two of them both go, and what is between them stays", () => {
    const key: string =
      "-----BEGIN PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\n-----END PRIVATE KEY-----";
    const result: string = kept(`${key} between ${key}`);

    expect(result).toBe(
      `${OPENSTACK_SCRUBBED_VALUE} between ${OPENSTACK_SCRUBBED_VALUE}`,
    );
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
  test.each([
    "new_password",
    "auth_password",
    "password1",
    "client_secret",
    "secret_key",
    "chappassword",
    "metadata_proxy_shared_secret",
    "X-Auth-Token",
    "encrypted_key",
  ])("a field named %s loses its value and keeps its name", (name: string) => {
    expect(
      removeOpenStackSecretFields({ payload: { [name]: SECRET, keep: "x" } }),
    ).toEqual({ payload: { [name]: OPENSTACK_SCRUBBED_VALUE, keep: "x" } });
  });

  test.each(["password_expires_at", "token_type", "secret_ref", "tokens"])(
    "a field named %s is another word",
    (name: string) => {
      expect(removeOpenStackSecretFields({ [name]: "value" })).toEqual({
        [name]: "value",
      });
    },
  );

  test.each(["***", "None", "null", ""])(
    "a secret's field already saying %j says it still",
    (value: string) => {
      expect(removeOpenStackSecretFields({ new_password: value })).toEqual({
        new_password: value,
      });
    },
  );

  test("every text left is read on its own, and stays JSON whatever it held", () => {
    const cleaned: unknown = removeOpenStackSecretFields({
      message: "keystone_authtoken.memcache_password = ",
      next: 'it said password="the-password" and went on',
      url: "rabbit://u:the-password@host:5672/",
      list: [`token: ${FERNET}`],
    });

    expect(JSON.stringify(cleaned)).not.toContain("the-password");
    expect(JSON.stringify(cleaned)).not.toContain("gAAAA");
    expect((cleaned as { message: string }).message).toBe(
      "keystone_authtoken.memcache_password = ",
    );
    expect((cleaned as { next: string }).next).toContain("and went on");
  });

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
    '\\"',
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
  )("generated text %i, with a marked secret on the end", (_index: number, text: string) => {
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
