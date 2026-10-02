import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  act,
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import TemplateVariableTextControl from "../../../../UI/Components/TemplateVariables/TemplateVariableTextControl";
import Input from "../../../../UI/Components/Input/Input";
import TextArea from "../../../../UI/Components/TextArea/TextArea";
import { TemplateVariableGroups } from "../../../../Types/Template/TemplateVariable";

/*
 * A text field or long text field whose value is a template: typing "{{"
 * opens its variables under the cursor, and the collapsed list under it adds
 * one where the cursor is. The field itself is the ordinary Input or
 * TextArea, listened to from around it.
 */

const GROUPS: TemplateVariableGroups = [
  {
    title: "Incident",
    variables: [
      { name: "incident.title", description: "Title" },
      { name: "incident.startedAt", description: "Declared At" },
      { name: "incident.severity", description: "Incident Severity" },
    ],
  },
];

afterEach(() => {
  cleanup();
});

type ValueMock = jest.Mock<(value: string) => void>;

function renderInput(
  initialValue: string,
  onChange: ValueMock,
  onEnterPress?: () => void,
): HTMLInputElement {
  render(
    <TemplateVariableTextControl groups={GROUPS} description="Filled in.">
      <Input
        dataTestId="field"
        initialValue={initialValue}
        onChange={onChange}
        onEnterPress={onEnterPress}
      />
    </TemplateVariableTextControl>,
  );

  return screen.getByTestId("field") as HTMLInputElement;
}

function renderTextArea(initialValue: string, onChange: ValueMock): HTMLTextAreaElement {
  render(
    <TemplateVariableTextControl groups={GROUPS}>
      <TextArea
        dataTestId="field"
        initialValue={initialValue}
        onChange={onChange}
      />
    </TemplateVariableTextControl>,
  );

  return screen.getByTestId("field") as HTMLTextAreaElement;
}

// Types `text` as the field's whole value, with the cursor at its end.
function type(control: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  act(() => {
    control.focus();
  });
  fireEvent.input(control, { target: { value: text } });
}

function suggestions(): HTMLElement | null {
  return screen.queryByTestId("template-variable-suggestions");
}

function suggestedNames(): Array<string> {
  return within(suggestions() as HTMLElement)
    .queryAllByRole("option")
    .map((option: HTMLElement): string => {
      return option.dataset["variableName"] || "";
    });
}

describe("typing {{ in a text field", () => {
  test("opens the variables under the cursor, and what follows the braces filters them", () => {
    const control: HTMLInputElement = renderInput("", jest.fn());

    type(control, "Down: {{");

    expect(suggestions()).toBeInTheDocument();
    expect(suggestedNames()).toEqual([
      "incident.title",
      "incident.startedAt",
      "incident.severity",
    ]);

    type(control, "Down: {{decl");

    expect(suggestedNames()).toEqual(["incident.startedAt"]);
  });

  test("Enter puts the variable in place of the braces - and does not submit the form", () => {
    const onChange: ValueMock = jest.fn<(value: string) => void>();
    const onEnterPress: jest.Mock<() => void> = jest.fn<() => void>();
    const control: HTMLInputElement = renderInput("", onChange, onEnterPress);

    type(control, "Down: {{sev");

    const enter: Event = createEvent.keyDown(control, { key: "Enter" });
    fireEvent(control, enter);

    expect(enter.defaultPrevented).toBe(true);
    expect(onEnterPress).not.toHaveBeenCalled();
    expect(control.value).toBe("Down: {{incident.severity}}");
    expect(onChange).toHaveBeenLastCalledWith("Down: {{incident.severity}}");
    expect(suggestions()).toBeNull();
  });

  test("with no list open, Enter is the field's again", () => {
    const onEnterPress: jest.Mock<() => void> = jest.fn<() => void>();
    const control: HTMLInputElement = renderInput("", jest.fn(), onEnterPress);

    type(control, "Plain title");
    fireEvent.keyDown(control, { key: "Enter" });

    expect(onEnterPress).toHaveBeenCalledTimes(1);
  });

  test("the arrow keys choose, and Tab takes the chosen one", () => {
    const control: HTMLInputElement = renderInput("", jest.fn());

    type(control, "{{");
    fireEvent.keyDown(control, { key: "ArrowDown" });
    fireEvent.keyDown(control, { key: "Tab" });

    expect(control.value).toBe("{{incident.startedAt}}");
  });

  test("a click on a suggestion takes it", () => {
    const control: HTMLInputElement = renderInput("", jest.fn());

    type(control, "At {{");
    fireEvent.click(
      within(suggestions() as HTMLElement).getAllByRole("option")[0]!,
    );

    expect(control.value).toBe("At {{incident.title}}");
  });

  test("Escape closes the list, and only the list: the dialog never sees it", () => {
    const dialogKeys: Array<string> = [];
    const dialogListener: (event: KeyboardEvent) => void = (
      event: KeyboardEvent,
    ): void => {
      if (!event.defaultPrevented) {
        dialogKeys.push(event.key);
      }
    };

    document.addEventListener("keydown", dialogListener);

    try {
      const control: HTMLInputElement = renderInput("", jest.fn());

      type(control, "{{inc");
      fireEvent.keyDown(control, { key: "Escape" });

      expect(suggestions()).toBeNull();
      expect(control.value).toBe("{{inc");
      expect(dialogKeys).toEqual([]);

      // With the list closed, Escape is the dialog's again.
      fireEvent.keyDown(control, { key: "Escape" });
      expect(dialogKeys).toEqual(["Escape"]);
    } finally {
      document.removeEventListener("keydown", dialogListener);
    }
  });

  test("nothing opens for what matches no variable", () => {
    const control: HTMLInputElement = renderInput("", jest.fn());

    type(control, "{{nothing");

    expect(suggestions()).toBeNull();
  });

  test("closes once the braces are closed by hand", () => {
    const control: HTMLInputElement = renderInput("", jest.fn());

    type(control, "{{incident.title");
    expect(suggestions()).toBeInTheDocument();

    type(control, "{{incident.title}}");
    expect(suggestions()).toBeNull();
  });

  test("closes when the field loses the focus", () => {
    const control: HTMLInputElement = renderInput("", jest.fn());

    type(control, "{{");
    fireEvent.blur(control);

    expect(suggestions()).toBeNull();
  });

  test("closes when the cursor is moved away from the braces", () => {
    const control: HTMLInputElement = renderInput("", jest.fn());

    type(control, "Hi {{inc");
    control.setSelectionRange(1, 1);
    fireEvent.keyUp(control, { key: "ArrowLeft" });

    expect(suggestions()).toBeNull();
  });

  test("tells assistive technology which list the field drives and where its keys are", () => {
    const control: HTMLInputElement = renderInput("", jest.fn());

    expect(control).toHaveAttribute("aria-autocomplete", "list");
    expect(control).not.toHaveAttribute("aria-controls");

    type(control, "{{");

    const listbox: HTMLElement = within(
      suggestions() as HTMLElement,
    ).getByRole("listbox");

    expect(control).toHaveAttribute("aria-controls", listbox.id);
    expect(control).toHaveAttribute(
      "aria-activedescendant",
      within(listbox).getAllByRole("option")[0]!.id,
    );

    fireEvent.keyDown(control, { key: "Escape" });

    expect(control).not.toHaveAttribute("aria-controls");
    expect(control).not.toHaveAttribute("aria-activedescendant");
  });
});

describe("typing {{ in a long text field", () => {
  test("replaces only the braces and what was typed, in the middle of the text", () => {
    const onChange: ValueMock = jest.fn<(value: string) => void>();
    const control: HTMLTextAreaElement = renderTextArea("", onChange);

    type(control, "Line one\nSeverity: {{sev\nLine three");
    control.setSelectionRange(24, 24);
    fireEvent.input(control);

    expect(suggestedNames()).toEqual(["incident.severity"]);

    fireEvent.keyDown(control, { key: "Enter" });

    expect(control.value).toBe(
      "Line one\nSeverity: {{incident.severity}}\nLine three",
    );
    expect(onChange).toHaveBeenLastCalledWith(
      "Line one\nSeverity: {{incident.severity}}\nLine three",
    );
  });

  test("takes in the closing braces already there", () => {
    const control: HTMLTextAreaElement = renderTextArea("", jest.fn());

    type(control, "{{}} now");
    control.setSelectionRange(2, 2);
    fireEvent.input(control);
    fireEvent.keyDown(control, { key: "Enter" });

    expect(control.value).toBe("{{incident.title}} now");
  });
});

describe("the list under the field", () => {
  test("is there, collapsed, with every variable and what they are filled with", () => {
    renderInput("", jest.fn());

    const list: HTMLElement = screen.getByTestId("template-variables");

    expect(list).not.toHaveAttribute("open");
    expect(within(list).getByText("{{incident.startedAt}}")).toBeInTheDocument();
    expect(
      within(list).getByTestId("template-variables-description"),
    ).toHaveTextContent("Filled in.");
    // It says typing "{{" works here too.
    expect(within(list).getByText("{{").tagName).toBe("KBD");
  });

  test("a click adds the variable where the cursor is", () => {
    const onChange: ValueMock = jest.fn<(value: string) => void>();
    const control: HTMLInputElement = renderInput("", onChange);

    type(control, "Hello world");
    control.setSelectionRange(6, 6);

    const card: HTMLElement = screen
      .getAllByTestId("template-variable-insert")
      .find((element: HTMLElement): boolean => {
        return element.dataset["variableName"] === "incident.title";
      })!;

    fireEvent.mouseDown(card);
    fireEvent.click(card);

    expect(control.value).toBe("Hello {{incident.title}}world");
    expect(onChange).toHaveBeenLastCalledWith("Hello {{incident.title}}world");
  });

  test("into a field nobody has used yet, it goes at the end", () => {
    const control: HTMLTextAreaElement = renderTextArea(
      "Episode on ",
      jest.fn(),
    );

    fireEvent.click(
      screen
        .getAllByTestId("template-variable-insert")
        .find((element: HTMLElement): boolean => {
          return element.dataset["variableName"] === "incident.severity";
        })!,
    );

    expect(control.value).toBe("Episode on {{incident.severity}}");
  });

  test("replaces what is selected", () => {
    const control: HTMLInputElement = renderInput("", jest.fn());

    type(control, "Severity: TODO");
    control.setSelectionRange(10, 14);

    fireEvent.click(
      screen
        .getAllByTestId("template-variable-insert")
        .find((element: HTMLElement): boolean => {
          return element.dataset["variableName"] === "incident.severity";
        })!,
    );

    expect(control.value).toBe("Severity: {{incident.severity}}");
  });
});

describe("without variables", () => {
  test("typing {{ opens nothing", () => {
    render(
      <TemplateVariableTextControl groups={[]}>
        <Input dataTestId="field" initialValue="" onChange={() => {}} />
      </TemplateVariableTextControl>,
    );

    const control: HTMLInputElement = screen.getByTestId(
      "field",
    ) as HTMLInputElement;

    type(control, "{{");

    expect(suggestions()).toBeNull();
    expect(control).not.toHaveAttribute("aria-autocomplete");
  });
});

// A component that is not a text control (a dropdown, say) is left alone.
describe("a control with no text field", () => {
  test("is rendered as it is, with the list and nothing broken", () => {
    function Plain(): ReactElement {
      return <button type="button">Pick</button>;
    }

    render(
      <TemplateVariableTextControl groups={GROUPS}>
        <Plain />
      </TemplateVariableTextControl>,
    );

    fireEvent.click(screen.getAllByTestId("template-variable-insert")[0]!);

    expect(screen.getByRole("button", { name: "Pick" })).toBeInTheDocument();
  });
});
