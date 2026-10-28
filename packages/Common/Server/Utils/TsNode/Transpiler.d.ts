/*
 * Types of Transpiler.js, the ts-node transpiler every OneUptime server runs
 * its TypeScript with (see its header). It is JavaScript because ts-node
 * loads it before it can load TypeScript.
 */

export interface TsNodeTranspilerCreateOptions {
  service: {
    options: { compiler?: string | undefined };
    config: { options: Record<string, unknown> };
    projectLocalResolveHelper: (
      specifier: string,
      fallbackToTsNodeRelative: boolean,
    ) => string;
  };
  nodeModuleEmitKind?: "nodecjs" | "nodeesm" | undefined;
}

export interface TsNodeTranspileOutput {
  outputText: string;
  sourceMapText: string;
  diagnostics?: ReadonlyArray<unknown> | undefined;
}

export interface TsNodeTranspiler {
  transpile: (
    input: string,
    options: { fileName: string },
  ) => TsNodeTranspileOutput;
}

export interface KeptSourceMap {
  url: string;
  map: {
    version: 3;
    file: string;
    sources: Array<string>;
    names: Array<string>;
    mappings: string;
    sourcesContent?: Array<string>;
  };
}

export function create(
  createOptions: TsNodeTranspilerCreateOptions,
): TsNodeTranspiler | undefined;

export function retrieveSourceMap(source: unknown): KeptSourceMap | null;

export function keepsSourceMapsOutsideCode(): boolean;

export function keptSourceMapCount(): number;

export function keptSourceMapBytes(): number;
