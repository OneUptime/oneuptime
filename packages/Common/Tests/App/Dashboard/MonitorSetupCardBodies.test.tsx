import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";

/*
 * The setup cards of the push monitors, shown on the Overview while a
 * monitor waits for its first signal and on its Documentation tab: the
 * Incoming Email Address card, the heartbeat URL card and the server
 * agent's install commands.
 *
 * Each put what the reader came for - the address, the URL, the commands -
 * in Card's `description`. Card renders that in a <p> hidden below md
 * ("max-md:hidden"), so a phone showed a title over an empty card, and a
 * <p> cannot hold the <div>s, <p>s and code blocks put there: React warned
 * about the nesting.
 *
 * jsdom has no Tailwind, so this pins the structure: a card's description
 * is plain text, what the reader needs is in the card's body, and nothing
 * warns. That the details really stay on screen at 390px is checked in a
 * browser, by "setup details stay on screen at 390px" in
 * packages/E2E/MonitorOverview/MonitorOverview.spec.ts.
 */

let mockInboundEmailDomain: string | undefined = "inbound.example.com";

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  const config: Record<string, unknown> = {
    ...actual,
    __esModule: true,
    HOST: "oneuptime.example.com",
  };

  // A getter, so a test can switch the domain off.
  Object.defineProperty(config, "INBOUND_EMAIL_DOMAIN", {
    enumerable: true,
    get: (): string | undefined => {
      return mockInboundEmailDomain;
    },
  });

  return config;
});

import IncomingEmailMonitorLink, {
  VERIFY_ADDRESS_DOCS_ROUTE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/IncomingEmailMonitor/IncomingEmailMonitorLink";
import IncomingMonitorLink, {
  getHeartbeatUrl,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/IncomingRequestMonitor/IncomingMonitorLink";
import ServerMonitorDocumentation from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/ServerMonitor/Documentation";
import ObjectID from "../../../Types/ObjectID";

const EMAIL_SECRET: ObjectID = new ObjectID(
  "5ec2e7a1-0b1c-4d2e-9f30-4a5b6c7d8e9f",
);
const HEARTBEAT_SECRET: ObjectID = new ObjectID(
  "6fd3f8b2-1c2d-4e3f-a041-5b6c7d8e9fa0",
);
const SERVER_SECRET: ObjectID = new ObjectID(
  "7ae4a9c3-2d3e-4f40-b152-6c7d8e9fa0b1",
);

let consoleErrorSpy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  consoleErrorSpy = jest.spyOn(console, "error");
});

afterEach(() => {
  cleanup();
  consoleErrorSpy.mockRestore();
  mockInboundEmailDomain = "inbound.example.com";
});

// What React said about the markup while the card rendered.
function nestingWarnings(): Array<string> {
  return consoleErrorSpy.mock.calls
    .map((call: Array<unknown>): string => {
      return call.map(String).join(" ");
    })
    .filter((message: string): boolean => {
      return message.includes("validateDOMNesting");
    });
}

/*
 * A card's description may only be text: Card hides it below md, and its
 * <p> can hold nothing else.
 */
function expectTextOnlyDescriptions(): void {
  for (const description of screen.queryAllByTestId("card-description")) {
    expect(description.children).toHaveLength(0);
  }
}

function expectOutsideDescriptions(element: HTMLElement): void {
  for (const description of screen.queryAllByTestId("card-description")) {
    expect(description).not.toContainElement(element);
  }
}

describe("The Incoming Email Address card", () => {
  test("keeps the address, its copy button and the hint in the body", () => {
    render(<IncomingEmailMonitorLink secretKey={EMAIL_SECRET} />);

    const address: HTMLElement = screen.getByTestId("incoming-email-address");
    const copy: HTMLElement = screen.getByRole("button", {
      name: "Copy email address",
    });
    const verify: HTMLElement = screen.getByRole("link", {
      name: "How to verify the address",
    });

    expect(address).toHaveTextContent(
      `monitor-${EMAIL_SECRET.toString()}@inbound.example.com`,
    );
    expect(verify).toHaveAttribute("href", VERIFY_ADDRESS_DOCS_ROUTE);
    expect(verify).toHaveAttribute("target", "_blank");

    for (const element of [address, copy, verify]) {
      expectOutsideDescriptions(element);
      expect(screen.getByTestId("incoming-email-setup")).toContainElement(
        element,
      );
    }

    expectTextOnlyDescriptions();
    expect(screen.getByTestId("card-description")).toHaveTextContent(
      "Please send emails to this unique monitor email address.",
    );
    expect(nestingWarnings()).toEqual([]);
  });

  test("shows a custom address the same way", () => {
    render(
      <IncomingEmailMonitorLink
        secretKey={EMAIL_SECRET}
        customLocalPart="nightly-backups"
      />,
    );

    const address: HTMLElement = screen.getByTestId("incoming-email-address");

    expect(address).toHaveTextContent("nightly-backups@inbound.example.com");
    expectOutsideDescriptions(address);
    expect(nestingWarnings()).toEqual([]);
  });

  test("says inbound email is not configured in the body, where a phone shows it", () => {
    mockInboundEmailDomain = undefined;

    render(<IncomingEmailMonitorLink secretKey={EMAIL_SECRET} />);

    const message: HTMLElement = screen.getByText(
      /Inbound email is not configured/,
    );
    const docs: HTMLElement = screen.getByRole("link", {
      name: "View Setup Documentation",
    });

    expect(docs).toHaveAttribute(
      "href",
      "/docs/self-hosted/sendgrid-inbound-email",
    );
    expectOutsideDescriptions(message);
    expect(screen.queryByTestId("card-description")).not.toBeInTheDocument();
    expect(screen.queryByTestId("incoming-email-address")).toBeNull();
    expect(nestingWarnings()).toEqual([]);
  });
});

describe("The heartbeat URL card", () => {
  test("keeps the URL and its copy button in the body", () => {
    render(<IncomingMonitorLink secretKey={HEARTBEAT_SECRET} />);

    const url: string = getHeartbeatUrl(HEARTBEAT_SECRET).toString();
    const urlText: HTMLElement = screen.getByTestId("incoming-request-url");
    const link: HTMLElement = urlText.closest("a")!;
    const copy: HTMLElement = screen.getByRole("button", {
      name: "Copy heartbeat URL",
    });

    expect(url).toContain(`/heartbeat/${HEARTBEAT_SECRET.toString()}`);
    expect(urlText).toHaveTextContent(url);
    expect(link).toHaveAttribute("href", url);
    expect(link).toHaveAttribute("target", "_blank");

    for (const element of [urlText, copy]) {
      expectOutsideDescriptions(element);
      expect(screen.getByTestId("incoming-request-setup")).toContainElement(
        element,
      );
    }

    expectTextOnlyDescriptions();
    expect(screen.getByTestId("card-description")).toHaveTextContent(
      "Please send inbound heartbeat GET or POST requests to this URL.",
    );
    expect(nestingWarnings()).toEqual([]);
  });
});

describe("The server agent's install cards", () => {
  test("keep both sets of commands in the body", () => {
    render(<ServerMonitorDocumentation secretKey={SERVER_SECRET} />);

    for (const testId of [
      "server-monitor-setup-linux",
      "server-monitor-setup-windows",
    ]) {
      const setup: HTMLElement = screen.getByTestId(testId);
      // CodeBlock draws the commands as <pre><code>, highlighted by hljs.
      const code: Element | null = setup.querySelector("pre code");

      expect(code).not.toBeNull();
      expect(code!.textContent).toContain(
        `--secret-key=${SERVER_SECRET.toString()}`,
      );
      expect(code!.textContent).toMatch(
        /--oneuptime-url=https?:\/\/oneuptime\.example\.com/,
      );
      expectOutsideDescriptions(setup);
    }

    expect(
      screen.getByText("Set up your Server Monitor (Linux/Mac)"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Set up your Server Monitor (Windows)"),
    ).toBeInTheDocument();
    expect(screen.queryAllByTestId("card-description")).toHaveLength(0);
    expect(nestingWarnings()).toEqual([]);
  });
});
