"use strict";

/**
 * packages/Common/Scripts/first-load-budgets.js - what a visitor downloads
 * before a public page can draw, held to a ceiling per page (issue #5608).
 *
 * A Lighthouse performance score on a pull request moves with the speed of
 * the runner, so the public frontends are held to bytes instead: the gzip
 * size of the frontend's entry, the page's own chunk and everything they
 * import statically. The script builds each frontend and measures it; these
 * tests feed its functions metafiles shaped like esbuild's, and hold the
 * Compile workflow to running it where the frontends are installed.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const yaml = require("js-yaml");

const {
  FRONTENDS,
  GZIP_LEVEL,
  PAGES,
  WARNING_HEADROOM_SHARE,
  describe: describeResult,
  describeSingleCopies,
  escapeAnnotation,
  firstLoadOutputs,
  heaviest,
  measurePage,
  outputFor,
  report,
  singleCopies,
  warnNearCeiling,
  weightKey,
} = require("../../packages/Common/Scripts/first-load-budgets.js");
const { seededRandom } = require("./Utils/SeededRandom");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const FEATURE_SETS = path.join(REPO_ROOT, "packages", "App", "FeatureSet");
const COMPILE_WORKFLOW = path.join(
  REPO_ROOT,
  ".github",
  "workflows",
  "compile.yml",
);
const SCRIPT = "packages/Common/Scripts/first-load-budgets.js";

function output(data) {
  return {
    bytes: data.bytes || 100,
    inputs: data.inputs || {},
    imports: data.imports || [],
    exports: [],
    ...(data.entryPoint ? { entryPoint: data.entryPoint } : {}),
  };
}

function statically(file) {
  return { path: file, kind: "import-statement" };
}

function dynamically(file) {
  return { path: file, kind: "dynamic-import" };
}

/*
 * A frontend's build: an entry with a shared chunk and a lazily loaded
 * route, which has a chunk of its own, and another route nobody visits.
 */
const METAFILE = {
  inputs: {},
  outputs: {
    "public/dist/Index.js": output({
      entryPoint: "src/Index.tsx",
      imports: [
        statically("public/dist/chunk-SHARED.js"),
        dynamically("public/dist/Login-AAAA.js"),
        dynamically("public/dist/Register-BBBB.js"),
        {
          path: "react-native-sqlite-storage",
          kind: "import-statement",
          external: true,
        },
      ],
      inputs: {
        "src/Index.tsx": { bytesInOutput: 300 },
        "node_modules/react-dom/cjs/react-dom.production.min.js": {
          bytesInOutput: 4000,
        },
      },
    }),
    "public/dist/chunk-SHARED.js": output({
      imports: [statically("public/dist/Index.js")],
      inputs: {
        "../../../Common/UI/Components/Button/Button.tsx": {
          bytesInOutput: 2000,
        },
        "../../../Common/node_modules/moment-timezone/index.js": {
          bytesInOutput: 9000,
        },
      },
    }),
    "public/dist/Login-AAAA.js": output({
      entryPoint: "src/Pages/Login.tsx",
      imports: [
        statically("public/dist/chunk-SHARED.js"),
        statically("public/dist/chunk-LOGIN.js"),
        dynamically("public/dist/MarkdownViewer-CCCC.js"),
      ],
      inputs: { "src/Pages/Login.tsx": { bytesInOutput: 700 } },
    }),
    "public/dist/chunk-LOGIN.js": output({
      inputs: {
        "../../../Common/node_modules/@scope/form/node_modules/inner/index.js":
          {
            bytesInOutput: 1500,
          },
      },
    }),
    "public/dist/Register-BBBB.js": output({
      entryPoint: "src/Pages/Register.tsx",
      inputs: { "src/Pages/Register.tsx": { bytesInOutput: 800 } },
    }),
    "public/dist/MarkdownViewer-CCCC.js": output({
      entryPoint:
        "../../../Common/UI/Components/Markdown.tsx/MarkdownViewer.tsx",
      inputs: {
        "../../../Common/node_modules/katex/katex.mjs": {
          bytesInOutput: 99999,
        },
      },
    }),
  },
};

// Each output's contents: text that compresses to a known size.
function contentsOf(file) {
  return Buffer.from(`${file}\n`.repeat(METAFILE.outputs[file].bytes));
}

function gzipped(file) {
  return zlib.gzipSync(contentsOf(file), { level: GZIP_LEVEL }).length;
}

/*
 * Each output as 64 KiB that gzip cannot shrink, the same every run: a page
 * large enough that 1% of its ceiling is hundreds of bytes. The bytes are
 * SHA-256 digests of the file's name and a block number, one after another:
 * no generator of the test's own (SeededRandomGuard), and a .js suite with
 * no transform cannot import Tests/Helpers/SeededRandom.ts.
 */
function largeContentsOf(file) {
  const blocks = [];

  for (let block = 0; block < (64 * 1024) / 32; block++) {
    blocks.push(
      crypto.createHash("sha256").update(`${file}\n${block}`).digest(),
    );
  }

  return Buffer.concat(blocks);
}

describe("the outputs a page loads first", () => {
  test("are the entry, the page's chunk and what they import statically, transitively", () => {
    expect(
      firstLoadOutputs(METAFILE, [
        "public/dist/Index.js",
        "public/dist/Login-AAAA.js",
      ]),
    ).toEqual([
      "public/dist/Index.js",
      "public/dist/Login-AAAA.js",
      "public/dist/chunk-LOGIN.js",
      "public/dist/chunk-SHARED.js",
    ]);
  });

  test("leave out lazily loaded chunks, other pages' chunks and external imports, and survive a cycle", () => {
    const loaded = firstLoadOutputs(METAFILE, ["public/dist/Index.js"]);

    expect(loaded).toEqual([
      "public/dist/Index.js",
      "public/dist/chunk-SHARED.js",
    ]);
    expect(loaded).not.toContain("public/dist/MarkdownViewer-CCCC.js");
  });

  test("are found from a page's source file, and a page that moved says what to do", () => {
    expect(outputFor(METAFILE, "src/Pages/Register.tsx")).toBe(
      "public/dist/Register-BBBB.js",
    );
    expect(() => {
      return outputFor(METAFILE, "src/Pages/SignIn.tsx");
    }).toThrow(
      "No output was built from src/Pages/SignIn.tsx: has it moved? Update PAGES in first-load-budgets.js.",
    );
  });
});

describe("a page's measure", () => {
  const page = {
    frontend: "Accounts",
    page: "sign-in (/accounts/login)",
    route: "src/Pages/Login.tsx",
  };
  const loaded = [
    "public/dist/Index.js",
    "public/dist/Login-AAAA.js",
    "public/dist/chunk-LOGIN.js",
    "public/dist/chunk-SHARED.js",
  ];
  const bytes = loaded.reduce((sum, file) => {
    return sum + gzipped(file);
  }, 0);

  test("is the gzip size of every file it loads first, as Nginx compresses them", () => {
    const result = measurePage(
      METAFILE,
      { ...page, ceiling: bytes },
      contentsOf,
    );

    expect(GZIP_LEVEL).toBe(5);
    expect(result).toEqual({
      ...page,
      ceiling: bytes,
      outputs: loaded,
      bytes,
      over: false,
      headroom: 0,
      nearCeiling: true,
      heaviest: [],
    });
  });

  test("says what is left under the ceiling, and whether that is less than 1% of it", () => {
    expect(WARNING_HEADROOM_SHARE).toBe(0.01);

    const at = (ceiling) => {
      return measurePage(METAFILE, { ...page, ceiling }, largeContentsOf);
    };
    const large = at(1).bytes;

    // Half the ceiling left, and 2% of it: not close.
    expect(at(large * 2)).toMatchObject({
      headroom: large,
      nearCeiling: false,
    });
    expect(at(Math.floor(large / 0.98)).nearCeiling).toBe(false);

    // Half a per cent of it left: close, and still under it.
    expect(at(Math.ceil(large / 0.995))).toMatchObject({
      over: false,
      nearCeiling: true,
    });

    // Exactly at the ceiling: nothing left, and not over it.
    expect(at(large)).toMatchObject({
      headroom: 0,
      over: false,
      nearCeiling: true,
    });

    // Over it: a failure, not a warning.
    expect(at(large - 1)).toMatchObject({
      headroom: -1,
      over: true,
      nearCeiling: false,
    });
  });

  test("over its ceiling, names the packages and folders that weigh the most in it", () => {
    const result = measurePage(
      METAFILE,
      { ...page, ceiling: bytes - 1 },
      contentsOf,
    );

    expect(result.over).toBe(true);
    expect(result.heaviest).toEqual([
      { name: "moment-timezone", bytes: 9000 },
      { name: "react-dom", bytes: 4000 },
      { name: "../../../Common/UI", bytes: 2000 },
      { name: "inner", bytes: 1500 },
      { name: "src/Pages", bytes: 700 },
      { name: "src", bytes: 300 },
    ]);
  });

  test("reads as one line under its ceiling, and says what to do over it", () => {
    const under = measurePage(
      METAFILE,
      { ...page, ceiling: 10 * 1024 },
      contentsOf,
    );

    expect(
      describeResult({
        ...under,
        bytes: 2048,
        headroom: 8 * 1024,
        outputs: loaded,
      }),
    ).toBe(
      "Accounts sign-in (/accounts/login): 2.0 KiB gzipped in 4 files, ceiling 10.0 KiB, 8.0 KiB under it",
    );

    // Over a ceiling of one byte, read as 1.5 KiB against 1 KiB.
    const over = measurePage(METAFILE, { ...page, ceiling: 1 }, contentsOf);
    const lines = describeResult({ ...over, bytes: 1536, ceiling: 1024 }).split(
      "\n",
    );

    expect(lines[0]).toBe(
      "Accounts sign-in (/accounts/login): 1.5 KiB gzipped in 4 files, ceiling 1.0 KiB - OVER by 0.5 KiB.",
    );
    expect(lines[2]).toBe("         8.8 KiB  moment-timezone");
    expect(lines[lines.length - 1]).toMatch(
      /import\(\) it where it is used\), or raise the ceiling in packages\/Common\/Scripts\/first-load-budgets\.js, saying when and why\.$/,
    );
  });
});

describe("a page close to its ceiling", () => {
  // As measurePage reads a page: what report and the warning are handed.
  const result = (overrides) => {
    return {
      frontend: "Accounts",
      page: "sign-up (/accounts/register)",
      route: "src/Pages/Register.tsx",
      ceiling: 770 * 1024,
      outputs: ["public/dist/Index.js"],
      heaviest: [],
      ...overrides,
    };
  };

  const near = result({
    bytes: 768 * 1024,
    headroom: 2 * 1024,
    over: false,
    nearCeiling: true,
  });
  const roomy = result({
    page: "sign-in (/accounts/login)",
    bytes: 700 * 1024,
    headroom: 70 * 1024,
    over: false,
    nearCeiling: false,
  });
  const over = result({
    frontend: "StatusPage",
    page: "a status page",
    bytes: 771 * 1024,
    headroom: -1024,
    over: true,
    nearCeiling: false,
    heaviest: [{ name: "moment-timezone", bytes: 9000 }],
  });

  test("warns as a GitHub annotation, saying what is left and what to do", () => {
    expect(warnNearCeiling(near)).toBe(
      "::warning title=First-load budget::Accounts sign-up (/accounts/register) is 2.0 KiB under its ceiling of 770.0 KiB, less than 1%25 of it: the next change that adds to what it loads first fails the Compile workflow. Keep what the page does not draw out of its static imports (import() it where it is used), as packages/Common/Scripts/first-load-budgets.js says beside its ceiling.",
    );
  });

  test("escapes what a workflow command would read as its own: a per cent sign and a line break", () => {
    expect(escapeAnnotation("1% of it\r\nleft, 100%")).toBe(
      "1%25 of it%0D%0Aleft, 100%25",
    );
    expect(escapeAnnotation("nothing to escape")).toBe("nothing to escape");
  });

  test("the run prints a line for each page, then a warning for each page close to its ceiling, and passes", () => {
    expect(report([roomy, near])).toEqual({
      lines: [
        describeResult(roomy),
        describeResult(near),
        warnNearCeiling(near),
      ],
      failed: false,
    });
  });

  test("a page over its ceiling fails the run, and is not warned of besides", () => {
    const run = report([near, over]);

    expect(run.failed).toBe(true);
    expect(run.lines).toEqual([
      describeResult(near),
      describeResult(over),
      warnNearCeiling(near),
    ]);
    expect(run.lines[1]).toContain("OVER by 1.0 KiB.");
  });

  test("pages with room to spare print their lines alone", () => {
    expect(report([roomy])).toEqual({
      lines: [describeResult(roomy)],
      failed: false,
    });
    expect(describeResult(roomy)).toBe(
      "Accounts sign-in (/accounts/login): 700.0 KiB gzipped in 1 files, ceiling 770.0 KiB, 70.0 KiB under it",
    );
  });
});

describe("what an input weighs toward", () => {
  test.each([
    ["node_modules/react-dom/cjs/react-dom.production.min.js", "react-dom"],
    ["../../../Common/node_modules/@scope/pkg/dist/index.js", "@scope/pkg"],
    [
      "../../../Common/node_modules/outer/node_modules/@scope/inner/index.js",
      "@scope/inner",
    ],
    ["../../../Common/UI/Components/Button/Button.tsx", "../../../Common/UI"],
    ["../Dashboard/src/Components/Chart.tsx", "../Dashboard/src"],
    ["src/Pages/Login.tsx", "src/Pages"],
    ["src/Index.tsx", "src"],
    ["<runtime>", "<runtime>"],
  ])("%s weighs toward %s", (input, key) => {
    expect(weightKey(input)).toBe(key);
  });

  test("the heaviest are counted across every output, heaviest first, ties by name", () => {
    expect(
      heaviest(
        {
          outputs: {
            a: output({
              inputs: {
                "node_modules/b/x.js": { bytesInOutput: 5 },
                "node_modules/a/x.js": { bytesInOutput: 5 },
              },
            }),
            c: output({
              inputs: { "node_modules/c/x.js": { bytesInOutput: 3 } },
            }),
            d: output({
              inputs: { "node_modules/c/y.js": { bytesInOutput: 4 } },
            }),
          },
        },
        ["a", "c", "d"],
        2,
      ),
    ).toEqual([
      { name: "c", bytes: 7 },
      { name: "a", bytes: 5 },
    ]);
  });
});

/*
 * Each frontend's bundle holds one copy of each package its code imports
 * (issue #9335): a public dashboard carried recharts twice, Common's copy
 * for Common's charts and the Dashboard's for its widgets.
 */
describe("a frontend's copies of a package", () => {
  // A public dashboard's build, with recharts and @babel/runtime twice.
  const TWICE = {
    inputs: {
      "../../../Common/UI/Components/Charts/ChartLibrary/LineChart/LineChart.tsx":
        {
          imports: [
            { path: "../../../Common/node_modules/recharts/es6/index.js" },
          ],
        },
      "../Dashboard/src/Components/Dashboard/Components/DashboardLogChartComponent.tsx":
        {
          imports: [
            { path: "../Dashboard/node_modules/recharts/es6/index.js" },
          ],
        },
      "../Dashboard/node_modules/jspdf/dist/jspdf.es.min.js": {
        imports: [
          {
            path: "../Dashboard/node_modules/@babel/runtime/helpers/esm/typeof.js",
          },
        ],
      },
      "../../../Common/node_modules/react-big-calendar/dist/index.js": {
        imports: [
          {
            path: "../../../Common/node_modules/@babel/runtime/helpers/esm/extends.js",
          },
        ],
      },
    },
    outputs: {
      "public/dist/Index.js": output({
        inputs: {
          "../../../Common/node_modules/recharts/es6/index.js": {
            bytesInOutput: 291942,
          },
          "../Dashboard/node_modules/recharts/es6/index.js": {
            bytesInOutput: 291430,
          },
          "../Dashboard/node_modules/@babel/runtime/helpers/esm/typeof.js": {
            bytesInOutput: 2355,
          },
          "../../../Common/node_modules/@babel/runtime/helpers/esm/extends.js":
            { bytesInOutput: 6042 },
        },
      }),
    },
  };

  // As the run reads them, from each install's package.json.
  const VERSIONS = {
    "../../../Common/node_modules recharts": "3.8.1",
    "../Dashboard/node_modules recharts": "3.9.0",
    "../../../Common/node_modules @babel/runtime": "7.28.4",
    "../Dashboard/node_modules @babel/runtime": "7.29.2",
  };

  const versionOf = (install, name) => {
    return VERSIONS[`${install} ${name}`] || null;
  };

  const twice = singleCopies("PublicDashboard", TWICE, versionOf);
  const once = singleCopies(
    "Accounts",
    {
      inputs: {},
      outputs: {
        "public/dist/Index.js": output({
          inputs: {
            "../../../Common/node_modules/recharts/es6/index.js": {
              bytesInOutput: 291942,
            },
          },
        }),
      },
    },
    versionOf,
  );

  test("are each package from two installs, and whether its own code imports it from more than one, with each copy's version", () => {
    expect(twice.frontend).toBe("PublicDashboard");
    expect(twice.twice).toEqual([
      {
        name: "recharts",
        installs: [
          {
            install: "../../../Common/node_modules",
            bytes: 291942,
            importedByOwnCode: true,
            version: "3.8.1",
          },
          {
            install: "../Dashboard/node_modules",
            bytes: 291430,
            importedByOwnCode: true,
            version: "3.9.0",
          },
        ],
      },
    ]);
    expect(
      twice.alsoTwice.map((bundled) => {
        return bundled.name;
      }),
    ).toEqual(["@babel/runtime"]);
    expect(once).toEqual({ frontend: "Accounts", twice: [], alsoTwice: [] });
  });

  test("a package its code imports from two installs reads as a failure that says what to do", () => {
    const lines = describeSingleCopies(twice);

    expect(lines).toHaveLength(2);
    expect(lines[0].split("\n")[0]).toBe(
      "PublicDashboard bundles recharts twice, and its own code imports it from more than one install: 3.8.1 (285.1 KiB) from ../../../Common/node_modules and 3.9.0 (284.6 KiB) from ../Dashboard/node_modules, before gzip.",
    );
    expect(lines[0].split("\n")[1]).toContain(
      "Run npm update recharts where the copy is older, so one version serves both",
    );
    expect(lines[0]).toContain("packages/Common/UI/esbuild-single-copy.js");
    // A second copy only a package brings is listed, not failed.
    expect(lines[1]).toBe(
      "  Packages of its own install also bring a second copy of @babel/runtime: 7.28.4 (5.9 KiB) from ../../../Common/node_modules and 7.29.2 (2.3 KiB) from ../Dashboard/node_modules.",
    );
  });

  test("one copy of each reads as one line, and a copy whose version cannot be read is named without one", () => {
    expect(describeSingleCopies(once)).toEqual([
      "Accounts bundles one copy of each package its code imports.",
    ]);

    const unversioned = singleCopies("PublicDashboard", TWICE);

    expect(describeSingleCopies(unversioned)[0].split("\n")[0]).toBe(
      "PublicDashboard bundles recharts twice, and its own code imports it from more than one install: (285.1 KiB) from ../../../Common/node_modules and (284.6 KiB) from ../Dashboard/node_modules, before gzip.",
    );
  });

  test("three copies read as three times", () => {
    const thrice = singleCopies("PublicDashboard", {
      inputs: {
        "src/A.tsx": {
          imports: [{ path: "node_modules/use-async-effect/index.js" }],
        },
        "../Dashboard/src/B.tsx": {
          imports: [
            { path: "../Dashboard/node_modules/use-async-effect/index.js" },
          ],
        },
      },
      outputs: {
        "public/dist/Index.js": output({
          inputs: {
            "node_modules/use-async-effect/index.js": { bytesInOutput: 300 },
            "../Dashboard/node_modules/use-async-effect/index.js": {
              bytesInOutput: 300,
            },
            "../../../Common/node_modules/use-async-effect/index.js": {
              bytesInOutput: 300,
            },
          },
        }),
      },
    });

    expect(thrice.twice).toHaveLength(1);
    expect(describeSingleCopies(thrice)[0]).toMatch(
      /^PublicDashboard bundles use-async-effect 3 times, /,
    );
  });

  test("the run fails on a package a frontend's code imports twice, after the pages' lines, and not on a second copy a package brings", () => {
    const page = {
      frontend: "PublicDashboard",
      page: "a public dashboard",
      route: "src/Pages/AllPages.tsx",
      ceiling: 1310 * 1024,
      bytes: 1200 * 1024,
      headroom: 110 * 1024,
      outputs: ["public/dist/Index.js"],
      over: false,
      nearCeiling: false,
      heaviest: [],
    };
    const onlyAPackagesCopy = { ...twice, twice: [] };

    expect(report([page], [twice, once])).toEqual({
      lines: [
        describeResult(page),
        ...describeSingleCopies(twice),
        ...describeSingleCopies(once),
      ],
      failed: true,
    });
    expect(report([page], [onlyAPackagesCopy, once]).failed).toBe(false);
    expect(report([page], [once])).toEqual({
      lines: [describeResult(page), ...describeSingleCopies(once)],
      failed: false,
    });
  });
});

describe("the frontends the run checks for their copies", () => {
  test("are every frontend built from the shared esbuild config, the pages' among them", () => {
    const sharedConfig = fs
      .readdirSync(FEATURE_SETS)
      .filter((frontend) => {
        const config = path.join(FEATURE_SETS, frontend, "esbuild.config.js");

        return (
          fs.existsSync(config) &&
          /require\("Common\/UI\/esbuild-config"\)/.test(
            fs.readFileSync(config, "utf8"),
          )
        );
      })
      .sort();

    expect([...FRONTENDS].sort()).toEqual(sharedConfig);
    expect(FRONTENDS).toEqual(
      expect.arrayContaining(
        PAGES.map((page) => {
          return page.frontend;
        }),
      ),
    );
  });
});

describe("the pages the budget holds", () => {
  test("are the public frontends' sign-in and sign-up, a status page and a public dashboard", () => {
    expect(
      PAGES.map((page) => {
        return `${page.frontend} ${page.route}`;
      }),
    ).toEqual([
      "Accounts src/Pages/Login.tsx",
      "Accounts src/Pages/Register.tsx",
      "StatusPage src/Pages/AllPages.tsx",
      "PublicDashboard src/Pages/AllPages.tsx",
    ]);
  });

  test.each(PAGES.map((page) => [`${page.frontend} ${page.page}`, page]))(
    "%s: its route is a file in its frontend, which builds with the shared config",
    (_name, page) => {
      const folder = path.join(FEATURE_SETS, page.frontend);

      expect(fs.existsSync(path.join(folder, page.route))).toBe(true);
      expect(fs.existsSync(path.join(folder, "src", "Index.tsx"))).toBe(true);
      expect(
        fs.readFileSync(path.join(folder, "esbuild.config.js"), "utf8"),
      ).toMatch(/require\("Common\/UI\/esbuild-config"\)/);
      expect(Number.isInteger(page.ceiling) && page.ceiling > 0).toBe(true);
    },
  );
});

describe("compile.yml's compile-frontends job", () => {
  const job = yaml.load(fs.readFileSync(COMPILE_WORKFLOW, "utf8")).jobs[
    "compile-frontends"
  ];
  const steps = job.steps;
  const budget = steps.findIndex((step) => {
    return String(step.run || "").includes(SCRIPT);
  });

  test("runs the budget", () => {
    expect(budget).toBeGreaterThan(-1);
  });

  test("runs it once every frontend it builds is installed, Dashboard among them, whose sources Public Dashboard imports", () => {
    const installed = steps
      .slice(0, budget)
      .map((step) => {
        return (step.with || {})["working-directory"];
      })
      .filter(Boolean);

    expect(FRONTENDS).toContain("Dashboard");
    expect(installed).toEqual(
      expect.arrayContaining([
        "packages/Common",
        ...FRONTENDS.map((frontend) => {
          return `packages/App/FeatureSet/${frontend}`;
        }),
      ]),
    );
  });

  test("runs it unless the run was cancelled, under a limit of its own", () => {
    expect(steps[budget].if).toBe("${{ !cancelled() }}");
    expect(steps[budget]["timeout-minutes"]).toBeGreaterThan(0);
  });
});
