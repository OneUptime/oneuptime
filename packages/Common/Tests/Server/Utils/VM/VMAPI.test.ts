// Mock all heavy dependencies so the test focuses on template logic only
jest.mock("../../../../Server/Utils/VM/VMRunner", () => {
  return {
    __esModule: true,
    default: {
      runCodeInSandbox: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      error: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Utils/Telemetry/CaptureSpan", () => {
  return {
    __esModule: true,
    default: () => {
      return (
        _target: any,
        _propertyKey: string,
        descriptor: PropertyDescriptor,
      ) => {
        return descriptor;
      };
    },
  };
});

import VMUtil from "../../../../Server/Utils/VM/VMAPI";
import { describe, expect, it } from "@jest/globals";
import { JSONObject } from "../../../../Types/JSON";

describe("VMUtil", () => {
  describe("deepFind", () => {
    it("should find top-level keys", () => {
      const obj: JSONObject = { status: "firing", receiver: "test" };
      expect(VMUtil.deepFind(obj, "status")).toBe("firing");
    });

    it("should find nested keys with dot notation", () => {
      const obj: JSONObject = { data: { nested: { value: 42 } } };
      expect(VMUtil.deepFind(obj, "data.nested.value")).toBe(42);
    });

    it("should find array elements with bracket notation", () => {
      const obj: JSONObject = { items: ["a", "b", "c"] };
      expect(VMUtil.deepFind(obj, "items[0]")).toBe("a");
      expect(VMUtil.deepFind(obj, "items[2]")).toBe("c");
    });

    it("should find last array element with [last]", () => {
      const obj: JSONObject = { items: [1, 2, 3] };
      expect(VMUtil.deepFind(obj, "items[last]")).toBe(3);
    });

    it("should return undefined for missing paths", () => {
      const obj: JSONObject = { a: { b: 1 } };
      expect(VMUtil.deepFind(obj, "a.c")).toBeUndefined();
      expect(VMUtil.deepFind(obj, "x.y.z")).toBeUndefined();
    });
  });

  describe("replaceValueInPlace", () => {
    it("should replace simple variables", () => {
      const storageMap: JSONObject = { name: "test", status: "firing" };
      const result: string = VMUtil.replaceValueInPlace(
        storageMap,
        "Alert: {{name}} is {{status}}",
        false,
      );
      expect(result).toBe("Alert: test is firing");
    });

    it("should replace nested dotted path variables", () => {
      const storageMap: JSONObject = {
        requestBody: { title: "My Alert", data: { severity: "high" } },
      };
      const result: string = VMUtil.replaceValueInPlace(
        storageMap,
        "Title: {{requestBody.title}}, Severity: {{requestBody.data.severity}}",
        false,
      );
      expect(result).toBe("Title: My Alert, Severity: high");
    });

    it("should leave unresolved variables as-is", () => {
      const storageMap: JSONObject = { name: "test" };
      const result: string = VMUtil.replaceValueInPlace(
        storageMap,
        "{{name}} {{unknown}}",
        false,
      );
      expect(result).toBe("test {{unknown}}");
    });
  });

  describe("expandEachLoops", () => {
    it("should expand a simple each loop over an array of objects", () => {
      const storageMap: JSONObject = {
        requestBody: {
          alerts: [
            { labels: { label: "Coralpay" }, status: "firing" },
            { labels: { label: "capitecpay" }, status: "resolved" },
          ],
        },
      };

      const template: string =
        "Alerts:{{#each requestBody.alerts}} {{labels.label}}({{status}}){{/each}}";
      const result: string = VMUtil.expandEachLoops(
        storageMap,
        template,
        false,
      );
      expect(result).toBe("Alerts: Coralpay(firing) capitecpay(resolved)");
    });

    it("should support {{@index}} in loops", () => {
      const storageMap: JSONObject = {
        items: [{ name: "a" }, { name: "b" }, { name: "c" }],
      };

      const template: string = "{{#each items}}{{@index}}: {{name}} {{/each}}";
      const result: string = VMUtil.expandEachLoops(
        storageMap,
        template,
        false,
      );
      expect(result).toBe("0: a 1: b 2: c ");
    });

    it("should support {{this}} for primitive arrays", () => {
      const storageMap: JSONObject = {
        tags: ["critical", "production", "api"],
      };

      const template: string = "Tags:{{#each tags}} {{this}}{{/each}}";
      const result: string = VMUtil.expandEachLoops(
        storageMap,
        template,
        false,
      );
      expect(result).toBe("Tags: critical production api");
    });

    it("should remove the block if the path is not an array", () => {
      const storageMap: JSONObject = { notAnArray: "hello" };
      const template: string = "Before {{#each notAnArray}}body{{/each}} After";
      const result: string = VMUtil.expandEachLoops(
        storageMap,
        template,
        false,
      );
      expect(result).toBe("Before  After");
    });

    it("should remove the block if the path does not exist", () => {
      const storageMap: JSONObject = {};
      const template: string =
        "Before {{#each missing.path}}body{{/each}} After";
      const result: string = VMUtil.expandEachLoops(
        storageMap,
        template,
        false,
      );
      expect(result).toBe("Before  After");
    });

    it("should handle empty arrays", () => {
      const storageMap: JSONObject = { items: [] };
      const template: string = "Before {{#each items}}item{{/each}} After";
      const result: string = VMUtil.expandEachLoops(
        storageMap,
        template,
        false,
      );
      expect(result).toBe("Before  After");
    });

    it("should support nested each loops", () => {
      const storageMap: JSONObject = {
        groups: [
          { name: "G1", members: [{ id: 1 }, { id: 2 }] },
          { name: "G2", members: [{ id: 3 }] },
        ],
      };

      const template: string =
        "{{#each groups}}Group {{name}}: {{#each members}}{{id}} {{/each}}| {{/each}}";
      const result: string = VMUtil.expandEachLoops(
        storageMap,
        template,
        false,
      );
      expect(result).toBe("Group G1: 1 2 | Group G2: 3 | ");
    });

    it("should allow fallback to parent variables inside loops", () => {
      const storageMap: JSONObject = {
        globalTitle: "My Dashboard",
        items: [{ name: "item1" }, { name: "item2" }],
      };

      const template: string =
        "{{#each items}}{{name}} in {{globalTitle}} {{/each}}";
      const result: string = VMUtil.expandEachLoops(
        storageMap,
        template,
        false,
      );
      expect(result).toBe("item1 in My Dashboard item2 in My Dashboard ");
    });
  });

  describe("replaceValueInPlace with each loops (end-to-end)", () => {
    it("should expand loops and then replace remaining variables", () => {
      const storageMap: JSONObject = {
        requestBody: {
          receiver: "Fundsflow",
          alerts: [
            {
              status: "firing",
              labels: { label: "Coralpay", alertname: "File Drop" },
            },
            {
              status: "firing",
              labels: { label: "capitecpay", alertname: "File Drop" },
            },
          ],
        },
      };

      const template: string =
        "Receiver: {{requestBody.receiver}}\n{{#each requestBody.alerts}}- {{labels.label}}: {{status}}\n{{/each}}";
      const result: string = VMUtil.replaceValueInPlace(
        storageMap,
        template,
        false,
      );
      expect(result).toBe(
        "Receiver: Fundsflow\n- Coralpay: firing\n- capitecpay: firing\n",
      );
    });

    it("should handle the Grafana alerts use case", () => {
      const storageMap: JSONObject = {
        requestBody: {
          status: "firing",
          alerts: [
            {
              status: "firing",
              labels: {
                alertname: "Fundsflow File Drop Update",
                label: "Coralpay",
              },
              valueString: "A=0, C=1",
            },
            {
              status: "firing",
              labels: {
                alertname: "Fundsflow File Drop Update",
                label: "capitecpay",
              },
              valueString: "A=0, C=1",
            },
            {
              status: "firing",
              labels: {
                alertname: "Fundsflow File Drop Update",
                label: "capricorn",
              },
              valueString: "A=0, C=1",
            },
          ],
        },
      };

      const template: string =
        "Alert Labels:\n{{#each requestBody.alerts}}- {{labels.label}}\n{{/each}}";
      const result: string = VMUtil.replaceValueInPlace(
        storageMap,
        template,
        false,
      );
      expect(result).toBe(
        "Alert Labels:\n- Coralpay\n- capitecpay\n- capricorn\n",
      );
    });
  });
});
