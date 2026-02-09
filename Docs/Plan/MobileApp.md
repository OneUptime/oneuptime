# OneUptime On-Call Mobile App - Design Document

## Executive Summary

This document outlines the design for a native mobile app (iOS & Android) for OneUptime focused on on-call workflows. The app enables engineers to receive push notifications for incidents, alerts, and episodes, view their on-call status, and take actions (acknowledge, resolve) directly from their phone.

## Table of Contents

1. [Goals & Non-Goals](#goals--non-goals)
2. [Tech Stack](#tech-stack)
3. [Architecture Overview](#architecture-overview)
4. [Backend Changes](#backend-changes)
5. [Mobile App Screens](#mobile-app-screens)
6. [Push Notifications](#push-notifications)
7. [Authentication Flow](#authentication-flow)
8. [API Integration](#api-integration)
9. [Deep Linking](#deep-linking)
10. [Offline Support](#offline-support)
11. [Project Structure](#project-structure)
12. [Implementation Phases](#implementation-phases)
13. [Testing Strategy](#testing-strategy)
14. [App Store Distribution](#app-store-distribution)

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

**Purpose:** At-a-glance view of on-call status and pending items.

**Sections:**
1. **On-Call Status Banner**
   - Green: "You are on-call" with schedule details
   - Gray: "You are not on-call" with next shift info
2. **Pending Acknowledgments** (cards with swipe-to-acknowledge)
   - Unacknowledged incidents/alerts assigned to the user
   - Each card shows: title, severity badge, time since creation
3. **Recent Activity Feed**
   - Last 10 events (new incidents, state changes, notes)
4. **Quick Stats**
   - Active incidents count
   - Active alerts count
   - Open episodes count

**API calls:**
- `GET /api/on-call-duty-policy/my-on-call-status`
- `POST /api/incident/get-list` (filter: active, assigned to user)
- `POST /api/alert/get-list` (filter: active, assigned to user)

### Screen 2: Incidents List

**Purpose:** Browse and filter all incidents.

**Features:**
- Tab filters: Active | Acknowledged | Resolved
- Each row shows: incident number, title, severity badge, state, time
- Pull-to-refresh
- Infinite scroll pagination
- Search by title
- Tap to open Incident Detail

**API calls:**
- `POST /api/incident/get-list` with filters and pagination

### Screen 3: Incident Detail

**Purpose:** View full incident details and take actions.

**Sections:**
1. **Header:** Title, severity, current state, created/updated times
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

**Purpose:** Same pattern as Incidents List but for alerts.

**API calls:**
- `POST /api/alert/get-list`

### Screen 5: Alert Detail

**Purpose:** Same pattern as Incident Detail but for alerts.

### Screen 6: Incident Episodes List

**Purpose:** View grouped incident episodes.

**Features:**
- Shows: episode number, title, incident count, state, severity
- Filter by: Active | Resolved
- Tap to open Episode Detail

**API calls:**
- `POST /api/incident-episode/get-list`

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

**Purpose:** Same pattern as Incident Episodes but for alerts.

### Screen 9: Settings

**Purpose:** App configuration and user preferences.

**Sections:**
1. **Profile:** Name, email (read-only)
2. **Active Project:** Project switcher dropdown
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

### Multi-Project Support

- After login, fetch user's project list via `POST /api/project/get-list`
- Store selected project ID in app state
- All API calls include `tenantid` header with selected project ID
- Project switcher in Settings screen

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

// Request interceptor: attach JWT + project ID
apiClient.interceptors.request.use((config) => {
    config.headers.Authorization = `Bearer ${getAccessToken()}`;
    config.headers.tenantid = getSelectedProjectId();
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
// hooks/useIncidents.ts
export function useIncidents(filters: IncidentFilters) {
    return useQuery({
        queryKey: ["incidents", filters],
        queryFn: () => api.incidents.getList(filters),
        staleTime: 30_000, // 30 seconds
        refetchInterval: 60_000, // auto-refresh every minute
    });
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
│   │       ├── NotificationSettingsScreen.tsx
│   │       └── ProjectSwitcherScreen.tsx
│   │
│   ├── components/                   # Shared UI components
│   │   ├── SeverityBadge.tsx
│   │   ├── StateBadge.tsx
│   │   ├── TimeAgo.tsx
│   │   ├── OnCallStatusBanner.tsx
│   │   ├── EntityCard.tsx
│   │   ├── ActionBar.tsx
│   │   ├── NotesList.tsx
│   │   ├── Timeline.tsx
│   │   ├── EmptyState.tsx
│   │   ├── ErrorState.tsx
│   │   ├── LoadingState.tsx
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
│   ├── theme/                        # Styling
│   │   ├── colors.ts
│   │   ├── typography.ts
│   │   ├── spacing.ts
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
- [ ] Configure React Navigation (auth stack + main tab navigator)
- [ ] Build API client with Axios + dynamic server URL interceptor
- [ ] Implement Server URL screen (pre-auth, default: `https://oneuptime.com`)
- [ ] Implement server URL validation (health check on connect)
- [ ] Implement login screen and auth flow
- [ ] Implement secure token storage with react-native-keychain
- [ ] Implement token refresh interceptor
- [ ] Implement app launch flow (skip Server URL screen if URL already stored)

**Deliverable:** User can enter their OneUptime server URL, log in, and see a placeholder home screen.

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
- [ ] Build Project Switcher
- [ ] Implement biometric unlock (Face ID / fingerprint)
- [ ] Add offline support with network status banner
- [ ] Add deep linking support (URL scheme + universal links)
- [ ] Design and implement app icon and splash screen
- [ ] Add haptic feedback for actions
- [ ] Performance optimization (list virtualization, image caching)
- [ ] Accessibility audit (screen reader, contrast, touch targets)

**Deliverable:** Polished app with all settings and offline support.

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
- **Dark Mode:** Full dark mode theme support
- **Localization:** Multi-language support
