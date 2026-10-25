/*
 * Which build of this frontend the tab is running, and where the server says
 * which build it serves now.
 *
 * Both are written into the bundle by the frontend build itself
 * (Common/UI/esbuild-config.js: build() and watch() define them, then write
 * the same id to build.json beside the bundle). A bundle built any other way
 * - the offline browser fixtures, the jest suites - has neither, and then
 * nothing here looks for a new version: there is nothing to compare with.
 */

declare const __ONEUPTIME_BUILD_ID__: string | undefined;
declare const __ONEUPTIME_BUILD_MANIFEST_URL__: string | undefined;

export interface RunningBuild {
  // The id this tab's code was built with; empty when it has none.
  buildId: string;
  // Where the server's build.json is: the frontend's own /dist/ folder.
  manifestUrl: string;
}

export const getRunningBuild: () => RunningBuild = (): RunningBuild => {
  const buildId: string =
    typeof __ONEUPTIME_BUILD_ID__ === "string" ? __ONEUPTIME_BUILD_ID__ : "";
  const manifestUrl: string =
    typeof __ONEUPTIME_BUILD_MANIFEST_URL__ === "string"
      ? __ONEUPTIME_BUILD_MANIFEST_URL__
      : "";

  return {
    buildId: buildId,
    manifestUrl: manifestUrl,
  };
};
