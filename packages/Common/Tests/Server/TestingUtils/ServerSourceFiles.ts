import fs from "fs";
import path from "path";

/*
 * EVERY SOURCE FILE OF THE SERVER, AS THE OUTBOUND ROUTING GUARDS READ THEM.
 *
 * OutboundAxiosRoutingGuard (#10442) holds each server file that sends with
 * axios to a route OneUptime decides, and OutboundFetchRoutingGuard (#10720)
 * each one that sends with fetch. Both read the same files, listed here
 * once: Common's server, utilities and types, the App's server feature sets,
 * ee's server, the probe, the Runner, the test server, the ingress's
 * sidecar and the marketing site (Home), which ships with every install -
 * never a browser's code, which sends through its own machine's proxy, if
 * any, nor tests and scripts.
 */

export const PACKAGES_ROOT: string = path.join(__dirname, "..", "..", "..", "..");
export const REPOSITORY_ROOT: string = path.join(PACKAGES_ROOT, "..");
export const EE_PRESENT: boolean = fs.existsSync(
  path.join(REPOSITORY_ROOT, "ee"),
);

export const SEARCHED: Array<string> = [
  path.join(PACKAGES_ROOT, "Common", "Server"),
  path.join(PACKAGES_ROOT, "Common", "Utils"),
  path.join(PACKAGES_ROOT, "Common", "Types"),
  path.join(PACKAGES_ROOT, "App", "FeatureSet"),
  path.join(PACKAGES_ROOT, "App", "Utils"),
  path.join(PACKAGES_ROOT, "Probe"),
  path.join(PACKAGES_ROOT, "Runner"),
  path.join(PACKAGES_ROOT, "TestServer"),
  path.join(PACKAGES_ROOT, "Nginx"),
  path.join(PACKAGES_ROOT, "Home"),
  path.join(REPOSITORY_ROOT, "ee", "Server"),
];

export const SKIPPED_FOLDERS: Array<string> = [
  "node_modules",
  "build",
  "dist",
  "Tests",
  "Scripts",
];

// Browser code: a browser sends through its own machine's proxy, if any.
export const SKIPPED_PATHS: Array<string> = [
  "Dashboard",
  "AdminDashboard",
  "StatusPage",
  "Accounts",
  "PublicDashboard",
  "BrowserRecorder",
  "MobileRecorder",
].map((name: string): string => {
  return path.join(PACKAGES_ROOT, "App", "FeatureSet", name);
});

export function sourceFiles(folder: string): Array<string> {
  const files: Array<string> = [];

  if (!fs.existsSync(folder)) {
    return files;
  }

  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const child: string = path.join(folder, entry.name);

    if (entry.isDirectory()) {
      if (
        !SKIPPED_FOLDERS.includes(entry.name) &&
        !SKIPPED_PATHS.includes(child)
      ) {
        files.push(...sourceFiles(child));
      }
      continue;
    }

    if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".d.ts") &&
      !entry.name.includes(".test.")
    ) {
      files.push(child);
    }
  }

  return files;
}

// Every server source file of the checkout.
export function serverSourceFiles(): Array<string> {
  return SEARCHED.flatMap(sourceFiles);
}

// A file's path from the repository's root, with forward slashes.
export function relative(file: string): string {
  return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
}

// The code of a file, its comments left out.
export function codeOf(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
