import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * THE STATUS PAGES LIST, CREATING ONE, AND A STATUS PAGE'S OVERVIEW.
 *
 * Create Status Page asked for "Name - Any friendly name of this object"
 * and "Description - Friendly description that will help you remember",
 * the model's column help, and left the new page in the list for somebody
 * to open. The page's Overview then opened on "Status Page Preview URL -
 * Here's a link to preview your status page: <an address in grey text>"
 * and the details card, whatever the page held - nothing said that a new
 * status page shows visitors nothing until monitors are added to it, on a
 * page two sections down the menu.
 *
 * Now Create asks for the name, with the description and the labels under
 * More fields, and opens the new page's Overview. While the page shows no
 * monitors, its Overview starts with that one next step (Add Monitors, which
 * opens its Resources page).
 *
 * The link card showed one address, the page's address on OneUptime's own
 * domain, whatever custom domains the page had. It now lists every address
 * the page answers at - its custom domains first, each live one to open and
 * copy, each one not live yet saying why - then the OneUptime address
 * (Components/CustomDomain/PublicAddresses, which a dashboard's Sharing page
 * draws too), and says when visitors have to sign in or enter a password.
 *
 * Kept free of React so the page, its components and App/Tests read these
 * exact strings. Every string is a whole sentence or a whole name, wrapped
 * in translationKey() so npm run i18n:extract finds it, and translated in
 * all seventeen Dashboard locale files.
 */

export const StatusPageOverviewCopy: {
  // The create form and the details card's Edit dialog.
  namePlaceholder: string;
  descriptionPlaceholder: string;
  // The link card, first on the Overview.
  linkCardTitle: string;
  linkCardDescription: string;
  // Under its addresses, when visitors cannot just open them.
  linkCardSignInRequired: string;
  linkCardPasswordRequired: string;
  linkCardChangeAccess: string;
  // A page that shows no monitors yet, on its Overview.
  firstStepTitle: string;
  firstStepDescription: string;
  firstStepReaderDescription: string;
  firstStepButton: string;
} = {
  namePlaceholder: translationKey("e.g., Acme Status"),
  descriptionPlaceholder: translationKey("e.g., For customers in Europe"),
  linkCardTitle: translationKey("Status Page Link"),
  linkCardDescription: translationKey("Where visitors find your status page."),
  linkCardSignInRequired: translationKey(
    "Visitors sign in to see this status page.",
  ),
  linkCardPasswordRequired: translationKey(
    "Visitors enter the password to see this status page.",
  ),
  linkCardChangeAccess: translationKey("Change access"),
  firstStepTitle: translationKey("Nothing on this status page yet"),
  firstStepDescription: translationKey(
    "Add the monitors visitors should see. Each one shows its live status and uptime.",
  ),
  firstStepReaderDescription: translationKey(
    "Visitors see no status here until monitors are added on its Resources page.",
  ),
  firstStepButton: translationKey("Add Monitors"),
};

// The link card's body, where the addresses and Copy link are.
export const STATUS_PAGE_LINK_TEST_ID: string = "status-page-link";

// Its line saying that visitors sign in, or enter a password.
export const STATUS_PAGE_LINK_ACCESS_TEST_ID: string =
  "status-page-link-access";

// The domain the card's "such as" names: what most status pages use.
export const STATUS_PAGE_EXAMPLE_DOMAIN: string = "status.example.com";

// The first step on the Overview of a page that shows no monitors yet.
export const STATUS_PAGE_FIRST_STEP_TEST_ID: string = "status-page-first-step";

// Its Add Monitors button.
export const STATUS_PAGE_FIRST_STEP_BUTTON_TEST_ID: string =
  "status-page-first-step-add-monitors";

export default StatusPageOverviewCopy;
