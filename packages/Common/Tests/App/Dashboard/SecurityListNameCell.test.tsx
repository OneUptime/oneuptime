import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import SecurityListNameCell, {
  SECURITY_LIST_NAME_COLUMN_MAX_WIDTH_CLASS_NAME,
  SECURITY_LIST_NAME_DETAIL_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityListNameCell";

/*
 * A SECURITY EVENTS ROW'S NAME, WITH WHAT IT IS UNDER IT
 * (SecurityListNameCell): a threat intel feed's source, a security tool's
 * provider and what it imports. Threat Intel Feeds and Your security tools
 * gave each a column of its own and ran past their cards at 1280 (#5246);
 * one column now holds both, as Send to your SIEM names each SIEM.
 */

afterEach(() => {
  cleanup();
});

describe("SecurityListNameCell", () => {
  test("draws the name, and what the row is under it in the smaller, quieter type", () => {
    render(
      <SecurityListNameCell
        name="Corporate MISP"
        detailParts={["TAXII collection"]}
        detailTestId="threat-intel-feed-source-cell"
      />,
    );

    const name: HTMLElement = screen.getByTestId("security-list-name");
    const detail: HTMLElement = screen.getByTestId(
      "threat-intel-feed-source-cell",
    );

    expect(name).toHaveTextContent("Corporate MISP");
    expect(detail).toHaveTextContent("TAXII collection");
    expect(detail).toHaveClass("block", "text-xs", "text-gray-500");
    // One cell: the detail follows the name in it, on a line of its own.
    expect(screen.getByTestId("security-list-name-cell")).toHaveTextContent(
      "Corporate MISPTAXII collection",
    );
    expect(name.compareDocumentPosition(detail)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  test("its parts are joined by a dot, and the line breaks only between them", () => {
    render(
      <SecurityListNameCell
        name="Customer SecOps"
        detailParts={["Google SecOps", "Alerts only"]}
        detailTestId="security-event-connection-provider"
      />,
    );

    const detail: HTMLElement = screen.getByTestId(
      "security-event-connection-provider",
    );

    expect(detail).toHaveTextContent("Google SecOps · Alerts only");

    const parts: Array<Element> = Array.from(
      detail.querySelectorAll(".whitespace-nowrap"),
    );

    expect(
      parts.map((part: Element): string => {
        return part.textContent || "";
      }),
    ).toEqual(["Google SecOps ·", "Alerts only"]);
  });

  test("an empty part is left out, and with none there is no line under the name", () => {
    const { unmount } = render(
      <SecurityListNameCell
        name="Okta production"
        detailParts={["Okta System Log", undefined, "  "]}
        detailTestId="detail"
      />,
    );

    expect(screen.getByTestId("detail")).toHaveTextContent("Okta System Log");
    expect(screen.getByTestId("detail")).not.toHaveTextContent("·");
    unmount();

    render(
      <SecurityListNameCell
        name="Okta production"
        detailParts={[]}
        detailTestId="detail"
      />,
    );

    expect(screen.queryByTestId("detail")).toBeNull();
    expect(screen.getByTestId("security-list-name")).toHaveTextContent(
      "Okta production",
    );
  });

  test("a name someone gave reads the way it is written, on any page", () => {
    render(
      <SecurityListNameCell
        name="Checkout API (EU)."
        detailParts={["List of indicators"]}
      />,
    );

    const isolate: HTMLElement | null = screen
      .getByTestId("security-list-name")
      .querySelector("bdi");

    expect(isolate).not.toBeNull();
    expect(isolate).toHaveAttribute("dir", "ltr");
    expect(isolate).toHaveTextContent("Checkout API (EU).");
  });

  test("the column it sits in wraps a long name up to 16rem, and the detail in the type of a hint", () => {
    expect(SECURITY_LIST_NAME_COLUMN_MAX_WIDTH_CLASS_NAME).toBe(
      "max-w-[16rem]",
    );
    expect(SECURITY_LIST_NAME_DETAIL_CLASS_NAME.split(" ")).toEqual(
      expect.arrayContaining([
        "block",
        "whitespace-normal",
        "text-xs",
        "font-normal",
        "text-gray-500",
      ]),
    );
  });
});
