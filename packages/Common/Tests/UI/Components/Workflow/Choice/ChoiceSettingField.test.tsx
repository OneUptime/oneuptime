/*
 * A step's setting that is a choice of a few - what a Page step's page is
 * about - as the person building the workflow answers it: one question with
 * a row for each answer, the answer's name and what choosing it means.
 *
 * What must hold:
 *
 *   - every answer is on the page with its line, none hidden behind a click;
 *   - an answer is always chosen: while nothing is stored, the first one is
 *     the one in force and is drawn as chosen, so the form never shows a
 *     question nobody answered;
 *   - picking another answer hands back what the step stores for it;
 *   - a stored value that is none of the answers - a workflow written by
 *     hand - leaves every row unchosen and says what the setting holds,
 *     rather than passing for the first answer.
 */

import ChoiceSettingField, {
  UNKNOWN_CHOICE_NOTE,
} from "../../../../../UI/Components/Workflow/Choice/ChoiceSettingField";
import ComponentMetadata, {
  Argument,
  ArgumentChoice,
  ComponentInputType,
} from "../../../../../Types/Workflow/Component";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import Components from "../../../../../Types/Workflow/Components";
import {
  PAGE_ARGUMENT_IDS,
  PageAbout,
} from "../../../../../Types/Workflow/Components/OnCallPageSettings";
import getJestMockFunction, { MockFunction } from "../../../../MockType";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement, useState } from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

// Page Users' Page About, as the catalog has it.
const PAGE_ABOUT: Argument = Components.find(
  (component: ComponentMetadata): boolean => {
    return component.id === ComponentID.PageUsers;
  },
)!.arguments.find((argument: Argument): boolean => {
  return argument.id === PAGE_ARGUMENT_IDS.about;
})!;

const CHOICES: Array<ArgumentChoice> = PAGE_ABOUT.choices!;

interface Rendered {
  onChange: MockFunction;
}

function renderField(data: {
  value?: unknown;
  argument?: Argument | undefined;
  dataTestId?: string | undefined;
}): Rendered {
  const onChange: MockFunction = getJestMockFunction();

  // The form: it stores what the field hands back, and hands it in again.
  function Harness(): ReactElement {
    const [value, setValue] = useState<unknown>(data.value);

    return (
      <ChoiceSettingField
        argument={data.argument || PAGE_ABOUT}
        value={value}
        onChange={(next: string) => {
          onChange(next);
          setValue(next);
        }}
        dataTestId={
          "dataTestId" in data ? data.dataTestId : "workflow-argument-about"
        }
      />
    );
  }

  render(<Harness />);

  return { onChange: onChange };
}

function radios(): Array<HTMLInputElement> {
  return within(screen.getByRole("radiogroup")).getAllByRole(
    "radio",
  ) as Array<HTMLInputElement>;
}

function checkedValues(): Array<string> {
  return radios()
    .filter((radio: HTMLInputElement): boolean => {
      return radio.checked;
    })
    .map((radio: HTMLInputElement): string => {
      return radio.value;
    });
}

afterEach(() => {
  cleanup();
});

describe("the question and its answers", () => {
  test("is one group, named after the setting, with a radio for each answer in order", () => {
    renderField({});

    expect(screen.getByRole("radiogroup")).toHaveAccessibleName("Page About");
    expect(
      radios().map((radio: HTMLInputElement): string => {
        return radio.value;
      }),
    ).toEqual([PageAbout.NewAlert, PageAbout.Incident, PageAbout.Alert]);
  });

  test("each answer is named, and says under its name what choosing it means", () => {
    renderField({});

    expect(CHOICES).toHaveLength(3);

    for (const choice of CHOICES) {
      const radio: HTMLElement = screen.getByRole("radio", {
        name: choice.label,
      });

      expect(radio).toHaveAccessibleDescription(choice.description);
      expect(screen.getByText(choice.description!)).toBeVisible();
    }
  });

  test("the three answers, in the words the step uses", () => {
    expect(
      CHOICES.map((choice: ArgumentChoice): string => {
        return choice.label;
      }),
    ).toEqual(["A new alert", "An incident", "An alert"]);
  });

  test("each radio and its row can be found by the answer it stores", () => {
    renderField({});

    for (const choice of CHOICES) {
      expect(
        screen.getByTestId(`workflow-argument-about-${choice.value}`),
      ).toHaveAttribute("type", "radio");
      expect(
        screen.getByTestId(`workflow-argument-about-${choice.value}-row`),
      ).toBeInTheDocument();
    }

    expect(screen.getByTestId("workflow-argument-about")).toBeInTheDocument();
  });

  test("the rows sit in one bordered box, as a list of answers", () => {
    renderField({});

    const box: HTMLElement = screen.getByRole("radiogroup").parentElement!
      .parentElement as HTMLElement;

    expect(box).toHaveClass("rounded-lg", "border", "border-gray-200");
  });
});

describe("the answer in force", () => {
  test.each([undefined, null, "", "   "])(
    "nothing stored (%p): the first answer is drawn as chosen",
    (empty: unknown) => {
      renderField({ value: empty });

      expect(checkedValues()).toEqual([PageAbout.NewAlert]);
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );

  test.each([PageAbout.NewAlert, PageAbout.Incident, PageAbout.Alert])(
    "'%s' stored: that answer, and only that one",
    (stored: PageAbout) => {
      renderField({ value: stored });

      expect(checkedValues()).toEqual([stored]);
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );

  test("stored in another case or with space around it: read as the step reads it", () => {
    renderField({ value: " Incident " });

    expect(checkedValues()).toEqual([PageAbout.Incident]);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("picking an answer", () => {
  test("hands back what the step stores for it, and it becomes the one chosen", () => {
    const { onChange } = renderField({});

    fireEvent.click(screen.getByRole("radio", { name: "An incident" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(PageAbout.Incident);
    expect(checkedValues()).toEqual([PageAbout.Incident]);
  });

  test("the answer's name is its label: pressing the words picks it", () => {
    const { onChange } = renderField({});

    fireEvent.click(screen.getByText("An alert"));

    expect(onChange).toHaveBeenCalledWith(PageAbout.Alert);
  });

  test("the first answer can be picked while it is only in force by default, and is then stored", () => {
    const { onChange } = renderField({ value: PageAbout.Alert });

    fireEvent.click(screen.getByRole("radio", { name: "A new alert" }));

    expect(onChange).toHaveBeenCalledWith(PageAbout.NewAlert);
  });

  test("pressing the answer already chosen changes nothing", () => {
    const { onChange } = renderField({ value: PageAbout.Incident });

    fireEvent.click(screen.getByRole("radio", { name: "An incident" }));

    expect(onChange).not.toHaveBeenCalled();
  });

  test("every answer can be picked: none is locked", () => {
    renderField({});

    for (const radio of radios()) {
      expect(radio).toBeEnabled();
    }
  });
});

describe("a stored value that is none of the answers", () => {
  test("no row is chosen, and a note says what the setting holds", () => {
    renderField({ value: "postmortem" });

    expect(checkedValues()).toEqual([]);

    const note: HTMLElement = screen.getByRole("alert");

    expect(note).toHaveTextContent(
      "This is set to “postmortem”, which is not one of the choices. Pick one.",
    );
    expect(note).toBe(screen.getByTestId("workflow-argument-about-unknown"));
  });

  test("picking an answer stores it and the note goes", () => {
    const { onChange } = renderField({ value: "postmortem" });

    fireEvent.click(screen.getByRole("radio", { name: "An incident" }));

    expect(onChange).toHaveBeenCalledWith(PageAbout.Incident);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(checkedValues()).toEqual([PageAbout.Incident]);
  });

  test("a value that is not text is shown as it is written", () => {
    renderField({ value: { about: "incident" } });

    expect(checkedValues()).toEqual([]);
    expect(screen.getByRole("alert")).toHaveTextContent(
      'This is set to “{"about":"incident"}”',
    );
  });

  test.each<[unknown, string]>([
    [7, "7"],
    [false, "false"],
    [["incident"], '["incident"]'],
  ])("%p is said as %s", (stored: unknown, said: string) => {
    renderField({ value: stored });

    expect(screen.getByRole("alert")).toHaveTextContent(
      `This is set to “${said}”`,
    );
  });

  test("a long one is cut short, so the note stays a sentence", () => {
    const long: string = "x".repeat(200);

    renderField({ value: long });

    const said: string = screen.getByRole("alert").textContent || "";

    expect(said).toContain(`“${"x".repeat(60)}…”`);
    expect(said).not.toContain("x".repeat(61));
  });

  test("the note is a sentence with the value in it, in one translation", () => {
    expect(UNKNOWN_CHOICE_NOTE).toBe(
      "This is set to “{{value}}”, which is not one of the choices. Pick one.",
    );
  });
});

describe("any Choice setting", () => {
  const SIZE: Argument = {
    id: "size",
    name: "Size",
    description: "How big.",
    type: ComponentInputType.Choice,
    required: false,
    choices: [
      { value: "s", label: "Small" },
      { value: "l", label: "Large", description: "Takes longer." },
    ],
  };

  test("an answer with no line of its own is just its name", () => {
    renderField({ argument: SIZE, dataTestId: "size" });

    expect(screen.getByRole("radiogroup")).toHaveAccessibleName("Size");
    expect(screen.getByRole("radio", { name: "Small" })).toBeChecked();
    expect(
      screen.getByRole("radio", { name: "Small" }),
    ).not.toHaveAccessibleDescription();
    expect(
      screen.getByRole("radio", { name: "Large" }),
    ).toHaveAccessibleDescription("Takes longer.");
  });

  test("without a test id of its own it has the field's", () => {
    renderField({ argument: SIZE, dataTestId: undefined });

    expect(screen.getByTestId("choice-setting-field")).toBeInTheDocument();
    expect(screen.getByTestId("choice-setting-field-s")).toBeChecked();
  });

  test("a setting with no choices draws no rows, and says nothing of an empty value", () => {
    renderField({
      argument: { ...SIZE, choices: [] },
      dataTestId: "size",
    });

    expect(screen.queryAllByRole("radio")).toEqual([]);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
