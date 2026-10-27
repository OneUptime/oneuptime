import {
  FOLDED_SECTION_OFF,
  FoldedSectionItem,
  foldedSectionItem,
} from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import { getPageAnchorNameForTitle } from "Common/UI/Utils/PageAnchor";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The "Powered by OneUptime" line at the foot of a status page, on Advanced
 * -> Advanced Settings under "What your status page shows": one switch,
 * on = visitors see the line. The column stores the opposite
 * (StatusPage.hidePoweredByOneUptimeBranding), so the switch is inverted.
 *
 * Hiding the line is an Enterprise feature: the Enterprise card
 * (ee/Dashboard/StatusPageBranding) holds the switch, and core keeps the
 * shell (StatusPagePoweredBySettings). The server shows the line on every
 * page while the feature is not active, whatever the switch says
 * (Server/Utils/StatusPage/StatusPagePoweredBy).
 *
 * Kept free of React so the components and the tests read these exact
 * strings. Every string is wrapped in translationKey() so npm run
 * i18n:extract finds it.
 */

// The status page column the switch writes.
export type PoweredBySwitchColumn = "hidePoweredByOneUptimeBranding";

export const POWERED_BY_COLUMN: PoweredBySwitchColumn =
  "hidePoweredByOneUptimeBranding";

export const STATUS_PAGE_POWERED_BY_SWITCH_TEST_ID: string =
  "status-page-powered-by-switch";

export const StatusPagePoweredByCopy: {
  cardTitle: string;
  cardDescription: string;
  switchTitle: string;
  shownDescription: string;
  hiddenDescription: string;
} = {
  cardTitle: translationKey("Powered by OneUptime"),
  cardDescription: translationKey(
    "Whether the footer of this status page says Powered by OneUptime.",
  ),
  switchTitle: translationKey("Show Powered By OneUptime Branding"),
  shownDescription: translationKey(
    "On: the footer of this status page says Powered by OneUptime.",
  ),
  hiddenDescription: translationKey(
    "Off: the footer shows only your own links.",
  ),
};

/*
 * The card's place in the page's More settings: its title's
 * (#powered-by-oneuptime), the Enterprise card's and the upsell's alike.
 */
export const STATUS_PAGE_POWERED_BY_PLACE: string = getPageAnchorNameForTitle(
  StatusPagePoweredByCopy.cardTitle,
);

/*
 * Powered by OneUptime as the page's folded More settings names it: "Off"
 * while the line is hidden, which a new status page never is; its name
 * otherwise. Unread (null), its name.
 */
export const getPoweredByFoldedItem: (
  isShown: boolean | null,
) => FoldedSectionItem = (isShown: boolean | null): FoldedSectionItem => {
  return foldedSectionItem(StatusPagePoweredByCopy.cardTitle, {
    key: STATUS_PAGE_POWERED_BY_PLACE,
    isSet: isShown === false,
    value: FOLDED_SECTION_OFF,
    translateValue: true,
  });
};

// The sentence under the switch, for the way it is set (on = shown).
export const getPoweredByDescription: (isShown: boolean) => string = (
  isShown: boolean,
): string => {
  return isShown
    ? StatusPagePoweredByCopy.shownDescription
    : StatusPagePoweredByCopy.hiddenDescription;
};

export default StatusPagePoweredByCopy;
