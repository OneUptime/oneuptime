# Alert Suppression by Rules - Implementation Plan

## Feature Overview

This feature allows users to define project-level rules that suppress alert notifications while still recording alerts. When an alert matches a suppression rule:

- The alert IS created (recorded in database)
- The alert is linked to a parent alert (child-parent relationship)
- Notifications are NOT sent to on-call teams for the child alert
- When parent alert is resolved, all child alerts are automatically resolved

## Key Design Decisions

| Decision | Choice |
|----------|--------|
| Suppression behavior | Create alert, link to parent, suppress notifications |
| Parent determination | Auto-match to existing open alert |
| Resolution | Cascade - parent resolution resolves children |
| Filter criteria | All attributes (title, description, severity, monitor, labels, time) |
| Time windows | Support maintenance windows |
| Scope | Project-level |

---

## 1. Database Models

### 1.1 New Model: AlertSuppressionRule

**Create:** `Common/Models/DatabaseModels/AlertSuppressionRule.ts`

| Property | Type | Description |
|----------|------|-------------|
| id | ObjectID | Primary key |
| projectId | ObjectID | Tenant column |
| name | string | Rule name |
| description | string | Optional description |
| isEnabled | boolean | Default: true |
| priority | number | Evaluation order |
| filterCondition | FilterCondition | All/Any |
| filters | JSON | Array of AlertSuppressionRuleCondition |
| scheduleType | AlertSuppressionScheduleType | Always/TimeWindow |
| timeWindows | JSON | Optional time window config (when scheduleType is TimeWindow) |
| suppressDuringScheduledMaintenance | boolean | If true, rule only active when monitor has active maintenance |
| createdByUserId | ObjectID | Creator reference |
| createdAt | Date | Creation timestamp |
| updatedAt | Date | Update timestamp |

### 1.2 Modified Model: Alert

**Modify:** `Common/Models/DatabaseModels/Alert.ts`

Add the following columns:

| Column | Type | Description |
|--------|------|-------------|
| parentAlertId | ObjectID \| null | Self-referencing FK to parent alert |
| parentAlert | Alert \| null | ManyToOne relation |
| isSuppressed | boolean | Default: false |
| suppressedByRuleId | ObjectID \| null | FK to suppression rule |
| suppressedByRule | AlertSuppressionRule \| null | Relation to rule |

---

## 2. Types/Interfaces

### 2.1 AlertSuppressionRuleCondition

**Create:** `Common/Types/Alert/AlertSuppressionRuleCondition.ts`

```typescript
export enum AlertSuppressionCheckOn {
  AlertTitle = "Alert Title",
  AlertDescription = "Alert Description",
  AlertSeverity = "Alert Severity",
  MonitorName = "Monitor Name",
  MonitorType = "Monitor Type",
  MonitorLabels = "Monitor Labels",
  AlertLabels = "Alert Labels",
}

export interface AlertSuppressionRuleCondition {
  checkOn: AlertSuppressionCheckOn;
  conditionType: ConditionType;
  value: string | Array<string>;
}
```

### 2.2 AlertSuppressionScheduleType

**Create:** `Common/Types/Alert/AlertSuppressionScheduleType.ts`

```typescript
enum AlertSuppressionScheduleType {
  Always = "Always",
  TimeWindow = "Time Window",
}
```

> **Note:** Scheduled maintenance support is handled separately via the `suppressDuringScheduledMaintenance` boolean flag, which can be combined with any schedule type.

### 2.3 AlertSuppressionTimeWindow

**Create:** `Common/Types/Alert/AlertSuppressionTimeWindow.ts`

```typescript
export enum TimeWindowRecurrenceType {
  Weekly = "Weekly",
  Monthly = "Monthly",
  Yearly = "Yearly",
}

export interface AlertSuppressionTimeWindow {
  // Common fields
  startTime: string;  // HH:MM format
  endTime: string;    // HH:MM format
  timezone: string;
  recurrenceType: TimeWindowRecurrenceType;

  // Weekly recurrence (when recurrenceType is Weekly)
  daysOfWeek?: Array<DayOfWeek>;  // Monday, Tuesday, etc.

  // Monthly recurrence (when recurrenceType is Monthly)
  daysOfMonth?: Array<number>;     // 1-31 (specific dates)
  weeksOfMonth?: Array<number>;    // 1-5 (1st week, 2nd week, etc.)
  dayOfWeekForMonth?: DayOfWeek;   // Used with weeksOfMonth (e.g., "first Monday")

  // Yearly recurrence (when recurrenceType is Yearly)
  months?: Array<Month>;           // January, February, etc.
  daysOfMonthForYear?: Array<number>; // 1-31 (specific dates within the months)
}
```

**Examples:**

| Use Case | Configuration |
|----------|---------------|
| Every weekend | `recurrenceType: Weekly`, `daysOfWeek: [Saturday, Sunday]` |
| First Monday of each month | `recurrenceType: Monthly`, `weeksOfMonth: [1]`, `dayOfWeekForMonth: Monday` |
| 1st-5th of each month | `recurrenceType: Monthly`, `daysOfMonth: [1,2,3,4,5]` |
| December holidays | `recurrenceType: Yearly`, `months: [December]`, `daysOfMonthForYear: [24,25,26,31]` |
| Black Friday (4th Friday of Nov) | `recurrenceType: Yearly`, `months: [November]`, `weeksOfMonth: [4]`, `dayOfWeekForMonth: Friday` |

### 2.4 AlertSuppressionEvaluationResult

**Create:** `Common/Types/Alert/AlertSuppressionEvaluationResult.ts`

```typescript
export interface AlertSuppressionEvaluationResult {
  shouldSuppress: boolean;
  matchedRule: AlertSuppressionRule | null;
  parentAlert: Alert | null;
  reason: string;
}
```

---

## 3. Services

### 3.1 AlertSuppressionRuleService

**Create:** `Common/Server/Services/AlertSuppressionRuleService.ts`

Standard CRUD service following `AlertStateService.ts` pattern.

**Methods:**
- `findActiveRulesForProject(projectId: ObjectID)` - Get all enabled rules for project
- `isRuleActiveNow(rule: AlertSuppressionRule)` - Check if rule is currently active based on schedule
- `validateRule(rule: AlertSuppressionRule)` - Validate rule configuration

### 3.2 AlertSuppressionEvaluationService

**Create:** `Common/Server/Services/AlertSuppressionEvaluationService.ts`

Core evaluation logic for determining if alerts should be suppressed.

**Methods:**

```typescript
// Main entry point - evaluate if alert should be suppressed
public static async evaluateAlert(data: {
  alert: Alert;
  monitor: Monitor;
  projectId: ObjectID;
}): Promise<AlertSuppressionEvaluationResult>;

// Check if alert matches a specific rule's conditions
private static doesAlertMatchRule(
  alert: Alert,
  monitor: Monitor,
  rule: AlertSuppressionRule
): boolean;

// Evaluate individual condition against alert/monitor
private static evaluateCondition(
  condition: AlertSuppressionRuleCondition,
  alert: Alert,
  monitor: Monitor
): boolean;

// Find potential parent alert based on rule criteria
public static async findParentAlert(data: {
  projectId: ObjectID;
  rule: AlertSuppressionRule;
  newAlert: Alert;
}): Promise<Alert | null>;

// Check if rule is currently active (time-based)
private static isRuleActive(rule: AlertSuppressionRule): boolean;
```

### 3.3 Modify AlertService

**Modify:** `Common/Server/Services/AlertService.ts`

Changes to `onCreateSuccess()`:
- Check suppression rules after alert creation
- If suppressed, skip notifications by setting `isOwnerNotifiedOfAlertCreation = true`

**New Methods:**

```typescript
// Resolve all child alerts when parent is resolved
public async resolveChildAlerts(parentAlertId: ObjectID): Promise<void>;

// Get count of child alerts for display
public async getChildAlertCount(alertId: ObjectID): Promise<number>;

// Get all child alerts for a parent
public async getChildAlerts(parentAlertId: ObjectID): Promise<Array<Alert>>;
```

### 3.4 Modify AlertStateTimelineService

**Modify:** `Common/Server/Services/AlertStateTimelineService.ts`

In `onCreateSuccess()`, trigger cascade resolution:

```typescript
if (alertState?.isResolvedState) {
  await AlertService.resolveChildAlerts(createdItem.alertId!);
}
```

---

## 4. Integration Points

### 4.1 MonitorAlert Integration

**Modify:** `Common/Server/Utils/Monitor/MonitorAlert.ts`

Location: `criteriaMetCreateAlertsAndUpdateMonitorStatus()` method, after `AlertService.create()` call.

```typescript
// After alert creation (around line 260)
const suppressionResult = await AlertSuppressionEvaluationService.evaluateAlert({
  alert: createdAlert,
  monitor: input.monitor,
  projectId: input.monitor.projectId!,
});

if (suppressionResult.shouldSuppress) {
  await AlertService.updateOneById({
    id: createdAlert.id!,
    data: {
      isSuppressed: true,
      parentAlertId: suppressionResult.parentAlert?.id,
      suppressedByRuleId: suppressionResult.matchedRule?.id,
      isOwnerNotifiedOfAlertCreation: true, // Prevents notification crons
    },
    props: { isRoot: true },
  });

  // Add event to evaluation summary
  input.evaluationSummary?.events.push({
    type: "alert-suppressed",
    title: `Alert suppressed by rule: ${suppressionResult.matchedRule?.name}`,
    message: suppressionResult.reason,
    relatedAlertId: createdAlert.id?.toString(),
    at: OneUptimeDate.getCurrentDate(),
  });
}
```

---

## 5. Permissions

**Modify:** `Common/Types/Permission.ts`

Add new permissions:

```typescript
CreateAlertSuppressionRule = "CreateAlertSuppressionRule",
DeleteAlertSuppressionRule = "DeleteAlertSuppressionRule",
EditAlertSuppressionRule = "EditAlertSuppressionRule",
ReadAlertSuppressionRule = "ReadAlertSuppressionRule",
```

---

## 6. UI Components

### 6.1 Settings Pages

**Create:** `Dashboard/src/Pages/Settings/AlertSuppressionRules.tsx`
- List all suppression rules for the project
- Create/Edit/Delete rules
- Toggle enable/disable

**Create:** `Dashboard/src/Pages/Settings/AlertSuppressionRuleView.tsx`
- View rule details
- See matched/suppressed alerts history

### 6.2 Side Menu Update

**Modify:** `Dashboard/src/Pages/Settings/SideMenu.tsx`

Add under "Alerts" section:

```typescript
{
  link: {
    title: "Suppression Rules",
    to: RouteUtil.populateRouteParams(
      RouteMap[PageMap.SETTINGS_ALERT_SUPPRESSION_RULES] as Route,
    ),
  },
  icon: IconProp.Filter,
},
```

### 6.3 Route Updates

**Modify:** `Dashboard/src/Utils/PageMap.ts`

```typescript
SETTINGS_ALERT_SUPPRESSION_RULES = "SETTINGS_ALERT_SUPPRESSION_RULES",
SETTINGS_ALERT_SUPPRESSION_RULE_VIEW = "SETTINGS_ALERT_SUPPRESSION_RULE_VIEW",
```

**Modify:** `Dashboard/src/Utils/RouteMap.ts`

Add corresponding routes.

### 6.4 Alert Detail Updates

Update alert detail pages to show:
- **If suppressed**: Banner with link to parent alert and suppression rule
- **If parent with children**: Child alert count and link to view children

---

## 7. Implementation Sequence

### Phase 1: Core Infrastructure
1. Create type files in `Common/Types/Alert/`
   - `AlertSuppressionRuleCondition.ts`
   - `AlertSuppressionScheduleType.ts`
   - `AlertSuppressionTimeWindow.ts`
   - `AlertSuppressionEvaluationResult.ts`
2. Create `AlertSuppressionRule.ts` database model
3. Modify `Alert.ts` model (add parent/suppression columns)
4. Add permissions to `Permission.ts`
5. Run database migrations

### Phase 2: Services
1. Create `AlertSuppressionRuleService.ts`
2. Create `AlertSuppressionEvaluationService.ts`
3. Modify `AlertService.ts` (suppression handling + cascade)
4. Modify `AlertStateTimelineService.ts` (cascade trigger)

### Phase 3: Integration
1. Modify `MonitorAlert.ts` (suppression evaluation hook)
2. Test alert creation flow end-to-end

### Phase 4: UI
1. Create settings pages for rule management
2. Update side menu and routes
3. Update alert detail pages to show suppression info

### Phase 5: Testing
1. Unit tests for `AlertSuppressionEvaluationService`
2. Integration tests for cascade resolution
3. E2E tests for UI workflows

---

## 8. Files Summary

### New Files to Create

| File | Purpose |
|------|---------|
| `Common/Types/Alert/AlertSuppressionRuleCondition.ts` | Condition type definition |
| `Common/Types/Alert/AlertSuppressionScheduleType.ts` | Schedule type enum |
| `Common/Types/Alert/AlertSuppressionTimeWindow.ts` | Time window interface |
| `Common/Types/Alert/AlertSuppressionEvaluationResult.ts` | Evaluation result type |
| `Common/Models/DatabaseModels/AlertSuppressionRule.ts` | Database model |
| `Common/Server/Services/AlertSuppressionRuleService.ts` | CRUD service |
| `Common/Server/Services/AlertSuppressionEvaluationService.ts` | Evaluation service |
| `Dashboard/src/Pages/Settings/AlertSuppressionRules.tsx` | Settings list page |
| `Dashboard/src/Pages/Settings/AlertSuppressionRuleView.tsx` | Settings detail page |

### Files to Modify

| File | Changes |
|------|---------|
| `Common/Models/DatabaseModels/Alert.ts` | Add parentAlertId, isSuppressed, suppressedByRuleId columns |
| `Common/Server/Services/AlertService.ts` | Add suppression handling + cascade resolution |
| `Common/Server/Services/AlertStateTimelineService.ts` | Add cascade trigger on resolution |
| `Common/Server/Utils/Monitor/MonitorAlert.ts` | Add suppression evaluation after alert creation |
| `Common/Types/Permission.ts` | Add CRUD permissions for suppression rules |
| `Dashboard/src/Pages/Settings/SideMenu.tsx` | Add menu item |
| `Dashboard/src/Utils/PageMap.ts` | Add page entries |
| `Dashboard/src/Utils/RouteMap.ts` | Add routes |

---

## 9. Verification Plan

### Unit Tests
- Test `AlertSuppressionEvaluationService.evaluateAlert()` with various rule conditions
- Test `AlertSuppressionEvaluationService.findParentAlert()` matching logic
- Test time window evaluation logic
- Test scheduled maintenance integration

### Integration Tests
1. Create alert matching suppression rule → verify linked to parent, no notifications sent
2. Resolve parent alert → verify all children auto-resolved
3. Test with multiple rules at different priorities
4. Test disabled rules are skipped

### Manual Testing
1. Create suppression rule via UI
2. Configure filters and schedule
3. Trigger alert that matches rule
4. Verify alert is created but marked as suppressed
5. Verify parent-child linking
6. Verify no notifications sent for suppressed alert
7. Resolve parent alert
8. Verify cascade resolution to children

---

## 10. API Endpoints

Standard CRUD endpoints will be auto-generated via `@CrudApiEndpoint` decorator:

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/alert-suppression-rule` | List rules |
| POST | `/api/alert-suppression-rule` | Create rule |
| GET | `/api/alert-suppression-rule/:id` | Get rule |
| PUT | `/api/alert-suppression-rule/:id` | Update rule |
| DELETE | `/api/alert-suppression-rule/:id` | Delete rule |

### Custom Endpoints (Optional)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/alert-suppression-rule/test` | Test rule against sample data |
| GET | `/api/alert-suppression-rule/:id/matched-alerts` | Get alerts suppressed by rule |
