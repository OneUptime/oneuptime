import WorkspaceRefusal, {
  MATTERMOST_ACCOUNT_NOT_FOUND_REFUSAL,
  MATTERMOST_CHANNEL_ARCHIVED_REFUSAL,
  MATTERMOST_MESSAGE_TOO_LONG_REFUSAL,
  MATTERMOST_NAME_TAKEN_REFUSAL,
  MATTERMOST_NOT_ALLOWED_REFUSAL,
  MATTERMOST_NOT_CONNECTED_REFUSAL,
  MATTERMOST_NOT_FOUND_REFUSAL,
  MATTERMOST_NOT_IN_TEAM_REFUSAL,
  MATTERMOST_RATE_LIMITED_REFUSAL,
  MATTERMOST_REFUSALS,
  MATTERMOST_UNAVAILABLE_REFUSAL,
  MATTERMOST_UNKNOWN_REFUSAL_REASON,
  MICROSOFT_TEAMS_APP_DISABLED_REFUSAL,
  MICROSOFT_TEAMS_APP_NOT_IN_TEAM_REFUSAL,
  MICROSOFT_TEAMS_BLOCKED_BY_USER_REFUSAL,
  MICROSOFT_TEAMS_MESSAGE_GONE_REFUSAL,
  MICROSOFT_TEAMS_MESSAGE_TOO_LARGE_REFUSAL,
  MICROSOFT_TEAMS_MISSING_PERMISSION_REFUSAL,
  MICROSOFT_TEAMS_NAME_TAKEN_REFUSAL,
  MICROSOFT_TEAMS_NOT_CONNECTED_REFUSAL,
  MICROSOFT_TEAMS_NOT_FOUND_REFUSAL,
  MICROSOFT_TEAMS_RATE_LIMITED_REFUSAL,
  MICROSOFT_TEAMS_REFUSALS,
  MICROSOFT_TEAMS_UNAVAILABLE_REFUSAL,
  MICROSOFT_TEAMS_UNKNOWN_REFUSAL_REASON,
  SLACK_ACCOUNT_NOT_FOUND_REFUSAL,
  SLACK_BOT_NOT_IN_CHANNEL_REFUSAL,
  SLACK_CANNOT_JOIN_REFUSAL,
  SLACK_CHANNEL_ALREADY_ARCHIVED_REFUSAL,
  SLACK_CHANNEL_ARCHIVED_REFUSAL,
  SLACK_CHANNEL_KIND_REFUSAL,
  SLACK_CHANNEL_NOT_FOUND_REFUSAL,
  SLACK_EXPIRED_REFUSAL,
  SLACK_INVALID_NAME_REFUSAL,
  SLACK_MESSAGE_GONE_REFUSAL,
  SLACK_MESSAGE_LOCKED_REFUSAL,
  SLACK_MESSAGE_TOO_LONG_REFUSAL,
  SLACK_MISSING_PERMISSION_REFUSAL,
  SLACK_NAME_TAKEN_REFUSAL,
  SLACK_NOT_CONNECTED_REFUSAL,
  SLACK_OUTDATED_REFUSAL,
  SLACK_RATE_LIMITED_REFUSAL,
  SLACK_REFUSALS,
  SLACK_RESTRICTED_REFUSAL,
  SLACK_UNAVAILABLE_REFUSAL,
  SLACK_UNKNOWN_REFUSAL_REASON,
  SLACK_UNREADABLE_REQUEST_REFUSAL,
  SLACK_WORKSPACE_NOT_ADDED_REFUSAL,
  WorkspaceRefusalFamily,
  WorkspaceRefusalReading,
} from "../../../Utils/Workspace/WorkspaceRefusal";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { meetsErrorMessageRule } from "../../../Types/Exception/ErrorMessageRule";
import { describe, expect, test } from "@jest/globals";

/*
 * #7119, #7121: every refusal Slack, Microsoft Teams and Mattermost answer
 * OneUptime with reads as what happened and what to do, with the
 * workspace's own answer kept after it for support - and a Notification
 * Logs row written before this ("Error from Slack is_archived") reads the
 * same way.
 */

/*
 * Every Slack code OneUptime words, with the family it reads as: written
 * out here, not read from SLACK_REFUSALS, so a code dropped from a family
 * - or moved to another - fails its own line.
 */
const SLACK_CODES: ReadonlyArray<[string, WorkspaceRefusalFamily]> = [
  ["channel_not_found", SLACK_CHANNEL_NOT_FOUND_REFUSAL],
  ["duplicate_channel_not_found", SLACK_CHANNEL_NOT_FOUND_REFUSAL],
  ["not_in_channel", SLACK_BOT_NOT_IN_CHANNEL_REFUSAL],
  ["is_archived", SLACK_CHANNEL_ARCHIVED_REFUSAL],
  ["already_archived", SLACK_CHANNEL_ALREADY_ARCHIVED_REFUSAL],
  ["invalid_auth", SLACK_NOT_CONNECTED_REFUSAL],
  ["not_authed", SLACK_NOT_CONNECTED_REFUSAL],
  ["account_inactive", SLACK_NOT_CONNECTED_REFUSAL],
  ["token_revoked", SLACK_NOT_CONNECTED_REFUSAL],
  ["token_expired", SLACK_NOT_CONNECTED_REFUSAL],
  ["not_allowed_token_type", SLACK_NOT_CONNECTED_REFUSAL],
  ["missing_scope", SLACK_MISSING_PERMISSION_REFUSAL],
  ["no_permission", SLACK_MISSING_PERMISSION_REFUSAL],
  ["team_access_not_granted", SLACK_WORKSPACE_NOT_ADDED_REFUSAL],
  ["ratelimited", SLACK_RATE_LIMITED_REFUSAL],
  ["rate_limited", SLACK_RATE_LIMITED_REFUSAL],
  ["message_limit_exceeded", SLACK_RATE_LIMITED_REFUSAL],
  ["http_429", SLACK_RATE_LIMITED_REFUSAL],
  ["msg_too_long", SLACK_MESSAGE_TOO_LONG_REFUSAL],
  ["too_many_attachments", SLACK_MESSAGE_TOO_LONG_REFUSAL],
  ["attachment_payload_limit_exceeded", SLACK_MESSAGE_TOO_LONG_REFUSAL],
  ["metadata_too_large", SLACK_MESSAGE_TOO_LONG_REFUSAL],
  ["view_too_large", SLACK_MESSAGE_TOO_LONG_REFUSAL],
  ["invalid_blocks", SLACK_UNREADABLE_REQUEST_REFUSAL],
  ["invalid_blocks_format", SLACK_UNREADABLE_REQUEST_REFUSAL],
  ["invalid_attachments", SLACK_UNREADABLE_REQUEST_REFUSAL],
  ["no_text", SLACK_UNREADABLE_REQUEST_REFUSAL],
  ["invalid_arguments", SLACK_UNREADABLE_REQUEST_REFUSAL],
  ["invalid_arg_name", SLACK_UNREADABLE_REQUEST_REFUSAL],
  ["invalid_array_arg", SLACK_UNREADABLE_REQUEST_REFUSAL],
  ["invalid_charset", SLACK_UNREADABLE_REQUEST_REFUSAL],
  ["invalid_form_data", SLACK_UNREADABLE_REQUEST_REFUSAL],
  ["invalid_post_type", SLACK_UNREADABLE_REQUEST_REFUSAL],
  ["missing_post_type", SLACK_UNREADABLE_REQUEST_REFUSAL],
  ["invalid_json", SLACK_UNREADABLE_REQUEST_REFUSAL],
  ["json_not_object", SLACK_UNREADABLE_REQUEST_REFUSAL],
  ["invalid_metadata_format", SLACK_UNREADABLE_REQUEST_REFUSAL],
  ["invalid_metadata_schema", SLACK_UNREADABLE_REQUEST_REFUSAL],
  ["invalid_cursor", SLACK_UNREADABLE_REQUEST_REFUSAL],
  ["invalid_ts_latest", SLACK_UNREADABLE_REQUEST_REFUSAL],
  ["invalid_ts_oldest", SLACK_UNREADABLE_REQUEST_REFUSAL],
  ["restricted_action", SLACK_RESTRICTED_REFUSAL],
  ["restricted_action_read_only_channel", SLACK_RESTRICTED_REFUSAL],
  ["restricted_action_thread_only_channel", SLACK_RESTRICTED_REFUSAL],
  ["restricted_action_non_threadable_channel", SLACK_RESTRICTED_REFUSAL],
  ["restricted_action_thread_locked", SLACK_RESTRICTED_REFUSAL],
  ["posting_to_general_channel_denied", SLACK_RESTRICTED_REFUSAL],
  ["cannot_reply_to_message", SLACK_RESTRICTED_REFUSAL],
  ["ekm_access_denied", SLACK_RESTRICTED_REFUSAL],
  ["enterprise_is_restricted", SLACK_RESTRICTED_REFUSAL],
  ["access_denied", SLACK_RESTRICTED_REFUSAL],
  ["not_allowed", SLACK_RESTRICTED_REFUSAL],
  ["messages_tab_disabled", SLACK_RESTRICTED_REFUSAL],
  ["slack_connect_file_link_sharing_blocked", SLACK_RESTRICTED_REFUSAL],
  ["slack_connect_canvas_sharing_blocked", SLACK_RESTRICTED_REFUSAL],
  ["name_taken", SLACK_NAME_TAKEN_REFUSAL],
  ["invalid_name", SLACK_INVALID_NAME_REFUSAL],
  ["invalid_name_required", SLACK_INVALID_NAME_REFUSAL],
  ["invalid_name_punctuation", SLACK_INVALID_NAME_REFUSAL],
  ["invalid_name_maxlength", SLACK_INVALID_NAME_REFUSAL],
  ["invalid_name_specials", SLACK_INVALID_NAME_REFUSAL],
  ["no_channel", SLACK_INVALID_NAME_REFUSAL],
  ["user_not_found", SLACK_ACCOUNT_NOT_FOUND_REFUSAL],
  ["users_not_found", SLACK_ACCOUNT_NOT_FOUND_REFUSAL],
  ["no_user", SLACK_ACCOUNT_NOT_FOUND_REFUSAL],
  ["user_disabled", SLACK_ACCOUNT_NOT_FOUND_REFUSAL],
  ["invalid_users", SLACK_ACCOUNT_NOT_FOUND_REFUSAL],
  ["user_not_visible", SLACK_ACCOUNT_NOT_FOUND_REFUSAL],
  ["user_is_restricted", SLACK_CANNOT_JOIN_REFUSAL],
  ["user_is_ultra_restricted", SLACK_CANNOT_JOIN_REFUSAL],
  ["ura_max_channels", SLACK_CANNOT_JOIN_REFUSAL],
  ["cant_invite", SLACK_CANNOT_JOIN_REFUSAL],
  ["cant_invite_self", SLACK_CANNOT_JOIN_REFUSAL],
  ["service_unavailable", SLACK_UNAVAILABLE_REFUSAL],
  ["internal_error", SLACK_UNAVAILABLE_REFUSAL],
  ["fatal_error", SLACK_UNAVAILABLE_REFUSAL],
  ["request_timeout", SLACK_UNAVAILABLE_REFUSAL],
  ["team_added_to_org", SLACK_UNAVAILABLE_REFUSAL],
  ["org_login_required", SLACK_UNAVAILABLE_REFUSAL],
  ["no_answer", SLACK_UNAVAILABLE_REFUSAL],
  ["message_not_found", SLACK_MESSAGE_GONE_REFUSAL],
  ["thread_not_found", SLACK_MESSAGE_GONE_REFUSAL],
  ["cant_update_message", SLACK_MESSAGE_LOCKED_REFUSAL],
  ["edit_window_closed", SLACK_MESSAGE_LOCKED_REFUSAL],
  ["cant_delete_message", SLACK_MESSAGE_LOCKED_REFUSAL],
  ["compliance_exports_prevent_deletion", SLACK_MESSAGE_LOCKED_REFUSAL],
  ["expired_trigger_id", SLACK_EXPIRED_REFUSAL],
  ["invalid_trigger_id", SLACK_EXPIRED_REFUSAL],
  ["exchanged_trigger_id", SLACK_EXPIRED_REFUSAL],
  ["expired_url", SLACK_EXPIRED_REFUSAL],
  ["used_url", SLACK_EXPIRED_REFUSAL],
  ["method_not_supported_for_channel_type", SLACK_CHANNEL_KIND_REFUSAL],
  ["cant_archive_general", SLACK_CHANNEL_KIND_REFUSAL],
  ["cant_archive_required", SLACK_CHANNEL_KIND_REFUSAL],
  ["cant_kick_from_general", SLACK_CHANNEL_KIND_REFUSAL],
  ["deprecated_endpoint", SLACK_OUTDATED_REFUSAL],
  ["method_deprecated", SLACK_OUTDATED_REFUSAL],
  ["unknown_method", SLACK_OUTDATED_REFUSAL],
];

// Every family's reason: a sentence, more than an empty phrase.
const ALL_REASONS: ReadonlyArray<string> = [
  ...SLACK_REFUSALS.map((family: WorkspaceRefusalFamily): string => {
    return family.reason;
  }),
  SLACK_UNKNOWN_REFUSAL_REASON,
  ...MICROSOFT_TEAMS_REFUSALS.map((family: WorkspaceRefusalFamily): string => {
    return family.reason;
  }),
  MICROSOFT_TEAMS_UNKNOWN_REFUSAL_REASON,
  ...MATTERMOST_REFUSALS.map((family: WorkspaceRefusalFamily): string => {
    return family.reason;
  }),
  MATTERMOST_UNKNOWN_REFUSAL_REASON,
];

describe("WorkspaceRefusal: Slack's codes", () => {
  test.each(SLACK_CODES)(
    "%s reads as its family's words",
    (code: string, family: WorkspaceRefusalFamily) => {
      expect(WorkspaceRefusal.getSlackFamily(code)).toBe(family);
      expect(WorkspaceRefusal.getSlackReason(code)).toBe(family.reason);
    },
  );

  test("every code a family names is listed above, once", () => {
    const listed: Array<string> = SLACK_CODES.map(
      (entry: [string, WorkspaceRefusalFamily]): string => {
        return entry[0];
      },
    );

    const named: Array<string> = SLACK_REFUSALS.flatMap(
      (family: WorkspaceRefusalFamily): ReadonlyArray<string> => {
        return family.codes;
      },
    );

    expect([...named].sort()).toEqual([...listed].sort());
    expect(new Set(named).size).toBe(named.length);
  });

  test("the codes the issue names read as a person's next step, not the code", () => {
    expect(WorkspaceRefusal.describeSlackRefusal("is_archived")).toBe(
      "The Slack channel is archived. Unarchive it in Slack, or pick another channel. Slack said: is_archived.",
    );
    expect(WorkspaceRefusal.describeSlackRefusal("not_in_channel")).toBe(
      "OneUptime's bot is not in the Slack channel. Invite the bot to the channel in Slack, then try again. Slack said: not_in_channel.",
    );
    expect(WorkspaceRefusal.describeSlackRefusal("ratelimited")).toBe(
      "Slack asked OneUptime to slow down. Wait a minute, then try again. Slack said: ratelimited.",
    );
    expect(WorkspaceRefusal.describeSlackRefusal("token_revoked")).toBe(
      "OneUptime's connection to Slack no longer works. Please ask a Project Admin to reconnect Slack in Project Settings > Workspace > Slack. Slack said: token_revoked.",
    );
  });

  test("an HTTP answer of 500 or more reads as Slack being unavailable", () => {
    expect(WorkspaceRefusal.getSlackFamily("http_503")).toBe(
      SLACK_UNAVAILABLE_REFUSAL,
    );
    expect(WorkspaceRefusal.getSlackFamily("http_500")).toBe(
      SLACK_UNAVAILABLE_REFUSAL,
    );
    expect(WorkspaceRefusal.getSlackFamily("http_404")).toBeUndefined();
  });

  test("a code OneUptime does not know keeps Slack's answer after its own words", () => {
    expect(WorkspaceRefusal.getSlackFamily("some_new_code")).toBeUndefined();
    expect(WorkspaceRefusal.describeSlackRefusal("some_new_code")).toBe(
      `${SLACK_UNKNOWN_REFUSAL_REASON} Slack said: some_new_code.`,
    );
  });

  test("a refusal with no code at all is the unknown one, with nothing after it", () => {
    expect(WorkspaceRefusal.describeSlackRefusal("")).toBe(
      SLACK_UNKNOWN_REFUSAL_REASON,
    );
    expect(WorkspaceRefusal.describeSlackRefusal(undefined)).toBe(
      SLACK_UNKNOWN_REFUSAL_REASON,
    );
  });

  test("the code is read back from a message, new and old", () => {
    expect(
      WorkspaceRefusal.getSlackCodeOfMessage(
        WorkspaceRefusal.describeSlackRefusal("name_taken"),
      ),
    ).toBe("name_taken");
    expect(
      WorkspaceRefusal.getSlackCodeOfMessage("Error from Slack name_taken"),
    ).toBe("name_taken");
    expect(
      WorkspaceRefusal.getSlackCodeOfMessage(
        "Cannot create a new channel. Error from Slack invalid_name_specials",
      ),
    ).toBe("invalid_name_specials");
    expect(
      WorkspaceRefusal.getSlackCodeOfMessage("Error from Slack undefined"),
    ).toBeNull();
    expect(
      WorkspaceRefusal.getSlackCodeOfMessage("The channel was renamed."),
    ).toBeNull();
    expect(WorkspaceRefusal.getSlackCodeOfMessage("")).toBeNull();
  });
});

describe("WorkspaceRefusal: Microsoft Teams' answers", () => {
  test.each([
    [
      "BotNotInConversationRoster",
      403,
      MICROSOFT_TEAMS_APP_NOT_IN_TEAM_REFUSAL,
    ],
    ["ConversationBlockedByUser", 403, MICROSOFT_TEAMS_BLOCKED_BY_USER_REFUSAL],
    ["BotDisabledByAdmin", 403, MICROSOFT_TEAMS_APP_DISABLED_REFUSAL],
    ["InvalidAuthenticationToken", 401, MICROSOFT_TEAMS_NOT_CONNECTED_REFUSAL],
    ["Unauthorized", undefined, MICROSOFT_TEAMS_NOT_CONNECTED_REFUSAL],
    [
      "Authorization_RequestDenied",
      403,
      MICROSOFT_TEAMS_MISSING_PERMISSION_REFUSAL,
    ],
    [
      "ActivityNotFoundInConversation",
      404,
      MICROSOFT_TEAMS_MESSAGE_GONE_REFUSAL,
    ],
    ["ConversationNotFound", 404, MICROSOFT_TEAMS_NOT_FOUND_REFUSAL],
    ["NameAlreadyExists", 400, MICROSOFT_TEAMS_NAME_TAKEN_REFUSAL],
    ["MessageSizeTooBig", 413, MICROSOFT_TEAMS_MESSAGE_TOO_LARGE_REFUSAL],
    ["Throttled", 429, MICROSOFT_TEAMS_RATE_LIMITED_REFUSAL],
    ["TooManyRequests", 429, MICROSOFT_TEAMS_RATE_LIMITED_REFUSAL],
    ["ServiceError", 502, MICROSOFT_TEAMS_UNAVAILABLE_REFUSAL],
    ["ECONNRESET", undefined, MICROSOFT_TEAMS_UNAVAILABLE_REFUSAL],
  ])(
    "%s (%s) reads as its family's words",
    (
      code: string,
      statusCode: number | undefined,
      family: WorkspaceRefusalFamily,
    ) => {
      expect(
        WorkspaceRefusal.getMicrosoftTeamsFamily({
          code: code,
          statusCode: statusCode,
        }),
      ).toBe(family);
    },
  );

  test.each([
    [401, MICROSOFT_TEAMS_NOT_CONNECTED_REFUSAL],
    [403, MICROSOFT_TEAMS_MISSING_PERMISSION_REFUSAL],
    [404, MICROSOFT_TEAMS_NOT_FOUND_REFUSAL],
    [409, MICROSOFT_TEAMS_NAME_TAKEN_REFUSAL],
    [413, MICROSOFT_TEAMS_MESSAGE_TOO_LARGE_REFUSAL],
    [429, MICROSOFT_TEAMS_RATE_LIMITED_REFUSAL],
    [500, MICROSOFT_TEAMS_UNAVAILABLE_REFUSAL],
    [503, MICROSOFT_TEAMS_UNAVAILABLE_REFUSAL],
    [507, MICROSOFT_TEAMS_UNAVAILABLE_REFUSAL],
  ])(
    "a status of %s with a code of its own reads by its status",
    (statusCode: number, family: WorkspaceRefusalFamily) => {
      expect(
        WorkspaceRefusal.getMicrosoftTeamsFamily({
          statusCode: statusCode,
          code: "SomethingElse",
        }),
      ).toBe(family);
    },
  );

  test("Teams' status, code and words are kept after OneUptime's", () => {
    expect(
      WorkspaceRefusal.describeMicrosoftTeamsRefusal({
        statusCode: 403,
        code: "ConversationBlockedByUser",
        message: "User blocked the conversation with the bot.",
      }),
    ).toBe(
      `${MICROSOFT_TEAMS_BLOCKED_BY_USER_REFUSAL.reason} Microsoft Teams said: 403 ConversationBlockedByUser: User blocked the conversation with the bot.`,
    );
  });

  test("an answer OneUptime does not know is still said, and kept", () => {
    expect(
      WorkspaceRefusal.describeMicrosoftTeamsRefusal({
        statusCode: 400,
        code: "BadArgument",
      }),
    ).toBe(
      `${MICROSOFT_TEAMS_UNKNOWN_REFUSAL_REASON} Microsoft Teams said: 400 BadArgument.`,
    );
  });

  test("an answer OneUptime does not know, with Microsoft's words: those words are the reason", () => {
    expect(
      WorkspaceRefusal.describeMicrosoftTeamsRefusal({
        statusCode: 400,
        code: "BadRequest",
        message: "Channel name is not valid.",
      }),
    ).toBe(
      "Microsoft Teams refused the request: Channel name is not valid. Microsoft Teams said: 400 BadRequest.",
    );
  });

  test("the roster's words read as the app not in the team, whatever the code says", () => {
    expect(
      WorkspaceRefusal.getMicrosoftTeamsFamily({
        statusCode: 403,
        code: "Forbidden",
        message: "The bot is not part of the conversation roster.",
      }),
    ).toBe(MICROSOFT_TEAMS_APP_NOT_IN_TEAM_REFUSAL);
  });
});

describe("WorkspaceRefusal: Mattermost's answers", () => {
  test.each([
    [
      401,
      "api.context.session_expired.app_error",
      MATTERMOST_NOT_CONNECTED_REFUSAL,
    ],
    [
      403,
      "api.post.create_post.can_not_post_to_deleted.error",
      MATTERMOST_CHANNEL_ARCHIVED_REFUSAL,
    ],
    [
      400,
      "store.sql_channel.save_channel.exists.app_error",
      MATTERMOST_NAME_TAKEN_REFUSAL,
    ],
    [
      404,
      "app.team.get_member.missing.app_error",
      MATTERMOST_NOT_IN_TEAM_REFUSAL,
    ],
    [
      404,
      "store.sql_team.get_member.missing.app_error",
      MATTERMOST_NOT_IN_TEAM_REFUSAL,
    ],
    [
      403,
      "api.channel.add_user.to.channel.failed.deleted.app_error",
      MATTERMOST_NOT_IN_TEAM_REFUSAL,
    ],
    [
      404,
      "app.user.missing_account.const",
      MATTERMOST_ACCOUNT_NOT_FOUND_REFUSAL,
    ],
    [
      403,
      "app.channel.add_member.deleted_user.app_error",
      MATTERMOST_ACCOUNT_NOT_FOUND_REFUSAL,
    ],
    [403, "api.context.permissions.app_error", MATTERMOST_NOT_ALLOWED_REFUSAL],
    [404, "app.channel.get.existing.app_error", MATTERMOST_NOT_FOUND_REFUSAL],
    [
      400,
      "model.post.is_valid.msg.app_error",
      MATTERMOST_MESSAGE_TOO_LONG_REFUSAL,
    ],
    [413, "", MATTERMOST_MESSAGE_TOO_LONG_REFUSAL],
    [429, "", MATTERMOST_RATE_LIMITED_REFUSAL],
    [500, "", MATTERMOST_UNAVAILABLE_REFUSAL],
    [503, "", MATTERMOST_UNAVAILABLE_REFUSAL],
  ])(
    "%s %s reads as its family's words",
    (statusCode: number, errorId: string, family: WorkspaceRefusalFamily) => {
      expect(
        WorkspaceRefusal.getMattermostFamily({
          statusCode: statusCode,
          errorId: errorId,
        }),
      ).toBe(family);
    },
  );

  test("Mattermost's own words are kept after OneUptime's", () => {
    expect(
      WorkspaceRefusal.describeMattermostRefusal({
        statusCode: 403,
        errorId: "api.context.permissions.app_error",
        message: "You do not have the appropriate permissions.",
      }),
    ).toBe(
      `${MATTERMOST_NOT_ALLOWED_REFUSAL.reason} Mattermost said: You do not have the appropriate permissions.`,
    );
  });

  test("an answer OneUptime does not know says Mattermost's words, its status and id after them", () => {
    expect(
      WorkspaceRefusal.describeMattermostRefusal({
        statusCode: 400,
        errorId: "api.post.create_post.root_id.app_error",
        message: "Invalid RootId parameter.",
      }),
    ).toBe(
      "Mattermost refused the request: Invalid RootId parameter. Mattermost said: HTTP 400 api.post.create_post.root_id.app_error.",
    );
  });

  test("an answer with no words keeps its status", () => {
    expect(
      WorkspaceRefusal.describeMattermostRefusal({
        statusCode: 400,
        errorId: "",
        message: "",
      }),
    ).toBe(`${MATTERMOST_UNKNOWN_REFUSAL_REASON} Mattermost said: HTTP 400.`);
  });
});

describe("WorkspaceRefusal: every reason is a sentence a person can act on", () => {
  test.each(
    ALL_REASONS.map((reason: string): [string] => {
      return [reason];
    }),
  )("%s", (reason: string) => {
    expect(meetsErrorMessageRule(reason)).toBe(true);
    // OneUptime's words, never a code.
    expect(reason).not.toMatch(/\b[a-z]+_[a-z_]+\b/);
  });

  test("a reason with Slack's answer after it is still one sentence by the rule", () => {
    expect(
      meetsErrorMessageRule(
        WorkspaceRefusal.describeSlackRefusal("is_archived"),
      ),
    ).toBe(true);
  });
});

describe("WorkspaceRefusal.read: a status message as a person reads it", () => {
  const read: (
    message: string,
    workspaceType?: WorkspaceType,
  ) => WorkspaceRefusalReading = (
    message: string,
    workspaceType?: WorkspaceType,
  ): WorkspaceRefusalReading => {
    return WorkspaceRefusal.read({
      message: message,
      workspaceType: workspaceType,
    });
  };

  test("a refusal written now: the reason, and Slack's code apart", () => {
    expect(read(WorkspaceRefusal.describeSlackRefusal("is_archived"))).toEqual({
      reason: SLACK_CHANNEL_ARCHIVED_REFUSAL.reason,
      detail: "is_archived",
    });
  });

  test("REGRESSION: a row written before this, a raw code, reads in words", () => {
    expect(read("Error from Slack is_archived")).toEqual({
      reason: SLACK_CHANNEL_ARCHIVED_REFUSAL.reason,
      detail: "is_archived",
    });
    expect(read("Error from Slack not_in_channel")).toEqual({
      reason: SLACK_BOT_NOT_IN_CHANNEL_REFUSAL.reason,
      detail: "not_in_channel",
    });
  });

  test("what an old row said before the code stays", () => {
    expect(
      read(
        "Cannot invite users to the channel. Error from Slack missing_scope",
      ),
    ).toEqual({
      reason: `Cannot invite users to the channel. ${SLACK_MISSING_PERMISSION_REFUSAL.reason}`,
      detail: "missing_scope",
    });
  });

  test("an old row whose code was lost reads as the unknown refusal", () => {
    expect(read("Error from Slack undefined")).toEqual({
      reason: SLACK_UNKNOWN_REFUSAL_REASON,
    });
    expect(read("Error from Slack ")).toEqual({
      reason: SLACK_UNKNOWN_REFUSAL_REASON,
    });
  });

  test("Slack's bare code on a Slack row - what an HTTP 429 gave - reads in words", () => {
    expect(read("ratelimited", WorkspaceType.Slack)).toEqual({
      reason: SLACK_RATE_LIMITED_REFUSAL.reason,
      detail: "ratelimited",
    });
    // Another workspace's row is not read as Slack's.
    expect(read("ratelimited", WorkspaceType.Mattermost)).toEqual({
      reason: "ratelimited",
    });
  });

  test("an old Mattermost row OneUptime knows the words of reads in its own words", () => {
    expect(
      read(
        "Error from Mattermost: Invalid or expired session, please login again.",
      ),
    ).toEqual({
      reason: MATTERMOST_NOT_CONNECTED_REFUSAL.reason,
      detail: "Invalid or expired session, please login again.",
    });
  });

  test("an old Mattermost row with other words keeps Mattermost's words", () => {
    expect(read("Error from Mattermost: We could not save the post.")).toEqual({
      reason: "We could not save the post.",
    });
  });

  test("Teams' and Mattermost's answers are kept apart too", () => {
    expect(
      read(
        WorkspaceRefusal.describeMicrosoftTeamsRefusal({
          statusCode: 429,
          code: "Throttled",
        }),
      ),
    ).toEqual({
      reason: MICROSOFT_TEAMS_RATE_LIMITED_REFUSAL.reason,
      detail: "429 Throttled",
    });

    expect(
      read(
        WorkspaceRefusal.describeMattermostRefusal({
          statusCode: 401,
          errorId: "api.context.session_expired.app_error",
          message: "Invalid or expired session, please login again.",
        }),
      ),
    ).toEqual({
      reason: MATTERMOST_NOT_CONNECTED_REFUSAL.reason,
      detail: "Invalid or expired session, please login again",
    });
  });

  test("any other message reads as it is", () => {
    const notFound: string =
      "The Slack channel #ops was not found. If it is a private channel, invite OneUptime's bot to it in Slack.";

    expect(read(notFound, WorkspaceType.Slack)).toEqual({ reason: notFound });
    expect(read("")).toEqual({ reason: "" });
  });

  test("toText puts a reading back together, as View Status Message shows it", () => {
    expect(
      WorkspaceRefusal.toText({
        reading: read("Error from Slack is_archived"),
        workspaceType: WorkspaceType.Slack,
      }),
    ).toBe(WorkspaceRefusal.describeSlackRefusal("is_archived"));

    expect(
      WorkspaceRefusal.toText({
        reading: { reason: "Something else happened." },
        workspaceType: WorkspaceType.Slack,
      }),
    ).toBe("Something else happened.");
  });
});
