import ConnectCallbackUtil, {
  ConnectProvider,
  ConnectRequestOutcome,
} from "Common/Types/Workspace/ConnectCallback";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * What the Slack and Microsoft Teams settings pages say about a connection
 * started from a Connect button in the chat.
 *
 * Somebody who pressed a button in Slack or Microsoft Teams before their own
 * account was connected is answered there with a Connect button. It opens
 * their own settings page for the workspace with `?connect=`; the page
 * connects their account at once, and the sign-in comes back to it with
 * `?pressed=` saying what became of the press
 * (Common/Types/Workspace/ConnectCallback: ConnectRequestOutcome). The page
 * shows its own sentence for it, in the reader's language - never words the
 * address carries - and, for Slack, a link back to the channel the press was
 * in, built from ids alone (ConnectCallbackUtil.getSlackChannelLink).
 */

export interface ConnectRequestNoticeText {
  // "Your Slack account is connected", in the reader's language.
  title: string;
  // What became of the press, in the reader's language.
  message: string;
}

const WORKSPACE_NAMES: Partial<Record<ConnectProvider, string>> = {
  [ConnectProvider.Slack]: "Slack",
  [ConnectProvider.MicrosoftTeams]: "Microsoft Teams",
};

export const CONNECTED_TITLE: string = translationKey(
  "Your {{workspace}} account is connected",
);

// OneUptime did what was pressed (ConnectRequestOutcome.Done).
export const PRESS_DONE: string = translationKey(
  "OneUptime finished what you pressed in {{workspace}} and answered you there.",
);

/*
 * OneUptime answered without doing it - somebody had done it already, it was
 * not allowed, it failed - so the page says only where the answer is, never
 * that it was done (ConnectRequestOutcome.Answered).
 */
export const PRESS_ANSWERED: string = translationKey(
  "OneUptime answered you in {{workspace}}, where you pressed the button.",
);

export const PRESS_AGAIN: string = translationKey(
  "Go back to {{workspace}} and press the button again.",
);

/*
 * A question to OneUptime AI (ConnectRequestOutcome.AskAgain): asked in a
 * message, with no button to press again - the chat says the same.
 */
export const ASK_AGAIN: string = translationKey(
  "Go back to {{workspace}} and ask your question again.",
);

export const PRESS_EXPIRED: string = translationKey(
  "The button you pressed in {{workspace}} expired before you connected. Go back to {{workspace}} and press it again.",
);

export const PRESS_NOT_ANSWERED: string = translationKey(
  "OneUptime could not answer you in {{workspace}}. Open the record in OneUptime to see where it stands.",
);

export const LINK_GONE_TITLE: string = translationKey(
  "This Connect button has expired",
);

export const LINK_GONE_MESSAGE: string = translationKey(
  "Press the button in {{workspace}} again for a new one, or connect your account here.",
);

/*
 * The same, for somebody whose account is connected already - a Connect
 * button pressed a second time, its answer under it in the chat: nothing
 * to connect, so the button in the chat is what to press.
 */
export const ALREADY_CONNECTED_TITLE: string = translationKey(
  "Your {{workspace}} account is already connected",
);

export const ALREADY_CONNECTED_MESSAGE: string = translationKey(
  "This Connect button was used already. Go back to {{workspace}} and press the button again.",
);

export const CONNECTING_TITLE: string = translationKey(
  "Connecting your {{workspace}} account…",
);

export const CONNECTING_MESSAGE: string = translationKey(
  "Taking you to {{workspace}} to confirm it's you.",
);

export const BACK_TO_SLACK: string = translationKey("Back to Slack");

// "Slack", "Microsoft Teams": the workspace a provider's page is about.
export const getWorkspaceName: (provider: ConnectProvider) => string = (
  provider: ConnectProvider,
): string => {
  return WORKSPACE_NAMES[provider] || "Slack";
};

const OUTCOME_MESSAGES: Record<ConnectRequestOutcome, string> = {
  [ConnectRequestOutcome.Done]: PRESS_DONE,
  [ConnectRequestOutcome.Answered]: PRESS_ANSWERED,
  [ConnectRequestOutcome.PressAgain]: PRESS_AGAIN,
  [ConnectRequestOutcome.AskAgain]: ASK_AGAIN,
  [ConnectRequestOutcome.Expired]: PRESS_EXPIRED,
  [ConnectRequestOutcome.NotAnswered]: PRESS_NOT_ANSWERED,
};

/*
 * The notice a page shows for the `?pressed=` it was opened with: null when
 * there is none, or a value that is no outcome.
 */
export const getConnectRequestNotice: (data: {
  provider: ConnectProvider;
  pressed: string | null | undefined;
  translator: Translator;
}) => ConnectRequestNoticeText | null = (data: {
  provider: ConnectProvider;
  pressed: string | null | undefined;
  translator: Translator;
}): ConnectRequestNoticeText | null => {
  const outcome: ConnectRequestOutcome | null =
    ConnectCallbackUtil.readConnectRequestOutcome(data.pressed);

  if (!outcome) {
    return null;
  }

  const workspace: string = getWorkspaceName(data.provider);

  return {
    title: data.translator.translateTemplate(CONNECTED_TITLE, {
      workspace: workspace,
    }),
    message: data.translator.translateTemplate(OUTCOME_MESSAGES[outcome], {
      workspace: workspace,
    }),
  };
};

/*
 * What a page says when its `?connect=` can no longer be used: the press
 * behind it was spent, or waited past its thirty minutes. Somebody whose
 * account is connected already is told so, and to press the button in the
 * chat - not to connect an account that is connected.
 */
export const getConnectLinkGoneNotice: (data: {
  provider: ConnectProvider;
  translator: Translator;
  isUserConnected?: boolean | undefined;
}) => ConnectRequestNoticeText = (data: {
  provider: ConnectProvider;
  translator: Translator;
  isUserConnected?: boolean | undefined;
}): ConnectRequestNoticeText => {
  const workspace: string = getWorkspaceName(data.provider);

  if (data.isUserConnected) {
    return {
      title: data.translator.translateTemplate(ALREADY_CONNECTED_TITLE, {
        workspace: workspace,
      }),
      message: data.translator.translateTemplate(ALREADY_CONNECTED_MESSAGE, {
        workspace: workspace,
      }),
    };
  }

  return {
    title: data.translator.translateTemplate(LINK_GONE_TITLE),
    message: data.translator.translateTemplate(LINK_GONE_MESSAGE, {
      workspace: workspace,
    }),
  };
};

// What a page shows while it takes the browser to sign in.
export const getConnectingNotice: (data: {
  provider: ConnectProvider;
  translator: Translator;
}) => ConnectRequestNoticeText = (data: {
  provider: ConnectProvider;
  translator: Translator;
}): ConnectRequestNoticeText => {
  const workspace: string = getWorkspaceName(data.provider);

  return {
    title: data.translator.translateTemplate(CONNECTING_TITLE, {
      workspace: workspace,
    }),
    message: data.translator.translateTemplate(CONNECTING_MESSAGE, {
      workspace: workspace,
    }),
  };
};
