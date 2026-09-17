import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

const POD_DETAIL_SOURCE: string = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../FeatureSet/Dashboard/src/Pages/Kubernetes/View/PodDetail.tsx",
  ),
  "utf8",
);

describe("Pod detail Kubernetes image reference rendering", () => {
  test("uses the dedicated responsive image reference view", () => {
    expect(POD_DETAIL_SOURCE).toContain(
      'import KubernetesImageReferenceView from "../../../Components/Kubernetes/KubernetesImageReferenceView";',
    );
    expect(POD_DETAIL_SOURCE).toContain(
      "<KubernetesImageReferenceView key={idx} reference={img} />",
    );
  });

  test("renders every image declared by the pod", () => {
    expect(POD_DETAIL_SOURCE).toContain(
      "containerImages.map((img: string, idx: number)",
    );
  });

  test("does not regress to treating every colon as a tag separator", () => {
    expect(POD_DETAIL_SOURCE).not.toContain('img.split(":")');
    expect(POD_DETAIL_SOURCE).not.toContain("parsedReference.suffix");
  });
});
