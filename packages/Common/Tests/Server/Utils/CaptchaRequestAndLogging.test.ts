import { beforeEach, describe, expect, it, jest } from "@jest/globals";

/*
 * Complements Captcha.test.ts (which covers the enable/disable and fail-closed
 * decisions). This suite pins down the details of the outbound siteverify
 * request - timeout, content type, form encoding - and what gets logged on
 * each failure path, including real axios errors such as timeouts.
 *
 * Captcha reads CaptchaEnabled / CaptchaSecretKey at module load, so each
 * configuration is loaded into an isolated registry. axios and the logger are
 * replaced with recording fakes; nothing here touches the network.
 */

interface CaptchaUtilLike {
  isCaptchaEnabled: () => boolean;
  verifyCaptcha: (options: {
    token: string | null | undefined;
    remoteIp?: string | null;
  }) => Promise<void>;
}

interface RequestConfig {
  headers?: { [key: string]: string };
  timeout?: number;
}

interface PostCall {
  url: string;
  body: string;
  config: RequestConfig;
}

interface FakeAxiosError extends Error {
  isAxiosError: boolean;
  code?: string;
}

interface Loaded {
  captcha: CaptchaUtilLike;
  posts: Array<PostCall>;
  errorLogs: Array<string>;
  warnLogs: Array<string>;
  respondWith: (response: unknown) => void;
  rejectWith: (error: unknown) => void;
}

const GENERIC_ERROR_MESSAGE: string =
  "Captcha verification failed. Please try again.";

const makeAxiosError: (message: string, code?: string) => FakeAxiosError = (
  message: string,
  code?: string,
): FakeAxiosError => {
  const error: FakeAxiosError = new Error(message) as FakeAxiosError;
  error.isAxiosError = true;
  if (code) {
    error.code = code;
  }
  return error;
};

const loadCaptcha: (config: {
  enabled: boolean;
  secret: string;
}) => Loaded = (config: { enabled: boolean; secret: string }): Loaded => {
  const posts: Array<PostCall> = [];
  const errorLogs: Array<string> = [];
  const warnLogs: Array<string> = [];
  let response: unknown = { data: { success: true } };
  let rejection: unknown = null;
  let captcha: CaptchaUtilLike | null = null;

  jest.isolateModules((): void => {
    jest.doMock("../../../Server/EnvironmentConfig", (): unknown => {
      return {
        ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
          string,
          unknown
        >),
        CaptchaEnabled: config.enabled,
        CaptchaSecretKey: config.secret,
      };
    });

    jest.doMock("../../../Server/Utils/Logger", (): unknown => {
      const logger: unknown = {
        error: (message: unknown): void => {
          errorLogs.push(String(message));
        },
        warn: (message: unknown): void => {
          warnLogs.push(String(message));
        },
        info: (): void => {},
        debug: (): void => {},
      };
      return { __esModule: true, default: logger };
    });

    jest.doMock("axios", (): unknown => {
      const post: unknown = (
        url: string,
        body: string,
        requestConfig: RequestConfig,
      ): Promise<unknown> => {
        posts.push({ url, body, config: requestConfig });

        if (rejection) {
          return Promise.reject(rejection);
        }

        return Promise.resolve(response);
      };

      const isAxiosError: unknown = (err: unknown): boolean => {
        return Boolean(
          err && (err as { isAxiosError?: boolean }).isAxiosError === true,
        );
      };

      return {
        __esModule: true,
        default: { post, isAxiosError },
        post,
        isAxiosError,
      };
    });

    captcha = (
      jest.requireActual("../../../Server/Utils/Captcha") as {
        default: CaptchaUtilLike;
      }
    ).default;
  });

  return {
    captcha: captcha as unknown as CaptchaUtilLike,
    posts,
    errorLogs,
    warnLogs,
    respondWith: (next: unknown): void => {
      response = next;
    },
    rejectWith: (next: unknown): void => {
      rejection = next;
    },
  };
};

const captureRejection: (work: Promise<void>) => Promise<Error> = async (
  work: Promise<void>,
): Promise<Error> => {
  try {
    await work;
  } catch (err) {
    expect(err).toBeInstanceOf(Error);
    // Class identity differs across isolated registries; compare by name.
    expect((err as Error).constructor.name).toBe("BadDataException");
    return err as Error;
  }

  throw new Error("Expected verifyCaptcha to reject, but it resolved");
};

describe("CaptchaUtil outbound request", () => {
  beforeEach((): void => {
    jest.resetModules();
  });

  it("posts form-encoded data to hCaptcha with a 5 second timeout", async () => {
    const loaded: Loaded = loadCaptcha({ enabled: true, secret: "s3cret" });

    await loaded.captcha.verifyCaptcha({ token: "tok" });

    expect(loaded.posts).toHaveLength(1);
    const call: PostCall = loaded.posts[0] as PostCall;
    expect(call.url).toBe("https://hcaptcha.com/siteverify");
    expect(call.config.timeout).toBe(5000);
    expect(call.config.headers).toEqual({
      "content-type": "application/x-www-form-urlencoded",
    });
    expect(typeof call.body).toBe("string");
  });

  it("form-encodes tokens and IPs containing reserved characters", async () => {
    const loaded: Loaded = loadCaptcha({ enabled: true, secret: "a&b=c" });
    const token: string = "P1_abc+/=&x y";

    await loaded.captcha.verifyCaptcha({
      token,
      remoteIp: "2001:db8::1",
    });

    const params: URLSearchParams = new URLSearchParams(
      (loaded.posts[0] as PostCall).body,
    );
    expect(params.get("secret")).toBe("a&b=c");
    expect(params.get("response")).toBe(token);
    expect(params.get("remoteip")).toBe("2001:db8::1");
    expect(Array.from(params.keys())).toEqual([
      "secret",
      "response",
      "remoteip",
    ]);
  });

  it("omits remoteip when it is null", async () => {
    const loaded: Loaded = loadCaptcha({ enabled: true, secret: "s" });

    await loaded.captcha.verifyCaptcha({ token: "tok", remoteIp: null });

    const params: URLSearchParams = new URLSearchParams(
      (loaded.posts[0] as PostCall).body,
    );
    expect(params.has("remoteip")).toBe(false);
  });

  it("makes exactly one request per verification (no retries)", async () => {
    const loaded: Loaded = loadCaptcha({ enabled: true, secret: "s" });
    loaded.rejectWith(
      makeAxiosError("timeout of 5000ms exceeded", "ECONNABORTED"),
    );

    await captureRejection(loaded.captcha.verifyCaptcha({ token: "tok" }));

    expect(loaded.posts).toHaveLength(1);
  });
});

describe("CaptchaUtil token validation", () => {
  beforeEach((): void => {
    jest.resetModules();
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty", ""],
    ["whitespace", " \t\n "],
  ])(
    "rejects a %s token with the 'missing' message without calling the provider",
    async (_label: string, token: string | null | undefined) => {
      const loaded: Loaded = loadCaptcha({ enabled: true, secret: "s" });

      const error: Error = await captureRejection(
        loaded.captcha.verifyCaptcha({ token }),
      );

      expect(error.message).toBe(
        "Captcha token is missing. Please complete the verification challenge.",
      );
      expect(loaded.posts).toHaveLength(0);
    },
  );

  it("ignores a missing token entirely when captcha is disabled", async () => {
    const loaded: Loaded = loadCaptcha({ enabled: false, secret: "" });

    await expect(
      loaded.captcha.verifyCaptcha({ token: null }),
    ).resolves.toBeUndefined();
    expect(loaded.posts).toHaveLength(0);
    expect(loaded.errorLogs).toHaveLength(0);
  });

  it("is disabled even with a secret when the flag is off, and skips verification", async () => {
    const loaded: Loaded = loadCaptcha({ enabled: false, secret: "s" });

    expect(loaded.captcha.isCaptchaEnabled()).toBe(false);
    await loaded.captcha.verifyCaptcha({ token: "anything" });
    expect(loaded.posts).toHaveLength(0);
  });
});

describe("CaptchaUtil failure handling and logging", () => {
  beforeEach((): void => {
    jest.resetModules();
  });

  it("logs a configuration error when enabled without a secret", async () => {
    const loaded: Loaded = loadCaptcha({ enabled: true, secret: "" });

    const error: Error = await captureRejection(
      loaded.captcha.verifyCaptcha({ token: "tok" }),
    );

    expect(error.message).toBe(GENERIC_ERROR_MESSAGE);
    expect(loaded.errorLogs).toEqual([
      "Captcha is enabled but CAPTCHA_SECRET_KEY is not configured.",
    ]);
  });

  it("checks the secret before the token, so a blank token still reports misconfiguration", async () => {
    const loaded: Loaded = loadCaptcha({ enabled: true, secret: "" });

    const error: Error = await captureRejection(
      loaded.captcha.verifyCaptcha({ token: "" }),
    );

    expect(error.message).toBe(GENERIC_ERROR_MESSAGE);
    expect(loaded.errorLogs).toHaveLength(1);
  });

  it("fails closed on an axios timeout and logs the axios message", async () => {
    const loaded: Loaded = loadCaptcha({ enabled: true, secret: "s" });
    loaded.rejectWith(
      makeAxiosError("timeout of 5000ms exceeded", "ECONNABORTED"),
    );

    const error: Error = await captureRejection(
      loaded.captcha.verifyCaptcha({ token: "tok" }),
    );

    expect(error.message).toBe(GENERIC_ERROR_MESSAGE);
    expect(loaded.errorLogs).toEqual([
      "Captcha provider verification failure: timeout of 5000ms exceeded",
    ]);
  });

  it("fails closed on an HTTP error status from the provider", async () => {
    const loaded: Loaded = loadCaptcha({ enabled: true, secret: "s" });
    loaded.rejectWith(makeAxiosError("Request failed with status code 500"));

    const error: Error = await captureRejection(
      loaded.captcha.verifyCaptcha({ token: "tok" }),
    );

    expect(error.message).toBe(GENERIC_ERROR_MESSAGE);
    expect(loaded.errorLogs[0]).toContain("status code 500");
  });

  it("fails closed on a non-axios error and logs its message", async () => {
    const loaded: Loaded = loadCaptcha({ enabled: true, secret: "s" });
    loaded.rejectWith(new TypeError("unexpected"));

    const error: Error = await captureRejection(
      loaded.captcha.verifyCaptcha({ token: "tok" }),
    );

    expect(error.message).toBe(GENERIC_ERROR_MESSAGE);
    expect(loaded.errorLogs).toEqual([
      "Captcha provider verification failure: unexpected",
    ]);
  });

  it("warns with the provider payload when success is false, then logs the failure", async () => {
    const loaded: Loaded = loadCaptcha({ enabled: true, secret: "s" });
    loaded.respondWith({
      data: { success: false, "error-codes": ["invalid-input-response"] },
    });

    const error: Error = await captureRejection(
      loaded.captcha.verifyCaptcha({ token: "tok" }),
    );

    expect(error.message).toBe(GENERIC_ERROR_MESSAGE);
    expect(loaded.warnLogs).toEqual([
      'hCaptcha verification failed: {"success":false,"error-codes":["invalid-input-response"]}',
    ]);
    expect(loaded.errorLogs).toEqual([
      `Captcha provider verification failure: ${GENERIC_ERROR_MESSAGE}`,
    ]);
  });

  it("warns with an empty payload when the provider returns no body", async () => {
    const loaded: Loaded = loadCaptcha({ enabled: true, secret: "s" });
    loaded.respondWith({ data: null });

    await captureRejection(loaded.captcha.verifyCaptcha({ token: "tok" }));

    expect(loaded.warnLogs).toEqual(["hCaptcha verification failed: {}"]);
  });

  it("never logs the secret key", async () => {
    const secret: string = "very-private-secret";
    const loaded: Loaded = loadCaptcha({ enabled: true, secret });
    loaded.respondWith({ data: { success: false } });

    await captureRejection(loaded.captcha.verifyCaptcha({ token: "tok" }));

    for (const line of [...loaded.errorLogs, ...loaded.warnLogs]) {
      expect(line).not.toContain(secret);
    }
  });

  it("does not log anything on success", async () => {
    const loaded: Loaded = loadCaptcha({ enabled: true, secret: "s" });
    loaded.respondWith({ data: { success: true, hostname: "example.com" } });

    await expect(
      loaded.captcha.verifyCaptcha({ token: "tok" }),
    ).resolves.toBeUndefined();
    expect(loaded.errorLogs).toHaveLength(0);
    expect(loaded.warnLogs).toHaveLength(0);
  });
});
