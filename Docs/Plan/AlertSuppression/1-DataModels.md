# Data Models for Alert Suppression

## Overview

This document defines the database models required for Alert Suppression functionality.

## Entity Relationship Diagram

```
┌─────────────────────────┐       ┌─────────────────────────┐
│  AlertSuppressionGroup  │       │  AlertSuppressionRule   │
├─────────────────────────┤       ├─────────────────────────┤
│ id                      │◄──────│ id                      │
│ projectId               │       │ projectId               │
│ name                    │       │ suppressionGroupId      │
│ description             │       │ name                    │
│ throttleMinutes         │       │ type                    │
└─────────────────────────┘       │ matchCriteria           │
                                  │ maintenanceWindow       │
                                  │ rateLimit               │
                                  │ action                  │
                                  │ isEnabled               │
                                  └───────────┬─────────────┘
                                              │
                                              │ Referenced by
                                              ▼
┌─────────────────────────┐       ┌─────────────────────────┐
│   AlertThrottleState    │       │   SuppressedAlertLog    │
├─────────────────────────┤       ├─────────────────────────┤
│ id                      │       │ id                      │
│ projectId               │       │ projectId               │
│ suppressionRuleId       │───────│ suppressionRuleId       │
│ throttleKey             │       │ alertData (JSON)        │
│ alertCount              │       │ suppressionReason       │
│ windowExpiresAt         │       │ action                  │
│ isThrottling            │       │ suppressedAt            │
└─────────────────────────┘       └─────────────────────────┘
```

---

## Model Definitions

### 1. AlertSuppressionRule

Main model for configuring suppression rules.

**File Location:** `/Common/Models/DatabaseModels/AlertSuppressionRule.ts`

```typescript
import {
    Column,
    Entity,
    Index,
    JoinColumn,
    JoinTable,
    ManyToMany,
    ManyToOne,
} from 'typeorm';
import BaseModel from './DatabaseBaseModel/DatabaseBaseModel';
import Project from './Project';
import AlertSuppressionGroup from './AlertSuppressionGroup';
import Monitor from './Monitor';
import AlertSeverity from './AlertSeverity';
import Label from './Label';
import User from './User';
import ObjectID from 'Common/Types/ObjectID';
import ColumnType from 'Common/Types/Database/ColumnType';
import ColumnLength from 'Common/Types/Database/ColumnLength';
import TableColumnType from 'Common/Types/Database/TableColumnType';
import Permission from 'Common/Types/Permission';
import IconProp from 'Common/Types/Icon/IconProp';

// ─────────────────────────────────────────────────────────────
// TYPE DEFINITIONS
// ─────────────────────────────────────────────────────────────

export enum SuppressionRuleType {
    MaintenanceWindow = 'maintenance_window',
    ConditionBased = 'condition_based',
    RateLimit = 'rate_limit',
}

export enum SuppressionAction {
    SuppressCreation = 'suppress_creation',
    SuppressNotifications = 'suppress_notifications',
    Both = 'both',
}

export interface SuppressionMatchCriteria {
    // Match by severity
    severityIds?: Array<string>;

    // Match by monitors
    monitorIds?: Array<string>;

    // Match by labels
    labelIds?: Array<string>;

    // Match by title pattern (regex)
    titlePattern?: string;

    // Match by description pattern (regex)
    descriptionPattern?: string;

    // Match all alerts (when no criteria specified)
    matchAll?: boolean;
}

export interface MaintenanceWindowConfig {
    // Start time of window
    startTime: Date;

    // End time of window
    endTime: Date;

    // Timezone for the window
    timezone: string;

    // Is this a recurring window?
    isRecurring: boolean;

    // RRULE format for recurrence (e.g., "FREQ=WEEKLY;BYDAY=SU")
    recurrenceRule?: string;

    // End date for recurring windows (optional)
    recurrenceEndDate?: Date;
}

export interface RateLimitConfig {
    // Maximum alerts allowed in window
    maxAlerts: number;

    // Time window in minutes
    timeWindowMinutes: number;

    // Fields to group rate limit by (e.g., ['monitorId'])
    groupByFields?: Array<string>;
}

export interface ConditionConfig {
    // Suppress when another alert is active with these labels
    whenAlertActiveWithLabelIds?: Array<string>;

    // Suppress when monitor is in specific state
    whenMonitorInStateIds?: Array<string>;

    // Custom condition expression (future)
    expression?: string;
}

// ─────────────────────────────────────────────────────────────
// MODEL DEFINITION
// ─────────────────────────────────────────────────────────────

@EnableDocumentation()
@TableAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    delete: [Permission.ProjectOwner, Permission.ProjectAdmin],
})
@CrudApiEndpoint(new Route('/alert-suppression-rule'))
@TableMetadata({
    tableName: 'AlertSuppressionRule',
    singularName: 'Suppression Rule',
    pluralName: 'Suppression Rules',
    icon: IconProp.Stop,
    tableDescription: 'Rules for suppressing alert creation or notifications',
})
@Entity({
    name: 'AlertSuppressionRule',
})
export default class AlertSuppressionRule extends BaseModel {
    // ─────────────────────────────────────────────────────────────
    // IDENTIFICATION
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    })
    @TableColumn({
        type: TableColumnType.ShortText,
        title: 'Name',
        description: 'Name of this suppression rule',
        required: true,
    })
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        nullable: false,
    })
    public name?: string = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    })
    @TableColumn({
        type: TableColumnType.LongText,
        title: 'Description',
        description: 'Description of what this rule does',
    })
    @Column({
        type: ColumnType.LongText,
        nullable: true,
    })
    public description?: string = undefined;

    // ─────────────────────────────────────────────────────────────
    // PROJECT
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Entity,
        modelType: Project,
        title: 'Project',
        description: 'Project this rule belongs to',
    })
    @ManyToOne(() => Project, {
        onDelete: 'CASCADE',
        orphanedRowAction: 'delete',
    })
    @JoinColumn({ name: 'projectId' })
    public project?: Project = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
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
    // RULE TYPE & STATUS
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    })
    @TableColumn({
        type: TableColumnType.ShortText,
        title: 'Rule Type',
        description: 'Type of suppression rule',
        required: true,
    })
    @Column({
        type: ColumnType.ShortText,
        length: 50,
        nullable: false,
    })
    public type?: SuppressionRuleType = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    })
    @TableColumn({
        type: TableColumnType.Boolean,
        title: 'Enabled',
        description: 'Whether this rule is active',
    })
    @Column({
        type: ColumnType.Boolean,
        nullable: false,
        default: true,
    })
    public isEnabled?: boolean = undefined;

    // ─────────────────────────────────────────────────────────────
    // MATCHING CRITERIA
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    })
    @TableColumn({
        type: TableColumnType.JSON,
        title: 'Match Criteria',
        description: 'Criteria for which alerts this rule applies to',
    })
    @Column({
        type: ColumnType.JSON,
        nullable: true,
    })
    public matchCriteria?: SuppressionMatchCriteria = undefined;

    // ─────────────────────────────────────────────────────────────
    // MAINTENANCE WINDOW CONFIG
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    })
    @TableColumn({
        type: TableColumnType.JSON,
        title: 'Maintenance Window',
        description: 'Configuration for maintenance window suppression',
    })
    @Column({
        type: ColumnType.JSON,
        nullable: true,
    })
    public maintenanceWindow?: MaintenanceWindowConfig = undefined;

    // ─────────────────────────────────────────────────────────────
    // CONDITION CONFIG
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    })
    @TableColumn({
        type: TableColumnType.JSON,
        title: 'Condition',
        description: 'Configuration for condition-based suppression',
    })
    @Column({
        type: ColumnType.JSON,
        nullable: true,
    })
    public condition?: ConditionConfig = undefined;

    // ─────────────────────────────────────────────────────────────
    // RATE LIMIT CONFIG
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    })
    @TableColumn({
        type: TableColumnType.JSON,
        title: 'Rate Limit',
        description: 'Configuration for rate limit suppression',
    })
    @Column({
        type: ColumnType.JSON,
        nullable: true,
    })
    public rateLimit?: RateLimitConfig = undefined;

    // ─────────────────────────────────────────────────────────────
    // ACTION
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    })
    @TableColumn({
        type: TableColumnType.ShortText,
        title: 'Action',
        description: 'What to suppress when rule matches',
        required: true,
    })
    @Column({
        type: ColumnType.ShortText,
        length: 50,
        nullable: false,
        default: SuppressionAction.Both,
    })
    public action?: SuppressionAction = undefined;

    // ─────────────────────────────────────────────────────────────
    // SUPPRESSION GROUP
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    })
    @TableColumn({
        type: TableColumnType.Entity,
        modelType: AlertSuppressionGroup,
        title: 'Suppression Group',
        description: 'Group this rule belongs to (for coordinated suppression)',
    })
    @ManyToOne(() => AlertSuppressionGroup, {
        onDelete: 'SET NULL',
        nullable: true,
    })
    @JoinColumn({ name: 'suppressionGroupId' })
    public suppressionGroup?: AlertSuppressionGroup = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    })
    @TableColumn({
        type: TableColumnType.ObjectID,
        title: 'Suppression Group ID',
    })
    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
    })
    @Index()
    public suppressionGroupId?: ObjectID = undefined;

    // ─────────────────────────────────────────────────────────────
    // PRIORITY
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    })
    @TableColumn({
        type: TableColumnType.Number,
        title: 'Priority',
        description: 'Rule priority (lower = higher priority)',
    })
    @Column({
        type: ColumnType.Number,
        nullable: false,
        default: 100,
    })
    public priority?: number = undefined;

    // ─────────────────────────────────────────────────────────────
    // STATISTICS
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Number,
        title: 'Suppressed Count',
        description: 'Total number of alerts suppressed by this rule',
    })
    @Column({
        type: ColumnType.Number,
        nullable: false,
        default: 0,
    })
    public suppressedCount?: number = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Date,
        title: 'Last Triggered At',
        description: 'When this rule last suppressed an alert',
    })
    @Column({
        type: ColumnType.Date,
        nullable: true,
    })
    public lastTriggeredAt?: Date = undefined;

    // ─────────────────────────────────────────────────────────────
    // OWNERSHIP
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Entity,
        modelType: User,
        title: 'Created By',
        description: 'User who created this rule',
    })
    @ManyToOne(() => User, {
        onDelete: 'SET NULL',
        nullable: true,
    })
    @JoinColumn({ name: 'createdByUserId' })
    public createdByUser?: User = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.ObjectID,
        title: 'Created By User ID',
    })
    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
    })
    public createdByUserId?: ObjectID = undefined;
}
```

---

### 2. AlertSuppressionGroup

Groups related suppression rules for coordinated suppression.

**File Location:** `/Common/Models/DatabaseModels/AlertSuppressionGroup.ts`

```typescript
@EnableDocumentation()
@TableAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    delete: [Permission.ProjectOwner, Permission.ProjectAdmin],
})
@CrudApiEndpoint(new Route('/alert-suppression-group'))
@TableMetadata({
    tableName: 'AlertSuppressionGroup',
    singularName: 'Suppression Group',
    pluralName: 'Suppression Groups',
    icon: IconProp.Folder,
    tableDescription: 'Groups related suppression rules together',
})
@Entity({
    name: 'AlertSuppressionGroup',
})
export default class AlertSuppressionGroup extends BaseModel {
    // ─────────────────────────────────────────────────────────────
    // IDENTIFICATION
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    })
    @TableColumn({
        type: TableColumnType.ShortText,
        title: 'Name',
        description: 'Name of this suppression group',
        required: true,
    })
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        nullable: false,
    })
    public name?: string = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    })
    @TableColumn({
        type: TableColumnType.LongText,
        title: 'Description',
        description: 'Description of this group',
    })
    @Column({
        type: ColumnType.LongText,
        nullable: true,
    })
    public description?: string = undefined;

    // ─────────────────────────────────────────────────────────────
    // PROJECT
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
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
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
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
    // GROUP THROTTLING
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    })
    @TableColumn({
        type: TableColumnType.Number,
        title: 'Throttle Minutes',
        description: 'When one rule triggers, throttle all rules in group for this duration',
    })
    @Column({
        type: ColumnType.Number,
        nullable: true,
    })
    public throttleMinutes?: number = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Date,
        title: 'Throttle Until',
        description: 'Group is throttled until this time',
    })
    @Column({
        type: ColumnType.Date,
        nullable: true,
    })
    public throttleUntil?: Date = undefined;
}
```

---

### 3. SuppressedAlertLog

Audit log of all suppressed alerts for compliance and debugging.

**File Location:** `/Common/Models/DatabaseModels/SuppressedAlertLog.ts`

```typescript
@EnableDocumentation()
@TableAccessControl({
    create: [],
    read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
    update: [],
    delete: [Permission.ProjectOwner, Permission.ProjectAdmin],
})
@CrudApiEndpoint(new Route('/suppressed-alert-log'))
@TableMetadata({
    tableName: 'SuppressedAlertLog',
    singularName: 'Suppressed Alert',
    pluralName: 'Suppressed Alerts',
    icon: IconProp.Archive,
    tableDescription: 'Log of alerts that were suppressed',
})
@Entity({
    name: 'SuppressedAlertLog',
})
export default class SuppressedAlertLog extends BaseModel {
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
    // SUPPRESSION RULE REFERENCE
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Entity,
        modelType: AlertSuppressionRule,
        title: 'Suppression Rule',
        description: 'The rule that caused this suppression',
    })
    @ManyToOne(() => AlertSuppressionRule, {
        onDelete: 'SET NULL',
        nullable: true,
    })
    @JoinColumn({ name: 'suppressionRuleId' })
    public suppressionRule?: AlertSuppressionRule = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.ObjectID,
        title: 'Suppression Rule ID',
    })
    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
    })
    @Index()
    public suppressionRuleId?: ObjectID = undefined;

    // ─────────────────────────────────────────────────────────────
    // ALERT DATA
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.JSON,
        title: 'Alert Data',
        description: 'Snapshot of the alert data that would have been created',
    })
    @Column({
        type: ColumnType.JSON,
        nullable: false,
    })
    public alertData?: object = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.ShortText,
        title: 'Alert Title',
        description: 'Title of the suppressed alert',
    })
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.LongText,
        nullable: true,
    })
    public alertTitle?: string = undefined;

    // ─────────────────────────────────────────────────────────────
    // SUPPRESSION DETAILS
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.ShortText,
        title: 'Suppression Reason',
        description: 'Why this alert was suppressed',
    })
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.LongText,
        nullable: false,
    })
    public suppressionReason?: string = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.ShortText,
        title: 'Action Taken',
        description: 'What was suppressed (creation, notifications, or both)',
    })
    @Column({
        type: ColumnType.ShortText,
        length: 50,
        nullable: false,
    })
    public action?: SuppressionAction = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Date,
        title: 'Suppressed At',
        description: 'When the alert was suppressed',
    })
    @Column({
        type: ColumnType.Date,
        nullable: false,
    })
    @Index()
    public suppressedAt?: Date = undefined;

    // ─────────────────────────────────────────────────────────────
    // MONITOR REFERENCE
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Entity,
        modelType: Monitor,
        title: 'Monitor',
        description: 'Monitor that triggered the suppressed alert',
    })
    @ManyToOne(() => Monitor, {
        onDelete: 'SET NULL',
        nullable: true,
    })
    @JoinColumn({ name: 'monitorId' })
    public monitor?: Monitor = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.ObjectID,
        title: 'Monitor ID',
    })
    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
    })
    @Index()
    public monitorId?: ObjectID = undefined;
}
```

---

### 4. AlertThrottleState

Tracks current throttle/rate limit state for active rate limit rules.

**File Location:** `/Common/Models/DatabaseModels/AlertThrottleState.ts`

```typescript
@TableMetadata({
    tableName: 'AlertThrottleState',
    singularName: 'Throttle State',
    pluralName: 'Throttle States',
    icon: IconProp.Clock,
    tableDescription: 'Tracks current rate limit state for suppression rules',
})
@Entity({
    name: 'AlertThrottleState',
})
export default class AlertThrottleState extends BaseModel {
    // ─────────────────────────────────────────────────────────────
    // PROJECT
    // ─────────────────────────────────────────────────────────────

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

    // ─────────────────────────────────────────────────────────────
    // THROTTLE KEY
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.ShortText,
        title: 'Throttle Key',
        description: 'Computed key from throttle configuration (e.g., rule:monitor combo)',
    })
    @Column({
        type: ColumnType.ShortText,
        length: 500,
        nullable: false,
    })
    @Index()
    public throttleKey?: string = undefined;

    // ─────────────────────────────────────────────────────────────
    // SUPPRESSION RULE
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.ObjectID,
        title: 'Suppression Rule ID',
    })
    @Column({
        type: ColumnType.ObjectID,
        nullable: false,
    })
    @Index()
    public suppressionRuleId?: ObjectID = undefined;

    // ─────────────────────────────────────────────────────────────
    // STATE
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Number,
        title: 'Alert Count',
        description: 'Number of alerts in current window',
    })
    @Column({
        type: ColumnType.Number,
        nullable: false,
        default: 0,
    })
    public alertCount?: number = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Date,
        title: 'First Alert At',
        description: 'When the first alert in this window was received',
    })
    @Column({
        type: ColumnType.Date,
        nullable: false,
    })
    public firstAlertAt?: Date = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Date,
        title: 'Last Alert At',
        description: 'When the last alert was received',
    })
    @Column({
        type: ColumnType.Date,
        nullable: false,
    })
    public lastAlertAt?: Date = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Date,
        title: 'Window Expires At',
        description: 'When the current rate limit window expires',
    })
    @Column({
        type: ColumnType.Date,
        nullable: false,
    })
    @Index()
    public windowExpiresAt?: Date = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Boolean,
        title: 'Is Throttling',
        description: 'Whether alerts are currently being throttled',
    })
    @Column({
        type: ColumnType.Boolean,
        nullable: false,
        default: false,
    })
    public isThrottling?: boolean = undefined;
}
```

---

## Database Indexes

```sql
-- AlertSuppressionRule indexes
CREATE INDEX idx_suppression_rule_project_enabled
ON "AlertSuppressionRule" ("projectId", "isEnabled", "priority");

CREATE INDEX idx_suppression_rule_type
ON "AlertSuppressionRule" ("projectId", "type", "isEnabled");

-- SuppressedAlertLog indexes
CREATE INDEX idx_suppressed_log_project_date
ON "SuppressedAlertLog" ("projectId", "suppressedAt" DESC);

CREATE INDEX idx_suppressed_log_rule
ON "SuppressedAlertLog" ("suppressionRuleId", "suppressedAt" DESC);

-- AlertThrottleState indexes
CREATE INDEX idx_throttle_state_key
ON "AlertThrottleState" ("throttleKey", "windowExpiresAt");

CREATE INDEX idx_throttle_state_rule
ON "AlertThrottleState" ("suppressionRuleId", "windowExpiresAt");

-- Unique constraint for throttle state
CREATE UNIQUE INDEX idx_throttle_state_unique
ON "AlertThrottleState" ("throttleKey", "suppressionRuleId");
```

---

## Implementation Checklist

- [ ] Create AlertSuppressionRule model
- [ ] Create AlertSuppressionGroup model
- [ ] Create SuppressedAlertLog model
- [ ] Create AlertThrottleState model
- [ ] Register models in model registry
- [ ] Create database migrations
- [ ] Add indexes
- [ ] Update API permissions
