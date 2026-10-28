import {
  OpenTelemetryGuide,
  GuideSnippet,
  VerificationFile,
  VerificationRequest,
} from "../GuideTypes";
import {
  DOCS,
  OTLP_HTTP_PROTOCOL_LINE,
  SCREENS,
  SERVER_KEY_PREREQUISITE,
  kubernetesManifestSnippet,
  otlpEnvironmentTabs,
  validateKeyStep,
} from "../GuideShared";
import { javaAgentDownloadSnippet, jvmDockerfileSnippet } from "../JvmShared";

/*
 * Ktor with OpenTelemetry's Ktor plugins: the SDK set up in code from the
 * standard variables, the server and client plugins, JDBC through a
 * wrapped DataSource (what Exposed connects through), Logback's appender
 * and the JVM's metrics. The Java agent, the no-code way, is the last step,
 * checked as a variant of its own.
 */

const buildDependencies: GuideSnippet = {
  id: "build-dependencies",
  language: "kotlin",
  title: "build.gradle.kts",
  code: [
    "dependencies {",
    '    implementation(platform("io.opentelemetry:opentelemetry-bom:1.67.0"))',
    '    implementation(platform("io.opentelemetry.instrumentation:opentelemetry-instrumentation-bom-alpha:2.33.1-alpha"))',
    '    implementation("io.opentelemetry:opentelemetry-sdk-extension-autoconfigure")',
    '    implementation("io.opentelemetry:opentelemetry-exporter-otlp")',
    '    implementation("io.opentelemetry:opentelemetry-extension-kotlin")',
    '    implementation("io.opentelemetry.instrumentation:opentelemetry-ktor-3.0")',
    '    implementation("io.opentelemetry.instrumentation:opentelemetry-jdbc")',
    '    implementation("io.opentelemetry.instrumentation:opentelemetry-logback-appender-1.0")',
    '    implementation("io.opentelemetry.instrumentation:opentelemetry-runtime-telemetry")',
    "}",
  ].join("\n"),
  check: "contained",
};

const telemetry: GuideSnippet = {
  id: "telemetry",
  language: "kotlin",
  title: "Telemetry.kt",
  code: [
    "package com.example.checkout",
    "",
    "import io.opentelemetry.api.OpenTelemetry",
    "import io.opentelemetry.instrumentation.logback.appender.v1_0.OpenTelemetryAppender",
    "import io.opentelemetry.instrumentation.runtimetelemetry.RuntimeTelemetry",
    "import io.opentelemetry.sdk.autoconfigure.AutoConfiguredOpenTelemetrySdk",
    "",
    "// The SDK, set up from the OTEL_* variables, with Logback's records and the JVM's metrics.",
    "fun startOpenTelemetry(): OpenTelemetry {",
    "    val openTelemetry = AutoConfiguredOpenTelemetrySdk.initialize().openTelemetrySdk",
    "    OpenTelemetryAppender.install(openTelemetry)",
    "    RuntimeTelemetry.create(openTelemetry)",
    "    return openTelemetry",
    "}",
  ].join("\n"),
  check: "run",
};

const application: GuideSnippet = {
  id: "application",
  language: "kotlin",
  title: "Application.kt",
  code: [
    "package com.example.checkout",
    "",
    "import io.ktor.serialization.kotlinx.json.json",
    "import io.ktor.server.application.Application",
    "import io.ktor.server.application.install",
    "import io.ktor.server.engine.embeddedServer",
    "import io.ktor.server.netty.Netty",
    "import io.ktor.server.plugins.contentnegotiation.ContentNegotiation",
    "import io.opentelemetry.api.OpenTelemetry",
    "import io.opentelemetry.instrumentation.ktor.v3_0.KtorServerTelemetry",
    "",
    "fun main() {",
    "    val openTelemetry = startOpenTelemetry()",
    "    embeddedServer(Netty, port = 8080) { module(openTelemetry) }.start(wait = true)",
    "}",
    "",
    "fun Application.module(openTelemetry: OpenTelemetry) {",
    "    // First, so every request is traced: a server span per call, named after its route.",
    "    install(KtorServerTelemetry) {",
    "        setOpenTelemetry(openTelemetry)",
    "    }",
    "    install(ContentNegotiation) { json() }",
    "    orderRoutes(openTelemetry)",
    "}",
  ].join("\n"),
  check: "run",
};

const httpClient: GuideSnippet = {
  id: "http-client",
  language: "kotlin",
  title: "HttpClients.kt",
  code: [
    "package com.example.checkout",
    "",
    "import io.ktor.client.HttpClient",
    "import io.ktor.client.engine.cio.CIO",
    "import io.opentelemetry.api.OpenTelemetry",
    "import io.opentelemetry.instrumentation.ktor.v3_0.KtorClientTelemetry",
    "",
    "// A client whose every call is a span, with traceparent sent to the service called.",
    "fun tracedHttpClient(openTelemetry: OpenTelemetry): HttpClient =",
    "    HttpClient(CIO) {",
    "        install(KtorClientTelemetry) {",
    "            setOpenTelemetry(openTelemetry)",
    "        }",
    "    }",
  ].join("\n"),
  check: "run",
};

const jdbc: GuideSnippet = {
  id: "jdbc",
  language: "kotlin",
  title: "OrderStore.kt",
  code: "val database = Database.connect(JdbcTelemetry.create(openTelemetry).wrap(dataSource))",
  check: "contained",
};

const appender: GuideSnippet = {
  id: "appender",
  language: "xml",
  title: "logback.xml",
  code: [
    '<appender name="OpenTelemetry" class="io.opentelemetry.instrumentation.logback.appender.v1_0.OpenTelemetryAppender"/>',
    '<root level="INFO">',
    '    <appender-ref ref="STDOUT"/>',
    '    <appender-ref ref="OpenTelemetry"/>',
    "</root>",
  ].join("\n"),
  check: "contained",
};

const buildFatJar: GuideSnippet = {
  id: "build",
  language: "bash",
  code: "./gradlew buildFatJar",
  check: "parse",
};

const run: GuideSnippet = {
  id: "run",
  language: "bash",
  code: "java -jar build/libs/checkout-all.jar",
  check: "run",
};

const paymentService: GuideSnippet = {
  id: "payment-service",
  language: "kotlin",
  title: "PaymentService.kt",
  code: [
    "package com.example.checkout",
    "",
    "import io.ktor.client.request.post",
    "import io.opentelemetry.api.OpenTelemetry",
    "import io.opentelemetry.api.common.AttributeKey",
    "import io.opentelemetry.api.common.Attributes",
    "import io.opentelemetry.api.trace.StatusCode",
    "import io.opentelemetry.context.Context",
    "import io.opentelemetry.extension.kotlin.asContextElement",
    "import kotlinx.coroutines.withContext",
    "",
    "class PaymentService(openTelemetry: OpenTelemetry) {",
    '    private val paymentsApi = System.getenv("PAYMENTS_API_URL") ?: "http://localhost:9000"',
    '    private val tracer = openTelemetry.getTracer("checkout")',
    '    private val ordersPlaced = openTelemetry.getMeter("checkout").counterBuilder("orders.placed").build()',
    "    private val http = tracedHttpClient(openTelemetry)",
    "",
    "    suspend fun charge(paymentMethod: String, itemCount: Int) {",
    '        val span = tracer.spanBuilder("checkout.charge")',
    '            .setAttribute("payment.method", paymentMethod)',
    '            .setAttribute("order.item_count", itemCount.toLong())',
    "            .startSpan()",
    "        try {",
    "            // The span travels with the coroutine, whichever thread resumes it.",
    "            withContext(Context.current().with(span).asContextElement()) {",
    '                http.post("$paymentsApi/api/charges")',
    "            }",
    '            ordersPlaced.add(1, Attributes.of(AttributeKey.stringKey("payment.method"), paymentMethod))',
    "        } catch (error: Exception) {",
    "            span.recordException(error)",
    "            span.setStatus(StatusCode.ERROR)",
    "            throw error",
    "        } finally {",
    "            span.end()",
    "        }",
    "    }",
    "}",
  ].join("\n"),
  check: "run",
};

const samplingEnvironment: GuideSnippet = {
  id: "sampling",
  language: "bash",
  code: [
    'export OTEL_TRACES_SAMPLER="parentbased_traceidratio"',
    'export OTEL_TRACES_SAMPLER_ARG="0.25"',
  ].join("\n"),
  check: "parse",
};

const skipHealthChecks: GuideSnippet = {
  id: "skip-health-checks",
  language: "kotlin",
  title: "SkipHealthChecks.kt",
  code: [
    "package com.example.checkout",
    "",
    "import io.opentelemetry.api.common.AttributeKey",
    "import io.opentelemetry.api.common.Attributes",
    "import io.opentelemetry.api.trace.SpanKind",
    "import io.opentelemetry.context.Context",
    "import io.opentelemetry.sdk.trace.data.LinkData",
    "import io.opentelemetry.sdk.trace.samplers.Sampler",
    "import io.opentelemetry.sdk.trace.samplers.SamplingResult",
    "",
    "// Drops health checks' spans, and leaves every other decision to the sampler configured.",
    "class SkipHealthChecks(private val next: Sampler) : Sampler {",
    "    override fun shouldSample(",
    "        parentContext: Context,",
    "        traceId: String,",
    "        name: String,",
    "        spanKind: SpanKind,",
    "        attributes: Attributes,",
    "        parentLinks: List<LinkData>,",
    "    ): SamplingResult =",
    '        if (spanKind == SpanKind.SERVER && attributes.get(URL_PATH) == "/healthz") {',
    "            SamplingResult.drop()",
    "        } else {",
    "            next.shouldSample(parentContext, traceId, name, spanKind, attributes, parentLinks)",
    "        }",
    "",
    '    override fun getDescription(): String = "SkipHealthChecks(${next.description})"',
    "",
    "    private companion object {",
    '        val URL_PATH: AttributeKey<String> = AttributeKey.stringKey("url.path")',
    "    }",
    "}",
  ].join("\n"),
  check: "run",
};

const samplerSetup: GuideSnippet = {
  id: "sampler-setup",
  language: "kotlin",
  title: "Telemetry.kt",
  code: [
    "val openTelemetry = AutoConfiguredOpenTelemetrySdk.builder()",
    "    .addSamplerCustomizer { sampler, _ -> SkipHealthChecks(sampler) }",
    "    .build()",
    "    .openTelemetrySdk",
  ].join("\n"),
  check: "contained",
};

const agent: GuideSnippet = javaAgentDownloadSnippet();

const agentApi: GuideSnippet = {
  id: "agent-api",
  language: "kotlin",
  title: "build.gradle.kts",
  code: [
    "dependencies {",
    '    implementation(platform("io.opentelemetry:opentelemetry-bom:1.67.0"))',
    '    implementation("io.opentelemetry:opentelemetry-api")',
    '    implementation("io.opentelemetry:opentelemetry-extension-kotlin")',
    "}",
  ].join("\n"),
  check: "contained",
};

const agentTelemetry: GuideSnippet = {
  id: "agent-telemetry",
  language: "kotlin",
  title: "Telemetry.kt",
  code: [
    "// The agent's SDK, which it set up before main from the same variables.",
    "fun startOpenTelemetry(): OpenTelemetry = GlobalOpenTelemetry.get()",
  ].join("\n"),
  check: "contained",
};

const runWithAgent: GuideSnippet = {
  id: "run-agent",
  language: "bash",
  code: "java -javaagent:opentelemetry-javaagent.jar -jar build/libs/checkout-all.jar",
  check: "run",
};

/*
 * The app the end-to-end check builds: a Ktor 3.6 service on Netty with
 * Exposed over H2, built into one jar with the Ktor plugin's buildFatJar.
 * `withPlugins` false is the same app for the Java agent: no OpenTelemetry
 * plugins, wrapper or SDK of its own, the agent's global instance instead.
 */
function buildFile(withPlugins: boolean): string {
  return [
    "plugins {",
    '    kotlin("jvm") version "2.4.21"',
    '    kotlin("plugin.serialization") version "2.4.21"',
    '    id("io.ktor.plugin") version "3.6.0"',
    "}",
    "",
    'group = "com.example"',
    'version = "1.0.0"',
    "",
    "application {",
    '    mainClass.set("com.example.checkout.ApplicationKt")',
    "}",
    "",
    "repositories {",
    "    mavenCentral()",
    "}",
    "",
    "dependencies {",
    '    implementation("io.ktor:ktor-server-netty")',
    '    implementation("io.ktor:ktor-server-content-negotiation")',
    '    implementation("io.ktor:ktor-serialization-kotlinx-json")',
    '    implementation("io.ktor:ktor-client-cio")',
    '    implementation("org.jetbrains.exposed:exposed-jdbc:1.6.0")',
    '    implementation("com.h2database:h2:2.5.252")',
    '    implementation("ch.qos.logback:logback-classic:1.6.6")',
    "}",
    "",
    withPlugins ? buildDependencies.code : agentApi.code,
  ].join("\n");
}

const source: string = "src/main/kotlin/com/example/checkout/";

// Telemetry.kt for the sampling section's variant and the Java agent's.
function telemetryFile(kind: "sampler" | "agent"): string {
  if (kind === "agent") {
    return [
      "package com.example.checkout",
      "",
      "import io.opentelemetry.api.GlobalOpenTelemetry",
      "import io.opentelemetry.api.OpenTelemetry",
      "",
      agentTelemetry.code,
    ].join("\n");
  }

  // The setup's file with the health-check sampler put in, as the page shows it.
  return [
    "package com.example.checkout",
    "",
    "import io.opentelemetry.api.OpenTelemetry",
    "import io.opentelemetry.instrumentation.logback.appender.v1_0.OpenTelemetryAppender",
    "import io.opentelemetry.instrumentation.runtimetelemetry.RuntimeTelemetry",
    "import io.opentelemetry.sdk.autoconfigure.AutoConfiguredOpenTelemetrySdk",
    "",
    "fun startOpenTelemetry(): OpenTelemetry {",
    samplerSetup.code,
    "    OpenTelemetryAppender.install(openTelemetry)",
    "    RuntimeTelemetry.create(openTelemetry)",
    "    return openTelemetry",
    "}",
  ].join("\n");
}

function sourceFiles(
  kind: "plugins" | "sampler" | "agent",
): Array<VerificationFile> {
  const withPlugins: boolean = kind !== "agent";

  return [
    { path: "settings.gradle.kts", content: 'rootProject.name = "checkout"' },
    { path: "build.gradle.kts", content: buildFile(withPlugins) },
    kind === "plugins"
      ? { path: `${source}Telemetry.kt`, snippet: "telemetry" }
      : { path: `${source}Telemetry.kt`, content: telemetryFile(kind) },
    withPlugins
      ? { path: `${source}Application.kt`, snippet: "application" }
      : {
          path: `${source}Application.kt`,
          content: [
            "package com.example.checkout",
            "",
            "import io.ktor.serialization.kotlinx.json.json",
            "import io.ktor.server.application.Application",
            "import io.ktor.server.application.install",
            "import io.ktor.server.engine.embeddedServer",
            "import io.ktor.server.netty.Netty",
            "import io.ktor.server.plugins.contentnegotiation.ContentNegotiation",
            "import io.opentelemetry.api.OpenTelemetry",
            "",
            "fun main() {",
            "    val openTelemetry = startOpenTelemetry()",
            "    embeddedServer(Netty, port = 8080) { module(openTelemetry) }.start(wait = true)",
            "}",
            "",
            "// No OpenTelemetry plugin: the agent traces every call by itself.",
            "fun Application.module(openTelemetry: OpenTelemetry) {",
            "    install(ContentNegotiation) { json() }",
            "    orderRoutes(openTelemetry)",
            "}",
          ].join("\n"),
        },
    withPlugins
      ? { path: `${source}HttpClients.kt`, snippet: "http-client" }
      : {
          path: `${source}HttpClients.kt`,
          content: [
            "package com.example.checkout",
            "",
            "import io.ktor.client.HttpClient",
            "import io.ktor.client.engine.cio.CIO",
            "import io.opentelemetry.api.OpenTelemetry",
            "",
            "// The agent traces every Ktor client by itself.",
            "fun tracedHttpClient(openTelemetry: OpenTelemetry): HttpClient = HttpClient(CIO)",
          ].join("\n"),
        },
    { path: `${source}PaymentService.kt`, snippet: "payment-service" },
    {
      path: `${source}OrderStore.kt`,
      content: [
        "package com.example.checkout",
        "",
        "import io.opentelemetry.api.OpenTelemetry",
        ...(withPlugins
          ? [
              "import io.opentelemetry.instrumentation.jdbc.datasource.JdbcTelemetry",
            ]
          : []),
        "import javax.sql.DataSource",
        "import org.jetbrains.exposed.v1.core.Table",
        "import org.jetbrains.exposed.v1.core.eq",
        "import org.jetbrains.exposed.v1.jdbc.Database",
        "import org.jetbrains.exposed.v1.jdbc.SchemaUtils",
        "import org.jetbrains.exposed.v1.jdbc.insert",
        "import org.jetbrains.exposed.v1.jdbc.selectAll",
        "import org.jetbrains.exposed.v1.jdbc.transactions.transaction",
        "",
        'object PlacedOrders : Table("placed_order") {',
        '    val id = integer("id").autoIncrement()',
        '    val itemCount = integer("item_count")',
        "    override val primaryKey = PrimaryKey(id)",
        "}",
        "",
        "class OrderStore(openTelemetry: OpenTelemetry, dataSource: DataSource) {",
        withPlugins
          ? `    private ${jdbc.code}`
          : "    private val database = Database.connect(dataSource)",
        "",
        "    init {",
        "        transaction(database) { SchemaUtils.create(PlacedOrders) }",
        "    }",
        "",
        "    fun exists(id: Int): Boolean = transaction(database) {",
        "        PlacedOrders.selectAll().where { PlacedOrders.id eq id }.count() > 0",
        "    }",
        "",
        "    fun save(itemCount: Int): Int = transaction(database) {",
        "        PlacedOrders.insert { it[PlacedOrders.itemCount] = itemCount }[PlacedOrders.id]",
        "    }",
        "}",
      ].join("\n"),
    },
    {
      path: `${source}Orders.kt`,
      content: [
        "package com.example.checkout",
        "",
        "import io.ktor.http.HttpStatusCode",
        "import io.ktor.server.application.Application",
        "import io.ktor.server.request.receive",
        "import io.ktor.server.response.respond",
        "import io.ktor.server.routing.get",
        "import io.ktor.server.routing.post",
        "import io.ktor.server.routing.routing",
        "import io.opentelemetry.api.OpenTelemetry",
        "import kotlinx.serialization.Serializable",
        "import org.h2.jdbcx.JdbcDataSource",
        "import org.slf4j.LoggerFactory",
        "",
        "@Serializable",
        "data class NewOrder(val items: List<String>, val paymentMethod: String)",
        "",
        "@Serializable",
        "data class OrderView(val id: Int, val found: Boolean)",
        "",
        'private val logger = LoggerFactory.getLogger("com.example.checkout.Orders")',
        "",
        "fun Application.orderRoutes(openTelemetry: OpenTelemetry) {",
        "    val dataSource = JdbcDataSource()",
        '    dataSource.setURL("jdbc:h2:mem:shop;DB_CLOSE_DELAY=-1")',
        "    val orders = OrderStore(openTelemetry, dataSource)",
        "    val payments = PaymentService(openTelemetry)",
        "",
        "    routing {",
        '        get("/healthz") { call.respond("ok") }',
        '        get("/orders/{id}") {',
        '            val id = call.parameters["id"]!!.toInt()',
        '            logger.info("loading order {}", id)',
        "            call.respond(OrderView(id, orders.exists(id)))",
        "        }",
        '        post("/orders") {',
        "            val order = call.receive<NewOrder>()",
        "            payments.charge(order.paymentMethod, order.items.size)",
        "            call.respond(HttpStatusCode.Created, OrderView(orders.save(order.items.size), true))",
        "        }",
        '        get("/boom") { throw IllegalStateException("Payment provider timed out") }',
        "    }",
        "}",
      ].join("\n"),
    },
    {
      path: "src/main/resources/logback.xml",
      content: [
        "<configuration>",
        '<appender name="STDOUT" class="ch.qos.logback.core.ConsoleAppender">',
        "    <encoder>",
        "        <pattern>%d{HH:mm:ss.SSS} [%thread] %-5level %logger{36} - %msg%n</pattern>",
        "    </encoder>",
        "</appender>",
        appender.code,
        "</configuration>",
      ].join("\n"),
    },
  ];
}

const requests: Array<VerificationRequest> = [
  { method: "GET", path: "/healthz" },
  { method: "GET", path: "/orders/42" },
  {
    method: "POST",
    path: "/orders",
    body: { items: ["kettle", "mug"], paymentMethod: "card" },
  },
  { method: "GET", path: "/boom" },
];

export const KtorGuide: OpenTelemetryGuide = {
  slug: "ktor",
  seo: {
    title: "Ktor OpenTelemetry: Tracing Kotlin Services | OneUptime",
    description:
      "Trace Ktor with OpenTelemetry's server and client plugins: routes, Ktor client calls, SQL, coroutines that keep their trace, JVM metrics and Logback logs.",
  },
  h1: "OpenTelemetry for Ktor",
  lead: "Trace every Ktor route, each call its `HttpClient` makes and the SQL beneath them, keep the trace across coroutines, and send traces, metrics and logs to OneUptime. OpenTelemetry's two Ktor plugins do it in a few lines of Kotlin; the Java agent does it with none.",
  cardDescription:
    "OpenTelemetry's Ktor plugins: routes, Ktor client calls, SQL, coroutine context, JVM metrics and Logback logs.",
  searchTerms: [
    "kotlin",
    "ktor client",
    "coroutines",
    "netty",
    "exposed",
    "logback",
    "javaagent",
  ],
  highlights: ["Ktor 3", "Server and client plugins", "Coroutine context"],

  whatYouGet: {
    intro: `With the plugins installed, a Ktor app reports as one service, \`checkout-api\` here, in ${SCREENS.services} from its first request, on Netty or any other engine.`,
    traces:
      "A server span per call named after its route, such as `GET /orders/{id}`, a client span per request the Ktor `HttpClient` sends, a span per SQL statement, and the spans you open, nested correctly across `suspend` functions.",
    metrics:
      "`http.server.request.duration` by route and `http.client.request.duration` for outgoing calls, the JVM's memory, garbage collection, threads and CPU, and your own instruments.",
    logs: "Logback records with the trace and span IDs of the coroutine that wrote them, sent by OpenTelemetry's Logback appender.",
    exceptions: `An exception that escapes a route is recorded on its span with the stack trace, and the span is marked failed. ${SCREENS.exceptions} groups them by type and place.`,
  },

  exampleTrace: {
    caption: "A POST /orders call, as its trace shows it",
    spans: [
      {
        name: "POST /orders",
        depth: 0,
        start: 0,
        duration: 100,
        source: "ktor-server",
      },
      {
        name: "checkout.charge",
        depth: 1,
        start: 3,
        duration: 74,
        source: "your code",
      },
      {
        name: "POST",
        depth: 2,
        start: 7,
        duration: 66,
        source: "ktor-client",
      },
      {
        name: "INSERT shop.PLACED_ORDER",
        depth: 1,
        start: 82,
        duration: 11,
        source: "jdbc",
      },
    ],
  },

  prerequisites: [
    "A Ktor 3 server built with Gradle's Kotlin DSL and started with `embeddedServer` or `EngineMain`. These steps were checked with Ktor 3.6 and Kotlin 2.4 on Java 25.",
    SERVER_KEY_PREREQUISITE,
  ],

  install: {
    intro:
      "Add OpenTelemetry's SDK, its OTLP exporter and the instrumentations for Ktor, JDBC, Logback and the JVM. Two BOMs pick every version, the stable and the alpha libraries:",
    snippets: [buildDependencies],
    notes: [
      "The Ktor instrumentation is published as an alpha, with the version suffix `-alpha`: its BOM keeps it in step with the stable libraries.",
      "Rather add no code at all? Skip these and use the Java agent, the last step below.",
    ],
  },

  configure: {
    intro:
      "The SDK reads the standard OpenTelemetry variables when it starts, so the endpoint and the key stay out of your code and `application.conf`:",
    tabs: otlpEnvironmentTabs({
      serviceName: "checkout-api",
      extraLines: [OTLP_HTTP_PROTOCOL_LINE],
      cloudNote:
        "The SDK speaks gRPC unless told otherwise; OneUptime's `/otlp` endpoint takes OTLP over HTTP, which the last line asks for.",
    }),
    notes: [
      "The SDK adds `/v1/traces`, `/v1/metrics` and `/v1/logs` to the endpoint for each signal.",
    ],
  },

  setup: {
    intro:
      "Start the SDK before the server, then give Ktor's server, its client and your database a plugin or a wrapper each.",
    steps: [
      {
        title: "Start the SDK before the server",
        body: "One function sets the SDK up from the variables above, hands it to Logback's appender, and starts the JVM's metrics:",
        snippets: [telemetry],
        notes: [
          "`AutoConfiguredOpenTelemetrySdk` also registers a shutdown hook, which sends whatever is still buffered when the JVM stops.",
        ],
      },
      {
        title: "Install the server plugin",
        body: "Call it from `main`, and install `KtorServerTelemetry` before the other plugins of your module:",
        snippets: [application],
        notes: [
          "Using `EngineMain` and `application.conf`? Call `startOpenTelemetry()` at the top of the module the configuration names, and install the plugin with what it returns.",
        ],
      },
      {
        title: "Trace the calls your HttpClient makes",
        body: "Install `KtorClientTelemetry` in each client you build, and every request it sends is a client span that carries `traceparent`:",
        snippets: [httpClient],
      },
      {
        title: "Trace your SQL",
        body: "Wrap the `DataSource` your code connects through with `JdbcTelemetry`, and every statement is a span. With Exposed, connect through the wrapped one:",
        snippets: [jdbc],
        notes: [
          "Plain JDBC, HikariCP and jOOQ take the same wrapped `DataSource`.",
        ],
      },
      {
        title: "Send Logback's records",
        body: "Add OpenTelemetry's appender to `logback.xml`, next to your console appender, and reference it from the root logger:",
        snippets: [appender],
      },
      {
        title: "Build and run",
        body: "The Ktor Gradle plugin builds one jar with every dependency in it. Start it with the variables above:",
        snippets: [buildFatJar, run],
      },
      {
        title: "Or: no code, with the Java agent",
        body: "The Java agent traces a Ktor app with none of the steps above: routes, the Ktor client, JDBC and Logback. Leave the plugins and the wrapper out, download the agent and start the jar with it:",
        snippets: [agent, runWithAgent, agentApi, agentTelemetry],
        notes: [
          "For spans of your own, as in the next sections, the API and the agent's global instance are all your code needs.",
          "Use the agent or the plugins, never both: the agent installs the same server plugin itself, and Ktor refuses to start with it twice.",
        ],
      },
    ],
  },

  autoInstrumentation: {
    intro: "With the plugins and the wrapper in place, these are traced:",
    rows: [
      {
        library: "Ktor server (`KtorServerTelemetry`)",
        covers:
          "A server span per call named after its route (`GET /orders/{id}`), with `http.route`, the status and the exception that escaped a route.",
      },
      {
        library: "Ktor client (`KtorClientTelemetry`)",
        covers:
          "A client span per request (`POST`), with `traceparent` sent along so the service called joins the trace.",
      },
      {
        library: "JDBC, Exposed (`JdbcTelemetry`)",
        covers:
          "A span per statement, named after the operation and the table (`SELECT shop.PLACED_ORDER`), with the statement itself.",
      },
      {
        library: "Logback (`OpenTelemetryAppender`)",
        covers: "Every record, with the trace and span IDs of its coroutine.",
      },
      {
        library: "The JVM (`RuntimeTelemetry`)",
        covers:
          "Memory by pool, garbage collection, threads, classes and CPU, as metrics.",
      },
    ],
    snippets: [],
    notes: [
      "A statement that runs outside a call, such as creating a table at startup, is a trace of its own.",
    ],
  },

  manualSpans: {
    intro:
      "Open spans with the SDK's tracer, and carry them into the coroutine with `asContextElement()`, so calls made inside nest beneath them:",
    snippets: [paymentService],
    notes: [
      "`withContext(Context.current().with(span).asContextElement())` keeps the span current wherever the coroutine resumes. `span.makeCurrent()` does not: it sets the span on one thread, and code that resumes on another loses it.",
      "The server plugin carries each call's own span through its coroutines already: this is only for spans you open.",
      "In the **Traces** explorer, `@payment.method:card` lists the charges paid by card, each with its client call.",
    ],
  },

  logs: {
    intro:
      "With the appender in `logback.xml` and the SDK handed to it, every record goes to OneUptime with the trace and span IDs of the call that wrote it.",
    snippets: [],
    notes: [
      "Ktor writes its `Unhandled: GET - /boom` record for a failed call outside the call's trace, so that record has no trace ID: the call's span holds the same exception.",
      "Records written before `startOpenTelemetry()` runs are held, and sent once the appender has the SDK.",
      "Logback's levels decide which records are written, and so which are sent.",
    ],
  },

  metrics: {
    intro: "Exported every 60 seconds:",
    builtIn: [
      {
        name: "http.server.request.duration",
        description:
          "Each call's duration by route, method and status code: a route's latency and error rate.",
      },
      {
        name: "http.client.request.duration",
        description:
          "Each request the Ktor client sends, by server and status.",
      },
      {
        name: "jvm.memory.used",
        description:
          "Heap and non-heap memory by pool, beside `jvm.gc.duration` and `jvm.thread.count`.",
      },
      {
        name: "jvm.cpu.recent_utilization",
        description: "The share of CPU the JVM used lately, from 0 to 1.",
      },
    ],
    snippets: [],
    notes: [
      "Your own instruments come from `openTelemetry.getMeter`, as `orders.placed` in `PaymentService` above.",
      "The SDK reports on itself too: `processedSpans` and `queueSize` show whether spans are dropped before they are sent.",
    ],
  },

  sampling: {
    intro:
      "Every call is traced by default, health checks included: the server plugin has no list of paths to leave out. Keep a share of new traces with the standard variables, and drop health checks with a sampler of your own:",
    snippets: [samplingEnvironment, skipHealthChecks, samplerSetup],
    notes: [
      "`parentbased_traceidratio` keeps a quarter of new traces, and follows the caller's decision for calls that arrive with a `traceparent` header.",
      "`SkipHealthChecks` wraps whatever sampler the variables configure, so both apply: build the SDK with it in `startOpenTelemetry`, as the last snippet shows.",
      "Prefer no code? Drop those spans as they arrive with a [drop filter](/docs/telemetry/drop-filters-and-scrub-rules) in OneUptime.",
    ],
  },

  deploy: {
    intro:
      "Copy the fat jar into a Java 25 image and pass the variables at run time; keep the key in a Kubernetes Secret:",
    snippets: [
      jvmDockerfileSnippet({
        jar: "build/libs/checkout-all.jar",
        port: 8080,
        withAgent: false,
      }),
      kubernetesManifestSnippet({
        name: "checkout-api",
        image: "registry.example.com/checkout-api:3.6.0",
        containerPort: 8080,
      }),
    ],
    notes: [
      "Kubernetes stops a pod with SIGTERM: the JVM runs the SDK's shutdown hook, which sends what it still holds, before the container exits.",
      "Using the Java agent instead? Set `JAVA_TOOL_OPTIONS=-javaagent:...` in the image, as the [Java](/integrations/opentelemetry/java) guide shows.",
    ],
  },

  verify: {
    intro: "Check in this order: each step rules out one cause.",
    steps: [
      validateKeyStep("server"),
      {
        title: "Find the service",
        body: `Call a route, then open ${SCREENS.services}: \`checkout-api\` is listed within a minute. Nothing? Check that the protocol variable is \`http/protobuf\`.`,
      },
      {
        title: "See the coroutine keep its trace",
        body: `In ${SCREENS.traces}, open a \`POST /orders\` trace: the client's \`POST\` sits beneath \`checkout.charge\`, not beside it.`,
      },
      {
        title: "Open the logs of one call",
        body: `In ${SCREENS.logs}, the \`loading order 42\` record carries the trace ID of the \`GET /orders/{id}\` call that wrote it.`,
      },
    ],
  },

  troubleshooting: [
    {
      question:
        "Nothing arrives, and the app logs “Failed to export 2 spans. The request could not be executed.”",
      answer:
        "The SDK is speaking gRPC to an endpoint that takes HTTP. Set `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf`, and check that `OTEL_EXPORTER_OTLP_ENDPOINT` ends in `/otlp`.",
    },
    {
      question: "My client calls land under the request, not under my span",
      answer:
        "The span was made current with `makeCurrent()`, which holds it on one thread; after a `withContext(Dispatchers.IO)` or a suspension, the code runs elsewhere without it. Carry it with `withContext(Context.current().with(span).asContextElement())`, as `PaymentService` does.",
    },
    {
      question:
        "The app will not start: “DuplicatePluginException … `OpenTelemetry`”",
      answer:
        "The Java agent is loaded too, and it installs the server plugin itself before your module does. Keep one: remove `-javaagent` (or `JAVA_TOOL_OPTIONS`), or take the plugins and the `JdbcTelemetry` wrapper out.",
    },
    {
      question: "Health checks fill my traces",
      answer:
        "The server plugin traces every path. Build the SDK with the `SkipHealthChecks` sampler from the sampling section, or drop those spans in OneUptime with a drop filter.",
    },
    {
      question: "The “Unhandled” error record has no trace ID",
      answer:
        "Ktor writes it outside the call's trace. Open the call's trace instead: its span carries the same exception, with the stack trace. Under the Java agent, the record carries the trace ID too.",
    },
    {
      question: "The exporter logs a 401",
      answer:
        "OneUptime refused the key: `OTEL_EXPORTER_OTLP_HEADERS` must be `x-oneuptime-token=` followed by a **Server** key's **Secret Key**.",
    },
  ],

  faq: [
    {
      question: "Should I use the Ktor plugins or the Java agent?",
      answer:
        "The plugins, when you want to see what is traced in your own code, without a `-javaagent` flag, and with each failed call's exception on its span. The agent, when you want no code at all, or the many libraries it traces by itself, such as Redis and Kafka clients.",
    },
    {
      question: "Does this work with Ktor 2?",
      answer:
        "Yes, with `opentelemetry-ktor-2.0` in place of `opentelemetry-ktor-3.0`: the same two plugins, imported from `io.opentelemetry.instrumentation.ktor.v2_0`. This guide was checked with Ktor 3.6.",
    },
    {
      question: "Do coroutines need anything else?",
      answer:
        "Only spans you open yourself, carried with `asContextElement()`. The server plugin carries each call's span through the call's coroutines, and the client plugin reads it from there.",
    },
    {
      question: "Which Ktor engines and client engines does this cover?",
      answer:
        "All of them. The server plugin hooks into Ktor's pipeline, not the engine, so Netty, CIO, Jetty and Tomcat are traced alike; the client plugin works the same with CIO, OkHttp, Apache or Java. This guide ran on Netty with the CIO client.",
    },
  ],

  related: ["java", "spring-boot", "quarkus", "micronaut"],
  docs: [DOCS.openTelemetry, DOCS.traces, DOCS.logs, DOCS.metrics],

  verification: {
    runtime: "jvm",
    framework: { name: "Ktor", package: "io.ktor:ktor-server-core" },
    files: sourceFiles("plugins"),
    stubApiPort: 9000,
    commands: [
      { command: "gradle --no-daemon -q buildFatJar" },
      { snippet: "run", isServer: true },
    ],
    port: 8080,
    requests: requests,
    expect: {
      spans: [
        {
          name: "GET /orders/{id}",
          attributes: { "http.route": "/orders/{id}" },
        },
        {
          name: "SELECT shop.PLACED_ORDER",
          attributes: { "db.system": "h2" },
          parent: "GET /orders/{id}",
        },
        {
          name: "checkout.charge",
          attributes: { "payment.method": "card", "order.item_count": "2" },
          parent: "POST /orders",
        },
        {
          name: "POST",
          attributes: { "http.request.method": "POST" },
          parent: "checkout.charge",
        },
        { name: "INSERT shop.PLACED_ORDER", parent: "POST /orders" },
        {
          name: "GET /boom",
          hasException: true,
          exceptionMessage: "Payment provider timed out",
        },
      ],
      metrics: [
        "http.server.request.duration",
        "http.client.request.duration",
        "jvm.memory.used",
        "jvm.gc.duration",
        "jvm.thread.count",
        "jvm.cpu.recent_utilization",
        "orders.placed",
      ],
      logs: [
        { body: "loading order 42", hasTraceContext: true },
        {
          body: "Unhandled: GET - /boom",
          hasTraceContext: false,
          hasException: true,
        },
      ],
      resource: { "service.name": "checkout-api" },
    },
    variants: [
      {
        // The sampling section's health-check sampler, built in.
        name: "Health checks left out",
        files: [
          ...sourceFiles("sampler"),
          {
            path: `${source}SkipHealthChecks.kt`,
            snippet: "skip-health-checks",
          },
        ],
        stubApiPort: 9000,
        commands: [
          { command: "gradle --no-daemon -q buildFatJar" },
          { snippet: "run", isServer: true },
        ],
        port: 8080,
        requests: requests,
        expect: {
          spans: [
            {
              name: "GET /orders/{id}",
              attributes: { "http.route": "/orders/{id}" },
            },
            { name: "checkout.charge", parent: "POST /orders" },
          ],
          metrics: ["http.server.request.duration"],
          logs: [{ body: "loading order 42", hasTraceContext: true }],
          untracedPaths: ["/healthz"],
        },
      },
      {
        // The last step: the same app with no plugins, under the Java agent.
        name: "Java agent",
        files: sourceFiles("agent"),
        stubApiPort: 9000,
        commands: [
          { snippet: "agent" },
          { command: "gradle --no-daemon -q buildFatJar" },
          { snippet: "run-agent", isServer: true },
        ],
        port: 8080,
        requests: requests,
        expect: {
          spans: [
            {
              name: "GET /orders/{id}",
              attributes: { "http.route": "/orders/{id}" },
            },
            { name: "SELECT shop.PLACED_ORDER", parent: "GET /orders/{id}" },
            { name: "checkout.charge", parent: "POST /orders" },
            { name: "POST", parent: "checkout.charge" },
          ],
          metrics: ["http.server.request.duration", "jvm.memory.used"],
          logs: [
            { body: "loading order 42", hasTraceContext: true },
            {
              body: "Unhandled: GET - /boom",
              hasTraceContext: true,
              hasException: true,
            },
          ],
          resource: { "service.name": "checkout-api" },
        },
      },
    ],
  },
};
