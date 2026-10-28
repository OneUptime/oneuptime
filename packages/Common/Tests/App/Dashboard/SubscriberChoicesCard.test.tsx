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
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * Subscriber Choices, on a status page's Subscriber Settings: whether a
 * visitor who subscribes picks the monitors and groups they hear about,
 * and the kinds of event. One switch each, saved the moment it is
 * flipped, where they were two switches in "Advanced Subscriber Settings",
 * an Edit dialog that also held the subscriber timezones - and sent all
 * three at once, so a project on a plan without the choices could not save
 * a timezone while a trial had left a choice on.
 *
 * Only the network, the permission gate and the plan are stubbed; the
 * card, its rows and the switches are the real ones.
 */

const getItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
    },
  };
});

import SubscriberChoicesCard from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/SubscriberChoicesCard";
import SubscriberChoicesCopy, {
  SUBSCRIBER_CHOICE_COLUMNS,
  SUBSCRIBER_CHOICES_CARD_TEST_ID,
  SubscriberChoiceColumn,
  getSubscriberChoiceDescription,
  getSubscriberChoiceSwitchTestId,
  getSubscriberChoiceTitle,
  getSubscriberSettingsMoreItems,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/SubscriberChoicesCopy";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import SubscriptionPlan, {
  PlanType,
} from "../../../Types/Billing/SubscriptionPlan";
import ObjectID from "../../../Types/ObjectID";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import { FoldedSectionItem } from "../../../UI/Components/FoldedSection/FoldedSectionItem";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";

// The page's translator, as an English reader has it.
const ENGLISH: Translator = createTranslator(undefined, "en");

const STATUS_PAGE_ID: string = "7d7d7d7d-0000-4000-8000-0000000000aa";

type StoredColumns = Partial<Record<SubscriberChoiceColumn, boolean>>;

let stored: StoredColumns | null | Error = null;
let gate: PermissionGateResult = { isAllowed: true };
let plan: PlanType | null = null;

beforeEach(() => {
  stored = {
    allowSubscribersToChooseResources: false,
    allowSubscribersToChooseEventTypes: false,
  };
  gate = { isAllowed: true };
  plan = null;

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    if (stored instanceof Error) {
      throw stored;
    }

    if (!stored) {
      return null;
    }

    const page: StatusPage = new StatusPage();
    page._id = STATUS_PAGE_ID;
    Object.assign(page, stored);

    return page;
  });

  updateByIdMock.mockReset();
  updateByIdMock.mockResolvedValue({} as never);

  getJestSpyOn(PermissionGate, "check").mockImplementation(
    (): PermissionGateResult => {
      return gate;
    },
  );

  getJestSpyOn(ProjectUtil, "getCurrentPlan").mockImplementation(
    (): PlanType | null => {
      return plan;
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderCard(): Promise<void> {
  await act(async (): Promise<void> => {
    render(
      <SubscriberChoicesCard statusPageId={new ObjectID(STATUS_PAGE_ID)} />,
    );
  });

  await waitFor(() => {
    expect(getItemMock).toHaveBeenCalled();
  });
}

async function loaded(): Promise<void> {
  await waitFor(() => {
    expect(screen.getAllByRole("switch")).toHaveLength(2);
  });
}

function switchFor(column: SubscriberChoiceColumn): HTMLElement {
  return screen.getByTestId(getSubscriberChoiceSwitchTestId(column));
}

function rowFor(column: SubscriberChoiceColumn): HTMLElement {
  return screen.getByTestId(`${getSubscriberChoiceSwitchTestId(column)}-row`);
}

describe("the copy", () => {
  test("names the two switches for the columns they write, each saying what off and on mean", () => {
    expect(SUBSCRIBER_CHOICE_COLUMNS).toEqual([
      "allowSubscribersToChooseResources",
      "allowSubscribersToChooseEventTypes",
    ]);
    expect(getSubscriberChoiceTitle("allowSubscribersToChooseResources")).toBe(
      "Allow Subscribers to Choose Resources",
    );
    expect(getSubscriberChoiceTitle("allowSubscribersToChooseEventTypes")).toBe(
      "Allow Subscribers to Choose Event Types",
    );
    expect(
      getSubscriberChoiceDescription(
        "allowSubscribersToChooseResources",
        false,
      ),
    ).toBe("Off: subscribers hear about everything on this status page.");
    expect(
      getSubscriberChoiceDescription("allowSubscribersToChooseResources", true),
    ).toBe("On: visitors pick the monitors and groups they hear about.");
    expect(
      getSubscriberChoiceDescription(
        "allowSubscribersToChooseEventTypes",
        false,
      ),
    ).toBe("Off: subscribers hear about every kind of event.");
    expect(
      getSubscriberChoiceDescription(
        "allowSubscribersToChooseEventTypes",
        true,
      ),
    ).toBe(
      "On: visitors pick from incidents, announcements and scheduled maintenance.",
    );
  });

  test("More settings names its five cards, and shows each that holds something a new page does not", () => {
    const titles: (items: Array<FoldedSectionItem>) => Array<string> = (
      items: Array<FoldedSectionItem>,
    ): Array<string> => {
      return items.map((item: FoldedSectionItem): string => {
        return item.title;
      });
    };

    const fresh: Array<FoldedSectionItem> = getSubscriberSettingsMoreItems(
      {},
      ENGLISH,
    );

    // Who Can Subscribe first: it folded in here from the page above.
    expect(titles(fresh)).toEqual([
      "Who Can Subscribe",
      "Subscriber Timezones",
      "Email Footer",
      "Custom SMTP",
      "Twilio Config",
    ]);
    for (const item of fresh) {
      expect([item.title, item.isSet]).toEqual([item.title, false]);
    }

    const configured: Array<FoldedSectionItem> = getSubscriberSettingsMoreItems(
      {
        restrictions: {
          limitSubscribersToPrivateUsers: true,
          allowedEmailDomainCount: 0,
        },
        timezoneCount: 2,
        isCustomFooter: true,
        smtpConfigName: "Acme mail",
        twilioConfigName: "Support Twilio",
      },
      ENGLISH,
    );

    expect(
      configured.map((item: FoldedSectionItem) => {
        return [item.title, item.isSet, item.value];
      }),
    ).toEqual([
      // Who may subscribe, as every other chip here says what it holds.
      ["Who Can Subscribe", true, "Private users"],
      ["Subscriber Timezones", true, "2"],
      ["Email Footer", true, "Your own text"],
      ["Custom SMTP", true, "Acme mail"],
      ["Twilio Config", true, "Support Twilio"],
    ]);

    // Nothing loaded yet counts as what a new page starts with.
    expect(
      getSubscriberSettingsMoreItems(
        {
          restrictions: {
            limitSubscribersToPrivateUsers: false,
            allowedEmailDomainCount: 0,
          },
          timezoneCount: 0,
          isCustomFooter: false,
          smtpConfigName: null,
          twilioConfigName: null,
        },
        ENGLISH,
      ).map((item: FoldedSectionItem) => {
        return item.isSet;
      }),
    ).toEqual([false, false, false, false, false]);
  });

  test("the More settings line says what is folded", () => {
    expect(SubscriberChoicesCopy.moreDescription).toBe(
      "Who can subscribe, timezones, the email footer, and your own mail server or Twilio account.",
    );
    expect(SubscriberChoicesCopy.timezonesPlaceholder).toBe(
      "None picked: times are shown in UTC, London, New York, Los Angeles, Kolkata and Sydney time.",
    );
  });
});

describe("the card", () => {
  test("reads this page's two columns and nothing else", async () => {
    await renderCard();
    await loaded();

    const request: Record<string, unknown> = getItemMock.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(request["modelType"]).toBe(StatusPage);
    expect((request["id"] as ObjectID).toString()).toBe(STATUS_PAGE_ID);
    expect(request["select"]).toEqual({
      allowSubscribersToChooseResources: true,
      allowSubscribersToChooseEventTypes: true,
    });
  });

  test("is Subscriber Choices, saying what it is for", async () => {
    await renderCard();
    await loaded();

    expect(screen.getByText("Subscriber Choices")).toBeInTheDocument();
    expect(
      screen.getByText("What visitors can pick when they subscribe."),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(SUBSCRIBER_CHOICES_CARD_TEST_ID),
    ).toBeInTheDocument();
  });

  test("a new page has both off, each saying what off means", async () => {
    await renderCard();
    await loaded();

    for (const column of SUBSCRIBER_CHOICE_COLUMNS) {
      expect(
        screen.getByRole("switch", { name: getSubscriberChoiceTitle(column) }),
      ).toBe(switchFor(column));
      expect(switchFor(column)).toHaveAttribute("aria-checked", "false");
      expect(
        within(rowFor(column)).getByText(
          getSubscriberChoiceDescription(column, false),
        ),
      ).toBeInTheDocument();
    }
  });

  test("a page with both on shows both on, saying what on means", async () => {
    stored = {
      allowSubscribersToChooseResources: true,
      allowSubscribersToChooseEventTypes: true,
    };

    await renderCard();
    await loaded();

    for (const column of SUBSCRIBER_CHOICE_COLUMNS) {
      expect(switchFor(column)).toHaveAttribute("aria-checked", "true");
      expect(
        within(rowFor(column)).getByText(
          getSubscriberChoiceDescription(column, true),
        ),
      ).toBeInTheDocument();
    }
  });

  test.each(
    SUBSCRIBER_CHOICE_COLUMNS.map((column: SubscriberChoiceColumn) => {
      return [column];
    }),
  )(
    "%s saves that column alone, at once, and its line follows",
    async (column: SubscriberChoiceColumn) => {
      await renderCard();
      await loaded();

      await act(async (): Promise<void> => {
        fireEvent.click(switchFor(column));
      });

      await waitFor(() => {
        expect(switchFor(column)).toHaveAttribute("aria-checked", "true");
      });

      expect(updateByIdMock).toHaveBeenCalledTimes(1);

      const request: Record<string, unknown> = updateByIdMock.mock
        .calls[0]![0] as Record<string, unknown>;

      expect(request["modelType"]).toBe(StatusPage);
      expect((request["id"] as ObjectID).toString()).toBe(STATUS_PAGE_ID);
      // One column: a timezone or another choice is never sent with it.
      expect(request["data"]).toEqual({ [column]: true });
      expect(
        within(rowFor(column)).getByText(
          getSubscriberChoiceDescription(column, true),
        ),
      ).toBeInTheDocument();
    },
  );

  test("a refused save moves the switch back, and says why under it", async () => {
    updateByIdMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error(
        "Please upgrade your plan to Scale to access this feature",
      );
    });

    await renderCard();
    await loaded();

    await act(async (): Promise<void> => {
      fireEvent.click(switchFor("allowSubscribersToChooseResources"));
    });

    await waitFor(() => {
      expect(
        within(rowFor("allowSubscribersToChooseResources")).getByText(
          "Please upgrade your plan to Scale to access this feature",
        ),
      ).toBeInTheDocument();
    });
    expect(switchFor("allowSubscribersToChooseResources")).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  test("names the plan each switch needs, beside it, on a plan without it", async () => {
    plan = PlanType.Free;
    getJestSpyOn(
      SubscriptionPlan,
      "isFeatureAccessibleOnCurrentPlan",
    ).mockImplementation((needed: unknown): boolean => {
      return needed === PlanType.Free;
    });

    await renderCard();
    await loaded();

    const statusPage: StatusPage = new StatusPage();

    for (const column of SUBSCRIBER_CHOICE_COLUMNS) {
      const needed: PlanType | undefined =
        statusPage.getColumnBillingAccessControl(column)?.update;

      expect(needed).toBeDefined();
      expect(within(rowFor(column)).getByTestId("pill")).toHaveTextContent(
        `${needed} Plan`,
      );
      // Beside it, not part of its name.
      expect(
        screen.getByRole("switch", { name: getSubscriberChoiceTitle(column) }),
      ).toBe(switchFor(column));
    }
  });

  test("someone who may not edit the page sees both locked, and nothing is saved", async () => {
    gate = { isAllowed: false, disabledReason: "You cannot edit this page." };

    await renderCard();
    await loaded();

    for (const column of SUBSCRIBER_CHOICE_COLUMNS) {
      await act(async (): Promise<void> => {
        fireEvent.click(switchFor(column));
      });
    }

    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("a read that fails says why, and can be tried again", async () => {
    stored = new Error("Network down");

    await renderCard();

    await waitFor(() => {
      expect(screen.getByText("Network down")).toBeInTheDocument();
    });
    expect(screen.queryAllByRole("switch")).toHaveLength(0);

    stored = {
      allowSubscribersToChooseResources: true,
      allowSubscribersToChooseEventTypes: false,
    };

    await act(async (): Promise<void> => {
      fireEvent.click(
        screen.getByRole("button", { name: /refresh|try again/i }),
      );
    });

    await loaded();
    expect(switchFor("allowSubscribersToChooseResources")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});
