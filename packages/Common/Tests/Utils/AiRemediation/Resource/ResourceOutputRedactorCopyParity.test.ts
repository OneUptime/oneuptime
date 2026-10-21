import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test — the generic rules in ResourceOutputRedactor are a
 * faithful COPY of KubectlOutputRedactor.
 *
 * The resource policy directory is import-closed (the resource AI agent
 * carries a byte-identical copy of it), so it cannot import
 * Utils/AiRemediation/KubectlOutputRedactor. Instead it carries the
 * redactor's rules verbatim — everything from the KubectlOutputRedaction
 * interface to the end of the file — with only four same-length renames.
 * A fix to the Kubernetes redactor that is not re-copied here would leave
 * resource output with a hole the cluster lane no longer has, so this fails
 * the moment the two differ: re-copy the block (apply RENAMES) into
 * Utils/AiRemediation/Resource/ResourceOutputRedactor.ts.
 *
 * Read with fs, never required: the comparison is of source text.
 */

const COMMON_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

const SOURCE_FILE: string = path.join(
  COMMON_ROOT,
  "Utils",
  "AiRemediation",
  "KubectlOutputRedactor.ts",
);

const COPY_FILE: string = path.join(
  COMMON_ROOT,
  "Utils",
  "AiRemediation",
  "Resource",
  "ResourceOutputRedactor.ts",
);

// Where the copied block starts in the source.
const COPY_START: string = "export interface KubectlOutputRedaction";

/*
 * Applied in order. Each new name has the old name's length, so a
 * formatter never re-wraps a copied line and the texts stay comparable.
 */
const RENAMES: Array<[string, string]> = [
  [
    "export default class KubectlOutputRedactor",
    "export class GenericOutputRedactor",
  ],
  ["KubectlOutputRedactor", "GenericOutputRedactor"],
  ["KubectlOutputRedaction", "GenericOutputRedaction"],
  ["KUBECTL_REDACTED_MARKER", "GENERIC_REDACTED_MARKER"],
];

function expectedCopy(): string {
  const source: string = fs.readFileSync(SOURCE_FILE, "utf8");
  const start: number = source.indexOf(COPY_START);

  expect(start).toBeGreaterThan(-1);

  let block: string = source.slice(start);

  for (const [from, to] of RENAMES) {
    block = block.split(from).join(to);
  }

  return block;
}

describe("ResourceOutputRedactor carries KubectlOutputRedactor's rules verbatim", () => {
  test("the renames keep every identifier's length", () => {
    for (const [from, to] of RENAMES.slice(1)) {
      expect(to).toHaveLength(from.length);
    }
  });

  test("the copied block is identical to the source after the renames", () => {
    const copy: string = fs.readFileSync(COPY_FILE, "utf8");
    const expected: string = expectedCopy();

    expect(copy.includes(expected)).toBe(true);
  });

  test("the copy mentions the source it must follow", () => {
    const copy: string = fs.readFileSync(COPY_FILE, "utf8");

    expect(copy).toContain("KubectlOutputRedactor");
    expect(copy).toContain("ResourceOutputRedactorCopyParity.test.ts");
  });

  test("no Kubernetes identifier survives in the copied code", () => {
    const expected: string = expectedCopy();

    expect(expected).not.toMatch(/\bKubectlOutputRedact(or|ion)\b/);
    expect(expected).not.toContain("KUBECTL_REDACTED_MARKER");
  });
});
