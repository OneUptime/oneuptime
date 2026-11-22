import OnCallChatText, {
  ON_CALL_CHAT_INVITEE_UNNAMED,
  OnCallMomentText,
  OnCallNotPagedBecause,
} from "Common/Server/Utils/OnCall/OnCallChatText";
import { MarkdownText, mdText } from "Common/Utils/Markdown/FeedMarkdown";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { readPage } from "./DocsContentSupport";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT THE DOCS QUOTE OF AN INVITEE'S TURN IS WHAT THE CHANNELS HEAR (#10617).
 *
 * Someone invited who has not joined the project yet can be in a schedule's
 * rotation (#10412), and nothing pages them until they join. The Slack page's
 * On-call messages table and the On-Call Schedules page quote what a channel
 * hears then (#10586): their turn as a coverage gap, a next person nothing
 * will page, and the line once they join during their turn. They name the
 * invitee by the name typed with their invitation, else as "someone who
 * hasn't joined the project yet" - never by their email address (#10616).
 *
 * Chat lines stay in English in every docs language, as OneUptime posts
 * them. Each line here is written by the product's own OnCallChatText, so a
 * change to what a channel hears fails here until every page quotes it.
 *
 * An override can name an invitee as the cover too (#10670): the User
 * Overrides page quotes what its channels hear then - that nobody is paged
 * in place of the person away until the cover joins.
 */

const TOMORROW: OnCallMomentText = (): MarkdownText => {
  return mdText`tomorrow at 5:50 PM`;
};

const AT: Date = new Date("2026-11-23T17:50:00.000Z");

const POLICY: MarkdownText = mdText`Payments`;

const IVY_NOT_JOINED: {
  name: MarkdownText;
  because: OnCallNotPagedBecause;
} = {
  name: mdText`Ivy`,
  because: OnCallNotPagedBecause.NotJoinedYet,
};

// Ivy's turn: nobody is paged through Primary until Bob takes over.
const NOBODY_PAGED: string = OnCallChatText.nobodyPaged({
  policy: POLICY,
  schedule: "Primary",
  onCall: IVY_NOT_JOINED,
  until: AT,
  next: mdText`@bob`,
  moment: TOMORROW,
}).toString();

// Ana's turn, with Ivy next: nobody takes over.
const THEN_NOBODY: string = OnCallChatText.nowOnCall({
  person: mdText`@ana`,
  policy: POLICY,
  until: AT,
  nextNotPaged: IVY_NOT_JOINED,
  moment: TOMORROW,
}).toString();

// Ivy joins during her turn: a page reaches her from now on.
const JOINED: string = OnCallChatText.nowOnCall({
  person: mdText`Ivy`,
  policy: POLICY,
  until: AT,
  next: mdText`@bob`,
  hasJustJoined: true,
  moment: TOMORROW,
}).toString();

// A schedule left with nobody on call, as the table said before.
const NOBODY_ON_CALL: string = OnCallChatText.nobodyOnCall({
  policy: POLICY,
  next: mdText`@bob`,
  from: AT,
  moment: TOMORROW,
}).toString();

// Ana away, Ivy - who hasn't joined - covering: nobody is paged in Ana's place.
const MONDAY: Date = new Date("2026-11-23T09:00:00.000Z");

const COVER_NOT_JOINED: string = OnCallChatText.overrideAdded({
  policy: POLICY,
  person: mdText`@ana`,
  cover: mdText`Ivy`,
  coverNotJoined: { isNamed: true },
  from: MONDAY,
  until: AT,
  moment: (date: Date): MarkdownText => {
    return date === MONDAY ? mdText`Mon at 9:00 AM` : mdText`Fri at 5:00 PM`;
  },
}).toString();

const SLACK: string = "workspace-connections/slack";
const TEAMS: string = "workspace-connections/microsoft-teams";
const SCHEDULES: string = "on-call/schedules";
const NOTIFICATION_SETTINGS: string = "notifications/notification-settings";
const USER_OVERRIDES: string = "on-call/user-overrides";

describe("the lines the docs quote are the lines the product writes", () => {
  test("in English, word for word", () => {
    expect(NOBODY_PAGED).toBe(
      "⚠️ Nobody is paged for Payments through schedule Primary until tomorrow at 5:50 PM, when @bob takes over: Ivy is on call but hasn't joined the project yet.",
    );
    expect(THEN_NOBODY).toBe(
      "📞 @ana is now on call for Payments until tomorrow at 5:50 PM, then nobody: Ivy is next but hasn't joined the project yet.",
    );
    expect(JOINED).toBe(
      "📞 Ivy has joined the project and is now on call for Payments until tomorrow at 5:50 PM, then @bob.",
    );
    expect(NOBODY_ON_CALL).toBe(
      "⚠️ Nobody is on call for Payments until tomorrow at 5:50 PM, when @bob takes over.",
    );
    expect(COVER_NOT_JOINED).toBe(
      "🔁 Added an override on Payments: Ivy covers for @ana from Mon at 9:00 AM to Fri at 5:00 PM, but Ivy hasn't joined the project yet, so nobody is paged in place of @ana until they do.",
    );
  });
});

describe.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
  "the %s docs",
  (language: string) => {
    test("Slack's On-call messages table quotes an invitee's turn, a next person nothing pages, and joining during the turn", () => {
      const page: string = readPage(language, SLACK);

      for (const line of [NOBODY_ON_CALL, NOBODY_PAGED, THEN_NOBODY, JOINED]) {
        expect({ line, quoted: page.includes(line) }).toEqual({
          line,
          quoted: true,
        });
      }
    });

    test("Slack's page quotes the name a line gives an invitee with no name typed", () => {
      expect(readPage(language, SLACK)).toContain(ON_CALL_CHAT_INVITEE_UNNAMED);
    });

    test("the user overrides page quotes the line of a cover who hasn't joined the project yet, once (#10670)", () => {
      const page: string = readPage(language, USER_OVERRIDES);

      expect(page.split(COVER_NOT_JOINED).length - 1).toBe(1);
    });

    test("the schedules page quotes an invitee's turn, and joining, and names the commands that say so too", () => {
      const page: string = readPage(language, SCHEDULES);

      expect(page).toContain(NOBODY_PAGED);
      expect(page).toContain(JOINED);
      expect(page).toContain("`/oneuptime oncall`");
      expect(page).toContain("`oncall`");
      expect(page).toContain("(/docs/on-call/readiness)");
    });

    test("every page says one paragraph's worth, not more: one quote of each line", () => {
      const slack: string = readPage(language, SLACK);
      const schedules: string = readPage(language, SCHEDULES);

      expect(slack.split(NOBODY_PAGED).length - 1).toBe(1);
      expect(slack.split(JOINED).length - 1).toBe(1);
      expect(schedules.split(NOBODY_PAGED).length - 1).toBe(1);
    });
  },
);

describe("the English pages say what the product does", () => {
  test("Microsoft Teams: an invitee is named by the name typed with their invitation, never their email address", () => {
    expect(readPage("en", TEAMS)).toContain(
      "Someone invited who has not joined the project yet is named by the name typed with their invitation, never by their email address.",
    );
  });

  test("Slack and Microsoft Teams: a member with no name is named by the part of their address before the @ (#10669)", () => {
    for (const page of [SLACK, TEAMS]) {
      expect(readPage("en", page)).toContain(
        "Somebody with no name in OneUptime is named by the part of their email address before the @.",
      );
    }
  });

  test("user overrides: an invitee can cover, and nobody is paged in their place until they join (#10670)", () => {
    expect(readPage("en", USER_OVERRIDES)).toContain(
      "Someone invited who has not joined the project yet can be picked under **Who covers?**, but nothing pages them until they accept their invitation, so until then nobody is paged in place of the person away.",
    );
  });

  test("notification settings: joining and leaving tell you once per policy, leaving only once nothing else on it pages you, and nothing before you join or after you are removed", () => {
    const page: string = readPage("en", NOTIFICATION_SETTINGS);

    expect(page).toContain(
      "when you join the project, and when you join or leave a team that one of its rules names.",
    );
    expect(page).toContain(
      "Joining or leaving tells you once per policy, naming every rule of it that changed, and leaving tells you only once nothing else on that policy pages you.",
    );
    expect(page).toContain(
      "Nothing is sent before you join a project, or when you are removed from one.",
    );
  });
});
