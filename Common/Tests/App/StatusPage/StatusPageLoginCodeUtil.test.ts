import LoginCodeUtil, {
  STATUS_PAGE_LOGIN_CODE_STORAGE_KEY,
} from "../../../../App/FeatureSet/StatusPage/src/Utils/LoginCode";
import { beforeEach, describe, expect, it } from "@jest/globals";

type HandoffWindow = Window & {
  __ONEUPTIME_STATUS_PAGE_LOGIN_CODE__?: string | undefined;
  __ONEUPTIME_STATUS_PAGE_LOGIN_HANDOFF_PENDING__?: boolean | undefined;
};

const handoffWindow: HandoffWindow = window as HandoffWindow;

describe("Status Page login-code consumption", () => {
  beforeEach(() => {
    window.history.replaceState(window.history.state, "", "/");
    window.sessionStorage.clear();
    delete handoffWindow.__ONEUPTIME_STATUS_PAGE_LOGIN_CODE__;
    delete handoffWindow.__ONEUPTIME_STATUS_PAGE_LOGIN_HANDOFF_PENDING__;
  });

  it("consumes the code captured in sessionStorage exactly once", () => {
    window.sessionStorage.setItem(
      STATUS_PAGE_LOGIN_CODE_STORAGE_KEY,
      "captured-code",
    );
    handoffWindow.__ONEUPTIME_STATUS_PAGE_LOGIN_HANDOFF_PENDING__ = true;

    expect(LoginCodeUtil.consume()).toBe("captured-code");
    expect(LoginCodeUtil.consume()).toBeNull();
    expect(
      window.sessionStorage.getItem(STATUS_PAGE_LOGIN_CODE_STORAGE_KEY),
    ).toBeNull();
    expect(handoffWindow.__ONEUPTIME_STATUS_PAGE_LOGIN_HANDOFF_PENDING__).toBe(
      false,
    );
  });

  it("can be read repeatedly during React Strict Mode initialization", () => {
    window.sessionStorage.setItem(
      STATUS_PAGE_LOGIN_CODE_STORAGE_KEY,
      "strict-mode-code",
    );

    expect(LoginCodeUtil.peek()).toBe("strict-mode-code");
    expect(LoginCodeUtil.peek()).toBe("strict-mode-code");
    expect(
      window.sessionStorage.getItem(STATUS_PAGE_LOGIN_CODE_STORAGE_KEY),
    ).toBe("strict-mode-code");
  });

  it("uses and deletes the in-memory fallback when storage is unavailable", () => {
    handoffWindow.__ONEUPTIME_STATUS_PAGE_LOGIN_CODE__ = "memory-code";

    expect(LoginCodeUtil.consume()).toBe("memory-code");
    expect(handoffWindow.__ONEUPTIME_STATUS_PAGE_LOGIN_CODE__).toBeUndefined();
  });

  it("accepts a query code when the early bootstrap is not present", () => {
    window.history.replaceState(
      window.history.state,
      "",
      "/?loginCode=query-code",
    );

    expect(LoginCodeUtil.consume()).toBe("query-code");
  });

  it("prefers the current query handoff over stale stored state and clears both", () => {
    window.history.replaceState(
      window.history.state,
      "",
      "/?loginCode=fresh-code",
    );
    window.sessionStorage.setItem(
      STATUS_PAGE_LOGIN_CODE_STORAGE_KEY,
      "stale-code",
    );

    expect(LoginCodeUtil.consume()).toBe("fresh-code");
    expect(
      window.sessionStorage.getItem(STATUS_PAGE_LOGIN_CODE_STORAGE_KEY),
    ).toBeNull();
  });
});
