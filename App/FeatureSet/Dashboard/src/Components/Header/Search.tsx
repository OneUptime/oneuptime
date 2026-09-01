import IconProp from "Common/Types/Icon/IconProp";
import HeaderIconDropdownButton from "Common/UI/Components/Header/HeaderIconDropdownButton";
import KeyboardKey from "Common/UI/Components/KeyboardShortcut/KeyboardKey";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import React, { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import EventName from "../../Utils/EventName";

/*
 * The command palette - every page in the product, plus the create actions and
 * a live search over monitors, incidents, alerts, status pages and on-call -
 * had exactly one way in: knowing to press Cmd/Ctrl+K. Nothing on screen said
 * so, so the whole surface was invisible to anyone who had not been told about
 * it.
 *
 * This is the visible door. It sits beside Ask AI, which advertises its own
 * chord the same way, so the keycaps also teach the shortcut to whoever
 * reaches for the mouse first.
 */
const Search: () => JSX.Element = (): ReactElement => {
  /*
   * t(key, default) rather than a locale entry: en.json is the source of truth
   * the other 15 locales must mirror key-for-key (Scripts/I18n/ValidateLocales),
   * so adding the key to English alone would fail validation, and inventing
   * fifteen translations here would be worse. Same pattern
   * DashboardCommandPalette already uses for its own strings.
   */
  const { t } = useTranslation();
  const label: string = t("header.search", "Search");

  return (
    <HeaderIconDropdownButton
      icon={IconProp.Search}
      name={label}
      title={label}
      // DashboardCommandPalette listens for meta-or-ctrl + K.
      shortcut={[KeyboardKey.Mod, "K"]}
      showDropdown={false}
      onClick={() => {
        GlobalEvents.dispatchEvent(EventName.COMMAND_PALETTE_TOGGLE);
      }}
    />
  );
};

export default Search;
