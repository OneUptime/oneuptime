import ObjectID from "../../../Types/ObjectID";
import TabPageId from "../../../UI/Utils/TabPageId";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The public page a browser tab shows - a status page, a public dashboard -
 * read for that tab alone (issue #5277): from the tab's address when it names
 * the page, else from the tab's own memory. Never from the browser's storage,
 * which every tab open on the same host shares.
 */

const PAGE_A: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PAGE_B: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type SetUrlFunction = (url: string) => void;

const setUrl: SetUrlFunction = (url: string): void => {
  window.history.replaceState(window.history.state, "", url);
};

describe("TabPageId.getSegmentValue", () => {
  test.each([
    [`/status-page/${PAGE_A}`, PAGE_A],
    [`/status-page/${PAGE_A}/`, PAGE_A],
    [`/status-page/${PAGE_A}/incidents/123`, PAGE_A],
    [`/status-page/${PAGE_A}?redirectUrl=/status-page/${PAGE_B}`, PAGE_A],
    [`/status-page/${PAGE_A}#/status-page/${PAGE_B}`, PAGE_A],
    ["/status-page/:statusPageId/sso", ":statusPageId"],
    ["/status-page/not-a-page", "not-a-page"],
    ["/status-page/", ""],
  ])("reads the page segment of %s", (path: string, value: string) => {
    expect(TabPageId.getSegmentValue({ path, segment: "status-page" })).toBe(
      value,
    );
  });

  test.each([
    ["/"],
    ["/incidents/123"],
    ["/status-page"],
    // Only an address of the page's own: one that starts with its segment.
    [`/incidents/status-page/${PAGE_A}`],
    [`/public-dashboard/${PAGE_A}`],
    [`?x=/status-page/${PAGE_A}`],
    [""],
  ])("finds no page segment in %s", (path: string) => {
    expect(
      TabPageId.getSegmentValue({ path, segment: "status-page" }),
    ).toBeNull();
  });
});

describe("TabPageId.getIdInPath", () => {
  test("reads a real id", () => {
    expect(
      TabPageId.getIdInPath({
        path: `/status-page/${PAGE_A}/subscribe/email`,
        segment: "status-page",
      })?.toString(),
    ).toBe(PAGE_A);
  });

  test("keeps an id in lower case, as the API writes it", () => {
    expect(
      TabPageId.getIdInPath({
        path: `/status-page/${PAGE_A.toUpperCase()}`,
        segment: "status-page",
      })?.toString(),
    ).toBe(PAGE_A);
  });

  test.each([
    // A route's own placeholder, left in an address by a link built unfilled.
    ["/status-page/:statusPageId"],
    ["/status-page/not-found"],
    ["/status-page/"],
    [`/status-page/${PAGE_A}x`],
    ["/incidents"],
  ])("names no page in %s", (path: string) => {
    expect(TabPageId.getIdInPath({ path, segment: "status-page" })).toBeNull();
  });

  test("reads only its own app's addresses", () => {
    expect(
      TabPageId.getIdInPath({
        path: `/public-dashboard/${PAGE_A}`,
        segment: "public-dashboard",
      })?.toString(),
    ).toBe(PAGE_A);
    expect(
      TabPageId.getIdInPath({
        path: `/public-dashboard/${PAGE_A}`,
        segment: "status-page",
      }),
    ).toBeNull();
  });
});

describe("TabPageId in a tab", () => {
  let pageInTab: TabPageId;

  beforeEach(() => {
    pageInTab = new TabPageId("status-page");
    localStorage.clear();
    sessionStorage.clear();
    setUrl("/");
  });

  afterEach(() => {
    jest.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    setUrl("/");
  });

  test("knows no page before the address names one or the tab resolves one", () => {
    expect(pageInTab.get()).toBeNull();
    expect(pageInTab.getIdInAddress()).toBeNull();
    expect(pageInTab.getResolved()).toBeNull();
  });

  test("is the page its address names", () => {
    setUrl(`/status-page/${PAGE_A}/incidents`);

    expect(pageInTab.get()?.toString()).toBe(PAGE_A);
    expect(pageInTab.getIdInAddress()?.toString()).toBe(PAGE_A);
  });

  test("is the page it resolved, on an address that names none (a custom domain)", () => {
    setUrl("/incidents");
    pageInTab.set(new ObjectID(PAGE_B));

    expect(pageInTab.get()?.toString()).toBe(PAGE_B);
    expect(pageInTab.getIdInAddress()).toBeNull();
  });

  test("the address wins over what the tab resolved", () => {
    pageInTab.set(new ObjectID(PAGE_B));
    setUrl(`/status-page/${PAGE_A}`);

    expect(pageInTab.get()?.toString()).toBe(PAGE_A);
    expect(pageInTab.getResolved()?.toString()).toBe(PAGE_B);
  });

  test("an address with a placeholder for the page falls back to the page the tab resolved", () => {
    pageInTab.set(new ObjectID(PAGE_B));
    setUrl("/status-page/:statusPageId");

    expect(pageInTab.get()?.toString()).toBe(PAGE_B);
  });

  test("keeps what it resolves in lower case, trimmed, from an ObjectID or a string", () => {
    pageInTab.set(new ObjectID(` ${PAGE_A.toUpperCase()} `));
    expect(pageInTab.getResolved()?.toString()).toBe(PAGE_A);

    pageInTab.set(PAGE_B);
    expect(pageInTab.getResolved()?.toString()).toBe(PAGE_B);
  });

  test.each([[null], [undefined], [""], ["   "]])(
    "forgets the page it resolved when set to %p",
    (value: string | null | undefined) => {
      pageInTab.set(PAGE_A);
      pageInTab.set(value);

      expect(pageInTab.getResolved()).toBeNull();
      expect(pageInTab.get()).toBeNull();
    },
  );

  test("hands out a copy: changing what it returned changes nothing", () => {
    pageInTab.set(PAGE_A);

    const returned: ObjectID = pageInTab.get()!;
    returned.id = PAGE_B;

    expect(pageInTab.get()?.toString()).toBe(PAGE_A);
  });

  test("never reads or writes the browser's storage", () => {
    const setItem: ReturnType<typeof jest.spyOn> = jest.spyOn(
      Storage.prototype,
      "setItem",
    );
    const getItem: ReturnType<typeof jest.spyOn> = jest.spyOn(
      Storage.prototype,
      "getItem",
    );

    pageInTab.set(PAGE_A);
    setUrl(`/status-page/${PAGE_A}`);
    pageInTab.get();
    pageInTab.getResolved();
    pageInTab.isAnotherPagesPath(`/status-page/${PAGE_B}`);

    expect(setItem).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
  });

  test("what another tab keeps on the same host changes nothing", () => {
    setUrl("/");
    pageInTab.set(PAGE_A);

    // The key the apps used to share, written as another tab would write it.
    localStorage.setItem("statusPageId", PAGE_B);
    sessionStorage.setItem("statusPageId", PAGE_B);
    window.dispatchEvent(
      new StorageEvent("storage", { key: "statusPageId", newValue: PAGE_B }),
    );

    expect(pageInTab.get()?.toString()).toBe(PAGE_A);
  });

  test("two apps' pages are kept apart", () => {
    const dashboardInTab: TabPageId = new TabPageId("public-dashboard");

    pageInTab.set(PAGE_A);
    dashboardInTab.set(PAGE_B);

    expect(pageInTab.get()?.toString()).toBe(PAGE_A);
    expect(dashboardInTab.get()?.toString()).toBe(PAGE_B);

    setUrl(`/public-dashboard/${PAGE_A}`);

    expect(dashboardInTab.get()?.toString()).toBe(PAGE_A);
    expect(pageInTab.get()?.toString()).toBe(PAGE_A);
    expect(pageInTab.getIdInAddress()).toBeNull();
  });
});

describe("TabPageId.isAnotherPagesPath", () => {
  let pageInTab: TabPageId;

  beforeEach(() => {
    pageInTab = new TabPageId("status-page");
    setUrl("/");
  });

  afterEach(() => {
    setUrl("/");
  });

  test.each([
    [`/status-page/${PAGE_B}`],
    [`/status-page/${PAGE_B}/subscribe/email`],
    [`/status-page/${PAGE_B}?redirectUrl=/status-page/${PAGE_A}`],
    // Something under the page segment that is not this page is another one.
    ["/status-page/not-a-page/incidents"],
    ["/status-page/:statusPageId"],
  ])("on its own page's address, %s is another page's", (path: string) => {
    setUrl(`/status-page/${PAGE_A}`);

    expect(pageInTab.isAnotherPagesPath(path)).toBe(true);
  });

  test.each([
    [`/status-page/${PAGE_A}`],
    [`/status-page/${PAGE_A}/incidents/123`],
    [`/status-page/${PAGE_A.toUpperCase()}/incidents`],
    [`/status-page/${PAGE_A}?tab=timeline#note`],
    ["/incidents/123"],
    ["/"],
    ["/status-page/"],
    [`/public-dashboard/${PAGE_B}`],
  ])("on its own page's address, %s is not another page's", (path: string) => {
    setUrl(`/status-page/${PAGE_A}`);

    expect(pageInTab.isAnotherPagesPath(path)).toBe(false);
  });

  test("on a custom domain, its own preview address is its own, another page's is not", () => {
    setUrl("/");
    pageInTab.set(PAGE_A);

    expect(pageInTab.isAnotherPagesPath(`/status-page/${PAGE_A}/x`)).toBe(
      false,
    );
    expect(pageInTab.isAnotherPagesPath(`/status-page/${PAGE_B}`)).toBe(true);
    expect(pageInTab.isAnotherPagesPath("/incidents")).toBe(false);
  });

  test("a tab that does not know its page yet cannot tell, and says no", () => {
    expect(pageInTab.isAnotherPagesPath(`/status-page/${PAGE_B}`)).toBe(false);
    expect(pageInTab.isAnotherPagesPath("/incidents")).toBe(false);
  });
});
