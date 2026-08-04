import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * ---------------------------------------------------------------------------
 * The Runner Status card used to label the runner's self-reported version
 * "Agent Version". The entity is a Runner, and "agent" already means something
 * else in this product, so the label now reads "Runner Version".
 *
 * Three things have to hold together for that to actually reach a user, and all
 * three fail silently:
 *
 *   1. RunnerView.tsx must carry the new literal. The App suite runs in plain
 *      node with no renderer, so there is no way to assert this except by
 *      reading the source — the same approach SloBulkActionsWiring.test.ts and
 *      RecommendationPageWiring.test.ts take for dashboard wiring.
 *   2. That literal IS the i18n key. FieldLabel calls translateString(title),
 *      and i18next is configured with defaultValue: value — so a title with no
 *      matching key renders fine in English and renders ENGLISH in all fifteen
 *      other languages. Nothing errors. Only a Japanese user sees the bug.
 *   3. The old "Agent Version" key must SURVIVE, because eleven unrelated
 *      monitoring-agent pages (Host, Docker, Podman, Kubernetes, Ceph, Proxmox,
 *      Serverless) still use it. A find-and-replace across the locale files
 *      would have silently un-translated all of them.
 *
 * Sources are whitespace-squashed before matching so prettier re-wrapping a
 * line cannot turn a real regression check into a red herring, and negative
 * assertions read a comment-stripped copy so prose naming the old string cannot
 * fail the test checking the old string is gone.
 * ---------------------------------------------------------------------------
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

const RUNNER_VIEW: Array<string> = ["Pages", "Settings", "RunnerView.tsx"];

const NEW_LABEL: string = "Runner Version";
const OLD_LABEL: string = "Agent Version";

const TS_SOURCE: RegExp = /\.tsx?$/;

/*
 * en.json is the source of truth; Scripts/I18n/ValidateLocales.js (run in CI by
 * the js-lint job) requires these fifteen to mirror it key-for-key.
 */
const TRANSLATED_LOCALES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
];

const ALL_LOCALES: Array<string> = ["en", ...TRANSLATED_LOCALES];

/*
 * Pages that legitimately show a monitoring agent's version. These must keep
 * saying "Agent Version" — they are the reason the old locale key cannot be
 * renamed in place.
 */
const MONITORING_AGENT_PAGES: Array<{ name: string; parts: Array<string> }> = [
  { name: "Host", parts: ["Pages", "Host", "View", "Overview.tsx"] },
  { name: "Docker", parts: ["Pages", "Docker", "View", "Overview.tsx"] },
  { name: "Podman", parts: ["Pages", "Podman", "View", "Overview.tsx"] },
  { name: "Kubernetes", parts: ["Pages", "Kubernetes", "View", "Index.tsx"] },
  { name: "Ceph", parts: ["Pages", "Ceph", "View", "Index.tsx"] },
  { name: "Proxmox", parts: ["Pages", "Proxmox", "View", "Index.tsx"] },
  {
    name: "Serverless",
    parts: ["Pages", "Serverless", "View", "Overview.tsx"],
  },
];

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function readRaw(...parts: Array<string>): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, ...parts), "utf8");
}

// Whitespace-normalized source, comments intact.
function readSource(...parts: Array<string>): string {
  return squash(readRaw(...parts));
}

// Whitespace-normalized source with comments removed — use for .not.toContain.
function readCode(...parts: Array<string>): string {
  return squash(stripComments(readRaw(...parts)));
}

function readLocaleRaw(code: string): string {
  return fs.readFileSync(path.join(LOCALES_DIR, code + ".json"), "utf8");
}

/*
 * Each locale file is ~10k keys. Parsing is memoized because the parity checks
 * below compare whole key sets — re-reading per key turns a millisecond
 * assertion into a minute-long one.
 */
const localeCache: Map<string, Record<string, string>> = new Map<
  string,
  Record<string, string>
>();

function readLocale(code: string): Record<string, string> {
  const cached: Record<string, string> | undefined = localeCache.get(code);

  if (cached) {
    return cached;
  }

  const parsed: Record<string, string> = JSON.parse(
    readLocaleRaw(code),
  ) as Record<string, string>;

  localeCache.set(code, parsed);

  return parsed;
}

function localeKeys(code: string): Array<string> {
  return Object.keys(readLocale(code));
}

describe("RunnerView shows the version as 'Runner Version'", () => {
  /*
   * The field is rendered through getElement rather than FieldType.Text now:
   * RunnerService.onBeforeCreate stamps every new row with agentVersion
   * 1.0.0 before the Runner has ever spoken to us, so a plain Text render
   * showed a fabricated version for a Runner that had never reported one.
   * The title and its position on the card are what this suite exists to
   * pin, and both are unchanged — so this asserts the pair, not the
   * renderer.
   */
  test("the Runner Status card's version field is titled 'Runner Version'", () => {
    expect(readSource(...RUNNER_VIEW)).toContain(
      squash(`{
              field: { agentVersion: true },
              title: "Runner Version",`),
    );
  });

  test("no 'Agent Version' title survives anywhere in the page", () => {
    expect(readCode(...RUNNER_VIEW)).not.toContain(`title: "${OLD_LABEL}"`);
    expect(readCode(...RUNNER_VIEW)).not.toContain(OLD_LABEL);
  });

  /*
   * The label moved; the API select key did not. `agentVersion` is the model
   * property, the Postgres column and the POST /heartbeat body key, and it is
   * pinned as such in Common/Tests/Models/RunnerVersionLabel.test.ts. Renaming
   * it here would ask the API for a field that does not exist and the card
   * would render blank.
   */
  test("still selects the agentVersion field from the API", () => {
    expect(readCode(...RUNNER_VIEW)).toContain("field: { agentVersion: true }");
    expect(readCode(...RUNNER_VIEW)).not.toContain("runnerVersion");
  });

  /*
   * Bounded on both sides: the label has to fall inside the Runner Status card,
   * between that card's id and the next section on the page. A one-sided
   * check would still pass if the field were dragged down into the owner-team
   * table, which is where a careless refactor would land it.
   */
  test("the version field sits on the Runner Status card", () => {
    const source: string = readCode(...RUNNER_VIEW);

    const cardStart: number = source.indexOf(
      'id: "model-detail-runbook-agent-status"',
    );
    // JSX prop on the next card down, so it bounds the Runner Status card.
    const cardEnd: number = source.indexOf('title="Setup Instructions"');
    const labelIndex: number = source.indexOf(`title: "${NEW_LABEL}"`);

    expect(cardStart).toBeGreaterThan(-1);
    expect(cardEnd).toBeGreaterThan(cardStart);
    expect(labelIndex).toBeGreaterThan(cardStart);
    expect(labelIndex).toBeLessThan(cardEnd);
  });

  test("is the only place in the dashboard that says 'Runner Version'", () => {
    const hits: Array<string> = [];

    const walk: (dir: string) => void = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full: string = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (entry.name !== "Locales") {
            walk(full);
          }
          continue;
        }

        if (!TS_SOURCE.test(entry.name)) {
          continue;
        }

        if (fs.readFileSync(full, "utf8").includes(NEW_LABEL)) {
          hits.push(path.relative(DASHBOARD_SRC, full));
        }
      }
    };

    walk(DASHBOARD_SRC);

    expect(hits).toEqual([path.join(...RUNNER_VIEW)]);
  });
});

/*
 * The rename must not spill onto the monitoring agents. These pages report the
 * version of the OneUptime agent installed on a customer host — "Agent Version"
 * is correct there, and a repo-wide find-and-replace is exactly how it would
 * have been broken.
 */
describe("monitoring-agent pages keep saying 'Agent Version'", () => {
  test.each(MONITORING_AGENT_PAGES)(
    "the $name page still uses the 'Agent Version' label",
    ({ parts }: { parts: Array<string> }) => {
      const source: string = readCode(...parts);

      expect(source).toContain(OLD_LABEL);
      expect(source).not.toContain(NEW_LABEL);
    },
  );
});

describe("locale coverage for the new label", () => {
  test.each(ALL_LOCALES)(
    "%s.json defines a 'Runner Version' key",
    (code: string) => {
      const strings: Record<string, string> = readLocale(code);

      expect(Object.keys(strings)).toContain(NEW_LABEL);
      expect(typeof strings[NEW_LABEL]).toBe("string");
      expect(strings[NEW_LABEL]!.trim().length).toBeGreaterThan(0);
    },
  );

  test("en.json maps the key to itself", () => {
    expect(readLocale("en")[NEW_LABEL]).toBe(NEW_LABEL);
  });

  /*
   * Every translated locale already renders "Runner" as "runbook agent" in the
   * sibling Runner* keys. A value left as the raw English string would pass the
   * CI parity validator (it only reports identical values as info) but ship an
   * untranslated label, so require an actual translation here.
   */
  test.each(TRANSLATED_LOCALES)(
    "%s.json actually translates it",
    (code: string) => {
      expect(readLocale(code)[NEW_LABEL]).not.toBe(NEW_LABEL);
    },
  );

  /*
   * The label the .tsx renders IS the lookup key. Deriving the expected key
   * from the source rather than hardcoding it means editing the title without
   * adding locale entries fails here instead of silently falling back to
   * English for fifteen languages.
   */
  test("the literal used in RunnerView.tsx is a key in every locale", () => {
    const match: RegExpMatchArray | null = readCode(...RUNNER_VIEW).match(
      /field: \{ agentVersion: true \}, title: "([^"]+)"/,
    );

    expect(match).not.toBeNull();

    const titleInSource: string = match![1]!;
    expect(titleInSource).toBe(NEW_LABEL);

    for (const code of ALL_LOCALES) {
      expect(Object.keys(readLocale(code))).toContain(titleInSource);
    }
  });

  test("the key is filed with the other Runner keys", () => {
    for (const code of ALL_LOCALES) {
      const keys: Array<string> = localeKeys(code);

      const versionIndex: number = keys.indexOf(NEW_LABEL);
      const statusIndex: number = keys.indexOf("Runner Status");
      const pluralIndex: number = keys.indexOf("Runners");

      expect(statusIndex).toBeGreaterThan(-1);
      expect(pluralIndex).toBeGreaterThan(-1);
      expect(versionIndex).toBeGreaterThan(statusIndex);
      expect(versionIndex).toBeLessThan(pluralIndex);
    }
  });
});

describe("the shared 'Agent Version' key survives for the monitoring agents", () => {
  test.each(ALL_LOCALES)(
    "%s.json still defines 'Agent Version'",
    (code: string) => {
      const strings: Record<string, string> = readLocale(code);

      expect(Object.keys(strings)).toContain(OLD_LABEL);
      expect(strings[OLD_LABEL]!.trim().length).toBeGreaterThan(0);
    },
  );

  test("en.json still maps the old key to itself", () => {
    expect(readLocale("en")[OLD_LABEL]).toBe(OLD_LABEL);
  });

  /*
   * The two keys are for different things and must not collapse into one
   * string. If a later edit points them at the same translation, the Kubernetes
   * page and the Runner page become indistinguishable in that language.
   */
  test.each(TRANSLATED_LOCALES)(
    "%s.json keeps the two labels distinct",
    (code: string) => {
      const strings: Record<string, string> = readLocale(code);

      expect(strings[NEW_LABEL]).not.toBe(strings[OLD_LABEL]);
    },
  );
});

/*
 * A scoped re-implementation of Scripts/I18n/ValidateLocales.js. That script is
 * an ESM module and cannot be require()'d from this CommonJS suite, and it only
 * runs in the js-lint CI job — so adding one key to en.json and forgetting the
 * other fifteen files would go green here and red much later. These assertions
 * make the App suite itself refuse the drift.
 */
describe("Dashboard locale files stay in parity with en.json", () => {
  test.each(TRANSLATED_LOCALES)(
    "%s.json has no missing keys",
    (code: string) => {
      const enKeys: Set<string> = new Set(localeKeys("en"));
      const missing: Array<string> = [...enKeys].filter((key: string) => {
        return !Object.prototype.hasOwnProperty.call(readLocale(code), key);
      });

      expect(missing).toEqual([]);
    },
  );

  test.each(TRANSLATED_LOCALES)("%s.json has no extra keys", (code: string) => {
    const enKeys: Set<string> = new Set(localeKeys("en"));
    const extra: Array<string> = localeKeys(code).filter((key: string) => {
      return !enKeys.has(key);
    });

    expect(extra).toEqual([]);
  });

  test.each(ALL_LOCALES)(
    "%s.json is valid JSON with 2-space indent",
    (code: string) => {
      const raw: string = readLocaleRaw(code);

      expect(() => {
        return JSON.parse(raw);
      }).not.toThrow();
      expect(raw).toContain(`  "${NEW_LABEL}": `);
    },
  );
});
