import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { describe, expect, test } from "@jest/globals";
import IncidentCard from "./IncidentCard";
import {
  makeIncident,
  makeNamedEntityWithColor,
} from "../__tests__/testSupport";
import type { IncidentItem } from "../api/types";

/*
 * This card is a row in a list, which is what makes its failure mode so
 * expensive: anything it throws during render is thrown inside the list, so
 * one bad incident blanks the whole page and every OTHER incident with it. A
 * responder who opens the app to a blank Incidents tab has no way to tell
 * whether they are looking at an empty rota or a crash.
 *
 * `monitors` is the field that does it. The type says it is always there, the
 * payload disagrees - an incident declared by hand has no monitor, and
 * detaching the last one from an existing incident leaves the field off - and
 * the card was reading it unguarded one line after guarding it.
 */

type IncidentMonitors = IncidentItem["monitors"];

describe("An incident with no monitors at all", () => {
  test("a missing monitors field renders the row instead of throwing", async () => {
    const incident: IncidentItem = makeIncident({
      monitors: undefined as unknown as IncidentMonitors,
    });

    await render(
      <IncidentCard
        incident={incident}
        onPress={() => {
          return undefined;
        }}
      />,
    );

    expect(screen.getByText("Checkout is down")).toBeTruthy();
  });

  test("the monitor strip is simply left off", async () => {
    const incident: IncidentItem = makeIncident({
      monitors: undefined as unknown as IncidentMonitors,
    });

    await render(
      <IncidentCard
        incident={incident}
        onPress={() => {
          return undefined;
        }}
      />,
    );

    expect(screen.queryByText(/monitor/i)).toBeNull();
  });

  test("an empty monitor list is treated the same way", async () => {
    const incident: IncidentItem = makeIncident({ monitors: [] });

    await render(
      <IncidentCard
        incident={incident}
        onPress={() => {
          return undefined;
        }}
      />,
    );

    expect(screen.getByText("Checkout is down")).toBeTruthy();
    expect(screen.queryByText(/monitor/i)).toBeNull();
  });

  test("it is still pressable, so the responder can open it and find out why", async () => {
    const onPress: jest.Mock = jest.fn();
    const incident: IncidentItem = makeIncident({
      monitors: undefined as unknown as IncidentMonitors,
    });

    await render(<IncidentCard incident={incident} onPress={onPress} />);

    await fireEvent.press(screen.getByText("Checkout is down"));

    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe("What an ordinary incident row shows", () => {
  test("the title, the number and the times it was declared", async () => {
    await render(
      <IncidentCard
        incident={makeIncident()}
        onPress={() => {
          return undefined;
        }}
      />,
    );

    expect(screen.getByText("Checkout is down")).toBeTruthy();
    expect(screen.getByText("#7")).toBeTruthy();
    expect(screen.getByText("INCIDENT")).toBeTruthy();
  });

  test("the current state and the severity, by name", async () => {
    await render(
      <IncidentCard
        incident={makeIncident()}
        onPress={() => {
          return undefined;
        }}
      />,
    );

    expect(screen.getByText("Created")).toBeTruthy();
    expect(screen.getByText("Critical")).toBeTruthy();
  });

  test("a single attached monitor is named and counted in the singular", async () => {
    await render(
      <IncidentCard
        incident={makeIncident()}
        onPress={() => {
          return undefined;
        }}
      />,
    );

    expect(screen.getByText("api.example.com")).toBeTruthy();
    expect(screen.getByText("1 monitor")).toBeTruthy();
  });

  test("several monitors are listed together and counted in the plural", async () => {
    const incident: IncidentItem = makeIncident({
      monitors: [
        { _id: "monitor-1", name: "api.example.com" },
        { _id: "monitor-2", name: "checkout.example.com" },
      ] as unknown as IncidentMonitors,
    });

    await render(
      <IncidentCard
        incident={incident}
        onPress={() => {
          return undefined;
        }}
      />,
    );

    expect(
      screen.getByText("api.example.com, checkout.example.com"),
    ).toBeTruthy();
    expect(screen.getByText("2 monitors")).toBeTruthy();
  });

  test("the project name is shown when one is given", async () => {
    await render(
      <IncidentCard
        incident={makeIncident()}
        onPress={() => {
          return undefined;
        }}
        projectName="Acme Production"
      />,
    );

    expect(screen.getByText("Acme Production")).toBeTruthy();
  });

  test("pressing the row hands the press straight up", async () => {
    const onPress: jest.Mock = jest.fn();

    await render(<IncidentCard incident={makeIncident()} onPress={onPress} />);

    await fireEvent.press(screen.getByText("Checkout is down"));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test("the row announces itself with number, title, state and severity", async () => {
    await render(
      <IncidentCard
        incident={makeIncident()}
        onPress={() => {
          return undefined;
        }}
      />,
    );

    expect(
      screen.getByLabelText(
        "Incident #7, Checkout is down. State: Created. Severity: Critical.",
      ),
    ).toBeTruthy();
  });
});

describe("An incident missing its state or severity", () => {
  /*
   * The same payload that drops `monitors` drops these, and the card already
   * copes; the test is here so a future tidy-up of the monitors guard does not
   * take the neighbouring ones with it.
   */
  test("no state badge is drawn, and the label says so", async () => {
    const incident: IncidentItem = makeIncident({
      currentIncidentState: undefined,
      incidentSeverity: makeNamedEntityWithColor({
        _id: "severity-1",
        name: "Critical",
      }) as IncidentItem["incidentSeverity"],
    });

    await render(
      <IncidentCard
        incident={incident}
        onPress={() => {
          return undefined;
        }}
      />,
    );

    expect(screen.queryByText("Created")).toBeNull();
    expect(
      screen.getByLabelText(
        "Incident #7, Checkout is down. State: unknown. Severity: Critical.",
      ),
    ).toBeTruthy();
  });
});
