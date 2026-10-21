/*
 * The Inputs and Outputs sections of a step's settings dialog: a plain list of
 * each port's title and what it is for.
 */

import ComponentPortViewer from "../../../../UI/Components/Workflow/ComponentPortViewer";
import { Port } from "../../../../Types/Workflow/Component";
import { describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { RenderResult, render } from "@testing-library/react";
import React from "react";

const PORTS: Array<Port> = [
  {
    id: "success",
    title: "Success",
    description: "Runs when the server answers with a success status (2xx).",
  },
  {
    id: "error",
    title: "Error",
    description:
      "Runs when the request fails or the server answers with an error status.",
  },
];

describe("ComponentPortViewer", () => {
  test("lists each port's title and description, in order", () => {
    const { getAllByTestId }: RenderResult = render(
      <ComponentPortViewer name="" description="" ports={PORTS} />,
    );

    const rows: Array<HTMLElement> = getAllByTestId("workflow-port");

    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent(
      "SuccessRuns when the server answers with a success status (2xx).",
    );
    expect(rows[1]).toHaveTextContent(
      "ErrorRuns when the request fails or the server answers with an error status.",
    );
  });

  test("does not show the internal port id next to its title", () => {
    const { getAllByTestId }: RenderResult = render(
      <ComponentPortViewer
        name=""
        description=""
        ports={[{ id: "out", title: "Out", description: "Runs next." }]}
      />,
    );

    // "Out out" in the old viewer: the id only repeated the title.
    expect(getAllByTestId("workflow-port")[0]!.textContent).toBe(
      "OutRuns next.",
    );
  });

  test("a port without a description is just its title", () => {
    const { getAllByTestId }: RenderResult = render(
      <ComponentPortViewer
        name=""
        description=""
        ports={[{ id: "in", title: "In", description: "" }]}
      />,
    );

    expect(getAllByTestId("workflow-port")[0]!.textContent).toBe("In");
  });

  test("the bullet is decoration, hidden from screen readers", () => {
    const { getAllByTestId }: RenderResult = render(
      <ComponentPortViewer name="" description="" ports={PORTS} />,
    );

    const bullet: Element | null =
      getAllByTestId("workflow-port")[0]!.firstElementChild;

    expect(bullet).toHaveAttribute("aria-hidden", "true");
    expect(bullet?.textContent).toBe("");
  });

  test("says so when there are no ports", () => {
    const { getByText, queryAllByTestId }: RenderResult = render(
      <ComponentPortViewer name="" description="" ports={[]} />,
    );

    expect(getByText("No connections.")).toBeVisible();
    expect(queryAllByTestId("workflow-port")).toHaveLength(0);
  });
});
