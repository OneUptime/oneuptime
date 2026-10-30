import { describe, expect, test } from "@jest/globals";
import crypto from "crypto";
import {
  findPlaintextPasswordFields,
  getPasswordValueKind,
  isPasswordFieldName,
  isPasswordHash,
} from "../../../../Server/Utils/DataSecurity/PasswordHashes";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";

/*
 * A PASSWORD COLUMN THAT HOLDS PASSWORDS.
 *
 * Every hash scheme a store is likely to hold is recognized as a hash, and
 * every value a person could have typed is not; a field is reported when
 * its name says password and most of its values are not hashes - with
 * empty values, placeholders, references and flags left out of the count.
 *
 * No hash here is real, and none is written whole: each is put together
 * when the test runs from its scheme's prefix and characters of its
 * alphabet, so no scanner reading this file sees one in it.
 */

const CRYPT64: string =
  "./0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE64: string =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const HEX: string = "0123456789abcdef";

function run(alphabet: string, length: number, from: number = 7): string {
  let text: string = "";

  for (let index: number = 0; index < length; index++) {
    text += alphabet[(from + index * 13) % alphabet.length];
  }

  return text;
}

const HASHES: ReadonlyArray<[string, string]> = [
  ["bcrypt $2b$", `$2b$12$${run(CRYPT64, 53)}`],
  ["bcrypt $2a$", `$2a$10$${run(CRYPT64, 53, 3)}`],
  ["bcrypt $2y$", `$2y$11$${run(CRYPT64, 53, 5)}`],
  [
    "argon2id",
    `$argon2id$v=19$m=65536,t=3,p=4$${run(BASE64, 22)}$${run(BASE64, 43)}`,
  ],
  [
    "argon2i",
    `$argon2i$v=19$m=4096,t=3,p=1$${run(BASE64, 16)}$${run(BASE64, 32)}`,
  ],
  [
    "argon2d without a version",
    `$argon2d$m=4096,t=3,p=1$${run(BASE64, 16)}$${run(BASE64, 32)}`,
  ],
  [
    "scrypt (passlib)",
    `$scrypt$ln=16,r=8,p=1$${run(BASE64, 22)}$${run(BASE64, 43)}`,
  ],
  ["scrypt ($7$)", `$7$${run(CRYPT64, 30)}$${run(CRYPT64, 43)}`],
  ["yescrypt", `$y$j9T$${run(CRYPT64, 22)}$${run(CRYPT64, 43)}`],
  [
    "PBKDF2 (Django)",
    `pbkdf2_sha256$600000$${run(BASE64, 22)}$${run(BASE64, 43)}=`,
  ],
  [
    "PBKDF2 (passlib)",
    `$pbkdf2-sha256$29000$${run(CRYPT64, 22)}$${run(CRYPT64, 43)}`,
  ],
  [
    "argon2 (Django)",
    `argon2$argon2id$v=19$m=102400,t=2,p=8$${run(BASE64, 22)}$${run(BASE64, 22)}`,
  ],
  ["bcrypt_sha256 (Django)", `bcrypt_sha256$$2b$12$${run(CRYPT64, 53)}`],
  ["SHA-256 crypt", `$5$${run(CRYPT64, 16)}$${run(CRYPT64, 43)}`],
  [
    "SHA-512 crypt with rounds",
    `$6$rounds=656000$${run(CRYPT64, 16)}$${run(CRYPT64, 86)}`,
  ],
  ["SHA-512 crypt", `$6$${run(CRYPT64, 8)}$${run(CRYPT64, 86)}`],
  ["MD5 crypt", `$1$${run(CRYPT64, 8)}$${run(CRYPT64, 22)}`],
  ["Apache MD5", `$apr1$${run(CRYPT64, 8)}$${run(CRYPT64, 22)}`],
  ["phpass (WordPress)", `$P$B${run(CRYPT64, 30)}`],
  [
    "Werkzeug PBKDF2",
    `pbkdf2:sha256:600000$${run(BASE64, 16)}$${run(HEX, 64)}`,
  ],
  ["Werkzeug scrypt", `scrypt:32768:8:1$${run(BASE64, 16)}$${run(HEX, 128)}`],
  ["MD5 in hex", run(HEX, 32)],
  ["SHA-1 in hex", run(HEX, 40)],
  ["SHA-256 in hex", run(HEX, 64).toUpperCase()],
  ["SHA-512 in hex", run(HEX, 128)],
  ["MD5 in base64", crypto.createHash("md5").update("a").digest("base64")],
  ["SHA-1 in base64", crypto.createHash("sha1").update("a").digest("base64")],
  [
    "SHA-256 in base64",
    crypto.createHash("sha256").update("a").digest("base64"),
  ],
  [
    "SHA-512 in base64",
    crypto.createHash("sha512").update("a").digest("base64"),
  ],
  ["MySQL native", `*${run(HEX, 40).toUpperCase()}`],
  ["PostgreSQL md5", `md5${run(HEX, 32)}`],
  [
    "PostgreSQL SCRAM",
    `SCRAM-SHA-256$4096:${run(BASE64, 24)}$${run(BASE64, 44)}:${run(BASE64, 44)}`,
  ],
  ["SQL Server", `0x0200${run(HEX, 136).toUpperCase()}`],
  ["LDAP SSHA", `{SSHA}${run(BASE64, 32)}`],
  ["LDAP crypt", `{CRYPT}$6$${run(CRYPT64, 8)}$${run(CRYPT64, 86)}`],
  ["a locked account's hash", `!$6$${run(CRYPT64, 8)}$${run(CRYPT64, 86)}`],
];

const NOT_HASHES: ReadonlyArray<[string, string]> = [
  ["a short password", "hunter2"],
  ["a passphrase", "correct horse battery staple"],
  ["a password with symbols", "Summer2024!"],
  ["hex one short of MD5", run(HEX, 31)],
  ["a bcrypt prefix and too little", `$2b$12$${run(CRYPT64, 20)}`],
  ["an unknown $-scheme", `$9$${run(CRYPT64, 22)}`],
  ["LDAP cleartext", "{CLEARTEXT}open-sesame"],
  ["Werkzeug's plain method", "plain$$open-sesame"],
  ["far too long to be a hash", "a".repeat(5000)],
  ["empty", ""],
];

describe("isPasswordHash", () => {
  test.each(HASHES)("knows %s as a hash", (_label: string, value: string) => {
    expect(isPasswordHash(value)).toBe(true);
  });

  test.each(NOT_HASHES)(
    "does not take %s for a hash",
    (_label: string, value: string) => {
      expect(isPasswordHash(value)).toBe(false);
    },
  );

  test("is false for anything that is not text", () => {
    expect(isPasswordHash(42)).toBe(false);
    expect(isPasswordHash(null)).toBe(false);
    expect(isPasswordHash({ hash: run(HEX, 64) })).toBe(false);
  });

  test("reads a megabyte of one character at once: the patterns never see it", () => {
    const dollars: string = "$".repeat(1024 * 1024);
    const pairs: string = "a$".repeat(512 * 1024);
    const timed: FastestRun<Array<boolean>> = fastestRun({
      run: (): Array<boolean> => {
        return [isPasswordHash(dollars), isPasswordHash(pairs)];
      },
      limitInMs: 1000,
    });

    expect(timed.result).toEqual([false, false]);
    expect(timed.inMs).toBeLessThan(1000);
  });
});

describe("isPasswordFieldName", () => {
  test.each([
    "password",
    "user_password",
    "passwordHash",
    "password_hash",
    "hashed_password",
    "encrypted_password",
    "password_digest",
    "pwd",
    "unicodePwd",
    "DB_PASSWORD",
    "spring.datasource.password",
    "pass_hash",
    "pass",
    "pw",
    "password2",
    "password_confirmation",
    "userPassword",
    "passwd",
    "credentials.password",
    "public.users.password",
    "Sheet1.Password",
  ])("reads %s as holding a password", (name: string) => {
    expect(isPasswordFieldName(name)).toBe(true);
  });

  test.each([
    "password_changed_at",
    "password_reset_token",
    "password_hint",
    "passwordExpiresAt",
    "pwdLastSet",
    "last_password_change",
    "boarding_pass",
    "passport_number",
    "compass",
    "bypass",
    "email",
    "pass_count",
  ])("does not read %s as holding a password", (name: string) => {
    expect(isPasswordFieldName(name)).toBe(false);
  });
});

describe("getPasswordValueKind", () => {
  test.each([
    ["", "empty"],
    ["   ", "empty"],
    ["********", "placeholder"],
    ["!", "placeholder"],
    ["x", "placeholder"],
    ["REDACTED", "placeholder"],
    ["${DB_PASSWORD}", "placeholder"],
    ["{{ vault_db_password }}", "placeholder"],
    ["%DB_PASSWORD%", "placeholder"],
    ["$DB_PASSWORD", "placeholder"],
    ["ENC(J1x9Qx8z)", "placeholder"],
    ["vault:secret/data/db#password", "placeholder"],
    ["true", "placeholder"],
    ["hunter2", "plaintext"],
  ])("reads %p as %s", (value: string, kind: string) => {
    expect(getPasswordValueKind(value)).toBe(kind);
  });

  test("reads a hash as a hash, bytes as a stored digest, and flags as not passwords", () => {
    expect(getPasswordValueKind(HASHES[0]![1])).toBe("hash");
    expect(getPasswordValueKind(new Uint8Array([1, 2, 3]))).toBe("hash");
    expect(getPasswordValueKind(null)).toBe("empty");
    expect(getPasswordValueKind(true)).toBe("placeholder");
    expect(getPasswordValueKind(1234)).toBe("placeholder");
  });

  test("reads a long opaque token as encrypted, not as a password someone chose", () => {
    expect(getPasswordValueKind(`eyJpdiI6Ik${run(BASE64, 60)}9`)).toBe(
      "encrypted",
    );
  });
});

describe("findPlaintextPasswordFields", () => {
  const hashes: Array<string> = HASHES.slice(0, 8).map(
    (entry: [string, string]) => {
      return entry[1];
    },
  );

  test("reports a password field whose values are mostly not hashes", () => {
    expect(
      findPlaintextPasswordFields([
        {
          path: "public.users.password",
          values: ["hunter2", "letmein", "Summer2024!", hashes[0], null, ""],
        },
      ]),
    ).toEqual(["public.users.password"]);
  });

  test("leaves a password field of hashes alone", () => {
    expect(
      findPlaintextPasswordFields([
        { path: "users.password_hash", values: [...hashes, "hunter2"] },
      ]),
    ).toEqual([]);
  });

  test("counts no placeholder, reference, flag or empty value", () => {
    expect(
      findPlaintextPasswordFields([
        {
          path: "DB_PASSWORD",
          values: ["${DB_PASSWORD}", "********", "", null, "REDACTED"],
        },
        { path: "must_change_password", values: [true, false, "false"] },
      ]),
    ).toEqual([]);
  });

  test("needs more passwords than hashes: a tie is not mostly", () => {
    expect(
      findPlaintextPasswordFields([
        { path: "password", values: ["hunter2", hashes[1]] },
      ]),
    ).toEqual([]);
  });

  test("reads only fields named for passwords", () => {
    expect(
      findPlaintextPasswordFields([
        { path: "nickname", values: ["hunter2", "letmein"] },
        { path: "password_changed_at", values: ["2026-10-01", "2026-10-02"] },
        { path: "pwd", values: ["letmein"] },
      ]),
    ).toEqual(["pwd"]);
  });
});
