"use strict";

/**
 * Every assertion in the Helm charts' helm-unittest suites can fail (#11403).
 *
 * helm-unittest drops what it does not read, silently. 0.5.1, which the
 * harness pinned until #11403, had no failedTemplate errorPattern, and read
 * one as no assertion: 72 tests passed whatever their messages said. 1.2.1,
 * pinned now, decodes each assertion's body with mapstructure, which ignores
 * a key its validator has no field for, so `errorPatern:` or `vaule:` leaves
 * an assertion that checks less than it says, or nothing: a notEqual to a
 * misspelt value compares with null, and passes. It reads `not`,
 * `documentIndex` and `template` only when they are a boolean, an integer and
 * a string, so `not: "true"` is no negation. `--strict`, which the harness
 * passes (harness_helm_unittest), holds a suite's and a test's own keys, but
 * not an assertion's, nor the keys of a test's `capabilities`, a map.
 *
 * So this holds every suite file under HelmChart/ to what 1.2.1 reads:
 *
 *   - each assertion has one type that version knows, the keys its validator
 *     reads and no others, and the keys it needs to check anything;
 *   - each test has asserts, and a suite and a test only the keys they have;
 *   - a matchRegex pattern does not match any text at all;
 *   - a refusal (failedTemplate) is held to its whole message, errorMessage.
 *     Not errorPattern: on 1.2.1 it is an unanchored regex, retried as a
 *     literal substring when it fails, so "name" passed for any refusal that
 *     held the word. Not a bare failedTemplate: {}, which passes for any
 *     failure at all, a typo in a template included. And not negated: a
 *     negated errorMessage passes for every other message.
 *     notFailedTemplate takes no message, for the same reason;
 *   - and each is written the way the assertions-can-fail suite
 *     (HelmChart/Tests/suites/assertions-can-fail.sh) can plant a mistake in:
 *     each test begins with `- it:`, each errorMessage key starts a line of
 *     its own, and a refusal is shared between tests only as a whole asserts
 *     list (`asserts: &name`, then `asserts: *name`). That suite then requires
 *     every test that holds a refusal to fail once its message is wrong.
 *
 * The tables are read from helm-unittest's source at one version. When the
 * harness pins another, the first test fails until they are read again.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const HELM_DIR = path.join(REPO_ROOT, "HelmChart");
const HARNESS = path.join(HELM_DIR, "Tests", "lib", "harness.sh");

// The helm-unittest version the tables below were read from.
const TABLES_VERSION = "v1.2.1";

/*
 * Each assertion type of pkg/unittest/assertion.go's assertTypeMapping at
 * v1.2.1, with the keys its validator (pkg/unittest/validators) has a field
 * for. mapstructure matches them without regard to case; the suites write
 * them as the documentation does.
 */
const PATH_VALUE = ["path", "value"];
const ASSERTION_KEYS = {
  matchSnapshot: ["path", "matchRegex", "notMatchRegex"],
  matchSnapshotRaw: [],
  equal: ["path", "value", "decodeBase64"],
  notEqual: ["path", "value", "decodeBase64"],
  greaterOrEqual: PATH_VALUE,
  notGreaterOrEqual: PATH_VALUE,
  lessOrEqual: PATH_VALUE,
  notLessOrEqual: PATH_VALUE,
  equalRaw: ["value"],
  notEqualRaw: ["value"],
  exists: ["path"],
  notExists: ["path"],
  matchRegex: ["path", "pattern", "decodeBase64"],
  notMatchRegex: ["path", "pattern", "decodeBase64"],
  matchRegexRaw: ["pattern"],
  notMatchRegexRaw: ["pattern"],
  contains: ["path", "content", "count", "any"],
  notContains: ["path", "content", "count", "any"],
  isKind: ["of"],
  isAPIVersion: ["of"],
  hasDocuments: ["count", "filterAware"],
  isSubset: ["path", "content"],
  isNotSubset: ["path", "content"],
  isNullOrEmpty: ["path"],
  isNotNullOrEmpty: ["path"],
  failedTemplate: ["errorMessage", "errorPattern"],
  notFailedTemplate: ["errorMessage", "errorPattern"],
  containsDocument: ["kind", "apiVersion", "name", "namespace", "any"],
  lengthEqual: ["paths", "path", "count"],
  notLengthEqual: ["paths", "path", "count"],
  isNull: ["path"],
  isNotNull: ["path"],
  isEmpty: ["path"],
  isNotEmpty: ["path"],
  isType: ["path", "type"],
  isNotType: ["path", "type"],
};

/*
 * The keys an assertion needs to check anything. Without one the validator
 * compares with Go's zero value: equal with no value reads "is null",
 * hasDocuments with no count "renders nothing", matchRegex with no pattern
 * matches everything.
 */
const REQUIRED_KEYS = {
  equal: PATH_VALUE,
  notEqual: PATH_VALUE,
  greaterOrEqual: PATH_VALUE,
  notGreaterOrEqual: PATH_VALUE,
  lessOrEqual: PATH_VALUE,
  notLessOrEqual: PATH_VALUE,
  equalRaw: ["value"],
  notEqualRaw: ["value"],
  exists: ["path"],
  notExists: ["path"],
  matchRegex: ["path", "pattern"],
  notMatchRegex: ["path", "pattern"],
  matchRegexRaw: ["pattern"],
  notMatchRegexRaw: ["pattern"],
  contains: ["path", "content"],
  notContains: ["path", "content"],
  isKind: ["of"],
  isAPIVersion: ["of"],
  hasDocuments: ["count"],
  isSubset: ["path", "content"],
  isNotSubset: ["path", "content"],
  isNullOrEmpty: ["path"],
  isNotNullOrEmpty: ["path"],
  failedTemplate: ["errorMessage"],
  containsDocument: ["kind", "apiVersion"],
  lengthEqual: ["count"],
  notLengthEqual: ["count"],
  isNull: ["path"],
  isNotNull: ["path"],
  isEmpty: ["path"],
  isNotEmpty: ["path"],
  isType: ["path", "type"],
  isNotType: ["path", "type"],
};

// The keys beside an assertion's type (Assertion.parseBasicFields and
// parseDocumentSelector), and the kind of value each is read as.
const ASSERTION_FIELDS = {
  template: "string",
  documentIndex: "integer",
  documentSelector: "mapping",
  not: "boolean",
};

// valueutils.NewDocumentSelector: path is required, and matchMany and
// skipEmptyTemplates count only as `true` itself.
const DOCUMENT_SELECTOR_FIELDS = {
  path: "string",
  value: "any",
  matchMany: "boolean",
  skipEmptyTemplates: "boolean",
};

// TestJob's and TestSuite's yaml keys (yaml.v3 lowercases an untagged field).
const TEST_KEYS = [
  "it",
  "values",
  "set",
  "template",
  "templates",
  "documentIndex",
  "documentindices",
  "documentSelector",
  "release",
  "chart",
  "capabilities",
  "asserts",
  "skip",
  "kubernetesProvider",
  "postRenderer",
];
const SUITE_KEYS = [
  "suite",
  "values",
  "set",
  "templates",
  "excludeTemplates",
  "includeCrds",
  "release",
  "chart",
  "capabilities",
  "kubernetesProvider",
  "postRenderer",
  "tests",
  "snapshotId",
  "skip",
];
const RELEASE_KEYS = ["name", "namespace", "revision", "upgrade"];
const CHART_KEYS = ["version", "appVersion"];
// TestJob.SetCapabilities reads these three of its map, and no others.
const CAPABILITIES_KEYS = ["majorVersion", "minorVersion", "apiVersions"];

function kindOf(value) {
  if (value === null || value === undefined) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "list";
  }
  if (Number.isInteger(value)) {
    return "integer";
  }
  if (typeof value === "object") {
    return "mapping";
  }
  return typeof value;
}

function keysOf(value) {
  return kindOf(value) === "mapping" ? Object.keys(value) : [];
}

function unknownKeys(value, allowed) {
  return keysOf(value).filter((key) => {
    return !allowed.includes(key);
  });
}

/*
 * A Go (RE2) pattern as a JavaScript RegExp, where the two read it alike, or
 * null. A leading (?flags) group becomes the RegExp's flags.
 */
function goPatternAsJs(pattern) {
  let source = pattern;
  let flags = "";
  const inline = /^\(\?([ims]+)\)/.exec(source);
  if (inline) {
    flags = inline[1];
    source = source.slice(inline[0].length);
  }
  if (/\(\?[a-zA-Z]|\\[AzpPQE]|\[\[:/.test(source)) {
    return null;
  }
  try {
    return new RegExp(source, flags);
  } catch {
    return null;
  }
}

// Texts no two of which a pattern that checks something matches all of.
const VACUITY_PROBES = ["", "x", "\n", "a b", "zq-no-such-text-zq", "ZZ 99"];

function matchesAnything(pattern) {
  const regex = goPatternAsJs(pattern);
  if (regex === null) {
    return false;
  }
  return VACUITY_PROBES.every((text) => {
    return regex.test(text);
  });
}

/*
 * The problems of one suite file's text, each a line naming where it is.
 * `label` names the file in them.
 */
function problemsOf(text, label) {
  const problems = [];
  const report = (where, message) => {
    problems.push(`${label}${where ? ` ${where}` : ""}: ${message}`);
  };

  let documents;
  try {
    documents = yaml.loadAll(text);
  } catch (error) {
    report("", `is not YAML helm-unittest can read: ${error.message}`);
    return problems;
  }
  documents = documents.filter((document) => {
    return document !== null && document !== undefined;
  });
  if (documents.length === 0) {
    report("", "holds no suite");
    return problems;
  }

  // Each failedTemplate assertion (an object), with the asserts lists (also
  // objects) it is found in: a whole list may be an alias, a refusal of its
  // own may not.
  const refusalLists = new Map();
  let testCount = 0;

  for (const suite of documents) {
    if (kindOf(suite) !== "mapping") {
      report("", "holds a suite that is not a mapping");
      continue;
    }
    for (const key of unknownKeys(suite, SUITE_KEYS)) {
      report(
        "",
        `the suite's key \`${key}\` is no key of a suite (helm-unittest ${TABLES_VERSION})`,
      );
    }
    for (const key of unknownKeys(suite.release, RELEASE_KEYS)) {
      report("", `release.${key} is no key of a release`);
    }
    for (const key of unknownKeys(suite.chart, CHART_KEYS)) {
      report("", `chart.${key} is no key of a chart`);
    }
    for (const key of unknownKeys(suite.capabilities, CAPABILITIES_KEYS)) {
      report(
        "",
        `capabilities.${key} is not read: helm-unittest reads ${CAPABILITIES_KEYS.join(", ")}`,
      );
    }
    if (kindOf(suite.tests) !== "list" || suite.tests.length === 0) {
      report("", "has no tests: a suite of none passes, checking nothing");
      continue;
    }

    suite.tests.forEach((test, testIndex) => {
      testCount++;
      const name =
        kindOf(test) === "mapping" && typeof test.it === "string"
          ? test.it
          : `#${testIndex + 1}`;
      const where = `test "${name}"`;
      if (kindOf(test) !== "mapping") {
        report(where, "is not a mapping");
        return;
      }
      if (typeof test.it !== "string" || test.it.trim() === "") {
        report(where, "has no name (`it`)");
      }
      for (const key of unknownKeys(test, TEST_KEYS)) {
        report(
          where,
          `\`${key}\` is no key of a test: --strict refuses it, and without --strict the test runs as if it were not there`,
        );
      }
      for (const key of unknownKeys(test.release, RELEASE_KEYS)) {
        report(where, `release.${key} is no key of a release`);
      }
      for (const key of unknownKeys(test.chart, CHART_KEYS)) {
        report(where, `chart.${key} is no key of a chart`);
      }
      for (const key of unknownKeys(test.capabilities, CAPABILITIES_KEYS)) {
        report(
          where,
          `capabilities.${key} is not read: helm-unittest reads ${CAPABILITIES_KEYS.join(", ")}, and --strict does not look inside capabilities`,
        );
      }
      if ("set" in test && kindOf(test.set) !== "mapping") {
        report(where, "`set` is not a mapping");
      }
      if (kindOf(test.asserts) !== "list" || test.asserts.length === 0) {
        report(where, "has no asserts: it passes, checking nothing");
        return;
      }

      test.asserts.forEach((assertion, assertIndex) => {
        const at = `${where} asserts[${assertIndex}]`;
        if (kindOf(assertion) !== "mapping") {
          report(at, "is not a mapping");
          return;
        }
        const types = Object.keys(assertion).filter((key) => {
          return key in ASSERTION_KEYS;
        });
        const others = Object.keys(assertion).filter((key) => {
          return !(key in ASSERTION_KEYS) && !(key in ASSERTION_FIELDS);
        });
        for (const key of others) {
          report(
            at,
            `\`${key}\` is neither an assertion type nor a key of one (helm-unittest ${TABLES_VERSION} reads ${Object.keys(ASSERTION_FIELDS).join(", ")} beside the type)`,
          );
        }
        if (types.length !== 1) {
          report(
            at,
            types.length === 0
              ? "has no assertion type helm-unittest knows"
              : `has ${types.length} assertion types (${types.join(", ")})`,
          );
          return;
        }
        for (const [field, kind] of Object.entries(ASSERTION_FIELDS)) {
          if (field in assertion && kindOf(assertion[field]) !== kind) {
            report(
              at,
              `\`${field}\` is ${kindOf(assertion[field])}, and helm-unittest reads it only as ${kind === "integer" ? "an" : "a"} ${kind}: as it is, it is ignored`,
            );
          }
        }
        if (kindOf(assertion.documentSelector) === "mapping") {
          const selector = assertion.documentSelector;
          for (const key of unknownKeys(
            selector,
            Object.keys(DOCUMENT_SELECTOR_FIELDS),
          )) {
            report(
              at,
              `documentSelector.${key} is no key of a document selector`,
            );
          }
          for (const [field, kind] of Object.entries(
            DOCUMENT_SELECTOR_FIELDS,
          )) {
            if (
              kind !== "any" &&
              field in selector &&
              kindOf(selector[field]) !== kind
            ) {
              report(
                at,
                `documentSelector.${field} is ${kindOf(selector[field])}, and is read only as a ${kind}`,
              );
            }
          }
          if (!("path" in selector)) {
            report(at, "documentSelector has no path");
          }
        }

        const type = types[0];
        const body = assertion[type];
        if (body !== null && kindOf(body) !== "mapping") {
          report(
            at,
            `${type}'s body is ${kindOf(body)}, not a mapping of its keys`,
          );
          return;
        }
        for (const key of unknownKeys(body, ASSERTION_KEYS[type])) {
          report(
            at,
            `${type} has no key \`${key}\`: helm-unittest ${TABLES_VERSION} reads ${ASSERTION_KEYS[type].length ? ASSERTION_KEYS[type].join(", ") : "none"}, and drops the rest without a word`,
          );
        }
        for (const key of REQUIRED_KEYS[type] || []) {
          if (!keysOf(body).includes(key)) {
            report(
              at,
              `${type} has no \`${key}\`, so it compares with nothing`,
            );
          }
        }

        if (type === "matchRegex" || type === "matchRegexRaw") {
          const pattern = keysOf(body).includes("pattern")
            ? body.pattern
            : undefined;
          if (typeof pattern === "string" && matchesAnything(pattern)) {
            report(
              at,
              `${type}'s pattern ${JSON.stringify(pattern)} matches any text, so it cannot fail`,
            );
          }
        }

        if (type === "failedTemplate") {
          if (!refusalLists.has(assertion)) {
            refusalLists.set(assertion, new Set());
          }
          refusalLists.get(assertion).add(test.asserts);
          const message = keysOf(body).includes("errorMessage")
            ? body.errorMessage
            : undefined;
          if (keysOf(body).includes("errorPattern")) {
            report(
              at,
              "failedTemplate uses errorPattern: hold the refusal to its whole message with errorMessage. An errorPattern passes for any message that holds it, and helm-unittest retries one that fails as a plain substring",
            );
          } else if (message === undefined) {
            report(
              at,
              "failedTemplate names no errorMessage, so it passes for any failure at all: hold the refusal to its whole message",
            );
          } else if (typeof message !== "string" || message.length === 0) {
            report(at, "failedTemplate's errorMessage is not a message");
          }
          if (assertion.not === true) {
            report(
              at,
              "a negated failedTemplate passes for every message but one: use notFailedTemplate, or hold the message the render must fail with",
            );
          }
        }
        if (type === "notFailedTemplate" && keysOf(body).length > 0) {
          report(
            at,
            "notFailedTemplate takes no message: with one it passes when the render fails with any other",
          );
        }
      });
    });
  }

  // The layout the assertions-can-fail suite plants its mistakes in.
  const lines = text.split("\n");
  const itLines = lines.filter((line) => {
    return /^\s*-\s+it:/.test(line);
  }).length;
  if (itLines !== testCount) {
    report(
      "",
      `holds ${testCount} tests but ${itLines} lines that begin one with \`- it:\`: begin every test with its name, so assertions-can-fail can tell which test holds a refusal`,
    );
  }
  const messageLines = lines.filter((line) => {
    return /^\s*errorMessage:/.test(line);
  }).length;
  let refusalsWithMessage = 0;
  for (const [assertion, lists] of refusalLists) {
    if (keysOf(assertion.failedTemplate).includes("errorMessage")) {
      refusalsWithMessage++;
    }
    if (lists.size > 1) {
      report(
        "",
        "shares one failedTemplate between tests as an alias of the assertion: share the whole asserts list (asserts: &name, then asserts: *name), or write it out in each test",
      );
    }
  }
  if (messageLines !== refusalsWithMessage) {
    report(
      "",
      `holds ${refusalsWithMessage} refusals but ${messageLines} lines that begin with \`errorMessage:\`: write each failedTemplate as a block, with errorMessage starting a line of its own, and share one only as a whole asserts list`,
    );
  }

  return problems;
}

// Every helm-unittest suite file under HelmChart/: *_test.yaml in a tests/
// directory, as helm-unittest finds them.
function suiteFiles() {
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== "charts") {
          walk(full);
        }
      } else if (
        entry.name.endsWith("_test.yaml") &&
        path.basename(path.dirname(full)) === "tests"
      ) {
        found.push(full);
      }
    }
  };
  walk(HELM_DIR);
  return found.sort();
}

function relative(file) {
  return path.relative(REPO_ROOT, file);
}

describe("the helm-unittest version the harness pins", () => {
  const harness = fs.readFileSync(HARNESS, "utf8");
  const version =
    /^HELM_UNITTEST_VERSION="\$\{HELM_UNITTEST_VERSION:-(v[0-9.]+)\}"$/m.exec(
      harness,
    );

  test("is the one this guard's tables were read from", () => {
    expect(version).not.toBeNull();
    if (version[1] !== TABLES_VERSION) {
      throw new Error(
        `HelmChart/Tests/lib/harness.sh pins helm-unittest ${version[1]}, and this guard lists the keys each assertion of ${TABLES_VERSION} reads. Read the new version's pkg/unittest/assertion.go (assertTypeMapping, parseBasicFields), pkg/unittest/validators/*.go and pkg/unittest/valueutils/documentselector.go, update ASSERTION_KEYS and the rest, then TABLES_VERSION. Run HelmChart/Tests/suites/assertions-can-fail.sh on it too: it checks that the new version fails a wrong errorMessage and a wrong errorPattern.`,
      );
    }
  });

  test("has its tarball pinned for each platform the harness installs from a tarball", () => {
    const pins = {};
    const pinLine =
      /^\s*(v[0-9.]+)\/([a-z]+-[a-z0-9]+)\) echo "([0-9a-f]{64})" ;;$/gm;
    let match;
    while ((match = pinLine.exec(harness)) !== null) {
      pins[`${match[1]}/${match[2]}`] = match[3];
    }
    for (const platform of [
      "linux-amd64",
      "linux-arm64",
      "macos-amd64",
      "macos-arm64",
    ]) {
      expect(pins[`${version[1]}/${platform}`]).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  test("runs the suites from the harness's own plugin directory, with --strict", () => {
    expect(harness).toMatch(
      /harness_helm_unittest\(\) \{\n\s+HELM_PLUGINS="\$HELM_UNITTEST_PLUGINS_DIR" helm unittest --strict "\$@"\n\}/,
    );
    const unit = fs.readFileSync(
      path.join(HELM_DIR, "Tests", "suites", "unit.sh"),
      "utf8",
    );
    expect(unit).toContain('harness_helm_unittest "$chart"');
    expect(unit).not.toMatch(/^\s*(if\s+)?helm unittest/m);
  });

  test("is what `npm run test-helm-chart` runs, through the unit suite", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
    );
    expect(pkg.scripts["test-helm-chart"]).toBe(
      "bash ./HelmChart/Tests/run.sh unit",
    );
  });

  test("is checked by the assertions-can-fail suite, which the helm-test job runs", () => {
    const run = fs.readFileSync(path.join(HELM_DIR, "Tests", "run.sh"), "utf8");
    const allSuites = /^ALL_SUITES=\(([^)]*)\)$/m.exec(run);
    expect(allSuites).not.toBeNull();
    expect(allSuites[1].split(/\s+/)).toContain("assertions-can-fail");
  });
});

describe("every assertion in the charts' helm-unittest suites can fail", () => {
  const files = suiteFiles();

  test("the suites are found: both charts', every file", () => {
    const charts = new Set(
      files.map((file) => {
        return relative(path.dirname(path.dirname(file)));
      }),
    );
    expect(charts).toEqual(
      new Set([
        "HelmChart/Public/kubernetes-agent",
        "HelmChart/Public/oneuptime",
      ]),
    );
    expect(files.length).toBeGreaterThan(120);
  });

  test("each is held to what helm-unittest reads", () => {
    const problems = files.flatMap((file) => {
      return problemsOf(fs.readFileSync(file, "utf8"), relative(file));
    });
    expect(problems).toEqual([]);
  });

  test("every refusal is checked: hundreds of them, each by its whole message", () => {
    let refusals = 0;
    let assertions = 0;
    for (const file of files) {
      for (const suite of yaml.loadAll(fs.readFileSync(file, "utf8"))) {
        for (const test of suite.tests) {
          for (const assertion of test.asserts) {
            assertions++;
            if ("failedTemplate" in assertion) {
              refusals++;
              expect(typeof assertion.failedTemplate.errorMessage).toBe(
                "string",
              );
            }
          }
        }
      }
    }
    // 257 and 3942 when this was written: a walk that found far fewer has
    // stopped reading most of them.
    expect(refusals).toBeGreaterThan(250);
    expect(assertions).toBeGreaterThan(3500);
  });
});

/*
 * Planted mistakes, each of which the guard must report. A suite that holds
 * none of them reports nothing.
 */
describe("the guard reports each kind of assertion that cannot fail", () => {
  const SUITE = (tests) => {
    return `suite: planted
templates:
  - templates/app.yaml
tests:
${tests}`;
  };

  const problemsFor = (tests) => {
    return problemsOf(SUITE(tests), "planted_test.yaml");
  };

  test("a suite written as the guard asks reports nothing", () => {
    expect(
      problemsFor(`  - it: renders the app
    set:
      app.enabled: true
    capabilities:
      majorVersion: 1
      apiVersions:
        - batch/v1
    documentSelector:
      path: kind
      value: Deployment
    asserts:
      - isKind:
          of: Deployment
      - equal:
          path: metadata.name
          value: app
      - notEqual:
          path: spec.replicas
          value: 0
      - matchRegex:
          path: metadata.name
          pattern: ^app$
      - contains:
          path: spec.template.spec.containers
          content:
            name: app
        documentIndex: 0
      - not: true
        exists:
          path: spec.paused
  - it: refuses a bad value
    set:
      app.mode: nonsense
    asserts: &refusesMode
      - failedTemplate:
          errorMessage: app.mode is nonsense, which is no mode.
  - it: refuses it in the worker too
    set:
      app.mode: nonsense
    asserts: *refusesMode
  - it: refuses a schema refusal by its whole message
    set:
      app.replicas: many
    asserts:
      - template: templates/app.yaml
        failedTemplate:
          errorMessage: |
            values don't meet the specifications of the schema(s) in the following chart(s):
            planted:
            - at '/app/replicas': got string, want integer
  - it: renders without failing
    asserts:
      - notFailedTemplate: {}
`),
    ).toEqual([]);
  });

  const cases = [
    [
      "a failedTemplate written with errorPattern (#11403)",
      `  - it: refuses
    asserts:
      - failedTemplate:
          errorPattern: "no message says this"
`,
      /failedTemplate uses errorPattern/,
    ],
    [
      "a bare failedTemplate, which passes for any failure",
      `  - it: refuses
    asserts:
      - failedTemplate: {}
`,
      /names no errorMessage, so it passes for any failure/,
    ],
    [
      "a failedTemplate with no body at all",
      `  - it: refuses
    asserts:
      - failedTemplate:
`,
      /names no errorMessage/,
    ],
    [
      "a misspelt errorMessage",
      `  - it: refuses
    asserts:
      - failedTemplate:
          errorMesage: app.mode is nonsense.
`,
      /failedTemplate has no key `errorMesage`/,
    ],
    [
      "an empty errorMessage",
      `  - it: refuses
    asserts:
      - failedTemplate:
          errorMessage: ""
`,
      /errorMessage is not a message/,
    ],
    [
      "a negated failedTemplate",
      `  - it: refuses
    asserts:
      - not: true
        failedTemplate:
          errorMessage: app.mode is nonsense.
`,
      /a negated failedTemplate passes for every message but one/,
    ],
    [
      "a notFailedTemplate given a message",
      `  - it: renders
    asserts:
      - notFailedTemplate:
          errorMessage: app.mode is nonsense.
`,
      /notFailedTemplate takes no message/,
    ],
    [
      "a misspelt key in an assertion (notEqual compares with null, and passes)",
      `  - it: renders
    asserts:
      - notEqual:
          path: kind
          vaule: Deployment
`,
      /notEqual has no key `vaule`.*drops the rest without a word/,
    ],
    [
      "an assertion that misses the key it compares with",
      `  - it: renders
    asserts:
      - equal:
          path: kind
`,
      /equal has no `value`, so it compares with nothing/,
    ],
    [
      "hasDocuments with no count, which reads as none",
      `  - it: renders
    asserts:
      - hasDocuments: {}
`,
      /hasDocuments has no `count`/,
    ],
    [
      "a negation written as a string, which helm-unittest ignores",
      `  - it: renders
    asserts:
      - not: "true"
        exists:
          path: spec.paused
`,
      /`not` is string, and helm-unittest reads it only as a boolean: as it is, it is ignored/,
    ],
    [
      "a document index written as a string",
      `  - it: renders
    asserts:
      - documentIndex: "1"
        isKind:
          of: Service
`,
      /`documentIndex` is string, and helm-unittest reads it only as an integer/,
    ],
    [
      "a misspelt key beside the assertion type",
      `  - it: renders
    asserts:
      - documentIndx: 1
        isKind:
          of: Service
`,
      /`documentIndx` is neither an assertion type nor a key of one/,
    ],
    [
      "an assertion type helm-unittest does not know",
      `  - it: renders
    asserts:
      - isKnd:
          of: Service
`,
      /has no assertion type helm-unittest knows/,
    ],
    [
      "two assertion types in one assertion",
      `  - it: renders
    asserts:
      - isKind:
          of: Service
        exists:
          path: spec
`,
      /has 2 assertion types/,
    ],
    [
      "a matchRegex pattern that matches any text",
      `  - it: renders
    asserts:
      - matchRegex:
          path: metadata.name
          pattern: ".*"
`,
      /pattern ".\*" matches any text, so it cannot fail/,
    ],
    [
      "a matchRegex with an empty pattern",
      `  - it: renders
    asserts:
      - matchRegex:
          path: metadata.name
          pattern: ""
`,
      /matches any text/,
    ],
    [
      "a test with no asserts",
      `  - it: renders
    set:
      app.enabled: true
`,
      /has no asserts: it passes, checking nothing/,
    ],
    [
      "a test with an empty asserts list",
      `  - it: renders
    asserts: []
`,
      /has no asserts/,
    ],
    [
      "a misspelt test key, which leaves the test on the chart's defaults",
      `  - it: refuses
    sets:
      app.mode: nonsense
    asserts:
      - notFailedTemplate: {}
`,
      /`sets` is no key of a test/,
    ],
    [
      "a misspelt capability, which --strict does not see",
      `  - it: renders
    capabilities:
      apiVersion:
        - batch/v1
    asserts:
      - isKind:
          of: CronJob
`,
      /capabilities.apiVersion is not read/,
    ],
    [
      "a document selector with a misspelt key",
      `  - it: renders
    asserts:
      - documentSelector:
          path: kind
          value: Service
          matchMnay: true
        isKind:
          of: Service
`,
      /documentSelector.matchMnay is no key of a document selector/,
    ],
    [
      "a refusal shared between tests as an alias of the assertion",
      `  - it: refuses
    asserts:
      - &refusal
        failedTemplate:
          errorMessage: app.mode is nonsense.
  - it: refuses again
    asserts:
      - isKind:
          of: Service
      - *refusal
`,
      /shares one failedTemplate between tests as an alias of the assertion/,
    ],
    [
      "a refusal written in flow style, which assertions-can-fail cannot plant a mistake in",
      `  - it: refuses
    asserts:
      - failedTemplate: { errorMessage: app.mode is nonsense. }
`,
      /holds 1 refusals but 0 lines that begin with `errorMessage:`/,
    ],
    [
      "a test that does not begin with its name",
      `  - set:
      app.mode: nonsense
    it: refuses
    asserts:
      - failedTemplate:
          errorMessage: app.mode is nonsense.
`,
      /holds 1 tests but 0 lines that begin one with `- it:`/,
    ],
  ];

  test.each(cases)("%s", (_label, tests, expected) => {
    const problems = problemsFor(tests);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join("\n")).toMatch(expected);
  });

  test("a suite with no tests, or a misspelt suite key", () => {
    expect(
      problemsOf("suite: planted\ntests: []\n", "planted_test.yaml").join("\n"),
    ).toMatch(/has no tests/);
    expect(
      problemsOf(
        "suite: planted\ntemplate:\n  - templates/app.yaml\ntests:\n  - it: renders\n    asserts:\n      - isKind:\n          of: Service\n",
        "planted_test.yaml",
      ).join("\n"),
    ).toMatch(/the suite's key `template` is no key of a suite/);
  });

  test("a file that is not YAML", () => {
    expect(
      problemsOf("suite: [unclosed\n", "planted_test.yaml").join("\n"),
    ).toMatch(/is not YAML/);
  });

  test("a Go pattern JavaScript reads otherwise is not judged", () => {
    expect(goPatternAsJs("\\Aapp\\z")).toBeNull();
    expect(goPatternAsJs("[[:alpha:]]+")).toBeNull();
    expect(goPatternAsJs("(?s)a.b").flags).toBe("s");
    expect(matchesAnything("(?s).*")).toBe(true);
    expect(matchesAnything("^app$")).toBe(false);
    expect(matchesAnything("x*")).toBe(true);
  });
});
