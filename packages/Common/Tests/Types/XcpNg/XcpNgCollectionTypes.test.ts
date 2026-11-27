import { describe, expect, test } from "@jest/globals";
import XcpNgCollectionErrorCode, {
  XcpNgCollectionErrorUtil,
} from "../../../Types/XcpNg/XcpNgCollectionError";
import XcpNgCollectionMethod, {
  XcpNgCollectionMethodUtil,
} from "../../../Types/XcpNg/XcpNgCollectionMethod";
import XcpNgCollectionStatus, {
  XcpNgCollectionStatusUtil,
} from "../../../Types/XcpNg/XcpNgCollectionStatus";
import XcpNgConnectionTestStatus, {
  SETTLED_XCP_NG_CONNECTION_TEST_STATUSES,
} from "../../../Types/XcpNg/XcpNgConnectionTestStatus";
import XcpNgConnectionType, {
  XcpNgConnectionTypeUtil,
} from "../../../Types/XcpNg/XcpNgConnectionType";
import XcpNgXapiAccountKind, {
  XAPI_READ_ONLY_ROLE_NAME,
  XcpNgXapiAccountKindUtil,
} from "../../../Types/XcpNg/XcpNgXapiAccount";

/*
 * The words a probe and the server use about an XCP-ng connection
 * (#10996, #10999). The stored ones are columns: their strings never
 * change. Every failure has a title and a next step a person can act on.
 */

describe("stored kinds", () => {
  test("keep their strings", () => {
    expect(XcpNgConnectionTypeUtil.getAll()).toEqual(["XenOrchestra", "Xapi"]);
    expect(XcpNgCollectionMethodUtil.getAll()).toEqual(["Agent", "Probe"]);
    expect(XcpNgCollectionStatusUtil.getAll()).toEqual([
      XcpNgCollectionStatus.Pending,
      XcpNgCollectionStatus.Succeeded,
      XcpNgCollectionStatus.Failed,
    ]);
    expect(SETTLED_XCP_NG_CONNECTION_TEST_STATUSES).toEqual([
      XcpNgConnectionTestStatus.Succeeded,
      XcpNgConnectionTestStatus.Failed,
    ]);
  });

  test("are told from anything else", () => {
    expect(XcpNgConnectionTypeUtil.isValid("Xapi")).toBe(true);
    expect(XcpNgConnectionTypeUtil.isValid("xapi")).toBe(false);
    expect(XcpNgConnectionTypeUtil.isValid(undefined)).toBe(false);
    expect(XcpNgCollectionMethodUtil.isValid(XcpNgCollectionMethod.Probe)).toBe(
      true,
    );
    expect(XcpNgCollectionMethodUtil.isValid("Collector")).toBe(false);
    expect(XcpNgCollectionStatusUtil.isValid("Failed")).toBe(true);
    expect(XcpNgCollectionStatusUtil.isValid(1)).toBe(false);
  });

  test("name each kind of connection as a person picks it", () => {
    expect(
      XcpNgConnectionTypeUtil.getLabel(XcpNgConnectionType.XenOrchestra),
    ).toBe("Xen Orchestra");
    expect(XcpNgConnectionTypeUtil.getLabel(XcpNgConnectionType.Xapi)).toBe(
      "XAPI",
    );
  });
});

describe("XcpNgCollectionErrorUtil", () => {
  test("has a title and a next step for every failure", () => {
    for (const code of XcpNgCollectionErrorUtil.getAll()) {
      const advice: { title: string; nextStep: string } =
        XcpNgCollectionErrorUtil.getAdvice(code);
      expect(advice.title.length).toBeGreaterThan(5);
      expect(advice.nextStep.length).toBeGreaterThan(10);
      // Words, never a code.
      expect(advice.title).toContain(" ");
      expect(XcpNgCollectionErrorUtil.getAll()).not.toContain(advice.title);
    }
  });

  test("falls back to the internal error's advice for an unknown code", () => {
    expect(
      XcpNgCollectionErrorUtil.getAdvice(
        "Nope" as unknown as XcpNgCollectionErrorCode,
      ),
    ).toEqual(
      XcpNgCollectionErrorUtil.getAdvice(XcpNgCollectionErrorCode.Internal),
    );
  });

  test("tells the failures that trusting the presented certificate fixes", () => {
    expect(
      XcpNgCollectionErrorUtil.getAll().filter(
        (code: XcpNgCollectionErrorCode) => {
          return XcpNgCollectionErrorUtil.isCertificateTrustProblem(code);
        },
      ),
    ).toEqual([
      XcpNgCollectionErrorCode.UntrustedCertificate,
      XcpNgCollectionErrorCode.CertificateChanged,
    ]);
    expect(XcpNgCollectionErrorUtil.isCertificateTrustProblem(null)).toBe(
      false,
    );
  });

  test("tells the failures of the API token alone, which leave the metrics flowing", () => {
    expect(
      XcpNgCollectionErrorUtil.getAll().filter(
        (code: XcpNgCollectionErrorCode) => {
          return XcpNgCollectionErrorUtil.isApiTokenProblem(code);
        },
      ),
    ).toEqual([
      XcpNgCollectionErrorCode.TokenRejected,
      XcpNgCollectionErrorCode.TokenExpired,
      XcpNgCollectionErrorCode.TokenNotReadOnly,
      XcpNgCollectionErrorCode.TokenCannotReadAlarms,
    ]);
  });

  test("says a token that cannot read everything needed what to give it: the built-in Read only role", () => {
    const advice: { title: string; nextStep: string } =
      XcpNgCollectionErrorUtil.getAdvice(
        XcpNgCollectionErrorCode.TokenCannotReadAlarms,
      );
    expect(advice.title).toContain("messages");
    expect(advice.nextStep).toContain("Read only");
  });
});

describe("XcpNgXapiAccountKindUtil.fromSession", () => {
  test("root is root, whatever roles are listed", () => {
    expect(
      XcpNgXapiAccountKindUtil.fromSession({
        isLocalSuperuser: true,
        roleNames: [XAPI_READ_ONLY_ROLE_NAME],
      }),
    ).toBe(XcpNgXapiAccountKind.Root);
  });

  test("an AD user is read-only only when every role it holds is read-only", () => {
    expect(
      XcpNgXapiAccountKindUtil.fromSession({
        isLocalSuperuser: false,
        roleNames: ["read-only"],
      }),
    ).toBe(XcpNgXapiAccountKind.ReadOnly);
    expect(
      XcpNgXapiAccountKindUtil.fromSession({
        isLocalSuperuser: false,
        roleNames: ["READ-ONLY"],
      }),
    ).toBe(XcpNgXapiAccountKind.ReadOnly);
    expect(
      XcpNgXapiAccountKindUtil.fromSession({
        isLocalSuperuser: false,
        roleNames: ["read-only", "vm-operator"],
      }),
    ).toBe(XcpNgXapiAccountKind.Elevated);
    // A user XAPI names no role for is never called read-only.
    expect(
      XcpNgXapiAccountKindUtil.fromSession({
        isLocalSuperuser: false,
        roleNames: [],
      }),
    ).toBe(XcpNgXapiAccountKind.Elevated);
  });

  test("only read-only reads only", () => {
    expect(
      XcpNgXapiAccountKindUtil.isReadOnly(XcpNgXapiAccountKind.ReadOnly),
    ).toBe(true);
    expect(XcpNgXapiAccountKindUtil.isReadOnly(XcpNgXapiAccountKind.Root)).toBe(
      false,
    );
    expect(
      XcpNgXapiAccountKindUtil.isReadOnly(XcpNgXapiAccountKind.Elevated),
    ).toBe(false);
  });
});
