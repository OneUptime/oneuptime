import { describe, expect, it, jest, beforeEach } from "@jest/globals";

/*
 * Captcha verification, which is a gate rather than a feature: everything it
 * protects (signup, password reset, the public forms) is reachable by anyone on
 * the internet, so the only behaviour that matters is what it does when
 * something is wrong.
 *
 * Three ways it could fail open, none of them visible from the outside — the
 * page looks identical whether the check ran or not:
 *
 *   1. Enabled with no secret key. There is nothing to verify against, and
 *      "cannot verify" must mean "reject", not "allow".
 *   2. The provider is unreachable, times out, or answers with something other
 *      than success. An hCaptcha outage must not become an open door.
 *   3. A blank or whitespace-only token passed off as a solved challenge.
 *
 * `CaptchaEnabled` and `CaptchaSecretKey` are read from the environment at
 * module load, so each configuration below gets a freshly required copy of the
 * module. axios is mocked throughout: these assertions are about the decision,
 * and a test that reached hcaptcha.com would be neither hermetic nor honest.
 */

const SITEVERIFY_URL: string = "https://hcaptcha.com/siteverify";

interface CaptchaModule {
  default: {
    isCaptchaEnabled: () => boolean;
    verifyCaptcha: (options: {
      token: string | null | undefined;
      remoteIp?: string | null;
    }) => Promise<void>;
  };
}

interface PostCall {
  url: string;
  body: string;
}

interface LoadedCaptcha {
  captcha: CaptchaModule["default"];
  posts: Array<PostCall>;
  setResponse: (response: unknown) => void;
  setRejection: (error: Error | null) => void;
}

/*
 * Load Captcha against one environment configuration, with axios stubbed. The
 * real EnvironmentConfig is spread in first so only the two captcha values
 * differ from production — mocking the module wholesale would quietly blank
 * every other setting the import graph reads.
 */
function loadCaptcha(config: {
  captchaEnabled: boolean;
  captchaSecretKey: string;
}): LoadedCaptcha {
  const posts: Array<PostCall> = [];
  let response: unknown = { data: { success: true } };
  let rejection: Error | null = null;

  let loaded: CaptchaModule["default"] | null = null;

  jest.isolateModules((): void => {
    jest.doMock("../../../Server/EnvironmentConfig", (): unknown => {
      return {
        ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
          string,
          unknown
        >),
        CaptchaEnabled: config.captchaEnabled,
        CaptchaSecretKey: config.captchaSecretKey,
      };
    });

    jest.doMock("axios", (): unknown => {
      const post: unknown = (url: string, body: string): Promise<unknown> => {
        posts.push({ url, body });

        if (rejection) {
          return Promise.reject(rejection);
        }

        return Promise.resolve(response);
      };

      return {
        __esModule: true,
        default: {
          post,
          isAxiosError: (): boolean => {
            return false;
          },
        },
        post,
        isAxiosError: (): boolean => {
          return false;
        },
      };
    });

    /*
     * requireActual, not require: it loads Captcha itself unmocked while its
     * own imports - the two doMock calls above - still resolve through this
     * isolated registry, which is exactly the split these tests need.
     */
    loaded = (
      jest.requireActual("../../../Server/Utils/Captcha") as CaptchaModule
    ).default;
  });

  return {
    captcha: loaded!,
    posts,
    setResponse: (next: unknown): void => {
      response = next;
    },
    setRejection: (next: Error | null): void => {
      rejection = next;
    },
  };
}

beforeEach((): void => {
  jest.resetModules();
});

/*
 * Assert a rejection is a BadDataException carrying `message`.
 *
 * By constructor NAME, not identity. Each configuration above is loaded through
 * jest.isolateModules, which gives the module under test its own registry — so
 * the BadDataException it throws is a different class object from the one this
 * file would import, and `toThrow(BadDataException)` fails on two constructors
 * that print the same name. The name and the message are what the API surface
 * actually depends on.
 */
async function expectBadDataRejection(
  work: Promise<void>,
  message: string | RegExp,
): Promise<void> {
  let thrown: unknown = null;

  try {
    await work;
  } catch (err) {
    thrown = err;
  }

  expect(thrown).toBeInstanceOf(Error);
  expect((thrown as Error).constructor.name).toBe("BadDataException");

  if (message instanceof RegExp) {
    expect((thrown as Error).message).toMatch(message);
  } else {
    expect((thrown as Error).message).toBe(message);
  }
}

const GENERIC_ERROR_MESSAGE: string =
  "Captcha verification failed. Please try again.";

describe("CaptchaUtil.isCaptchaEnabled", () => {
  it("is on only when the feature flag and a secret key agree", () => {
    expect(
      loadCaptcha({
        captchaEnabled: true,
        captchaSecretKey: "a-secret",
      }).captcha.isCaptchaEnabled(),
    ).toBe(true);
  });

  it("is off when the flag is off", () => {
    expect(
      loadCaptcha({
        captchaEnabled: false,
        captchaSecretKey: "a-secret",
      }).captcha.isCaptchaEnabled(),
    ).toBe(false);
  });

  it("is off when the flag is on but no secret key is configured", () => {
    /*
     * A half-configured deployment must report itself as off, so the UI does
     * not render a widget whose answer can never be checked.
     */
    expect(
      loadCaptcha({
        captchaEnabled: true,
        captchaSecretKey: "",
      }).captcha.isCaptchaEnabled(),
    ).toBe(false);
  });
});

describe("CaptchaUtil.verifyCaptcha when captcha is switched off", () => {
  it("lets the request through without calling the provider", async () => {
    const loaded: LoadedCaptcha = loadCaptcha({
      captchaEnabled: false,
      captchaSecretKey: "a-secret",
    });

    await expect(
      loaded.captcha.verifyCaptcha({ token: null }),
    ).resolves.toBeUndefined();

    // No outbound call at all — an off switch must not cost a round trip.
    expect(loaded.posts).toHaveLength(0);
  });
});

describe("CaptchaUtil.verifyCaptcha when captcha is on", () => {
  it("resolves when the provider says the challenge was solved", async () => {
    const loaded: LoadedCaptcha = loadCaptcha({
      captchaEnabled: true,
      captchaSecretKey: "a-secret",
    });

    await expect(
      loaded.captcha.verifyCaptcha({ token: "solved-token" }),
    ).resolves.toBeUndefined();

    expect(loaded.posts).toHaveLength(1);
    expect(loaded.posts[0]!.url).toBe(SITEVERIFY_URL);
  });

  it("sends the secret and the token the visitor supplied", async () => {
    const loaded: LoadedCaptcha = loadCaptcha({
      captchaEnabled: true,
      captchaSecretKey: "a-secret",
    });

    await loaded.captcha.verifyCaptcha({ token: "solved-token" });

    const body: URLSearchParams = new URLSearchParams(loaded.posts[0]!.body);

    expect(body.get("secret")).toBe("a-secret");
    expect(body.get("response")).toBe("solved-token");
  });

  it("forwards the caller's IP when one is known", async () => {
    const loaded: LoadedCaptcha = loadCaptcha({
      captchaEnabled: true,
      captchaSecretKey: "a-secret",
    });

    await loaded.captcha.verifyCaptcha({
      token: "solved-token",
      remoteIp: "203.0.113.7",
    });

    expect(new URLSearchParams(loaded.posts[0]!.body).get("remoteip")).toBe(
      "203.0.113.7",
    );
  });

  it("omits remoteip rather than sending an empty one", async () => {
    /*
     * hCaptcha scores a blank remoteip differently from an absent one, so a
     * request with no known client IP must leave the field off entirely.
     */
    const loaded: LoadedCaptcha = loadCaptcha({
      captchaEnabled: true,
      captchaSecretKey: "a-secret",
    });

    await loaded.captcha.verifyCaptcha({ token: "solved-token", remoteIp: "" });

    expect(new URLSearchParams(loaded.posts[0]!.body).has("remoteip")).toBe(
      false,
    );
  });

  it("trims the token before sending it", async () => {
    const loaded: LoadedCaptcha = loadCaptcha({
      captchaEnabled: true,
      captchaSecretKey: "a-secret",
    });

    await loaded.captcha.verifyCaptcha({ token: "  solved-token  " });

    expect(new URLSearchParams(loaded.posts[0]!.body).get("response")).toBe(
      "solved-token",
    );
  });
});

describe("CaptchaUtil.verifyCaptcha fails closed", () => {
  it("rejects when enabled with no secret key, and never calls the provider", async () => {
    /*
     * The misconfiguration that would otherwise fail OPEN: no key means no
     * verification is possible, and "cannot verify" has to mean "reject".
     */
    const loaded: LoadedCaptcha = loadCaptcha({
      captchaEnabled: true,
      captchaSecretKey: "",
    });

    await expectBadDataRejection(
      loaded.captcha.verifyCaptcha({ token: "solved-token" }),
      GENERIC_ERROR_MESSAGE,
    );

    expect(loaded.posts).toHaveLength(0);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty", ""],
    ["whitespace only", "   "],
  ])(
    "rejects a %s token without calling the provider",
    async (_label: string, token: string | null | undefined) => {
      const loaded: LoadedCaptcha = loadCaptcha({
        captchaEnabled: true,
        captchaSecretKey: "a-secret",
      });

      await expectBadDataRejection(
        loaded.captcha.verifyCaptcha({ token }),
        /complete the verification challenge/i,
      );

      expect(loaded.posts).toHaveLength(0);
    },
  );

  it("names the missing challenge, since that one is the visitor's to fix", async () => {
    const loaded: LoadedCaptcha = loadCaptcha({
      captchaEnabled: true,
      captchaSecretKey: "a-secret",
    });

    await expectBadDataRejection(
      loaded.captcha.verifyCaptcha({ token: "" }),
      /complete the verification challenge/i,
    );
  });

  it("rejects when the provider answers success: false", async () => {
    const loaded: LoadedCaptcha = loadCaptcha({
      captchaEnabled: true,
      captchaSecretKey: "a-secret",
    });

    loaded.setResponse({
      data: { success: false, "error-codes": ["invalid-input-response"] },
    });

    await expectBadDataRejection(
      loaded.captcha.verifyCaptcha({ token: "forged-token" }),
      GENERIC_ERROR_MESSAGE,
    );
  });

  it("rejects when the provider answers with no success field at all", async () => {
    // A shape change at the provider must not read as a pass.
    const loaded: LoadedCaptcha = loadCaptcha({
      captchaEnabled: true,
      captchaSecretKey: "a-secret",
    });

    loaded.setResponse({ data: {} });

    await expectBadDataRejection(
      loaded.captcha.verifyCaptcha({ token: "some-token" }),
      GENERIC_ERROR_MESSAGE,
    );
  });

  it("rejects when the provider answers with no body", async () => {
    const loaded: LoadedCaptcha = loadCaptcha({
      captchaEnabled: true,
      captchaSecretKey: "a-secret",
    });

    loaded.setResponse({ data: null });

    await expectBadDataRejection(
      loaded.captcha.verifyCaptcha({ token: "some-token" }),
      GENERIC_ERROR_MESSAGE,
    );
  });

  it("rejects when the provider is unreachable", async () => {
    /*
     * An hCaptcha outage is the moment a fail-open bug would be exploited, and
     * the moment nobody is watching for one.
     */
    const loaded: LoadedCaptcha = loadCaptcha({
      captchaEnabled: true,
      captchaSecretKey: "a-secret",
    });

    loaded.setRejection(new Error("connect ETIMEDOUT"));

    await expectBadDataRejection(
      loaded.captcha.verifyCaptcha({ token: "some-token" }),
      GENERIC_ERROR_MESSAGE,
    );
  });

  it("does not leak the provider's error text to the visitor", async () => {
    /*
     * The message reaches an anonymous caller, so it says only that
     * verification failed — not which secret, provider or error code was
     * involved.
     */
    const loaded: LoadedCaptcha = loadCaptcha({
      captchaEnabled: true,
      captchaSecretKey: "a-secret",
    });

    loaded.setRejection(new Error("secret a-secret rejected by upstream"));

    await expectBadDataRejection(
      loaded.captcha.verifyCaptcha({ token: "some-token" }),
      GENERIC_ERROR_MESSAGE,
    );
  });
});
