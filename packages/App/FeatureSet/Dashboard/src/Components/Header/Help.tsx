import URL from "Common/Types/API/URL";
import { DOCS_URL } from "Common/UI/Config";
import IconProp from "Common/Types/Icon/IconProp";
import HeaderIconDropdownButton from "Common/UI/Components/Header/HeaderIconDropdownButton";
import IconDropdownItem from "Common/UI/Components/Header/IconDropdown/IconDropdownItem";
import IconDropdownMenu from "Common/UI/Components/Header/IconDropdown/IconDropdownMenu";
import IconDropdownRow from "Common/UI/Components/Header/IconDropdown/IconDropdownRow";
import KeyboardShortcut, {
  KeyboardShortcutSize,
  KeyboardShortcutVariant,
} from "Common/UI/Components/KeyboardShortcut/KeyboardShortcut";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import {
  GLOSSARY_INDEX_DOCS_PAGE,
  QUICKSTART_DOCS_PAGE,
  getDocsPageUrl,
} from "Common/UI/Utils/Glossary";
import EventName from "../../Utils/EventName";
import {
  GiveFeedbackOpenedFrom,
  openGiveFeedback,
} from "../Feedback/GiveFeedbackDialog";
import {
  HowOneUptimeWorksOpenedFrom,
  openHowOneUptimeWorks,
} from "../Home/HowOneUptimeWorksDialog";
import ProductFeedback, {
  useProductFeedbackSettings,
} from "Common/UI/Utils/ProductFeedback";
import {
  ChatKind,
  ChatLink,
  HelpAndSupportSettings,
  getChatLink,
  getRequestDemoUrl,
  getSupportEmailAddress,
} from "Common/Types/HelpAndSupport/HelpAndSupport";
import { useHelpAndSupport } from "Common/UI/Utils/HelpAndSupport";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { ReactElement, useState } from "react";
import { useTranslation } from "react-i18next";

/*
 * Help starts with learning: the Quickstart, How OneUptime works, the
 * Glossary and the Documentation, in the order someone new reaches for
 * them. Then the ways to ask: Give feedback (where the server takes it,
 * #6832), the keyboard shortcuts, support by email and on Slack, and a
 * demo.
 *
 * Every docs page opens on this OneUptime instance (DOCS_URL), so it works
 * for self-hosted installs without internet access too, and in the
 * language the reader picked in the dashboard when the docs have it.
 *
 * The header's Help menu and the phone's menu (PhoneHelpMenu, #6816) are
 * drawn from the same entries (useHelpEntries), so the two never drift.
 */

export const HELP_LEARN_GROUP_TEST_ID: string = "help-learn";
export const HELP_ASK_GROUP_TEST_ID: string = "help-ask";

export interface HelpEntry {
  // Stable, for keys and tests.
  id: string;
  // In the reader's language.
  title: string;
  icon: IconProp;
  // A page to open, in a new tab.
  url?: URL | undefined;
  // Something to do instead, from where Help was opened.
  onSelect?: (() => void) | undefined;
  /*
   * Drawn beside the title in the header's menu: the "?" keycap that opens
   * the keyboard shortcuts.
   */
  rightElement?: ReactElement | undefined;
  /*
   * Only where there is a keyboard: the phone's menu leaves it out (the
   * keyboard shortcuts, on a device with no keys).
   */
  isKeyboardOnly?: boolean | undefined;
}

export interface HelpEntries {
  // The ways to learn, first.
  learn: Array<HelpEntry>;
  // The ways to ask, set apart below them.
  ask: Array<HelpEntry>;
}

/*
 * Help's entries, in the reader's language. Each one that opens something
 * in place says where it was opened from (How OneUptime works records
 * `from`).
 */
export const useHelpEntries: (
  openedFrom: HowOneUptimeWorksOpenedFrom,
) => HelpEntries = (openedFrom: HowOneUptimeWorksOpenedFrom): HelpEntries => {
  const { t, i18n } = useTranslation();
  const translator: Translator = useTranslator();
  const language: string | undefined =
    i18n?.resolvedLanguage || i18n?.language || undefined;
  // Give feedback appears once the server says it takes feedback.
  useProductFeedbackSettings();
  /*
   * Where the server sends its people for help (Admin Dashboard > Settings
   * > Help and Support, #10864): OneUptime's support address, community
   * Slack and demo by default, or the server's own address and chat, or
   * none of them.
   */
  const helpAndSupport: HelpAndSupportSettings = useHelpAndSupport();
  const supportEmail: string | null = getSupportEmailAddress(helpAndSupport);
  const chat: ChatLink | null = getChatLink(helpAndSupport);
  const requestDemoUrl: string | null = getRequestDemoUrl(helpAndSupport);
  const giveFeedbackUrl: string | null = ProductFeedback.getGiveFeedbackUrl();

  return {
    learn: [
      /*
       * The one docs page that goes from a new project to a working
       * setup, start to finish.
       */
      {
        id: "quickstart",
        title: t("help.quickstart", "Quickstart"),
        icon: IconProp.RocketLaunch,
        url: URL.fromString(getDocsPageUrl(QUICKSTART_DOCS_PAGE, language)),
      },
      /*
       * The map of the product - the four steps a problem moves through,
       * with the products that do each, then every product by category
       * (#8891) - from any page, in any project. It used to live only
       * inside Home's Welcome checklist.
       */
      {
        id: "how-oneuptime-works",
        title: t("help.howOneUptimeWorks", "How OneUptime works"),
        icon: IconProp.Map,
        onSelect: () => {
          openHowOneUptimeWorks(openedFrom);
        },
      },
      /*
       * Every word OneUptime uses, in a sentence or two: the same
       * definitions a dotted word shows where it is used.
       */
      {
        id: "glossary",
        title: t("help.glossary", "Glossary"),
        icon: IconProp.BookOpen,
        url: URL.fromString(getDocsPageUrl(GLOSSARY_INDEX_DOCS_PAGE, language)),
      },
      {
        id: "documentation",
        title: t("help.documentation", "Documentation"),
        icon: IconProp.Book,
        url: URL.fromString(DOCS_URL.toString()),
      },
    ],
    ask: [
      /*
       * Tell OneUptime what was hard, from any page (#6832): kept on this
       * server, and on OneUptime Cloud emailed to the OneUptime team, on a
       * self-hosted one to its admins where it has an Admin Notification
       * Email (#8893; the dialog says which), or to the address of the
       * server's own its admins chose (#10865). Only where the server takes
       * feedback and offers Give feedback. Where its admins sent it to a page
       * of their own, it opens that page instead of the dialog.
       */
      ...(ProductFeedback.isGiveFeedbackOffered()
        ? [
            giveFeedbackUrl
              ? ({
                  id: "give-feedback",
                  title: t("help.giveFeedback", "Give feedback"),
                  icon: IconProp.ChatBubbleLeftRight,
                  url: URL.fromStringLenient(giveFeedbackUrl),
                } as HelpEntry)
              : ({
                  id: "give-feedback",
                  title: t("help.giveFeedback", "Give feedback"),
                  icon: IconProp.ChatBubbleLeftRight,
                  onSelect: () => {
                    openGiveFeedback(
                      openedFrom === HowOneUptimeWorksOpenedFrom.PhoneMenu
                        ? GiveFeedbackOpenedFrom.PhoneMenu
                        : GiveFeedbackOpenedFrom.Help,
                    );
                  },
                } as HelpEntry),
          ]
        : []),
      /*
       * "?" opens this dialog from anywhere, but only for people who
       * already know that. Help is where someone looks when they do not,
       * and the keycap beside it teaches the shortcut on the way past.
       */
      {
        id: "keyboard-shortcuts",
        title: t("keyboardShortcuts.title", "Keyboard shortcuts"),
        icon: IconProp.Keyboard,
        isKeyboardOnly: true,
        rightElement: (
          <KeyboardShortcut
            keys={["?"]}
            size={KeyboardShortcutSize.ExtraSmall}
            variant={KeyboardShortcutVariant.Ghost}
          />
        ),
        onSelect: () => {
          GlobalEvents.dispatchEvent(EventName.KEYBOARD_SHORTCUTS_TOGGLE);
        },
      },
      ...(supportEmail
        ? [
            {
              id: "support-email",
              title: t("help.supportEmail"),
              icon: IconProp.Email,
              url: URL.fromStringLenient(`mailto:${supportEmail}`),
            } as HelpEntry,
          ]
        : []),
      ...(chat
        ? [
            {
              id: "chat-slack",
              title: getChatTitle(chat, t("help.chatSlack"), translator),
              icon: CHAT_ICONS[chat.kind],
              url: URL.fromStringLenient(chat.url),
            } as HelpEntry,
          ]
        : []),
      ...(requestDemoUrl
        ? [
            {
              id: "request-demo",
              title: t("help.requestDemo"),
              icon: IconProp.Window,
              url: URL.fromStringLenient(requestDemoUrl),
            } as HelpEntry,
          ]
        : []),
    ],
  };
};

// The mark a chat's entry is drawn with: Slack's and Teams' own, or a bubble.
export const CHAT_ICONS: Readonly<Record<ChatKind, IconProp>> = {
  [ChatKind.Slack]: IconProp.Slack,
  [ChatKind.MicrosoftTeams]: IconProp.MicrosoftTeams,
  [ChatKind.Other]: IconProp.Chat,
};

/*
 * What a chat's entry says. OneUptime's community and a Slack workspace of
 * the server's own are Chat on Slack, as it always read; a Microsoft Teams
 * link says Teams; any other chat - Mattermost, Google Chat, a help desk's
 * chat - is Chat with Support.
 */
export const CHAT_WITH_TEAMS_TITLE: string = translationKey(
  "Chat on Microsoft Teams",
);
export const CHAT_WITH_SUPPORT_TITLE: string =
  translationKey("Chat with Support");

export const getChatTitle: (
  chat: ChatLink,
  slackTitle: string,
  translator: Translator,
) => string = (
  chat: ChatLink,
  slackTitle: string,
  translator: Translator,
): string => {
  switch (chat.kind) {
    case ChatKind.Slack:
      return slackTitle;
    case ChatKind.MicrosoftTeams:
      return (
        translator.translateText(CHAT_WITH_TEAMS_TITLE) || CHAT_WITH_TEAMS_TITLE
      );
    default:
      return (
        translator.translateText(CHAT_WITH_SUPPORT_TITLE) ||
        CHAT_WITH_SUPPORT_TITLE
      );
  }
};

const Help: () => JSX.Element = (): ReactElement => {
  const { t } = useTranslation();
  const [isDropdownVisible, setIsDropdownVisible] = useState<boolean>(false);
  const entries: HelpEntries = useHelpEntries(HowOneUptimeWorksOpenedFrom.Help);

  const close: () => void = (): void => {
    setIsDropdownVisible(false);
  };

  const item: (entry: HelpEntry) => ReactElement = (
    entry: HelpEntry,
  ): ReactElement => {
    if (entry.url) {
      return (
        <IconDropdownItem
          key={entry.id}
          title={entry.title}
          icon={entry.icon}
          openInNewTab={true}
          url={entry.url}
          rightElement={entry.rightElement}
          onClick={close}
        />
      );
    }

    return (
      <IconDropdownItem
        key={entry.id}
        title={entry.title}
        icon={entry.icon}
        rightElement={entry.rightElement}
        onClick={() => {
          close();
          entry.onSelect?.();
        }}
      />
    );
  };

  return (
    <HeaderIconDropdownButton
      icon={IconProp.Help}
      name={t("help.label")}
      showDropdown={isDropdownVisible}
      onClick={() => {
        setIsDropdownVisible(true);
      }}
    >
      <IconDropdownMenu>
        <IconDropdownRow dataTestId={HELP_LEARN_GROUP_TEST_ID}>
          {entries.learn.map(item)}
        </IconDropdownRow>
        <IconDropdownRow isSeparated={true} dataTestId={HELP_ASK_GROUP_TEST_ID}>
          {entries.ask.map(item)}
        </IconDropdownRow>
      </IconDropdownMenu>
    </HeaderIconDropdownButton>
  );
};

export default Help;
