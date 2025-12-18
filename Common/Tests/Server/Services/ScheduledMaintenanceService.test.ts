import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test, beforeEach } from "@jest/globals";

describe("ScheduledMaintenance Model", () => {
  let maintenance: ScheduledMaintenance;

  beforeEach(() => {
    maintenance = new ScheduledMaintenance();
  });

  describe("constructor", () => {
    test("should create a new ScheduledMaintenance instance", () => {
      expect(maintenance).toBeInstanceOf(ScheduledMaintenance);
    });

    test("should create ScheduledMaintenance with an ID", () => {
      const id: ObjectID = ObjectID.generate();
      const maintenanceWithId: ScheduledMaintenance = new ScheduledMaintenance(
        id,
      );
      expect(maintenanceWithId.id).toEqual(id);
    });
  });

  describe("title property", () => {
    test("should set and get title correctly", () => {
      const title: string = "Scheduled Database Maintenance";
      maintenance.title = title;
      expect(maintenance.title).toBe(title);
    });

    test("should handle special characters in title", () => {
      const title: string = "Maintenance: Update & Upgrade (v2.0)";
      maintenance.title = title;
      expect(maintenance.title).toBe(title);
    });
  });

  describe("description property", () => {
    test("should set and get description correctly", () => {
      const description: string = "This is a scheduled maintenance window";
      maintenance.description = description;
      expect(maintenance.description).toBe(description);
    });

    test("should handle markdown in description", () => {
      const description: string = "## Maintenance\n- Item 1\n- Item 2";
      maintenance.description = description;
      expect(maintenance.description).toBe(description);
    });
  });

  describe("projectId property", () => {
    test("should set and get projectId correctly", () => {
      const projectId: ObjectID = ObjectID.generate();
      maintenance.projectId = projectId;
      expect(maintenance.projectId).toEqual(projectId);
    });
  });

  describe("startsAt property", () => {
    test("should set and get startsAt date", () => {
      const startsAt: Date = new Date("2024-01-15T10:00:00Z");
      maintenance.startsAt = startsAt;
      expect(maintenance.startsAt).toEqual(startsAt);
    });
  });

  describe("endsAt property", () => {
    test("should set and get endsAt date", () => {
      const endsAt: Date = new Date("2024-01-15T14:00:00Z");
      maintenance.endsAt = endsAt;
      expect(maintenance.endsAt).toEqual(endsAt);
    });

    test("should default to undefined endsAt (ongoing maintenance)", () => {
      const newMaintenance: ScheduledMaintenance = new ScheduledMaintenance();
      expect(newMaintenance.endsAt).toBeUndefined();
    });
  });

  describe("notification settings", () => {
    test("should set shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded", () => {
      maintenance.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded =
        true;
      expect(
        maintenance.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded,
      ).toBe(true);
    });

    test("should set shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing", () => {
      maintenance.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing =
        true;
      expect(
        maintenance.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing,
      ).toBe(true);
    });
  });

  describe("ScheduledMaintenance with full data", () => {
    test("should handle complete maintenance record", () => {
      const id: ObjectID = ObjectID.generate();
      const projectId: ObjectID = ObjectID.generate();
      const title: string = "Full Maintenance Test";
      const description: string = "Complete maintenance description";
      const startsAt: Date = new Date("2024-02-01T08:00:00Z");
      const endsAt: Date = new Date("2024-02-01T12:00:00Z");

      const fullMaintenance: ScheduledMaintenance = new ScheduledMaintenance(
        id,
      );
      fullMaintenance.projectId = projectId;
      fullMaintenance.title = title;
      fullMaintenance.description = description;
      fullMaintenance.startsAt = startsAt;
      fullMaintenance.endsAt = endsAt;
      fullMaintenance.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded =
        true;
      fullMaintenance.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing =
        true;

      expect(fullMaintenance.id).toEqual(id);
      expect(fullMaintenance.projectId).toEqual(projectId);
      expect(fullMaintenance.title).toBe(title);
      expect(fullMaintenance.description).toBe(description);
      expect(fullMaintenance.startsAt).toEqual(startsAt);
      expect(fullMaintenance.endsAt).toEqual(endsAt);
    });

    test("should create maintenance with minimal required fields", () => {
      const minMaintenance: ScheduledMaintenance = new ScheduledMaintenance();
      minMaintenance.title = "Minimal Maintenance";

      expect(minMaintenance.title).toBe("Minimal Maintenance");
      expect(minMaintenance.description).toBeUndefined();
      expect(minMaintenance.startsAt).toBeUndefined();
    });
  });
});
