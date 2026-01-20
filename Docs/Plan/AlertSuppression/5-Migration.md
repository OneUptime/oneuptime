# Migration & Rollout Plan for Alert Suppression

## Overview

This document outlines the database migrations and rollout strategy for Alert Suppression functionality.

## Database Migrations

### Migration 1: Create AlertSuppressionGroup Table

```typescript
import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateAlertSuppressionGroup implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.createTable(
            new Table({
                name: 'AlertSuppressionGroup',
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
                        name: 'throttleMinutes',
                        type: 'integer',
                        isNullable: true,
                    },
                    {
                        name: 'throttleUntil',
                        type: 'timestamp',
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

        await queryRunner.createIndex(
            'AlertSuppressionGroup',
            new TableIndex({
                name: 'idx_suppression_group_project',
                columnNames: ['projectId'],
            })
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropTable('AlertSuppressionGroup');
    }
}
```

### Migration 2: Create AlertSuppressionRule Table

```typescript
export class CreateAlertSuppressionRule implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.createTable(
            new Table({
                name: 'AlertSuppressionRule',
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
                        name: 'type',
                        type: 'varchar',
                        length: '50',
                        isNullable: false,
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
                        name: 'maintenanceWindow',
                        type: 'jsonb',
                        isNullable: true,
                    },
                    {
                        name: 'condition',
                        type: 'jsonb',
                        isNullable: true,
                    },
                    {
                        name: 'rateLimit',
                        type: 'jsonb',
                        isNullable: true,
                    },
                    {
                        name: 'action',
                        type: 'varchar',
                        length: '50',
                        isNullable: false,
                        default: "'both'",
                    },
                    {
                        name: 'suppressionGroupId',
                        type: 'uuid',
                        isNullable: true,
                    },
                    {
                        name: 'priority',
                        type: 'integer',
                        default: 100,
                    },
                    {
                        name: 'suppressedCount',
                        type: 'integer',
                        default: 0,
                    },
                    {
                        name: 'lastTriggeredAt',
                        type: 'timestamp',
                        isNullable: true,
                    },
                    {
                        name: 'createdByUserId',
                        type: 'uuid',
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
            'AlertSuppressionRule',
            new TableIndex({
                name: 'idx_suppression_rule_project_enabled',
                columnNames: ['projectId', 'isEnabled', 'priority'],
            })
        );

        await queryRunner.createIndex(
            'AlertSuppressionRule',
            new TableIndex({
                name: 'idx_suppression_rule_type',
                columnNames: ['projectId', 'type', 'isEnabled'],
            })
        );

        // Foreign keys
        await queryRunner.createForeignKey(
            'AlertSuppressionRule',
            new TableForeignKey({
                columnNames: ['projectId'],
                referencedTableName: 'Project',
                referencedColumnNames: ['_id'],
                onDelete: 'CASCADE',
            })
        );

        await queryRunner.createForeignKey(
            'AlertSuppressionRule',
            new TableForeignKey({
                columnNames: ['suppressionGroupId'],
                referencedTableName: 'AlertSuppressionGroup',
                referencedColumnNames: ['_id'],
                onDelete: 'SET NULL',
            })
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropTable('AlertSuppressionRule');
    }
}
```

### Migration 3: Create SuppressedAlertLog Table

```typescript
export class CreateSuppressedAlertLog implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.createTable(
            new Table({
                name: 'SuppressedAlertLog',
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
                        name: 'suppressionRuleId',
                        type: 'uuid',
                        isNullable: true,
                    },
                    {
                        name: 'alertData',
                        type: 'jsonb',
                        isNullable: false,
                    },
                    {
                        name: 'alertTitle',
                        type: 'text',
                        isNullable: true,
                    },
                    {
                        name: 'suppressionReason',
                        type: 'text',
                        isNullable: false,
                    },
                    {
                        name: 'action',
                        type: 'varchar',
                        length: '50',
                        isNullable: false,
                    },
                    {
                        name: 'suppressedAt',
                        type: 'timestamp',
                        isNullable: false,
                    },
                    {
                        name: 'monitorId',
                        type: 'uuid',
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
            'SuppressedAlertLog',
            new TableIndex({
                name: 'idx_suppressed_log_project_date',
                columnNames: ['projectId', 'suppressedAt'],
            })
        );

        await queryRunner.createIndex(
            'SuppressedAlertLog',
            new TableIndex({
                name: 'idx_suppressed_log_rule',
                columnNames: ['suppressionRuleId', 'suppressedAt'],
            })
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropTable('SuppressedAlertLog');
    }
}
```

### Migration 4: Create AlertThrottleState Table

```typescript
export class CreateAlertThrottleState implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.createTable(
            new Table({
                name: 'AlertThrottleState',
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
                        name: 'throttleKey',
                        type: 'varchar',
                        length: '500',
                        isNullable: false,
                    },
                    {
                        name: 'suppressionRuleId',
                        type: 'uuid',
                        isNullable: false,
                    },
                    {
                        name: 'alertCount',
                        type: 'integer',
                        default: 0,
                    },
                    {
                        name: 'firstAlertAt',
                        type: 'timestamp',
                        isNullable: false,
                    },
                    {
                        name: 'lastAlertAt',
                        type: 'timestamp',
                        isNullable: false,
                    },
                    {
                        name: 'windowExpiresAt',
                        type: 'timestamp',
                        isNullable: false,
                    },
                    {
                        name: 'isThrottling',
                        type: 'boolean',
                        default: false,
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
                ],
            }),
            true
        );

        // Indexes
        await queryRunner.createIndex(
            'AlertThrottleState',
            new TableIndex({
                name: 'idx_throttle_state_key',
                columnNames: ['throttleKey', 'windowExpiresAt'],
            })
        );

        await queryRunner.createIndex(
            'AlertThrottleState',
            new TableIndex({
                name: 'idx_throttle_state_unique',
                columnNames: ['throttleKey', 'suppressionRuleId'],
                isUnique: true,
            })
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropTable('AlertThrottleState');
    }
}
```

### Migration 5: Add Suppression Fields to Alert Table

```typescript
export class AddSuppressionFieldsToAlert implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.addColumn(
            'Alert',
            new TableColumn({
                name: 'notificationsSuppressed',
                type: 'boolean',
                default: false,
            })
        );

        await queryRunner.addColumn(
            'Alert',
            new TableColumn({
                name: 'suppressedByRuleId',
                type: 'uuid',
                isNullable: true,
            })
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropColumn('Alert', 'suppressedByRuleId');
        await queryRunner.dropColumn('Alert', 'notificationsSuppressed');
    }
}
```

---

## Rollout Strategy

### Phase 1: Internal Testing

**Duration:** 1 week

- Deploy to staging environment
- Create test suppression rules
- Verify suppression logic works correctly
- Test all three rule types

### Phase 2: Beta (Opt-in)

**Duration:** 2 weeks

- Enable feature flag for early adopters
- Collect feedback on UI/UX
- Monitor for performance issues
- Document common use cases

### Phase 3: General Availability

**Duration:** Ongoing

- Enable for all projects
- Default rules disabled
- Users opt-in by creating rules

---

## Data Retention

### SuppressedAlertLog Retention

Suppressed alert logs should be retained for compliance but cleaned up after retention period:

```typescript
// Worker job to clean up old logs
RunCron(
    'SuppressedAlertLog:Cleanup',
    { schedule: EVERY_DAY, runOnStartup: false },
    async () => {
        const retentionDays = 90; // Configurable per project
        const cutoffDate = OneUptimeDate.addRemoveDays(
            OneUptimeDate.getCurrentDate(),
            -retentionDays
        );

        await SuppressedAlertLogService.deleteBy({
            query: {
                suppressedAt: QueryHelper.lessThan(cutoffDate),
            },
            props: { isRoot: true },
        });
    }
);
```

---

## Implementation Checklist

### Pre-Migration
- [ ] Review migration scripts
- [ ] Test on staging
- [ ] Backup production database

### Migration
- [ ] Run migrations in order
- [ ] Verify table creation
- [ ] Verify indexes

### Post-Migration
- [ ] Deploy API changes
- [ ] Deploy Dashboard changes
- [ ] Deploy Worker jobs
- [ ] Enable feature flags

### Monitoring
- [ ] Set up suppression metrics
- [ ] Alert on engine errors
- [ ] Monitor performance
