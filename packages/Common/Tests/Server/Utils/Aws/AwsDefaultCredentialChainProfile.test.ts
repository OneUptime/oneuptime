import AwsDefaultCredentialChain, {
  AWS_CREDENTIALS_FAILURE_MEMO_MS,
  AWS_CREDENTIALS_WITHOUT_EXPIRY_REUSE_MS,
  AwsChainCredentials,
  AwsChainEnvironment,
  AwsChainHttpRequest,
  AwsChainHttpResponse,
  AwsCredentialChainError,
} from "../../../../Server/Utils/Aws/AwsDefaultCredentialChain";
import {
  AwsChainProcessRequest,
  AwsChainProcessResult,
  CREDENTIAL_PROCESS_TIMEOUT_MS,
  MAX_CREDENTIAL_PROCESS_OUTPUT_BYTES,
} from "../../../../Server/Utils/Aws/AwsCredentialProcess";
import { describe, expect, test } from "@jest/globals";

/*
 * THE SERVER'S CREDENTIALS FROM A PROFILE OF THE AWS SHARED CONFIG FILES
 * (#7381): off AWS, IAM Roles Anywhere through aws_signing_helper as the
 * profile's credential_process, or keys written in the profile.
 *
 * The profile is read only when the environment names it (AWS_PROFILE,
 * AWS_CONFIG_FILE or AWS_SHARED_CREDENTIALS_FILE), after keys in the
 * environment and before a web identity, as the SDKs order them, and it is
 * then where the credentials come from: one with none is said to be so,
 * never passed over. A credential_process runs with no shell, by its full
 * path, within its time and its output's cap, and only from a file the
 * server cannot change. Every request it makes of the injected runner is
 * pinned here, and no message carries a key, a token, an argument or what
 * the program printed - on any path.
 */

const NOW: Date = new Date("2026-11-20T10:00:00.000Z");
const HOME: string = "/home/oneuptime";
const CONFIG_FILE: string = "/etc/oneuptime/aws/config";
const CREDENTIALS_FILE: string = "/etc/oneuptime/aws/credentials";
const HELPER: string = "/usr/local/bin/aws_signing_helper";

// What the program prints, and the secrets in it no message may show.
const PROCESS_SECRET: string = "processSecretEXAMPLE0123456789abcdef";
const PROCESS_TOKEN: string = "IQoJb3JpZ2luX2VjEProcessSessionToken";

const PROCESS_OUTPUT: (expiration: string | undefined) => string = (
  expiration: string | undefined,
): string => {
  return JSON.stringify({
    Version: 1,
    AccessKeyId: "ASIAPROCESSEXAMPLE01",
    SecretAccessKey: PROCESS_SECRET,
    SessionToken: PROCESS_TOKEN,
    ...(expiration ? { Expiration: expiration } : {}),
  });
};

const ROLES_ANYWHERE_LINE: string = `${HELPER} credential-process --certificate /etc/oneuptime/aws/cert.pem --private-key /etc/oneuptime/aws/key.pem --trust-anchor-arn arn:aws:rolesanywhere:us-east-1:111122223333:trust-anchor/0a1b --profile-arn arn:aws:rolesanywhere:us-east-1:111122223333:profile/2c3d --role-arn arn:aws:iam::111122223333:role/oneuptime --pin super-secret-pin`;

const ROLES_ANYWHERE_CONFIG: string = `[profile oneuptime]\ncredential_process = ${ROLES_ANYWHERE_LINE}\n`;

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

interface ProfileChain {
  chain: AwsDefaultCredentialChain;
  clock: Clock;
  reads: Array<string>;
  runs: Array<AwsChainProcessRequest>;
  writabilityChecks: Array<string>;
  httpRequests: Array<AwsChainHttpRequest>;
}

const enoent: (path: string) => Error = (path: string): Error => {
  const error: Error & { code?: string } = new Error(
    `ENOENT: no such file or directory, open '${path}'`,
  );
  error.code = "ENOENT";
  return error;
};

function profileChain(data: {
  env: AwsChainEnvironment;
  files?: Record<string, string | Error>;
  // The files the server could change: none by default (read-only mounts).
  writable?: Array<string>;
  results?:
    | Array<AwsChainProcessResult>
    | ((request: AwsChainProcessRequest) => AwsChainProcessResult);
}): ProfileChain {
  const clock: Clock = clockAt(NOW);
  const reads: Array<string> = [];
  const runs: Array<AwsChainProcessRequest> = [];
  const writabilityChecks: Array<string> = [];
  const httpRequests: Array<AwsChainHttpRequest> = [];

  const chain: AwsDefaultCredentialChain = new AwsDefaultCredentialChain({
    env: data.env,
    now: clock.now,
    homeDirectory: HOME,
    httpClient: async (
      request: AwsChainHttpRequest,
    ): Promise<AwsChainHttpResponse> => {
      httpRequests.push(request);
      throw new Error("nothing should be asked over HTTP");
    },
    readFile: async (path: string): Promise<string> => {
      reads.push(path);
      const content: string | Error | undefined = (data.files || {})[path];

      if (content === undefined) {
        throw enoent(path);
      }

      if (content instanceof Error) {
        throw content;
      }

      return content;
    },
    canWriteFile: async (path: string): Promise<boolean> => {
      writabilityChecks.push(path);
      return (data.writable || []).includes(path);
    },
    runProcess: async (
      request: AwsChainProcessRequest,
    ): Promise<AwsChainProcessResult> => {
      runs.push(request);
      const results:
        | Array<AwsChainProcessResult>
        | ((request: AwsChainProcessRequest) => AwsChainProcessResult) =
        data.results || [{ outcome: "not-started", reason: "ENOENT" }];

      return typeof results === "function"
        ? results(request)
        : results[Math.min(runs.length - 1, results.length - 1)]!;
    },
  });

  return {
    chain: chain,
    clock: clock,
    reads: reads,
    runs: runs,
    writabilityChecks: writabilityChecks,
    httpRequests: httpRequests,
  };
}

async function failureOf(
  under: ProfileChain,
): Promise<AwsCredentialChainError> {
  try {
    await under.chain.getCredentials();
  } catch (error) {
    expect(error).toBeInstanceOf(AwsCredentialChainError);
    return error as AwsCredentialChainError;
  }

  throw new Error("Credentials were found.");
}

// No message may name a secret, an argument, or anything the program printed.
const expectNothingSecretIn: (message: string) => void = (
  message: string,
): void => {
  for (const secret of [
    PROCESS_SECRET,
    PROCESS_TOKEN,
    "super-secret-pin",
    "profileSecretEXAMPLE",
    "--certificate",
    "trust-anchor/0a1b",
  ]) {
    expect(message).not.toContain(secret);
  }
};

const exited: (stdout: string, exitCode?: number) => AwsChainProcessResult = (
  stdout: string,
  exitCode: number = 0,
): AwsChainProcessResult => {
  return { outcome: "exited", exitCode: exitCode, stdout: stdout };
};

const ROLES_ANYWHERE_ENV: AwsChainEnvironment = {
  AWS_PROFILE: "oneuptime",
  AWS_CONFIG_FILE: CONFIG_FILE,
};

describe("when the profile is where the credentials come from", () => {
  test.each([
    [{ AWS_PROFILE: "oneuptime" }],
    [{ AWS_CONFIG_FILE: CONFIG_FILE }],
    [{ AWS_SHARED_CREDENTIALS_FILE: CREDENTIALS_FILE }],
  ] as Array<[AwsChainEnvironment]>)(
    "the environment names it: %j",
    (env: AwsChainEnvironment) => {
      expect(new AwsDefaultCredentialChain({ env: env }).getSource()).toBe(
        "profile",
      );
    },
  );

  test("after keys in the environment, before a web identity, the container and the instance profile", () => {
    const everything: AwsChainEnvironment = {
      AWS_ACCESS_KEY_ID: "AKIAENVEXAMPLE000001",
      AWS_SECRET_ACCESS_KEY: "envSecret",
      AWS_PROFILE: "oneuptime",
      AWS_ROLE_ARN: "arn:aws:iam::111122223333:role/oneuptime",
      AWS_WEB_IDENTITY_TOKEN_FILE: "/var/run/token",
      AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "/v2/credentials/abc",
    };

    expect(new AwsDefaultCredentialChain({ env: everything }).getSource()).toBe(
      "environment",
    );
    expect(
      new AwsDefaultCredentialChain({
        env: {
          ...everything,
          AWS_ACCESS_KEY_ID: "",
          AWS_SECRET_ACCESS_KEY: undefined,
        },
      }).getSource(),
    ).toBe("profile");
  });

  test("with nothing naming them, the files are never read and no program runs", async () => {
    const under: ProfileChain = profileChain({
      env: { AWS_EC2_METADATA_DISABLED: "true" },
      files: {
        [`${HOME}/.aws/config`]: `[default]\ncredential_process = ${HELPER}\n`,
        [`${HOME}/.aws/credentials`]:
          "[default]\naws_access_key_id = AKIANOTREAD000000001\naws_secret_access_key = notRead\n",
      },
    });

    expect(under.chain.getSource()).toBeNull();
    await failureOf(under);
    expect(under.reads).toHaveLength(0);
    expect(under.runs).toHaveLength(0);
  });

  test("a source left out of the chain's sources is never read", () => {
    expect(
      new AwsDefaultCredentialChain({
        env: { AWS_PROFILE: "oneuptime", AWS_EC2_METADATA_DISABLED: "true" },
        sources: ["web-identity", "container", "environment"],
      }).getSource(),
    ).toBeNull();
  });
});

describe("keys written in the profile", () => {
  test("are read from the credentials file, which wins over the config file", async () => {
    const under: ProfileChain = profileChain({
      env: {
        AWS_PROFILE: "oneuptime",
        AWS_CONFIG_FILE: CONFIG_FILE,
        AWS_SHARED_CREDENTIALS_FILE: CREDENTIALS_FILE,
      },
      files: {
        [CONFIG_FILE]:
          "[profile oneuptime]\naws_access_key_id = AKIACONFIGEXAMPLE001\naws_secret_access_key = configSecret\n",
        [CREDENTIALS_FILE]:
          "[oneuptime]\naws_access_key_id = AKIAPROFILEEXAMPLE01\naws_secret_access_key = profileSecretEXAMPLE\naws_session_token = profileToken\n",
      },
    });

    expect(await under.chain.getCredentials()).toEqual({
      accessKeyId: "AKIAPROFILEEXAMPLE01",
      secretAccessKey: "profileSecretEXAMPLE",
      sessionToken: "profileToken",
      expiresAt: null,
      source: "profile",
    });
    expect(under.reads).toEqual([CONFIG_FILE, CREDENTIALS_FILE]);
    // Keys are data: nothing runs, and no file has to be read-only.
    expect(under.runs).toHaveLength(0);
    expect(under.writabilityChecks).toHaveLength(0);
    expect(under.httpRequests).toHaveLength(0);
  });

  test("the default files and profile, when only AWS_PROFILE names one", async () => {
    const under: ProfileChain = profileChain({
      env: { AWS_PROFILE: "default" },
      files: {
        [`${HOME}/.aws/credentials`]:
          "[default]\naws_access_key_id = AKIADEFAULTEXAMPLE01\naws_secret_access_key = defaultSecret\n",
      },
    });

    expect((await under.chain.getCredentials()).accessKeyId).toBe(
      "AKIADEFAULTEXAMPLE01",
    );
    // ~/.aws/config is not there: a default file may be missing.
    expect(under.reads).toEqual([
      `${HOME}/.aws/config`,
      `${HOME}/.aws/credentials`,
    ]);
  });

  test("are kept fifteen minutes, then read again: a rotated key is picked up", async () => {
    const files: Record<string, string> = {
      [CREDENTIALS_FILE]:
        "[default]\naws_access_key_id = AKIAFIRSTEXAMPLE0001\naws_secret_access_key = firstSecret\n",
    };
    const under: ProfileChain = profileChain({
      env: { AWS_SHARED_CREDENTIALS_FILE: CREDENTIALS_FILE },
      files: files,
    });

    await under.chain.getCredentials();
    files[CREDENTIALS_FILE] =
      "[default]\naws_access_key_id = AKIASECONDEXAMPLE001\naws_secret_access_key = secondSecret\n";

    expect((await under.chain.getCredentials()).accessKeyId).toBe(
      "AKIAFIRSTEXAMPLE0001",
    );

    under.clock.advance(AWS_CREDENTIALS_WITHOUT_EXPIRY_REUSE_MS);

    expect((await under.chain.getCredentials()).accessKeyId).toBe(
      "AKIASECONDEXAMPLE001",
    );
  });

  test.each([
    [
      "[default]\naws_access_key_id = AKIAONLYIDEXAMPLE001\n",
      "The AWS profile default has aws_access_key_id but not aws_secret_access_key. Give it both.",
    ],
    [
      "[default]\naws_secret_access_key = profileSecretEXAMPLE\n",
      "The AWS profile default has aws_secret_access_key but not aws_access_key_id. Give it both.",
    ],
  ])(
    "half a key says which half is missing: %#",
    async (file: string, message: string) => {
      const error: AwsCredentialChainError = await failureOf(
        profileChain({
          env: { AWS_SHARED_CREDENTIALS_FILE: CREDENTIALS_FILE },
          files: { [CREDENTIALS_FILE]: file },
        }),
      );

      expect(error.message).toBe(message);
      expect(error.isRetryable).toBe(false);
      expect(error.source).toBe("profile");
      expectNothingSecretIn(error.message);
    },
  );
});

describe("a profile that cannot be used says why", () => {
  test("a profile in neither file", async () => {
    const error: AwsCredentialChainError = await failureOf(
      profileChain({
        env: { AWS_PROFILE: "oneuptime", AWS_CONFIG_FILE: CONFIG_FILE },
        files: { [CONFIG_FILE]: "[profile other]\nregion = us-east-1\n" },
      }),
    );

    expect(error.message).toBe(
      `The AWS profile oneuptime is in neither ${CONFIG_FILE} nor ${HOME}/.aws/credentials. Add it to one of them, or set AWS_PROFILE to a profile that is there.`,
    );
    expect(error.isRetryable).toBe(false);
  });

  test("a file the environment names must be there", async () => {
    const under: ProfileChain = profileChain({
      env: { AWS_CONFIG_FILE: CONFIG_FILE },
    });
    const error: AwsCredentialChainError = await failureOf(under);

    expect(error.message).toBe(
      `AWS_CONFIG_FILE names ${CONFIG_FILE}, which could not be read: ENOENT: no such file or directory, open '${CONFIG_FILE}'. Mount the file there, where OneUptime can read it.`,
    );
    expect(error.isRetryable).toBe(false);
    expect(under.runs).toHaveLength(0);
  });

  test("a default file that is there but cannot be read is said too", async () => {
    const denied: Error & { code?: string } = new Error(
      `EACCES: permission denied, open '${HOME}/.aws/config'`,
    );
    denied.code = "EACCES";

    const error: AwsCredentialChainError = await failureOf(
      profileChain({
        env: { AWS_PROFILE: "oneuptime" },
        files: { [`${HOME}/.aws/config`]: denied },
      }),
    );

    expect(error.message).toBe(
      `The AWS config file ${HOME}/.aws/config could not be read: EACCES: permission denied, open '${HOME}/.aws/config'.`,
    );
  });

  test("a file larger than a profile could be is not read", async () => {
    const error: AwsCredentialChainError = await failureOf(
      profileChain({
        env: { AWS_CONFIG_FILE: CONFIG_FILE },
        files: { [CONFIG_FILE]: `[default]\n${"#".repeat(1024 * 1024)}\n` },
      }),
    );

    expect(error.message).toBe(
      `The AWS config file ${CONFIG_FILE} is longer than 1 MB, so it is not read. A profile takes a few lines.`,
    );
  });

  test("AWS_PROFILE that is not a profile's name is refused before anything is read", async () => {
    const under: ProfileChain = profileChain({
      env: { AWS_PROFILE: "../../etc/passwd x" },
    });

    expect((await failureOf(under)).message).toBe(
      "AWS_PROFILE is not the name of a profile. Set it to the name of one in the AWS config file, such as oneuptime.",
    );
    expect(under.reads).toHaveLength(0);
  });

  test.each([
    [
      "role_arn = arn:aws:iam::111122223333:role/x\nsource_profile = base",
      "The AWS profile oneuptime signs in with role_arn, which OneUptime does not read from a profile. Give the profile a credential_process, or aws_access_key_id and aws_secret_access_key.",
    ],
    [
      "sso_session = corp",
      "The AWS profile oneuptime signs in with sso_session, which OneUptime does not read from a profile. Give the profile a credential_process, or aws_access_key_id and aws_secret_access_key.",
    ],
    [
      "region = us-east-1",
      "The AWS profile oneuptime has no credentials. Give it a credential_process (such as IAM Roles Anywhere's aws_signing_helper), or aws_access_key_id and aws_secret_access_key.",
    ],
  ])(
    "a profile with no credentials OneUptime reads: %#",
    async (settings: string, message: string) => {
      const under: ProfileChain = profileChain({
        env: {
          ...ROLES_ANYWHERE_ENV,
          // Named, the profile is chosen: never passed over for the next source.
          AWS_ROLE_ARN: "arn:aws:iam::111122223333:role/oneuptime",
          AWS_WEB_IDENTITY_TOKEN_FILE: "/var/run/token",
        },
        files: { [CONFIG_FILE]: `[profile oneuptime]\n${settings}\n` },
      });

      const error: AwsCredentialChainError = await failureOf(under);

      expect(error.message).toBe(message);
      expect(error.source).toBe("profile");
      expect(under.httpRequests).toHaveLength(0);
    },
  );
});

describe("a profile's credential_process (IAM Roles Anywhere)", () => {
  test("runs the program with its arguments, no shell, the server's environment, a time limit and an output cap", async () => {
    const env: AwsChainEnvironment = {
      ...ROLES_ANYWHERE_ENV,
      HTTPS_PROXY: "http://proxy.internal:3128",
      UNSET: undefined,
    };
    const under: ProfileChain = profileChain({
      env: env,
      files: { [CONFIG_FILE]: ROLES_ANYWHERE_CONFIG },
      results: [exited(`${PROCESS_OUTPUT("2026-11-20T11:00:00Z")}\n`)],
    });

    expect(await under.chain.getCredentials()).toEqual({
      accessKeyId: "ASIAPROCESSEXAMPLE01",
      secretAccessKey: PROCESS_SECRET,
      sessionToken: PROCESS_TOKEN,
      expiresAt: new Date("2026-11-20T11:00:00Z"),
      source: "profile",
    });

    expect(under.writabilityChecks).toEqual([CONFIG_FILE]);
    expect(under.runs).toEqual([
      {
        program: HELPER,
        args: [
          "credential-process",
          "--certificate",
          "/etc/oneuptime/aws/cert.pem",
          "--private-key",
          "/etc/oneuptime/aws/key.pem",
          "--trust-anchor-arn",
          "arn:aws:rolesanywhere:us-east-1:111122223333:trust-anchor/0a1b",
          "--profile-arn",
          "arn:aws:rolesanywhere:us-east-1:111122223333:profile/2c3d",
          "--role-arn",
          "arn:aws:iam::111122223333:role/oneuptime",
          "--pin",
          "super-secret-pin",
        ],
        env: {
          AWS_PROFILE: "oneuptime",
          AWS_CONFIG_FILE: CONFIG_FILE,
          HTTPS_PROXY: "http://proxy.internal:3128",
        },
        timeoutMs: CREDENTIAL_PROCESS_TIMEOUT_MS,
        maxOutputBytes: MAX_CREDENTIAL_PROCESS_OUTPUT_BYTES,
      },
    ]);
    expect(under.httpRequests).toHaveLength(0);
  });

  test("its credentials are kept until five minutes before they expire, then it runs again", async () => {
    const under: ProfileChain = profileChain({
      env: ROLES_ANYWHERE_ENV,
      files: { [CONFIG_FILE]: ROLES_ANYWHERE_CONFIG },
      results: [
        exited(PROCESS_OUTPUT("2026-11-20T11:00:00Z")),
        exited(PROCESS_OUTPUT("2026-11-20T12:00:00Z")),
      ],
    });

    await under.chain.getCredentials();
    under.clock.advance(54 * 60 * 1000);
    await under.chain.getCredentials();

    expect(under.runs).toHaveLength(1);

    under.clock.advance(60 * 1000);

    expect((await under.chain.getCredentials()).expiresAt).toEqual(
      new Date("2026-11-20T12:00:00Z"),
    );
    expect(under.runs).toHaveLength(2);
  });

  test("callers asking at the same time share one run", async () => {
    const under: ProfileChain = profileChain({
      env: ROLES_ANYWHERE_ENV,
      files: { [CONFIG_FILE]: ROLES_ANYWHERE_CONFIG },
      results: [exited(PROCESS_OUTPUT("2026-11-20T11:00:00Z"))],
    });

    await Promise.all(
      [1, 2, 3, 4].map((): Promise<AwsChainCredentials> => {
        return under.chain.getCredentials();
      }),
    );

    expect(under.runs).toHaveLength(1);
  });

  test("credentials without an expiry are kept fifteen minutes, then it runs again", async () => {
    const under: ProfileChain = profileChain({
      env: ROLES_ANYWHERE_ENV,
      files: { [CONFIG_FILE]: ROLES_ANYWHERE_CONFIG },
      results: [exited(PROCESS_OUTPUT(undefined))],
    });

    expect((await under.chain.getCredentials()).expiresAt).toBeNull();

    under.clock.advance(AWS_CREDENTIALS_WITHOUT_EXPIRY_REUSE_MS - 1);
    await under.chain.getCredentials();
    expect(under.runs).toHaveLength(1);

    under.clock.advance(1);
    await under.chain.getCredentials();
    expect(under.runs).toHaveLength(2);
  });

  test("keys in the same profile win: the program is not run", async () => {
    const under: ProfileChain = profileChain({
      env: ROLES_ANYWHERE_ENV,
      files: {
        [CONFIG_FILE]: `${ROLES_ANYWHERE_CONFIG}aws_access_key_id = AKIAKEYSWINEXAMPLE01\naws_secret_access_key = profileSecretEXAMPLE\n`,
      },
    });

    expect((await under.chain.getCredentials()).accessKeyId).toBe(
      "AKIAKEYSWINEXAMPLE01",
    );
    expect(under.runs).toHaveLength(0);
  });

  test("runs from the credentials file too, which must be read-only as well", async () => {
    const under: ProfileChain = profileChain({
      env: { AWS_SHARED_CREDENTIALS_FILE: CREDENTIALS_FILE },
      files: {
        [CREDENTIALS_FILE]: `[default]\ncredential_process = ${HELPER} credential-process\n`,
      },
      results: [exited(PROCESS_OUTPUT("2026-11-20T11:00:00Z"))],
    });

    await under.chain.getCredentials();

    expect(under.writabilityChecks).toEqual([CREDENTIALS_FILE]);
    expect(under.runs[0]!.args).toEqual(["credential-process"]);
  });

  test("never from a file the server could change: anything that can write it could run a program as the server", async () => {
    const under: ProfileChain = profileChain({
      env: ROLES_ANYWHERE_ENV,
      files: { [CONFIG_FILE]: ROLES_ANYWHERE_CONFIG },
      writable: [CONFIG_FILE],
      results: [exited(PROCESS_OUTPUT("2026-11-20T11:00:00Z"))],
    });

    const error: AwsCredentialChainError = await failureOf(under);

    expect(error.message).toBe(
      `OneUptime runs a credential_process only from a file it cannot change, and it can change ${CONFIG_FILE}. Mount the file read-only: end its Docker Compose volume with :ro (a Kubernetes ConfigMap or Secret volume is read-only already).`,
    );
    expect(error.isRetryable).toBe(false);
    expect(under.runs).toHaveLength(0);
  });

  test("the file that holds it is the one checked, when the other file is writable", async () => {
    const under: ProfileChain = profileChain({
      env: {
        AWS_PROFILE: "oneuptime",
        AWS_CONFIG_FILE: CONFIG_FILE,
        AWS_SHARED_CREDENTIALS_FILE: CREDENTIALS_FILE,
      },
      files: {
        [CONFIG_FILE]: ROLES_ANYWHERE_CONFIG,
        [CREDENTIALS_FILE]: "[oneuptime]\nregion = us-east-1\n",
      },
      writable: [CREDENTIALS_FILE],
      results: [exited(PROCESS_OUTPUT("2026-11-20T11:00:00Z"))],
    });

    expect((await under.chain.getCredentials()).source).toBe("profile");
    expect(under.writabilityChecks).toEqual([CONFIG_FILE]);
  });

  test.each([
    [
      `[default]\ncredential_process = aws_signing_helper credential-process --pin super-secret-pin\n`,
      `The credential_process of the AWS profile default in ${CONFIG_FILE} names its program without its full path. Write the full path, such as /usr/local/bin/aws_signing_helper.`,
    ],
    [
      `[default]\ncredential_process = ${HELPER} credential-process --pin super-secret-pin | tee /tmp/creds\n`,
      `The credential_process of the AWS profile default in ${CONFIG_FILE} is not one program: it holds | outside quotes, which only a shell reads, and OneUptime runs the program with no shell. Name one program and its arguments, quote a | that is part of one in single quotes, or put what needs a shell in a script and name the script.`,
    ],
    [
      `[default]\ncredential_process = ${HELPER} --certificate $HOME/cert.pem\n`,
      `The credential_process of the AWS profile default in ${CONFIG_FILE} is not one program: it holds $ outside quotes, which only a shell reads, and OneUptime runs the program with no shell. Name one program and its arguments, quote a $ that is part of one in single quotes, or put what needs a shell in a script and name the script.`,
    ],
  ])(
    "a line that is not one program by its full path is never run: %#",
    async (file: string, message: string) => {
      const under: ProfileChain = profileChain({
        env: { AWS_CONFIG_FILE: CONFIG_FILE },
        files: { [CONFIG_FILE]: file },
      });

      const error: AwsCredentialChainError = await failureOf(under);

      expect(error.message).toBe(message);
      expect(error.isRetryable).toBe(false);
      expect(under.runs).toHaveLength(0);
      expectNothingSecretIn(error.message);
    },
  );

  const named: string = `The credential_process program ${HELPER} of the AWS profile oneuptime`;

  test.each([
    [
      { outcome: "not-started", reason: "ENOENT" },
      `${named} could not be started (ENOENT). Check that it is at that path in the server's container, and that OneUptime may run it.`,
      false,
    ],
    [
      { outcome: "timed-out" },
      `${named} did not finish within 30 seconds, so it was stopped. It is run again on the next try.`,
      true,
    ],
    [
      { outcome: "too-much-output" },
      `${named} printed more than 64 KB, so it was stopped: credentials are a few hundred bytes.`,
      false,
    ],
    [
      { outcome: "killed", signal: "SIGKILL" },
      `${named} was stopped by SIGKILL before it finished. It is run again on the next try.`,
      true,
    ],
    [
      exited(`partial ${PROCESS_SECRET}`, 1),
      `${named} exited with code 1. Run it in the server's container to see why: OneUptime never reads what it writes to stderr.`,
      false,
    ],
    [
      exited(`not json ${PROCESS_SECRET} ${PROCESS_TOKEN}`),
      `${named} did not print its credentials as a JSON object. It must print {"Version": 1, "AccessKeyId": ..., "SecretAccessKey": ..., "SessionToken": ..., "Expiration": ...}.`,
      false,
    ],
    [
      exited(`[${JSON.stringify(PROCESS_SECRET)}]`),
      `${named} did not print its credentials as a JSON object. It must print {"Version": 1, "AccessKeyId": ..., "SecretAccessKey": ..., "SessionToken": ..., "Expiration": ...}.`,
      false,
    ],
    [
      exited(
        JSON.stringify({
          Version: 2,
          AccessKeyId: "ASIA",
          SecretAccessKey: PROCESS_SECRET,
        }),
      ),
      `${named} printed Version 2, and OneUptime reads Version 1.`,
      false,
    ],
    [
      exited(
        JSON.stringify({
          Version: PROCESS_SECRET,
          SecretAccessKey: PROCESS_SECRET,
        }),
      ),
      `${named} printed no Version, and OneUptime reads Version 1.`,
      false,
    ],
    [
      exited(JSON.stringify({ Version: 1, SecretAccessKey: PROCESS_SECRET })),
      `${named} printed no AccessKeyId and SecretAccessKey OneUptime could use: both must be there, each on one line.`,
      false,
    ],
    [
      exited(
        JSON.stringify({
          Version: 1,
          AccessKeyId: "ASIAPROCESSEXAMPLE01",
          SecretAccessKey: `${PROCESS_SECRET}\r\nX-Injected: 1`,
        }),
      ),
      `${named} printed no AccessKeyId and SecretAccessKey OneUptime could use: both must be there, each on one line.`,
      false,
    ],
    [
      exited(
        JSON.stringify({
          Version: 1,
          AccessKeyId: "ASIAPROCESSEXAMPLE01",
          SecretAccessKey: PROCESS_SECRET,
          Expiration: `soon ${PROCESS_TOKEN}`,
        }),
      ),
      `${named} printed an Expiration that is not a date. Print it in ISO 8601, such as 2026-11-20T12:00:00Z.`,
      false,
    ],
    [
      exited(PROCESS_OUTPUT("2026-11-20T09:59:00Z")),
      `${named} printed credentials that expired at 2026-11-20T09:59:00.000Z. It is run again on the next try.`,
      true,
    ],
  ] as Array<[AwsChainProcessResult, string, boolean]>)(
    "how it went, in words that hold no secret: %#",
    async (
      result: AwsChainProcessResult,
      message: string,
      isRetryable: boolean,
    ) => {
      const error: AwsCredentialChainError = await failureOf(
        profileChain({
          env: ROLES_ANYWHERE_ENV,
          files: { [CONFIG_FILE]: ROLES_ANYWHERE_CONFIG },
          results: [result],
        }),
      );

      expect(error.message).toBe(message);
      expect(error.isRetryable).toBe(isRetryable);
      expect(error.source).toBe("profile");
      expectNothingSecretIn(error.message);
    },
  );

  test("a program that failed is not run again for ten seconds, however much email waits", async () => {
    const under: ProfileChain = profileChain({
      env: ROLES_ANYWHERE_ENV,
      files: { [CONFIG_FILE]: ROLES_ANYWHERE_CONFIG },
      results: [exited("", 1), exited(PROCESS_OUTPUT("2026-11-20T11:00:00Z"))],
    });

    const first: AwsCredentialChainError = await failureOf(under);

    expect(await failureOf(under)).toBe(first);
    expect(under.runs).toHaveLength(1);

    under.clock.advance(AWS_CREDENTIALS_FAILURE_MEMO_MS);

    expect((await under.chain.getCredentials()).source).toBe("profile");
    expect(under.runs).toHaveLength(2);
  });

  test("a program that timed out runs again on the next try", async () => {
    const under: ProfileChain = profileChain({
      env: ROLES_ANYWHERE_ENV,
      files: { [CONFIG_FILE]: ROLES_ANYWHERE_CONFIG },
      results: [
        { outcome: "timed-out" },
        exited(PROCESS_OUTPUT("2026-11-20T11:00:00Z")),
      ],
    });

    await failureOf(under);

    expect((await under.chain.getCredentials()).accessKeyId).toBe(
      "ASIAPROCESSEXAMPLE01",
    );
    expect(under.runs).toHaveLength(2);
  });

  test("invalidate runs it again: AWS refused the credentials in hand", async () => {
    const under: ProfileChain = profileChain({
      env: ROLES_ANYWHERE_ENV,
      files: { [CONFIG_FILE]: ROLES_ANYWHERE_CONFIG },
      results: [exited(PROCESS_OUTPUT("2026-11-20T11:00:00Z"))],
    });

    await under.chain.getCredentials();
    under.chain.invalidate();
    await under.chain.getCredentials();

    expect(under.runs).toHaveLength(2);
  });
});
