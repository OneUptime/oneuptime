import Navigation from "Common/UI/Utils/Navigation";

export const STATUS_PAGE_LOGIN_CODE_STORAGE_KEY: string =
  "oneuptime-status-page-login-code";

type LoginCodeWindow = Window & {
  __ONEUPTIME_STATUS_PAGE_LOGIN_CODE__?: string | undefined;
  __ONEUPTIME_STATUS_PAGE_LOGIN_HANDOFF_PENDING__?: boolean | undefined;
};

export default abstract class LoginCodeUtil {
  /**
   * Read the authorization code captured by the first script in the page
   * head without deleting it. React may call state initializers twice in
   * Strict Mode, so render-time reads must be idempotent.
   */
  public static peek(): string | null {
    const handoffWindow: LoginCodeWindow = window as LoginCodeWindow;
    let loginCode: string | null = Navigation.getQueryStringByName("loginCode");

    try {
      loginCode =
        loginCode ||
        window.sessionStorage.getItem(STATUS_PAGE_LOGIN_CODE_STORAGE_KEY);
    } catch {
      /*
       * Some browser privacy modes disable sessionStorage. The head bootstrap
       * keeps an in-memory fallback for the lifetime of this page instead.
       */
    }

    loginCode =
      loginCode || handoffWindow.__ONEUPTIME_STATUS_PAGE_LOGIN_CODE__ || null;

    return loginCode;
  }

  /**
   * Consume the captured code immediately before its one server exchange.
   */
  public static consume(): string | null {
    const handoffWindow: LoginCodeWindow = window as LoginCodeWindow;
    const loginCode: string | null = LoginCodeUtil.peek();

    try {
      window.sessionStorage.removeItem(STATUS_PAGE_LOGIN_CODE_STORAGE_KEY);
    } catch {
      // See peek(): the in-memory fallback is still cleared below.
    }

    delete handoffWindow.__ONEUPTIME_STATUS_PAGE_LOGIN_CODE__;
    handoffWindow.__ONEUPTIME_STATUS_PAGE_LOGIN_HANDOFF_PENDING__ = false;

    return loginCode;
  }
}
