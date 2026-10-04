import { describe, expect, test } from "@jest/globals";
import path from "path";
import {
  listScanRoots,
  listSourceFiles,
} from "../../../ForeignHiddenRuleGuard";
import {
  FormFacts,
  FormFieldFacts,
  FormStepFacts,
  countFormRows,
  findLongFormsWithoutSteps,
  findShortFormsWithSteps,
  scanFormFiles,
} from "../../../Helpers/FormStepsScan";

/*
 * "Please also find similar issues across the project and fix them as well.
 * The idea is to make software as simple as possible to use and reduce
 * decision paralysis." - the maintainer.
 *
 * A wizard step has to earn its place. These forms walked steps that did
 * not: the Admin Dashboard's Global LLM Providers had an Advanced step and,
 * where projects are billed for AI, a Cost step, one field each; Call & SMS
 * split the three values the Twilio console shows together across a Next;
 * WhatsApp asked six things on two steps when a message needs two; Invite
 * User could be finished on its first step without ever showing which team
 * the invitation was for; and a shared calendar link's settings dialog was
 * three steps for five settings, one of them a step of its own.
 *
 * Each is pinned here as it is now, read from the source by the same scan
 * the form guards use (Tests/Helpers/FormStepsScan): which steps it walks,
 * which fields are open and which are folded under Advanced. How they
 * render and save is tested on the real pages (Tests/App/AdminDashboard/
 * AdminSettingsFormsOnePage, Tests/App/Dashboard/
 * OnCallSharedCalendarFeedSettingsForm, Tests/App/AdminDashboard/
 * AdminAddToProjectMembersTeam).
 */

const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
);

const ADMIN_DASHBOARD: string = "packages/App/FeatureSet/AdminDashboard/src";
const DASHBOARD: string = "packages/App/FeatureSet/Dashboard/src";

const files: Array<string> = listScanRoots(REPOSITORY_ROOT).flatMap(
  (root: string): Array<string> => {
    return listSourceFiles(root);
  },
);

const forms: Array<FormFacts> = scanFormFiles({
  repositoryRoot: REPOSITORY_ROOT,
  files,
});

function formIn(file: string, label: string): FormFacts {
  const found: Array<FormFacts> = forms.filter((form: FormFacts): boolean => {
    return form.file === file && form.label === label;
  });

  expect(found).toHaveLength(1);

  return found[0]!;
}

function keysOf(fields: Array<FormFieldFacts>): Array<string> {
  return fields.map((field: FormFieldFacts): string => {
    return field.key;
  });
}

function openFields(form: FormFacts): Array<FormFieldFacts> {
  return form.fields.filter((field: FormFieldFacts): boolean => {
    return field.collapsibleSection === undefined;
  });
}

function foldedFields(form: FormFacts): Array<FormFieldFacts> {
  return form.fields.filter((field: FormFieldFacts): boolean => {
    return field.collapsibleSection !== undefined;
  });
}

// Folded fields are one Advanced section: one header, built once.
function expectOneAdvancedSection(form: FormFacts): void {
  expect(
    Array.from(
      new Set(
        foldedFields(form).map((field: FormFieldFacts): string | undefined => {
          return field.collapsibleSection;
        }),
      ),
    ),
  ).toEqual(["advancedSection"]);

  // At the end, so the open fields read as one block above it.
  const folded: Array<FormFieldFacts> = foldedFields(form);

  expect(form.fields.slice(-folded.length)).toEqual(folded);
}

function expectOnePage(form: FormFacts): void {
  expect(form.hasSteps).toBe(false);
  expect(form.steps).toEqual([]);
  expect(form.uncountableReasons).toEqual([]);
  // No field is left naming a step the form no longer has.
  expect(
    form.fields.filter((field: FormFieldFacts): boolean => {
      return field.stepId !== undefined;
    }),
  ).toEqual([]);
}

describe("Admin Dashboard > Settings > Global LLM Providers", () => {
  const form: FormFacts = formIn(
    `${ADMIN_DASHBOARD}/Pages/Settings/LlmProviders/Index.tsx`,
    "ModelTable: Settings > Global LLM Providers",
  );

  test("walks what the provider is, then how to reach it - no Advanced or Cost step", () => {
    expect(
      (form.steps || []).map((step: FormStepFacts) => {
        return { id: step.id, titleTexts: step.titleTexts };
      }),
    ).toEqual([
      { id: "basic-info", titleTexts: ["Basic Info"] },
      { id: "provider-settings", titleTexts: ["Provider Settings"] },
    ]);
  });

  test("folds Additional Parameters and the cost per million tokens at the end of Provider Settings", () => {
    expect(
      keysOf(
        form.fields.filter((field: FormFieldFacts): boolean => {
          return field.stepId === "basic-info";
        }),
      ),
    ).toEqual(["name", "description"]);
    expect(
      keysOf(
        form.fields.filter((field: FormFieldFacts): boolean => {
          return field.stepId === "provider-settings";
        }),
      ),
    ).toEqual([
      "llmType",
      "apiKey",
      "modelName",
      "baseUrl",
      "additionalParams",
      "costPerMillionTokensInUSDCents",
    ]);
    expect(keysOf(foldedFields(form))).toEqual([
      "additionalParams",
      "costPerMillionTokensInUSDCents",
    ]);
    expectOneAdvancedSection(form);
  });

  test("reads a free provider's cost of 0 as nothing set, so its Edit form does not say Configured", () => {
    const cost: FormFieldFacts | undefined = form.fields.find(
      (field: FormFieldFacts): boolean => {
        return field.key === "costPerMillionTokensInUSDCents";
      },
    );

    expect(cost?.defaultValue).toBe("0");
  });
});

describe("Admin Dashboard > Settings > Call & SMS", () => {
  const form: FormFacts = formIn(
    `${ADMIN_DASHBOARD}/Pages/Settings/CallSMS/Index.tsx`,
    "CardModelDetail: Call and SMS Settings",
  );

  test("is one page: the account, its token and the number, with the extra numbers folded", () => {
    expectOnePage(form);
    expect(keysOf(openFields(form))).toEqual([
      "twilioAccountSID",
      "twilioAuthToken",
      "twilioPrimaryPhoneNumber",
    ]);
    expect(keysOf(foldedFields(form))).toEqual(["twilioSecondaryPhoneNumbers"]);
    expectOneAdvancedSection(form);
    expect(countFormRows(form)).toBe(4);
  });
});

describe("Admin Dashboard > Settings > WhatsApp", () => {
  const form: FormFacts = formIn(
    `${ADMIN_DASHBOARD}/Pages/Settings/WhatsApp/Index.tsx`,
    "CardModelDetail: Meta WhatsApp Settings",
  );

  test("is one page: the two values a message is sent with, the rest folded", () => {
    expectOnePage(form);
    expect(keysOf(openFields(form))).toEqual([
      "metaWhatsAppAccessToken",
      "metaWhatsAppPhoneNumberId",
    ]);
    // The webhook's two settings first, then the IDs kept for reference.
    expect(keysOf(foldedFields(form))).toEqual([
      "metaWhatsAppWebhookVerifyToken",
      "metaWhatsAppAppSecret",
      "metaWhatsAppBusinessAccountId",
      "metaWhatsAppAppId",
    ]);
    expectOneAdvancedSection(form);
  });

  test("is a short form: three rows, which needs no allowlist entry", () => {
    expect(countFormRows(form)).toBe(3);
    expect(findLongFormsWithoutSteps([form])).toEqual([]);
    expect(findShortFormsWithSteps([form])).toEqual([]);
  });
});

describe("Admin Dashboard > Project > Users > Invite User", () => {
  const form: FormFacts = formIn(
    `${ADMIN_DASHBOARD}/Pages/Projects/View/Users.tsx`,
    "ModelFormModal: Invite New User",
  );

  test("is one page, as the Dashboard's Invite User is, with the team and the auto-accept box in view", () => {
    expectOnePage(form);
    expect(keysOf(form.fields)).toEqual([
      "email",
      "name",
      "team",
      "hasAcceptedInvitation",
    ]);
    expect(foldedFields(form)).toEqual([]);
    // The name only for an address with no account yet.
    expect(
      form.fields
        .filter((field: FormFieldFacts): boolean => {
          return field.isConditional;
        })
        .map((field: FormFieldFacts): string => {
          return field.key;
        }),
    ).toEqual(["name"]);
  });

  test("the Dashboard's Invite User is one page too", () => {
    const dashboardInvite: FormFacts = formIn(
      `${DASHBOARD}/Pages/Users/Index.tsx`,
      "ModelFormModal: Invite New User",
    );

    expect(dashboardInvite.hasSteps).toBe(false);
    expect(keysOf(dashboardInvite.fields)).toEqual(["email", "name", "team"]);
  });
});

describe("On-Call > a shared calendar link's settings", () => {
  const form: FormFacts = formIn(
    `${DASHBOARD}/Components/OnCallPolicy/CalendarFeed/SharedCalendarFeedCard.tsx`,
    "CardModelDetail: Shared Calendar Feed > Settings",
  );

  test("are one page, in the order the card lists them", () => {
    expectOnePage(form);
    expect(keysOf(form.fields)).toEqual([
      "includeCoverageGaps",
      "minimumGapMinutes",
      "pastDays",
      "futureDays",
      "rotateWhenMemberLeaves",
    ]);
    expect(foldedFields(form)).toEqual([]);
  });

  test("show the minimum gap only while coverage gaps are shown", () => {
    expect(
      form.fields
        .filter((field: FormFieldFacts): boolean => {
          return field.isConditional;
        })
        .map((field: FormFieldFacts): string => {
          return field.key;
        }),
    ).toEqual(["minimumGapMinutes"]);
  });

  test("match the personal link's settings, which are one page too", () => {
    const personal: FormFacts = formIn(
      `${DASHBOARD}/Components/OnCallPolicy/CalendarFeed/PersonalCalendarFeedCard.tsx`,
      "CardModelDetail: Calendar Feed > Settings",
    );

    expect(personal.hasSteps).toBe(false);
  });
});

/*
 * Three of them show four or five rows, which the long form rule would walk
 * through steps: LongFormStepsGuard lists each in LONG_FORMS_WITHOUT_STEPS
 * with the reason it is better on one page, and fails when an entry stops
 * matching a long form without steps.
 */
describe("the one-page forms above that show more than three rows", () => {
  test.each([
    [
      `${ADMIN_DASHBOARD}/Pages/Settings/CallSMS/Index.tsx`,
      "CardModelDetail: Call and SMS Settings",
    ],
    [
      `${ADMIN_DASHBOARD}/Pages/Projects/View/Users.tsx`,
      "ModelFormModal: Invite New User",
    ],
    [
      `${DASHBOARD}/Components/OnCallPolicy/CalendarFeed/SharedCalendarFeedCard.tsx`,
      "CardModelDetail: Shared Calendar Feed > Settings",
    ],
  ])(
    "%s is read as a long form without steps, which is listed with its reason",
    (file: string, label: string) => {
      expect(findLongFormsWithoutSteps([formIn(file, label)])).toHaveLength(1);
    },
  );
});
