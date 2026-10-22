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
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * DRAFT WITH AI under the Detection Rules form's Sigma YAML: one quiet
 * button until it is wanted, a description box and one action when open,
 * and the drafted YAML put into the form the way typing it would. Never
 * drawn with the project's AI off; nothing is saved by drafting.
 */

const draftMock: MockFunction = getJestMockFunction();

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseApi",
  () => {
    return {
      __esModule: true,
      default: {
        draftDetectionRule: (...args: Array<unknown>) => {
          return draftMock(...args);
        },
      },
    };
  },
);

import DetectionRuleAiDraft, {
  DETECTION_RULE_AI_DRAFT_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/DetectionRuleAiDraft";
import {
  DETECTION_RULE_AI_DRAFT_DESCRIPTION_MAX_LENGTH,
  DetectionRuleAiDraftCopy,
  canDraftDetectionRule,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/DetectionRuleAiDraftCopy";
import {
  DETECTION_RULE_DRAFT_DESCRIPTION_MAX_LENGTH,
  DETECTION_RULE_DRAFT_DESCRIPTION_MIN_LENGTH,
} from "../../../Types/SecurityEvent/DetectionRuleAiDraft";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";

const DRAFTED_YAML: string = [
  "title: Ten failed sign-ins from one address",
  "logsource:",
  "  category: authentication",
  "detection:",
  "  selection:",
  "    event.outcome: failure",
  "  condition: selection | count() by source.ip > 10",
].join("\n");

const DESCRIPTION: string =
  "Ten failed sign-ins from one IP address within five minutes";

interface Drawn {
  onDraft: ReturnType<typeof jest.fn>;
  container: HTMLElement;
}

function draw(hasRule: boolean = false): Drawn {
  const onDraft: ReturnType<typeof jest.fn> = jest.fn();
  const { container } = render(
    <DetectionRuleAiDraft
      hasRule={hasRule}
      onDraft={onDraft as unknown as (yaml: string) => void}
    />,
  );

  return { onDraft, container };
}

function openButton(): HTMLElement {
  return screen.getByTestId("detection-rule-ai-draft-open");
}

function descriptionBox(): HTMLElement {
  return screen.getByTestId("detection-rule-ai-draft-description");
}

function submitButton(): HTMLElement {
  return screen.getByTestId("detection-rule-ai-draft-submit");
}

function describeRule(text: string): void {
  fireEvent.change(descriptionBox(), { target: { value: text } });
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  });
}

beforeEach(() => {
  draftMock.mockReset();
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest
    .spyOn(ProjectUtil, "getCurrentProject")
    .mockReturnValue({ enableAi: true } as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("what may be drafted from", () => {
  test("the form's bounds are the server's", () => {
    expect(DETECTION_RULE_AI_DRAFT_DESCRIPTION_MAX_LENGTH).toBe(
      DETECTION_RULE_DRAFT_DESCRIPTION_MAX_LENGTH,
    );
  });

  test("a sentence, not a word and not a document", () => {
    expect(canDraftDetectionRule("")).toBe(false);
    expect(canDraftDetectionRule("   ")).toBe(false);
    expect(
      canDraftDetectionRule(
        "x".repeat(DETECTION_RULE_DRAFT_DESCRIPTION_MIN_LENGTH - 1),
      ),
    ).toBe(false);
    expect(
      canDraftDetectionRule(
        "x".repeat(DETECTION_RULE_DRAFT_DESCRIPTION_MIN_LENGTH),
      ),
    ).toBe(true);
    // Spaces around it do not make a short description long enough.
    expect(
      canDraftDetectionRule(
        `   ${"x".repeat(DETECTION_RULE_DRAFT_DESCRIPTION_MIN_LENGTH - 1)}   `,
      ),
    ).toBe(false);
    expect(canDraftDetectionRule(DESCRIPTION)).toBe(true);
    expect(
      canDraftDetectionRule(
        "x".repeat(DETECTION_RULE_DRAFT_DESCRIPTION_MAX_LENGTH + 1),
      ),
    ).toBe(false);
  });

  test("its words, each one the form translates", () => {
    expect(DetectionRuleAiDraftCopy).toEqual({
      openButton: "Draft with AI",
      openAgainButton: "Redraft with AI",
      label: "What should this rule catch?",
      placeholder:
        "e.g. Ten failed sign-ins from one IP address within five minutes",
      replaces: "The draft replaces the rule above.",
      draftButton: "Draft rule",
      cancelButton: "Cancel",
      drafted: "OneUptime AI wrote this rule. Read it before you save.",
      emptyDraft:
        "OneUptime AI did not write a rule. Try describing it differently.",
    });
  });
});

describe("with the project's AI off", () => {
  test("nothing is drawn", () => {
    jest
      .spyOn(ProjectUtil, "getCurrentProject")
      .mockReturnValue({ enableAi: false } as never);

    const { container } = draw();

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText("Draft with AI")).toBeNull();
  });
});

describe("closed", () => {
  test("one quiet button, and nothing asked yet", () => {
    draw();

    expect(screen.getByTestId(DETECTION_RULE_AI_DRAFT_TEST_ID)).toBeVisible();
    expect(openButton()).toHaveTextContent("Draft with AI");
    expect(openButton()).toHaveAttribute("type", "button");
    expect(
      screen.queryByTestId("detection-rule-ai-draft-description"),
    ).toBeNull();
    expect(draftMock).not.toHaveBeenCalled();
  });

  test("with a rule already in the form it offers to redraft", () => {
    draw(true);

    expect(openButton()).toHaveTextContent("Redraft with AI");
  });
});

describe("open", () => {
  test("asks what the rule should catch, in a labelled box", () => {
    draw();

    fireEvent.click(openButton());

    const box: HTMLElement = screen.getByRole("textbox", {
      name: "What should this rule catch?",
    });
    expect(box).toBe(descriptionBox());
    expect(box).toHaveAttribute(
      "placeholder",
      "e.g. Ten failed sign-ins from one IP address within five minutes",
    );
    expect(submitButton()).toHaveTextContent("Draft rule");
    // A new rule has nothing to replace.
    expect(screen.queryByText("The draft replaces the rule above.")).toBeNull();
  });

  test("says the draft replaces a rule already in the form", () => {
    draw(true);

    fireEvent.click(openButton());

    expect(
      screen.getByText("The draft replaces the rule above."),
    ).toBeVisible();
  });

  test("Draft rule waits for a sentence", () => {
    draw();

    fireEvent.click(openButton());
    expect(submitButton()).toBeDisabled();

    describeRule("too short");
    expect(submitButton()).toBeDisabled();

    describeRule(DESCRIPTION);
    expect(submitButton()).toBeEnabled();
  });

  test("a description is cut to what the server takes", () => {
    draw();

    fireEvent.click(openButton());
    describeRule("x".repeat(DETECTION_RULE_DRAFT_DESCRIPTION_MAX_LENGTH + 50));

    expect((descriptionBox() as HTMLTextAreaElement).value).toHaveLength(
      DETECTION_RULE_DRAFT_DESCRIPTION_MAX_LENGTH,
    );
    expect(submitButton()).toBeEnabled();
  });

  test("Cancel puts it away without asking", () => {
    draw();

    fireEvent.click(openButton());
    describeRule(DESCRIPTION);
    fireEvent.click(screen.getByTestId("detection-rule-ai-draft-cancel"));

    expect(openButton()).toHaveTextContent("Draft with AI");
    expect(draftMock).not.toHaveBeenCalled();
  });
});

describe("drafting", () => {
  test("the description is sent trimmed, and the drafted rule goes into the form", async () => {
    draftMock.mockResolvedValue({
      sigmaRuleYaml: DRAFTED_YAML,
      title: "Ten failed sign-ins from one address",
    });
    const { onDraft } = draw();

    fireEvent.click(openButton());
    describeRule(`  ${DESCRIPTION}  `);
    fireEvent.click(submitButton());
    await settle();

    expect(draftMock).toHaveBeenCalledTimes(1);
    expect(draftMock).toHaveBeenCalledWith(DESCRIPTION);
    expect(onDraft).toHaveBeenCalledTimes(1);
    expect(onDraft).toHaveBeenCalledWith(DRAFTED_YAML);

    // Closed again, saying who wrote it and that it is not saved yet.
    expect(
      screen.queryByTestId("detection-rule-ai-draft-description"),
    ).toBeNull();
    expect(
      screen.getByTestId("detection-rule-ai-draft-done"),
    ).toHaveTextContent(
      "OneUptime AI wrote this rule. Read it before you save.",
    );
    expect(screen.getByRole("status")).toBe(
      screen.getByTestId("detection-rule-ai-draft-done"),
    );
    expect(openButton()).toHaveTextContent("Redraft with AI");
  });

  test("a second click while drafting asks once", async () => {
    let finish: (value: unknown) => void = (): void => {};
    draftMock.mockReturnValue(
      new Promise((resolve: (value: unknown) => void) => {
        finish = resolve;
      }),
    );
    draw();

    fireEvent.click(openButton());
    describeRule(DESCRIPTION);
    fireEvent.click(submitButton());
    fireEvent.click(submitButton());

    expect(draftMock).toHaveBeenCalledTimes(1);
    expect(submitButton()).toBeDisabled();
    expect(screen.getByTestId("detection-rule-ai-draft-cancel")).toBeDisabled();

    finish({ sigmaRuleYaml: DRAFTED_YAML, title: "" });
    await settle();

    expect(draftMock).toHaveBeenCalledTimes(1);
  });

  test("no rule back is said, and the form is left as it was", async () => {
    draftMock.mockResolvedValue({ sigmaRuleYaml: "", title: "" });
    const { onDraft } = draw();

    fireEvent.click(openButton());
    describeRule(DESCRIPTION);
    fireEvent.click(submitButton());
    await settle();

    expect(onDraft).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "OneUptime AI did not write a rule. Try describing it differently.",
    );
    // Still open, with what was typed, to try again.
    expect((descriptionBox() as HTMLTextAreaElement).value).toBe(DESCRIPTION);
    expect(submitButton()).toBeEnabled();
  });

  test("a refusal from the server is said in its words", async () => {
    draftMock.mockRejectedValue(
      new Error("OneUptime AI is turned off for this project."),
    );
    const { onDraft } = draw();

    fireEvent.click(openButton());
    describeRule(DESCRIPTION);
    fireEvent.click(submitButton());
    await settle();

    expect(onDraft).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("detection-rule-ai-draft-error"),
    ).toHaveTextContent("OneUptime AI is turned off for this project.");

    // Cancel clears it: opening again starts clean.
    fireEvent.click(screen.getByTestId("detection-rule-ai-draft-cancel"));
    fireEvent.click(openButton());
    expect(screen.queryByTestId("detection-rule-ai-draft-error")).toBeNull();
  });
});
