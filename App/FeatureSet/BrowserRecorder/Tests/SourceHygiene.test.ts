/*
 * Source-level invariants.
 *
 * These are the rules that a runtime test cannot fully cover, because a
 * violation might live on a code path a fixture never exercises. They are
 * cheap, and each one guards a mistake whose cost is measured in customer
 * trust rather than in a failed request.
 *
 * @types/node is deliberately absent from this package's tsconfig (this is
 * browser code, and Node's fetch/BodyInit definitions conflict with the
 * DOM's), so the handful of Node globals these checks need are declared
 * locally rather than pulled in project-wide.
 */

declare function require(id: string): unknown;
declare const __dirname: string;

interface FileSystem {
  readdirSync: (dir: string) => Array<string>;
  readFileSync: (file: string, encoding: string) => string;
}

interface PathModule {
  join: (...parts: Array<string>) => string;
}

const fs: FileSystem = require("fs") as FileSystem;
const nodePath: PathModule = require("path") as PathModule;

const SOURCE_DIRECTORY: string = nodePath.join(__dirname, "..", "src");

const RRWEB_IMPORT: RegExp = /from\s+["']rrweb["']/;

/*
 * These files explain their own rules at length in prose, so every scan runs
 * against code with comments removed - otherwise the comment that documents
 * "never use sendBeacon" would fail the test that enforces it.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function readSources(): Array<{ name: string; contents: string }> {
  return fs
    .readdirSync(SOURCE_DIRECTORY)
    .filter((file: string): boolean => {
      return file.endsWith(".ts");
    })
    .map((file: string): { name: string; contents: string } => {
      return {
        name: file,
        contents: stripComments(
          fs.readFileSync(nodePath.join(SOURCE_DIRECTORY, file), "utf8"),
        ),
      };
    });
}

describe("source hygiene", (): void => {
  const sources: Array<{ name: string; contents: string }> = readSources();

  it("has the full set of modules", (): void => {
    const names: Array<string> = sources
      .map((source: { name: string }): string => {
        return source.name;
      })
      .sort();

    expect(names).toEqual([
      "Chunker.ts",
      "Config.ts",
      "Consent.ts",
      "ConsoleRecorder.ts",
      "Debug.ts",
      "EarlyErrors.ts",
      "ErrorRecorder.ts",
      "ExtendedConfig.ts",
      "FrustrationDetector.ts",
      "Index.ts",
      "Loader.ts",
      "Masking.ts",
      "NetworkRecorder.ts",
      "PerformanceRecorder.ts",
      "Recorder.ts",
      "RollingBuffer.ts",
      "RouteRecorder.ts",
      "SessionId.ts",
      "Transport.ts",
    ]);
  });

  /*
   * unload and beforeunload disqualify the customer's page from the
   * back/forward cache. A RUM product that degrades its own customer's Core
   * Web Vitals in order to collect data about them has failed at its job.
   *
   * Matched as a registration rather than as the bare word, so the comments
   * explaining the rule do not fail the rule.
   */
  it("never registers unload or beforeunload", (): void => {
    const asListener: RegExp =
      /addEventListener\s*\(\s*["'`](?:before)?unload["'`]/;
    const asHandler: RegExp = /\.on(?:before)?unload\s*=/;

    const offenders: Array<string> = sources
      .filter((source: { contents: string }): boolean => {
        return (
          asListener.test(source.contents) || asHandler.test(source.contents)
        );
      })
      .map((source: { name: string }): string => {
        return source.name;
      });

    expect(offenders).toEqual([]);
  });

  it("uses pagehide and visibilitychange instead", (): void => {
    const recorder: string =
      sources.find((source: { name: string }): boolean => {
        return source.name === "Recorder.ts";
      })?.contents || "";

    expect(recorder).toContain('"pagehide"');
    expect(recorder).toContain('"pageshow"');
    expect(recorder).toContain('"visibilitychange"');
  });

  /*
   * The Replayer is ~34 KB gzip / ~450 KB raw of code that exists only to
   * play a recording back. Importing it here would put it in every customer's
   * page.
   */
  it("never imports the rrweb Replayer", (): void => {
    for (const source of sources) {
      expect(source.contents).not.toMatch(/import\s*\{[^}]*Replayer/);
      expect(source.contents).not.toMatch(/from\s+["']rrweb\/.+["']/);
    }
  });

  it("imports only { record } from rrweb, in one module", (): void => {
    const importers: Array<string> = sources
      .filter((source: { contents: string }): boolean => {
        return RRWEB_IMPORT.test(source.contents);
      })
      .map((source: { name: string }): string => {
        return source.name;
      });

    expect(importers).toEqual(["Recorder.ts"]);

    const recorder: string =
      sources.find((source: { name: string }): boolean => {
        return source.name === "Recorder.ts";
      })?.contents || "";

    expect(recorder).toContain('import { record } from "rrweb";');
  });

  /*
   * The loader stub is what ships with a five minute cache. If it pulled in
   * rrweb or the Recorder, the "roll back a bad masking release by changing
   * one config field" property would be gone, and every page that is NOT
   * recording would still pay to download the recorder.
   */
  it("keeps rrweb and the Recorder out of the loader stub", (): void => {
    /*
     * Both stub modules: the loader itself and the pre-load error buffer
     * it bundles. An import added to either lands in the size-budgeted
     * stub every customer page downloads.
     */
    for (const stubModule of ["Loader.ts", "EarlyErrors.ts"]) {
      const contents: string =
        sources.find((source: { name: string }): boolean => {
          return source.name === stubModule;
        })?.contents || "";

      expect(contents).not.toContain("rrweb");
      expect(contents).not.toContain('from "./Recorder"');
    }
  });

  /*
   * Common/UI/Config.ts reads window.process.env, and Common/package.json
   * pulls express, typeorm, stripe and monaco. Only the deliberately
   * dependency-free Rum modules may be reached, and the esbuild plugin fails
   * the build on anything else - this test just catches it sooner.
   */
  it("imports nothing from Common except the pure Rum modules", (): void => {
    const allowed: RegExp = /^Common\/(Utils|Types)\/Rum\//;
    const offenders: Array<string> = [];

    for (const source of sources) {
      const matches: Array<string> =
        source.contents.match(/from\s+["'](Common\/[^"']+)["']/g) || [];

      for (const match of matches) {
        const specifier: string = match.replace(/^from\s+["']|["']$/g, "");

        if (!allowed.test(specifier)) {
          offenders.push(`${source.name}: ${specifier}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  /*
   * fflate is what rrweb itself ships for packing. Using it would produce raw
   * DEFLATE, and the server's entire decode vocabulary is gzip or none, so it
   * would be stored and later parsed as garbage.
   */
  it("never uses fflate or sendBeacon", (): void => {
    for (const source of sources) {
      expect(source.contents).not.toContain("fflate");
      expect(source.contents).not.toContain("sendBeacon");
    }
  });

  /*
   * The same rule, applied to the Common modules that get INLINED.
   *
   * The scan above reads src/ only, which was a blind spot: files inside
   * Common reach each other with relative specifiers, so a
   * "../../Types/Dictionary" added to a Rum module would have satisfied every
   * source check here while pulling arbitrary Common code into a bundle
   * served to third-party origins. The esbuild plugin hard-fails on this now;
   * this catches it without a build.
   */
  it("keeps the inlined Common Rum modules inside Common/{Utils,Types}/Rum", (): void => {
    const commonRoot: string = nodePath.join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "Common",
    );

    const offenders: Array<string> = [];

    for (const area of ["Utils", "Types"]) {
      const directory: string = nodePath.join(commonRoot, area, "Rum");

      for (const file of fs.readdirSync(directory)) {
        if (!file.endsWith(".ts")) {
          continue;
        }

        const contents: string = stripComments(
          fs.readFileSync(nodePath.join(directory, file), "utf8"),
        );

        const matches: Array<string> =
          contents.match(/from\s+["']([^"']+)["']/g) || [];

        for (const match of matches) {
          const specifier: string = match.replace(/^from\s+["']|["']$/g, "");

          /*
           * Resolved against the module's own directory, because "./X" and
           * "../Rum/X" are both legal and both stay inside the allow-list
           * while "../../Types/Dictionary" does not.
           */
          const resolved: string = nodePath.join(directory, specifier);
          const isInsideRum: boolean =
            resolved.startsWith(nodePath.join(commonRoot, "Utils", "Rum")) ||
            resolved.startsWith(nodePath.join(commonRoot, "Types", "Rum"));

          if (!isInsideRum) {
            offenders.push(`${area}/Rum/${file}: ${specifier}`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  /*
   * The diagnostics are a second channel out of the page, and unlike the
   * recording itself they have no masking of their own - the guarantee comes
   * entirely from DebugDetail admitting only primitives, plus the runtime
   * redaction that refuses anything else. A call site that reached into the
   * DOM for a value would satisfy neither, and it would put page content
   * into a console line and into whatever a customer pastes into a support
   * ticket.
   *
   * Scanned at the source level because a violation might live on a path no
   * fixture ever exercises, which is the whole reason this file exists.
   */
  it("never reads page content into a diagnostic", (): void => {
    /*
     * Every debugLog/debugWarn call, including its multi-line detail object.
     * Non-greedy up to the closing ");" at the start of a line, which is
     * what prettier produces for every call in this package.
     */
    const callPattern: RegExp = /\bdebug(?:Log|Warn)\s*\(([\s\S]*?)\n\s*\);/g;

    /*
     * Reading a node's own content, an element's text, or a form value.
     * `.value` is deliberately absent: it is far too common a property name
     * on our own objects (config.value, entry.value) to scan for usefully,
     * and DebugDetail already refuses the objects those live on.
     */
    const forbidden: Array<RegExp> = [
      /\binnerHTML\b/,
      /\bouterHTML\b/,
      /\btextContent\b/,
      /\binnerText\b/,
      /\bnodeValue\b/,
      /\bgetAttribute\s*\(/,
      /\blocation\.href\b/,
      /\bdocument\b/,
    ];

    const offenders: Array<string> = [];

    for (const source of sources) {
      let match: RegExpExecArray | null = callPattern.exec(source.contents);

      while (match !== null) {
        const call: string = match[1] || "";

        for (const pattern of forbidden) {
          if (pattern.test(call)) {
            offenders.push(`${source.name}: ${pattern.source}`);
          }
        }

        match = callPattern.exec(source.contents);
      }
    }

    expect(offenders).toEqual([]);
  });

  /*
   * The diagnostics must stay OFF by default. This bundle runs on a
   * customer's site in THEIR end users' browsers, and a RUM script that
   * chatters into those consoles is one a customer removes.
   *
   * Enforced by routing every console call through Debug.ts, which checks
   * the switch first. The ONE exception is the unconditional misconfiguration
   * warning in the loader, which is a setup error on the customer's own page
   * and is meant to be seen.
   */
  it("keeps console output inside the diagnostics module", (): void => {
    const offenders: Array<string> = [];

    for (const source of sources) {
      if (source.name === "Debug.ts") {
        continue;
      }

      const calls: number = (
        source.contents.match(/\bconsole\s*\.\s*[a-z]+/g) || []
      ).length;

      if (calls === 0) {
        continue;
      }

      if (source.name === "Loader.ts" && calls === 1) {
        continue;
      }

      offenders.push(`${source.name}: ${calls}`);
    }

    expect(offenders).toEqual([]);
  });

  it("declares rrweb with an exact version, no range", (): void => {
    const packageJson: { dependencies: Record<string, string> } = require(
      nodePath.join(__dirname, "..", "package.json"),
    ) as { dependencies: Record<string, string> };

    expect(packageJson.dependencies["rrweb"]).toBe("2.1.1");
  });
});

/* Marks this file as a module, so its ambient Node declarations stay local. */
export {};
