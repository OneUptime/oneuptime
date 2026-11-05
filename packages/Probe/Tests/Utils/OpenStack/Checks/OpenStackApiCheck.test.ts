import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import OpenStackCollectionErrorCode from "Common/Types/OpenStack/OpenStackCollectionError";
import {
  OpenStackApiCheckJob,
  OpenStackApiCheckOutcome,
  OpenStackApiCheckResult,
  OpenStackApiServiceResult,
} from "Common/Types/OpenStack/OpenStackCheck";
import { OpenStackPresentedCertificate } from "Common/Types/OpenStack/OpenStackProbeCollection";
import { OpenStackServiceType } from "Common/Types/OpenStack/OpenStackResourceKind";
import { OpenStackBackoffMemory } from "../../../../Utils/OpenStack/OpenStackBackoff";
import { OpenStackCatalogService } from "../../../../Utils/OpenStack/OpenStackCatalog";
import OpenStackApiCheck, {
  getOpenStackServiceOfCatalogType,
  judgeOpenStackApiAnswer,
  planOpenStackApiCheckReads,
} from "../../../../Utils/OpenStack/Checks/OpenStackApiCheck";
import { OpenStackCheckDependencies } from "../../../../Utils/OpenStack/Checks/OpenStackCheckDependencies";
import {
  OpenStackEndpointRefusedError,
  OpenStackHttpRequest,
  OpenStackHttpResponse,
  OpenStackTransport,
} from "../../../../Utils/OpenStack/OpenStackHttp";
import { OpenStackCertificateError } from "../../../../Utils/OpenStack/OpenStackTls";
import {
  FakeClock,
  SECRET,
  createFakeClock,
} from "../Helpers/CollectorHarness";
import {
  RECORDED_AUTH_URL,
  RECORDED_REGION,
  RecordedScene,
  loadScene,
  recordedTokenBody,
} from "../Helpers/RecordedCloud";

/*
 * The API checks, against the catalog a real DevStack recorded. Exactly one request a service,
 * with no retry: that is what makes this say what a user would have met, and what keeps its cost
 * a known number whatever state the cloud is in.
 */

const scene: RecordedScene = loadScene("hibiscus-ovn", "healthy");

const HOST: string = "https://openstack.example";

const EXPECTED_REQUESTS: Array<string> = [
  "GET /compute/v2.1/servers?limit=1",
  "GET /compute/v2/PROJECT",
  "GET /identity/v3/auth/projects",
  "GET /image/v2/images?limit=1",
  "GET /networking/v2.0/networks?limit=1",
  "GET /placement/resource_classes",
  "GET /volume/v3/volumes?limit=1",
  "POST /identity/v3/auth/tokens",
];

function apiJob(
  overrides: Partial<OpenStackApiCheckJob> = {},
): OpenStackApiCheckJob {
  return {
    openStackCloudCheckId: "check-1",
    openStackCloudId: "cloud-1",
    cloudName: "Lab",
    authUrl: RECORDED_AUTH_URL,
    regions: [RECORDED_REGION],
    endpointInterface: "public",
    trustedCertificateFingerprints: [],
    settingsVersion: 2,
    credential: {
      kind: "applicationCredential",
      id: "monitoring-credential",
      secret: SECRET,
    },
    intervalInMinutes: 1,
    ...overrides,
  };
}

interface Harness {
  clock: FakeClock;
  requests: Array<OpenStackHttpRequest>;
  log: () => Array<string>;
  deps: OpenStackCheckDependencies;
  certificates: {
    report: (certificate: OpenStackPresentedCertificate) => void;
  };
}

function json(status: number, body: JSONObject): OpenStackHttpResponse {
  return { status: status, headers: {}, body: JSON.stringify(body) };
}

function createHarness(data?: {
  answer?:
    | ((
        request: OpenStackHttpRequest,
        report: (certificate: OpenStackPresentedCertificate) => void,
      ) => OpenStackHttpResponse | undefined)
    | undefined;
  tokenOverrides?: JSONObject | undefined;
  backoff?: OpenStackBackoffMemory | undefined;
  clock?: FakeClock | undefined;
}): Harness {
  const clock: FakeClock = data?.clock || createFakeClock();
  const requests: Array<OpenStackHttpRequest> = [];
  let onCertificate:
    | ((certificate: OpenStackPresentedCertificate) => void)
    | undefined;

  const report: (certificate: OpenStackPresentedCertificate) => void = (
    certificate: OpenStackPresentedCertificate,
  ): void => {
    onCertificate?.(certificate);
  };

  const transport: OpenStackTransport = async (
    request: OpenStackHttpRequest,
  ): Promise<OpenStackHttpResponse> => {
    requests.push(request);

    const scripted: OpenStackHttpResponse | undefined = data?.answer?.(
      request,
      report,
    );

    if (scripted) {
      return scripted;
    }

    if (request.url.endsWith("/v3/auth/tokens")) {
      return {
        status: 201,
        headers: { "x-subject-token": "a-check-token" },
        body: JSON.stringify(recordedTokenBody(scene, data?.tokenOverrides)),
      };
    }

    return json(200, {});
  };

  return {
    clock: clock,
    requests: requests,
    log: (): Array<string> => {
      return requests
        .map((request: OpenStackHttpRequest): string => {
          const url: globalThis.URL = new globalThis.URL(request.url);

          return `${request.method} ${url.pathname.replace(
            /\/[0-9a-f]{32}$/,
            "/PROJECT",
          )}${url.search}`;
        })
        .sort();
    },
    certificates: { report: report },
    deps: {
      resolve: async (): Promise<Array<string>> => {
        return ["192.0.2.10"];
      },
      createTransport: (options: {
        onCertificate?:
          | ((certificate: OpenStackPresentedCertificate) => void)
          | undefined;
      }) => {
        onCertificate = options.onCertificate;

        return {
          transport: transport,
          close: (): void => {
            // Nothing to close.
          },
        };
      },
      clock: clock,
      ping: async (): Promise<boolean> => {
        return true;
      },
      randomHex: (): string => {
        return "abcdef";
      },
      randomUuid: (): string => {
        return "4e3e0ec6-2938-40b1-8504-09eb1d4b0dee";
      },
      backoff: data?.backoff || new OpenStackBackoffMemory(),
      userAgent: "OneUptime-Probe/test",
    },
  };
}

function resultOf(
  result: OpenStackApiCheckResult,
  serviceType: string,
): OpenStackApiServiceResult {
  return result.services.find((service: OpenStackApiServiceResult): boolean => {
    return service.serviceType === serviceType;
  }) as OpenStackApiServiceResult;
}

describe("a check of a healthy cloud", () => {
  test("logs in once, and asks each service in the catalog exactly once", async () => {
    const harness: Harness = createHarness();

    const result: OpenStackApiCheckResult = await OpenStackApiCheck.run(
      apiJob(),
      harness.deps,
    );

    expect(harness.log()).toEqual(EXPECTED_REQUESTS);
    expect(result.token.status).toBe("Passed");
    expect(result.regionNames).toEqual([RECORDED_REGION]);
    expect(
      result.services.map((service: OpenStackApiServiceResult): string => {
        return `${service.serviceType}:${service.outcome}`;
      }),
    ).toEqual([
      "block-storage:Answered",
      "compute:Answered",
      "compute_legacy:Answered",
      "identity:Answered",
      "image:Answered",
      "network:Answered",
      "placement:Answered",
    ]);
  });

  test("names what it asked, for a person to try", async () => {
    const harness: Harness = createHarness();

    const result: OpenStackApiCheckResult = await OpenStackApiCheck.run(
      apiJob(),
      harness.deps,
    );

    expect(resultOf(result, "compute").read).toBe("GET /servers?limit=1");
    expect(resultOf(result, "block-storage").read).toBe("GET /volumes?limit=1");
    expect(resultOf(result, "placement").read).toBe("GET /resource_classes");
    expect(resultOf(result, "compute_legacy").read).toBe("GET /");
  });

  test("the token goes with every read, and the secret only to Keystone", async () => {
    const harness: Harness = createHarness();

    const result: OpenStackApiCheckResult = await OpenStackApiCheck.run(
      apiJob(),
      harness.deps,
    );

    for (const request of harness.requests) {
      if (request.url.endsWith("/v3/auth/tokens")) {
        expect(request.method).toBe("POST");
        continue;
      }

      expect(request.method).toBe("GET");
      expect(request.headers["X-Auth-Token"]).toBe("a-check-token");
      expect(JSON.stringify(request)).not.toContain(SECRET);
    }

    const report: string = JSON.stringify(result);

    expect(report).not.toContain(SECRET);
    expect(report).not.toContain("a-check-token");
  });

  test("a check of many regions asks each of its own, and Keystone once", async () => {
    const harness: Harness = createHarness({
      tokenOverrides: {
        catalog: [
          {
            type: "identity",
            name: "keystone",
            endpoints: [
              {
                url: `${HOST}/identity`,
                interface: "public",
                region_id: "one",
              },
              {
                url: `${HOST}/identity`,
                interface: "public",
                region_id: "two",
              },
            ],
          },
          {
            type: "compute",
            name: "nova",
            endpoints: [
              {
                url: `${HOST}/one/compute/v2.1`,
                interface: "public",
                region_id: "one",
              },
              {
                url: `${HOST}/two/compute/v2.1`,
                interface: "public",
                region_id: "two",
              },
            ],
          },
        ],
      },
    });

    const result: OpenStackApiCheckResult = await OpenStackApiCheck.run(
      apiJob({ regions: [] }),
      harness.deps,
    );

    expect(harness.log()).toEqual([
      "GET /identity/v3/auth/projects",
      "GET /one/compute/v2.1/servers?limit=1",
      "GET /two/compute/v2.1/servers?limit=1",
      "POST /identity/v3/auth/tokens",
    ]);
    expect(result.regionNames).toEqual(["one", "two"]);

    // Each region says the same of Keystone, so a monitor narrowed to a region finds it.
    expect(
      result.services
        .filter((service: OpenStackApiServiceResult): boolean => {
          return service.serviceType === "identity";
        })
        .map((service: OpenStackApiServiceResult): string => {
          return service.regionName;
        }),
    ).toEqual(["one", "two"]);
  });

  test("a region the check was told about and the catalog does not name is left out, and said", async () => {
    const harness: Harness = createHarness();

    const result: OpenStackApiCheckResult = await OpenStackApiCheck.run(
      apiJob({ regions: [RECORDED_REGION, "Gone"] }),
      harness.deps,
    );

    expect(result.regionNames).toEqual([RECORDED_REGION]);
    expect(result.warnings.join(" ")).toContain("no region named Gone");
  });
});

describe("what it reads from an answer", () => {
  type Row = [number, boolean, boolean, OpenStackApiCheckOutcome];

  const ROWS: Array<Row> = [
    [200, true, false, "Answered"],
    [204, true, false, "Answered"],
    [300, true, false, "Answered"],
    [300, false, false, "Answered"],
    // Refused: the API answered, and it is the credential that may not.
    [403, true, false, "Refused"],
    [403, false, false, "Refused"],
    // Neutron on a project with no quota for security groups.
    [409, true, false, "Refused"],
    // A token Keystone just issued, refused: nobody could get past that.
    [401, true, false, "Failing"],
    [401, false, false, "Failing"],
    // Unless access rules are what said no.
    [401, true, true, "Refused"],
    // For the six recorded, the catalog's URL is wrong or a proxy has lost the service.
    [404, true, false, "Failing"],
    // For the rest, it can only mean a path here is out of date.
    [404, false, false, "Answered"],
    [400, true, false, "Answered"],
    [405, false, false, "Answered"],
    [429, true, false, "Failing"],
    [500, true, false, "Failing"],
    [502, false, false, "Failing"],
    [503, true, false, "Failing"],
    [504, true, false, "Failing"],
  ];

  test.each(ROWS)(
    "HTTP %i, known read %s, access rules %s: %s",
    (
      status: number,
      isKnownRead: boolean,
      hasAccessRules: boolean,
      outcome: OpenStackApiCheckOutcome,
    ) => {
      expect(
        judgeOpenStackApiAnswer({
          status: status,
          isKnownRead: isKnownRead,
          hasAccessRules: hasAccessRules,
        }),
      ).toBe(outcome);
    },
  );

  test("each catalog type goes by the service it is", () => {
    expect(getOpenStackServiceOfCatalogType("block-storage")).toBe(
      OpenStackServiceType.Volume,
    );
    expect(getOpenStackServiceOfCatalogType("volumev3")).toBe(
      OpenStackServiceType.Volume,
    );
    expect(getOpenStackServiceOfCatalogType("compute")).toBe(
      OpenStackServiceType.Compute,
    );
    expect(getOpenStackServiceOfCatalogType("load-balancer")).toBeNull();
    expect(getOpenStackServiceOfCatalogType("compute_legacy")).toBeNull();
  });
});

describe("the plan: whatever the catalog names, with no list to keep", () => {
  const catalog: Array<OpenStackCatalogService> = [
    {
      type: "identity",
      name: "keystone",
      endpoints: [
        { url: `${HOST}/identity`, interfaceName: "public", regionName: "one" },
      ],
    },
    {
      type: "block-storage",
      name: "cinder",
      endpoints: [
        {
          url: `${HOST}/volume/v3`,
          interfaceName: "public",
          regionName: "one",
        },
        {
          url: `https://internal.example/volume/v3`,
          interfaceName: "internal",
          regionName: "one",
        },
      ],
    },
    {
      // The same URL under its old type: asking it twice would tell nothing.
      type: "volumev3",
      name: "cinderv3",
      endpoints: [
        {
          url: `${HOST}/volume/v3`,
          interfaceName: "public",
          regionName: "one",
        },
      ],
    },
    {
      type: "load-balancer",
      name: "octavia",
      endpoints: [
        {
          url: `${HOST}/load-balancer/`,
          interfaceName: "public",
          regionName: "one",
        },
      ],
    },
    {
      type: "something-new",
      name: "new",
      endpoints: [
        { url: `${HOST}/new`, interfaceName: "public", regionName: "one" },
      ],
    },
    {
      type: "image",
      name: "glance",
      endpoints: [
        { url: `${HOST}/image`, interfaceName: "public", regionName: "two" },
      ],
    },
  ];

  const planned: (endpointInterface: string) => Array<string> = (
    endpointInterface: string,
  ): Array<string> => {
    return planOpenStackApiCheckReads({
      catalog: catalog,
      regions: ["one"],
      endpointInterface: endpointInterface,
      identityUrl: `${HOST}/identity/v3`,
    }).map((read: { url: string }): string => {
      return read.url;
    });
  };

  test("one read of each, on the interface asked for, in the region asked for", () => {
    expect(planned("public")).toEqual([
      `${HOST}/identity/v3/auth/projects`,
      `${HOST}/volume/v3/volumes?limit=1`,
      `${HOST}/load-balancer/v2/lbaas/loadbalancers?limit=1`,
      `${HOST}/new`,
    ]);
  });

  test("the interface a person picked is what they get", () => {
    expect(planned("internal")).toEqual([
      `${HOST}/identity/v3/auth/projects`,
      "https://internal.example/volume/v3/volumes?limit=1",
    ]);
  });
});

describe("when something is wrong", () => {
  test("a service that fails says so in its words, and costs the others nothing and no retry", async () => {
    const harness: Harness = createHarness({
      answer: (request: OpenStackHttpRequest) => {
        return request.url.includes("/compute/v2.1/")
          ? json(503, {
              computeFault: { code: 503, message: "It is restarting." },
            })
          : undefined;
      },
    });

    const result: OpenStackApiCheckResult = await OpenStackApiCheck.run(
      apiJob(),
      harness.deps,
    );

    expect(resultOf(result, "compute")).toMatchObject({
      outcome: "Failing",
      status: 503,
      message: "It is restarting.",
    });
    expect(resultOf(result, "network").outcome).toBe("Answered");
    // Exactly as many requests as a healthy cloud takes.
    expect(harness.log()).toEqual(EXPECTED_REQUESTS);
    expect(harness.clock.sleeps).toEqual([]);
  });

  test("a service that hangs up is failing, with the sentence for it", async () => {
    const harness: Harness = createHarness({
      answer: (request: OpenStackHttpRequest) => {
        if (request.url.includes("/networking/")) {
          const error: Error = new Error("connect ECONNREFUSED");
          (error as unknown as { code: string }).code = "ECONNREFUSED";
          throw error;
        }

        return undefined;
      },
    });

    const result: OpenStackApiCheckResult = await OpenStackApiCheck.run(
      apiJob(),
      harness.deps,
    );

    expect(resultOf(result, "network").outcome).toBe("Failing");
    expect(resultOf(result, "network").message).toContain(
      "refused the connection",
    );
  });

  test("a project's member refused Placement: the API answered, so it is not failing", async () => {
    const harness: Harness = createHarness({
      answer: (request: OpenStackHttpRequest) => {
        return request.url.includes("/placement/")
          ? json(403, {
              errors: [{ detail: "Policy does not allow this." }],
            })
          : undefined;
      },
    });

    const result: OpenStackApiCheckResult = await OpenStackApiCheck.run(
      apiJob(),
      harness.deps,
    );

    expect(resultOf(result, "placement")).toMatchObject({
      outcome: "Refused",
      status: 403,
      message: "Policy does not allow this.",
    });
  });

  test("access rules make a 401 a refusal, and without them it is a service that cannot check a token", async () => {
    const answer: (
      request: OpenStackHttpRequest,
    ) => OpenStackHttpResponse | undefined = (
      request: OpenStackHttpRequest,
    ): OpenStackHttpResponse | undefined => {
      return request.url.includes("/image/")
        ? json(401, { error: { message: "The request requires a login." } })
        : undefined;
    };

    const plain: OpenStackApiCheckResult = await OpenStackApiCheck.run(
      apiJob(),
      createHarness({ answer: answer }).deps,
    );

    expect(resultOf(plain, "image").outcome).toBe("Failing");

    const limited: OpenStackApiCheckResult = await OpenStackApiCheck.run(
      apiJob(),
      createHarness({
        answer: answer,
        tokenOverrides: {
          application_credential: {
            id: "x",
            access_rules: [{ service: "compute", method: "GET", path: "/**" }],
          },
        },
      }).deps,
    );

    expect(resultOf(limited, "image").outcome).toBe("Refused");
  });

  test("a URL the probe will not send a token to is not checked, and is said", async () => {
    const harness: Harness = createHarness({
      answer: (request: OpenStackHttpRequest) => {
        if (request.url.includes("/image/")) {
          throw new OpenStackEndpointRefusedError({
            kind: "insecure",
            message: "The catalog names http://x/image, plain HTTP.",
          });
        }

        return undefined;
      },
    });

    const result: OpenStackApiCheckResult = await OpenStackApiCheck.run(
      apiJob(),
      harness.deps,
    );

    expect(resultOf(result, "image").outcome).toBe("NotChecked");
    expect(result.warnings).toContain(
      "The catalog names http://x/image, plain HTTP.",
    );
  });

  test("Keystone failing: nothing else can be asked, and the next check asks it again at once", async () => {
    const harness: Harness = createHarness({
      answer: (request: OpenStackHttpRequest) => {
        return request.url.endsWith("/auth/tokens")
          ? { status: 503, headers: {}, body: "" }
          : undefined;
      },
    });

    const first: OpenStackApiCheckResult = await OpenStackApiCheck.run(
      apiJob(),
      harness.deps,
    );

    expect(first.token.status).toBe("Failed");
    expect(first.token.errorCode).toBe(
      OpenStackCollectionErrorCode.KeystoneFailing,
    );
    expect(first.services).toEqual([]);
    expect(harness.log()).toEqual(["POST /identity/v3/auth/tokens"]);

    harness.clock.advance(60_000);

    await OpenStackApiCheck.run(apiJob(), harness.deps);

    expect(harness.log()).toHaveLength(2);
  });

  test("a credential Keystone refuses is not repeated every minute, and still reads as failing", async () => {
    const harness: Harness = createHarness({
      answer: (request: OpenStackHttpRequest) => {
        return request.url.endsWith("/auth/tokens")
          ? { status: 401, headers: {}, body: "{}" }
          : undefined;
      },
    });

    const first: OpenStackApiCheckResult = await OpenStackApiCheck.run(
      apiJob(),
      harness.deps,
    );

    expect(first.token.status).toBe("Failed");
    expect(first.token.errorCode).toBe(
      OpenStackCollectionErrorCode.InvalidCredential,
    );

    harness.clock.advance(60_000);

    const second: OpenStackApiCheckResult = await OpenStackApiCheck.run(
      apiJob(),
      harness.deps,
    );

    expect(second.token.status).toBe("BackingOff");
    expect(second.token.message).toContain("locks an account");
    expect(harness.log()).toEqual(["POST /identity/v3/auth/tokens"]);

    // A corrected credential is tried at once.
    await OpenStackApiCheck.run(
      apiJob({
        credential: { kind: "applicationCredential", id: "new", secret: "x" },
      }),
      harness.deps,
    );

    expect(harness.log()).toHaveLength(2);
  });

  test("an address the probe will not use is said, with nothing sent", async () => {
    const harness: Harness = createHarness();

    const result: OpenStackApiCheckResult = await OpenStackApiCheck.run(
      apiJob({ authUrl: "http://keystone.example/v3" }),
      harness.deps,
    );

    expect(result.token.status).toBe("Failed");
    expect(result.token.errorCode).toBe(
      OpenStackCollectionErrorCode.InvalidAddress,
    );
    expect(harness.requests).toEqual([]);
  });
});

describe("certificates", () => {
  function certificateOf(
    overrides: Partial<OpenStackPresentedCertificate>,
  ): OpenStackPresentedCertificate {
    return {
      fingerprint256: "AB:CD",
      subject: "CN=openstack.example",
      issuer: "CN=A CA",
      isSelfSigned: false,
      validTo: "2027-01-01T00:00:00.000Z",
      host: "openstack.example",
      port: 443,
      ...overrides,
    };
  }

  test("each host's certificate, and what goes with it", async () => {
    const harness: Harness = createHarness({
      answer: (
        _request: OpenStackHttpRequest,
        report: (certificate: OpenStackPresentedCertificate) => void,
      ) => {
        // Told as a connection opens, as the real transport does.
        report(certificateOf({}));

        return undefined;
      },
    });

    const result: OpenStackApiCheckResult = await OpenStackApiCheck.run(
      apiJob(),
      harness.deps,
    );

    expect(result.certificates).toEqual([
      {
        host: "openstack.example",
        port: 443,
        validTo: "2027-01-01T00:00:00.000Z",
        subject: "CN=openstack.example",
        issuer: "CN=A CA",
        fingerprint256: "AB:CD",
        regionNames: [RECORDED_REGION],
        serviceTypes: [
          "identity",
          "image",
          "compute_legacy",
          "compute",
          "network",
          "block-storage",
          "placement",
        ],
      },
    ]);
  });

  test("a certificate that has already expired refuses the read, and is still reported", async () => {
    const expired: OpenStackPresentedCertificate = certificateOf({
      host: "openstack.example",
      validTo: "2026-01-01T00:00:00.000Z",
      verificationError: "CERT_HAS_EXPIRED",
    });

    const harness: Harness = createHarness({
      answer: (request: OpenStackHttpRequest) => {
        if (request.url.includes("/image/")) {
          throw new OpenStackCertificateError({
            kind: "untrusted",
            presentedCertificate: expired,
            message: "openstack.example:443's certificate has expired.",
          });
        }

        return undefined;
      },
    });

    const result: OpenStackApiCheckResult = await OpenStackApiCheck.run(
      apiJob(),
      harness.deps,
    );

    expect(resultOf(result, "image").outcome).toBe("Failing");
    expect(resultOf(result, "image").message).toContain("has expired");
    expect(result.certificates).toHaveLength(1);
    expect(result.certificates[0]?.validTo).toBe("2026-01-01T00:00:00.000Z");
  });

  test("Keystone's own expired certificate is reported though nothing else could be asked", async () => {
    const harness: Harness = createHarness({
      answer: () => {
        throw new OpenStackCertificateError({
          kind: "untrusted",
          presentedCertificate: certificateOf({
            validTo: "2026-01-01T00:00:00.000Z",
          }),
          message: "It has expired.",
        });
      },
    });

    const result: OpenStackApiCheckResult = await OpenStackApiCheck.run(
      apiJob(),
      harness.deps,
    );

    expect(result.token.status).toBe("Failed");
    expect(result.token.errorCode).toBe(
      OpenStackCollectionErrorCode.UntrustedCertificate,
    );
    expect(result.certificates[0]?.validTo).toBe("2026-01-01T00:00:00.000Z");
  });

  test("a certificate that does not say when it ends is left out", async () => {
    const harness: Harness = createHarness({
      answer: (
        _request: OpenStackHttpRequest,
        report: (certificate: OpenStackPresentedCertificate) => void,
      ) => {
        report(certificateOf({ validTo: undefined }));

        return undefined;
      },
    });

    const result: OpenStackApiCheckResult = await OpenStackApiCheck.run(
      apiJob(),
      harness.deps,
    );

    expect(result.certificates).toEqual([]);
  });
});
