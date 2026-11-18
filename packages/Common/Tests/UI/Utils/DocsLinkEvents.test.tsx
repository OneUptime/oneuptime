import "@testing-library/jest-dom";
import LearnMoreLink from "../../../UI/Components/Link/LearnMoreLink";
import Navigation from "../../../UI/Utils/Navigation";
import ProductEvents from "../../../UI/Utils/ProductEvents";
import {
  DocsLinkSource,
  getDocsPageOfLink,
  openDocumentationLink,
  recordDocsLinkOpened,
} from "../../../UI/Utils/DocsLinkEvents";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import { ProductEventName } from "../../../Types/Analytics/ProductEvent";
import { JSONObject } from "../../../Types/JSON";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { SpyInstance } from "jest-mock";
import React from "react";

/*
 * A DOCS PAGE OPENED FROM THE PRODUCT (#7207): which product pages send
 * people to the docs, and to which docs page. docs/link_opened carries the
 * docs page - its address under /docs/, without the language, the anchor
 * or the query - and where it was opened from, and nothing else; an
 * address that is no docs page sends nothing.
 */

let sent: Array<{ name: ProductEventName; properties: JSONObject }> = [];

beforeEach(() => {
  sent = [];
  jest
    .spyOn(ProductEvents, "send")
    .mockImplementation(
      (name: ProductEventName, properties?: JSONObject): void => {
        sent.push({ name, properties: properties || {} });
      },
    );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the docs page an address opens", () => {
  test("its path under /docs/, without the language, the anchor or the query", () => {
    expect(getDocsPageOfLink("/docs/on-call/escalation-rules")).toBe(
      "on-call/escalation-rules",
    );
    expect(
      getDocsPageOfLink(
        "https://oneuptime.com/docs/de/on-call/escalation-rules#adding-a-rule",
      ),
    ).toBe("on-call/escalation-rules");
    expect(
      getDocsPageOfLink("/docs/zh-CN/monitor/website-monitor?from=search"),
    ).toBe("monitor/website-monitor");
    expect(getDocsPageOfLink("/docs/fa/introduction/glossary")).toBe(
      "introduction/glossary",
    );
  });

  test("none for an address that opens no docs page", () => {
    expect(getDocsPageOfLink("/dashboard/123/monitors")).toBeNull();
    expect(getDocsPageOfLink("https://github.com/OneUptime/oneuptime")).toBe(
      null,
    );
    expect(getDocsPageOfLink("/docs/")).toBeNull();
    expect(getDocsPageOfLink("/docs/de")).toBeNull();
    expect(getDocsPageOfLink("http://[bad")).toBeNull();
  });
});

describe("docs/link_opened", () => {
  test("carries the page and where it was opened from", () => {
    recordDocsLinkOpened({
      href: "/docs/de/on-call/escalation-rules#adding-a-rule",
      source: DocsLinkSource.Search,
    });

    expect(sent).toEqual([
      {
        name: ProductEventName.DocsLinkOpened,
        properties: { page: "on-call/escalation-rules", source: "search" },
      },
    ]);
  });

  test("is not sent for an address that is no docs page", () => {
    recordDocsLinkOpened({
      href: "/dashboard/123/monitors",
      source: DocsLinkSource.ViewDocumentation,
    });

    expect(sent).toEqual([]);
  });

  test("a list's View Documentation opens its page in a new tab, and says which", () => {
    const navigate: SpyInstance<typeof Navigation.navigate> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation(() => {});
    const link: URL = URL.fromString(
      "https://oneuptime.com/docs/status-pages/subscribers",
    );

    openDocumentationLink(link);

    expect(navigate).toHaveBeenCalledWith(link, { openInNewTab: true });
    expect(sent).toEqual([
      {
        name: ProductEventName.DocsLinkOpened,
        properties: {
          page: "status-pages/subscribers",
          source: "view_documentation",
        },
      },
    ]);

    openDocumentationLink(new Route("/docs/monitor/website-monitor"));
    expect(sent[1]?.properties).toEqual({
      page: "monitor/website-monitor",
      source: "view_documentation",
    });
  });

  test("a form's Learn more says which docs page it opened", () => {
    render(<LearnMoreLink docsPath="/docs/on-call/escalation-rules#rules" />);

    fireEvent.click(screen.getByTestId("learn-more-link"));

    expect(sent).toEqual([
      {
        name: ProductEventName.DocsLinkOpened,
        properties: {
          page: "on-call/escalation-rules",
          source: "learn_more",
        },
      },
    ]);
  });
});
