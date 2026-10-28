import { GuideSnippet } from "./GuideTypes";

/*
 * Reading a guide's code the way its checks need to: the packages its
 * JavaScript imports, the packages its install commands and build files
 * pin (npm, pip, Maven, Gradle, NuGet), and whether code in a language
 * the tests cannot run (Java, Kotlin, C#, a .properties or INI file) is
 * at least well formed. The end-to-end check (Scripts/
 * VerifyOpenTelemetryGuides.ts) records each imported package's exports
 * and each installed package's version, and Tests/OpenTelemetryGuides
 * holds every import of every snippet to those records and every install
 * command and build file to the versions the check ran.
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

// Where a package's name is looked up: npm, PyPI, Maven Central, NuGet.
export type PackageEcosystem = "npm" | "pypi" | "maven" | "nuget";

export interface InstalledPackage {
  /*
   * As its registry names it: "express", "opentelemetry-distro",
   * "io.opentelemetry:opentelemetry-api" (group and artifact), a Gradle
   * plugin by its id ("io.ktor.plugin"), "OpenTelemetry.Extensions.Hosting".
   */
  name: string;
  // The version the command or build file pins, if it pins one.
  version?: string | undefined;
  ecosystem: PackageEcosystem;
}

const NPM_TOOLS: ReadonlyArray<string> = ["npm", "pnpm", "yarn", "bun", "deno"];
const PIP_TOOLS: ReadonlyArray<string> = ["pip", "pip3"];

// A command's words, its continuation lines joined and "\n" between commands.
function commandWords(commands: string): Array<string> {
  return commands
    .split("\\\n")
    .join(" ")
    .split("\n")
    .flatMap((line: string): Array<string> => {
      return [...line.split(" "), "\n"];
    })
    .filter((word: string): boolean => {
      return word.length > 0;
    });
}

// "name@1.0.0", "npm:name@1", "@scope/name@2.0.0".
function npmSpec(word: string): InstalledPackage {
  const spec: string = word.startsWith("npm:") ? word.slice(4) : word;
  const versionAt: number = spec.lastIndexOf("@");

  return versionAt > 0
    ? {
        name: spec.slice(0, versionAt),
        version: spec.slice(versionAt + 1),
        ecosystem: "npm",
      }
    : { name: spec, ecosystem: "npm" };
}

// '"celery[redis]==5.6.3"' is celery at 5.6.3; a range ("django>=6") pins nothing.
function pipSpec(word: string): InstalledPackage {
  let spec: string = word;

  for (const quote of ['"', "'"]) {
    if (spec.startsWith(quote) && spec.endsWith(quote) && spec.length > 1) {
      spec = spec.slice(1, -1);
    }
  }

  const pinAt: number = spec.indexOf("==");
  const requirement: string = pinAt === -1 ? spec : spec.slice(0, pinAt);
  const extrasAt: number = requirement.indexOf("[");
  let name: string =
    extrasAt === -1 ? requirement : requirement.slice(0, extrasAt);

  for (const operator of [">", "<", "~", "!", "="]) {
    const at: number = name.indexOf(operator);
    if (at !== -1) {
      name = name.slice(0, at);
    }
  }

  return pinAt === -1
    ? { name: name, ecosystem: "pypi" }
    : { name: name, version: spec.slice(pinAt + 2), ecosystem: "pypi" };
}

// The Java agent as Maven Central names it.
export const JAVA_AGENT_PACKAGE: string =
  "io.opentelemetry.javaagent:opentelemetry-javaagent";

/*
 * The agent a download URL fetches, at its release's version - curl's
 * ".../releases/download/v2.33.1/opentelemetry-javaagent.jar", a
 * Dockerfile's ADD of it - or undefined for any other word.
 */
export function javaAgentDownload(word: string): InstalledPackage | undefined {
  const marker: string = "/releases/download/v";
  const at: number = word.indexOf(marker);
  const end: number = word.indexOf("/", at + marker.length);

  if (
    at === -1 ||
    end === -1 ||
    !word.endsWith("/opentelemetry-javaagent.jar")
  ) {
    return undefined;
  }

  return {
    name: JAVA_AGENT_PACKAGE,
    version: word.slice(at + marker.length, end),
    ecosystem: "maven",
  };
}

/*
 * The packages an install command adds:
 *
 *   npm install a@1.0.0, pnpm add, yarn add, bun add, deno add      (npm)
 *   pip install a==1.0, pip3 install, python -m pip install          (PyPI)
 *   dotnet add package A --version 1.0.0                            (NuGet)
 *   the Java agent's release download (curl, a Dockerfile's ADD)    (Maven)
 *
 * each on one line or continued with "\" at the ends of its lines.
 */
export function installedPackages(commands: string): Array<InstalledPackage> {
  const packages: Array<InstalledPackage> = [];
  const words: Array<string> = commandWords(commands);
  let installing: PackageEcosystem | null = null;

  for (let index: number = 0; index < words.length; index++) {
    const word: string = words[index]!;

    if (word === "\n" || word === "&&" || word === ";") {
      installing = null;
      continue;
    }

    const agent: InstalledPackage | undefined = javaAgentDownload(word);

    if (agent) {
      packages.push(agent);
      continue;
    }

    const previous: string = words[index - 1] || "";

    if (
      (word === "install" || word === "i" || word === "add") &&
      NPM_TOOLS.includes(previous)
    ) {
      installing = "npm";
      continue;
    }

    if (word === "install" && PIP_TOOLS.includes(previous)) {
      installing = "pypi";
      continue;
    }

    // dotnet add [project] package Name --version 1.0.0
    if (word === "package" && words.slice(0, index).includes("add")) {
      const command: number = words.lastIndexOf("dotnet", index);
      const lineStart: number = words.lastIndexOf("\n", index);

      if (command > lineStart) {
        const name: string = words[index + 1] || "";
        const versionFlag: number = words.findIndex(
          (candidate: string, at: number): boolean => {
            return (
              at > index &&
              (candidate === "--version" || candidate === "-v") &&
              !words.slice(index, at).includes("\n")
            );
          },
        );

        packages.push(
          versionFlag === -1
            ? { name: name, ecosystem: "nuget" }
            : {
                name: name,
                version: words[versionFlag + 1] || "",
                ecosystem: "nuget",
              },
        );
      }
      continue;
    }

    if (!installing || word.startsWith("-")) {
      continue;
    }

    // pip's -r requirements.txt and -c constraints.txt name a file, not a package.
    if (installing === "pypi" && (previous === "-r" || previous === "-c")) {
      continue;
    }

    packages.push(installing === "npm" ? npmSpec(word) : pipSpec(word));
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

// Every <tag>...</tag> block of a document, outermost first.
function elementBlocks(document: string, tag: string): Array<string> {
  const blocks: Array<string> = [];
  const open: string = `<${tag}>`;
  const close: string = `</${tag}>`;
  let from: number = 0;

  for (;;) {
    const start: number = document.indexOf(open, from);

    if (start === -1) {
      return blocks;
    }

    const end: number = document.indexOf(close, start);

    if (end === -1) {
      return blocks;
    }

    blocks.push(document.slice(start + open.length, end));
    from = end + close.length;
  }
}

/*
 * The text of a block's own <tag> element, not of one nested deeper: a
 * plugin's <version>, never the version of an annotation processor path
 * inside its <configuration>. Undefined when the block has none of its own.
 */
function ownElementText(block: string, tag: string): string | undefined {
  let depth: number = 0;
  let from: number = 0;

  for (;;) {
    const start: number = block.indexOf("<", from);

    if (start === -1) {
      return undefined;
    }

    if (block.startsWith("<!--", start)) {
      const commentEnd: number = block.indexOf("-->", start);
      from = commentEnd === -1 ? block.length : commentEnd + 3;
      continue;
    }

    const end: number = block.indexOf(">", start);

    if (end === -1) {
      return undefined;
    }

    const inside: string = block.slice(start + 1, end);
    from = end + 1;

    if (inside.startsWith("/")) {
      depth--;
      continue;
    }

    if (inside.endsWith("/")) {
      continue;
    }

    const name: string = inside.split(" ")[0] || "";

    if (depth === 0 && name === tag) {
      const close: number = block.indexOf(`</${tag}>`, from);

      return close === -1 ? undefined : block.slice(from, close).trim();
    }

    depth++;
  }
}

/*
 * A pom's own properties, by name: <quarkus.platform.version>3.40.1.1
 * </quarkus.platform.version> is quarkus.platform.version.
 */
function pomProperties(code: string): Record<string, string> {
  const properties: Record<string, string> = {};
  const block: string | undefined = elementBlocks(code, "properties")[0];

  if (!block) {
    return properties;
  }

  let from: number = 0;

  for (;;) {
    const start: number = block.indexOf("<", from);
    const end: number = start === -1 ? -1 : block.indexOf(">", start);

    if (start === -1 || end === -1) {
      return properties;
    }

    const name: string = block.slice(start + 1, end);
    const close: number = block.indexOf(`</${name}>`, end);

    if (name.startsWith("!--") || name.startsWith("/") || close === -1) {
      from = end + 1;
      continue;
    }

    properties[name] = block.slice(end + 1, close).trim();
    from = close + name.length + 3;
  }
}

/*
 * A value with the pom's ${properties} put in: "${quarkus.platform.version}"
 * is "3.40.1.1". A property the pom does not define (one its parent does,
 * or Maven's own) is left as written.
 */
function withPomProperties(
  value: string,
  properties: Record<string, string>,
): string {
  let resolved: string = value;

  for (const [name, propertyValue] of Object.entries(properties)) {
    resolved = resolved.split(`\${${name}}`).join(propertyValue);
  }

  return resolved;
}

// The value of attribute `name` in one tag's text: Include="OpenTelemetry".
function attributeValue(tag: string, name: string): string | undefined {
  const marker: string = `${name}="`;
  const start: number = tag.indexOf(marker);

  if (start === -1) {
    return undefined;
  }

  const end: number = tag.indexOf('"', start + marker.length);

  return end === -1 ? undefined : tag.slice(start + marker.length, end);
}

/*
 * The dependencies a Maven pom declares - its <parent>, <dependency> and
 * <plugin> blocks, each by its own coordinates with the pom's properties
 * put in, a version left to a BOM or a parent having none - and the
 * packages a .csproj references.
 */
function xmlBuildFileDependencies(code: string): Array<InstalledPackage> {
  const packages: Array<InstalledPackage> = [];
  const properties: Record<string, string> = pomProperties(code);
  const own: (block: string, tag: string) => string | undefined = (
    block: string,
    tag: string,
  ): string | undefined => {
    const text: string | undefined = ownElementText(block, tag);

    return text === undefined ? undefined : withPomProperties(text, properties);
  };

  for (const tag of ["parent", "dependency", "plugin"]) {
    for (const block of elementBlocks(code, tag)) {
      const groupId: string | undefined = own(block, "groupId");
      const artifactId: string | undefined = own(block, "artifactId");

      if (!artifactId) {
        continue;
      }

      const version: string | undefined = own(block, "version");
      const name: string = `${groupId || "org.apache.maven.plugins"}:${artifactId}`;

      packages.push(
        version
          ? { name: name, version: version, ecosystem: "maven" }
          : { name: name, ecosystem: "maven" },
      );
    }
  }

  let from: number = 0;

  for (;;) {
    const start: number = code.indexOf("<PackageReference ", from);

    if (start === -1) {
      break;
    }

    const end: number = code.indexOf(">", start);
    const tag: string = code.slice(start, end === -1 ? code.length : end);
    const name: string | undefined = attributeValue(tag, "Include");
    const version: string | undefined = attributeValue(tag, "Version");

    if (name) {
      packages.push(
        version
          ? { name: name, version: version, ecosystem: "nuget" }
          : { name: name, ecosystem: "nuget" },
      );
    }

    from = start + 1;
  }

  return packages;
}

// The quoted strings of one line: implementation("a:b:1.0") has "a:b:1.0".
function quotedStrings(line: string): Array<string> {
  const strings: Array<string> = [];
  let from: number = 0;

  for (;;) {
    const start: number = line.indexOf('"', from);

    if (start === -1) {
      return strings;
    }

    const end: number = line.indexOf('"', start + 1);

    if (end === -1) {
      return strings;
    }

    strings.push(line.slice(start + 1, end));
    from = end + 1;
  }
}

/*
 * The dependencies a Gradle build in Kotlin declares - "group:artifact" or
 * "group:artifact:version", a platform's too - and the plugins it applies
 * with a version: id("io.ktor.plugin") version "3.6.0", kotlin("jvm")
 * version "2.4.21" (the plugin org.jetbrains.kotlin.jvm).
 */
function gradleBuildFileDependencies(code: string): Array<InstalledPackage> {
  const packages: Array<InstalledPackage> = [];

  for (const rawLine of code.split("\n")) {
    const line: string = rawLine.trim();

    if (line.startsWith("//")) {
      continue;
    }

    const strings: Array<string> = quotedStrings(line);
    const versionAt: number = line.indexOf(" version ");

    if (versionAt !== -1 && strings.length >= 2) {
      const pluginVersion: string = strings[strings.length - 1]!;

      if (line.startsWith("id(")) {
        packages.push({
          name: strings[0]!,
          version: pluginVersion,
          ecosystem: "maven",
        });
        continue;
      }

      if (line.startsWith("kotlin(")) {
        packages.push({
          name: `org.jetbrains.kotlin.${strings[0]!}`,
          version: pluginVersion,
          ecosystem: "maven",
        });
        continue;
      }
    }

    for (const text of strings) {
      const parts: Array<string> = text.split(":");

      if (parts.length < 2 || parts.length > 3 || text.includes(" ")) {
        continue;
      }

      const name: string = `${parts[0]}:${parts[1]}`;

      packages.push(
        parts.length === 3
          ? { name: name, version: parts[2]!, ecosystem: "maven" }
          : { name: name, ecosystem: "maven" },
      );
    }
  }

  return packages;
}

// A snippet that is a build file: pom.xml, build.gradle.kts, a .csproj.
export function isBuildFileSnippet(snippet: GuideSnippet): boolean {
  const title: string = snippet.title || "";

  return (
    (snippet.language === "xml" &&
      (title.endsWith("pom.xml") || title.endsWith(".csproj"))) ||
    (snippet.language === "kotlin" && title.endsWith(".gradle.kts"))
  );
}

// What a build file snippet declares, as an install command would install it.
export function buildFileDependencies(
  snippet: GuideSnippet,
): Array<InstalledPackage> {
  if (!isBuildFileSnippet(snippet)) {
    return [];
  }

  return snippet.language === "xml"
    ? xmlBuildFileDependencies(snippet.code)
    : gradleBuildFileDependencies(snippet.code);
}

/*
 * What keeps code in a language with braces - Java, Kotlin, C# - from
 * parsing: a bracket that closes the wrong one or never closes, a string
 * left open. A light reader, not a compiler: it knows comments, strings
 * with their escapes, Java's and Kotlin's and C#'s text blocks, Kotlin's
 * "${...}" templates and C#'s $"{...}" holes and @"..." strings, and char
 * literals. The end-to-end check compiles the code that runs; this holds
 * every snippet to at least this much.
 */
export function bracketProblems(
  code: string,
  language: "java" | "kotlin" | "csharp",
): Array<string> {
  const closers: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  // What is open: brackets, and the string a template hole is inside.
  const stack: Array<string> = [];
  let index: number = 0;

  // Reads a string from its opening quote; returns where it ends, or -1.
  const readString: (start: number) => number = (start: number): number => {
    const isTextBlock: boolean = code.startsWith('"""', start);
    // C#'s prefixes: @"..." takes no escapes, $"..." has {holes}, and both mix.
    const before: string = code.charAt(start - 1);
    const twoBefore: string = code.charAt(start - 2);
    const isVerbatim: boolean =
      language === "csharp" &&
      (before === "@" || (before === "$" && twoBefore === "@"));
    const isInterpolated: boolean =
      language === "csharp" &&
      (before === "$" || (before === "@" && twoBefore === "$"));
    const quote: string = isTextBlock ? '"""' : '"';
    let at: number = start + quote.length;

    while (at < code.length) {
      const character: string = code.charAt(at);

      if (!isTextBlock && character === "\n" && !isVerbatim) {
        return -1;
      }

      if (
        character === "\\" &&
        !isVerbatim &&
        !(isTextBlock && language === "csharp")
      ) {
        at += 2;
        continue;
      }

      if (isVerbatim && code.startsWith('""', at)) {
        at += 2;
        continue;
      }

      if (code.startsWith(quote, at)) {
        return at + quote.length;
      }

      // A template hole: code, with brackets and strings of its own.
      const kotlinHole: boolean =
        language === "kotlin" && code.startsWith("${", at);
      const csharpHole: boolean =
        isInterpolated && character === "{" && !code.startsWith("{{", at);

      if (isInterpolated && code.startsWith("{{", at)) {
        at += 2;
        continue;
      }

      if (kotlinHole || csharpHole) {
        let depth: number = 0;
        let hole: number = at + (kotlinHole ? 2 : 1);

        while (hole < code.length) {
          const inside: string = code.charAt(hole);

          if (inside === '"') {
            const end: number = readString(hole);
            if (end === -1) {
              return -1;
            }
            hole = end;
            continue;
          }

          if (inside === "{") {
            depth++;
          } else if (inside === "}") {
            if (depth === 0) {
              break;
            }
            depth--;
          }

          hole++;
        }

        if (hole >= code.length) {
          return -1;
        }

        at = hole + 1;
        continue;
      }

      at++;
    }

    return -1;
  };

  while (index < code.length) {
    const character: string = code.charAt(index);

    if (code.startsWith("//", index)) {
      const end: number = code.indexOf("\n", index);
      index = end === -1 ? code.length : end;
      continue;
    }

    if (code.startsWith("/*", index)) {
      const end: number = code.indexOf("*/", index + 2);

      if (end === -1) {
        return ["a comment that never closes"];
      }

      index = end + 2;
      continue;
    }

    if (character === '"') {
      const end: number = readString(index);

      if (end === -1) {
        const line: number = code.slice(0, index).split("\n").length;
        return [`a string that never closes on line ${line}`];
      }

      index = end;
      continue;
    }

    // A char literal: 'a', '\n', '\''.
    if (character === "'") {
      const end: number = code.indexOf(
        "'",
        index + (code.charAt(index + 1) === "\\" ? 3 : 2),
      );

      if (end === -1 || end - index > 8) {
        const line: number = code.slice(0, index).split("\n").length;
        return [`a character that never closes on line ${line}`];
      }

      index = end + 1;
      continue;
    }

    if (closers[character]) {
      stack.push(closers[character]!);
    } else if (character === ")" || character === "]" || character === "}") {
      const expected: string | undefined = stack.pop();

      if (expected !== character) {
        const line: number = code.slice(0, index).split("\n").length;
        return [
          expected
            ? `"${character}" on line ${line} closes what "${expected}" should`
            : `"${character}" on line ${line} closes nothing`,
        ];
      }
    }

    index++;
  }

  return stack.length > 0
    ? [`${stack.length} bracket(s) never close: ${stack.reverse().join(" ")}`]
    : [];
}

/*
 * What is not a line of a Java .properties file: each line is blank, a
 * comment (# or !), or key=value / key: value / key value.
 */
export function propertiesProblems(code: string): Array<string> {
  return code
    .split("\n")
    .filter((rawLine: string): boolean => {
      const line: string = rawLine.trim();

      return (
        line.length > 0 &&
        !line.startsWith("#") &&
        !line.startsWith("!") &&
        !line.includes("=") &&
        !line.includes(":")
      );
    })
    .map((line: string): string => {
      return `not a property line: "${line}"`;
    });
}

// What is not a line of an INI file: blank, ; or # comment, [section], key = value.
export function iniProblems(code: string): Array<string> {
  return code
    .split("\n")
    .filter((rawLine: string): boolean => {
      const line: string = rawLine.trim();

      return (
        line.length > 0 &&
        !line.startsWith(";") &&
        !line.startsWith("#") &&
        !(line.startsWith("[") && line.endsWith("]")) &&
        !line.includes("=")
      );
    })
    .map((line: string): string => {
      return `not an INI line: "${line}"`;
    });
}
