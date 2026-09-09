/* global PublicKeyCredentialDescriptor, PublicKeyCredentialRequestOptions, PublicKeyCredentialCreationOptions, PublicKeyCredentialUserEntity */
import { JSONObject } from "../../Types/JSON";

type CredentialDescriptorJSON = Omit<PublicKeyCredentialDescriptor, "id"> & {
  id: string;
};

type RequestOptionsJSON = Omit<
  PublicKeyCredentialRequestOptions,
  "challenge" | "allowCredentials"
> & {
  challenge: string;
  allowCredentials?: Array<CredentialDescriptorJSON>;
};

type CreationOptionsJSON = Omit<
  PublicKeyCredentialCreationOptions,
  "challenge" | "user" | "excludeCredentials"
> & {
  challenge: string;
  user: Omit<PublicKeyCredentialUserEntity, "id"> & { id: string };
  excludeCredentials?: Array<CredentialDescriptorJSON>;
};

// Keep binary conversion in the browser: Buffer is not available on all clients.
export default class WebAuthn {
  private static decode(value: string): ArrayBuffer {
    const binary: string = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(binary, (character: string) => {
      return character.charCodeAt(0);
    }).buffer;
  }

  private static encode(value: ArrayBuffer): string {
    let binary: string = "";
    for (const byte of new Uint8Array(value)) {
      binary += String.fromCharCode(byte);
    }

    return btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/[=]+$/g, "");
  }

  public static ensureSupported(): void {
    if (typeof window !== "undefined" && window.isSecureContext === false) {
      throw new Error(
        "Passkeys require a secure connection. Open OneUptime using HTTPS, or sign in with your password.",
      );
    }

    if (
      typeof PublicKeyCredential === "undefined" ||
      typeof navigator === "undefined" ||
      !navigator.credentials?.get ||
      !navigator.credentials?.create
    ) {
      throw new Error(
        "This browser does not support passkeys. Use a supported browser or sign in with your password.",
      );
    }
  }

  public static async authenticate(options: JSONObject): Promise<JSONObject> {
    WebAuthn.ensureSupported();
    const json: RequestOptionsJSON = options as unknown as RequestOptionsJSON;
    const credential: PublicKeyCredential | null =
      (await navigator.credentials.get({
        publicKey: {
          ...json,
          challenge: WebAuthn.decode(json.challenge),
          ...(json.allowCredentials
            ? {
                allowCredentials: json.allowCredentials.map(
                  (
                    item: CredentialDescriptorJSON,
                  ): PublicKeyCredentialDescriptor => {
                    return { ...item, id: WebAuthn.decode(item.id) };
                  },
                ),
              }
            : {}),
        } as PublicKeyCredentialRequestOptions,
      })) as PublicKeyCredential | null;

    if (!credential) {
      throw new DOMException("No credential was selected.", "NotAllowedError");
    }

    const response: AuthenticatorAssertionResponse =
      credential.response as AuthenticatorAssertionResponse;

    return {
      id: credential.id,
      rawId: WebAuthn.encode(credential.rawId),
      type: credential.type,
      ...(credential.authenticatorAttachment
        ? { authenticatorAttachment: credential.authenticatorAttachment }
        : {}),
      clientExtensionResults:
        credential.getClientExtensionResults() as JSONObject,
      response: {
        authenticatorData: WebAuthn.encode(response.authenticatorData),
        clientDataJSON: WebAuthn.encode(response.clientDataJSON),
        signature: WebAuthn.encode(response.signature),
        userHandle: response.userHandle
          ? WebAuthn.encode(response.userHandle)
          : null,
      },
    };
  }

  public static async register(options: JSONObject): Promise<JSONObject> {
    WebAuthn.ensureSupported();
    const json: CreationOptionsJSON = options as unknown as CreationOptionsJSON;
    const credential: PublicKeyCredential | null =
      (await navigator.credentials.create({
        publicKey: {
          ...json,
          challenge: WebAuthn.decode(json.challenge),
          user: { ...json.user, id: WebAuthn.decode(json.user.id) },
          ...(json.excludeCredentials
            ? {
                excludeCredentials: json.excludeCredentials.map(
                  (
                    item: CredentialDescriptorJSON,
                  ): PublicKeyCredentialDescriptor => {
                    return { ...item, id: WebAuthn.decode(item.id) };
                  },
                ),
              }
            : {}),
        } as PublicKeyCredentialCreationOptions,
      })) as PublicKeyCredential | null;

    if (!credential) {
      throw new DOMException("No credential was created.", "NotAllowedError");
    }

    const response: AuthenticatorAttestationResponse =
      credential.response as AuthenticatorAttestationResponse;

    return {
      id: credential.id,
      rawId: WebAuthn.encode(credential.rawId),
      type: credential.type,
      ...(credential.authenticatorAttachment
        ? { authenticatorAttachment: credential.authenticatorAttachment }
        : {}),
      clientExtensionResults:
        credential.getClientExtensionResults() as JSONObject,
      response: {
        attestationObject: WebAuthn.encode(response.attestationObject),
        clientDataJSON: WebAuthn.encode(response.clientDataJSON),
        transports: response.getTransports?.() || [],
      },
    };
  }

  public static getErrorMessage(
    error: unknown,
    operation: "sign-in" | "registration",
  ): string {
    if (error instanceof Error) {
      if (error.name === "NotAllowedError" || error.name === "AbortError") {
        return operation === "sign-in"
          ? "Passkey sign-in was canceled or timed out. Try again, or sign in with your password."
          : "Passkey registration was canceled or timed out. Try again when you are ready.";
      }

      if (error.name === "InvalidStateError") {
        return "This authenticator is already registered. Choose a different authenticator or use your existing passkey.";
      }
    }

    if (
      error &&
      typeof error === "object" &&
      "message" in error &&
      typeof error.message === "string" &&
      error.message
    ) {
      return error.message;
    }

    return `Unable to complete passkey ${operation}. Please try again.`;
  }
}
