// UX rule: Docs/ux/README.md#names
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * SIGNING IN AND OUT HAVE ONE NAME EACH: "Sign in" and "Sign out" (#9212).
 *
 * The status page's sign-in pages said "Sign in" since #9132, but its nav
 * still said "Log Out", the Dashboard said both "Log out" and "Sign Out",
 * and the server told status page readers "Please login…". This guard
 * reads the words people are shown and refuses "log in", "login", "log
 * out", "logout" and "logged in/out" in them:
 *
 *  - every value of every front end's English locale, and of the server's;
 *  - the messages the server sends about signing in (a named list of the
 *    files that write them), as double-quoted sentences;
 *  - the mobile app's labels;
 *  - what the English docs quote in bold: a menu item, a button, a switch.
 *
 * Some uses are not OneUptime's sign-in at all and stay, each in
 * ALLOWED with its reason: a database's or another system's "login" (a
 * credential, not an action here), "logged in this window" (written to a
 * log), and signing in to another system (Keystone, the OpenShift CLI, an
 * SMTP server). Nothing else may be added without a reason. The last
 * OneUptime name that said it, Require SSO for Login, is Require SSO to
 * Sign In since #9278; its API name requireSsoForLogin stays.
 */

const REPO_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");
const PACKAGES: string = path.join(REPO_ROOT, "packages");
const FEATURE_SETS: string = path.join(PACKAGES, "App", "FeatureSet");

const SIGN_IN_WORDS: RegExp =
  /\b(?:log ?in|login|log ?out|logout|logged (?:in|out))\b/i;

interface Allowed {
  phrase: RegExp;
  reason: string;
}

const ALLOWED: Array<Allowed> = [
  {
    phrase:
      /\b(?:a|an|one|the|its|own|any|that|dedicated|monitoring|read-only|SQL Server|administrator|application's|agent's|collector's)\s+login(?:'s)?\b|\blogin's\b/gi,
    reason:
      "A database's or another system's login: a credential the agent or collector uses, not signing in to OneUptime.",
  },
  {
    phrase: /\bLogin(?:,| or) permission\b/g,
    reason: "Another system refusing the collector's credentials.",
  },
  {
    phrase:
      /\blogged in (?:this|the)\b|\blogged in, then\b|\blog in (?:use|rail|\{\{)/gi,
    reason: "Written to a log, not signing in.",
  },
  {
    phrase:
      /\blog in to (?:this SMTP Server|Keystone)\b|\bLog in with the OpenShift CLI\b|\bhow to log in\. A read-only credential\b|\bcannot be logged in to\b|\bcredential that can log in\b|\bLogged in to project \{\{project\}\}/gi,
    reason:
      "Signing in to another system - an SMTP server, OpenStack's Keystone, the OpenShift CLI - in that system's words.",
  },
  {
    phrase: /\bvCenter (?:rejects|refused) the login\b/gi,
    reason: "VMware vCenter refusing the probe's credentials.",
  },
  {
    phrase: /^Login URL$|\bOpen at login\b|\bon device login\b/gi,
    reason:
      "Another product's own label, quoted in the docs as it reads there: Microsoft Entra's Login URL, macOS's Open at Login, Windows signing in to the device.",
  },
];

// What is left of a string once its allowed phrases are taken out.
const withoutAllowed: (text: string) => string = (text: string): string => {
  let rest: string = text;

  for (const allowed of ALLOWED) {
    rest = rest.replace(allowed.phrase, " ");
  }

  return rest;
};

const saysLogIn: (text: string) => boolean = (text: string): boolean => {
  return SIGN_IN_WORDS.test(withoutAllowed(text));
};

const collectStrings: (value: unknown, into: Array<string>) => Array<string> = (
  value: unknown,
  into: Array<string>,
): Array<string> => {
  if (typeof value === "string") {
    into.push(value);
  } else if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) {
      collectStrings(child, into);
    }
  }

  return into;
};

const englishLocaleFiles: () => Array<string> = (): Array<string> => {
  const files: Array<string> = [];

  for (const featureSet of fs.readdirSync(FEATURE_SETS)) {
    for (const relative of ["src/Locales/en.json", "Locales/en.json"]) {
      const file: string = path.join(FEATURE_SETS, featureSet, relative);

      if (fs.existsSync(file)) {
        files.push(file);
      }
    }
  }

  files.push(path.join(PACKAGES, "Common", "Server", "Locales", "en.json"));

  return files;
};

// The files that write what the server says to a person about signing in.
const SERVER_MESSAGE_FILES: Array<string> = [
  "Common/Server/Services/StatusPageService.ts",
  "Common/Server/Middleware/UserAuthorization.ts",
  "Common/Server/Middleware/ProjectAuthorization.ts",
  "Common/Server/API/ProjectAPI.ts",
  "Common/Server/API/UserPushAPI.ts",
  "Common/Server/Services/ProjectService.ts",
  "Common/Types/BaseDatabase/DatabaseCommonInteractionPropsUtil.ts",
  "Common/Types/StatusPage/StatusPageSignInMessages.ts",
  "Common/Types/StatusPage/StatusPageMagicLink.ts",
  "Common/Types/Accounts/SignInMessages.ts",
  "App/FeatureSet/Identity/API/Authentication.ts",
  "App/FeatureSet/Identity/API/StatusPageAuthentication.ts",
  "App/FeatureSet/Dashboard/src/Components/Slack/SlackIntegration.tsx",
  "App/FeatureSet/Dashboard/src/Components/MicrosoftTeams/MicrosoftTeamsIntegration.tsx",
];

/*
 * What a person is told: the string an exception is made with, a `message:`
 * a response carries, or a shared *_MESSAGE constant. Log lines, route
 * paths ("/login") and identifiers are not.
 */
const sentencesIn: (source: string) => Array<string> = (
  source: string,
): Array<string> => {
  return Array.from(
    source.matchAll(
      /(?:new \w*Exception\(\s*|\bmessage:\s*|_MESSAGE(?::\s*string)?\s*=\s*)"((?:[^"\\\n]|\\.)*)"/g,
    ),
  ).map((match: RegExpMatchArray): string => {
    return match[1]!;
  });
};

const filesUnder: (dir: string, pattern: RegExp) => Array<string> = (
  dir: string,
  pattern: RegExp,
): Array<string> => {
  const found: Array<string> = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) {
      continue;
    }

    const full: string = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      found.push(...filesUnder(full, pattern));
    } else if (pattern.test(entry.name)) {
      found.push(full);
    }
  }

  return found;
};

interface BoldLabel {
  page: string;
  text: string;
}

// What the English docs quote in bold: a menu item, a button, a switch.
const englishDocsBoldLabels: () => Array<BoldLabel> = (): Array<BoldLabel> => {
  return filesUnder(
    path.join(FEATURE_SETS, "Docs", "Content", "en"),
    /\.md$/,
  ).flatMap((page: string): Array<BoldLabel> => {
    return Array.from(
      fs.readFileSync(page, "utf8").matchAll(/\*\*([^*\n]+)\*\*/g),
    ).map((match: RegExpMatchArray): BoldLabel => {
      return { page: path.relative(PACKAGES, page), text: match[1]! };
    });
  });
};

describe("the guard itself", () => {
  test.each([
    "Log Out",
    "Log out",
    "Logout",
    "Please login to continue.",
    "Session expired. Please log in again.",
    "Looks like you are not logged in.",
    // The setting's old names (#9278).
    "Require SSO for Login",
    "Force SSO for Login",
  ])("refuses %j", (text: string) => {
    expect(saysLogIn(text)).toBe(true);
  });

  test.each([
    "Sign Out",
    "Sign in to view {{statusPageName}}.",
    "Use a read-only login.",
    "Nothing was logged in the selected time range.",
    "Require SSO to Sign In",
    "OneLogin",
  ])("lets %j through", (text: string) => {
    expect(saysLogIn(text)).toBe(false);
  });

  test("every allowed phrase says why", () => {
    for (const allowed of ALLOWED) {
      expect(allowed.reason.length).toBeGreaterThan(20);
    }
  });

  test("every allowed phrase is still needed", () => {
    const everything: Array<string> = [
      ...englishLocaleFiles().flatMap((file: string): Array<string> => {
        return collectStrings(JSON.parse(fs.readFileSync(file, "utf8")), []);
      }),
      ...englishDocsBoldLabels().map((label: BoldLabel): string => {
        return label.text;
      }),
    ];

    for (const allowed of ALLOWED) {
      const isUsed: boolean = everything.some((text: string): boolean => {
        allowed.phrase.lastIndex = 0;
        return allowed.phrase.test(text);
      });

      allowed.phrase.lastIndex = 0;
      expect({ phrase: allowed.phrase.source, isUsed }).toEqual({
        phrase: allowed.phrase.source,
        isUsed: true,
      });
    }
  });
});

describe("no English word on screen says log in or log out", () => {
  test("there are locales to read", () => {
    expect(englishLocaleFiles().length).toBeGreaterThanOrEqual(6);
  });

  test.each(
    englishLocaleFiles().map((file: string): [string, string] => {
      return [path.relative(PACKAGES, file), file];
    }),
  )("%s", (_name: string, file: string) => {
    const offending: Array<string> = collectStrings(
      JSON.parse(fs.readFileSync(file, "utf8")),
      [],
    ).filter(saysLogIn);

    expect(offending).toEqual([]);
  });
});

describe("the server's messages about signing in say sign in", () => {
  test.each(SERVER_MESSAGE_FILES)("%s", (relative: string) => {
    const file: string = path.join(PACKAGES, relative);

    expect(fs.existsSync(file)).toBe(true);

    const offending: Array<string> = sentencesIn(
      fs.readFileSync(file, "utf8"),
    ).filter(saysLogIn);

    expect(offending).toEqual([]);
  });

  test("the status page's messages are the shared sentences, saying sign in", () => {
    const service: string = fs.readFileSync(
      path.join(PACKAGES, "Common/Server/Services/StatusPageService.ts"),
      "utf8",
    );
    const identity: string = fs.readFileSync(
      path.join(
        PACKAGES,
        "App/FeatureSet/Identity/API/StatusPageAuthentication.ts",
      ),
      "utf8",
    );

    expect(service).toContain(
      "new NotAuthenticatedException(STATUS_PAGE_SIGN_IN_TO_VIEW_MESSAGE)",
    );
    expect(identity).toContain("message: STATUS_PAGE_SESSION_EXPIRED_MESSAGE,");
    expect(identity).toContain("message: STATUS_PAGE_SIGNED_OUT_MESSAGE,");
  });
});

describe("the mobile app's labels say sign in and sign out", () => {
  const screens: Array<string> = filesUnder(
    path.join(PACKAGES, "MobileApp", "src"),
    /^(?!.*\.test\.).*\.tsx$/,
  );

  test("there are screens to read", () => {
    expect(screens.length).toBeGreaterThan(10);
  });

  test("no title, label or button text says log in or log out", () => {
    const offending: Array<string> = [];

    for (const file of screens) {
      const source: string = fs.readFileSync(file, "utf8");

      for (const match of source.matchAll(
        /\b(?:title|label|text|accessibilityLabel|subtitle)\s*[:=]\s*\{?\s*(?:[^"\n]*\?\s*"[^"]*"\s*:\s*)?"([^"]+)"/g,
      )) {
        if (saysLogIn(match[1]!)) {
          offending.push(`${path.relative(PACKAGES, file)}: ${match[1]}`);
        }
      }

      for (const match of source.matchAll(/Alert\.alert\(\s*"([^"]+)"/g)) {
        if (saysLogIn(match[1]!)) {
          offending.push(`${path.relative(PACKAGES, file)}: ${match[1]}`);
        }
      }
    }

    expect(offending).toEqual([]);
  });
});

describe("the English docs quote sign in and sign out", () => {
  const labels: Array<BoldLabel> = englishDocsBoldLabels();

  test("there are labels to read", () => {
    expect(labels.length).toBeGreaterThan(500);
  });

  test("no bold label - a menu item, button or switch - says log in or log out", () => {
    expect(
      labels
        .filter((label: BoldLabel): boolean => {
          return saysLogIn(label.text);
        })
        .map((label: BoldLabel): string => {
          return `${label.page}: ${label.text}`;
        }),
    ).toEqual([]);
  });

  test("the pages that name signing out say Sign Out", () => {
    const say: (page: string) => string = (page: string): string => {
      return fs.readFileSync(
        path.join(FEATURE_SETS, "Docs", "Content", "en", page),
        "utf8",
      );
    };

    expect(say("introduction/your-account.md")).toContain(
      "| **Sign Out** | Signs you out, at once on every OneUptime server.",
    );
    expect(say("status-pages/index.md")).toContain(
      "A private page also gets a **Sign Out** item.",
    );
    expect(say("mobile-desktop-apps/ios-installation.md")).toContain(
      "**Settings → Sign Out**",
    );
  });
});
