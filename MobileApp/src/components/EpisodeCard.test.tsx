import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react-native";
import { describe, expect, test } from "@jest/globals";
import EpisodeCard from "./EpisodeCard";
import { darkColors } from "../theme";
import { rgbToHex } from "../utils/color";
import {
  makeAlertEpisode,
  makeIncidentEpisode,
  makeNamedEntityWithColor,
} from "../__tests__/testSupport";
import type {
  AlertEpisodeItem,
  ColorField,
  IncidentEpisodeItem,
} from "../api/types";

/*
 * One card, two payloads. An episode groups repeated incidents or repeated
 * alerts, and the same component draws both by reading a different set of
 * fields depending on the `type` prop - state, severity and the child count
 * all live under different names on the two shapes.
 *
 * That branch is the whole risk here. Nothing in the types stops an
 * `incident`-typed card being handed an alert episode, and the failure would
 * not be a crash: it would be a card that renders perfectly with every badge
 * missing, because it looked for `currentIncidentState` on an object that has
 * `currentAlertState`. So each behaviour below is asserted for BOTH types
 * rather than once for whichever was convenient.
 */

type RenderedElement = ReturnType<typeof screen.getByText>;

interface PressHandlers {
  onResponderGrant?: (event: unknown) => void;
}

function styleOf(element: RenderedElement): Record<string, unknown> {
  return element.props.style as Record<string, unknown>;
}

function cardSurface(): RenderedElement {
  return screen.getByRole("button");
}

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

/**
 * Hold a finger on the card, without lifting it.
 *
 * Pressable does not pass onPressIn down to the host view it renders - the
 * press lives in the responder handlers Pressability installs there - so
 * `fireEvent(card, "pressIn")` finds no handler and dispatches to nobody,
 * silently. Calling the host's own onResponderGrant is what the touch system
 * does; the touch on the event is what Pressability records to work out later
 * whether the finger slid off the card.
 */
async function holdDown(element: RenderedElement): Promise<void> {
  const handlers: PressHandlers = element.props as PressHandlers;

  await act(async (): Promise<void> => {
    handlers.onResponderGrant?.({
      nativeEvent: {
        touches: [{ pageX: 100, pageY: 200, identifier: 1 }],
        changedTouches: [],
      },
      currentTarget: 1,
      persist: (): void => {
        return undefined;
      },
    });
  });
}

function noop(): void {
  return undefined;
}

describe("An incident episode", () => {
  test("says what kind of episode it is, and which one", async () => {
    await render(
      <EpisodeCard
        episode={makeIncidentEpisode()}
        type="incident"
        onPress={noop}
      />,
    );

    expect(screen.getByText("INCIDENT EPISODE")).toBeTruthy();
    expect(screen.getByText("#2")).toBeTruthy();
    expect(screen.getByText("Rolling checkout outage")).toBeTruthy();
  });

  test("reads its state and severity off the incident-shaped fields", async () => {
    await render(
      <EpisodeCard
        episode={makeIncidentEpisode()}
        type="incident"
        onPress={noop}
      />,
    );

    expect(screen.getByText("Created")).toBeTruthy();
    expect(screen.getByText("Critical")).toBeTruthy();
  });

  test("counts the incidents it groups, in the plural", async () => {
    await render(
      <EpisodeCard
        episode={makeIncidentEpisode()}
        type="incident"
        onPress={noop}
      />,
    );

    expect(screen.getByText("3 incidents")).toBeTruthy();
  });

  test("and in the singular when it has grouped only one so far", async () => {
    const episode: IncidentEpisodeItem = makeIncidentEpisode({
      incidentCount: 1,
    });

    await render(
      <EpisodeCard episode={episode} type="incident" onPress={noop} />,
    );

    expect(screen.getByText("1 incident")).toBeTruthy();
  });

  test("announces itself as an incident episode", async () => {
    await render(
      <EpisodeCard
        episode={makeIncidentEpisode()}
        type="incident"
        onPress={noop}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: "Incident episode #2, Rolling checkout outage. State: Created. Severity: Critical.",
      }),
    ).toBeTruthy();
  });
});

describe("An alert episode", () => {
  test("says what kind of episode it is, and which one", async () => {
    await render(
      <EpisodeCard episode={makeAlertEpisode()} type="alert" onPress={noop} />,
    );

    expect(screen.getByText("ALERT EPISODE")).toBeTruthy();
    expect(screen.getByText("#3")).toBeTruthy();
    expect(screen.getByText("Repeated disk pressure")).toBeTruthy();
  });

  test("reads its state and severity off the alert-shaped fields", async () => {
    /*
     * The names differ from the incident shape - currentAlertState rather than
     * currentIncidentState - so a card that ignored `type` would render these
     * two badges empty while looking entirely healthy.
     */
    const episode: AlertEpisodeItem = makeAlertEpisode({
      currentAlertState: makeNamedEntityWithColor({ name: "Acknowledged" }),
      alertSeverity: makeNamedEntityWithColor({
        name: "Warning",
      }) as AlertEpisodeItem["alertSeverity"],
    });

    await render(<EpisodeCard episode={episode} type="alert" onPress={noop} />);

    expect(screen.getByText("Acknowledged")).toBeTruthy();
    expect(screen.getByText("Warning")).toBeTruthy();
  });

  test("counts the alerts it groups, in the plural", async () => {
    await render(
      <EpisodeCard episode={makeAlertEpisode()} type="alert" onPress={noop} />,
    );

    expect(screen.getByText("4 alerts")).toBeTruthy();
  });

  test("and in the singular when it has grouped only one so far", async () => {
    const episode: AlertEpisodeItem = makeAlertEpisode({ alertCount: 1 });

    await render(<EpisodeCard episode={episode} type="alert" onPress={noop} />);

    expect(screen.getByText("1 alert")).toBeTruthy();
  });

  test("announces itself as an alert episode", async () => {
    await render(
      <EpisodeCard episode={makeAlertEpisode()} type="alert" onPress={noop} />,
    );

    expect(
      screen.getByRole("button", {
        name: "Alert episode #3, Repeated disk pressure. State: Created. Severity: Critical.",
      }),
    ).toBeTruthy();
  });
});

describe("The age the card reports", () => {
  test("an incident episode is dated from when it was declared", async () => {
    /*
     * declaredAt and createdAt are different instants: an episode row is
     * written when the grouping is worked out, which can be well after the
     * first incident in it was declared. The declared time is the one a
     * responder is reasoning about.
     */
    const episode: IncidentEpisodeItem = makeIncidentEpisode({
      declaredAt: hoursAgo(2),
      createdAt: hoursAgo(240),
    });

    await render(
      <EpisodeCard episode={episode} type="incident" onPress={noop} />,
    );

    expect(screen.getByText("2h ago")).toBeTruthy();
    expect(screen.queryByText("10d ago")).toBeNull();
  });

  test("an incident episode with no declared time falls back to when the row was written", async () => {
    const episode: IncidentEpisodeItem = makeIncidentEpisode({
      declaredAt: undefined as unknown as string,
      createdAt: hoursAgo(4),
    });

    await render(
      <EpisodeCard episode={episode} type="incident" onPress={noop} />,
    );

    expect(screen.getByText("4h ago")).toBeTruthy();
  });

  test("an alert episode, which has no declared time at all, uses its created time", async () => {
    const episode: AlertEpisodeItem = makeAlertEpisode({
      createdAt: hoursAgo(6),
    });

    await render(<EpisodeCard episode={episode} type="alert" onPress={noop} />);

    expect(screen.getByText("6h ago")).toBeTruthy();
  });

  test("an episode with no usable timestamp anywhere shows a dash", async () => {
    const episode: IncidentEpisodeItem = makeIncidentEpisode({
      declaredAt: undefined as unknown as string,
      createdAt: undefined as unknown as string,
    });

    await render(
      <EpisodeCard episode={episode} type="incident" onPress={noop} />,
    );

    expect(screen.getByText("—")).toBeTruthy();
  });
});

describe("An episode missing the pieces the type promises", () => {
  test("an episode grouping nothing yet leaves the count pill off", async () => {
    /*
     * A count of zero is a real state - an episode can exist with its members
     * already moved out of it - and "0 incidents" is worse than nothing, since
     * it invites the reader to wonder what went wrong.
     */
    const episode: IncidentEpisodeItem = makeIncidentEpisode({
      incidentCount: 0,
    });

    await render(
      <EpisodeCard episode={episode} type="incident" onPress={noop} />,
    );

    expect(screen.queryByText(/incident/)).toBeNull();
    expect(screen.getByText("Rolling checkout outage")).toBeTruthy();
  });

  test("an episode whose count the server left out renders the rest of the card", async () => {
    const episode: IncidentEpisodeItem = makeIncidentEpisode({
      incidentCount: undefined as unknown as number,
    });

    await render(
      <EpisodeCard episode={episode} type="incident" onPress={noop} />,
    );

    expect(screen.getByText("Rolling checkout outage")).toBeTruthy();
    expect(screen.queryByText(/incidents/)).toBeNull();
  });

  test("no state leaves that pill off and says unknown to a screen reader", async () => {
    const episode: IncidentEpisodeItem = makeIncidentEpisode({
      currentIncidentState:
        undefined as unknown as IncidentEpisodeItem["currentIncidentState"],
    });

    await render(
      <EpisodeCard episode={episode} type="incident" onPress={noop} />,
    );

    expect(screen.queryByText("Created")).toBeNull();
    expect(
      screen.getByLabelText(
        "Incident episode #2, Rolling checkout outage. State: unknown. Severity: Critical.",
      ),
    ).toBeTruthy();
  });

  test("no severity leaves that pill off and says unknown too", async () => {
    const episode: AlertEpisodeItem = makeAlertEpisode({
      alertSeverity: undefined as unknown as AlertEpisodeItem["alertSeverity"],
    });

    await render(<EpisodeCard episode={episode} type="alert" onPress={noop} />);

    expect(screen.queryByText("Critical")).toBeNull();
    expect(
      screen.getByLabelText(
        "Alert episode #3, Repeated disk pressure. State: Created. Severity: unknown.",
      ),
    ).toBeTruthy();
  });

  test("an episode with no prefixed number falls back to the raw number", async () => {
    const episode: IncidentEpisodeItem = makeIncidentEpisode({
      episodeNumberWithPrefix: undefined as unknown as string,
    });

    await render(
      <EpisodeCard episode={episode} type="incident" onPress={noop} />,
    );

    expect(screen.getByText("#2")).toBeTruthy();
  });
});

describe("The colours on the pills are the ones the API sent", () => {
  test("the state pill and its dot are painted from the state's colour", async () => {
    const episode: IncidentEpisodeItem = makeIncidentEpisode({
      currentIncidentState: makeNamedEntityWithColor({
        name: "Resolved",
        color: { r: 34, g: 197, b: 94 },
      }),
    });

    await render(
      <EpisodeCard episode={episode} type="incident" onPress={noop} />,
    );

    const label: RenderedElement = screen.getByText("Resolved");
    const dot: RenderedElement = (label.parent as RenderedElement)
      .children[0] as RenderedElement;

    expect(styleOf(label).color).toBe(rgbToHex({ r: 34, g: 197, b: 94 }));
    expect(styleOf(dot).backgroundColor).toBe(
      rgbToHex({ r: 34, g: 197, b: 94 }),
    );
  });

  test("a colour object with no channels comes out neutral, never black", async () => {
    const episode: AlertEpisodeItem = makeAlertEpisode({
      alertSeverity: makeNamedEntityWithColor({
        name: "Unclassified",
        color: {} as ColorField,
      }) as AlertEpisodeItem["alertSeverity"],
    });

    await render(<EpisodeCard episode={episode} type="alert" onPress={noop} />);

    expect(styleOf(screen.getByText("Unclassified")).color).toBe(
      rgbToHex({} as ColorField),
    );
    expect(styleOf(screen.getByText("Unclassified")).color).not.toBe("#000000");
  });

  test("a severity carrying no colour field falls back to the muted text token", async () => {
    const episode: AlertEpisodeItem = makeAlertEpisode({
      alertSeverity: makeNamedEntityWithColor({
        name: "Unclassified",
        color: undefined as unknown as ColorField,
      }) as AlertEpisodeItem["alertSeverity"],
    });

    await render(<EpisodeCard episode={episode} type="alert" onPress={noop} />);

    expect(styleOf(screen.getByText("Unclassified")).color).toBe(
      darkColors.textTertiary,
    );
  });
});

describe("Pressing the card", () => {
  test("a press is handed straight up to the list", async () => {
    const onPress: jest.Mock = jest.fn();

    await render(
      <EpisodeCard
        episode={makeIncidentEpisode()}
        type="incident"
        onPress={onPress}
      />,
    );

    await fireEvent.press(screen.getByText("Rolling checkout outage"));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test("two presses are two presses - the card de-duplicates nothing", async () => {
    const onPress: jest.Mock = jest.fn();

    await render(
      <EpisodeCard
        episode={makeAlertEpisode()}
        type="alert"
        onPress={onPress}
      />,
    );

    await fireEvent.press(screen.getByText("Repeated disk pressure"));
    await fireEvent.press(screen.getByText("Repeated disk pressure"));

    expect(onPress).toHaveBeenCalledTimes(2);
  });

  test("the project it belongs to is shown when the list spans several", async () => {
    await render(
      <EpisodeCard
        episode={makeIncidentEpisode()}
        type="incident"
        onPress={noop}
        projectName="Acme Production"
      />,
    );

    expect(screen.getByText("Acme Production")).toBeTruthy();
  });

  test("a muted card is dimmed but still opens", async () => {
    const onPress: jest.Mock = jest.fn();

    await render(
      <EpisodeCard
        episode={makeIncidentEpisode()}
        type="incident"
        onPress={onPress}
        muted
      />,
    );

    expect(styleOf(cardSurface()).opacity).toBe(0.5);

    await fireEvent.press(screen.getByText("Rolling checkout outage"));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test("an ordinary card is drawn at full strength", async () => {
    await render(
      <EpisodeCard
        episode={makeIncidentEpisode()}
        type="incident"
        onPress={noop}
      />,
    );

    expect(styleOf(cardSurface()).opacity).toBe(1);
  });

  test("holding a finger on a muted card still visibly answers the touch", async () => {
    await render(
      <EpisodeCard
        episode={makeIncidentEpisode()}
        type="incident"
        onPress={noop}
        muted
      />,
    );

    await holdDown(cardSurface());

    expect(styleOf(cardSurface()).opacity).toBe(0.7);
  });
});
