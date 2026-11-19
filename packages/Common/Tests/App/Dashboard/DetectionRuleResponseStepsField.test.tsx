import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock } from "jest-mock";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import * as React from "react";

/*
 * A detection rule's response steps on its form (#9621): each step a line -
 * the part of the case's Response Plan it goes under, in the plan's words,
 * and what to do - with Add Step for one more and a bin to take one out. A
 * rule from the library shows the steps it comes with, saying so, until
 * one is changed; a rule carries at most ten. Its author puts them in order
 * (#9796): listed under their parts as the case's plan reads them, a step
 * moves among its part's steps by Move Up and Move Down, or dragged by its
 * grip, from the keyboard too, always keeping its id.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
        i18n: { language: "en" },
      };
    },
  };
});

import DetectionRuleResponseStepsField, {
  getResponseStepPartOptions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/ResponseSteps/DetectionRuleResponseStepsField";
import { DETECTION_RULE_RESPONSE_STEPS_TEST_IDS as IDS } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/ResponseSteps/DetectionRuleResponseStepsCopy";
import { getResponseStepsInPlanOrder } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/ResponseSteps/DetectionRuleResponseStepsModel";
import {
  DETECTION_RULE_RESPONSE_STEPS_MAX,
  DetectionRuleResponsePhase,
  DetectionRuleResponseStep,
  getDetectionRuleResponseStepKey,
} from "../../../Types/SecurityEvent/DetectionRuleResponseSteps";
import {
  getDetectionRuleLibraryIdsWithSteps,
  getDetectionRuleLibraryResponseSteps,
} from "../../../Types/SecurityEvent/DetectionRuleLibraryResponseSteps";
import { DRAG_HANDLE_USAGE_INSTRUCTIONS } from "../../../UI/Components/Table/Table";

const BRUTE_FORCE_ID: string = "acf2a37e-301a-46de-87c7-d4343f3a8445";
const BRUTE_FORCE_YAML: string = `title: Brute force from one IP address\nid: ${BRUTE_FORCE_ID}\n`;
const OWN_YAML: string = "title: Our own rule\n";

// What the field hands its form: the steps, as they are now.
type OnChangeMock = Mock<(steps: Array<DetectionRuleResponseStep>) => void>;

const PAGE: DetectionRuleResponseStep = {
  id: "page-payments",
  phase: DetectionRuleResponsePhase.Contain,
  text: "Page the payments on-call.",
};

function draw(data: {
  value: unknown;
  sigmaRuleYaml?: string;
  error?: string;
}): OnChangeMock {
  const onChange: OnChangeMock =
    jest.fn<(steps: Array<DetectionRuleResponseStep>) => void>();

  render(
    <DetectionRuleResponseStepsField
      value={data.value}
      sigmaRuleYaml={data.sigmaRuleYaml ?? OWN_YAML}
      error={data.error}
      onChange={onChange}
    />,
  );

  return onChange;
}

function lastChange(onChange: OnChangeMock): Array<DetectionRuleResponseStep> {
  return onChange.mock.calls[onChange.mock.calls.length - 1]![0];
}

afterEach(() => {
  cleanup();
});

describe("a rule's response steps on its form", () => {
  test("a step goes under one of the plan's parts, in the plan's words", () => {
    expect(getResponseStepPartOptions()).toEqual([
      { value: "Confirm", label: "Confirm it is real" },
      { value: "Contain", label: "Contain it" },
      { value: "Fix", label: "Fix what let it happen" },
    ]);
  });

  test("none yet says what a case gets instead, with Add Step", () => {
    draw({ value: [] });

    expect(screen.getByTestId(IDS.empty)).toHaveTextContent(
      "No response steps. A case this rule opens shows the general steps.",
    );
    expect(screen.getByTestId(IDS.add)).toHaveTextContent("Add Step");
    expect(screen.queryByTestId(IDS.fromLibrary)).toBeNull();
  });

  test("Add Step puts a line in under Contain it, with an id of its own", () => {
    const onChange: OnChangeMock = draw({ value: [PAGE] });

    fireEvent.click(screen.getByTestId(IDS.add));

    const steps: Array<DetectionRuleResponseStep> = lastChange(onChange);

    expect(steps).toHaveLength(2);
    expect(steps[0]).toEqual(PAGE);
    expect(steps[1]).toMatchObject({ phase: "Contain", text: "" });
    expect(steps[1]!.id).not.toBe(PAGE.id);
  });

  test("its words are typed into its line, at most 300 characters, its id kept", () => {
    const onChange: OnChangeMock = draw({ value: [PAGE] });
    const input: HTMLInputElement = screen.getByTestId(
      `${IDS.text}-0`,
    ) as HTMLInputElement;

    expect(input).toHaveValue("Page the payments on-call.");
    expect(input).toHaveAttribute("maxLength", "300");
    expect(input).toHaveAttribute("aria-label", "What to do in step 1");

    fireEvent.change(input, {
      target: { value: "Page the payments on-call now." },
    });

    expect(lastChange(onChange)).toEqual([
      { ...PAGE, text: "Page the payments on-call now." },
    ]);
  });

  test("a line's bin takes it out, named by its number", () => {
    const onChange: OnChangeMock = draw({
      value: [PAGE, { ...PAGE, id: "second", text: "Second" }],
    });
    const remove: HTMLElement = screen.getByTestId(`${IDS.remove}-1`);

    expect(remove).toHaveAttribute("aria-label", "Remove step 2");

    fireEvent.click(remove);

    expect(lastChange(onChange)).toEqual([PAGE]);
  });

  test("a rule from the library shows the steps it comes with, saying so; changing one makes them its own", () => {
    const library: Array<DetectionRuleResponseStep> =
      getDetectionRuleLibraryResponseSteps(BRUTE_FORCE_ID);
    const onChange: OnChangeMock = draw({
      value: null,
      sigmaRuleYaml: BRUTE_FORCE_YAML,
    });

    expect(screen.getByTestId(IDS.fromLibrary)).toHaveTextContent(
      "These steps come with this rule in the rule library.",
    );
    expect(screen.getByTestId(`${IDS.text}-0`)).toHaveValue(library[0]!.text);
    // Shown, not written: nothing changes until the author does.
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId(`${IDS.remove}-0`));

    expect(lastChange(onChange)).toEqual(library.slice(1));
  });

  test("ten steps are the most: Add Step is locked, saying why", () => {
    const steps: Array<DetectionRuleResponseStep> = Array.from(
      { length: DETECTION_RULE_RESPONSE_STEPS_MAX },
      (_: unknown, index: number): DetectionRuleResponseStep => {
        return { ...PAGE, id: `step-${index}` };
      },
    );

    draw({ value: steps });

    expect(screen.getByTestId(IDS.add)).toBeDisabled();
  });

  test("what is wrong with the steps is said under them", () => {
    draw({
      value: [PAGE],
      error: "A response step can be at most 300 characters.",
    });

    expect(
      screen.getByText("A response step can be at most 300 characters."),
    ).toBeInTheDocument();
  });
});

/*
 * Putting the steps in order (#9796). The field is drawn as the rule form
 * draws it: the steps it hands back come back to it as its value.
 */
describe("putting a rule's steps in order", () => {
  const CHECK: DetectionRuleResponseStep = {
    id: "check-audit-log",
    phase: DetectionRuleResponsePhase.Confirm,
    text: "Check the admin audit log in the billing app.",
  };
  const ROTATE: DetectionRuleResponseStep = {
    id: "rotate-key",
    phase: DetectionRuleResponsePhase.Contain,
    text: "Rotate the key in Vault.",
  };
  const NOTIFY: DetectionRuleResponseStep = {
    id: "notify-owner",
    phase: DetectionRuleResponsePhase.Contain,
    text: "Tell the service's owner.",
  };
  const PATCH: DetectionRuleResponseStep = {
    id: "patch-library",
    phase: DetectionRuleResponsePhase.Fix,
    text: "Patch the library it came in through.",
  };

  // The form, as the rule's form holds the field: what it hands back is its value.
  function Form(props: {
    initial: unknown;
    sigmaRuleYaml?: string | undefined;
    onChange: OnChangeMock;
  }): React.ReactElement {
    const [value, setValue] = React.useState<unknown>(props.initial);

    return (
      <DetectionRuleResponseStepsField
        value={value}
        sigmaRuleYaml={props.sigmaRuleYaml ?? OWN_YAML}
        onChange={(steps: Array<DetectionRuleResponseStep>) => {
          props.onChange(steps);
          setValue(steps);
        }}
      />
    );
  }

  function drawForm(
    initial: unknown,
    sigmaRuleYaml?: string | undefined,
  ): { onChange: OnChangeMock; user: UserEvent } {
    const onChange: OnChangeMock =
      jest.fn<(steps: Array<DetectionRuleResponseStep>) => void>();

    render(
      <Form
        initial={initial}
        sigmaRuleYaml={sigmaRuleYaml}
        onChange={onChange}
      />,
    );

    return { onChange, user: userEvent.setup({ delay: null }) };
  }

  function ids(steps: Array<DetectionRuleResponseStep>): Array<string> {
    return steps.map((step: DetectionRuleResponseStep): string => {
      return step.id;
    });
  }

  // The words of each line, top to bottom.
  function shownTexts(): Array<string> {
    return screen
      .getAllByRole("textbox", { name: /^What to do in step/ })
      .map((input: HTMLElement): string => {
        return (input as HTMLInputElement).value;
      });
  }

  // react-beautiful-dnd arrives a moment after the field (DragAndDropLoader).
  async function waitForDragging(): Promise<void> {
    await act(async () => {
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 50);
      });
    });
  }

  async function press(element: HTMLElement, key: string): Promise<void> {
    const keyCodes: Record<string, number> = {
      " ": 32,
      ArrowUp: 38,
      ArrowDown: 40,
    };

    await act(async () => {
      fireEvent.keyDown(element, { key, keyCode: keyCodes[key] });
    });
    await act(async () => {
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 30);
      });
    });
  }

  test("lists the steps under their parts, as the case's plan reads them, without writing anything", () => {
    const { onChange } = drawForm([PAGE, CHECK, PATCH, ROTATE]);

    const parts: Array<HTMLElement> = screen.getAllByTestId(
      new RegExp(`^${IDS.fieldPart}-`),
    );

    expect(
      parts.map((part: HTMLElement): string => {
        return within(part).getByRole("heading").textContent || "";
      }),
    ).toEqual(["Confirm it is real", "Contain it", "Fix what let it happen"]);
    expect(within(parts[1]!).getByRole("list")).toHaveAccessibleName(
      "Contain it",
    );
    expect(shownTexts()).toEqual([
      CHECK.text,
      PAGE.text,
      ROTATE.text,
      PATCH.text,
    ]);
    // Read as the plan reads them: nothing changes until the author does.
    expect(onChange).not.toHaveBeenCalled();
  });

  test("each line has Move Up and Move Down, named by its number, and locked at its part's ends", () => {
    drawForm([CHECK, PAGE, ROTATE, PATCH]);

    const up: (index: number) => HTMLElement = (index: number) => {
      return screen.getByTestId(`${IDS.moveUp}-${index}`);
    };
    const down: (index: number) => HTMLElement = (index: number) => {
      return screen.getByTestId(`${IDS.moveDown}-${index}`);
    };

    expect(up(2)).toHaveAccessibleName("Move step 3 up");
    expect(down(1)).toHaveAccessibleName("Move step 2 down");

    // The first of Contain it moves down only, the last of it up only.
    expect(up(1)).toBeDisabled();
    expect(down(1)).toBeEnabled();
    expect(up(2)).toBeEnabled();
    expect(down(2)).toBeDisabled();
    // A part's only step stays where it is: Contain it's steps are not its.
    for (const index of [0, 3]) {
      expect(up(index)).toBeDisabled();
      expect(down(index)).toBeDisabled();
    }
  });

  /*
   * The keys reach a line's controls in the order they are seen, at every
   * width: its part, its words, Move Up, Move Down, its bin. On a phone
   * each takes a line of its own, the words the whole width; nothing is
   * placed out of its turn, as a grid putting the buttons beside the part
   * and the words under them would.
   */
  test("a line's controls are reached in the order they are seen, and on a phone its words take the whole width", () => {
    drawForm([CHECK, PAGE, ROTATE, PATCH]);

    const line: HTMLElement = screen.getByTestId(`${IDS.line}-1`);
    const controls: Array<HTMLElement> = [
      within(line).getByRole("combobox", {
        name: "Part of the plan for step 2",
      }),
      ...[IDS.text, IDS.moveUp, IDS.moveDown, IDS.remove].map(
        (id: string): HTMLElement => {
          return within(line).getByTestId(`${id}-1`);
        },
      ),
    ];

    controls.slice(1).forEach((control: HTMLElement, place: number) => {
      expect(
        controls[place]!.compareDocumentPosition(control) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    expect(line).toHaveClass("flex", "flex-wrap", "sm:flex-nowrap");

    // The part, the words, the buttons: each the phone's whole width.
    const boxes: Array<Element> = Array.from(line.children);

    expect(boxes).toHaveLength(3);
    expect(boxes[0]).toHaveClass("w-full", "sm:w-56");
    expect(boxes[0]).toContainElement(controls[0]!);
    expect(boxes[1]).toHaveClass("w-full", "sm:flex-1");
    expect(boxes[1]).toContainElement(controls[1]!);
    expect(boxes[2]).toHaveClass("w-full", "sm:w-auto");
    expect(boxes[2]).toContainElement(controls[4]!);

    const outOfTurn: RegExp =
      /^(sm:)?(order|row-start|col-start|row-span|col-span)-/;
    const placed: Array<string> = Array.from(line.querySelectorAll("*"))
      .flatMap((element: Element): Array<string> => {
        return Array.from(element.classList);
      })
      .filter((className: string): boolean => {
        return outOfTurn.test(className);
      });

    expect(placed).toEqual([]);
  });

  test("Move Up moves a step one place among its part's steps, and every step keeps its id", () => {
    const { onChange } = drawForm([CHECK, PAGE, ROTATE, PATCH]);

    fireEvent.click(screen.getByTestId(`${IDS.moveUp}-2`));

    expect(lastChange(onChange)).toEqual([CHECK, ROTATE, PAGE, PATCH]);
    expect(shownTexts()).toEqual([
      CHECK.text,
      ROTATE.text,
      PAGE.text,
      PATCH.text,
    ]);
  });

  test("from the keyboard: Enter or Space on Move Down moves the step, the focus stays with it, and a screen reader hears where it went", async () => {
    const { onChange, user } = drawForm([CHECK, PAGE, ROTATE, NOTIFY, PATCH]);

    screen.getByTestId(`${IDS.moveDown}-1`).focus();
    await user.keyboard("{Enter}");

    expect(ids(lastChange(onChange))).toEqual(
      ids([CHECK, ROTATE, PAGE, NOTIFY, PATCH]),
    );
    // Still on the step it moved, now the third.
    expect(screen.getByTestId(`${IDS.moveDown}-2`)).toHaveFocus();
    expect(screen.getByTestId(`${IDS.moveDown}-2`)).toHaveAccessibleName(
      "Move step 3 down",
    );
    expect(screen.getByTestId(IDS.moved)).toHaveTextContent(
      "Step 2 is now step 3.",
    );
    expect(screen.getByTestId(IDS.moved)).toHaveAttribute("role", "status");

    await user.keyboard(" ");

    expect(ids(lastChange(onChange))).toEqual(
      ids([CHECK, ROTATE, NOTIFY, PAGE, PATCH]),
    );
    expect(screen.getByTestId(IDS.moved)).toHaveTextContent(
      "Step 3 is now step 4.",
    );
    // The last of its part now: Move Down is locked, and Move Up has the focus.
    expect(screen.getByTestId(`${IDS.moveDown}-3`)).toBeDisabled();
    expect(screen.getByTestId(`${IDS.moveUp}-3`)).toHaveFocus();

    await user.keyboard("{Enter}");

    expect(ids(lastChange(onChange))).toEqual(
      ids([CHECK, ROTATE, PAGE, NOTIFY, PATCH]),
    );
    expect(screen.getByTestId(`${IDS.moveUp}-2`)).toHaveFocus();
  });

  test("moving keeps each step whole and its id, so the plan's key for it - and a case's tick - stays", () => {
    const { onChange } = drawForm([CHECK, PAGE, ROTATE, NOTIFY, PATCH]);

    fireEvent.click(screen.getByTestId(`${IDS.moveDown}-1`));
    fireEvent.click(screen.getByTestId(`${IDS.moveUp}-3`));

    const moved: Array<DetectionRuleResponseStep> = lastChange(onChange);

    const byId: (
      a: DetectionRuleResponseStep,
      b: DetectionRuleResponseStep,
    ) => number = (
      a: DetectionRuleResponseStep,
      b: DetectionRuleResponseStep,
    ): number => {
      return a.id.localeCompare(b.id);
    };

    expect(moved).toHaveLength(5);
    // The same five steps, each whole: only their order changed.
    expect([...moved].sort(byId)).toEqual(
      [CHECK, PAGE, ROTATE, NOTIFY, PATCH].sort(byId),
    );
    expect(
      moved.map((step: DetectionRuleResponseStep): string => {
        return getDetectionRuleResponseStepKey(step.id);
      }),
    ).toEqual([
      "rule:check-audit-log",
      "rule:rotate-key",
      "rule:notify-owner",
      "rule:page-payments",
      "rule:patch-library",
    ]);
  });

  test("a library rule's steps keep the library's order until the author moves one, then become its own, the library's ids kept", () => {
    // A library rule with two steps under one part: one of them can move.
    const libraryRuleId: string | undefined =
      getDetectionRuleLibraryIdsWithSteps().find((id: string): boolean => {
        const steps: Array<DetectionRuleResponseStep> =
          getResponseStepsInPlanOrder(getDetectionRuleLibraryResponseSteps(id));

        return steps.some(
          (step: DetectionRuleResponseStep, place: number): boolean => {
            return steps[place + 1]?.phase === step.phase;
          },
        );
      });

    expect(libraryRuleId).toBeDefined();

    const library: Array<DetectionRuleResponseStep> =
      getResponseStepsInPlanOrder(
        getDetectionRuleLibraryResponseSteps(libraryRuleId!),
      );
    const { onChange } = drawForm(
      null,
      `title: From the library\nid: ${libraryRuleId}\n`,
    );

    expect(shownTexts()).toEqual(
      library.map((step: DetectionRuleResponseStep): string => {
        return step.text;
      }),
    );
    expect(onChange).not.toHaveBeenCalled();

    // The first step that shares its part with the next one.
    const index: number = library.findIndex(
      (step: DetectionRuleResponseStep, place: number): boolean => {
        return library[place + 1]?.phase === step.phase;
      },
    );

    expect(index).toBeGreaterThanOrEqual(0);

    fireEvent.click(screen.getByTestId(`${IDS.moveDown}-${index}`));

    const expected: Array<DetectionRuleResponseStep> = [...library];
    expected[index] = library[index + 1]!;
    expected[index + 1] = library[index]!;

    expect(lastChange(onChange)).toEqual(expected);
    // The rule's own now: the library's note goes.
    expect(screen.queryByTestId(IDS.fromLibrary)).toBeNull();
  });

  test("a grip drags a step among its part's steps, from the keyboard too, and says where it went", async () => {
    const { onChange } = drawForm([CHECK, PAGE, ROTATE, PATCH]);

    await waitForDragging();

    const grips: Array<HTMLElement> = screen.getAllByTestId("drag-handle");

    expect(grips).toHaveLength(4);
    expect(grips[2]!).toHaveAccessibleName("Drag to reorder step 3");
    expect(document.body.textContent).toContain(DRAG_HANDLE_USAGE_INSTRUCTIONS);

    // Rotate the key: picked up, one place up, dropped.
    grips[2]!.focus();
    await press(grips[2]!, " ");
    await press(grips[2]!, "ArrowUp");
    await press(grips[2]!, " ");
    await act(async () => {
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 400);
      });
    });

    expect(lastChange(onChange)).toEqual([CHECK, ROTATE, PAGE, PATCH]);
    expect(shownTexts()).toEqual([
      CHECK.text,
      ROTATE.text,
      PAGE.text,
      PATCH.text,
    ]);
    expect(screen.getByTestId(IDS.moved)).toHaveTextContent(
      "Step 3 is now step 2.",
    );
  });

  test("a step is never dragged into another part: its picker moves it there", async () => {
    const { onChange } = drawForm([CHECK, PAGE, ROTATE, PATCH]);

    await waitForDragging();

    // The first of Contain it, pushed up toward Confirm it is real.
    const grip: HTMLElement = screen.getAllByTestId("drag-handle")[1]!;

    grip.focus();
    await press(grip, " ");
    await press(grip, "ArrowUp");
    await press(grip, " ");
    await act(async () => {
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 400);
      });
    });

    expect(onChange).not.toHaveBeenCalled();
  });

  test("a step put under another part goes to the end of it nearest where it was, and the focus goes with it", () => {
    const { onChange } = drawForm([CHECK, PAGE, ROTATE, PATCH]);

    const picker: HTMLElement = screen.getByRole("combobox", {
      name: "Part of the plan for step 2",
    });

    picker.focus();
    fireEvent.keyDown(picker, { key: "ArrowDown" });
    fireEvent.click(
      screen.getByRole("option", { name: "Fix what let it happen" }),
    );

    // Page the payments on-call: first of Fix, above what was there.
    expect(lastChange(onChange)).toEqual([
      CHECK,
      ROTATE,
      { ...PAGE, phase: DetectionRuleResponsePhase.Fix },
      PATCH,
    ]);
    expect(
      screen.getByRole("combobox", { name: "Part of the plan for step 3" }),
    ).toHaveFocus();
  });

  test("Add Step's new line takes the focus, to write what to do", () => {
    drawForm([CHECK, PAGE]);

    fireEvent.click(screen.getByTestId(IDS.add));

    expect(screen.getByTestId(`${IDS.text}-2`)).toHaveFocus();
  });

  test("a line's bin hands the focus to the line that takes its place, and to Add Step once none is left", () => {
    drawForm([CHECK, PAGE, ROTATE]);

    fireEvent.click(screen.getByTestId(`${IDS.remove}-1`));

    // Rotate the key, the second line now.
    expect(screen.getByTestId(`${IDS.remove}-1`)).toHaveFocus();
    expect(screen.getByTestId(`${IDS.text}-1`)).toHaveValue(ROTATE.text);

    fireEvent.click(screen.getByTestId(`${IDS.remove}-1`));
    expect(screen.getByTestId(`${IDS.remove}-0`)).toHaveFocus();

    fireEvent.click(screen.getByTestId(`${IDS.remove}-0`));
    expect(screen.getByTestId(IDS.add)).toHaveFocus();
  });
});
