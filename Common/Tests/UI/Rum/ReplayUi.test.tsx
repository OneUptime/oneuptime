import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { describe, expect, it } from "@jest/globals";
import IconProp from "../../../Types/Icon/IconProp";
import {
  REPLAY_CONTROL_HEIGHT_CLASS,
  ReplayButtonGroup,
  ReplayClock,
  ReplayPill,
  ReplaySwitch,
  ReplayToolButton,
  ReplayToolbarDivider,
  getReplaySegmentClassName,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayUi";

/*
 * The player's shared chrome.
 *
 * These are presentational primitives, so most of what is worth pinning
 * is the part a redesign is most likely to quietly break: the accessible
 * name, the toggle semantics, and the two or three class invariants the
 * whole look rests on (one control height, one radius, "on" drawn
 * differently inside a group than outside one). The visual details that
 * are genuinely taste - which gray, how much padding - are deliberately
 * NOT asserted; a test that pins those makes the design unchangeable
 * without testing anything a viewer would notice.
 */

function noop(): void {
  /* Click handlers the assertion does not care about. */
}

describe("ReplayToolButton accessible name", () => {
  /*
   * The regression this exists for: the button used to fall back to its
   * title for aria-label whenever no explicit label was passed, so the
   * stage's "Fit" button announced itself as "Scale the picture to fit
   * the stage". That breaks WCAG 2.5.3 (Label in Name) - a voice user
   * saying "click Fit" hits a control whose name does not contain the
   * word - and it broke getByRole(name: "Fit") for anyone testing it.
   */
  it("uses the visible label as the name and keeps the title a tooltip", () => {
    render(
      <ReplayToolButton
        label="Fit"
        title="Scale the picture to fit the stage"
        onClick={noop}
      />,
    );

    const button: HTMLElement = screen.getByRole("button", { name: "Fit" });

    expect(button).toHaveAttribute(
      "title",
      "Scale the picture to fit the stage",
    );
    expect(button).not.toHaveAttribute("aria-label");
  });

  it("falls back to the title only when there is no visible text at all", () => {
    render(
      <ReplayToolButton
        icon={IconProp.Keyboard}
        title="Keyboard shortcuts (?)"
        onClick={noop}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Keyboard shortcuts (?)" }),
    ).toHaveAttribute("aria-label", "Keyboard shortcuts (?)");
  });

  it("lets an explicit ariaLabel win over a short visible label", () => {
    render(
      <ReplayToolButton
        label="10s"
        icon={IconProp.Backward}
        ariaLabel="Back 10 seconds (J)"
        title="Back 10 seconds (J)"
        onClick={noop}
      />,
    );

    const button: HTMLElement = screen.getByRole("button", {
      name: "Back 10 seconds (J)",
    });

    expect(button).toHaveTextContent("10s");
  });
});

describe("ReplayToolButton toggle semantics", () => {
  it("renders aria-pressed only when it is actually a toggle", () => {
    const { rerender } = render(
      <ReplayToolButton label="Details" onClick={noop} />,
    );

    expect(screen.getByRole("button")).not.toHaveAttribute("aria-pressed");

    rerender(
      <ReplayToolButton label="Wide" isPressed={false} onClick={noop} />,
    );
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "false");

    rerender(<ReplayToolButton label="Wide" isPressed={true} onClick={noop} />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  });

  it("draws a pressed ghost as a solid fill and a pressed segment as a raised thumb", () => {
    const { rerender } = render(
      <ReplayToolButton label="Wide" isPressed={true} onClick={noop} />,
    );

    /*
     * Outside a group there is no track behind the button, so "on" has to
     * be carried by the button itself.
     */
    expect(screen.getByRole("button").className).toContain("bg-gray-900");

    rerender(
      <ReplayToolButton
        label="Wide"
        variant="segment"
        isPressed={true}
        onClick={noop}
      />,
    );

    /* Inside a group the recessed track is the contrast; the thumb is white. */
    expect(screen.getByRole("button").className).toContain("bg-white");
    expect(screen.getByRole("button").className).toContain("shadow-sm");
  });
});

describe("ReplayToolButton disabled state", () => {
  it("does not fire onClick and is announced as disabled", () => {
    let clicks: number = 0;

    render(
      <ReplayToolButton
        label="Next error"
        isDisabled={true}
        onClick={(): void => {
          clicks += 1;
        }}
      />,
    );

    const button: HTMLElement = screen.getByRole("button", {
      name: "Next error",
    });

    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(clicks).toBe(0);
  });

  it("keeps the disabled look even when the button is a pressed segment", () => {
    render(
      <ReplayToolButton
        label="Tab 3 · no footage"
        variant="segment"
        isPressed={true}
        isDisabled={true}
        onClick={noop}
      />,
    );

    /* Disabled wins: a dead control must never look selected. */
    expect(screen.getByRole("button").className).toContain("text-gray-300");
    expect(screen.getByRole("button").className).not.toContain("shadow-sm");
  });
});

describe("ReplayToolButton geometry", () => {
  it("is square when it draws a single glyph and padded when it draws more", () => {
    const { rerender } = render(
      <ReplayToolButton
        icon={IconProp.Keyboard}
        title="Keyboard shortcuts"
        onClick={noop}
      />,
    );

    expect(screen.getByRole("button").className).toContain("w-8");

    /*
     * "Previous error" is a chevron AND an alert glyph with no label; a
     * 32px square would clip the second one.
     */
    rerender(
      <ReplayToolButton
        icon={IconProp.ChevronLeft}
        trailingIcon={IconProp.Alert}
        title="Previous error"
        onClick={noop}
      />,
    );
    expect(screen.getByRole("button").className).not.toContain("w-8");
    expect(screen.getByRole("button").className).toContain("px-2.5");

    rerender(<ReplayToolButton label="Details" onClick={noop} />);
    expect(screen.getByRole("button").className).toContain("px-2.5");
  });

  /*
   * The single rule the whole chrome rests on: one height. Twenty
   * controls at four different heights is what made the old row look
   * like a pile rather than a toolbar, so every path through the
   * component - ghost, segment, disabled, icon-only - keeps it, and the
   * exported class stays the one source of that number.
   */
  it("gives every variant the same control height and radius", () => {
    const variants: Array<React.ReactElement> = [
      <ReplayToolButton key="a" label="Ghost" onClick={noop} />,
      <ReplayToolButton
        key="b"
        label="Segment"
        variant="segment"
        isPressed={true}
        onClick={noop}
      />,
      <ReplayToolButton
        key="c"
        label="Disabled"
        isDisabled={true}
        onClick={noop}
      />,
      <ReplayToolButton
        key="d"
        icon={IconProp.Info}
        title="Icon only"
        onClick={noop}
      />,
    ];

    variants.forEach((element: React.ReactElement): void => {
      const { unmount } = render(element);
      const button: HTMLElement = screen.getByRole("button");

      expect(button.className).toContain(REPLAY_CONTROL_HEIGHT_CLASS);
      expect(button.className).toContain("rounded-lg");
      unmount();
    });
  });
});

describe("getReplaySegmentClassName", () => {
  /*
   * The header's browser-tab pills and the rail's signal tabs are real
   * tabs (role="tab", aria-selected, roving tabindex), so they cannot be
   * ReplayToolButtons - but they must not look like a fifth kind of chip
   * either. The exported class is what keeps them identical.
   */
  it("matches what a ReplayToolButton segment renders, for each state", () => {
    render(
      <ReplayToolButton
        label="Selected"
        variant="segment"
        isPressed={true}
        onClick={noop}
      />,
    );

    const rendered: string = screen.getByRole("button").className;
    const helper: string = getReplaySegmentClassName({ isSelected: true });

    helper.split(" ").forEach((token: string): void => {
      expect(rendered).toContain(token);
    });
  });

  it("distinguishes selected, idle and disabled", () => {
    const selected: string = getReplaySegmentClassName({ isSelected: true });
    const idle: string = getReplaySegmentClassName({ isSelected: false });
    const disabled: string = getReplaySegmentClassName({
      isSelected: true,
      isDisabled: true,
    });

    expect(selected).toContain("bg-white");
    expect(idle).not.toContain("bg-white ");
    expect(disabled).toContain("cursor-not-allowed");
    expect(disabled).not.toContain("shadow-sm");
  });

  it("keeps the shared height on every state so a tab row cannot go ragged", () => {
    [
      getReplaySegmentClassName({ isSelected: true }),
      getReplaySegmentClassName({ isSelected: false }),
      getReplaySegmentClassName({ isSelected: false, isDisabled: true }),
    ].forEach((className: string): void => {
      expect(className).toContain(REPLAY_CONTROL_HEIGHT_CLASS);
    });
  });
});

describe("ReplayButtonGroup", () => {
  it("is a labelled group holding its members on one recessed track", () => {
    render(
      <ReplayButtonGroup
        ariaLabel="Jump between signals"
        dataTestId="signal-group"
      >
        <ReplayToolButton label="Next error" variant="segment" onClick={noop} />
        <ReplayToolButton
          label="Frustration"
          variant="segment"
          onClick={noop}
        />
      </ReplayButtonGroup>,
    );

    const group: HTMLElement = screen.getByRole("group", {
      name: "Jump between signals",
    });

    expect(group).toBe(screen.getByTestId("signal-group"));
    /* ONE container background for N buttons: no per-button outlines. */
    expect(group.className).toContain("bg-gray-100");
    expect(group.querySelectorAll("button")).toHaveLength(2);
  });

  it("can carry another role for the tablists that reuse the track", () => {
    render(
      <ReplayButtonGroup role="tablist" ariaLabel="Browser tabs">
        <button type="button" role="tab" aria-selected={true}>
          Tab 1
        </button>
      </ReplayButtonGroup>,
    );

    expect(
      screen.getByRole("tablist", { name: "Browser tabs" }),
    ).toBeInTheDocument();
  });
});

describe("ReplayToolbarDivider", () => {
  it("is decorative and never announced", () => {
    render(<ReplayToolbarDivider />);

    expect(screen.getByTestId("replay-toolbar-divider")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });
});

describe("ReplayPill", () => {
  it("renders its text with a tone and an optional pulsing dot", () => {
    render(
      <ReplayPill dataTestId="live" tone="live" hasPulse={true} title="Live">
        Live
      </ReplayPill>,
    );

    const pill: HTMLElement = screen.getByTestId("live");

    expect(pill).toHaveTextContent("Live");
    expect(pill.className).toContain("bg-red-50");
    expect(pill.querySelector(".animate-pulse")).not.toBeNull();
  });

  it("omits the dot unless it is asked for", () => {
    render(<ReplayPill dataTestId="quiet">Sealed</ReplayPill>);

    expect(
      screen.getByTestId("quiet").querySelector(".animate-pulse"),
    ).toBeNull();
  });

  it("passes a role through for the pills that are alerts", () => {
    render(
      <ReplayPill dataTestId="err" tone="danger" role="alert">
        Footage did not arrive.
      </ReplayPill>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Footage did not arrive.",
    );
  });

  /*
   * The buffering pill is a duplicate of what the stage overlay already
   * announces; two live regions meant a screen reader said "Buffering"
   * twice per stall. It stays visible and stays silent.
   */
  it("can hide itself from assistive tech without hiding itself from the eye", () => {
    render(
      <ReplayPill dataTestId="buffering" isHiddenFromScreenReaders={true}>
        Loading footage
      </ReplayPill>,
    );

    expect(screen.getByTestId("buffering")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(screen.getByTestId("buffering")).toHaveTextContent(
      "Loading footage",
    );
  });
});

describe("ReplaySwitch", () => {
  it("is a switch with its state on the pressable element", () => {
    render(
      <ReplaySwitch
        dataTestId="skip-idle"
        label="Skip idle"
        isChecked={false}
        onChange={noop}
      />,
    );

    const control: HTMLElement = screen.getByTestId("skip-idle");

    expect(control).toBe(screen.getByRole("switch"));
    expect(control).toHaveAttribute("aria-checked", "false");
    expect(control).toHaveTextContent("Skip idle");
  });

  /*
   * Common/UI's Toggle calls its consumer's onChange twice per click for
   * anything that also wires onFocus/onBlur; a transport switch that
   * fires twice would toggle the engine's skip-idle intent straight back
   * off. One click, one call, with the NEXT value.
   */
  it("emits exactly one change per click, carrying the next value", () => {
    const values: Array<boolean> = [];

    const { rerender } = render(
      <ReplaySwitch
        dataTestId="skip-idle"
        label="Skip idle"
        isChecked={false}
        onChange={(value: boolean): void => {
          values.push(value);
        }}
      />,
    );

    fireEvent.click(screen.getByTestId("skip-idle"));
    expect(values).toEqual([true]);

    rerender(
      <ReplaySwitch
        dataTestId="skip-idle"
        label="Skip idle"
        isChecked={true}
        onChange={(value: boolean): void => {
          values.push(value);
        }}
      />,
    );

    expect(screen.getByTestId("skip-idle")).toHaveAttribute(
      "aria-checked",
      "true",
    );

    fireEvent.click(screen.getByTestId("skip-idle"));
    expect(values).toEqual([true, false]);
  });

  it("is controlled: it never moves on its own", () => {
    render(
      <ReplaySwitch
        dataTestId="skip-idle"
        label="Skip idle"
        isChecked={false}
        onChange={noop}
      />,
    );

    fireEvent.click(screen.getByTestId("skip-idle"));

    /* The parent did not change the prop, so the switch must not lie. */
    expect(screen.getByTestId("skip-idle")).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("stands at the chrome's own height rather than Common/UI's 24px toggle", () => {
    render(
      <ReplaySwitch
        dataTestId="skip-idle"
        label="Skip idle"
        isChecked={false}
        onChange={noop}
      />,
    );

    expect(screen.getByTestId("skip-idle").className).toContain(
      REPLAY_CONTROL_HEIGHT_CLASS,
    );
  });
});

describe("ReplayClock", () => {
  /*
   * The readout is two spans so the elapsed half can carry the weight -
   * but its TEXT is still read as one string by the E2E clock
   * assertions and by anyone copying it. Two adjacent spans separated by
   * nothing but a flex gap would render "0:12/ 10:00".
   */
  it("reads as one 'current / total' string", () => {
    render(
      <ReplayClock
        dataTestId="replay-time"
        currentText="0:12"
        totalText="10:00"
      />,
    );

    expect(screen.getByTestId("replay-time")).toHaveTextContent("0:12 / 10:00");
    expect(screen.getByTestId("replay-time").textContent).toBe("0:12 / 10:00");
  });

  it("weights the elapsed half and mutes the total", () => {
    render(
      <ReplayClock
        dataTestId="replay-time"
        currentText="1:02.3"
        totalText="4:12"
      />,
    );

    const clock: HTMLElement = screen.getByTestId("replay-time");
    const parts: Array<Element> = Array.from(clock.children);

    expect(parts[0]?.textContent).toBe("1:02.3");
    expect(parts[0]?.className).toContain("font-semibold");
    expect(parts[1]?.className).toContain("text-gray-400");
    /* Both halves tabular, so a tick never nudges the buttons beside it. */
    expect(clock.className).toContain("tabular-nums");
  });

  /* aria-live off: the offset is announced once, by the player's own region. */
  it("does not announce every tick", () => {
    render(
      <ReplayClock
        dataTestId="replay-time"
        currentText="0:01"
        totalText="1:00"
      />,
    );

    expect(screen.getByTestId("replay-time")).toHaveAttribute(
      "aria-live",
      "off",
    );
  });
});
