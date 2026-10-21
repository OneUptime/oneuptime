import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import React, { FunctionComponent, ReactElement, useState } from "react";
import Page, { usePageBreadcrumbLinks } from "../../../UI/Components/Page/Page";
import Route from "../../../Types/API/Route";
import Link from "../../../Types/Link";

/*
 * A page drawn inside a Page puts its own trail where the Page's breadcrumbs
 * are (usePageBreadcrumbLinks).
 *
 * A product's layout draws its Page with the breadcrumbs the address gives
 * it - Project > Incidents > Declare New Incident - while the create page
 * inside knows, once it has looked the record up, that it was opened from a
 * monitor's Incidents tab, and its trail goes back through that tab
 * (Dashboard Components/CreateFromRecord). The Page takes the inner page's
 * trail for as long as it has one, and its own back when the inner page has
 * none or goes. Every layout gets this from the one Page.
 */

const link: (title: string, to: string) => Link = (
  title: string,
  to: string,
): Link => {
  return { title: title, to: new Route(to) };
};

const LAYOUT_TRAIL: Array<Link> = [
  link("Project", "/dashboard/project"),
  link("Incidents", "/dashboard/project/incidents"),
  link("Declare New Incident", "/dashboard/project/incidents/create"),
];

const RECORD_TRAIL: Array<Link> = [
  link("Project", "/dashboard/project/home"),
  link("Monitors", "/dashboard/project/monitors"),
  link("View Monitor", "/dashboard/project/monitors/m-1"),
  link("Incidents", "/dashboard/project/monitors/m-1/incidents"),
  link("Declare New Incident", "/dashboard/project/incidents/create"),
];

// The breadcrumb titles of each trail drawn, outermost Page first.
function trails(): Array<Array<string>> {
  return screen
    .queryAllByRole("navigation", { name: "Breadcrumb" })
    .map((navigation: HTMLElement): Array<string> => {
      return Array.from(navigation.querySelectorAll("li")).map(
        (item: HTMLLIElement): string => {
          return (item.textContent || "").trim();
        },
      );
    });
}

function titlesOf(links: Array<Link>): Array<string> {
  return links.map((item: Link): string => {
    return item.title;
  });
}

const InnerPage: FunctionComponent<{ links: Array<Link> | null }> = (props: {
  links: Array<Link> | null;
}): ReactElement => {
  usePageBreadcrumbLinks(props.links);

  return <p>The form</p>;
};

afterEach(() => {
  cleanup();
});

describe("a page drawn inside a Page", () => {
  test("puts its trail where the Page's breadcrumbs are", () => {
    render(
      <Page title="Incidents" breadcrumbLinks={LAYOUT_TRAIL}>
        <InnerPage links={RECORD_TRAIL} />
      </Page>,
    );

    expect(trails()).toEqual([titlesOf(RECORD_TRAIL)]);
    expect(screen.getByText("The form")).toBeInTheDocument();
  });

  test("with no trail of its own, leaves the Page's breadcrumbs", () => {
    render(
      <Page title="Incidents" breadcrumbLinks={LAYOUT_TRAIL}>
        <InnerPage links={null} />
      </Page>,
    );

    expect(trails()).toEqual([titlesOf(LAYOUT_TRAIL)]);
  });

  test("hands the Page its trail once it has one, and a new one when it changes", () => {
    let setLinks: (links: Array<Link> | null) => void = () => {};

    const Changing: FunctionComponent = (): ReactElement => {
      const [links, setState] = useState<Array<Link> | null>(null);
      setLinks = setState;
      return <InnerPage links={links} />;
    };

    render(
      <Page title="Incidents" breadcrumbLinks={LAYOUT_TRAIL}>
        <Changing />
      </Page>,
    );

    expect(trails()).toEqual([titlesOf(LAYOUT_TRAIL)]);

    act(() => {
      setLinks(RECORD_TRAIL);
    });
    expect(trails()).toEqual([titlesOf(RECORD_TRAIL)]);

    act(() => {
      setLinks(RECORD_TRAIL.slice(0, 2));
    });
    expect(trails()).toEqual([["Project", "Monitors"]]);

    act(() => {
      setLinks(null);
    });
    expect(trails()).toEqual([titlesOf(LAYOUT_TRAIL)]);
  });

  test("takes its trail back when it goes", () => {
    let hide: () => void = () => {};

    const Toggle: FunctionComponent = (): ReactElement => {
      const [isShown, setIsShown] = useState<boolean>(true);
      hide = (): void => {
        setIsShown(false);
      };
      return isShown ? <InnerPage links={RECORD_TRAIL} /> : <p>Another page</p>;
    };

    render(
      <Page title="Incidents" breadcrumbLinks={LAYOUT_TRAIL}>
        <Toggle />
      </Page>,
    );

    expect(trails()).toEqual([titlesOf(RECORD_TRAIL)]);

    act(() => {
      hide();
    });

    expect(trails()).toEqual([titlesOf(LAYOUT_TRAIL)]);
  });

  test("names the browser tab by the trail it draws", () => {
    render(
      <Page title="Incidents" breadcrumbLinks={LAYOUT_TRAIL}>
        <InnerPage links={RECORD_TRAIL} />
      </Page>,
    );

    expect(document.title).toBe(
      `OneUptime | ${titlesOf(RECORD_TRAIL).join(" - ")}`,
    );
  });

  test("reaches the nearest Page only", () => {
    const VIEW_TRAIL: Array<Link> = [
      link("Project", "/dashboard/project"),
      link("Monitors", "/dashboard/project/monitors"),
      link("View Monitor", "/dashboard/project/monitors/m-1"),
    ];

    render(
      <Page title="Monitors" breadcrumbLinks={LAYOUT_TRAIL}>
        <Page title="Monitor" breadcrumbLinks={VIEW_TRAIL}>
          <InnerPage links={RECORD_TRAIL} />
        </Page>
      </Page>,
    );

    expect(trails()).toEqual([titlesOf(LAYOUT_TRAIL), titlesOf(RECORD_TRAIL)]);
  });

  test("outside any Page, is drawn nowhere and breaks nothing", () => {
    render(<InnerPage links={RECORD_TRAIL} />);

    expect(trails()).toEqual([]);
    expect(screen.getByText("The form")).toBeInTheDocument();
  });

  test("a Page whose content is still loading keeps its own breadcrumbs", () => {
    render(
      <Page title="Incidents" breadcrumbLinks={LAYOUT_TRAIL} isLoading={true}>
        <InnerPage links={RECORD_TRAIL} />
      </Page>,
    );

    // The inner page is not drawn while the Page loads, so it hands nothing up.
    expect(trails()).toEqual([titlesOf(LAYOUT_TRAIL)]);
  });
});
