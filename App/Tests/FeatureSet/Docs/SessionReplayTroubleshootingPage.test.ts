import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import { SESSION_REPLAY_REFUSAL_REASONS } from "Common/Types/Rum/SessionReplayHealth";
import { SessionReplayDisabledReason } from "Common/Types/Rum/SessionReplay";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Session Replay troubleshooting page, and the nav entry that makes it
 * reachable.
 *
 * Nav membership is load-bearing rather than cosmetic: the docs route looks
 * the requested path up in the canonical English nav and renders NotFound if
 * it is absent, so a markdown file with no nav entry is a 404 even though the
 * file is right there on disk. That failure is invisible in review and only
 * shows up when somebody follows the link.
 *
 * And this particular page IS a link target. The recorder prints its URL into
 * the browser console the moment diagnostics are switched on, so a broken one
 * lands in front of the exact person who is already having trouble.
 */
const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const PAGE_URL: string = "/docs/rum/session-replay-troubleshooting";
const PAGE_PATH: string = path.join(
  CONTENT_DIR,
  "en",
  "rum",
  "session-replay-troubleshooting.md",
);

const NAV_GROUP_TITLE: string = "Real User Monitoring";

function readPage(): string {
  return fs.readFileSync(PAGE_PATH, "utf8");
}

function ownGroup(): NavGroup | undefined {
  return DocsNav.find((group: NavGroup): boolean => {
    return group.title === NAV_GROUP_TITLE;
  });
}

describe("Session Replay troubleshooting docs page", (): void => {
  it("exists on disk", (): void => {
    expect(fs.existsSync(PAGE_PATH)).toBe(true);
  });

  it("is listed in the nav, so the route can find it", (): void => {
    const links: Array<NavLink> = ownGroup()?.links || [];

    expect(
      links.some((link: NavLink): boolean => {
        return link.url === PAGE_URL;
      }),
    ).toBe(true);
  });

  /*
   * The renderer strips the first line, because the title already appears in
   * the page chrome. A page that does not open with an H1 therefore loses its
   * first real paragraph.
   */
  it("opens with an H1 the renderer can strip", (): void => {
    expect(readPage().split("\n")[0]).toBe("# Session Replay Troubleshooting");
  });

  /*
   * Every nav entry in this group must resolve to a file. Scoped to the RUM
   * group rather than the whole nav so this test fails for a reason its own
   * name explains.
   */
  it("leaves no dangling nav entry in the RUM group", (): void => {
    const missing: Array<string> = [];

    for (const link of ownGroup()?.links || []) {
      const relative: string = link.url.replace(/^\/docs\//, "");
      const file: string = path.join(CONTENT_DIR, "en", `${relative}.md`);

      if (!fs.existsSync(file)) {
        missing.push(link.url);
      }
    }

    expect(missing).toEqual([]);
  });

  /*
   * The switches the page documents are string literals in the recorder
   * bundle. If one is renamed in src/Debug.ts and not here, the page tells a
   * customer to type something that does nothing - and there is no build step
   * that would notice, because markdown is not compiled.
   */
  it("documents the switches the recorder actually reads", (): void => {
    const page: string = readPage();

    const debugSource: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../FeatureSet/BrowserRecorder/src/Debug.ts",
      ),
      "utf8",
    );

    for (const literal of [
      "oneuptime.sessionReplay.debug",
      "oneuptime_debug",
    ]) {
      expect(debugSource).toContain(literal);
      expect(page).toContain(literal);
    }

    /* The docs URL the recorder prints has to be this page's own URL. */
    expect(debugSource).toContain(PAGE_URL);
  });

  /*
   * The page is an index of codes, and the recorder's `code` strings are the
   * stable part of the contract - a customer quotes one into a support
   * ticket. A code that no longer exists in the source, or a source code the
   * page never explains, is a broken lookup at the worst moment.
   */
  it("explains the codes the recorder can emit", (): void => {
    const page: string = readPage();

    const sourceDir: string = path.resolve(
      __dirname,
      "../../../FeatureSet/BrowserRecorder/src",
    );

    const emitted: Set<string> = new Set<string>();

    for (const file of fs.readdirSync(sourceDir)) {
      if (!file.endsWith(".ts") || file === "Debug.ts") {
        continue;
      }

      const contents: string = fs.readFileSync(
        path.join(sourceDir, file),
        "utf8",
      );

      const matches: Array<string> =
        contents.match(/\bdebug(?:Log|Warn)\(\s*"([a-z0-9-]+)"/g) || [];

      for (const match of matches) {
        const code: string | undefined = match.split('"')[1];

        if (code) {
          emitted.add(code);
        }
      }
    }

    /* Sanity: the scan found something, so the assertion below is not vacuous. */
    expect(emitted.size).toBeGreaterThan(20);

    const undocumented: Array<string> = Array.from(emitted)
      .filter((code: string): boolean => {
        return !page.includes(`\`${code}\``);
      })
      .sort();

    expect(undocumented).toEqual([]);

    /*
     * And each one as a table row, not merely a mention in prose: the
     * page is a lookup table, and a code that only appears inside another
     * code's explanation has no explanation of its own.
     */
    const withoutRow: Array<string> = Array.from(emitted)
      .filter((code: string): boolean => {
        return !new RegExp(`^\\| \`${code}\`\\s*\\|`, "m").test(page);
      })
      .sort();

    expect(withoutRow).toEqual([]);
  });

  /*
   * docs-tests-e2e-6: the Chunker never flushes an open chunk with no
   * events, so an idle tab posts nothing. A page that says "a chunk every
   * 15 seconds, or the install is broken" hands a false negative to
   * somebody watching the Network tab without touching the page.
   */
  it("says an idle tab posts nothing before calling silence a fault", (): void => {
    const page: string = readPage();
    const opening: string = page.split("\n## ")[0] as string;

    expect(opening).toContain("while the user is doing something");
    expect(opening).toMatch(/idle tab .* posts nothing/);
  });

  /*
   * revokeConsent() no longer ends recording for the page: the recorder
   * keeps running into memory so a later grantConsent() continues on a
   * fresh session (recorder-signals-16). The code row has to say so, or a
   * customer reads "final for the page" and rebuilds their banner around
   * a limitation that no longer exists.
   */
  it("describes revokeConsent() as reversible by a later grantConsent()", (): void => {
    const row: string | undefined = readPage()
      .split("\n")
      .find((line: string): boolean => {
        return line.startsWith("| `api-revoke-consent`");
      });

    expect(row).toBeDefined();
    expect(row).toContain("grantConsent()");
    expect(row).not.toContain("final for the page");
  });

  /*
   * The dashboard's installation test moved to the application's Replay
   * Policy page (settings-setup-17); the project-level path the page used
   * to name no longer has one.
   */
  /*
   * WP-S1: the ingest's answer vocabulary is what a customer reads off the
   * Network tab and off the health card's refusal counts. Every reason the
   * server can send back needs a name on this page, or the count in the
   * dashboard ("212 origin-not-allowed") has nowhere to be looked up.
   */
  it("names every refusal reason the ingest can answer with", (): void => {
    const page: string = readPage();

    expect(SESSION_REPLAY_REFUSAL_REASONS.length).toBeGreaterThan(10);

    const unnamed: Array<string> = SESSION_REPLAY_REFUSAL_REASONS.filter(
      (reason: string): boolean => {
        return !page.includes(`\`${reason}\``);
      },
    ).sort();

    expect(unnamed).toEqual([]);
  });

  /*
   * Same for the config endpoint's disabledReason: it is the single field
   * that answers "why is replay off here", and the page is where the
   * console line points.
   */
  it("explains every disabledReason the config endpoint can send", (): void => {
    const page: string = readPage();

    const reasons: Array<string> = Object.values(SessionReplayDisabledReason);

    expect(reasons.length).toBeGreaterThanOrEqual(6);

    const undocumented: Array<string> = reasons
      .filter((reason: string): boolean => {
        return !new RegExp(`^\\| \`${reason}\`\\s*\\|`, "m").test(page);
      })
      .sort();

    expect(undocumented).toEqual([]);

    /* The two narrowing fields that came with budget-exhausted. */
    expect(page).toContain("`disabledDetail`");
    expect(page).toContain("`budgetResetsAt`");
  });

  /*
   * Every parse error the envelope parser can answer 400 (or, for the one
   * per-chunk case, 422) with is a stable code the recorder prints and a
   * customer quotes. Read as text rather than imported: the parser lives
   * in the Telemetry feature set and pulls the ingest stack with it.
   */
  it("names every envelope parse error the ingest answers with", (): void => {
    const parser: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../FeatureSet/Telemetry/Utils/SessionReplayEnvelopeParser.ts",
      ),
      "utf8",
    );

    const errors: Array<string> = Array.from(
      parser
        .split("export enum SessionReplayEnvelopeError {")[1]
        ?.split("}")[0]
        ?.matchAll(/[=] "([a-z-]+)"/g) || [],
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(errors.length).toBeGreaterThanOrEqual(9);

    const page: string = readPage();

    const unnamed: Array<string> = errors
      .filter((error: string): boolean => {
        return !page.includes(`\`${error}\``);
      })
      .sort();

    expect(unnamed).toEqual([]);
  });

  it("locates the installation test on the Replay Policy page", (): void => {
    const page: string = readPage();

    expect(page).not.toContain("RUM → Session Replay Settings");
    expect(page).toContain("Replay Policy");
  });
});
