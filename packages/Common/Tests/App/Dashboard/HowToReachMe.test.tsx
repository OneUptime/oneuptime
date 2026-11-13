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
 * HOW TO REACH ME (#6820): the page opens on one ladder, opens on the grid
 * for rules that differ or a link to one kind, names every difference, and
 * saves a ladder in one request - for yourself, or for a member with their
 * masked methods. The reads and the save are stood in for; the ladder's
 * reading and planning are the real Common functions.
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

interface DropdownOptionStub {
  label: string;
  value: string | number;
}

// react-select stood in for: a select, named by its aria label.
jest.mock("../../../UI/Components/Dropdown/Dropdown", () => {
  return {
    __esModule: true,
    DROPDOWN_MENU_Z_INDEX: 60,
    default: (props: {
      options: Array<DropdownOptionStub>;
      value?: DropdownOptionStub | undefined;
      ariaLabel?: string;
      placeholder?: string;
      dataTestId?: string;
      onChange?: ((value: string | number) => void) | undefined;
    }): ReactElement => {
      return (
        <select
          aria-label={props.ariaLabel || props.placeholder}
          data-testid={props.dataTestId}
          value={props.value ? String(props.value.value) : ""}
          onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
            const picked: DropdownOptionStub | undefined = props.options.find(
              (option: DropdownOptionStub): boolean => {
                return String(option.value) === event.target.value;
              },
            );

            if (picked) {
              props.onChange?.(picked.value);
            }
          }}
        >
          <option value="">{props.placeholder || ""}</option>
          {props.options.map((option: DropdownOptionStub) => {
            return (
              <option key={String(option.value)} value={String(option.value)}>
                {option.label}
              </option>
            );
          })}
        </select>
      );
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

beforeEach(() => {
  ruleCounter = 0;
  queryType = null;
  tabsProps = null;
  loadDataMock.mockReset();
  loadMethodsMock.mockReset();
  saveMock.mockReset();
  sendEventMock.mockReset();
  setQueryStringSpy = jest.spyOn(Navigation, "setQueryString");
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
  jest.restoreAllMocks();
});

describe("which view it opens on", () => {
  test("one ladder for everything opens on the ladder, grouped by when each step is used", async () => {
    givenRules(ONE_LADDER);
    renderPage();

    await screen.findByTestId("paging-ladder");
    expect(pageView()).toBe("ladder");
    expect(
      screen.getByText("How to reach me when I am on call"),
    ).toBeInTheDocument();

    const groups: Array<HTMLElement> = screen.getAllByTestId(
      "paging-ladder-wait-group",
    );
    expect(groups).toHaveLength(2);
    expect(within(groups[0]!).getByText("At once")).toBeInTheDocument();
    expect(within(groups[0]!).getByText("SMS")).toBeInTheDocument();
    expect(within(groups[1]!).getByText("After 5 minutes")).toBeInTheDocument();
    // The method's name as the cards below name it: "Phone call", never the shared "Call" (#7178).
    expect(within(groups[1]!).getByText("Phone call")).toBeInTheDocument();

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

  test("a person with no rules yet opens on an empty ladder that says so", async () => {
    givenRules([]);
    renderPage();

    await screen.findByTestId("paging-ladder-empty");
    expect(pageView()).toBe("ladder");
    expect(
      screen.getByText(
        "Nothing reaches you when you are paged yet. Add a way to reach you.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("paging-ladder-save")).toBeDisabled();
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
  test("Different for Some Severities opens the grid, and says so in an event", async () => {
    givenRules(ONE_LADDER);
    renderPage();

    fireEvent.click(await screen.findByText("Different for Some Severities"));

    expect(pageView()).toBe("grid");
    expect(sendEventMock).toHaveBeenCalledWith(
      ProductEventName.PagingLadderGridOpened,
      { is_own: true, differing_card_count: 0 },
    );
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

describe("saving a ladder", () => {
  test("a changed wait is saved for every severity in one request", async () => {
    givenRules(ONE_LADDER);
    renderPage();
    await screen.findByTestId("paging-ladder");

    expect(screen.getByTestId("paging-ladder-save")).toBeDisabled();

    const waits: Array<HTMLElement> = screen.getAllByTestId(
      "paging-ladder-step-wait",
    );
    // The call: after 5 minutes, to after 10.
    fireEvent.change(waits[1]!, { target: { value: "10" } });

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
  });

  test("push, then SMS, then a call after five minutes: add push, and the order is the waits", async () => {
    givenRules(ONE_LADDER);
    renderPage();
    await screen.findByTestId("paging-ladder");

    fireEvent.change(screen.getByTestId("paging-ladder-add-step"), {
      target: { value: `userPushId:${PUSH}` },
    });

    const firstGroup: HTMLElement = screen.getAllByTestId(
      "paging-ladder-wait-group",
    )[0]!;
    const methods: Array<string> = within(firstGroup)
      .getAllByTestId("paging-ladder-method")
      .map((element: HTMLElement): string => {
        return element.textContent || "";
      });
    expect(methods).toEqual(["Push notification: Pixel 8", "SMS: +15550100"]);

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
  });

  test("a removed step is not saved; Discard Changes puts it back", async () => {
    givenRules(ONE_LADDER);
    renderPage();
    await screen.findByTestId("paging-ladder");

    fireEvent.click(screen.getAllByTestId("paging-ladder-step-remove")[0]!);
    expect(screen.getAllByTestId("paging-ladder-step")).toHaveLength(1);

    fireEvent.click(screen.getByTestId("paging-ladder-discard"));
    expect(screen.getAllByTestId("paging-ladder-step")).toHaveLength(2);
    expect(screen.getByTestId("paging-ladder-save")).toBeDisabled();
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
    fireEvent.click(screen.getAllByText("Save Ladder").pop()!);

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
    const addOptions: Array<string> = Array.from(
      (screen.getByTestId("paging-ladder-add-step") as HTMLSelectElement)
        .options,
    ).map((option: HTMLOptionElement): string => {
      return option.value;
    });
    expect(addOptions).not.toContain(`userSmsId:${UNVERIFIED_SMS}`);
    expect(addOptions).toContain(`userCallId:${CALL}`);

    // Each is named as the cards' own dropdowns name it (#7178).
    expect(
      Array.from(
        (screen.getByTestId("paging-ladder-add-step") as HTMLSelectElement)
          .options,
      )
        .filter((option: HTMLOptionElement): boolean => {
          return option.value !== "";
        })
        .map((option: HTMLOptionElement): string => {
          return option.textContent || "";
        }),
    ).toEqual([
      "Push notification: Pixel 8",
      "Email: me@example.com",
      "SMS: +15550100",
      "Phone call: +15550100",
    ]);

    fireEvent.click(within(notVerified).getByTestId("paging-ladder-verify"));
    expect(await screen.findByText("Verify +447700900123")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Enter the right code"));

    await waitFor(() => {
      expect(loadDataMock).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByTestId("verify-modal-stub")).not.toBeInTheDocument();
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
      screen.queryByTestId("paging-ladder-add-step"),
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

    fireEvent.change(screen.getAllByTestId("paging-ladder-step-wait")[1]!, {
      target: { value: "15" },
    });
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
  });

  test("somebody who may not change it reads it, with nothing to press", async () => {
    givenRules(ONE_LADDER);
    renderPage({
      userId: new ObjectID(ANA),
      person: { displayName: "Ana Lopez", firstName: "Ana" },
      notificationMethods: MEMBER_METHODS,
      isEditable: false,
    });

    await screen.findByTestId("paging-ladder");
    expect(screen.getAllByTestId("paging-ladder-step")).toHaveLength(2);
    expect(screen.queryByTestId("paging-ladder-save")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("paging-ladder-add-step"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("paging-ladder-step-remove"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("paging-ladder-read-only")).toBeInTheDocument();
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
  });
});
