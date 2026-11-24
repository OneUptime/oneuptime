import fs from "fs";
import path from "path";
import {
  KUBERNETES_MODULES,
  KUBERNETES_VERSION,
  REQUIREMENTS,
  UPJET_MODULE,
} from "../Core/GoModule";
import {
  compareVersions,
  findStalePins,
  newestRelease,
  parseGoMod,
  parseToolPins,
  Pins,
  PINS_ISSUE_LABELS,
  PINS_ISSUE_TITLE,
  PinPolicy,
  pinsIssueAction,
  readPins,
  Releases,
  renderPinsIssue,
  StalePin,
} from "../Core/Pins";
import { findOpenPinsIssue, keepPinsIssue } from "../CheckPins";

/*
 * The weekly check of the Crossplane provider's pins (#6616): it reports a
 * pin behind its newest compatible release, stays quiet when every one is
 * current, and keeps one issue that says so. "Compatible" is what
 * GoModule.ts's header says: Upjet's newest v2, what moves with it at the
 * newest patch of the minor that Upjet's go.mod requires - never a newer
 * minor, which compiles and fails at run time - and every other pin at its
 * newest release.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..");

/*
 * The releases there were on 2026-11-19: Upjet v2.5.1 (its go.mod requires
 * crossplane-runtime v2.4.0, Crossplane's apis v2.4.1, controller-runtime
 * v0.23.3, controller-tools v0.20.0 and the Kubernetes libraries v0.35.3),
 * with newer patches out, and newer minors that Upjet does not take.
 */
function releasesOf2026_11_19(): Releases {
  const k8s: Array<string> = [
    "v0.35.0",
    "v0.35.3",
    "v0.35.9",
    "v0.35.10",
    "v0.36.0-rc.1",
    "v0.37.2",
  ];

  return {
    moduleVersions: {
      [UPJET_MODULE]: ["v2.4.2", "v2.5.0", "v2.5.1"],
      "github.com/crossplane/crossplane-runtime/v2": [
        "v2.4.0",
        "v2.4.2",
        "v2.4.3",
        "v2.5.0-rc.1",
      ],
      "github.com/crossplane/crossplane/apis/v2": [
        "v2.4.1",
        "v2.4.2",
        "v2.4.3",
        "v2.5.0-rc.1",
      ],
      "sigs.k8s.io/controller-runtime": ["v0.23.2", "v0.23.3", "v0.25.3"],
      "sigs.k8s.io/controller-tools": ["v0.20.0", "v0.20.1", "v0.23.0"],
      "golang.org/x/tools": ["v0.52.0", "v0.53.0"],
      "github.com/alecthomas/kingpin/v2": ["v2.3.2", "v2.4.0"],
      "github.com/pkg/errors": ["v0.9.0", "v0.9.1"],
      "github.com/crossplane/crossplane-tools": [],
      ...Object.fromEntries(
        KUBERNETES_MODULES.map((module: string): [string, Array<string>] => {
          return [module, k8s];
        }),
      ),
    },
    moduleLatest: {
      "github.com/crossplane/crossplane-tools":
        "v0.0.0-20260719180100-659f1dc036c5",
    },
    upjetGoMod: {
      go: "1.26.8",
      require: {
        "github.com/crossplane/crossplane-runtime/v2": "v2.4.0",
        "github.com/crossplane/crossplane/apis/v2": "v2.4.1",
        "sigs.k8s.io/controller-runtime": "v0.23.3",
        "sigs.k8s.io/controller-tools": "v0.20.0",
        "k8s.io/api": "v0.35.3",
        "k8s.io/apiextensions-apiserver": "v0.35.0",
        "k8s.io/apimachinery": "v0.35.3",
        "k8s.io/client-go": "v0.35.3",
      },
    },
    crossplaneChartVersions: ["2.5.0-rc.1", "2.4.3", "2.4.2", "2.3.7"],
    crossplaneCliLatest: "v2.5.0",
    kindLatest: "v0.33.0",
  };
}

// The pins main had before #6616 moved them.
function pinsBefore6616(): Pins {
  const pins: Pins = readPins(REPOSITORY_ROOT);
  const old: Record<string, string> = {
    "github.com/crossplane/crossplane/apis/v2": "v2.4.1",
    "golang.org/x/tools": "v0.52.0",
    "sigs.k8s.io/controller-tools": "v0.20.0",
  };

  return {
    go: "1.25.0",
    modules: pins.modules.map((pin: Pins["modules"][number]) => {
      if (KUBERNETES_MODULES.includes(pin.module)) {
        return { ...pin, version: "v0.35.3" };
      }

      return old[pin.module] ? { ...pin, version: old[pin.module]! } : pin;
    }),
    tools: pins.tools,
  };
}

function names(stale: Array<StalePin>): Array<string> {
  return stale.map((pin: StalePin): string => {
    return pin.name;
  });
}

describe("the pins as the repository has them", () => {
  test("are GoModule.ts's, and the tools of the end-to-end test, read from the files that pin them", () => {
    const pins: Pins = readPins(REPOSITORY_ROOT);

    expect(
      pins.modules.find((pin: Pins["modules"][number]): boolean => {
        return pin.module === UPJET_MODULE;
      }),
    ).toEqual({
      module: UPJET_MODULE,
      version: REQUIREMENTS[UPJET_MODULE],
      policy: PinPolicy.Upjet,
    });
    expect(
      pins.modules.filter((pin: Pins["modules"][number]): boolean => {
        return KUBERNETES_MODULES.includes(pin.module);
      }),
    ).toHaveLength(KUBERNETES_MODULES.length);
    expect(
      pins.modules.find((pin: Pins["modules"][number]): boolean => {
        return pin.module === "k8s.io/client-go";
      })?.version,
    ).toBe(KUBERNETES_VERSION);
    expect(pins.tools.crossplaneChart).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pins.tools.crossplaneCli).toMatch(/^v\d+\.\d+\.\d+$/);
    expect(pins.tools.kind).toMatch(/^v\d+\.\d+\.\d+$/);
  });

  test("the README's settings table names the chart the script pins", () => {
    const readme: string = fs.readFileSync(
      path.join(REPOSITORY_ROOT, "packages/E2E/Crossplane/e2e-tests/README.md"),
      "utf8",
    );

    expect(readme).toContain(
      `| \`CROSSPLANE_E2E_CROSSPLANE_VERSION\` | \`${readPins(REPOSITORY_ROOT).tools.crossplaneChart}\` |`,
    );
  });

  test("reading a file that pins nothing fails, rather than checking nothing", () => {
    expect(() => {
      return parseToolPins("", "");
    }).toThrow("No pin for the Crossplane chart found.");
  });
});

describe("what is behind", () => {
  test("stays quiet when every pin is at its newest compatible release", () => {
    expect(
      findStalePins(readPins(REPOSITORY_ROOT), releasesOf2026_11_19()),
    ).toEqual([]);
  });

  test("reports the pins main had before #6616, and nothing a newer minor would break", () => {
    const stale: Array<StalePin> = findStalePins(
      pinsBefore6616(),
      releasesOf2026_11_19(),
    );

    expect(stale).toEqual(
      expect.arrayContaining([
        {
          name: "github.com/crossplane/crossplane/apis/v2",
          pinned: "v2.4.1",
          newest: "v2.4.3",
          where:
            "Scripts/CrossplaneProvider/Core/GoModule.ts (moves with Upjet)",
        },
        {
          name: "k8s.io/api",
          pinned: "v0.35.3",
          newest: "v0.35.10",
          where:
            "Scripts/CrossplaneProvider/Core/GoModule.ts (moves with Upjet)",
        },
        {
          name: "Go",
          pinned: "1.25.0",
          newest: "1.26.8",
          where:
            "Scripts/CrossplaneProvider/Core/GoModule.ts (GO_VERSION, Upjet's go line)",
        },
      ]),
    );
    expect(names(stale).sort()).toEqual(
      [
        "github.com/crossplane/crossplane/apis/v2",
        "golang.org/x/tools",
        "sigs.k8s.io/controller-tools",
        ...KUBERNETES_MODULES,
        "Go",
      ].sort(),
    );
    // controller-runtime v0.25 and Kubernetes v0.37 are out, but Upjet takes neither.
    expect(
      stale.find((pin: StalePin): boolean => {
        return pin.name === "sigs.k8s.io/controller-tools";
      })?.newest,
    ).toBe("v0.20.1");
    expect(names(stale)).not.toContain("sigs.k8s.io/controller-runtime");
  });

  test("a new Upjet is behind, and moves what its go.mod requires to that go.mod's minor", () => {
    const releases: Releases = releasesOf2026_11_19();
    releases.moduleVersions[UPJET_MODULE]!.push("v2.6.0");
    releases.moduleVersions["sigs.k8s.io/controller-runtime"]!.push(
      "v0.24.0",
      "v0.24.2",
    );
    releases.upjetGoMod.require["sigs.k8s.io/controller-runtime"] = "v0.24.0";

    const stale: Array<StalePin> = findStalePins(
      readPins(REPOSITORY_ROOT),
      releases,
    );

    expect(stale).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: UPJET_MODULE,
          newest: "v2.6.0",
        }),
        expect.objectContaining({
          name: "sigs.k8s.io/controller-runtime",
          newest: "v0.24.2",
        }),
      ]),
    );
  });

  test("a newer Crossplane chart, CLI or kind is behind; a release candidate is not", () => {
    const releases: Releases = releasesOf2026_11_19();
    releases.crossplaneChartVersions.unshift("2.5.0", "2.6.0-rc.1");
    releases.crossplaneCliLatest = "v2.6.0";
    releases.kindLatest = "v0.34.0";

    expect(
      findStalePins(readPins(REPOSITORY_ROOT), releases).map(
        (pin: StalePin): [string, string] => {
          return [pin.name, pin.newest];
        },
      ),
    ).toEqual([
      ["Crossplane Helm chart (end-to-end test)", "2.5.0"],
      ["crossplane CLI", "v2.6.0"],
      ["kind", "v0.34.0"],
    ]);

    releases.crossplaneChartVersions = ["2.6.0-rc.1", "2.4.3"];
    releases.crossplaneCliLatest = "v2.6.0-rc.1";
    releases.kindLatest = "v0.34.0-alpha";

    expect(findStalePins(readPins(REPOSITORY_ROOT), releases)).toEqual([]);
  });

  test("a newer commit of crossplane-tools, pinned by a pseudo-version, is behind", () => {
    const releases: Releases = releasesOf2026_11_19();
    releases.moduleLatest["github.com/crossplane/crossplane-tools"] =
      "v0.0.0-20261101120000-0123456789ab";

    expect(findStalePins(readPins(REPOSITORY_ROOT), releases)).toEqual([
      expect.objectContaining({
        name: "github.com/crossplane/crossplane-tools",
        newest: "v0.0.0-20261101120000-0123456789ab",
      }),
    ]);
  });
});

describe("versions", () => {
  test("compare as semantic versions, a release after its candidates, pseudo-versions by time", () => {
    expect(compareVersions("v0.35.10", "v0.35.9")).toBeGreaterThan(0);
    expect(compareVersions("v2.5.0", "v2.5.0-rc.1")).toBeGreaterThan(0);
    expect(compareVersions("1.26.8", "1.25.0")).toBeGreaterThan(0);
    expect(compareVersions("v2.4.3", "v2.4.3")).toBe(0);
    expect(
      compareVersions(
        "v0.0.0-20260719180100-659f1dc036c5",
        "v0.0.0-20261101120000-0123456789ab",
      ),
    ).toBeLessThan(0);
  });

  test("the newest release of a list leaves candidates out", () => {
    expect(newestRelease(["v2.4.3", "v2.5.0-rc.1", "v2.4.10"])).toBe("v2.4.10");
    expect(newestRelease(["v2.5.0-rc.1"])).toBeNull();
    expect(newestRelease([])).toBeNull();
  });

  test("a go.mod's go line and its requirements, a block's and a line's, indirect ones too", () => {
    expect(
      parseGoMod(
        [
          "module github.com/crossplane/upjet/v2",
          "",
          "go 1.26.8",
          "",
          "require (",
          "\tgithub.com/crossplane/crossplane-runtime/v2 v2.4.0",
          "\tk8s.io/api v0.35.3",
          ")",
          "",
          "require (",
          "\tsigs.k8s.io/controller-tools v0.20.0 // indirect",
          ")",
          "require github.com/pkg/errors v0.9.1",
          "replace k8s.io/api => k8s.io/api v0.35.3",
        ].join("\n"),
      ),
    ).toEqual({
      go: "1.26.8",
      require: {
        "github.com/crossplane/crossplane-runtime/v2": "v2.4.0",
        "k8s.io/api": "v0.35.3",
        "sigs.k8s.io/controller-tools": "v0.20.0",
        "github.com/pkg/errors": "v0.9.1",
      },
    });
  });
});

// A fake gh: answers `issue list` with `issues`, records every call.
function fakeGh(issues: Array<{ number: number; title: string }>): {
  gh: (args: Array<string>) => string;
  calls: Array<Array<string>>;
} {
  const calls: Array<Array<string>> = [];

  return {
    calls,
    gh: (args: Array<string>): string => {
      calls.push(args);
      return args[0] === "issue" && args[1] === "list"
        ? JSON.stringify(issues)
        : "";
    },
  };
}

const STALE: Array<StalePin> = [
  { name: "kind", pinned: "v0.33.0", newest: "v0.34.0", where: "action.yml" },
];

describe("the one issue", () => {
  test.each([
    [null, [], "nothing"],
    [7, [], "close"],
    [null, STALE, "create"],
    [7, STALE, "update"],
  ])(
    "open issue %s, %j behind: %s",
    (openIssue: number | null, stale: Array<StalePin>, action: string) => {
      expect(pinsIssueAction(openIssue, stale)).toBe(action);
    },
  );

  test("only an issue with exactly the title counts", () => {
    expect(
      findOpenPinsIssue(
        fakeGh([
          { number: 3, title: `${PINS_ISSUE_TITLE} (old)` },
          { number: 4, title: PINS_ISSUE_TITLE },
        ]).gh,
      ),
    ).toBe(4);
    expect(findOpenPinsIssue(fakeGh([]).gh)).toBeNull();
  });

  test("opens it, rewrites it, closes it: never another", () => {
    const opened: ReturnType<typeof fakeGh> = fakeGh([]);
    keepPinsIssue({ stale: STALE, gh: opened.gh, bodyFile: "/tmp/body.md" });
    expect(opened.calls[1]).toEqual([
      "issue",
      "create",
      "--title",
      PINS_ISSUE_TITLE,
      "--body-file",
      "/tmp/body.md",
      "--label",
      "follow-up",
      "--label",
      "enhancement",
    ]);
    expect(PINS_ISSUE_LABELS).toEqual(["follow-up", "enhancement"]);

    const open: ReturnType<typeof fakeGh> = fakeGh([
      { number: 9, title: PINS_ISSUE_TITLE },
    ]);
    keepPinsIssue({ stale: STALE, gh: open.gh, bodyFile: "/tmp/body.md" });
    expect(open.calls[1]).toEqual([
      "issue",
      "edit",
      "9",
      "--body-file",
      "/tmp/body.md",
    ]);

    const current: ReturnType<typeof fakeGh> = fakeGh([
      { number: 9, title: PINS_ISSUE_TITLE },
    ]);
    keepPinsIssue({ stale: [], gh: current.gh, bodyFile: "/tmp/body.md" });
    expect(current.calls[1]?.slice(0, 3)).toEqual(["issue", "close", "9"]);

    const quiet: ReturnType<typeof fakeGh> = fakeGh([]);
    keepPinsIssue({ stale: [], gh: quiet.gh, bodyFile: "/tmp/body.md" });
    expect(quiet.calls).toHaveLength(1);
  });

  test("lists each pin behind, and says how to upgrade the set", () => {
    const body: string = renderPinsIssue(STALE, "https://example.com/run/1");

    expect(body).toContain("| `kind` | v0.33.0 | v0.34.0 | `action.yml` |");
    expect(body).toContain("Scripts/CrossplaneProvider/Core/GoModule.ts");
    expect(body).toContain("check-package.sh --run");
    expect(body).toContain("Checked by https://example.com/run/1.");
  });
});
