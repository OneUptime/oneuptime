import axios from "axios";
import { exchangePasskeyCode, LoginResponse } from "./auth";
import apiClient from "./client";
import { storeTokens } from "../storage/keychain";
import serializedPasskeyUser from "../../../Common/Tests/Fixtures/MobilePasskeyUser.json";

jest.mock("./client", () => {
  return { __esModule: true, default: { post: jest.fn() } };
});
jest.mock("../storage/keychain", () => {
  return { storeTokens: jest.fn() };
});

const params: Parameters<typeof exchangePasskeyCode>[0] = {
  serverOrigin: "https://selfhosted.example.com:8443",
  code: "c".repeat(43),
  state: "s".repeat(64),
  codeVerifier: "v".repeat(64),
  signal: new AbortController().signal,
};
function body(): Record<string, unknown> {
  return {
    ...serializedPasskeyUser,
    _miscData: {
      accessToken: "access",
      refreshToken: "refresh",
      refreshTokenExpiresAt: "2027-01-01T00:00:00.000Z",
    },
  };
}
beforeEach(() => {
  jest.spyOn(axios, "post").mockResolvedValue({ data: body() });
});
afterEach(() => {
  jest.restoreAllMocks();
});

test("exchanges a code in the POST body using the original server and cancellable request", async () => {
  await exchangePasskeyCode(params);
  expect(axios.post).toHaveBeenCalledWith(
    "https://selfhosted.example.com:8443/identity/mobile-passkey-exchange",
    {
      code: params.code,
      codeVerifier: params.codeVerifier,
      state: params.state,
    },
    {
      timeout: 30000,
      signal: params.signal,
      headers: { "Content-Type": "application/json" },
    },
  );
  expect(apiClient.post).not.toHaveBeenCalled();
  expect(storeTokens).not.toHaveBeenCalled();
});

test("normalizes the User response and returns all session fields for guarded persistence", async () => {
  const response: LoginResponse = await exchangePasskeyCode(params);
  expect(response).toEqual({
    accessToken: "access",
    refreshToken: "refresh",
    refreshTokenExpiresAt: "2027-01-01T00:00:00.000Z",
    user: {
      _id: "11111111-1111-4111-8111-111111111111",
      email: "passkey@example.com",
      name: "Passkey Tester",
      isMasterAdmin: false,
    },
  });
});

test.each(["accessToken", "refreshToken", "refreshTokenExpiresAt"])(
  "refuses a partial session missing %s",
  async (key: string) => {
    const data: Record<string, unknown> = body();
    delete (data["_miscData"] as Record<string, unknown>)[key];
    jest.mocked(axios.post).mockResolvedValue({ data });
    await expect(exchangePasskeyCode(params)).rejects.toThrow(
      /did not complete/,
    );
    expect(storeTokens).not.toHaveBeenCalled();
  },
);

test.each([
  null,
  {},
  {
    _miscData: {
      accessToken: "a",
      refreshToken: "r",
      refreshTokenExpiresAt: "2027-01-01",
    },
  },
  {
    _id: "u",
    _miscData: {
      accessToken: {},
      refreshToken: "r",
      refreshTokenExpiresAt: "never",
    },
  },
])("refuses malformed success payload %#", async (data: unknown) => {
  jest.mocked(axios.post).mockResolvedValue({ data });
  await expect(exchangePasskeyCode(params)).rejects.toThrow(/did not complete/);
});

test("rejects a wrapped user object that does not match the server entity contract", async () => {
  jest.mocked(axios.post).mockResolvedValue({
    data: {
      data: serializedPasskeyUser,
      _miscData: body()["_miscData"],
    },
  });
  await expect(exchangePasskeyCode(params)).rejects.toThrow(/did not complete/);
  expect(storeTokens).not.toHaveBeenCalled();
});

test("does not conceal a server refusal or automatically replay a spent code", async () => {
  jest.mocked(axios.post).mockRejectedValue(new Error("expired"));
  await expect(exchangePasskeyCode(params)).rejects.toThrow("expired");
  expect(axios.post).toHaveBeenCalledTimes(1);
  expect(storeTokens).not.toHaveBeenCalled();
});
