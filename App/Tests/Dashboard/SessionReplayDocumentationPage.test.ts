import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import slugify from "Common/Server/Types/MarkdownSlugify";

/*
 * Session Replay > Documentation: a side menu item, a page that renders the
 * setup guide and the docs reference, and a reference whose anchors point at
 * real headings. Each of these fails silently - a missing menu item is a page
 * nobody finds, and a stale anchor opens the docs at the top of a 500-line
 * page. Same source-text shape as SessionReplayUsersPageWiring.test.ts.
 */

const dashboardSource: string = path.join(
  __dirname,
  "../../FeatureSet/Dashboard/src",
);

const docsContent: string = path.join(
  __dirname,
  "../../FeatureSet/Docs/Content/en",
);

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function read(relativePath: string): string {
  return stripComments(
    fs.readFileSync(path.join(dashboardSource, relativePath), "utf8"),
  );
}

/* Heading ids exactly as the docs renderer produces them. */
function headingSlugs(markdown: string): Set<string> {
  const withoutFences: string = markdown.replace(/```[\s\S]*?```/g, "");
  const slugs: Set<string> = new Set<string>();

  for (const match of withoutFences.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    slugs.add(slugify(match[1]!.replace(/`/g, "")));
  }

  return slugs;
}

const sideMenuSource: string = read("Pages/Rum/View/SideMenu.tsx");
const pageSource: string = read(
  "Pages/Rum/View/SessionReplayDocumentation.tsx",
);
const rumDocumentationSource: string = read("Pages/Rum/View/Documentation.tsx");
const referenceSource: string = read(
  "Components/SessionReplay/SessionReplayDocsReference.tsx",
);
const healthCardSource: string = read(
  "Components/SessionReplay/RecordingHealthCard.tsx",
);

describe("Session Replay > Documentation is reachable", () => {
  test("the Session Replay section ends with a Documentation item on the new key", () => {
    const sectionStart: number = sideMenuSource.indexOf(
      'title="Session Replay"',
    );
    const sectionEnd: number = sideMenuSource.indexOf(
      "</SideMenuSection>",
      sectionStart,
    );

    expect(sectionStart).toBeGreaterThan(-1);
    expect(sectionEnd).toBeGreaterThan(sectionStart);

    const section: string = sideMenuSource.slice(sectionStart, sectionEnd);
    const auditIndex: number = section.indexOf('title: "Replay Access Log"');
    const docsIndex: number = section.indexOf('title: "Documentation"');

    expect(auditIndex).toBeGreaterThan(-1);
    expect(docsIndex).toBeGreaterThan(auditIndex);

    const docsItem: string = section.slice(docsIndex);

    expect(docsItem).toContain(
      "PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_DOCUMENTATION",
    );
    expect(docsItem).toContain("IconProp.BookOpen");
  });

  test("the page renders the setup guide and the docs reference for the application in the URL", () => {
    expect(pageSource).toMatch(/<SessionReplaySetupGuide\s+rumApplicationId=/);
    expect(pageSource).toContain("<SessionReplayDocsReference />");
    expect(pageSource).toContain("Navigation.getLastParamAsObjectID(1)");
  });

  test("the setup guide lives on one page only", () => {
    expect(rumDocumentationSource).not.toContain("SessionReplaySetupGuide");
  });

  test("every setup-guide action lands on the new page", () => {
    const setupGuideCase: string = healthCardSource.slice(
      healthCardSource.indexOf('case "setup-guide":'),
      healthCardSource.indexOf('case "docs-consent":'),
    );

    expect(setupGuideCase).toContain(
      "PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_DOCUMENTATION",
    );
  });
});

describe("the docs reference points at real documentation", () => {
  const sessionReplayDocs: string = fs.readFileSync(
    path.join(docsContent, "telemetry/session-replay.md"),
    "utf8",
  );
  const slugs: Set<string> = headingSlugs(sessionReplayDocs);
  const anchors: Array<string> = Array.from(
    referenceSource.matchAll(/anchor:\s*"([^"]+)"/g),
  ).map((match: RegExpMatchArray): string => {
    return match[1]!;
  });

  test("the reference lists topics", () => {
    expect(anchors.length).toBeGreaterThanOrEqual(10);
    expect(new Set<string>(anchors).size).toBe(anchors.length);
  });

  test("every anchor is a heading on the session replay docs page", () => {
    for (const anchor of anchors) {
      expect([anchor, slugs.has(anchor)]).toEqual([anchor, true]);
    }
  });

  test("the docs paths the reference uses exist", () => {
    const setupGuideSource: string = read(
      "Components/SessionReplay/SessionReplaySetupGuide.tsx",
    );
    const docsPaths: Array<string> = [
      ...Array.from(
        setupGuideSource.matchAll(/SETUP_GUIDE_DOCS_PATH: string = "([^"]+)"/g),
      ),
      ...Array.from(
        healthCardSource.matchAll(
          /TROUBLESHOOTING_DOCS_PATH: string =\s*"([^"]+)"/g,
        ),
      ),
    ].map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(docsPaths).toHaveLength(2);

    for (const docsPath of docsPaths) {
      expect([
        docsPath,
        fs.existsSync(path.join(docsContent, `${docsPath}.md`)),
      ]).toEqual([docsPath, true]);
    }
  });
});
