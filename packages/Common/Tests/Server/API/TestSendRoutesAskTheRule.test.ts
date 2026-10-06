import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";

/*
 * Every route that sends a test asks the one rule (Server/API/TestSendAccess)
 * - and a new one cannot be added without saying which rule it asks.
 *
 * The scan reads every API source on the server - Common's, the App's
 * feature sets' and the Enterprise Edition's - finds each route whose path
 * names a test send ("/test", "/test/:id", "send-test", "test-notification",
 * "test-email-report"), and holds it to the rule its kind asks:
 *
 *  - project:  a test of something a project creates (a notification rule,
 *              a summary, an SMTP or Twilio config, a channel or chat). The
 *              handler calls TestSendAccess.assertMaySendTest exactly once,
 *              before it reads anything as OneUptime or sends;
 *  - setting:  a test of a setting of a record (a status page's email
 *              report): TestSendAccess.assertMaySendTestOfSetting, once;
 *  - self:     a test a person sends to their own notification method or
 *              inbox: TestSendAccess.assertMaySendTestToSelf or getCaller;
 *  - instance: a test of the instance's own setup (WhatsApp, Telegram,
 *              broadcast email), a master administrator's: the route runs
 *              MasterAdminAuthorization and never bills a project the request
 *              names;
 *  - check:    a connection check that sends nobody a message (an LLM
 *              provider, a data source, a security event connection, a
 *              cluster's AI access, the Teams bot's configuration). Each
 *              keeps its own rule; listed so a new one is a decision, not an
 *              accident.
 *
 * A route the scan finds that the table does not list fails, and so does an
 * entry the scan no longer finds.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");

type Rule = "project" | "setting" | "self" | "instance" | "check";

interface KnownTestRoute {
  file: string;
  // The route's path as written, `${...}` parts dropped.
  path: string;
  rule: Rule;
  why: string;
}

const KNOWN_TEST_ROUTES: ReadonlyArray<KnownTestRoute> = [
  {
    file: "packages/Common/Server/API/WorkspaceNotificationRuleAPI.ts",
    path: "/test/:workspaceNotifcationRuleId",
    rule: "project",
    why: "Test Rule posts a rule's test message into its channels.",
  },
  {
    file: "packages/Common/Server/API/WorkspaceNotificationSummaryAPI.ts",
    path: "/test/:workspaceNotificationSummaryId",
    rule: "project",
    why: "Send Test Now posts a summary into its channels.",
  },
  {
    file: "packages/Common/Server/API/SlackAPI.ts",
    path: "/slack/channels/test",
    rule: "project",
    why: "Posts into a Slack channel, as a notification rule does.",
  },
  {
    file: "packages/Common/Server/API/MicrosoftTeamsAPI.ts",
    path: "/microsoft-teams/channels/test",
    rule: "project",
    why: "Posts into a Teams channel, as a notification rule does.",
  },
  {
    file: "packages/Common/Server/API/MicrosoftTeamsAPI.ts",
    path: "/microsoft-teams/chats/test",
    rule: "project",
    why: "Posts into a Teams chat, as a notification rule does.",
  },
  {
    file: "packages/App/FeatureSet/Notification/API/SMTPConfig.ts",
    path: "/test",
    rule: "project",
    why: "Sends an email through a project's own SMTP server.",
  },
  {
    file: "packages/App/FeatureSet/Notification/API/SMS.ts",
    path: "/test",
    rule: "project",
    why: "Sends an SMS through a project's own Twilio account.",
  },
  {
    file: "packages/App/FeatureSet/Notification/API/Call.ts",
    path: "/test",
    rule: "project",
    why: "Places a call through a project's own Twilio account.",
  },
  {
    file: "packages/Common/Server/API/StatusPageAPI.ts",
    path: "/test-email-report",
    rule: "setting",
    why: "Sends a status page's email report, a setting of the page.",
  },
  {
    file: "packages/Common/Server/API/UserSlackAPI.ts",
    path: "/test",
    rule: "self",
    why: "A direct message to the caller's own Slack account.",
  },
  {
    file: "packages/Common/Server/API/UserMicrosoftTeamsAPI.ts",
    path: "/test",
    rule: "self",
    why: "A direct message to the caller's own Teams account.",
  },
  {
    file: "packages/Common/Server/API/UserWebhookAPI.ts",
    path: "/test",
    rule: "self",
    why: "A request to the caller's own webhook.",
  },
  {
    file: "packages/Common/Server/API/UserPushAPI.ts",
    path: "/user-push/:deviceId/test-notification",
    rule: "self",
    why: "A push to the caller's own device.",
  },
  {
    file: "packages/App/FeatureSet/Notification/API/SubscriberNotificationPreview.ts",
    path: "SubscriberNotificationPreview.sendTestPath",
    rule: "self",
    why: "A status page's email, to the caller's own verified inbox.",
  },
  {
    file: "packages/App/FeatureSet/Notification/API/WhatsApp.ts",
    path: "/test",
    rule: "instance",
    why: "Tests the instance's WhatsApp setup.",
  },
  {
    file: "packages/App/FeatureSet/Notification/API/Telegram.ts",
    path: "/test",
    rule: "instance",
    why: "Tests the instance's Telegram bot.",
  },
  {
    file: "packages/App/FeatureSet/Notification/API/BroadcastEmail.ts",
    path: "/send-test",
    rule: "instance",
    why: "A broadcast email's test, from the Admin Dashboard.",
  },
  {
    file: "packages/Common/Server/API/LlmProviderAPI.ts",
    path: "/test",
    rule: "check",
    why: "Asks an LLM provider for a reply; sends nobody a message.",
  },
  {
    file: "packages/Common/Server/API/DataSourceAPI.ts",
    path: "/test",
    rule: "check",
    why: "Connects to a data source; sends nobody a message.",
  },
  {
    file: "packages/Common/Server/API/SecurityEventConnectionAPI.ts",
    path: "/test",
    rule: "check",
    why: "Reads from a security event source; sends nobody a message.",
  },
  {
    file: "packages/Common/Server/API/KubernetesClusterAiAccessAPI.ts",
    path: "/kubernetes-cluster/ai-access/test",
    rule: "check",
    why: "Runs a read-only command through a cluster's agent.",
  },
  {
    file: "packages/Common/Server/API/MicrosoftTeamsAPI.ts",
    path: "/microsoft-bot/test",
    rule: "check",
    why: "Reports which bot this deployment is configured as.",
  },
];

// The calls that send a test to the caller's own method.
const SELF_TEST_SENDS: ReadonlyArray<string> = [
  "sendDirectMessageToUser(",
  "deliverTestWebhook(",
  "sendPushNotification(",
];

// The directories whose sources register API routes.
const SCANNED_ROOTS: ReadonlyArray<string> = [
  "packages/Common/Server/API",
  "packages/App/FeatureSet",
  "ee/Server",
];

const ROUTE_REGISTRATION: RegExp =
  /\b(?:router|this\.router)\s*\.\s*(?:get|post|put|patch|delete)\s*\(\s*(`[^`]*`|"[^"]*"|'[^']*'|[A-Za-z_][\w.]*)/g;

const TEST_SEND_PATH: RegExp =
  /(^|\/)test(\/|$)|send-test|test-notification|test-email-report|sendTestPath/i;

interface FoundRoute {
  file: string;
  path: string;
  // The registration and its handler, up to the next registration.
  source: string;
}

const listSources: (directory: string) => Array<string> = (
  directory: string,
): Array<string> => {
  const absolute: string = path.join(REPO_ROOT, directory);

  if (!fs.existsSync(absolute)) {
    return [];
  }

  const files: Array<string> = [];

  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const relative: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === "Tests" ||
        entry.name === "build" ||
        entry.name === "dist" ||
        entry.name === "src"
      ) {
        continue;
      }

      files.push(...listSources(relative));
      continue;
    }

    if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      files.push(relative);
    }
  }

  return files;
};

const normalizePath: (raw: string) => string = (raw: string): string => {
  if (raw.startsWith("`") || raw.startsWith('"') || raw.startsWith("'")) {
    return raw.slice(1, -1).replace(/\$\{[^`]*?\}(?=\/|$)/g, "");
  }

  return raw;
};

const findTestRoutes: () => Array<FoundRoute> = (): Array<FoundRoute> => {
  const found: Array<FoundRoute> = [];

  for (const root of SCANNED_ROOTS) {
    for (const file of listSources(root)) {
      const text: string = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
      const registrations: Array<{ index: number; path: string }> = [];

      for (const match of text.matchAll(ROUTE_REGISTRATION)) {
        registrations.push({
          index: match.index || 0,
          path: normalizePath(match[1] || ""),
        });
      }

      registrations.forEach(
        (registration: { index: number; path: string }, position: number) => {
          if (!TEST_SEND_PATH.test(registration.path)) {
            return;
          }

          const end: number =
            position + 1 < registrations.length
              ? registrations[position + 1]!.index
              : text.length;

          found.push({
            file: file.split(path.sep).join("/"),
            path: registration.path,
            source: text.slice(registration.index, end),
          });
        },
      );
    }
  }

  return found;
};

const FOUND: Array<FoundRoute> = findTestRoutes();

const key: (route: { file: string; path: string }) => string = (route: {
  file: string;
  path: string;
}): string => {
  return `${route.file} ${route.path}`;
};

const countOf: (source: string, needle: string) => number = (
  source: string,
  needle: string,
): number => {
  return source.split(needle).length - 1;
};

const sourceOf: (route: KnownTestRoute) => string = (
  route: KnownTestRoute,
): string => {
  const match: FoundRoute | undefined = FOUND.find(
    (candidate: FoundRoute): boolean => {
      return key(candidate) === key(route);
    },
  );

  if (!match) {
    throw new Error(`${key(route)} was not found by the scan`);
  }

  return match.source;
};

describe("every route that sends a test asks the one rule", () => {
  test("the scan finds the test routes it is meant to (it is not vacuous)", () => {
    expect(FOUND.length).toBeGreaterThanOrEqual(KNOWN_TEST_ROUTES.length);
  });

  test("every test route on the server is listed with the rule it asks", () => {
    const known: Array<string> = KNOWN_TEST_ROUTES.map(key);
    const unlisted: Array<string> = FOUND.map(key).filter(
      (found: string): boolean => {
        return !known.includes(found);
      },
    );

    expect(unlisted).toEqual([]);
  });

  test("every listed route still exists", () => {
    const found: Array<string> = FOUND.map(key);
    const stale: Array<string> = KNOWN_TEST_ROUTES.map(key).filter(
      (known: string): boolean => {
        return !found.includes(known);
      },
    );

    expect(stale).toEqual([]);
  });

  test.each(
    KNOWN_TEST_ROUTES.filter((route: KnownTestRoute): boolean => {
      return route.rule === "project";
    }),
  )(
    "$file $path asks the project rule once, before reading anything as OneUptime or sending",
    (route: KnownTestRoute) => {
      const source: string = sourceOf(route);

      expect(countOf(source, "TestSendAccess.assertMaySendTest(")).toBe(1);

      const ruleAt: number = source.indexOf(
        "TestSendAccess.assertMaySendTest(",
      );
      const rootReadAt: number = source.indexOf("isRoot: true");

      // Anything read as OneUptime - the secrets a send needs - comes after.
      expect(rootReadAt === -1 || rootReadAt > ruleAt).toBe(true);

      // The rule reads the caller's props itself; the route asks nothing else.
      expect(source).not.toContain("getDatabaseCommonInteractionProps(");
      expect(source).not.toContain("assertAuthenticatedProjectMember(");
    },
  );

  test.each(
    KNOWN_TEST_ROUTES.filter((route: KnownTestRoute): boolean => {
      return route.rule === "setting";
    }),
  )(
    "$file $path asks the setting rule once, before sending",
    (route: KnownTestRoute) => {
      const source: string = sourceOf(route);

      expect(
        countOf(source, "TestSendAccess.assertMaySendTestOfSetting("),
      ).toBe(1);
      expect(source).not.toContain("getDatabaseCommonInteractionProps(");
    },
  );

  test.each(
    KNOWN_TEST_ROUTES.filter((route: KnownTestRoute): boolean => {
      return route.rule === "self";
    }),
  )(
    "$file $path asks the send-to-self rule, which refuses a read-only credential",
    (route: KnownTestRoute) => {
      const source: string = sourceOf(route);

      const asksToSelf: number = countOf(
        source,
        "TestSendAccess.assertMaySendTestToSelf(",
      );

      expect(asksToSelf + countOf(source, "TestSendAccess.getCaller(")).toBe(1);

      if (asksToSelf === 0) {
        // getCaller: a member of the project the request names already.
        return;
      }

      /*
       * A method of the caller's own is sent in its project: after the
       * method is read, and before anything is sent, the caller must still
       * be a member there.
       */
      expect(countOf(source, "TestSendAccess.assertSenderIsMemberOf(")).toBe(1);

      const readAt: number = source.indexOf("findOneById(");
      const memberAt: number = source.indexOf(
        "TestSendAccess.assertSenderIsMemberOf(",
      );
      const sendAt: number = Math.min(
        ...SELF_TEST_SENDS.map((send: string): number => {
          const at: number = source.indexOf(send);
          return at === -1 ? Number.MAX_SAFE_INTEGER : at;
        }),
      );

      expect(readAt).toBeGreaterThan(-1);
      expect(memberAt).toBeGreaterThan(readAt);
      expect(sendAt).toBeLessThan(Number.MAX_SAFE_INTEGER);
      expect(memberAt).toBeLessThan(sendAt);
    },
  );

  test.each(
    KNOWN_TEST_ROUTES.filter((route: KnownTestRoute): boolean => {
      return route.rule === "instance";
    }),
  )(
    "$file $path is a master administrator's, and bills no project the request names",
    (route: KnownTestRoute) => {
      const source: string = sourceOf(route);

      expect(source).toContain(
        "MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware",
      );
      expect(source).not.toContain('body["projectId"]');
    },
  );

  test("every entry says why it is the kind it is", () => {
    for (const route of KNOWN_TEST_ROUTES) {
      expect([key(route), route.why.length > 10]).toEqual([key(route), true]);
    }
  });
});
