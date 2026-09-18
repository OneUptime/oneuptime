import URL from "Common/Types/API/URL";
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
import EventName from "../../Utils/EventName";
import React, { ReactElement, useState } from "react";
import { useTranslation } from "react-i18next";

const Help: () => JSX.Element = (): ReactElement => {
  const { t } = useTranslation();
  const [isDropdownVisible, setIsDropdownVisible] = useState<boolean>(false);

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
        <IconDropdownRow>
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
              setIsDropdownVisible(false);
              GlobalEvents.dispatchEvent(EventName.KEYBOARD_SHORTCUTS_TOGGLE);
            }}
          />
          <IconDropdownItem
            title={t("help.supportEmail")}
            icon={IconProp.Email}
            openInNewTab={true}
            url={URL.fromString("mailto:support@oneuptime.com")}
            onClick={() => {
              setIsDropdownVisible(false);
            }}
          />
          <IconDropdownItem
            title={t("help.chatSlack")}
            icon={IconProp.Slack}
            openInNewTab={true}
            onClick={() => {
              setIsDropdownVisible(false);
            }}
            url={URL.fromString(
              "https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA",
            )}
          />
          <IconDropdownItem
            title={t("help.requestDemo")}
            icon={IconProp.Window}
            onClick={() => {
              setIsDropdownVisible(false);
            }}
            openInNewTab={true}
            url={URL.fromString("https://oneuptime.com/enterprise/demo")}
          />
        </IconDropdownRow>
      </IconDropdownMenu>
    </HeaderIconDropdownButton>
  );
};

export default Help;
