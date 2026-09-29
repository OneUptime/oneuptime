import crypto, { KeyObject } from "crypto";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import type { ExpressRouter } from "Common/Server/Utils/Express";
import ObjectID from "Common/Types/ObjectID";
import LicenseToken, {
  LICENSE_TOKEN_AUDIENCE,
  LICENSE_TOKEN_ISSUER,
  LicenseTokenClaims,
} from "../../../../Server/License/LicenseToken";
import { TrustedLicenseKey } from "../../../../Server/License/TrustedLicenseKeys";

/*
 * Shared fixtures for the license client tests: Ed25519 keys generated per
 * run (no private key material is committed), signed and legacy tokens, an
 * in-memory GlobalConfig row behind a mocked GlobalConfigService, and a way to
 * reach a real express router's handlers without an HTTP server.
 */

export const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

export interface KeyPair {
  publicKey: KeyObject;
  privateKey: KeyObject;
}

export const generateEd25519: () => KeyPair = (): KeyPair => {
  return crypto.generateKeyPairSync("ed25519");
};

export const trustedEntryFor: (keyPair: KeyPair) => TrustedLicenseKey = (
  keyPair: KeyPair,
): TrustedLicenseKey => {
  return {
    kid: LicenseToken.computeKeyId(keyPair.publicKey),
    publicKeyPem: keyPair.publicKey
      .export({ type: "spki", format: "pem" })
      .toString(),
  };
};

const toSeconds: (date: Date) => number = (date: Date): number => {
  return Math.floor(date.getTime() / 1000);
};

export const claimsFor: (
  overrides?: Partial<LicenseTokenClaims>,
) => LicenseTokenClaims = (
  overrides?: Partial<LicenseTokenClaims>,
): LicenseTokenClaims => {
  const now: Date = new Date();

  return {
    iss: LICENSE_TOKEN_ISSUER,
    aud: LICENSE_TOKEN_AUDIENCE,
    sub: "license-0001",
    licenseKey: "OU-ENT-0001",
    companyName: "Acme Inc",
    userLimit: 50,
    isEvaluation: false,
    features: ["*"],
    iat: toSeconds(now) - 60,
    exp: toSeconds(new Date(now.getTime() + 180 * DAY_IN_MS)),
    ...(overrides || {}),
  };
};

// A signed EdDSA license expiring `daysFromNow` days from now (negative: in the past).
export const signLicense: (
  keyPair: KeyPair,
  overrides?: Partial<LicenseTokenClaims> & { daysFromNow?: number },
) => string = (
  keyPair: KeyPair,
  overrides?: Partial<LicenseTokenClaims> & { daysFromNow?: number },
): string => {
  const { daysFromNow, ...claimOverrides } = overrides || {};
  const claims: LicenseTokenClaims = claimsFor(claimOverrides);

  if (typeof daysFromNow === "number") {
    claims.exp = toSeconds(new Date(Date.now() + daysFromNow * DAY_IN_MS));
  }

  return LicenseToken.sign(claims, keyPair.privateKey);
};

const base64url: (value: string) => string = (value: string): string => {
  return Buffer.from(value).toString("base64url");
};

// A pre-signed-licenses HS256 token, as oneuptime.com issues today.
export const legacyToken: (label?: string) => string = (
  label?: string,
): string => {
  const headerSegment: string = base64url(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  );
  const payloadSegment: string = base64url(
    JSON.stringify({ licenseKey: label || "OU-LEGACY", exp: 2000000000 }),
  );
  const signature: string = crypto
    .createHmac("sha256", "legacy-encryption-secret")
    .update(`${headerSegment}.${payloadSegment}`)
    .digest("base64url");

  return `${headerSegment}.${payloadSegment}.${signature}`;
};

/*
 * An in-memory stand-in for the singleton GlobalConfig row. Wire it into a
 * jest.mock'ed GlobalConfigService (findOneById / updateOneById / create) with
 * install(). Every write is recorded with its props, so tests can assert the
 * license client writes as root with hooks off.
 */
export interface RecordedWrite {
  kind: "update" | "create";
  data: Record<string, unknown>;
  props: Record<string, unknown>;
}

export class FakeGlobalConfigRow {
  public row: Record<string, unknown> | null;
  public writes: Array<RecordedWrite> = [];
  public reads: number = 0;
  public failReads: Error | null = null;

  public constructor(initial?: Record<string, unknown> | null) {
    this.row = initial === null ? null : { ...(initial || {}) };
  }

  public install(service: unknown): void {
    const mocked: Record<string, unknown> = service as Record<string, unknown>;

    mocked["findOneById"] = jest.fn(async (): Promise<GlobalConfig | null> => {
      this.reads++;

      if (this.failReads) {
        throw this.failReads;
      }

      if (!this.row) {
        return null;
      }

      const config: GlobalConfig = new GlobalConfig();
      config.id = ObjectID.getZeroObjectID();
      Object.assign(config, this.row);
      return config;
    });

    mocked["updateOneById"] = jest.fn(
      async (options: Record<string, unknown>): Promise<number> => {
        const data: Record<string, unknown> = options["data"] as Record<
          string,
          unknown
        >;
        const props: Record<string, unknown> = options["props"] as Record<
          string,
          unknown
        >;

        this.writes.push({ kind: "update", data: { ...data }, props });

        if (!this.row) {
          return 0;
        }

        Object.assign(this.row, data);
        return 1;
      },
    );

    mocked["create"] = jest.fn(
      async (options: Record<string, unknown>): Promise<GlobalConfig> => {
        const data: GlobalConfig = options["data"] as GlobalConfig;
        const props: Record<string, unknown> = options["props"] as Record<
          string,
          unknown
        >;
        const plain: Record<string, unknown> = {};

        for (const [key, value] of Object.entries(data)) {
          if (value !== undefined) {
            plain[key] = value;
          }
        }

        this.writes.push({ kind: "create", data: plain, props });
        this.row = plain;
        return data;
      },
    );
  }

  public lastWrite(): RecordedWrite {
    const write: RecordedWrite | undefined =
      this.writes[this.writes.length - 1];

    if (!write) {
      throw new Error("Nothing was written to GlobalConfig.");
    }

    return write;
  }

  // Writes other than the first-run stamp.
  public licenseWrites(): Array<RecordedWrite> {
    return this.writes.filter((write: RecordedWrite): boolean => {
      return !(
        Object.keys(write.data).length === 1 &&
        Object.prototype.hasOwnProperty.call(
          write.data,
          "enterpriseEditionFirstSeenAt",
        )
      );
    });
  }
}

type RouteHandler = (
  req: unknown,
  res: unknown,
  next: (err?: unknown) => void,
) => unknown;

export interface FoundRoute {
  path: string;
  method: string;
  // Every function on the route, in order; the last one serves the request.
  handlers: Array<RouteHandler>;
  middlewares: Array<RouteHandler>;
  handler: RouteHandler;
}

// Finds a route on a real express router, so tests can call its handlers.
export const findRoute: (
  router: ExpressRouter,
  method: string,
  path: string,
) => FoundRoute = (
  router: ExpressRouter,
  method: string,
  path: string,
): FoundRoute => {
  const stack: Array<Record<string, unknown>> = (
    router as unknown as { stack: Array<Record<string, unknown>> }
  ).stack;

  for (const layer of stack) {
    const route: Record<string, unknown> | undefined = layer["route"] as
      | Record<string, unknown>
      | undefined;

    if (!route || route["path"] !== path) {
      continue;
    }

    const methods: Record<string, boolean> = route["methods"] as Record<
      string,
      boolean
    >;

    if (!methods[method.toLowerCase()]) {
      continue;
    }

    const handlers: Array<RouteHandler> = (
      route["stack"] as Array<Record<string, unknown>>
    ).map((routeLayer: Record<string, unknown>): RouteHandler => {
      return routeLayer["handle"] as RouteHandler;
    });

    return {
      path,
      method,
      handlers,
      middlewares: handlers.slice(0, -1),
      handler: handlers[handlers.length - 1] as RouteHandler,
    };
  }

  throw new Error(`No ${method.toUpperCase()} ${path} route on the router.`);
};

// Every "METHOD /path" the router serves.
export const listRoutes: (router: ExpressRouter) => Array<string> = (
  router: ExpressRouter,
): Array<string> => {
  const stack: Array<Record<string, unknown>> = (
    router as unknown as { stack: Array<Record<string, unknown>> }
  ).stack;
  const routes: Array<string> = [];

  for (const layer of stack) {
    const route: Record<string, unknown> | undefined = layer["route"] as
      | Record<string, unknown>
      | undefined;

    if (!route) {
      continue;
    }

    for (const method of Object.keys(
      route["methods"] as Record<string, boolean>,
    )) {
      routes.push(`${method.toUpperCase()} ${String(route["path"])}`);
    }
  }

  return routes.sort();
};
