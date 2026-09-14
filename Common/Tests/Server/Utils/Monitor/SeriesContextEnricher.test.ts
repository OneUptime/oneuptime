import { JSONObject } from "../../../../Types/JSON";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import SeriesContextEnricher from "../../../../Server/Utils/Monitor/SeriesContextEnricher";

/*
 * The regression this enricher exists for:
 *
 * A grouped Kubernetes monitor raised 49 alerts on one test cluster, all
 * titled
 *
 *   "[K8s] Pod CPU Saturating Container Limit (>90%) - oneuptime-test -
 *    Pod CPU Saturating Container Limit"
 *
 * character for character. The pod that was actually throttled was known
 * - it was stored on the alert as seriesLabels - but the title comes
 * from the criteria template, which is one fixed string shared by every
 * series, so the alert list, the Slack message and the phone
 * notification all showed the same undifferentiated line.
 *
 * The tests below fix the two halves of that: identity reaches the
 * title, and it never fights a template the user wrote themselves.
 */

const POD_LABELS: JSONObject = {
  "resource.k8s.namespace.name": "prod",
  "resource.k8s.pod.name": "checkout-7d9f-2xk",
  "resource.k8s.node.name": "ip-10-0-3-14",
};

describe("SeriesContextEnricher", () => {
  describe("enrichTitle", () => {
    test("appends the series identity to a template-rendered title", () => {
      expect(
        SeriesContextEnricher.enrichTitle({
          title: "[K8s] Pod CPU Saturating Container Limit (>90%)",
          seriesLabels: POD_LABELS,
        }),
      ).toBe(
        "[K8s] Pod CPU Saturating Container Limit (>90%) - Pod: checkout-7d9f-2xk | Namespace: prod | Node: ip-10-0-3-14",
      );
    });

    test("two series of one monitor no longer share a title", () => {
      const title: string = "[K8s] Pod CPU Saturating Container Limit (>90%)";

      const first: string = SeriesContextEnricher.enrichTitle({
        title,
        seriesLabels: {
          "resource.k8s.namespace.name": "prod",
          "resource.k8s.pod.name": "checkout-7d9f-2xk",
        },
      });
      const second: string = SeriesContextEnricher.enrichTitle({
        title,
        seriesLabels: {
          "resource.k8s.namespace.name": "prod",
          "resource.k8s.pod.name": "search-5b2c-9qq",
        },
      });

      expect(first).not.toBe(second);
      expect(first).toContain("checkout-7d9f-2xk");
      expect(second).toContain("search-5b2c-9qq");
    });

    test("is a no-op for a monitor with no group-by", () => {
      const title: string = "[K8s] etcd No Leader";

      expect(
        SeriesContextEnricher.enrichTitle({ title, seriesLabels: {} }),
      ).toBe(title);
      expect(
        SeriesContextEnricher.enrichTitle({ title, seriesLabels: undefined }),
      ).toBe(title);
    });

    test("is a no-op when every label value is empty", () => {
      /*
       * A grouped series keeps its keys even when the attribute was
       * missing, so this is a real shape - and appending " - " to the
       * title for it would be worse than doing nothing.
       */
      const title: string = "Disk usage high";

      expect(
        SeriesContextEnricher.enrichTitle({
          title,
          seriesLabels: { mountpoint: "", device: "" },
        }),
      ).toBe(title);
    });

    test("leaves a title alone when the user's own template already named the series", () => {
      /*
       * The user wrote `{{resource.k8s.pod.name}}` into their criteria
       * title, which has already expanded by the time the enricher runs.
       * Appending would duplicate the pod name.
       */
      const title: string =
        "Pod checkout-7d9f-2xk in prod is throttled on ip-10-0-3-14";

      expect(
        SeriesContextEnricher.enrichTitle({ title, seriesLabels: POD_LABELS }),
      ).toBe(title);
    });

    test("adds only the labels the title is missing", () => {
      const enriched: string = SeriesContextEnricher.enrichTitle({
        title: "Pod checkout-7d9f-2xk is throttled",
        seriesLabels: POD_LABELS,
      });

      expect(enriched).toBe(
        "Pod checkout-7d9f-2xk is throttled - Namespace: prod | Node: ip-10-0-3-14",
      );
      // The pod name appears once, not twice.
      expect(enriched.split("checkout-7d9f-2xk")).toHaveLength(2);
    });

    test("running twice over its own output changes nothing", () => {
      const once: string = SeriesContextEnricher.enrichTitle({
        title: "Pod CPU high",
        seriesLabels: POD_LABELS,
      });
      const twice: string = SeriesContextEnricher.enrichTitle({
        title: once,
        seriesLabels: POD_LABELS,
      });

      expect(twice).toBe(once);
    });

    test("a threshold in the title does not swallow a short label value", () => {
      /*
       * Ceph pool ids and Proxmox vmids are one or two characters. Naive
       * substring matching answers "does 'Restarts > 3' mention 3?" with
       * yes, and the alert loses the only thing identifying which pool
       * broke.
       */
      expect(
        SeriesContextEnricher.enrichTitle({
          title: "[Ceph] Pool Near Full - restarts > 3",
          seriesLabels: { pool_id: "3" },
        }),
      ).toBe("[Ceph] Pool Near Full - restarts > 3 - Pool: 3");
    });

    test("a short label value is still idempotent on a second pass", () => {
      const once: string = SeriesContextEnricher.enrichTitle({
        title: "[Ceph] Pool Near Full",
        seriesLabels: { pool_id: "3" },
      });

      expect(
        SeriesContextEnricher.enrichTitle({
          title: once,
          seriesLabels: { pool_id: "3" },
        }),
      ).toBe(once);
    });

    test("a value embedded inside a longer word does not count as mentioned", () => {
      /*
       * A container called `webapp` must not be considered named just
       * because the title happens to contain the word "webapps".
       */
      expect(
        SeriesContextEnricher.enrichTitle({
          title: "All webapps are unhealthy",
          seriesLabels: { "resource.container.name": "webapp" },
        }),
      ).toBe("All webapps are unhealthy - Container: webapp");
    });

    test("a value on a token boundary does count as mentioned", () => {
      const title: string = "Container checkout-7d9f-2xk is unhealthy";

      expect(
        SeriesContextEnricher.enrichTitle({
          title,
          seriesLabels: { "resource.k8s.pod.name": "checkout-7d9f-2xk" },
        }),
      ).toBe(title);
    });

    test("never overflows the title column", () => {
      /*
       * `Alert.title` and `Incident.title` are LongText (500). An
       * overflow does not shorten the title - it fails the INSERT, and
       * the alert does not exist at all. A labelling improvement must
       * never turn into a dropped page.
       */
      const longValue: string = "x".repeat(250);

      const enriched: string = SeriesContextEnricher.enrichTitle({
        title: `[K8s] ${"y".repeat(300)}`,
        seriesLabels: {
          "resource.k8s.pod.name": longValue,
          "resource.k8s.namespace.name": longValue,
          "resource.k8s.node.name": longValue,
        },
      });

      expect(enriched.length).toBeLessThanOrEqual(500);
    });

    test("leaves an already-oversized title exactly as the user wrote it", () => {
      /*
       * Such a title was going to fail with or without this enricher.
       * Silently truncating what the user wrote is not this module's
       * call to make.
       */
      const title: string = "z".repeat(600);

      expect(
        SeriesContextEnricher.enrichTitle({
          title,
          seriesLabels: { "resource.k8s.pod.name": "web-1" },
        }),
      ).toBe(title);
    });

    test("handles an empty title without producing a leading separator", () => {
      expect(
        SeriesContextEnricher.enrichTitle({
          title: "",
          seriesLabels: { "resource.k8s.pod.name": "web-1" },
        }),
      ).toBe(" - Pod: web-1");
    });
  });

  describe("enrichDescription", () => {
    test("appends the full resource block and the first commands", () => {
      const enriched: string = SeriesContextEnricher.enrichDescription({
        description: "A pod's CPU usage has exceeded 90% of its limit.",
        seriesLabels: POD_LABELS,
        monitorType: MonitorType.Kubernetes,
      });

      expect(enriched).toContain(
        "A pod's CPU usage has exceeded 90% of its limit.",
      );
      expect(enriched).toContain("**Affected resource**");
      expect(enriched).toContain("- **Pod:** `checkout-7d9f-2xk`");
      expect(enriched).toContain("- **Namespace:** `prod`");
      expect(enriched).toContain("- **Node:** `ip-10-0-3-14`");
      expect(enriched).toContain("**Start here**");
      expect(enriched).toContain(
        "kubectl describe pod checkout-7d9f-2xk -n prod",
      );
    });

    test("lists EVERY label, not just the three that fit in a title", () => {
      const enriched: string = SeriesContextEnricher.enrichDescription({
        description: "Throttled.",
        seriesLabels: {
          ...POD_LABELS,
          "resource.k8s.container.name": "app",
          "resource.k8s.cluster.name": "prod-eu",
        },
        monitorType: MonitorType.Kubernetes,
      });

      expect(enriched).toContain("- **Container:** `app`");
      expect(enriched).toContain("- **Cluster:** `prod-eu`");
    });

    test("is a no-op for a monitor with no group-by", () => {
      const description: string = "etcd has no leader.";

      expect(
        SeriesContextEnricher.enrichDescription({
          description,
          seriesLabels: {},
          monitorType: MonitorType.Kubernetes,
        }),
      ).toBe(description);
      expect(
        SeriesContextEnricher.enrichDescription({
          description,
          seriesLabels: undefined,
          monitorType: MonitorType.Kubernetes,
        }),
      ).toBe(description);
    });

    test("skips the resource block when the description already names every label", () => {
      const description: string =
        "Pod checkout-7d9f-2xk in prod on ip-10-0-3-14 is throttled.";

      const enriched: string = SeriesContextEnricher.enrichDescription({
        description,
        seriesLabels: POD_LABELS,
        monitorType: MonitorType.Kubernetes,
      });

      expect(enriched).not.toContain("**Affected resource**");
      // The commands are still added - they are not a restatement.
      expect(enriched).toContain("**Start here**");
    });

    test("still adds commands for a monitor type that has them, and none for one that does not", () => {
      const withCommands: string = SeriesContextEnricher.enrichDescription({
        description: "High CPU.",
        seriesLabels: { "resource.container.name": "nginx" },
        monitorType: MonitorType.Docker,
      });
      const withoutCommands: string = SeriesContextEnricher.enrichDescription({
        description: "High latency.",
        seriesLabels: { "service.name": "checkout-api" },
        monitorType: MonitorType.Metrics,
      });

      expect(withCommands).toContain("docker logs --tail 200 nginx");
      expect(withoutCommands).not.toContain("**Start here**");
      // ...but the resource identity is still there.
      expect(withoutCommands).toContain("- **Service:** `checkout-api`");
    });

    test("running twice adds nothing the second time", () => {
      const once: string = SeriesContextEnricher.enrichDescription({
        description: "Throttled.",
        seriesLabels: POD_LABELS,
        monitorType: MonitorType.Kubernetes,
      });
      const twice: string = SeriesContextEnricher.enrichDescription({
        description: once,
        seriesLabels: POD_LABELS,
        monitorType: MonitorType.Kubernetes,
      });

      expect(twice).toBe(once);
    });

    test("an empty description becomes the blocks alone, with no leading blank lines", () => {
      const enriched: string = SeriesContextEnricher.enrichDescription({
        description: "",
        seriesLabels: { "resource.k8s.pod.name": "web-1" },
        monitorType: MonitorType.Kubernetes,
      });

      expect(enriched.startsWith("**Affected resource**")).toBe(true);
    });

    test("separates the original description from the appended blocks", () => {
      const enriched: string = SeriesContextEnricher.enrichDescription({
        description: "Throttled.",
        seriesLabels: { "resource.k8s.pod.name": "web-1" },
        monitorType: MonitorType.Kubernetes,
      });

      expect(enriched).toContain("Throttled.\n\n**Affected resource**");
    });
  });
});
