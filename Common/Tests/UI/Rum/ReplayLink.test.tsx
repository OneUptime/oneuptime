import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "@jest/globals";
import ObjectID from "../../../Types/ObjectID";
import ReplayLink from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayLink";
import {
  REPLAY_EXCEPTION_PRE_ROLL_MS,
  REPLAY_MOMENT_PRE_ROLL_MS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayPlayerUrlState";

/*
 * The rendered side of ReplayLink: the anchor carries the moment grammar
 * (?at=, &signal=, &rail=) the player reads, and nothing at all renders when
 * either id is missing - a session id of "" is the default on every
 * telemetry row that predates the recorder, so an empty render is the
 * common case, not an edge.
 */

const APP_ID: ObjectID = new ObjectID("0193c0de-1111-4aaa-8bbb-000000000001");
const SESSION_ID: string = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const AT: Date = new Date("2026-08-14T10:05:00.000Z");

function renderLink(element: React.ReactElement): ReturnType<typeof render> {
  return render(<MemoryRouter>{element}</MemoryRouter>);
}

function hrefParams(anchor: HTMLElement): URLSearchParams {
  const href: string | null = anchor.getAttribute("href");

  expect(href).not.toBeNull();

  return new URL(`https://example.com${href}`).searchParams;
}

describe("ReplayLink", () => {
  it("renders an anchor into the moment with signal and rail, with the default label", () => {
    renderLink(
      <ReplayLink
        rumApplicationId={APP_ID}
        sessionId={SESSION_ID}
        atTime={AT}
        signal="log:0193c0de-4444-4aaa-8bbb-000000000004"
        rail="logs"
      />,
    );

    const anchor: HTMLElement = screen.getByRole("link", {
      name: "Watch session replay",
    });
    const params: URLSearchParams = hrefParams(anchor);

    expect(anchor.getAttribute("href")).toContain(
      `/rum/${APP_ID.toString()}/session-replay/${SESSION_ID}`,
    );
    expect(params.get("at")).toBe(
      String(AT.getTime() - REPLAY_MOMENT_PRE_ROLL_MS),
    );
    expect(params.get("signal")).toBe(
      "log:0193c0de-4444-4aaa-8bbb-000000000004",
    );
    expect(params.get("rail")).toBe("logs");
    expect(screen.getByTestId("replay-link")).toBeInTheDocument();
  });

  it("applies the ten-second run-up for an exception signal and shows a custom label", () => {
    renderLink(
      <ReplayLink
        rumApplicationId={APP_ID.toString()}
        sessionId={SESSION_ID}
        atTime={AT}
        signal="exc:0193c0de-5555-4aaa-8bbb-000000000005"
        rail="errors"
        label="Watch replay"
      />,
    );

    const anchor: HTMLElement = screen.getByRole("link", {
      name: "Watch replay",
    });

    expect(hrefParams(anchor).get("at")).toBe(
      String(AT.getTime() - REPLAY_EXCEPTION_PRE_ROLL_MS),
    );
  });

  it("writes ?t= in whole seconds for an offset", () => {
    renderLink(
      <ReplayLink
        rumApplicationId={APP_ID}
        sessionId={SESSION_ID}
        atOffsetMs={41_500}
      />,
    );

    const params: URLSearchParams = hrefParams(screen.getByRole("link"));

    expect(params.get("t")).toBe(
      String(Math.floor((41_500 - REPLAY_MOMENT_PRE_ROLL_MS) / 1000)),
    );
    expect(params.get("at")).toBeNull();
  });

  it("renders nothing without a session id or without an application id", () => {
    const { container: noSession } = renderLink(
      <ReplayLink rumApplicationId={APP_ID} sessionId="" atTime={AT} />,
    );

    expect(noSession).toBeEmptyDOMElement();

    const { container: noApp } = renderLink(
      <ReplayLink sessionId={SESSION_ID} atTime={AT} />,
    );

    expect(noApp).toBeEmptyDOMElement();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
