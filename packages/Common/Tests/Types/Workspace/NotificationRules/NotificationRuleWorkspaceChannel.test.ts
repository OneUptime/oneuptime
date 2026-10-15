import NotificationRuleWorkspaceChannel, {
  NotificationRuleWorkspaceChannelUtil,
} from "../../../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import { describe, expect, test } from "@jest/globals";

/*
 * Which rules a channel OneUptime created for a record belongs to: the rule
 * that asked for it first (notificationRuleId) and every rule that shares
 * it (notificationRuleIds). Channels stored before notificationRuleIds was
 * recorded have only notificationRuleId.
 */
describe("NotificationRuleWorkspaceChannelUtil.isChannelOfRule", () => {
  const SHARED_CHANNEL: NotificationRuleWorkspaceChannel = {
    id: "C0INC9",
    name: "incidents-inc-9",
    workspaceType: WorkspaceType.Slack,
    notificationRuleId: "rule-1",
    notificationRuleIds: ["rule-1", "rule-2"],
  };

  const STORED_CHANNEL: NotificationRuleWorkspaceChannel = {
    id: "C0INC8",
    name: "incidents-inc-8",
    workspaceType: WorkspaceType.Slack,
    notificationRuleId: "rule-1",
  };

  test("every rule that shares the channel is its rule", () => {
    for (const notificationRuleId of ["rule-1", "rule-2"]) {
      expect(
        NotificationRuleWorkspaceChannelUtil.isChannelOfRule({
          channel: SHARED_CHANNEL,
          notificationRuleId: notificationRuleId,
        }),
      ).toBe(true);
    }
  });

  test("a rule that did not ask for the channel is not", () => {
    expect(
      NotificationRuleWorkspaceChannelUtil.isChannelOfRule({
        channel: SHARED_CHANNEL,
        notificationRuleId: "rule-3",
      }),
    ).toBe(false);
  });

  test("a channel stored with only its first rule is that rule's, and no other's", () => {
    expect(
      NotificationRuleWorkspaceChannelUtil.isChannelOfRule({
        channel: STORED_CHANNEL,
        notificationRuleId: "rule-1",
      }),
    ).toBe(true);
    expect(
      NotificationRuleWorkspaceChannelUtil.isChannelOfRule({
        channel: STORED_CHANNEL,
        notificationRuleId: "rule-2",
      }),
    ).toBe(false);
  });

  test("a rule without an id has no channel, even one stored without a rule", () => {
    for (const notificationRuleId of [undefined, ""]) {
      expect(
        NotificationRuleWorkspaceChannelUtil.isChannelOfRule({
          channel: SHARED_CHANNEL,
          notificationRuleId: notificationRuleId,
        }),
      ).toBe(false);
      expect(
        NotificationRuleWorkspaceChannelUtil.isChannelOfRule({
          channel: {},
          notificationRuleId: notificationRuleId,
        }),
      ).toBe(false);
    }
  });

  /*
   * A record's channels are stored JSON, written by OneUptime - and by
   * anybody who may update the record through the API.
   */
  test("rule ids stored as something other than a list are not read", () => {
    for (const notificationRuleIds of ["rule-1,rule-2", { 0: "rule-2" }, 2]) {
      expect(
        NotificationRuleWorkspaceChannelUtil.isChannelOfRule({
          channel: {
            notificationRuleId: "rule-1",
            notificationRuleIds: notificationRuleIds as never,
          },
          notificationRuleId: "rule-2",
        }),
      ).toBe(false);
    }
  });
});
