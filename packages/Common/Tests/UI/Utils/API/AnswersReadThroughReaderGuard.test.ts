// UX rule: Docs/ux/README.md#errors
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * EVERY ANSWER THE BROWSER'S CLIENTS READ IS READ WHERE A FAILURE TO READ IT
 * IS SAID PLAINLY (#8413).
 *
 * Admin Dashboard > Telemetry Usage said "Array is not iterable" where its
 * projects should have been (#7794): the browser's client threw while it
 * read an answer, and its words reached the page. Every read of an answer
 * now goes through a reader that turns whatever throws into an
 * UnreadableAnswerException, which API.getFriendlyMessage says as a failure
 * nobody explained:
 *
 *   - Common/Utils/API.ts builds an HTTPResponse only in readAnswer, and an
 *     HTTPErrorResponse only in readErrorAnswer;
 *   - the model clients (ModelAPI, AnalyticsModelAPI and the clients beside
 *     them) turn an answer's data into models, rows or a count only inside
 *     AnswerReader.read, or through AnswerReader's getters.
 *
 * This guard reads those files with the TypeScript compiler and fails on a
 * read of an answer outside them - a model built from `result.data`, a
 * count read off it, its rows mapped as a list, an HTTPResponse built
 * elsewhere in the client - which would hand a thrown TypeError's words, or
 * OneUptime's own refusal about a value nobody typed, back to the page. The
 * detector is pinned on the reads as they were first, then run over the
 * files, with a negative control that puts one back.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../../..");

// The client every request goes through.
const API_CLIENT_FILE: string = "packages/Common/Utils/API.ts";

// Where answers become models, rows and counts.
const MODEL_CLIENT_FOLDERS: Array<string> = [
  "packages/Common/UI/Utils/ModelAPI",
  "packages/Common/UI/Utils/AnalyticsModelAPI",
];

// The methods of the client that read an answer, each guarded.
const ANSWER_READING_METHODS: Array<string> = ["readAnswer", "readErrorAnswer"];

const MODEL_READERS: Array<string> = [
  "fromJSON",
  "fromJSONArray",
  "fromJSONObject",
];

const LIST_READERS: Array<string> = ["map", "forEach", "filter", "reduce"];

interface UnguardedRead {
  file: string;
  line: number;
  how: string;
}

// The expression under casts and brackets: `(result.data as JSONArray)` is `result.data`.
const unwrapped: (node: ts.Expression) => ts.Expression = (
  node: ts.Expression,
): ts.Expression => {
  let expression: ts.Expression = node;

  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isTypeAssertionExpression(expression)
  ) {
    expression = expression.expression;
  }

  return expression;
};

// Whether an expression is an answer's data: `<answer>.data`.
const isAnswerData: (node: ts.Expression | undefined) => boolean = (
  node: ts.Expression | undefined,
): boolean => {
  if (!node) {
    return false;
  }

  const expression: ts.Expression = unwrapped(node);

  return (
    ts.isPropertyAccessExpression(expression) &&
    expression.name.text === "data"
  );
};

// Whether a node sits in the arguments of AnswerReader.read(...).
const isInsideAnswerReader: (node: ts.Node) => boolean = (
  node: ts.Node,
): boolean => {
  let current: ts.Node | undefined = node.parent;

  while (current) {
    if (
      ts.isCallExpression(current) &&
      ts.isPropertyAccessExpression(current.expression) &&
      current.expression.name.text === "read" &&
      ts.isIdentifier(current.expression.expression) &&
      current.expression.expression.text === "AnswerReader"
    ) {
      return true;
    }

    current = current.parent;
  }

  return false;
};

// The name of the method a node sits in, if it sits in one.
const enclosingMethodName: (node: ts.Node) => string | null = (
  node: ts.Node,
): string | null => {
  let current: ts.Node | undefined = node.parent;

  while (current) {
    if (
      ts.isMethodDeclaration(current) &&
      current.name &&
      ts.isIdentifier(current.name)
    ) {
      return current.name.text;
    }

    current = current.parent;
  }

  return null;
};

const findUnguardedReads: (
  file: string,
  source: string,
) => Array<UnguardedRead> = (
  file: string,
  source: string,
): Array<UnguardedRead> => {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const isApiClient: boolean = file === API_CLIENT_FILE;
  const findings: Array<UnguardedRead> = [];

  const report: (node: ts.Node, how: string) => void = (
    node: ts.Node,
    how: string,
  ): void => {
    findings.push({
      file: file,
      line:
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          .line + 1,
      how: how,
    });
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    // An HTTPResponse or an HTTPErrorResponse built in the client, outside its readers.
    if (
      isApiClient &&
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      ["HTTPResponse", "HTTPErrorResponse"].includes(node.expression.text) &&
      !ANSWER_READING_METHODS.includes(enclosingMethodName(node) || "")
    ) {
      report(
        node,
        `builds an ${node.expression.text} outside readAnswer and readErrorAnswer`,
      );
    }

    if (!isApiClient && ts.isCallExpression(node)) {
      const callee: ts.Expression = node.expression;

      // A model, or models, built from an answer's data.
      if (
        ts.isPropertyAccessExpression(callee) &&
        MODEL_READERS.includes(callee.name.text) &&
        isAnswerData(node.arguments[0]) &&
        !isInsideAnswerReader(node)
      ) {
        report(node, `builds models from an answer's data (${callee.name.text})`);
      }

      // An answer's data read as a list of rows.
      if (
        ts.isPropertyAccessExpression(callee) &&
        LIST_READERS.includes(callee.name.text) &&
        isAnswerData(callee.expression) &&
        !isInsideAnswerReader(node)
      ) {
        report(node, `reads an answer's data as rows (${callee.name.text})`);
      }
    }

    // A count read off an answer's data.
    if (
      !isApiClient &&
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteral(node.argumentExpression) &&
      node.argumentExpression.text === "count" &&
      isAnswerData(node.expression) &&
      !isInsideAnswerReader(node)
    ) {
      report(node, "reads a count off an answer's data");
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return findings;
};

// The files whose reads are held: the client, and the model clients.
const listGuardedFiles: () => Array<string> = (): Array<string> => {
  const files: Array<string> = [API_CLIENT_FILE];

  for (const folder of MODEL_CLIENT_FOLDERS) {
    for (const name of fs.readdirSync(path.join(REPOSITORY_ROOT, folder))) {
      if (name.endsWith(".ts") && !name.endsWith(".d.ts")) {
        files.push(`${folder}/${name}`);
      }
    }
  }

  return files;
};

const format: (findings: Array<UnguardedRead>) => Array<string> = (
  findings: Array<UnguardedRead>,
): Array<string> => {
  return findings.map((finding: UnguardedRead): string => {
    return `${finding.file}:${finding.line} ${finding.how}`;
  });
};

const judge: (file: string, lines: Array<string>) => Array<string> = (
  file: string,
  lines: Array<string>,
): Array<string> => {
  return format(findUnguardedReads(file, lines.join("\n")));
};

const MODEL_CLIENT: string = "packages/Common/UI/Utils/ModelAPI/ModelAPI.ts";

describe("the detector finds each read of an answer as it was", () => {
  test("ModelAPI's list: models built from the answer's rows as they came", () => {
    expect(
      judge(MODEL_CLIENT, [
        "if (result.isSuccess()) {",
        "  const list = BaseModel.fromJSONArray(",
        "    result.data as JSONArray,",
        "    data.modelType,",
        "  );",
        "}",
      ]),
    ).toEqual([
      `${MODEL_CLIENT}:2 builds models from an answer's data (fromJSONArray)`,
    ]);
  });

  test("ModelAPI's count: read off the answer, undefined when it was not there", () => {
    expect(
      judge(MODEL_CLIENT, [
        "if (result.isSuccess()) {",
        '  const count: number = result.data["count"] as number;',
        "  return count;",
        "}",
      ]),
    ).toEqual([`${MODEL_CLIENT}:2 reads a count off an answer's data`]);
  });

  test("a record built from the answer, and rows mapped off it", () => {
    expect(
      judge("packages/Common/UI/Utils/ModelAPI/UserProjectsModelAPI.ts", [
        "const record = BaseModel.fromJSONObject(result.data as JSONObject, type);",
        "const rows = (result.data as JSONArray).map((item: JSONObject) => {",
        "  return this.toRow(item);",
        "});",
      ]),
    ).toEqual([
      "packages/Common/UI/Utils/ModelAPI/UserProjectsModelAPI.ts:1 builds models from an answer's data (fromJSONObject)",
      "packages/Common/UI/Utils/ModelAPI/UserProjectsModelAPI.ts:2 reads an answer's data as rows (map)",
    ]);
  });

  test("the client's answer built in fetch, where whatever threw became a plain APIException", () => {
    expect(
      judge(API_CLIENT_FILE, [
        "class API {",
        "  private static async fetchUntraced() {",
        "    const response = new HTTPResponse<T>(",
        "      result.status,",
        "      result.data,",
        "      result.headers,",
        "    );",
        "  }",
        "  private static getErrorResponse(error) {",
        "    return new HTTPErrorResponse(status, data, headers);",
        "  }",
        "}",
      ]),
    ).toEqual([
      `${API_CLIENT_FILE}:3 builds an HTTPResponse outside readAnswer and readErrorAnswer`,
      `${API_CLIENT_FILE}:10 builds an HTTPErrorResponse outside readAnswer and readErrorAnswer`,
    ]);
  });

  test("leaves alone reads inside AnswerReader.read, and the client's readers", () => {
    expect(
      judge(MODEL_CLIENT, [
        "const list = AnswerReader.read(result, () => {",
        "  return BaseModel.fromJSONArray(AnswerReader.getRows(result), type);",
        "});",
        "result.data = AnswerReader.read(result, () => {",
        "  return BaseModel.fromJSONObject(result.data, type);",
        "});",
        "return AnswerReader.getCount(result);",
        // A row built from a row, not from the answer.
        "const row = BaseModel.fromJSON(item, TeamMember);",
      ]),
    ).toEqual([]);

    expect(
      judge(API_CLIENT_FILE, [
        "class API {",
        "  private static async readAnswer(result) {",
        "    return new HTTPResponse<T>(result.status, result.data, result.headers);",
        "  }",
        "  private static readErrorAnswer(response) {",
        "    return new HTTPErrorResponse(response.status, response.data, {});",
        "  }",
        "}",
      ]),
    ).toEqual([]);
  });
});

describe("the browser's clients", () => {
  test("are read: the client and every model client", () => {
    const files: Array<string> = listGuardedFiles();

    expect(files).toContain(API_CLIENT_FILE);
    expect(files).toContain(MODEL_CLIENT);
    expect(files).toContain(
      "packages/Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI.ts",
    );
    expect(files).toContain(
      "packages/Common/UI/Utils/ModelAPI/UserProjectsModelAPI.ts",
    );
  });

  test("read every answer through a reader that says a failure to read it plainly", () => {
    const findings: Array<UnguardedRead> = listGuardedFiles().flatMap(
      (file: string): Array<UnguardedRead> => {
        return findUnguardedReads(
          file,
          fs.readFileSync(path.join(REPOSITORY_ROOT, file), "utf8"),
        );
      },
    );

    expect(format(findings)).toEqual([]);
  });

  test("a negative control: ModelAPI's count read off the answer again is found", () => {
    const source: string = fs
      .readFileSync(path.join(REPOSITORY_ROOT, MODEL_CLIENT), "utf8")
      .replace(
        "return AnswerReader.getCount(result);",
        'return result.data["count"] as number;',
      );

    expect(
      findUnguardedReads(MODEL_CLIENT, source).map(
        (finding: UnguardedRead): string => {
          return finding.how;
        },
      ),
    ).toEqual(["reads a count off an answer's data"]);
  });

  test("a negative control: the client's answer built in fetch again is found", () => {
    const source: string = fs
      .readFileSync(path.join(REPOSITORY_ROOT, API_CLIENT_FILE), "utf8")
      .replace(
        "const response: HTTPResponse<T> = await this.readAnswer<T>(result);",
        "const response: HTTPResponse<T> = new HTTPResponse<T>(result.status, result.data, {});",
      );

    expect(
      findUnguardedReads(API_CLIENT_FILE, source).map(
        (finding: UnguardedRead): string => {
          return finding.how;
        },
      ),
    ).toEqual(["builds an HTTPResponse outside readAnswer and readErrorAnswer"]);
  });
});
