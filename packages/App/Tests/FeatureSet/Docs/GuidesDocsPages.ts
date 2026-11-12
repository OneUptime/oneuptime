/*
 * THE GUIDES (#6821): one page per job people come to OneUptime with, each
 * followed from its first line to its last. GuidesDocs.test.ts holds every
 * guide here to one shape, in every language; GuidesDocsFacts.test.ts holds
 * what each one says to the product.
 *
 * A new guide is one entry here, its page in Content/<language>/guides/ in
 * all 17 languages, its link in Utils/Nav.ts's Guides group (with isGuide),
 * its job's card on Getting Started (GETTING_STARTED_JOBS), a "New here?"
 * line on the reference pages it replaces for a newcomer, and its link on
 * the README's "Step-by-step guides" line (and its 16 translations).
 */

export interface DocsGuide {
  // The page, as "guides/<job>".
  page: string;
  // The nav link's title, which is the page's title too.
  navTitle: string;
  // The job on Getting Started's "What do you want to do?" it answers.
  job: string;
  /*
   * Every word of the Dashboard the guide names in bold, in English: a key
   * of the Dashboard's English locale, or a menu path of them joined by
   * " → ". Each translation names it as that language's Dashboard draws it.
   */
  dashboardLabels: ReadonlyArray<string>;
  /*
   * The reference pages a newcomer would otherwise read for this job. Each
   * opens, in every language, with "New here? Follow the guide first."
   */
  referencePages: ReadonlyArray<string>;
  // The Quickstart section, by its English heading, that ends with a link here.
  quickstartSection?: string | undefined;
  /*
   * Where the product starts the job, each linking the guide as "Step-by-step
   * guide": the products whose explanation (the empty list's showcase and
   * "How it works") does, by ProductKey, and the guided setup that does,
   * by the copy file naming the guide and the page drawing the frame.
   */
  products: ReadonlyArray<string>;
  guidedSetup?:
    | {
        copyFile: string;
        constant: string;
        pageFile: string;
      }
    | undefined;
}

// The sections every guide has, in this order.
export const GUIDE_SECTIONS: ReadonlyArray<string> = [
  "What you need",
  "Steps",
  "Check that it worked",
  "What can go wrong",
  "What to do next",
];

// How every guide opens, and the title of the picture under that sentence.
export const GUIDE_OPENING: string = "At the end of this guide,";
export const GUIDE_PICTURE_TITLE: string = "What you will have at the end";

// Where Cloud and self-hosting differ, a guide shows these two tabs.
export const GUIDE_TABS: ReadonlyArray<string> = [
  "OneUptime Cloud",
  "Self-hosted",
];

// A guide is read in one sitting: under this many words of prose, in English.
export const GUIDE_WORD_LIMIT: number = 1200;

// The line a reference page opens with, in English, before the guide's link.
export const NEW_HERE_LEAD: string = "New here? Follow the guide first:";

export const DOCS_GUIDES: ReadonlyArray<DocsGuide> = [
  {
    page: "guides/website-down",
    navTitle: "Know When Your Website or API Is Down",
    job: "Know when your website or API is down",
    dashboardLabels: [
      "Know when my website or API is down",
      "Owners",
      "Home",
      "What do you want to do first?",
      "Continue",
      "Create your first monitor",
      "Welcome to OneUptime 👋",
      "What should we check?",
      "Website or API address",
      "This is an API endpoint",
      "Start checking",
      "Who should be told?",
      "Who is paged",
      "Add teammates",
      "Save and continue",
      "Send a test",
      "Send me a test page",
      "Severity",
      "Send test page",
      "Done",
      "Checked",
      "When it goes down",
      "Who is told",
      "Tested",
      "Open the monitor",
      "Show the chain",
      "When this goes down",
      "Nothing stops the chain.",
      "Check another address",
      "Monitors → Settings → Probes",
      "Set up email",
      "Send another test",
      "Skip the test",
      "I did not get it",
    ],
    referencePages: ["monitor/website-monitor", "monitor/api-monitor"],
    quickstartSection: "Monitor your website",
    products: ["Monitors"],
    guidedSetup: {
      copyFile: "Components/GuidedSetup/WebsiteDown/WebsiteDownSetup.ts",
      constant: "WEBSITE_DOWN_SETUP_GUIDE_DOCS_PATH",
      pageFile: "Components/GuidedSetup/WebsiteDown/WebsiteDownGuidedSetup.tsx",
    },
  },
  {
    page: "guides/paging",
    navTitle: "Get Paged by Phone, SMS or Push",
    job: "Get paged by phone, SMS or push, and escalate",
    dashboardLabels: [
      "Page the right person when something breaks",
      "Home",
      "Set up an on-call policy",
      "Welcome to OneUptime 👋",
      "What do you want to do first?",
      "Continue",
      "Recheck",
      "Mobile app or browser",
      "How should we reach you?",
      "Turn on SMS and phone calls",
      "Add balance",
      "Amount (USD)",
      "Recharge",
      "Your phone number",
      "Text me a code",
      "Verify",
      "Who else is on call?",
      "Paged first",
      "Add teammates",
      "Save and continue",
      "On-call policy",
      "Add to the first escalation rule",
      "Can a page reach them?",
      "Send setup reminder",
      "What if nobody answers?",
      "Page someone else",
      "Paged next",
      "Minutes to wait",
      "Page the same people again",
      "Times to page again",
      "Send a test page",
      "Test this policy",
      "Severity",
      "Send test page",
      "Done",
      "Paging is set up",
      "Who is paged",
      "If nobody answers",
      "Tested",
      "Needs attention",
      "Open the on-call policy",
      "Walk every escalation level",
      "Set up SMS and calls",
      "Project Settings → Billing and Invoices → Billing",
      "Add Payment Method",
      "I did not get it",
      "Open my notification methods",
    ],
    referencePages: [
      "on-call/index",
      "on-call/escalation-rules",
      "notifications/notification-methods",
    ],
    quickstartSection: "Get paged when it goes down",
    products: ["OnCall"],
    guidedSetup: {
      copyFile: "Components/GuidedSetup/OnCall/OnCallSetup.ts",
      constant: "ON_CALL_SETUP_GUIDE_DOCS_PATH",
      pageFile: "Components/GuidedSetup/OnCall/OnCallGuidedSetup.tsx",
    },
  },
  {
    page: "guides/status-page",
    navTitle: "Publish a Status Page",
    job: "Publish a status page on your own domain",
    dashboardLabels: [
      "Publish a status page",
      "Custom Domains",
      "Set up a monitor",
      "Add Custom Domain",
      "Home",
      "Welcome to OneUptime 👋",
      "What do you want to do first?",
      "Tell my customers with a status page",
      "Continue",
      "Name it, and pick what it shows",
      "Status page name",
      "What it shows",
      "Select all",
      "Create the status page",
      "This is what your customers see",
      "Public link",
      "Looks good",
      "Make it yours (optional)",
      "Your own domain",
      "Domain",
      "DNS Setup",
      "Type",
      "Name",
      "Value",
      "Check now",
      "Your CNAME record is verified.",
      "Status",
      "Certificate issued, renews automatically.",
      "Issuing a free certificate, usually within 15 minutes.",
      "This server is not ready for custom domains yet",
      "Verified. Uses your own proxy's HTTPS.",
    ],
    referencePages: [
      "status-pages/index",
      "status-pages/resources-and-groups",
      "status-pages/branding-and-domains",
    ],
    quickstartSection: "Publish a status page",
    products: ["StatusPages"],
    guidedSetup: {
      copyFile: "Components/GuidedSetup/StatusPage/StatusPageSetup.ts",
      constant: "STATUS_PAGE_SETUP_GUIDE_DOCS_PATH",
      pageFile: "Components/GuidedSetup/StatusPage/StatusPageGuidedSetup.tsx",
    },
  },
];

export const guideUrl: (guide: DocsGuide) => string = (
  guide: DocsGuide,
): string => {
  return `/docs/${guide.page}`;
};
