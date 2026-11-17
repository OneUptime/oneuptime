import NotificationRuleEventType from "Common/Types/Workspace/NotificationRules/EventType";
import IncidentNotificationRule from "Common/Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
import WorkspaceType, {
  getWorkspaceTypeDisplayName,
} from "Common/Types/Workspace/WorkspaceType";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import WorkspaceChannelName from "Common/Utils/Workspace/WorkspaceChannelName";
import { canRuleCreateChannel } from "./NotificationRuleForm/NotificationRuleOwnChannel";

/*
 * WHAT TESTING A RULE THAT CREATES CHANNELS DOES, SAID BEFORE IT IS DONE
 * (#7265).
 *
 * Test Rule asked only 'Send a test notification for the rule "Page the
 * database team" to Slack.' For a rule that creates a channel for each
 * event, the test does more: it creates a real channel in the workspace -
 * named as the rule names its channels, with a few random letters for the
 * record (WorkspaceChannelName.forTest: prod-abcde, or test-abcde for a
 * rule without a prefix) - and invites the person testing to it
 * (WorkspaceNotificationRuleService.testRule). Somebody testing such a rule
 * found a new channel afterwards, which nothing had said would be there.
 * The dialog says so now, under its question, and only for such a rule:
 *
 *   - Slack and Mattermost: the channel, and that you are invited to it;
 *   - Microsoft Teams, whose channels belong to a team - nobody is invited
 *     to one - that everyone in the team can see it.
 *
 * The channel stays after the test, so it says how to be rid of it too.
 */

// The warning's place in the Test Rule dialog.
export const TEST_RULE_CHANNEL_WARNING_TEST_ID: string =
  "test-rule-creates-channel";

// The random letters Test Rule names its channel with, as an example of them.
export const TEST_RULE_CHANNEL_EXAMPLE_LETTERS: string = "abcde";

export const TEST_RULE_CREATES_CHANNEL_WARNING: string = translationKey(
  "This test also creates a real {{workspace}} channel, such as {{channel}}, and invites you to it. Archive it in {{workspace}} when you are done.",
);

export const TEST_RULE_CREATES_TEAMS_CHANNEL_WARNING: string = translationKey(
  "This test also creates a real channel in the rule's Microsoft Teams team, such as {{channel}}, which everyone in the team can see. Delete it in Microsoft Teams when you are done.",
);

/*
 * The name a rule's test channel is created by, with example letters
 * ("prod-abcde"), as the workspace writes a channel's name - a Slack
 * channel with its "#". Null for a rule that creates no channel: one that
 * only posts, or one of a kind that never has a channel of its own.
 */
export function getTestRuleChannelExample(data: {
  rule: IncidentNotificationRule | undefined;
  eventType: NotificationRuleEventType;
  workspaceType: WorkspaceType;
}): string | null {
  if (
    !data.rule ||
    !data.rule.shouldCreateNewChannel ||
    !canRuleCreateChannel(data.eventType)
  ) {
    return null;
  }

  const name: string = WorkspaceChannelName.getChannelName({
    workspaceType: data.workspaceType,
    prefix: WorkspaceChannelName.getPrefix(data.rule),
    parts: WorkspaceChannelName.forTest({
      randomText: TEST_RULE_CHANNEL_EXAMPLE_LETTERS,
    }),
  });

  return data.workspaceType === WorkspaceType.Slack ? `#${name}` : name;
}

/*
 * What the Test Rule dialog says a rule's test creates, in the reader's
 * language: undefined for a rule whose test only posts.
 */
export function getTestRuleChannelWarning(data: {
  rule: IncidentNotificationRule | undefined;
  eventType: NotificationRuleEventType;
  workspaceType: WorkspaceType;
  translator: Translator;
}): string | undefined {
  const channel: string | null = getTestRuleChannelExample(data);

  if (!channel) {
    return undefined;
  }

  if (data.workspaceType === WorkspaceType.MicrosoftTeams) {
    return data.translator.translateTemplate(
      TEST_RULE_CREATES_TEAMS_CHANNEL_WARNING,
      { channel: channel },
      { setsValuesApart: true },
    );
  }

  return data.translator.translateTemplate(
    TEST_RULE_CREATES_CHANNEL_WARNING,
    {
      workspace: getWorkspaceTypeDisplayName(data.workspaceType),
      channel: channel,
    },
    { setsValuesApart: true },
  );
}
