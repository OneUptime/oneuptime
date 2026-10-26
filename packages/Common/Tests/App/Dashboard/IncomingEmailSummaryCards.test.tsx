import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, test } from "@jest/globals";

import IncomingEmailMonitorSummaryView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/IncomingEmailMonitorSummaryView";
import IncomingEmailMonitorRequest from "../../../Types/Monitor/IncomingEmailMonitor/IncomingEmailMonitorRequest";
import ObjectID from "../../../Types/ObjectID";

/*
 * The cards at the top of an Incoming Email monitor's View Summary - when
 * the email came, who sent it, its subject. View Summary is where the
 * monitor says what an email opened, or why it opened nothing (an email
 * that opens an incident for every email: a reply, a second delivery, an
 * automatic reply), so it is read on a phone as much as anywhere.
 *
 * The cards wrap on a narrow screen. They were spaced with space-x, which
 * gives every card after the first a margin on its left even when it wraps
 * onto a line of its own: on a phone the From and Subject cards each
 * stepped in from the one above. A gap spaces only cards that sit side by
 * side.
 */

afterEach(() => {
  cleanup();
});

function renderSummary(): void {
  const request: IncomingEmailMonitorRequest = {
    projectId: new ObjectID("11111111-1111-4111-8111-111111111111"),
    monitorId: new ObjectID("22222222-2222-4222-8222-222222222222"),
    emailFrom: "priya@acme.example",
    emailTo: "reports@inbound.example",
    emailSubject: "Printer on floor 2 shows E-17",
    emailBody: "The printer on floor 2 shows error E-17.",
    emailHeaders: { "Message-ID": "<report-1@acme.example>" },
    emailReceivedAt: new Date("2026-10-15T09:02:00.000Z"),
    checkedAt: new Date("2026-10-15T09:02:00.000Z"),
  } as unknown as IncomingEmailMonitorRequest;

  render(
    <MemoryRouter>
      <IncomingEmailMonitorSummaryView incomingEmailMonitorRequest={request} />
    </MemoryRouter>,
  );
}

describe("An Incoming Email monitor's summary cards", () => {
  test("say when the email came, who sent it and its subject", () => {
    renderSummary();

    expect(screen.getByText("priya@acme.example")).toBeInTheDocument();
    expect(
      screen.getByText("Printer on floor 2 shows E-17"),
    ).toBeInTheDocument();
  });

  /*
   * Since every monitor summary's facts share one layout (SummaryFacts), the
   * cards sit in rows that wrap, with a gap that spaces only cards side by
   * side - and never with space-x.
   */
  test("sit in wrapping rows with a gap, so a card on a line of its own does not step in", () => {
    renderSummary();

    const fromCard: HTMLElement = screen
      .getByText("priya@acme.example")
      .closest("div.rounded-xl") as HTMLElement;
    const row: HTMLElement = fromCard.parentElement as HTMLElement;
    const classes: Array<string> = row.className.split(" ");

    expect(classes).toEqual(
      expect.arrayContaining(["flex", "flex-wrap", "gap-3"]),
    );
    expect(
      classes.filter((name: string): boolean => {
        return name.startsWith("space-x-");
      }),
    ).toEqual([]);
  });
});
