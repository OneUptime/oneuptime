import {
  FoldedSectionItem,
  foldedSectionItem,
} from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import { getPageAnchorNameForTitle } from "Common/UI/Utils/PageAnchor";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * "Sign-In Links", folded under More settings on a status page's Security ->
 * Private Users: one switch, on for every page until its team turns it off,
 * that lets private users sign in with a link emailed to them instead of
 * their password (Common/Types/StatusPage/StatusPageMagicLink). Folded
 * because almost nobody changes it; the folded header says "Sign-In Links:
 * Off" once somebody has, so it is never hidden while it is not the default.
 */
const StatusPageMagicLinkCopy: {
  sectionDescription: string;
  cardTitle: string;
  switchTitle: string;
  switchOnDescription: string;
  switchOffDescription: string;
  note: string;
  offValue: string;
} = {
  sectionDescription: translationKey("How private users sign in."),
  cardTitle: translationKey("Sign-In Links"),
  switchTitle: translationKey("Sign in with a link"),
  switchOnDescription: translationKey(
    "Private users can ask for a one-time link on the sign-in page and sign in from their email, without a password. Their password still works.",
  ),
  switchOffDescription: translationKey(
    "Private users sign in with their email and password.",
  ),
  note: translationKey(
    "Each link works once and expires after 15 minutes; none is offered while SSO is required. Turning this off keeps signed-in readers signed in.",
  ),
  offValue: translationKey("Off"),
};

// The status page column the switch writes.
export type StatusPageMagicLinkColumn = "enableMagicLinkLogin";

export const STATUS_PAGE_MAGIC_LINK_COLUMN: StatusPageMagicLinkColumn =
  "enableMagicLinkLogin";

export const STATUS_PAGE_MAGIC_LINK_SWITCH_TEST_ID: string =
  "status-page-magic-link-switch";

export const STATUS_PAGE_MAGIC_LINK_SECTION_TEST_ID: string =
  "status-page-magic-link-section";

// The card's place on the page (#sign-in-links): a link to it opens More settings.
export const STATUS_PAGE_MAGIC_LINK_PLACE: string = getPageAnchorNameForTitle(
  StatusPageMagicLinkCopy.cardTitle,
);

/*
 * Sign-In Links as the folded More settings names it: a chip saying "Off"
 * once the switch is off - not the default - and its name otherwise. Unread
 * (undefined), its name.
 */
export const getMagicLinkFoldedItem: (
  isOn: boolean | undefined,
) => FoldedSectionItem = (isOn: boolean | undefined): FoldedSectionItem => {
  const isOff: boolean = isOn === false;

  return foldedSectionItem(StatusPageMagicLinkCopy.cardTitle, {
    key: STATUS_PAGE_MAGIC_LINK_PLACE,
    isSet: isOff,
    value: isOff ? StatusPageMagicLinkCopy.offValue : undefined,
    translateValue: true,
  });
};

export default StatusPageMagicLinkCopy;
