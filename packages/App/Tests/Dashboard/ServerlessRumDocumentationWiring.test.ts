import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The serverless and RUM setup guides, pinned at the source level.
 *
 * The App test suite runs in a plain Node environment without a React
 * renderer, so — as EmptyResourceInventoryPages.test.ts does — these tests
 * read the source and check the wiring that matters:
 *
 *   - each card is a thin wrapper around the shared SetupGuideCard, which
 *     owns the picker, the ingestion key step and the folded sections;
 *   - the product pages and the Documentation tabs render those cards, not
 *     the old single-document ResourceDocumentationCard;
 *   - a Documentation tab passes what it knows about its resource — the
 *     function's identifier and platform, the application's identifier and
 *     client type — so the guide opens on the right option with the right
 *     name, and selects those columns to have them.
 *
 * Common/Tests/App/Dashboard/ServerlessDocumentationCard.test.tsx and
 * RumDocumentationCard.test.tsx render the cards; ServerlessSetupGuide.test.ts
 * and RumSetupGuide.test.ts pin every option's guide.
 *
 * Whitespace is squashed so Prettier can reflow props without breaking them.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function squash(source: string): string {
  return source.replace(/\s+/g, " ");
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function readCode(relativePath: string): string {
  return squash(
    stripComments(
      fs.readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8"),
    ),
  );
}

interface GuideCase {
  readonly label: string;
  readonly card: string;
  readonly cardPath: string;
  readonly guidePath: string;
  readonly listPage: string;
  readonly listTitle: string;
  readonly documentationPage: string;
  readonly model: string;
  readonly selectedColumns: ReadonlyArray<string>;
  readonly passedProps: ReadonlyArray<string>;
}

const GUIDES: ReadonlyArray<GuideCase> = [
  {
    label: "serverless functions",
    card: "ServerlessDocumentationCard",
    cardPath: "Components/Serverless/ServerlessDocumentationCard.tsx",
    guidePath: "Components/Serverless/ServerlessSetupGuide.ts",
    listPage: "Pages/Serverless/ServerlessFunctions.tsx",
    listTitle: "Getting Started with Serverless Functions",
    documentationPage: "Pages/Serverless/View/Documentation.tsx",
    model: "serverlessFunction",
    selectedColumns: ["functionIdentifier: true", "cloudPlatform: true"],
    passedProps: [
      "functionName={serverlessFunction.functionIdentifier as string}",
      "cloudPlatform={serverlessFunction.cloudPlatform as string}",
    ],
  },
  {
    label: "RUM applications",
    card: "RumDocumentationCard",
    cardPath: "Components/Rum/RumDocumentationCard.tsx",
    guidePath: "Components/Rum/RumSetupGuide.ts",
    listPage: "Pages/Rum/RumApplications.tsx",
    listTitle: "Getting Started with Real User Monitoring",
    documentationPage: "Pages/Rum/View/Documentation.tsx",
    model: "rumApplication",
    selectedColumns: ["appIdentifier: true", "clientType: true"],
    passedProps: [
      "appName={rumApplication.appIdentifier as string}",
      "clientType={rumApplication.clientType as string}",
    ],
  },
];

describe.each(GUIDES)("the $label guide", (guide: GuideCase) => {
  const card: string = readCode(guide.cardPath);
  const listPage: string = readCode(guide.listPage);
  const documentationPage: string = readCode(guide.documentationPage);

  test("the card is a thin wrapper around SetupGuideCard", () => {
    expect(card).toContain('from "../SetupGuide/SetupGuideCard";');
    expect(card).toContain("<SetupGuideCard");
    expect(card).toContain("getKeyTypeFilter=");
    expect(card).toContain(`export default ${guide.card};`);
    // No key picker or create-key modal of its own.
    expect(card).not.toContain("ModelFormModal");
    expect(card).not.toContain("ModelAPI");
    expect(card).not.toContain("IngestionKeySelector");
  });

  test("the guide itself is pure: no React, no API", () => {
    const source: string = readCode(guide.guidePath);
    expect(source).not.toMatch(/from "react"/);
    expect(source).not.toContain("ModelAPI");
    expect(source).toContain('from "../SetupGuide/SetupGuide"');
  });

  test("the product page shows the card in its empty state", () => {
    expect(listPage).toContain(`<${guide.card} title="${guide.listTitle}"`);
    expect(listPage).toContain(`{count === 0 && ( <${guide.card}`);
  });

  test("the Documentation tab passes what it knows about the resource", () => {
    expect(documentationPage).toContain(`<${guide.card}`);
    for (const column of guide.selectedColumns) {
      expect(documentationPage).toContain(column);
    }
    for (const prop of guide.passedProps) {
      expect(documentationPage).toContain(prop);
    }
  });

  test("neither page uses the old single-document card any more", () => {
    for (const source of [listPage, documentationPage, card]) {
      expect(source).not.toContain("ResourceDocumentationCard");
      expect(source).not.toContain("documentationMarkdown");
      expect(source).not.toContain("buildMarkdown");
    }
  });
});

describe("the RUM Documentation tab", () => {
  test("still leaves the session replay setup to its own page", () => {
    expect(readCode("Pages/Rum/View/Documentation.tsx")).not.toContain(
      "SessionReplaySetupGuide",
    );
  });
});

function listSourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...listSourceFiles(absolutePath));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(absolutePath);
    }
  }

  return files;
}

describe("the old single-document guides", () => {
  test("are gone from the Dashboard: nothing defines or calls them", () => {
    const offenders: Array<string> = listSourceFiles(DASHBOARD_SRC)
      .filter((file: string): boolean => {
        const source: string = fs.readFileSync(file, "utf8");
        return (
          source.includes("getServerlessDocMarkdown") ||
          source.includes("getRumDocMarkdown")
        );
      })
      .map((file: string): string => {
        return path.relative(DASHBOARD_SRC, file);
      });

    expect(offenders).toEqual([]);
  });
});
