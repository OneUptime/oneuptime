import Navigation from "../../../UI/Utils/Navigation";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * `Navigation.setQueryString` is the single write path for every piece of URL
 * state in the app (table filters, facets, sort/pagination, the telemetry
 * explorers). Its exact semantics are load-bearing:
 *
 *  - it must MERGE, so one component writing its params never deletes another
 *    component's params from the same route;
 *  - it must use `replaceState`, so dragging a filter around doesn't bury the
 *    "back to the list" entry under a hundred history entries;
 *  - it must pass the CURRENT `history.state` through, because that object is
 *    react-router's `{usr, key, idx}` bookkeeping — replacing it with `null`
 *    corrupts the router's history index;
 *  - and it must leave the pathname and hash alone.
 */

type SetUrlFunction = (url: string) => void;

const setUrl: SetUrlFunction = (url: string): void => {
  window.history.replaceState(window.history.state, "", url);
};

describe("Navigation URL query string helpers", () => {
  beforeEach(() => {
    setUrl("/dashboard/monitors");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("getQueryString", () => {
    test("returns the raw search string including the leading ?", () => {
      setUrl("/dashboard/monitors?a=1&b=2");

      expect(Navigation.getQueryString()).toBe("?a=1&b=2");
    });

    test("returns an empty string when there is no query", () => {
      expect(Navigation.getQueryString()).toBe("");
    });
  });

  describe("getQueryStringByName", () => {
    test("reads a param and percent-decodes it", () => {
      setUrl(`/dashboard/monitors?q=${encodeURIComponent('{"a":"b c"}')}`);

      expect(Navigation.getQueryStringByName("q")).toBe('{"a":"b c"}');
    });

    test("returns null for a missing param", () => {
      setUrl("/dashboard/monitors?other=1");

      expect(Navigation.getQueryStringByName("q")).toBeNull();
    });

    test("returns null for a present-but-empty param", () => {
      setUrl("/dashboard/monitors?q=");

      expect(Navigation.getQueryStringByName("q")).toBeNull();
    });
  });

  describe("setQueryString", () => {
    test("adds a param without touching the ones already there", () => {
      setUrl("/dashboard/monitors?existing=keepme");

      Navigation.setQueryString({ added: "value" });

      expect(Navigation.getQueryStringByName("existing")).toBe("keepme");
      expect(Navigation.getQueryStringByName("added")).toBe("value");
    });

    test("overwrites only the named param", () => {
      setUrl("/dashboard/monitors?a=1&b=2");

      Navigation.setQueryString({ a: "9" });

      expect(Navigation.getQueryStringByName("a")).toBe("9");
      expect(Navigation.getQueryStringByName("b")).toBe("2");
    });

    test("deletes a param when the value is null", () => {
      setUrl("/dashboard/monitors?a=1&b=2");

      Navigation.setQueryString({ a: null });

      expect(Navigation.getQueryStringByName("a")).toBeNull();
      expect(Navigation.getQueryStringByName("b")).toBe("2");
    });

    test("deletes a param when the value is an empty string", () => {
      setUrl("/dashboard/monitors?a=1");

      Navigation.setQueryString({ a: "" });

      expect(Navigation.getQueryStringByName("a")).toBeNull();
    });

    test("applies several params in one call", () => {
      setUrl("/dashboard/monitors?keep=1&drop=2");

      Navigation.setQueryString({ drop: null, one: "1", two: "2" });

      expect(Navigation.getQueryStringByName("keep")).toBe("1");
      expect(Navigation.getQueryStringByName("drop")).toBeNull();
      expect(Navigation.getQueryStringByName("one")).toBe("1");
      expect(Navigation.getQueryStringByName("two")).toBe("2");
    });

    test("leaves the pathname and hash intact", () => {
      setUrl("/dashboard/monitors/abc#section-two");

      Navigation.setQueryString({ a: "1" });

      expect(window.location.pathname).toBe("/dashboard/monitors/abc");
      expect(window.location.hash).toBe("#section-two");
      expect(Navigation.getQueryStringByName("a")).toBe("1");
    });

    test("drops the '?' entirely when the last param is removed", () => {
      setUrl("/dashboard/monitors?only=1");

      Navigation.setQueryString({ only: null });

      expect(window.location.search).toBe("");
    });

    test("round-trips a value containing URL-significant characters", () => {
      const value: string = '{"name":{"_type":"Search","value":"a&b=c d"}}';

      Navigation.setQueryString({ q: value });

      expect(Navigation.getQueryStringByName("q")).toBe(value);
    });

    test("replaces the current history entry instead of pushing a new one", () => {
      const lengthBefore: number = window.history.length;

      Navigation.setQueryString({ a: "1" });
      Navigation.setQueryString({ a: "2" });
      Navigation.setQueryString({ a: "3" });

      expect(window.history.length).toBe(lengthBefore);
    });

    test("preserves history.state so react-router's bookkeeping survives", () => {
      const routerState: { usr: null; key: string; idx: number } = {
        usr: null,
        key: "abc123",
        idx: 4,
      };
      window.history.replaceState(routerState, "", "/dashboard/monitors");

      Navigation.setQueryString({ a: "1" });

      expect(window.history.state).toEqual(routerState);
    });

    test("swallows the SecurityError Safari throws when replaceState is called too often", () => {
      const replaceState: ReturnType<typeof jest.spyOn> = jest
        .spyOn(window.history, "replaceState")
        .mockImplementation(() => {
          throw new Error("SecurityError: too many calls to replaceState");
        });

      expect(() => {
        Navigation.setQueryString({ a: "1" });
      }).not.toThrow();

      expect(replaceState).toHaveBeenCalled();
    });
  });
});
