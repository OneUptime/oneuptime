export interface MobilePasskeyRequest {
  state: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
}

const STATE_PATTERN: RegExp = /^[A-Za-z0-9._~-]{43,128}$/;
const CODE_PATTERN: RegExp = /^[A-Za-z0-9_-]{43}$/;
// Reject control characters before URL parsing can silently remove them.
// eslint-disable-next-line no-control-regex
const CALLBACK_CONTROL_PATTERN: RegExp = /[\u0000-\u0020\u007F]/;
const CALLBACK_URL: string = "oneuptime://passkey";

export default class MobilePasskey {
  public static getRequest(search: string): MobilePasskeyRequest | null {
    const params: URLSearchParams = new URLSearchParams(search);
    const keys: Array<string> = [
      "state",
      "codeChallenge",
      "codeChallengeMethod",
    ];
    if (
      keys.some((key: string): boolean => {
        return params.getAll(key).length !== 1;
      }) ||
      Array.from(params.keys()).some((key: string): boolean => {
        return !keys.includes(key);
      })
    ) {
      return null;
    }

    const state: string = params.get("state") || "";
    const codeChallenge: string = params.get("codeChallenge") || "";
    if (
      STATE_PATTERN.exec(state)?.[0] !== state ||
      codeChallenge.length !== 43 ||
      !CODE_PATTERN.test(codeChallenge) ||
      params.get("codeChallengeMethod") !== "S256"
    ) {
      return null;
    }
    return { state, codeChallenge, codeChallengeMethod: "S256" };
  }

  public static validateCallback(
    value: unknown,
    request: MobilePasskeyRequest,
    serverOrigin: string,
  ): string | null {
    if (typeof value !== "string" || CALLBACK_CONTROL_PATTERN.test(value)) {
      return null;
    }
    try {
      const url: URL = new URL(value);
      const keys: Array<string> = ["code", "state", "serverOrigin"];
      if (
        url.protocol !== "oneuptime:" ||
        url.hostname !== "passkey" ||
        url.pathname !== "" ||
        url.port ||
        url.username ||
        url.password ||
        url.hash ||
        keys.some((key: string): boolean => {
          return url.searchParams.getAll(key).length !== 1;
        }) ||
        Array.from(url.searchParams.keys()).some((key: string): boolean => {
          return !keys.includes(key);
        }) ||
        CODE_PATTERN.exec(url.searchParams.get("code") || "")?.[0] !==
          url.searchParams.get("code") ||
        url.searchParams.get("state") !== request.state ||
        url.searchParams.get("serverOrigin") !== serverOrigin
      ) {
        return null;
      }
      return url.toString();
    } catch {
      return null;
    }
  }

  public static cancelCallback(
    request: MobilePasskeyRequest,
    serverOrigin: string,
  ): string {
    const url: URL = new URL(CALLBACK_URL);
    url.searchParams.set("error", "access_denied");
    url.searchParams.set("state", request.state);
    url.searchParams.set("serverOrigin", serverOrigin);
    return url.toString();
  }

  public static returnToApp(callbackUrl: string): void {
    window.location.assign(callbackUrl);
  }
}
