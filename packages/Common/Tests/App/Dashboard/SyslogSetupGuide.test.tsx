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

describe("a device whose maker is known", () => {
  function selectedTab(): string {
    return (
      within(guide()).getByRole("tab", { selected: true }).textContent || ""
    );
  }

  test.each([
    ["Sophos", "Sophos Firewall"],
    ["Fortinet", "FortiGate"],
    ["Extreme Networks", "Extreme Networks"],
    ["HPE Aruba", "HPE Aruba"],
    ["Hewlett Packard Enterprise", "HPE Aruba"],
    ["MikroTik", "MikroTik"],
    ["Ubiquiti", "UniFi"],
    ["Cambium Networks", "Cambium"],
    ["Cisco", "Cisco"],
  ])(
    "a %s device opens on its own maker's steps: %s",
    (deviceVendor: string, tabName: string) => {
      renderGuide({ scope: "device", deviceVendor: deviceVendor });

      expect(selectedTab()).toBe(tabName);
      expect(
        within(guide()).getAllByRole("tab", { selected: true }),
      ).toHaveLength(1);
    },
  );

  test("the steps and the lines shown are that maker's, not Cisco's", () => {
    renderGuide({ scope: "device", deviceVendor: "MikroTik" });

    expect(steps()).toEqual(dataFor(SyslogSetupVendor.MikroTik).steps);
    expect(configuration()).toBe(
      dataFor(SyslogSetupVendor.MikroTik).configuration,
    );
    expect(configuration()).not.toContain("logging host");
  });

  test("the maker is read out of a system description too", () => {
    renderGuide({
      scope: "device",
      deviceVendor:
        "ExtremeXOS (X460G2-24p-10G4) version 22.7.1.2 by release-manager",
    });

    expect(selectedTab()).toBe("Extreme Networks");
  });

  test("a maker OneUptime has no steps for, or none at all, opens on the first tab", () => {
    renderGuide({ scope: "device", deviceVendor: "Juniper Networks" });

    expect(selectedTab()).toBe("Cisco");

    cleanup();
    renderGuide({ scope: "device" });

    expect(selectedTab()).toBe("Cisco");

    cleanup();
    renderGuide({ scope: "device", deviceVendor: "   " });

    expect(selectedTab()).toBe("Cisco");
  });

  test("the maker arrives after the page: the guide moves to its steps", () => {
    const { rerender } = render(
      <MemoryRouter>
        <SyslogSetupGuide scope="device" />
      </MemoryRouter>,
    );

    expect(selectedTab()).toBe("Cisco");

    rerender(
      <MemoryRouter>
        <SyslogSetupGuide scope="device" deviceVendor="Sophos" />
      </MemoryRouter>,
    );

    expect(selectedTab()).toBe("Sophos Firewall");
    expect(steps()).toEqual(dataFor(SyslogSetupVendor.Sophos).steps);
  });

  test("a tab the reader picked themselves is theirs: a maker that arrives later does not take it back", () => {
    const { rerender } = render(
      <MemoryRouter>
        <SyslogSetupGuide scope="device" />
      </MemoryRouter>,
    );

    fireEvent.click(tab(SyslogSetupVendor.MikroTik));

    rerender(
      <MemoryRouter>
        <SyslogSetupGuide scope="device" deviceVendor="Sophos" />
      </MemoryRouter>,
    );

    expect(selectedTab()).toBe("MikroTik");
  });

  test("every other maker's steps stay one click away", () => {
    renderGuide({ scope: "device", deviceVendor: "Sophos" });

    expect(within(guide()).getAllByRole("tab")).toHaveLength(
      getSyslogSetupGuides().length,
    );

    fireEvent.click(tab(SyslogSetupVendor.Cisco));

    expect(selectedTab()).toBe("Cisco");
    expect(configuration()).toContain("logging host");
  });

  test("the network's page knows no one maker: it opens on the first tab", () => {
    renderGuide();

    expect(selectedTab()).toBe("Cisco");
  });
});

describe("a device polled by a global probe", () => {
  test("is told so before anything else in step 1: nothing under it applies until that is put right", () => {
    renderGuide({
      scope: "device",
      isGlobalProbe: true,
      probeName: "Frankfurt (global)",
    });

    const note: HTMLElement = screen.getByTestId("syslog-setup-global-probe");
    const listens: HTMLElement = within(guide()).getByText(
      "The probe already listens on this port, over UDP and over TCP, at the IP address of the machine it runs on.",
    );
    const firstPort: HTMLElement =
      screen.getAllByTestId("syslog-setup-port")[0]!;

    expect(
      note.compareDocumentPosition(listens) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      note.compareDocumentPosition(firstPort) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(note).toHaveAttribute("role", "note");
  });

  test("is not told to send syslog to the probe that cannot hear it", () => {
    renderGuide({
      scope: "device",
      isGlobalProbe: true,
      probeName: "Frankfurt (global)",
    });

    expect(guide()).toHaveTextContent("Send syslog to one of your probes");
    expect(guide()).not.toHaveTextContent("Send syslog to probe");
    expect(guide()).not.toHaveTextContent("Frankfurt (global)");
  });

  test("a device on a probe of the project's own is named its probe, and warned of nothing", () => {
    renderGuide({
      scope: "device",
      isGlobalProbe: false,
      probeName: "office-probe",
    });

    expect(guide()).toHaveTextContent("Send syslog to probe office-probe");
    expect(
      screen.queryByTestId("syslog-setup-global-probe"),
    ).not.toBeInTheDocument();
  });
});

describe("the vendor tabs, for a screen reader and the keyboard", () => {
  test("are a tab list named for what they choose", () => {
    renderGuide();

    expect(
      within(guide()).getByRole("tablist", { name: "Device vendor" }),
    ).toBeInTheDocument();
    expect(within(guide()).getAllByRole("tab")).toHaveLength(
      getSyslogSetupGuides().length,
    );
  });

  test("every tab says which panel it shows, and the panel says which tab it is of", () => {
    renderGuide();

    const panel: HTMLElement = within(guide()).getByRole("tabpanel");

    for (const candidate of within(guide()).getAllByRole("tab")) {
      expect(candidate).toHaveAttribute("aria-controls", panel.id);
      expect(candidate.id).not.toBe("");
    }

    expect(panel).toHaveAttribute(
      "aria-labelledby",
      tab(SyslogSetupVendor.Cisco).id,
    );
    // The panel is named after its tab.
    expect(within(guide()).getByRole("tabpanel", { name: "Cisco" })).toBe(
      panel,
    );

    fireEvent.click(tab(SyslogSetupVendor.UniFi));

    expect(panel).toHaveAttribute(
      "aria-labelledby",
      tab(SyslogSetupVendor.UniFi).id,
    );
    expect(within(guide()).getByRole("tabpanel", { name: "UniFi" })).toBe(
      panel,
    );
  });

  test("the steps and the lines to paste are what the panel holds", () => {
    renderGuide();

    const panel: HTMLElement = within(guide()).getByRole("tabpanel");

    expect(panel).toContainElement(screen.getByTestId("syslog-setup-steps"));
    expect(panel).toContainElement(
      screen.getByTestId("syslog-setup-configuration"),
    );
    // The tabs themselves are not inside it.
    expect(panel).not.toContainElement(tab(SyslogSetupVendor.Cisco));
  });

  test("two guides on one page keep their tabs and panels apart", () => {
    renderGuide();
    renderGuide();

    const panels: Array<HTMLElement> = screen.getAllByRole("tabpanel");
    const tabs: Array<HTMLElement> = screen.getAllByRole("tab");

    expect(panels).toHaveLength(2);
    expect(panels[0]!.id).not.toBe(panels[1]!.id);
    expect(
      new Set(
        tabs.map((candidate: HTMLElement): string => {
          return candidate.id;
        }),
      ).size,
    ).toBe(tabs.length);
  });

  test("a tab is a button the keyboard reaches, with a focus ring of its own", () => {
    renderGuide();

    for (const candidate of within(guide()).getAllByRole("tab")) {
      expect(candidate.tagName).toBe("BUTTON");
      expect(candidate).toHaveAttribute("type", "button");
      expect(candidate).toHaveClass(
        "focus:outline-none",
        "focus-visible:ring-2",
        "focus-visible:ring-indigo-500",
      );
    }
  });
});

/*
 * The room the guide keeps free around the lines to paste, as its classes
 * say: where the lines end ("[&_code]:!pr-12"), under them
 * ("[&_code]:!pb-3"), and above them below a width and from it
 * ("max-xl:[&_code]:!pt-12", "xl:[&_code]:!pt-3").
 */
const ROOM_AT_LINE_END: RegExp = /^\[&_code\]:!pr-(\d+(?:\.\d+)?)$/;
const ROOM_UNDER_THE_LINES: RegExp = /^\[&_code\]:!pb-(\d+(?:\.\d+)?)$/;
const ROOM_ABOVE_ON_NARROW: RegExp =
  /^max-(sm|md|lg|xl|2xl):\[&_code\]:!pt-(\d+(?:\.\d+)?)$/;
const ROOM_ABOVE_ON_WIDE: RegExp =
  /^(sm|md|lg|xl|2xl):\[&_code\]:!pt-(\d+(?:\.\d+)?)$/;

// Where the copy button stands and how big it is, as its own classes say.
const DISTANCE_FROM_RIGHT: RegExp = /^right-(\d+(?:\.\d+)?)$/;
const DISTANCE_FROM_TOP: RegExp = /^top-(\d+(?:\.\d+)?)$/;
const PADDING_ALL_ROUND: RegExp = /^p-(\d+(?:\.\d+)?)$/;
const WIDTH: RegExp = /^w-(\d+(?:\.\d+)?)$/;
const HEIGHT: RegExp = /^h-(\d+(?:\.\d+)?)$/;

// The one class of an element that a pattern matches, taken apart.
function classLike(element: Element, pattern: RegExp): RegExpExecArray {
  const found: Array<RegExpExecArray> = Array.from(element.classList).flatMap(
    (name: string): Array<RegExpExecArray> => {
      const match: RegExpExecArray | null = pattern.exec(name);

      return match ? [match] : [];
    },
  );

  if (found.length !== 1) {
    throw new Error(
      `${found.length} classes like ${pattern} on <${element.tagName}>`,
    );
  }

  return found[0]!;
}

// A spacing class's size in px: Tailwind counts in quarters of a rem.
function spacingOf(element: Element, pattern: RegExp): number {
  const found: RegExpExecArray = classLike(element, pattern);

  return Number(found[found.length - 1]) * 4;
}

interface CopyButton {
  // How far it reaches in from the block's right edge, and down from its top.
  reach: number;
  drop: number;
}

function copyButtonOf(block: HTMLElement): CopyButton {
  const button: HTMLElement = within(block).getByRole("button", {
    name: "Copy to clipboard",
  });
  const icon: Element | undefined = Array.from(
    button.querySelectorAll("*"),
  ).find((candidate: Element): boolean => {
    return Array.from(candidate.classList).some((name: string): boolean => {
      return WIDTH.test(name);
    });
  });

  if (!icon) {
    throw new Error("The copy button has no icon with a size");
  }

  const padding: number = 2 * spacingOf(button, PADDING_ALL_ROUND);

  return {
    reach:
      spacingOf(button, DISTANCE_FROM_RIGHT) + padding + spacingOf(icon, WIDTH),
    drop:
      spacingOf(button, DISTANCE_FROM_TOP) + padding + spacingOf(icon, HEIGHT),
  };
}

describe("the lines to paste", () => {
  test("the copy button lies over the block's top right corner, 40px each way", () => {
    renderGuide();

    expect(
      copyButtonOf(screen.getByTestId("syslog-setup-configuration")),
    ).toEqual({ reach: 40, drop: 40 });
  });

  test("on a narrow page the lines start under the copy button: it stood on the first line's port number", () => {
    renderGuide();

    const block: HTMLElement = screen.getByTestId("syslog-setup-configuration");

    /*
     * A phone's block is narrower than every vendor's first line, and a
     * small laptop's narrower than the longest. The lines scroll sideways;
     * the button does not, so what was under it could not be read at all.
     */
    expect(spacingOf(block, ROOM_ABOVE_ON_NARROW)).toBeGreaterThan(
      copyButtonOf(block).drop,
    );
  });

  test("the two rules for the room above the lines meet at one width, and leave none out", () => {
    renderGuide();

    const block: HTMLElement = screen.getByTestId("syslog-setup-configuration");

    // "max-xl:" ends where "xl:" starts.
    expect(classLike(block, ROOM_ABOVE_ON_NARROW)[1]).toBe(
      classLike(block, ROOM_ABOVE_ON_WIDE)[1],
    );
    // No third rule that would have to win over either of them.
    expect(
      Array.from(block.classList).filter((name: string): boolean => {
        return name.includes("!pt-") || name.includes("!py-");
      }),
    ).toHaveLength(2);
  });

  test("at every width the copy button's width is kept free where the lines end", () => {
    renderGuide();

    const block: HTMLElement = screen.getByTestId("syslog-setup-configuration");

    // A probe's address can be long enough to reach the button on any screen.
    expect(spacingOf(block, ROOM_AT_LINE_END)).toBeGreaterThan(
      copyButtonOf(block).reach,
    );
  });

  test("a guide of one line has room for its copy button on a wide page: the block is padded above and below", () => {
    renderGuide();

    fireEvent.click(tab(SyslogSetupVendor.Aruba));

    const block: HTMLElement = screen.getByTestId("syslog-setup-configuration");

    // One line: without the room, the button reached past the block's frame.
    expect(configuration()?.split("\n")).toHaveLength(1);

    // A line of this size is 22.75px high: 14px, 1.625 to the line.
    expect(block.querySelector("code")).toHaveClass(
      "text-sm",
      "leading-relaxed",
    );

    const blockHeight: number =
      spacingOf(block, ROOM_ABOVE_ON_WIDE) +
      22.75 +
      spacingOf(block, ROOM_UNDER_THE_LINES);

    expect(blockHeight).toBeGreaterThan(copyButtonOf(block).drop);
    expect(block).toHaveClass("xl:[&_code]:!pt-3", "[&_code]:!pb-3");
  });

  test("the docs link's arrow stays with its last word when the link wraps", () => {
    renderGuide();

    const link: HTMLElement = within(guide()).getByRole("link", {
      name: "Every vendor's steps, and the events each one reports",
    });

    // Inline, so the icon cannot be left alone on a line of its own.
    expect(link).not.toHaveClass("inline-flex");
    expect(link).toHaveClass("[&_div]:inline-block", "[&_div]:ml-1");
  });
});
