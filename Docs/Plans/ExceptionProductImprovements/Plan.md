# Exception Product Improvements Plan

## Overview

This document outlines the improvements to make OneUptime's exception/error tracking product more competitive with tools like Sentry, while working within the constraints of OpenTelemetry (no custom SDK development).

---

## Phase 1: Quick Wins (Foundation)

### 1.1 Add Release & Environment Tracking

**Goal:** Track which version/environment exceptions occur in

**Changes Required:**

1. **ExceptionInstance Model** (`Common/Models/AnalyticsModels/ExceptionInstance.ts`)
   - Add `release` column (string) - from `service.version` resource attribute
   - Add `environment` column (string) - from `deployment.environment` resource attribute
   - Add `serviceVersion` column (string) - alternative naming

2. **TelemetryException Model** (`Common/Models/DatabaseModels/TelemetryException.ts`)
   - Add corresponding columns for aggregated data

3. **OtelTracesIngestService** (`Telemetry/Services/OtelTracesIngestService.ts`)
   - Extract `service.version` from resource attributes during ingestion
   - Extract `deployment.environment` from resource attributes
   - Populate new columns

4. **UI Updates**
   - Add release/environment filters to ExceptionsTable
   - Display release info in ExceptionDetail
   - Add release comparison view

---

### 1.2 Parse Stack Traces Into Structured Frames

**Goal:** Transform raw stack trace strings into structured, queryable frames

**Changes Required:**

1. **Create Stack Trace Parser** (`Telemetry/Utils/StackTraceParser.ts`)
   ```typescript
   interface StackFrame {
     functionName: string;
     fileName: string;
     lineNumber: number;
     columnNumber?: number;
     inApp: boolean;  // true if user code, false if library
     context?: {
       pre: string[];   // lines before
       line: string;    // the line
       post: string[];  // lines after
     };
   }

   interface ParsedStackTrace {
     frames: StackFrame[];
     raw: string;  // original string
   }
   ```

2. **Support Multiple Languages:**
   - JavaScript/Node.js: `at functionName (file:line:col)`
   - Python: `File "path", line N, in function`
   - Java: `at package.Class.method(File.java:line)`
   - Go: `package/file.go:line +0xNN`
   - Ruby: `file:line:in 'method'`

3. **ExceptionInstance Model Updates:**
   - Add `parsedFrames` column (JSON array)
   - Keep `stackTrace` for raw string

4. **UI Component** (`Dashboard/src/Components/Exceptions/StackFrameViewer.tsx`)
   - Expandable frame cards
   - Highlight app frames vs library frames
   - Show code context when available

---

### 1.3 Enhanced Breadcrumb/Events Timeline

**Goal:** Show events leading up to an exception

**Changes Required:**

1. **Extract Breadcrumbs from Span Events**
   - Span events already captured, need better UI
   - Filter events to show last N events before exception
   - Categorize by type (http, db, console, user-action)

2. **UI Component** (`Dashboard/src/Components/Exceptions/BreadcrumbTimeline.tsx`)
   - Timeline visualization
   - Color-coded by category
   - Relative timestamps ("2s before error")
   - Expandable details

3. **Integration Points:**
   - Add to ExceptionExplorer
   - Add to SpanViewer exception tab

---

## Phase 2: Source Maps & Code Context

### 2.1 Source Map Upload Infrastructure

**Goal:** Allow users to upload source maps for JavaScript/TypeScript unmapping

**Changes Required:**

1. **New Database Model** (`Common/Models/DatabaseModels/SourceMap.ts`)
   ```typescript
   - projectId: ObjectID
   - serviceId: ObjectID
   - release: string
   - fileName: string (e.g., "main.js")
   - sourceMapContent: Text (the .map file contents)
   - uploadedAt: Date
   - uploadedByUserId: ObjectID
   ```

2. **API Endpoints** (`App/FeatureSet/Telemetry/API/SourceMap.ts`)
   - POST `/source-maps/upload` - Upload source map files
   - GET `/source-maps/:serviceId/:release` - List source maps
   - DELETE `/source-maps/:id` - Delete source map

3. **UI for Upload** (`Dashboard/src/Pages/Telemetry/Services/View/SourceMaps.tsx`)
   - Drag & drop upload
   - List uploaded maps by release
   - Delete old maps

4. **CLI Integration**
   - Command to upload source maps during CI/CD
   - `oneuptime sourcemaps upload --release v1.2.3 --files ./dist/*.map`

---

### 2.2 Stack Trace Unmapping

**Goal:** Resolve minified stack traces to original source

**Changes Required:**

1. **Source Map Resolver Service** (`Telemetry/Services/SourceMapService.ts`)
   - Load source map for service + release
   - Use `source-map` npm package for resolution
   - Cache resolved mappings

2. **Integration with Stack Frame Display**
   - On-demand resolution when viewing exception
   - Cache resolved frames
   - Show both original and mapped positions

---

### 2.3 Code Context Display

**Goal:** Show source code around each stack frame

**Changes Required:**

1. **Source Code Storage** (Optional - requires repo integration)
   - Store code snippets with source maps
   - Or fetch from connected Git repository

2. **Fallback: Manual Context**
   - Allow source maps to include `sourcesContent`
   - Display inline in stack frame viewer

---

## Phase 3: Analytics & Intelligence

### 3.1 Affected Users Tracking

**Goal:** Track how many unique users are affected by each exception

**Changes Required:**

1. **Extract User Info from Attributes**
   - Look for `user.id`, `enduser.id`, `user_id` in span/exception attributes
   - Store unique user count per exception fingerprint

2. **Model Updates**
   - Add `affectedUserIds` (array) to ExceptionInstance
   - Add `affectedUserCount` to TelemetryException

3. **UI Updates**
   - Show "X users affected" in exception list
   - User impact chart over time

---

### 3.2 Release Comparison

**Goal:** Compare exceptions across releases

**Changes Required:**

1. **Queries for Comparison**
   - Exceptions in release A but not B
   - Exceptions fixed in release B
   - New exceptions introduced in release B

2. **UI Component** (`Dashboard/src/Pages/Telemetry/Exceptions/ReleaseComparison.tsx`)
   - Side-by-side release comparison
   - Regression detection
   - Fixed exceptions list

---

### 3.3 Error Spike Detection

**Goal:** Alert when exception rate increases significantly

**Changes Required:**

1. **Background Job** - Similar pattern to existing cron jobs
   - Calculate baseline exception rate
   - Detect anomalies (>2 standard deviations)
   - Trigger alerts

2. **Integration with Alerts**
   - New alert type: Exception Rate Alert
   - Configurable thresholds

---

## Phase 4: UI/UX Enhancements

### 4.1 Rich Stack Frame Viewer

**Mockup:**
```
┌─────────────────────────────────────────────────────────────┐
│ TypeError: Cannot read property 'id' of undefined           │
├─────────────────────────────────────────────────────────────┤
│ ▼ getUser            user.service.ts:42           [APP]     │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │  40 │  async function getUser(id: string) {             │ │
│ │  41 │    const user = await db.findById(id);            │ │
│ │▸ 42 │    return user.id; // Error here                  │ │
│ │  43 │  }                                                │ │
│ └─────────────────────────────────────────────────────────┘ │
│ ▶ handleRequest      api.controller.ts:128        [APP]     │
│ ▶ processMiddleware  middleware.ts:56             [APP]     │
│ ▶ Layer.handle       express/router.ts:174        [LIB]     │
│ ▶ next               express/router.ts:123        [LIB]     │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 Breadcrumb Timeline

**Mockup:**
```
┌─────────────────────────────────────────────────────────────┐
│ BREADCRUMBS                                    Last 30s     │
├─────────────────────────────────────────────────────────────┤
│ ● HTTP    GET /api/users/123           200    -28s          │
│ ● DB      SELECT * FROM users          OK     -25s          │
│ ● HTTP    GET /api/orders?user=123     200    -20s          │
│ ● DB      SELECT * FROM orders         OK     -18s          │
│ ● LOG     Processing order #456        info   -15s          │
│ ○ WARN    Rate limit approaching       warn   -10s          │
│ ● HTTP    POST /api/checkout           500    -5s           │
│ ✖ ERROR   TypeError: Cannot read...    error   0s           │
└─────────────────────────────────────────────────────────────┘
```

### 4.3 Exception List Enhancements

- Full-text search on stack traces
- Saved filters/views
- Bulk operations
- Quick preview on hover

---

## Implementation Priority

| Priority | Feature | Effort | Impact |
|----------|---------|--------|--------|
| P0 | Release/Environment tracking | Low | High |
| P0 | Parse stack traces | Medium | High |
| P1 | Breadcrumb timeline UI | Low | Medium |
| P1 | Rich stack frame viewer | Medium | High |
| P2 | Source map upload | Medium | High |
| P2 | Stack trace unmapping | Medium | High |
| P2 | Affected users count | Low | Medium |
| P3 | Release comparison | Medium | Medium |
| P3 | Error spike detection | Medium | Medium |
| P3 | Code context display | High | Medium |

---

## Files to Modify

### Models
- `Common/Models/AnalyticsModels/ExceptionInstance.ts`
- `Common/Models/DatabaseModels/TelemetryException.ts`
- `Common/Models/DatabaseModels/SourceMap.ts` (new)

### Services
- `Telemetry/Services/OtelTracesIngestService.ts`
- `Telemetry/Utils/StackTraceParser.ts` (new)
- `Telemetry/Services/SourceMapService.ts` (new)
- `Common/Server/Services/ExceptionInstanceService.ts`

### UI Components
- `Dashboard/src/Components/Exceptions/ExceptionDetail.tsx`
- `Dashboard/src/Components/Exceptions/StackFrameViewer.tsx` (new)
- `Dashboard/src/Components/Exceptions/BreadcrumbTimeline.tsx` (new)
- `Dashboard/src/Components/Exceptions/ExceptionExplorer.tsx`
- `Dashboard/src/Components/Span/SpanViewer.tsx`

### API
- `App/FeatureSet/Telemetry/API/SourceMap.ts` (new)

---

## What This Plan Does NOT Include

These require custom SDK development (outside OpenTelemetry):
- **Local variables capture** - Requires language-specific debugger hooks
- **Session replay** - Requires browser SDK instrumentation
- **Automatic breadcrumbs** - Requires SDK-level instrumentation

---

## Success Metrics

1. Stack traces displayed as parsed frames (not raw text)
2. Release/environment visible on all exceptions
3. Source maps can be uploaded and used for unmapping
4. Breadcrumb timeline shows events before exception
5. Users can compare exceptions across releases
