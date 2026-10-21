import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import {
  SetupGuideStepVariants,
  SetupGuideStepVariantView,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuideSteps";

/*
 * The tabs of one guide step. A step whose tabs change (another option
 * picked above it, or a page that fills its tabs in from the project) starts
 * on the first tab — and does so in the same render, so nothing else is
 * ever shown first and a tab the reader picks right away is not switched
 * back afterwards.
 */

interface ProbeProps {
  name: string;
  shown: Array<string>;
}

/*
 * Records every tab whose content reaches the screen. The panel keeps one
 * Probe and changes its name, so it records on every change of name.
 */
const Probe: React.FunctionComponent<ProbeProps> = (
  props: ProbeProps,
): React.ReactElement => {
  React.useLayoutEffect(() => {
    props.shown.push(props.name);
  }, [props.name, props.shown]);
  return <p>{props.name} body</p>;
};

const variants: (
  labels: Array<string>,
  shown: Array<string>,
) => Array<SetupGuideStepVariantView> = (
  labels: Array<string>,
  shown: Array<string>,
): Array<SetupGuideStepVariantView> => {
  return labels.map((label: string): SetupGuideStepVariantView => {
    return { label, content: <Probe name={label} shown={shown} /> };
  });
};

const selectedTab: () => string | null = (): string | null => {
  return (
    screen.getAllByRole("tab").find((tab: HTMLElement): boolean => {
      return tab.getAttribute("aria-selected") === "true";
    })?.textContent || null
  );
};

describe("SetupGuideStepVariants", () => {
  afterEach(() => {
    cleanup();
  });

  test("opens on the first tab and shows only its content", () => {
    const shown: Array<string> = [];
    render(
      <SetupGuideStepVariants
        variants={variants(["Script", "Compose"], shown)}
      />,
    );

    expect(selectedTab()).toBe("Script");
    expect(screen.getByText("Script body")).toBeInTheDocument();
    expect(screen.queryByText("Compose body")).not.toBeInTheDocument();
    expect(shown).toEqual(["Script"]);
  });

  test("keeps the reader's tab when the step re-renders with the same tabs", () => {
    const shown: Array<string> = [];
    const { rerender } = render(
      <SetupGuideStepVariants
        variants={variants(["Script", "Compose"], shown)}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Compose" }));
    expect(selectedTab()).toBe("Compose");

    // New variant objects and content, same labels: the pick stays.
    rerender(
      <SetupGuideStepVariants
        variants={variants(["Script", "Compose"], shown)}
      />,
    );

    expect(selectedTab()).toBe("Compose");
    expect(screen.getByText("Compose body")).toBeInTheDocument();
  });

  test("a different set of tabs starts on its first, from the first render", () => {
    const shown: Array<string> = [];
    const { rerender } = render(
      <SetupGuideStepVariants
        variants={variants(["Script", "Compose"], shown)}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Compose" }));
    expect(shown).toEqual(["Script", "Compose"]);

    rerender(
      <SetupGuideStepVariants
        variants={variants(["Internal note", "Public update"], shown)}
      />,
    );

    expect(selectedTab()).toBe("Internal note");
    expect(screen.getByText("Internal note body")).toBeInTheDocument();
    /*
     * The second tab of the new set was never on screen, not even for the
     * one render before a reset: the reset happens while rendering.
     */
    expect(shown).toEqual(["Script", "Compose", "Internal note"]);

    // And the reader can move on from there.
    fireEvent.click(screen.getByRole("tab", { name: "Public update" }));
    expect(selectedTab()).toBe("Public update");
    expect(screen.getByText("Public update body")).toBeInTheDocument();
  });

  test("a single variant is shown without tabs", () => {
    const shown: Array<string> = [];
    render(<SetupGuideStepVariants variants={variants(["Only"], shown)} />);

    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.getByText("Only body")).toBeInTheDocument();
  });
});
