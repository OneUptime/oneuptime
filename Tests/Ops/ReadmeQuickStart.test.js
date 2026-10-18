"use strict";

/**
 * The README's Docker Compose quick start, in English and every translation.
 *
 * It creates config.env from config.example.env and then gives every
 * placeholder secret its own random value, with the same loop the Docker
 * Compose guide's "Generate random secrets" step runs - before `npm start`,
 * so no secret starts out as a value that is public in this repository.
 * These tests hold every README to that block, hold the loop to the guide's,
 * and run the block's config step for real on config.example.env.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const GenerateDatabasePassword = require("../../Scripts/Install/GenerateDatabasePassword");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const TRANSLATIONS_DIR = "Docs/translations";
const GUIDE = "packages/App/FeatureSet/Docs/Content/en/installation/docker-compose.md";
const GUIDE_STEP = "### Generate random secrets";
const PLACEHOLDER = "please-change-this-to-random-value";
const PLACEHOLDER_MARK = "please-change-this";
const COPY_LINE = "cp config.example.env config.env";
const RANDOM_VALUE = /^[0-9a-f]{64}$/;
const PROBE_KEY_VALUE = /^probe-[12]-[0-9a-f]{64}$/;
const PROBE_KEY_PREFIX = /^probe-[12]-/;
const README_TRANSLATION = /^README\.[\w-]+\.md$/;

const EXPECTED_QUICK_START = [
  "# 1. Clone the release branch",
  "git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git",
  "cd oneuptime",
  "",
  "# 2. Create your config, with a random value for every secret",
  COPY_LINE,
  'while grep -q "please-change-this-to-random-value" config.env; do',
  '  sed -i "0,/please-change-this-to-random-value/{s/please-change-this-to-random-value/$(openssl rand -hex 32)/}" config.env',
  "done",
  "",
  "# 3. Start everything",
  "npm start",
];

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function readmes() {
  return [
    "README.md",
    ...fs
      .readdirSync(path.join(REPO_ROOT, TRANSLATIONS_DIR))
      .filter((file) => {
        return README_TRANSLATION.test(file);
      })
      .sort()
      .map((file) => {
        return `${TRANSLATIONS_DIR}/${file}`;
      }),
  ];
}

// The lines of every fenced block of a Markdown file, in order.
function codeBlocks(markdown) {
  const blocks = [];
  let current = null;

  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) {
      if (current === null) {
        current = [];
      } else {
        blocks.push(current);
        current = null;
      }
      continue;
    }

    if (current !== null) {
      current.push(line);
    }
  }

  return blocks;
}

function quickStartOf(relativePath) {
  return codeBlocks(read(relativePath)).filter((block) => {
    return block.includes(COPY_LINE);
  });
}

// The guide's loop: its step's first block, without the line that counts what is left.
function guideLoop() {
  const guide = read(GUIDE);
  const step = guide.slice(guide.indexOf(GUIDE_STEP));
  const block = codeBlocks(step)[0];

  expect(block[block.length - 1]).toBe('grep -c "please-change-this" config.env');
  return block.slice(0, -1);
}

function settingsOf(contents) {
  return GenerateDatabasePassword.readSettings(contents);
}

describe("the README quick start", () => {
  test("there are 17 READMEs: English and 16 translations", () => {
    expect(readmes()).toHaveLength(17);
  });

  test.each(readmes())(
    "%s creates config.env with a random value for every secret, then starts OneUptime",
    (readme) => {
      expect(quickStartOf(readme)).toEqual([EXPECTED_QUICK_START]);
    },
  );

  test("its loop is the Docker Compose guide's Generate random secrets loop", () => {
    const quickStart = EXPECTED_QUICK_START;
    const loop = guideLoop();
    const start = quickStart.indexOf(loop[0]);

    expect(start).toBe(quickStart.indexOf(COPY_LINE) + 1);
    expect(quickStart.slice(start, start + loop.length)).toEqual(loop);
  });
});

describe("running the quick start's config step on config.example.env", () => {
  let template;
  let result;
  let settings;

  beforeAll(() => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-readme-"));

    try {
      fs.copyFileSync(
        path.join(REPO_ROOT, "config.example.env"),
        path.join(directory, "config.example.env"),
      );
      const step = EXPECTED_QUICK_START.slice(
        EXPECTED_QUICK_START.indexOf(COPY_LINE),
        EXPECTED_QUICK_START.indexOf("done") + 1,
      );
      result = spawnSync("bash", ["-e", "-c", step.join("\n")], {
        cwd: directory,
        encoding: "utf8",
      });
      template = read("config.example.env");
      result.config = fs.readFileSync(path.join(directory, "config.env"), "utf8");
      settings = settingsOf(result.config);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("runs", () => {
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  test("leaves no placeholder", () => {
    expect(template).toContain(PLACEHOLDER);
    expect(result.config).not.toContain(PLACEHOLDER_MARK);
  });

  test("gives every placeholder its own random value, and changes no other line", () => {
    const before = template.split("\n");
    const after = result.config.split("\n");
    const values = [];

    expect(after).toHaveLength(before.length);
    for (let index = 0; index < before.length; index++) {
      if (!before[index].includes(PLACEHOLDER)) {
        expect(after[index]).toBe(before[index]);
        continue;
      }

      const key = before[index].slice(0, before[index].indexOf("="));
      const value = after[index].slice(after[index].indexOf("=") + 1);

      expect(after[index].startsWith(`${key}=`)).toBe(true);
      expect(value).toMatch(
        key.startsWith("GLOBAL_PROBE_") ? PROBE_KEY_VALUE : RANDOM_VALUE,
      );
      values.push(value.replace(PROBE_KEY_PREFIX, ""));
    }

    expect(values.length).toBeGreaterThanOrEqual(9);
    expect(new Set(values).size).toBe(values.length);
  });

  test("the database password is its own, so npm start finds nothing to replace", () => {
    expect(settings.get("DATABASE_PASSWORD")).toMatch(RANDOM_VALUE);
    expect(
      GenerateDatabasePassword.decide(
        settings,
        GenerateDatabasePassword.DATABASE_STATE.NOT_CREATED,
      ),
    ).toBe("nothing");
  });
});
