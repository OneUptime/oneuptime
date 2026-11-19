import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE GUIDED SETUPS AND ASK AI LINK TO EACH OTHER (#7245).
 *
 *   - "Describe it instead" on a guided setup, while its first step is open
 *     and nothing is done: Ask AI opens with the setup's goal in its box,
 *     built from what the step knows (the address typed, the page's name),
 *     unsent - and only where Ask AI can answer.
 *   - "Open in guided setup" on an Ask AI setup plan's card: the guided
 *     setup that does the plan's job, its first step filled in from the
 *     plan (the address, the status page's name), opened from Ask AI
 *     (?from=ask_ai). The card stays as it was: nothing is decided.
 *   - Each sends its event (ask_ai/setup_described_instead,
 *     ask_ai/setup_opened_in_guided_setup), never a name or an address.
 *   - The words are the reader's: each sentence in every Dashboard
 *     language, the address and the name kept as written.
 */

const sendMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ProductEvents", () => {
  return {
    __esModule: true,
    default: {
      send: (...args: Array<unknown>) => {
        return sendMock(...args);
      },
    },
  };
});

const openAskAiMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/AskAiEvents",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/AskAiEvents",
    ) as Record<string, unknown>;

    return {
      ...actual,
      __esModule: true,
      openAskAi: (...args: Array<unknown>) => {
        return openAskAiMock(...args);
      },
    };
  },
);

const navigateMock: MockFunction = getJestMockFunction();

// Whether Ask AI is switched off on the server, for each test.
let isAskAiOffOnServer: boolean = false;

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/ProjectProducts/UseProjectProducts",
  () => {
    return {
      __esModule: true,
      default: () => {
        return { answer: {} };
      },
      useIsProductOffOnServer: (): boolean => {
        return isAskAiOffOnServer;
      },
    };
  },
);

// Whether the project's AI is on, for each test.
let isAiOn: boolean = true;

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/UseAiOffered", () => {
  return {
    __esModule: true,
    default: (): boolean => {
      return isAiOn;
    },
  };
});

import GuidedSetupFrame, {
  GUIDED_SETUP_DESCRIBE_IT_TEST_ID,
  GuidedSetupFrameStep,
} from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/GuidedSetupFrame";
import {
  ASK_AI_GUIDED_SETUP_COPY,
  DESCRIBE_IT_PROMPTS,
  GUIDED_SETUP_ADDRESS_QUERY,
  GUIDED_SETUP_API_QUERY,
  GUIDED_SETUP_NAME_QUERY,
  GUIDED_SETUP_PREFILL_MAX_LENGTH,
  GuidedSetupForPlan,
  getDescribeItPrompt,
  getDescribedInsteadEvent,
  getGuidedSetupForPlan,
  getGuidedSetupRoute,
  getOpenedInGuidedSetupEvent,
  readGuidedSetupPrefill,
} from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/AskAiGuidedSetupLinks";
import ToolApprovalCard from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ToolApprovalCard";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import { WEBSITE_DOWN_SETUP } from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/WebsiteDown/WebsiteDownSetup";
import { ON_CALL_SETUP } from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/OnCall/OnCallSetup";
import { STATUS_PAGE_SETUP } from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/StatusPage/StatusPageSetup";
import { TELEMETRY_SETUP } from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/Telemetry/TelemetrySetup";
import {
  AIChatToolAction,
  AIChatToolActionStatus,
} from "../../../Types/AI/AIChatTypes";
import { ProductEventName } from "../../../Types/Analytics/ProductEvent";
import { JSONObject } from "../../../Types/JSON";
import Route from "../../../Types/API/Route";
import { createTranslator, Translator } from "../../../Types/Translator";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { GuidedSetupEntryPoint } from "../../../UI/Utils/GuidedSetupEvents";
import Navigation from "../../../UI/Utils/Navigation";

const ENGLISH: Translator = createTranslator(undefined);

const DASHBOARD_LANGUAGES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
  "ar",
];

function action(
  toolName: string,
  args: JSONObject = {},
  status: AIChatToolActionStatus = AIChatToolActionStatus.Pending,
): AIChatToolAction {
  return {
    id: `call-${toolName}-${Math.random().toString(36).slice(2)}`,
    toolName: toolName,
    title: toolName,
    arguments: args,
    isMutation: true,
    requiresApproval: true,
    status: status,
  } as AIChatToolAction;
}

function sent(name: ProductEventName): Array<unknown> {
  return sendMock.mock.calls
    .filter((call: Array<unknown>): boolean => {
      return call[0] === name;
    })
    .map((call: Array<unknown>): unknown => {
      return call[1];
    });
}

beforeEach(() => {
  jest
    .spyOn(Navigation, "navigate")
    .mockImplementation((...args: Array<unknown>): void => {
      navigateMock(...args);
    });
});

afterEach(() => {
  jest.restoreAllMocks();
  cleanup();
  sendMock.mockReset();
  openAskAiMock.mockReset();
  navigateMock.mockReset();
  isAiOn = true;
  isAskAiOffOnServer = false;
});

describe("a plan's guided setup", () => {
  test("a website monitor's plan opens the website setup, with the address and whether it is an API", () => {
    const link: GuidedSetupForPlan | null = getGuidedSetupForPlan([
      action("set_up_paging", { reachMeBy: ["sms"] }),
      action("set_up_website_monitoring", {
        address: "https://api.example.com/health",
        isApi: true,
      }),
    ]);

    expect(link).toEqual({
      setup: WEBSITE_DOWN_SETUP,
      page: PageMap.MONITOR_GUIDED_SETUP,
      query: {
        [GUIDED_SETUP_ADDRESS_QUERY]: "https://api.example.com/health",
        [GUIDED_SETUP_API_QUERY]: "true",
      },
    });
  });

  test("a website monitor wins over a status page in the same plan: its setup decides who is told too", () => {
    expect(
      getGuidedSetupForPlan([
        action("publish_status_page", { monitors: ["example.com"] }),
        action("set_up_website_monitoring", { address: "example.com" }),
      ])?.setup,
    ).toBe(WEBSITE_DOWN_SETUP);
  });

  test("a status page's plan opens the status page setup, with the page's name", () => {
    expect(
      getGuidedSetupForPlan([
        action("publish_status_page", {
          name: "Acme Status",
          monitors: ["API"],
        }),
      ]),
    ).toEqual({
      setup: STATUS_PAGE_SETUP,
      page: PageMap.STATUS_PAGES_GUIDED_SETUP,
      query: { [GUIDED_SETUP_NAME_QUERY]: "Acme Status" },
    });

    // Monitors put on a page the project has: that page, by its name.
    expect(
      getGuidedSetupForPlan([
        action("add_monitors_to_status_page", {
          statusPage: "Customer Status",
          monitors: ["API"],
        }),
      ])?.query,
    ).toEqual({ [GUIDED_SETUP_NAME_QUERY]: "Customer Status" });
  });

  test("a service's monitors open the telemetry setup; paging alone, the on-call setup", () => {
    expect(
      getGuidedSetupForPlan([
        action("set_up_service_monitor", {
          service: "checkout",
          monitor: "errors",
        }),
      ]),
    ).toEqual({
      setup: TELEMETRY_SETUP,
      page: PageMap.SERVICES_GUIDED_SETUP,
      query: {},
    });

    for (const toolName of [
      "set_up_paging",
      "add_to_on_call_policy",
      "set_how_to_reach_me",
    ]) {
      expect(getGuidedSetupForPlan([action(toolName)])).toEqual({
        setup: ON_CALL_SETUP,
        page: PageMap.ON_CALL_DUTY_GUIDED_SETUP,
        query: {},
      });
    }
  });

  test("a plan that only invites people has no guided setup, and nor do answered actions or other actions", () => {
    expect(getGuidedSetupForPlan([action("invite_people")])).toBeNull();
    expect(
      getGuidedSetupForPlan([
        action(
          "set_up_website_monitoring",
          { address: "example.com" },
          AIChatToolActionStatus.Executed,
        ),
      ]),
    ).toBeNull();
    expect(getGuidedSetupForPlan([action("create_incident")])).toBeNull();
    expect(getGuidedSetupForPlan([])).toBeNull();
  });

  test("what a plan fills in is text, trimmed, and no longer than an address or a name", () => {
    const long: string = "a".repeat(GUIDED_SETUP_PREFILL_MAX_LENGTH + 50);

    expect(
      getGuidedSetupForPlan([
        action("set_up_website_monitoring", { address: `  ${long}  ` }),
      ])?.query[GUIDED_SETUP_ADDRESS_QUERY],
    ).toHaveLength(GUIDED_SETUP_PREFILL_MAX_LENGTH);
    expect(
      getGuidedSetupForPlan([
        action("set_up_website_monitoring", {
          address: { evil: true } as unknown as string,
          isApi: "true" as unknown as boolean,
        }),
      ])?.query,
    ).toEqual({});
    expect(readGuidedSetupPrefill("  example.com ")).toBe("example.com");
    expect(readGuidedSetupPrefill(null)).toBe("");
    expect(readGuidedSetupPrefill(long)).toHaveLength(
      GUIDED_SETUP_PREFILL_MAX_LENGTH,
    );
  });

  test("its address is the setup's in this project, opened from Ask AI, with what it fills in", () => {
    const route: Route = getGuidedSetupRoute({
      setup: WEBSITE_DOWN_SETUP,
      page: PageMap.MONITOR_GUIDED_SETUP,
      query: {
        [GUIDED_SETUP_ADDRESS_QUERY]: "https://example.com/a b?c=d&e",
      },
    });
    const text: string = route.toString();

    expect(text).toContain(`from=${GuidedSetupEntryPoint.AskAi}`);
    expect(text).toContain(
      `address=${encodeURIComponent("https://example.com/a b?c=d&e")}`,
    );
    expect(text.split("?")).toHaveLength(2);
    expect(text).toMatch(/\/monitors\/setup\?/);
  });

  test("its event names the setup and the plan's parts, never what they name", () => {
    const actions: Array<AIChatToolAction> = [
      action("set_up_website_monitoring", { address: "secret.example.com" }),
      action("set_up_paging", { alsoPage: ["Ana Lopez"] }),
    ];
    const event: JSONObject = getOpenedInGuidedSetupEvent({
      link: getGuidedSetupForPlan(actions)!,
      actions: actions,
    });

    expect(event).toEqual({
      setup: WEBSITE_DOWN_SETUP,
      parts: "paging.website_monitor",
    });
    expect(JSON.stringify(event)).not.toContain("secret");
    expect(JSON.stringify(event)).not.toContain("Ana");
    expect(getDescribedInsteadEvent(ON_CALL_SETUP)).toEqual({
      setup: ON_CALL_SETUP,
    });
  });
});

describe("the sentence Ask AI opens with", () => {
  test("each setup's goal, with what its first step knows", () => {
    expect(
      getDescribeItPrompt({ setup: WEBSITE_DOWN_SETUP, translator: ENGLISH }),
    ).toBe("Monitor my website and page me when it is down.");
    expect(
      getDescribeItPrompt({
        setup: WEBSITE_DOWN_SETUP,
        facts: { address: " example.com " },
        translator: ENGLISH,
      }),
    ).toBe("Monitor example.com and page me when it is down.");
    expect(
      getDescribeItPrompt({
        setup: WEBSITE_DOWN_SETUP,
        facts: { address: "https://api.example.com/health", isApi: true },
        translator: ENGLISH,
      }),
    ).toBe(
      "Monitor the API at https://api.example.com/health and page me when it is down.",
    );
    expect(
      getDescribeItPrompt({ setup: ON_CALL_SETUP, translator: ENGLISH }),
    ).toBe("Page me for every new incident and alert.");
    expect(
      getDescribeItPrompt({
        setup: STATUS_PAGE_SETUP,
        facts: { name: "Acme Status" },
        translator: ENGLISH,
      }),
    ).toBe("Publish a status page called Acme Status that shows my monitors.");
    expect(
      getDescribeItPrompt({ setup: STATUS_PAGE_SETUP, translator: ENGLISH }),
    ).toBe("Publish a status page that shows my monitors.");
    expect(
      getDescribeItPrompt({ setup: TELEMETRY_SETUP, translator: ENGLISH }),
    ).toBe(
      "Help me send my service's logs, metrics and traces to OneUptime, and alert me when it has errors.",
    );
    expect(
      getDescribeItPrompt({ setup: "two_factor", translator: ENGLISH }),
    ).toBe("");
  });

  test("in every Dashboard language, the address and the name as written", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const translator: Translator = dashboardTranslator(language);
      const english: Record<string, string> = readDashboardLocale("en");
      const words: Record<string, string> = readDashboardLocale(language);

      for (const key of [
        ...Object.values(DESCRIBE_IT_PROMPTS),
        ...Object.values(ASK_AI_GUIDED_SETUP_COPY),
      ]) {
        expect([language, key, english[key]]).toEqual([language, key, key]);
        expect([language, key, Boolean(words[key])]).toEqual([
          language,
          key,
          true,
        ]);
        expect([language, key, words[key] === key]).toEqual([
          language,
          key,
          false,
        ]);
      }

      const withAddress: string = getDescribeItPrompt({
        setup: WEBSITE_DOWN_SETUP,
        facts: { address: "example.com" },
        translator: translator,
      });

      expect([language, withAddress.includes("example.com")]).toEqual([
        language,
        true,
      ]);
      expect(withAddress).not.toBe(
        "Monitor example.com and page me when it is down.",
      );
      expect(
        getDescribeItPrompt({
          setup: STATUS_PAGE_SETUP,
          facts: { name: "Acme Status" },
          translator: translator,
        }),
      ).toContain("Acme Status");
    }
  });
});

const steps: (...done: Array<boolean>) => Array<GuidedSetupFrameStep> = (
  ...done: Array<boolean>
): Array<GuidedSetupFrameStep> => {
  return ["first", "second", "third"].map(
    (key: string, index: number): GuidedSetupFrameStep => {
      return {
        key: key,
        title: `${key} step`,
        isDone: Boolean(done[index]),
        content: <p>{key} asks</p>,
      };
    },
  );
};

function drawFrame(data: {
  steps: Array<GuidedSetupFrameStep>;
  openStepKey: string | null;
  describeItPrompt?: string | undefined;
}): void {
  render(
    <GuidedSetupFrame
      setup={WEBSITE_DOWN_SETUP}
      steps={data.steps}
      openStepKey={data.openStepKey}
      onOpenStep={() => {}}
      summary={<p>All set</p>}
      isFinished={false}
      describeItPrompt={data.describeItPrompt}
    />,
  );
}

const PROMPT: string = "Monitor example.com and page me when it is down.";

describe("Describe it instead, on a guided setup", () => {
  test("on its first step, before anything is done: Ask AI opens with the goal, unsent, and the event says which setup", () => {
    drawFrame({
      steps: steps(),
      openStepKey: "first",
      describeItPrompt: PROMPT,
    });

    const link: HTMLElement = screen.getByTestId(
      GUIDED_SETUP_DESCRIBE_IT_TEST_ID,
    );
    expect(link).toHaveTextContent("Describe it instead");
    expect(link.tagName).toBe("BUTTON");

    fireEvent.click(link);

    expect(openAskAiMock).toHaveBeenCalledWith({ prompt: PROMPT });
    expect(sent(ProductEventName.AskAiSetupDescribedInstead)).toEqual([
      { setup: WEBSITE_DOWN_SETUP },
    ]);
  });

  test("not once a step is done, nor on a later step, nor without a sentence", () => {
    drawFrame({
      steps: steps(true),
      openStepKey: "second",
      describeItPrompt: PROMPT,
    });
    expect(
      screen.queryByTestId(GUIDED_SETUP_DESCRIBE_IT_TEST_ID),
    ).not.toBeInTheDocument();
    cleanup();

    drawFrame({
      steps: steps(),
      openStepKey: "second",
      describeItPrompt: PROMPT,
    });
    expect(
      screen.queryByTestId(GUIDED_SETUP_DESCRIBE_IT_TEST_ID),
    ).not.toBeInTheDocument();
    cleanup();

    drawFrame({ steps: steps(), openStepKey: "first", describeItPrompt: " " });
    expect(
      screen.queryByTestId(GUIDED_SETUP_DESCRIBE_IT_TEST_ID),
    ).not.toBeInTheDocument();
    cleanup();

    drawFrame({ steps: steps(), openStepKey: "first" });
    expect(
      screen.queryByTestId(GUIDED_SETUP_DESCRIBE_IT_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("not where Ask AI cannot answer: AI off for the project, or Ask AI switched off on the server", () => {
    isAiOn = false;
    drawFrame({
      steps: steps(),
      openStepKey: "first",
      describeItPrompt: PROMPT,
    });
    expect(
      screen.queryByTestId(GUIDED_SETUP_DESCRIBE_IT_TEST_ID),
    ).not.toBeInTheDocument();
    cleanup();

    isAiOn = true;
    isAskAiOffOnServer = true;
    drawFrame({
      steps: steps(),
      openStepKey: "first",
      describeItPrompt: PROMPT,
    });
    expect(
      screen.queryByTestId(GUIDED_SETUP_DESCRIBE_IT_TEST_ID),
    ).not.toBeInTheDocument();
  });
});

describe("Open in guided setup, on an Ask AI setup plan's card", () => {
  const plan: Array<AIChatToolAction> = [
    action("set_up_website_monitoring", {
      address: "example.com",
      checkEveryMinutes: 1,
    }),
    action("set_up_paging", { reachMeBy: ["sms"] }),
  ];

  test("opens the guided setup for the plan, filled in, and the card stays as it was", () => {
    const onRespond: MockFunction = getJestMockFunction();

    render(
      <ToolApprovalCard
        toolActions={plan}
        interactive={true}
        isSubmitting={false}
        onRespond={onRespond as never}
      />,
    );

    const button: HTMLElement = screen.getByTestId(
      "tool-approval-open-guided-setup",
    );
    expect(button).toHaveTextContent("Open in guided setup");

    fireEvent.click(button);

    expect(navigateMock).toHaveBeenCalledTimes(1);
    const route: string = (navigateMock.mock.calls[0]![0] as Route).toString();
    expect(route).toContain("/monitors/setup?from=ask_ai");
    expect(route).toContain("address=example.com");
    expect(sent(ProductEventName.AskAiSetupOpenedInGuidedSetup)).toEqual([
      { setup: WEBSITE_DOWN_SETUP, parts: "paging.website_monitor" },
    ]);

    // Nothing was decided: the plan still waits on its card.
    expect(onRespond).not.toHaveBeenCalled();
    expect(screen.getAllByTestId("tool-approval-action")).toHaveLength(2);
  });

  test("not on a card that is no longer waiting, a plan mixed with another action, or a plan with no guided setup", () => {
    render(
      <ToolApprovalCard
        toolActions={plan}
        interactive={false}
        isSubmitting={false}
        onRespond={() => {}}
      />,
    );
    expect(
      screen.queryByTestId("tool-approval-open-guided-setup"),
    ).not.toBeInTheDocument();
    cleanup();

    render(
      <ToolApprovalCard
        toolActions={[...plan, action("create_incident", { title: "x" })]}
        interactive={true}
        isSubmitting={false}
        onRespond={() => {}}
      />,
    );
    expect(
      screen.queryByTestId("tool-approval-open-guided-setup"),
    ).not.toBeInTheDocument();
    cleanup();

    render(
      <ToolApprovalCard
        toolActions={[action("invite_people", { emails: ["a@b.example"] })]}
        interactive={true}
        isSubmitting={false}
        onRespond={() => {}}
      />,
    );
    expect(
      screen.queryByTestId("tool-approval-open-guided-setup"),
    ).not.toBeInTheDocument();
  });
});
