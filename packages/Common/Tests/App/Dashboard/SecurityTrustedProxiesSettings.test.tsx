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
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import SecurityEventsConnectionsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/Connections";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import {
  TRUSTED_PROXIES_CARD_KEY,
  countTrustedProxies,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityTrustedProxiesCard";
import {
  ACCESS_LOGS_DESCRIPTION,
  ACCESS_LOGS_OFF,
  ACCESS_LOGS_ON,
  ACCESS_LOGS_SWITCH_TITLE,
  ACCESS_LOGS_TITLE,
  ALWAYS_TRUSTED_DESCRIPTION,
  ALWAYS_TRUSTED_TITLE,
  CONNECTIONS_MORE_SETTINGS_DESCRIPTION,
  NEVER_TRUSTED_DESCRIPTION,
  NEVER_TRUSTED_TITLE,
  OWN_LOAD_BALANCERS_MORE,
  OWN_LOAD_BALANCERS_NONE,
  OWN_LOAD_BALANCERS_NOT_TRUSTED,
  OWN_LOAD_BALANCERS_OFF,
  OWN_LOAD_BALANCERS_ON,
  OWN_LOAD_BALANCERS_TITLE,
  OWN_LOAD_BALANCERS_UNREAD,
  TRUSTED_AUTOMATICALLY_DESCRIPTION,
  TRUSTED_AUTOMATICALLY_TITLE,
  TRUSTED_PROXIES_DESCRIPTION,
  TRUSTED_PROXIES_TEST_IDS,
  TRUSTED_PROXIES_TITLE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityTrustedProxiesCopy";
import { TRUSTED_AUTOMATICALLY_CARD_KEY } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/TrustedProxies/SecurityTrustedAutomaticallyCard";
import { ACCESS_LOGS_CARD_KEY } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/TrustedProxies/SecurityAccessLogsCard";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "../../../Models/DatabaseModels/Project";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  ALWAYS_TRUSTED_PROXY_RANGES,
  AUTOMATIC_TRUSTED_PROXIES_PATH,
  AutomaticTrustedProxies,
  automaticTrustedProxiesToJSON,
} from "../../../Types/SecurityEvent/AutomaticTrustedProxies";
import {
  FOLDED_SECTION_OFF,
  FOLDED_SECTION_ON,
} from "../../../UI/Components/FoldedSection/FoldedSectionItem";
import {
  OWN_LOAD_BALANCER_PRODUCT_NAMES,
  OwnLoadBalancerKind,
} from "../../../Utils/SecurityEvent/OwnLoadBalancers";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import User from "../../../UI/Utils/User";
import { PROJECT_ID, goTo } from "./SideMenuHarness";
import {
  listedNames,
  setChips,
} from "../../UI/Components/FoldedSection/FoldedSectionQueries";

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

// The page's other cards read APIs of their own; each is drawn as its frame.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityLogsSourceCard",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return React.createElement("div", { "data-testid": "logs-source" });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityTelemetrySourcesCard",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return React.createElement("div", {
          "data-testid": "telemetry-sources",
        });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventConnectionsTable",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return React.createElement("div", {
          "data-testid": "security-tools",
        });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventDestinationsTable",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return React.createElement("div", { "data-testid": "siem" });
      },
    };
  },
);

/*
 * Security Events > Connections' More settings (#10416): Trusted Proxies,
 * the proxies the project's apps sit behind, whose forwarded client address
 * the scans trust. Rendered for real - the page, its fold and the card in
 * it - with the network and the permission snapshot stubbed, and the page's
 * other cards drawn as frames:
 *
 *   - More settings comes last, folded every time the page opens, naming
 *     Trusted Proxies, with a chip of how many are listed once any are;
 *   - a link that names the card after the page's "#" opens it there
 *     (MoreSettingsFoldsGuard holds every fold to this);
 *   - a Project Owner or Admin edits the list, and the form refuses what
 *     the server would - a line that is no address or range - before it is
 *     sent; anyone else sees Edit locked.
 *
 * Beside it (#10546, #10548), two switches that save when flipped, each
 * named on the fold while it is away from where a project starts:
 *
 *   - Trusted Automatically: the project's own application load balancers,
 *     listed as the server finds them, trusted unless the switch is off;
 *     the private addresses every project trusts; each edge it connected;
 *     and what is never trusted automatically. A list that could not be
 *     read, that is empty, or that is cut short says so, and the rest is
 *     said all the same;
 *   - Access Logs: whether the project's access logs end with
 *     X-Forwarded-For, off unless turned on.
 *
 * A Project Owner, a Project Admin or a Security Admin flips them; anyone
 * else sees them locked.
 */

configure({ asyncUtilTimeout: 15000 });

const PAGE_PATH: string = `/dashboard/${PROJECT_ID}/security-events/connections`;

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(PAGE_PATH),
  currentProject: null,
  hasPaymentMethod: true,
};

const BASE_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectUser,
];

// The project's Trusted Proxies as the server holds them.
let stored: string | null = null;
let updates: Array<JSONObject> = [];

// The two switches as the server holds them: undefined for never set.
let trustsOwnLoadBalancers: boolean | undefined = undefined;
let readsAccessLogForwardedFor: boolean | undefined = undefined;
let switchSaves: Array<JSONObject> = [];

// What the server answers when asked what it trusts automatically.
const FOUND: AutomaticTrustedProxies = {
  edges: [{ name: "Cloudflare", rangeCount: 22 }],
  loadBalancers: [
    {
      kind: OwnLoadBalancerKind.AwsApplicationLoadBalancer,
      name: "shop-alb",
      where: "Production AWS",
      addresses: ["203.0.113.10", "203.0.113.11"],
    },
    {
      kind: OwnLoadBalancerKind.AzureApplicationGateway,
      name: "web-gateway",
      where: "Azure Subscription",
      addresses: ["2001:db8::20"],
    },
  ],
  areLoadBalancersRead: true,
  areLoadBalancersComplete: true,
};

let automaticAnswer: JSONObject | HTTPErrorResponse =
  automaticTrustedProxiesToJSON(FOUND);
let automaticAsks: number = 0;

function grant(permissions: Array<Permission>): void {
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
  jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue(permissions);
  jest.spyOn(PermissionUtil, "getGlobalPermissions").mockReturnValue(null);
  jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue({
    projectId: new ObjectID(PROJECT_ID),
    userId: ObjectID.generate(),
    permissions: permissions.map((permission: Permission) => {
      return {
        permission: permission,
        labelIds: [],
        _type: "UserPermission",
      };
    }),
    _type: "UserTenantAccessPermission",
  } as unknown as ReturnType<typeof PermissionUtil.getProjectPermissions>);
}

function projectOf(): Project {
  const project: Project = new Project();

  project._id = PROJECT_ID;

  if (stored) {
    project.securityTrustedProxies = stored;
  }

  if (trustsOwnLoadBalancers !== undefined) {
    project.securityTrustOwnLoadBalancers = trustsOwnLoadBalancers;
  }

  if (readsAccessLogForwardedFor !== undefined) {
    project.securityReadAccessLogForwardedFor = readsAccessLogForwardedFor;
  }

  return project;
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  PermissionGate.clearPermissionPropsCache();
  grant([...BASE_PERMISSIONS, Permission.ProjectOwner]);
  stored = null;
  updates = [];
  trustsOwnLoadBalancers = undefined;
  readsAccessLogForwardedFor = undefined;
  switchSaves = [];
  automaticAnswer = automaticTrustedProxiesToJSON(FOUND);
  automaticAsks = 0;

  jest
    .spyOn(ModelAPI, "getItem")
    .mockImplementation(async (): Promise<BaseModel | null> => {
      return projectOf();
    });

  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(async (): Promise<ListResult<BaseModel>> => {
      return { data: [], count: 0, skip: 0, limit: 10 };
    });

  // The edit form saves through createOrUpdate, handing it the project as edited.
  jest.spyOn(ModelAPI, "createOrUpdate").mockImplementation((async (args: {
    model: Project;
  }): Promise<never> => {
    const change: JSONObject = {
      securityTrustedProxies: args.model.securityTrustedProxies ?? null,
    };

    updates.push(change);

    if (typeof change["securityTrustedProxies"] === "string") {
      stored = change["securityTrustedProxies"] as string;
    }

    return { data: args.model } as never;
  }) as never);

  // A switch saves the one column it holds, the moment it is flipped.
  jest.spyOn(ModelAPI, "updateById").mockImplementation((async (args: {
    data: JSONObject;
  }): Promise<never> => {
    switchSaves.push(args.data);

    if (typeof args.data["securityTrustOwnLoadBalancers"] === "boolean") {
      trustsOwnLoadBalancers = args.data["securityTrustOwnLoadBalancers"];
    }

    if (typeof args.data["securityReadAccessLogForwardedFor"] === "boolean") {
      readsAccessLogForwardedFor =
        args.data["securityReadAccessLogForwardedFor"];
    }

    return {} as never;
  }) as never);

  jest.spyOn(API, "get").mockImplementation(async (): Promise<never> => {
    return new HTTPResponse<JSONObject>(200, {}, {}) as unknown as never;
  });
  jest.spyOn(API, "post").mockImplementation((async (args: {
    url: { toString: () => string };
  }): Promise<never> => {
    if (args.url.toString().endsWith(AUTOMATIC_TRUSTED_PROXIES_PATH)) {
      automaticAsks += 1;

      if (automaticAnswer instanceof HTTPErrorResponse) {
        return automaticAnswer as unknown as never;
      }

      return new HTTPResponse<JSONObject>(
        200,
        automaticAnswer,
        {},
      ) as unknown as never;
    }

    return new HTTPResponse<JSONObject>(200, {}, {}) as unknown as never;
  }) as never);
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "#");
  jest.restoreAllMocks();
});

async function settle(): Promise<void> {
  await act(async (): Promise<void> => {
    for (let i: number = 0; i < 6; i++) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    }
  });
}

// The page opened at its address, and `#hash` after it when given.
async function renderPage(hash?: string): Promise<HTMLElement> {
  goTo(PAGE_PATH);

  if (hash) {
    window.history.replaceState(null, "", `#${hash}`);
  }

  render(
    <MemoryRouter initialEntries={[`${PAGE_PATH}${hash ? `#${hash}` : ""}`]}>
      <SecurityEventsConnectionsPage {...PAGE_PROPS} />
    </MemoryRouter>,
  );

  const fold: HTMLElement = await screen.findByTestId(
    TRUSTED_PROXIES_TEST_IDS.fold,
  );

  await settle();

  return fold;
}

function header(fold: HTMLElement): HTMLElement {
  return within(fold).getByTestId("folded-section-header");
}

function open(fold: HTMLElement): void {
  if (header(fold).getAttribute("aria-expanded") !== "true") {
    fireEvent.click(header(fold));
  }
}

function card(): HTMLElement {
  return screen.getByTestId(TRUSTED_PROXIES_TEST_IDS.card);
}

function editButton(): HTMLButtonElement {
  return within(card())
    .getByText("Edit")
    .closest("button") as HTMLButtonElement;
}

async function openDialog(fold: HTMLElement): Promise<HTMLElement> {
  open(fold);
  await within(card()).findByText("Edit");
  fireEvent.click(editButton());

  return await screen.findByRole("dialog");
}

// The form loads the project before it draws the field.
async function typeList(dialog: HTMLElement, value: string): Promise<void> {
  const input: HTMLElement = await within(dialog).findByRole("textbox");

  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

function submit(dialog: HTMLElement): void {
  fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));
}

function isBefore(first: HTMLElement, second: HTMLElement): boolean {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

/*
 * Trusted Automatically's card, and its switch once the project is read.
 * A card in More settings, by the place its title gives it.
 */
function cardAt(key: string): HTMLElement {
  const place: HTMLElement | null = document.getElementById(key);

  expect(place).not.toBeNull();

  return place!;
}

function automaticCard(): HTMLElement {
  return cardAt(TRUSTED_AUTOMATICALLY_CARD_KEY);
}

// Folded again, its header names what is set.
function closeFold(section: HTMLElement): void {
  if (header(section).getAttribute("aria-expanded") === "true") {
    fireEvent.click(header(section));
  }
}

async function ownLoadBalancersSwitch(): Promise<HTMLElement> {
  return await screen.findByTestId(
    TRUSTED_PROXIES_TEST_IDS.ownLoadBalancersSwitch,
  );
}

// Access Logs' card, and its switch once the project is read.
function accessLogsCard(): HTMLElement {
  return cardAt(ACCESS_LOGS_CARD_KEY);
}

async function accessLogsSwitch(): Promise<HTMLElement> {
  return await screen.findByTestId(TRUSTED_PROXIES_TEST_IDS.accessLogsSwitch);
}

// The project's own load balancers, as listed under the switch.
async function loadBalancerRows(): Promise<Array<HTMLElement>> {
  return await screen.findAllByTestId(
    `${TRUSTED_PROXIES_TEST_IDS.ownLoadBalancers}-row`,
  );
}

function ownLoadBalancers(): HTMLElement {
  return screen.getByTestId(TRUSTED_PROXIES_TEST_IDS.ownLoadBalancers);
}

describe("Security Events > Connections: More settings", () => {
  test("comes last, folded, naming its three settings and what they are for", async () => {
    const fold: HTMLElement = await renderPage();

    for (const testId of [
      "logs-source",
      "telemetry-sources",
      "security-tools",
      "siem",
    ]) {
      expect(isBefore(screen.getByTestId(testId), fold)).toBe(true);
    }

    expect(header(fold)).toHaveAttribute("aria-expanded", "false");
    expect(within(fold).getByTestId("folded-section-body")).toHaveClass(
      "invisible",
    );
    expect(listedNames(fold)).toEqual([
      TRUSTED_PROXIES_TITLE,
      TRUSTED_AUTOMATICALLY_TITLE,
      ACCESS_LOGS_TITLE,
    ]);
    // Where a project starts: nothing listed, its load balancers trusted, its logs read as they are.
    await ownLoadBalancersSwitch();
    await accessLogsSwitch();
    expect(setChips(fold)).toEqual([]);

    // What it is for, under its title once it is open.
    open(fold);
    expect(header(fold)).toHaveAttribute("aria-expanded", "true");
    expect(fold).toHaveTextContent(CONNECTIONS_MORE_SETTINGS_DESCRIPTION);
  });

  test("shows how many proxies are trusted, once any are", async () => {
    stored = "203.0.113.0/24\n198.51.100.7\n10.0.0.0/8";

    const fold: HTMLElement = await renderPage();

    await waitFor(() => {
      expect(setChips(fold)).toEqual([`${TRUSTED_PROXIES_TITLE}: 3`]);
    });
    expect(header(fold)).toHaveAttribute("aria-expanded", "false");
  });

  test("names a switch while it is away from where a project starts", async () => {
    trustsOwnLoadBalancers = false;
    readsAccessLogForwardedFor = true;

    const fold: HTMLElement = await renderPage();

    await waitFor(() => {
      expect(setChips(fold)).toEqual([
        `${TRUSTED_AUTOMATICALLY_TITLE}: ${FOLDED_SECTION_OFF}`,
        `${ACCESS_LOGS_TITLE}: ${FOLDED_SECTION_ON}`,
      ]);
    });
    expect(header(fold)).toHaveAttribute("aria-expanded", "false");
  });

  test.each([
    [TRUSTED_PROXIES_CARD_KEY, TRUSTED_PROXIES_DESCRIPTION],
    [TRUSTED_AUTOMATICALLY_CARD_KEY, TRUSTED_AUTOMATICALLY_DESCRIPTION],
    [ACCESS_LOGS_CARD_KEY, ACCESS_LOGS_DESCRIPTION],
  ])(
    "opened at #%s, it opens there, at the card",
    async (key: string, description: string) => {
      const fold: HTMLElement = await renderPage(key);

      expect(header(fold)).toHaveAttribute("aria-expanded", "true");

      const place: HTMLElement | null = document.getElementById(key);

      expect(Boolean(place && fold.contains(place))).toBe(true);
      expect(place).toHaveTextContent(description);
    },
  );

  test("opened anywhere else, it stays folded", async () => {
    const fold: HTMLElement = await renderPage("send-to-your-siem");

    expect(header(fold)).toHaveAttribute("aria-expanded", "false");
  });
});

describe("Trusted Proxies", () => {
  test("a Project Owner saves a list of addresses and ranges", async () => {
    const fold: HTMLElement = await renderPage();
    const dialog: HTMLElement = await openDialog(fold);

    await typeList(dialog, "203.0.113.0/24\n198.51.100.7");
    submit(dialog);

    await waitFor(() => {
      expect(updates).toEqual([
        expect.objectContaining({
          securityTrustedProxies: "203.0.113.0/24\n198.51.100.7",
        }),
      ]);
    });
  });

  test("a line that is no address or range is refused before it is sent, naming it", async () => {
    const fold: HTMLElement = await renderPage();
    const dialog: HTMLElement = await openDialog(fold);

    await typeList(dialog, "203.0.113.0/24\ncloudflare");
    submit(dialog);

    expect(
      await within(dialog).findByText(
        "cloudflare is not an IP address or a range. Write an address, such as 203.0.113.7, or a range, such as 203.0.113.0/24.",
      ),
    ).toBeInTheDocument();

    await settle();
    expect(updates).toEqual([]);
  });

  test("anyone who may not change it sees Edit locked", async () => {
    grant([...BASE_PERMISSIONS, Permission.ProjectMember]);

    const fold: HTMLElement = await renderPage(TRUSTED_PROXIES_CARD_KEY);

    expect(header(fold)).toHaveAttribute("aria-expanded", "true");
    await within(card()).findByText("Edit");
    expect(editButton()).toBeDisabled();
  });

  test("counts what a saved list holds, each address or range once", () => {
    expect(countTrustedProxies(undefined)).toBe(0);
    expect(countTrustedProxies("")).toBe(0);
    expect(
      countTrustedProxies("203.0.113.0/24, 203.0.113.0/24\n198.51.100.7"),
    ).toBe(2);
  });
});

describe("Trusted Automatically", () => {
  test("lists your load balancers under the switch: addresses, name, kind and cloud account", async () => {
    const fold: HTMLElement = await renderPage(TRUSTED_AUTOMATICALLY_CARD_KEY);
    const control: HTMLElement = await ownLoadBalancersSwitch();

    expect(fold.contains(automaticCard())).toBe(true);
    expect(automaticCard()).toHaveTextContent(TRUSTED_AUTOMATICALLY_TITLE);
    expect(automaticCard()).toHaveTextContent(
      TRUSTED_AUTOMATICALLY_DESCRIPTION,
    );

    // A project that never set it trusts them, as the column's default says.
    expect(control).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: OWN_LOAD_BALANCERS_TITLE })).toBe(
      control,
    );
    expect(automaticCard()).toHaveTextContent(OWN_LOAD_BALANCERS_ON);

    const rows: Array<HTMLElement> = await loadBalancerRows();

    expect(
      rows.map((row: HTMLElement): string => {
        return row.textContent || "";
      }),
    ).toEqual([
      expect.stringContaining("203.0.113.10, 203.0.113.11"),
      expect.stringContaining("2001:db8::20"),
    ]);
    expect(rows[0]).toHaveTextContent("shop-alb");
    expect(rows[0]).toHaveTextContent(
      OWN_LOAD_BALANCER_PRODUCT_NAMES[
        OwnLoadBalancerKind.AwsApplicationLoadBalancer
      ],
    );
    expect(rows[0]).toHaveTextContent("Production AWS");
    expect(rows[1]).toHaveTextContent("web-gateway");
    expect(rows[1]).toHaveTextContent(
      OWN_LOAD_BALANCER_PRODUCT_NAMES[
        OwnLoadBalancerKind.AzureApplicationGateway
      ],
    );
    expect(rows[1]).toHaveTextContent("Azure Subscription");

    // Trusted: nothing says otherwise.
    expect(ownLoadBalancers()).not.toHaveTextContent(
      OWN_LOAD_BALANCERS_NOT_TRUSTED,
    );
    expect(ownLoadBalancers()).not.toHaveTextContent(OWN_LOAD_BALANCERS_MORE);
  });

  test("says what every project trusts, each edge you connected, and what is never trusted", async () => {
    await renderPage(TRUSTED_AUTOMATICALLY_CARD_KEY);
    await loadBalancerRows();

    const always: HTMLElement = screen.getByTestId(
      TRUSTED_PROXIES_TEST_IDS.alwaysTrusted,
    );

    expect(always).toHaveTextContent(ALWAYS_TRUSTED_TITLE);
    expect(always).toHaveTextContent(ALWAYS_TRUSTED_DESCRIPTION);
    for (const range of ALWAYS_TRUSTED_PROXY_RANGES) {
      expect(within(always).getByText(range)).toBeInTheDocument();
    }

    const edges: Array<HTMLElement> = screen.getAllByTestId(
      TRUSTED_PROXIES_TEST_IDS.edges,
    );

    expect(edges).toHaveLength(1);
    expect(edges[0]).toHaveTextContent("Cloudflare");
    expect(edges[0]).toHaveTextContent(
      "Because you connected it: its 22 published ranges.",
    );

    const never: HTMLElement = screen.getByTestId(
      TRUSTED_PROXIES_TEST_IDS.neverTrusted,
    );

    expect(never).toHaveTextContent(NEVER_TRUSTED_TITLE);
    expect(never).toHaveTextContent(NEVER_TRUSTED_DESCRIPTION);

    // In that order: the switch's own list first, what is never trusted last.
    expect(isBefore(ownLoadBalancers(), always)).toBe(true);
    expect(isBefore(always, edges[0]!)).toBe(true);
    expect(isBefore(edges[0]!, never)).toBe(true);
  });

  test("an edge that publishes one range says so in the singular", async () => {
    automaticAnswer = automaticTrustedProxiesToJSON({
      ...FOUND,
      edges: [{ name: "Cloudflare", rangeCount: 1 }],
    });

    await renderPage(TRUSTED_AUTOMATICALLY_CARD_KEY);
    await loadBalancerRows();

    expect(
      screen.getByTestId(TRUSTED_PROXIES_TEST_IDS.edges),
    ).toHaveTextContent("Because you connected it: its 1 published range.");
  });

  test("a project with no edge connected lists none", async () => {
    automaticAnswer = automaticTrustedProxiesToJSON({ ...FOUND, edges: [] });

    await renderPage(TRUSTED_AUTOMATICALLY_CARD_KEY);
    await loadBalancerRows();

    expect(screen.queryByTestId(TRUSTED_PROXIES_TEST_IDS.edges)).toBeNull();
    expect(
      screen.getByTestId(TRUSTED_PROXIES_TEST_IDS.neverTrusted),
    ).toBeInTheDocument();
  });

  test("a Project Owner turns it off: saved at once, said on the card and on the fold", async () => {
    const fold: HTMLElement = await renderPage(TRUSTED_AUTOMATICALLY_CARD_KEY);
    const control: HTMLElement = await ownLoadBalancersSwitch();

    await loadBalancerRows();
    fireEvent.click(control);

    await waitFor(() => {
      expect(switchSaves).toEqual([{ securityTrustOwnLoadBalancers: false }]);
    });
    await waitFor(() => {
      expect(control).toHaveAttribute("aria-checked", "false");
    });
    expect(automaticCard()).toHaveTextContent(OWN_LOAD_BALANCERS_OFF);
    expect(ownLoadBalancers()).toHaveTextContent(
      OWN_LOAD_BALANCERS_NOT_TRUSTED,
    );
    // Still listed: they are what the switch turned off.
    expect(await loadBalancerRows()).toHaveLength(2);

    closeFold(fold);
    expect(setChips(fold)).toEqual([
      `${TRUSTED_AUTOMATICALLY_TITLE}: ${FOLDED_SECTION_OFF}`,
    ]);

    // Nothing else is saved, and the list is not read again.
    expect(updates).toEqual([]);
    expect(automaticAsks).toBe(1);
  });

  test("turned off, it opens off, and a Project Owner turns it back on", async () => {
    trustsOwnLoadBalancers = false;

    await renderPage(TRUSTED_AUTOMATICALLY_CARD_KEY);

    const control: HTMLElement = await ownLoadBalancersSwitch();

    await waitFor(() => {
      expect(control).toHaveAttribute("aria-checked", "false");
    });
    await loadBalancerRows();
    expect(ownLoadBalancers()).toHaveTextContent(
      OWN_LOAD_BALANCERS_NOT_TRUSTED,
    );

    fireEvent.click(control);

    await waitFor(() => {
      expect(switchSaves).toEqual([{ securityTrustOwnLoadBalancers: true }]);
    });
    await waitFor(() => {
      expect(ownLoadBalancers()).not.toHaveTextContent(
        OWN_LOAD_BALANCERS_NOT_TRUSTED,
      );
    });
  });

  test("a Security Admin may turn it off as well", async () => {
    grant([...BASE_PERMISSIONS, Permission.SecurityAdmin]);

    await renderPage(TRUSTED_AUTOMATICALLY_CARD_KEY);

    const control: HTMLElement = await ownLoadBalancersSwitch();

    expect(control).not.toHaveAttribute("aria-disabled", "true");
    fireEvent.click(control);

    await waitFor(() => {
      expect(switchSaves).toEqual([{ securityTrustOwnLoadBalancers: false }]);
    });
  });

  test("anyone else sees what is trusted, with the switch locked", async () => {
    grant([...BASE_PERMISSIONS, Permission.ProjectMember]);

    await renderPage(TRUSTED_AUTOMATICALLY_CARD_KEY);

    const control: HTMLElement = await ownLoadBalancersSwitch();

    expect(control).toHaveAttribute("aria-disabled", "true");
    expect(await loadBalancerRows()).toHaveLength(2);

    fireEvent.click(control);
    await settle();

    expect(switchSaves).toEqual([]);
    expect(control).toHaveAttribute("aria-checked", "true");
  });

  test("load balancers that could not be listed are said to be unread, and the rest is said all the same", async () => {
    automaticAnswer = automaticTrustedProxiesToJSON({
      ...FOUND,
      loadBalancers: [],
      areLoadBalancersRead: false,
    });

    await renderPage(TRUSTED_AUTOMATICALLY_CARD_KEY);

    await waitFor(() => {
      expect(ownLoadBalancers()).toHaveTextContent(OWN_LOAD_BALANCERS_UNREAD);
    });
    expect(
      screen.queryAllByTestId(
        `${TRUSTED_PROXIES_TEST_IDS.ownLoadBalancers}-row`,
      ),
    ).toEqual([]);
    expect(ownLoadBalancers()).not.toHaveTextContent(OWN_LOAD_BALANCERS_NONE);
    expect(
      screen.getByTestId(TRUSTED_PROXIES_TEST_IDS.alwaysTrusted),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(TRUSTED_PROXIES_TEST_IDS.edges),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(TRUSTED_PROXIES_TEST_IDS.neverTrusted),
    ).toBeInTheDocument();
  });

  test("with none in the connected cloud accounts, it says so", async () => {
    automaticAnswer = automaticTrustedProxiesToJSON({
      ...FOUND,
      loadBalancers: [],
    });

    await renderPage(TRUSTED_AUTOMATICALLY_CARD_KEY);

    await waitFor(() => {
      expect(ownLoadBalancers()).toHaveTextContent(OWN_LOAD_BALANCERS_NONE);
    });
    expect(ownLoadBalancers()).not.toHaveTextContent(OWN_LOAD_BALANCERS_UNREAD);
  });

  test("a list cut short says not every one is listed", async () => {
    automaticAnswer = automaticTrustedProxiesToJSON({
      ...FOUND,
      areLoadBalancersComplete: false,
    });

    await renderPage(TRUSTED_AUTOMATICALLY_CARD_KEY);

    expect(await loadBalancerRows()).toHaveLength(2);
    expect(ownLoadBalancers()).toHaveTextContent(OWN_LOAD_BALANCERS_MORE);
  });

  test("a read that fails says why where the load balancers would be, and the rest stays", async () => {
    automaticAnswer = new HTTPErrorResponse(
      500,
      { message: "The cloud resources could not be read." },
      {},
    );

    await renderPage(TRUSTED_AUTOMATICALLY_CARD_KEY);

    await waitFor(() => {
      expect(ownLoadBalancers()).toHaveTextContent(
        "The cloud resources could not be read.",
      );
    });
    expect(
      screen.getByTestId(TRUSTED_PROXIES_TEST_IDS.alwaysTrusted),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(TRUSTED_PROXIES_TEST_IDS.neverTrusted),
    ).toBeInTheDocument();
    // The switch still works: it is the project's setting, not the list's.
    expect(await ownLoadBalancersSwitch()).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });
});

describe("Access Logs", () => {
  test("is off for a project that never set it, saying when to turn it on", async () => {
    const fold: HTMLElement = await renderPage(ACCESS_LOGS_CARD_KEY);
    const control: HTMLElement = await accessLogsSwitch();

    expect(fold.contains(accessLogsCard())).toBe(true);
    expect(accessLogsCard()).toHaveTextContent(ACCESS_LOGS_TITLE);
    expect(accessLogsCard()).toHaveTextContent(ACCESS_LOGS_DESCRIPTION);
    expect(screen.getByRole("switch", { name: ACCESS_LOGS_SWITCH_TITLE })).toBe(
      control,
    );
    expect(control).toHaveAttribute("aria-checked", "false");
    expect(accessLogsCard()).toHaveTextContent(ACCESS_LOGS_OFF);
  });

  test("a Project Owner turns it on: saved at once, said on the card and on the fold", async () => {
    const fold: HTMLElement = await renderPage(ACCESS_LOGS_CARD_KEY);
    const control: HTMLElement = await accessLogsSwitch();

    fireEvent.click(control);

    await waitFor(() => {
      expect(switchSaves).toEqual([
        { securityReadAccessLogForwardedFor: true },
      ]);
    });
    await waitFor(() => {
      expect(control).toHaveAttribute("aria-checked", "true");
    });
    expect(accessLogsCard()).toHaveTextContent(ACCESS_LOGS_ON);

    closeFold(fold);
    expect(setChips(fold)).toEqual([
      `${ACCESS_LOGS_TITLE}: ${FOLDED_SECTION_ON}`,
    ]);
    expect(updates).toEqual([]);
  });

  test("a Security Admin may turn it on as well, and anyone else sees it locked", async () => {
    grant([...BASE_PERMISSIONS, Permission.SecurityAdmin]);

    await renderPage(ACCESS_LOGS_CARD_KEY);

    const control: HTMLElement = await accessLogsSwitch();

    expect(control).not.toHaveAttribute("aria-disabled", "true");
    fireEvent.click(control);

    await waitFor(() => {
      expect(switchSaves).toEqual([
        { securityReadAccessLogForwardedFor: true },
      ]);
    });

    cleanup();
    PermissionGate.clearPermissionPropsCache();
    grant([...BASE_PERMISSIONS, Permission.ProjectMember]);
    switchSaves = [];

    await renderPage(ACCESS_LOGS_CARD_KEY);

    const locked: HTMLElement = await accessLogsSwitch();

    expect(locked).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(locked);
    await settle();
    expect(switchSaves).toEqual([]);
  });
});
