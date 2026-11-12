// UX rule: Docs/ux/README.md#numbers-dates-and-plurals
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import {
  listScanRoots,
  listSourceFiles,
  toRelativePath,
} from "../ForeignHiddenRuleGuard";

/*
 * A COUNT BESIDE {{count}} IS WRITTEN IN THE READER'S DIGITS, AS {{count}} IS.
 *
 * A count-dependent sentence writes its {{count}} the reader's way
 * (Translator.translatePlural formats it: "۵" in Persian). A second count
 * joined to it by a slash or a colon - "{{online}}/{{count}} devices
 * online" - goes into the sentence as it is given: a plain number in Latin
 * digits. The IoT fleet's chip passed its online count so and read "2/۳" on
 * a Persian page, where every other count chip reads "۲/۳".
 *
 * This reads every frontend's source through the TypeScript AST: for each
 * translatePlural call and each TranslatedSentence whose template joins a
 * value to {{count}}, that value must be written by a format function
 * (translator.formatNumber, or a page's formatCount built on it).
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

// A value joined to {{count}} by one slash or colon, on either side.
const JOINED_TO_COUNT: RegExp =
  /\{\{\s*([\w.]+)\s*\}\}[/:]\{\{\s*count\s*\}\}|\{\{\s*count\s*\}\}[/:]\{\{\s*([\w.]+)\s*\}\}/g;

// A call that writes a number the reader's way: formatNumber(...), formatCount(...).
const FORMAT_FUNCTION: RegExp = /^format[A-Z]\w*$/;

interface CountPairSite {
  file: string;
  line: number;
  // The value joined to {{count}}: "online".
  value: string;
  // How it is filled: "translator.formatNumber(onlineDevices)", or why it is not.
  filledWith: string;
  isInReadersDigits: boolean;
}

const stringOf: (node: ts.Node | undefined) => string | undefined = (
  node: ts.Node | undefined,
): string | undefined => {
  if (
    node &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
  ) {
    return node.text;
  }

  return undefined;
};

const propertyNamed: (
  object: ts.ObjectLiteralExpression,
  name: string,
) => ts.ObjectLiteralElementLike | undefined = (
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.ObjectLiteralElementLike | undefined => {
  return object.properties.find(
    (property: ts.ObjectLiteralElementLike): boolean => {
      if (!property.name) {
        return false;
      }

      const key: string | undefined =
        ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
          ? property.name.text
          : undefined;

      return key === name;
    },
  );
};

// The values a template's English sentences join to {{count}}.
const valuesJoinedToCount: (
  template: ts.ObjectLiteralExpression,
) => Array<string> = (template: ts.ObjectLiteralExpression): Array<string> => {
  const joined: Set<string> = new Set<string>();

  for (const form of ["one", "other"]) {
    const property: ts.ObjectLiteralElementLike | undefined = propertyNamed(
      template,
      form,
    );
    const text: string | undefined =
      property && ts.isPropertyAssignment(property)
        ? stringOf(property.initializer)
        : undefined;

    for (const match of (text || "").matchAll(JOINED_TO_COUNT)) {
      const name: string | undefined = match[1] || match[2];

      if (name && name !== "count") {
        joined.add(name);
      }
    }
  }

  return [...joined];
};

const calleeName: (expression: ts.Expression) => string = (
  expression: ts.Expression,
): string => {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }

  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }

  return "";
};

// How `values` fills `name`, and whether that writes it the reader's way.
const howFilled: (
  values: ts.Expression | undefined,
  name: string,
  source: ts.SourceFile,
) => { filledWith: string; isInReadersDigits: boolean } = (
  values: ts.Expression | undefined,
  name: string,
  source: ts.SourceFile,
): { filledWith: string; isInReadersDigits: boolean } => {
  if (!values || !ts.isObjectLiteralExpression(values)) {
    return {
      filledWith: values
        ? `values not written out: ${values.getText(source)}`
        : "no values",
      isInReadersDigits: false,
    };
  }

  const property: ts.ObjectLiteralElementLike | undefined = propertyNamed(
    values,
    name,
  );

  if (!property) {
    return { filledWith: `no ${name}`, isInReadersDigits: false };
  }

  if (!ts.isPropertyAssignment(property)) {
    return { filledWith: property.getText(source), isInReadersDigits: false };
  }

  const initializer: ts.Expression = property.initializer;

  return {
    filledWith: initializer.getText(source).replace(/\s+/g, " "),
    isInReadersDigits:
      ts.isCallExpression(initializer) &&
      FORMAT_FUNCTION.test(calleeName(initializer.expression)),
  };
};

// Every count pair of one module's source.
const findCountPairSites: (
  fileName: string,
  text: string,
) => Array<CountPairSite> = (
  fileName: string,
  text: string,
): Array<CountPairSite> => {
  const source: ts.SourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const sites: Array<CountPairSite> = [];

  const record: (
    at: ts.Node,
    template: ts.Expression | undefined,
    values: ts.Expression | undefined,
  ) => void = (
    at: ts.Node,
    template: ts.Expression | undefined,
    values: ts.Expression | undefined,
  ): void => {
    if (!template || !ts.isObjectLiteralExpression(template)) {
      return;
    }

    for (const name of valuesJoinedToCount(template)) {
      const filled: { filledWith: string; isInReadersDigits: boolean } =
        howFilled(values, name, source);

      sites.push({
        file: fileName,
        line:
          source.getLineAndCharacterOfPosition(at.getStart(source)).line + 1,
        value: name,
        ...filled,
      });
    }
  };

  const attributeValue: (
    element: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
    name: string,
  ) => ts.Expression | undefined = (
    element: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
    name: string,
  ): ts.Expression | undefined => {
    for (const property of element.attributes.properties) {
      if (
        ts.isJsxAttribute(property) &&
        property.name.getText(source) === name &&
        property.initializer &&
        ts.isJsxExpression(property.initializer)
      ) {
        return property.initializer.expression;
      }
    }

    return undefined;
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      calleeName(node.expression) === "translatePlural"
    ) {
      record(node, node.arguments[0], node.arguments[2]);
    }

    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(source).endsWith("TranslatedSentence")
    ) {
      record(
        node,
        attributeValue(node, "template"),
        attributeValue(node, "values"),
      );
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return sites;
};

const SITES: Array<CountPairSite> = listScanRoots(REPOSITORY_ROOT).flatMap(
  (root: string): Array<CountPairSite> => {
    return listSourceFiles(root).flatMap(
      (file: string): Array<CountPairSite> => {
        const text: string = fs.readFileSync(file, "utf8");

        if (!text.includes("{{count}}")) {
          return [];
        }

        return findCountPairSites(toRelativePath(REPOSITORY_ROOT, file), text);
      },
    );
  },
);

const describeSite: (site: CountPairSite) => string = (
  site: CountPairSite,
): string => {
  return `${site.file}:${site.line} {{${site.value}}} filled with ${site.filledWith}`;
};

describe("a count joined to {{count}} by a slash or a colon", () => {
  test("there are such sentences: the Proxmox, VMware, Ceph, Docker Swarm, Kubernetes and IoT count chips", () => {
    const files: Set<string> = new Set<string>(
      SITES.map((site: CountPairSite): string => {
        return site.file;
      }),
    );

    expect(SITES.length).toBeGreaterThan(12);

    for (const page of [
      "packages/App/FeatureSet/Dashboard/src/Pages/IoT/View/Index.tsx",
      "packages/App/FeatureSet/Dashboard/src/Pages/Ceph/View/Index.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/Proxmox/Part/ProxmoxPartHero.tsx",
    ]) {
      expect({ page, scanned: files.has(page) }).toEqual({
        page,
        scanned: true,
      });
    }
  });

  test("is written in the reader's digits, as {{count}} is", () => {
    expect(
      SITES.filter((site: CountPairSite): boolean => {
        return !site.isInReadersDigits;
      }).map(describeSite),
    ).toEqual([]);
  });
});

describe("the guard itself", () => {
  // The IoT fleet chip as it was: its online count passed as a plain number.
  const PLAIN: string = `
    const label = translator.translatePlural(
      {
        one: "{{online}}/{{count}} device online",
        other: "{{online}}/{{count}} devices online",
      },
      totalDevices,
      { online: onlineDevices },
    );
  `;

  test("finds a count passed as a plain number", () => {
    expect(findCountPairSites("Plain.ts", PLAIN)).toEqual([
      {
        file: "Plain.ts",
        line: 2,
        value: "online",
        filledWith: "onlineDevices",
        isInReadersDigits: false,
      },
    ]);
  });

  test("passes it written with formatNumber, or a page's formatCount", () => {
    for (const writer of [
      "translator.formatNumber(onlineDevices)",
      "data.translator.formatNumber(onlineDevices)",
      "formatCount(onlineDevices || 0)",
    ]) {
      const sites: Array<CountPairSite> = findCountPairSites(
        "Written.ts",
        PLAIN.replace("{ online: onlineDevices }", `{ online: ${writer} }`),
      );

      expect(
        sites.map((site: CountPairSite): boolean => {
          return site.isInReadersDigits;
        }),
      ).toEqual([true]);
    }
  });

  test("finds a shorthand value, a missing one, and a TranslatedSentence's", () => {
    const shorthand: Array<CountPairSite> = findCountPairSites(
      "Shorthand.ts",
      PLAIN.replace("{ online: onlineDevices }", "{ online }"),
    );
    const missing: Array<CountPairSite> = findCountPairSites(
      "Missing.ts",
      PLAIN.replace("{ online: onlineDevices }", "{}"),
    );
    const sentence: Array<CountPairSite> = findCountPairSites(
      "Sentence.tsx",
      `const element = (
        <TranslatedSentence
          template={{
            one: "{{count}}:{{left}} left",
            other: "{{count}}:{{left}} left",
          }}
          count={5}
          values={{ left: 3 }}
        />
      );`,
    );

    expect(
      [...shorthand, ...missing, ...sentence].map(
        (site: CountPairSite): [string, boolean] => {
          return [site.filledWith, site.isInReadersDigits];
        },
      ),
    ).toEqual([
      ["online", false],
      ["no online", false],
      ["3", false],
    ]);
  });

  test("leaves alone a sentence that joins no value to {{count}}", () => {
    expect(
      findCountPairSites(
        "Alone.ts",
        `translator.translatePlural(
          { one: "{{count}} device of {{total}}", other: "{{count}} devices of {{total}}" },
          5,
          { total: 7 },
        );
        translator.translateTemplate("{{online}}/{{total}} online", { online: 3, total: 5 });`,
      ),
    ).toEqual([]);
  });
});
