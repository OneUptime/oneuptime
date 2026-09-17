import Probe from "../../../Models/DatabaseModels/Probe";
import ObjectID from "../../../Types/ObjectID";
import Version from "../../../Types/Version";
import Faker from "../../../Utils/Faker";
import { describe, expect, test, beforeEach } from "@jest/globals";

describe("Probe Model", () => {
  let probe: Probe;

  beforeEach(() => {
    probe = new Probe();
  });

  describe("constructor", () => {
    test("should create a new Probe instance", () => {
      expect(probe).toBeInstanceOf(Probe);
    });

    test("should create a Probe with an ID", () => {
      const id: ObjectID = ObjectID.generate();
      const probeWithId: Probe = new Probe(id);
      expect(probeWithId.id).toEqual(id);
    });
  });

  describe("name property", () => {
    test("should set and get name correctly", () => {
      const name: string = Faker.generateName();
      probe.name = name;
      expect(probe.name).toBe(name);
    });

    test("should allow empty name", () => {
      probe.name = "";
      expect(probe.name).toBe("");
    });
  });

  describe("probeVersion property", () => {
    test("should set and get version correctly", () => {
      const version: Version = new Version("1.0.0");
      probe.probeVersion = version;
      expect(probe.probeVersion?.toString()).toBe("1.0.0");
    });

    test("should handle different version formats", () => {
      const version: Version = new Version("2.5.10");
      probe.probeVersion = version;
      expect(probe.probeVersion?.toString()).toBe("2.5.10");
    });
  });

  describe("key property", () => {
    test("should set and get key correctly", () => {
      const key: string = ObjectID.generate().toString();
      probe.key = key;
      expect(probe.key).toBe(key);
    });

    test("should handle UUID format keys", () => {
      const key: string = "550e8400-e29b-41d4-a716-446655440000";
      probe.key = key;
      expect(probe.key).toBe(key);
    });
  });

  describe("description property", () => {
    test("should set and get description correctly", () => {
      const description: string = "Test probe description";
      probe.description = description;
      expect(probe.description).toBe(description);
    });

    test("should handle long descriptions", () => {
      const longDescription: string = "A".repeat(1000);
      probe.description = longDescription;
      expect(probe.description).toBe(longDescription);
    });
  });

  describe("isGlobalProbe property", () => {
    test("should default to undefined", () => {
      expect(probe.isGlobalProbe).toBeUndefined();
    });

    test("should set global flag to true", () => {
      probe.isGlobalProbe = true;
      expect(probe.isGlobalProbe).toBe(true);
    });

    test("should set global flag to false", () => {
      probe.isGlobalProbe = false;
      expect(probe.isGlobalProbe).toBe(false);
    });
  });

  describe("lastAlive property", () => {
    test("should set and get lastAlive date", () => {
      const date: Date = new Date();
      probe.lastAlive = date;
      expect(probe.lastAlive).toBe(date);
    });
  });

  describe("slug property", () => {
    test("should set and get slug correctly", () => {
      const slug: string = "test-probe-slug";
      probe.slug = slug;
      expect(probe.slug).toBe(slug);
    });
  });

  describe("Probe with multiple properties", () => {
    test("should handle all properties together", () => {
      const id: ObjectID = ObjectID.generate();
      const name: string = Faker.generateName();
      const version: Version = new Version("3.0.0");
      const key: string = ObjectID.generate().toString();
      const description: string = "Full probe test";

      const fullProbe: Probe = new Probe(id);
      fullProbe.name = name;
      fullProbe.probeVersion = version;
      fullProbe.key = key;
      fullProbe.description = description;
      fullProbe.isGlobalProbe = true;

      expect(fullProbe.id).toEqual(id);
      expect(fullProbe.name).toBe(name);
      expect(fullProbe.probeVersion?.toString()).toBe("3.0.0");
      expect(fullProbe.key).toBe(key);
      expect(fullProbe.description).toBe(description);
      expect(fullProbe.isGlobalProbe).toBe(true);
    });

    test("should create probe with minimal properties", () => {
      const minimalProbe: Probe = new Probe();
      minimalProbe.name = "Minimal";

      expect(minimalProbe.name).toBe("Minimal");
      expect(minimalProbe.key).toBeUndefined();
      expect(minimalProbe.description).toBeUndefined();
    });
  });
});
