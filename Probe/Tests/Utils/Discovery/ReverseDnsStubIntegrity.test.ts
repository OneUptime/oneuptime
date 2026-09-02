import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHY THIS FILE EXISTS
 *
 * A unit test in this repository must never send a real DNS query.
 *
 * Since reverse DNS was added to the discovery sweep (OneUptime issue #3529),
 * any test that drives the REAL `SubnetScanner.scan()` ends by asking a
 * resolver for a PTR record per discovered host. Five suites do exactly that,
 * and each calls `stubReverseDnsAsResolvingNothing()` at module scope to keep
 * the sweep's third network seam stubbed the way ICMP and SNMP already are.
 *
 * That is not sufficient on its own, and the way it failed is the reason this
 * file exists. A root-level `beforeEach` covers every test in a file — but two
 * suites call `jest.restoreAllMocks()` in the MIDDLE of a test, to run a second
 * sweep against freshly-configured spies. A blanket restore wipes every spy in
 * the file, the reverse-DNS stub included, and the sweep that follows it ran
 * against whatever resolver the machine happens to have:
 *
 *   - On a machine whose DNS answers for RFC1918 space — a corporate resolver
 *     with 10.in-addr.arpa delegated, or any ISP resolver that hijacks
 *     NXDOMAIN — the second sweep came back with `dnsHostname` set on hosts
 *     the first sweep had none for, failing an assertion that has nothing to
 *     do with naming.
 *   - On a machine with no reachable resolver it paid the full two-second
 *     per-address budget, inside a unit test, silently.
 *
 * Neither symptom names its cause, and neither is reproducible on the machine
 * of whoever wrote the test. So the invariant is enforced mechanically here
 * rather than left to review: in a file that stubs reverse DNS, every
 * `jest.restoreAllMocks()` either IS the suite's own teardown hook, or is
 * immediately followed by a call that puts the stub back.
 *
 * This is a source-level test, in the same style as
 * App/Tests/Dashboard/DiscoveryReviewHostname.test.ts and
 * InventoryTableInvariants.test.ts, because the property is about the shape of
 * the test files themselves and cannot be observed from inside a run.
 */

const DISCOVERY_TEST_DIRECTORIES: Array<string> = [
  path.join(__dirname),
  path.join(__dirname, "..", "..", "Jobs", "Discovery"),
];

const STUB_INSTALLER: string = "stubReverseDnsAsResolvingNothing";
const STUB_REINSTALLER: string = "installReverseDnsStub";
const RESTORE_CALL: string = "jest.restoreAllMocks()";

/*
 * This file talks ABOUT the strings it searches for — in its prose, in its
 * constants and in its own assertions — so scanning itself would make every
 * check below fail on its own documentation. Excluded by name, which is also
 * the only exclusion: any other file that matches is a real finding.
 */
const SELF: string = path.basename(__filename).replace(/\.[jt]s$/, ".ts");

interface TestFile {
  name: string;
  fullPath: string;
  source: string;
  /*
   * The same source with comments removed.
   *
   * Every check that asks "does the CODE do X" must read this and not
   * `source`, or describing a rule in prose satisfies the rule. That is not
   * hypothetical here: the resolver suite's one deliberate real-resolver
   * construction passed the injected-lookup check below purely because a
   * comment between its parentheses happened to contain the word "lookup" —
   * which also means any future file could defeat the check outright by
   * writing `// no lookup here` above a bare construction, the precise thing
   * the check exists to catch.
   */
  code: string;
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/*
 * Read once. These files are edited by other processes (another agent, an
 * editor, a rebase) and an uncached read can hand two assertions in one run
 * two different versions of the same file.
 */
let cachedFiles: Array<TestFile> | null = null;

function readDiscoveryTestFiles(): Array<TestFile> {
  if (cachedFiles) {
    return cachedFiles;
  }

  const files: Array<TestFile> = [];

  for (const directory of DISCOVERY_TEST_DIRECTORIES) {
    if (!fs.existsSync(directory)) {
      continue;
    }

    for (const entry of fs.readdirSync(directory)) {
      if (!entry.endsWith(".test.ts") || entry === SELF) {
        continue;
      }

      const fullPath: string = path.join(directory, entry);
      const source: string = fs.readFileSync(fullPath, "utf8");
      files.push({
        name: entry,
        fullPath: fullPath,
        source: source,
        code: stripComments(source),
      });
    }
  }

  cachedFiles = files;
  return files;
}

/** The suites that drive the real sweep and therefore stub reverse DNS. */
function stubbedFiles(): Array<TestFile> {
  return readDiscoveryTestFiles().filter((file: TestFile) => {
    return file.code.includes(`${STUB_INSTALLER}(`);
  });
}

/*
 * Every entry point that ends in a reverse-DNS pass.
 *
 * `attachReverseDnsHostnames` is called from scanWithDeadline, so it runs on
 * whatever hosts the sweep returned — INCLUDING the hosts a mocked
 * SubnetScanner.scan hands back. Mocking the sweep is therefore not enough to
 * keep a suite off the resolver, which is the trap that caught eight job
 * suites the day the pass moved out of scan().
 */
const SWEEP_ENTRY_POINTS: Array<string> = [
  "scanWithDeadline(",
  "runScan(",
  "fetchAndRunScans(",
  "SubnetScanner.scan(",
  "attachReverseDnsHostnames(",
];

/** Files that can reach a reverse-DNS pass, however indirectly. */
function filesThatReachTheResolver(): Array<TestFile> {
  return readDiscoveryTestFiles().filter((file: TestFile) => {
    return SWEEP_ENTRY_POINTS.some((entryPoint: string) => {
      return file.code.includes(entryPoint);
    });
  });
}

/*
 * A file is covered either by the per-file hook, or by spying on the seam
 * itself — which is what a suite ABOUT naming does, since it needs the pass to
 * return names rather than nothing.
 */
function hasResolverCover(file: TestFile): boolean {
  return (
    file.code.includes(`${STUB_INSTALLER}(`) ||
    file.code.includes('"resolveReverseDnsHostnames"')
  );
}

/*
 * A restore is "safe" when it is the suite's own teardown — the line before it
 * opens an afterEach — or when the very next non-blank, non-comment line puts
 * the stub back.
 */
function unsafeRestoreLines(file: TestFile): Array<number> {
  const lines: Array<string> = file.code.split("\n");
  const unsafe: Array<number> = [];

  lines.forEach((line: string, index: number) => {
    if (!line.includes(RESTORE_CALL)) {
      return;
    }

    const previous: string = (lines[index - 1] || "").trim();

    if (previous.startsWith("afterEach(")) {
      return;
    }

    for (let cursor: number = index + 1; cursor < lines.length; cursor++) {
      const next: string = (lines[cursor] || "").trim();

      if (
        !next ||
        next.startsWith("//") ||
        next.startsWith("*") ||
        next.startsWith("/*")
      ) {
        continue;
      }

      if (!next.includes(`${STUB_REINSTALLER}(`)) {
        // 1-indexed, so the number matches what an editor shows.
        unsafe.push(index + 1);
      }

      return;
    }

    unsafe.push(index + 1);
  });

  return unsafe;
}

describe("no discovery unit test can send a real reverse-DNS query", () => {
  it("finds the suites that drive the real sweep", () => {
    /*
     * A guard on the guard. If a rename or a move made `stubbedFiles()` match
     * nothing, every assertion below would pass over an empty list and this
     * file would protect nothing while staying green — the exact way a
     * source-level test rots.
     */
    const names: Array<string> = stubbedFiles().map((file: TestFile) => {
      return file.name;
    });

    expect(names).toEqual(
      expect.arrayContaining([
        "SubnetScanner.test.ts",
        "SubnetScannerIcmpFallback.test.ts",
        "SubnetScannerIcmpOnly.test.ts",
        "SubnetScannerMultiConfig.test.ts",
        "DiscoveryScanEndToEnd.test.ts",
      ]),
    );
  });

  it("every suite that can reach the resolver stubs it", () => {
    /*
     * The invariant that actually matters, and the one a mocked sweep does
     * NOT satisfy on its own. When the reverse-DNS pass moved out of scan()
     * and into scanWithDeadline — so that it could never spend the sweep's
     * deadline — eight job suites that mock SubnetScanner.scan and return
     * hand-built hosts started reaching a real resolver, silently, because
     * the pass runs on whatever the mock returned.
     */
    const offenders: Array<string> = filesThatReachTheResolver()
      .filter((file: TestFile) => {
        return !hasResolverCover(file);
      })
      .map((file: TestFile) => {
        return file.name;
      });

    expect(offenders).toEqual([]);
  });

  it("actually finds files that reach the resolver", () => {
    // The same guard-on-the-guard as above: an empty list proves nothing.
    expect(filesThatReachTheResolver().length).toBeGreaterThanOrEqual(10);
  });

  it("every mid-test jest.restoreAllMocks() puts the reverse-DNS stub back", () => {
    const offenders: Array<string> = [];

    for (const file of stubbedFiles()) {
      for (const line of unsafeRestoreLines(file)) {
        offenders.push(`${file.name}:${line}`);
      }
    }

    /*
     * If this fails, the named line wiped the file's reverse-DNS stub and
     * whatever sweep runs after it will query the machine's real resolver.
     * Add `installReverseDnsStub();` immediately after the restore.
     */
    expect(offenders).toEqual([]);
  });

  it("the helper exposes a re-installer, not only a per-file hook", () => {
    /*
     * The fix above depends on `installReverseDnsStub` existing and being
     * callable mid-test. Deleting it in a tidy-up would leave the two call
     * sites unresolved at compile time, but this states the requirement where
     * the reason for it is written down.
     */
    const helper: string = fs.readFileSync(
      path.join(__dirname, "..", "..", "TestingUtils", "StubReverseDns.ts"),
      "utf8",
    );

    expect(helper).toContain(`export function ${STUB_REINSTALLER}(`);
    expect(helper).toContain(`export function ${STUB_INSTALLER}(`);
  });

  it("no discovery test constructs a ReverseDnsResolver without injecting a lookup", () => {
    /*
     * The other way a real query can escape: `new ReverseDnsResolver()` with
     * no `lookup` falls back to `buildDefaultLookup`, which dials the system
     * resolvers. Every test that builds one must inject a fake.
     */
    const offenders: Array<string> = [];

    for (const file of readDiscoveryTestFiles()) {
      const matches: Array<string> =
        file.code.match(/new ReverseDnsResolver\(([^)]*)\)/g) || [];

      for (const match of matches) {
        if (!match.includes("lookup")) {
          offenders.push(`${file.name}: ${match}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
