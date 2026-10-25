/*
 * "On phones a Card hides its description, so every Delete page shows only
 * a title and a red button." Below md a card hides its description: its body
 * (a table, fields, a form) says what it holds. A card with no body - every
 * Delete page's, Duplicate's, a key's Reset - is a title, a sentence and a
 * button, and the sentence is all it says, so it is kept at every width,
 * in the title's block: the card reads in order - what it is, what it does,
 * then its button, which a phone puts on the next line at the right edge.
 */
jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return ["ProjectOwner"];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<string> } => {
        return { globalPermissions: ["ProjectOwner"] };
      },
    },
  };
});

import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import Card, {
  CARD_DESCRIPTION_CLASS_NAME,
  CARD_DESCRIPTION_KEPT_ON_PHONES_CLASS_NAME,
  CARD_DESCRIPTION_UNDER_ACTIONS_CLASS_NAME,
  CARD_DESCRIPTION_UNDER_ACTIONS_KEPT_ON_PHONES_CLASS_NAME,
  CardButtonSchema,
  isCardDescriptionAllItSays,
} from "../../../UI/Components/Card/Card";
import CardSections from "../../../UI/Components/Card/CardSections";
import DuplicateModel from "../../../UI/Components/DuplicateModel/DuplicateModel";
import ModelDelete from "../../../UI/Components/ModelDelete/ModelDelete";
import ResetObjectID from "../../../UI/Components/ResetObjectID/ResetObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ApiKey from "../../../Models/DatabaseModels/ApiKey";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import { resolveFlex } from "../../ResponsiveFlexLayout";
import { resolveSpacing } from "../../ResponsiveSpacing";
import {
  LAPTOP_WIDTH_IN_PX,
  PHONE_WIDTH_IN_PX,
  TABLET_WIDTH_IN_PX,
  WIDE_DESKTOP_WIDTH_IN_PX,
  describeVisibility,
} from "../../ResponsiveVisibility";
import "@testing-library/jest-dom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

const EVERY_WIDTH: Array<number> = [
  PHONE_WIDTH_IN_PX,
  TABLET_WIDTH_IN_PX,
  LAPTOP_WIDTH_IN_PX,
  WIDE_DESKTOP_WIDTH_IN_PX,
];

const DELETE: CardButtonSchema = {
  title: "Delete Workflow",
  icon: IconProp.Trash,
  buttonStyle: ButtonStyleType.DANGER,
  onClick: (): void => {},
};

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

const description: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId("card-description");
};

const classOf: (element: Element) => string = (element: Element): string => {
  return element.getAttribute("class") || "";
};

const expectShownAtEveryWidth: (element: HTMLElement) => void = (
  element: HTMLElement,
): void => {
  for (const width of EVERY_WIDTH) {
    expect(describeVisibility(element, width)).toBe(`visible at ${width}px`);
    expect(
      describeVisibility(element, width, { withForeignHiddenRule: true }),
    ).toBe(`visible at ${width}px with a foreign .hidden rule on the page`);
  }
};

describe("a card with no body keeps its description on a phone", () => {
  test("a title, a sentence and a button: the sentence is drawn at every width", () => {
    render(
      <Card
        title="Delete Workflow"
        description="Permanently delete Notify on-call. This action cannot be undone."
        buttons={[DELETE]}
      />,
    );

    expectShownAtEveryWidth(description());
    expect(description()).not.toHaveClass("max-md:hidden");
  });

  test("it reads in order: the title, the sentence under it, then the button", () => {
    render(
      <Card
        title="Delete Workflow"
        description="Permanently delete Notify on-call."
        buttons={[DELETE]}
      />,
    );

    const header: HTMLElement = screen.getByTestId("card-header");
    const titleBlock: HTMLElement = screen.getByTestId(
      "card-header-title-block",
    );

    expect(header).toHaveAttribute("data-header-layout", "default");
    // The sentence stays under the title, in its block; the button follows.
    expect(titleBlock).toContainElement(description());
    expect(Array.from(header.children)).toEqual([
      titleBlock,
      screen.getByTestId("card-header-actions"),
    ]);
    expect(screen.getByTestId("card").textContent).toBe(
      "Delete WorkflowPermanently delete Notify on-call.Delete Workflow",
    );
    expect(description().getAttribute("class")).toBe(
      CARD_DESCRIPTION_KEPT_ON_PHONES_CLASS_NAME,
    );
  });

  test("on a phone the button follows the sentence, at the right edge", () => {
    render(
      <Card
        title="Delete Workflow"
        description="Permanently delete Notify on-call. This action cannot be undone."
        buttons={[DELETE]}
      />,
    );

    const header: HTMLElement = screen.getByTestId("card-header");
    const actions: HTMLElement = screen.getByTestId("card-header-actions");

    // The row wraps on a phone, and the button keeps the right edge.
    expect(resolveFlex(classOf(header), PHONE_WIDTH_IN_PX, "flex-wrap")).toBe(
      "wrap",
    );
    expect(
      Number.isNaN(resolveSpacing(classOf(actions), PHONE_WIDTH_IN_PX, "margin").left),
    ).toBe(true);
    expect(
      resolveFlex(classOf(actions), PHONE_WIDTH_IN_PX, "justify-content"),
    ).toBe("flex-end");
  });

  test("a stacked header keeps it too, 9px under the title's line", () => {
    render(
      <Card
        title="Delete Workflow"
        description="Permanently delete Notify on-call."
        buttons={[DELETE]}
        headerLayout="stacked"
      />,
    );

    expect(description().getAttribute("class")).toBe(
      CARD_DESCRIPTION_UNDER_ACTIONS_KEPT_ON_PHONES_CLASS_NAME,
    );
    expectShownAtEveryWidth(description());
  });

  test("with no actions it keeps the default header, the sentence under the title", () => {
    render(
      <Card title="Billing" description="Your plan renews on the 1st." />,
    );

    expect(screen.getByTestId("card-header")).toHaveAttribute(
      "data-header-layout",
      "default",
    );
    expect(screen.getByTestId("card-header-title-block")).toContainElement(
      description(),
    );
    expect(description().getAttribute("class")).toBe(
      CARD_DESCRIPTION_KEPT_ON_PHONES_CLASS_NAME,
    );
    expectShownAtEveryWidth(description());
  });

  test("a toolbar header stays a toolbar, and keeps the sentence too", () => {
    render(
      <Card
        title="Runbooks"
        description="Reusable response procedures."
        buttons={[DELETE]}
        headerLayout="toolbar"
      />,
    );

    expect(screen.getByTestId("card-header")).toHaveAttribute(
      "data-header-layout",
      "toolbar",
    );
    expectShownAtEveryWidth(description());
  });

  test("a section of a card with no body of its own keeps it as well", () => {
    render(
      <CardSections>
        <Card
          title="Reset Secret Key"
          description="A new key replaces this one."
          buttons={[DELETE]}
        />
      </CardSections>,
    );

    expectShownAtEveryWidth(description());
  });
});

describe("a card with a body hides its description on a phone, as before", () => {
  test.each([
    ["default", undefined],
    ["stacked", "stacked"],
    ["toolbar", "toolbar"],
  ] as Array<[string, "stacked" | "toolbar" | undefined]>)(
    "the %s header",
    (_name: string, headerLayout: "stacked" | "toolbar" | undefined) => {
      render(
        <Card
          title="Workflows"
          description="Automations that run when something happens."
          buttons={[DELETE]}
          headerLayout={headerLayout}
        >
          <div>The workflows</div>
        </Card>,
      );

      expect(describeVisibility(description(), PHONE_WIDTH_IN_PX)).toContain(
        "hidden at 375px",
      );
      expect(describeVisibility(description(), LAPTOP_WIDTH_IN_PX)).toBe(
        "visible at 1280px",
      );
      expect([
        CARD_DESCRIPTION_CLASS_NAME,
        CARD_DESCRIPTION_UNDER_ACTIONS_CLASS_NAME,
      ]).toContain(description().getAttribute("class"));
    },
  );

  test("a card with a body keeps the layout it was given", () => {
    render(
      <Card
        title="Workflows"
        description="Automations that run when something happens."
        buttons={[DELETE]}
      >
        <div>The workflows</div>
      </Card>,
    );

    expect(screen.getByTestId("card-header")).toHaveAttribute(
      "data-header-layout",
      "default",
    );
  });
});

describe("what counts as a body", () => {
  test("nothing, nulls, falses and empty lists are no body; an element is one", () => {
    expect(isCardDescriptionAllItSays(undefined)).toBe(true);
    expect(isCardDescriptionAllItSays([])).toBe(true);
    expect(
      isCardDescriptionAllItSays([
        null as unknown as React.ReactElement,
        false as unknown as React.ReactElement,
      ]),
    ).toBe(true);
    expect(isCardDescriptionAllItSays(<div>body</div>)).toBe(false);
    expect(isCardDescriptionAllItSays([<div key="a">a</div>])).toBe(false);
  });

  test("a card drawn with an empty list keeps its description on a phone", () => {
    render(
      <Card title="Delete Workflow" description="Permanently delete it.">
        {[]}
      </Card>,
    );

    expectShownAtEveryWidth(description());
  });
});

describe("the cards that have no body", () => {
  const WORKFLOW_ID: ObjectID = new ObjectID(
    "11111111-1111-4111-8111-111111111111",
  );

  test("every Delete page's card says what it deletes on a phone", async () => {
    getJestSpyOn(ModelAPI, "getItem").mockImplementation((): any => {
      const workflow: Workflow = new Workflow();
      workflow.name = "Notify on-call";
      return Promise.resolve(workflow);
    });

    render(
      <ModelDelete
        modelType={Workflow}
        modelId={WORKFLOW_ID}
        onDeleteSuccess={(): void => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("model-delete-card-message")).toHaveTextContent(
        "Permanently delete Notify on-call.",
      );
    });

    expectShownAtEveryWidth(description());
    expect(description()).toContainElement(
      screen.getByTestId("model-delete-card-message"),
    );
    expect(
      screen.getByRole("button", { name: "Delete Workflow" }),
    ).toBeInTheDocument();
  });

  test("Duplicate's card says what a copy is on a phone", () => {
    render(
      <DuplicateModel
        modelType={Workflow}
        modelId={WORKFLOW_ID}
        fieldsToDuplicate={{ name: true }}
        fieldsToChange={[]}
      />,
    );

    expect(description()).toHaveTextContent(
      "Duplicating this workflow will create another workflow exactly like this one.",
    );
    expectShownAtEveryWidth(description());
  });

  test("a key's Reset card says what a reset does on a phone; one that shows the key keeps the phone's rule", () => {
    render(
      <ResetObjectID
        modelType={ApiKey}
        fieldName="apiKey"
        title="Reset API Key"
        description="Reset the API Key to a new value."
        modelId={WORKFLOW_ID}
      />,
    );

    expectShownAtEveryWidth(description());
    cleanup();

    render(
      <ResetObjectID
        modelType={ApiKey}
        fieldName="apiKey"
        title="Share Link"
        description="Anyone with the link can open the form."
        modelId={WORKFLOW_ID}
      >
        <p>https://forms.example/abc</p>
      </ResetObjectID>,
    );

    expect(describeVisibility(description(), PHONE_WIDTH_IN_PX)).toContain(
      "hidden at 375px",
    );
  });
});
