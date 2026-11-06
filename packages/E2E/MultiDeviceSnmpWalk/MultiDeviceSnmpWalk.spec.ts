import { Download, expect, Locator, Page, test } from "@playwright/test";
import fs from "fs/promises";
import path from "path";
import { boxesInOneFrame, FrameBox } from "../SuiteHelpers/Frames";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * The Network's SNMP Walk page (issue #5548), end to end in a browser,
 * against the fixture's in-page API (MultiDeviceSnmpWalk/Fixture.js): seven
 * routers walked at once - one answering everything, one without
 * sysLocation, one with no credentials, one with no probe, one that does not
 * answer, one whose walk stops at its limit and one monitor-backed - each
 * device's answer landing without a reload, the OIDs compared in aligned
 * columns and opened on each device's own value, Collect on every device
 * that answers, the template's Collect, the filter, the CSV, the walk read
 * back after a reload, who may do which, and the page at a phone's width, in
 * the dark theme and in German. Screenshots in
 * output/playwright/multi-device-snmp-walk-ui are for the people who review
 * the page.
 */

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/multi-device-snmp-walk-ui",
);

function deviceId(index: number): string {
  return `40000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

const AMSTERDAM: string = deviceId(1);
const BERLIN: string = deviceId(2);
const CARDIFF: string = deviceId(3);
const DUBLIN: string = deviceId(4);
const EDINBURGH: string = deviceId(5);
const FRANKFURT: string = deviceId(6);
const GENEVA: string = deviceId(7);
const FLEET: Array<string> = [
  AMSTERDAM,
  BERLIN,
  CARDIFF,
  DUBLIN,
  EDINBURGH,
  FRANKFURT,
  GENEVA,
];

const SYS_DESCR: string = "1.3.6.1.2.1.1.1.0";
const SYS_UP_TIME: string = "1.3.6.1.2.1.1.3.0";
const SYS_CONTACT: string = "1.3.6.1.2.1.1.4.0";
const SYS_NAME: string = "1.3.6.1.2.1.1.5.0";
const SYS_LOCATION: string = "1.3.6.1.2.1.1.6.0";
const MERAKI_CLIENTS: string = "1.3.6.1.4.1.29671.1.1.4.1.5.1";

interface WalkAskedFor {
  networkDeviceId: string | null;
  diagnosticType: string;
  snmpWalkRootOid: string;
  snmpWalkAfterOid: string | null;
}

interface Written {
  model: string;
  id: string;
  data: { snmpOids?: Array<{ oid: string }>; oids?: Array<{ oid: string }> };
}

interface FixtureState {
  sent: Array<Array<string>>;
  creates: Array<WalkAskedFor>;
  updates: Array<Written>;
  polls: number;
}

function fleetQuery(extra: string = ""): string {
  return `?devices=${FLEET.join(",")}${extra}`;
}

async function open(page: Page, query: string = fleetQuery()): Promise<void> {
  await page.goto(`/${query}`);
  await expect(page.getByTestId("multi-snmp-walk")).toBeVisible();
  // Inter, as production draws the page: widths and wraps are measured.
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

async function fixtureState(page: Page): Promise<FixtureState> {
  return await page.evaluate(() => {
    return JSON.parse(
      JSON.stringify(
        (
          window as unknown as {
            __multiDeviceSnmpWalkFixture: { state: unknown };
          }
        ).__multiDeviceSnmpWalkFixture.state,
      ),
    );
  });
}

function rowOf(page: Page, oid: string): Locator {
  return page.locator(`[data-testid="multi-snmp-walk-row"][data-oid="${oid}"]`);
}

function rows(page: Page): Locator {
  return page.getByTestId("multi-snmp-walk-row");
}

function chipOf(page: Page, id: string): Locator {
  return page.locator(
    `[data-testid="multi-snmp-walk-device"][data-device-id="${id}"]`,
  );
}

function problemOf(page: Page, id: string): Locator {
  return page.locator(
    `[data-testid="multi-snmp-walk-problem"][data-device-id="${id}"]`,
  );
}

// Walks the fleet the address names, from where it starts, to its end.
async function walkFleet(page: Page, oid: string = "1.3.6.1"): Promise<void> {
  await page.getByTestId("multi-snmp-walk-start-oid").fill(oid);
  await page.getByTestId("multi-snmp-walk-start").click();
  await expect(page.getByTestId("multi-snmp-walk-running")).toHaveCount(0, {
    timeout: 20000,
  });
}

async function backgroundBrightness(locator: Locator): Promise<number> {
  const background: string = await locator.evaluate((element: Element) => {
    return getComputedStyle(element).backgroundColor;
  });
  const channels: Array<number> = (background.match(/\d+(\.\d+)?/g) || []).map(
    Number,
  );

  return channels[0]! + channels[1]! + channels[2]!;
}

/*
 * A screenshot of the page at rest: two frames for the classes the page's
 * newest elements need (the fixture's Tailwind adds them as the DOM
 * changes), then the transitions a click started, played out.
 */
async function shoot(page: Page, name: string): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve: (value: unknown) => void) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
      });
    });
    await Promise.all(
      document
        .getAnimations()
        .filter((animation: Animation) => {
          return animation.effect?.getTiming().iterations !== Infinity;
        })
        .map((animation: Animation) => {
          return animation.finished.catch(() => {
            return undefined;
          });
        }),
    );
  });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}.png`),
    fullPage: true,
  });
}

test.beforeAll(async () => {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
});

test.describe("walking a fleet at once", () => {
  test("asks one walk per device it can walk, and shows each device's answer as it lands", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);

    // Before anything is walked: the devices are picked, nothing is asked.
    await expect(page.getByTestId("multi-snmp-walk-empty")).toBeVisible();
    await expect(page.getByTestId("multi-snmp-walk-devices")).toBeVisible();
    await shoot(page, "fleet-1280-picked");

    // One device's probe is slow: its walk lands after the others.
    await page.evaluate((id: string) => {
      (
        window as unknown as {
          __multiDeviceSnmpWalkFixture: {
            state: { slowDeviceIds: Array<string> };
          };
        }
      ).__multiDeviceSnmpWalkFixture.state.slowDeviceIds = [id];
    }, GENEVA);

    await page.getByTestId("multi-snmp-walk-start-oid").fill("1.3.6.1");
    await page.getByTestId("multi-snmp-walk-start").click();

    await expect(page.getByTestId("multi-snmp-walk-running")).toContainText(
      "Walking 1.3.6.1 on 7 devices…",
    );
    // What has landed is compared while the slow walk runs.
    await expect(rows(page).first()).toBeVisible({ timeout: 20000 });
    await expect(chipOf(page, GENEVA)).toContainText("Walking…");
    await expect(chipOf(page, AMSTERDAM)).toContainText("8 OIDs");
    await shoot(page, "fleet-1280-landing");

    await page.evaluate(() => {
      (
        window as unknown as {
          __multiDeviceSnmpWalkFixture: { finishRunning: () => void };
        }
      ).__multiDeviceSnmpWalkFixture.finishRunning();
    });
    await expect(page.getByTestId("multi-snmp-walk-running")).toHaveCount(0, {
      timeout: 20000,
    });
    await expect(chipOf(page, GENEVA)).toContainText("8 OIDs");

    const state: FixtureState = await fixtureState(page);

    // The device with no probe is never asked for; the rest are, once each.
    expect(
      state.creates
        .map((create: WalkAskedFor): string => {
          return create.networkDeviceId || "";
        })
        .sort(),
    ).toEqual(
      FLEET.filter((id: string): boolean => {
        return id !== DUBLIN;
      }).sort(),
    );

    // Each walk is asked for as a device's own page asks: the device, the type, the start.
    for (const sent of state.sent) {
      for (const column of sent) {
        expect(column).not.toMatch(
          /community|v3|auth|priv|password|credential|hostname|probe/i,
        );
      }

      expect(sent).toEqual(
        expect.arrayContaining([
          "diagnosticType",
          "networkDeviceId",
          "snmpWalkRootOid",
        ]),
      );
      expect(sent).not.toContain("snmpWalkAfterOid");
    }

    for (const create of state.creates) {
      expect(create.diagnosticType).toBe("SNMP Walk");
      expect(create.snmpWalkRootOid).toBe("1.3.6.1");
      expect(create.snmpWalkAfterOid).toBeNull();
    }

    // The address keeps the walk, so a reload or a link opens it again.
    const address: URL = new URL(page.url());
    expect(address.searchParams.get("devices")).toBe(FLEET.join(","));
    expect(address.searchParams.get("oid")).toBe("1.3.6.1");

    await expect(page.getByTestId("multi-snmp-walk-meta")).toContainText(
      "4 of 7 devices answered",
    );
    await shoot(page, "fleet-1280-walked");
  });

  test("lists every device not walked in full, with why and where it is fixed", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);
    await walkFleet(page);

    const problems: Locator = page.getByTestId("multi-snmp-walk-problems");

    await expect(problems).toContainText("3 devices were not walked in full");
    await expect(problemOf(page, CARDIFF)).toContainText(
      "This device has no SNMP credentials to walk it with.",
    );
    await expect(
      problemOf(page, CARDIFF).getByTestId("multi-snmp-walk-problem-settings"),
    ).toBeVisible();
    await expect(problemOf(page, DUBLIN)).toContainText(
      "This device has no probe assigned, so there is nothing to walk it from.",
    );
    await expect(problemOf(page, EDINBURGH)).toContainText(
      "The device did not answer",
    );
    await expect(problemOf(page, EDINBURGH)).toContainText("community string");

    // A walk that stopped at its limit is no problem: there is more to read.
    await expect(problemOf(page, FRANKFURT)).toHaveCount(0);
    await expect(chipOf(page, FRANKFURT)).toContainText(
      "OIDs so far, more to read",
    );
    await expect(
      page.getByTestId("multi-snmp-walk-more-to-read"),
    ).toContainText(
      "One device's walk stopped at its limit with more to read.",
    );

    // A device's name opens its own SNMP Walk page.
    await expect(chipOf(page, AMSTERDAM).locator("a")).toHaveAttribute(
      "href",
      new RegExp(`/network-devices/${AMSTERDAM}/snmp-walk$`),
    );
  });
});

test.describe("the devices' answers, side by side", () => {
  test("one OID a row in aligned columns, with how many devices answer it and their values", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);
    await walkFleet(page);

    await expect(page.getByTestId("multi-snmp-walk-summary")).toHaveText(
      "8 OIDs under 1.3.6.1.",
    );
    await expect(rows(page)).toHaveCount(8);

    const header: Locator = page.getByTestId("multi-snmp-walk-results-header");
    await expect(header).toContainText("OID");
    await expect(header).toContainText("Type");
    await expect(header).toContainText("Answered by");
    await expect(header).toContainText("Value");

    await expect(
      rowOf(page, SYS_DESCR).getByTestId("multi-snmp-walk-row-answered"),
    ).toContainText("4 of 4 devices");
    // The value every device agrees on, once.
    await expect(rowOf(page, SYS_DESCR)).toContainText(
      "Meraki MX67 Cloud Managed Security Appliance",
    );
    // Uptimes that differ, as the lowest and the highest.
    await expect(
      rowOf(page, SYS_UP_TIME).getByTestId("multi-snmp-walk-row-range"),
    ).toHaveText("00:05:00 to 52 days, 05:25:45");
    // Names that differ, as how many there are.
    await expect(
      rowOf(page, SYS_NAME).getByTestId("multi-snmp-walk-row-different"),
    ).toHaveText("4 different values");

    // Frankfurt's walk stopped before sysLocation: it is not counted without it.
    await expect(
      rowOf(page, SYS_LOCATION).getByTestId("multi-snmp-walk-row-answered"),
    ).toContainText("2 of 3 devices");
    await expect(
      rowOf(page, SYS_LOCATION).getByTestId("multi-snmp-walk-row-not-reached"),
    ).toHaveText("1 walk stopped before it");

    // The type, answered-by and value columns start at the same x on every row.
    const cells: Array<FrameBox> = await boxesInOneFrame([
      rowOf(page, SYS_DESCR).getByTestId("multi-snmp-walk-row-type"),
      rowOf(page, SYS_UP_TIME).getByTestId("multi-snmp-walk-row-type"),
      rowOf(page, MERAKI_CLIENTS).getByTestId("multi-snmp-walk-row-type"),
      rowOf(page, SYS_DESCR).getByTestId("multi-snmp-walk-row-answered"),
      rowOf(page, SYS_UP_TIME).getByTestId("multi-snmp-walk-row-answered"),
      rowOf(page, MERAKI_CLIENTS).getByTestId("multi-snmp-walk-row-answered"),
    ]);

    expect(Math.abs(cells[0]!.x - cells[1]!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(cells[0]!.x - cells[2]!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(cells[3]!.x - cells[4]!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(cells[3]!.x - cells[5]!.x)).toBeLessThanOrEqual(1);

    await expectNoSidewaysScroll(page);
  });

  test("Answered by opens each device's own answer, and why a device has none", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);
    await walkFleet(page);

    const toggle: Locator = rowOf(page, SYS_LOCATION).getByTestId(
      "multi-snmp-walk-row-answered",
    );

    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    const answers: Locator = rowOf(page, SYS_LOCATION).getByTestId(
      "multi-snmp-walk-row-answer",
    );

    await expect(answers).toHaveCount(4);
    await expect(answers.nth(0)).toHaveAttribute("data-answer", "answered");
    await expect(answers.nth(0)).toContainText("Amsterdam, Herengracht 182");
    await expect(answers.nth(1)).toHaveAttribute("data-answer", "missing");
    await expect(answers.nth(1)).toContainText("Not answered");
    await expect(answers.nth(2)).toHaveAttribute("data-answer", "notReached");
    await expect(answers.nth(2)).toContainText(
      "The walk stopped before this OID",
    );
    await expect(answers.nth(3)).toContainText("Geneva, Rue du Rhône 14");
    await shoot(page, "fleet-1280-answers");

    await toggle.click();
    await expect(answers).toHaveCount(0);
  });

  test("the filter finds any device's value, and can keep only what part of the fleet lacks", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);
    await walkFleet(page);

    await page.getByTestId("multi-snmp-walk-filter").fill("geneva");
    await expect(rows(page)).toHaveCount(2);
    await expect(page.getByTestId("multi-snmp-walk-filter-count")).toHaveText(
      "2 of 8 OIDs match.",
    );

    await page.getByTestId("multi-snmp-walk-filter").fill("");
    await page.getByTestId("multi-snmp-walk-only-missing").check();
    await expect(rows(page)).toHaveCount(1);
    await expect(rowOf(page, SYS_LOCATION)).toBeVisible();
  });
});

test.describe("collecting what the fleet answers", () => {
  test("Collect writes the OID to every device that answers it and is polled, once each", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);
    await walkFleet(page);

    const collect: Locator = rowOf(page, SYS_DESCR).getByTestId(
      "multi-snmp-walk-row-collect",
    );

    // Geneva is monitor-backed: nothing is collected on it.
    await expect(collect).toHaveText("Collect on 3 devices");
    await collect.click();

    await expect(
      rowOf(page, SYS_DESCR).getByTestId("multi-snmp-walk-collect-notice"),
    ).toContainText("Collected on 3 devices from their next poll on");
    await expect(
      rowOf(page, SYS_DESCR).getByTestId("multi-snmp-walk-row-collected"),
    ).toHaveText("Collected on 3 of 4");
    await expect(
      rowOf(page, SYS_DESCR).getByTestId("multi-snmp-walk-row-collect"),
    ).toHaveCount(0);

    const state: FixtureState = await fixtureState(page);
    const writes: Array<Written> = state.updates.filter((write: Written) => {
      return write.model === "NetworkDevice";
    });

    expect(
      writes
        .map((write: Written): string => {
          return write.id;
        })
        .sort(),
    ).toEqual([AMSTERDAM, BERLIN, FRANKFURT].sort());

    for (const write of writes) {
      expect(
        (write.data.snmpOids || []).map((entry: { oid: string }) => {
          return entry.oid;
        }),
      ).toEqual([SYS_DESCR]);
    }

    await shoot(page, "fleet-1280-collected");
  });

  test("the row's menu adds the OID to the template its devices use", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);
    await walkFleet(page);

    await rowOf(page, SYS_CONTACT)
      .getByTestId("multi-snmp-walk-row-more")
      .click();
    await page.getByText("Collect on every device using Edge routers").click();

    await expect(
      rowOf(page, SYS_CONTACT).getByTestId("multi-snmp-walk-collect-notice"),
    ).toContainText(
      "Every device using Edge routers collects it from its next poll on.",
    );

    const state: FixtureState = await fixtureState(page);
    const write: Written | undefined = state.updates.find((entry: Written) => {
      return entry.model === "Template";
    });

    expect(
      (write?.data.oids || []).map((entry: { oid: string }) => {
        return entry.oid;
      }),
    ).toEqual([SYS_UP_TIME, SYS_CONTACT]);
  });

  test("Download saves every device's OIDs as one CSV, the device's name first", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);
    await walkFleet(page);

    const [download]: [Download, void] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("multi-snmp-walk-download").click(),
    ]);

    expect(download.suggestedFilename()).toMatch(
      /^4-devices-snmp-walk-1\.3\.6\.1-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.csv$/,
    );

    const content: string = await fs.readFile((await download.path())!, "utf8");
    const lines: Array<string> = content.replace(/^\uFEFF/, "").split("\r\n");

    expect(lines[0]).toBe("Device,OID,Name,MIB,Type,Value");
    expect(
      lines.filter((line: string): boolean => {
        return line.startsWith("mx-amsterdam,");
      }),
    ).toHaveLength(8);
    expect(lines).toContain(
      "mx-berlin,1.3.6.1.2.1.1.5.0,sysName.0,SNMPv2-MIB,STRING,mx-berlin",
    );
  });
});

test.describe("the walk, read back", () => {
  test("a reload opens the same walk, without walking again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);
    await walkFleet(page);

    expect((await fixtureState(page)).creates).toHaveLength(6);

    // The walks are the server's: the fixture keeps them across the reload.
    await page.reload();
    await expect(page.getByTestId("multi-snmp-walk")).toBeVisible();
    await expect(page.getByTestId("multi-snmp-walk-start-oid")).toHaveValue(
      "1.3.6.1",
    );
    await expect(rows(page)).toHaveCount(8);
    await expect(chipOf(page, AMSTERDAM)).toContainText("8 OIDs");
    await expect(chipOf(page, EDINBURGH)).toContainText(
      "The device did not answer",
    );
    expect((await fixtureState(page)).creates).toEqual([]);
  });

  test("the last walk of the devices the address names is read back, and a reader who may not walk reads it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, fleetQuery("&oid=1.3.6.1&scenario=walked&role=viewer"));

    await expect(page.getByTestId("multi-snmp-walk-form")).toHaveCount(0);
    await expect(page.getByTestId("multi-snmp-walk-read-only")).toHaveText(
      "You can read this walk. Walking devices needs the Create Network Device Diagnostic permission.",
    );
    await expect(rows(page)).toHaveCount(8);
    await expect(page.getByTestId("multi-snmp-walk-meta")).toContainText(
      "Walked",
    );
    // Reading only: nothing to collect.
    await expect(page.getByTestId("multi-snmp-walk-row-collect")).toHaveCount(
      0,
    );
    expect((await fixtureState(page)).creates).toEqual([]);
  });
});

test.describe("the page in every shape", () => {
  test("at a phone's width, each OID is a card and nothing runs past the window", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, fleetQuery("&oid=1.3.6.1&scenario=walked"));
    await expect(rows(page)).toHaveCount(8);

    // The table's header is for the wide layout only.
    await expect(
      page.getByTestId("multi-snmp-walk-results-header"),
    ).toBeHidden();

    const [name, answered]: Array<FrameBox> = await boxesInOneFrame([
      rowOf(page, SYS_LOCATION).getByTestId("multi-snmp-walk-row-name"),
      rowOf(page, SYS_LOCATION).getByTestId("multi-snmp-walk-row-answered"),
    ]);

    // "Answered by" is a line of its own under the name.
    expect(answered!.y).toBeGreaterThan(name!.y + name!.height - 1);

    await expectNoSidewaysScroll(page);
    await shoot(page, "fleet-390-walked");
  });

  test("in the dark theme, the results are drawn on a dark card", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, fleetQuery("&oid=1.3.6.1&scenario=walked&theme=dark"));
    await expect(rows(page)).toHaveCount(8);

    expect(
      await backgroundBrightness(
        page
          .getByTestId("multi-snmp-walk-devices-status")
          .locator("li")
          .first(),
      ),
    ).toBeLessThan(200);
    await shoot(page, "fleet-1280-dark");
  });

  test("in German, the page's words are the reader's", async ({
    page,
  }: {
    page: Page;
  }) => {
    const german: Record<string, string> = JSON.parse(
      await fs.readFile(
        path.resolve(
          __dirname,
          "../../App/FeatureSet/Dashboard/src/Locales/de.json",
        ),
        "utf8",
      ),
    );

    await open(page, fleetQuery("&oid=1.3.6.1&scenario=walked&lang=de"));
    await expect(rows(page)).toHaveCount(8);

    await expect(
      page.getByTestId("multi-snmp-walk-results-header"),
    ).toContainText(german["Answered by"]!);
    await expect(page.getByTestId("multi-snmp-walk-results")).toContainText(
      german["Only OIDs some devices do not answer"]!,
    );
    await expect(page.getByTestId("multi-snmp-walk-download")).toContainText(
      german["Download CSV"]!,
    );
    await expectNoSidewaysScroll(page);
    await shoot(page, "fleet-1280-de");
  });
});
