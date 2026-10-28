import {
  OpenTelemetryGuide,
  GuideSnippet,
  VerificationFile,
} from "../GuideTypes";
import {
  DOCS,
  SCREENS,
  SERVER_KEY_PREREQUISITE,
  kubernetesManifestSnippet,
  otlpEnvironmentTabs,
  validateKeyStep,
} from "../GuideShared";
import { jvmDockerfileSnippet } from "../JvmShared";

const mavenDependencies: GuideSnippet = {
  id: "maven-dependencies",
  language: "xml",
  title: "pom.xml",
  code: [
    "<dependency>",
    "  <groupId>io.micronaut.tracing</groupId>",
    "  <artifactId>micronaut-tracing-opentelemetry-http</artifactId>",
    "</dependency>",
    "<dependency>",
    "  <groupId>io.micronaut.tracing</groupId>",
    "  <artifactId>micronaut-tracing-opentelemetry-jdbc</artifactId>",
    "</dependency>",
    "<dependency>",
    "  <groupId>io.opentelemetry</groupId>",
    "  <artifactId>opentelemetry-exporter-otlp</artifactId>",
    "</dependency>",
    "<dependency>",
    "  <groupId>io.opentelemetry.instrumentation</groupId>",
    "  <artifactId>opentelemetry-logback-appender-1.0</artifactId>",
    "</dependency>",
  ].join("\n"),
  check: "contained",
};

const gradleDependencies: GuideSnippet = {
  id: "gradle-dependencies",
  language: "kotlin",
  title: "build.gradle.kts",
  code: [
    "dependencies {",
    '    implementation("io.micronaut.tracing:micronaut-tracing-opentelemetry-http")',
    '    implementation("io.micronaut.tracing:micronaut-tracing-opentelemetry-jdbc")',
    '    implementation("io.opentelemetry:opentelemetry-exporter-otlp")',
    '    implementation("io.opentelemetry.instrumentation:opentelemetry-logback-appender-1.0")',
    "}",
  ].join("\n"),
  check: "parse",
};

const properties: GuideSnippet = {
  id: "properties",
  language: "properties",
  title: "application.properties",
  code: [
    "# Micronaut turns every exporter off unless told otherwise.",
    "otel.traces.exporter=otlp",
    "otel.metrics.exporter=otlp",
    "otel.logs.exporter=otlp",
    "# OneUptime takes OTLP over HTTP; the SDK sends gRPC by default.",
    "otel.exporter.otlp.protocol=http/protobuf",
    "# Leave the health endpoint out of your traces.",
    "otel.exclusions[0]=/health.*",
  ].join("\n"),
  check: "contained",
};

const appenderLine: GuideSnippet = {
  id: "appender",
  language: "xml",
  title: "logback.xml",
  code: '<appender name="OpenTelemetry" class="io.opentelemetry.instrumentation.logback.appender.v1_0.OpenTelemetryAppender"/>',
  check: "contained",
};

const logsBean: GuideSnippet = {
  id: "logs-bean",
  language: "java",
  title: "LogsToOpenTelemetry.java",
  code: [
    "package com.example.checkout;",
    "",
    "import io.micronaut.context.event.StartupEvent;",
    "import io.micronaut.runtime.event.annotation.EventListener;",
    "import io.opentelemetry.api.OpenTelemetry;",
    "import io.opentelemetry.instrumentation.logback.appender.v1_0.OpenTelemetryAppender;",
    "import jakarta.inject.Singleton;",
    "",
    "// Hands the Logback appender the SDK Micronaut built, once it exists.",
    "@Singleton",
    "class LogsToOpenTelemetry {",
    "  private final OpenTelemetry openTelemetry;",
    "",
    "  LogsToOpenTelemetry(OpenTelemetry openTelemetry) {",
    "    this.openTelemetry = openTelemetry;",
    "  }",
    "",
    "  @EventListener",
    "  void onStartup(StartupEvent event) {",
    "    OpenTelemetryAppender.install(openTelemetry);",
    "  }",
    "}",
  ].join("\n"),
  check: "run",
};

const paymentService: GuideSnippet = {
  id: "payment-service",
  language: "java",
  title: "PaymentService.java",
  code: [
    "package com.example.checkout;",
    "",
    "import io.opentelemetry.api.OpenTelemetry;",
    "import io.opentelemetry.api.common.AttributeKey;",
    "import io.opentelemetry.api.common.Attributes;",
    "import io.opentelemetry.api.metrics.LongCounter;",
    "import io.opentelemetry.api.trace.Span;",
    "import io.opentelemetry.api.trace.StatusCode;",
    "import io.opentelemetry.api.trace.Tracer;",
    "import io.opentelemetry.context.Scope;",
    "import jakarta.inject.Singleton;",
    "import java.util.Map;",
    "",
    "@Singleton",
    "class PaymentService {",
    "  private final PaymentsApi payments;",
    "  private final Tracer tracer;",
    "  private final LongCounter ordersPlaced;",
    "",
    "  // Micronaut registers no global instance: take the SDK it built as a bean.",
    "  PaymentService(PaymentsApi payments, OpenTelemetry openTelemetry) {",
    "    this.payments = payments;",
    '    this.tracer = openTelemetry.getTracer("checkout");',
    "    this.ordersPlaced =",
    '        openTelemetry.getMeter("checkout").counterBuilder("orders.placed").build();',
    "  }",
    "",
    "  void charge(String paymentMethod, int itemCount) {",
    "    Span span =",
    "        tracer",
    '            .spanBuilder("checkout.charge")',
    '            .setAttribute("payment.method", paymentMethod)',
    '            .setAttribute("order.item_count", itemCount)',
    "            .startSpan();",
    "    try (Scope scope = span.makeCurrent()) {",
    '      payments.charge(Map.of("items", itemCount));',
    '      ordersPlaced.add(1, Attributes.of(AttributeKey.stringKey("payment.method"), paymentMethod));',
    "    } catch (RuntimeException error) {",
    "      span.recordException(error);",
    "      span.setStatus(StatusCode.ERROR);",
    "      throw error;",
    "    } finally {",
    "      span.end();",
    "    }",
    "  }",
    "}",
  ].join("\n"),
  check: "run",
};

const build: GuideSnippet = {
  id: "build",
  language: "bash",
  code: "./mvnw package",
  check: "parse",
};

const run: GuideSnippet = {
  id: "run",
  language: "bash",
  code: "java -jar target/checkout-0.1.jar",
  check: "run",
};

const sampling: GuideSnippet = {
  id: "sampling",
  language: "properties",
  title: "application.properties",
  code: [
    "otel.traces.sampler=parentbased_traceidratio",
    "otel.traces.sampler.arg=0.25",
  ].join("\n"),
  check: "parse",
};

/*
 * The app the end-to-end check builds: what Micronaut Launch generates for
 * Micronaut 5.2 with Data JDBC, Hikari, H2, the JDK HTTP client and the
 * management endpoints, plus the page's fragments word for word.
 */
const pomFile: string = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
  '         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">',
  "  <modelVersion>4.0.0</modelVersion>",
  "  <groupId>com.example</groupId>",
  "  <artifactId>checkout</artifactId>",
  "  <version>0.1</version>",
  "  <packaging>jar</packaging>",
  "  <parent>",
  "    <groupId>io.micronaut.platform</groupId>",
  "    <artifactId>micronaut-parent</artifactId>",
  "    <version>5.2.4</version>",
  "  </parent>",
  "  <properties>",
  "    <packaging>jar</packaging>",
  "    <jdk.version>25</jdk.version>",
  "    <release.version>25</release.version>",
  "    <micronaut.version>5.2.4</micronaut.version>",
  "    <micronaut.runtime>netty</micronaut.runtime>",
  "    <micronaut.aot.enabled>false</micronaut.aot.enabled>",
  "    <exec.mainClass>com.example.checkout.Application</exec.mainClass>",
  "  </properties>",
  "  <dependencies>",
  mavenDependencies.code,
  ...[
    ["io.micronaut", "micronaut-http-client-jdk", "compile"],
    ["io.micronaut", "micronaut-http-server-netty", "compile"],
    ["io.micronaut", "micronaut-management", "compile"],
    ["io.micronaut.data", "micronaut-data-jdbc", "compile"],
    ["io.micronaut.serde", "micronaut-serde-jackson", "compile"],
    ["io.micronaut.sql", "micronaut-jdbc-hikari", "compile"],
    ["ch.qos.logback", "logback-classic", "compile"],
    ["com.h2database", "h2", "runtime"],
  ].flatMap(([group, artifact, scope]: Array<string>): Array<string> => {
    return [
      "    <dependency>",
      `      <groupId>${group}</groupId>`,
      `      <artifactId>${artifact}</artifactId>`,
      `      <scope>${scope}</scope>`,
      "    </dependency>",
    ];
  }),
  "  </dependencies>",
  "  <build>",
  "    <plugins>",
  "      <plugin>",
  "        <groupId>io.micronaut.maven</groupId>",
  "        <artifactId>micronaut-maven-plugin</artifactId>",
  "      </plugin>",
  "      <plugin>",
  "        <groupId>org.apache.maven.plugins</groupId>",
  "        <artifactId>maven-compiler-plugin</artifactId>",
  "        <configuration>",
  '          <annotationProcessorPaths combine.self="override">',
  "            <path>",
  "              <groupId>io.micronaut</groupId>",
  "              <artifactId>micronaut-inject-java</artifactId>",
  "              <version>${micronaut.core.version}</version>",
  "            </path>",
  "            <path>",
  "              <groupId>io.micronaut.data</groupId>",
  "              <artifactId>micronaut-data-processor</artifactId>",
  "              <version>${micronaut.data.version}</version>",
  "            </path>",
  "            <path>",
  "              <groupId>io.micronaut.serde</groupId>",
  "              <artifactId>micronaut-serde-processor</artifactId>",
  "              <version>${micronaut.serialization.version}</version>",
  "            </path>",
  "          </annotationProcessorPaths>",
  "        </configuration>",
  "      </plugin>",
  "    </plugins>",
  "  </build>",
  "</project>",
].join("\n");

const source: string = "src/main/java/com/example/checkout/";

const appFiles: Array<VerificationFile> = [
  {
    path: `${source}Application.java`,
    content: [
      "package com.example.checkout;",
      "",
      "import io.micronaut.runtime.Micronaut;",
      "",
      "public class Application {",
      "  public static void main(String[] args) {",
      "    Micronaut.run(Application.class, args);",
      "  }",
      "}",
    ].join("\n"),
  },
  {
    path: `${source}OrderController.java`,
    content: [
      "package com.example.checkout;",
      "",
      "import io.micronaut.data.annotation.GeneratedValue;",
      "import io.micronaut.data.annotation.Id;",
      "import io.micronaut.data.annotation.MappedEntity;",
      "import io.micronaut.data.jdbc.annotation.JdbcRepository;",
      "import io.micronaut.data.model.query.builder.sql.Dialect;",
      "import io.micronaut.data.repository.CrudRepository;",
      "import io.micronaut.http.HttpResponse;",
      "import io.micronaut.http.annotation.Body;",
      "import io.micronaut.http.annotation.Controller;",
      "import io.micronaut.http.annotation.Get;",
      "import io.micronaut.http.annotation.Post;",
      "import io.micronaut.http.client.annotation.Client;",
      "import io.micronaut.scheduling.TaskExecutors;",
      "import io.micronaut.scheduling.annotation.ExecuteOn;",
      "import io.micronaut.serde.annotation.Serdeable;",
      "import java.util.List;",
      "import java.util.Map;",
      "import org.slf4j.Logger;",
      "import org.slf4j.LoggerFactory;",
      "",
      '@Controller("/orders")',
      "@ExecuteOn(TaskExecutors.BLOCKING)",
      "class OrderController {",
      "  private static final Logger logger = LoggerFactory.getLogger(OrderController.class);",
      "",
      "  private final OrderRepository orders;",
      "  private final PaymentService payments;",
      "",
      "  OrderController(OrderRepository orders, PaymentService payments) {",
      "    this.orders = orders;",
      "    this.payments = payments;",
      "  }",
      "",
      '  @Get("/{id}")',
      "  Map<String, Object> order(long id) {",
      '    logger.info("loading order {}", id);',
      '    return Map.of("id", id, "found", orders.findById(id).isPresent());',
      "  }",
      "",
      "  @Post",
      "  HttpResponse<Map<String, Object>> place(@Body NewOrder order) {",
      "    payments.charge(order.paymentMethod(), order.items().size());",
      "    PlacedOrder saved = orders.save(new PlacedOrder(null, order.items().size()));",
      '    return HttpResponse.created(Map.of("id", saved.id()));',
      "  }",
      "",
      '  @Get("/boom")',
      "  String boom() {",
      '    throw new IllegalStateException("Payment provider timed out");',
      "  }",
      "",
      "  @Serdeable",
      "  record NewOrder(List<String> items, String paymentMethod) {}",
      "}",
      "",
      "@MappedEntity",
      "record PlacedOrder(@Id @GeneratedValue Long id, int itemCount) {}",
      "",
      "@JdbcRepository(dialect = Dialect.H2)",
      "interface OrderRepository extends CrudRepository<PlacedOrder, Long> {}",
      "",
      '@Client(id = "payments")',
      "interface PaymentsApi {",
      '  @Post("/api/charges")',
      "  Map<String, Object> charge(@Body Map<String, Object> charge);",
      "}",
    ].join("\n"),
  },
  { path: `${source}PaymentService.java`, snippet: "payment-service" },
  { path: `${source}LogsToOpenTelemetry.java`, snippet: "logs-bean" },
  {
    path: "src/main/resources/application.properties",
    content: [
      "micronaut.application.name=checkout",
      "datasources.default.url=jdbc:h2:mem:shop;LOCK_TIMEOUT=10000;DB_CLOSE_ON_EXIT=FALSE",
      "datasources.default.username=sa",
      "datasources.default.password=",
      "datasources.default.dialect=H2",
      "datasources.default.driver-class-name=org.h2.Driver",
      "datasources.default.schema-generate=CREATE_DROP",
      "micronaut.http.services.payments.url=${PAYMENTS_API_URL:`http://localhost:9000`}",
      properties.code,
    ].join("\n"),
  },
  {
    path: "src/main/resources/logback.xml",
    content: [
      "<configuration>",
      '  <appender name="STDOUT" class="ch.qos.logback.core.ConsoleAppender">',
      "    <encoder>",
      "      <pattern>%d{HH:mm:ss.SSS} [%thread] %-5level %logger{36} - %msg%n</pattern>",
      "    </encoder>",
      "  </appender>",
      `  ${appenderLine.code}`,
      '  <root level="info">',
      '    <appender-ref ref="STDOUT"/>',
      '    <appender-ref ref="OpenTelemetry"/>',
      "  </root>",
      "</configuration>",
    ].join("\n"),
  },
];

export const MicronautGuide: OpenTelemetryGuide = {
  slug: "micronaut",
  seo: {
    title: "Micronaut OpenTelemetry: Tracing, Metrics & Logs | OneUptime",
    description:
      "Set up Micronaut's OpenTelemetry modules for OneUptime: routes, HTTP client calls, JDBC, metrics and Logback logs, with the exporters Micronaut leaves off.",
  },
  h1: "OpenTelemetry for Micronaut",
  lead: "Trace every Micronaut route with its HTTP client calls and SQL, and send the traces, metrics and logs to OneUptime with Micronaut's own OpenTelemetry modules. Micronaut turns every exporter off until told otherwise: here is everything to switch on, and why.",
  cardDescription:
    "Micronaut's tracing modules: routes, HTTP client calls, JDBC, metrics and Logback logs, exporters switched on.",
  searchTerms: [
    "micronaut-tracing",
    "netty",
    "micronaut data",
    "jdbc",
    "logback",
    "graalvm",
  ],
  highlights: ["Micronaut's own modules", "Micronaut 5", "JVM and native"],

  whatYouGet: {
    intro: `With the tracing modules and the settings below, a Micronaut app reports as one service, \`checkout-api\` here, listed in ${SCREENS.services} from its first request.`,
    traces:
      "A server span per request named after its route, such as `GET /orders/{id}`, a client span per call your declarative clients make, a span per JDBC statement, and the spans you open with the OpenTelemetry API.",
    metrics:
      "`http.server.request.duration` by route and `http.client.request.duration` for outgoing calls, beside the instruments you create, once the metrics exporter is on.",
    logs: "Logback records with the trace and span IDs of their request, once Logback's OpenTelemetry appender is installed with the SDK Micronaut built.",
    exceptions: `An exception that escapes a route is recorded on its request's span, and Micronaut's \`Unexpected error occurred\` record carries the stack trace. ${SCREENS.exceptions} groups them.`,
  },

  exampleTrace: {
    caption: "A POST /orders request, as its trace shows it",
    spans: [
      {
        name: "POST /orders",
        depth: 0,
        start: 0,
        duration: 100,
        source: "micronaut",
      },
      {
        name: "checkout.charge",
        depth: 1,
        start: 4,
        duration: 72,
        source: "your code",
      },
      {
        name: "POST",
        depth: 2,
        start: 8,
        duration: 64,
        source: "http-client",
      },
      {
        name: "INSERT shop.placed_order",
        depth: 1,
        start: 80,
        duration: 12,
        source: "jdbc",
      },
    ],
  },

  prerequisites: [
    "Java 21 or later, which Micronaut 5 needs. These steps were checked with Micronaut 5.2 on Java 25.",
    "A Micronaut app built with Maven or Gradle, whose platform BOM manages the versions of the modules below.",
    SERVER_KEY_PREREQUISITE,
  ],

  install: {
    intro:
      "Micronaut's tracing modules trace its HTTP server and clients and JDBC; the OTLP exporter sends, and Logback's appender carries the logs. The Micronaut platform's BOM picks every version:",
    snippets: [],
    tabs: {
      group: "buildTool",
      tabs: [
        { label: "Maven", snippets: [mavenDependencies] },
        { label: "Gradle", snippets: [gradleDependencies] },
      ],
    },
    notes: [
      "Leave the versions to the BOM. Micronaut 5.2 pins OpenTelemetry 1.64 and its instrumentation 2.30: a newer appender fails at startup with `NoClassDefFoundError: io/opentelemetry/instrumentation/api/config/IncludeExclude`.",
      "Micronaut Launch's `tracing-opentelemetry-exporter-otlp` feature adds only the exporter: add the tracing modules yourself, as here.",
    ],
  },

  configure: {
    intro:
      "The SDK Micronaut builds reads the standard OpenTelemetry variables for the endpoint, the key and the service name:",
    tabs: otlpEnvironmentTabs({
      serviceName: "checkout-api",
      cloudNote:
        "Without `OTEL_SERVICE_NAME`, the service takes `micronaut.application.name`.",
    }),
    notes: [
      "Everything else goes in `application.properties`, in the next step, so it travels with the app.",
    ],
  },

  setup: {
    intro:
      "With the modules in your build, switch the exporters on and give Logback its appender. Micronaut builds and owns the SDK; your code takes it as a bean.",
    steps: [
      {
        title: "Switch the exporters on",
        body: "Micronaut sets traces, metrics and logs to `none` unless your configuration names an exporter, and the SDK sends gRPC unless told otherwise:",
        snippets: [properties],
        notes: [
          "`otel.exclusions` takes regular expressions matched against the path: here, the management endpoint's health checks.",
        ],
      },
      {
        title: "Give Logback the SDK",
        body: "Add the OpenTelemetry appender to `logback.xml`, beside your own appenders, and hand it Micronaut's SDK once the app has started:",
        snippets: [appenderLine, logsBean],
        notes: [
          "Records written before the app has started, such as Hikari's pool starting, are held and sent once the appender has its SDK.",
        ],
      },
      {
        title: "Build and run",
        body: "Package the app and start it with the variables above:",
        snippets: [build, run],
      },
    ],
  },

  autoInstrumentation: {
    intro: "With the modules above, Micronaut traces:",
    rows: [
      {
        library: "Micronaut HTTP server",
        covers:
          "A server span per request named after its route (`GET /orders/{id}`), with `http.route` and the exception a route threw.",
      },
      {
        library: "Declarative and low-level HTTP clients",
        covers:
          "A client span per call, carrying `traceparent` to the service called.",
      },
      {
        library: "JDBC, Micronaut Data",
        covers:
          "A span per statement (`SELECT shop.placed_order`), through `micronaut-tracing-opentelemetry-jdbc`.",
      },
      {
        library: "Kafka, gRPC, R2DBC",
        covers:
          "Spans for messages, calls and reactive queries, with Micronaut's modules of the same names: `micronaut-tracing-opentelemetry-kafka`, `-grpc`, `-r2dbc`.",
      },
    ],
    snippets: [],
    notes: [
      "Micronaut's modules know its routes. The OpenTelemetry Java agent does not: under it, Micronaut's Netty server spans are named `GET` and `POST`, with no route.",
    ],
  },

  manualSpans: {
    intro:
      "Take the SDK Micronaut built as a bean and open spans with its tracer. The client call made inside the span nests beneath it:",
    snippets: [paymentService],
    notes: [
      "Micronaut registers no global instance, so `GlobalOpenTelemetry` hands out no-op tracers and meters here: inject `OpenTelemetry` instead.",
      "Micronaut's `@NewSpan` and OpenTelemetry's `@WithSpan` work too, with `micronaut-tracing-opentelemetry-annotation` on the compiler's annotation processor path, but the span is named `PaymentService.charge#checkout.charge`: class and method first.",
      "In the **Traces** explorer, `@payment.method:card` finds every charge paid by card.",
    ],
  },

  logs: {
    intro:
      "With the appender installed, every Logback record goes to OneUptime with the trace and span of its request, and your console appender keeps writing as before.",
    snippets: [],
    notes: [
      "`logback-classic` must be on the compile classpath for the bean above. Micronaut Launch adds it at runtime scope: change it to `compile`.",
      'Pass an exception as the last argument, `logger.error("payment failed", error)`, to send its type, message and stack trace, which files the record under **Exceptions**.',
    ],
  },

  metrics: {
    intro:
      "Once `otel.metrics.exporter=otlp` is set, exported every 60 seconds:",
    builtIn: [
      {
        name: "http.server.request.duration",
        description:
          "Each request's duration by route, method and status code.",
      },
      {
        name: "http.client.request.duration",
        description: "Each outgoing call's duration, by server and status.",
      },
    ],
    snippets: [],
    notes: [
      "Custom instruments come from the injected `OpenTelemetry`, as `orders.placed` above.",
      "For JVM metrics too, add Micronaut's Micrometer module with its OTLP registry, pointed at the same endpoint and key.",
    ],
  },

  sampling: {
    intro:
      "Every request is traced by default. On a busy service, keep a share of new traces:",
    snippets: [sampling],
    notes: [
      "A request that carries a `traceparent` header follows its caller's decision.",
      "Metrics and logs are not sampled.",
    ],
  },

  deploy: {
    intro:
      "The build makes one runnable jar: put it in a Java 25 image and pass the variables at run time:",
    snippets: [
      jvmDockerfileSnippet({
        jar: "target/checkout-0.1.jar",
        port: 8080,
        withAgent: false,
      }),
      kubernetesManifestSnippet({
        name: "checkout-api",
        image: "registry.example.com/checkout-api:5.2.0",
        containerPort: 8080,
      }),
    ],
    notes: [
      "A native executable built with GraalVM keeps the same modules, settings and variables.",
      "Micronaut shuts down on SIGTERM and closes the SDK, which sends what it still holds.",
    ],
  },

  verify: {
    intro: "Check in this order: each step rules out one cause.",
    steps: [
      validateKeyStep("server"),
      {
        title: "Find the service",
        body: `Send a request, then open ${SCREENS.services}: \`checkout-api\` is listed within a minute.`,
      },
      {
        title: "Open a request's trace",
        body: `In ${SCREENS.traces}, search \`checkout.charge\`: the payment call sits beneath it, and the \`INSERT\` beside it.`,
      },
      {
        title: "Follow a log line to its request",
        body: `In ${SCREENS.logs}, find the \`loading order 42\` record the request wrote, and open its trace from the trace ID beside it.`,
      },
    ],
  },

  troubleshooting: [
    {
      question: "Only traces arrive, no metrics or logs",
      answer:
        "Micronaut sets every exporter to `none` by default. Set `otel.metrics.exporter=otlp` and `otel.logs.exporter=otlp`, and install the Logback appender as shown.",
    },
    {
      question:
        "The exporter logs “Failed to export spans … ConnectionShutdownException”",
      answer:
        "It is speaking gRPC to the HTTP endpoint. Set `otel.exporter.otlp.protocol=http/protobuf`.",
    },
    {
      question:
        "The app fails to start with “NoClassDefFoundError: …/IncludeExclude”",
      answer:
        "An OpenTelemetry library is newer than the instrumentation API the Micronaut platform pins. Remove its version and let the platform BOM choose it.",
    },
    {
      question: "My @WithSpan methods make no spans",
      answer:
        "The annotation processor never saw them: add `micronaut-tracing-opentelemetry-annotation` to the compiler's `annotationProcessorPaths`, and make the method public. Or open spans with the injected tracer, as above.",
    },
    {
      question: "Each failed request shows its exception twice",
      answer:
        "Micronaut's error handling records it a second time on the same span. OneUptime groups both events under one issue, so nothing is counted twice under **Exceptions**.",
    },
  ],

  faq: [
    {
      question:
        "Can I use the OpenTelemetry Java agent with Micronaut instead?",
      answer:
        "It runs, but it does not know Micronaut's routes: every server span is named after its method alone. Micronaut's modules give each span its route, and work in a native executable.",
    },
    {
      question: "Which Micronaut versions does this cover?",
      answer:
        "The settings are those of Micronaut 4 and 5, and this guide was checked with Micronaut 5.2 on Java 25.",
    },
    {
      question: "Why does the code take OpenTelemetry as a bean?",
      answer:
        "Micronaut builds the SDK from your configuration and keeps it out of `GlobalOpenTelemetry`, so the injected bean is the one wired to the exporters.",
    },
    {
      question: "Do I need an OpenTelemetry Collector?",
      answer:
        "No: the SDK sends straight to OneUptime. A Collector helps when you want one place to filter or batch what many services send: see [OpenTelemetry](/docs/telemetry/open-telemetry).",
    },
  ],

  related: ["java", "spring-boot", "quarkus", "ktor"],
  docs: [DOCS.openTelemetry, DOCS.traces, DOCS.logs, DOCS.exceptions],

  verification: {
    runtime: "jvm",
    framework: {
      name: "Micronaut",
      package: "io.micronaut:micronaut-http-server",
    },
    files: [{ path: "pom.xml", content: pomFile }, ...appFiles],
    stubApiPort: 9000,
    commands: [
      { command: "mvn -q -B package -DskipTests" },
      { snippet: "run", isServer: true },
    ],
    port: 8080,
    requests: [
      { method: "GET", path: "/health" },
      { method: "GET", path: "/orders/42" },
      {
        method: "POST",
        path: "/orders",
        body: { items: ["kettle", "mug"], paymentMethod: "card" },
      },
      { method: "GET", path: "/orders/boom" },
    ],
    expect: {
      spans: [
        {
          name: "GET /orders/{id}",
          attributes: { "http.route": "/orders/{id}" },
        },
        { name: "SELECT shop.placed_order" },
        {
          name: "checkout.charge",
          attributes: { "payment.method": "card", "order.item_count": "2" },
        },
        { name: "POST", attributes: { "http.request.method": "POST" } },
        { name: "INSERT shop.placed_order" },
        {
          name: "GET /orders/boom",
          hasException: true,
          exceptionMessage: "Payment provider timed out",
        },
      ],
      metrics: [
        "http.server.request.duration",
        "http.client.request.duration",
        "orders.placed",
      ],
      logs: [
        { body: "loading order 42", hasTraceContext: true },
        {
          body: "Unexpected error occurred",
          hasTraceContext: true,
          hasException: true,
        },
      ],
      resource: { "service.name": "checkout-api" },
      untracedPaths: ["/health"],
    },
  },
};
