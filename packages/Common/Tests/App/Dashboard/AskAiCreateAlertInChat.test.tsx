import "@testing-library/jest-dom";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import * as React from "react";
import { initReactI18next } from "react-i18next";
import ChatActivityFeed from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ChatActivityFeed";
import ChatHomeView from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ChatHomeView";
import ToolApprovalCard from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ToolApprovalCard";
import WidgetRenderer from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/Widgets/WidgetRenderer";
import { describeEvidenceTool } from "../../../../App/FeatureSet/Dashboard/src/Utils/InvestigationEvidenceFormat";
import { CreateAlertTool } from "../../../Server/Utils/AI/Toolbox/AlertWriteTools";
import {
  PreparedMutation,
  ToolContext,
  ToolExecutionResult,
} from "../../../Server/Utils/AI/Toolbox/ToolTypes";
import AlertService from "../../../Server/Services/AlertService";
import AlertSeverityService from "../../../Server/Services/AlertSeverityService";
import HostService from "../../../Server/Services/HostService";
import AIRunEvent from "../../../Models/DatabaseModels/AIRunEvent";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import Host from "../../../Models/DatabaseModels/Host";
import AIChatPageContextType from "../../../Types/AI/AIChatPageContext";
import {
  AIChatToolAction,
  AIChatToolActionStatus,
} from "../../../Types/AI/AIChatTypes";
import { AIResourceType } from "../../../Types/AI/AIResourceContext";
import AIRunEventType from "../../../Types/AI/AIRunEventType";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";

/*
 * WHAT THE PERSON SEES WHEN ASK AI RAISES AN ALERT (#5301), drawn by the
 * chat's own components from what the server's create_alert hands them:
 *
 *   - the approval card: "Create alert: <title>", the host it is linked to
 *     by name ("Linked to host "test01"."), and the severity the alert
 *     takes in the argument line - never the host's ID;
 *   - the step in the chat's activity, in words in every Dashboard
 *     language ("Creating alert"), never the tool's own name;
 *   - the card under the answer once it ran: the alert by the number the
 *     person knows it by, its severity and what it is linked to;
 *   - the line an evidence list gives a run that raised one;
 *   - and Ask AI's home, which says what it can do: create incidents and
 *     alerts, in the language the rest of the home reads in.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const HOST_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ALERT_ID: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);
const LANGUAGES: Array<string> = [
  "en",
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
];

function readLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

const LOCALES: Record<string, Record<string, string>> = {};

for (const language of LANGUAGES) {
  LOCALES[language] = readLocale(language);
}

// On host test01's page, as the person who asked.
const HOST_PAGE_CONTEXT: ToolContext = {
  projectId: PROJECT_ID,
  props: { userId: ObjectID.generate(), tenantId: PROJECT_ID },
  pageContext: {
    type: AIChatPageContextType.Resource,
    resourceType: AIResourceType.Host,
    entityId: HOST_ID,
    entityTitle: "test01",
  },
};

const CALL_ARGUMENTS: { title: string; description: string } = {
  title: "High memory usage on test01",
  description: "Memory in use on test01 has been at 78% for 20 minutes.",
};

function stubTheProject(): void {
  const host: Host = new Host();
  host._id = HOST_ID;
  host.name = "test01";
  host.isArchived = false;
  jest.spyOn(HostService, "findBy").mockResolvedValue([host] as never);

  const high: AlertSeverity = new AlertSeverity();
  high._id = ObjectID.generate().toString();
  high.name = "High";
  high.order = 1;
  const low: AlertSeverity = new AlertSeverity();
  low._id = ObjectID.generate().toString();
  low.name = "Low";
  low.order = 2;
  jest
    .spyOn(AlertSeverityService, "findBy")
    .mockResolvedValue([high, low] as never);

  jest.spyOn(AlertService, "create").mockImplementation((async (args: {
    data: Alert;
  }): Promise<Alert> => {
    const created: Alert = args.data;
    created._id = ALERT_ID;
    created.alertNumber = 12;
    created.alertNumberWithPrefix = "ALT-12";
    return created;
  }) as never);
}

// The pending action as the chat runner saves it from the tool's prepare.
async function pendingAction(): Promise<AIChatToolAction> {
  const prepared: PreparedMutation = await CreateAlertTool.prepareMutation!(
    { ...CALL_ARGUMENTS },
    HOST_PAGE_CONTEXT,
  );

  return {
    id: "call-raise",
    toolName: CreateAlertTool.name,
    title:
      prepared.title || CreateAlertTool.buildActionTitle!(prepared.arguments),
    ...(prepared.description ? { description: prepared.description } : {}),
    arguments: prepared.arguments,
    isMutation: true,
    requiresApproval: true,
    status: AIChatToolActionStatus.Pending,
  };
}

function createAlertStep(): Array<AIRunEvent> {
  return [
    AIRunEventType.RunStarted,
    AIRunEventType.ToolCallStarted,
    AIRunEventType.ToolCallCompleted,
  ].map((eventType: AIRunEventType): AIRunEvent => {
    const event: AIRunEvent = new AIRunEvent(ObjectID.generate());
    event.eventType = eventType;

    if (eventType !== AIRunEventType.RunStarted) {
      event.toolName = "create_alert";
    }

    if (eventType === AIRunEventType.ToolCallCompleted) {
      event.resultSummary = { rowCount: 1 };
    }

    return event;
  });
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: Object.fromEntries(
      LANGUAGES.map((language: string) => {
        return [language, { translation: LOCALES[language]! }];
      }),
    ),
    interpolation: { escapeValue: false },
  });
});

afterEach(async () => {
  cleanup();
  jest.restoreAllMocks();
  await act(async () => {
    await i18next.changeLanguage("en");
  });
});

describe("the approval card for an alert Ask AI raises on host test01's page", () => {
  test("says what it creates, names the host it is linked to, and shows the severity it takes - never the host's ID", async () => {
    stubTheProject();
    const action: AIChatToolAction = await pendingAction();

    render(
      <ToolApprovalCard
        toolActions={[action]}
        interactive={true}
        isSubmitting={false}
        onRespond={() => {}}
      />,
    );

    expect(screen.getByTestId("tool-approval-title")).toHaveTextContent(
      "Create alert: High memory usage on test01",
    );
    expect(screen.getByTestId("tool-approval-description")).toHaveTextContent(
      'Linked to host "test01".',
    );

    const card: HTMLElement = screen.getByTestId(
      "tool-approval-description",
    ).parentElement!;
    expect(card).toHaveTextContent("severityName: High");
    expect(card).toHaveTextContent("title: High memory usage on test01");
    expect(card).not.toHaveTextContent(HOST_ID);
    expect(card).not.toHaveTextContent("affectedResources");

    // One action, the person's to allow or skip.
    expect(
      screen.getByText("The AI wants to perform 1 action"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Allow" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument();
  });

  test("allowed, it answers with the one action approved", async () => {
    stubTheProject();
    const action: AIChatToolAction = await pendingAction();
    const decisions: Array<unknown> = [];

    render(
      <ToolApprovalCard
        toolActions={[action]}
        interactive={true}
        isSubmitting={false}
        onRespond={(chosen: Array<unknown>) => {
          decisions.push(...chosen);
        }}
      />,
    );

    act(() => {
      screen.getByRole("button", { name: "Run 1 action" }).click();
    });

    expect(decisions).toEqual([{ toolCallId: "call-raise", approved: true }]);
  });

  test("once it ran, its history row keeps the title alone", async () => {
    stubTheProject();
    const action: AIChatToolAction = await pendingAction();

    render(
      <ToolApprovalCard
        toolActions={[{ ...action, status: AIChatToolActionStatus.Executed }]}
        interactive={false}
        isSubmitting={false}
        onRespond={() => {}}
      />,
    );

    expect(
      screen.getByText("Create alert: High memory usage on test01"),
    ).toBeInTheDocument();
    expect(screen.getByText("Executed")).toBeInTheDocument();
    expect(
      screen.queryByTestId("tool-approval-description"),
    ).not.toBeInTheDocument();
  });
});

describe("the step in the chat's activity", () => {
  test("reads as raising an alert, never as the tool's own name", () => {
    const { container } = render(
      <ChatActivityFeed events={createAlertStep()} hideChrome={true} />,
    );

    expect(screen.getByText("Creating alert")).toBeVisible();
    expect(container.textContent).not.toContain("create_alert");
    expect(container.textContent).not.toContain("Running");
  });

  test.each(
    LANGUAGES.filter((language: string) => {
      return language !== "en";
    }),
  )(
    "reads in %s as that language's Dashboard words it",
    async (language: string) => {
      const translated: string | undefined =
        LOCALES[language]!["Creating alert"];

      // Every Dashboard language words it: none still reads the English.
      expect(translated).toBeDefined();
      expect(translated).not.toBe("Creating alert");

      await act(async () => {
        await i18next.changeLanguage(language);
      });

      const { container } = render(
        <ChatActivityFeed events={createAlertStep()} hideChrome={true} />,
      );

      expect(screen.getByText(translated!)).toBeVisible();
      expect(container.textContent).not.toContain("create_alert");
    },
  );
});

describe("the card under the answer, once the alert is raised", () => {
  test("names the alert by its number, its severity and what it is linked to", async () => {
    stubTheProject();

    const result: ToolExecutionResult = await CreateAlertTool.execute(
      { ...CALL_ARGUMENTS, severityName: "Low" },
      HOST_PAGE_CONTEXT,
    );

    render(<WidgetRenderer widgets={[{ ...result.widget!, id: "W1" }]} />);

    expect(screen.getByText("Alert")).toBeInTheDocument();
    expect(
      screen.getByText("ALT-12 · High memory usage on test01"),
    ).toBeInTheDocument();
    expect(screen.getByText("Severity: Low")).toBeInTheDocument();

    const facts: HTMLElement = screen.getByText("Affected resources")
      .parentElement as HTMLElement;
    expect(within(facts).getByText('host "test01"')).toBeInTheDocument();
    expect(within(facts).getByText("Number")).toBeInTheDocument();
    expect(within(facts).getByText("ALT-12")).toBeInTheDocument();
    expect(within(facts).getByText("Description")).toBeInTheDocument();
    expect(facts).not.toHaveTextContent(HOST_ID);
  });
});

describe("an evidence list's line for a run that raised an alert", () => {
  test("says it created an alert, with the alerts' icon and group", () => {
    expect(describeEvidenceTool("create_alert")).toEqual({
      description: "Created an alert",
      icon: IconProp.Bell,
      category: "Alerts",
    });
  });

  test.each(
    LANGUAGES.filter((language: string) => {
      return language !== "en";
    }),
  )("every Dashboard language words it (%s)", (language: string) => {
    const translated: string | undefined =
      LOCALES[language]!["Created an alert"];

    expect(translated).toBeDefined();
    expect(translated).not.toBe("Created an alert");
  });
});

describe("Ask AI's home says it can create alerts too", () => {
  const HOME_SENTENCE: string =
    "OneUptime AI runs real queries against your logs, traces, metrics, incidents, monitors and Real User Monitoring — rendering charts and tables inline — and can create incidents and alerts or acknowledge them, always with your approval.";
  const HOME_HEADING: string = "Ask AI about your data — or tell it to act";

  function renderHome(): void {
    render(
      <ChatHomeView
        conversations={[]}
        isSending={false}
        onOpenConversation={() => {}}
        onDeleteConversation={() => {}}
        onAsk={() => {}}
      />,
    );
  }

  test("in English", () => {
    renderHome();

    expect(screen.getByText(HOME_HEADING)).toBeInTheDocument();
    expect(screen.getByText(HOME_SENTENCE)).toBeInTheDocument();
  });

  test("the sentence it replaces, which named incidents alone, is gone from every Dashboard language", () => {
    for (const language of LANGUAGES) {
      expect(
        Object.keys(LOCALES[language]!).filter((key: string): boolean => {
          return key.includes("can create incidents or acknowledge alerts");
        }),
      ).toEqual([]);
    }
  });

  /*
   * Where the home reads in the reader's language, the sentence does too;
   * where its heading is still English, so is the sentence - never one
   * translated line among English ones.
   */
  test.each(
    LANGUAGES.filter((language: string) => {
      return language !== "en";
    }),
  )("in %s, in the language its heading reads in", async (language: string) => {
    const locale: Record<string, string> = LOCALES[language]!;
    const headingIsTranslated: boolean = locale[HOME_HEADING] !== HOME_HEADING;
    const sentence: string | undefined = locale[HOME_SENTENCE];

    expect(sentence).toBeDefined();
    expect(sentence !== HOME_SENTENCE).toBe(headingIsTranslated);

    await act(async () => {
      await i18next.changeLanguage(language);
    });
    renderHome();

    expect(screen.getByText(locale[HOME_HEADING]!)).toBeInTheDocument();
    expect(screen.getByText(sentence!)).toBeInTheDocument();
  });
});
