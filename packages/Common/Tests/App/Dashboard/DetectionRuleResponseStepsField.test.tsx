import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";

/*
 * A detection rule's response steps on its form (#9621): each step a line -
 * the part of the case's Response Plan it goes under, in the plan's words,
 * and what to do - with Add Step for one more and a bin to take one out. A
 * rule from the library shows the steps it comes with, saying so, until
 * one is changed; a rule carries at most ten.
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
import {
  DETECTION_RULE_RESPONSE_STEPS_MAX,
  DetectionRuleResponsePhase,
  DetectionRuleResponseStep,
} from "../../../Types/SecurityEvent/DetectionRuleResponseSteps";
import { getDetectionRuleLibraryResponseSteps } from "../../../Types/SecurityEvent/DetectionRuleLibraryResponseSteps";

const BRUTE_FORCE_ID: string = "acf2a37e-301a-46de-87c7-d4343f3a8445";
const BRUTE_FORCE_YAML: string = `title: Brute force from one IP address\nid: ${BRUTE_FORCE_ID}\n`;
const OWN_YAML: string = "title: Our own rule\n";

const PAGE: DetectionRuleResponseStep = {
  id: "page-payments",
  phase: DetectionRuleResponsePhase.Contain,
  text: "Page the payments on-call.",
};

function draw(data: {
  value: unknown;
  sigmaRuleYaml?: string;
  error?: string;
}): jest.Mock<(steps: Array<DetectionRuleResponseStep>) => void> {
  const onChange: jest.Mock<(steps: Array<DetectionRuleResponseStep>) => void> =
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

function lastChange(
  onChange: jest.Mock<(steps: Array<DetectionRuleResponseStep>) => void>,
): Array<DetectionRuleResponseStep> {
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
    const onChange: jest.Mock<
      (steps: Array<DetectionRuleResponseStep>) => void
    > = draw({ value: [PAGE] });

    fireEvent.click(screen.getByTestId(IDS.add));

    const steps: Array<DetectionRuleResponseStep> = lastChange(onChange);

    expect(steps).toHaveLength(2);
    expect(steps[0]).toEqual(PAGE);
    expect(steps[1]).toMatchObject({ phase: "Contain", text: "" });
    expect(steps[1]!.id).not.toBe(PAGE.id);
  });

  test("its words are typed into its line, at most 300 characters, its id kept", () => {
    const onChange: jest.Mock<
      (steps: Array<DetectionRuleResponseStep>) => void
    > = draw({ value: [PAGE] });
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
    const onChange: jest.Mock<
      (steps: Array<DetectionRuleResponseStep>) => void
    > = draw({
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
    const onChange: jest.Mock<
      (steps: Array<DetectionRuleResponseStep>) => void
    > = draw({ value: null, sigmaRuleYaml: BRUTE_FORCE_YAML });

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
