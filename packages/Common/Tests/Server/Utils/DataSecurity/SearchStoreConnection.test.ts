import { describe, expect, test } from "@jest/globals";
import {
  getSearchConnectionSecrets,
  isSearchConnectionString,
  readSearchConnection,
  SearchConnection,
  SearchConnectionError,
  toApiKeyAuthorization,
} from "../../../../Server/Utils/DataSecurity/Content/SearchStoreConnection";
import { sanitizeErrorMessage } from "../../../../Server/Utils/DataSecurity/Content/DatabaseSampler";

/*
 * A SEARCH CLUSTER'S CONNECTION STRING, READ (#11140).
 *
 * Elasticsearch and OpenSearch have no connection-string format of their
 * own, so OneUptime reads a URL - the cluster's address with a read-only
 * user, or an API key, and verify_certificate - or JSON, for a CA of its
 * own. Held here: each form is read to the address it sends to and the
 * header it signs in with; every mistake is refused with what to write
 * instead, never repeating a secret; and every secret a string holds is
 * taken out of an error.
 */

const CA: string =
  "-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIUFake\n-----END CERTIFICATE-----";

function basic(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
}

function refusal(connectionString: string): string {
  try {
    readSearchConnection(connectionString);
  } catch (error) {
    expect(error).toBeInstanceOf(SearchConnectionError);
    return (error as Error).message;
  }

  throw new Error(`${connectionString} was read`);
}

describe("readSearchConnection: a URL", () => {
  test("reads the address, and the user and password in it as basic auth", () => {
    const connection: SearchConnection = readSearchConnection(
      "https://reader:S3cret@search.internal:9200",
    );

    expect(connection).toEqual({
      baseUrl: "https://search.internal:9200",
      isHttps: true,
      authorization: basic("reader", "S3cret"),
      tls: undefined,
    });
  });

  test("decodes a percent-encoded user and password", () => {
    expect(
      readSearchConnection("https://re%40der:p%40ss%3Aword@search.internal:9200")
        .authorization,
    ).toBe(basic("re@der", "p@ss:word"));
  });

  test("keeps a path after the host, and drops a trailing slash", () => {
    expect(
      readSearchConnection("https://search.internal/es/").baseUrl,
    ).toBe("https://search.internal/es");
    expect(readSearchConnection("http://10.0.0.5:9200/").baseUrl).toBe(
      "http://10.0.0.5:9200",
    );
  });

  test("a cluster with no security of its own signs in with nothing", () => {
    const connection: SearchConnection = readSearchConnection(
      "http://search.internal:9200",
    );

    expect(connection.authorization).toBeUndefined();
    expect(connection.isHttps).toBe(false);
    expect(connection.tls).toBeUndefined();
  });

  test("an API key replaces the user: encoded as Elasticsearch hands it out, or written id:key", () => {
    expect(
      readSearchConnection(
        "https://search.internal:9200?api_key=VnVhQ2ZHY0JDZGJrUW0tZTVhT3g6dWkybHAyYXhUTm1zeWFrdzl0dk5udw%3D%3D",
      ).authorization,
    ).toBe(
      "ApiKey VnVhQ2ZHY0JDZGJrUW0tZTVhT3g6dWkybHAyYXhUTm1zeWFrdzl0dk5udw==",
    );
    expect(
      readSearchConnection("https://search.internal:9200?api_key=key-id:key-secret")
        .authorization,
    ).toBe(`ApiKey ${Buffer.from("key-id:key-secret").toString("base64")}`);
  });

  test("verify_certificate=false checks no certificate, over https only", () => {
    expect(
      readSearchConnection(
        "https://reader:x@search.internal:9200?verify_certificate=false",
      ).tls,
    ).toEqual({ rejectUnauthorized: false });
    expect(
      readSearchConnection(
        "https://reader:x@search.internal:9200?verify_certificate=true",
      ).tls,
    ).toBeUndefined();
    expect(
      readSearchConnection("http://search.internal:9200?verify_certificate=false")
        .tls,
    ).toBeUndefined();
  });

  test("the parameters it reads are taken off the address it sends to", () => {
    const connection: SearchConnection = readSearchConnection(
      "https://search.internal:9200?api_key=abc123&verify_certificate=false",
    );

    expect(connection.baseUrl).toBe("https://search.internal:9200");
    expect(connection.baseUrl).not.toContain("abc123");
  });

  test("refuses a parameter it does not read, naming it", () => {
    expect(refusal("https://search.internal:9200?pretty=true")).toBe(
      "OneUptime reads only api_key and verify_certificate after the address. Remove pretty.",
    );
  });

  test("refuses a user and an API key both", () => {
    expect(
      refusal("https://reader:x@search.internal:9200?api_key=abc"),
    ).toBe("Give a user and password, or an API key, not both.");
  });

  test("refuses a flag that is not true or false, and an empty API key", () => {
    expect(
      refusal("https://search.internal:9200?verify_certificate=maybe"),
    ).toBe("Set verify_certificate to true or false.");
    expect(refusal("https://search.internal:9200?api_key=")).toBe(
      "The API key is empty. Paste the key's encoded value.",
    );
  });

  test("refuses what is not a cluster's address, with an example", () => {
    expect(refusal("search.internal:9200")).toBe(
      "Start the cluster's address with https:// or http://, such as https://reader:password@search.internal:9200.",
    );
    expect(refusal("postgresql://reader:x@db.internal:5432/app")).toBe(
      "Start the cluster's address with https:// or http://, such as https://reader:password@search.internal:9200.",
    );
    expect(refusal("not a url at all")).toBe(
      "Enter the cluster's address with a read-only user, such as https://reader:password@search.internal:9200.",
    );
    expect(refusal("")).toBe(
      "Enter the cluster's address with a read-only user, such as https://reader:password@search.internal:9200.",
    );
    expect(refusal("https://search.internal:9200/#fragment")).toBe(
      "Remove the # and what follows it from the address.",
    );
  });

  test("no refusal ever repeats the password it was given", () => {
    for (const written of [
      "https://reader:Hunter2-Secret@search.internal:9200?pretty=1",
      "https://reader:Hunter2-Secret@search.internal:9200?api_key=x",
      "https://reader:Hunter2-Secret@search.internal:9200#x",
    ]) {
      expect(refusal(written)).not.toContain("Hunter2-Secret");
    }
  });
});

describe("readSearchConnection: JSON", () => {
  test("reads a user, a password and the cluster's own CA", () => {
    const connection: SearchConnection = readSearchConnection(
      JSON.stringify({
        url: "https://search.internal:9200",
        username: "reader",
        password: "S3cret",
        caCertificate: CA,
      }),
    );

    expect(connection).toEqual({
      baseUrl: "https://search.internal:9200",
      isHttps: true,
      authorization: basic("reader", "S3cret"),
      tls: { ca: CA },
    });
  });

  test("reads an API key, and verifyCertificate: false over the CA", () => {
    const connection: SearchConnection = readSearchConnection(
      JSON.stringify({
        url: "https://search.internal:9200",
        apiKey: "key-id:key-secret",
        verifyCertificate: false,
        caCertificate: CA,
      }),
    );

    expect(connection.authorization).toBe(
      `ApiKey ${Buffer.from("key-id:key-secret").toString("base64")}`,
    );
    expect(connection.tls).toEqual({ rejectUnauthorized: false });
  });

  test("refuses keys it does not read, credentials in the url, and a certificate that is not PEM", () => {
    expect(
      refusal(JSON.stringify({ url: "https://s:9200", region: "eu" })),
    ).toBe(
      "OneUptime reads only url, username, password, apiKey, caCertificate and verifyCertificate. Remove region.",
    );
    expect(
      refusal(JSON.stringify({ url: "https://reader:x@s:9200" })),
    ).toBe(
      'Give the user, password and API key as "username", "password" and "apiKey", not in the url.',
    );
    expect(
      refusal(
        JSON.stringify({ url: "https://s:9200", caCertificate: "not a cert" }),
      ),
    ).toBe(
      "Paste the CA's certificate as PEM, from -----BEGIN CERTIFICATE----- to -----END CERTIFICATE-----.",
    );
  });

  test("refuses a certificate setting over plain http, and a quoted flag", () => {
    expect(
      refusal(
        JSON.stringify({ url: "http://s:9200", verifyCertificate: false }),
      ),
    ).toBe(
      "A certificate is checked only over https://. Start the url with https://, or leave caCertificate and verifyCertificate out.",
    );
    expect(
      refusal(
        JSON.stringify({ url: "https://s:9200", verifyCertificate: "false" }),
      ),
    ).toBe("Set verifyCertificate to true or false, without quotes.");
  });

  test("refuses JSON that is not one object with a url", () => {
    expect(refusal("{ not json")).toMatch(/^The connection is not valid JSON/);
    expect(refusal("[]")).toMatch(/^Enter the cluster's address/);
    expect(refusal(JSON.stringify({ username: "reader" }))).toBe(
      'Give the cluster\'s address as "url", such as "https://search.internal:9200".',
    );
    expect(refusal(JSON.stringify({ url: 9200 }))).toBe(
      "Write url as text, in quotes.",
    );
  });
});

describe("isSearchConnectionString", () => {
  test("is whether readSearchConnection reads it", () => {
    expect(isSearchConnectionString("https://r:p@s.internal:9200")).toBe(true);
    expect(isSearchConnectionString('{"url":"http://s.internal:9200"}')).toBe(
      true,
    );
    expect(isSearchConnectionString("mongodb://r:p@m.internal")).toBe(false);
  });
});

describe("toApiKeyAuthorization", () => {
  test("trims, and encodes only an id:key", () => {
    expect(toApiKeyAuthorization("  abc==  ")).toBe("ApiKey abc==");
    expect(toApiKeyAuthorization("id:key")).toBe(
      `ApiKey ${Buffer.from("id:key").toString("base64")}`,
    );
  });
});

describe("getSearchConnectionSecrets", () => {
  test("takes the password, the API key and the header they make out of an error", () => {
    const written: string =
      "https://reader:Hunter2-Secret@search.internal:9200";
    const message: string = sanitizeErrorMessage(
      new Error(
        `request to ${written}/_cat failed with header ${basic("reader", "Hunter2-Secret")}`,
      ),
      getSearchConnectionSecrets(written),
    );

    expect(message).not.toContain("Hunter2-Secret");
    expect(message).not.toContain(
      Buffer.from("reader:Hunter2-Secret").toString("base64"),
    );
  });

  test("takes an API key out, as written and as it is sent", () => {
    const written: string =
      "https://search.internal:9200?api_key=key-id:Top-Secret-Key";
    const sent: string = Buffer.from("key-id:Top-Secret-Key").toString(
      "base64",
    );
    const message: string = sanitizeErrorMessage(
      new Error(`key-id:Top-Secret-Key was refused; ApiKey ${sent} too`),
      getSearchConnectionSecrets(written),
    );

    expect(message).not.toContain("Top-Secret-Key");
    expect(message).not.toContain(sent);
  });

  test("takes a JSON connection's password and API key out", () => {
    const written: string = JSON.stringify({
      url: "https://search.internal:9200",
      username: "reader",
      password: "Json-Secret-1",
      apiKey: undefined,
    });
    const message: string = sanitizeErrorMessage(
      new Error("Json-Secret-1 rejected"),
      getSearchConnectionSecrets(written),
    );

    expect(message).toBe("**** rejected");
  });

  test("still takes the whole string out of one it cannot read", () => {
    const written: string = "https://r:p@s:9200?pretty=1";

    expect(getSearchConnectionSecrets(written)).toContain(written);
  });
});
