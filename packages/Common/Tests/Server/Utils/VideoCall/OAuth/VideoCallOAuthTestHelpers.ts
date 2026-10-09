import { JSONObject } from "../../../../../Types/JSON";

/*
 * An ID token as a provider's token endpoint returns one, with the claims a
 * test needs. Unsigned: the apps read the claims of a token that came
 * straight from the provider over TLS, without checking its signature.
 */
export function unsignedIdToken(claims: JSONObject): string {
  const encode: (value: JSONObject) => string = (value: JSONObject): string => {
    return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  };

  return `${encode({ alg: "RS256" })}.${encode(claims)}.signature`;
}
