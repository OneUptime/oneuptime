/*
 * Types for esbuild-mermaid.js, which stays CommonJS so the frontends'
 * esbuild.config.js files and Common/Scripts/build-mermaid-browser.js can
 * load it as a plain node module.
 */

export interface MermaidBrowserBundleFile {
  // Relative to the directory the entry is served from, with forward slashes.
  path: string;
  text: string;
}

export interface MermaidBrowserBundle {
  // The module a page imports, e.g. "mermaid.mjs".
  entry: string;
  files: Array<MermaidBrowserBundleFile>;
  // Every input esbuild read, relative to Common.
  inputs: Array<string>;
}

export interface MermaidSourcePlugin {
  name: string;
  setup: (build: unknown) => void;
}

export const MERMAID_SOURCE_PLUGIN_NAME: string;

export const MERMAID_BROWSER_ENTRY: string;

export const MERMAID_BROWSER_CHUNK_DIRECTORY: string;

// Absolute: Common/build/mermaid-browser.
export const MERMAID_BROWSER_BUILD_DIRECTORY: string;

export function isPrebuiltMermaidBundle(filePath: string): boolean;

export function createMermaidSourcePlugin(): MermaidSourcePlugin;

export function buildMermaidBrowserBundle(
  esbuild: unknown,
): Promise<MermaidBrowserBundle>;
