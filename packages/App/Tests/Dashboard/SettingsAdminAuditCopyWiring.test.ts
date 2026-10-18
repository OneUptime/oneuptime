import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The smaller fixes of the settings / admin simplicity audit, held as the
 * source writes them (App tests run in plain Node and read no React
 * module; the pages' behaviour is covered against a DOM in Common/Tests):
 *
 *   - copy that said less than it took to read, or said it twice;
 *   - tables that drew the same column twice, or columns that do not tell
 *     one row from another;
 *   - a typo in a field's name;
 *   - a banner that repeated the card under it.
 */

const APP: string = path.join(__dirname, "..", "..", "FeatureSet");
const DASHBOARD: string = path.join(APP, "Dashboard", "src");
const ADMIN: string = path.join(APP, "AdminDashboard", "src");

// Source with comments dropped and whitespace collapsed.
function read(...segments: Array<string>): string {
  return fs
    .readFileSync(path.join(...segments), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\s+/g, " ");
}

function countOf(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

describe("Project Settings > Domains", () => {
  const page: string = read(DASHBOARD, "Pages", "Settings", "Domains.tsx");

  test("adds a domain you own, rather than creating one", () => {
    expect(page).toContain('createVerb="Add"');
  });

  test("says what the domains are for, and what to do once one is added", () => {
    expect(page).toContain(
      '"Domains you own. Verify one with a TXT record to use it for a status page or dashboard address."',
    );
    expect(page).toContain(
      '"A domain you own. Once it is added, verify it from its row."',
    );
    expect(page).not.toContain("Please list the domains you own here");
  });
});

describe("Project Settings > Labels", () => {
  const page: string = read(DASHBOARD, "Pages", "Settings", "Labels.tsx");

  test("says what labels are for, in a line", () => {
    expect(page).toContain(
      '"Group resources with labels. A team\'s permission can reach only the resources with certain labels."',
    );
    expect(page).not.toContain("Labels help you categorize resources");
  });
});

describe("the welcome page of someone who may not create a project", () => {
  const page: string = read(DASHBOARD, "Pages", "Onboarding", "Welcome.tsx");

  test("says what to do, not that something is restricted", () => {
    expect(page).toContain('title={"Ask to join a project"}');
    expect(page).toContain(
      '"Only admins can create projects on this server. Ask your server admin to add you to one."',
    );
    expect(page).not.toContain("Project creation restricted");
  });
});

describe("Users > Invite User", () => {
  const page: string = read(DASHBOARD, "Pages", "Users", "Index.tsx");

  test("asks a newcomer's name in a line", () => {
    expect(page).toContain(
      '"They have no OneUptime account yet. It is set up with this name."',
    );
    expect(page).not.toContain("we will use it to set up their new account");
  });
});

describe("Project Settings > Danger Zone", () => {
  const page: string = read(DASHBOARD, "Pages", "Settings", "DangerZone.tsx");

  test("draws no red banner repeating the Delete Project card", () => {
    expect(page).not.toContain('strongTitle="DANGER ZONE"');
    expect(page).not.toContain("there is no way to recover");
  });
});

describe("Project Settings > Usage History", () => {
  const page: string = read(DASHBOARD, "Pages", "Settings", "UsageHistory.tsx");

  test("draws Data Ingested once", () => {
    expect(countOf(page, 'title: "Data Ingested (in GB)"')).toBe(1);
    expect(countOf(page, "dataIngestedInGB: true")).toBe(1);
    expect(countOf(page, 'title: "Data Retention (in Days)"')).toBe(1);
  });
});

describe("Project Settings > Custom SMTP", () => {
  const table: string = read(
    DASHBOARD,
    "Components",
    "CustomSMTP",
    "CustomSMTPTable.tsx",
  );

  test("says what the configs are for, and where a status page picks one", () => {
    expect(table).toContain(
      '"Send this project\'s email through your own mail server. A status page picks one under Subscriber Settings."',
    );
    expect(table).not.toContain(
      "If you need OneUptime to send emails through your SMTP Server",
    );
  });

  test("tells configs apart by name, server and sender: the rest is in the Edit dialog", () => {
    const columns: string = table.slice(table.indexOf("columns={["));

    expect(columns).toContain('title: "Name"');
    expect(columns).toContain('title: "Server Host"');
    expect(columns).toContain('title: "From Email"');
    expect(columns).not.toContain('title: "Auth Type"');
    expect(columns).not.toContain('title: "Transport"');
    expect(columns).not.toContain('title: "Description"');
  });
});

describe("Project Settings > Call and SMS", () => {
  const table: string = read(
    DASHBOARD,
    "Components",
    "CallSMS",
    "CallSMSConfigTable.tsx",
  );

  test("names the secondary numbers field without the typo", () => {
    expect(table).not.toContain("Twilio Secondary Primary Phone Numbers");
    expect(table).toContain('title: "Twilio Secondary Phone Numbers"');
  });

  test("tells configs apart by name, account, number and default", () => {
    const columns: string = table.slice(table.indexOf("columns={["));

    expect(
      [...columns.matchAll(/title: "([^"]+)", type: FieldType/g)].map(
        (match: RegExpMatchArray): string => {
          return match[1] as string;
        },
      ),
    ).toEqual([
      "Name",
      "Twilio Account SID",
      "Primary Twilio Phone Number",
      "Project Default",
    ]);
  });
});

describe("an API key's expiry", () => {
  test("says what it does, on the key's page", () => {
    expect(read(DASHBOARD, "Pages", "Settings", "APIKeyView.tsx")).toContain(
      'description: "The key stops working on this date."',
    );
  });
});

describe("Admin Dashboard", () => {
  test("Settings > API Key says what the master key reaches, and what turning it off does", () => {
    const page: string = read(
      ADMIN,
      "Pages",
      "Settings",
      "APIKey",
      "Index.tsx",
    );

    expect(page).toContain(
      'description: "Has root access to every project on this server."',
    );
    expect(page).toContain(
      'description: "While it is off, every request with the key fails."',
    );
  });

  test("Settings > Email says where OneUptime writes about the server", () => {
    expect(read(ADMIN, "Pages", "Settings", "Email", "Index.tsx")).toContain(
      '"Where OneUptime writes about this server, such as when a probe goes offline."',
    );
  });

  test.each([
    ["GlobalSSO", "Global SSO"],
    ["GlobalOIDC", "Global OIDC"],
  ])(
    "Settings > %s attaches projects, rather than creating them",
    (folder: string, name: string) => {
      const page: string = read(ADMIN, "Pages", "Settings", folder, "View.tsx");

      expect(page).toContain('createVerb="Attach"');
      expect(page).toContain('createFormTitle="Attach a Project"');
      expect(page).toContain('createFormSubmitButtonText="Attach Project"');
      expect(page).not.toContain(`Create ${name} Project`);
      expect(page).toContain(
        '"People who sign in for the first time join this project."',
      );
      expect(page).toContain('"The teams of that project they join."');
    },
  );
});

describe("the Admin Dashboard's locales word what its pages now draw", () => {
  const LOCALES: string = path.join(ADMIN, "Locales");
  const files: Array<string> = fs
    .readdirSync(LOCALES)
    .filter((file: string): boolean => {
      return file.endsWith(".json");
    });

  const STRINGS: Array<string> = [
    "Custom SMTP",
    "Send through your own mail server.",
    "Send through your SendGrid account.",
    "Where OneUptime writes about this server, such as when a probe goes offline.",
    "Has root access to every project on this server.",
    "While it is off, every request with the key fails.",
    "People without an account",
    "Get one on their first sign-in",
    "They join the projects attached to this provider. With none attached, they must be invited first.",
    "Must be invited first",
    "They are turned away until someone invites them to a project.",
    "Where this sign-in counts as SSO",
    "Every project",
    "Projects that require SSO accept a sign-in with this provider.",
    "Attached projects only",
    "Other projects that require SSO turn it away, even for people already signed in.",
    "Attach a Project",
    "Attach Project",
    "People who sign in for the first time join this project.",
    "The teams of that project they join.",
  ];

  test("all seventeen languages", () => {
    expect(files).toHaveLength(17);
  });

  test.each(files)("%s", (file: string) => {
    const locale: Record<string, unknown> = JSON.parse(
      fs.readFileSync(path.join(LOCALES, file), "utf8"),
    ) as Record<string, unknown>;

    for (const text of STRINGS) {
      const value: unknown = locale[text];

      expect({ text, isText: typeof value === "string" }).toEqual({
        text,
        isText: true,
      });

      if (file === "en.json") {
        expect(value).toBe(text);
      } else {
        // Translated, keeping a sentence a sentence.
        expect({ text, translated: value !== text }).toEqual({
          text,
          translated: true,
        });
      }
    }
  });
});
