// UX rule: Docs/ux/README.md#in-every-language
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
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { allowStateChanges } from "./StateChangePermission";

const getListMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      count: (...args: Array<unknown>) => {
        return countMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProject: () => {
        return { id: new ObjectID(PROJECT_ID) };
      },
      getCurrentProjectId: () => {
        return new ObjectID(PROJECT_ID);
      },
    },
  };
});

/*
 * The real modal is a whole ModelForm with traffic of its own: the header
 * hands it a title and a button, which is all these cases read.
 */
jest.mock("../../../UI/Components/ModelFormModal/ModelFormModal", () => {
  return {
    __esModule: true,
    default: (props: {
      title: string;
      description?: string;
      submitButtonText: string;
    }): React.ReactElement => {
      return React.createElement(
        "div",
        { "data-testid": "state-change-modal" },
        React.createElement("h3", {}, props.title),
        React.createElement("p", {}, props.description || ""),
        React.createElement("span", {}, props.submitButtonText),
      );
    },
  };
});

import ChangeIncidentState from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/ChangeState";
import ChangeScheduledMaintenanceState from "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ChangeState";
import PostmortemStatusSummaryCards from "../../../../App/FeatureSet/Dashboard/src/Components/Postmortem/PostmortemStatusSummaryCards";
import { PostmortemStatusTile } from "../../../../App/FeatureSet/Dashboard/src/Components/Postmortem/PostmortemStatusTiles";
import SecurityCaseStatusStepper from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseStatusStepper";
import { describePriorityChoice } from "../../../../App/FeatureSet/Dashboard/src/Pages/UserSettings/NotificationSettings";
import { describeToolImportNote } from "../../../../App/FeatureSet/Dashboard/src/Components/ToolImport/ToolImportText";
import {
  getNotYetInStateText,
  getTimeToStateText,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/EventOverview";
import { getEpisodeTiming } from "../../../../App/FeatureSet/Dashboard/src/Components/EpisodeView/EpisodeTiming";
import IncidentNoteTemplate from "../../../Models/DatabaseModels/IncidentNoteTemplate";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import ScheduledMaintenanceNoteTemplate from "../../../Models/DatabaseModels/ScheduledMaintenanceNoteTemplate";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import SecurityCaseStatus from "../../../Models/DatabaseModels/SecurityCaseStatus";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";
import { PostmortemProgress } from "../../../Utils/Incident/PostmortemStatus";
import { SecurityCaseNotificationChoiceKind } from "../../../Utils/SecurityCase/SecurityCaseNotificationPriority";
import { ToolImportNoteCode } from "../../../Types/ToolImport/ToolImportNote";
import { Translator } from "../../../Types/Translator";
import { recordNameInSentence } from "../../../Utils/DefaultRecordNames";
import { StateListType } from "../../../Utils/StateOrder";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * A STATE'S NAME IN A SENTENCE OR A MENU READS BY ITS LIST, IN SPANISH (#8064).
 *
 * A sentence that named a state handed its name to translatableTerm, which
 * looks any text up: a state a project named "Open" read "Abrir", the verb,
 * in the incident page's tiles ("Abrir en"), Mark as, the Change state
 * dialogs and the postmortem cards, beside a badge that said "Open". Each
 * is drawn here with the Dashboard's real Spanish words: a state the
 * project named itself reads as written, one a new project starts with
 * ("Resolved", "Ongoing", "Draft") in Spanish.
 */

const PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";
const EVENT_ID: string = "11111111-1111-4111-8111-111111111111";

const SPANISH: Record<string, string> = readDashboardLocale("es");
const spanish: Translator = dashboardTranslator("es");

let spanishInstance: i18n | null = null;

// The Dashboard's Spanish, English behind it, as it ships.
function spanishI18n(): i18n {
  if (spanishInstance) {
    return spanishInstance;
  }

  const instance: i18n = createInstance();

  instance.init({
    lng: "es",
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      es: { translation: SPANISH },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
    initImmediate: false,
  });

  spanishInstance = instance;

  return instance;
}

function inSpanish(element: ReactElement): ReactElement {
  return <I18nextProvider i18n={spanishI18n()}>{element}</I18nextProvider>;
}

interface ListResult<T> {
  data: Array<T>;
  count: number;
  skip: number;
  limit: number;
}

function listOf<T>(data: Array<T>): ListResult<T> {
  return { data: data, count: data.length, skip: 0, limit: 99 };
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 20; i++) {
      await Promise.resolve();
    }
  });
}

beforeEach(() => {
  getListMock.mockReset();
  countMock.mockReset();
  allowStateChanges();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the words the cases below lean on", () => {
  test("Spanish words Open as the verb, and has words of its own for the defaults", () => {
    expect({
      Open: SPANISH["Open"],
      Resolved: SPANISH["Resolved"],
      Acknowledged: SPANISH["Acknowledged"],
      Ongoing: SPANISH["Ongoing"],
      Draft: SPANISH["Draft"],
      High: SPANISH["High"],
      Investigating: SPANISH["Investigating"],
      "Mark as {{state}}": SPANISH["Mark as {{state}}"],
      "{{stateName}} in": SPANISH["{{stateName}} in"],
      "Not yet {{stateName}}": SPANISH["Not yet {{stateName}}"],
    }).toEqual({
      Open: "Abrir",
      Resolved: "Resuelto",
      Acknowledged: "Reconocido",
      Ongoing: "En curso",
      Draft: "Borrador",
      High: "Alta",
      Investigating: "Investigando",
      "Mark as {{state}}": "Marcar como {{state}}",
      "{{stateName}} in": "{{stateName}} en",
      "Not yet {{stateName}}": "Aún no {{stateName}}",
    });
  });
});

describe("an incident's and an alert's tiles", () => {
  // The tile's label, as the incident and alert pages fill it.
  function tileLabel(list: StateListType, name: string): string {
    return spanish.translateTemplate("{{stateName}} in", {
      stateName: recordNameInSentence(list, name),
    });
  }

  test("a state the project named Open reads Open en, never Abrir en", () => {
    expect(tileLabel(StateListType.IncidentState, "Open")).toBe("Open en");
    expect(tileLabel(StateListType.AlertState, "Open")).toBe("Open en");
  });

  test("the defaults read in Spanish", () => {
    expect(tileLabel(StateListType.IncidentState, "Acknowledged")).toBe(
      "Reconocido en",
    );
    expect(tileLabel(StateListType.AlertState, "Resolved")).toBe("Resuelto en");
  });

  test("before it is reached, the state is named the same way", () => {
    expect(
      getTimeToStateText(
        {
          stateList: StateListType.IncidentState,
          stateName: "Open",
          fallbackStateName: "Acknowledged",
        },
        spanish,
      ),
    ).toBe("Aún no Open");
    expect(
      getNotYetInStateText(StateListType.AlertState, "Resolved", spanish),
    ).toBe("Aún no resuelto");
  });

  test("an episode's tiles name its list's states", () => {
    const timing: ReturnType<typeof getEpisodeTiming> = getEpisodeTiming({
      list: StateListType.IncidentState,
      states: [
        { id: "a", name: "Identified", order: 1 },
        { id: "b", name: "Open", order: 2, isAcknowledgedState: true },
        { id: "c", name: "Resolved", order: 3, isResolvedState: true },
      ],
      timelines: [],
    });

    expect(timing.acknowledgedStateName).toBe("Open");
    expect(
      spanish.translateTemplate("{{stateName}} in", {
        stateName: recordNameInSentence(
          StateListType.IncidentState,
          timing.acknowledgedStateName,
        ),
      }),
    ).toBe("Open en");
  });
});

describe("an incident's Change state dialog", () => {
  const IDENTIFIED_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
  const ACKNOWLEDGED_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
  const OPEN_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
  const RESOLVED_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";

  function state(
    id: string,
    name: string,
    order: number,
    flag: string,
  ): IncidentState {
    const row: IncidentState = new IncidentState();
    row.id = new ObjectID(id);
    row.name = name;
    row.order = order;
    row.color = new Color("#ef4444");
    (row as unknown as Record<string, unknown>)[flag] = true;
    return row;
  }

  function serve(): void {
    getListMock.mockImplementation((...args: Array<unknown>) => {
      const modelType: unknown = (args[0] as { modelType: unknown }).modelType;

      if (modelType === IncidentState) {
        return Promise.resolve(
          listOf([
            state(IDENTIFIED_ID, "Identified", 1, "isCreatedState"),
            state(ACKNOWLEDGED_ID, "Acknowledged", 2, "isAcknowledgedState"),
            // A state the project added and named itself.
            state(OPEN_ID, "Open", 3, "isOpenState"),
            state(RESOLVED_ID, "Resolved", 4, "isResolvedState"),
          ]),
        );
      }

      if (modelType === IncidentStateTimeline) {
        const timeline: IncidentStateTimeline = new IncidentStateTimeline();
        timeline.incidentStateId = new ObjectID(IDENTIFIED_ID);
        timeline.startsAt = new Date(Date.now() - 20 * 60 * 1000);
        return Promise.resolve(listOf([timeline]));
      }

      if (modelType === IncidentNoteTemplate) {
        return Promise.resolve(listOf([]));
      }

      return Promise.resolve(listOf([]));
    });
  }

  async function renderHeader(): Promise<void> {
    serve();
    render(
      inSpanish(
        <ChangeIncidentState
          incidentId={new ObjectID(EVENT_ID)}
          eventNumber="INC-42"
          title="Checkout is down"
          onActionComplete={(): void => {}}
        />,
      ),
    );
    await flush();
  }

  function pickFromMenu(name: string): HTMLElement {
    fireEvent.click(
      screen.getByRole("button", { name: SPANISH["More actions"]! }),
    );
    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("menuitem", { name: name }),
    );

    return screen.getByTestId("state-change-modal");
  }

  test("the menu offers the project's Open as written", async () => {
    await renderHeader();

    fireEvent.click(
      screen.getByRole("button", { name: SPANISH["More actions"]! }),
    );

    const choices: Array<string> = within(screen.getByRole("menu"))
      .getAllByRole("menuitem")
      .map((item: HTMLElement): string => {
        return (item.textContent || "").trim();
      });

    expect(choices).toEqual(expect.arrayContaining(["Open"]));
    expect(choices).not.toContain("Abrir");
  });

  test("moving it to Open names Open in the dialog's title, never Abrir", async () => {
    await renderHeader();

    const modal: HTMLElement = pickFromMenu("Open");

    // "Marcar incidente como Open", "Marcar como Open".
    expect(within(modal).getByRole("heading")).toHaveTextContent(
      "Marcar incidente como Open",
    );
    expect(modal).toHaveTextContent("Marcar como Open");
    expect(modal).not.toHaveTextContent("Abrir");
  });
});

describe("a scheduled maintenance event's Mark as buttons", () => {
  const SCHEDULED_ID: string = "44444444-4444-4444-8444-444444444441";
  const ONGOING_ID: string = "44444444-4444-4444-8444-444444444442";
  const ENDED_ID: string = "44444444-4444-4444-8444-444444444444";

  function state(
    id: string,
    name: string,
    order: number,
    flag: string,
  ): ScheduledMaintenanceState {
    const row: ScheduledMaintenanceState = new ScheduledMaintenanceState();
    row.id = new ObjectID(id);
    row.name = name;
    row.order = order;
    row.color = new Color("#6366f1");
    (row as unknown as Record<string, unknown>)[flag] = true;
    return row;
  }

  async function renderHeader(ongoingName: string): Promise<void> {
    getListMock.mockImplementation((...args: Array<unknown>) => {
      const modelType: unknown = (args[0] as { modelType: unknown }).modelType;

      if (modelType === ScheduledMaintenanceState) {
        return Promise.resolve(
          listOf([
            state(SCHEDULED_ID, "Scheduled", 1, "isScheduledState"),
            state(ONGOING_ID, ongoingName, 2, "isOngoingState"),
            state(ENDED_ID, "Ended", 3, "isEndedState"),
          ]),
        );
      }

      if (modelType === ScheduledMaintenanceStateTimeline) {
        const timeline: ScheduledMaintenanceStateTimeline =
          new ScheduledMaintenanceStateTimeline();
        timeline.id = ObjectID.generate();
        timeline.scheduledMaintenanceStateId = new ObjectID(SCHEDULED_ID);
        timeline.startsAt = new Date(Date.now() - 60 * 1000);
        return Promise.resolve(listOf([timeline]));
      }

      if (modelType === ScheduledMaintenanceNoteTemplate) {
        return Promise.resolve(listOf([]));
      }

      return Promise.resolve(listOf([]));
    });

    render(
      inSpanish(
        <ChangeScheduledMaintenanceState
          scheduledMaintenanceId={new ObjectID(EVENT_ID)}
          onActionComplete={(): void => {}}
          eventNumber="#58"
          title="Database failover drill"
          eventStartsAt={new Date(Date.now() + 60 * 60 * 1000)}
          eventEndsAt={new Date(Date.now() + 2 * 60 * 60 * 1000)}
        />,
      ),
    );
    await flush();
  }

  test("the default Ongoing reads Marcar como En curso", async () => {
    await renderHeader("Ongoing");

    expect(document.getElementById("sm-mark-ongoing-btn")).toHaveTextContent(
      "Marcar como En curso",
    );
  });

  test("an ongoing state the project named Open reads Marcar como Open", async () => {
    await renderHeader("Open");

    const button: HTMLElement | null = document.getElementById(
      "sm-mark-ongoing-btn",
    );

    expect(button).toHaveTextContent("Marcar como Open");
    expect(button).not.toHaveTextContent("Abrir");
  });
});

describe("the postmortem status cards", () => {
  const OPEN_ID: string = "55555555-5555-4555-8555-555555555551";
  const DRAFT_ID: string = "55555555-5555-4555-8555-555555555552";

  const TILES: Array<PostmortemStatusTile> = [
    {
      statusId: OPEN_ID,
      name: "Open",
      description: "",
      color: "#6366f1",
      progress: PostmortemProgress.NotStarted,
    },
    {
      statusId: DRAFT_ID,
      name: "Draft",
      description: "",
      color: "#f59e0b",
      progress: PostmortemProgress.InProgress,
    },
  ];

  async function renderCards(): Promise<HTMLElement> {
    countMock.mockImplementation(() => {
      return Promise.resolve(3);
    });

    render(
      inSpanish(
        <PostmortemStatusSummaryCards
          projectId={new ObjectID(PROJECT_ID)}
          tiles={TILES}
          facetSelections={{}}
          facetOperators={{}}
          onTileClick={(): void => {}}
        />,
      ),
    );
    await flush();

    return screen.getByTestId("postmortem-status-summary-cards");
  }

  test("a status the project named Open is titled Open, the default Draft Borrador", async () => {
    const cards: HTMLElement = await renderCards();

    expect(cards).toHaveTextContent("Open");
    expect(cards).toHaveTextContent("Borrador");
    expect(cards).not.toHaveTextContent("Abrir");
  });

  test("each card's name for a screen reader reads its status the same way", async () => {
    await renderCards();

    const labels: Array<string> = screen
      .getAllByRole("button")
      .map((button: HTMLElement): string => {
        return button.getAttribute("aria-label") || "";
      });

    expect(
      labels.some((label: string): boolean => {
        return label.startsWith("Open: 3.");
      }),
    ).toBe(true);
    expect(
      labels.some((label: string): boolean => {
        return label.startsWith("Borrador: 3.");
      }),
    ).toBe(true);
    expect(labels.join(" ")).not.toContain("Abrir");
  });
});

describe("a security case's status steps", () => {
  function status(id: string, name: string, order: number): SecurityCaseStatus {
    const row: SecurityCaseStatus = new SecurityCaseStatus();
    row.id = new ObjectID(id);
    row.name = name;
    row.order = order;
    return row;
  }

  test("a status the project named Open reads Open, the default Investigating Investigando", () => {
    render(
      inSpanish(
        <SecurityCaseStatusStepper
          statuses={[
            status("66666666-6666-4666-8666-666666666661", "Open", 1),
            status("66666666-6666-4666-8666-666666666662", "Investigating", 2),
          ]}
          statusId={new ObjectID("66666666-6666-4666-8666-666666666661")}
        />,
      ),
    );

    const steps: HTMLElement = screen.getByTestId("security-case-status-steps");

    expect(steps).toHaveTextContent("Open");
    expect(steps).toHaveTextContent("Investigando");
    expect(steps).not.toHaveTextContent("Abrir");
  });
});

describe("a security case notification's priority choice", () => {
  test("the default High reads in Spanish, a priority the project named Open as written", () => {
    const high: string = describePriorityChoice(
      { name: "High", kind: SecurityCaseNotificationChoiceKind.AndAbove },
      spanish,
    );
    const open: string = describePriorityChoice(
      { name: "Open", kind: SecurityCaseNotificationChoiceKind.Only },
      spanish,
    );

    expect(high).toContain("Alta");
    expect(high).not.toContain("High");
    expect(open).toContain("Open");
    expect(open).not.toContain("Abrir");
  });
});

describe("an import's note on the state it matched", () => {
  test("the default Resolved reads Resuelto, a state the project named Open as written", () => {
    const resolved: string = describeToolImportNote(
      {
        code: ToolImportNoteCode.StateMatchedToResolved,
        values: { state: "Resolved" },
      },
      spanish,
      "PagerDuty",
    );
    const open: string = describeToolImportNote(
      {
        code: ToolImportNoteCode.StateMatchedToCreated,
        values: { state: "Open" },
      },
      spanish,
      "PagerDuty",
    );

    expect(resolved).toContain("Resuelto");
    expect(resolved).not.toContain("Resolved");
    expect(open).toContain("Open");
    expect(open).not.toContain("Abrir");
  });
});
