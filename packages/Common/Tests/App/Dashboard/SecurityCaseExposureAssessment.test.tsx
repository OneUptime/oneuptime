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

import DataSecurityApi, {
  DataSecurityApiError,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/DataSecurityApi";
import SecurityCaseExposureAssessment, {
  isCaseAboutAStore,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Exposure/SecurityCaseExposureAssessment";
import {
  DRAFT_NOT_LEGAL_ADVICE,
  NOT_LEGAL_ADVICE,
  READS_NOT_LOGGED,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Exposure/ExposureAssessmentCopy";
import {
  BreachLawId,
  BreachPlace,
} from "../../../Types/DataSecurity/BreachLaws";
import { DataSecurityExposureAssessmentResponse } from "../../../Types/DataSecurity/DataSecurityApiTypes";
import DataSensitivity from "../../../Types/DataSecurity/DataSensitivity";
import { getBuiltInDataType } from "../../../Types/DataSecurity/DataTypeCatalog";
import {
  buildExposureAssessmentView,
  ExposureAssessmentStarter,
  ExposureAssessmentView,
  ExposureDraftPart,
  ExposureIssueEvent,
  ExposureWindow,
  getExposureReads,
  getExposureWindow,
  getWhoseData,
  startExposureAssessment,
  StoredExposureAssessment,
} from "../../../Types/DataSecurity/ExposureAssessment";
import {
  ExposureChecklistAnswer,
  ExposureChecklistItem,
  getExposureChecklistAnswers,
} from "../../../Types/DataSecurity/ExposureChecklist";
import { ImpactAssessmentSectionSource } from "../../../Types/DataSecurity/ImpactAssessment";
import { JSONArray } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { getDataStoreEntityValue } from "../../../Types/SecurityCase/SecurityEntity";

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
        `security-case-exposure-law-${BreachLawId.TexasIndividuals}`,
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
        `security-case-exposure-law-${BreachLawId.TexasIndividuals}`,
      ),
    ).toHaveAttribute("data-status", "NotTriggered");
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
