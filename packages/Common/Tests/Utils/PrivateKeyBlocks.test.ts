import { replacePrivateKeyBlocks } from "../../Utils/PrivateKeyBlocks";
import { generatedTexts } from "../Helpers/GeneratedTexts";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../Helpers/FastestRun";

/*
 * PEM private key blocks, as the log redaction and the AI tool-result
 * serializer remove them: from a BEGIN line to the first END line after it,
 * replaced whole - read in time in line with the text's length, however
 * many BEGIN lines a text holds with no END after them.
 */

const REPLACEMENT: string = "[gone]";
const BODY: string = "MIIEpAIBAAKCAQEA1234567890abcdefZmFrZSBrZXk";

function block(kind: string = "RSA "): string {
  return [
    `-----BEGIN ${kind}PRIVATE KEY-----`,
    BODY,
    `-----END ${kind}PRIVATE KEY-----`,
  ].join("\n");
}

describe("replacePrivateKeyBlocks", () => {
  test("replaces a block whole, header to footer, and keeps the text around it", () => {
    expect(
      replacePrivateKeyBlocks(`key:\n${block()}\nafter`, REPLACEMENT),
    ).toEqual({ text: `key:\n${REPLACEMENT}\nafter`, count: 1 });
  });

  test("takes every kind of key a PEM label names", () => {
    for (const kind of [
      "",
      "RSA ",
      "EC ",
      "DSA ",
      "OPENSSH ",
      "ENCRYPTED ",
      "PGP ",
      "X25519 ",
    ]) {
      expect(replacePrivateKeyBlocks(block(kind), REPLACEMENT)).toEqual({
        text: REPLACEMENT,
        count: 1,
      });
    }
  });

  test("takes a block whose body has headers of its own, dashes included", () => {
    const encrypted: string = [
      "-----BEGIN RSA PRIVATE KEY-----",
      "Proc-Type: 4,ENCRYPTED",
      "DEK-Info: AES-256-CBC,0123456789ABCDEF",
      "",
      BODY,
      "-----END RSA PRIVATE KEY-----",
    ].join("\n");

    expect(replacePrivateKeyBlocks(encrypted, REPLACEMENT)).toEqual({
      text: REPLACEMENT,
      count: 1,
    });
  });

  test("counts and replaces each of several blocks, keeping what lies between them", () => {
    expect(
      replacePrivateKeyBlocks(
        `one ${block()} two ${block("EC ")} three`,
        REPLACEMENT,
      ),
    ).toEqual({
      text: `one ${REPLACEMENT} two ${REPLACEMENT} three`,
      count: 2,
    });
  });

  test("runs to the first footer after a header, other headers between them included", () => {
    expect(
      replacePrivateKeyBlocks(
        `-----BEGIN RSA PRIVATE KEY-----\n${BODY}\n${block()}\ntail`,
        REPLACEMENT,
      ),
    ).toEqual({ text: `${REPLACEMENT}\ntail`, count: 1 });
  });

  test("takes a footer whose kind is not its header's, as it always has", () => {
    expect(
      replacePrivateKeyBlocks(
        `-----BEGIN RSA PRIVATE KEY-----\n${BODY}\n-----END EC PRIVATE KEY-----`,
        REPLACEMENT,
      ),
    ).toEqual({ text: REPLACEMENT, count: 1 });
  });

  test("leaves a header with no footer after it, and everything that is not a private key", () => {
    for (const text of [
      "",
      "no key here",
      `-----BEGIN RSA PRIVATE KEY-----\n${BODY}`,
      `-----END RSA PRIVATE KEY-----\n${BODY}\n-----BEGIN RSA PRIVATE KEY-----`,
      `-----BEGIN CERTIFICATE-----\n${BODY}\n-----END CERTIFICATE-----`,
      `-----BEGIN PUBLIC KEY-----\n${BODY}\n-----END PUBLIC KEY-----`,
      `-----BEGIN rsa private key-----\n${BODY}\n-----END rsa private key-----`,
      // The header's own dashes are not a footer's.
      "-----BEGIN PRIVATE KEY-----END PRIVATE KEY-----",
    ]) {
      expect(replacePrivateKeyBlocks(text, REPLACEMENT)).toEqual({
        text: text,
        count: 0,
      });
    }
  });

  test("takes a header whose block was cut short together with the whole block after it, as one", () => {
    // The first header's footer is the second block's: one block, from the first header.
    expect(
      replacePrivateKeyBlocks(
        `a -----BEGIN PRIVATE KEY----- b ${block()} c`,
        REPLACEMENT,
      ),
    ).toEqual({ text: `a ${REPLACEMENT} c`, count: 1 });
  });

  /*
   * The single pattern the redaction rules used to be. It reads the rest of
   * the text from every header with no footer after it, so it is only run
   * here on short texts.
   */
  const PREVIOUS_PATTERN: RegExp =
    /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----/g;

  test("finds exactly the blocks the pattern it replaces found, on 30,000 generated texts", () => {
    const pieces: Array<string> = [
      "-----BEGIN ",
      "-----END ",
      "PRIVATE KEY-----",
      "PRIVATE ",
      "KEY-----",
      "KEY ",
      "RSA ",
      "EC ",
      "OPENSSH ",
      "-----",
      "----",
      "MIIE",
      "\n",
      " ",
      "a",
      "A",
      "-",
    ];

    const differences: Array<string> = [];

    for (const text of generatedTexts(30000, 4242, pieces, 30)) {
      let count: number = 0;
      const expected: string = text.replace(PREVIOUS_PATTERN, (): string => {
        count++;
        return REPLACEMENT;
      });

      const actual: { text: string; count: number } = replacePrivateKeyBlocks(
        text,
        REPLACEMENT,
      );

      if (actual.text !== expected || actual.count !== count) {
        differences.push(text);
      }
    }

    expect(differences.slice(0, 5)).toEqual([]);
  });

  /*
   * A million characters: the pattern it replaces read 400,000 characters
   * of its worst case in about two seconds, and twice that in four times
   * as long.
   */
  test.each([
    [
      "headers with no footer",
      "-----BEGIN RSA PRIVATE KEY-----".repeat(1000000 / 31),
    ],
    [
      "headers on lines of their own",
      "-----BEGIN PRIVATE KEY-----\n".repeat(1000000 / 28),
    ],
    [
      "headers with footers that never close",
      "-----BEGIN RSA PRIVATE KEY----------END RSA ".repeat(1000000 / 45),
    ],
    [
      "headers of many words",
      "-----BEGIN A B C D E F G H I J K PRIVATE KEY-----".repeat(1000000 / 49),
    ],
    ["one header whose label never ends", `-----BEGIN ${"A ".repeat(500000)}`],
    [
      "one header, then footers that never close",
      `-----BEGIN RSA PRIVATE KEY-----${"-----END A ".repeat(1000000 / 11)}`,
    ],
    ["header starts", "-----BEGIN ".repeat(1000000 / 11)],
    [
      "a block, then headers with no footer",
      `${block()}${"-----BEGIN EC PRIVATE KEY-----".repeat(1000000 / 30)}`,
    ],
    ["dashes", "-".repeat(1000000)],
  ])(
    "reads %s in time in line with its length",
    (_label: string, text: string) => {
      const timed: FastestRun<void> = fastestRun({
        run: (): void => {
          replacePrivateKeyBlocks(text, REPLACEMENT);
        },
        limitInMs: 2000,
      });

      expect(timed.inMs).toBeLessThan(2000);
    },
  );
});
