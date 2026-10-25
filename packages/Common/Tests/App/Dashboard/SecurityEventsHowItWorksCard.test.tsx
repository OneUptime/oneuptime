import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import SecurityEventsHowItWorksCard, {
  getHowItWorksCollapsedStorageKey,
  isHowItWorksCollapsed,
  readHowItWorksChoice,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/HowItWorks/SecurityEventsHowItWorksCard";
import {
  SecurityEventsGuide,
  SecurityEventsGuideSection,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/HowItWorks/SecurityEventsGuide";
import DetectionRulesGuide from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/HowItWorks/DetectionRulesGuide";
import ThreatIntelGuide from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/HowItWorks/ThreatIntelGuide";
import URL from "../../../Types/API/URL";
import IconProp from "../../../Types/Icon/IconProp";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import { DOCS_URL } from "../../../UI/Config";
import LocalStorage from "../../../UI/Utils/LocalStorage";

/*
 * The "how it works" card as a customer meets it: the pipeline and the
 * level mapping visible on the page, the full guide one click away in a
 * tabbed modal, and a Hide that sticks — per guide, and without ever
 * breaking when browser storage is unavailable.
 *
 * What the guides SAY is pinned against the engine in
 * SecurityEventsGuideContent.test.ts; this suite pins how it is shown.
 *
 * The guide renders its markdown through LazyMarkdownViewer (a React.lazy
 * boundary); render the source straight through, as the other suites that
 * assert on a lazy viewer's text do.
 */

interface MarkdownViewerProps {
  text: string;
}

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: MarkdownViewerProps): React.ReactElement => {
      return React.createElement("div", {}, props.text);
    },
  };
});

const TEST_GUIDE: SecurityEventsGuide = {
  id: "test-guide",
  title: "How the test feature works",
  summary: "A summary of the test feature.",
  steps: [
    {
      title: "First step",
      description: "First step description.",
      icon: IconProp.InboxArrowDown,
    },
    {
      title: "Second step",
      description: "Second step description.",
      icon: IconProp.Clock,
    },
    {
      title: "Third step",
      description: "Third step description.",
      icon: IconProp.Funnel,
    },
    {
      title: "Fourth step",
      description: "Fourth step description.",
      icon: IconProp.BellAlert,
    },
  ],
  levels: {
    title: "Severity levels",
    description: "How levels map to severities.",
    // The link says which levels it explains, in words of its own.
    linkText: "How severity levels are chosen",
    items: [
      { label: "low", severity: OcsfSeverity.Low },
      { label: "critical", severity: OcsfSeverity.Critical },
    ],
    sectionId: "levels",
  },
  guideTitle: "Test Feature Guide",
  guideDescription: "Everything about the test feature.",
  sections: [
    { id: "overview", title: "Overview", markdown: "Overview body text." },
    { id: "levels", title: "Levels", markdown: "Levels body text." },
    {
      id: "troubleshooting",
      title: "Troubleshooting",
      markdown: "Troubleshooting body text.",
    },
  ],
  documentationPath: "/telemetry/test-feature",
};

function renderCard(guide: SecurityEventsGuide = TEST_GUIDE): void {
  render(
    <MemoryRouter>
      <SecurityEventsHowItWorksCard guide={guide} />
    </MemoryRouter>,
  );
}

// The card over a list the page reads: null while it is read.
function renderOverList(listItemCount: number | null): {
  rerender: (count: number | null) => void;
} {
  const view: ReturnType<typeof render> = render(
    <MemoryRouter>
      <SecurityEventsHowItWorksCard
        guide={TEST_GUIDE}
        listItemCount={listItemCount}
      />
    </MemoryRouter>,
  );

  return {
    rerender: (count: number | null): void => {
      view.rerender(
        <MemoryRouter>
          <SecurityEventsHowItWorksCard
            guide={TEST_GUIDE}
            listItemCount={count}
          />
        </MemoryRouter>,
      );
    },
  };
}

function card(guide: SecurityEventsGuide = TEST_GUIDE): HTMLElement {
  return screen.getByTestId(`how-it-works-${guide.id}`);
}

function toggleButton(guide: SecurityEventsGuide = TEST_GUIDE): HTMLElement {
  return within(card(guide)).getByTestId("how-it-works-toggle");
}

function openGuideButton(guide: SecurityEventsGuide = TEST_GUIDE): HTMLElement {
  return within(card(guide)).getByTestId("how-it-works-open-guide");
}

function tabFor(section: SecurityEventsGuideSection): HTMLElement {
  return within(screen.getByTestId("modal")).getByRole("tab", {
    name: section.title,
  });
}

describe("SecurityEventsHowItWorksCard", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    window.localStorage.clear();
  });

  describe("the card", () => {
    test("shows the guide's title and summary as a labelled region", () => {
      renderCard();

      const region: HTMLElement = screen.getByRole("region", {
        name: TEST_GUIDE.title,
      });

      expect(region).toBe(card());
      expect(region).toHaveTextContent(TEST_GUIDE.summary);
    });

    test("lists every step, in order, numbered", () => {
      renderCard();

      const steps: Array<HTMLElement> =
        within(card()).getAllByTestId("how-it-works-step");

      expect(steps).toHaveLength(TEST_GUIDE.steps.length);

      TEST_GUIDE.steps.forEach(
        (step: SecurityEventsGuide["steps"][number], index: number) => {
          expect(steps[index]).toHaveTextContent(`Step ${index + 1}`);
          expect(steps[index]).toHaveTextContent(step.title);
          expect(steps[index]).toHaveTextContent(step.description);
        },
      );
    });

    test("shows each level next to the severity it becomes", () => {
      renderCard();

      const levels: Array<HTMLElement> =
        within(card()).getAllByTestId("how-it-works-level");

      expect(levels).toHaveLength(2);
      expect(levels[0]).toHaveTextContent("low");
      expect(levels[0]).toHaveTextContent(OcsfSeverity.Low);
      expect(levels[1]).toHaveTextContent("critical");
      expect(levels[1]).toHaveTextContent(OcsfSeverity.Critical);
      expect(within(card()).getByText(TEST_GUIDE.levels.title)).toBeVisible();
      expect(
        within(card()).getByText(TEST_GUIDE.levels.description),
      ).toBeVisible();
    });

    test("does not open the guide until asked", () => {
      renderCard();

      expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
    });
  });

  describe("hiding and showing", () => {
    test("starts expanded, with the toggle reporting it", () => {
      renderCard();

      expect(toggleButton()).toHaveTextContent("Hide");
      expect(toggleButton()).toHaveAttribute("aria-expanded", "true");

      const controlledId: string | null =
        toggleButton().getAttribute("aria-controls");
      expect(controlledId).toBeTruthy();
      expect(document.getElementById(controlledId!)).toContainElement(
        within(card()).getAllByTestId("how-it-works-step")[0]!,
      );
    });

    test("Hide shrinks the card to its title row and remembers it", () => {
      renderCard();

      fireEvent.click(toggleButton());

      expect(within(card()).queryAllByTestId("how-it-works-step")).toHaveLength(
        0,
      );
      expect(
        within(card()).queryAllByTestId("how-it-works-level"),
      ).toHaveLength(0);
      expect(card()).not.toHaveTextContent(TEST_GUIDE.summary);
      expect(card()).toHaveTextContent(TEST_GUIDE.title);
      expect(toggleButton()).toHaveTextContent("Show");
      expect(toggleButton()).toHaveAttribute("aria-expanded", "false");
      expect(
        window.localStorage.getItem(
          getHowItWorksCollapsedStorageKey(TEST_GUIDE.id),
        ),
      ).toBe("true");
    });

    test("the full guide stays one click away while hidden", () => {
      renderCard();

      fireEvent.click(toggleButton());
      fireEvent.click(openGuideButton());

      expect(screen.getByTestId("modal-title")).toHaveTextContent(
        TEST_GUIDE.guideTitle,
      );
    });

    test("Show brings the card back and remembers it shown", () => {
      renderCard();

      fireEvent.click(toggleButton());
      fireEvent.click(toggleButton());

      expect(within(card()).getAllByTestId("how-it-works-step")).toHaveLength(
        TEST_GUIDE.steps.length,
      );
      expect(toggleButton()).toHaveAttribute("aria-expanded", "true");
      // Shown on purpose: a page whose list has rows would fold it otherwise.
      expect(
        window.localStorage.getItem(
          getHowItWorksCollapsedStorageKey(TEST_GUIDE.id),
        ),
      ).toBe("false");
    });

    test("a card hidden on an earlier visit renders hidden", () => {
      window.localStorage.setItem(
        getHowItWorksCollapsedStorageKey(TEST_GUIDE.id),
        "true",
      );

      renderCard();

      expect(toggleButton()).toHaveTextContent("Show");
      expect(within(card()).queryAllByTestId("how-it-works-step")).toHaveLength(
        0,
      );
    });

    test("anything other than a stored true renders expanded", () => {
      window.localStorage.setItem(
        getHowItWorksCollapsedStorageKey(TEST_GUIDE.id),
        "garbage",
      );

      renderCard();

      expect(toggleButton()).toHaveTextContent("Hide");
    });

    test("hiding one guide leaves the other alone", () => {
      render(
        <MemoryRouter>
          <SecurityEventsHowItWorksCard guide={DetectionRulesGuide} />
          <SecurityEventsHowItWorksCard guide={ThreatIntelGuide} />
        </MemoryRouter>,
      );

      fireEvent.click(toggleButton(DetectionRulesGuide));

      expect(toggleButton(DetectionRulesGuide)).toHaveTextContent("Show");
      expect(toggleButton(ThreatIntelGuide)).toHaveTextContent("Hide");
      expect(getHowItWorksCollapsedStorageKey(DetectionRulesGuide.id)).not.toBe(
        getHowItWorksCollapsedStorageKey(ThreatIntelGuide.id),
      );
    });

    test("unreadable storage falls back to expanded instead of breaking the page", () => {
      jest.spyOn(LocalStorage, "getItem").mockImplementation(() => {
        throw new Error("SecurityError: storage is disabled");
      });

      renderCard();

      expect(toggleButton()).toHaveTextContent("Hide");
      expect(within(card()).getAllByTestId("how-it-works-step")).toHaveLength(
        TEST_GUIDE.steps.length,
      );
    });

    test("unwritable storage still lets the toggle work", () => {
      jest.spyOn(LocalStorage, "setItem").mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
      jest.spyOn(LocalStorage, "removeItem").mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });

      renderCard();

      fireEvent.click(toggleButton());
      expect(toggleButton()).toHaveTextContent("Show");

      fireEvent.click(toggleButton());
      expect(toggleButton()).toHaveTextContent("Hide");
    });
  });

  /*
   * A page whose list has rows opens on the list: the card is its title
   * row until the reader shows it. The explanation is for whoever looks at
   * an empty list; an analyst tuning forty rules met the same steps above
   * them on every visit.
   */
  describe("over a list", () => {
    function isShown(): boolean {
      return toggleButton().getAttribute("aria-expanded") === "true";
    }

    test("folded while the list is read, so nothing jumps when it has rows", () => {
      renderOverList(null);

      expect(isShown()).toBe(false);
      expect(within(card()).queryAllByTestId("how-it-works-step")).toHaveLength(
        0,
      );
      expect(toggleButton()).toHaveTextContent("Show");
      // The full guide is still a click away.
      expect(openGuideButton()).toBeInTheDocument();
    });

    test("open over an empty list: the one who needs it is looking at nothing", () => {
      renderOverList(0);

      expect(isShown()).toBe(true);
      expect(within(card()).getAllByTestId("how-it-works-step")).toHaveLength(
        TEST_GUIDE.steps.length,
      );
    });

    test("folded over a list with rows", () => {
      renderOverList(12);

      expect(isShown()).toBe(false);
      expect(card()).toHaveTextContent(TEST_GUIDE.title);
      expect(card()).not.toHaveTextContent(TEST_GUIDE.summary);
    });

    test("opens once the list reads empty, and stays folded once it reads rows", () => {
      const empty: { rerender: (count: number | null) => void } =
        renderOverList(null);
      expect(isShown()).toBe(false);
      empty.rerender(0);
      expect(isShown()).toBe(true);
      cleanup();

      const busy: { rerender: (count: number | null) => void } =
        renderOverList(null);
      busy.rerender(3);
      expect(isShown()).toBe(false);
    });

    test("the reader's own choice wins over the list, both ways", () => {
      window.localStorage.setItem(
        getHowItWorksCollapsedStorageKey(TEST_GUIDE.id),
        "true",
      );
      renderOverList(0);
      expect(isShown()).toBe(false);
      cleanup();

      window.localStorage.setItem(
        getHowItWorksCollapsedStorageKey(TEST_GUIDE.id),
        "false",
      );
      renderOverList(40);
      expect(isShown()).toBe(true);
    });

    test("Show over a list with rows sticks, and Hide over an empty one does", () => {
      const view: { rerender: (count: number | null) => void } =
        renderOverList(8);

      fireEvent.click(toggleButton());
      expect(isShown()).toBe(true);
      view.rerender(9);
      expect(isShown()).toBe(true);
      expect(
        readHowItWorksChoice(getHowItWorksCollapsedStorageKey(TEST_GUIDE.id)),
      ).toBe(false);
      cleanup();
      window.localStorage.clear();

      renderOverList(0);
      fireEvent.click(toggleButton());
      expect(isShown()).toBe(false);
      expect(
        window.localStorage.getItem(
          getHowItWorksCollapsedStorageKey(TEST_GUIDE.id),
        ),
      ).toBe("true");
    });

    test("whether it is folded, as the card decides it", () => {
      // No choice, no list: open, as the card always opened.
      expect(
        isHowItWorksCollapsed({ choice: null, listItemCount: undefined }),
      ).toBe(false);
      expect(isHowItWorksCollapsed({ choice: null, listItemCount: null })).toBe(
        true,
      );
      expect(isHowItWorksCollapsed({ choice: null, listItemCount: 0 })).toBe(
        false,
      );
      expect(isHowItWorksCollapsed({ choice: null, listItemCount: 1 })).toBe(
        true,
      );
      expect(isHowItWorksCollapsed({ choice: true, listItemCount: 0 })).toBe(
        true,
      );
      expect(isHowItWorksCollapsed({ choice: false, listItemCount: 7 })).toBe(
        false,
      );
      expect(
        isHowItWorksCollapsed({ choice: false, listItemCount: null }),
      ).toBe(false);
    });

    test("the stored choice reads as hidden, shown or none, and storage that fails reads as none", () => {
      const key: string = getHowItWorksCollapsedStorageKey(TEST_GUIDE.id);

      expect(readHowItWorksChoice(key)).toBeNull();
      window.localStorage.setItem(key, "true");
      expect(readHowItWorksChoice(key)).toBe(true);
      window.localStorage.setItem(key, "false");
      expect(readHowItWorksChoice(key)).toBe(false);
      window.localStorage.setItem(key, "garbage");
      expect(readHowItWorksChoice(key)).toBeNull();

      jest.spyOn(LocalStorage, "getItem").mockImplementation(() => {
        throw new Error("SecurityError: storage is disabled");
      });
      expect(readHowItWorksChoice(key)).toBeNull();
    });
  });

  describe("the full guide", () => {
    test("opens on the first section, with the guide's title and description", () => {
      renderCard();

      fireEvent.click(openGuideButton());

      expect(screen.getByTestId("modal-title")).toHaveTextContent(
        TEST_GUIDE.guideTitle,
      );
      expect(screen.getByTestId("modal-description")).toHaveTextContent(
        TEST_GUIDE.guideDescription,
      );
      expect(tabFor(TEST_GUIDE.sections[0]!)).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(
        screen.getByTestId("how-it-works-section-overview"),
      ).toHaveTextContent("Overview body text.");
    });

    test("has one tab per section, in order", () => {
      renderCard();

      fireEvent.click(openGuideButton());

      const tabs: Array<HTMLElement> = within(
        screen.getByTestId("modal"),
      ).getAllByRole("tab");

      expect(
        tabs.map((tab: HTMLElement) => {
          return tab.textContent;
        }),
      ).toEqual(
        TEST_GUIDE.sections.map((section: SecurityEventsGuideSection) => {
          return section.title;
        }),
      );
    });

    test("switching tabs shows that section instead", () => {
      renderCard();

      fireEvent.click(openGuideButton());
      fireEvent.click(tabFor(TEST_GUIDE.sections[2]!));

      expect(tabFor(TEST_GUIDE.sections[2]!)).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(
        screen.getByTestId("how-it-works-section-troubleshooting"),
      ).toHaveTextContent("Troubleshooting body text.");
      expect(
        screen.queryByTestId("how-it-works-section-overview"),
      ).not.toBeInTheDocument();
    });

    test("the levels link opens straight onto the section that explains them", () => {
      renderCard();

      fireEvent.click(within(card()).getByTestId("how-it-works-levels-link"));

      expect(tabFor(TEST_GUIDE.sections[1]!)).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(
        screen.getByTestId("how-it-works-section-levels"),
      ).toHaveTextContent("Levels body text.");
    });

    test("the levels link names the levels it explains", () => {
      renderCard();

      expect(
        within(card()).getByTestId("how-it-works-levels-link"),
      ).toHaveTextContent("How severity levels are chosen");
    });

    test("the footer Close button closes it", () => {
      renderCard();

      fireEvent.click(openGuideButton());

      const closeButton: HTMLElement = screen.getByTestId(
        "modal-footer-close-button",
      );
      expect(closeButton).toHaveTextContent("Close");

      fireEvent.click(closeButton);

      expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
    });

    test("the header close button closes it", () => {
      renderCard();

      fireEvent.click(openGuideButton());
      fireEvent.click(screen.getByTestId("close-button"));

      expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
    });

    test("offers no Save button — it is a guide, not a form", () => {
      renderCard();

      fireEvent.click(openGuideButton());

      expect(
        screen.queryByTestId("modal-footer-submit-button"),
      ).not.toBeInTheDocument();
    });

    test("reopening after switching tabs starts from the first section again", () => {
      renderCard();

      fireEvent.click(openGuideButton());
      fireEvent.click(tabFor(TEST_GUIDE.sections[2]!));
      fireEvent.click(screen.getByTestId("close-button"));
      fireEvent.click(openGuideButton());

      expect(tabFor(TEST_GUIDE.sections[0]!)).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });

    test("links to the full public documentation in a new tab", () => {
      renderCard();

      fireEvent.click(openGuideButton());

      const link: HTMLElement = within(
        screen.getByTestId("modal-footer"),
      ).getByText("Full documentation");
      const anchor: HTMLElement | null = link.closest("a");

      expect(anchor).not.toBeNull();
      expect(anchor).toHaveAttribute(
        "href",
        URL.fromString(
          `${DOCS_URL.toString()}${TEST_GUIDE.documentationPath}`,
        ).toString(),
      );
      expect(anchor?.getAttribute("href")).toContain(
        TEST_GUIDE.documentationPath,
      );
      expect(anchor).toHaveAttribute("target", "_blank");
    });
  });

  describe.each([
    ["Detection Rules", DetectionRulesGuide],
    ["Threat Intel", ThreatIntelGuide],
  ] as Array<[string, SecurityEventsGuide]>)(
    "the real %s guide",
    (_name: string, guide: SecurityEventsGuide) => {
      test("renders all of its steps and levels on the card", () => {
        renderCard(guide);

        expect(
          within(card(guide)).getAllByTestId("how-it-works-step"),
        ).toHaveLength(guide.steps.length);
        expect(
          within(card(guide)).getAllByTestId("how-it-works-level"),
        ).toHaveLength(guide.levels.items.length);
      });

      test("every tab shows its section's full markdown", () => {
        renderCard(guide);

        fireEvent.click(openGuideButton(guide));

        for (const section of guide.sections) {
          fireEvent.click(tabFor(section));

          expect(
            screen.getByTestId(`how-it-works-section-${section.id}`)
              .textContent,
          ).toBe(section.markdown);
        }
      });

      test("the levels link lands on the levels section", () => {
        renderCard(guide);

        fireEvent.click(
          within(card(guide)).getByTestId("how-it-works-levels-link"),
        );

        expect(
          screen.getByTestId(`how-it-works-section-${guide.levels.sectionId}`),
        ).toBeInTheDocument();
      });
    },
  );
});
