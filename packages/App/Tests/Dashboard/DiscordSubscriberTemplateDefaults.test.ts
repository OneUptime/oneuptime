import { describe, expect, test } from "@jest/globals";
import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";
import {
  DefaultSubscriberNotificationTemplate,
  getDefaultSubscriberNotificationTemplate,
} from "../../FeatureSet/Dashboard/src/Utils/SubscriberNotificationTemplateDefaults";

/*
 * Discord subscriber notification parity, starter-template boundary.
 *
 * The template-variables parity test skips events whose defaults omit a
 * method entirely, so a missing Discord starter passes silently. These tests
 * hold the supported event/method matrix: every event with a Slack starter
 * also has a Discord starter using the same variables, and the lifecycle
 * events that are Email-only by design (confirmation, subscribed, manage)
 * stay Email-only for Discord. The manage template is the one of the three
 * that is also offered on Slack/Teams/Discord.
 */

const FLAT_EVENTS: Array<StatusPageSubscriberNotificationEventType> =
  Object.values(StatusPageSubscriberNotificationEventType).filter(
    (event: StatusPageSubscriberNotificationEventType): boolean => {
      return (
        event !== StatusPageSubscriberNotificationEventType.SubscriberReport
      );
    },
  );

const EMAIL_ONLY_LIFECYCLE_EVENTS: Array<StatusPageSubscriberNotificationEventType> =
  [
    StatusPageSubscriberNotificationEventType.SubscriberSubscriptionConfirmation,
    StatusPageSubscriberNotificationEventType.SubscriberSubscribed,
  ];

const EVENTS_WITH_CHAT_STARTERS: Array<StatusPageSubscriberNotificationEventType> =
  FLAT_EVENTS.filter(
    (event: StatusPageSubscriberNotificationEventType): boolean => {
      return !EMAIL_ONLY_LIFECYCLE_EVENTS.includes(event);
    },
  );

describe("Discord subscriber notification method", () => {
  test("the enum exposes Discord for template selection", () => {
    expect(StatusPageSubscriberNotificationMethod).toHaveProperty("Discord");
  });

  test.each(EVENTS_WITH_CHAT_STARTERS)(
    "%s has a Discord starter template wherever Slack does",
    (event: StatusPageSubscriberNotificationEventType) => {
      const starter: DefaultSubscriberNotificationTemplate | null =
        getDefaultSubscriberNotificationTemplate(
          event,
          StatusPageSubscriberNotificationMethod.Discord,
        );

      expect(starter).toBeDefined();
      expect(starter?.body.trim().length).toBeGreaterThan(0);
    },
  );

  test.each(EVENTS_WITH_CHAT_STARTERS)(
    "%s Discord starter only uses variables the workers provide",
    (event: StatusPageSubscriberNotificationEventType) => {
      const starter: DefaultSubscriberNotificationTemplate | null =
        getDefaultSubscriberNotificationTemplate(
          event,
          StatusPageSubscriberNotificationMethod.Discord,
        );
      const slackStarter: DefaultSubscriberNotificationTemplate | null =
        getDefaultSubscriberNotificationTemplate(
          event,
          StatusPageSubscriberNotificationMethod.Slack,
        );

      /*
       * The Slack starter is held to the worker variable list by the parity
       * test; requiring Discord to use a subset of the same variables keeps
       * Discord within the same guarantee without duplicating that list.
       */
      const variablesIn: (body: string | undefined) => Set<string> = (
        body: string | undefined,
      ): Set<string> => {
        return new Set(
          Array.from(
            (body || "").matchAll(/\{\{([\w.]+)\}\}/g),
            (match: RegExpMatchArray): string => {
              return match[1]!;
            },
          ),
        );
      };

      const discordVariables: Set<string> = variablesIn(starter?.body);
      const slackVariables: Set<string> = variablesIn(slackStarter?.body);

      for (const variable of discordVariables) {
        expect(slackVariables.has(variable)).toBe(true);
      }
    },
  );

  test.each(EMAIL_ONLY_LIFECYCLE_EVENTS)(
    "%s is Email-only by design and offers no Discord starter",
    (event: StatusPageSubscriberNotificationEventType) => {
      /*
       * Subscription confirmation and the subscribed notice are produced only
       * by the email path in StatusPageSubscriberService; the Discord welcome
       * is a fixed service message, not a starter template. Offering a
       * Discord starter here would imply a customization path the service
       * does not read.
       */
      expect(
        getDefaultSubscriberNotificationTemplate(
          event,
          StatusPageSubscriberNotificationMethod.Email,
        ),
      ).toBeDefined();

      expect(
        getDefaultSubscriberNotificationTemplate(
          event,
          StatusPageSubscriberNotificationMethod.Discord,
        ),
      ).toBeNull();
    },
  );

  test("manage subscription offers the same link template on Discord as on Slack", () => {
    const event: StatusPageSubscriberNotificationEventType =
      StatusPageSubscriberNotificationEventType.SubscriberManageSubscription;

    const discord: DefaultSubscriberNotificationTemplate | null =
      getDefaultSubscriberNotificationTemplate(
        event,
        StatusPageSubscriberNotificationMethod.Discord,
      );
    const slack: DefaultSubscriberNotificationTemplate | null =
      getDefaultSubscriberNotificationTemplate(
        event,
        StatusPageSubscriberNotificationMethod.Slack,
      );

    expect(discord).toBeDefined();
    expect(discord?.body).toBe(slack?.body);
    expect(discord?.body).toContain("{{manageSubscriptionUrl}}");
  });
});
