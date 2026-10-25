/*
 * Types for BuildNpmPackage.js, which stays plain CommonJS so the release
 * (Scripts/NPM/PublishAllPackages.sh, through `npm run build-npm-package`)
 * runs it with node alone. Its tests import it through these.
 */

import type * as TypeScript from "typescript";

export interface RootExport {
  // The name the package root exports it under.
  name: string;
  // The module it comes from, by its path from Common's root.
  module: string;
  // The module's export it is: "default" when not given.
  export?: string;
  // It exists for TypeScript alone, not when the code runs.
  typeOnly?: boolean;
}

export interface ModuleReferences {
  // The modules it names, by id.
  modules: Array<string>;
  // The packages it names (Node.js's own left out).
  packages: Array<string>;
  // The relative specifiers that name no module.
  unresolved: Array<string>;
}

export interface LeftOutModule {
  module: string;
  reason: string;
}

export interface ModuleSelection {
  published: Array<string>;
  leftOut: Array<LeftOutModule>;
}

export interface DeclarationSelection {
  files: Array<string>;
  packages: Record<string, Array<string>>;
  problems: Array<string>;
}

export interface SpecifierPosition {
  text: string;
  start: number;
  end: number;
}

export interface ExportedNames {
  hasDefault: boolean;
  names: Array<string>;
}

export interface NamesUsed {
  all: boolean;
  names: Set<string>;
}

export interface ExportConditions {
  import: { types: string; default: string };
  require: { types: string; default: string };
}

export type ExportsMap = Record<string, ExportConditions | string | null>;

export interface SourceManifest {
  name: string;
  version: string;
  repository?: Record<string, string>;
  author?: string;
  license?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export interface PackageManifest {
  name: string;
  version: string;
  description: string;
  homepage: string;
  repository: Record<string, string>;
  bugs: { url: string };
  author: string | undefined;
  license: string | undefined;
  engines: { node: string };
  main: string;
  types: string;
  exports: ExportsMap;
  files: Array<string>;
  dependencies: Record<string, string>;
}

export interface BuildOptions {
  sourceRoot?: string;
  buildDirectory?: string;
  typescript?: typeof TypeScript;
  leftOut?: Record<string, string>;
  rootExports?: ReadonlyArray<RootExport>;
  licenseFile?: string;
  readmeFile?: string;
  // How long loading the published modules may take, in milliseconds.
  readExportsTimeoutMs?: number;
}

export interface BuildReport {
  packageDirectory: string;
  manifest: PackageManifest;
  compiled: { rootFiles: number; programFiles: number };
  published: Array<string>;
  leftOut: Array<LeftOutModule>;
  typeOnlyDeclarations: Array<string>;
  prunedDeclarations: Array<string>;
  typeOnlyPackages: Array<string>;
  size: { files: number; bytes: number };
}

export const COMMON_ROOT: string;
export const BUILD_DIRECTORY: string;
export const PACKAGE_DIRECTORY: string;
export const PUBLIC_DIRECTORIES: ReadonlyArray<string>;
export const PUBLIC_FILES: ReadonlyArray<string>;
export const LEFT_OUT: Readonly<Record<string, string>>;
export const ROOT_EXPORTS: ReadonlyArray<RootExport>;
export const NODE_ENGINE: string;

export function moduleIdOf(file: string): string;
export function isCandidateModule(id: string): boolean;
export function isBuiltinModule(specifier: string): boolean;
export function packageNameOf(specifier: string): string;
export function resolveRelativeModule(
  fromId: string,
  specifier: string,
  exists: (id: string) => boolean,
): string | null;
export function relativeSpecifier(
  fromId: string,
  toId: string,
  extension: string,
): string;
export function requiredSpecifiers(
  ts: typeof TypeScript,
  fileName: string,
  text: string,
): Array<string>;
export function declarationSpecifiers(
  ts: typeof TypeScript,
  fileName: string,
  text: string,
): Array<SpecifierPosition>;
export function declaredExports(
  ts: typeof TypeScript,
  fileName: string,
  text: string,
): Set<string>;
export function esModuleDeclaration(
  ts: typeof TypeScript,
  fromId: string,
  text: string,
  names: {
    exists: (id: string) => boolean;
    packageSpecifier?: (specifier: string) => string;
  },
): string;
export function esModulePackageSpecifiers(
  ts: typeof TypeScript,
  fromDirectory: string,
): (specifier: string) => string;
export function esModuleWrapper(id: string, exported: ExportedNames): string;
export function namesUsedFrom(
  ts: typeof TypeScript,
  fileName: string,
  text: string,
  isTarget: (specifier: string) => boolean,
): NamesUsed;
export function pruneDeclaration(
  ts: typeof TypeScript,
  fileName: string,
  text: string,
  used: Set<string>,
): string;
export function rootEntryFiles(
  rootExports: ReadonlyArray<RootExport>,
): Record<string, string>;
export function exportsMap(modules: {
  publishedFiles: Array<string>;
  leftOut: Array<string>;
}): ExportsMap;
export function packageManifest(parts: {
  source: SourceManifest;
  dependencies: Record<string, string>;
  exports: ExportsMap;
  files: Array<string>;
}): PackageManifest;
export function compileRoots(sourceRoot: string): Array<string>;
export function selectModules(input: {
  candidates: Array<string>;
  requiresOf: (id: string) => ModuleReferences;
  dependencies: Record<string, string>;
  leftOut: Record<string, string>;
}): ModuleSelection;
export function selectDeclarations(input: {
  published: Array<string>;
  declarations: Set<string>;
  referencesOf: (id: string) => ModuleReferences;
}): DeclarationSelection;
export function selectDependencies(input: {
  published: Array<string>;
  requiresOf: (id: string) => ModuleReferences;
  dependencies: Record<string, string>;
}): Record<string, string>;
export function verifyPackage(
  ts: typeof TypeScript,
  packageDirectory: string,
): Array<string>;
export function buildNpmPackage(options?: BuildOptions): BuildReport;
export function describeBuild(report: BuildReport): string;
