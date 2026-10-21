import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";

/*
 * The monitor's "Incoming Email Address" card, on the Overview's setup card
 * and on the Documentation tab. It is where a reader copies the address into
 * the service that will send to it - Azure Monitor action groups, say, which
 * now send a verification email before any alert and hold alerts back until
 * someone uses it. The card says so and links to the docs section that
 * explains how to read that email on the monitor. The docs side of the link
 * (the anchor exists on the page) is in
 * App/Tests/FeatureSet/Docs/IncomingEmailMonitorDocs.test.ts.
 */

let mockInboundEmailDomain: string | undefined = "inbound.example.com";

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  const config: Record<string, unknown> = {
    ...actual,
    __esModule: true,
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
import ObjectID from "../../../Types/ObjectID";

const SECRET_KEY: ObjectID = new ObjectID(
  "5ec2e7a1-0b1c-4d2e-9f30-4a5b6c7d8e9f",
);

afterEach(() => {
  cleanup();
  mockInboundEmailDomain = "inbound.example.com";
});

describe("The Incoming Email Address card", () => {
  test("says a sender may verify the address first, and links to how", () => {
    render(<IncomingEmailMonitorLink secretKey={SECRET_KEY} />);

    expect(
      screen.getByText(`monitor-${SECRET_KEY.toString()}@inbound.example.com`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/such as Azure Monitor action groups, send a/),
    ).toHaveTextContent(
      "Some services, such as Azure Monitor action groups, send a verification email before they deliver any alerts. It shows up on this monitor's Overview page like any other email.",
    );

    const link: HTMLElement = screen
      .getByText("How to verify the address")
      .closest("a")!;

    expect(link).toHaveAttribute("href", VERIFY_ADDRESS_DOCS_ROUTE);
    expect(link).toHaveAttribute("target", "_blank");
    expect(VERIFY_ADDRESS_DOCS_ROUTE).toBe(
      "/docs/monitor/incoming-email-monitor#verifying-the-address-with-the-sender",
    );
  });

  test("says it for a custom address too", () => {
    render(
      <IncomingEmailMonitorLink
        secretKey={SECRET_KEY}
        customLocalPart="nightly-backups"
      />,
    );

    expect(
      screen.getByText("nightly-backups@inbound.example.com"),
    ).toBeInTheDocument();
    expect(screen.getByText("How to verify the address")).toBeInTheDocument();
  });

  test("has nothing to verify when the server has no inbound domain", () => {
    mockInboundEmailDomain = undefined;

    render(<IncomingEmailMonitorLink secretKey={SECRET_KEY} />);

    expect(
      screen.getByText(/Inbound email is not configured/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("How to verify the address"),
    ).not.toBeInTheDocument();
  });
});
