import { describe, expect, test } from "@jest/globals";
import BadDataException from "Common/Types/Exception/BadDataException";
import VMwareCollectionErrorCode from "Common/Types/VMware/VMwareCollectionError";
import { VMwarePresentedCertificate } from "Common/Types/VMware/VMwareProbeCollection";
import {
  ClassifiedVMwareError,
  ErrorContext,
  VMwareCollectionError,
  classifyVMwareError,
} from "../../../Utils/VMware/VMwareCollectionErrors";
import {
  VSphereRequestTimeoutError,
  VSphereResponseTooLargeError,
} from "../../../Utils/VMware/VSphereHttp";
import {
  VSphereFault,
  VSphereNotVSphereError,
} from "../../../Utils/VMware/VSphereSoapClient";
import {
  VSphereCertificateError,
  VSphereConnectTimeoutError,
} from "../../../Utils/VMware/VSphereTls";
import { XmlParseError } from "../../../Utils/VMware/VSphereXml";
import vm from "vm";

/*
 * Every way a collection fails becomes one code the dashboard acts on and one
 * sentence a person reads - which host, which port, which user, never the
 * password - whatever realm the error came from.
 */

const CONTEXT: ErrorContext = {
  host: "vcsa.example.com",
  port: 443,
  username: "oneuptime@vsphere.local",
};

function classify(error: unknown): ClassifiedVMwareError {
  return classifyVMwareError(error, CONTEXT);
}

function systemError(code: string, message: string): Error {
  const error: Error & { code?: string } = new Error(message);
  error.code = code;
  return error;
}

describe("classifyVMwareError", () => {
  test("the collector's own decisions keep their code and sentence", () => {
    expect(
      classify(
        new VMwareCollectionError(
          VMwareCollectionErrorCode.PayloadTooLarge,
          "Too large.",
        ),
      ),
    ).toEqual({
      code: VMwareCollectionErrorCode.PayloadTooLarge,
      message: "Too large.",
    });
  });

  test("certificates: untrusted and changed, each with what vCenter presented", () => {
    const presented: VMwarePresentedCertificate = {
      fingerprint256: "AB:CD",
      subject: "CN=vcsa",
      issuer: "CN=vcsa",
      isSelfSigned: true,
    };

    expect(
      classify(
        new VSphereCertificateError({
          kind: "untrusted",
          presentedCertificate: presented,
          message: "Not trusted.",
        }),
      ),
    ).toEqual({
      code: VMwareCollectionErrorCode.UntrustedCertificate,
      message: "Not trusted.",
      presentedCertificate: presented,
    });

    expect(
      classify(
        new VSphereCertificateError({
          kind: "changed",
          presentedCertificate: presented,
          message: "Changed.",
        }),
      ).code,
    ).toBe(VMwareCollectionErrorCode.CertificateChanged);
  });

  test("vSphere's faults: a refused login, an ended session, a missing privilege, anything else", () => {
    expect(
      classify(
        new VSphereFault({
          faultType: "InvalidLogin",
          faultString: "Login failure",
        }),
      ),
    ).toEqual({
      code: VMwareCollectionErrorCode.InvalidLogin,
      message:
        "vCenter at vcsa.example.com:443 refused the login for oneuptime@vsphere.local: the user name or password is wrong, or the account is locked. Use the full user name with its domain, such as oneuptime@vsphere.local.",
    });

    expect(
      classify(
        new VSphereFault({ faultType: "NotAuthenticated", faultString: "" }),
      ),
    ).toEqual({
      code: VMwareCollectionErrorCode.InvalidLogin,
      message:
        "vCenter at vcsa.example.com:443 ended the session of oneuptime@vsphere.local and did not accept the login again.",
    });

    expect(
      classify(
        new VSphereFault({ faultType: "NoPermission", faultString: "denied" }),
      ).code,
    ).toBe(VMwareCollectionErrorCode.NoPermission);

    expect(
      classify(
        new VSphereFault({
          faultType: "InvalidProperty",
          faultString: "summary.bogus",
        }),
      ),
    ).toEqual({
      code: VMwareCollectionErrorCode.ApiError,
      message:
        "vCenter at vcsa.example.com:443 answered with an error: InvalidProperty: summary.bogus",
    });
  });

  test("an answer that is not vSphere, or not XML at all, is NotVSphere", () => {
    expect(classify(new VSphereNotVSphereError("A web page."))).toEqual({
      code: VMwareCollectionErrorCode.NotVSphere,
      message:
        "vcsa.example.com:443 is not a vSphere API: A web page. Enter the address of vCenter Server or a standalone ESXi host.",
    });
    expect(classify(new XmlParseError("Unclosed tag.")).code).toBe(
      VMwareCollectionErrorCode.NotVSphere,
    );
  });

  test("time: no TLS connection, no answer to a request", () => {
    expect(
      classify(new VSphereConnectTimeoutError("No TLS within 15 seconds.")),
    ).toEqual({
      code: VMwareCollectionErrorCode.ConnectionTimedOut,
      message:
        "The probe got no answer from vcsa.example.com:443: No TLS within 15 seconds. Allow the probe's machine to reach vCenter on TCP 443, or pick a probe in vCenter's network.",
    });

    expect(classify(new VSphereRequestTimeoutError("/sdk", 60_000))).toEqual({
      code: VMwareCollectionErrorCode.TimedOut,
      message:
        "vSphere did not answer /sdk within 60 seconds. vCenter at vcsa.example.com:443 may be overloaded; collect less often, or check its health.",
    });
  });

  test("an answer larger than the probe reads is an ApiError that says so", () => {
    expect(
      classify(new VSphereResponseTooLargeError(64 * 1024 * 1024)),
    ).toEqual({
      code: VMwareCollectionErrorCode.ApiError,
      message:
        "vCenter at vcsa.example.com:443 answered with more than the probe reads: vSphere's answer is larger than 64 MiB.",
    });
  });

  test.each([
    ["ENOTFOUND", VMwareCollectionErrorCode.AddressNotFound],
    ["EAI_AGAIN", VMwareCollectionErrorCode.AddressNotFound],
    ["ECONNREFUSED", VMwareCollectionErrorCode.ConnectionRefused],
    ["ETIMEDOUT", VMwareCollectionErrorCode.ConnectionTimedOut],
    ["EHOSTUNREACH", VMwareCollectionErrorCode.ConnectionFailed],
    ["ECONNRESET", VMwareCollectionErrorCode.ConnectionFailed],
    ["EPROTO", VMwareCollectionErrorCode.TlsFailed],
    ["ERR_SSL_WRONG_VERSION_NUMBER", VMwareCollectionErrorCode.TlsFailed],
    ["ERR_TLS_CERT_ALTNAME_INVALID", VMwareCollectionErrorCode.TlsFailed],
  ])(
    "the system error %s is %s",
    (code: string, expected: VMwareCollectionErrorCode) => {
      expect(classify(systemError(code, `${code} happened`)).code).toBe(
        expected,
      );
    },
  );

  test("the network sentences name the host, port and what to do", () => {
    expect(
      classify(systemError("ENOTFOUND", "getaddrinfo ENOTFOUND")).message,
    ).toBe(
      "The probe cannot find vcsa.example.com in DNS (ENOTFOUND). Check the spelling, or use vCenter's IP address.",
    );
    expect(
      classify(systemError("EHOSTUNREACH", "connect EHOSTUNREACH 10.0.0.9:443"))
        .message,
    ).toBe(
      "The probe could not connect to vcsa.example.com:443 (EHOSTUNREACH): connect EHOSTUNREACH 10.0.0.9:443",
    );
  });

  test("an error from another realm keeps its code", () => {
    // jest runs tests in a vm context: an Error made outside it is not instanceof Error here.
    const foreign: unknown = vm.runInNewContext(
      "(() => { const e = new Error('connect ECONNREFUSED 10.0.0.9:443'); e.code = 'ECONNREFUSED'; return e; })()",
    );

    expect(foreign instanceof Error).toBe(false);
    expect(classify(foreign).code).toBe(
      VMwareCollectionErrorCode.ConnectionRefused,
    );
  });

  test("the address guard's refusals: a name DNS cannot resolve, an address a probe never connects to", () => {
    expect(
      classify(
        new BadDataException(
          "vCenter address hostname could not be resolved via DNS.",
        ),
      ).code,
    ).toBe(VMwareCollectionErrorCode.AddressNotFound);

    expect(
      classify(
        new BadDataException(
          "vCenter address resolves to a private, loopback, or link-local address and is not allowed.",
        ),
      ),
    ).toEqual({
      code: VMwareCollectionErrorCode.AddressNotAllowed,
      message:
        "The probe does not connect to vcsa.example.com: it is, or resolves to, a loopback, link-local, cloud metadata or other reserved address. Enter the address vCenter answers on in your network.",
    });
  });

  test("a TLS failure without a code is still a TLS failure", () => {
    expect(
      classify(
        new Error(
          "Client network socket disconnected before secure TLS connection was established",
        ),
      ).code,
    ).toBe(VMwareCollectionErrorCode.TlsFailed);
  });

  test("anything else is Internal, with what happened", () => {
    expect(classify(new Error("Cannot read properties of undefined"))).toEqual({
      code: VMwareCollectionErrorCode.Internal,
      message:
        "The probe could not collect vcsa.example.com:443: Cannot read properties of undefined",
    });
    expect(classify("a string").message).toBe(
      "The probe could not collect vcsa.example.com:443: a string",
    );
    expect(classify(null).code).toBe(VMwareCollectionErrorCode.Internal);
  });
});
