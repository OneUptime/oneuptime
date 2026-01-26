import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import AlertGroupingRule from "../../../Models/DatabaseModels/AlertGroupingRule";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test, beforeEach } from "@jest/globals";

/**
 * These tests focus on model-level testing for alert grouping components.
 * Service integration tests require database connections and are covered
 * in E2E tests.
 */
describe("AlertGroupingEngineService Models", () => {
  const projectId: ObjectID = ObjectID.generate();
  const alertId: ObjectID = ObjectID.generate();
  const monitorId: ObjectID = ObjectID.generate();
  const severityId: ObjectID = ObjectID.generate();
  const ruleId: ObjectID = ObjectID.generate();
  const episodeId: ObjectID = ObjectID.generate();

  let mockAlert: Alert;
  let mockMonitor: Monitor;
  let mockSeverity: AlertSeverity;
  let mockRule: AlertGroupingRule;
  let mockEpisode: AlertEpisode;

  beforeEach(() => {
    // Setup mock monitor
    mockMonitor = new Monitor();
    mockMonitor._id = monitorId.toString();
    mockMonitor.name = "Test Monitor";

    // Setup mock severity
    mockSeverity = new AlertSeverity();
    mockSeverity._id = severityId.toString();
    mockSeverity.name = "Critical";

    // Setup mock alert
    mockAlert = new Alert();
    mockAlert._id = alertId.toString();
    mockAlert.id = alertId;
    mockAlert.projectId = projectId;
    mockAlert.title = "CPU Usage High";
    mockAlert.description = "CPU usage exceeded 90%";
    mockAlert.monitor = mockMonitor;
    mockAlert.monitorId = monitorId;
    mockAlert.alertSeverity = mockSeverity;
    mockAlert.alertSeverityId = severityId;

    // Setup mock rule
    mockRule = new AlertGroupingRule();
    mockRule._id = ruleId.toString();
    mockRule.id = ruleId;
    mockRule.name = "Critical Alerts Rule";
    mockRule.isEnabled = true;
    mockRule.priority = 1;
    mockRule.groupByMonitor = true;
    mockRule.enableTimeWindow = true;
    mockRule.timeWindowMinutes = 30;

    // Setup mock episode
    mockEpisode = new AlertEpisode();
    mockEpisode._id = episodeId.toString();
    mockEpisode.id = episodeId;
    mockEpisode.projectId = projectId;
    mockEpisode.title = "Test Episode";
  });

  describe("Alert Model for Grouping", () => {
    test("should have alertEpisodeId field", () => {
      const alert: Alert = new Alert();
      const episodeId: ObjectID = ObjectID.generate();
      alert.alertEpisodeId = episodeId;
      expect(alert.alertEpisodeId).toEqual(episodeId);
    });

    test("should store title and description for template variables", () => {
      expect(mockAlert.title).toBe("CPU Usage High");
      expect(mockAlert.description).toBe("CPU usage exceeded 90%");
    });

    test("should reference monitor for template variables", () => {
      expect(mockAlert.monitor?.name).toBe("Test Monitor");
    });

    test("should reference alert severity for template variables", () => {
      expect(mockAlert.alertSeverity?.name).toBe("Critical");
    });
  });

  describe("AlertGroupingRule Matching Criteria", () => {
    describe("Monitor Matching", () => {
      test("should support array of monitors for matching", () => {
        mockRule.monitors = [mockMonitor];
        expect(mockRule.monitors).toHaveLength(1);
        expect(mockRule.monitors[0]).toBe(mockMonitor);
      });

      test("should check if monitor exists in rule monitors", () => {
        const otherMonitor: Monitor = new Monitor();
        otherMonitor._id = ObjectID.generate().toString();

        mockRule.monitors = [mockMonitor, otherMonitor];

        const monitorIds: Array<string | undefined> = mockRule.monitors.map(
          (m: Monitor) => {
            return m._id;
          },
        );
        expect(monitorIds).toContain(mockMonitor._id);
        expect(monitorIds).toContain(otherMonitor._id);
      });
    });

    describe("Severity Matching", () => {
      test("should support array of severities for matching", () => {
        mockRule.alertSeverities = [mockSeverity];
        expect(mockRule.alertSeverities).toHaveLength(1);
        expect(mockRule.alertSeverities[0]).toBe(mockSeverity);
      });
    });

    describe("Pattern Matching", () => {
      test("should store title pattern for regex matching", () => {
        mockRule.alertTitlePattern = "CPU.*High";
        expect(mockRule.alertTitlePattern).toBe("CPU.*High");
      });

      test("should match alert title against pattern", () => {
        mockRule.alertTitlePattern = "CPU.*High";
        const pattern: RegExp = new RegExp(mockRule.alertTitlePattern, "i");
        expect(pattern.test(mockAlert.title!)).toBe(true);
      });

      test("should not match when pattern doesn't match", () => {
        mockRule.alertTitlePattern = "Memory.*Low";
        const pattern: RegExp = new RegExp(mockRule.alertTitlePattern, "i");
        expect(pattern.test(mockAlert.title!)).toBe(false);
      });

      test("should store description pattern for regex matching", () => {
        mockRule.alertDescriptionPattern = "CPU usage exceeded.*";
        expect(mockRule.alertDescriptionPattern).toBe("CPU usage exceeded.*");
      });

      test("should match alert description against pattern", () => {
        mockRule.alertDescriptionPattern = "CPU usage exceeded.*";
        const pattern: RegExp = new RegExp(
          mockRule.alertDescriptionPattern,
          "i",
        );
        expect(pattern.test(mockAlert.description!)).toBe(true);
      });
    });
  });

  describe("Grouping Key Generation Logic", () => {
    test("should generate grouping key with monitor when groupByMonitor is true", () => {
      mockRule.groupByMonitor = true;
      mockRule.groupBySeverity = false;
      mockRule.groupByAlertTitle = false;

      const parts: string[] = [`rule:${mockRule._id}`];
      if (mockRule.groupByMonitor && mockAlert.monitorId) {
        parts.push(`monitor:${mockAlert.monitorId.toString()}`);
      }
      if (mockRule.groupBySeverity && mockAlert.alertSeverityId) {
        parts.push(`severity:${mockAlert.alertSeverityId.toString()}`);
      }
      if (mockRule.groupByAlertTitle && mockAlert.title) {
        parts.push(`title:${mockAlert.title}`);
      }

      const groupingKey: string = parts.join("|");
      expect(groupingKey).toContain(`rule:${mockRule._id}`);
      expect(groupingKey).toContain(
        `monitor:${mockAlert.monitorId!.toString()}`,
      );
      expect(groupingKey).not.toContain("severity:");
      expect(groupingKey).not.toContain("title:");
    });

    test("should generate grouping key with severity when groupBySeverity is true", () => {
      mockRule.groupByMonitor = false;
      mockRule.groupBySeverity = true;
      mockRule.groupByAlertTitle = false;

      const parts: string[] = [`rule:${mockRule._id}`];
      if (mockRule.groupByMonitor && mockAlert.monitorId) {
        parts.push(`monitor:${mockAlert.monitorId.toString()}`);
      }
      if (mockRule.groupBySeverity && mockAlert.alertSeverityId) {
        parts.push(`severity:${mockAlert.alertSeverityId.toString()}`);
      }
      if (mockRule.groupByAlertTitle && mockAlert.title) {
        parts.push(`title:${mockAlert.title}`);
      }

      const groupingKey: string = parts.join("|");
      expect(groupingKey).toContain(`rule:${mockRule._id}`);
      expect(groupingKey).not.toContain("monitor:");
      expect(groupingKey).toContain(
        `severity:${mockAlert.alertSeverityId!.toString()}`,
      );
      expect(groupingKey).not.toContain("title:");
    });

    test("should generate grouping key with all dimensions", () => {
      mockRule.groupByMonitor = true;
      mockRule.groupBySeverity = true;
      mockRule.groupByAlertTitle = true;

      const parts: string[] = [`rule:${mockRule._id}`];
      if (mockRule.groupByMonitor && mockAlert.monitorId) {
        parts.push(`monitor:${mockAlert.monitorId.toString()}`);
      }
      if (mockRule.groupBySeverity && mockAlert.alertSeverityId) {
        parts.push(`severity:${mockAlert.alertSeverityId.toString()}`);
      }
      if (mockRule.groupByAlertTitle && mockAlert.title) {
        parts.push(`title:${mockAlert.title}`);
      }

      const groupingKey: string = parts.join("|");
      expect(groupingKey).toContain(`rule:${mockRule._id}`);
      expect(groupingKey).toContain(
        `monitor:${mockAlert.monitorId!.toString()}`,
      );
      expect(groupingKey).toContain(
        `severity:${mockAlert.alertSeverityId!.toString()}`,
      );
      expect(groupingKey).toContain(`title:${mockAlert.title}`);
    });
  });

  describe("Time Window Configuration", () => {
    test("should store enableTimeWindow flag", () => {
      mockRule.enableTimeWindow = true;
      expect(mockRule.enableTimeWindow).toBe(true);
    });

    test("should store timeWindowMinutes", () => {
      mockRule.timeWindowMinutes = 60;
      expect(mockRule.timeWindowMinutes).toBe(60);
    });

    test("should store enableReopenWindow flag", () => {
      mockRule.enableReopenWindow = true;
      expect(mockRule.enableReopenWindow).toBe(true);
    });

    test("should store reopenWindowMinutes", () => {
      mockRule.reopenWindowMinutes = 30;
      expect(mockRule.reopenWindowMinutes).toBe(30);
    });

    test("should calculate if episode is within time window", () => {
      const windowMinutes: number = 30;
      const episodeCreatedAt: Date = new Date(Date.now() - 15 * 60 * 1000); // 15 minutes ago
      const windowStart: Date = new Date(
        Date.now() - windowMinutes * 60 * 1000,
      );

      const isWithinWindow: boolean = episodeCreatedAt >= windowStart;
      expect(isWithinWindow).toBe(true);
    });

    test("should calculate if episode is outside time window", () => {
      const windowMinutes: number = 30;
      const episodeCreatedAt: Date = new Date(Date.now() - 45 * 60 * 1000); // 45 minutes ago
      const windowStart: Date = new Date(
        Date.now() - windowMinutes * 60 * 1000,
      );

      const isWithinWindow: boolean = episodeCreatedAt >= windowStart;
      expect(isWithinWindow).toBe(false);
    });
  });

  describe("Reopen Window Logic", () => {
    test("should identify recently resolved episode for reopening", () => {
      const reopenWindowMinutes: number = 30;
      const resolvedAt: Date = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago
      const reopenWindowStart: Date = new Date(
        Date.now() - reopenWindowMinutes * 60 * 1000,
      );

      mockEpisode.resolvedAt = resolvedAt;

      const canReopen: boolean = mockEpisode.resolvedAt >= reopenWindowStart;
      expect(canReopen).toBe(true);
    });

    test("should not reopen episode outside reopen window", () => {
      const reopenWindowMinutes: number = 30;
      const resolvedAt: Date = new Date(Date.now() - 45 * 60 * 1000); // 45 minutes ago
      const reopenWindowStart: Date = new Date(
        Date.now() - reopenWindowMinutes * 60 * 1000,
      );

      mockEpisode.resolvedAt = resolvedAt;

      const canReopen: boolean = mockEpisode.resolvedAt >= reopenWindowStart;
      expect(canReopen).toBe(false);
    });
  });

  describe("Rule Priority", () => {
    test("should sort rules by priority", () => {
      const rule1: AlertGroupingRule = new AlertGroupingRule();
      rule1.priority = 10;

      const rule2: AlertGroupingRule = new AlertGroupingRule();
      rule2.priority = 1;

      const rule3: AlertGroupingRule = new AlertGroupingRule();
      rule3.priority = 5;

      const rules: AlertGroupingRule[] = [rule1, rule2, rule3];
      rules.sort((a: AlertGroupingRule, b: AlertGroupingRule) => {
        return (a.priority || 0) - (b.priority || 0);
      });

      expect(rules[0]!.priority).toBe(1);
      expect(rules[1]!.priority).toBe(5);
      expect(rules[2]!.priority).toBe(10);
    });
  });
});

describe("Template Variable Replacement Logic", () => {
  const alertId: ObjectID = ObjectID.generate();
  const monitorId: ObjectID = ObjectID.generate();
  const severityId: ObjectID = ObjectID.generate();

  let mockAlert: Alert;
  let mockMonitor: Monitor;
  let mockSeverity: AlertSeverity;

  beforeEach(() => {
    mockMonitor = new Monitor();
    mockMonitor._id = monitorId.toString();
    mockMonitor.name = "API Server";

    mockSeverity = new AlertSeverity();
    mockSeverity._id = severityId.toString();
    mockSeverity.name = "Critical";

    mockAlert = new Alert();
    mockAlert._id = alertId.toString();
    mockAlert.id = alertId;
    mockAlert.title = "High CPU Usage";
    mockAlert.description = "CPU usage is above threshold";
    mockAlert.monitor = mockMonitor;
    mockAlert.alertSeverity = mockSeverity;
  });

  describe("Static Variable Replacement", () => {
    test("should replace {{alertTitle}} with alert title", () => {
      const template: string = "Episode: {{alertTitle}}";
      const result: string = template.replace(
        /\{\{alertTitle\}\}/g,
        mockAlert.title!,
      );
      expect(result).toBe("Episode: High CPU Usage");
    });

    test("should replace {{alertDescription}} with alert description", () => {
      const template: string = "Details: {{alertDescription}}";
      const result: string = template.replace(
        /\{\{alertDescription\}\}/g,
        mockAlert.description!,
      );
      expect(result).toBe("Details: CPU usage is above threshold");
    });

    test("should replace {{monitorName}} with monitor name", () => {
      const template: string = "Alert on {{monitorName}}";
      const result: string = template.replace(
        /\{\{monitorName\}\}/g,
        mockAlert.monitor?.name || "",
      );
      expect(result).toBe("Alert on API Server");
    });

    test("should replace {{alertSeverity}} with severity name", () => {
      const template: string = "{{alertSeverity}} Alert Episode";
      const result: string = template.replace(
        /\{\{alertSeverity\}\}/g,
        mockAlert.alertSeverity?.name || "",
      );
      expect(result).toBe("Critical Alert Episode");
    });

    test("should replace multiple variables in same template", () => {
      let template: string =
        "{{alertSeverity}}: {{alertTitle}} on {{monitorName}}";
      template = template.replace(/\{\{alertTitle\}\}/g, mockAlert.title!);
      template = template.replace(
        /\{\{alertSeverity\}\}/g,
        mockAlert.alertSeverity?.name || "",
      );
      template = template.replace(
        /\{\{monitorName\}\}/g,
        mockAlert.monitor?.name || "",
      );
      expect(template).toBe("Critical: High CPU Usage on API Server");
    });
  });

  describe("Dynamic Variable Replacement", () => {
    test("should replace {{alertCount}} with count", () => {
      const template: string = "Episode ({{alertCount}} alerts)";
      const alertCount: number = 5;
      const result: string = template.replace(
        /\{\{alertCount\}\}/g,
        alertCount.toString(),
      );
      expect(result).toBe("Episode (5 alerts)");
    });

    test("should preserve {{alertCount}} placeholder in preprocessed template", () => {
      let template: string = "{{alertTitle}} - {{alertCount}} alerts";

      // Preprocess: replace static variables only
      template = template.replace(/\{\{alertTitle\}\}/g, mockAlert.title!);

      // {{alertCount}} should still be present
      expect(template).toBe("High CPU Usage - {{alertCount}} alerts");
      expect(template).toContain("{{alertCount}}");
    });

    test("should render final title with dynamic values", () => {
      // Start with preprocessed template (static vars already replaced)
      const preprocessedTemplate: string =
        "High CPU Usage - {{alertCount}} alerts";
      const alertCount: number = 10;

      // Render dynamic values
      const finalTitle: string = preprocessedTemplate.replace(
        /\{\{alertCount\}\}/g,
        alertCount.toString(),
      );

      expect(finalTitle).toBe("High CPU Usage - 10 alerts");
    });
  });

  describe("Unknown Placeholder Handling", () => {
    test("should remove unknown placeholders", () => {
      let template: string = "{{alertTitle}} {{unknownVar}} Episode";
      template = template.replace(/\{\{alertTitle\}\}/g, mockAlert.title!);
      // Remove any remaining placeholders
      template = template.replace(/\{\{[^}]+\}\}/g, "");
      // Clean up extra spaces
      template = template.replace(/\s+/g, " ").trim();
      expect(template).toBe("High CPU Usage Episode");
    });
  });

  describe("Default Title Generation", () => {
    test("should use monitor name when no template provided", () => {
      const defaultTitle: string = `Alert Episode: ${mockAlert.monitor?.name || mockAlert.title || "Alert Episode"}`;
      expect(defaultTitle).toBe("Alert Episode: API Server");
    });

    test("should use alert title when no monitor", () => {
      // Create alert without monitor
      const alertNoMonitor: Alert = new Alert();
      alertNoMonitor._id = alertId.toString();
      alertNoMonitor.id = alertId;
      alertNoMonitor.title = "High CPU Usage";
      // monitor is intentionally not set

      const defaultTitle: string = `Alert Episode: ${alertNoMonitor.monitor?.name || alertNoMonitor.title || "Alert Episode"}`;
      expect(defaultTitle).toBe("Alert Episode: High CPU Usage");
    });

    test("should use generic title when no monitor and no alert title", () => {
      // Create minimal alert without monitor and title
      const alertMinimal: Alert = new Alert();
      alertMinimal._id = alertId.toString();
      alertMinimal.id = alertId;
      // monitor and title are intentionally not set

      const defaultTitle: string = `Alert Episode: ${alertMinimal.monitor?.name || alertMinimal.title || "Alert Episode"}`;
      expect(defaultTitle).toBe("Alert Episode: Alert Episode");
    });
  });
});

describe("AlertEpisode Template Storage", () => {
  test("should store titleTemplate for dynamic re-rendering", () => {
    const episode: AlertEpisode = new AlertEpisode();
    episode.titleTemplate = "High CPU Usage - {{alertCount}} alerts";
    expect(episode.titleTemplate).toBe(
      "High CPU Usage - {{alertCount}} alerts",
    );
  });

  test("should store descriptionTemplate for dynamic re-rendering", () => {
    const episode: AlertEpisode = new AlertEpisode();
    episode.descriptionTemplate =
      "Episode contains {{alertCount}} related alerts";
    expect(episode.descriptionTemplate).toBe(
      "Episode contains {{alertCount}} related alerts",
    );
  });

  test("should store both title and titleTemplate", () => {
    const episode: AlertEpisode = new AlertEpisode();
    episode.title = "High CPU Usage - 1 alerts";
    episode.titleTemplate = "High CPU Usage - {{alertCount}} alerts";

    expect(episode.title).toBe("High CPU Usage - 1 alerts");
    expect(episode.titleTemplate).toBe(
      "High CPU Usage - {{alertCount}} alerts",
    );
  });

  test("should re-render title from template when alert count changes", () => {
    const episode: AlertEpisode = new AlertEpisode();
    episode.titleTemplate = "High CPU Usage - {{alertCount}} alerts";
    episode.alertCount = 1;
    episode.title = episode.titleTemplate.replace(
      /\{\{alertCount\}\}/g,
      episode.alertCount.toString(),
    );

    expect(episode.title).toBe("High CPU Usage - 1 alerts");

    // Simulate adding more alerts
    episode.alertCount = 5;
    episode.title = episode.titleTemplate.replace(
      /\{\{alertCount\}\}/g,
      episode.alertCount.toString(),
    );

    expect(episode.title).toBe("High CPU Usage - 5 alerts");
  });
});
