# Alert Engine Design Document

## Executive Summary

This document outlines the design for a comprehensive Alert Engine for OneUptime that provides enterprise-grade alert management capabilities including grouping, correlation, noise reduction, suppression, deduplication, and throttling - comparable to industry leaders like Splunk ITSI.

## Table of Contents

1. [Current State Analysis](#current-state-analysis)
2. [Feature Overview](#feature-overview)
3. [Data Models](#data-models)
4. [Core Components](#core-components)
5. [Alert Processing Pipeline](#alert-processing-pipeline)
6. [API Design](#api-design)
7. [UI/UX Considerations](#uiux-considerations)
8. [Implementation Phases](#implementation-phases)
9. [Performance Considerations](#performance-considerations)
10. [Migration Strategy](#migration-strategy)

---

## Current State Analysis

### Existing Alert Architecture

OneUptime currently has a functional alert system with the following capabilities:

**What Exists:**
- Alert model with title, description, severity, state machine
- AlertState with customizable states (Created, Acknowledged, Resolved)
- AlertStateTimeline for audit trail
- AlertSeverity for customizable severity levels
- Basic deduplication by monitor criteria (one active alert per criteria)
- On-call integration for escalation
- Workspace notifications (Slack, Teams)
- Alert metrics tracking

**Gaps to Address:**
- No alert grouping/correlation into episodes
- No configurable suppression policies
- No time-window based deduplication
- No throttling/rate limiting
- No noise reduction through intelligent grouping
- No fingerprinting for alert similarity detection
- No maintenance windows for suppression

### Key Files Reference

| Component | File Location | Lines |
|-----------|--------------|-------|
| Alert Model | `/Common/Models/DatabaseModels/Alert.ts` | 1,075 |
| Alert Service | `/Common/Server/Services/AlertService.ts` | 1,523 |
| Alert State | `/Common/Models/DatabaseModels/AlertState.ts` | 513 |
| Alert Timeline | `/Common/Models/DatabaseModels/AlertStateTimeline.ts` | 545 |
| Monitor Alert | `/Common/Server/Utils/Monitor/MonitorAlert.ts` | 342 |

---

## Feature Overview

### 1. Alert Grouping & Correlation (Episodes)

Group related alerts into **Episodes** - logical containers that represent a single incident or issue affecting multiple components.

**Capabilities:**
- Automatic grouping based on configurable rules
- Time-window based grouping (alerts within X minutes grouped together)
- Field-based grouping (same host, service, datacenter)
- AI-assisted correlation (future enhancement)
- Manual episode management (merge, split)

### 2. Noise Reduction

Reduce alert fatigue through intelligent alert management.

**Capabilities:**
- Deduplication within configurable time windows
- Alert fingerprinting for similarity detection
- Adaptive thresholds based on historical patterns
- Storm detection when alert volume spikes

### 3. Alert Suppression

Temporarily or permanently suppress alerts based on rules.

**Capabilities:**
- Time-based suppression (maintenance windows)
- Condition-based suppression (suppress when criteria matches)
- Source-based suppression (suppress from specific monitors/probes)
- Suppression groups (suppress related alert types together)

### 4. Alert Throttling

Rate limit alert creation and notifications.

**Capabilities:**
- Per-field throttling (one alert per host per hour)
- Global throttling (max alerts per time period)
- Notification throttling (limit notification frequency)
- Burst detection and handling

### 5. Alert Deduplication

Prevent duplicate alerts from being created.

**Capabilities:**
- Fingerprint-based deduplication
- Content-based deduplication
- Configurable deduplication windows
- Deduplication counters (track suppressed duplicates)

---

## Data Models

### AlertGroupingRule

Configures how alerts are grouped into episodes.

```typescript
interface AlertGroupingRule {
  id: ObjectID;
  projectId: ObjectID;
  name: string;
  description?: string;
  isEnabled: boolean;

  // Matching criteria - which alerts does this rule apply to?
  matchCriteria: {
    severities?: ObjectID[];           // Match specific severities
    monitors?: ObjectID[];             // Match specific monitors
    labels?: ObjectID[];               // Match specific labels
    titlePattern?: string;             // Regex pattern for title
    descriptionPattern?: string;       // Regex pattern for description
    customFieldMatches?: Record<string, string>; // Custom field matching
  };

  // Grouping configuration
  groupingConfig: {
    type: 'time_window' | 'field_based' | 'smart';

    // Time window grouping
    timeWindowMinutes?: number;        // Group alerts within this window

    // Field-based grouping
    groupByFields?: string[];          // Fields to group by (e.g., ['monitorId', 'severity'])

    // Smart grouping (ML-based)
    similarityThreshold?: number;      // 0-1, how similar alerts must be
  };

  // Episode configuration
  episodeConfig: {
    titleTemplate?: string;            // Template for episode title
    autoResolveWhenEmpty: boolean;     // Resolve episode when all alerts resolved
    breakAfterMinutesInactive: number; // Break episode after inactivity
  };

  // Priority (lower = higher priority)
  priority: number;

  createdAt: Date;
  updatedAt: Date;
}
```

### AlertEpisode

Container for grouped alerts.

```typescript
interface AlertEpisode {
  id: ObjectID;
  projectId: ObjectID;

  // Episode identification
  episodeNumber: number;               // Auto-incrementing per project
  title: string;
  description?: string;

  // Grouping rule that created this episode
  groupingRuleId?: ObjectID;

  // Episode state
  state: 'active' | 'acknowledged' | 'resolved';
  severity: ObjectID;                  // Highest severity of contained alerts

  // Timing
  startedAt: Date;                     // First alert timestamp
  lastActivityAt: Date;                // Last alert added/updated
  acknowledgedAt?: Date;
  resolvedAt?: Date;

  // Metrics
  alertCount: number;
  uniqueMonitorCount: number;

  // Assignment
  ownerUsers?: ObjectID[];
  ownerTeams?: ObjectID[];

  // Root cause analysis
  rootCause?: string;

  createdAt: Date;
  updatedAt: Date;
}
```

### AlertEpisodeMember

Links alerts to episodes.

```typescript
interface AlertEpisodeMember {
  id: ObjectID;
  projectId: ObjectID;
  episodeId: ObjectID;
  alertId: ObjectID;

  // How this alert was added
  addedBy: 'rule' | 'manual' | 'correlation';
  addedAt: Date;

  // Grouping metadata
  groupingRuleId?: ObjectID;
  similarityScore?: number;            // If added by correlation
}
```

### AlertSuppressionRule

Configures alert suppression.

```typescript
interface AlertSuppressionRule {
  id: ObjectID;
  projectId: ObjectID;
  name: string;
  description?: string;
  isEnabled: boolean;

  // Suppression type
  type: 'maintenance_window' | 'condition_based' | 'rate_limit';

  // Matching criteria - which alerts to suppress
  matchCriteria: {
    severities?: ObjectID[];
    monitors?: ObjectID[];
    labels?: ObjectID[];
    titlePattern?: string;
    customFieldMatches?: Record<string, string>;
  };

  // Maintenance window configuration
  maintenanceWindow?: {
    startTime: Date;
    endTime: Date;
    timezone: string;
    isRecurring: boolean;
    recurrenceRule?: string;           // RRULE format
  };

  // Condition-based suppression
  condition?: {
    // Suppress when another alert is active
    whenAlertActiveWithLabels?: ObjectID[];
    // Suppress when monitor is in specific state
    whenMonitorInState?: ObjectID[];
  };

  // Rate limit configuration
  rateLimit?: {
    maxAlerts: number;
    timeWindowMinutes: number;
    groupByFields?: string[];          // Rate limit per field combination
  };

  // Actions
  action: 'suppress_creation' | 'suppress_notifications' | 'both';

  // Suppression group - alerts in same group throttled together
  suppressionGroupId?: ObjectID;

  createdAt: Date;
  updatedAt: Date;
}
```

### AlertSuppressionGroup

Groups related suppression rules.

```typescript
interface AlertSuppressionGroup {
  id: ObjectID;
  projectId: ObjectID;
  name: string;
  description?: string;

  // When one alert in group triggers, all are throttled
  throttleMinutes: number;

  createdAt: Date;
  updatedAt: Date;
}
```

### AlertFingerprint

Stores computed fingerprints for deduplication.

```typescript
interface AlertFingerprint {
  id: ObjectID;
  projectId: ObjectID;

  // The fingerprint hash
  fingerprint: string;

  // Fields used to compute fingerprint
  fingerprintFields: string[];

  // Reference to the canonical alert
  canonicalAlertId: ObjectID;

  // Deduplication stats
  duplicateCount: number;
  lastDuplicateAt: Date;

  // Time window for deduplication
  windowStartAt: Date;
  windowEndAt: Date;

  createdAt: Date;
  updatedAt: Date;
}
```

### AlertThrottleState

Tracks current throttle state.

```typescript
interface AlertThrottleState {
  id: ObjectID;
  projectId: ObjectID;

  // What is being throttled
  throttleKey: string;                 // Computed from throttle configuration

  // Throttle configuration reference
  suppressionRuleId: ObjectID;

  // Current state
  alertCount: number;
  firstAlertAt: Date;
  lastAlertAt: Date;
  windowExpiresAt: Date;

  // Is currently throttling?
  isThrottling: boolean;

  createdAt: Date;
  updatedAt: Date;
}
```

### AlertMetric (Enhancement to existing)

Enhanced metrics for noise reduction analysis.

```typescript
interface AlertMetricEnhancement {
  // Existing fields...

  // New fields for noise analysis
  wasSupprressed: boolean;
  suppressionRuleId?: ObjectID;
  wasDeduplicated: boolean;
  deduplicationFingerprintId?: ObjectID;
  episodeId?: ObjectID;
  correlationScore?: number;
}
```

### Database Schema Additions to Alert Model

```typescript
// Add to existing Alert model
interface AlertEnhancements {
  // Fingerprinting
  fingerprint?: string;                // Computed fingerprint hash
  fingerprintFields?: string[];        // Fields used for fingerprint

  // Deduplication
  duplicateCount: number;              // How many duplicates were suppressed
  lastDuplicateAt?: Date;

  // Episode membership
  episodeId?: ObjectID;                // Current episode (if grouped)

  // Suppression tracking
  wasSuppressionEvaluated: boolean;
  matchedSuppressionRuleIds?: ObjectID[];

  // Source enrichment
  sourceFingerprint?: string;          // Fingerprint of the source (monitor+criteria)
}
```

---

## Core Components

### 1. Alert Processing Pipeline

```
                                    ┌─────────────────────┐
                                    │   Alert Source      │
                                    │  (Monitor/Manual)   │
                                    └──────────┬──────────┘
                                               │
                                               ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                           ALERT PROCESSING PIPELINE                          │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────┐   ┌──────────────┐   ┌──────────────┐   ┌───────────────┐  │
│  │ Fingerprint │──▶│ Deduplication│──▶│  Suppression │──▶│   Grouping    │  │
│  │  Generator  │   │    Engine    │   │    Engine    │   │    Engine     │  │
│  └─────────────┘   └──────────────┘   └──────────────┘   └───────────────┘  │
│         │                 │                  │                   │          │
│         │                 │                  │                   │          │
│         ▼                 ▼                  ▼                   ▼          │
│  ┌─────────────┐   ┌──────────────┐   ┌──────────────┐   ┌───────────────┐  │
│  │ Fingerprint │   │  Duplicate   │   │  Suppressed  │   │   Episode     │  │
│  │   Cache     │   │   Counter    │   │    Event     │   │   Manager     │  │
│  └─────────────┘   └──────────────┘   └──────────────┘   └───────────────┘  │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
                                               │
                                               ▼
                                    ┌─────────────────────┐
                                    │    Alert Created    │
                                    │    (or Suppressed)  │
                                    └──────────┬──────────┘
                                               │
                                               ▼
                                    ┌─────────────────────┐
                                    │  Notification &     │
                                    │  On-Call Engine     │
                                    └─────────────────────┘
```

### 2. Fingerprint Generator

Computes unique fingerprints for alerts to enable deduplication.

```typescript
// Location: /Common/Server/Utils/Alert/FingerprintGenerator.ts

interface FingerprintConfig {
  fields: string[];                    // Fields to include in fingerprint
  normalizeStrings: boolean;           // Lowercase, trim whitespace
  ignoreTimestamps: boolean;           // Ignore time-varying fields
}

class FingerprintGenerator {
  // Default fingerprint fields
  static DEFAULT_FIELDS = [
    'monitorId',
    'createdCriteriaId',
    'alertSeverityId',
    'title'
  ];

  /**
   * Generate a fingerprint for an alert
   */
  static generate(alert: Alert, config?: FingerprintConfig): string {
    const fields = config?.fields || this.DEFAULT_FIELDS;
    const values: string[] = [];

    for (const field of fields) {
      let value = this.getFieldValue(alert, field);

      if (config?.normalizeStrings && typeof value === 'string') {
        value = value.toLowerCase().trim();
      }

      values.push(`${field}:${value}`);
    }

    return crypto.createHash('sha256')
      .update(values.join('|'))
      .digest('hex');
  }

  /**
   * Generate a similarity hash for correlation
   */
  static generateSimilarityVector(alert: Alert): number[] {
    // Extract features for ML-based correlation
    // Title tokens, severity, monitor type, time of day, etc.
  }
}
```

### 3. Deduplication Engine

Prevents duplicate alerts within configurable time windows.

```typescript
// Location: /Common/Server/Utils/Alert/DeduplicationEngine.ts

interface DeduplicationResult {
  isDuplicate: boolean;
  canonicalAlertId?: ObjectID;
  duplicateCount?: number;
}

class DeduplicationEngine {
  /**
   * Check if an alert is a duplicate
   */
  async checkDuplicate(
    alert: Partial<Alert>,
    projectId: ObjectID,
    windowMinutes: number = 60
  ): Promise<DeduplicationResult> {
    const fingerprint = FingerprintGenerator.generate(alert as Alert);

    // Check fingerprint cache/database
    const existingFingerprint = await AlertFingerprintService.findOne({
      query: {
        projectId,
        fingerprint,
        windowEndAt: QueryHelper.greaterThan(new Date())
      }
    });

    if (existingFingerprint) {
      // Increment duplicate counter
      await AlertFingerprintService.updateOneById({
        id: existingFingerprint.id,
        data: {
          duplicateCount: existingFingerprint.duplicateCount + 1,
          lastDuplicateAt: new Date()
        }
      });

      // Update canonical alert's duplicate count
      await AlertService.updateOneById({
        id: existingFingerprint.canonicalAlertId,
        data: {
          duplicateCount: (existingFingerprint.duplicateCount || 0) + 1,
          lastDuplicateAt: new Date()
        }
      });

      return {
        isDuplicate: true,
        canonicalAlertId: existingFingerprint.canonicalAlertId,
        duplicateCount: existingFingerprint.duplicateCount + 1
      };
    }

    return { isDuplicate: false };
  }

  /**
   * Register a new alert fingerprint
   */
  async registerFingerprint(
    alert: Alert,
    windowMinutes: number = 60
  ): Promise<void> {
    const fingerprint = FingerprintGenerator.generate(alert);
    const now = new Date();

    await AlertFingerprintService.create({
      data: {
        projectId: alert.projectId,
        fingerprint,
        fingerprintFields: FingerprintGenerator.DEFAULT_FIELDS,
        canonicalAlertId: alert.id,
        duplicateCount: 0,
        windowStartAt: now,
        windowEndAt: new Date(now.getTime() + windowMinutes * 60 * 1000)
      }
    });
  }
}
```

### 4. Suppression Engine

Evaluates alerts against suppression rules.

```typescript
// Location: /Common/Server/Utils/Alert/SuppressionEngine.ts

interface SuppressionResult {
  shouldSuppress: boolean;
  action: 'suppress_creation' | 'suppress_notifications' | 'none';
  matchedRules: AlertSuppressionRule[];
  reason?: string;
}

class SuppressionEngine {
  /**
   * Evaluate suppression rules for an alert
   */
  async evaluate(
    alert: Partial<Alert>,
    projectId: ObjectID
  ): Promise<SuppressionResult> {
    // Get all enabled suppression rules for project
    const rules = await AlertSuppressionRuleService.findBy({
      query: { projectId, isEnabled: true },
      sort: { priority: SortOrder.Ascending }
    });

    const matchedRules: AlertSuppressionRule[] = [];
    let shouldSuppress = false;
    let action: SuppressionResult['action'] = 'none';

    for (const rule of rules) {
      if (await this.matchesRule(alert, rule)) {
        matchedRules.push(rule);

        // Check if rule is currently active
        if (await this.isRuleActive(rule)) {
          shouldSuppress = true;

          // Most restrictive action wins
          if (rule.action === 'both' || action === 'both') {
            action = 'both';
          } else if (rule.action === 'suppress_creation') {
            action = 'suppress_creation';
          } else if (action !== 'suppress_creation') {
            action = 'suppress_notifications';
          }
        }
      }
    }

    return {
      shouldSuppress,
      action,
      matchedRules,
      reason: this.buildSuppressionReason(matchedRules)
    };
  }

  /**
   * Check if alert matches rule criteria
   */
  private async matchesRule(
    alert: Partial<Alert>,
    rule: AlertSuppressionRule
  ): Promise<boolean> {
    const criteria = rule.matchCriteria;

    // Check severity
    if (criteria.severities?.length &&
        !criteria.severities.includes(alert.alertSeverityId)) {
      return false;
    }

    // Check monitors
    if (criteria.monitors?.length &&
        !criteria.monitors.includes(alert.monitorId)) {
      return false;
    }

    // Check labels
    if (criteria.labels?.length) {
      const alertLabels = alert.labels || [];
      if (!criteria.labels.some(l => alertLabels.includes(l))) {
        return false;
      }
    }

    // Check title pattern
    if (criteria.titlePattern) {
      const regex = new RegExp(criteria.titlePattern, 'i');
      if (!regex.test(alert.title || '')) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if rule is currently active (e.g., within maintenance window)
   */
  private async isRuleActive(rule: AlertSuppressionRule): Promise<boolean> {
    if (rule.type === 'maintenance_window' && rule.maintenanceWindow) {
      const now = new Date();
      const window = rule.maintenanceWindow;

      if (window.isRecurring) {
        // Evaluate recurrence rule
        return this.evaluateRecurrence(window, now);
      }

      return now >= window.startTime && now <= window.endTime;
    }

    if (rule.type === 'rate_limit' && rule.rateLimit) {
      return await this.checkRateLimit(rule);
    }

    if (rule.type === 'condition_based' && rule.condition) {
      return await this.evaluateCondition(rule.condition);
    }

    return true;
  }

  /**
   * Check rate limit
   */
  private async checkRateLimit(rule: AlertSuppressionRule): Promise<boolean> {
    const throttleKey = this.computeThrottleKey(rule);

    const state = await AlertThrottleStateService.findOne({
      query: {
        throttleKey,
        suppressionRuleId: rule.id,
        windowExpiresAt: QueryHelper.greaterThan(new Date())
      }
    });

    if (state && state.alertCount >= rule.rateLimit!.maxAlerts) {
      return true; // Should suppress
    }

    return false;
  }
}
```

### 5. Grouping Engine

Groups alerts into episodes.

```typescript
// Location: /Common/Server/Utils/Alert/GroupingEngine.ts

interface GroupingResult {
  shouldGroup: boolean;
  episodeId?: ObjectID;
  isNewEpisode: boolean;
  groupingRule?: AlertGroupingRule;
}

class GroupingEngine {
  /**
   * Find or create an episode for an alert
   */
  async findOrCreateEpisode(
    alert: Alert,
    projectId: ObjectID
  ): Promise<GroupingResult> {
    // Get matching grouping rules
    const rules = await AlertGroupingRuleService.findBy({
      query: { projectId, isEnabled: true },
      sort: { priority: SortOrder.Ascending }
    });

    for (const rule of rules) {
      if (await this.matchesRule(alert, rule)) {
        const episode = await this.findMatchingEpisode(alert, rule);

        if (episode) {
          // Add alert to existing episode
          await this.addAlertToEpisode(alert, episode, rule);

          return {
            shouldGroup: true,
            episodeId: episode.id,
            isNewEpisode: false,
            groupingRule: rule
          };
        }

        // Create new episode
        const newEpisode = await this.createEpisode(alert, rule);

        return {
          shouldGroup: true,
          episodeId: newEpisode.id,
          isNewEpisode: true,
          groupingRule: rule
        };
      }
    }

    return { shouldGroup: false, isNewEpisode: false };
  }

  /**
   * Find a matching episode for an alert based on grouping rule
   */
  private async findMatchingEpisode(
    alert: Alert,
    rule: AlertGroupingRule
  ): Promise<AlertEpisode | null> {
    const config = rule.groupingConfig;

    if (config.type === 'time_window') {
      // Find active episode within time window
      const windowStart = new Date(
        Date.now() - (config.timeWindowMinutes || 60) * 60 * 1000
      );

      return await AlertEpisodeService.findOne({
        query: {
          projectId: alert.projectId,
          groupingRuleId: rule.id,
          state: QueryHelper.notEquals('resolved'),
          lastActivityAt: QueryHelper.greaterThan(windowStart)
        }
      });
    }

    if (config.type === 'field_based') {
      // Find episode with matching field values
      const groupKey = this.computeGroupKey(alert, config.groupByFields || []);

      // Query episodes that have alerts with same group key
      return await this.findEpisodeByGroupKey(alert.projectId, rule.id, groupKey);
    }

    if (config.type === 'smart') {
      // Find episode with similar alerts
      return await this.findSimilarEpisode(alert, config.similarityThreshold || 0.8);
    }

    return null;
  }

  /**
   * Create a new episode
   */
  private async createEpisode(
    alert: Alert,
    rule: AlertGroupingRule
  ): Promise<AlertEpisode> {
    const episodeNumber = await this.getNextEpisodeNumber(alert.projectId);

    const episode = await AlertEpisodeService.create({
      data: {
        projectId: alert.projectId,
        episodeNumber,
        title: this.generateEpisodeTitle(alert, rule),
        groupingRuleId: rule.id,
        state: 'active',
        severity: alert.alertSeverityId,
        startedAt: new Date(),
        lastActivityAt: new Date(),
        alertCount: 1,
        uniqueMonitorCount: 1
      }
    });

    // Create membership record
    await AlertEpisodeMemberService.create({
      data: {
        projectId: alert.projectId,
        episodeId: episode.id,
        alertId: alert.id,
        addedBy: 'rule',
        addedAt: new Date(),
        groupingRuleId: rule.id
      }
    });

    return episode;
  }

  /**
   * Add an alert to an existing episode
   */
  private async addAlertToEpisode(
    alert: Alert,
    episode: AlertEpisode,
    rule: AlertGroupingRule
  ): Promise<void> {
    // Create membership
    await AlertEpisodeMemberService.create({
      data: {
        projectId: alert.projectId,
        episodeId: episode.id,
        alertId: alert.id,
        addedBy: 'rule',
        addedAt: new Date(),
        groupingRuleId: rule.id
      }
    });

    // Update episode
    await AlertEpisodeService.updateOneById({
      id: episode.id,
      data: {
        lastActivityAt: new Date(),
        alertCount: episode.alertCount + 1,
        // Update severity if new alert is higher severity
        severity: await this.getHighestSeverity(episode.id)
      }
    });

    // Update alert with episode reference
    await AlertService.updateOneById({
      id: alert.id,
      data: { episodeId: episode.id }
    });
  }
}
```

### 6. Alert Storm Detector

Detects when alert volume exceeds normal patterns.

```typescript
// Location: /Common/Server/Utils/Alert/StormDetector.ts

interface StormStatus {
  isStorm: boolean;
  currentRate: number;
  normalRate: number;
  multiplier: number;
  affectedMonitors?: ObjectID[];
}

class AlertStormDetector {
  /**
   * Check if currently in an alert storm
   */
  async checkStormStatus(projectId: ObjectID): Promise<StormStatus> {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Get current hour's alert count
    const currentCount = await AlertService.count({
      query: {
        projectId,
        createdAt: QueryHelper.greaterThan(oneHourAgo)
      }
    });

    // Get historical average (last 24 hours, excluding current hour)
    const historicalCount = await AlertService.count({
      query: {
        projectId,
        createdAt: QueryHelper.between(oneDayAgo, oneHourAgo)
      }
    });

    const normalRate = historicalCount / 23; // Avg per hour over 23 hours
    const currentRate = currentCount;
    const multiplier = normalRate > 0 ? currentRate / normalRate : currentRate;

    // Storm threshold: 3x normal rate or absolute threshold
    const isStorm = multiplier >= 3 || currentRate >= 100;

    return {
      isStorm,
      currentRate,
      normalRate,
      multiplier,
      affectedMonitors: isStorm ?
        await this.getTopAlertingMonitors(projectId, oneHourAgo) :
        undefined
    };
  }

  /**
   * Get monitors generating the most alerts
   */
  private async getTopAlertingMonitors(
    projectId: ObjectID,
    since: Date
  ): Promise<ObjectID[]> {
    // Aggregate alerts by monitor
    const result = await AlertService.aggregate({
      pipeline: [
        { $match: { projectId, createdAt: { $gte: since } } },
        { $group: { _id: '$monitorId', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]
    });

    return result.map(r => r._id);
  }
}
```

### 7. Alert Processing Service

Main orchestrator that ties all components together.

```typescript
// Location: /Common/Server/Services/AlertProcessingService.ts

interface ProcessingResult {
  alertId?: ObjectID;
  status: 'created' | 'deduplicated' | 'suppressed' | 'grouped';
  episodeId?: ObjectID;
  duplicateOf?: ObjectID;
  suppressionReason?: string;
}

class AlertProcessingService {
  private deduplicationEngine: DeduplicationEngine;
  private suppressionEngine: SuppressionEngine;
  private groupingEngine: GroupingEngine;
  private stormDetector: AlertStormDetector;

  /**
   * Process an incoming alert through the full pipeline
   */
  async processAlert(
    alertData: Partial<Alert>,
    projectId: ObjectID
  ): Promise<ProcessingResult> {
    // Step 1: Generate fingerprint
    const fingerprint = FingerprintGenerator.generate(alertData as Alert);
    alertData.fingerprint = fingerprint;

    // Step 2: Check for storm conditions
    const stormStatus = await this.stormDetector.checkStormStatus(projectId);
    if (stormStatus.isStorm) {
      // Log storm detection, potentially notify admins
      await this.logStormEvent(projectId, stormStatus);
    }

    // Step 3: Deduplication check
    const dedupeResult = await this.deduplicationEngine.checkDuplicate(
      alertData,
      projectId,
      60 // Default 60-minute window
    );

    if (dedupeResult.isDuplicate) {
      return {
        status: 'deduplicated',
        duplicateOf: dedupeResult.canonicalAlertId
      };
    }

    // Step 4: Suppression check
    const suppressionResult = await this.suppressionEngine.evaluate(
      alertData,
      projectId
    );

    if (suppressionResult.shouldSuppress &&
        suppressionResult.action === 'suppress_creation') {
      // Log suppressed alert for metrics
      await this.logSuppressedAlert(alertData, suppressionResult);

      return {
        status: 'suppressed',
        suppressionReason: suppressionResult.reason
      };
    }

    // Step 5: Create the alert
    alertData.wasSuppressionEvaluated = true;
    alertData.matchedSuppressionRuleIds = suppressionResult.matchedRules.map(r => r.id);

    const alert = await AlertService.create({
      data: alertData as Alert
    });

    // Step 6: Register fingerprint for future deduplication
    await this.deduplicationEngine.registerFingerprint(alert);

    // Step 7: Grouping
    const groupingResult = await this.groupingEngine.findOrCreateEpisode(
      alert,
      projectId
    );

    // Step 8: Handle notifications (unless suppressed)
    if (suppressionResult.action !== 'suppress_notifications' &&
        suppressionResult.action !== 'both') {
      await this.triggerNotifications(alert, groupingResult.episodeId);
    }

    return {
      alertId: alert.id,
      status: groupingResult.shouldGroup ? 'grouped' : 'created',
      episodeId: groupingResult.episodeId
    };
  }
}
```

---

## Alert Processing Pipeline

### Pipeline Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              ALERT PROCESSING PIPELINE                              │
└─────────────────────────────────────────────────────────────────────────────────────┘

┌──────────────┐
│ Alert Source │
│   (Input)    │
└──────┬───────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│  STAGE 1: FINGERPRINTING                                                         │
│  ┌─────────────────────────────────────────────────────────────────────────────┐ │
│  │ • Extract key fields (monitorId, criteriaId, severity, title)               │ │
│  │ • Normalize values (lowercase, trim)                                        │ │
│  │ • Generate SHA-256 hash                                                     │ │
│  │ • Store fingerprint on alert object                                         │ │
│  └─────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│  STAGE 2: STORM DETECTION                                                        │
│  ┌─────────────────────────────────────────────────────────────────────────────┐ │
│  │ • Calculate current alert rate                                              │ │
│  │ • Compare against historical baseline                                       │ │
│  │ • If storm detected: notify admins, potentially enable auto-suppression     │ │
│  └─────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│  STAGE 3: DEDUPLICATION                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────────┐ │
│  │ • Query fingerprint cache for matching hash                                 │ │
│  │ • Check if within deduplication window                                      │ │
│  │ • If duplicate: increment counter, return early                             │ │
│  │ • If new: continue to next stage                                            │ │
│  └─────────────────────────────────────────────────────────────────────────────┘ │
│                              │                                                   │
│                     ┌────────┴────────┐                                          │
│                     │   Is Duplicate? │                                          │
│                     └────────┬────────┘                                          │
│                        YES   │   NO                                              │
│                       ┌──────┴──────┐                                            │
│                       ▼             ▼                                            │
│              ┌──────────────┐  Continue                                          │
│              │ Update Count │                                                    │
│              │ Return Early │                                                    │
│              └──────────────┘                                                    │
└──────────────────────────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│  STAGE 4: SUPPRESSION EVALUATION                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────────┐ │
│  │ • Load enabled suppression rules for project                                │ │
│  │ • Evaluate each rule against alert:                                         │ │
│  │   - Maintenance window active?                                              │ │
│  │   - Rate limit exceeded?                                                    │ │
│  │   - Condition-based match?                                                  │ │
│  │ • Determine action: suppress_creation, suppress_notifications, or none      │ │
│  └─────────────────────────────────────────────────────────────────────────────┘ │
│                              │                                                   │
│                     ┌────────┴────────┐                                          │
│                     │ Suppress Alert? │                                          │
│                     └────────┬────────┘                                          │
│              SUPPRESS_CREATION│   SUPPRESS_NOTIFICATIONS / NONE                  │
│                       ┌──────┴──────┐                                            │
│                       ▼             ▼                                            │
│              ┌──────────────┐  Continue                                          │
│              │ Log Suppressed│  (Flag for notification suppression)              │
│              │ Return Early │                                                    │
│              └──────────────┘                                                    │
└──────────────────────────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│  STAGE 5: ALERT CREATION                                                         │
│  ┌─────────────────────────────────────────────────────────────────────────────┐ │
│  │ • Create alert record in database                                           │ │
│  │ • Set initial state                                                         │ │
│  │ • Generate alert number                                                     │ │
│  │ • Create AlertStateTimeline entry                                           │ │
│  │ • Create AlertFeed entry                                                    │ │
│  │ • Register fingerprint for deduplication                                    │ │
│  └─────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│  STAGE 6: EPISODE GROUPING                                                       │
│  ┌─────────────────────────────────────────────────────────────────────────────┐ │
│  │ • Load enabled grouping rules for project                                   │ │
│  │ • Find first matching rule                                                  │ │
│  │ • Search for existing matching episode:                                     │ │
│  │   - Time-window based: active episode within window                         │ │
│  │   - Field-based: episode with same group key                                │ │
│  │   - Smart: episode with similar alerts (ML)                                 │ │
│  │ • Create new episode or add to existing                                     │ │
│  │ • Update alert with episodeId                                               │ │
│  └─────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│  STAGE 7: NOTIFICATION & ON-CALL                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────────┐ │
│  │ • Check if notifications suppressed                                         │ │
│  │ • If not suppressed:                                                        │ │
│  │   - Execute on-call duty policies                                           │ │
│  │   - Send owner notifications                                                │ │
│  │   - Post to workspace channels                                              │ │
│  │   - Send subscriber notifications                                           │ │
│  └─────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│  STAGE 8: METRICS & ANALYTICS                                                    │
│  ┌─────────────────────────────────────────────────────────────────────────────┐ │
│  │ • Record alert creation metric                                              │ │
│  │ • Record suppression/deduplication metrics                                  │ │
│  │ • Update noise reduction statistics                                         │ │
│  │ • Update episode metrics                                                    │ │
│  └─────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────┐
│   Complete   │
│   (Output)   │
└──────────────┘
```

### Worker Jobs

New background jobs required:

| Job | Schedule | Description |
|-----|----------|-------------|
| `AlertFingerprint:Cleanup` | Every hour | Remove expired fingerprint records |
| `AlertEpisode:AutoResolve` | Every 5 min | Resolve episodes with all alerts resolved |
| `AlertEpisode:BreakInactive` | Every 15 min | Break episodes with no activity past threshold |
| `AlertThrottleState:Cleanup` | Every hour | Clean up expired throttle state records |
| `AlertStorm:Monitor` | Every 5 min | Check for alert storm conditions |
| `AlertSuppression:EvaluateRecurrence` | Every minute | Evaluate recurring maintenance windows |
| `AlertMetrics:NoiseReduction` | Daily | Calculate noise reduction statistics |

---

## API Design

### Grouping Rules API

```
POST   /alert-grouping-rule           Create a new grouping rule
GET    /alert-grouping-rule           List all grouping rules
GET    /alert-grouping-rule/:id       Get a specific grouping rule
PUT    /alert-grouping-rule/:id       Update a grouping rule
DELETE /alert-grouping-rule/:id       Delete a grouping rule
POST   /alert-grouping-rule/:id/test  Test rule against sample alerts
```

### Episodes API

```
POST   /alert-episode                 Create a manual episode
GET    /alert-episode                 List all episodes
GET    /alert-episode/:id             Get episode details with alerts
PUT    /alert-episode/:id             Update episode (title, state, etc.)
DELETE /alert-episode/:id             Delete episode (ungroups alerts)
POST   /alert-episode/:id/acknowledge Acknowledge episode
POST   /alert-episode/:id/resolve     Resolve episode
POST   /alert-episode/:id/add-alert   Manually add alert to episode
POST   /alert-episode/:id/remove-alert Remove alert from episode
POST   /alert-episode/merge           Merge multiple episodes
POST   /alert-episode/split           Split an episode
```

### Suppression Rules API

```
POST   /alert-suppression-rule        Create a new suppression rule
GET    /alert-suppression-rule        List all suppression rules
GET    /alert-suppression-rule/:id    Get a specific suppression rule
PUT    /alert-suppression-rule/:id    Update a suppression rule
DELETE /alert-suppression-rule/:id    Delete a suppression rule
POST   /alert-suppression-rule/:id/enable   Enable a rule
POST   /alert-suppression-rule/:id/disable  Disable a rule
POST   /alert-suppression-rule/:id/test     Test rule against sample alerts
```

### Maintenance Windows API

```
POST   /maintenance-window            Create a maintenance window
GET    /maintenance-window            List all maintenance windows
GET    /maintenance-window/:id        Get a specific maintenance window
PUT    /maintenance-window/:id        Update a maintenance window
DELETE /maintenance-window/:id        Delete a maintenance window
GET    /maintenance-window/active     List currently active windows
```

### Metrics API

```
GET    /alert-metrics/noise-reduction      Noise reduction statistics
GET    /alert-metrics/deduplication        Deduplication statistics
GET    /alert-metrics/suppression          Suppression statistics
GET    /alert-metrics/episodes             Episode statistics
GET    /alert-metrics/storm-history        Alert storm history
```

---

## UI/UX Considerations

### 1. Episodes View

A new dashboard view showing grouped alerts:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Episodes                                                          [+ Create]   │
├─────────────────────────────────────────────────────────────────────────────────┤
│  [Active] [Acknowledged] [Resolved] [All]                     🔍 Search         │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │ 🔴 Episode #42: Database connectivity issues                            │   │
│  │    Started: 10 min ago  |  Alerts: 15  |  Monitors: 3                   │   │
│  │    ┌──────────────────────────────────────────────────────────────────┐ │   │
│  │    │ Alert #123: MySQL connection timeout (web-server-1)              │ │   │
│  │    │ Alert #124: MySQL connection timeout (web-server-2)              │ │   │
│  │    │ Alert #125: PostgreSQL connection refused (api-server)           │ │   │
│  │    │ + 12 more alerts...                                              │ │   │
│  │    └──────────────────────────────────────────────────────────────────┘ │   │
│  │    [Acknowledge] [Resolve] [View Details]                               │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │ 🟡 Episode #41: High CPU utilization cluster                            │   │
│  │    Started: 2 hours ago  |  Alerts: 8  |  Monitors: 5                   │   │
│  │    ...                                                                  │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 2. Suppression Rules Configuration

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Suppression Rules                                                 [+ Create]   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │ ✅ Nightly Maintenance Window                                    [Edit] │   │
│  │    Type: Maintenance Window                                             │   │
│  │    Schedule: Daily 2:00 AM - 4:00 AM UTC                                │   │
│  │    Affects: All monitors                                                │   │
│  │    Action: Suppress creation                                            │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │ ✅ Rate Limit: Max 10 alerts/hour per monitor                    [Edit] │   │
│  │    Type: Rate Limit                                                     │   │
│  │    Limit: 10 alerts per 60 minutes                                      │   │
│  │    Group by: Monitor                                                    │   │
│  │    Action: Suppress creation after threshold                            │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │ ❌ Staging Environment                                           [Edit] │   │
│  │    Type: Condition-based                                                │   │
│  │    Condition: Labels contain "staging"                                  │   │
│  │    Action: Suppress notifications                                       │   │
│  │    Status: Disabled                                                     │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 3. Noise Reduction Dashboard

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Noise Reduction Analytics                                                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐           │
│  │   Total     │  │ Deduplicated│  │ Suppressed  │  │  Grouped    │           │
│  │  Alerts     │  │             │  │             │  │  (Episodes) │           │
│  │   1,234     │  │    847      │  │    156      │  │     45      │           │
│  │             │  │   (68.6%)   │  │   (12.6%)   │  │   (231 ▶ 45)│           │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘           │
│                                                                                 │
│  Noise Reduction: 81.2% fewer alert notifications                              │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                    Alert Volume Over Time                               │   │
│  │                                                                         │   │
│  │  200│    ╱\                                                             │   │
│  │     │   ╱  \        ╱\                                                  │   │
│  │  150│  ╱    \      ╱  \    Actual Alerts                                │   │
│  │     │ ╱      \    ╱    \                                                │   │
│  │  100│╱        \  ╱      \        ╱\                                     │   │
│  │     │          \/        \      ╱  \                                    │   │
│  │   50│──────────────────────────────── Notifications Sent               │   │
│  │     │                                                                   │   │
│  │    0└────────────────────────────────────────────────────────────────  │   │
│  │      00:00  04:00  08:00  12:00  16:00  20:00  24:00                   │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 4. Alert Storm Warning Banner

When a storm is detected, show a warning banner:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ ⚠️  ALERT STORM DETECTED: 150 alerts in the last hour (5x normal rate)         │
│     Top affected monitors: mysql-prod, api-gateway, redis-cache                 │
│     [View Details] [Enable Emergency Suppression]                    [Dismiss]  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Foundation (4-6 weeks)

**Objective:** Build core infrastructure for alert processing pipeline

**Deliverables:**
1. Database models for all new entities
2. Fingerprint generator
3. Basic deduplication engine with time-window support
4. Integration with existing alert creation flow
5. Metrics tracking for deduplicated alerts

**Files to Create:**
- `/Common/Models/DatabaseModels/AlertFingerprint.ts`
- `/Common/Server/Utils/Alert/FingerprintGenerator.ts`
- `/Common/Server/Utils/Alert/DeduplicationEngine.ts`
- `/Common/Server/Services/AlertFingerprintService.ts`

**Files to Modify:**
- `/Common/Models/DatabaseModels/Alert.ts` - Add fingerprint fields
- `/Common/Server/Services/AlertService.ts` - Integrate deduplication
- `/Common/Server/Utils/Monitor/MonitorAlert.ts` - Use new pipeline

### Phase 2: Suppression Engine (3-4 weeks)

**Objective:** Implement suppression rules and maintenance windows

**Deliverables:**
1. Suppression rule models
2. Suppression engine
3. Maintenance window support
4. Rate limiting
5. Suppression group support
6. UI for managing suppression rules

**Files to Create:**
- `/Common/Models/DatabaseModels/AlertSuppressionRule.ts`
- `/Common/Models/DatabaseModels/AlertSuppressionGroup.ts`
- `/Common/Models/DatabaseModels/AlertThrottleState.ts`
- `/Common/Server/Utils/Alert/SuppressionEngine.ts`
- `/Common/Server/Services/AlertSuppressionRuleService.ts`
- `/Dashboard/src/Pages/Settings/AlertSuppressionRules.tsx`

### Phase 3: Grouping & Episodes (4-5 weeks)

**Objective:** Implement alert grouping into episodes

**Deliverables:**
1. Episode models
2. Grouping rule models
3. Grouping engine (time-window and field-based)
4. Episode management (merge, split)
5. Episode UI view
6. Episode notifications

**Files to Create:**
- `/Common/Models/DatabaseModels/AlertEpisode.ts`
- `/Common/Models/DatabaseModels/AlertEpisodeMember.ts`
- `/Common/Models/DatabaseModels/AlertGroupingRule.ts`
- `/Common/Server/Utils/Alert/GroupingEngine.ts`
- `/Common/Server/Services/AlertEpisodeService.ts`
- `/Common/Server/Services/AlertGroupingRuleService.ts`
- `/Dashboard/src/Pages/Alerts/Episodes.tsx`
- `/Dashboard/src/Pages/Alerts/EpisodeDetail.tsx`

### Phase 4: Storm Detection & Analytics (2-3 weeks)

**Objective:** Implement storm detection and noise reduction analytics

**Deliverables:**
1. Storm detector
2. Storm notifications
3. Emergency suppression mode
4. Noise reduction dashboard
5. Historical analytics

**Files to Create:**
- `/Common/Server/Utils/Alert/StormDetector.ts`
- `/Dashboard/src/Pages/Alerts/NoiseReduction.tsx`
- `/Worker/Jobs/Alert/StormMonitor.ts`

### Phase 5: Smart Correlation (Future - 4-6 weeks)

**Objective:** Add ML-based alert correlation

**Deliverables:**
1. Similarity vector generation
2. ML model for correlation
3. Smart grouping mode
4. Correlation explanations

**Files to Create:**
- `/Common/Server/Utils/Alert/CorrelationEngine.ts`
- `/Common/Server/Utils/Alert/SimilarityCalculator.ts`

---

## Performance Considerations

### Fingerprint Cache

- Use Redis for fingerprint lookups (sub-millisecond)
- TTL-based expiration matching deduplication window
- Fallback to database for cache misses

```typescript
// Cache key format
`alert:fingerprint:${projectId}:${fingerprintHash}`

// Cache value
{
  canonicalAlertId: string,
  duplicateCount: number,
  expiresAt: number
}
```

### Database Indexes

Required indexes for optimal query performance:

```sql
-- AlertFingerprint
CREATE INDEX idx_fingerprint_lookup
ON AlertFingerprint (projectId, fingerprint, windowEndAt);

-- AlertEpisode
CREATE INDEX idx_episode_active
ON AlertEpisode (projectId, state, lastActivityAt);

CREATE INDEX idx_episode_grouping
ON AlertEpisode (projectId, groupingRuleId, state);

-- AlertEpisodeMember
CREATE INDEX idx_episode_member
ON AlertEpisodeMember (episodeId, alertId);

-- AlertSuppressionRule
CREATE INDEX idx_suppression_enabled
ON AlertSuppressionRule (projectId, isEnabled);

-- AlertThrottleState
CREATE INDEX idx_throttle_active
ON AlertThrottleState (throttleKey, windowExpiresAt);
```

### Batch Processing

For high-volume alert scenarios:
- Batch fingerprint registrations
- Async episode updates
- Debounced metric calculations

### Scalability Targets

| Metric | Target |
|--------|--------|
| Alert processing latency | < 50ms p99 |
| Fingerprint lookup | < 5ms p99 |
| Suppression evaluation | < 20ms p99 |
| Episode assignment | < 30ms p99 |
| Max alerts/second | 1000+ |

---

## Migration Strategy

### Backward Compatibility

- All new features are opt-in via project settings
- Existing alert flow continues to work without configuration
- No breaking changes to existing Alert API

### Data Migration

1. **Phase 1:** No migration needed - new tables created empty
2. **Phase 2:** Generate fingerprints for existing active alerts (background job)
3. **Phase 3:** Optionally group existing alerts into episodes (admin action)

### Feature Flags

```typescript
interface ProjectAlertSettings {
  // Deduplication
  deduplicationEnabled: boolean;
  deduplicationWindowMinutes: number;

  // Suppression
  suppressionEnabled: boolean;

  // Grouping
  groupingEnabled: boolean;
  autoCreateEpisodes: boolean;

  // Storm detection
  stormDetectionEnabled: boolean;
  stormThresholdMultiplier: number;
}
```

### Rollout Plan

1. **Alpha:** Internal testing with feature flags
2. **Beta:** Opt-in for select customers
3. **GA:** Enable by default for new projects
4. **Migration:** Provide migration tools for existing projects

---

## Appendix

### A. Comparison with Splunk

| Feature | Splunk | OneUptime (Proposed) |
|---------|--------|---------------------|
| Alert Grouping | Event iQ (AI) + Rules | Rules + Time-window + Fields |
| Noise Reduction | 90%+ claimed | Target: 80%+ |
| Deduplication | Dedup command + Dynamic throttling | Fingerprint-based + Time-window |
| Suppression | Risk notable suppression + Groups | Rules + Windows + Groups |
| Throttling | Per-field + Time-based | Per-field + Rate-limit |
| Storm Detection | Alert storm detection | Threshold-based detection |
| ML Correlation | Smart Mode | Future enhancement |

### B. Example Configurations

**Time-Window Grouping Rule:**
```json
{
  "name": "Group alerts within 5 minutes",
  "matchCriteria": {
    "severities": ["critical", "high"]
  },
  "groupingConfig": {
    "type": "time_window",
    "timeWindowMinutes": 5
  },
  "episodeConfig": {
    "autoResolveWhenEmpty": true,
    "breakAfterMinutesInactive": 60
  }
}
```

**Field-Based Grouping Rule:**
```json
{
  "name": "Group by monitor and severity",
  "matchCriteria": {},
  "groupingConfig": {
    "type": "field_based",
    "groupByFields": ["monitorId", "alertSeverityId"]
  },
  "episodeConfig": {
    "titleTemplate": "{{monitor.name}} - {{severity.name}} alerts",
    "autoResolveWhenEmpty": true,
    "breakAfterMinutesInactive": 480
  }
}
```

**Maintenance Window Rule:**
```json
{
  "name": "Weekly maintenance window",
  "type": "maintenance_window",
  "matchCriteria": {
    "labels": ["production"]
  },
  "maintenanceWindow": {
    "startTime": "2024-01-07T02:00:00Z",
    "endTime": "2024-01-07T04:00:00Z",
    "timezone": "UTC",
    "isRecurring": true,
    "recurrenceRule": "FREQ=WEEKLY;BYDAY=SU"
  },
  "action": "both"
}
```

**Rate Limit Rule:**
```json
{
  "name": "Max 10 alerts per monitor per hour",
  "type": "rate_limit",
  "matchCriteria": {},
  "rateLimit": {
    "maxAlerts": 10,
    "timeWindowMinutes": 60,
    "groupByFields": ["monitorId"]
  },
  "action": "suppress_creation"
}
```

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-01-19 | Claude | Initial draft |

---

## Next Steps

1. Review this design with the team
2. Prioritize features based on customer feedback
3. Create detailed technical specifications for Phase 1
4. Set up project tracking and milestones
5. Begin implementation of Phase 1
