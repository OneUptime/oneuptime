import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import Breadcrumbs from "../../../UI/Components/Breadcrumbs/Breadcrumbs";
import Button from "../../../UI/Components/Button/Button";
import Card from "../../../UI/Components/Card/Card";
import FieldLabel from "../../../UI/Components/Forms/Fields/FieldLabel";
import NavBarItem from "../../../UI/Components/Navbar/NavBarItem";
import Page from "../../../UI/Components/Page/Page";
import SideMenuItem from "../../../UI/Components/SideMenu/SideMenuItem";
import Tab from "../../../UI/Components/Tabs/Tab";
import {
  PRIVATE_TEXT_CLASS_NAME,
  PRODUCT_TEXT_CLASS_NAME,
  withProductText,
} from "../../../UI/Utils/ProductText";
import Route from "../../../Types/API/Route";
import IconProp from "../../../Types/Icon/IconProp";

/*
 * The product's own words, marked for a recording (#6834).
 *
 * On OneUptime Cloud, a recording of the Dashboard's setup pages masks
 * every word except the ones OneUptime itself wrote: a button's label, a
 * heading, a menu entry, a field's label, a tab. Each of those components
 * puts PRODUCT_TEXT_CLASS_NAME on the element that holds its words - and
 * leaves it off whatever can carry a record's name or what somebody typed.
 */

const isMarked: (element: Element | null) => boolean = (
  element: Element | null,
): boolean => {
  return Boolean(element?.closest(`.${PRODUCT_TEXT_CLASS_NAME}`));
};

describe("ProductText", () => {
  afterEach(() => {
    cleanup();
  });

  test("is the recorder's unmask class, and its mask class wins further in", () => {
    expect(PRODUCT_TEXT_CLASS_NAME).toBe("oneuptime-unmask");
    expect(PRIVATE_TEXT_CLASS_NAME).toBe("oneuptime-mask");
    expect(withProductText("a b")).toBe("a b oneuptime-unmask");
    expect(withProductText()).toBe("oneuptime-unmask");
    expect(withProductText(undefined)).toBe("oneuptime-unmask");
  });

  test("a button's label", () => {
    render(<Button title="Create Monitor" onClick={() => {}} />);

    expect(isMarked(screen.getByText("Create Monitor"))).toBe(true);
  });

  test("a card's title and description in words", () => {
    render(
      <Card title="Project Details" description="The name your team sees." />,
    );

    expect(isMarked(screen.getByText("Project Details"))).toBe(true);
    expect(isMarked(screen.getByText("The name your team sees."))).toBe(true);
  });

  test("not a card's title or description that is an element, which may carry a record's name", () => {
    render(
      <Card
        title={<span>Payments API</span>}
        description={<span>Owned by Alice Hartwell</span>}
      />,
    );

    expect(isMarked(screen.getByText("Payments API"))).toBe(false);
    expect(isMarked(screen.getByText("Owned by Alice Hartwell"))).toBe(false);
  });

  test("a page's title and description", () => {
    render(
      <MemoryRouter>
        <Page
          title="Project Settings"
          description="What this project is called."
        >
          <div>Body</div>
        </Page>
      </MemoryRouter>,
    );

    expect(isMarked(screen.getByText("Project Settings"))).toBe(true);
    expect(isMarked(screen.getByText("What this project is called."))).toBe(
      true,
    );
  });

  test("a crumb in the product's words, never a record's name", () => {
    render(
      <MemoryRouter>
        <Breadcrumbs
          links={[
            { title: "Monitors", to: new Route("/dashboard/p/monitors") },
            {
              title: "Monitor",
              to: new Route("/dashboard/p/monitors/1"),
              recordName: "Payments API",
            },
          ]}
        />
      </MemoryRouter>,
    );

    expect(isMarked(screen.getByText("Monitors"))).toBe(true);
    expect(isMarked(screen.getByText("Payments API"))).toBe(false);
  });

  test("a side menu entry", () => {
    render(
      <MemoryRouter>
        <SideMenuItem
          link={{ title: "Notification Settings", to: new Route("/x") }}
          icon={IconProp.Bell}
        />
      </MemoryRouter>,
    );

    expect(isMarked(screen.getByText("Notification Settings"))).toBe(true);
  });

  test("a top menu entry", () => {
    render(
      <MemoryRouter>
        <NavBarItem
          title="Monitors"
          route={new Route("/dashboard/p/monitors")}
        />
      </MemoryRouter>,
    );

    expect(isMarked(screen.getByText("Monitors"))).toBe(true);
  });

  test("a form field's label", () => {
    render(<FieldLabel title="Monitor Name" required={true} />);

    expect(isMarked(screen.getByText("Monitor Name"))).toBe(true);
  });

  test("a tab named in the product's words, not one named after a record", () => {
    render(
      <>
        <Tab
          tab={{ name: "Overview", children: <></> }}
          onClick={() => {}}
          isSelected={true}
        />
        <Tab
          tab={{ name: "payments-api", isName: true, children: <></> }}
          onClick={() => {}}
          isSelected={false}
        />
      </>,
    );

    expect(isMarked(screen.getByText("Overview"))).toBe(true);
    expect(isMarked(screen.getByText("payments-api"))).toBe(false);
  });
});
