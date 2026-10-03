import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * Whether OneUptime's support team may open the project, on Settings ->
 * Project. Only where OneUptime bills (BILLING_ENABLED): on a self-hosted
 * install there is no OneUptime support team to let in.
 *
 * It used to be an "Enable Customer Support Access" card whose Edit dialog
 * held one switch, "Let Customer Support Access Project". The card is the
 * switch now (CustomerSupportAccessCard, on the shared ModelSwitchCard), and
 * it saves the moment it is flipped.
 *
 * Letting support in asks first, and says what it grants: OneUptime's
 * support staff are master admins, who can see and change everything in a
 * project they can open. Taking the access away again saves at once - it is
 * the safe way, and must never take a dialog.
 *
 * The admin dashboard's Project -> Support page holds the same switch for
 * OneUptime staff (with its own words and locale files).
 *
 * Kept free of React so the card and App/Tests read these exact strings.
 * Every sentence is wrapped in translationKey() so npm run i18n:extract
 * finds it.
 */

export const CustomerSupportAccessSwitchCopy: {
  cardTitle: string;
  cardDescription: string;
  switchTitle: string;
  switchOnDescription: string;
  switchOffDescription: string;
  // The dialog before support is let in.
  allowConfirmTitle: string;
  allowConfirmDescription: string;
  allowConfirmButton: string;
} = {
  cardTitle: translationKey("Customer Support Access"),
  cardDescription: translationKey(
    "Let OneUptime's support team into this project when you want their help with it.",
  ),
  switchTitle: translationKey("Let OneUptime support access this project"),
  switchOnDescription: translationKey(
    "OneUptime's support team can open this project, and see and change everything in it. Turn this off once they have finished helping you.",
  ),
  switchOffDescription: translationKey(
    "OneUptime's support team cannot open this project.",
  ),
  allowConfirmTitle: translationKey("Let OneUptime support into this project?"),
  allowConfirmDescription: translationKey(
    "OneUptime's support team will be able to open this project, and see and change everything in it, its settings and data included, until you turn this off.",
  ),
  allowConfirmButton: translationKey("Let support in"),
};

// The Project column the switch writes.
export type CustomerSupportAccessSwitchColumn =
  "letCustomerSupportAccessProject";

export const CUSTOMER_SUPPORT_ACCESS_SWITCH_COLUMN: CustomerSupportAccessSwitchColumn =
  "letCustomerSupportAccessProject";

// The data-testid of the switch.
export const CUSTOMER_SUPPORT_ACCESS_SWITCH_TEST_ID: string =
  "project-customer-support-access-switch";

export default CustomerSupportAccessSwitchCopy;
