import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";

/*
 * THE COMPLIANCE PAPERWORK'S PAGES (#10375): Review Drafts, a store's
 * Impact Assessment, a framework's Audit Evidence and the record of
 * processing on Compliance. A draft reads as a draft, with the facts it
 * rests on a click away; confirming or editing is one press, sent with the
 * draft the person was shown; "not legal advice" is said once. Only the
 * network is stubbed.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
        i18n: { language: "en" },
      };
    },
  };
});

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): string => {
      return props.text;
    },
  };
});

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownEditor", () => {
  return {
    __esModule: true,
    default: (props: {
      initialValue?: string;
      dataTestId?: string;
      onChange: (value: string) => void;
    }): ReactElement => {
      return (
        <textarea
          data-testid={props.dataTestId}
          defaultValue={props.initialValue}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
            props.onChange(event.target.value);
          }}
        />
      );
    },
  };
});

import DataSecurityApi from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/DataSecurityApi";
import { NOT_LEGAL_ADVICE } from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/ComplianceDraftsCopy";
import RecordOfProcessingCard from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/RecordOfProcessingCard";
import DataSecurityAuditEvidencePage, {
  readEvidenceFramework,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/DataSecurity/AuditEvidence";
import ReviewDraftsPage, {
  getStoresToReview,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/DataSecurity/ReviewDrafts";
import DataStoreImpactAssessment from "../../../../App/FeatureSet/Dashboard/src/Pages/DataSecurity/StoreView/ImpactAssessment";
import { DataStoreViewOutletContext } from "../../../../App/FeatureSet/Dashboard/src/Pages/DataSecurity/StoreView/DataStoreViewContext";
import { AuditEvidenceParagraphSource } from "../../../Types/DataSecurity/AuditEvidence";
import ComplianceFramework from "../../../Types/DataSecurity/ComplianceFramework";
import {
  ComplianceFact,
  ComplianceFactKind,
} from "../../../Types/DataSecurity/ComplianceFacts";
import { ComplianceRequirementStatus } from "../../../Types/DataSecurity/ComplianceRequirementCatalog";
import DataCategory from "../../../Types/DataSecurity/DataCategory";
import {
  DataSecurityAuditEvidenceResponse,
  DataSecurityImpactAssessmentResponse,
  DataSecurityRecordOfProcessingResponse,
  DataSecurityRecordOfProcessingRow,
  ImpactAssessmentStatus,
  RecordRowState,
} from "../../../Types/DataSecurity/DataSecurityApiTypes";
import DataSensitivity from "../../../Types/DataSecurity/DataSensitivity";
import { DataStoreKind } from "../../../Types/DataSecurity/DataStoreKind";
import {
  ImpactAssessmentPart,
  ImpactAssessmentSectionSource,
  ImpactAssessmentTrigger,
} from "../../../Types/DataSecurity/ImpactAssessment";
import {
  RecordField,
  RecordFieldAction,
  RecordFieldStatus,
  RecordLegalBasis,
  RecordPeople,
} from "../../../Types/DataSecurity/RecordOfProcessing";
import ObjectID from "../../../Types/ObjectID";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

const FIRST_ID: string = "10375000-0000-4000-8000-00000000f001";
const SECOND_ID: string = "10375000-0000-4000-8000-00000000f002";
const DONE_ID: string = "10375000-0000-4000-8000-00000000f003";
const DRAFTED_AT: string = "2026-11-22T08:00:00.000Z";

const HOLDS: ComplianceFact = {
  id: "F1",
  key: "store:holds",
  kind: ComplianceFactKind.StoreHolds,
  dataTypes: ["Email address"],
  categories: [DataCategory.ContactAndIdentity],
  sensitivity: DataSensitivity.Confidential,
  records: 12000,
};

function rowOf(
  id: string,
  overrides: Partial<DataSecurityRecordOfProcessingRow> = {},
): DataSecurityRecordOfProcessingRow {
  return {
    dataStoreId: id,
    name: id === FIRST_ID ? "orders-db" : id === SECOND_ID ? "crm" : "payroll",
    kind: DataStoreKind.AwsRdsInstance,
    provider: "aws",
    region: "eu-west-1",
    environment: "Production",
    sensitivity: DataSensitivity.Confidential,
    dataCategories: [DataCategory.ContactAndIdentity],
    dataTypeNames: ["Email address"],
    owners: [],
    purpose: "",
    retention: "Two years",
    frameworks: [ComplianceFramework.GDPR],
    legalBasis: "",
    dataSubjects: [RecordPeople.Customers],
    recipients: [],
    transfers: [],
    transfersUnknownBecause: null,
    state: RecordRowState.ToReview,
    impactAssessment: {
      status: ImpactAssessmentStatus.NotNeeded,
      triggers: [],
    },
    fields: [
      {
        field: RecordField.Purpose,
        status: RecordFieldStatus.Drafted,
        value: "",
        draft: {
          value: "Customer orders, for fulfilment and support",
          reason: "",
          factKeys: [HOLDS.key],
          factsHash: "hash",
          draftedAt: DRAFTED_AT,
          language: "en",
        },
      },
      {
        field: RecordField.Retention,
        status: RecordFieldStatus.Written,
        value: "Two years",
      },
      {
        field: RecordField.LegalBasis,
        status: RecordFieldStatus.Empty,
        value: "",
      },
      {
        field: RecordField.People,
        status: RecordFieldStatus.Confirmed,
        value: [RecordPeople.Customers],
      },
    ],
    ...overrides,
  };
}

function recordOf(
  rows: Array<DataSecurityRecordOfProcessingRow>,
): DataSecurityRecordOfProcessingResponse {
  return {
    rows,
    counts: { toReview: 2, complete: 1, incomplete: 0 },
    isAiEnabled: true,
    isAutomaticAiOn: true,
    canEdit: true,
    canDraft: true,
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let index: number = 0; index < 20; index++) {
      await Promise.resolve();
    }
  });
}

async function renderPage(element: ReactElement): Promise<void> {
  await act(async () => {
    render(<MemoryRouter>{element}</MemoryRouter>);
  });
  await flush();
}

async function renderInStore(element: ReactElement): Promise<void> {
  const context: DataStoreViewOutletContext = {
    dataStoreId: new ObjectID(FIRST_ID),
    dataStore: null,
    refresh: (): void => {
      // Nothing to read again here.
    },
  };

  await act(async () => {
    render(
      <MemoryRouter initialEntries={[`/data-stores/${FIRST_ID}/page`]}>
        <Routes>
          <Route path="/data-stores/:id" element={<Outlet context={context} />}>
            <Route path="page" element={element} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
  });
  await flush();
}

const PAGE_PROPS: {
  pageRoute: never;
  currentProject: null;
  hasPaymentMethod: boolean;
} = {
  pageRoute: undefined as never,
  currentProject: null,
  hasPaymentMethod: true,
};

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/data-security/compliance`);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Review Drafts", () => {
  test("walks the stores waiting for a person, a linked one first", () => {
    const rows: Array<DataSecurityRecordOfProcessingRow> = [
      rowOf(FIRST_ID),
      rowOf(SECOND_ID),
      rowOf(DONE_ID, { state: RecordRowState.Complete }),
    ];

    expect(getStoresToReview(rows, null)).toEqual([FIRST_ID, SECOND_ID]);
    expect(getStoresToReview(rows, SECOND_ID.toUpperCase())).toEqual([
      SECOND_ID,
      FIRST_ID,
    ]);
    // A store from its own link, even with nothing waiting, comes first.
    expect(getStoresToReview(rows, DONE_ID)).toEqual([
      DONE_ID,
      FIRST_ID,
      SECOND_ID,
    ]);
    expect(getStoresToReview(rows, "not-a-store")).toEqual([
      FIRST_ID,
      SECOND_ID,
    ]);
  });

  test("one store at a time: its draft marked, its facts a click away, confirmed with the draft that was shown", async () => {
    goTo(
      `/dashboard/${PROJECT_ID}/data-security/compliance/review-drafts?store=${SECOND_ID}`,
    );
    jest
      .spyOn(DataSecurityApi, "getRecordOfProcessing")
      .mockImplementation(
        async (options?: {
          dataStoreId?: ObjectID | undefined;
        }): Promise<DataSecurityRecordOfProcessingResponse> => {
          if (!options?.dataStoreId) {
            return recordOf([
              rowOf(FIRST_ID),
              rowOf(SECOND_ID),
              rowOf(DONE_ID, { state: RecordRowState.Complete }),
            ]);
          }

          return recordOf([
            rowOf(options.dataStoreId.toString(), { facts: [HOLDS] }),
          ]);
        },
      );
    const confirmed: SpyInstance<typeof DataSecurityApi.applyRecordField> = jest
      .spyOn(DataSecurityApi, "applyRecordField")
      .mockResolvedValue({
        row: rowOf(SECOND_ID, {
          purpose: "Customer orders, for fulfilment and support",
          fields: [
            {
              field: RecordField.Purpose,
              status: RecordFieldStatus.Confirmed,
              value: "Customer orders, for fulfilment and support",
            },
          ],
        }),
      });

    await renderPage(<ReviewDraftsPage {...PAGE_PROPS} />);

    expect(screen.getByText("Store 1 of 2")).toBeInTheDocument();
    expect(screen.getByText("crm")).toBeInTheDocument();
    expect(screen.getAllByText(NOT_LEGAL_ADVICE)).toHaveLength(1);

    const purpose: HTMLElement = screen.getByTestId(
      "data-security-store-record-purpose",
    );

    expect(purpose).toHaveAttribute("data-status", RecordFieldStatus.Drafted);
    expect(
      within(purpose).getByText("Drafted by OneUptime AI"),
    ).toBeInTheDocument();
    expect(
      within(purpose).getByText("Customer orders, for fulfilment and support"),
    ).toBeInTheDocument();

    // The facts it rests on, one click away.
    await act(async () => {
      fireEvent.click(
        within(purpose).getByRole("button", {
          name: "Show the 1 fact it rests on",
        }),
      );
    });
    expect(
      within(purpose).getByTestId("data-security-store-record-purpose-facts"),
    ).toHaveTextContent("Email address");

    // A person's own words and a confirmed value carry no button that drafts over them.
    expect(
      screen.getByTestId("data-security-store-record-retention"),
    ).toHaveAttribute("data-status", RecordFieldStatus.Written);

    await act(async () => {
      fireEvent.click(
        screen.getByTestId("data-security-store-record-purpose-confirm"),
      );
    });
    await flush();

    expect(confirmed).toHaveBeenCalledWith({
      dataStoreId: SECOND_ID,
      field: RecordField.Purpose,
      action: RecordFieldAction.Confirm,
      value: undefined,
      shownDraftedAt: DRAFTED_AT,
    });
    expect(
      screen.getByTestId("data-security-store-record-purpose"),
    ).toHaveAttribute("data-status", RecordFieldStatus.Confirmed);

    // On to the next store.
    await act(async () => {
      fireEvent.click(screen.getByTestId("data-security-review-drafts-next"));
    });
    await flush();

    expect(screen.getByText("Store 2 of 2")).toBeInTheDocument();
    expect(screen.getByText("orders-db")).toBeInTheDocument();
    expect(
      screen.getByTestId("data-security-review-drafts-done"),
    ).toBeInTheDocument();
  });

  test("Edit turns a draft into the person's own words, and the next store waits until they are saved", async () => {
    goTo(`/dashboard/${PROJECT_ID}/data-security/compliance/review-drafts`);
    jest
      .spyOn(DataSecurityApi, "getRecordOfProcessing")
      .mockImplementation(
        async (options?: {
          dataStoreId?: ObjectID | undefined;
        }): Promise<DataSecurityRecordOfProcessingResponse> => {
          return recordOf(
            options?.dataStoreId
              ? [rowOf(options.dataStoreId.toString(), { facts: [HOLDS] })]
              : [rowOf(FIRST_ID), rowOf(SECOND_ID)],
          );
        },
      );
    const written: SpyInstance<typeof DataSecurityApi.applyRecordField> = jest
      .spyOn(DataSecurityApi, "applyRecordField")
      .mockResolvedValue({ row: rowOf(FIRST_ID) });

    await renderPage(<ReviewDraftsPage {...PAGE_PROPS} />);

    await act(async () => {
      fireEvent.click(
        screen.getByTestId("data-security-store-record-purpose-edit"),
      );
    });
    await act(async () => {
      fireEvent.change(
        screen.getByTestId("data-security-store-record-purpose-editor"),
        { target: { value: "Orders, and the invoices they need" } },
      );
    });

    // Leaving now would lose it: the next store waits until it is saved or let go.
    expect(
      screen.getByTestId("data-security-review-drafts-next"),
    ).toBeDisabled();

    await act(async () => {
      fireEvent.click(
        screen.getByTestId("data-security-store-record-purpose-save"),
      );
    });
    await flush();

    expect(written).toHaveBeenCalledWith({
      dataStoreId: FIRST_ID,
      field: RecordField.Purpose,
      action: RecordFieldAction.Write,
      value: "Orders, and the invoices they need",
      shownDraftedAt: undefined,
    });
    expect(
      screen.getByTestId("data-security-review-drafts-next"),
    ).not.toBeDisabled();
  });

  test("nothing waiting says so, with the way back", async () => {
    goTo(`/dashboard/${PROJECT_ID}/data-security/compliance/review-drafts`);
    jest
      .spyOn(DataSecurityApi, "getRecordOfProcessing")
      .mockResolvedValue(
        recordOf([rowOf(DONE_ID, { state: RecordRowState.Complete })]),
      );

    await renderPage(<ReviewDraftsPage {...PAGE_PROPS} />);

    expect(screen.getByText("Nothing left to review")).toBeInTheDocument();
    expect(screen.getByText("Back to Compliance")).toBeInTheDocument();
  });
});

function assessmentOf(
  overrides: Partial<DataSecurityImpactAssessmentResponse> = {},
): DataSecurityImpactAssessmentResponse {
  return {
    dataStoreId: FIRST_ID,
    storeName: "orders-db",
    storeKind: DataStoreKind.AwsRdsInstance,
    region: "eu-west-1",
    status: ImpactAssessmentStatus.Needed,
    triggers: [
      {
        trigger: ImpactAssessmentTrigger.LargeScale,
        records: 250000,
      },
    ],
    assessment: null,
    facts: [HOLDS],
    staleParts: [],
    editors: {},
    isAiEnabled: true,
    canEdit: true,
    canDraft: true,
    ...overrides,
  };
}

describe("a store's Impact Assessment", () => {
  test("a store that needs none says so, and offers nothing to draft", async () => {
    jest.spyOn(DataSecurityApi, "getImpactAssessment").mockResolvedValue(
      assessmentOf({
        status: ImpactAssessmentStatus.NotNeeded,
        triggers: [],
      }),
    );

    await renderInStore(<DataStoreImpactAssessment {...PAGE_PROPS} />);

    expect(
      screen.getByText("This store does not need an assessment"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("data-security-impact-assessment-draft"),
    ).not.toBeInTheDocument();
  });

  test("says why the store needs one, and drafts Article 35(7)'s parts, each saying who wrote it", async () => {
    jest
      .spyOn(DataSecurityApi, "getImpactAssessment")
      .mockResolvedValue(assessmentOf());
    const drafted: SpyInstance<typeof DataSecurityApi.draftImpactAssessment> =
      jest.spyOn(DataSecurityApi, "draftImpactAssessment").mockResolvedValue(
        assessmentOf({
          status: ImpactAssessmentStatus.Drafted,
          assessment: {
            version: 1,
            language: "en",
            facts: [HOLDS],
            triggers: [ImpactAssessmentTrigger.LargeScale],
            draftedAt: DRAFTED_AT,
            sections: {
              [ImpactAssessmentPart.Processing]: {
                part: ImpactAssessmentPart.Processing,
                markdown: "Email addresses of about 12,000 customers.",
                source: ImpactAssessmentSectionSource.Drafted,
                factKeys: [HOLDS.key],
                draftedAt: DRAFTED_AT,
              },
            },
          },
        }),
      );

    await renderInStore(<DataStoreImpactAssessment {...PAGE_PROPS} />);

    expect(screen.getByText("Why this store needs one")).toBeInTheDocument();
    expect(
      screen.getByTestId("data-security-impact-assessment-triggers"),
    ).toHaveTextContent("It holds data about many people");
    expect(screen.getAllByText(NOT_LEGAL_ADVICE)).toHaveLength(1);

    await act(async () => {
      fireEvent.click(
        screen.getByTestId("data-security-impact-assessment-draft"),
      );
    });
    await flush();

    expect(drafted).toHaveBeenCalledTimes(1);

    const processing: HTMLElement = screen.getByTestId(
      "data-security-impact-assessment-processing",
    );

    expect(processing).toHaveTextContent("1. The Processing and Its Purposes");
    expect(processing).toHaveTextContent("Art. 35(7)(a)");
    expect(processing).toHaveTextContent(
      "Email addresses of about 12,000 customers.",
    );
    expect(processing).toHaveTextContent("Drafted by OneUptime AI");
    expect(
      within(processing).getByRole("button", {
        name: "Show the 1 fact it rests on",
      }),
    ).toBeInTheDocument();
    // A part not drafted yet says so.
    expect(
      screen.getByTestId("data-security-impact-assessment-risks"),
    ).toHaveTextContent("Not written yet.");
    // Drafted, the button drafts only what nobody edited, again.
    expect(screen.getByText("Draft Again")).toBeInTheDocument();
  });

  test("Edit makes a part the person's own, saved as they wrote it", async () => {
    jest.spyOn(DataSecurityApi, "getImpactAssessment").mockResolvedValue(
      assessmentOf({
        assessment: {
          version: 1,
          language: "en",
          facts: [HOLDS],
          triggers: [],
          sections: {
            [ImpactAssessmentPart.Risks]: {
              part: ImpactAssessmentPart.Risks,
              markdown: "Drafted risks.",
              source: ImpactAssessmentSectionSource.Drafted,
              factKeys: [HOLDS.key],
              draftedAt: DRAFTED_AT,
            },
          },
        },
      }),
    );
    const edited: SpyInstance<typeof DataSecurityApi.editImpactAssessment> =
      jest
        .spyOn(DataSecurityApi, "editImpactAssessment")
        .mockResolvedValue(assessmentOf());

    await renderInStore(<DataStoreImpactAssessment {...PAGE_PROPS} />);

    await act(async () => {
      fireEvent.click(
        screen.getByTestId("data-security-impact-assessment-risks-edit"),
      );
    });
    await act(async () => {
      fireEvent.change(
        screen.getByTestId("data-security-impact-assessment-risks-editor"),
        { target: { value: "Our own words about the risks." } },
      );
    });
    // Drafting again while a part is being edited would lose it.
    expect(
      screen.getByTestId("data-security-impact-assessment-draft"),
    ).toBeDisabled();

    await act(async () => {
      fireEvent.click(
        screen.getByTestId("data-security-impact-assessment-risks-save"),
      );
    });
    await flush();

    expect(edited).toHaveBeenCalledWith({
      dataStoreId: new ObjectID(FIRST_ID),
      part: ImpactAssessmentPart.Risks,
      markdown: "Our own words about the risks.",
    });
  });
});

function evidenceOf(): DataSecurityAuditEvidenceResponse {
  return {
    framework: ComplianceFramework.SOC2,
    fullName: "SOC 2 Trust Services Criteria",
    scope: "Every data store.",
    score: 50,
    storesInScope: 2,
    periodInDays: 90,
    requirements: [
      {
        requirement: "A1.2",
        title: "Backup and recovery",
        status: ComplianceRequirementStatus.Passing,
        facts: [
          {
            id: "E1",
            key: "A1.2:scope",
            kind: ComplianceFactKind.RequirementScope,
            stores: 2,
            storeNames: ["orders-db", "crm"],
            framework: ComplianceFramework.SOC2,
            requirement: "A1.2",
          },
        ],
        paragraph: {
          requirement: "A1.2",
          text: "Both stores in scope are backed up every day.",
          source: AuditEvidenceParagraphSource.Edited,
          factKeys: [],
          editedAt: DRAFTED_AT,
          editedByUserId: "user-1",
        },
        isParagraphStale: true,
        summary: "2 stores are in its scope.",
      },
      {
        requirement: "CC6.1",
        title: "Logical access security",
        status: ComplianceRequirementStatus.Failing,
        facts: [
          {
            id: "E2",
            key: "CC6.1:checks",
            kind: ComplianceFactKind.CheckState,
            checks: 16,
            failingChecks: ["Public read access"],
            failingStores: 1,
            openIssues: 1,
          },
        ],
        paragraph: null,
        isParagraphStale: false,
        summary: "",
      },
    ],
    record: [],
    issueHistory: [
      {
        issueId: "10375000-0000-4000-8000-0000000000a9",
        title: "Public read access",
        storeName: "orders-db",
        checkId: "public-read",
        severity: "Critical",
        status: "Resolved",
        openedAt: "2026-10-01T00:00:00.000Z",
        resolvedAt: "2026-10-02T06:00:00.000Z",
        hoursToFix: 30,
      },
    ],
    editors: { "user-1": "Jane Doe" },
    isAiEnabled: true,
    canEdit: true,
    canDraft: true,
  };
}

describe("a framework's Audit Evidence", () => {
  test("the framework comes from the address, the first one otherwise", () => {
    expect(readEvidenceFramework("soc 2")).toBe(ComplianceFramework.SOC2);
    expect(readEvidenceFramework("PCI DSS")).toBe(ComplianceFramework.PCIDSS);
    expect(readEvidenceFramework(null)).toBe(ComplianceFramework.GDPR);
    expect(readEvidenceFramework("nonsense")).toBe(ComplianceFramework.GDPR);
  });

  test("reads like a document: each requirement's paragraph or its evidence, and the issue history it cites", async () => {
    goTo(
      `/dashboard/${PROJECT_ID}/data-security/compliance/audit-evidence?framework=SOC%202&period=180`,
    );
    const asked: SpyInstance<typeof DataSecurityApi.getAuditEvidence> = jest
      .spyOn(DataSecurityApi, "getAuditEvidence")
      .mockResolvedValue(evidenceOf());

    await renderPage(<DataSecurityAuditEvidencePage {...PAGE_PROPS} />);

    expect(asked).toHaveBeenCalledWith({
      framework: ComplianceFramework.SOC2,
      periodInDays: 180,
    });
    expect(screen.getByText("Audit Evidence: SOC 2")).toBeInTheDocument();
    expect(screen.getAllByText(NOT_LEGAL_ADVICE)).toHaveLength(1);

    const backups: HTMLElement = screen.getByTestId(
      "data-security-audit-evidence-A1-2",
    );

    expect(backups).toHaveTextContent("A1.2 · Backup and recovery");
    expect(backups).toHaveTextContent(
      "Both stores in scope are backed up every day.",
    );
    expect(backups).toHaveTextContent("Edited by Jane Doe");
    // Its facts changed since the person wrote it.
    expect(
      within(backups).getByTestId("data-security-audit-evidence-A1-2-stale"),
    ).toBeInTheDocument();
    // The evidence stays a click away under a person's words too.
    expect(
      within(backups).getByRole("button", {
        name: "Show the 1 fact it rests on",
      }),
    ).toBeInTheDocument();

    // No paragraph yet: its evidence, as it is.
    const access: HTMLElement = screen.getByTestId(
      "data-security-audit-evidence-CC6-1",
    );

    expect(access).toHaveTextContent(
      "No paragraph yet: the facts below are its evidence.",
    );
    expect(access).toHaveTextContent("Public read access");

    expect(
      screen.getByTestId("data-security-audit-evidence-issue-history"),
    ).toHaveTextContent("orders-db");
    expect(screen.getByText("30 hours")).toBeInTheDocument();
  });

  test("Edit makes a paragraph the person's own", async () => {
    goTo(
      `/dashboard/${PROJECT_ID}/data-security/compliance/audit-evidence?framework=SOC%202`,
    );
    jest
      .spyOn(DataSecurityApi, "getAuditEvidence")
      .mockResolvedValue(evidenceOf());
    const edited: SpyInstance<typeof DataSecurityApi.editAuditEvidence> = jest
      .spyOn(DataSecurityApi, "editAuditEvidence")
      .mockResolvedValue(evidenceOf());

    await renderPage(<DataSecurityAuditEvidencePage {...PAGE_PROPS} />);

    await act(async () => {
      fireEvent.click(
        screen.getByTestId("data-security-audit-evidence-CC6-1-edit"),
      );
    });
    await act(async () => {
      fireEvent.change(
        screen.getByTestId("data-security-audit-evidence-CC6-1-editor"),
        {
          target: {
            value: "Public access is reviewed every week by the platform team.",
          },
        },
      );
    });
    await act(async () => {
      fireEvent.click(
        screen.getByTestId("data-security-audit-evidence-CC6-1-save"),
      );
    });
    await flush();

    expect(edited).toHaveBeenCalledWith({
      framework: ComplianceFramework.SOC2,
      periodInDays: 90,
      requirement: "CC6.1",
      text: "Public access is reviewed every week by the platform team.",
    });
  });
});

describe("the record of processing on Compliance", () => {
  test("says how many stores wait for a person, marks each draft, and leads to Review Drafts", async () => {
    jest.spyOn(DataSecurityApi, "getRecordOfProcessing").mockResolvedValue(
      recordOf([
        rowOf(FIRST_ID, {
          fields: [
            {
              field: RecordField.LegalBasis,
              status: RecordFieldStatus.Drafted,
              value: "",
              draft: {
                value: RecordLegalBasis.Contract,
                reason: "Orders are a contract.",
                factKeys: [HOLDS.key],
                factsHash: "hash",
                draftedAt: DRAFTED_AT,
                language: "en",
              },
            },
          ],
        }),
        rowOf(DONE_ID, {
          state: RecordRowState.Complete,
          legalBasis: RecordLegalBasis.LegalObligation,
          fields: [
            {
              field: RecordField.LegalBasis,
              status: RecordFieldStatus.Written,
              value: RecordLegalBasis.LegalObligation,
            },
          ],
        }),
      ]),
    );

    await renderPage(<RecordOfProcessingCard />);

    const summary: HTMLElement = screen.getByTestId(
      "data-security-record-of-processing-summary",
    );

    expect(summary).toHaveTextContent("2 stores to review");
    expect(summary).toHaveTextContent("1 complete");
    expect(
      within(summary).getByTestId("data-security-record-of-processing-review"),
    ).toBeInTheDocument();
    expect(screen.getAllByText(NOT_LEGAL_ADVICE)).toHaveLength(1);

    const card: HTMLElement = screen.getByTestId(
      "data-security-record-of-processing-card",
    );

    // The draft is marked as one; the person's basis is the record's.
    expect(within(card).getAllByText("Draft").length).toBeGreaterThan(0);
    expect(card).toHaveTextContent("Contract");
    expect(card).toHaveTextContent("Legal obligation");
    expect(within(card).getByText("Review")).toBeInTheDocument();
    expect(screen.getByText("Export CSV")).toBeInTheDocument();
  });
});
