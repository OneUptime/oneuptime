# Mobile Setup

Instrument an Android, iOS or React Native app so it reports to OneUptime as a mobile RUM application.

## What OneUptime needs

Two things, and only two:

1. **`service.name`** — the application's identity, e.g. `storefront-android`.
2. **At least one of `device.id`, `device.model.identifier` or `device.manufacturer`** — this is what marks the telemetry as *mobile* rather than as a backend service.

Both are **resource** attributes, and both must be on every batch you export. If the device attributes are missing, the telemetry still arrives and is still queryable — it is just filed as a backend Service instead of a RUM application.

`device.id` should be an install-scoped identifier, not an advertising ID or anything that identifies a person. It is used for grouping, never displayed as an identity.

## Common configuration

Every OpenTelemetry mobile SDK reads the standard environment / configuration keys, so the OneUptime side is the same everywhere:

| Setting | Value |
| --- | --- |
| OTLP endpoint | `https://oneuptime.com/otlp` |
| Header | `x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN` |
| Traces | `POST https://oneuptime.com/otlp/v1/traces` |
| Metrics | `POST https://oneuptime.com/otlp/v1/metrics` |
| Logs | `POST https://oneuptime.com/otlp/v1/logs` |

Create the token in _Project Settings → Telemetry & APM → Ingestion Keys_. Self-hosted: replace the host with your own.

Because a shipped mobile binary cannot have its token rotated quickly, treat it the same way you treat the browser token — it is an ingestion-only credential and it is effectively public.

> The snippets below show the shape of the configuration. The mobile OpenTelemetry SDKs are pre-1.0 and their builder APIs change between releases, so check the exact method names against the version you are pinning. What OneUptime requires — the endpoint, the header, `service.name` and one `device.*` attribute — does not change.

## Android

Add the [OpenTelemetry Android](https://github.com/open-telemetry/opentelemetry-android) agent:

```kotlin
// app/build.gradle.kts
dependencies {
    implementation("io.opentelemetry.android:android-agent:<latest>")
}
```

```kotlin
// Application.onCreate()
val config = OtelRumConfig()

val rum = OpenTelemetryRum.builder(this, config)
    .addSpanExporterCustomizer {
        OtlpHttpSpanExporter.builder()
            .setEndpoint("https://oneuptime.com/otlp/v1/traces")
            .addHeader("x-oneuptime-token", BuildConfig.ONEUPTIME_TOKEN)
            .build()
    }
    .addResourceCustomizer { resource, _ ->
        resource.toBuilder()
            .put("service.name", "storefront-android")
            .build()
    }
    .build()
```

The Android agent's own resource provides `device.model.identifier`, `device.manufacturer` and an install-scoped `device.id`, so classification works without extra configuration. **Verify it on your version** — if the Clients tab stays empty while Traces fill up, the device attributes are what is missing, and you can add them in the same `addResourceCustomizer` block.

If you build the SDK manually rather than using the agent, set them yourself:

```kotlin
.addResourceCustomizer { resource, _ ->
    resource.toBuilder()
        .put("service.name", "storefront-android")
        .put("device.manufacturer", Build.MANUFACTURER)
        .put("device.model.identifier", Build.MODEL)
        .build()
}
```

## iOS / Swift

Use [opentelemetry-swift](https://github.com/open-telemetry/opentelemetry-swift):

```swift
let resource = Resource(attributes: [
    "service.name": .string("storefront-ios"),
    "device.model.identifier": .string(UIDevice.current.model),
    "device.manufacturer": .string("Apple"),
    "telemetry.sdk.language": .string("swift"),
])

let exporter = OtlpHttpTraceExporter(
    endpoint: URL(string: "https://oneuptime.com/otlp/v1/traces")!,
    config: OtlpConfiguration(
        headers: [("x-oneuptime-token", oneUptimeToken)]
    )
)

OpenTelemetry.registerTracerProvider(
    tracerProvider: TracerProviderBuilder()
        .with(resource: resource)
        .add(spanProcessor: BatchSpanProcessor(spanExporter: exporter))
        .build()
)
```

Setting the device attributes explicitly, as above, is the reliable path on iOS — the exact resource a given SDK version contributes has changed between releases.

## React Native / Expo

React Native runs the JavaScript SDK, so the setup is the [browser one](/docs/rum/browser-setup) with two differences: there is no `browserDetector` (no `navigator.userAgentData`), and you must supply the device attributes yourself so the telemetry classifies as mobile rather than as a backend service.

```ts
import { Platform } from "react-native";
import * as Device from "expo-device"; // or react-native-device-info
import {
  defaultResource,
  resourceFromAttributes,
} from "@opentelemetry/resources";

const resource = defaultResource().merge(
  resourceFromAttributes({
    "service.name": "storefront-mobile",
    "device.manufacturer": Device.manufacturer ?? Platform.OS,
    "device.model.identifier": Device.modelId ?? "unknown",
    "telemetry.sdk.language": "webjs",
  }),
);
```

Everything else — the OTLP exporter, the batch processor, the provider registration — is identical to the browser guide.

## Any other platform

There is nothing Android- or iOS-specific in the ingest path. Flutter, Unity, .NET MAUI, an embedded client, or a hand-rolled OTLP writer all work as long as the resource carries `service.name` plus one `device.*` attribute. The environment-variable form works for any SDK that reads it:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN"
OTEL_RESOURCE_ATTRIBUTES="service.name=storefront-mobile,device.manufacturer=Acme,device.model.identifier=AC-100"
```

## Verifying

Check the token before you go hunting through SDK configuration:

```bash
curl -i https://oneuptime.com/otlp/v1/validate \
  -H "x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN"
```

`200` with `"valid": true` means the token resolves to a project. `401` means the token is wrong, and no amount of SDK configuration will help.

Then load the app. It appears under **Resources → Real User Monitoring** on its first batch of telemetry. If it appears under Services instead, the `device.*` attributes are not reaching the resource — see [Troubleshooting](/docs/rum/troubleshooting).

## What is not available on mobile

Session Replay is browser-only. It is a DOM recorder loaded via a script tag, so it has nothing to record in a native app. Mobile applications get traces, logs, metrics, exceptions and the Clients inventory; the Session Replay tab stays empty.
