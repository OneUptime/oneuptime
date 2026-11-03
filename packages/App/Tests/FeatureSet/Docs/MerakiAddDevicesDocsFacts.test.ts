import { bold, boldIn, readRepoFile } from "./InventoryAndApiDocsSupport";
import { drawnDashboardLabel } from "./DocsDashboardLabels";
import { sectionInLanguage } from "./NetworkDocsLabels";
import {
  ADD_DEVICES_ACTION,
  DEVICE_KIND_NAMES,
} from "../../../FeatureSet/Dashboard/src/Components/NetworkTraffic/Meraki/MerakiAddDevicesWords";
import { getDefaultProbeId } from "../../../FeatureSet/Dashboard/src/Components/NetworkDevice/ProbeOptions";
import NetworkControllerConnection from "Common/Models/DatabaseModels/NetworkControllerConnection";
import Probe from "Common/Models/DatabaseModels/Probe";
import {
  ControllerDeviceAddVerdict,
  getControllerDeviceNameChoices,
  judgeControllerDevices,
  planControllerSites,
} from "Common/Server/Utils/NetworkController/NetworkControllerDeviceAdd";
import { NetworkControllerDevice } from "Common/Server/Utils/NetworkController/NetworkControllerTypes";
import {
  ADDABLE_CONTROLLER_PRODUCT_TYPES,
  DEFAULT_CONTROLLER_PRODUCT_TYPES_TO_ADD,
  DEFAULT_NETWORK_CONTROLLER_DEVICE_ADD_REQUEST,
  MAX_DEVICES_PER_CONTROLLER_DEVICE_ADD,
} from "Common/Types/NetworkController/NetworkControllerDeviceAdd";
import Permission from "Common/Types/Permission";
import { MORE_FIELDS_SECTION_TITLE } from "Common/UI/Components/FoldedSection/FoldedSectionTitles";
import { describe, expect, it } from "@jest/globals";

/*
 * What Network Traffic (Cisco Meraki without NetFlow) says about Add
 * devices - adding a Meraki organization's devices as network devices -
 * held to the code that makes it true: the kinds ticked by default, the
 * name, address, site and probe each device is added with, what is never
 * added and why, how many one ask adds, as whom, and who may ask. And every
 * translation names the Dashboard's labels as that language's Dashboard
 * draws them, in the lines the English has them.
 */

const NETWORK_TRAFFIC: string = "monitor/network-traffic";
const SECTION: string = "## Cisco Meraki without NetFlow";

const LANGUAGES: Array<string> = [
  "en",
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

const DASHBOARD_APP: string = "App/FeatureSet/Dashboard/src";
const CONNECTIONS_CARD: string = `${DASHBOARD_APP}/Components/NetworkTraffic/Meraki/MerakiConnectionsCard.tsx`;
const ADD_DEVICES_DIALOG: string = `${DASHBOARD_APP}/Components/NetworkTraffic/Meraki/MerakiAddDevicesModal.tsx`;
const DEVICE_ADD_RUNNER: string =
  "Common/Server/Utils/NetworkController/NetworkControllerDeviceAddRunner.ts";
const CONNECTION_API: string = "Common/Server/API/NetworkControllerConnectionAPI.ts";

// The section's paragraphs, in a language.
function paragraphs(language: string): Array<string> {
  return sectionInLanguage(language, NETWORK_TRAFFIC, SECTION)
    .split("\n")
    .filter((line: string): boolean => {
      return line.trim().length > 0;
    });
}

// The English paragraph that starts so.
function englishParagraph(start: string): string {
  const found: string | undefined = paragraphs("en").find(
    (line: string): boolean => {
      return line.startsWith(start);
    },
  );

  if (!found) {
    throw new Error(`The Meraki section has no paragraph starting "${start}"`);
  }

  return found;
}

const ADD_PARAGRAPH: string = `${bold("Add devices")} adds them`;
const NOTHING_TWICE_PARAGRAPH: string = "Nothing is added twice:";
const CONNECTIONS_PARAGRAPH: string = "The connections are listed";

function device(
  overrides: Partial<NetworkControllerDevice> = {},
): NetworkControllerDevice {
  return {
    serial: "Q2HP-SWCH-0001",
    name: "AP-1",
    model: "MR46",
    mac: "e0:55:3d:aa:00:01",
    lanIp: "10.66.0.20",
    firmware: "wireless-29-7",
    productType: "wireless",
    controllerNetworkId: "L_0660",
    networkName: "Store 0660",
    address: "",
    ...overrides,
  };
}

describe("Network Traffic: Add devices, held to the code", () => {
  it("names the button as the Dashboard draws it, beside the row's count and in the row's menu", () => {
    expect(ADD_DEVICES_ACTION).toBe("Add devices");
    expect(readRepoFile(CONNECTIONS_CARD)).toContain(
      'data-testid="meraki-connection-add-devices"',
    );
    expect(readRepoFile(CONNECTIONS_CARD)).toContain(
      'key="add-devices"',
    );

    const add: string = englishParagraph(ADD_PARAGRAPH);
    expect(add).toContain(
      `The connection's row says how many there are, with ${bold("Add devices")} beside them, and the row's menu has it too.`,
    );
    expect(englishParagraph(CONNECTIONS_PARAGRAPH)).toContain(
      `Its menu has ${bold("Edit")} (its name, how often to read the uplinks, a new key), ${bold("Add devices")}, ${bold("Turn off")} and ${bold("Delete")}.`,
    );
  });

  it("ticks the network gear and leaves cameras for whoever ticks them", () => {
    expect(DEFAULT_CONTROLLER_PRODUCT_TYPES_TO_ADD).not.toContain("camera");
    expect(DEFAULT_CONTROLLER_PRODUCT_TYPES_TO_ADD).toEqual(
      ADDABLE_CONTROLLER_PRODUCT_TYPES.filter((kind: string): boolean => {
        return kind !== "camera";
      }),
    );
    expect(DEVICE_KIND_NAMES["camera"]).toBe("Cameras");

    expect(englishParagraph(ADD_PARAGRAPH)).toContain(
      "Pick the kinds of device to add: the network gear is ticked, and cameras are added when you tick them.",
    );
  });

  it("adds each at its management address, under its Meraki name - its network after it when the name is taken", () => {
    expect(getControllerDeviceNameChoices(device())).toEqual([
      "AP-1",
      "AP-1 (Store 0660)",
      "AP-1 (Q2HP-SWCH-0001)",
    ]);
    expect(readRepoFile(DEVICE_ADD_RUNNER)).toContain(
      "buildNetworkDeviceFromController",
    );

    expect(englishParagraph(ADD_PARAGRAPH)).toContain(
      "Each device is added at the management address Meraki lists for it, under its Meraki name (with its network after it when another device already has that name), with its role, and with Meraki's details already filled in.",
    );
  });

  it("puts each in the site named after its Meraki network by default - the project's own, or a new one - under More fields", () => {
    expect(DEFAULT_NETWORK_CONTROLLER_DEVICE_ADD_REQUEST.groupBySite).toBe(true);
    expect(MORE_FIELDS_SECTION_TITLE).toBe("More fields");
    expect(readRepoFile(ADD_DEVICES_DIALOG)).toContain(
      "title={MORE_FIELDS_SECTION_TITLE}",
    );

    const existing: ReturnType<typeof planControllerSites> = planControllerSites(
      {
        devices: [device(), device({ serial: "Q2", networkName: "Store 0101" })],
        existingSiteNames: new Set<string>(["store 0660"]),
      },
    );
    expect(existing.sitesToCreate).toEqual([
      { name: "Store 0101", address: "" },
    ]);

    expect(englishParagraph(ADD_PARAGRAPH)).toContain(
      `Under ${bold("More fields")}, each device goes into the site named after its Meraki network, the project's site of that name or a new one,`,
    );
  });

  it("is polled by the project's probe when it has exactly one, and by none otherwise", () => {
    const own: (id: string) => Probe = (id: string): Probe => {
      const probe: Probe = new Probe();
      probe._id = id;
      probe.isGlobalProbe = false;
      return probe;
    };

    expect(getDefaultProbeId([own("30000000-0000-4000-8000-000000000001")])).toBe(
      "30000000-0000-4000-8000-000000000001",
    );
    expect(
      getDefaultProbeId([
        own("30000000-0000-4000-8000-000000000001"),
        own("30000000-0000-4000-8000-000000000002"),
      ]),
    ).toBe("");
    expect(readRepoFile(ADD_DEVICES_DIALOG)).toContain("getDefaultProbeId(");

    expect(englishParagraph(ADD_PARAGRAPH)).toContain(
      "and is polled by the project's probe when it has exactly one: pick another probe, or none.",
    );
  });

  it("never adds a box twice, nor one someone archived, nor one with no address; and says so", () => {
    const verdicts: Map<string, ControllerDeviceAddVerdict> =
      judgeControllerDevices({
        devices: [
          device({ serial: "S-1", lanIp: "10.0.0.1", mac: "aa:bb:cc:00:00:01" }),
          device({ serial: "S-2", lanIp: "10.0.0.2", mac: "aa:bb:cc:00:00:02" }),
          device({ serial: "S-3", lanIp: "10.0.0.3", mac: "aa:bb:cc:00:00:03" }),
          device({
            serial: "S-4",
            lanIp: "",
            mac: "aa:bb:cc:00:00:04",
            productType: "appliance",
          }),
        ],
        matches: new Map(),
        holders: [
          { hostname: "10.0.0.1" },
          { macAddress: "aa:bb:cc:00:00:02" },
          { serialNumber: "S-3", isArchived: true },
        ],
      });

    expect(Array.from(verdicts.values())).toEqual([
      ControllerDeviceAddVerdict.Taken,
      ControllerDeviceAddVerdict.Taken,
      ControllerDeviceAddVerdict.Archived,
      ControllerDeviceAddVerdict.WithoutAddress,
    ]);

    const nothingTwice: string = englishParagraph(NOTHING_TWICE_PARAGRAPH);
    expect(nothingTwice).toContain(
      "a device whose serial number, MAC address or address another network device here already has is left out, and so is one you archived.",
    );
    expect(nothingTwice).toContain(
      "A security appliance (MX or Z) lists no address in Meraki, so add it by hand at the address your probe reaches it at, and Meraki fills in the rest.",
    );
    expect(nothingTwice).toContain("The dialog says how many it leaves out, and why.");
  });

  it("adds them on the server, as the person who asked, up to 5,000 at a time, and keeps a deleted device deleted", () => {
    expect(MAX_DEVICES_PER_CONTROLLER_DEVICE_ADD).toBe(5000);

    const runner: string = readRepoFile(DEVICE_ADD_RUNNER);
    expect(runner).toContain("WorkspaceActionAuthorization.getProjectMemberProps");
    // Once per ask: nothing in a read adds a device.
    expect(
      readRepoFile(
        "Common/Server/Utils/NetworkController/NetworkControllerReadRunner.ts",
      ),
    ).not.toContain("NetworkDeviceService.create");

    const nothingTwice: string = englishParagraph(NOTHING_TWICE_PARAGRAPH);
    expect(nothingTwice).toContain(
      "The devices are added on the server, as you, up to 5,000 at a time",
    );
    expect(nothingTwice).toContain(
      "A device Meraki gets later is counted on the row again, and a device you delete stays deleted.",
    );
  });

  it("is for project owners and admins, as reading a connection is", () => {
    const update: Array<Permission> =
      new NetworkControllerConnection().getUpdatePermissions();

    expect(update.sort()).toEqual(
      [Permission.ProjectOwner, Permission.ProjectAdmin].sort(),
    );
    expect(readRepoFile(CONNECTION_API)).toContain(
      "`${basePath}/:connectionId/add-devices`",
    );

    expect(englishParagraph(NOTHING_TWICE_PARAGRAPH)).toContain(
      "Like reading a connection, adding its devices is for project owners and admins.",
    );
  });
});

describe("Network Traffic: Add devices, in every language", () => {
  it.each(LANGUAGES)(
    "%s names Add devices and More fields as its Dashboard draws them, in the English lines",
    (language: string) => {
      const english: Array<string> = paragraphs("en");
      const translated: Array<string> = paragraphs(language);
      const addIndex: number = english.findIndex((line: string): boolean => {
        return line.startsWith(ADD_PARAGRAPH);
      });
      const connectionsIndex: number = english.findIndex(
        (line: string): boolean => {
          return line.startsWith(CONNECTIONS_PARAGRAPH);
        },
      );

      expect(translated).toHaveLength(english.length);

      const addDevices: string = drawnDashboardLabel(language, "Add devices");
      const moreFields: string = drawnDashboardLabel(language, "More fields");

      expect(boldIn(translated[addIndex] as string)).toEqual([
        addDevices,
        addDevices,
        moreFields,
      ]);
      // The paragraph after it names no label.
      expect(boldIn(translated[addIndex + 1] as string)).toEqual([]);
      expect(boldIn(translated[connectionsIndex] as string)).toContain(
        addDevices,
      );
    },
  );
});
