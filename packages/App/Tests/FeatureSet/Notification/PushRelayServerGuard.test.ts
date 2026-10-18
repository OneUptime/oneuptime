import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The push relay sends with this server's Expo access token what another
 * server asks it to, and reads those pushes' receipts with it. It answers
 * only on a server that relays for others
 * (PushNotificationService.isPushRelayServer), and these rules keep every
 * way to it behind that one check:
 *
 *  - only the relay's router calls the service's relay functions, the two
 *    that act for another server with this server's Expo credentials;
 *  - in the router, the check is mounted before the first route, so a route
 *    added later cannot answer without it;
 *  - the router is mounted by the Notification feature set alone.
 */

/* <repo>/packages/App/Tests/FeatureSet/Notification -> <repo>/packages */
const PACKAGES: string = path.resolve(__dirname, "../../../..");
const REPO_ROOT: string = path.resolve(PACKAGES, "..");
const ENTERPRISE: string = path.join(REPO_ROOT, "ee");
const RELAY_ROUTER: string = path.join(
  PACKAGES,
  "App",
  "FeatureSet",
  "Notification",
  "API",
  "PushRelay.ts",
);
const NOTIFICATION_FEATURE_SET: string = path.join(
  PACKAGES,
  "App",
  "FeatureSet",
  "Notification",
  "Index.ts",
);

const SKIPPED_DIRECTORIES: Set<string> = new Set<string>([
  "node_modules",
  "build",
  "dist",
  "Tests",
  "__tests__",
  ".git",
  "public",
]);

const SOURCE_EXTENSIONS: Set<string> = new Set<string>([".ts", ".tsx"]);

// Every TypeScript source file under a directory, its tests left out.
function sourceFilesUnder(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        files.push(...sourceFilesUnder(path.join(directory, entry.name)));
      }
      continue;
    }

    if (
      entry.isFile() &&
      SOURCE_EXTENSIONS.has(path.extname(entry.name)) &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".test.tsx")
    ) {
      files.push(path.join(directory, entry.name));
    }
  }

  return files;
}

/*
 * App and Common, and the Enterprise Edition's code where it is checked out
 * (App's tests also run without ee/).
 */
const SOURCE_FILES: Array<string> = [
  ...sourceFilesUnder(path.join(PACKAGES, "App")),
  ...sourceFilesUnder(path.join(PACKAGES, "Common")),
  ...(fs.existsSync(ENTERPRISE) ? sourceFilesUnder(ENTERPRISE) : []),
];

function filesContaining(text: string): Array<string> {
  return SOURCE_FILES.filter((file: string): boolean => {
    return fs.readFileSync(file, "utf8").indexOf(text) !== -1;
  })
    .map((file: string): string => {
      return path.relative(PACKAGES, file);
    })
    .sort();
}

describe("the push relay's ways in", () => {
  test("the source tree is read at all", () => {
    expect(SOURCE_FILES.length).toBeGreaterThan(500);
    expect(SOURCE_FILES).toContain(RELAY_ROUTER);
  });

  test.each([["sendRelayPushNotification("], ["getRelayPushReceipts("]])(
    "%s is called by the relay's router alone",
    (call: string) => {
      const callers: Array<string> = filesContaining(`.${call}`);

      expect(callers).toEqual([
        path.join("App", "FeatureSet", "Notification", "API", "PushRelay.ts"),
      ]);
    },
  );

  test("in the relay's router, the relay check is mounted before every route", () => {
    const router: string = fs.readFileSync(RELAY_ROUTER, "utf8");
    const check: number = router.indexOf(
      "if (!PushNotificationService.isPushRelayServer()) {",
    );
    const mount: number = router.indexOf("router.use(");

    expect(mount).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(mount);

    for (const verb of ["get", "post", "put", "patch", "delete", "all"]) {
      const route: number = router.indexOf(`router.${verb}(`);

      if (route !== -1) {
        expect(route).toBeGreaterThan(check);
      }
    }

    expect(router.indexOf("router.post(")).toBeGreaterThan(check);
  });

  test("the check answers 404 with the relay's own sentence, and goes on only past it", () => {
    const router: string = fs.readFileSync(RELAY_ROUTER, "utf8");
    const check: number = router.indexOf(
      "if (!PushNotificationService.isPushRelayServer()) {",
    );
    const body: string = router.slice(check, router.indexOf("next();", check));

    expect(body).toContain(
      "res.status(404).json({ message: PUSH_RELAY_NOT_SERVED_MESSAGE });",
    );
    expect(body).toContain("return;");
  });

  test("the relay's router is mounted by the Notification feature set alone", () => {
    /*
     * Imported or required, from anywhere and in either quotes: a module
     * path ending in the router's name.
     */
    const importers: Array<string> = [
      ...new Set<string>([
        ...filesContaining('/PushRelay"'),
        ...filesContaining("/PushRelay'"),
      ]),
    ].sort();

    expect(importers).toEqual([
      path.join("App", "FeatureSet", "Notification", "Index.ts"),
    ]);

    const featureSet: string = fs.readFileSync(
      NOTIFICATION_FEATURE_SET,
      "utf8",
    );

    expect(featureSet).toContain(
      'app.use([`/${APP_NAME}/push-relay`, "/push-relay"], PushRelayAPI);',
    );
    expect(featureSet.split("PushRelayAPI").length - 1).toBe(2);
  });
});
