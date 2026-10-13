import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import SyslogSetupGuide from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkEvents/SyslogSetupGuide";
import {
  PROBE_ADDRESS_PLACEHOLDER,
  SyslogSetupGuide as SyslogSetupGuideData,
  SyslogSetupVendor,
  getNetworkEventsDocsUrl,
  getSyslogSetupGuides,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkEvents/NetworkEventsSetup";
import Route from "../../../Types/API/Route";

/*
 * What an Events page shows before any syslog has arrived: three steps
 * from nothing to events. The probe already listens (with its port); the
 * device needs a remote syslog server set (per vendor, ready to paste);
 * and messages are matched to the device by the address they come from.
 *
 * What each vendor's guide says is pinned as data
 * (App/Tests/Dashboard/NetworkEventsSetup.test.ts); these draw it.
 */

function renderGuide(
  props: Partial<React.ComponentProps<typeof SyslogSetupGuide>> = {},
): void {
  render(
    <MemoryRouter>
      <SyslogSetupGuide scope="network" {...props} />
    </MemoryRouter>,
  );
}

function guide(): HTMLElement {
  return screen.getByTestId("syslog-setup-guide");
}

function tab(vendor: SyslogSetupVendor): HTMLElement {
  return screen.getByTestId(`syslog-setup-vendor-${vendor}`);
}

function steps(): Array<string> {
  return within(screen.getByTestId("syslog-setup-steps"))
    .getAllByRole("listitem")
    .map((step: HTMLElement): string => {
      return step.textContent || "";
    });
}

function configuration(): string | null {
  const block: HTMLElement | null = screen.queryByTestId(
    "syslog-setup-configuration",
  );

  return block ? block.querySelector("code")?.textContent || "" : null;
}

function dataFor(vendor: SyslogSetupVendor): SyslogSetupGuideData {
  return getSyslogSetupGuides().find(
    (candidate: SyslogSetupGuideData): boolean => {
      return candidate.vendor === vendor;
    },
  )!;
}

afterEach(() => {
  cleanup();
});

describe("the three steps", () => {
  test("say what will show up, in whose words, with nothing to add first", () => {
    renderGuide();

    expect(guide()).toHaveTextContent("See what your network devices report");
    expect(guide()).toHaveTextContent(
      "Links going down, tunnels, failovers, restarts and sign-ins show up here as they happen, in the same words whoever made the device - no device to add first.",
    );
  });

  test("step 1: the probe already listens, on one port, over UDP and over TCP", () => {
    renderGuide();

    expect(guide()).toHaveTextContent("Send syslog to one of your probes");
    expect(guide()).toHaveTextContent(
      "The probe already listens on this port, over UDP and over TCP",
    );
    expect(
      screen
        .getAllByTestId("syslog-setup-port")
        .map((port: HTMLElement): string => {
          return port.textContent || "";
        }),
    ).toEqual(["UDP 5140", "TCP 5140"]);
  });

  test("step 1 says what a probe in Docker needs, and what to do for a device that only knows port 514", () => {
    renderGuide();

    expect(guide()).toHaveTextContent(
      "A probe in Docker needs host networking (--network host) or the port published, such as -p 5140:5140/udp.",
    );
    expect(guide()).toHaveTextContent(
      "For a device that can only send to port 514, publish it as -p 514:5140/udp.",
    );
  });

  test("step 1 says what a probe that was never updated does, without a version number to look up", () => {
    renderGuide();

    expect(guide()).toHaveTextContent(
      "A probe you have not updated in a while listens only when it is started with PROBE_SYSLOG_RECEIVER_ENABLED=true, and only over UDP.",
    );
    // The setting is code: the same in every language.
    expect(
      within(guide()).getByText("PROBE_SYSLOG_RECEIVER_ENABLED=true").tagName,
    ).toBe("CODE");
  });

  test("step 3 on the network's page: where events land, and that a stranger's messages are kept", () => {
    renderGuide();

    expect(guide()).toHaveTextContent("Events appear here, device by device");
    expect(guide()).toHaveTextContent(
      "Messages from an address that is not a device yet show here too, ready to add as a device in one click.",
    );
    expect(
      screen.queryByTestId("syslog-setup-match-address"),
    ).not.toBeInTheDocument();
  });

  test("the docs link is the network events page, in a new tab", () => {
    renderGuide();

    const link: HTMLElement = within(guide()).getByRole("link", {
      name: "Every vendor's steps, and the events each one reports",
    });

    expect(link).toHaveAttribute("href", getNetworkEventsDocsUrl().toString());
    expect(link).toHaveAttribute("target", "_blank");
  });

  test("says it is waiting only when the page is", () => {
    renderGuide();

    expect(
      screen.queryByTestId("syslog-setup-waiting"),
    ).not.toBeInTheDocument();

    cleanup();
    renderGuide({ isWaiting: true });

    const waiting: HTMLElement = screen.getByTestId("syslog-setup-waiting");

    expect(waiting).toHaveAttribute("role", "status");
    expect(waiting).toHaveTextContent(
      "Waiting for the first message. This page checks for it every few seconds.",
    );
  });
});

describe("step 2: the device's side, per vendor", () => {
  test("a tab per vendor, in the guides' order, the first one open", () => {
    renderGuide();

    const tabs: Array<HTMLElement> = within(
      screen.getByRole("tablist", { name: "Device vendor" }),
    ).getAllByRole("tab");

    expect(
      tabs.map((candidate: HTMLElement): string => {
        return candidate.textContent || "";
      }),
    ).toEqual([
      "Cisco",
      "Sophos Firewall",
      "FortiGate",
      "Extreme Networks",
      "HPE Aruba",
      "MikroTik",
      "UniFi",
      "Cambium",
      "Other devices",
    ]);
    expect(
      tabs.map((candidate: HTMLElement): string | null => {
        return candidate.getAttribute("aria-selected");
      }),
    ).toEqual([
      "true",
      "false",
      "false",
      "false",
      "false",
      "false",
      "false",
      "false",
      "false",
    ]);
    // Tabs are buttons that do not submit a form they may sit in.
    for (const candidate of tabs) {
      expect(candidate).toHaveAttribute("type", "button");
    }
  });

  test("Cisco, open on arrival: its steps and its lines, ready to paste and to copy", () => {
    renderGuide();

    expect(steps()).toEqual(dataFor(SyslogSetupVendor.Cisco).steps);
    expect(configuration()).toBe(
      [
        `logging host ${PROBE_ADDRESS_PLACEHOLDER} transport udp port 5140`,
        "logging trap informational",
        "service timestamps log datetime msec",
      ].join("\n"),
    );
    expect(
      within(screen.getByTestId("syslog-setup-configuration")).getByRole(
        "button",
        { name: "Copy to clipboard" },
      ),
    ).toBeInTheDocument();
  });

  test.each(
    getSyslogSetupGuides().map(
      (data: SyslogSetupGuideData): [string, SyslogSetupGuideData] => {
        return [data.name, data];
      },
    ),
  )(
    "%s: its tab shows its steps, and its lines when it has lines to paste",
    (_name: string, data: SyslogSetupGuideData) => {
      renderGuide();

      fireEvent.click(tab(data.vendor));

      expect(tab(data.vendor)).toHaveAttribute("aria-selected", "true");
      expect(screen.getAllByRole("tab", { selected: true })).toHaveLength(1);
      expect(steps()).toEqual(data.steps);
      expect(configuration()).toBe(data.configuration);
    },
  );

  test("a vendor set up by clicks shows no empty box where lines would be", () => {
    renderGuide();

    fireEvent.click(tab(SyslogSetupVendor.Sophos));

    expect(
      screen.queryByTestId("syslog-setup-configuration"),
    ).not.toBeInTheDocument();
    expect(steps()[0]).toContain("System services > Log settings");

    // And back to one that has lines.
    fireEvent.click(tab(SyslogSetupVendor.MikroTik));

    expect(configuration()).toContain("/system logging action set remote");
  });

  test("on the network's page the step speaks of your devices", () => {
    renderGuide();

    expect(guide()).toHaveTextContent(
      "Set the probe as your devices' syslog server",
    );
  });
});

describe("on one device's page", () => {
  const SETTINGS: Route = new Route("/dashboard/p/network-devices/d/settings");

  test("speaks of this device, and names its probe", () => {
    renderGuide({ scope: "device", probeName: "office-probe" });

    expect(guide()).toHaveTextContent("See what this device reports");
    expect(guide()).toHaveTextContent(
      "Point the device's syslog at its probe.",
    );
    expect(guide()).toHaveTextContent("Send syslog to probe office-probe");
    expect(guide()).toHaveTextContent(
      "Set the probe as the device's syslog server",
    );
    expect(guide()).toHaveTextContent("Events appear here");
    expect(guide()).not.toHaveTextContent("device by device");
  });

  test("without a probe's name it still says where to send", () => {
    renderGuide({ scope: "device" });

    expect(guide()).toHaveTextContent("Send syslog to one of your probes");
  });

  test("lists the addresses its messages are matched by, and where to add another", () => {
    renderGuide({
      scope: "device",
      matchAddresses: ["10.0.0.2", "10.255.0.1", "2001:db8::1"],
      settingsRoute: SETTINGS,
    });

    expect(guide()).toHaveTextContent(
      "Messages are matched to this device by the address they come from:",
    );
    expect(
      screen
        .getAllByTestId("syslog-setup-match-address")
        .map((address: HTMLElement): string => {
          return address.textContent || "";
        }),
    ).toEqual(["10.0.0.2", "10.255.0.1", "2001:db8::1"]);
    expect(guide()).toHaveTextContent(
      "If the device sends from another address, such as a loopback, add it to its Other Addresses.",
    );
    expect(
      within(guide()).getByRole("link", { name: "Open device settings" }),
    ).toHaveAttribute("href", SETTINGS.toString());
  });

  test("with no settings page to link to there is no dead link", () => {
    renderGuide({ scope: "device", matchAddresses: ["10.0.0.2"] });

    expect(
      within(guide()).queryByRole("link", { name: "Open device settings" }),
    ).not.toBeInTheDocument();
  });

  test("a device with no address known yet lists none, and does not break", () => {
    renderGuide({ scope: "device" });

    expect(
      screen.queryByTestId("syslog-setup-match-address"),
    ).not.toBeInTheDocument();
  });

  test("a device polled by a global probe is told its syslog cannot get there, and what to do", () => {
    renderGuide({ scope: "device", isGlobalProbe: true });

    expect(screen.getByTestId("syslog-setup-global-probe")).toHaveTextContent(
      "This device is polled by a global probe, which syslog from your network cannot reach. Run a custom probe on the device's network and pick it in the device's settings.",
    );

    cleanup();
    renderGuide({ scope: "device", isGlobalProbe: false });

    expect(
      screen.queryByTestId("syslog-setup-global-probe"),
    ).not.toBeInTheDocument();
  });
});
