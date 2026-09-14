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
 *   - the picker's options come from the shared platform registry, never
 *     from a hand-typed list that could name a platform ingest rejects;
 *   - `initialPlatform` seeds the selection through the registry's own
 *     validity check, with the default platform as the fallback;
 *   - the markdown handed to ResourceDocumentationCard is the per-platform
 *     builder, keyed on the current selection;
 *   - the environment page selects cloudPlatform and passes it through.
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

  test("feeds the platform picker from the shared registry", () => {
    expect(code).toContain(
      'import { CLOUD_PROVIDER_LABELS, CloudProvider, MANAGED_CLOUD_PLATFORMS, ManagedCloudPlatform, ManagedCloudPlatformDescriptor, isManagedCloudPlatform, } from "Common/Types/Cloud/CloudPlatform";',
    );
    expect(code).toContain("MANAGED_CLOUD_PLATFORMS.filter(");
    expect(code).toContain("MANAGED_CLOUD_PLATFORMS.map(toDropdownOption)");
    expect(code).toContain("<Dropdown options={PLATFORM_OPTION_GROUPS}");
    expect(code).toContain('ariaLabel="Select cloud platform"');

    /*
     * No platform string is typed into the component: a platform ingest
     * does not accept can only be offered if someone adds it to the
     * registry, where the ingest gate and the docs test see it too.
     */
    expect(code).not.toMatch(/"(aws|gcp|azure)_[a-z_]+"/);
  });

  test("honours initialPlatform through the registry's validity check, with the default as fallback", () => {
    expect(code).toContain(
      "useState<ManagedCloudPlatform>( resolvePlatform(props.initialPlatform), )",
    );
    expect(code).toContain("if (isManagedCloudPlatform(candidate)) {");
    expect(code).toContain("return DEFAULT_CLOUD_DOC_PLATFORM;");

    // A parent that learns the platform later still lands on the right guide.
    expect(code).toContain(
      "useEffect(() => { if (isManagedCloudPlatform(props.initialPlatform)) { setPlatform(props.initialPlatform as ManagedCloudPlatform); } }, [props.initialPlatform]);",
    );
  });

  test("renders the per-platform guide through ResourceDocumentationCard", () => {
    expect(code).toContain(
      "return getCloudDocMarkdownForPlatform(vars, platform);",
    );
    expect(code).toContain(
      "<ResourceDocumentationCard title={props.title} description={props.description} buildMarkdown={buildMarkdown} />",
    );
    expect(code).not.toContain("getCloudDocMarkdown(");
  });

  test("only accepts a picker value the registry knows", () => {
    expect(code).toContain(
      'if (typeof value === "string" && isManagedCloudPlatform(value)) { setPlatform(value as ManagedCloudPlatform); }',
    );
  });
});

describe("Cloud environment Documentation page", () => {
  const code: string = readCode(DOCUMENTATION_PAGE_PATH);

  test("loads the environment's platform and hands it to the card", () => {
    expect(code).toContain(
      'import CloudDocumentationCard from "../../../Components/Cloud/CloudDocumentationCard";',
    );
    expect(code).toContain("select: { name: true, cloudPlatform: true, }");
    expect(code).toContain("initialPlatform={cloudResource.cloudPlatform}");
  });

  test("no longer renders the platform-less guide directly", () => {
    expect(code).not.toContain("getCloudDocMarkdown");
    expect(code).not.toContain("<ResourceDocumentationCard");
  });
});
