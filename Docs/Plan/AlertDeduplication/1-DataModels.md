# Data Models for Alert Deduplication

## Overview

This document defines the database models required for Alert Deduplication functionality.

## Entity Relationship Diagram

```
┌─────────────────────────┐
│     AlertFingerprint    │
├─────────────────────────┤
│ id                      │
│ projectId               │
│ fingerprint (hash)      │◄──────┐
│ fingerprintFields       │       │
│ canonicalAlertId        │───────┼──► Alert
│ duplicateCount          │       │
│ windowStartAt           │       │
│ windowEndAt             │       │
└─────────────────────────┘       │
                                  │
┌─────────────────────────────────┴───────────────────────────────────┐
│                          Alert (existing)                            │
├─────────────────────────────────────────────────────────────────────┤
│ + fingerprint (NEW)      - SHA-256 hash of alert                    │
│ + duplicateCount (NEW)   - Number of duplicates suppressed          │
│ + lastDuplicateAt (NEW)  - When last duplicate occurred             │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Model Definitions

### 1. AlertFingerprint

Cache of active fingerprints for deduplication lookups.

**File Location:** `/Common/Models/DatabaseModels/AlertFingerprint.ts`

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
import Alert from './Alert';
import ObjectID from 'Common/Types/ObjectID';
import ColumnType from 'Common/Types/Database/ColumnType';
import TableColumnType from 'Common/Types/Database/TableColumnType';
import Permission from 'Common/Types/Permission';
import IconProp from 'Common/Types/Icon/IconProp';

@TableMetadata({
    tableName: 'AlertFingerprint',
    singularName: 'Alert Fingerprint',
    pluralName: 'Alert Fingerprints',
    icon: IconProp.Key,
    tableDescription: 'Stores fingerprints for alert deduplication',
})
@Entity({
    name: 'AlertFingerprint',
})
export default class AlertFingerprint extends BaseModel {
    // ─────────────────────────────────────────────────────────────
    // PROJECT
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin],
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
    // FINGERPRINT
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.ShortText,
        title: 'Fingerprint',
        description: 'SHA-256 hash of the alert fields',
    })
    @Column({
        type: ColumnType.ShortText,
        length: 64, // SHA-256 hex length
        nullable: false,
    })
    @Index()
    public fingerprint?: string = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.JSON,
        title: 'Fingerprint Fields',
        description: 'Fields used to compute this fingerprint',
    })
    @Column({
        type: ColumnType.JSON,
        nullable: false,
    })
    public fingerprintFields?: Array<string> = undefined;

    // ─────────────────────────────────────────────────────────────
    // CANONICAL ALERT
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Entity,
        modelType: Alert,
        title: 'Canonical Alert',
        description: 'The original alert this fingerprint refers to',
    })
    @ManyToOne(() => Alert, {
        onDelete: 'CASCADE',
        orphanedRowAction: 'delete',
    })
    @JoinColumn({ name: 'canonicalAlertId' })
    public canonicalAlert?: Alert = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.ObjectID,
        title: 'Canonical Alert ID',
        description: 'ID of the original alert',
    })
    @Column({
        type: ColumnType.ObjectID,
        nullable: false,
    })
    @Index()
    public canonicalAlertId?: ObjectID = undefined;

    // ─────────────────────────────────────────────────────────────
    // DUPLICATE TRACKING
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin],
        update: [],
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
        read: [Permission.ProjectOwner, Permission.ProjectAdmin],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Date,
        title: 'Last Duplicate At',
        description: 'When the last duplicate was received',
    })
    @Column({
        type: ColumnType.Date,
        nullable: true,
    })
    public lastDuplicateAt?: Date = undefined;

    // ─────────────────────────────────────────────────────────────
    // TIME WINDOW
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Date,
        title: 'Window Start',
        description: 'When this deduplication window started',
    })
    @Column({
        type: ColumnType.Date,
        nullable: false,
    })
    public windowStartAt?: Date = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Date,
        title: 'Window End',
        description: 'When this deduplication window expires',
    })
    @Column({
        type: ColumnType.Date,
        nullable: false,
    })
    @Index()
    public windowEndAt?: Date = undefined;
}
```

---

### 2. Alert Model Enhancements

Add deduplication fields to existing Alert model.

**File Location:** `/Common/Models/DatabaseModels/Alert.ts` (modifications)

```typescript
// Add these fields to the existing Alert model:

    // ─────────────────────────────────────────────────────────────
    // DEDUPLICATION FIELDS (NEW)
    // ─────────────────────────────────────────────────────────────

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.ShortText,
        title: 'Fingerprint',
        description: 'SHA-256 fingerprint hash for deduplication',
    })
    @Column({
        type: ColumnType.ShortText,
        length: 64,
        nullable: true,
    })
    @Index()
    public fingerprint?: string = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Number,
        title: 'Duplicate Count',
        description: 'Number of duplicate alerts that were suppressed',
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
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Date,
        title: 'Last Duplicate At',
        description: 'When the last duplicate occurred',
    })
    @Column({
        type: ColumnType.Date,
        nullable: true,
    })
    public lastDuplicateAt?: Date = undefined;
```

---

### 3. DeduplicationConfig (Project Settings)

Add deduplication settings to Project or create separate settings model.

**Option A: Add to Project model**

```typescript
// In Project model, add:

    @ColumnAccessControl({
        create: [Permission.ProjectOwner],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin],
        update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    })
    @TableColumn({
        type: TableColumnType.JSON,
        title: 'Deduplication Config',
        description: 'Alert deduplication settings for this project',
    })
    @Column({
        type: ColumnType.JSON,
        nullable: true,
    })
    public alertDeduplicationConfig?: DeduplicationConfig = undefined;
```

**Option B: Separate AlertDeduplicationConfig model**

```typescript
@TableMetadata({
    tableName: 'AlertDeduplicationConfig',
    singularName: 'Deduplication Config',
    pluralName: 'Deduplication Configs',
    icon: IconProp.Settings,
    tableDescription: 'Project-level deduplication settings',
})
@Entity({
    name: 'AlertDeduplicationConfig',
})
export default class AlertDeduplicationConfig extends BaseModel {
    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    })
    @TableColumn({
        type: TableColumnType.ObjectID,
        title: 'Project ID',
    })
    @Column({
        type: ColumnType.ObjectID,
        nullable: false,
    })
    @Index({ unique: true })
    public projectId?: ObjectID = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    })
    @TableColumn({
        type: TableColumnType.Boolean,
        title: 'Enabled',
        description: 'Whether deduplication is enabled',
    })
    @Column({
        type: ColumnType.Boolean,
        nullable: false,
        default: true,
    })
    public enabled?: boolean = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    })
    @TableColumn({
        type: TableColumnType.Number,
        title: 'Window Minutes',
        description: 'Time window for deduplication (minutes)',
    })
    @Column({
        type: ColumnType.Number,
        nullable: false,
        default: 60,
    })
    public windowMinutes?: number = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    })
    @TableColumn({
        type: TableColumnType.JSON,
        title: 'Fingerprint Fields',
        description: 'Fields to include in fingerprint',
    })
    @Column({
        type: ColumnType.JSON,
        nullable: false,
        default: "['monitorId', 'createdCriteriaId', 'alertSeverityId', 'title']",
    })
    public fingerprintFields?: Array<string> = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.ProjectAdmin],
        read: [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.ProjectMember],
        update: [Permission.ProjectOwner, Permission.ProjectAdmin],
    })
    @TableColumn({
        type: TableColumnType.Boolean,
        title: 'Normalize Strings',
        description: 'Whether to normalize strings (lowercase, trim)',
    })
    @Column({
        type: ColumnType.Boolean,
        nullable: false,
        default: true,
    })
    public normalizeStrings?: boolean = undefined;
}
```

---

## Type Definitions

```typescript
// /Common/Types/Alert/DeduplicationConfig.ts

export interface DeduplicationConfig {
    // Enable/disable deduplication
    enabled: boolean;

    // Time window for deduplication (minutes)
    windowMinutes: number;

    // Fields to include in fingerprint
    fingerprintFields: Array<string>;

    // Whether to normalize strings (lowercase, trim)
    normalizeStrings: boolean;
}

export const DEFAULT_DEDUPLICATION_CONFIG: DeduplicationConfig = {
    enabled: true,
    windowMinutes: 60,
    fingerprintFields: ['monitorId', 'createdCriteriaId', 'alertSeverityId', 'title'],
    normalizeStrings: true,
};

export const AVAILABLE_FINGERPRINT_FIELDS: Array<{
    field: string;
    label: string;
    description: string;
}> = [
    {
        field: 'monitorId',
        label: 'Monitor',
        description: 'Include monitor in fingerprint',
    },
    {
        field: 'createdCriteriaId',
        label: 'Criteria',
        description: 'Include alert criteria in fingerprint',
    },
    {
        field: 'alertSeverityId',
        label: 'Severity',
        description: 'Include severity in fingerprint',
    },
    {
        field: 'title',
        label: 'Title',
        description: 'Include alert title in fingerprint',
    },
    {
        field: 'description',
        label: 'Description',
        description: 'Include alert description in fingerprint',
    },
];
```

---

## Database Indexes

```sql
-- AlertFingerprint indexes
CREATE INDEX idx_fingerprint_lookup
ON "AlertFingerprint" ("projectId", "fingerprint", "windowEndAt");

CREATE INDEX idx_fingerprint_cleanup
ON "AlertFingerprint" ("windowEndAt");

CREATE INDEX idx_fingerprint_alert
ON "AlertFingerprint" ("canonicalAlertId");

-- Alert fingerprint index
CREATE INDEX idx_alert_fingerprint
ON "Alert" ("projectId", "fingerprint")
WHERE "fingerprint" IS NOT NULL;
```

---

## Implementation Checklist

- [ ] Create AlertFingerprint model
- [ ] Add fingerprint fields to Alert model
- [ ] Create DeduplicationConfig type
- [ ] Add config to Project model (or create separate model)
- [ ] Register models in model registry
- [ ] Create database migrations
- [ ] Add indexes
- [ ] Update API permissions
