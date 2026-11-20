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
  CONNECTIONS_MORE_SETTINGS_DESCRIPTION,
  TRUSTED_PROXIES_DESCRIPTION,
  TRUSTED_PROXIES_TEST_IDS,
  TRUSTED_PROXIES_TITLE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityTrustedProxiesCopy";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "../../../Models/DatabaseModels/Project";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
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
  project.securityTrustedProxies = stored || undefined;

  return project;
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  PermissionGate.clearPermissionPropsCache();
  grant([...BASE_PERMISSIONS, Permission.ProjectOwner]);
  stored = null;
  updates = [];

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

  jest.spyOn(API, "get").mockImplementation(async (): Promise<never> => {
    return new HTTPResponse<JSONObject>(200, {}, {}) as unknown as never;
  });
  jest.spyOn(API, "post").mockImplementation(async (): Promise<never> => {
    return new HTTPResponse<JSONObject>(200, {}, {}) as unknown as never;
  });
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

describe("Security Events > Connections: More settings", () => {
  test("comes last, folded, naming Trusted Proxies and what it is for", async () => {
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
    expect(listedNames(fold)).toEqual([TRUSTED_PROXIES_TITLE]);
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

  test(`opened at #${TRUSTED_PROXIES_CARD_KEY}, it opens there, at the card`, async () => {
    const fold: HTMLElement = await renderPage(TRUSTED_PROXIES_CARD_KEY);

    expect(header(fold)).toHaveAttribute("aria-expanded", "true");

    const place: HTMLElement | null = document.getElementById(
      TRUSTED_PROXIES_CARD_KEY,
    );

    expect(Boolean(place && fold.contains(place))).toBe(true);
    expect(card()).toHaveTextContent(TRUSTED_PROXIES_DESCRIPTION);
  });

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
