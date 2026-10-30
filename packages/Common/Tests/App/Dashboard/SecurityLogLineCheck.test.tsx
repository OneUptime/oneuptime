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
  MAX_CHECKED_LINES,
  SECURITY_LOG_LINE_CHECK_ID,
  checkSecurityLogLines,
  getEventLogFormat,
  splitPastedLogLines,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityLogLineCheck";
import { SECURITY_LOG_FORMAT_ICONS } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityLogsSourceCard";
import SecurityLogFormat, {
  SECURITY_LOG_FORMATS,
  SecurityLogFormatDefinition,
  getSecurityLogFormatDefinition,
} from "../../../Types/SecurityEvent/SecurityLogFormat";

/*
 * "Check a log line" on the Your logs card: a pasted line is read by the
 * very parsers the scan runs, in the browser, and the card says which kind
 * of record it is and the event it becomes - or that it becomes none. Each
 * kind's own example, one click away, is read as that kind.
 */

const CEF_THREAT: string =
  "CEF:0|Palo Alto Networks|PAN-OS|11.1|threat|Spyware Detected|8|act=reset-both src=10.0.0.12 dst=198.51.100.23 suser=alice cs1=Default";
const EVERYDAY_LINE: string =
  '10.0.0.4 - - [30/Oct/2026:10:00:00 +0000] "GET /index.html HTTP/1.1" 200 512';

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

describe("SecurityLogLineCheck", () => {
  test("is folded until opened, and says the line goes nowhere", async () => {
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
    expect(screen.getByTestId(SECURITY_LOG_LINE_CHECK_ID)).toHaveTextContent(
      "The line is read here, in your browser: nothing is saved or sent.",
    );
    // The box is named by its label.
    expect(
      screen.getByRole("textbox", { name: "Log line" }),
    ).toBeInTheDocument();
  });

  test("a pasted CEF threat shows its kind, severity and message", async () => {
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
    expect(event).toHaveTextContent("Spyware Detected");
    expect(
      within(event).getByTestId(`${SECURITY_LOG_LINE_CHECK_ID}-class`),
    ).toHaveTextContent("Detection Finding");
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

  test("an example fills the box and is checked at once", async () => {
    await renderCheck();
    await open();

    await act(async () => {
      fireEvent.click(
        screen.getByTestId(
          `${SECURITY_LOG_LINE_CHECK_ID}-example-${SecurityLogFormat.WindowsEvents}`,
        ),
      );
    });

    expect(
      screen.getByTestId(`${SECURITY_LOG_LINE_CHECK_ID}-input`),
    ).toHaveValue(definition(SecurityLogFormat.WindowsEvents).example);
    expect(
      screen.getByTestId(`${SECURITY_LOG_LINE_CHECK_ID}-format`),
    ).toHaveTextContent("Windows events");
  });

  test("there is an example for every kind, named as its card names it", async () => {
    await renderCheck();

    expect(
      SECURITY_LOG_FORMATS.map((format: SecurityLogFormatDefinition) => {
        return screen.getByTestId(
          `${SECURITY_LOG_LINE_CHECK_ID}-example-${format.format}`,
        ).textContent;
      }),
    ).toEqual(
      SECURITY_LOG_FORMATS.map((format: SecurityLogFormatDefinition) => {
        return format.title;
      }),
    );
  });
});
