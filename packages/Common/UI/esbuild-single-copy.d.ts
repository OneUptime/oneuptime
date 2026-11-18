/*
 * Types for esbuild-single-copy.js, which stays CommonJS so the frontends'
 * esbuild.config.js files and Common/Scripts/first-load-budgets.js can load
 * it as a plain node module.
 */

export interface SingleCopyPlugin {
  name: string;
  setup: (build: unknown) => void;
}

export interface SingleCopyPluginOptions {
  // Common's folder, whose install the bundle takes a shared package from.
  commonRoot?: string | undefined;
}

export interface PackageInstall {
  // The outermost node_modules an input came through, as the metafile writes it.
  install: string;
  // The bytes that install's copy put in the output.
  bytes: number;
  // Whether OneUptime's own code (a file outside every node_modules) imports this copy.
  importedByOwnCode: boolean;
}

export interface PackageFromSeveralInstalls {
  name: string;
  installs: Array<PackageInstall>;
}

// The parts of an esbuild metafile packagesFromSeveralInstalls reads.
export interface SingleCopyMetafile {
  inputs?:
    | Record<
        string,
        {
          imports?:
            | Array<{ path: string; external?: boolean | undefined }>
            | undefined;
        }
      >
    | undefined;
  outputs: Record<
    string,
    { inputs?: Record<string, { bytesInOutput?: number }> | undefined }
  >;
}

export const SINGLE_COPY_PLUGIN_NAME: string;

// Absolute: the real path of packages/Common.
export const COMMON_ROOT: string;

export function packageNameOf(specifier: string): string | null;

export function canStandIn(
  commonVersion: string | null | undefined,
  ownVersion: string | null | undefined,
  sameVersionOnly?: boolean,
): boolean;

export function installedPackageFolder(
  resolvedPath: string,
  name: string,
): string | null;

export function createSingleCopyPlugin(
  options?: SingleCopyPluginOptions,
): SingleCopyPlugin;

export function packagesFromSeveralInstalls(
  metafile: SingleCopyMetafile,
): Array<PackageFromSeveralInstalls>;
