# Data Models for Alert Storm Detection

## Overview

This document defines the database models required for Alert Storm Detection and Noise Reduction Analytics functionality.

## Entity Relationship Diagram

```
┌─────────────────────────┐
│    AlertStormEvent      │
├─────────────────────────┤
│ id                      │
│ projectId               │
│ status (active/resolved)│
│ startedAt               │
│ endedAt                 │
│ peakAlertRate           │
│ normalAlertRate         │
│ multiplier              │
│ affectedMonitors (JSON) │
│ totalAlertsInStorm      │
└─────────────────────────┘

┌─────────────────────────┐
│  NoiseReductionMetric   │
├─────────────────────────┤
│ id                      │
│ projectId               │
│ date                    │
│ totalAlerts             │
│ deduplicated            │
│ suppressed              │
│ grouped                 │
│ notificationsSent       │
│ noiseReductionPercent   │
└─────────────────────────┘

┌─────────────────────────┐
│  AlertVolumeSnapshot    │
├─────────────────────────┤
│ id                      │
│ projectId               │
│ timestamp               │
│ alertCount              │
│ intervalMinutes         │
└─────────────────────────┘
```

---

## Model Definitions

### 1. AlertStormEvent

Records storm events for tracking and analysis.

**File Location:** `/Common/Models/DatabaseModels/AlertStormEvent.ts`

```typescript
import {
    Column,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
} from 'typeorm';
import BaseModel from './DatabaseBaseModel/DatabaseBaseModel';
import Project from './Project';
import ObjectID from 'Common/Types/ObjectID';
import ColumnType from 'Common/Types/Database/ColumnType';
import TableColumnType from 'Common/Types/Database/TableColumnType';
import Permission from 'Common/Types/Permission';
import IconProp from 'Common/Types/Icon/IconProp';

export enum StormStatus {
    Active = 'active',
    Resolved = 'resolved',
}

export enum StormSeverity {
    Elevated = 'elevated',    // 2x - 3x normal
    Storm = 'storm',          // 3x - 5x normal
    Critical = 'critical',    // > 5x normal
}

export interface AffectedMonitor {
    monitorId: string;
    monitorName: string;
    alertCount: number;
}

@EnableDocumentation()
@TableAccessControl({
    create: [],
    read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
    update: [],
    delete: [Permission.ProjectOwner, Permission.ProjectAdmin],
})
@CrudApiEndpoint(new Route('/alert-storm-event'))
@TableMetadata({
    tableName: 'AlertStormEvent',
    singularName: 'Storm Event',
    pluralName: 'Storm Events',
    icon: IconProp.Alert,
    tableDescription: 'Records of alert storm events',
})
@Entity({
    name: 'AlertStormEvent',
})
export default class AlertStormEvent extends BaseModel {
    // ─────────────────────────────────────────────────────────────
    // PROJECT
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Entity,
        modelType: Project,
        title: 'Project',
    })
    @ManyToOne(() => Project, {
        onDelete: 'CASCADE',
        orphanedRowAction: 'delete',
    })
    @JoinColumn({ name: 'projectId' })
    public project?: Project = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.ObjectID,
        title: 'Project ID',
    })
    @Column({
        type: ColumnType.ObjectID,
        nullable: false,
    })
    @Index()
    public projectId?: ObjectID = undefined;

    // ─────────────────────────────────────────────────────────────
    // STATUS
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.ShortText,
        title: 'Status',
        description: 'Current status of the storm',
    })
    @Column({
        type: ColumnType.ShortText,
        length: 20,
        nullable: false,
    })
    @Index()
    public status?: StormStatus = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.ShortText,
        title: 'Severity',
        description: 'Severity level of the storm',
    })
    @Column({
        type: ColumnType.ShortText,
        length: 20,
        nullable: false,
    })
    public severity?: StormSeverity = undefined;

    // ─────────────────────────────────────────────────────────────
    // TIMING
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Date,
        title: 'Started At',
        description: 'When the storm was first detected',
    })
    @Column({
        type: ColumnType.Date,
        nullable: false,
    })
    @Index()
    public startedAt?: Date = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Date,
        title: 'Ended At',
        description: 'When the storm ended',
    })
    @Column({
        type: ColumnType.Date,
        nullable: true,
    })
    public endedAt?: Date = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Number,
        title: 'Duration Minutes',
        description: 'Total duration of the storm in minutes',
    })
    @Column({
        type: ColumnType.Number,
        nullable: true,
    })
    public durationMinutes?: number = undefined;

    // ─────────────────────────────────────────────────────────────
    // METRICS
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Number,
        title: 'Peak Alert Rate',
        description: 'Peak alerts per hour during storm',
    })
    @Column({
        type: ColumnType.Number,
        nullable: false,
    })
    public peakAlertRate?: number = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Number,
        title: 'Normal Alert Rate',
        description: 'Normal alerts per hour (baseline)',
    })
    @Column({
        type: ColumnType.Number,
        nullable: false,
    })
    public normalAlertRate?: number = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Number,
        title: 'Multiplier',
        description: 'How many times normal the peak rate was',
    })
    @Column({
        type: ColumnType.Decimal,
        precision: 5,
        scale: 2,
        nullable: false,
    })
    public multiplier?: number = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Number,
        title: 'Total Alerts',
        description: 'Total alerts during the storm',
    })
    @Column({
        type: ColumnType.Number,
        nullable: false,
        default: 0,
    })
    public totalAlertsInStorm?: number = undefined;

    // ─────────────────────────────────────────────────────────────
    // AFFECTED MONITORS
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.JSON,
        title: 'Affected Monitors',
        description: 'Top monitors contributing to the storm',
    })
    @Column({
        type: ColumnType.JSON,
        nullable: true,
    })
    public affectedMonitors?: Array<AffectedMonitor> = undefined;

    // ─────────────────────────────────────────────────────────────
    // SUPPRESSION
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Boolean,
        title: 'Emergency Suppression Active',
        description: 'Whether emergency suppression was activated',
    })
    @Column({
        type: ColumnType.Boolean,
        nullable: false,
        default: false,
    })
    public emergencySuppressionActive?: boolean = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Number,
        title: 'Suppressed During Storm',
        description: 'Alerts suppressed during storm (if emergency suppression active)',
    })
    @Column({
        type: ColumnType.Number,
        nullable: false,
        default: 0,
    })
    public suppressedDuringStorm?: number = undefined;
}
```

---

### 2. NoiseReductionMetric

Daily metrics for noise reduction analytics.

**File Location:** `/Common/Models/DatabaseModels/NoiseReductionMetric.ts`

```typescript
@TableMetadata({
    tableName: 'NoiseReductionMetric',
    singularName: 'Noise Reduction Metric',
    pluralName: 'Noise Reduction Metrics',
    icon: IconProp.ChartBar,
    tableDescription: 'Daily noise reduction statistics',
})
@Entity({
    name: 'NoiseReductionMetric',
})
export default class NoiseReductionMetric extends BaseModel {
    // ─────────────────────────────────────────────────────────────
    // PROJECT
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.ObjectID,
        title: 'Project ID',
    })
    @Column({
        type: ColumnType.ObjectID,
        nullable: false,
    })
    @Index()
    public projectId?: ObjectID = undefined;

    // ─────────────────────────────────────────────────────────────
    // DATE
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Date,
        title: 'Date',
        description: 'Date for these metrics',
    })
    @Column({
        type: ColumnType.Date,
        nullable: false,
    })
    @Index()
    public date?: Date = undefined;

    // ─────────────────────────────────────────────────────────────
    // ALERT COUNTS
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Number,
        title: 'Total Alert Triggers',
        description: 'Total number of alert triggers (before noise reduction)',
    })
    @Column({
        type: ColumnType.Number,
        nullable: false,
        default: 0,
    })
    public totalAlertTriggers?: number = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Number,
        title: 'Alerts Created',
        description: 'Actual alerts created (after deduplication/suppression)',
    })
    @Column({
        type: ColumnType.Number,
        nullable: false,
        default: 0,
    })
    public alertsCreated?: number = undefined;

    // ─────────────────────────────────────────────────────────────
    // DEDUPLICATION METRICS
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Number,
        title: 'Deduplicated',
        description: 'Alerts prevented by deduplication',
    })
    @Column({
        type: ColumnType.Number,
        nullable: false,
        default: 0,
    })
    public deduplicated?: number = undefined;

    // ─────────────────────────────────────────────────────────────
    // SUPPRESSION METRICS
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Number,
        title: 'Suppressed',
        description: 'Alerts prevented by suppression rules',
    })
    @Column({
        type: ColumnType.Number,
        nullable: false,
        default: 0,
    })
    public suppressed?: number = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Number,
        title: 'Suppressed by Maintenance',
        description: 'Alerts suppressed by maintenance windows',
    })
    @Column({
        type: ColumnType.Number,
        nullable: false,
        default: 0,
    })
    public suppressedByMaintenance?: number = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Number,
        title: 'Suppressed by Rate Limit',
        description: 'Alerts suppressed by rate limits',
    })
    @Column({
        type: ColumnType.Number,
        nullable: false,
        default: 0,
    })
    public suppressedByRateLimit?: number = undefined;

    // ─────────────────────────────────────────────────────────────
    // GROUPING METRICS
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Number,
        title: 'Alerts Grouped',
        description: 'Alerts grouped into episodes',
    })
    @Column({
        type: ColumnType.Number,
        nullable: false,
        default: 0,
    })
    public alertsGrouped?: number = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Number,
        title: 'Episodes Created',
        description: 'Number of episodes created',
    })
    @Column({
        type: ColumnType.Number,
        nullable: false,
        default: 0,
    })
    public episodesCreated?: number = undefined;

    // ─────────────────────────────────────────────────────────────
    // NOTIFICATION METRICS
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Number,
        title: 'Notifications Sent',
        description: 'Actual notifications sent (after all filtering)',
    })
    @Column({
        type: ColumnType.Number,
        nullable: false,
        default: 0,
    })
    public notificationsSent?: number = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Number,
        title: 'Notifications Suppressed',
        description: 'Notifications that were suppressed',
    })
    @Column({
        type: ColumnType.Number,
        nullable: false,
        default: 0,
    })
    public notificationsSuppressed?: number = undefined;

    // ─────────────────────────────────────────────────────────────
    // CALCULATED METRICS
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Number,
        title: 'Noise Reduction Percent',
        description: 'Overall noise reduction percentage',
    })
    @Column({
        type: ColumnType.Decimal,
        precision: 5,
        scale: 2,
        nullable: false,
        default: 0,
    })
    public noiseReductionPercent?: number = undefined;
}
```

---

### 3. AlertVolumeSnapshot

Periodic snapshots of alert volume for trend analysis.

**File Location:** `/Common/Models/DatabaseModels/AlertVolumeSnapshot.ts`

```typescript
@TableMetadata({
    tableName: 'AlertVolumeSnapshot',
    singularName: 'Volume Snapshot',
    pluralName: 'Volume Snapshots',
    icon: IconProp.ChartLine,
    tableDescription: 'Periodic alert volume snapshots',
})
@Entity({
    name: 'AlertVolumeSnapshot',
})
export default class AlertVolumeSnapshot extends BaseModel {
    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.ObjectID,
        title: 'Project ID',
    })
    @Column({
        type: ColumnType.ObjectID,
        nullable: false,
    })
    @Index()
    public projectId?: ObjectID = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Date,
        title: 'Timestamp',
        description: 'When this snapshot was taken',
    })
    @Column({
        type: ColumnType.Date,
        nullable: false,
    })
    @Index()
    public timestamp?: Date = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Number,
        title: 'Alert Count',
        description: 'Number of alerts in this interval',
    })
    @Column({
        type: ColumnType.Number,
        nullable: false,
    })
    public alertCount?: number = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Number,
        title: 'Interval Minutes',
        description: 'Interval size in minutes (e.g., 5, 15, 60)',
    })
    @Column({
        type: ColumnType.Number,
        nullable: false,
        default: 5,
    })
    public intervalMinutes?: number = undefined;
}
```

---

## Database Indexes

```sql
-- AlertStormEvent indexes
CREATE INDEX idx_storm_event_project_status
ON "AlertStormEvent" ("projectId", "status", "startedAt" DESC);

CREATE INDEX idx_storm_event_active
ON "AlertStormEvent" ("projectId", "status")
WHERE "status" = 'active';

-- NoiseReductionMetric indexes
CREATE INDEX idx_noise_metric_project_date
ON "NoiseReductionMetric" ("projectId", "date" DESC);

CREATE UNIQUE INDEX idx_noise_metric_unique
ON "NoiseReductionMetric" ("projectId", "date");

-- AlertVolumeSnapshot indexes
CREATE INDEX idx_volume_snapshot_project_time
ON "AlertVolumeSnapshot" ("projectId", "timestamp" DESC);

-- Partition by time for efficient cleanup
-- Consider partitioning AlertVolumeSnapshot by month
```

---

## Implementation Checklist

- [ ] Create AlertStormEvent model
- [ ] Create NoiseReductionMetric model
- [ ] Create AlertVolumeSnapshot model
- [ ] Register models in model registry
- [ ] Create database migrations
- [ ] Add indexes
- [ ] Update API permissions
