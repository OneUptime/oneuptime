# Data Models for Alert Grouping

## Overview

This document defines the database models required for Alert Grouping / Episodes functionality.

## Entity Relationship Diagram

```
┌─────────────────────┐       ┌─────────────────────────┐
│  AlertGroupingRule  │       │      AlertEpisode       │
├─────────────────────┤       ├─────────────────────────┤
│ id                  │       │ id                      │
│ projectId           │◄──────│ projectId               │
│ name                │       │ groupingRuleId          │──────┐
│ matchCriteria       │       │ episodeNumber           │      │
│ groupingConfig      │       │ title                   │      │
│ episodeConfig       │       │ state                   │      │
│ priority            │       │ severity                │      │
│ isEnabled           │       │ alertCount              │      │
└─────────────────────┘       │ rootCause               │      │
                              └─────────────────────────┘      │
                                          │                    │
                                          │ 1:N                │
                                          ▼                    │
                              ┌─────────────────────────┐      │
                              │   AlertEpisodeMember    │      │
                              ├─────────────────────────┤      │
                              │ id                      │      │
                              │ projectId               │      │
                              │ episodeId               │──────┘
                              │ alertId                 │───────────┐
                              │ addedBy                 │           │
                              │ groupingRuleId          │           │
                              └─────────────────────────┘           │
                                                                    │
┌─────────────────────────────────────────────────────────────────┐│
│                           Alert (existing)                       ││
├─────────────────────────────────────────────────────────────────┤│
│ id                                                               │◄┘
│ projectId                                                        │
│ title                                                            │
│ + episodeId (NEW)  ──────────────────────────────────────────────┼──► AlertEpisode
│ + fingerprint (NEW)                                              │
│ + duplicateCount (NEW)                                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## Model Definitions

### 1. AlertEpisode

Container for grouped alerts representing a single logical incident.

**File Location:** `/Common/Models/DatabaseModels/AlertEpisode.ts`

```typescript
@TableMetadata({
    tableName: 'AlertEpisode',
    singularName: 'Episode',
    pluralName: 'Episodes',
    icon: IconProp.Layers,
    tableDescription: 'Groups related alerts into a single episode for easier management',
})
@Entity({
    name: 'AlertEpisode',
})
export default class AlertEpisode extends BaseModel {
    // ─────────────────────────────────────────────────────────────
    // IDENTIFICATION
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Number,
        title: 'Episode Number',
        description: 'Auto-incrementing episode number unique within project',
    })
    @Column({
        type: ColumnType.Number,
        nullable: false,
    })
    public episodeNumber?: number = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    })
    @TableColumn({
        type: TableColumnType.ShortText,
        title: 'Title',
        description: 'Episode title describing the grouped alerts',
        required: true,
    })
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        nullable: false,
    })
    public title?: string = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    })
    @TableColumn({
        type: TableColumnType.LongText,
        title: 'Description',
        description: 'Detailed description of the episode',
    })
    @Column({
        type: ColumnType.LongText,
        nullable: true,
    })
    public description?: string = undefined;

    // ─────────────────────────────────────────────────────────────
    // RELATIONSHIPS
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
        description: 'Project this episode belongs to',
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
        description: 'ID of the project this episode belongs to',
    })
    @Column({
        type: ColumnType.ObjectID,
        nullable: false,
    })
    @Index()
    public projectId?: ObjectID = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Entity,
        modelType: AlertGroupingRule,
        title: 'Grouping Rule',
        description: 'The rule that created this episode (null if manually created)',
    })
    @ManyToOne(() => AlertGroupingRule, {
        onDelete: 'SET NULL',
        nullable: true,
    })
    @JoinColumn({ name: 'groupingRuleId' })
    public groupingRule?: AlertGroupingRule = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.ObjectID,
        title: 'Grouping Rule ID',
        description: 'ID of the grouping rule that created this episode',
    })
    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
    })
    @Index()
    public groupingRuleId?: ObjectID = undefined;

    // ─────────────────────────────────────────────────────────────
    // STATE
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    })
    @TableColumn({
        type: TableColumnType.Entity,
        modelType: AlertState,
        title: 'Current State',
        description: 'Current state of the episode',
    })
    @ManyToOne(() => AlertState, {
        onDelete: 'SET NULL',
        nullable: true,
    })
    @JoinColumn({ name: 'currentAlertStateId' })
    public currentAlertState?: AlertState = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    })
    @TableColumn({
        type: TableColumnType.ObjectID,
        title: 'Current State ID',
        description: 'ID of the current episode state',
    })
    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
    })
    @Index()
    public currentAlertStateId?: ObjectID = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    })
    @TableColumn({
        type: TableColumnType.Entity,
        modelType: AlertSeverity,
        title: 'Severity',
        description: 'Highest severity among contained alerts',
    })
    @ManyToOne(() => AlertSeverity, {
        onDelete: 'SET NULL',
        nullable: true,
    })
    @JoinColumn({ name: 'alertSeverityId' })
    public alertSeverity?: AlertSeverity = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    })
    @TableColumn({
        type: TableColumnType.ObjectID,
        title: 'Severity ID',
        description: 'ID of the episode severity',
    })
    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
    })
    @Index()
    public alertSeverityId?: ObjectID = undefined;

    // ─────────────────────────────────────────────────────────────
    // TIMING
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Date,
        title: 'Started At',
        description: 'When the first alert was added to this episode',
    })
    @Column({
        type: ColumnType.Date,
        nullable: false,
    })
    public startedAt?: Date = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    })
    @TableColumn({
        type: TableColumnType.Date,
        title: 'Last Activity At',
        description: 'When the last alert was added or updated',
    })
    @Column({
        type: ColumnType.Date,
        nullable: false,
    })
    @Index()
    public lastActivityAt?: Date = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    })
    @TableColumn({
        type: TableColumnType.Date,
        title: 'Acknowledged At',
        description: 'When the episode was acknowledged',
    })
    @Column({
        type: ColumnType.Date,
        nullable: true,
    })
    public acknowledgedAt?: Date = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    })
    @TableColumn({
        type: TableColumnType.Date,
        title: 'Resolved At',
        description: 'When the episode was resolved',
    })
    @Column({
        type: ColumnType.Date,
        nullable: true,
    })
    public resolvedAt?: Date = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    })
    @TableColumn({
        type: TableColumnType.Date,
        title: 'Scheduled Resolve At',
        description: 'When the episode is scheduled to auto-resolve (grace period)',
    })
    @Column({
        type: ColumnType.Date,
        nullable: true,
    })
    public scheduledResolveAt?: Date = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    })
    @TableColumn({
        type: TableColumnType.Number,
        title: 'Reopen Count',
        description: 'Number of times this episode has been reopened',
    })
    @Column({
        type: ColumnType.Number,
        nullable: false,
        default: 0,
    })
    public reopenCount?: number = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    })
    @TableColumn({
        type: TableColumnType.Date,
        title: 'Last Reopened At',
        description: 'When the episode was last reopened',
    })
    @Column({
        type: ColumnType.Date,
        nullable: true,
    })
    public lastReopenedAt?: Date = undefined;

    // ─────────────────────────────────────────────────────────────
    // METRICS
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    })
    @TableColumn({
        type: TableColumnType.Number,
        title: 'Alert Count',
        description: 'Number of alerts in this episode',
    })
    @Column({
        type: ColumnType.Number,
        nullable: false,
        default: 0,
    })
    public alertCount?: number = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    })
    @TableColumn({
        type: TableColumnType.Number,
        title: 'Unique Monitor Count',
        description: 'Number of unique monitors with alerts in this episode',
    })
    @Column({
        type: ColumnType.Number,
        nullable: false,
        default: 0,
    })
    public uniqueMonitorCount?: number = undefined;

    // ─────────────────────────────────────────────────────────────
    // OWNERSHIP
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    })
    @TableColumn({
        type: TableColumnType.EntityArray,
        modelType: User,
        title: 'Owner Users',
        description: 'Users assigned to this episode',
    })
    @ManyToMany(() => User)
    @JoinTable({
        name: 'AlertEpisodeOwnerUser',
        joinColumn: { name: 'episodeId' },
        inverseJoinColumn: { name: 'userId' },
    })
    public ownerUsers?: Array<User> = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    })
    @TableColumn({
        type: TableColumnType.EntityArray,
        modelType: Team,
        title: 'Owner Teams',
        description: 'Teams assigned to this episode',
    })
    @ManyToMany(() => Team)
    @JoinTable({
        name: 'AlertEpisodeOwnerTeam',
        joinColumn: { name: 'episodeId' },
        inverseJoinColumn: { name: 'teamId' },
    })
    public ownerTeams?: Array<Team> = undefined;

    // ─────────────────────────────────────────────────────────────
    // ROOT CAUSE
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    })
    @TableColumn({
        type: TableColumnType.Markdown,
        title: 'Root Cause',
        description: 'Root cause analysis for this episode',
    })
    @Column({
        type: ColumnType.Markdown,
        nullable: true,
    })
    public rootCause?: string = undefined;

    // ─────────────────────────────────────────────────────────────
    // LABELS
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    })
    @TableColumn({
        type: TableColumnType.EntityArray,
        modelType: Label,
        title: 'Labels',
        description: 'Labels assigned to this episode',
    })
    @ManyToMany(() => Label)
    @JoinTable({
        name: 'AlertEpisodeLabel',
        joinColumn: { name: 'episodeId' },
        inverseJoinColumn: { name: 'labelId' },
    })
    public labels?: Array<Label> = undefined;

    // ─────────────────────────────────────────────────────────────
    // ON-CALL POLICY OVERRIDE
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    })
    @TableColumn({
        type: TableColumnType.Entity,
        modelType: OnCallDutyPolicy,
        title: 'On-Call Policy Override',
        description: 'Override on-call policy for this specific episode (takes precedence over rule policy)',
    })
    @ManyToOne(() => OnCallDutyPolicy, {
        onDelete: 'SET NULL',
        nullable: true,
    })
    @JoinColumn({ name: 'onCallDutyPolicyId' })
    public onCallDutyPolicy?: OnCallDutyPolicy = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    })
    @TableColumn({
        type: TableColumnType.ObjectID,
        title: 'On-Call Policy Override ID',
        description: 'ID of the override on-call policy for this episode',
    })
    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
    })
    @Index()
    public onCallDutyPolicyId?: ObjectID = undefined;
}
```

---

### 2. AlertEpisodeMember

Links alerts to episodes (many-to-many relationship with metadata).

**File Location:** `/Common/Models/DatabaseModels/AlertEpisodeMember.ts`

```typescript
@TableMetadata({
    tableName: 'AlertEpisodeMember',
    singularName: 'Episode Member',
    pluralName: 'Episode Members',
    icon: IconProp.Link,
    tableDescription: 'Links alerts to episodes',
})
@Entity({
    name: 'AlertEpisodeMember',
})
export default class AlertEpisodeMember extends BaseModel {
    // ─────────────────────────────────────────────────────────────
    // RELATIONSHIPS
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
        description: 'Project this belongs to',
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

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Entity,
        modelType: AlertEpisode,
        title: 'Episode',
        description: 'The episode this alert belongs to',
    })
    @ManyToOne(() => AlertEpisode, {
        onDelete: 'CASCADE',
        orphanedRowAction: 'delete',
    })
    @JoinColumn({ name: 'episodeId' })
    public episode?: AlertEpisode = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.ObjectID,
        title: 'Episode ID',
    })
    @Column({
        type: ColumnType.ObjectID,
        nullable: false,
    })
    @Index()
    public episodeId?: ObjectID = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Entity,
        modelType: Alert,
        title: 'Alert',
        description: 'The alert in this episode',
    })
    @ManyToOne(() => Alert, {
        onDelete: 'CASCADE',
        orphanedRowAction: 'delete',
    })
    @JoinColumn({ name: 'alertId' })
    public alert?: Alert = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.ObjectID,
        title: 'Alert ID',
    })
    @Column({
        type: ColumnType.ObjectID,
        nullable: false,
    })
    @Index()
    public alertId?: ObjectID = undefined;

    // ─────────────────────────────────────────────────────────────
    // METADATA
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.ShortText,
        title: 'Added By',
        description: 'How this alert was added to the episode',
    })
    @Column({
        type: ColumnType.ShortText,
        nullable: false,
    })
    public addedBy?: 'rule' | 'manual' | 'correlation' = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Date,
        title: 'Added At',
        description: 'When this alert was added to the episode',
    })
    @Column({
        type: ColumnType.Date,
        nullable: false,
    })
    public addedAt?: Date = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.ObjectID,
        title: 'Grouping Rule ID',
        description: 'The rule that added this alert (if added by rule)',
    })
    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
    })
    public groupingRuleId?: ObjectID = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Number,
        title: 'Similarity Score',
        description: 'Similarity score if added by correlation (0-1)',
    })
    @Column({
        type: ColumnType.Decimal,
        nullable: true,
    })
    public similarityScore?: number = undefined;
}
```

---

### 3. AlertGroupingRule

Configures how alerts are automatically grouped into episodes.

**File Location:** `/Common/Models/DatabaseModels/AlertGroupingRule.ts`

```typescript
// Type definitions for grouping configuration
export interface AlertGroupingMatchCriteria {
    severityIds?: Array<string>;           // Match specific severities
    monitorIds?: Array<string>;            // Match specific monitors
    labelIds?: Array<string>;              // Match specific labels
    titlePattern?: string;                  // Regex pattern for title
    descriptionPattern?: string;            // Regex pattern for description
}

export enum AlertGroupingType {
    TimeWindow = 'time_window',
    FieldBased = 'field_based',
    Smart = 'smart',
}

export interface AlertGroupingConfig {
    type: AlertGroupingType;

    // Time window grouping
    timeWindowMinutes?: number;

    // Field-based grouping
    groupByFields?: Array<string>;

    // Smart grouping (ML-based)
    similarityThreshold?: number;
}

export interface AlertEpisodeConfig {
    titleTemplate?: string;
    autoResolveWhenEmpty: boolean;
    breakAfterMinutesInactive: number;

    // Flapping prevention settings
    reopenWindowMinutes?: number;    // Time after resolution where episode can be reopened (default: 30)
    resolveDelayMinutes?: number;    // Grace period before auto-resolving to prevent flapping (default: 5)
}

@TableMetadata({
    tableName: 'AlertGroupingRule',
    singularName: 'Grouping Rule',
    pluralName: 'Grouping Rules',
    icon: IconProp.Layers,
    tableDescription: 'Rules for automatically grouping alerts into episodes',
})
@Entity({
    name: 'AlertGroupingRule',
})
export default class AlertGroupingRule extends BaseModel {
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
        description: 'Name of this grouping rule',
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
    public matchCriteria?: AlertGroupingMatchCriteria = undefined;

    // ─────────────────────────────────────────────────────────────
    // GROUPING CONFIGURATION
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    })
    @TableColumn({
        type: TableColumnType.JSON,
        title: 'Grouping Config',
        description: 'Configuration for how alerts are grouped',
    })
    @Column({
        type: ColumnType.JSON,
        nullable: false,
    })
    public groupingConfig?: AlertGroupingConfig = undefined;

    // ─────────────────────────────────────────────────────────────
    // EPISODE CONFIGURATION
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    })
    @TableColumn({
        type: TableColumnType.JSON,
        title: 'Episode Config',
        description: 'Configuration for created episodes',
    })
    @Column({
        type: ColumnType.JSON,
        nullable: false,
    })
    public episodeConfig?: AlertEpisodeConfig = undefined;

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
    // ON-CALL POLICY
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    })
    @TableColumn({
        type: TableColumnType.Entity,
        modelType: OnCallDutyPolicy,
        title: 'On-Call Policy',
        description: 'On-call policy to execute when an episode is created by this rule',
    })
    @ManyToOne(() => OnCallDutyPolicy, {
        onDelete: 'SET NULL',
        nullable: true,
    })
    @JoinColumn({ name: 'onCallDutyPolicyId' })
    public onCallDutyPolicy?: OnCallDutyPolicy = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    })
    @TableColumn({
        type: TableColumnType.ObjectID,
        title: 'On-Call Policy ID',
        description: 'ID of the on-call policy for episodes created by this rule',
    })
    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
    })
    @Index()
    public onCallDutyPolicyId?: ObjectID = undefined;
}
```

---

### 4. Alert Model Enhancements

Add new fields to the existing Alert model.

**File Location:** `/Common/Models/DatabaseModels/Alert.ts` (modifications)

```typescript
// Add these fields to the existing Alert model:

    // ─────────────────────────────────────────────────────────────
    // EPISODE MEMBERSHIP (NEW)
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    })
    @TableColumn({
        type: TableColumnType.Entity,
        modelType: AlertEpisode,
        title: 'Episode',
        description: 'Episode this alert belongs to (if grouped)',
    })
    @ManyToOne(() => AlertEpisode, {
        onDelete: 'SET NULL',
        nullable: true,
    })
    @JoinColumn({ name: 'episodeId' })
    public episode?: AlertEpisode = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    })
    @TableColumn({
        type: TableColumnType.ObjectID,
        title: 'Episode ID',
        description: 'ID of the episode this alert belongs to',
    })
    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
    })
    @Index()
    public episodeId?: ObjectID = undefined;

    // ─────────────────────────────────────────────────────────────
    // FINGERPRINTING (NEW)
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.ShortText,
        title: 'Fingerprint',
        description: 'Hash fingerprint for deduplication',
    })
    @Column({
        type: ColumnType.ShortText,
        length: 64, // SHA-256 hex length
        nullable: true,
    })
    @Index()
    public fingerprint?: string = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    })
    @TableColumn({
        type: TableColumnType.Number,
        title: 'Duplicate Count',
        description: 'Number of duplicate alerts suppressed',
    })
    @Column({
        type: ColumnType.Number,
        nullable: false,
        default: 0,
    })
    public duplicateCount?: number = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    })
    @TableColumn({
        type: TableColumnType.Date,
        title: 'Last Duplicate At',
        description: 'When the last duplicate was suppressed',
    })
    @Column({
        type: ColumnType.Date,
        nullable: true,
    })
    public lastDuplicateAt?: Date = undefined;
```

---

## Database Indexes

Required indexes for optimal query performance:

```sql
-- AlertEpisode indexes
CREATE INDEX idx_episode_project_state
ON "AlertEpisode" ("projectId", "currentAlertStateId", "lastActivityAt" DESC);

CREATE INDEX idx_episode_grouping_rule
ON "AlertEpisode" ("projectId", "groupingRuleId", "currentAlertStateId");

-- AlertEpisodeMember indexes
CREATE INDEX idx_episode_member_episode
ON "AlertEpisodeMember" ("episodeId", "addedAt" DESC);

CREATE INDEX idx_episode_member_alert
ON "AlertEpisodeMember" ("alertId");

CREATE UNIQUE INDEX idx_episode_member_unique
ON "AlertEpisodeMember" ("episodeId", "alertId");

-- AlertGroupingRule indexes
CREATE INDEX idx_grouping_rule_project_enabled
ON "AlertGroupingRule" ("projectId", "isEnabled", "priority");

-- Alert model additions
CREATE INDEX idx_alert_episode
ON "Alert" ("episodeId") WHERE "episodeId" IS NOT NULL;

CREATE INDEX idx_alert_fingerprint
ON "Alert" ("projectId", "fingerprint") WHERE "fingerprint" IS NOT NULL;
```

---

## Migration Checklist

- [ ] Create AlertEpisode table
- [ ] Create AlertEpisodeMember table
- [ ] Create AlertGroupingRule table
- [ ] Add episodeId column to Alert table
- [ ] Add fingerprint column to Alert table
- [ ] Add duplicateCount column to Alert table
- [ ] Add lastDuplicateAt column to Alert table
- [ ] Add scheduledResolveAt column to AlertEpisode table
- [ ] Add reopenCount column to AlertEpisode table
- [ ] Add lastReopenedAt column to AlertEpisode table
- [ ] Add onCallDutyPolicyId column to AlertGroupingRule table
- [ ] Add onCallDutyPolicyId column to AlertEpisode table (override)
- [ ] Create all required indexes
- [ ] Register models in model registry
- [ ] Update API permissions

---

## Flapping Prevention Behavior

### How `resolveDelayMinutes` Works

When all alerts in an episode are resolved:
1. Instead of immediately resolving the episode, set `scheduledResolveAt = now + resolveDelayMinutes`
2. A worker job checks for episodes where `scheduledResolveAt < now` and resolves them
3. If a new matching alert arrives before `scheduledResolveAt`, cancel the scheduled resolution

```
Timeline with resolveDelayMinutes=5:
─────────────────────────────────────────────────────────────────
10:00 - All alerts resolved → scheduledResolveAt = 10:05
10:03 - New alert arrives   → scheduledResolveAt = null, episode stays active
10:10 - All alerts resolved → scheduledResolveAt = 10:15
10:15 - No new alerts       → Episode auto-resolved
```

### How `reopenWindowMinutes` Works

When an episode is resolved and a new matching alert arrives within the reopen window:
1. Check if `resolvedAt + reopenWindowMinutes > now`
2. If yes, reopen the episode instead of creating a new one
3. Reset episode state:
   - `currentAlertState` → Reset to "Created" state (always starts fresh)
   - `resolvedAt` → Set to `null`
   - `acknowledgedAt` → Set to `null` (clear previous acknowledgment)
   - `reopenCount` → Increment by 1
   - `lastReopenedAt` → Set to current time
   - `lastActivityAt` → Set to current time

```
Timeline with reopenWindowMinutes=30:
─────────────────────────────────────────────────────────────────
10:00 - Episode resolved    → resolvedAt = 10:00, state = Resolved
10:20 - New alert arrives   → Episode reopened (within 30 min window)
                              state = Created (reset)
                              resolvedAt = null
                              acknowledgedAt = null
                              reopenCount = 1
11:00 - Episode resolved    → resolvedAt = 11:00, state = Resolved
11:45 - New alert arrives   → New episode created (outside 30 min window)
```

### State Transition Diagram with Reopen

```
                    ┌─────────────────────────────────┐
                    │         (reopen)                │
                    │    new alert arrives within     │
                    │       reopenWindowMinutes       │
                    ▼                                 │
              ┌──────────┐                            │
              │ Created  │                            │
              └────┬─────┘                            │
                   │ acknowledge()                    │
                   ▼                                  │
            ┌──────────────┐                          │
            │ Acknowledged │                          │
            └──────┬───────┘                          │
                   │ resolve()                        │
                   ▼                                  │
              ┌──────────┐                            │
              │ Resolved │────────────────────────────┘
              └──────────┘
                   │
                   │ reopenWindowMinutes expires
                   ▼
              ┌──────────┐
              │  Closed  │  (no longer eligible for reopen)
              └──────────┘
```

**Note:** When an episode is reopened, it always resets to "Created" state regardless of its previous state before resolution. This ensures the episode gets proper attention and goes through the full acknowledgment workflow again.

---

## On-Call Policy & Notifications

### Policy Resolution

On-call policy is resolved using a **priority chain**. The episode can have its own override, or inherit from the grouping rule, or fall back to the first alert's policy.

```
┌─────────────────────────────────────────────────────────────────┐
│              On-Call Policy Resolution (Priority Order)         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. AlertEpisode.onCallDutyPolicyId (manual override)           │
│         │                                                       │
│         ▼ if null                                               │
│  2. AlertGroupingRule.onCallDutyPolicyId (rule default)         │
│         │                                                       │
│         ▼ if null                                               │
│  3. First Alert's onCallDutyPolicyId (fallback)                 │
│         │                                                       │
│         ▼                                                       │
│  Execute On-Call Policy ──► Notify Level 1 On-Call              │
│                                    │                            │
│                             (escalation as configured)          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

This provides:
- **Flexibility** - Override at episode level for special cases
- **Predictability** - Rule defines default behavior
- **Backwards compatibility** - Falls back to alert's policy if nothing configured

### When Notifications Are Sent

| Event | Notification Behavior |
|-------|----------------------|
| **Episode Created** | Execute on-call policy, notify Level 1 |
| **Alert Added to Episode** | Silent (no notification) |
| **Episode Acknowledged** | Stop escalation |
| **Episode Resolved** | Optional resolution notification |
| **Episode Reopened** | Execute on-call policy again (full cycle) |
| **Severity Escalation** | Optional: notify if episode severity increases |

### Notification Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    Episode Notification Flow                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Alert 1 ──► Matches Rule ──► Create Episode ──► NOTIFY         │
│                                     │                           │
│  Alert 2 ──► Matches Rule ──► Add to Episode ──► (silent)       │
│                                     │                           │
│  Alert 3 ──► Matches Rule ──► Add to Episode ──► (silent)       │
│                                     │                           │
│                              Episode Acknowledged ──► STOP      │
│                                     │               ESCALATION  │
│                                     │                           │
│                              Episode Resolved                   │
│                                     │                           │
│  Alert 4 ──► Matches Rule ──► Reopen Episode ──► NOTIFY         │
│              (within reopen window)              (new cycle)    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Individual Alert Notifications

When an alert is grouped into an episode:
- The **alert's own on-call policy is NOT executed**
- Only the **episode's on-call policy** (from the grouping rule) is used
- This prevents duplicate/redundant notifications

```
Without Episodes:                    With Episodes:
─────────────────────               ─────────────────────
Alert 1 → Notify Team A             Alert 1 → Episode → Notify Team X
Alert 2 → Notify Team B             Alert 2 → Episode → (silent)
Alert 3 → Notify Team A             Alert 3 → Episode → (silent)
(3 notifications, 2 teams)          (1 notification, 1 team)
```

### Policy Resolution Logic

```typescript
function getEpisodeOnCallPolicy(
    episode: AlertEpisode,
    rule: AlertGroupingRule | null,
    firstAlert: Alert
): ObjectID | null {
    // 1. Episode-level override (highest priority)
    if (episode.onCallDutyPolicyId) {
        return episode.onCallDutyPolicyId;
    }

    // 2. Rule's default policy
    if (rule?.onCallDutyPolicyId) {
        return rule.onCallDutyPolicyId;
    }

    // 3. Fall back to first alert's policy (backwards compatibility)
    return firstAlert.onCallDutyPolicyId || null;
}
```

### Use Cases for Episode Override

| Scenario | Solution |
|----------|----------|
| VIP customer issue | Override to executive escalation policy |
| Cross-team incident | Override to incident commander policy |
| After-hours maintenance | Override to maintenance team policy |
| Escalated by manager | Override to senior engineer policy |

### Configuration Example

```typescript
// Example: Group all database alerts and notify the DBA team
const rule: AlertGroupingRule = {
    name: 'Database Alerts',
    matchCriteria: {
        labelIds: ['database-label-id'],
    },
    groupingConfig: {
        type: AlertGroupingType.TimeWindow,
        timeWindowMinutes: 60,
    },
    episodeConfig: {
        titleTemplate: 'Database Issues: {{title}}',
        autoResolveWhenEmpty: true,
        breakAfterMinutesInactive: 480,
        reopenWindowMinutes: 30,
        resolveDelayMinutes: 5,
    },
    onCallDutyPolicyId: 'dba-team-oncall-policy-id',  // DBA team's on-call policy
    priority: 10,
};
```
