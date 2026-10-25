import {
  ChangedCode,
  ChangedCodeFile,
  ChangedFileMatch,
  extractDeclaredFunctionName,
  extractRouteLiterals,
  getChangedFunctionNames,
  isCodeFile,
  isLineInRanges,
  matchChangedFile,
  parseHunkHeader,
  readChangedCode,
  readPatch,
  readRouteLiteral,
  sharedTrailingSegments,
  toLineRanges,
} from "../../../../../Server/Utils/CodeRepository/ProductionReview/ProductionReviewDiff";
import { PRODUCTION_REVIEW_LIMITS } from "../../../../../Types/CodeRepository/ProductionReview";
import { fastestRun } from "../../../../Helpers/FastestRun";
import { describe, expect, test } from "@jest/globals";

/*
 * What a pull request changes, in the terms production can be asked about:
 * the base lines it touches (a stack frame names a line of the DEPLOYED code,
 * which is the base, not the change), the functions it touches, and the
 * routes its changed lines spell out. Every reader here runs on text a pull
 * request's author wrote, so the last block holds each to time in line with
 * its input on the shapes that make patterns slow.
 */

function changedFile(
  path: string,
  change: Partial<ChangedCodeFile> = {},
): ChangedCodeFile {
  return {
    path,
    status: "modified",
    baseLines: [],
    functionNames: [],
    routes: [],
    hasPatch: true,
    ...change,
  };
}

describe("extractDeclaredFunctionName", () => {
  test.each([
    ["def charge_card(self, card):", "charge_card"],
    ["    async def charge_card(self, card):", "charge_card"],
    ["def charge", "charge"],
    ["  defp charge(card) do", "charge"],
    ["function chargeCard(card) {", "chargeCard"],
    [
      "export async function chargeCard(card: Card): Promise<void> {",
      "chargeCard",
    ],
    ["export default function* walk(tree) {", "walk"],
    ["func Charge(ctx context.Context, card Card) error {", "Charge"],
    ["func (s *Server) Charge(ctx context.Context) error {", "Charge"],
    ["pub async fn charge(card: &Card) -> Result<()> {", "charge"],
    ["fun charge(card: Card): Receipt {", "charge"],
    ["sub charge {", "charge"],
    ["const chargeCard = async (card) => {", "chargeCard"],
    ["export const chargeCard = (card: Card): void => {", "chargeCard"],
    ["let chargeCard = function (card) {", "chargeCard"],
    ["const chargeCard: Handler = async (req, res) => {", "chargeCard"],
    ["  chargeCard: async (card) => {", "chargeCard"],
    ["  chargeCard: function (card) {", "chargeCard"],
    ["const charge = card => {", "charge"],
    ["  public async chargeCard(card: Card): Promise<void> {", "chargeCard"],
    [
      "  private static Receipt charge(Card card) throws PaymentException {",
      "charge",
    ],
    ["  public Receipt Charge(Card card)", "Charge"],
    ["  Map<String, List<Item>> groupItems(List<Item> items) {", "groupItems"],
    ["  async refund(order) {", "refund"],
    ["  public function charge($card) {", "charge"],
  ])("%p declares %p", (line: string, expected: string) => {
    expect(extractDeclaredFunctionName(line)).toBe(expected);
  });

  test.each([
    ["chargeCard(card);"],
    ["chargeCard(card)"],
    ["  return chargeCard(card)"],
    ["  await chargeCard(card)"],
    ["if (card.expired) {"],
    ["} else if (x) {"],
    ["for (const item of items) {"],
    ["while (retries > 0) {"],
    ["switch (kind) {"],
    ["  catch (error) {"],
    ['app.get("/api/orders/:id", async (req, res) => {'],
    ['describe("charge", () => {'],
    ["logger.info(message)"],
    ["const total = items.reduce((sum, item) => sum + item.price, 0);"],
    ["let total: number = items.reduce((a, b) => a + b)"],
    ["const total = (a + b) * 2"],
    ["if x == y:"],
    ["x == charge(y)"],
    ["@app.route('/orders')"],
    ["// function chargeCard(card) {"],
    [""],
    ["   "],
    ["123abc(x) {"],
  ])("%p declares nothing", (line: string) => {
    expect(extractDeclaredFunctionName(line)).toBeNull();
  });

  test("a name longer than an identifier can be is not taken", () => {
    expect(
      extractDeclaredFunctionName(`function ${"a".repeat(200)}() {`),
    ).toBeNull();
  });

  test("only the start of a very long line is read", () => {
    expect(
      extractDeclaredFunctionName(`${" ".repeat(600)}function late() {`),
    ).toBeNull();
  });
});

describe("routes", () => {
  test.each([
    ["/api/orders/:id", "/api/orders/:id"],
    ["/api/orders/{order_id}", "/api/orders/{order_id}"],
    ["/v1/users/*", "/v1/users/*"],
    ["/checkout", "/checkout"],
  ])("%p is a route", (literal: string, expected: string) => {
    expect(readRouteLiteral(literal)).toBe(expected);
  });

  test.each([
    ["/"],
    ["/x"],
    ["/12/34"],
    ["https://example.com/api"],
    ["//cdn.example.com/app.js"],
    ["/assets/app.js"],
    ["/etc/hosts.conf"],
    ["api/orders"],
    ["/api/orders?id=1"],
    ["/api orders"],
    [`/${"a".repeat(300)}`],
  ])("%p is not a route", (literal: string) => {
    expect(readRouteLiteral(literal)).toBeNull();
  });

  test("the routes a line's string literals spell out, once each", () => {
    expect(
      extractRouteLiterals(
        `router.get("/api/orders/:id", handler); router.post('/api/orders/:id'); x = \`/checkout\`; y = "/checkout"`,
      ),
    ).toEqual(["/api/orders/:id", "/checkout"]);
  });

  test("an unclosed quote ends the reading", () => {
    expect(extractRouteLiterals(`a("/api/orders" + "/rest`)).toEqual([
      "/api/orders",
    ]);
  });
});

describe("parseHunkHeader", () => {
  test("reads the base and head starts and the heading", () => {
    expect(
      parseHunkHeader("@@ -40,7 +41,9 @@ export function chargeCard(card) {"),
    ).toEqual({
      baseStart: 40,
      headStart: 41,
      heading: "export function chargeCard(card) {",
    });
  });

  test("counts are optional, and the heading may be empty", () => {
    expect(parseHunkHeader("@@ -1 +1 @@")).toEqual({
      baseStart: 1,
      headStart: 1,
      heading: "",
    });
  });

  test.each([
    ["@@ -a,1 +1,1 @@"],
    ["@@ -1,1 1,1 @@"],
    ["@@ -1,1 +1,1"],
    ["@@ -1,1 +x @@"],
    ["@@@ -1 +1 @@@"],
    ["+++ b/src/charge.ts"],
  ])("%p is not a hunk header", (line: string) => {
    expect(parseHunkHeader(line)).toBeNull();
  });
});

describe("readPatch", () => {
  test("a replaced line touches its own base line, and inserted code both base lines around it", () => {
    const patch: string = [
      "@@ -40,6 +40,8 @@ export function chargeCard(card) {",
      "   const amount = card.amount;",
      "-  const id = card.id;",
      "+  if (!card) {",
      "+    throw new Error('no card');",
      "+  }",
      "+  const id = card.id;",
      "   return pay(id, amount);",
      " }",
      " ",
      "@@ -90,3 +92,4 @@ function refund(order) {",
      "   const total = order.total;",
      "+  audit(order);",
      "   return total;",
    ].join("\n");

    const facts: ReturnType<typeof readPatch> = readPatch(patch);

    // Line 41 was replaced; base lines 90 and 91 sit around the insertion.
    expect(facts.baseLines).toEqual([
      { start: 41, end: 41 },
      { start: 90, end: 91 },
    ]);
    expect(facts.functionNames).toEqual(["chargeCard", "refund"]);
  });

  test("a deleted block touches each of its base lines", () => {
    const facts: ReturnType<typeof readPatch> = readPatch(
      ["@@ -10,4 +10,1 @@", " a", "-b", "-c", "-d"].join("\n"),
    );

    expect(facts.baseLines).toEqual([{ start: 11, end: 13 }]);
  });

  test("functions declared in changed lines count; those in context lines do not", () => {
    const facts: ReturnType<typeof readPatch> = readPatch(
      [
        "@@ -1,3 +1,6 @@",
        " function untouched() {",
        "+function added(card) {",
        "+  return card;",
        "+}",
        "-def removed_one(x):",
      ].join("\n"),
    );

    expect(facts.functionNames).toEqual(["added", "removed_one"]);
  });

  test("routes come from changed lines only", () => {
    const facts: ReturnType<typeof readPatch> = readPatch(
      [
        "@@ -1,2 +1,2 @@",
        ' router.get("/api/health", ok);',
        '-router.get("/api/orders/:id", show);',
        '+router.get("/api/orders/:orderId", show);',
      ].join("\n"),
    );

    expect(facts.routes).toEqual(["/api/orders/:id", "/api/orders/:orderId"]);
  });

  test("lines before the first hunk, and the no-newline note, are not code", () => {
    const facts: ReturnType<typeof readPatch> = readPatch(
      [
        "+function notInAHunk() {",
        "@@ -5,1 +5,1 @@",
        "-a",
        "+b",
        "\\ No newline at end of file",
      ].join("\n"),
    );

    expect(facts.functionNames).toEqual([]);
    expect(facts.baseLines).toEqual([{ start: 5, end: 5 }]);
  });

  test("carriage returns are read as line ends", () => {
    const facts: ReturnType<typeof readPatch> = readPatch(
      "@@ -1,1 +1,1 @@\r\n-def a():\r\n+def b():\r\n",
    );

    expect(facts.functionNames).toEqual(["a", "b"]);
  });

  test("a file's functions are held to a number", () => {
    const lines: Array<string> = ["@@ -1,1 +1,100 @@"];

    for (let index: number = 0; index < 100; index++) {
      lines.push(`+function f${index}() {`);
    }

    expect(readPatch(lines.join("\n")).functionNames).toHaveLength(
      PRODUCTION_REVIEW_LIMITS.maxFunctionsPerFile,
    );
  });
});

describe("toLineRanges and isLineInRanges", () => {
  test("merges neighbours and drops what is no line", () => {
    expect(toLineRanges([5, 3, 4, 10, 0, -2, 11, 4])).toEqual([
      { start: 3, end: 5 },
      { start: 10, end: 11 },
    ]);
  });

  test("a line is in a range from its start to its end", () => {
    const ranges: Array<{ start: number; end: number }> = [
      { start: 3, end: 5 },
    ];

    expect(isLineInRanges(3, ranges)).toBe(true);
    expect(isLineInRanges(5, ranges)).toBe(true);
    expect(isLineInRanges(6, ranges)).toBe(false);
  });
});

describe("isCodeFile", () => {
  test.each([
    ["src/billing/charge.ts"],
    ["app/models/order.rb"],
    ["cmd/server/main.go"],
    ["src/main/java/com/acme/Billing.java"],
    ["service/api.py"],
    ["web/Checkout.vue"],
  ])("%p is code", (path: string) => {
    expect(isCodeFile(path)).toBe(true);
  });

  test.each([
    ["README.md"],
    ["package-lock.json"],
    ["config/app.yaml"],
    ["db/migrations/001.sql"],
    ["assets/logo.png"],
    ["node_modules/left-pad/index.js"],
    ["vendor/github.com/x/y.go"],
    ["Makefile"],
  ])("%p is not code production runs", (path: string) => {
    expect(isCodeFile(path)).toBe(false);
  });
});

describe("readChangedCode", () => {
  test("keeps the files of code, in GitHub's order, with what each change touches", () => {
    const changed: ChangedCode = readChangedCode({
      files: [
        {
          filename: "README.md",
          status: "modified",
          patch: "@@ -1 +1 @@\n-a\n+b",
        },
        {
          filename: "src/billing/charge.ts",
          status: "modified",
          patch: "@@ -10,1 +10,1 @@ function chargeCard(card) {\n-a\n+b",
        },
        {
          filename: "src/billing/refund.ts",
          previousFilename: "src/billing/refunds.ts",
          status: "renamed",
          patch: null,
        },
      ],
    });

    expect(changed.fileCount).toBe(3);
    expect(changed.codeFileCount).toBe(2);
    expect(changed.isTruncated).toBe(false);
    expect(
      changed.files.map((file: ChangedCodeFile) => {
        return file.path;
      }),
    ).toEqual(["src/billing/charge.ts", "src/billing/refund.ts"]);
    expect(changed.files[0]!.functionNames).toEqual(["chargeCard"]);
    expect(changed.files[0]!.baseLines).toEqual([{ start: 10, end: 10 }]);
    expect(changed.files[1]!.previousPath).toBe("src/billing/refunds.ts");
    expect(changed.files[1]!.hasPatch).toBe(false);
  });

  test("is truncated past the files of code it looks up, or when GitHub had more files", () => {
    const many: ChangedCode = readChangedCode({
      files: Array.from(
        { length: PRODUCTION_REVIEW_LIMITS.maxCodeFiles + 5 },
        (_value: unknown, index: number) => {
          return { filename: `src/f${index}.ts`, status: "added", patch: null };
        },
      ),
    });

    expect(many.files).toHaveLength(PRODUCTION_REVIEW_LIMITS.maxCodeFiles);
    expect(many.codeFileCount).toBe(PRODUCTION_REVIEW_LIMITS.maxCodeFiles + 5);
    expect(many.isTruncated).toBe(true);

    expect(readChangedCode({ files: [], hasMoreFiles: true }).isTruncated).toBe(
      true,
    );
  });

  test("the whole change's functions are held to a number", () => {
    const files: Array<{ filename: string; status: string; patch: string }> =
      [];

    for (let file: number = 0; file < 10; file++) {
      const lines: Array<string> = ["@@ -1,1 +1,20 @@"];

      for (let index: number = 0; index < 20; index++) {
        lines.push(`+function f${file}_${index}() {`);
      }

      files.push({
        filename: `src/f${file}.ts`,
        status: "added",
        patch: lines.join("\n"),
      });
    }

    expect(getChangedFunctionNames(readChangedCode({ files }))).toHaveLength(
      PRODUCTION_REVIEW_LIMITS.maxFunctions,
    );
  });
});

describe("matchChangedFile", () => {
  const files: Array<ChangedCodeFile> = [
    changedFile("services/billing/src/billing/charge.ts"),
    changedFile("src/orders/Order.java"),
    changedFile("lib/report.ts", { previousPath: "lib/old-report.ts" }),
    changedFile("a/util.ts"),
    changedFile("b/util.ts"),
  ];

  test("a container path matches the repository path it is the tail of", () => {
    const match: ChangedFileMatch | null = matchChangedFile(
      "/app/src/billing/charge.ts",
      files,
    );

    expect(match?.file.path).toBe("services/billing/src/billing/charge.ts");
    expect(match?.sharedSegments).toBe(3);
  });

  test("a Java frame's file name alone matches the one changed file of that name", () => {
    expect(matchChangedFile("Order.java", files)?.file.path).toBe(
      "src/orders/Order.java",
    );
  });

  test("a file name two changed files share matches neither", () => {
    expect(matchChangedFile("util.ts", files)).toBeNull();
  });

  test("a deeper path that shares only the file name is another file", () => {
    expect(matchChangedFile("/app/lib/x/charge.ts", files)).toBeNull();
  });

  test("the name a file had before its rename matches too", () => {
    expect(matchChangedFile("/srv/lib/old-report.ts", files)?.matchedPath).toBe(
      "lib/old-report.ts",
    );
  });

  test("a dependency's file never matches", () => {
    expect(
      matchChangedFile("/app/node_modules/src/billing/charge.ts", files),
    ).toBeNull();
  });

  test("an absurdly long path is not read", () => {
    expect(matchChangedFile(`/${"x/".repeat(600)}charge.ts`, files)).toBeNull();
  });

  test("sharedTrailingSegments counts from the end", () => {
    expect(sharedTrailingSegments("a/b/c.ts", "x/b/c.ts")).toBe(2);
    expect(sharedTrailingSegments("a/b/c.ts", "a/b/d.ts")).toBe(0);
  });
});

describe("time in line with what the author wrote", () => {
  /*
   * How long the work takes: the fastest of up to three attempts, counted
   * as it would have run on a usual runner when every attempt overran on a
   * slow one (Tests/Helpers/FastestRun). One attempt in a busy run took
   * 2,106 ms for the 100,000 short lines.
   */
  function timeOf(work: () => void): number {
    return fastestRun({ run: work, limitInMs: 2000 }).inMs;
  }

  test("a 400,000-character patch line of declaration-like text", () => {
    const line: string = `+${"function (".repeat(40000)}`;

    expect(
      timeOf(() => {
        readPatch(`@@ -1,1 +1,1 @@\n${line}`);
      }),
    ).toBeLessThan(2000);
  });

  test("400,000 characters of quotes and slashes", () => {
    const line: string = `"/${'a"/'.repeat(130000)}`;

    expect(
      timeOf(() => {
        extractRouteLiterals(line);
        extractDeclaredFunctionName(line);
      }),
    ).toBeLessThan(2000);
  });

  test("a patch of 100,000 short lines", () => {
    const lines: Array<string> = ["@@ -1,1 +1,100000 @@"];

    for (let index: number = 0; index < 100000; index++) {
      lines.push(index % 2 ? `+  x${index}(a);` : `-  "/r${index}" + y`);
    }

    expect(
      timeOf(() => {
        readPatch(lines.join("\n"));
      }),
    ).toBeLessThan(2000);
  });

  test("400,000 characters of nested parentheses after a function keyword", () => {
    const line: string = `func ${"(".repeat(200000)}${")".repeat(200000)} name(`;

    expect(
      timeOf(() => {
        extractDeclaredFunctionName(line);
      }),
    ).toBeLessThan(2000);
  });
});
