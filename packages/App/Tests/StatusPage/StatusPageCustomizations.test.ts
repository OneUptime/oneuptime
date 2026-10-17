import {
  StatusPageCustomizationContext,
  canRenderStatusPageCustomHtml,
  canUseStatusPageCustomizations,
  executeStatusPageCustomJavaScript,
  getPermittedStatusPageCustomization,
} from "../../FeatureSet/StatusPage/src/Utils/StatusPageCustomizations";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  test,
} from "@jest/globals";

const ALLOWED_CONTEXT: StatusPageCustomizationContext = {
  allowStatusPageCustomizations: true,
  isPreview: false,
};

const HOSTILE_CUSTOMIZATIONS: ReadonlyArray<[string, string]> = [
  [
    "JavaScript that reads an authenticated API",
    'fetch("/api/project/get-list", { credentials: "include" })',
  ],
  [
    "header HTML with an error handler",
    '<img src="x" onerror="fetch(\'/api/project/get-list\')">',
  ],
  [
    "footer HTML with an SVG load handler",
    "<svg onload=\"fetch('/api/project/get-list')\"></svg>",
  ],
  ["CSS that obscures the trusted page", "body { display: none !important; }"],
];

type TestGlobal = typeof globalThis & {
  statusPagePrivilegedRequest?: (
    path: string,
    options: { credentials: string },
  ) => void;
};

const testGlobal: TestGlobal = globalThis as TestGlobal;

describe("Status Page customization policy", () => {
  test.each([
    { allowStatusPageCustomizations: true, isPreview: false, expected: true },
    { allowStatusPageCustomizations: true, isPreview: true, expected: false },
    { allowStatusPageCustomizations: false, isPreview: false, expected: false },
    { allowStatusPageCustomizations: false, isPreview: true, expected: false },
  ])(
    "server allow=$allowStatusPageCustomizations, preview=$isPreview => $expected",
    ({
      allowStatusPageCustomizations,
      isPreview,
      expected,
    }: {
      allowStatusPageCustomizations: boolean;
      isPreview: boolean;
      expected: boolean;
    }) => {
      expect(
        canUseStatusPageCustomizations({
          allowStatusPageCustomizations,
          isPreview,
        }),
      ).toBe(expected);
    },
  );

  test.each([undefined, null, 0, 1, "true", {}, []])(
    "fails closed for non-boolean server value %p",
    (allowStatusPageCustomizations: unknown) => {
      expect(
        canUseStatusPageCustomizations({
          allowStatusPageCustomizations,
          isPreview: false,
        }),
      ).toBe(false);
    },
  );

  test.each(HOSTILE_CUSTOMIZATIONS)(
    "drops %s on the shared-origin fallback route",
    (_description: string, customization: string) => {
      expect(
        getPermittedStatusPageCustomization(customization, {
          allowStatusPageCustomizations: true,
          isPreview: true,
        }),
      ).toBeNull();
    },
  );

  test.each(HOSTILE_CUSTOMIZATIONS)(
    "drops %s when the server does not explicitly allow it",
    (_description: string, customization: string) => {
      expect(
        getPermittedStatusPageCustomization(customization, {
          allowStatusPageCustomizations: false,
          isPreview: false,
        }),
      ).toBeNull();
    },
  );

  test.each(HOSTILE_CUSTOMIZATIONS)(
    "preserves %s only for a server-approved custom-domain page",
    (_description: string, customization: string) => {
      expect(
        getPermittedStatusPageCustomization(customization, ALLOWED_CONTEXT),
      ).toBe(customization);
    },
  );

  it("treats empty customizations as absent", () => {
    expect(getPermittedStatusPageCustomization("", ALLOWED_CONTEXT)).toBeNull();
    expect(
      getPermittedStatusPageCustomization(null, ALLOWED_CONTEXT),
    ).toBeNull();
    expect(
      getPermittedStatusPageCustomization(undefined, ALLOWED_CONTEXT),
    ).toBeNull();
  });
});

describe("Status Page custom JavaScript execution", () => {
  afterEach(() => {
    delete testGlobal.statusPagePrivilegedRequest;
  });

  const PRIVILEGED_REQUEST_PAYLOAD: string =
    'globalThis.statusPagePrivilegedRequest("/api/project/get-list", { credentials: "include" });';

  function recordPrivilegedRequests(): Array<{
    path: string;
    credentials: string;
  }> {
    const requests: Array<{ path: string; credentials: string }> = [];

    testGlobal.statusPagePrivilegedRequest = (
      path: string,
      options: { credentials: string },
    ): void => {
      requests.push({ path, credentials: options.credentials });
    };

    return requests;
  }

  it("does not execute on a fallback route even if the server says yes", () => {
    const requests: Array<{ path: string; credentials: string }> =
      recordPrivilegedRequests();

    executeStatusPageCustomJavaScript(PRIVILEGED_REQUEST_PAYLOAD, {
      allowStatusPageCustomizations: true,
      isPreview: true,
    });

    expect(requests).toEqual([]);
  });

  it("does not execute on a custom-domain route unless the server says yes", () => {
    const requests: Array<{ path: string; credentials: string }> =
      recordPrivilegedRequests();

    executeStatusPageCustomJavaScript(PRIVILEGED_REQUEST_PAYLOAD, {
      allowStatusPageCustomizations: undefined,
      isPreview: false,
    });

    expect(requests).toEqual([]);
  });

  it("retains custom JavaScript on an explicitly approved custom domain", () => {
    const requests: Array<{ path: string; credentials: string }> =
      recordPrivilegedRequests();

    executeStatusPageCustomJavaScript(
      PRIVILEGED_REQUEST_PAYLOAD,
      ALLOWED_CONTEXT,
    );

    expect(requests).toEqual([
      {
        path: "/api/project/get-list",
        credentials: "include",
      },
    ]);
  });
});

/*
 * A link to a subscription's manage or unsubscribe page, and a reset
 * password link, leave a credential with the tab (SensitiveUrlToken) for the
 * page that uses it. The page's own custom code - its JavaScript, and header
 * and footer HTML, which can run script - never runs beside one: the pages
 * that use a credential show none, and before custom code runs anywhere else
 * the tab lets go of it.
 */
describe("Status Page custom code never runs beside a link's credential", () => {
  const STORAGE_KEY: string = "oneuptime-sensitive-url-token";
  const CREDENTIAL: string = `22222222-2222-4222-8222-222222222222-${"ab".repeat(32)}`;

  interface CredentialWindow {
    sessionStorage: {
      getItem: (key: string) => string | null;
      setItem: (key: string, value: string) => void;
      removeItem: (key: string) => void;
    };
    __ONEUPTIME_SENSITIVE_URL_TOKEN__?: string | undefined;
  }

  type CredentialGlobal = typeof globalThis & {
    window?: CredentialWindow | undefined;
    seenByCustomCode?: unknown;
  };

  const credentialGlobal: CredentialGlobal = globalThis as CredentialGlobal;

  let stored: Map<string, string>;

  beforeEach(() => {
    // The tab as a manage link left it: the credential in session storage, and handed off in memory.
    stored = new Map<string, string>([[STORAGE_KEY, CREDENTIAL]]);

    credentialGlobal.window = {
      sessionStorage: {
        getItem: (key: string): string | null => {
          return stored.get(key) ?? null;
        },
        setItem: (key: string, value: string): void => {
          stored.set(key, value);
        },
        removeItem: (key: string): void => {
          stored.delete(key);
        },
      },
      __ONEUPTIME_SENSITIVE_URL_TOKEN__: CREDENTIAL,
    };
  });

  afterEach(() => {
    delete credentialGlobal.window;
    delete credentialGlobal.seenByCustomCode;
  });

  const READ_THE_CREDENTIAL: string =
    'globalThis.seenByCustomCode = [globalThis.window.sessionStorage.getItem("oneuptime-sensitive-url-token"), globalThis.window.__ONEUPTIME_SENSITIVE_URL_TOKEN__];';

  it("custom JavaScript finds no credential the tab kept", () => {
    executeStatusPageCustomJavaScript(READ_THE_CREDENTIAL, ALLOWED_CONTEXT);

    // It ran - and found nothing.
    expect(credentialGlobal.seenByCustomCode).toEqual([null, undefined]);
    expect(stored.has(STORAGE_KEY)).toBe(false);
  });

  it("where no custom JavaScript runs, the credential is left for the page that needs it", () => {
    for (const [javascript, context] of [
      [
        READ_THE_CREDENTIAL,
        { allowStatusPageCustomizations: true, isPreview: true },
      ],
      [
        READ_THE_CREDENTIAL,
        { allowStatusPageCustomizations: false, isPreview: false },
      ],
      ["", ALLOWED_CONTEXT],
      [null, ALLOWED_CONTEXT],
    ] as Array<[string | null, StatusPageCustomizationContext]>) {
      executeStatusPageCustomJavaScript(javascript, context);
    }

    expect(credentialGlobal.seenByCustomCode).toBeUndefined();
    expect(stored.get(STORAGE_KEY)).toBe(CREDENTIAL);
    expect(credentialGlobal.window?.__ONEUPTIME_SENSITIVE_URL_TOKEN__).toBe(
      CREDENTIAL,
    );
  });

  // Every page that works with a credential from a link, in each form of its address.
  const CREDENTIAL_PAGES: Array<string> = [
    `/update-subscription/${CREDENTIAL}`,
    "/update-subscription",
    `/status-page/11111111-1111-4111-8111-111111111111/update-subscription/${CREDENTIAL}`,
    "/status-page/11111111-1111-4111-8111-111111111111/update-subscription",
    `/unsubscribe/${CREDENTIAL}`,
    "/unsubscribe",
    "/reset-password/a-reset-token",
    "/reset-password",
  ];

  test.each(CREDENTIAL_PAGES)(
    "custom header and footer HTML are not shown on %s, whatever the server allows",
    (pathname: string) => {
      for (const context of [
        ALLOWED_CONTEXT,
        { allowStatusPageCustomizations: true, isPreview: true },
        { allowStatusPageCustomizations: false, isPreview: false },
      ]) {
        expect(canRenderStatusPageCustomHtml({ context, pathname })).toBe(
          false,
        );
      }
    },
  );

  test.each([
    "/",
    "/incidents",
    "/incidents/33333333-3333-4333-8333-333333333333",
    "/announcements",
    "/scheduled-events",
    "/subscribe/email",
    "/subscribe/sms",
    "/confirm-subscription/22222222-2222-4222-8222-222222222222",
  ])(
    "custom header and footer HTML are shown on %s where the server allows them",
    (pathname: string) => {
      expect(
        canRenderStatusPageCustomHtml({ context: ALLOWED_CONTEXT, pathname }),
      ).toBe(true);
      expect(
        canRenderStatusPageCustomHtml({
          context: { allowStatusPageCustomizations: true, isPreview: true },
          pathname,
        }),
      ).toBe(false);
      expect(
        canRenderStatusPageCustomHtml({
          context: { allowStatusPageCustomizations: false, isPreview: false },
          pathname,
        }),
      ).toBe(false);
    },
  );
});
