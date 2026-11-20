# 移动端设置

使用 OpenTelemetry 为 Android、iOS 或 React Native 应用插桩，让它作为移动端 RUM 应用程序向 OneUptime 上报。任何其他拥有 OpenTelemetry SDK 的平台都以同样的方式工作。

:::cards
- [OneUptime 需要什么](#oneuptime-需要什么): 两个资源属性，用服务器密钥发送。
- [设置你的平台](#设置你的平台): Android、iOS、React Native 及其他平台。
- [iOS 崩溃和卡顿](#ios-崩溃和卡顿): MetricKit 和 KSCrash 的报告，显示在异常中，并由你的 dSYM 命名。
- [确认数据到达](#确认数据到达): 先测试密钥，再找到应用。
- [移动端的会话回放](#移动端的会话回放): React Native 应用的录制。
:::

## 工作原理

你的应用使用 **服务器** 摄取密钥将 OTLP 直接导出到 OneUptime。让它被归类为移动端 RUM 而不是后端服务的，是其资源上的 `device.*` 属性。

```mermaid title="移动应用发送什么，用哪个密钥"
flowchart TB
    app["你的移动应用"] --> sdk["OpenTelemetry SDK<br/>带 device.* 属性"]
    sdk -->|"使用服务器密钥<br/>的 OTLP"| oneuptime["OneUptime"]
    oneuptime --> rum["移动端 RUM 应用程序"]
    replay["React Native<br/>回放 SDK"] -->|"使用 Browser 密钥<br/>的录制"| oneuptime
```

## OneUptime 需要什么

应用导出的每个批次都需要两个资源属性：

| 属性 | 含义 |
| --- | --- |
| `service.name` | 应用程序的标识，例如 `storefront-android` 。 |
| `device.id` 或 `device.model.identifier` | 将遥测标记为移动端 RUM。 `device.model.identifier` 还会填充 **客户端** 页面。 |

没有设备属性时，遥测数据仍会到达，你也可以查询它，但它会被归为后端服务，而不是 RUM 应用程序。

`device.manufacturer` 也会将批次标记为移动端，但仅限于没有主机标识的资源，因为主机清单也用它上报机器的制造商。像下面每个示例那样同时设置 `device.id` 或 `device.model.identifier` ，这一点就无关紧要。

让 `device.id` 成为按安装区分的标识符，绝不要使用广告 ID 或任何其他能识别个人的值。OneUptime 读取它只是为了识别移动端遥测。

## 开始之前

- 一个带有 OpenTelemetry SDK 的应用：OpenTelemetry Java SDK 或 OpenTelemetry Android、opentelemetry-swift，或用于 React Native 的 OpenTelemetry JavaScript SDK。
- 一个 **服务器** 摄取密钥，在 **项目设置 → 遥测与 APM → 摄取密钥** 中通过 **创建摄取密钥** 创建。移动应用发来的 **浏览器** 密钥会被拒绝：它要根据 `Origin` 请求头进行检查，而移动端 SDK 不发送这个请求头。
- 以下 OTLP 设置。如果你自行托管 OneUptime，请将 `https://oneuptime.com` 替换为你自己的主机。

| 设置 | 值 |
| --- | --- |
| OTLP 端点 | `https://oneuptime.com/otlp` |
| 请求头 | `x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN` |
| 追踪 | `POST https://oneuptime.com/otlp/v1/traces` |
| 指标 | `POST https://oneuptime.com/otlp/v1/metrics` |
| 日志 | `POST https://oneuptime.com/otlp/v1/logs` |

> [!WARNING]
> 密钥会随应用一起发布，而应用可以被解包，所以请假定有人会复制它。在密钥的页面上设置 **固定的服务名称** ，使复制品无法以你的后端服务的名称写入，再添加 **Requests Per Minute Limit** 和 **过期时间** 日期，并随每次发布轮换密钥。

## 设置你的平台

这些代码片段展示了设置的大致结构。移动端 OpenTelemetry SDK 的 API 会在版本之间变化，因此请对照你锁定的版本核对方法名。OneUptime 需要的东西从不改变：端点、请求头、 `service.name` 和一个 `device.*` 属性。

:::tabs
@tab Android
使用可在 Android 上运行的 OpenTelemetry Java SDK 及其 OTLP 导出器：

```kotlin title="app/build.gradle.kts"
dependencies {
    implementation(platform("io.opentelemetry:opentelemetry-bom:<latest>"))
    implementation("io.opentelemetry:opentelemetry-sdk")
    implementation("io.opentelemetry:opentelemetry-exporter-otlp")
}
```

```kotlin title="StorefrontApplication.kt"
import android.app.Application
import android.os.Build
import io.opentelemetry.exporter.otlp.http.trace.OtlpHttpSpanExporter
import io.opentelemetry.sdk.OpenTelemetrySdk
import io.opentelemetry.sdk.resources.Resource
import io.opentelemetry.sdk.trace.SdkTracerProvider
import io.opentelemetry.sdk.trace.export.BatchSpanProcessor

class StorefrontApplication : Application() {
    override fun onCreate() {
        super.onCreate()

        val resource = Resource.getDefault().toBuilder()
            .put("service.name", "storefront-android")
            .put("device.manufacturer", Build.MANUFACTURER)
            .put("device.model.identifier", Build.MODEL)
            .build()

        val exporter = OtlpHttpSpanExporter.builder()
            .setEndpoint("https://oneuptime.com/otlp/v1/traces")
            .addHeader("x-oneuptime-token", BuildConfig.ONEUPTIME_TOKEN)
            .build()

        OpenTelemetrySdk.builder()
            .setTracerProvider(
                SdkTracerProvider.builder()
                    .setResource(resource)
                    .addSpanProcessor(BatchSpanProcessor.builder(exporter).build())
                    .build()
            )
            .buildAndRegisterGlobal()
    }
}
```

[OpenTelemetry Android](https://github.com/open-telemetry/opentelemetry-android) 代理在此基础上增加了崩溃、ANR、慢帧和冻结帧以及应用启动，并在它自己的资源上设置 `device.model.identifier` 和 `device.manufacturer` 。 [Android 端设置](/docs/rum/android-setup) 介绍如何用它代替上面的代码进行设置。
@tab iOS
使用 [opentelemetry-swift](https://github.com/open-telemetry/opentelemetry-swift) ，并自行设置设备属性：各个版本自行添加的资源在不同版本之间有所变化。

```swift
let resource = Resource(attributes: [
    "service.name": .string("storefront-ios"),
    "device.model.identifier": .string(UIDevice.current.model),
    "device.manufacturer": .string("Apple"),
    "device.id": .string(UIDevice.current.identifierForVendor?.uuidString ?? ""),
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

`UIDevice.current.model` 给出 `iPhone` 这样的简短名称，使 **客户端** 页面每种设备只有一行。 `identifierForVendor` 是 OneUptime 统计无崩溃安装时所依据的安装，详见 [记录会话](#记录会话) 。
@tab React Native
React Native 运行 OpenTelemetry JavaScript SDK，因此请按照 [浏览器端设置](/docs/rum/browser-setup) 构建提供程序、OTLP 导出器和批处理器，并做三处修改：使用 **服务器** 密钥发送，去掉 `browserDetector` 和 `DocumentLoadInstrumentation` ，并自行设置设备属性。

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
    "device.model.identifier":
      Device.modelId ?? Device.modelName ?? "unknown",
    "telemetry.sdk.language": "webjs",
  }),
);
```

`Device.modelId` 只在 iOS 上设置，因此 Android 上会退回到 `Device.modelName` 。
@tab 其他平台
Flutter、Unity、.NET MAUI、嵌入式客户端或你自己编写的 OTLP 写入器都可以，只要资源带有 `service.name` 和一个 `device.*` 属性。读取标准 OpenTelemetry 环境变量的 SDK 会原样使用这些值：

```bash
OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN"
OTEL_RESOURCE_ATTRIBUTES="service.name=storefront-mobile,device.manufacturer=Acme,device.model.identifier=AC-100"
```

SDK 会自行在端点后加上 `/v1/traces` 、 `/v1/metrics` 和 `/v1/logs` 。
:::

## iOS 崩溃和卡顿

opentelemetry-swift 2.3 及更高版本通过其 MetricKit 插桩上报 iOS 应用的崩溃和卡顿，该插桩会把 Apple 的每条诊断作为一条日志记录交给 OpenTelemetry。OneUptime 像归档 OpenTelemetry Android 的崩溃和 ANR 那样归档它们，因此它们会显示在 **异常** 中和应用程序的 **概览** 上：

| Apple 的诊断 | 事件名称 | 在异常中 |
| --- | --- | --- |
| 崩溃 | `metrickit.diagnostic.crash` | 一个未处理异常，其类型取决于结束应用的原因：在 iOS 17 及更高版本上为 Objective-C 异常，否则为 Mach 异常（ `EXC_BAD_ACCESS` ），再否则为信号（ `SIGSEGV` ） |
| 卡顿 | `metrickit.diagnostic.hang` | 一个类型为 **Hang** 的未处理异常，即 iOS 上与 ANR 相对应的情况，它会记下卡顿持续了多久 |

概览的 **崩溃** 磁贴统计这些崩溃，其 **ANR** 磁贴把卡顿与 Android 的 ANR 一起统计。每条堆栈追踪都像崩溃报告那样按线程绘制，崩溃或卡顿的线程排在最前面。上传某个构建的 dSYM 之后，你的应用代码中的帧会以其函数命名，例如 `CartViewController.checkout()` ，见 [上传 dSYM](#上传-dsym) 。其余的帧给出它们所在的二进制文件以及代码在其中的偏移量， **Binary Images** 列出每个二进制文件的 UUID，据此可知是哪个构建的 dSYM 为它命名。

崩溃和卡顿按崩溃或卡顿的线程上你的应用的帧分组：有 dSYM 命名的帧按函数分组，因此同一个崩溃从一个版本到下一个版本始终是同一个异常；没有 dSYM 命名的帧按其在二进制文件中的偏移量分组，而偏移量每次构建都会改变。报告在到达时命名，所以请在发布某个构建之前上传它的 dSYM：在 dSYM 之前到达的崩溃会保留其偏移量。

:::steps
### 除了 span，也导出日志

MetricKit 以日志记录的形式上报诊断，因此请在追踪器提供程序旁边注册一个日志记录器提供程序，并使用相同的资源、端点和请求头：

```swift
let logExporter = OtlpHttpLogExporter(
    endpoint: URL(string: "https://oneuptime.com/otlp/v1/logs")!,
    config: OtlpConfiguration(
        headers: [("x-oneuptime-token", oneUptimeToken)]
    )
)

OpenTelemetry.registerLoggerProvider(
    loggerProvider: LoggerProviderBuilder()
        .with(resource: resource)
        .with(processors: [
            BatchLogRecordProcessor(logRecordExporter: logExporter),
        ])
        .build()
)
```

### 注册 MetricKit 插桩

添加 opentelemetry-swift 的 `MetricKitInstrumentation` 产品，并在日志记录器提供程序注册之后把它注册到 MetricKit：

```swift
import MetricKit
import MetricKitInstrumentation

// MXMetricManager keeps only a weak reference: hold this for the app's lifetime.
let metricKitInstrumentation = MetricKitInstrumentation()
MXMetricManager.shared.add(metricKitInstrumentation)
```

### 记录会话

**会话** 和 **无崩溃会话** 磁贴统计你的 span 上的 `session.id` 。opentelemetry-swift 的 `Sessions` 产品会设置它：把 `SessionSpanProcessor` 添加到追踪器提供程序，并用 `SessionLogRecordProcessor` 包装日志处理器，让诊断也带上会话。

**无崩溃会话** 下方的那一行显示未崩溃的安装所占的比例， **Daily Crash Rate** 和 **Daily ANR Rate** 则根据崩溃的安装所占的比例发出警报。一次安装就是上面资源中的 `device.id` ，即应用的供应商标识符：每台设备上你的所有应用共用一个，只要其中任何一个仍然安装就会保留，因此重装你唯一的应用会产生新的安装，而重装两个应用中的一个则不会。设置了 `app.installation.id` 的 opentelemetry-swift 版本则改为按它统计。

### 上传 dSYM

Xcode 在归档应用时会为应用的每个二进制文件写出一个 dSYM，App Store Connect 也会在 **Download dSYMs** 下把它们还给你。每次归档后，从 CI 或 Xcode 构建阶段，用 [OneUptime CLI](/docs/cli/index) 和你的构建专用的服务器密钥上传它们：设置了 **固定的服务名称** 的密钥（例如随你的应用一起发布的密钥）会被拒绝，因为一个 dSYM 会为项目中每个发布其二进制文件的应用的帧命名。

```bash
oneuptime dsym upload "$ARCHIVE_PATH/dSYMs" --app storefront-ios --url https://oneuptime.com --ingestion-key YOUR_TELEMETRY_INGESTION_TOKEN
```

CLI 读取 `.dSYM` 包、包含它们的文件夹和 zip，以及所在位置的 DWARF 文件，只发送每个二进制文件的 UUID、架构和函数名：大型应用的 dSYM 有数百兆字节，而其中的名称只有几兆字节。不用 CLI 时，按原样发送 dSYM 的 DWARF 文件，或 `.dSYM` 包的 zip，每个文件最大 50 MB：

```bash
curl --fail -X POST "https://oneuptime.com/dsyms/v1/upload" \
  -H "x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN" \
  -F "appName=storefront-ios" \
  -F "dsym=@MyApp.app.dSYM/Contents/Resources/DWARF/MyApp"
```

每个二进制文件按其 UUID 保留 400 天，因此几个月后仍装在用户手机上的版本依然会被命名，而再次上传某个构建会替换为它保留的内容。dSYM 属于项目，而不属于某一个应用：你的两个应用都嵌入的框架在两个应用中都会被命名。
:::

> [!NOTE]
> Apple 会在应用之后的某次启动时把 MetricKit 的诊断交给应用：在 iOS 15 及更高版本上立即交付，更早的版本则每天一次。因此崩溃或卡顿可能在发生几分钟或一天后才到达，并在到达时才被计数。iOS 应用概览上的“过去一小时 0 次崩溃”还不算好消息。诊断带有的是上报它的会话，而不是它所结束的会话。

opentelemetry-swift 不会在应用启动时记录 span，因此在你的应用自己记录一个之前， **应用启动** 和 **冷启动（p95）** 磁贴会一直为空：这个 span 名为 `AppStart` ， `start.type` 设为 `cold` 、 `warm` 或 `hot` ，时间范围从进程启动到第一个屏幕准备就绪。

### 当 KSCrash 也上报崩溃时

opentelemetry-swift 也可以通过 KSCrash 上报崩溃，KSCrash 会在应用下次打开时，把报告作为一条 `device.crash` 日志记录发送，并带上应用崩溃的时间。同时注册了两者的应用会把每次崩溃上报两次：KSCrash 在下次启动时上报，MetricKit 在下次启动时或最多一天后上报。OneUptime 只把这样的崩溃计数一次：先到达的报告就是这次出现，第二份报告作为同一次崩溃的证据，保存在同一个异常中它的旁边，不计入任何磁贴、图表或监视器。在异常的 **发生次数** 中，这次出现会显示 **报告了两次** 。

只有当以下条件全部满足时，两份报告才会被视为同一次崩溃：

- 它们来自两个上报方：KSCrash 和 MetricKit。两者都不会把一次崩溃上报两次，所以来自同一方的两份报告就是两次崩溃。
- 它们来自同一次安装：相同的 `app.installation.id` 或 `device.id` 。
- 它们相隔不超过 26 小时：MetricKit 给崩溃标记的是它所报告那一天的结束时间，KSCrash 标记的是崩溃发生的时刻。
- 在信号、Mach 异常和 Objective-C 异常上，凡是两者都给出的，都必须一致。
- 崩溃的线程从线程开始处向内逐帧一致，按二进制文件和偏移量比较，覆盖任一报告给出的你的应用代码的每一帧。完全发生在 Apple 代码中的崩溃，必须至少有三帧一致，并且所有帧都一致。

每份报告只配对一次，与时间上最接近的报告配对，因此同一次安装上同一个缺陷相隔几分钟的两次崩溃是两次出现，各自带有自己的第二份报告。当 OneUptime 无法把一份报告与同一安装的其他报告比较时，就会计入它，因此一次崩溃最坏会被计数两次，但绝不会丢失。

## 确认数据到达

:::steps
### 测试密钥

在翻看 SDK 的设置之前，先确认 OneUptime 是否接受该密钥：

```bash
curl -i https://oneuptime.com/otlp/v1/validate \
  -H "x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN"
```

`200` 加上 `"valid": true` 表示密钥被接受。Browser 密钥也会返回 `200` ，但其消息说明它只能在浏览器中使用：移动应用需要服务器密钥。 `401` 表示密钥未知、已撤销、已关闭或已过期，任何 SDK 设置都无法解决。

### 启动应用

运行应用并使用片刻。收到第一批遥测数据后，它会以其 `service.name` 命名，出现在 **产品 → 资源 → 真实用户监控** 下。

### 打开客户端页面

打开应用程序的 **客户端** 页面： `device.model.identifier` 中的每个设备型号都有一行。如果 **追踪** 有数据而此页面一直为空，说明设备属性没有进入资源。
:::

## 移动端的会话回放

React Native 应用可以使用 `@oneuptime/react-native-replay` 录制会话。它将原生视图树记录为线框，绝不记录屏幕截图或屏幕上的文字，其录制与 Web 录制在同一个播放器中打开。它使用 **浏览器** 密钥发送，该密钥的 **允许的来源** 以 `app://` 加上 Android 应用 ID 或 iOS bundle ID 的形式列出你的应用：这是一个独立的密钥，不同于你的 OpenTelemetry SDK 使用的服务器密钥。 [在 React Native 中安装](/docs/telemetry/session-replay#在-react-native-中安装) 会逐步介绍。

原生 Android 和 iOS 应用以及其他平台没有会话录制器：它们的 **会话回放** 页面保持为空，而追踪、日志、指标、异常和 **客户端** 页面照常工作。

## 故障排除

:::details 密钥检查返回 401，或密钥被拒绝
`401` 表示密钥未知、已撤销、已关闭或已过期：请创建一个服务器密钥，并用它重新构建应用。

Browser 密钥能通过检查，但移动应用的每次导出都会被拒绝，返回 `422` 和 `This request did not send an Origin header, so it cannot be checked against the allowed origins of this browser ingestion key. Use a server ingestion key for requests that are not sent by a browser.` 。请使用 **服务器** 密钥。
:::

:::details 应用出现在服务下，而不是真实用户监控下
资源既没有 `device.id` 也没有 `device.model.identifier` ，因此遥测被归为后端服务。请按照 [设置你的平台](#设置你的平台) 设置它们。

已经创建的服务不会变成 RUM 应用程序，因此在 RUM 遥测到达后，请在 **产品 → 服务** 下删除它。
:::

:::details 客户端页面为空
客户端行只来自 `device.model.identifier` 。只设置 `device.id` 或 `device.manufacturer` 的 SDK 会把应用归为移动端 RUM，但不会列出任何客户端：请同时设置 `device.model.identifier` 。
:::

:::details 有人在使用应用，状态却显示近期无流量
15 分钟内没有遥测时，状态会变为 **近期无流量** 。如果有人正在使用应用：

- 采样器可能丢弃了所有数据：检查是否有 always-off 采样器，或比例非常低的采样器。
- 应用可能只为那段时间内没有人执行过的操作发送遥测。
- 发布之后，密钥可能已被撤销或已过期：按照 [确认数据到达](#确认数据到达) 测试它。
:::

## 后续步骤

:::cards
- [会话回放](/docs/telemetry/session-replay): 录制 React Native 会话，与其追踪并列。
- [管理应用程序](/docs/rum/applications): 名称、标签、所有者和保留期。
- [OpenTelemetry](/docs/telemetry/open-telemetry): OTLP 端点、限制和错误的完整说明。
- [RUM 故障排除](/docs/rum/troubleshooting): 按问题通常发生的顺序列出的所有检查。
:::
