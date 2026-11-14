import ProductKey, {
  NOT_ONBOARDED_PRODUCT_KEYS,
  ONBOARDED_PRODUCT_KEYS,
  PRODUCT_KEYS,
  isProductKey,
  parseProductKeys,
  sortProductKeys,
} from "../../../Types/Product/ProductKey";
import { describe, expect, test } from "@jest/globals";

/*
 * Every entry of the products menu has a key that never changes (#6814):
 * pins and a project's hidden products are stored by it and sent to
 * product analytics, so a key is never renamed or reused.
 */
describe("ProductKey", () => {
  test("PRODUCT_KEYS lists every key once, in the products menu's order", () => {
    expect([...PRODUCT_KEYS].sort()).toEqual(
      [...Object.values(ProductKey)].sort(),
    );
    expect(new Set(PRODUCT_KEYS).size).toBe(PRODUCT_KEYS.length);
    // 43 products, Chat, and the three entries of Settings.
    expect(PRODUCT_KEYS).toHaveLength(47);
    expect(PRODUCT_KEYS[0]).toBe(ProductKey.Monitors);
    expect(PRODUCT_KEYS[PRODUCT_KEYS.length - 1]).toBe(
      ProductKey.ProjectSettings,
    );
  });

  test("the keys the How it works registry always used are unchanged", () => {
    // Stored and sent to analytics: a rename here would orphan rows.
    expect(ProductKey.Monitors).toBe("monitors");
    expect(ProductKey.OnCall).toBe("on-call");
    expect(ProductKey.StatusPages).toBe("status-pages");
    expect(ProductKey.ScheduledMaintenance).toBe("scheduled-maintenance");
    expect(ProductKey.Kubernetes).toBe("kubernetes");
    expect(ProductKey.DockerSwarm).toBe("docker-swarm");
    expect(ProductKey.AppPlatforms).toBe("app-platforms");
    expect(ProductKey.AIInsights).toBe("ai-insights");
    expect(ProductKey.AIChat).toBe("ai-chat");
    expect(ProductKey.ProjectSettings).toBe("project-settings");
  });

  test("every key is lower case words joined by dashes", () => {
    const wordsJoinedByDashes: RegExp = /^[a-z0-9]+(-[a-z0-9]+)*$/;

    for (const key of PRODUCT_KEYS) {
      expect([key, wordsJoinedByDashes.test(key)]).toEqual([key, true]);
    }
  });

  test("the onboarded products are every key but Chat and the three of Settings", () => {
    expect(NOT_ONBOARDED_PRODUCT_KEYS).toEqual([
      ProductKey.AIChat,
      ProductKey.Users,
      ProductKey.Teams,
      ProductKey.ProjectSettings,
    ]);
    expect(ONBOARDED_PRODUCT_KEYS).toHaveLength(43);

    for (const key of NOT_ONBOARDED_PRODUCT_KEYS) {
      expect(ONBOARDED_PRODUCT_KEYS).not.toContain(key);
    }

    expect(
      [...ONBOARDED_PRODUCT_KEYS, ...NOT_ONBOARDED_PRODUCT_KEYS].sort(),
    ).toEqual([...PRODUCT_KEYS].sort());
  });

  test("isProductKey knows a key, and nothing else", () => {
    expect(isProductKey("monitors")).toBe(true);
    expect(isProductKey("project-settings")).toBe(true);
    expect(isProductKey("Monitors")).toBe(false);
    expect(isProductKey("monitor")).toBe(false);
    expect(isProductKey("")).toBe(false);
    expect(isProductKey(undefined)).toBe(false);
    expect(isProductKey(null)).toBe(false);
    expect(isProductKey(3)).toBe(false);
    expect(isProductKey(["monitors"])).toBe(false);
  });

  test("parseProductKeys keeps the known keys once, in the order given", () => {
    expect(
      parseProductKeys([
        "logs",
        "monitors",
        "nope",
        "logs",
        7,
        null,
        "kubernetes",
      ]),
    ).toEqual([ProductKey.Logs, ProductKey.Monitors, ProductKey.Kubernetes]);
  });

  test("parseProductKeys reads anything that is not a list as no keys", () => {
    expect(parseProductKeys(null)).toEqual([]);
    expect(parseProductKeys(undefined)).toEqual([]);
    expect(parseProductKeys("monitors")).toEqual([]);
    expect(parseProductKeys({ 0: "monitors" })).toEqual([]);
  });

  test("sortProductKeys puts keys in the menu's order", () => {
    expect(
      sortProductKeys([
        ProductKey.ProjectSettings,
        ProductKey.Kubernetes,
        ProductKey.Monitors,
      ]),
    ).toEqual([
      ProductKey.Monitors,
      ProductKey.Kubernetes,
      ProductKey.ProjectSettings,
    ]);
  });
});
