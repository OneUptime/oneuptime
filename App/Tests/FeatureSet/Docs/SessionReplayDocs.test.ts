import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import { REPLAY_SHORTCUT_GROUPS } from "../../../FeatureSet/Dashboard/src/Components/SessionReplay/ReplayKeyboardMap";
import slugify from "Common/Server/Types/MarkdownSlugify";
import Permission from "Common/Types/Permission";
import {
  SESSION_REPLAY_ALLOWED_RETENTION_DAYS,
  SESSION_REPLAY_KEEPALIVE_MAX_BYTES,
  SESSION_REPLAY_MAX_CAPTURE_REASON_LENGTH,
  SESSION_REPLAY_MAX_CUSTOM_EVENTS_PER_CHUNK,
  SESSION_REPLAY_MAX_CUSTOM_EVENT_NAME_LENGTH,
  SESSION_REPLAY_MAX_TAG_KEYS,
  SESSION_REPLAY_MAX_TAG_KEY_LENGTH,
  SESSION_REPLAY_MAX_TAG_VALUE_LENGTH,
  SESSION_REPLAY_MAX_TRAIT_KEYS,
  SESSION_REPLAY_MAX_TRAIT_KEY_LENGTH,
  SESSION_REPLAY_MAX_TRAIT_VALUE_LENGTH,
} from "Common/Types/Rum/SessionReplay";
import {
  SESSION_REPLAY_RECORDER_ACTIVE_WINDOW_MS,
  SESSION_REPLAY_STALE_CHUNK_MS,
} from "Common/Utils/Rum/SessionReplayHealth";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Session Replay docs against the code they describe.
 *
 * Markdown is not compiled, so nothing else notices when the recorder grows
 * a method the page never mentions, the player rebinds a key, the health
 * diagnosis learns a state, or the dashboard links to an anchor that a
 * heading rename quietly removed. Each test here reads the source of truth
 * (the recorder bundle, the keyboard map, the health types, the models) and
 * checks the shipped page still tells the same story, so the page a customer
 * reads while debugging cannot drift from the product they are debugging.
 */
const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");
const RECORDER_SRC: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/BrowserRecorder/src",
);
const DASHBOARD_REPLAY_DIR: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Components/SessionReplay",
);

const PAGE_URL: string = "/docs/telemetry/session-replay";
const NAV_GROUP_TITLE: string = "Real User Monitoring";

const FENCE_LINE: RegExp = /^\s*```/;
const CADENCE_CLAIM: RegExp = /every 15 seconds/;
/* The words that turn "a POST every 15 seconds" into a true statement. */
const CADENCE_QUALIFIER: RegExp =
  /doing something|interacting|of activity|idle/;

/* Every page this package owns; the link check walks all of them. */
const OWNED_PAGES: Array<string> = [
  "en/telemetry/session-replay.md",
  "en/rum/session-replay-troubleshooting.md",
  "en/rum/browser-setup.md",
  "en/rum/applications.md",
  "en/rum/index.md",
  "en/rum/troubleshooting.md",
];

function readContent(relative: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, relative), "utf8");
}

function readRepo(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

function readPage(): string {
  return readContent("en/telemetry/session-replay.md");
}

/*
 * Headings become ids through the renderer's own slugify, the same import
 * Scripts/Docs/CheckAnchors.ts uses, so an anchor that passes here resolves
 * on the rendered page too. Fenced blocks are skipped because a "# comment"
 * inside a code sample is not a heading.
 */
function headingSlugs(markdown: string): Set<string> {
  const slugs: Set<string> = new Set<string>();
  let inFence: boolean = false;

  for (const line of markdown.split("\n")) {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      continue;
    }

    if (inFence) {
      continue;
    }

    const match: RegExpMatchArray | null = line.match(/^#{1,6}\s+(.+?)\s*$/);

    if (match) {
      slugs.add(slugify(match[1] as string));
    }
  }

  return slugs;
}

/* The body of one "## Heading" section, up to the next heading of the same or a higher level. */
function section(markdown: string, heading: string): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.findIndex((line: string): boolean => {
    return line.trim() === heading;
  });

  expect(start).toBeGreaterThanOrEqual(0);

  const level: number = (heading.match(/^#+/) as RegExpMatchArray)[0].length;
  const body: Array<string> = [];

  for (const line of lines.slice(start + 1)) {
    const match: RegExpMatchArray | null = line.match(/^(#{1,6})\s/);

    if (match && (match[1] as string).length <= level) {
      break;
    }

    body.push(line);
  }

  return body.join("\n");
}

function ownGroup(): NavGroup | undefined {
  return DocsNav.find((group: NavGroup): boolean => {
    return group.title === NAV_GROUP_TITLE;
  });
}

describe("Session Replay docs page", (): void => {
  it("is listed in the RUM nav group and opens with an H1 the renderer strips", (): void => {
    const links: Array<NavLink> = ownGroup()?.links || [];

    expect(
      links.some((link: NavLink): boolean => {
        return link.url === PAGE_URL;
      }),
    ).toBe(true);

    expect(readPage().split("\n")[0]).toBe("# Session Replay");
  });

  /*
   * The recorder's public surface is the SessionReplayApi interface in
   * Index.ts. bootstrap() and start() are the loader's entry points rather
   * than something a page calls, and `version` is a field, so they are the
   * only members a customer-facing reference may leave out.
   */
  it("documents every method the recorder publishes on window.OneUptimeReplay", (): void => {
    const source: string = fs.readFileSync(
      path.join(RECORDER_SRC, "Index.ts"),
      "utf8",
    );

    const interfaceBody: string | undefined = source.split(
      "export interface SessionReplayApi {",
    )[1];

    expect(interfaceBody).toBeDefined();

    const methods: Array<string> = Array.from(
      (interfaceBody as string)
        .split("\n}")[0]
        ?.matchAll(/^\s{2}(\w+): \(/gm) || [],
    )
      .map((match: RegExpMatchArray): string => {
        return match[1] as string;
      })
      .filter((name: string): boolean => {
        return name !== "bootstrap" && name !== "start";
      });

    expect(methods.length).toBeGreaterThan(8);

    const apiSection: string = section(readPage(), "## JavaScript API");

    const undocumented: Array<string> = methods.filter(
      (name: string): boolean => {
        return !apiSection.includes(`\`${name}(`);
      },
    );

    expect(undocumented).toEqual([]);
  });

  /*
   * The command queue accepts names by string comparison in
   * drainCommandQueue(); a page written from the docs must be able to spell
   * every one of them.
   */
  it("names every command the pre-load queue accepts", (): void => {
    const source: string = fs.readFileSync(
      path.join(RECORDER_SRC, "Index.ts"),
      "utf8",
    );

    /* `typeof command === "string"` is a type check, not a command name. */
    const commands: Set<string> = new Set<string>(
      Array.from(source.matchAll(/(?<!typeof )command === "([a-zA-Z]+)"/g)).map(
        (match: RegExpMatchArray): string => {
          return match[1] as string;
        },
      ),
    );

    expect(commands.size).toBeGreaterThan(6);

    const apiSection: string = section(readPage(), "## JavaScript API");

    const unnamed: Array<string> = Array.from(commands)
      .filter((command: string): boolean => {
        return (
          !apiSection.includes(`\`${command}\``) &&
          !apiSection.includes(`"${command}"`)
        );
      })
      .sort();

    expect(unnamed).toEqual([]);

    expect(apiSection).toContain("window.OneUptimeReplayQueue");
  });

  it("lists every data-oneuptime-* attribute the script tag reader looks for", (): void => {
    const source: string = fs.readFileSync(
      path.join(RECORDER_SRC, "Config.ts"),
      "utf8",
    );

    const attributes: Set<string> = new Set<string>(
      Array.from(
        source.matchAll(/getAttribute\("(data-oneuptime-[a-z-]+)"\)/g),
      ).map((match: RegExpMatchArray): string => {
        return match[1] as string;
      }),
    );

    expect(attributes.size).toBeGreaterThanOrEqual(5);

    const table: string = section(readPage(), "### Script tag attributes");

    for (const attribute of attributes) {
      expect(table).toContain(`\`${attribute}\``);
    }

    /* The one override with a privacy consequence has to show its exact spelling. */
    expect(readPage()).toContain('data-oneuptime-respect-do-not-track="false"');
  });

  /*
   * The dashboard's install snippet is generated by one component. The
   * docs snippet must match it: the same script path, crossorigin so
   * the page's own stylesheets can be read at playback, and no
   * data-oneuptime-host, which the recorder derives from its own src and
   * which a customer following the docs must not be told is required.
   */
  it("shows the same install snippet the dashboard generates", (): void => {
    const snippetSource: string = fs.readFileSync(
      path.join(DASHBOARD_REPLAY_DIR, "SessionReplayInstallSnippet.tsx"),
      "utf8",
    );

    const scriptPath: string | undefined = snippetSource.match(
      /RECORDER_SCRIPT_PATH: string =\s*"([^"]+)"/,
    )?.[1];

    expect(scriptPath).toBeDefined();

    const install: string = section(readPage(), "## Install");
    const firstFence: string =
      install.split("```html")[1]?.split("```")[0] || "";

    expect(firstFence).toContain(scriptPath as string);
    expect(firstFence).toContain('crossorigin="anonymous"');
    expect(firstFence).toContain("async");
    expect(firstFence).not.toContain("data-oneuptime-host=");

    /* The CSP block adds to 'self' rather than replacing it (session-list-15). */
    const csp: string = section(readPage(), "## Content Security Policy");

    expect(csp).toContain("script-src  'self' https://oneuptime.com;");
    expect(csp).toContain("connect-src 'self' https://oneuptime.com;");
  });

  it("states the shipped defaults the model actually has", (): void => {
    const model: string = readRepo(
      "Common/Models/DatabaseModels/RumApplication.ts",
    );

    const trigger: string | undefined = model.match(
      /defaultValue: SessionReplayCaptureTrigger\.(\w+)/,
    )?.[1];
    const consent: string | undefined = model.match(
      /defaultValue: SessionReplayConsentMode\.(\w+)/,
    )?.[1];

    expect(trigger).toBe("Always");
    expect(consent).toBe("NotRequired");

    const page: string = readPage();

    expect(page).toContain("| Capture trigger | **Always** |");
    expect(page).toContain("| Consent mode | **Not required** |");
    expect(page).toContain("| Sample percentage | **100%** |");

    /*
     * docs-tests-e2e-1: the sentence that survived the default flip and
     * told customers the product only records failures.
     */
    expect(page).not.toContain("uploads when something *breaks*");

    for (const days of SESSION_REPLAY_ALLOWED_RETENTION_DAYS) {
      expect(section(page, "## Retention and deletion")).toContain(
        String(days),
      );
    }
  });

  /*
   * docs-tests-e2e-4: the header row shares its chunks' TTL, so the page
   * may not promise metadata that outlives the footage.
   */
  it("does not claim session metadata outlives the recording", (): void => {
    const model: string = readRepo(
      "Common/Models/AnalyticsModels/RumSession.ts",
    );

    expect(model).toContain(
      "keeps the header's retentionDate equal to its chunks'",
    );

    const page: string = readPage();

    expect(page).not.toContain("kept longer than the recording");
    expect(page).toContain("the session row expires with its footage");
  });

  /*
   * docs-tests-e2e-6: an idle tab flushes no chunk (Chunker skips an open
   * chunk with eventCount 0), so "a POST every 15 seconds" must be
   * qualified everywhere it appears, or the first minute of a setup reads
   * as a broken install.
   */
  it("qualifies the 15-second cadence with user activity on every page that states it", (): void => {
    const chunker: string = fs.readFileSync(
      path.join(RECORDER_SRC, "Chunker.ts"),
      "utf8",
    );

    expect(chunker).toContain("open.eventCount === 0");

    for (const relative of [
      "en/telemetry/session-replay.md",
      "en/rum/session-replay-troubleshooting.md",
      "en/rum/troubleshooting.md",
    ]) {
      const page: string = readContent(relative);
      const mentions: Array<string> = page
        .split("\n")
        .filter((line: string): boolean => {
          return CADENCE_CLAIM.test(line);
        });

      expect(mentions.length).toBeGreaterThan(0);

      for (const line of mentions) {
        expect(CADENCE_QUALIFIER.test(line)).toBe(true);
      }
    }
  });

  /*
   * The caps are constants shared with the recorder; the reference must
   * quote the numbers the recorder enforces.
   */
  it("quotes the trait, tag, custom-event and capture-reason caps the recorder enforces", (): void => {
    const apiSection: string = section(readPage(), "## JavaScript API");

    for (const cap of [
      SESSION_REPLAY_MAX_TRAIT_KEYS,
      SESSION_REPLAY_MAX_TRAIT_KEY_LENGTH,
      SESSION_REPLAY_MAX_TRAIT_VALUE_LENGTH,
      SESSION_REPLAY_MAX_TAG_KEYS,
      SESSION_REPLAY_MAX_TAG_KEY_LENGTH,
      SESSION_REPLAY_MAX_TAG_VALUE_LENGTH,
      SESSION_REPLAY_MAX_CUSTOM_EVENT_NAME_LENGTH,
      SESSION_REPLAY_MAX_CUSTOM_EVENTS_PER_CHUNK,
      SESSION_REPLAY_MAX_CAPTURE_REASON_LENGTH,
    ]) {
      expect(apiSection).toContain(String(cap));
    }
  });

  /*
   * getDiagnostics() is the first thing support asks for. The field names
   * it returns are the ones the page has to explain.
   */
  it("explains every field getDiagnostics() returns", (): void => {
    const source: string = fs.readFileSync(
      path.join(RECORDER_SRC, "Index.ts"),
      "utf8",
    );

    const body: string | undefined = source
      .split("export interface SessionReplayDiagnostics {")[1]
      ?.split("\n}")[0];

    expect(body).toBeDefined();

    const fields: Array<string> = Array.from(
      (body as string).matchAll(/^\s{2}(\w+):/gm),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(fields.length).toBeGreaterThan(10);

    const diagnostics: string = section(readPage(), "### `getDiagnostics()`");

    for (const field of fields) {
      expect(diagnostics).toContain(`\`${field}\``);
    }
  });

  it("lists every keyboard shortcut the player binds, by the same key labels", (): void => {
    const shortcuts: string = section(readPage(), "### Keyboard shortcuts");
    let checked: number = 0;

    for (const group of REPLAY_SHORTCUT_GROUPS) {
      for (const shortcut of group.shortcuts) {
        for (const chord of shortcut.keys) {
          expect(shortcuts).toContain(`\`${chord.join(" + ")}\``);
          checked++;
        }
      }
    }

    expect(checked).toBeGreaterThan(25);
  });

  it("documents every search token the session list parses", (): void => {
    const source: string = fs.readFileSync(
      path.join(DASHBOARD_REPLAY_DIR, "SessionReplaySearchQuery.ts"),
      "utf8",
    );

    const list: string | undefined = source
      .split("SESSION_REPLAY_SEARCH_TOKEN_KEYS: ReadonlyArray<string> = [")[1]
      ?.split("];")[0];

    expect(list).toBeDefined();

    const tokens: Array<string> = Array.from(
      (list as string).matchAll(/"([a-z]+)"/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(tokens.length).toBeGreaterThan(8);

    const listSection: string = section(readPage(), "### The session list");

    for (const token of tokens) {
      expect(listSection).toContain(`\`${token}:`);
    }

    /* Every quick filter and every sort option, from the option tables. */
    const filters: string = fs.readFileSync(
      path.join(DASHBOARD_REPLAY_DIR, "SessionReplayListFilters.ts"),
      "utf8",
    );

    for (const label of Array.from(filters.matchAll(/label: "([^"]+)"/g)).map(
      (match: RegExpMatchArray): string => {
        return match[1] as string;
      },
    )) {
      expect(listSection).toContain(label);
    }
  });

  it("explains every recording health state the diagnosis can produce", (): void => {
    const types: string = readRepo("Common/Types/Rum/SessionReplayHealth.ts");
    const union: string | undefined = types
      .split("export type RecordingHealthState =")[1]
      ?.split(";")[0];

    expect(union).toBeDefined();

    const states: Array<string> = Array.from(
      (union as string).matchAll(/"([a-z-]+)"/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(states.length).toBeGreaterThanOrEqual(9);

    const health: string = section(readPage(), "## Recording health");

    for (const state of states) {
      expect(health).toContain(`| \`${state}\` |`);
    }

    /* Counters from Redis read "unknown", never 0 - the copy rule the strip follows. */
    expect(health).toContain("**unknown** — never 0");
  });

  /*
   * docs-tests-e2e-15: the audit page needs a permission the section used
   * to omit. Every people-facing replay permission in the enum gets a row.
   */
  it("documents every session replay permission a person can hold", (): void => {
    const permissions: Array<string> = Object.values(Permission).filter(
      (permission: string): boolean => {
        return (
          (permission.includes("RumSessionReplay") ||
            permission.includes("RumSessionErasure")) &&
          /* Ingestion-only; not something a dashboard user is granted. */
          permission !== "CreateRumSessionReplay"
        );
      },
    );

    expect(permissions.length).toBeGreaterThanOrEqual(6);

    const who: string = section(readPage(), "## Who can watch a recording");

    for (const permission of permissions) {
      expect(who).toContain(`\`${permission}\``);
    }
  });

  /*
   * docs-tests-e2e-5: the ingestion key has an origin allowlist and an
   * expiry of its own; the page may not tell customers otherwise.
   */
  it("describes both origin allowlists and the key expiry", (): void => {
    const key: string = readRepo(
      "Common/Models/DatabaseModels/TelemetryIngestionKey.ts",
    );

    expect(key).toContain("public allowedOrigins?: Array<string>");
    expect(key).toContain("public expiresAt?: Date");

    const origins: string = section(
      readPage(),
      "### Set your allowed origins in production",
    );

    expect(origins).not.toContain("no expiry and no origin binding");
    expect(origins).toContain("**Allowed Origins**");
    expect(origins).toContain("**Expires At**");
    expect(origins).toContain("_Replay Policy → Allowed origins_");
  });

  it("describes erasure with the request types the model accepts", (): void => {
    const model: string = readRepo(
      "Common/Models/DatabaseModels/RumSessionErasureRequest.ts",
    );

    const types: Array<string> = Array.from(
      model
        .split("export enum RumSessionErasureRequestType {")[1]
        ?.split("}")[0]
        ?.matchAll(/[=] "(\w+)"/g) || [],
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(types.length).toBe(4);

    const erasure: string = section(readPage(), "### Erasing sessions");

    for (const type of types) {
      expect(erasure).toContain(`\`${type}\``);
    }

    /* docs-tests-e2e-8: still API-only, and the page has to say so. */
    expect(erasure).toContain("/rum-session-erasure-request");
    expect(erasure).toContain("no dashboard form");
  });

  /*
   * The dashboard deep-links into this page from the health card
   * (docs-consent, docs-csp). Those anchors are computed from heading
   * text, so a heading rename here breaks a button there with no compile
   * error on either side.
   */
  it("keeps the anchors the dashboard health card links to", (): void => {
    const card: string = fs.readFileSync(
      path.join(DASHBOARD_REPLAY_DIR, "RecordingHealthCard.tsx"),
      "utf8",
    );

    const docsPath: string | undefined = card.match(
      /HEALTH_DOCS_PATH: string = "([^"]+)"/,
    )?.[1];

    expect(docsPath).toBe("/telemetry/session-replay");

    const anchors: Array<string> = Array.from(
      card.matchAll(/\$\{HEALTH_DOCS_PATH\}#([a-z0-9-]+)/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(anchors.length).toBeGreaterThanOrEqual(2);

    const slugs: Set<string> = headingSlugs(readPage());

    for (const anchor of anchors) {
      expect(slugs.has(anchor)).toBe(true);
    }
  });

  /*
   * Every /docs link on the pages this package owns resolves to a file,
   * and every #anchor on such a link resolves to a heading in that file.
   * The in-repo anchor script only checks same-page anchors; cross-page
   * ones - which this rewrite added several of - were unchecked.
   */
  it("has no dead internal link or cross-page anchor", (): void => {
    const broken: Array<string> = [];

    for (const relative of OWNED_PAGES) {
      const markdown: string = readContent(relative);

      for (const match of markdown.matchAll(
        /\]\((\/docs\/[a-z0-9/_-]+)(#[a-z0-9-]+)?\)/g,
      )) {
        const target: string = (match[1] as string).replace(/^\/docs\//, "");
        const file: string = path.join(CONTENT_DIR, "en", `${target}.md`);

        if (!fs.existsSync(file)) {
          broken.push(`${relative}: ${match[0]} (no file)`);
          continue;
        }

        const anchor: string | undefined = match[2];

        if (
          anchor &&
          !headingSlugs(fs.readFileSync(file, "utf8")).has(anchor.slice(1))
        ) {
          broken.push(`${relative}: ${match[0]} (no heading)`);
        }
      }
    }

    expect(broken).toEqual([]);
  });

  /*
   * The settings surfaces moved (settings-setup-17 and the design's IA):
   * the installation test, health, privacy summary and targeted capture
   * live on the application's Replay Policy page, and the old
   * "RUM → Session Replay Settings" path no longer exists.
   */
  /*
   * docs-and-design-fidelity-1. The page used to tell a privacy officer
   * that turning Capture user identity off still left a keyed hash behind,
   * so a session could be erased BY USER. Both halves of the product say
   * otherwise: the recorder never puts the reference on the wire, and the
   * ingest writes an empty key when the switch is off - so an erasure
   * request by user key matches nothing. A wrong answer here is an unmet
   * legal obligation the customer does not know about.
   */
  it("does not promise an erasable user key for identity-off sessions", (): void => {
    const recorder: string = fs.readFileSync(
      path.join(RECORDER_SRC, "Recorder.ts"),
      "utf8",
    );

    /* The reference is only ever put on the wire behind the switch. */
    expect(recorder).toContain(
      "if (this.config.captureUserIdentity && this.userRef) {",
    );

    const ingest: string = readRepo(
      "App/FeatureSet/Telemetry/Services/SessionReplayIngestService.ts",
    );

    /* And the server re-checks the switch, storing "" for key and label. */
    const keyBlock: string =
      ingest.split("const hasUsableUserRef: boolean =")[1]?.split(";")[0] || "";

    expect(keyBlock).toContain("data.policy.captureUserIdentity");
    expect(ingest).toContain(
      "const identifiedUserKey: string = hasUsableUserRef",
    );

    const identify: string = section(readPage(), "## Identify your users");

    /* The claim that was false. */
    expect(identify).not.toContain("one-way keyed hash of the reference");
    expect(identify).not.toMatch(/still be targeted by an erasure request/);

    /* What is true, and the way out it has to offer instead. */
    expect(identify).toContain("nothing at all");

    for (const requestType of [
      "BySessionId",
      "ByDateRange",
      "ByRumApplication",
    ]) {
      expect(identify).toContain(`\`${requestType}\``);
    }
  });

  /*
   * docs-and-design-fidelity-2. A load-time reference rides on the config
   * fetch of every page load - that is how targeted capture matches before
   * any recorder exists - so "nothing leaves the browser unless the switch
   * is on" was false for exactly the customer who set the attribute.
   */
  it("says the load-time user reference travels on the policy fetch regardless of the switch", (): void => {
    const config: string = fs.readFileSync(
      path.join(RECORDER_SRC, "Config.ts"),
      "utf8",
    );

    /*
     * The only gate on the header is "did the page supply a ref". The
     * policy is not known yet at this point in the loader, so it cannot
     * be gated on captureUserIdentity even in principle.
     */
    const guarded: string =
      config
        .split("if (options.userRef) {")[1]
        ?.split("headers[SESSION_REPLAY_USER_REF_HEADER]")[0] || "";

    expect(guarded).not.toBe("");
    expect(guarded).not.toContain("captureUserIdentity");

    const identify: string = section(readPage(), "## Identify your users");

    expect(identify).not.toContain(
      "Neither the reference nor the traits leaves the browser",
    );
    expect(identify).toContain("data-oneuptime-user-ref");
    expect(identify).toContain("policy fetch");
  });

  /*
   * docs-and-design-fidelity-4. setTags REPLACES the map; only addTag
   * merges. Documented the other way round, a page that calls setTags
   * twice silently loses the first call's tags and its tag: searches then
   * miss those sessions.
   */
  it("describes setTags as replacing the tag map, the way the recorder implements it", (): void => {
    const recorder: string = fs.readFileSync(
      path.join(RECORDER_SRC, "Recorder.ts"),
      "utf8",
    );

    const setTags: string =
      recorder.split("public setTags(")[1]?.split("\n  }")[0] || "";
    const addTag: string =
      recorder.split("public addTag(")[1]?.split("\n  }")[0] || "";

    expect(setTags).not.toBe("");
    expect(setTags).not.toContain("mergeSessionReplayStringMaps");
    expect(addTag).toContain("mergeSessionReplayStringMaps");

    const apiSection: string = section(readPage(), "## JavaScript API");

    expect(apiSection).not.toContain("`setTags` merges into the existing map");
    expect(apiSection).toContain("`setTags` **replaces** the whole map");
  });

  /*
   * docs-and-design-fidelity-5. The page-hide flush is ONE keepalive
   * request whose whole body is capped by the shared constant; the two
   * pages quoted different numbers, and a customer sizing a proxy body
   * limit from the wrong one truncates the end of every recording.
   */
  it("quotes the keepalive budget the transport enforces, on both pages", (): void => {
    const keepaliveKb: number = SESSION_REPLAY_KEEPALIVE_MAX_BYTES / 1024;

    const install: string = section(
      readPage(),
      "### What a healthy install looks like",
    );

    expect(install).toContain(`${keepaliveKb} KB`);
    expect(install).not.toMatch(/each under \d+ KB/);

    /*
     * The per-piece payload budget is the request cap less the 8 KB the
     * envelope may weigh (Recorder.KEEPALIVE_PAYLOAD_BUDGET_BYTES), and
     * the page explains the split with that number.
     */
    const recorder: string = fs.readFileSync(
      path.join(RECORDER_SRC, "Recorder.ts"),
      "utf8",
    );

    expect(recorder).toContain("SESSION_REPLAY_KEEPALIVE_MAX_BYTES - 8 * 1024");
    expect(install).toContain(`${keepaliveKb - 8} KB`);

    expect(readContent("en/rum/session-replay-troubleshooting.md")).toContain(
      `${keepaliveKb} KB`,
    );
  });

  /*
   * docs-and-design-fidelity-6. healthy-quiet is NOT "the recorder loads
   * but there is no traffic": it is the branch where no chunk has arrived
   * for the stale window AND no policy fetch landed inside the active
   * window - which is also what a removed script tag looks like. The row
   * may not hand out reassurance for that case without saying so.
   */
  it("describes healthy-quiet with both silences the diagnosis actually requires", (): void => {
    /* The windows the copy quotes, from the constants the diagnosis uses. */
    expect(SESSION_REPLAY_STALE_CHUNK_MS).toBe(6 * 60 * 60 * 1000);
    expect(SESSION_REPLAY_RECORDER_ACTIVE_WINDOW_MS).toBe(24 * 60 * 60 * 1000);

    const health: string = readRepo("Common/Utils/Rum/SessionReplayHealth.ts");

    /* A recorder that IS still loading is "stale", not "healthy-quiet". */
    const staleBranch: string =
      health
        .split(
          "if (chunkAgeMs > SESSION_REPLAY_STALE_CHUNK_MS && isRecorderStillLoading) {",
        )[1]
        ?.split("\n  }")[0] || "";

    expect(staleBranch).toContain('state: "stale"');

    const row: string | undefined = readPage()
      .split("\n")
      .find((line: string): boolean => {
        return line.startsWith("| `healthy-quiet` |");
      });

    expect(row).toBeDefined();
    expect(row).toContain("six hours");
    expect(row).toContain("24 hours");
    expect(row).not.toContain("Quiet, not broken");
  });

  /*
   * docs-and-design-fidelity-9. Nothing server-side can read a CSP: it is
   * a response header of the customer's own site. The panel has no row
   * for it, and telling a customer it "lines up" is how CSP gets ruled
   * out as the cause of the silence it is causing.
   */
  it("does not claim the installation test checks the CSP", (): void => {
    const panel: string = fs.readFileSync(
      path.join(DASHBOARD_REPLAY_DIR, "InstallationTestPanel.tsx"),
      "utf8",
    );

    const rowKeys: Array<string> = Array.from(
      panel.matchAll(/^\s{4}key: "([a-z-]+)",$/gm),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(rowKeys.length).toBeGreaterThan(4);
    expect(rowKeys).not.toContain("csp");

    /* The two rows the docs tell a customer to read instead. */
    expect(rowKeys).toContain("loaded");
    expect(rowKeys).toContain("chunk");

    const csp: string = section(readPage(), "## Content Security Policy");

    expect(csp).not.toContain("the CSP all line up from the server's side");
    expect(csp).toContain("cannot check your CSP");
    expect(csp).toContain("Recorder loaded on your site");
  });

  /*
   * docs-and-design-fidelity-3. The health section promises the card shows
   * what the newest recorder announced it can capture. That is only true
   * while the read path actually carries the field to the card.
   */
  it("only promises recorder capabilities on the health card while the API carries them", (): void => {
    expect(
      readRepo("Common/Server/Utils/SessionReplay/SessionReplayReadService.ts"),
    ).toContain("recorderCapabilities");
    expect(readRepo("Common/Server/API/TelemetryAPI.ts")).toContain(
      "recorderCapabilities:",
    );

    const card: string = fs.readFileSync(
      path.join(DASHBOARD_REPLAY_DIR, "RecordingHealthCard.tsx"),
      "utf8",
    );

    expect(card).toContain("recorderCapabilities");

    expect(section(readPage(), "## Recording health")).toContain(
      "capabilities of the newest recorder that reported",
    );
  });

  /*
   * docs-and-design-fidelity-7. "recorders up to 12.0.x" covers the
   * recorder this build publishes, so a self-hoster reading it cannot tell
   * whether they are affected. No page may name a version range that
   * includes the shipped one.
   */
  it("names no defect version range that includes the recorder this build ships", (): void => {
    const version: string = (
      JSON.parse(readRepo("App/FeatureSet/BrowserRecorder/package.json")) as {
        version: string;
      }
    ).version;

    const [major, minor]: Array<string> = version.split(".");
    const shippedRange: string = `${major}.${minor}.x`;

    for (const relative of OWNED_PAGES) {
      expect(readContent(relative)).not.toContain(shippedRange);
    }
  });

  it("points at the Replay Policy page rather than the removed settings path", (): void => {
    const sideMenu: string = readRepo(
      "App/FeatureSet/Dashboard/src/Pages/Rum/View/SideMenu.tsx",
    );

    expect(sideMenu).toContain('title: "Replay Policy"');

    for (const relative of OWNED_PAGES) {
      const page: string = readContent(relative);

      expect(page).not.toContain("RUM → Session Replay Settings");
    }

    expect(readPage()).toContain("Replay Policy");
  });
});
