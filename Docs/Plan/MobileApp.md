# OneUptime On-Call Mobile App - Design Document

## Executive Summary

This document outlines the design for a native mobile app (iOS & Android) for OneUptime focused on on-call workflows. The app enables engineers to receive push notifications for incidents, alerts, and episodes, view their on-call status, and take actions (acknowledge, resolve) directly from their phone.

## Table of Contents

1. [Goals & Non-Goals](#goals--non-goals)
2. [Tech Stack](#tech-stack)
3. [UI/UX Design Philosophy](#uiux-design-philosophy)
4. [Architecture Overview](#architecture-overview)
5. [Backend Changes](#backend-changes)
6. [Mobile App Screens](#mobile-app-screens)
7. [Push Notifications](#push-notifications)
8. [Authentication Flow](#authentication-flow)
9. [API Integration](#api-integration)
10. [Deep Linking](#deep-linking)
11. [Offline Support](#offline-support)
12. [Project Structure](#project-structure)
13. [Implementation Phases](#implementation-phases)
14. [Testing Strategy](#testing-strategy)
15. [App Store Distribution](#app-store-distribution)

---

## Goals & Non-Goals

### Goals

- Connect to any OneUptime instance (self-hosted or cloud) via configurable server URL
- Receive native push notifications for incidents, alerts, incident episodes, and alert episodes
- View current on-call status (am I on-call right now?)
- View and manage incidents, alerts, and their episodes
- Acknowledge and resolve incidents/alerts directly from push notifications or the app
- Support multiple projects with project switching
- Support biometric authentication (Face ID, fingerprint) for quick unlock
- Work reliably on poor network connections

### Non-Goals (V1)

- Full dashboard feature parity (monitor management, status pages, workflow builder)
- Creating new incidents or alerts from the app
- On-call schedule management (view only, not edit)
- Admin features (team management, billing, project settings)
- Offline incident creation

---

## Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Framework** | React Native + Expo | Shares React expertise with existing Dashboard team; single codebase for iOS & Android; Expo simplifies build/deploy |
| **Navigation** | React Navigation 7 | Industry standard for React Native; supports deep linking, stack/tab navigation |
| **State & Caching** | TanStack Query (React Query) | Automatic caching, background refetch, optimistic updates, offline support |
| **Push Notifications** | Firebase Cloud Messaging (FCM) + APNs | Native push for both platforms; FCM handles Android natively and proxies to APNs for iOS |
| **Auth Token Storage** | react-native-keychain | Secure storage in iOS Keychain / Android Keystore |
| **HTTP Client** | Axios | Consistent with existing Common/UI/Utils/API patterns |
| **Forms** | React Hook Form | Lightweight, performant form handling |
| **Icons** | React Native Vector Icons | Consistent icon set across platforms |
| **Testing** | Jest + React Native Testing Library | Unit and integration testing |
| **E2E Testing** | Detox | Native E2E testing framework |

---

## UI/UX Design Philosophy

> Engineers will be woken up at 3 AM by this app. Every design decision must respect that reality. The UI must be instantly legible, require zero cognitive effort to parse, and make the critical action (acknowledge) reachable in under 2 seconds. The UI should be modern, polished, and pleasant to use. Implement pleasent animations and haptic feedback, but never at the cost of speed or clarity. The app should feel like a native extension of the phone's OS, not a clunky cross-platform afterthought.

### Core Design Principles

**1. Dark-first, always.**
- The app ships with a dark theme as the default and primary experience. No blinding white screens at 3 AM.
- Deep, muted background (`#0D1117` — near-black with a cool undertone) that's easy on dark-adapted eyes.
- Light theme available as an option, but dark is the default and the hero experience.
- Respects system appearance setting — auto-switches if the user prefers, but defaults to dark if no system preference is set.

**2. Glanceable hierarchy.**
- Every screen must answer its core question within 1 second of looking at it:
  - Home: "Am I on-call? Is anything on fire?"
  - Incident list: "How many active incidents? Which is most severe?"
  - Detail: "What happened? What do I need to do?"
- Use **size, weight, and color** to create hierarchy — not clutter.
- Critical information (severity, state, time) uses bold type and color. Secondary metadata uses muted text.

**3. Severity drives color.**
- Color is reserved almost exclusively for severity and state. The rest of the UI is neutral.
- This means when a red critical badge appears, it _pops_ — it's not competing with decorative colors elsewhere.

**4. Big touch targets, generous spacing.**
- Minimum 48x48pt touch targets (Apple HIG + Material guidelines).
- Action buttons (Acknowledge, Resolve) are full-width, 56pt tall, with generous vertical margin.
- No tiny icons or links that require precise tapping from a groggy user.

**5. Minimal, purposeful animation.**
- No gratuitous transitions or loading choreography.
- Subtle haptic feedback on acknowledge/resolve (success confirmation).
- Skeleton screens for loading states — never a blank screen or a spinner in the center of an empty page.

### Color System

#### Dark Theme (Default)

| Token | Value | Usage |
|-------|-------|-------|
| `background.primary` | `#0D1117` | Main screen background |
| `background.secondary` | `#161B22` | Cards, elevated surfaces |
| `background.tertiary` | `#21262D` | Input fields, pressed states |
| `border.default` | `#30363D` | Card borders, dividers |
| `border.subtle` | `#21262D` | Subtle separators |
| `text.primary` | `#F0F6FC` | Headings, primary content |
| `text.secondary` | `#8B949E` | Timestamps, metadata, labels |
| `text.tertiary` | `#6E7681` | Placeholders, disabled text |

#### Light Theme

| Token | Value | Usage |
|-------|-------|-------|
| `background.primary` | `#FFFFFF` | Main screen background |
| `background.secondary` | `#F6F8FA` | Cards, elevated surfaces |
| `background.tertiary` | `#EAEEF2` | Input fields, pressed states |
| `border.default` | `#D0D7DE` | Card borders, dividers |
| `text.primary` | `#1F2328` | Headings, primary content |
| `text.secondary` | `#656D76` | Timestamps, metadata |
| `text.tertiary` | `#8C959F` | Placeholders, disabled text |

#### Semantic Colors (Same in Both Themes)

| Token | Value | Usage |
|-------|-------|-------|
| `severity.critical` | `#FF6B6B` | Critical severity badge, borders |
| `severity.critical.bg` | `#FF6B6B15` | Critical badge background (translucent) |
| `severity.high` | `#FFA657` | High severity |
| `severity.high.bg` | `#FFA65715` | High badge background |
| `severity.medium` | `#D2A8FF` | Medium severity |
| `severity.medium.bg` | `#D2A8FF15` | Medium badge background |
| `severity.low` | `#79C0FF` | Low severity |
| `severity.low.bg` | `#79C0FF15` | Low badge background |
| `state.created` | `#FF6B6B` | Created / triggered state |
| `state.acknowledged` | `#FFA657` | Acknowledged state |
| `state.resolved` | `#56D364` | Resolved state |
| `oncall.active` | `#56D364` | On-call active indicator |
| `oncall.inactive` | `#8B949E` | Not on-call |
| `action.primary` | `#58A6FF` | Primary action buttons |
| `action.danger` | `#F85149` | Destructive actions |
| `action.success` | `#56D364` | Resolve button |

### Typography

Use **SF Pro** (iOS) / **Roboto** (Android) — the platform defaults. No custom fonts. This ensures readability, fast rendering, and platform-native feel.

| Style | Size | Weight | Usage |
|-------|------|--------|-------|
| `title.large` | 28pt | Bold (700) | Screen titles |
| `title.medium` | 22pt | Semibold (600) | Section headers |
| `title.small` | 18pt | Semibold (600) | Card titles, incident names |
| `body.large` | 16pt | Regular (400) | Primary body text, descriptions |
| `body.medium` | 14pt | Regular (400) | Secondary text, metadata |
| `body.small` | 12pt | Medium (500) | Badges, timestamps, labels |
| `mono` | 14pt | Monospace | Incident/episode numbers (#42) |

**Key rules:**
- Never go below 12pt for any text — even tertiary labels.
- Incident/alert titles use `title.small` (18pt semibold) — readable at arm's length.
- Timestamps always use relative format ("3m ago", "2h ago") with `body.medium` in `text.secondary` color.

### Spacing & Layout

| Token | Value | Usage |
|-------|-------|-------|
| `space.xs` | 4pt | Inline spacing (badge padding) |
| `space.sm` | 8pt | Tight spacing (between badge and text) |
| `space.md` | 16pt | Standard spacing (between cards, section gaps) |
| `space.lg` | 24pt | Section separators |
| `space.xl` | 32pt | Screen top/bottom padding |
| `radius.sm` | 6pt | Small badges, chips |
| `radius.md` | 12pt | Cards, buttons |
| `radius.lg` | 16pt | Modals, bottom sheets |

**Card anatomy:**
```
┌─────────────────────────────────────────────────┐
│  16pt padding                                    │
│                                                  │
│  [ProjectBadge]  12pt gap  [SeverityBadge]      │
│                                                  │
│  8pt gap                                         │
│                                                  │
│  Incident Title (18pt semibold, text.primary)    │
│                                                  │
│  4pt gap                                         │
│                                                  │
│  State Badge  ·  3m ago (14pt, text.secondary)  │
│                                                  │
│  16pt padding                                    │
└─────────────────────────────────────────────────┘
   16pt gap to next card
```

### Component Design Specs

#### Severity Badge
- Pill shape (`radius.sm`), translucent background + solid text
- Example: `Critical` → `#FF6B6B` text on `#FF6B6B15` background
- All caps, `body.small` (12pt medium)
- No border — the translucent fill provides enough contrast on dark backgrounds

#### State Badge
- Same pill shape as severity
- Color matches state: red (Created), amber (Acknowledged), green (Resolved)
- Includes a small circle indicator dot before the text

#### Project Badge
- Small colored circle (8pt diameter, color auto-assigned per project) + project name in `body.small`
- Appears on every card in "All Projects" mode
- Compact: designed to not compete with severity/state for attention

#### Action Buttons (Acknowledge / Resolve)

The most critical interactive elements in the app. Designed for a half-awake user:

```
┌─────────────────────────────────────────────────┐
│                                                  │
│  ┌─────────────────────────────────────────────┐│
│  │          ACKNOWLEDGE                        ││
│  │     (full-width, 56pt tall, rounded)        ││
│  └─────────────────────────────────────────────┘│
│                                                  │
│  ┌──────────────────┐  ┌──────────────────────┐│
│  │    RESOLVE        │  │    ADD NOTE          ││
│  │  (half-width)     │  │  (half-width)        ││
│  └──────────────────┘  └──────────────────────┘│
│                                                  │
└─────────────────────────────────────────────────┘
```

- **Acknowledge**: Full-width, `action.primary` background, white text, 56pt tall. This is THE button at 3 AM. It's impossible to miss.
- **Resolve**: Half-width, `action.success` background, left-aligned.
- **Add Note**: Half-width, outlined style (`border.default`), right-aligned.
- After tapping Acknowledge/Resolve: button transitions to a checkmark with haptic feedback (success). No modal confirmation — the action is optimistic and reversible.

#### On-Call Status Banner (Home Screen)

**Active state:**
```
┌─────────────────────────────────────────────────┐
│  ●  YOU ARE ON-CALL                              │
│                                                  │
│  Production On-Call · Primary Rotation           │
│  Project: MyProject                              │
│  Until: Jan 22, 9:00 AM                         │
│                                                  │
│  [View Schedule →]                               │
└─────────────────────────────────────────────────┘
```
- Left border accent in `oncall.active` green
- Subtle green-tinted background (`#56D36408`)
- Pulsing green dot next to "YOU ARE ON-CALL"

**Inactive state:**
```
┌─────────────────────────────────────────────────┐
│  ○  You are not on-call                          │
│                                                  │
│  Next shift: Staging On-Call                     │
│  Starts: Jan 29, 9:00 AM (in 7 days)           │
└─────────────────────────────────────────────────┘
```
- Neutral border, muted text, no accent color
- Compact — takes less vertical space than active state

#### Skeleton Loading States

Every screen shows content-shaped skeleton placeholders while loading:
- Rounded rectangles matching the layout of real content
- Subtle shimmer animation (left-to-right, 1.5s cycle)
- Matches the exact card anatomy — so the transition from skeleton to real data is seamless with no layout shift
- Never show a centered spinner on an empty screen

#### Empty States

When a list has no items, show a centered illustration + message:
- Illustration: Simple, monochrome line art (not cartoon/playful — this is an ops tool)
- Message: Clear and actionable. E.g., "No active incidents" (not "Nothing here!" or "All clear!")
- Secondary text in `text.secondary` with context: "Incidents assigned to you will appear here."

#### Pull-to-Refresh

- Custom refresh indicator that matches the dark theme
- Subtle haptic on pull threshold
- Refresh indicator color matches `action.primary`

### Notification Sound Design

Push notifications at 3 AM need to be urgent but not jarring:

| Priority | Sound | Behavior |
|----------|-------|----------|
| Critical (On-Call Escalation) | Escalating tone — starts quiet, gets louder over 5 seconds. Repeats until dismissed. | iOS Critical Alert (bypasses DnD + silent mode) |
| High (Incident/Alert Created) | Two-tone chime — firm but brief. Plays once. | Default notification sound |
| Normal (State change, note) | Soft single tone. Plays once. | Default notification sound |
| Low (Informational) | No sound. Vibration only. | Silent notification |

### Swipe Gestures

| Gesture | Location | Action |
|---------|----------|--------|
| Swipe left on card | Incident/Alert list | Reveal "Acknowledge" action (green) |
| Swipe right on card | Incident/Alert list | Reveal "View Details" action (blue) |
| Pull down | Any list screen | Refresh |

Swipe actions use iOS-native feel (spring animation, haptic on threshold).

### Accessibility

- **Dynamic Type** (iOS) / **Font Scale** (Android): All text sizes scale with system accessibility settings
- **VoiceOver / TalkBack**: All interactive elements have semantic labels. Severity badges read as "Critical severity". Action buttons read as "Acknowledge incident [title]".
- **Minimum contrast ratio**: 4.5:1 for body text, 3:1 for large text (WCAG AA)
- **Reduce Motion**: Respect system setting — disable shimmer animations, transitions
- **Color-blind safe**: Severity levels use distinct hues (red, orange, purple, blue) that remain distinguishable under all common color vision deficiencies. Badges also include text labels — never color-only.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────┐
│                 React Native App (Expo)               │
│                                                       │
│  ┌──────────┐  ┌──────────┐  ┌────────────────────┐ │
│  │  Auth     │  │  On-Call  │  │  Incidents/Alerts  │ │
│  │  Flow     │  │  Home    │  │  List & Detail     │ │
│  └──────────┘  └──────────┘  └────────────────────┘ │
│  ┌──────────────┐  ┌────────────────────────────┐    │
│  │  Episodes    │  │  Push Notification Handler  │    │
│  │  List/Detail │  │  + Actionable Buttons       │    │
│  └──────────────┘  └────────────────────────────┘    │
│                                                       │
│  ┌─────────────────────────────────────────────────┐ │
│  │  API Client Layer (Axios + React Query)          │ │
│  │  JWT interceptor, auto-refresh, retry logic      │ │
│  └──────────────────────┬──────────────────────────┘ │
└─────────────────────────┼────────────────────────────┘
                          │ HTTPS + Bearer Token
                          ▼
┌──────────────────────────────────────────────────────┐
│              OneUptime Backend (Existing)              │
│                                                       │
│  ┌─────────────┐  ┌────────────────────────────────┐ │
│  │  Identity    │  │  Base API                      │ │
│  │  /login      │  │  /incident, /alert             │ │
│  │  /refresh    │  │  /incident-episode             │ │
│  │  /signup     │  │  /alert-episode                │ │
│  └─────────────┘  │  /on-call-duty-policy           │ │
│                    └────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────────┐│
│  │  Notification Service (Extended)                  ││
│  │  web-push (existing) + firebase-admin (new)       ││
│  └──────────────────────────────────────────────────┘│
│                                                       │
│  ┌──────────────────────────────────────────────────┐│
│  │  Worker Jobs (Existing)                           ││
│  │  IncidentEpisodeOwners/*, AlertEpisodeOwners/*    ││
│  │  OnCallDutyPolicyExecutionLog/*                   ││
│  └──────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────┐
│         Firebase Cloud Messaging (FCM)                │
│         Delivers push to iOS (APNs) & Android         │
└──────────────────────────────────────────────────────┘
```

---

## Backend Changes

### 1. Extend `UserPush` Model for Native Device Types

**File:** `Common/Models/DatabaseModels/UserPush.ts`

Currently the `deviceType` field only supports `"web"`. Extend to support native devices:

```typescript
// Add to device type options
export enum PushDeviceType {
    Web = "web",
    iOS = "ios",
    Android = "android",
}
```

**Changes needed:**
- Add `PushDeviceType` enum with `web`, `ios`, `android`
- Update `UserPush.deviceType` to use the enum
- For native devices, `deviceToken` stores the FCM registration token (plain string) instead of a web push subscription JSON object
- Add database migration for the new enum values

**Migration file:** `Common/Server/Infrastructure/Postgres/SchemaMigrations/XXXXXXXXX-AddMobileDeviceTypes.ts`

### 2. Extend `PushNotificationService` for FCM

**File:** `Common/Server/Services/PushNotificationService.ts`

Add Firebase Cloud Messaging support alongside existing web-push:

```typescript
// Routing logic in sendPushNotification():
if (deviceType === PushDeviceType.Web) {
    // Existing web-push flow (unchanged)
    await webpush.sendNotification(subscription, payload);
} else if (deviceType === PushDeviceType.iOS || deviceType === PushDeviceType.Android) {
    // New FCM flow
    await firebaseAdmin.messaging().send({
        token: fcmToken,
        notification: { title, body },
        data: { type, entityId, projectId },
        apns: { payload: { aps: { sound: "default", badge: 1 } } },
        android: { priority: "high", notification: { sound: "default" } },
    });
}
```

**New dependency:** `firebase-admin` npm package

**Configuration:** Add Firebase service account credentials to environment config:
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

### 3. Add Mobile-Friendly On-Call Status Endpoint

**File:** `Common/Server/API/OnCallDutyPolicyAPI.ts`

Add a new endpoint that returns the authenticated user's current on-call status:

```
GET /api/on-call-duty-policy/my-on-call-status
```

**Response:**
```json
{
    "isOnCall": true,
    "activeSchedules": [
        {
            "policyId": "...",
            "policyName": "Production On-Call",
            "scheduleName": "Primary Rotation",
            "projectId": "...",
            "projectName": "MyProject",
            "startsAt": "2024-01-15T00:00:00Z",
            "endsAt": "2024-01-22T00:00:00Z"
        }
    ],
    "nextSchedule": {
        "policyName": "Staging On-Call",
        "startsAt": "2024-01-29T00:00:00Z",
        "endsAt": "2024-02-05T00:00:00Z"
    },
    "pendingAcknowledgments": [
        {
            "type": "incident-episode",
            "id": "...",
            "title": "High CPU Usage on prod-api-01",
            "severity": "Critical",
            "createdAt": "2024-01-15T14:30:00Z"
        }
    ]
}
```

This endpoint aggregates data from:
- `OnCallDutyPolicyScheduleLayerUser` (current schedules)
- `OnCallDutyPolicyExecutionLog` (pending acknowledgments)
- `OnCallDutyPolicyEscalationRuleUser` (escalation membership)

### 4. Add Acknowledge-via-Push Endpoint

**File:** `Common/Server/API/IncidentAPI.ts` (and `AlertAPI.ts`, episode APIs)

Add a lightweight acknowledge endpoint optimized for mobile/push notification actions:

```
POST /api/incident/:id/acknowledge
POST /api/alert/:id/acknowledge
POST /api/incident-episode/:id/acknowledge
POST /api/alert-episode/:id/acknowledge
```

These endpoints change the entity state to "Acknowledged" with minimal payload, making it suitable for background notification actions on mobile.

---

## Mobile App Screens

### Screen 0: Server URL (Pre-Auth)

**Purpose:** Allow users to connect to any OneUptime instance before signing in. Since OneUptime is self-hostable, users need to specify their server URL.

**Layout:**
- OneUptime logo at top
- Text: "Connect to your OneUptime instance"
- URL input field pre-filled with `https://oneuptime.com` (the default cloud instance)
- "Connect" button
- Small helper text: "Self-hosting? Enter your OneUptime server URL above."

**Behavior:**
1. On first launch, show this screen with `https://oneuptime.com` pre-filled
2. On "Connect", validate the URL by calling `GET {serverUrl}/api/status` (health check endpoint)
3. If valid, store the server URL in AsyncStorage and navigate to Login screen
4. If invalid/unreachable, show error: "Could not connect to server. Please check the URL and try again."
5. On subsequent launches, skip this screen if a server URL is already stored (go straight to Login/Biometric)
6. Server URL can be changed later from Settings > Server URL (which clears tokens and returns to Login)

**Validation:**
- Must be a valid HTTPS URL (allow HTTP only for `localhost` / development)
- Strip trailing slashes
- Test connectivity with a lightweight health check before proceeding

**Storage:**
- Server URL persisted in AsyncStorage (not keychain, since it's not sensitive)
- All API calls use this stored URL as their base: `${serverUrl}/api`

### Tab Navigation Structure (Post-Auth)

```
┌─────────────────────────────────────────┐
│                                         │
│          [Current Screen]               │
│                                         │
│                                         │
│                                         │
├─────────┬──────────┬──────────┬────────┤
│  Home   │Incidents │  Alerts  │Settings│
│   🏠    │    🔥    │    ⚡    │   ⚙️   │
└─────────┴──────────┴──────────┴────────┘
```

### Screen 1: Home (On-Call Dashboard)

**Purpose:** At-a-glance view of on-call status and pending items across **all projects**.

**Sections:**
1. **On-Call Status Banner**
   - Green: "You are on-call" with schedule details and project name
   - Gray: "You are not on-call" with next shift info
   - If on-call for multiple projects, show a stacked list
2. **Pending Acknowledgments** (cards with swipe-to-acknowledge)
   - Unacknowledged incidents/alerts assigned to the user across all projects
   - Each card shows: **project badge**, title, severity badge, time since creation
3. **Recent Activity Feed**
   - Last 10 events across all projects (new incidents, state changes, notes)
   - Each item prefixed with project badge
4. **Quick Stats** (aggregated across all projects)
   - Active incidents count
   - Active alerts count
   - Open episodes count

**Note:** Home screen always shows all projects (no project filter) to ensure nothing is missed.

**API calls (per project, in parallel):**
- `GET /api/on-call-duty-policy/my-on-call-status` (per project)
- `POST /api/incident/get-list` (filter: active, assigned to user) (per project)
- `POST /api/alert/get-list` (filter: active, assigned to user) (per project)

### Screen 2: Incidents List

**Purpose:** Browse and filter incidents across projects.

**Features:**
- **Project filter chip** at top: `[All Projects ▼]` — tap to filter to one project
- Tab filters: Active | Acknowledged | Resolved
- Each row shows: **project badge**, incident number, title, severity badge, state, time
- Pull-to-refresh
- Infinite scroll pagination
- Search by title
- Tap to open Incident Detail

**API calls:**
- All Projects mode: `POST /api/incident/get-list` per project (parallel), merged client-side
- Single Project mode: `POST /api/incident/get-list` with single `tenantid`

### Screen 3: Incident Detail

**Purpose:** View full incident details and take actions.

**Sections:**
1. **Header:** **Project badge**, title, severity, current state, created/updated times
2. **Monitors:** Affected monitors list
3. **Owners:** Assigned users and teams
4. **Timeline:** State change history
5. **Notes:** Internal and public notes (tabbed)
6. **Episodes:** Parent episode if grouped

**Actions (bottom action bar):**
- **Acknowledge** button (if not yet acknowledged)
- **Resolve** button
- **Add Note** button (opens text input modal)

**API calls:**
- `GET /api/incident/:id/get-item`
- `POST /api/incident-state-timeline/get-list`
- `POST /api/incident-internal-note/get-list`
- `PUT /api/incident/:id` (for state changes)

### Screen 4: Alerts List

**Purpose:** Same pattern as Incidents List but for alerts. Includes project filter chip and project badges on each row.

**API calls:**
- All Projects mode: `POST /api/alert/get-list` per project (parallel), merged client-side
- Single Project mode: `POST /api/alert/get-list` with single `tenantid`

### Screen 5: Alert Detail

**Purpose:** Same pattern as Incident Detail but for alerts.

### Screen 6: Incident Episodes List

**Purpose:** View grouped incident episodes across projects.

**Features:**
- **Project filter chip** at top: `[All Projects ▼]`
- Shows: **project badge**, episode number, title, incident count, state, severity
- Filter by: Active | Resolved
- Tap to open Episode Detail

**API calls:**
- All Projects mode: `POST /api/incident-episode/get-list` per project (parallel), merged client-side
- Single Project mode: `POST /api/incident-episode/get-list` with single `tenantid`

### Screen 7: Incident Episode Detail

**Purpose:** View episode details and child incidents.

**Sections:**
1. **Header:** Episode title, state, severity, incident count
2. **Child Incidents:** List of incidents in this episode
3. **Timeline:** State changes
4. **Notes:** Internal and public
5. **Owners:** Assigned users and teams

**Actions:**
- Acknowledge / Resolve episode
- Add note

**API calls:**
- `GET /api/incident-episode/:id/get-item`
- `POST /api/incident/get-list` (filter by episodeId)

### Screen 8: Alert Episodes List & Detail

**Purpose:** Same pattern as Incident Episodes but for alerts. Includes project filter chip and project badges.

### Screen 9: Settings

**Purpose:** App configuration and user preferences.

**Sections:**
1. **Profile:** Name, email (read-only)
2. **Projects:** List of projects the user belongs to (read-only, informational)
3. **Notification Preferences:**
   - Toggle push notifications on/off per event type
   - Maps to existing `UserNotificationSetting` model
   - Event types: Incident created, state changed, note posted, episode created, etc.
4. **On-Call Notification Rules:**
   - View existing rules (notify via push after X minutes)
   - Maps to existing `UserNotificationRule` model
5. **Security:**
   - Enable biometric unlock (Face ID / fingerprint)
   - Sign out
6. **Server:**
   - Current server URL (e.g., `https://oneuptime.com` or `https://oneuptime.mycompany.com`)
   - "Change Server" button — clears stored tokens, returns to Server URL screen
7. **About:**
   - App version

**API calls:**
- `POST /api/user-notification-setting/get-list`
- `PUT /api/user-notification-setting/:id`
- `POST /api/user-notification-rule/get-list`

---

## Push Notifications

### Notification Types

| Event | Worker Job Source | Priority |
|-------|------------------|----------|
| Incident Episode Created | `Worker/Jobs/IncidentEpisodeOwners/SendCreatedResourceNotification.ts` | High |
| Incident Episode State Change | `Worker/Jobs/IncidentEpisodeOwners/SendStateChangeNotification.ts` | High |
| Incident Episode Note Posted | `Worker/Jobs/IncidentEpisodeOwners/SendNotePostedNotification.ts` | Normal |
| Incident Episode Owner Added | `Worker/Jobs/IncidentEpisodeOwners/SendOwnerAddedNotification.ts` | Normal |
| Alert Episode Created | `Worker/Jobs/AlertEpisodeOwners/SendCreatedResourceNotification.ts` | High |
| Alert Episode State Change | `Worker/Jobs/AlertEpisodeOwners/SendStateChangeNotification.ts` | High |
| Alert Episode Note Posted | `Worker/Jobs/AlertEpisodeOwners/SendNotePostedNotification.ts` | Normal |
| Alert Episode Owner Added | `Worker/Jobs/AlertEpisodeOwners/SendOwnerAddedNotification.ts` | Normal |
| On-Call Escalation | `Worker/Jobs/OnCallDutyPolicyExecutionLog/ExecutePendingExecutions.ts` | Critical |

### Notification Payload Structure

```json
{
    "notification": {
        "title": "Critical Incident: High CPU on prod-api-01",
        "body": "Incident Episode #42 created in MyProject. Tap to view."
    },
    "data": {
        "type": "incident-episode-created",
        "entityType": "incident-episode",
        "entityId": "abc-123",
        "projectId": "proj-456",
        "severity": "critical",
        "deepLink": "oneuptime://incident-episode/abc-123"
    },
    "android": {
        "priority": "high",
        "notification": {
            "channelId": "oncall_critical",
            "sound": "alarm",
            "color": "#FF0000"
        }
    },
    "apns": {
        "payload": {
            "aps": {
                "sound": "alarm.caf",
                "badge": 1,
                "category": "INCIDENT_ACTIONS",
                "interruption-level": "critical"
            }
        }
    }
}
```

### Actionable Notifications

**iOS Categories:**
```
Category: INCIDENT_ACTIONS
  - Action: "Acknowledge" (identifier: "ACKNOWLEDGE", destructive: false)
  - Action: "View" (identifier: "VIEW", foreground: true)

Category: ALERT_ACTIONS
  - Action: "Acknowledge" (identifier: "ACKNOWLEDGE")
  - Action: "View" (identifier: "VIEW", foreground: true)
```

**Android Actions:**
```
- "Acknowledge" action → background API call
- "View" action → opens app to detail screen
```

### Notification Channels (Android)

| Channel ID | Name | Importance | Sound |
|------------|------|------------|-------|
| `oncall_critical` | Critical On-Call | Max | Alarm sound |
| `oncall_high` | High Priority | High | Default |
| `oncall_normal` | Updates | Default | Default |
| `oncall_low` | Informational | Low | None |

### Critical Alerts (iOS)

For on-call escalation notifications, use iOS Critical Alerts (requires Apple entitlement):
- Bypasses Do Not Disturb and silent mode
- Plays sound even when muted
- Requires explicit user permission

---

## Authentication Flow

### Server URL → Login Flow

Since OneUptime is self-hostable, the app must first determine which server to connect to before authenticating.

```
┌───────────┐     GET {url}/api/status     ┌──────────┐
│  Server   │ ──────────────────────────── │  Backend  │
│  URL      │  (validate server is live)   │  Health   │
│  Screen   │ ◄──── 200 OK                │  Check    │
└────┬──────┘                              └──────────┘
     │
     │ Store serverUrl in AsyncStorage
     │ (default: https://oneuptime.com)
     │
     ▼
┌─────────┐     POST {serverUrl}/identity/login    ┌──────────┐
│  Login   │ ──────────────────────────────────── │  Backend  │
│  Screen  │                                       │  Identity │
│          │ ◄──── { token, refreshToken }         │  Service  │
└────┬─────┘                                       └──────────┘
     │
     │ Store tokens in Keychain
     │
     ▼
┌─────────┐     POST {serverUrl}/api/user-push     ┌──────────┐
│  Register│ ──────────────────────────────────── │  Backend  │
│  Device  │   { fcmToken, deviceType,             │  BaseAPI  │
│          │     deviceName }                      │          │
└────┬─────┘                                       └──────────┘
     │
     ▼
┌─────────┐
│  Home   │
│  Screen  │
└─────────┘
```

### App Launch Flow

```
App Opens
    │
    ├─ No serverUrl stored? ──→ Show Server URL Screen
    │                              │
    │                              ▼
    │                          User enters URL → Validate → Store
    │                              │
    │                              ▼
    ├─ Has serverUrl + has refresh token + biometric enabled?
    │       │
    │       ▼
    │   Biometric prompt → Success → Refresh access token → Home
    │                    → Failure → Login Screen
    │
    └─ Has serverUrl + no valid token? ──→ Login Screen
```

### Token Management

1. **Access token** (15 min TTL) stored in memory + secure keychain
2. **Refresh token** (30 day TTL) stored in secure keychain
3. **Axios interceptor** automatically refreshes expired tokens via `POST /identity/refresh-token`
4. **401 response** triggers token refresh; if refresh fails, redirect to login

### Biometric Unlock

1. On first login, store refresh token in keychain with biometric protection
2. On app reopen, prompt for Face ID / fingerprint
3. If biometric succeeds, retrieve refresh token and get new access token
4. If biometric fails, fall back to email/password login

### Multi-Project Support (Hybrid Approach)

The mobile app uses a hybrid "all projects by default, filter to one" approach so on-call engineers never miss incidents from any project.

**How it works:**

1. After login, fetch the user's project list via `POST /api/project/get-list`
2. By default, the app is in **"All Projects"** mode:
   - For each project the user belongs to, make parallel API calls (one per project with its `tenantid`)
   - Merge results client-side, sorted by creation time (newest first)
   - Each card/row shows a **project badge** (colored dot + project name) so the user can tell which project an item belongs to
3. A **filter chip** at the top of every list screen allows narrowing to a single project:
   - `[All Projects ▼]` → tap to see dropdown of projects
   - Selecting a project switches to single-project mode (only one `tenantid` per request)
   - Selecting "All Projects" returns to merged mode
4. The selected filter is persisted in memory (resets to "All Projects" on app restart)
5. The Home screen always shows all projects (no filter) to ensure nothing is missed

**API call pattern (All Projects mode):**
```typescript
// Fetch incidents from all projects in parallel
const projects = await getProjects();
const results = await Promise.all(
    projects.map((project) =>
        api.incidents.getList(filters, { tenantid: project.id })
    )
);
// Merge and sort by createdAt descending
const merged = results
    .flat()
    .sort((a, b) => b.createdAt - a.createdAt);
```

**Performance considerations:**
- Parallel requests keep latency close to a single-project call
- React Query caches each project's data independently, so switching filters is instant
- Pagination: in "All Projects" mode, fetch first page from each project, then interleave. Subsequent pages are loaded per-project as the user scrolls.
- If user has many projects (10+), consider lazy-loading: fetch from the most recent 5 projects first, load others on demand

---

## API Integration

### API Client Architecture

Reuse patterns from the existing `Common/UI/Utils/API/` layer. The base URL is dynamically set from the user-configured server URL (stored in AsyncStorage):

```typescript
// api/client.ts
import { getServerUrl } from "../storage/preferences";

// Server URL is loaded from AsyncStorage (set during Server URL screen)
// Default: https://oneuptime.com
const apiClient = axios.create({
    headers: { "Content-Type": "application/json" },
});

// Dynamically set baseURL from stored server URL
apiClient.interceptors.request.use(async (config) => {
    const serverUrl = await getServerUrl(); // e.g., "https://oneuptime.com"
    config.baseURL = `${serverUrl}/api`;
    return config;
});

// Request interceptor: attach JWT
// Note: tenantid is set per-request by useMultiProjectQuery (not globally)
apiClient.interceptors.request.use((config) => {
    config.headers.Authorization = `Bearer ${getAccessToken()}`;
    return config;
});

// Response interceptor: handle 401 with token refresh
apiClient.interceptors.response.use(
    (response) => response,
    async (error) => {
        if (error.response?.status === 401) {
            const newToken = await refreshToken();
            error.config.headers.Authorization = `Bearer ${newToken}`;
            return apiClient(error.config);
        }
        throw error;
    }
);
```

### React Query Hooks

```typescript
// hooks/useMultiProjectQuery.ts
// Core hook that handles "All Projects" vs "Single Project" fetching
export function useMultiProjectQuery<T>(
    queryKey: string,
    fetchFn: (tenantId: string, filters: any) => Promise<T[]>,
    filters: any,
) {
    const { projects } = useProjects();
    const { selectedProjectId } = useProjectFilter(); // null = "All Projects"

    const projectsToQuery = selectedProjectId
        ? [selectedProjectId]
        : projects.map((p) => p.id);

    return useQueries({
        queries: projectsToQuery.map((projectId) => ({
            queryKey: [queryKey, projectId, filters],
            queryFn: () => fetchFn(projectId, filters),
            staleTime: 30_000,
            refetchInterval: 60_000,
        })),
        combine: (results) => ({
            data: results
                .flatMap((r) => r.data ?? [])
                .sort((a, b) => b.createdAt - a.createdAt),
            isLoading: results.some((r) => r.isLoading),
            isError: results.some((r) => r.isError),
        }),
    });
}

// hooks/useIncidents.ts
export function useIncidents(filters: IncidentFilters) {
    return useMultiProjectQuery("incidents", api.incidents.getList, filters);
}

// hooks/useAcknowledgeIncident.ts
export function useAcknowledgeIncident() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.incidents.acknowledge(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["incidents"] });
        },
    });
}
```

### Key API Endpoints Used

All endpoints are relative to the user-configured server URL (e.g., `https://oneuptime.com` or `https://oneuptime.mycompany.com`).

| Screen | Endpoint | Method |
|--------|----------|--------|
| Server URL Validation | `/api/status` | GET |
| Login | `/identity/login` | POST |
| Token Refresh | `/identity/refresh-token` | POST |
| Register Push Device | `/api/user-push` | POST |
| On-Call Status | `/api/on-call-duty-policy/my-on-call-status` | GET |
| Incidents List | `/api/incident/get-list` | POST |
| Incident Detail | `/api/incident/:id/get-item` | GET |
| Acknowledge Incident | `/api/incident/:id/acknowledge` | POST |
| Incident Notes | `/api/incident-internal-note/get-list` | POST |
| Alerts List | `/api/alert/get-list` | POST |
| Alert Detail | `/api/alert/:id/get-item` | GET |
| Incident Episodes | `/api/incident-episode/get-list` | POST |
| Episode Detail | `/api/incident-episode/:id/get-item` | GET |
| Alert Episodes | `/api/alert-episode/get-list` | POST |
| Notification Settings | `/api/user-notification-setting/get-list` | POST |
| Projects List | `/api/project/get-list` | POST |

---

## Deep Linking

### URL Scheme

Register custom URL scheme `oneuptime://` for deep linking from push notifications.

| Route | Screen | Example |
|-------|--------|---------|
| `oneuptime://home` | On-Call Dashboard | - |
| `oneuptime://incident/{id}` | Incident Detail | `oneuptime://incident/abc-123` |
| `oneuptime://alert/{id}` | Alert Detail | `oneuptime://alert/def-456` |
| `oneuptime://incident-episode/{id}` | Incident Episode Detail | `oneuptime://incident-episode/ghi-789` |
| `oneuptime://alert-episode/{id}` | Alert Episode Detail | `oneuptime://alert-episode/jkl-012` |

### Universal Links (iOS) / App Links (Android)

Also support HTTPS-based universal links for sharing:
- `https://{oneuptime-host}/mobile/incident/{id}`
- Falls back to web dashboard if app is not installed

### Implementation

```typescript
// navigation/linking.ts
const linking = {
    prefixes: ["oneuptime://", "https://app.oneuptime.com/mobile"],
    config: {
        screens: {
            Home: "home",
            IncidentDetail: "incident/:id",
            AlertDetail: "alert/:id",
            IncidentEpisodeDetail: "incident-episode/:id",
            AlertEpisodeDetail: "alert-episode/:id",
        },
    },
};
```

---

## Offline Support

### Strategy

Use React Query's built-in offline support:

1. **Cache-first reads:** Show cached data immediately, refresh in background
2. **Optimistic mutations:** Acknowledge/resolve actions update UI immediately, sync when online
3. **Mutation queue:** Failed mutations (due to offline) are queued and retried when connectivity returns
4. **Stale indicators:** Show "Last updated X minutes ago" when data may be stale

### Persistence

```typescript
// Use AsyncStorage for React Query cache persistence
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import AsyncStorage from "@react-native-async-storage/async-storage";

const persister = createAsyncStoragePersister({
    storage: AsyncStorage,
    throttleTime: 1000,
});
```

### Network Status Banner

Show a persistent banner at the top of the app when offline:
- Red banner: "No internet connection. Actions will sync when reconnected."
- Yellow banner: "Reconnecting..." during transition

---

## Project Structure

```
MobileApp/
├── app.json                          # Expo configuration
├── package.json                      # Dependencies
├── tsconfig.json                     # TypeScript config
├── eas.json                          # Expo Application Services (build/submit)
├── babel.config.js
├── metro.config.js
│
├── src/
│   ├── App.tsx                       # Root component
│   │
│   ├── api/                          # API client layer
│   │   ├── client.ts                 # Axios instance with interceptors
│   │   ├── auth.ts                   # Login, refresh, logout
│   │   ├── incidents.ts              # Incident API calls
│   │   ├── alerts.ts                 # Alert API calls
│   │   ├── incidentEpisodes.ts       # Incident episode API calls
│   │   ├── alertEpisodes.ts          # Alert episode API calls
│   │   ├── onCall.ts                 # On-call status API calls
│   │   ├── notifications.ts          # Notification settings API calls
│   │   └── projects.ts              # Project list API calls
│   │
│   ├── screens/                      # Screen components
│   │   ├── auth/
│   │   │   ├── ServerUrlScreen.tsx   # Server URL entry (self-hosted support)
│   │   │   ├── LoginScreen.tsx
│   │   │   └── BiometricScreen.tsx
│   │   ├── home/
│   │   │   └── HomeScreen.tsx        # On-Call Dashboard
│   │   ├── incidents/
│   │   │   ├── IncidentListScreen.tsx
│   │   │   └── IncidentDetailScreen.tsx
│   │   ├── alerts/
│   │   │   ├── AlertListScreen.tsx
│   │   │   └── AlertDetailScreen.tsx
│   │   ├── episodes/
│   │   │   ├── IncidentEpisodeListScreen.tsx
│   │   │   ├── IncidentEpisodeDetailScreen.tsx
│   │   │   ├── AlertEpisodeListScreen.tsx
│   │   │   └── AlertEpisodeDetailScreen.tsx
│   │   └── settings/
│   │       ├── SettingsScreen.tsx
│   │       └── NotificationSettingsScreen.tsx
│   │
│   ├── components/                   # Shared UI components
│   │   ├── ProjectFilterChip.tsx    # "All Projects ▼" filter dropdown
│   │   ├── ProjectBadge.tsx         # Colored dot + project name label
│   │   ├── SeverityBadge.tsx
│   │   ├── StateBadge.tsx
│   │   ├── TimeAgo.tsx
│   │   ├── OnCallStatusBanner.tsx
│   │   ├── EntityCard.tsx
│   │   ├── ActionBar.tsx
│   │   ├── NotesList.tsx
│   │   ├── Timeline.tsx
│   │   ├── SkeletonCard.tsx          # Shimmer loading placeholder
│   │   ├── EmptyState.tsx            # Monochrome illustration + message
│   │   ├── ErrorState.tsx
│   │   ├── OfflineBanner.tsx
│   │   └── PullToRefresh.tsx
│   │
│   ├── navigation/                   # React Navigation config
│   │   ├── RootNavigator.tsx         # Auth vs Main stack
│   │   ├── MainTabNavigator.tsx      # Bottom tab navigation
│   │   ├── IncidentStackNavigator.tsx
│   │   ├── AlertStackNavigator.tsx
│   │   └── linking.ts               # Deep link configuration
│   │
│   ├── hooks/                        # Custom React hooks
│   │   ├── useServerUrl.ts          # Server URL management
│   │   ├── useAuth.ts
│   │   ├── useProjects.ts           # Fetch user's project list
│   │   ├── useProjectFilter.ts      # All Projects / single project filter state
│   │   ├── useMultiProjectQuery.ts  # Parallel fetch + merge across projects
│   │   ├── useOnCallStatus.ts
│   │   ├── useIncidents.ts
│   │   ├── useAlerts.ts
│   │   ├── useEpisodes.ts
│   │   ├── useAcknowledge.ts
│   │   ├── useNetworkStatus.ts
│   │   └── useBiometric.ts
│   │
│   ├── notifications/                # Push notification setup
│   │   ├── setup.ts                  # FCM registration & permission request
│   │   ├── handlers.ts              # Notification tap/action handlers
│   │   ├── channels.ts             # Android notification channels
│   │   └── categories.ts           # iOS notification categories
│   │
│   ├── storage/                      # Secure storage
│   │   ├── keychain.ts              # Token storage (react-native-keychain)
│   │   ├── serverUrl.ts            # Server URL storage (AsyncStorage)
│   │   ├── preferences.ts          # App preferences (AsyncStorage)
│   │   └── queryPersister.ts       # React Query cache persistence
│   │
│   ├── theme/                        # Design system
│   │   ├── colors.ts               # Dark/light semantic color tokens
│   │   ├── typography.ts           # Type scale (title, body, mono)
│   │   ├── spacing.ts             # Spacing + border radius tokens
│   │   ├── shadows.ts             # Elevation / card shadows
│   │   ├── ThemeContext.tsx        # Dark/light theme provider
│   │   └── index.ts
│   │
│   ├── types/                        # TypeScript types
│   │   ├── incident.ts
│   │   ├── alert.ts
│   │   ├── episode.ts
│   │   ├── onCall.ts
│   │   ├── notification.ts
│   │   └── navigation.ts
│   │
│   └── utils/                        # Utility functions
│       ├── date.ts
│       ├── severity.ts
│       └── permissions.ts
│
├── assets/                           # Images, icons, sounds
│   ├── icon.png
│   ├── splash.png
│   └── sounds/
│       └── alarm.wav
│
├── ios/                              # iOS native project (Expo prebuild)
├── android/                          # Android native project (Expo prebuild)
│
└── __tests__/                        # Test files
    ├── screens/
    ├── components/
    ├── hooks/
    └── api/
```

---

## Implementation Phases

### Phase 1: Foundation (Weeks 1-2)

**Backend:**
- [ ] Add `PushDeviceType` enum (`web`, `ios`, `android`) to codebase
- [ ] Update `UserPush` model to support native device types
- [ ] Create database migration for new device types
- [ ] Install `firebase-admin` SDK
- [ ] Extend `PushNotificationService` with FCM send logic
- [ ] Configure Firebase project and add credentials to environment

**Mobile:**
- [ ] Initialize Expo project in `MobileApp/` directory
- [ ] Set up TypeScript, ESLint, Prettier
- [ ] Implement design system foundation: color tokens (dark/light), typography scale, spacing tokens, ThemeContext provider
- [ ] Configure React Navigation (auth stack + main tab navigator) with dark theme
- [ ] Build API client with Axios + dynamic server URL interceptor
- [ ] Implement Server URL screen (pre-auth, default: `https://oneuptime.com`)
- [ ] Implement server URL validation (health check on connect)
- [ ] Implement login screen and auth flow
- [ ] Implement secure token storage with react-native-keychain
- [ ] Implement token refresh interceptor
- [ ] Implement app launch flow (skip Server URL screen if URL already stored)
- [ ] Build foundational components: SeverityBadge, StateBadge, ProjectBadge, skeleton loading primitives

**Deliverable:** User can enter their OneUptime server URL, log in, and see a placeholder home screen. Dark theme and design tokens are in place from day one.

### Phase 2: Core Screens (Weeks 3-4)

**Backend:**
- [ ] Implement `GET /api/on-call-duty-policy/my-on-call-status` endpoint
- [ ] Implement `POST /api/incident/:id/acknowledge` endpoint
- [ ] Implement `POST /api/alert/:id/acknowledge` endpoint
- [ ] Implement `POST /api/incident-episode/:id/acknowledge` endpoint
- [ ] Implement `POST /api/alert-episode/:id/acknowledge` endpoint

**Mobile:**
- [ ] Build Home screen (On-Call Dashboard) with on-call status
- [ ] Build Incidents List screen with filters and pagination
- [ ] Build Incident Detail screen with timeline, notes, owners
- [ ] Build Alerts List and Detail screens
- [ ] Add pull-to-refresh and loading states
- [ ] Add error states and empty states

**Deliverable:** User can view on-call status, browse incidents/alerts, and see details.

### Phase 3: Episodes & Actions (Weeks 5-6)

**Mobile:**
- [ ] Build Incident Episodes List and Detail screens
- [ ] Build Alert Episodes List and Detail screens
- [ ] Implement Acknowledge action on all detail screens
- [ ] Implement Resolve action on all detail screens
- [ ] Implement Add Note action (modal with text input)
- [ ] Add optimistic updates for acknowledge/resolve
- [ ] Set up React Query cache persistence with AsyncStorage

**Deliverable:** User can view episodes and take acknowledge/resolve actions.

### Phase 4: Push Notifications (Weeks 7-8)

**Backend:**
- [ ] Test FCM integration end-to-end
- [ ] Ensure all worker jobs correctly route to FCM for native devices
- [ ] Add push notification payload structure with deep link data

**Mobile:**
- [ ] Configure FCM in Expo (expo-notifications + @react-native-firebase/messaging)
- [ ] Implement push notification permission request flow
- [ ] Register FCM token with backend on login (create UserPush)
- [ ] Unregister FCM token on logout (delete UserPush)
- [ ] Handle foreground notifications (in-app banner)
- [ ] Handle background notification taps (deep link to detail screen)
- [ ] Implement actionable notifications (Acknowledge button)
- [ ] Set up Android notification channels
- [ ] Set up iOS notification categories
- [ ] Handle FCM token refresh

**Deliverable:** User receives push notifications and can acknowledge from notification.

### Phase 5: Polish & Settings (Weeks 9-10)

**Mobile:**
- [ ] Build Settings screen
- [ ] Build Notification Preferences screen
- [ ] Implement biometric unlock (Face ID / fingerprint)
- [ ] Add offline support with network status banner
- [ ] Add deep linking support (URL scheme + universal links)
- [ ] Design and implement app icon and splash screen
- [ ] Implement dark/light theme toggle (dark default) with system appearance support
- [ ] Add haptic feedback on acknowledge, resolve, swipe actions, pull-to-refresh
- [ ] Implement swipe-to-acknowledge gesture on list cards
- [ ] Add skeleton loading states for all screens (shimmer placeholders matching card anatomy)
- [ ] Design empty states with monochrome illustrations and actionable messaging
- [ ] Custom notification sounds (escalating tone for critical, chime for high, soft for normal)
- [ ] Performance optimization (list virtualization, image caching)
- [ ] Accessibility audit: Dynamic Type scaling, VoiceOver/TalkBack labels, WCAG AA contrast, Reduce Motion support, color-blind safe severity palette

**Deliverable:** Polished, dark-first app with all settings, offline support, and 3 AM-ready UI.

### Phase 6: Testing & Release (Weeks 11-12)

- [ ] Write unit tests for API client, hooks, and utilities
- [ ] Write component tests for all screens
- [ ] Write E2E tests with Detox (login, browse, acknowledge flows)
- [ ] Internal beta testing via Expo EAS + TestFlight / Play Console Internal Testing
- [ ] Bug fixes based on beta feedback
- [ ] App Store / Play Store listing preparation (screenshots, description, privacy policy)
- [ ] Submit to Apple App Store Review
- [ ] Submit to Google Play Store Review
- [ ] Production release

**Deliverable:** App published on both app stores.

---

## Testing Strategy

### Unit Tests

- API client functions (request formation, error handling)
- React Query hooks (query keys, cache behavior)
- Utility functions (date formatting, severity mapping)
- Token storage and refresh logic

### Component Tests

- All screens render correctly with mock data
- Empty states, loading states, error states
- Action buttons trigger correct mutations
- Navigation between screens

### Integration Tests

- Login flow end-to-end (mock server)
- Token refresh on 401
- Push notification registration
- Deep link navigation

### E2E Tests (Detox)

- Login with credentials
- View on-call status
- Browse incidents list
- Open incident detail
- Acknowledge an incident
- Receive and tap a push notification

---

## App Store Distribution

### Build & Deploy Pipeline

Use **Expo Application Services (EAS)** for builds and submissions:

```json
// eas.json
{
    "build": {
        "development": {
            "developmentClient": true,
            "distribution": "internal"
        },
        "preview": {
            "distribution": "internal",
            "ios": { "simulator": false }
        },
        "production": {
            "autoIncrement": true
        }
    },
    "submit": {
        "production": {
            "ios": { "appleId": "...", "ascAppId": "..." },
            "android": { "serviceAccountKeyPath": "./play-store-key.json" }
        }
    }
}
```

### App Store Requirements

**iOS (Apple App Store):**
- Apple Developer Account ($99/year)
- Critical Alerts entitlement (requires Apple approval for on-call use case)
- Privacy policy URL
- App Review compliance (no private API usage)

**Android (Google Play Store):**
- Google Play Developer Account ($25 one-time)
- Privacy policy URL
- Data safety section declaration
- Target API level compliance

### Release Strategy

1. **Internal Testing:** Team members via TestFlight (iOS) and Internal Testing Track (Android)
2. **Beta:** Invite select customers via TestFlight public link / Open Testing Track
3. **Production:** Phased rollout (10% → 50% → 100%)
4. **Updates:** OTA updates via Expo Updates for JS-only changes; native builds for SDK updates

---

## Future Considerations (Post-V1)

- **Widgets:** iOS widgets / Android widgets showing on-call status and active incident count
- **Watch App:** Apple Watch complication for on-call status
- **Scheduled Maintenance:** View and manage scheduled maintenance events
- **Monitor Status:** Quick view of monitor health
- **Team Chat:** In-app messaging for incident response
- **Runbooks:** View linked runbooks from incident detail
- **AI Suggestions:** Surface AI-generated root cause analysis
- **Localization:** Multi-language support
