import { GuideSnippet } from "./GuideTypes";

/*
 * Reading a guide's code the way its checks need to: the packages its
 * JavaScript imports, and the packages its install commands pin. The
 * end-to-end check (Scripts/VerifyOpenTelemetryGuides.ts) records each
 * imported package's exports as installed, and Tests/OpenTelemetryGuides
 * holds every import of every snippet to those records and every install
 * command to the versions the check ran.
 *
 * Plain string scanning, line by line: the snippets are the guides' own.
 */

const SCRIPT_LANGUAGES: ReadonlyArray<string> = [
  "javascript",
  "typescript",
  "tsx",
];

export function isScriptSnippet(snippet: GuideSnippet): boolean {
  return SCRIPT_LANGUAGES.includes(snippet.language);
}

// The text between the first pair of quotes after `marker` on a line.
function quotedAfter(line: string, marker: string): string | undefined {
  const at: number = line.indexOf(marker);

  if (at === -1) {
    return undefined;
  }

  const rest: string = line.slice(at + marker.length);
  const doubleAt: number = rest.indexOf('"');
  const singleAt: number = rest.indexOf("'");
  const start: number =
    doubleAt === -1
      ? singleAt
      : singleAt === -1
        ? doubleAt
        : Math.min(doubleAt, singleAt);

  if (start === -1) {
    return undefined;
  }

  const end: number = rest.indexOf(rest.charAt(start), start + 1);

  return end > start ? rest.slice(start + 1, end) : undefined;
}

// Every module a snippet's code names in an import, an export-from or a require.
export function moduleSpecifiers(code: string): Array<string> {
  const specifiers: Array<string> = [];

  for (const rawLine of code.split("\n")) {
    const line: string = rawLine.trim();

    if (line.startsWith("//") || line.startsWith("*")) {
      continue;
    }

    const fromSpecifier: string | undefined = line.includes(" from ")
      ? quotedAfter(line, " from ")
      : undefined;
    const sideEffect: string | undefined =
      line.startsWith("import ") && !line.includes(" from ")
        ? quotedAfter(line, "import ")
        : undefined;
    const dynamic: string | undefined = line.includes("import(")
      ? quotedAfter(line, "import(")
      : undefined;
    const required: string | undefined = line.includes("require(")
      ? quotedAfter(line, "require(")
      : undefined;

    for (const specifier of [fromSpecifier, sideEffect, dynamic, required]) {
      if (specifier && !specifiers.includes(specifier)) {
        specifiers.push(specifier);
      }
    }
  }

  return specifiers;
}

// A package's own name: "@opentelemetry/api" of "@opentelemetry/api/x", "react-dom" of "react-dom/client".
export function packageNameOf(specifier: string): string {
  const bare: string = specifier.startsWith("npm:")
    ? specifier.slice("npm:".length)
    : specifier;
  const parts: Array<string> = bare.split("/");
  const name: string = bare.startsWith("@")
    ? `${parts[0]}/${parts[1] || ""}`
    : parts[0] || "";

  // Deno's npm: specifiers carry a version: "@opentelemetry/api@1".
  const versionAt: number = name.lastIndexOf("@");

  return versionAt > 0 ? name.slice(0, versionAt) : name;
}

export function isPackageSpecifier(specifier: string): boolean {
  return (
    !specifier.startsWith(".") &&
    !specifier.startsWith("/") &&
    !specifier.startsWith("node:") &&
    !specifier.startsWith("jsr:") &&
    !specifier.startsWith("http")
  );
}

// The packages a guide's scripts import, as they write them, once each.
export function importedPackages(snippets: Array<GuideSnippet>): Array<string> {
  const specifiers: Array<string> = [];

  for (const snippet of snippets) {
    if (!isScriptSnippet(snippet)) {
      continue;
    }

    for (const specifier of moduleSpecifiers(snippet.code)) {
      if (isPackageSpecifier(specifier) && !specifiers.includes(specifier)) {
        specifiers.push(specifier);
      }
    }
  }

  return specifiers.sort();
}

export interface InstalledPackage {
  name: string;
  // The version the command pins, if it pins one.
  version?: string | undefined;
}

/*
 * The packages an install command adds: `npm install a@1.0.0 \` lines,
 * `npm install`, `pnpm add`, `yarn add`, `bun add` and `deno add`.
 */
export function installedPackages(commands: string): Array<InstalledPackage> {
  const packages: Array<InstalledPackage> = [];
  const words: Array<string> = commands
    .split("\\\n")
    .join(" ")
    .split("\n")
    .flatMap((line: string): Array<string> => {
      return [...line.split(" "), "\n"];
    })
    .filter((word: string): boolean => {
      return word.length > 0;
    });

  let installing: boolean = false;

  for (let index: number = 0; index < words.length; index++) {
    const word: string = words[index]!;

    if (word === "\n" || word === "&&" || word === ";") {
      installing = false;
      continue;
    }

    const previous: string = words[index - 1] || "";
    if (
      (word === "install" || word === "i" || word === "add") &&
      ["npm", "pnpm", "yarn", "bun", "deno"].includes(previous)
    ) {
      installing = true;
      continue;
    }

    if (!installing || word.startsWith("-")) {
      continue;
    }

    const spec: string = word.startsWith("npm:") ? word.slice(4) : word;
    const versionAt: number = spec.lastIndexOf("@");

    if (versionAt > 0) {
      packages.push({
        name: spec.slice(0, versionAt),
        version: spec.slice(versionAt + 1),
      });
    } else {
      packages.push({ name: spec });
    }
  }

  return packages;
}

export function installedPackageNames(commands: string): Array<string> {
  return Array.from(
    new Set(
      installedPackages(commands).map((item: InstalledPackage): string => {
        return item.name;
      }),
    ),
  );
}
