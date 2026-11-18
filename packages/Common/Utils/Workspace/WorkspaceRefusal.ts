import WorkspaceType, {
  getWorkspaceTypeDisplayName,
} from "../../Types/Workspace/WorkspaceType";

/*
 * WHY SLACK, MICROSOFT TEAMS OR MATTERMOST REFUSED WHAT ONEUPTIME ASKED, IN
 * WORDS A PERSON CAN ACT ON (#7119, #7121).
 *
 * Slack refuses with a code: "is_archived", "not_in_channel",
 * "ratelimited". OneUptime used to pass the code on as it came - "Error
 * from Slack is_archived" - into a rule's or a summary's Notification Logs,
 * Test Rule's and Send Test Now's Test Failed, and the API's answer, where
 * only a Slack developer could tell what to do. Microsoft Teams and
 * Mattermost refuse with an HTTP status, a code and words of their own,
 * which say what went wrong for them, not what to change in OneUptime.
 *
 * Each refusal is said here as one or two short sentences: what happened,
 * then what to do (Docs/ux/README.md#errors). The workspace's own answer is
 * kept after them, as the detail support asks for:
 *
 *   The Slack channel is archived. Unarchive it in Slack, or pick another
 *   channel. Slack said: is_archived.
 *
 * "Slack said:" (or "Microsoft Teams said:", "Mattermost said:") is where
 * the reason ends and the detail starts, so a reader can show the one and
 * keep the other a click away (read): the Workspace Logs table's Reason
 * column shows the reason, and the detail with it under the pointer and in
 * View Status Message. A row written before this - "Error from Slack
 * is_archived" - is read the same way, so a page of old Error rows reads
 * as well as a page of new ones.
 *
 * The sentences are OneUptime's English, as the other workspace reasons the
 * server writes are (WorkspaceChannelNotFound, the not-connected reason).
 * Pure, in Common/Utils, so the server that writes them and the Dashboard
 * that reads old rows say the same words.
 */

// A kind of refusal, the codes it is answered with, and what OneUptime says of it.
export interface WorkspaceRefusalFamily {
  // OneUptime's words: what happened, then what to do.
  reason: string;
  codes: ReadonlyArray<string>;
}

// A refusal as it is shown: OneUptime's words, and the workspace's answer.
export interface WorkspaceRefusalReading {
  reason: string;
  // What the workspace answered ("is_archived"), for support.
  detail?: string | undefined;
}

/*
 * The ways a Slack refusal reads, each with the codes Slack answers it
 * with (api.slack.com/methods: chat.postMessage, chat.update,
 * conversations.create, conversations.invite, conversations.join,
 * conversations.archive, conversations.info, conversations.history,
 * views.open, users.lookupByEmail). "http_429" and "no_answer" are
 * OneUptime's own, for an answer that was no Slack JSON.
 */
export const SLACK_CHANNEL_NOT_FOUND_REFUSAL: WorkspaceRefusalFamily = {
  reason:
    "The Slack channel was not found. If it is private, invite OneUptime's bot to it in Slack. If it was deleted, pick another channel.",
  codes: ["channel_not_found", "duplicate_channel_not_found"],
};

export const SLACK_BOT_NOT_IN_CHANNEL_REFUSAL: WorkspaceRefusalFamily = {
  reason:
    "OneUptime's bot is not in the Slack channel. Invite the bot to the channel in Slack, then try again.",
  codes: ["not_in_channel"],
};

export const SLACK_CHANNEL_ARCHIVED_REFUSAL: WorkspaceRefusalFamily = {
  reason:
    "The Slack channel is archived. Unarchive it in Slack, or pick another channel.",
  codes: ["is_archived"],
};

export const SLACK_CHANNEL_ALREADY_ARCHIVED_REFUSAL: WorkspaceRefusalFamily = {
  reason: "The Slack channel is archived already, so there was nothing to do.",
  codes: ["already_archived"],
};

export const SLACK_NOT_CONNECTED_REFUSAL: WorkspaceRefusalFamily = {
  reason:
    "OneUptime's connection to Slack no longer works. Please ask a Project Admin to reconnect Slack in Project Settings > Workspace > Slack.",
  codes: [
    "invalid_auth",
    "not_authed",
    "account_inactive",
    "token_revoked",
    "token_expired",
    "not_allowed_token_type",
  ],
};

export const SLACK_MISSING_PERMISSION_REFUSAL: WorkspaceRefusalFamily = {
  reason:
    "OneUptime's Slack app is missing a permission this needs. Please ask a Project Admin to reconnect Slack in Project Settings > Workspace > Slack, which grants it.",
  codes: ["missing_scope", "no_permission"],
};

export const SLACK_WORKSPACE_NOT_ADDED_REFUSAL: WorkspaceRefusalFamily = {
  reason:
    "OneUptime is not added to this workspace of your Slack organization. Add it in Slack's organization settings, or pick another workspace.",
  codes: ["team_access_not_granted"],
};

export const SLACK_RATE_LIMITED_REFUSAL: WorkspaceRefusalFamily = {
  reason: "Slack asked OneUptime to slow down. Wait a minute, then try again.",
  codes: ["ratelimited", "rate_limited", "message_limit_exceeded", "http_429"],
};

export const SLACK_MESSAGE_TOO_LONG_REFUSAL: WorkspaceRefusalFamily = {
  reason:
    "The message is too long for Slack. Shorten its longest part, such as a note or a description, then try again.",
  codes: [
    "msg_too_long",
    "too_many_attachments",
    "attachment_payload_limit_exceeded",
    "metadata_too_large",
    "view_too_large",
  ],
};

export const SLACK_UNREADABLE_REQUEST_REFUSAL: WorkspaceRefusalFamily = {
  reason:
    "Slack could not read what OneUptime sent. This is a problem in OneUptime: please report it to support with Slack's answer.",
  codes: [
    "invalid_blocks",
    "invalid_blocks_format",
    "invalid_attachments",
    "no_text",
    "invalid_arguments",
    "invalid_arg_name",
    "invalid_array_arg",
    "invalid_charset",
    "invalid_form_data",
    "invalid_post_type",
    "missing_post_type",
    "invalid_json",
    "json_not_object",
    "invalid_metadata_format",
    "invalid_metadata_schema",
    "invalid_cursor",
    "invalid_ts_latest",
    "invalid_ts_oldest",
  ],
};

export const SLACK_RESTRICTED_REFUSAL: WorkspaceRefusalFamily = {
  reason:
    "A Slack setting does not let OneUptime's bot do this here, such as who may post in the channel. Ask a Slack admin to allow it, or pick another channel.",
  codes: [
    "restricted_action",
    "restricted_action_read_only_channel",
    "restricted_action_thread_only_channel",
    "restricted_action_non_threadable_channel",
    "restricted_action_thread_locked",
    "posting_to_general_channel_denied",
    "cannot_reply_to_message",
    "ekm_access_denied",
    "enterprise_is_restricted",
    "access_denied",
    "not_allowed",
    "messages_tab_disabled",
    "slack_connect_file_link_sharing_blocked",
    "slack_connect_canvas_sharing_blocked",
  ],
};

export const SLACK_NAME_TAKEN_REFUSAL: WorkspaceRefusalFamily = {
  reason:
    "A Slack channel with this name exists already, maybe archived. Rename it in Slack, or change the channel name prefix of the rule.",
  codes: ["name_taken"],
};

export const SLACK_INVALID_NAME_REFUSAL: WorkspaceRefusalFamily = {
  reason:
    "Slack does not take this channel name. A name holds lowercase letters, numbers, hyphens and underscores, up to 80 characters.",
  codes: [
    "invalid_name",
    "invalid_name_required",
    "invalid_name_punctuation",
    "invalid_name_maxlength",
    "invalid_name_specials",
    "no_channel",
  ],
};

export const SLACK_ACCOUNT_NOT_FOUND_REFUSAL: WorkspaceRefusalFamily = {
  reason:
    "Slack could not find this person's account, or it is deactivated. Ask them to connect their Slack account in OneUptime's User Settings.",
  codes: [
    "user_not_found",
    "users_not_found",
    "no_user",
    "user_disabled",
    "invalid_users",
    "user_not_visible",
  ],
};

export const SLACK_CANNOT_JOIN_REFUSAL: WorkspaceRefusalFamily = {
  reason:
    "Slack does not let this person join the channel: a guest account, or a workspace setting, limits them. Ask a Slack admin to add them.",
  codes: [
    "user_is_restricted",
    "user_is_ultra_restricted",
    "ura_max_channels",
    "cant_invite",
    "cant_invite_self",
  ],
};

export const SLACK_UNAVAILABLE_REFUSAL: WorkspaceRefusalFamily = {
  reason: "Slack could not answer just now. Try again in a few minutes.",
  codes: [
    "service_unavailable",
    "internal_error",
    "fatal_error",
    "request_timeout",
    "team_added_to_org",
    "org_login_required",
    "no_answer",
  ],
};

export const SLACK_MESSAGE_GONE_REFUSAL: WorkspaceRefusalFamily = {
  reason: "The Slack message was not found. Someone may have deleted it.",
  codes: ["message_not_found", "thread_not_found"],
};

export const SLACK_MESSAGE_LOCKED_REFUSAL: WorkspaceRefusalFamily = {
  reason: "Slack no longer lets OneUptime change or delete this message.",
  codes: [
    "cant_update_message",
    "edit_window_closed",
    "cant_delete_message",
    "compliance_exports_prevent_deletion",
  ],
};

export const SLACK_EXPIRED_REFUSAL: WorkspaceRefusalFamily = {
  reason:
    "The Slack form or button had expired by the time OneUptime answered. Try again in Slack.",
  codes: [
    "expired_trigger_id",
    "invalid_trigger_id",
    "exchanged_trigger_id",
    "expired_url",
    "used_url",
  ],
};

export const SLACK_CHANNEL_KIND_REFUSAL: WorkspaceRefusalFamily = {
  reason:
    "Slack does not allow this in this kind of channel, such as a direct message or #general. Pick another channel.",
  codes: [
    "method_not_supported_for_channel_type",
    "cant_archive_general",
    "cant_archive_required",
    "cant_kick_from_general",
  ],
};

export const SLACK_OUTDATED_REFUSAL: WorkspaceRefusalFamily = {
  reason:
    "OneUptime asked Slack for something Slack no longer offers. Update OneUptime, or report it to support with Slack's answer.",
  codes: ["deprecated_endpoint", "method_deprecated", "unknown_method"],
};

export const SLACK_REFUSALS: ReadonlyArray<WorkspaceRefusalFamily> = [
  SLACK_CHANNEL_NOT_FOUND_REFUSAL,
  SLACK_BOT_NOT_IN_CHANNEL_REFUSAL,
  SLACK_CHANNEL_ARCHIVED_REFUSAL,
  SLACK_CHANNEL_ALREADY_ARCHIVED_REFUSAL,
  SLACK_NOT_CONNECTED_REFUSAL,
  SLACK_MISSING_PERMISSION_REFUSAL,
  SLACK_WORKSPACE_NOT_ADDED_REFUSAL,
  SLACK_RATE_LIMITED_REFUSAL,
  SLACK_MESSAGE_TOO_LONG_REFUSAL,
  SLACK_UNREADABLE_REQUEST_REFUSAL,
  SLACK_RESTRICTED_REFUSAL,
  SLACK_NAME_TAKEN_REFUSAL,
  SLACK_INVALID_NAME_REFUSAL,
  SLACK_ACCOUNT_NOT_FOUND_REFUSAL,
  SLACK_CANNOT_JOIN_REFUSAL,
  SLACK_UNAVAILABLE_REFUSAL,
  SLACK_MESSAGE_GONE_REFUSAL,
  SLACK_MESSAGE_LOCKED_REFUSAL,
  SLACK_EXPIRED_REFUSAL,
  SLACK_CHANNEL_KIND_REFUSAL,
  SLACK_OUTDATED_REFUSAL,
];

// A code no family above names: Slack's answer is still kept after it.
export const SLACK_UNKNOWN_REFUSAL_REASON: string =
  "Slack refused the request. If it keeps happening, report it to support with Slack's answer.";

/*
 * The ways a Microsoft Teams refusal reads. Teams answers with an HTTP
 * status and a code: the Bot Framework's when OneUptime posts
 * (BotNotInConversationRoster, ConversationBlockedByUser,
 * MessageSizeTooBig, Throttled), Microsoft Graph's when it reads or
 * creates channels (InvalidAuthenticationToken, NameAlreadyExists,
 * TooManyRequests). A code is read first; a status names a family for any
 * code of its own (statuses).
 */
export interface MicrosoftTeamsRefusalFamily extends WorkspaceRefusalFamily {
  statuses: ReadonlyArray<number>;
}

export const MICROSOFT_TEAMS_APP_NOT_IN_TEAM_REFUSAL: MicrosoftTeamsRefusalFamily =
  {
    reason:
      "The OneUptime app is not in this Microsoft Teams team or channel. Add it to the team in Microsoft Teams (Manage team > Apps), then try again.",
    codes: ["BotNotInConversationRoster"],
    statuses: [],
  };

export const MICROSOFT_TEAMS_BLOCKED_BY_USER_REFUSAL: MicrosoftTeamsRefusalFamily =
  {
    reason:
      "This person blocked OneUptime's bot in Microsoft Teams. They can unblock it in their chat with OneUptime.",
    codes: ["ConversationBlockedByUser"],
    statuses: [],
  };

export const MICROSOFT_TEAMS_APP_DISABLED_REFUSAL: MicrosoftTeamsRefusalFamily =
  {
    reason:
      "A Microsoft Teams admin turned off the OneUptime app. Ask them to allow it in the Teams admin center.",
    codes: ["BotDisabledByAdmin"],
    statuses: [],
  };

export const MICROSOFT_TEAMS_NOT_CONNECTED_REFUSAL: MicrosoftTeamsRefusalFamily =
  {
    reason:
      "OneUptime's connection to Microsoft Teams no longer works. Please ask a Project Admin to reconnect Microsoft Teams in Project Settings > Workspace > Microsoft Teams.",
    codes: [
      "Unauthorized",
      "InvalidAuthenticationToken",
      "AuthenticationError",
      "BotNotRegistered",
    ],
    statuses: [401],
  };

export const MICROSOFT_TEAMS_MISSING_PERMISSION_REFUSAL: MicrosoftTeamsRefusalFamily =
  {
    reason:
      "Microsoft Teams did not let OneUptime do this: the app is missing a permission here. Please ask a Project Admin to reconnect Microsoft Teams in Project Settings > Workspace > Microsoft Teams.",
    codes: [
      "Forbidden",
      "Authorization_RequestDenied",
      "AccessDenied",
      "NotEnoughPermissions",
      "ForbiddenOperationException",
    ],
    statuses: [403],
  };

export const MICROSOFT_TEAMS_MESSAGE_GONE_REFUSAL: MicrosoftTeamsRefusalFamily =
  {
    reason:
      "The Microsoft Teams message was not found. Someone may have deleted it.",
    codes: ["ActivityNotFoundInConversation"],
    statuses: [],
  };

export const MICROSOFT_TEAMS_NOT_FOUND_REFUSAL: MicrosoftTeamsRefusalFamily = {
  reason:
    "Microsoft Teams could not find the team, channel or chat. It may have been deleted, or the OneUptime app was removed from it.",
  codes: [
    "NotFound",
    "ConversationNotFound",
    "ItemNotFound",
    "ResourceNotFound",
  ],
  statuses: [404],
};

export const MICROSOFT_TEAMS_NAME_TAKEN_REFUSAL: MicrosoftTeamsRefusalFamily = {
  reason:
    "A Microsoft Teams channel with this name exists already in the team, maybe one deleted in the last 30 days. Change the channel name prefix of the rule.",
  codes: ["NameAlreadyExists", "Conflict"],
  statuses: [409],
};

export const MICROSOFT_TEAMS_MESSAGE_TOO_LARGE_REFUSAL: MicrosoftTeamsRefusalFamily =
  {
    reason:
      "The message is too large for Microsoft Teams. Shorten its longest part, such as a note or a description, then try again.",
    codes: ["MessageSizeTooBig", "RequestEntityTooLarge"],
    statuses: [413],
  };

export const MICROSOFT_TEAMS_RATE_LIMITED_REFUSAL: MicrosoftTeamsRefusalFamily =
  {
    reason:
      "Microsoft Teams asked OneUptime to slow down. Wait a minute, then try again.",
    codes: ["Throttled", "TooManyRequests", "activityLimitReached"],
    statuses: [429],
  };

export const MICROSOFT_TEAMS_UNAVAILABLE_REFUSAL: MicrosoftTeamsRefusalFamily =
  {
    reason:
      "Microsoft Teams could not answer just now. Try again in a few minutes.",
    codes: [
      "ServiceError",
      "InternalServerError",
      "ServiceUnavailable",
      "GatewayTimeout",
      "generalException",
      "serviceNotAvailable",
      // Microsoft could not be reached at all.
      "REQUEST_SEND_ERROR",
      "ETIMEDOUT",
      "ECONNRESET",
      "ECONNREFUSED",
      "ENOTFOUND",
      "EAI_AGAIN",
    ],
    statuses: [500, 502, 503, 504],
  };

export const MICROSOFT_TEAMS_REFUSALS: ReadonlyArray<MicrosoftTeamsRefusalFamily> =
  [
    MICROSOFT_TEAMS_APP_NOT_IN_TEAM_REFUSAL,
    MICROSOFT_TEAMS_BLOCKED_BY_USER_REFUSAL,
    MICROSOFT_TEAMS_APP_DISABLED_REFUSAL,
    MICROSOFT_TEAMS_NOT_CONNECTED_REFUSAL,
    MICROSOFT_TEAMS_MISSING_PERMISSION_REFUSAL,
    MICROSOFT_TEAMS_MESSAGE_GONE_REFUSAL,
    MICROSOFT_TEAMS_NOT_FOUND_REFUSAL,
    MICROSOFT_TEAMS_NAME_TAKEN_REFUSAL,
    MICROSOFT_TEAMS_MESSAGE_TOO_LARGE_REFUSAL,
    MICROSOFT_TEAMS_RATE_LIMITED_REFUSAL,
    MICROSOFT_TEAMS_UNAVAILABLE_REFUSAL,
  ];

export const MICROSOFT_TEAMS_UNKNOWN_REFUSAL_REASON: string =
  "Microsoft Teams refused the request. If it keeps happening, report it to support with Microsoft Teams' answer.";

/*
 * What the Bot Framework says when OneUptime's bot is not in the team or
 * the channel it posts to: a 403 whose code may not say so (Forbidden).
 */
const MICROSOFT_TEAMS_ROSTER_WORDS: ReadonlyArray<string> = [
  "not part of the conversation roster",
  "bot is not part of the conversation",
];

/*
 * The ways a Mattermost refusal reads. Mattermost answers with an HTTP
 * status and the id of its error ("api.context.session_expired.app_error"),
 * with a message in its server's language. An id is read first (ids, or
 * idEnds for the ids whose start changed across Mattermost versions); a
 * status names a family for any id of its own.
 */
export interface MattermostRefusalFamily extends WorkspaceRefusalFamily {
  statuses: ReadonlyArray<number>;
  idEnds: ReadonlyArray<string>;
}

export const MATTERMOST_NOT_CONNECTED_REFUSAL: MattermostRefusalFamily = {
  reason:
    "OneUptime's Mattermost bot token no longer works: it was revoked, or the bot was deactivated. Please ask a Project Admin to reconnect Mattermost in Project Settings > Workspace > Mattermost.",
  codes: ["api.context.session_expired.app_error"],
  idEnds: [],
  statuses: [401],
};

export const MATTERMOST_CHANNEL_ARCHIVED_REFUSAL: MattermostRefusalFamily = {
  reason:
    "The Mattermost channel is archived. Unarchive it in Mattermost, or pick another channel.",
  codes: ["api.post.create_post.can_not_post_to_deleted.error"],
  idEnds: [],
  statuses: [],
};

export const MATTERMOST_NAME_TAKEN_REFUSAL: MattermostRefusalFamily = {
  reason:
    "A Mattermost channel with this name exists already in the team, maybe archived. Rename it in Mattermost, or change the channel name prefix of the rule.",
  codes: ["store.sql_channel.save_channel.exists.app_error"],
  idEnds: [],
  statuses: [],
};

export const MATTERMOST_NOT_IN_TEAM_REFUSAL: MattermostRefusalFamily = {
  reason:
    "This person is not in the channel's Mattermost team. Add them to the team in Mattermost, then try again.",
  codes: ["api.channel.add_user.to.channel.failed.deleted.app_error"],
  idEnds: ["team.get_member.missing.app_error"],
  statuses: [],
};

export const MATTERMOST_ACCOUNT_NOT_FOUND_REFUSAL: MattermostRefusalFamily = {
  reason:
    "Mattermost could not find this person's account, or it is deactivated. Ask them to connect their Mattermost account in OneUptime's User Settings.",
  codes: ["app.channel.add_member.deleted_user.app_error"],
  idEnds: ["user.missing_account.const"],
  statuses: [],
};

export const MATTERMOST_NOT_ALLOWED_REFUSAL: MattermostRefusalFamily = {
  reason:
    "OneUptime's bot is not allowed to do this in Mattermost. Add the bot to the channel and its team in Mattermost, then try again.",
  codes: ["api.context.permissions.app_error"],
  idEnds: [],
  statuses: [403],
};

export const MATTERMOST_NOT_FOUND_REFUSAL: MattermostRefusalFamily = {
  reason:
    "Mattermost could not find the channel or team. It may have been deleted, or OneUptime's bot was removed from it.",
  codes: [],
  idEnds: [],
  statuses: [404],
};

export const MATTERMOST_MESSAGE_TOO_LONG_REFUSAL: MattermostRefusalFamily = {
  reason:
    "The message is too long for Mattermost. Shorten its longest part, such as a note or a description, then try again.",
  codes: ["model.post.is_valid.msg.app_error"],
  idEnds: [],
  statuses: [413],
};

export const MATTERMOST_RATE_LIMITED_REFUSAL: MattermostRefusalFamily = {
  reason:
    "Mattermost asked OneUptime to slow down. Wait a minute, then try again.",
  codes: [],
  idEnds: [],
  statuses: [429],
};

export const MATTERMOST_UNAVAILABLE_REFUSAL: MattermostRefusalFamily = {
  reason:
    "The Mattermost server could not answer just now. Check that it is running, then try again in a few minutes.",
  codes: [],
  idEnds: [],
  statuses: [500, 502, 503, 504],
};

export const MATTERMOST_REFUSALS: ReadonlyArray<MattermostRefusalFamily> = [
  MATTERMOST_NOT_CONNECTED_REFUSAL,
  MATTERMOST_CHANNEL_ARCHIVED_REFUSAL,
  MATTERMOST_NAME_TAKEN_REFUSAL,
  MATTERMOST_NOT_IN_TEAM_REFUSAL,
  MATTERMOST_ACCOUNT_NOT_FOUND_REFUSAL,
  MATTERMOST_NOT_ALLOWED_REFUSAL,
  MATTERMOST_NOT_FOUND_REFUSAL,
  MATTERMOST_MESSAGE_TOO_LONG_REFUSAL,
  MATTERMOST_RATE_LIMITED_REFUSAL,
  MATTERMOST_UNAVAILABLE_REFUSAL,
];

export const MATTERMOST_UNKNOWN_REFUSAL_REASON: string =
  "Mattermost refused the request. If it keeps happening, report it to support with Mattermost's answer.";

/*
 * What Mattermost's English server says for the refusals OneUptime met
 * most, read back from a row written before its answers were said in
 * OneUptime's words ("Error from Mattermost: You do not have the
 * appropriate permissions."). Its other words are kept as they are: they
 * are a sentence already.
 */
const MATTERMOST_LEGACY_MESSAGES: ReadonlyArray<{
  message: string;
  family: MattermostRefusalFamily;
}> = [
  {
    message: "invalid or expired session, please login again.",
    family: MATTERMOST_NOT_CONNECTED_REFUSAL,
  },
  {
    message: "invalid or expired session",
    family: MATTERMOST_NOT_CONNECTED_REFUSAL,
  },
  {
    message: "you do not have the appropriate permissions.",
    family: MATTERMOST_NOT_ALLOWED_REFUSAL,
  },
];

// What a row written before this said of a Slack refusal: "Error from Slack is_archived".
const LEGACY_SLACK_PREFIX: string = "Error from Slack";

// What a row written before this said of a Mattermost refusal.
const LEGACY_MATTERMOST_PREFIX: string = "Error from Mattermost:";

// A code as Slack writes one: lower case, digits and underscores.
const SLACK_CODE: RegExp = /^[a-z0-9_]+$/;

/*
 * What a row written before this held where Slack gave no code: "Error
 * from Slack undefined", the code glued in as it was.
 */
const NO_SLACK_CODE_WORDS: ReadonlyArray<string> = ["undefined", "null"];

// "http_503": OneUptime's code for an HTTP answer of that status, which no Slack code says.
const SLACK_HTTP_CODE: RegExp = /^http_(\d{3})$/;

// What ends a sentence, for a detail that brings its own.
const SENTENCE_END: RegExp = /[.!?…。！？؟।]$/;

export default class WorkspaceRefusal {
  /*
   * Where a refusal's reason ends and the workspace's answer starts:
   * "Slack said: ", "Microsoft Teams said: ", "Mattermost said: ".
   */
  public static getDetailMarker(workspaceType: WorkspaceType): string {
    return `${getWorkspaceTypeDisplayName(workspaceType)} said: `;
  }

  /*
   * A reason with the workspace's answer after it: "… pick another
   * channel. Slack said: is_archived." No answer, the reason alone.
   */
  public static withDetail(data: {
    reason: string;
    workspaceType: WorkspaceType;
    detail?: string | undefined;
  }): string {
    const reason: string = data.reason.trim();
    const detail: string = (data.detail || "").trim();

    if (!detail) {
      return reason;
    }

    const marker: string = WorkspaceRefusal.getDetailMarker(data.workspaceType);

    return `${reason} ${marker}${detail}${SENTENCE_END.test(detail) ? "" : "."}`;
  }

  // The family of a Slack code, or undefined for one OneUptime does not know.
  public static getSlackFamily(
    code: string | undefined | null,
  ): WorkspaceRefusalFamily | undefined {
    const trimmed: string = (code || "").trim();

    if (!trimmed) {
      return undefined;
    }

    const family: WorkspaceRefusalFamily | undefined = SLACK_REFUSALS.find(
      (candidate: WorkspaceRefusalFamily): boolean => {
        return candidate.codes.includes(trimmed);
      },
    );

    if (family) {
      return family;
    }

    // An HTTP answer that was no Slack JSON: its status says which.
    const httpStatus: RegExpMatchArray | null = trimmed.match(SLACK_HTTP_CODE);

    if (httpStatus && Number(httpStatus[1]) >= 500) {
      return SLACK_UNAVAILABLE_REFUSAL;
    }

    return undefined;
  }

  // OneUptime's words for a Slack code: what happened and what to do.
  public static getSlackReason(code: string | undefined | null): string {
    return (
      WorkspaceRefusal.getSlackFamily(code)?.reason ||
      SLACK_UNKNOWN_REFUSAL_REASON
    );
  }

  /*
   * What a Slack refusal is thrown and logged as: OneUptime's words, then
   * Slack's code - "… Slack said: is_archived." A refusal with no code at
   * all is the unknown one, with nothing after it.
   */
  public static describeSlackRefusal(code: string | undefined | null): string {
    const trimmed: string = (code || "").trim();

    return WorkspaceRefusal.withDetail({
      reason: WorkspaceRefusal.getSlackReason(trimmed),
      workspaceType: WorkspaceType.Slack,
      detail: trimmed,
    });
  }

  /*
   * The Slack code a message carries: after "Slack said:", or after "Error
   * from Slack" in one written before this. Null when it carries none.
   */
  public static getSlackCodeOfMessage(
    message: string | undefined | null,
  ): string | null {
    const text: string = (message || "").trim();

    if (!text) {
      return null;
    }

    const marker: string = WorkspaceRefusal.getDetailMarker(
      WorkspaceType.Slack,
    );
    const markerAt: number = text.lastIndexOf(marker);

    if (markerAt >= 0) {
      const code: string = WorkspaceRefusal.withoutFullStop(
        text.substring(markerAt + marker.length),
      );

      return SLACK_CODE.test(code) ? code : null;
    }

    const legacyAt: number = text.lastIndexOf(LEGACY_SLACK_PREFIX);

    if (legacyAt >= 0) {
      const code: string = WorkspaceRefusal.withoutFullStop(
        text.substring(legacyAt + LEGACY_SLACK_PREFIX.length),
      );

      return SLACK_CODE.test(code) && !NO_SLACK_CODE_WORDS.includes(code)
        ? code
        : null;
    }

    return null;
  }

  /*
   * The family of a Microsoft Teams answer: by its code, by the roster's
   * words, else by its status.
   */
  public static getMicrosoftTeamsFamily(data: {
    statusCode?: number | undefined;
    code?: string | undefined;
    message?: string | undefined;
  }): MicrosoftTeamsRefusalFamily | undefined {
    const code: string = (data.code || "").trim();
    const message: string = (data.message || "").toLowerCase();

    if (
      MICROSOFT_TEAMS_ROSTER_WORDS.some((words: string): boolean => {
        return message.includes(words);
      })
    ) {
      return MICROSOFT_TEAMS_APP_NOT_IN_TEAM_REFUSAL;
    }

    if (code) {
      const byCode: MicrosoftTeamsRefusalFamily | undefined =
        MICROSOFT_TEAMS_REFUSALS.find(
          (family: MicrosoftTeamsRefusalFamily): boolean => {
            return family.codes.includes(code);
          },
        );

      if (byCode) {
        return byCode;
      }
    }

    if (typeof data.statusCode !== "number") {
      return undefined;
    }

    const statusCode: number = data.statusCode;

    return MICROSOFT_TEAMS_REFUSALS.find(
      (family: MicrosoftTeamsRefusalFamily): boolean => {
        return (
          family.statuses.includes(statusCode) ||
          (family === MICROSOFT_TEAMS_UNAVAILABLE_REFUSAL && statusCode >= 500)
        );
      },
    );
  }

  /*
   * What a Microsoft Teams refusal is logged as: OneUptime's words, then
   * Teams' answer - "… Microsoft Teams said: 403 ConversationBlockedByUser:
   * User blocked the conversation with the bot."
   */
  public static describeMicrosoftTeamsRefusal(data: {
    statusCode?: number | undefined;
    code?: string | undefined;
    message?: string | undefined;
  }): string {
    const family: MicrosoftTeamsRefusalFamily | undefined =
      WorkspaceRefusal.getMicrosoftTeamsFamily(data);

    const answer: string = [data.statusCode, (data.code || "").trim()]
      .filter((part: number | string | undefined): boolean => {
        return part !== undefined && part !== "";
      })
      .join(" ");

    const message: string = (data.message || "").trim();

    /*
     * A refusal OneUptime has no words of its own for says Microsoft's,
     * after OneUptime's: "Microsoft Teams refused the request: Channel
     * name is not valid." They are what a person reads in the Reason
     * column, which shows a refusal's words without the answer after
     * them.
     */
    if (!family && message && message !== answer) {
      return WorkspaceRefusal.withDetail({
        reason: WorkspaceRefusal.getRefusedWithWords({
          workspaceType: WorkspaceType.MicrosoftTeams,
          words: message,
        }),
        workspaceType: WorkspaceType.MicrosoftTeams,
        detail: answer,
      });
    }

    const detail: string =
      answer && message && message !== answer
        ? `${answer}: ${message}`
        : answer || message;

    return WorkspaceRefusal.withDetail({
      reason: family?.reason || MICROSOFT_TEAMS_UNKNOWN_REFUSAL_REASON,
      workspaceType: WorkspaceType.MicrosoftTeams,
      detail: detail,
    });
  }

  // The family of a Mattermost answer: by its error's id, else by its status.
  public static getMattermostFamily(data: {
    statusCode?: number | undefined;
    errorId?: string | undefined;
  }): MattermostRefusalFamily | undefined {
    const errorId: string = (data.errorId || "").trim();

    if (errorId) {
      const byId: MattermostRefusalFamily | undefined =
        MATTERMOST_REFUSALS.find((family: MattermostRefusalFamily): boolean => {
          return (
            family.codes.includes(errorId) ||
            family.idEnds.some((end: string): boolean => {
              return errorId.endsWith(end);
            })
          );
        });

      if (byId) {
        return byId;
      }
    }

    if (typeof data.statusCode !== "number") {
      return undefined;
    }

    const statusCode: number = data.statusCode;

    return MATTERMOST_REFUSALS.find(
      (family: MattermostRefusalFamily): boolean => {
        return (
          family.statuses.includes(statusCode) ||
          (family === MATTERMOST_UNAVAILABLE_REFUSAL && statusCode >= 500)
        );
      },
    );
  }

  /*
   * What a Mattermost refusal is thrown and logged as: OneUptime's words,
   * then what Mattermost said, in its server's words - "… Mattermost said:
   * You do not have the appropriate permissions."
   */
  public static describeMattermostRefusal(data: {
    statusCode?: number | undefined;
    errorId?: string | undefined;
    message?: string | undefined;
  }): string {
    const family: MattermostRefusalFamily | undefined =
      WorkspaceRefusal.getMattermostFamily(data);

    const message: string = (data.message || "").trim();

    const status: string =
      typeof data.statusCode === "number" ? `HTTP ${data.statusCode}` : "";

    // One OneUptime has no words of its own for says Mattermost's, as Teams' do.
    if (!family && message) {
      return WorkspaceRefusal.withDetail({
        reason: WorkspaceRefusal.getRefusedWithWords({
          workspaceType: WorkspaceType.Mattermost,
          words: message,
        }),
        workspaceType: WorkspaceType.Mattermost,
        detail: [status, (data.errorId || "").trim()]
          .filter((part: string): boolean => {
            return Boolean(part);
          })
          .join(" "),
      });
    }

    return WorkspaceRefusal.withDetail({
      reason: family?.reason || MATTERMOST_UNKNOWN_REFUSAL_REASON,
      workspaceType: WorkspaceType.Mattermost,
      detail: message || status,
    });
  }

  /*
   * A Notification Logs row's status message, or a refusal the server
   * answered, as a person reads it: OneUptime's words, and the workspace's
   * answer kept apart (WorkspaceRefusalReading).
   *
   *   - "… Slack said: is_archived." (and Teams' and Mattermost's): the
   *     words before the answer, and the answer;
   *   - "Error from Slack is_archived", written before this, and Slack's
   *     bare code on a Slack row ("ratelimited", which an HTTP answer gave):
   *     OneUptime's words for the code, and the code. What came before the
   *     code stays ("Cannot invite users to the channel. …");
   *   - "Error from Mattermost: …": OneUptime's words for the refusals it
   *     knows Mattermost's words for, else Mattermost's own words;
   *   - anything else: the message as it is, with no answer apart.
   */
  public static read(data: {
    message: string | undefined | null;
    workspaceType?: WorkspaceType | undefined;
  }): WorkspaceRefusalReading {
    const text: string = (data.message || "").trim();

    if (!text) {
      return { reason: "" };
    }

    for (const workspaceType of Object.values(WorkspaceType)) {
      const marker: string = WorkspaceRefusal.getDetailMarker(workspaceType);
      const markerAt: number = text.lastIndexOf(marker);

      if (markerAt < 0 || (markerAt > 0 && text[markerAt - 1] !== " ")) {
        continue;
      }

      const reason: string = text.substring(0, markerAt).trim();
      const detail: string = WorkspaceRefusal.withoutFullStop(
        text.substring(markerAt + marker.length),
      );

      if (!reason) {
        continue;
      }

      return detail ? { reason: reason, detail: detail } : { reason: reason };
    }

    const legacySlackAt: number = text.lastIndexOf(LEGACY_SLACK_PREFIX);

    if (
      legacySlackAt >= 0 &&
      (legacySlackAt === 0 || text[legacySlackAt - 1] === " ")
    ) {
      const written: string = WorkspaceRefusal.withoutFullStop(
        text.substring(legacySlackAt + LEGACY_SLACK_PREFIX.length),
      );
      const code: string = NO_SLACK_CODE_WORDS.includes(written) ? "" : written;

      if (!code || SLACK_CODE.test(code)) {
        const before: string = text.substring(0, legacySlackAt).trim();
        const reason: string = WorkspaceRefusal.getSlackReason(code);

        return {
          reason: before ? `${before} ${reason}` : reason,
          ...(code ? { detail: code } : {}),
        };
      }
    }

    if (
      data.workspaceType === WorkspaceType.Slack &&
      WorkspaceRefusal.getSlackFamily(text)
    ) {
      return { reason: WorkspaceRefusal.getSlackReason(text), detail: text };
    }

    const legacyMattermostAt: number = text.lastIndexOf(
      LEGACY_MATTERMOST_PREFIX,
    );

    if (
      legacyMattermostAt >= 0 &&
      (legacyMattermostAt === 0 || text[legacyMattermostAt - 1] === " ")
    ) {
      const before: string = text.substring(0, legacyMattermostAt).trim();
      const said: string = text
        .substring(legacyMattermostAt + LEGACY_MATTERMOST_PREFIX.length)
        .trim();

      const known: MattermostRefusalFamily | undefined =
        MATTERMOST_LEGACY_MESSAGES.find(
          (legacy: {
            message: string;
            family: MattermostRefusalFamily;
          }): boolean => {
            return legacy.message === said.toLowerCase();
          },
        )?.family;

      const reason: string = known?.reason || said;

      if (reason) {
        return {
          reason: before ? `${before} ${reason}` : reason,
          ...(known && said ? { detail: said } : {}),
        };
      }
    }

    return { reason: text };
  }

  /*
   * A reading put back into one text: the reason, then the workspace's
   * answer - what View Status Message shows of an Error row, an old one
   * too.
   */
  public static toText(data: {
    reading: WorkspaceRefusalReading;
    workspaceType?: WorkspaceType | undefined;
  }): string {
    if (!data.reading.detail || !data.workspaceType) {
      return data.reading.reason;
    }

    return WorkspaceRefusal.withDetail({
      reason: data.reading.reason,
      workspaceType: data.workspaceType,
      detail: data.reading.detail,
    });
  }

  /*
   * A refusal OneUptime has no words of its own for, in the workspace's:
   * "Microsoft Teams refused the request: Channel name is not valid."
   */
  public static getRefusedWithWords(data: {
    workspaceType: WorkspaceType;
    words: string;
  }): string {
    const words: string = data.words.trim();

    return `${getWorkspaceTypeDisplayName(data.workspaceType)} refused the request: ${words}${SENTENCE_END.test(words) ? "" : "."}`;
  }

  // A code or an answer without the full stop that closed it in a sentence.
  private static withoutFullStop(text: string): string {
    const trimmed: string = text.trim();

    return trimmed.endsWith(".")
      ? trimmed.substring(0, trimmed.length - 1).trim()
      : trimmed;
  }
}
