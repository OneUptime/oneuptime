import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { PROJECT_ID, goTo, setViewportWidth } from "./SideMenuHarness";

/*
 * VMware > All vCenters, drawn by the real page and the real ModelTable over
 * a project with two vCenters: one a probe collects, one the VMware Agent
 * sends. The maintainer asked for Collected By and Agent Version to leave the
 * list's default view; here a viewer opens the list, finds neither column,
 * switches both back on from Customize Columns, finds them there after
 * coming back, and puts the list back with Reset to default - on a laptop's
 * table and on a phone's cards.
 *
 * The column contract itself (which columns, which start hidden, what each
 * draws) is in VMwareVCentersListColumns.test.tsx.
 */

configure({ asyncUtilTimeout: 15000 });

jest.setTimeout(120000);

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

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      // A project owner: may read every column of the list.
      getAllPermissions: (): Array<unknown> => {
        return ["ProjectOwner"];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: ["Public", "User", "CurrentUser"] };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): { toString: () => string } => {
        return {
          toString: () => {
            return "80000000-0000-4000-8000-000000000001";
          },
        };
      },
      getName: (): string => {
        return "Test User";
      },
      getEmail: (): string => {
        return "test@example.com";
      },
    },
  };
});

import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import VMwareVCenter from "../../../Models/DatabaseModels/VMwareVCenter";
import Probe from "../../../Models/DatabaseModels/Probe";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../Types/JSON";
import VMwareCollectionMethod from "../../../Types/VMware/VMwareCollectionMethod";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import API from "../../../UI/Utils/API/API";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import UserPreferences, {
  UserPreferenceType,
} from "../../../Utils/UserPreferences";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import VCentersPage from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/VCenters";
import { VMWARE_AGENT_VERSION } from "../../../../App/FeatureSet/Dashboard/src/Components/AgentVersion/AgentKind";

type PageComponent = (props: PageComponentProps) => ReactElement | null;

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(`/dashboard/${PROJECT_ID}/vmware`),
  currentProject: null,
  hasPaymentMethod: true,
} as unknown as PageComponentProps;

// The key the list keeps a viewer's column layout under.
const LAYOUT_KEY: string = "vmware-vcenters-table";

const PROBE_VCENTER: string = "vcenter-lab";
const AGENT_VCENTER: string = "vcenter-prod";
const PROBE_NAME: string = "Lab Probe";
// Older than the collector the VMware Agent's files pin: the cell signs it.
const OUTDATED_AGENT_VERSION: string = "0.100.0";

const DEFAULT_HEADERS: Array<string> = [
  "Name",
  "Status",
  "Last Seen",
  "Labels",
  "Owners",
];

const ALL_HEADERS: Array<string> = [
  "Name",
  "Status",
  "Collected By",
  "Agent Version",
  "Last Seen",
  "Labels",
  "Owners",
];

function vcenters(): Array<BaseModel> {
  const probe: Probe = new Probe();
  probe.name = PROBE_NAME;

  const collectedByProbe: VMwareVCenter = new VMwareVCenter();
  collectedByProbe._id = "31000000-0000-4000-8000-000000000001";
  collectedByProbe.name = PROBE_VCENTER;
  collectedByProbe.otelCollectorStatus = "connected";
  collectedByProbe.collectionMethod = VMwareCollectionMethod.Probe;
  collectedByProbe.collectionProbe = probe;
  collectedByProbe.lastSeenAt = new Date();
  collectedByProbe.isArchived = false;

  const sentByAgent: VMwareVCenter = new VMwareVCenter();
  sentByAgent._id = "31000000-0000-4000-8000-000000000002";
  sentByAgent.name = AGENT_VCENTER;
  sentByAgent.otelCollectorStatus = "connected";
  sentByAgent.collectionMethod = VMwareCollectionMethod.Agent;
  sentByAgent.agentVersion = OUTDATED_AGENT_VERSION;
  sentByAgent.lastSeenAt = new Date();
  sentByAgent.isArchived = false;

  return [collectedByProbe, sentByAgent];
}

let listReads: number = 0;

beforeEach(() => {
  listReads = 0;
  PermissionGate.clearPermissionPropsCache();
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();
  setViewportWidth(1280);
  goTo(`/dashboard/${PROJECT_ID}/vmware`);

  jest
    .spyOn(ModelAPI, "count")
    .mockImplementation(
      async (options: {
        modelType: { new (): BaseModel };
      }): Promise<number> => {
        return options.modelType === VMwareVCenter ? 2 : 0;
      },
    );
  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(
      async (options: {
        modelType: { new (): BaseModel };
        skip?: number;
        limit?: number;
      }): Promise<ListResult<BaseModel>> => {
        const isTheList: boolean = options.modelType === VMwareVCenter;
        if (isTheList) {
          listReads++;
        }
        const data: Array<BaseModel> = isTheList ? vcenters() : [];
        return {
          data,
          count: data.length,
          skip: options.skip || 0,
          limit: options.limit || 10,
        } as ListResult<BaseModel>;
      },
    );
  jest.spyOn(ModelAPI, "getItem").mockResolvedValue(null as never);
  jest.spyOn(API, "get").mockResolvedValue({ data: {} } as never);
  jest.spyOn(API, "post").mockResolvedValue({ data: {} } as never);
});

afterEach(() => {
  cleanup();
  setViewportWidth(1024);
  jest.restoreAllMocks();
});

async function settle(): Promise<void> {
  for (let i: number = 0; i < 20; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderList(): Promise<void> {
  const Page: PageComponent = VCentersPage as unknown as PageComponent;

  await act(async () => {
    render(
      <MemoryRouter>
        <Page {...PAGE_PROPS} />
      </MemoryRouter>,
    );
  });
  await settle();

  // Both rows are drawn: the table, not its first run or a loader.
  await waitFor(() => {
    expect(screen.getAllByText(AGENT_VCENTER).length).toBeGreaterThan(0);
  });
}

// The table's column headers, less the select-all box and the actions cell.
function headers(): Array<string> {
  return screen
    .getAllByRole("columnheader")
    .filter((header: HTMLElement): boolean => {
      return header.querySelector('input[type="checkbox"]') === null;
    })
    .map((header: HTMLElement): string => {
      return (header.textContent || "").trim();
    })
    .filter((text: string): boolean => {
      return text.length > 0 && text !== "Actions";
    });
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(element);
  });
}

/*
 * The real way in: Customize Columns is an icon button in the card header,
 * folded into its "More options" menu as "Columns".
 */
async function openPicker(): Promise<HTMLElement> {
  await click(screen.getByRole("button", { name: "More options" }));
  await click(screen.getByText("Columns"));

  return await screen.findByTestId("column-customization-modal");
}

function toggle(columnId: string): HTMLInputElement {
  return screen.getByTestId(`column-toggle-${columnId}`) as HTMLInputElement;
}

async function savePicker(): Promise<void> {
  await click(screen.getByTestId("modal-footer-submit-button"));

  await waitFor(() => {
    expect(screen.queryByTestId("column-customization-modal")).toBeNull();
  });
}

function storedLayout(): JSONObject | null {
  return UserPreferences.getUserPreferenceByTypeAsJSON({
    key: LAYOUT_KEY,
    userPreferenceType: UserPreferenceType.BaseModelTableColumns,
  });
}

// What the two hidden columns would draw, were they on the page.
function expectNeitherColumnsCells(): void {
  expect(screen.queryByText(`Probe: ${PROBE_NAME}`)).toBeNull();
  expect(screen.queryByText("VMware Agent")).toBeNull();
  expect(screen.queryByText(OUTDATED_AGENT_VERSION)).toBeNull();
  expect(screen.queryByTestId("agent-version-outdated")).toBeNull();
}

describe("All vCenters on a laptop", () => {
  test("opens on Name, Status, Last Seen, Labels and Owners: no Collected By, no Agent Version", async () => {
    await renderList();

    expect(headers()).toEqual(DEFAULT_HEADERS);
    expectNeitherColumnsCells();
    // Nobody chose this: it is the list's own default.
    expect(storedLayout()).toBeNull();
  });

  test("Customize Columns lists both, switched off, among the columns that are on", async () => {
    await renderList();

    const picker: HTMLElement = await openPicker();

    expect(within(picker).getByText("Collected By")).toBeInTheDocument();
    expect(within(picker).getByText("Agent Version")).toBeInTheDocument();
    expect(toggle("collectionMethod").checked).toBe(false);
    expect(toggle("agentVersion").checked).toBe(false);

    for (const id of ["name", "otelCollectorStatus", "lastSeenAt", "labels"]) {
      expect(toggle(id).checked).toBe(true);
    }

    // Off, not gone: the picker offers no way to remove a column the list ships.
    expect(screen.queryByTestId("column-remove-collectionMethod")).toBeNull();
    expect(screen.queryByTestId("column-remove-agentVersion")).toBeNull();
    // The list is on its default, so there is nothing to reset.
    expect(screen.queryByTestId("column-customization-reset")).toBeNull();
  });

  test("switched on, both show after Status with what they always said, without reading the list again", async () => {
    await renderList();
    const reads: number = listReads;

    await openPicker();
    await click(toggle("collectionMethod"));
    await click(toggle("agentVersion"));
    await savePicker();

    await waitFor(() => {
      expect(headers()).toEqual(ALL_HEADERS);
    });

    // Collected By: the probe by name, and the agent.
    expect(screen.getByText(`Probe: ${PROBE_NAME}`)).toBeInTheDocument();
    expect(screen.getByText("VMware Agent")).toBeInTheDocument();

    // Agent Version: the agent's version, with the sign that opens the upgrade.
    const sign: HTMLElement = screen.getByTestId("agent-version-outdated");
    expect(sign).toHaveTextContent(OUTDATED_AGENT_VERSION);
    expect(sign.getAttribute("aria-label")).toContain(VMWARE_AGENT_VERSION);

    // Drawn from the rows already on the page.
    expect(listReads).toBe(reads);

    const layout: JSONObject | null = storedLayout();
    expect(layout).not.toBeNull();
    expect(layout!["order"]).toEqual(
      expect.arrayContaining(["collectionMethod", "agentVersion"]),
    );
    expect(layout!["hidden"]).toEqual([]);
  });

  test("a viewer who switched them on finds them there when they come back", async () => {
    await renderList();

    await openPicker();
    await click(toggle("agentVersion"));
    await savePicker();

    await waitFor(() => {
      expect(headers()).toContain("Agent Version");
    });

    cleanup();
    TableFilterUrlState.resetClaimedKeys();
    await renderList();

    expect(headers()).toEqual([
      "Name",
      "Status",
      "Agent Version",
      "Last Seen",
      "Labels",
      "Owners",
    ]);
    expect(screen.getByTestId("agent-version-outdated")).toBeInTheDocument();
    expect(screen.queryByText(`Probe: ${PROBE_NAME}`)).toBeNull();
  });

  test("Reset to default takes the list back to its five columns", async () => {
    await renderList();

    await openPicker();
    await click(toggle("collectionMethod"));
    await click(toggle("agentVersion"));
    await savePicker();

    await waitFor(() => {
      expect(headers()).toEqual(ALL_HEADERS);
    });

    await openPicker();
    await click(screen.getByTestId("column-customization-reset"));

    await waitFor(() => {
      expect(headers()).toEqual(DEFAULT_HEADERS);
    });
    expectNeitherColumnsCells();
    expect(storedLayout()).toBeNull();
  });

  /*
   * What changes for people who already arranged this list: a stored layout
   * is theirs. One saved while both columns shipped switched on names them,
   * so they stay; Reset to default brings the new list.
   */
  test("a layout saved before the change keeps both columns", async () => {
    UserPreferences.saveUserPreferenceByTypeAsJSON({
      key: LAYOUT_KEY,
      userPreferenceType: UserPreferenceType.BaseModelTableColumns,
      value: {
        order: [
          "name",
          "otelCollectorStatus",
          "collectionMethod",
          "agentVersion",
          "lastSeenAt",
          "labels",
          "_id",
        ],
        hidden: ["labels"],
      },
    });

    await renderList();

    expect(headers()).toEqual([
      "Name",
      "Status",
      "Collected By",
      "Agent Version",
      "Last Seen",
      "Owners",
    ]);
  });
});

/*
 * On a phone the table is a card per vCenter, a field per column. Neither
 * column is hideOnMobile, so the picker's switch works there too.
 */
describe("All vCenters on a phone", () => {
  // A card's field names, in order: the <dt>s of its <dl>.
  function cardFields(name: string): Array<string> {
    const card: HTMLElement | null =
      screen
        .getAllByText(name)
        .map((element: HTMLElement): HTMLElement | null => {
          return element.closest("dl");
        })
        .find((element: HTMLElement | null): boolean => {
          return element !== null;
        }) || null;

    expect(card).not.toBeNull();

    return Array.from(card!.querySelectorAll("dt")).map(
      (term: Element): string => {
        return (term.textContent || "").trim();
      },
    );
  }

  test("a card names the vCenter, its status and when it was last seen", async () => {
    setViewportWidth(375);
    await renderList();

    expect(cardFields(AGENT_VCENTER)).toEqual(["Name", "Status", "Last Seen"]);
    expectNeitherColumnsCells();
  });

  test("switched on from the picker, Collected By and Agent Version join the card", async () => {
    setViewportWidth(375);
    await renderList();

    await openPicker();
    await click(toggle("collectionMethod"));
    await click(toggle("agentVersion"));
    await savePicker();

    await waitFor(() => {
      expect(cardFields(AGENT_VCENTER)).toContain("Agent Version");
    });

    expect(cardFields(AGENT_VCENTER)).toEqual([
      "Name",
      "Status",
      "Collected By",
      "Agent Version",
      "Last Seen",
    ]);
    expect(screen.getByText("VMware Agent")).toBeInTheDocument();
    expect(screen.getByText(`Probe: ${PROBE_NAME}`)).toBeInTheDocument();
    expect(screen.getByTestId("agent-version-outdated")).toHaveTextContent(
      OUTDATED_AGENT_VERSION,
    );

    /*
     * A vCenter a probe collects has no agent version: its card leaves the
     * field out instead of naming it over nothing.
     */
    expect(cardFields(PROBE_VCENTER)).toEqual([
      "Name",
      "Status",
      "Collected By",
      "Last Seen",
    ]);
  });
});

describe("All vCenters on a laptop, a vCenter with no agent version", () => {
  test("its Agent Version cell is the quiet dash every empty cell has", async () => {
    await renderList();

    await openPicker();
    await click(toggle("agentVersion"));
    await savePicker();

    await waitFor(() => {
      expect(headers()).toContain("Agent Version");
    });

    const probeRow: HTMLElement | null = screen
      .getAllByText(PROBE_VCENTER)
      .map((element: HTMLElement): HTMLElement | null => {
        return element.closest("tr");
      })
      .find((row: HTMLElement | null): boolean => {
        return row !== null;
      }) as HTMLElement | null;

    expect(probeRow).not.toBeNull();

    // The row's cells, less the select box: Name, Status, Agent Version ...
    const cells: Array<HTMLElement> = Array.from(
      probeRow!.querySelectorAll("td"),
    ).filter((cellElement: HTMLElement): boolean => {
      return cellElement.querySelector('input[type="checkbox"]') === null;
    });
    const agentVersionCell: HTMLElement = cells[
      headers().indexOf("Agent Version")
    ] as HTMLElement;

    expect(
      within(agentVersionCell).getByTestId("table-empty-value"),
    ).toHaveTextContent("Not reported");
  });
});
