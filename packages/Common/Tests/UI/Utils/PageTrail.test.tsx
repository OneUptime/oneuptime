import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render } from "@testing-library/react";
import React from "react";
import Page from "../../../UI/Components/Page/Page";
import {
  getPageTrail,
  getPageTrailName,
  publishPageTrail,
} from "../../../UI/Utils/PageTrail";
import Route from "../../../Types/API/Route";
import Link from "../../../Types/Link";

/*
 * THE PAGE ON SCREEN, NAMED AS ITS BREADCRUMBS NAME IT (issue #8893).
 *
 * Give Feedback said it was sent with "the page you are on
 * (/dashboard/:projectId/slos)": the route, which is what is sent, but which
 * reads as gibberish to a person. Page publishes the trail it draws
 * (PageTrail), and the dialog names the page by it - "SLOs" - in the
 * reader's language, without the project it starts with and without any
 * record's name, so nothing that names a record is said to be sent.
 */

const link: (title: string, to: string, extra?: Partial<Link>) => Link = (
  title: string,
  to: string,
  extra?: Partial<Link>,
): Link => {
  return { title: title, to: new Route(to), ...extra };
};

const asWritten: (value: string | undefined) => string | undefined = (
  value: string | undefined,
): string | undefined => {
  return value;
};

const goTo: (pathname: string) => void = (pathname: string): void => {
  window.history.pushState({}, "", pathname);
};

afterEach(() => {
  cleanup();
  publishPageTrail(undefined);
  goTo("/");
});

describe("the page's name, from its trail", () => {
  test("its crumbs' titles, without the project every trail starts with", () => {
    expect(
      getPageTrailName(
        [link("Project", "/dashboard/p"), link("SLOs", "/dashboard/p/slos")],
        asWritten,
      ),
    ).toBe("SLOs");

    expect(
      getPageTrailName(
        [
          link("Project", "/dashboard/p"),
          link("Monitors", "/dashboard/p/monitors"),
          link("View Monitor", "/dashboard/p/monitors/m-1", {
            recordName: "Website: acme.com",
          }),
          link("Criteria", "/dashboard/p/monitors/m-1/criteria"),
        ],
        asWritten,
      ),
    ).toBe("Monitors › View Monitor › Criteria");
  });

  test("never a record's name: not one a crumb stands for, nor a crumb that is one", () => {
    const name: string | null = getPageTrailName(
      [
        link("Project", "/dashboard/p"),
        link("Monitors", "/dashboard/p/monitors"),
        link("View Monitor", "/dashboard/p/monitors/m-1", {
          recordName: "Payments API",
          recordNumber: "MON-7",
        }),
        link("Incident Responder", "/dashboard/p/roles/r-1", {
          isRecordName: true,
        }),
      ],
      asWritten,
    );

    expect(name).toBe("Monitors › View Monitor");
    expect(name).not.toContain("Payments API");
    expect(name).not.toContain("Incident Responder");
  });

  test("each title in the reader's language", () => {
    const german: Record<string, string> = {
      Monitors: "Monitore",
      "Create New Monitor": "Neuen Monitor erstellen",
    };

    expect(
      getPageTrailName(
        [
          link("Project", "/dashboard/p"),
          link("Monitors", "/dashboard/p/monitors"),
          link("Create New Monitor", "/dashboard/p/monitors/create"),
        ],
        (value: string | undefined): string | undefined => {
          return value ? german[value] || value : value;
        },
      ),
    ).toBe("Monitore › Neuen Monitor erstellen");
  });

  test("a title in the reader's words already is not looked up again", () => {
    expect(
      getPageTrailName(
        [
          link("Project", "/dashboard/p"),
          link("Einstellungen", "/admin/settings", {
            isTitleTranslated: true,
          }),
        ],
        (): string | undefined => {
          return "looked up again";
        },
      ),
    ).toBe("Einstellungen");
  });

  test("a trail that names no page names nothing", () => {
    expect(getPageTrailName(null, asWritten)).toBeNull();
    expect(getPageTrailName([], asWritten)).toBeNull();
    expect(
      getPageTrailName([link("Project", "/dashboard/p")], asWritten),
    ).toBeNull();
  });

  test("a trail that does not start with the project keeps its first crumb", () => {
    expect(
      getPageTrailName(
        [
          link("User Settings", "/dashboard/p/user-settings"),
          link("Profile", "/dashboard/p/user-settings/profile"),
        ],
        asWritten,
      ),
    ).toBe("User Settings › Profile");
  });
});

describe("the trail of the page on screen", () => {
  test("is read while its page is the address, and never after", () => {
    goTo("/dashboard/p/slos");

    const trail: Array<Link> = [
      link("Project", "/dashboard/p"),
      link("SLOs", "/dashboard/p/slos"),
    ];

    publishPageTrail(trail);

    expect(getPageTrail()).toEqual(trail);

    // A page with no Page of its own: the last trail is not this page's.
    goTo("/dashboard/p/somewhere-else");
    expect(getPageTrail()).toBeNull();
  });

  test("a page with no trail clears it", () => {
    goTo("/dashboard/p/slos");
    publishPageTrail([link("SLOs", "/dashboard/p/slos")]);
    publishPageTrail(undefined);

    expect(getPageTrail()).toBeNull();

    publishPageTrail([link("SLOs", "/dashboard/p/slos")]);
    publishPageTrail([]);

    expect(getPageTrail()).toBeNull();
  });

  test("Page publishes the trail it draws", () => {
    goTo("/dashboard/p/slos");

    const trail: Array<Link> = [
      link("Project", "/dashboard/p"),
      link("SLOs", "/dashboard/p/slos"),
    ];

    render(
      <Page title="SLOs" breadcrumbLinks={trail}>
        <p>Service level objectives</p>
      </Page>,
    );

    expect(getPageTrail()).toEqual(trail);
    expect(getPageTrailName(getPageTrail(), asWritten)).toBe("SLOs");
  });
});
