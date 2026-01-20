# Backend Implementation for Alert Deduplication

## Overview

This document details the backend services and components required for Alert Deduplication functionality.

## Core Components

### 1. FingerprintGenerator

Generates unique fingerprints for alerts based on configurable fields.

**File Location:** `/Common/Server/Utils/Alert/FingerprintGenerator.ts`

```typescript
import Alert from '../../Models/DatabaseModels/Alert';
import crypto from 'crypto';
import { DeduplicationConfig, DEFAULT_DEDUPLICATION_CONFIG } from 'Common/Types/Alert/DeduplicationConfig';

export default class FingerprintGenerator {
    /**
     * Default fields used for fingerprinting
     */
    public static DEFAULT_FIELDS: Array<string> = [
        'monitorId',
        'createdCriteriaId',
        'alertSeverityId',
        'title',
    ];

    /**
     * Generate a fingerprint hash for an alert
     */
    public static generate(
        alert: Partial<Alert>,
        config?: Partial<DeduplicationConfig>
    ): string {
        const fields = config?.fingerprintFields || this.DEFAULT_FIELDS;
        const normalizeStrings = config?.normalizeStrings ?? true;

        const values: Array<string> = [];

        for (const field of fields) {
            let value = this.getFieldValue(alert, field);

            if (normalizeStrings && typeof value === 'string') {
                value = value.toLowerCase().trim();
            }

            values.push(`${field}:${value}`);
        }

        const fingerprintInput = values.join('|');

        return crypto
            .createHash('sha256')
            .update(fingerprintInput)
            .digest('hex');
    }

    /**
     * Get a field value from an alert object
     */
    private static getFieldValue(alert: Partial<Alert>, field: string): string {
        switch (field) {
            case 'monitorId':
                return alert.monitorId?.toString() || '';

            case 'createdCriteriaId':
                return alert.createdCriteriaId || '';

            case 'alertSeverityId':
            case 'severity':
                return alert.alertSeverityId?.toString() || '';

            case 'title':
                return alert.title || '';

            case 'description':
                return alert.description || '';

            case 'createdByProbeId':
                return alert.createdByProbeId?.toString() || '';

            default:
                // Try to get from customFields
                if (alert.customFields && typeof alert.customFields === 'object') {
                    const customValue = (alert.customFields as Record<string, unknown>)[field];
                    return customValue?.toString() || '';
                }
                return '';
        }
    }

    /**
     * Validate that all required fields are present for fingerprinting
     */
    public static validateFields(
        alert: Partial<Alert>,
        fields: Array<string>
    ): { valid: boolean; missingFields: Array<string> } {
        const missingFields: Array<string> = [];

        for (const field of fields) {
            const value = this.getFieldValue(alert, field);
            if (!value) {
                missingFields.push(field);
            }
        }

        return {
            valid: missingFields.length === 0,
            missingFields,
        };
    }

    /**
     * Compare two fingerprints
     */
    public static areEqual(fingerprint1: string, fingerprint2: string): boolean {
        return fingerprint1 === fingerprint2;
    }
}
```

---

### 2. DeduplicationEngine

Handles the core deduplication logic.

**File Location:** `/Common/Server/Utils/Alert/DeduplicationEngine.ts`

```typescript
import Alert from '../../Models/DatabaseModels/Alert';
import AlertFingerprint from '../../Models/DatabaseModels/AlertFingerprint';
import AlertFingerprintService from '../../Services/AlertFingerprintService';
import AlertService from '../../Services/AlertService';
import FingerprintGenerator from './FingerprintGenerator';
import ObjectID from 'Common/Types/ObjectID';
import OneUptimeDate from 'Common/Types/Date';
import QueryHelper from '../../Types/Database/QueryHelper';
import { DeduplicationConfig, DEFAULT_DEDUPLICATION_CONFIG } from 'Common/Types/Alert/DeduplicationConfig';

export interface DeduplicationResult {
    isDuplicate: boolean;
    canonicalAlertId?: ObjectID;
    canonicalAlert?: Alert;
    duplicateCount?: number;
    fingerprint: string;
}

export default class DeduplicationEngine {
    /**
     * Check if an alert is a duplicate of an existing alert
     */
    public static async checkDuplicate(
        alertData: Partial<Alert>,
        projectId: ObjectID,
        config?: Partial<DeduplicationConfig>
    ): Promise<DeduplicationResult> {
        const mergedConfig = { ...DEFAULT_DEDUPLICATION_CONFIG, ...config };

        // Generate fingerprint
        const fingerprint = FingerprintGenerator.generate(alertData, mergedConfig);

        // Check if fingerprint exists in active window
        const existingFingerprint = await AlertFingerprintService.findOneBy({
            query: {
                projectId,
                fingerprint,
                windowEndAt: QueryHelper.greaterThan(new Date()),
            },
            select: {
                _id: true,
                canonicalAlertId: true,
                duplicateCount: true,
            },
            props: { isRoot: true },
        });

        if (existingFingerprint) {
            // It's a duplicate - update counters
            const newDuplicateCount = (existingFingerprint.duplicateCount || 0) + 1;

            await AlertFingerprintService.updateOneById({
                id: existingFingerprint.id!,
                data: {
                    duplicateCount: newDuplicateCount,
                    lastDuplicateAt: new Date(),
                },
                props: { isRoot: true },
            });

            // Update the canonical alert's duplicate count
            await AlertService.updateOneById({
                id: existingFingerprint.canonicalAlertId!,
                data: {
                    duplicateCount: newDuplicateCount,
                    lastDuplicateAt: new Date(),
                },
                props: { isRoot: true },
            });

            // Get the canonical alert for return
            const canonicalAlert = await AlertService.findOneById({
                id: existingFingerprint.canonicalAlertId!,
                select: {
                    _id: true,
                    title: true,
                    alertNumber: true,
                },
                props: { isRoot: true },
            });

            return {
                isDuplicate: true,
                canonicalAlertId: existingFingerprint.canonicalAlertId,
                canonicalAlert: canonicalAlert || undefined,
                duplicateCount: newDuplicateCount,
                fingerprint,
            };
        }

        // Not a duplicate
        return {
            isDuplicate: false,
            fingerprint,
        };
    }

    /**
     * Register a new fingerprint for an alert
     */
    public static async registerFingerprint(
        alert: Alert,
        config?: Partial<DeduplicationConfig>
    ): Promise<AlertFingerprint> {
        const mergedConfig = { ...DEFAULT_DEDUPLICATION_CONFIG, ...config };

        const fingerprint = alert.fingerprint ||
            FingerprintGenerator.generate(alert, mergedConfig);

        const now = new Date();
        const windowEnd = OneUptimeDate.addRemoveMinutes(
            now,
            mergedConfig.windowMinutes
        );

        const fingerprintRecord = await AlertFingerprintService.create({
            data: {
                projectId: alert.projectId,
                fingerprint,
                fingerprintFields: mergedConfig.fingerprintFields,
                canonicalAlertId: alert.id,
                duplicateCount: 0,
                windowStartAt: now,
                windowEndAt: windowEnd,
            } as AlertFingerprint,
            props: { isRoot: true },
        });

        return fingerprintRecord;
    }

    /**
     * Process an alert through deduplication
     * Returns the alert to create (or null if duplicate)
     */
    public static async processAlert(
        alertData: Partial<Alert>,
        projectId: ObjectID,
        config?: Partial<DeduplicationConfig>
    ): Promise<{
        shouldCreate: boolean;
        alertData: Partial<Alert>;
        deduplicationResult: DeduplicationResult;
    }> {
        const mergedConfig = { ...DEFAULT_DEDUPLICATION_CONFIG, ...config };

        // Skip deduplication if disabled
        if (!mergedConfig.enabled) {
            const fingerprint = FingerprintGenerator.generate(alertData, mergedConfig);
            return {
                shouldCreate: true,
                alertData: { ...alertData, fingerprint },
                deduplicationResult: {
                    isDuplicate: false,
                    fingerprint,
                },
            };
        }

        // Check for duplicate
        const result = await this.checkDuplicate(alertData, projectId, mergedConfig);

        if (result.isDuplicate) {
            return {
                shouldCreate: false,
                alertData,
                deduplicationResult: result,
            };
        }

        // Not a duplicate - add fingerprint to alert data
        return {
            shouldCreate: true,
            alertData: { ...alertData, fingerprint: result.fingerprint },
            deduplicationResult: result,
        };
    }

    /**
     * Get deduplication statistics for a project
     */
    public static async getStatistics(
        projectId: ObjectID,
        startDate: Date,
        endDate: Date
    ): Promise<{
        totalAlerts: number;
        uniqueAlerts: number;
        duplicateCount: number;
        deduplicationRate: number;
    }> {
        // Count total fingerprint records
        const fingerprints = await AlertFingerprintService.findBy({
            query: {
                projectId,
                windowStartAt: QueryHelper.between(startDate, endDate),
            },
            select: {
                _id: true,
                duplicateCount: true,
            },
            props: { isRoot: true },
        });

        const uniqueAlerts = fingerprints.length;
        const duplicateCount = fingerprints.reduce(
            (sum, fp) => sum + (fp.duplicateCount || 0),
            0
        );
        const totalAlerts = uniqueAlerts + duplicateCount;
        const deduplicationRate = totalAlerts > 0
            ? (duplicateCount / totalAlerts) * 100
            : 0;

        return {
            totalAlerts,
            uniqueAlerts,
            duplicateCount,
            deduplicationRate: Math.round(deduplicationRate * 100) / 100,
        };
    }
}
```

---

### 3. AlertFingerprintService

Database service for AlertFingerprint model.

**File Location:** `/Common/Server/Services/AlertFingerprintService.ts`

```typescript
import DatabaseService from './DatabaseService';
import AlertFingerprint from '../Models/DatabaseModels/AlertFingerprint';
import ObjectID from 'Common/Types/ObjectID';
import QueryHelper from '../Types/Database/QueryHelper';

export class Service extends DatabaseService<AlertFingerprint> {
    public constructor() {
        super(AlertFingerprint);
    }

    /**
     * Clean up expired fingerprints
     */
    public async cleanupExpired(): Promise<number> {
        const result = await this.deleteBy({
            query: {
                windowEndAt: QueryHelper.lessThan(new Date()),
            },
            props: { isRoot: true },
        });

        return result;
    }

    /**
     * Get active fingerprints for a project
     */
    public async getActiveFingerprints(
        projectId: ObjectID
    ): Promise<Array<AlertFingerprint>> {
        return await this.findBy({
            query: {
                projectId,
                windowEndAt: QueryHelper.greaterThan(new Date()),
            },
            select: {
                _id: true,
                fingerprint: true,
                canonicalAlertId: true,
                duplicateCount: true,
                windowEndAt: true,
            },
            props: { isRoot: true },
        });
    }

    /**
     * Extend the window for a fingerprint (if alert is still active)
     */
    public async extendWindow(
        fingerprintId: ObjectID,
        newEndTime: Date
    ): Promise<void> {
        await this.updateOneById({
            id: fingerprintId,
            data: {
                windowEndAt: newEndTime,
            },
            props: { isRoot: true },
        });
    }
}

export default new Service();
```

---

### 4. Integration with AlertService

Modify AlertService to use deduplication.

**File Location:** `/Common/Server/Services/AlertService.ts` (modifications)

```typescript
import DeduplicationEngine from '../Utils/Alert/DeduplicationEngine';
import { DeduplicationConfig, DEFAULT_DEDUPLICATION_CONFIG } from 'Common/Types/Alert/DeduplicationConfig';

// In onBeforeCreate():
protected async onBeforeCreate(
    createBy: CreateBy<Alert>
): Promise<OnCreate<Alert>> {
    // ... existing code ...

    // Get deduplication config for project
    const deduplicationConfig = await this.getDeduplicationConfig(
        createBy.data.projectId!
    );

    // Process through deduplication engine
    const deduplicationResult = await DeduplicationEngine.processAlert(
        createBy.data,
        createBy.data.projectId!,
        deduplicationConfig
    );

    if (!deduplicationResult.shouldCreate) {
        // This is a duplicate - don't create
        throw new DuplicateAlertException(
            `Duplicate of alert #${deduplicationResult.deduplicationResult.canonicalAlert?.alertNumber}`,
            deduplicationResult.deduplicationResult.canonicalAlertId!
        );
    }

    // Add fingerprint to alert data
    createBy.data.fingerprint = deduplicationResult.alertData.fingerprint;

    // ... rest of existing code ...
}

// In onCreateSuccess():
protected async onCreateSuccess(
    onCreate: OnCreate<Alert>,
    createdItem: Alert
): Promise<Alert> {
    // ... existing code ...

    // Register fingerprint for deduplication
    const deduplicationConfig = await this.getDeduplicationConfig(
        createdItem.projectId!
    );

    if (deduplicationConfig.enabled) {
        await DeduplicationEngine.registerFingerprint(
            createdItem,
            deduplicationConfig
        );
    }

    // ... rest of existing code ...
}

// Helper method:
private async getDeduplicationConfig(
    projectId: ObjectID
): Promise<DeduplicationConfig> {
    const project = await ProjectService.findOneById({
        id: projectId,
        select: { alertDeduplicationConfig: true },
        props: { isRoot: true },
    });

    return project?.alertDeduplicationConfig || DEFAULT_DEDUPLICATION_CONFIG;
}
```

---

### 5. DuplicateAlertException

Custom exception for duplicate alerts.

**File Location:** `/Common/Types/Exception/DuplicateAlertException.ts`

```typescript
import Exception from './Exception';
import ExceptionCode from './ExceptionCode';
import ObjectID from '../ObjectID';

export default class DuplicateAlertException extends Exception {
    public canonicalAlertId: ObjectID;

    public constructor(message: string, canonicalAlertId: ObjectID) {
        super(ExceptionCode.DuplicateAlertException, message);
        this.canonicalAlertId = canonicalAlertId;
    }
}
```

---

## Worker Jobs

### 1. FingerprintCleanup Job

**File Location:** `/Worker/Jobs/AlertDeduplication/FingerprintCleanup.ts`

```typescript
import RunCron from '../../Utils/Cron';
import { EVERY_HOUR } from 'Common/Utils/CronTime';
import AlertFingerprintService from 'Common/Server/Services/AlertFingerprintService';

RunCron(
    'AlertDeduplication:FingerprintCleanup',
    { schedule: EVERY_HOUR, runOnStartup: false },
    async () => {
        const deletedCount = await AlertFingerprintService.cleanupExpired();

        if (deletedCount > 0) {
            logger.info(`Cleaned up ${deletedCount} expired fingerprints`);
        }
    }
);
```

---

## Redis Caching (Optional Enhancement)

For high-throughput systems, cache fingerprints in Redis.

**File Location:** `/Common/Server/Utils/Alert/FingerprintCache.ts`

```typescript
import Redis from '../../Infrastructure/Redis';
import ObjectID from 'Common/Types/ObjectID';

export default class FingerprintCache {
    private static CACHE_PREFIX = 'alert:fingerprint:';
    private static DEFAULT_TTL_SECONDS = 3600; // 1 hour

    /**
     * Get a cached fingerprint
     */
    public static async get(
        projectId: ObjectID,
        fingerprint: string
    ): Promise<{ canonicalAlertId: string; duplicateCount: number } | null> {
        const key = this.buildKey(projectId, fingerprint);
        const value = await Redis.get(key);

        if (!value) {
            return null;
        }

        return JSON.parse(value);
    }

    /**
     * Set a fingerprint in cache
     */
    public static async set(
        projectId: ObjectID,
        fingerprint: string,
        data: { canonicalAlertId: string; duplicateCount: number },
        ttlSeconds: number = this.DEFAULT_TTL_SECONDS
    ): Promise<void> {
        const key = this.buildKey(projectId, fingerprint);
        await Redis.setex(key, ttlSeconds, JSON.stringify(data));
    }

    /**
     * Increment duplicate count in cache
     */
    public static async incrementDuplicateCount(
        projectId: ObjectID,
        fingerprint: string
    ): Promise<number> {
        const key = this.buildKey(projectId, fingerprint);
        const countKey = `${key}:count`;
        return await Redis.incr(countKey);
    }

    /**
     * Delete a fingerprint from cache
     */
    public static async delete(
        projectId: ObjectID,
        fingerprint: string
    ): Promise<void> {
        const key = this.buildKey(projectId, fingerprint);
        await Redis.del(key);
    }

    private static buildKey(projectId: ObjectID, fingerprint: string): string {
        return `${this.CACHE_PREFIX}${projectId.toString()}:${fingerprint}`;
    }
}
```

---

## Implementation Checklist

### Phase 1: Core Components
- [ ] Create FingerprintGenerator utility
- [ ] Create DeduplicationEngine
- [ ] Create AlertFingerprintService
- [ ] Create DuplicateAlertException

### Phase 2: Integration
- [ ] Modify AlertService.onBeforeCreate()
- [ ] Modify AlertService.onCreateSuccess()
- [ ] Add fingerprint fields to Alert model
- [ ] Create AlertFingerprint model

### Phase 3: Background Jobs
- [ ] Create FingerprintCleanup job
- [ ] Register job in worker

### Phase 4: Testing
- [ ] Unit tests for FingerprintGenerator
- [ ] Unit tests for DeduplicationEngine
- [ ] Integration tests for deduplication flow
- [ ] Performance tests for high-volume scenarios

### Phase 5: Optional Enhancements
- [ ] Redis caching for fingerprints
- [ ] Configurable fingerprint fields per project
- [ ] Deduplication analytics API
