# Backend Implementation for Alert Suppression

## Overview

This document details the backend services and components required for Alert Suppression functionality.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           Suppression Evaluation Flow                            │
└─────────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────┐
│   Alert Trigger      │
│  (Monitor/Manual)    │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                         SuppressionEngine.evaluate()                              │
├──────────────────────────────────────────────────────────────────────────────────┤
│                                                                                   │
│  ┌─────────────────┐                                                             │
│  │ 1. Get enabled  │                                                             │
│  │    rules        │                                                             │
│  └────────┬────────┘                                                             │
│           │                                                                       │
│           ▼                                                                       │
│  ┌─────────────────────────────────────────────────────────────────────────────┐ │
│  │ 2. For each rule (sorted by priority):                                      │ │
│  │    ┌───────────────┐  ┌───────────────┐  ┌───────────────┐                  │ │
│  │    │ Match Criteria│─▶│ Check if Rule │─▶│ Apply Action  │                  │ │
│  │    │ Evaluation    │  │ is Active     │  │               │                  │ │
│  │    └───────────────┘  └───────────────┘  └───────────────┘                  │ │
│  │                              │                                               │ │
│  │              ┌───────────────┼───────────────┐                               │ │
│  │              ▼               ▼               ▼                               │ │
│  │    ┌─────────────────┐ ┌──────────────┐ ┌─────────────────┐                 │ │
│  │    │ Maintenance     │ │ Condition    │ │ Rate Limit      │                 │ │
│  │    │ Window Active?  │ │ Met?         │ │ Exceeded?       │                 │ │
│  │    └─────────────────┘ └──────────────┘ └─────────────────┘                 │ │
│  └─────────────────────────────────────────────────────────────────────────────┘ │
│           │                                                                       │
│           ▼                                                                       │
│  ┌─────────────────┐                                                             │
│  │ 3. Determine    │                                                             │
│  │    final action │                                                             │
│  └─────────────────┘                                                             │
│                                                                                   │
└──────────────────────────────────────────────────────────────────────────────────┘
           │
           ▼
    ┌──────┴──────┐
    │             │
    ▼             ▼
┌────────┐   ┌────────┐
│SUPPRESS│   │ ALLOW  │
└────────┘   └────────┘
```

---

## Services to Create

### 1. AlertSuppressionRuleService

**File Location:** `/Common/Server/Services/AlertSuppressionRuleService.ts`

```typescript
import DatabaseService from './DatabaseService';
import AlertSuppressionRule, {
    SuppressionRuleType,
} from '../Models/DatabaseModels/AlertSuppressionRule';
import ObjectID from 'Common/Types/ObjectID';
import SortOrder from 'Common/Types/BaseDatabase/SortOrder';

export class Service extends DatabaseService<AlertSuppressionRule> {
    public constructor() {
        super(AlertSuppressionRule);
    }

    /**
     * Get all enabled rules for a project, sorted by priority
     */
    public async getEnabledRulesForProject(
        projectId: ObjectID
    ): Promise<Array<AlertSuppressionRule>> {
        return await this.findBy({
            query: {
                projectId,
                isEnabled: true,
            },
            select: {
                _id: true,
                name: true,
                type: true,
                matchCriteria: true,
                maintenanceWindow: true,
                condition: true,
                rateLimit: true,
                action: true,
                suppressionGroupId: true,
                priority: true,
            },
            sort: { priority: SortOrder.Ascending },
            props: { isRoot: true },
        });
    }

    /**
     * Get active maintenance windows
     */
    public async getActiveMaintenanceWindows(
        projectId: ObjectID
    ): Promise<Array<AlertSuppressionRule>> {
        const rules = await this.getEnabledRulesForProject(projectId);

        return rules.filter((rule) => {
            if (rule.type !== SuppressionRuleType.MaintenanceWindow) {
                return false;
            }
            return this.isMaintenanceWindowActive(rule);
        });
    }

    /**
     * Check if a maintenance window is currently active
     */
    private isMaintenanceWindowActive(rule: AlertSuppressionRule): boolean {
        const window = rule.maintenanceWindow;
        if (!window) {
            return false;
        }

        const now = new Date();

        if (window.isRecurring && window.recurrenceRule) {
            return this.evaluateRecurrence(window, now);
        }

        return now >= window.startTime && now <= window.endTime;
    }

    /**
     * Evaluate recurrence rule (RRULE format)
     */
    private evaluateRecurrence(
        window: MaintenanceWindowConfig,
        now: Date
    ): boolean {
        // Use rrule library for parsing
        // This is a simplified implementation
        try {
            const RRule = require('rrule').RRule;
            const rule = RRule.fromString(window.recurrenceRule!);

            // Get next occurrence
            const nextOccurrence = rule.after(
                new Date(now.getTime() - 24 * 60 * 60 * 1000), // Look back 24h
                true
            );

            if (!nextOccurrence) {
                return false;
            }

            // Calculate window duration
            const duration = window.endTime.getTime() - window.startTime.getTime();
            const occurrenceEnd = new Date(nextOccurrence.getTime() + duration);

            return now >= nextOccurrence && now <= occurrenceEnd;
        } catch (error) {
            logger.error('Error evaluating recurrence rule:', error);
            return false;
        }
    }

    /**
     * Increment suppressed count for a rule
     */
    public async incrementSuppressedCount(ruleId: ObjectID): Promise<void> {
        await this.updateOneById({
            id: ruleId,
            data: {
                suppressedCount: QueryHelper.increment(1),
                lastTriggeredAt: new Date(),
            },
            props: { isRoot: true },
        });
    }
}

export default new Service();
```

---

### 2. SuppressionEngine

**File Location:** `/Common/Server/Utils/Alert/SuppressionEngine.ts`

```typescript
import Alert from '../../Models/DatabaseModels/Alert';
import AlertSuppressionRule, {
    SuppressionRuleType,
    SuppressionAction,
    SuppressionMatchCriteria,
    RateLimitConfig,
} from '../../Models/DatabaseModels/AlertSuppressionRule';
import AlertSuppressionRuleService from '../../Services/AlertSuppressionRuleService';
import AlertThrottleStateService from '../../Services/AlertThrottleStateService';
import SuppressedAlertLogService from '../../Services/SuppressedAlertLogService';
import ObjectID from 'Common/Types/ObjectID';
import OneUptimeDate from 'Common/Types/Date';

export interface SuppressionResult {
    shouldSuppress: boolean;
    action: SuppressionAction | 'none';
    matchedRules: Array<AlertSuppressionRule>;
    reason?: string;
}

export default class SuppressionEngine {
    /**
     * Evaluate all suppression rules for an alert
     */
    public static async evaluate(
        alertData: Partial<Alert>,
        projectId: ObjectID
    ): Promise<SuppressionResult> {
        // Get all enabled suppression rules
        const rules = await AlertSuppressionRuleService.getEnabledRulesForProject(
            projectId
        );

        if (rules.length === 0) {
            return {
                shouldSuppress: false,
                action: 'none',
                matchedRules: [],
            };
        }

        const matchedRules: Array<AlertSuppressionRule> = [];
        let shouldSuppress = false;
        let finalAction: SuppressionAction | 'none' = 'none';
        let reason = '';

        // Evaluate each rule in priority order
        for (const rule of rules) {
            // Check if alert matches rule criteria
            if (!await this.matchesCriteria(alertData, rule.matchCriteria)) {
                continue;
            }

            // Check if rule is currently active
            const isActive = await this.isRuleActive(rule, alertData, projectId);

            if (isActive) {
                matchedRules.push(rule);
                shouldSuppress = true;

                // Determine action (most restrictive wins)
                if (rule.action === SuppressionAction.Both || finalAction === SuppressionAction.Both) {
                    finalAction = SuppressionAction.Both;
                } else if (rule.action === SuppressionAction.SuppressCreation) {
                    finalAction = SuppressionAction.SuppressCreation;
                } else if (finalAction !== SuppressionAction.SuppressCreation) {
                    finalAction = SuppressionAction.SuppressNotifications;
                }

                // Build reason string
                reason = this.buildSuppressionReason(rule);

                // If suppressing creation, no need to check more rules
                if (finalAction === SuppressionAction.SuppressCreation ||
                    finalAction === SuppressionAction.Both) {
                    break;
                }
            }
        }

        // Log suppression if applicable
        if (shouldSuppress && matchedRules.length > 0) {
            await this.logSuppression(alertData, matchedRules[0]!, projectId, reason, finalAction);
        }

        return {
            shouldSuppress,
            action: finalAction,
            matchedRules,
            reason,
        };
    }

    /**
     * Check if alert matches rule criteria
     */
    private static async matchesCriteria(
        alertData: Partial<Alert>,
        criteria?: SuppressionMatchCriteria
    ): Promise<boolean> {
        if (!criteria || criteria.matchAll) {
            return true;
        }

        // Check severity
        if (criteria.severityIds?.length) {
            const alertSeverityId = alertData.alertSeverityId?.toString();
            if (!alertSeverityId || !criteria.severityIds.includes(alertSeverityId)) {
                return false;
            }
        }

        // Check monitors
        if (criteria.monitorIds?.length) {
            const alertMonitorId = alertData.monitorId?.toString();
            if (!alertMonitorId || !criteria.monitorIds.includes(alertMonitorId)) {
                return false;
            }
        }

        // Check labels
        if (criteria.labelIds?.length) {
            const alertLabelIds = (alertData.labels || []).map((l) =>
                l.id?.toString() || l._id?.toString()
            );
            const hasMatchingLabel = criteria.labelIds.some((id) =>
                alertLabelIds.includes(id)
            );
            if (!hasMatchingLabel) {
                return false;
            }
        }

        // Check title pattern
        if (criteria.titlePattern) {
            try {
                const regex = new RegExp(criteria.titlePattern, 'i');
                if (!regex.test(alertData.title || '')) {
                    return false;
                }
            } catch {
                // Invalid regex, skip this check
            }
        }

        // Check description pattern
        if (criteria.descriptionPattern) {
            try {
                const regex = new RegExp(criteria.descriptionPattern, 'i');
                if (!regex.test(alertData.description || '')) {
                    return false;
                }
            } catch {
                // Invalid regex, skip this check
            }
        }

        return true;
    }

    /**
     * Check if rule is currently active
     */
    private static async isRuleActive(
        rule: AlertSuppressionRule,
        alertData: Partial<Alert>,
        projectId: ObjectID
    ): Promise<boolean> {
        switch (rule.type) {
            case SuppressionRuleType.MaintenanceWindow:
                return this.isMaintenanceWindowActive(rule);

            case SuppressionRuleType.ConditionBased:
                return await this.isConditionMet(rule, projectId);

            case SuppressionRuleType.RateLimit:
                return await this.isRateLimitExceeded(rule, alertData, projectId);

            default:
                return false;
        }
    }

    /**
     * Check if maintenance window is active
     */
    private static isMaintenanceWindowActive(rule: AlertSuppressionRule): boolean {
        const window = rule.maintenanceWindow;
        if (!window) {
            return false;
        }

        const now = new Date();

        if (window.isRecurring && window.recurrenceRule) {
            return this.evaluateRecurrence(window, now);
        }

        return now >= window.startTime && now <= window.endTime;
    }

    /**
     * Evaluate recurrence rule
     */
    private static evaluateRecurrence(
        window: MaintenanceWindowConfig,
        now: Date
    ): boolean {
        try {
            const RRule = require('rrule').RRule;
            const rule = RRule.fromString(window.recurrenceRule!);

            const lookbackTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            const nextOccurrence = rule.after(lookbackTime, true);

            if (!nextOccurrence) {
                return false;
            }

            const duration = window.endTime.getTime() - window.startTime.getTime();
            const occurrenceEnd = new Date(nextOccurrence.getTime() + duration);

            return now >= nextOccurrence && now <= occurrenceEnd;
        } catch {
            return false;
        }
    }

    /**
     * Check if condition is met
     */
    private static async isConditionMet(
        rule: AlertSuppressionRule,
        projectId: ObjectID
    ): Promise<boolean> {
        const condition = rule.condition;
        if (!condition) {
            return true;
        }

        // Check if another alert is active with specific labels
        if (condition.whenAlertActiveWithLabelIds?.length) {
            const activeAlert = await AlertService.findOneBy({
                query: {
                    projectId,
                    labels: QueryHelper.any(condition.whenAlertActiveWithLabelIds),
                    currentAlertStateId: QueryHelper.notEquals(
                        await AlertStateService.getResolvedStateId(projectId)
                    ),
                },
                select: { _id: true },
                props: { isRoot: true },
            });

            if (activeAlert) {
                return true;
            }
        }

        // Check if monitor is in specific state
        if (condition.whenMonitorInStateIds?.length) {
            // Implementation depends on monitor state tracking
        }

        return false;
    }

    /**
     * Check if rate limit is exceeded
     */
    private static async isRateLimitExceeded(
        rule: AlertSuppressionRule,
        alertData: Partial<Alert>,
        projectId: ObjectID
    ): Promise<boolean> {
        const rateLimit = rule.rateLimit;
        if (!rateLimit) {
            return false;
        }

        // Compute throttle key
        const throttleKey = this.computeThrottleKey(rule, alertData);

        // Get or create throttle state
        let state = await AlertThrottleStateService.findOneBy({
            query: {
                throttleKey,
                suppressionRuleId: rule.id!,
                windowExpiresAt: QueryHelper.greaterThan(new Date()),
            },
            select: {
                _id: true,
                alertCount: true,
                isThrottling: true,
            },
            props: { isRoot: true },
        });

        if (!state) {
            // Create new throttle state
            const now = new Date();
            const windowExpires = OneUptimeDate.addRemoveMinutes(
                now,
                rateLimit.timeWindowMinutes
            );

            await AlertThrottleStateService.create({
                data: {
                    projectId,
                    throttleKey,
                    suppressionRuleId: rule.id!,
                    alertCount: 1,
                    firstAlertAt: now,
                    lastAlertAt: now,
                    windowExpiresAt: windowExpires,
                    isThrottling: false,
                } as AlertThrottleState,
                props: { isRoot: true },
            });

            return false;
        }

        // Update throttle state
        const newCount = (state.alertCount || 0) + 1;
        const shouldThrottle = newCount > rateLimit.maxAlerts;

        await AlertThrottleStateService.updateOneById({
            id: state.id!,
            data: {
                alertCount: newCount,
                lastAlertAt: new Date(),
                isThrottling: shouldThrottle,
            },
            props: { isRoot: true },
        });

        return shouldThrottle;
    }

    /**
     * Compute throttle key from rule and alert data
     */
    private static computeThrottleKey(
        rule: AlertSuppressionRule,
        alertData: Partial<Alert>
    ): string {
        const parts: Array<string> = [`rule:${rule.id?.toString()}`];

        const groupByFields = rule.rateLimit?.groupByFields || [];

        for (const field of groupByFields) {
            switch (field) {
                case 'monitorId':
                    parts.push(`monitor:${alertData.monitorId?.toString() || 'null'}`);
                    break;
                case 'alertSeverityId':
                case 'severity':
                    parts.push(`severity:${alertData.alertSeverityId?.toString() || 'null'}`);
                    break;
                case 'title':
                    parts.push(`title:${alertData.title || 'null'}`);
                    break;
            }
        }

        return parts.join('|');
    }

    /**
     * Build suppression reason string
     */
    private static buildSuppressionReason(rule: AlertSuppressionRule): string {
        switch (rule.type) {
            case SuppressionRuleType.MaintenanceWindow:
                return `Suppressed by maintenance window: ${rule.name}`;
            case SuppressionRuleType.ConditionBased:
                return `Suppressed by condition: ${rule.name}`;
            case SuppressionRuleType.RateLimit:
                return `Suppressed by rate limit: ${rule.name} (max ${rule.rateLimit?.maxAlerts} per ${rule.rateLimit?.timeWindowMinutes} min)`;
            default:
                return `Suppressed by rule: ${rule.name}`;
        }
    }

    /**
     * Log suppressed alert for audit trail
     */
    private static async logSuppression(
        alertData: Partial<Alert>,
        rule: AlertSuppressionRule,
        projectId: ObjectID,
        reason: string,
        action: SuppressionAction | 'none'
    ): Promise<void> {
        await SuppressedAlertLogService.create({
            data: {
                projectId,
                suppressionRuleId: rule.id,
                alertData: alertData as object,
                alertTitle: alertData.title,
                suppressionReason: reason,
                action: action as SuppressionAction,
                suppressedAt: new Date(),
                monitorId: alertData.monitorId,
            } as SuppressedAlertLog,
            props: { isRoot: true },
        });

        // Increment rule counter
        await AlertSuppressionRuleService.incrementSuppressedCount(rule.id!);
    }
}

// Import services at end to avoid circular dependencies
import AlertService from '../../Services/AlertService';
import AlertStateService from '../../Services/AlertStateService';
import AlertThrottleState from '../../Models/DatabaseModels/AlertThrottleState';
import SuppressedAlertLog from '../../Models/DatabaseModels/SuppressedAlertLog';
import QueryHelper from '../../Types/Database/QueryHelper';
import logger from '../../Utils/Logger';
import { MaintenanceWindowConfig } from '../../Models/DatabaseModels/AlertSuppressionRule';
```

---

### 3. Integration with AlertService

Modify `/Common/Server/Services/AlertService.ts`:

```typescript
// Add import
import SuppressionEngine from '../Utils/Alert/SuppressionEngine';

// In onBeforeCreate() method, add suppression check:
protected async onBeforeCreate(
    createBy: CreateBy<Alert>
): Promise<OnCreate<Alert>> {
    // ... existing code ...

    // Check suppression rules
    const suppressionResult = await SuppressionEngine.evaluate(
        createBy.data,
        createBy.data.projectId!
    );

    if (suppressionResult.shouldSuppress) {
        if (suppressionResult.action === SuppressionAction.SuppressCreation ||
            suppressionResult.action === SuppressionAction.Both) {
            // Prevent alert creation
            throw new SuppressedAlertException(
                suppressionResult.reason || 'Alert suppressed by rule'
            );
        }

        // Mark for notification suppression
        createBy.data.notificationsSuppressed = true;
        createBy.data.suppressedByRuleId = suppressionResult.matchedRules[0]?.id;
    }

    // ... rest of existing code ...
}
```

---

### 4. SuppressedAlertLogService

**File Location:** `/Common/Server/Services/SuppressedAlertLogService.ts`

```typescript
import DatabaseService from './DatabaseService';
import SuppressedAlertLog from '../Models/DatabaseModels/SuppressedAlertLog';
import ObjectID from 'Common/Types/ObjectID';

export class Service extends DatabaseService<SuppressedAlertLog> {
    public constructor() {
        super(SuppressedAlertLog);
    }

    /**
     * Get suppressed alerts for a rule
     */
    public async getSuppressedByRule(
        ruleId: ObjectID,
        limit: number = 100
    ): Promise<Array<SuppressedAlertLog>> {
        return await this.findBy({
            query: { suppressionRuleId: ruleId },
            select: {
                _id: true,
                alertTitle: true,
                suppressionReason: true,
                action: true,
                suppressedAt: true,
                monitorId: true,
            },
            sort: { suppressedAt: SortOrder.Descending },
            limit,
            props: { isRoot: true },
        });
    }

    /**
     * Get suppression statistics for a project
     */
    public async getStatistics(
        projectId: ObjectID,
        startDate: Date,
        endDate: Date
    ): Promise<{
        totalSuppressed: number;
        byRule: Array<{ ruleId: string; count: number }>;
        byAction: Array<{ action: string; count: number }>;
    }> {
        const totalSuppressed = await this.countBy({
            query: {
                projectId,
                suppressedAt: QueryHelper.between(startDate, endDate),
            },
            props: { isRoot: true },
        });

        // Aggregate by rule
        const byRule = await this.aggregate({
            pipeline: [
                {
                    $match: {
                        projectId: projectId.toString(),
                        suppressedAt: { $gte: startDate, $lte: endDate },
                    },
                },
                {
                    $group: {
                        _id: '$suppressionRuleId',
                        count: { $sum: 1 },
                    },
                },
            ],
        });

        // Aggregate by action
        const byAction = await this.aggregate({
            pipeline: [
                {
                    $match: {
                        projectId: projectId.toString(),
                        suppressedAt: { $gte: startDate, $lte: endDate },
                    },
                },
                {
                    $group: {
                        _id: '$action',
                        count: { $sum: 1 },
                    },
                },
            ],
        });

        return {
            totalSuppressed,
            byRule: byRule.map((r) => ({ ruleId: r._id, count: r.count })),
            byAction: byAction.map((a) => ({ action: a._id, count: a.count })),
        };
    }
}

export default new Service();
```

---

### 5. AlertThrottleStateService

**File Location:** `/Common/Server/Services/AlertThrottleStateService.ts`

```typescript
import DatabaseService from './DatabaseService';
import AlertThrottleState from '../Models/DatabaseModels/AlertThrottleState';

export class Service extends DatabaseService<AlertThrottleState> {
    public constructor() {
        super(AlertThrottleState);
    }

    /**
     * Clean up expired throttle states
     */
    public async cleanupExpired(): Promise<number> {
        const result = await this.deleteBy({
            query: {
                windowExpiresAt: QueryHelper.lessThan(new Date()),
            },
            props: { isRoot: true },
        });

        return result;
    }
}

export default new Service();
```

---

## Worker Jobs

### 1. ThrottleStateCleanup Job

**File Location:** `/Worker/Jobs/AlertSuppression/ThrottleStateCleanup.ts`

```typescript
import RunCron from '../../Utils/Cron';
import { EVERY_HOUR } from 'Common/Utils/CronTime';
import AlertThrottleStateService from 'Common/Server/Services/AlertThrottleStateService';

RunCron(
    'AlertSuppression:ThrottleStateCleanup',
    { schedule: EVERY_HOUR, runOnStartup: false },
    async () => {
        const deletedCount = await AlertThrottleStateService.cleanupExpired();

        if (deletedCount > 0) {
            logger.info(`Cleaned up ${deletedCount} expired throttle states`);
        }
    }
);
```

### 2. MaintenanceWindowNotification Job

**File Location:** `/Worker/Jobs/AlertSuppression/MaintenanceWindowNotification.ts`

```typescript
import RunCron from '../../Utils/Cron';
import { EVERY_MINUTE } from 'Common/Utils/CronTime';
import AlertSuppressionRuleService from 'Common/Server/Services/AlertSuppressionRuleService';
import { SuppressionRuleType } from 'Common/Models/DatabaseModels/AlertSuppressionRule';

RunCron(
    'AlertSuppression:MaintenanceWindowNotification',
    { schedule: EVERY_MINUTE, runOnStartup: false },
    async () => {
        // Find maintenance windows starting in next 15 minutes
        const upcomingWindows = await AlertSuppressionRuleService.findBy({
            query: {
                type: SuppressionRuleType.MaintenanceWindow,
                isEnabled: true,
            },
            select: {
                _id: true,
                projectId: true,
                name: true,
                maintenanceWindow: true,
            },
            props: { isRoot: true },
        });

        const now = new Date();
        const fifteenMinutesFromNow = new Date(now.getTime() + 15 * 60 * 1000);

        for (const rule of upcomingWindows) {
            const window = rule.maintenanceWindow;
            if (!window) continue;

            // Check if window starts within next 15 minutes
            if (window.startTime > now && window.startTime <= fifteenMinutesFromNow) {
                // Send notification about upcoming maintenance window
                await NotificationService.sendMaintenanceWindowNotification({
                    projectId: rule.projectId!,
                    ruleName: rule.name!,
                    startsAt: window.startTime,
                    endsAt: window.endTime,
                });
            }
        }
    }
);
```

---

## Implementation Checklist

### Phase 1: Core Services
- [ ] Create AlertSuppressionRuleService
- [ ] Create AlertSuppressionGroupService
- [ ] Create SuppressedAlertLogService
- [ ] Create AlertThrottleStateService
- [ ] Create SuppressionEngine

### Phase 2: Integration
- [ ] Modify AlertService.onBeforeCreate()
- [ ] Add SuppressedAlertException
- [ ] Add notification suppression field to Alert

### Phase 3: Worker Jobs
- [ ] Create ThrottleStateCleanup job
- [ ] Create MaintenanceWindowNotification job
- [ ] Register jobs in worker startup

### Phase 4: Testing
- [ ] Unit tests for SuppressionEngine
- [ ] Unit tests for criteria matching
- [ ] Unit tests for rate limiting
- [ ] Integration tests for full suppression flow
