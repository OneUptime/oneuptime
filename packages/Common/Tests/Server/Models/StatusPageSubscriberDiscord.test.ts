import { describe, expect, test } from "@jest/globals";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import StatusPageSubscriberNotificationMethod from "../../../Types/StatusPage/StatusPageSubscriberNotificationMethod";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";

/*
 * Discord status-page subscriber parity, model boundary.
 *
 * A subscriber channel exists in three model-level places: the webhook URL
 * and human-readable label on StatusPageSubscriber, and the disabled-by-
 * default enable flag on StatusPage. Slack and Microsoft Teams both carry
 * all three; these tests fail until Discord does too.
 *
 * The URL field must stay write-only (create access, no read/update) so a
 * read of a subscriber can never return the webhook credential.
 */

describe("StatusPageSubscriber Discord columns", () => {
  test("carries a Discord incoming webhook URL", () => {
    const subscriber: StatusPageSubscriber = new StatusPageSubscriber();
    expect(subscriber).toHaveProperty("discordIncomingWebhookUrl");
  });

  test("carries a readable Discord channel label", () => {
    const subscriber: StatusPageSubscriber = new StatusPageSubscriber();
    expect(subscriber).toHaveProperty("discordChannelName");
  });

  test("Discord webhook URL is never returned by reads or updates", () => {
    const subscriber: StatusPageSubscriber = new StatusPageSubscriber();
    const accessControl: ColumnAccessControl | null =
      subscriber.getColumnAccessControlFor("discordIncomingWebhookUrl");

    expect(accessControl).not.toBeNull();
    expect(accessControl?.read).toEqual([]);
    expect(accessControl?.update).toEqual([]);
  });

  test("Discord webhook URL accepts the same writer roles as Slack", () => {
    const subscriber: StatusPageSubscriber = new StatusPageSubscriber();
    const discordAccess: ColumnAccessControl | null =
      subscriber.getColumnAccessControlFor("discordIncomingWebhookUrl");
    const slackAccess: ColumnAccessControl | null =
      subscriber.getColumnAccessControlFor("slackIncomingWebhookUrl");

    expect(discordAccess?.create).toEqual(slackAccess?.create);
  });
});

describe("StatusPage Discord enable flag", () => {
  test("carries enableDiscordSubscribers", () => {
    const statusPage: StatusPage = new StatusPage();
    expect(statusPage).toHaveProperty("enableDiscordSubscribers");
  });
});

describe("StatusPageSubscriberNotificationMethod", () => {
  test("includes Discord", () => {
    expect(Object.values(StatusPageSubscriberNotificationMethod)).toContain(
      "Discord",
    );
  });
});
describe("StatusPageSubscriber Discord field keys", () => {
  /*
   * The public subscribe and update forms build their field lists as
   * SelectFormFields<StatusPageSubscriber>, a mapped type over keyof, so a
   * field name that is not a real key compiles away to a silent mismatch on
   * the webpack build and only fails the dedicated frontend tsconfig
   * typecheck. These assignments pin the exact keys the forms use.
   */
  test("discordChannelName is a real StatusPageSubscriber key", () => {
    const key: keyof StatusPageSubscriber = "discordChannelName";
    expect(new StatusPageSubscriber()).toHaveProperty(key);
  });

  test("discordIncomingWebhookUrl is a real StatusPageSubscriber key", () => {
    const key: keyof StatusPageSubscriber = "discordIncomingWebhookUrl";
    expect(new StatusPageSubscriber()).toHaveProperty(key);
  });
});
