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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import fs from "fs";
import path from "path";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import IncidentNumbering from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentNumbering";
import AlertNumbering from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/Settings/AlertNumbering";
import ScheduledMaintenanceNumbering from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceNumbering";
import {
  ALERT_NEXT_NUMBERS,
  ANY_NUMBER_FROM_ONE,
  HIGHER_THAN_HIGHEST_TEMPLATE,
  HIGHEST_SO_FAR_LABEL,
  INCIDENT_NEXT_NUMBERS,
  NEXT_NUMBER_CARD_TITLE,
  NEXT_NUMBER_EDIT_BUTTON_TITLE,
  NEXT_NUMBER_EDIT_MODAL_TITLE,
  NEXT_NUMBER_PAGES,
  NEXT_NUMBER_PROBLEM_MESSAGES,
  NONE_USED_YET,
  NUMBER_TAKEN_MEANWHILE_TEMPLATE,
  NextNumberPage,
  NextNumberRow,
  SCHEDULED_MAINTENANCE_NEXT_NUMBERS,
  getNextNumberChanges,
  getNextNumberColumns,
  getNextNumberFormValues,
  getNumberingByKind,
  getNumbersTakenMeanwhile,
  getStartsAtColumn,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NextNumber/NextNumberSettings";
import NumberingAPI from "../../../../App/FeatureSet/Dashboard/src/Components/NextNumber/NumberingAPI";
import {
  getProjectColumnsPermissionMessage,
  getProjectColumnsUpdatePermissions,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/ProjectColumnEditGate";
import Project from "../../../Models/DatabaseModels/Project";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { APP_API_URL } from "../../../UI/Config";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import User from "../../../UI/Utils/User";
import NextNumberUtil, {
  NUMBERED_RECORD_KINDS,
  NextNumberProblem,
  NumberedRecordKind,
  NumberedRecordKindInfo,
  RecordNumbering,
} from "../../../Utils/Project/NextNumber";
import { NUMBER_PREFIX_COLUMNS } from "../../../Utils/Project/NumberPrefix";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

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

/*
 * The Next Number card of the Numbering pages: Incidents, Alerts and
 * Scheduled Maintenance → Settings → Numbering, under the Number Prefix card.
 *
 * A customer moving from incident.io asked to start OneUptime's incident
 * numbers higher, so legacy incidents are easy to tell apart. The card shows,
 * for each kind of number, the number the next record gets (with its prefix)
 * and the highest used so far; its Update dialog sets the next numbers, says
 * what each must be higher than, previews the number, refuses one at or
 * below the highest used, and saves only the numbers that changed. The real
 * pages are rendered with the numbering route, the model API and the
 * permission snapshot stubbed.
 */

const WAIT_TIMEOUT: number = 20000;

interface PageUnderTest {
  name: string;
  page: NextNumberPage;
  Component: React.FunctionComponent<any>;
  productPath: string;
  // The kinds of the page's rows, and what the card shows for each.
  rows: Array<{
    kind: NumberedRecordKind;
    label: string;
    next: string;
    highest: string;
  }>;
}

const PAGES: Array<PageUnderTest> = [
  {
    name: "Incidents",
    page: INCIDENT_NEXT_NUMBERS,
    Component: IncidentNumbering,
    productPath: "incidents",
    rows: [
      {
        kind: NumberedRecordKind.Incident,
        label: "Incidents",
        next: "INC-2346",
        highest: "2345",
      },
      {
        kind: NumberedRecordKind.IncidentEpisode,
        label: "Incident Episodes",
        next: "IE-13",
        highest: "12",
      },
    ],
  },
  {
    name: "Alerts",
    page: ALERT_NEXT_NUMBERS,
    Component: AlertNumbering,
    productPath: "alerts",
    rows: [
      {
        kind: NumberedRecordKind.Alert,
        label: "Alerts",
        next: "ALT-48211",
        highest: "48210",
      },
      {
        kind: NumberedRecordKind.AlertEpisode,
        label: "Alert Episodes",
        next: "AE-311",
        highest: "310",
      },
    ],
  },
  {
    name: "Scheduled Maintenance",
    page: SCHEDULED_MAINTENANCE_NEXT_NUMBERS,
    Component: ScheduledMaintenanceNumbering,
    productPath: "scheduled-maintenance-events",
    rows: [
      {
        kind: NumberedRecordKind.ScheduledMaintenance,
        label: "Events",
        next: "SM-58",
        highest: "57",
      },
    ],
  },
];

const BASE_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];

// Where the numbers stand on the server: what the numbering route answers.
let numbering: Array<RecordNumbering>;
let numberingAnswer: "ok" | "error" | "never";
let getSpy: ReturnType<typeof jest.spyOn>;
let updateSpy: ReturnType<typeof jest.spyOn>;
let updateAnswer: "ok" | "refuse";

function entry(
  kind: NumberedRecordKind,
  prefix: string | null,
  highestNumber: number,
  numbersStartAt: number | null = null,
): RecordNumbering {
  return {
    kind,
    prefix,
    highestNumber,
    nextNumber: NextNumberUtil.getNextNumber({ highestNumber, numbersStartAt }),
    numbersStartAt,
  };
}

function standardNumbering(): Array<RecordNumbering> {
  return [
    entry(NumberedRecordKind.Incident, "INC-", 2345),
    entry(NumberedRecordKind.IncidentEpisode, "IE-", 12),
    entry(NumberedRecordKind.Alert, "ALT-", 48210),
    entry(NumberedRecordKind.AlertEpisode, "AE-", 310),
    entry(NumberedRecordKind.ScheduledMaintenance, "SM-", 57),
  ];
}

function setEntry(changed: RecordNumbering): void {
  numbering = numbering.map((current: RecordNumbering): RecordNumbering => {
    return current.kind === changed.kind ? changed : current;
  });
}

function grant(permissions: Array<Permission>, isMasterAdmin?: boolean): void {
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(Boolean(isMasterAdmin));
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

function pagePath(under: PageUnderTest): string {
  return `/dashboard/${PROJECT_ID}/${under.productPath}/settings/numbering`;
}

function openPage(under: PageUnderTest): void {
  goTo(pagePath(under));
  const Component: React.FunctionComponent<any> = under.Component;
  render(
    <MemoryRouter initialEntries={[pagePath(under)]}>
      <Component
        pageRoute={null}
        currentProject={null}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );
}

async function nextNumberCard(): Promise<HTMLElement> {
  return (
    await screen.findByText(
      NEXT_NUMBER_CARD_TITLE,
      {},
      { timeout: WAIT_TIMEOUT },
    )
  ).closest('[data-testid="card"]') as HTMLElement;
}

async function row(kind: NumberedRecordKind): Promise<HTMLElement> {
  return await screen.findByTestId(
    `next-number-row-${kind}`,
    {},
    { timeout: WAIT_TIMEOUT },
  );
}

// What a row shows: the next number, and the highest used (or none).
async function rowShows(kind: NumberedRecordKind): Promise<[string, string]> {
  const element: HTMLElement = await row(kind);

  return [
    within(element).getByTestId("next-number-value").textContent || "",
    element.textContent?.includes(HIGHEST_SO_FAR_LABEL)
      ? `${HIGHEST_SO_FAR_LABEL} ${within(element).getByTestId("next-number-highest").textContent}`
      : within(element).getByTestId("next-number-highest").textContent || "",
  ];
}

async function updateButtons(): Promise<Array<HTMLElement>> {
  const cardElement: HTMLElement = await nextNumberCard();
  await within(cardElement).findByText(
    NEXT_NUMBER_EDIT_BUTTON_TITLE,
    {},
    { timeout: WAIT_TIMEOUT },
  );

  return within(cardElement)
    .getAllByText(NEXT_NUMBER_EDIT_BUTTON_TITLE)
    .map((text: HTMLElement): HTMLElement => {
      return text.closest("button") as HTMLElement;
    });
}

async function openDialog(): Promise<HTMLElement> {
  const buttons: Array<HTMLElement> = await updateButtons();
  expect(buttons).toHaveLength(1);
  fireEvent.click(buttons[0]!);
  return await screen.findByRole("dialog", {}, { timeout: WAIT_TIMEOUT });
}

async function field(
  dialog: HTMLElement,
  kind: NumberedRecordKind,
): Promise<HTMLInputElement> {
  return (await within(dialog).findByTestId(
    `next-number-field-${kind}`,
    {},
    { timeout: WAIT_TIMEOUT },
  )) as HTMLInputElement;
}

function type(input: HTMLInputElement, value: string): void {
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

function preview(dialog: HTMLElement, kind: NumberedRecordKind): string | null {
  const footer: HTMLElement | null = within(dialog).queryByTestId(
    `next-number-preview-${kind}`,
  );
  return footer
    ? within(footer).getByTestId("next-number-preview").textContent
    : null;
}

async function waitForPreview(
  dialog: HTMLElement,
  kind: NumberedRecordKind,
  text: string | null,
): Promise<void> {
  await waitFor(
    () => {
      expect(preview(dialog, kind)).toBe(text);
    },
    { timeout: WAIT_TIMEOUT },
  );
}

function submit(dialog: HTMLElement): void {
  fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));
}

function numberingUrl(): string {
  return URL.fromString(APP_API_URL.toString())
    .addRoute(NumberingAPI.getPath(new ObjectID(PROJECT_ID)))
    .toString();
}

function numberingReads(): number {
  return getSpy.mock.calls.filter((call: Array<unknown>): boolean => {
    return (call[0] as { url: URL }).url.toString() === numberingUrl();
  }).length;
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  grant([...BASE_PERMISSIONS, Permission.ProjectOwner]);

  numbering = standardNumbering();
  numberingAnswer = "ok";
  updateAnswer = "ok";

  getSpy = jest.spyOn(API, "get").mockImplementation((async (options: {
    url: URL;
  }): Promise<unknown> => {
    if (options.url.toString() !== numberingUrl()) {
      return new HTTPResponse(200, {}, {});
    }

    if (numberingAnswer === "never") {
      return new Promise(() => {
        // Never answers: the card waits.
      });
    }

    if (numberingAnswer === "error") {
      return new HTTPErrorResponse(
        500,
        { message: "Could not reach the server." },
        {},
      );
    }

    return new HTTPResponse(
      200,
      {
        numbering: numbering.map((current: RecordNumbering): JSONObject => {
          return { ...current } as unknown as JSONObject;
        }),
      },
      {},
    );
  }) as never);

  updateSpy = jest
    .spyOn(ModelAPI, "updateById")
    .mockImplementation((async (options: {
      data: JSONObject;
    }): Promise<unknown> => {
      if (updateAnswer === "refuse") {
        // A record took the number meanwhile.
        setEntry(entry(NumberedRecordKind.Incident, "INC-", 2400));
        throw new HTTPErrorResponse(
          400,
          {
            message:
              "Incident Numbers Start At must be higher than 2400, the highest incident number used so far. A number is never used twice.",
          },
          {},
        );
      }

      for (const info of NUMBERED_RECORD_KINDS) {
        const value: unknown = options.data[info.startsAtColumn];

        if (typeof value === "number") {
          const current: RecordNumbering = numbering.find(
            (candidate: RecordNumbering): boolean => {
              return candidate.kind === info.kind;
            },
          )!;
          setEntry(
            entry(info.kind, current.prefix, current.highestNumber, value),
          );
        }
      }

      return new HTTPResponse(200, {}, {});
    }) as never);

  // The Number Prefix card above it reads the project.
  jest
    .spyOn(ModelAPI, "getItem")
    .mockImplementation((async (): Promise<Project> => {
      const project: Project = new Project();
      project._id = PROJECT_ID;
      return project;
    }) as never);
  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(async (): Promise<ListResult<Project>> => {
      return { data: [], count: 0, skip: 0, limit: 10 };
    });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("what each page holds", () => {
  test("each kind of number has its row on exactly one page, in the prefix card's order", () => {
    const kinds: Array<NumberedRecordKind> = NEXT_NUMBER_PAGES.flatMap(
      (page: NextNumberPage): Array<NumberedRecordKind> => {
        return page.rows.map((nextRow: NextNumberRow): NumberedRecordKind => {
          return nextRow.kind;
        });
      },
    );

    expect(kinds).toEqual(
      NUMBERED_RECORD_KINDS.map((info: NumberedRecordKindInfo) => {
        return info.kind;
      }),
    );
    expect(
      NEXT_NUMBER_PAGES.flatMap((page: NextNumberPage): Array<string> => {
        return getNextNumberColumns(page);
      }),
    ).toEqual(
      NUMBERED_RECORD_KINDS.map((info: NumberedRecordKindInfo): string => {
        return info.startsAtColumn;
      }),
    );
  });

  test("each row is labelled as the Number Prefix card above it labels its kind", () => {
    for (const under of PAGES) {
      expect(
        under.page.rows.map((nextRow: NextNumberRow): string => {
          return nextRow.label;
        }),
      ).toEqual(
        under.rows.map((expected: { label: string }): string => {
          return expected.label;
        }),
      );
    }
    // And there is one row per prefix, as there is one prefix per kind.
    expect(
      NEXT_NUMBER_PAGES.flatMap((page: NextNumberPage) => {
        return page.rows;
      }),
    ).toHaveLength(NUMBER_PREFIX_COLUMNS.length);
  });

  test("each field names the kind its number is for", () => {
    expect(
      NEXT_NUMBER_PAGES.flatMap((page: NextNumberPage): Array<string> => {
        return page.rows.map((nextRow: NextNumberRow): string => {
          return nextRow.formTitle;
        });
      }),
    ).toEqual([
      "Next Incident Number",
      "Next Incident Episode Number",
      "Next Alert Number",
      "Next Alert Episode Number",
      "Next Scheduled Maintenance Number",
    ]);
  });

  test("the pages have their own form names", () => {
    const names: Array<string> = NEXT_NUMBER_PAGES.map(
      (page: NextNumberPage): string => {
        return page.name;
      },
    );

    expect(new Set(names).size).toBe(names.length);
  });

  test("the card speaks to a team moving from another tool, and says a number is never used twice", () => {
    for (const page of NEXT_NUMBER_PAGES) {
      expect(page.cardDescription).toContain("Moving from another tool?");
      expect(page.editDescription).toContain("A number is never used twice");
      expect(page.editDescription).toContain("keep their numbers");
    }
  });

  test("the problem messages the dialog shows are NextNumberUtil's own", () => {
    expect([...NEXT_NUMBER_PROBLEM_MESSAGES]).toEqual(
      [
        NextNumberProblem.NotWholeNumber,
        NextNumberProblem.BelowOne,
        NextNumberProblem.TooLarge,
        NextNumberProblem.NotAboveHighest,
      ].map((problem: NextNumberProblem): string => {
        return NextNumberUtil.getProblemMessage(problem);
      }),
    );
    expect(Object.values(NextNumberProblem)).toHaveLength(
      NEXT_NUMBER_PROBLEM_MESSAGES.length,
    );
  });
});

describe("what the dialog saves", () => {
  const byKind: ReturnType<typeof getNumberingByKind> =
    getNumberingByKind(standardNumbering());

  test("opens with each row's next number", () => {
    expect(
      getNextNumberFormValues({
        page: INCIDENT_NEXT_NUMBERS,
        numbering: byKind,
      }),
    ).toEqual({
      incidentNumbersStartAt: 2346,
      incidentEpisodeNumbersStartAt: 13,
    });
  });

  test("a number left as it opened is not saved", () => {
    expect(
      getNextNumberChanges({
        page: INCIDENT_NEXT_NUMBERS,
        values: {
          incidentNumbersStartAt: 2346,
          incidentEpisodeNumbersStartAt: "13",
        },
        numbering: byKind,
      }),
    ).toEqual({});
  });

  test("a changed number is saved as where that kind's numbers start, typed or as a number", () => {
    expect(
      getNextNumberChanges({
        page: INCIDENT_NEXT_NUMBERS,
        values: {
          incidentNumbersStartAt: "10000",
          incidentEpisodeNumbersStartAt: 13,
        },
        numbering: byKind,
      }),
    ).toEqual({ incidentNumbersStartAt: 10000 });

    expect(
      getNextNumberChanges({
        page: ALERT_NEXT_NUMBERS,
        values: { alertNumbersStartAt: 50000, alertEpisodeNumbersStartAt: 400 },
        numbering: byKind,
      }),
    ).toEqual({ alertNumbersStartAt: 50000, alertEpisodeNumbersStartAt: 400 });
  });

  test("never writes another page's kinds, or a value that is not a whole number", () => {
    expect(
      getNextNumberChanges({
        page: SCHEDULED_MAINTENANCE_NEXT_NUMBERS,
        values: {
          scheduledMaintenanceNumbersStartAt: "abc",
          incidentNumbersStartAt: 99999,
        },
        numbering: byKind,
      }),
    ).toEqual({});
  });

  test("getStartsAtColumn is each kind's own column", () => {
    for (const info of NUMBERED_RECORD_KINDS) {
      expect(getStartsAtColumn(info.kind)).toBe(info.startsAtColumn);
    }
  });
});

describe.each(PAGES)(
  "$name → Settings → Numbering: the Next Number card",
  (under: PageUnderTest) => {
    const first: NumberedRecordKind = under.rows[0]!.kind;
    const firstColumn: string = getStartsAtColumn(first);

    test("reads where the numbers stand from the project's numbering route", async () => {
      openPage(under);
      await row(first);

      expect(numberingReads()).toBe(1);
    });

    test("shows each kind's next number with its prefix, and the highest used so far", async () => {
      openPage(under);

      for (const expected of under.rows) {
        expect(await rowShows(expected.kind)).toEqual([
          expected.next,
          `${HIGHEST_SO_FAR_LABEL} ${expected.highest}`,
        ]);
      }

      const cardElement: HTMLElement = await nextNumberCard();
      const titles: Array<string> = Array.from(
        cardElement.querySelectorAll("label > span"),
      ).map((title: Element): string => {
        return title.textContent || "";
      });

      expect(titles).toEqual(
        under.rows.map((expected: { label: string }): string => {
          return expected.label;
        }),
      );
      expect(
        within(cardElement).getByText(under.page.cardDescription),
      ).toBeInTheDocument();
    });

    test("a kind with no records yet starts at 1, and says none is used yet", async () => {
      setEntry(
        entry(
          first,
          numbering.find((current: RecordNumbering) => {
            return current.kind === first;
          })!.prefix,
          0,
        ),
      );
      openPage(under);

      const [next, highest] = await rowShows(first);

      expect(next.endsWith("-1")).toBe(true);
      expect(highest).toBe(NONE_USED_YET);
    });

    test("a project without a prefix numbers with #", async () => {
      setEntry(entry(first, null, 2345));
      openPage(under);

      expect(await rowShows(first)).toEqual([
        "#2346",
        `${HIGHEST_SO_FAR_LABEL} 2345`,
      ]);
    });

    test("a start the project chose is the next number until records reach it", async () => {
      setEntry(entry(first, "OPS-", 2345, 10000));
      openPage(under);

      expect(await rowShows(first)).toEqual([
        "OPS-10000",
        `${HIGHEST_SO_FAR_LABEL} 2345`,
      ]);
    });

    test("the highest is the bare number: a record keeps the prefix it was numbered with", async () => {
      /*
       * After INC- became OPS-, the highest record is still INC-2345: with
       * today's prefix in front, it would name OPS-2345, which no record is.
       */
      setEntry(entry(first, "OPS-", 2345));
      openPage(under);

      const element: HTMLElement = await row(first);

      expect(within(element).getByTestId("next-number-value").textContent).toBe(
        "OPS-2346",
      );
      expect(
        within(element).getByTestId("next-number-highest").textContent,
      ).toBe("2345");
      expect(element.textContent).not.toContain("OPS-2345");
    });

    test("draws the numbers in monospace, on the elements that hold them", async () => {
      openPage(under);

      const element: HTMLElement = await row(first);

      for (const testId of ["next-number-value", "next-number-highest"]) {
        const code: HTMLElement = within(element).getByTestId(testId);
        expect(code).toHaveClass("font-mono");
        expect(code.children).toHaveLength(0);
      }
    });

    test("waits for the numbers with a loader and no button", async () => {
      numberingAnswer = "never";
      openPage(under);

      const cardElement: HTMLElement = await nextNumberCard();

      expect(
        await within(cardElement).findByTestId(
          "component-loader",
          {},
          { timeout: WAIT_TIMEOUT },
        ),
      ).toBeInTheDocument();
      expect(
        within(cardElement).queryByText(NEXT_NUMBER_EDIT_BUTTON_TITLE),
      ).not.toBeInTheDocument();
    });

    test("says why the numbers could not be read, and reads them again on Refresh", async () => {
      numberingAnswer = "error";
      openPage(under);

      const cardElement: HTMLElement = await nextNumberCard();

      expect(
        await within(cardElement).findByText(
          "Could not reach the server.",
          {},
          { timeout: WAIT_TIMEOUT },
        ),
      ).toBeInTheDocument();
      expect(
        within(cardElement).queryByText(NEXT_NUMBER_EDIT_BUTTON_TITLE),
      ).not.toBeInTheDocument();

      numberingAnswer = "ok";
      fireEvent.click(within(cardElement).getByTestId("refresh-button"));

      expect(await rowShows(first)).toEqual([
        under.rows[0]!.next,
        `${HIGHEST_SO_FAR_LABEL} ${under.rows[0]!.highest}`,
      ]);
      expect(numberingReads()).toBe(2);
    });

    test("Update opens Edit Next Number, saying what the numbers do", async () => {
      openPage(under);

      const dialog: HTMLElement = await openDialog();

      expect(
        within(dialog).getByText(NEXT_NUMBER_EDIT_MODAL_TITLE),
      ).toBeInTheDocument();
      expect(
        within(dialog).getByText(under.page.editDescription),
      ).toBeInTheDocument();
      expect(
        within(dialog).queryByText("Edit Project"),
      ).not.toBeInTheDocument();
    });

    test("the dialog holds one field per kind, each filled in with its next number and previewing it", async () => {
      openPage(under);

      const dialog: HTMLElement = await openDialog();

      for (const expected of under.rows) {
        const input: HTMLInputElement = await field(dialog, expected.kind);
        const next: string = expected.next.split("-").pop()!;

        await waitFor(
          () => {
            expect(input.value).toBe(next);
          },
          { timeout: WAIT_TIMEOUT },
        );
        await waitForPreview(dialog, expected.kind, expected.next);
      }

      for (const nextRow of under.page.rows) {
        expect(within(dialog).getByText(nextRow.formTitle)).toBeInTheDocument();
      }
    });

    test("each field says what its number must be higher than", async () => {
      openPage(under);

      const dialog: HTMLElement = await openDialog();

      for (const expected of under.rows) {
        const highest: string = expected.highest.split("-").pop()!;
        expect(
          within(dialog).getByText(
            HIGHER_THAN_HIGHEST_TEMPLATE.replace("{{highestNumber}}", highest),
          ),
        ).toBeInTheDocument();
      }
    });

    test("a kind with nothing used yet takes any number from 1", async () => {
      for (const expected of under.rows) {
        setEntry(entry(expected.kind, "X-", 0));
      }
      openPage(under);

      const dialog: HTMLElement = await openDialog();

      expect(within(dialog).getAllByText(ANY_NUMBER_FROM_ONE)).toHaveLength(
        under.rows.length,
      );

      type(await field(dialog, first), "1");
      await waitForPreview(dialog, first, "X-1");
    });

    test.each([
      [
        "at the highest used",
        "HIGHEST",
        "Use a number higher than {{highest}}.",
      ],
      ["below the highest used", "1", "Use a number higher than {{highest}}."],
      ["not a whole number", "12.5", "Use a whole number, like 1000."],
      ["text", "abc", "Use a whole number, like 1000."],
      ["below 1", "0", "Use a number of 1 or more."],
      ["too large", "1000000001", "Use a number no higher than 1,000,000,000."],
    ])(
      "refuses a number %s before it is saved, and hides the preview",
      async (_case: string, typed: string, message: string) => {
        openPage(under);

        const highest: string = under.rows[0]!.highest.split("-").pop()!;
        const dialog: HTMLElement = await openDialog();
        const input: HTMLInputElement = await field(dialog, first);

        type(input, typed === "HIGHEST" ? highest : typed);

        expect(
          await within(dialog).findByText(
            message.replace("{{highest}}", highest),
            {},
            { timeout: WAIT_TIMEOUT },
          ),
        ).toBeInTheDocument();
        await waitForPreview(dialog, first, null);

        submit(dialog);
        await new Promise((resolve: (value: unknown) => void) => {
          setTimeout(resolve, 50);
        });
        expect(updateSpy).not.toHaveBeenCalled();
      },
    );

    test("the preview follows a valid number as it is typed", async () => {
      openPage(under);

      const dialog: HTMLElement = await openDialog();
      const input: HTMLInputElement = await field(dialog, first);
      const prefix: string = under.rows[0]!.next.split("-")[0]!;

      type(input, "100000");
      await waitForPreview(dialog, first, `${prefix}-100000`);

      type(input, "777777");
      await waitForPreview(dialog, first, `${prefix}-777777`);
    });

    test("saving a new number writes only that kind's start, then shows it as next", async () => {
      openPage(under);

      const dialog: HTMLElement = await openDialog();
      type(await field(dialog, first), "100000");
      await waitForPreview(
        dialog,
        first,
        `${under.rows[0]!.next.split("-")[0]}-100000`,
      );

      submit(dialog);

      await waitFor(
        () => {
          expect(updateSpy).toHaveBeenCalledTimes(1);
        },
        { timeout: WAIT_TIMEOUT },
      );

      const call: { modelType: unknown; id: ObjectID; data: JSONObject } =
        updateSpy.mock.calls[0]![0] as {
          modelType: unknown;
          id: ObjectID;
          data: JSONObject;
        };

      expect(call.modelType).toBe(Project);
      expect(call.id.toString()).toBe(PROJECT_ID);
      expect(call.data).toEqual({ [firstColumn]: 100000 });

      await waitFor(
        () => {
          expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        },
        { timeout: WAIT_TIMEOUT },
      );

      await waitFor(
        async () => {
          expect((await rowShows(first))[0]).toBe(
            `${under.rows[0]!.next.split("-")[0]}-100000`,
          );
        },
        { timeout: WAIT_TIMEOUT },
      );
      expect(numberingReads()).toBe(2);
    });

    test("saving with nothing changed writes nothing and closes", async () => {
      openPage(under);

      const dialog: HTMLElement = await openDialog();
      await waitForPreview(dialog, first, under.rows[0]!.next);

      submit(dialog);

      await waitFor(
        () => {
          expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        },
        { timeout: WAIT_TIMEOUT },
      );
      expect(updateSpy).not.toHaveBeenCalled();
    });

    test("a number moved back down above the highest used is saved: a typo can be undone", async () => {
      setEntry(
        entry(
          first,
          numbering.find((current: RecordNumbering) => {
            return current.kind === first;
          })!.prefix,
          5,
          100000,
        ),
      );
      openPage(under);

      const dialog: HTMLElement = await openDialog();
      type(await field(dialog, first), "10000");
      submit(dialog);

      await waitFor(
        () => {
          expect(updateSpy).toHaveBeenCalledTimes(1);
        },
        { timeout: WAIT_TIMEOUT },
      );
      expect(
        (updateSpy.mock.calls[0]![0] as { data: JSONObject }).data,
      ).toEqual({ [firstColumn]: 10000 });
    });

    if (under.rows.length > 1) {
      test("saving both numbers writes both starts in one save", async () => {
        openPage(under);

        const dialog: HTMLElement = await openDialog();
        type(await field(dialog, under.rows[0]!.kind), "50000");
        type(await field(dialog, under.rows[1]!.kind), "900");
        submit(dialog);

        await waitFor(
          () => {
            expect(updateSpy).toHaveBeenCalledTimes(1);
          },
          { timeout: WAIT_TIMEOUT },
        );
        expect(
          (updateSpy.mock.calls[0]![0] as { data: JSONObject }).data,
        ).toEqual({
          [getStartsAtColumn(under.rows[0]!.kind)]: 50000,
          [getStartsAtColumn(under.rows[1]!.kind)]: 900,
        });
      });
    }
  },
);

describe("when the server refuses a number", () => {
  const under: PageUnderTest = PAGES[0]!;

  const TAKEN_INCIDENT_NUMBER: string = NUMBER_TAKEN_MEANWHILE_TEMPLATE.replace(
    "{{field}}",
    "Next Incident Number",
  )
    .split("{{highestNumber}}")
    .join("2400");

  test("the dialog stays open, says why in its own words, keeps what was typed, and reads the numbers again", async () => {
    updateAnswer = "refuse";
    openPage(under);

    const dialog: HTMLElement = await openDialog();
    type(await field(dialog, NumberedRecordKind.Incident), "2400");
    submit(dialog);

    // The field's own title, never the API column the server names.
    expect(
      await screen.findByText(
        "Next Incident Number: the highest number used is now 2400. Use a number higher than 2400.",
        {},
        { timeout: WAIT_TIMEOUT },
      ),
    ).toBeInTheDocument();
    expect(TAKEN_INCIDENT_NUMBER).toBe(
      "Next Incident Number: the highest number used is now 2400. Use a number higher than 2400.",
    );
    expect(
      screen.queryByText(/Incident Numbers Start At/),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("dialog")).getByTestId("modal-error"),
    ).toHaveTextContent(TAKEN_INCIDENT_NUMBER);

    const open: HTMLElement = screen.getByRole("dialog");
    const input: HTMLInputElement = await field(
      open,
      NumberedRecordKind.Incident,
    );

    await waitFor(
      () => {
        expect(input.value).toBe("2400");
      },
      { timeout: WAIT_TIMEOUT },
    );

    // Read again: the field now says what it must be higher than.
    expect(
      await within(open).findByText(
        HIGHER_THAN_HIGHEST_TEMPLATE.replace("{{highestNumber}}", "2400"),
        {},
        { timeout: WAIT_TIMEOUT },
      ),
    ).toBeInTheDocument();
    expect(numberingReads()).toBe(2);
  });

  test("names every number records reached, each by its own field", async () => {
    updateSpy.mockImplementation((async (): Promise<unknown> => {
      setEntry(entry(NumberedRecordKind.Incident, "INC-", 2400));
      setEntry(entry(NumberedRecordKind.IncidentEpisode, "IE-", 40));
      throw new HTTPErrorResponse(
        400,
        {
          message:
            "Incident Numbers Start At must be higher than 2400, the highest incident number used so far. A number is never used twice.",
        },
        {},
      );
    }) as never);
    openPage(under);

    const dialog: HTMLElement = await openDialog();
    type(await field(dialog, NumberedRecordKind.Incident), "2400");
    type(await field(dialog, NumberedRecordKind.IncidentEpisode), "30");
    submit(dialog);

    const error: HTMLElement = await screen.findByTestId(
      "modal-error",
      {},
      { timeout: WAIT_TIMEOUT },
    );

    await waitFor(
      () => {
        expect(error).toHaveTextContent(
          "Next Incident Number: the highest number used is now 2400. Use a number higher than 2400. Next Incident Episode Number: the highest number used is now 40. Use a number higher than 40.",
        );
      },
      { timeout: WAIT_TIMEOUT },
    );
  });

  test("a number left as it was is not named, though records moved on", async () => {
    updateSpy.mockImplementation((async (): Promise<unknown> => {
      setEntry(entry(NumberedRecordKind.Incident, "INC-", 2400));
      // Episodes moved on too, but their number was not sent.
      setEntry(entry(NumberedRecordKind.IncidentEpisode, "IE-", 99));
      throw new HTTPErrorResponse(
        400,
        { message: "Incident Numbers Start At must be higher than 2400." },
        {},
      );
    }) as never);
    openPage(under);

    const dialog: HTMLElement = await openDialog();
    type(await field(dialog, NumberedRecordKind.Incident), "2400");
    submit(dialog);

    const error: HTMLElement = await screen.findByTestId(
      "modal-error",
      {},
      { timeout: WAIT_TIMEOUT },
    );

    await waitFor(
      () => {
        expect(error).toHaveTextContent(TAKEN_INCIDENT_NUMBER);
      },
      { timeout: WAIT_TIMEOUT },
    );
    expect(error).not.toHaveTextContent("Next Incident Episode Number");
  });

  test("a refusal for anything else shows the server's own answer", async () => {
    updateSpy.mockImplementation((async (): Promise<unknown> => {
      throw new HTTPErrorResponse(
        400,
        { message: "You do not have permission to change this project." },
        {},
      );
    }) as never);
    openPage(under);

    const dialog: HTMLElement = await openDialog();
    type(await field(dialog, NumberedRecordKind.Incident), "10000");
    submit(dialog);

    expect(
      await screen.findByText(
        "You do not have permission to change this project.",
        {},
        { timeout: WAIT_TIMEOUT },
      ),
    ).toBeInTheDocument();

    // The typed number is still there, and still previewed.
    const open: HTMLElement = screen.getByRole("dialog");
    await waitFor(
      async () => {
        expect((await field(open, NumberedRecordKind.Incident)).value).toBe(
          "10000",
        );
      },
      { timeout: WAIT_TIMEOUT },
    );
    await waitForPreview(open, NumberedRecordKind.Incident, "INC-10000");
  });

  test("when the numbers cannot be read again, the server's answer is shown", async () => {
    updateSpy.mockImplementation((async (): Promise<unknown> => {
      numberingAnswer = "error";
      throw new HTTPErrorResponse(
        400,
        {
          message:
            "Incident Numbers Start At must be higher than 2400, the highest incident number used so far. A number is never used twice.",
        },
        {},
      );
    }) as never);
    openPage(under);

    const dialog: HTMLElement = await openDialog();
    type(await field(dialog, NumberedRecordKind.Incident), "2400");
    submit(dialog);

    expect(
      await screen.findByText(
        "Incident Numbers Start At must be higher than 2400, the highest incident number used so far. A number is never used twice.",
        {},
        { timeout: WAIT_TIMEOUT },
      ),
    ).toBeInTheDocument();
  });
});

describe("getNumbersTakenMeanwhile", () => {
  const byKind: (
    ...entries: Array<RecordNumbering>
  ) => Partial<Record<NumberedRecordKind, RecordNumbering>> = (
    ...entries: Array<RecordNumbering>
  ): Partial<Record<NumberedRecordKind, RecordNumbering>> => {
    return getNumberingByKind(entries);
  };

  test("names each sent number that records have reached, with the highest now", () => {
    expect(
      getNumbersTakenMeanwhile({
        page: INCIDENT_NEXT_NUMBERS,
        sent: {
          incidentNumbersStartAt: 2400,
          incidentEpisodeNumbersStartAt: 30,
        },
        numbering: byKind(
          entry(NumberedRecordKind.Incident, "INC-", 2401),
          entry(NumberedRecordKind.IncidentEpisode, "IE-", 30),
        ),
      }),
    ).toEqual([
      { row: INCIDENT_NEXT_NUMBERS.rows[0], highestNumber: 2401 },
      { row: INCIDENT_NEXT_NUMBERS.rows[1], highestNumber: 30 },
    ]);
  });

  test("leaves out a number still above the highest, and one that was not sent", () => {
    expect(
      getNumbersTakenMeanwhile({
        page: INCIDENT_NEXT_NUMBERS,
        sent: { incidentNumbersStartAt: 2400 },
        numbering: byKind(
          entry(NumberedRecordKind.Incident, "INC-", 2399),
          entry(NumberedRecordKind.IncidentEpisode, "IE-", 500),
        ),
      }),
    ).toEqual([]);
  });

  test("reads only the page's own kinds, and needs the numbers read again", () => {
    expect(
      getNumbersTakenMeanwhile({
        page: ALERT_NEXT_NUMBERS,
        sent: { incidentNumbersStartAt: 1, alertNumbersStartAt: 7 },
        numbering: byKind(
          entry(NumberedRecordKind.Incident, "INC-", 50),
          entry(NumberedRecordKind.Alert, "ALT-", 7),
        ),
      }),
    ).toEqual([{ row: ALERT_NEXT_NUMBERS.rows[0], highestNumber: 7 }]);

    expect(
      getNumbersTakenMeanwhile({
        page: SCHEDULED_MAINTENANCE_NEXT_NUMBERS,
        sent: { scheduledMaintenanceNumbersStartAt: 7 },
        numbering: byKind(),
      }),
    ).toEqual([]);
  });
});

/*
 * The Next Number card shows each number with its prefix, so a saved prefix
 * shows there at once: the page reads the numbers again.
 */
describe("the prefixes and the next numbers stay in step", () => {
  test.each(PAGES)(
    "$name: saving the prefixes reads the numbers again, so each shows its new prefix",
    async (under: PageUnderTest) => {
      const kind: NumberedRecordKind = under.rows[0]!.kind;
      const prefixColumn: string =
        NextNumberUtil.getKindInfo(kind).prefixColumn;

      const createOrUpdateSpy: ReturnType<typeof jest.spyOn> = jest
        .spyOn(ModelAPI, "createOrUpdate")
        .mockImplementation((async (options: {
          model: Project;
        }): Promise<unknown> => {
          // The server stores the prefix; its numbering route answers with it.
          const saved: unknown = (
            options.model as unknown as Record<string, unknown>
          )[prefixColumn];
          const current: RecordNumbering = numbering.find(
            (candidate: RecordNumbering): boolean => {
              return candidate.kind === kind;
            },
          )!;
          setEntry({ ...current, prefix: (saved as string) || null });
          return { data: {} };
        }) as never);

      openPage(under);
      expect((await rowShows(kind))[0]).toBe(under.rows[0]!.next);
      expect(numberingReads()).toBe(1);

      // The Number Prefix card, above.
      const prefixCard: HTMLElement = (
        await screen.findByText("Number Prefix", {}, { timeout: WAIT_TIMEOUT })
      ).closest('[data-testid="card"]') as HTMLElement;
      fireEvent.click(
        (
          await within(prefixCard).findByText(
            "Update",
            {},
            { timeout: WAIT_TIMEOUT },
          )
        ).closest("button") as HTMLElement,
      );

      const dialog: HTMLElement = await screen.findByRole(
        "dialog",
        {},
        { timeout: WAIT_TIMEOUT },
      );
      const input: HTMLInputElement = (await within(dialog).findByTestId(
        `number-prefix-field-${prefixColumn}`,
        {},
        { timeout: WAIT_TIMEOUT },
      )) as HTMLInputElement;
      type(input, "OPS-");
      submit(dialog);

      await waitFor(
        () => {
          expect(createOrUpdateSpy).toHaveBeenCalledTimes(1);
        },
        { timeout: WAIT_TIMEOUT },
      );

      const number: string = under.rows[0]!.next.split("-").pop()!;

      await waitFor(
        async () => {
          expect((await rowShows(kind))[0]).toBe(`OPS-${number}`);
        },
        { timeout: WAIT_TIMEOUT },
      );
      expect(numberingReads()).toBe(2);
    },
  );
});

describe("who may change the next numbers", () => {
  const under: PageUnderTest = PAGES[0]!;

  test("every page's card is gated on exactly the columns it writes, as the prefixes are", () => {
    for (const page of NEXT_NUMBER_PAGES) {
      expect(
        getProjectColumnsUpdatePermissions(getNextNumberColumns(page)),
      ).toEqual([
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.EditProject,
      ]);
    }
  });

  test("the locked button's reason names the permissions", () => {
    expect(
      getProjectColumnsPermissionMessage(
        getNextNumberColumns(INCIDENT_NEXT_NUMBERS),
      ),
    ).toBe(
      "You do not have permission to change these settings. You need this permission: Edit Project.",
    );
  });

  test.each([
    [[Permission.ProjectOwner]],
    [[Permission.ProjectAdmin]],
    [[Permission.EditProject, Permission.ReadProject]],
  ])(
    "%j gets a working Update button",
    async (permissions: Array<Permission>) => {
      grant([...BASE_PERMISSIONS, ...permissions]);
      openPage(under);

      const buttons: Array<HTMLElement> = await updateButtons();
      expect(buttons[0]).not.toBeDisabled();

      fireEvent.click(buttons[0]!);
      expect(
        await screen.findByRole("dialog", {}, { timeout: WAIT_TIMEOUT }),
      ).toBeInTheDocument();
    },
  );

  test("a master admin gets a working Update button", async () => {
    grant([], true);
    openPage(under);

    const buttons: Array<HTMLElement> = await updateButtons();
    expect(buttons[0]).not.toBeDisabled();
  });

  test.each([
    [[Permission.ProjectMember]],
    [[Permission.Viewer]],
    [[Permission.ManageProjectBilling, Permission.ReadProject]],
  ])(
    "%j reads the next numbers behind a locked button that opens nothing",
    async (permissions: Array<Permission>) => {
      grant([...BASE_PERMISSIONS, ...permissions]);
      openPage(under);

      expect((await rowShows(NumberedRecordKind.Incident))[0]).toBe("INC-2346");

      const buttons: Array<HTMLElement> = await updateButtons();
      expect(buttons).toHaveLength(1);
      expect(buttons[0]).toBeDisabled();

      fireEvent.click(buttons[0]!);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(updateSpy).not.toHaveBeenCalled();
    },
  );

  test("offers no button before the permission snapshot has landed", async () => {
    grant([]);
    openPage(under);

    await row(NumberedRecordKind.Incident);
    const cardElement: HTMLElement = await nextNumberCard();

    expect(
      within(cardElement).queryByText(NEXT_NUMBER_EDIT_BUTTON_TITLE),
    ).not.toBeInTheDocument();
  });
});

/*
 * Every word the card shows goes through the locale files, translated in
 * every language the dashboard speaks.
 */
describe("translations", () => {
  const LOCALES_DIR: string = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "App",
    "FeatureSet",
    "Dashboard",
    "src",
    "Locales",
  );

  const LOCALE_FILES: Array<string> = fs
    .readdirSync(LOCALES_DIR)
    .filter((file: string): boolean => {
      return file.endsWith(".json");
    });

  function locale(file: string): Record<string, string> {
    return JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
    ) as Record<string, string>;
  }

  const SHOWN: Array<string> = [
    "Numbering",
    NEXT_NUMBER_CARD_TITLE,
    NEXT_NUMBER_EDIT_MODAL_TITLE,
    HIGHEST_SO_FAR_LABEL,
    NONE_USED_YET,
    HIGHER_THAN_HIGHEST_TEMPLATE,
    ANY_NUMBER_FROM_ONE,
    NUMBER_TAKEN_MEANWHILE_TEMPLATE,
    ...NEXT_NUMBER_PROBLEM_MESSAGES,
    ...NEXT_NUMBER_PAGES.flatMap((page: NextNumberPage): Array<string> => {
      return [
        page.cardDescription,
        page.editDescription,
        ...page.rows.map((nextRow: NextNumberRow): string => {
          return nextRow.formTitle;
        }),
      ];
    }),
  ];

  test("there are 17 locale files", () => {
    expect(LOCALE_FILES).toHaveLength(17);
  });

  test.each(SHOWN)("%j is translated in every language", (text: string) => {
    for (const file of LOCALE_FILES) {
      const value: string | undefined = locale(file)[text];

      expect({
        file,
        translated:
          typeof value === "string" &&
          value.length > 0 &&
          (file === "en.json" ? value === text : value !== text),
      }).toEqual({ file, translated: true });
    }
  });

  test("every translation keeps the numbers' placeholder", () => {
    for (const file of LOCALE_FILES) {
      for (const text of [
        HIGHER_THAN_HIGHEST_TEMPLATE,
        NEXT_NUMBER_PROBLEM_MESSAGES[3]!,
        NUMBER_TAKEN_MEANWHILE_TEMPLATE,
      ]) {
        expect({
          file,
          text,
          kept: locale(file)[text]!.includes("{{highestNumber}}"),
        }).toEqual({ file, text, kept: true });
      }

      // The refused save names the field it is about.
      expect({
        file,
        kept: locale(file)[NUMBER_TAKEN_MEANWHILE_TEMPLATE]!.includes(
          "{{field}}",
        ),
      }).toEqual({ file, kept: true });
    }
  });
});
