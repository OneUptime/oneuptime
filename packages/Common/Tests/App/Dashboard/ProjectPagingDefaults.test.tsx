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
import React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * HOW MEMBERS ARE PAGED BY DEFAULT (#7449), in Project Settings >
 * Notification Channels' More settings: the project's default ladder for
 * new members, edited with How to Reach Me's own editor - by channel, never
 * a number or an address - and saved as the project's default; and the
 * folded header that names it and the phone ask. Somebody who may not
 * change project settings reads it only.
 */

const getItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();
const canUpdateMock: MockFunction = getJestMockFunction();
const sendEventMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
      updateById: (...args: Array<unknown>) => {
        return updateByIdMock(...args);
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/ProjectColumnEditGate",
  () => {
    return {
      __esModule: true,
      canUpdateProjectColumns: (...args: Array<unknown>) => {
        return canUpdateMock(...args);
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

import DefaultPagingLadderCard from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationRule/PagingLadder/DefaultPagingLadderCard";
import {
  DEFAULT_LADDER_PLACE,
  DEFAULT_LADDER_TITLE,
  PHONE_FOR_ON_CALL_PLACE,
  PHONE_FOR_ON_CALL_TITLE,
  PROJECT_PAGING_DEFAULTS_COPY,
  getDefaultLadderChannelChoices,
  getProjectPagingDefaultsFoldedItems,
  toDefaultLadderSteps,
  toDefaultSteps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationRule/PagingLadder/ProjectPagingDefaultsWords";
import { JSONArray } from "../../../Types/JSON";
import {
  PAGING_LADDER_DEFAULT_CHANNELS,
  readPagingLadderDefault,
} from "../../../Types/NotificationRule/PagingLadderDefault";
import ObjectID from "../../../Types/ObjectID";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import { FOLDED_SECTION_ON } from "../../../UI/Components/FoldedSection/FoldedSectionItem";

const PROJECT_ID: ObjectID = new ObjectID(
  "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b",
);

// "Push and SMS at once, then a call after 5 minutes", as it is stored.
const STORED: JSONArray = [
  {
    channel: OnCallPageChannel.Push,
    notifyAfterMinutes: 0,
    pushNotificationLevel: "Critical",
    repeatEveryMinutes: 0,
  },
  { channel: OnCallPageChannel.SMS, notifyAfterMinutes: 0 },
  { channel: OnCallPageChannel.Call, notifyAfterMinutes: 5 },
];

let stepCounts: Array<number> = [];

const renderCard: () => Promise<void> = async (): Promise<void> => {
  render(
    <MemoryRouter>
      <DefaultPagingLadderCard
        projectId={PROJECT_ID}
        onStepCountChange={(count: number) => {
          stepCounts.push(count);
        }}
      />
    </MemoryRouter>,
  );

  await screen.findByTestId("paging-ladder");
};

const savedDefault: () => unknown = (): unknown => {
  const call: Array<unknown> | undefined = updateByIdMock.mock.calls[0];

  return (call?.[0] as { data: Record<string, unknown> } | undefined)?.data[
    "defaultPagingLadder"
  ];
};

beforeEach(() => {
  getItemMock.mockReset();
  updateByIdMock.mockReset();
  canUpdateMock.mockReset();
  sendEventMock.mockReset();
  stepCounts = [];

  getItemMock.mockResolvedValue({ defaultPagingLadder: STORED } as never);
  updateByIdMock.mockResolvedValue({} as never);
  canUpdateMock.mockReturnValue(true as never);
});

afterEach(() => {
  cleanup();
});

describe("the default ladder card", () => {
  test("reads the project's default, and only it", async () => {
    await renderCard();

    expect(getItemMock).toHaveBeenCalledTimes(1);
    expect(getItemMock.mock.calls[0]![0]).toMatchObject({
      id: PROJECT_ID,
      select: { defaultPagingLadder: true },
    });
    expect(stepCounts).toEqual([3]);
  });

  test("draws it as steps by channel, in paging order, with no number or address", async () => {
    await renderCard();

    const groups: Array<HTMLElement> = screen.getAllByTestId(
      "paging-ladder-wait-group",
    );

    expect(groups).toHaveLength(2);
    expect(
      within(groups[0]!)
        .getAllByTestId("paging-ladder-method")
        .map((method: HTMLElement): string => {
          return method.textContent || "";
        }),
    ).toEqual(["Push notification", "SMS"]);
    expect(
      within(groups[1]!).getByTestId("paging-ladder-method"),
    ).toHaveTextContent("Phone call");
    expect(
      within(groups[1]!).getByTestId("paging-ladder-step-wait"),
    ).toHaveTextContent("After 5 minutes");

    expect(
      screen.getByText(PROJECT_PAGING_DEFAULTS_COPY.ladderDescription),
    ).toBeInTheDocument();
    expect(screen.getByText(DEFAULT_LADDER_TITLE)).toBeInTheDocument();
  });

  test("with no default it says what happens instead, and offers to add a step", async () => {
    getItemMock.mockResolvedValue({ defaultPagingLadder: null } as never);

    await renderCard();

    expect(
      screen.getByText(PROJECT_PAGING_DEFAULTS_COPY.noDefault),
    ).toBeInTheDocument();
    expect(screen.getByTestId("paging-ladder-add-first")).toHaveTextContent(
      PROJECT_PAGING_DEFAULTS_COPY.addLabel,
    );
    expect(screen.queryByTestId("default-ladder-turn-off")).toBeNull();
    expect(stepCounts).toEqual([0]);
  });

  test("its Add offers every channel a default may name, and no custom channel", async () => {
    getItemMock.mockResolvedValue({ defaultPagingLadder: null } as never);

    await renderCard();

    fireEvent.click(screen.getByTestId("paging-ladder-add-first"));

    const options: Array<string> = screen
      .getAllByTestId(/^paging-ladder-add-option-/)
      .map((option: HTMLElement): string => {
        return option.getAttribute("data-testid") || "";
      });

    expect(options).toHaveLength(PAGING_LADDER_DEFAULT_CHANNELS.length);
    expect(options).toContain("paging-ladder-add-option-userSmsId:SMS");
    expect(options.join(",")).not.toContain("customNotificationChannelId");

    // A channel, named alone: never a device or a number nobody gave.
    expect(
      screen.getByTestId("paging-ladder-add-option-userPushId:Push"),
    ).toHaveTextContent(/^Push notification$/);
    expect(
      screen.getByTestId("paging-ladder-add-option-userCallId:Call"),
    ).toHaveTextContent(/^Phone call$/);
  });

  test("a step added and saved is stored as the project's default, by channel", async () => {
    getItemMock.mockResolvedValue({ defaultPagingLadder: null } as never);

    await renderCard();

    fireEvent.click(screen.getByTestId("paging-ladder-add-first"));
    fireEvent.click(
      screen.getByTestId("paging-ladder-add-option-userSmsId:SMS"),
    );
    fireEvent.click(screen.getByTestId("paging-ladder-save"));

    await screen.findByText(PROJECT_PAGING_DEFAULTS_COPY.saved);

    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    expect((updateByIdMock.mock.calls[0]![0] as { id: ObjectID }).id).toBe(
      PROJECT_ID,
    );
    expect(savedDefault()).toEqual([
      { channel: OnCallPageChannel.SMS, notifyAfterMinutes: 0 },
    ]);
    expect(sendEventMock).toHaveBeenCalledWith("paging_ladder/default_saved", {
      step_count: 1,
    });
    expect(stepCounts).toEqual([0, 1]);
  });

  test("a step's wait changed and saved moves its channel there", async () => {
    await renderCard();

    fireEvent.click(
      within(screen.getAllByTestId("paging-ladder-wait-group")[1]!).getByTestId(
        "paging-ladder-step-wait",
      ),
    );
    fireEvent.click(screen.getByTestId("paging-ladder-wait-option-10"));
    fireEvent.click(screen.getByTestId("paging-ladder-save"));

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalled();
    });

    expect(readPagingLadderDefault(savedDefault())).toEqual(
      readPagingLadderDefault([
        ...STORED.slice(0, 2),
        { channel: OnCallPageChannel.Call, notifyAfterMinutes: 10 },
      ]),
    );
  });

  test("Turn Off Default Ladder stores none", async () => {
    await renderCard();

    fireEvent.click(screen.getByTestId("default-ladder-turn-off"));

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalled();
    });

    expect(savedDefault()).toBeNull();
    await screen.findByText(PROJECT_PAGING_DEFAULTS_COPY.noDefault);
    expect(sendEventMock).toHaveBeenCalledWith("paging_ladder/default_saved", {
      step_count: 0,
    });
  });

  test("a save the server refuses says so, and keeps the steps", async () => {
    getItemMock.mockResolvedValue({ defaultPagingLadder: null } as never);
    updateByIdMock.mockRejectedValue(
      new Error(
        "A default ladder has at most 20 steps. Remove some, then save.",
      ),
    );

    await renderCard();

    fireEvent.click(screen.getByTestId("paging-ladder-add-first"));
    fireEvent.click(
      screen.getByTestId("paging-ladder-add-option-userSmsId:SMS"),
    );
    fireEvent.click(screen.getByTestId("paging-ladder-save"));

    await screen.findByText(/at most 20 steps/);
    expect(screen.getAllByTestId("paging-ladder-step")).toHaveLength(1);
  });

  test("somebody who may not change it reads it only, and is told who can", async () => {
    canUpdateMock.mockReturnValue(false as never);

    await renderCard();

    expect(canUpdateMock).toHaveBeenCalledWith(["defaultPagingLadder"]);
    expect(screen.getAllByTestId("paging-ladder-step")).toHaveLength(3);
    expect(screen.queryByTestId("paging-ladder-add-to-step")).toBeNull();
    expect(screen.queryByTestId("paging-ladder-step-remove")).toBeNull();
    expect(screen.queryByTestId("default-ladder-turn-off")).toBeNull();
    expect(screen.getByTestId("default-ladder-read-only")).toHaveTextContent(
      PROJECT_PAGING_DEFAULTS_COPY.readOnly,
    );
  });

  test("a project that cannot be read says so, with Refresh", async () => {
    getItemMock.mockRejectedValue(new Error("The server did not answer."));

    render(
      <MemoryRouter>
        <DefaultPagingLadderCard projectId={PROJECT_ID} />
      </MemoryRouter>,
    );

    await screen.findByText(/The server did not answer/);
    expect(screen.queryByTestId("paging-ladder")).toBeNull();
  });
});

describe("what More settings' folded header says", () => {
  test("the default by its title at its place, with its step count while it has steps", () => {
    expect(DEFAULT_LADDER_PLACE).toBe("default-ladder-for-new-members");
    expect(PHONE_FOR_ON_CALL_PLACE).toBe("phone-for-people-on-call");

    expect(
      getProjectPagingDefaultsFoldedItems({
        defaultStepCount: 3,
        isPhoneAsked: false,
      }),
    ).toEqual([
      {
        key: DEFAULT_LADDER_PLACE,
        title: DEFAULT_LADDER_TITLE,
        isSet: true,
        value: "3",
      },
      {
        key: PHONE_FOR_ON_CALL_PLACE,
        title: PHONE_FOR_ON_CALL_TITLE,
        isSet: false,
      },
    ]);
  });

  test("the phone ask as On while it is on; nothing set without a default", () => {
    expect(
      getProjectPagingDefaultsFoldedItems({
        defaultStepCount: 0,
        isPhoneAsked: true,
      }),
    ).toEqual([
      {
        key: DEFAULT_LADDER_PLACE,
        title: DEFAULT_LADDER_TITLE,
        isSet: false,
      },
      {
        key: PHONE_FOR_ON_CALL_PLACE,
        title: PHONE_FOR_ON_CALL_TITLE,
        isSet: true,
        value: FOLDED_SECTION_ON,
        translateValue: true,
      },
    ]);
  });
});

describe("a default as the editor draws it", () => {
  test("each channel a default may name is a method named by its channel alone", () => {
    expect(
      getDefaultLadderChannelChoices().map(
        (choice: { channel: OnCallPageChannel; identifier: string }) => {
          return [choice.channel, choice.identifier];
        },
      ),
    ).toEqual(
      PAGING_LADDER_DEFAULT_CHANNELS.map((channel: OnCallPageChannel) => {
        return [channel, ""];
      }),
    );
  });

  test("goes from the stored default to steps and back the same", () => {
    expect(toDefaultSteps(toDefaultLadderSteps(STORED))).toEqual(
      readPagingLadderDefault(STORED),
    );
    expect(toDefaultLadderSteps(null)).toEqual([]);
  });
});
