# Backend Implementation for Alert Storm Detection

## Overview

This document details the backend services and components required for Alert Storm Detection and Noise Reduction Analytics.

## Core Components

### 1. StormDetector

Main service for detecting alert storms.

**File Location:** `/Common/Server/Utils/Alert/StormDetector.ts`

```typescript
import AlertService from '../../Services/AlertService';
import AlertStormEventService from '../../Services/AlertStormEventService';
import AlertStormEvent, {
    StormStatus,
    StormSeverity,
    AffectedMonitor,
} from '../../Models/DatabaseModels/AlertStormEvent';
import ObjectID from 'Common/Types/ObjectID';
import OneUptimeDate from 'Common/Types/Date';
import QueryHelper from '../../Types/Database/QueryHelper';

export interface StormStatus {
    isStorm: boolean;
    severity: StormSeverity | null;
    currentRate: number;
    normalRate: number;
    multiplier: number;
    affectedMonitors?: Array<AffectedMonitor>;
    activeStormEvent?: AlertStormEvent;
}

export interface StormConfig {
    // Multiplier threshold for storm detection
    stormThreshold: number;  // Default: 3

    // Multiplier threshold for critical storm
    criticalThreshold: number;  // Default: 5

    // Minimum alerts per hour to consider for storm
    minimumAlertRate: number;  // Default: 10

    // Historical lookback hours for baseline
    baselineHours: number;  // Default: 24

    // Enable emergency suppression
    enableEmergencySuppression: boolean;  // Default: false
}

export const DEFAULT_STORM_CONFIG: StormConfig = {
    stormThreshold: 3,
    criticalThreshold: 5,
    minimumAlertRate: 10,
    baselineHours: 24,
    enableEmergencySuppression: false,
};

export default class StormDetector {
    /**
     * Check current storm status for a project
     */
    public static async checkStatus(
        projectId: ObjectID,
        config?: Partial<StormConfig>
    ): Promise<StormStatus> {
        const mergedConfig = { ...DEFAULT_STORM_CONFIG, ...config };

        const now = new Date();
        const oneHourAgo = OneUptimeDate.addRemoveHours(now, -1);
        const baselineStart = OneUptimeDate.addRemoveHours(now, -mergedConfig.baselineHours);

        // Get current hour's alert count
        const currentCount = await AlertService.countBy({
            query: {
                projectId,
                createdAt: QueryHelper.greaterThan(oneHourAgo),
            },
            props: { isRoot: true },
        });

        // Get historical average (excluding current hour)
        const historicalCount = await AlertService.countBy({
            query: {
                projectId,
                createdAt: QueryHelper.between(baselineStart, oneHourAgo),
            },
            props: { isRoot: true },
        });

        const hoursInBaseline = mergedConfig.baselineHours - 1;
        const normalRate = hoursInBaseline > 0
            ? historicalCount / hoursInBaseline
            : mergedConfig.minimumAlertRate;

        const currentRate = currentCount;
        const multiplier = normalRate > 0 ? currentRate / normalRate : currentRate;

        // Determine storm status
        let isStorm = false;
        let severity: StormSeverity | null = null;

        if (multiplier >= mergedConfig.criticalThreshold) {
            isStorm = true;
            severity = StormSeverity.Critical;
        } else if (multiplier >= mergedConfig.stormThreshold) {
            isStorm = true;
            severity = StormSeverity.Storm;
        } else if (multiplier >= 2) {
            severity = StormSeverity.Elevated;
        }

        // Only consider it a storm if rate is above minimum
        if (currentRate < mergedConfig.minimumAlertRate) {
            isStorm = false;
            severity = null;
        }

        // Get affected monitors if storm
        let affectedMonitors: Array<AffectedMonitor> | undefined;
        if (isStorm) {
            affectedMonitors = await this.getTopAlertingMonitors(projectId, oneHourAgo);
        }

        // Check for active storm event
        const activeStormEvent = await AlertStormEventService.findOneBy({
            query: {
                projectId,
                status: StormStatus.Active,
            },
            select: {
                _id: true,
                startedAt: true,
                peakAlertRate: true,
            },
            props: { isRoot: true },
        });

        return {
            isStorm,
            severity,
            currentRate,
            normalRate: Math.round(normalRate * 100) / 100,
            multiplier: Math.round(multiplier * 100) / 100,
            affectedMonitors,
            activeStormEvent: activeStormEvent || undefined,
        };
    }

    /**
     * Get top alerting monitors
     */
    private static async getTopAlertingMonitors(
        projectId: ObjectID,
        since: Date
    ): Promise<Array<AffectedMonitor>> {
        const result = await AlertService.aggregate({
            pipeline: [
                {
                    $match: {
                        projectId: projectId.toString(),
                        createdAt: { $gte: since },
                        monitorId: { $ne: null },
                    },
                },
                {
                    $group: {
                        _id: '$monitorId',
                        count: { $sum: 1 },
                    },
                },
                { $sort: { count: -1 } },
                { $limit: 10 },
            ],
        });

        // Get monitor names
        const monitorIds = result.map((r) => new ObjectID(r._id));
        const monitors = await MonitorService.findBy({
            query: {
                _id: QueryHelper.any(monitorIds),
            },
            select: { _id: true, name: true },
            props: { isRoot: true },
        });

        const monitorMap = new Map(
            monitors.map((m) => [m.id?.toString(), m.name])
        );

        return result.map((r) => ({
            monitorId: r._id,
            monitorName: monitorMap.get(r._id) || 'Unknown',
            alertCount: r.count,
        }));
    }

    /**
     * Process storm detection and create/update storm events
     */
    public static async processStormDetection(
        projectId: ObjectID,
        config?: Partial<StormConfig>
    ): Promise<void> {
        const status = await this.checkStatus(projectId, config);

        if (status.isStorm && !status.activeStormEvent) {
            // New storm detected - create event
            await this.createStormEvent(projectId, status);
        } else if (status.isStorm && status.activeStormEvent) {
            // Storm ongoing - update event
            await this.updateStormEvent(status.activeStormEvent.id!, status);
        } else if (!status.isStorm && status.activeStormEvent) {
            // Storm ended - resolve event
            await this.resolveStormEvent(status.activeStormEvent.id!);
        }
    }

    /**
     * Create a new storm event
     */
    private static async createStormEvent(
        projectId: ObjectID,
        status: StormStatus
    ): Promise<AlertStormEvent> {
        const event = await AlertStormEventService.create({
            data: {
                projectId,
                status: StormStatus.Active,
                severity: status.severity!,
                startedAt: new Date(),
                peakAlertRate: status.currentRate,
                normalAlertRate: status.normalRate,
                multiplier: status.multiplier,
                affectedMonitors: status.affectedMonitors,
                totalAlertsInStorm: status.currentRate,
            } as AlertStormEvent,
            props: { isRoot: true },
        });

        // Send notifications
        await NotificationService.sendStormStartNotification({
            projectId,
            stormEvent: event,
        });

        logger.info(`Storm detected for project ${projectId}: ${status.multiplier}x normal`);

        return event;
    }

    /**
     * Update an ongoing storm event
     */
    private static async updateStormEvent(
        eventId: ObjectID,
        status: StormStatus
    ): Promise<void> {
        const event = await AlertStormEventService.findOneById({
            id: eventId,
            select: { peakAlertRate: true, totalAlertsInStorm: true },
            props: { isRoot: true },
        });

        if (!event) return;

        await AlertStormEventService.updateOneById({
            id: eventId,
            data: {
                peakAlertRate: Math.max(event.peakAlertRate || 0, status.currentRate),
                multiplier: Math.max(event.multiplier || 0, status.multiplier),
                totalAlertsInStorm: (event.totalAlertsInStorm || 0) + status.currentRate,
                affectedMonitors: status.affectedMonitors,
            },
            props: { isRoot: true },
        });
    }

    /**
     * Resolve a storm event
     */
    private static async resolveStormEvent(eventId: ObjectID): Promise<void> {
        const event = await AlertStormEventService.findOneById({
            id: eventId,
            select: { startedAt: true, projectId: true },
            props: { isRoot: true },
        });

        if (!event) return;

        const now = new Date();
        const durationMinutes = Math.round(
            (now.getTime() - event.startedAt!.getTime()) / 60000
        );

        await AlertStormEventService.updateOneById({
            id: eventId,
            data: {
                status: StormStatus.Resolved,
                endedAt: now,
                durationMinutes,
            },
            props: { isRoot: true },
        });

        // Send notification
        await NotificationService.sendStormEndNotification({
            projectId: event.projectId!,
            stormEventId: eventId,
            durationMinutes,
        });

        logger.info(`Storm resolved for project ${event.projectId} after ${durationMinutes} minutes`);
    }
}

import MonitorService from '../../Services/MonitorService';
import NotificationService from '../../Services/NotificationService';
import logger from '../../Utils/Logger';
```

---

### 2. NoiseReductionAnalytics

Service for calculating and retrieving noise reduction metrics.

**File Location:** `/Common/Server/Utils/Alert/NoiseReductionAnalytics.ts`

```typescript
import NoiseReductionMetric from '../../Models/DatabaseModels/NoiseReductionMetric';
import NoiseReductionMetricService from '../../Services/NoiseReductionMetricService';
import AlertService from '../../Services/AlertService';
import SuppressedAlertLogService from '../../Services/SuppressedAlertLogService';
import AlertFingerprintService from '../../Services/AlertFingerprintService';
import AlertEpisodeService from '../../Services/AlertEpisodeService';
import ObjectID from 'Common/Types/ObjectID';
import OneUptimeDate from 'Common/Types/Date';
import QueryHelper from '../../Types/Database/QueryHelper';

export interface NoiseReductionSummary {
    period: {
        startDate: Date;
        endDate: Date;
    };
    totalAlertTriggers: number;
    alertsCreated: number;
    deduplicated: number;
    suppressed: number;
    grouped: number;
    notificationsSent: number;
    noiseReductionPercent: number;
}

export default class NoiseReductionAnalytics {
    /**
     * Calculate daily noise reduction metrics for a project
     */
    public static async calculateDailyMetrics(
        projectId: ObjectID,
        date: Date
    ): Promise<NoiseReductionMetric> {
        const startOfDay = OneUptimeDate.getStartOfDay(date);
        const endOfDay = OneUptimeDate.getEndOfDay(date);

        // Count alerts created
        const alertsCreated = await AlertService.countBy({
            query: {
                projectId,
                createdAt: QueryHelper.between(startOfDay, endOfDay),
            },
            props: { isRoot: true },
        });

        // Count deduplicated
        const fingerprints = await AlertFingerprintService.findBy({
            query: {
                projectId,
                windowStartAt: QueryHelper.between(startOfDay, endOfDay),
            },
            select: { duplicateCount: true },
            props: { isRoot: true },
        });
        const deduplicated = fingerprints.reduce(
            (sum, fp) => sum + (fp.duplicateCount || 0),
            0
        );

        // Count suppressed
        const suppressed = await SuppressedAlertLogService.countBy({
            query: {
                projectId,
                suppressedAt: QueryHelper.between(startOfDay, endOfDay),
            },
            props: { isRoot: true },
        });

        // Count grouped alerts
        const alertsGrouped = await AlertService.countBy({
            query: {
                projectId,
                createdAt: QueryHelper.between(startOfDay, endOfDay),
                episodeId: QueryHelper.notNull(),
            },
            props: { isRoot: true },
        });

        // Count episodes created
        const episodesCreated = await AlertEpisodeService.countBy({
            query: {
                projectId,
                startedAt: QueryHelper.between(startOfDay, endOfDay),
            },
            props: { isRoot: true },
        });

        // Calculate totals
        const totalAlertTriggers = alertsCreated + deduplicated + suppressed;
        const noiseReductionPercent = totalAlertTriggers > 0
            ? ((deduplicated + suppressed) / totalAlertTriggers) * 100
            : 0;

        // Create or update metric
        const existingMetric = await NoiseReductionMetricService.findOneBy({
            query: {
                projectId,
                date: startOfDay,
            },
            select: { _id: true },
            props: { isRoot: true },
        });

        const metricData: Partial<NoiseReductionMetric> = {
            projectId,
            date: startOfDay,
            totalAlertTriggers,
            alertsCreated,
            deduplicated,
            suppressed,
            alertsGrouped,
            episodesCreated,
            noiseReductionPercent: Math.round(noiseReductionPercent * 100) / 100,
        };

        if (existingMetric) {
            await NoiseReductionMetricService.updateOneById({
                id: existingMetric.id!,
                data: metricData,
                props: { isRoot: true },
            });
            return { ...existingMetric, ...metricData } as NoiseReductionMetric;
        }

        return await NoiseReductionMetricService.create({
            data: metricData as NoiseReductionMetric,
            props: { isRoot: true },
        });
    }

    /**
     * Get noise reduction summary for a date range
     */
    public static async getSummary(
        projectId: ObjectID,
        startDate: Date,
        endDate: Date
    ): Promise<NoiseReductionSummary> {
        const metrics = await NoiseReductionMetricService.findBy({
            query: {
                projectId,
                date: QueryHelper.between(startDate, endDate),
            },
            select: {
                totalAlertTriggers: true,
                alertsCreated: true,
                deduplicated: true,
                suppressed: true,
                alertsGrouped: true,
                notificationsSent: true,
            },
            props: { isRoot: true },
        });

        const totals = metrics.reduce(
            (acc, m) => ({
                totalAlertTriggers: acc.totalAlertTriggers + (m.totalAlertTriggers || 0),
                alertsCreated: acc.alertsCreated + (m.alertsCreated || 0),
                deduplicated: acc.deduplicated + (m.deduplicated || 0),
                suppressed: acc.suppressed + (m.suppressed || 0),
                grouped: acc.grouped + (m.alertsGrouped || 0),
                notificationsSent: acc.notificationsSent + (m.notificationsSent || 0),
            }),
            {
                totalAlertTriggers: 0,
                alertsCreated: 0,
                deduplicated: 0,
                suppressed: 0,
                grouped: 0,
                notificationsSent: 0,
            }
        );

        const noiseReductionPercent = totals.totalAlertTriggers > 0
            ? ((totals.deduplicated + totals.suppressed) / totals.totalAlertTriggers) * 100
            : 0;

        return {
            period: { startDate, endDate },
            ...totals,
            noiseReductionPercent: Math.round(noiseReductionPercent * 100) / 100,
        };
    }
}
```

---

### 3. Worker Jobs

#### Storm Monitor Job

**File Location:** `/Worker/Jobs/AlertStorm/Monitor.ts`

```typescript
import RunCron from '../../Utils/Cron';
import { EVERY_FIVE_MINUTES } from 'Common/Utils/CronTime';
import StormDetector from 'Common/Server/Utils/Alert/StormDetector';
import ProjectService from 'Common/Server/Services/ProjectService';

RunCron(
    'AlertStorm:Monitor',
    { schedule: EVERY_FIVE_MINUTES, runOnStartup: false },
    async () => {
        // Get all active projects
        const projects = await ProjectService.findBy({
            query: { isBlocked: false },
            select: { _id: true },
            limit: 1000,
            props: { isRoot: true },
        });

        for (const project of projects) {
            try {
                await StormDetector.processStormDetection(project.id!);
            } catch (error) {
                logger.error(
                    `Error processing storm detection for project ${project.id}:`,
                    error
                );
            }
        }
    }
);
```

#### Daily Metrics Job

**File Location:** `/Worker/Jobs/NoiseReduction/DailyMetrics.ts`

```typescript
import RunCron from '../../Utils/Cron';
import { EVERY_DAY_AT_MIDNIGHT } from 'Common/Utils/CronTime';
import NoiseReductionAnalytics from 'Common/Server/Utils/Alert/NoiseReductionAnalytics';
import ProjectService from 'Common/Server/Services/ProjectService';
import OneUptimeDate from 'Common/Types/Date';

RunCron(
    'NoiseReduction:DailyMetrics',
    { schedule: EVERY_DAY_AT_MIDNIGHT, runOnStartup: false },
    async () => {
        // Calculate metrics for yesterday
        const yesterday = OneUptimeDate.addRemoveDays(
            OneUptimeDate.getCurrentDate(),
            -1
        );

        const projects = await ProjectService.findBy({
            query: { isBlocked: false },
            select: { _id: true },
            limit: 1000,
            props: { isRoot: true },
        });

        for (const project of projects) {
            try {
                await NoiseReductionAnalytics.calculateDailyMetrics(
                    project.id!,
                    yesterday
                );
            } catch (error) {
                logger.error(
                    `Error calculating metrics for project ${project.id}:`,
                    error
                );
            }
        }

        logger.info(`Calculated daily noise reduction metrics for ${projects.length} projects`);
    }
);
```

---

## Implementation Checklist

### Phase 1: Storm Detection
- [ ] Create StormDetector utility
- [ ] Create AlertStormEventService
- [ ] Implement storm detection algorithm
- [ ] Create storm monitor worker job

### Phase 2: Notifications
- [ ] Storm start notification
- [ ] Storm end notification
- [ ] Admin notification integration

### Phase 3: Analytics
- [ ] Create NoiseReductionAnalytics utility
- [ ] Create NoiseReductionMetricService
- [ ] Implement daily metrics calculation
- [ ] Create daily metrics worker job

### Phase 4: Testing
- [ ] Unit tests for StormDetector
- [ ] Unit tests for NoiseReductionAnalytics
- [ ] Integration tests for worker jobs
