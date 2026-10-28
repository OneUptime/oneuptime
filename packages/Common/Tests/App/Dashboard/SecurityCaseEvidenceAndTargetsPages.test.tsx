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
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Security Events > Settings > Response Targets, and a case's Evidence page,
 * as each hands its table what to draw. ModelTable and ModelFormModal are
 * stubbed and their props recorded: what a page hands them is its contract.
 *
 *   - Response Targets: one row a priority not archived, in the priorities'
 *     order and draggable like every list of them, edited and never created
 *     or deleted here; each target drawn in the reader's units, or No
 *     target; each edited with the duration field, which refuses what it
 *     cannot keep; every case page reads the targets again once they load.
 *   - Evidence: the case's files and links, the latest first; a file
 *     downloads from its route, a link opens in a new tab only when it is
 *     an http or https address; a file's SHA-256 under its name and size,
 *     shortened, with the whole on hover; who added it and when under it,
 *     in the table's one column; Add File and Add Link open their own
 *     forms, which file what is added on the case as its kind; only the
 *     name and the description are edited afterwards; removing one says the
 *     timeline keeps a record.
 *     Somebody who may not add evidence sees the buttons locked, and no
 *     buttons in the empty state.
 */

const recordedTables: Array<Record<string, unknown>> = [];
const recordedForms: Array<Record<string, unknown>> = [];
const invalidateMock: MockFunction = getJestMockFunction();
const openAuthenticatedUrlMock: MockFunction = getJestMockFunction();
let isCreateAllowed: boolean = true;

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      recordedTables.push(props);
      return React.createElement("div", {
        "data-testid": `model-table-${String(props["id"])}`,
      });
    },
  };
});

jest.mock("../../../UI/Components/ModelFormModal/ModelFormModal", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      recordedForms.push(props);
      return React.createElement("div", {
        "data-testid": "model-form-modal",
      });
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/PermissionGate", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Utils/PermissionGate",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      check: (): { isAllowed: boolean; disabledReason?: string } => {
        return isCreateAllowed
          ? { isAllowed: true }
          : {
              isAllowed: false,
              disabledReason: "You need the Security Member role.",
            };
      },
    },
  };
});

jest.mock("../../../UI/Utils/OpenAuthenticatedUrl", () => {
  return {
    __esModule: true,
    default: (...args: Array<unknown>): unknown => {
      return openAuthenticatedUrlMock(...args);
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseValues",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseValues",
    ) as Record<string, unknown>;

    return {
      ...actual,
      invalidateSecurityCaseValues: (...args: Array<unknown>): unknown => {
        return invalidateMock(...args);
      },
    };
  },
);

import SecurityResponseTargetsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/Settings/ResponseTargets";
import SecurityCaseEvidenceTable from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Evidence/SecurityCaseEvidenceTable";
import {
  SECURITY_CASE_EVIDENCE_TEST_IDS,
  formatEvidenceSize,
  getEvidenceLink,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Evidence/SecurityCaseEvidenceCopy";
import { RESPONSE_TARGETS_TEST_IDS } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/ResponseTargets/ResponseTargetsCopy";
import { ResponseTargetUnit } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/ResponseTargets/ResponseTargetDuration";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import SecurityCaseEvidence from "../../../Models/DatabaseModels/SecurityCaseEvidence";
import SecurityCasePriority from "../../../Models/DatabaseModels/SecurityCasePriority";
import User from "../../../Models/DatabaseModels/User";
import OneUptimeDate from "../../../Types/Date";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import URL from "../../../Types/API/URL";
import Route from "../../../Types/API/Route";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import SecurityCaseEvidenceKind from "../../../Types/SecurityCase/SecurityCaseEvidenceKind";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const CASE_ID: string = "22222222-2222-4222-8222-222222222222";
const EVIDENCE_ID: string = "44444444-4444-4444-8444-444444444444";
const SHA256: string =
  "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

interface Column {
  field: Record<string, unknown>;
  title: string;
  getElement?: (item: unknown) => ReactElement;
  headerTooltip?: string;
  hideTitleOnMobile?: boolean;
  contentClassName?: string;
}

interface FormField {
  field: Record<string, unknown>;
  title: string;
  fieldType?: string;
  required?: boolean;
  placeholder?: string;
  customValidation?: (values: Record<string, unknown>) => string | null;
  getCustomElement?: (
    values: Record<string, unknown>,
    props: Record<string, unknown>,
  ) => ReactElement;
}

interface ActionButton {
  title: string;
  isVisible: (item: unknown) => boolean;
  onClick: (item: unknown, done: () => void) => void;
}

function lastTable(): Record<string, unknown> {
  expect(recordedTables.length).toBeGreaterThan(0);
  return recordedTables[recordedTables.length - 1]!;
}

function columnsOf(table: Record<string, unknown>): Array<Column> {
  return table["columns"] as Array<Column>;
}

function drawElement(element: ReactElement): HTMLElement {
  const { container } = render(<MemoryRouter>{element}</MemoryRouter>);
  return container;
}

const PAGE_PROPS: PageComponentProps = {} as unknown as PageComponentProps;

beforeEach(() => {
  recordedTables.length = 0;
  recordedForms.length = 0;
  isCreateAllowed = true;
  invalidateMock.mockReset();
  openAuthenticatedUrlMock.mockReset();
  openAuthenticatedUrlMock.mockResolvedValue(undefined as never);
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest
    .spyOn(Navigation, "getCurrentRoute")
    .mockReturnValue(new Route("/dashboard"));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Security Events > Settings > Response Targets", () => {
  function drawPage(): Record<string, unknown> {
    render(
      <MemoryRouter>
        <SecurityResponseTargetsPage {...PAGE_PROPS} />
      </MemoryRouter>,
    );

    return lastTable();
  }

  test("one row a priority not archived, in their order, draggable, edited here and never created or deleted", () => {
    const table: Record<string, unknown> = drawPage();

    expect(table["modelType"]).toBe(SecurityCasePriority);
    expect(table["id"]).toBe(RESPONSE_TARGETS_TEST_IDS.table);
    expect(table["query"]).toEqual({
      projectId: new ObjectID(PROJECT_ID),
      isArchived: false,
    });
    expect(table["isEditable"]).toBe(true);
    expect(table["isCreateable"]).toBe(false);
    expect(table["isDeleteable"]).toBe(false);
    expect(table["enableDragAndDrop"]).toBe(true);
    expect(table["dragDropIndexField"]).toBe("order");
    expect(table["sortBy"]).toBe("order");
    expect(table["sortOrder"]).toBe(SortOrder.Ascending);
    expect(table["cardProps"]).toEqual(
      expect.objectContaining({ title: "Response Targets" }),
    );
    expect(
      columnsOf(table).map((column: Column): string => {
        return column.title;
      }),
    ).toEqual(["Priority", "Acknowledge Within", "Contain Within"]);
  });

  test("each target in the reader's units, or No target", () => {
    const table: Record<string, unknown> = drawPage();
    const [, acknowledge, contain] = columnsOf(table);

    const priority: SecurityCasePriority = new SecurityCasePriority();
    priority.acknowledgeWithinInMinutes = 15;
    priority.containWithinInMinutes = 240;

    expect(drawElement(acknowledge!.getElement!(priority))).toHaveTextContent(
      "15 min",
    );
    cleanup();
    expect(drawElement(contain!.getElement!(priority))).toHaveTextContent(
      "4 h",
    );
    cleanup();

    const none: SecurityCasePriority = new SecurityCasePriority();
    expect(drawElement(acknowledge!.getElement!(none))).toHaveTextContent(
      "No target",
    );
  });

  test("each is edited with the duration field, starting in minutes or hours, which refuses what it cannot keep", () => {
    const table: Record<string, unknown> = drawPage();
    const fields: Array<FormField> = table["formFields"] as Array<FormField>;

    expect(
      fields.map((field: FormField): string => {
        return Object.keys(field.field)[0]!;
      }),
    ).toEqual(["acknowledgeWithinInMinutes", "containWithinInMinutes"]);

    for (const field of fields) {
      expect(field.required).toBe(false);
      expect(
        field.customValidation!({
          [Object.keys(field.field)[0]!]: { amount: "0", unit: "Hours" },
        }),
      ).toBe("Enter a whole number from 1 up, or leave it empty.");
      expect(
        field.customValidation!({
          [Object.keys(field.field)[0]!]: { amount: "400", unit: "Days" },
        }),
      ).toBe("A target can be a year at the most.");
      expect(
        field.customValidation!({ [Object.keys(field.field)[0]!]: 240 }),
      ).toBeNull();
      expect(
        field.customValidation!({ [Object.keys(field.field)[0]!]: null }),
      ).toBeNull();
    }

    // An empty acknowledge target starts in minutes, a contain one in hours.
    const acknowledgeField: HTMLElement = drawElement(
      fields[0]!.getCustomElement!({ acknowledgeWithinInMinutes: null }, {}),
    );
    expect(acknowledgeField).toHaveTextContent(ResponseTargetUnit.Minutes);
    cleanup();

    const containField: HTMLElement = drawElement(
      fields[1]!.getCustomElement!({ containWithinInMinutes: null }, {}),
    );
    expect(containField).toHaveTextContent(ResponseTargetUnit.Hours);
  });

  test("once the targets load, every case page reads them again", () => {
    const table: Record<string, unknown> = drawPage();

    (table["onFetchSuccess"] as () => void)();

    expect(invalidateMock).toHaveBeenCalledTimes(1);
  });
});

describe("a case's Evidence", () => {
  function drawTable(): Record<string, unknown> {
    render(
      <MemoryRouter>
        <SecurityCaseEvidenceTable caseId={new ObjectID(CASE_ID)} />
      </MemoryRouter>,
    );

    return lastTable();
  }

  function evidence(
    overrides: Partial<SecurityCaseEvidence> = {},
  ): SecurityCaseEvidence {
    const model: SecurityCaseEvidence = new SecurityCaseEvidence();
    model._id = EVIDENCE_ID;
    Object.assign(model, overrides);
    return model;
  }

  const FILE: SecurityCaseEvidence = evidence({
    kind: SecurityCaseEvidenceKind.File,
    name: "Proxy capture",
    fileName: "proxy.pcap",
    fileSizeInBytes: 1229,
    sha256: SHA256,
  });

  test("the case's files and links, the latest first; only names and descriptions are edited; removing one says the timeline keeps a record", () => {
    const table: Record<string, unknown> = drawTable();

    expect(table["modelType"]).toBe(SecurityCaseEvidence);
    expect(table["query"]).toEqual({
      projectId: new ObjectID(PROJECT_ID),
      securityCaseId: new ObjectID(CASE_ID),
    });
    expect(table["sortBy"]).toBe("createdAt");
    expect(table["sortOrder"]).toBe(SortOrder.Descending);
    expect(table["isCreateable"]).toBe(false);
    expect(table["isEditable"]).toBe(true);
    expect(table["isDeleteable"]).toBe(true);
    expect(table["deleteConfirmationWarning"]).toBe(
      "The case's timeline keeps a record of what was removed, and by whom.",
    );
    expect(
      (table["formFields"] as Array<FormField>).map(
        (field: FormField): string => {
          return Object.keys(field.field)[0]!;
        },
      ),
    ).toEqual(["name", "description"]);
    /*
     * One column, read the way a list of files is: who added each and when
     * is a line under it, so nothing is cut short and the rows never scroll
     * sideways beside a side menu.
     */
    expect(
      columnsOf(table).map((column: Column): string => {
        return column.title;
      }),
    ).toEqual(["Evidence"]);
    // A phone's card is the evidence, with no "Evidence" over it.
    expect(columnsOf(table)[0]!.hideTitleOnMobile).toBe(true);
    /*
     * Beside the side menu at 768px, the row's box and its Download and ⋯
     * leave the evidence 9rem: the table's own 10rem floor scrolled it.
     */
    expect(columnsOf(table)[0]!.contentClassName).toBe("min-w-[9rem]");
    expect(table["selectMoreFields"]).toEqual(
      expect.objectContaining({
        createdAt: true,
        createdByUser: { name: true, email: true },
      }),
    );
  });

  test("a file reads its name, then its file name and size, then its SHA-256 short, the whole on hover; a link reads its address", () => {
    const table: Record<string, unknown> = drawTable();
    const [evidenceColumn] = columnsOf(table);

    drawElement(evidenceColumn!.getElement!(FILE));
    expect(
      screen.getByTestId(SECURITY_CASE_EVIDENCE_TEST_IDS.name),
    ).toHaveTextContent("Proxy capture");
    expect(
      screen.getByTestId(SECURITY_CASE_EVIDENCE_TEST_IDS.meta),
    ).toHaveTextContent("proxy.pcap · 1.2 KB");
    const sha: HTMLElement = screen.getByTestId(
      SECURITY_CASE_EVIDENCE_TEST_IDS.sha256,
    );
    expect(sha.tagName).toBe("CODE");
    expect(sha).toHaveTextContent(/^2cf24dba…9824$/);
    expect(sha).toHaveAttribute("title", SHA256);
    // What the hash is for, on its label.
    expect(screen.getByText("SHA-256", { exact: true })).toHaveAttribute(
      "title",
      "The SHA-256 of the file as it was uploaded. A download whose SHA-256 is the same is what was kept.",
    );
    expect(
      screen.getByRole("button", { name: "Copy SHA-256" }),
    ).toBeInTheDocument();
    // Nothing says when it was added: no line for it.
    expect(
      screen.queryByTestId(SECURITY_CASE_EVIDENCE_TEST_IDS.added),
    ).toBeNull();
    cleanup();

    // A link has an address and no hash, whatever a row says.
    drawElement(
      evidenceColumn!.getElement!(
        evidence({
          kind: SecurityCaseEvidenceKind.Link,
          name: "Ticket 7",
          url: URL.fromString("https://intranet.example/ticket/7"),
          sha256: SHA256,
        }),
      ),
    );
    expect(
      screen.getByTestId(SECURITY_CASE_EVIDENCE_TEST_IDS.meta),
    ).toHaveTextContent("https://intranet.example/ticket/7");
    expect(
      screen.queryByTestId(SECURITY_CASE_EVIDENCE_TEST_IDS.sha256),
    ).toBeNull();
  });

  test("under each piece of evidence, who added it and when, the date and time under the pointer", () => {
    const table: Record<string, unknown> = drawTable();
    const [evidenceColumn] = columnsOf(table);
    const threeHoursAgo: Date = OneUptimeDate.addRemoveHours(
      OneUptimeDate.getCurrentDate(),
      -3,
    );
    const maya: User = new User();
    maya.name = new Name("Maya Chen");

    drawElement(
      evidenceColumn!.getElement!(
        evidence({
          kind: SecurityCaseEvidenceKind.File,
          name: "Proxy capture",
          createdAt: threeHoursAgo,
          createdByUser: maya,
        }),
      ),
    );
    const added: HTMLElement = screen.getByTestId(
      SECURITY_CASE_EVIDENCE_TEST_IDS.added,
    );
    expect(added).toHaveTextContent(/^Added by Maya Chen 3 hours ago$/);
    const time: HTMLElement = added.querySelector("time")!;
    expect(time).toHaveTextContent("3 hours ago");
    expect(time).toHaveAttribute("dateTime", threeHoursAgo.toISOString());
    expect(time).toHaveAttribute(
      "title",
      OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(threeHoursAgo),
    );
    cleanup();

    // A member with no name yet: their email.
    const noName: User = new User();
    noName.email = new Email("k.morgan@acme-commerce.example");
    drawElement(
      evidenceColumn!.getElement!(
        evidence({
          kind: SecurityCaseEvidenceKind.Link,
          name: "Ticket 7",
          url: URL.fromString("https://intranet.example/ticket/7"),
          createdAt: threeHoursAgo,
          createdByUser: noName,
        }),
      ),
    );
    expect(
      screen.getByTestId(SECURITY_CASE_EVIDENCE_TEST_IDS.added),
    ).toHaveTextContent("Added by k.morgan@acme-commerce.example 3 hours ago");
    cleanup();

    // Through the API: nobody's name to give.
    drawElement(
      evidenceColumn!.getElement!(
        evidence({
          kind: SecurityCaseEvidenceKind.File,
          name: "Proxy capture",
          createdAt: threeHoursAgo,
        }),
      ),
    );
    expect(
      screen.getByTestId(SECURITY_CASE_EVIDENCE_TEST_IDS.added),
    ).toHaveTextContent(/^Added 3 hours ago$/);
  });

  test("a file downloads from its route; a link opens in a new tab, only an http or https one", () => {
    const table: Record<string, unknown> = drawTable();
    const [download, openLink] = table["actionButtons"] as Array<ActionButton>;
    const link: SecurityCaseEvidence = evidence({
      kind: SecurityCaseEvidenceKind.Link,
      name: "Ticket 7",
      url: URL.fromString("https://intranet.example/ticket/7"),
    });
    const done: MockFunction = getJestMockFunction();
    const navigate: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((): void => {});

    expect(download!.title).toBe("Download");
    expect(download!.isVisible(FILE)).toBe(true);
    expect(download!.isVisible(link)).toBe(false);

    download!.onClick(FILE, done as unknown as () => void);
    expect(openAuthenticatedUrlMock).toHaveBeenCalledTimes(1);
    expect(String(openAuthenticatedUrlMock.mock.calls[0]![0])).toMatch(
      new RegExp(`/security-case-evidence/file/${PROJECT_ID}/${EVIDENCE_ID}$`),
    );
    expect(done).toHaveBeenCalledTimes(1);

    expect(openLink!.title).toBe("Open Link");
    expect(openLink!.isVisible(link)).toBe(true);
    expect(openLink!.isVisible(FILE)).toBe(false);

    openLink!.onClick(link, done as unknown as () => void);
    expect(navigate).toHaveBeenCalledWith(
      URL.fromString("https://intranet.example/ticket/7"),
      { openInNewTab: true },
    );
  });

  test("an address that is not http or https is never opened", () => {
    expect(
      getEvidenceLink({
        kind: SecurityCaseEvidenceKind.Link,
        url: "javascript:alert(1)" as never,
      }),
    ).toBeNull();
    expect(
      getEvidenceLink({
        kind: SecurityCaseEvidenceKind.File,
        url: URL.fromString("https://example.com"),
      }),
    ).toBeNull();
    expect(formatEvidenceSize(512)).toBe("512 B");
    expect(formatEvidenceSize(1229)).toBe("1.2 KB");
    expect(formatEvidenceSize(5 * 1024 * 1024)).toBe("5 MB");
    expect(formatEvidenceSize(undefined)).toBe("");
  });

  test("Add File and Add Link open their own forms, which file what is added on the case as its kind", async () => {
    const table: Record<string, unknown> = drawTable();
    const buttons: Array<{
      title: string;
      disabled: boolean;
      onClick: () => void;
    }> = (
      table["cardProps"] as {
        buttons: Array<{
          title: string;
          disabled: boolean;
          onClick: () => void;
        }>;
      }
    ).buttons;

    expect(
      buttons.map((button: { title: string }): string => {
        return button.title;
      }),
    ).toEqual(["Add File", "Add Link"]);

    await act(async () => {
      buttons[0]!.onClick();
    });

    let form: Record<string, unknown> =
      recordedForms[recordedForms.length - 1]!;
    expect(form["title"]).toBe("Add a File as Evidence");
    expect(
      (form["formProps"] as { fields: Array<FormField> }).fields.map(
        (field: FormField): string => {
          return Object.keys(field.field)[0]!;
        },
      ),
    ).toEqual(["file", "name", "description"]);

    const added: SecurityCaseEvidence = await (
      form["onBeforeCreate"] as (
        item: SecurityCaseEvidence,
      ) => Promise<SecurityCaseEvidence>
    )(new SecurityCaseEvidence());
    expect(added.kind).toBe(SecurityCaseEvidenceKind.File);
    expect(added.securityCaseId?.toString()).toBe(CASE_ID);
    expect(added.projectId?.toString()).toBe(PROJECT_ID);

    await act(async () => {
      (form["onClose"] as () => void)();
    });
    const latestTable: Record<string, unknown> = lastTable();
    await act(async () => {
      (
        latestTable["cardProps"] as { buttons: Array<{ onClick: () => void }> }
      ).buttons[1]!.onClick();
    });

    form = recordedForms[recordedForms.length - 1]!;
    expect(form["title"]).toBe("Add a Link as Evidence");
    expect(
      (form["formProps"] as { fields: Array<FormField> }).fields.map(
        (field: FormField): string => {
          return Object.keys(field.field)[0]!;
        },
      ),
    ).toEqual(["url", "name", "description"]);
    expect(
      (
        await (
          form["onBeforeCreate"] as (
            item: SecurityCaseEvidence,
          ) => Promise<SecurityCaseEvidence>
        )(new SecurityCaseEvidence())
      ).kind,
    ).toBe(SecurityCaseEvidenceKind.Link);
  });

  test("somebody who may not add evidence sees the buttons locked, with why, and none in the empty state", () => {
    isCreateAllowed = false;
    const table: Record<string, unknown> = drawTable();
    const buttons: Array<{ disabled: boolean; tooltip?: string }> = (
      table["cardProps"] as {
        buttons: Array<{ disabled: boolean; tooltip?: string }>;
      }
    ).buttons;

    for (const button of buttons) {
      expect(button.disabled).toBe(true);
      expect(button.tooltip).toBe("You need the Security Member role.");
    }
    expect(
      (table["emptyState"] as { actions: Array<unknown> }).actions,
    ).toEqual([]);
  });
});
