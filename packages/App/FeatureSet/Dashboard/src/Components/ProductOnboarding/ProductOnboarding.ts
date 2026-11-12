import Route from "Common/Types/API/Route";
import ProductKey, {
  OnboardedProductKey,
} from "Common/Types/Product/ProductKey";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import PageMap from "../../Utils/PageMap";
import { ResourceShowcase } from "../ResourceShowcase/ResourceShowcase";

/*
 * HOW EVERY PRODUCT EXPLAINS ITSELF.
 *
 * A product's first page says what the product does while the project has
 * nothing in it yet, the way an empty resource list does (ResourceShowcase):
 * a pitch, the steps to a first result with the first one as the button,
 * a drawn example of what the page shows once it is in use, and a link to
 * the product's documentation. Once there is something in it, the same
 * explanation is one click away: "How it works" beside the page's title
 * (ProductAboutButton) opens it in a dialog.
 *
 *   ┌ eyebrow · title · description      ┐ ┌ example: the page in use  ┐
 *   │ 1 first step  2 next  3 result     │ │ stats, a chart, rows      │
 *   └ [ first step ]  Documentation      ┘ └ (and what it raised)      ┘
 *
 * Every product of the products menu (Utils/NavigationItems) has an entry
 * here, keyed by the page the menu opens; a test holds the two lists
 * together. The resources keep the showcases they had (a Kubernetes
 * cluster's, a host's), and the other products describe theirs in
 * ./Showcases. Which page draws what:
 *
 *   - a list (Monitors, Incidents, Status Pages ...): its empty table, and
 *     the showcase under it with the list's own Create button
 *     (ProductShowcase), until the first record. The table already says
 *     what the list is for, so the showcase leaves its description out
 *     there (About says it). Someone who may not create one reads the
 *     showcase without the button, under the table's own locked one;
 *   - telemetry (Logs, Traces, Metrics, Exceptions, Profiles): the showcase
 *     over the explorer until the project's first telemetry arrives, its
 *     button the setup guide that waits for that data
 *     (TelemetryFirstRunShowcase);
 *   - a product with get-started steps of its own (Network, Security
 *     Events, Data Security, Code, AI / LLM): the showcase under those
 *     steps, as the explanation, without steps or a button of its own.
 *
 * React-free, so App's tests read every product's words.
 */

/*
 * The products' names (Common/Types/Product/ProductKey, #6814): every entry
 * of the products menu has one, and the 43 that explain themselves here are
 * the OnboardedProductKey ones. Re-exported, so everything that always read
 * ProductKey from here still does.
 */
export { ProductKey };
export type { OnboardedProductKey };

export interface ProductOnboarding {
  // The page the products menu opens for the product.
  page: PageMap;
  /*
   * English translation key: the product's name, as the About dialog's
   * title says it ("Monitors").
   */
  name: string;
  showcase: ResourceShowcase;
  // The product's documentation: a page of the docs (/docs/...).
  docsRoute: Route;
  /*
   * The start-to-finish guide to the job people come to this product for
   * (a page of the docs' Guides group, #6821), where the docs have one:
   * linked first, as "Step-by-step guide", beside the documentation. The
   * empty list and "How it works" both draw it, so the guide is where the
   * job starts.
   */
  guideRoute?: Route | undefined;
}

/*
 * The products menu entries with no first page of their own to explain:
 * each opens something that is not a product page.
 */
export const PRODUCTS_WITHOUT_ONBOARDING: Record<string, string> = {
  [PageMap.HOME]: "The project's home page, not a product.",
  [PageMap.AI_COPILOT]:
    "Opens the Ask AI panel over the current page; it has no page of its own.",
  [PageMap.USERS]: "Project settings: who is in the project.",
  [PageMap.TEAMS]: "Project settings: the project's teams.",
  [PageMap.SETTINGS]: "Project settings.",
  [PageMap.USER_SETTINGS]:
    "Your own settings: notifications, profile and more.",
};

// What a screen reader hears for a product's example.
export const PRODUCT_EXAMPLE_DESCRIPTION: string = translationKey(
  "An example of what this page shows once it is in use.",
);

/*
 * The button beside a product page's title that opens its explanation
 * (ProductAboutButton). Not "About": that key already reads "Regarding"
 * in most of the Dashboard's languages (German "Betrifft").
 */
export const PRODUCT_ABOUT_TEXT: string = translationKey("How it works");
