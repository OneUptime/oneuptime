import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import InvestigationReferenceLink, {
  REFERENCE_LINK_CLASS_NAME,
  getReferenceLinkTitle,
  getReferenceRoute,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationReport/InvestigationReferenceLink";
import { InvestigationEventReference } from "../../../Types/AI/InvestigationEvidence";
import Navigation from "../../../UI/Utils/Navigation";

/*
 * "prior: #6954" in an AI report becomes a link only through this component,
 * and only for a row the server resolved for this viewer. The href is built
 * from that row's id and the dashboard's own route table, never from the
 * report text — these tests pin both the destination and the hover text.
 */

const INCIDENT_ID: string = "33333333-3333-4333-8333-333333333333";
const ALERT_ID: string = "44444444-4444-4444-8444-444444444444";

const incidentReference: InvestigationEventReference = {
  kind: "incident",
  number: 6954,
  id: INCIDENT_ID,
  displayNumber: "INC-6954",
  title: "Checkout latency above 2s",
  stateName: "Resolved",
  stateColor: "#10b981",
};

const alertReference: InvestigationEventReference = {
  kind: "alert",
  number: 311,
  id: ALERT_ID,
  displayNumber: "#311",
  title: "Payment webhook 5xx rate above 5%",
};

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("InvestigationReferenceLink", () => {
  test("links an incident number to that incident's page", () => {
    render(
      <InvestigationReferenceLink reference={incidentReference} text="#6954" />,
    );

    const link: HTMLElement = screen.getByRole("link");
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toMatch(
      new RegExp(`/dashboard/[^/]+/incidents/${INCIDENT_ID}$`),
    );
    expect(link).toHaveTextContent("#6954");
    expect(link).toHaveAttribute(
      "title",
      "INC-6954 · Checkout latency above 2s · Resolved",
    );
  });

  test("links an alert number to that alert's page", () => {
    render(
      <InvestigationReferenceLink reference={alertReference} text="#311" />,
    );

    const link: HTMLElement = screen.getByRole("link");
    expect(link.getAttribute("href")).toMatch(
      new RegExp(`/dashboard/[^/]+/alerts/${ALERT_ID}$`),
    );
    expect(link).toHaveAttribute(
      "title",
      "#311 · Payment webhook 5xx rate above 5%",
    );
  });

  test("uses the shared reference-link styling", () => {
    render(
      <InvestigationReferenceLink reference={incidentReference} text="#6954" />,
    );

    const link: HTMLElement = screen.getByRole("link");

    for (const className of REFERENCE_LINK_CLASS_NAME.split(" ")) {
      expect(link).toHaveClass(className);
    }

    expect(link).toHaveClass(
      "bg-indigo-50",
      "text-indigo-700",
      "ring-1",
      "ring-inset",
      "ring-indigo-100",
    );
  });

  test("keeps the report's own wording, falling back to the display number", () => {
    const view: ReturnType<typeof render> = render(
      <InvestigationReferenceLink reference={incidentReference} text="" />,
    );

    expect(screen.getByRole("link")).toHaveTextContent("INC-6954");

    view.rerender(
      <InvestigationReferenceLink reference={incidentReference} text="#6954" />,
    );
    expect(screen.getByRole("link")).toHaveTextContent("#6954");
  });

  test("navigates in-app on click", () => {
    const navigateSpy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation(() => {
        return undefined;
      });

    render(
      <InvestigationReferenceLink reference={incidentReference} text="#6954" />,
    );
    fireEvent.click(screen.getByRole("link"));

    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(String((navigateSpy.mock.calls[0] as Array<unknown>)[0])).toMatch(
      new RegExp(`/incidents/${INCIDENT_ID}$`),
    );
  });

  test("renders hostile titles as inert text in the title attribute", () => {
    const hostile: InvestigationEventReference = {
      ...incidentReference,
      title: '<img src=x onerror="alert(1)">',
    };

    const { container } = render(
      <InvestigationReferenceLink reference={hostile} text="#6954" />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("link")).toHaveAttribute(
      "title",
      'INC-6954 · <img src=x onerror="alert(1)"> · Resolved',
    );
  });
});

describe("getReferenceLinkTitle", () => {
  test("joins the number, title and state", () => {
    expect(getReferenceLinkTitle(incidentReference)).toBe(
      "INC-6954 · Checkout latency above 2s · Resolved",
    );
  });

  test("omits a missing state and a blank title", () => {
    expect(getReferenceLinkTitle(alertReference)).toBe(
      "#311 · Payment webhook 5xx rate above 5%",
    );
    expect(getReferenceLinkTitle({ ...alertReference, title: "   " })).toBe(
      "#311",
    );
  });
});

describe("getReferenceRoute", () => {
  test("routes by kind, never by the reference text", () => {
    expect(getReferenceRoute(incidentReference).toString()).toMatch(
      new RegExp(`/incidents/${INCIDENT_ID}$`),
    );
    expect(getReferenceRoute(alertReference).toString()).toMatch(
      new RegExp(`/alerts/${ALERT_ID}$`),
    );
    expect(
      getReferenceRoute({ ...alertReference, kind: "incident" }).toString(),
    ).toMatch(new RegExp(`/incidents/${ALERT_ID}$`));
  });
});
