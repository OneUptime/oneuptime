jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
    EXTERNAL_FAULT: {},
  };
});

import ServerAwsIdentityAPI, {
  readIdentityRegion,
} from "../../FeatureSet/Notification/API/ServerAwsIdentity";
import ServerAwsIdentityService from "../../FeatureSet/Notification/Services/ServerAwsIdentityService";
import UserMiddleware, {
  RequestSession,
} from "Common/Server/Middleware/UserAuthorization";
import AwsDefaultCredentialChain, {
  AwsChainEnvironment,
  AwsChainHttpRequest,
  AwsChainHttpResponse,
  NO_AWS_CREDENTIALS_MESSAGE,
} from "Common/Server/Utils/Aws/AwsDefaultCredentialChain";
import {
  AwsChainProcessRequest,
  AwsChainProcessResult,
} from "Common/Server/Utils/Aws/AwsCredentialProcess";
import { expressErrorHandler } from "Common/Server/Utils/StartServer";
import {
  createExpressApp,
  ExpressApplication,
  ExpressJson,
} from "Common/Server/Utils/Express";
import {
  ServerAwsIdentityAnswer,
  ServerAwsIdentityVia,
  parseServerAwsIdentityAnswer,
} from "Common/Types/Email/ServerAwsIdentity";
import { JSONObject } from "Common/Types/JSON";
import JSONWebTokenData from "Common/Types/JsonWebTokenData";
import ObjectID from "Common/Types/ObjectID";
import {
  FakeAws,
  createFakeAws,
  stsError,
} from "Common/Tests/Server/Utils/CloudConnection/FakeAwsApi";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import http from "http";
import { SpyInstance } from "jest-mock";
import { AddressInfo } from "net";
import timers from "timers";

if (
  typeof (globalThis as unknown as { setImmediate?: unknown }).setImmediate !==
  "function"
) {
  (globalThis as unknown as { setImmediate: unknown }).setImmediate =
    timers.setImmediate;
}

/*
 * WHICH AWS IDENTITY THIS SERVER SIGNS IN AS (#7380): the line the Admin
 * Dashboard's Amazon SES card shows when the server's own email signs in
 * with the server's IAM role.
 *
 * The service asks AWS (sts:GetCallerIdentity, against a fake AWS) with
 * the server's own credentials from every source the chain knows, and
 * says who the server is and where its credentials came from - or why it
 * has none, in the chain's words. No answer carries a key, a secret, a
 * session token or an agent's token.
 *
 * Over HTTP, with the real master-admin middleware (only the session it
 * reads is scripted): a master admin is answered; a signed-out request, a
 * token that will not decode, a blocked user, a normal user and the master
 * API key alone are refused, and the server's credentials are never asked.
 */

const ENV_SECRET: string = "envSecretEXAMPLE0123456789abcdef";
const PROCESS_SECRET: string = "processSecretEXAMPLE0123456789abcdef";
const SESSION_TOKEN: string = "IQoJb3JpZ2luSessionTokenEXAMPLE";
const AGENT_TOKEN: string = "pod-identity-agent-token-EXAMPLE";
const WEB_IDENTITY_TOKEN: string = "eyJhbGciOiJSUzI1NiJ9.web-identity.EXAMPLE";

const CONTAINER_ANSWER: AwsChainHttpResponse = {
  status: 200,
  bodyText: JSON.stringify({
    AccessKeyId: "ASIA111122223333ROLE",
    SecretAccessKey: "containerSecretEXAMPLE0123456789",
    Token: SESSION_TOKEN,
    Expiration: "2099-01-01T00:00:00Z",
  }),
};

interface ScriptedChain {
  chain: AwsDefaultCredentialChain;
  asked: Array<AwsChainHttpRequest>;
  runs: Array<AwsChainProcessRequest>;
}

// A server with `env`, whose credential sources answer as scripted.
const serverWith: (data: {
  env: AwsChainEnvironment;
  answer?: (request: AwsChainHttpRequest) => AwsChainHttpResponse;
  files?: Record<string, string>;
  printed?: string;
}) => ScriptedChain = (data: {
  env: AwsChainEnvironment;
  answer?: (request: AwsChainHttpRequest) => AwsChainHttpResponse;
  files?: Record<string, string>;
  printed?: string;
}): ScriptedChain => {
  const asked: Array<AwsChainHttpRequest> = [];
  const runs: Array<AwsChainProcessRequest> = [];

  return {
    asked,
    runs,
    chain: new AwsDefaultCredentialChain({
      env: data.env,
      homeDirectory: "/home/oneuptime",
      httpClient: async (
        request: AwsChainHttpRequest,
      ): Promise<AwsChainHttpResponse> => {
        asked.push(request);
        return data.answer ? data.answer(request) : CONTAINER_ANSWER;
      },
      readFile: async (path: string): Promise<string> => {
        const content: string | undefined = (data.files || {})[path];

        if (content === undefined) {
          const error: Error & { code?: string } = new Error(
            `ENOENT: no such file or directory, open '${path}'`,
          );
          error.code = "ENOENT";
          throw error;
        }

        return content;
      },
      canWriteFile: async (): Promise<boolean> => {
        return false;
      },
      runProcess: async (
        request: AwsChainProcessRequest,
      ): Promise<AwsChainProcessResult> => {
        runs.push(request);
        return { outcome: "exited", exitCode: 0, stdout: data.printed || "" };
      },
    }),
  };
};

// Nothing an answer may hold: a key, a secret, a token, what a program printed.
const expectNoSecretIn: (answer: ServerAwsIdentityAnswer) => void = (
  answer: ServerAwsIdentityAnswer,
): void => {
  const text: string = JSON.stringify(answer);

  for (const secret of [
    ENV_SECRET,
    PROCESS_SECRET,
    SESSION_TOKEN,
    AGENT_TOKEN,
    WEB_IDENTITY_TOKEN,
    "containerSecretEXAMPLE",
    // An access key ID names an account: no answer carries the server's.
    "ASIA111122223333ROLE",
    "AKIAENVEXAMPLE000001",
  ]) {
    expect(text).not.toContain(secret);
  }
};

describe("which identity the server signs in as, from each source", () => {
  test("EKS Pod Identity: the role's ARN and account, asked with the session token in the email's Region", async () => {
    const server: ScriptedChain = serverWith({
      env: {
        AWS_CONTAINER_CREDENTIALS_FULL_URI:
          "http://169.254.170.23/v1/credentials",
        AWS_CONTAINER_AUTHORIZATION_TOKEN: AGENT_TOKEN,
      },
    });
    const fake: FakeAws = createFakeAws({ regions: {} });

    const answer: ServerAwsIdentityAnswer =
      await ServerAwsIdentityService.check({
        region: "eu-west-1",
        chain: server.chain,
        transport: fake.transport,
      });

    expect(answer).toEqual({
      isSignedIn: true,
      arn: "arn:aws:iam::111122223333:user/reader",
      account: "111122223333",
      via: ServerAwsIdentityVia.EksPodIdentity,
    });
    expect(fake.stsCalls).toHaveLength(1);
    expect(fake.stsCalls[0]!.action).toBe("GetCallerIdentity");
    expect(fake.stsCalls[0]!.request.url).toBe(
      "https://sts.eu-west-1.amazonaws.com/",
    );
    expect(
      (fake.stsCalls[0]!.request.headers as Record<string, string>)[
        "X-Amz-Security-Token"
      ],
    ).toBe(SESSION_TOKEN);
    expectNoSecretIn(answer);
  });

  test.each([
    [
      "Amazon ECS's task role",
      { AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "/v2/credentials/7f1a" },
      ServerAwsIdentityVia.EcsTaskRole,
    ],
    [
      "another container credentials endpoint",
      {
        AWS_CONTAINER_CREDENTIALS_FULL_URI: "https://credentials.internal/v1",
      },
      ServerAwsIdentityVia.Container,
    ],
    ["the EC2 instance profile", {}, ServerAwsIdentityVia.InstanceProfile],
  ] as Array<[string, AwsChainEnvironment, ServerAwsIdentityVia]>)(
    "%s",
    async (
      _name: string,
      env: AwsChainEnvironment,
      via: ServerAwsIdentityVia,
    ) => {
      const server: ScriptedChain = serverWith({
        env: env,
        answer: (request: AwsChainHttpRequest): AwsChainHttpResponse => {
          if (request.method === "PUT") {
            return { status: 200, bodyText: "imds-session-token" };
          }

          if (request.url.endsWith("/security-credentials/")) {
            return { status: 200, bodyText: "oneuptime-ses" };
          }

          return CONTAINER_ANSWER;
        },
      });

      const answer: ServerAwsIdentityAnswer =
        await ServerAwsIdentityService.check({
          region: "us-east-1",
          chain: server.chain,
          transport: createFakeAws({ regions: {} }).transport,
        });

      expect(answer.isSignedIn).toBe(true);
      expect(answer.via).toBe(via);
      expectNoSecretIn(answer);
    },
  );

  test("keys in the environment", async () => {
    const answer: ServerAwsIdentityAnswer =
      await ServerAwsIdentityService.check({
        region: "us-east-1",
        chain: serverWith({
          env: {
            AWS_ACCESS_KEY_ID: "AKIAENVEXAMPLE000001",
            AWS_SECRET_ACCESS_KEY: ENV_SECRET,
          },
        }).chain,
        transport: createFakeAws({ regions: {}, account: "444455556666" })
          .transport,
      });

    expect(answer).toEqual({
      isSignedIn: true,
      arn: "arn:aws:iam::444455556666:user/reader",
      account: "444455556666",
      via: ServerAwsIdentityVia.Environment,
    });
    expectNoSecretIn(answer);
  });

  test("a web identity token (IAM roles for service accounts)", async () => {
    const server: ScriptedChain = serverWith({
      env: {
        AWS_ROLE_ARN: "arn:aws:iam::111122223333:role/oneuptime-ses",
        AWS_WEB_IDENTITY_TOKEN_FILE: "/var/run/token",
      },
      files: { "/var/run/token": WEB_IDENTITY_TOKEN },
      answer: (): AwsChainHttpResponse => {
        return {
          status: 200,
          bodyText: JSON.stringify({
            AssumeRoleWithWebIdentityResponse: {
              AssumeRoleWithWebIdentityResult: {
                Credentials: {
                  AccessKeyId: "ASIA111122223333ROLE",
                  SecretAccessKey: "containerSecretEXAMPLE0123456789",
                  SessionToken: SESSION_TOKEN,
                  Expiration: 4102444800,
                },
              },
            },
          }),
        };
      },
    });

    const answer: ServerAwsIdentityAnswer =
      await ServerAwsIdentityService.check({
        region: "us-west-2",
        chain: server.chain,
        transport: createFakeAws({ regions: {} }).transport,
      });

    expect(answer.via).toBe(ServerAwsIdentityVia.WebIdentity);
    expect(answer.isSignedIn).toBe(true);
    // The token was traded in the email's Region: the server names none.
    expect(server.asked[0]!.url).toBe("https://sts.us-west-2.amazonaws.com/");
    expectNoSecretIn(answer);
  });

  test("an AWS profile's credential_process (IAM Roles Anywhere)", async () => {
    const server: ScriptedChain = serverWith({
      env: { AWS_CONFIG_FILE: "/etc/oneuptime/aws/config" },
      files: {
        "/etc/oneuptime/aws/config":
          "[default]\ncredential_process = /usr/local/bin/aws_signing_helper credential-process --pin 1234\n",
      },
      printed: JSON.stringify({
        Version: 1,
        AccessKeyId: "ASIA111122223333ROLE",
        SecretAccessKey: PROCESS_SECRET,
        SessionToken: SESSION_TOKEN,
        Expiration: "2099-01-01T00:00:00Z",
      }),
    });

    const answer: ServerAwsIdentityAnswer =
      await ServerAwsIdentityService.check({
        region: "us-east-1",
        chain: server.chain,
        transport: createFakeAws({ regions: {} }).transport,
      });

    expect(answer.via).toBe(ServerAwsIdentityVia.Profile);
    expect(answer.isSignedIn).toBe(true);
    expect(server.runs).toHaveLength(1);
    expectNoSecretIn(answer);
  });
});

describe("why the server cannot sign in", () => {
  test("no credentials at all: the chain's words, no source, nothing asked of AWS", async () => {
    const fake: FakeAws = createFakeAws({ regions: {} });

    const answer: ServerAwsIdentityAnswer =
      await ServerAwsIdentityService.check({
        region: "us-east-1",
        chain: serverWith({ env: { AWS_EC2_METADATA_DISABLED: "true" } }).chain,
        transport: fake.transport,
      });

    expect(answer).toEqual({
      isSignedIn: false,
      problem: NO_AWS_CREDENTIALS_MESSAGE,
    });
    expect(fake.stsCalls).toHaveLength(0);
  });

  test("an agent that refuses: where it was asked, its token scrubbed", async () => {
    const answer: ServerAwsIdentityAnswer =
      await ServerAwsIdentityService.check({
        region: "us-east-1",
        chain: serverWith({
          env: {
            AWS_CONTAINER_CREDENTIALS_FULL_URI:
              "http://169.254.170.23/v1/credentials",
            AWS_CONTAINER_AUTHORIZATION_TOKEN: AGENT_TOKEN,
          },
          answer: (): AwsChainHttpResponse => {
            return {
              status: 403,
              bodyText: `token ${AGENT_TOKEN} is not this pod's`,
            };
          },
        }).chain,
        transport: createFakeAws({ regions: {} }).transport,
      });

    expect(answer.isSignedIn).toBe(false);
    expect(answer.via).toBe(ServerAwsIdentityVia.EksPodIdentity);
    expect(answer.problem).toContain(
      "The EKS Pod Identity agent (169.254.170.23) refused to give this server credentials (HTTP 403).",
    );
    expect(answer.problem).toContain("[redacted]");
    expectNoSecretIn(answer);
  });

  test("a credential_process that fails: what to do, never what it printed", async () => {
    const answer: ServerAwsIdentityAnswer =
      await ServerAwsIdentityService.check({
        region: "us-east-1",
        chain: serverWith({
          env: { AWS_CONFIG_FILE: "/etc/oneuptime/aws/config" },
          files: {
            "/etc/oneuptime/aws/config":
              "[default]\ncredential_process = /usr/local/bin/aws_signing_helper\n",
          },
          printed: `not json ${PROCESS_SECRET}`,
        }).chain,
        transport: createFakeAws({ regions: {} }).transport,
      });

    expect(answer.isSignedIn).toBe(false);
    expect(answer.via).toBe(ServerAwsIdentityVia.Profile);
    expect(answer.problem).toContain("did not print its credentials as a JSON");
    expectNoSecretIn(answer);
  });

  test("AWS refusing the credentials: its code, and new credentials for the next email", async () => {
    const server: ScriptedChain = serverWith({
      env: { AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "/v2/credentials/7f1a" },
    });
    const refusing: FakeAws = createFakeAws({
      regions: {},
      callerIdentityError: stsError(
        403,
        "InvalidClientTokenId",
        "The security token included in the request is invalid.",
      ),
    });

    const answer: ServerAwsIdentityAnswer =
      await ServerAwsIdentityService.check({
        region: "us-east-1",
        chain: server.chain,
        transport: refusing.transport,
      });

    expect(answer.isSignedIn).toBe(false);
    expect(answer.via).toBe(ServerAwsIdentityVia.EcsTaskRole);
    expect(answer.problem).toContain(
      "AWS did not say which identity this server signs in as.",
    );
    expect(answer.problem).toContain("InvalidClientTokenId");
    expectNoSecretIn(answer);

    // The credentials in hand were dropped: the next check fetches new ones.
    await ServerAwsIdentityService.check({
      region: "us-east-1",
      chain: server.chain,
      transport: createFakeAws({ regions: {} }).transport,
    });

    expect(server.asked).toHaveLength(2);
  });

  test("a refusal that is not of the credentials keeps them", async () => {
    const server: ScriptedChain = serverWith({
      env: { AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "/v2/credentials/7f1a" },
    });

    for (const transport of [
      createFakeAws({
        regions: {},
        callerIdentityError: stsError(400, "RegionDisabledException"),
      }).transport,
      createFakeAws({ regions: {} }).transport,
    ]) {
      await ServerAwsIdentityService.check({
        region: "us-east-1",
        chain: server.chain,
        transport: transport,
      });
    }

    expect(server.asked).toHaveLength(1);
  });
});

describe("the Region STS is asked in", () => {
  const chain: AwsDefaultCredentialChain = new AwsDefaultCredentialChain({
    env: { AWS_REGION: "ap-south-1" },
  });

  test.each([
    ["eu-central-1", "eu-central-1"],
    [" CN-NORTH-1 ", "cn-north-1"],
    // Not a Region code: the server's own.
    ["evil.example.com", "ap-south-1"],
    [undefined, "ap-south-1"],
  ] as Array<[string | undefined, string]>)(
    "%j: %s",
    (region: string | undefined, expected: string) => {
      expect(ServerAwsIdentityService.getRegion(region, chain)).toBe(expected);
    },
  );

  test("us-east-1 when the server names none either", () => {
    expect(
      ServerAwsIdentityService.getRegion(
        undefined,
        new AwsDefaultCredentialChain({ env: {} }),
      ),
    ).toBe("us-east-1");
  });

  test("the route reads a Region of at most 40 characters, or none", () => {
    expect(readIdentityRegion(" us-east-1 ")).toBe("us-east-1");
    expect(readIdentityRegion("x".repeat(100))).toHaveLength(40);
    expect(readIdentityRegion(["us-east-1"])).toBeUndefined();
    expect(readIdentityRegion("")).toBeUndefined();
  });
});

describe("reading an answer back, as the page does", () => {
  test("a signed-in answer needs its ARN; any other field is dropped", () => {
    expect(
      parseServerAwsIdentityAnswer({
        isSignedIn: true,
        arn: "arn:aws:sts::111122223333:assumed-role/oneuptime-ses/i-0abc",
        account: "111122223333",
        via: "eks-pod-identity",
        secretAccessKey: "never shown",
      }),
    ).toEqual({
      isSignedIn: true,
      arn: "arn:aws:sts::111122223333:assumed-role/oneuptime-ses/i-0abc",
      account: "111122223333",
      via: ServerAwsIdentityVia.EksPodIdentity,
    });
    expect(parseServerAwsIdentityAnswer({ isSignedIn: true })).toBeNull();
    expect(parseServerAwsIdentityAnswer({ arn: "x" })).toBeNull();
    expect(parseServerAwsIdentityAnswer(null)).toBeNull();
  });

  test("a refusal keeps its problem, and an unknown source is none", () => {
    expect(
      parseServerAwsIdentityAnswer({
        isSignedIn: false,
        via: "somewhere-else",
        problem: "No role.",
      }),
    ).toEqual({ isSignedIn: false, problem: "No role." });
  });
});

describe("over HTTP, with the real master-admin middleware", () => {
  let server: http.Server;
  let port: number;

  // The session each request's x-test-session header names.
  const SESSIONS: Record<string, RequestSession> = {
    none: { kind: "none" },
    invalid: { kind: "invalid", error: new Error("bad token") },
    blocked: {
      kind: "blocked",
      session: {
        userId: new ObjectID(),
        isMasterAdmin: true,
      } as unknown as JSONWebTokenData,
    },
    user: {
      kind: "user",
      session: {
        userId: new ObjectID(),
        isMasterAdmin: false,
      } as unknown as JSONWebTokenData,
    },
    admin: {
      kind: "user",
      session: {
        userId: new ObjectID(),
        isMasterAdmin: true,
      } as unknown as JSONWebTokenData,
    },
  };

  const scriptSessions: () => void = (): void => {
    jest
      .spyOn(UserMiddleware, "readRequestSession")
      .mockImplementation(
        async (
          req: Parameters<typeof UserMiddleware.readRequestSession>[0],
        ) => {
          const name: string = String(
            (req.headers as Record<string, unknown>)["x-test-session"] ||
              "none",
          );
          return SESSIONS[name] || { kind: "none" };
        },
      );
  };

  beforeAll(async () => {
    const app: ExpressApplication = createExpressApp();
    app.use(ExpressJson());
    app.use("/api/notification/server-aws-identity", ServerAwsIdentityAPI);
    app.use(expressErrorHandler);
    server = http.createServer(app);

    await new Promise<void>((resolve: () => void) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    port = (server.address() as AddressInfo).port;
  });

  beforeEach(() => {
    scriptSessions();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await new Promise<void>((resolve: () => void) => {
      server.close(() => {
        resolve();
      });
    });
  });

  const get: (data: {
    session?: string;
    headers?: Record<string, string>;
    query?: string;
  }) => Promise<{ status: number; body: JSONObject | null }> = (data: {
    session?: string;
    headers?: Record<string, string>;
    query?: string;
  }): Promise<{ status: number; body: JSONObject | null }> => {
    return new Promise(
      (
        resolve: (result: { status: number; body: JSONObject | null }) => void,
        reject: (error: Error) => void,
      ) => {
        const request: http.ClientRequest = http.request(
          {
            host: "127.0.0.1",
            port: port,
            path: `/api/notification/server-aws-identity${data.query || ""}`,
            method: "GET",
            headers: {
              ...(data.session ? { "x-test-session": data.session } : {}),
              ...(data.headers || {}),
            },
          },
          (response: http.IncomingMessage) => {
            const chunks: Array<Buffer> = [];

            response.on("data", (chunk: Buffer) => {
              chunks.push(chunk);
            });
            response.on("end", () => {
              const raw: string = Buffer.concat(chunks).toString("utf8");
              let body: JSONObject | null = null;

              try {
                body = raw ? (JSON.parse(raw) as JSONObject) : null;
              } catch {
                body = null;
              }

              resolve({ status: response.statusCode || 0, body });
            });
          },
        );

        request.on("error", reject);
        request.end();
      },
    );
  };

  test("a master admin is told who the server is, for the Region the card names", async () => {
    const check: SpyInstance<typeof ServerAwsIdentityService.check> = jest
      .spyOn(ServerAwsIdentityService, "check")
      .mockResolvedValue({
        isSignedIn: true,
        arn: "arn:aws:sts::111122223333:assumed-role/oneuptime-ses/i-0abc",
        account: "111122223333",
        via: ServerAwsIdentityVia.InstanceProfile,
      });

    const result: { status: number; body: JSONObject | null } = await get({
      session: "admin",
      query: "?region=eu-west-1",
    });

    expect(result.status).toBe(200);
    expect(parseServerAwsIdentityAnswer(result.body)).toEqual({
      isSignedIn: true,
      arn: "arn:aws:sts::111122223333:assumed-role/oneuptime-ses/i-0abc",
      account: "111122223333",
      via: ServerAwsIdentityVia.InstanceProfile,
    });
    expect(check).toHaveBeenCalledWith({ region: "eu-west-1" });
  });

  test.each([
    ["signed out", { session: "none" }, 401],
    ["a token that will not decode", { session: "invalid" }, 401],
    ["a blocked user", { session: "blocked" }, 401],
    ["a normal user", { session: "user" }, 422],
    [
      "the master API key alone: it never reaches the server's AWS identity",
      {
        session: "none",
        headers: { apikey: "8e1a3a52-6d64-4f1f-9a2e-5f0f9c1d2b34" },
      },
      401,
    ],
  ] as Array<
    [string, { session: string; headers?: Record<string, string> }, number]
  >)(
    "refused: %s",
    async (
      _name: string,
      request: { session: string; headers?: Record<string, string> },
      status: number,
    ) => {
      const check: SpyInstance<typeof ServerAwsIdentityService.check> =
        jest.spyOn(ServerAwsIdentityService, "check");

      const result: { status: number; body: JSONObject | null } =
        await get(request);

      expect(result.status).toBe(status);
      expect(check).not.toHaveBeenCalled();
      expect(JSON.stringify(result.body)).not.toContain("arn:aws");
    },
  );
});
