import AwsDefaultCredentialChain, {
  AWS_CREDENTIALS_FAILURE_MEMO_MS,
  AWS_CREDENTIALS_REFRESH_BEFORE_EXPIRY_MS,
  AWS_CREDENTIALS_WITHOUT_EXPIRY_REUSE_MS,
  AwsChainCredentials,
  AwsChainEnvironment,
  AwsChainHttpError,
  AwsChainHttpRequest,
  AwsChainHttpResponse,
  AwsCredentialChainError,
  CONTAINER_CREDENTIALS_TIMEOUT_MS,
  EC2_METADATA_TIMEOUT_MS,
  NO_AWS_CREDENTIALS_MESSAGE,
  STS_TIMEOUT_MS,
  describeTimeLimit,
  isHeaderSafe,
} from "../../../../Server/Utils/Aws/AwsDefaultCredentialChain";
import { describe, expect, test } from "@jest/globals";

/*
 * THE SERVER'S OWN AWS CREDENTIALS (#7000), found where the AWS SDKs find
 * them: keys in the environment, a web identity token traded at STS (IRSA),
 * the ECS or EKS Pod Identity agent, then the EC2 instance profile over
 * IMDSv2. Every source is driven here through the chain's own HTTP client
 * seam, so each request it makes - its method, address, headers, body and
 * time limit - and each answer's meaning are pinned. The real client, which
 * needs Node's fetch (Common's jest runs in jsdom), is driven against a local
 * server in App's AwsChainHttpClient.test.ts.
 */

const NOW: Date = new Date("2026-11-12T10:00:00.000Z");

const ROLE_ARN: string = "arn:aws:iam::111122223333:role/oneuptime-ses";
const TOKEN_FILE: string =
  "/var/run/secrets/eks.amazonaws.com/serviceaccount/token";
const WEB_IDENTITY_TOKEN: string =
  "eyJhbGciOiJSUzI1NiIsImtpZCI6IjEifQ.eyJzdWIiOiJzeXN0ZW06c2VydmljZWFjY291bnQifQ.c2lnbmF0dXJl";

const STS_JSON_ANSWER: (expiresAtSeconds: number) => string = (
  expiresAtSeconds: number,
): string => {
  return JSON.stringify({
    AssumeRoleWithWebIdentityResponse: {
      AssumeRoleWithWebIdentityResult: {
        Credentials: {
          AccessKeyId: "ASIAWEBIDENTITYEXAMP",
          SecretAccessKey: "webIdentitySecretEXAMPLE0123456789abcdef",
          SessionToken: "IQoJb3JpZ2luX2VjEWebIdentitySessionToken",
          Expiration: expiresAtSeconds,
        },
        SubjectFromWebIdentityToken:
          "system:serviceaccount:oneuptime:oneuptime",
      },
      ResponseMetadata: { RequestId: "c6104cbe-af31-11e0-8154-cbc7ccf896c7" },
    },
  });
};

const STS_XML_ANSWER: string = `<AssumeRoleWithWebIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/">
  <AssumeRoleWithWebIdentityResult>
    <Credentials>
      <SessionToken>IQoJb3JpZ2luX2VjEXml&amp;Token</SessionToken>
      <SecretAccessKey>xmlSecretEXAMPLE0123456789abcdef</SecretAccessKey>
      <Expiration>2026-11-12T11:00:00Z</Expiration>
      <AccessKeyId>ASIAXMLANSWEREXAMPLE</AccessKeyId>
    </Credentials>
  </AssumeRoleWithWebIdentityResult>
</AssumeRoleWithWebIdentityResponse>`;

const CONTAINER_ANSWER: (expiration: string | undefined) => string = (
  expiration: string | undefined,
): string => {
  return JSON.stringify({
    AccessKeyId: "ASIACONTAINEREXAMPLE",
    SecretAccessKey: "containerSecretEXAMPLE0123456789abcdef",
    Token: "IQoJb3JpZ2luX2VjEContainerSessionToken",
    RoleArn: "arn:aws:iam::111122223333:role/oneuptime-ses",
    ...(expiration ? { Expiration: expiration } : {}),
  });
};

const INSTANCE_ANSWER: string = JSON.stringify({
  Code: "Success",
  LastUpdated: "2026-11-12T09:55:00Z",
  Type: "AWS-HMAC",
  AccessKeyId: "ASIAINSTANCEEXAMPLE1",
  SecretAccessKey: "instanceSecretEXAMPLE0123456789abcdef",
  Token: "IQoJb3JpZ2luX2VjEInstanceSessionToken",
  Expiration: "2026-11-12T16:00:00Z",
});

type Answer = AwsChainHttpResponse | Error;

interface ScriptedHttp {
  client: (request: AwsChainHttpRequest) => Promise<AwsChainHttpResponse>;
  requests: Array<AwsChainHttpRequest>;
}

/*
 * A credential source that answers each request with the next answer of
 * `answers` (the last one again once they run out), or with what `answer`
 * returns for it. An Error is a request that got no answer.
 */
function scriptedHttp(
  answers: Array<Answer> | ((request: AwsChainHttpRequest) => Answer),
): ScriptedHttp {
  const requests: Array<AwsChainHttpRequest> = [];

  return {
    requests: requests,
    client: async (
      request: AwsChainHttpRequest,
    ): Promise<AwsChainHttpResponse> => {
      requests.push(request);

      const answer: Answer =
        typeof answers === "function"
          ? answers(request)
          : (answers[
              Math.min(requests.length - 1, answers.length - 1)
            ] as Answer);

      if (answer instanceof Error) {
        throw answer;
      }

      return answer;
    },
  };
}

interface Clock {
  now: () => Date;
  advance: (ms: number) => void;
}

function clockAt(start: Date): Clock {
  let current: number = start.getTime();

  return {
    now: (): Date => {
      return new Date(current);
    },
    advance: (ms: number): void => {
      current += ms;
    },
  };
}

interface ChainUnderTest {
  chain: AwsDefaultCredentialChain;
  http: ScriptedHttp;
  clock: Clock;
  reads: Array<string>;
}

function chainWith(data: {
  env: AwsChainEnvironment;
  answers?: Array<Answer> | ((request: AwsChainHttpRequest) => Answer);
  files?:
    | Record<string, string | Error>
    | (() => Record<string, string | Error>);
}): ChainUnderTest {
  const http: ScriptedHttp = scriptedHttp(
    data.answers || [new Error("nothing should be asked")],
  );
  const clock: Clock = clockAt(NOW);
  const reads: Array<string> = [];

  const chain: AwsDefaultCredentialChain = new AwsDefaultCredentialChain({
    env: data.env,
    httpClient: http.client,
    now: clock.now,
    readFile: async (path: string): Promise<string> => {
      reads.push(path);

      const files: Record<string, string | Error> =
        typeof data.files === "function" ? data.files() : data.files || {};
      const content: string | Error | undefined = files[path];

      if (content === undefined) {
        throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      }

      if (content instanceof Error) {
        throw content;
      }

      return content;
    },
  });

  return { chain: chain, http: http, clock: clock, reads: reads };
}

// The error getting credentials fails with.
async function failureOf(
  chainUnderTest: ChainUnderTest,
  options?: { regionHint?: string },
): Promise<AwsCredentialChainError> {
  try {
    await chainUnderTest.chain.getCredentials(options);
  } catch (error) {
    expect(error).toBeInstanceOf(AwsCredentialChainError);
    return error as AwsCredentialChainError;
  }

  throw new Error("Credentials were found.");
}

const WEB_IDENTITY_ENV: AwsChainEnvironment = {
  AWS_ROLE_ARN: ROLE_ARN,
  AWS_WEB_IDENTITY_TOKEN_FILE: TOKEN_FILE,
  AWS_REGION: "eu-west-1",
};

const ok: (bodyText: string) => AwsChainHttpResponse = (
  bodyText: string,
): AwsChainHttpResponse => {
  return { status: 200, bodyText: bodyText };
};

const IN_AN_HOUR_SECONDS: number = NOW.getTime() / 1000 + 60 * 60;

describe("where the credentials come from", () => {
  test.each([
    [
      "keys in the environment",
      { AWS_ACCESS_KEY_ID: "AKIAENVEXAMPLE000001" },
      "environment",
    ],
    [
      "a web identity token (IRSA)",
      { AWS_ROLE_ARN: ROLE_ARN, AWS_WEB_IDENTITY_TOKEN_FILE: TOKEN_FILE },
      "web-identity",
    ],
    [
      "Amazon ECS's task role",
      { AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "/v2/credentials/abc" },
      "container",
    ],
    [
      "the EKS Pod Identity agent",
      {
        AWS_CONTAINER_CREDENTIALS_FULL_URI:
          "http://169.254.170.23/v1/credentials",
      },
      "container",
    ],
    [
      "nothing set: the EC2 instance profile, which only asking can tell",
      {},
      "instance-profile",
    ],
  ] as Array<[string, AwsChainEnvironment, string]>)(
    "%s",
    (_name: string, env: AwsChainEnvironment, source: string) => {
      expect(new AwsDefaultCredentialChain({ env: env }).getSource()).toBe(
        source,
      );
    },
  );

  test("in the SDKs' order: environment, web identity, container, instance profile", () => {
    const everything: AwsChainEnvironment = {
      AWS_ACCESS_KEY_ID: "AKIAENVEXAMPLE000001",
      AWS_SECRET_ACCESS_KEY: "envSecret",
      AWS_ROLE_ARN: ROLE_ARN,
      AWS_WEB_IDENTITY_TOKEN_FILE: TOKEN_FILE,
      AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "/v2/credentials/abc",
    };

    expect(new AwsDefaultCredentialChain({ env: everything }).getSource()).toBe(
      "environment",
    );

    const withoutKeys: AwsChainEnvironment = {
      ...everything,
      AWS_ACCESS_KEY_ID: undefined,
      AWS_SECRET_ACCESS_KEY: "  ",
    };

    expect(
      new AwsDefaultCredentialChain({ env: withoutKeys }).getSource(),
    ).toBe("web-identity");

    expect(
      new AwsDefaultCredentialChain({
        env: { ...withoutKeys, AWS_WEB_IDENTITY_TOKEN_FILE: "" },
      }).getSource(),
    ).toBe("container");
  });

  test("a web identity needs both the role and the token file", () => {
    expect(
      new AwsDefaultCredentialChain({
        env: { AWS_ROLE_ARN: ROLE_ARN },
      }).getSource(),
    ).toBe("instance-profile");
  });

  test("with the metadata service turned off and nothing else, there is no source", () => {
    for (const value of ["true", "TRUE", " True "]) {
      expect(
        new AwsDefaultCredentialChain({
          env: { AWS_EC2_METADATA_DISABLED: value },
        }).getSource(),
      ).toBeNull();
    }

    expect(
      new AwsDefaultCredentialChain({
        env: { AWS_EC2_METADATA_DISABLED: "false" },
      }).getSource(),
    ).toBe("instance-profile");
  });

  test("the server's Region is AWS_REGION, then AWS_DEFAULT_REGION, when it is one", () => {
    expect(
      new AwsDefaultCredentialChain({
        env: { AWS_REGION: " EU-West-1 ", AWS_DEFAULT_REGION: "us-east-2" },
      }).getRegion(),
    ).toBe("eu-west-1");
    expect(
      new AwsDefaultCredentialChain({
        env: { AWS_REGION: "not a region", AWS_DEFAULT_REGION: "us-east-2" },
      }).getRegion(),
    ).toBe("us-east-2");
    expect(new AwsDefaultCredentialChain({ env: {} }).getRegion()).toBeNull();
  });

  test("one chain is shared by the whole process, until it is reset", () => {
    AwsDefaultCredentialChain.resetShared();

    const first: AwsDefaultCredentialChain =
      AwsDefaultCredentialChain.getShared();

    expect(AwsDefaultCredentialChain.getShared()).toBe(first);

    AwsDefaultCredentialChain.resetShared();

    expect(AwsDefaultCredentialChain.getShared()).not.toBe(first);

    AwsDefaultCredentialChain.resetShared();
  });
});

describe("keys in the environment", () => {
  test("are used as they are, with their session token, and nothing is asked", async () => {
    const under: ChainUnderTest = chainWith({
      env: {
        AWS_ACCESS_KEY_ID: " ASIAENVEXAMPLE00001 ",
        AWS_SECRET_ACCESS_KEY: "envSecretEXAMPLE",
        AWS_SESSION_TOKEN: "envSessionToken",
      },
    });

    await expect(under.chain.getCredentials()).resolves.toEqual({
      accessKeyId: "ASIAENVEXAMPLE00001",
      secretAccessKey: "envSecretEXAMPLE",
      sessionToken: "envSessionToken",
      expiresAt: null,
      source: "environment",
    });
    expect(under.http.requests).toHaveLength(0);
  });

  test("are read again on every call: keys rotated into the environment are used at once", async () => {
    const env: AwsChainEnvironment = {
      AWS_ACCESS_KEY_ID: "AKIAFIRSTEXAMPLE0001",
      AWS_SECRET_ACCESS_KEY: "firstSecret",
    };
    const under: ChainUnderTest = chainWith({ env: env });

    expect((await under.chain.getCredentials()).accessKeyId).toBe(
      "AKIAFIRSTEXAMPLE0001",
    );

    env["AWS_ACCESS_KEY_ID"] = "AKIASECONDEXAMPLE001";
    env["AWS_SECRET_ACCESS_KEY"] = "secondSecret";

    const second: AwsChainCredentials = await under.chain.getCredentials();

    expect(second.accessKeyId).toBe("AKIASECONDEXAMPLE001");
    expect(second.sessionToken).toBeNull();
  });

  test.each([
    [
      { AWS_ACCESS_KEY_ID: "AKIAONLYIDEXAMPLE001" },
      "AWS_ACCESS_KEY_ID is set on this server, but AWS_SECRET_ACCESS_KEY is not. Set both, or neither to use the server's IAM role.",
    ],
    [
      { AWS_SECRET_ACCESS_KEY: "onlySecret" },
      "AWS_SECRET_ACCESS_KEY is set on this server, but AWS_ACCESS_KEY_ID is not. Set both, or neither to use the server's IAM role.",
    ],
  ] as Array<[AwsChainEnvironment, string]>)(
    "half a key says which half is missing: %j",
    async (env: AwsChainEnvironment, message: string) => {
      const error: AwsCredentialChainError = await failureOf(
        chainWith({ env: env }),
      );

      expect(error.message).toBe(message);
      expect(error.isRetryable).toBe(false);
      expect(error.source).toBe("environment");
    },
  );

  test("a key with a line break in it is refused: it would end the header it is written into", async () => {
    const error: AwsCredentialChainError = await failureOf(
      chainWith({
        env: {
          AWS_ACCESS_KEY_ID: "AKIAEXAMPLE",
          AWS_SECRET_ACCESS_KEY: "secret",
          AWS_SESSION_TOKEN: "token\r\nX-Injected: 1",
        },
      }),
    );

    expect(error.message).toContain("holds a line break");
    expect(error.message).not.toContain("X-Injected");
  });
});

describe("a web identity token, traded at STS (IAM roles for service accounts)", () => {
  test("is sent, unsigned, to STS in the server's Region, as AssumeRoleWithWebIdentity", async () => {
    const under: ChainUnderTest = chainWith({
      env: { ...WEB_IDENTITY_ENV, AWS_ROLE_SESSION_NAME: "oneuptime-app-0" },
      files: { [TOKEN_FILE]: `${WEB_IDENTITY_TOKEN}\n` },
      answers: [ok(STS_JSON_ANSWER(IN_AN_HOUR_SECONDS))],
    });

    const credentials: AwsChainCredentials = await under.chain.getCredentials({
      regionHint: "us-west-2",
    });

    expect(credentials).toEqual({
      accessKeyId: "ASIAWEBIDENTITYEXAMP",
      secretAccessKey: "webIdentitySecretEXAMPLE0123456789abcdef",
      sessionToken: "IQoJb3JpZ2luX2VjEWebIdentitySessionToken",
      expiresAt: new Date(IN_AN_HOUR_SECONDS * 1000),
      source: "web-identity",
    });

    expect(under.http.requests).toHaveLength(1);

    const request: AwsChainHttpRequest = under.http.requests[0]!;

    // The server's own Region wins over the email's.
    expect(request.method).toBe("POST");
    expect(request.url).toBe("https://sts.eu-west-1.amazonaws.com/");
    expect(request.timeoutMs).toBe(STS_TIMEOUT_MS);
    expect(request.headers["Accept"]).toBe("application/json");
    expect(request.headers["Authorization"]).toBeUndefined();

    const form: URLSearchParams = new URLSearchParams(request.body);

    expect(form.get("Action")).toBe("AssumeRoleWithWebIdentity");
    expect(form.get("Version")).toBe("2011-06-15");
    expect(form.get("RoleArn")).toBe(ROLE_ARN);
    expect(form.get("RoleSessionName")).toBe("oneuptime-app-0");
    expect(form.get("WebIdentityToken")).toBe(WEB_IDENTITY_TOKEN);
  });

  test("STS's XML answer is read too, its entities decoded", async () => {
    const under: ChainUnderTest = chainWith({
      env: WEB_IDENTITY_ENV,
      files: { [TOKEN_FILE]: WEB_IDENTITY_TOKEN },
      answers: [ok(STS_XML_ANSWER)],
    });

    const credentials: AwsChainCredentials = await under.chain.getCredentials();

    expect(credentials.accessKeyId).toBe("ASIAXMLANSWEREXAMPLE");
    expect(credentials.sessionToken).toBe("IQoJb3JpZ2luX2VjEXml&Token");
    expect(credentials.expiresAt).toEqual(new Date("2026-11-12T11:00:00Z"));
  });

  test.each([
    [{}, "us-west-2", "https://sts.us-west-2.amazonaws.com/"],
    [{}, undefined, "https://sts.us-east-1.amazonaws.com/"],
    [{}, "not-a-region.evil.test", "https://sts.us-east-1.amazonaws.com/"],
    [
      { AWS_DEFAULT_REGION: "ap-south-1" },
      "us-west-2",
      "https://sts.ap-south-1.amazonaws.com/",
    ],
    [
      { AWS_REGION: "cn-north-1" },
      undefined,
      "https://sts.cn-north-1.amazonaws.com.cn/",
    ],
  ] as Array<[AwsChainEnvironment, string | undefined, string]>)(
    "STS is asked in the server's Region, else the email's, else us-east-1: %j %s",
    async (
      region: AwsChainEnvironment,
      hint: string | undefined,
      url: string,
    ) => {
      const under: ChainUnderTest = chainWith({
        env: {
          AWS_ROLE_ARN: ROLE_ARN,
          AWS_WEB_IDENTITY_TOKEN_FILE: TOKEN_FILE,
          ...region,
        },
        files: { [TOKEN_FILE]: WEB_IDENTITY_TOKEN },
        answers: [ok(STS_JSON_ANSWER(IN_AN_HOUR_SECONDS))],
      });

      await under.chain.getCredentials({ regionHint: hint });

      expect(under.http.requests[0]!.url).toBe(url);
    },
  );

  test("a session name STS would refuse is replaced by one of OneUptime's", async () => {
    const under: ChainUnderTest = chainWith({
      env: {
        ...WEB_IDENTITY_ENV,
        AWS_ROLE_SESSION_NAME: "has spaces/and slashes",
      },
      files: { [TOKEN_FILE]: WEB_IDENTITY_TOKEN },
      answers: [ok(STS_JSON_ANSWER(IN_AN_HOUR_SECONDS))],
    });

    await under.chain.getCredentials();

    expect(
      new URLSearchParams(under.http.requests[0]!.body).get("RoleSessionName"),
    ).toBe(`oneuptime-${NOW.getTime()}`);
  });

  test("the token file is read again for every exchange: the kubelet rotates it", async () => {
    let token: string = "first.rotated.token";
    const under: ChainUnderTest = chainWith({
      env: WEB_IDENTITY_ENV,
      files: (): Record<string, string> => {
        return { [TOKEN_FILE]: token };
      },
      answers: [ok(STS_JSON_ANSWER(IN_AN_HOUR_SECONDS))],
    });

    await under.chain.getCredentials();
    token = "second.rotated.token";
    under.chain.invalidate();
    await under.chain.getCredentials();

    expect(under.reads).toEqual([TOKEN_FILE, TOKEN_FILE]);
    expect(
      under.http.requests.map((request: AwsChainHttpRequest): string | null => {
        return new URLSearchParams(request.body).get("WebIdentityToken");
      }),
    ).toEqual(["first.rotated.token", "second.rotated.token"]);
  });

  test("a role that is not an ARN is refused before anything is read or asked", async () => {
    const under: ChainUnderTest = chainWith({
      env: { ...WEB_IDENTITY_ENV, AWS_ROLE_ARN: "oneuptime-ses" },
    });

    const error: AwsCredentialChainError = await failureOf(under);

    expect(error.message).toBe(
      "AWS_ROLE_ARN is not the ARN of an IAM role. Set it to one, such as arn:aws:iam::111122223333:role/oneuptime.",
    );
    expect(error.isRetryable).toBe(false);
    expect(under.reads).toHaveLength(0);
    expect(under.http.requests).toHaveLength(0);
  });

  test.each([
    [
      new Error("EACCES: permission denied"),
      `The web identity token at ${TOKEN_FILE} could not be read: EACCES: permission denied.`,
      true,
    ],
    ["  \n", `The web identity token at ${TOKEN_FILE} is empty.`, true],
    [
      "a.b\nc.d",
      `The web identity token at ${TOKEN_FILE} is not a token: it is longer than 64 KB or holds a line break.`,
      false,
    ],
    [
      "x".repeat(64 * 1024 + 1),
      `The web identity token at ${TOKEN_FILE} is not a token: it is longer than 64 KB or holds a line break.`,
      false,
    ],
  ] as Array<[string | Error, string, boolean]>)(
    "a token file that cannot be used says why: %#",
    async (content: string | Error, message: string, isRetryable: boolean) => {
      const under: ChainUnderTest = chainWith({
        env: WEB_IDENTITY_ENV,
        files: { [TOKEN_FILE]: content },
      });

      const error: AwsCredentialChainError = await failureOf(under);

      expect(error.message).toBe(message);
      expect(error.isRetryable).toBe(isRetryable);
      expect(error.source).toBe("web-identity");
      expect(under.http.requests).toHaveLength(0);
    },
  );

  test.each([
    [
      403,
      '{"Error":{"Code":"AccessDenied","Message":"Not authorized to perform sts:AssumeRoleWithWebIdentity","Type":"Sender"}}',
      `AWS STS did not let this server assume the role ${ROLE_ARN} (HTTP 403 AccessDenied). Check that the role's trust policy allows sts:AssumeRoleWithWebIdentity for this cluster's OIDC provider and OneUptime's service account. AWS STS said: Not authorized to perform sts:AssumeRoleWithWebIdentity.`,
      false,
    ],
    [
      400,
      "<ErrorResponse><Error><Type>Sender</Type><Code>InvalidIdentityToken</Code><Message>No OpenIDConnect provider found in your account for https://oidc.eks.eu-west-1.amazonaws.com/id/ABC</Message></Error></ErrorResponse>",
      `AWS STS did not accept this server's web identity token for the role ${ROLE_ARN} (HTTP 400 InvalidIdentityToken). Check that the token's issuer, the cluster's OIDC provider, is an identity provider in IAM. AWS STS said: No OpenIDConnect provider found in your account for https://oidc.eks.eu-west-1.amazonaws.com/id/ABC.`,
      false,
    ],
    [
      400,
      '{"Error":{"Code":"ExpiredTokenException","Message":"Token expired: current date/time 1797000000 must be before the expiration date/time 1796990000."}}',
      "This server's web identity token has expired (HTTP 400 ExpiredTokenException). It is read again on the next try. AWS STS said: Token expired: current date/time 1797000000 must be before the expiration date/time 1796990000.",
      true,
    ],
    [
      400,
      '{"Error":{"Code":"IDPRejectedClaim","Message":"Incorrect token audience"}}',
      `AWS STS did not accept a claim in this server's web identity token for the role ${ROLE_ARN} (HTTP 400 IDPRejectedClaim). Check the conditions in the role's trust policy. AWS STS said: Incorrect token audience.`,
      false,
    ],
    [
      403,
      '{"Error":{"Code":"RegionDisabledException","Message":"STS is not activated in this region for account:111122223333."}}',
      `AWS STS is not turned on in this server's Region for the account of the role ${ROLE_ARN} (HTTP 403 RegionDisabledException). Turn it on in IAM's account settings. AWS STS said: STS is not activated in this region for account:111122223333.`,
      false,
    ],
    [
      400,
      '{"Error":{"Code":"Throttling","Message":"Rate exceeded"}}',
      "AWS STS could not give this server credentials just now (HTTP 400 Throttling). It is asked again on the next try. AWS STS said: Rate exceeded.",
      true,
    ],
    [
      503,
      "",
      "AWS STS could not give this server credentials just now (HTTP 503). It is asked again on the next try.",
      true,
    ],
    [
      400,
      '{"Error":{"Code":"MalformedPolicyDocument","Message":"Bad policy"}}',
      `AWS STS did not give this server credentials for the role ${ROLE_ARN} (HTTP 400 MalformedPolicyDocument). AWS STS said: Bad policy.`,
      false,
    ],
  ] as Array<[number, string, string, boolean]>)(
    "STS's refusal (HTTP %i) says what to change: %#",
    async (
      status: number,
      bodyText: string,
      message: string,
      isRetryable: boolean,
    ) => {
      const error: AwsCredentialChainError = await failureOf(
        chainWith({
          env: WEB_IDENTITY_ENV,
          files: { [TOKEN_FILE]: WEB_IDENTITY_TOKEN },
          answers: [{ status: status, bodyText: bodyText }],
        }),
      );

      expect(error.message).toBe(message);
      expect(error.isRetryable).toBe(isRetryable);
      expect(error.source).toBe("web-identity");
    },
  );

  test("the token never reaches the message, whatever STS echoes", async () => {
    const error: AwsCredentialChainError = await failureOf(
      chainWith({
        env: WEB_IDENTITY_ENV,
        files: { [TOKEN_FILE]: WEB_IDENTITY_TOKEN },
        answers: [
          {
            status: 400,
            bodyText: JSON.stringify({
              Error: {
                Code: "InvalidIdentityToken",
                Message: `Couldn't parse ${WEB_IDENTITY_TOKEN}`,
              },
            }),
          },
        ],
      }),
    );

    expect(error.message).not.toContain(WEB_IDENTITY_TOKEN);
    expect(error.message).toContain("[redacted]");
  });

  test("STS out of reach is tried again, and says where it was asked", async () => {
    const error: AwsCredentialChainError = await failureOf(
      chainWith({
        env: WEB_IDENTITY_ENV,
        files: { [TOKEN_FILE]: WEB_IDENTITY_TOKEN },
        answers: [new AwsChainHttpError("ECONNREFUSED", false)],
      }),
    );

    expect(error.message).toBe(
      "AWS STS could not be reached at sts.eu-west-1.amazonaws.com: ECONNREFUSED. Check that this server can reach it over HTTPS (port 443).",
    );
    expect(error.isRetryable).toBe(true);
  });

  test("an answer without credentials is tried again", async () => {
    const error: AwsCredentialChainError = await failureOf(
      chainWith({
        env: WEB_IDENTITY_ENV,
        files: { [TOKEN_FILE]: WEB_IDENTITY_TOKEN },
        answers: [ok('{"AssumeRoleWithWebIdentityResponse":{}}')],
      }),
    );

    expect(error.message).toBe(
      `AWS STS answered without credentials for the role ${ROLE_ARN}. It is asked again on the next try.`,
    );
    expect(error.isRetryable).toBe(true);
  });
});

describe("the ECS task role and the EKS Pod Identity agent", () => {
  test("Amazon ECS: a GET of the relative path on 169.254.170.2, with no token", async () => {
    const under: ChainUnderTest = chainWith({
      env: { AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "/v2/credentials/7f1a" },
      answers: [ok(CONTAINER_ANSWER("2026-11-12T16:00:00Z"))],
    });

    expect(await under.chain.getCredentials()).toEqual({
      accessKeyId: "ASIACONTAINEREXAMPLE",
      secretAccessKey: "containerSecretEXAMPLE0123456789abcdef",
      sessionToken: "IQoJb3JpZ2luX2VjEContainerSessionToken",
      expiresAt: new Date("2026-11-12T16:00:00Z"),
      source: "container",
    });
    expect(under.http.requests).toEqual([
      {
        method: "GET",
        url: "http://169.254.170.2/v2/credentials/7f1a",
        headers: { Accept: "application/json" },
        timeoutMs: CONTAINER_CREDENTIALS_TIMEOUT_MS,
      },
    ]);
  });

  test("EKS Pod Identity: the full address, with the token from its file, read again every time", async () => {
    let token: string = "first-pod-identity-token";
    const tokenFile: string =
      "/var/run/secrets/pods.eks.amazonaws.com/serviceaccount/eks-pod-identity-token";
    const under: ChainUnderTest = chainWith({
      env: {
        AWS_CONTAINER_CREDENTIALS_FULL_URI:
          "http://169.254.170.23/v1/credentials",
        AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE: tokenFile,
        // The file wins over a token written inline.
        AWS_CONTAINER_AUTHORIZATION_TOKEN: "inline-token",
      },
      files: (): Record<string, string> => {
        return { [tokenFile]: token };
      },
      answers: [ok(CONTAINER_ANSWER("2026-11-12T16:00:00Z"))],
    });

    await under.chain.getCredentials();
    token = "second-pod-identity-token";
    under.chain.invalidate();
    await under.chain.getCredentials();

    expect(
      under.http.requests.map((request: AwsChainHttpRequest): unknown => {
        return [request.url, request.headers["Authorization"]];
      }),
    ).toEqual([
      ["http://169.254.170.23/v1/credentials", "first-pod-identity-token"],
      ["http://169.254.170.23/v1/credentials", "second-pod-identity-token"],
    ]);
  });

  test("a token written inline is sent when there is no file", async () => {
    const under: ChainUnderTest = chainWith({
      env: {
        AWS_CONTAINER_CREDENTIALS_FULL_URI:
          "https://credentials.internal.example/v1",
        AWS_CONTAINER_AUTHORIZATION_TOKEN: "inline-token",
      },
      answers: [ok(CONTAINER_ANSWER(undefined))],
    });

    const credentials: AwsChainCredentials = await under.chain.getCredentials();

    expect(under.http.requests[0]!.headers["Authorization"]).toBe(
      "inline-token",
    );
    // No expiry given: kept for a while, then asked again.
    expect(credentials.expiresAt).toBeNull();
  });

  test.each([
    ["https://credentials.example.com/v1", true],
    ["http://169.254.170.2/v2/credentials", true],
    ["http://169.254.170.23/v1/credentials", true],
    ["http://[fd00:ec2::23]/v1/credentials", true],
    ["http://localhost:8080/creds", true],
    ["http://127.0.0.1/creds", true],
    ["http://127.200.3.4:9911/creds", true],
    ["http://[::1]/creds", true],
    ["http://credentials.example.com/v1", false],
    ["http://169.254.169.254/latest", false],
    ["http://10.0.0.5/creds", false],
    ["http://127.0.0.1.evil.test/creds", false],
    ["http://128.0.0.1/creds", false],
    ["http://127.0.0.256/creds", false],
    ["http://user:pass@127.0.0.1/creds", false],
    ["https://user@credentials.example.com/v1", false],
    ["ftp://127.0.0.1/creds", false],
    ["file:///etc/passwd", false],
    ["not a url", false],
    ["", false],
  ] as Array<[string, boolean]>)(
    "a full address may be asked over https, or plain http only to a loopback address or an agent: %s",
    (uri: string, isAllowed: boolean) => {
      expect(
        AwsDefaultCredentialChain.isAllowedContainerCredentialsUri(uri),
      ).toBe(isAllowed);
    },
  );

  test("an address that may not be asked is refused before anything is sent", async () => {
    const under: ChainUnderTest = chainWith({
      env: {
        AWS_CONTAINER_CREDENTIALS_FULL_URI: "http://credentials.example.com/v1",
        AWS_CONTAINER_AUTHORIZATION_TOKEN: "inline-token",
      },
    });

    const error: AwsCredentialChainError = await failureOf(under);

    expect(error.message).toBe(
      "AWS_CONTAINER_CREDENTIALS_FULL_URI must be an https address, or http to a loopback address or the ECS or EKS Pod Identity agent (169.254.170.2, 169.254.170.23).",
    );
    expect(error.isRetryable).toBe(false);
    expect(under.http.requests).toHaveLength(0);
  });

  test("a relative path that is not a path is refused", async () => {
    const under: ChainUnderTest = chainWith({
      env: { AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "@evil.test/creds" },
    });

    expect((await failureOf(under)).message).toBe(
      "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI is not a path on Amazon ECS's credentials endpoint. Leave it as Amazon ECS sets it.",
    );
    expect(under.http.requests).toHaveLength(0);
  });

  test("an authorization token with a line break is never sent", async () => {
    const under: ChainUnderTest = chainWith({
      env: {
        AWS_CONTAINER_CREDENTIALS_FULL_URI:
          "http://169.254.170.23/v1/credentials",
        AWS_CONTAINER_AUTHORIZATION_TOKEN: "token\r\nX-Injected: yes",
      },
    });

    const error: AwsCredentialChainError = await failureOf(under);

    expect(error.message).toBe(
      "The container authorization token holds a line break or another control character, so the EKS Pod Identity agent (169.254.170.23) cannot be asked with it.",
    );
    expect(under.http.requests).toHaveLength(0);
  });

  test.each([
    [
      { status: 403, bodyText: "token inline-secret-token is not valid" },
      "The EKS Pod Identity agent (169.254.170.23) refused to give this server credentials (HTTP 403). It said: token [redacted] is not valid.",
      false,
    ],
    [
      { status: 500, bodyText: "" },
      "The EKS Pod Identity agent (169.254.170.23) refused to give this server credentials (HTTP 500).",
      true,
    ],
    [
      { status: 429, bodyText: "Slow down!" },
      "The EKS Pod Identity agent (169.254.170.23) refused to give this server credentials (HTTP 429). It said: Slow down!",
      true,
    ],
    [
      new AwsChainHttpError("timed out after 2 seconds", true),
      "The EKS Pod Identity agent (169.254.170.23) did not answer: timed out after 2 seconds.",
      true,
    ],
    [
      ok("<html>proxy</html>"),
      "The EKS Pod Identity agent (169.254.170.23) answered without credentials. It is asked again on the next try.",
      true,
    ],
    [
      ok(
        JSON.stringify({ AccessKeyId: "ASIAEXAMPLE", SecretAccessKey: "a\nb" }),
      ),
      "The EKS Pod Identity agent (169.254.170.23) answered without credentials. It is asked again on the next try.",
      true,
    ],
  ] as Array<[Answer, string, boolean]>)(
    "what the agent's answer means: %#",
    async (answer: Answer, message: string, isRetryable: boolean) => {
      const error: AwsCredentialChainError = await failureOf(
        chainWith({
          env: {
            AWS_CONTAINER_CREDENTIALS_FULL_URI:
              "http://169.254.170.23/v1/credentials",
            AWS_CONTAINER_AUTHORIZATION_TOKEN: "inline-secret-token",
          },
          answers: [answer],
        }),
      );

      expect(error.message).toBe(message);
      expect(error.isRetryable).toBe(isRetryable);
      expect(error.source).toBe("container");
    },
  );

  test("another endpoint is named by its host", async () => {
    const error: AwsCredentialChainError = await failureOf(
      chainWith({
        env: {
          AWS_CONTAINER_CREDENTIALS_FULL_URI: "http://127.0.0.1:51679/creds",
        },
        answers: [{ status: 404, bodyText: "" }],
      }),
    );

    expect(error.message).toBe(
      "The container credentials endpoint (127.0.0.1:51679) refused to give this server credentials (HTTP 404).",
    );
  });
});

describe("the EC2 instance profile, over IMDSv2", () => {
  const imds: (request: AwsChainHttpRequest) => Answer = (
    request: AwsChainHttpRequest,
  ): Answer => {
    if (request.method === "PUT") {
      return ok("AQAEAImdsSessionTokenEXAMPLE==");
    }

    if (request.url.endsWith("/security-credentials/")) {
      return ok("oneuptime-ses-instance\n");
    }

    return ok(INSTANCE_ANSWER);
  };

  test("a session token first, then the role's name and its credentials, each read with the token", async () => {
    const under: ChainUnderTest = chainWith({ env: {}, answers: imds });

    expect(await under.chain.getCredentials()).toEqual({
      accessKeyId: "ASIAINSTANCEEXAMPLE1",
      secretAccessKey: "instanceSecretEXAMPLE0123456789abcdef",
      sessionToken: "IQoJb3JpZ2luX2VjEInstanceSessionToken",
      expiresAt: new Date("2026-11-12T16:00:00Z"),
      source: "instance-profile",
    });

    expect(under.http.requests).toEqual([
      {
        method: "PUT",
        url: "http://169.254.169.254/latest/api/token",
        headers: { "X-aws-ec2-metadata-token-ttl-seconds": "21600" },
        timeoutMs: EC2_METADATA_TIMEOUT_MS,
      },
      {
        method: "GET",
        url: "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
        headers: {
          "X-aws-ec2-metadata-token": "AQAEAImdsSessionTokenEXAMPLE==",
        },
        timeoutMs: EC2_METADATA_TIMEOUT_MS,
      },
      {
        method: "GET",
        url: "http://169.254.169.254/latest/meta-data/iam/security-credentials/oneuptime-ses-instance",
        headers: {
          "X-aws-ec2-metadata-token": "AQAEAImdsSessionTokenEXAMPLE==",
        },
        timeoutMs: EC2_METADATA_TIMEOUT_MS,
      },
    ]);
  });

  test.each([
    [
      { AWS_EC2_METADATA_SERVICE_ENDPOINT_MODE: "IPv6" },
      "http://[fd00:ec2::254]",
    ],
    [
      {
        AWS_EC2_METADATA_SERVICE_ENDPOINT:
          "http://169.254.169.254:8080/ignored/path",
      },
      "http://169.254.169.254:8080",
    ],
    [
      {
        AWS_EC2_METADATA_SERVICE_ENDPOINT: "https://imds.internal.example/",
        AWS_EC2_METADATA_SERVICE_ENDPOINT_MODE: "IPv6",
      },
      "https://imds.internal.example",
    ],
  ] as Array<[AwsChainEnvironment, string]>)(
    "the metadata service is where the environment says: %j",
    async (env: AwsChainEnvironment, origin: string) => {
      const under: ChainUnderTest = chainWith({ env: env, answers: imds });

      await under.chain.getCredentials();

      expect(under.http.requests[0]!.url).toBe(`${origin}/latest/api/token`);
    },
  );

  test("an endpoint that is not an http address is refused", async () => {
    const under: ChainUnderTest = chainWith({
      env: { AWS_EC2_METADATA_SERVICE_ENDPOINT: "file:///etc/passwd" },
      answers: imds,
    });

    expect((await failureOf(under)).message).toBe(
      "AWS_EC2_METADATA_SERVICE_ENDPOINT is not an http or https address, such as http://169.254.169.254.",
    );
    expect(under.http.requests).toHaveLength(0);
  });

  test("turned off, it is never asked, and the server is told it has no credentials", async () => {
    const under: ChainUnderTest = chainWith({
      env: { AWS_EC2_METADATA_DISABLED: "true" },
      answers: imds,
    });

    const error: AwsCredentialChainError = await failureOf(under);

    expect(error.message).toBe(NO_AWS_CREDENTIALS_MESSAGE);
    expect(error.isRetryable).toBe(false);
    expect(error.source).toBeNull();
    expect(under.http.requests).toHaveLength(0);
  });

  test("no answer at all - off EC2, or a hop limit too low for a container - is no credentials, with the hop limit named", async () => {
    const under: ChainUnderTest = chainWith({
      env: {},
      answers: [new AwsChainHttpError("timed out after 2 seconds", true)],
    });

    const error: AwsCredentialChainError = await failureOf(under);

    expect(error.message).toBe(
      `${NO_AWS_CREDENTIALS_MESSAGE} The EC2 instance metadata service (169.254.169.254) did not answer (timed out after 2 seconds); in a container on Amazon EC2, the instance's metadata hop limit must be 2 or more.`,
    );
    expect(error.isRetryable).toBe(false);
    expect(under.http.requests).toHaveLength(1);
  });

  test("a service that answered and then stopped is asked again on the next try", async () => {
    const under: ChainUnderTest = chainWith({
      env: {},
      answers: [ok("AQAEAImdsSessionTokenEXAMPLE=="), new Error("ECONNRESET")],
    });

    const error: AwsCredentialChainError = await failureOf(under);

    expect(error.message).toBe(
      "The EC2 instance metadata service (169.254.169.254) stopped answering (ECONNRESET). It is asked again on the next try.",
    );
    expect(error.isRetryable).toBe(true);
  });

  test.each([
    [403, false],
    [405, false],
    [503, true],
  ] as Array<[number, boolean]>)(
    "a session token refused (HTTP %i) is no credentials",
    async (status: number, isRetryable: boolean) => {
      const error: AwsCredentialChainError = await failureOf(
        chainWith({ env: {}, answers: [{ status: status, bodyText: "" }] }),
      );

      expect(error.message).toBe(
        `${NO_AWS_CREDENTIALS_MESSAGE} The EC2 instance metadata service (169.254.169.254) did not give a session token (HTTP ${status}).`,
      );
      expect(error.isRetryable).toBe(isRetryable);
    },
  );

  test("an instance with no role is told to attach an instance profile", async () => {
    const error: AwsCredentialChainError = await failureOf(
      chainWith({
        env: {},
        answers: [
          ok("AQAEAImdsSessionTokenEXAMPLE=="),
          { status: 404, bodyText: "" },
        ],
      }),
    );

    expect(error.message).toBe(
      "This EC2 instance has no IAM role. Attach an instance profile to it, or give the server an IAM role another way.",
    );
    expect(error.isRetryable).toBe(false);
  });

  test("a role name that is not one is never put in a path", async () => {
    const under: ChainUnderTest = chainWith({
      env: {},
      answers: [ok("AQAEAImdsSessionTokenEXAMPLE=="), ok("../../user-data")],
    });

    expect((await failureOf(under)).message).toBe(
      "The EC2 instance metadata service (169.254.169.254) did not name the instance's IAM role (HTTP 200).",
    );
    expect(under.http.requests).toHaveLength(2);
  });

  test("credentials the service could not give are asked again on the next try, with its code", async () => {
    const error: AwsCredentialChainError = await failureOf(
      chainWith({
        env: {},
        answers: [
          ok("AQAEAImdsSessionTokenEXAMPLE=="),
          ok("oneuptime-ses-instance"),
          ok(
            JSON.stringify({
              Code: "AssumeRoleUnauthorizedAccess",
              Message: "denied",
            }),
          ),
        ],
      }),
    );

    expect(error.message).toBe(
      "The EC2 instance metadata service (169.254.169.254) did not give the credentials of the IAM role oneuptime-ses-instance (HTTP 200, AssumeRoleUnauthorizedAccess). It is asked again on the next try.",
    );
    expect(error.isRetryable).toBe(true);
  });
});

describe("credentials in hand, and failures remembered", () => {
  const containerEnv: AwsChainEnvironment = {
    AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "/v2/credentials/7f1a",
  };

  test("are reused until five minutes before they expire, then fetched again", async () => {
    const under: ChainUnderTest = chainWith({
      env: containerEnv,
      answers: [ok(CONTAINER_ANSWER("2026-11-12T11:00:00Z"))],
    });

    await under.chain.getCredentials();
    under.clock.advance(54 * 60 * 1000);
    await under.chain.getCredentials();

    expect(under.http.requests).toHaveLength(1);

    under.clock.advance(60 * 1000);
    await under.chain.getCredentials();

    expect(under.http.requests).toHaveLength(2);
  });

  test("callers asking at the same time share one fetch", async () => {
    const under: ChainUnderTest = chainWith({
      env: containerEnv,
      answers: [ok(CONTAINER_ANSWER("2026-11-12T16:00:00Z"))],
    });

    const all: Array<AwsChainCredentials> = await Promise.all(
      [1, 2, 3, 4, 5].map((): Promise<AwsChainCredentials> => {
        return under.chain.getCredentials();
      }),
    );

    expect(under.http.requests).toHaveLength(1);
    expect(new Set(all).size).toBe(1);
  });

  test("a failure that would fail the same way is remembered for ten seconds, not asked a thousand times", async () => {
    const under: ChainUnderTest = chainWith({
      env: {},
      answers: [new AwsChainHttpError("timed out after 2 seconds", true)],
    });

    const first: AwsCredentialChainError = await failureOf(under);
    const again: AwsCredentialChainError = await failureOf(under);

    expect(again).toBe(first);
    expect(under.http.requests).toHaveLength(1);

    under.clock.advance(AWS_CREDENTIALS_FAILURE_MEMO_MS);
    await failureOf(under);

    expect(under.http.requests).toHaveLength(2);
  });

  test("a failure that may pass is not remembered: the next call asks again", async () => {
    const under: ChainUnderTest = chainWith({
      env: containerEnv,
      answers: [
        { status: 503, bodyText: "" },
        ok(CONTAINER_ANSWER("2026-11-12T16:00:00Z")),
      ],
    });

    await failureOf(under);

    expect((await under.chain.getCredentials()).source).toBe("container");
    expect(under.http.requests).toHaveLength(2);
  });

  test("invalidate drops the credentials in hand and any failure remembered", async () => {
    const under: ChainUnderTest = chainWith({
      env: containerEnv,
      answers: [
        ok(CONTAINER_ANSWER("2026-11-12T16:00:00Z")),
        { status: 401, bodyText: "" },
        ok(CONTAINER_ANSWER("2026-11-12T16:00:00Z")),
      ],
    });

    await under.chain.getCredentials();
    under.chain.invalidate();

    // Refused, and remembered...
    await failureOf(under);
    await failureOf(under);
    expect(under.http.requests).toHaveLength(2);

    // ...until SES says the credentials in hand are no good.
    under.chain.invalidate();
    await under.chain.getCredentials();
    expect(under.http.requests).toHaveLength(3);
  });

  test.each([
    // An hour: five minutes before.
    [60 * 60 * 1000, 55 * 60 * 1000],
    // Four minutes: halfway, so short-lived ones are not fetched for every request.
    [4 * 60 * 1000, 2 * 60 * 1000],
    // Already expired: at once.
    [-1000, 0],
  ] as Array<[number, number]>)(
    "credentials that expire in %i ms are fetched again after %i ms",
    (expiresInMs: number, refreshAfterMs: number) => {
      const fetchedAtMs: number = NOW.getTime();

      expect(
        AwsDefaultCredentialChain.getRefreshAtMs(
          {
            accessKeyId: "A",
            secretAccessKey: "B",
            sessionToken: null,
            expiresAt: new Date(fetchedAtMs + expiresInMs),
            source: "container",
          },
          fetchedAtMs,
        ),
      ).toBe(fetchedAtMs + refreshAfterMs);
    },
  );

  test("credentials without an expiry are fetched again after fifteen minutes", () => {
    expect(
      AwsDefaultCredentialChain.getRefreshAtMs(
        {
          accessKeyId: "A",
          secretAccessKey: "B",
          sessionToken: null,
          expiresAt: null,
          source: "container",
        },
        1000,
      ),
    ).toBe(1000 + AWS_CREDENTIALS_WITHOUT_EXPIRY_REUSE_MS);
    expect(AWS_CREDENTIALS_REFRESH_BEFORE_EXPIRY_MS).toBe(5 * 60 * 1000);
  });
});

describe("reading STS's answers", () => {
  test.each([
    ["us-east-1", "sts.us-east-1.amazonaws.com"],
    [" EU-WEST-1 ", "sts.eu-west-1.amazonaws.com"],
    ["cn-northwest-1", "sts.cn-northwest-1.amazonaws.com.cn"],
  ])("the STS host of %s is %s", (region: string, host: string) => {
    expect(AwsDefaultCredentialChain.getStsHost(region)).toBe(host);
  });

  test("an error's code and words, from JSON, from XML, or none", () => {
    expect(
      AwsDefaultCredentialChain.readStsError(
        '{"Error":{"Code":"AccessDenied","Message":"No."}}',
      ),
    ).toEqual({ code: "AccessDenied", message: "No." });
    expect(
      AwsDefaultCredentialChain.readStsError(
        "<ErrorResponse><Error><Code>Throttling</Code><Message>Rate &amp; burst</Message></Error></ErrorResponse>",
      ),
    ).toEqual({ code: "Throttling", message: "Rate & burst" });
    expect(AwsDefaultCredentialChain.readStsError("")).toEqual({
      code: "",
      message: "",
    });
    expect(AwsDefaultCredentialChain.readStsError("{not json")).toEqual({
      code: "",
      message: "",
    });
  });

  test("credentials missing a key, or with one that would not fit in a header, are none", () => {
    expect(
      AwsDefaultCredentialChain.readStsCredentials(
        "<Credentials><AccessKeyId>ASIA</AccessKeyId></Credentials>",
      ),
    ).toBeNull();
    expect(
      AwsDefaultCredentialChain.readStsCredentials(
        JSON.stringify({
          AssumeRoleWithWebIdentityResponse: {
            AssumeRoleWithWebIdentityResult: {
              Credentials: {
                AccessKeyId: "ASIA",
                SecretAccessKey: "line\nbreak",
              },
            },
          },
        }),
      ),
    ).toBeNull();
  });

  test("an XML element's text, its five entities decoded, or null", () => {
    expect(
      AwsDefaultCredentialChain.readXmlElement(
        "<a><B>&lt;x&gt; &quot;y&quot; &apos;z&apos; &amp;amp;</B></a>",
        "B",
      ),
    ).toBe("<x> \"y\" 'z' &amp;");
    expect(
      AwsDefaultCredentialChain.readXmlElement("<a><B>open", "B"),
    ).toBeNull();
    expect(AwsDefaultCredentialChain.readXmlElement("<a/>", "B")).toBeNull();
  });

  test("a header value is one line of printable text", () => {
    expect(isHeaderSafe("AKIAIOSFODNN7EXAMPLE")).toBe(true);
    expect(isHeaderSafe("")).toBe(false);
    expect(isHeaderSafe("a\nb")).toBe(false);
    expect(isHeaderSafe("a\u0000b")).toBe(false);
    expect(isHeaderSafe("a\u007fb")).toBe(false);
  });
});

describe("a time limit in words, as a timed-out request says it", () => {
  test.each([
    [1, "1 millisecond"],
    [100, "100 milliseconds"],
    [999, "999 milliseconds"],
    [1000, "1 second"],
    [1499, "1 second"],
    [1500, "2 seconds"],
    [CONTAINER_CREDENTIALS_TIMEOUT_MS, "2 seconds"],
    [STS_TIMEOUT_MS, "5 seconds"],
  ])("%d ms reads %s", (milliseconds: number, words: string) => {
    expect(describeTimeLimit(milliseconds)).toBe(words);
  });
});
