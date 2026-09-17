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
 *
 * NetBIOS (OneUptime issue #3677). A completed sweep can now end in a second
 * network pass: a NetBIOS node status query to UDP 137 of each host still
 * unnamed. It sits at the same point as reverse DNS, is reached through the
 * same entry points, and a real datagram from a unit test is worse than a real
 * DNS query — it goes straight to whatever machine owns a fixture's 10.x
 * address on the developer's network. So every rule here now covers both
 * seams: a suite that can reach the sweep must stub BOTH, a mid-test restore
 * must put BOTH back (installReverseDnsStub installs the NetBIOS stub too),
 * and no test may build a NetbiosNameResolver without injecting its socket.
 */

const DISCOVERY_TEST_DIRECTORIES: Array<string> = [
  path.join(__dirname),
  path.join(__dirname, "..", "..", "Jobs", "Discovery"),
];

const STUB_INSTALLER: string = "stubReverseDnsAsResolvingNothing";
const STUB_REINSTALLER: string = "installReverseDnsStub";
const NETBIOS_STUB_INSTALLER: string = "stubNetbiosAsResolvingNothing";
const NETBIOS_STUB_REINSTALLER: string = "installNetbiosStub";
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
 * Suites that install ONLY the NetBIOS per-file hook — typically a suite about
 * reverse-DNS naming, which spies on that seam itself. They carry the same
 * mid-test restore obligation for the NetBIOS stub.
 */
function netbiosOnlyStubbedFiles(): Array<TestFile> {
  return readDiscoveryTestFiles().filter((file: TestFile) => {
    return (
      file.code.includes(`${NETBIOS_STUB_INSTALLER}(`) &&
      !file.code.includes(`${STUB_INSTALLER}(`)
    );
  });
}

/*
 * Every entry point that ends in a reverse-DNS or NetBIOS pass.
 *
 * `attachReverseDnsHostnames` is called from scanWithDeadline, so it runs on
 * whatever hosts the sweep returned — INCLUDING the hosts a mocked
 * SubnetScanner.scan hands back. Mocking the sweep is therefore not enough to
 * keep a suite off the resolver, which is the trap that caught eight job
 * suites the day the pass moved out of scan(). `attachNetbiosNames` runs at
 * the same point, on the same hosts, and is the NetBIOS lookup's direct entry.
 */
const SWEEP_ENTRY_POINTS: Array<string> = [
  "scanWithDeadline(",
  "runScan(",
  "fetchAndRunScans(",
  "SubnetScanner.scan(",
  "attachReverseDnsHostnames(",
  "attachNetbiosNames(",
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
 * A file is covered for a seam either by a per-file hook, or by spying on the
 * seam itself — which is what a suite ABOUT naming does, since it needs the
 * pass to return names rather than nothing.
 */
function hasReverseDnsCover(file: TestFile): boolean {
  return (
    file.code.includes(`${STUB_INSTALLER}(`) ||
    file.code.includes('"resolveReverseDnsHostnames"')
  );
}

/*
 * The reverse-DNS hook counts for NetBIOS too, because installReverseDnsStub
 * installs both — pinned by "the reverse-DNS re-installer also installs the
 * NetBIOS stub" below, so this shortcut cannot silently stop being true.
 */
function hasNetbiosCover(file: TestFile): boolean {
  return (
    file.code.includes(`${STUB_INSTALLER}(`) ||
    file.code.includes(`${NETBIOS_STUB_INSTALLER}(`) ||
    file.code.includes('"resolveNetbiosNames"')
  );
}

// Covered means BOTH post-sweep network seams are kept off the wire.
function hasResolverCover(file: TestFile): boolean {
  return hasReverseDnsCover(file) && hasNetbiosCover(file);
}

/*
 * The argument text of every `<callee>(...)` in a file, found by matching
 * parentheses rather than by `[^)]*`. An options object full of arrow
 * functions — `{ now: () => clock, createSocket: ... }` — closes a paren long
 * before the call does, and a regex that stops there would miss an injected
 * key written after the first arrow and report a false offender.
 */
function callArguments(code: string, callee: string): Array<string> {
  const results: Array<string> = [];
  let searchFrom: number = 0;

  for (;;) {
    const start: number = code.indexOf(callee, searchFrom);

    if (start === -1) {
      return results;
    }

    const argumentsStart: number = start + callee.length;
    let depth: number = 1;
    let cursor: number = argumentsStart;

    while (cursor < code.length && depth > 0) {
      const character: string = code.charAt(cursor);

      if (character === "(") {
        depth++;
      } else if (character === ")") {
        depth--;
      }

      cursor++;
    }

    results.push(
      code.substring(argumentsStart, Math.max(argumentsStart, cursor - 1)),
    );
    searchFrom = argumentsStart;
  }
}

/*
 * A restore is "safe" when it is the suite's own teardown — the line before it
 * opens an afterEach — or when the very next non-blank, non-comment line puts
 * the stub back with one of the accepted re-installers.
 */
function unsafeRestoreLines(
  file: TestFile,
  acceptedReinstallers: Array<string> = [STUB_REINSTALLER],
): Array<number> {
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

      const isReinstalled: boolean = acceptedReinstallers.some(
        (reinstaller: string) => {
          return next.includes(`${reinstaller}(`);
        },
      );

      if (!isReinstalled) {
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

  it("every mid-test jest.restoreAllMocks() in a NetBIOS-only stubbed suite puts the NetBIOS stub back", () => {
    const offenders: Array<string> = [];

    for (const file of netbiosOnlyStubbedFiles()) {
      for (const line of unsafeRestoreLines(file, [
        NETBIOS_STUB_REINSTALLER,
        STUB_REINSTALLER,
      ])) {
        offenders.push(`${file.name}:${line}`);
      }
    }

    /*
     * If this fails, add `installNetbiosStub();` (or `installReverseDnsStub();`,
     * which installs both) immediately after the named restore.
     */
    expect(offenders).toEqual([]);
  });

  it("the two naming suites are among those that reach the sweep, and both are covered", () => {
    /*
     * The suites ABOUT naming are the ones that spy on one seam themselves and
     * so are the likeliest to forget the other. Named explicitly so a rename
     * cannot quietly drop them out of the checks above.
     */
    const reaching: Array<TestFile> = filesThatReachTheResolver();
    const names: Array<string> = reaching.map((file: TestFile) => {
      return file.name;
    });

    expect(names).toEqual(
      expect.arrayContaining([
        "DiscoveryReverseDns.test.ts",
        "DiscoveryNetbios.test.ts",
      ]),
    );

    for (const name of [
      "DiscoveryReverseDns.test.ts",
      "DiscoveryNetbios.test.ts",
    ]) {
      const file: TestFile = reaching.find((candidate: TestFile) => {
        return candidate.name === name;
      })!;

      expect({
        name: name,
        reverseDns: hasReverseDnsCover(file),
        netbios: hasNetbiosCover(file),
      }).toEqual({ name: name, reverseDns: true, netbios: true });
    }
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

    const netbiosHelper: string = fs.readFileSync(
      path.join(__dirname, "..", "..", "TestingUtils", "StubNetbios.ts"),
      "utf8",
    );

    expect(netbiosHelper).toContain(
      `export function ${NETBIOS_STUB_REINSTALLER}(`,
    );
    expect(netbiosHelper).toContain(
      `export function ${NETBIOS_STUB_INSTALLER}(`,
    );
  });

  it("the reverse-DNS re-installer also installs the NetBIOS stub", () => {
    /*
     * hasNetbiosCover counts a file that only calls the reverse-DNS hook, and
     * the restore rule accepts installReverseDnsStub() alone. Both shortcuts
     * rest on this one call inside its body; checked in the CODE of that
     * function, so a comment mentioning the name cannot satisfy it.
     */
    const helperCode: string = stripComments(
      fs.readFileSync(
        path.join(__dirname, "..", "..", "TestingUtils", "StubReverseDns.ts"),
        "utf8",
      ),
    );

    const bodyStart: number = helperCode.indexOf(
      `export function ${STUB_REINSTALLER}(`,
    );
    const bodyEnd: number = helperCode.indexOf(
      "export function",
      bodyStart + 1,
    );

    expect(bodyStart).toBeGreaterThanOrEqual(0);
    expect(
      helperCode.substring(bodyStart, bodyEnd === -1 ? undefined : bodyEnd),
    ).toContain(`${NETBIOS_STUB_REINSTALLER}()`);
  });

  it("no discovery test constructs a NetbiosNameResolver without injecting a socket", () => {
    /*
     * `new NetbiosNameResolver()` with no `createSocket` opens a real udp4
     * socket and sends to UDP 137. Every test that builds one must inject a
     * fake — or, like the one deliberate end-to-end test, inject a real socket
     * explicitly so the choice is visible at the call site.
     */
    const offenders: Array<string> = [];
    let constructions: number = 0;

    for (const file of readDiscoveryTestFiles()) {
      for (const args of callArguments(file.code, "new NetbiosNameResolver(")) {
        constructions++;

        if (!args.includes("createSocket")) {
          offenders.push(
            `${file.name}: new NetbiosNameResolver(${args.trim()})`,
          );
        }
      }
    }

    expect(offenders).toEqual([]);
    // A guard on the guard: the resolver suite does construct resolvers.
    expect(constructions).toBeGreaterThan(0);
  });

  it("callArguments sees an injected key written after an arrow function", () => {
    // The case a `[^)]*` regex gets wrong, pinned so the helper stays honest.
    expect(
      callArguments(
        "new NetbiosNameResolver({ now: (): number => 1, createSocket: f })",
        "new NetbiosNameResolver(",
      ),
    ).toEqual(["{ now: (): number => 1, createSocket: f }"]);
    expect(
      callArguments("new NetbiosNameResolver()", "new NetbiosNameResolver("),
    ).toEqual([""]);
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
