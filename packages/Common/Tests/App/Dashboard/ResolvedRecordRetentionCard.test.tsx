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

let getItemSpy: jest.SpyInstance;
let updateSpy: jest.SpyInstance;
// What the project holds, as the card reads it; undefined for no value.
let stored: {
  incidentRetentionInDays?: number | undefined;
  alertRetentionInDays?: number | undefined;
  keepIncidentsWithCompletedPostmortem?: boolean | undefined;
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

  const option: HTMLElement = await screen.findByRole("option", {
    name: optionText,
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
      "30 days",
      "60 days",
      "90 days",
      "180 days",
      "1 year",
      "2 years",
      "3 years",
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
    expect(picked()).toBe("90 days");
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

    expect(picked()).toBe("1 year");

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
    expect(picked()).toBe("3 years");
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
    expect(picked()).toBe("90 days");
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
      expect(picked()).toBe("90 days");
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
        "An incident whose postmortem is completed stays, however long ago it was resolved.",
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
    expect(picked()).toBe("60 days");
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
      GERMAN["{{count}} days"]!.replace("{{count}}", "30"),
    );
    expect(options[5]).toBe(
      GERMAN["{{count}} years_one"]!.replace("{{count}}", "1"),
    );
    expect(options[6]).toBe(
      GERMAN["{{count}} years"]!.replace("{{count}}", "2"),
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
