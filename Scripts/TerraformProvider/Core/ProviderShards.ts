import fs from "fs";
import path from "path";
import { FileGenerator } from "./FileGenerator";

/*
 * THE PACKAGES THE GENERATED RESOURCES AND DATA SOURCES ARE IN (#7591).
 *
 * Compiled as one package, internal/provider - some 1,000 files and 64 MB of
 * Go - took the Go compiler more than 11 GiB, near the 16 GB of a CI runner,
 * and more with every resource the provider gained: its peak went from
 * 10.6 GiB to 11.3 GiB in one week of November 2026, and no memory limit
 * takes a compile below what is live in it. Split into SHARD_COUNT
 * packages, the provider's build held about 1.5 GiB of Go at most, four
 * compiles of under 1 GiB at a time, in a third of the time, and the docs
 * step's test build as little.
 *
 * - Each generated resource and data source file goes into the shard its
 *   file name picks: the FNV-1a hash of the name, modulo SHARD_COUNT, so a
 *   file stays in its shard as others come and go. The files written by hand
 *   (StaticFiles/), the client and the provider itself stay in
 *   internal/provider.
 * - A shard imports internal/provider with a dot import, so the generated
 *   code names the helpers it uses as it would in the one package; the
 *   helpers are exported for it.
 * - Each shard hands what it holds to internal/provider from its init (the
 *   shard's resources.go and data_sources.go; StaticFiles/shards.go), and
 *   internal/provider/all imports every shard: main.go, xpprovider and the
 *   provider's tests import it.
 * - checkShardSizes stops a generation whose largest shard has grown past
 *   MAX_SHARD_BYTES: raise SHARD_COUNT then.
 *
 * The provider is the same either way: every resource and data source keeps
 * its type name, schema and import ID, and GetResources and GetDataSources
 * list them in the same order as before.
 */

// The provider's package, which the shards are folders of.
export const PROVIDER_PACKAGE_DIR: string = "internal/provider";

// The Go written by hand that goes into the provider package as it is.
const STATIC_FILES_DIR: string = path.join(__dirname, "..", "StaticFiles");

export const SHARD_COUNT: number = 32;

/*
 * The most Go source a shard may hold. Its largest was 2.8 MB of 64, and
 * compiling one of 2.6 MB held under 1 GiB; Go compiles four shards at once
 * on a 4-CPU runner.
 */
export const MAX_SHARD_BYTES: number = 6 * 1024 * 1024;

// The 32-bit FNV-1a hash of `text`'s UTF-8 bytes.
export function fnv1a32(text: string): number {
  let hash: number = 0x811c9dc5;
  for (const byte of Buffer.from(text, "utf-8")) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

// The package name of shard `index`: shard07.
export function shardName(index: number): string {
  return `shard${String(index).padStart(String(SHARD_COUNT - 1).length, "0")}`;
}

// Every shard's package name, in order.
export function shardNames(): Array<string> {
  return Array.from({ length: SHARD_COUNT }, (_: unknown, index: number) => {
    return shardName(index);
  });
}

// The shard a generated file goes into, by its file name.
export function shardOf(fileName: string): string {
  return shardName(fnv1a32(fileName) % SHARD_COUNT);
}

// Where a generated resource or data source file is, from the provider's root.
export function generatedFilePath(fileName: string): string {
  return `${PROVIDER_PACKAGE_DIR}/${shardOf(fileName)}/${fileName}`;
}

/*
 * Where any Go file of the provider package or its shards is, from the
 * provider's root: a generated resource or data source file in its shard,
 * and every other file - the client, the lists, the files written by hand in
 * StaticFiles/ and their tests - in the provider package.
 */
export function providerGoFilePath(fileName: string): string {
  const generated: boolean =
    (fileName.startsWith("resource_") || fileName.startsWith("data_source_")) &&
    !fileName.endsWith("_test.go") &&
    !fs.existsSync(path.join(STATIC_FILES_DIR, fileName));
  return generated
    ? generatedFilePath(fileName)
    : `${PROVIDER_PACKAGE_DIR}/${fileName}`;
}

/*
 * The Go files of the provider package and of every shard of the provider
 * at `providerDir`, by name, with where each is.
 */
export function providerGoFiles(providerDir: string): Map<string, string> {
  const files: Map<string, string> = new Map();
  for (const directory of [
    PROVIDER_PACKAGE_DIR,
    ...shardNames().map((shard: string) => {
      return `${PROVIDER_PACKAGE_DIR}/${shard}`;
    }),
  ]) {
    const absolute: string = path.join(providerDir, directory);
    if (!fs.existsSync(absolute)) {
      continue;
    }
    for (const file of fs.readdirSync(absolute)) {
      // The shards' own registrations share their names with the package's.
      if (file.endsWith(".go") && !files.has(file)) {
        files.set(file, `${directory}/${file}`);
      }
    }
  }
  return files;
}

// The import that gives a shard the provider package's names as its own.
export function providerDotImport(goModuleName: string): string {
  return `. "${goModuleName}/${PROVIDER_PACKAGE_DIR}"`;
}

/*
 * A shard's file that hands what it holds to internal/provider: its
 * resources ("Resources") or its data sources ("DataSources"), each with its
 * place in GetResources or GetDataSources, and the deprecated aliases among
 * them.
 */
export function shardRegistrationFile(options: {
  shard: string;
  goModuleName: string;
  kind: "Resources" | "DataSources";
  entries: Array<{ order: number; constructor: string }>;
  aliases: Array<{
    order: number;
    name: string;
    legacyName: string;
    constructor: string;
    legacyConstructor: string;
  }>;
}): string {
  const ordered: string =
    options.kind === "Resources" ? "OrderedResource" : "OrderedDataSource";
  const alias: string =
    options.kind === "Resources"
      ? "LegacyResourceAlias"
      : "LegacyDataSourceAlias";
  const what: string =
    options.kind === "Resources" ? "resources" : "data sources";

  const entries: string = options.entries.length
    ? `[]${ordered}{\n${options.entries
        .map((entry: { order: number; constructor: string }) => {
          return `        {Order: ${entry.order}, New: ${entry.constructor}},`;
        })
        .join("\n")}\n    }`
    : "nil";
  const aliases: string = options.aliases.length
    ? `[]${alias}{\n${options.aliases
        .map(
          (entry: {
            order: number;
            name: string;
            legacyName: string;
            constructor: string;
            legacyConstructor: string;
          }) => {
            return `        {Order: ${entry.order}, Name: "${entry.name}", LegacyName: "${entry.legacyName}", New: ${entry.constructor}, NewLegacy: ${entry.legacyConstructor}},`;
          },
        )
        .join("\n")}\n    }`
    : "nil";

  return `package ${options.shard}

import (
    ${providerDotImport(options.goModuleName)}
)

// The ${what} this package holds, handed to internal/provider with their
// places among the provider's, and the deprecated aliases among them (its
// shards.go).
func init() {
    Register${options.kind}("${options.shard}", ${entries}, ${aliases})
}
`;
}

/*
 * `fileName` - resources.go or data_sources.go - of the provider package and
 * of every shard of the provider at `providerDir`, one after another: the
 * resources or data sources the provider lists, each with its place.
 */
export function registrationsOf(
  providerDir: string,
  fileName: "resources.go" | "data_sources.go",
): string {
  return [
    PROVIDER_PACKAGE_DIR,
    ...shardNames().map((shard: string) => {
      return `${PROVIDER_PACKAGE_DIR}/${shard}`;
    }),
  ]
    .map((directory: string) => {
      const file: string = path.join(providerDir, directory, fileName);
      return fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : "";
    })
    .join("\n");
}

/*
 * internal/provider/all: the package that links every shard into the
 * program that imports it.
 */
export async function writeAllShardsPackage(
  fileGenerator: FileGenerator,
  goModuleName: string,
): Promise<void> {
  const imports: string = shardNames()
    .map((shard: string) => {
      return `    _ "${goModuleName}/${PROVIDER_PACKAGE_DIR}/${shard}"`;
    })
    .join("\n");

  await fileGenerator.writeFileInDir(
    `${PROVIDER_PACKAGE_DIR}/all`,
    "all.go",
    `// Package all links every package of generated resources and data sources
// into the program that imports it: they hand what they hold to
// internal/provider from their init functions (its shards.go). main.go,
// xpprovider and the provider's tests import it.
package all

import (
${imports}
)
`,
  );
}

export interface ShardSize {
  shard: string;
  bytes: number;
  files: number;
}

// How much Go source each shard of the provider at `providerDir` holds.
export function shardSizes(providerDir: string): Array<ShardSize> {
  return shardNames().map((shard: string): ShardSize => {
    const directory: string = path.join(
      providerDir,
      PROVIDER_PACKAGE_DIR,
      shard,
    );
    const files: Array<string> = fs.existsSync(directory)
      ? fs.readdirSync(directory).filter((file: string) => {
          return file.endsWith(".go");
        })
      : [];
    return {
      shard,
      files: files.length,
      bytes: files.reduce((total: number, file: string) => {
        return total + fs.statSync(path.join(directory, file)).size;
      }, 0),
    };
  });
}

/*
 * Stops a generation whose largest shard holds more than `maxBytes` of Go:
 * the split no longer keeps the compiles small, and SHARD_COUNT is to be
 * raised.
 */
export function checkShardSizes(
  providerDir: string,
  maxBytes: number = MAX_SHARD_BYTES,
): void {
  const tooLarge: Array<ShardSize> = shardSizes(providerDir).filter(
    (size: ShardSize) => {
      return size.bytes > maxBytes;
    },
  );

  if (tooLarge.length > 0) {
    const mib: (bytes: number) => string = (bytes: number): string => {
      return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
    };
    throw new Error(
      `${tooLarge
        .map((size: ShardSize) => {
          return `${PROVIDER_PACKAGE_DIR}/${size.shard} holds ${mib(size.bytes)} of Go in ${size.files} files`;
        })
        .join(
          "; ",
        )}: more than the ${mib(maxBytes)} a shard may hold to keep each compile small. Raise SHARD_COUNT in Scripts/TerraformProvider/Core/ProviderShards.ts.`,
    );
  }
}
