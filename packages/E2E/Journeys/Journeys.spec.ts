// UX rule: Docs/ux/README.md#journey-budgets
import { expect, Page, Route, test } from "@playwright/test";
import fs from "fs";
import path from "path";
import Journey from "./Journey";
import {
  BUDGET_FILE,
  compareWithBudget,
  JourneyBudgetFile,
  JourneyRun,
} from "./JourneyBudget";
import { AttachedRun, JOURNEY_RUN_ATTACHMENT } from "./JourneyReport";

/*
 * The journey budgets (#6831): each core job a newcomer comes to do, done
 * the way a person does it - with only what is on screen, by the words of
 * its buttons, the labels of its fields and the names of its options - in
 * the real Dashboard and Admin Dashboard (Fixture/), and counted by
 * Counter/InPageCounter.js. A run fails when a structural count moves from
 * Tests/Ops/JourneyBudgets.json, in either direction, with a message that
 * names the journey, the measure and what to do (JourneyBudget.js). The
 * table of every journey is written by JourneyReport.ts.
 *
 * A journey starts where a newcomer starts it: Home for a job they come to
 * do, the page a step before left them on for the next one (the monitor,
 * for being told), the Admin Dashboard's landing page for the first admin.
 * Getting to the start is not counted. What earlier journeys made is seeded
 * (?seed=), so each journey runs on its own.
 *
 * Each journey ends with `isDone`: what the fixture's server kept says the
 * job was done, not only that a page said so.
 *
 * Adding a journey, or a guided path beside a manual one (#6804, #6805,
 * #6806): Journeys/README.md.
 */

const PORT: string = process.env["JOURNEYS_FIXTURE_PORT"] || "4831";
const ORIGIN: string = `http://127.0.0.1:${PORT}`;
const PROJECT: string = "10000000-0000-4000-8000-000000006831";
const DASHBOARD: string = `/dashboard/${PROJECT}`;
// What the fixture calls its people and its seeded monitor (Fixture/NewProject.js).
const ADA: string = "40000000-0000-4000-8000-000000000001";
const GRACE: string = "40000000-0000-4000-8000-000000000002";
const MONITOR: string = "50000000-0000-4000-8000-000000000001";
// The code the fixture accepts in a Verify dialog.
const VERIFICATION_CODE: string = "123456";
const NOW: Date = new Date("2026-11-11T10:00:00.000Z");
const REPOSITORY: string = path.resolve(__dirname, "..", "..", "..");
const budgets: JourneyBudgetFile = JSON.parse(
  fs.readFileSync(path.join(REPOSITORY, BUDGET_FILE), "utf8"),
) as JourneyBudgetFile;

// A write the fixture's server kept (Fixture/Store.js).
interface FixtureWrite {
  kind: "create" | "update" | "delete";
  table: string;
  id?: string;
  data: Record<string, unknown>;
  misc?: Record<string, unknown>;
}

// A request to one of the API's own routes that the fixture answered.
interface FixtureApiCall {
  method: string;
  path: string;
  body: Record<string, unknown>;
}

interface FixtureLog {
  writes: Array<FixtureWrite>;
  api: Array<FixtureApiCall>;
}

// The writes of one table a journey made, of one kind.
function writesTo(
  log: FixtureLog,
  table: string,
  kind: FixtureWrite["kind"] = "create",
): Array<FixtureWrite> {
  return log.writes.filter((write: FixtureWrite) => {
    return write.table === table && write.kind === kind;
  });
}

// An id as it was written: a string, or an ObjectID as JSON.
function idOf(value: unknown): string {
  if (value && typeof value === "object" && "value" in value) {
    return String((value as { value: unknown }).value).toLowerCase();
  }
  return String(value).toLowerCase();
}

/*
 * One journey: a page of its own, opened at its start, with the clock
 * pinned, nothing allowed off this machine, and any error the product's
 * code throws failing it.
 */
function journey(
  id: string,
  doJob: (person: Journey, page: Page) => Promise<void>,
  isDone: (log: FixtureLog) => void,
): void {
  test(`${id}: ${budgets.journeys[id]?.title || "(no budget yet)"}`, async ({
    page,
  }: {
    page: Page;
  }) => {
    const pageErrors: Array<string> = [];
    const leftTheMachine: Array<string> = [];
    page.on("pageerror", (error: Error) => {
      pageErrors.push(error.message);
    });
    await page.route(
      (url: URL) => {
        return url.origin !== ORIGIN;
      },
      async (route: Route) => {
        leftTheMachine.push(route.request().url());
        await route.abort();
      },
    );
    await page.clock.setFixedTime(NOW);
    await Journey.prepare(page);

    const person: Journey = new Journey(page, id);
    await doJob(person, page);
    const run: JourneyRun = await person.finish();
    const log: FixtureLog = await page.evaluate(() => {
      const fixture: FixtureLog = (
        window as unknown as { __journeyFixture: FixtureLog }
      ).__journeyFixture;
      return { writes: fixture.writes, api: fixture.api };
    });

    // For the table of every journey (JourneyReport.ts), passed or not.
    const attached: AttachedRun = { id, run, writes: log.writes };
    await test.info().attach(JOURNEY_RUN_ATTACHMENT, {
      body: JSON.stringify(attached),
      contentType: "application/json",
    });

    isDone(log);
    expect(pageErrors, "the product threw while the journey ran").toEqual([]);
    expect(leftTheMachine, "a request left this machine").toEqual([]);

    const problems: Array<string> = compareWithBudget(budgets, id, run);
    expect(problems, problems.join("\n\n")).toEqual([]);
  });
}

/*
 * 1. Create a website monitor: Monitors from the products menu, Create
 * Monitor, Website, a name, the address, and the probes and interval as
 * they come (the Quickstart's "Monitor your website").
 */
journey(
  "website-monitor",
  async (person: Journey, page: Page) => {
    await person.begin(
      `${DASHBOARD}/home/`,
      page.getByRole("heading", { name: "Home" }),
    );
    await person.openProduct("Monitors");
    await person.press(/Create Monitor/);
    await person.choose(/^Website/);
    await person.type("Name", "Acme website");
    await person.submit("Next");
    await person.type("Website URL", "https://acme-commerce.example");
    await person.submit("Next");
    await person.submit("Create Monitor");
    await expect(page).toHaveURL(/\/monitors\/[0-9a-f-]{36}/);
  },
  (log: FixtureLog) => {
    const [monitor] = writesTo(log, "Monitor");
    expect(monitor?.data["monitorType"]).toBe("Website");
    expect(JSON.stringify(monitor?.data["monitorSteps"])).toContain(
      "https://acme-commerce.example",
    );
    // Checked from the probes a new monitor starts with.
    expect((monitor?.misc?.["probes"] as Array<string>).length).toBe(2);
  },
);

/*
 * 2. Make sure I am told when that monitor goes down: from the monitor, an
 * on-call policy that pages me for every new incident and alert - the
 * first policy's switch adds the rules that run it (the Quickstart's "Get
 * paged when it goes down"). My sign-in email already reaches me.
 */
journey(
  "told-when-down",
  async (person: Journey, page: Page) => {
    await person.begin(
      `${DASHBOARD}/monitors/${MONITOR}?seed=monitor`,
      page.getByRole("heading", { name: "Acme website" }).first(),
    );
    await person.openProduct("On-Call");
    await person.press(/Create On-Call Policy/);
    await person.type("Name", "Website on-call");
    await person.press("Add responder");
    await person.option(/^Ada Lovelace/);
    await person.submit("Create On-Call Policy");
    await expect(page).toHaveURL(/\/on-call-duty\/policies\/[0-9a-f-]{36}/);
  },
  (log: FixtureLog) => {
    const [policy] = writesTo(log, "OnCallDutyPolicy");
    expect(policy?.misc?.["users"]).toEqual([ADA]);
    expect(policy?.misc?.["pageForEveryNewIncidentAndAlert"]).toBe(true);
  },
);

/*
 * 1 and 2, guided (#6804): the same job - a website monitor, and being told
 * when it goes down - in the guided setup that Home's "Create your first
 * monitor" opens (and its checklist, for the goal "Know when my website or
 * API is down"). The address, who is told (me, to start with), and a test
 * page to myself, acknowledged from the email. Ends on the summary.
 */
journey(
  "website-down-guided",
  async (person: Journey, page: Page) => {
    await person.begin(
      `${DASHBOARD}/home/`,
      page.getByRole("heading", { name: "Home" }),
    );
    await person.press(/Create your first monitor/);
    await person.type(
      "Website or API address",
      "https://acme-commerce.example",
    );
    await person.submit("Start checking");
    await expect(page.getByTestId("guided-setup-first-check")).toContainText(
      "answered 200 in 312 ms from 2 locations",
    );
    await person.press("Continue");
    await person.press("Save and continue");
    await person.press("Send me a test page");
    // Acknowledged from the email: the dialog gives way to the result.
    await person.submit("Send test page");
    await person.press("Continue");
    await expect(page.getByTestId("guided-setup-summary")).toContainText(
      "acme-commerce.example is set up",
    );
  },
  (log: FixtureLog) => {
    const [monitor] = writesTo(log, "Monitor");
    expect(monitor?.data["monitorType"]).toBe("Website");
    expect(monitor?.data["name"]).toBe("acme-commerce.example");
    expect(JSON.stringify(monitor?.data["monitorSteps"])).toContain(
      "https://acme-commerce.example",
    );
    const [policy] = writesTo(log, "OnCallDutyPolicy");
    expect(policy?.misc?.["users"]).toEqual([ADA]);
    expect(policy?.misc?.["pageForEveryNewIncidentAndAlert"]).toBe(true);
    // The test page went to me, and was acknowledged.
    expect(
      log.api.filter((call: FixtureApiCall) => {
        return call.path.endsWith("/on-call-test-page/page-person");
      }),
    ).toHaveLength(1);
  },
);

/*
 * 3. Get paged by phone and escalate to a teammate, on OneUptime Cloud:
 * phone calls on for the project and money in the balance that pays for
 * them, my number added and verified, a policy that calls me first, and a
 * second level that pages Grace when I do not answer.
 */
journey(
  "paged-by-phone",
  async (person: Journey, page: Page) => {
    await person.begin(
      `${DASHBOARD}/home/?billing=on`,
      page.getByRole("heading", { name: "Home" }),
    );
    await person.openProduct("Project Settings");
    await person.sideMenu("Notification Channels", "Notifications");
    await person.toggle(/^Phone Calls/);
    await person.press("Recharge Balance");
    await person.type(/Amount/, "20");
    await person.submit("Recharge");
    await person.openFromBar("User Settings");
    await person.press("Add Phone Number for Calls");
    await person.type("Phone Number", "+15550100123");
    await person.submit("Add Phone Number for Calls");
    // The number gets a code as it is added: the Verify dialog opens.
    await person.type(/code/i, VERIFICATION_CODE);
    await person.submit("Verify");
    await person.openProduct("On-Call");
    await person.press(/Create On-Call Policy/);
    await person.type("Name", "Website on-call");
    await person.press("Add responder");
    await person.option(/^Ada Lovelace/);
    await person.submit("Create On-Call Policy");
    await person.press(/Add Escalation Rule/);
    await person.press("Add responder");
    await person.option(/^Grace Hopper/);
    await person.submit("Create Rule");
  },
  (log: FixtureLog) => {
    expect(
      writesTo(log, "Project", "update").map((write: FixtureWrite) => {
        return write.data;
      }),
    ).toEqual([
      { enableCallNotifications: true },
      { smsOrCallCurrentBalanceInUSDCents: 2000 },
    ]);
    expect(writesTo(log, "UserCall")).toHaveLength(1);
    expect(writesTo(log, "UserCall", "update")[0]?.data).toEqual({
      isVerified: true,
    });
    expect(writesTo(log, "OnCallDutyPolicy")[0]?.misc?.["users"]).toEqual([
      ADA,
    ]);
    expect(
      writesTo(log, "OnCallDutyPolicyEscalationRule")[0]?.misc?.["users"],
    ).toEqual([GRACE]);
  },
);

/*
 * 3b. The same job in the on-call guided setup (#6805), on OneUptime Cloud:
 * from Home's question to a test page of the policy acknowledged, on one
 * page - SMS and calls on and paid for, one number and one code for both,
 * a policy that pages me for every new incident and alert, Grace after 30
 * minutes, and the test.
 */
journey(
  "paged-by-phone-guided",
  async (person: Journey, page: Page) => {
    await person.begin(
      `${DASHBOARD}/home/?billing=on`,
      page.getByRole("heading", { name: "Home" }),
    );
    await person.tick(/Page the right person when something breaks/);
    await person.press("Continue");
    await person.press(/Set up an on-call policy/);
    await person.press("Turn on SMS and phone calls");
    await person.press("Add balance");
    await person.type(/Amount/, "20");
    await person.submit("Recharge");
    await person.type("Your phone number", "+15550100123");
    await person.submit("Text me a code");
    await person.type(/code/i, VERIFICATION_CODE);
    await person.submit("Verify");
    await expect(
      page.getByTestId("on-call-setup-reach-phone-value"),
    ).toContainText("Phone call");
    await person.press("Continue");
    // You are picked to be paged first; everyone is reached, so it moves on.
    await person.press("Save and continue");
    await person.press("Add teammates");
    await person.option(/^Grace Hopper/);
    await person.closeList();
    await person.press("Save and continue");
    await person.press("Test this policy");
    // Acknowledged from the email: the dialog gives way to the result.
    await person.submit("Send test page");
    await person.press("Continue");
    await expect(page.getByTestId("guided-setup-summary")).toContainText(
      "Grace Hopper is paged",
    );
  },
  (log: FixtureLog) => {
    expect(
      writesTo(log, "Project", "update").map((write: FixtureWrite) => {
        return write.data;
      }),
    ).toEqual([
      { enableSmsNotifications: true, enableCallNotifications: true },
      { smsOrCallCurrentBalanceInUSDCents: 2000 },
    ]);
    // One number, one code: verified by text, and for calls with no second.
    expect(writesTo(log, "UserSMS")).toHaveLength(1);
    expect(writesTo(log, "UserSMS", "update")[0]?.data).toEqual({
      isVerified: true,
    });
    expect(writesTo(log, "UserCall")).toHaveLength(1);
    const [policy] = writesTo(log, "OnCallDutyPolicy");
    expect(policy?.misc?.["users"]).toEqual([ADA]);
    expect(policy?.misc?.["pageForEveryNewIncidentAndAlert"]).toBe(true);
    expect(
      writesTo(log, "OnCallDutyPolicyEscalationRule")[0]?.misc?.["users"],
    ).toEqual([GRACE]);
    // The test page went to the policy, and was acknowledged.
    expect(
      log.api.filter((call: FixtureApiCall) => {
        return call.path.endsWith("/on-call-test-page/page-policy");
      }),
    ).toHaveLength(1);
  },
);

/*
 * 4. Publish a status page that shows the monitor: Status Pages, Create
 * Status Page with a name, then the monitor added from its Overview (the
 * Quickstart's "Publish a status page").
 */
journey(
  "status-page",
  async (person: Journey, page: Page) => {
    await person.begin(
      `${DASHBOARD}/home/?seed=monitor`,
      page.getByRole("heading", { name: "Home" }),
    );
    await person.openProduct("Status Pages");
    await person.press(/Create Status Page/);
    await person.type("Name", "Acme Status");
    await person.submit("Create Status Page");
    await person.press(/Add Monitors/);
    await person.press("Add Monitor");
    await person.pick(/^Monitor/, /Acme website/);
    await person.submit("Add Monitor");
  },
  (log: FixtureLog) => {
    const [statusPage] = writesTo(log, "StatusPage");
    const [resource] = writesTo(log, "StatusPageResource");
    expect(statusPage?.data["name"]).toBe("Acme Status");
    expect(idOf(resource?.data["statusPageId"])).toBe(
      idOf(statusPage?.data["_id"]),
    );
    expect(idOf(resource?.data["monitorId"])).toBe(MONITOR);
  },
);

/*
 * 5. Send first telemetry and get an alert on it: Logs, its setup guide,
 * an ingestion key; then, once the first logs are in (the person's app,
 * outside the product, sends them as the key is made), a monitor of those
 * logs from the Logs page's Create monitor.
 */
journey(
  "first-telemetry",
  async (person: Journey, page: Page) => {
    await person.begin(
      `${DASHBOARD}/home/`,
      page.getByRole("heading", { name: "Home" }),
    );
    await person.openProduct("Logs");
    await person.press("Send your first logs");
    await person.press("Create Ingestion Key");
    await person.submit("Create Ingestion Key");
    // The guide's last step: it checks every ten seconds.
    await person.waitUntilShown(/View logs/, 25);
    await person.press("Done");
    await person.press("Create monitor");
    await person.type("Name", "Checkout errors");
    await person.submit("Next");
    await person.submit("Create Monitor");
    await expect(page).toHaveURL(/\/monitors\/[0-9a-f-]{36}/);
  },
  (log: FixtureLog) => {
    expect(writesTo(log, "TelemetryIngestionKey")).toHaveLength(1);
    const [monitor] = writesTo(log, "Monitor");
    expect(monitor?.data["monitorType"]).toBe("Logs");
    expect(monitor?.data["name"]).toBe("Checkout errors");
  },
);

/*
 * 6. As an invited member, make myself reachable: Grace, a member, adds
 * her phone number for SMS in User Settings and verifies it. The owner has
 * turned SMS on (?seed=phones); her sign-in email reaches her already.
 */
journey(
  "member-reachable",
  async (person: Journey, page: Page) => {
    await person.begin(
      `${DASHBOARD}/home/?as=member&seed=phones`,
      page.getByRole("heading", { name: "Home" }),
    );
    await person.openFromBar("User Settings");
    await person.press("Add Phone Number for SMS Notifications");
    await person.type("Phone Number", "+15550100456");
    await person.submit("Add Phone Number for SMS Notifications");
    await person.type(/code/i, VERIFICATION_CODE);
    await person.submit("Verify");
  },
  (log: FixtureLog) => {
    const [sms] = writesTo(log, "UserSMS");
    expect(JSON.stringify(sms?.data["phone"])).toContain("+15550100456");
    expect(writesTo(log, "UserSMS", "update")[0]?.data).toEqual({
      isVerified: true,
    });
  },
);

/*
 * 7. As a self-hosted admin, make the server able to send email: from
 * where the first admin lands in the Admin Dashboard (/admin, which opens
 * Server setup while email, HTTPS or sign-ups are open, #6824), the SMTP
 * server and who the email comes from - its port starts on 587 (#6875) -
 * then "Send test email" on the same page, to the admin's own address.
 */
journey(
  "server-email",
  async (person: Journey, page: Page) => {
    await person.begin(
      "/admin",
      page.getByRole("heading", { name: "Finish setting up this server" }),
    );
    await person.press("Set up email");
    await person.press("Edit SMTP Config");
    await person.type("Hostname", "smtp.acme-commerce.example");
    await person.type(/^Username/, "oneuptime@acme-commerce.example");
    await person.type(/^Password/, "smtp-app-password");
    await person.submit("Next");
    await person.type("From Email", "oneuptime@acme-commerce.example");
    await person.type("From Name", "Acme OneUptime");
    await person.submit("Save Changes");
    await person.press("Send test email");
    await person.submit("Send test email");
  },
  (log: FixtureLog) => {
    const [saved] = writesTo(log, "GlobalConfig", "update");
    expect(saved?.data["smtpHost"]).toBe("smtp.acme-commerce.example");
    expect(saved?.data["smtpPort"]).toBe(587);
    const sent: Array<FixtureApiCall> = log.api.filter(
      (call: FixtureApiCall) => {
        return call.path.endsWith("/server-test/email");
      },
    );
    expect(
      sent.map((call: FixtureApiCall) => {
        return call.body["toEmail"];
      }),
    ).toEqual(["ada@acme-commerce.example"]);
  },
);
