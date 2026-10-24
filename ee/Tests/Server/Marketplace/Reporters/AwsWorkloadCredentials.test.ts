import AwsWorkloadCredentialsProvider, {
  AWS_WEB_IDENTITY_SESSION_DURATION_IN_SECONDS,
  AwsWorkloadCredentials,
  AwsWorkloadEnvironment,
} from "../../../../Server/Marketplace/Reporters/AwsWorkloadCredentials";
import MarketplaceApiError from "../../../../Server/CloudMarketplace/MarketplaceApiError";
import { MarketplaceHttpRequest } from "Common/Server/Utils/Marketplace/MarketplaceHttp";
import {
  FakeHttpClient,
  createFakeHttpClient,
} from "Common/Tests/Server/Utils/Marketplace/MarketplaceTestKeys";
import { describe, expect, it } from "@jest/globals";

/*
 * The self-hosted AWS Marketplace container product calls the Metering
 * Service as the buyer's account, with the IAM role on OneUptime's
 * Kubernetes service account: IRSA (STS AssumeRoleWithWebIdentity with the
 * projected token), EKS Pod Identity (the node agent), or keys in the
 * environment, in that order.
 */

const ROLE_ARN: string = "arn:aws:iam::111122223333:role/oneuptime-marketplace";
const TOKEN_FILE: string =
  "/var/run/secrets/eks.amazonaws.com/serviceaccount/token";
const POD_IDENTITY_TOKEN_FILE: string =
  "/var/run/secrets/pods.eks.amazonaws.com/serviceaccount/eks-pod-identity-token";
const NOW: Date = new Date("2026-10-17T10:00:00.000Z");

const IRSA_ENV: AwsWorkloadEnvironment = {
  AWS_ROLE_ARN: ROLE_ARN,
  AWS_WEB_IDENTITY_TOKEN_FILE: TOKEN_FILE,
  AWS_REGION: "us-west-2",
  AWS_DEFAULT_REGION: "us-west-2",
  AWS_STS_REGIONAL_ENDPOINTS: "regional",
};

const POD_IDENTITY_ENV: AwsWorkloadEnvironment = {
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

const expectMarketplaceError: (
  promise: Promise<unknown>,
) => Promise<MarketplaceApiError> = async (
  promise: Promise<unknown>,
): Promise<MarketplaceApiError> => {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(MarketplaceApiError);
    return err as MarketplaceApiError;
  }

  throw new Error("Expected a MarketplaceApiError, but nothing was thrown.");
};

describe("AwsWorkloadCredentialsProvider.getSource", () => {
  it("prefers IRSA, then EKS Pod Identity, then keys in the environment", () => {
    expect(
      AwsWorkloadCredentialsProvider.getSource({
        ...IRSA_ENV,
        ...POD_IDENTITY_ENV,
        AWS_ACCESS_KEY_ID: "AKIDEXAMPLE",
        AWS_SECRET_ACCESS_KEY: "secret",
      }),
    ).toBe("web-identity");

    expect(
      AwsWorkloadCredentialsProvider.getSource({
        ...POD_IDENTITY_ENV,
        AWS_ACCESS_KEY_ID: "AKIDEXAMPLE",
        AWS_SECRET_ACCESS_KEY: "secret",
      }),
    ).toBe("pod-identity");

    expect(
      AwsWorkloadCredentialsProvider.getSource({
        AWS_ACCESS_KEY_ID: "AKIDEXAMPLE",
        AWS_SECRET_ACCESS_KEY: "secret",
      }),
    ).toBe("environment");
  });

  it("needs both halves of IRSA and of a key pair", () => {
    expect(
      AwsWorkloadCredentialsProvider.getSource({ AWS_ROLE_ARN: ROLE_ARN }),
    ).toBeNull();
    expect(
      AwsWorkloadCredentialsProvider.getSource({
        AWS_WEB_IDENTITY_TOKEN_FILE: TOKEN_FILE,
      }),
    ).toBeNull();
    expect(
      AwsWorkloadCredentialsProvider.getSource({
        AWS_ACCESS_KEY_ID: "AKIDEXAMPLE",
      }),
    ).toBeNull();
    expect(AwsWorkloadCredentialsProvider.getSource({})).toBeNull();
  });

  it("treats blank values as unset", () => {
    expect(
      AwsWorkloadCredentialsProvider.getSource({
        AWS_ROLE_ARN: "  ",
        AWS_WEB_IDENTITY_TOKEN_FILE: TOKEN_FILE,
        AWS_CONTAINER_CREDENTIALS_FULL_URI: "",
      }),
    ).toBeNull();
  });
});

describe("AwsWorkloadCredentialsProvider.getRegion", () => {
  it("reads the Region EKS sets, then the default Region, then the fallback", () => {
    expect(
      AwsWorkloadCredentialsProvider.getRegion({
        AWS_REGION: "eu-central-1",
        AWS_DEFAULT_REGION: "us-east-1",
      }),
    ).toBe("eu-central-1");
    expect(
      AwsWorkloadCredentialsProvider.getRegion({
        AWS_DEFAULT_REGION: "ap-southeast-2",
      }),
    ).toBe("ap-southeast-2");
    expect(AwsWorkloadCredentialsProvider.getRegion({}, "us-gov-west-1")).toBe(
      "us-gov-west-1",
    );
  });

  it("skips values that are not Region codes", () => {
    expect(
      AwsWorkloadCredentialsProvider.getRegion(
        { AWS_REGION: "not a region", AWS_DEFAULT_REGION: "https://x" },
        "us-east-2",
      ),
    ).toBe("us-east-2");
    expect(AwsWorkloadCredentialsProvider.getRegion({}, "")).toBeNull();
    expect(AwsWorkloadCredentialsProvider.getRegion({})).toBeNull();
  });
});

describe("AwsWorkloadCredentialsProvider endpoints", () => {
  it("uses the regional STS endpoint, under amazonaws.com.cn in China", () => {
    expect(AwsWorkloadCredentialsProvider.getStsHost("us-west-2")).toBe(
      "sts.us-west-2.amazonaws.com",
    );
    expect(AwsWorkloadCredentialsProvider.getStsHost("cn-north-1")).toBe(
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
      expect(AwsWorkloadCredentialsProvider.isAllowedCredentialsUri(uri)).toBe(
        true,
      );
    }

    for (const uri of refused) {
      expect(AwsWorkloadCredentialsProvider.isAllowedCredentialsUri(uri)).toBe(
        false,
      );
    }
  });
});

describe("AwsWorkloadCredentialsProvider with IRSA", () => {
  it("trades the projected token for temporary credentials with an unsigned regional STS call", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      {
        status: 200,
        body: stsJsonAnswer(new Date(NOW.getTime() + 3600 * 1000)),
      },
    ]);
    const files: Files = createFiles({ [TOKEN_FILE]: "projected.jwt.token\n" });

    const provider: AwsWorkloadCredentialsProvider =
      new AwsWorkloadCredentialsProvider({
        env: IRSA_ENV,
        readFile: files.readFile,
        httpClient: http.client,
        now: (): Date => {
          return NOW;
        },
      });

    const credentials: AwsWorkloadCredentials = await provider.getCredentials();

    expect(credentials).toEqual({
      accessKeyId: "ASIAEXAMPLEJSON",
      secretAccessKey: "secret-from-json",
      sessionToken: "session-from-json",
      expiresAt: new Date(NOW.getTime() + 3600 * 1000),
    });

    expect(http.requests).toHaveLength(1);
    const request: MarketplaceHttpRequest = http.requests[0]!;
    expect(request.method).toBe("POST");
    expect(request.url).toBe("https://sts.us-west-2.amazonaws.com/");
    expect(request.headers).toMatchObject({
      "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
      Accept: "application/json",
    });
    // Unsigned: the web identity token is the proof.
    expect(request.headers!["Authorization"]).toBeUndefined();

    const form: URLSearchParams = new URLSearchParams(request.body!);
    expect(form.get("Action")).toBe("AssumeRoleWithWebIdentity");
    expect(form.get("Version")).toBe("2011-06-15");
    expect(form.get("RoleArn")).toBe(ROLE_ARN);
    expect(form.get("WebIdentityToken")).toBe("projected.jwt.token");
    expect(form.get("DurationSeconds")).toBe(
      String(AWS_WEB_IDENTITY_SESSION_DURATION_IN_SECONDS),
    );
    expect(form.get("RoleSessionName")).toBe(
      `oneuptime-marketplace-${NOW.getTime()}`,
    );
  });

  it("keeps the role session name EKS asks for", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      { status: 200, body: stsXmlAnswer(new Date(NOW.getTime() + 3600_000)) },
    ]);

    await new AwsWorkloadCredentialsProvider({
      env: { ...IRSA_ENV, AWS_ROLE_SESSION_NAME: "botocore-session-1" },
      readFile: createFiles({ [TOKEN_FILE]: "token" }).readFile,
      httpClient: http.client,
    }).getCredentials();

    expect(
      new URLSearchParams(http.requests[0]!.body!).get("RoleSessionName"),
    ).toBe("botocore-session-1");
  });

  it("reads STS's XML answer, entities decoded", async () => {
    const expiration: Date = new Date(NOW.getTime() + 3600 * 1000);
    const http: FakeHttpClient = createFakeHttpClient([
      { status: 200, body: stsXmlAnswer(expiration) },
    ]);

    const credentials: AwsWorkloadCredentials =
      await new AwsWorkloadCredentialsProvider({
        env: IRSA_ENV,
        readFile: createFiles({ [TOKEN_FILE]: "token" }).readFile,
        httpClient: http.client,
        now: (): Date => {
          return NOW;
        },
      }).getCredentials();

    expect(credentials).toEqual({
      accessKeyId: "ASIAEXAMPLEXML",
      secretAccessKey: "secret-from-xml",
      sessionToken: "session&from<xml>",
      expiresAt: expiration,
    });
  });

  it("reuses the credentials until five minutes before they expire, then re-reads the rotated token", async () => {
    const clock: Clock = createClock();
    const http: FakeHttpClient = createFakeHttpClient([
      { status: 200, body: stsJsonAnswer(new Date(NOW.getTime() + 3600_000)) },
      {
        status: 200,
        body: stsJsonAnswer(new Date(NOW.getTime() + 2 * 3600_000)),
      },
    ]);
    const files: Files = createFiles({ [TOKEN_FILE]: "first-token" });

    const provider: AwsWorkloadCredentialsProvider =
      new AwsWorkloadCredentialsProvider({
        env: IRSA_ENV,
        readFile: files.readFile,
        httpClient: http.client,
        now: clock.now,
      });

    await provider.getCredentials();
    clock.advance(54 * 60 * 1000);
    await provider.getCredentials();
    expect(http.requests).toHaveLength(1);

    // 55 minutes in: five minutes left, so it refreshes - with the kubelet's new token.
    clock.advance(60 * 1000);
    files.contents[TOKEN_FILE] = "rotated-token";
    await provider.getCredentials();

    expect(http.requests).toHaveLength(2);
    expect(
      new URLSearchParams(http.requests[1]!.body!).get("WebIdentityToken"),
    ).toBe("rotated-token");
  });

  it("shares one exchange between concurrent callers", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      { status: 200, body: stsJsonAnswer(new Date(NOW.getTime() + 3600_000)) },
    ]);

    const provider: AwsWorkloadCredentialsProvider =
      new AwsWorkloadCredentialsProvider({
        env: IRSA_ENV,
        readFile: createFiles({ [TOKEN_FILE]: "token" }).readFile,
        httpClient: http.client,
        now: (): Date => {
          return NOW;
        },
      });

    const results: Array<AwsWorkloadCredentials> = await Promise.all([
      provider.getCredentials(),
      provider.getCredentials(),
      provider.getCredentials(),
    ]);

    expect(http.requests).toHaveLength(1);
    expect(results[0]).toEqual(results[1]);
    expect(results[1]).toEqual(results[2]);
  });

  it("fetches again after invalidate()", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      { status: 200, body: stsJsonAnswer(new Date(NOW.getTime() + 3600_000)) },
      { status: 200, body: stsJsonAnswer(new Date(NOW.getTime() + 3600_000)) },
    ]);

    const provider: AwsWorkloadCredentialsProvider =
      new AwsWorkloadCredentialsProvider({
        env: IRSA_ENV,
        readFile: createFiles({ [TOKEN_FILE]: "token" }).readFile,
        httpClient: http.client,
        now: (): Date => {
          return NOW;
        },
      });

    await provider.getCredentials();
    provider.invalidate();
    await provider.getCredentials();

    expect(http.requests).toHaveLength(2);
  });

  it("refuses for good when STS rejects the token, and says why", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      {
        status: 400,
        body: stsErrorAnswer(
          "InvalidIdentityToken",
          "No OpenIDConnect provider found in your account for https://oidc.eks.us-west-2.amazonaws.com/id/ABC",
        ),
      },
    ]);

    const error: MarketplaceApiError = await expectMarketplaceError(
      new AwsWorkloadCredentialsProvider({
        env: IRSA_ENV,
        readFile: createFiles({ [TOKEN_FILE]: "token" }).readFile,
        httpClient: http.client,
      }).getCredentials(),
    );

    expect(error.status).toBe(400);
    expect(error.isRetryable).toBe(false);
    expect(error.message).toContain("InvalidIdentityToken");
    expect(error.message).toContain("No OpenIDConnect provider");
    // The token never reaches an error message.
    expect(error.message).not.toContain("WebIdentityToken=");
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
      const error: MarketplaceApiError = await expectMarketplaceError(
        new AwsWorkloadCredentialsProvider({
          env: IRSA_ENV,
          readFile: createFiles({ [TOKEN_FILE]: "token" }).readFile,
          httpClient: createFakeHttpClient([answer]).client,
        }).getCredentials(),
      );

      expect(error.isRetryable).toBe(true);
    }
  });

  it("does not take an answer without credentials", async () => {
    const error: MarketplaceApiError = await expectMarketplaceError(
      new AwsWorkloadCredentialsProvider({
        env: IRSA_ENV,
        readFile: createFiles({ [TOKEN_FILE]: "token" }).readFile,
        httpClient: createFakeHttpClient([
          {
            status: 200,
            body: {
              AssumeRoleWithWebIdentityResponse: {
                AssumeRoleWithWebIdentityResult: {},
              },
            },
          },
        ]).client,
      }).getCredentials(),
    );

    expect(error.message).toContain("without credentials");
  });

  it("needs the Region to find STS", async () => {
    const http: FakeHttpClient = createFakeHttpClient([]);

    const error: MarketplaceApiError = await expectMarketplaceError(
      new AwsWorkloadCredentialsProvider({
        env: {
          AWS_ROLE_ARN: ROLE_ARN,
          AWS_WEB_IDENTITY_TOKEN_FILE: TOKEN_FILE,
        },
        readFile: createFiles({ [TOKEN_FILE]: "token" }).readFile,
        httpClient: http.client,
      }).getCredentials(),
    );

    expect(error.isRetryable).toBe(false);
    expect(error.message).toContain("AWS_REGION");
    expect(http.requests).toHaveLength(0);
  });

  it("reports a token file that is missing or empty, without calling STS", async () => {
    for (const files of [
      createFiles({}),
      createFiles({ [TOKEN_FILE]: "  \n" }),
    ]) {
      const http: FakeHttpClient = createFakeHttpClient([]);

      const error: MarketplaceApiError = await expectMarketplaceError(
        new AwsWorkloadCredentialsProvider({
          env: IRSA_ENV,
          readFile: files.readFile,
          httpClient: http.client,
        }).getCredentials(),
      );

      expect(error.message).toContain(TOKEN_FILE);
      expect(http.requests).toHaveLength(0);
    }
  });
});

describe("AwsWorkloadCredentialsProvider with EKS Pod Identity", () => {
  it("asks the node agent, authorised by the pod's token", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
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
    ]);

    const credentials: AwsWorkloadCredentials =
      await new AwsWorkloadCredentialsProvider({
        env: POD_IDENTITY_ENV,
        readFile: createFiles({
          [POD_IDENTITY_TOKEN_FILE]: "pod-identity-token\n",
        }).readFile,
        httpClient: http.client,
      }).getCredentials();

    expect(credentials).toEqual({
      accessKeyId: "ASIAPODIDENTITY",
      secretAccessKey: "pod-identity-secret",
      sessionToken: "pod-identity-session",
      expiresAt: new Date("2026-10-17T16:00:00Z"),
    });

    const request: MarketplaceHttpRequest = http.requests[0]!;
    expect(request.method).toBe("GET");
    expect(request.url).toBe("http://169.254.170.23/v1/credentials");
    expect(request.headers!["Authorization"]).toBe("pod-identity-token");
    expect(request.timeoutInMs).toBe(5_000);
  });

  it("takes an inline authorization token when there is no token file", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      {
        status: 200,
        body: {
          AccessKeyId: "ASIAINLINE",
          SecretAccessKey: "inline-secret",
          Token: "inline-session",
          Expiration: "2026-10-17T16:00:00Z",
        },
      },
    ]);

    await new AwsWorkloadCredentialsProvider({
      env: {
        AWS_CONTAINER_CREDENTIALS_FULL_URI: "http://127.0.0.1:9911/creds",
        AWS_CONTAINER_AUTHORIZATION_TOKEN: "inline-token",
      },
      httpClient: http.client,
    }).getCredentials();

    expect(http.requests[0]!.headers!["Authorization"]).toBe("inline-token");
  });

  it("never asks a host that is not a credential agent over plain http", async () => {
    const http: FakeHttpClient = createFakeHttpClient([]);

    const error: MarketplaceApiError = await expectMarketplaceError(
      new AwsWorkloadCredentialsProvider({
        env: {
          AWS_CONTAINER_CREDENTIALS_FULL_URI:
            "http://169.254.169.254/latest/meta-data/",
        },
        httpClient: http.client,
      }).getCredentials(),
    );

    expect(error.isRetryable).toBe(false);
    expect(http.requests).toHaveLength(0);
  });

  it("reports an agent that refuses or answers without credentials", async () => {
    const refused: MarketplaceApiError = await expectMarketplaceError(
      new AwsWorkloadCredentialsProvider({
        env: POD_IDENTITY_ENV,
        readFile: createFiles({ [POD_IDENTITY_TOKEN_FILE]: "token" }).readFile,
        httpClient: createFakeHttpClient([
          { status: 400, body: { message: "Service account token invalid" } },
        ]).client,
      }).getCredentials(),
    );

    expect(refused.status).toBe(400);
    expect(refused.isRetryable).toBe(false);

    const empty: MarketplaceApiError = await expectMarketplaceError(
      new AwsWorkloadCredentialsProvider({
        env: POD_IDENTITY_ENV,
        readFile: createFiles({ [POD_IDENTITY_TOKEN_FILE]: "token" }).readFile,
        httpClient: createFakeHttpClient([{ status: 200, body: {} }]).client,
      }).getCredentials(),
    );

    expect(empty.isRetryable).toBe(true);
  });
});

describe("AwsWorkloadCredentialsProvider with keys in the environment", () => {
  it("uses them as they are, with no exchange and no expiry", async () => {
    const http: FakeHttpClient = createFakeHttpClient([]);

    const credentials: AwsWorkloadCredentials =
      await new AwsWorkloadCredentialsProvider({
        env: {
          AWS_ACCESS_KEY_ID: "AKIDEXAMPLE",
          AWS_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
          AWS_SESSION_TOKEN: "session",
        },
        httpClient: http.client,
      }).getCredentials();

    expect(credentials).toEqual({
      accessKeyId: "AKIDEXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      sessionToken: "session",
      expiresAt: null,
    });
    expect(http.requests).toHaveLength(0);
  });
});

describe("AwsWorkloadCredentialsProvider with no credentials", () => {
  it("tells the operator to give the service account an IAM role", async () => {
    const error: MarketplaceApiError = await expectMarketplaceError(
      new AwsWorkloadCredentialsProvider({
        env: {},
        httpClient: createFakeHttpClient([]).client,
      }).getCredentials(),
    );

    expect(error.isRetryable).toBe(false);
    expect(error.message).toContain("IAM role");
  });
});

describe("AwsWorkloadCredentialsProvider XML reading", () => {
  it("reads the first element's text and decodes the predefined entities once", () => {
    expect(
      AwsWorkloadCredentialsProvider.readXmlElement(
        "<a><Code>x&amp;lt;y</Code><Code>second</Code></a>",
        "Code",
      ),
    ).toBe("x&lt;y");
    expect(
      AwsWorkloadCredentialsProvider.readXmlElement("<a></a>", "Code"),
    ).toBeNull();
    expect(
      AwsWorkloadCredentialsProvider.readXmlElement("<Code>open", "Code"),
    ).toBeNull();
  });

  it("reads the error code of an XML or JSON STS error", () => {
    expect(
      AwsWorkloadCredentialsProvider.readStsErrorCode(
        stsErrorAnswer("AccessDenied", "Not authorized"),
      ),
    ).toBe("AccessDenied");
    expect(
      AwsWorkloadCredentialsProvider.readStsErrorCode(
        JSON.stringify({ Error: { Code: "ExpiredTokenException" } }),
      ),
    ).toBe("ExpiredTokenException");
    expect(AwsWorkloadCredentialsProvider.readStsErrorCode("")).toBe("");
  });
});
