import { JSONObject } from "../../../../Types/JSON";
import SeriesLabelDisplay, {
  DisplaySeriesLabel,
} from "../../../../Types/Monitor/SeriesContext/SeriesLabelDisplay";

/*
 * SeriesLabelDisplay decides what an on-call engineer reads at the top of
 * an alert. The behaviours worth pinning down are the ones that used to
 * be wrong or that are easy to break by accident:
 *
 *   - EMPTY VALUES ARE DROPPED, not rendered. A grouped series carries
 *     every group-by key even when the attribute was missing on the
 *     samples (MetricSeriesFingerprint preserves it as "" so the
 *     fingerprint stays stable), so without this the title reads
 *     "Pod: web-1 - Node: ".
 *
 *   - ORDER IS BY IDENTITY, not by key name. A title truncated to three
 *     labels has to keep the pod and drop the cluster, never the
 *     other way round.
 *
 *   - THE `resource.` PREFIX IS INVISIBLE to the reader. The same
 *     concept arrives prefixed (OTel resource attribute) or bare
 *     (datapoint label) depending on the receiver, and both must render
 *     as "Pod".
 */

describe("SeriesLabelDisplay", () => {
  describe("normalizeKey", () => {
    test("strips the ClickHouse resource. prefix", () => {
      expect(SeriesLabelDisplay.normalizeKey("resource.k8s.pod.name")).toBe(
        "k8s.pod.name",
      );
    });

    test("leaves a bare datapoint label alone", () => {
      expect(SeriesLabelDisplay.normalizeKey("mountpoint")).toBe("mountpoint");
    });

    test("strips only the leading prefix, not an interior occurrence", () => {
      expect(
        SeriesLabelDisplay.normalizeKey("resource.custom.resource.name"),
      ).toBe("custom.resource.name");
    });
  });

  describe("getFriendlyLabelName", () => {
    test.each([
      ["resource.k8s.pod.name", "Pod"],
      ["k8s.pod.name", "Pod"],
      ["resource.k8s.container.name", "Container"],
      ["resource.k8s.node.name", "Node"],
      ["resource.k8s.namespace.name", "Namespace"],
      ["resource.k8s.deployment.name", "Deployment"],
      ["resource.k8s.hpa.name", "HPA"],
      ["resource.container.name", "Container"],
      ["container.name", "Container"],
      ["mountpoint", "Mount"],
      ["device", "Device"],
      ["ceph_daemon", "Ceph Daemon"],
      ["pool_id", "Pool"],
      ["device.id", "Device"],
      ["service.name", "Service"],
      ["docker.swarm.service.name", "Swarm Service"],
      ["pve.type", "Object Type"],
    ])("%s renders as %s", (key: string, expected: string) => {
      expect(SeriesLabelDisplay.getFriendlyLabelName(key)).toBe(expected);
    });

    test("an unregistered key is prettified rather than dropped", () => {
      /*
       * Custom-code and synthetic monitors choose their own attribute
       * keys via oneuptime.captureMetric(), so the registry can never be
       * exhaustive. A user who groups by tenant_id must still get a
       * readable alert.
       */
      expect(SeriesLabelDisplay.getFriendlyLabelName("tenant_id")).toBe(
        "Tenant Id",
      );
      expect(
        SeriesLabelDisplay.getFriendlyLabelName("resource.my.custom.thing"),
      ).toBe("My Custom Thing");
    });

    test("a key that prettifies to nothing falls back to itself", () => {
      expect(SeriesLabelDisplay.getFriendlyLabelName("...")).toBe("...");
    });
  });

  describe("isKnownLabelKey", () => {
    test("recognises a registered key under either spelling", () => {
      expect(SeriesLabelDisplay.isKnownLabelKey("resource.k8s.pod.name")).toBe(
        true,
      );
      expect(SeriesLabelDisplay.isKnownLabelKey("k8s.pod.name")).toBe(true);
    });

    test("recognises a key whose registered name equals its prettified form", () => {
      /*
       * The reason this predicate exists at all. `device` prettifies to
       * "Device", which is also its registered name, so comparing the
       * returned string against the fallback cannot tell registration
       * from absence - and a catalog test that did so failed on every
       * Host and Ceph template.
       */
      expect(SeriesLabelDisplay.isKnownLabelKey("device")).toBe(true);
      expect(SeriesLabelDisplay.isKnownLabelKey("ceph_daemon")).toBe(true);
    });

    test("does not claim an unregistered key", () => {
      expect(SeriesLabelDisplay.isKnownLabelKey("tenant_id")).toBe(false);
    });
  });

  describe("getLabelPriority", () => {
    test("container outranks pod, which outranks namespace, node and cluster", () => {
      const container: number = SeriesLabelDisplay.getLabelPriority(
        "resource.k8s.container.name",
      );
      const pod: number = SeriesLabelDisplay.getLabelPriority(
        "resource.k8s.pod.name",
      );
      const namespace: number = SeriesLabelDisplay.getLabelPriority(
        "resource.k8s.namespace.name",
      );
      const node: number = SeriesLabelDisplay.getLabelPriority(
        "resource.k8s.node.name",
      );
      const cluster: number = SeriesLabelDisplay.getLabelPriority(
        "resource.k8s.cluster.name",
      );

      expect(container).toBeLessThan(pod);
      expect(pod).toBeLessThan(namespace);
      expect(namespace).toBeLessThan(node);
      expect(node).toBeLessThan(cluster);
    });

    test("prefixed and bare spellings of one key rank identically", () => {
      expect(SeriesLabelDisplay.getLabelPriority("resource.k8s.pod.name")).toBe(
        SeriesLabelDisplay.getLabelPriority("k8s.pod.name"),
      );
    });

    test("an unregistered key sorts after the object it qualifies", () => {
      expect(SeriesLabelDisplay.getLabelPriority("tenant_id")).toBeGreaterThan(
        SeriesLabelDisplay.getLabelPriority("resource.k8s.pod.name"),
      );
    });
  });

  describe("getDisplayLabels", () => {
    test("returns nothing for an absent or empty label map", () => {
      expect(SeriesLabelDisplay.getDisplayLabels(undefined)).toEqual([]);
      expect(SeriesLabelDisplay.getDisplayLabels({})).toEqual([]);
    });

    test("orders by identity, not by key name", () => {
      const labels: Array<DisplaySeriesLabel> =
        SeriesLabelDisplay.getDisplayLabels({
          "resource.k8s.node.name": "ip-10-0-3-14",
          "resource.k8s.namespace.name": "prod",
          "resource.k8s.pod.name": "checkout-7d9f-2xk",
          "resource.k8s.container.name": "app",
        });

      expect(
        labels.map((label: DisplaySeriesLabel) => {
          return label.name;
        }),
      ).toEqual(["Container", "Pod", "Namespace", "Node"]);
    });

    test("drops empty values so a missing attribute never renders blank", () => {
      /*
       * This is the exact shape MetricSeriesFingerprint produces when a
       * grouped attribute was absent from the samples: the key is kept,
       * the value is "".
       */
      const labels: Array<DisplaySeriesLabel> =
        SeriesLabelDisplay.getDisplayLabels({
          "resource.k8s.pod.name": "web-1",
          "resource.k8s.node.name": "",
        });

      expect(labels).toHaveLength(1);
      expect(labels[0]!.value).toBe("web-1");
    });

    test("drops null and undefined values", () => {
      const labels: Array<DisplaySeriesLabel> =
        SeriesLabelDisplay.getDisplayLabels({
          "resource.k8s.pod.name": "web-1",
          "resource.k8s.node.name": null,
          "resource.k8s.namespace.name": undefined,
        } as unknown as JSONObject);

      expect(labels).toHaveLength(1);
    });

    test("trims whitespace-only values away", () => {
      const labels: Array<DisplaySeriesLabel> =
        SeriesLabelDisplay.getDisplayLabels({
          "resource.k8s.pod.name": "   ",
        });

      expect(labels).toEqual([]);
    });

    test("collapses two spellings of the same identity", () => {
      /*
       * Ingest stamps several spellings of host identity on the same
       * row. Rendering "Host: prod-db-01 | Host: prod-db-01" would waste
       * the title's whole budget on one fact.
       */
      const labels: Array<DisplaySeriesLabel> =
        SeriesLabelDisplay.getDisplayLabels({
          "resource.host.name": "prod-db-01",
          "host.name": "prod-db-01",
          "resource.oneuptime.host.name": "prod-db-01",
        });

      expect(labels).toHaveLength(1);
      expect(labels[0]!.name).toBe("Host");
    });

    test("keeps two labels that share a name but differ in value", () => {
      const labels: Array<DisplaySeriesLabel> =
        SeriesLabelDisplay.getDisplayLabels({
          "resource.k8s.node.name": "node-a",
          node: "node-b",
        });

      expect(labels).toHaveLength(2);
    });

    test("flattens a multi-valued label", () => {
      const labels: Array<DisplaySeriesLabel> =
        SeriesLabelDisplay.getDisplayLabels({
          "resource.k8s.pod.name": ["web-1", "web-2"],
        });

      expect(labels[0]!.value).toBe("web-1, web-2");
    });

    test("refuses to dump an object into a label value", () => {
      const labels: Array<DisplaySeriesLabel> =
        SeriesLabelDisplay.getDisplayLabels({
          "resource.k8s.pod.name": { nested: "value" },
        });

      expect(labels).toEqual([]);
    });

    test("renders a numeric label value", () => {
      const labels: Array<DisplaySeriesLabel> =
        SeriesLabelDisplay.getDisplayLabels({ pool_id: 3 });

      expect(labels[0]!.value).toBe("3");
    });

    test("ordering is stable for equal-priority keys", () => {
      const first: Array<DisplaySeriesLabel> =
        SeriesLabelDisplay.getDisplayLabels({ zebra: "z", alpha: "a" });
      const second: Array<DisplaySeriesLabel> =
        SeriesLabelDisplay.getDisplayLabels({ alpha: "a", zebra: "z" });

      expect(
        first.map((label: DisplaySeriesLabel) => {
          return label.key;
        }),
      ).toEqual(
        second.map((label: DisplaySeriesLabel) => {
          return label.key;
        }),
      );
    });

    test("keeps the raw key alongside the friendly name", () => {
      /*
       * The UI shows the raw key underneath the friendly name so a user
       * can paste it into a Group By or a metric filter and look at the
       * same series themselves.
       */
      const labels: Array<DisplaySeriesLabel> =
        SeriesLabelDisplay.getDisplayLabels({
          "resource.k8s.pod.name": "web-1",
        });

      expect(labels[0]!.key).toBe("resource.k8s.pod.name");
    });
  });

  describe("buildInlineSummary", () => {
    test("renders the identity most-specific first", () => {
      expect(
        SeriesLabelDisplay.buildInlineSummary({
          "resource.k8s.namespace.name": "prod",
          "resource.k8s.pod.name": "checkout-7d9f-2xk",
        }),
      ).toBe("Pod: checkout-7d9f-2xk | Namespace: prod");
    });

    test("caps the number of labels so a title stays scannable", () => {
      const summary: string = SeriesLabelDisplay.buildInlineSummary({
        "resource.k8s.container.name": "app",
        "resource.k8s.pod.name": "checkout-7d9f-2xk",
        "resource.k8s.namespace.name": "prod",
        "resource.k8s.node.name": "ip-10-0-3-14",
        "resource.k8s.cluster.name": "prod-eu",
      });

      expect(summary.split(" | ")).toHaveLength(3);
      // The cap keeps the MOST identifying labels, not the first three keys.
      expect(summary).toContain("Container: app");
      expect(summary).not.toContain("prod-eu");
    });

    test("honours an explicit cap", () => {
      expect(
        SeriesLabelDisplay.buildInlineSummary(
          {
            "resource.k8s.pod.name": "web-1",
            "resource.k8s.namespace.name": "prod",
          },
          { maxLabels: 1 },
        ),
      ).toBe("Pod: web-1");
    });

    test("a cap of zero still renders one label rather than nothing", () => {
      expect(
        SeriesLabelDisplay.buildInlineSummary(
          { "resource.k8s.pod.name": "web-1" },
          { maxLabels: 0 },
        ),
      ).toBe("Pod: web-1");
    });

    test("is empty when there is no identity", () => {
      expect(SeriesLabelDisplay.buildInlineSummary(undefined)).toBe("");
      expect(SeriesLabelDisplay.buildInlineSummary({})).toBe("");
      expect(
        SeriesLabelDisplay.buildInlineSummary({
          "resource.k8s.pod.name": "",
        }),
      ).toBe("");
    });

    test("shortens a value too long for a title column", () => {
      /*
       * Kubernetes object names go up to 253 characters. Three of those
       * would overflow the 500-character title column and fail the alert
       * INSERT outright - no alert at all, which is far worse than a
       * shortened name.
       */
      const longName: string = `pod-${"x".repeat(200)}-abc123`;

      const summary: string = SeriesLabelDisplay.buildInlineSummary({
        "resource.k8s.pod.name": longName,
      });

      expect(summary.length).toBeLessThan(90);
      expect(summary).toContain("...");
    });

    test("keeps the END of a shortened value, where the distinguishing part lives", () => {
      /*
       * Generated names put the identifying suffix last. Head-truncating
       * `checkout-web-frontend-7d9f-2xk` to `checkout-web-fron...` tells
       * the reader nothing the monitor name did not already say.
       */
      const summary: string = SeriesLabelDisplay.buildInlineSummary(
        { "resource.k8s.pod.name": "checkout-web-frontend-7d9f-2xk" },
        { maxValueLength: 10 },
      );

      // 10 characters of value, the ellipsis included.
      expect(summary).toBe("Pod: ...d9f-2xk");
    });

    test("does not shorten a value that fits", () => {
      expect(
        SeriesLabelDisplay.buildInlineSummary({
          "resource.k8s.pod.name": "checkout-7d9f-2xk",
        }),
      ).toBe("Pod: checkout-7d9f-2xk");
    });

    test("the markdown block keeps the value in full", () => {
      /*
       * The description column is unbounded text, and the full value is
       * what an engineer pastes into kubectl - truncating it there would
       * make the block useless.
       */
      const longName: string = `pod-${"x".repeat(200)}-abc123`;

      expect(
        SeriesLabelDisplay.buildMarkdownBlock({
          "resource.k8s.pod.name": longName,
        }),
      ).toContain(longName);
    });
  });

  describe("buildTitleSuffix", () => {
    test("carries its own separator so callers can concatenate blindly", () => {
      expect(
        SeriesLabelDisplay.buildTitleSuffix({
          "resource.k8s.pod.name": "web-1",
        }),
      ).toBe(" - Pod: web-1");
    });

    test("is empty - not a dangling separator - with no identity", () => {
      expect(SeriesLabelDisplay.buildTitleSuffix({})).toBe("");
      expect(SeriesLabelDisplay.buildTitleSuffix(undefined)).toBe("");
    });

    test("appending to a title never leaves a trailing separator", () => {
      const title: string = `Pod CPU high${SeriesLabelDisplay.buildTitleSuffix(
        {},
      )}`;

      expect(title).toBe("Pod CPU high");
      expect(title.trimEnd()).toBe(title);
    });
  });

  describe("buildMarkdownBlock", () => {
    test("lists EVERY label, not just the ones that fit in a title", () => {
      const block: string = SeriesLabelDisplay.buildMarkdownBlock({
        "resource.k8s.container.name": "app",
        "resource.k8s.pod.name": "checkout-7d9f-2xk",
        "resource.k8s.namespace.name": "prod",
        "resource.k8s.node.name": "ip-10-0-3-14",
        "resource.k8s.cluster.name": "prod-eu",
      });

      expect(block).toContain("**Affected resource**");
      expect(block).toContain("- **Container:** `app`");
      expect(block).toContain("- **Pod:** `checkout-7d9f-2xk`");
      expect(block).toContain("- **Namespace:** `prod`");
      expect(block).toContain("- **Node:** `ip-10-0-3-14`");
      expect(block).toContain("- **Cluster:** `prod-eu`");
    });

    test("respects a custom heading", () => {
      expect(
        SeriesLabelDisplay.buildMarkdownBlock(
          { "resource.k8s.pod.name": "web-1" },
          { heading: "Where" },
        ),
      ).toContain("**Where**");
    });

    test("is empty with no identity", () => {
      expect(SeriesLabelDisplay.buildMarkdownBlock({})).toBe("");
      expect(SeriesLabelDisplay.buildMarkdownBlock(undefined)).toBe("");
    });
  });

  describe("findLabelValue", () => {
    test("finds a value under the bare key", () => {
      expect(
        SeriesLabelDisplay.findLabelValue({ "k8s.pod.name": "web-1" }, [
          "k8s.pod.name",
        ]),
      ).toBe("web-1");
    });

    test("finds the same value under the resource-prefixed key", () => {
      expect(
        SeriesLabelDisplay.findLabelValue(
          { "resource.k8s.pod.name": "web-1" },
          ["k8s.pod.name"],
        ),
      ).toBe("web-1");
    });

    test("tries each candidate key in order", () => {
      expect(
        SeriesLabelDisplay.findLabelValue({ mountpoint: "/var" }, [
          "diskPath",
          "mountpoint",
        ]),
      ).toBe("/var");
    });

    test("treats an empty value as not found and keeps looking", () => {
      expect(
        SeriesLabelDisplay.findLabelValue(
          { diskPath: "", mountpoint: "/var" },
          ["diskPath", "mountpoint"],
        ),
      ).toBe("/var");
    });

    test("returns an empty string when nothing matches", () => {
      expect(
        SeriesLabelDisplay.findLabelValue({ other: "x" }, ["k8s.pod.name"]),
      ).toBe("");
      expect(
        SeriesLabelDisplay.findLabelValue(undefined, ["k8s.pod.name"]),
      ).toBe("");
    });
  });
});
