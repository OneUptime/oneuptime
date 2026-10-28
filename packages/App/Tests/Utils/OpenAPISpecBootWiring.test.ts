import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import ts from "typescript";

/*
 * The OpenAPI spec the App serves at GET /api/openapi/spec.
 *
 * Building it walks every model for about ten seconds of CPU, and the
 * document is 33 MB of objects. So the App builds it once at boot, before it
 * serves requests, and keeps only its gzipped JSON
 * (OpenAPIUtil.getOpenAPISpecResponse, 0.6 MB). generateOpenAPISpec builds
 * the same document and keeps it, for scripts and tests: a server that
 * called it would hold the 33 MB again for as long as it runs.
 *
 * Read from the source with comments removed, so prose cannot satisfy it.
 */

const APP_ROOT: string = path.join(__dirname, "..", "..");
const PACKAGES: string = path.join(APP_ROOT, "..");
const REPO_ROOT: string = path.join(PACKAGES, "..");
const INDEX_PATH: string = path.join(APP_ROOT, "Index.ts");
const OPENAPI_UTIL: string = path.join(
  PACKAGES,
  "Common",
  "Server",
  "Utils",
  "OpenAPI.ts",
);
const KEEPS_THE_DOCUMENT: string = "generateOpenAPISpec(";

function code(filePath: string): string {
  const source: string = fs.readFileSync(filePath, "utf8");
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    path.basename(filePath),
    source,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  return ts.createPrinter({ removeComments: true }).printFile(sourceFile);
}

function indexOfOnly(haystack: string, needle: string): number {
  const first: number = haystack.indexOf(needle);
  expect({ needle, found: first >= 0 }).toEqual({ needle, found: true });
  expect({
    needle,
    unique: haystack.indexOf(needle, first + 1) === -1,
  }).toEqual({ needle, unique: true });
  return first;
}

// Directories that hold no server code, or none of this repository's own.
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set<string>([
  "node_modules",
  "build",
  "dist",
  "Tests",
]);

function serverFiles(directory: string): Array<string> {
  const files: Array<string> = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    const full: string = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        files.push(...serverFiles(full));
      }
    } else if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".d.ts")
    ) {
      files.push(full);
    }
  }
  return files;
}

describe("App/Index.ts builds the OpenAPI spec it serves at boot", () => {
  const source: string = code(INDEX_PATH);

  test("as the gzipped response the route serves, before the gate opens", () => {
    const built: number = indexOfOnly(
      source,
      "OpenAPIUtil.getOpenAPISpecResponse();",
    );
    const open: number = indexOfOnly(source, "StartupGate.open();");

    expect(built).toBeLessThan(open);
  });

  test("and never as the document generateOpenAPISpec keeps", () => {
    expect(source).not.toContain(KEEPS_THE_DOCUMENT);
  });
});

// Whether a file's code (comments aside) calls generateOpenAPISpec.
function keepsTheDocument(file: string): boolean {
  return (
    fs.readFileSync(file, "utf8").includes(KEEPS_THE_DOCUMENT) &&
    code(file).includes(KEEPS_THE_DOCUMENT)
  );
}

describe("no server code keeps the OpenAPI document", () => {
  test("only scripts and tests call generateOpenAPISpec", () => {
    // The App and Common's server code: what serves the spec and all it runs.
    const roots: Array<string> = [
      APP_ROOT,
      path.join(PACKAGES, "Common", "Server"),
    ];

    const callers: Array<string> = [];
    let read: number = 0;
    for (const root of roots) {
      for (const file of serverFiles(root)) {
        read++;
        // Where it is defined, beside getOpenAPISpecResponse.
        if (file !== OPENAPI_UTIL && keepsTheDocument(file)) {
          callers.push(path.relative(REPO_ROOT, file));
        }
      }
    }

    expect(read).toBeGreaterThan(1000);
    expect(callers).toEqual([]);
  });

  test("the scan sees a call, and not a comment that names it", () => {
    const directory: string = fs.mkdtempSync(
      path.join(os.tmpdir(), "openapi-spec-boot-wiring-"),
    );
    try {
      const calls: string = path.join(directory, "Calls.ts");
      const names: string = path.join(directory, "Names.ts");
      fs.writeFileSync(
        calls,
        'import OpenAPIUtil from "Common/Server/Utils/OpenAPI";\nOpenAPIUtil.generateOpenAPISpec();\n',
      );
      fs.writeFileSync(
        names,
        "// Not OpenAPIUtil.generateOpenAPISpec(): it keeps the document.\nexport const kept: boolean = false;\n",
      );

      expect(keepsTheDocument(calls)).toBe(true);
      expect(keepsTheDocument(names)).toBe(false);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
