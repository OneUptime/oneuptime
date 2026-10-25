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
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * Creating a status page, and the first thing its Overview shows.
 *
 * Create Status Page asked for "Name - Any friendly name of this object"
 * and "Description - Friendly description that will help you remember",
 * and left the new page in the list. Its Overview opened on "Status Page
 * Preview URL - Here's a link to preview your status page:" and an address
 * in grey, whatever the page held; nothing said a new page shows visitors
 * nothing until monitors are put on it, on a page two sections down.
 *
 * Now Create asks for the name, with the description and the labels under
 * More fields, and opens the new page's Overview. While the page has no
 * resource, the Overview starts with that one next step, Add Monitors. The
 * link card says where visitors find the page: every address it answers at,
 * its custom domains first (Components/CustomDomain/PublicAddresses, held
 * state by state in PublicAddresses.test.tsx), each live one a link with
 * Copy link - and, when visitors cannot just open them, that they sign in or
 * enter the password, with Change access.
 *
 * The list page is rendered with its table captured; the Overview's own
 * pieces are rendered for real, with only the network, the permission gate
 * and navigation stubbed.
 */

interface CapturedTableProps {
  formFields?: Array<Record<string, unknown>>;
  onCreateSuccess?: (item: unknown, modalType?: unknown) => Promise<unknown>;
  columns?: Array<{ title: string }>;
}

let tableProps: CapturedTableProps | null = null;
const countMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();

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
      getAllPermissions: (): Array<unknown> => {
        return [];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: [] };
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
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps) => {
      tableProps = props;
      return <div data-testid="model-table" />;
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: (...args: Array<unknown>): unknown => {
        return countMock(...args);
      },
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/useResourceOwners",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/useResourceOwners",
    ) as Record<string, unknown>;

    return {
      ...actual,
      __esModule: true,
      default: () => {
        return {
          getOwnersForResource: () => {
            return [];
          },
          isLoadingOwners: false,
          onResourcesFetched: () => {
            // no-op
          },
          filterBar: <div data-testid="filter-bar" />,
          mergeFiltersIntoQuery: (
            base: Record<string, unknown> | undefined,
          ) => {
            return { ...(base || {}) };
          },
          facetSaveState: undefined,
          restoreFacetState: () => {
            // no-op
          },
        };
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/OwnersCell",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <span data-testid="owners-cell" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/CustomFields/useCustomFieldFacets",
  () => {
    return {
      __esModule: true,
      default: () => {
        return { facets: [], isLoading: false };
      },
    };
  },
);

jest.mock("../../../UI/Components/BulkUpdate/BulkLabelActions", () => {
  return {
    __esModule: true,
    default: () => {
      return { bulkActions: [], modals: <></> };
    },
  };
});

jest.mock("../../../UI/Components/BulkUpdate/BulkOwnerActions", () => {
  return {
    __esModule: true,
    default: () => {
      return { rowActions: [], bulkActions: [], modals: <></> };
    },
  };
});

jest.mock("../../../UI/Components/BulkUpdate/BulkArchiveActions", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        archiveRowActions: [],
        unarchiveRowActions: [],
        archiveBulkActions: [],
        unarchiveBulkActions: [],
      };
    },
  };
});

import {
  getStatusPageCreateFormFields,
  getStatusPageDetailsFormFields,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageCreateForm";
import StatusPageFirstStep, {
  STATUS_PAGE_FIRST_STEP_BODY_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageFirstStep";
import {
  STATUS_PAGE_FIRST_STEP_BUTTON_TEST_ID,
  STATUS_PAGE_FIRST_STEP_TEST_ID,
  STATUS_PAGE_LINK_ACCESS_TEST_ID,
  STATUS_PAGE_LINK_TEST_ID,
  StatusPageOverviewCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageOverviewCopy";
import { getStatusPageAccessSelect } from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageAccessCopy";
import {
  getAddressParts,
  getAddressText,
  PUBLIC_ADDRESS_TEST_IDS,
  PublicAddressKind,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CustomDomain/PublicAddressCopy";
import StatusPageDomain from "../../../Models/DatabaseModels/StatusPageDomain";
import HashedString from "../../../Types/HashedString";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import StatusPagesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/StatusPages";
import StatusPagePreviewLink from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/StatusPagePreviewLink";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import { STATUS_PAGE_URL } from "../../../UI/Config";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import { ModalType } from "../../../UI/Components/ModelTable/BaseModelTable";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: string = "1f1f1f1f-0000-4000-8000-0000000000aa";
const STATUS_PAGE_ID: string = "2e2e2e2e-0000-4000-8000-0000000000bb";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(`/dashboard/${PROJECT_ID}/status-pages`),
  currentProject: null,
  hasPaymentMethod: false,
};

let gate: PermissionGateResult = { isAllowed: true };
let navigated: Array<string> = [];

beforeEach(() => {
  tableProps = null;
  gate = { isAllowed: true };
  navigated = [];

  countMock.mockReset();
  countMock.mockImplementation(async (): Promise<number> => {
    return 0;
  });

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<null> => {
    return null;
  });

  getListMock.mockReset();
  getListMock.mockImplementation(
    async (): Promise<{
      data: Array<unknown>;
      count: number;
      skip: number;
      limit: number;
    }> => {
      return { data: [], count: 0, skip: 0, limit: 10 };
    },
  );

  getJestSpyOn(PermissionGate, "check").mockImplementation(
    (): PermissionGateResult => {
      return gate;
    },
  );
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockImplementation(
    (): ObjectID => {
      return new ObjectID(PROJECT_ID);
    },
  );
  getJestSpyOn(Navigation, "navigate").mockImplementation(
    (route: unknown): void => {
      navigated.push(String(route));
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

type Field = Record<string, unknown>;

function keyOf(field: Field): string {
  return Object.keys(
    (field["field"] as Record<string, unknown> | undefined) ||
      (field["overrideField"] as Record<string, unknown> | undefined) ||
      {},
  )[0]!;
}

describe("Create Status Page", () => {
  const fields: Array<Field> = getStatusPageCreateFormFields() as Array<Field>;

  test("asks for the name; the description and the labels wait under More fields", () => {
    expect(fields.map(keyOf)).toEqual(["name", "description", "labels"]);

    const [name, description, labels] = fields as [Field, Field, Field];

    expect(name["title"]).toBe("Name");
    expect(name["required"]).toBe(true);
    expect(name["validation"]).toEqual({ minLength: 2 });
    expect(name["collapsibleSection"]).toBeUndefined();
    expect(name["placeholder"]).toBe("e.g., Acme Status");
    // The title says it: the column's "Any friendly name of this object" does not show.
    expect(name["hideColumnDescription"]).toBe(true);

    expect(description["title"]).toBe("Description");
    expect(description["required"]).toBe(false);
    expect(description["fieldType"]).toBe(FormFieldSchemaType.LongText);
    expect(description["placeholder"]).toBe("e.g., For customers in Europe");
    expect(description["hideColumnDescription"]).toBe(true);

    // One fold for both.
    expect(description["collapsibleSection"]).toBeDefined();
    expect(labels["collapsibleSection"]).toBe(
      description["collapsibleSection"],
    );
    expect(
      (description["collapsibleSection"] as Record<string, unknown>)["title"],
    ).toBe("More fields");
  });

  test("the details card's Edit asks for the name and description open, and the labels", () => {
    const details: Array<Field> =
      getStatusPageDetailsFormFields() as Array<Field>;

    expect(details.map(keyOf)).toEqual(["name", "description", "labels"]);
    expect(details[0]!["placeholder"]).toBe("e.g., Acme Status");
    expect(details[1]!["collapsibleSection"]).toBeUndefined();
    expect(details[1]!["placeholder"]).toBe("e.g., For customers in Europe");
  });

  test("the Status Pages list creates with those fields, and opens the new page's Overview", async () => {
    await act(async () => {
      render(
        <MemoryRouter>
          <StatusPagesPage {...PAGE_PROPS} />
        </MemoryRouter>,
      );
    });

    expect(tableProps).not.toBeNull();
    expect(
      (tableProps!.formFields || []).map((field: Field) => {
        return keyOf(field);
      }),
    ).toEqual(["name", "description", "labels"]);

    const created: StatusPage = new StatusPage();
    created._id = STATUS_PAGE_ID;

    await act(async () => {
      await tableProps!.onCreateSuccess!(created, ModalType.Create);
    });

    expect(navigated).toHaveLength(1);
    expect(navigated[0]).toContain(`/status-pages/${STATUS_PAGE_ID}`);
    expect(navigated[0]).toContain(PROJECT_ID);
    // The Overview itself, not one of its sub-pages.
    expect(navigated[0]!.endsWith(STATUS_PAGE_ID)).toBe(true);
  });

  test("an edit from the list stays on the list", async () => {
    await act(async () => {
      render(
        <MemoryRouter>
          <StatusPagesPage {...PAGE_PROPS} />
        </MemoryRouter>,
      );
    });

    const edited: StatusPage = new StatusPage();
    edited._id = STATUS_PAGE_ID;

    await act(async () => {
      await tableProps!.onCreateSuccess!(edited, ModalType.Edit);
    });

    expect(navigated).toEqual([]);
  });
});

async function renderFirstStep(): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <StatusPageFirstStep statusPageId={new ObjectID(STATUS_PAGE_ID)} />
      </MemoryRouter>,
    );
  });

  await waitFor(() => {
    expect(countMock).toHaveBeenCalled();
  });

  // Let the count land.
  await act(async () => {
    await Promise.resolve();
  });
}

describe("the Overview's first step", () => {
  test("counts this page's resources, in this project", async () => {
    await renderFirstStep();

    const request: Record<string, unknown> = countMock.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(request["modelType"]).toBe(StatusPageResource);
    expect(
      String((request["query"] as Record<string, unknown>)["statusPageId"]),
    ).toBe(STATUS_PAGE_ID);
    expect(
      String((request["query"] as Record<string, unknown>)["projectId"]),
    ).toBe(PROJECT_ID);
  });

  test("a page with no resource: says so, with Add Monitors, which opens its Resources", async () => {
    await renderFirstStep();

    const step: HTMLElement = await screen.findByTestId(
      STATUS_PAGE_FIRST_STEP_TEST_ID,
    );

    expect(step).toHaveTextContent("Nothing on this status page yet");
    expect(step).toHaveTextContent(
      "Add the monitors visitors should see. Each one shows its live status and uptime.",
    );

    await act(async () => {
      fireEvent.click(
        screen.getByTestId(STATUS_PAGE_FIRST_STEP_BUTTON_TEST_ID),
      );
    });

    expect(
      screen.getByTestId(STATUS_PAGE_FIRST_STEP_BUTTON_TEST_ID),
    ).toHaveTextContent("Add Monitors");
    expect(navigated).toHaveLength(1);
    expect(navigated[0]).toContain(`/status-pages/${STATUS_PAGE_ID}/resources`);
  });

  test("someone who may not add monitors reads where they are added, with no button", async () => {
    gate = { isAllowed: false, disabledReason: "You cannot add monitors." };

    await renderFirstStep();

    const step: HTMLElement = await screen.findByTestId(
      STATUS_PAGE_FIRST_STEP_TEST_ID,
    );

    expect(step).toHaveTextContent(
      "Visitors see no status here until monitors are added on its Resources page.",
    );
    expect(
      screen.queryByTestId(STATUS_PAGE_FIRST_STEP_BUTTON_TEST_ID),
    ).toBeNull();
    // It asked about adding a status page resource.
    expect(
      (PermissionGate.check as unknown as MockFunction).mock.calls.some(
        (call: Array<unknown>): boolean => {
          return (
            call[0] instanceof StatusPageResource &&
            call[1] === ModelAction.Create
          );
        },
      ),
    ).toBe(true);
  });

  test("a page with resources shows nothing", async () => {
    countMock.mockImplementation(async (): Promise<number> => {
      return 3;
    });

    await renderFirstStep();

    expect(screen.queryByTestId(STATUS_PAGE_FIRST_STEP_TEST_ID)).toBeNull();
  });

  test("a count that fails shows nothing: it is a pointer, never an error", async () => {
    countMock.mockImplementation(async (): Promise<number> => {
      throw new Error("Network down");
    });

    await renderFirstStep();

    expect(screen.queryByTestId(STATUS_PAGE_FIRST_STEP_TEST_ID)).toBeNull();
    expect(screen.queryByText("Network down")).toBeNull();
  });

  test("its words", () => {
    expect(StatusPageOverviewCopy.firstStepTitle).toBe(
      "Nothing on this status page yet",
    );
    expect(StatusPageOverviewCopy.firstStepButton).toBe("Add Monitors");
  });

  /*
   * The card has no title, so its body must not keep the margin a card
   * puts under its header: the step sat 16px lower than it was tall below.
   */
  test("sits in the middle of its card: no header margin above a card with no title", async () => {
    await renderFirstStep();

    const step: HTMLElement = await screen.findByTestId(
      STATUS_PAGE_FIRST_STEP_TEST_ID,
    );
    const body: HTMLElement = step.parentElement as HTMLElement;

    expect(STATUS_PAGE_FIRST_STEP_BODY_CLASS_NAME).toBe("mt-0");
    expect(body).toHaveClass(STATUS_PAGE_FIRST_STEP_BODY_CLASS_NAME);
    expect(body).not.toHaveClass("mt-4");
    expect(screen.queryByTestId("card-details-heading")).toBeNull();
  });
});

interface StoredAccess {
  isPublicStatusPage: boolean;
  enableMasterPassword: boolean;
  hasMasterPassword: boolean;
}

// The status page as the card reads it, for who can see it.
function statusPageWith(access: StoredAccess): StatusPage {
  const statusPage: StatusPage = new StatusPage();
  statusPage._id = STATUS_PAGE_ID;
  statusPage.isPublicStatusPage = access.isPublicStatusPage;
  statusPage.enableMasterPassword = access.enableMasterPassword;

  if (access.hasMasterPassword) {
    statusPage.masterPassword = new HashedString("stored-hash", true);
  }

  return statusPage;
}

async function renderLinkCard(): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <StatusPagePreviewLink modelId={new ObjectID(STATUS_PAGE_ID)} />
      </MemoryRouter>,
    );
  });

  await act(async () => {
    for (let i: number = 0; i < 8; i++) {
      await Promise.resolve();
    }
  });
}

const STATUS_PAGE_ADDRESS: string = `${STATUS_PAGE_URL.toString()}/${STATUS_PAGE_ID}`;

describe("the Status Page Link card", () => {
  test("says where visitors find the page, and lists its address on OneUptime as a link opened in a new tab, with Copy link", async () => {
    await renderLinkCard();

    expect(screen.getByText("Status Page Link")).toBeInTheDocument();
    expect(
      screen.getByText("Where visitors find your status page."),
    ).toBeInTheDocument();

    const body: HTMLElement = screen.getByTestId(STATUS_PAGE_LINK_TEST_ID);
    const row: HTMLElement = within(body).getByTestId(
      PUBLIC_ADDRESS_TEST_IDS.row,
    );

    expect(row).toHaveAttribute("data-kind", PublicAddressKind.OneUptime);
    expect(row).toHaveTextContent("OneUptime address");

    const link: HTMLElement = within(row).getByRole("link");

    expect(link).toHaveAttribute("href", STATUS_PAGE_ADDRESS);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.querySelector("[title]")).toHaveAttribute(
      "title",
      STATUS_PAGE_ADDRESS,
    );

    const copy: HTMLElement = within(row).getByRole("button", {
      name: /^Copy link to /,
    });

    expect(copy).toHaveTextContent("Copy link");
    expect(screen.queryByText(/Here's a link/)).toBeNull();
    expect(
      screen.queryByText("Open it to see your status page as visitors do."),
    ).toBeNull();
  });

  test("its custom domains come first, read for this page in this project", async () => {
    getListMock.mockImplementation(async (): Promise<unknown> => {
      const domain: StatusPageDomain = new StatusPageDomain();
      domain._id = "3f3f3f3f-0000-4000-8000-0000000000cc";
      domain.fullDomain = "status.acme.com";
      domain.isCnameVerified = true;
      domain.isSslOrdered = true;
      domain.isSslProvisioned = true;
      domain.isCustomCertificate = true;

      return { data: [domain], count: 1, skip: 0, limit: 1 };
    });

    await renderLinkCard();

    const request: Record<string, unknown> = getListMock.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(request["modelType"]).toBe(StatusPageDomain);
    expect(
      String((request["query"] as Record<string, unknown>)["statusPageId"]),
    ).toBe(STATUS_PAGE_ID);
    expect(
      String((request["query"] as Record<string, unknown>)["projectId"]),
    ).toBe(PROJECT_ID);

    expect(
      screen
        .getAllByTestId(PUBLIC_ADDRESS_TEST_IDS.row)
        .map((row: HTMLElement): string | null => {
          return row.getAttribute("data-address");
        }),
    ).toEqual([
      "status.acme.com",
      getAddressText(getAddressParts(STATUS_PAGE_ADDRESS)),
    ]);
  });

  test("reads who can see the page with the Access page's own columns", async () => {
    await renderLinkCard();

    const request: Record<string, unknown> = getItemMock.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(request["modelType"]).toBe(StatusPage);
    expect(String(request["id"])).toBe(STATUS_PAGE_ID);
    expect(request["select"]).toEqual(getStatusPageAccessSelect());
  });

  test.each([
    [
      "a public page: no line",
      {
        isPublicStatusPage: true,
        enableMasterPassword: false,
        hasMasterPassword: false,
      },
      null,
    ],
    [
      "a public page whose password switch was left on: still public",
      {
        isPublicStatusPage: true,
        enableMasterPassword: true,
        hasMasterPassword: true,
      },
      null,
    ],
    [
      "a private page: visitors sign in",
      {
        isPublicStatusPage: false,
        enableMasterPassword: false,
        hasMasterPassword: false,
      },
      "Visitors sign in to see this status page.",
    ],
    [
      "a private page with the password switch on but no password: visitors sign in, as the server holds it",
      {
        isPublicStatusPage: false,
        enableMasterPassword: true,
        hasMasterPassword: false,
      },
      "Visitors sign in to see this status page.",
    ],
    [
      "a password-protected page: visitors enter the password",
      {
        isPublicStatusPage: false,
        enableMasterPassword: true,
        hasMasterPassword: true,
      },
      "Visitors enter the password to see this status page.",
    ],
  ])(
    "%s",
    async (_label: string, access: StoredAccess, sentence: string | null) => {
      getItemMock.mockImplementation(async (): Promise<StatusPage> => {
        return statusPageWith(access);
      });

      await renderLinkCard();

      const line: HTMLElement | null = screen.queryByTestId(
        STATUS_PAGE_LINK_ACCESS_TEST_ID,
      );

      if (!sentence) {
        expect(line).toBeNull();
        return;
      }

      expect(line).not.toBeNull();
      expect(line).toHaveTextContent(`${sentence} Change access`);

      const change: HTMLElement = within(line!).getByRole("link", {
        name: "Change access",
      });

      expect(change.getAttribute("href")).toBe(
        `/dashboard/${PROJECT_ID}/status-pages/${STATUS_PAGE_ID}/authentication-settings`,
      );

      // Under the addresses, inside the card.
      const list: HTMLElement = screen.getByTestId(
        PUBLIC_ADDRESS_TEST_IDS.list,
      );

      expect(
        list.compareDocumentPosition(line!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    },
  );

  test.each([
    [
      "cannot be read",
      async (): Promise<never> => {
        throw new Error("Network down");
      },
    ],
    [
      "is not found",
      async (): Promise<null> => {
        return null;
      },
    ],
  ])(
    "a page whose access %s: no line, and never an error on the Overview",
    async (_label: string, answer: () => Promise<unknown>) => {
      getItemMock.mockImplementation(answer);

      await renderLinkCard();

      expect(screen.queryByTestId(STATUS_PAGE_LINK_ACCESS_TEST_ID)).toBeNull();
      expect(screen.queryByText("Network down")).toBeNull();
      expect(screen.getAllByTestId(PUBLIC_ADDRESS_TEST_IDS.row)).toHaveLength(
        1,
      );
    },
  );
});
