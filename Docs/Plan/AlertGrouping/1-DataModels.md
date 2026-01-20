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
- [ ] Create all required indexes
- [ ] Register models in model registry
- [ ] Update API permissions
