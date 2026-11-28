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
  FORWARDED_BY_EDGE_REASON,
  FORWARDED_BY_REASONS,
  MAX_CHECKED_TEXT_LENGTH,
  MAX_SHOWN_EVENTS,
  SECURITY_LOG_LINE_CHECK_ID,
  getCheckedEventFields,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityLogLineCheck";
import { SecurityEventDetailField } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventDetailFields";
import { SECURITY_LOG_FORMAT_ICONS } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityLogsSourceCard";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import {
  SECURITY_LOG_LINE_CHECK_PATH,
  SecurityLogLineCheckResult,
  securityLogLineCheckResultToJSON,
} from "../../../Types/SecurityEvent/SecurityLogLineCheck";
import API from "../../../UI/Utils/API/API";
import { WIDE_MENU_WIDTH } from "../../../UI/Components/MoreMenu/MoreMenu";
import SecurityLogFormat, {
  SECURITY_LOG_FORMATS,
  SecurityLogFormatDefinition,
  getSecurityLogFormatDefinition,
} from "../../../Types/SecurityEvent/SecurityLogFormat";
import NetworkAddressBlockUtil, {
  NetworkAddressBlock,
} from "../../../Utils/NetworkTraffic/NetworkAddressBlock";
import { checkSecurityLogLines } from "../../../Utils/SecurityEvent/SecurityLogLineCheck";
import {
  NO_TRUSTED_PROXY_SOURCES,
  TrustedProxySource,
  TrustedProxySources,
} from "../../../Utils/SecurityEvent/TrustedProxySources";

/*
 * "Check a log line" on the Your logs card: a pasted line is read by the
 * very parsers the scan runs, and the card says which kind of record it is
 * and the event it becomes - with the users, hosts and addresses it names
 * - or that it becomes none. A line of each kind is one pick away in the
 * Try an example menu.
 *
 * Since #11046 the server reads it, with the project's trusted proxies, so
 * the client it names is the one the stored event names: the page asks
 * POST /security-log-lines/check. Here that server is the real check over
 * the project's trust as each test sets it (checkSecurityLogLines), its
 * answer sent through the wire's own JSON.
 */

const NOW: Date = new Date("2026-11-27T12:00:00.000Z");

const PRIVATE_PROXY: string = "10.0.0.5";
const CLIENT: string = "198.51.100.7";
const INNOCENT: string = "192.0.2.44";
const UNTRUSTED_HOST: string = "203.0.113.50";

// The issue's line: a SQL injection, written behind `first`, forwarded for `forwardedFor`.
function issueLine(
  first: string = PRIVATE_PROXY,
  forwardedFor: string = CLIENT,
): string {
  return `${first} - - [10/Oct/2026:13:55:36 +0000] "GET /?id=1' OR '1'='1 HTTP/1.1" 200 512 "-" "curl/8.0" "${forwardedFor}"`;
}

function blocks(...ranges: Array<string>): Array<NetworkAddressBlock> {
  return ranges.map((range: string): NetworkAddressBlock => {
    return NetworkAddressBlockUtil.parse(range)!;
  });
}

// The project's trust as the server reads it, for each test to set.
let serverTrust: TrustedProxySources = NO_TRUSTED_PROXY_SOURCES;
// What the page asked the server, each the text it sent.
let asked: Array<string> = [];
// How the server answers: the real check, unless a test says otherwise.
let answer: ((text: string) => Promise<unknown>) | null = null;

function checkedByServer(text: string): SecurityLogLineCheckResult {
  return checkSecurityLogLines({ text, sources: serverTrust, now: NOW });
}

beforeEach(() => {
  serverTrust = NO_TRUSTED_PROXY_SOURCES;
  asked = [];
  answer = null;

  jest.spyOn(API, "post").mockImplementation((async (args: {
    url: { toString: () => string };
    data: JSONObject;
  }): Promise<unknown> => {
    if (!args.url.toString().endsWith(SECURITY_LOG_LINE_CHECK_PATH)) {
      throw new Error(`Asked ${args.url.toString()}`);
    }

    const text: string = String(args.data["text"]);

    asked.push(text);

    if (answer) {
      return await answer(text);
    }

    // Through the wire's JSON, as the page reads it.
    return new HTTPResponse<JSONObject>(
      200,
      JSON.parse(
        JSON.stringify(securityLogLineCheckResultToJSON(checkedByServer(text))),
      ),
      {},
    );
  }) as never);
});

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
  jest.restoreAllMocks();
});

// Until the server's answer has been read and drawn.
async function settle(): Promise<void> {
  await act(async (): Promise<void> => {
    for (let i: number = 0; i < 5; i++) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    }
  });
}

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
  await settle();
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
  await settle();
}

// The one event a line became, as the server would answer it.
function eventOf(text: string): NormalizedSecurityEvent {
  const events: Array<NormalizedSecurityEvent> = checkedByServer(text).events;

  expect(events.length).toBeGreaterThan(0);

  return events[0]!;
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

describe("getCheckedEventFields", () => {
  /*
   * What a reader checks a line for: what it was read as, what sent it, and
   * who and what it names - in the order the event's drawer lists them, and
   * only the fields the line filled.
   */
  test("a CEF threat: what it was read as, its sender, and who and what it names", () => {
    const fields: Array<SecurityEventDetailField> = getCheckedEventFields(
      eventOf(CEF_THREAT),
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
      for (const event of checkedByServer(format.example).events) {
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
        eventOf(format.example),
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
  test("is folded until opened, and says under the box's label how the line is read", async () => {
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
    // The box is named by its label and described by how the line is read.
    const box: HTMLElement = screen.getByRole("textbox", { name: "Log line" });
    expect(box).toHaveAccessibleDescription(
      "OneUptime reads it as its scans read your logs, with your trusted proxies, and saves nothing.",
    );
    // Nothing is asked before a line is checked.
    expect(asked).toEqual([]);
  });

  test("a pasted CEF threat shows its kind, severity, message and the fields it was read with", async () => {
    await renderCheck();
    await open();

    expect(
      screen.getByTestId(`${SECURITY_LOG_LINE_CHECK_ID}-run`),
    ).toBeDisabled();
    /*
     * A verb that says what it checks: the Dashboard's "Check" is a noun
     * (Data Security's issue filter), translated as one ("Prüfung").
     */
    expect(screen.getByTestId(`${SECURITY_LOG_LINE_CHECK_ID}-run`)).toBe(
      screen.getByRole("button", { name: "Check line" }),
    );

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
    /*
     * Named by the words it shows: MoreMenu calls a custom trigger "More
     * options" unless told otherwise, which a screen reader would read
     * and a voice command could not find.
     */
    expect(trigger).toHaveAccessibleName("Try an example");
    expect(screen.getByRole("button", { name: "Try an example" })).toBe(
      trigger,
    );
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
    // Wide: "Azure activity and Entra ID logs" keeps one line beside its mark.
    expect(menu.style.width).toBe(WIDE_MENU_WIDTH);
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

  test("Check lines up with the box above it: the Button carries no margin of its own", async () => {
    await renderCheck();
    await open();

    const run: HTMLElement = screen.getByTestId(
      `${SECURITY_LOG_LINE_CHECK_ID}-run`,
    );
    // No dialog footer's margin on the Button any more (#9128).
    expect(run.className).not.toMatch(/(^|\s)(md:)?!?m[ls]-/u);
  });
});

/*
 * #11046: the line is read with the project's trust, as the scan reads it,
 * and a client a proxy forwarded says which proxies it came through and
 * why each is trusted. The server here is the real check over the trust
 * each test sets.
 */
describe("SecurityLogLineCheck, read with your trusted proxies", () => {
  function forwardedBy(event: HTMLElement): Array<string> {
    return within(event)
      .getAllByTestId(`${SECURITY_LOG_LINE_CHECK_ID}-forwarded-by-proxy`)
      .map((proxy: HTMLElement): string => {
        return proxy.textContent || "";
      });
  }

  async function checkLine(text: string): Promise<HTMLElement> {
    await renderCheck();
    await open();
    await paste(text);
    await check();

    return screen.getByTestId(`${SECURITY_LOG_LINE_CHECK_ID}-event`);
  }

  test("asks the server, with the line as pasted", async () => {
    await checkLine(issueLine());

    expect(asked).toEqual([issueLine()]);
  });

  test("behind a private proxy, with the Access Logs switch on, it names the client the proxy forwarded, and why", async () => {
    serverTrust = {
      ...NO_TRUSTED_PROXY_SOURCES,
      readsAccessLogForwardedFor: true,
    };

    const event: HTMLElement = await checkLine(issueLine());

    expect(shownFields(event)).toEqual(
      expect.arrayContaining([
        `Principal IP: ${CLIENT}`,
        `Forwarded By: ${PRIVATE_PROXY} · Private address`,
      ]),
    );
    // Forwarded By follows Principal IP, as in the event's drawer.
    const labels: Array<string> = shownFields(event).map(
      (field: string): string => {
        return field.split(":")[0]!;
      },
    );
    expect(labels.indexOf("Forwarded By")).toBe(
      labels.indexOf("Principal IP") + 1,
    );
    expect(forwardedBy(event)).toEqual([`${PRIVATE_PROXY} · Private address`]);
  });

  test("with the switch off, the line's first field is its client, as the scan says", async () => {
    serverTrust = {
      ...NO_TRUSTED_PROXY_SOURCES,
      readsAccessLogForwardedFor: false,
    };

    const event: HTMLElement = await checkLine(issueLine());

    expect(shownFields(event)).toContain(`Principal IP: ${PRIVATE_PROXY}`);
    expect(
      within(event).queryByTestId(`${SECURITY_LOG_LINE_CHECK_ID}-forwarded-by`),
    ).toBeNull();
  });

  test("a forged X-Forwarded-For from a first field nobody trusts keeps the first field, and says the forgery is claimed", async () => {
    serverTrust = {
      ...NO_TRUSTED_PROXY_SOURCES,
      readsAccessLogForwardedFor: true,
    };

    // A JSON access log names its forwarded-for field, so the claim is kept.
    const event: HTMLElement = await checkLine(
      JSON.stringify({
        remote_addr: UNTRUSTED_HOST,
        http_x_forwarded_for: INNOCENT,
        request: "GET /?id=1' OR '1'='1 HTTP/1.1",
        status: 200,
      }),
    );

    expect(shownFields(event)).toEqual(
      expect.arrayContaining([
        `Principal IP: ${UNTRUSTED_HOST}`,
        `Claimed IP: ${INNOCENT} · Claimed by the request, not verified`,
      ]),
    );
    expect(
      within(event).queryByTestId(`${SECURITY_LOG_LINE_CHECK_ID}-forwarded-by`),
    ).toBeNull();
  });

  test.each([
    [
      "a listed public proxy",
      "203.0.113.10",
      { listed: blocks("203.0.113.0/24") },
      FORWARDED_BY_REASONS[TrustedProxySource.Listed],
    ],
    [
      "a connected edge",
      "104.16.1.1",
      { edges: [{ name: "Cloudflare", blocks: blocks("104.16.0.0/13") }] },
      "In Cloudflare's published ranges",
    ],
    [
      "one of your load balancers",
      "52.1.2.3",
      { ownLoadBalancers: blocks("52.1.2.3") },
      FORWARDED_BY_REASONS[TrustedProxySource.OwnLoadBalancer],
    ],
  ])(
    "%s says why it is trusted",
    async (
      _what: string,
      proxy: string,
      trust: Partial<TrustedProxySources>,
      reason: string,
    ) => {
      serverTrust = {
        ...NO_TRUSTED_PROXY_SOURCES,
        readsAccessLogForwardedFor: true,
        ...trust,
      };

      const event: HTMLElement = await checkLine(issueLine(proxy));

      expect(shownFields(event)).toContain(`Principal IP: ${CLIENT}`);
      expect(forwardedBy(event)).toEqual([`${proxy} · ${reason}`]);
    },
  );

  test("Google's front ends and the load balancer they forward for, each with why, in the order X-Forwarded-For lists them", async () => {
    serverTrust = {
      ...NO_TRUSTED_PROXY_SOURCES,
      readsAccessLogForwardedFor: true,
      ownLoadBalancers: blocks("34.120.1.2"),
      googleFrontEnds: blocks("35.191.0.0/16", "130.211.0.0/22"),
    };

    const event: HTMLElement = await checkLine(
      issueLine("35.191.7.8", `${CLIENT}, 34.120.1.2`),
    );

    expect(shownFields(event)).toContain(`Principal IP: ${CLIENT}`);
    expect(forwardedBy(event)).toEqual([
      "34.120.1.2 · One of your load balancers",
      "35.191.7.8 · One of Google's front ends",
    ]);
  });

  test("every reason is a sentence of the Dashboard's, the edge's name put in its own", () => {
    expect(Object.values(FORWARDED_BY_REASONS)).toEqual([
      "Private address",
      "In your Trusted Proxies",
      "One of your load balancers",
      "One of Google's front ends",
    ]);
    expect(FORWARDED_BY_EDGE_REASON).toBe("In {{edge}}'s published ranges");
    expect(CHECKED_EVENT_FIELD_LABELS).toEqual(
      expect.arrayContaining(["Claimed IP", "Forwarded By"]),
    );
  });

  test("while the server reads it, Check line says so and cannot be pressed again", async () => {
    let release: () => void = (): void => {
      return undefined;
    };

    answer = (text: string): Promise<unknown> => {
      return new Promise<unknown>((resolve: (value: unknown) => void) => {
        release = (): void => {
          resolve(
            new HTTPResponse<JSONObject>(
              200,
              securityLogLineCheckResultToJSON(checkedByServer(text)),
              {},
            ),
          );
        };
      });
    };

    await renderCheck();
    await open();
    await paste(CEF_THREAT);
    await check();

    const run: HTMLElement = screen.getByTestId(
      `${SECURITY_LOG_LINE_CHECK_ID}-run`,
    );

    expect(run).toBeDisabled();
    expect(
      screen.queryByTestId(`${SECURITY_LOG_LINE_CHECK_ID}-result`),
    ).toBeNull();

    await act(async () => {
      release();
    });
    await settle();

    expect(run).not.toBeDisabled();
    expect(
      screen.getByTestId(`${SECURITY_LOG_LINE_CHECK_ID}-result`),
    ).toHaveTextContent("OneUptime makes 1 security event of this:");
  });

  test("a check the server refuses says why, and keeps the line to try again", async () => {
    answer = async (): Promise<unknown> => {
      return new HTTPErrorResponse(
        403,
        {
          message:
            "Checking a log line takes a role that can read security events.",
        },
        {},
      );
    };

    await renderCheck();
    await open();
    await paste(CEF_THREAT);
    await check();

    expect(
      screen.getByTestId(`${SECURITY_LOG_LINE_CHECK_ID}-error`),
    ).toHaveTextContent(
      "Checking a log line takes a role that can read security events.",
    );
    expect(
      screen.getByTestId(`${SECURITY_LOG_LINE_CHECK_ID}-input`),
    ).toHaveValue(CEF_THREAT);
    expect(
      screen.queryByTestId(`${SECURITY_LOG_LINE_CHECK_ID}-none`),
    ).toBeNull();

    // Asked again, the server answers.
    answer = null;
    await check();

    expect(
      screen.queryByTestId(`${SECURITY_LOG_LINE_CHECK_ID}-error`),
    ).toBeNull();
    expect(
      screen.getByTestId(`${SECURITY_LOG_LINE_CHECK_ID}-result`),
    ).toBeInTheDocument();
  });

  test("an answer about a line changed since it was asked is never shown under the new one", async () => {
    let release: () => void = (): void => {
      return undefined;
    };

    answer = (text: string): Promise<unknown> => {
      return new Promise<unknown>((resolve: (value: unknown) => void) => {
        release = (): void => {
          resolve(
            new HTTPResponse<JSONObject>(
              200,
              securityLogLineCheckResultToJSON(checkedByServer(text)),
              {},
            ),
          );
        };
      });
    };

    await renderCheck();
    await open();
    await paste(CEF_THREAT);
    await check();
    await paste(EVERYDAY_LINE);

    await act(async () => {
      release();
    });
    await settle();

    expect(
      screen.queryByTestId(`${SECURITY_LOG_LINE_CHECK_ID}-result`),
    ).toBeNull();
    expect(
      screen.getByTestId(`${SECURITY_LOG_LINE_CHECK_ID}-run`),
    ).not.toBeDisabled();
  });

  test("sends no more of a paste than is read", async () => {
    await renderCheck();
    await open();
    await paste(`${CEF_THREAT}\n${"x".repeat(MAX_CHECKED_TEXT_LENGTH)}`);
    await check();

    expect(asked).toHaveLength(1);
    expect(asked[0]!.length).toBe(MAX_CHECKED_TEXT_LENGTH);
    expect(asked[0]!.startsWith(CEF_THREAT)).toBe(true);
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
