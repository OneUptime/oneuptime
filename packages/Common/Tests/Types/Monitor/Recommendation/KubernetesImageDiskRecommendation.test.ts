import MonitorRecommendationCatalog, {
  KUBERNETES_IMAGE_DISK_TEMPLATE_ID,
} from "../../../../Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import {
  MonitorRecommendation,
  MonitorRecommendationContext,
  MonitorRecommendationResourceType,
} from "../../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import {
  KubernetesAlertTemplate,
  getAllKubernetesAlertTemplates,
  getKubernetesAlertTemplateById,
} from "../../../../Types/Monitor/KubernetesAlertTemplates";
import { OPENSHIFT_KUBERNETES_PROVIDER } from "../../../../Types/Kubernetes/KubernetesClusterProvider";
import { describe, expect, test } from "@jest/globals";

/*
 * Node Image Disk Almost Full among a cluster's recommendations (#10056):
 * only where some node keeps its container images on a disk of its own. On a
 * node that keeps them on its root filesystem, as most nodes do, the template
 * reads that root filesystem, which High Node Disk Usage already watches, so
 * a cluster of such nodes that accepted both would get two alerts for one
 * full disk. The template picker keeps it for every cluster.
 */

function idsFor(
  context?: MonitorRecommendationContext | undefined,
): Array<string> {
  return MonitorRecommendationCatalog.getRecommendations(
    MonitorRecommendationResourceType.Kubernetes,
    context,
  ).map((recommendation: MonitorRecommendation): string => {
    return recommendation.templateId;
  });
}

describe("Node Image Disk Almost Full among a cluster's recommendations", () => {
  test("is the image disk template", () => {
    expect(KUBERNETES_IMAGE_DISK_TEMPLATE_ID).toBe(
      "k8s-node-image-disk-almost-full",
    );
    expect(
      getKubernetesAlertTemplateById(KUBERNETES_IMAGE_DISK_TEMPLATE_ID)?.name,
    ).toBe("Node Image Disk Almost Full");
  });

  test("is offered to a cluster with a node that keeps its images on a disk of its own, after High Node Disk Usage", () => {
    const ids: Array<string> = idsFor({ kubernetesHasSeparateImageDisk: true });

    expect(ids).toContain(KUBERNETES_IMAGE_DISK_TEMPLATE_ID);
    expect(ids.indexOf(KUBERNETES_IMAGE_DISK_TEMPLATE_ID)).toBe(
      ids.indexOf("k8s-high-disk-usage") + 1,
    );
  });

  test.each([
    ["nothing known of the cluster", undefined],
    ["no node with an image disk", { kubernetesHasSeparateImageDisk: false }],
    ["a failed read", { kubernetesHasSeparateImageDisk: null }],
    ["a provider alone", { kubernetesProvider: "EKS" }],
  ])(
    "is not offered with %s",
    (_label: string, context: MonitorRecommendationContext | undefined) => {
      const ids: Array<string> = idsFor(context);

      expect(ids).not.toContain(KUBERNETES_IMAGE_DISK_TEMPLATE_ID);
      // High Node Disk Usage, which watches the root filesystem, still is.
      expect(ids).toContain("k8s-high-disk-usage");
    },
  );

  test("it is the only recommendation the fact changes", () => {
    const withDisk: Array<string> = idsFor({
      kubernetesHasSeparateImageDisk: true,
    });
    const without: Array<string> = idsFor({
      kubernetesHasSeparateImageDisk: false,
    });

    expect(
      withDisk.filter((id: string): boolean => {
        return id !== KUBERNETES_IMAGE_DISK_TEMPLATE_ID;
      }),
    ).toEqual(without);
    expect(withDisk.length).toBe(without.length + 1);
  });

  test("an OpenShift cluster with such a node is offered both its OpenShift alerts and the image disk's", () => {
    const ids: Array<string> = idsFor({
      kubernetesProvider: OPENSHIFT_KUBERNETES_PROVIDER,
      kubernetesHasSeparateImageDisk: true,
    });
    const openShiftOnly: Array<string> = idsFor({
      kubernetesProvider: OPENSHIFT_KUBERNETES_PROVIDER,
    });

    expect(ids).toContain(KUBERNETES_IMAGE_DISK_TEMPLATE_ID);
    expect(openShiftOnly).not.toContain(KUBERNETES_IMAGE_DISK_TEMPLATE_ID);
    expect(ids.length).toBe(openShiftOnly.length + 1);
    // The OpenShift ones still come last.
    expect(ids.slice(-3)).toEqual(openShiftOnly.slice(-3));
  });

  test("stays among everything a cluster can be offered, so its monitors still count as created", () => {
    expect(
      MonitorRecommendationCatalog.getAllPossibleRecommendations(
        MonitorRecommendationResourceType.Kubernetes,
      ).map((recommendation: MonitorRecommendation): string => {
        return recommendation.templateId;
      }),
    ).toContain(KUBERNETES_IMAGE_DISK_TEMPLATE_ID);
  });

  test("and in the template picker, for every cluster", () => {
    expect(
      getAllKubernetesAlertTemplates().map(
        (template: KubernetesAlertTemplate): string => {
          return template.id;
        },
      ),
    ).toContain(KUBERNETES_IMAGE_DISK_TEMPLATE_ID);
  });
});
