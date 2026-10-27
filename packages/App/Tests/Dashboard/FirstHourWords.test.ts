import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHO IS TOLD WHEN SOMETHING BREAKS - SAID IN A NEW PERSON'S FIRST HOUR.
 *
 * Someone new asks one thing of a monitoring product before anything else:
 * when my site goes down, will I hear about it? OneUptime's answer was right
 * and nowhere on screen:
 *
 *   - a monitor's default criteria open an incident when it goes down (an
 *     alert, for the few types whose trouble is not an outage);
 *   - an incident (or alert) nobody owns is emailed to the project's owners -
 *     the person who made the project, at first - with "Incident created"
 *     emails on for every member from the start;
 *   - an on-call policy pages nobody until an on-call rule or a monitor
 *     names it.
 *
 * Three sentences now say so where the newcomer is: Create Monitor's card,
 * the Home checklist's on-call step, and Create On-Call Policy's "Page this
 * policy for every new incident and alert". This suite holds each one to
 * the code that makes it true, and to all 17 locales, so the words cannot
 * drift from what happens or fall back to English in one language.
 */

const PACKAGES: string = path.join(__dirname, "..", "..", "..");
const DASHBOARD_SRC: string = path.join(
  PACKAGES,
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
);
const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

function read(...segments: Array<string>): string {
  return fs.readFileSync(path.join(...segments), "utf8");
}

const CREATE_MONITOR_DESCRIPTION: string =
  "Pick what to monitor and give it a name. Everything else starts with defaults you can change. When something goes wrong, OneUptime opens an incident or alert and emails the project's owners.";

const WHITESPACE_RUN: RegExp = /\s+/g;

const ON_CALL_STEP_DESCRIPTION: string =
  "Page the right person when an incident or alert opens. Until then, the project's owners get an email.";

const EVERY_NEW_EVENT_TITLE: string =
  "Page this policy for every new incident and alert";

const EVERY_NEW_EVENT_DESCRIPTION: string =
  "Adds an on-call rule for incidents and one for alerts. A policy pages nobody until a rule or a monitor triggers it.";

const NEW_SENTENCES: Array<string> = [
  CREATE_MONITOR_DESCRIPTION,
  ON_CALL_STEP_DESCRIPTION,
  EVERY_NEW_EVENT_TITLE,
  EVERY_NEW_EVENT_DESCRIPTION,
];

// The sentences they replaced: no longer drawn anywhere.
const RETIRED_SENTENCES: Array<string> = [
  "Pick what to monitor and give it a name. Everything else starts with defaults you can change.",
  "Route alerts and incidents to the right person at the right time.",
];

/*
 * The switch's first words, before its UI review: "it", under "Who gets
 * paged first?", could be the person just added, and the description said
 * why before it said what. Renamed in every locale, translations kept.
 */
const RETIRED_SWITCH_WORDS: Array<string> = [
  "Page it for every new incident and alert",
  "A policy pages nobody until a rule or a monitor names it. This adds one rule for incidents and one for alerts.",
];

type Locale = Record<string, unknown>;

const locales: Record<string, Locale> = {};

for (const file of fs.readdirSync(LOCALES_DIR)) {
  if (file.endsWith(".json")) {
    locales[file.replace(".json", "")] = JSON.parse(
      read(LOCALES_DIR, file),
    ) as Locale;
  }
}

const NON_ENGLISH: Array<string> = Object.keys(locales)
  .filter((code: string): boolean => {
    return code !== "en";
  })
  .sort();

describe("where the newcomer reads it", () => {
  test("Create Monitor's card says who is told when it goes down", () => {
    const page: string = read(DASHBOARD_SRC, "Pages", "Monitor", "Create.tsx");

    expect(page).toContain(`"${CREATE_MONITOR_DESCRIPTION}"`);
  });

  test("the Home checklist's on-call step says who is told until there is a policy", () => {
    const checklist: string = read(
      DASHBOARD_SRC,
      "Components",
      "Home",
      "GettingStarted.tsx",
    );
    const step: string = checklist.slice(
      checklist.indexOf('key: "create-on-call-policy"'),
    );

    expect(step).toContain('title: "Set up an on-call policy"');
    expect(step).toContain(`"${ON_CALL_STEP_DESCRIPTION}"`);
  });

  test("Create On-Call Policy asks to page for every new incident and alert", () => {
    const form: string = read(
      DASHBOARD_SRC,
      "Components",
      "OnCallPolicy",
      "OnCallPolicyCreateForm.ts",
    );

    expect(form).toContain(`translationKey("${EVERY_NEW_EVENT_TITLE}")`);
    expect(form.replace(WHITESPACE_RUN, " ")).toContain(
      `translationKey( "${EVERY_NEW_EVENT_DESCRIPTION}", )`,
    );
  });

  test("the sentences they replaced are drawn nowhere", () => {
    const sources: Array<string> = [
      read(DASHBOARD_SRC, "Pages", "Monitor", "Create.tsx"),
      read(DASHBOARD_SRC, "Components", "Home", "GettingStarted.tsx"),
    ];

    for (const retired of RETIRED_SENTENCES) {
      for (const source of sources) {
        expect(source).not.toContain(`"${retired}"`);
      }
    }
  });
});

describe("what makes the words true", () => {
  test("each monitor type's default trouble criterion opens an incident or an alert", () => {
    const criteria: string = read(
      PACKAGES,
      "Common",
      "Types",
      "Monitor",
      "MonitorCriteriaInstance.ts",
    );
    const start: number = criteria.indexOf(
      "public static getDefaultOfflineMonitorCriteriaInstance(",
    );
    const offline: string = criteria.slice(
      start,
      criteria.indexOf("\n  public static", start + 1),
    );
    const branches: Array<string> = offline
      .split("monitorCriteriaInstance.data = {")
      .slice(1);

    // Every type the function sets up, and the many it does.
    expect(branches.length).toBeGreaterThan(10);

    for (const branch of branches) {
      expect(
        branch.includes("createIncidents: true,") ||
          branch.includes("createAlerts: true,"),
      ).toBe(true);
    }

    // An outage opens an incident: the first branch is Ping, Port and Server.
    expect(branches[0]).toContain("createIncidents: true,");
  });

  test.each([
    ["IncidentOwners", "incident"],
    ["AlertOwners", "alert"],
  ])(
    "an %s created with no owners is emailed to the project's owners",
    (folder: string) => {
      const job: string = read(
        PACKAGES,
        "App",
        "FeatureSet",
        "Workers",
        "Jobs",
        folder,
        "SendCreatedResourceNotification.ts",
      );
      const noOwners: string = job.slice(
        job.indexOf("if (owners.length === 0) {"),
      );

      expect(noOwners).toContain("ProjectService.getOwners(");
    },
  );

  test("every member starts with an email when an incident or alert they own is created", () => {
    const settings: string = read(
      PACKAGES,
      "Common",
      "Server",
      "Services",
      "UserNotificationSettingService.ts",
    );

    for (const [method, eventType] of [
      [
        "private async addIncidentNotificationSettings(",
        "SEND_INCIDENT_CREATED_OWNER_NOTIFICATION",
      ],
      [
        "private async addAlertNotificationSettings(",
        "SEND_ALERT_CREATED_OWNER_NOTIFICATION",
      ],
    ] as Array<[string, string]>) {
      const body: string = settings.slice(settings.indexOf(method));

      expect(body.slice(0, body.indexOf("\n  }\n"))).toContain(
        `NotificationSettingEventType.${eventType}`,
      );
    }

    // And each default is switched on by email.
    expect(settings).toContain("item.alertByEmail = true;");
  });

  test("the policy service adds both rules when asked", () => {
    const service: string = read(
      PACKAGES,
      "Common",
      "Server",
      "Services",
      "OnCallDutyPolicyService.ts",
    );

    expect(service).toContain(
      "readPageForEveryNewIncidentAndAlert(createBy.miscDataProps)",
    );
    expect(service).toContain("await IncidentOnCallRuleService.create({");
    expect(service).toContain("await AlertOnCallRuleService.create({");
  });
});

describe("in every language", () => {
  test("English maps each sentence to itself", () => {
    for (const sentence of NEW_SENTENCES) {
      expect([sentence, locales["en"]![sentence]]).toEqual([
        sentence,
        sentence,
      ]);
    }
  });

  test("all 17 locales are here", () => {
    expect(Object.keys(locales)).toHaveLength(17);
  });

  test.each(NON_ENGLISH)("%s translates every sentence", (code: string) => {
    for (const sentence of NEW_SENTENCES) {
      const value: unknown = locales[code]![sentence];

      expect([sentence, typeof value]).toEqual([sentence, "string"]);
      expect([sentence, value]).not.toEqual([sentence, sentence]);
      expect((value as string).trim().length).toBeGreaterThan(0);
    }
  });

  test.each(Object.keys(locales).sort())(
    "%s no longer holds the switch's first words",
    (code: string) => {
      for (const retired of RETIRED_SWITCH_WORDS) {
        expect([retired, retired in locales[code]!]).toEqual([retired, false]);
      }
    },
  );

  test.each(NON_ENGLISH)(
    "%s keeps the product's name in Create Monitor's card",
    (code: string) => {
      expect(locales[code]![CREATE_MONITOR_DESCRIPTION]).toContain("OneUptime");
    },
  );

  test.each(NON_ENGLISH)(
    "%s keeps Create Monitor's first two sentences as they were",
    (code: string) => {
      /*
       * The card only gained its last sentence: the translation starts with
       * the one it had.
       */
      const before: string = locales[code]![RETIRED_SENTENCES[0]!] as string;

      expect(typeof before).toBe("string");
      expect(
        (locales[code]![CREATE_MONITOR_DESCRIPTION] as string).startsWith(
          before,
        ),
      ).toBe(true);
    },
  );
});
