import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
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
} from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import React, { ReactElement } from "react";
import { initReactI18next } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A RUNBOOK'S OVERVIEW OFFERS WHAT IS MISSING FIRST.
 *
 * A runbook runs only while it is on and has a step. The Overview used to
 * offer a primary Run Now whatever the runbook was: a new runbook, created
 * with no steps, opened on a button whose only answer was an error, over
 * three cards of zeros, and one someone turned off said nothing of it.
 *
 * The real page, banner, empty state and buttons; the details card is a
 * stand-in that hands the page the runbook it read, as the real one does
 * (onItemLoaded), and draws the page's card buttons. The network, the
 * signed-in user's permissions and navigation are stubbed.
 */

interface CardButtonProps {
  title: string;
  disabled?: boolean | undefined;
  tooltip?: string | undefined;
  onClick?: (() => void) | undefined;
}

interface DetailProps {
  refresher?: boolean | undefined;
  cardProps: { buttons?: Array<CardButtonProps> | undefined };
  modelDetailProps: {
    selectMoreFields?: Record<string, unknown> | undefined;
    onItemLoaded?: ((item: unknown) => void) | undefined;
  };
}

let mockRunbook: Record<string, unknown> | null = null;
let mockDetails: Array<DetailProps> = [];

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  const ReactInMock: typeof React = jest.requireActual("react") as typeof React;

  return {
    __esModule: true,
    default: (props: DetailProps): ReactElement => {
      mockDetails.push(props);

      ReactInMock.useEffect(() => {
        if (mockRunbook) {
          props.modelDetailProps.onItemLoaded?.(mockRunbook);
        }
      }, [props.refresher]);

      return ReactInMock.createElement(
        "div",
        { "data-testid": "runbook-details" },
        (props.cardProps.buttons || []).map((button: CardButtonProps) => {
          return ReactInMock.createElement(
            "button",
            {
              key: button.title,
              type: "button",
              disabled: button.disabled,
              title: button.tooltip,
              onClick: button.onClick,
            },
            button.title,
          );
        }),
      );
    },
  };
});

const updateByIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
      getList: async (): Promise<unknown> => {
        return { data: [], count: 0, skip: 0, limit: 1 };
      },
      count: async (): Promise<number> => {
        return mockTotalRuns;
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

let mockTotalRuns: number = 0;
let permissionsForTest: Array<string> = [];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
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

import RunbookOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/View/Index";
import {
  RUNBOOK_ADD_STEPS_BUTTON_TEST_ID,
  RUNBOOK_NO_STEPS_TEST_ID,
  RUNBOOK_TURNED_OFF_BANNER_TEST_ID,
  RUNBOOK_TURN_ON_BUTTON_TEST_ID,
  RunbookOverviewCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Runbook/RunbookOverviewState";
import RunbookSwitchCopy from "../../../../App/FeatureSet/Dashboard/src/Components/Runbook/RunbookSwitchCopy";
import Runbook from "../../../Models/DatabaseModels/Runbook";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import { getJestSpyOn } from "../../Spy";

const PROJECT_ID: ObjectID = new ObjectID(
  "5b1f0a0e-1111-4c1e-9a1e-000000000001",
);
const RUNBOOK_ID: ObjectID = new ObjectID(
  "2a000000-0000-4000-8000-0000000000a1",
);

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const ONE_STEP: Array<Record<string, unknown>> = [
  { id: "s1", type: "Manual", order: 1, title: "Check replication lag" },
];

let navigateSpy: jest.SpyInstance;

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: readLocale("en") },
      de: { translation: readLocale("de") },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  await i18next.changeLanguage("en");
  permissionsForTest = [Permission.ProjectOwner];
  PermissionGate.clearPermissionPropsCache();
  mockRunbook = null;
  mockDetails = [];
  mockTotalRuns = 0;
  updateByIdMock.mockReset();
  updateByIdMock.mockImplementation(async (): Promise<unknown> => {
    return {};
  });
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  getJestSpyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(
    RUNBOOK_ID,
  );
  navigateSpy = getJestSpyOn(Navigation, "navigate").mockImplementation(
    (): void => {},
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function openRunbook(runbook: Record<string, unknown>): Promise<void> {
  mockRunbook = runbook;

  render(
    <RunbookOverview
      pageRoute={new Route("/runbooks/view")}
      currentProject={null}
      hasPaymentMethod={true}
    />,
  );

  await screen.findByTestId("runbook-details");
  // The details have been read, and the stats counted.
  await act(async () => {});
}

function runNowButton(): HTMLButtonElement | null {
  return screen.queryByRole("button", {
    name: "Run Now",
  }) as HTMLButtonElement | null;
}

describe("the runbook is read with what the Overview offers first", () => {
  test("its steps and its switch are selected with the details - and what starts it on its own", async () => {
    await openRunbook({ isEnabled: true, steps: ONE_STEP });

    const details: DetailProps = mockDetails[mockDetails.length - 1]!;

    expect(details.modelDetailProps.selectMoreFields).toEqual({
      steps: true,
      isEnabled: true,
      // The Triggers line (Components/Runbook/Triggers/RunbookTriggersSummary).
      isScheduleEnabled: true,
      scheduleCron: true,
      scheduleTimezone: true,
      isWebhookEnabled: true,
    });
  });
});

describe("a runbook with no steps", () => {
  test("offers Add Steps in place of three cards of zeros, and no Run Now", async () => {
    await openRunbook({ isEnabled: true, steps: [] });

    const firstStep: HTMLElement = screen.getByTestId(RUNBOOK_NO_STEPS_TEST_ID);

    expect(firstStep).toHaveTextContent(RunbookOverviewCopy.noStepsTitle);
    expect(firstStep).toHaveTextContent(RunbookOverviewCopy.noStepsDescription);
    expect(runNowButton()).toBeNull();
    // The activity tiles wait for a run.
    expect(screen.queryByText("Total Runs")).toBeNull();
    expect(screen.queryByText("Last Run")).toBeNull();
  });

  test("Add Steps opens the runbook's Steps page", async () => {
    await openRunbook({ isEnabled: true, steps: null });

    fireEvent.click(screen.getByTestId(RUNBOOK_ADD_STEPS_BUTTON_TEST_ID));

    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(String(navigateSpy.mock.calls[0]![0])).toBe(
      `/dashboard/${PROJECT_ID.toString()}/runbooks/${RUNBOOK_ID.toString()}/steps`,
    );
  });

  test("whose steps were removed after it ran keeps its activity, with the first step above it", async () => {
    mockTotalRuns = 3;

    await openRunbook({ isEnabled: true, steps: [] });

    expect(await screen.findByText("Total Runs")).toBeInTheDocument();
    expect(screen.getByTestId(RUNBOOK_NO_STEPS_TEST_ID)).toHaveTextContent(
      RunbookOverviewCopy.noStepsDescription,
    );
    expect(
      screen.getByTestId(RUNBOOK_ADD_STEPS_BUTTON_TEST_ID),
    ).toBeInTheDocument();
    expect(runNowButton()).toBeNull();
  });
});

describe("a runbook that is turned off", () => {
  test("says so at the top, with the Settings switch's own words", async () => {
    await openRunbook({ isEnabled: false, steps: ONE_STEP });

    const banner: HTMLElement = screen.getByTestId(
      RUNBOOK_TURNED_OFF_BANNER_TEST_ID,
    );

    expect(banner).toHaveTextContent(RunbookOverviewCopy.turnedOffTitle);
    expect(banner).toHaveTextContent(RunbookSwitchCopy.switchOffDescription);
  });

  test("keeps Run Now, locked, saying how to run it - and the Last Run tile points at nothing locked", async () => {
    await openRunbook({ isEnabled: false, steps: ONE_STEP });

    const runNow: HTMLButtonElement = runNowButton()!;

    expect(runNow).toBeDisabled();
    expect(runNow.title).toBe(RunbookOverviewCopy.runNowTurnedOff);
    expect(await screen.findByText("Never run yet.")).toBeInTheDocument();
    expect(
      screen.queryByText(/Click\s+Run Now\s+to start one/),
    ).not.toBeInTheDocument();
  });

  test("Turn on runbook saves the switch the Settings page saves, then lets it run", async () => {
    await openRunbook({ isEnabled: false, steps: ONE_STEP });

    const detailsBefore: number = mockDetails.length;

    // The details are read again once it is on.
    mockRunbook = { isEnabled: true, steps: ONE_STEP };
    fireEvent.click(screen.getByTestId(RUNBOOK_TURN_ON_BUTTON_TEST_ID));

    await waitFor(() => {
      expect(
        screen.queryByTestId(RUNBOOK_TURNED_OFF_BANNER_TEST_ID),
      ).not.toBeInTheDocument();
    });

    expect(updateByIdMock).toHaveBeenCalledTimes(1);

    const call: { modelType: unknown; id: ObjectID; data: unknown } =
      updateByIdMock.mock.calls[0]![0] as {
        modelType: unknown;
        id: ObjectID;
        data: unknown;
      };

    expect(call.modelType).toBe(Runbook);
    expect(call.id.toString()).toBe(RUNBOOK_ID.toString());
    expect(call.data).toEqual({ isEnabled: true });

    // The details card is asked to read the runbook again.
    expect(mockDetails.length).toBeGreaterThan(detailsBefore);
    expect(runNowButton()).not.toBeDisabled();
  });

  test("someone who may not turn it on sees the button locked, saying why", async () => {
    permissionsForTest = [Permission.RunbookViewer];
    PermissionGate.clearPermissionPropsCache();

    await openRunbook({ isEnabled: false, steps: ONE_STEP });

    const turnOn: HTMLElement = screen.getByTestId(
      RUNBOOK_TURN_ON_BUTTON_TEST_ID,
    );

    expect(turnOn).toBeDisabled();
    fireEvent.click(turnOn);
    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("with no steps either, offers both: turn it on, and add its first step", async () => {
    await openRunbook({ isEnabled: false, steps: [] });

    expect(
      screen.getByTestId(RUNBOOK_TURNED_OFF_BANNER_TEST_ID),
    ).toBeInTheDocument();
    expect(screen.getByTestId(RUNBOOK_NO_STEPS_TEST_ID)).toBeInTheDocument();
    expect(runNowButton()).toBeNull();
  });
});

describe("a runbook that can run", () => {
  test("opens as it always did: Run Now, the activity, no banner", async () => {
    await openRunbook({ isEnabled: true, steps: ONE_STEP });

    expect(runNowButton()).not.toBeDisabled();
    expect(runNowButton()!.title).toBe("");
    expect(
      screen.queryByTestId(RUNBOOK_TURNED_OFF_BANNER_TEST_ID),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId(RUNBOOK_NO_STEPS_TEST_ID)).toBeNull();
    expect(await screen.findByText("Total Runs")).toBeInTheDocument();
    // The Last Run tile still points at Run Now, which can be pressed.
    expect(
      await screen.findByText((_content: string, element: Element | null) => {
        return (
          element?.tagName === "DIV" &&
          element.textContent === "Never run yet. Click Run Now to start one."
        );
      }),
    ).toBeInTheDocument();
  });

  test("a runbook whose switch was never written counts as on", async () => {
    await openRunbook({ steps: ONE_STEP });

    expect(
      screen.queryByTestId(RUNBOOK_TURNED_OFF_BANNER_TEST_ID),
    ).not.toBeInTheDocument();
    expect(runNowButton()).not.toBeDisabled();
  });
});

describe("in German", () => {
  test("the first step and the banner read in German", async () => {
    await i18next.changeLanguage("de");
    const german: Record<string, string> = readLocale("de");

    await openRunbook({ isEnabled: false, steps: [] });

    expect(screen.getByTestId(RUNBOOK_NO_STEPS_TEST_ID)).toHaveTextContent(
      german[RunbookOverviewCopy.noStepsTitle]!,
    );
    expect(
      screen.getByTestId(RUNBOOK_TURNED_OFF_BANNER_TEST_ID),
    ).toHaveTextContent(german[RunbookOverviewCopy.turnedOffTitle]!);
    expect(
      screen.getByTestId(RUNBOOK_ADD_STEPS_BUTTON_TEST_ID),
    ).toHaveTextContent(german[RunbookOverviewCopy.addStepsButton]!);
  });
});
