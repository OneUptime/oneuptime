import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { Mock } from "jest-mock";
import * as React from "react";

/*
 * DELETE EMPTY SITES, ANSWERED BY THE SERVER ITSELF (#10188).
 *
 * An add of a Meraki organization's devices on 16.0.0 added a site for each
 * of its 700 networks before it could add a device, then added none. Here
 * the Sites page's Delete Empty Sites runs against the server's own routes
 * (NetworkEmptySitesAPI) over HTTP - its permission checks, the services'
 * hooks, the error handler - with the tables in memory
 * (DashboardRequestsOverHttp):
 *
 *   - it lists the project's empty sites, names the first ten, counts the
 *     rest, and deletes exactly those once the person confirms - and says
 *     so in a toast;
 *   - a site with anything in it or naming it is never listed nor
 *     deleted: a device (archived too), a site under it, an endpoint, a
 *     link, a site assignment rule, a naming rule, a maintenance event not
 *     over;
 *   - a site that got a device after it was listed is kept, and counted;
 *   - nothing empty: it says so, with Close only;
 *   - who may not delete sites is refused by the server, in words.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      getLogLevel: jest.fn().mockReturnValue("INFO"),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import DeleteEmptySitesModal from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkSite/DeleteEmptySitesModal";
import { EMPTY_SITE_NAMES_SHOWN } from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkSite/DeleteEmptySitesWords";
import CommonAPI from "../../../Server/API/CommonAPI";
import NetworkEmptySitesAPI, {
  DELETE_EMPTY_SITES_NOT_PERMITTED,
} from "../../../Server/API/NetworkEmptySitesAPI";
import AuditLogService from "../../../Server/Services/AuditLogService";
import NetworkDeviceNamingRuleService from "../../../Server/Services/NetworkDeviceNamingRuleService";
import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import NetworkEndpointService from "../../../Server/Services/NetworkEndpointService";
import NetworkSiteAssignmentRuleService from "../../../Server/Services/NetworkSiteAssignmentRuleService";
import NetworkSiteLinkService from "../../../Server/Services/NetworkSiteLinkService";
import NetworkSiteService from "../../../Server/Services/NetworkSiteService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import Toast, { ToastItem } from "../../../UI/Utils/Toast";
import { customDomainCaller } from "../../Server/API/CustomDomainCallers";
import DashboardRequestsOverHttp, {
  SentRequest,
} from "../../Server/TestingUtils/DashboardRequestsOverHttp";
import InMemoryLocks from "../../Server/TestingUtils/InMemoryLocks";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryHookFreeWrites,
  useInMemoryTable,
} from "../../Server/TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../../Server/TestingUtils/ProjectDirectory";
import { ON_HIGHEST_PLAN } from "../../Server/TestingUtils/RequestPlan";
import { everyServerProductIsOn } from "../../Server/TestingUtils/ServerProductsOn";

const PROJECT_ID: ObjectID = new ObjectID(
  "10188000-0000-4000-8000-000000000101",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "10188000-0000-4000-8000-000000000102",
);

const WAIT: { timeout: number } = { timeout: 15000 };

// The sites the Meraki add left: 700 stores, by name.
const STORE_COUNT: number = 700;

function siteId(index: number): string {
  return `10188000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function storeName(index: number): string {
  return `Store ${String(index).padStart(4, "0")}`;
}

// The stores something is in or names, and what.
const IN_USE: Record<number, string> = {
  1: "a device",
  2: "an archived device",
  3: "a site under it",
  4: "an endpoint",
  5: "a link from it",
  6: "a link to it",
  7: "a site assignment rule",
  8: "a naming rule",
  9: "a maintenance event that is not over",
};

let server: DashboardRequestsOverHttp;
let sites: InMemoryTable;
let devices: InMemoryTable;
let caller: DatabaseCommonInteractionProps;

function siteRows(): Array<StoredRow> {
  const rows: Array<StoredRow> = [];

  for (let index: number = 1; index <= STORE_COUNT; index++) {
    rows.push({
      _id: siteId(index),
      projectId: PROJECT_ID.toString(),
      name: storeName(index),
      slug: `store-${index}`,
      depth: 0,
      materializedPath: `/${siteId(index)}/`,
      address: `${index} Main Street, Springfield`,
    });
  }

  // Under Store 0003: a site of its own, with a device in it.
  rows.push({
    _id: siteId(900),
    projectId: PROJECT_ID.toString(),
    name: "Store 0003 Annex",
    parentSiteId: siteId(3),
    depth: 1,
    materializedPath: `/${siteId(3)}/${siteId(900)}/`,
  });

  // Another project's empty site: never this project's to list.
  rows.push({
    _id: siteId(901),
    projectId: OTHER_PROJECT_ID.toString(),
    name: "Elsewhere",
    depth: 0,
    materializedPath: `/${siteId(901)}/`,
  });

  return rows;
}

function asCaller(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

interface Rendered {
  onClose: Mock<() => void>;
  onDeleted: Mock<(count: number) => void>;
}

function renderDialog(): Rendered {
  const onClose: Mock<() => void> = jest.fn();
  const onDeleted: Mock<(count: number) => void> = jest.fn();

  render(
    <DeleteEmptySitesModal
      onClose={onClose as never}
      onDeleted={onDeleted as never}
    />,
  );

  return { onClose, onDeleted };
}

function dialog(): HTMLElement {
  return screen.getByTestId("modal");
}

async function listed(): Promise<void> {
  await waitFor(() => {
    expect(
      screen.queryByTestId("delete-empty-sites-question") ||
        screen.queryByTestId("delete-empty-sites-none"),
    ).not.toBeNull();
  }, WAIT);
}

function shownNames(): Array<string> {
  return within(dialog())
    .queryAllByTestId("delete-confirmation-item")
    .map((item: HTMLElement): string => {
      return item.textContent || "";
    });
}

function storeIdsLeft(): Array<string> {
  return sites.rows
    .filter((row: StoredRow): boolean => {
      return String(row["projectId"]) === PROJECT_ID.toString();
    })
    .map((row: StoredRow): string => {
      return String(row["_id"]);
    });
}

beforeAll(async () => {
  server = new DashboardRequestsOverHttp();
  await server.start([NetworkEmptySitesAPI]);
});

afterAll(async () => {
  await server.stop();
});

beforeEach(() => {
  server.requests.length = 0;
  Toast.dismissAll();

  caller = asCaller([Permission.ProjectAdmin]);

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return caller;
    });

  PermissionGate.clearPermissionPropsCache();
  jest
    .spyOn(PermissionUtil, "getAllPermissions")
    .mockReturnValue([Permission.ProjectAdmin]);
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
  jest.spyOn(AuditLogService, "recordDelete").mockResolvedValue(undefined);

  everyServerProductIsOn();
  stubProjectDirectory({});
  new InMemoryLocks().install();

  sites = useInMemoryTable(NetworkSiteService, siteRows());
  useInMemoryHookFreeWrites(NetworkSiteService, sites);

  devices = useInMemoryTable(NetworkDeviceService, [
    {
      _id: "10188000-0000-4000-8000-0000000d0001",
      projectId: PROJECT_ID.toString(),
      name: "Core",
      hostname: "10.0.1.2",
      siteId: siteId(1),
    },
    {
      _id: "10188000-0000-4000-8000-0000000d0002",
      projectId: PROJECT_ID.toString(),
      name: "Retired",
      hostname: "10.0.2.2",
      siteId: siteId(2),
      isArchived: true,
    },
    {
      _id: "10188000-0000-4000-8000-0000000d0003",
      projectId: PROJECT_ID.toString(),
      name: "Annex switch",
      hostname: "10.0.3.2",
      siteId: siteId(900),
    },
  ]);

  useInMemoryTable(NetworkEndpointService, [
    {
      _id: "10188000-0000-4000-8000-0000000e0001",
      projectId: PROJECT_ID.toString(),
      siteId: siteId(4),
    },
  ]);
  useInMemoryTable(NetworkSiteLinkService, [
    {
      _id: "10188000-0000-4000-8000-0000000f0001",
      projectId: PROJECT_ID.toString(),
      fromSiteId: siteId(5),
      toSiteId: siteId(1),
    },
    {
      _id: "10188000-0000-4000-8000-0000000f0002",
      projectId: PROJECT_ID.toString(),
      fromSiteId: siteId(1),
      toSiteId: siteId(6),
    },
  ]);
  useInMemoryTable(NetworkSiteAssignmentRuleService, [
    {
      _id: "10188000-0000-4000-8000-0000000a0001",
      projectId: PROJECT_ID.toString(),
      siteId: siteId(7),
    },
  ]);
  useInMemoryTable(NetworkDeviceNamingRuleService, [
    {
      _id: "10188000-0000-4000-8000-0000000b0001",
      projectId: PROJECT_ID.toString(),
      sites: [{ _id: siteId(8) }],
    },
  ]);
  useInMemoryTable(ScheduledMaintenanceService, [
    {
      _id: "10188000-0000-4000-8000-0000000c0001",
      projectId: PROJECT_ID.toString(),
      endsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      networkSites: [{ _id: siteId(9) }],
    },
    // Over: what it covered is history, and names no site's future.
    {
      _id: "10188000-0000-4000-8000-0000000c0002",
      projectId: PROJECT_ID.toString(),
      endsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      networkSites: [{ _id: siteId(10) }],
    },
  ]);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

const EMPTY_COUNT: number = STORE_COUNT - Object.keys(IN_USE).length;

describe("Delete Empty Sites, through the server", () => {
  test("lists the empty sites, names the first ten, and deletes exactly them once confirmed", async () => {
    const rendered: Rendered = renderDialog();

    await listed();

    expect(
      within(dialog()).getByText(`Delete ${EMPTY_COUNT} Empty Sites`),
    ).toBeInTheDocument();
    expect(screen.getByTestId("delete-empty-sites-question").textContent).toBe(
      `Are you sure you want to delete ${EMPTY_COUNT} empty sites? This action cannot be undone.`,
    );

    // By name: the first ten, and how many more.
    expect(shownNames()).toEqual(
      Array.from(
        { length: EMPTY_SITE_NAMES_SHOWN },
        (_: unknown, index: number): string => {
          return storeName(index + 10);
        },
      ),
    );
    expect(
      within(dialog()).getByTestId("delete-confirmation-more-items")
        .textContent,
    ).toBe(`and ${EMPTY_COUNT - EMPTY_SITE_NAMES_SHOWN} more`);

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(dialog()).getByRole("button", {
          name: `Delete ${EMPTY_COUNT} Sites`,
        }),
      );
    });

    await waitFor(() => {
      expect(rendered.onDeleted).toHaveBeenCalledWith(EMPTY_COUNT);
    }, WAIT);
    expect(rendered.onClose).toHaveBeenCalled();

    // What is left: each store something is in or names, and the annex.
    expect(storeIdsLeft().sort()).toEqual(
      [
        ...Object.keys(IN_USE).map((index: string): string => {
          return siteId(Number(index));
        }),
        siteId(900),
      ].sort(),
    );
    // Another project's site is never touched.
    expect(sites.get(siteId(901))).toBeDefined();
    // No device lost its site.
    expect(
      devices.rows.map((row: StoredRow): string => {
        return String(row["siteId"]);
      }),
    ).toEqual([siteId(1), siteId(2), siteId(900)]);

    // Said in a toast, as every delete is.
    const toasts: ReadonlyArray<ToastItem> = Toast.getToasts();
    expect(
      toasts.map((toast: ToastItem): string => {
        return toast.title;
      }),
    ).toEqual([`${EMPTY_COUNT} empty sites deleted`]);

    // Exactly what was listed went to the server.
    const deletes: Array<SentRequest> = server.sentTo(
      "POST",
      "/api/network-site/delete-empty-sites",
    );
    expect(deletes).toHaveLength(1);
    expect(
      ((deletes[0]!.body as JSONObject)["siteIds"] as Array<string>).length,
    ).toBe(EMPTY_COUNT);
    expect(deletes[0]!.answer).toEqual({
      deletedCount: EMPTY_COUNT,
      keptCount: 0,
    });
  });

  test("each kind of thing that keeps a site keeps it out of the list", async () => {
    const answer: SentRequest = await server.request(
      "POST",
      "/api/network-site/empty-sites",
      {},
    );

    expect(answer.status).toBe(200);

    const ids: Set<string> = new Set<string>(
      ((answer.answer as JSONObject)["sites"] as Array<JSONObject>).map(
        (site: JSONObject): string => {
          return String(site["id"]);
        },
      ),
    );

    expect(ids.size).toBe(EMPTY_COUNT);

    for (const [index, why] of Object.entries(IN_USE)) {
      expect([why, ids.has(siteId(Number(index)))]).toEqual([why, false]);
    }

    // A maintenance event that is over does not keep its site.
    expect(ids.has(siteId(10))).toBe(true);
    // A site with a site under it is kept; the annex has a device of its own.
    expect(ids.has(siteId(900))).toBe(false);
    expect(ids.has(siteId(901))).toBe(false);
  });

  test("a site that got a device after it was listed is kept, and the toast says so", async () => {
    renderDialog();

    await listed();

    // Someone adds a device to Store 0010 while the dialog is open.
    devices.rows.push({
      _id: "10188000-0000-4000-8000-0000000d0010",
      projectId: PROJECT_ID.toString(),
      name: "New switch",
      hostname: "10.0.10.2",
      siteId: siteId(10),
    });

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(dialog()).getByRole("button", {
          name: `Delete ${EMPTY_COUNT} Sites`,
        }),
      );
    });

    await waitFor(() => {
      expect(Toast.getToasts()).toHaveLength(1);
    }, WAIT);

    const toast: ToastItem = Toast.getToasts()[0]!;
    expect(toast.title).toBe(`${EMPTY_COUNT - 1} empty sites deleted`);
    expect(toast.description).toBe(
      "1 site was kept: it is not empty any more.",
    );
    expect(sites.get(siteId(10))).toBeDefined();
  });

  test("nothing empty: it says so, with Close only", async () => {
    sites.rows = sites.rows.filter((row: StoredRow): boolean => {
      const index: number = Number(String(row["_id"]).slice(-12));
      return index in IN_USE || index >= 900;
    });

    renderDialog();

    await listed();

    expect(screen.getByTestId("delete-empty-sites-none").textContent).toBe(
      "No site is empty. Every site has devices or sites under it, or an endpoint, link, rule or maintenance event uses it.",
    );
    expect(
      within(dialog())
        .getAllByRole("button")
        .map((button: HTMLElement): string => {
          return button.textContent || "";
        })
        .filter(Boolean),
    ).toEqual(["Close"]);
  });

  test("who may not delete sites is refused by the server, in words, and nothing is deleted", async () => {
    // May read and add sites, not delete them.
    caller = asCaller([
      Permission.ReadNetworkSite,
      Permission.CreateNetworkSite,
    ]);

    const answer: SentRequest = await server.request(
      "POST",
      "/api/network-site/delete-empty-sites",
      { siteIds: [siteId(20), siteId(21)] },
    );

    expect(answer.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(answer.answer)).toContain(
      DELETE_EMPTY_SITES_NOT_PERMITTED,
    );
    expect(sites.get(siteId(20))).toBeDefined();
    expect(sites.deletes).toEqual([]);
  });

  test("a delete names site ids, and nothing else: the server refuses one that does not", async () => {
    const none: SentRequest = await server.request(
      "POST",
      "/api/network-site/delete-empty-sites",
      { siteIds: [] },
    );
    const notIds: SentRequest = await server.request(
      "POST",
      "/api/network-site/delete-empty-sites",
      { siteIds: ["Store 0020"] },
    );

    expect(none.status).toBe(400);
    expect(notIds.status).toBe(400);
    expect(sites.deletes).toEqual([]);
  });

  test("a site of another project named in a delete is never deleted", async () => {
    const answer: SentRequest = await server.request(
      "POST",
      "/api/network-site/delete-empty-sites",
      { siteIds: [siteId(901), siteId(20)] },
    );

    expect(answer.status).toBe(200);
    expect(answer.answer).toEqual({ deletedCount: 1, keptCount: 1 });
    expect(sites.get(siteId(901))).toBeDefined();
    expect(sites.get(siteId(20))).toBeUndefined();
  });
});
