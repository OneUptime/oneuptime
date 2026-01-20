# UI Implementation for Alert Grouping

## Overview

This document details the frontend components and pages required for Alert Grouping / Episodes functionality.

## Navigation Structure

```
Dashboard
├── Alerts
│   ├── All Alerts (existing)
│   └── Episodes (NEW)
└── Settings
    ├── Alerts
    │   ├── Alert States (existing)
    │   ├── Alert Severities (existing)
    │   └── Grouping Rules (NEW)
```

---

## Pages to Create

### 1. Episodes List Page

**File Location:** `/Dashboard/src/Pages/Alerts/Episodes.tsx`

**Route:** `/dashboard/:projectId/alerts/episodes`

**Wireframe:**

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  Alerts > Episodes                                               [+ Create Episode] │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  ┌────────┬──────────────┬────────────┬───────┐     ┌─────────────────────────────┐ │
│  │ Active │ Acknowledged │  Resolved  │  All  │     │ 🔍 Search episodes...       │ │
│  │  (5)   │     (2)      │    (48)    │ (55)  │     └─────────────────────────────┘ │
│  └────────┴──────────────┴────────────┴───────┘                                      │
│                                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐ │
│  │ ● EP-42  Database Connectivity Issues                           🔴 Critical     │ │
│  │   ┌─────────────────────────────────────────────────────────────────────────┐   │ │
│  │   │ 15 alerts │ 3 monitors │ Started 10 min ago │ Last activity: 2 min ago │   │ │
│  │   └─────────────────────────────────────────────────────────────────────────┘   │ │
│  │                                                                                  │ │
│  │   Preview:                                                                       │ │
│  │   • Alert #123: MySQL connection timeout on web-server-1                        │ │
│  │   • Alert #124: MySQL connection timeout on web-server-2                        │ │
│  │   • Alert #125: PostgreSQL connection refused on api-server                     │ │
│  │   └── +12 more alerts                                                           │ │
│  │                                                                                  │ │
│  │   Rule: "Group database alerts within 5 min"      [Acknowledge] [Resolve]       │ │
│  └─────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐ │
│  │ ● EP-41  High CPU Utilization                                   🟠 High         │ │
│  │   ...                                                                           │ │
│  └─────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                      │
│                                                           [1] [2] [3] ... [Next →]  │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

**Implementation:**

```typescript
// /Dashboard/src/Pages/Alerts/Episodes.tsx

import React, { FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../PageComponentProps';
import ModelTable from 'Common/UI/Components/ModelTable/ModelTable';
import AlertEpisode from 'Common/Models/DatabaseModels/AlertEpisode';
import FieldType from 'Common/UI/Components/Types/FieldType';
import Navigation from 'Common/UI/Utils/Navigation';
import DashboardNavigation from '../../Utils/Navigation';
import AlertSeverity from 'Common/Models/DatabaseModels/AlertSeverity';
import AlertState from 'Common/Models/DatabaseModels/AlertState';
import Pill from 'Common/UI/Components/Pill/Pill';
import { Black } from 'Common/Types/BrandColors';

const EpisodesPage: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    return (
        <ModelTable<AlertEpisode>
            modelType={AlertEpisode}
            id="episodes-table"
            isDeleteable={true}
            isEditable={false}
            isCreateable={true}
            isViewable={true}
            name="Episodes"
            query={{
                projectId: DashboardNavigation.getProjectId()!,
            }}
            cardProps={{
                title: 'Episodes',
                description:
                    'Episodes group related alerts together for easier management.',
            }}
            selectMoreFields={{
                alertCount: true,
                uniqueMonitorCount: true,
                startedAt: true,
                lastActivityAt: true,
            }}
            columns={[
                {
                    field: {
                        episodeNumber: true,
                    },
                    title: 'Episode',
                    type: FieldType.Text,
                    getElement: (item: AlertEpisode): ReactElement => {
                        return (
                            <span className="font-medium">
                                EP-{item.episodeNumber}
                            </span>
                        );
                    },
                },
                {
                    field: {
                        title: true,
                    },
                    title: 'Title',
                    type: FieldType.Text,
                },
                {
                    field: {
                        currentAlertState: {
                            name: true,
                            color: true,
                        },
                    },
                    title: 'State',
                    type: FieldType.Entity,
                    getElement: (item: AlertEpisode): ReactElement => {
                        if (!item.currentAlertState) {
                            return <></>;
                        }
                        return (
                            <Pill
                                text={item.currentAlertState.name || ''}
                                color={item.currentAlertState.color || Black}
                            />
                        );
                    },
                },
                {
                    field: {
                        alertSeverity: {
                            name: true,
                            color: true,
                        },
                    },
                    title: 'Severity',
                    type: FieldType.Entity,
                    getElement: (item: AlertEpisode): ReactElement => {
                        if (!item.alertSeverity) {
                            return <></>;
                        }
                        return (
                            <Pill
                                text={item.alertSeverity.name || ''}
                                color={item.alertSeverity.color || Black}
                            />
                        );
                    },
                },
                {
                    field: {
                        alertCount: true,
                    },
                    title: 'Alerts',
                    type: FieldType.Number,
                },
                {
                    field: {
                        lastActivityAt: true,
                    },
                    title: 'Last Activity',
                    type: FieldType.DateTime,
                },
            ]}
            filters={[
                {
                    field: {
                        currentAlertState: {
                            _id: true,
                        },
                    },
                    title: 'State',
                    type: FieldType.Entity,
                    filterEntityType: AlertState,
                    filterQuery: {
                        projectId: DashboardNavigation.getProjectId()!,
                    },
                },
                {
                    field: {
                        alertSeverity: {
                            _id: true,
                        },
                    },
                    title: 'Severity',
                    type: FieldType.Entity,
                    filterEntityType: AlertSeverity,
                    filterQuery: {
                        projectId: DashboardNavigation.getProjectId()!,
                    },
                },
            ]}
            onViewPage={(item: AlertEpisode): void => {
                Navigation.navigate(
                    DashboardNavigation.getAlertEpisodeViewRoute(item._id!)
                );
            }}
        />
    );
};

export default EpisodesPage;
```

---

### 2. Episode Detail Page

**File Location:** `/Dashboard/src/Pages/Alerts/EpisodeView/Index.tsx`

**Route:** `/dashboard/:projectId/alerts/episodes/:episodeId`

**Wireframe:**

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  ← Episodes    EP-42: Database Connectivity Issues                                  │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  ┌──────────────────────────────────────────────┐  ┌──────────────────────────────┐ │
│  │  Status         │  🔴 Active                 │  │  Actions                     │ │
│  │  Severity       │  Critical                  │  │  ┌────────────────────────┐  │ │
│  │  Started        │  Jan 20, 2026 10:45 AM     │  │  │    [Acknowledge]       │  │ │
│  │  Last Activity  │  2 min ago                 │  │  │    [Resolve]           │  │ │
│  │  Alert Count    │  15                        │  │  │    [Add Alert]         │  │ │
│  │  Monitors       │  3                         │  │  │    [Merge Episodes]    │  │ │
│  └──────────────────────────────────────────────┘  └──────────────────────────────┘ │
│                                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐ │
│  │  Tabs: [Overview] [Alerts (15)] [Timeline] [Settings]                           │ │
│  └─────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                      │
│  OVERVIEW TAB:                                                                       │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐ │
│  │  Description                                                        [Edit]      │ │
│  │  Multiple database connection failures affecting production services            │ │
│  └─────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐ │
│  │  Assigned To                                                        [Edit]      │ │
│  │  👤 John Smith (DBA Team)                                                       │ │
│  └─────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐ │
│  │  Root Cause Analysis                                                [Edit]      │ │
│  │  Database connection pool exhausted due to connection leak in payment service   │ │
│  └─────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐ │
│  │  Grouping Rule                                                                  │ │
│  │  "Database alerts - 5min" (Time Window: 5 minutes)                              │ │
│  └─────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

**Sub-pages:**

| Route | Component | Description |
|-------|-----------|-------------|
| `/episodes/:id` | Overview | Episode details, owners, root cause |
| `/episodes/:id/alerts` | Alerts | List of alerts in episode |
| `/episodes/:id/timeline` | Timeline | Episode activity timeline |
| `/episodes/:id/settings` | Settings | Delete episode |

---

### 3. Episode Alerts Tab

**File Location:** `/Dashboard/src/Pages/Alerts/EpisodeView/Alerts.tsx`

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  ALERTS TAB:                                                        [+ Add Alert]   │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  ┌───────┬──────────────────────────────────────────────┬──────────┬───────┬──────┐ │
│  │ ID    │ Title                                        │ Monitor  │ State │ ···  │ │
│  ├───────┼──────────────────────────────────────────────┼──────────┼───────┼──────┤ │
│  │ #127  │ MySQL connection pool exhausted              │ mysql-01 │ ● Act │ [x]  │ │
│  │ #126  │ MySQL connection timeout                     │ web-02   │ ● Act │ [x]  │ │
│  │ #125  │ PostgreSQL connection refused                │ api-01   │ ✓ Res │ [x]  │ │
│  │ #124  │ MySQL connection timeout                     │ web-02   │ ● Act │ [x]  │ │
│  │ #123  │ MySQL connection timeout                     │ web-01   │ ● Act │ [x]  │ │
│  └───────┴──────────────────────────────────────────────┴──────────┴───────┴──────┘ │
│                                                                                      │
│  Note: [x] = Remove from episode button                                             │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

---

### 4. Grouping Rules Page

**File Location:** `/Dashboard/src/Pages/Settings/AlertGroupingRules.tsx`

**Route:** `/dashboard/:projectId/settings/alert-grouping-rules`

**Wireframe:**

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  Settings > Alert Grouping Rules                                 [+ Create Rule]    │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  Grouping rules automatically combine related alerts into Episodes.                  │
│                                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐ │
│  │  ✅  Database Alerts - 5 minute window                          Priority: 1     │ │
│  │  ────────────────────────────────────────────────────────────────────────────── │ │
│  │  Type: Time Window (5 minutes)                                                  │ │
│  │  Matches: Monitors with label "database"                                        │ │
│  │  Episodes created: 23  │  Alerts grouped: 156                                   │ │
│  │                                                                  [Edit] [Delete]│ │
│  └─────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐ │
│  │  ❌  Smart Grouping (Disabled)                                  Priority: 2     │ │
│  │  ────────────────────────────────────────────────────────────────────────────── │ │
│  │  Type: Smart (80% similarity)                                                   │ │
│  │  Matches: All critical alerts                                                   │ │
│  │                                                         [Enable] [Edit] [Delete]│ │
│  └─────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

---

### 5. Create/Edit Grouping Rule Form

**File Location:** `/Dashboard/src/Pages/Settings/AlertGroupingRuleView/Index.tsx`

**Wireframe:**

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  Create Grouping Rule                                                               │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  BASIC INFORMATION                                                                   │
│  ─────────────────────────────────────────────────────────────────────────────────  │
│                                                                                      │
│  Rule Name *                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐ │
│  │ Database Alerts - 5 minute window                                               │ │
│  └─────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                      │
│  Description                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐ │
│  │ Groups database-related alerts within 5 minutes                                 │ │
│  └─────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                      │
│  Priority (lower = evaluated first)                                                  │
│  ┌──────────┐                                                                        │
│  │ 1        │                                                                        │
│  └──────────┘                                                                        │
│                                                                                      │
│  MATCHING CRITERIA                                                                   │
│  ─────────────────────────────────────────────────────────────────────────────────  │
│  Which alerts should this rule apply to?                                            │
│                                                                                      │
│  Severities (optional)                                                               │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐ │
│  │ [Critical ×] [High ×]                                              [+ Add]      │ │
│  └─────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                      │
│  Labels (optional)                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐ │
│  │ [database ×]                                                       [+ Add]      │ │
│  └─────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                      │
│  Title Pattern (regex, optional)                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐ │
│  │ .*(connection|database|mysql|postgres).*                                        │ │
│  └─────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                      │
│  GROUPING METHOD                                                                     │
│  ─────────────────────────────────────────────────────────────────────────────────  │
│                                                                                      │
│  Grouping Type *                                                                     │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐                   │
│  │ ● Time Window    │  │ ○ Field-Based    │  │ ○ Smart (Beta)   │                   │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘                   │
│                                                                                      │
│  Time Window (minutes) *                                                             │
│  ┌──────────┐                                                                        │
│  │ 5        │  Alerts arriving within this window will be grouped together.         │
│  └──────────┘                                                                        │
│                                                                                      │
│  EPISODE SETTINGS                                                                    │
│  ─────────────────────────────────────────────────────────────────────────────────  │
│                                                                                      │
│  Episode Title Template                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐ │
│  │ {{severity}} - Database Issues                                                  │ │
│  └─────────────────────────────────────────────────────────────────────────────────┘ │
│  Available: {{severity}}, {{monitor}}, {{alertCount}}                               │
│                                                                                      │
│  ☑ Auto-resolve episode when all alerts are resolved                                │
│                                                                                      │
│  Break episode after inactive for (minutes)                                          │
│  ┌──────────┐                                                                        │
│  │ 60       │                                                                        │
│  └──────────┘                                                                        │
│                                                                                      │
│                                               [Cancel]    [Test Rule]    [Save]     │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Existing Page Modifications

### 1. Alerts Table Enhancement

Add Episode column to the existing Alerts table.

**File:** `/Dashboard/src/Pages/Alerts/View/Index.tsx`

```typescript
// Add to columns array:
{
    field: {
        episode: {
            _id: true,
            episodeNumber: true,
            title: true,
        },
    },
    title: 'Episode',
    type: FieldType.Entity,
    getElement: (item: Alert): ReactElement => {
        if (!item.episode) {
            return <span className="text-gray-400">—</span>;
        }
        return (
            <Link
                to={DashboardNavigation.getAlertEpisodeViewRoute(
                    item.episode._id!
                )}
            >
                EP-{item.episode.episodeNumber}
            </Link>
        );
    },
},
```

### 2. Alert Detail Page Enhancement

Show episode membership on alert detail page.

**File:** `/Dashboard/src/Pages/Alerts/AlertView/Index.tsx`

Add a card showing:
- Episode badge (if part of episode)
- Link to episode detail
- Button to remove from episode

---

## Components to Create

### 1. EpisodeCard Component

**File:** `/Dashboard/src/Components/Episode/EpisodeCard.tsx`

Reusable card for displaying episode summary.

```typescript
interface EpisodeCardProps {
    episode: AlertEpisode;
    showAlertPreview?: boolean;
    onAcknowledge?: () => void;
    onResolve?: () => void;
}
```

### 2. EpisodeBadge Component

**File:** `/Dashboard/src/Components/Episode/EpisodeBadge.tsx`

Small badge showing episode number and link.

```typescript
interface EpisodeBadgeProps {
    episodeNumber: number;
    episodeId: ObjectID;
}
```

### 3. AddAlertToEpisodeModal Component

**File:** `/Dashboard/src/Components/Episode/AddAlertToEpisodeModal.tsx`

Modal for manually adding alerts to an episode.

### 4. MergeEpisodesModal Component

**File:** `/Dashboard/src/Components/Episode/MergeEpisodesModal.tsx`

Modal for merging multiple episodes.

### 5. GroupingRuleForm Component

**File:** `/Dashboard/src/Components/GroupingRule/GroupingRuleForm.tsx`

Form for creating/editing grouping rules with:
- Match criteria builder
- Grouping type selector
- Episode config options

---

## Routing Configuration

Add to `/Dashboard/src/Routes/AlertRoutes.tsx`:

```typescript
// Episode routes
{
    path: '/dashboard/:projectId/alerts/episodes',
    component: EpisodesPage,
},
{
    path: '/dashboard/:projectId/alerts/episodes/:episodeId',
    component: EpisodeViewLayout,
    children: [
        {
            path: '',
            component: EpisodeOverview,
        },
        {
            path: 'alerts',
            component: EpisodeAlerts,
        },
        {
            path: 'timeline',
            component: EpisodeTimeline,
        },
        {
            path: 'settings',
            component: EpisodeSettings,
        },
    ],
},
```

Add to `/Dashboard/src/Routes/SettingsRoutes.tsx`:

```typescript
// Grouping rule routes
{
    path: '/dashboard/:projectId/settings/alert-grouping-rules',
    component: AlertGroupingRulesPage,
},
{
    path: '/dashboard/:projectId/settings/alert-grouping-rules/:ruleId',
    component: AlertGroupingRuleViewLayout,
},
```

---

## Navigation Helper Updates

Add to `/Dashboard/src/Utils/Navigation.ts`:

```typescript
public static getAlertEpisodesRoute(projectId?: ObjectID): Route {
    return new Route(`/dashboard/${projectId?.toString()}/alerts/episodes`);
}

public static getAlertEpisodeViewRoute(episodeId: ObjectID): Route {
    return new Route(
        `/dashboard/${this.getProjectId()?.toString()}/alerts/episodes/${episodeId.toString()}`
    );
}

public static getAlertGroupingRulesRoute(): Route {
    return new Route(
        `/dashboard/${this.getProjectId()?.toString()}/settings/alert-grouping-rules`
    );
}
```

---

## Sidebar Menu Updates

Add to Alerts section in `/Dashboard/src/Components/Sidebar/Sidebar.tsx`:

```typescript
{
    title: 'Episodes',
    route: RouteMap.AlertEpisodes,
    icon: IconProp.Layers,
}
```

Add to Settings > Alerts section:

```typescript
{
    title: 'Grouping Rules',
    route: RouteMap.AlertGroupingRules,
    icon: IconProp.Layers,
}
```

---

## Implementation Checklist

### Pages
- [ ] Episodes list page
- [ ] Episode detail page (overview)
- [ ] Episode alerts tab
- [ ] Episode timeline tab
- [ ] Episode settings tab
- [ ] Grouping rules list page
- [ ] Grouping rule detail/edit page

### Components
- [ ] EpisodeCard component
- [ ] EpisodeBadge component
- [ ] AddAlertToEpisodeModal
- [ ] MergeEpisodesModal
- [ ] GroupingRuleForm
- [ ] GroupingTypeSelector

### Existing Page Updates
- [ ] Add Episode column to Alerts table
- [ ] Add Episode card to Alert detail page
- [ ] Add sidebar navigation items
- [ ] Update route configuration

### Styling
- [ ] Episode card styles
- [ ] Episode badge styles
- [ ] Grouping rule form styles
- [ ] Timeline component styles
