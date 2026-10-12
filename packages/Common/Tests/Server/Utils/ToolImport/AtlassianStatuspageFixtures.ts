import { FixtureApi, json } from "./ToolImportFixtureTransport";

/*
 * An Atlassian Statuspage organization in REST API v1's documented shapes
 * (https://developer.statuspage.io/): two pages - a public one with a
 * component group, components in each state, email subscribers and some by
 * other means, and a private one - as GET /pages and the lists under each
 * page answer them.
 */

export const STATUSPAGE_KEY: string = "statuspage_key_0123456789";

export const PUBLIC_PAGE_ID: string = "pg1acme";
export const INTERNAL_PAGE_ID: string = "pg2internal";

export const WEBSITE_GROUP_ID: string = "grp1website";
export const WEB_APP_ID: string = "cmp1webapp";
export const API_ID: string = "cmp2api";
export const EMAIL_ID: string = "cmp3email";
export const DATABASE_ID: string = "cmp9database";

export const STATUSPAGE_PAGES: Array<Record<string, unknown>> = [
  {
    id: PUBLIC_PAGE_ID,
    name: "Acme",
    headline: "Acme systems",
    page_description: "Live status of Acme",
    subdomain: "acme",
    domain: "status.acme.com",
    url: "https://acme.example",
    viewers_must_be_team_members: false,
    ip_restrictions: null,
    allow_page_subscribers: true,
    allow_email_subscribers: true,
    hidden_from_search: false,
    favicon_logo: { url: "https://cdn.example.com/favicon.png" },
    transactional_logo: { url: "" },
    hero_cover: null,
  },
  {
    id: INTERNAL_PAGE_ID,
    name: "Internal",
    subdomain: "acme-internal",
    viewers_must_be_team_members: true,
    allow_page_subscribers: true,
    allow_email_subscribers: false,
    hidden_from_search: true,
    favicon_logo: null,
    transactional_logo: null,
    hero_cover: null,
  },
  // No id: skipped.
  { name: "Ghost" },
];

export const PUBLIC_PAGE_COMPONENTS: Array<Record<string, unknown>> = [
  // A group is listed among the components too.
  {
    id: WEBSITE_GROUP_ID,
    name: "Website",
    group: true,
    position: 1,
    status: "operational",
  },
  {
    id: WEB_APP_ID,
    name: "Web app",
    description: "The app",
    status: "operational",
    position: 2,
    group_id: WEBSITE_GROUP_ID,
    showcase: true,
    group: false,
  },
  {
    id: API_ID,
    name: "API",
    status: "degraded_performance",
    position: 3,
    group_id: WEBSITE_GROUP_ID,
    showcase: false,
    group: false,
  },
  {
    id: EMAIL_ID,
    name: "Email delivery",
    status: "operational",
    position: 0,
    group_id: null,
    showcase: true,
    group: false,
  },
  // No id: skipped.
  { name: "No id", position: 9 },
];

export const PUBLIC_PAGE_GROUPS: Array<Record<string, unknown>> = [
  {
    id: WEBSITE_GROUP_ID,
    name: "Website",
    description: "Public website",
    position: 1,
    components: [WEB_APP_ID, API_ID],
  },
];

export const PUBLIC_PAGE_SUBSCRIBERS: Array<Record<string, unknown>> = [
  { id: "sub1", mode: "email", email: "Ann@Example.com", components: [] },
  {
    id: "sub2",
    mode: "email",
    email: "bob@example.com",
    components: [WEB_APP_ID],
  },
  // A component written as an object is read by its id.
  {
    id: "sub3",
    mode: "email",
    email: "carol@example.com",
    components: [{ id: API_ID }],
  },
  // Not an address, and no id: skipped.
  { id: "sub4", mode: "email", email: "not-an-address" },
  { mode: "email", email: "noid@example.com" },
];

export const INTERNAL_PAGE_COMPONENTS: Array<Record<string, unknown>> = [
  {
    id: DATABASE_ID,
    name: "Database",
    status: "major_outage",
    position: 0,
    showcase: true,
    group: false,
  },
];

export function statuspageApi(): FixtureApi {
  const publicPage: string = `/v1/pages/${PUBLIC_PAGE_ID}`;
  const internalPage: string = `/v1/pages/${INTERNAL_PAGE_ID}`;

  return new FixtureApi([
    { path: "/v1/pages", answers: [json(STATUSPAGE_PAGES)] },
    {
      path: `${publicPage}/components`,
      answers: [json(PUBLIC_PAGE_COMPONENTS)],
    },
    {
      path: `${publicPage}/component-groups`,
      answers: [json(PUBLIC_PAGE_GROUPS)],
    },
    {
      path: `${publicPage}/subscribers`,
      answers: [json(PUBLIC_PAGE_SUBSCRIBERS)],
    },
    {
      path: `${publicPage}/subscribers/count`,
      answers: [
        json({
          email: 3,
          sms: 2,
          webhook: 1,
          slack: 0,
          teams: 0,
          integration_partner: 0,
        }),
      ],
    },
    {
      path: `${internalPage}/components`,
      answers: [json(INTERNAL_PAGE_COMPONENTS)],
    },
    {
      path: `${internalPage}/component-groups`,
      answers: [json(statuspageError("Not found"), 404)],
    },
    { path: `${internalPage}/subscribers`, answers: [json([])] },
    {
      path: `${internalPage}/subscribers/count`,
      answers: [json({ email: 0 })],
    },
  ]);
}

// `count` email subscribers of the public page, numbered from `from`.
export function statuspageSubscribers(
  count: number,
  from: number,
): Array<Record<string, unknown>> {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    return {
      id: `sub-${from + index}`,
      mode: "email",
      email: `person${from + index}@example.com`,
      components: [],
    };
  });
}

export function statuspageError(message: string): unknown {
  return { error: message };
}
