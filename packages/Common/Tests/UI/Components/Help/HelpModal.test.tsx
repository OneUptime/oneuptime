import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The help dialog (#8889): what a list's help (?) and a "how it works"
 * guide open. Drawn for real, with the markdown viewer's stand-in (it
 * draws the markdown as text), so these read what a person sees: the lead
 * as "In short", the topics as an accordion that a short document opens
 * whole and a long one opens at its first topic, the keys that move
 * between them, the docs link and "Was this clear?".
 */

/*
 * The reader's language: English, each word as written, unless a test
 * hands t() a locale's words.
 */
let readerWords: Readonly<Record<string, string>> = {};

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: unknown): string => {
          if (Object.prototype.hasOwnProperty.call(readerWords, key)) {
            return readerWords[key] as string;
          }

          if (
            options &&
            typeof options === "object" &&
            typeof (options as { defaultValue?: unknown }).defaultValue ===
              "string"
          ) {
            return (options as { defaultValue: string }).defaultValue;
          }

          return key;
        },
        i18n: {
          resolvedLanguage: Object.keys(readerWords).length > 0 ? "de" : "en",
          language: Object.keys(readerWords).length > 0 ? "de" : "en",
        },
      };
    },
  };
});

import HelpModal, {
  HELP_MODAL_DOCS_LINK_TEST_ID,
  HELP_MODAL_EXPAND_ALL_TEST_ID,
  HELP_MODAL_SECTIONS_TEST_ID,
  HELP_MODAL_SUMMARY_TEST_ID,
  HELP_MODAL_TEST_ID,
  getHelpSectionBodyTestId,
  getHelpSectionButtonTestId,
  getInitiallyOpenHelpSections,
} from "../../../../UI/Components/Help/HelpModal";
import { HelpSection } from "../../../../UI/Components/Help/HelpDocument";
import { forgetAnsweredExplanations } from "../../../../UI/Components/Feedback/WasThisClear";
import ProductFeedback from "../../../../UI/Utils/ProductFeedback";
import { ProductFeedbackKind } from "../../../../Types/ProductFeedback/ProductFeedback";
import Route from "../../../../Types/API/Route";
import URL from "../../../../Types/API/URL";
import { getJestSpyOn } from "../../../Spy";

const LONG_DOCUMENT: string = `An SLO is a reliability target, such as 99.9% uptime over 30 days.

OneUptime alerts you before its error budget runs out.

## Set Up an SLO

1. Create the SLO.
2. Attach monitors.

## Error Budget

The downtime the target allows.

## Alerts

Burn rate rules page people.

## Statuses

| Status | Meaning |
|--------|---------|
| Healthy | Fine |
`;

const SHORT_DOCUMENT: string = `A label rule adds labels to the hosts it matches.

## When Rules Run

When a host is created.

## What a Rule Adds

Its labels.
`;

const renderHelp: (props?: Partial<React.ComponentProps<typeof HelpModal>>) => {
  onClose: jest.Mock;
} = (
  props: Partial<React.ComponentProps<typeof HelpModal>> = {},
): { onClose: jest.Mock } => {
  const onClose: jest.Mock = jest.fn();

  render(
    <HelpModal
      title="How SLOs Work"
      description="Reliability targets measured from your monitors."
      markdown={LONG_DOCUMENT}
      onClose={onClose}
      {...props}
    />,
  );

  return { onClose: onClose };
};

const topicButton: (id: string) => HTMLElement = (id: string): HTMLElement => {
  return screen.getByTestId(getHelpSectionButtonTestId(id));
};

const topicBody: (id: string) => HTMLElement = (id: string): HTMLElement => {
  return screen.getByTestId(getHelpSectionBodyTestId(id));
};

const isTopicOpen: (id: string) => boolean = (id: string): boolean => {
  return topicButton(id).getAttribute("aria-expanded") === "true";
};

beforeEach(() => {
  readerWords = {};
  forgetAnsweredExplanations();
  ProductFeedback.setSettings({ isOn: true, isAskingMe: true });
});

afterEach(() => {
  cleanup();
  ProductFeedback.setSettings(null);
  jest.restoreAllMocks();
});

describe("what the dialog says first", () => {
  test("its title, the line under it, and its lead as In short", async () => {
    renderHelp();

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "How SLOs Work",
    );
    expect(screen.getByTestId("modal-description")).toHaveTextContent(
      "Reliability targets measured from your monitors.",
    );

    const summary: HTMLElement = screen.getByTestId(HELP_MODAL_SUMMARY_TEST_ID);

    expect(within(summary).getByRole("heading")).toHaveTextContent("In short");
    expect(
      await within(summary).findByText(/An SLO is a reliability target/),
    ).toBeInTheDocument();
    // The lead is named by its heading, for a screen reader.
    expect(summary.tagName).toBe("SECTION");
    expect(summary).toHaveAttribute(
      "aria-labelledby",
      within(summary).getByRole("heading").id,
    );
  });

  test("it is read at a width made for reading, not across the screen", () => {
    renderHelp();

    const dialog: HTMLElement = screen.getByTestId("modal");

    expect(dialog.className).toContain("sm:max-w-3xl");
    expect(dialog.className).not.toContain("sm:max-w-7xl");
  });

  test("a document with no topics is the help itself: drawn as text, with no In short over it", async () => {
    renderHelp({ markdown: "What a monitor is." });

    const summary: HTMLElement = screen.getByTestId(HELP_MODAL_SUMMARY_TEST_ID);

    expect(await within(summary).findByText("What a monitor is.")).toBeTruthy();
    expect(within(summary).queryByText("In short")).toBeNull();
    expect(screen.queryByTestId(HELP_MODAL_SECTIONS_TEST_ID)).toBeNull();
  });

  test("a document with topics and no lead shows no In short", () => {
    renderHelp({ markdown: "## Only Topics\n\nText.\n\n## Another\n\nMore." });

    expect(screen.queryByTestId(HELP_MODAL_SUMMARY_TEST_ID)).toBeNull();
    expect(screen.getByTestId(HELP_MODAL_SECTIONS_TEST_ID)).toBeInTheDocument();
  });
});

describe("its topics, one at a time", () => {
  test("a long document opens its first topic and lists the rest, closed", async () => {
    renderHelp();

    const sections: HTMLElement = screen.getByTestId(
      HELP_MODAL_SECTIONS_TEST_ID,
    );

    expect(
      within(sections)
        .getAllByRole("button")
        .map((button: HTMLElement): string => {
          return button.textContent || "";
        }),
    ).toEqual(["Set Up an SLO", "Error Budget", "Alerts", "Statuses"]);

    expect(isTopicOpen("set-up-an-slo")).toBe(true);
    expect(isTopicOpen("error-budget")).toBe(false);
    expect(isTopicOpen("alerts")).toBe(false);
    expect(isTopicOpen("statuses")).toBe(false);

    expect(
      await within(topicBody("set-up-an-slo")).findByText(/Create the SLO/),
    ).toBeVisible();
    // A closed topic is hidden, and its text is not drawn at all.
    expect(topicBody("error-budget")).not.toBeVisible();
    expect(topicBody("error-budget")).toBeEmptyDOMElement();
  });

  test("a short document opens whole, with nothing to expand", async () => {
    renderHelp({ markdown: SHORT_DOCUMENT });

    expect(isTopicOpen("when-rules-run")).toBe(true);
    expect(isTopicOpen("what-a-rule-adds")).toBe(true);
    expect(screen.queryByTestId(HELP_MODAL_EXPAND_ALL_TEST_ID)).toBeNull();
    expect(
      await within(topicBody("what-a-rule-adds")).findByText("Its labels."),
    ).toBeVisible();
  });

  test("a topic's heading opens and closes it, and says which way it is", async () => {
    renderHelp();

    fireEvent.click(topicButton("error-budget"));

    expect(isTopicOpen("error-budget")).toBe(true);
    expect(
      await within(topicBody("error-budget")).findByText(
        "The downtime the target allows.",
      ),
    ).toBeVisible();
    // Opening one leaves the others as they were.
    expect(isTopicOpen("set-up-an-slo")).toBe(true);

    fireEvent.click(topicButton("set-up-an-slo"));

    expect(isTopicOpen("set-up-an-slo")).toBe(false);
    expect(topicBody("set-up-an-slo")).not.toBeVisible();
  });

  test("each heading's button controls its topic, which is a region named by the heading", () => {
    renderHelp();

    const button: HTMLElement = topicButton("alerts");
    const body: HTMLElement = topicBody("alerts");

    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
    expect(button.closest("h3")).not.toBeNull();
    expect(button).toHaveAttribute("aria-controls", body.id);
    expect(body).toHaveAttribute("role", "region");
    expect(body).toHaveAttribute("aria-labelledby", button.id);
  });

  test("Expand all opens every topic, then reads Collapse all, which closes them", () => {
    renderHelp();

    const toggle: HTMLElement = screen.getByTestId(
      HELP_MODAL_EXPAND_ALL_TEST_ID,
    );

    expect(toggle).toHaveTextContent("Expand all");
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);

    for (const id of ["set-up-an-slo", "error-budget", "alerts", "statuses"]) {
      expect(isTopicOpen(id)).toBe(true);
    }
    expect(toggle).toHaveTextContent("Collapse all");
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(toggle);

    for (const id of ["set-up-an-slo", "error-budget", "alerts", "statuses"]) {
      expect(isTopicOpen(id)).toBe(false);
    }
    expect(toggle).toHaveTextContent("Expand all");
  });

  test("opening the last closed topic by hand turns Expand all into Collapse all", () => {
    renderHelp();

    fireEvent.click(topicButton("error-budget"));
    fireEvent.click(topicButton("alerts"));
    fireEvent.click(topicButton("statuses"));

    expect(screen.getByTestId(HELP_MODAL_EXPAND_ALL_TEST_ID)).toHaveTextContent(
      "Collapse all",
    );
  });
});

describe("the keyboard", () => {
  test("↓ and ↑ move between the topics' headings, round from the last to the first", () => {
    renderHelp();

    topicButton("set-up-an-slo").focus();

    fireEvent.keyDown(topicButton("set-up-an-slo"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(topicButton("error-budget"));

    fireEvent.keyDown(topicButton("error-budget"), { key: "ArrowDown" });
    fireEvent.keyDown(topicButton("alerts"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(topicButton("statuses"));

    fireEvent.keyDown(topicButton("statuses"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(topicButton("set-up-an-slo"));

    fireEvent.keyDown(topicButton("set-up-an-slo"), { key: "ArrowUp" });
    expect(document.activeElement).toBe(topicButton("statuses"));
  });

  test("Home and End go to the first and the last topic", () => {
    renderHelp();

    topicButton("alerts").focus();

    fireEvent.keyDown(topicButton("alerts"), { key: "End" });
    expect(document.activeElement).toBe(topicButton("statuses"));

    fireEvent.keyDown(topicButton("statuses"), { key: "Home" });
    expect(document.activeElement).toBe(topicButton("set-up-an-slo"));
  });

  test("moving between headings opens nothing, and other keys are left alone", () => {
    renderHelp();

    topicButton("set-up-an-slo").focus();
    fireEvent.keyDown(topicButton("set-up-an-slo"), { key: "ArrowDown" });
    fireEvent.keyDown(topicButton("error-budget"), { key: "a" });

    expect(document.activeElement).toBe(topicButton("error-budget"));
    expect(isTopicOpen("error-budget")).toBe(false);
  });

  test("the dialog starts with the focus on itself, not on the first topic", async () => {
    renderHelp();

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId("modal"));
    });
  });

  test("Escape closes it", () => {
    const { onClose } = renderHelp();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("an opener that points at one topic", () => {
  test("opens that topic alone and brings it into view", () => {
    const scrollIntoView: jest.Mock = jest.fn();
    const original: typeof HTMLElement.prototype.scrollIntoView =
      HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView =
      scrollIntoView as unknown as typeof HTMLElement.prototype.scrollIntoView;

    try {
      renderHelp({ initialSectionId: "statuses" });

      expect(isTopicOpen("statuses")).toBe(true);
      expect(isTopicOpen("set-up-an-slo")).toBe(false);
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrollIntoView.mock.instances[0]).toBe(topicButton("statuses"));
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });

  test("the first topic is in view already: the dialog keeps In short above it in sight", () => {
    const scrollIntoView: jest.Mock = jest.fn();
    const original: typeof HTMLElement.prototype.scrollIntoView =
      HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView =
      scrollIntoView as unknown as typeof HTMLElement.prototype.scrollIntoView;

    try {
      renderHelp({ initialSectionId: "set-up-an-slo" });

      expect(isTopicOpen("set-up-an-slo")).toBe(true);
      expect(isTopicOpen("statuses")).toBe(false);
      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });

  test("a topic the document does not have opens as if none was named", () => {
    renderHelp({ initialSectionId: "no-such-topic" });

    expect(isTopicOpen("set-up-an-slo")).toBe(true);
    expect(isTopicOpen("statuses")).toBe(false);
  });
});

describe("a guide already in its parts", () => {
  test("draws its topics' titles as given, in the reader's words", async () => {
    renderHelp({
      title: "So funktioniert es",
      isTitleTranslated: true,
      markdown: undefined,
      document: {
        summary: "",
        sections: [
          { id: "pipeline", title: "Die Pipeline", markdown: "Text A." },
          { id: "levels", title: "Schweregrade", markdown: "Text B." },
          { id: "tuning", title: "Feinabstimmung", markdown: "Text C." },
        ],
      },
      initialSectionId: "levels",
    });

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "So funktioniert es",
    );
    expect(topicButton("pipeline")).toHaveTextContent("Die Pipeline");
    expect(isTopicOpen("levels")).toBe(true);
    expect(
      await within(topicBody("levels")).findByText("Text B."),
    ).toBeVisible();
  });
});

describe("the documentation it summarizes", () => {
  test("is one click away, in a new tab", () => {
    renderHelp({ documentationLink: new Route("/docs/slo/introduction") });

    const link: HTMLElement = screen.getByTestId(HELP_MODAL_DOCS_LINK_TEST_ID);

    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/docs/slo/introduction");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveTextContent("Full documentation");
    // In the footer, beside Close, where it stays in sight however long the topics are.
    expect(screen.getByTestId("modal-footer")).toContainElement(link);
  });

  test("takes a URL as well as a route", () => {
    renderHelp({
      documentationLink: URL.fromString("https://oneuptime.com/docs/slo"),
    });

    expect(screen.getByTestId(HELP_MODAL_DOCS_LINK_TEST_ID)).toHaveAttribute(
      "href",
      "https://oneuptime.com/docs/slo",
    );
  });

  test("without a page of the docs, there is no link", () => {
    renderHelp();

    expect(screen.queryByTestId(HELP_MODAL_DOCS_LINK_TEST_ID)).toBeNull();
  });
});

describe("closing it", () => {
  test("Close and the × both close it", () => {
    const { onClose } = renderHelp();

    fireEvent.click(screen.getByTestId("modal-footer-close-button"));
    fireEvent.click(screen.getByTestId("close-button"));

    expect(onClose).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("modal-footer-close-button")).toHaveTextContent(
      "Close",
    );
    // Something to read: no Save, no second button.
    expect(screen.queryByTestId("modal-footer-submit-button")).toBeNull();
  });
});

describe("Was this clear?", () => {
  test("asks under the topics, and files the answer under the dialog's English title", async () => {
    const submit: jest.SpyInstance<any, any> = getJestSpyOn(
      ProductFeedback,
      "submit",
    ).mockImplementation(async (): Promise<void> => {});

    renderHelp();

    const body: HTMLElement = screen.getByTestId(HELP_MODAL_TEST_ID);
    const question: HTMLElement = within(body).getByTestId("was-this-clear");

    expect(question).toHaveTextContent("Was this clear?");

    await act(async () => {
      fireEvent.click(within(body).getByTestId("was-this-clear-no"));
    });

    expect(submit).toHaveBeenCalledWith({
      kind: ProductFeedbackKind.Explanation,
      topic: "help.how_slos_work",
      isPositive: false,
    });
    expect(within(body).getByTestId("was-this-clear-thanks")).toBeVisible();
  });

  test("files under a topic the opener names, when it names one", async () => {
    const submit: jest.SpyInstance<any, any> = getJestSpyOn(
      ProductFeedback,
      "submit",
    ).mockImplementation(async (): Promise<void> => {});

    renderHelp({ feedbackTopic: "security_events.detection_rules" });

    await act(async () => {
      fireEvent.click(screen.getByTestId("was-this-clear-yes"));
    });

    expect(submit).toHaveBeenCalledWith({
      kind: ProductFeedbackKind.Explanation,
      topic: "security_events.detection_rules",
      isPositive: true,
    });
  });

  test("is not asked of someone OneUptime may not ask", () => {
    ProductFeedback.setSettings({ isOn: true, isAskingMe: false });

    renderHelp();

    expect(screen.queryByTestId("was-this-clear")).toBeNull();
  });
});

describe("in the reader's language", () => {
  test("its own words are looked up; the document stays as written", async () => {
    readerWords = {
      "How SLOs Work": "So funktionieren SLOs",
      "In short": "Kurz gesagt",
      "Expand all": "Alle erweitern",
      "Full documentation": "Vollständige Dokumentation",
      Close: "Schließen",
    };

    renderHelp({ documentationLink: new Route("/docs/slo/introduction") });

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "So funktionieren SLOs",
    );
    expect(
      within(screen.getByTestId(HELP_MODAL_SUMMARY_TEST_ID)).getByRole(
        "heading",
      ),
    ).toHaveTextContent("Kurz gesagt");
    expect(screen.getByTestId(HELP_MODAL_EXPAND_ALL_TEST_ID)).toHaveTextContent(
      "Alle erweitern",
    );
    expect(screen.getByTestId(HELP_MODAL_DOCS_LINK_TEST_ID)).toHaveTextContent(
      "Vollständige Dokumentation",
    );
    expect(screen.getByTestId("modal-footer-close-button")).toHaveTextContent(
      "Schließen",
    );
    expect(topicButton("set-up-an-slo")).toHaveTextContent("Set Up an SLO");
  });
});

describe("which topics start open", () => {
  const sections: (count: number) => Array<HelpSection> = (
    count: number,
  ): Array<HelpSection> => {
    return Array.from({ length: count }, (_: unknown, index: number) => {
      return { id: `t${index}`, title: `T${index}`, markdown: "x" };
    });
  };

  test("one or two topics open together; three or more open at the first", () => {
    expect(getInitiallyOpenHelpSections({ sections: sections(1) })).toEqual([
      "t0",
    ]);
    expect(getInitiallyOpenHelpSections({ sections: sections(2) })).toEqual([
      "t0",
      "t1",
    ]);
    expect(getInitiallyOpenHelpSections({ sections: sections(3) })).toEqual([
      "t0",
    ]);
    expect(getInitiallyOpenHelpSections({ sections: [] })).toEqual([]);
  });

  test("the one an opener names, when the document has it", () => {
    expect(
      getInitiallyOpenHelpSections({
        sections: sections(2),
        initialSectionId: "t1",
      }),
    ).toEqual(["t1"]);
    expect(
      getInitiallyOpenHelpSections({
        sections: sections(3),
        initialSectionId: "missing",
      }),
    ).toEqual(["t0"]);
  });
});
