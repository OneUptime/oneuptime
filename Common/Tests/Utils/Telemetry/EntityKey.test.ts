import {
  canonicalizeEntityValue,
  computeEntityKey,
  keyForService,
  setSha256Provider,
} from "../../../Utils/Telemetry/EntityKey";
import Crypto from "../../../Utils/Crypto";
import EntityType from "../../../Types/Telemetry/EntityType";
import { describe, expect, test } from "@jest/globals";
import { createHash } from "crypto";
import CryptoJS from "crypto-js";

const PROJECT: string = "proj1";

describe("canonicalizeEntityValue", () => {
  test("trims and lowercases", () => {
    expect(canonicalizeEntityValue("  Web-1 ")).toBe("web-1");
    expect(canonicalizeEntityValue("PRIMARY01")).toBe("primary01");
  });

  test("undefined coerces to empty string", () => {
    expect(canonicalizeEntityValue(undefined)).toBe("");
  });
});

describe("computeEntityKey — preimage escaping", () => {
  test("values containing separators do not collide with structurally different identity sets", () => {
    // Without escaping, both would build the preimage
    // `proj1|service|service.name=a|service.namespace=b`.
    const smuggled: string = computeEntityKey({
      projectId: PROJECT,
      entityType: EntityType.Service,
      identifyingAttributes: { "service.name": "a|service.namespace=b" },
    });
    const split: string = computeEntityKey({
      projectId: PROJECT,
      entityType: EntityType.Service,
      identifyingAttributes: {
        "service.name": "a",
        "service.namespace": "b",
      },
    });
    expect(smuggled).not.toBe(split);
  });

  test("the escape character itself is escaped (no backslash smuggling)", () => {
    // A literal backslash in a value must be doubled in the preimage, so a
    // trailing backslash cannot masquerade as an escape of the following
    // separator.
    const trailingBackslash: string = computeEntityKey({
      projectId: PROJECT,
      entityType: EntityType.Service,
      identifyingAttributes: { a: "x\\", b: "y" },
    });
    expect(trailingBackslash).toBe(
      createHash("sha256")
        .update("proj1|service|a=x\\\\|b=y")
        .digest("hex")
        .slice(0, 16),
    );
    const literalSeparators: string = computeEntityKey({
      projectId: PROJECT,
      entityType: EntityType.Service,
      identifyingAttributes: { a: "x\\|b=y" },
    });
    expect(trailingBackslash).not.toBe(literalSeparators);
  });

  test("normal values keep the historical preimage (already-stamped keys unchanged)", () => {
    const key: string = computeEntityKey({
      projectId: PROJECT,
      entityType: EntityType.Service,
      identifyingAttributes: { "service.name": "checkout" },
    });
    // Unescaped preimage, exactly as stamped before escaping existed.
    const historical: string = createHash("sha256")
      .update("proj1|service|service.name=checkout")
      .digest("hex")
      .slice(0, 16);
    expect(key).toBe(historical);
    // Pinned so any preimage drift (separator, ordering, hash, slice
    // length) fails loudly — this exact key is stamped in ClickHouse rows.
    expect(key).toBe("904989abd67aec3f");
    expect(keyForService(PROJECT, "checkout")).toBe("904989abd67aec3f");
  });
});

describe("sha256 provider injection", () => {
  test("node:crypto and crypto-js produce identical hex for the same input", () => {
    const inputs: Array<string> = [
      "proj1|service|service.name=checkout",
      "projB|k8s.cluster|k8s.cluster.name=prod-us",
      "p|host|host.name=ünïcode-höst",
    ];
    for (const input of inputs) {
      expect(CryptoJS.SHA256(input).toString()).toBe(
        createHash("sha256").update(input).digest("hex"),
      );
    }
  });

  test("setSha256Provider is honored by computeEntityKey", () => {
    try {
      setSha256Provider(() => {
        return "f".repeat(64);
      });
      expect(
        computeEntityKey({
          projectId: PROJECT,
          entityType: EntityType.Host,
          identifyingAttributes: { "host.name": "web-1" },
        }),
      ).toBe("f".repeat(16));
    } finally {
      setSha256Provider((input: string) => {
        return Crypto.getSha256Hash(input);
      });
    }
  });

  test("swapping in the node:crypto provider does not change keys", () => {
    const before: string = computeEntityKey({
      projectId: PROJECT,
      entityType: EntityType.Host,
      identifyingAttributes: { "host.name": "web-1" },
    });
    try {
      setSha256Provider((input: string) => {
        return createHash("sha256").update(input).digest("hex");
      });
      expect(
        computeEntityKey({
          projectId: PROJECT,
          entityType: EntityType.Host,
          identifyingAttributes: { "host.name": "web-1" },
        }),
      ).toBe(before);
    } finally {
      setSha256Provider((input: string) => {
        return Crypto.getSha256Hash(input);
      });
    }
  });
});
