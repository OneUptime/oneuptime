import { ExpressApplication } from "../../../Server/Utils/Express";
import CookieParser from "cookie-parser";
import { Redis, RedisOptions } from "ioredis";
import { encodeCBOR, CBORType } from "@levischuck/tiny-cbor";
import { createServer, Server } from "http";
import { AddressInfo } from "net";
import { createHash, generateKeyPairSync, KeyObject, sign } from "crypto";

export { Redis as TestRedisClient, RedisOptions as TestRedisOptions };
export { CookieParser };

export async function listenForPasskeyTest(
  app: ExpressApplication,
): Promise<{ server: Server; origin: string }> {
  const server: Server = createServer(app);
  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    server,
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  };
}

export interface AssertionOverrides {
  origin?: string;
  challenge?: string;
  flags?: number;
  signingKey?: KeyObject;
}

export interface SignedPasskeyFixture {
  publicKey: string;
  assertion: (
    challenge: string,
    overrides?: AssertionOverrides,
  ) => Record<string, unknown>;
}

// Real ES256/COSE proof, so route tests also exercise WebAuthn verification.
export function createSignedPasskeyFixture(data: {
  origin: string;
  credentialId: string;
  userId: string;
}): SignedPasskeyFixture {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const jwk: { x?: string; y?: string } = publicKey.export({ format: "jwk" });
  const cose: Uint8Array = encodeCBOR(
    new Map<number, CBORType>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, new Uint8Array(Buffer.from(jwk.x!, "base64url"))],
      [-3, new Uint8Array(Buffer.from(jwk.y!, "base64url"))],
    ]),
  );
  return {
    publicKey: Buffer.from(cose).toString("base64"),
    assertion: (
      challenge: string,
      overrides: AssertionOverrides = {},
    ): Record<string, unknown> => {
      const clientData: Buffer = Buffer.from(
        JSON.stringify({
          type: "webauthn.get",
          challenge: overrides.challenge ?? challenge,
          origin: overrides.origin ?? data.origin,
          crossOrigin: false,
        }),
      );
      const counter: Buffer = Buffer.alloc(4);
      counter.writeUInt32BE(6);
      const authenticatorData: Buffer = Buffer.concat([
        createHash("sha256").update(new URL(data.origin).hostname).digest(),
        Buffer.from([overrides.flags ?? 0x05]),
        counter,
      ]);
      const signature: Buffer = sign(
        "sha256",
        Buffer.concat([
          authenticatorData,
          createHash("sha256").update(clientData).digest(),
        ]),
        overrides.signingKey ?? privateKey,
      );
      return {
        id: data.credentialId,
        rawId: data.credentialId,
        type: "public-key",
        response: {
          clientDataJSON: clientData.toString("base64url"),
          authenticatorData: authenticatorData.toString("base64url"),
          signature: signature.toString("base64url"),
          userHandle: Buffer.from(data.userId).toString("base64url"),
        },
        clientExtensionResults: {},
      };
    },
  };
}
