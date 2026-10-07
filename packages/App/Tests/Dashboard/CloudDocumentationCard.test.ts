import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The cloud guide's platform picker, pinned at the source level.
 *
 * The App test suite runs in a plain Node environment without a React
 * renderer, so — as EmptyResourceInventoryPages.test.ts does — these tests
 * read the component source and check the wiring that matters:
 *
 *   - the card is a thin wrapper around the shared SetupGuideCard, which
 *     owns the picker, the ingestion key step and the folded sections;
 *   - the picker's options come from the shared platform registry, never
 *     from a hand-typed list that could name a platform ingest rejects;
 *   - `initialPlatform` seeds the picker, and the guide is built for the
 *     picked option through the registry's own validity check, with the
 *     default platform as the fallback;
 *   - the environment page selects cloudPlatform and passes it through.
 *
 * Common/Tests/App/Dashboard/CloudDocumentationCard.test.tsx renders the
 * card, and CloudSetupGuide.test.ts pins every platform's guide.
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

const CARD_PATH: string = path.join(
  DASHBOARD_SRC,
  "Components",
  "Cloud",
  "CloudDocumentationCard.tsx",
);

const GUIDE_PATH: string = path.join(
  DASHBOARD_SRC,
  "Components",
  "Cloud",
  "CloudSetupGuide.ts",
);

const DOCUMENTATION_PAGE_PATH: string = path.join(
  DASHBOARD_SRC,
  "Pages",
  "Cloud",
  "View",
  "Documentation.tsx",
);

function squash(source: string): string {
  return source.replace(/\s+/g, " ");
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function readCode(filePath: string): string {
  return squash(stripComments(fs.readFileSync(filePath, "utf8")));
}

describe("CloudDocumentationCard", () => {
  const code: string = readCode(CARD_PATH);

  test("keeps the props contract the pages depend on", () => {
    expect(code).toContain("export interface ComponentProps {");
    expect(code).toContain("title: string;");
    expect(code).toContain("description: string;");
    expect(code).toContain("initialPlatform?: string | undefined;");
    expect(code).toContain("export default CloudDocumentationCard;");
  });

  test("is a thin wrapper around the shared SetupGuideCard", () => {
    expect(code).toContain('from "../SetupGuide/SetupGuideCard"');
    expect(code).toContain("<SetupGuideCard");
    expect(code).toContain("title={props.title}");
    expect(code).toContain("description={props.description}");
    expect(code).toContain("icon={IconProp.Cloud}");

    /*
     * The key picker, the create-key modal and the markdown viewer are the
     * shared card's; a copy here would drift from every other guide.
     */
    expect(code).not.toContain("ResourceDocumentationCard");
    expect(code).not.toContain("Dropdown");
    expect(code).not.toContain("ModelFormModal");
    expect(code).not.toContain("MarkdownViewer");
    expect(code).not.toContain("useState");
    expect(code).not.toContain("documentationMarkdown");
  });

  test("feeds the picker from the guide's registry-built options", () => {
    expect(code).toContain('optionsLabel="Where does your app run?"');
    expect(code).toContain("options={CLOUD_PLATFORM_OPTIONS}");
    expect(code).toContain('from "./CloudSetupGuide"');

    /*
     * No platform string is typed into the component: a platform ingest
     * does not accept can only be offered if someone adds it to the
     * registry, where the ingest gate and the docs test see it too.
     */
    expect(code).not.toMatch(/"(aws|gcp|azure)_[a-z_]+"/);
  });

  test("opens on the environment's own platform", () => {
    /*
     * Passed through untouched: SetupGuideCard falls back to the first
     * option (ECS) for a value it does not offer, and a valid value the
     * page learns later moves the picker, while an unknown one never
     * overrides what the reader picked.
     */
    expect(code).toContain("initialOption={props.initialPlatform}");
  });

  test("builds the guide for the picked platform with the reader's URL and key", () => {
    expect(code).toContain(
      "getContent={(context: SetupGuideRenderContext): SetupGuideContent => { return getCloudSetupGuide({",
    );
    expect(code).toContain("oneuptimeUrl: context.oneuptimeUrl,");
    expect(code).toContain("apiKey: context.apiKey,");
    expect(code).toContain("platform: resolveCloudPlatform(context.option)");
  });
});

describe("CloudSetupGuide", () => {
  const code: string = readCode(GUIDE_PATH);

  test("builds the picker from the shared registry, grouped by provider", () => {
    expect(code).toContain('from "Common/Types/Cloud/CloudPlatform"');
    expect(code).toContain("MANAGED_CLOUD_PLATFORMS.map(");
    expect(code).toContain("key: descriptor.platform,");
    expect(code).toContain("label: descriptor.productName,");
    expect(code).toContain("description: descriptor.description,");
    expect(code).toContain(
      "group: CLOUD_PROVIDER_LABELS[descriptor.provider],",
    );
  });

  test("resolves a platform through the registry's own lookup, with ECS as the fallback", () => {
    expect(code).toContain(
      "export const DEFAULT_CLOUD_DOC_PLATFORM: ManagedCloudPlatform = ManagedCloudPlatform.AwsEcs;",
    );
    expect(code).toContain("getManagedCloudPlatformDescriptor(platform);");
    expect(code).toContain(
      "return descriptor ? descriptor.platform : DEFAULT_CLOUD_DOC_PLATFORM;",
    );
  });

  test("has a guide for every managed platform, enforced by the builder table's type", () => {
    // Whitespace dropped entirely: Prettier may or may not break the generic.
    expect(code.replace(/\s+/g, "")).toContain(
      "constCLOUD_GUIDE_BUILDERS:Readonly<Record<ManagedCloudPlatform,CloudGuideBuilder>>={",
    );
  });
});

describe("Cloud environment Documentation page", () => {
  const code: string = readCode(DOCUMENTATION_PAGE_PATH);

  test("loads the environment's platform and hands it to the card", () => {
    expect(code).toContain(
      'import CloudDocumentationCard from "../../../Components/Cloud/CloudDocumentationCard";',
    );
    expect(code).toContain(
      "select: { name: true, cloudPlatform: true, cloudResourceKind: true, cloudProvider: true, }",
    );
    expect(code).toContain("initialPlatform={cloudResource.cloudPlatform}");
  });

  test("a discovered resource gets the cloud monitoring guide, opened on its own provider", () => {
    expect(code).toContain(
      'import CloudMonitoringDocumentationCard from "../../../Components/Cloud/CloudMonitoringDocumentationCard";',
    );
    expect(code).toContain(
      "if (isCloudResourceKindResource(cloudResource.cloudResourceKind)) {",
    );
    expect(code).toContain("initialOption={cloudResource.cloudProvider}");
  });

  test("no longer renders the platform-less guide directly", () => {
    expect(code).not.toContain("getCloudDocMarkdown");
    expect(code).not.toContain("<ResourceDocumentationCard");
  });
});
