/*
 * The Returns section of a step's settings dialog: what each value is, and
 * the reference a later step uses to read it, with a button to copy it.
 */

import ComponentReturnValueViewer from "../../../../UI/Components/Workflow/ComponentReturnValueViewer";
import {
  ComponentInputType,
  ReturnValue,
} from "../../../../Types/Workflow/Component";
import { afterEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import {
  RenderResult,
  act,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";

const RETURN_VALUES: Array<ReturnValue> = [
  {
    id: "request-headers",
    name: "Request Headers",
    description: "The headers the caller sent, by header name.",
    type: ComponentInputType.StringDictionary,
    required: false,
  },
  {
    id: "request-body",
    name: "Request Body",
    description: "The body the caller sent.",
    type: ComponentInputType.JSON,
    required: false,
  },
];

type SetClipboardFunction = (
  writeText: ((text: string) => Promise<void>) | null,
) => void;

const setClipboard: SetClipboardFunction = (
  writeText: ((text: string) => Promise<void>) | null,
): void => {
  Object.defineProperty(navigator, "clipboard", {
    value: writeText ? { writeText: writeText } : undefined,
    configurable: true,
  });
};

afterEach(() => {
  setClipboard(null);
});

describe("ComponentReturnValueViewer", () => {
  test("one row per value, with its name, type and description", () => {
    const { getAllByTestId }: RenderResult = render(
      <ComponentReturnValueViewer
        name=""
        description=""
        returnValues={RETURN_VALUES}
        componentId="webhook-1"
      />,
    );

    const rows: Array<HTMLElement> = getAllByTestId("workflow-return-value");

    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Request Headers");
    expect(rows[0]).toHaveTextContent(
      "The headers the caller sent, by header name.",
    );
    expect(
      within(rows[0]!).getByTestId("workflow-return-value-type"),
    ).toHaveTextContent("Dictionary of String");
    expect(
      within(rows[1]!).getByTestId("workflow-return-value-type"),
    ).toHaveTextContent("JSON");
  });

  test("each row shows the exact reference that reads it", () => {
    const { getAllByTestId }: RenderResult = render(
      <ComponentReturnValueViewer
        name=""
        description=""
        returnValues={RETURN_VALUES}
        componentId="webhook-1"
      />,
    );

    expect(
      getAllByTestId("workflow-return-value-reference").map(
        (reference: HTMLElement) => {
          return reference.textContent;
        },
      ),
    ).toEqual([
      "{{local.components.webhook-1.returnValues.request-headers}}",
      "{{local.components.webhook-1.returnValues.request-body}}",
    ]);
  });

  test("a reference wraps only after its dots, never inside a name", () => {
    const { getAllByTestId }: RenderResult = render(
      <ComponentReturnValueViewer
        name=""
        description=""
        returnValues={RETURN_VALUES}
        componentId="webhook-1"
      />,
    );

    const reference: HTMLElement = getAllByTestId(
      "workflow-return-value-reference",
    )[0]!;

    // The old viewer set overflow-wrap: anywhere inline.
    expect(reference.getAttribute("style") || "").not.toMatch(/overflow-wrap/);
    expect(reference.className).not.toMatch(/break-all|break-words/);

    const parts: Array<string> = Array.from(
      reference.querySelectorAll("span"),
    ).map((part: HTMLSpanElement) => {
      return part.textContent || "";
    });

    expect(parts).toEqual([
      "{{local.",
      "components.",
      "webhook-1.",
      "returnValues.",
      "request-headers}}",
    ]);
  });

  test("every reference has its own copy button, named for the value", () => {
    const { getByRole }: RenderResult = render(
      <ComponentReturnValueViewer
        name=""
        description=""
        returnValues={RETURN_VALUES}
        componentId="webhook-1"
      />,
    );

    expect(
      getByRole("button", { name: "Copy the reference to Request Headers" }),
    ).toBeInTheDocument();
    expect(
      getByRole("button", { name: "Copy the reference to Request Body" }),
    ).toBeInTheDocument();
  });

  test("the copy button copies exactly that row's reference", async () => {
    const copied: Array<string> = [];

    setClipboard(async (text: string): Promise<void> => {
      copied.push(text);
    });

    const { getByRole }: RenderResult = render(
      <ComponentReturnValueViewer
        name=""
        description=""
        returnValues={RETURN_VALUES}
        componentId="webhook-1"
      />,
    );

    await act(async () => {
      fireEvent.click(
        getByRole("button", { name: "Copy the reference to Request Body" }),
      );
    });

    await waitFor(() => {
      expect(copied).toEqual([
        "{{local.components.webhook-1.returnValues.request-body}}",
      ]);
    });
  });

  test("references follow the step's identifier", () => {
    const { getAllByTestId }: RenderResult = render(
      <ComponentReturnValueViewer
        name=""
        description=""
        returnValues={RETURN_VALUES}
        componentId="ci-webhook"
      />,
    );

    expect(
      getAllByTestId("workflow-return-value-reference")[0],
    ).toHaveTextContent(
      "{{local.components.ci-webhook.returnValues.request-headers}}",
    );
  });

  test("without an identifier it shows each value's id and nothing to copy", () => {
    const { getAllByTestId, queryAllByRole, queryAllByTestId }: RenderResult =
      render(
        <ComponentReturnValueViewer
          name=""
          description=""
          returnValues={RETURN_VALUES}
        />,
      );

    expect(
      getAllByTestId("workflow-return-value-id").map((id: HTMLElement) => {
        return id.textContent;
      }),
    ).toEqual(["request-headers", "request-body"]);
    expect(queryAllByTestId("workflow-return-value-reference")).toHaveLength(0);
    expect(queryAllByRole("button")).toHaveLength(0);
  });

  test("says so when a step returns nothing", () => {
    const { getByText, queryAllByTestId }: RenderResult = render(
      <ComponentReturnValueViewer
        name=""
        description=""
        returnValues={[]}
        componentId="log-1"
      />,
    );

    expect(getByText("This step does not return any data.")).toBeVisible();
    expect(queryAllByTestId("workflow-return-value")).toHaveLength(0);
  });

  test("keeps its optional heading and description", () => {
    const { getByText }: RenderResult = render(
      <ComponentReturnValueViewer
        name="Returns"
        description="Data for later steps."
        returnValues={RETURN_VALUES}
        componentId="webhook-1"
      />,
    );

    expect(getByText("Returns")).toBeVisible();
    expect(getByText("Data for later steps.")).toBeVisible();
  });
});
