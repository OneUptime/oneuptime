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
  HowOneUptimeWorksOpenedFrom,
  openHowOneUptimeWorks,
} from "../Home/HowOneUptimeWorksDialog";
import React, { ReactElement, useState } from "react";
import { useTranslation } from "react-i18next";

/*
 * Help starts with learning: the Quickstart, How OneUptime works, the
 * Glossary and the Documentation, in the order someone new reaches for
 * them. Then the ways to ask: the keyboard shortcuts, support by email and
 * on Slack, and a demo.
 *
 * Every docs page opens on this OneUptime instance (DOCS_URL), so it works
 * for self-hosted installs without internet access too, and in the
 * language the reader picked in the dashboard when the docs have it.
 */

export const HELP_LEARN_GROUP_TEST_ID: string = "help-learn";
export const HELP_ASK_GROUP_TEST_ID: string = "help-ask";

const Help: () => JSX.Element = (): ReactElement => {
  const { t, i18n } = useTranslation();
  const [isDropdownVisible, setIsDropdownVisible] = useState<boolean>(false);
  const language: string | undefined =
    i18n?.resolvedLanguage || i18n?.language || undefined;

  const close: () => void = (): void => {
    setIsDropdownVisible(false);
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
          {/*
           * The one docs page that goes from a new project to a working
           * setup, start to finish.
           */}
          <IconDropdownItem
            title={t("help.quickstart", "Quickstart")}
            icon={IconProp.RocketLaunch}
            openInNewTab={true}
            url={URL.fromString(getDocsPageUrl(QUICKSTART_DOCS_PAGE, language))}
            onClick={close}
          />
          {/*
           * The map of the product - four products in the order a problem
           * flows through them - from any page, in any project. It used to
           * live only inside Home's Welcome checklist.
           */}
          <IconDropdownItem
            title={t("help.howOneUptimeWorks", "How OneUptime works")}
            icon={IconProp.Map}
            onClick={() => {
              close();
              openHowOneUptimeWorks(HowOneUptimeWorksOpenedFrom.Help);
            }}
          />
          {/*
           * Every word OneUptime uses, in a sentence or two: the same
           * definitions a dotted word shows where it is used.
           */}
          <IconDropdownItem
            title={t("help.glossary", "Glossary")}
            icon={IconProp.BookOpen}
            openInNewTab={true}
            url={URL.fromString(
              getDocsPageUrl(GLOSSARY_INDEX_DOCS_PAGE, language),
            )}
            onClick={close}
          />
          <IconDropdownItem
            title={t("help.documentation", "Documentation")}
            icon={IconProp.Book}
            openInNewTab={true}
            url={URL.fromString(DOCS_URL.toString())}
            onClick={close}
          />
        </IconDropdownRow>
        <IconDropdownRow isSeparated={true} dataTestId={HELP_ASK_GROUP_TEST_ID}>
          {/*
           * "?" opens this dialog from anywhere, but only for people who
           * already know that. Help is where someone looks when they do not,
           * and the keycap beside it teaches the shortcut on the way past.
           */}
          <IconDropdownItem
            title={t("keyboardShortcuts.title", "Keyboard shortcuts")}
            icon={IconProp.Keyboard}
            rightElement={
              <KeyboardShortcut
                keys={["?"]}
                size={KeyboardShortcutSize.ExtraSmall}
                variant={KeyboardShortcutVariant.Ghost}
              />
            }
            onClick={() => {
              close();
              GlobalEvents.dispatchEvent(EventName.KEYBOARD_SHORTCUTS_TOGGLE);
            }}
          />
          <IconDropdownItem
            title={t("help.supportEmail")}
            icon={IconProp.Email}
            openInNewTab={true}
            url={URL.fromString("mailto:support@oneuptime.com")}
            onClick={close}
          />
          <IconDropdownItem
            title={t("help.chatSlack")}
            icon={IconProp.Slack}
            openInNewTab={true}
            onClick={close}
            url={URL.fromString(
              "https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA",
            )}
          />
          <IconDropdownItem
            title={t("help.requestDemo")}
            icon={IconProp.Window}
            onClick={close}
            openInNewTab={true}
            url={URL.fromString("https://oneuptime.com/enterprise/demo")}
          />
        </IconDropdownRow>
      </IconDropdownMenu>
    </HeaderIconDropdownButton>
  );
};

export default Help;
