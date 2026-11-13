import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";
import type { jsPDF } from "jspdf";
import ResourceCardWidget, {
  RESOURCE_CARD_LOOKS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/Widgets/ResourceCardWidget";
import PdfWidgets, {
  PDF_CUT_MARK,
  PDF_RESOURCE_CARD_LABEL_SHARE,
  PDF_RESOURCE_CARD_LOOKS,
  PDF_RESOURCE_CARD_MAX_LINES,
  PDF_RESOURCE_CARD_SPACING,
  PDF_STAT_VALUE_MAX_LINES,
  PDF_STATUS_DOT,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/Export/PdfWidgets";
import PdfDocument, {
  PAGE_MARGIN,
  PDF_COLORS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/Export/PdfDocument";
import { PdfTable } from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/Export/PdfTable";
import WidgetBuilder from "../../../Server/Utils/AI/Toolbox/WidgetBuilder";
import { getMonitorCardWords } from "../../../Server/Utils/AI/Toolbox/ReadCardWords";
import {
  AI_ACTION_CARD_FACTS,
  AI_ACTION_CARD_KINDS,
  AI_ACTION_CARD_LINES,
  aiActionCardFact,
  aiActionSentence,
  aiActionTerm,
} from "../../../Types/AI/AIActionWords";
import {
  AIChatCitationTargetType,
  AIChatResourceCardOrigin,
  AIChatWidget,
  AIChatWidgetType,
} from "../../../Types/AI/AIChatTypes";
import { Gray500, Red } from "../../../Types/BrandColors";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * A READ'S CARD IS DRAWN PLAIN (issue #6968).
 *
 * Every card a tool left under an answer was drawn as a write's: green,
 * with a check. A monitor looked up while it was Offline - or whose
 * monitoring was off - had a green check beside it, as if something had
 * been done well. A read's card (WidgetBuilder.resourceCard) is drawn
 * plain now, as the other widgets are, with its status's own colour as a
 * dot beside the line that names it; a write's (WidgetBuilder.actionCard)
 * is green with its check, as before; and a card saved before cards said
 * which is drawn as a write's, as it was then. The PDF export draws them
 * the same way.
 */

const MONITOR_ID: string = "40000000-0000-4000-8000-000000000101";

/*
 * A monitor read by id, as query_monitors leaves it: its status the line
 * under its name, or "Disabled" when its monitoring is off.
 */
function monitorCard(params: {
  subheading?: string | undefined;
  statusColor?: string | undefined;
}): AIChatWidget {
  const isMonitoringOff: boolean = params.subheading === "Disabled";

  return {
    ...WidgetBuilder.resourceCard({
      title: "Monitor Checkout API",
      heading: "Checkout API",
      words: getMonitorCardWords({
        monitorType: "Website",
        statusName: isMonitoringOff ? undefined : params.subheading,
        isMonitoringOff,
        isArchived: false,
      }),
      statusColor: params.statusColor,
      link: {
        type: AIChatCitationTargetType.MonitorView,
        params: { monitorId: MONITOR_ID },
      },
    }),
    id: "W1",
  };
}

// An alert a write raised, as create_alert leaves it.
function alertCard(): AIChatWidget {
  return {
    ...WidgetBuilder.actionCard({
      title: "Alert created",
      heading: "ALT-12 · High memory usage on test01",
      words: {
        kind: aiActionTerm(AI_ACTION_CARD_KINDS.alert),
        line: [
          aiActionSentence(AI_ACTION_CARD_LINES.severity, {
            severity: "High",
          }),
        ],
        facts: [
          aiActionCardFact(
            AI_ACTION_CARD_FACTS.description,
            "Memory above 90% for ten minutes.",
          ),
        ],
      },
      link: {
        type: AIChatCitationTargetType.AlertView,
        params: { alertId: "40000000-0000-4000-8000-000000000012" },
      },
    }),
    id: "W2",
  };
}

// A card as a conversation saved before cards said which kind left them.
function savedBeforeOrigins(): AIChatWidget {
  return {
    id: "W3",
    type: AIChatWidgetType.ResourceCard,
    title: "Alert created",
    data: {
      resourceType: "Alert",
      heading: "ALT-12 · High memory usage on test01",
      subheading: "Severity: High",
      fields: [{ label: "State", value: "Created" }],
      link: {
        type: AIChatCitationTargetType.AlertView,
        params: { alertId: "40000000-0000-4000-8000-000000000012" },
      },
    },
  };
}

function cardElement(): HTMLElement {
  return screen.getByTestId("ai-chat-resource-card");
}

// A colour class of the card's: "bg-white", "border-emerald-200", "bg-emerald-50/70".
const COLOUR_CLASS: RegExp =
  /^(?:hover:)?(?:bg|border|text)-(?:white|black|(?:gray|emerald|green|red|amber)-\d{2,3})(?:\/\d+)?$/;

const WHITESPACE: RegExp = /\s+/;

function classesOf(className: string): Array<string> {
  return className.split(WHITESPACE).filter(Boolean);
}

const DE: Record<string, string> = readDashboardLocale("de");
const FA: Record<string, string> = readDashboardLocale("fa");

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      de: { translation: DE },
      fa: { translation: FA },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(() => {
  cleanup();
});

describe("a read's card is drawn plain (#6968)", () => {
  test("an Offline monitor looked up: no green, and no check", () => {
    const { container } = render(
      <ResourceCardWidget
        widget={monitorCard({ subheading: "Offline", statusColor: "#fd625e" })}
      />,
    );

    expect(cardElement()).toHaveAttribute("data-card-origin", "read");
    expect(cardElement().className).toBe(RESOURCE_CARD_LOOKS.read.card);
    expect(
      screen.queryByTestId("ai-chat-resource-card-done"),
    ).not.toBeInTheDocument();
    expect(container.innerHTML).not.toContain("emerald");
    expect(container.innerHTML).not.toContain("green");
    // Everything it says is still there.
    expect(screen.getByTestId("ai-chat-resource-card-kind")).toHaveTextContent(
      "Monitor",
    );
    expect(
      screen.getByTestId("ai-chat-resource-card-heading"),
    ).toHaveTextContent("Checkout API");
    expect(screen.getByTestId("ai-chat-resource-card-line")).toHaveTextContent(
      "Offline",
    );
    expect(
      screen.getByTestId("ai-chat-resource-card-fact-value"),
    ).toHaveTextContent("Website");
  });

  test("one whose monitoring is off: Disabled, plain too", () => {
    render(
      <ResourceCardWidget
        widget={monitorCard({
          subheading: "Disabled",
          statusColor: Gray500.toString(),
        })}
      />,
    );

    expect(cardElement()).toHaveAttribute("data-card-origin", "read");
    expect(
      screen.queryByTestId("ai-chat-resource-card-done"),
    ).not.toBeInTheDocument();
  });

  test("a read with nothing wrong is plain as well: the look says who left it, not how it went", () => {
    render(
      <ResourceCardWidget
        widget={monitorCard({
          subheading: "Operational",
          statusColor: "#2ab57d",
        })}
      />,
    );

    expect(cardElement().className).toBe(RESOURCE_CARD_LOOKS.read.card);
    expect(
      screen.queryByTestId("ai-chat-resource-card-done"),
    ).not.toBeInTheDocument();
  });

  test("its kind and its Open are in the card's grays", () => {
    render(
      <ResourceCardWidget widget={monitorCard({ subheading: "Offline" })} />,
    );

    const kind: HTMLElement = screen.getByTestId("ai-chat-resource-card-kind");
    for (const name of classesOf(RESOURCE_CARD_LOOKS.read.kind)) {
      expect(kind).toHaveClass(name);
    }

    const open: HTMLElement = screen.getByTestId("ai-chat-resource-card-open");
    for (const name of classesOf(RESOURCE_CARD_LOOKS.read.open)) {
      expect(open).toHaveClass(name);
    }
    expect(open).toHaveAccessibleName("Open Checkout API");
  });

  test("the two looks differ in their colours only: the same corners, edge and room", () => {
    for (const part of ["card", "kind", "open"] as const) {
      const shapeOf: (className: string) => Array<string> = (
        className: string,
      ): Array<string> => {
        return classesOf(className)
          .filter((name: string): boolean => {
            return !COLOUR_CLASS.test(name);
          })
          .sort();
      };

      expect(shapeOf(RESOURCE_CARD_LOOKS.read[part])).toEqual(
        shapeOf(RESOURCE_CARD_LOOKS.write[part]),
      );
    }

    expect(classesOf(RESOURCE_CARD_LOOKS.read.card)).toEqual(
      expect.arrayContaining(["rounded-xl", "border", "p-3.5", "bg-white"]),
    );
  });

  test("a read's look has no green in it; a write's is all green", () => {
    for (const name of Object.values(RESOURCE_CARD_LOOKS.read).flatMap(
      classesOf,
    )) {
      expect(name).not.toContain("emerald");
    }

    for (const part of Object.values(RESOURCE_CARD_LOOKS.write)) {
      expect(
        classesOf(part).filter((name: string): boolean => {
          return COLOUR_CLASS.test(name);
        }),
      ).toEqual(
        classesOf(part).filter((name: string): boolean => {
          return COLOUR_CLASS.test(name) && name.includes("emerald");
        }),
      );
    }
  });
});

describe("a write's card is still drawn as done", () => {
  test("green, with its check", () => {
    render(<ResourceCardWidget widget={alertCard()} />);

    expect(cardElement()).toHaveAttribute("data-card-origin", "write");
    expect(cardElement().className).toBe(RESOURCE_CARD_LOOKS.write.card);

    const done: HTMLElement = screen.getByTestId("ai-chat-resource-card-done");
    expect(done).toHaveClass("bg-emerald-500");
    expect(done.querySelector("svg")).not.toBeNull();

    const kind: HTMLElement = screen.getByTestId("ai-chat-resource-card-kind");
    expect(kind).toHaveClass("text-emerald-600");
    expect(kind).toHaveTextContent("Alert");
  });

  test("the write's look is the card's look before this change: the same classes", () => {
    expect(RESOURCE_CARD_LOOKS.write).toEqual({
      card: "rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5",
      kind: "text-emerald-600",
      open: "text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800",
    });
  });

  test("a card saved before cards said which looks as it did: green, with its check", () => {
    render(<ResourceCardWidget widget={savedBeforeOrigins()} />);

    expect(cardElement()).toHaveAttribute("data-card-origin", "write");
    expect(cardElement().className).toBe(RESOURCE_CARD_LOOKS.write.card);
    expect(
      screen.getByTestId("ai-chat-resource-card-done"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("ai-chat-resource-card-status-dot"),
    ).not.toBeInTheDocument();
  });

  test("an origin the Dashboard does not know is drawn as before, as a write's", () => {
    const widget: AIChatWidget = savedBeforeOrigins();
    widget.data.origin = "Imported" as AIChatResourceCardOrigin;

    render(<ResourceCardWidget widget={widget} />);

    expect(cardElement()).toHaveAttribute("data-card-origin", "write");
    expect(
      screen.getByTestId("ai-chat-resource-card-done"),
    ).toBeInTheDocument();
  });
});

describe("the status's own colour, beside the line that names it", () => {
  test("a dot in that colour before the line's words, for the eye only", () => {
    render(
      <ResourceCardWidget
        widget={monitorCard({ subheading: "Offline", statusColor: "#fd625e" })}
      />,
    );

    const line: HTMLElement = screen.getByTestId("ai-chat-resource-card-line");
    const dot: HTMLElement = within(line).getByTestId(
      "ai-chat-resource-card-status-dot",
    );

    expect(line.firstElementChild).toBe(dot);
    expect(dot).toHaveAttribute("aria-hidden", "true");
    expect(dot.textContent).toBe("");
    expect(dot.style.backgroundColor).toBe("rgb(253, 98, 94)");
    for (const name of ["inline-block", "h-2", "w-2", "rounded-full"]) {
      expect(dot).toHaveClass(name);
    }
    // The words say the status; the dot adds nothing to them.
    expect(line.textContent).toBe("Offline");
  });

  test("its gap is on the side the line reads on: me-, never mr- or ml-", () => {
    render(
      <div dir="rtl">
        <ResourceCardWidget
          widget={monitorCard({
            subheading: "Offline",
            statusColor: Red.toString(),
          })}
        />
      </div>,
    );

    const dot: HTMLElement = screen.getByTestId(
      "ai-chat-resource-card-status-dot",
    );
    expect(dot).toHaveClass("me-1.5");
    expect(
      classesOf(dot.className).filter((name: string): boolean => {
        return name.startsWith("mr-") || name.startsWith("ml-");
      }),
    ).toEqual([]);
  });

  test("monitoring off: the dot is gray", () => {
    render(
      <ResourceCardWidget
        widget={monitorCard({
          subheading: "Disabled",
          statusColor: Gray500.toString(),
        })}
      />,
    );

    expect(
      screen.getByTestId("ai-chat-resource-card-status-dot").style
        .backgroundColor,
    ).toBe("rgb(107, 114, 128)");
  });

  test("no colour, no dot", () => {
    render(
      <ResourceCardWidget widget={monitorCard({ subheading: "Offline" })} />,
    );

    expect(
      screen.queryByTestId("ai-chat-resource-card-status-dot"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("ai-chat-resource-card-line")).toHaveTextContent(
      "Offline",
    );
  });

  test("a stored colour that is not one draws no dot: a saved card is read as untrusted", () => {
    for (const statusColor of [
      "red; background-image: url(https://example.com/x.png)",
      "url(https://example.com/x.png)",
      "#fd625e; position: fixed",
      "var(--ou-text)",
    ]) {
      const widget: AIChatWidget = monitorCard({ subheading: "Offline" });
      // As a stored card might say it, past the server's own check.
      widget.data.statusColor = statusColor;

      const { unmount } = render(<ResourceCardWidget widget={widget} />);

      expect(
        screen.queryByTestId("ai-chat-resource-card-status-dot"),
      ).not.toBeInTheDocument();
      unmount();
    }
  });

  test("no line, no dot: the colour belongs to the status the line names", () => {
    const widget: AIChatWidget = monitorCard({});
    widget.data.statusColor = "#fd625e";

    render(<ResourceCardWidget widget={widget} />);

    expect(
      screen.queryByTestId("ai-chat-resource-card-line"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("ai-chat-resource-card-status-dot"),
    ).not.toBeInTheDocument();
  });

  test("a write's card has none: its line says what was done", () => {
    render(<ResourceCardWidget widget={alertCard()} />);

    expect(
      screen.queryByTestId("ai-chat-resource-card-status-dot"),
    ).not.toBeInTheDocument();
  });
});

// The stand-in's text width: every character 4pt, whatever the font.
const CHAR_WIDTH: number = 4;

/*
 * Lines as jsPDF's splitTextToSize wraps them: word by word to the width,
 * a word wider than the line broken where it must be.
 */
function wrapWords(text: string, maxWidth: number): Array<string> {
  const perLine: number = Math.max(1, Math.floor(maxWidth / CHAR_WIDTH));
  const lines: Array<string> = [];
  let current: string = "";

  for (const word of text.split(" ")) {
    let rest: string = word;

    while (rest.length > perLine) {
      if (current) {
        lines.push(current);
        current = "";
      }
      lines.push(rest.slice(0, perLine));
      rest = rest.slice(perLine);
    }

    const candidate: string = current ? `${current} ${rest}` : rest;

    if (candidate.length <= perLine) {
      current = candidate;
    } else {
      lines.push(current);
      current = rest;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

/*
 * The PDF export draws each card as the chat does: on a jsPDF stand-in
 * that records what was drawn, in which colours.
 */
describe("in the PDF export", () => {
  interface DrawCall {
    method: string;
    args: Array<unknown>;
  }

  function drawn(
    widget: AIChatWidget,
    options?: {
      // Wrap as jsPDF does, word by word, at the stand-in's widths.
      isWrapping?: boolean | undefined;
      // Where on the page the widget starts.
      startY?: number | undefined;
    },
  ): Array<DrawCall> {
    const calls: Array<DrawCall> = [];
    const record: (method: string) => (...args: Array<unknown>) => void = (
      method: string,
    ): ((...args: Array<unknown>) => void) => {
      return (...args: Array<unknown>): void => {
        calls.push({ method, args });
      };
    };

    // Only what the card's drawing calls, each recorded: no PDF is made.
    const doc: jsPDF = {
      internal: {
        pageSize: {
          getWidth: (): number => {
            return 595.28;
          },
          getHeight: (): number => {
            return 841.89;
          },
        },
      },
      getCurrentPageInfo: (): { pageNumber: number } => {
        return { pageNumber: 1 };
      },
      splitTextToSize: (text: string, maxWidth: number): Array<string> => {
        return options?.isWrapping ? wrapWords(text, maxWidth) : [text];
      },
      getTextWidth: (text: string): number => {
        return text.length * CHAR_WIDTH;
      },
      setFont: record("setFont"),
      setFontSize: record("setFontSize"),
      setTextColor: record("setTextColor"),
      setFillColor: record("setFillColor"),
      setDrawColor: record("setDrawColor"),
      setLineWidth: record("setLineWidth"),
      roundedRect: record("roundedRect"),
      rect: record("rect"),
      line: record("line"),
      circle: record("circle"),
      text: record("text"),
      addPage: record("addPage"),
    } as unknown as jsPDF;

    const pdf: PdfDocument = new PdfDocument(doc);
    if (options?.startY !== undefined) {
      pdf.y = options.startY;
    }

    new PdfWidgets(pdf, {} as unknown as PdfTable).draw(widget);

    return calls;
  }

  // The last colour a setter was given before a call.
  function lastBefore(
    calls: Array<DrawCall>,
    index: number,
    setter: string,
  ): unknown {
    for (let at: number = index - 1; at >= 0; at--) {
      if (calls[at]!.method === setter) {
        return calls[at]!.args[0];
      }
    }
    return undefined;
  }

  function lookOf(widget: AIChatWidget): {
    fill: unknown;
    stroke: unknown;
    kind: unknown;
  } {
    const calls: Array<DrawCall> = drawn(widget);
    const surface: number = calls.findIndex((call: DrawCall): boolean => {
      return call.method === "roundedRect";
    });
    const kind: number = calls.findIndex((call: DrawCall): boolean => {
      return (
        call.method === "text" &&
        call.args[0] === (widget.data.resourceType || "").toUpperCase()
      );
    });

    expect(surface).toBeGreaterThan(-1);
    expect(kind).toBeGreaterThan(surface);

    return {
      fill: lastBefore(calls, surface, "setFillColor"),
      stroke: lastBefore(calls, surface, "setDrawColor"),
      kind: lastBefore(calls, kind, "setTextColor"),
    };
  }

  test("a read's card in the export's grays", () => {
    expect(lookOf(monitorCard({ subheading: "Offline" }))).toEqual({
      fill: PDF_COLORS.surface,
      stroke: PDF_COLORS.border,
      kind: PDF_COLORS.muted,
    });
    expect(PDF_RESOURCE_CARD_LOOKS.read).toEqual({
      fill: "#f9fafb",
      stroke: "#e5e7eb",
      kind: "#6b7280",
    });
  });

  test("a read's card draws no green anywhere", () => {
    const greens: Array<string> = Object.values(PDF_RESOURCE_CARD_LOOKS.write);

    for (const call of drawn(monitorCard({ subheading: "Offline" }))) {
      for (const argument of call.args) {
        expect(greens).not.toContain(argument);
      }
    }
  });

  test("a write's card in the green the chat draws it in", () => {
    expect(lookOf(alertCard())).toEqual({
      fill: "#ecfdf5",
      stroke: "#a7f3d0",
      kind: "#059669",
    });
    expect(PDF_RESOURCE_CARD_LOOKS.write).toEqual({
      fill: "#ecfdf5",
      stroke: "#a7f3d0",
      kind: "#059669",
    });
  });

  test("a card saved before cards said which is green, as it was", () => {
    expect(lookOf(savedBeforeOrigins())).toEqual(lookOf(alertCard()));
  });

  /*
   * The status the line names, in its own colour, a dot before it, as the
   * chat draws it: the export said "Offline" in the card's gray alone.
   */
  interface PdfStatusLine {
    // The dot, when one is drawn: its colour, its middle and its radius.
    dot: { color: unknown; x: number; y: number; radius: number } | null;
    // Where the line's words start, and where the kind's do: the card's edge.
    lineX: number;
    lineY: number;
    kindX: number;
  }

  function statusLineOf(widget: AIChatWidget): PdfStatusLine {
    const calls: Array<DrawCall> = drawn(widget);
    const textAt: (text: string | undefined) => DrawCall = (
      text: string | undefined,
    ): DrawCall => {
      const call: DrawCall | undefined = calls.find(
        (candidate: DrawCall): boolean => {
          return candidate.method === "text" && candidate.args[0] === text;
        },
      );
      expect(call).toBeDefined();
      return call!;
    };
    const line: DrawCall = textAt(widget.data.subheading);
    const kind: DrawCall = textAt(
      (widget.data.resourceType || "").toUpperCase(),
    );
    const dots: Array<number> = calls
      .map((call: DrawCall, index: number): number => {
        return call.method === "circle" ? index : -1;
      })
      .filter((index: number): boolean => {
        return index > -1;
      });

    // One dot at most: the status's.
    expect(dots.length).toBeLessThanOrEqual(1);

    return {
      dot:
        dots.length === 1
          ? {
              color: lastBefore(calls, dots[0]!, "setFillColor"),
              x: calls[dots[0]!]!.args[0] as number,
              y: calls[dots[0]!]!.args[1] as number,
              radius: calls[dots[0]!]!.args[2] as number,
            }
          : null,
      lineX: line.args[1] as number,
      lineY: line.args[2] as number,
      kindX: kind.args[1] as number,
    };
  }

  test("a read's status in its own colour: a dot before the line's words, level with them", () => {
    const drawnLine: PdfStatusLine = statusLineOf(
      monitorCard({ subheading: "Offline", statusColor: "#fd625e" }),
    );

    expect(drawnLine.dot).not.toBeNull();
    expect(drawnLine.dot!.color).toBe("#fd625e");
    expect(drawnLine.dot!.radius).toBe(PDF_STATUS_DOT.radius);
    // At the card's edge, where the kind starts; the words after it, a gap between.
    expect(drawnLine.dot!.x - drawnLine.dot!.radius).toBe(drawnLine.kindX);
    expect(drawnLine.lineX).toBe(drawnLine.kindX + PDF_STATUS_DOT.indent);
    expect(drawnLine.dot!.x + drawnLine.dot!.radius).toBeLessThan(
      drawnLine.lineX,
    );
    // Level with the line's words: its middle half a line below their top.
    expect(drawnLine.dot!.y).toBeGreaterThan(drawnLine.lineY);
    expect(drawnLine.dot!.y).toBeLessThan(drawnLine.lineY + 11);
  });

  test("monitoring off: the dot is gray, as the chat draws it", () => {
    expect(
      statusLineOf(
        monitorCard({
          subheading: "Disabled",
          statusColor: Gray500.toString(),
        }),
      ).dot!.color,
    ).toBe("#6b7280");
  });

  test("no colour, a stored one that is not one, or a write's card: no dot, and the line at the card's edge", () => {
    const untrusted: AIChatWidget = monitorCard({ subheading: "Offline" });
    // As a stored card might say it, past the server's own check.
    untrusted.data.statusColor = "red; background: url(https://example.com)";

    for (const widget of [
      monitorCard({ subheading: "Offline" }),
      untrusted,
      alertCard(),
      savedBeforeOrigins(),
    ]) {
      const drawnLine: PdfStatusLine = statusLineOf(widget);
      expect(drawnLine.dot).toBeNull();
      expect(drawnLine.lineX).toBe(drawnLine.kindX);
    }
  });

  test("no line, no dot: the colour belongs to the status the line names", () => {
    const widget: AIChatWidget = monitorCard({});
    widget.data.statusColor = "#fd625e";

    expect(
      drawn(widget).some((call: DrawCall): boolean => {
        return call.method === "circle";
      }),
    ).toBe(false);
  });

  /*
   * ISSUE #7202: THE PDF CARD DRAWS ALL OF ITS TEXT.
   *
   * The card drew the first line of its name, of its status line and of
   * each fact's value, and left the rest out with nothing to say so. With
   * a stand-in that wraps as jsPDF does, every line is drawn now, measured
   * before the card is painted; a part longer than its most lines ends
   * with "..."; and a card that does not fit moves to the next page whole.
   */
  describe("every line of the card (#7202)", () => {
    const SPACING: typeof PDF_RESOURCE_CARD_SPACING = PDF_RESOURCE_CARD_SPACING;
    const CONTENT_WIDTH: number = 595.28 - PAGE_MARGIN.left - PAGE_MARGIN.right;
    const INNER_WIDTH: number = CONTENT_WIDTH - SPACING.padding * 2;
    const CARD_X: number = PAGE_MARGIN.left + SPACING.padding;
    const BOTTOM_LIMIT: number = 841.89 - PAGE_MARGIN.bottom;
    // What a page holds of a read's card: it has no title over it.
    const CARD_ROOM: number = BOTTOM_LIMIT - PAGE_MARGIN.top - SPACING.after;

    // A read's card as a conversation stores it: the English the export prints.
    function storedCard(data: {
      heading: string;
      subheading?: string | undefined;
      statusColor?: string | undefined;
      fields?: Array<{ label: string; value: string }> | undefined;
    }): AIChatWidget {
      return {
        id: "W9",
        type: AIChatWidgetType.ResourceCard,
        title: "Monitor Checkout API",
        data: {
          resourceType: "Monitor",
          heading: data.heading,
          subheading: data.subheading,
          fields: data.fields || [],
          origin: AIChatResourceCardOrigin.Read,
          ...(data.statusColor ? { statusColor: data.statusColor } : {}),
        },
      };
    }

    // Words each part's lines are told apart by: "head0 head1 head2 ...".
    function wordsOf(prefix: string, count: number): string {
      return Array.from({ length: count }, (_: unknown, index: number) => {
        return `${prefix}${index}`;
      }).join(" ");
    }

    function textsOf(calls: Array<DrawCall>, prefix: string): Array<DrawCall> {
      return calls.filter((call: DrawCall): boolean => {
        return (
          call.method === "text" && String(call.args[0]).startsWith(prefix)
        );
      });
    }

    function linesOf(calls: Array<DrawCall>, prefix: string): Array<string> {
      return textsOf(calls, prefix).map((call: DrawCall): string => {
        return String(call.args[0]);
      });
    }

    function indexOf(calls: Array<DrawCall>, method: string): number {
      return calls.findIndex((call: DrawCall): boolean => {
        return call.method === method;
      });
    }

    function cardRect(calls: Array<DrawCall>): {
      index: number;
      y: number;
      height: number;
    } {
      const index: number = indexOf(calls, "roundedRect");
      expect(index).toBeGreaterThan(-1);
      return {
        index,
        y: calls[index]!.args[1] as number,
        height: calls[index]!.args[3] as number,
      };
    }

    // A part cut short: the words it kept, in order, then "...".
    function expectCut(lines: Array<string>, whole: string): void {
      const last: string = lines[lines.length - 1]!;

      expect(last.endsWith(PDF_CUT_MARK)).toBe(true);
      expect(last.length * CHAR_WIDTH).toBeLessThanOrEqual(INNER_WIDTH);

      const kept: string = lines
        .join(" ")
        .slice(0, -PDF_CUT_MARK.length)
        .trimEnd();
      expect(kept.length).toBeGreaterThan(0);
      expect(whole.startsWith(kept)).toBe(true);
      expect(kept.length).toBeLessThan(whole.length);
    }

    const LONG: {
      heading: string;
      status: string;
      value: string;
    } = {
      heading: wordsOf("head", 30),
      status: wordsOf("stat", 30),
      value: wordsOf("val", 60),
    };

    function longCard(): AIChatWidget {
      return storedCard({
        heading: LONG.heading,
        subheading: LONG.status,
        statusColor: "#fd625e",
        fields: [
          { label: "Description", value: LONG.value },
          { label: "Type", value: "Website" },
        ],
      });
    }

    test("the stand-in wraps as jsPDF does: these parts take more than one line", () => {
      expect(wrapWords(LONG.heading, INNER_WIDTH).length).toBe(2);
      expect(
        wrapWords(LONG.status, INNER_WIDTH - PDF_STATUS_DOT.indent).length,
      ).toBe(2);
      expect(wrapWords(LONG.value, INNER_WIDTH - 70).length).toBe(4);
      expect(wrapWords("a b", 100)).toEqual(["a b"]);
      expect(wrapWords("abcdefghij", 16)).toEqual(["abcd", "efgh", "ij"]);
    });

    test("every line of the name, the status line and each value is drawn, none left out", () => {
      const calls: Array<DrawCall> = drawn(longCard(), { isWrapping: true });

      expect(linesOf(calls, "head").join(" ")).toBe(LONG.heading);
      expect(linesOf(calls, "stat").join(" ")).toBe(LONG.status);
      expect(linesOf(calls, "val").join(" ")).toBe(LONG.value);
      expect(linesOf(calls, "head").length).toBe(2);
      expect(linesOf(calls, "stat").length).toBe(2);
      expect(linesOf(calls, "val").length).toBe(4);

      // Nothing whole is marked cut.
      for (const call of calls) {
        if (call.method === "text") {
          expect(String(call.args[0]).endsWith(PDF_CUT_MARK)).toBe(false);
        }
      }

      // And the fact after the long one is drawn under it.
      const value: Array<DrawCall> = textsOf(calls, "val");
      const type: DrawCall = textsOf(calls, "Website")[0]!;
      expect(type.args[2] as number).toBeGreaterThan(
        value[value.length - 1]!.args[2] as number,
      );
    });

    test("each line under the one before it, a line's height apart", () => {
      const calls: Array<DrawCall> = drawn(longCard(), { isWrapping: true });
      const yOf: (prefix: string) => Array<number> = (
        prefix: string,
      ): Array<number> => {
        return textsOf(calls, prefix).map((call: DrawCall): number => {
          return call.args[2] as number;
        });
      };

      const heading: Array<number> = yOf("head");
      expect(heading[1]! - heading[0]!).toBe(SPACING.heading);

      const status: Array<number> = yOf("stat");
      expect(status[0]! - heading[1]!).toBe(SPACING.heading);
      expect(status[1]! - status[0]!).toBe(SPACING.line);

      // The facts a gap under the name and line, as the chat's are.
      const value: Array<number> = yOf("val");
      expect(SPACING.factsGap).toBeGreaterThan(0);
      expect(value[0]! - status[1]!).toBe(SPACING.line + SPACING.factsGap);
      for (let index: number = 1; index < value.length; index++) {
        expect(value[index]! - value[index - 1]!).toBe(SPACING.factExtraLine);
      }

      // The value's lines start where its first does; its name at the card's edge.
      const valueX: Array<number> = textsOf(calls, "val").map(
        (call: DrawCall): number => {
          return call.args[1] as number;
        },
      );
      expect(new Set(valueX).size).toBe(1);
      expect(valueX[0]).toBe(CARD_X + 70);
      expect(textsOf(calls, "Description")[0]!.args[1]).toBe(CARD_X);
    });

    test("the dot stays on the status line's first line; the lines after it keep its indent", () => {
      const calls: Array<DrawCall> = drawn(longCard(), { isWrapping: true });
      const status: Array<DrawCall> = textsOf(calls, "stat");
      const circles: Array<DrawCall> = calls.filter((call: DrawCall) => {
        return call.method === "circle";
      });

      expect(circles.length).toBe(1);
      const dotY: number = circles[0]!.args[1] as number;
      expect(dotY).toBeGreaterThan(status[0]!.args[2] as number);
      expect(dotY).toBeLessThan((status[0]!.args[2] as number) + SPACING.line);
      expect(dotY).toBeLessThan(status[1]!.args[2] as number);

      for (const line of status) {
        expect(line.args[1]).toBe(CARD_X + PDF_STATUS_DOT.indent);
      }
      // Wrapped to the width the dot leaves it.
      for (const line of linesOf(calls, "stat")) {
        expect(line.length * CHAR_WIDTH).toBeLessThanOrEqual(
          INNER_WIDTH - PDF_STATUS_DOT.indent,
        );
      }
    });

    test("no dot: the status line's lines at the card's edge, over its whole width", () => {
      const widget: AIChatWidget = longCard();
      delete widget.data.statusColor;

      const calls: Array<DrawCall> = drawn(widget, { isWrapping: true });

      for (const line of textsOf(calls, "stat")) {
        expect(line.args[1]).toBe(CARD_X);
      }
      expect(linesOf(calls, "stat").join(" ")).toBe(LONG.status);
    });

    test("measured before it is painted: the surface is as tall as every line it holds", () => {
      const calls: Array<DrawCall> = drawn(longCard(), { isWrapping: true });
      const rect: { index: number; y: number; height: number } =
        cardRect(calls);

      const valueLines: number = linesOf(calls, "val").length;
      expect(rect.height).toBe(
        SPACING.padding * 2 +
          SPACING.kind +
          2 * SPACING.heading +
          2 * SPACING.line +
          SPACING.factsGap +
          (SPACING.fact + (valueLines - 1) * SPACING.factExtraLine) +
          SPACING.fact,
      );

      // Painted before any of its words, so they sit on it.
      const kind: number = calls.findIndex((call: DrawCall): boolean => {
        return call.method === "text" && call.args[0] === "MONITOR";
      });
      expect(rect.index).toBeLessThan(kind);

      // Every word inside it: none drawn past its bottom edge.
      for (const call of calls.slice(rect.index + 1)) {
        if (call.method !== "text") {
          continue;
        }
        const y: number = call.args[2] as number;
        expect(y).toBeGreaterThanOrEqual(rect.y + SPACING.padding);
        expect(y + SPACING.fact).toBeLessThanOrEqual(
          rect.y + rect.height - SPACING.padding + 0.001,
        );
      }
    });

    test("a part longer than its most lines ends with ...: the name 3, the status 4, a value 8, a name 3", () => {
      const heading: string = wordsOf("head", 120);
      const status: string = wordsOf("stat", 160);
      const value: string = wordsOf("val", 320);
      const label: string = wordsOf("lab", 60);

      const calls: Array<DrawCall> = drawn(
        storedCard({
          heading,
          subheading: status,
          statusColor: "#fd625e",
          fields: [{ label, value }],
        }),
        { isWrapping: true },
      );

      expect(linesOf(calls, "head").length).toBe(
        PDF_RESOURCE_CARD_MAX_LINES.heading,
      );
      expect(linesOf(calls, "stat").length).toBe(
        PDF_RESOURCE_CARD_MAX_LINES.line,
      );
      expect(linesOf(calls, "val").length).toBe(
        PDF_RESOURCE_CARD_MAX_LINES.value,
      );
      expect(linesOf(calls, "lab").length).toBe(
        PDF_RESOURCE_CARD_MAX_LINES.label,
      );

      expectCut(linesOf(calls, "head"), heading);
      expectCut(linesOf(calls, "stat"), status);
      expectCut(linesOf(calls, "val"), value);
      expectCut(linesOf(calls, "lab"), label);

      // Only the last line of each is cut.
      for (const prefix of ["head", "stat", "val", "lab"]) {
        const lines: Array<string> = linesOf(calls, prefix);
        for (const line of lines.slice(0, -1)) {
          expect(line.endsWith(PDF_CUT_MARK)).toBe(false);
        }
      }
    });

    test("a long name wraps within its share of the card; its value starts after that share", () => {
      const label: string = wordsOf("lab", 20);
      const calls: Array<DrawCall> = drawn(
        storedCard({
          heading: "Checkout API",
          fields: [{ label, value: wordsOf("val", 10) }],
        }),
        { isWrapping: true },
      );
      const share: number = INNER_WIDTH * PDF_RESOURCE_CARD_LABEL_SHARE;

      expect(linesOf(calls, "lab").length).toBeGreaterThan(1);
      expect(linesOf(calls, "lab").join(" ")).toBe(label);
      for (const line of linesOf(calls, "lab")) {
        expect(line.length * CHAR_WIDTH).toBeLessThanOrEqual(share - 8);
      }
      for (const call of textsOf(calls, "val")) {
        expect(call.args[1]).toBe(CARD_X + share);
      }
      // The value starts on the name's first line.
      expect(textsOf(calls, "val")[0]!.args[2]).toBe(
        textsOf(calls, "lab")[0]!.args[2],
      );
    });

    function pageBreaksOf(calls: Array<DrawCall>): Array<number> {
      return calls
        .map((call: DrawCall, index: number): number => {
          return call.method === "addPage" ? index : -1;
        })
        .filter((index: number): boolean => {
          return index > -1;
        });
    }

    function textIndex(calls: Array<DrawCall>, text: string): number {
      return calls.findIndex((call: DrawCall): boolean => {
        return call.method === "text" && call.args[0] === text;
      });
    }

    test("a card that does not fit moves to the next page whole", () => {
      const calls: Array<DrawCall> = drawn(longCard(), {
        isWrapping: true,
        startY: BOTTOM_LIMIT - 100,
      });
      const pageBreaks: Array<number> = pageBreaksOf(calls);
      const rect: { index: number; y: number; height: number } =
        cardRect(calls);

      expect(pageBreaks.length).toBe(1);
      expect(pageBreaks[0]).toBeLessThan(rect.index);
      expect(pageBreaks[0]).toBeLessThan(textIndex(calls, "MONITOR"));
      // At the new page's top: the room before a card is not carried over.
      expect(rect.y).toBe(PAGE_MARGIN.top);
      expect(rect.y + rect.height).toBeLessThanOrEqual(BOTTOM_LIMIT);
      // Every line on the new page, after the break.
      expect(linesOf(calls, "val").join(" ")).toBe(LONG.value);
    });

    test("a write's card that does not fit moves to the next page whole, its title with it", () => {
      const widget: AIChatWidget = longCard();
      widget.title = "Alert created";
      widget.data.origin = AIChatResourceCardOrigin.Write;

      const calls: Array<DrawCall> = drawn(widget, {
        isWrapping: true,
        startY: BOTTOM_LIMIT - 100,
      });
      const pageBreaks: Array<number> = pageBreaksOf(calls);
      const title: number = textIndex(calls, "Alert created");
      const rect: { index: number; y: number; height: number } =
        cardRect(calls);

      expect(pageBreaks.length).toBe(1);
      expect(title).toBeGreaterThan(-1);
      expect(pageBreaks[0]).toBeLessThan(title);
      expect(rect.y).toBeGreaterThan(PAGE_MARGIN.top);
      expect(rect.y + rect.height).toBeLessThanOrEqual(BOTTOM_LIMIT);
      expect(linesOf(calls, "val").join(" ")).toBe(LONG.value);
    });

    /*
     * A read's card has no title over it: its kind and name say what it
     * is, as in the chat. The PDF said "Monitor Checkout API" over it,
     * then "MONITOR" and "Checkout API" inside it. A write's card keeps
     * its title - "Alert created" says what was done - and so does one
     * saved before cards said which.
     */
    test("a read's card has no title over it; a write's keeps its own", () => {
      const read: Array<DrawCall> = drawn(
        monitorCard({ subheading: "Offline" }),
      );
      expect(textIndex(read, "Monitor Checkout API")).toBe(-1);
      expect(textIndex(read, "MONITOR")).toBeGreaterThan(-1);
      expect(textIndex(read, "Checkout API")).toBeGreaterThan(-1);
      // Its surface a little under where the last widget ended.
      expect(cardRect(read).y).toBe(PAGE_MARGIN.top + SPACING.before);

      for (const widget of [alertCard(), savedBeforeOrigins()]) {
        const calls: Array<DrawCall> = drawn(widget);
        const title: number = textIndex(calls, "Alert created");
        expect(title).toBeGreaterThan(-1);
        expect(title).toBeLessThan(cardRect(calls).index);
      }
    });

    /*
     * Every value of a card starts at one place, as the chat's grid lines
     * them up: the names are one column, as wide as the widest of them.
     * One long name ("Error budget policy tier") moved its own value to the
     * right of the others.
     */
    test("every value starts at one place: the names one column, as wide as the widest", () => {
      const calls: Array<DrawCall> = drawn(
        storedCard({
          heading: "Checkout availability",
          fields: [
            { label: "Target", value: "tgt 99.9%" },
            { label: "Error budget policy", value: "pol Freeze risky deploys" },
            { label: "Window", value: "win Rolling 30-day window" },
          ],
        }),
        { isWrapping: true },
      );
      const valueX: Array<number> = ["tgt", "pol", "win"].map(
        (prefix: string): number => {
          return textsOf(calls, prefix)[0]!.args[1] as number;
        },
      );

      expect(new Set(valueX).size).toBe(1);
      // The widest name and its gap: past the 70pt the short ones need.
      expect(valueX[0]).toBe(
        CARD_X + "Error budget policy".length * CHAR_WIDTH + 8,
      );
      expect(valueX[0]).toBeGreaterThan(CARD_X + 70);
      // Each name whole, on one line.
      expect(linesOf(calls, "Error budget")).toEqual(["Error budget policy"]);
    });

    test("short names keep the 70pt column; no facts, no gap under the name", () => {
      const short: Array<DrawCall> = drawn(
        storedCard({
          heading: "Checkout API",
          fields: [{ label: "Type", value: "val Website" }],
        }),
      );
      expect(textsOf(short, "val")[0]!.args[1]).toBe(CARD_X + 70);

      const bare: Array<DrawCall> = drawn(
        storedCard({ heading: "Checkout API", subheading: "Online" }),
      );
      expect(cardRect(bare).height).toBe(
        SPACING.padding * 2 + SPACING.kind + SPACING.heading + SPACING.line,
      );
    });

    test("a card that fits is drawn where it is, with no page break", () => {
      const calls: Array<DrawCall> = drawn(longCard(), { isWrapping: true });

      expect(indexOf(calls, "addPage")).toBe(-1);
      expect(cardRect(calls).y).toBeLessThan(PAGE_MARGIN.top + 60);
    });

    test("a card taller than a page draws its values in fewer lines, every fact still there, on one page", () => {
      const fields: Array<{ label: string; value: string }> = Array.from(
        { length: 12 },
        (_: unknown, index: number) => {
          return {
            label: `Rule ${index + 1}`,
            value: wordsOf(`f${index + 1}w`, 150),
          };
        },
      );
      const calls: Array<DrawCall> = drawn(
        storedCard({ heading: "Checkout API", fields }),
        { isWrapping: true, startY: BOTTOM_LIMIT - 100 },
      );
      const rect: { index: number; y: number; height: number } =
        cardRect(calls);

      // At eight lines a value, it would be taller than the page.
      expect(
        SPACING.padding * 2 +
          SPACING.kind +
          SPACING.heading +
          12 *
            (SPACING.fact +
              (PDF_RESOURCE_CARD_MAX_LINES.value - 1) * SPACING.factExtraLine),
      ).toBeGreaterThan(CARD_ROOM);

      expect(rect.height).toBeLessThanOrEqual(CARD_ROOM);
      expect(rect.y + rect.height).toBeLessThanOrEqual(BOTTOM_LIMIT);
      expect(
        calls.filter((call: DrawCall): boolean => {
          return call.method === "addPage";
        }).length,
      ).toBe(1);

      const counts: Array<number> = fields.map(
        (_: unknown, index: number): number => {
          return linesOf(calls, `f${index + 1}w`).length;
        },
      );
      // Each in the same, fewer lines - as many as fit - cut with "...".
      expect(new Set(counts).size).toBe(1);
      expect(counts[0]).toBeLessThan(PDF_RESOURCE_CARD_MAX_LINES.value);
      expect(counts[0]).toBe(5);
      for (const [index, field] of fields.entries()) {
        expectCut(linesOf(calls, `f${index + 1}w`), field.value);
        expect(textsOf(calls, field.label).length).toBeGreaterThan(0);
      }
    });

    test("a card with more facts than a page holds, even a line each, keeps the first that fit, on one page", () => {
      const fields: Array<{ label: string; value: string }> = Array.from(
        { length: 80 },
        (_: unknown, index: number) => {
          return { label: `Fact${index + 1}`, value: `value${index + 1}` };
        },
      );
      const calls: Array<DrawCall> = drawn(
        storedCard({ heading: "Checkout API", fields }),
        { isWrapping: true },
      );
      const rect: { index: number; y: number; height: number } =
        cardRect(calls);
      const kept: Array<string> = calls
        .filter((call: DrawCall): boolean => {
          return (
            call.method === "text" && String(call.args[0]).startsWith("Fact")
          );
        })
        .map((call: DrawCall): string => {
          return String(call.args[0]);
        });

      expect(rect.y + rect.height).toBeLessThanOrEqual(BOTTOM_LIMIT);
      expect(kept.length).toBeGreaterThan(40);
      expect(kept.length).toBeLessThan(80);
      expect(kept).toEqual(
        fields.slice(0, kept.length).map((field: { label: string }): string => {
          return field.label;
        }),
      );
      expect(indexOf(calls, "addPage")).toBe(-1);
    });

    /*
     * The stat cards beside it: a value takes up to two lines, the last cut
     * with "..." when it had more, a label one; the row is as tall as its
     * tallest card.
     */
    function statsWidget(
      stats: Array<{ label: string; value: string | number; unit?: string }>,
    ): AIChatWidget {
      return {
        id: "W8",
        type: AIChatWidgetType.StatCards,
        title: "Checkout API",
        data: { stats },
      };
    }

    function statRects(calls: Array<DrawCall>): Array<{
      x: number;
      y: number;
      height: number;
    }> {
      return calls
        .filter((call: DrawCall): boolean => {
          return call.method === "roundedRect";
        })
        .map((call: DrawCall) => {
          return {
            x: call.args[0] as number,
            y: call.args[1] as number,
            height: call.args[3] as number,
          };
        });
    }

    const STAT_TEXT_WIDTH: number = (CONTENT_WIDTH - 12) / 3 - 14;

    test("stats: a value of two lines draws both, and the row grows by a line for every card in it", () => {
      const value: string = wordsOf("val", 10);
      expect(wrapWords(value, STAT_TEXT_WIDTH).length).toBe(2);

      const calls: Array<DrawCall> = drawn(
        statsWidget([
          { label: "Status", value },
          { label: "Errors", value: 3 },
          { label: "P95", value: "1.2", unit: "s" },
        ]),
        { isWrapping: true },
      );
      const rects: Array<{ x: number; y: number; height: number }> =
        statRects(calls);
      const lines: Array<DrawCall> = textsOf(calls, "val");

      expect(
        lines
          .map((call: DrawCall): string => {
            return String(call.args[0]);
          })
          .join(" "),
      ).toBe(value);
      expect(lines.length).toBe(2);
      expect(rects.length).toBe(3);
      for (const rect of rects) {
        expect(rect.height).toBe(38 + 14);
        expect(rect.y).toBe(rects[0]!.y);
      }
      expect((lines[0]!.args[2] as number) - rects[0]!.y).toBe(19);
      expect(
        (lines[1]!.args[2] as number) - (lines[0]!.args[2] as number),
      ).toBe(14);
      expect(textsOf(calls, "1.2 s").length).toBe(1);
    });

    test("stats: a longer value is cut at two lines with ...; a long label at one", () => {
      const value: string = wordsOf("val", 40);
      const label: string = wordsOf("lab", 20);
      const calls: Array<DrawCall> = drawn(statsWidget([{ label, value }]), {
        isWrapping: true,
      });
      const labelLines: Array<string> = linesOf(calls, "LAB");
      const valueLines: Array<string> = linesOf(calls, "val");

      expect(valueLines.length).toBe(PDF_STAT_VALUE_MAX_LINES);
      expect(valueLines[1]!.endsWith(PDF_CUT_MARK)).toBe(true);
      expect(valueLines[0]!.endsWith(PDF_CUT_MARK)).toBe(false);
      expect(
        value.startsWith(valueLines.join(" ").slice(0, -3).trimEnd()),
      ).toBe(true);

      expect(labelLines.length).toBe(1);
      expect(labelLines[0]!.endsWith(PDF_CUT_MARK)).toBe(true);
      expect(labelLines[0]!.length * CHAR_WIDTH).toBeLessThanOrEqual(
        STAT_TEXT_WIDTH,
      );
      expect(label.toUpperCase().startsWith(labelLines[0]!.slice(0, -3))).toBe(
        true,
      );

      expect(statRects(calls)[0]!.height).toBe(38 + 14);
    });

    test("stats: short values keep the card's height as it was", () => {
      const calls: Array<DrawCall> = drawn(
        statsWidget([
          { label: "Errors", value: 3 },
          { label: "P95", value: "1.2", unit: "s" },
        ]),
        { isWrapping: true },
      );

      for (const rect of statRects(calls)) {
        expect(rect.height).toBe(38);
      }
    });

    test("stats: a row that does not fit moves to the next page, measured with its tallest card", () => {
      const calls: Array<DrawCall> = drawn(
        statsWidget([
          { label: "A", value: 1 },
          { label: "B", value: 2 },
          { label: "C", value: 3 },
          { label: "Status", value: wordsOf("val", 10) },
        ]),
        { isWrapping: true, startY: BOTTOM_LIMIT - 120 },
      );
      const rects: Array<{ x: number; y: number; height: number }> =
        statRects(calls);

      expect(rects.length).toBe(4);
      expect(rects[3]!.height).toBe(52);
      for (const rect of rects) {
        expect(rect.y + rect.height).toBeLessThanOrEqual(BOTTOM_LIMIT);
      }
    });
  });
});

/*
 * ISSUE #7175: A READ'S CARD IN THE READER'S LANGUAGE, WITH ITS DOT.
 *
 * The card said "MONITOR", "Type", "Website", "Disabled" and "Off - not
 * checked" in English on a German or Persian page. It says OneUptime's own
 * words in the reader's language now, the status the project named as
 * named - and its status's dot stays where it was, before the line's words
 * on the side the line reads from.
 */
describe("a read's card in German and Persian, with its dot (#7175)", () => {
  async function inLanguage(language: string): Promise<void> {
    await act(async (): Promise<void> => {
      await i18next.changeLanguage(language);
    });
  }

  function textsOf(testId: string): Array<string> {
    return screen.getAllByTestId(testId).map((element: HTMLElement): string => {
      return withoutIsolateMarks(element.textContent || "");
    });
  }

  function lineOf(): { line: HTMLElement; dot: HTMLElement; text: string } {
    const line: HTMLElement = screen.getByTestId("ai-chat-resource-card-line");
    const dot: HTMLElement = within(line).getByTestId(
      "ai-chat-resource-card-status-dot",
    );

    return {
      line,
      dot,
      text: withoutIsolateMarks(line.textContent || ""),
    };
  }

  afterAll(async () => {
    await inLanguage("en");
  });

  test("German: an Offline monitor - German words, its status as the project named it, its dot first", async () => {
    await inLanguage("de");
    render(
      <ResourceCardWidget
        widget={monitorCard({ subheading: "Offline", statusColor: "#fd625e" })}
      />,
    );

    expect(cardElement()).toHaveAttribute("data-card-origin", "read");
    expect(screen.getByTestId("ai-chat-resource-card-kind")).toHaveTextContent(
      DE["Monitor"]!,
    );

    const { line, dot, text } = lineOf();
    expect(line.firstElementChild).toBe(dot);
    expect(dot.style.backgroundColor).toBe("rgb(253, 98, 94)");
    expect(text).toBe("Offline");

    expect(textsOf("ai-chat-resource-card-fact-label")).toEqual([DE["Type"]]);
    expect(textsOf("ai-chat-resource-card-fact-value")).toEqual([
      DE["Website"],
    ]);
    expect(
      screen.getByRole("button", {
        name: DE["Open {{name}}"]!.split("{{name}}").join("Checkout API"),
      }),
    ).toBeInTheDocument();
  });

  test("German, monitoring off: Deaktiviert beside a gray dot, and Aus - wird nicht geprüft", async () => {
    await inLanguage("de");
    render(
      <ResourceCardWidget
        widget={monitorCard({
          subheading: "Disabled",
          statusColor: Gray500.toString(),
        })}
      />,
    );

    const { line, dot, text } = lineOf();
    expect(line.firstElementChild).toBe(dot);
    expect(dot.style.backgroundColor).toBe("rgb(107, 114, 128)");
    expect(text).toBe(DE["Disabled"]);
    expect(DE["Disabled"]).not.toBe("Disabled");

    expect(textsOf("ai-chat-resource-card-fact-label")).toEqual([
      DE["Type"],
      DE["Monitoring"],
    ]);
    expect(textsOf("ai-chat-resource-card-fact-value")).toEqual([
      DE["Website"],
      DE["Off - not checked"],
    ]);

    const card: string = withoutIsolateMarks(cardElement().textContent || "");
    for (const english of ["Disabled", "Off - not checked", "Type", "Open"]) {
      expect(card).not.toContain(english);
    }
  });

  test("Persian, monitoring off: right to left, every word Persian, the dot before the words on the side they read from", async () => {
    await inLanguage("fa");
    render(
      <div dir="rtl">
        <ResourceCardWidget
          widget={monitorCard({
            subheading: "Disabled",
            statusColor: Gray500.toString(),
          })}
        />
      </div>,
    );

    expect(screen.getByTestId("ai-chat-resource-card-kind")).toHaveTextContent(
      FA["Monitor"]!,
    );

    const { line, dot, text } = lineOf();
    expect(line.firstElementChild).toBe(dot);
    expect(dot).toHaveClass("me-1.5");
    expect(text).toBe(FA["Disabled"]);
    expect(line.querySelector("bdi")).toHaveAttribute("dir", "rtl");

    expect(textsOf("ai-chat-resource-card-fact-label")).toEqual([
      FA["Type"],
      FA["Monitoring"],
    ]);
    expect(textsOf("ai-chat-resource-card-fact-value")).toEqual([
      FA["Website"],
      FA["Off - not checked"],
    ]);
    for (const value of screen.getAllByTestId(
      "ai-chat-resource-card-fact-value",
    )) {
      expect(value.querySelector("bdi")).toHaveAttribute("dir", "rtl");
    }

    const card: string = withoutIsolateMarks(cardElement().textContent || "");
    for (const english of [
      "Monitor",
      "Disabled",
      "Off - not checked",
      "Website",
      "Type",
    ]) {
      expect(card).not.toContain(english);
    }
  });

  test("Persian: the status the project named stays as named, read left to right, after its dot", async () => {
    await inLanguage("fa");
    render(
      <div dir="rtl">
        <ResourceCardWidget
          widget={monitorCard({
            subheading: "Offline",
            statusColor: Red.toString(),
          })}
        />
      </div>,
    );

    const { line, dot, text } = lineOf();
    expect(line.firstElementChild).toBe(dot);
    expect(text).toBe("Offline");
    expect(line.querySelector("bdi")).toHaveAttribute("dir", "ltr");
  });

  test("a read's card saved before cards had words reads as its English, in any language", async () => {
    await inLanguage("de");
    const widget: AIChatWidget = monitorCard({
      subheading: "Offline",
      statusColor: "#fd625e",
    });
    delete widget.data.words;

    render(<ResourceCardWidget widget={widget} />);

    expect(screen.getByTestId("ai-chat-resource-card-kind")).toHaveTextContent(
      "Monitor",
    );
    expect(textsOf("ai-chat-resource-card-fact-label")).toEqual(["Type"]);
    expect(textsOf("ai-chat-resource-card-fact-value")).toEqual(["Website"]);
    // Its dot as before.
    expect(lineOf().line.firstElementChild).toBe(lineOf().dot);
  });

  test("a read's card whose words are not ours reads as its English", async () => {
    await inLanguage("de");
    const widget: AIChatWidget = monitorCard({ subheading: "Offline" });
    widget.data.words = {
      kind: aiActionTerm("Monitor"),
      facts: [aiActionCardFact("Password", aiActionTerm("Website"))],
    };

    render(<ResourceCardWidget widget={widget} />);

    expect(screen.getByTestId("ai-chat-resource-card-kind")).toHaveTextContent(
      "Monitor",
    );
    expect(textsOf("ai-chat-resource-card-fact-label")).toEqual(["Type"]);
  });

  test("a write's card holding a read's words is not trusted: they are a read's only", async () => {
    await inLanguage("de");
    const widget: AIChatWidget = monitorCard({ subheading: "Offline" });
    widget.data.origin = AIChatResourceCardOrigin.Write;

    render(<ResourceCardWidget widget={widget} />);

    expect(screen.getByTestId("ai-chat-resource-card-kind")).toHaveTextContent(
      "Monitor",
    );
    expect(textsOf("ai-chat-resource-card-fact-label")).toEqual(["Type"]);
  });
});
