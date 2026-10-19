import PageMap from "../../FeatureSet/StatusPage/src/Utils/PageMap";
import {
  LINK_NOT_VALID_STATUS_CODES,
  getConfirmationSignUpPage,
} from "../../FeatureSet/StatusPage/src/Pages/Subscribe/ConfirmationSignUpPage";
import { toLatinDigits } from "../FeatureSet/Docs/DocsTranslationChecks";
import StatusPageSubscriberConfirmationCode from "Common/Server/Utils/StatusPage/StatusPageSubscriberConfirmationCode";
import BadDataException from "Common/Types/Exception/BadDataException";
import NotFoundException from "Common/Types/Exception/NotFoundException";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A link to confirm a status page subscription works for a day after it is
 * sent (StatusPageSubscriberConfirmationCode.VALID_FOR_HOURS). Everything a
 * subscriber reads about it says the same day, and a link that has run out
 * leads somewhere:
 *
 *  - the Confirm Subscription page tells a link that has expired, or is not
 *    valid, from anything else that went wrong, by what the confirm route
 *    answers for it, and says so in the reader's language with Subscribe
 *    again - to the Subscribe page of email, or else SMS, the two channels
 *    that confirm by a link (Common's
 *    Tests/App/StatusPage/StatusPageConfirmSubscriptionPage.test.tsx renders
 *    it); the status page app hands it the page's channels, live and in
 *    preview;
 *  - the confirmation email, and the starter a custom confirmation template
 *    begins from, say how long the link works.
 */

const STATUS_PAGE_SRC: string = path.join(
  __dirname,
  "../../FeatureSet/StatusPage/src",
);

const LOCALES_DIR: string = path.join(STATUS_PAGE_SRC, "Locales");

const HOURS: string = String(
  StatusPageSubscriberConfirmationCode.VALID_FOR_HOURS,
);

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(STATUS_PAGE_SRC, relativePath), "utf8");
}

describe("where Subscribe again leads", () => {
  test.each([
    [
      "email and SMS",
      true,
      true,
      PageMap.SUBSCRIBE_EMAIL,
      PageMap.PREVIEW_SUBSCRIBE_EMAIL,
    ],
    [
      "email only",
      true,
      false,
      PageMap.SUBSCRIBE_EMAIL,
      PageMap.PREVIEW_SUBSCRIBE_EMAIL,
    ],
    [
      "SMS only",
      false,
      true,
      PageMap.SUBSCRIBE_SMS,
      PageMap.PREVIEW_SUBSCRIBE_SMS,
    ],
  ])(
    "a page with %s: its Subscribe page, live and in preview",
    (
      _label: string,
      email: boolean,
      sms: boolean,
      live: PageMap,
      preview: PageMap,
    ) => {
      const channels: {
        enableEmailSubscribers: boolean;
        enableSMSSubscribers: boolean;
      } = { enableEmailSubscribers: email, enableSMSSubscribers: sms };

      expect(
        getConfirmationSignUpPage({ channels: channels, isPreview: false }),
      ).toBe(live);
      expect(
        getConfirmationSignUpPage({ channels: channels, isPreview: true }),
      ).toBe(preview);
    },
  );

  test("a page with neither: nowhere - Slack, Microsoft Teams and webhook sign-ups confirm by no link", () => {
    expect(
      getConfirmationSignUpPage({
        channels: {
          enableEmailSubscribers: false,
          enableSMSSubscribers: false,
        },
        isPreview: false,
      }),
    ).toBeNull();
  });

  test("the status page app hands the page its channels, live and in preview", () => {
    const app: string = readSource("App.tsx");
    const pages: Array<string> = app
      .split("<ConfirmSubscription")
      .slice(1)
      .map((rest: string): string => {
        return rest.slice(0, rest.indexOf("/>"));
      });

    expect(pages).toHaveLength(2);

    for (const page of pages) {
      expect(page).toContain("signUpChannels={manageLinkChannels}");
    }

    expect(app).toContain("enableEmailSubscribers: enableEmailSubscribers,");
    expect(app).toContain("enableSMSSubscribers: enableSMSSubscribers,");
  });
});

describe("a link that confirms nothing", () => {
  test("is told by what the confirm route answers for it: not found, or expired", () => {
    expect([...LINK_NOT_VALID_STATUS_CODES].sort()).toEqual(
      [
        new NotFoundException("not found").code,
        new BadDataException("expired").code,
      ].sort(),
    );
  });

  test("the page asks nothing of a link with a part missing, and shows the server's words only for anything else", () => {
    const page: string = readSource("Pages/Subscribe/ConfirmSubscription.tsx");

    expect(page).toContain("if (!token || !statusPageSubscriberId) {");
    expect(page).toContain(
      "LINK_NOT_VALID_STATUS_CODES.includes(response.statusCode)",
    );
    expect(page).toContain('t("subscribe.confirm.linkNotValid")');
    expect(page).toContain('t("subscribe.confirm.subscribeAgain")');
  });

  test("every status page language says it, with how long a link works, and offers Subscribe again", () => {
    const files: Array<string> = fs
      .readdirSync(LOCALES_DIR)
      .filter((file: string): boolean => {
        return file.endsWith(".json");
      });

    expect(files).toHaveLength(17);

    const english: {
      subscribe: { confirm: Record<string, string> };
    } = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, "en.json"), "utf8"));

    for (const file of files) {
      const locale: {
        subscribe: { confirm: Record<string, string> };
      } = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"));
      const confirm: Record<string, string> = locale.subscribe.confirm;

      expect([file, Object.keys(confirm)]).toEqual([
        file,
        ["title", "success", "linkNotValid", "subscribeAgain"],
      ]);
      expect([file, toLatinDigits(confirm["linkNotValid"]!)]).toEqual([
        file,
        expect.stringContaining(HOURS),
      ]);
      expect(confirm["subscribeAgain"]!.length).toBeGreaterThan(0);

      // Each language in its own words.
      if (file !== "en.json") {
        expect([file, confirm["linkNotValid"]]).not.toEqual([
          file,
          english.subscribe.confirm["linkNotValid"],
        ]);
        expect([file, confirm["subscribeAgain"]]).not.toEqual([
          file,
          english.subscribe.confirm["subscribeAgain"],
        ]);
      }
    }
  });
});

describe("what a subscriber reads about how long the link works", () => {
  test("the confirmation email says it, below its button", () => {
    const template: string = fs.readFileSync(
      path.join(
        __dirname,
        "../../FeatureSet/Notification/Templates/ConfirmStatusPageSubscription.hbs",
      ),
      "utf8",
    );

    const button: number = template.indexOf(
      'buttonText="Confirm Subscription"',
    );
    const note: number = template.indexOf(
      `This link expires in ${HOURS} hours. If you did not subscribe, you can ignore this email and you will not be subscribed.`,
    );

    expect(button).toBeGreaterThan(-1);
    expect(note).toBeGreaterThan(button);
  });

  test("the starter of a custom confirmation email says it too", () => {
    const starters: string = fs.readFileSync(
      path.join(
        __dirname,
        "../../FeatureSet/Dashboard/src/Utils/SubscriberNotificationTemplateDefaults.ts",
      ),
      "utf8",
    );

    const confirmation: string =
      starters.split("const subscriptionConfirmationDefaults")[1] || "";
    const body: string = confirmation.slice(
      0,
      confirmation.indexOf("const subscribedDefaults"),
    );

    expect(
      body.indexOf(`This link expires in ${HOURS} hours.`),
    ).toBeGreaterThan(body.indexOf("{{confirmationUrl}}"));
  });
});
