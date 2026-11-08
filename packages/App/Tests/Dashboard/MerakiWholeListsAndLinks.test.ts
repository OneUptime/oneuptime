/*
 * The requests are built from the dashboard's APP_API_URL, which reads the
 * browser's window; the node environment has none, so it is given here.
 * The network itself is never reached: API.post is a mock.
 */
jest.mock("Common/UI/Config", () => {
  const { default: URLType } = jest.requireActual("Common/Types/API/URL") as {
    default: { fromString: (url: string) => unknown };
  };

  return {
    __esModule: true,
    APP_API_URL: URLType.fromString("https://oneuptime.example.com/api"),
  };
});

jest.mock("Common/UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: jest.fn(),
      getFriendlyMessage: (error: { message?: string }): string => {
        return error.message || "Request failed";
      },
    },
  };
});

jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "10000000-0000-4000-8000-000000000001" };
      },
    },
  };
});

import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  NETWORK_TRAFFIC_LINK_APPLIANCE_PATH,
  NETWORK_TRAFFIC_UNLINK_APPLIANCE_PATH,
  NETWORK_TRAFFIC_USAGE_APPLIANCES_PATH,
  NETWORK_TRAFFIC_USAGE_LIST_PATH,
  fetchLinkableAppliances,
  fetchNetworkTrafficUsageList,
  linkMerakiAppliance,
  parseLinkableApplianceList,
  parseNetworkTrafficUsageDeviceAppliance,
  parseNetworkTrafficUsageListResult,
  parseNetworkTrafficUsageSummary,
  unlinkMerakiAppliance,
} from "../../FeatureSet/Dashboard/src/Components/NetworkTraffic/NetworkTrafficUsageApi";
import { TrafficSide } from "../../FeatureSet/Dashboard/src/Components/NetworkTraffic/Meraki/MerakiUrlState";
import {
  getTrafficSideStorageKey,
  readRememberedTrafficSide,
  rememberTrafficSide,
} from "../../FeatureSet/Dashboard/src/Components/NetworkTraffic/Meraki/TrafficSideMemory";
import {
  ALL_APPLIANCES_HEADING,
  APPLIANCE_LINKED_TO_ANOTHER_DEVICE,
  APPLIANCE_LINKED_TO_DEVICE,
  LIKELY_APPLIANCES_HEADING,
  LINKED_TO_APPLIANCE,
  LINKED_WAITING_BODY,
  LINK_APPLIANCE_ACTION,
  LINK_DIALOG_DESCRIPTION,
  LINK_SEARCH_PLACEHOLDER,
  LINK_SUBMIT,
  LIST_SORT_LABEL,
  LIST_SORT_WORDS,
  MERAKI_LIST_WORDS,
  MORE_APPLIANCES,
  MerakiLinkTemplate,
  NO_APPLIANCE_MATCHES,
  NO_LINKABLE_APPLIANCES,
  UNLINKED_DEVICE_BODY,
  UNLINKED_DEVICE_DESCRIPTION,
  UNLINKED_DEVICE_TITLE,
  UNLINK_ACTION,
  UNLINK_DESCRIPTION,
  UNLINK_TITLE,
  VIEW_ALL_LABELS,
  getLikenessWords,
  isApplianceLinkable,
} from "../../FeatureSet/Dashboard/src/Components/NetworkTraffic/Meraki/MerakiLinkWords";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import {
  NETWORK_TRAFFIC_USAGE_LIST_KINDS,
  NETWORK_TRAFFIC_USAGE_LIST_SORTS,
  NetworkTrafficUsageApplianceLinkStatus,
  NetworkTrafficUsageListKind,
  NetworkTrafficUsageListResult,
  NetworkTrafficUsageListSort,
  NetworkTrafficUsageSummary,
} from "Common/Types/NetFlow/NetworkTrafficUsage";
import {
  NetworkControllerLinkableAppliance,
  NetworkControllerLinkableApplianceList,
} from "Common/Types/NetworkController/NetworkControllerApplianceLink";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/UI/Utils/API/API";
import {
  Translator,
  createTranslator,
} from "Common/UI/Utils/TranslateTemplate";
import { NameLikenessReason } from "Common/Utils/NetworkDevice/DeviceNameLikeness";

/*
 * Issue #5762 as plain logic (App's node tests cannot render React; the
 * rendered page is in Common/Tests/App/Dashboard): the side a reader picked,
 * remembered in this browser; a page of a whole list and the appliance
 * link, asked of the server and read back without trusting their shapes;
 * and every new word a key of the English locale.
 */

const postMock: jest.Mock = API.post as unknown as jest.Mock;
const PROJECT: string = "10000000-0000-4000-8000-000000000001";
const ROUTER: string = "40000000-0000-4000-8000-000000000002";
const OTHER: string = "40000000-0000-4000-8000-000000000003";

afterEach(() => {
  postMock.mockReset();
});

describe("the side a reader picked, remembered in this browser", () => {
  let stored: Map<string, string>;
  let failing: boolean;

  beforeEach(() => {
    stored = new Map();
    failing = false;

    (globalThis as unknown as { localStorage: unknown }).localStorage = {
      getItem: (key: string): string | null => {
        if (failing) {
          throw new Error("The site's data is blocked");
        }

        return stored.has(key) ? stored.get(key)! : null;
      },
      setItem: (key: string, value: string): void => {
        if (failing) {
          throw new Error("The site's data is blocked");
        }

        stored.set(key, String(value));
      },
      removeItem: (key: string): void => {
        stored.delete(key);
      },
    };
  });

  afterEach(() => {
    delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
  });

  test("per project and per kind of page: a router's page and the network's can differ", () => {
    rememberTrafficSide(PROJECT, "network", TrafficSide.Meraki);
    rememberTrafficSide(PROJECT, "device", TrafficSide.Flows);

    expect(readRememberedTrafficSide(PROJECT, "network")).toBe(
      TrafficSide.Meraki,
    );
    expect(readRememberedTrafficSide(PROJECT, "device")).toBe(
      TrafficSide.Flows,
    );
    expect(readRememberedTrafficSide(PROJECT, "site")).toBeNull();
    expect(
      readRememberedTrafficSide(
        "10000000-0000-4000-8000-000000000009",
        "network",
      ),
    ).toBeNull();
  });

  test("the key names the project and the kind of page", () => {
    expect(getTrafficSideStorageKey(PROJECT, "site")).toBe(
      `network-traffic-side-${PROJECT}-site`,
    );
  });

  test("the last pick wins", () => {
    rememberTrafficSide(PROJECT, "network", TrafficSide.Meraki);
    rememberTrafficSide(PROJECT, "network", TrafficSide.Flows);

    expect(readRememberedTrafficSide(PROJECT, "network")).toBe(
      TrafficSide.Flows,
    );
  });

  test("anything else stored reads as no choice: the page picks for itself", () => {
    stored.set(getTrafficSideStorageKey(PROJECT, "network"), "sideways");
    expect(readRememberedTrafficSide(PROJECT, "network")).toBeNull();

    stored.set(getTrafficSideStorageKey(PROJECT, "network"), '{"a":1}');
    expect(readRememberedTrafficSide(PROJECT, "network")).toBeNull();
  });

  test("blocked site data, or no project: no choice read, none kept - never a broken page", () => {
    failing = true;

    expect(() => {
      rememberTrafficSide(PROJECT, "network", TrafficSide.Meraki);
    }).not.toThrow();
    expect(readRememberedTrafficSide(PROJECT, "network")).toBeNull();

    failing = false;
    rememberTrafficSide(undefined, "network", TrafficSide.Meraki);
    expect(stored.size).toBe(0);
    expect(readRememberedTrafficSide(null, "network")).toBeNull();
  });

  test("a browser without storage at all: no choice", () => {
    delete (globalThis as unknown as { localStorage?: unknown }).localStorage;

    expect(readRememberedTrafficSide(PROJECT, "network")).toBeNull();
    expect(() => {
      rememberTrafficSide(PROJECT, "network", TrafficSide.Flows);
    }).not.toThrow();
  });
});

describe("the summary's new parts, read without trusting their shape", () => {
  test("how many networks, applications and clients the lists have; garbage is none", () => {
    const summary: NetworkTrafficUsageSummary = parseNetworkTrafficUsageSummary(
      {
        isAvailable: true,
        networkCount: 1205,
        applicationCount: "347",
        clientCount: -3,
      },
    );

    expect(summary.networkCount).toBe(1205);
    expect(summary.applicationCount).toBe(347);
    expect(summary.clientCount).toBe(0);
    expect(parseNetworkTrafficUsageSummary(undefined).networkCount).toBe(0);
  });

  test("the appliance a device is: linked, with what names it", () => {
    expect(
      parseNetworkTrafficUsageDeviceAppliance({
        status: "linked",
        serial: "Q2PN-LDS0-0012",
        name: "LDS MX68",
        controllerNetworkName: "Branch 012",
        isLinkedBySerialNumber: true,
      }),
    ).toEqual({
      status: NetworkTrafficUsageApplianceLinkStatus.Linked,
      serial: "Q2PN-LDS0-0012",
      name: "LDS MX68",
      controllerNetworkName: "Branch 012",
      isLinkedBySerialNumber: true,
    });
  });

  test("not linked says only that, whatever else came with it", () => {
    expect(
      parseNetworkTrafficUsageDeviceAppliance({
        status: "unlinked",
        serial: "Q2PN-LDS0-0012",
      }),
    ).toEqual({ status: NetworkTrafficUsageApplianceLinkStatus.Unlinked });
  });

  test.each([[undefined], [null], ["linked"], [[]], [{ status: "maybe" }]])(
    "%p is no appliance: no Meraki side, never one it is not",
    (value: unknown) => {
      expect(parseNetworkTrafficUsageDeviceAppliance(value)).toBeUndefined();
    },
  );

  test("a linked appliance whose Unlink flag is not true cannot be unlinked", () => {
    expect(
      parseNetworkTrafficUsageDeviceAppliance({
        status: "linked",
        isLinkedBySerialNumber: "yes",
      })?.isLinkedBySerialNumber,
    ).toBe(false);
  });

  test("the summary carries it, or nothing", () => {
    expect(
      parseNetworkTrafficUsageSummary({
        deviceAppliance: { status: "unlinked" },
      }).deviceAppliance,
    ).toEqual({ status: NetworkTrafficUsageApplianceLinkStatus.Unlinked });
    expect(
      "deviceAppliance" in
        parseNetworkTrafficUsageSummary({ isAvailable: true }),
    ).toBe(false);
  });
});

describe("a page of a whole list", () => {
  test("asked of usage-list with the page's request, which list, the search, the sort and the page", async () => {
    postMock.mockResolvedValueOnce({
      data: {
        list: "networks",
        count: 523,
        networks: [
          {
            controllerNetworkId: "L_1",
            name: "Store 001",
            sentOctets: 10,
            receivedOctets: 20,
          },
        ],
      },
    });

    const result: NetworkTrafficUsageListResult =
      await fetchNetworkTrafficUsageList({
        networkSiteId: "50000000-0000-4000-8000-000000000001",
        startTime: "2026-10-24T11:00:00.000Z",
        endTime: "2026-10-24T12:00:00.000Z",
        filters: { interfaceName: "wan2" },
        list: NetworkTrafficUsageListKind.Networks,
        search: "store",
        sortBy: NetworkTrafficUsageListSort.Out,
        skip: 25,
        limit: 25,
      });

    const sent: { url: { toString: () => string }; data: JSONObject } = postMock
      .mock.calls[0]![0] as never;

    expect(new URL(sent.url.toString()).pathname).toBe(
      `/api${NETWORK_TRAFFIC_USAGE_LIST_PATH}`,
    );
    expect(sent.data).toMatchObject({
      list: "networks",
      search: "store",
      sortBy: "out",
      skip: 25,
      limit: 25,
      filters: { interfaceName: "wan2" },
    });
    expect(result.count).toBe(523);
    expect(result.networks).toHaveLength(1);
  });

  test("a list the dashboard does not know is never asked for", async () => {
    await expect(
      fetchNetworkTrafficUsageList({
        startTime: "2026-10-24T11:00:00.000Z",
        endTime: "2026-10-24T12:00:00.000Z",
        list: "uplinks" as NetworkTrafficUsageListKind,
      }),
    ).rejects.toThrow("Unknown list: uplinks");
    expect(postMock).not.toHaveBeenCalled();
  });

  test("a refusal is thrown, for the dialog to say", async () => {
    postMock.mockResolvedValueOnce(
      new HTTPErrorResponse(504, { message: "Too slow" }, {}),
    );

    await expect(
      fetchNetworkTrafficUsageList({
        startTime: "2026-10-24T11:00:00.000Z",
        endTime: "2026-10-24T12:00:00.000Z",
        list: NetworkTrafficUsageListKind.Clients,
      }),
    ).rejects.toBeInstanceOf(HTTPErrorResponse);
  });

  test("rows of another kind are none of the list's own, and garbage rows are rows of nothing", () => {
    const result: NetworkTrafficUsageListResult =
      parseNetworkTrafficUsageListResult(
        {
          count: "2",
          networks: [{ controllerNetworkId: "L_1", name: "Store" }],
          clients: [
            {
              clientKey: "k1",
              name: "POS 3",
              ip: "10.0.0.3",
              sentOctets: "5",
              receivedOctets: "nan",
            },
            "garbage",
            null,
          ],
        },
        NetworkTrafficUsageListKind.Clients,
      );

    expect(result.list).toBe(NetworkTrafficUsageListKind.Clients);
    expect(result.count).toBe(2);
    expect(result.networks).toEqual([]);
    expect(result.clients).toEqual([
      {
        clientKey: "k1",
        name: "POS 3",
        ip: "10.0.0.3",
        mac: "",
        manufacturer: "",
        controllerNetworkName: "",
        sentOctets: 5,
        receivedOctets: 0,
      },
    ]);
    expect(
      parseNetworkTrafficUsageListResult(
        undefined,
        NetworkTrafficUsageListKind.Applications,
      ),
    ).toEqual({
      list: NetworkTrafficUsageListKind.Applications,
      count: 0,
      networks: [],
      applications: [],
      clients: [],
    });
  });
});

describe("linking a device to its appliance", () => {
  test("the appliances: asked for the device with the search, read back without trusting them", async () => {
    postMock.mockResolvedValueOnce({
      data: {
        appliances: [
          {
            serial: "Q2PN-LDS0-0012",
            name: "LDS MX68",
            controllerNetworkId: "L_12",
            controllerNetworkName: "Branch 012",
            connectionName: "Acme Networks",
            lastSeenAt: "2026-10-24T11:55:00.000Z",
            octets: "1234",
            isLikely: true,
            likenessReason: "number",
            likenessShared: "12",
          },
          {
            serial: "Q2PN-BRS0-0047",
            name: "BRS MX68",
            linkedDeviceId: OTHER,
            linkedDeviceName: "Bristol router",
            isLikely: "yes",
            likenessReason: "astrology",
          },
          { name: "no serial at all" },
          "garbage",
        ],
        total: 4,
        matching: "4",
      },
    });

    const list: NetworkControllerLinkableApplianceList =
      await fetchLinkableAppliances({
        networkDeviceId: new ObjectID(ROUTER),
        search: "lds",
      });

    const sent: { url: { toString: () => string }; data: JSONObject } = postMock
      .mock.calls[0]![0] as never;

    expect(new URL(sent.url.toString()).pathname).toBe(
      `/api${NETWORK_TRAFFIC_USAGE_APPLIANCES_PATH}`,
    );
    expect(sent.data).toEqual({ networkDeviceId: ROUTER, search: "lds" });
    expect(list.total).toBe(4);
    expect(list.matching).toBe(4);
    expect(list.appliances).toHaveLength(2);
    expect(list.appliances[0]).toEqual({
      serial: "Q2PN-LDS0-0012",
      name: "LDS MX68",
      controllerNetworkId: "L_12",
      controllerNetworkName: "Branch 012",
      connectionName: "Acme Networks",
      lastSeenAt: "2026-10-24T11:55:00.000Z",
      octets: 1234,
      isLikely: true,
      likenessReason: NameLikenessReason.Number,
      likenessShared: "12",
    });
    // A flag that is not true is false; a reason no rule has is none.
    expect(list.appliances[1]!.isLikely).toBe(false);
    expect(list.appliances[1]!.likenessReason).toBeUndefined();
    expect(list.appliances[1]!.linkedDeviceId).toBe(OTHER);
  });

  test("a linked device that is no ID is no device", () => {
    expect(
      parseLinkableApplianceList({
        appliances: [{ serial: "Q2-1", linkedDeviceId: "device-1" }],
      }).appliances[0]!.linkedDeviceId,
    ).toBeUndefined();
  });

  test("a link and an unlink are posted for the device; a refusal is thrown for the dialog to say", async () => {
    postMock.mockResolvedValueOnce({
      data: { deviceSerial: "Q2PN-LDS0-0012" },
    });
    await linkMerakiAppliance({
      networkDeviceId: new ObjectID(ROUTER),
      deviceSerial: "Q2PN-LDS0-0012",
    });

    let sent: { url: { toString: () => string }; data: JSONObject } = postMock
      .mock.calls[0]![0] as never;
    expect(new URL(sent.url.toString()).pathname).toBe(
      `/api${NETWORK_TRAFFIC_LINK_APPLIANCE_PATH}`,
    );
    expect(sent.data).toEqual({
      networkDeviceId: ROUTER,
      deviceSerial: "Q2PN-LDS0-0012",
    });

    postMock.mockResolvedValueOnce({ data: {} });
    await unlinkMerakiAppliance(new ObjectID(ROUTER));

    sent = postMock.mock.calls[1]![0] as never;
    expect(new URL(sent.url.toString()).pathname).toBe(
      `/api${NETWORK_TRAFFIC_UNLINK_APPLIANCE_PATH}`,
    );
    expect(sent.data).toEqual({ networkDeviceId: ROUTER });

    postMock.mockResolvedValueOnce(
      new HTTPErrorResponse(
        400,
        {
          message:
            "This appliance is linked to Bristol router already. Unlink it there first.",
        },
        {},
      ),
    );
    await expect(
      linkMerakiAppliance({
        networkDeviceId: new ObjectID(ROUTER),
        deviceSerial: "Q2PN-BRS0-0047",
      }),
    ).rejects.toBeInstanceOf(HTTPErrorResponse);
  });
});

describe("what the new parts say", () => {
  const ENGLISH: Translator = createTranslator(undefined, "en");

  function appliance(
    overrides: Partial<NetworkControllerLinkableAppliance> = {},
  ): NetworkControllerLinkableAppliance {
    return {
      serial: "Q2PN-LDS0-0012",
      name: "LDS MX68",
      controllerNetworkId: "L_12",
      controllerNetworkName: "Branch 012",
      connectionName: "Acme Networks",
      lastSeenAt: "2026-10-24T11:55:00.000Z",
      octets: 1,
      isLikely: true,
      ...overrides,
    };
  }

  function say(words: MerakiLinkTemplate | null): string | null {
    return words
      ? ENGLISH.translateTemplate(words.template, words.values)
      : null;
  }

  test("why an appliance is offered first, rule by rule", () => {
    expect(
      say(
        getLikenessWords(
          appliance({ likenessReason: NameLikenessReason.SerialNumber }),
        ),
      ),
    ).toBe("Same serial number");
    expect(
      say(
        getLikenessWords(
          appliance({ likenessReason: NameLikenessReason.Name }),
        ),
      ),
    ).toBe("Same name");
    expect(
      say(
        getLikenessWords(
          appliance({ likenessReason: NameLikenessReason.NameWithin }),
        ),
      ),
    ).toBe("Similar name");
    expect(
      say(
        getLikenessWords(
          appliance({
            likenessReason: NameLikenessReason.Number,
            likenessShared: "2207",
          }),
        ),
      ),
    ).toBe("Both names have 2207");
    expect(
      getLikenessWords(
        appliance({ likenessReason: NameLikenessReason.Number }),
      ),
    ).toBeNull();
    expect(getLikenessWords(appliance())).toBeNull();
  });

  test("one appliance is one device: another device's cannot be picked, the device's own can", () => {
    expect(isApplianceLinkable(appliance(), ROUTER)).toBe(true);
    expect(
      isApplianceLinkable(
        appliance({ linkedDeviceId: ROUTER.toUpperCase() }),
        ROUTER,
      ),
    ).toBe(true);
    expect(
      isApplianceLinkable(appliance({ linkedDeviceId: OTHER }), ROUTER),
    ).toBe(false);
  });

  test("View all says how many, in English as in every language", () => {
    expect(
      ENGLISH.translatePlural(
        VIEW_ALL_LABELS[NetworkTrafficUsageListKind.Networks],
        523,
      ),
    ).toBe("View all 523 networks");
    expect(
      ENGLISH.translatePlural(
        VIEW_ALL_LABELS[NetworkTrafficUsageListKind.Clients],
        8644,
      ),
    ).toBe("View all 8,644 clients");
  });

  test("an empty dialog says how far back it looked, and what reports traffic", () => {
    expect(say(NO_LINKABLE_APPLIANCES)).toBe(
      "No Meraki appliance reported traffic in the last 7 days. Meraki reports the traffic of its MX and Z appliances.",
    );
  });

  describe("every word is a key of the English locale", () => {
    const english: Record<string, string> = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "../../FeatureSet/Dashboard/src/Locales/en.json"),
        "utf8",
      ),
    );

    function expectKey(key: string): void {
      expect(Object.prototype.hasOwnProperty.call(english, key)).toBe(true);
    }

    test("the lists' words, every list's", () => {
      for (const list of NETWORK_TRAFFIC_USAGE_LIST_KINDS) {
        const words: (typeof MERAKI_LIST_WORDS)[NetworkTrafficUsageListKind] =
          MERAKI_LIST_WORDS[list];

        for (const key of [
          words.title,
          words.description,
          words.searchPlaceholder,
          words.empty,
          words.noMatch,
          words.singular,
          words.plural,
        ]) {
          expectKey(key);
        }

        // A plural is keyed by its "other" form, its "one" form under `<other>_one`.
        expectKey(VIEW_ALL_LABELS[list].other);
        expect(english[`${VIEW_ALL_LABELS[list].other}_one`]).toBe(
          VIEW_ALL_LABELS[list].one,
        );
      }

      for (const sort of NETWORK_TRAFFIC_USAGE_LIST_SORTS) {
        expectKey(LIST_SORT_WORDS[sort]);
      }

      expectKey(LIST_SORT_LABEL);
    });

    test("the link's words", () => {
      for (const key of [
        LINK_APPLIANCE_ACTION,
        UNLINKED_DEVICE_TITLE,
        UNLINKED_DEVICE_BODY,
        UNLINKED_DEVICE_DESCRIPTION,
        LINKED_TO_APPLIANCE,
        LINKED_WAITING_BODY,
        UNLINK_ACTION,
        UNLINK_TITLE,
        UNLINK_DESCRIPTION,
        LINK_DIALOG_DESCRIPTION,
        LINK_SEARCH_PLACEHOLDER,
        LIKELY_APPLIANCES_HEADING,
        ALL_APPLIANCES_HEADING,
        LINK_SUBMIT,
        NO_APPLIANCE_MATCHES,
        NO_LINKABLE_APPLIANCES.template,
        MORE_APPLIANCES,
        APPLIANCE_LINKED_TO_DEVICE,
        APPLIANCE_LINKED_TO_ANOTHER_DEVICE,
      ]) {
        expectKey(key);
      }

      for (const reason of Object.values(NameLikenessReason)) {
        const words: MerakiLinkTemplate | null = getLikenessWords({
          serial: "Q2-1",
          name: "",
          controllerNetworkId: "",
          controllerNetworkName: "",
          connectionName: "",
          lastSeenAt: "",
          octets: 0,
          isLikely: true,
          likenessReason: reason,
          likenessShared: "12",
        });

        expectKey(words!.template);
      }
    });
  });
});
