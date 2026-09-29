import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

const STATUS_PAGE_SRC: string = path.join(
  __dirname,
  "../../FeatureSet/StatusPage/src",
);

const SOURCE_FILE_PATTERN: RegExp = /\.tsx?$/;

function readCode(relativePath: string): string {
  return fs
    .readFileSync(path.join(STATUS_PAGE_SRC, relativePath), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/\s+/g, " ");
}

function listSourceFiles(relativeDirectory: string = ""): Array<string> {
  const absoluteDirectory: string = path.join(
    STATUS_PAGE_SRC,
    relativeDirectory,
  );
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(absoluteDirectory, {
    withFileTypes: true,
  })) {
    const relativePath: string = relativeDirectory
      ? `${relativeDirectory}/${entry.name}`
      : entry.name;

    if (entry.isDirectory()) {
      files.push(...listSourceFiles(relativePath));
    } else if (SOURCE_FILE_PATTERN.test(entry.name)) {
      files.push(relativePath);
    }
  }

  return files.sort();
}

function occurrences(source: string, search: string): number {
  return source.split(search).length - 1;
}

describe("Status Page active-customization wiring", () => {
  const app: string = readCode("App.tsx");
  const masterPage: string = readCode("Components/MasterPage/MasterPage.tsx");

  test("classifies the shared-origin route synchronously", () => {
    expect(app).toContain(
      "const isPreview: boolean = StatusPageUtil.isPreviewPage();",
    );
    expect(app).not.toContain("setIsPreview");
    expect(app).not.toContain(
      "const [isPreview, setIsPreview] = useState<boolean>(false)",
    );
  });

  test("requires an exact true server signal in both response consumers", () => {
    for (const source of [app, masterPage]) {
      expect(source).toContain('["allowStatusPageCustomizations"] === true');
    }
  });

  test("routes every active field through the shared policy", () => {
    expect(app).toContain("getPermittedStatusPageCustomization(javascript,");
    expect(masterPage).toContain("statusPage.customCSS,");
    expect(masterPage).toContain("statusPage.headerHTML,");
    expect(masterPage).toContain("statusPage.footerHTML,");
    expect(
      occurrences(masterPage, "getPermittedStatusPageCustomization("),
    ).toBe(3);
  });

  test("keeps JavaScript construction in the directly tested executor", () => {
    const filesWithFunctionConstructor: Array<string> =
      listSourceFiles().filter((relativePath: string): boolean => {
        return readCode(relativePath).includes("new Function(");
      });

    expect(filesWithFunctionConstructor).toEqual([
      "Utils/StatusPageCustomizations.ts",
    ]);
    expect(app).toContain("executeStatusPageCustomJavaScript(javascript,");
  });

  test("rechecks the policy at every DOM render sink", () => {
    expect(masterPage).toContain("if (!canRenderCustomizations || !customCss)");
    expect(masterPage).toContain(
      "{!canRenderCustomizations || !headerHtml ? (",
    );
    expect(masterPage).toContain(
      "{!canRenderCustomizations || !footerHtml ? (",
    );
    expect(occurrences(masterPage, "dangerouslySetInnerHTML")).toBe(2);
  });
});
