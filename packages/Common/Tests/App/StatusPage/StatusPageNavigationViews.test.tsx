/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { describe, expect, jest, test } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import NavBar from "../../../../App/FeatureSet/StatusPage/src/Components/NavBar/NavBar";
import { JSONObject } from "../../../Types/JSON";
import StatusPageInTab from "../../../../App/FeatureSet/StatusPage/src/Utils/StatusPageInTab";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string) => {
          return key;
        },
        i18n: { language: "en" },
      };
    },
  };
});

const links: Array<JSONObject> = [
  {
    _id: "advisories",
    title: "Security",
    navigationPath: "/incidents?category=security",
  },
  {
    _id: "other",
    title: "Outages",
    navigationPath: "/incidents?category=uncategorized",
  },
  { _id: "external", title: "Documentation", link: "https://example.com" },
  { _id: "invalid", title: "Invalid", navigationPath: "//example.com/" },
];

function StatusPageNav(props: {
  showIncidents: boolean;
  preview?: boolean;
}): ReactElement {
  Navigation.setLocation(useLocation());
  Navigation.setNavigateHook(useNavigate());

  return (
    <NavBar
      show={true}
      isPreview={Boolean(props.preview)}
      isPrivateStatusPage={false}
      enableEmailSubscribers={false}
      enableSMSSubscribers={false}
      showIncidentsOnStatusPage={props.showIncidents}
      showAnnouncementsOnStatusPage={true}
      showScheduledMaintenanceEventsOnStatusPage={true}
      showSubscriberPageOnStatusPage={false}
      headerLinks={links}
    />
  );
}

describe("public status page navigation views", () => {
  test("uses the category for the active tab and keeps the configured order on desktop and mobile", () => {
    render(
      <MemoryRouter initialEntries={["/incidents?category=security"]}>
        <StatusPageNav showIncidents={true} />
      </MemoryRouter>,
    );

    const security: HTMLElement = screen.getByRole("link", {
      name: "Security",
    });
    const outages: HTMLElement = screen.getByRole("link", { name: "Outages" });
    expect(security).toHaveAttribute("href", "/incidents?category=security");
    expect(security).toHaveAttribute("aria-current", "page");
    expect(outages).not.toHaveAttribute("aria-current");
    expect(
      security.compareDocumentPosition(outages) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Documentation" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Invalid" })).toBeNull();

    fireEvent.click(screen.getByTestId("mobile-nav-toggle"));
    expect(
      document.getElementById("mobile-status-view-advisories"),
    ).toHaveAttribute("aria-current", "page");

    fireEvent.click(document.getElementById("incidents-nav-bar-item")!);
    expect(document.getElementById("incidents-nav-bar-item")).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      document.getElementById("status-view-advisories"),
    ).not.toHaveAttribute("aria-current");
  });

  test("keeps custom incident navigation hidden when incident publication is disabled", () => {
    render(
      <MemoryRouter>
        <StatusPageNav showIncidents={false} />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("link", { name: "Security" })).toBeNull();
  });

  test("links to the page-specific preview route", () => {
    const pageId: ObjectID = ObjectID.generate();
    const base: string = `/status-page/${pageId}`;
    const get: ReturnType<typeof jest.spyOn> = jest
      .spyOn(StatusPageInTab, "get")
      .mockReturnValue(pageId);
    try {
      render(
        <MemoryRouter initialEntries={[`${base}/incidents?category=security`]}>
          <StatusPageNav showIncidents={true} preview={true} />
        </MemoryRouter>,
      );
      expect(screen.getByRole("link", { name: "Security" })).toHaveAttribute(
        "href",
        `${base}/incidents?category=security`,
      );
    } finally {
      get.mockRestore();
    }
  });
});
