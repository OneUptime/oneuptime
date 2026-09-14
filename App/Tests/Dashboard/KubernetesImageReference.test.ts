import {
  ParsedKubernetesImageReference,
  parseKubernetesImageReference,
} from "../../FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesImageReference";

type TestCase = {
  reference: string;
  expected: ParsedKubernetesImageReference;
};

const SHA256_DIGEST: string = `sha256:${"a".repeat(64)}`;
const SHA512_DIGEST: string = `sha512:${"b".repeat(128)}`;
const MAX_LENGTH_TAG: string = `v${"1".repeat(127)}`;

const TEST_CASES: Array<TestCase> = [
  {
    reference: "",
    expected: { name: "" },
  },
  {
    reference: "busybox",
    expected: { name: "busybox" },
  },
  {
    reference: "library/busybox",
    expected: { name: "library/busybox" },
  },
  {
    reference: "docker.io/library/busybox",
    expected: { name: "docker.io/library/busybox" },
  },
  {
    reference: "busybox:1.36",
    expected: { name: "busybox", tag: "1.36" },
  },
  {
    reference: "example/team/api:release-2026.09_1",
    expected: { name: "example/team/api", tag: "release-2026.09_1" },
  },
  {
    reference: "registry.example:10443/team/api",
    expected: { name: "registry.example:10443/team/api" },
  },
  {
    reference: "registry.example:10443/team/api:v2",
    expected: { name: "registry.example:10443/team/api", tag: "v2" },
  },
  {
    reference: "localhost:5000/team/api:v2",
    expected: { name: "localhost:5000/team/api", tag: "v2" },
  },
  {
    reference: "10.0.0.5:5000/team/api:v2",
    expected: { name: "10.0.0.5:5000/team/api", tag: "v2" },
  },
  {
    reference: "[2001:db8::1]/team/api",
    expected: { name: "[2001:db8::1]/team/api" },
  },
  {
    reference: "[2001:db8::1]:5000/team/api",
    expected: { name: "[2001:db8::1]:5000/team/api" },
  },
  {
    reference: "[2001:db8::1]:5000/team/api:v2",
    expected: { name: "[2001:db8::1]:5000/team/api", tag: "v2" },
  },
  {
    reference: `registry.k8s.io/pause@${SHA256_DIGEST}`,
    expected: {
      name: "registry.k8s.io/pause",
      digest: SHA256_DIGEST,
    },
  },
  {
    reference: `registry.k8s.io/pause:3.5@${SHA256_DIGEST}`,
    expected: {
      name: "registry.k8s.io/pause",
      tag: "3.5",
      digest: SHA256_DIGEST,
    },
  },
  {
    reference: `registry.example:10443/team/api:v2@${SHA256_DIGEST}`,
    expected: {
      name: "registry.example:10443/team/api",
      tag: "v2",
      digest: SHA256_DIGEST,
    },
  },
  {
    reference: `[2001:db8::1]:5000/team/api:v2@${SHA256_DIGEST}`,
    expected: {
      name: "[2001:db8::1]:5000/team/api",
      tag: "v2",
      digest: SHA256_DIGEST,
    },
  },
  {
    reference: `example/team/api:${MAX_LENGTH_TAG}`,
    expected: { name: "example/team/api", tag: MAX_LENGTH_TAG },
  },
  {
    reference: `example/team/api@${SHA512_DIGEST}`,
    expected: { name: "example/team/api", digest: SHA512_DIGEST },
  },
  {
    reference: "busybox:",
    expected: { name: "busybox:" },
  },
  {
    reference: "busybox@",
    expected: { name: "busybox@" },
  },
];

function rebuildReference(
  parsedReference: ParsedKubernetesImageReference,
): string {
  return `${parsedReference.name}${
    parsedReference.tag ? `:${parsedReference.tag}` : ""
  }${parsedReference.digest ? `@${parsedReference.digest}` : ""}`;
}

describe("parseKubernetesImageReference", () => {
  test.each<TestCase>(TEST_CASES)(
    "parses $reference",
    ({ reference, expected }: TestCase) => {
      expect(parseKubernetesImageReference(reference)).toEqual(expected);
    },
  );

  test.each<TestCase>(TEST_CASES)(
    "preserves every character in $reference",
    ({ reference }: TestCase) => {
      expect(rebuildReference(parseKubernetesImageReference(reference))).toBe(
        reference,
      );
    },
  );
});
