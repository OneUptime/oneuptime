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
  RenderResult,
  screen,
} from "@testing-library/react";
import React, { ReactElement } from "react";

/*
 * "What happened", the first card of an incident's, alert's or episode's
 * overview: the record's description and its root cause, which the overview
 * did not show before (they lived on pages of their own). What it says with
 * and without them, how a long one folds, and who may edit both, in one
 * dialog that saves through the page.
 */

interface RecordedModalProps {
  title: string;
  modelType: unknown;
  modelIdToEdit?: { toString: () => string };
  modalWidth?: string;
  submitButtonText?: string;
  formProps: {
    formType: string;
    fields: Array<{
      field: Record<string, boolean>;
      title: string;
      fieldType: string;
      description?: string;
      required?: boolean;
    }>;
  };
  onSuccess: (item: unknown) => void;
  onClose: () => void;
}

const modalProps: Array<RecordedModalProps> = [];

jest.mock("../../../UI/Components/ModelFormModal/ModelFormModal", () => {
  return {
    __esModule: true,
    default: (props: RecordedModalProps): ReactElement => {
      modalProps.push(props);
      return React.createElement("div", {
        "data-testid": "edit-what-happened-modal",
      });
    },
  };
});

// The viewer itself is MarkdownViewer's suites'; here, what it is handed.
jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): ReactElement => {
      return React.createElement(
        "div",
        { "data-testid": "markdown" },
        props.text,
      );
    },
  };
});

import EventWhatHappenedCard, {
  STATUS_PAGE_DESCRIPTION_HELP,
  WHAT_HAPPENED_CARD_TITLE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventWhatHappenedCard";
import Incident from "../../../Models/DatabaseModels/Incident";
import Alert from "../../../Models/DatabaseModels/Alert";
import ObjectID from "../../../Types/ObjectID";
import { FormType } from "../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import { ModalWidth } from "../../../UI/Components/Modal/Modal";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";

const INCIDENT_ID: string = "20000000-0000-4000-8000-000000001042";

let gate: PermissionGateResult = { isAllowed: true };

beforeEach(() => {
  gate = { isAllowed: true };
  modalProps.length = 0;
  jest.spyOn(PermissionGate, "checkFormUpdate").mockImplementation(() => {
    return gate;
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function renderCard(props: {
  description?: string;
  rootCause?: string;
  onSaved?: () => void;
  modelType?: typeof Incident | typeof Alert;
  isDescriptionOnStatusPages?: boolean;
}): RenderResult {
  return render(
    <EventWhatHappenedCard<Incident | Alert>
      modelType={(props.modelType || Incident) as typeof Incident}
      modelId={new ObjectID(INCIDENT_ID)}
      description={props.description}
      rootCause={props.rootCause}
      isDescriptionOnStatusPages={props.isDescriptionOnStatusPages}
      onSaved={props.onSaved || ((): void => {})}
    />,
  );
}

describe("what the card says", () => {
  test("leads with the description, then the root cause under its own heading", () => {
    renderCard({
      description:
        "The API monitor for POST /api/checkout reported p95 latency of **2.4s**.",
      rootCause: "checkout-api started with `DB_POOL_MAX=10` (was 40).",
    });

    expect(
      screen.getByRole("heading", { name: WHAT_HAPPENED_CARD_TITLE }),
    ).toBeVisible();

    // Each is markdown, read by the viewer the Description page uses.
    const [description, rootCauseText] = screen.getAllByTestId("markdown");

    expect(description).toHaveTextContent(
      "The API monitor for POST /api/checkout reported p95 latency of **2.4s**.",
    );
    expect(rootCauseText).toHaveTextContent(
      "checkout-api started with `DB_POOL_MAX=10` (was 40).",
    );

    const rootCause: HTMLElement = screen.getByRole("region", {
      name: "Root cause",
    });

    expect(rootCause).toContainElement(rootCauseText!);
    expect(screen.getByTestId("what-happened-description")).toContainElement(
      description!,
    );
    expect(
      screen.getByTestId("what-happened-description"),
    ).not.toHaveTextContent("DB_POOL_MAX");
  });

  test("says plainly when nothing has been written yet", () => {
    renderCard({});

    expect(
      screen.getByTestId("what-happened-description-empty"),
    ).toHaveTextContent("No description yet.");
    expect(
      screen.getByTestId("what-happened-root-cause-empty"),
    ).toHaveTextContent("Not identified yet.");
  });

  test("a root cause that is only white space is not one", () => {
    renderCard({ description: "Checkout is slow.", rootCause: "   \n " });

    expect(screen.getByText("Not identified yet.")).toBeVisible();
  });

  test("a root cause without a description still shows, under its heading", () => {
    renderCard({ rootCause: "The pool size was cut to 10." });

    expect(screen.getByText("No description yet.")).toBeVisible();
    expect(screen.getByText("The pool size was cut to 10.")).toBeVisible();
  });

  test("nothing inside the card is a box: the root cause is a section under a hairline", () => {
    renderCard({ description: "Checkout is slow." });

    const section: HTMLElement = screen.getByTestId("what-happened-root-cause");

    expect(section.className).toContain("border-t");
    expect(section.className).not.toContain("rounded");
    expect(section.className).not.toContain("shadow");
    expect(section.className).not.toContain("bg-");
  });
});

describe("a long description or root cause", () => {
  /*
   * jsdom lays nothing out, so heights are given: the text's own height,
   * and the collapsed frame's six lines.
   */
  let contentHeight: number = 0;

  beforeEach(() => {
    contentHeight = 0;
    jest
      .spyOn(HTMLElement.prototype, "scrollHeight", "get")
      .mockImplementation(function (this: HTMLElement): number {
        return this.parentElement
          ?.getAttribute("data-testid")
          ?.endsWith("-text")
          ? contentHeight
          : 0;
      });
    jest
      .spyOn(HTMLElement.prototype, "clientHeight", "get")
      .mockImplementation(function (this: HTMLElement): number {
        return this.getAttribute("data-testid")?.endsWith("-text") ? 144 : 0;
      });
  });

  test("a text that fits shows whole, with no Show more and no fade", () => {
    contentHeight = 96;
    renderCard({ description: "Checkout is slow." });

    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();

    const frame: HTMLElement = screen.getByTestId(
      "what-happened-description-text",
    );

    expect(frame.className).not.toContain("mask-image");
  });

  test("a longer one shows its first lines, fading out, and Show more opens it", () => {
    contentHeight = 400;
    renderCard({ description: "A very long description." });

    const frame: HTMLElement = screen.getByTestId(
      "what-happened-description-text",
    );
    const showMore: HTMLElement = screen.getByRole("button", {
      name: "Show more",
    });

    expect(frame.className).toContain("max-h-36");
    expect(frame.className).toContain("overflow-hidden");
    expect(frame.className).toContain("mask-image");
    expect(showMore).toHaveAttribute("aria-expanded", "false");
    expect(showMore).toHaveAttribute("aria-controls", frame.id);

    fireEvent.click(showMore);

    const showLess: HTMLElement = screen.getByRole("button", {
      name: "Show less",
    });

    expect(showLess).toHaveAttribute("aria-expanded", "true");
    expect(frame.className).not.toContain("max-h-36");
    expect(frame.className).not.toContain("mask-image");

    fireEvent.click(showLess);

    expect(frame.className).toContain("max-h-36");
  });

  test("the description and the root cause fold on their own", () => {
    contentHeight = 400;
    renderCard({
      description: "A very long description.",
      rootCause: "A very long root cause.",
    });

    const [descriptionMore, rootCauseMore] = screen.getAllByRole("button", {
      name: "Show more",
    });

    fireEvent.click(rootCauseMore!);

    expect(descriptionMore).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.getByTestId("what-happened-root-cause-value-text").className,
    ).not.toContain("max-h-36");
    expect(
      screen.getByTestId("what-happened-description-text").className,
    ).toContain("max-h-36");
  });

  test("a different text starts folded again", () => {
    contentHeight = 400;
    const view: RenderResult = renderCard({
      description: "A very long description.",
    });

    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getByRole("button", { name: "Show less" })).toBeVisible();

    view.rerender(
      <EventWhatHappenedCard<Incident>
        modelType={Incident}
        modelId={new ObjectID(INCIDENT_ID)}
        description="Another very long description."
        onSaved={(): void => {}}
      />,
    );

    expect(screen.getByRole("button", { name: "Show more" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});

describe("editing", () => {
  test("Edit opens one dialog for the description and the root cause, on this record", () => {
    renderCard({
      description: "Checkout is slow.",
      isDescriptionOnStatusPages: true,
    });

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByTestId("edit-what-happened-modal")).toBeInTheDocument();

    const props: RecordedModalProps = modalProps[modalProps.length - 1]!;

    expect(props.title).toBe("Edit what happened");
    expect(props.modelType).toBe(Incident);
    expect(props.modelIdToEdit?.toString()).toBe(INCIDENT_ID);
    expect(props.modalWidth).toBe(ModalWidth.Large);
    expect(props.formProps.formType).toBe(FormType.Update);
    expect(
      props.formProps.fields.map(
        (field: RecordedModalProps["formProps"]["fields"][number]) => {
          return [Object.keys(field.field)[0], field.title, field.fieldType];
        },
      ),
    ).toEqual([
      ["description", "Description", FormFieldSchemaType.Markdown],
      ["rootCause", "Root Cause", FormFieldSchemaType.Markdown],
    ]);
    // Neither is required: a record can be saved with either left blank.
    for (const field of props.formProps.fields) {
      expect(field.required).toBe(false);
    }
    /*
     * An incident's description shows on the status pages it appears on;
     * the form says so, in a key of its own the dialog translates.
     */
    expect(props.formProps.fields[0]!.description).toBe(
      "Shown on the status pages this incident appears on.",
    );
    expect(props.formProps.fields[0]!.description).toBe(
      STATUS_PAGE_DESCRIPTION_HELP,
    );
  });

  test("an alert's dialog edits the alert, and says nothing about status pages", () => {
    renderCard({ modelType: Alert });

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const props: RecordedModalProps = modalProps[modalProps.length - 1]!;

    expect(props.modelType).toBe(Alert);
    expect(props.formProps.fields[0]!.description).toBeUndefined();
  });

  test("a save closes the dialog and hands the page the refresh", () => {
    const onSaved: () => void = jest.fn<() => void>();

    renderCard({ onSaved: onSaved });

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    act(() => {
      modalProps[modalProps.length - 1]!.onSuccess(new Incident());
    });

    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("edit-what-happened-modal")).toBeNull();
  });

  test("closing the dialog saves nothing", () => {
    const onSaved: () => void = jest.fn<() => void>();

    renderCard({ onSaved: onSaved });

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    act(() => {
      modalProps[modalProps.length - 1]!.onClose();
    });

    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.queryByTestId("edit-what-happened-modal")).toBeNull();
  });

  test("asks about exactly the two columns it edits", () => {
    renderCard({});

    const [, fields] = (
      PermissionGate.checkFormUpdate as unknown as {
        mock: { calls: Array<[unknown, Array<{ field: object }>]> };
      }
    ).mock.calls[0]!;

    expect(
      fields.map((field: { field: object }) => {
        return Object.keys(field.field)[0];
      }),
    ).toEqual(["description", "rootCause"]);
  });

  test("somebody who may not change them sees Edit locked, with why", () => {
    gate = {
      isAllowed: false,
      disabledReason:
        "You do not have permission to edit this Incident. You need one of these permissions: Project Owner.",
    };

    renderCard({ description: "Checkout is slow." });

    const edit: HTMLElement = screen.getByRole("button", { name: "Edit" });

    expect(edit).toBeDisabled();

    fireEvent.click(edit);

    expect(screen.queryByTestId("edit-what-happened-modal")).toBeNull();
  });

  test("no Edit while there is nothing honest to say about it yet", () => {
    gate = { isAllowed: false };

    renderCard({ description: "Checkout is slow." });

    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });
});
