import {
  KubernetesVersion,
  NEWEST_POD_SECURITY_STANDARD,
  compareKubernetesVersions,
  formatKubernetesVersion,
  getNewestKubernetesVersion,
  getPodSecurityStandardVersion,
  isAtLeastMinor,
  parseKubernetesVersion,
} from "../../../../Types/Kubernetes/Compliance/KubernetesVersion";
import { describe, expect, test } from "@jest/globals";

/*
 * The cluster's Kubernetes version, as the compliance scoring reads it from
 * its nodes' kubelets (#9627): the Pod Security Standards it is scored
 * against are the ones of its version.
 */

describe("parseKubernetesVersion", () => {
  test("reads the kubelet versions managed and self-run clusters report", () => {
    expect(parseKubernetesVersion("v1.31.4-eks-1a2b3c4")).toEqual({
      major: 1,
      minor: 31,
    });
    expect(parseKubernetesVersion("v1.30.2+k3s1")).toEqual({
      major: 1,
      minor: 30,
    });
    expect(parseKubernetesVersion("v1.32.1-gke.1357001")).toEqual({
      major: 1,
      minor: 32,
    });
    expect(parseKubernetesVersion("1.29")).toEqual({ major: 1, minor: 29 });
    expect(parseKubernetesVersion(" v1.33.0 ")).toEqual({
      major: 1,
      minor: 33,
    });
  });

  test("is null for what is not a version", () => {
    for (const text of ["", null, undefined, "latest", "v1", "x1.2.3", "1.x"]) {
      expect(parseKubernetesVersion(text)).toBeNull();
    }
  });
});

describe("comparing versions", () => {
  test("orders by major then minor", () => {
    const v128: KubernetesVersion = { major: 1, minor: 28 };
    const v131: KubernetesVersion = { major: 1, minor: 31 };

    expect(compareKubernetesVersions(v128, v131)).toBeLessThan(0);
    expect(compareKubernetesVersions(v131, v128)).toBeGreaterThan(0);
    expect(compareKubernetesVersions(v131, { major: 1, minor: 31 })).toBe(0);
    expect(isAtLeastMinor(v131, 31)).toBe(true);
    expect(isAtLeastMinor(v131, 32)).toBe(false);
    expect(isAtLeastMinor({ major: 2, minor: 0 }, 99)).toBe(true);
    expect(formatKubernetesVersion(v131)).toBe("1.31");
  });

  test("the newest of a cluster's kubelets is its version", () => {
    expect(
      getNewestKubernetesVersion([
        "v1.30.9-eks-a",
        "v1.31.4-eks-b",
        "",
        null,
        "v1.31.1-eks-c",
      ]),
    ).toEqual({ major: 1, minor: 31 });
    expect(getNewestKubernetesVersion([])).toBeNull();
    expect(getNewestKubernetesVersion(["unknown"])).toBeNull();
  });
});

describe("getPodSecurityStandardVersion", () => {
  test("scores a cluster against its own version's standard", () => {
    expect(getPodSecurityStandardVersion({ major: 1, minor: 31 })).toEqual({
      major: 1,
      minor: 31,
    });
  });

  test("scores a newer cluster, or one whose version is not known, against the newest standard known", () => {
    expect(getPodSecurityStandardVersion({ major: 1, minor: 40 })).toEqual(
      NEWEST_POD_SECURITY_STANDARD,
    );
    expect(getPodSecurityStandardVersion(null)).toEqual(
      NEWEST_POD_SECURITY_STANDARD,
    );
    expect(NEWEST_POD_SECURITY_STANDARD).toEqual({ major: 1, minor: 37 });
  });
});
