import React from "react";

/*
 * The id of the header button a menu hangs from, so the menu is named by
 * its own button (IconDropdownMenu's aria-labelledby).
 *
 * Every header button used to take the one id "user-menu-button", and every
 * menu was labelled by it: with Help and the profile button both in the
 * header, the page had that id twice, and a screen reader read the profile
 * menu as Help's (the first button with the id). HeaderIconDropdownButton
 * now gives each button an id of its own and hands it down to its menu
 * through this context.
 */
export const HeaderMenuButtonIdContext: React.Context<string | undefined> =
  React.createContext<string | undefined>(undefined);
