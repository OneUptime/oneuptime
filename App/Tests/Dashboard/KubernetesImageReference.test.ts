import {
  ParsedKubernetesImageReference,
  parseKubernetesImageReference,
} from "../../FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesImageReference";

type TestCase = {
  reference: string;
  expected: ParsedKubernetesImageReference;
};

describe("parseKubernetesImageReference", () => {
  test.each<TestCase>([
    {
      reference: "busybox",
      expected: { name: "busybox" },
    },
    {
      reference: "example/team/api",
      expected: { name: "example/team/api" },
    },
    {
      reference: "busybox:1.36",
      expected: { name: "busybox", suffix: "1.36" },
    },
    {
      reference: "registry.example:10443/team/api",
      expected: { name: "registry.example:10443/team/api" },
    },
    {
      reference: "registry.example:10443/team/api:v2",
      expected: { name: "registry.example:10443/team/api", suffix: "v2" },
    },
    {
      reference: "registry.k8s.io/pause@sha256:1ff6c18f",
      expected: {
        name: "registry.k8s.io/pause",
        suffix: "@sha256:1ff6c18f",
      },
    },
    {
      reference: "registry.k8s.io/pause:3.5@sha256:1ff6c18f",
      expected: {
        name: "registry.k8s.io/pause:3.5",
        suffix: "@sha256:1ff6c18f",
      },
    },
    {
      reference: "[2001:db8::1]:5000/team/api",
      expected: { name: "[2001:db8::1]:5000/team/api" },
    },
    {
      reference: "[2001:db8::1]:5000/team/api:v2",
      expected: {
        name: "[2001:db8::1]:5000/team/api",
        suffix: "v2",
      },
    },
  ])("parses $reference", ({ reference, expected }: TestCase) => {
    expect(parseKubernetesImageReference(reference)).toEqual(expected);
  });
});
