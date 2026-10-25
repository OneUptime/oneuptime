import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import { listProductFiles } from "../../Helpers/CodeScanning";
import { REPOSITORY_DIRECTORY } from "../../Helpers/TagStripScan";

/*
 * PRODUCT CODE READS NO ZOD INTERNALS.
 *
 * The MCP tools built every tool's input schema by reading zod 3's internals
 * off the model schemas - _def.shape(), _def.typeName === "ZodOptional",
 * _def.openapi.metadata. zod 4 keeps none of them where zod 3 did, and the
 * converter caught what it threw: moved to zod 4 as it was, every MCP tool
 * would have quietly listed no fields. Common/Utils/Schema/SchemaFields now
 * reads a schema's fields through zod's and zod-to-openapi's public API, next
 * to where the schemas are made.
 *
 * This keeps it that way: it reads every file of product code
 * (Tests/Helpers/CodeScanning's listing - no tests) through the TypeScript
 * AST and fails on a read of `_def` or `_zod`, zod's internal fields - by
 * property, by index or by destructuring. The detector is pinned on snippets
 * first.
 */

const INTERNAL_FIELDS: ReadonlySet<string> = new Set<string>(["_def", "_zod"]);

interface InternalRead {
  // 1-based.
  line: number;
  field: string;
}

function scriptKindOf(fileName: string): ts.ScriptKind {
  if (fileName.endsWith(".tsx")) {
    return ts.ScriptKind.TSX;
  }

  if (fileName.endsWith(".ts")) {
    return ts.ScriptKind.TS;
  }

  return ts.ScriptKind.JS;
}

function findZodInternalReads(
  fileName: string,
  source: string,
): Array<InternalRead> {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindOf(fileName),
  );
  const found: Array<InternalRead> = [];

  const record: (node: ts.Node, field: string) => void = (
    node: ts.Node,
    field: string,
  ): void => {
    if (!INTERNAL_FIELDS.has(field)) {
      return;
    }

    found.push({
      line:
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          .line + 1,
      field: field,
    });
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node)) {
      record(node, node.name.text);
    } else if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression)
    ) {
      record(node, node.argumentExpression.text);
    } else if (ts.isBindingElement(node)) {
      const name: ts.PropertyName | ts.BindingName =
        node.propertyName || node.name;

      if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) {
        record(node, name.text);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return found;
}

function readsIn(source: string): Array<string> {
  return findZodInternalReads("Fixture.ts", source).map(
    (read: InternalRead): string => {
      return `${read.line}: ${read.field}`;
    },
  );
}

describe("the detector finds every way of reading zod's internals", () => {
  test.each([
    ["a property", "const shape = schema._def.shape;"],
    ["an optional chain", "const name = field._def?.typeName;"],
    ["by index", 'const def = schema["_def"];'],
    ["zod 4's internals", "const type = schema._zod.def.type;"],
    ["destructured", "const { _def } = schema;"],
    ["destructured and renamed", "const { _def: definition } = schema;"],
  ])("%s", (_name: string, source: string) => {
    expect(findZodInternalReads("Fixture.ts", source)).toHaveLength(1);
  });

  test("on the line it is on", () => {
    expect(
      readsIn(["const a = 1;", "", "const b = field._def;"].join("\n")),
    ).toEqual(["3: _def"]);
  });

  test("leaves alone what is not one", () => {
    expect(
      readsIn(
        [
          "// schema._def.shape() was zod 3's",
          'const text: string = "_def";',
          "const value = model._defaultValue;",
          "const shape = schema.shape;",
          "const def = schema.def;",
          'const description = schema["description"];',
        ].join("\n"),
      ),
    ).toEqual([]);
  });
});

describe("product code reads schemas through their public API", () => {
  test("no product file reads _def or _zod", () => {
    const files: Array<string> = listProductFiles().filter(
      (file: string): boolean => {
        return [".ts", ".tsx", ".js", ".mjs", ".cjs"].some(
          (extension: string): boolean => {
            return file.endsWith(extension);
          },
        );
      },
    );

    expect(files.length).toBeGreaterThan(1000);
    expect(files).toContain("packages/Common/Utils/Schema/SchemaFields.ts");

    const reads: Array<string> = [];

    for (const file of files) {
      const source: string = fs.readFileSync(
        path.join(REPOSITORY_DIRECTORY, file),
        "utf8",
      );

      if (!source.includes("_def") && !source.includes("_zod")) {
        continue;
      }

      for (const read of findZodInternalReads(file, source)) {
        reads.push(`${file}:${read.line}  ${read.field}`);
      }
    }

    if (reads.length > 0) {
      throw new Error(
        [
          `${reads.length} read(s) of zod's internals in product code:`,
          ...reads.map((read: string): string => {
            return `  ${read}`;
          }),
          "",
          "Read a schema through Common/Utils/Schema/SchemaFields (getSchemaFields,",
          "getSchemaFieldNames) or zod's public API (schema.shape, .description,",
          "instanceof z.ZodOptional, .unwrap()); zod's internals change between",
          "versions, and code that reads them breaks without a word.",
        ].join("\n"),
      );
    }

    expect(reads).toEqual([]);
  });
});
