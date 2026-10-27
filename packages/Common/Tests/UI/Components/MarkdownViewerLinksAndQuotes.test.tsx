/*
 * Links and quotes in MarkdownViewer, as notes, feeds, descriptions and
 * setup guides show them.
 *
 * A customer's feedback, in the maintainer's words: "Pls make external
 * hyperlinks open in a new tab. Currently they take over my open oneuptime
 * tab. Also quoted text - exclamation icon is a bit misleading." So:
 *
 *   - a link that leaves the app - another site, an attachment, the docs -
 *     opens in a new tab, cut loose from the page; a link to another page
 *     of the same app, a "#section", mailto: and tel: stay as they were;
 *   - a blockquote is a quote: a grey bar and lighter text, as the editor
 *     shows it, with no icon; only one that asks to be a callout
 *     ("> [!WARNING]", "> **Note:**") is a tinted panel with its kind's icon.
 *
 * react-markdown and remark are ESM and do not run under Common's jest. The
 * stand-in below runs the remark plugins MarkdownViewer hands it over a tree
 * each test builds - the tree remark would build - and renders it through
 * the viewer's own `components`, handing each its tree node as react-markdown
 * does. The real parser runs in HugeTextInLongRunningProcess.test.ts, and the
 * drawn page in a browser in packages/E2E/EventOverview.
 */
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";

jest.mock("react-markdown", () => {
  return {
    __esModule: true,
    default: (props: MockReactMarkdownProps): React.ReactElement => {
      return renderMockMarkdown(props);
    },
    defaultUrlTransform: (url: string): string => {
      return url;
    },
  };
});

import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import i18next, { TFunction } from "i18next";
import { initReactI18next } from "react-i18next";
import remarkGfm from "remark-gfm";
import MarkdownViewer from "../../../UI/Components/Markdown.tsx/MarkdownViewer";
import Navigation from "../../../UI/Utils/Navigation";
import type { NavigateFunction } from "react-router-dom";
import {
  CalloutMarkdownNode,
  MARKDOWN_CALLOUT_KINDS,
  MarkdownCalloutKind,
  remarkMarkdownCallouts,
} from "../../../UI/Components/Markdown.tsx/MarkdownCallouts";
import {
  MARKDOWN_CALLOUT_CLASS_NAME,
  MARKDOWN_CALLOUT_STYLES,
  MARKDOWN_QUOTED_TEXT_CLASS_NAME,
  MARKDOWN_QUOTE_CLASS_NAME,
  MARKDOWN_TEXT_CLASS_NAME,
  getMarkdownCalloutName,
} from "../../../UI/Components/Markdown.tsx/MarkdownQuote";
import {
  MARKDOWN_LINK_CLASS_NAME,
  NEW_TAB_DESCRIPTION,
} from "../../../UI/Components/Markdown.tsx/MarkdownLink";
import { remarkInlineReferences } from "../../../UI/Components/Markdown.tsx/InlineReferences";
import BaseAPI from "../../../UI/Utils/API/API";

/*
 * ---------------------------------------------------------------------------
 * react-markdown stand-in
 * ---------------------------------------------------------------------------
 */

type Node = CalloutMarkdownNode;
type MockComponentMap = Record<string, React.ElementType>;

interface MockReactMarkdownProps {
  children?: string;
  components?: MockComponentMap;
  remarkPlugins?: Array<unknown>;
}

const mockMarkdownState: {
  tree: Node | null;
  calls: Array<MockReactMarkdownProps>;
} = { tree: null, calls: [] };

const MOCK_TAG_BY_NODE_TYPE: Record<string, string> = {
  paragraph: "p",
  strong: "strong",
  emphasis: "em",
  link: "a",
  blockquote: "blockquote",
  list: "ul",
  listItem: "li",
  break: "br",
  inlineCode: "code",
  heading: "h2",
};

// hast's dataCallout reaches a component as data-callout.
function mockAttributeName(propertyName: string): string {
  return propertyName.replace(/[A-Z]/g, (letter: string): string => {
    return `-${letter.toLowerCase()}`;
  });
}

function runMockPlugins(plugins: Array<unknown>, tree: Node): void {
  for (const plugin of plugins) {
    let transformer: unknown = undefined;

    if (Array.isArray(plugin)) {
      const [attacher, ...parameters] = plugin as [
        (...args: Array<unknown>) => unknown,
        ...Array<unknown>,
      ];
      transformer = attacher(...parameters);
    } else if (typeof plugin === "function") {
      transformer = (plugin as () => unknown)();
    }

    if (typeof transformer === "function") {
      (transformer as (node: Node) => void)(tree);
    }
  }
}

function renderMockNode(
  node: Node,
  components: MockComponentMap,
  key: number,
): React.ReactNode {
  if (node.type === "text") {
    return node.value || "";
  }

  const tagName: string = MOCK_TAG_BY_NODE_TYPE[node.type] || "span";
  const component: React.ElementType = (components[tagName] ||
    tagName) as React.ElementType;
  const elementProps: Record<string, unknown> = { key: key };

  // react-markdown hands every component the tree node it renders.
  if (typeof component !== "string") {
    elementProps["node"] = node;
  }

  for (const [name, value] of Object.entries(node.data?.hProperties || {})) {
    elementProps[mockAttributeName(name)] = value;
  }

  if (node.type === "link") {
    elementProps["href"] = node["url"];

    if (node["title"]) {
      elementProps["title"] = node["title"];
    }
  }

  const children: Array<React.ReactNode> =
    node.type === "inlineCode"
      ? [node.value || ""]
      : (node.children || []).map((child: Node, index: number) => {
          return renderMockNode(child, components, index);
        });

  return React.createElement(
    component,
    elementProps,
    ...(children.length > 0 ? children : []),
  );
}

function renderMockMarkdown(props: MockReactMarkdownProps): ReactElement {
  mockMarkdownState.calls.push(props);

  if (!mockMarkdownState.tree) {
    return React.createElement("div", {}, props.children);
  }

  // The real pipeline parses afresh on every render.
  const tree: Node = JSON.parse(JSON.stringify(mockMarkdownState.tree)) as Node;
  runMockPlugins(props.remarkPlugins || [], tree);

  return React.createElement(
    "div",
    { "data-testid": "react-markdown" },
    ...(tree.children || []).map((child: Node, index: number) => {
      return renderMockNode(child, props.components || {}, index);
    }),
  );
}

/*
 * ---------------------------------------------------------------------------
 * mdast helpers
 * ---------------------------------------------------------------------------
 */

function text(value: string): Node {
  return { type: "text", value: value };
}

function strong(...children: Array<Node>): Node {
  return { type: "strong", children: children };
}

function paragraph(...children: Array<Node>): Node {
  return { type: "paragraph", children: children };
}

function blockquote(...children: Array<Node>): Node {
  return { type: "blockquote", children: children };
}

function list(...items: Array<Node>): Node {
  return { type: "list", children: items };
}

function listItem(...children: Array<Node>): Node {
  return { type: "listItem", children: children };
}

function link(
  url: string,
  words: string,
  hProperties?: Record<string, unknown>,
): Node {
  return {
    type: "link",
    url: url,
    children: [text(words)],
    ...(hProperties ? { data: { hProperties: hProperties } } : {}),
  };
}

function root(...children: Array<Node>): Node {
  return { type: "root", children: children };
}

function showMarkdown(
  tree: Node,
  props?: { safeMode?: boolean },
): ReturnType<typeof render> {
  mockMarkdownState.tree = tree;
  return render(<MarkdownViewer text="ignored" {...(props || {})} />);
}

function lastMarkdownProps(): MockReactMarkdownProps {
  const props: MockReactMarkdownProps | undefined =
    mockMarkdownState.calls[mockMarkdownState.calls.length - 1];

  if (!props) {
    throw new Error("react-markdown was not rendered");
  }

  return props;
}

/*
 * ---------------------------------------------------------------------------
 * Pages and fixtures
 * ---------------------------------------------------------------------------
 */

const PROJECT_ID: string = "5f1c0b5e-7a4e-4d8e-9f61-0c2f1b0a7d11";
const DASHBOARD_PATH: string = `/dashboard/${PROJECT_ID}/incidents/9a3c0f6e-2b1d-4c5e-8f7a-1d2e3f4a5b6c`;
const STATUS_PAGE_PATH: string =
  "/status-page/2a1b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d/incidents/1";

const SLACK_FILE: string =
  "https://acme.slack.com/files/U0123ABCD/F0123ABCD/image.png";
const ATTACHMENT_PATH: string = `/api/incident-internal-note/attachment/${PROJECT_ID}/0c2f1b0a-7d11-4e8f-9a3c-0f6e2b1d4c5e/1d2e3f4a-5b6c-4d7e-8f9a-0b1c2d3e4f5a`;

// The amber exclamation-circle the viewer drew on every quote.
const OLD_QUOTE_ICON_PATH: string =
  "M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z";

const goTo: (path: string) => void = (path: string): void => {
  window.history.pushState({}, "", path);
};

function linkNamed(name: string): HTMLElement {
  return screen.getByRole("link", { name: name });
}

function expectOpensInNewTab(element: HTMLElement): void {
  expect(element).toHaveAttribute("target", "_blank");
  expect(element).toHaveAttribute("rel", "noopener noreferrer");
  expect(element).toHaveAttribute("aria-description", "Opens in a new tab");
}

function expectStaysInTab(element: HTMLElement): void {
  expect(element).not.toHaveAttribute("target");
  expect(element).not.toHaveAttribute("rel");
  expect(element).not.toHaveAttribute("aria-description");
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: {} },
      de: {
        translation: {
          "Opens in a new tab": "Öffnet in einem neuen Tab",
          /*
           * The shared words, as the Dashboard words them for other things
           * (a note somebody wrote, a status): a callout never reads them.
           */
          Note: "Notiz",
          Warning: "Warnstufe",
          // A callout's own names, as the docs name their callouts.
          markdownCallouts: {
            note: "Hinweis",
            warning: "Warnung",
            tip: "Tipp",
          },
        },
      },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  mockMarkdownState.tree = null;
  mockMarkdownState.calls = [];
  goTo(DASHBOARD_PATH);
});

afterEach(async () => {
  cleanup();
  jest.restoreAllMocks();
  await i18next.changeLanguage("en");
  goTo("/");
});

/*
 * ---------------------------------------------------------------------------
 * Links
 * ---------------------------------------------------------------------------
 */

describe("a link that leaves the app opens in a new tab", () => {
  test("the Slack file a saved note carries (the maintainer's screenshot)", () => {
    showMarkdown(root(paragraph(text("📎 "), link(SLACK_FILE, "image.png"))));

    const fileLink: HTMLElement = linkNamed("image.png");

    expect(fileLink).toHaveAttribute("href", SLACK_FILE);
    expectOpensInNewTab(fileLink);
    // Still drawn as every Markdown link is.
    expect(fileLink).toHaveClass(...MARKDOWN_LINK_CLASS_NAME.split(" "));
  });

  test.each([
    ["another site", "https://status.vendor.example/incidents/1"],
    ["an http page", "http://intranet.example/wiki"],
    ["a protocol-relative address", "//cdn.example/report.pdf"],
    ["the docs, from a setup guide", "/docs/telemetry/host-otel-collector"],
    ["a public status page", "/status-page/2a1b3c4d/incidents"],
  ])("%s", (_name: string, url: string) => {
    showMarkdown(root(paragraph(link(url, "Open it"))));

    expectOpensInNewTab(linkNamed("Open it"));
  });

  test("the link's words stay its name: the new tab is a description, not more words", () => {
    showMarkdown(root(paragraph(link(SLACK_FILE, "image.png"))));

    expect(linkNamed("image.png")).toHaveTextContent(/^image\.png$/);
    expect(screen.getByTestId("react-markdown")).toHaveTextContent(
      /^image\.png$/,
    );
  });

  test("an author's title stays", () => {
    showMarkdown(
      root(
        paragraph({
          type: "link",
          url: "https://www.example.com/",
          title: "Vendor status",
          children: [text("vendor")],
        }),
      ),
    );

    expect(linkNamed("vendor")).toHaveAttribute("title", "Vendor status");
  });

  test("a plain click is left to the browser: no script opens the tab", () => {
    const open: SpyInstance<typeof window.open> = jest
      .spyOn(window, "open")
      .mockImplementation((): Window | null => {
        return null;
      });

    showMarkdown(root(paragraph(link(SLACK_FILE, "image.png"))));

    const event: MouseEvent = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    linkNamed("image.png").dispatchEvent(event);

    expect(open).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  test("its description is read in the reader's language", async () => {
    await i18next.changeLanguage("de");

    showMarkdown(root(paragraph(link(SLACK_FILE, "image.png"))));

    expect(linkNamed("image.png")).toHaveAttribute(
      "aria-description",
      "Öffnet in einem neuen Tab",
    );
    expect(NEW_TAB_DESCRIPTION).toBe("Opens in a new tab");
  });
});

describe("a link into the same app stays in the tab", () => {
  test.each([
    [
      "an incident a feed entry names, written absolute",
      `${window.location.origin}/dashboard/${PROJECT_ID}/incidents/1`,
    ],
    ["a path from the root", `/dashboard/${PROJECT_ID}/monitors`],
    ["a path relative to the page", "../monitors"],
    ["a section of the page", "#root-cause"],
    ["an email address", "mailto:oncall@acme.example"],
    ["a phone number", "tel:+15551234567"],
    // What the viewer's URL check leaves of an address it refuses.
    ["no address at all", ""],
  ])("%s", (_name: string, url: string) => {
    showMarkdown(root(paragraph(link(url, "Go there"))));

    const element: HTMLElement =
      url === ""
        ? (screen.getByText("Go there") as HTMLElement)
        : linkNamed("Go there");

    expectStaysInTab(element);
    expect(element).toHaveClass(...MARKDOWN_LINK_CLASS_NAME.split(" "));
  });

  test("a footnote's reference keeps what remark-gfm gives it", () => {
    showMarkdown(
      root(
        paragraph(
          text("Footnote"),
          link("#user-content-fn-1", "1", {
            id: "user-content-fnref-1",
            "data-footnote-ref": "true",
            "aria-describedby": "footnote-label",
          }),
        ),
      ),
    );

    const reference: HTMLElement = linkNamed("1");

    expect(reference).toHaveAttribute("id", "user-content-fnref-1");
    expect(reference).toHaveAttribute("data-footnote-ref", "true");
    expect(reference).toHaveAttribute("aria-describedby", "footnote-label");
    expectStaysInTab(reference);
  });
});

/*
 * A link to another page of the same app opened it by loading the whole
 * app again, and the page lost what it had loaded. A plain click now opens
 * it inside the app, as the app's own links do; everything else - a
 * modifier key, another button, another project, a section of the page, an
 * app with no router - is left to the browser.
 */
describe("a link to another page of the same app opens inside the app", () => {
  let navigate: Mock<(to: unknown) => void>;

  beforeEach(() => {
    navigate = jest.fn<(to: unknown) => void>();
    Navigation.setNavigateHook(navigate as unknown as NavigateFunction);
  });

  afterEach(() => {
    Navigation.setNavigateHook(undefined as unknown as NavigateFunction);
  });

  const clickOn: (element: HTMLElement, init?: MouseEventInit) => MouseEvent = (
    element: HTMLElement,
    init?: MouseEventInit,
  ): MouseEvent => {
    const event: MouseEvent = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
      ...(init || {}),
    });

    element.dispatchEvent(event);

    return event;
  };

  test.each([
    [
      "an incident a feed entry names, written absolute",
      `${window.location.origin}/dashboard/${PROJECT_ID}/incidents/1036`,
      `/dashboard/${PROJECT_ID}/incidents/1036`,
    ],
    [
      "a path from the root, with its query and section",
      `/dashboard/${PROJECT_ID}/monitors?page=2#top`,
      `/dashboard/${PROJECT_ID}/monitors?page=2#top`,
    ],
    [
      "a path relative to the page",
      "../monitors",
      `/dashboard/${PROJECT_ID}/monitors`,
    ],
  ])(
    "a plain click on %s opens it inside the app",
    (_name: string, url: string, path: string) => {
      showMarkdown(root(paragraph(link(url, "Go there"))));

      const element: HTMLElement = linkNamed("Go there");
      // The address stays as written, for a new tab and for the reader.
      expect(element).toHaveAttribute("href", url);
      expectStaysInTab(element);

      const event: MouseEvent = clickOn(element);

      expect(event.defaultPrevented).toBe(true);
      expect(navigate).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledWith(path);
    },
  );

  test("a cmd/ctrl, shift, alt or middle click stays the browser's", () => {
    showMarkdown(
      root(paragraph(link(`/dashboard/${PROJECT_ID}/monitors`, "Monitors"))),
    );

    for (const init of [
      { metaKey: true },
      { ctrlKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
    ]) {
      expect(clickOn(linkNamed("Monitors"), init).defaultPrevented).toBe(false);
    }

    expect(navigate).not.toHaveBeenCalled();
  });

  test.each([
    [
      "another project: loaded in full, as switching projects is",
      "/dashboard/0b0b0b0b-0000-4000-8000-000000000000/incidents/1",
    ],
    ["a section of the page: the browser scrolls to it", "#root-cause"],
    ["an email address", "mailto:oncall@acme.example"],
  ])("%s is left to the browser", (_name: string, url: string) => {
    showMarkdown(root(paragraph(link(url, "Go there"))));

    expect(clickOn(linkNamed("Go there")).defaultPrevented).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  test("with no router to open it in, the browser loads the page", () => {
    Navigation.setNavigateHook(undefined as unknown as NavigateFunction);
    showMarkdown(
      root(paragraph(link(`/dashboard/${PROJECT_ID}/monitors`, "Monitors"))),
    );

    expect(clickOn(linkNamed("Monitors")).defaultPrevented).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  test("on a status page, one of its own pages opens inside it", () => {
    goTo(STATUS_PAGE_PATH);
    showMarkdown(
      root(
        paragraph(
          link(
            "/status-page/2a1b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d/announcements",
            "Announcements",
          ),
        ),
      ),
    );

    expect(clickOn(linkNamed("Announcements")).defaultPrevented).toBe(true);
    expect(navigate).toHaveBeenCalledWith(
      "/status-page/2a1b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d/announcements",
    );
  });

  test("a link that opens a new tab is never opened inside the app", () => {
    jest.spyOn(window, "open").mockImplementation((): Window | null => {
      return null;
    });
    showMarkdown(root(paragraph(link(SLACK_FILE, "image.png"))));

    clickOn(linkNamed("image.png"));

    expect(navigate).not.toHaveBeenCalled();
  });
});

/*
 * An address pasted into a note is one long word, and on a phone it ran out
 * past the note's edge, cut off. A link may break anywhere when its line has
 * no room left (the Notes page's E2E measures it on a phone).
 */
describe("a long address wraps inside the text it is in", () => {
  const LONG_ADDRESS: string =
    "https://grafana.acme.example/d/checkout-api-latency-overview/checkout-api-latency?orgId=1&from=now-6h&to=now&var-region=eu-west-1";

  test("a link that opens a new tab and one that stays alike", () => {
    showMarkdown(
      root(
        paragraph(link(LONG_ADDRESS, LONG_ADDRESS)),
        paragraph(link(`/dashboard/${PROJECT_ID}/monitors`, "Monitors")),
      ),
    );

    expectOpensInNewTab(linkNamed(LONG_ADDRESS));
    expectStaysInTab(linkNamed("Monitors"));

    for (const name of [LONG_ADDRESS, "Monitors"]) {
      expect(linkNamed(name)).toHaveClass("[overflow-wrap:anywhere]");
    }
    expect(MARKDOWN_LINK_CLASS_NAME.split(" ")).toContain(
      "[overflow-wrap:anywhere]",
    );
  });
});

/*
 * A name in inline code is often one long word - a metric's name, a span's,
 * a configuration key - and on a phone it ran out past the text's edge, cut
 * off. Like a long link, it may break anywhere when its line has no room
 * left (packages/E2E/MetricsAi measures it on a phone).
 */
describe("a long name in inline code wraps inside the text it is in", () => {
  const LONG_NAME: string =
    "com.example.storefront.checkout.http.server.request.count.by.tenant";

  test("inline code breaks anywhere; a timestamp stays on one line", () => {
    showMarkdown(
      root(
        paragraph(text("Metric: "), { type: "inlineCode", value: LONG_NAME }),
        paragraph(text("At "), {
          type: "inlineCode",
          value: "2026-10-24T11:00:00.000Z",
        }),
      ),
    );

    const code: HTMLElement = screen.getByText(LONG_NAME);

    expect(code.tagName).toBe("CODE");
    expect(code).toHaveClass("font-mono");
    expect(code).toHaveClass("[overflow-wrap:anywhere]");

    /*
     * It breaks after its own dots first ("...checkout." / "http..."), and
     * reads - and copies - as written: a <wbr> adds no character.
     */
    expect(code.textContent).toBe(LONG_NAME);
    expect(code.querySelectorAll("wbr")).toHaveLength(
      LONG_NAME.split(".").length - 1,
    );
    expect(code.childNodes[0]?.textContent).toBe("com.");

    // A timestamp is read as one: localized, and never broken.
    const time: HTMLElement | null = document.querySelector("time");

    expect(time).not.toBeNull();
    expect(time).toHaveClass("whitespace-nowrap");
    expect(time).not.toHaveClass("[overflow-wrap:anywhere]");
  });
});

describe("an attachment opens in a new tab", () => {
  test("on the Dashboard, a plain click refreshes the session, then points the tab at the file", async () => {
    const tab: {
      opener: unknown;
      closed: boolean;
      location: { href: string };
      close: () => void;
    } = {
      opener: window,
      closed: false,
      location: { href: "" },
      close: (): void => {},
    };
    const open: SpyInstance<typeof window.open> = jest
      .spyOn(window, "open")
      .mockImplementation((): Window | null => {
        return tab as unknown as Window;
      });
    const refresh: SpyInstance<typeof BaseAPI.refreshSession> = jest
      .spyOn(BaseAPI, "refreshSession")
      .mockResolvedValue(true);

    showMarkdown(
      root(
        paragraph(strong(text("Attachments:"))),
        list(listItem(paragraph(link(ATTACHMENT_PATH, "runbook.pdf")))),
      ),
    );

    const attachment: HTMLElement = linkNamed("runbook.pdf");

    // The address stays on the link: middle-click and "copy link" still work.
    expect(attachment).toHaveAttribute("href", ATTACHMENT_PATH);
    expectOpensInNewTab(attachment);

    const event: MouseEvent = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    attachment.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledWith("", "_blank");

    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(tab.opener).toBeNull();
    expect(tab.location.href).toBe(
      `${window.location.origin}${ATTACHMENT_PATH}`,
    );
  });

  test("a cmd/ctrl, shift or middle click stays the browser's", () => {
    const open: SpyInstance<typeof window.open> = jest
      .spyOn(window, "open")
      .mockImplementation((): Window | null => {
        return null;
      });

    showMarkdown(root(paragraph(link(ATTACHMENT_PATH, "runbook.pdf"))));

    for (const init of [
      { metaKey: true },
      { ctrlKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
    ]) {
      fireEvent.click(linkNamed("runbook.pdf"), init);
    }

    expect(open).not.toHaveBeenCalled();
  });

  test("on a status page, whose session is not the Dashboard's, it opens as it is", () => {
    goTo(STATUS_PAGE_PATH);
    const open: SpyInstance<typeof window.open> = jest
      .spyOn(window, "open")
      .mockImplementation((): Window | null => {
        return null;
      });

    showMarkdown(root(paragraph(link(ATTACHMENT_PATH, "runbook.pdf"))));

    const attachment: HTMLElement = linkNamed("runbook.pdf");
    expectOpensInNewTab(attachment);

    const event: MouseEvent = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    attachment.dispatchEvent(event);

    expect(open).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  test("on a status page, a link to one of its own pages stays", () => {
    goTo(STATUS_PAGE_PATH);

    showMarkdown(
      root(
        paragraph(
          link(
            "/status-page/2a1b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d/announcements",
            "Announcements",
          ),
        ),
      ),
    );

    expectStaysInTab(linkNamed("Announcements"));
  });
});

describe("the Markdown never decides where a link opens", () => {
  test("a target or rel a plugin left on a link is dropped or replaced", () => {
    showMarkdown(
      root(
        paragraph(
          link(SLACK_FILE, "outside", {
            target: "_self",
            rel: "opener",
          }),
          text(" "),
          link(`/dashboard/${PROJECT_ID}/monitors`, "inside", {
            target: "_blank",
            rel: "opener",
          }),
        ),
      ),
    );

    expectOpensInNewTab(linkNamed("outside"));
    expectStaysInTab(linkNamed("inside"));
  });

  test("react-markdown's tree node never reaches the page", () => {
    const { container } = showMarkdown(
      root(
        paragraph(link(SLACK_FILE, "outside")),
        blockquote(paragraph(text("quoted"))),
        blockquote(paragraph(text("[!WARNING]\ncareful"))),
        list(listItem(paragraph(text("item")))),
      ),
    );

    expect(container.querySelectorAll("[node]")).toHaveLength(0);
  });

  test("in safe mode a link is its words, with nothing to open", () => {
    showMarkdown(root(paragraph(link(SLACK_FILE, "image.png"))), {
      safeMode: true,
    });

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("image.png")).not.toHaveAttribute("href");
    expect(screen.getByText("image.png")).not.toHaveAttribute("target");
  });
});

/*
 * ---------------------------------------------------------------------------
 * Quotes and callouts
 * ---------------------------------------------------------------------------
 */

function quoteContaining(words: string | RegExp): HTMLElement {
  const quote: HTMLElement | null = screen
    .getByText(words)
    .closest("blockquote");

  if (!quote) {
    throw new Error(`"${words}" is in no blockquote`);
  }

  return quote;
}

describe("quoted text is a quote, not a warning", () => {
  test("the maintainer's screenshot: no icon, no box, a bar and lighter text", () => {
    const { container } = showMarkdown(
      root(blockquote(paragraph(text("They said something")))),
    );

    const quote: HTMLElement = quoteContaining("They said something");

    expect(quote.className).toBe(MARKDOWN_QUOTE_CLASS_NAME);
    // A bar on the side the text starts from, and the space after it.
    expect(quote).toHaveClass("border-s-[3px]", "border-gray-300", "ps-3");
    expect(quote).not.toHaveClass("bg-amber-50/50", "rounded-lg", "border");
    expect(quote.querySelector("svg")).toBeNull();
    expect(container.innerHTML).not.toContain(OLD_QUOTE_ICON_PATH);
    expect(quote).not.toHaveAttribute("role");
    expect(quote).not.toHaveAttribute("aria-label");
    expect(quote).not.toHaveAttribute("data-callout");

    const words: HTMLElement = screen.getByText("They said something");
    expect(words.tagName).toBe("P");
    expect(words).toHaveClass(MARKDOWN_QUOTED_TEXT_CLASS_NAME);
    expect(words).not.toHaveClass(MARKDOWN_TEXT_CLASS_NAME);
  });

  test("a quote's own blockquote role is kept for screen readers", () => {
    showMarkdown(root(blockquote(paragraph(text("quoted")))));

    expect(quoteContaining("quoted").tagName).toBe("BLOCKQUOTE");
  });

  test("text outside a quote keeps its usual shade", () => {
    showMarkdown(
      root(
        paragraph(text("before")),
        blockquote(paragraph(text("quoted"))),
        paragraph(text("after")),
      ),
    );

    expect(screen.getByText("before")).toHaveClass(MARKDOWN_TEXT_CLASS_NAME);
    expect(screen.getByText("after")).toHaveClass(MARKDOWN_TEXT_CLASS_NAME);
    expect(screen.getByText("quoted")).toHaveClass(
      MARKDOWN_QUOTED_TEXT_CLASS_NAME,
    );
  });

  test("a bold lead that is no label keeps it a quote", () => {
    showMarkdown(
      root(
        blockquote(
          paragraph(strong(text("Root cause:")), text(" the pool ran dry")),
        ),
      ),
    );

    const quote: HTMLElement = quoteContaining("the pool ran dry");

    expect(quote.className).toBe(MARKDOWN_QUOTE_CLASS_NAME);
    expect(quote.querySelector("svg")).toBeNull();
  });

  test("a quote in a quote, each with its bar", () => {
    showMarkdown(
      root(
        blockquote(
          paragraph(text("outer")),
          blockquote(paragraph(text("inner"))),
        ),
      ),
    );

    const inner: HTMLElement = quoteContaining("inner");
    const outer: HTMLElement = quoteContaining("outer");

    expect(inner.parentElement?.closest("blockquote")).toBe(outer);
    expect(inner.className).toBe(MARKDOWN_QUOTE_CLASS_NAME);
    expect(outer.className).toBe(MARKDOWN_QUOTE_CLASS_NAME);
    expect(screen.getByText("inner")).toHaveClass(
      MARKDOWN_QUOTED_TEXT_CLASS_NAME,
    );
  });

  test("a list in a quote takes the quote's shade", () => {
    showMarkdown(
      root(blockquote(list(listItem(paragraph(text("a quoted step")))))),
    );

    const item: HTMLElement = screen
      .getByText("a quoted step")
      .closest("li") as HTMLElement;

    expect(item).toHaveClass(MARKDOWN_QUOTED_TEXT_CLASS_NAME);
    expect(item).not.toHaveClass(MARKDOWN_TEXT_CLASS_NAME);
  });

  test("a link in a quote still opens where it should", () => {
    showMarkdown(
      root(blockquote(paragraph(text("see "), link(SLACK_FILE, "the file")))),
    );

    expectOpensInNewTab(linkNamed("the file"));
  });
});

describe("a callout is only what asks to be one", () => {
  test("> [!WARNING]: an amber panel with the warning sign, the marker not shown", () => {
    showMarkdown(
      root(
        blockquote(
          paragraph(
            text("[!WARNING]\n"),
            strong(text("This token is a secret.")),
            text(" Keep it in your deployment's secrets."),
          ),
        ),
      ),
    );

    const callout: HTMLElement = screen.getByRole("note", { name: "Warning" });

    expect(callout.tagName).toBe("BLOCKQUOTE");
    expect(callout).toHaveAttribute("data-callout", "warning");
    expect(callout.className).toBe(
      `${MARKDOWN_CALLOUT_CLASS_NAME} ${MARKDOWN_CALLOUT_STYLES.warning.panel}`,
    );
    expect(callout).toHaveTextContent(
      /^This token is a secret\. Keep it in your deployment's secrets\.$/,
    );
    expect(callout).not.toHaveTextContent("[!WARNING]");

    const icon: SVGElement = callout.querySelector("svg") as SVGElement;
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon.getAttribute("class")).toContain(
      MARKDOWN_CALLOUT_STYLES.warning.icon,
    );
    expect(icon.querySelector("path")).toHaveAttribute(
      "d",
      MARKDOWN_CALLOUT_STYLES.warning.iconPath,
    );

    // A callout's own words are read at the usual shade.
    expect(within(callout).getByText(/Keep it in your deployment/)).toHaveClass(
      MARKDOWN_TEXT_CLASS_NAME,
    );
  });

  test.each(
    MARKDOWN_CALLOUT_KINDS.map((kind: MarkdownCalloutKind) => {
      return [kind];
    }),
  )("> [!%s]", (kind: string) => {
    const style: (typeof MARKDOWN_CALLOUT_STYLES)[MarkdownCalloutKind] =
      MARKDOWN_CALLOUT_STYLES[kind as MarkdownCalloutKind];

    showMarkdown(
      root(blockquote(paragraph(text(`[!${kind.toUpperCase()}]\nRead this.`)))),
    );

    const callout: HTMLElement = screen.getByRole("note", {
      name: style.label,
    });

    expect(callout).toHaveAttribute("data-callout", kind);
    expect(callout.className).toBe(
      `${MARKDOWN_CALLOUT_CLASS_NAME} ${style.panel}`,
    );
    expect(callout.querySelector("path")).toHaveAttribute("d", style.iconPath);
    expect(callout).toHaveTextContent(/^Read this\.$/);
  });

  test("> **Note:** keeps its label and is a note", () => {
    showMarkdown(
      root(
        blockquote(
          paragraph(
            strong(text("Note:")),
            text(" The service runs as LocalSystem."),
          ),
        ),
      ),
    );

    const callout: HTMLElement = screen.getByRole("note", { name: "Note" });

    expect(callout).toHaveAttribute("data-callout", "note");
    expect(callout).toHaveTextContent(
      /^Note: The service runs as LocalSystem\.$/,
    );
  });

  test("a quote inside a callout is a quote, and a callout inside a quote is a callout", () => {
    showMarkdown(
      root(
        blockquote(
          paragraph(text("[!WARNING]\nThe vendor wrote:")),
          blockquote(paragraph(text("we are degraded"))),
        ),
        blockquote(
          paragraph(text("Earlier:")),
          blockquote(paragraph(text("[!TIP]\nquoted tip"))),
        ),
      ),
    );

    const quoteInCallout: HTMLElement = quoteContaining("we are degraded");
    expect(quoteInCallout.className).toBe(MARKDOWN_QUOTE_CLASS_NAME);
    expect(screen.getByText("we are degraded")).toHaveClass(
      MARKDOWN_QUOTED_TEXT_CLASS_NAME,
    );
    expect(screen.getByText("The vendor wrote:")).toHaveClass(
      MARKDOWN_TEXT_CLASS_NAME,
    );

    const calloutInQuote: HTMLElement = screen.getByRole("note", {
      name: "Tip",
    });
    expect(screen.getByText("quoted tip")).toHaveClass(
      MARKDOWN_TEXT_CLASS_NAME,
    );
    expect(calloutInQuote.parentElement?.closest("blockquote")).toBe(
      quoteContaining("Earlier:"),
    );
  });

  test("a marker that names no kind is a quote, and is shown", () => {
    showMarkdown(root(blockquote(paragraph(text("[!ALERT]\nheads up")))));

    expect(screen.queryByRole("note")).toBeNull();
    expect(quoteContaining(/heads up/).className).toBe(
      MARKDOWN_QUOTE_CLASS_NAME,
    );
    expect(quoteContaining(/heads up/)).toHaveTextContent("[!ALERT]");
  });

  test("its name is read in the reader's language", async () => {
    await i18next.changeLanguage("de");

    showMarkdown(
      root(
        blockquote(paragraph(text("[!WARNING]\nVorsicht"))),
        blockquote(paragraph(text("[!TIP]\nTipp"))),
      ),
    );

    expect(screen.getByRole("note", { name: "Warnung" })).toHaveAttribute(
      "data-callout",
      "warning",
    );
    expect(screen.getByRole("note", { name: "Tipp" })).toHaveAttribute(
      "data-callout",
      "tip",
    );
  });

  test("its name is a key of its own, never the shared word", async () => {
    await i18next.changeLanguage("de");

    showMarkdown(
      root(
        blockquote(paragraph(text("[!NOTE]\nnote"))),
        blockquote(paragraph(text("[!WARNING]\nwarning"))),
        blockquote(paragraph(text("[!DANGER]\ndanger"))),
      ),
    );

    // "Hinweis", not the Dashboard's "Notiz"; "Warnung", not "Warnstufe".
    expect(screen.getByRole("note", { name: "Hinweis" })).toHaveAttribute(
      "data-callout",
      "note",
    );
    expect(screen.getByRole("note", { name: "Warnung" })).toHaveAttribute(
      "data-callout",
      "warning",
    );
    expect(screen.queryByRole("note", { name: "Notiz" })).toBeNull();
    expect(screen.queryByRole("note", { name: "Warnstufe" })).toBeNull();
    // A kind the language has no name for yet reads the English.
    expect(screen.getByRole("note", { name: "Danger" })).toHaveAttribute(
      "data-callout",
      "danger",
    );
  });

  test("a stand-in t() that hands keys back reads the English", () => {
    const keysBack: TFunction = ((key: string): string => {
      return key;
    }) as unknown as TFunction;

    for (const kind of MARKDOWN_CALLOUT_KINDS) {
      expect(getMarkdownCalloutName(keysBack, kind)).toBe(
        MARKDOWN_CALLOUT_STYLES[kind].label,
      );
    }
  });
});

describe("the viewer runs the callout transform", () => {
  test("with remark-gfm, whether or not inline references are on", () => {
    render(<MarkdownViewer text="x" />);

    expect(lastMarkdownProps().remarkPlugins).toEqual([
      remarkGfm,
      remarkMarkdownCallouts,
    ]);

    render(<MarkdownViewer text="x" safeMode={true} inlineReferences={{}} />);

    expect(lastMarkdownProps().remarkPlugins).toEqual([
      remarkGfm,
      [remarkInlineReferences, { citations: true, eventReferences: true }],
      remarkMarkdownCallouts,
    ]);
  });

  test("safe mode keeps quotes and callouts: they open nothing", () => {
    showMarkdown(
      root(
        blockquote(paragraph(text("an AI's quote"))),
        blockquote(paragraph(text("[!WARNING]\nan AI's warning"))),
      ),
      { safeMode: true },
    );

    expect(quoteContaining("an AI's quote").className).toBe(
      MARKDOWN_QUOTE_CLASS_NAME,
    );
    expect(screen.getByRole("note", { name: "Warning" })).toHaveTextContent(
      "an AI's warning",
    );
  });
});
