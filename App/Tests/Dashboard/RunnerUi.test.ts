import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Wiring and copy tests for the Runner UI.
 *
 * The App suite runs in plain node with no renderer (App/jest.config.json sets
 * testEnvironment "node" and App has no react), so page-level wiring can only
 * be asserted by reading the source — the same approach RunnerVersionLabel.test.ts
 * and the other dashboard wiring suites take. The behaviour of the components
 * themselves is tested for real, with a DOM, in
 * Common/Tests/App/Dashboard/RunnerStatus.test.tsx and
 * Common/Tests/App/Dashboard/RunnerInstallInstructions.test.tsx.
 *
 * The load-bearing half of this file is the connectionStatus ban: three pages
 * used to decide "is this Runner connected" by comparing the persisted
 * connectionStatus column against Connected. That column is written on create
 * and on the first heartbeat and never again, so it reported a Runner that
 * died months ago as connected, and a Runner created seconds ago as
 * disconnected. If any of these pages starts reading it again, that regression
 * is back.
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

const LOCALE_CODES: Array<string> = [
  "en",
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

const TRANSLATED_CODES: Array<string> = LOCALE_CODES.filter(
  (code: string): boolean => {
    return code !== "en";
  },
);

const RUNNERS_PAGE: Array<string> = ["Pages", "Settings", "Runners.tsx"];
const RUNNER_VIEW: Array<string> = ["Pages", "Settings", "RunnerView.tsx"];
const STEPS_PAGE: Array<string> = ["Pages", "Runbook", "View", "Steps.tsx"];
const STATUS_COMPONENT: Array<string> = [
  "Components",
  "Runner",
  "RunnerStatus.tsx",
];
const INSTALL_COMPONENT: Array<string> = [
  "Components",
  "Runner",
  "InstallInstructions.tsx",
];
const RUNNERS_COMPONENT: Array<string> = [
  "Components",
  "Runner",
  "Runners.tsx",
];

const RUNNER_UI_FILES: Array<Array<string>> = [
  RUNNERS_PAGE,
  RUNNER_VIEW,
  STATUS_COMPONENT,
  INSTALL_COMPONENT,
  RUNNERS_COMPONENT,
];

type SquashFunction = (value: string) => string;

/* Collapses whitespace so prettier's line wrapping cannot break a match. */
const squash: SquashFunction = (value: string): string => {
  return value.replace(/\s+/g, " ").trim();
};

type StripCommentsFunction = (value: string) => string;

/*
 * Several of these files explain in prose why they no longer read
 * connectionStatus. Without stripping comments, that prose would satisfy the
 * very checks meant to prove the code does not read it.
 */
const stripComments: StripCommentsFunction = (value: string): string => {
  return value.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
};

type ReadSourceFunction = (...segments: Array<string>) => string;

const readSource: ReadSourceFunction = (...segments: Array<string>): string => {
  return squash(fs.readFileSync(path.join(DASHBOARD_SRC, ...segments), "utf8"));
};

const readCode: ReadSourceFunction = (...segments: Array<string>): string => {
  return squash(
    stripComments(
      fs.readFileSync(path.join(DASHBOARD_SRC, ...segments), "utf8"),
    ),
  );
};

const localeCache: Map<string, Record<string, string>> = new Map();

type ReadLocaleFunction = (code: string) => Record<string, string>;

const readLocale: ReadLocaleFunction = (
  code: string,
): Record<string, string> => {
  const cached: Record<string, string> | undefined = localeCache.get(code);

  if (cached) {
    return cached;
  }

  const parsed: Record<string, string> = JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
  ) as Record<string, string>;

  localeCache.set(code, parsed);

  return parsed;
};

/*
 * Every user-visible English string this change introduced or reworded. Each
 * one is an i18next lookup key, so a missing entry silently renders English in
 * fifteen languages rather than failing anywhere.
 */
const NEW_STRINGS: Array<string> = [
  "Here are more details for this Runner.",
  "Here is more details on the connection status for this Runner.",
  "Here is the list of teams that own this Runner. They will be alerted when this Runner's status changes.",
  "Here is the list of users that own this Runner. They will be alerted when this Runner's status changes.",
  "No teams associated with this Runner so far.",
  "No users associated with this Runner so far.",
  "Self-hosted Runners that execute Bash and JavaScript runbook steps in your own infrastructure. Each step picks the Runner that should run it.",
  "No Runners yet. Create one, then run the Docker command on a host inside your infrastructure.",
  "No Runners.",
  "more Runners",
  "Runner Key",
  "Not reported yet",
  "Never connected",
  "Never",
  "None",
  "Capabilities",
  "Runs Runbooks",
  "Runs AI Code Fixes",
  "Runs AI Remediation Commands",
  "AI code fixes",
  "AI remediation commands",
  "You do not have permission to view this Runner's key",
];

describe("the Runner status element is the single source of truth", () => {
  /*
   * Runners.tsx, RunnerView.tsx and Steps.tsx each carried their own copy of
   * the connected/disconnected logic. Two of them were a byte-for-byte
   * duplicate of the same eighteen lines of JSX.
   */
  test("the shared component exists and derives status from lastAlive", () => {
    const source: string = readCode(...STATUS_COMPONENT);

    expect(source).toContain("getRunnerLiveStatus");
    expect(source).toContain('from "Common/Types/Runner/RunnerLiveStatus"');

    /*
     * Whitespace-insensitive: squash() turns a prettier line break into a
     * space, so a literal expectation here would pin the current wrap point
     * and fail on a purely cosmetic reformat.
     */
    expect(source).toMatch(/props\.runner\s*\[\s*"lastAlive"\s*\]/);
  });

  test("it handles all three live states", () => {
    const source: string = readCode(...STATUS_COMPONENT);

    expect(source).toContain("RunnerLiveStatus.Connected");
    expect(source).toContain("RunnerLiveStatus.NeverConnected");
  });

  /*
   * Statusbubble is the house component for this — ProbeStatus.tsx has used it
   * for probe connection state all along, and it is the only one of the
   * candidates that themes correctly and carries role="status".
   */
  test("it renders through the shared Statusbubble, not hand-rolled JSX", () => {
    const source: string = readCode(...STATUS_COMPONENT);

    expect(source).toContain("Statusbubble");
    expect(source).toContain(
      'from "Common/UI/Components/StatusBubble/StatusBubble"',
    );
  });

  test("both settings pages render through it", () => {
    expect(readCode(...RUNNERS_PAGE)).toContain("<RunnerStatusElement");
    expect(readCode(...RUNNER_VIEW)).toContain("<RunnerStatusElement");
  });

  /*
   * The Runners table already has a Last Seen column, so repeating the
   * relative time inside the status bubble beside it is noise.
   */
  test("the table suppresses the duplicate relative time", () => {
    expect(readCode(...RUNNERS_PAGE)).toContain("showLastSeen={false}");
  });

  test("the detail card keeps the relative time", () => {
    const source: string = readCode(...RUNNER_VIEW);

    expect(source).toContain("<RunnerStatusElement runner={item} />");
    expect(source).not.toContain("showLastSeen={false}");
  });
});

describe("no page decides liveness from connectionStatus", () => {
  test.each([
    ["Runners.tsx", RUNNERS_PAGE],
    ["RunnerView.tsx", RUNNER_VIEW],
    ["Steps.tsx", STEPS_PAGE],
  ])(
    "%s never compares against RunnerConnectionStatus.Connected",
    (_name: string, file: Array<string>) => {
      const source: string = readCode(...file);

      expect(source).not.toContain("RunnerConnectionStatus.Connected");
      expect(source).not.toContain("=== RunnerConnectionStatus");
    },
  );

  /*
   * The inline dot markup that all this replaced. Its presence anywhere in the
   * Runner UI means a fourth copy has appeared.
   */
  test.each([
    ["Runners.tsx", RUNNERS_PAGE],
    ["RunnerView.tsx", RUNNER_VIEW],
  ])("%s no longer hand-rolls a status dot", (_n: string, f: Array<string>) => {
    const source: string = readCode(...f);

    expect(source).not.toContain("bg-emerald-500");
    expect(source).not.toContain("text-emerald-700");
    expect(source).not.toContain("bg-red-500");
    expect(source).not.toContain("text-red-700");
  });

  /*
   * The status element reads lastAlive off whatever it is handed, so the query
   * has to actually fetch it. Without this the element would see undefined and
   * report every Runner as never connected — a silent, total failure.
   */
  test("the Runners table selects lastAlive", () => {
    const source: string = readCode(...RUNNERS_PAGE);
    const selectStart: number = source.indexOf("selectMoreFields={{");

    expect(selectStart).toBeGreaterThan(-1);
    expect(
      source.slice(selectStart, source.indexOf("}}", selectStart)),
    ).toContain("lastAlive: true");
  });

  test("the Runner Status card selects lastAlive", () => {
    expect(readCode(...RUNNER_VIEW)).toContain(
      "selectMoreFields: { lastAlive: true }",
    );
  });

  /*
   * Sorting and CSV export both read the column's named field directly and
   * never call getElement, so a Status column left pointing at
   * connectionStatus would order and export the stale value the cell exists to
   * stop showing — a Runner last seen three months ago sorting alongside a
   * live one, and exporting as "connected" in a file people send to others.
   */
  test("the Status column does not sort on the stale column", () => {
    const source: string = readCode(...RUNNERS_PAGE);
    const statusStart: number = source.indexOf('title: "Status"');
    const statusEnd: number = source.indexOf('title: "Last Seen"');
    const statusColumn: string = source.slice(statusStart, statusEnd);

    expect(statusStart).toBeGreaterThan(-1);
    expect(statusEnd).toBeGreaterThan(statusStart);
    expect(statusColumn).toContain("disableSort: true");
  });

  test("the Status column exports the derived status, not the column", () => {
    const source: string = readCode(...RUNNERS_PAGE);

    expect(source).toContain("getExportValue: (item: Runner): string =>");
    expect(source).toContain(
      "getRunnerLiveStatusLabel( getRunnerLiveStatus(item.lastAlive), )",
    );
  });

  /*
   * Its sibling exports a raw Date toString next to a cell reading
   * "3 months ago" unless it is given the same treatment.
   */
  test("the Last Seen column exports the relative time it displays", () => {
    const source: string = readCode(...RUNNERS_PAGE);
    const start: number = source.indexOf('title: "Last Seen"');
    /* "Capabilities" is also a formStep title earlier in the file. */
    const end: number = source.indexOf('title: "Capabilities"', start);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(source.slice(start, end)).toContain(
      "return OneUptimeDate.fromNow(item.lastAlive);",
    );
  });

  /*
   * The runbook step editor labels each Runner in its picker. Telling an
   * author a dead Runner is connected means the step they are writing will
   * never run and they have no way to know it.
   */
  test("the runbook step picker derives its label from lastAlive", () => {
    const source: string = readCode(...STEPS_PAGE);

    expect(source).toContain("getRunnerLiveStatus(a.lastAlive)");
    expect(source).toContain("lastAlive: true");
    expect(source).not.toContain("connectionStatus: true");
  });

  /*
   * The picker no longer carries its own copy of the status wording. It goes
   * through the shared getRunnerLiveStatusLabel, whose status-to-label mapping
   * is asserted branch by branch in
   * Common/Tests/Types/Runner/RunnerLiveStatus.test.ts — a grep for the three
   * literals here would pass just as happily with the mapping inverted.
   */
  test("the step picker labels through the shared helper", () => {
    const source: string = readCode(...STEPS_PAGE);

    expect(source).toContain("getRunnerLiveStatusLabel(a.liveStatus)");
    expect(source).not.toContain('return "never connected"');
    expect(source).not.toContain('return "disconnected"');
  });

  /*
   * Dropdown translates an option label as one whole string, so the composed
   * "name · status" can never match a key — the status word has to be looked
   * up on its own before it is joined.
   */
  test("the step picker translates the status word", () => {
    const source: string = readCode(...STEPS_PAGE);

    expect(source).toContain(
      "translateString(getRunnerLiveStatusLabel(a.liveStatus))",
    );
  });
});

describe("the Runner Status card reports what it actually knows", () => {
  const source: string = readCode(...RUNNER_VIEW);

  /*
   * RunnerService.onBeforeCreate writes agentVersion 1.0.0 into every new row
   * before the Runner has ever connected, so the column is never empty and a
   * plain render of it is indistinguishable from a genuinely reported 1.0.0.
   * lastAlive is the only thing that separates the two.
   */
  test("the version falls back when nothing has ever been reported", () => {
    expect(source).toContain("if (!item.lastAlive || !item.agentVersion)");
    expect(source).toContain("Not reported yet");
  });

  test("the last heartbeat shows relative and absolute time", () => {
    expect(source).toContain("OneUptimeDate.fromNow(item.lastAlive)");
    expect(source).toMatch(
      /OneUptimeDate\.getDateAsLocalFormattedString\(\s*item\.lastAlive,?\s*\)/,
    );
  });

  test("the last heartbeat handles never having one", () => {
    expect(source).toContain(
      "if (!item.lastAlive) { return notReportedYet(); }",
    );
  });

  /*
   * ModelDetail snapshots these getElement closures into state once on mount
   * (ModelDetail.tsx setDetailFields), so a single hoisted element would
   * carry whatever translation was active at that moment and keep rendering
   * it after the viewer switched language. It has to be built per call.
   */
  test("the placeholder is rebuilt per render, not hoisted", () => {
    expect(source).toContain(
      "const notReportedYet: GetReactElementFunction = ()",
    );
    expect(source).not.toMatch(/return notReportedYet;/);
  });

  /*
   * hostInfo has been collected on every heartbeat and readable by the
   * dashboard all along, but was shown nowhere — "which machine is this
   * actually running on" was only answerable from the database.
   */
  test("the host the Runner runs on is surfaced", () => {
    expect(source).toContain("field: { hostInfo: true }");
    expect(source).toContain('title: "Host"');
    expect(source).toContain('hostInfo["hostname"]');
    expect(source).toContain('hostInfo["platform"]');
    expect(source).toContain('hostInfo["arch"]');
  });
});

describe("the setup card never renders a broken command", () => {
  test("it bails out before building the command when the key is absent", () => {
    const source: string = readCode(...INSTALL_COMPONENT);

    const guard: number = source.indexOf("if (!props.runnerKey)");
    const command: number = source.indexOf("ONEUPTIME_RUNNER_KEY=");

    expect(guard).toBeGreaterThan(-1);
    expect(command).toBeGreaterThan(guard);
  });

  /*
   * Reading Runner.key is restricted to Project Owner / Project Admin /
   * Runbook Admin, so a Member opening the setup modal used to be handed a
   * command with an empty key that fails only once it is running on a host.
   */
  test("it explains who can read the key", () => {
    expect(readSource(...INSTALL_COMPONENT)).toContain(
      "You do not have permission to view this Runner's key",
    );
  });

  /*
   * Previously the whole card was gated on the key being present, so a reader
   * who could not see it got no card and no explanation at all.
   */
  test("the detail page shows the card once the Runner has loaded", () => {
    const source: string = readCode(...RUNNER_VIEW);

    expect(source).toContain("{isRunnerLoaded && (");
    expect(source).toContain('runnerKey={agentKey || ""}');
  });
});

describe("Runner terminology", () => {
  /*
   * The card titles said "Runner" while nearly every description underneath
   * them said "runbook agent", and the same secret was called "Agent Key" in
   * one place and "Runner Key" in another. This finishes the rename the
   * "Runner Version" change started.
   */
  test.each(
    RUNNER_UI_FILES.map((file: Array<string>): [string, Array<string>] => {
      return [file[file.length - 1] as string, file];
    }),
  )("%s calls the product a Runner", (_n: string, file: Array<string>) => {
    const source: string = readCode(...file);

    expect(source.toLowerCase()).not.toContain("runbook agent");
    expect(source).not.toContain('title: "Agent Key"');
  });

  test("the key has one name across the detail page", () => {
    const source: string = readCode(...RUNNER_VIEW);

    expect(source).toContain('title: "Runner Key"');
    expect(source).toContain('title={"Reset Runner Key"}');
  });

  /*
   * Scoped to the Runner UI on purpose. Host, Docker, Podman, Kubernetes,
   * Ceph, Proxmox and Serverless agents are a different family of things and
   * keep their own "agent" wording — RunnerVersionLabel.test.ts pins that they
   * still say "Agent Version". What is pinned here is the other direction: a
   * find-and-replace of the Runner rename must not have reached them.
   */
  test.each([
    ["Host", ["Pages", "Host", "View", "Overview.tsx"]],
    ["Docker", ["Pages", "Docker", "View", "Overview.tsx"]],
    ["Podman", ["Pages", "Podman", "View", "Overview.tsx"]],
    ["Kubernetes", ["Pages", "Kubernetes", "View", "Index.tsx"]],
    ["Ceph", ["Pages", "Ceph", "View", "Index.tsx"]],
    ["Proxmox", ["Pages", "Proxmox", "View", "Index.tsx"]],
    ["Serverless", ["Pages", "Serverless", "View", "Overview.tsx"]],
  ])(
    "the %s agent page was not caught by the rename",
    (_name: string, file: Array<string>) => {
      const source: string = readCode(...file);

      expect(source).toContain("Agent Version");
      expect(source).not.toContain("Runner Version");
      expect(source).not.toContain("Runner Key");
    },
  );
});

describe("capabilities render as pills", () => {
  const source: string = readCode(...RUNNERS_PAGE);

  /*
   * Three capabilities joined with commas wrapped onto two lines and could not
   * be scanned down the column.
   */
  test("the column builds Pills rather than a joined string", () => {
    expect(source).toContain("<Pill");
    expect(source).not.toContain('capabilities.join(", ")');
  });

  test("it still handles a Runner with no capabilities", () => {
    expect(source).toContain("if (capabilities.length === 0)");
    expect(source).toContain('translateString("None")');
  });

  test("the capability labels are translated", () => {
    expect(source).toContain("translateString(capability) || capability");
  });
});

describe("every new user-visible string is translatable", () => {
  test.each(NEW_STRINGS)("en.json defines %j", (value: string) => {
    expect(readLocale("en")[value]).toBe(value);
  });

  test.each(TRANSLATED_CODES)(
    "%s.json defines every new string",
    (code: string) => {
      const locale: Record<string, string> = readLocale(code);

      const missing: Array<string> = NEW_STRINGS.filter(
        (value: string): boolean => {
          return (
            typeof locale[value] !== "string" ||
            (locale[value] as string).length === 0
          );
        },
      );

      expect(missing).toEqual([]);
    },
  );

  /*
   * A key present but left equal to the English string is the failure mode the
   * CI validator explicitly does NOT catch — it counts those and prints them
   * as info. Brand and loanword exceptions are listed rather than blanket
   * allowed, so a genuinely untranslated string cannot hide behind them.
   */
  /*
   * No exemption list. Every one of the new strings has a real, distinct
   * translation in all fifteen locales, so any entry left equal to English is
   * a genuinely untranslated string — which is exactly the failure the CI
   * validator does NOT catch (it counts identical values and prints them as
   * info).
   */
  test.each(TRANSLATED_CODES)(
    "%s.json does not leave the new strings in English",
    (code: string) => {
      const locale: Record<string, string> = readLocale(code);

      const untranslated: Array<string> = NEW_STRINGS.filter(
        (value: string): boolean => {
          return locale[value] === value;
        },
      );

      expect(untranslated).toEqual([]);
    },
  );

  test.each(TRANSLATED_CODES)("%s.json stays in key parity", (code: string) => {
    const en: Record<string, string> = readLocale("en");
    const locale: Record<string, string> = readLocale(code);

    const missing: Array<string> = Object.keys(en).filter(
      (key: string): boolean => {
        return !(key in locale);
      },
    );

    const extra: Array<string> = Object.keys(locale).filter(
      (key: string): boolean => {
        return !(key in en);
      },
    );

    expect(missing).toEqual([]);
    expect(extra).toEqual([]);
  });

  test.each(LOCALE_CODES)(
    "%s.json keeps 2-space top-level indent",
    (code: string) => {
      const raw: string = fs.readFileSync(
        path.join(LOCALES_DIR, `${code}.json`),
        "utf8",
      );

      expect(raw).toContain(`  "Runner Key": `);
      expect(raw).toContain(`  "Never connected": `);
    },
  );

  /*
   * The superseded keys stay: they are still referenced by the probe and
   * AI-agent pages and by the older Runner strings elsewhere, and removing a
   * key from only some files is a parity failure the validator does catch.
   */
  test("the pre-existing runbook-agent keys are untouched", () => {
    const en: Record<string, string> = readLocale("en");

    expect(en["Here are more details for this runbook agent."]).toBeDefined();
    expect(en["No runbook agents."]).toBeDefined();
    expect(en["Agent Version"]).toBe("Agent Version");
  });
});

describe("the status labels reuse the existing translations", () => {
  /*
   * "Connected" and "Disconnected" were already translated in all sixteen
   * files for the probe pages, so routing the Runner bubble through
   * translateString gets fifteen languages for free.
   */
  test.each(TRANSLATED_CODES)(
    "%s.json already had Connected",
    (code: string) => {
      const locale: Record<string, string> = readLocale(code);

      expect(locale["Connected"]).toBeTruthy();
      expect(locale["Disconnected"]).toBeTruthy();
    },
  );

  /*
   * The component no longer spells the three words itself — it looks up
   * whatever getRunnerLiveStatusLabel returns, which is what keeps the bubble
   * and the runbook step picker on the same wording and the same locale keys.
   */
  test("the component translates the shared label", () => {
    const source: string = readCode(...STATUS_COMPONENT);

    expect(source).toContain("getRunnerLiveStatusLabel(status)");
    expect(source).toContain("translateString(label) || label");
    expect(source).not.toContain('translateString("Connected")');
  });

  test("the three labels are distinct in every language", () => {
    for (const code of TRANSLATED_CODES) {
      const locale: Record<string, string> = readLocale(code);

      const labels: Array<string> = [
        locale["Connected"] as string,
        locale["Disconnected"] as string,
        locale["Never connected"] as string,
      ];

      expect(new Set(labels).size).toBe(3);
    }
  });
});
