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
  const language: string | undefined =
    i18n?.resolvedLanguage || i18n?.language || undefined;
  // Give feedback appears once the server says it takes feedback.
  useProductFeedbackSettings();

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
       * The map of the product - four products in the order a problem
       * flows through them - from any page, in any project. It used to
       * live only inside Home's Welcome checklist.
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
       * server for its admins. Only where the server takes feedback.
       */
      ...(ProductFeedback.isOn()
        ? [
            {
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
            } as HelpEntry,
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
      {
        id: "support-email",
        title: t("help.supportEmail"),
        icon: IconProp.Email,
        url: URL.fromString("mailto:support@oneuptime.com"),
      },
      {
        id: "chat-slack",
        title: t("help.chatSlack"),
        icon: IconProp.Slack,
        url: URL.fromString(
          "https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA",
        ),
      },
      {
        id: "request-demo",
        title: t("help.requestDemo"),
        icon: IconProp.Window,
        url: URL.fromString("https://oneuptime.com/enterprise/demo"),
      },
    ],
  };
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
