import EventName from "../../Utils/EventName";
import { HelpEntries, HelpEntry, useHelpEntries } from "../Header/Help";
import { HowOneUptimeWorksOpenedFrom } from "../Home/HowOneUptimeWorksDialog";
import IconProp from "Common/Types/Icon/IconProp";
import Icon, { ThickProp } from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import React, { FunctionComponent, ReactElement, useId, useState } from "react";
import { useTranslation } from "react-i18next";

/*
 * SEARCH AND HELP ON A PHONE (#6816).
 *
 * Below 768 pixels (Common's PHONE_MENU_BELOW_WIDTH_IN_PX) the products
 * menu is the phone's menu toggle, and the header leaves out Search, Ask AI
 * and Help to keep its width. So on a phone there was no way to Search, the
 * docs or support at all. The phone's menu now starts with Search and ends
 * with Help, and the header stays as narrow as it was. From 768 up the
 * header draws Search and Help itself (#7037), so each is in exactly one of
 * the two at every width; Ask AI, from 1024 up, is in Search below that.
 */

export const PHONE_MENU_SEARCH_TEST_ID: string = "navbar-mobile-search";
export const PHONE_MENU_HELP_TEST_ID: string = "navbar-mobile-help";
export const PHONE_MENU_HELP_LEARN_TEST_ID: string = "navbar-mobile-help-learn";
export const PHONE_MENU_HELP_ASK_TEST_ID: string = "navbar-mobile-help-ask";

export interface PhoneMenuEntryProps {
  // Closes the phone's menu: called before whatever the entry opens.
  closeMenu: () => void;
}

/*
 * Search, at the top of the phone's menu: drawn as a search box, so it reads
 * as one, and opening Search (the command palette, Cmd/Ctrl+K on a
 * computer) over the page. Every page, record and action it finds on a
 * computer, it finds on a phone.
 */
export const PhoneMenuSearch: FunctionComponent<PhoneMenuEntryProps> = (
  props: PhoneMenuEntryProps,
): ReactElement => {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      data-testid={PHONE_MENU_SEARCH_TEST_ID}
      onClick={() => {
        props.closeMenu();
        GlobalEvents.dispatchEvent(EventName.COMMAND_PALETTE_TOGGLE);
      }}
      className="mb-2 flex w-full items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-start text-base text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
    >
      <Icon
        icon={IconProp.Search}
        className="h-4 w-4 flex-shrink-0 text-gray-400"
        thick={ThickProp.Thick}
      />
      <span>{t("header.search", "Search")}</span>
    </button>
  );
};

const ROW_CLASS_NAME: string =
  "flex w-full items-center rounded-md py-2 px-3 text-start text-base font-medium text-gray-900 hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

/*
 * Help, at the bottom of the phone's menu: one row that folds and opens like
 * a category of products, holding the header's Help entries
 * (useHelpEntries) - the ways to learn first, then the ways to ask - so the
 * two menus never drift. The keyboard shortcuts are left out: a phone has
 * no keys.
 */
export const PhoneMenuHelp: FunctionComponent<PhoneMenuEntryProps> = (
  props: PhoneMenuEntryProps,
): ReactElement => {
  const { t } = useTranslation();
  const entries: HelpEntries = useHelpEntries(
    HowOneUptimeWorksOpenedFrom.PhoneMenu,
  );
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const idPrefix: string = `phone-help-${useId()}`;
  const headingId: string = `${idPrefix}-heading`;
  const bodyId: string = `${idPrefix}-body`;

  const askEntries: Array<HelpEntry> = entries.ask.filter(
    (entry: HelpEntry): boolean => {
      return !entry.isKeyboardOnly;
    },
  );

  const row: (entry: HelpEntry) => ReactElement = (
    entry: HelpEntry,
  ): ReactElement => {
    const content: ReactElement = (
      <>
        <Icon
          icon={entry.icon}
          className="mr-1.5 h-4 w-4 flex-shrink-0"
          thick={ThickProp.Thick}
        />
        <span>{entry.title}</span>
      </>
    );

    if (entry.url) {
      return (
        <Link
          key={entry.id}
          to={entry.url}
          openInNewTab={true}
          className={ROW_CLASS_NAME}
          onClick={props.closeMenu}
        >
          {content}
        </Link>
      );
    }

    return (
      <button
        key={entry.id}
        type="button"
        className={ROW_CLASS_NAME}
        onClick={() => {
          props.closeMenu();
          entry.onSelect?.();
        }}
      >
        {content}
      </button>
    );
  };

  return (
    <div
      role="group"
      aria-labelledby={headingId}
      data-testid={PHONE_MENU_HELP_TEST_ID}
      className="block w-full mt-1 border-t border-gray-100 pt-2"
    >
      {/*
       * A row of the menu that folds and opens, as a category of products
       * does, with no count: it holds ways to learn, not products.
       */}
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={isOpen ? bodyId : undefined}
        onClick={() => {
          setIsOpen(!isOpen);
        }}
        className={`${ROW_CLASS_NAME} justify-between`}
      >
        <span className="flex min-w-0 items-center">
          <Icon
            icon={IconProp.Help}
            className="mr-1.5 h-4 w-4 flex-shrink-0"
            thick={ThickProp.Thick}
          />
          <span id={headingId}>{t("help.label", "Help")}</span>
        </span>
        <Icon
          icon={IconProp.ChevronDown}
          className={`ml-2 h-4 w-4 flex-shrink-0 text-gray-400 transition-transform duration-200 ${
            isOpen ? "rotate-0" : "-rotate-90 [&:dir(rtl)]:rotate-90"
          }`}
        />
      </button>
      {isOpen && (
        <div
          id={bodyId}
          className="ml-5 mt-1 space-y-1 border-l border-gray-100 pl-1"
        >
          <div
            data-testid={PHONE_MENU_HELP_LEARN_TEST_ID}
            className="space-y-1"
          >
            {entries.learn.map(row)}
          </div>
          <div
            data-testid={PHONE_MENU_HELP_ASK_TEST_ID}
            className="space-y-1 border-t border-gray-100 pt-1"
          >
            {askEntries.map(row)}
          </div>
        </div>
      )}
    </div>
  );
};
