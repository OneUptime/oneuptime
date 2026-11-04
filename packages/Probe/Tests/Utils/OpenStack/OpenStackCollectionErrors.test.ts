import { describe, expect, test } from "@jest/globals";
import OpenStackCollectionErrorCode from "Common/Types/OpenStack/OpenStackCollectionError";
import {
  OpenStackApiError,
  OpenStackApiErrorKind,
  OpenStackBudgetExceededError,
  OpenStackCollectionError,
  classifyOpenStackError,
  isNoAnswer,
  readErrorMessage,
} from "../../../Utils/OpenStack/OpenStackCollectionErrors";
import {
  OpenStackEndpointRefusedError,
  OpenStackRequestTimeoutError,
  OpenStackResponseTooLargeError,
} from "../../../Utils/OpenStack/OpenStackHttp";
import {
  OpenStackCertificateError,
  OpenStackConnectTimeoutError,
} from "../../../Utils/OpenStack/OpenStackTls";
import { OpenStackPresentedCertificate } from "Common/Types/OpenStack/OpenStackProbeCollection";

/*
 * Whatever stopped a read, a login or a collection, as the one code the dashboard acts on
 * and the sentence a person reads. Each sentence names where, because a cloud is many
 * hosts, and none of them holds a secret, because the transport's errors never had one.
 */

const WHERE: { host: string; port: number } = {
  host: "keystone.example.com",
  port: 5000,
};

function classify(error: unknown): ReturnType<typeof classifyOpenStackError> {
  return classifyOpenStackError(error, WHERE);
}

function errorWithCode(code: string, message: string = "It broke."): Error {
  return Object.assign(new Error(message), { code: code });
}

const PRESENTED: OpenStackPresentedCertificate = {
  fingerprint256: "AA:BB",
  subject: "CN=keystone",
  issuer: "CN=keystone",
  isSelfSigned: true,
  host: "keystone.example.com",
  port: 5000,
};

describe("what the collector decided itself", () => {
  test("keeps its code and its words", () => {
    expect(
      classify(
        new OpenStackCollectionError(
          OpenStackCollectionErrorCode.RegionNotFound,
          "No such region.",
        ),
      ),
    ).toEqual({
      code: OpenStackCollectionErrorCode.RegionNotFound,
      message: "No such region.",
    });
  });
});

describe("a certificate", () => {
  test.each([
    ["untrusted", OpenStackCollectionErrorCode.UntrustedCertificate],
    ["changed", OpenStackCollectionErrorCode.CertificateChanged],
  ] as const)(
    "%s carries what was presented, for a person to judge",
    (kind: "untrusted" | "changed", code: OpenStackCollectionErrorCode) => {
      expect(
        classify(
          new OpenStackCertificateError({
            kind: kind,
            presentedCertificate: PRESENTED,
            message: "It showed something.",
          }),
        ),
      ).toEqual({
        code: code,
        message: "It showed something.",
        presentedCertificate: PRESENTED,
      });
    },
  );
});

describe("a URL the catalog named", () => {
  test.each([
    ["insecure", OpenStackCollectionErrorCode.InsecureEndpoint],
    ["forbidden", OpenStackCollectionErrorCode.AddressNotAllowed],
    ["invalid", OpenStackCollectionErrorCode.InvalidAddress],
  ] as const)(
    "%s has its own code",
    (
      kind: "insecure" | "forbidden" | "invalid",
      code: OpenStackCollectionErrorCode,
    ) => {
      expect(
        classify(
          new OpenStackEndpointRefusedError({ kind: kind, message: "No." }),
        ),
      ).toEqual({ code: code, message: "No." });
    },
  );
});

describe("what an API said", () => {
  test.each([
    ["refused", 403, OpenStackCollectionErrorCode.NoPermission],
    ["overloaded", 429, OpenStackCollectionErrorCode.ServiceOverloaded],
    ["overloaded", 503, OpenStackCollectionErrorCode.ServiceOverloaded],
    ["failing", 500, OpenStackCollectionErrorCode.ApiError],
    ["malformed", 200, OpenStackCollectionErrorCode.ApiError],
    ["absent", 404, OpenStackCollectionErrorCode.ApiError],
  ] as const)(
    "%s (%s)",
    (
      kind: OpenStackApiErrorKind,
      status: number,
      code: OpenStackCollectionErrorCode,
    ) => {
      expect(
        classify(
          new OpenStackApiError({
            kind: kind,
            status: status,
            url: "https://nova.example.com/v2.1/servers",
            message: "It said so.",
          }),
        ),
      ).toEqual({ code: code, message: "It said so." });
    },
  );
});

describe("how long something took", () => {
  test("the collection's own time running out", () => {
    expect(classify(new OpenStackBudgetExceededError("Out of time."))).toEqual({
      code: OpenStackCollectionErrorCode.TimedOut,
      message: "Out of time.",
    });
  });

  test("a connection that never opened is about the network", () => {
    const classified: ReturnType<typeof classifyOpenStackError> = classify(
      new OpenStackConnectTimeoutError(
        "keystone.example.com:5000 did not complete a TLS connection within 15 seconds.",
      ),
    );

    expect(classified.code).toBe(
      OpenStackCollectionErrorCode.ConnectionTimedOut,
    );
    expect(classified.message).toContain("TCP 5000");
    expect(classified.message).toContain("pick a probe in the cloud's network");
  });

  test("an API that took the request and never answered is about the API", () => {
    const classified: ReturnType<typeof classifyOpenStackError> = classify(
      new OpenStackRequestTimeoutError(
        "https://nova.example.com/v2.1/servers",
        60_000,
      ),
    );

    expect(classified.code).toBe(OpenStackCollectionErrorCode.TimedOut);
    expect(classified.message).toBe(
      "nova.example.com did not answer within 60 seconds. It may be overloaded. Collect less often, or check its health.",
    );
  });

  test("an answer larger than OpenStack ever sends", () => {
    expect(
      classify(
        new OpenStackResponseTooLargeError(
          "https://nova.example.com/v2.1/servers",
          64 * 1024 * 1024,
        ),
      ),
    ).toEqual({
      code: OpenStackCollectionErrorCode.ApiError,
      message: "nova.example.com answered with more than 64 MiB.",
    });
  });
});

describe("what the operating system said", () => {
  test.each([
    ["ENOTFOUND", OpenStackCollectionErrorCode.AddressNotFound, "in DNS"],
    ["EAI_AGAIN", OpenStackCollectionErrorCode.AddressNotFound, "in DNS"],
    ["EAI_NONAME", OpenStackCollectionErrorCode.AddressNotFound, "in DNS"],
    ["EAI_NODATA", OpenStackCollectionErrorCode.AddressNotFound, "in DNS"],
    [
      "ECONNREFUSED",
      OpenStackCollectionErrorCode.ConnectionRefused,
      "nothing listens on port 5000",
    ],
    ["ETIMEDOUT", OpenStackCollectionErrorCode.ConnectionTimedOut, "TCP 5000"],
    [
      "ESOCKETTIMEDOUT",
      OpenStackCollectionErrorCode.ConnectionTimedOut,
      "TCP 5000",
    ],
    [
      "EHOSTUNREACH",
      OpenStackCollectionErrorCode.ConnectionFailed,
      "could not connect",
    ],
    [
      "ENETUNREACH",
      OpenStackCollectionErrorCode.ConnectionFailed,
      "could not connect",
    ],
    [
      "ECONNRESET",
      OpenStackCollectionErrorCode.ConnectionFailed,
      "could not connect",
    ],
    [
      "EPIPE",
      OpenStackCollectionErrorCode.ConnectionFailed,
      "could not connect",
    ],
    [
      "ECONNABORTED",
      OpenStackCollectionErrorCode.ConnectionFailed,
      "could not connect",
    ],
    [
      "EADDRNOTAVAIL",
      OpenStackCollectionErrorCode.ConnectionFailed,
      "could not connect",
    ],
    ["EPROTO", OpenStackCollectionErrorCode.TlsFailed, "an HTTPS port"],
    [
      "ERR_SSL_WRONG_VERSION_NUMBER",
      OpenStackCollectionErrorCode.TlsFailed,
      "an HTTPS port",
    ],
    [
      "ERR_TLS_CERT_ALTNAME_INVALID",
      OpenStackCollectionErrorCode.TlsFailed,
      "an HTTPS port",
    ],
  ])(
    "%s",
    (errorCode: string, code: OpenStackCollectionErrorCode, words: string) => {
      const classified: ReturnType<typeof classifyOpenStackError> = classify(
        errorWithCode(errorCode),
      );

      expect(classified.code).toBe(code);
      expect(classified.message).toContain(words);
      expect(classified.message).toContain("keystone.example.com");
    },
  );

  test("a TLS failure with no code to go by, by what it says", () => {
    expect(
      classify(
        new Error(
          "Client network socket disconnected before secure TLS connection was established",
        ),
      ).code,
    ).toBe(OpenStackCollectionErrorCode.TlsFailed);
  });

  test("the word appearing inside another word is not TLS", () => {
    expect(classify(new Error("the bottles are empty")).code).toBe(
      OpenStackCollectionErrorCode.Internal,
    );
  });
});

describe("what the address guard said", () => {
  test.each([
    "OpenStack address hostname could not be resolved via DNS.",
    "OpenStack address could not be reached.",
  ])("%s means the name was not found", (message: string) => {
    const classified: ReturnType<typeof classifyOpenStackError> = classify(
      new Error(message),
    );

    expect(classified.code).toBe(OpenStackCollectionErrorCode.AddressNotFound);
    expect(classified.message).toContain("keystone.example.com in DNS");
  });

  test("anything else it refuses is an address no probe connects to", () => {
    const classified: ReturnType<typeof classifyOpenStackError> = classify(
      new Error(
        "OpenStack address must not resolve to a private, loopback, link-local, or otherwise reserved address.",
      ),
    );

    expect(classified.code).toBe(
      OpenStackCollectionErrorCode.AddressNotAllowed,
    );
    expect(classified.message).toContain(
      "loopback, link-local, cloud metadata",
    );
  });
});

describe("anything else", () => {
  test.each([
    ["an error", new Error("Something new."), "Something new."],
    ["a thrown string", "not even an error", "not even an error"],
    ["nothing at all", undefined, "undefined"],
    ["null", null, "null"],
  ])(
    "%s still comes out in words",
    (_name: string, error: unknown, words: string) => {
      const classified: ReturnType<typeof classifyOpenStackError> =
        classify(error);

      expect(classified.code).toBe(OpenStackCollectionErrorCode.Internal);
      expect(classified.message).toBe(
        `The probe could not read keystone.example.com:5000: ${words}`,
      );
    },
  );
});

describe("isNoAnswer", () => {
  test("an API that answered with an error answered", () => {
    expect(
      isNoAnswer(
        new OpenStackApiError({
          kind: "failing",
          status: 500,
          url: "https://x/",
          message: "No.",
        }),
      ),
    ).toBe(false);
  });

  test.each([
    ["a socket", errorWithCode("ECONNREFUSED")],
    ["a certificate", new OpenStackConnectTimeoutError("No.")],
    ["a timeout", new OpenStackRequestTimeoutError("https://x/", 1000)],
    ["anything else", new Error("No.")],
  ])("%s did not", (_name: string, error: Error) => {
    expect(isNoAnswer(error)).toBe(true);
  });
});

describe("what an error answer says, which every service words differently", () => {
  test.each([
    [
      "Keystone",
      {
        error: {
          code: 401,
          message: "The request you have made requires authentication.",
          title: "Unauthorized",
        },
      },
      "The request you have made requires authentication.",
    ],
    [
      "Nova",
      {
        forbidden: {
          code: 403,
          message:
            "Policy doesn't allow os_compute_api:os-services:list to be performed.",
        },
      },
      "Policy doesn't allow os_compute_api:os-services:list to be performed.",
    ],
    [
      "Neutron",
      {
        NeutronError: {
          type: "HTTPForbidden",
          message: "Not authorized.",
          detail: "",
        },
      },
      "Not authorized.",
    ],
    [
      "Placement",
      {
        errors: [
          {
            status: 403,
            title: "Forbidden",
            detail: "Access was denied to this resource.",
          },
        ],
      },
      "Access was denied to this resource.",
    ],
    ["Glance", { message: "403 Forbidden" }, "403 Forbidden"],
  ])("%s", (_name: string, body: object, message: string) => {
    expect(readErrorMessage(JSON.stringify(body))).toBe(message);
  });

  test.each([
    ["nothing", ""],
    [
      "a proxy's page of HTML",
      "<html><body>503 Service Unavailable</body></html>",
    ],
    ["JSON that is not an object", "42"],
    ["null", "null"],
    ["an object saying nothing", JSON.stringify({ code: 500 })],
    ["an empty message", JSON.stringify({ message: "   " })],
    ["an empty list of errors", JSON.stringify({ errors: [] })],
  ])("%s says nothing a person needs", (_name: string, body: string) => {
    expect(readErrorMessage(body)).toBeNull();
  });

  test("a long message is cut, and the body it came in is never kept", () => {
    const message: string | null = readErrorMessage(
      JSON.stringify({ message: "x".repeat(1000) }),
    );

    expect(message?.length).toBe(300);
    expect(message?.endsWith("…")).toBe(true);
  });

  test("an answer the size of a page is not even parsed", () => {
    expect(
      readErrorMessage(
        JSON.stringify({ message: "no", padding: "x".repeat(1024 * 1024) }),
      ),
    ).toBeNull();
  });
});
