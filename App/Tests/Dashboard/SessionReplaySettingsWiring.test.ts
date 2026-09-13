import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import nodePath from "path";
import slugify from "Common/Server/Types/MarkdownSlugify";

/*
 * Source-structural pins for the session replay settings surfaces.
 *
 * The .tsx sources are read as text rather than imported, because react is
 * a Dashboard dependency that App's own install never provides (same shape
 * as SecurityEventsSetupGuide.test.ts). What is pinned here is the wiring
 * the design and the audit findings care about, each of which fails
 * silently on screen if it regresses:
 *
 *  - the application page composes health -> policy -> privacy -> install
 *    test -> targeted capture, with the two panels pinned to the
 *    application (settings-setup-17);
 *  - the project page no longer mounts the two panels and keeps the master
 *    switch and roster;
 *  - the 0% + Always alert exists;
 *  - the RUM settings section is not collapsed and the two side-menu
 *    entries no longer share a name (settings-setup-5);
 *  - the audit page's Viewed By filter is wired (settings-setup-9), the
 *    watched-time bucket matches the server (settings-setup-10);
 *  - the policy card's model id is stable across renders and its Recording
 *    pill reads health itself, not from a closure frozen at mount;
 *  - no Dashboard replay file imports a server service into the bundle.
 */

const DASHBOARD_SRC: string = nodePath.join(
  __dirname,
  "../../FeatureSet/Dashboard/src",
);

function readSource(relativePath: string): string {
  return fs.readFileSync(nodePath.join(DASHBOARD_SRC, relativePath), "utf8");
}

const APP_SETTINGS_PAGE: string = readSource(
  "Pages/Rum/View/SessionReplaySettings.tsx",
);
const PROJECT_SETTINGS_PAGE: string = readSource(
  "Pages/Rum/Settings/SessionReplay.tsx",
);
const RUM_SIDE_MENU: string = readSource("Pages/Rum/SideMenu.tsx");
const APP_SIDE_MENU: string = readSource("Pages/Rum/View/SideMenu.tsx");
const AUDIT_PAGE: string = readSource("Pages/Rum/View/SessionReplayAudit.tsx");
const SETUP_GUIDE: string = readSource(
  "Components/SessionReplay/SessionReplaySetupGuide.tsx",
);
const INSTALL_SNIPPET: string = readSource(
  "Components/SessionReplay/SessionReplayInstallSnippet.tsx",
);
const INSTALL_PANEL: string = readSource(
  "Components/SessionReplay/InstallationTestPanel.tsx",
);
const PRIVACY_SUMMARY: string = readSource(
  "Components/SessionReplay/PrivacySummaryCard.tsx",
);

/* The docs page the guide's per-step links point into. */
const SESSION_REPLAY_DOC: string = nodePath.join(
  __dirname,
  "../../FeatureSet/Docs/Content/en/telemetry/session-replay.md",
);

const HEADING_PATTERN: RegExp = new RegExp("^#{1,6}\\s+(.+?)\\s*$");
const FENCE_PATTERN: RegExp = new RegExp("^\\s*```");

/* Same rule the renderer uses, so an anchor that passes here resolves. */
function headingSlugs(markdown: string): Set<string> {
  const slugs: Set<string> = new Set<string>();
  let inFence: boolean = false;

  for (const line of markdown.split("\n")) {
    if (FENCE_PATTERN.test(line)) {
      inFence = !inFence;
      continue;
    }

    if (inFence) {
      continue;
    }

    const match: RegExpMatchArray | null = line.match(HEADING_PATTERN);

    if (match) {
      slugs.add(slugify(match[1] as string));
    }
  }

  return slugs;
}

/*
 * As RegExp constants rather than inline literals: eslint's wrap-regex
 * wants an inline `.test(` regex parenthesised and prettier strips the
 * parentheses, so neither form passes both.
 */
const SERVER_IMPORT_PATTERN: RegExp = new RegExp("from [\"']Common/Server/");
const DOCS_ANCHOR_PATTERN: RegExp = new RegExp(
  'docsAnchor="([a-z0-9-]+)"',
  "g",
);
const SERVER_SERVICE_IMPORT_PATTERN: RegExp = new RegExp(
  "from [\"']Common/Server/Services",
);
const RRWEB_IMPORT_PATTERN: RegExp = new RegExp("from [\"']rrweb");
const FIELD_DECLARATION_PATTERN: RegExp = new RegExp(
  "field: \\{ (sessionReplay[A-Za-z]+|isSessionReplayEnabled): true \\}",
  "g",
);

function indexOfOrFail(haystack: string, needle: string): number {
  const index: number = haystack.indexOf(needle);

  expect(index).toBeGreaterThanOrEqual(0);

  return index;
}

const BLOCK_COMMENT_PATTERN: RegExp = new RegExp("/\\*[\\s\\S]*?\\*/", "g");
const LINE_COMMENT_PATTERN: RegExp = new RegExp("^\\s*//.*$", "gm");
const DECLARATION_END_PATTERN: RegExp = new RegExp("\\n\\};?\\n");

/* Code only: a comment explaining the old bug may name what it did. */
function stripComments(source: string): string {
  return source
    .replace(BLOCK_COMMENT_PATTERN, "")
    .replace(LINE_COMMENT_PATTERN, "");
}

/*
 * One top-level declaration, from its opening to the "}" or "};" that closes
 * it. Prettier indents everything inside a declaration, so the first brace on
 * a line of its own is the closing one.
 */
function topLevelDeclaration(source: string, opening: RegExp): string {
  const start: RegExpMatchArray | null = source.match(opening);

  expect({ opening: opening.source, found: start !== null }).toEqual({
    opening: opening.source,
    found: true,
  });

  const rest: string = source.slice(start?.index ?? 0);
  const end: RegExpMatchArray | null = rest.match(DECLARATION_END_PATTERN);

  expect({ opening: opening.source, closed: end !== null }).toEqual({
    opening: opening.source,
    closed: true,
  });

  return rest.slice(0, (end?.index ?? rest.length) + (end?.[0].length ?? 0));
}

describe("Application replay settings page composition", () => {
  test("composes health -> policy -> privacy summary -> install test -> targeted capture, in that order", () => {
    const health: number = indexOfOrFail(
      APP_SETTINGS_PAGE,
      "<RecordingHealthCard rumApplicationId={modelId} />",
    );
    const policy: number = indexOfOrFail(
      APP_SETTINGS_PAGE,
      "<CardModelDetail<RumApplication>",
    );
    const privacy: number = indexOfOrFail(
      APP_SETTINGS_PAGE,
      "<PrivacySummaryCard",
    );
    const install: number = indexOfOrFail(
      APP_SETTINGS_PAGE,
      "<InstallationTestPanel rumApplicationId={modelId} />",
    );
    const targeted: number = indexOfOrFail(
      APP_SETTINGS_PAGE,
      "<TargetedCapturePanel rumApplicationId={modelId} />",
    );

    expect(health).toBeLessThan(policy);
    expect(policy).toBeLessThan(privacy);
    expect(privacy).toBeLessThan(install);
    expect(install).toBeLessThan(targeted);
  });

  test("the 0% + Always alert exists and names the fix", () => {
    expect(APP_SETTINGS_PAGE).toContain("sessionReplaySamplePercentage === 0");
    expect(APP_SETTINGS_PAGE).toContain("SessionReplayCaptureTrigger.Always");
    expect(APP_SETTINGS_PAGE).toContain('dataTestId="sample-zero-alert"');
    expect(APP_SETTINGS_PAGE).toContain("Nothing is being recorded");
  });

  test("the privacy summary's Change links jump to the policy card anchor", () => {
    expect(APP_SETTINGS_PAGE).toContain("<div id={REPLAY_POLICY_ANCHOR_ID}>");
    expect(APP_SETTINGS_PAGE).toContain(
      "changeHref={`#${REPLAY_POLICY_ANCHOR_ID}`}",
    );
  });

  test("the read view labels enums and never prints 0% for an unset sample (settings-setup-11)", () => {
    expect(APP_SETTINGS_PAGE).toContain("labelEnum(");
    expect(APP_SETTINGS_PAGE).toContain("CAPTURE_TRIGGER_LABELS");
    expect(APP_SETTINGS_PAGE).toContain("CONSENT_MODE_LABELS");
    expect(APP_SETTINGS_PAGE).not.toContain(
      "sessionReplaySamplePercentage ?? 0",
    );
    expect(APP_SETTINGS_PAGE).toContain("not set (defaults to 100%)");
  });

  test("the read view shows every policy field the form edits (settings-setup-12)", () => {
    const formFields: Array<string> = Array.from(
      APP_SETTINGS_PAGE.matchAll(FIELD_DECLARATION_PATTERN),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });
    const unique: Array<string> = Array.from(new Set(formFields));

    /* Each field name must appear at least twice: once in formFields, once in the read view. */
    for (const field of unique) {
      const occurrences: number = formFields.filter((name: string): boolean => {
        return name === field;
      }).length;

      expect({ field, occurrences }).toEqual({ field, occurrences: 2 });
    }

    expect(unique).toContain("sessionReplayMaskSelectors");
    expect(unique).toContain("sessionReplayBlockSelectors");
    expect(unique).toContain("sessionReplayRecordCanvas");
    expect(unique).toContain("sessionReplayTracePropagationOrigins");
    expect(unique).toContain("sessionReplayMonthlyBudgetInGB");
  });

  test("the monthly budget no longer invites typing 0 as a budget (settings-setup-15)", () => {
    expect(APP_SETTINGS_PAGE).toContain(
      "0 or blank means no application-level ceiling",
    );
    expect(APP_SETTINGS_PAGE).not.toMatch(
      /sessionReplayMonthlyBudgetInGB: true \},[\s\S]{0,400}placeholder: "0"/,
    );
  });

  test("the effective recording pill reads the diagnosis, not the flag alone (settings-setup-4)", () => {
    expect(APP_SETTINGS_PAGE).toContain("describeEffectiveRecordingState(");
    expect(APP_SETTINGS_PAGE).toContain('case "disabled-project"');
    expect(APP_SETTINGS_PAGE).toContain('case "budget-paused"');
  });

  /*
   * ux-09. RumSession derives retentionDate from the clamped session start
   * "keeps the header's retentionDate equal to its chunks'", so the session
   * row expires WITH its footage. Both surfaces that describe retention to a
   * customer promised the opposite, which is the one direction a retention
   * promise must never be wrong in.
   */
  test("retention copy does not promise that session metadata outlives the footage (ux-09)", () => {
    for (const source of [APP_SETTINGS_PAGE, PRIVACY_SUMMARY]) {
      expect(source).not.toContain("kept longer");
      expect(source).not.toContain("stays accurate after playback expires");
      expect(source).toContain(
        "logs, spans and exceptions follow the telemetry retention",
      );
    }

    expect(APP_SETTINGS_PAGE).toContain(
      "The session row - counts, signals, device - expires together with its footage",
    );
    expect(PRIVACY_SUMMARY).toContain("expires with it");
  });
});

const PAGE_COMPONENT_OPENING: RegExp = new RegExp(
  "const RumApplicationSessionReplaySettings\\s*:\\s*FunctionComponent<",
);
const PILL_OPENING: RegExp = new RegExp(
  "export function EffectiveRecordingStatePill\\s*\\(",
);
/* Argument lists allow the trailing comma prettier adds when it breaks them. */
const MODEL_ID_STRING_PATTERN: RegExp = new RegExp(
  "const\\s+(\\w+)\\s*:\\s*string\\s*=\\s*Navigation\\.getLastParamAsString\\(\\s*1\\s*,?\\s*\\)",
);
/* Accepts React.useMemo and an omitted return type as well. */
const MEMOIZED_MODEL_ID_PATTERN: RegExp = new RegExp(
  "const\\s+modelId\\s*:\\s*ObjectID\\s*=\\s*(?:React\\.)?useMemo\\(\\s*\\(\\s*\\)\\s*(?::\\s*ObjectID\\s*)?=>\\s*" +
    "(?:\\{\\s*return\\s+)?new\\s+ObjectID\\(\\s*(\\w+)\\s*,?\\s*\\)\\s*;?\\s*\\}?\\s*," +
    "\\s*\\[([^\\]]*)\\]\\s*,?\\s*\\)",
);
const ON_ITEM_LOADED_LIFT_PATTERN: RegExp = new RegExp(
  "onItemLoaded\\s*:\\s*\\(\\s*item\\s*:\\s*RumApplication\\s*,?\\s*\\)\\s*:\\s*void\\s*=>\\s*" +
    "\\{\\s*setApplication\\(\\s*item\\s*,?\\s*\\)",
);
const RECORDING_FIELD_PATTERN: RegExp = new RegExp(
  'field:\\s*\\{\\s*isSessionReplayEnabled:\\s*true\\s*\\},\\s*title:\\s*"Recording",\\s*fieldType:\\s*FieldType\\.Element,\\s*getElement:',
);
const NEXT_FIELD_PATTERN: RegExp = new RegExp("\\bfield:\\s*\\{");
const DIAGNOSIS_IDENTIFIER_PATTERN: RegExp = new RegExp("\\bdiagnosis\\b");
const PILL_ELEMENT_PATTERN: RegExp = new RegExp(
  "<EffectiveRecordingStatePill\\s[\\s\\S]*?isApplicationEnabled=\\{\\s*item\\.isSessionReplayEnabled\\s*\\}[\\s\\S]*?/>",
);
const HEALTH_CALL_PATTERN: RegExp = new RegExp(
  "useSessionReplayHealth\\(",
  "g",
);
const PILL_HEALTH_PATTERN: RegExp = new RegExp(
  "useSessionReplayHealth\\(\\s*props\\.rumApplicationId\\b",
);
const PILL_STATE_PATTERN: RegExp = new RegExp(
  "describeEffectiveRecordingState\\(\\s*props\\.isApplicationEnabled\\s*,",
);

const APP_SETTINGS_CODE: string = stripComments(APP_SETTINGS_PAGE);

/* Sliced per test, so a missing declaration fails the test, not the suite. */
function pageComponentBody(): string {
  return topLevelDeclaration(APP_SETTINGS_CODE, PAGE_COMPONENT_OPENING);
}

describe("Replay policy card does not reload in a loop", () => {
  /*
   * ModelDetail refetches when its modelId changes by identity. The page
   * lifts every loaded row into state through onItemLoaded, so each load
   * re-renders the page: an id built fresh in render handed the card a new
   * ObjectID on every render and the card sat on its loading bar forever.
   * The lift is pinned alongside the memo because it is what makes the memo
   * load-bearing - neither may go on the belief the other covers it.
   */
  test("modelId is memoized on the route param, because onItemLoaded re-renders the page", () => {
    const pageBody: string = pageComponentBody();

    expect(pageBody).not.toContain("getLastParamAsObjectID");

    const idString: RegExpMatchArray | null = pageBody.match(
      MODEL_ID_STRING_PATTERN,
    );

    expect(idString?.[1]).toBeDefined();

    const memo: RegExpMatchArray | null = pageBody.match(
      MEMOIZED_MODEL_ID_PATTERN,
    );

    expect(memo).not.toBeNull();

    const dependencies: Array<string> = (memo?.[2] ?? "")
      .split(",")
      .map((name: string): string => {
        return name.trim();
      })
      .filter((name: string): boolean => {
        return name.length > 0;
      });

    expect({ builtFrom: memo?.[1], dependencies }).toEqual({
      builtFrom: idString?.[1],
      dependencies: [idString?.[1]],
    });

    expect(pageBody).toMatch(ON_ITEM_LOADED_LIFT_PATTERN);
  });

  /*
   * ModelDetail builds its field renderers once, at mount, before health has
   * answered. A getElement that reads the page's diagnosis keeps that first
   * (null) value, so the pill would read "project switch not checked yet"
   * for the life of the page.
   */
  test("the Recording field renders EffectiveRecordingStatePill and reads no page-level diagnosis", () => {
    const pageBody: string = pageComponentBody();
    const field: RegExpMatchArray | null = pageBody.match(
      RECORDING_FIELD_PATTERN,
    );

    expect(field).not.toBeNull();

    const afterGetElement: string = pageBody.slice(
      (field?.index ?? 0) + (field?.[0].length ?? 0),
    );
    const nextField: RegExpMatchArray | null =
      afterGetElement.match(NEXT_FIELD_PATTERN);
    const getElement: string = afterGetElement.slice(
      0,
      nextField?.index ?? afterGetElement.length,
    );

    expect(getElement).toMatch(PILL_ELEMENT_PATTERN);
    expect(getElement).not.toMatch(DIAGNOSIS_IDENTIFIER_PATTERN);
  });

  test("the pill subscribes to health itself and the page component no longer does", () => {
    const pageBody: string = pageComponentBody();
    const pill: string = topLevelDeclaration(APP_SETTINGS_CODE, PILL_OPENING);

    expect(pill).toMatch(PILL_HEALTH_PATTERN);
    expect(pill).toMatch(PILL_STATE_PATTERN);

    /* A page-level subscription re-rendered the page on every health poll. */
    expect(pageBody.match(HEALTH_CALL_PATTERN)).toBeNull();
  });
});

describe("Project replay settings page", () => {
  /*
   * server-1's UI half on the roster. sessionReplayBudgetExceededAt is the
   * LAST exhaustion and is never cleared, so an unqualified pill claimed an
   * application was over budget for the life of the row. The roster has no
   * usage counter, only the stamp - and both windows that write it are
   * UTC-bucketed (the project's daily cap, the application's month), so a
   * stamp from an earlier month belongs to a window that has certainly
   * rolled over. The page is read as source because App's install has no
   * react to render it with; the assertion is on the branch that decides
   * the pill.
   */
  test("the budget pill is qualified by its window, not by the bare stamp (server-1)", () => {
    expect(PROJECT_SETTINGS_PAGE).toContain("isInCurrentUtcMonth(");
    expect(PROJECT_SETTINGS_PAGE).toContain("stamp.getUTCFullYear()");
    expect(PROJECT_SETTINGS_PAGE).toContain("stamp.getUTCMonth()");
    expect(PROJECT_SETTINGS_PAGE).toContain(
      'text="On, budget exhausted this month"',
    );
    /* The unqualified claim, and a bare-stamp branch, must both be gone. */
    expect(PROJECT_SETTINGS_PAGE).not.toContain('text="On, budget exhausted"');
    expect(PROJECT_SETTINGS_PAGE).not.toMatch(
      /if \(item\.sessionReplayBudgetExceededAt\) \{/,
    );
  });

  test("keeps the master switch and the roster, drops the two panels, and points at the application page", () => {
    expect(PROJECT_SETTINGS_PAGE).toContain("<CardModelDetail<Project>");
    expect(PROJECT_SETTINGS_PAGE).toContain("<ModelTable<RumApplication>");
    expect(PROJECT_SETTINGS_PAGE).not.toContain("InstallationTestPanel");
    expect(PROJECT_SETTINGS_PAGE).not.toContain("TargetedCapturePanel");
    expect(PROJECT_SETTINGS_PAGE).toContain(
      'dataTestId="project-replay-pointer"',
    );
    expect(PROJECT_SETTINGS_PAGE).toContain(
      "PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_SETTINGS",
    );
  });

  test("the roster shows liveness and consent and never prints 0% for an unset sample", () => {
    expect(PROJECT_SETTINGS_PAGE).toContain(
      "sessionReplayLastChunkReceivedAt: true",
    );
    expect(PROJECT_SETTINGS_PAGE).toContain("sessionReplayConsentMode: true");
    expect(PROJECT_SETTINGS_PAGE).toContain("Never received");
    expect(PROJECT_SETTINGS_PAGE).not.toContain(
      "sessionReplaySamplePercentage ?? 0",
    );
  });
});

describe("Side menus (settings-setup-5)", () => {
  test("the RUM Settings section is not collapsed by default", () => {
    expect(RUM_SIDE_MENU).not.toContain("defaultCollapsed: true");
    expect(RUM_SIDE_MENU).toContain("PageMap.RUM_SETTINGS_SESSION_REPLAY");
  });

  test("the application menu has exactly one 'Session Replay' entry and a distinct policy entry", () => {
    const sessionReplayTitles: number = (
      APP_SIDE_MENU.match(/title: "Session Replay"/g) ?? []
    ).length;

    expect(sessionReplayTitles).toBe(1);
    expect(APP_SIDE_MENU).toContain('title: "Replay Policy"');
    expect(APP_SIDE_MENU).toContain(
      "PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_SETTINGS",
    );
  });
});

describe("Replay access log page", () => {
  test("the Viewed By filter is wired with an entity type and dropdown field (settings-setup-9)", () => {
    const filterStart: number = indexOfOrFail(AUDIT_PAGE, 'title: "Viewed By"');
    const filterBlock: string = AUDIT_PAGE.slice(
      filterStart,
      filterStart + 700,
    );

    expect(filterBlock).toContain("filterEntityType: User");
    expect(filterBlock).toContain("fetchFilterDropdownOptions");
    expect(filterBlock).toContain("filterDropdownField");
  });

  test("watched time under one bucket reads '< 15s', never 'Opened only' (settings-setup-10)", () => {
    expect(AUDIT_PAGE).not.toContain("Opened only");
    expect(AUDIT_PAGE).toContain("describeSecondsWatched(");

    /* The bucket mirrors the server's floor; the two must not drift. */
    const serverSource: string = fs.readFileSync(
      nodePath.join(
        __dirname,
        "../../../Common/Server/Services/RumSessionReplayViewService.ts",
      ),
      "utf8",
    );
    const serverBucket: RegExpMatchArray | null = serverSource.match(
      /SESSION_REPLAY_WATCH_BUCKET_SECONDS: number = (\d+)/,
    );
    const dashboardBucket: RegExpMatchArray | null = AUDIT_PAGE.match(
      /SESSION_REPLAY_WATCH_BUCKET_SECONDS: number = (\d+)/,
    );

    expect(serverBucket?.[1]).toBeDefined();
    expect(dashboardBucket?.[1]).toBe(serverBucket?.[1]);
  });

  test("the Reason column explains an empty value instead of rendering blank", () => {
    expect(AUDIT_PAGE).toContain("None given (opened from the list)");
  });
});

describe("Setup guide and snippet wiring", () => {
  test("'Run the installation test' targets the application's own settings page (settings-setup-17)", () => {
    const buttonStart: number = indexOfOrFail(
      SETUP_GUIDE,
      'title="Run the installation test"',
    );
    const buttonBlock: string = SETUP_GUIDE.slice(
      buttonStart,
      buttonStart + 600,
    );

    expect(buttonBlock).toContain(
      "PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_SETTINGS",
    );
    expect(buttonBlock).toContain("modelId: props.rumApplicationId");
    expect(SETUP_GUIDE).not.toContain("PageMap.RUM_SETTINGS_SESSION_REPLAY]");
  });

  test("the guide and the panel share one snippet component; neither prints its own script tag", () => {
    expect(SETUP_GUIDE).toContain("<SessionReplayInstallSnippet");
    expect(INSTALL_PANEL).toContain("<SessionReplayInstallSnippet");
    expect(SETUP_GUIDE).not.toContain("<script\n");
    expect(INSTALL_PANEL).not.toContain("<script\n");
    expect(INSTALL_SNIPPET).toContain("buildCspSnippet");
  });

  test("the CSP snippet keeps 'self' (session-list-15)", () => {
    expect(INSTALL_SNIPPET).toContain("script-src  'self' ${oneuptimeUrl};");
    expect(INSTALL_SNIPPET).toContain("connect-src 'self' ${oneuptimeUrl};");
  });

  test("the installation test no longer says a silent recorder is usually fine (settings-setup-2)", () => {
    expect(INSTALL_PANEL).not.toContain("usually working correctly");
    expect(INSTALL_PANEL).toContain("the install is broken");
  });

  /*
   * WP-DOC's request: each step that has a fuller docs section links to that
   * section, not to the top of a 500-line page. The anchors are computed
   * from heading text, so they are pinned against the real headings here -
   * a heading rename would otherwise break the links with no compile error
   * on either side.
   */
  test("each setup step links to the docs section that continues it, and every anchor resolves", () => {
    const anchors: Array<string> = Array.from(
      SETUP_GUIDE.matchAll(DOCS_ANCHOR_PATTERN),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(anchors).toEqual([
      "identify-your-users",
      "content-security-policy",
      "correlating-with-your-other-telemetry",
    ]);

    expect(SETUP_GUIDE).toContain(
      'SETUP_GUIDE_DOCS_PATH: string = "/telemetry/session-replay"',
    );

    const slugs: Set<string> = headingSlugs(
      fs.readFileSync(SESSION_REPLAY_DOC, "utf8"),
    );

    for (const anchor of anchors) {
      expect({ anchor, resolves: slugs.has(anchor) }).toEqual({
        anchor,
        resolves: true,
      });
    }
  });

  test("the guide never opens a manifest (an audit row) to find the newest session", () => {
    expect(SETUP_GUIDE).not.toContain("/manifest");
    expect(SETUP_GUIDE).toContain("/telemetry/rum/session-replay/list");
  });
});

describe("Bundle hygiene", () => {
  test("no replay Dashboard file imports a server Service or the rrweb package", () => {
    const replayDir: string = nodePath.join(
      DASHBOARD_SRC,
      "Components/SessionReplay",
    );
    const pageFiles: Array<string> = [
      "Pages/Rum/View/SessionReplaySettings.tsx",
      "Pages/Rum/View/SessionReplayAudit.tsx",
      "Pages/Rum/View/SessionReplayHealth.tsx",
      "Pages/Rum/Settings/SessionReplay.tsx",
    ];
    const ownedComponents: Array<string> = [
      "useSessionReplayHealth.ts",
      "RecordingHealthCard.tsx",
      "RecordingHealthDashboard.tsx",
      "RecordingHealthModel.ts",
      "RecorderDiagnosticsExplainer.ts",
      "SessionReplayInstallSnippet.tsx",
      "PrivacySummaryCard.tsx",
      "SessionReplaySetupGuide.tsx",
      "InstallationTestPanel.tsx",
      "TargetedCapturePanel.tsx",
      "RumInstrumentation.ts",
    ];

    for (const fileName of ownedComponents) {
      const source: string = fs.readFileSync(
        nodePath.join(replayDir, fileName),
        "utf8",
      );

      /* Import statements only: a comment may point at a server file by name. */
      expect({
        fileName,
        server: SERVER_IMPORT_PATTERN.test(source),
      }).toEqual({
        fileName,
        server: false,
      });
      expect({ fileName, rrweb: RRWEB_IMPORT_PATTERN.test(source) }).toEqual({
        fileName,
        rrweb: false,
      });
    }

    for (const relativePath of pageFiles) {
      expect({
        relativePath,
        serverService: SERVER_SERVICE_IMPORT_PATTERN.test(
          readSource(relativePath),
        ),
      }).toEqual({ relativePath, serverService: false });
    }
  });
});
