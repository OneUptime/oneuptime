import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import { findDocsNavGroupForUrl } from "../../../FeatureSet/Docs/Utils/Render";
import {
  DOCS_LANGUAGES,
  DocsFence,
  DocsHeading,
  ScannedPage,
  TRANSLATED_LANGUAGES,
  anchorsOf,
  hasPage,
  parseDocsLink,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import {
  anchorProblems,
  cardLines,
  cardTargets,
  comparableFence,
  inlineCode,
  listItemCount,
  navTitle,
} from "./DocsTranslationChecks";
import {
  getServerSetupBackupGuides,
  SERVER_SETUP_GUIDES,
  ServerInstallKind,
} from "Common/Types/ServerSetup/ServerSetupChecklist";
import { describe, expect, it } from "@jest/globals";

/*
 * THE KUBERNETES AND HELM PAGE, SERVED BY THE SERVER ITSELF (#9438).
 *
 * On a Kubernetes install, Server Setup's Backups item opened the Helm
 * chart's production checklist on GitHub's main branch: an air-gapped
 * server's admin could not open it, and it could describe a newer chart
 * than the one installed. It opens this page now, which every OneUptime
 * serves from its own docs, at the heading its link names - in English,
 * which /docs/<category>/<page> opens, and in every docs language, each
 * in the English page's shape.
 */

const PAGE: string = "installation/kubernetes";
const NAV_TITLE: string = "Kubernetes and Helm";

const ENGLISH: string = readPage("en", PAGE);
const ENGLISH_SCANNED: ScannedPage = scanMarkdown(ENGLISH);

const h2: (scanned: ScannedPage) => Array<DocsHeading> = (
  scanned: ScannedPage,
): Array<DocsHeading> => {
  return scanned.headings.filter((heading: DocsHeading) => {
    return heading.level === 2;
  });
};

// The text between one h2 and the next.
const sectionAt: (markdown: string, index: number) => string = (
  markdown: string,
  index: number,
): string => {
  return markdown.split(/\n## /)[index + 1]!.split(/\n## /)[0]!;
};

describe("the Kubernetes backup steps Server Setup opens", () => {
  it("are a page this server serves, at a heading the page has", () => {
    const guide: string = SERVER_SETUP_GUIDES.backupsOnKubernetes;

    expect(guide).toBe("/docs/installation/kubernetes#back-up-your-data");

    // The same guide, wherever the server picks it.
    expect(
      getServerSetupBackupGuides(ServerInstallKind.Kubernetes)[0]!.path,
    ).toBe(guide);

    const link: { page: string; anchor: string } | null = parseDocsLink(
      guide,
    ) as { page: string; anchor: string } | null;

    expect(link).toEqual({ page: PAGE, anchor: "back-up-your-data" });
    expect(hasPage("en", PAGE)).toBe(true);
    expect(anchorsOf("en", PAGE).has("back-up-your-data")).toBe(true);
  });

  it("are listed in the docs' nav, so the docs serve them, in the Installation group", () => {
    expect(findDocsNavGroupForUrl(`/docs/${PAGE}`)?.title).toBe("Installation");

    const links: Array<NavLink> = DocsNav.flatMap((group: NavGroup) => {
      return group.links;
    });
    const link: NavLink | undefined = links.find((candidate: NavLink) => {
      return candidate.title === NAV_TITLE;
    });

    // The nav's Kubernetes and Helm opens this server's page, not Artifact Hub's.
    expect(link?.url).toBe(`/docs/${PAGE}`);
  });

  it("never send a reader off the server for the steps themselves", () => {
    expect(ENGLISH).not.toContain("github.com/OneUptime/oneuptime/blob/main");

    // Artifact Hub is named once, for the chart's every value - never a step.
    expect(ENGLISH.match(/artifacthub\.io/g)).toHaveLength(1);
  });

  it("say how to back up on Kubernetes, never with npm run backup", () => {
    const section: string = sectionAt(ENGLISH, 1);

    expect(h2(ENGLISH_SCANNED)[1]!.slug).toBe("back-up-your-data");
    expect(section).toContain("PostgreSQL");
    expect(section).toContain("ClickHouse");
    expect(section).toContain("/docs/installation/backups");
    expect(section).toContain("CloudNativePG");
    expect(section).toContain("**This server is backed up**");
    expect(section).not.toContain("npm run backup");
  });
});

describe.each(TRANSLATED_LANGUAGES)("the page in %s", (language: string) => {
  const markdown: string = readPage(language, PAGE);
  const scanned: ScannedPage = scanMarkdown(markdown);

  it("is there, titled as its nav link is", () => {
    expect(hasPage(language, PAGE)).toBe(true);
    expect(markdown.split("\n")[0]).toBe(`# ${navTitle(language, NAV_TITLE)}`);
  });

  it("has the English page's sections, cards, lists and code", () => {
    expect(h2(scanned)).toHaveLength(h2(ENGLISH_SCANNED).length);
    expect(listItemCount(markdown)).toBe(listItemCount(ENGLISH));
    expect(
      scanned.fences.map((fence: DocsFence) => {
        return comparableFence(fence);
      }),
    ).toEqual(
      ENGLISH_SCANNED.fences.map((fence: DocsFence) => {
        return comparableFence(fence);
      }),
    );
    expect(inlineCode(markdown).sort()).toEqual(inlineCode(ENGLISH).sort());

    // Cards open the same pages, and the same sections of this one.
    expect(cardTargets(cardLines(markdown))).toEqual(
      cardTargets(cardLines(ENGLISH)),
    );
  });

  it("keeps the backup steps in the English page's second section", () => {
    const section: string = sectionAt(markdown, 1);

    expect(section).toContain("CloudNativePG");
    expect(section).toContain("](/docs/installation/backups)");
    expect(section).toContain('schedule: "0 0 3 * * *"');
  });

  it("links only to headings and pages that are there", () => {
    expect(anchorProblems(language, PAGE)).toEqual([]);
  });
});

describe("the docs languages", () => {
  it("are every language the docs speak, English first", () => {
    expect(DOCS_LANGUAGES[0]).toBe("en");
    expect(TRANSLATED_LANGUAGES).toHaveLength(DOCS_LANGUAGES.length - 1);
  });
});
