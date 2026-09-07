import { afterAll, describe, expect, test } from "@jest/globals";
import childProcess from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..");
const COMMON_MODULES: string = path.join(
  REPOSITORY_ROOT,
  "Common",
  "node_modules",
);
const ESBUILD_CONFIG: string = path.join(
  REPOSITORY_ROOT,
  "Common",
  "UI",
  "esbuild-config.js",
);
const APP_LINK: string = path.join(
  REPOSITORY_ROOT,
  "App/FeatureSet/Dashboard/src/Components/AppLink/AppLink.tsx",
);
const temporaryRoots: Array<string> = [];

interface RenderResult {
  html: string;
  error: string;
}

/*
 * PublicDashboard mounts its own router but reuses Dashboard widgets and their
 * AppLink. Separate package installations otherwise create two router contexts.
 * A mocked AppLink or Jest's react-router-dom module mapper hides that failure,
 * so bundle the actual link source against two physical router installations.
 */
function renderSharedLink(nodeEnv: string): RenderResult {
  const root: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "oneuptime-router-"),
  );
  temporaryRoots.push(root);
  fs.symlinkSync(COMMON_MODULES, path.join(root, "node_modules"), "dir");

  for (const packageName of ["public", "shared"]) {
    const moduleDirectory: string = path.join(
      root,
      packageName,
      "node_modules",
    );
    fs.mkdirSync(moduleDirectory, { recursive: true });
    for (const dependency of ["react-router", "react-router-dom"]) {
      fs.cpSync(
        path.join(COMMON_MODULES, dependency),
        path.join(moduleDirectory, dependency),
        { recursive: true, dereference: true },
      );
    }
  }

  fs.copyFileSync(APP_LINK, path.join(root, "shared", "AppLink.tsx"));
  const entry: string = path.join(root, "public", "Entry.tsx");
  fs.writeFileSync(
    entry,
    `
      import React from "react";
      import { MemoryRouter } from "react-router-dom";
      import { renderToStaticMarkup } from "react-dom/server";
      import AppLink from "../shared/AppLink";

      globalThis.routerFixtureMarkup = renderToStaticMarkup(
        <MemoryRouter initialEntries={["/public-dashboard"]}>
          <AppLink to={{ toString: () => "/dashboard/monitors/example" }}>
            Unit 0660 monitor
          </AppLink>
        </MemoryRouter>,
      );
    `,
  );

  const script: string = `
    const path = require("path");
    const configModule = require(${JSON.stringify(ESBUILD_CONFIG)});
    const esbuild = require(require.resolve("esbuild", {
      paths: [${JSON.stringify(COMMON_MODULES)}],
    }));
    const config = configModule.createConfig({
      serviceName: "PublicDashboard",
      publicPath: "/public-dashboard/dist/",
      entryPoint: ${JSON.stringify(entry)},
    });
    config.write = false;
    config.splitting = false;
    config.format = "cjs";
    config.sourcemap = false;
    config.logLevel = "silent";

    esbuild.build(config).then((result) => {
      const output = result.outputFiles[0].text;
      new Function("require", "module", "exports", output)(require, { exports: {} }, {});
      console.log(JSON.stringify({ html: globalThis.routerFixtureMarkup, error: "" }));
    }).catch((error) => {
      console.log(JSON.stringify({ html: "", error: String(error) }));
    });
  `;

  return JSON.parse(
    childProcess.execFileSync(process.execPath, ["-e", script], {
      cwd: REPOSITORY_ROOT,
      env: { ...process.env, NODE_ENV: nodeEnv },
      encoding: "utf8",
      timeout: 120000,
      maxBuffer: 1024 * 1024,
    }),
  ) as RenderResult;
}

afterAll(() => {
  for (const root of temporaryRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("shared public dashboard router context", () => {
  test.each(["production", "development"])(
    "renders the real shared AppLink inside the public router in %s",
    (nodeEnv: string) => {
      const result: RenderResult = renderSharedLink(nodeEnv);
      expect(result.error).toBe("");
      expect(result.html).toContain('href="/dashboard/monitors/example"');
      expect(result.html).toContain("Unit 0660 monitor");
    },
    180000,
  );
});
