import { getDefaultSubscriberNotificationTemplate } from "../../FeatureSet/Dashboard/src/Utils/SubscriberNotificationTemplateDefaults";
import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * #7824: a custom subscriber email starts from the Dashboard's starter,
 * which says what the default email says (the file's header: it "reuses
 * the wording from the corresponding handlebars templates"). #7822 made
 * those emails call the record a maintenance event (#6817); the starters
 * said "scheduled maintenance event(s)" still.
 *
 * Each starter holds its email's sentence as the email has it, so the two
 * cannot drift apart, and neither says the old name.
 */

const TEMPLATES: string = path.join(
  __dirname,
  "../../FeatureSet/Notification/Templates",
);

const OLD_NAME: RegExp = /scheduled maintenance event/i;

interface Pair {
  eventType: StatusPageSubscriberNotificationEventType;
  template: string;
  sentence: string;
}

const PAIRS: Array<Pair> = [
  {
    eventType:
      StatusPageSubscriberNotificationEventType.SubscriberSubscriptionConfirmation,
    template: "ConfirmStatusPageSubscription.hbs",
    sentence:
      "You will be the first to hear from us when there are any incidents, announcements or maintenance events.",
  },
  {
    eventType: StatusPageSubscriberNotificationEventType.SubscriberSubscribed,
    template: "SubscribedToStatusPage.hbs",
    sentence:
      "You will be the first to hear from us when there are any incidents, announcements or maintenance events.",
  },
  {
    eventType:
      StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceCreated,
    template: "SubscriberScheduledMaintenanceEventCreated.hbs",
    sentence:
      "A maintenance event has been announced for services you're subscribed to.",
  },
];

// The sentence an email's first InfoBlock says: info=(tHtml "...").
function introOfTheEmail(template: string): string {
  const text: string = fs.readFileSync(path.join(TEMPLATES, template), "utf8");
  const match: RegExpMatchArray | null = text.match(
    /\{\{> InfoBlock info=\(tHtml "([^"]+)"\)\}\}/,
  );

  return match?.[1] || "";
}

function starterEmail(
  eventType: StatusPageSubscriberNotificationEventType,
): string {
  return (
    getDefaultSubscriberNotificationTemplate(
      eventType,
      StatusPageSubscriberNotificationMethod.Email,
    )?.body || ""
  );
}

describe("the starters of custom subscriber emails", () => {
  for (const pair of PAIRS) {
    test(`${pair.eventType}: says what its email says, naming a maintenance event`, () => {
      const intro: string = introOfTheEmail(pair.template);
      const starter: string = starterEmail(pair.eventType);

      expect(intro).toBe(pair.sentence);
      expect(starter).toContain(intro);
      expect(starter).not.toMatch(OLD_NAME);
    });
  }
});
