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
  waitFor,
  within,
} from "@testing-library/react";
import type { SpyInstance } from "jest-mock";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * HOW TO REACH ME (#6820, drawn as steps in #8139): the page opens on one
 * ladder - numbered steps, each a time and the ways to reach the person
 * that go out together then - opens on the grid for rules that differ or
 * a link to one kind, names every difference, and saves a ladder in one
 * request, for yourself or for a member with their masked methods. A step's
 * time is changed on its heading and moves the whole step; Add puts a way
 * into a step, Add Step starts one after the last; Save Changes shows once
 * there is something to save, and leaving before then asks first. The reads
 * and the save are stood in for; the ladder's reading and planning are the
 * real Common functions, and the menus are the real MoreMenu.
 */

const loadDataMock: MockFunction = getJestMockFunction();
const loadMethodsMock: MockFunction = getJestMockFunction();
const saveMock: MockFunction = getJestMockFunction();
const sendEventMock: MockFunction = getJestMockFunction();
let queryType: string | null = null;
let setQueryStringSpy: SpyInstance<
  (
    ...args: Parameters<typeof Navigation.setQueryString>
  ) => ReturnType<typeof Navigation.setQueryString>
>;
let navigateSpy: SpyInstance<
  (
    ...args: Parameters<typeof Navigation.navigate>
  ) => ReturnType<typeof Navigation.navigate>
>;

const PAGE_PATH: string =
  "/dashboard/8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b/user-settings/on-call-rules";

interface RecordedTabsProps {
  userId?: unknown;
  differingCellKeys?: ReadonlySet<string>;
  onRulesChanged?: () => void;
  isEditable?: boolean;
}

let tabsProps: RecordedTabsProps | null = null;

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NotificationRule/PagingLadder/PagingLadderApi",
  () => {
    return {
      __esModule: true,
      loadPagingLadderData: (...args: Array<unknown>) => {
        return loadDataMock(...args);
      },
      loadOwnPagingMethods: (...args: Array<unknown>) => {
        return loadMethodsMock(...args);
      },
      savePagingLadder: (...args: Array<unknown>) => {
        return saveMock(...args);
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NotificationRule/OnCallRulesTabs",
  () => {
    return {
      __esModule: true,
      default: (props: RecordedTabsProps): ReactElement => {
        tabsProps = props;
        return <div data-testid="on-call-rules-tabs-stub" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/OnCallTestPage/TestPageCard",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return <div data-testid="test-page-card-stub" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/VerificationCodeModal",
  () => {
    return {
      __esModule: true,
      default: (props: {
        itemId: string;
        destination: string;
        onVerified: (result: unknown) => void;
      }): ReactElement => {
        return (
          <div data-testid="verify-modal-stub">
            <span>{`Verify ${props.destination}`}</span>
            <button
              type="button"
              onClick={() => {
                props.onVerified({});
              }}
            >
              Enter the right code
            </button>
          </div>
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/PushNotificationsTurnedOff",
  () => {
    return {
      __esModule: true,
      usePushNotificationsTurnedOff: () => {
        return false;
      },
    };
  },
);

jest.mock("../../../UI/Utils/ProductEvents", () => {
  return {
    __esModule: true,
    default: {
      send: (...args: Array<unknown>) => {
        return sendEventMock(...args);
      },
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

import HowToReachMe from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationRule/HowToReachMe";
import { PagingMethodChoice } from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationRule/PagingLadder/PagingLadderMethods";
import { ProductEventName } from "../../../Types/Analytics/ProductEvent";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import {
  PagingLadderCell,
  PagingLadderRule,
  PagingLadderStep,
  getPagingLadderCellKey,
  getPagingLadderCells,
} from "../../../Types/NotificationRule/PagingLadder";
import ObjectID from "../../../Types/ObjectID";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import LeaveGuard from "../../../UI/Utils/LeaveGuard";
import Navigation from "../../../UI/Utils/Navigation";
import UserUtil from "../../../UI/Utils/User";

const ME: string = "a0000000-0000-4000-8000-000000000001";
const ANA: string = "a0000000-0000-4000-8000-0000000000a1";

const CRITICAL: string = "b0000000-0000-4000-8000-000000000001";
const MINOR: string = "b0000000-0000-4000-8000-000000000002";
const HIGH: string = "b0000000-0000-4000-8000-000000000003";

const EMAIL: string = "c0000000-0000-4000-8000-000000000001";
const SMS: string = "c0000000-0000-4000-8000-000000000002";
const CALL: string = "c0000000-0000-4000-8000-000000000003";
const PUSH: string = "c0000000-0000-4000-8000-000000000004";
const UNVERIFIED_SMS: string = "c0000000-0000-4000-8000-000000000005";

const CELLS: Array<PagingLadderCell> = getPagingLadderCells({
  incidentSeverities: [
    { id: CRITICAL, name: "Critical Incident" },
    { id: MINOR, name: "Minor Incident" },
  ],
  alertSeverities: [{ id: HIGH, name: "High" }],
});

const choice: (
  methodColumn: PagingMethodChoice["methodColumn"],
  methodId: string,
  title: string,
  identifier: string,
  isVerified?: boolean,
) => PagingMethodChoice = (
  methodColumn: PagingMethodChoice["methodColumn"],
  methodId: string,
  title: string,
  identifier: string,
  isVerified: boolean = true,
): PagingMethodChoice => {
  return {
    methodColumn: methodColumn,
    methodId: methodId,
    channel: title as OnCallPageChannel,
    title: title,
    identifier: identifier,
    isVerified: isVerified,
    hasPushLevel: methodColumn === "userPushId",
  };
};

const MY_METHODS: Array<PagingMethodChoice> = [
  choice("userPushId", PUSH, "Push", "Pixel 8"),
  choice("userEmailId", EMAIL, "Email", "me@example.com"),
  choice("userSmsId", SMS, "SMS", "+15550100"),
  choice("userCallId", CALL, "Call", "+15550100"),
  choice("userSmsId", UNVERIFIED_SMS, "SMS", "+447700900123", false),
];

let ruleCounter: number = 0;

// The rows of `steps` in every card, as a person editing the grid by hand would have.
const rulesFor: (
  cells: ReadonlyArray<PagingLadderCell>,
  steps: ReadonlyArray<PagingLadderStep>,
) => Array<PagingLadderRule> = (
  cells: ReadonlyArray<PagingLadderCell>,
  steps: ReadonlyArray<PagingLadderStep>,
): Array<PagingLadderRule> => {
  const rows: Array<PagingLadderRule> = [];

  for (const cell of cells) {
    for (const step of steps) {
      ruleCounter++;
      rows.push({
        _id: `d0000000-0000-4000-8000-${String(ruleCounter).padStart(12, "0")}`,
        ruleType: cell.ruleType,
        [cell.severityColumn]: cell.severityId,
        [step.methodColumn]: step.methodId,
        notifyAfterMinutes: step.notifyAfterMinutes,
        isOptOut: false,
        pushNotificationLevel: "Critical",
        repeatEveryMinutes: 0,
      } as PagingLadderRule);
    }
  }

  return rows;
};

const step: (
  methodColumn: PagingLadderStep["methodColumn"],
  methodId: string,
  notifyAfterMinutes: number,
) => PagingLadderStep = (
  methodColumn: PagingLadderStep["methodColumn"],
  methodId: string,
  notifyAfterMinutes: number,
): PagingLadderStep => {
  return {
    methodColumn: methodColumn,
    methodId: methodId,
    notifyAfterMinutes: notifyAfterMinutes,
  };
};

// SMS at once, then a call after five minutes.
const ONE_LADDER: Array<PagingLadderRule> = rulesFor(CELLS, [
  step("userSmsId", SMS, 0),
  step("userCallId", CALL, 5),
]);

// The same, but Critical incidents also call at once.
const DIFFERING: Array<PagingLadderRule> = [
  ...ONE_LADDER,
  ...rulesFor([CELLS[0]!], [step("userCallId", CALL, 0)]),
];

const renderPage: (props?: Record<string, unknown>) => void = (
  props?: Record<string, unknown>,
): void => {
  // The page reads its tab, and the project, from the address.
  window.history.replaceState(
    {},
    "",
    queryType ? `${PAGE_PATH}?type=${queryType}` : PAGE_PATH,
  );

  render(
    <MemoryRouter>
      <HowToReachMe userPreferencesKeyPrefix="test" {...(props || {})} />
    </MemoryRouter>,
  );
};

const givenRules: (rules: Array<PagingLadderRule>) => void = (
  rules: Array<PagingLadderRule>,
): void => {
  loadDataMock.mockResolvedValue({
    cells: CELLS,
    rules: rules,
    severityColors: { [CRITICAL]: "#ef4444" },
  });
};

const pageView: () => string | null = (): string | null => {
  return screen.getByTestId("how-to-reach-me").getAttribute("data-view");
};

// The ladder's steps, in order: each step's time and the ways it reaches the person.
const drawnSteps: () => Array<{
  wait: string;
  methods: Array<string>;
}> = (): Array<{ wait: string; methods: Array<string> }> => {
  return screen
    .getAllByTestId("paging-ladder-wait-group")
    .map((group: HTMLElement) => {
      return {
        wait:
          within(group).getByTestId("paging-ladder-step-wait").textContent ||
          "",
        methods: within(group)
          .getAllByTestId("paging-ladder-method")
          .map((method: HTMLElement): string => {
            return method.textContent || "";
          }),
      };
    });
};

// Lets a read or a save still in flight finish, inside act().
const settle: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  });
};

const stepGroup: (index: number) => HTMLElement = (
  index: number,
): HTMLElement => {
  return screen.getAllByTestId("paging-ladder-wait-group")[index]!;
};

// Opens a step's time and picks another.
const changeStepWait: (index: number, minutes: number) => void = (
  index: number,
  minutes: number,
): void => {
  fireEvent.click(
    within(stepGroup(index)).getByTestId("paging-ladder-step-wait"),
  );
  fireEvent.click(screen.getByTestId(`paging-ladder-wait-option-${minutes}`));
};

// The labels an open Add menu offers, in order.
const offeredMethods: () => Array<string> = (): Array<string> => {
  return screen
    .queryAllByTestId(/^paging-ladder-add-option-/)
    .map((option: HTMLElement): string => {
      return option.textContent || "";
    });
};

beforeEach(() => {
  ruleCounter = 0;
  queryType = null;
  tabsProps = null;
  LeaveGuard.reset();
  loadDataMock.mockReset();
  loadMethodsMock.mockReset();
  saveMock.mockReset();
  sendEventMock.mockReset();
  setQueryStringSpy = jest.spyOn(Navigation, "setQueryString");
  navigateSpy = jest.spyOn(Navigation, "navigate").mockImplementation(() => {
    // Where it goes is what is checked.
  });
  loadMethodsMock.mockResolvedValue(MY_METHODS);
  saveMock.mockResolvedValue({
    createdCount: 0,
    updatedCount: 0,
    deletedCount: 0,
    unchangedCount: 0,
  });
  jest.spyOn(UserUtil, "getUserId").mockReturnValue(new ObjectID(ME));
});

afterEach(() => {
  cleanup();
  LeaveGuard.reset();
  jest.restoreAllMocks();
});

describe("which view it opens on", () => {
  test("one ladder for everything opens on the ladder, as numbered steps in paging order", async () => {
    givenRules(ONE_LADDER);
    renderPage();

    await screen.findByTestId("paging-ladder");
    expect(pageView()).toBe("ladder");
    expect(
      screen.getByText("How to reach me when I am on call"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "When you are paged, OneUptime tries each step in turn until somebody acknowledges.",
      ),
    ).toBeInTheDocument();

    expect(drawnSteps()).toEqual([
      { wait: "At once", methods: ["SMS: +15550100"] },
      // The method's name as the cards below name it: "Phone call", never the shared "Call" (#7178).
      { wait: "After 5\u00A0minutes", methods: ["Phone call: +15550100"] },
    ]);

    // Numbered down the line.
    expect(
      screen
        .getAllByTestId("paging-ladder-step-number")
        .map((number: HTMLElement): string => {
          return number.textContent || "";
        }),
    ).toEqual(["1", "2"]);

    // A later step is skipped once somebody acknowledges, and says so; the first is not.
    expect(
      within(stepGroup(0)).queryByTestId("paging-ladder-if-not-acknowledged"),
    ).not.toBeInTheDocument();
    expect(
      within(stepGroup(1)).getByTestId("paging-ladder-if-not-acknowledged"),
    ).toHaveTextContent("If nobody has acknowledged yet");

    // Each way to reach the person has its kind's icon.
    expect(screen.getAllByTestId("paging-ladder-method-icon")).toHaveLength(2);

    /*
     * Left out on a phone, drawn from sm up - and never by the bare
     * `hidden` class, which a foreign `.hidden{display:none !important}`
     * (Bootstrap 3, HTML5 Boilerplate, browser extensions) would keep
     * hidden at every width (ForeignHiddenRuleGuard).
     */
    for (const icon of screen.getAllByTestId("paging-ladder-method-icon")) {
      expect(icon.classList.contains("max-sm:hidden")).toBe(true);
      expect(icon.classList.contains("sm:flex")).toBe(true);
      expect(icon.classList.contains("hidden")).toBe(false);
    }

    // What it is for, beside the way to make some severities differ.
    expect(screen.getByTestId("paging-ladder-scope")).toHaveTextContent(
      "Used for every incident, alert and episode, of every severity.",
    );

    // Nothing changed: nothing to save, and no button for it.
    expect(
      screen.queryByTestId("paging-ladder-save-bar"),
    ).not.toBeInTheDocument();

    // Your own page: the test page at its foot.
    expect(screen.getByTestId("test-page-card-stub")).toBeInTheDocument();
    expect(tabsProps).toBeNull();
    expect(loadDataMock).toHaveBeenCalledWith(new ObjectID(ME));
  });

  test("rules that differ open on the grid, naming each card and how it differs", async () => {
    givenRules(DIFFERING);
    renderPage();

    await screen.findByTestId("paging-ladder-summary");
    expect(pageView()).toBe("grid");
    expect(
      screen.getByText("1 card is different from the ladder."),
    ).toBeInTheDocument();

    const difference: HTMLElement = screen.getByTestId(
      "paging-ladder-difference",
    );
    expect(within(difference).getByText("Incidents")).toBeInTheDocument();
    expect(
      within(difference).getByText("Critical Incident"),
    ).toBeInTheDocument();
    expect(within(difference).getByText("Also")).toBeInTheDocument();
    expect(within(difference).getByText("Phone call")).toBeInTheDocument();
    expect(within(difference).getByText("At once")).toBeInTheDocument();

    // The grid marks the card that differs.
    expect(tabsProps).not.toBeNull();
    expect([...(tabsProps!.differingCellKeys || [])]).toEqual([
      getPagingLadderCellKey({
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        severityId: CRITICAL,
      }),
    ]);
    expect(
      screen.getByText("Use One Ladder for Everything"),
    ).toBeInTheDocument();
  });

  test("a link to one kind's tab opens the grid, even on one ladder", async () => {
    queryType = "alerts";
    givenRules(ONE_LADDER);
    renderPage();

    // The grid is drawn at once; the ladder above it follows the read.
    await screen.findByTestId("on-call-rules-tabs-stub");
    expect(pageView()).toBe("grid");
    expect(
      await screen.findByText(
        "Every card below uses your ladder. Change a card to make it different.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Back to One Ladder")).toBeInTheDocument();
  });

  test("a person with no rules yet opens on an empty ladder that says so, with one button to start it", async () => {
    givenRules([]);
    renderPage();

    await screen.findByTestId("paging-ladder-empty");
    expect(pageView()).toBe("ladder");
    expect(
      screen.getByText(
        "Nothing reaches you when you are paged yet. Add a way to reach you.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("paging-ladder-add-first")).toHaveTextContent(
      "Add a way to reach you",
    );
    expect(screen.queryByTestId("paging-ladder-save")).not.toBeInTheDocument();
  });

  test("a failed read says so, and reading again shows the ladder", async () => {
    givenRules(ONE_LADDER);
    loadDataMock.mockRejectedValueOnce(
      new Error("Your rules were not read. Try again."),
    );
    renderPage();

    expect(
      await screen.findByText("Your rules were not read. Try again."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("how-to-reach-me")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("refresh-button"));

    await screen.findByTestId("paging-ladder");
    expect(loadDataMock).toHaveBeenCalledTimes(2);
  });
});

describe("moving between the ladder and the grid", () => {
  test("Different for Some Severities, at the ladder's foot, opens the grid and says so in an event", async () => {
    givenRules(ONE_LADDER);
    renderPage();

    const openGrid: HTMLElement = await screen.findByTestId(
      "paging-ladder-open-grid",
    );
    expect(openGrid).toHaveTextContent("Different for Some Severities");
    expect(
      within(screen.getByTestId("paging-ladder-scope")).getByTestId(
        "paging-ladder-open-grid",
      ),
    ).toBe(openGrid);

    fireEvent.click(openGrid);

    expect(pageView()).toBe("grid");
    expect(sendEventMock).toHaveBeenCalledWith(
      ProductEventName.PagingLadderGridOpened,
      { is_own: true, differing_card_count: 0 },
    );
  });

  test("over changes not saved yet, it asks first: Keep Editing stays, Discard Changes opens the grid", async () => {
    givenRules(ONE_LADDER);
    renderPage();
    await screen.findByTestId("paging-ladder");

    changeStepWait(1, 10);
    fireEvent.click(screen.getByTestId("paging-ladder-open-grid"));

    expect(screen.getByText("Leave without saving?")).toBeInTheDocument();
    expect(
      screen.getByText(
        "You have unsaved changes to these steps. If you leave now, they will be lost.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("modal-footer-close-button"));

    expect(pageView()).toBe("ladder");
    expect(drawnSteps()[1]!.wait).toBe("After 10\u00A0minutes");
    expect(screen.queryByText("Leave without saving?")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("paging-ladder-open-grid"));
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    expect(pageView()).toBe("grid");
    expect(saveMock).not.toHaveBeenCalled();
  });

  test("Back to One Ladder leaves the grid's tab out of the address", async () => {
    queryType = "alerts";
    givenRules(ONE_LADDER);
    renderPage();

    fireEvent.click(await screen.findByText("Back to One Ladder"));

    expect(pageView()).toBe("ladder");
    expect(setQueryStringSpy).toHaveBeenCalledWith({ type: null });
  });

  test("a change on the grid reads the rules again", async () => {
    givenRules(DIFFERING);
    renderPage();
    await screen.findByTestId("on-call-rules-tabs-stub");

    givenRules(ONE_LADDER);

    await act(async () => {
      tabsProps!.onRulesChanged!();
    });

    await waitFor(() => {
      expect(
        screen.queryByTestId("paging-ladder-difference"),
      ).not.toBeInTheDocument();
    });
    expect(loadDataMock).toHaveBeenCalledTimes(2);
  });
});

describe("changing the steps", () => {
  test("a step's new time is saved for every severity in one request", async () => {
    givenRules(ONE_LADDER);
    renderPage();
    await screen.findByTestId("paging-ladder");

    // The call: after 5 minutes, to after 10.
    fireEvent.click(
      within(stepGroup(1)).getByTestId("paging-ladder-step-wait"),
    );

    // The times a step can have, the one in use ticked.
    expect(screen.getByTestId("paging-ladder-wait-option-5")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(
      [0, 5, 10, 15, 30, 60].map((minutes: number): string => {
        return (
          screen.getByTestId(`paging-ladder-wait-option-${minutes}`)
            .textContent || ""
        );
      }),
    ).toEqual([
      "At once",
      "After 5\u00A0minutes",
      "After 10\u00A0minutes",
      "After 15\u00A0minutes",
      "After 30\u00A0minutes",
      "After 60\u00A0minutes",
    ]);

    fireEvent.click(screen.getByTestId("paging-ladder-wait-option-10"));

    expect(drawnSteps()[1]!.wait).toBe("After 10\u00A0minutes");
    expect(screen.getByTestId("paging-ladder-unsaved")).toHaveTextContent(
      "You have unsaved changes",
    );

    // What the server holds once it has saved, as the page reads it back.
    givenRules(
      rulesFor(CELLS, [
        step("userSmsId", SMS, 0),
        step("userCallId", CALL, 10),
      ]),
    );
    fireEvent.click(screen.getByTestId("paging-ladder-save"));

    await waitFor(() => {
      expect(saveMock).toHaveBeenCalledTimes(1);
    });
    expect(saveMock).toHaveBeenCalledWith({
      userId: undefined,
      steps: [step("userSmsId", SMS, 0), step("userCallId", CALL, 10)],
    });
    expect(sendEventMock).toHaveBeenCalledWith(
      ProductEventName.PagingLadderSaved,
      { is_own: true, step_count: 2, replaced_card_count: 0 },
    );
    expect(await screen.findByTestId("paging-ladder-saved")).toHaveTextContent(
      "Saved. Every severity now uses this ladder.",
    );
    // Saved: nothing is left to save.
    expect(screen.queryByTestId("paging-ladder-save")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("paging-ladder-unsaved"),
    ).not.toBeInTheDocument();
  });

  test("a step moved to another step's time goes out with it", async () => {
    givenRules(ONE_LADDER);
    renderPage();
    await screen.findByTestId("paging-ladder");

    changeStepWait(1, 0);

    expect(drawnSteps()).toEqual([
      {
        wait: "At once",
        methods: ["SMS: +15550100", "Phone call: +15550100"],
      },
    ]);
  });

  test("a step's Add offers the ways not in it yet, and adds one at that step's time", async () => {
    givenRules(ONE_LADDER);
    renderPage();
    await screen.findByTestId("paging-ladder");

    fireEvent.click(
      within(stepGroup(0)).getByTestId("paging-ladder-add-to-step"),
    );

    // SMS is in the step already, and a number waiting for its code is no step yet.
    expect(offeredMethods()).toEqual([
      "Push notification: Pixel 8",
      "Email: me@example.com",
      "Phone call: +15550100",
    ]);
    // Your own page: setting up another way to be reached is the menu's last item.
    expect(screen.getByTestId("paging-ladder-set-up-more")).toHaveTextContent(
      "Set up more ways to be reached",
    );

    fireEvent.click(
      screen.getByTestId(`paging-ladder-add-option-userPushId:${PUSH}`),
    );

    // Push, then SMS: steps with the same time are listed gentlest first.
    expect(drawnSteps()[0]).toEqual({
      wait: "At once",
      methods: ["Push notification: Pixel 8", "SMS: +15550100"],
    });

    givenRules(
      rulesFor(CELLS, [
        step("userPushId", PUSH, 0),
        step("userSmsId", SMS, 0),
        step("userCallId", CALL, 5),
      ]),
    );
    fireEvent.click(screen.getByTestId("paging-ladder-save"));

    await waitFor(() => {
      expect(saveMock).toHaveBeenCalledTimes(1);
    });
    expect(
      (saveMock.mock.calls[0]![0] as { steps: Array<PagingLadderStep> }).steps,
    ).toEqual([
      {
        methodColumn: "userPushId",
        methodId: PUSH,
        notifyAfterMinutes: 0,
        pushNotificationLevel: "Critical",
        repeatEveryMinutes: 0,
      },
      step("userSmsId", SMS, 0),
      step("userCallId", CALL, 5),
    ]);
    await screen.findByTestId("paging-ladder-saved");
  });

  test("Add Step starts a step after the last one, at the next time", async () => {
    givenRules(ONE_LADDER);
    renderPage();
    await screen.findByTestId("paging-ladder");

    fireEvent.click(screen.getByTestId("paging-ladder-add-step-button"));

    // Every verified way can be a step of its own, a call again included.
    expect(offeredMethods()).toEqual([
      "Push notification: Pixel 8",
      "Email: me@example.com",
      "SMS: +15550100",
      "Phone call: +15550100",
    ]);

    fireEvent.click(
      screen.getByTestId(`paging-ladder-add-option-userEmailId:${EMAIL}`),
    );

    expect(drawnSteps()).toEqual([
      { wait: "At once", methods: ["SMS: +15550100"] },
      { wait: "After 5\u00A0minutes", methods: ["Phone call: +15550100"] },
      { wait: "After 10\u00A0minutes", methods: ["Email: me@example.com"] },
    ]);

    givenRules(
      rulesFor(CELLS, [
        step("userSmsId", SMS, 0),
        step("userCallId", CALL, 5),
        step("userEmailId", EMAIL, 10),
      ]),
    );
    fireEvent.click(screen.getByTestId("paging-ladder-save"));

    await waitFor(() => {
      expect(saveMock).toHaveBeenCalledTimes(1);
    });
    expect(
      (saveMock.mock.calls[0]![0] as { steps: Array<PagingLadderStep> }).steps,
    ).toEqual([
      step("userSmsId", SMS, 0),
      step("userCallId", CALL, 5),
      step("userEmailId", EMAIL, 10),
    ]);
    await screen.findByTestId("paging-ladder-saved");
  });

  test("no Add Step after a step an hour in, the longest time a step can have", async () => {
    givenRules(
      rulesFor(CELLS, [
        step("userSmsId", SMS, 0),
        step("userCallId", CALL, 60),
      ]),
    );
    renderPage();
    await screen.findByTestId("paging-ladder");

    expect(drawnSteps()[1]!.wait).toBe("After 60\u00A0minutes");
    expect(
      screen.queryByTestId("paging-ladder-add-step"),
    ).not.toBeInTheDocument();
  });

  test("an empty ladder's button adds a way to reach you at once", async () => {
    givenRules([]);
    renderPage();

    fireEvent.click(await screen.findByTestId("paging-ladder-add-first"));
    fireEvent.click(
      screen.getByTestId(`paging-ladder-add-option-userSmsId:${SMS}`),
    );

    expect(drawnSteps()).toEqual([
      { wait: "At once", methods: ["SMS: +15550100"] },
    ]);

    givenRules(rulesFor(CELLS, [step("userSmsId", SMS, 0)]));
    fireEvent.click(screen.getByTestId("paging-ladder-save"));

    await waitFor(() => {
      expect(saveMock).toHaveBeenCalledWith({
        userId: undefined,
        steps: [step("userSmsId", SMS, 0)],
      });
    });
    await screen.findByTestId("paging-ladder-saved");
  });

  test("Set up more ways to be reached opens Notification Methods", async () => {
    givenRules(ONE_LADDER);
    renderPage();
    await screen.findByTestId("paging-ladder");

    fireEvent.click(screen.getByTestId("paging-ladder-add-step-button"));
    fireEvent.click(screen.getByTestId("paging-ladder-set-up-more"));

    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(navigateSpy.mock.calls[0]![0].toString()).toContain(
      "/user-settings/notification-methods",
    );
  });

  test("a removed step is not saved; Discard Changes puts it back", async () => {
    givenRules(ONE_LADDER);
    renderPage();
    await screen.findByTestId("paging-ladder");

    fireEvent.click(screen.getAllByTestId("paging-ladder-step-remove")[0]!);
    expect(screen.getAllByTestId("paging-ladder-step")).toHaveLength(1);

    fireEvent.click(screen.getByTestId("paging-ladder-discard"));
    expect(screen.getAllByTestId("paging-ladder-step")).toHaveLength(2);
    expect(
      screen.queryByTestId("paging-ladder-save-bar"),
    ).not.toBeInTheDocument();
  });

  test("each way's × names what it removes", async () => {
    givenRules(ONE_LADDER);
    renderPage();
    await screen.findByTestId("paging-ladder");

    expect(
      screen
        .getAllByTestId("paging-ladder-step-remove")
        .map((button: HTMLElement): string | null => {
          return button.getAttribute("aria-label");
        }),
    ).toEqual(["Remove SMS: +15550100", "Remove Phone call: +15550100"]);
  });

  test("removing every step leaves nothing to save: an empty ladder pages nobody", async () => {
    givenRules(ONE_LADDER);
    renderPage();
    await screen.findByTestId("paging-ladder");

    while (screen.queryAllByTestId("paging-ladder-step-remove").length > 0) {
      fireEvent.click(screen.getAllByTestId("paging-ladder-step-remove")[0]!);
    }

    expect(screen.getByTestId("paging-ladder-empty")).toBeInTheDocument();
    expect(screen.getByTestId("paging-ladder-save")).toBeDisabled();
    expect(screen.getByTestId("paging-ladder-discard")).toBeInTheDocument();
  });

  test("changes not saved yet hold the leave guard, until they are saved or discarded", async () => {
    givenRules(ONE_LADDER);
    renderPage();
    await screen.findByTestId("paging-ladder");

    expect(LeaveGuard.isHeld()).toBe(false);

    changeStepWait(1, 15);
    expect(LeaveGuard.isHeld()).toBe(true);

    fireEvent.click(screen.getByTestId("paging-ladder-discard"));
    expect(LeaveGuard.isHeld()).toBe(false);

    changeStepWait(1, 15);
    expect(LeaveGuard.isHeld()).toBe(true);

    givenRules(
      rulesFor(CELLS, [
        step("userSmsId", SMS, 0),
        step("userCallId", CALL, 15),
      ]),
    );
    fireEvent.click(screen.getByTestId("paging-ladder-save"));

    await screen.findByTestId("paging-ladder-saved");
    expect(LeaveGuard.isHeld()).toBe(false);
  });

  test("using one ladder over rules that differ names the cards that change, before anything is saved", async () => {
    givenRules(DIFFERING);
    renderPage();

    fireEvent.click(await screen.findByText("Use One Ladder for Everything"));

    expect(pageView()).toBe("ladder");
    expect(
      screen.getByTestId("paging-ladder-replaces-note"),
    ).toBeInTheDocument();

    // Nothing changed in the ladder, and still it can be saved: it replaces the difference.
    fireEvent.click(screen.getByTestId("paging-ladder-save"));

    const confirmCards: HTMLElement = await screen.findByTestId(
      "paging-ladder-confirm-cards",
    );
    expect(within(confirmCards).getByText("Incidents")).toBeInTheDocument();
    expect(
      within(confirmCards).getByText("Critical Incident"),
    ).toBeInTheDocument();
    expect(saveMock).not.toHaveBeenCalled();

    givenRules(ONE_LADDER);
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(saveMock).toHaveBeenCalledTimes(1);
    });
    expect(saveMock).toHaveBeenCalledWith({
      userId: undefined,
      steps: [step("userSmsId", SMS, 0), step("userCallId", CALL, 5)],
    });
    expect(sendEventMock).toHaveBeenCalledWith(
      ProductEventName.PagingLadderSaved,
      { is_own: true, step_count: 2, replaced_card_count: 1 },
    );
    await screen.findByTestId("paging-ladder-saved");
  });

  test("a save the server refuses says why, and keeps the ladder as it was typed", async () => {
    givenRules(ONE_LADDER);
    saveMock.mockRejectedValue(
      new Error(
        "A step names a notification method that is not verified, or is not theirs in this project. Verify it in Notification Methods, or choose another method, then save.",
      ),
    );
    renderPage();
    await screen.findByTestId("paging-ladder");

    fireEvent.click(screen.getAllByTestId("paging-ladder-step-remove")[1]!);
    fireEvent.click(screen.getByTestId("paging-ladder-save"));

    expect(
      await screen.findByText(
        /is not verified, or is not theirs in this project/,
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("paging-ladder-step")).toHaveLength(1);
    expect(screen.queryByTestId("paging-ladder-saved")).not.toBeInTheDocument();
    // Still unsaved, and still asked about before leaving.
    expect(screen.getByTestId("paging-ladder-unsaved")).toBeInTheDocument();
    expect(LeaveGuard.isHeld()).toBe(true);
    await settle();
  });
});

describe("what is not verified yet", () => {
  test("a number waiting for its code is offered with Verify, and verifying reads the rules again", async () => {
    givenRules(ONE_LADDER);
    renderPage();
    await screen.findByTestId("paging-ladder");

    const notVerified: HTMLElement = screen.getByTestId(
      "paging-ladder-not-verified",
    );
    expect(within(notVerified).getByText("SMS")).toBeInTheDocument();

    // It is not offered as a step until it is verified.
    fireEvent.click(screen.getByTestId("paging-ladder-add-step-button"));
    expect(
      screen.queryByTestId(
        `paging-ladder-add-option-userSmsId:${UNVERIFIED_SMS}`,
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId(`paging-ladder-add-option-userCallId:${CALL}`),
    ).toBeInTheDocument();

    fireEvent.click(within(notVerified).getByTestId("paging-ladder-verify"));
    expect(await screen.findByText("Verify +447700900123")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Enter the right code"));

    await waitFor(() => {
      expect(loadDataMock).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByTestId("verify-modal-stub")).not.toBeInTheDocument();
    await settle();
  });

  test("somebody with no verified method is told where to add one", async () => {
    givenRules([]);
    loadMethodsMock.mockResolvedValue([
      choice("userSmsId", UNVERIFIED_SMS, "SMS", "+447700900123", false),
    ]);
    renderPage();

    expect(
      await screen.findByTestId("paging-ladder-no-methods"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("paging-ladder-add-first"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Set up more ways to be reached"),
    ).toBeInTheDocument();
  });
});

describe("a member's page", () => {
  const MEMBER_METHODS: Array<{
    methodType: string;
    methodId: string;
    maskedIdentifier: string;
    isVerified: boolean;
  }> = [
    {
      methodType: "SMS",
      methodId: SMS,
      maskedIdentifier: "+1 ••• ••• 0100",
      isVerified: true,
    },
    {
      methodType: "Call",
      methodId: CALL,
      maskedIdentifier: "+1 ••• ••• 0100",
      isVerified: true,
    },
  ];

  test("names the member, uses their masked methods, and saves their ladder with their id", async () => {
    givenRules(ONE_LADDER);
    renderPage({
      userId: new ObjectID(ANA),
      person: { displayName: "Ana Lopez", firstName: "Ana" },
      notificationMethods: MEMBER_METHODS,
      isEditable: true,
    });

    await screen.findByTestId("paging-ladder");
    expect(
      screen.getByText("How to reach Ana when they are on call"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "When Ana is paged, OneUptime tries each step in turn until somebody acknowledges.",
      ),
    ).toBeInTheDocument();
    expect(loadMethodsMock).not.toHaveBeenCalled();
    expect(loadDataMock).toHaveBeenCalledWith(new ObjectID(ANA));
    expect(screen.getAllByTestId("paging-ladder-method")[0]!).toHaveTextContent(
      "SMS: +1 ••• ••• 0100",
    );

    // No test page to yourself, and no Notification Methods of yours to send them to.
    expect(screen.queryByTestId("test-page-card-stub")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Set up more ways to be reached"),
    ).not.toBeInTheDocument();

    // A step's Add names the member, and sets up nothing of yours.
    const add: HTMLElement = within(stepGroup(0)).getByTestId(
      "paging-ladder-add-to-step",
    );
    expect(add).toHaveAttribute("aria-label", "Add a way to reach Ana");
    fireEvent.click(add);
    expect(offeredMethods()).toEqual(["Phone call: +1 ••• ••• 0100"]);
    expect(
      screen.queryByTestId("paging-ladder-set-up-more"),
    ).not.toBeInTheDocument();
    fireEvent.click(add);

    changeStepWait(1, 15);
    givenRules(
      rulesFor(CELLS, [
        step("userSmsId", SMS, 0),
        step("userCallId", CALL, 15),
      ]),
    );
    fireEvent.click(screen.getByTestId("paging-ladder-save"));

    await waitFor(() => {
      expect(saveMock).toHaveBeenCalledTimes(1);
    });
    expect(saveMock).toHaveBeenCalledWith({
      userId: new ObjectID(ANA),
      steps: [step("userSmsId", SMS, 0), step("userCallId", CALL, 15)],
    });
    expect(sendEventMock).toHaveBeenCalledWith(
      ProductEventName.PagingLadderSaved,
      { is_own: false, step_count: 2, replaced_card_count: 0 },
    );
    await screen.findByTestId("paging-ladder-saved");
  });

  test("somebody who may not change it reads it, with nothing to press but the grid", async () => {
    givenRules(ONE_LADDER);
    renderPage({
      userId: new ObjectID(ANA),
      person: { displayName: "Ana Lopez", firstName: "Ana" },
      notificationMethods: MEMBER_METHODS,
      isEditable: false,
    });

    await screen.findByTestId("paging-ladder");
    expect(screen.getAllByTestId("paging-ladder-step")).toHaveLength(2);
    // A step's time is read, not pressed.
    expect(
      within(stepGroup(1)).getByTestId("paging-ladder-step-wait").tagName,
    ).toBe("SPAN");
    expect(screen.queryByTestId("paging-ladder-save")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("paging-ladder-add-to-step"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("paging-ladder-add-step"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("paging-ladder-step-remove"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("paging-ladder-read-only")).toBeInTheDocument();
    expect(screen.getByTestId("paging-ladder-open-grid")).toBeInTheDocument();
  });

  test("a rule whose method readiness cannot name says so, never a blank", async () => {
    givenRules(ONE_LADDER);
    renderPage({
      userId: new ObjectID(ANA),
      person: { displayName: "Ana Lopez", firstName: "Ana" },
      notificationMethods: [],
      isEditable: true,
    });

    await screen.findByTestId("paging-ladder");
    expect(
      screen.getAllByText("A notification method this page cannot name"),
    ).toHaveLength(2);
    // Its × still names what it removes.
    expect(
      screen.getAllByTestId("paging-ladder-step-remove")[0],
    ).toHaveAttribute(
      "aria-label",
      "Remove A notification method this page cannot name",
    );
  });
});
