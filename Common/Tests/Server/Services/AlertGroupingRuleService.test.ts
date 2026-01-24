import AlertGroupingRule from "../../../Models/DatabaseModels/AlertGroupingRule";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import Label from "../../../Models/DatabaseModels/Label";
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test, beforeEach } from "@jest/globals";

describe("AlertGroupingRule Model", () => {
  let rule: AlertGroupingRule;

  beforeEach(() => {
    rule = new AlertGroupingRule();
  });

  describe("constructor", () => {
    test("should create a new AlertGroupingRule instance", () => {
      expect(rule).toBeInstanceOf(AlertGroupingRule);
    });

    test("should create AlertGroupingRule with an ID", () => {
      const id: ObjectID = ObjectID.generate();
      const ruleWithId: AlertGroupingRule = new AlertGroupingRule(id);
      expect(ruleWithId.id).toEqual(id);
    });
  });

  describe("Basic properties", () => {
    test("should set and get name correctly", () => {
      rule.name = "Critical Production Alerts";
      expect(rule.name).toBe("Critical Production Alerts");
    });

    test("should set and get description correctly", () => {
      rule.description = "Groups all critical alerts from production services";
      expect(rule.description).toBe(
        "Groups all critical alerts from production services",
      );
    });

    test("should set and get priority correctly", () => {
      rule.priority = 1;
      expect(rule.priority).toBe(1);
    });

    test("should set and get isEnabled correctly", () => {
      rule.isEnabled = true;
      expect(rule.isEnabled).toBe(true);

      rule.isEnabled = false;
      expect(rule.isEnabled).toBe(false);
    });

    test("should set and get projectId correctly", () => {
      const projectId: ObjectID = ObjectID.generate();
      rule.projectId = projectId;
      expect(rule.projectId).toEqual(projectId);
    });
  });

  describe("Match Criteria", () => {
    describe("Monitors", () => {
      test("should set and get monitors correctly", () => {
        const monitor1: Monitor = new Monitor();
        monitor1._id = ObjectID.generate().toString();
        const monitor2: Monitor = new Monitor();
        monitor2._id = ObjectID.generate().toString();

        rule.monitors = [monitor1, monitor2];
        expect(rule.monitors).toHaveLength(2);
        expect(rule.monitors).toContain(monitor1);
        expect(rule.monitors).toContain(monitor2);
      });

      test("should handle empty monitors array", () => {
        rule.monitors = [];
        expect(rule.monitors).toHaveLength(0);
      });
    });

    describe("Alert Severities", () => {
      test("should set and get alertSeverities correctly", () => {
        const severity: AlertSeverity = new AlertSeverity();
        severity._id = ObjectID.generate().toString();
        severity.name = "Critical";

        rule.alertSeverities = [severity];
        expect(rule.alertSeverities).toHaveLength(1);
        expect(rule.alertSeverities![0]).toBe(severity);
      });
    });

    describe("Labels", () => {
      test("should set and get monitorLabels correctly", () => {
        const label: Label = new Label();
        label._id = ObjectID.generate().toString();
        label.name = "production";

        rule.monitorLabels = [label];
        expect(rule.monitorLabels).toHaveLength(1);
        expect(rule.monitorLabels![0]).toBe(label);
      });
    });

    describe("Pattern Matching", () => {
      test("should set and get alertTitlePattern correctly", () => {
        rule.alertTitlePattern = "CPU.*High";
        expect(rule.alertTitlePattern).toBe("CPU.*High");
      });

      test("should set and get alertDescriptionPattern correctly", () => {
        rule.alertDescriptionPattern = "memory.*exceeded";
        expect(rule.alertDescriptionPattern).toBe("memory.*exceeded");
      });

      test("should set and get monitorNamePattern correctly", () => {
        rule.monitorNamePattern = "prod-.*-api";
        expect(rule.monitorNamePattern).toBe("prod-.*-api");
      });

      test("should set and get monitorDescriptionPattern correctly", () => {
        rule.monitorDescriptionPattern = ".*production.*";
        expect(rule.monitorDescriptionPattern).toBe(".*production.*");
      });
    });
  });

  describe("Group By settings", () => {
    test("should set and get groupByMonitor correctly", () => {
      rule.groupByMonitor = true;
      expect(rule.groupByMonitor).toBe(true);
    });

    test("should set and get groupBySeverity correctly", () => {
      rule.groupBySeverity = true;
      expect(rule.groupBySeverity).toBe(true);
    });

    test("should set and get groupByAlertTitle correctly", () => {
      rule.groupByAlertTitle = true;
      expect(rule.groupByAlertTitle).toBe(true);
    });

    test("should handle all groupBy options as false", () => {
      rule.groupByMonitor = false;
      rule.groupBySeverity = false;
      rule.groupByAlertTitle = false;

      expect(rule.groupByMonitor).toBe(false);
      expect(rule.groupBySeverity).toBe(false);
      expect(rule.groupByAlertTitle).toBe(false);
    });

    test("should handle combination of groupBy options", () => {
      rule.groupByMonitor = true;
      rule.groupBySeverity = true;
      rule.groupByAlertTitle = false;

      expect(rule.groupByMonitor).toBe(true);
      expect(rule.groupBySeverity).toBe(true);
      expect(rule.groupByAlertTitle).toBe(false);
    });
  });

  describe("Time settings", () => {
    test("should set and get enableTimeWindow correctly", () => {
      rule.enableTimeWindow = true;
      expect(rule.enableTimeWindow).toBe(true);
    });

    test("should set and get timeWindowMinutes correctly", () => {
      rule.timeWindowMinutes = 30;
      expect(rule.timeWindowMinutes).toBe(30);
    });

    test("should set and get enableReopenWindow correctly", () => {
      rule.enableReopenWindow = true;
      expect(rule.enableReopenWindow).toBe(true);
    });

    test("should set and get reopenWindowMinutes correctly", () => {
      rule.reopenWindowMinutes = 60;
      expect(rule.reopenWindowMinutes).toBe(60);
    });

    test("should set and get enableInactivityTimeout correctly", () => {
      rule.enableInactivityTimeout = true;
      expect(rule.enableInactivityTimeout).toBe(true);
    });

    test("should set and get inactivityTimeoutMinutes correctly", () => {
      rule.inactivityTimeoutMinutes = 120;
      expect(rule.inactivityTimeoutMinutes).toBe(120);
    });

    test("should set and get enableResolveDelay correctly", () => {
      rule.enableResolveDelay = true;
      expect(rule.enableResolveDelay).toBe(true);
    });

    test("should set and get resolveDelayMinutes correctly", () => {
      rule.resolveDelayMinutes = 15;
      expect(rule.resolveDelayMinutes).toBe(15);
    });
  });

  describe("Episode Template settings", () => {
    test("should set and get episodeTitleTemplate correctly", () => {
      rule.episodeTitleTemplate = "{{alertSeverity}}: {{alertTitle}}";
      expect(rule.episodeTitleTemplate).toBe("{{alertSeverity}}: {{alertTitle}}");
    });

    test("should set and get episodeDescriptionTemplate correctly", () => {
      rule.episodeDescriptionTemplate =
        "Episode with {{alertCount}} alerts from {{monitorName}}";
      expect(rule.episodeDescriptionTemplate).toBe(
        "Episode with {{alertCount}} alerts from {{monitorName}}",
      );
    });

    test("should handle template with all supported variables", () => {
      rule.episodeTitleTemplate =
        "{{alertSeverity}} on {{monitorName}}: {{alertTitle}} ({{alertCount}})";
      expect(rule.episodeTitleTemplate).toBe(
        "{{alertSeverity}} on {{monitorName}}: {{alertTitle}} ({{alertCount}})",
      );
    });
  });

  describe("Ownership settings", () => {
    test("should set and get defaultAssignToUser correctly", () => {
      const user: User = new User();
      user._id = ObjectID.generate().toString();

      rule.defaultAssignToUser = user;
      expect(rule.defaultAssignToUser).toBe(user);
    });

    test("should set and get defaultAssignToUserId correctly", () => {
      const userId: ObjectID = ObjectID.generate();
      rule.defaultAssignToUserId = userId;
      expect(rule.defaultAssignToUserId).toEqual(userId);
    });

    test("should set and get defaultAssignToTeam correctly", () => {
      const team: Team = new Team();
      team._id = ObjectID.generate().toString();

      rule.defaultAssignToTeam = team;
      expect(rule.defaultAssignToTeam).toBe(team);
    });

    test("should set and get defaultAssignToTeamId correctly", () => {
      const teamId: ObjectID = ObjectID.generate();
      rule.defaultAssignToTeamId = teamId;
      expect(rule.defaultAssignToTeamId).toEqual(teamId);
    });
  });

  describe("On-Call Policy settings", () => {
    test("should set and get onCallDutyPolicies correctly", () => {
      const policy1: OnCallDutyPolicy = new OnCallDutyPolicy();
      policy1._id = ObjectID.generate().toString();
      const policy2: OnCallDutyPolicy = new OnCallDutyPolicy();
      policy2._id = ObjectID.generate().toString();

      rule.onCallDutyPolicies = [policy1, policy2];
      expect(rule.onCallDutyPolicies).toHaveLength(2);
    });

    test("should handle empty onCallDutyPolicies array", () => {
      rule.onCallDutyPolicies = [];
      expect(rule.onCallDutyPolicies).toHaveLength(0);
    });
  });

  describe("Full AlertGroupingRule", () => {
    test("should handle complete rule configuration", () => {
      const id: ObjectID = ObjectID.generate();
      const projectId: ObjectID = ObjectID.generate();
      const userId: ObjectID = ObjectID.generate();
      const teamId: ObjectID = ObjectID.generate();

      const fullRule: AlertGroupingRule = new AlertGroupingRule(id);
      fullRule.projectId = projectId;
      fullRule.name = "Production Critical Alerts";
      fullRule.description = "Groups critical alerts from production";
      fullRule.priority = 1;
      fullRule.isEnabled = true;

      // Match criteria
      fullRule.alertTitlePattern = ".*critical.*";
      fullRule.alertDescriptionPattern = ".*production.*";

      // Group by
      fullRule.groupByMonitor = true;
      fullRule.groupBySeverity = true;
      fullRule.groupByAlertTitle = false;

      // Time settings
      fullRule.enableTimeWindow = true;
      fullRule.timeWindowMinutes = 30;
      fullRule.enableReopenWindow = true;
      fullRule.reopenWindowMinutes = 60;
      fullRule.enableInactivityTimeout = true;
      fullRule.inactivityTimeoutMinutes = 120;
      fullRule.enableResolveDelay = true;
      fullRule.resolveDelayMinutes = 15;

      // Templates
      fullRule.episodeTitleTemplate = "{{alertSeverity}} Episode: {{alertTitle}}";
      fullRule.episodeDescriptionTemplate = "{{alertCount}} related alerts";

      // Ownership
      fullRule.defaultAssignToUserId = userId;
      fullRule.defaultAssignToTeamId = teamId;

      // Verify all fields
      expect(fullRule.id).toEqual(id);
      expect(fullRule.projectId).toEqual(projectId);
      expect(fullRule.name).toBe("Production Critical Alerts");
      expect(fullRule.description).toBe("Groups critical alerts from production");
      expect(fullRule.priority).toBe(1);
      expect(fullRule.isEnabled).toBe(true);
      expect(fullRule.alertTitlePattern).toBe(".*critical.*");
      expect(fullRule.groupByMonitor).toBe(true);
      expect(fullRule.groupBySeverity).toBe(true);
      expect(fullRule.enableTimeWindow).toBe(true);
      expect(fullRule.timeWindowMinutes).toBe(30);
      expect(fullRule.episodeTitleTemplate).toBe(
        "{{alertSeverity}} Episode: {{alertTitle}}",
      );
      expect(fullRule.defaultAssignToUserId).toEqual(userId);
    });

    test("should create rule with minimal configuration", () => {
      const minRule: AlertGroupingRule = new AlertGroupingRule();
      minRule.name = "Basic Rule";
      minRule.priority = 10;
      minRule.isEnabled = true;

      expect(minRule.name).toBe("Basic Rule");
      expect(minRule.priority).toBe(10);
      expect(minRule.isEnabled).toBe(true);

      // All other fields should be undefined or default
      expect(minRule.monitors).toBeUndefined();
      expect(minRule.alertSeverities).toBeUndefined();
      expect(minRule.alertTitlePattern).toBeUndefined();
      expect(minRule.groupByMonitor).toBeUndefined();
      expect(minRule.episodeTitleTemplate).toBeUndefined();
    });
  });

  describe("Priority ordering", () => {
    test("should correctly compare priority values", () => {
      const rule1: AlertGroupingRule = new AlertGroupingRule();
      rule1.priority = 1;

      const rule2: AlertGroupingRule = new AlertGroupingRule();
      rule2.priority = 10;

      const rule3: AlertGroupingRule = new AlertGroupingRule();
      rule3.priority = 5;

      const rules: AlertGroupingRule[] = [rule2, rule3, rule1];
      rules.sort((a, b) => {
        return (a.priority || 0) - (b.priority || 0);
      });

      expect(rules[0]!.priority).toBe(1);
      expect(rules[1]!.priority).toBe(5);
      expect(rules[2]!.priority).toBe(10);
    });
  });
});
