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
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * APPLY THE PROJECT'S DEFAULT LADDER FROM ON-CALL READINESS (#7450), and a
 * responder missing the phone method their project asks for (#7449),
 * rendered for real.
 *
 *   - The action is offered only with a default, to somebody who may change
 *     anybody's rules; then any responder can be ticked - Ready ones too.
 *   - The confirmation shows the ladder and names every member ticked.
 *   - It runs one member a request, through the shared runner: each POST
 *     names one member, and the result counts who now pages by it, who was
 *     left as they were (with why) and who was not changed - and says who
 *     keeps their own steps for a way they have not verified.
 *   - A responder missing a phone method shows it beside their status, and
 *     can be reminded while Ready.
 */

const getMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const holdsAnyOfMock: MockFunction = getJestMockFunction();
const sendEventMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: (...args: Array<any>) => {
        return getMock(...args);
      },
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: unknown) => {
        return error instanceof Error ? error.message : "Could not load";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return {};
      },
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/PermissionGate", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Utils/PermissionGate",
  ) as Record<string, unknown>;
  const gate: Record<string, unknown> = actual["default"] as Record<
    string,
    unknown
  >;

  return {
    ...actual,
    __esModule: true,
    default: {
      ...gate,
      holdsAnyOf: (...args: Array<any>) => {
        return holdsAnyOfMock(...args);
      },
    },
  };
});

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

import OnCallReadinessPage from "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/Readiness";
import {
  AnsweredMember,
  getDefaultLadderItemOutcome,
  getDefaultLadderLeftOutLines,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/Readiness/ApplyDefaultLadder";
import { APPLY_DEFAULT_LADDER_COPY } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/Readiness/ApplyDefaultLadderWords";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import {
  PAGING_LADDER_ADMIN_PERMISSIONS,
  PAGING_LADDER_APPLY_DEFAULT_ROUTE,
  PagingLadderDefaultMemberResult,
  PagingLadderDefaultOutcome,
} from "../../../Types/NotificationRule/PagingLadderDefault";
import ObjectID from "../../../Types/ObjectID";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import {
  BulkItemStatus,
  BulkItemOutcome,
} from "../../../UI/Components/BulkUpdate/BulkActionRunner";
import ProjectUtil from "../../../UI/Utils/Project";
import { Translator, createTranslator } from "../../../Types/Translator";

const ADA: string = "11111111-1111-4111-8111-111111111111";
const BEN: string = "22222222-2222-4222-8222-222222222222";
const CY: string = "33333333-3333-4333-8333-333333333333";
const SEV1: string = "aaaaaaaa-1111-4111-8111-111111111111";

const coverage: (hasRule: boolean) => JSONArray = (
  hasRule: boolean,
): JSONArray => {
  return [
    NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    NotificationRuleType.ON_CALL_EXECUTED_ALERT,
  ].map((ruleType: NotificationRuleType): JSONObject => {
    return {
      ruleType: ruleType,
      severityId: SEV1,
      severityName: "Sev1",
      hasRule: hasRule,
      isOptOut: null,
    };
  });
};

const method: (methodType: string) => JSONObject = (
  methodType: string,
): JSONObject => {
  return {
    methodType: methodType,
    maskedIdentifier: "•••",
    isVerified: true,
  };
};

// Ada: Ready, by email and SMS. Ben: Ready, by email alone, in a project that asks for a phone. Cy: nothing verified.
const ADA_READY: JSONObject = {
  userId: ADA,
  userName: "Ada Lopez",
  userEmail: "ada@example.com",
  status: "Ready",
  methods: [method("Email"), method("SMS")],
  coverage: coverage(true),
  reasons: [],
  reachedVia: ["Direct"],
  teams: [],
};

const BEN_NO_PHONE: JSONObject = {
  userId: BEN,
  userName: "Ben Ito",
  userEmail: "ben@example.com",
  status: "Ready",
  methods: [method("Email")],
  coverage: coverage(true),
  reasons: [
    "No verified phone method (SMS, phone call or WhatsApp) - this project asks everyone on call to add one",
  ],
  isMissingPhoneMethod: true,
  reachedVia: ["Direct"],
  teams: [],
};

const CY_UNREACHABLE: JSONObject = {
  userId: CY,
  userName: "Cy Unreachable",
  userEmail: "cy@example.com",
  status: "NotReachable",
  methods: [],
  coverage: coverage(false),
  reasons: ["No verified notification method - cannot be paged"],
  reachedVia: ["Direct"],
  teams: [],
};

const DEFAULT_LADDER: JSONArray = [
  { channel: OnCallPageChannel.Push, notifyAfterMinutes: 0 },
  { channel: OnCallPageChannel.SMS, notifyAfterMinutes: 0 },
  { channel: OnCallPageChannel.Call, notifyAfterMinutes: 5 },
];

const respondWithUsers: (users: JSONArray) => void = (
  users: JSONArray,
): void => {
  getMock.mockResolvedValue(
    new HTTPResponse<JSONObject>(
      200,
      {
        projectId: "44444444-4444-4444-8444-444444444444",
        isFallbackEnabled: true,
        readyCount: 0,
        partiallyReadyCount: 0,
        notReachableCount: 0,
        users: users,
        hasMore: false,
        totalCount: users.length,
        isTruncated: false,
      },
      {},
    ) as never,
  );
};

const withDefault: (defaultPagingLadder: unknown) => void = (
  defaultPagingLadder: unknown,
): void => {
  getItemMock.mockResolvedValue({
    defaultPagingLadder: defaultPagingLadder,
  } as never);
};

// The server's answer for one member, by who they are.
const ANSWERS: Record<string, JSONObject> = {
  [ADA]: {
    userId: ADA,
    outcome: PagingLadderDefaultOutcome.Applied,
    appliedSteps: [{ channel: OnCallPageChannel.SMS, notifyAfterMinutes: 0 }],
    leftOutChannels: [OnCallPageChannel.Push, OnCallPageChannel.Call],
    keptChannels: [OnCallPageChannel.Email],
    changedRuleCount: 6,
    message: "Applied.",
  },
  [BEN]: {
    userId: BEN,
    outcome: PagingLadderDefaultOutcome.Skipped,
    appliedSteps: [],
    leftOutChannels: [
      OnCallPageChannel.Push,
      OnCallPageChannel.SMS,
      OnCallPageChannel.Call,
    ],
    keptChannels: [],
    changedRuleCount: 0,
    message: "Skipped.",
  },
  [CY]: {
    userId: CY,
    outcome: PagingLadderDefaultOutcome.Failed,
    appliedSteps: [],
    leftOutChannels: [],
    keptChannels: [],
    changedRuleCount: 0,
    message:
      "Cannot create a notification rule for this user because they are not a member of this project.",
  },
};

const renderPage: () => Promise<void> = async (): Promise<void> => {
  render(
    <OnCallReadinessPage
      pageRoute={new Route("/dashboard/on-call-duty/readiness")}
      currentProject={null}
      hasPaymentMethod={false}
    />,
  );

  await screen.findByText("Ada Lopez");
};

const tick: (name: string) => void = (name: string): void => {
  fireEvent.click(screen.getByLabelText(`Select ${name}`));
};

const openBulkMenu: () => void = (): void => {
  fireEvent.click(screen.getByText("Bulk Actions"));
};

const applyPosts: () => Array<JSONObject> = (): Array<JSONObject> => {
  return postMock.mock.calls
    .filter((call: Array<unknown>): boolean => {
      return String(
        (call[0] as { url: { toString: () => string } }).url,
      ).includes(PAGING_LADDER_APPLY_DEFAULT_ROUTE);
    })
    .map((call: Array<unknown>): JSONObject => {
      return (call[0] as { data: JSONObject }).data;
    });
};

beforeEach((): void => {
  getMock.mockReset();
  postMock.mockReset();
  getItemMock.mockReset();
  holdsAnyOfMock.mockReset();
  sendEventMock.mockReset();

  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID("44444444-4444-4444-8444-444444444444"));

  respondWithUsers([ADA_READY, BEN_NO_PHONE, CY_UNREACHABLE]);
  withDefault(DEFAULT_LADDER);
  holdsAnyOfMock.mockReturnValue(true as never);

  postMock.mockImplementation((async (request: {
    url: { toString: () => string };
    data: JSONObject;
  }) => {
    const userId: string = (request.data["userIds"] as Array<string>)[0]!;

    return new HTTPResponse<JSONObject>(
      200,
      { results: [ANSWERS[userId]!] },
      {},
    );
  }) as never);
});

afterEach((): void => {
  cleanup();
  jest.restoreAllMocks();
});

describe("who is offered Apply Default Ladder", () => {
  test("somebody who may change anybody's rules, in a project with a default: any responder can be ticked, Ready ones too", async () => {
    await renderPage();

    await waitFor((): void => {
      expect(
        screen.getByText(APPLY_DEFAULT_LADDER_COPY.tickHint),
      ).toBeInTheDocument();
    });

    // Ada is Ready, with nothing to be reminded of: tickable for the ladder.
    expect(screen.getByLabelText("Select Ada Lopez")).not.toBeDisabled();

    tick("Ada Lopez");
    openBulkMenu();

    expect(
      screen.getByRole("menuitem", { name: APPLY_DEFAULT_LADDER_COPY.action }),
    ).toBeInTheDocument();
    // Ada alone has nothing to be reminded of: no reminder is offered for her.
    expect(
      screen.queryByRole("menuitem", { name: "Send setup reminder" }),
    ).toBeNull();

    // The permissions asked are the ladder's admins'.
    expect(holdsAnyOfMock).toHaveBeenCalledWith([
      ...PAGING_LADDER_ADMIN_PERMISSIONS,
    ]);
  });

  test("somebody who may not: nothing is offered, and a Ready responder stays locked", async () => {
    holdsAnyOfMock.mockReturnValue(false as never);

    await renderPage();

    await waitFor((): void => {
      expect(getItemMock).toHaveBeenCalled();
    });

    expect(screen.getByLabelText("Select Ada Lopez")).toBeDisabled();

    tick("Cy Unreachable");
    openBulkMenu();

    expect(
      screen.queryByRole("menuitem", {
        name: APPLY_DEFAULT_LADDER_COPY.action,
      }),
    ).toBeNull();
  });

  test.each([
    ["no default", null],
    ["an empty default", []],
  ])(
    "a project with %s: nothing is offered",
    async (_name: string, value: unknown): Promise<void> => {
      withDefault(value);

      await renderPage();

      await waitFor((): void => {
        expect(getItemMock).toHaveBeenCalled();
      });

      tick("Cy Unreachable");
      openBulkMenu();

      expect(
        screen.queryByRole("menuitem", {
          name: APPLY_DEFAULT_LADDER_COPY.action,
        }),
      ).toBeNull();
    },
  );

  test("a default that cannot be read offers nothing, and the page reads as it did", async () => {
    getItemMock.mockRejectedValue(new Error("Could not read the project."));

    await renderPage();

    expect(screen.getByLabelText("Select Ada Lopez")).toBeDisabled();
    expect(screen.queryByText("Could not read the project.")).toBeNull();
  });
});

describe("applying it", () => {
  const pickAllAndConfirm: () => Promise<HTMLElement> =
    async (): Promise<HTMLElement> => {
      await renderPage();

      await waitFor((): void => {
        expect(screen.getByLabelText("Select Ada Lopez")).not.toBeDisabled();
      });

      tick("Ada Lopez");
      tick("Ben Ito");
      tick("Cy Unreachable");
      openBulkMenu();
      fireEvent.click(
        screen.getByRole("menuitem", {
          name: APPLY_DEFAULT_LADDER_COPY.action,
        }),
      );

      return screen.getByTestId("modal");
    };

  test("the confirmation shows the ladder and names every member", async () => {
    const modal: HTMLElement = await pickAllAndConfirm();

    expect(
      within(modal).getByText("Apply the default ladder to 3 members?"),
    ).toBeInTheDocument();
    expect(
      within(modal).getByText(APPLY_DEFAULT_LADDER_COPY.question),
    ).toBeInTheDocument();

    const members: HTMLElement = within(modal).getByTestId(
      "apply-default-ladder-members",
    );

    expect(
      within(members)
        .getAllByRole("listitem")
        .map((item: HTMLElement): string => {
          return item.textContent || "";
        })
        .sort(),
    ).toEqual(["Ada Lopez", "Ben Ito", "Cy Unreachable"]);

    // The ladder, step by step, by channel: never anybody's number.
    expect(
      within(modal).getAllByTestId("paging-ladder-step-chip"),
    ).toHaveLength(3);
    expect(modal.textContent).not.toMatch(/@example\.com/);

    // Nothing is sent until it is confirmed.
    expect(applyPosts()).toEqual([]);
  });

  test("one member a request; the result says who now pages by it, who was left as they were, and who was not changed", async () => {
    const modal: HTMLElement = await pickAllAndConfirm();

    fireEvent.click(
      within(modal).getByRole("button", {
        name: APPLY_DEFAULT_LADDER_COPY.action,
      }),
    );

    await waitFor((): void => {
      expect(applyPosts()).toHaveLength(3);
    });

    // Each request names exactly one member.
    expect(
      applyPosts()
        .map((body: JSONObject): Array<string> => {
          return body["userIds"] as Array<string>;
        })
        .sort(),
    ).toEqual([[ADA], [BEN], [CY]].sort());

    await screen.findByText("1 member now pages by the default ladder");

    expect(screen.getByText("1 member left as they were")).toBeInTheDocument();
    expect(screen.getByText("1 member not changed")).toBeInTheDocument();
    // Why Ben was left as he was, and why Cy was not changed, in their words.
    expect(
      screen.getByText(APPLY_DEFAULT_LADDER_COPY.skipped),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/not a member of this project/),
    ).toBeInTheDocument();

    // Ada lacks push and calls: she keeps her own email steps meanwhile.
    expect(
      screen.getByTestId("apply-default-ladder-left-out"),
    ).toHaveTextContent(
      "Ada Lopez has not verified push notification, phone call yet, so those steps were left out, and they keep their own email steps meanwhile.",
    );

    expect(sendEventMock).toHaveBeenCalledWith(
      "paging_ladder/default_applied",
      {
        member_count: 3,
        applied_count: 1,
        skipped_count: 1,
        failed_count: 1,
      },
    );
  });

  test("afterwards the list is read again, as Refresh reads it", async () => {
    const modal: HTMLElement = await pickAllAndConfirm();
    const readsBefore: number = getMock.mock.calls.length;

    fireEvent.click(
      within(modal).getByRole("button", {
        name: APPLY_DEFAULT_LADDER_COPY.action,
      }),
    );

    await waitFor((): void => {
      expect(getMock.mock.calls.length).toBeGreaterThan(readsBefore);
    });
  });
});

describe("a responder missing the phone method their project asks for", () => {
  test("shows it beside their status, and can be reminded while Ready", async () => {
    holdsAnyOfMock.mockReturnValue(false as never);

    await renderPage();

    expect(
      screen.getAllByTestId("readiness-no-phone-method").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(APPLY_DEFAULT_LADDER_COPY.noPhone).length,
    ).toBeGreaterThan(0);

    // Ready, yet something to set up: remindable even without the ladder.
    expect(screen.getByLabelText("Select Ben Ito")).not.toBeDisabled();
    expect(screen.getByLabelText("Select Ada Lopez")).toBeDisabled();

    tick("Ben Ito");
    openBulkMenu();

    expect(
      screen.getByRole("menuitem", { name: "Send setup reminder" }),
    ).toBeInTheDocument();
  });
});

describe("one member's answer, as the run's outcome", () => {
  const translator: Translator = createTranslator(undefined, "en");

  const result: (
    overrides: Partial<PagingLadderDefaultMemberResult>,
  ) => PagingLadderDefaultMemberResult = (
    overrides: Partial<PagingLadderDefaultMemberResult>,
  ): PagingLadderDefaultMemberResult => {
    return {
      userId: ADA,
      outcome: PagingLadderDefaultOutcome.Applied,
      appliedSteps: [],
      leftOutChannels: [],
      keptChannels: [],
      changedRuleCount: 3,
      message: "Applied.",
      ...overrides,
    };
  };

  test("applied with rows written: changed", () => {
    expect(getDefaultLadderItemOutcome(translator, result({})).status).toBe(
      BulkItemStatus.Changed,
    );
  });

  test("applied with nothing to write: left as they were, already on it", () => {
    const outcome: BulkItemOutcome = getDefaultLadderItemOutcome(
      translator,
      result({ changedRuleCount: 0 }),
    );

    expect(outcome).toEqual({
      status: BulkItemStatus.Unchanged,
      reason: APPLY_DEFAULT_LADDER_COPY.alreadyOnIt,
    });
  });

  test("skipped: left as they were, and why", () => {
    expect(
      getDefaultLadderItemOutcome(
        translator,
        result({ outcome: PagingLadderDefaultOutcome.Skipped }),
      ),
    ).toEqual({
      status: BulkItemStatus.Unchanged,
      reason: APPLY_DEFAULT_LADDER_COPY.skipped,
    });
  });

  test("failed: thrown in the server's words, so the runner lists it as failed", () => {
    expect(() => {
      getDefaultLadderItemOutcome(
        translator,
        result({
          outcome: PagingLadderDefaultOutcome.Failed,
          message: "Not a member.",
        }),
      );
    }).toThrow("Not a member.");
  });

  test("only a member it was applied to who lacks a way gets a line; a custom channel is never named as kept", () => {
    const answered: Array<AnsweredMember> = [
      {
        name: "Ada Lopez",
        result: result({
          leftOutChannels: [OnCallPageChannel.SMS],
          keptChannels: [OnCallPageChannel.CustomChannel],
        }),
      },
      { name: "Ben Ito", result: result({}) },
      {
        name: "Cy Unreachable",
        result: result({
          outcome: PagingLadderDefaultOutcome.Skipped,
          leftOutChannels: [OnCallPageChannel.SMS],
        }),
      },
    ];

    expect(getDefaultLadderLeftOutLines(translator, answered)).toEqual([
      "Ada Lopez has not verified SMS yet, so those steps were left out.",
    ]);
  });
});
