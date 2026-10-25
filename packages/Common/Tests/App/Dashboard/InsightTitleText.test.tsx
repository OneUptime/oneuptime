import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "@jest/globals";
import React from "react";
import InsightTitleText from "../../../../App/FeatureSet/Dashboard/src/Components/AIInsights/InsightTitleText";

/*
 * A finding's title, as the inbox, the finding's page and a lane's Logs
 * draw it (InsightTitleText): the names in it may break after their dots and
 * slashes - "http.server.request." / "count" on a phone, never
 * "request.coun" / "t" - and the title reads, and copies, as written.
 */

const TITLE: string =
  "http.server.request.count in checkout records 12,000 different user.id values an hour";

afterEach(() => {
  cleanup();
});

describe("a finding's title", () => {
  test("may break after each dot inside its names, and nowhere it would not read", () => {
    render(
      <h2 data-testid="title">
        <InsightTitleText text={TITLE} />
      </h2>,
    );

    const title: HTMLElement = screen.getByTestId("title");

    expect(title).toHaveTextContent(TITLE);
    expect(title.textContent).toBe(TITLE);
    // http. server. request. and user. - not "12,000".
    expect(title.querySelectorAll("wbr")).toHaveLength(4);
    expect(screen.getByText(TITLE)).toBe(title);
  });

  test("a title with no names in it is drawn as it is", () => {
    render(
      <p data-testid="title">
        <InsightTitleText text="payments sends traces but no metrics" />
      </p>,
    );

    const title: HTMLElement = screen.getByTestId("title");

    expect(title.querySelectorAll("wbr")).toHaveLength(0);
    expect(title.textContent).toBe("payments sends traces but no metrics");
  });

  test("an empty title draws nothing", () => {
    render(
      <p data-testid="title">
        <InsightTitleText text="" />
      </p>,
    );

    expect(screen.getByTestId("title").textContent).toBe("");
  });
});
