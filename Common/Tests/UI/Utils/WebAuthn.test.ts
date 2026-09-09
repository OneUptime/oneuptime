import { SpyInstance } from "jest-mock";
/* global PublicKeyCredentialRequestOptions, PublicKeyCredentialDescriptor, PublicKeyCredentialCreationOptions */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import WebAuthn from "../../../UI/Utils/WebAuthn";
import { JSONObject } from "../../../Types/JSON";
import WebAuthnTestUtil, {
  authenticationOptions,
  registrationOptions,
} from "../../Utils/WebAuthnTestUtil";

describe("WebAuthn browser boundary", () => {
  beforeEach(() => {
    WebAuthnTestUtil.install();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("decodes base64url challenge and leaves discoverable credentials unrestricted", async () => {
    const get: SpyInstance<typeof navigator.credentials.get> = jest.spyOn(
      navigator.credentials,
      "get",
    );
    await WebAuthn.authenticate(authenticationOptions);
    const request: PublicKeyCredentialRequestOptions =
      get.mock.calls[0]![0]!.publicKey!;
    expect(new Uint8Array(request.challenge as ArrayBuffer)).toEqual(
      new Uint8Array([251, 255, 0]),
    );
    expect(request.allowCredentials).toBeUndefined();
    expect(request.userVerification).toBe("required");
    expect(authenticationOptions["challenge"]).toBe("-_8A");
  });

  test("preserves allowCredentials and transports for existing security key MFA", async () => {
    const get: SpyInstance<typeof navigator.credentials.get> = jest.spyOn(
      navigator.credentials,
      "get",
    );
    await WebAuthn.authenticate({
      ...authenticationOptions,
      allowCredentials: [
        { type: "public-key", id: "-_8A", transports: ["usb"] },
      ],
    });
    const descriptor: PublicKeyCredentialDescriptor =
      get.mock.calls[0]![0]!.publicKey!.allowCredentials![0]!;
    expect(new Uint8Array(descriptor.id as ArrayBuffer)).toEqual(
      new Uint8Array([251, 255, 0]),
    );
    expect(descriptor.transports).toEqual(["usb"]);
  });

  test("serializes every assertion byte, user handle, attachment and extension", async () => {
    expect(await WebAuthn.authenticate(authenticationOptions)).toEqual({
      id: "-_8A",
      rawId: "-_8A",
      type: "public-key",
      authenticatorAttachment: "platform",
      clientExtensionResults: { credProps: { rk: true } },
      response: {
        authenticatorData: "BAUG",
        clientDataJSON: "AQID",
        signature: "BwgJ",
        userHandle: "CgsM",
      },
    });
  });

  test("serializes a nullable userHandle without inventing bytes", async () => {
    const credential: PublicKeyCredential = WebAuthnTestUtil.credential();
    Object.defineProperty(credential.response, "userHandle", { value: null });
    jest.spyOn(navigator.credentials, "get").mockResolvedValue(credential);
    const result: JSONObject = await WebAuthn.authenticate(
      authenticationOptions,
    );
    expect((result["response"] as JSONObject)["userHandle"]).toBeNull();
  });

  test("decodes registration challenge, user id and excluded credentials without changing selection rules", async () => {
    const create: SpyInstance<typeof navigator.credentials.create> = jest.spyOn(
      navigator.credentials,
      "create",
    );
    await WebAuthn.register(registrationOptions);
    const request: PublicKeyCredentialCreationOptions =
      create.mock.calls[0]![0]!.publicKey!;
    expect(new Uint8Array(request.challenge as ArrayBuffer)).toEqual(
      new Uint8Array([251, 255, 0]),
    );
    expect(new Uint8Array(request.user.id as ArrayBuffer)).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(
      new Uint8Array(request.excludeCredentials![0]!.id as ArrayBuffer),
    ).toEqual(new Uint8Array([251, 255, 0]));
    expect(request.excludeCredentials![0]!.transports).toEqual(["internal"]);
    expect(request.authenticatorSelection).toEqual({
      residentKey: "required",
      userVerification: "required",
    });
    expect((registrationOptions["user"] as JSONObject)["id"]).toBe("AQID");
  });

  test("sends the attestation, transports and resident key extension to registration verification", async () => {
    expect(await WebAuthn.register(registrationOptions)).toEqual({
      id: "-_8A",
      rawId: "-_8A",
      type: "public-key",
      authenticatorAttachment: "platform",
      clientExtensionResults: { credProps: { rk: true } },
      response: {
        attestationObject: "BAUG",
        clientDataJSON: "AQID",
        transports: ["internal", "hybrid"],
      },
    });
  });

  test("supports authenticators that omit transports and attachment", async () => {
    const credential: PublicKeyCredential = WebAuthnTestUtil.credential(true);
    Object.defineProperty(credential.response, "getTransports", {
      value: undefined,
    });
    Object.defineProperty(credential, "authenticatorAttachment", {
      value: null,
    });
    jest.spyOn(navigator.credentials, "create").mockResolvedValue(credential);
    const result: JSONObject = await WebAuthn.register(registrationOptions);
    expect((result["response"] as JSONObject)["transports"]).toEqual([]);
    expect(result["authenticatorAttachment"]).toBeUndefined();
  });

  test("handles a null browser result as cancellation for either ceremony", async () => {
    jest.spyOn(navigator.credentials, "get").mockResolvedValue(null);
    jest.spyOn(navigator.credentials, "create").mockResolvedValue(null);
    await expect(
      WebAuthn.authenticate(authenticationOptions),
    ).rejects.toMatchObject({ name: "NotAllowedError" });
    await expect(WebAuthn.register(registrationOptions)).rejects.toMatchObject({
      name: "NotAllowedError",
    });
  });

  test("reports unsupported browsers and insecure origins before invoking an authenticator", () => {
    Object.defineProperty(window, "PublicKeyCredential", { value: undefined });
    expect(() => {
      WebAuthn.ensureSupported();
    }).toThrow("This browser does not support passkeys");
    Object.defineProperty(window, "isSecureContext", { value: false });
    expect(() => {
      WebAuthn.ensureSupported();
    }).toThrow("Passkeys require a secure connection");
  });

  test.each(["NotAllowedError", "AbortError"])(
    "explains %s with a retry and password fallback",
    (name: string) => {
      const error: DOMException = new DOMException("Browser detail", name);
      expect(WebAuthn.getErrorMessage(error, "sign-in")).toBe(
        "Passkey sign-in was canceled or timed out. Try again, or sign in with your password.",
      );
      expect(WebAuthn.getErrorMessage(error, "registration")).toContain(
        "Try again when you are ready",
      );
    },
  );

  test("explains an already registered authenticator", () => {
    expect(
      WebAuthn.getErrorMessage(
        new DOMException("Duplicate", "InvalidStateError"),
        "registration",
      ),
    ).toContain("already registered");
  });

  test("preserves actionable server errors", () => {
    expect(
      WebAuthn.getErrorMessage(
        new Error("Challenge expired. Please try again."),
        "sign-in",
      ),
    ).toBe("Challenge expired. Please try again.");
  });

  test("keeps an unexpected failure recoverable instead of failing while formatting it", () => {
    expect(WebAuthn.getErrorMessage(null, "sign-in")).toBe(
      "Unable to complete passkey sign-in. Please try again.",
    );
  });
});
