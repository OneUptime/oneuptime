import { JSONObject } from "../../../../Types/JSON";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
import MonitorTemplateUtil from "../../../../Server/Utils/Monitor/MonitorTemplateUtil";

/*
 * The series-identity template variables.
 *
 * The load-bearing property is that they are ALWAYS DEFINED. VMUtil's
 * substitution leaves a placeholder it cannot resolve in the output
 * verbatim, so a shipped template written as
 *
 *   "Pod CPU high{{seriesResourceSuffix}}"
 *
 * would render with the braces still in it on any monitor without a
 * group-by. Defining them as "" instead is what makes a single template
 * safe for grouped and ungrouped monitors alike - which is the whole
 * reason these exist alongside the raw `{{resource.k8s.pod.name}}`
 * label variables.
 */

const EMPTY_DATA: DataToProcess = {} as unknown as DataToProcess;

function buildStorageMap(seriesLabels?: JSONObject | undefined): JSONObject {
  return MonitorTemplateUtil.buildTemplateStorageMap({
    monitorType: MonitorType.Kubernetes,
    dataToProcess: EMPTY_DATA,
    seriesLabels,
  });
}

describe("MonitorTemplateUtil - series context variables", () => {
  describe("always defined", () => {
    test.each([
      "seriesResourceSuffix",
      "seriesResourceSummary",
      "seriesResourceBlock",
      "seriesDebugCommands",
    ])("%s is defined when the monitor has no group-by", (key: string) => {
      const storageMap: JSONObject = buildStorageMap(undefined);

      expect(storageMap[key]).toBeDefined();
      expect(storageMap[key]).toBe("");
    });

    test.each([
      "seriesResourceSuffix",
      "seriesResourceSummary",
      "seriesResourceBlock",
      "seriesDebugCommands",
    ])("%s is defined for an empty label map", (key: string) => {
      expect(buildStorageMap({})[key]).toBe("");
    });

    test("an unresolved placeholder never leaks into a rendered title", () => {
      /*
       * This is the failure mode the "always defined" rule prevents, and
       * the assertion that would have caught it.
       */
      const rendered: string = MonitorTemplateUtil.processTemplateString({
        value: "[K8s] Pod CPU high{{seriesResourceSuffix}}",
        storageMap: buildStorageMap(undefined),
      });

      expect(rendered).toBe("[K8s] Pod CPU high");
      expect(rendered).not.toContain("{{");
    });
  });

  describe("resolved values", () => {
    const POD_LABELS: JSONObject = {
      "resource.k8s.namespace.name": "prod",
      "resource.k8s.pod.name": "checkout-7d9f-2xk",
      "resource.k8s.node.name": "ip-10-0-3-14",
    };

    test("the suffix renders the identity, separator included", () => {
      expect(buildStorageMap(POD_LABELS)["seriesResourceSuffix"]).toBe(
        " - Pod: checkout-7d9f-2xk | Namespace: prod | Node: ip-10-0-3-14",
      );
    });

    test("the summary is the same text without the leading separator", () => {
      expect(buildStorageMap(POD_LABELS)["seriesResourceSummary"]).toBe(
        "Pod: checkout-7d9f-2xk | Namespace: prod | Node: ip-10-0-3-14",
      );
    });

    test("the block lists every label as markdown", () => {
      const block: string = buildStorageMap(POD_LABELS)[
        "seriesResourceBlock"
      ] as string;

      expect(block).toContain("**Affected resource**");
      expect(block).toContain("- **Pod:** `checkout-7d9f-2xk`");
      expect(block).toContain("- **Node:** `ip-10-0-3-14`");
    });

    test("the commands are built for the monitor's own type", () => {
      const kubernetesCommands: string =
        MonitorTemplateUtil.buildTemplateStorageMap({
          monitorType: MonitorType.Kubernetes,
          dataToProcess: EMPTY_DATA,
          seriesLabels: POD_LABELS,
        })["seriesDebugCommands"] as string;

      const dockerCommands: string =
        MonitorTemplateUtil.buildTemplateStorageMap({
          monitorType: MonitorType.Docker,
          dataToProcess: EMPTY_DATA,
          seriesLabels: { "resource.container.name": "nginx" },
        })["seriesDebugCommands"] as string;

      expect(kubernetesCommands).toContain("kubectl describe pod");
      expect(dockerCommands).toContain("docker logs");
      expect(dockerCommands).not.toContain("kubectl");
    });

    test("a title template composed of static text and the suffix renders cleanly", () => {
      expect(
        MonitorTemplateUtil.processTemplateString({
          value:
            "[K8s] Pod CPU Saturating Container Limit{{seriesResourceSuffix}}",
          storageMap: buildStorageMap(POD_LABELS),
        }),
      ).toBe(
        "[K8s] Pod CPU Saturating Container Limit - Pod: checkout-7d9f-2xk | Namespace: prod | Node: ip-10-0-3-14",
      );
    });
  });

  describe("coexistence with the raw label variables", () => {
    test("the dotted label variables still resolve alongside the new ones", () => {
      /*
       * The raw variables are the escape hatch for a user who wants full
       * control of the wording. Adding the convenience variables must not
       * have displaced them.
       */
      const storageMap: JSONObject = buildStorageMap({
        "resource.k8s.pod.name": "checkout-7d9f-2xk",
      });

      expect(
        MonitorTemplateUtil.processTemplateString({
          value: "Pod {{resource.k8s.pod.name}} is throttled",
          storageMap,
        }),
      ).toBe("Pod checkout-7d9f-2xk is throttled");
    });

    test("the full label map is still exposed for iteration", () => {
      const storageMap: JSONObject = buildStorageMap({
        "resource.k8s.pod.name": "web-1",
      });

      expect(storageMap["seriesLabels"]).toEqual({
        "resource.k8s.pod.name": "web-1",
      });
    });

    test("a prototype-walking label key is still refused", () => {
      /*
       * Series label keys are attacker-adjacent (a monitor script picks
       * them outright via oneuptime.captureMetric). Folding them onto the
       * storage map must keep refusing __proto__ - and the new variables
       * must not have introduced a second path that folds them.
       */
      const storageMap: JSONObject = buildStorageMap({
        "__proto__.polluted": "yes",
      });

      expect(({} as JSONObject)["polluted"]).toBeUndefined();
      expect(storageMap["seriesResourceSuffix"]).toBeDefined();
    });
  });
});
