import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * SECURITY EVENTS > PLAYBOOKS > BLOCKLIST (#10338), drawn: the list of what
 * the project blocks (a ModelTable call, so its props are pinned and its
 * cells drawn from them), the notice while nothing enforces it, a row's
 * chips per destination, Block Address with what the server's check
 * answers, a row's Lift, Extend and Make Permanent, the bulk Lift, and
 * Protected Entities' Protected Automatically card.
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

type Column = {
  field: Record<string, unknown>;
  title: string;
  getElement?: ((item: unknown) => React.ReactElement) | undefined;
};

type CapturedTable = {
  id: string;
  query: Record<string, unknown>;
  singularName?: string;
  pluralName?: string;
  createVerb?: string;
  isDeleteable: boolean;
  isEditable?: boolean;
  isCreateable: boolean;
  initialFilterData?: Record<string, unknown>;
  sortBy?: string;
  cardProps?: { title?: string; description?: string };
  emptyState?: { title?: string; description?: string };
  onCreateClick?: () => void;
  refreshToggle?: string;
  onFetchSuccess?: (items: Array<unknown>) => void;
  actionButtons?: Array<unknown>;
  bulkActions?: { buttons: Array<unknown> };
  filters: Array<{
    field: Record<string, unknown>;
    title: string;
    filterDropdownOptions?: Array<{ label: string; value: string }>;
  }>;
  columns: Array<Column>;
};

type CapturedForm = {
  title: string;
  description?: unknown;
  submitButtonText?: string;
  error?: string;
  onSubmit?: (values: Record<string, unknown>) => Promise<void> | void;
  onClose?: () => void;
  formProps: {
    initialValues?: Record<string, unknown>;
    fields: Array<{
      field: Record<string, unknown>;
      title?: string;
      description?: string;
      disabled?: boolean;
      dropdownOptions?: Array<{ label: string; value: string }>;
      collapsibleSection?: unknown;
      customValidation?: (values: Record<string, unknown>) => string | null;
    }>;
  };
};

type CapturedConfirm = {
  title: string;
  description: React.ReactElement | string;
  submitButtonText?: string;
  submitButtonType?: unknown;
  onSubmit: () => Promise<void> | void;
  onClose?: () => void;
  error?: string;
};

let table: CapturedTable | null = null;
let forms: Array<CapturedForm> = [];
let confirms: Array<CapturedConfirm> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTable) => {
      // The page's second list, its Cloud WAFs (#10344), is pinned in its own test.
      if (props.id !== "security-blocklist-table") {
        return React.createElement("div", { "data-testid": props.id });
      }

      table = props;
      return React.createElement("div", { "data-testid": "blocklist-table" });
    },
  };
});

jest.mock("../../../UI/Components/FormModal/BasicFormModal", () => {
  return {
    __esModule: true,
    default: (props: CapturedForm) => {
      forms.push(props);
      return React.createElement(
        "div",
        { "data-testid": "form-modal" },
        React.createElement("h2", null, props.title),
        props.error
          ? React.createElement(
              "p",
              { "data-testid": "form-error" },
              props.error,
            )
          : null,
      );
    },
  };
});

jest.mock("../../../UI/Components/Modal/ConfirmModal", () => {
  return {
    __esModule: true,
    default: (props: CapturedConfirm) => {
      confirms.push(props);
      return React.createElement(
        "div",
        { "data-testid": "confirm-modal" },
        React.createElement("h2", null, props.title),
        props.description,
      );
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Blocklist/BlocklistApi",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Blocklist/BlocklistApi",
    ) as Record<string, unknown>;

    return {
      __esModule: true,
      ...actual,
      checkBlockValue: jest.fn(),
      readBlocklistDestinations: jest.fn(),
      readBlockEnforcements: jest.fn(),
      readAutomaticProtections: jest.fn(),
    };
  },
);

import SecurityBlocklistPage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/Blocklist";
import * as BlocklistApi from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Blocklist/BlocklistApi";
import BlockAddressModal, {
  getBlockDurationOptions,
  getBlockWarnings,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Blocklist/BlockAddressModal";
import {
  BlockActionCell,
  BlockAddedByCell,
  BlockEnforcedAtCell,
  BlockExpiresCell,
  getEnforcementTone,
  writeEnforcementTooltip,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Blocklist/BlocklistCells";
import {
  BLOCKLIST_EMPTY_DESCRIPTION,
  BLOCKLIST_EMPTY_TITLE,
  BLOCKLIST_TABLE_DESCRIPTION,
  BLOCKLIST_TABLE_TITLE,
  BLOCKLIST_TEST_IDS,
  ENDED_BLOCK_REASON,
  NOTHING_ENFORCES_DESCRIPTION,
  NOTHING_ENFORCES_TITLE,
  UNTIL_LIFTED_REFUSED,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Blocklist/BlocklistCopy";
import BlocklistNotEnforcedNotice from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Blocklist/BlocklistNotEnforcedNotice";
import { writeBlockRefusal } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Blocklist/BlocklistWords";
import useBlocklistActions, {
  BlocklistActions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Blocklist/useBlocklistActions";
import AutomaticProtectionsCard from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/ProtectedEntities/AutomaticProtectionsCard";
import {
  AUTOMATIC_PROTECTIONS_MORE,
  AUTOMATIC_PROTECTIONS_UNREAD,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/ProtectedEntities/AutomaticProtectionsCopy";
import Project from "../../../Models/DatabaseModels/Project";
import SecurityBlock from "../../../Models/DatabaseModels/SecurityBlock";
import SecurityBlockEnforcement from "../../../Models/DatabaseModels/SecurityBlockEnforcement";
import User from "../../../Models/DatabaseModels/User";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import {
  SecurityBlockAction,
  SecurityBlockDuration,
  SecurityBlockSource,
  SecurityBlockState,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import {
  SecurityBlockEnforcementState,
  SecurityBlockEnforcementView,
} from "../../../Types/SecurityBlocklist/SecurityBlockEnforcement";
import { SecurityProtectedAddressSource } from "../../../Types/SecurityBlocklist/SecurityProtectedAddress";
import ActionButtonSchema from "../../../UI/Components/ActionButton/ActionButtonSchema";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import { PillTone } from "../../../UI/Components/Pill/PillTone";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import Toast from "../../../UI/Utils/Toast";
import {
  Translator,
  getGlobalTranslator,
} from "../../../UI/Utils/TranslateTemplate";

type MockedFn = ReturnType<typeof jest.fn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "71111111-1111-4111-8111-111111111111",
);
const BLOCK_ID: string = "72222222-2222-4222-8222-222222222222";
const CASE_ID: ObjectID = new ObjectID("73333333-3333-4333-8333-333333333333");

const HOUR_IN_MS: number = 60 * 60 * 1000;

const english: Translator = getGlobalTranslator();

const api: {
  checkBlockValue: MockedFn;
  readBlocklistDestinations: MockedFn;
  readBlockEnforcements: MockedFn;
  readAutomaticProtections: MockedFn;
} = BlocklistApi as unknown as {
  checkBlockValue: MockedFn;
  readBlocklistDestinations: MockedFn;
  readBlockEnforcements: MockedFn;
  readAutomaticProtections: MockedFn;
};

function block(values: Partial<SecurityBlock> = {}): SecurityBlock {
  const model: SecurityBlock = new SecurityBlock();
  model._id = BLOCK_ID;
  model.value = "35.205.11.131";
  model.action = SecurityBlockAction.Block;
  model.state = SecurityBlockState.Active;
  model.expiresAt = new Date(Date.now() + 24 * HOUR_IN_MS);
  model.source = SecurityBlockSource.Person;
  Object.assign(model, values);
  return model;
}

function enforcement(
  values: Partial<SecurityBlockEnforcement>,
): SecurityBlockEnforcement {
  const model: SecurityBlockEnforcement = new SecurityBlockEnforcement();
  model._id = ObjectID.generate().toString();
  model.securityBlockId = new ObjectID(BLOCK_ID);
  model.destinationKey = "Cloudflare:zone-1";
  model.destinationName = "Cloudflare";
  Object.assign(model, values);
  return model;
}

function nothingChecked(
  values: Partial<BlocklistApi.BlockValueCheck> = {},
): BlocklistApi.BlockValueCheck {
  return {
    value: "35.205.11.131",
    isWiderThanLargestRange: false,
    coveredBy: null,
    protection: null,
    cannotTell: false,
    isYourAddress: false,
    yourAddress: "198.51.100.20",
    ...values,
  };
}

function lastForm(): CapturedForm {
  expect(forms.length).toBeGreaterThan(0);
  return forms[forms.length - 1]!;
}

function lastConfirm(): CapturedConfirm {
  expect(confirms.length).toBeGreaterThan(0);
  return confirms[confirms.length - 1]!;
}

let holdsAdmin: boolean;
let mayUpdate: boolean;
let create: MockedFn;
let updateById: MockedFn;
let toast: MockedFn;

beforeEach(() => {
  table = null;
  forms = [];
  confirms = [];
  holdsAdmin = false;
  mayUpdate = true;

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(PermissionGate, "holdsAnyOf").mockImplementation(() => {
    return holdsAdmin;
  });
  jest.spyOn(PermissionGate, "check").mockImplementation(() => {
    return mayUpdate
      ? { isAllowed: true }
      : {
          isAllowed: false,
          disabledReason: "You do not have permission to edit blocks.",
        };
  });
  create = jest
    .spyOn(ModelAPI, "create")
    .mockResolvedValue({} as never) as unknown as MockedFn;
  updateById = jest
    .spyOn(ModelAPI, "updateById")
    .mockResolvedValue({} as never) as unknown as MockedFn;
  toast = jest.spyOn(Toast, "success").mockImplementation(() => {
    return "";
  }) as unknown as MockedFn;

  api.checkBlockValue.mockReset();
  api.readBlocklistDestinations.mockReset();
  api.readBlockEnforcements.mockReset();
  api.readAutomaticProtections.mockReset();
  api.readBlocklistDestinations.mockResolvedValue({
    destinations: [],
    cannotTell: false,
  } as never);
  api.readBlockEnforcements.mockResolvedValue(new Map() as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderPage(): Promise<void> {
  const project: Project = new Project();
  project.id = PROJECT_ID;

  await act(async () => {
    render(
      <MemoryRouter>
        <SecurityBlocklistPage
          pageRoute={new Route("/dashboard/security-events/blocklist")}
          currentProject={project}
          hasPaymentMethod={true}
        />
      </MemoryRouter>,
    );
  });
}

function capturedTable(): CapturedTable {
  expect(table).not.toBeNull();
  return table!;
}

function columnTitled(title: string): Column {
  const column: Column | undefined = capturedTable().columns.find(
    (candidate: Column): boolean => {
      return candidate.title === title;
    },
  );

  expect(column).toBeDefined();
  return column!;
}

describe("the Blocklist page", () => {
  test("lists the project's blocks, newest first, the active ones to start with, never deleted or edited as a form", async () => {
    await renderPage();

    expect(capturedTable()).toMatchObject({
      id: "security-blocklist-table",
      query: { projectId: PROJECT_ID },
      singularName: "Address",
      pluralName: "Addresses",
      createVerb: "Block",
      isDeleteable: false,
      isEditable: false,
      isCreateable: true,
      sortBy: "createdAt",
      initialFilterData: { state: [SecurityBlockState.Active] },
      cardProps: {
        title: BLOCKLIST_TABLE_TITLE,
        description: BLOCKLIST_TABLE_DESCRIPTION,
      },
      emptyState: {
        title: BLOCKLIST_EMPTY_TITLE,
        description: BLOCKLIST_EMPTY_DESCRIPTION,
      },
    });
    expect(BLOCKLIST_EMPTY_TITLE).toBe("Nothing is blocked yet");

    expect(
      capturedTable().columns.map((column: Column): string => {
        return column.title;
      }),
    ).toEqual([
      "Address",
      "Action",
      "Enforced At",
      "Expires",
      "Case",
      "Added By",
    ]);

    // The State filter shows the ended blocks too.
    expect(
      capturedTable()
        .filters.find((filter: { title: string }) => {
          return filter.title === "State";
        })
        ?.filterDropdownOptions?.map((option: { value: string }) => {
          return option.value;
        }),
    ).toEqual([
      SecurityBlockState.Active,
      SecurityBlockState.Lifted,
      SecurityBlockState.Expired,
    ]);

    // Lift works on several rows at once.
    expect(capturedTable().bulkActions?.buttons).toHaveLength(1);
  });

  test("says so above the list while nothing enforces the blocklist, with where to connect what would", async () => {
    await renderPage();

    const notice: HTMLElement = screen.getByTestId(BLOCKLIST_TEST_IDS.notice);
    expect(notice).toHaveTextContent(NOTHING_ENFORCES_TITLE);
    expect(notice).toHaveTextContent(NOTHING_ENFORCES_DESCRIPTION);
    expect(screen.getByText("Security Connections")).toBeInTheDocument();
    expect(screen.getByText("Cloud Connections")).toBeInTheDocument();
    expect(NOTHING_ENFORCES_TITLE).toBe("Nothing enforces these blocks yet.");
  });

  test("says it cannot tell, rather than that nothing enforces it, when where it is enforced could not be read", async () => {
    api.readBlocklistDestinations.mockRejectedValue(new Error("down") as never);

    await renderPage();

    expect(screen.getByTestId(BLOCKLIST_TEST_IDS.notice)).toHaveTextContent(
      "OneUptime could not read where your blocks are enforced. Try again in a minute.",
    );
    expect(screen.queryByText(NOTHING_ENFORCES_TITLE)).not.toBeInTheDocument();
  });

  test("shows no notice once a destination enforces the blocklist", async () => {
    api.readBlocklistDestinations.mockResolvedValue({
      destinations: [
        {
          key: "Cloudflare:zone-1",
          name: "Cloudflare",
          provider: "Cloudflare",
        },
      ],
      cannotTell: false,
    } as never);

    await renderPage();

    expect(
      screen.queryByTestId(BLOCKLIST_TEST_IDS.notice),
    ).not.toBeInTheDocument();
  });

  test("reads the listed blocks' enforcement, and draws a chip per destination in Enforced At", async () => {
    const listed: SecurityBlock = block();
    api.readBlockEnforcements.mockResolvedValue(
      new Map([
        [
          BLOCK_ID,
          [
            enforcement({
              state: SecurityBlockEnforcementState.Applied,
              lastConfirmedAt: new Date(),
            }),
          ],
        ],
      ]) as never,
    );

    await renderPage();

    await act(async () => {
      capturedTable().onFetchSuccess!([listed]);
    });

    expect(api.readBlockEnforcements).toHaveBeenCalledWith([listed.id]);

    render(columnTitled("Enforced At").getElement!(listed));

    expect(screen.getByText("Cloudflare")).toBeInTheDocument();
    expect(
      screen.queryByTestId(BLOCKLIST_TEST_IDS.notEnforced),
    ).not.toBeInTheDocument();
  });

  test("a block AWS WAF holds reads Enforced at AWS WAF (prod-alb); one its web ACL does not block yet is not enforced (#10344)", async () => {
    const listed: SecurityBlock = block();
    const confirmedAt: Date = new Date();

    await renderPage();

    // The web ACLs it is enforced in are listed under the blocks.
    expect(
      screen.getByTestId("security-blocklist-cloud-wafs-table"),
    ).toBeInTheDocument();

    render(
      <BlockEnforcedAtCell
        block={listed}
        enforcements={[
          enforcement({
            destinationKey: "AwsWaf:waf-1",
            destinationName: "AWS WAF (prod-alb)",
            state: SecurityBlockEnforcementState.Applied,
            lastConfirmedAt: confirmedAt,
          }),
        ]}
        now={confirmedAt}
      />,
    );

    expect(screen.getByText("AWS WAF (prod-alb)")).toBeInTheDocument();
    expect(
      screen.queryByTestId(BLOCKLIST_TEST_IDS.notEnforced),
    ).not.toBeInTheDocument();

    cleanup();

    // In its sets, but the team's rule does not block them yet: still applying, so not enforced.
    render(
      <BlockEnforcedAtCell
        block={listed}
        enforcements={[
          enforcement({
            destinationKey: "AwsWaf:waf-1",
            destinationName: "AWS WAF (prod-alb)",
            state: SecurityBlockEnforcementState.Pending,
          }),
        ]}
        now={confirmedAt}
      />,
    );

    expect(
      screen.getByTestId(BLOCKLIST_TEST_IDS.notEnforced),
    ).toBeInTheDocument();
  });

  test("Block Address opens the dialog, and a block made closes it and reads the list again", async () => {
    api.checkBlockValue.mockResolvedValue(nothingChecked() as never);
    await renderPage();

    expect(screen.queryByTestId("form-modal")).not.toBeInTheDocument();
    expect(capturedTable().refreshToggle).toBe("");

    await act(async () => {
      capturedTable().onCreateClick!();
    });

    expect(lastForm().title).toBe("Block Address");

    await act(async () => {
      await lastForm().onSubmit!({ value: "35.205.11.131" });
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("form-modal")).not.toBeInTheDocument();
    expect(capturedTable().refreshToggle).toBe("1");
    // And where the blocklist is enforced is read again with it.
    expect(api.readBlocklistDestinations).toHaveBeenCalledTimes(2);
  });
});

describe("a row's cells", () => {
  const now: Date = new Date();

  test("an active block nothing holds says Not enforced: not enforced is not done", () => {
    render(<BlockEnforcedAtCell block={block()} enforcements={[]} now={now} />);

    expect(
      screen.getByTestId(BLOCKLIST_TEST_IDS.notEnforced),
    ).toHaveTextContent("Not enforced");
  });

  test("a destination still applying, or not read back lately, does not make it enforced", () => {
    render(
      <BlockEnforcedAtCell
        block={block()}
        enforcements={[
          enforcement({ state: SecurityBlockEnforcementState.Pending }),
          enforcement({
            destinationKey: "Test:2",
            destinationName: "AWS WAF",
            state: SecurityBlockEnforcementState.Applied,
            lastConfirmedAt: new Date(now.getTime() - 2 * HOUR_IN_MS),
          }),
        ]}
        now={now}
      />,
    );

    expect(
      screen.getByTestId(BLOCKLIST_TEST_IDS.notEnforced),
    ).toBeInTheDocument();
    expect(screen.getByText("Cloudflare")).toBeInTheDocument();
    expect(screen.getByText("AWS WAF")).toBeInTheDocument();
  });

  test("an ended block's destinations that let it go say nothing more", () => {
    const { container } = render(
      <BlockEnforcedAtCell
        block={block({ state: SecurityBlockState.Lifted })}
        enforcements={[
          enforcement({ state: SecurityBlockEnforcementState.Removed }),
        ]}
        now={now}
      />,
    );

    expect(
      container.querySelector(
        `[data-testid="${BLOCKLIST_TEST_IDS.enforcedAtCell}"]`,
      ),
    ).toBeNull();
    expect(
      screen.queryByTestId(BLOCKLIST_TEST_IDS.notEnforced),
    ).not.toBeInTheDocument();
  });

  test("each chip's tone and words say where the block stands there", () => {
    expect(getEnforcementTone(SecurityBlockEnforcementView.Enforced)).toBe(
      PillTone.Success,
    );
    expect(getEnforcementTone(SecurityBlockEnforcementView.Pending)).toBe(
      PillTone.Info,
    );
    expect(getEnforcementTone(SecurityBlockEnforcementView.Unconfirmed)).toBe(
      PillTone.Warning,
    );
    expect(getEnforcementTone(SecurityBlockEnforcementView.NotApplied)).toBe(
      PillTone.Danger,
    );

    expect(
      writeEnforcementTooltip(
        english,
        enforcement({ state: SecurityBlockEnforcementState.Pending }),
        now,
      ),
    ).toBe("Waiting for Cloudflare to hold this block.");
    expect(
      writeEnforcementTooltip(
        english,
        enforcement({
          state: SecurityBlockEnforcementState.Failed,
          error: "Azure WAF cannot challenge.",
        }),
        now,
      ),
    ).toBe("Cloudflare does not hold this block. Azure WAF cannot challenge.");
    expect(
      writeEnforcementTooltip(
        english,
        enforcement({
          state: SecurityBlockEnforcementState.Applied,
          lastConfirmedAt: new Date(now.getTime() - 2 * HOUR_IN_MS),
        }),
        now,
      ),
    ).toMatch(
      /^Cloudflare last held this block .+, and has not been read back since\.$/,
    );
    // Applied and never read back: waiting for its read, as a new row is.
    expect(
      writeEnforcementTooltip(
        english,
        enforcement({ state: SecurityBlockEnforcementState.Applied }),
        now,
      ),
    ).toBe("Waiting for Cloudflare to hold this block.");
  });

  test("Blocked and Challenged are plain facts, never red", () => {
    const { container, rerender } = render(<BlockActionCell block={block()} />);
    expect(container).toHaveTextContent("Blocked");

    rerender(
      <BlockActionCell
        block={block({ action: SecurityBlockAction.Challenge })}
      />,
    );
    expect(container).toHaveTextContent("Challenged");
    expect(container.innerHTML).not.toMatch(/red-/);
  });

  test("Expires says how far off the end is, that it stays until lifted, or how it ended", () => {
    const { container, rerender } = render(
      <BlockExpiresCell block={block()} />,
    );
    expect(
      screen.getByTestId(BLOCKLIST_TEST_IDS.expiresCell),
    ).toHaveTextContent(/in (23|24) hours|in a day/);

    rerender(<BlockExpiresCell block={block({ expiresAt: null as never })} />);
    expect(container).toHaveTextContent("Until lifted");

    rerender(
      <BlockExpiresCell block={block({ state: SecurityBlockState.Lifted })} />,
    );
    expect(container).toHaveTextContent("Lifted");

    rerender(
      <BlockExpiresCell block={block({ state: SecurityBlockState.Expired })} />,
    );
    // A meaning key, drawn as its word.
    expect(container).toHaveTextContent("Expired");
    expect(container).not.toHaveTextContent("(block)");
  });

  test("Added By names what made a block no person made", () => {
    const { container, rerender } = render(
      <BlockAddedByCell
        block={block({ source: SecurityBlockSource.Playbook })}
      />,
    );
    expect(container).toHaveTextContent("Playbook");

    rerender(
      <BlockAddedByCell block={block({ source: SecurityBlockSource.Api })} />,
    );
    expect(container).toHaveTextContent("API Key");

    const person: User = new User();
    person.name = "Alice Admin" as never;

    rerender(
      <MemoryRouter>
        <BlockAddedByCell block={block({ createdByUser: person })} />
      </MemoryRouter>,
    );
    expect(container).toHaveTextContent("Alice Admin");
  });
});

describe("why a block would be refused, in the reader's words", () => {
  test("already blocked, by itself or by a range that covers it", () => {
    expect(
      writeBlockRefusal({
        translator: english,
        typed: "35.205.11.131",
        check: nothingChecked({
          coveredBy: { id: BLOCK_ID, value: "35.205.11.131" },
        }),
      }),
    ).toBe("35.205.11.131 is already blocked.");
    expect(
      writeBlockRefusal({
        translator: english,
        typed: "35.205.11.131",
        check: nothingChecked({
          coveredBy: { id: BLOCK_ID, value: "35.205.11.0/24" },
        }),
      }),
    ).toBe("35.205.11.131 is already blocked: 35.205.11.0/24 covers it.");
  });

  test("protected, saying how the block meets the protected address and what it is", () => {
    expect(
      writeBlockRefusal({
        translator: english,
        typed: "35.205.11.0/24",
        check: nothingChecked({
          value: "35.205.11.0/24",
          protection: {
            source: SecurityProtectedAddressSource.Host,
            protectedValue: "35.205.11.131",
            name: "web-3",
          },
        }),
      }),
    ).toBe(
      "35.205.11.0/24 holds 35.205.11.131. 35.205.11.131 is the address of host web-3.",
    );
    expect(
      writeBlockRefusal({
        translator: english,
        typed: "2001:db8:5::1",
        check: nothingChecked({
          value: "2001:db8:5::1",
          protection: {
            source: SecurityProtectedAddressSource.AddressName,
            protectedValue: "2001:db8::/32",
            name: "Office",
          },
        }),
      }),
    ).toBe(
      "2001:db8:5::1 is inside 2001:db8::/32. 2001:db8::/32 is named Office in your Address Names.",
    );
  });

  test("OneUptime could not tell, and nothing at all when the block would be made", () => {
    expect(
      writeBlockRefusal({
        translator: english,
        typed: "35.205.11.131",
        check: nothingChecked({ cannotTell: true }),
      }),
    ).toBe(
      "OneUptime could not check whether 35.205.11.131 is one of your own addresses, so it did not block it. Try again in a minute.",
    );
    expect(
      writeBlockRefusal({
        translator: english,
        typed: "35.205.11.131",
        check: nothingChecked(),
      }),
    ).toBeNull();
  });
});

describe("Block Address", () => {
  let onBlocked: MockedFn;

  async function open(securityCaseId?: ObjectID): Promise<void> {
    onBlocked = jest.fn();

    await act(async () => {
      render(
        <BlockAddressModal
          onClose={jest.fn()}
          onBlocked={onBlocked as unknown as () => void}
          securityCaseId={securityCaseId}
        />,
      );
    });
  }

  async function submit(values: Record<string, unknown>): Promise<void> {
    await act(async () => {
      await lastForm().onSubmit!(values);
    });
  }

  test("asks for an address or range, 24 hours unless chosen, a reason, and folds the rest", async () => {
    await open();

    const form: CapturedForm = lastForm();

    expect(form.formProps.initialValues).toEqual({
      duration: SecurityBlockDuration.OneDay,
      action: SecurityBlockAction.Block,
      untilLifted: false,
    });
    expect(
      form.formProps.fields.map((field: { field: Record<string, unknown> }) => {
        return Object.keys(field.field)[0];
      }),
    ).toEqual(["value", "duration", "reason", "action", "untilLifted"]);

    // Three fields in view; Action and Until lifted under More fields.
    expect(
      form.formProps.fields.filter(
        (field: { collapsibleSection?: unknown }) => {
          return !field.collapsibleSection;
        },
      ),
    ).toHaveLength(3);

    // A count and its unit are written apart by a no-break space.
    expect(
      getBlockDurationOptions(english).map(
        (option: DropdownOption): Array<string> => {
          return [
            String(option.value),
            option.label.replace(/[\u00A0\u202F]/g, " "),
          ];
        },
      ),
    ).toEqual([
      [SecurityBlockDuration.OneHour, "1 hour"],
      [SecurityBlockDuration.OneDay, "24 hours"],
      [SecurityBlockDuration.SevenDays, "7 days"],
      [SecurityBlockDuration.ThirtyDays, "30 days"],
    ]);
  });

  test("keeping a block until lifted is a Security Admin's: locked, saying why, for anyone else", async () => {
    await open();

    const untilLifted: CapturedForm["formProps"]["fields"][number] =
      lastForm().formProps.fields[4]!;
    expect(untilLifted.disabled).toBe(true);
    expect(untilLifted.description).toBe(UNTIL_LIFTED_REFUSED);

    cleanup();
    holdsAdmin = true;
    await open();

    expect(lastForm().formProps.fields[4]!.disabled).toBe(false);
  });

  test("checks the value as the server will: a wide range takes a Security Admin", async () => {
    await open();

    const value: CapturedForm["formProps"]["fields"][number] =
      lastForm().formProps.fields[0]!;

    expect(value.customValidation!({ value: "35.205.11.131" })).toBeNull();
    expect(value.customValidation!({ value: "not an address" })).toBe(
      "Enter an IPv4 or IPv6 address, such as 203.0.113.7, or a range written as an address and a length, such as 203.0.113.0/24.",
    );
    expect(value.customValidation!({ value: "35.205.0.0/16" })).toBe(
      "35.205.0.0/16 is wider than a /24, which would block whole networks. Block single addresses or a narrower range, or ask a Security Admin to block it.",
    );
  });

  test("a refused block says why, in the dialog, and makes nothing", async () => {
    api.checkBlockValue.mockResolvedValue(
      nothingChecked({
        protection: {
          source: SecurityProtectedAddressSource.OneUptimeCloud,
          protectedValue: "35.205.11.131",
          name: "OneUptime Cloud",
        },
      }) as never,
    );

    await open();
    await submit({ value: " 35.205.11.131 ", duration: "OneDay" });

    expect(api.checkBlockValue).toHaveBeenCalledWith(" 35.205.11.131 ");
    expect(lastForm().error).toBe(
      "35.205.11.131 is one of OneUptime Cloud's probe addresses.",
    );
    expect(create).not.toHaveBeenCalled();
    expect(onBlocked).not.toHaveBeenCalled();
  });

  test("a block made is the value trimmed, its action, its end and its case, and says so", async () => {
    api.checkBlockValue.mockResolvedValue(nothingChecked() as never);
    const before: number = Date.now();

    await open(CASE_ID);
    await submit({
      value: " 35.205.11.131 ",
      duration: SecurityBlockDuration.SevenDays,
      reason: "  Scanning /wp-admin ",
      action: SecurityBlockAction.Challenge,
      untilLifted: true,
    });

    expect(create).toHaveBeenCalledTimes(1);

    const made: SecurityBlock = (
      create.mock.calls[0]![0] as { model: SecurityBlock }
    ).model;

    expect(made.value).toBe("35.205.11.131");
    expect(made.action).toBe(SecurityBlockAction.Challenge);
    expect(made.reason).toBe("Scanning /wp-admin");
    expect(made.securityCaseId?.toString()).toBe(CASE_ID.toString());

    // Until lifted is a Security Admin's: for anyone else, the chosen length.
    const end: number = new Date(made.expiresAt as Date).getTime();
    expect(end).toBeGreaterThanOrEqual(before + 7 * 24 * HOUR_IN_MS);
    expect(end).toBeLessThanOrEqual(Date.now() + 7 * 24 * HOUR_IN_MS);

    expect(toast).toHaveBeenCalledWith("35.205.11.131 blocked.");
    expect(onBlocked).toHaveBeenCalledTimes(1);
  });

  test("a Security Admin keeps one until someone lifts it", async () => {
    holdsAdmin = true;
    api.checkBlockValue.mockResolvedValue(nothingChecked() as never);

    await open();
    await submit({ value: "35.205.11.131", untilLifted: true });

    const made: SecurityBlock = (
      create.mock.calls[0]![0] as { model: SecurityBlock }
    ).model;

    expect(made.expiresAt).toBeNull();
  });

  test("the address the person is using right now is asked about first, and kept if they go back", async () => {
    api.checkBlockValue.mockResolvedValue(
      nothingChecked({
        value: "198.51.100.20",
        isYourAddress: true,
        yourAddress: "198.51.100.20",
      }) as never,
    );

    await open();
    await submit({ value: "198.51.100.20", duration: "OneDay" });

    expect(create).not.toHaveBeenCalled();
    expect(lastConfirm().title).toBe("Block Your Own Address?");
    expect(lastConfirm().submitButtonText).toBe("Block Anyway");
    expect(screen.getByTestId("confirm-modal")).toHaveTextContent(
      "198.51.100.20 is the address you are using right now. Blocking it can lock you out of your own app.",
    );

    // Going back keeps what was typed.
    await act(async () => {
      lastConfirm().onClose!();
    });
    expect(lastForm().formProps.initialValues).toMatchObject({
      value: "198.51.100.20",
    });

    // Blocking anyway makes it.
    await submit({ value: "198.51.100.20", duration: "OneDay" });
    await act(async () => {
      await lastConfirm().onSubmit();
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(onBlocked).toHaveBeenCalledTimes(1);
  });

  test("a range wider than the largest is asked about, for whoever may block one", () => {
    expect(
      getBlockWarnings({
        translator: english,
        check: nothingChecked({
          value: "35.205.0.0/16",
          isWiderThanLargestRange: true,
        }),
      }),
    ).toEqual([
      {
        title: "Block a Wide Range?",
        description:
          "35.205.0.0/16 is wider than a /24 and blocks a whole network, its people with it.",
      },
    ]);
    expect(
      getBlockWarnings({ translator: english, check: nothingChecked() }),
    ).toEqual([]);
  });
});

describe("a row's Lift, Extend and Make Permanent", () => {
  let actions: BlocklistActions | null = null;
  let onChanged: MockedFn;

  function Harness(): React.ReactElement {
    actions = useBlocklistActions({
      onChanged: onChanged as unknown as () => void,
    });
    return actions.modal;
  }

  async function mount(): Promise<void> {
    onChanged = jest.fn();

    await act(async () => {
      render(<Harness />);
    });
  }

  function button(title: string): ActionButtonSchema<SecurityBlock> {
    const found: ActionButtonSchema<SecurityBlock> | undefined =
      actions!.actionButtons.find(
        (candidate: ActionButtonSchema<SecurityBlock>): boolean => {
          return candidate.title === title;
        },
      );

    expect(found).toBeDefined();
    return found!;
  }

  function isVisible(title: string, item: SecurityBlock): boolean {
    const visible: ActionButtonSchema<SecurityBlock>["isVisible"] =
      button(title).isVisible;
    return visible ? Boolean(visible(item)) : true;
  }

  test("an active block offers Lift and Extend, and Make Permanent while it has an end; an ended one offers nothing", async () => {
    await mount();

    expect(
      actions!.actionButtons.map(
        (candidate: ActionButtonSchema<SecurityBlock>): string => {
          return candidate.title;
        },
      ),
    ).toEqual(["Lift", "Extend", "Make Permanent"]);

    expect(isVisible("Lift", block())).toBe(true);
    expect(isVisible("Extend", block())).toBe(true);
    expect(isVisible("Make Permanent", block())).toBe(true);

    const permanent: SecurityBlock = block({ expiresAt: null as never });
    expect(isVisible("Lift", permanent)).toBe(true);
    expect(isVisible("Extend", permanent)).toBe(false);
    expect(isVisible("Make Permanent", permanent)).toBe(false);

    for (const state of [
      SecurityBlockState.Lifted,
      SecurityBlockState.Expired,
    ]) {
      for (const title of ["Lift", "Extend", "Make Permanent"]) {
        expect(isVisible(title, block({ state }))).toBe(false);
      }
    }
  });

  test("Make Permanent is a Security Admin's: locked, saying why, for anyone else", async () => {
    await mount();

    expect(button("Make Permanent").disabled).toBe(true);
    expect(button("Make Permanent").tooltip).toBe(UNTIL_LIFTED_REFUSED);

    cleanup();
    holdsAdmin = true;
    await mount();

    expect(button("Make Permanent").disabled).toBe(false);
  });

  test("whoever may not edit blocks sees Lift and Extend locked, with why", async () => {
    mayUpdate = false;
    await mount();

    for (const title of ["Lift", "Extend"]) {
      expect(button(title).disabled).toBe(true);
      expect(button(title).tooltip).toBe(
        "You do not have permission to edit blocks.",
      );
    }
  });

  test("Lift asks why, lifts the block and says so", async () => {
    await mount();

    await act(async () => {
      button("Lift").onClick!(block(), jest.fn(), jest.fn());
    });

    expect(lastForm().title).toBe("Lift Block");

    await act(async () => {
      await lastForm().onSubmit!({ reason: "  A partner's office  " });
    });

    expect(updateById).toHaveBeenCalledWith(
      expect.objectContaining({
        id: new ObjectID(BLOCK_ID),
        data: {
          state: SecurityBlockState.Lifted,
          liftReason: "A partner's office",
        },
      }),
    );
    expect(toast).toHaveBeenCalledWith("The block on 35.205.11.131 is lifted.");
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  test("a lift the server refuses stays open, saying why", async () => {
    updateById.mockRejectedValue(new Error("This block has ended.") as never);
    await mount();

    await act(async () => {
      button("Lift").onClick!(block(), jest.fn(), jest.fn());
    });
    await act(async () => {
      await lastForm().onSubmit!({});
    });

    expect(lastForm().error).toBeTruthy();
    expect(onChanged).not.toHaveBeenCalled();
  });

  test("Extend moves the end to the chosen length from now", async () => {
    await mount();
    const before: number = Date.now();

    await act(async () => {
      button("Extend").onClick!(block(), jest.fn(), jest.fn());
    });

    expect(lastForm().title).toBe("Extend Block");
    expect(lastForm().formProps.initialValues).toEqual({
      duration: SecurityBlockDuration.OneDay,
    });

    await act(async () => {
      await lastForm().onSubmit!({
        duration: SecurityBlockDuration.ThirtyDays,
      });
    });

    const data: { expiresAt: Date } = (
      updateById.mock.calls[0]![0] as { data: { expiresAt: Date } }
    ).data;
    const end: number = new Date(data.expiresAt).getTime();

    expect(end).toBeGreaterThanOrEqual(before + 30 * 24 * HOUR_IN_MS);
    expect(end).toBeLessThanOrEqual(Date.now() + 30 * 24 * HOUR_IN_MS);
    expect(toast).toHaveBeenCalledWith(
      "The block on 35.205.11.131 is extended.",
    );
  });

  test("Make Permanent asks first, then empties the end", async () => {
    holdsAdmin = true;
    await mount();

    expect(button("Make Permanent").getConfirmation!(block())).toEqual(
      expect.objectContaining({
        title: "Make Block Permanent",
        submitButtonText: "Make Permanent",
      }),
    );

    const onComplete: MockedFn = jest.fn();

    // Its click is the update itself, waited for before the row is told.
    const makePermanent: (...args: Array<unknown>) => Promise<void> = button(
      "Make Permanent",
    ).onClick as unknown as (...args: Array<unknown>) => Promise<void>;

    await act(async () => {
      await makePermanent(block(), onComplete, jest.fn());
    });

    expect(updateById).toHaveBeenCalledWith(
      expect.objectContaining({ data: { expiresAt: null } }),
    );
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(
      "The block on 35.205.11.131 stays until someone lifts it.",
    );
  });

  test("Lift on several rows lifts each active one, and leaves an ended one as it is, saying why", async () => {
    await mount();

    const onBulkActionEnd: MockedFn = jest.fn();
    const onProgressInfo: MockedFn = jest.fn();
    const ended: SecurityBlock = block({ state: SecurityBlockState.Expired });
    ended._id = ObjectID.generate().toString();

    await act(async () => {
      await (
        actions!.bulkLift.onClick as unknown as (
          props: unknown,
        ) => Promise<void>
      )({
        items: [block(), ended],
        onProgressInfo,
        onBulkActionStart: jest.fn(),
        onBulkActionEnd,
      });
    });

    expect(lastForm().title).toBe("Lift Blocks");

    await act(async () => {
      await lastForm().onSubmit!({ reason: "Over" });
    });

    expect(updateById).toHaveBeenCalledTimes(1);
    expect(updateById).toHaveBeenCalledWith(
      expect.objectContaining({ id: new ObjectID(BLOCK_ID) }),
    );

    const progress: Array<unknown> = onProgressInfo.mock.calls.map(
      (call: Array<unknown>): unknown => {
        return call[0];
      },
    );
    expect(JSON.stringify(progress)).toContain(ENDED_BLOCK_REASON);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});

describe("Protected Entities' Protected Automatically", () => {
  test("lists each address OneUptime protects, saying what it is", async () => {
    api.readAutomaticProtections.mockResolvedValue([
      {
        source: SecurityProtectedAddressSource.Host,
        protections: [
          {
            source: SecurityProtectedAddressSource.Host,
            protectedValue: "203.0.113.10",
            name: "web-3",
          },
        ],
        hasMore: false,
        isRead: true,
      },
      {
        source: SecurityProtectedAddressSource.LocalRange,
        protections: [
          {
            source: SecurityProtectedAddressSource.LocalRange,
            protectedValue: "10.0.0.0/8",
          },
        ],
        hasMore: false,
        isRead: true,
      },
    ] as never);

    await act(async () => {
      render(<AutomaticProtectionsCard />);
    });

    expect(screen.getByText("Protected Automatically")).toBeInTheDocument();
    expect(
      screen.getByText("203.0.113.10 is the address of host web-3."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "10.0.0.0/8 is not on the internet: it is a private, loopback, link-local or reserved range, which no edge needs to block.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(AUTOMATIC_PROTECTIONS_MORE),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(AUTOMATIC_PROTECTIONS_UNREAD),
    ).not.toBeInTheDocument();
  });

  test("says when there are more than it lists, and when some could not be read: protected all the same", async () => {
    api.readAutomaticProtections.mockResolvedValue([
      {
        source: SecurityProtectedAddressSource.Host,
        protections: [],
        hasMore: true,
        isRead: true,
      },
      {
        source: SecurityProtectedAddressSource.CloudResource,
        protections: [],
        hasMore: false,
        isRead: false,
      },
    ] as never);

    await act(async () => {
      render(<AutomaticProtectionsCard />);
    });

    expect(screen.getByText(AUTOMATIC_PROTECTIONS_MORE)).toBeInTheDocument();
    expect(screen.getByText(AUTOMATIC_PROTECTIONS_UNREAD)).toBeInTheDocument();
  });

  test("says so when they could not be read at all", async () => {
    api.readAutomaticProtections.mockRejectedValue(
      new Error("The server failed.") as never,
    );

    await act(async () => {
      render(<AutomaticProtectionsCard />);
    });

    expect(
      screen.queryByText("203.0.113.10 is the address of host web-3."),
    ).not.toBeInTheDocument();
  });
});

describe("the notice, alone", () => {
  test("links to Security Connections and Cloud Connections", () => {
    render(
      <MemoryRouter>
        <BlocklistNotEnforcedNotice cannotTell={false} />
      </MemoryRouter>,
    );

    const links: Array<HTMLElement> = screen.getAllByRole("link");
    expect(
      links.map((link: HTMLElement): string => {
        return link.textContent || "";
      }),
    ).toEqual(["Security Connections", "Cloud Connections"]);
  });
});
