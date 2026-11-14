import Email from "../../../Types/Email";
import ProductKey from "../../../Types/Product/ProductKey";
import {
  ALWAYS_SHOWN_PRODUCTS,
  ESSENTIAL_PRODUCTS,
  HIDEABLE_PRODUCTS,
  ProjectProductSettings,
  ProjectProductsChosenBy,
  getProductsHiddenByGoals,
  parseProjectProductSettings,
  toProjectProductSettingsJSON,
} from "../../../Types/Product/ProjectProducts";
import {
  SAMPLE_PEOPLE,
  SAMPLE_PERSON_EMAIL_DOMAIN,
  SAMPLE_PROJECT_CREATE_ROUTE,
  SAMPLE_PROJECT_DELETE_ROUTE,
  SAMPLE_PROJECT_ENTRY_POINTS,
  SAMPLE_PROJECT_IDLE_DAYS,
  SAMPLE_PROJECT_NAME,
  SAMPLE_PROJECT_PRODUCTS,
  SAMPLE_PROJECT_REFUSALS,
  SAMPLE_PROJECT_SENDS_NOTHING_MESSAGE,
  SAMPLE_PROJECT_TELEMETRY_RETENTION_IN_DAYS,
  SampleProjectEntryPoint,
  getSamplePersonEmail,
  getSampleProjectNotSentReason,
  getSampleProjectProductSettings,
  isSampleProjectEntryPoint,
  isSampleProjectIdle,
  isSamplePersonEmail,
} from "../../../Types/SampleProject/SampleProject";
import ProjectGoal from "../../../Types/WelcomeChecklist/ProjectGoal";
import { describe, expect, test } from "@jest/globals";

/*
 * The pure rules of a sample project (issue #6808): its name, the products
 * it shows, its people's addresses, when it is idle, and the sentences its
 * readers answer with.
 */

const PROJECT_ID: string = "5a3c0000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-11-12T12:00:00.000Z");
const DAY_MS: number = 24 * 60 * 60 * 1000;

describe("the sample project", () => {
  test("is named so it cannot be mistaken for the person's own", () => {
    expect(SAMPLE_PROJECT_NAME).toBe("Sample: Acme Shop");
  });

  test("is deleted after two weeks without a visit on Cloud, and keeps its telemetry as long", () => {
    expect(SAMPLE_PROJECT_IDLE_DAYS).toBe(14);
    expect(SAMPLE_PROJECT_TELEMETRY_RETENTION_IN_DAYS).toBeGreaterThan(
      SAMPLE_PROJECT_IDLE_DAYS,
    );
  });
});

describe("the products a sample shows", () => {
  const settings: ProjectProductSettings = getSampleProjectProductSettings(NOW);

  test("Essentials, Logs, Traces, Metrics, Services and Dashboards", () => {
    for (const product of [
      ...ESSENTIAL_PRODUCTS,
      ProductKey.Logs,
      ProductKey.Traces,
      ProductKey.Metrics,
      ProductKey.Services,
      ProductKey.Dashboards,
    ]) {
      expect(SAMPLE_PROJECT_PRODUCTS).toContain(product);
      expect(settings.hidden).not.toContain(product);
    }
  });

  test("hides every other product it has nothing in", () => {
    expect(settings.hidden).toEqual(
      HIDEABLE_PRODUCTS.filter((product: ProductKey): boolean => {
        return !SAMPLE_PROJECT_PRODUCTS.includes(product);
      }),
    );
    expect(settings.hidden).toContain(ProductKey.Kubernetes);
    expect(settings.hidden).toContain(ProductKey.Workflows);
  });

  test("never hides the project's own settings", () => {
    for (const product of ALWAYS_SHOWN_PRODUCTS) {
      expect(settings.hidden).not.toContain(product);
    }
  });

  test("as a member's choice, so no goal chooses its menu again", () => {
    expect(settings.chosenBy).toBe(ProjectProductsChosenBy.Member);
    expect(settings.changedAt).toBe(NOW.toISOString());
    expect(settings.changedByUserId).toBeNull();
    expect(
      getProductsHiddenByGoals({ goals: [ProjectGoal.Explore], inUse: [] }),
    ).toEqual([]);
  });

  test("survives being stored and read back", () => {
    expect(
      parseProjectProductSettings(toProjectProductSettingsJSON(settings)),
    ).toEqual(settings);
  });
});

describe("the sample people's addresses", () => {
  test("are on the reserved .invalid domain, marked with their sample", () => {
    const email: string = getSamplePersonEmail({
      handle: "maya.chen",
      projectId: PROJECT_ID,
    });

    expect(email).toBe(
      "maya.chen+5a3c0000000040008000000000000001@sample.invalid",
    );
    expect(email.endsWith(`@${SAMPLE_PERSON_EMAIL_DOMAIN}`)).toBe(true);
    // Every one is a valid address, so the User row can hold it.
    expect(Email.isValid(email)).toBe(true);
  });

  test("differ between samples, so every address on the server stays unique", () => {
    expect(
      getSamplePersonEmail({ handle: "maya.chen", projectId: PROJECT_ID }),
    ).not.toBe(
      getSamplePersonEmail({
        handle: "maya.chen",
        projectId: "5a3c0000-0000-4000-8000-000000000002",
      }),
    );
  });

  test("every sample person has a handle and a name, each once", () => {
    const handles: Array<string> = SAMPLE_PEOPLE.map(
      (person: { handle: string }) => {
        return person.handle;
      },
    );

    expect(SAMPLE_PEOPLE.length).toBeGreaterThanOrEqual(4);
    expect(new Set(handles).size).toBe(handles.length);

    for (const person of SAMPLE_PEOPLE) {
      expect(person.name.trim().length).toBeGreaterThan(0);
    }
  });

  test("are told apart from real ones, as text or as an Email, whatever their case", () => {
    const email: string = getSamplePersonEmail({
      handle: "sam.okafor",
      projectId: PROJECT_ID,
    });

    expect(isSamplePersonEmail(email)).toBe(true);
    expect(isSamplePersonEmail(new Email(email))).toBe(true);
    expect(isSamplePersonEmail(`  ${email.toUpperCase()}  `)).toBe(true);
    expect(isSamplePersonEmail("someone@team.sample.invalid")).toBe(true);
  });

  test("a real address is not one", () => {
    expect(isSamplePersonEmail("maya@example.com")).toBe(false);
    expect(isSamplePersonEmail("maya@sample.invalid.example.com")).toBe(false);
    expect(isSamplePersonEmail("sample.invalid@example.com")).toBe(false);
    expect(isSamplePersonEmail("")).toBe(false);
    expect(isSamplePersonEmail(null)).toBe(false);
    expect(isSamplePersonEmail(undefined)).toBe(false);
  });
});

describe("when a sample is idle", () => {
  test("two weeks after its last visit", () => {
    expect(
      isSampleProjectIdle({
        lastActive: new Date(NOW.getTime() - 14 * DAY_MS),
        createdAt: new Date(NOW.getTime() - 30 * DAY_MS),
        now: NOW,
      }),
    ).toBe(true);
  });

  test("not a moment before", () => {
    expect(
      isSampleProjectIdle({
        lastActive: new Date(NOW.getTime() - 14 * DAY_MS + 1000),
        createdAt: new Date(NOW.getTime() - 30 * DAY_MS),
        now: NOW,
      }),
    ).toBe(false);
  });

  test("a visit counts over when it was made", () => {
    expect(
      isSampleProjectIdle({
        lastActive: new Date(NOW.getTime() - DAY_MS),
        createdAt: new Date(NOW.getTime() - 60 * DAY_MS),
        now: NOW,
      }),
    ).toBe(false);
  });

  test("never visited: two weeks after it was made", () => {
    expect(
      isSampleProjectIdle({
        lastActive: null,
        createdAt: new Date(NOW.getTime() - 15 * DAY_MS),
        now: NOW,
      }),
    ).toBe(true);
    expect(
      isSampleProjectIdle({
        lastActive: undefined,
        createdAt: new Date(NOW.getTime() - 2 * DAY_MS),
        now: NOW,
      }),
    ).toBe(false);
  });

  test("with nothing to go by, it is kept", () => {
    expect(
      isSampleProjectIdle({ lastActive: null, createdAt: null, now: NOW }),
    ).toBe(false);
  });
});

describe("what a sample's readers say", () => {
  test("a sender says which channel and why", () => {
    expect(getSampleProjectNotSentReason("SMS")).toBe(
      `SMS not sent: ${SAMPLE_PROJECT_SENDS_NOTHING_MESSAGE}`,
    );
  });

  test("every refusal is a sentence that says what to do instead", () => {
    for (const refusal of Object.values(SAMPLE_PROJECT_REFUSALS)) {
      expect(refusal).toMatch(/^[A-Z]/);
      expect(refusal.endsWith(".")).toBe(true);
      // What happened, then what to do: at least two sentences, or one with a reason.
      expect(refusal.split(". ").length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("the API and where a sample is started from", () => {
  test("two routes under one path", () => {
    expect(SAMPLE_PROJECT_CREATE_ROUTE).toBe("/sample-project/create");
    expect(SAMPLE_PROJECT_DELETE_ROUTE).toBe("/sample-project/delete");
  });

  test("the entry points are the welcome page, the goal question and Home", () => {
    expect(SAMPLE_PROJECT_ENTRY_POINTS).toEqual([
      SampleProjectEntryPoint.Welcome,
      SampleProjectEntryPoint.Goals,
      SampleProjectEntryPoint.Home,
    ]);
    expect(isSampleProjectEntryPoint("goals")).toBe(true);
    expect(isSampleProjectEntryPoint("elsewhere")).toBe(false);
    expect(isSampleProjectEntryPoint(7)).toBe(false);
  });
});
