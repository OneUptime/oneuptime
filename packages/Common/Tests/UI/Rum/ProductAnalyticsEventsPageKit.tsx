import { act, fireEvent, screen } from "@testing-library/react";
import { expect } from "@jest/globals";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import { MockFunction } from "../../MockType";

/*
 * What the Funnels and Retention page suites (issue #6444, part two) share:
 * the application's events as the names read answers them, the reads each
 * page sent, and a way to pick from a dropdown as a reader does. Each suite
 * mocks API, ModelAPI and the chart itself - jest hoists a mock only in the
 * file that declares it.
 */

export const PRODUCT_ANALYTICS_TEST_PROJECT_ID: string =
  "0193a1b2-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
export const PRODUCT_ANALYTICS_TEST_APP_ID: string =
  "0193c0de-1111-4aaa-8bbb-000000000001";

const DAY_MS: number = 24 * 60 * 60 * 1000;

export type ProductAnalyticsTestAnswer = JSONObject | HTTPErrorResponse;

export interface CapturedProductAnalyticsRequest {
  url: string;
  data: JSONObject;
}

/* The application's events, the most frequent first, as the names read answers. */
export function productAnalyticsTestNames(overrides?: JSONObject): JSONObject {
  return {
    events: [
      { kind: "session", name: "", events: 900, users: 300, lastSeenAt: 1 },
      {
        kind: "page",
        name: "/pricing",
        events: 400,
        users: 200,
        lastSeenAt: 1,
      },
      {
        kind: "custom",
        name: "Signed up",
        events: 120,
        users: 100,
        lastSeenAt: 1,
      },
      {
        kind: "custom",
        name: "Purchased",
        events: 80,
        users: 20,
        lastSeenAt: 1,
      },
    ],
    hasMore: false,
    dataStartedAt: Date.now() - 200 * DAY_MS,
    ...overrides,
  };
}

export function respondToProductAnalyticsRead(
  answer: ProductAnalyticsTestAnswer,
): Promise<unknown> {
  if (answer instanceof HTTPErrorResponse) {
    return Promise.resolve(answer);
  }

  return Promise.resolve(new HTTPResponse<JSONObject>(200, answer, {}));
}

/* Answers each read by the last part of its route: "event-names", "funnel". */
export function answerProductAnalyticsReads(
  postMock: MockFunction,
  answers: Record<
    string,
    | ProductAnalyticsTestAnswer
    | ((data: JSONObject) => ProductAnalyticsTestAnswer)
  >,
): void {
  postMock.mockImplementation((...args: Array<unknown>): Promise<unknown> => {
    const request: { url: { toString: () => string }; data: JSONObject } =
      args[0] as { url: { toString: () => string }; data: JSONObject };
    const url: string = request.url.toString();
    const route: string = url.slice(url.lastIndexOf("/") + 1);
    const answer:
      | ProductAnalyticsTestAnswer
      | ((data: JSONObject) => ProductAnalyticsTestAnswer)
      | undefined = answers[route];

    if (answer === undefined) {
      return Promise.reject(new Error(`Unexpected read ${url}`));
    }

    return respondToProductAnalyticsRead(
      typeof answer === "function" ? answer(request.data) : answer,
    );
  });
}

export function productAnalyticsRequestsTo(
  postMock: MockFunction,
  route: string,
): Array<CapturedProductAnalyticsRequest> {
  return postMock.mock.calls
    .map((call: Array<unknown>): CapturedProductAnalyticsRequest => {
      const request: { url: { toString: () => string }; data: JSONObject } =
        call[0] as { url: { toString: () => string }; data: JSONObject };

      return { url: request.url.toString(), data: request.data };
    })
    .filter((request: CapturedProductAnalyticsRequest): boolean => {
      return request.url.endsWith(`/product-analytics/${route}`);
    });
}

export function lastProductAnalyticsRequestTo(
  postMock: MockFunction,
  route: string,
): JSONObject {
  const requests: Array<CapturedProductAnalyticsRequest> =
    productAnalyticsRequestsTo(postMock, route);

  expect(requests.length).toBeGreaterThan(0);

  return requests[requests.length - 1]!.data;
}

/* The options a dropdown offers, opened as a keyboard opens it. */
export function openProductAnalyticsOptions(
  combobox: HTMLElement,
): Array<string> {
  fireEvent.keyDown(combobox, { key: "ArrowDown" });

  return screen.getAllByRole("option").map((option: HTMLElement): string => {
    return (option.textContent || "").trim();
  });
}

export async function chooseProductAnalyticsOption(
  combobox: HTMLElement,
  optionText: string,
): Promise<void> {
  fireEvent.keyDown(combobox, { key: "ArrowDown" });

  const option: HTMLElement | undefined = screen
    .getAllByRole("option")
    .find((candidate: HTMLElement): boolean => {
      return (candidate.textContent || "").trim() === optionText;
    });

  expect(option).toBeDefined();

  await act(async () => {
    fireEvent.mouseDown(option!);
    fireEvent.click(option!);
  });
}
