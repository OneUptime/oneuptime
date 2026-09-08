import crypto from "crypto";

/*
 * A stand-in for the security key -- or the platform authenticator built into
 * the laptop -- that a user registers and then signs in with.
 *
 * Everything here is built from the WebAuthn and CTAP specifications using
 * Node's own crypto primitives: the CBOR encoder below, the COSE key, the
 * authenticator data byte layout and the ES256 signature. Nothing in this file
 * imports `@simplewebauthn/server`, and that is the entire point. The server
 * verifies with that library, so a test whose fixtures were also produced by
 * it would prove only that the library agrees with itself -- and would have
 * passed happily throughout issue #3652, while every user on a folded-shut
 * MacBook was unable to register a passkey at all.
 *
 * The most useful knob in here is `performsUserVerification`. A real
 * authenticator sets the UV bit in its authenticator data when it has actually
 * checked who is holding it -- a fingerprint, a face, a PIN, a system password
 * -- and leaves the bit CLEAR when it has no way to. Passing `false` models:
 *
 *   - a MacBook running folded shut on an external display ("clamshell"), the
 *     configuration in the bug report, whose Touch ID sensor is unreachable;
 *   - a plain USB security key with no PIN set;
 *   - Windows Hello on a desktop with no camera and no reader.
 *
 * Every one of those responses is valid, and every one is what the server
 * ASKED for by sending `userVerification: "preferred"`. Which is why the
 * fixture has to be able to produce them.
 */

/*
 * --------------------------------------------------------------------------
 * CBOR, restricted to the handful of types a WebAuthn credential is made of.
 *
 * Attestation objects and COSE keys are CBOR, so producing an attestation the
 * server can parse means encoding it. RFC 8949 is large; this covers unsigned
 * integers, negative integers (COSE labels are negative), byte strings, text
 * strings and maps, which is all of it that appears here.
 * ------------------------------------------------------------------------
 */

export type CborValue = number | string | Buffer | Map<CborValue, CborValue>;

type EncodeCborHeadFunction = (majorType: number, value: number) => Buffer;

const encodeCborHead: EncodeCborHeadFunction = (
  majorType: number,
  value: number,
): Buffer => {
  const type: number = majorType << 5;

  if (value < 24) {
    return Buffer.from([type | value]);
  }

  if (value < 0x100) {
    return Buffer.from([type | 24, value]);
  }

  if (value < 0x10000) {
    const bytes: Buffer = Buffer.alloc(3);
    bytes[0] = type | 25;
    bytes.writeUInt16BE(value, 1);
    return bytes;
  }

  const bytes: Buffer = Buffer.alloc(5);
  bytes[0] = type | 26;
  bytes.writeUInt32BE(value, 1);
  return bytes;
};

export type EncodeCborFunction = (value: CborValue) => Buffer;

export const encodeCbor: EncodeCborFunction = (value: CborValue): Buffer => {
  if (typeof value === "number") {
    /*
     * Major type 0 is a non-negative integer; major type 1 is a negative one
     * encoded as -1 - n, which is how COSE labels such as -2 (the x
     * coordinate) travel.
     */
    return value >= 0
      ? encodeCborHead(0, value)
      : encodeCborHead(1, -value - 1);
  }

  if (typeof value === "string") {
    return Buffer.concat([
      encodeCborHead(3, Buffer.byteLength(value, "utf8")),
      Buffer.from(value, "utf8"),
    ]);
  }

  if (Buffer.isBuffer(value)) {
    return Buffer.concat([encodeCborHead(2, value.length), value]);
  }

  if (value instanceof Map) {
    const parts: Array<Buffer> = [encodeCborHead(5, value.size)];

    for (const [key, entry] of value.entries()) {
      parts.push(encodeCbor(key));
      parts.push(encodeCbor(entry));
    }

    return Buffer.concat(parts);
  }

  throw new Error(`Cannot CBOR encode ${typeof value}`);
};

/*
 * --------------------------------------------------------------------------
 * Encodings the browser uses on the wire.
 * ------------------------------------------------------------------------
 */

export type ToBase64UrlFunction = (bytes: Buffer) => string;

export const toBase64Url: ToBase64UrlFunction = (bytes: Buffer): string => {
  return bytes.toString("base64url");
};

/*
 * --------------------------------------------------------------------------
 * Authenticator data.
 *
 * The flags byte is the whole reason this file exists, so it is spelled out
 * rather than passed in as a number: UP is bit 0, UV is bit 2, BE and BS are
 * bits 3 and 4, and AT -- attested credential data is appended -- is bit 6.
 * ------------------------------------------------------------------------
 */

const FLAG_USER_PRESENT: number = 0x01;
const FLAG_USER_VERIFIED: number = 0x04;
const FLAG_BACKUP_ELIGIBLE: number = 0x08;
const FLAG_BACKED_UP: number = 0x10;
const FLAG_ATTESTED_CREDENTIAL_DATA: number = 0x40;

/** The all-zero AAGUID a "none" attestation is required to report. */
const ANONYMOUS_AAGUID: Buffer = Buffer.alloc(16, 0);

export type SecurityKeyOptions = {
  /** The relying party id the credential is scoped to, e.g. "example.com". */
  rpId: string;

  /** The origin the browser will put in client data, e.g. "https://example.com". */
  origin: string;

  /*
   * Whether this authenticator can actually check who is holding it. `false`
   * is the clamshell MacBook, the PIN-less USB key, the reader-less desktop.
   */
  performsUserVerification: boolean;

  /*
   * A synced passkey (iCloud Keychain, a password manager) reports itself as
   * multi-device and backed up. A key soldered into one machine does not.
   * Left off, the credential is a single-device one.
   */
  isMultiDevice?: boolean | undefined;

  /*
   * The signature counter the authenticator reports. Platform authenticators
   * and passkeys generally report 0 forever; discrete keys increment.
   */
  signCount?: number | undefined;
};

/** A registration response, shaped exactly as the browser hands it over. */
export type RegistrationResponse = {
  id: string;
  rawId: string;
  response: {
    clientDataJSON: string;
    attestationObject: string;
    transports: Array<string>;
  };
  type: string;
  clientExtensionResults: Record<string, unknown>;
};

/** An authentication response, shaped exactly as the browser hands it over. */
export type AuthenticationResponse = {
  id: string;
  rawId: string;
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle: string | null;
  };
  type: string;
  clientExtensionResults: Record<string, unknown>;
};

export type SecurityKey = {
  /** The credential id, base64url, exactly as `credential.id` reaches the server. */
  credentialId: string;

  /** The COSE-encoded public key, base64, as the `UserWebAuthn` row stores it. */
  publicKeyAsStored: string;

  /** Whether this authenticator verifies its user -- what the UV bit will say. */
  performsUserVerification: boolean;

  /**
   * navigator.credentials.create(). `challenge` is the base64url string the
   * browser puts into client data, which is what the server compares against.
   */
  register: (data: { challenge: string }) => RegistrationResponse;

  /** navigator.credentials.get(), signing with the key minted at registration. */
  authenticate: (data: {
    challenge: string;
    signCount?: number | undefined;
  }) => AuthenticationResponse;
};

type CreateSecurityKeyFunction = (options: SecurityKeyOptions) => SecurityKey;

export const createSecurityKey: CreateSecurityKeyFunction = (
  options: SecurityKeyOptions,
): SecurityKey => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });

  const credentialIdBytes: Buffer = crypto.randomBytes(32);

  /*
   * COSE_Key for ES256 (RFC 8152): kty=EC2(2), alg=ES256(-7), crv=P-256(1),
   * and the two 32-byte coordinates under the negative labels -2 and -3.
   */
  /*
   * Typed locally rather than as `crypto.JsonWebKey`: App and Common compile
   * against different @types/node, and the older of the two does not export
   * that name. Only the two coordinates are needed here anyway.
   */
  const jwk: { x?: string | undefined; y?: string | undefined } =
    publicKey.export({ format: "jwk" }) as {
      x?: string | undefined;
      y?: string | undefined;
    };

  const cosePublicKey: Buffer = encodeCbor(
    new Map<CborValue, CborValue>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(jwk.x as string, "base64url")],
      [-3, Buffer.from(jwk.y as string, "base64url")],
    ]),
  );

  const rpIdHash: Buffer = crypto
    .createHash("sha256")
    .update(options.rpId)
    .digest();

  type BuildFlagsFunction = (data: { attested: boolean }) => number;

  const buildFlags: BuildFlagsFunction = (data: {
    attested: boolean;
  }): number => {
    /*
     * UP is always set: something touched the key. UV is set only when the
     * authenticator could actually establish WHO touched it, which is the
     * distinction this whole fixture exists to make.
     */
    let flags: number = FLAG_USER_PRESENT;

    if (options.performsUserVerification) {
      flags |= FLAG_USER_VERIFIED;
    }

    if (options.isMultiDevice) {
      flags |= FLAG_BACKUP_ELIGIBLE | FLAG_BACKED_UP;
    }

    if (data.attested) {
      flags |= FLAG_ATTESTED_CREDENTIAL_DATA;
    }

    return flags;
  };

  type BuildAuthenticatorDataFunction = (data: {
    attested: boolean;
    signCount: number;
  }) => Buffer;

  const buildAuthenticatorData: BuildAuthenticatorDataFunction = (data: {
    attested: boolean;
    signCount: number;
  }): Buffer => {
    const counter: Buffer = Buffer.alloc(4);
    counter.writeUInt32BE(data.signCount, 0);

    const header: Buffer = Buffer.concat([
      rpIdHash,
      Buffer.from([buildFlags({ attested: data.attested })]),
      counter,
    ]);

    if (!data.attested) {
      return header;
    }

    const credentialIdLength: Buffer = Buffer.alloc(2);
    credentialIdLength.writeUInt16BE(credentialIdBytes.length, 0);

    return Buffer.concat([
      header,
      ANONYMOUS_AAGUID,
      credentialIdLength,
      credentialIdBytes,
      cosePublicKey,
    ]);
  };

  type BuildClientDataFunction = (data: {
    type: string;
    challenge: string;
  }) => Buffer;

  const buildClientData: BuildClientDataFunction = (data: {
    type: string;
    challenge: string;
  }): Buffer => {
    return Buffer.from(
      JSON.stringify({
        type: data.type,
        challenge: data.challenge,
        origin: options.origin,
        crossOrigin: false,
      }),
      "utf8",
    );
  };

  const defaultSignCount: number = options.signCount ?? 0;

  return {
    credentialId: toBase64Url(credentialIdBytes),
    publicKeyAsStored: cosePublicKey.toString("base64"),
    performsUserVerification: options.performsUserVerification,

    register: (data: { challenge: string }): RegistrationResponse => {
      const authenticatorData: Buffer = buildAuthenticatorData({
        attested: true,
        signCount: defaultSignCount,
      });

      /*
       * "none" attestation: the authenticator vouches for nothing beyond the
       * key material, which is what the server asks for
       * (attestationType: "none") and what every passkey returns.
       */
      const attestationObject: Buffer = encodeCbor(
        new Map<CborValue, CborValue>([
          ["fmt", "none"],
          ["attStmt", new Map<CborValue, CborValue>()],
          ["authData", authenticatorData],
        ]),
      );

      return {
        id: toBase64Url(credentialIdBytes),
        rawId: toBase64Url(credentialIdBytes),
        response: {
          clientDataJSON: toBase64Url(
            buildClientData({
              type: "webauthn.create",
              challenge: data.challenge,
            }),
          ),
          attestationObject: toBase64Url(attestationObject),
          transports: ["internal"],
        },
        type: "public-key",
        clientExtensionResults: {},
      };
    },

    authenticate: (data: {
      challenge: string;
      signCount?: number | undefined;
    }): AuthenticationResponse => {
      const authenticatorData: Buffer = buildAuthenticatorData({
        attested: false,
        signCount: data.signCount ?? defaultSignCount,
      });

      const clientData: Buffer = buildClientData({
        type: "webauthn.get",
        challenge: data.challenge,
      });

      /*
       * The assertion signature covers the authenticator data concatenated
       * with the SHA-256 of the client data -- so a fixture that got the
       * flags byte wrong could not produce a signature the server accepts,
       * and the UV bit under test is genuinely bound into the signature
       * rather than being an assertion about a field nobody checks.
       */
      const signature: Buffer = crypto.sign(
        "sha256",
        Buffer.concat([
          authenticatorData,
          crypto.createHash("sha256").update(clientData).digest(),
        ]),
        privateKey,
      );

      return {
        id: toBase64Url(credentialIdBytes),
        rawId: toBase64Url(credentialIdBytes),
        response: {
          clientDataJSON: toBase64Url(clientData),
          authenticatorData: toBase64Url(authenticatorData),
          signature: toBase64Url(signature),
          userHandle: null,
        },
        type: "public-key",
        clientExtensionResults: {},
      };
    },
  };
};

/*
 * The two authenticators the bug is about, named so tests read as scenarios
 * rather than as flag arithmetic.
 */

export type BuildSecurityKeyFunction = (options: {
  rpId: string;
  origin: string;
}) => SecurityKey;

/** A laptop at a desk, lid open: Touch ID is reachable, so UV is set. */
export const securityKeyThatVerifiesTheUser: BuildSecurityKeyFunction =
  (options: { rpId: string; origin: string }): SecurityKey => {
    return createSecurityKey({
      rpId: options.rpId,
      origin: options.origin,
      performsUserVerification: true,
      isMultiDevice: true,
    });
  };

/** The same laptop folded shut on an external display: UV is left clear. */
export const securityKeyInClamshellMode: BuildSecurityKeyFunction = (options: {
  rpId: string;
  origin: string;
}): SecurityKey => {
  return createSecurityKey({
    rpId: options.rpId,
    origin: options.origin,
    performsUserVerification: false,
    isMultiDevice: true,
  });
};
