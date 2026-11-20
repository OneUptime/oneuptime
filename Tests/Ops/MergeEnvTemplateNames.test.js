"use strict";

/**
 * Scripts/Install/MergeEnvTemplate.js and a setting's name as config.env may
 * write it.
 *
 * `npm run update` merges config.example.env into config.env: every setting
 * of the template that config.env lacks is appended with the template's
 * value. Compose gets config.env through Scripts/Install/WithConfig.sh, which
 * drops the whitespace around a name and an "export " before it, and where
 * the last line of a name wins. The merge compared names as written, so
 * "HOST = status.example.com", "  HOST=status.example.com" and
 * "export HOST=status.example.com" were no HOST to it: it appended the
 * template's HOST=localhost after them, which then won, and the install came
 * back from its update at localhost. The same for every setting the template
 * has.
 *
 * The merge now reads a name as WithConfig.sh and ReplacePlaceholderSecrets.js's
 * readSettings do, and these tests hold the three together: the merge, the
 * real loader, and the reading every other step of npm start gives config.env.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const {
  mergeEnvTemplate,
  pinEnterpriseImageTag,
} = require("../../Scripts/Install/MergeEnvTemplate");
const {
  readSettings,
} = require("../../Scripts/Install/ReplacePlaceholderSecrets");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT_PATH = path.join(
  REPO_ROOT,
  "Scripts",
  "Install",
  "MergeEnvTemplate.js",
);
const LOADER = path.join(REPO_ROOT, "Scripts", "Install", "WithConfig.sh");
const TEMPLATE = fs.readFileSync(
  path.join(REPO_ROOT, "config.example.env"),
  "utf8",
);

const ADDRESS = "status.example.com";

// The ways config.env may write HOST that Compose reads as HOST.
const HOST_LINES = [
  `HOST=${ADDRESS}`,
  `HOST = ${ADDRESS}`,
  `HOST =${ADDRESS}`,
  `  HOST=${ADDRESS}`,
  `\tHOST\t=\t${ADDRESS}`,
  `HOST="${ADDRESS}"`,
  `export HOST=${ADDRESS}`,
  `export\tHOST=${ADDRESS}`,
  `  export   HOST = ${ADDRESS}`,
  `HOST=${ADDRESS}\r`,
];

// What the loader hands Compose for `name`, from config.env's `contents`.
function composeGets(contents, name) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "merge-names-"));

  try {
    fs.writeFileSync(path.join(directory, "config.env"), contents);

    const result = spawnSync(
      "sh",
      [LOADER, "sh", "-c", `printf '%s' "\${${name}-unset}"`],
      {
        cwd: directory,
        env: { PATH: process.env.PATH },
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(0);

    return result.stdout;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

// Runs the real script on `config` as config.env, beside config.example.env, as npm run update does.
function runMerge(config) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "merge-names-run-"));

  try {
    fs.mkdirSync(path.join(directory, "Scripts", "Install"), {
      recursive: true,
    });
    fs.copyFileSync(
      SCRIPT_PATH,
      path.join(directory, "Scripts", "Install", "MergeEnvTemplate.js"),
    );
    fs.writeFileSync(path.join(directory, "config.example.env"), TEMPLATE);
    fs.writeFileSync(path.join(directory, "config.env"), config);
    execFileSync(process.execPath, ["./Scripts/Install/MergeEnvTemplate.js"], {
      cwd: directory,
      stdio: "pipe",
    });

    return fs.readFileSync(path.join(directory, "config.env"), "utf8");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

describe("npm run update keeps a setting however config.env writes its name", () => {
  test.each(HOST_LINES)("%j: no HOST is appended after it", (line) => {
    const merged = mergeEnvTemplate(
      "HOST=localhost\nHTTP_PROTOCOL=http\n",
      `${line}\n`,
    ).contents;

    expect(merged).not.toContain("HOST=localhost");
    // The other settings it lacks still come from the template.
    expect(merged).toContain("HTTP_PROTOCOL=http");
  });

  test.each(HOST_LINES)(
    "%j: Compose still gets the install's own HOST after the merge, as before it",
    (line) => {
      const config = `${line}\n`;
      const merged = mergeEnvTemplate("HOST=localhost\n", config).contents;

      expect(composeGets(config, "HOST")).toBe(ADDRESS);
      expect(composeGets(merged, "HOST")).toBe(ADDRESS);
      // And every other step of npm start reads the same.
      expect(readSettings(merged).get("HOST")).toBe(ADDRESS);
    },
  );

  test("with the real template and the script itself, as npm run update runs it", () => {
    const config = [
      `export HOST=${ADDRESS}`,
      "HTTP_PROTOCOL = https",
      "  ONEUPTIME_HTTP_PORT=127.0.0.1:8080",
      "",
    ].join("\n");
    const merged = runMerge(config);

    expect(composeGets(merged, "HOST")).toBe(ADDRESS);
    expect(composeGets(merged, "HTTP_PROTOCOL")).toBe("https");
    expect(composeGets(merged, "ONEUPTIME_HTTP_PORT")).toBe("127.0.0.1:8080");
    // One line for each: none of the template's was added after them.
    for (const name of ["HOST", "HTTP_PROTOCOL", "ONEUPTIME_HTTP_PORT"]) {
      expect(
        merged.split("\n").filter((line) => {
          return readSettings(line).has(name);
        }),
      ).toHaveLength(1);
    }
    // And what the template has that config.env lacks is there.
    expect(readSettings(merged).get("NGINX_HTTP2")).toBe("on");
  });

  test.each([
    ["a commented-out line", `# HOST=${ADDRESS}`],
    ["a commented-out export", `# export HOST=${ADDRESS}`],
    ["a name that only starts with export", `exportHOST=${ADDRESS}`],
    ["another setting's name with HOST in it", `HOSTNAME=${ADDRESS}`],
  ])("%s is no HOST: the template's is appended", (_label, line) => {
    const merged = mergeEnvTemplate("HOST=localhost\n", `${line}\n`).contents;

    expect(merged).toContain("HOST=localhost");
    expect(composeGets(merged, "HOST")).toBe("localhost");
  });

  test("a renamed setting written with export is kept, and its new name not appended", () => {
    const merged = mergeEnvTemplate(
      "VALKEY_PASSWORD=please-change-this-to-random-value\n",
      "export REDIS_PASSWORD=a-real-secret\n",
    );

    expect(merged.contents).not.toContain("VALKEY_PASSWORD");
    expect(merged.carriedOver).toEqual([
      "REDIS_PASSWORD (kept in place of VALKEY_PASSWORD)",
    ]);
  });

  test("an Enterprise install's APP_TAG written with export still moves to the Enterprise image, export kept", () => {
    const pinned = pinEnterpriseImageTag([
      "export IS_ENTERPRISE_EDITION=true",
      "export APP_TAG=release",
    ]);

    expect(pinned.lines).toEqual([
      "export IS_ENTERPRISE_EDITION=true",
      "export APP_TAG=enterprise-release",
    ]);
    expect(composeGets(`${pinned.lines.join("\n")}\n`, "APP_TAG")).toBe(
      "enterprise-release",
    );
  });

  /*
   * The merge reads names as readSettings does: for every line the loader
   * reads, a template setting of that name is appended exactly when
   * readSettings sees no such setting in config.env. (A line with no "=",
   * which neither reads, counts as its name for the merge, as it always
   * has: Compose's own default applies to it.)
   */
  test.each([
    ["PLAIN=value", "PLAIN"],
    ["  PADDED  =  padded", "PADDED"],
    ["export EXPORTED=yes", "EXPORTED"],
    ["export\tTABBED=yes", "TABBED"],
    ["# COMMENTED=yes", "COMMENTED"],
    ["// SLASHED=yes", "SLASHED"],
    ["exportGLUED=yes", "GLUED"],
    ["export GLUED=yes", "exportGLUED"],
  ])("the merge and readSettings agree on %j for %s", (line, name) => {
    const merged = mergeEnvTemplate(
      `${name}=from-template\n`,
      `${line}\n`,
    ).contents;
    const appended = merged.includes(`${name}=from-template`);

    expect({ line, appended }).toEqual({
      line,
      appended: !readSettings(line).has(name),
    });
  });
});
