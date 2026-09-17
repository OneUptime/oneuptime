import { JSONObject } from "../../Types/JSON";

export const authenticationOptions: JSONObject = {
  challenge: "-_8A",
  rpId: "localhost",
  timeout: 60000,
  userVerification: "required",
};

export const registrationOptions: JSONObject = {
  ...authenticationOptions,
  rp: { id: "localhost", name: "OneUptime" },
  user: { id: "AQID", name: "ada@example.com", displayName: "Ada Lovelace" },
  pubKeyCredParams: [{ type: "public-key", alg: -7 }],
  authenticatorSelection: {
    residentKey: "required",
    userVerification: "required",
  },
  excludeCredentials: [
    { id: "-_8A", type: "public-key", transports: ["internal"] },
  ],
};

export default class WebAuthnTestUtil {
  public static buffer(...values: Array<number>): ArrayBuffer {
    return new Uint8Array(values).buffer;
  }

  public static credential(
    isRegistration: boolean = false,
  ): PublicKeyCredential {
    return {
      id: "-_8A",
      rawId: WebAuthnTestUtil.buffer(251, 255, 0),
      type: "public-key",
      authenticatorAttachment: "platform",
      getClientExtensionResults: () => {
        return { credProps: { rk: true } };
      },
      response: isRegistration
        ? {
            clientDataJSON: WebAuthnTestUtil.buffer(1, 2, 3),
            attestationObject: WebAuthnTestUtil.buffer(4, 5, 6),
            getTransports: () => {
              return ["internal", "hybrid"];
            },
          }
        : {
            authenticatorData: WebAuthnTestUtil.buffer(4, 5, 6),
            clientDataJSON: WebAuthnTestUtil.buffer(1, 2, 3),
            signature: WebAuthnTestUtil.buffer(7, 8, 9),
            userHandle: WebAuthnTestUtil.buffer(10, 11, 12),
          },
    } as unknown as PublicKeyCredential;
  }

  public static install(): void {
    Object.defineProperty(window, "PublicKeyCredential", {
      configurable: true,
      value: class {},
      writable: true,
    });
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(navigator, "credentials", {
      configurable: true,
      value: {
        get: async () => {
          return WebAuthnTestUtil.credential();
        },
        create: async () => {
          return WebAuthnTestUtil.credential(true);
        },
      },
    });
  }
}
