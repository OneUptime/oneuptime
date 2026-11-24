import MarketplaceAwsCredentials, {
  MARKETPLACE_AWS_CREDENTIAL_SOURCES,
  MARKETPLACE_NO_AWS_CREDENTIALS_MESSAGE,
  MarketplaceAwsCredentialOptions,
} from "../../../../Server/Marketplace/Reporters/MarketplaceAwsCredentials";
import MarketplaceApiError from "../../../../Server/CloudMarketplace/MarketplaceApiError";
import AwsDefaultCredentialChain, {
  AwsChainCredentials,
  AwsChainHttpClient,
  AwsChainHttpRequest,
  AwsChainHttpResponse,
  AwsCredentialChainError,
  CONTAINER_CREDENTIALS_TIMEOUT_MS,
} from "Common/Server/Utils/Aws/AwsDefaultCredentialChain";
import { MarketplaceHttpResponse } from "Common/Server/Utils/Marketplace/MarketplaceHttp";
import {
  FakeHttpClient,
  createFakeHttpClient,
} from "Common/Tests/Server/Utils/Marketplace/MarketplaceTestKeys";
import { describe, expect, it } from "@jest/globals";

/*
 * The self-hosted AWS Marketplace container product calls the Metering
 * Service as the buyer's account, with the IAM role on OneUptime's
 * Kubernetes service account: IRSA (STS AssumeRoleWithWebIdentity with the
 * projected token), EKS Pod Identity or an ECS task role (the container
 * credentials endpoint), or keys in the environment, in that order - from
 * the server's own AWS credential chain (#7379), as the reporter looks in
 * it: never the profile files, never the EC2 instance profile.
 *
 * Moved from AwsWorkloadCredentials.test.ts, which drove the reporter's own
 * implementation of the same sources: every case is here, held to the
 * chain's answers. Where the two differ, the case says so.
 */

const ROLE_ARN: string = "arn:aws:iam::111122223333:role/oneuptime-marketplace";
const TOKEN_FILE: string =
  "/var/run/secrets/eks.amazonaws.com/serviceaccount/token";
const POD_IDENTITY_TOKEN_FILE: string =
  "/var/run/secrets/pods.eks.amazonaws.com/serviceaccount/eks-pod-identity-token";
const NOW: Date = new Date("2026-10-17T10:00:00.000Z");

type Environment = Record<string, string | undefined>;

const IRSA_ENV: Environment = {
  AWS_ROLE_ARN: ROLE_ARN,
  AWS_WEB_IDENTITY_TOKEN_FILE: TOKEN_FILE,
  AWS_REGION: "us-west-2",
  AWS_DEFAULT_REGION: "us-west-2",
  AWS_STS_REGIONAL_ENDPOINTS: "regional",
};

const POD_IDENTITY_ENV: Environment = {
  AWS_CONTAINER_CREDENTIALS_FULL_URI: "http://169.254.170.23/v1/credentials",
  AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE: POD_IDENTITY_TOKEN_FILE,
};

const stsJsonAnswer: (expiration: Date) => Record<string, unknown> = (
  expiration: Date,
): Record<string, unknown> => {
  return {
    AssumeRoleWithWebIdentityResponse: {
      AssumeRoleWithWebIdentityResult: {
        Credentials: {
          AccessKeyId: "ASIAEXAMPLEJSON",
          SecretAccessKey: "secret-from-json",
          SessionToken: "session-from-json",
          Expiration: expiration.getTime() / 1000,
        },
        AssumedRoleUser: {
          Arn: `${ROLE_ARN}/oneuptime-marketplace-1`,
        },
      },
    },
  };
};

const stsXmlAnswer: (expiration: Date) => string = (
  expiration: Date,
): string => {
  return `<AssumeRoleWithWebIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/">
  <AssumeRoleWithWebIdentityResult>
    <Credentials>
      <SessionToken>session&amp;from&lt;xml&gt;</SessionToken>
      <SecretAccessKey>secret-from-xml</SecretAccessKey>
      <Expiration>${expiration.toISOString()}</Expiration>
      <AccessKeyId>ASIAEXAMPLEXML</AccessKeyId>
    </Credentials>
  </AssumeRoleWithWebIdentityResult>
</AssumeRoleWithWebIdentityResponse>`;
};

const stsErrorAnswer: (code: string, message: string) => string = (
  code: string,
  message: string,
): string => {
  return `<ErrorResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/">
  <Error><Type>Sender</Type><Code>${code}</Code><Message>${message}</Message></Error>
  <RequestId>c6104cbe-af31-11e0-8154-cbc7ccf896c7</RequestId>
</ErrorResponse>`;
};

interface Clock {
  now: () => Date;
  advance: (ms: number) => void;
}

const createClock: () => Clock = (): Clock => {
  let current: number = NOW.getTime();

  return {
    now: (): Date => {
      return new Date(current);
    },
    advance: (ms: number): void => {
      current += ms;
    },
  };
};

interface Files {
  contents: Record<string, string>;
  reads: Array<string>;
  readFile: (path: string) => Promise<string>;
}

const createFiles: (contents: Record<string, string>) => Files = (
  contents: Record<string, string>,
): Files => {
  const files: Files = {
    contents: contents,
    reads: [],
    readFile: async (path: string): Promise<string> => {
      files.reads.push(path);

      if (!(path in files.contents)) {
        throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      }

      return files.contents[path]!;
    },
  };

  return files;
};

// Every request the chain makes, as the fake marketplace client takes one.
interface ChainHttp {
  requests: Array<AwsChainHttpRequest>;
  client: AwsChainHttpClient;
}

const chainHttpOf: (fake: FakeHttpClient) => ChainHttp = (
  fake: FakeHttpClient,
): ChainHttp => {
  const requests: Array<AwsChainHttpRequest> = [];

  return {
    requests: requests,
    client: async (
      request: AwsChainHttpRequest,
    ): Promise<AwsChainHttpResponse> => {
      requests.push(request);

      const answer: MarketplaceHttpResponse = await fake.client({
        method: request.method,
        url: request.url,
        headers: request.headers,
        ...(request.body !== undefined ? { body: request.body } : {}),
        timeoutInMs: request.timeoutMs,
      });

      return { status: answer.status, bodyText: answer.body };
    },
  };
};

// The reporter's chain, over a fake environment, files and HTTP.
const createChain: (
  options: Omit<MarketplaceAwsCredentialOptions, "httpClient"> & {
    http?: ChainHttp | undefined;
  },
) => AwsDefaultCredentialChain = (
  options: Omit<MarketplaceAwsCredentialOptions, "httpClient"> & {
    http?: ChainHttp | undefined;
  },
): AwsDefaultCredentialChain => {
  const { http, ...rest } = options;

  return MarketplaceAwsCredentials.createChain({
    ...rest,
    httpClient: (http || chainHttpOf(createFakeHttpClient([]))).client,
  });
};

// What the reporter is told when the chain finds nothing it can use.
const expectReporterError: (
  promise: Promise<unknown>,
) => Promise<MarketplaceApiError> = async (
  promise: Promise<unknown>,
): Promise<MarketplaceApiError> => {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(AwsCredentialChainError);

    const converted: unknown =
      MarketplaceAwsCredentials.toMarketplaceApiError(err);

    expect(converted).toBeInstanceOf(MarketplaceApiError);
    expect((converted as MarketplaceApiError).isRetryable).toBe(
      (err as AwsCredentialChainError).isRetryable,
    );
    return converted as MarketplaceApiError;
  }

  throw new Error("Expected the chain to fail, but nothing was thrown.");
};

describe("MarketplaceAwsCredentials.getSource", () => {
  it("prefers IRSA, then EKS Pod Identity, then keys in the environment", () => {
    expect(
      MarketplaceAwsCredentials.getSource({
        ...IRSA_ENV,
        ...POD_IDENTITY_ENV,
        AWS_ACCESS_KEY_ID: "AKIDEXAMPLE",
        AWS_SECRET_ACCESS_KEY: "secret",
      }),
    ).toBe("web-identity");

    expect(
      MarketplaceAwsCredentials.getSource({
        ...POD_IDENTITY_ENV,
        AWS_ACCESS_KEY_ID: "AKIDEXAMPLE",
        AWS_SECRET_ACCESS_KEY: "secret",
      }),
    ).toBe("container");

    expect(
      MarketplaceAwsCredentials.getSource({
        AWS_ACCESS_KEY_ID: "AKIDEXAMPLE",
        AWS_SECRET_ACCESS_KEY: "secret",
      }),
    ).toBe("environment");

    // The reporter's own order, not the SDKs' (keys first).
    expect(MARKETPLACE_AWS_CREDENTIAL_SOURCES).toEqual([
      "web-identity",
      "container",
      "environment",
    ]);
  });

  it("needs both halves of IRSA; half a key pair is a source that says which half is missing", async () => {
    expect(
      MarketplaceAwsCredentials.getSource({ AWS_ROLE_ARN: ROLE_ARN }),
    ).toBeNull();
    expect(
      MarketplaceAwsCredentials.getSource({
        AWS_WEB_IDENTITY_TOKEN_FILE: TOKEN_FILE,
      }),
    ).toBeNull();
    expect(MarketplaceAwsCredentials.getSource({})).toBeNull();

    // The reporter called half a pair no source; the chain names the missing half.
    expect(
      MarketplaceAwsCredentials.getSource({ AWS_ACCESS_KEY_ID: "AKIDEXAMPLE" }),
    ).toBe("environment");

    const error: MarketplaceApiError = await expectReporterError(
      createChain({
        env: { AWS_ACCESS_KEY_ID: "AKIDEXAMPLE" },
      }).getCredentials(),
    );

    expect(error.isRetryable).toBe(false);
    expect(error.message).toBe(
      "AWS_ACCESS_KEY_ID is set on this server, but AWS_SECRET_ACCESS_KEY is not. Set both, or neither to use the server's IAM role.",
    );
  });

  it("treats blank values as unset", () => {
    expect(
      MarketplaceAwsCredentials.getSource({
        AWS_ROLE_ARN: "  ",
        AWS_WEB_IDENTITY_TOKEN_FILE: TOKEN_FILE,
        AWS_CONTAINER_CREDENTIALS_FULL_URI: "",
      }),
    ).toBeNull();
  });

  it("never the profile files, nor the EC2 instance profile: on EKS that is the node's role", () => {
    expect(
      MarketplaceAwsCredentials.getSource({
        AWS_PROFILE: "oneuptime",
        AWS_CONFIG_FILE: "/etc/aws/config",
      }),
    ).toBeNull();
    // Nothing set up: the chain alone would ask the instance metadata service.
    expect(new AwsDefaultCredentialChain({ env: {} }).getSource()).toBe(
      "instance-profile",
    );
    expect(MarketplaceAwsCredentials.getSource({})).toBeNull();
  });
});

describe("MarketplaceAwsCredentials.getRegion", () => {
  it("reads the Region EKS sets, then the default Region, then the fallback", () => {
    expect(
      MarketplaceAwsCredentials.getRegion({
        AWS_REGION: "eu-central-1",
        AWS_DEFAULT_REGION: "us-east-1",
      }),
    ).toBe("eu-central-1");
    expect(
      MarketplaceAwsCredentials.getRegion({
        AWS_DEFAULT_REGION: "ap-southeast-2",
      }),
    ).toBe("ap-southeast-2");
    expect(MarketplaceAwsCredentials.getRegion({}, "us-gov-west-1")).toBe(
      "us-gov-west-1",
    );
  });

  it("skips values that are not Region codes", () => {
    expect(
      MarketplaceAwsCredentials.getRegion(
        { AWS_REGION: "not a region", AWS_DEFAULT_REGION: "https://x" },
        "us-east-2",
      ),
    ).toBe("us-east-2");
    expect(MarketplaceAwsCredentials.getRegion({}, "")).toBeNull();
    expect(MarketplaceAwsCredentials.getRegion({})).toBeNull();
    expect(
      MarketplaceAwsCredentials.getRegion({}, "mars.evil.test"),
    ).toBeNull();
  });
});

describe("MarketplaceAwsCredentials endpoints", () => {
  it("uses the regional STS endpoint, under amazonaws.com.cn in China", () => {
    expect(AwsDefaultCredentialChain.getStsHost("us-west-2")).toBe(
      "sts.us-west-2.amazonaws.com",
    );
    expect(AwsDefaultCredentialChain.getStsHost("cn-north-1")).toBe(
      "sts.cn-north-1.amazonaws.com.cn",
    );
  });

  it("allows plain http only to the credential agents' own addresses", () => {
    const allowed: Array<string> = [
      "http://169.254.170.23/v1/credentials",
      "http://[fd00:ec2::23]/v1/credentials",
      "http://169.254.170.2/v2/credentials/abc",
      "http://127.0.0.1:8080/creds",
      "https://credentials.example.com/v1",
    ];
    const refused: Array<string> = [
      "http://169.254.169.254/latest/meta-data/iam/security-credentials/role",
      "http://attacker.example.com/creds",
      "file:///etc/passwd",
      "ftp://169.254.170.23/",
      "not a url",
    ];

    for (const uri of allowed) {
      expect(
        AwsDefaultCredentialChain.isAllowedContainerCredentialsUri(uri),
      ).toBe(true);
    }

    for (const uri of refused) {
      expect(
        AwsDefaultCredentialChain.isAllowedContainerCredentialsUri(uri),
      ).toBe(false);
    }
  });
});

describe("MarketplaceAwsCredentials with IRSA", () => {
  it("trades the projected token for temporary credentials with an unsigned regional STS call", async () => {
    const http: ChainHttp = chainHttpOf(
      createFakeHttpClient([
        {
          status: 200,
          body: stsJsonAnswer(new Date(NOW.getTime() + 3600 * 1000)),
        },
      ]),
    );
    const files: Files = createFiles({ [TOKEN_FILE]: "projected.jwt.token\n" });

    const credentials: AwsChainCredentials = await createChain({
      env: IRSA_ENV,
      readFile: files.readFile,
      http: http,
      now: (): Date => {
        return NOW;
      },
    }).getCredentials({ regionHint: "us-west-2" });

    expect(credentials).toEqual({
      accessKeyId: "ASIAEXAMPLEJSON",
      secretAccessKey: "secret-from-json",
      sessionToken: "session-from-json",
      expiresAt: new Date(NOW.getTime() + 3600 * 1000),
      source: "web-identity",
    });

    expect(http.requests).toHaveLength(1);
    const request: AwsChainHttpRequest = http.requests[0]!;
    expect(request.method).toBe("POST");
    expect(request.url).toBe("https://sts.us-west-2.amazonaws.com/");
    expect(request.headers).toMatchObject({
      "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
      Accept: "application/json",
    });
    // Unsigned: the web identity token is the proof.
    expect(request.headers["Authorization"]).toBeUndefined();

    const form: URLSearchParams = new URLSearchParams(request.body!);
    expect(form.get("Action")).toBe("AssumeRoleWithWebIdentity");
    expect(form.get("Version")).toBe("2011-06-15");
    expect(form.get("RoleArn")).toBe(ROLE_ARN);
    expect(form.get("WebIdentityToken")).toBe("projected.jwt.token");
    // STS's default session: an hour, as the reporter asked for by name.
    expect(form.get("DurationSeconds")).toBeNull();
    expect(form.get("RoleSessionName")).toBe(
      `oneuptime-marketplace-${NOW.getTime()}`,
    );
  });

  it("keeps the role session name EKS asks for", async () => {
    const http: ChainHttp = chainHttpOf(
      createFakeHttpClient([
        { status: 200, body: stsXmlAnswer(new Date(NOW.getTime() + 3600_000)) },
      ]),
    );

    await createChain({
      env: { ...IRSA_ENV, AWS_ROLE_SESSION_NAME: "botocore-session-1" },
      readFile: createFiles({ [TOKEN_FILE]: "token" }).readFile,
      http: http,
    }).getCredentials();

    expect(
      new URLSearchParams(http.requests[0]!.body!).get("RoleSessionName"),
    ).toBe("botocore-session-1");
  });

  it("reads STS's XML answer, entities decoded", async () => {
    const expiration: Date = new Date(NOW.getTime() + 3600 * 1000);
    const http: ChainHttp = chainHttpOf(
      createFakeHttpClient([{ status: 200, body: stsXmlAnswer(expiration) }]),
    );

    const credentials: AwsChainCredentials = await createChain({
      env: IRSA_ENV,
      readFile: createFiles({ [TOKEN_FILE]: "token" }).readFile,
      http: http,
      now: (): Date => {
        return NOW;
      },
    }).getCredentials();

    expect(credentials).toEqual({
      accessKeyId: "ASIAEXAMPLEXML",
      secretAccessKey: "secret-from-xml",
      sessionToken: "session&from<xml>",
      expiresAt: expiration,
      source: "web-identity",
    });
  });

  it("reuses the credentials until five minutes before they expire, then re-reads the rotated token", async () => {
    const clock: Clock = createClock();
    const http: ChainHttp = chainHttpOf(
      createFakeHttpClient([
        {
          status: 200,
          body: stsJsonAnswer(new Date(NOW.getTime() + 3600_000)),
        },
        {
          status: 200,
          body: stsJsonAnswer(new Date(NOW.getTime() + 2 * 3600_000)),
        },
      ]),
    );
    const files: Files = createFiles({ [TOKEN_FILE]: "first-token" });

    const chain: AwsDefaultCredentialChain = createChain({
      env: IRSA_ENV,
      readFile: files.readFile,
      http: http,
      now: clock.now,
    });

    await chain.getCredentials();
    clock.advance(54 * 60 * 1000);
    await chain.getCredentials();
    expect(http.requests).toHaveLength(1);

    // 55 minutes in: five minutes left, so it refreshes - with the kubelet's new token.
    clock.advance(60 * 1000);
    files.contents[TOKEN_FILE] = "rotated-token";
    await chain.getCredentials();

    expect(http.requests).toHaveLength(2);
    expect(
      new URLSearchParams(http.requests[1]!.body!).get("WebIdentityToken"),
    ).toBe("rotated-token");
  });

  it("shares one exchange between concurrent callers", async () => {
    const http: ChainHttp = chainHttpOf(
      createFakeHttpClient([
        {
          status: 200,
          body: stsJsonAnswer(new Date(NOW.getTime() + 3600_000)),
        },
      ]),
    );

    const chain: AwsDefaultCredentialChain = createChain({
      env: IRSA_ENV,
      readFile: createFiles({ [TOKEN_FILE]: "token" }).readFile,
      http: http,
      now: (): Date => {
        return NOW;
      },
    });

    const results: Array<AwsChainCredentials> = await Promise.all([
      chain.getCredentials(),
      chain.getCredentials(),
      chain.getCredentials(),
    ]);

    expect(http.requests).toHaveLength(1);
    expect(results[0]).toEqual(results[1]);
    expect(results[1]).toEqual(results[2]);
  });

  it("fetches again after invalidate()", async () => {
    const http: ChainHttp = chainHttpOf(
      createFakeHttpClient([
        {
          status: 200,
          body: stsJsonAnswer(new Date(NOW.getTime() + 3600_000)),
        },
        {
          status: 200,
          body: stsJsonAnswer(new Date(NOW.getTime() + 3600_000)),
        },
      ]),
    );

    const chain: AwsDefaultCredentialChain = createChain({
      env: IRSA_ENV,
      readFile: createFiles({ [TOKEN_FILE]: "token" }).readFile,
      http: http,
      now: (): Date => {
        return NOW;
      },
    });

    await chain.getCredentials();
    chain.invalidate();
    await chain.getCredentials();

    expect(http.requests).toHaveLength(2);
  });

  it("refuses for good when STS rejects the token, and says why", async () => {
    const http: ChainHttp = chainHttpOf(
      createFakeHttpClient([
        {
          status: 400,
          body: stsErrorAnswer(
            "InvalidIdentityToken",
            "No OpenIDConnect provider found in your account for https://oidc.eks.us-west-2.amazonaws.com/id/ABC",
          ),
        },
      ]),
    );

    const error: MarketplaceApiError = await expectReporterError(
      createChain({
        env: IRSA_ENV,
        readFile: createFiles({ [TOKEN_FILE]: "projected.jwt.token" }).readFile,
        http: http,
      }).getCredentials(),
    );

    // The chain says the HTTP status in its words, not as a field of its own.
    expect(error.message).toContain("HTTP 400");
    expect(error.isRetryable).toBe(false);
    expect(error.message).toContain("InvalidIdentityToken");
    expect(error.message).toContain("No OpenIDConnect provider");
    // The token never reaches an error message.
    expect(error.message).not.toContain("WebIdentityToken=");
    expect(error.message).not.toContain("projected.jwt.token");
  });

  it("asks again later when STS throttles, fails or cannot be reached", async () => {
    const answers: Array<
      { status: number; body: string | Record<string, unknown> } | Error
    > = [
      { status: 400, body: stsErrorAnswer("Throttling", "Rate exceeded") },
      {
        status: 400,
        body: stsErrorAnswer(
          "IDPCommunicationError",
          "Could not reach the identity provider",
        ),
      },
      { status: 503, body: "Service Unavailable" },
      new Error("socket hang up"),
    ];

    for (const answer of answers) {
      const error: MarketplaceApiError = await expectReporterError(
        createChain({
          env: IRSA_ENV,
          readFile: createFiles({ [TOKEN_FILE]: "token" }).readFile,
          http: chainHttpOf(createFakeHttpClient([answer])),
        }).getCredentials(),
      );

      expect(error.isRetryable).toBe(true);
    }
  });

  it("does not take an answer without credentials", async () => {
    const error: MarketplaceApiError = await expectReporterError(
      createChain({
        env: IRSA_ENV,
        readFile: createFiles({ [TOKEN_FILE]: "token" }).readFile,
        http: chainHttpOf(
          createFakeHttpClient([
            {
              status: 200,
              body: {
                AssumeRoleWithWebIdentityResponse: {
                  AssumeRoleWithWebIdentityResult: {},
                },
              },
            },
          ]),
        ),
      }).getCredentials(),
    );

    expect(error.message).toContain("without credentials");
  });

  it("asks STS in the Region the reporter meters in when the pod names none", async () => {
    /*
     * The reporter refused here (AWS_REGION is not set), though the
     * installation named its Region (ENTERPRISE_MARKETPLACE_AWS_REGION): the
     * chain asks STS where the usage goes instead.
     */
    const http: ChainHttp = chainHttpOf(
      createFakeHttpClient([
        {
          status: 200,
          body: stsJsonAnswer(new Date(NOW.getTime() + 3600_000)),
        },
      ]),
    );

    await createChain({
      env: {
        AWS_ROLE_ARN: ROLE_ARN,
        AWS_WEB_IDENTITY_TOKEN_FILE: TOKEN_FILE,
      },
      readFile: createFiles({ [TOKEN_FILE]: "token" }).readFile,
      http: http,
    }).getCredentials({ regionHint: "ap-southeast-2" });

    expect(http.requests).toHaveLength(1);
    expect(http.requests[0]!.url).toBe(
      "https://sts.ap-southeast-2.amazonaws.com/",
    );
  });

  it("reports a token file that is missing or empty, without calling STS", async () => {
    for (const files of [
      createFiles({}),
      createFiles({ [TOKEN_FILE]: "  \n" }),
    ]) {
      const http: ChainHttp = chainHttpOf(createFakeHttpClient([]));

      const error: MarketplaceApiError = await expectReporterError(
        createChain({
          env: IRSA_ENV,
          readFile: files.readFile,
          http: http,
        }).getCredentials(),
      );

      expect(error.message).toContain(TOKEN_FILE);
      expect(http.requests).toHaveLength(0);
    }
  });
});

describe("MarketplaceAwsCredentials with EKS Pod Identity and Amazon ECS", () => {
  it("asks the node agent, authorised by the pod's token", async () => {
    const http: ChainHttp = chainHttpOf(
      createFakeHttpClient([
        {
          status: 200,
          body: {
            AccessKeyId: "ASIAPODIDENTITY",
            SecretAccessKey: "pod-identity-secret",
            Token: "pod-identity-session",
            AccountId: "111122223333",
            Expiration: "2026-10-17T16:00:00Z",
          },
        },
      ]),
    );

    const credentials: AwsChainCredentials = await createChain({
      env: POD_IDENTITY_ENV,
      readFile: createFiles({
        [POD_IDENTITY_TOKEN_FILE]: "pod-identity-token\n",
      }).readFile,
      http: http,
    }).getCredentials();

    expect(credentials).toEqual({
      accessKeyId: "ASIAPODIDENTITY",
      secretAccessKey: "pod-identity-secret",
      sessionToken: "pod-identity-session",
      expiresAt: new Date("2026-10-17T16:00:00Z"),
      source: "container",
    });

    const request: AwsChainHttpRequest = http.requests[0]!;
    expect(request.method).toBe("GET");
    expect(request.url).toBe("http://169.254.170.23/v1/credentials");
    expect(request.headers["Authorization"]).toBe("pod-identity-token");
    // The chain gives a local agent two seconds; the reporter gave it five.
    expect(request.timeoutMs).toBe(CONTAINER_CREDENTIALS_TIMEOUT_MS);
  });

  it("takes an inline authorization token when there is no token file", async () => {
    const http: ChainHttp = chainHttpOf(
      createFakeHttpClient([
        {
          status: 200,
          body: {
            AccessKeyId: "ASIAINLINE",
            SecretAccessKey: "inline-secret",
            Token: "inline-session",
            Expiration: "2026-10-17T16:00:00Z",
          },
        },
      ]),
    );

    await createChain({
      env: {
        AWS_CONTAINER_CREDENTIALS_FULL_URI: "http://127.0.0.1:9911/creds",
        AWS_CONTAINER_AUTHORIZATION_TOKEN: "inline-token",
      },
      http: http,
    }).getCredentials();

    expect(http.requests[0]!.headers["Authorization"]).toBe("inline-token");
  });

  it("an Amazon ECS task role too, now: the relative path on 169.254.170.2", async () => {
    const http: ChainHttp = chainHttpOf(
      createFakeHttpClient([
        {
          status: 200,
          body: {
            AccessKeyId: "ASIAECSTASKROLE",
            SecretAccessKey: "ecs-secret",
            Token: "ecs-session",
            Expiration: "2026-10-17T16:00:00Z",
          },
        },
      ]),
    );

    const credentials: AwsChainCredentials = await createChain({
      env: { AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "/v2/credentials/7f1a" },
      http: http,
    }).getCredentials();

    expect(credentials.accessKeyId).toBe("ASIAECSTASKROLE");
    expect(credentials.source).toBe("container");
    expect(http.requests[0]!.url).toBe(
      "http://169.254.170.2/v2/credentials/7f1a",
    );
    expect(http.requests[0]!.headers["Authorization"]).toBeUndefined();
  });

  it("never asks a host that is not a credential agent over plain http", async () => {
    const http: ChainHttp = chainHttpOf(createFakeHttpClient([]));

    const error: MarketplaceApiError = await expectReporterError(
      createChain({
        env: {
          AWS_CONTAINER_CREDENTIALS_FULL_URI:
            "http://169.254.169.254/latest/meta-data/",
        },
        http: http,
      }).getCredentials(),
    );

    expect(error.isRetryable).toBe(false);
    expect(http.requests).toHaveLength(0);
  });

  it("reports an agent that refuses or answers without credentials", async () => {
    const refused: MarketplaceApiError = await expectReporterError(
      createChain({
        env: POD_IDENTITY_ENV,
        readFile: createFiles({ [POD_IDENTITY_TOKEN_FILE]: "token" }).readFile,
        http: chainHttpOf(
          createFakeHttpClient([
            { status: 400, body: { message: "Service account token invalid" } },
          ]),
        ),
      }).getCredentials(),
    );

    expect(refused.message).toContain("HTTP 400");
    expect(refused.isRetryable).toBe(false);

    const empty: MarketplaceApiError = await expectReporterError(
      createChain({
        env: POD_IDENTITY_ENV,
        readFile: createFiles({ [POD_IDENTITY_TOKEN_FILE]: "token" }).readFile,
        http: chainHttpOf(createFakeHttpClient([{ status: 200, body: {} }])),
      }).getCredentials(),
    );

    expect(empty.isRetryable).toBe(true);
  });
});

describe("MarketplaceAwsCredentials with keys in the environment", () => {
  it("uses them as they are, with no exchange and no expiry", async () => {
    const http: ChainHttp = chainHttpOf(createFakeHttpClient([]));

    const credentials: AwsChainCredentials = await createChain({
      env: {
        AWS_ACCESS_KEY_ID: "AKIDEXAMPLE",
        AWS_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
        AWS_SESSION_TOKEN: "session",
      },
      http: http,
    }).getCredentials();

    expect(credentials).toEqual({
      accessKeyId: "AKIDEXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      sessionToken: "session",
      expiresAt: null,
      source: "environment",
    });
    expect(http.requests).toHaveLength(0);
  });
});

describe("MarketplaceAwsCredentials with no credentials", () => {
  it("tells the operator to give the service account an IAM role, and asks nothing - not the EC2 metadata service", async () => {
    const http: ChainHttp = chainHttpOf(createFakeHttpClient([]));

    const error: MarketplaceApiError = await expectReporterError(
      createChain({ env: {}, http: http }).getCredentials(),
    );

    expect(error.isRetryable).toBe(false);
    expect(error.message).toBe(MARKETPLACE_NO_AWS_CREDENTIALS_MESSAGE);
    expect(error.message).toContain("IAM role");
    expect(http.requests).toHaveLength(0);
  });

  it("leaves an error that is not the chain's as it is", () => {
    const other: Error = new Error("something else");

    expect(MarketplaceAwsCredentials.toMarketplaceApiError(other)).toBe(other);
  });
});

describe("MarketplaceAwsCredentials XML reading", () => {
  it("reads the first element's text and decodes the predefined entities once", () => {
    expect(
      AwsDefaultCredentialChain.readXmlElement(
        "<a><Code>x&amp;lt;y</Code><Code>second</Code></a>",
        "Code",
      ),
    ).toBe("x&lt;y");
    expect(
      AwsDefaultCredentialChain.readXmlElement("<a></a>", "Code"),
    ).toBeNull();
    expect(
      AwsDefaultCredentialChain.readXmlElement("<Code>open", "Code"),
    ).toBeNull();
  });

  it("reads the error code of an XML or JSON STS error", () => {
    expect(
      AwsDefaultCredentialChain.readStsError(
        stsErrorAnswer("AccessDenied", "Not authorized"),
      ).code,
    ).toBe("AccessDenied");
    expect(
      AwsDefaultCredentialChain.readStsError(
        JSON.stringify({ Error: { Code: "ExpiredTokenException" } }),
      ).code,
    ).toBe("ExpiredTokenException");
    expect(AwsDefaultCredentialChain.readStsError("").code).toBe("");
  });
});
