import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import InvestigationStatusBadge, {
  STATUS_BADGE_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationStatusBadge";
import {
  REMEDIATION_DECISION_STATUS_TEXT,
  RemediationDecisionTone,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationDecisionLines";
import { REMEDIATION_DECISION_TONE_MARK } from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationDecisionList";
import RemediationDecisionStatusBadge, {
  renderRemediationStatusIndicator,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationDecisionStatusBadge";
import IconProp from "../../../Types/Icon/IconProp";
import Icon from "../../../UI/Components/Icon/Icon";

/*
 * The Remediation card's status, at the right of its header: what
 * auto-remediation did, in a few words, so "did it fix itself?" is answered
 * before a sentence is read.
 *
 * It sits on the incident's page beside the AI Investigation card, so it is
 * that card's neutral pill: only the small mark in front of the words
 * carries colour. A decision that waits for the investigation pulses like a
 * running investigation; one that needs attention carries the warning
 * triangle its line carries.
 */

const TONES: Array<RemediationDecisionTone> = [
  "waiting",
  "attention",
  "acted",
  "info",
];

function pill(): HTMLElement {
  return screen.getByTestId("remediation-decision-status");
}

// The d attribute an Icon draws, to tell one glyph from another.
function pathOf(icon: IconProp): string {
  const view: ReturnType<typeof render> = render(<Icon icon={icon} />);
  const path: string =
    view.container.querySelector("path")?.getAttribute("d") || "";
  view.unmount();
  return path;
}

function markPath(): string {
  return pill().querySelector("svg path")?.getAttribute("d") || "";
}

function markClass(): string {
  return pill().querySelector("svg")?.getAttribute("class") || "";
}

function renderTone(tone: RemediationDecisionTone): ReturnType<typeof render> {
  return render(
    <RemediationDecisionStatusBadge
      status={{ tone, text: REMEDIATION_DECISION_STATUS_TEXT[tone] }}
    />,
  );
}

afterEach(() => {
  cleanup();
});

describe("RemediationDecisionStatusBadge", () => {
  test.each([
    ["waiting" as RemediationDecisionTone, "Waiting for investigation"],
    ["attention" as RemediationDecisionTone, "Needs attention"],
    ["acted" as RemediationDecisionTone, "Action taken"],
    ["info" as RemediationDecisionTone, "No action taken"],
  ])(
    "says a decision of %s lines as %j",
    (tone: RemediationDecisionTone, text: string) => {
      renderTone(tone);

      expect(pill()).toHaveTextContent(text);
      expect(pill()).toHaveAttribute("data-tone", tone);
      // A div, since the icon inside it renders a div of its own.
      expect(pill().tagName).toBe("DIV");
    },
  );

  test("is the AI Investigation card's pill, whatever the tone", () => {
    const classNames: Array<string> = TONES.map(
      (tone: RemediationDecisionTone): string => {
        const view: ReturnType<typeof render> = renderTone(tone);
        const className: string = pill().className;
        view.unmount();
        return className;
      },
    );

    expect(new Set(classNames)).toEqual(new Set([STATUS_BADGE_CLASS_NAME]));

    render(<InvestigationStatusBadge text="Completed" indicator="done" />);
    expect(screen.getByLabelText("Investigation status").className).toBe(
      STATUS_BADGE_CLASS_NAME,
    );

    // Neutral: the pill itself carries no tone's colour.
    expect(STATUS_BADGE_CLASS_NAME).not.toMatch(
      /green|indigo|red|amber|rose|emerald/,
    );
  });

  test("pulses a small dot while remediation waits for the investigation", () => {
    renderTone("waiting");

    expect(pill().querySelector("svg")).toBeNull();
    const dot: HTMLElement = pill().querySelector(
      "span[aria-hidden='true']",
    ) as HTMLElement;
    expect(dot).not.toBeNull();
    expect(dot.firstElementChild).toHaveClass(
      "motion-safe:animate-ping",
      "bg-indigo-500",
    );
  });

  test("marks a decision that needs attention with its line's warning triangle", () => {
    renderTone("attention");

    expect(REMEDIATION_DECISION_TONE_MARK.attention.icon).toBe(IconProp.Alert);
    expect(markPath()).toBe(pathOf(IconProp.Alert));
    expect(markPath()).not.toBe(pathOf(IconProp.Info));
    expect(markClass()).toContain("text-amber-500");
  });

  test.each([
    ["acted" as RemediationDecisionTone, IconProp.Check, "text-green-600"],
    ["info" as RemediationDecisionTone, IconProp.Info, "text-gray-400"],
  ])(
    "marks a decision of %s lines like the investigation's matching state",
    (tone: RemediationDecisionTone, icon: IconProp, colour: string) => {
      renderTone(tone);

      expect(markPath()).toBe(pathOf(icon));
      expect(markClass()).toContain(colour);
    },
  );

  test("draws every settled mark at the investigation's size, and none animates", () => {
    for (const tone of [
      "attention",
      "acted",
      "info",
    ] as Array<RemediationDecisionTone>) {
      const view: ReturnType<typeof render> = render(
        renderRemediationStatusIndicator(tone),
      );
      const svgClass: string =
        view.container.querySelector("svg")?.getAttribute("class") || "";

      expect({ tone, svgClass }).toEqual({
        tone,
        svgClass: expect.stringContaining("h-3.5 w-3.5"),
      });
      expect(svgClass).not.toContain("animate");
      view.unmount();
    }
  });

  test("keeps the mark in front of the words", () => {
    renderTone("info");

    const children: Array<Element> = Array.from(pill().children);
    expect(children).toHaveLength(2);
    expect(children[0]!.querySelector("svg")).not.toBeNull();
    expect(children[1]).toHaveTextContent("No action taken");
  });

  test("leaves the mark out of what a screen reader reads", () => {
    for (const tone of TONES) {
      const view: ReturnType<typeof render> = renderTone(tone);

      for (const svg of Array.from(pill().querySelectorAll("svg"))) {
        expect(svg).toHaveAttribute("aria-hidden", "true");
      }
      expect(pill()).toHaveTextContent(REMEDIATION_DECISION_STATUS_TEXT[tone], {
        normalizeWhitespace: true,
      });
      view.unmount();
    }
  });
});
