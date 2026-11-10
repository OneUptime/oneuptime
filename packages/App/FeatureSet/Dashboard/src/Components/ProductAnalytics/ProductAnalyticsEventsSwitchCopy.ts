import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import { ModelSwitchColumn } from "Common/UI/Components/ModelSwitch/ModelSwitchUtil";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The words of the product analytics events switch (issue #6444, part two),
 * shared by the application's Settings card and the panel the Events,
 * Funnels and Retention pages show while the switch is off. React-free so
 * the wording is tested on its own.
 */

export const PRODUCT_ANALYTICS_EVENTS_SWITCH_COLUMN: ModelSwitchColumn<RumApplication> =
  "isProductAnalyticsEnabled";

export const PRODUCT_ANALYTICS_EVENTS_SWITCH_TEST_ID: string =
  "product-analytics-events-switch";

const ProductAnalyticsEventsSwitchCopy: {
  cardTitle: string;
  cardDescription: string;
  switchTitle: string;
  switchDescription: string;
  offDescription: string;
  replayOffNote: string;
  propertiesCardTitle: string;
  propertiesCardDescription: string;
  propertiesFieldTitle: string;
  propertiesFieldDescription: string;
  noProperties: string;
} = {
  cardTitle: translationKey("Product Analytics"),
  cardDescription: translationKey(
    "Events, Funnels and User Retention count what people do in your app: every session's start and page views, and the events and numbers your app sends with track() and metric().",
  ),
  switchTitle: translationKey("Send product analytics events"),
  switchDescription: translationKey(
    "The browser recorder sends each session's start, its page views and your track() and metric() calls from every session, recorded or not. Consent, Do Not Track and the allowed origins apply as they do to recordings.",
  ),
  offDescription: translationKey(
    "Turn them on to count every session's start, page views and the events your app sends with track(). Nothing changes on your pages: the recorder you installed for Session Replay sends them.",
  ),
  // {{replayPolicy}}: a link to the page, in the words of its menu item.
  replayOffNote: translationKey(
    "Session Replay is off for this application, and its recorder is what sends the events. Turn it on under {{replayPolicy}} too.",
  ),
  propertiesCardTitle: translationKey("User Properties for Analytics"),
  propertiesCardDescription: translationKey(
    "The identify() traits kept on each event, so Events, Funnels and User Retention can be broken down and segmented by them. Any other trait never leaves the page.",
  ),
  propertiesFieldTitle: translationKey("User properties"),
  propertiesFieldDescription: translationKey(
    'A JSON array of trait keys, as your app passes them to identify(): ["plan", "role"]. At most 20. Kept only while end-user identity capture is on. Do not list traits that hold personal data, such as an email address.',
  ),
  noProperties: translationKey("None: events carry no user properties"),
};

export default ProductAnalyticsEventsSwitchCopy;
