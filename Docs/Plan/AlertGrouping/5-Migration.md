# Migration & Rollout Plan for Alert Grouping

## Overview

This document outlines the database migrations, feature flags, and rollout strategy for Alert Grouping / Episodes functionality.

## Database Migrations

### Migration 1: Create AlertGroupingRule Table

**File:** `/Common/Server/Infrastructure/Postgres/SchemaMigrations/XXXX-CreateAlertGroupingRule.ts`

```typescript
import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateAlertGroupingRule implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.createTable(
            new Table({
                name: 'AlertGroupingRule',
                columns: [
                    {
                        name: '_id',
                        type: 'uuid',
                        isPrimary: true,
                        default: 'uuid_generate_v4()',
                    },
                    {
                        name: 'projectId',
                        type: 'uuid',
                        isNullable: false,
                    },
                    {
                        name: 'name',
                        type: 'varchar',
                        length: '500',
                        isNullable: false,
                    },
                    {
                        name: 'description',
                        type: 'text',
                        isNullable: true,
                    },
                    {
                        name: 'isEnabled',
                        type: 'boolean',
                        default: true,
                    },
                    {
                        name: 'matchCriteria',
                        type: 'jsonb',
                        isNullable: true,
                    },
                    {
                        name: 'groupingConfig',
                        type: 'jsonb',
                        isNullable: false,
                    },
                    {
                        name: 'episodeConfig',
                        type: 'jsonb',
                        isNullable: false,
                    },
                    {
                        name: 'priority',
                        type: 'integer',
                        default: 100,
                    },
                    {
                        name: 'createdAt',
                        type: 'timestamp',
                        default: 'CURRENT_TIMESTAMP',
                    },
                    {
                        name: 'updatedAt',
                        type: 'timestamp',
                        default: 'CURRENT_TIMESTAMP',
                    },
                    {
                        name: 'deletedAt',
                        type: 'timestamp',
                        isNullable: true,
                    },
                ],
            }),
            true
        );

        await queryRunner.createIndex(
            'AlertGroupingRule',
            new TableIndex({
                name: 'idx_grouping_rule_project_enabled',
                columnNames: ['projectId', 'isEnabled', 'priority'],
            })
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropTable('AlertGroupingRule');
    }
}
```

---

### Migration 2: Create AlertEpisode Table

**File:** `/Common/Server/Infrastructure/Postgres/SchemaMigrations/XXXX-CreateAlertEpisode.ts`

```typescript
import { MigrationInterface, QueryRunner, Table, TableIndex, TableForeignKey } from 'typeorm';

export class CreateAlertEpisode implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.createTable(
            new Table({
                name: 'AlertEpisode',
                columns: [
                    {
                        name: '_id',
                        type: 'uuid',
                        isPrimary: true,
                        default: 'uuid_generate_v4()',
                    },
                    {
                        name: 'projectId',
                        type: 'uuid',
                        isNullable: false,
                    },
                    {
                        name: 'episodeNumber',
                        type: 'integer',
                        isNullable: false,
                    },
                    {
                        name: 'title',
                        type: 'varchar',
                        length: '500',
                        isNullable: false,
                    },
                    {
                        name: 'description',
                        type: 'text',
                        isNullable: true,
                    },
                    {
                        name: 'groupingRuleId',
                        type: 'uuid',
                        isNullable: true,
                    },
                    {
                        name: 'currentAlertStateId',
                        type: 'uuid',
                        isNullable: true,
                    },
                    {
                        name: 'alertSeverityId',
                        type: 'uuid',
                        isNullable: true,
                    },
                    {
                        name: 'startedAt',
                        type: 'timestamp',
                        isNullable: false,
                    },
                    {
                        name: 'lastActivityAt',
                        type: 'timestamp',
                        isNullable: false,
                    },
                    {
                        name: 'acknowledgedAt',
                        type: 'timestamp',
                        isNullable: true,
                    },
                    {
                        name: 'resolvedAt',
                        type: 'timestamp',
                        isNullable: true,
                    },
                    {
                        name: 'alertCount',
                        type: 'integer',
                        default: 0,
                    },
                    {
                        name: 'uniqueMonitorCount',
                        type: 'integer',
                        default: 0,
                    },
                    {
                        name: 'rootCause',
                        type: 'text',
                        isNullable: true,
                    },
                    {
                        name: 'createdAt',
                        type: 'timestamp',
                        default: 'CURRENT_TIMESTAMP',
                    },
                    {
                        name: 'updatedAt',
                        type: 'timestamp',
                        default: 'CURRENT_TIMESTAMP',
                    },
                    {
                        name: 'deletedAt',
                        type: 'timestamp',
                        isNullable: true,
                    },
                ],
            }),
            true
        );

        // Indexes
        await queryRunner.createIndex(
            'AlertEpisode',
            new TableIndex({
                name: 'idx_episode_project_state',
                columnNames: ['projectId', 'currentAlertStateId', 'lastActivityAt'],
            })
        );

        await queryRunner.createIndex(
            'AlertEpisode',
            new TableIndex({
                name: 'idx_episode_grouping_rule',
                columnNames: ['projectId', 'groupingRuleId', 'currentAlertStateId'],
            })
        );

        // Foreign keys
        await queryRunner.createForeignKey(
            'AlertEpisode',
            new TableForeignKey({
                columnNames: ['projectId'],
                referencedTableName: 'Project',
                referencedColumnNames: ['_id'],
                onDelete: 'CASCADE',
            })
        );

        await queryRunner.createForeignKey(
            'AlertEpisode',
            new TableForeignKey({
                columnNames: ['groupingRuleId'],
                referencedTableName: 'AlertGroupingRule',
                referencedColumnNames: ['_id'],
                onDelete: 'SET NULL',
            })
        );

        await queryRunner.createForeignKey(
            'AlertEpisode',
            new TableForeignKey({
                columnNames: ['currentAlertStateId'],
                referencedTableName: 'AlertState',
                referencedColumnNames: ['_id'],
                onDelete: 'SET NULL',
            })
        );

        await queryRunner.createForeignKey(
            'AlertEpisode',
            new TableForeignKey({
                columnNames: ['alertSeverityId'],
                referencedTableName: 'AlertSeverity',
                referencedColumnNames: ['_id'],
                onDelete: 'SET NULL',
            })
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropTable('AlertEpisode');
    }
}
```

---

### Migration 3: Create AlertEpisodeMember Table

**File:** `/Common/Server/Infrastructure/Postgres/SchemaMigrations/XXXX-CreateAlertEpisodeMember.ts`

```typescript
import { MigrationInterface, QueryRunner, Table, TableIndex, TableForeignKey } from 'typeorm';

export class CreateAlertEpisodeMember implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.createTable(
            new Table({
                name: 'AlertEpisodeMember',
                columns: [
                    {
                        name: '_id',
                        type: 'uuid',
                        isPrimary: true,
                        default: 'uuid_generate_v4()',
                    },
                    {
                        name: 'projectId',
                        type: 'uuid',
                        isNullable: false,
                    },
                    {
                        name: 'episodeId',
                        type: 'uuid',
                        isNullable: false,
                    },
                    {
                        name: 'alertId',
                        type: 'uuid',
                        isNullable: false,
                    },
                    {
                        name: 'addedBy',
                        type: 'varchar',
                        length: '50',
                        isNullable: false,
                    },
                    {
                        name: 'addedAt',
                        type: 'timestamp',
                        isNullable: false,
                    },
                    {
                        name: 'groupingRuleId',
                        type: 'uuid',
                        isNullable: true,
                    },
                    {
                        name: 'similarityScore',
                        type: 'decimal',
                        precision: 5,
                        scale: 4,
                        isNullable: true,
                    },
                    {
                        name: 'createdAt',
                        type: 'timestamp',
                        default: 'CURRENT_TIMESTAMP',
                    },
                    {
                        name: 'deletedAt',
                        type: 'timestamp',
                        isNullable: true,
                    },
                ],
            }),
            true
        );

        // Indexes
        await queryRunner.createIndex(
            'AlertEpisodeMember',
            new TableIndex({
                name: 'idx_episode_member_episode',
                columnNames: ['episodeId', 'addedAt'],
            })
        );

        await queryRunner.createIndex(
            'AlertEpisodeMember',
            new TableIndex({
                name: 'idx_episode_member_alert',
                columnNames: ['alertId'],
            })
        );

        await queryRunner.createIndex(
            'AlertEpisodeMember',
            new TableIndex({
                name: 'idx_episode_member_unique',
                columnNames: ['episodeId', 'alertId'],
                isUnique: true,
            })
        );

        // Foreign keys
        await queryRunner.createForeignKey(
            'AlertEpisodeMember',
            new TableForeignKey({
                columnNames: ['projectId'],
                referencedTableName: 'Project',
                referencedColumnNames: ['_id'],
                onDelete: 'CASCADE',
            })
        );

        await queryRunner.createForeignKey(
            'AlertEpisodeMember',
            new TableForeignKey({
                columnNames: ['episodeId'],
                referencedTableName: 'AlertEpisode',
                referencedColumnNames: ['_id'],
                onDelete: 'CASCADE',
            })
        );

        await queryRunner.createForeignKey(
            'AlertEpisodeMember',
            new TableForeignKey({
                columnNames: ['alertId'],
                referencedTableName: 'Alert',
                referencedColumnNames: ['_id'],
                onDelete: 'CASCADE',
            })
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropTable('AlertEpisodeMember');
    }
}
```

---

### Migration 4: Add Episode Fields to Alert Table

**File:** `/Common/Server/Infrastructure/Postgres/SchemaMigrations/XXXX-AddEpisodeFieldsToAlert.ts`

```typescript
import { MigrationInterface, QueryRunner, TableColumn, TableIndex, TableForeignKey } from 'typeorm';

export class AddEpisodeFieldsToAlert implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        // Add episodeId column
        await queryRunner.addColumn(
            'Alert',
            new TableColumn({
                name: 'episodeId',
                type: 'uuid',
                isNullable: true,
            })
        );

        // Add fingerprint column
        await queryRunner.addColumn(
            'Alert',
            new TableColumn({
                name: 'fingerprint',
                type: 'varchar',
                length: '64',
                isNullable: true,
            })
        );

        // Add duplicateCount column
        await queryRunner.addColumn(
            'Alert',
            new TableColumn({
                name: 'duplicateCount',
                type: 'integer',
                default: 0,
            })
        );

        // Add lastDuplicateAt column
        await queryRunner.addColumn(
            'Alert',
            new TableColumn({
                name: 'lastDuplicateAt',
                type: 'timestamp',
                isNullable: true,
            })
        );

        // Create indexes
        await queryRunner.createIndex(
            'Alert',
            new TableIndex({
                name: 'idx_alert_episode',
                columnNames: ['episodeId'],
                where: '"episodeId" IS NOT NULL',
            })
        );

        await queryRunner.createIndex(
            'Alert',
            new TableIndex({
                name: 'idx_alert_fingerprint',
                columnNames: ['projectId', 'fingerprint'],
                where: '"fingerprint" IS NOT NULL',
            })
        );

        // Create foreign key
        await queryRunner.createForeignKey(
            'Alert',
            new TableForeignKey({
                name: 'fk_alert_episode',
                columnNames: ['episodeId'],
                referencedTableName: 'AlertEpisode',
                referencedColumnNames: ['_id'],
                onDelete: 'SET NULL',
            })
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropForeignKey('Alert', 'fk_alert_episode');
        await queryRunner.dropIndex('Alert', 'idx_alert_fingerprint');
        await queryRunner.dropIndex('Alert', 'idx_alert_episode');
        await queryRunner.dropColumn('Alert', 'lastDuplicateAt');
        await queryRunner.dropColumn('Alert', 'duplicateCount');
        await queryRunner.dropColumn('Alert', 'fingerprint');
        await queryRunner.dropColumn('Alert', 'episodeId');
    }
}
```

---

### Migration 5: Create Episode Join Tables

**File:** `/Common/Server/Infrastructure/Postgres/SchemaMigrations/XXXX-CreateEpisodeJoinTables.ts`

```typescript
import { MigrationInterface, QueryRunner, Table, TableForeignKey } from 'typeorm';

export class CreateEpisodeJoinTables implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        // AlertEpisodeOwnerUser join table
        await queryRunner.createTable(
            new Table({
                name: 'AlertEpisodeOwnerUser',
                columns: [
                    {
                        name: 'episodeId',
                        type: 'uuid',
                        isPrimary: true,
                    },
                    {
                        name: 'userId',
                        type: 'uuid',
                        isPrimary: true,
                    },
                ],
            }),
            true
        );

        await queryRunner.createForeignKey(
            'AlertEpisodeOwnerUser',
            new TableForeignKey({
                columnNames: ['episodeId'],
                referencedTableName: 'AlertEpisode',
                referencedColumnNames: ['_id'],
                onDelete: 'CASCADE',
            })
        );

        await queryRunner.createForeignKey(
            'AlertEpisodeOwnerUser',
            new TableForeignKey({
                columnNames: ['userId'],
                referencedTableName: 'User',
                referencedColumnNames: ['_id'],
                onDelete: 'CASCADE',
            })
        );

        // AlertEpisodeOwnerTeam join table
        await queryRunner.createTable(
            new Table({
                name: 'AlertEpisodeOwnerTeam',
                columns: [
                    {
                        name: 'episodeId',
                        type: 'uuid',
                        isPrimary: true,
                    },
                    {
                        name: 'teamId',
                        type: 'uuid',
                        isPrimary: true,
                    },
                ],
            }),
            true
        );

        await queryRunner.createForeignKey(
            'AlertEpisodeOwnerTeam',
            new TableForeignKey({
                columnNames: ['episodeId'],
                referencedTableName: 'AlertEpisode',
                referencedColumnNames: ['_id'],
                onDelete: 'CASCADE',
            })
        );

        await queryRunner.createForeignKey(
            'AlertEpisodeOwnerTeam',
            new TableForeignKey({
                columnNames: ['teamId'],
                referencedTableName: 'Team',
                referencedColumnNames: ['_id'],
                onDelete: 'CASCADE',
            })
        );

        // AlertEpisodeLabel join table
        await queryRunner.createTable(
            new Table({
                name: 'AlertEpisodeLabel',
                columns: [
                    {
                        name: 'episodeId',
                        type: 'uuid',
                        isPrimary: true,
                    },
                    {
                        name: 'labelId',
                        type: 'uuid',
                        isPrimary: true,
                    },
                ],
            }),
            true
        );

        await queryRunner.createForeignKey(
            'AlertEpisodeLabel',
            new TableForeignKey({
                columnNames: ['episodeId'],
                referencedTableName: 'AlertEpisode',
                referencedColumnNames: ['_id'],
                onDelete: 'CASCADE',
            })
        );

        await queryRunner.createForeignKey(
            'AlertEpisodeLabel',
            new TableForeignKey({
                columnNames: ['labelId'],
                referencedTableName: 'Label',
                referencedColumnNames: ['_id'],
                onDelete: 'CASCADE',
            })
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropTable('AlertEpisodeLabel');
        await queryRunner.dropTable('AlertEpisodeOwnerTeam');
        await queryRunner.dropTable('AlertEpisodeOwnerUser');
    }
}
```

---

## Feature Flags

### Project-Level Settings

Add to Project model or create AlertGroupingSettings:

```typescript
interface AlertGroupingSettings {
    // Master switch
    groupingEnabled: boolean;

    // Auto-create episodes for new alerts
    autoCreateEpisodes: boolean;

    // Default time window for grouping (minutes)
    defaultTimeWindowMinutes: number;
}
```

### Implementation

```typescript
// /Common/Server/Services/AlertGroupingSettingsService.ts

export default class AlertGroupingSettingsService {
    public static async isGroupingEnabled(projectId: ObjectID): Promise<boolean> {
        const settings = await ProjectService.findOneById({
            id: projectId,
            select: { alertGroupingEnabled: true },
            props: { isRoot: true },
        });

        return settings?.alertGroupingEnabled ?? false;
    }
}
```

### Usage in GroupingEngine

```typescript
// In GroupingEngine.processAlert():
const isEnabled = await AlertGroupingSettingsService.isGroupingEnabled(projectId);
if (!isEnabled) {
    return { shouldGroup: false, isNewEpisode: false };
}
```

---

## Rollout Strategy

### Phase 1: Internal Alpha

**Duration:** 1 week

**Scope:**
- Enable for internal test projects only
- Feature flag: `ALERT_GROUPING_INTERNAL_ONLY=true`

**Validation:**
- Verify migrations run successfully
- Test basic grouping flow
- Check performance metrics

---

### Phase 2: Beta (Opt-in)

**Duration:** 2 weeks

**Scope:**
- Available to all projects but disabled by default
- Users must explicitly enable in Settings
- Show "Beta" badge on Episodes page

**Communication:**
- In-app announcement
- Documentation published
- Support team briefed

**Monitoring:**
- Episode creation rate
- Grouping accuracy feedback
- Performance metrics

---

### Phase 3: General Availability

**Duration:** Ongoing

**Scope:**
- Enabled by default for new projects
- Existing projects can opt-in via Settings

**Milestones:**
- Remove "Beta" badge
- Enable by default for all new projects
- Provide migration tool for existing alerts

---

## Backward Compatibility

### No Breaking Changes

1. **Existing alerts unchanged** - episodeId is nullable, defaults to null
2. **Existing API unchanged** - new fields added but not required
3. **Opt-in only** - grouping disabled until rules created

### Gradual Adoption

1. Users create grouping rules when ready
2. Only new alerts are grouped (after rule creation)
3. No retroactive grouping unless explicitly triggered

---

## Data Migration (Optional)

### Retroactive Alert Grouping

For users who want to group existing alerts:

```typescript
// /Worker/Jobs/AlertEpisode/RetroactiveGrouping.ts

export async function retroactivelyGroupAlerts(
    projectId: ObjectID,
    ruleId: ObjectID,
    startDate: Date,
    endDate: Date
): Promise<void> {
    // Get rule
    const rule = await AlertGroupingRuleService.findOneById({ id: ruleId });

    // Get alerts in date range
    const alerts = await AlertService.findBy({
        query: {
            projectId,
            createdAt: QueryHelper.between(startDate, endDate),
            episodeId: QueryHelper.isNull(),
        },
        select: { ... },
        props: { isRoot: true },
    });

    // Group alerts
    for (const alert of alerts) {
        await GroupingEngine.processAlert(alert, projectId);
    }
}
```

This would be triggered via Admin UI or API endpoint.

---

## Rollback Plan

### Database Rollback

If issues discovered, migrations can be rolled back:

```bash
npm run migration:revert
```

### Feature Flag Disable

Immediately disable grouping for all projects:

```bash
# Set environment variable
ALERT_GROUPING_GLOBAL_DISABLE=true
```

### Data Preservation

- Episodes and members remain in database
- Alerts keep episodeId reference
- Can be re-enabled later without data loss

---

## Monitoring & Alerts

### Key Metrics

| Metric | Description | Threshold |
|--------|-------------|-----------|
| `episode_creation_rate` | Episodes created per hour | Monitor for anomalies |
| `grouping_latency_p99` | Time to group an alert | < 50ms |
| `episode_alert_ratio` | Avg alerts per episode | > 2 (effective grouping) |
| `grouping_engine_errors` | Errors in grouping | 0 |

### Dashboards

Create monitoring dashboards for:
- Episode creation over time
- Grouping rule effectiveness
- Performance metrics
- Error rates

---

## Checklist

### Pre-Migration
- [ ] Review migration scripts
- [ ] Test migrations on staging
- [ ] Backup production database
- [ ] Prepare rollback procedure

### Migration
- [ ] Run migrations in order
- [ ] Verify table creation
- [ ] Verify index creation
- [ ] Verify foreign keys

### Post-Migration
- [ ] Deploy updated API
- [ ] Deploy updated Worker
- [ ] Deploy updated Dashboard
- [ ] Enable feature flags for alpha
- [ ] Monitor metrics

### GA Release
- [ ] Remove beta badges
- [ ] Update documentation
- [ ] Enable for new projects
- [ ] Announce to users
