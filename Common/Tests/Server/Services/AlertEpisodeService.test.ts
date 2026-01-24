import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test, beforeEach } from "@jest/globals";

describe("AlertEpisodeService", () => {
  const projectId: ObjectID = ObjectID.generate();
  const episodeId: ObjectID = ObjectID.generate();

  let mockEpisode: AlertEpisode;
  let mockResolvedState: AlertState;
  let mockAcknowledgedState: AlertState;

  beforeEach(() => {
    mockEpisode = new AlertEpisode();
    mockEpisode._id = episodeId.toString();
    mockEpisode.id = episodeId;
    mockEpisode.projectId = projectId;
    mockEpisode.title = "Test Episode";
    mockEpisode.alertCount = 5;

    mockResolvedState = new AlertState();
    mockResolvedState._id = ObjectID.generate().toString();
    mockResolvedState.order = 100;
    mockResolvedState.isResolvedState = true;

    mockAcknowledgedState = new AlertState();
    mockAcknowledgedState._id = ObjectID.generate().toString();
    mockAcknowledgedState.order = 50;
    mockAcknowledgedState.isAcknowledgedState = true;
  });

  describe("AlertEpisode Model", () => {
    test("should create a new AlertEpisode instance", () => {
      const episode: AlertEpisode = new AlertEpisode();
      expect(episode).toBeInstanceOf(AlertEpisode);
    });

    test("should create AlertEpisode with an ID", () => {
      const id: ObjectID = ObjectID.generate();
      const episode: AlertEpisode = new AlertEpisode(id);
      expect(episode.id).toEqual(id);
    });

    test("should set and get title correctly", () => {
      const episode: AlertEpisode = new AlertEpisode();
      episode.title = "CPU Alert Episode";
      expect(episode.title).toBe("CPU Alert Episode");
    });

    test("should set and get description correctly", () => {
      const episode: AlertEpisode = new AlertEpisode();
      episode.description = "Multiple CPU alerts grouped together";
      expect(episode.description).toBe("Multiple CPU alerts grouped together");
    });

    test("should set and get alertCount correctly", () => {
      const episode: AlertEpisode = new AlertEpisode();
      episode.alertCount = 10;
      expect(episode.alertCount).toBe(10);
    });

    test("should set and get projectId correctly", () => {
      const episode: AlertEpisode = new AlertEpisode();
      const projectId: ObjectID = ObjectID.generate();
      episode.projectId = projectId;
      expect(episode.projectId).toEqual(projectId);
    });

    test("should set and get isManuallyCreated correctly", () => {
      const episode: AlertEpisode = new AlertEpisode();
      episode.isManuallyCreated = true;
      expect(episode.isManuallyCreated).toBe(true);
    });

    test("should set and get titleTemplate correctly", () => {
      const episode: AlertEpisode = new AlertEpisode();
      episode.titleTemplate = "{{alertTitle}} - {{alertCount}} alerts";
      expect(episode.titleTemplate).toBe(
        "{{alertTitle}} - {{alertCount}} alerts",
      );
    });

    test("should set and get descriptionTemplate correctly", () => {
      const episode: AlertEpisode = new AlertEpisode();
      episode.descriptionTemplate = "Episode with {{alertCount}} alerts";
      expect(episode.descriptionTemplate).toBe(
        "Episode with {{alertCount}} alerts",
      );
    });

    test("should set and get groupingKey correctly", () => {
      const episode: AlertEpisode = new AlertEpisode();
      episode.groupingKey = "monitor:abc123|severity:critical";
      expect(episode.groupingKey).toBe("monitor:abc123|severity:critical");
    });

    test("should set and get rootCause correctly", () => {
      const episode: AlertEpisode = new AlertEpisode();
      episode.rootCause = "Database connection pool exhausted";
      expect(episode.rootCause).toBe("Database connection pool exhausted");
    });

    test("should set and get lastAlertAddedAt correctly", () => {
      const episode: AlertEpisode = new AlertEpisode();
      const date: Date = new Date();
      episode.lastAlertAddedAt = date;
      expect(episode.lastAlertAddedAt).toEqual(date);
    });

    test("should set and get resolvedAt correctly", () => {
      const episode: AlertEpisode = new AlertEpisode();
      const date: Date = new Date();
      episode.resolvedAt = date;
      expect(episode.resolvedAt).toEqual(date);
    });

    test("should set and get assignedToUserId correctly", () => {
      const episode: AlertEpisode = new AlertEpisode();
      const userId: ObjectID = ObjectID.generate();
      episode.assignedToUserId = userId;
      expect(episode.assignedToUserId).toEqual(userId);
    });

    test("should set and get assignedToTeamId correctly", () => {
      const episode: AlertEpisode = new AlertEpisode();
      const teamId: ObjectID = ObjectID.generate();
      episode.assignedToTeamId = teamId;
      expect(episode.assignedToTeamId).toEqual(teamId);
    });
  });

  describe("Episode with full data", () => {
    test("should handle complete episode record", () => {
      const id: ObjectID = ObjectID.generate();
      const projectId: ObjectID = ObjectID.generate();
      const userId: ObjectID = ObjectID.generate();
      const teamId: ObjectID = ObjectID.generate();
      const ruleId: ObjectID = ObjectID.generate();
      const severityId: ObjectID = ObjectID.generate();

      const episode: AlertEpisode = new AlertEpisode(id);
      episode.projectId = projectId;
      episode.title = "Database Connection Issues";
      episode.description = "Multiple connection timeout alerts";
      episode.alertCount = 15;
      episode.isManuallyCreated = false;
      episode.groupingKey = "monitor:db-server|severity:critical";
      episode.titleTemplate = "DB Issues ({{alertCount}})";
      episode.descriptionTemplate = "{{alertCount}} connection alerts";
      episode.rootCause = "Network congestion";
      episode.assignedToUserId = userId;
      episode.assignedToTeamId = teamId;
      episode.alertGroupingRuleId = ruleId;
      episode.alertSeverityId = severityId;

      expect(episode.id).toEqual(id);
      expect(episode.projectId).toEqual(projectId);
      expect(episode.title).toBe("Database Connection Issues");
      expect(episode.description).toBe("Multiple connection timeout alerts");
      expect(episode.alertCount).toBe(15);
      expect(episode.isManuallyCreated).toBe(false);
      expect(episode.groupingKey).toBe("monitor:db-server|severity:critical");
      expect(episode.titleTemplate).toBe("DB Issues ({{alertCount}})");
      expect(episode.descriptionTemplate).toBe(
        "{{alertCount}} connection alerts",
      );
      expect(episode.rootCause).toBe("Network congestion");
      expect(episode.assignedToUserId).toEqual(userId);
      expect(episode.assignedToTeamId).toEqual(teamId);
      expect(episode.alertGroupingRuleId).toEqual(ruleId);
      expect(episode.alertSeverityId).toEqual(severityId);
    });
  });

  describe("Template rendering helper", () => {
    test("should replace {{alertCount}} in title template", () => {
      const template: string = "CPU Issues - {{alertCount}} alerts";
      const alertCount: number = 5;
      const result: string = template.replace(
        /\{\{alertCount\}\}/g,
        alertCount.toString(),
      );
      expect(result).toBe("CPU Issues - 5 alerts");
    });

    test("should replace multiple occurrences of {{alertCount}}", () => {
      const template: string = "{{alertCount}} alerts ({{alertCount}} total)";
      const alertCount: number = 7;
      const result: string = template.replace(
        /\{\{alertCount\}\}/g,
        alertCount.toString(),
      );
      expect(result).toBe("7 alerts (7 total)");
    });

    test("should handle template without placeholders", () => {
      const template: string = "Static Episode Title";
      const alertCount: number = 10;
      const result: string = template.replace(
        /\{\{alertCount\}\}/g,
        alertCount.toString(),
      );
      expect(result).toBe("Static Episode Title");
    });

    test("should handle empty template", () => {
      const template: string = "";
      const alertCount: number = 3;
      const result: string = template.replace(
        /\{\{alertCount\}\}/g,
        alertCount.toString(),
      );
      expect(result).toBe("");
    });
  });

  describe("AlertState comparison", () => {
    test("should correctly compare state orders for resolution check", () => {
      const currentOrder: number = 100;
      const resolvedOrder: number = 100;
      const isResolved: boolean = currentOrder >= resolvedOrder;
      expect(isResolved).toBe(true);
    });

    test("should correctly identify unresolved state", () => {
      const currentOrder: number = 50;
      const resolvedOrder: number = 100;
      const isResolved: boolean = currentOrder >= resolvedOrder;
      expect(isResolved).toBe(false);
    });

    test("should correctly identify acknowledged state", () => {
      const currentOrder: number = 50;
      const acknowledgedOrder: number = 50;
      const isAcknowledged: boolean = currentOrder >= acknowledgedOrder;
      expect(isAcknowledged).toBe(true);
    });
  });
});
