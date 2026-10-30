import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import SecurityLogLineCheck, {
  CHECKED_EVENT_FIELD_LABELS,
  MAX_CHECKED_LINES,
  MAX_SHOWN_EVENTS,
  SECURITY_LOG_LINE_CHECK_ID,
  checkSecurityLogLines,
  getCheckedEventFields,
  getEventLogFormat,
  splitPastedLogLines,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityLogLineCheck";
import { SecurityEventDetailField } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventDetailFields";
import { SECURITY_LOG_FORMAT_ICONS } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityLogsSourceCard";
import SecurityLogFormat, {
  SECURITY_LOG_FORMATS,
  SecurityLogFormatDefinition,
  getSecurityLogFormatDefinition,
} from "../../../Types/SecurityEvent/SecurityLogFormat";

/*
 * "Check a log line" on the Your logs card: a pasted line is read by the
 * very parsers the scan runs, in the browser, and the card says which kind
 * of record it is and the event it becomes - with the users, hosts and
 * addresses it names - or that it becomes none. A line of each kind is one
 * pick away in the Try an example menu.
 */

const CEF_THREAT: string =
  "CEF:0|Palo Alto Networks|PAN-OS|11.1|threat|Spyware Detected|8|act=reset-both src=10.0.0.12 dst=198.51.100.23 suser=alice cs1=Default";
const EVERYDAY_LINE: string =
  '10.0.0.4 - - [30/Oct/2026:10:00:00 +0000] "GET /index.html HTTP/1.1" 200 512';

// The drawer's fields a check leaves to the drawer.
const LEFT_TO_THE_DRAWER: RegExp =
  /^(?:Message|Category|Rule ID|Event UID|Trace ID|Session ID|Request Outcome)$/;

// A column count keyed to the window's width (sm:, md:, lg:, xl:, 2xl:).
const WINDOW_COLUMNS: RegExp = /(?:^|\s)(?:sm|md|lg|xl|2xl):grid-cols-/;

afterEach(() => {
  cleanup();
});

function definition(format: SecurityLogFormat): SecurityLogFormatDefinition {
  return getSecurityLogFormatDefinition(format)!;
}

async function renderCheck(): Promise<void> {
  await act(async () => {
    render(<SecurityLogLineCheck icons={SECURITY_LOG_FORMAT_ICONS} />);
  });
}

async function open(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Check a log line/ }));
  });
}

async function paste(text: string): Promise<void> {
  await act(async () => {
    fireEvent.change(
      screen.getByTestId(`${SECURITY_LOG_LINE_CHECK_ID}-input`),
      { target: { value: text } },
    );
  });
}

async function check(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId(`${SECURITY_LOG_LINE_CHECK_ID}-run`));
  });
}

function examplesTrigger(): HTMLElement {
  return screen.getByTestId(`${SECURITY_LOG_LINE_CHECK_ID}-examples`);
}

async function openExamples(): Promise<HTMLElement> {
  await act(async () => {
    fireEvent.click(examplesTrigger());
  });
  return screen.getByRole("menu");
}

async function pickExample(format: SecurityLogFormat): Promise<void> {
  await openExamples();
  await act(async () => {
    fireEvent.click(
      screen.getByTestId(`${SECURITY_LOG_LINE_CHECK_ID}-example-${format}`),
    );
  });
}

// The fields a checked event shows, as label: value.
function shownFields(event: HTMLElement): Array<string> {
  return within(event)
    .getAllByTestId(`${SECURITY_LOG_LINE_CHECK_ID}-field`)
    .map((field: HTMLElement): string => {
      return `${field.querySelector("dt")?.textContent}: ${
        field.querySelector("dd")?.textContent
      }`;
    });
}

describe("checkSecurityLogLines", () => {
  test("a firewall's CEF threat is one event, read as CEF", () => {
    const result: ReturnType<typeof checkSecurityLogLines> =
      checkSecurityLogLines(CEF_THREAT);

    expect(result.linesRead).toBe(1);
    expect(result.events).toHaveLength(1);
    expect(getEventLogFormat(result.events[0]!)?.format).toBe(
      SecurityLogFormat.Cef,
    );
  });

  test("an everyday line makes no event", () => {
    expect(checkSecurityLogLines(EVERYDAY_LINE)).toEqual({
      linesRead: 1,
      events: [],
    });
    expect(checkSecurityLogLines("   ")).toEqual({ linesRead: 0, events: [] });
  });

  test("every kind's example is read as that kind", () => {
    for (const format of SECURITY_LOG_FORMATS) {
      const events: ReturnType<typeof checkSecurityLogLines>["events"] =
        checkSecurityLogLines(format.example).events;

      expect([format.format, getEventLogFormat(events[0]!)?.format]).toEqual([
        format.format,
        format.format,
      ]);
    }
  });

  test("a JSON record pasted across lines is one record; other lines are read one by one", () => {
    const pretty: string = JSON.stringify(
      JSON.parse(definition(SecurityLogFormat.AwsCloudTrail).example),
      null,
      2,
    );

    expect(splitPastedLogLines(pretty)).toHaveLength(1);
    expect(
      getEventLogFormat(checkSecurityLogLines(pretty).events[0]!)?.format,
    ).toBe(SecurityLogFormat.AwsCloudTrail);

    const two: ReturnType<typeof checkSecurityLogLines> = checkSecurityLogLines(
      `${CEF_THREAT}\n\n${definition(SecurityLogFormat.SshSignIn).example}\n`,
    );

    expect(two.linesRead).toBe(2);
    expect(
      two.events.map((event: (typeof two.events)[number]) => {
        return getEventLogFormat(event)?.format;
      }),
    ).toEqual([SecurityLogFormat.Cef, SecurityLogFormat.SshSignIn]);
  });

  test("a long paste is read for its first lines only", () => {
    const lines: Array<string> = splitPastedLogLines(
      Array.from(
        { length: MAX_CHECKED_LINES + 30 },
        (_: unknown, i: number) => {
          return `line ${i}`;
        },
      ).join("\n"),
    );

    expect(lines).toHaveLength(MAX_CHECKED_LINES);
    expect(lines[0]).toBe("line 0");
  });
});

describe("getCheckedEventFields", () => {
  /*
   * What a reader checks a line for: what it was read as, what sent it, and
   * who and what it names - in the order the event's drawer lists them, and
   * only the fields the line filled.
   */
  test("a CEF threat: what it was read as, its sender, and who and what it names", () => {
    const fields: Array<SecurityEventDetailField> = getCheckedEventFields(
      checkSecurityLogLines(CEF_THREAT).events[0]!,
    );

    expect(
      fields.map((field: SecurityEventDetailField): string => {
        return `${field.label}: ${field.value}`;
      }),
    ).toEqual([
      "Event Class: Detection Finding",
      "Activity: Create",
      "Status: Blocked",
      "Vendor: Palo Alto Networks",
      "Product: PAN-OS",
      "Detection Rule: Spyware Detected",
      "Principal User: alice",
      "Principal IP: 10.0.0.12",
      "Target IP: 198.51.100.23",
    ]);
  });

  test("never the message, which leads the card, nor ids or the request it happened in", () => {
    for (const format of SECURITY_LOG_FORMATS) {
      for (const event of checkSecurityLogLines(format.example).events) {
        for (const field of getCheckedEventFields(event)) {
          expect([format.format, field.label]).toEqual([
            format.format,
            expect.not.stringMatching(LEFT_TO_THE_DRAWER),
          ]);
          expect(CHECKED_EVENT_FIELD_LABELS).toContain(field.label);
          expect(field.value.trim()).not.toBe("");
        }
      }
    }
  });

  test("every kind's example names at least who or what it is about", () => {
    const ENTITY_LABELS: Array<string> = [
      "Principal User",
      "Principal Host",
      "Principal IP",
      "Target User",
      "Target Host",
      "Target IP",
      "Target Resource",
    ];

    for (const format of SECURITY_LOG_FORMATS) {
      const labels: Array<string> = getCheckedEventFields(
        checkSecurityLogLines(format.example).events[0]!,
      ).map((field: SecurityEventDetailField): string => {
        return field.label;
      });

      expect([
        format.format,
        labels.some((label: string): boolean => {
          return ENTITY_LABELS.includes(label);
        }),
      ]).toEqual([format.format, true]);
    }
  });
});

describe("SecurityLogLineCheck", () => {
  test("is folded until opened, and says under the box's label that the line goes nowhere", async () => {
    await renderCheck();

    const heading: HTMLElement = screen.getByRole("button", {
      name: /Check a log line/,
    });

    expect(heading).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("collapsible-section-summary")).toHaveTextContent(
      "Paste a line from your logs to see the security event OneUptime makes of it.",
    );

    await open();

    expect(heading).toHaveAttribute("aria-expanded", "true");
    // The box is named by its label and described by where the line goes.
    const box: HTMLElement = screen.getByRole("textbox", { name: "Log line" });
    expect(box).toHaveAccessibleDescription(
      "The line is read here, in your browser: nothing is saved or sent.",
    );
  });

  test("a pasted CEF threat shows its kind, severity, message and the fields it was read with", async () => {
    await renderCheck();
    await open();

    expect(
      screen.getByTestId(`${SECURITY_LOG_LINE_CHECK_ID}-run`),
    ).toBeDisabled();

    await paste(CEF_THREAT);
    await check();

    const result: HTMLElement = screen.getByTestId(
      `${SECURITY_LOG_LINE_CHECK_ID}-result`,
    );

    expect(result).toHaveTextContent(
      "OneUptime makes 1 security event of this:",
    );

    const event: HTMLElement = within(result).getByTestId(
      `${SECURITY_LOG_LINE_CHECK_ID}-event`,
    );

    expect(
      within(event).getByTestId(`${SECURITY_LOG_LINE_CHECK_ID}-format`),
    ).toHaveTextContent("CEF");
    expect(event).toHaveTextContent("High");
    expect(
      within(event).getByTestId(`${SECURITY_LOG_LINE_CHECK_ID}-message`),
    ).toHaveTextContent(
      "Spyware Detected from alice to 198.51.100.23 (reset-both)",
    );
    expect(shownFields(event)).toEqual([
      "Event Class: Detection Finding",
      "Activity: Create",
      "Status: Blocked",
      "Vendor: Palo Alto Networks",
      "Product: PAN-OS",
      "Detection Rule: Spyware Detected",
      "Principal User: alice",
      "Principal IP: 10.0.0.12",
      "Target IP: 198.51.100.23",
    ]);
    // A definition list, label over value: what a screen reader reads as pairs.
    expect(
      within(event).getByTestId(`${SECURITY_LOG_LINE_CHECK_ID}-fields`).tagName,
    ).toBe("DL");
  });

  /*
   * In a narrow event box (a phone) each field is one line, label beside
   * value; from 30rem of the box's own width, label over value in two
   * columns, three from 44rem. The browser suite measures them.
   */
  test("the fields take their layout from the event's own box, not the window", async () => {
    await renderCheck();
    await open();
    await paste(CEF_THREAT);
    await check();

    const fields: HTMLElement = screen.getByTestId(
      `${SECURITY_LOG_LINE_CHECK_ID}-fields`,
    );

    expect(fields.parentElement).toHaveClass("[container-type:inline-size]");
    expect(fields).toHaveClass(
      "grid-cols-1",
      "[@container(min-width:30rem)]:grid-cols-2",
      "[@container(min-width:44rem)]:grid-cols-3",
    );
    expect(fields.className).not.toMatch(WINDOW_COLUMNS);

    for (const field of screen.getAllByTestId(
      `${SECURITY_LOG_LINE_CHECK_ID}-field`,
    )) {
      expect(field).toHaveClass(
        "grid-cols-[minmax(0,2fr)_minmax(0,3fr)]",
        "[@container(min-width:30rem)]:block",
      );
    }
  });

  test("an everyday line is told it stays a log", async () => {
    await renderCheck();
    await open();
    await paste(EVERYDAY_LINE);
    await check();

    expect(
      screen.getByTestId(`${SECURITY_LOG_LINE_CHECK_ID}-none`),
    ).toHaveTextContent("OneUptime makes no security event of this.");
    expect(
      screen.queryByTestId(`${SECURITY_LOG_LINE_CHECK_ID}-result`),
    ).toBeNull();
  });

  test("changing the line clears the answer about the old one", async () => {
    await renderCheck();
    await open();
    await paste(EVERYDAY_LINE);
    await check();
    await paste(CEF_THREAT);

    expect(
      screen.queryByTestId(`${SECURITY_LOG_LINE_CHECK_ID}-none`),
    ).toBeNull();
  });

  test("a paste that makes more events than are shown says which ones are", async () => {
    const sshLine: string = definition(SecurityLogFormat.SshSignIn).example;
    const lines: string = Array.from(
      { length: MAX_SHOWN_EVENTS + 2 },
      (): string => {
        return sshLine;
      },
    ).join("\n");

    await renderCheck();
    await open();
    await paste(lines);
    await check();

    expect(
      screen.getByTestId(`${SECURITY_LOG_LINE_CHECK_ID}-result`),
    ).toHaveTextContent(
      `OneUptime makes ${MAX_SHOWN_EVENTS + 2} security events of this:`,
    );
    expect(
      screen.getAllByTestId(`${SECURITY_LOG_LINE_CHECK_ID}-event`),
    ).toHaveLength(MAX_SHOWN_EVENTS);
    expect(
      screen.getByTestId(`${SECURITY_LOG_LINE_CHECK_ID}-more`),
    ).toHaveTextContent(`Showing the first ${MAX_SHOWN_EVENTS}.`);
  });

  test("a paste of no more events than are shown says nothing more", async () => {
    await renderCheck();
    await open();
    await paste(CEF_THREAT);
    await check();

    expect(
      screen.queryByTestId(`${SECURITY_LOG_LINE_CHECK_ID}-more`),
    ).toBeNull();
  });

  /*
   * The examples are one menu at the end of the box's label row, as a form
   * field keeps its setup guide link there: ten names in a row of links
   * read as a wall of blue under the box.
   */
  test("Try an example sits at the end of the box's label row and opens a menu", async () => {
    await renderCheck();
    await open();

    const trigger: HTMLElement = examplesTrigger();
    const label: HTMLElement = screen.getByText("Log line");

    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger).toHaveTextContent("Try an example");
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    // The label and the menu share a row, the label first.
    expect(trigger.parentElement?.parentElement).toBe(label.parentElement);
    expect(
      label.compareDocumentPosition(trigger) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await openExamples();

    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  test("the menu holds a line of every kind, named and ordered as Your logs lists them", async () => {
    await renderCheck();
    await open();

    const menu: HTMLElement = await openExamples();

    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item: HTMLElement): string => {
          return item.textContent || "";
        }),
    ).toEqual(
      SECURITY_LOG_FORMATS.map((format: SecurityLogFormatDefinition) => {
        return format.title;
      }),
    );
  });

  test("an example fills the box and is checked at once", async () => {
    await renderCheck();
    await open();
    await pickExample(SecurityLogFormat.WindowsEvents);

    expect(
      screen.getByTestId(`${SECURITY_LOG_LINE_CHECK_ID}-input`),
    ).toHaveValue(definition(SecurityLogFormat.WindowsEvents).example);
    expect(
      screen.getByTestId(`${SECURITY_LOG_LINE_CHECK_ID}-format`),
    ).toHaveTextContent("Windows events");
    // The menu closes behind the pick.
    expect(screen.queryByRole("menu")).toBeNull();
  });

  test("every kind's example becomes an event of its kind on the card", async () => {
    await renderCheck();
    await open();

    for (const format of SECURITY_LOG_FORMATS) {
      await pickExample(format.format);

      expect([
        format.format,
        screen.getByTestId(`${SECURITY_LOG_LINE_CHECK_ID}-format`).textContent,
      ]).toEqual([format.format, format.title]);
    }
  });

  test("Check lines up with the box above it: the Button's footer margin is cleared", async () => {
    await renderCheck();
    await open();

    const run: HTMLElement = screen.getByTestId(
      `${SECURITY_LOG_LINE_CHECK_ID}-run`,
    );
    // Button draws md:ml-3, a dialog footer's spacing; its wrapper clears it.
    expect(run).toHaveClass("md:ml-3");
    const wrapper: HTMLElement = run.closest("div") as HTMLElement;
    expect(wrapper).toHaveClass(
      "[&>button]:ml-0",
      "[&>button]:md:ml-0",
      "[&>*>button]:ml-0",
      "[&>*>button]:md:ml-0",
    );
  });
});

/*
 * The menu is portalled and placed in pixels, so it does not mirror with
 * the page: in a right-to-left page the trigger sits at the left of its row,
 * and the menu hangs rightwards from it, into the card, instead of off the
 * card's left edge. jsdom does no layout, so the trigger measures what the
 * test says.
 */
describe("SecurityLogLineCheck's examples menu and the reading direction", () => {
  const TRIGGER: { left: number; top: number; width: number; height: number } =
    { left: 500, top: 100, width: 120, height: 28 };
  const VIEWPORT_WIDTH: number = 1280;
  const originalRect: () => DOMRect =
    HTMLElement.prototype.getBoundingClientRect;
  const originalOffsetWidth: PropertyDescriptor | undefined =
    Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
  const originalInnerWidth: number = window.innerWidth;

  function measure(): void {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: VIEWPORT_WIDTH,
    });
    HTMLElement.prototype.getBoundingClientRect = function (
      this: HTMLElement,
    ): DOMRect {
      if (this.getAttribute("aria-haspopup") === "menu") {
        return {
          x: TRIGGER.left,
          y: TRIGGER.top,
          left: TRIGGER.left,
          top: TRIGGER.top,
          width: TRIGGER.width,
          height: TRIGGER.height,
          right: TRIGGER.left + TRIGGER.width,
          bottom: TRIGGER.top + TRIGGER.height,
          toJSON: () => {
            return TRIGGER;
          },
        } as DOMRect;
      }
      return originalRect.call(this);
    };
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get(this: HTMLElement): number {
        return this.getAttribute("role") === "menu" ? 224 : 0;
      },
    });
  }

  afterEach(() => {
    document.documentElement.removeAttribute("dir");
    HTMLElement.prototype.getBoundingClientRect = originalRect;
    if (originalOffsetWidth) {
      Object.defineProperty(
        HTMLElement.prototype,
        "offsetWidth",
        originalOffsetWidth,
      );
    }
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: originalInnerWidth,
    });
  });

  test("left to right: the menu hangs leftwards, its right edge at the trigger's", async () => {
    measure();
    await renderCheck();
    await open();

    const menu: HTMLElement = await openExamples();

    expect(menu.style.right).toBe(
      `${VIEWPORT_WIDTH - (TRIGGER.left + TRIGGER.width)}px`,
    );
    expect(menu.style.left).toBe("");
  });

  test("right to left: the menu hangs rightwards, its left edge at the trigger's", async () => {
    document.documentElement.setAttribute("dir", "rtl");
    measure();
    await renderCheck();
    await open();

    const menu: HTMLElement = await openExamples();

    expect(menu.style.left).toBe(`${TRIGGER.left}px`);
    expect(menu.style.right).toBe("");
  });
});
