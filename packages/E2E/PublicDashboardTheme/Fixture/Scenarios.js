/*
 * The fixture's public dashboards, by id: which theme each one has, whether
 * its link asks for a password, and whether it answers at all. Read by the
 * server (the theme each page's HTML is sent in) and by MockApi.js in the
 * page (what the dashboard API answers), so the two always agree - and the
 * id is in every address the app goes to, the password prompt and back.
 *
 * Plain values only: the server builds this alone, for Node.
 */

export const id = (value) => {
  return `da000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
};

export const PASSWORD = "open sesame";

export const DASHBOARDS = {
  // One per theme, shared with anyone who has the link.
  light: { id: id(1), theme: "Light" },
  dark: { id: id(2), theme: "Dark" },
  system: { id: id(3), theme: "System" },
  // A dashboard made before the setting: no theme, the light page.
  unset: { id: id(4), theme: undefined },
  // Shared with a password.
  lightPassword: { id: id(11), theme: "Light", hasPassword: true },
  darkPassword: { id: id(12), theme: "Dark", hasPassword: true },
  systemPassword: { id: id(13), theme: "System", hasPassword: true },
  // Its IP allowlist refuses the visitor: Access Denied.
  forbidden: { id: id(21), theme: "Dark", isForbidden: true },
  // Its link answers nobody: shared only with its project, or none at all.
  missing: { id: id(31), theme: "Dark", answers: false },
};

export const TITLE = "Acme Production";

export const getScenario = (dashboardId) => {
  for (const key of Object.keys(DASHBOARDS)) {
    const scenario = DASHBOARDS[key];

    if (scenario.id === dashboardId) {
      return {
        key,
        title: TITLE,
        answers: scenario.answers !== false,
        theme: scenario.theme,
        hasPassword: Boolean(scenario.hasPassword),
        isForbidden: Boolean(scenario.isForbidden),
      };
    }
  }

  return null;
};
