import { ParsedDockerResource } from "../../../Server/Services/DockerResourceService";
import {
  INVENTORIED_DOCKER_KINDS,
  INVENTORY_KIND_ATTRIBUTE,
  canonicalDockerKind,
  extractDockerInventoryResource,
  isInventoriedDockerKind,
} from "../../../Types/Docker/DockerInventoryExtractor";
import { describe, expect, it } from "@jest/globals";

const lastSeenAt: Date = new Date("2026-07-31T12:00:00.000Z");

type ExtractFunction = (
  kind: string,
  body: unknown,
) => ParsedDockerResource | null;

// Convenience: JSON-encode the body the way an inventory log line arrives.
const extract: ExtractFunction = (
  kind: string,
  body: unknown,
): ParsedDockerResource | null => {
  const result: { resource: ParsedDockerResource } | null =
    extractDockerInventoryResource({
      kind,
      logBody: typeof body === "string" ? body : JSON.stringify(body),
      lastSeenAt,
    });
  return result ? result.resource : null;
};

describe("DockerInventoryExtractor constants", () => {
  it("exposes the kind attribute key the agent stamps", () => {
    expect(INVENTORY_KIND_ATTRIBUTE).toBe("oneuptime.docker.kind");
  });

  it("models exactly the four docker resource kinds", () => {
    expect([...INVENTORIED_DOCKER_KINDS]).toEqual([
      "Container",
      "Image",
      "Network",
      "Volume",
    ]);
  });
});

describe("isInventoriedDockerKind", () => {
  it("accepts canonical kinds case-insensitively", () => {
    expect(isInventoriedDockerKind("Container")).toBe(true);
    expect(isInventoriedDockerKind("container")).toBe(true);
    expect(isInventoriedDockerKind("VOLUME")).toBe(true);
  });

  it("rejects kinds that are not modeled", () => {
    expect(isInventoriedDockerKind("Secret")).toBe(false);
    expect(isInventoriedDockerKind("")).toBe(false);
  });
});

describe("canonicalDockerKind", () => {
  it("maps singular, plural and mixed case to canonical PascalCase", () => {
    expect(canonicalDockerKind("container")).toBe("Container");
    expect(canonicalDockerKind("Containers")).toBe("Container");
    expect(canonicalDockerKind("  IMAGES  ")).toBe("Image");
    expect(canonicalDockerKind("network")).toBe("Network");
    expect(canonicalDockerKind("Volumes")).toBe("Volume");
  });

  it("returns null for empty, whitespace and unknown kinds", () => {
    expect(canonicalDockerKind("")).toBeNull();
    expect(canonicalDockerKind("   ")).toBeNull();
    expect(canonicalDockerKind("pod")).toBeNull();
  });
});

describe("extractDockerInventoryResource - guard cases", () => {
  it("returns null for an unmodeled kind", () => {
    expect(extract("Secret", { Name: "x" })).toBeNull();
  });

  it("returns null for malformed JSON in the log body", () => {
    expect(extract("Container", "{not json")).toBeNull();
  });

  it("returns null when the body is a JSON array, not an object", () => {
    expect(extract("Container", [1, 2, 3])).toBeNull();
  });

  it("returns null when the body is a JSON primitive", () => {
    expect(extract("Container", "42")).toBeNull();
  });
});

describe("extractDockerInventoryResource - Container", () => {
  it("parses a docker CLI container envelope", () => {
    const resource: ParsedDockerResource | null = extract("Container", {
      kind: "Container",
      data: {
        Id: "abcdef0123456789deadbeef",
        Names: "/web,/web-1",
        Image: "nginx:latest",
        State: "RUNNING",
        CreatedAt: "2026-07-30T10:00:00.000Z",
        Labels: { app: "web" },
      },
    });

    expect(resource).not.toBeNull();
    expect(resource!.kind).toBe("Container");
    // Leading slash stripped, first name only.
    expect(resource!.name).toBe("web");
    // Container id truncated to the short 12-char form.
    expect(resource!.containerId).toBe("abcdef012345");
    expect(resource!.imageName).toBe("nginx:latest");
    // State is lowercased.
    expect(resource!.state).toBe("running");
    expect(resource!.labels).toEqual({ app: "web" });
    expect(resource!.lastSeenAt).toBe(lastSeenAt);
    expect(resource!.resourceCreationTimestamp).not.toBeNull();
    expect(resource!.resourceCreationTimestamp!.getTime()).toBe(
      new Date("2026-07-30T10:00:00.000Z").getTime(),
    );
  });

  it("accepts a raw payload without the { kind, data } envelope", () => {
    const resource: ParsedDockerResource | null = extract("container", {
      Id: "0123456789ab",
      Names: "api",
    });

    expect(resource).not.toBeNull();
    expect(resource!.name).toBe("api");
    expect(resource!.containerId).toBe("0123456789ab");
  });

  it("falls back to the Name field when Names is absent", () => {
    const resource: ParsedDockerResource | null = extract("Container", {
      Name: "/solo",
    });
    expect(resource!.name).toBe("solo");
  });

  it("returns null when a container has no usable name", () => {
    expect(extract("Container", { Id: "abc", Names: " , ," })).toBeNull();
  });

  it("leaves optional fields null when absent", () => {
    const resource: ParsedDockerResource | null = extract("Container", {
      Names: "bare",
    });
    expect(resource!.containerId).toBeNull();
    expect(resource!.imageName).toBeNull();
    expect(resource!.state).toBeNull();
    expect(resource!.labels).toBeNull();
    expect(resource!.resourceCreationTimestamp).toBeNull();
  });

  it("treats an unparseable CreatedAt as no timestamp", () => {
    const resource: ParsedDockerResource | null = extract("Container", {
      Names: "web",
      CreatedAt: "not-a-timestamp",
    });
    expect(resource!.resourceCreationTimestamp).toBeNull();
  });
});

describe("extractDockerInventoryResource - Image", () => {
  it("builds the name from Repository and Tag", () => {
    const resource: ParsedDockerResource | null = extract("Image", {
      ID: "sha256:abcdef0123456789",
      Repository: "nginx",
      Tag: "1.25",
    });
    expect(resource!.name).toBe("nginx:1.25");
    // sha256: prefix stripped, then truncated to 12.
    expect(resource!.containerId).toBe("abcdef012345");
    expect(resource!.imageName).toBeNull();
  });

  it("uses only the repository when the tag is <none>", () => {
    const resource: ParsedDockerResource | null = extract("Image", {
      Repository: "nginx",
      Tag: "<none>",
    });
    expect(resource!.name).toBe("nginx");
  });

  it("skips a dangling image whose repository is <none>", () => {
    expect(
      extract("Image", { Repository: "<none>", Tag: "<none>" }),
    ).toBeNull();
  });

  it("prefers an explicit Name field when provided", () => {
    const resource: ParsedDockerResource | null = extract("Image", {
      Name: "custom/image:v2",
      Repository: "ignored",
      Tag: "ignored",
    });
    expect(resource!.name).toBe("custom/image:v2");
  });
});

describe("extractDockerInventoryResource - Network", () => {
  it("encodes driver and scope into the state column", () => {
    const resource: ParsedDockerResource | null = extract("Network", {
      ID: "netid00000011112222",
      Name: "bridge",
      Driver: "bridge",
      Scope: "local",
    });
    expect(resource!.kind).toBe("Network");
    expect(resource!.name).toBe("bridge");
    expect(resource!.state).toBe("bridge/local");
    expect(resource!.containerId).toBe("netid0000001");
  });

  it("returns null for a network without a name", () => {
    expect(extract("Network", { Driver: "bridge" })).toBeNull();
  });

  it("leaves state null when neither driver nor scope is present", () => {
    const resource: ParsedDockerResource | null = extract("Network", {
      Name: "isolated",
    });
    expect(resource!.state).toBeNull();
  });
});

describe("extractDockerInventoryResource - Volume", () => {
  it("parses a volume and never sets a containerId", () => {
    const resource: ParsedDockerResource | null = extract("Volume", {
      Name: "data",
      Driver: "local",
      Scope: "local",
      Labels: { backup: "true" },
    });
    expect(resource!.kind).toBe("Volume");
    expect(resource!.name).toBe("data");
    expect(resource!.state).toBe("local/local");
    expect(resource!.containerId).toBeNull();
    expect(resource!.imageName).toBeNull();
    expect(resource!.labels).toEqual({ backup: "true" });
  });

  it("returns null for a volume without a name", () => {
    expect(extract("Volume", { Driver: "local" })).toBeNull();
  });
});
