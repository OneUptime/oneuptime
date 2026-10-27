import { expect, Locator, Page, test } from "@playwright/test";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";

/*
 * Runbook variables, and SSH and kubectl steps that take a script, in a
 * browser, against the offline fixture (RunbookVariables/Fixture).
 *
 * The maintainer: "Can we have Runbook Variables instead, just like we have
 * workflow variables? Both global variables and local variables. Looks like
 * we already have secrets, can you please merge them into variables as
 * well. ... Kubectl steps should take in a script like kubectl commands and
 * not have dropdown options ... Please do the same for SSH as well, it
 * should take a bash script (after ssh into a machine). We need to make the
 * this as easy and simple for people to understand and hide advanced
 * options."
 *
 * So, driven the way a person does: the Global Variables page and a
 * runbook's own Variables page (each name with its description and a button
 * that copies what a step writes to use it, a secret's value never shown,
 * a secret made in two steps, Replace Value, a list that fits a laptop's
 * card);
 * the SSH step (the machine as user@host, the secret it signs in with, the
 * bash script, its port and passphrase folded under More fields) and the
 * kubectl step (the kubeconfig, or the Runner's own access, and the
 * script); steps written with a runbook credential, which no longer run,
 * turned into script steps; then a phone, dark mode and German. (AI Access,
 * the runbook credentials OneUptime AI's commands used, is gone.) The
 * fixture records every
 * save and create, so the tests check what was sent as well as what was
 * drawn.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-0000000000a1";
const RUNBOOK_ID: string = "20000000-0000-4000-8000-0000000000b1";
const BASTION_ID: string = "40000000-0000-4000-8000-0000000000d1";

const VARIABLES_PAGE: string = `/dashboard/${PROJECT_ID}/runbooks/settings/variables`;
const RUNBOOK_VARIABLES_PAGE: string = `/dashboard/${PROJECT_ID}/runbooks/${RUNBOOK_ID}/variables`;
const STEPS_PAGE: string = `/dashboard/${PROJECT_ID}/runbooks/${RUNBOOK_ID}/steps`;

const SSH_STEP: string = "Restart the database proxy";
const KUBECTL_STEP: string = "Restart checkout";

const SECRET_VALUE_PLACEHOLDER: string =
  "A password, a token, a private key or a kubeconfig";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/runbook-variables-ui",
);

// The Dashboard's German words, as the fixture draws them with ?lang=de.
const GERMAN: Record<string, string> = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      "../../App/FeatureSet/Dashboard/src/Locales/de.json",
    ),
    "utf8",
  ),
) as Record<string, string>;

interface Recorded {
  updates: Array<{ model: string; id: string; data: Record<string, unknown> }>;
  creates: Array<{ model: string; data: Record<string, unknown> }>;
}

interface SavedStep {
  id: string;
  type: string;
  config: Record<string, unknown>;
}

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(String(error));
  });
});

test.afterEach(({ page }: { page: Page }) => {
  // A page that threw while drawing is a bug even when the test passed.
  expect(pageErrors.get(page) || []).toEqual([]);
});

async function screenshot(page: Page, name: string): Promise<void> {
  await fsPromises.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: true,
    animations: "disabled",
  });
}

async function recorded(page: Page): Promise<Recorded> {
  return await page.evaluate((): Recorded => {
    return (window as unknown as { __fixture: Recorded }).__fixture;
  });
}

function row(page: Page, text: string): Locator {
  return page.getByRole("row").filter({ hasText: text });
}

async function openVariables(page: Page, search: string = ""): Promise<void> {
  await page.goto(
    `${VARIABLES_PAGE}?page=variables${search ? `&${search}` : ""}`,
  );
  await expect(page.getByTestId("card-details-heading").first()).toBeVisible();
}

async function openCreate(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Create Variable" }).first().click();
  const modal: Locator = page.getByTestId("modal");
  await expect(modal).toBeVisible();
  return modal;
}

function header(page: Page, title: string): Locator {
  return page.getByTestId("runbook-step-header").filter({ hasText: title });
}

// The Steps page, with the steps named opened.
async function openSteps(
  page: Page,
  titles: Array<string>,
  search: string = "",
): Promise<void> {
  await page.goto(`${STEPS_PAGE}?page=steps${search ? `&${search}` : ""}`);
  for (const title of titles) {
    await expect(header(page, title)).toBeVisible();
    const toggle: Locator = header(page, title).getByRole("button", {
      expanded: false,
    });
    if ((await toggle.count()) > 0) {
      await toggle.first().click();
    }
  }
}

async function openMoreFields(page: Page, stepIndex: number): Promise<void> {
  await page
    .getByTestId(`runbook-step-${stepIndex}-more-fields`)
    .getByRole("button", { expanded: false })
    .first()
    .click();
}

async function openSecretPicker(
  page: Page,
  testId: string,
  how: "mouse" | "keyboard" = "mouse",
): Promise<Locator> {
  const combobox: Locator = page.getByTestId(testId).getByRole("combobox");

  if (how === "keyboard") {
    await combobox.focus();
    await page.keyboard.press("ArrowDown");
  } else {
    await combobox.click();
  }

  const options: Locator = page.getByRole("option");
  await expect(options.first()).toBeVisible();
  return options;
}

async function saveSteps(page: Page): Promise<Array<SavedStep>> {
  const before: number = (await recorded(page)).updates.length;
  await page.getByRole("button", { name: "Save Steps" }).click();
  await expect
    .poll(async (): Promise<number> => {
      return (await recorded(page)).updates.length;
    })
    .toBe(before + 1);
  const saved: Locator = page.getByTestId("modal");
  await expect(saved).toContainText("Runbook steps saved successfully.");
  await saved.getByRole("button", { name: "Got it" }).click();
  const updates: Recorded["updates"] = (await recorded(page)).updates;
  const last: Recorded["updates"][number] = updates[updates.length - 1]!;
  expect({ model: last.model, id: last.id }).toEqual({
    model: "Runbook",
    id: RUNBOOK_ID,
  });
  return last.data["steps"] as Array<SavedStep>;
}

function noHorizontalScroll(page: Page): Promise<number> {
  return page.evaluate((): number => {
    return document.documentElement.scrollWidth - window.innerWidth;
  });
}

// How far the table's rows run past its card (0 when every column fits).
function tableOverflow(page: Page): Promise<number> {
  return page.getByTestId("table-scroll").evaluate((box: Element): number => {
    return box.scrollWidth - box.clientWidth;
  });
}

test.describe("Runbooks → Settings → Global Variables", () => {
  test("each variable shows its name and description, a plain value as it is and a secret only as one; the card says once how a step names it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openVariables(page);

    await expect(row(page, "DB_HOST")).toContainText(
      "The primary database host.",
    );
    await expect(row(page, "DB_HOST")).toContainText("10.0.4.21");
    await expect(row(page, "DB_HOST")).toContainText("Every Runner");

    const key: Locator = row(page, "PROD_DB_SSH_KEY");
    await expect(key).toContainText(
      "Private key of the deploy user on the database hosts.",
    );
    await expect(key).toContainText("Secret");
    await expect(key).toContainText("prod-bastion");

    // The syntax is said once, in the card's description, not on every row.
    await expect(page.getByTestId("card-description").first()).toContainText(
      "Write one in a step as {{global.variables.NAME}}.",
    );
    await expect(key).not.toContainText("{{global.variables.PROD_DB_SSH_KEY}}");
    await expect(
      page.getByRole("columnheader", { name: /Description/ }),
    ).toHaveCount(0);

    await expect(row(page, "STATUSPAGE_TOKEN")).toContainText("Global Runners");

    // A runbook's own variable is on its page, not here.
    await expect(row(page, "NAMESPACE")).toHaveCount(0);
    await screenshot(page, "global-variables");
  });

  test("the copy button copies what a step writes", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openVariables(page);

    // Named after what it copies, in its tooltip and for a screen reader.
    await row(page, "DB_HOST")
      .getByRole("button", { name: "Copy {{global.variables.DB_HOST}}" })
      .click();

    expect(
      await page.evaluate((): Promise<string> => {
        return navigator.clipboard.readText();
      }),
    ).toBe("{{global.variables.DB_HOST}}");
  });

  test("the list fits a laptop's card beside the side menu: no column runs under the row's buttons", async ({
    page,
  }: {
    page: Page;
  }) => {
    /*
     * A 1280px laptop leaves the card about 940px beside the side menu; the
     * fixture has no side menu, so a 1000px window gives its card the same.
     */
    await page.setViewportSize({ width: 1000, height: 900 });
    await openVariables(page);
    await expect(row(page, "STATUSPAGE_TOKEN")).toBeVisible();

    expect(await tableOverflow(page)).toBeLessThanOrEqual(1);
    await expect(
      page.getByRole("columnheader", { name: /Runners/ }),
    ).toBeInViewport();
    await screenshot(page, "global-variables-laptop");
  });

  test("a secret is made in two steps - what it is, then who may use it - and its value is sent once, as Secret Value", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openVariables(page);
    const modal: Locator = await openCreate(page);

    await expect(modal.getByRole("switch", { name: "Secret" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await modal.getByPlaceholder("PROD_DB_SSH_KEY").fill("WEBHOOK_TOKEN");
    await modal
      .getByPlaceholder(SECRET_VALUE_PLACEHOLDER)
      .fill("a-token-for-the-webhook");
    await screenshot(page, "create-secret");

    await modal.getByTestId("modal-footer-next-button").click();

    const globalSwitch: Locator = modal.getByRole("switch", {
      name: /Global Runners can use it/,
    });
    await expect(globalSwitch).toHaveAttribute("aria-checked", "true");
    await expect(modal).toContainText("Your Runners that can use it");
    await screenshot(page, "create-secret-access");

    await modal.getByTestId("modal-footer-submit-button").click();
    await expect
      .poll(async (): Promise<number> => {
        return (await recorded(page)).creates.length;
      })
      .toBe(1);

    const created: Recorded["creates"][number] = (await recorded(page))
      .creates[0]!;
    expect(created.model).toBe("RunbookVariable");
    expect(created.data["name"]).toBe("WEBHOOK_TOKEN");
    expect(created.data["isSecret"]).toBe(true);
    expect(created.data["secretValue"]).toBe("a-token-for-the-webhook");
    expect(created.data["value"]).toBeUndefined();
    expect(created.data["isAvailableToGlobalRunners"]).toBe(true);
    expect(created.data["runbookId"]).toBeUndefined();
  });

  test("a plain variable is one step, with a readable Value, and asks nobody", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openVariables(page);
    const modal: Locator = await openCreate(page);

    await modal.getByPlaceholder("PROD_DB_SSH_KEY").fill("DB_REPLICA_HOST");
    await modal.getByRole("switch", { name: "Secret" }).click();
    await modal.getByPlaceholder("10.0.4.21").fill("10.0.4.22");

    await expect(modal.getByTestId("modal-footer-next-button")).toHaveCount(0);
    await modal.getByTestId("modal-footer-submit-button").click();

    await expect
      .poll(async (): Promise<number> => {
        return (await recorded(page)).creates.length;
      })
      .toBe(1);
    const created: Recorded["creates"][number] = (await recorded(page))
      .creates[0]!;
    expect(created.data["isSecret"]).toBe(false);
    expect(created.data["value"]).toBe("10.0.4.22");
    expect(created.data["secretValue"]).toBeUndefined();
  });

  test("a name a step could not write is refused on the form", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openVariables(page);
    const modal: Locator = await openCreate(page);

    await modal.getByPlaceholder("PROD_DB_SSH_KEY").fill("prod key");
    await modal
      .getByPlaceholder(SECRET_VALUE_PLACEHOLDER)
      .fill("a-token-for-the-webhook");
    await modal.getByTestId("modal-footer-next-button").click();

    await expect(modal).toContainText("Name should not have spaces.");
    expect((await recorded(page)).creates).toEqual([]);
  });

  test("Replace Value: a secret's value is replaced, never shown; a plain one has no such button", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openVariables(page);

    await expect(
      row(page, "DB_HOST").getByRole("button", { name: "Replace Value" }),
    ).toHaveCount(0);

    await row(page, "PROD_DB_SSH_KEY")
      .getByRole("button", { name: "Replace Value" })
      .click();
    const modal: Locator = page.getByTestId("modal");
    // It names the variable it replaces.
    await expect(modal.getByTestId("modal-title")).toHaveText(
      "Replace the value of PROD_DB_SSH_KEY",
    );
    await expect(modal).toContainText(
      "The new value is encrypted, and the old one is gone for good.",
    );
    await expect(modal).toContainText("New Value");
    await modal
      .getByPlaceholder(SECRET_VALUE_PLACEHOLDER)
      .fill("-----BEGIN OPENSSH PRIVATE KEY-----\nnew\n");
    await screenshot(page, "replace-value");
    await modal.getByRole("button", { name: "Replace Value" }).click();

    await expect
      .poll(async (): Promise<number> => {
        return (await recorded(page)).updates.length;
      })
      .toBe(1);
    expect((await recorded(page)).updates[0]).toEqual({
      model: "RunbookVariable",
      id: "80000000-0000-4000-8000-000000000b02",
      data: { secretValue: "-----BEGIN OPENSSH PRIVATE KEY-----\nnew\n" },
    });
  });

  test("a Runbook Admin reads the variables, to name them in steps, and changes none", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openVariables(page, "role=runbook-admin");

    await expect(row(page, "DB_HOST")).toBeVisible();
    // Locked, saying why, rather than missing: every row reads the same.
    await expect(
      page.getByRole("button", { name: "Create Variable" }).first(),
    ).toBeDisabled();
    await expect(
      row(page, "PROD_DB_SSH_KEY").getByRole("button", {
        name: "Replace Value",
      }),
    ).toBeDisabled();
    await screenshot(page, "runbook-admin-global-variables");
  });

  test("with none yet, the page says what to add", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openVariables(page, "variables=none");

    const card: Locator = page.getByTestId("card");
    await expect(card).toContainText("No global variables yet");
    await expect(card).toContainText(
      "Add the hosts, keys, passwords and kubeconfigs your steps use.",
    );
    await screenshot(page, "global-variables-empty");
  });
});

test.describe("a runbook's own Variables", () => {
  test("lists the runbook's own, as a step names them, and makes new ones the runbook's", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${RUNBOOK_VARIABLES_PAGE}?page=runbook-variables`);

    await expect(row(page, "NAMESPACE")).toContainText(
      "Where the checkout service runs.",
    );
    await expect(
      row(page, "NAMESPACE").getByRole("button", {
        name: "Copy {{local.variables.NAMESPACE}}",
      }),
    ).toBeVisible();
    await expect(row(page, "DB_HOST")).toHaveCount(0);
    await expect(page.getByTestId("card").first()).toContainText(
      "Values only this runbook's steps can use, beside the project's global variables. Write one in a step as {{local.variables.NAME}}.",
    );
    await screenshot(page, "runbook-variables");

    const modal: Locator = await openCreate(page);
    await modal.getByPlaceholder("PROD_DB_SSH_KEY").fill("REPLICAS");
    await modal.getByRole("switch", { name: "Secret" }).click();
    await modal.getByPlaceholder("10.0.4.21").fill("3");
    await modal.getByTestId("modal-footer-submit-button").click();

    await expect
      .poll(async (): Promise<number> => {
        return (await recorded(page)).creates.length;
      })
      .toBe(1);
    expect(
      JSON.stringify((await recorded(page)).creates[0]!.data["runbookId"]),
    ).toContain(RUNBOOK_ID);
  });
});

test.describe("an SSH step", () => {
  test("its folded line says the machine and the Runner it signs in from", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSteps(page, []);

    await expect(header(page, SSH_STEP)).toContainText(
      "SSH to deploy@{{global.variables.DB_HOST}} from prod-bastion",
    );
    await expect(header(page, KUBECTL_STEP)).toContainText(
      "kubectl rollout restart deployment/checkout-api",
    );
    await screenshot(page, "steps-folded");
  });

  test("asks for the machine, the secret it signs in with and a bash script; port and passphrase are folded", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSteps(page, [SSH_STEP]);

    await expect(
      page.getByTestId("runbook-step-0-ssh-target-input"),
    ).toHaveValue("deploy@{{global.variables.DB_HOST}}");
    await expect(page.getByTestId("runbook-step-0-ssh-sign-in")).toContainText(
      "PROD_DB_SSH_KEY",
    );
    await expect(
      page.getByRole("textbox", { name: /^Bash script/ }),
    ).toHaveValue(
      "sudo systemctl restart pgbouncer\nsystemctl status pgbouncer --no-pager",
    );
    await expect(
      page.getByRole("button", { name: /Check the machine/ }),
    ).toBeVisible();
    // The examples and the variables are one panel under the script.
    const variables: Locator = page.getByTestId(
      "runbook-step-0-ssh-script-variables",
    );
    await expect(variables).toContainText("Variables — click to copy");
    await expect(variables.locator("..")).toContainText(
      "Examples — click to insert",
    );

    // No credential picker, no command field.
    await expect(page.getByText("Credential", { exact: true })).toHaveCount(0);

    const port: Locator = page.locator("#runbook-step-0-ssh-port");
    await expect(port).toBeHidden();
    await screenshot(page, "ssh-step");

    await openMoreFields(page, 0);
    await expect(port).toBeVisible();
    await expect(
      page.getByTestId("runbook-step-0-ssh-passphrase"),
    ).toContainText("No passphrase");
    await screenshot(page, "ssh-step-more-fields");
  });

  test("signs in with secret variables only, picked by keyboard or mouse", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSteps(page, [SSH_STEP]);

    const options: Locator = await openSecretPicker(
      page,
      "runbook-step-0-ssh-sign-in",
      "keyboard",
    );
    await expect(options).toHaveText([
      "PROD_DB_SSH_KEY",
      "PROD_KUBECONFIG",
      "STATUSPAGE_TOKEN",
    ]);
    await page.keyboard.press("Escape");

    // A secret only global Runners may use: the step's Runner may not.
    await (await openSecretPicker(page, "runbook-step-0-ssh-sign-in"))
      .filter({ hasText: "STATUSPAGE_TOKEN" })
      .click();

    const picker: Locator = page.getByTestId("runbook-step-0-ssh-sign-in");
    await expect(picker).toContainText(
      "The Runner picked above may not use STATUSPAGE_TOKEN, so the step will fail when it runs. Add the Runner to the variable's Runners under Runbooks › Settings › Global Variables.",
    );
    const link: Locator = picker.getByRole("link", {
      name: "Runbooks › Settings › Global Variables",
    });
    await expect(link).toHaveAttribute("href", VARIABLES_PAGE);
    await expect(link).toHaveAttribute("target", "_blank");
    await screenshot(page, "ssh-sign-in-not-for-runner");
  });

  test("Save Steps sends the machine and the references, never a value", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSteps(page, [SSH_STEP]);

    await page
      .getByTestId("runbook-step-0-ssh-target-input")
      .fill("admin@10.0.4.99");

    const steps: Array<SavedStep> = await saveSteps(page);

    expect(steps[0]!.config).toMatchObject({
      host: "10.0.4.99",
      username: "admin",
      signIn: "{{global.variables.PROD_DB_SSH_KEY}}",
      agentId: BASTION_ID,
    });
    expect(JSON.stringify(steps)).not.toContain("BEGIN");
  });

  test("a host without a user asks for the user", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSteps(page, [SSH_STEP]);

    await page.getByTestId("runbook-step-0-ssh-target-input").fill("10.0.4.99");

    await expect(page.getByTestId("runbook-step-0-ssh-target-help")).toHaveText(
      "Add the user to sign in as, before an @: deploy@10.0.4.21.",
    );
  });

  /*
   * The machine's host key, under More fields after the key passphrase:
   * pasted as ssh-keyscan prints it, it is saved as written and the fold
   * names it; a line that is not a key says the step will fail.
   */
  test("its host key is under More fields: pasted as ssh-keyscan prints it, saved as written; a line that is not one says the step will fail", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSteps(page, [SSH_STEP]);
    await openMoreFields(page, 0);

    const box: Locator = page.getByTestId("runbook-step-0-ssh-host-key");
    await expect(box).toBeVisible();
    await expect(
      page.locator('label[for="runbook-step-0-ssh-host-key"]'),
    ).toHaveText("Host key");
    await expect(page.locator("#runbook-step-0-ssh-host-key-help")).toHaveText(
      "The machine's host key, checked before the step signs in: its SHA256 fingerprint, or its public key as ssh-keyscan prints it, one a line. Left empty, any key is accepted, and the step's output names the one the machine presented.",
    );

    // After the key passphrase, before the description.
    const passphraseBox: { y: number } | null = await page
      .getByTestId("runbook-step-0-ssh-passphrase")
      .boundingBox();
    const hostKeyBox: { y: number } | null = await box.boundingBox();
    expect(hostKeyBox!.y).toBeGreaterThan(passphraseBox!.y);

    const keyscan: string =
      "10.0.4.21 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFtux8m1u+wimvaBoFQoXsFnlH+H+VfhMAHNjDNrl2Q0";

    await box.fill("the usual one");
    await expect(box).toHaveAttribute("aria-invalid", "true");
    await expect(
      page.getByTestId("runbook-step-0-ssh-host-key-field").getByRole("alert"),
    ).toHaveText(
      "A line here is neither a SHA256 fingerprint nor a public key, so the step will fail when it runs.",
    );
    await screenshot(page, "ssh-host-key-not-a-key");

    await box.fill(keyscan);
    await expect(box).not.toHaveAttribute("aria-invalid", "true");
    await screenshot(page, "ssh-host-key");

    const steps: Array<SavedStep> = await saveSteps(page);

    expect(steps[0]!.config).toMatchObject({ hostKey: keyscan });
  });
});

test.describe("a kubectl step", () => {
  test("takes a kubeconfig - or the Runner's own access - and a script of kubectl commands", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSteps(page, [KUBECTL_STEP]);

    await expect(page.getByTestId("runbook-step-1-kubeconfig")).toContainText(
      "PROD_KUBECONFIG",
    );
    await expect(page.getByRole("textbox", { name: /^Script/ })).toHaveValue(
      /^kubectl rollout restart deployment\/checkout-api --namespace \{\{local\.variables\.NAMESPACE\}\}/,
    );
    for (const example of [
      "List pods",
      "Restart a deployment",
      "Scale a deployment",
      "Pods that are not running",
      "Roll back",
    ]) {
      await expect(
        page.getByRole("button", { name: new RegExp(example) }),
      ).toBeVisible();
    }
    // No action, workload or replica dropdowns.
    await expect(page.getByText("Workload kind")).toHaveCount(0);
    await screenshot(page, "kubectl-step");

    const options: Locator = await openSecretPicker(
      page,
      "runbook-step-1-kubeconfig",
    );
    await expect(options.first()).toHaveText("The Runner's own access");
    await options.first().click();

    await expect(page.getByTestId("runbook-step-1-kubeconfig")).toContainText(
      "kubectl uses the Runner's own kubeconfig, or its service account when the Runner runs in the cluster.",
    );

    const steps: Array<SavedStep> = await saveSteps(page);
    expect(steps[1]!.config["kubeconfig"]).toBe("");
    expect(steps[1]!.config["script"]).toContain("kubectl rollout restart");
  });

  test("a script naming a variable that is not there says so before it runs", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSteps(page, [KUBECTL_STEP]);

    await page
      .getByRole("textbox", { name: /^Script/ })
      .fill("kubectl get pods --namespace {{local.variables.NOPE}}");

    await expect(
      page.getByTestId("runbook-step-1-kubectl-script-unknown-variables"),
    ).toHaveText(
      "No variable is named {{local.variables.NOPE}}, so the step will fail when it runs.",
    );
  });

  test("with no secret variable yet, the kubeconfig says where one is added", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSteps(page, [KUBECTL_STEP], "variables=none");

    // The step names a kubeconfig that is not there: it takes the Runner's own.
    await (await openSecretPicker(page, "runbook-step-1-kubeconfig"))
      .filter({ hasText: "The Runner's own access" })
      .click();

    const kubeconfig: Locator = page.getByTestId("runbook-step-1-kubeconfig");
    await expect(
      kubeconfig.getByTestId("runbook-step-1-kubeconfig-add-variable"),
    ).toHaveText(
      "No secret variables yet. Add one under Runbooks › Settings › Global Variables, then pick it here.",
    );
    await expect(
      kubeconfig.getByRole("link", {
        name: "Runbooks › Settings › Global Variables",
      }),
    ).toHaveAttribute("href", VARIABLES_PAGE);
  });

  test("a variable made in another tab is offered on coming back, with nothing saved", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSteps(page, [KUBECTL_STEP]);

    await page.evaluate((): void => {
      (
        window as unknown as {
          __fixture: { addVariable: (name: string) => void };
        }
      ).__fixture.addVariable("STAGING_KUBECONFIG");
      window.dispatchEvent(new Event("focus"));
    });

    await expect(
      (await openSecretPicker(page, "runbook-step-1-kubeconfig")).filter({
        hasText: "STAGING_KUBECONFIG",
      }),
    ).toHaveCount(1);
    expect((await recorded(page)).updates).toEqual([]);
  });
});

test.describe("steps written with a credential", () => {
  test("say they no longer run, and one button turns each into a script step that does the same", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSteps(page, [], "legacy=1");

    /*
     * Folded, each says what it is, and that it no longer runs - beside its
     * title, where the approval lock goes - while no other step says so.
     */
    await expect(
      header(page, "Clear the cache (written through the API)"),
    ).toContainText("SSH with a runbook credential");
    await expect(
      header(page, "Scale workers (written through the API)"),
    ).toContainText("Kubernetes action with a runbook credential");
    await expect(page.getByTestId("runbook-step-2-no-longer-runs")).toHaveText(
      "No longer runs",
    );
    await expect(page.getByTestId("runbook-step-3-no-longer-runs")).toHaveText(
      "No longer runs",
    );
    await expect(page.getByTestId("runbook-step-0-no-longer-runs")).toHaveCount(
      0,
    );
    await expect(page.getByTestId("runbook-step-1-no-longer-runs")).toHaveCount(
      0,
    );
    // The sign sits on the title's line, after the title.
    const titleBox: { x: number; y: number; width: number; height: number } =
      (await page.getByTestId("runbook-step-2-title-text").boundingBox())!;
    const signBox: { x: number; y: number; width: number; height: number } =
      (await page.getByTestId("runbook-step-2-no-longer-runs").boundingBox())!;
    expect(signBox.x).toBeGreaterThan(titleBox.x + titleBox.width - 1);
    // At a laptop's width it says it in words.
    expect(signBox.width).toBeGreaterThan(60);
    expect(
      Math.abs(
        signBox.y + signBox.height / 2 - (titleBox.y + titleBox.height / 2),
      ),
    ).toBeLessThan(4);

    for (const title of [
      "Clear the cache (written through the API)",
      "Scale workers (written through the API)",
    ]) {
      await header(page, title)
        .getByRole("button", { expanded: false })
        .first()
        .click();
    }

    // The fact first, then what turning it into a script step leaves to do.
    await expect(
      page.getByTestId("runbook-step-2-legacy").locator("p"),
    ).toHaveText(
      "Runbook credentials were removed, so this step no longer runs. Turn it into a script step, then fill in the machine and the secret variable it signs in with.",
    );
    await expect(
      page.getByTestId("runbook-step-3-legacy").locator("p"),
    ).toHaveText(
      "Runbook credentials were removed, so this step no longer runs. Turn it into a kubectl script that does the same, then pick its kubeconfig.",
    );
    /*
     * Its More fields line names only what it folds: its credential holds
     * the port and the passphrase.
     */
    await expect(page.getByTestId("runbook-step-2-more-fields")).toContainText(
      "Description",
    );
    await expect(
      page.getByTestId("runbook-step-2-more-fields"),
    ).not.toContainText("Port");
    await screenshot(page, "legacy-steps");

    await page.getByTestId("runbook-step-2-legacy-convert").click();
    await page.getByTestId("runbook-step-3-legacy-convert").click();

    await expect(page.getByTestId("runbook-step-2-legacy")).toHaveCount(0);
    await expect(page.getByTestId("runbook-step-2-no-longer-runs")).toHaveCount(
      0,
    );
    await expect(page.getByTestId("runbook-step-3-no-longer-runs")).toHaveCount(
      0,
    );
    await expect(
      page.getByTestId("runbook-step-2-ssh-target-input"),
    ).toBeVisible();

    const steps: Array<SavedStep> = await saveSteps(page);

    expect(steps[2]!.config).toMatchObject({
      script: "redis-cli FLUSHALL",
      agentId: BASTION_ID,
    });
    expect(steps[2]!.config).not.toHaveProperty("credentialId");
    expect(String(steps[3]!.config["script"])).toContain(
      `kubectl patch deployment workers --namespace jobs --subresource scale --patch '{"spec":{"replicas":4}}'`,
    );
    expect(steps[3]!.config).not.toHaveProperty("action");
  });
});

test.describe("steps written with a credential, on every screen", () => {
  test("a phone keeps the sign alone beside the title; dark mode and German say it too", async ({
    page,
  }: {
    page: Page;
  }) => {
    // A phone: the sign alone, so the title keeps its room.
    await page.setViewportSize({ width: 390, height: 844 });
    await openSteps(page, [], "legacy=1");

    const sign: Locator = page.getByTestId("runbook-step-2-no-longer-runs");
    await expect(sign).toBeVisible();
    // The sign alone: its padding and the 12-pixel icon, the words read out only.
    expect((await sign.boundingBox())!.width).toBeLessThanOrEqual(26);
    expect(
      (await sign.getByText("No longer runs").boundingBox())!.width,
    ).toBeLessThanOrEqual(1);
    await expect(sign).toHaveAttribute("title", "No longer runs");
    expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
    await screenshot(page, "phone-legacy-steps");

    // Dark mode, at a laptop's width: the sign and the notice read on dark.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${STEPS_PAGE}?page=steps&legacy=1&theme=dark`);
    await header(page, "Clear the cache (written through the API)")
      .getByRole("button", { expanded: false })
      .first()
      .click();
    await expect(page.getByTestId("runbook-step-2-legacy")).toBeVisible();
    const signColor: string = await page
      .getByTestId("runbook-step-2-no-longer-runs")
      .evaluate((element: Element): string => {
        return getComputedStyle(element).backgroundColor;
      });
    // Not the light amber-50 (rgb(255, 251, 235)) on a dark page.
    expect(signColor).not.toBe("rgb(255, 251, 235)");
    await screenshot(page, "dark-legacy-steps");

    // German: the sign and the notice in the Dashboard's German words.
    await page.goto(`${STEPS_PAGE}?page=steps&legacy=1&lang=de`);
    await expect(page.getByTestId("runbook-step-2-no-longer-runs")).toHaveText(
      GERMAN["No longer runs"]!,
    );
    await header(page, "Clear the cache (written through the API)")
      .getByRole("button", { expanded: false })
      .first()
      .click();
    await expect(
      page.getByTestId("runbook-step-2-legacy").locator("p"),
    ).toHaveText(
      GERMAN[
        "Runbook credentials were removed, so this step no longer runs. Turn it into a script step, then fill in the machine and the secret variable it signs in with."
      ]!,
    );
    await screenshot(page, "german-legacy-steps");
  });
});

test.describe("on every screen", () => {
  test("a phone: nothing runs off the screen, on the variables or the steps", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    await openVariables(page);
    expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
    await screenshot(page, "phone-global-variables");

    await openSteps(page, [SSH_STEP]);
    expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
    await screenshot(page, "phone-ssh-step");
  });

  test("dark mode", async ({ page }: { page: Page }) => {
    await page.goto(`${VARIABLES_PAGE}?page=variables&theme=dark`);
    await expect(row(page, "DB_HOST")).toBeVisible();
    expect(
      await page.evaluate((): boolean => {
        return document.documentElement.classList.contains("dark");
      }),
    ).toBe(true);
    await screenshot(page, "dark-global-variables");

    await page.goto(`${STEPS_PAGE}?page=steps&theme=dark`);
    await header(page, SSH_STEP)
      .getByRole("button", { expanded: false })
      .first()
      .click();
    await expect(
      page.getByTestId("runbook-step-0-ssh-target-input"),
    ).toBeVisible();
    await screenshot(page, "dark-ssh-step");
  });

  test("in German, the pages and the steps are said in German", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${VARIABLES_PAGE}?page=variables&lang=de`);
    await expect(page.getByTestId("card-details-heading").first()).toHaveText(
      GERMAN["Global Variables"]!,
    );
    await screenshot(page, "german-global-variables");

    await page.goto(`${STEPS_PAGE}?page=steps&lang=de`);
    await expect(header(page, SSH_STEP)).toContainText(
      GERMAN["SSH to {{target}} from {{runner}}"]!.replace(
        "{{target}}",
        "deploy@{{global.variables.DB_HOST}}",
      ).replace("{{runner}}", "prod-bastion"),
    );
  });
});
