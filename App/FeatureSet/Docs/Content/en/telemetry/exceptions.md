# Capture exceptions with OpenTelemetry

## Overview

OneUptime groups the exceptions your application reports into issues on the **Telemetry → Exceptions** page — deduplicated by fingerprint, attributed to the right service, and tracked as unresolved / resolved / archived.

Exceptions appear on that page only when your application **records them as telemetry**. This guide explains the two ways to do that, and clears up two common points of confusion: runtime exception *counters* (which never create entries on the Exceptions page), and why per-process metrics differ from your cloud provider's numbers.

## How exceptions reach the Exceptions page

### 1. Exceptions recorded on spans (traces)

When your code records an exception on the active span, the OpenTelemetry SDK attaches a span event named `exception` carrying the `exception.type`, `exception.message`, and `exception.stacktrace` attributes. OneUptime turns every such event into an exception record.

.NET:

```csharp
using OpenTelemetry.Trace;

try
{
    ProcessPayment();
}
catch (Exception ex)
{
    Activity.Current?.RecordException(ex); // or activity.AddException(ex) on .NET 9+
    throw;
}
```

Java:

```java
Span span = Span.current();
try {
    processPayment();
} catch (Exception e) {
    span.recordException(e);
    throw e;
}
```

Node.js:

```javascript
const span = trace.getActiveSpan();
try {
  processPayment();
} catch (err) {
  span?.recordException(err);
  throw err;
}
```

Python:

```python
span = trace.get_current_span()
try:
    process_payment()
except Exception as exc:
    span.record_exception(exc)
    raise
```

Note that setting a span's status to `Error` on its own does **not** create an exception record — OneUptime marks the span as failed, but without a recorded exception event there is no type, message, or stack trace to group into an issue. Most auto-instrumentations record unhandled exceptions for you; exceptions your code catches must be recorded explicitly as shown above.

### 2. Exceptions in logs

OneUptime also extracts exceptions from ingested logs, using two detection paths:

1. **Explicit exception attributes (recommended).** Log the exception *object* — not just a message — through a logging pipeline that emits the OpenTelemetry `exception.*` attributes:

```csharp
catch (Exception ex)
{
    // Pass the exception as the first argument — logging only a string
    // produces a plain error log with no exception attributes.
    logger.LogError(ex, "Failed to process payment for order {OrderId}", orderId);
}
```

Most logging integrations (ILogger with the OTel logging provider, [Serilog](/docs/telemetry/serilog), Logback/Log4j appenders, Python's logging instrumentation) attach these attributes automatically when you log an exception object.

2. **Stack traces in the log body.** For error/fatal logs without those attributes, OneUptime scans the log body for a stack trace and extracts the type, message, and frames. See [Exceptions from logs](/docs/telemetry/open-telemetry) for details and limitations.

Exceptions found in traces and logs share the same fingerprint grouping, so an error reported by both collapses into one issue.

## Runtime exception counters are a different signal

Language runtimes expose *metrics* that count thrown exceptions — for example `dotnet.exceptions` (or the older `process.runtime.dotnet.exceptions.count`) in .NET. These counters increment on **every** exception thrown inside the process, including exceptions that are immediately caught and handled by your code, your libraries, or the framework itself. Handled exceptions are business as usual for many apps and frameworks, so a non-zero count is not by itself a sign of failures.

The service overview page charts this counter as **“Exceptions thrown”** when your service exports it. Because it is only a count, it carries no type, message, or stack trace — OneUptime cannot (and does not) create Exceptions-page entries from it.

So it is perfectly normal to see, say, 6 exceptions on the “Exceptions thrown” chart while the Exceptions page is empty: 6 exceptions were thrown and handled inside the process, and none were recorded as telemetry. If you want those exceptions on the Exceptions page, record them on spans or logs as shown above.

If you believe exceptions were recorded but the page still looks empty, check the status filter (the list defaults to **Unresolved** — switch it to **All** to include resolved and archived issues) and widen the time range (the list shows issues *last seen* inside the selected window).

## Why service metrics can differ from your cloud provider's

The metrics on the service overview page are the numbers **your application's own OpenTelemetry SDK exports**, stored verbatim — OneUptime applies no unit conversion or rescaling. Charts aggregate per time bucket, and when several instances report under one service the values are averaged, not summed.

This scope matters when you compare against cloud-provider dashboards. For example, the .NET metric `dotnet.process.memory.working_set` is the working set of the **single instrumented process** (`Environment.WorkingSet`). Azure App Service's “Memory working set” metric measures the **entire app sandbox** — the main process plus child processes, the Kudu/SCM site, and platform overhead, across instances. A lightweight worker process reporting 65 MiB inside an App Service showing 4.4 GB is two correct answers to two different questions.

When validating OneUptime's numbers against your platform, compare like with like: process-level counters (e.g. the process view in Kudu's Process Explorer, or `Private Bytes` of the specific process) rather than host- or sandbox-level metrics.

## Prerequisites for exporting exceptions

Exception telemetry rides on your existing traces and logs export. If you have not set that up yet, start with the [OpenTelemetry integration guide](/docs/telemetry/open-telemetry) — you need an OTLP exporter for traces and/or logs pointing at your OneUptime instance with your telemetry ingestion token.
