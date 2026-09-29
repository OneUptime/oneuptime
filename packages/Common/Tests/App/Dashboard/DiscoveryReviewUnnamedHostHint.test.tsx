import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import DiscoveryPage from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Discovery";
import ProbeUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/Probe";
import NetworkDeviceDiscoveryScan, {
  DiscoveredNetworkDevice,
} from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import Probe from "../../../Models/DatabaseModels/Probe";
import Project from "../../../Models/DatabaseModels/Project";
import ObjectID from "../../../Types/ObjectID";
import Route from "../../../Types/API/Route";
import Permission from "../../../Types/Permission";
import { VoidFunction } from "../../../Types/FunctionTypes";
import {
  DiscoveredHostNetbiosStatus,
  DiscoveredHostReverseDnsStatus,
} from "../../../Types/NetworkDevice/DiscoveredHostNamingStatus";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import PermissionUtil from "../../../UI/Utils/Permission";
import { ComponentProps as ModalProps } from "../../../UI/Components/Modal/Modal";
import {
  ASK_THE_DEVICE_TIP,
  DiscoveredHostNamingExplanation,
  DiscoveredHostNamingScan,
  FAILED_SCAN_EXPLANATION,
  IN_PROGRESS_EXPLANATION,
  NETBIOS_NOT_RECORDED_SENTENCE,
  NETBIOS_OFF_SENTENCE,
  NOT_YET_NAMED_HOST_LABEL,
  NO_RECORD_TIP,
  REVERSE_DNS_NOT_RECORDED_SENTENCE,
  SNMP_NOT_CHECKED_SENTENCE,
  SNMP_NO_SYSNAME_SENTENCE,
  TRANSIENT_FAILURE_TIP,
  UNNAMED_HOST_LABEL,
  explainUnnamedDiscoveredHost,
} from "../../../Utils/NetworkDiscovery/DiscoveredHostNamingDiagnosis";
import { DiscoveryScanStatus } from "../../../Utils/NetworkDiscovery/DiscoveryScanStatus";

/*
 * OneUptime issue #3916, RENDERED: the Review Discovered Devices dialog says
 * why a host is listed by its bare address.
 *
 * The report: an ICMP-only scan of twelve kitchen displays named four of them
 * by reverse DNS and listed the other eight as addresses, with nothing
 * anywhere to say why. The probe now records per unnamed host what each
 * naming lookup came back with, Common's explainUnnamedDiscoveredHost turns
 * that (or, for a row from an older probe, what the scan was set to ask) into
 * fixed sentences, and the row shows a muted "No name found" and an (i)
 * carrying those sentences beside the name line.
 *
 * The wording itself is pinned by Common's own unit tests of that function.
 * What this file pins is the WIRING, through the real page with only the
 * scans table and the modal chrome mocked (the same harness as
 * DiscoveryReviewInventoryRefresh.test.tsx):
 *
 *   - the (i) is on unnamed rows and ONLY on unnamed rows;
 *   - hovering it shows exactly the explanation for THAT host under THIS
 *     scan — so the row hands the function the fresh scan (status, SNMP,
 *     NetBIOS) and whether the scan's probe is a global one;
 *   - the dialog's fresh read selects isNetbiosLookupEnabled, without which
 *     every scan would read as "NetBIOS off";
 *   - nothing the scanned host chose reaches the tooltip.
 *
 * Each explanation is asserted twice over: EXACTLY equal to what the Common
 * function says for the inputs the test states (which is what catches a row
 * passing the wrong scan or dropping the global-probe answer), and containing
 * the specific sentences that make the case distinguishable (which is what
 * stops the first assertion from passing because both sides went blank).
 *
 * Asserting tippy under jsdom: see Common/Tests/UI/Components/
 * InfoTooltip.test.tsx. The (i) is lazy, so no tooltip exists until it is
 * hovered; the popup is portalled to document.body and never finishes
 * animating out, so each explanation is read through the aria-describedby
 * link Tippy puts on the very (i) that was hovered, rather than by assuming
 * it is the only tooltip on the page.
 */

interface TableProps {
  actionButtons: Array<{
    title: string;
    onClick: (
      scan: NetworkDeviceDiscoveryScan,
      onComplete: VoidFunction,
    ) => Promise<void>;
  }>;
}

let capturedTable: TableProps | null = null;

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: TableProps) => {
      capturedTable = props;
      return null;
    },
  };
});

jest.mock("../../../UI/Components/Modal/Modal", () => {
  return {
    __esModule: true,
    ModalWidth: { Medium: 1 },
    default: (props: ModalProps) => {
      return (
        <div role="dialog" aria-label={props.title}>
          <p>{props.description}</p>
          {props.error && <p role="alert">{props.error}</p>}
          {props.isBodyLoading ? <p>Refreshing inventory</p> : props.children}
          <button onClick={props.onClose}>Close review</button>
          <button
            disabled={props.disableSubmitButton || props.isLoading}
            onClick={props.onSubmit}
          >
            {props.submitButtonText}
          </button>
        </div>
      );
    },
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SCAN_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const OTHER_SCAN_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
// The probe the scans below ran on, unless a test says otherwise.
const PROBE_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const OTHER_PROBE_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

// Every (i) this feature draws is named "About why <address> has no name".
const UNNAMED_HINT_NAME: RegExp = /^About why .+ has no name$/;

let getItemSpy: jest.SpyInstance;
let createSpy: jest.SpyInstance;
let getAllProbesSpy: jest.SpyInstance;

interface ScanShape {
  hosts: Array<DiscoveredNetworkDevice>;
  id?: ObjectID | undefined;
  status?: string | undefined;
  statusMessage?: string | undefined;
  isSnmpEnabled?: boolean | undefined;
  isNetbiosLookupEnabled?: boolean | undefined;
  probeId?: ObjectID | undefined;
}

/*
 * A scan as the dialog's fresh read returns it. Only the columns a test sets
 * are set: an unset isNetbiosLookupEnabled is exactly what the dialog would
 * have seen before it started selecting the column.
 */
function reviewScan(shape: ScanShape): NetworkDeviceDiscoveryScan {
  const value: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();
  value.id = shape.id || SCAN_ID;
  value.projectId = PROJECT_ID;
  value.probeId = shape.probeId || PROBE_ID;
  value.name = "Kitchen displays";
  value.cidr = "10.18.166.0/24";
  value.status = shape.status || DiscoveryScanStatus.Completed;

  if (shape.statusMessage !== undefined) {
    value.statusMessage = shape.statusMessage;
  }

  if (shape.isSnmpEnabled !== undefined) {
    value.isSnmpEnabled = shape.isSnmpEnabled;
  }

  if (shape.isNetbiosLookupEnabled !== undefined) {
    value.isNetbiosLookupEnabled = shape.isNetbiosLookupEnabled;
  }

  value.discoveredDevices = shape.hosts;
  return value;
}

/*
 * The facts of a scan the explanation reads, stated separately from the scan
 * object so each expected text below says in plain view what it was computed
 * from.
 */
function namingFactsOf(
  scan: NetworkDeviceDiscoveryScan,
): DiscoveredHostNamingScan {
  return {
    status: scan.status,
    isSnmpEnabled: scan.isSnmpEnabled,
    isNetbiosLookupEnabled: scan.isNetbiosLookupEnabled,
  };
}

function expectedExplanation(data: {
  host: DiscoveredNetworkDevice;
  scan: NetworkDeviceDiscoveryScan;
  isGlobalProbe: boolean | undefined;
}): DiscoveredHostNamingExplanation {
  const explanation: DiscoveredHostNamingExplanation | undefined =
    explainUnnamedDiscoveredHost({
      host: data.host,
      scan: namingFactsOf(data.scan),
      isGlobalProbe: data.isGlobalProbe,
    });

  // A test that expects an explanation for a named host is a broken test.
  if (!explanation) {
    throw new Error(
      `The fixture ${data.host.ipAddress} is named, so it has no explanation.`,
    );
  }

  return explanation;
}

function probe(id: ObjectID, isGlobalProbe: boolean): Probe {
  const value: Probe = new Probe();
  value.id = id;
  value.name = isGlobalProbe ? "probe-1" : "Kitchen probe";
  // What ProbeUtil.getAllProbes stamps on every probe it returns.
  value.isGlobalProbe = isGlobalProbe;
  return value;
}

async function renderPage(): Promise<void> {
  const project: Project = new Project();
  project.id = PROJECT_ID;
  render(
    <MemoryRouter>
      <DiscoveryPage
        pageRoute={new Route("/dashboard/network-devices/discovery")}
        currentProject={project}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );
  await waitFor(() => {
    expect(capturedTable).not.toBeNull();
  });
}

function reviewAction(): TableProps["actionButtons"][number] {
  const action: TableProps["actionButtons"][number] | undefined =
    capturedTable?.actionButtons.find(
      (button: TableProps["actionButtons"][number]) => {
        return button.title === "Review Results";
      },
    );
  if (!action) {
    throw new Error("Review Results action was not rendered");
  }
  return action;
}

/*
 * Open Review Results on `scan`, with the dialog's fresh read answering with
 * that same scan — so what is rendered is exactly the fixture.
 */
async function openReviewOf(scan: NetworkDeviceDiscoveryScan): Promise<void> {
  getItemSpy.mockResolvedValue(scan);
  await act(async () => {
    await reviewAction().onClick(scan, () => {});
  });
}

function unnamedHint(ipAddress: string): HTMLElement {
  return screen.getByTestId(`discovered-device-unnamed-${ipAddress}`);
}

function queryUnnamedHint(ipAddress: string): HTMLElement | null {
  return screen.queryByTestId(`discovered-device-unnamed-${ipAddress}`);
}

function checkbox(ipAddress: string): HTMLElement {
  return screen.getByTestId(`discovered-device-checkbox-${ipAddress}`);
}

/*
 * Hover the row's (i) and return exactly what its tooltip says: the popup
 * Tippy linked to THAT (i) through aria-describedby, so a tooltip left over
 * from an earlier hover cannot be read by mistake. Unhovered afterwards.
 */
async function explanationShownFor(ipAddress: string): Promise<string> {
  const trigger: HTMLElement = unnamedHint(ipAddress);

  fireEvent.mouseEnter(trigger);
  await act(async () => {
    jest.advanceTimersByTime(200);
  });

  const describedBy: string | null = trigger.getAttribute("aria-describedby");

  expect(describedBy).toBeTruthy();

  const popup: HTMLElement | null = document.getElementById(
    describedBy as string,
  );

  expect(popup).not.toBeNull();

  const text: string = popup!.textContent || "";

  fireEvent.mouseLeave(trigger);
  await act(async () => {
    jest.advanceTimersByTime(400);
  });

  return text;
}

/*
 * The row element for an address: the checkbox's row, found by walking up to
 * the element that carries the row's bottom border.
 */
function rowOf(ipAddress: string): HTMLElement {
  const row: HTMLElement | null = checkbox(ipAddress).closest(".border-b");

  if (!row) {
    throw new Error(`No row found for ${ipAddress}`);
  }

  return row as HTMLElement;
}

beforeEach(() => {
  jest.useFakeTimers();
  capturedTable = null;
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  getAllProbesSpy = jest.spyOn(ProbeUtil, "getAllProbes").mockResolvedValue([]);
  jest
    .spyOn(PermissionUtil, "getAllPermissions")
    .mockReturnValue([Permission.ProjectAdmin]);
  getItemSpy = jest.spyOn(ModelAPI, "getItem");
  createSpy = jest
    .spyOn(ModelAPI, "create")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

/*
 * The reporter's scan, cut down to one row of each kind: ICMP-only, NetBIOS
 * lookup off, run on a project probe. Two hosts named by their PTR records;
 * one the probe's DNS server has no PTR record for; one whose lookup timed
 * out even on the retry; and one stored by a probe older than the per-host
 * codes, which carries none.
 */
describe("the reporter's ICMP-only scan says why each unnamed host has no name (issue #3916)", () => {
  const NAMED_FIRST: DiscoveredNetworkDevice = {
    ipAddress: "10.18.166.50",
    snmpReachable: false,
    dnsHostname: "wb-0660-kds01.wbhq.com",
  };
  const NO_RECORD: DiscoveredNetworkDevice = {
    ipAddress: "10.18.166.51",
    snmpReachable: false,
    dnsHostnameStatus: DiscoveredHostReverseDnsStatus.NoRecord,
  };
  const NAMED_SECOND: DiscoveredNetworkDevice = {
    ipAddress: "10.18.166.52",
    snmpReachable: false,
    dnsHostname: "wb-0660-kds02.wbhq.com",
  };
  const TIMED_OUT: DiscoveredNetworkDevice = {
    ipAddress: "10.18.166.53",
    snmpReachable: false,
    dnsHostnameStatus: DiscoveredHostReverseDnsStatus.Timeout,
  };
  const LEGACY: DiscoveredNetworkDevice = {
    ipAddress: "10.18.166.54",
    snmpReachable: false,
  };

  function reporterScan(): NetworkDeviceDiscoveryScan {
    return reviewScan({
      hosts: [NAMED_FIRST, NO_RECORD, NAMED_SECOND, TIMED_OUT, LEGACY],
      isSnmpEnabled: false,
      isNetbiosLookupEnabled: false,
    });
  }

  beforeEach(() => {
    getAllProbesSpy.mockResolvedValue([probe(PROBE_ID, false)]);
  });

  test("the (i) is drawn on the three unnamed rows and on neither named one", async () => {
    await renderPage();
    await openReviewOf(reporterScan());

    expect(queryUnnamedHint("10.18.166.50")).not.toBeInTheDocument();
    expect(queryUnnamedHint("10.18.166.52")).not.toBeInTheDocument();
    expect(unnamedHint("10.18.166.51")).toBeInTheDocument();
    expect(unnamedHint("10.18.166.53")).toBeInTheDocument();
    expect(unnamedHint("10.18.166.54")).toBeInTheDocument();

    // And nothing else on the page is one: exactly three, one per row.
    expect(
      screen.getAllByRole("button", { name: UNNAMED_HINT_NAME }),
    ).toHaveLength(3);
  });

  test("each (i) is a button named after the address it explains", async () => {
    await renderPage();
    await openReviewOf(reporterScan());

    const button: HTMLElement = screen.getByRole("button", {
      name: "About why 10.18.166.51 has no name",
    });

    expect(button).toBe(unnamedHint("10.18.166.51"));
    expect(button).toHaveAttribute("type", "button");
  });

  test("a muted 'No name found' sits beside each unnamed name, and only there", async () => {
    await renderPage();
    await openReviewOf(reporterScan());

    expect(screen.getAllByText(UNNAMED_HOST_LABEL)).toHaveLength(3);

    for (const ipAddress of ["10.18.166.51", "10.18.166.53", "10.18.166.54"]) {
      const label: HTMLElement | null =
        rowOf(ipAddress).querySelector("span.text-gray-400");

      expect(label).toHaveTextContent(UNNAMED_HOST_LABEL);
      // Muted, small, and never squeezed out by a long name beside it.
      expect(label).toHaveClass("text-xs", "flex-shrink-0");
    }

    for (const ipAddress of ["10.18.166.50", "10.18.166.52"]) {
      expect(rowOf(ipAddress)).not.toHaveTextContent(UNNAMED_HOST_LABEL);
    }
  });

  test("the explanation is not in the page until someone reaches for it", async () => {
    await renderPage();
    await openReviewOf(reporterScan());

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(
      screen.queryByText(REVERSE_DNS_NOT_RECORDED_SENTENCE, { exact: false }),
    ).not.toBeInTheDocument();
  });

  test("hovering a host the DNS server has no PTR record for says exactly that", async () => {
    await renderPage();
    await openReviewOf(reporterScan());

    fireEvent.mouseEnter(unnamedHint("10.18.166.51"));
    await act(async () => {
      jest.advanceTimersByTime(200);
    });

    const expected: DiscoveredHostNamingExplanation = expectedExplanation({
      host: NO_RECORD,
      scan: reporterScan(),
      isGlobalProbe: false,
    });

    // The only tooltip on the page, and exactly the Common function's text.
    expect(screen.getByRole("tooltip").textContent).toBe(expected.text);

    const text: string = screen.getByRole("tooltip").textContent || "";

    // SNMP was never asked on this scan, and the tooltip says so first.
    expect(text.startsWith(SNMP_NOT_CHECKED_SENTENCE)).toBe(true);
    // The per-host code, not the legacy "nothing was recorded".
    expect(text).toContain("no PTR record");
    expect(text).not.toContain(REVERSE_DNS_NOT_RECORDED_SENTENCE);
    // NetBIOS was off, and the way to ask the device itself is named.
    expect(text).toContain(NETBIOS_OFF_SENTENCE);
    expect(text).toContain(NO_RECORD_TIP);
  });

  test("hovering a host whose lookup timed out says it timed out, not that it has no record", async () => {
    await renderPage();
    await openReviewOf(reporterScan());

    const text: string = await explanationShownFor("10.18.166.53");

    expect(text).toBe(
      expectedExplanation({
        host: TIMED_OUT,
        scan: reporterScan(),
        isGlobalProbe: false,
      }).text,
    );
    expect(text).toContain("did not answer in time");
    expect(text).toContain(TRANSIENT_FAILURE_TIP);
    // The defect #3916 was about: a DNS failure filed as "no PTR record".
    expect(text).not.toContain("no PTR record");
    expect(text).not.toContain(NO_RECORD_TIP);
  });

  test("hovering a row from an older probe says only what the scan itself can support", async () => {
    await renderPage();
    await openReviewOf(reporterScan());

    const text: string = await explanationShownFor("10.18.166.54");

    /*
     * Spelled out from the exported sentences as well as compared to the
     * function: this is the reporter's case exactly — no codes, ICMP only,
     * NetBIOS off — and the one where the honest answer is "SNMP and NetBIOS
     * were never asked, and reverse DNS recorded nothing", plus how to get
     * the device's own name.
     */
    expect(text).toBe(
      expectedExplanation({
        host: LEGACY,
        scan: reporterScan(),
        isGlobalProbe: false,
      }).text,
    );
    expect(text).toBe(
      [
        SNMP_NOT_CHECKED_SENTENCE,
        REVERSE_DNS_NOT_RECORDED_SENTENCE,
        NETBIOS_OFF_SENTENCE,
        ASK_THE_DEVICE_TIP,
      ].join(" "),
    );
  });

  test("the three unnamed rows are three different explanations", async () => {
    await renderPage();
    await openReviewOf(reporterScan());

    const texts: Array<string> = [];

    for (const ipAddress of ["10.18.166.51", "10.18.166.53", "10.18.166.54"]) {
      texts.push(await explanationShownFor(ipAddress));
    }

    expect(new Set<string>(texts).size).toBe(3);

    for (const text of texts) {
      expect(text.trim().length).toBeGreaterThan(0);
    }
  });

  test("the (i) sits on the name line, after the name, not on the address line", async () => {
    await renderPage();
    await openReviewOf(reporterScan());

    const button: HTMLElement = unnamedHint("10.18.166.51");
    const nameLine: HTMLElement = button.parentElement as HTMLElement;
    const name: HTMLElement = nameLine.firstElementChild as HTMLElement;

    // The name div is unchanged: truncating, titled, and first.
    expect(name).toHaveAttribute("title", "10.18.166.51");
    expect(name).toHaveClass("truncate");
    expect(name).toHaveTextContent("10.18.166.51");
    // The wrapper lets the name shrink rather than push the (i) off the row.
    expect(nameLine).toHaveClass("flex", "min-w-0");
    // Name, then the muted label, then the (i).
    expect(nameLine.lastElementChild).toBe(button);

    const addressLine: HTMLElement = nameLine.nextElementSibling as HTMLElement;

    expect(addressLine).toHaveTextContent("10.18.166.51");
    expect(addressLine).not.toHaveTextContent(UNNAMED_HOST_LABEL);
    expect(addressLine.querySelector("button")).toBeNull();
  });

  test("a named row's name line is exactly the name, with nothing beside it", async () => {
    await renderPage();
    await openReviewOf(reporterScan());

    const name: HTMLElement = screen.getByTitle("wb-0660-kds01.wbhq.com");
    const nameLine: HTMLElement = name.parentElement as HTMLElement;

    expect(nameLine.children).toHaveLength(1);
    expect(nameLine).toHaveTextContent(/^wb-0660-kds01\.wbhq\.com$/);
  });

  test("the dialog's fresh read selects the NetBIOS setting the explanation needs", async () => {
    await renderPage();
    await openReviewOf(reporterScan());

    expect(getItemSpy).toHaveBeenCalledTimes(1);
    expect(getItemSpy.mock.calls[0]![0].select).toMatchObject({
      status: true,
      probeId: true,
      isSnmpEnabled: true,
      isNetbiosLookupEnabled: true,
      discoveredDevices: true,
    });
  });

  test("asking why does not select, deselect or import anything", async () => {
    await renderPage();
    await openReviewOf(reporterScan());

    expect(checkbox("10.18.166.51")).toBeChecked();

    fireEvent.click(unnamedHint("10.18.166.51"));
    fireEvent.keyDown(unnamedHint("10.18.166.51"), { key: "Enter" });

    expect(checkbox("10.18.166.51")).toBeChecked();
    expect(createSpy).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /Import Selected/ }),
    ).toHaveTextContent("Import Selected (5)");
  });

  test("the explanation opens on keyboard focus too", async () => {
    await renderPage();
    await openReviewOf(reporterScan());

    const button: HTMLElement = unnamedHint("10.18.166.54");

    act(() => {
      button.focus();
    });
    await act(async () => {
      jest.advanceTimersByTime(200);
    });

    expect(screen.getByRole("tooltip")).toHaveTextContent(
      REVERSE_DNS_NOT_RECORDED_SENTENCE,
    );
  });

  test("the unnamed hosts still import under their address, exactly as before", async () => {
    await renderPage();
    await openReviewOf(reporterScan());

    fireEvent.click(screen.getByRole("button", { name: /Import Selected/ }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    const names: Array<string> = createSpy.mock.calls.map(
      (call: Array<{ model: { name?: string } }>): string => {
        return String(call[0]!.model.name);
      },
    );

    expect(names).toEqual([
      "wb-0660-kds01.wbhq.com",
      "10.18.166.51",
      "wb-0660-kds02.wbhq.com",
      "10.18.166.53",
      "10.18.166.54",
    ]);
  });
});

/*
 * A row with no NetBIOS code, on a scan with NetBIOS turned ON. Either the
 * probe predates the codes, or it is a GLOBAL probe — which never sends
 * NetBIOS queries, and which is what the bundled self-hosted probe-1 and
 * probe-2 register as. The dialog can only tell those apart from the probe
 * list the page loaded, matched to the scan's probe; the probe used to record
 * the refusal in a debug log and nowhere else.
 */
describe("a row with no NetBIOS code says whether the scan's probe could ever have asked", () => {
  const LEGACY_PING_ONLY: DiscoveredNetworkDevice = {
    ipAddress: "10.18.166.60",
    snmpReachable: false,
  };

  function netbiosOnScan(
    probeId: ObjectID = PROBE_ID,
    id: ObjectID = SCAN_ID,
  ): NetworkDeviceDiscoveryScan {
    return reviewScan({
      hosts: [LEGACY_PING_ONLY],
      isSnmpEnabled: true,
      isNetbiosLookupEnabled: true,
      probeId: probeId,
      id: id,
    });
  }

  const GLOBAL_PROBE_SENTENCE: string = "global probes never send NetBIOS";

  test("on a global probe, the row says NetBIOS was never going to be asked", async () => {
    getAllProbesSpy.mockResolvedValue([probe(PROBE_ID, true)]);
    await renderPage();
    await openReviewOf(netbiosOnScan());

    const text: string = await explanationShownFor("10.18.166.60");

    expect(text).toBe(
      expectedExplanation({
        host: LEGACY_PING_ONLY,
        scan: netbiosOnScan(),
        isGlobalProbe: true,
      }).text,
    );
    expect(text).toContain(GLOBAL_PROBE_SENTENCE);
    expect(text).not.toContain(NETBIOS_NOT_RECORDED_SENTENCE);
  });

  test("on a project probe, the same row says only that no NetBIOS name was recorded", async () => {
    getAllProbesSpy.mockResolvedValue([probe(PROBE_ID, false)]);
    await renderPage();
    await openReviewOf(netbiosOnScan());

    const text: string = await explanationShownFor("10.18.166.60");

    expect(text).toBe(
      expectedExplanation({
        host: LEGACY_PING_ONLY,
        scan: netbiosOnScan(),
        isGlobalProbe: false,
      }).text,
    );
    expect(text).toContain(NETBIOS_NOT_RECORDED_SENTENCE);
    expect(text).not.toContain(GLOBAL_PROBE_SENTENCE);
  });

  test("a global probe that is NOT the scan's probe changes nothing", async () => {
    /*
     * Matched by id: the page's probe list holds global probes as a matter of
     * course, and one of them existing says nothing about the probe this
     * scan ran on.
     */
    getAllProbesSpy.mockResolvedValue([
      probe(OTHER_PROBE_ID, true),
      probe(PROBE_ID, false),
    ]);
    await renderPage();
    await openReviewOf(netbiosOnScan());

    const text: string = await explanationShownFor("10.18.166.60");

    expect(text).toContain(NETBIOS_NOT_RECORDED_SENTENCE);
    expect(text).not.toContain(GLOBAL_PROBE_SENTENCE);
  });

  test("a probe the page does not know is not assumed to be global", async () => {
    /*
     * Deleted since the scan ran, say. Unknown costs the row the more
     * specific sentence; it must never buy it a wrong one.
     */
    getAllProbesSpy.mockResolvedValue([probe(OTHER_PROBE_ID, true)]);
    await renderPage();
    await openReviewOf(netbiosOnScan());

    const text: string = await explanationShownFor("10.18.166.60");

    expect(text).toBe(
      expectedExplanation({
        host: LEGACY_PING_ONLY,
        scan: netbiosOnScan(),
        isGlobalProbe: undefined,
      }).text,
    );
    expect(text).toContain(NETBIOS_NOT_RECORDED_SENTENCE);
    expect(text).not.toContain(GLOBAL_PROBE_SENTENCE);
  });

  test("the answer follows the scan under review, not the first scan reviewed", async () => {
    /*
     * The global-probe answer is worked out per render from the scan the
     * dialog is showing. Reviewing a scan on a global probe and then one on
     * a project probe must not carry the first answer over.
     */
    getAllProbesSpy.mockResolvedValue([
      probe(PROBE_ID, true),
      probe(OTHER_PROBE_ID, false),
    ]);
    await renderPage();

    await openReviewOf(netbiosOnScan(PROBE_ID, SCAN_ID));
    expect(await explanationShownFor("10.18.166.60")).toContain(
      GLOBAL_PROBE_SENTENCE,
    );

    fireEvent.click(screen.getByText("Close review"));
    await openReviewOf(netbiosOnScan(OTHER_PROBE_ID, OTHER_SCAN_ID));

    const text: string = await explanationShownFor("10.18.166.60");

    expect(text).toContain(NETBIOS_NOT_RECORDED_SENTENCE);
    expect(text).not.toContain(GLOBAL_PROBE_SENTENCE);
  });

  test("on a global probe with NetBIOS off, the row gets the global probe's explanation", async () => {
    /*
     * The global-probe answer reaches the explanation on a NetBIOS-off scan
     * too, where it decides what the row is advised to turn on: a global
     * probe would never send the queries, so the page must not leave the
     * function believing it might. Compared to the function's own answer for
     * a global probe, so the wording of that advice stays Common's to own.
     */
    const scan: NetworkDeviceDiscoveryScan = reviewScan({
      hosts: [LEGACY_PING_ONLY],
      isSnmpEnabled: false,
      isNetbiosLookupEnabled: false,
    });

    getAllProbesSpy.mockResolvedValue([probe(PROBE_ID, true)]);
    await renderPage();
    await openReviewOf(scan);

    const text: string = await explanationShownFor("10.18.166.60");

    expect(text).toBe(
      expectedExplanation({
        host: LEGACY_PING_ONLY,
        scan: scan,
        isGlobalProbe: true,
      }).text,
    );
    expect(text).toContain(SNMP_NOT_CHECKED_SENTENCE);
    expect(text).toContain(NETBIOS_OFF_SENTENCE);
  });

  test("a per-host NetBIOS code wins over what the dialog would infer", async () => {
    /*
     * A newer probe stamps what actually happened. A host it queried that
     * never replied says so, whatever the page believes about the probe.
     */
    const queried: DiscoveredNetworkDevice = {
      ...LEGACY_PING_ONLY,
      dnsHostnameStatus: DiscoveredHostReverseDnsStatus.NoRecord,
      netbiosNameStatus: DiscoveredHostNetbiosStatus.NoReply,
    };
    const scan: NetworkDeviceDiscoveryScan = reviewScan({
      hosts: [queried],
      isSnmpEnabled: true,
      isNetbiosLookupEnabled: true,
    });

    getAllProbesSpy.mockResolvedValue([probe(PROBE_ID, false)]);
    await renderPage();
    await openReviewOf(scan);

    const text: string = await explanationShownFor("10.18.166.60");

    expect(text).toBe(
      expectedExplanation({ host: queried, scan: scan, isGlobalProbe: false })
        .text,
    );
    expect(text).toContain("UDP 137");
    expect(text).not.toContain(NETBIOS_NOT_RECORDED_SENTENCE);
  });
});

describe("what the row says depends on the scan's own state", () => {
  test("a scan still sweeping says its hosts are not named YET", async () => {
    /*
     * Names are looked up after the sweep, so every host a running scan has
     * uploaded so far is unnamed by construction — the question has not been
     * asked, and the row must not read as though it had been.
     */
    const host: DiscoveredNetworkDevice = {
      ipAddress: "10.18.166.70",
      snmpReachable: false,
    };
    const scan: NetworkDeviceDiscoveryScan = reviewScan({
      hosts: [host],
      status: DiscoveryScanStatus.InProgress,
      statusMessage: "Swept 64 of 254 addresses.",
      isSnmpEnabled: false,
    });

    await renderPage();
    await openReviewOf(scan);

    expect(rowOf("10.18.166.70")).toHaveTextContent(NOT_YET_NAMED_HOST_LABEL);
    expect(rowOf("10.18.166.70")).not.toHaveTextContent(UNNAMED_HOST_LABEL);
    expect(await explanationShownFor("10.18.166.70")).toBe(
      IN_PROGRESS_EXPLANATION,
    );
  });

  test("a failed scan says it stopped before names were looked up", async () => {
    const host: DiscoveredNetworkDevice = {
      ipAddress: "10.18.166.71",
      snmpReachable: false,
    };

    await renderPage();
    await openReviewOf(
      reviewScan({ hosts: [host], status: DiscoveryScanStatus.Failed }),
    );

    expect(rowOf("10.18.166.71")).toHaveTextContent(UNNAMED_HOST_LABEL);
    expect(await explanationShownFor("10.18.166.71")).toBe(
      FAILED_SCAN_EXPLANATION,
    );
  });

  test("an SNMP responder with a blank sysName says it answered with no name", async () => {
    const host: DiscoveredNetworkDevice = {
      ipAddress: "10.18.166.72",
      snmpReachable: true,
      sysName: "   ",
      sysDescr: "Linux kds 5.10",
      dnsHostnameStatus: DiscoveredHostReverseDnsStatus.ServerFailure,
    };
    const scan: NetworkDeviceDiscoveryScan = reviewScan({
      hosts: [host],
      isSnmpEnabled: true,
      isNetbiosLookupEnabled: false,
    });

    await renderPage();
    await openReviewOf(scan);

    const text: string = await explanationShownFor("10.18.166.72");

    expect(text).toBe(
      expectedExplanation({ host: host, scan: scan, isGlobalProbe: undefined })
        .text,
    );
    expect(text.startsWith(SNMP_NO_SYSNAME_SENTENCE)).toBe(true);
    expect(text).toContain("SERVFAIL");
    expect(text).toContain(TRANSIENT_FAILURE_TIP);
  });
});

describe("hosts with a name carry no hint at all", () => {
  test("named by SNMP, by reverse DNS or by NetBIOS: no label and no (i)", async () => {
    const scan: NetworkDeviceDiscoveryScan = reviewScan({
      hosts: [
        { ipAddress: "10.0.0.1", snmpReachable: true, sysName: "core-sw-01" },
        {
          ipAddress: "10.0.0.2",
          snmpReachable: false,
          dnsHostname: "printer.corp.example.com",
        },
        {
          ipAddress: "10.0.0.3",
          snmpReachable: false,
          netbiosName: "accounts-pc01",
        },
        /*
         * A name AND a stale code: a host an earlier pass could not name and
         * a later one did. The name is what counts, so no hint.
         */
        {
          ipAddress: "10.0.0.4",
          snmpReachable: false,
          dnsHostname: "kds04.corp.example.com",
          dnsHostnameStatus: DiscoveredHostReverseDnsStatus.Timeout,
        },
      ],
      isSnmpEnabled: true,
      isNetbiosLookupEnabled: true,
    });

    await renderPage();
    await openReviewOf(scan);

    for (const ipAddress of ["10.0.0.1", "10.0.0.2", "10.0.0.3", "10.0.0.4"]) {
      expect(checkbox(ipAddress)).toBeInTheDocument();
      expect(queryUnnamedHint(ipAddress)).not.toBeInTheDocument();
    }

    expect(
      screen.queryAllByRole("button", { name: UNNAMED_HINT_NAME }),
    ).toHaveLength(0);
    expect(screen.queryByText(UNNAMED_HOST_LABEL)).not.toBeInTheDocument();
    expect(
      screen.queryByText(NOT_YET_NAMED_HOST_LABEL),
    ).not.toBeInTheDocument();
  });
});

/*
 * The tooltip is fixed copy picked by whitelisted codes. A scanned network
 * chooses its PTR records, its NetBIOS answers and its sysDescr, and a probe
 * (or anything that can write the jsonb) chooses the code strings — none of
 * that may be rendered in the explanation.
 */
describe("nothing the scanned network chose reaches the tooltip", () => {
  test("rejected names and a hostile sysDescr leave the host unnamed, and out of the text", async () => {
    const HOSTILE: string = "<img src=x onerror=alert(1)>";
    const host: DiscoveredNetworkDevice = {
      ipAddress: "10.0.0.9",
      snmpReachable: true,
      sysDescr: `evil ${HOSTILE}`,
      dnsHostname: HOSTILE,
      netbiosName: HOSTILE,
      dnsHostnameStatus: DiscoveredHostReverseDnsStatus.UnusableName,
    };
    const scan: NetworkDeviceDiscoveryScan = reviewScan({
      hosts: [host],
      isSnmpEnabled: true,
      isNetbiosLookupEnabled: true,
    });

    await renderPage();
    await openReviewOf(scan);

    // Unnamed: every name it offered was rejected.
    expect(checkbox("10.0.0.9")).toHaveAttribute(
      "aria-label",
      "Import 10.0.0.9 (10.0.0.9)",
    );

    const text: string = await explanationShownFor("10.0.0.9");

    expect(text).toBe(
      expectedExplanation({ host: host, scan: scan, isGlobalProbe: undefined })
        .text,
    );
    expect(text).not.toContain("onerror");
    expect(text).not.toContain("<img");
    expect(text).not.toContain("evil");
    expect(text).toContain("not a valid hostname");
  });

  test("a code that is not one of ours is dropped, and the row falls back to what the scan supports", async () => {
    const host: DiscoveredNetworkDevice = {
      ipAddress: "10.0.0.10",
      snmpReachable: false,
    };
    // Written straight into the jsonb, past the type system.
    (host as unknown as Record<string, unknown>)["dnsHostnameStatus"] =
      "<b>call 555-0100</b>";
    (host as unknown as Record<string, unknown>)["netbiosNameStatus"] = 7;

    const scan: NetworkDeviceDiscoveryScan = reviewScan({
      hosts: [host],
      isSnmpEnabled: false,
      isNetbiosLookupEnabled: false,
    });

    await renderPage();
    await openReviewOf(scan);

    const text: string = await explanationShownFor("10.0.0.10");

    expect(text).toBe(
      [
        SNMP_NOT_CHECKED_SENTENCE,
        REVERSE_DNS_NOT_RECORDED_SENTENCE,
        NETBIOS_OFF_SENTENCE,
        ASK_THE_DEVICE_TIP,
      ].join(" "),
    );
    expect(text).not.toContain("555-0100");
    expect(text).not.toContain("<b>");
  });
});
