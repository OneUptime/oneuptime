import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";
import type { jsPDF } from "jspdf";
import ResourceCardWidget, {
  RESOURCE_CARD_LOOKS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/Widgets/ResourceCardWidget";
import PdfWidgets, {
  PDF_RESOURCE_CARD_LOOKS,
  PDF_STATUS_DOT,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/Export/PdfWidgets";
import PdfDocument, {
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

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {},
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

/*
 * The PDF export draws each card as the chat does: on a jsPDF stand-in
 * that records what was drawn, in which colours.
 */
describe("in the PDF export", () => {
  interface DrawCall {
    method: string;
    args: Array<unknown>;
  }

  function drawn(widget: AIChatWidget): Array<DrawCall> {
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
      splitTextToSize: (text: string): Array<string> => {
        return [text];
      },
      getTextWidth: (text: string): number => {
        return text.length * 4;
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

    new PdfWidgets(new PdfDocument(doc), {} as unknown as PdfTable).draw(
      widget,
    );

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
});
