import { Locator, Page } from "@playwright/test";
import {
  CLOUD_PATH,
  PROJECT_ID,
  VIEWPORTS,
  expect,
  openCloudPage,
  screenshot,
  test,
} from "./Helpers";

/*
 * A cloud connected through a probe, from the Dashboard alone, in a real browser: Connect Cloud
 * and the connection test on the clouds list, the Data Collection card on the Overview and on
 * Settings, the switch between a probe and the agent, and what it reads beyond the defaults.
 * What a probe reports is scripted (Fixture/ProbeCollection.js): the probe's own tests read it
 * from a real cloud's recordings, and the server's from a real database.
 *
 * Every value here is made up. None of them is a credential of anything.
 */

const CLOUDS_PATH: string = `/dashboard/${PROJECT_ID}/openstack`;

const AUTH_URL: string = "https://keystone.acme-cloud.example:5000/v3";
const NORMALIZED_AUTH_URL: string = "https://keystone.acme-cloud.example:5000";
const CREDENTIAL_ID: string = "made-up-credential-id";
const SECRET: string = "made-up-secret-for-the-walk";
const NOVA_FINGERPRINT: string =
  "AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89";

interface WriteRequest {
  kind: string;
  modelName: string;
  id?: string;
  data: Record<string, unknown>;
}

async function writes(page: Page): Promise<Array<WriteRequest>> {
  return await page.evaluate((): Array<WriteRequest> => {
    return (
      window as unknown as {
        __openStackPagesFixture: { writeRequests: Array<WriteRequest> };
      }
    ).__openStackPagesFixture.writeRequests;
  });
}

async function cloudWrites(page: Page): Promise<Array<WriteRequest>> {
  return (await writes(page)).filter((write: WriteRequest): boolean => {
    return write.modelName === "OpenStackCloud";
  });
}

async function testsAsked(page: Page): Promise<Array<WriteRequest>> {
  return (await writes(page)).filter((write: WriteRequest): boolean => {
    return write.modelName === "OpenStackCloudConnectionTest";
  });
}

async function reportCollection(page: Page, name: string): Promise<void> {
  await page.evaluate((outcome: string): void => {
    (
      window as unknown as { __openStackPagesCollect: (name: string) => void }
    ).__openStackPagesCollect(outcome);
  }, name);
}

async function refuseNextWrite(page: Page, message: string): Promise<void> {
  await page.evaluate((refusal: string): void => {
    (
      window as unknown as {
        __openStackPagesRefuseNextWrite: (message: string) => void;
      }
    ).__openStackPagesRefuseNextWrite(refusal);
  }, message);
}

// What the page would scroll sideways by, were it wider than the window.
async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const overflow: number = await page.evaluate((): number => {
    return document.documentElement.scrollWidth - window.innerWidth;
  });

  expect(overflow).toBeLessThanOrEqual(1);
}

function nextButton(page: Page): Locator {
  return page.getByTestId("modal-footer-next-button");
}

function submitButton(page: Page): Locator {
  return page.getByTestId("modal-footer-submit-button");
}

async function fillFirstSteps(page: Page): Promise<void> {
  await page.getByTestId("openstack-auth-url").fill(AUTH_URL);
  await nextButton(page).click();
  await page
    .getByTestId("openstack-application-credential-id")
    .fill(CREDENTIAL_ID);
  await page.getByTestId("openstack-credential-secret").fill(SECRET);
  await nextButton(page).click();
  await expect(page.getByTestId("openstack-collection-regions")).toBeVisible();
}

test.describe("connecting a cloud from the clouds list", () => {
  test("the whole of it: a certificate trusted, the regions the catalog names, then its page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${CLOUDS_PATH}?clouds=none&estate=new&tests=untrusted,ok`);

    // The first run offers it beside the agent's guide.
    await expect(
      page.getByRole("button", { name: "Add OpenStack Cloud" }).first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "Connect Cloud" }).click();

    const dialog: Locator = page.getByRole("dialog", { name: "Connect Cloud" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(
      "Enter Keystone's address, a read-only credential and a probe that reaches the cloud. No agent to install.",
    );

    await fillFirstSteps(page);

    // Nothing is sent until the probe has said what it found.
    await page.getByTestId("openstack-test-connection-button").click();
    const result: Locator = page.getByTestId("openstack-test-result");
    await expect(result).toContainText("The API's certificate is not trusted", {
      timeout: 15000,
    });
    await expect(result).toContainText("nova.acme-cloud.example:8774");
    await expect(
      page.getByTestId("openstack-presented-fingerprint"),
    ).toHaveText(NOVA_FINGERPRINT);
    await screenshot(page, "connect-cloud-untrusted-certificate");

    await page.getByTestId("openstack-trust-certificate-button").click();
    await expect(
      page.getByTestId("openstack-trusted-certificates"),
    ).toHaveValue(NOVA_FINGERPRINT);

    await page.getByRole("button", { name: "Test again" }).click();
    await expect(result).toContainText(
      "Connected. This credential has the Full view",
      { timeout: 15000 },
    );
    await expect(result).toContainText(
      "Logged in to project oneuptime-monitoring with the roles reader, oneuptime_monitoring.",
    );
    await expect(page.getByTestId("openstack-test-full-reads")).toContainText(
      "3 reads answered in full.",
    );

    // Each test tried what the form held then, and the second, the certificate trusted.
    const tests: Array<WriteRequest> = await testsAsked(page);
    expect(tests).toHaveLength(2);
    expect(tests[0]!.data).toMatchObject({
      authUrl: AUTH_URL,
      applicationCredentialId: CREDENTIAL_ID,
      credentialSecret: SECRET,
      endpointInterface: "public",
    });
    expect(tests[0]!.data["trustedCertificateFingerprints"]).toEqual([]);
    expect(tests[1]!.data["trustedCertificateFingerprints"]).toEqual([
      NOVA_FINGERPRINT,
    ]);

    await page.getByTestId("openstack-use-regions-button").click();
    await expect(page.getByTestId("openstack-collection-regions")).toHaveValue(
      "RegionOne, RegionTwo",
    );
    // They are on the form now: there is nothing left to use.
    await expect(page.getByTestId("openstack-use-regions-button")).toHaveCount(
      0,
    );

    await page.getByTestId("openstack-cloud-name").fill("prod-eu");
    await screenshot(page, "connect-cloud-tested");

    await expect(submitButton(page)).toHaveText("Connect Cloud");
    await submitButton(page).click();

    // The cloud's page opens, and it says the probe is on its way.
    await expect(page).toHaveURL(
      new RegExp(`/dashboard/${PROJECT_ID}/openstack/[0-9a-f-]+$`),
    );

    const card: Locator = page.getByTestId("openstack-data-collection-status");
    await expect(card).toContainText("Checking");
    await expect(card).toContainText(
      `Collected by acme-dc-probe from ${NORMALIZED_AUTH_URL}, every 2 minutes. No agent runs for it.`,
    );
    // Not the agent's guide: nothing to install.
    await expect(page.getByText("Connect this cloud")).toHaveCount(0);

    const saved: Array<WriteRequest> = await cloudWrites(page);
    expect(saved).toHaveLength(1);
    expect(saved[0]!.kind).toBe("create");
    expect(saved[0]!.data).toMatchObject({
      name: "prod-eu",
      collectionMethod: "Probe",
      authUrl: AUTH_URL,
      credentialKind: "applicationCredential",
      applicationCredentialId: CREDENTIAL_ID,
      credentialSecret: SECRET,
      collectionRegions: ["RegionOne", "RegionTwo"],
      trustedCertificateFingerprints: [NOVA_FINGERPRINT],
      endpointInterface: "public",
      collectionIntervalInMinutes: 2,
    });
    // Only one kind is ever saved.
    expect(saved[0]!.data).not.toHaveProperty("keystoneUsername");
    expect(saved[0]!.data).not.toHaveProperty("projectName");

    // The probe answers, and the card follows without a reload.
    await reportCollection(page, "collecting");
    await expect(card).toContainText("Collecting", { timeout: 20000 });
    await expect(
      page.getByTestId("openstack-collection-inventory"),
    ).toContainText("12 hypervisors");
    await screenshot(page, "connect-cloud-collecting");
  });

  test("a user name and password asks for its own names, and a name defaults to the host", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${CLOUDS_PATH}?clouds=none&estate=new`);
    await page.getByRole("button", { name: "Connect Cloud" }).click();

    await page.getByTestId("openstack-auth-url").fill(AUTH_URL);
    await page.getByRole("radio", { name: "User name and password" }).check();
    await nextButton(page).click();

    await expect(
      page.getByTestId("openstack-application-credential-id"),
    ).toHaveCount(0);

    // It says what a password needs on this step, and does not walk on.
    await nextButton(page).click();
    await expect(page.getByText("User Name is required.")).toBeVisible();
    await expect(page.getByText("Project is required.")).toBeVisible();

    await page.getByTestId("openstack-keystone-username").fill("reader");
    await page.getByTestId("openstack-project-name").fill("monitoring");
    await page.getByTestId("openstack-credential-secret").fill(SECRET);

    // The domains most clouds leave as Default are folded, and can be set.
    await page.getByText("More fields", { exact: false }).first().click();
    await page.getByPlaceholder("Default").first().fill("Example");

    await nextButton(page).click();
    await page.getByTestId("openstack-collection-regions").fill("RegionOne");
    await submitButton(page).click();

    await expect(page).toHaveURL(
      new RegExp(`/dashboard/${PROJECT_ID}/openstack/[0-9a-f-]+$`),
    );

    const saved: Array<WriteRequest> = await cloudWrites(page);
    expect(saved[0]!.data).toMatchObject({
      credentialKind: "password",
      keystoneUsername: "reader",
      userDomainName: "Example",
      projectName: "monitoring",
      credentialSecret: SECRET,
    });
    expect(saved[0]!.data).not.toHaveProperty("applicationCredentialId");
  });

  test("what it reads beyond the defaults can be set as it is connected, folded until asked for", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${CLOUDS_PATH}?clouds=none&estate=new`);
    await page.getByRole("button", { name: "Connect Cloud" }).click();
    await fillFirstSteps(page);

    await expect(
      page.getByTestId("openstack-option-project-limits"),
    ).toBeHidden();

    await page.getByText("More fields", { exact: false }).first().click();
    await page.getByTestId("openstack-option-project-limits").click();
    await page.getByTestId("openstack-option-ports").click();
    await page.getByTestId("openstack-option-port-networks").fill("network-1");

    await page.getByTestId("openstack-collection-regions").fill("RegionOne");
    await submitButton(page).click();

    await expect(page).toHaveURL(
      new RegExp(`/dashboard/${PROJECT_ID}/openstack/[0-9a-f-]+$`),
    );

    expect((await cloudWrites(page))[0]!.data["collectionOptions"]).toEqual({
      collectProjectLimits: true,
      collectPorts: true,
      portNetworkIds: ["network-1"],
    });
  });

  test("a plain HTTP address stops at its step, and says what to do instead", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${CLOUDS_PATH}?clouds=none&estate=new`);
    await page.getByRole("button", { name: "Connect Cloud" }).click();

    await page
      .getByTestId("openstack-auth-url")
      .fill("http://keystone.acme-cloud.example:5000/v3");
    await nextButton(page).click();

    await expect(
      page.getByText(
        "Use https://. OneUptime never sends a credential or a token unencrypted. For a cloud whose APIs only speak plain HTTP, turn on TLS, or use the OpenStack agent, which runs beside it.",
      ),
    ).toBeVisible();
    await expect(
      page.getByTestId("openstack-application-credential-id"),
    ).toHaveCount(0);
    expect(await writes(page)).toEqual([]);
    await screenshot(page, "connect-cloud-plain-http");
  });

  test("a choice of probes starts on none, and it asks", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${CLOUDS_PATH}?clouds=none&estate=new&probes=many`);
    await page.getByRole("button", { name: "Connect Cloud" }).click();

    await page.getByTestId("openstack-auth-url").fill(AUTH_URL);
    await nextButton(page).click();

    await expect(page.getByText("Probe is required.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Add a probe" })).toBeVisible();
  });

  test("the list offers both ways in, and the Connect Cloud form is gone once it closes", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${CLOUDS_PATH}?estate=calm`);

    await expect(page.getByText("acme-prod").first()).toBeVisible();
    await expect(
      page.getByText(
        "Connect one with a read-only credential and a probe, or install the OneUptime OpenStack Agent.",
        { exact: false },
      ),
    ).toBeVisible();
    // How one cloud is collected is that cloud's, and starts hidden on the list.
    await expect(
      page.getByRole("columnheader", { name: "Collected By" }),
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Connect Cloud" }).click();
    await expect(page.getByTestId("openstack-auth-url")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("openstack-auth-url")).toHaveCount(0);
    expect(await writes(page)).toEqual([]);
  });
});

test.describe("Collected By on the clouds list, once it is turned on", () => {
  async function turnOnCollectedBy(page: Page): Promise<Locator> {
    const card: Locator = page
      .getByTestId("card")
      .filter({ hasText: "OpenStack Clouds" })
      .first();

    await expect(card.getByText("acme-prod").first()).toBeVisible();
    await card
      .getByTestId("card-header-actions")
      .getByRole("button", { name: "More options" })
      .click();
    await page.getByRole("menuitem", { name: "Columns", exact: true }).click();
    await page
      .getByTestId("column-customization-modal")
      .getByRole("checkbox", { name: "Collected By" })
      .check();
    await page.getByTestId("modal-footer-submit-button").click();
    await expect(card.locator("thead")).toContainText("Collected By");

    return card;
  }

  test("names the probe of a cloud a probe collects", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${CLOUDS_PATH}?estate=calm&collection=Probe`);

    const card: Locator = await turnOnCollectedBy(page);
    await expect(card.locator("tbody")).toContainText("Probe: acme-dc-probe");
  });

  test("says the agent for a cloud the agent sends", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${CLOUDS_PATH}?estate=calm`);

    const card: Locator = await turnOnCollectedBy(page);
    await expect(card.locator("tbody")).toContainText("OpenStack Agent");
  });
});

test.describe("the connection test says exactly what failed", () => {
  async function openTest(page: Page, tests: string): Promise<void> {
    await openCloudPage(
      page,
      "settings",
      `estate=calm&collection=Probe&tests=${tests}`,
    );
    await page.getByRole("button", { name: "Test Connection" }).click();
    await expect(
      page.getByTestId("openstack-test-connection-button"),
    ).toBeVisible();
  }

  test("a catalog on plain HTTP: the addresses, and to turn on TLS or use the agent", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTest(page, "plain-http");
    await page.getByTestId("openstack-test-connection-button").click();

    const result: Locator = page.getByTestId("openstack-test-result");
    await expect(result).toContainText(
      "The catalog names a plain HTTP endpoint",
      { timeout: 15000 },
    );
    await expect(result).toContainText(
      "http://nova.acme-cloud.example:8774/v2.1",
    );
    await expect(result).toContainText(
      "A credential's token is never sent unencrypted. Turn on TLS for that API, pick another endpoint interface, or use the OpenStack agent for this cloud.",
    );
    await expect(page.getByTestId("openstack-test-read")).toContainText(
      "Compute (Nova), RegionOne: servers",
    );
    await expect(
      page.getByTestId("openstack-trust-certificate-button"),
    ).toHaveCount(0);
    await screenshot(page, "connection-test-plain-http");
  });

  test("each failure in its own words, testing again each time with the saved credential", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTest(page, "refused,not-found,no-probe");

    const result: Locator = page.getByTestId("openstack-test-result");
    const expected: Array<[string, string]> = [
      [
        "Keystone refused the credential",
        "Keystone answered HTTP 401 to the application credential.",
      ],
      [
        "The probe cannot find this host name",
        "The probe's DNS has no address for keystone.acme.invalid.",
      ],
      [
        "The probe did not pick this up",
        "acme-dc-probe did not pick the test up in time.",
      ],
    ];

    for (const [title, message] of expected) {
      await page.getByTestId("openstack-test-connection-button").click();
      await expect(result).toContainText(title, { timeout: 15000 });
      await expect(result).toContainText(message);
    }

    for (const asked of await testsAsked(page)) {
      expect(asked.data).toMatchObject({
        authUrl: NORMALIZED_AUTH_URL,
        probeId: expect.any(String),
        openStackCloudId: expect.any(String),
      });
      expect(asked.data).not.toHaveProperty("credentialSecret");
    }
  });

  test("a login that worked says what the credential cannot read, and what opens it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTest(page, "project");
    await page.getByTestId("openstack-test-connection-button").click();

    const result: Locator = page.getByTestId("openstack-test-result");
    await expect(result).toContainText(
      "Connected. This credential has the Project view",
      { timeout: 15000 },
    );

    const rows: Locator = page.getByTestId("openstack-test-read");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("Refused");
    await expect(rows.nth(0)).toContainText(
      "Goes without it: The Hypervisors page and its alerts",
    );
    await expect(rows.nth(0)).toContainText(
      "What opens it: openstack role add --user oneuptime",
    );
    await expect(rows.nth(1)).toContainText("Own project only");
    await expect(rows.nth(1)).toContainText("1 project in 14 rows");
    await expect(page.getByTestId("openstack-test-warnings")).toContainText(
      "Keystone's list_limit cut the project list at 100.",
    );
    await screenshot(page, "connection-test-project-view");
  });
});

test.describe("the Overview's Data Collection card", () => {
  test("collecting: by which probe, what it read, and no setup guide", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "", "estate=calm&collection=Probe");

    const card: Locator = page.getByTestId("openstack-data-collection-status");
    await expect(card).toContainText("Collecting");
    await expect(card).toContainText("The probe is collecting this cloud.");
    await expect(card).toContainText(
      `Collected by acme-dc-probe from ${NORMALIZED_AUTH_URL}, every 2 minutes.`,
    );
    await expect(
      page.getByTestId("openstack-collection-inventory"),
    ).toContainText("240 instances");

    // The agent's words have no place on a cloud with no agent.
    await expect(page.getByRole("link", { name: "Setup guide" })).toHaveCount(
      0,
    );
    await expect(
      page.getByTestId("openstack-overview-data-status"),
    ).toBeVisible();

    await card.getByRole("button", { name: "Settings" }).click();
    await expect(page).toHaveURL(new RegExp(`${CLOUD_PATH}/settings$`));
    await expect(page.getByTestId("openstack-data-collection")).toBeVisible();
  });

  test("partly collecting: says which services were not read, and why", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "", "estate=calm&collection=Probe&probe=partial");

    const card: Locator = page.getByTestId("openstack-data-collection-status");
    await expect(card).toContainText("Partly collecting");

    const rows: Locator = page.getByTestId("openstack-collection-service");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("Backing off");
    await expect(rows.nth(0)).toContainText("Networking (Neutron), RegionOne");
    await expect(rows.nth(0)).toContainText("Neutron kept answering HTTP 503.");
    await expect(rows.nth(1)).toContainText("Refused");
    await expect(rows.nth(1)).toContainText(
      "Cinder answered HTTP 403 to volumes.",
    );

    // A service the cloud does not run is not a problem.
    await expect(card).not.toContainText("Images (Glance)");
    await expect(card).toContainText(
      "Keystone's list_limit cut the project list at 100.",
    );
    await screenshot(page, "data-collection-partial");
  });

  test("a certificate nobody trusted: shown, trusted in one click, and the probe tries again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(
      page,
      "",
      "estate=calm&collection=Probe&probe=untrusted",
    );

    const card: Locator = page.getByTestId("openstack-data-collection-status");
    await expect(card).toContainText("Not collecting");
    await expect(card).toContainText("The API's certificate is not trusted");
    await expect(card).toContainText("nova.acme-cloud.example:8774");
    await expect(
      page.getByTestId("openstack-presented-fingerprint"),
    ).toHaveText(NOVA_FINGERPRINT);
    await screenshot(page, "data-collection-untrusted");

    await page.getByTestId("openstack-trust-certificate-button").click();

    await expect(card).toContainText("Checking");
    expect((await cloudWrites(page))[0]).toMatchObject({
      kind: "updateById",
      data: { trustedCertificateFingerprints: [NOVA_FINGERPRINT] },
    });
    await expect(
      page.getByTestId("openstack-trust-certificate-button"),
    ).toHaveCount(0);
  });

  test("a catalog on plain HTTP: to turn on TLS or use the agent, with nothing to trust", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(
      page,
      "",
      "estate=calm&collection=Probe&probe=plain-http",
    );

    const card: Locator = page.getByTestId("openstack-data-collection-status");
    await expect(card).toContainText("The catalog names a plain HTTP endpoint");
    await expect(card).toContainText("use the OpenStack agent for this cloud");
    await expect(
      page.getByTestId("openstack-trust-certificate-button"),
    ).toHaveCount(0);
  });

  test("a new cloud the probe has not reported on asks for no agent", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "", "estate=new&collection=Probe&probe=checking");

    await expect(
      page.getByTestId("openstack-data-collection-status"),
    ).toContainText("Checking");
    await expect(page.getByText("Connect this cloud")).toHaveCount(0);
  });

  test("a cloud the agent sends is told as ever: no card, and how to connect it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "", "estate=new");

    await expect(page.getByText("Connect this cloud").first()).toBeVisible();
    await expect(
      page.getByTestId("openstack-data-collection-status"),
    ).toHaveCount(0);
  });
});

test.describe("the Settings page's Data Collection card", () => {
  test("from the agent to a probe and back, in a click each way", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "settings", "estate=calm");

    await expect(
      page.getByText(
        "The OpenStack agent you run sends this cloud's data. Collect it with a probe instead, and no agent or machine of its own is needed.",
      ),
    ).toBeVisible();

    await page.getByRole("button", { name: "Collect With a Probe" }).click();
    await expect(
      page.getByRole("dialog", { name: "Collect With a Probe" }),
    ).toContainText(
      "Stop the OpenStack agent after the first collection, or every metric arrives twice.",
    );

    await page.getByTestId("openstack-auth-url").fill(AUTH_URL);
    await nextButton(page).click();
    await page
      .getByTestId("openstack-application-credential-id")
      .fill(CREDENTIAL_ID);

    // Nothing is saved for an agent's cloud, so it asks for the secret.
    await expect(
      page.getByText("Leave blank to keep the stored value", { exact: false }),
    ).toHaveCount(0);
    await nextButton(page).click();
    await expect(
      page.getByText("Secret or Password is required."),
    ).toBeVisible();

    await page.getByTestId("openstack-credential-secret").fill(SECRET);
    await nextButton(page).click();
    await page.getByTestId("openstack-collection-regions").fill("RegionOne");
    await expect(submitButton(page)).toHaveText("Save Changes");
    await submitButton(page).click();

    const details: Locator = page.getByTestId("openstack-data-collection");
    await expect(details).toContainText(NORMALIZED_AUTH_URL);
    await expect(details).toContainText(
      `Application credential ${CREDENTIAL_ID}`,
    );
    await expect(details).toContainText("acme-dc-probe");

    const toProbe: WriteRequest = (await cloudWrites(page))[0]!;
    expect(toProbe.data).toMatchObject({
      collectionMethod: "Probe",
      authUrl: AUTH_URL,
      applicationCredentialId: CREDENTIAL_ID,
      credentialSecret: SECRET,
      collectionRegions: ["RegionOne"],
    });
    await screenshot(page, "settings-data-collection");

    await page.getByRole("button", { name: "Use the OpenStack Agent" }).click();
    await expect(
      page.getByText(
        "The probe stops collecting this cloud and its saved credential is deleted. Start the OpenStack agent first, so nothing is missed.",
      ),
    ).toBeVisible();
    await submitButton(page).click();

    await expect(
      page.getByRole("button", { name: "Collect With a Probe" }),
    ).toBeVisible();
    await expect(page.getByTestId("openstack-data-collection")).toHaveCount(0);

    expect((await cloudWrites(page))[1]).toMatchObject({
      kind: "updateById",
      data: { collectionMethod: "Agent" },
    });
  });

  test("Edit Connection keeps the saved secret unless one is typed", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "settings", "estate=calm&collection=Probe");

    await page.getByRole("button", { name: "Edit Connection" }).click();

    const dialog: Locator = page.getByRole("dialog", {
      name: "Edit Connection",
    });
    await expect(page.getByTestId("openstack-auth-url")).toHaveValue(
      NORMALIZED_AUTH_URL,
    );

    // Any step opens from the list: an edit has every step filled in.
    await dialog.getByText("Credential", { exact: true }).click();
    await expect(page.getByTestId("openstack-credential-secret")).toHaveValue(
      "",
    );
    await expect(
      dialog.getByText(
        "Encrypted, never shown again, and sent only to the probe you picked. Leave blank to keep the stored value.",
      ),
    ).toBeVisible();

    await dialog.getByText("Certificates and Regions", { exact: true }).click();
    await page
      .getByTestId("openstack-collection-regions")
      .fill("RegionOne, RegionTwo");
    await submitButton(page).click();

    await expect(page.getByTestId("openstack-data-collection")).toContainText(
      "RegionOne, RegionTwo",
    );

    const saved: WriteRequest = (await cloudWrites(page))[0]!;
    expect(saved.data).toMatchObject({
      collectionRegions: ["RegionOne", "RegionTwo"],
      credentialKind: "applicationCredential",
    });
    expect(saved.data).not.toHaveProperty("credentialSecret");
    // A hidden empty box beside a saved secret would read as a new credential.
    expect(saved.data).not.toHaveProperty("keystoneUsername");
    expect(saved.data).not.toHaveProperty("projectName");

    // It never asks for the secret back.
    const reads: Array<{ select?: Record<string, unknown> }> =
      await page.evaluate((): Array<{ select?: Record<string, unknown> }> => {
        return (
          window as unknown as {
            __openStackPagesFixture: {
              itemRequests: Array<{ select?: Record<string, unknown> }>;
            };
          }
        ).__openStackPagesFixture.itemRequests;
      });

    for (const read of reads) {
      expect(read.select || {}).not.toHaveProperty("credentialSecret");
    }
  });

  test("a save the server refuses is said on the form, and nothing closes", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "settings", "estate=calm&collection=Probe");

    await page.getByRole("button", { name: "Edit Connection" }).click();
    await page
      .getByTestId("openstack-auth-url")
      .fill("https://elsewhere.acme-cloud.example:5000");

    const dialog: Locator = page.getByRole("dialog", {
      name: "Edit Connection",
    });
    await dialog.getByText("Certificates and Regions", { exact: true }).click();

    const refusal: string =
      "Enter the credential's secret again: a saved one only goes with the address it was entered for.";
    await refuseNextWrite(page, refusal);
    await submitButton(page).click();

    await expect(dialog).toContainText(refusal);
    await expect(dialog).toBeVisible();
  });

  test("Project limits, reached from where the Projects page sends people", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "projects", "estate=calm&collection=Probe");

    const setup: Locator = page.getByTestId("openstack-quota-setup-probe");
    await expect(setup).toContainText("Project limits");
    await setup.getByRole("link", { name: "Settings" }).click();

    await expect(page).toHaveURL(new RegExp(`${CLOUD_PATH}/settings$`));

    const options: Locator = page.getByTestId("openstack-collection-options");
    await expect(options).toContainText("Project limits");
    await expect(options).toContainText(
      "Costs four API calls per project, on every collection.",
    );
    await expect(options).toContainText(
      "An unscoped list of ports can saturate Neutron on a large cloud.",
    );

    // Nothing to save until something changes.
    await expect(
      page.getByTestId("openstack-save-collection-options"),
    ).toHaveCount(0);

    await page.getByTestId("openstack-option-project-limits").click();
    await page.getByTestId("openstack-save-collection-options").click();

    await expect(
      page.getByTestId("openstack-save-collection-options"),
    ).toHaveCount(0);
    expect((await cloudWrites(page))[0]).toMatchObject({
      kind: "updateById",
      data: { collectionOptions: { collectProjectLimits: true } },
    });
    await expect(
      page.getByTestId("openstack-option-project-limits"),
    ).toHaveAttribute("aria-checked", "true");
  });

  test("Ports can be narrowed to the networks and projects named", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "settings", "estate=calm&collection=Probe");

    await expect(
      page.getByTestId("openstack-option-port-networks"),
    ).toHaveCount(0);

    await page.getByTestId("openstack-option-ports").click();
    await page
      .getByTestId("openstack-option-port-networks")
      .fill("network-1, network-2");
    await page.getByTestId("openstack-option-port-projects").fill("project-1");
    await screenshot(page, "settings-collection-options");
    await page.getByTestId("openstack-save-collection-options").click();

    await expect(
      page.getByTestId("openstack-save-collection-options"),
    ).toHaveCount(0);
    expect((await cloudWrites(page))[0]!.data).toEqual({
      collectionOptions: {
        collectPorts: true,
        portNetworkIds: ["network-1", "network-2"],
        portProjectIds: ["project-1"],
      },
    });
  });

  test("Test Connection from here: Use these regions and Trust this certificate save at once", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(
      page,
      "settings",
      "estate=calm&collection=Probe&probe=untrusted&tests=untrusted",
    );

    await page.getByRole("button", { name: "Test Connection" }).click();
    await page.getByTestId("openstack-test-connection-button").click();
    await expect(
      page.getByTestId("openstack-trust-certificate-button"),
    ).toBeVisible({ timeout: 15000 });

    await page.getByTestId("openstack-trust-certificate-button").click();

    // Closed, and the card shows what is trusted now.
    await expect(page.getByTestId("openstack-data-collection")).toContainText(
      NOVA_FINGERPRINT,
    );
    expect((await cloudWrites(page))[0]).toMatchObject({
      kind: "updateById",
      data: { trustedCertificateFingerprints: [NOVA_FINGERPRINT] },
    });
  });
});

test.describe("on every width, and in the dark", () => {
  for (const viewport of VIEWPORTS) {
    test(`nothing scrolls sideways at ${viewport.width}: long fingerprints and addresses wrap`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize(viewport);

      await openCloudPage(
        page,
        "",
        "estate=calm&collection=Probe&probe=untrusted",
      );
      await expect(
        page.getByTestId("openstack-presented-fingerprint"),
      ).toBeVisible();
      await expectNoSidewaysScroll(page);
      await screenshot(page, `data-collection-untrusted-${viewport.width}`);

      await openCloudPage(page, "settings", "estate=calm&collection=Probe");
      await expect(page.getByTestId("openstack-data-collection")).toBeVisible();
      await expectNoSidewaysScroll(page);
      await screenshot(page, `settings-data-collection-${viewport.width}`);

      await page.getByRole("button", { name: "Test Connection" }).click();
      await expect(
        page.getByTestId("openstack-test-connection-button"),
      ).toBeVisible();
      await expectNoSidewaysScroll(page);
    });
  }

  test("the card reads in dark mode", async ({ page }: { page: Page }) => {
    await openCloudPage(
      page,
      "",
      "estate=calm&collection=Probe&probe=partial&theme=dark",
    );

    await expect(
      page.getByTestId("openstack-data-collection-status"),
    ).toContainText("Partly collecting");
    await screenshot(page, "data-collection-partial-dark");
  });
});
