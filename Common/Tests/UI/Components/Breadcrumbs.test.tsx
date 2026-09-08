import Breadcrumbs from "../../../UI/Components/Breadcrumbs/Breadcrumbs";
import Navigation from "../../../UI/Utils/Navigation";
import { describe, expect, test, jest } from "@jest/globals";
import Route from "../../../Types/API/Route";
import Link from "../../../Types/Link";
import * as React from "react";
import renderer, {
  ReactTestInstance,
  ReactTestRenderer,
} from "react-test-renderer";

describe("Breadcrumbs", () => {
  test.each([1, 2, 5, 8])(
    "keeps a %i-item trail visible and wrappable on small screens",
    (count: number) => {
      const links: Array<Link> = Array.from(
        { length: count },
        (_value: unknown, index: number): Link => {
          return {
            title: `Breadcrumb ${index}`,
            to: new Route(`/page-${index}`),
          };
        },
      );
      const testRenderer: ReactTestRenderer = renderer.create(
        <Breadcrumbs links={links} />,
      );
      const testInstance: ReactTestInstance = testRenderer.root;
      const nav: ReactTestInstance = testInstance.findByType("nav");
      const list: ReactTestInstance = testInstance.findByType("ol");

      // JSDOM does not apply Tailwind media queries. Assert the classes that
      // control visibility and wrapping instead of a misleading visibility check.
      expect(nav.props["className"].split(" ")).toContain("block");
      expect(nav.props["className"]).not.toContain("hidden");
      expect(list.props["className"].split(" ")).toContain("flex-wrap");
      expect(nav.props["aria-label"]).toBe("Breadcrumb");
      expect(testInstance.findAllByType("li")).toHaveLength(count);
      testRenderer.unmount();
    },
  );

  test('Should render correctly and also contain "Home" and "Projects" string', () => {
    const links: Array<Link> = [
      {
        title: "Home",
        to: new Route("/"),
      },
      {
        title: "Projects",
        to: new Route("/projects"),
      },
    ];

    const testRenderer: ReactTestRenderer = renderer.create(
      <Breadcrumbs links={links} />,
    );
    const testInstance: ReactTestInstance = testRenderer.root;
    expect(testInstance.findAllByType("li")).toContainEqual(
      expect.objectContaining({
        props: expect.objectContaining({
          className: expect.stringContaining("breadcrumb-item"),
        }),
      }),
    );
    expect(
      testInstance.findAllByType("a")[0]?.findByType("span").props["children"],
    ).toEqual("Home");
    expect(
      testInstance.findAllByType("a")[1]?.findByType("span").props["children"],
    ).toEqual("Projects");
  });

  test("Should avoid linking to the current page", () => {
    // Mock `window.location.pathname`
    Object.defineProperty(window, "location", {
      get() {
        return { pathname: "/projects" };
      },
    });
    // Render component
    const links: Array<Link> = [
      {
        title: "Home",
        to: new Route("/"),
      },
      {
        title: "Projects",
        to: new Route("/projects"),
      },
    ];
    const testRenderer: ReactTestRenderer = renderer.create(
      <Breadcrumbs links={links} />,
    );
    const testInstance: ReactTestInstance = testRenderer.root;
    /*
     * The current page is not linked: it renders as a non-interactive <span>
     * (cursor-default), not an <a> (WCAG 4.1.2). Only the other crumbs are
     * rendered as anchors.
     */
    const anchors: ReactTestInstance[] = testInstance.findAllByType("a");
    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.props["className"]).toContain("cursor-pointer");
    // The current page ("Projects") renders as a cursor-default span.
    const currentPageSpans: ReactTestInstance[] = testInstance.findAll(
      (node: ReactTestInstance) => {
        return (
          node.type === "span" &&
          typeof node.props["className"] === "string" &&
          node.props["className"].includes("cursor-default")
        );
      },
    );
    expect(currentPageSpans.length).toBeGreaterThan(0);
    // Set up spy on navigation
    jest.spyOn(Navigation, "navigate");
    // Create a mock event with preventDefault
    const mockEvent: { preventDefault: ReturnType<typeof jest.fn> } = {
      preventDefault: jest.fn(),
    };
    // The first (non-current) link navigates when clicked.
    anchors[0]?.props["onClick"](mockEvent);
    expect(Navigation.navigate).toHaveBeenCalledTimes(1);
  });
});
