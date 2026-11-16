import { describe, expect, test } from "@jest/globals";
import { isRefusedSelect } from "./refusedSelect";

/*
 * A server older than a column answers a select that names it with a bad
 * request. That, and only that, sends a read back for another try without
 * the column (api/monitors, api/onCallPages): every other failure is the
 * read's own error, for its screen to say.
 */

function axiosError(status: number): Error {
  return Object.assign(new Error(`Request failed with status ${status}`), {
    isAxiosError: true,
    response: { status, data: {} },
  });
}

describe("isRefusedSelect", () => {
  test("a bad request from the server is a refused select", () => {
    expect(isRefusedSelect(axiosError(400))).toBe(true);
  });

  test.each([401, 403, 404, 406, 429, 500, 503])(
    "a %s is not: it is the read's own error",
    (status: number) => {
      expect(isRefusedSelect(axiosError(status))).toBe(false);
    },
  );

  test("a failure without a response - no signal, a timeout - is not", () => {
    expect(
      isRefusedSelect(
        Object.assign(new Error("Network Error"), { isAxiosError: true }),
      ),
    ).toBe(false);
    expect(isRefusedSelect(new Error("Network Error"))).toBe(false);
  });

  test("an error that only looks like a 400 is not", () => {
    expect(isRefusedSelect({ response: { status: 400 } })).toBe(false);
    expect(isRefusedSelect(null)).toBe(false);
    expect(isRefusedSelect(undefined)).toBe(false);
    expect(isRefusedSelect("400")).toBe(false);
  });
});
