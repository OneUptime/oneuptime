/*
 * The fixture's status pages and public dashboards, by id. Read by the
 * server (each page's title) and by the in-page API mocks (what each page's
 * API answers), so the two always agree.
 *
 * Every page has a name, a resource and a look of its own, so a tab that
 * draws another page's content is told apart at a glance.
 *
 * Plain values only: the server builds this alone, for Node.
 */

export const statusPageId = (value) => {
  return `5ba90000-0000-4000-8000-${String(value).padStart(12, "0")}`;
};

export const dashboardId = (value) => {
  return `da5b0000-0000-4000-8000-${String(value).padStart(12, "0")}`;
};

// The password of every page and dashboard here that asks for one.
export const PASSWORD = "open sesame";

export const STATUS_PAGES = {
  // A public page whose services are all up.
  acme: {
    id: statusPageId(1),
    title: "Acme Cloud Status",
    resource: "Acme API",
    color: "#4f46e5",
    isOperational: true,
  },
  // A public page in the middle of an outage.
  globex: {
    id: statusPageId(2),
    title: "Globex Payments Status",
    resource: "Globex Checkout",
    color: "#dc2626",
    isOperational: false,
  },
  // A private page whose visitors enter a password first.
  initech: {
    id: statusPageId(3),
    title: "Initech Intranet Status",
    resource: "Initech VPN",
    color: "#059669",
    isOperational: true,
    isPrivate: true,
    hasMasterPassword: true,
  },
};

export const DASHBOARDS = {
  // Shared with anyone who has the link.
  north: {
    id: dashboardId(1),
    title: "North Region Board",
    text: "Everything in the **north** region.",
  },
  // Shared with a password.
  south: {
    id: dashboardId(2),
    title: "South Region Board",
    text: "Everything in the **south** region.",
    hasPassword: true,
  },
  // Shared with a password too.
  west: {
    id: dashboardId(3),
    title: "West Region Board",
    text: "Everything in the **west** region.",
    hasPassword: true,
  },
};

const find = (pages, id) => {
  for (const key of Object.keys(pages)) {
    if (pages[key].id === (id || "").toLowerCase()) {
      return { key, ...pages[key] };
    }
  }

  return null;
};

export const getStatusPage = (id) => {
  return find(STATUS_PAGES, id);
};

export const getDashboard = (id) => {
  return find(DASHBOARDS, id);
};

// A page's name without the word "Status": "Acme Cloud".
export const shortName = (page) => {
  return page.title.replace(" Status", "");
};

/*
 * A status page's logo: its name on its colour, so a screenshot says which
 * page a tab is drawing. The header draws it from the master page's bytes,
 * the sign-in pages from the API's /logo route, which the server answers.
 */
export const logoSvg = (page) => {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="50" viewBox="0 0 240 50">' +
    `<rect width="240" height="50" rx="8" fill="${page.color}"/>` +
    '<text x="120" y="32" font-family="sans-serif" font-size="20" fill="#fff" text-anchor="middle">' +
    `${shortName(page)}</text></svg>`
  );
};
