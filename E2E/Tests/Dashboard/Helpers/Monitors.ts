import { BASE_URL } from "../../../Config";
import { APIResponse, Page, expect, Locator } from "@playwright/test";
import URL from "Common/Types/API/URL";
import { gotoProjectPage } from "./ProductOnboarding";

/*
 * Helpers for the monitor-creation e2e spec (CreateMonitors.spec.ts).
 *
 * The dashboard "Create Monitor" form (#create-monitor-form) is a multi-step
 * ModelForm:
 *   1. monitor-info  — name + monitorType CardSelect
 *   2. criteria      — per-monitor-type destination/config form (skipped for
 *                      Manual). A default offline/online criteria pair is
 *                      pre-populated, so only the type-specific destination /
 *                      config fields need filling.
 *   3. interval      — monitoring interval Dropdown (only for probeable types)
 *
 * The submit button keeps the test id "Create Monitor" on every step; on a
 * non-final step its visible text is "Next".
 */

export interface MonitorTypeRecipe {
  // Human label used in the test title.
  label: string;
  /*
   * The card-select-option-<value> suffix — the MonitorType enum *value*
   * (e.g. "SSL Certificate", "Docker Swarm", "IoT Device").
   */
  cardValue: string;
  // true for probeable types that show the extra interval step.
  hasInterval: boolean;
  /*
   * true for Manual + inbound documentation types that skip the criteria step
   * entirely (single submit click creates the monitor).
   */
  singleStep?: boolean;
  /*
   * Fills the criteria step's required fields. Omit for types whose defaults
   * already satisfy validation (Manual, telemetry types, ...).
   */
  fillCriteria?: (data: { page: Page }) => Promise<void>;
}

const monitorCreateFormSelector: string = "#create-monitor-form";
const monitorNameInputSelector: string =
  "#create-monitor-form input[placeholder='Monitor Name']";
const submitButtonTestId: string = "Create Monitor";

/*
 * Matches a monitor id (a uuid) in the view-monitor URL.
 *
 * It has to be the full uuid shape rather than a loose `[a-f0-9-]+`: the form
 * lives at /monitors/create, and "create" starts with "c" — a valid
 * `[a-f0-9-]` run — so a loose pattern matches /monitors/create too. That makes
 * the "we navigated to the monitor" assertion pass while still sitting on the
 * form, and (worse) makes the extracted id the literal string "c", which then
 * blows up downstream as `PUT /api/monitor/c -> Invalid ID format`. The strict
 * pattern is what forces createMonitor to actually prove a monitor was created.
 */
const uuidPattern: string =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

const monitorIdInUrlRegex: RegExp = new RegExp(
  `/monitors/(${uuidPattern})`,
  "i",
);

type MonitorViewUrlRegexFunction = (projectId: string) => RegExp;

const monitorViewUrlRegex: MonitorViewUrlRegexFunction = (
  projectId: string,
): RegExp => {
  return new RegExp(`/dashboard/${projectId}/monitors/${uuidPattern}`, "i");
};

/*
 * Clicks the final "Create Monitor" submit and waits for the wizard to land on
 * the monitor view page, retrying the click until it does or a deadline passes.
 *
 * Creation intermittently stalls on /monitors/create — the final submit can
 * fire a beat before the form is ready to accept it, so nothing happens and
 * the wizard just sits there. That flake showed up across environments (a
 * website monitor in MonitorIncidentOnCall, Manual/Port in the billing job).
 * A single click plus a passive assertion turns that into a hard failure; a
 * bounded re-click loop lets the transient heal itself. Re-clicking is safe:
 * if the first click already created the monitor we have navigated away (the
 * form is gone, so there is nothing to click and the URL check returns), and
 * if it did not, no monitor exists yet so the retry creates exactly one.
 */
const clickCreateUntilMonitorView: (data: {
  page: Page;
  projectId: string;
}) => Promise<void> = async (data: {
  page: Page;
  projectId: string;
}): Promise<void> => {
  const target: RegExp = monitorViewUrlRegex(data.projectId);
  const deadlineMs: number = Date.now() + 90000;

  while (Date.now() < deadlineMs) {
    if (target.test(data.page.url())) {
      return;
    }

    // Only click while the create form is still on screen (not mid-navigation).
    const formVisible: boolean = await data.page
      .locator(monitorCreateFormSelector)
      .isVisible()
      .catch(() => {
        return false;
      });

    if (formVisible) {
      await data.page
        .getByTestId(submitButtonTestId)
        .click({ timeout: 10000 })
        .catch(() => {
          // Button may have detached as navigation began; the URL check decides.
        });
    }

    try {
      await data.page.waitForURL(target, { timeout: 12000 });
      return;
    } catch {
      // Still on the form — loop and try the submit again.
    }
  }

  // One last assertion so a genuine failure reports with a clear message.
  await expect(data.page).toHaveURL(target, { timeout: 5000 });
};

/*
 * Selects the "Every 5 Minutes" monitoring interval on the interval step.
 * 5 minutes is available for every probeable type (the every-1/2-minute
 * options are filtered out for SSL / Synthetic / Custom-code monitors).
 */
const selectMonitoringInterval: (data: {
  page: Page;
}) => Promise<void> = async (data: { page: Page }): Promise<void> => {
  const combo: Locator = data.page.getByRole("combobox", {
    name: "Monitoring Interval",
  });
  await combo.waitFor({ state: "visible", timeout: 30000 });
  await combo.click();
  await data.page
    .getByRole("option", { name: "Every 5 Minutes", exact: true })
    .click();
};

/*
 * Waits for the criteria step to finish loading before it is submitted.
 *
 * The criteria step's MonitorSteps component fetches monitor statuses,
 * severities, incident roles and probes and only then populates the default
 * monitorSteps. Until that resolves the form value is empty and submitting
 * fails validation ("Monitor Steps is required"), leaving the wizard on the
 * criteria step so the create never happens. A fixed sleep raced this load and
 * made the whole suite flaky under CI load.
 *
 * The "Monitor Criteria" card is rendered by MonitorStep only after the
 * defaults have loaded, and for every monitor type, so its visibility is an
 * unambiguous ready signal — unlike the async loader, which briefly is absent
 * on the very first render before the fetch flips it on.
 */
const waitForCriteriaStepReady: (data: {
  page: Page;
}) => Promise<void> = async (data: { page: Page }): Promise<void> => {
  await data.page
    .getByText("Monitor Criteria", { exact: true })
    .first()
    .waitFor({ state: "visible", timeout: 60000 });
};

/*
 * Navigates to the create-monitor page and creates a monitor following the
 * recipe, then asserts we land on the monitor view page. Returns the created
 * monitor id.
 */
type CreateMonitorFunction = (data: {
  page: Page;
  projectId: string;
  monitorName: string;
  recipe: MonitorTypeRecipe;
}) => Promise<string>;

export const createMonitor: CreateMonitorFunction = async (data: {
  page: Page;
  projectId: string;
  monitorName: string;
  recipe: MonitorTypeRecipe;
}): Promise<string> => {
  const page: Page = data.page;

  const monitorCreateUrl: string = URL.fromString(BASE_URL.toString())
    .addRoute(`/dashboard/${data.projectId}/monitors/create`)
    .toString();

  await gotoProjectPage({
    page,
    projectId: data.projectId,
    url: monitorCreateUrl,
    ready: page.locator(monitorCreateFormSelector),
  });

  // Step 1: name + type.
  await page.locator(monitorNameInputSelector).fill(data.monitorName);
  const card: Locator = page.getByTestId(
    `card-select-option-${data.recipe.cardValue}`,
  );
  await expect(card).toBeVisible({ timeout: 30000 });
  await card.click();

  if (data.recipe.singleStep) {
    // The one submit both creates the monitor and navigates to it.
    await clickCreateUntilMonitorView({ page, projectId: data.projectId });
  } else {
    // Advance to the criteria step, then wait for its async defaults.
    await page.getByTestId(submitButtonTestId).click();
    await waitForCriteriaStepReady({ page });
    if (data.recipe.fillCriteria) {
      await data.recipe.fillCriteria({ page });
    }

    if (data.recipe.hasInterval) {
      // Advance to the interval step, choose an interval, then create.
      await page.getByTestId(submitButtonTestId).click();
      await selectMonitoringInterval({ page });
      await clickCreateUntilMonitorView({ page, projectId: data.projectId });
    } else {
      // No interval step: this submit creates the monitor.
      await clickCreateUntilMonitorView({ page, projectId: data.projectId });
    }
  }

  const match: RegExpMatchArray | null = page.url().match(monitorIdInUrlRegex);
  return match ? match[1]! : "";
};

/*
 * Fills the bare destination Input on the criteria step (Website / API / Ping
 * / IP / Port / SSL). It has no placeholder or test id, but it is the first
 * textbox rendered on the criteria step (inside the "Monitor Target" card).
 */
export const fillDestination: (data: {
  page: Page;
  value: string;
}) => Promise<void> = async (data: {
  page: Page;
  value: string;
}): Promise<void> => {
  const input: Locator = data.page
    .locator(monitorCreateFormSelector)
    .getByRole("textbox")
    .first();
  await input.waitFor({ state: "visible", timeout: 30000 });
  await input.fill(data.value);
};

/*
 * Fills the Monaco CodeEditor used by the Synthetic / Custom-JavaScript step
 * forms. Validation only requires the code to be non-empty, so a short comment
 * is enough. keyboard.insertText avoids Monaco's auto-close bracket handling.
 */
export const fillCodeEditor: (data: {
  page: Page;
  code: string;
}) => Promise<void> = async (data: {
  page: Page;
  code: string;
}): Promise<void> => {
  const editor: Locator = data.page
    .locator(`${monitorCreateFormSelector} .monaco-editor`)
    .first();
  await editor.waitFor({ state: "visible", timeout: 30000 });
  await editor.click();
  await data.page.keyboard.insertText(data.code);
  // Blur so Monaco flushes onChange into the monitorStep customCode.
  await data.page.keyboard.press("Tab");
};

/*
 * Fills a criteria-step input by its placeholder (used by the DNS / DNSSEC /
 * Domain / SNMP / ExternalStatusPage step forms, which expose placeholders).
 */
export const fillByPlaceholder: (data: {
  page: Page;
  placeholder: string | RegExp;
  value: string;
}) => Promise<void> = async (data: {
  page: Page;
  placeholder: string | RegExp;
  value: string;
}): Promise<void> => {
  const input: Locator = data.page.getByPlaceholder(data.placeholder).first();
  await input.waitFor({ state: "visible", timeout: 30000 });
  await input.fill(data.value);
};

/*
 * Infrastructure monitor types (Kubernetes / Docker / Host / Podman /
 * Docker Swarm / Proxmox / Ceph / IoT Device) can only be created once an
 * infrastructure entity exists — the criteria step picks it from a dropdown.
 * These entities are normal CRUD models a project owner can create directly,
 * so we seed one via the API (far more reliable than waiting for OTLP-derived
 * auto-discovery) and then drive the form: pick the entity + a Quick Setup
 * template.
 */
export interface InfraMonitorRecipe {
  // Human label used in the test title.
  label: string;
  // card-select-option-<value> suffix (MonitorType enum value).
  cardValue: string;
  // CRUD API path for the entity, e.g. "/api/ceph-cluster".
  apiPath: string;
  /*
   * Identifier column the model requires in addition to name
   * (clusterIdentifier for Kubernetes, hostIdentifier for Docker/Host/Podman).
   * Omitted for the name-keyed clusters (Docker Swarm / Proxmox / Ceph / IoT).
   */
  identifierField?: string;
  // A Quick Setup template name to select (matched as a substring).
  templateName: string | RegExp;
}

/*
 * Seeds one infrastructure entity via the CRUD API using the authenticated
 * browser session (page.request shares the login cookies). Returns the entity
 * name, which is also the dropdown label on the monitor form.
 */
type SeedInfraEntityFunction = (data: {
  page: Page;
  projectId: string;
  recipe: InfraMonitorRecipe;
}) => Promise<string>;

export const seedInfraEntity: SeedInfraEntityFunction = async (data: {
  page: Page;
  projectId: string;
  recipe: InfraMonitorRecipe;
}): Promise<string> => {
  const entityName: string = `e2e-${data.recipe.cardValue
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")}-${Math.floor(Math.random() * 1e9).toString(
    36,
  )}`;

  const apiUrl: string = URL.fromString(BASE_URL.toString())
    .addRoute(data.recipe.apiPath)
    .toString();

  const entityData: { [key: string]: string } = {
    name: entityName,
    projectId: data.projectId,
  };
  if (data.recipe.identifierField) {
    entityData[data.recipe.identifierField] = entityName;
  }

  const response: APIResponse = await data.page.request.post(apiUrl, {
    headers: {
      "content-type": "application/json",
      tenantid: data.projectId,
    },
    data: { data: entityData },
  });
  expect(
    response.ok(),
    `Seed ${data.recipe.label} entity failed: ${response.status()} ${await response.text()}`,
  ).toBe(true);

  return entityName;
};

/*
 * Seeds an infra entity, then creates an infrastructure monitor for it by
 * picking the entity from the dropdown and selecting a Quick Setup template.
 * Asserts navigation to the monitor view page and returns the monitor id.
 */
type CreateInfraMonitorFunction = (data: {
  page: Page;
  projectId: string;
  monitorName: string;
  recipe: InfraMonitorRecipe;
}) => Promise<string>;

export const createInfraMonitor: CreateInfraMonitorFunction = async (data: {
  page: Page;
  projectId: string;
  monitorName: string;
  recipe: InfraMonitorRecipe;
}): Promise<string> => {
  const page: Page = data.page;

  const entityName: string = await seedInfraEntity({
    page,
    projectId: data.projectId,
    recipe: data.recipe,
  });

  const monitorCreateUrl: string = URL.fromString(BASE_URL.toString())
    .addRoute(`/dashboard/${data.projectId}/monitors/create`)
    .toString();
  await gotoProjectPage({
    page,
    projectId: data.projectId,
    url: monitorCreateUrl,
    ready: page.locator(monitorCreateFormSelector),
  });

  // Step 1: name + type.
  await page.locator(monitorNameInputSelector).fill(data.monitorName);
  const card: Locator = page.getByTestId(
    `card-select-option-${data.recipe.cardValue}`,
  );
  await expect(card).toBeVisible({ timeout: 30000 });
  await card.click();
  await page.getByTestId(submitButtonTestId).click();

  // Criteria step: pick the seeded entity from the first dropdown.
  await page.waitForTimeout(1500);
  const entityDropdown: Locator = page
    .locator(monitorCreateFormSelector)
    .getByRole("combobox")
    .first();
  await entityDropdown.waitFor({ state: "visible", timeout: 30000 });
  await entityDropdown.click();
  await page
    .getByRole("option", { name: entityName, exact: true })
    .first()
    .click();
  await page.waitForTimeout(1000);

  // Pick a Quick Setup template so the monitor step is fully configured.
  await page
    .getByRole("button", { name: data.recipe.templateName })
    .first()
    .click();
  await page.waitForTimeout(1500);

  // This submit creates the infra monitor; retry it until it navigates.
  await clickCreateUntilMonitorView({ page, projectId: data.projectId });

  const match: RegExpMatchArray | null = page.url().match(monitorIdInUrlRegex);
  return match ? match[1]! : "";
};
