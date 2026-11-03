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

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const yaml = require("js-yaml");

const {
  GZIP_LEVEL,
  PAGES,
  describe: describeResult,
  firstLoadOutputs,
  heaviest,
  measurePage,
  outputFor,
  weightKey,
} = require("../../packages/Common/Scripts/first-load-budgets.js");

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
      heaviest: [],
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

    expect(describeResult({ ...under, bytes: 2048, outputs: loaded })).toBe(
      "Accounts sign-in (/accounts/login): 2.0 KiB gzipped in 4 files, ceiling 10.0 KiB",
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

  test("runs it once every frontend it builds is installed, and Dashboard, whose sources Public Dashboard imports", () => {
    const installed = steps
      .slice(0, budget)
      .map((step) => {
        return (step.with || {})["working-directory"];
      })
      .filter(Boolean);

    expect(installed).toEqual(
      expect.arrayContaining([
        "packages/Common",
        "packages/App/FeatureSet/Dashboard",
        ...Array.from(
          new Set(
            PAGES.map((page) => {
              return `packages/App/FeatureSet/${page.frontend}`;
            }),
          ),
        ),
      ]),
    );
  });

  test("runs it unless the run was cancelled, under a limit of its own", () => {
    expect(steps[budget].if).toBe("${{ !cancelled() }}");
    expect(steps[budget]["timeout-minutes"]).toBeGreaterThan(0);
  });
});
