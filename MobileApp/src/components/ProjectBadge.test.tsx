import React from "react";
import { render, screen } from "@testing-library/react-native";
import { describe, expect, test } from "@jest/globals";
import ProjectBadge from "./ProjectBadge";
import { darkColors } from "../theme";

/*
 * The badge that tells a responder WHICH project a row belongs to. It only
 * appears on the lists that span several projects, which is exactly when
 * getting it wrong matters: two projects can easily hold a monitor called
 * "api" or an incident called "Checkout is down", and this badge is the only
 * thing on the card that tells them apart.
 */

type RenderedElement = ReturnType<typeof screen.getByText>;

function styleOf(element: RenderedElement): Record<string, unknown> {
  return element.props.style as Record<string, unknown>;
}

function dotBeside(label: RenderedElement): RenderedElement {
  const row: RenderedElement = label.parent as RenderedElement;
  return row.children[0] as RenderedElement;
}

describe("What the badge shows", () => {
  test("the project's name, exactly as it was given", async () => {
    await render(<ProjectBadge name="Acme Production" />);

    expect(screen.getByText("Acme Production")).toBeTruthy();
  });

  test("a long name is held to a single line rather than pushing the card apart", async () => {
    /*
     * The badge sits in a row beside the type chip and the number chip on a
     * card whose height the list has already measured. A name allowed to wrap
     * would reflow that row and shove the chips off the card.
     */
    await render(
      <ProjectBadge name="Acme Production Europe West Region Cluster" />,
    );

    const label: RenderedElement = screen.getByText(
      "Acme Production Europe West Region Cluster",
    );
    expect(label.props.numberOfLines).toBe(1);
  });

  test("a name that is only whitespace still renders the badge rather than throwing", async () => {
    await render(<ProjectBadge name="   " />);

    expect(screen.getByText("   ")).toBeTruthy();
  });
});

describe("The colour of the dot", () => {
  test("with no colour given it uses the app's default accent", async () => {
    await render(<ProjectBadge name="Acme Production" />);

    expect(
      styleOf(dotBeside(screen.getByText("Acme Production"))).backgroundColor,
    ).toBe(darkColors.actionPrimary);
  });

  test("a colour from the caller replaces the default", async () => {
    /*
     * This is how a project's own colour reaches the badge, so two projects in
     * one list can be told apart at a glance rather than by reading.
     */
    await render(<ProjectBadge name="Acme Production" color="#22c55e" />);

    expect(
      styleOf(dotBeside(screen.getByText("Acme Production"))).backgroundColor,
    ).toBe("#22c55e");
  });

  test("an empty colour string falls back to the accent instead of drawing nothing", async () => {
    /*
     * An empty string is what a project with its colour field present but
     * unset produces once it has been through a hex conversion. Passing it
     * straight to backgroundColor would leave an invisible dot and a name
     * floating with a gap in front of it.
     */
    await render(<ProjectBadge name="Acme Production" color="" />);

    expect(
      styleOf(dotBeside(screen.getByText("Acme Production"))).backgroundColor,
    ).toBe(darkColors.actionPrimary);
  });
});
