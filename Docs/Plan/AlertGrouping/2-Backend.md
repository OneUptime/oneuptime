# Backend Implementation for Alert Grouping

## Overview

This document details the backend services and components required for Alert Grouping / Episodes functionality.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              Alert Creation Flow                                 │
└─────────────────────────────────────────────────────────────────────────────────┘

                    ┌──────────────────────┐
                    │   Monitor/Manual     │
                    │   Alert Trigger      │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │    AlertService      │
                    │    .create()         │
                    └──────────┬───────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                         GroupingEngine.processAlert()                             │
├──────────────────────────────────────────────────────────────────────────────────┤
│                                                                                   │
│  ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────────────────────┐ │
│  │ 1. Get enabled  │──▶│ 2. Match alert  │──▶│ 3. Find or create episode       │ │
│  │    rules        │   │    to rules     │   │                                 │ │
│  └─────────────────┘   └─────────────────┘   └─────────────────────────────────┘ │
│                                                              │                    │
│                                              ┌───────────────┴───────────────┐   │
│                                              │                               │   │
│                                              ▼                               ▼   │
│                                   ┌─────────────────┐          ┌──────────────┐  │
│                                   │ Add to existing │          │ Create new   │  │
│                                   │ episode         │          │ episode      │  │
│                                   └─────────────────┘          └──────────────┘  │
│                                              │                               │   │
│                                              └───────────────┬───────────────┘   │
│                                                              ▼                   │
│                                              ┌─────────────────────────────────┐ │
│                                              │ 4. Create AlertEpisodeMember    │ │
│                                              │ 5. Update Alert.episodeId       │ │
│                                              │ 6. Update Episode metrics       │ │
│                                              └─────────────────────────────────┘ │
│                                                                                   │
└──────────────────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │   Continue with      │
                    │   notifications      │
                    └──────────────────────┘
```

---

## Services to Create

### 1. AlertEpisodeService

**File Location:** `/Common/Server/Services/AlertEpisodeService.ts`

```typescript
import DatabaseService from './DatabaseService';
import AlertEpisode from '../Models/DatabaseModels/AlertEpisode';
import AlertEpisodeMember from '../Models/DatabaseModels/AlertEpisodeMember';
import Alert from '../Models/DatabaseModels/Alert';
import ObjectID from 'Common/Types/ObjectID';
import BadDataException from 'Common/Types/Exception/BadDataException';
import QueryHelper from '../Types/Database/QueryHelper';
import SortOrder from 'Common/Types/BaseDatabase/SortOrder';
import AlertState from '../Models/DatabaseModels/AlertState';
import AlertSeverity from '../Models/DatabaseModels/AlertSeverity';
import AlertStateService from './AlertStateService';
import AlertSeverityService from './AlertSeverityService';

export class Service extends DatabaseService<AlertEpisode> {
    public constructor() {
        super(AlertEpisode);
    }

    /**
     * Get the next episode number for a project
     */
    public async getNextEpisodeNumber(projectId: ObjectID): Promise<number> {
        const lastEpisode = await this.findOneBy({
            query: { projectId },
            select: { episodeNumber: true },
            sort: { episodeNumber: SortOrder.Descending },
            props: { isRoot: true },
        });

        return (lastEpisode?.episodeNumber || 0) + 1;
    }

    /**
     * Create a new episode with an initial alert
     */
    public async createWithAlert(data: {
        projectId: ObjectID;
        title: string;
        description?: string;
        alert: Alert;
        groupingRuleId?: ObjectID;
        createdByUserId?: ObjectID;
    }): Promise<AlertEpisode> {
        const episodeNumber = await this.getNextEpisodeNumber(data.projectId);

        // Get initial state (Created)
        const createdState = await AlertStateService.getCreatedState(data.projectId);

        const episode = await this.create({
            data: {
                projectId: data.projectId,
                episodeNumber,
                title: data.title,
                description: data.description,
                groupingRuleId: data.groupingRuleId,
                currentAlertStateId: createdState.id,
                alertSeverityId: data.alert.alertSeverityId,
                startedAt: new Date(),
                lastActivityAt: new Date(),
                alertCount: 1,
                uniqueMonitorCount: 1,
            } as AlertEpisode,
            props: {
                isRoot: true,
            },
        });

        // Create member record
        await AlertEpisodeMemberService.create({
            data: {
                projectId: data.projectId,
                episodeId: episode.id!,
                alertId: data.alert.id!,
                addedBy: data.groupingRuleId ? 'rule' : 'manual',
                addedAt: new Date(),
                groupingRuleId: data.groupingRuleId,
            } as AlertEpisodeMember,
            props: { isRoot: true },
        });

        // Update alert with episode reference
        await AlertService.updateOneById({
            id: data.alert.id!,
            data: { episodeId: episode.id },
            props: { isRoot: true },
        });

        return episode;
    }

    /**
     * Add an alert to an existing episode
     */
    public async addAlert(data: {
        episodeId: ObjectID;
        alert: Alert;
        addedBy: 'rule' | 'manual' | 'correlation';
        groupingRuleId?: ObjectID;
        similarityScore?: number;
    }): Promise<void> {
        const episode = await this.findOneById({
            id: data.episodeId,
            select: {
                projectId: true,
                alertCount: true,
                alertSeverityId: true,
            },
            props: { isRoot: true },
        });

        if (!episode) {
            throw new BadDataException('Episode not found');
        }

        // Check if already a member
        const existingMember = await AlertEpisodeMemberService.findOneBy({
            query: {
                episodeId: data.episodeId,
                alertId: data.alert.id!,
            },
            select: { _id: true },
            props: { isRoot: true },
        });

        if (existingMember) {
            return; // Already a member
        }

        // Create member record
        await AlertEpisodeMemberService.create({
            data: {
                projectId: episode.projectId!,
                episodeId: data.episodeId,
                alertId: data.alert.id!,
                addedBy: data.addedBy,
                addedAt: new Date(),
                groupingRuleId: data.groupingRuleId,
                similarityScore: data.similarityScore,
            } as AlertEpisodeMember,
            props: { isRoot: true },
        });

        // Update alert with episode reference
        await AlertService.updateOneById({
            id: data.alert.id!,
            data: { episodeId: data.episodeId },
            props: { isRoot: true },
        });

        // Update episode metrics
        const highestSeverity = await this.getHighestSeverityInEpisode(data.episodeId);
        const uniqueMonitors = await this.getUniqueMonitorCount(data.episodeId);

        await this.updateOneById({
            id: data.episodeId,
            data: {
                lastActivityAt: new Date(),
                alertCount: (episode.alertCount || 0) + 1,
                uniqueMonitorCount: uniqueMonitors,
                alertSeverityId: highestSeverity?.id,
            },
            props: { isRoot: true },
        });
    }

    /**
     * Remove an alert from an episode
     */
    public async removeAlert(data: {
        episodeId: ObjectID;
        alertId: ObjectID;
    }): Promise<void> {
        // Delete member record
        await AlertEpisodeMemberService.deleteOneBy({
            query: {
                episodeId: data.episodeId,
                alertId: data.alertId,
            },
            props: { isRoot: true },
        });

        // Clear episode reference from alert
        await AlertService.updateOneById({
            id: data.alertId,
            data: { episodeId: null },
            props: { isRoot: true },
        });

        // Update episode metrics
        const episode = await this.findOneById({
            id: data.episodeId,
            select: { alertCount: true },
            props: { isRoot: true },
        });

        if (episode) {
            const uniqueMonitors = await this.getUniqueMonitorCount(data.episodeId);
            const highestSeverity = await this.getHighestSeverityInEpisode(data.episodeId);

            await this.updateOneById({
                id: data.episodeId,
                data: {
                    alertCount: Math.max(0, (episode.alertCount || 0) - 1),
                    uniqueMonitorCount: uniqueMonitors,
                    alertSeverityId: highestSeverity?.id,
                },
                props: { isRoot: true },
            });
        }
    }

    /**
     * Acknowledge an episode
     */
    public async acknowledge(data: {
        episodeId: ObjectID;
        acknowledgedByUserId: ObjectID;
    }): Promise<void> {
        const episode = await this.findOneById({
            id: data.episodeId,
            select: { projectId: true },
            props: { isRoot: true },
        });

        if (!episode) {
            throw new BadDataException('Episode not found');
        }

        const acknowledgedState = await AlertStateService.getAcknowledgedState(
            episode.projectId!
        );

        await this.updateOneById({
            id: data.episodeId,
            data: {
                currentAlertStateId: acknowledgedState.id,
                acknowledgedAt: new Date(),
            },
            props: { isRoot: true },
        });

        // Optionally acknowledge all alerts in episode
        // await this.acknowledgeAllAlerts(data.episodeId);
    }

    /**
     * Resolve an episode
     */
    public async resolve(data: {
        episodeId: ObjectID;
        resolvedByUserId?: ObjectID;
        rootCause?: string;
    }): Promise<void> {
        const episode = await this.findOneById({
            id: data.episodeId,
            select: { projectId: true },
            props: { isRoot: true },
        });

        if (!episode) {
            throw new BadDataException('Episode not found');
        }

        const resolvedState = await AlertStateService.getResolvedState(
            episode.projectId!
        );

        await this.updateOneById({
            id: data.episodeId,
            data: {
                currentAlertStateId: resolvedState.id,
                resolvedAt: new Date(),
                rootCause: data.rootCause,
            },
            props: { isRoot: true },
        });
    }

    /**
     * Merge multiple episodes into one
     */
    public async mergeEpisodes(data: {
        targetEpisodeId: ObjectID;
        sourceEpisodeIds: Array<ObjectID>;
    }): Promise<void> {
        for (const sourceId of data.sourceEpisodeIds) {
            // Get all members from source episode
            const members = await AlertEpisodeMemberService.findBy({
                query: { episodeId: sourceId },
                select: { alertId: true },
                props: { isRoot: true },
            });

            // Move each alert to target episode
            for (const member of members) {
                await AlertEpisodeMemberService.updateOneBy({
                    query: {
                        episodeId: sourceId,
                        alertId: member.alertId!,
                    },
                    data: { episodeId: data.targetEpisodeId },
                    props: { isRoot: true },
                });

                await AlertService.updateOneById({
                    id: member.alertId!,
                    data: { episodeId: data.targetEpisodeId },
                    props: { isRoot: true },
                });
            }

            // Delete source episode
            await this.deleteOneById({
                id: sourceId,
                props: { isRoot: true },
            });
        }

        // Update target episode metrics
        await this.refreshMetrics(data.targetEpisodeId);
    }

    /**
     * Get highest severity among alerts in episode
     */
    private async getHighestSeverityInEpisode(
        episodeId: ObjectID
    ): Promise<AlertSeverity | null> {
        const members = await AlertEpisodeMemberService.findBy({
            query: { episodeId },
            select: { alertId: true },
            props: { isRoot: true },
        });

        if (members.length === 0) {
            return null;
        }

        const alertIds = members.map((m) => m.alertId!);
        const alerts = await AlertService.findBy({
            query: {
                _id: QueryHelper.any(alertIds),
            },
            select: { alertSeverityId: true },
            props: { isRoot: true },
        });

        // Get unique severity IDs
        const severityIds = [...new Set(alerts.map((a) => a.alertSeverityId!))];

        // Find highest severity (lowest order = highest severity)
        const severities = await AlertSeverityService.findBy({
            query: {
                _id: QueryHelper.any(severityIds),
            },
            select: { order: true },
            sort: { order: SortOrder.Ascending },
            limit: 1,
            props: { isRoot: true },
        });

        return severities[0] || null;
    }

    /**
     * Get count of unique monitors in episode
     */
    private async getUniqueMonitorCount(episodeId: ObjectID): Promise<number> {
        const members = await AlertEpisodeMemberService.findBy({
            query: { episodeId },
            select: { alertId: true },
            props: { isRoot: true },
        });

        if (members.length === 0) {
            return 0;
        }

        const alertIds = members.map((m) => m.alertId!);
        const alerts = await AlertService.findBy({
            query: {
                _id: QueryHelper.any(alertIds),
            },
            select: { monitorId: true },
            props: { isRoot: true },
        });

        const uniqueMonitorIds = new Set(
            alerts.filter((a) => a.monitorId).map((a) => a.monitorId!.toString())
        );

        return uniqueMonitorIds.size;
    }

    /**
     * Refresh episode metrics from member alerts
     */
    public async refreshMetrics(episodeId: ObjectID): Promise<void> {
        const memberCount = await AlertEpisodeMemberService.countBy({
            query: { episodeId },
            props: { isRoot: true },
        });

        const uniqueMonitors = await this.getUniqueMonitorCount(episodeId);
        const highestSeverity = await this.getHighestSeverityInEpisode(episodeId);

        await this.updateOneById({
            id: episodeId,
            data: {
                alertCount: memberCount,
                uniqueMonitorCount: uniqueMonitors,
                alertSeverityId: highestSeverity?.id,
                lastActivityAt: new Date(),
            },
            props: { isRoot: true },
        });
    }
}

export default new Service();
```

---

### 2. AlertGroupingRuleService

**File Location:** `/Common/Server/Services/AlertGroupingRuleService.ts`

```typescript
import DatabaseService from './DatabaseService';
import AlertGroupingRule from '../Models/DatabaseModels/AlertGroupingRule';
import ObjectID from 'Common/Types/ObjectID';
import SortOrder from 'Common/Types/BaseDatabase/SortOrder';

export class Service extends DatabaseService<AlertGroupingRule> {
    public constructor() {
        super(AlertGroupingRule);
    }

    /**
     * Get all enabled rules for a project, sorted by priority
     */
    public async getEnabledRulesForProject(
        projectId: ObjectID
    ): Promise<Array<AlertGroupingRule>> {
        return await this.findBy({
            query: {
                projectId,
                isEnabled: true,
            },
            select: {
                _id: true,
                name: true,
                matchCriteria: true,
                groupingConfig: true,
                episodeConfig: true,
                priority: true,
            },
            sort: { priority: SortOrder.Ascending },
            props: { isRoot: true },
        });
    }
}

export default new Service();
```

---

### 3. AlertEpisodeMemberService

**File Location:** `/Common/Server/Services/AlertEpisodeMemberService.ts`

```typescript
import DatabaseService from './DatabaseService';
import AlertEpisodeMember from '../Models/DatabaseModels/AlertEpisodeMember';

export class Service extends DatabaseService<AlertEpisodeMember> {
    public constructor() {
        super(AlertEpisodeMember);
    }
}

export default new Service();
```

---

### 4. GroupingEngine

**File Location:** `/Common/Server/Utils/Alert/GroupingEngine.ts`

```typescript
import Alert from '../../Models/DatabaseModels/Alert';
import AlertEpisode from '../../Models/DatabaseModels/AlertEpisode';
import AlertGroupingRule, {
    AlertGroupingConfig,
    AlertGroupingMatchCriteria,
    AlertGroupingType,
} from '../../Models/DatabaseModels/AlertGroupingRule';
import AlertGroupingRuleService from '../../Services/AlertGroupingRuleService';
import AlertEpisodeService from '../../Services/AlertEpisodeService';
import ObjectID from 'Common/Types/ObjectID';
import QueryHelper from '../../Types/Database/QueryHelper';
import OneUptimeDate from 'Common/Types/Date';

export interface GroupingResult {
    shouldGroup: boolean;
    episodeId?: ObjectID;
    isNewEpisode: boolean;
    groupingRule?: AlertGroupingRule;
}

export default class GroupingEngine {
    /**
     * Process an alert through the grouping engine
     */
    public static async processAlert(
        alert: Alert,
        projectId: ObjectID
    ): Promise<GroupingResult> {
        // Get all enabled grouping rules for the project
        const rules = await AlertGroupingRuleService.getEnabledRulesForProject(projectId);

        if (rules.length === 0) {
            return { shouldGroup: false, isNewEpisode: false };
        }

        // Try each rule in priority order
        for (const rule of rules) {
            if (await this.matchesRule(alert, rule)) {
                const episode = await this.findMatchingEpisode(alert, rule, projectId);

                if (episode) {
                    // Add to existing episode
                    await AlertEpisodeService.addAlert({
                        episodeId: episode.id!,
                        alert,
                        addedBy: 'rule',
                        groupingRuleId: rule.id,
                    });

                    return {
                        shouldGroup: true,
                        episodeId: episode.id,
                        isNewEpisode: false,
                        groupingRule: rule,
                    };
                }

                // Create new episode
                const newEpisode = await this.createEpisode(alert, rule, projectId);

                return {
                    shouldGroup: true,
                    episodeId: newEpisode.id,
                    isNewEpisode: true,
                    groupingRule: rule,
                };
            }
        }

        return { shouldGroup: false, isNewEpisode: false };
    }

    /**
     * Check if an alert matches a grouping rule's criteria
     */
    private static async matchesRule(
        alert: Alert,
        rule: AlertGroupingRule
    ): Promise<boolean> {
        const criteria = rule.matchCriteria;

        if (!criteria) {
            return true; // No criteria means match all
        }

        // Check severity
        if (criteria.severityIds?.length) {
            const alertSeverityId = alert.alertSeverityId?.toString();
            if (!alertSeverityId || !criteria.severityIds.includes(alertSeverityId)) {
                return false;
            }
        }

        // Check monitors
        if (criteria.monitorIds?.length) {
            const alertMonitorId = alert.monitorId?.toString();
            if (!alertMonitorId || !criteria.monitorIds.includes(alertMonitorId)) {
                return false;
            }
        }

        // Check labels
        if (criteria.labelIds?.length) {
            const alertLabelIds = (alert.labels || []).map((l) => l.id?.toString());
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
                if (!regex.test(alert.title || '')) {
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
                if (!regex.test(alert.description || '')) {
                    return false;
                }
            } catch {
                // Invalid regex, skip this check
            }
        }

        return true;
    }

    /**
     * Find a matching episode for an alert based on grouping config
     */
    private static async findMatchingEpisode(
        alert: Alert,
        rule: AlertGroupingRule,
        projectId: ObjectID
    ): Promise<AlertEpisode | null> {
        const config = rule.groupingConfig;

        if (!config) {
            return null;
        }

        switch (config.type) {
            case AlertGroupingType.TimeWindow:
                return await this.findTimeWindowEpisode(alert, rule, projectId, config);

            case AlertGroupingType.FieldBased:
                return await this.findFieldBasedEpisode(alert, rule, projectId, config);

            case AlertGroupingType.Smart:
                return await this.findSmartEpisode(alert, rule, projectId, config);

            default:
                return null;
        }
    }

    /**
     * Find episode within time window
     */
    private static async findTimeWindowEpisode(
        alert: Alert,
        rule: AlertGroupingRule,
        projectId: ObjectID,
        config: AlertGroupingConfig
    ): Promise<AlertEpisode | null> {
        const windowMinutes = config.timeWindowMinutes || 60;
        const windowStart = OneUptimeDate.addRemoveMinutes(
            OneUptimeDate.getCurrentDate(),
            -windowMinutes
        );

        // Find active episode within time window for this rule
        return await AlertEpisodeService.findOneBy({
            query: {
                projectId,
                groupingRuleId: rule.id,
                lastActivityAt: QueryHelper.greaterThanEqualTo(windowStart),
                resolvedAt: QueryHelper.isNull(),
            },
            select: {
                _id: true,
                alertCount: true,
                alertSeverityId: true,
            },
            props: { isRoot: true },
        });
    }

    /**
     * Find episode with matching field values
     */
    private static async findFieldBasedEpisode(
        alert: Alert,
        rule: AlertGroupingRule,
        projectId: ObjectID,
        config: AlertGroupingConfig
    ): Promise<AlertEpisode | null> {
        const groupByFields = config.groupByFields || [];

        if (groupByFields.length === 0) {
            return null;
        }

        // Build group key from alert fields
        const groupKey = this.computeGroupKey(alert, groupByFields);

        // Find active episode with same group key
        // Note: This requires storing group key on episode or querying through members
        // For now, we'll use a simpler approach with time window fallback

        const breakAfterMinutes = rule.episodeConfig?.breakAfterMinutesInactive || 480;
        const windowStart = OneUptimeDate.addRemoveMinutes(
            OneUptimeDate.getCurrentDate(),
            -breakAfterMinutes
        );

        // Find active episodes for this rule
        const episodes = await AlertEpisodeService.findBy({
            query: {
                projectId,
                groupingRuleId: rule.id,
                lastActivityAt: QueryHelper.greaterThanEqualTo(windowStart),
                resolvedAt: QueryHelper.isNull(),
            },
            select: {
                _id: true,
            },
            limit: 10,
            props: { isRoot: true },
        });

        // Check each episode for matching group key
        for (const episode of episodes) {
            const episodeGroupKey = await this.getEpisodeGroupKey(
                episode.id!,
                groupByFields
            );
            if (episodeGroupKey === groupKey) {
                return episode;
            }
        }

        return null;
    }

    /**
     * Find episode with similar alerts (ML-based)
     */
    private static async findSmartEpisode(
        _alert: Alert,
        _rule: AlertGroupingRule,
        _projectId: ObjectID,
        _config: AlertGroupingConfig
    ): Promise<AlertEpisode | null> {
        // Future implementation: ML-based similarity matching
        // For now, fall back to time window
        return null;
    }

    /**
     * Compute a group key from alert fields
     */
    private static computeGroupKey(alert: Alert, fields: Array<string>): string {
        const values: Array<string> = [];

        for (const field of fields) {
            const value = this.getFieldValue(alert, field);
            values.push(`${field}:${value}`);
        }

        return values.join('|');
    }

    /**
     * Get a field value from an alert
     */
    private static getFieldValue(alert: Alert, field: string): string {
        switch (field) {
            case 'monitorId':
                return alert.monitorId?.toString() || '';
            case 'alertSeverityId':
            case 'severity':
                return alert.alertSeverityId?.toString() || '';
            case 'title':
                return alert.title || '';
            default:
                return '';
        }
    }

    /**
     * Get group key for an existing episode
     */
    private static async getEpisodeGroupKey(
        episodeId: ObjectID,
        fields: Array<string>
    ): Promise<string> {
        // Get first alert in episode to determine group key
        const member = await AlertEpisodeMemberService.findOneBy({
            query: { episodeId },
            select: { alertId: true },
            props: { isRoot: true },
        });

        if (!member?.alertId) {
            return '';
        }

        const alert = await AlertService.findOneById({
            id: member.alertId,
            select: {
                monitorId: true,
                alertSeverityId: true,
                title: true,
            },
            props: { isRoot: true },
        });

        if (!alert) {
            return '';
        }

        return this.computeGroupKey(alert, fields);
    }

    /**
     * Create a new episode for an alert
     */
    private static async createEpisode(
        alert: Alert,
        rule: AlertGroupingRule,
        projectId: ObjectID
    ): Promise<AlertEpisode> {
        const title = this.generateEpisodeTitle(alert, rule);

        return await AlertEpisodeService.createWithAlert({
            projectId,
            title,
            alert,
            groupingRuleId: rule.id,
        });
    }

    /**
     * Generate episode title from template
     */
    private static generateEpisodeTitle(
        alert: Alert,
        rule: AlertGroupingRule
    ): string {
        const template = rule.episodeConfig?.titleTemplate;

        if (!template) {
            return alert.title || 'Alert Episode';
        }

        // Simple template replacement
        let title = template;
        title = title.replace(/\{\{title\}\}/g, alert.title || '');
        title = title.replace(/\{\{severity\}\}/g, 'Alert'); // Would need to look up severity name

        return title;
    }
}

// Import services at the end to avoid circular dependencies
import AlertService from '../../Services/AlertService';
import AlertEpisodeMemberService from '../../Services/AlertEpisodeMemberService';
```

---

## Integration with AlertService

Modify `/Common/Server/Services/AlertService.ts` to integrate grouping.

```typescript
// In AlertService.create() method, after alert is created:

public async create(data: CreateBy<Alert>): Promise<Alert> {
    // ... existing alert creation logic ...

    const alert = await super.create(data);

    // Process through grouping engine
    if (alert.projectId) {
        try {
            const groupingResult = await GroupingEngine.processAlert(
                alert,
                alert.projectId
            );

            if (groupingResult.shouldGroup && groupingResult.episodeId) {
                // Alert is now part of an episode
                // Episode ID is already set by GroupingEngine
                logger.info(
                    `Alert ${alert.id} grouped into episode ${groupingResult.episodeId}`
                );
            }
        } catch (error) {
            // Log but don't fail alert creation
            logger.error('Error in grouping engine:', error);
        }
    }

    // ... continue with notifications ...

    return alert;
}
```

---

## Worker Jobs

### 1. EpisodeAutoResolve Job

**File Location:** `/Worker/Jobs/AlertEpisode/AutoResolve.ts`

```typescript
import RunCron from '../../Utils/Cron';
import { EVERY_FIVE_MINUTES } from 'Common/Utils/CronTime';
import AlertEpisodeService from 'Common/Server/Services/AlertEpisodeService';
import AlertEpisodeMemberService from 'Common/Server/Services/AlertEpisodeMemberService';
import AlertService from 'Common/Server/Services/AlertService';
import AlertStateService from 'Common/Server/Services/AlertStateService';
import QueryHelper from 'Common/Server/Types/Database/QueryHelper';

RunCron(
    'AlertEpisode:AutoResolve',
    { schedule: EVERY_FIVE_MINUTES, runOnStartup: false },
    async () => {
        // Find active episodes that should auto-resolve
        const activeEpisodes = await AlertEpisodeService.findBy({
            query: {
                resolvedAt: QueryHelper.isNull(),
            },
            select: {
                _id: true,
                projectId: true,
            },
            limit: 100,
            props: { isRoot: true },
        });

        for (const episode of activeEpisodes) {
            // Get all alerts in episode
            const members = await AlertEpisodeMemberService.findBy({
                query: { episodeId: episode.id! },
                select: { alertId: true },
                props: { isRoot: true },
            });

            if (members.length === 0) {
                continue;
            }

            const alertIds = members.map((m) => m.alertId!);

            // Get resolved state for project
            const resolvedState = await AlertStateService.getResolvedState(
                episode.projectId!
            );

            // Check if all alerts are resolved
            const unresolvedCount = await AlertService.countBy({
                query: {
                    _id: QueryHelper.any(alertIds),
                    currentAlertStateId: QueryHelper.notEquals(resolvedState.id!),
                },
                props: { isRoot: true },
            });

            if (unresolvedCount === 0) {
                // All alerts resolved, resolve episode
                await AlertEpisodeService.resolve({
                    episodeId: episode.id!,
                });

                logger.info(
                    `Auto-resolved episode ${episode.id} - all alerts resolved`
                );
            }
        }
    }
);
```

### 2. EpisodeBreakInactive Job

**File Location:** `/Worker/Jobs/AlertEpisode/BreakInactive.ts`

```typescript
import RunCron from '../../Utils/Cron';
import { EVERY_FIFTEEN_MINUTES } from 'Common/Utils/CronTime';
import AlertEpisodeService from 'Common/Server/Services/AlertEpisodeService';
import AlertGroupingRuleService from 'Common/Server/Services/AlertGroupingRuleService';
import QueryHelper from 'Common/Server/Types/Database/QueryHelper';
import OneUptimeDate from 'Common/Types/Date';

RunCron(
    'AlertEpisode:BreakInactive',
    { schedule: EVERY_FIFTEEN_MINUTES, runOnStartup: false },
    async () => {
        // Get all grouping rules with break settings
        const rules = await AlertGroupingRuleService.findBy({
            query: { isEnabled: true },
            select: {
                _id: true,
                projectId: true,
                episodeConfig: true,
            },
            props: { isRoot: true },
        });

        for (const rule of rules) {
            const breakAfterMinutes =
                rule.episodeConfig?.breakAfterMinutesInactive || 480;

            const cutoffTime = OneUptimeDate.addRemoveMinutes(
                OneUptimeDate.getCurrentDate(),
                -breakAfterMinutes
            );

            // Find active episodes past the break threshold
            const staleEpisodes = await AlertEpisodeService.findBy({
                query: {
                    groupingRuleId: rule.id,
                    resolvedAt: QueryHelper.isNull(),
                    lastActivityAt: QueryHelper.lessThan(cutoffTime),
                },
                select: { _id: true },
                limit: 50,
                props: { isRoot: true },
            });

            for (const episode of staleEpisodes) {
                // Resolve inactive episode
                await AlertEpisodeService.resolve({
                    episodeId: episode.id!,
                    rootCause: 'Auto-resolved due to inactivity',
                });

                logger.info(
                    `Resolved inactive episode ${episode.id} after ${breakAfterMinutes} minutes`
                );
            }
        }
    }
);
```

---

## Implementation Checklist

### Phase 1: Core Services
- [ ] Create AlertEpisode model
- [ ] Create AlertEpisodeMember model
- [ ] Create AlertGroupingRule model
- [ ] Create AlertEpisodeService
- [ ] Create AlertEpisodeMemberService
- [ ] Create AlertGroupingRuleService
- [ ] Create GroupingEngine

### Phase 2: Integration
- [ ] Modify AlertService to call GroupingEngine
- [ ] Add episodeId field to Alert model
- [ ] Update Alert model exports

### Phase 3: Worker Jobs
- [ ] Create EpisodeAutoResolve job
- [ ] Create EpisodeBreakInactive job
- [ ] Register jobs in worker startup

### Phase 4: Testing
- [ ] Unit tests for GroupingEngine
- [ ] Unit tests for AlertEpisodeService
- [ ] Integration tests for alert grouping flow
- [ ] Performance tests for high-volume scenarios
