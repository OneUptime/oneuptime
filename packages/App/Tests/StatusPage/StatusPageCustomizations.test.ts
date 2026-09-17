import {
  StatusPageCustomizationContext,
  canUseStatusPageCustomizations,
  executeStatusPageCustomJavaScript,
  getPermittedStatusPageCustomization,
} from "../../FeatureSet/StatusPage/src/Utils/StatusPageCustomizations";
import { afterEach, describe, expect, it, test } from "@jest/globals";

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
