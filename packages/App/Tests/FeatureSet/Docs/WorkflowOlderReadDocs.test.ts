import { DOCS_LANGUAGES, readPage } from "./DocsContentSupport";
import { dashboardLocale } from "./DocsDashboardLabels";
import {
  AI_ACTION_LINES,
  aiActionSentence,
  describeAIActionSentence,
} from "Common/Types/AI/AIActionWords";
import AIChatPermissionMode, {
  AIChatPermissionModeHelper,
  AIChatPermissionModeOption,
} from "Common/Types/AI/AIChatPermissionMode";
import { createTranslator, Translator } from "Common/Types/Translator";
import ComponentMetadata from "Common/Types/Workflow/Component";
import ComponentID from "Common/Types/Workflow/ComponentID";
import Components from "Common/Types/Workflow/Components";
import { JSONObject } from "Common/Types/JSON";
import {
  WorkflowDraft,
  buildGraphFromDraft,
} from "Common/Types/Workflow/WorkflowDraft";
import {
  WorkflowPartSeen,
  findWorkflowStepsUndoneUnseen,
  seeWorkflowParts,
} from "Common/Types/Workflow/WorkflowDraftSeen";
import { describe, expect, it } from "@jest/globals";

/*
 * What the authoring page says about a change Ask AI drafted from an older
 * read of the workflow (issue #6291), in every docs language: the card line
 * it quotes is the one that language's Dashboard draws, with the step's name
 * as the card writes it, and the mode it names is the Dashboard's own. The
 * English is held to the code that makes it true.
 */

const COMPONENTS: Map<string, ComponentMetadata> = new Map<
  string,
  ComponentMetadata
>(
  (Components as Array<ComponentMetadata>).map(
    (component: ComponentMetadata): [string, ComponentMetadata] => {
      return [component.id, component];
    },
  ),
);

const getComponent: (id: string) => ComponentMetadata | undefined = (
  id: string,
): ComponentMetadata | undefined => {
  return COMPONENTS.get(id);
};

// The step the example names, by the title the card gives it.
const SLACK_TITLE: string = getComponent(
  ComponentID.SlackSendMessageToChannel,
)!.title;

const translatorFor: (language: string) => Translator = (
  language: string,
): Translator => {
  const words: Record<string, unknown> = dashboardLocale(language);

  return createTranslator((text: string): string | undefined => {
    const value: unknown = words[text];
    return typeof value === "string" ? value : undefined;
  }, language);
};

// The paragraph about Ask AI building and changing workflows.
const askAiParagraphOf: (language: string) => string = (
  language: string,
): string => {
  return (
    readPage(language, "workflows/authoring")
      .split("\n")
      .find((line: string): boolean => {
        return line.includes("Ask AI") && line.includes(SLACK_TITLE);
      }) || ""
  );
};

const autoRunTitle: string = (
  AIChatPermissionModeHelper.getOptions().find(
    (option: AIChatPermissionModeOption): boolean => {
      return option.value === AIChatPermissionMode.AutoRun;
    },
  ) as AIChatPermissionModeOption
).title;

describe("the authoring page on a change drafted from an older read (issue #6291)", () => {
  it("quotes the card line as the English card says it, and says what counts, what the never-read card says and what Auto-run does", () => {
    const paragraph: string = askAiParagraphOf("en");
    const line: string = describeAIActionSentence(
      aiActionSentence(AI_ACTION_LINES.workflowUndoesSavedSince, {
        steps: SLACK_TITLE,
      }),
    );

    expect(line).toBe(
      "This change undoes what was saved after Ask AI read the workflow: Send Message to Slack.",
    );
    expect(paragraph).toContain(`"${line}"`);
    expect(paragraph).toContain(
      "Ask AI writes a change from the workflow as it last read it.",
    );
    expect(paragraph).toContain(
      "To keep what was saved, skip the change and ask Ask AI to read the workflow again.",
    );
    expect(paragraph).toContain(
      "Moving cards never counts, and nor does a setting changed on a step that Ask AI's change leaves as it is.",
    );
    expect(paragraph).toContain(
      "If Ask AI never read the workflow's steps, the card says that too.",
    );
    expect(paragraph).toContain(
      `In ${autoRunTitle}, where nobody approves actions, Ask AI does not make such a change: it reads the workflow again and makes its change on the workflow as it is now.`,
    );
    expect(AI_ACTION_LINES.workflowNotRead).toBe(
      "Ask AI wrote this change without reading the workflow's steps, so it may remove or change steps it has not seen.",
    );
  });

  it("is true of the code: a step added after the read is named, a moved card and a setting the change keeps are not", () => {
    let nextId: number = 0;
    const generateId: () => string = (): string => {
      nextId++;
      return `docs-${nextId}`;
    };
    const digest: (text: string) => string = (text: string): string => {
      return text;
    };
    const read: WorkflowDraft = {
      steps: [
        { id: "manual-1", componentId: ComponentID.Manual },
        { id: "log-1", componentId: ComponentID.Log, arguments: { value: "a" } },
      ],
      connections: [{ from: "manual-1", to: "log-1" }],
    };
    const readGraph: JSONObject = buildGraphFromDraft({
      draft: read,
      getComponent,
      generateId,
    });
    const seen: Map<string, string | null> = new Map<string, string | null>(
      seeWorkflowParts({ graph: readGraph, digest }).map(
        (part: WorkflowPartSeen): [string, string | null] => {
          return [part.id, part.fingerprint];
        },
      ),
    );

    // Ask AI's change, from its read: another Log after the first.
    const change: WorkflowDraft = {
      steps: [
        ...read.steps.map((step: WorkflowDraft["steps"][number]) => {
          // A step it does not change, written without its settings.
          return step.id === "log-1"
            ? { id: step.id, componentId: step.componentId }
            : step;
        }),
        { id: "log-2", componentId: ComponentID.Log, arguments: { value: "b" } },
      ],
      connections: [...read.connections, { from: "log-1", to: "log-2" }],
    };

    const namedOver: (now: JSONObject) => Array<string> = (
      now: JSONObject,
    ): Array<string> => {
      return findWorkflowStepsUndoneUnseen({
        seen,
        graph: now,
        changed: buildGraphFromDraft({
          draft: change,
          getComponent,
          generateId,
          existingGraph: now,
        }),
        digest,
      }).namedStepIds;
    };

    // Someone adds a Slack message in the Builder after the read.
    const withSlack: JSONObject = buildGraphFromDraft({
      draft: {
        steps: [
          ...read.steps,
          {
            id: "slack-1",
            componentId: ComponentID.SlackSendMessageToChannel,
            arguments: { text: "deployed" },
          },
        ],
        connections: [...read.connections, { from: "log-1", to: "slack-1" }],
      },
      getComponent,
      generateId,
      existingGraph: readGraph,
    });
    expect(namedOver(withSlack)).toEqual(["slack-1"]);

    // A card moved: nothing.
    const moved: JSONObject = JSON.parse(JSON.stringify(readGraph)) as JSONObject;
    (moved["nodes"] as Array<JSONObject>)[1]!["position"] = { x: 1, y: 2 };
    expect(namedOver(moved)).toEqual([]);

    // A setting changed on the step the change keeps as it is: nothing.
    const setting: JSONObject = JSON.parse(JSON.stringify(readGraph)) as JSONObject;
    (
      ((setting["nodes"] as Array<JSONObject>)[1]!["data"] as JSONObject)
    )["arguments"] = { value: "theirs" };
    expect(namedOver(setting)).toEqual([]);
  });

  describe.each(DOCS_LANGUAGES)("%s", (language: string) => {
    it("quotes the card line as its Dashboard draws it, the step named as the card writes it", () => {
      const line: string = describeAIActionSentence(
        aiActionSentence(AI_ACTION_LINES.workflowUndoesSavedSince, {
          steps: SLACK_TITLE,
        }),
        translatorFor(language),
      );

      // Worded in the language, never the English sentence.
      if (language !== "en") {
        expect(line).not.toContain("This change undoes");
      }
      expect(line).toContain(SLACK_TITLE);
      expect(askAiParagraphOf(language)).toContain(line);
    });

    it("names Auto-run as its Dashboard does", () => {
      const label: unknown = dashboardLocale(language)[autoRunTitle];

      expect(typeof label).toBe("string");
      expect(askAiParagraphOf(language)).toContain(label as string);
    });
  });
});
