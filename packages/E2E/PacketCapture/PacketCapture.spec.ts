import { Download, expect, Locator, Page, test } from "@playwright/test";
import fs from "fs";

/*
 * Packet captures, end to end in a browser, against the fixture's in-page
 * API (PacketCapture/Fixture.js): what a probe's captures say, starting one
 * through the real form - its dropdowns, its filter boxes and BPF, its
 * folded limits - and watching it get picked up, run and finish without a
 * Refresh; the file the browser saves on Download; Stop; who may do which;
 * the notice when a probe cannot capture; a device's Traffic card; and the
 * page at phone width, in the dark theme and in Japanese.
 */

const PROBE_ID: string = "30000000-0000-4000-8000-000000000001";
const DEVICE_ID: string = "40000000-0000-4000-8000-000000000001";
const RUNNING_ID: string = "60000000-0000-4000-8000-000000000001";
const COMPLETED_ID: string = "60000000-0000-4000-8000-000000000002";

interface CreatedCapture {
  probeId: string | null;
  networkDeviceId: string | null;
  interfaceName: string;
  bpfFilter: string;
  maxDurationInSeconds: number;
  maxPackets: number;
  maxFileSizeInMB: number;
}

async function open(page: Page, query: string = ""): Promise<void> {
  await page.goto(`/${query}`);
  await expect(page.getByTestId("fixture-page")).toBeVisible();
}

async function created(page: Page): Promise<Array<CreatedCapture>> {
  return await page.evaluate(() => {
    return JSON.parse(
      JSON.stringify(
        (
          window as unknown as {
            __packetCaptureFixture: { state: { created: unknown } };
          }
        ).__packetCaptureFixture.state.created,
      ),
    );
  });
}

async function fixtureList(page: Page, name: string): Promise<Array<string>> {
  return await page.evaluate((key: string) => {
    return (
      window as unknown as {
        __packetCaptureFixture: { state: Record<string, Array<string>> };
      }
    ).__packetCaptureFixture.state[key]!.slice();
  }, name);
}

async function update(
  page: Page,
  id: string,
  fields: Record<string, unknown>,
): Promise<void> {
  await page.evaluate(
    ({
      captureId,
      values,
    }: {
      captureId: string;
      values: Record<string, unknown>;
    }) => {
      const parsed: Record<string, unknown> = { ...values };

      for (const key of ["startedAt", "stopRequestedAt"]) {
        if (parsed[key]) {
          parsed[key] = new Date(String(parsed[key]));
        }
      }

      (
        window as unknown as {
          __packetCaptureFixture: {
            update: (id: string, fields: Record<string, unknown>) => void;
          };
        }
      ).__packetCaptureFixture.update(captureId, parsed);
    },
    { captureId: id, values: fields },
  );
}

function row(page: Page, text: string): Locator {
  return page.getByRole("row").filter({ hasText: text });
}

function modal(page: Page): Locator {
  return page.getByTestId("modal");
}

async function pick(
  page: Page,
  combobox: Locator,
  option: string,
): Promise<void> {
  await combobox.click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function openStartForm(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Start Packet Capture" }).click();
  await expect(modal(page)).toBeVisible();
}

test.describe("a probe's packet captures", () => {
  test("each capture says what happened to it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);

    const running: Locator = row(page, "host 10.20.0.1");

    await expect(running).toContainText("Running");
    await expect(running).toContainText(/Capturing · \d:\d\d of 2:00/);
    await expect(running.getByRole("progressbar")).toBeVisible();
    await expect(running.getByRole("button", { name: "Stop" })).toBeVisible();

    const completed: Locator = row(page, "18,342 packets");

    await expect(completed).toContainText("Completed");
    await expect(completed).toContainText("18,342 packets · 4.7 MB");
    await expect(completed).toContainText("Stopped after 5 minutes.");
    await expect(
      completed.getByRole("button", { name: "Download" }),
    ).toBeVisible();

    const empty: Locator = row(page, "icmp or icmp6");

    await expect(empty).toContainText("No packets matched the filter.");
    await expect(empty.getByRole("button", { name: "Download" })).toHaveCount(
      0,
    );

    const failed: Locator = row(page, "ens256");

    await expect(failed).toContainText("Failed");
    await expect(failed).toContainText(
      'The interface "ens256" is down. tcpdump said: ens256: That device is not up',
    );
    await expect(failed).toContainText("All traffic");
  });

  test("the running clock ticks without a Refresh", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);

    const detail: Locator = row(page, "host 10.20.0.1").getByTestId(
      "packet-capture-status-detail",
    );
    const first: string = (await detail.textContent()) || "";

    await expect(detail).not.toHaveText(first, { timeout: 5000 });
  });
});

test.describe("starting a capture", () => {
  test("the form says what a capture holds, then builds the filter from host, port and protocol", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);
    await openStartForm(page);

    await expect(modal(page)).toContainText(
      "A capture holds the traffic itself.",
    );
    await expect(modal(page)).toContainText(
      "Passwords, tokens and personal data that cross the wire end up in the file.",
    );
    await expect(modal(page)).toContainText("All interfaces (any)");

    const preview: Locator = page.getByTestId("packet-capture-filter-preview");

    await expect(preview).toHaveText(
      "No filter: every packet on every interface is kept.",
    );

    await pick(
      page,
      page.getByRole("combobox", { name: "Interface" }),
      "ens224",
    );
    await expect(preview).toHaveText(
      "No filter: every packet on ens224 is kept.",
    );

    await page.getByTestId("packet-capture-filter-host").fill("10.20.0.31");
    await page.getByTestId("packet-capture-filter-port").fill("5060");
    await pick(page, page.getByRole("combobox", { name: "Protocol" }), "UDP");

    await expect(preview).toHaveText(
      "Filter: host 10.20.0.31 and udp port 5060",
    );
  });

  test("the limits are folded under a sentence that follows them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);
    await openStartForm(page);

    const fold: Locator = page.getByTestId("folded-section-header");

    await expect(fold).toContainText(
      "Stops after 1 minute, 100,000 packets or 10 MB, whichever comes first.",
    );

    await fold.click();

    await pick(
      page,
      page.getByRole("combobox", { name: "Duration" }),
      "5 minutes",
    );
    await page.getByRole("spinbutton", { name: "Packet limit" }).fill("5000");
    await page
      .getByRole("spinbutton", { name: "File size limit (MB)" })
      .fill("5");

    // Folded again, the sentence says what was just set.
    await fold.click();

    await expect(fold).toContainText(
      "Stops after 5 minutes, 5,000 packets or 5 MB, whichever comes first.",
    );

    await page.getByTestId("modal-footer-submit-button").click();
    await expect(modal(page)).toHaveCount(0);

    expect(await created(page)).toMatchObject([
      { maxDurationInSeconds: 300, maxPackets: 5000, maxFileSizeInMB: 5 },
    ]);
  });

  test("a started capture appears at once, and is picked up, runs and finishes without a Refresh", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);
    await openStartForm(page);

    await pick(
      page,
      page.getByRole("combobox", { name: "Interface" }),
      "ens224",
    );
    await page.getByTestId("packet-capture-filter-host").fill("10.20.0.31");
    await page.getByTestId("packet-capture-filter-port").fill("5060");
    await pick(page, page.getByRole("combobox", { name: "Protocol" }), "UDP");

    await page.getByTestId("modal-footer-submit-button").click();
    await expect(modal(page)).toHaveCount(0);

    expect(await created(page)).toEqual([
      {
        probeId: PROBE_ID,
        networkDeviceId: null,
        interfaceName: "ens224",
        bpfFilter: "host 10.20.0.31 and udp port 5060",
        maxDurationInSeconds: 60,
        maxPackets: 100000,
        maxFileSizeInMB: 10,
      },
    ]);

    const fresh: Locator = row(page, "Waiting for the probe to pick it up.");

    await expect(fresh).toContainText("Pending");

    const id: string = await page.evaluate(() => {
      return (
        window as unknown as {
          __packetCaptureFixture: { lastCreatedId: () => string };
        }
      ).__packetCaptureFixture.lastCreatedId();
    });

    // The probe picks it up; the list re-reads itself every few seconds.
    await update(page, id, {
      status: "Running",
      startedAt: new Date().toISOString(),
    });

    await expect(
      row(page, "host 10.20.0.31 and udp port 5060").first(),
    ).toContainText(/Capturing · 0:0\d of 1:00/, { timeout: 12000 });

    await update(page, id, {
      status: "Completed",
      endReason: "PacketLimitReached",
      packetCount: 120,
      fileSizeInBytes: 20480,
    });

    const finished: Locator = row(page, "120 packets · 20 KB");

    await expect(finished).toBeVisible({ timeout: 12000 });
    await expect(finished).toContainText(
      "Stopped at its limit of 100,000 packets.",
    );
    await expect(
      finished.getByRole("button", { name: "Download" }),
    ).toBeVisible();
  });

  test("a BPF filter is checked as it is written, and a wrong one is never sent", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);
    await openStartForm(page);

    await page.getByTestId("packet-capture-filter-host").fill("10.0.0.5");
    await page.getByTestId("packet-capture-filter-mode").click();

    const expression: Locator = page.getByTestId(
      "packet-capture-filter-expression",
    );

    await expect(expression).toHaveValue("host 10.0.0.5");

    await expression.fill("host 10.0.0.5 and (udp port 53");

    const preview: Locator = page.getByTestId("packet-capture-filter-preview");

    await expect(preview).toHaveAttribute("role", "alert");
    await expect(preview).toHaveText(
      'The filter has a "(" that is never closed.',
    );

    await page.getByTestId("modal-footer-submit-button").click();
    await expect(modal(page)).toBeVisible();
    expect(await created(page)).toEqual([]);

    await expression.fill("host 10.0.0.5 and (udp port 53)");
    await page.getByTestId("modal-footer-submit-button").click();
    await expect(modal(page)).toHaveCount(0);

    expect((await created(page))[0]!.bpfFilter).toBe(
      "host 10.0.0.5 and (udp port 53)",
    );
  });

  test("a refusal from the server is shown in the form, which stays open", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);
    await page.evaluate(() => {
      (
        window as unknown as {
          __packetCaptureFixture: { state: { refuseNextCreate: string } };
        }
      ).__packetCaptureFixture.state.refuseNextCreate =
        "This probe is already running 2 packet captures. Wait for one to finish, or stop one, and try again.";
    });

    await openStartForm(page);
    await page.getByTestId("modal-footer-submit-button").click();

    await expect(modal(page)).toContainText(
      "This probe is already running 2 packet captures. Wait for one to finish, or stop one, and try again.",
    );
    expect(await created(page)).toEqual([]);
  });
});

test.describe("Download and Stop", () => {
  test("Download saves the capture's pcap file, under its name", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);

    const downloadPromise: Promise<Download> = page.waitForEvent("download");

    await row(page, "18,342 packets")
      .getByRole("button", { name: "Download" })
      .click();

    const download: Download = await downloadPromise;

    expect(download.suggestedFilename()).toBe(
      "packet-capture-contoso-hq-probe-ens224-2026-10-09T08-30-00Z.pcap",
    );

    const file: Buffer = fs.readFileSync((await download.path())!);

    expect(file).toHaveLength(176);
    expect(file.readUInt32LE(0)).toBe(0xa1b2c3d4);
    expect(await fixtureList(page, "downloads")).toEqual([COMPLETED_ID]);
  });

  test("Stop asks the probe to stop, and the row says it is stopping", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page);

    const running: Locator = row(page, "host 10.20.0.1");

    await running.getByRole("button", { name: "Stop" }).click();

    await expect(running).toContainText("Stopping and uploading the file…");
    await expect(running.getByRole("button", { name: "Stop" })).toHaveCount(0);
    expect(await fixtureList(page, "stops")).toEqual([RUNNING_ID]);
  });
});

test.describe("who may do what", () => {
  test("a member sees what ran, but may not start, stop or download", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?role=member");

    await expect(row(page, "18,342 packets")).toBeVisible();

    const start: Locator = page.getByRole("button", {
      name: "Start Packet Capture",
    });

    if ((await start.count()) > 0) {
      await expect(start).toBeDisabled();
    }

    await expect(
      row(page, "18,342 packets").getByRole("button", { name: "Download" }),
    ).toBeDisabled();
    await expect(
      row(page, "host 10.20.0.1").getByRole("button", { name: "Stop" }),
    ).toBeDisabled();
  });

  test("Start Packet Capture lets someone start and stop, not download", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?role=starter");

    await expect(
      page.getByRole("button", { name: "Start Packet Capture" }),
    ).toBeEnabled();
    await expect(
      row(page, "host 10.20.0.1").getByRole("button", { name: "Stop" }),
    ).toBeEnabled();
    await expect(
      row(page, "18,342 packets").getByRole("button", { name: "Download" }),
    ).toBeDisabled();
  });

  test("Download Packet Capture lets someone download, not stop", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?role=downloader");

    await expect(
      row(page, "18,342 packets").getByRole("button", { name: "Download" }),
    ).toBeEnabled();
    await expect(
      row(page, "host 10.20.0.1").getByRole("button", { name: "Stop" }),
    ).toBeDisabled();
  });
});

test.describe("a probe that cannot capture", () => {
  test("captures off: what to set where the probe runs, and no Start", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?view=off");

    const notice: Locator = page.getByTestId("packet-capture-readiness");

    await expect(notice).toContainText("Packet capture is off on this probe");
    await expect(notice).toContainText("PROBE_PACKET_CAPTURE_ENABLED=true");
    await expect(notice).toContainText("--network host");
    await expect(notice).toContainText("--cap-add NET_RAW");
    await expect(
      notice.getByRole("link", { name: "How to turn on packet capture" }),
    ).toHaveAttribute(
      "href",
      /\/probe\/packet-capture#turn-on-packet-capture$/,
    );
    await expect(
      page.getByRole("button", { name: "Start Packet Capture" }),
    ).toHaveCount(0);
    await expect(page.getByRole("table")).toHaveCount(0);
  });

  test("a probe that never reported is told to update", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?view=notreported");

    await expect(page.getByTestId("packet-capture-readiness")).toContainText(
      "This probe has not reported packet capture",
    );
  });

  test("with past captures, they are still listed under the notice", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?view=notool");

    await expect(page.getByTestId("packet-capture-readiness")).toContainText(
      "tcpdump is not installed on this probe",
    );
    await expect(row(page, "18,342 packets")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Start Packet Capture" }),
    ).toHaveCount(0);
  });

  test("a global probe never captures", async ({ page }: { page: Page }) => {
    await open(page, "?view=global");

    await expect(page.getByTestId("packet-capture-readiness")).toContainText(
      "Global probes never capture packets",
    );
  });
});

test.describe("a device's Traffic page", () => {
  test("lists the device's captures, and a new one starts at its address and is linked to it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?view=device");

    await expect(
      page.getByRole("row").filter({ hasText: "packets" }),
    ).toHaveCount(1);
    await expect(row(page, "18,342 packets")).toContainText(
      "on Contoso HQ probe",
    );

    await openStartForm(page);
    await expect(page.getByTestId("packet-capture-filter-preview")).toHaveText(
      "Filter: host 10.20.0.31",
    );

    await page.getByTestId("modal-footer-submit-button").click();
    await expect(modal(page)).toHaveCount(0);

    expect(await created(page)).toEqual([
      {
        probeId: PROBE_ID,
        networkDeviceId: DEVICE_ID,
        interfaceName: "any",
        bpfFilter: "host 10.20.0.31",
        maxDurationInSeconds: 60,
        maxPackets: 100000,
        maxFileSizeInMB: 10,
      },
    ]);
  });

  test("a device with no probe is told how to get one", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?view=device-noprobe");

    await expect(
      page.getByTestId("device-packet-capture-no-probe"),
    ).toContainText(
      "This device has no probe. Assign one in its settings to capture its traffic from there.",
    );
    await expect(
      page.getByRole("link", { name: "Open device settings" }),
    ).toHaveAttribute("href", new RegExp(`${DEVICE_ID}/settings`));
  });
});

test.describe("at phone width, in the dark and in Japanese", () => {
  test("nothing scrolls sideways, and the filter boxes stack", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);

    const overflow: () => Promise<number> = async (): Promise<number> => {
      return await page.evaluate(() => {
        return (
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
        );
      });
    };

    expect(await overflow()).toBeLessThanOrEqual(0);

    await openStartForm(page);

    expect(await overflow()).toBeLessThanOrEqual(0);

    const host: { y: number; height: number } | null = await page
      .getByTestId("packet-capture-filter-host")
      .boundingBox();
    const port: { y: number } | null = await page
      .getByTestId("packet-capture-filter-port")
      .boundingBox();

    expect(port!.y).toBeGreaterThan(host!.y + host!.height);
  });

  test("the notice is drawn in the dark theme's colours", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?view=off&theme=dark");

    const background: string = await page
      .getByTestId("packet-capture-readiness")
      .evaluate((element: Element) => {
        return getComputedStyle(element).backgroundColor;
      });

    const channels: Array<number> = (
      background.match(/\d+(\.\d+)?/g) || []
    ).map(Number);

    // A pale card glowing on a slate page is what a missing remap looks like.
    expect(channels[0]! + channels[1]! + channels[2]!).toBeLessThan(3 * 128);
  });

  test("the list and the form read in Japanese", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "?lang=ja");

    await expect(
      page.getByRole("button", { name: "パケットキャプチャを開始" }),
    ).toBeVisible();
    await expect(row(page, "host 10.20.0.1")).toContainText("実行中");

    await page
      .getByRole("button", { name: "パケットキャプチャを開始" })
      .click();

    await expect(modal(page)).toContainText(
      "1 分、100,000 パケット、10 MB のいずれかに先に達した時点で停止します。",
    );
    await expect(page.getByTestId("modal-footer-submit-button")).toHaveText(
      "キャプチャを開始",
    );
  });
});
