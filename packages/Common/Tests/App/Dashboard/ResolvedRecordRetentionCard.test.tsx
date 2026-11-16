import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import React from "react";
import { initReactI18next } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import ProjectUtil from "../../../UI/Utils/Project";
import ResolvedRecordRetentionCard from "../../../../App/FeatureSet/Dashboard/src/Components/Retention/ResolvedRecordRetentionCard";
import ResolvedRecordRetentionAPI from "../../../../App/FeatureSet/Dashboard/src/Components/Retention/ResolvedRecordRetentionAPI";
import IncidentPostmortemStatus from "../../../Models/DatabaseModels/IncidentPostmortemStatus";
import {
  DueRecordsCountAnswer,
  DueRecordsCountRequest,
  ResolvedRecordRetentionLimitsAnswer,
} from "../../../Types/Retention/ResolvedRecordRetentionAnswers";
import ResolvedRecordRetentionCopy, {
  ALERT_RETENTION_COPY,
  INCIDENT_RETENTION_COPY,
  KEEP_COMPLETED_POSTMORTEMS_TEST_ID,
  RESOLVED_RECORD_RETENTION_CARD_TEST_ID,
  RESOLVED_RECORD_RETENTION_SETTING_TEST_ID,
  ResolvedRecordRetentionKindCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Retention/ResolvedRecordRetentionCopy";
import AlertRetentionSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/Settings/AlertRetentionSettings";
import IncidentRetentionSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentRetentionSettings";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import {
  withNumbersKeptWithUnits,
  withPlainSpaces,
} from "../../../Types/NoBreakSpaces";

/*
 * DATA RETENTION FOR RESOLVED INCIDENTS AND ALERTS, RENDERED (issue #6903).
 *
 * Incidents -> Settings -> Data Retention and Alerts -> Settings -> Data
 * Retention: the real card, over the project read and write stood in for.
 * What is pinned is what a person sees and what is saved:
 *
 *   - "Delete after" shows what the project keeps - Never for every project
 *     until someone picks a length - and says what that means;
 *   - a pick that deletes more than the project deletes now (turning it on,
 *     or a shorter length) asks first, saying what goes and that it can't
 *     be brought back, and saves only when confirmed; cancelled, the pick
 *     goes back; a longer length, or Never, saves at once;
 *   - a refused save goes back with the reason; anyone but a Project Owner
 *     or Admin sees it locked;
 *   - the incidents card, while a length is picked, offers to keep
 *     incidents with a completed postmortem - on, and asking before it is
 *     turned off; the alerts card has no such switch;
 *   - in the reader's language.
 */

/*
 * react-select blurs its input after a pick on a touch screen
 * (blurInputOnSelect, decided once as it loads), and jsdom reads as one.
 * These picks are a keyboard's on a desktop, where the input keeps the focus
 * a question hands back when it closes: so react-select loads as a desktop
 * browser loads it, and is otherwise itself.
 */
jest.mock("react-select", () => {
  const createEvent: Document["createEvent"] = document.createEvent;

  document.createEvent = ((type: string): Event => {
    if (type === "TouchEvent") {
      throw new Error("No touch screen here.");
    }

    return createEvent.call(document, type);
  }) as Document["createEvent"];

  try {
    return jest.requireActual("react-select");
  } finally {
    document.createEvent = createEvent;
  }
});

const PROJECT_ID: ObjectID = new ObjectID(
  "6a903000-2b4d-4e5f-8a9b-0c1d2e3f4a5b",
);

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

type Locale = Record<string, string>;

function readLocale(code: string): Locale {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
  ) as Locale;
}

const GERMAN: Locale = readLocale("de");

// The project's postmortem statuses, as Incidents > Settings > Postmortem Statuses lists them.
const NOT_STARTED_STATUS: string = "6945a000-0000-4000-8000-000000000001";
const DRAFT_STATUS: string = "6945a000-0000-4000-8000-000000000002";
const COMPLETED_STATUS: string = "6945a000-0000-4000-8000-000000000003";
const PUBLISHED_STATUS: string = "6945a000-0000-4000-8000-000000000004";
const NOT_NEEDED_STATUS: string = "6945a000-0000-4000-8000-000000000005";
const ARCHIVED_STATUS: string = "6945a000-0000-4000-8000-000000000006";

function status(
  id: string,
  name: string,
  order: number,
  flags: Record<string, boolean> = {},
): Record<string, unknown> {
  return {
    _id: id,
    name: name,
    order: order,
    color: "#10b981",
    isNotStartedStatus: false,
    isDraftStatus: false,
    isCompletedStatus: false,
    isArchived: false,
    ...flags,
  };
}

let getItemSpy: jest.SpyInstance;
let updateSpy: jest.SpyInstance;
let limitsSpy: jest.SpyInstance;
let countSpy: jest.SpyInstance;
let statusesSpy: jest.SpyInstance;
// The server's maximum the card is told about.
let limits: ResolvedRecordRetentionLimitsAnswer;
// What a count answers: a number, or null for one that failed.
let countAnswer: DueRecordsCountAnswer | null;
// The project's postmortem statuses, as the list reads them.
let postmortemStatuses: Array<Record<string, unknown>>;
// What the project holds, as the card reads it; undefined for no value.
let stored: {
  incidentRetentionInDays?: number | undefined;
  alertRetentionInDays?: number | undefined;
  keepIncidentsWithCompletedPostmortem?: boolean | undefined;
  keepIncidentsInPostmortemStatusIds?: Array<string> | undefined;
};

function grant(permissions: Array<Permission>): void {
  jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue(permissions);
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

function storedProject(): Project {
  const project: Project = new Project();
  project.id = PROJECT_ID;

  if (stored.incidentRetentionInDays !== undefined) {
    project.incidentRetentionInDays = stored.incidentRetentionInDays;
  }

  if (stored.alertRetentionInDays !== undefined) {
    project.alertRetentionInDays = stored.alertRetentionInDays;
  }

  if (stored.keepIncidentsWithCompletedPostmortem !== undefined) {
    project.keepIncidentsWithCompletedPostmortem =
      stored.keepIncidentsWithCompletedPostmortem;
  }

  if (stored.keepIncidentsInPostmortemStatusIds !== undefined) {
    project.keepIncidentsInPostmortemStatusIds =
      stored.keepIncidentsInPostmortemStatusIds;
  }

  return project;
}

async function renderCard(
  copy: ResolvedRecordRetentionKindCopy = INCIDENT_RETENTION_COPY,
): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <ResolvedRecordRetentionCard copy={copy} projectId={PROJECT_ID} />
      </MemoryRouter>,
    );
  });
  await flush();
  await screen.findByTestId(RESOLVED_RECORD_RETENTION_SETTING_TEST_ID);
}

function deleteAfter(): HTMLElement {
  return screen.getByRole("combobox", {
    name: ResolvedRecordRetentionCopy.label,
  });
}

// What the pick shows: react-select's single value beside its input.
function picked(): string {
  return (
    within(
      screen.getByTestId(RESOLVED_RECORD_RETENTION_SETTING_TEST_ID),
    ).queryByText(/days?$|years?$|^Never$|Tage$|Jahre?$|^Nie$/)?.textContent ||
    ""
  );
}

// The pick, whatever the reader's language names it.
function thePick(): HTMLElement {
  return within(
    screen.getByTestId(RESOLVED_RECORD_RETENTION_SETTING_TEST_ID),
  ).getByRole("combobox");
}

async function openPick(): Promise<void> {
  await act(async () => {
    fireEvent.focus(thePick());
    fireEvent.keyDown(thePick(), { key: "ArrowDown", keyCode: 40 });
  });
}

async function pick(optionText: string): Promise<void> {
  await openPick();

  // An option's name holds a duration's figure to its word (#8770).
  const option: HTMLElement = await screen.findByRole("option", {
    name: (name: string): boolean => {
      return withPlainSpaces(name) === optionText;
    },
  });

  await act(async () => {
    fireEvent.click(option);
  });
  await flush();
  await flush();
}

function description(): string {
  return (
    screen.getByTestId(
      `${RESOLVED_RECORD_RETENTION_SETTING_TEST_ID}-description`,
    ).textContent || ""
  );
}

function dialog(): HTMLElement | null {
  return screen.queryByRole("dialog");
}

async function pressInDialog(name: string): Promise<void> {
  await act(async () => {
    fireEvent.click(within(dialog()!).getByRole("button", { name }));
  });
  await flush();
  await flush();
}

function postmortemSwitch(): HTMLElement | null {
  return screen.queryByTestId(KEEP_COMPLETED_POSTMORTEMS_TEST_ID);
}

function savedData(index: number = 0): JSONObject {
  return (updateSpy.mock.calls[index]![0] as { data: JSONObject }).data;
}

async function setLanguage(code: string): Promise<void> {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage(code);
  });
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      de: { translation: GERMAN },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(() => {
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest
    .spyOn(PermissionUtil, "getProjectPermissions")
    .mockReturnValue(null as never);
  grant([Permission.ProjectOwner]);
  jest
    .spyOn(API, "getFriendlyMessage")
    .mockImplementation((err: unknown): string => {
      return (err as { message?: string }).message || String(err);
    });

  stored = {
    incidentRetentionInDays: 0,
    alertRetentionInDays: 0,
    keepIncidentsWithCompletedPostmortem: true,
  };
  getItemSpy = jest.spyOn(ModelAPI, "getItem").mockImplementation((async () => {
    return storedProject();
  }) as never);
  updateSpy = jest
    .spyOn(ModelAPI, "updateById")
    .mockImplementation((async (data: { data: JSONObject }) => {
      Object.assign(stored, data.data);
      return undefined;
    }) as never);

  limits = {};
  limitsSpy = jest
    .spyOn(ResolvedRecordRetentionAPI, "getLimits")
    .mockImplementation(async () => {
      return limits;
    });
  countAnswer = null;
  countSpy = jest
    .spyOn(ResolvedRecordRetentionAPI, "countDue")
    .mockImplementation(async () => {
      return countAnswer;
    });
  postmortemStatuses = [
    status(NOT_STARTED_STATUS, "Not Started", 1, { isNotStartedStatus: true }),
    status(DRAFT_STATUS, "Draft", 2, { isDraftStatus: true }),
    status(COMPLETED_STATUS, "Completed", 3, { isCompletedStatus: true }),
    status(PUBLISHED_STATUS, "Published", 4),
    status(NOT_NEEDED_STATUS, "Not Needed", 5),
    status(ARCHIVED_STATUS, "Shared", 6, { isArchived: true }),
  ];
  statusesSpy = jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation((async (data: { modelType: unknown }) => {
      if (data.modelType !== IncidentPostmortemStatus) {
        throw new Error("Only postmortem statuses are listed here.");
      }

      return {
        data: postmortemStatuses.map((row: Record<string, unknown>) => {
          return IncidentPostmortemStatus.fromJSON(
            row as JSONObject,
            IncidentPostmortemStatus,
          );
        }),
        count: postmortemStatuses.length,
        skip: 0,
        limit: postmortemStatuses.length,
      };
    }) as never);
});

afterEach(async () => {
  cleanup();
  jest.restoreAllMocks();
  await i18next.changeLanguage("en");
});

describe("Resolved Incidents", () => {
  test("reads the project's setting: Never, where every project starts, and what it means", async () => {
    await renderCard();

    expect(getItemSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        modelType: Project,
        id: PROJECT_ID,
        select: {
          incidentRetentionInDays: true,
          keepIncidentsWithCompletedPostmortem: true,
          keepIncidentsInPostmortemStatusIds: true,
        },
      }),
    );
    expect(picked()).toBe("Never");
    expect(description()).toBe(
      "Every resolved incident stays until someone deletes it.",
    );
    expect(screen.getByText("Resolved Incidents")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Delete incidents once they have been resolved for a while, with their timeline, notes and logs. Incidents that are not resolved are never deleted.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`${RESOLVED_RECORD_RETENTION_CARD_TEST_ID}-incident`),
    ).toBeInTheDocument();
    // Nothing to keep while nothing is deleted.
    expect(postmortemSwitch()).toBeNull();
  });

  test("offers Never first, then a month to three years, in days and then in years", async () => {
    await renderCard();
    await openPick();

    const options: Array<string> = (await screen.findAllByRole("option")).map(
      (option: HTMLElement): string => {
        return option.textContent || "";
      },
    );

    expect(options).toEqual([
      "Never",
      "30\u00A0days",
      "60\u00A0days",
      "90\u00A0days",
      "180\u00A0days",
      "1\u00A0year",
      "2\u00A0years",
      "3\u00A0years",
    ]);
  });

  test("turning it on asks first, says what goes, and saves nothing until confirmed", async () => {
    await renderCard();
    await pick("90 days");

    expect(dialog()).not.toBeNull();
    expect(dialog()).toHaveTextContent("Delete old resolved incidents?");
    expect(dialog()).toHaveTextContent(
      "Incidents resolved more than 90 days ago are deleted within the hour, with their timeline, notes and logs. Status pages stop showing them, and they can't be brought back.",
    );
    expect(updateSpy).not.toHaveBeenCalled();

    await pressInDialog("Delete old incidents");

    expect(dialog()).toBeNull();
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith({
      modelType: Project,
      id: PROJECT_ID,
      data: { incidentRetentionInDays: 90 },
    });
    await waitFor(() => {
      expect(
        screen.getByTestId(
          `${RESOLVED_RECORD_RETENTION_SETTING_TEST_ID}-status`,
        ),
      ).toHaveTextContent("Saved");
    });
    expect(picked()).toBe("90\u00A0days");
    expect(description()).toBe(
      "Checked every hour, counting from when each incident was resolved. Status pages stop showing deleted incidents, and they can't be brought back.",
    );
    // With a length picked, completed postmortems can be kept - and are.
    expect(postmortemSwitch()).toHaveAttribute("aria-checked", "true");
  });

  test("cancelled, nothing is saved and the pick goes back", async () => {
    await renderCard();
    await pick("30 days");

    expect(dialog()).not.toBeNull();

    await pressInDialog("Cancel");

    expect(dialog()).toBeNull();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(picked()).toBe("Never");
    expect(postmortemSwitch()).toBeNull();
  });

  /*
   * The question hands the keyboard back to the pick it left. Drawing the pick
   * again by remounting it would leave the focus on nothing.
   */
  test("cancelled, the keyboard is back on the pick it left", async () => {
    await renderCard();

    await act(async () => {
      thePick().focus();
    });

    expect(document.activeElement).toBe(thePick());

    await pick("30 days");

    expect(dialog()).not.toBeNull();

    await pressInDialog("Cancel");

    expect(dialog()).toBeNull();
    expect(picked()).toBe("Never");
    expect(document.activeElement).toBe(thePick());
  });

  test("a length in whole years is said in years in the question too", async () => {
    await renderCard();
    await pick("2 years");

    expect(dialog()).toHaveTextContent(
      "Incidents resolved more than 2 years ago are deleted within the hour",
    );

    await pressInDialog("Delete old incidents");

    expect(savedData()).toEqual({ incidentRetentionInDays: 730 });
  });

  test("a shorter length asks first", async () => {
    stored.incidentRetentionInDays = 365;

    await renderCard();

    expect(picked()).toBe("1\u00A0year");

    await pick("30 days");

    expect(dialog()).toHaveTextContent(
      "Incidents resolved more than 30 days ago are deleted within the hour",
    );
    expect(updateSpy).not.toHaveBeenCalled();

    await pressInDialog("Delete old incidents");

    expect(savedData()).toEqual({ incidentRetentionInDays: 30 });
  });

  test("a longer length deletes nothing more, so it saves at once", async () => {
    stored.incidentRetentionInDays = 90;

    await renderCard();
    await pick("3 years");

    expect(dialog()).toBeNull();
    expect(savedData()).toEqual({ incidentRetentionInDays: 1095 });
    expect(picked()).toBe("3\u00A0years");
  });

  test("Never saves at once, and the postmortem switch goes with the length", async () => {
    stored.incidentRetentionInDays = 180;

    await renderCard();

    expect(postmortemSwitch()).not.toBeNull();

    await pick("Never");

    expect(dialog()).toBeNull();
    expect(savedData()).toEqual({ incidentRetentionInDays: 0 });
    await waitFor(() => {
      expect(postmortemSwitch()).toBeNull();
    });
    expect(description()).toBe(
      "Every resolved incident stays until someone deletes it.",
    );
  });

  test("a pick the server refuses goes back to what the project has, with the reason", async () => {
    stored.incidentRetentionInDays = 90;
    updateSpy.mockImplementation((async () => {
      throw new Error("You may not change this project's settings.");
    }) as never);

    await renderCard();
    await pick("1 year");

    await waitFor(() => {
      expect(
        screen.getByTestId(
          `${RESOLVED_RECORD_RETENTION_SETTING_TEST_ID}-error`,
        ),
      ).toHaveTextContent("You may not change this project's settings.");
    });
    expect(picked()).toBe("90\u00A0days");
  });

  test.each([
    [[Permission.ProjectMember]],
    [[Permission.ProjectMember, Permission.EditProject]],
    [[Permission.IncidentAdmin, Permission.EditProjectIncident]],
  ])(
    "is locked for %p, and saves nothing",
    async (permissions: Array<Permission>) => {
      grant(permissions);
      stored.incidentRetentionInDays = 90;

      await renderCard();

      const locked: HTMLElement = within(
        screen.getByTestId(RESOLVED_RECORD_RETENTION_SETTING_TEST_ID),
      ).getByRole("combobox", { hidden: true });

      expect(locked).toBeDisabled();
      expect(picked()).toBe("90\u00A0days");
      expect(postmortemSwitch()).toHaveAttribute("aria-disabled", "true");
      expect(updateSpy).not.toHaveBeenCalled();
    },
  );

  test("a Project Admin may change it, and the pick is named Delete after", async () => {
    grant([Permission.ProjectAdmin]);

    await renderCard();

    expect(deleteAfter()).toBe(thePick());
    expect(deleteAfter()).not.toBeDisabled();
  });

  test("turning the postmortem switch off asks first, then saves", async () => {
    stored.incidentRetentionInDays = 365;

    await renderCard();

    expect(postmortemSwitch()).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByText(
        "An incident whose postmortem is in one of the statuses below stays, however long ago it was resolved.",
      ),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(postmortemSwitch()!);
    });
    await flush();

    expect(dialog()).toHaveTextContent(
      "Delete incidents with a completed postmortem too?",
    );
    expect(dialog()).toHaveTextContent(
      "Resolved incidents older than the length picked are deleted within the hour, even when their postmortem is completed. They can't be brought back.",
    );
    expect(updateSpy).not.toHaveBeenCalled();

    await pressInDialog("Delete them too");

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledTimes(1);
    });
    expect(savedData()).toEqual({
      keepIncidentsWithCompletedPostmortem: false,
    });
    await waitFor(() => {
      expect(postmortemSwitch()).toHaveAttribute("aria-checked", "false");
    });
    expect(
      screen.getByText(
        "Incidents are deleted whether or not their postmortem is completed.",
      ),
    ).toBeInTheDocument();
  });

  test("turning it back on deletes nothing, so it saves at once", async () => {
    stored.incidentRetentionInDays = 365;
    stored.keepIncidentsWithCompletedPostmortem = false;

    await renderCard();

    expect(postmortemSwitch()).toHaveAttribute("aria-checked", "false");

    await act(async () => {
      fireEvent.click(postmortemSwitch()!);
    });
    await flush();

    expect(dialog()).toBeNull();
    await waitFor(() => {
      expect(savedData()).toEqual({
        keepIncidentsWithCompletedPostmortem: true,
      });
    });
  });

  test("a project read before the settings existed shows the defaults", async () => {
    stored = {};

    await renderCard();

    expect(picked()).toBe("Never");
  });

  test("a setting that is not a choice is shown as Never, which deletes nothing", async () => {
    stored.incidentRetentionInDays = 45;

    await renderCard();

    expect(picked()).toBe("Never");
  });

  test("a failed read says why, and Try again reads again", async () => {
    getItemSpy.mockImplementationOnce((async () => {
      throw new Error("Network error. Please check your connection.");
    }) as never);

    await act(async () => {
      render(
        <MemoryRouter>
          <ResolvedRecordRetentionCard
            copy={INCIDENT_RETENTION_COPY}
            projectId={PROJECT_ID}
          />
        </MemoryRouter>,
      );
    });

    expect(
      await screen.findByText("Network error. Please check your connection."),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(RESOLVED_RECORD_RETENTION_SETTING_TEST_ID),
    ).toBeNull();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Try again|Refresh/i }),
      );
    });

    expect(
      await screen.findByTestId(RESOLVED_RECORD_RETENTION_SETTING_TEST_ID),
    ).toBeInTheDocument();
    expect(getItemSpy).toHaveBeenCalledTimes(2);
  });

  test("a project it cannot find says so", async () => {
    getItemSpy.mockImplementation((async () => {
      return null;
    }) as never);

    await act(async () => {
      render(
        <MemoryRouter>
          <ResolvedRecordRetentionCard
            copy={INCIDENT_RETENTION_COPY}
            projectId={PROJECT_ID}
          />
        </MemoryRouter>,
      );
    });

    expect(await screen.findByText("Project not found.")).toBeInTheDocument();
  });
});

describe("Resolved Alerts", () => {
  test("reads and writes the alerts' own setting, and offers no postmortem switch", async () => {
    stored.alertRetentionInDays = 60;

    await renderCard(ALERT_RETENTION_COPY);

    expect(getItemSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { alertRetentionInDays: true },
      }),
    );
    expect(picked()).toBe("60\u00A0days");
    expect(screen.getByText("Resolved Alerts")).toBeInTheDocument();
    expect(description()).toBe(
      "Checked every hour, counting from when each alert was resolved. Deleted alerts can't be brought back.",
    );
    expect(postmortemSwitch()).toBeNull();
    expect(
      screen.getByTestId(`${RESOLVED_RECORD_RETENTION_CARD_TEST_ID}-alert`),
    ).toBeInTheDocument();

    await pick("30 days");

    expect(dialog()).toHaveTextContent("Delete old resolved alerts?");
    expect(dialog()).toHaveTextContent(
      "Alerts resolved more than 30 days ago are deleted within the hour, with their timeline, notes and logs. They can't be brought back.",
    );

    await pressInDialog("Delete old alerts");

    expect(savedData()).toEqual({ alertRetentionInDays: 30 });
  });

  test("Never says every resolved alert stays", async () => {
    await renderCard(ALERT_RETENTION_COPY);

    expect(description()).toBe(
      "Every resolved alert stays until someone deletes it.",
    );
  });
});

describe("in the reader's language", () => {
  test("in German, the card, the pick and the question are German", async () => {
    await setLanguage("de");
    await renderCard();

    expect(screen.getByText(GERMAN["Resolved Incidents"]!)).toBeInTheDocument();
    expect(withoutIsolateMarks(picked())).toBe(GERMAN["Never"]);
    expect(
      screen.getByRole("combobox", { name: GERMAN["Delete after"]! }),
    ).toBe(thePick());

    await openPick();

    const options: Array<string> = (await screen.findAllByRole("option")).map(
      (option: HTMLElement): string => {
        return withoutIsolateMarks(option.textContent || "");
      },
    );

    expect(options[0]).toBe(GERMAN["Never"]);
    expect(options[1]).toBe(
      withNumbersKeptWithUnits(GERMAN["{{count}} days"]!, "{{count}} days", {
        durationWords: true,
      }).replace("{{count}}", "30"),
    );
    expect(options[5]).toBe(
      withNumbersKeptWithUnits(
        GERMAN["{{count}} years_one"]!,
        "{{count}} years",
        { durationWords: true },
      ).replace("{{count}}", "1"),
    );
    expect(options[6]).toBe(
      withNumbersKeptWithUnits(GERMAN["{{count}} years"]!, "{{count}} years", {
        durationWords: true,
      }).replace("{{count}}", "2"),
    );

    await act(async () => {
      fireEvent.click(screen.getAllByRole("option")[3]!);
    });
    await flush();

    expect(dialog()).toHaveTextContent(
      GERMAN["Delete old resolved incidents?"]!,
    );
    expect(
      within(dialog()!).getByRole("button", {
        name: GERMAN["Delete old incidents"]!,
      }),
    ).toBeInTheDocument();
  });
});

describe("the pages", () => {
  const props: PageComponentProps = {
    pageRoute: new Route("/dashboard"),
    currentProject: null,
    hasPaymentMethod: true,
  };

  test("Incidents -> Settings -> Data Retention is the incidents card, for the current project", async () => {
    await act(async () => {
      render(
        <MemoryRouter>
          <IncidentRetentionSettings {...props} />
        </MemoryRouter>,
      );
    });

    expect(
      await screen.findByTestId(
        `${RESOLVED_RECORD_RETENTION_CARD_TEST_ID}-incident`,
      ),
    ).toBeInTheDocument();
    expect(getItemSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: PROJECT_ID }),
    );
  });

  test("Alerts -> Settings -> Data Retention is the alerts card", async () => {
    await act(async () => {
      render(
        <MemoryRouter>
          <AlertRetentionSettings {...props} />
        </MemoryRouter>,
      );
    });

    expect(
      await screen.findByTestId(
        `${RESOLVED_RECORD_RETENTION_CARD_TEST_ID}-alert`,
      ),
    ).toBeInTheDocument();
  });

  test("with no project chosen, there is nothing to show", async () => {
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(null);

    const view: ReturnType<typeof render> = render(
      <MemoryRouter>
        <IncidentRetentionSettings {...props} />
      </MemoryRouter>,
    );

    expect(view.container).toBeEmptyDOMElement();
    expect(getItemSpy).not.toHaveBeenCalled();
  });
});

// The line a question says how many it deletes with.
function countLine(): string {
  return (
    within(dialog()!).queryByTestId("resolved-record-retention-count")
      ?.textContent || ""
  );
}

function lastCountRequest(): Omit<DueRecordsCountRequest, "kind"> & {
  kind?: unknown;
} {
  const calls: Array<Array<unknown>> = countSpy.mock.calls;
  return calls[calls.length - 1]![1] as Omit<DueRecordsCountRequest, "kind">;
}

// The option the pick offers with this name, and whether it can be picked.
async function option(name: string): Promise<HTMLElement> {
  return await screen.findByRole("option", {
    name: (optionName: string): boolean => {
      return withPlainSpaces(optionName) === name;
    },
  });
}

/*
 * THE SERVER'S MAXIMUM (issue #6941): the pick shows how long the project
 * really keeps them, Never and the longer lengths are locked, and a line
 * says the server's maximum.
 */
describe("under the server's maximum", () => {
  test("Never shows the maximum, and a line says the server keeps them at most that long", async () => {
    limits = { incidentMaximumInDays: 365 };

    await renderCard();

    expect(limitsSpy).toHaveBeenCalledWith(PROJECT_ID);
    expect(withPlainSpaces(picked())).toBe("1 year");
    expect(
      withPlainSpaces(
        screen.getByTestId("resolved-record-retention-server-maximum")
          .textContent || "",
      ),
    ).toBe("Your server keeps resolved incidents for at most 1 year.");
    // A length is in force, so what it means is said, and postmortems kept.
    expect(description()).toBe(INCIDENT_RETENTION_COPY.onDescription);
    expect(postmortemSwitch()).not.toBeNull();
  });

  test("Never and the longer lengths are locked; the maximum and shorter ones are open", async () => {
    limits = { incidentMaximumInDays: 365 };

    await renderCard();
    await openPick();

    for (const locked of ["Never", "2 years", "3 years"]) {
      expect(await option(locked)).toHaveAttribute("aria-disabled", "true");
    }

    for (const open of ["30 days", "180 days", "1 year"]) {
      expect(await option(open)).not.toHaveAttribute("aria-disabled", "true");
    }
  });

  test("a project's longer length is shown as the maximum", async () => {
    limits = { incidentMaximumInDays: 90 };
    stored.incidentRetentionInDays = 730;

    await renderCard();

    expect(withPlainSpaces(picked())).toBe("90 days");
  });

  test("picking the maximum itself deletes nothing more, so it saves at once", async () => {
    limits = { incidentMaximumInDays: 365 };

    await renderCard();
    await pick("1 year");

    expect(dialog()).toBeNull();
    await waitFor(() => {
      expect(savedData()).toEqual({ incidentRetentionInDays: 365 });
    });
  });

  test("a shorter length than the maximum deletes more, so it asks first", async () => {
    limits = { incidentMaximumInDays: 365 };

    await renderCard();
    await pick("90 days");

    expect(dialog()).toHaveTextContent("Delete old resolved incidents?");
    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("the alerts card reads the alerts' maximum", async () => {
    limits = { incidentMaximumInDays: 30, alertMaximumInDays: 180 };

    await renderCard(ALERT_RETENTION_COPY);

    expect(withPlainSpaces(picked())).toBe("180 days");
    expect(
      withPlainSpaces(
        screen.getByTestId("resolved-record-retention-server-maximum")
          .textContent || "",
      ),
    ).toBe("Your server keeps resolved alerts for at most 180 days.");
  });

  test("with no maximum, no line and nothing locked", async () => {
    await renderCard();

    expect(
      screen.queryByTestId("resolved-record-retention-server-maximum"),
    ).toBeNull();

    await openPick();

    for (const name of ["Never", "3 years"]) {
      expect(await option(name)).not.toHaveAttribute("aria-disabled", "true");
    }
  });

  test("a maximum that cannot be read locks nothing: the server holds the choices to it anyway", async () => {
    limitsSpy.mockImplementation(async () => {
      throw new Error("Server Error");
    });

    await renderCard();

    expect(picked()).toBe("Never");
    expect(
      screen.queryByTestId("resolved-record-retention-server-maximum"),
    ).toBeNull();
    expect(screen.queryByText("Server Error")).toBeNull();
  });
});

/*
 * HOW MANY A CHANGE DELETES (issue #6943): every question before a delete
 * says how many go now, counted by the server; a count that fails leaves
 * the question as it was.
 */
describe("the question says how many it deletes", () => {
  test("while the count is on its way, then the count", async () => {
    let answer: (value: DueRecordsCountAnswer | null) => void = () => {};
    countSpy.mockImplementation(() => {
      return new Promise<DueRecordsCountAnswer | null>(
        (resolve: (value: DueRecordsCountAnswer | null) => void) => {
          answer = resolve;
        },
      );
    });

    await renderCard();
    await pick("90 days");

    expect(countLine()).toBe("Counting the incidents this deletes…");

    await act(async () => {
      answer({ count: 4512, isAtLeast: false });
    });
    await flush();

    expect(withPlainSpaces(countLine())).toBe(
      "This deletes 4,512 incidents now.",
    );
  });

  test("the count is asked for the setting as it would be saved", async () => {
    countAnswer = { count: 3, isAtLeast: false };
    stored.keepIncidentsWithCompletedPostmortem = false;

    await renderCard();
    await pick("60 days");

    expect(countSpy).toHaveBeenCalledWith(PROJECT_ID, {
      kind: "Incident",
      retentionInDays: 60,
      keepIncidentsWithCompletedPostmortem: false,
      keepIncidentsInPostmortemStatusIds: undefined,
    });
  });

  test.each([
    [{ count: 1, isAtLeast: false }, "This deletes 1 incident now."],
    [{ count: 0, isAtLeast: false }, "Nothing is old enough to delete yet."],
    [
      { count: 10000, isAtLeast: true },
      "This deletes more than 10,000 incidents now.",
    ],
  ])(
    "a count of %p reads %p",
    async (answer: DueRecordsCountAnswer, expected: string) => {
      countAnswer = answer;

      await renderCard();
      await pick("90 days");

      await waitFor(() => {
        expect(withPlainSpaces(countLine())).toBe(expected);
      });
    },
  );

  test("a count that failed says nothing, and the question still deletes when confirmed", async () => {
    countAnswer = null;

    await renderCard();
    await pick("90 days");
    await flush();

    expect(countLine()).toBe("");
    expect(dialog()).toHaveTextContent("Delete old resolved incidents?");

    await pressInDialog("Delete old incidents");

    await waitFor(() => {
      expect(savedData()).toEqual({ incidentRetentionInDays: 90 });
    });
  });

  test("a change that deletes nothing more is not counted", async () => {
    stored.incidentRetentionInDays = 90;

    await renderCard();
    countSpy.mockClear();
    await pick("1 year");

    expect(dialog()).toBeNull();

    // Only the postmortem switch's own question is counted again, for the new length.
    for (const call of countSpy.mock.calls) {
      expect(call[1]).toEqual(
        expect.objectContaining({
          keepIncidentsWithCompletedPostmortem: false,
        }),
      );
    }
  });

  test("alerts are counted as alerts, with nothing about postmortems", async () => {
    countAnswer = { count: 3, isAtLeast: false };

    await renderCard(ALERT_RETENTION_COPY);
    await pick("30 days");

    await waitFor(() => {
      expect(countLine()).toBe("This deletes 3 alerts now.");
    });
    expect(lastCountRequest()).toEqual({
      kind: "Alert",
      retentionInDays: 30,
    });
  });

  test("turning the postmortem switch off says how many that deletes", async () => {
    stored.incidentRetentionInDays = 365;
    countAnswer = { count: 12, isAtLeast: false };

    await renderCard();

    await waitFor(() => {
      expect(countSpy).toHaveBeenCalledWith(PROJECT_ID, {
        kind: "Incident",
        retentionInDays: 365,
        keepIncidentsWithCompletedPostmortem: false,
        keepIncidentsInPostmortemStatusIds: undefined,
      });
    });
    await flush();

    await act(async () => {
      fireEvent.click(postmortemSwitch()!);
    });
    await flush();

    expect(dialog()).toHaveTextContent(
      "Delete incidents with a completed postmortem too?",
    );
    expect(dialog()).toHaveTextContent("This deletes 12 incidents now.");
  });

  test("someone who may not change the switch is not counted for", async () => {
    stored.incidentRetentionInDays = 365;
    grant([Permission.ProjectMember]);

    await renderCard();
    await flush();

    expect(countSpy).not.toHaveBeenCalled();
  });
});

/*
 * WHICH POSTMORTEM STATUSES KEEP AN INCIDENT (issue #6945): Completed
 * unless others are chosen; adding one saves at once, taking one out asks
 * first with how many it deletes, and the last one stays.
 */
describe("the postmortem statuses that keep an incident", () => {
  function statusesPick(): HTMLElement {
    return within(
      screen.getByTestId("resolved-record-retention-kept-statuses"),
    ).getByRole("combobox");
  }

  // The chips of the statuses chosen, as react-select draws them.
  function chosen(): Array<string> {
    const box: HTMLElement = screen.getByTestId(
      "resolved-record-retention-kept-statuses",
    );

    return Array.from(
      box.querySelectorAll(
        "[class*='multi-value__label'], [class*='multiValue'] > div:first-child",
      ),
    ).map((element: Element): string => {
      return withoutIsolateMarks(element.textContent || "");
    });
  }

  async function openStatuses(): Promise<void> {
    await act(async () => {
      fireEvent.focus(statusesPick());
      fireEvent.keyDown(statusesPick(), { key: "ArrowDown", keyCode: 40 });
    });
  }

  async function addStatus(name: string): Promise<void> {
    await openStatuses();

    await act(async () => {
      fireEvent.click(await screen.findByRole("option", { name: name }));
    });
    await flush();
    await flush();
  }

  async function removeStatus(name: string): Promise<void> {
    const remove: HTMLElement = screen.getByRole("button", {
      name: new RegExp(`Remove ${name}`, "i"),
    });

    await act(async () => {
      fireEvent.click(remove);
    });
    await flush();
    await flush();
  }

  test("with none chosen, the Completed status keeps them", async () => {
    stored.incidentRetentionInDays = 365;

    await renderCard();

    expect(
      screen.getByText("Postmortem statuses that keep an incident"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Add your own statuses that mean a postmortem is written, such as Published.",
      ),
    ).toBeInTheDocument();
    expect(chosen()).toEqual(["Completed"]);
    expect(statusesSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        modelType: IncidentPostmortemStatus,
        query: { projectId: PROJECT_ID },
      }),
    );
  });

  test("the project's own choice is shown", async () => {
    stored.incidentRetentionInDays = 365;
    stored.keepIncidentsInPostmortemStatusIds = [
      COMPLETED_STATUS,
      PUBLISHED_STATUS,
    ];

    await renderCard();

    expect(chosen()).toEqual(["Completed", "Published"]);
  });

  test("adding a status keeps more, so it saves at once", async () => {
    stored.incidentRetentionInDays = 365;

    await renderCard();
    await addStatus("Published");

    expect(dialog()).toBeNull();
    await waitFor(() => {
      expect(savedData()).toEqual({
        keepIncidentsInPostmortemStatusIds: [
          COMPLETED_STATUS,
          PUBLISHED_STATUS,
        ],
      });
    });
  });

  test("an archived status is never offered, and Not Needed is offered but not chosen", async () => {
    stored.incidentRetentionInDays = 365;

    await renderCard();
    await openStatuses();

    const names: Array<string> = (await screen.findAllByRole("option")).map(
      (element: HTMLElement): string => {
        return withoutIsolateMarks(element.textContent || "");
      },
    );

    expect(names).not.toContain("Shared");
    expect(names).toContain("Not Needed");
    expect(chosen()).not.toContain("Not Needed");
  });

  test("taking a status out asks first, with how many it deletes, and saves when confirmed", async () => {
    stored.incidentRetentionInDays = 365;
    stored.keepIncidentsInPostmortemStatusIds = [
      COMPLETED_STATUS,
      PUBLISHED_STATUS,
    ];
    countAnswer = { count: 7, isAtLeast: false };

    await renderCard();
    countSpy.mockClear();
    await removeStatus("Published");

    expect(dialog()).toHaveTextContent(
      "Delete incidents in this postmortem status too?",
    );
    expect(dialog()).toHaveTextContent(
      "Old resolved incidents whose postmortem is in a status you take out are deleted within the hour. They can't be brought back.",
    );
    await waitFor(() => {
      expect(countLine()).toBe("This deletes 7 incidents now.");
    });
    expect(lastCountRequest()).toEqual({
      kind: "Incident",
      retentionInDays: 365,
      keepIncidentsWithCompletedPostmortem: true,
      keepIncidentsInPostmortemStatusIds: [COMPLETED_STATUS],
    });
    expect(updateSpy).not.toHaveBeenCalled();

    await pressInDialog("Delete them too");

    await waitFor(() => {
      expect(savedData()).toEqual({
        keepIncidentsInPostmortemStatusIds: [COMPLETED_STATUS],
      });
    });
  });

  test("cancelled, nothing is saved and the status stays chosen", async () => {
    stored.incidentRetentionInDays = 365;
    stored.keepIncidentsInPostmortemStatusIds = [
      COMPLETED_STATUS,
      PUBLISHED_STATUS,
    ];

    await renderCard();
    await removeStatus("Published");
    await pressInDialog("Cancel");

    expect(dialog()).toBeNull();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(chosen()).toEqual(["Completed", "Published"]);
  });

  test("cancelled, the keyboard is back on the statuses it left", async () => {
    stored.incidentRetentionInDays = 365;
    stored.keepIncidentsInPostmortemStatusIds = [
      COMPLETED_STATUS,
      PUBLISHED_STATUS,
    ];

    await renderCard();

    await act(async () => {
      statusesPick().focus();
    });

    await removeStatus("Published");

    expect(dialog()).not.toBeNull();

    await pressInDialog("Cancel");

    expect(dialog()).toBeNull();
    expect(chosen()).toEqual(["Completed", "Published"]);
    expect(document.activeElement).toBe(statusesPick());
  });

  test("the last status refused, the keyboard stays on the statuses", async () => {
    stored.incidentRetentionInDays = 365;

    await renderCard();

    await act(async () => {
      statusesPick().focus();
    });

    await removeStatus("Completed");

    expect(updateSpy).not.toHaveBeenCalled();
    expect(chosen()).toEqual(["Completed"]);
    expect(document.activeElement).toBe(statusesPick());
  });

  // The second try says what the first said, and still puts it back.
  test("the last status refused twice, it is still chosen", async () => {
    stored.incidentRetentionInDays = 365;

    await renderCard();
    await removeStatus("Completed");
    await removeStatus("Completed");

    expect(updateSpy).not.toHaveBeenCalled();
    expect(chosen()).toEqual(["Completed"]);
    expect(
      screen.getByTestId("resolved-record-retention-kept-statuses-problem"),
    ).toHaveTextContent(
      "Keep at least one status, or turn off keeping incidents with a completed postmortem.",
    );
  });

  test("the last status cannot be taken out: it says to turn the switch off instead", async () => {
    stored.incidentRetentionInDays = 365;

    await renderCard();
    await removeStatus("Completed");

    expect(dialog()).toBeNull();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("resolved-record-retention-kept-statuses-problem"),
    ).toHaveTextContent(
      "Keep at least one status, or turn off keeping incidents with a completed postmortem.",
    );
    expect(chosen()).toEqual(["Completed"]);
  });

  test("with the switch off, or no length picked, the statuses are not offered", async () => {
    stored.incidentRetentionInDays = 365;
    stored.keepIncidentsWithCompletedPostmortem = false;

    await renderCard();

    expect(
      screen.queryByTestId("resolved-record-retention-kept-statuses"),
    ).toBeNull();

    cleanup();
    stored.keepIncidentsWithCompletedPostmortem = true;
    stored.incidentRetentionInDays = 0;

    await renderCard();

    expect(
      screen.queryByTestId("resolved-record-retention-kept-statuses"),
    ).toBeNull();
  });

  test("the alerts card reads no postmortem statuses", async () => {
    await renderCard(ALERT_RETENTION_COPY);

    expect(statusesSpy).not.toHaveBeenCalled();
  });

  test("statuses that cannot be read are not offered, and the rest of the card works", async () => {
    stored.incidentRetentionInDays = 365;
    statusesSpy.mockImplementation(async () => {
      throw new Error("Server Error");
    });

    await renderCard();

    expect(postmortemSwitch()).not.toBeNull();
    expect(
      screen.queryByTestId("resolved-record-retention-kept-statuses"),
    ).toBeNull();
  });
});
