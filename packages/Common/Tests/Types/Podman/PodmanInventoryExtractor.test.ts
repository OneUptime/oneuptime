import { ParsedPodmanResource } from "../../../Server/Services/PodmanResourceService";
import {
  INVENTORIED_PODMAN_KINDS,
  INVENTORY_KIND_ATTRIBUTE,
  canonicalPodmanKind,
  extractPodmanInventoryResource,
  isInventoriedPodmanKind,
} from "../../../Types/Podman/PodmanInventoryExtractor";
import { describe, expect, it } from "@jest/globals";

const lastSeenAt: Date = new Date("2026-07-31T12:00:00.000Z");

type ExtractFunction = (
  kind: string,
  body: unknown,
) => ParsedPodmanResource | null;

const extract: ExtractFunction = (
  kind: string,
  body: unknown,
): ParsedPodmanResource | null => {
  const result: { resource: ParsedPodmanResource } | null =
    extractPodmanInventoryResource({
      kind,
      logBody: typeof body === "string" ? body : JSON.stringify(body),
      lastSeenAt,
    });
  return result ? result.resource : null;
};

describe("PodmanInventoryExtractor constants", () => {
  it("exposes the podman kind attribute key", () => {
    expect(INVENTORY_KIND_ATTRIBUTE).toBe("oneuptime.podman.kind");
  });

  it("models exactly the four podman resource kinds", () => {
    expect([...INVENTORIED_PODMAN_KINDS]).toEqual([
      "Container",
      "Image",
      "Network",
      "Volume",
    ]);
  });
});

describe("isInventoriedPodmanKind", () => {
  it("accepts canonical kinds case-insensitively", () => {
    expect(isInventoriedPodmanKind("Image")).toBe(true);
    expect(isInventoriedPodmanKind("network")).toBe(true);
    expect(isInventoriedPodmanKind("CONTAINER")).toBe(true);
  });

  it("rejects unmodeled kinds", () => {
    expect(isInventoriedPodmanKind("Pod")).toBe(false);
    expect(isInventoriedPodmanKind("")).toBe(false);
  });
});

describe("canonicalPodmanKind", () => {
  it("normalizes singular, plural and mixed case", () => {
    expect(canonicalPodmanKind("volumes")).toBe("Volume");
    expect(canonicalPodmanKind("  Container ")).toBe("Container");
    expect(canonicalPodmanKind("IMAGE")).toBe("Image");
  });

  it("returns null for empty and unknown kinds", () => {
    expect(canonicalPodmanKind("")).toBeNull();
    expect(canonicalPodmanKind("pod")).toBeNull();
  });
});

describe("extractPodmanInventoryResource - guard cases", () => {
  it("returns null for an unmodeled kind", () => {
    expect(extract("Pod", { Name: "x" })).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(extract("Container", "{bad")).toBeNull();
  });

  it("returns null for a JSON array body", () => {
    expect(extract("Volume", [1, 2])).toBeNull();
  });
});

describe("extractPodmanInventoryResource - resources", () => {
  it("parses a container envelope, stripping slash and lowercasing state", () => {
    const resource: ParsedPodmanResource | null = extract("Container", {
      kind: "Container",
      data: {
        Id: "aabbccddeeff00112233",
        Names: "/db,/db-1",
        Image: "postgres:16",
        State: "RUNNING",
        CreatedAt: "2026-07-30T09:00:00.000Z",
        Labels: { tier: "data" },
      },
    });

    expect(resource).not.toBeNull();
    expect(resource!.kind).toBe("Container");
    expect(resource!.name).toBe("db");
    expect(resource!.containerId).toBe("aabbccddeeff");
    expect(resource!.imageName).toBe("postgres:16");
    expect(resource!.state).toBe("running");
    expect(resource!.labels).toEqual({ tier: "data" });
    expect(resource!.lastSeenAt).toBe(lastSeenAt);
    expect(resource!.resourceCreationTimestamp!.getTime()).toBe(
      new Date("2026-07-30T09:00:00.000Z").getTime(),
    );
  });

  it("returns null for a container with no usable name", () => {
    expect(extract("Container", { Id: "x", Names: "  , " })).toBeNull();
  });

  it("builds an image name from repository and tag and strips sha256", () => {
    const resource: ParsedPodmanResource | null = extract("Image", {
      ID: "sha256:0011223344556677",
      Repository: "redis",
      Tag: "7",
    });
    expect(resource!.name).toBe("redis:7");
    expect(resource!.containerId).toBe("001122334455");
    expect(resource!.imageName).toBeNull();
  });

  it("skips a dangling image", () => {
    expect(
      extract("Image", { Repository: "<none>", Tag: "<none>" }),
    ).toBeNull();
  });

  it("encodes driver/scope for a network and truncates id", () => {
    const resource: ParsedPodmanResource | null = extract("Network", {
      Id: "netaaaabbbbcccc",
      Name: "podman",
      Driver: "bridge",
      Scope: "local",
    });
    expect(resource!.state).toBe("bridge/local");
    expect(resource!.containerId).toBe("netaaaabbbbc");
  });

  it("parses a volume with a null containerId", () => {
    const resource: ParsedPodmanResource | null = extract("Volume", {
      Name: "cache",
      Driver: "local",
    });
    expect(resource!.kind).toBe("Volume");
    expect(resource!.name).toBe("cache");
    expect(resource!.state).toBe("local");
    expect(resource!.containerId).toBeNull();
  });

  it("returns null for a volume without a name", () => {
    expect(extract("Volume", { Driver: "local" })).toBeNull();
  });
});
