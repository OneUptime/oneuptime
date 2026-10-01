import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  SUBSCRIBE_DETAILS_STEP_ID,
  SUBSCRIBE_PREFERENCES_STEP_ID,
  getSubscribeFormSteps,
} from "../../FeatureSet/StatusPage/src/Pages/Subscribe/SubscribePageUtils";

/*
 * Long forms walk steps. A status page's subscribe forms are long only where
 * the page lets subscribers choose resources or event types: then a new
 * subscription asks where to send updates, then what they are about. A page
 * that offers no choice keeps a field or two and a Subscribe button.
 *
 * Rendering these pages needs the whole Status Page runtime, so the five
 * forms are checked the way the other *Wiring.test.ts files here are, from
 * their sources; the step list itself is a plain function, called directly.
 */

const SUBSCRIBE_DIR: string = path.join(
  __dirname,
  "../../FeatureSet/StatusPage/src/Pages/Subscribe",
);

const LOCALES_DIR: string = path.join(
  __dirname,
  "../../FeatureSet/StatusPage/src/Locales",
);

function translate(key: string): string {
  return `[${key}]`;
}

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

describe("getSubscribeFormSteps", () => {
  test("asks where, then what, on a page that lets subscribers choose resources", () => {
    expect(
      getSubscribeFormSteps({
        allowSubscribersToChooseResources: true,
        allowSubscribersToChooseEventTypes: false,
        translate,
      }),
    ).toEqual([
      { title: "[subscribe.steps.details]", id: SUBSCRIBE_DETAILS_STEP_ID },
      {
        title: "[subscribe.steps.preferences]",
        id: SUBSCRIBE_PREFERENCES_STEP_ID,
      },
    ]);
  });

  test("asks where, then what, on a page that lets subscribers choose event types", () => {
    expect(
      getSubscribeFormSteps({
        allowSubscribersToChooseResources: false,
        allowSubscribersToChooseEventTypes: true,
        translate,
      })?.map((step: { id: string }): string => {
        return step.id;
      }),
    ).toEqual(["details", "preferences"]);
  });

  test("has no steps on a page that offers no choice", () => {
    expect(
      getSubscribeFormSteps({
        allowSubscribersToChooseResources: false,
        allowSubscribersToChooseEventTypes: false,
        translate,
      }),
    ).toBeUndefined();
  });

  test("has its titles in every locale", () => {
    for (const file of fs.readdirSync(LOCALES_DIR)) {
      const locale: {
        subscribe: { steps?: { details?: string; preferences?: string } };
        Next?: string;
      } = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"));

      expect(locale.subscribe.steps?.details).toBeTruthy();
      expect(locale.subscribe.steps?.preferences).toBeTruthy();
      // The shared form's Next button looks its label up by the English text.
      expect(locale.Next).toBeTruthy();
    }
  });
});

interface SubscribeFormCase {
  page: string;
  contactTitles: Array<string>;
}

const SUBSCRIBE_FORMS: Array<SubscribeFormCase> = [
  { page: "EmailSubscribe.tsx", contactTitles: ["subscribe.email.yourEmail"] },
  {
    page: "SmsSubscribe.tsx",
    contactTitles: ["subscribe.sms.yourPhoneNumber"],
  },
  {
    page: "WebhookSubscribe.tsx",
    contactTitles: ["subscribe.webhook.webhookUrl"],
  },
  {
    page: "SlackSubscribe.tsx",
    contactTitles: [
      "subscribe.slack.workspaceName",
      "subscribe.slack.webhookUrl",
    ],
  },
  {
    page: "MicrosoftTeamsSubscribe.tsx",
    contactTitles: [
      "subscribe.microsoftTeams.workspaceName",
      "subscribe.microsoftTeams.webhookUrl",
    ],
  },
];

const PREFERENCE_TITLES: Array<string> = [
  "subscribe.resources.all",
  "subscribe.resources.select",
  "subscribe.eventTypes.all",
  "subscribe.eventTypes.select",
];

describe.each(SUBSCRIBE_FORMS)("$page", (formCase: SubscribeFormCase) => {
  const source: string = squash(
    fs.readFileSync(path.join(SUBSCRIBE_DIR, formCase.page), "utf8"),
  );

  test("takes its steps from getSubscribeFormSteps, by what the page lets subscribers choose", () => {
    expect(source).toContain(
      squash(`getSubscribeFormSteps({
      allowSubscribersToChooseResources: Boolean(
        props.allowSubscribersToChooseResources,
      ),
      allowSubscribersToChooseEventTypes: Boolean(
        props.allowSubscribersToChooseEventTypes,
      ),`),
    );
    expect(source).toContain("steps={formSteps}");
  });

  test("asks where to send updates on the first step", () => {
    for (const title of formCase.contactTitles) {
      expect(source).toContain(
        squash(`title: t("${title}"), stepId: "details",`),
      );
    }
  });

  test("asks what they are about on the second step", () => {
    for (const title of PREFERENCE_TITLES) {
      expect(source).toContain(
        squash(`title: t("${title}"), stepId: "preferences",`),
      );
    }
  });

  test("keeps the manage-subscription form a single field, with no steps", () => {
    const manageForm: string =
      source.split("getManageExistingSubscriptionContentElement")[1] || "";

    if (manageForm) {
      expect(manageForm.split("</ModelForm>")[0] || "").not.toContain("steps=");
    }
  });
});
