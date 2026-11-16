import { NotificationRuleUpdateKind } from "../../../../Types/Workspace/NotificationRules/NotificationRuleUpdates";
import WorkspaceRuleWorld, {
  makeRule,
  OTHER_RULE_ID,
  RULE_ID,
} from "./WorkspaceRuleWorld";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

/*
 * A CHANNEL TAKES AN INCIDENT'S STILL-OPEN REMINDERS, OR ITS CUSTOM FIELD
 * EDITS, ON THEIR OWN (#7937, #7938).
 *
 * The reminders that an incident is still open were posted as Everything
 * else, with linked alerts and subscribers who could not be notified, and
 * its custom field edits as Other edits, with its title, description and
 * labels: a channel could not take one without the other. Each is a box of
 * its own on a rule's Updates step now (Reminders, CustomFields). A rule
 * saved before them, with the old box ticked, has the new one ticked by the
 * upgrade (AddCustomFieldsAndRemindersToUpdatesToPost) and hears what it
 * always did.
 *
 * Driven through the real rule matching and posting against a fake Slack
 * API, as the incident's reminder job and update hook post: a reminder is
 * Reminders, an edit of the custom fields alone CustomFields, an edit of the
 * title and the custom fields Edits and CustomFields.
 */

const { Edits, CustomFields, Reminders, Other } = NotificationRuleUpdateKind;

const REMINDER: string = "🔔 Reminder sent to owners of Incident INC-42";
const LINKED_ALERT: string = "🔗 Linked alert ALT-7";
const CUSTOM_FIELD_EDIT: string = "📝 Custom Fields: Customer Impact: High";
const TITLE_EDIT: string = "✏️ Changed the title";
const TITLE_AND_CUSTOM_FIELD_EDIT: string =
  "✏️ Changed the title and 📝 Custom Fields: Ticket: OPS-7";

// Two channels the rules name: each test says what each rule posts there.
const FIRST_CHANNEL: string = "C0FIRST";
const SECOND_CHANNEL: string = "C0SECOND";

let world: WorkspaceRuleWorld;

beforeEach(() => {
  world = new WorkspaceRuleWorld();
  world.install();
  world.addSlackChannel({ id: FIRST_CHANNEL, name: "first" });
  world.addSlackChannel({ id: SECOND_CHANNEL, name: "second" });
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The messages a channel got, as one text.
function textIn(channelId: string): string {
  return world.slackMessagesIn(channelId).join("\n");
}

describe("the still-open reminders, a box of their own (#7938)", () => {
  test("REGRESSION: a channel that wants the reminders and not the rest gets the reminders alone", async () => {
    world.rules = [
      makeRule({
        id: RULE_ID,
        createsChannel: false,
        existingChannels: "first",
        updatesToPost: [Reminders],
      }),
    ];

    await world.postAboutIncident(REMINDER, [Reminders]);
    await world.postAboutIncident(LINKED_ALERT, [Other]);

    expect(textIn(FIRST_CHANNEL)).toContain("Reminder sent to owners");
    expect(textIn(FIRST_CHANNEL)).not.toContain("Linked alert");
  });

  test("REGRESSION: a channel that wants everything else and not the reminders gets the rest alone", async () => {
    world.rules = [
      makeRule({
        id: RULE_ID,
        createsChannel: false,
        existingChannels: "second",
        updatesToPost: [Other],
      }),
    ];

    await world.postAboutIncident(REMINDER, [Reminders]);
    await world.postAboutIncident(LINKED_ALERT, [Other]);

    expect(textIn(SECOND_CHANNEL)).toContain("Linked alert");
    expect(textIn(SECOND_CHANNEL)).not.toContain("Reminder sent to owners");
  });

  test("a rule saved with Everything else, as the upgrade rewrote it, still gets the reminders", async () => {
    world.rules = [
      makeRule({
        id: RULE_ID,
        createsChannel: false,
        existingChannels: "second",
        // [Other] before the upgrade; the upgrade adds Reminders.
        updatesToPost: [Other, Reminders],
      }),
    ];

    await world.postAboutIncident(REMINDER, [Reminders]);
    await world.postAboutIncident(LINKED_ALERT, [Other]);

    expect(world.slackMessagesIn(SECOND_CHANNEL)).toHaveLength(2);
  });

  test("a rule that posts every update gets both, as it always did", async () => {
    world.rules = [
      makeRule({
        id: RULE_ID,
        createsChannel: false,
        existingChannels: "second",
      }),
    ];

    await world.postAboutIncident(REMINDER, [Reminders]);
    await world.postAboutIncident(LINKED_ALERT, [Other]);

    expect(world.slackMessagesIn(SECOND_CHANNEL)).toHaveLength(2);
  });
});

describe("custom field edits, a box of their own (#7937)", () => {
  async function postEdits(): Promise<void> {
    await world.postAboutIncident(CUSTOM_FIELD_EDIT, [CustomFields]);
    await world.postAboutIncident(TITLE_EDIT, [Edits]);
    await world.postAboutIncident(TITLE_AND_CUSTOM_FIELD_EDIT, [
      Edits,
      CustomFields,
    ]);
  }

  test("REGRESSION: an edit of the custom fields alone reaches a rule that ticks Custom field changes, and not one that ticks only Other edits", async () => {
    world.rules = [
      makeRule({
        id: RULE_ID,
        createsChannel: false,
        existingChannels: "first",
        updatesToPost: [CustomFields],
      }),
      makeRule({
        id: OTHER_RULE_ID,
        createsChannel: false,
        existingChannels: "second",
        updatesToPost: [Edits],
      }),
    ];

    await postEdits();

    // The custom fields' channel: the custom field edit, and the edit of both.
    expect(world.slackMessagesIn(FIRST_CHANNEL)).toHaveLength(2);
    expect(textIn(FIRST_CHANNEL)).toContain("Customer Impact");
    expect(textIn(FIRST_CHANNEL)).toContain("OPS-7");

    // Other edits' channel: the title edit, and the edit of both.
    expect(world.slackMessagesIn(SECOND_CHANNEL)).toHaveLength(2);
    expect(textIn(SECOND_CHANNEL)).not.toContain("Customer Impact");
    expect(textIn(SECOND_CHANNEL)).toContain("OPS-7");
  });

  test("a rule saved with Other edits, as the upgrade rewrote it, still gets every edit", async () => {
    world.rules = [
      makeRule({
        id: RULE_ID,
        createsChannel: false,
        existingChannels: "second",
        // [Edits] before the upgrade; the upgrade adds CustomFields.
        updatesToPost: [Edits, CustomFields],
      }),
    ];

    await postEdits();

    expect(world.slackMessagesIn(SECOND_CHANNEL)).toHaveLength(3);
  });

  test("an edit of the title and the custom fields is posted once where both are ticked", async () => {
    world.rules = [
      makeRule({
        id: RULE_ID,
        createsChannel: false,
        existingChannels: "second",
        updatesToPost: [Edits, CustomFields],
      }),
      makeRule({
        id: OTHER_RULE_ID,
        createsChannel: false,
        existingChannels: "second",
        updatesToPost: [CustomFields],
      }),
    ];

    await world.postAboutIncident(TITLE_AND_CUSTOM_FIELD_EDIT, [
      Edits,
      CustomFields,
    ]);

    expect(world.slackMessagesIn(SECOND_CHANNEL)).toHaveLength(1);
  });
});
