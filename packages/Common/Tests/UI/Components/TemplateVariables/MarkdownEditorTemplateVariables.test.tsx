import "@testing-library/jest-dom";
import type { Mock } from "jest-mock";
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
import React from "react";
import MarkdownEditor from "../../../../UI/Components/Markdown.tsx/MarkdownEditor";
import { TemplateVariableGroups } from "../../../../Types/Template/TemplateVariable";

/*
 * "You could even make it one step ahead in the sense that you can also
 * integrate variables with the markdown editor ... pick those variables and
 * have them directly in the editor as well."
 *
 * A Markdown editor given template variables offers them three ways - its
 * toolbar's Insert variable button, typing "{{", and the collapsed list under
 * it - and each puts the variable where the cursor is, in the visual editor
 * and in the markdown source alike, as an edit the rest of the form hears of.
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
  {
    title: "Custom Fields",
    variables: [
      {
        name: "incident.customFields.on_call_lead",
        description: "On-call Lead",
        isDescriptionVerbatim: true,
      },
    ],
  },
];

type ChangeMock = Mock<(value: string) => void>;

afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
});

function editableOf(): HTMLElement {
  return document.querySelector('[contenteditable="true"]') as HTMLElement;
}

function textNodeWith(text: string): Text {
  const walker: TreeWalker = document.createTreeWalker(
    editableOf(),
    NodeFilter.SHOW_TEXT,
  );
  let node: Node | null = walker.nextNode();

  while (node && !(node.textContent || "").includes(text)) {
    node = walker.nextNode();
  }

  if (!node) {
    throw new Error(`no text "${text}" in the editor`);
  }

  return node as Text;
}

// The cursor `offset` characters into the first text node holding `text`.
function placeCaret(text: string, offset: number): void {
  act(() => {
    editableOf().focus();
  });

  const node: Text = textNodeWith(text);
  const range: Range = document.createRange();

  range.setStart(node, node.data.indexOf(text) + offset);
  range.collapse(true);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
}

/*
 * Types into the visual editor: the text node holding `inText` becomes
 * `newData`, the cursor goes to `caret` in it, and the editor hears an input.
 */
function typeInEditor(inText: string, newData: string, caret?: number): void {
  act(() => {
    editableOf().focus();
  });

  const node: Text = textNodeWith(inText);

  node.data = newData;

  const range: Range = document.createRange();

  range.setStart(node, caret ?? newData.length);
  range.collapse(true);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);

  fireEvent.input(editableOf());
}

function lastChange(onChange: ChangeMock): string {
  const calls: Array<Array<unknown>> = onChange.mock.calls;
  return String(calls[calls.length - 1]?.[0] ?? "");
}

function cardFor(name: string): HTMLElement {
  return within(screen.getByTestId("markdown-editor-template-variables"))
    .getAllByTestId("template-variable-insert")
    .find((element: HTMLElement): boolean => {
      return element.dataset["variableName"] === name;
    })!;
}

function clickCard(name: string): void {
  const card: HTMLElement = cardFor(name);
  fireEvent.mouseDown(card);
  fireEvent.click(card);
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

function switchToMarkdown(): HTMLTextAreaElement {
  fireEvent.click(screen.getByRole("button", { name: "Markdown" }));
  return document.querySelector("textarea") as HTMLTextAreaElement;
}

describe("a Markdown editor without template variables", () => {
  test("is as it was: no Insert variable button, no list, and {{ is just text", () => {
    const onChange: ChangeMock = jest.fn<(value: string) => void>();

    render(<MarkdownEditor initialValue="Hello" onChange={onChange} />);

    expect(
      screen.queryByTestId("markdown-editor-insert-variable"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("markdown-editor-template-variables"),
    ).not.toBeInTheDocument();
    expect(editableOf()).not.toHaveAttribute("aria-autocomplete");

    typeInEditor("Hello", "Hello {{");

    expect(suggestions()).toBeNull();
    expect(lastChange(onChange)).toBe("Hello {{");
  });
});

describe("a Markdown editor with template variables", () => {
  test("has an Insert variable button at the end of its toolbar", () => {
    render(<MarkdownEditor initialValue="" templateVariables={GROUPS} />);

    const button: HTMLElement = screen.getByTestId(
      "markdown-editor-insert-variable",
    );

    expect(button).toHaveTextContent("Insert variable");

    // The last button of the toolbar, after the Markdown/Visual switch.
    const toolbarButtons: Array<Element> = Array.from(
      screen.getByTestId("markdown-editor-toolbar").querySelectorAll("button"),
    );

    expect(toolbarButtons[toolbarButtons.length - 1]).toBe(button);
  });

  test("lists its variables collapsed under the editor, above the formatting help", () => {
    render(
      <MarkdownEditor
        initialValue=""
        templateVariables={GROUPS}
        templateVariablesDescription="Filled in from the incident."
      />,
    );

    const list: HTMLElement = screen.getByTestId(
      "markdown-editor-template-variables",
    );

    expect(list.tagName).toBe("DETAILS");
    expect(list).not.toHaveAttribute("open");
    expect(list).toHaveTextContent("Filled in from the incident.");

    for (const name of [
      "{{incident.title}}",
      "{{incident.startedAt}}",
      "{{incident.severity}}",
      "{{incident.customFields.on_call_lead}}",
    ]) {
      expect(within(list).getByText(name)).toBeInTheDocument();
    }

    const help: HTMLElement = screen.getByText("Formatting help");

    expect(
      list.compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("a group with nothing to pick yet shows in the list, with no button and no typing", () => {
    render(
      <MarkdownEditor
        initialValue=""
        templateVariables={[
          {
            title: "Custom Fields",
            description: "This project has no incident custom fields.",
            variables: [],
          },
        ]}
      />,
    );

    expect(
      screen.getByTestId("markdown-editor-template-variables"),
    ).toHaveTextContent("This project has no incident custom fields.");
    expect(
      screen.queryByTestId("markdown-editor-insert-variable"),
    ).not.toBeInTheDocument();
    expect(editableOf()).not.toHaveAttribute("aria-autocomplete");
  });

  describe("in the visual editor", () => {
    test("a card in the list goes in where the cursor is", () => {
      const onChange: ChangeMock = jest.fn<(value: string) => void>();

      render(
        <MarkdownEditor
          initialValue="Hello world"
          templateVariables={GROUPS}
          onChange={onChange}
        />,
      );

      placeCaret("world", 0);
      clickCard("incident.title");

      expect(lastChange(onChange)).toBe("Hello {{incident.title}}world");
    });

    test("a card goes where the cursor last was, after the focus has left the editor", () => {
      const onChange: ChangeMock = jest.fn<(value: string) => void>();

      render(
        <MarkdownEditor
          initialValue="Severity: now"
          templateVariables={GROUPS}
          onChange={onChange}
        />,
      );

      placeCaret("now", 0);
      fireEvent.mouseUp(editableOf());

      // The focus and the selection go elsewhere, as when scrolling to the list.
      act(() => {
        (document.activeElement as HTMLElement | null)?.blur();
      });
      window.getSelection()?.removeAllRanges();

      clickCard("incident.severity");

      expect(lastChange(onChange)).toBe("Severity: {{incident.severity}}now");
    });

    test("into an editor nobody has typed in, it goes on a line at the end", () => {
      const onChange: ChangeMock = jest.fn<(value: string) => void>();

      render(
        <MarkdownEditor
          initialValue="**Incident**"
          templateVariables={GROUPS}
          onChange={onChange}
        />,
      );

      clickCard("incident.title");

      expect(lastChange(onChange)).toBe("**Incident**\n\n{{incident.title}}");
    });

    test("into an empty editor, it is the whole note", () => {
      const onChange: ChangeMock = jest.fn<(value: string) => void>();

      render(
        <MarkdownEditor
          initialValue=""
          templateVariables={GROUPS}
          onChange={onChange}
        />,
      );

      clickCard("incident.startedAt");

      expect(lastChange(onChange)).toBe("{{incident.startedAt}}");
    });

    test("the toolbar's list puts the pick where the cursor was when it was opened", () => {
      const onChange: ChangeMock = jest.fn<(value: string) => void>();

      render(
        <MarkdownEditor
          initialValue="Declared: ."
          templateVariables={GROUPS}
          onChange={onChange}
        />,
      );

      placeCaret(".", 0);

      const button: HTMLElement = screen.getByTestId(
        "markdown-editor-insert-variable",
      );

      fireEvent.mouseDown(button);
      fireEvent.click(button);

      const search: HTMLElement = screen.getByTestId(
        "template-variable-search",
      );

      // The search box has the focus; the editor's selection is gone.
      expect(search).toHaveFocus();
      window.getSelection()?.removeAllRanges();

      fireEvent.change(search, { target: { value: "declared" } });
      fireEvent.keyDown(search, { key: "Enter" });

      expect(lastChange(onChange)).toBe("Declared: {{incident.startedAt}}.");
      expect(screen.queryByTestId("insert-template-variable-popup")).toBeNull();
      expect(editableOf()).toHaveFocus();
    });

    test("typing {{ opens the variables under the braces, filtered as the name is typed", () => {
      render(<MarkdownEditor initialValue="Down" templateVariables={GROUPS} />);

      typeInEditor("Down", "Down: {{");

      expect(suggestions()).toBeInTheDocument();
      expect(suggestedNames()).toEqual([
        "incident.title",
        "incident.startedAt",
        "incident.severity",
        "incident.customFields.on_call_lead",
      ]);

      typeInEditor("Down", "Down: {{lead");

      expect(suggestedNames()).toEqual(["incident.customFields.on_call_lead"]);
    });

    test("Enter takes the chosen variable in place of the braces and what was typed", () => {
      const onChange: ChangeMock = jest.fn<(value: string) => void>();

      render(
        <MarkdownEditor
          initialValue="Down"
          templateVariables={GROUPS}
          onChange={onChange}
        />,
      );

      typeInEditor("Down", "Down: {{sev");

      const enter: Event = createEvent.keyDown(editableOf(), { key: "Enter" });
      fireEvent(editableOf(), enter);

      expect(enter.defaultPrevented).toBe(true);
      expect(suggestions()).toBeNull();
      expect(lastChange(onChange)).toBe("Down: {{incident.severity}}");
    });

    test("the arrow keys choose and Tab takes, without indenting anything", () => {
      const onChange: ChangeMock = jest.fn<(value: string) => void>();

      render(
        <MarkdownEditor
          initialValue="- item"
          templateVariables={GROUPS}
          onChange={onChange}
        />,
      );

      typeInEditor("item", "item {{");

      fireEvent.keyDown(editableOf(), { key: "ArrowDown" });

      const listbox: HTMLElement = within(
        suggestions() as HTMLElement,
      ).getByRole("listbox");

      expect(editableOf()).toHaveAttribute("aria-controls", listbox.id);
      expect(editableOf()).toHaveAttribute(
        "aria-activedescendant",
        within(listbox).getAllByRole("option")[1]!.id,
      );

      const tab: Event = createEvent.keyDown(editableOf(), { key: "Tab" });
      fireEvent(editableOf(), tab);

      expect(tab.defaultPrevented).toBe(true);
      expect(lastChange(onChange)).toBe("- item {{incident.startedAt}}");
    });

    test("a click on a suggestion takes it", () => {
      const onChange: ChangeMock = jest.fn<(value: string) => void>();

      render(
        <MarkdownEditor
          initialValue="By"
          templateVariables={GROUPS}
          onChange={onChange}
        />,
      );

      typeInEditor("By", "By {{");

      fireEvent.click(
        within(suggestions() as HTMLElement).getAllByRole("option")[3]!,
      );

      expect(lastChange(onChange)).toBe(
        "By {{incident.customFields.on_call_lead}}",
      );
    });

    test("Escape closes the list, and the dialog the editor is in never sees it", () => {
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
        render(<MarkdownEditor initialValue="A" templateVariables={GROUPS} />);

        typeInEditor("A", "A {{");
        fireEvent.keyDown(editableOf(), { key: "Escape" });

        expect(suggestions()).toBeNull();
        expect(dialogKeys).toEqual([]);
        expect(editableOf()).not.toHaveAttribute("aria-controls");
      } finally {
        document.removeEventListener("keydown", dialogListener);
      }
    });

    test("closes when the editor loses the focus, or the cursor leaves the braces", () => {
      render(<MarkdownEditor initialValue="A B" templateVariables={GROUPS} />);

      typeInEditor("A B", "A {{ B");
      expect(suggestions()).not.toBeInTheDocument();

      typeInEditor("A {{ B", "A {{ B", 4);
      expect(suggestions()).toBeInTheDocument();

      fireEvent.blur(editableOf());
      expect(suggestions()).toBeNull();

      typeInEditor("A {{ B", "A {{ B", 4);
      expect(suggestions()).toBeInTheDocument();

      placeCaret("A {{ B", 0);
      fireEvent.keyUp(editableOf(), { key: "Home" });
      expect(suggestions()).toBeNull();
    });

    test("clicking into an old {{ does not open the list; typing does", () => {
      render(
        <MarkdownEditor initialValue="Old {{inc" templateVariables={GROUPS} />,
      );

      placeCaret("Old {{inc", 9);
      fireEvent.mouseUp(editableOf());

      expect(suggestions()).toBeNull();
    });

    test("a custom field variable with underscores survives more typing", () => {
      const onChange: ChangeMock = jest.fn<(value: string) => void>();

      render(
        <MarkdownEditor
          initialValue="Lead: {{incident.customFields.on_call_lead}}"
          templateVariables={GROUPS}
          onChange={onChange}
        />,
      );

      // Nothing is italic: the key's underscores are text.
      expect(editableOf().querySelector("em")).toBeNull();

      typeInEditor(
        "Lead:",
        "Lead: {{incident.customFields.on_call_lead}} (paged)",
      );

      expect(lastChange(onChange)).toBe(
        "Lead: {{incident.customFields.on_call_lead}} (paged)",
      );
    });

    test("tells assistive technology the editor completes from a list", () => {
      render(<MarkdownEditor initialValue="" templateVariables={GROUPS} />);

      expect(editableOf()).toHaveAttribute("aria-autocomplete", "list");
      expect(editableOf()).not.toHaveAttribute("aria-controls");
    });
  });

  describe("in the markdown source", () => {
    test("typing {{ opens the variables, and Enter puts the chosen one in", () => {
      const onChange: ChangeMock = jest.fn<(value: string) => void>();

      render(
        <MarkdownEditor
          initialValue=""
          templateVariables={GROUPS}
          onChange={onChange}
        />,
      );

      const textarea: HTMLTextAreaElement = switchToMarkdown();

      act(() => {
        textarea.focus();
      });
      fireEvent.input(textarea, { target: { value: "**Declared**: {{decl" } });

      expect(suggestedNames()).toEqual(["incident.startedAt"]);
      expect(textarea).toHaveAttribute("aria-autocomplete", "list");

      fireEvent.keyDown(textarea, { key: "Enter" });

      expect(textarea.value).toBe("**Declared**: {{incident.startedAt}}");
      expect(lastChange(onChange)).toBe("**Declared**: {{incident.startedAt}}");
      expect(suggestions()).toBeNull();
    });

    test("a card in the list goes in at the source's cursor", () => {
      const onChange: ChangeMock = jest.fn<(value: string) => void>();

      render(
        <MarkdownEditor
          initialValue="Title: !"
          templateVariables={GROUPS}
          onChange={onChange}
        />,
      );

      const textarea: HTMLTextAreaElement = switchToMarkdown();

      act(() => {
        textarea.focus();
      });
      textarea.setSelectionRange(7, 7);
      fireEvent.mouseUp(textarea);

      clickCard("incident.title");

      expect(lastChange(onChange)).toBe("Title: {{incident.title}}!");
    });

    test("the toolbar's list puts the pick at the source's cursor", () => {
      const onChange: ChangeMock = jest.fn<(value: string) => void>();

      render(
        <MarkdownEditor
          initialValue="State: "
          templateVariables={GROUPS}
          onChange={onChange}
        />,
      );

      const textarea: HTMLTextAreaElement = switchToMarkdown();

      act(() => {
        textarea.focus();
      });
      textarea.setSelectionRange(7, 7);
      fireEvent.focus(textarea);

      const button: HTMLElement = screen.getByTestId(
        "markdown-editor-insert-variable",
      );

      fireEvent.mouseDown(button);
      fireEvent.click(button);
      fireEvent.click(screen.getAllByRole("option")[2]!);

      expect(lastChange(onChange)).toBe("State: {{incident.severity}}");
    });

    test("switching views closes a list that was open", () => {
      render(<MarkdownEditor initialValue="A" templateVariables={GROUPS} />);

      typeInEditor("A", "A {{");
      expect(suggestions()).toBeInTheDocument();

      switchToMarkdown();

      expect(suggestions()).toBeNull();
    });
  });
});
