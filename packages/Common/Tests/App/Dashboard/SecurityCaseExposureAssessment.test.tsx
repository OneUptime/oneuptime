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
import { MemoryRouter } from "react-router-dom";

/*
 * WAS IT A BREACH? ON A SECURITY CASE'S OVERVIEW (#10377).
 *
 * The cards are drawn from an answer the server's own pure code builds
 * (buildExposureAssessmentView): the brief's public bucket of EU
 * customers' emails, open nine days with reads not logged. What is due
 * first comes first, with its deadline in its units and how far off; the
 * reads line says to treat the data as read; the window, whose data and
 * the secrets follow; every law of the table is listed, the rest folded;
 * the drafts are folded until opened, each saying it is not legal advice;
 * and nothing is drawn for a case about no store, or for a reader the
 * server refuses. Only the network is stubbed.
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

// What Export Markdown and Export PDF hand the browser to download (#10955).
const mockDownloads: Array<{
  content: unknown;
  filename: string;
  mimeType?: string;
}> = [];
const mockPdfDownloads: Array<{
  title: string;
  markdown: string;
  label: string;
  exportedAt: Date;
}> = [];
let mockPdfFailure: Error | null = null;

jest.mock("../../../UI/Utils/DownloadFile", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Utils/DownloadFile",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: (file: {
      content: unknown;
      filename: string;
      mimeType?: string;
    }): void => {
      mockDownloads.push(file);
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/CompliancePaperworkPdfDownload",
  () => {
    return {
      downloadMarkdownPdf: async (file: {
        title: string;
        markdown: string;
        label: string;
        exportedAt: Date;
      }): Promise<void> => {
        if (mockPdfFailure) {
          throw mockPdfFailure;
        }

        mockPdfDownloads.push(file);
      },
    };
  },
);

import DataSecurityApi, {
  DataSecurityApiError,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/DataSecurityApi";
import SecurityCaseExposureAssessment, {
  isCaseAboutAStore,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Exposure/SecurityCaseExposureAssessment";
import {
  DRAFT_NOT_LEGAL_ADVICE,
  EXPOSURE_CARD_PLACE,
  LOGS_BEST_EFFORT,
  LOGS_NO_CONTENT_ACCESS,
  LOGS_NONE_FROM_OUTSIDE,
  LOGS_NONE_SO_FAR,
  NOT_LEGAL_ADVICE,
  READS_LOGGED,
  READS_NOT_LOGGED,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Exposure/ExposureAssessmentCopy";
import {
  ExposureLogUnreadReason,
  getUnreadLogs,
} from "../../../Types/DataSecurity/AccessLogReads";
import {
  EXPOSURE_NOW,
  exposureAnswerOf,
  exposureAssessmentOf,
  exposureLogReadOf,
  exposureViewOf,
} from "../../Helpers/ExposureAssessmentAnswers";
import {
  BREACH_PLACE_CHOICES,
  BREACH_PLACE_REGION_CHOICES,
  BreachLawId,
  BreachPlace,
  COVERED_US_STATES,
  getBreachLawRule,
  UNCOVERED_US_STATES,
  US_JURISDICTION_PLACES,
} from "../../../Types/DataSecurity/BreachLaws";
import { withMeaningKeyAsItsWord } from "../../../Types/MeaningKeys";
import { DataSecurityExposureAssessmentResponse } from "../../../Types/DataSecurity/DataSecurityApiTypes";
import DataSensitivity from "../../../Types/DataSecurity/DataSensitivity";
import { getBuiltInDataType } from "../../../Types/DataSecurity/DataTypeCatalog";
import {
  applyBreachLaws,
  BreachObligation,
  BreachObligationStatus,
  BreachReasonKind,
  buildExposureAssessmentView,
  ExposureAssessmentStarter,
  ExposureAssessmentView,
  ExposureDraftPart,
  ExposureIssueEvent,
  ExposureReadsLogged,
  ExposureWindow,
  getExposureReads,
  getExposureWindow,
  getWhoseData,
  startExposureAssessment,
  StoredExposureAssessment,
} from "../../../Types/DataSecurity/ExposureAssessment";
import {
  describeDeadline,
  describeWhyNot,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Exposure/ExposureAssessmentModel";
import { createTranslator, Translator } from "../../../Types/Translator";
import {
  ExposureChecklistAnswer,
  ExposureChecklistItem,
  getExposureChecklistAnswers,
} from "../../../Types/DataSecurity/ExposureChecklist";
import { ImpactAssessmentSectionSource } from "../../../Types/DataSecurity/ImpactAssessment";
import { JSONArray } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { getDataStoreEntityValue } from "../../../Types/SecurityCase/SecurityEntity";
import Toast from "../../../UI/Utils/Toast";

const CASE_ID: ObjectID = new ObjectID("10377000-0000-4000-8000-0000000000c1");
const STORE_ID: string = "10377000-0000-4000-8000-0000000000b1";
const OTHER_STORE_ID: string = "10377000-0000-4000-8000-0000000000b2";
const USER_ID: string = "10377000-0000-4000-8000-0000000000f1";
const FOUND: string = "2026-11-02T09:00:00.000Z";
const CLOSED: string = "2026-11-11T09:00:00.000Z";
const NOW: Date = new Date("2026-11-11T12:00:00.000Z");
const DRAFTED_AT: string = "2026-11-11T10:00:00.000Z";

const ABOUT_A_STORE: JSONArray = [
  {
    type: "Data Store",
    value: getDataStoreEntityValue("aws:s3:eu-customer-exports"),
  },
];

function viewOf(
  data: {
    countries?: Array<string>;
    places?: Array<BreachPlace>;
    accessLogging?: boolean | null;
  } = {},
): ExposureAssessmentView {
  const window: ExposureWindow | null = getExposureWindow({
    issues: [
      {
        id: "issue",
        checkId: "public-read",
        status: "Resolved",
        firstDetectedAt: FOUND,
        resolvedAt: "2026-11-11T09:30:00.000Z",
        timeline: [
          { event: ExposureIssueEvent.Opened, at: FOUND },
          {
            event: ExposureIssueEvent.Resolved,
            at: "2026-11-11T09:30:00.000Z",
          },
        ],
      },
    ],
    changes: [],
    responses: [{ at: CLOSED, closesExposure: true }],
    now: NOW,
  });

  return buildExposureAssessmentView({
    store: {
      id: STORE_ID,
      name: "eu-customer-exports",
      kind: "AWS S3 Bucket",
      region: "eu-west-1",
      sensitivity: DataSensitivity.Confidential,
      exposure: "Public",
    },
    exposureIssues: [],
    window,
    reads: getExposureReads({
      accessLogging:
        data.accessLogging === undefined ? false : data.accessLogging,
      exposureCheckIds: ["public-read"],
      isStorePublic: true,
      grants: [
        {
          principal: "partner",
          isExternal: true,
          lastUsedAt: "2026-11-05T13:00:00.000Z",
        },
        { principal: "auditor", isExternal: true },
      ],
      window,
      now: NOW,
    }),
    whose: getWhoseData({
      dataTypes: ["email-address", "person-name"].map((id: string) => {
        return {
          id,
          name: getBuiltInDataType(id)?.name || id,
          category: getBuiltInDataType(id)?.category || "",
        };
      }),
      estimatedRecords: 48213,
      subjectCountries:
        data.countries === undefined ? ["DE", "FR", "NL"] : data.countries,
      placesNamed: data.places,
      people: ["Customers"],
    }),
    secretsToRotate: [
      {
        dataTypeId: "aws-secret-access-key",
        dataTypeName: "AWS secret access key",
        location: "deploy/env.sh",
        isStillThere: true,
      },
    ],
    hasMoreSecrets: false,
    now: NOW,
  });
}

function assessmentOf(
  data: Partial<StoredExposureAssessment> = {},
): StoredExposureAssessment {
  return {
    ...startExposureAssessment({
      dataStoreId: STORE_ID,
      startedBy: ExposureAssessmentStarter.DataSecurity,
      language: "en",
      now: new Date(FOUND),
    }),
    ...data,
  };
}

function checklist(): Array<ExposureChecklistAnswer> {
  return getExposureChecklistAnswers([
    {
      id: "task-1",
      title: "Rotate every secret and key the store held",
      isDone: true,
    },
  ]);
}

function answerOf(
  data: Partial<DataSecurityExposureAssessmentResponse> = {},
): DataSecurityExposureAssessmentResponse {
  return {
    securityCaseId: CASE_ID.toString(),
    stores: [
      {
        dataStoreId: STORE_ID,
        name: "eu-customer-exports",
        kind: "AWS S3 Bucket",
        sensitivity: DataSensitivity.Confidential,
      },
    ],
    dataStoreId: STORE_ID,
    assessment: assessmentOf(),
    view: viewOf(),
    facts: [],
    staleParts: [],
    editors: {},
    checklist: checklist(),
    isAiEnabled: true,
    canChange: true,
    canDraft: true,
    ...data,
  };
}

const NOT_ASSESSED: Partial<DataSecurityExposureAssessmentResponse> = {
  dataStoreId: undefined,
  assessment: null,
  view: null,
  checklist: [],
};

async function flush(): Promise<void> {
  await act(async () => {
    for (let index: number = 0; index < 20; index++) {
      await Promise.resolve();
    }
  });
}

async function renderCards(
  entities: JSONArray | undefined = ABOUT_A_STORE,
): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <SecurityCaseExposureAssessment caseId={CASE_ID} entities={entities} />
      </MemoryRouter>,
    );
  });
  await flush();
}

let reads: SpyInstance<typeof DataSecurityApi.getExposureAssessment>;

beforeEach(() => {
  reads = jest
    .spyOn(DataSecurityApi, "getExposureAssessment")
    .mockResolvedValue(answerOf());
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("which cases have it", () => {
  test("a case about no data store draws nothing, and reads nothing", async () => {
    await renderCards([{ type: "IP Address", value: "203.0.113.9" }]);

    expect(reads).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("security-case-exposure-assessment"),
    ).not.toBeInTheDocument();
    expect(isCaseAboutAStore(ABOUT_A_STORE)).toBe(true);
    expect(isCaseAboutAStore(undefined)).toBe(false);
  });

  test("the card is the Overview's place was-it-a-breach, assessed or not, so a link to it lands on it (#10954)", async () => {
    await renderCards();

    expect(EXPOSURE_CARD_PLACE).toBe("was-it-a-breach");
    expect(document.getElementById(EXPOSURE_CARD_PLACE)).toHaveTextContent(
      "Was It a Breach?",
    );
    expect(
      document
        .getElementById(EXPOSURE_CARD_PLACE)!
        .querySelector('[data-testid="security-case-exposure-assessment"]'),
    ).not.toBeNull();

    cleanup();
    reads.mockResolvedValue(answerOf(NOT_ASSESSED));
    await renderCards();

    expect(document.getElementById(EXPOSURE_CARD_PLACE)).toHaveTextContent(
      "Not assessed yet",
    );
  });

  test("a reader the server refuses - one who may not read the store's findings - sees nothing", async () => {
    reads.mockRejectedValue(
      new DataSecurityApiError("Ask a project admin for a role.", 422),
    );

    await renderCards();

    expect(reads).toHaveBeenCalledWith(CASE_ID);
    expect(screen.queryByText("Was It a Breach?")).not.toBeInTheDocument();
  });

  test("a read that fails says so, with a way to read it again", async () => {
    reads.mockRejectedValueOnce(
      new DataSecurityApiError("The server is restarting.", 503),
    );

    await renderCards();

    expect(screen.getByText("The server is restarting.")).toBeInTheDocument();
  });
});

describe("a case not assessed yet", () => {
  test("offers Assess This Exposure, which assesses it and draws what it worked out", async () => {
    reads.mockResolvedValue(answerOf(NOT_ASSESSED));
    const assessed: SpyInstance<typeof DataSecurityApi.assessExposure> = jest
      .spyOn(DataSecurityApi, "assessExposure")
      .mockResolvedValue(answerOf());

    await renderCards();

    expect(screen.getByText("Not assessed yet")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId("security-case-exposure-assess"));
    });
    await flush();

    expect(assessed).toHaveBeenCalledWith({
      securityCaseId: CASE_ID,
      dataStoreId: undefined,
    });
    expect(
      screen.getByTestId("security-case-exposure-headline"),
    ).toBeInTheDocument();
  });

  test("a case about two stores asks which before it assesses", async () => {
    reads.mockResolvedValue(
      answerOf({
        ...NOT_ASSESSED,
        stores: [
          {
            dataStoreId: STORE_ID,
            name: "eu-customer-exports",
            kind: "AWS S3 Bucket",
            sensitivity: DataSensitivity.Confidential,
          },
          {
            dataStoreId: OTHER_STORE_ID,
            name: "eu-invoices",
            kind: "AWS S3 Bucket",
            sensitivity: DataSensitivity.Restricted,
          },
        ],
      }),
    );

    await renderCards();

    expect(screen.getByTestId("security-case-exposure-assess")).toBeDisabled();
  });

  test("a reader who may not change it is told who can, with no button", async () => {
    reads.mockResolvedValue(answerOf({ ...NOT_ASSESSED, canChange: false }));

    await renderCards();

    expect(
      screen.getByText("Someone who can edit this case can assess it."),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("security-case-exposure-assess"),
    ).not.toBeInTheDocument();
  });
});

describe("the EU emails bucket, open nine days with reads not logged", () => {
  test("says it is not legal advice before anything else", async () => {
    await renderCards();

    const card: HTMLElement = screen.getByTestId(
      "security-case-exposure-assessment",
    );

    expect(card.firstElementChild).toHaveTextContent(NOT_LEGAL_ADVICE);
  });

  test("what is due first comes first: GDPR's 72 hours, overdue, counted from when it was found", async () => {
    await renderCards();

    const headline: HTMLElement = screen.getByTestId(
      "security-case-exposure-headline",
    );

    expect(headline).toHaveAttribute("data-rule", BreachLawId.GdprAuthority);
    expect(headline).toHaveTextContent("Notify the supervisory authority");
    expect(headline).toHaveTextContent("GDPR Article 33");
    expect(headline).toHaveTextContent("Within 72 hours of finding it");
    expect(headline).toHaveTextContent(
      "Counted from when Data Security found it",
    );
    expect(
      within(headline).getByTestId("security-case-exposure-due-state"),
    ).toHaveAttribute("data-state", "overdue");
    expect(headline).toHaveTextContent("Overdue by");
  });

  test("the reads line says to treat the data as read, and who could read it, counted", async () => {
    await renderCards();

    const line: HTMLElement = screen.getByTestId(
      "security-case-exposure-reads",
    );

    expect(line).toHaveTextContent(READS_NOT_LOGGED);
    expect(line).toHaveTextContent("Anyone on the internet could read it.");
    expect(line).toHaveTextContent(
      "2 accounts outside your company could read it.",
    );
    expect(line).toHaveTextContent(
      "1 of them used its access while the store was open.",
    );
  });

  test("how long it was open, whose data it was, and the secrets to rotate", async () => {
    await renderCards();

    const window: HTMLElement = screen.getByTestId(
      "security-case-exposure-window",
    );

    expect(window).toHaveTextContent("9 days");
    expect(window).toHaveTextContent("when Data Security found it");
    expect(window).toHaveTextContent("when Data Security's response closed it");

    const whose: HTMLElement = screen.getByTestId(
      "security-case-exposure-whose",
    );

    expect(whose).toHaveTextContent("Email address");
    expect(whose).toHaveTextContent("About 48,000 records");
    expect(whose).toHaveTextContent("Customers");

    const secrets: HTMLElement = screen.getByTestId(
      "security-case-exposure-secrets",
    );

    expect(secrets).toHaveTextContent("AWS secret access key");
    expect(secrets).toHaveTextContent("deploy/env.sh");
    expect(secrets).toHaveTextContent("Still there");
  });

  test("every law of the table: those that may apply, those if people live elsewhere, the rest folded", async () => {
    await renderCards();

    const laws: HTMLElement = screen.getByTestId("security-case-exposure-laws");

    expect(
      within(laws).getByTestId(
        `security-case-exposure-law-${BreachLawId.GdprPeople}`,
      ),
    ).toHaveAttribute("data-status", "MayApply");
    expect(laws).toHaveTextContent("If any of the people live elsewhere");
    expect(
      within(laws).getByTestId(
        `security-case-exposure-law-${BreachLawId.UkGdprAuthority}`,
      ),
    ).toBeInTheDocument();
    // Not triggered: folded until asked for.
    expect(
      within(laws).queryByTestId(
        `security-case-exposure-law-${BreachLawId.HipaaPeople}`,
      ),
    ).not.toBeInTheDocument();

    const more: HTMLElement = screen.getByTestId(
      "security-case-exposure-more-laws",
    );

    expect(more).toHaveAttribute("aria-expanded", "false");

    await act(async () => {
      fireEvent.click(more);
    });

    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(more).toHaveTextContent("Show fewer laws");
    expect(
      within(laws).getByTestId(
        `security-case-exposure-law-${BreachLawId.HipaaPeople}`,
      ),
    ).toHaveAttribute("data-status", "NotTriggered");
    // The US states' laws none of the data brings in are counted, never fifty rows (#10952).
    expect(
      within(laws).queryByTestId(
        `security-case-exposure-law-${BreachLawId.TexasIndividuals}`,
      ),
    ).not.toBeInTheDocument();
    expect(
      within(laws).getByTestId("security-case-exposure-states-not-applying"),
    ).toBeInTheDocument();
    // What the table does not cover, in plain words.
    expect(
      screen.getByTestId("security-case-exposure-uncovered"),
    ).toBeInTheDocument();
  });

  test("a law's details: who is told, what a person checks, and its source with the day it was checked", async () => {
    await renderCards();

    const row: HTMLElement = screen.getByTestId(
      `security-case-exposure-law-${BreachLawId.GdprPeople}`,
    );
    const toggle: HTMLElement = within(row).getByRole("button", {
      name: "Show details",
    });

    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await act(async () => {
      fireEvent.click(toggle);
    });

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(row).toHaveTextContent("Who is told");
    expect(row).toHaveTextContent("What a person checks");
    expect(row).toHaveTextContent(
      "high risk to the people's rights and freedoms",
    );

    const source: HTMLElement = within(row).getByRole("link", {
      name: /2016\/679/,
    });

    expect(source.getAttribute("href")).toContain("eur-lex.europa.eu");
    expect(row).toHaveTextContent("Checked Nov 24, 2026");
  });

  test("the case's checklist, each line answered, linked to the case's Tasks", async () => {
    await renderCards();

    const list: HTMLElement = screen.getByTestId(
      "security-case-exposure-checklist",
    );

    expect(
      within(list).getByTestId(
        `security-case-exposure-checklist-${ExposureChecklistItem.WhoReadIt}`,
      ),
    ).toHaveTextContent(READS_NOT_LOGGED);
    expect(
      within(list).getByTestId(
        `security-case-exposure-checklist-${ExposureChecklistItem.MustReport}`,
      ),
    ).toHaveTextContent("GDPR Article 33 may apply first");
    expect(
      within(list).getByTestId(
        `security-case-exposure-checklist-${ExposureChecklistItem.RotateSecrets}`,
      ),
    ).toHaveAttribute("data-done", "true");
    expect(
      within(list)
        .getByRole("link", { name: "Open Tasks" })
        .getAttribute("href"),
    ).toContain(`/security-events/cases/${CASE_ID.toString()}/tasks`);
  });
});

describe("where the people live", () => {
  test("nobody knows: nothing is due first, the question is asked first, and Save Places applies the answer", async () => {
    reads.mockResolvedValue(answerOf({ view: viewOf({ countries: [] }) }));
    const saved: SpyInstance<typeof DataSecurityApi.setExposurePeoplePlaces> =
      jest.spyOn(DataSecurityApi, "setExposurePeoplePlaces").mockResolvedValue(
        answerOf({
          view: viewOf({
            countries: [],
            places: [BreachPlace.UnitedKingdom],
          }),
          assessment: assessmentOf({
            peopleLiveIn: {
              places: [BreachPlace.UnitedKingdom],
              saidAt: NOW.toISOString(),
              saidByUserId: USER_ID,
            },
          }),
          editors: { [USER_ID]: "Alice Example" },
        }),
      );

    await renderCards();

    expect(screen.getByText("Where do the people live?")).toBeInTheDocument();

    const save: HTMLElement = screen.getByTestId(
      "security-case-exposure-save-places",
    );

    expect(save).toBeDisabled();

    const uk: HTMLElement = screen.getByTestId(
      `security-case-exposure-place-${BreachPlace.UnitedKingdom}`,
    );

    await act(async () => {
      fireEvent.click(uk);
    });

    expect(uk).toHaveAttribute("aria-pressed", "true");

    await act(async () => {
      fireEvent.click(save);
    });
    await flush();

    expect(saved).toHaveBeenCalledWith({
      securityCaseId: CASE_ID,
      places: [BreachPlace.UnitedKingdom],
    });
    expect(
      screen.getByTestId("security-case-exposure-headline"),
    ).toHaveAttribute("data-rule", BreachLawId.UkGdprAuthority);
    expect(
      screen.getByText(
        "Alice Example said the people live in the United Kingdom.",
      ),
    ).toBeInTheDocument();
  });
});

describe("the notices OneUptime AI drafted", () => {
  const DRAFTED: Partial<StoredExposureAssessment> = {
    draftedAt: DRAFTED_AT,
    sections: {
      [ExposureDraftPart.Explanation]: {
        part: ExposureDraftPart.Explanation,
        markdown:
          "Anyone on the internet could read the bucket, and reads were not logged, so treat the data as read.",
        source: ImpactAssessmentSectionSource.Drafted,
        factKeys: [],
        draftedAt: DRAFTED_AT,
      },
      [ExposureDraftPart.RegulatorNotice]: {
        part: ExposureDraftPart.RegulatorNotice,
        markdown:
          "[Company name] reports that a storage bucket of customers' email addresses was open to anyone on the internet.",
        source: ImpactAssessmentSectionSource.Drafted,
        factKeys: [],
        draftedAt: DRAFTED_AT,
      },
    },
  };

  test("what it means is open; each notice is folded until opened, says it is a draft and not legal advice, and copies", async () => {
    reads.mockResolvedValue(answerOf({ assessment: assessmentOf(DRAFTED) }));

    await renderCards();

    const notices: HTMLElement = screen.getByTestId(
      "security-case-exposure-notices",
    );

    expect(notices).toHaveTextContent(NOT_LEGAL_ADVICE);
    expect(notices).toHaveTextContent(
      "Anyone on the internet could read the bucket",
    );

    const regulator: HTMLElement = screen.getByTestId(
      `security-case-exposure-part-${ExposureDraftPart.RegulatorNotice}`,
    );

    expect(regulator).toHaveTextContent("Notice to the Regulator");
    expect(regulator).not.toHaveTextContent("[Company name] reports");
    // Copied without opening it, from beside its heading.
    expect(
      within(regulator).getByRole("button", { name: "Copy" }),
    ).toBeInTheDocument();

    const fold: HTMLElement = within(regulator).getByTestId(
      `security-case-exposure-part-${ExposureDraftPart.RegulatorNotice}-fold`,
    );

    expect(fold).toHaveAttribute("aria-expanded", "false");

    await act(async () => {
      fireEvent.click(fold);
    });

    expect(fold).toHaveAttribute("aria-expanded", "true");
    expect(regulator).toHaveTextContent("[Company name] reports");
    expect(regulator).toHaveTextContent(DRAFT_NOT_LEGAL_ADVICE);
    expect(regulator).toHaveTextContent("Drafted by OneUptime AI");
    // The draft is drafted again, never sent: the button says so.
    expect(screen.getByText("Draft Again")).toBeInTheDocument();
  });

  test("Draft With OneUptime AI writes them up and says nothing was sent", async () => {
    const drafted: SpyInstance<typeof DataSecurityApi.draftExposureAssessment> =
      jest
        .spyOn(DataSecurityApi, "draftExposureAssessment")
        .mockResolvedValue(answerOf({ assessment: assessmentOf(DRAFTED) }));

    await renderCards();

    await act(async () => {
      fireEvent.click(screen.getByTestId("security-case-exposure-draft"));
    });
    await flush();

    expect(drafted).toHaveBeenCalledWith(CASE_ID);
    expect(
      screen.getByTestId(
        `security-case-exposure-part-${ExposureDraftPart.RegulatorNotice}`,
      ),
    ).toBeInTheDocument();
  });

  test("Edit makes a notice the person's own, saved as they wrote it", async () => {
    reads.mockResolvedValue(answerOf({ assessment: assessmentOf(DRAFTED) }));
    const edited: SpyInstance<typeof DataSecurityApi.editExposureAssessment> =
      jest
        .spyOn(DataSecurityApi, "editExposureAssessment")
        .mockResolvedValue(answerOf({ assessment: assessmentOf(DRAFTED) }));

    await renderCards();

    const id: string = `security-case-exposure-part-${ExposureDraftPart.RegulatorNotice}`;

    await act(async () => {
      fireEvent.click(screen.getByTestId(`${id}-fold`));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId(`${id}-edit`));
    });
    await act(async () => {
      fireEvent.change(screen.getByTestId(`${id}-editor`), {
        target: { value: "Our own words to the regulator." },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId(`${id}-save`));
    });
    await flush();

    expect(edited).toHaveBeenCalledWith({
      securityCaseId: CASE_ID,
      part: ExposureDraftPart.RegulatorNotice,
      markdown: "Our own words to the regulator.",
    });
  });

  test("with AI off, nothing is drafted: it says so, and a person writes each part", async () => {
    reads.mockResolvedValue(answerOf({ isAiEnabled: false, canDraft: false }));

    await renderCards();

    expect(
      screen.getByText(
        "OneUptime AI is off for this project, so nothing is drafted: write each part yourself.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("security-case-exposure-draft"),
    ).not.toBeInTheDocument();
  });

  test("a reader who may not change it reads the notices, with nothing to edit or draft", async () => {
    reads.mockResolvedValue(
      answerOf({
        assessment: assessmentOf(DRAFTED),
        canChange: false,
        canDraft: false,
      }),
    );

    await renderCards();

    const id: string = `security-case-exposure-part-${ExposureDraftPart.RegulatorNotice}`;

    await act(async () => {
      fireEvent.click(screen.getByTestId(`${id}-fold`));
    });

    expect(screen.queryByTestId(`${id}-edit`)).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("security-case-exposure-draft"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("security-case-exposure-places-change"),
    ).not.toBeInTheDocument();
  });
});

/*
 * THE NOTICES AS ONE DOCUMENT (#10955): Export PDF in the Breach Notices
 * card's header, Export Markdown in its ⋯, as the impact assessment's page
 * has them. Each downloads the same document - drafts, "not legal advice"
 * at its top - made only from what the cards show. Nothing is sent.
 */
describe("exporting the notices", () => {
  const SAVED: Partial<StoredExposureAssessment> = {
    sections: {
      [ExposureDraftPart.Explanation]: {
        part: ExposureDraftPart.Explanation,
        markdown:
          "Anyone on the internet could read the bucket, and reads were not logged, so treat the data as read.",
        source: ImpactAssessmentSectionSource.Drafted,
        factKeys: [],
        draftedAt: DRAFTED_AT,
      },
      [ExposureDraftPart.PeopleNotice]: {
        part: ExposureDraftPart.PeopleNotice,
        markdown:
          "We are writing to tell you that a list holding your email address was readable on the internet.",
        source: ImpactAssessmentSectionSource.Edited,
        factKeys: [],
        editedAt: DRAFTED_AT,
        editedByUserId: USER_ID,
      },
    },
  };

  function noticesCard(): HTMLElement {
    // The card the notices sit in: its header holds the export buttons.
    let node: HTMLElement | null = screen.getByTestId(
      "security-case-exposure-notices",
    );

    while (
      node &&
      !within(node).queryByRole("button", { name: "Export PDF" })
    ) {
      node = node.parentElement;
    }

    expect(node).not.toBeNull();
    return node!;
  }

  beforeEach(() => {
    mockDownloads.length = 0;
    mockPdfDownloads.length = 0;
    mockPdfFailure = null;
    reads.mockResolvedValue(
      answerOf({
        assessment: assessmentOf(SAVED),
        editors: { [USER_ID]: "Ana Ortiz" },
      }),
    );
  });

  test("Export PDF is in the Breach Notices card's header, and downloads the drafts as one document, not legal advice at its top", async () => {
    await renderCards();

    const card: HTMLElement = noticesCard();
    const exportPdf: HTMLElement = within(card).getByRole("button", {
      name: "Export PDF",
    });

    // Not on the Was It a Breach? card: the notices are what is exported.
    expect(
      within(
        screen.getByTestId("security-case-exposure-assessment"),
      ).queryByRole("button", { name: "Export PDF" }),
    ).toBeNull();

    await act(async () => {
      fireEvent.click(exportPdf);
    });
    await flush();

    expect(mockPdfDownloads).toHaveLength(1);

    const pdf: (typeof mockPdfDownloads)[number] = mockPdfDownloads[0]!;

    expect(pdf.title).toBe("Draft Breach Notices: eu-customer-exports");
    expect(pdf.label).toBe("eu-customer-exports breach notices");
    expect(pdf.exportedAt).toBeInstanceOf(Date);
    expect(
      pdf.markdown.startsWith("# Draft Breach Notices: eu-customer-exports"),
    ).toBe(true);
    expect(pdf.markdown.split("\n")[4]).toContain("not legal advice");
    expect(pdf.markdown).toContain("Nothing was sent");
    expect(pdf.markdown).toContain(
      "**GDPR Article 33: Notify the supervisory authority.**",
    );
    // Each part as a person last saved it.
    expect(pdf.markdown).toContain(
      "Anyone on the internet could read the bucket, and reads were not logged",
    );
    expect(pdf.markdown).toContain(
      "We are writing to tell you that a list holding your email address",
    );
    expect(pdf.markdown).toContain("_Edited by Ana Ortiz on 2026-11-11._");
    expect(mockDownloads).toHaveLength(0);
  });

  test("Export Markdown is in the card's ⋯, and downloads the same document as a Markdown file", async () => {
    await renderCards();

    const card: HTMLElement = noticesCard();

    await act(async () => {
      fireEvent.click(
        within(card).getByRole("button", { name: "More options" }),
      );
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("menuitem", { name: "Export Markdown" }),
      );
    });

    expect(mockDownloads).toHaveLength(1);

    const file: (typeof mockDownloads)[number] = mockDownloads[0]!;

    expect(file.filename.endsWith(".md")).toBe(true);
    expect(file.filename).toContain("eu-customer-exports");
    expect(file.mimeType).toBe("text/markdown;charset=utf-8;");
    expect(String(file.content)).toContain(
      "# Draft Breach Notices: eu-customer-exports",
    );
    expect(String(file.content)).toContain("not legal advice");
    expect(mockPdfDownloads).toHaveLength(0);
  });

  test("while a part is being edited, both wait - the document holds what was saved - and say why", async () => {
    await renderCards();

    const id: string = `security-case-exposure-part-${ExposureDraftPart.Explanation}`;

    await act(async () => {
      fireEvent.click(screen.getByTestId(`${id}-edit`));
    });
    await act(async () => {
      fireEvent.change(screen.getByTestId(`${id}-editor`), {
        target: { value: "Words not saved yet, which no export may hold." },
      });
    });

    const exportPdf: HTMLElement = within(noticesCard()).getByRole("button", {
      name: "Export PDF",
    });

    expect(exportPdf).toBeDisabled();

    await act(async () => {
      fireEvent.click(exportPdf);
    });

    expect(mockPdfDownloads).toHaveLength(0);
  });

  test("a PDF that cannot be made says why, and nothing is downloaded", async () => {
    const shown: Array<string> = [];

    jest.spyOn(Toast, "error").mockImplementation(((message: string): void => {
      shown.push(message);
    }) as never);
    mockPdfFailure = new Error("The PDF engine could not load.");

    await renderCards();

    await act(async () => {
      fireEvent.click(
        within(noticesCard()).getByRole("button", { name: "Export PDF" }),
      );
    });
    await flush();

    expect(mockPdfDownloads).toHaveLength(0);
    expect(shown.join(" ")).toContain("The PDF engine could not load.");
  });

  test("a case not assessed yet has no notices to export", async () => {
    reads.mockResolvedValue(answerOf(NOT_ASSESSED));

    await renderCards();

    expect(screen.queryByRole("button", { name: "Export PDF" })).toBeNull();
  });
});

/*
 * WHO READ IT, FROM THE STORE'S OWN ACCESS LOGS (#10951): where reads were
 * logged, the reads line says what OneUptime read of the logs - reads from
 * outside, by whom, what was read and sent, how far the read went - or why
 * it could not; Read the Access Logs reads them; and who read it from
 * outside is named only when the server sent the names. "Reads were not
 * logged. Treat the data as read." stays where they were not.
 */
describe("who read it, from the store's access logs", () => {
  function readsLine(): HTMLElement {
    return screen.getByTestId("security-case-exposure-reads");
  }

  function logged(
    logRead?: Parameters<typeof exposureLogReadOf>[0] | "none",
    data: Partial<DataSecurityExposureAssessmentResponse> = {},
  ): DataSecurityExposureAssessmentResponse {
    return exposureAnswerOf({
      view: exposureViewOf({
        accessLogging: true,
        logRead:
          logRead === "none" || logRead === undefined
            ? undefined
            : exposureLogReadOf(logRead),
      }),
      ...data,
    });
  }

  test("logged and not read yet: the logs say who read it, and Read the Access Logs reads them", async () => {
    reads.mockResolvedValue(logged("none"));

    const readLogs: SpyInstance<typeof DataSecurityApi.readExposureLogs> = jest
      .spyOn(DataSecurityApi, "readExposureLogs")
      .mockResolvedValue(logged({ anonymous: 3, outside: 2 }));

    await renderCards();

    expect(readsLine()).toHaveTextContent(READS_LOGGED);
    expect(readsLine()).toHaveAttribute("data-from-logs", "false");

    await act(async () => {
      fireEvent.click(screen.getByTestId("security-case-exposure-read-logs"));
    });
    await flush();

    expect(readLogs).toHaveBeenCalledWith(CASE_ID);
    expect(readsLine()).toHaveAttribute("data-from-logs", "true");
    expect(readsLine()).toHaveTextContent(
      "OneUptime read the store's access logs for this window: 5 reads from outside your accounts.",
    );
    // The data counts as read: drawn as the brief's warning is.
    expect(readsLine().className).toContain("bg-amber-50");
    // Read again, for a window that changed.
    expect(
      within(readsLine()).getByRole("button", { name: "Read the Logs Again" }),
    ).toBeInTheDocument();
  });

  test("reads from outside: by whom, what was read and sent, and how far the read went", async () => {
    reads.mockResolvedValue(logged({ anonymous: 3, outside: 2, unknown: 1 }));

    await renderCards();

    const line: HTMLElement = readsLine();

    expect(line).toHaveTextContent(
      "OneUptime read the store's access logs for this window: 6 reads from outside your accounts.",
    );
    expect(line).toHaveTextContent(
      "3 by anyone on the internet, from 3 addresses",
    );
    expect(line).toHaveTextContent("2 by 1 account outside your company");
    expect(line).toHaveTextContent("1 by requesters OneUptime cannot place");
    expect(line).toHaveTextContent("6 objects read, 6 MB sent.");
    expect(line).toHaveTextContent("It read 240 log files of the window.");
    // No reads from outside to doubt: no best-effort warning.
    expect(line).not.toHaveTextContent(LOGS_BEST_EFFORT);
  });

  test("who read it from outside is named only when the server sent the names", async () => {
    reads.mockResolvedValue(logged({ outside: 2, principals: true }));

    await renderCards();

    const named: HTMLElement = within(readsLine()).getByTestId(
      "security-case-exposure-reads-principals",
    );

    expect(named).toHaveTextContent("Who Read It From Outside");
    expect(named).toHaveTextContent(
      "arn:aws:sts::999999999999:assumed-role/partner-reader/s1",
    );
    // The principal is code, read from the left on any page.
    expect(
      within(named).getByText(
        "arn:aws:sts::999999999999:assumed-role/partner-reader/s1",
      ).tagName,
    ).toBe("CODE");
    expect(named).toHaveTextContent("2 reads, 2 MB, from");

    cleanup();
    reads.mockResolvedValue(logged({ outside: 2, principals: false }));
    await renderCards();

    expect(
      within(readsLine()).queryByTestId(
        "security-case-exposure-reads-principals",
      ),
    ).toBeNull();
    expect(readsLine()).toHaveTextContent(
      "2 by 1 account outside your company",
    );
  });

  test("every log file read and none from outside: says so, and that a person still checks", async () => {
    reads.mockResolvedValue(logged({}));

    await renderCards();

    expect(readsLine()).toHaveTextContent(LOGS_NONE_FROM_OUTSIDE);
    expect(readsLine()).toHaveTextContent(LOGS_BEST_EFFORT);
    expect(readsLine().className).toContain("bg-gray-50");
  });

  test("part of the logs read: how far, and that the counts are those so far", async () => {
    reads.mockResolvedValue(logged({ isComplete: false }));

    await renderCards();

    expect(readsLine()).toHaveTextContent(LOGS_NONE_SO_FAR);
    expect(readsLine()).toHaveTextContent("It read 240 log files, to");
    expect(readsLine()).toHaveTextContent("the counts are those so far");
  });

  test("logs the store's connection may not read say so, under the brief's line", async () => {
    reads.mockResolvedValue(
      exposureAnswerOf({
        view: exposureViewOf({
          accessLogging: true,
          logRead: getUnreadLogs({
            reason: ExposureLogUnreadReason.NoContentAccess,
            now: EXPOSURE_NOW,
          }),
        }),
      }),
    );

    await renderCards();

    expect(readsLine()).toHaveTextContent(READS_LOGGED);
    expect(
      within(readsLine()).getByTestId("security-case-exposure-reads-logs-note"),
    ).toHaveTextContent(LOGS_NO_CONTENT_ACCESS);
  });

  test("logs that could not be read name where they are, as code", async () => {
    reads.mockResolvedValue(
      exposureAnswerOf({
        view: exposureViewOf({
          accessLogging: true,
          logRead: getUnreadLogs({
            reason: ExposureLogUnreadReason.LogsUnreadable,
            now: EXPOSURE_NOW,
            logLocation: "s3://acme-logs/logs/",
          }),
        }),
      }),
    );

    await renderCards();

    const note: HTMLElement = within(readsLine()).getByTestId(
      "security-case-exposure-reads-logs-note",
    );

    expect(note).toHaveTextContent(
      "OneUptime could not read the bucket the logs are written to, s3://acme-logs/logs/.",
    );
    expect(within(note).getByText("s3://acme-logs/logs/").tagName).toBe("CODE");
  });

  test("a read for the window as it was is said to be, and its counts are not drawn", async () => {
    reads.mockResolvedValue(
      logged({ outside: 9, windowStart: "2026-10-30T09:00:00.000Z" }),
    );

    await renderCards();

    expect(readsLine()).toHaveTextContent(READS_LOGGED);
    expect(readsLine()).toHaveTextContent("for the window as it was then");
    expect(readsLine()).not.toHaveTextContent("9 reads from outside");
  });

  test("no button where the logs cannot be read here: reads not logged, a reader who may not change it, a store other than an S3 bucket", async () => {
    reads.mockResolvedValue(exposureAnswerOf());
    await renderCards();

    expect(readsLine()).toHaveTextContent(READS_NOT_LOGGED);
    expect(screen.queryByTestId("security-case-exposure-read-logs")).toBeNull();

    cleanup();
    reads.mockResolvedValue(
      logged("none", { canChange: false, canDraft: false }),
    );
    await renderCards();

    expect(screen.queryByTestId("security-case-exposure-read-logs")).toBeNull();

    cleanup();
    reads.mockResolvedValue(
      exposureAnswerOf({
        view: exposureViewOf({
          accessLogging: true,
          storeKind: "AWS Redshift Cluster",
        }),
      }),
    );
    await renderCards();

    expect(screen.queryByTestId("security-case-exposure-read-logs")).toBeNull();
  });

  test("a read that fails says why, and the line stays as it was", async () => {
    reads.mockResolvedValue(logged("none"));
    jest
      .spyOn(DataSecurityApi, "readExposureLogs")
      .mockRejectedValue(
        new DataSecurityApiError("The log bucket is in another account.", 400),
      );

    await renderCards();

    await act(async () => {
      fireEvent.click(screen.getByTestId("security-case-exposure-read-logs"));
    });
    await flush();

    expect(readsLine()).toHaveTextContent(
      "The log bucket is in another account.",
    );
    expect(readsLine()).toHaveTextContent(READS_LOGGED);
  });

  test("the checklist's who-read-it line answers from the logs", async () => {
    reads.mockResolvedValue(logged({ anonymous: 3, outside: 2 }));

    await renderCards();

    expect(
      screen.getByTestId(
        `security-case-exposure-checklist-${ExposureChecklistItem.WhoReadIt}`,
      ),
    ).toHaveTextContent(
      "OneUptime read the store's access logs for this window: 5 reads from outside your accounts.",
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * Every US state (#10952)
 * ---------------------------------------------------------------------------
 */

// A store of Social Security numbers with names, about people in the US: every state's law covers it.
function ssnAnswer(
  places?: Array<BreachPlace>,
): DataSecurityExposureAssessmentResponse {
  return exposureAnswerOf({
    view: exposureViewOf({
      dataTypeIds: ["us-ssn", "person-name"],
      countries: ["US"],
      places,
    }),
    assessment: exposureAssessmentOf(
      places
        ? {
            peopleLiveIn: {
              places,
              saidAt: EXPOSURE_NOW.toISOString(),
              saidByUserId: USER_ID,
            },
          }
        : {},
    ),
    editors: { [USER_ID]: "Alice Example" },
  });
}

async function openStatesPicker(): Promise<HTMLElement> {
  const combobox: HTMLElement = screen.getByRole("combobox", {
    name: "US states",
  });

  await act(async () => {
    fireEvent.focus(combobox);
    fireEvent.keyDown(combobox, { key: "ArrowDown", keyCode: 40 });
  });

  return combobox;
}

async function pickState(name: string): Promise<void> {
  await openStatesPicker();

  const option: HTMLElement = await screen.findByRole("option", {
    name: new RegExp(`^${name}`),
  });

  await act(async () => {
    fireEvent.click(option);
  });
}

describe("every US state is a place a person can name (#10952)", () => {
  test("the regions are chips and the states a list of their own: picking two states and the EU saves all three", async () => {
    reads.mockResolvedValue(answerOf({ view: viewOf({ countries: [] }) }));
    const saved: SpyInstance<typeof DataSecurityApi.setExposurePeoplePlaces> =
      jest
        .spyOn(DataSecurityApi, "setExposurePeoplePlaces")
        .mockResolvedValue(
          ssnAnswer([
            BreachPlace.Eea,
            BreachPlace.Illinois,
            BreachPlace.Georgia,
          ]),
        );

    await renderCards();

    // The chips are the regions; no state is a chip, and "Another US state" is no longer offered.
    for (const place of BREACH_PLACE_REGION_CHOICES) {
      expect(
        screen.getByTestId(`security-case-exposure-place-${place}`),
      ).toBeInTheDocument();
    }

    expect(
      screen.queryByTestId(
        `security-case-exposure-place-${BreachPlace.Illinois}`,
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(
        `security-case-exposure-place-${BreachPlace.OtherUsState}`,
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Pick each state some of them live in, the District of Columbia, Puerto Rico, Guam and the US Virgin Islands too: each has its own breach law.",
      ),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(
        screen.getByTestId(`security-case-exposure-place-${BreachPlace.Eea}`),
      );
    });
    await pickState("Illinois");
    // Georgia the state reads "Georgia", never the country's words.
    await pickState("Georgia");

    await act(async () => {
      fireEvent.click(screen.getByTestId("security-case-exposure-save-places"));
    });
    await flush();

    // The regions as picked, then the states in their own order.
    expect(saved).toHaveBeenCalledWith({
      securityCaseId: CASE_ID,
      places: [BreachPlace.Eea, BreachPlace.Georgia, BreachPlace.Illinois],
    });
  });

  test("the states are listed in alphabetical order, the District of Columbia, Puerto Rico, Guam and the US Virgin Islands among them", async () => {
    reads.mockResolvedValue(answerOf({ view: viewOf({ countries: [] }) }));

    await renderCards();
    await openStatesPicker();

    const names: Array<string> = screen
      .getAllByRole("option")
      .map((option: HTMLElement): string => {
        return (option.textContent || "").trim();
      });

    expect(names).toHaveLength(US_JURISDICTION_PLACES.length);
    expect(names[0]).toMatch(/^Alabama/);
    expect(names[names.length - 1]).toMatch(/^Wyoming/);
    expect(
      names.some((name: string): boolean => {
        return name.startsWith("District of Columbia");
      }),
    ).toBe(true);
    expect(
      names.some((name: string): boolean => {
        return name.startsWith("Puerto Rico");
      }),
    ).toBe(true);
    // Guam and the US Virgin Islands, whose laws the table holds (#11426).
    for (const territory of ["Guam", "US Virgin Islands"]) {
      const option: string | undefined = names.find((name: string): boolean => {
        return name.startsWith(territory);
      });

      expect({ territory, listed: Boolean(option) }).toEqual({
        territory,
        listed: true,
      });
      expect(option).not.toContain(
        "Its breach law is not in OneUptime's table",
      );
    }
    expect(
      names.some((name: string): boolean => {
        return name.startsWith("Georgia (US state)");
      }),
    ).toBe(false);

    // A state whose law the table does not hold says so, beside its name; one it holds does not.
    for (const place of US_JURISDICTION_PLACES) {
      const name: string = withMeaningKeyAsItsWord(BREACH_PLACE_CHOICES[place]);
      const option: HTMLElement = screen
        .getAllByRole("option")
        .find((each: HTMLElement): boolean => {
          return (each.textContent || "").trim().startsWith(name);
        })!;

      expect({
        place,
        saysNotInTable: (option.textContent || "").includes(
          "Its breach law is not in OneUptime's table",
        ),
      }).toEqual({
        place,
        saysNotInTable: UNCOVERED_US_STATES.includes(place),
      });
    }
  });

  test("an answer saved before every state was named keeps its Another US state, as a chip to take back", async () => {
    reads.mockResolvedValue(
      answerOf({
        view: viewOf({ countries: [], places: [BreachPlace.OtherUsState] }),
        assessment: assessmentOf({
          peopleLiveIn: {
            places: [BreachPlace.OtherUsState],
            saidAt: NOW.toISOString(),
            saidByUserId: USER_ID,
          },
        }),
        editors: { [USER_ID]: "Alice Example" },
      }),
    );

    await renderCards();

    expect(
      screen.getByText(
        "Alice Example said the people live in another US state.",
      ),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(
        screen.getByTestId("security-case-exposure-places-change"),
      );
    });

    const chip: HTMLElement = screen.getByTestId(
      `security-case-exposure-place-${BreachPlace.OtherUsState}`,
    );

    expect(chip).toHaveAttribute("aria-pressed", "true");
  });
});

describe("the US states' laws, while nobody said which states (#10952)", () => {
  test("are one block saying how many states' laws may apply, folded, each state's notices under its name in alphabetical order", async () => {
    reads.mockResolvedValue(ssnAnswer([BreachPlace.UnitedStates]));

    await renderCards();

    const block: HTMLElement = screen.getByTestId(
      "security-case-exposure-state-laws",
    );

    expect(block).toHaveTextContent("US state laws");
    expect(block).toHaveTextContent(
      `The breach laws of ${COVERED_US_STATES.length} US states may apply if any of the people live there.`,
    );
    expect(block).toHaveTextContent(
      "Say which states they live in, and only those states' laws stay.",
    );
    // Folded: no state's row is drawn until asked for.
    expect(
      screen.queryByTestId(
        `security-case-exposure-law-${BreachLawId.AlabamaResidents}`,
      ),
    ).not.toBeInTheDocument();

    const toggle: HTMLElement = within(block).getByRole("button", {
      name: "Show the states' laws",
    });

    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await act(async () => {
      fireEvent.click(toggle);
    });

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveTextContent("Hide the states' laws");

    const sections: Array<HTMLElement> = within(block).getAllByTestId(
      /^security-case-exposure-state-laws-US-/,
    );

    expect(sections).toHaveLength(COVERED_US_STATES.length);
    expect(sections[0]).toHaveTextContent("Alabama");

    const alabama: HTMLElement = within(block).getByTestId(
      `security-case-exposure-state-laws-${BreachPlace.Alabama}`,
    );

    expect(
      within(alabama).getByTestId(
        `security-case-exposure-law-${BreachLawId.AlabamaResidents}`,
      ),
    ).toHaveAttribute("data-status", "MayApply");
    expect(
      within(alabama).getByTestId(
        `security-case-exposure-law-${BreachLawId.AlabamaAttorneyGeneral}`,
      ),
    ).toBeInTheDocument();
    expect(
      within(block).getByTestId(
        `security-case-exposure-state-laws-${BreachPlace.Georgia}`,
      ),
    ).toHaveTextContent("Georgia");
    expect(block).not.toHaveTextContent("Georgia (US state)");
  });

  test("a state a person named is drawn on its own with its deadline, and the others' laws are counted as not applying", async () => {
    reads.mockResolvedValue(ssnAnswer([BreachPlace.Indiana]));

    await renderCards();

    // Indiana's 45 days are due first.
    expect(
      screen.getByTestId("security-case-exposure-headline"),
    ).toHaveAttribute("data-rule", BreachLawId.IndianaResidents);
    expect(
      screen.getByTestId(
        `security-case-exposure-law-${BreachLawId.IndianaAttorneyGeneral}`,
      ),
    ).toHaveAttribute("data-status", "MayApply");
    expect(
      screen.queryByTestId("security-case-exposure-state-laws"),
    ).not.toBeInTheDocument();

    const more: HTMLElement = screen.getByTestId(
      "security-case-exposure-more-laws",
    );

    await act(async () => {
      fireEvent.click(more);
    });

    expect(
      screen.getByTestId("security-case-exposure-states-not-applying"),
    ).toHaveTextContent(
      `The breach laws of ${COVERED_US_STATES.length - 1} more US states do not apply on these facts.`,
    );
    expect(
      screen.queryByTestId(
        `security-case-exposure-law-${BreachLawId.AlabamaResidents}`,
      ),
    ).not.toBeInTheDocument();
  });

  test("a store none of whose data a state's law covers counts every state as not applying, folded", async () => {
    await renderCards();

    const more: HTMLElement = screen.getByTestId(
      "security-case-exposure-more-laws",
    );

    await act(async () => {
      fireEvent.click(more);
    });

    expect(
      screen.getByTestId("security-case-exposure-states-not-applying"),
    ).toHaveTextContent(
      `The breach laws of ${COVERED_US_STATES.length} more US states do not apply on these facts.`,
    );
  });

  test("what the table does not cover names every state it leaves out - no territory, as their laws are rows now - asks whose data it is, and never names the agencies' notices, which are rows", async () => {
    reads.mockResolvedValue(ssnAnswer([BreachPlace.UnitedStates]));

    await renderCards();

    const uncovered: HTMLElement = screen.getByTestId(
      "security-case-exposure-uncovered",
    );

    // Puerto Rico's, Guam's and the US Virgin Islands' laws are in the table (#11424, #11426).
    expect(uncovered).not.toHaveTextContent("Guam");
    expect(uncovered).not.toHaveTextContent("Virgin Islands");
    expect(uncovered).not.toHaveTextContent("Puerto Rico");
    expect(uncovered).not.toHaveTextContent("consumer reporting agencies");
    // Nobody said whose data it is: the notices to its owner wait on the answer (#11427).
    expect(uncovered).toHaveTextContent(
      "If your organization holds this data for another, the law may ask you to tell the data's owner. Say whose data it is on the Was It a Breach? card to see those notices.",
    );

    if (UNCOVERED_US_STATES.length > 0) {
      expect(uncovered).toHaveTextContent(
        "It does not cover the breach laws of",
      );
      expect(uncovered).toHaveTextContent(
        "whose statutes could not be read from an official source: check them yourself.",
      );
      expect(uncovered).toHaveTextContent("West Virginia");
    } else {
      expect(uncovered).not.toHaveTextContent(
        "It does not cover the breach laws of",
      );
    }
  });
});

/*
 * WHOSE DATA IT IS (#11427): ONE SWITCH, KEPT WITH WHO SAID IT. No scan can
 * tell whose data a store holds for whom, so a person says: on, the notices
 * the law asks a holder to send the data's owner are drawn - Texas's
 * immediately, due before anything else; off, the data is the
 * organization's own. While nobody has said, the table says those notices
 * wait on the answer.
 */
function texasAnswer(
  heldFor?: boolean,
  data: Partial<DataSecurityExposureAssessmentResponse> = {},
): DataSecurityExposureAssessmentResponse {
  return exposureAnswerOf({
    view: exposureViewOf({
      dataTypeIds: ["us-ssn", "person-name"],
      countries: ["US"],
      places: [BreachPlace.Texas],
      holdsForAnother: heldFor,
    }),
    assessment: exposureAssessmentOf({
      peopleLiveIn: {
        places: [BreachPlace.Texas],
        saidAt: EXPOSURE_NOW.toISOString(),
        saidByUserId: USER_ID,
      },
      ...(heldFor === undefined
        ? {}
        : {
            dataHeldFor: {
              forAnother: heldFor,
              saidAt: EXPOSURE_NOW.toISOString(),
              saidByUserId: USER_ID,
            },
          }),
    }),
    editors: { [USER_ID]: "Alice Example" },
    ...data,
  });
}

function dataOwnerSwitch(): HTMLElement {
  return screen.getByTestId("security-case-exposure-data-holder-toggle");
}

async function pressDataOwnerSwitch(): Promise<void> {
  await act(async () => {
    fireEvent.click(dataOwnerSwitch());
  });
  await flush();
}

const HELD_FOR_ANOTHER_LINE: string =
  "If your organization holds this data for another, the law may ask you to tell the data's owner. Say whose data it is on the Was It a Breach? card to see those notices.";

describe("whose data it is: one switch, kept with who said it (#11427)", () => {
  test("nobody said: the switch is off, nothing says who said, and what the table does not cover says the owner's notices wait on it", async () => {
    reads.mockResolvedValue(texasAnswer());

    await renderCards();

    const section: HTMLElement = screen.getByTestId(
      "security-case-exposure-data-holder",
    );

    expect(section).toHaveTextContent("The Data's Owner");
    expect(section).toHaveTextContent(
      "We hold this data for another organization",
    );
    expect(dataOwnerSwitch()).toHaveAttribute("role", "switch");
    expect(dataOwnerSwitch()).toHaveAttribute("aria-checked", "false");
    expect(dataOwnerSwitch()).not.toHaveAttribute("aria-disabled");
    // The switch is named by its title and described by what it does.
    expect(dataOwnerSwitch()).toHaveAccessibleName(
      "We hold this data for another organization",
    );
    expect(dataOwnerSwitch()).toHaveAccessibleDescription(
      "On, the notices the law asks a vendor or service provider to send the data's owner are added.",
    );
    expect(
      screen.queryByTestId("security-case-exposure-data-holder-said"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("security-case-exposure-uncovered"),
    ).toHaveTextContent(HELD_FOR_ANOTHER_LINE);
    // Texas's attorney general's 30 days are due first; no notice to an owner is drawn.
    expect(
      screen.getByTestId("security-case-exposure-headline"),
    ).toHaveAttribute("data-rule", BreachLawId.TexasAttorneyGeneral);
    expect(
      screen.queryByTestId(
        `security-case-exposure-law-${BreachLawId.TexasDataOwner}`,
      ),
    ).not.toBeInTheDocument();
  });

  test("switching it on saves the answer: Texas's notice to the owner is due first, immediately, and the card says who said so", async () => {
    reads.mockResolvedValue(texasAnswer());
    const saved: SpyInstance<typeof DataSecurityApi.setExposureDataHeldFor> =
      jest
        .spyOn(DataSecurityApi, "setExposureDataHeldFor")
        .mockResolvedValue(texasAnswer(true));
    const toasts: Array<string> = [];

    jest.spyOn(Toast, "success").mockImplementation(((
      message: string,
    ): void => {
      toasts.push(message);
    }) as never);

    await renderCards();
    await pressDataOwnerSwitch();

    expect(saved).toHaveBeenCalledTimes(1);
    expect(saved).toHaveBeenCalledWith({
      securityCaseId: CASE_ID,
      forAnother: true,
    });
    expect(toasts).toEqual(["Answer saved."]);
    expect(dataOwnerSwitch()).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByTestId("security-case-exposure-data-holder-said"),
    ).toHaveTextContent(
      "Alice Example said your organization holds this data for another organization.",
    );

    const headline: HTMLElement = screen.getByTestId(
      "security-case-exposure-headline",
    );

    // "Immediately after discovering the breach": before the attorney general's 30 days, with no moment of its own.
    expect(headline).toHaveAttribute("data-rule", BreachLawId.TexasDataOwner);
    expect(headline).toHaveTextContent("Tell the data's owner");
    expect(headline).toHaveTextContent(
      "Texas Business and Commerce Code 521.053(c)",
    );
    expect(headline).toHaveTextContent("Immediately");
    expect(headline).toHaveTextContent(
      "Counted from when Data Security found it",
    );
    // No due date of its own: "Due first" heads it, and no "Due <date>" line follows.
    expect(headline).not.toHaveTextContent(/Due [A-Z][a-z]+ \d/);
    expect(headline).toHaveTextContent("May apply");
    expect(
      within(headline).queryByTestId("security-case-exposure-due-state"),
    ).not.toBeInTheDocument();
    // The attorney general's notice is still listed after it; the table no longer says the answer is missing.
    expect(
      screen.getByTestId(
        `security-case-exposure-law-${BreachLawId.TexasAttorneyGeneral}`,
      ),
    ).toHaveAttribute("data-status", "MayApply");
    expect(
      screen.getByTestId("security-case-exposure-uncovered"),
    ).not.toHaveTextContent(HELD_FOR_ANOTHER_LINE);
  });

  test("switching it off says the data is the organization's own: the owner's notices go, and the attorney general's 30 days are due first again", async () => {
    reads.mockResolvedValue(texasAnswer(true));
    const saved: SpyInstance<typeof DataSecurityApi.setExposureDataHeldFor> =
      jest
        .spyOn(DataSecurityApi, "setExposureDataHeldFor")
        .mockResolvedValue(texasAnswer(false));

    jest.spyOn(Toast, "success").mockImplementation((() => {}) as never);

    await renderCards();

    expect(dataOwnerSwitch()).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByTestId("security-case-exposure-headline"),
    ).toHaveAttribute("data-rule", BreachLawId.TexasDataOwner);

    await pressDataOwnerSwitch();

    expect(saved).toHaveBeenCalledWith({
      securityCaseId: CASE_ID,
      forAnother: false,
    });
    expect(dataOwnerSwitch()).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByTestId("security-case-exposure-data-holder-said"),
    ).toHaveTextContent(
      "Alice Example said this data is your organization's own.",
    );
    expect(
      screen.getByTestId("security-case-exposure-headline"),
    ).toHaveAttribute("data-rule", BreachLawId.TexasAttorneyGeneral);
    expect(
      screen.queryByTestId(
        `security-case-exposure-law-${BreachLawId.TexasDataOwner}`,
      ),
    ).not.toBeInTheDocument();
    // Answered: the table no longer asks.
    expect(
      screen.getByTestId("security-case-exposure-uncovered"),
    ).not.toHaveTextContent(HELD_FOR_ANOTHER_LINE);
  });

  test("an answer that is not saved says why, and the switch goes back to the answer that is", async () => {
    reads.mockResolvedValue(texasAnswer());
    const saved: SpyInstance<typeof DataSecurityApi.setExposureDataHeldFor> =
      jest
        .spyOn(DataSecurityApi, "setExposureDataHeldFor")
        .mockRejectedValue(
          new DataSecurityApiError("The server is restarting.", 503),
        );
    const success: SpyInstance<typeof Toast.success> = jest
      .spyOn(Toast, "success")
      .mockImplementation((() => {}) as never);

    await renderCards();
    await pressDataOwnerSwitch();

    expect(saved).toHaveBeenCalledTimes(1);
    expect(success).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("security-case-exposure-data-holder"),
    ).toHaveTextContent("The server is restarting.");
    expect(dataOwnerSwitch()).toHaveAttribute("aria-checked", "false");
    expect(dataOwnerSwitch()).not.toHaveAttribute("aria-disabled");
    expect(
      screen.queryByTestId("security-case-exposure-data-holder-said"),
    ).not.toBeInTheDocument();

    // Pressed again, it is saved: the error goes.
    saved.mockResolvedValueOnce(texasAnswer(true));
    await pressDataOwnerSwitch();

    expect(saved).toHaveBeenCalledTimes(2);
    expect(dataOwnerSwitch()).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByTestId("security-case-exposure-data-holder"),
    ).not.toHaveTextContent("The server is restarting.");
  });

  test("a reader who may not change the case sees the answer and who gave it, on a switch that says why it is locked", async () => {
    reads.mockResolvedValue(texasAnswer(true, { canChange: false }));
    const saved: SpyInstance<typeof DataSecurityApi.setExposureDataHeldFor> =
      jest.spyOn(DataSecurityApi, "setExposureDataHeldFor");

    await renderCards();

    expect(dataOwnerSwitch()).toHaveAttribute("aria-checked", "true");
    expect(dataOwnerSwitch()).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByTestId("security-case-exposure-data-holder"),
    ).toHaveTextContent("Someone who can edit this case can change this.");
    expect(
      screen.getByTestId("security-case-exposure-data-holder-said"),
    ).toHaveTextContent(
      "Alice Example said your organization holds this data for another organization.",
    );

    await pressDataOwnerSwitch();

    expect(saved).not.toHaveBeenCalled();
    expect(dataOwnerSwitch()).toHaveAttribute("aria-checked", "true");
  });

  test("an answer from someone the project no longer names says someone gave it", async () => {
    reads.mockResolvedValue(texasAnswer(true, { editors: {} }));

    await renderCards();

    expect(
      screen.getByTestId("security-case-exposure-data-holder-said"),
    ).toHaveTextContent(
      "Someone said your organization holds this data for another organization.",
    );

    cleanup();
    reads.mockResolvedValue(texasAnswer(false, { editors: {} }));
    await renderCards();

    expect(
      screen.getByTestId("security-case-exposure-data-holder-said"),
    ).toHaveTextContent("Someone said this data is your organization's own.");
  });

  test("a store with nothing a breach law lists is not asked whose data it is, unless someone already said", async () => {
    const nothingListed: DataSecurityExposureAssessmentResponse =
      exposureAnswerOf({
        view: exposureViewOf({ dataTypeIds: [] }),
      });

    reads.mockResolvedValue(nothingListed);
    await renderCards();

    expect(
      screen.queryByTestId("security-case-exposure-data-holder"),
    ).not.toBeInTheDocument();

    // An answer someone gave stays to be taken back.
    cleanup();
    reads.mockResolvedValue(
      exposureAnswerOf({
        view: exposureViewOf({ dataTypeIds: [], holdsForAnother: true }),
        assessment: exposureAssessmentOf({
          dataHeldFor: {
            forAnother: true,
            saidAt: EXPOSURE_NOW.toISOString(),
            saidByUserId: USER_ID,
          },
        }),
        editors: { [USER_ID]: "Alice Example" },
      }),
    );
    await renderCards();

    expect(dataOwnerSwitch()).toHaveAttribute("aria-checked", "true");
  });

  test("EU emails held for a client: GDPR's notice from a processor to its controller is listed, without undue delay", async () => {
    reads.mockResolvedValue(
      exposureAnswerOf({
        view: exposureViewOf({ holdsForAnother: true }),
        assessment: exposureAssessmentOf({
          dataHeldFor: {
            forAnother: true,
            saidAt: EXPOSURE_NOW.toISOString(),
            saidByUserId: USER_ID,
          },
        }),
        editors: { [USER_ID]: "Alice Example" },
      }),
    );

    await renderCards();

    const processor: HTMLElement = screen.getByTestId(
      `security-case-exposure-law-${BreachLawId.GdprProcessor}`,
    );

    expect(processor).toHaveAttribute("data-status", "MayApply");
    expect(processor).toHaveTextContent("Without undue delay");
    // The controller's 72 hours are still due first.
    expect(
      screen.getByTestId("security-case-exposure-headline"),
    ).toHaveAttribute("data-rule", BreachLawId.GdprAuthority);
  });
});

describe("the card's words for the rows of #11425 and #11427", () => {
  const ENGLISH: Translator = createTranslator((): undefined => {
    return undefined;
  }, "en");

  test("a notice to the data's owner reads Immediately, As soon as practicable, or its hours", () => {
    expect(
      describeDeadline(getBreachLawRule(BreachLawId.TexasDataOwner), ENGLISH),
    ).toBe("Immediately");
    expect(
      describeDeadline(
        getBreachLawRule(BreachLawId.MassachusettsDataOwner),
        ENGLISH,
      ),
    ).toBe("As soon as practicable");
    // Georgia's: within 24 hours of discovering the breach.
    expect(
      describeDeadline(getBreachLawRule(BreachLawId.GeorgiaDataOwner), ENGLISH),
    ).toBe("Within 24 hours of finding it");
    // GDPR's processor: without undue delay.
    expect(
      describeDeadline(getBreachLawRule(BreachLawId.GdprProcessor), ENGLISH),
    ).toBe("Without undue delay");
  });

  test("Vermont's text from 2027, for an exposure found before it: it took effect after, and the text in force when it was found applies (#11425)", () => {
    const obligations: Array<BreachObligation> = applyBreachLaws({
      whose: getWhoseData({
        dataTypes: ["us-ssn", "person-name"].map((id: string) => {
          return {
            id,
            name: getBuiltInDataType(id)?.name || id,
            category: getBuiltInDataType(id)?.category || "",
          };
        }),
        subjectCountries: ["US"],
        placesNamed: [BreachPlace.Vermont],
      }),
      reads: {
        logged: ExposureReadsLogged.NotLogged,
        isPublic: true,
        outsideAccounts: 0,
        outsideAccountsUsedInWindow: 0,
        isTreatedAsRead: true,
      },
      foundAt: new Date("2026-12-20T09:00:00.000Z"),
      now: new Date("2027-01-05T09:00:00.000Z"),
    });
    const newer: BreachObligation = obligations.find(
      (obligation: BreachObligation): boolean => {
        return obligation.ruleId === BreachLawId.VermontResidentsFrom2027;
      },
    )!;
    const older: BreachObligation = obligations.find(
      (obligation: BreachObligation): boolean => {
        return obligation.ruleId === BreachLawId.VermontResidents;
      },
    )!;

    expect(newer.status).toBe(BreachObligationStatus.NotTriggered);
    expect(newer.reasons).toContainEqual({
      kind: BreachReasonKind.InForceAfterFound,
      date: "2027-01-01",
    });
    expect(describeWhyNot(newer, ENGLISH)).toEqual([
      expect.stringMatching(
        /^It took effect on Jan(uary)? 1, 2027, after the exposure was found: the text in force when it was found applies\.$/,
      ),
    ]);
    // The text in force when it was found may apply, and says nothing against it.
    expect(older.status).toBe(BreachObligationStatus.MayApply);
    expect(describeWhyNot(older, ENGLISH)).toEqual([]);
  });

  test("Vermont's text from 2027, before it takes effect: in force from its day (#11425)", () => {
    const obligations: Array<BreachObligation> = applyBreachLaws({
      whose: getWhoseData({
        dataTypes: ["us-ssn", "person-name"].map((id: string) => {
          return {
            id,
            name: getBuiltInDataType(id)?.name || id,
            category: getBuiltInDataType(id)?.category || "",
          };
        }),
        subjectCountries: ["US"],
        placesNamed: [BreachPlace.Vermont],
      }),
      reads: {
        logged: ExposureReadsLogged.NotLogged,
        isPublic: true,
        outsideAccounts: 0,
        outsideAccountsUsedInWindow: 0,
        isTreatedAsRead: true,
      },
      foundAt: new Date("2026-12-20T09:00:00.000Z"),
      now: new Date("2026-12-21T09:00:00.000Z"),
    });
    const newer: BreachObligation = obligations.find(
      (obligation: BreachObligation): boolean => {
        return obligation.ruleId === BreachLawId.VermontResidentsFrom2027;
      },
    )!;

    expect(newer.status).toBe(BreachObligationStatus.NotYetInForce);
    expect(describeWhyNot(newer, ENGLISH)).toEqual([
      expect.stringMatching(/^In force from Jan(uary)? 1, 2027\.$/),
    ]);
  });
});
