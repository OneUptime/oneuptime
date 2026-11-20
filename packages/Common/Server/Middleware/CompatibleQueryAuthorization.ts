import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import ObjectID from "../../Types/ObjectID";

/*
 * HOW GRAFANA, AND ANY PROMETHEUS OR LOKI CLIENT, SIGNS IN TO ONEUPTIME'S
 * QUERY APIS (issues #6796, #7700).
 *
 * The Prometheus-compatible API (/api/prometheus) and the Loki-compatible
 * one (/api/loki) take a project API key, as the docs' Grafana steps say:
 * in the ApiKey header, as everywhere in the API, or as a client of those
 * systems knows how to send a credential - a bearer token, or a basic-auth
 * password (or user name, for a client that only fills that one). The key
 * then reads exactly what its role may read.
 *
 * A telemetry ingestion key is no key here: it sends data, is often kept
 * in a browser or an agent's config, and reads nothing. Sent as a bearer
 * token, it is taken for an API key, which it is not, and refused as one.
 */

const UUID_LENGTH: number = 36;

const isKey: (value: string | undefined) => value is string = (
  value: string | undefined,
): value is string => {
  return (
    value !== undefined &&
    value.length === UUID_LENGTH &&
    ObjectID.isValidUUID(value)
  );
};

/*
 * The project API key a client sent in its Authorization header: a bearer
 * token, or a basic-auth password (or user name). A value that is no key,
 * such as a signed-in session's token, is left alone.
 */
export const readApiKeyFromAuthorization: (
  authorization: string | undefined,
) => string | undefined = (
  authorization: string | undefined,
): string | undefined => {
  if (!authorization) {
    return undefined;
  }

  const [scheme, ...rest] = authorization.trim().split(/\s+/);
  const credential: string = rest.join(" ");

  if (!scheme || !credential) {
    return undefined;
  }

  if (scheme.toLowerCase() === "bearer") {
    return isKey(credential) ? credential : undefined;
  }

  if (scheme.toLowerCase() === "basic") {
    let decoded: string = "";

    try {
      decoded = Buffer.from(credential, "base64").toString("utf8");
    } catch {
      return undefined;
    }

    const separator: number = decoded.indexOf(":");
    const user: string =
      separator === -1 ? decoded : decoded.slice(0, separator);
    const password: string =
      separator === -1 ? "" : decoded.slice(separator + 1);

    if (isKey(password)) {
      return password;
    }

    return isKey(user) ? user : undefined;
  }

  return undefined;
};

/*
 * Moves a key from the Authorization header to the ApiKey header, before
 * the user middleware reads the request: a key sent so is not also a
 * signed-in session's token. An ApiKey header already sent is kept.
 */
export const apiKeyFromAuthorizationHeader: (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void = (
  req: ExpressRequest,
  _res: ExpressResponse,
  next: NextFunction,
): void => {
  if (!req.headers["apikey"]) {
    const key: string | undefined = readApiKeyFromAuthorization(
      req.headers["authorization"],
    );

    if (key) {
      req.headers["apikey"] = key;
      delete req.headers["authorization"];
    }
  }

  next();
};
