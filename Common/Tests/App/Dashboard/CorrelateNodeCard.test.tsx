import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import React, { CSSProperties } from "react";
import renderer, {
  ReactTestInstance,
  ReactTestRenderer,
} from "react-test-renderer";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The Correlate graph's node card: one component for the centre filter,
 * event classes and co-occurring observables. Pinned here: what each kind
 * shows, the lower-bound and singular count wording, the tooltip, dimming,
 * the selection ring, the fixed sizes the layout packs with, the invisible
 * centred handles React Flow needs to draw edges at all, and the dark-mode
 * rule that no text colour is a literal dark hex.
 *
 * jsdom's CSS parser silently drops var() and color-mix() values, so the
 * colour assertions read the raw style objects through react-test-renderer
 * instead of the DOM.
 */

const mockTranslations: Record<string, string> = {};
const mockHandleProps: Array<Record<string, unknown>> = [];

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string): string => {
          return mockTranslations[key] ?? key;
        },
      };
    },
  };
});

/*
 * React Flow's Handle needs a provider; record what the card asks for
 * instead so the handle contract stays testable.
 */
jest.mock("reactflow", () => {
  return {
    __esModule: true,
    Handle: (props: Record<string, unknown>) => {
      mockHandleProps.push(props);
      return null;
    },
    Position: {
      Top: "top",
      Bottom: "bottom",
      Left: "left",
      Right: "right",
    },
  };
});

import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import { CorrelationGraphNodeKind } from "../../../../App/FeatureSet/Dashboard/src/Utils/CorrelationGraph";
import { getSeverityColor } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventSeverityPill";
import CorrelateNodeCard, {
  CORRELATE_NODE_SIZES,
  CORRELATE_NODE_TYPE,
  CORRELATE_NODE_TYPES,
  CorrelateNodeData,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/CorrelateNodeCard";

type CardProps = React.ComponentProps<typeof CorrelateNodeCard>;

// Mirrors NODE_SIZE in CorrelationGraphLayout.test.ts.
const LAYOUT_FOOTPRINTS: Record<
  CorrelationGraphNodeKind,
  { w: number; h: number }
> = {
  center: { w: 230, h: 60 },
  class: { w: 200, h: 60 },
  observable: { w: 170, h: 36 },
};

const ALL_KINDS: Array<CorrelationGraphNodeKind> = [
  "center",
  "class",
  "observable",
];

const DARK_HEXES: Array<string> = [
  "#000000",
  "#111827",
  "#1f2937",
  "#374151",
  "#4b5563",
  "#0f172a",
  "#1e293b",
  "#334155",
];

const LONG_VALUE: string =
  "very-long-hostname-that-would-never-fit.internal.example.corp.local";

function hexToRgb(hex: string): string {
  const red: number = parseInt(hex.slice(1, 3), 16);
  const green: number = parseInt(hex.slice(3, 5), 16);
  const blue: number = parseInt(hex.slice(5, 7), 16);
  return `rgb(${red}, ${green}, ${blue})`;
}

function defaultIdFor(kind: CorrelationGraphNodeKind): string {
  if (kind === "center") {
    return "center";
  }
  if (kind === "class") {
    return "class:Authentication";
  }
  return "observable:alice";
}

function buildData(
  kind: CorrelationGraphNodeKind,
  overrides: Partial<CorrelateNodeData> = {},
): CorrelateNodeData {
  const base: Record<CorrelationGraphNodeKind, CorrelateNodeData> = {
    center: {
      label: "User = alice",
      kind: "center",
      eyebrow: "Your filter",
      title: "User = alice",
      isMonospace: false,
      tooltip: "User = alice",
      isSelected: false,
      isDimmed: false,
    },
    class: {
      // The graph's class label format, which is also the class tooltip.
      label: "Authentication (12)",
      kind: "class",
      title: "Authentication",
      count: 12,
      countIsLowerBound: false,
      worstSeverity: OcsfSeverity.High,
      tooltip: "Authentication (12)",
      isSelected: false,
      isDimmed: false,
    },
    observable: {
      label: "alice",
      kind: "observable",
      title: "alice",
      isMonospace: true,
      count: 7,
      countIsLowerBound: false,
      tooltip: "alice",
      isSelected: false,
      isDimmed: false,
    },
  };
  return { ...base[kind], ...overrides };
}

function buildProps(
  kind: CorrelationGraphNodeKind,
  overrides: Partial<CorrelateNodeData> = {},
  id: string = defaultIdFor(kind),
): CardProps {
  return {
    id: id,
    data: buildData(kind, overrides),
    type: CORRELATE_NODE_TYPE,
    selected: false,
    isConnectable: false,
    xPos: 0,
    yPos: 0,
    zIndex: 0,
    dragging: false,
  };
}

function renderCard(
  kind: CorrelationGraphNodeKind,
  overrides: Partial<CorrelateNodeData> = {},
  id: string = defaultIdFor(kind),
): HTMLElement {
  render(<CorrelateNodeCard {...buildProps(kind, overrides, id)} />);
  return screen.getByTestId(`correlate-node-${id}`);
}

// Every host element's raw style object, before jsdom's CSS parser sees it.
function collectStyles(
  kind: CorrelationGraphNodeKind,
  overrides: Partial<CorrelateNodeData> = {},
): { root: CSSProperties; all: Array<CSSProperties> } {
  const testRenderer: ReactTestRenderer = renderer.create(
    <CorrelateNodeCard {...buildProps(kind, overrides)} />,
  );
  const hosts: Array<ReactTestInstance> = testRenderer.root.findAll(
    (node: ReactTestInstance): boolean => {
      return typeof node.type === "string";
    },
  );
  const styles: Array<CSSProperties> = hosts
    .map((node: ReactTestInstance): CSSProperties | undefined => {
      return node.props["style"] as CSSProperties | undefined;
    })
    .filter((style: CSSProperties | undefined): boolean => {
      return Boolean(style);
    }) as Array<CSSProperties>;
  const root: CSSProperties = hosts[0]!.props["style"] as CSSProperties;
  testRenderer.unmount();
  return { root: root, all: styles };
}

// The class card's second line and the observable count badge.
const SECONDARY_TEXT: string = "var(--ou-text-secondary, #4b5563)";

interface StyledHost {
  style: CSSProperties;
  className: string;
  // Every string rendered inside the host, joined without separators.
  text: string;
}

function textOf(node: ReactTestInstance | string): string {
  if (typeof node === "string") {
    return node;
  }
  return node.children
    .map((child: ReactTestInstance | string): string => {
      return textOf(child);
    })
    .join("");
}

// Host elements whose raw style matches, with their class and text.
function findStyledHosts(
  kind: CorrelationGraphNodeKind,
  overrides: Partial<CorrelateNodeData>,
  matches: (style: CSSProperties) => boolean,
): Array<StyledHost> {
  const testRenderer: ReactTestRenderer = renderer.create(
    <CorrelateNodeCard {...buildProps(kind, overrides)} />,
  );
  const found: Array<StyledHost> = testRenderer.root
    .findAll((node: ReactTestInstance): boolean => {
      const style: CSSProperties | undefined = node.props["style"] as
        | CSSProperties
        | undefined;
      return typeof node.type === "string" && Boolean(style) && matches(style!);
    })
    .map((node: ReactTestInstance): StyledHost => {
      return {
        style: { ...(node.props["style"] as CSSProperties) },
        className: String(node.props["className"] || ""),
        text: textOf(node),
      };
    });
  testRenderer.unmount();
  return found;
}

function colourValues(style: CSSProperties): Array<string> {
  return [
    style.color,
    style.background,
    style.backgroundColor,
    style.border,
    style.borderColor,
  ]
    .filter((value: unknown): boolean => {
      return typeof value === "string";
    })
    .map((value: unknown): string => {
      return (value as string).toLowerCase();
    });
}

beforeEach(() => {
  mockHandleProps.length = 0;
  for (const key of Object.keys(mockTranslations)) {
    delete mockTranslations[key];
  }
});

afterEach(() => {
  cleanup();
});

describe("CorrelateNodeCard exports", () => {
  test("the node type is 'correlate' and maps to the card component", () => {
    expect(CORRELATE_NODE_TYPE).toBe("correlate");
    expect(Object.keys(CORRELATE_NODE_TYPES)).toEqual(["correlate"]);
    expect(CORRELATE_NODE_TYPES[CORRELATE_NODE_TYPE]).toBe(CorrelateNodeCard);
  });

  test("sizes are the ones the spec fixes for each kind", () => {
    expect(CORRELATE_NODE_SIZES).toEqual({
      center: { width: 220, height: 56 },
      class: { width: 196, height: 56 },
      observable: { width: 164, height: 32 },
    });
  });

  test.each(ALL_KINDS)(
    "the %s size fits inside the footprint the layout packs with",
    (kind: CorrelationGraphNodeKind) => {
      expect(CORRELATE_NODE_SIZES[kind].width).toBeLessThanOrEqual(
        LAYOUT_FOOTPRINTS[kind].w,
      );
      expect(CORRELATE_NODE_SIZES[kind].height).toBeLessThanOrEqual(
        LAYOUT_FOOTPRINTS[kind].h,
      );
    },
  );
});

describe("CorrelateNodeCard root element", () => {
  test.each(ALL_KINDS)(
    "the %s card renders at its fixed size with a border-box and clipped overflow",
    (kind: CorrelationGraphNodeKind) => {
      const root: HTMLElement = renderCard(kind);
      expect(root.style.width).toBe(`${CORRELATE_NODE_SIZES[kind].width}px`);
      expect(root.style.height).toBe(`${CORRELATE_NODE_SIZES[kind].height}px`);
      expect(root.style.boxSizing).toBe("border-box");
      expect(root.style.overflow).toBe("hidden");
      // Handles are absolutely positioned against the card itself.
      expect(root.style.position).toBe("relative");
    },
  );

  test.each(ALL_KINDS)(
    "the %s card uses its tooltip as the title attribute",
    (kind: CorrelationGraphNodeKind) => {
      const root: HTMLElement = renderCard(kind, {
        tooltip: `Tooltip for ${kind}`,
      });
      expect(root).toHaveAttribute("title", `Tooltip for ${kind}`);
    },
  );

  test.each(ALL_KINDS)(
    "the %s card is hidden from assistive tech",
    (kind: CorrelationGraphNodeKind) => {
      const root: HTMLElement = renderCard(kind);
      expect(root).toHaveAttribute("aria-hidden", "true");
      expect(root).not.toHaveAttribute("tabindex");
      expect(root).not.toHaveAttribute("role");
    },
  );

  test("the test id is built from the node id", () => {
    renderCard("class", {}, "class:Network Activity");
    expect(
      screen.getByTestId("correlate-node-class:Network Activity"),
    ).toBeInTheDocument();
  });

  test.each(ALL_KINDS)(
    "the %s card fades to 0.3 when dimmed and is opaque otherwise",
    (kind: CorrelationGraphNodeKind) => {
      const dimmed: HTMLElement = renderCard(kind, { isDimmed: true });
      expect(dimmed.style.opacity).toBe("0.3");
      cleanup();
      const normal: HTMLElement = renderCard(kind, { isDimmed: false });
      expect(normal.style.opacity).toBe("1");
      expect(normal.style.transition).toContain("opacity");
    },
  );

  test("only the centre card keeps the default cursor", () => {
    expect(renderCard("center").style.cursor).toBe("default");
    cleanup();
    expect(renderCard("class").style.cursor).toBe("pointer");
    cleanup();
    expect(renderCard("observable").style.cursor).toBe("pointer");
  });
});

describe("CorrelateNodeCard handles", () => {
  test.each(ALL_KINDS)(
    "the %s card renders an invisible centred target and source handle",
    (kind: CorrelationGraphNodeKind) => {
      renderCard(kind);
      expect(mockHandleProps).toHaveLength(2);

      const target: Record<string, unknown> | undefined = mockHandleProps.find(
        (handle: Record<string, unknown>): boolean => {
          return handle["type"] === "target";
        },
      );
      const source: Record<string, unknown> | undefined = mockHandleProps.find(
        (handle: Record<string, unknown>): boolean => {
          return handle["type"] === "source";
        },
      );
      expect(target?.["position"]).toBe("top");
      expect(source?.["position"]).toBe("bottom");

      for (const handle of [target, source]) {
        expect(handle?.["isConnectable"]).toBe(false);
        expect(handle?.["style"]).toEqual(
          expect.objectContaining({
            position: "absolute",
            top: "50%",
            left: "50%",
            right: "auto",
            bottom: "auto",
            transform: "translate(-50%, -50%)",
            width: 1,
            height: 1,
            minWidth: 0,
            minHeight: 0,
            opacity: 0,
            pointerEvents: "none",
            background: "transparent",
          }),
        );
      }
    },
  );
});

describe("CorrelateNodeCard centre card", () => {
  test("shows the eyebrow and the filter title", () => {
    const root: HTMLElement = renderCard("center", {
      eyebrow: "Correlating",
      title: "Host = web-01",
    });
    expect(root).toHaveTextContent("Correlating");
    expect(screen.getByText("Host = web-01")).toBeInTheDocument();
  });

  test("omits the eyebrow when there is none", () => {
    const root: HTMLElement = renderCard("center", {
      eyebrow: undefined,
      title: "Host = web-01",
    });
    expect(root.querySelectorAll("span")).toHaveLength(1);
    expect(root).toHaveTextContent(/^Host = web-01$/);
  });

  test("uses a monospace title only when asked", () => {
    renderCard("center", { title: "10.0.0.5", isMonospace: true });
    expect(screen.getByText("10.0.0.5")).toHaveClass("font-mono");
    cleanup();
    renderCard("center", { title: "2 conditions", isMonospace: false });
    expect(screen.getByText("2 conditions")).not.toHaveClass("font-mono");
  });

  test("is a filled indigo card with white text", () => {
    const root: HTMLElement = renderCard("center");
    expect(root.style.background).toBe(hexToRgb("#4f46e5"));
    expect(root.style.color).toBe(hexToRgb("#ffffff"));
  });

  test("never shows a count or a severity", () => {
    const root: HTMLElement = renderCard("center", {
      count: 5,
      worstSeverity: OcsfSeverity.Critical,
    });
    expect(root).not.toHaveTextContent(/event/);
    expect(root).not.toHaveTextContent(/Critical|No severity/);
  });

  test("truncates a long title", () => {
    const root: HTMLElement = renderCard("center", {
      eyebrow: LONG_VALUE,
      title: LONG_VALUE,
      tooltip: LONG_VALUE,
    });
    for (const span of Array.from(root.querySelectorAll("span"))) {
      expect(span).toHaveClass("block", "truncate");
    }
    expect(root).toHaveAttribute("title", LONG_VALUE);
  });
});

describe("CorrelateNodeCard class card", () => {
  test("shows the class name, severity word and event count", () => {
    const root: HTMLElement = renderCard("class", {
      title: "Authentication",
      worstSeverity: OcsfSeverity.High,
      count: 12,
    });
    expect(screen.getByText("Authentication")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.getByText("12 events")).toBeInTheDocument();
    expect(root).not.toHaveTextContent("No severity");
  });

  test("marks a capped count as a lower bound", () => {
    renderCard("class", { count: 12, countIsLowerBound: true });
    expect(screen.getByText("12+ events")).toBeInTheDocument();
    expect(screen.queryByText("12 events")).not.toBeInTheDocument();
  });

  test("uses the singular for one event", () => {
    renderCard("class", { count: 1 });
    expect(screen.getByText("1 event")).toBeInTheDocument();
    expect(screen.queryByText("1 events")).not.toBeInTheDocument();
  });

  test("treats a missing count as zero events", () => {
    renderCard("class", { count: undefined });
    expect(screen.getByText("0 events")).toBeInTheDocument();
  });

  test("says 'No severity' when the class has none", () => {
    renderCard("class", { worstSeverity: undefined });
    expect(screen.getByText("No severity")).toBeInTheDocument();
  });

  test("routes its own words through the translator", () => {
    mockTranslations["No severity"] = "Sin gravedad";
    mockTranslations["events"] = "eventos";
    mockTranslations["event"] = "evento";
    renderCard("class", { worstSeverity: undefined, count: 3 });
    expect(screen.getByText("Sin gravedad")).toBeInTheDocument();
    expect(screen.getByText("3 eventos")).toBeInTheDocument();
    cleanup();
    renderCard("class", { count: 1 });
    expect(screen.getByText("1 evento")).toBeInTheDocument();
  });

  test("shows the selection ring only when selected", () => {
    const selected: HTMLElement = renderCard("class", { isSelected: true });
    expect(selected.style.boxShadow).toContain("#6366f1");
    cleanup();
    const resting: HTMLElement = renderCard("class", { isSelected: false });
    expect(resting.style.boxShadow).not.toBe("");
    expect(resting.style.boxShadow).not.toContain("#6366f1");
  });

  test("ignores React Flow's own selected flag", () => {
    render(
      <CorrelateNodeCard
        {...buildProps("class", { isSelected: false })}
        selected={true}
      />,
    );
    expect(
      screen.getByTestId("correlate-node-class:Authentication").style.boxShadow,
    ).not.toContain("#6366f1");
  });

  test.each([
    OcsfSeverity.Critical,
    OcsfSeverity.Fatal,
    OcsfSeverity.High,
    OcsfSeverity.Medium,
    OcsfSeverity.Low,
    OcsfSeverity.Informational,
    OcsfSeverity.Unknown,
    OcsfSeverity.Other,
  ])(
    "draws the %s accent bar in the severity colour",
    (severity: OcsfSeverity) => {
      renderCard("class", { worstSeverity: severity });
      const accent: HTMLElement = screen.getByTestId(
        "correlate-node-class:Authentication-accent",
      );
      expect(accent.style.background).toBe(
        hexToRgb(getSeverityColor(severity).toString()),
      );
      expect(accent.style.width).toBe("4px");
      expect(accent.style.position).toBe("absolute");
      expect(screen.getByText(severity)).toBeInTheDocument();
    },
  );

  test("tints the card and its dot with the severity colour", () => {
    const high: string = getSeverityColor(OcsfSeverity.High).toString();
    const styles: { root: CSSProperties; all: Array<CSSProperties> } =
      collectStyles("class", { worstSeverity: OcsfSeverity.High });
    expect(styles.root.background).toBe(
      `color-mix(in srgb, ${high} 9%, var(--ou-surface-primary, #ffffff))`,
    );
    const accented: Array<CSSProperties> = styles.all.filter(
      (style: CSSProperties): boolean => {
        return style.background === high;
      },
    );
    // The accent bar and the severity dot.
    expect(accented).toHaveLength(2);
  });

  test("falls back to the neutral token when there is no severity", () => {
    const styles: { root: CSSProperties; all: Array<CSSProperties> } =
      collectStyles("class", { worstSeverity: undefined });
    expect(styles.root.background).toBe(
      "color-mix(in srgb, var(--ou-chart-series-neutral, #64748b) 9%, var(--ou-surface-primary, #ffffff))",
    );
    const neutral: Array<CSSProperties> = styles.all.filter(
      (style: CSSProperties): boolean => {
        return style.background === "var(--ou-chart-series-neutral, #64748b)";
      },
    );
    expect(neutral).toHaveLength(2);
  });

  test("uses theme tokens for its text and border", () => {
    const styles: { root: CSSProperties; all: Array<CSSProperties> } =
      collectStyles("class");
    expect(styles.root.color).toBe("var(--ou-text-primary, #111827)");
    expect(styles.root.border).toBe(
      "1px solid var(--ou-border-default, #e5e7eb)",
    );
    const secondary: Array<CSSProperties> = styles.all.filter(
      (style: CSSProperties): boolean => {
        return style.color === SECONDARY_TEXT;
      },
    );
    expect(secondary).toHaveLength(1);
  });

  /*
   * The second line (severity word and event count) sits on a tinted card;
   * the muted token was too light to pass contrast there, so it uses the
   * secondary text token instead.
   */
  test("draws the severity and count line in the secondary text colour", () => {
    const lines: Array<StyledHost> = findStyledHosts(
      "class",
      { worstSeverity: OcsfSeverity.High, count: 12 },
      (style: CSSProperties): boolean => {
        return style.color === SECONDARY_TEXT;
      },
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]!.text).toBe("High12 events");
    expect(lines[0]!.className).toEqual(
      expect.stringContaining("justify-between"),
    );
  });

  test("keeps the secondary colour for an unrated or capped class", () => {
    const lines: Array<StyledHost> = findStyledHosts(
      "class",
      { worstSeverity: undefined, count: 200, countIsLowerBound: true },
      (style: CSSProperties): boolean => {
        return style.color === SECONDARY_TEXT;
      },
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]!.text).toBe("No severity200+ events");
  });

  test("never uses the muted text token", () => {
    for (const overrides of [
      {},
      { worstSeverity: undefined },
      { isSelected: true, isDimmed: true },
    ] as Array<Partial<CorrelateNodeData>>) {
      const styles: { root: CSSProperties; all: Array<CSSProperties> } =
        collectStyles("class", overrides);
      for (const style of styles.all) {
        for (const value of colourValues(style)) {
          expect(value).not.toContain("--ou-text-muted");
        }
      }
    }
  });

  test("truncates a long class name and severity, never the count", () => {
    renderCard("class", { title: LONG_VALUE, count: 200 });
    expect(screen.getByText(LONG_VALUE)).toHaveClass("block", "truncate");
    expect(screen.getByText("High")).toHaveClass("truncate");
    expect(screen.getByText("High").parentElement).toHaveClass("min-w-0");
    expect(screen.getByText("200 events")).toHaveClass(
      "shrink-0",
      "tabular-nums",
    );
  });
});

describe("CorrelateNodeCard observable card", () => {
  test("shows the value in monospace with its count badge", () => {
    const root: HTMLElement = renderCard("observable", {
      title: "10.0.0.5",
      count: 7,
    });
    expect(screen.getByText("10.0.0.5")).toHaveClass("font-mono");
    expect(screen.getByText("7")).toHaveClass("rounded-full", "tabular-nums");
    expect(root).toHaveTextContent(/^10\.0\.0\.57$/);
  });

  test("marks a capped count as a lower bound", () => {
    renderCard("observable", { count: 7, countIsLowerBound: true });
    expect(screen.getByText("7+")).toBeInTheDocument();
  });

  test("shows a zero count", () => {
    renderCard("observable", { count: 0 });
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  test("leaves the badge out when there is no count", () => {
    const root: HTMLElement = renderCard("observable", { count: undefined });
    expect(root.querySelectorAll("span")).toHaveLength(1);
  });

  test("does not render class-card details", () => {
    const root: HTMLElement = renderCard("observable", {
      worstSeverity: OcsfSeverity.Critical,
    });
    expect(root).not.toHaveTextContent(/Critical|No severity|event/);
    expect(
      screen.queryByTestId("correlate-node-observable:alice-accent"),
    ).not.toBeInTheDocument();
  });

  test("is a pill", () => {
    const root: HTMLElement = renderCard("observable");
    expect(root.style.borderRadius).toBe("999px");
    expect(root.style.display).toBe("flex");
    expect(root.style.alignItems).toBe("center");
  });

  test("shows the selection ring only when selected", () => {
    const selected: HTMLElement = renderCard("observable", {
      isSelected: true,
    });
    expect(selected.style.boxShadow).toContain("#6366f1");
    cleanup();
    const resting: HTMLElement = renderCard("observable", {
      isSelected: false,
    });
    expect(resting.style.boxShadow).not.toContain("#6366f1");
  });

  test("truncates a long value but keeps the badge whole", () => {
    renderCard("observable", {
      title: LONG_VALUE,
      tooltip: LONG_VALUE,
      count: 42,
    });
    expect(screen.getByText(LONG_VALUE)).toHaveClass(
      "min-w-0",
      "flex-1",
      "truncate",
    );
    expect(screen.getByText("42")).toHaveClass("shrink-0");
    expect(
      screen.getByTestId("correlate-node-observable:alice"),
    ).toHaveAttribute("title", LONG_VALUE);
  });

  test("uses theme tokens for its surface, text, border and badge", () => {
    const styles: { root: CSSProperties; all: Array<CSSProperties> } =
      collectStyles("observable");
    expect(styles.root.background).toBe("var(--ou-surface-primary, #ffffff)");
    expect(styles.root.color).toBe("var(--ou-text-primary, #111827)");
    expect(styles.root.border).toBe(
      "1px solid var(--ou-border-strong, #d1d5db)",
    );
    const badge: CSSProperties | undefined = styles.all.find(
      (style: CSSProperties): boolean => {
        return style.background === "var(--ou-surface-tertiary, #f3f4f6)";
      },
    );
    expect(badge?.color).toBe(SECONDARY_TEXT);
  });

  test("draws the count badge in the secondary text colour, for capped counts too", () => {
    for (const overrides of [
      { count: 7 },
      { count: 7, countIsLowerBound: true },
      { count: 0 },
      { count: 7, isSelected: true, isDimmed: true },
    ] as Array<Partial<CorrelateNodeData>>) {
      const badges: Array<StyledHost> = findStyledHosts(
        "observable",
        overrides,
        (style: CSSProperties): boolean => {
          return style.background === "var(--ou-surface-tertiary, #f3f4f6)";
        },
      );

      expect(badges).toHaveLength(1);
      expect(badges[0]!.style.color).toBe(SECONDARY_TEXT);
      expect(badges[0]!.text).toBe(
        `${overrides.count}${overrides.countIsLowerBound ? "+" : ""}`,
      );
    }
  });

  test("never uses the muted text token", () => {
    const styles: { root: CSSProperties; all: Array<CSSProperties> } =
      collectStyles("observable", { isSelected: true });
    for (const style of styles.all) {
      for (const value of colourValues(style)) {
        expect(value).not.toContain("--ou-text-muted");
      }
    }
  });
});

describe("CorrelateNodeCard secondary text token", () => {
  const themeCss: string = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "UI", "Styles", "Theme.css"),
    "utf8",
  );

  function tokenValue(block: string): string | undefined {
    const match: RegExpMatchArray | null = block.match(
      /--ou-text-secondary:\s*(#[0-9a-fA-F]{6})\s*;/,
    );
    return match?.[1]?.toLowerCase();
  }

  function blockAfter(selector: string): string {
    const start: number = themeCss.indexOf(`${selector} {`);
    expect(start).toBeGreaterThanOrEqual(0);
    const end: number = themeCss.indexOf("}", start);
    return themeCss.slice(start, end);
  }

  test("the fallback matches the light theme's value", () => {
    expect(tokenValue(blockAfter(":root"))).toBe("#4b5563");
    expect(SECONDARY_TEXT).toBe(
      `var(--ou-text-secondary, ${tokenValue(blockAfter(":root"))})`,
    );
  });

  test("the dark theme redefines the token", () => {
    const dark: string | undefined = tokenValue(blockAfter("html.dark"));
    expect(dark).toBeDefined();
    expect(dark).not.toBe("#4b5563");
  });

  test("is darker than the muted token it replaced in the light theme", () => {
    const luminance: (hex: string) => number = (hex: string): number => {
      const channels: Array<number> = [1, 3, 5].map(
        (offset: number): number => {
          const value: number = parseInt(hex.slice(offset, offset + 2), 16);
          const unit: number = value / 255;
          return unit <= 0.03928
            ? unit / 12.92
            : Math.pow((unit + 0.055) / 1.055, 2.4);
        },
      );
      return (
        0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
      );
    };
    const muted: RegExpMatchArray | null = blockAfter(":root").match(
      /--ou-text-muted:\s*(#[0-9a-fA-F]{6})\s*;/,
    );

    expect(muted).not.toBeNull();
    expect(luminance("#4b5563")).toBeLessThan(luminance(muted![1]!));
  });
});

describe("CorrelateNodeCard dark-mode colours", () => {
  const variants: Array<
    [string, CorrelationGraphNodeKind, Partial<CorrelateNodeData>]
  > = [
    ["centre", "center", {}],
    [
      "centre (selected, dimmed)",
      "center",
      { isSelected: true, isDimmed: true },
    ],
    ["class with severity", "class", {}],
    ["class without severity", "class", { worstSeverity: undefined }],
    ["selected class", "class", { isSelected: true }],
    ["observable", "observable", {}],
    ["selected observable", "observable", { isSelected: true }],
  ];

  test.each(variants)(
    "the %s card has no literal dark colour in any inline style",
    (
      _name: string,
      kind: CorrelationGraphNodeKind,
      overrides: Partial<CorrelateNodeData>,
    ) => {
      const styles: { root: CSSProperties; all: Array<CSSProperties> } =
        collectStyles(kind, overrides);
      expect(styles.all.length).toBeGreaterThan(0);
      for (const style of styles.all) {
        for (const value of colourValues(style)) {
          for (const hex of DARK_HEXES) {
            // A dark hex is fine only as a var() fallback.
            const bare: string = value.replace(/var\([^()]*\)/g, "");
            expect(bare).not.toContain(hex);
            expect(bare).not.toContain(hexToRgb(hex));
          }
        }
      }
    },
  );

  test.each(variants)(
    "the %s card's text colours are theme tokens (or white on indigo)",
    (
      _name: string,
      kind: CorrelationGraphNodeKind,
      overrides: Partial<CorrelateNodeData>,
    ) => {
      const styles: { root: CSSProperties; all: Array<CSSProperties> } =
        collectStyles(kind, overrides);
      for (const style of styles.all) {
        if (typeof style.color !== "string") {
          continue;
        }
        if (kind === "center" && style === styles.root) {
          expect(style.color).toBe("#ffffff");
          continue;
        }
        expect(style.color.startsWith("var(--ou-")).toBe(true);
      }
    },
  );

  test("rendered DOM carries no dark literal text colour either", () => {
    for (const kind of ALL_KINDS) {
      const root: HTMLElement = renderCard(kind, { isSelected: true });
      const elements: Array<HTMLElement> = [
        root,
        ...Array.from(root.querySelectorAll<HTMLElement>("*")),
      ];
      for (const element of elements) {
        const inline: string = (
          element.getAttribute("style") || ""
        ).toLowerCase();
        for (const hex of DARK_HEXES) {
          expect(inline).not.toContain(hex);
          expect(inline).not.toContain(hexToRgb(hex));
        }
      }
      cleanup();
    }
  });

  test("no card uses a Tailwind neutral colour class", () => {
    for (const kind of ALL_KINDS) {
      const root: HTMLElement = renderCard(kind);
      const elements: Array<Element> = [
        root,
        ...Array.from(root.querySelectorAll("*")),
      ];
      for (const element of elements) {
        const classes: Array<string> = (
          element.getAttribute("class") || ""
        ).split(/\s+/);
        for (const className of classes) {
          expect(className).not.toMatch(
            /^(text|bg|border)-(gray|slate|zinc|neutral|black|white)/,
          );
        }
      }
      cleanup();
    }
  });
});
