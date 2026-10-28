import {
  OpenTelemetryGuide,
  GuideSnippet,
  VerificationFile,
} from "../GuideTypes";
import {
  DOCS,
  OtlpVariableNames,
  SCREENS,
  SERVER_KEY_PREREQUISITE,
  kubernetesManifestSnippet,
  otlpEnvironmentTabs,
  validateKeyStep,
} from "../GuideShared";

// Quarkus reads its own names for the exporter's settings, not OTEL_*.
const QUARKUS_VARIABLES: OtlpVariableNames = {
  endpoint: "QUARKUS_OTEL_EXPORTER_OTLP_ENDPOINT",
  headers: "QUARKUS_OTEL_EXPORTER_OTLP_HEADERS",
  serviceName: "QUARKUS_OTEL_SERVICE_NAME",
  resourceAttributes: "QUARKUS_OTEL_RESOURCE_ATTRIBUTES",
};

const addExtension: GuideSnippet = {
  id: "add-extension",
  language: "bash",
  code: './mvnw quarkus:add-extension -Dextensions="opentelemetry"',
  check: "parse",
};

const mavenExtension: GuideSnippet = {
  id: "maven-extension",
  language: "xml",
  title: "pom.xml",
  code: [
    "<dependency>",
    "  <groupId>io.quarkus</groupId>",
    "  <artifactId>quarkus-opentelemetry</artifactId>",
    "</dependency>",
  ].join("\n"),
  check: "contained",
};

const gradleExtension: GuideSnippet = {
  id: "gradle-extension",
  language: "kotlin",
  title: "build.gradle.kts",
  code: [
    "dependencies {",
    '    implementation("io.quarkus:quarkus-opentelemetry")',
    "}",
  ].join("\n"),
  check: "parse",
};

const buildProperties: GuideSnippet = {
  id: "build-properties",
  language: "properties",
  title: "application.properties",
  code: [
    "# Traces are on by default; metrics and logs need these two, at build time.",
    "quarkus.otel.metrics.enabled=true",
    "quarkus.otel.logs.enabled=true",
    "# OneUptime takes OTLP over HTTP; Quarkus sends gRPC unless told otherwise.",
    "quarkus.otel.exporter.otlp.protocol=http/protobuf",
    "# A span for every SQL statement, also decided at build time.",
    "quarkus.datasource.jdbc.telemetry=true",
  ].join("\n"),
  check: "contained",
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
  code: "java -jar target/quarkus-app/quarkus-run.jar",
  check: "run",
};

const paymentService: GuideSnippet = {
  id: "payment-service",
  language: "java",
  title: "PaymentService.java",
  code: [
    "package com.example.checkout;",
    "",
    "import io.opentelemetry.api.common.AttributeKey;",
    "import io.opentelemetry.api.common.Attributes;",
    "import io.opentelemetry.api.metrics.LongCounter;",
    "import io.opentelemetry.api.metrics.Meter;",
    "import io.opentelemetry.api.trace.Span;",
    "import io.opentelemetry.instrumentation.annotations.SpanAttribute;",
    "import io.opentelemetry.instrumentation.annotations.WithSpan;",
    "import jakarta.enterprise.context.ApplicationScoped;",
    "import java.util.Map;",
    "import org.eclipse.microprofile.rest.client.inject.RestClient;",
    "",
    "@ApplicationScoped",
    "public class PaymentService {",
    "  private final PaymentsApi payments;",
    "  private final LongCounter ordersPlaced;",
    "",
    "  PaymentService(@RestClient PaymentsApi payments, Meter meter) {",
    "    this.payments = payments;",
    "    this.ordersPlaced =",
    '        meter.counterBuilder("orders.placed").setDescription("Orders placed, by payment method").build();',
    "  }",
    "",
    '  @WithSpan("checkout.charge")',
    '  public void charge(@SpanAttribute("payment.method") String paymentMethod, int itemCount) {',
    '    Span.current().setAttribute("order.item_count", itemCount);',
    '    payments.charge(Map.of("items", itemCount));',
    '    ordersPlaced.add(1, Attributes.of(AttributeKey.stringKey("payment.method"), paymentMethod));',
    "  }",
    "}",
  ].join("\n"),
  check: "run",
};

const sampling: GuideSnippet = {
  id: "sampling",
  language: "properties",
  title: "application.properties",
  code: [
    "quarkus.otel.traces.sampler=parentbased_traceidratio",
    "quarkus.otel.traces.sampler.arg=0.25",
  ].join("\n"),
  check: "parse",
};

const dockerfile: GuideSnippet = {
  id: "dockerfile",
  language: "dockerfile",
  title: "Dockerfile",
  code: [
    "FROM eclipse-temurin:25-jre",
    "WORKDIR /app",
    "COPY target/quarkus-app/lib/ lib/",
    "COPY target/quarkus-app/*.jar ./",
    "COPY target/quarkus-app/app/ app/",
    "COPY target/quarkus-app/quarkus/ quarkus/",
    "EXPOSE 8080",
    'CMD ["java", "-jar", "quarkus-run.jar"]',
  ].join("\n"),
  check: "parse",
};

/*
 * The app the end-to-end check builds: what code.quarkus.io generates for
 * Quarkus 3.40 with REST, the REST client, Hibernate ORM with Panache, H2
 * and SmallRye Health, plus the page's fragments word for word.
 */
const pomFile: string = [
  '<?xml version="1.0"?>',
  '<project xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd" xmlns="http://maven.apache.org/POM/4.0.0"',
  '    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
  "  <modelVersion>4.0.0</modelVersion>",
  "  <groupId>com.example</groupId>",
  "  <artifactId>checkout</artifactId>",
  "  <version>1.0.0</version>",
  "  <properties>",
  "    <compiler-plugin.version>3.15.0</compiler-plugin.version>",
  "    <maven.compiler.release>25</maven.compiler.release>",
  "    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>",
  "    <quarkus.platform.artifact-id>quarkus-bom</quarkus.platform.artifact-id>",
  "    <quarkus.platform.group-id>io.quarkus.platform</quarkus.platform.group-id>",
  "    <quarkus.platform.version>3.40.1.1</quarkus.platform.version>",
  "  </properties>",
  "  <dependencyManagement>",
  "    <dependencies>",
  "      <dependency>",
  "        <groupId>${quarkus.platform.group-id}</groupId>",
  "        <artifactId>${quarkus.platform.artifact-id}</artifactId>",
  "        <version>${quarkus.platform.version}</version>",
  "        <type>pom</type>",
  "        <scope>import</scope>",
  "      </dependency>",
  "    </dependencies>",
  "  </dependencyManagement>",
  "  <dependencies>",
  mavenExtension.code,
  ...[
    "quarkus-rest-jackson",
    "quarkus-rest-client-jackson",
    "quarkus-hibernate-orm-panache",
    "quarkus-jdbc-h2",
    "quarkus-smallrye-health",
    "quarkus-arc",
  ].flatMap((artifact: string): Array<string> => {
    return [
      "    <dependency>",
      "      <groupId>io.quarkus</groupId>",
      `      <artifactId>${artifact}</artifactId>`,
      "    </dependency>",
    ];
  }),
  "  </dependencies>",
  "  <build>",
  "    <plugins>",
  "      <plugin>",
  "        <groupId>${quarkus.platform.group-id}</groupId>",
  "        <artifactId>quarkus-maven-plugin</artifactId>",
  "        <version>${quarkus.platform.version}</version>",
  "        <extensions>true</extensions>",
  "        <executions>",
  "          <execution>",
  "            <goals>",
  "              <goal>build</goal>",
  "              <goal>generate-code</goal>",
  "              <goal>generate-code-tests</goal>",
  "            </goals>",
  "          </execution>",
  "        </executions>",
  "      </plugin>",
  "      <plugin>",
  "        <artifactId>maven-compiler-plugin</artifactId>",
  "        <version>${compiler-plugin.version}</version>",
  "        <configuration>",
  "          <parameters>true</parameters>",
  "        </configuration>",
  "      </plugin>",
  "    </plugins>",
  "  </build>",
  "</project>",
].join("\n");

const source: string = "src/main/java/com/example/checkout/";

const appFiles: Array<VerificationFile> = [
  {
    path: `${source}OrderResource.java`,
    content: [
      "package com.example.checkout;",
      "",
      "import io.quarkus.hibernate.orm.panache.PanacheEntity;",
      "import jakarta.inject.Inject;",
      "import jakarta.persistence.Entity;",
      "import jakarta.transaction.Transactional;",
      "import jakarta.ws.rs.GET;",
      "import jakarta.ws.rs.POST;",
      "import jakarta.ws.rs.Path;",
      "import jakarta.ws.rs.PathParam;",
      "import jakarta.ws.rs.core.Response;",
      "import java.util.List;",
      "import java.util.Map;",
      "import org.jboss.logging.Logger;",
      "",
      '@Path("/orders")',
      "public class OrderResource {",
      "  private static final Logger log = Logger.getLogger(OrderResource.class);",
      "",
      "  @Inject PaymentService payments;",
      "",
      "  @GET",
      '  @Path("/{id}")',
      '  public Map<String, Object> order(@PathParam("id") long id) {',
      '    log.infof("loading order %d", id);',
      '    return Map.of("id", id, "found", PlacedOrder.findById(id) != null);',
      "  }",
      "",
      "  @POST",
      "  @Transactional",
      "  public Response place(NewOrder order) {",
      "    payments.charge(order.paymentMethod(), order.items().size());",
      "    PlacedOrder saved = new PlacedOrder();",
      "    saved.itemCount = order.items().size();",
      "    saved.persist();",
      '    return Response.status(201).entity(Map.of("id", saved.id)).build();',
      "  }",
      "",
      "  @GET",
      '  @Path("/boom")',
      "  public String boom() {",
      '    throw new IllegalStateException("Payment provider timed out");',
      "  }",
      "",
      "  public record NewOrder(List<String> items, String paymentMethod) {}",
      "}",
      "",
      "@Entity",
      "class PlacedOrder extends PanacheEntity {",
      "  public int itemCount;",
      "}",
    ].join("\n"),
  },
  {
    path: `${source}PaymentsApi.java`,
    content: [
      "package com.example.checkout;",
      "",
      "import jakarta.ws.rs.POST;",
      "import jakarta.ws.rs.Path;",
      "import java.util.Map;",
      "import org.eclipse.microprofile.rest.client.inject.RegisterRestClient;",
      "",
      '@Path("/api")',
      '@RegisterRestClient(configKey = "payments")',
      "public interface PaymentsApi {",
      "  @POST",
      '  @Path("/charges")',
      "  Map<String, Object> charge(Map<String, Object> charge);",
      "}",
    ].join("\n"),
  },
  { path: `${source}PaymentService.java`, snippet: "payment-service" },
  {
    path: "src/main/resources/application.properties",
    content: [
      "quarkus.datasource.db-kind=h2",
      "quarkus.datasource.jdbc.url=jdbc:h2:mem:shop",
      "quarkus.hibernate-orm.schema-management.strategy=drop-and-create",
      "quarkus.rest-client.payments.url=${PAYMENTS_API_URL:http://localhost:9000}",
      "",
      buildProperties.code,
    ].join("\n"),
  },
];

export const QuarkusGuide: OpenTelemetryGuide = {
  slug: "quarkus",
  seo: {
    title: "Quarkus OpenTelemetry: Tracing, Metrics & Logs | OneUptime",
    description:
      "Set up Quarkus's OpenTelemetry extension for OneUptime: REST endpoints, REST client calls, JDBC, metrics and logs, and the build-time switches they need.",
  },
  h1: "OpenTelemetry for Quarkus",
  lead: "Trace every Quarkus endpoint with its REST client calls and SQL, and send the traces, metrics and logs to OneUptime with Quarkus's own OpenTelemetry extension. One extension, four lines in `application.properties`, and three environment variables with Quarkus's names.",
  cardDescription:
    "Quarkus's OpenTelemetry extension: REST endpoints and clients, JDBC, metrics and logs, JVM or native.",
  searchTerms: [
    "quarkus-opentelemetry",
    "resteasy",
    "rest client",
    "panache",
    "hibernate",
    "graalvm",
    "native",
  ],
  highlights: ["Quarkus's own extension", "JVM and native", "Quarkus 3.40"],

  whatYouGet: {
    intro: `With the extension, a Quarkus app reports as one service, \`checkout-api\` below, listed in ${SCREENS.services} from its first request, in JVM mode or as a native executable.`,
    traces:
      "A server span per request named after the endpoint's path template, such as `GET /orders/{id}`, a client span per REST client call, the methods you annotate, and a span per SQL statement once JDBC telemetry is on.",
    metrics:
      "`http.server.request.duration` by route, the JVM's garbage collection, memory and CPU, and the instruments you create from the injected `Meter`, once metrics are on.",
    logs: "Every record written through JBoss Logging, the logger Quarkus and its extensions use, with the trace and span IDs of the request that wrote it, once logs are on.",
    exceptions: `An exception that escapes an endpoint is recorded on the request's span, and Quarkus's \`HTTP Request to ... failed, error id\` record carries the stack trace. ${SCREENS.exceptions} groups them.`,
  },

  exampleTrace: {
    caption: "A POST /orders request, as its trace shows it",
    spans: [
      {
        name: "POST /orders",
        depth: 0,
        start: 0,
        duration: 100,
        source: "quarkus",
      },
      {
        name: "checkout.charge",
        depth: 1,
        start: 5,
        duration: 70,
        source: "@WithSpan",
      },
      {
        name: "POST /api/charges",
        depth: 2,
        start: 9,
        duration: 61,
        source: "rest-client",
      },
      {
        name: "INSERT shop.PlacedOrder",
        depth: 1,
        start: 80,
        duration: 12,
        source: "jdbc",
      },
    ],
  },

  prerequisites: [
    "Java 17 or later, which Quarkus 3 needs. These steps were checked with Quarkus 3.40 on Java 25.",
    "A Quarkus app built with Maven or Gradle, run as a jar or a native executable.",
    SERVER_KEY_PREREQUISITE,
  ],

  install: {
    intro:
      "Add the extension. Its version comes from the Quarkus platform BOM your project already imports:",
    snippets: [addExtension],
    notes: [
      "Use Quarkus's extension, not the OpenTelemetry Java agent: the extension also works in a native executable, and the two together would trace each request twice.",
    ],
  },

  configure: {
    intro:
      "Quarkus reads the exporter's settings under its own names. The standard `OTEL_EXPORTER_OTLP_ENDPOINT` and its siblings are ignored, so set these:",
    tabs: otlpEnvironmentTabs({
      serviceName: "checkout-api",
      variables: QUARKUS_VARIABLES,
      cloudNote:
        "Quarkus adds `/v1/traces`, `/v1/metrics` and `/v1/logs` to the endpoint itself.",
    }),
    notes: [
      "Without `QUARKUS_OTEL_SERVICE_NAME`, the service takes `quarkus.application.name`, which is fixed when the app is built: set the service name at run time with this variable instead.",
    ],
  },

  setup: {
    intro:
      "Three steps: add the extension to your build, switch on what is off by default, then build and run as usual.",
    steps: [
      {
        title: "Add the extension to your build",
        body: "Or add it by hand:",
        tabs: {
          group: "buildTool",
          tabs: [
            { label: "Maven", snippets: [mavenExtension] },
            { label: "Gradle", snippets: [gradleExtension] },
          ],
        },
      },
      {
        title: "Switch on metrics, logs, HTTP and SQL",
        body: "The extension sends only traces until told otherwise, over gRPC, and leaves SQL out. These settings are read when Quarkus builds the app, so they belong in `application.properties`, not the environment:",
        snippets: [buildProperties],
        notes: [
          "Inject a `Meter` without `quarkus.otel.metrics.enabled=true`, and the build fails with `Unsatisfied dependency for type io.opentelemetry.api.metrics.Meter`.",
        ],
      },
      {
        title: "Build and run",
        body: "Package the app, then start it with the variables above in its environment:",
        snippets: [build, run],
        notes: [
          "In `quarkus dev`, the same settings apply. Changing a build-time one rebuilds the app.",
        ],
      },
    ],
  },

  autoInstrumentation: {
    intro:
      "With the extension and the settings above, Quarkus traces these with no code:",
    rows: [
      {
        library: "Quarkus REST, RESTEasy",
        covers:
          "A server span per request named after the path template (`GET /orders/{id}`), with `http.route` and the method that served it, and the exception it threw.",
      },
      {
        library: "REST client",
        covers:
          "A client span per call (`POST /api/charges`), carrying `traceparent` to the service called.",
      },
      {
        library: "JDBC, Hibernate ORM, Panache",
        covers:
          "A span per statement (`SELECT shop.PlacedOrder`), with `quarkus.datasource.jdbc.telemetry=true`.",
      },
      {
        library: "Kafka, AMQP, Vert.x, gRPC",
        covers:
          "Producer and consumer spans with the trace carried in each message, and spans for gRPC calls.",
      },
      {
        library: "JBoss Logging",
        covers:
          "Every record, with trace and span IDs and the code's location, with `quarkus.otel.logs.enabled=true`.",
      },
    ],
    snippets: [],
    notes: [
      "Quarkus leaves its own endpoints under `/q`, the health checks among them, out of your traces by default.",
    ],
  },

  manualSpans: {
    intro:
      "Annotate a CDI bean's method with `@WithSpan`, and inject a `Meter` for instruments of your own:",
    snippets: [paymentService],
    notes: [
      "The span nests under the request's, and the REST client call made inside it nests under the span.",
      "`@SpanAttribute` turns a parameter into an attribute; `Span.current()` adds more as you learn them.",
      "Search them in the **Traces** explorer: `@payment.method:card`.",
    ],
  },

  logs: {
    intro:
      "Once `quarkus.otel.logs.enabled=true` is built in, every record written through JBoss Logging goes to OneUptime with its request's trace and span IDs, and its code location: function, file and line.",
    snippets: [],
    notes: [
      "Quarkus's own `quarkus.log.level` and `quarkus.log.category` settings decide which records are written, and so which are sent.",
      "An unhandled exception is logged by `QuarkusErrorHandler` with an error id and the stack trace, which files it under **Exceptions**.",
      "SLF4J and `java.util.logging` records reach JBoss Logging in Quarkus, so libraries that use them are sent too.",
    ],
  },

  metrics: {
    intro: "Once metrics are on, exported every 60 seconds:",
    builtIn: [
      {
        name: "http.server.request.duration",
        description:
          "Each request's duration by route, method and status code, with `error.type` on failures.",
      },
      {
        name: "jvm.gc.duration",
        description:
          "Garbage collection time by collector and action, from the JVM's flight recorder.",
      },
      {
        name: "jvm.cpu.longlock",
        description:
          "Time threads waited on contended locks: a hot lock slows every request that needs it.",
      },
      {
        name: "jvm.network.io",
        description: "Bytes read and written over the network by the JVM.",
      },
    ],
    snippets: [],
    notes: [
      "The SDK also reports on itself, as metrics named `otel.sdk.*`: spans started and queued, logs processed, export durations. They show whether telemetry is being dropped.",
      "Using Micrometer instead? Quarkus's Micrometer extension can send over OTLP through this one, so both end up in OneUptime.",
    ],
  },

  sampling: {
    intro:
      "Everything is traced by default. Keep a share of new traces on a busy service:",
    snippets: [sampling],
    notes: [
      "These two are read at run time: `QUARKUS_OTEL_TRACES_SAMPLER_ARG` changes the share without a rebuild.",
      "A request that arrives with a `traceparent` header follows its caller's decision.",
      "Metrics and logs are not sampled.",
    ],
  },

  deploy: {
    intro:
      "Copy the fast-jar layout Quarkus builds into a Java 25 image, and pass the variables at run time:",
    snippets: [
      dockerfile,
      kubernetesManifestSnippet({
        name: "checkout-api",
        image: "registry.example.com/checkout-api:3.40.0",
        containerPort: 8080,
        variables: QUARKUS_VARIABLES,
      }),
    ],
    notes: [
      "A native executable needs the same variables and no JVM: build it with `./mvnw package -Dnative`, the extension included.",
      "Quarkus shuts down gracefully on SIGTERM and sends what OpenTelemetry holds on the way out.",
      "Point Kubernetes' probes at `/q/health/live` and `/q/health/ready`: they stay out of your traces.",
    ],
  },

  verify: {
    intro: "Check in this order: each step rules out one cause.",
    steps: [
      validateKeyStep("server"),
      {
        title: "Find the service",
        body: `Send a request, then open ${SCREENS.services}: \`checkout-api\` is listed within a minute. If nothing appears, check that the variables are the \`QUARKUS_\` ones.`,
      },
      {
        title: "Open a request's trace",
        body: `In ${SCREENS.traces}, search \`@http.route:/orders/{id}\`: the request's span holds the \`SELECT\` beneath it.`,
      },
      {
        title: "Follow a log line to its request",
        body: `In ${SCREENS.logs}, search \`loading order\`: each record names the method that wrote it beside its trace ID, which opens the request.`,
      },
    ],
  },

  troubleshooting: [
    {
      question: "Nothing arrives, although OTEL_EXPORTER_OTLP_ENDPOINT is set",
      answer:
        "Quarkus ignores the standard `OTEL_*` variables and sends to `localhost:4317` over gRPC. Set `QUARKUS_OTEL_EXPORTER_OTLP_ENDPOINT` and `QUARKUS_OTEL_EXPORTER_OTLP_HEADERS`, and `quarkus.otel.exporter.otlp.protocol=http/protobuf` in `application.properties`.",
    },
    {
      question: "The build fails: “Unsatisfied dependency for type Meter”",
      answer:
        "Metrics are off, so no `Meter` bean exists. Add `quarkus.otel.metrics.enabled=true` to `application.properties` and build again: it is a build-time setting.",
    },
    {
      question: "Requests are traced, but no SQL",
      answer:
        "JDBC telemetry is off by default. Add `quarkus.datasource.jdbc.telemetry=true` and rebuild.",
    },
    {
      question: "The service has the wrong name",
      answer:
        "`quarkus.application.name` is fixed at build time, and Quarkus warns `Build time property cannot be changed at runtime` when you try. Set `QUARKUS_OTEL_SERVICE_NAME` at run time instead.",
    },
    {
      question: "The exporter logs a 401",
      answer:
        "OneUptime refused the key: `QUARKUS_OTEL_EXPORTER_OTLP_HEADERS` must be `x-oneuptime-token=` followed by a **Server** key's **Secret Key**.",
    },
  ],

  faq: [
    {
      question: "Does OpenTelemetry work in a Quarkus native executable?",
      answer:
        "Yes: the extension is built into the executable, with the same settings and variables. That is the main reason to prefer it to the Java agent, which a native executable cannot load.",
    },
    {
      question: "Can I use the OpenTelemetry Java agent with Quarkus instead?",
      answer:
        "Only in JVM mode, and not together with the extension. The extension knows Quarkus's REST layer and its build steps, and keeps working in native mode, so it is the better choice.",
    },
    {
      question: "Which Quarkus versions does this cover?",
      answer:
        "The settings here are those of Quarkus 3, and the guide was checked with Quarkus 3.40 on Java 25.",
    },
    {
      question: "Do I need an OpenTelemetry Collector?",
      answer:
        "No: the extension sends straight to OneUptime. A Collector helps when you want one place to filter or batch what many services send: see [OpenTelemetry](/docs/telemetry/open-telemetry).",
    },
  ],

  related: ["java", "spring-boot", "micronaut", "ktor"],
  docs: [DOCS.openTelemetry, DOCS.traces, DOCS.logs, DOCS.metrics],

  verification: {
    runtime: "jvm",
    framework: { name: "Quarkus", package: "io.quarkus:quarkus-core" },
    files: [{ path: "pom.xml", content: pomFile }, ...appFiles],
    stubApiPort: 9000,
    commands: [
      { command: "mvn -q -B package -DskipTests" },
      { snippet: "run", isServer: true },
    ],
    port: 8080,
    requests: [
      { method: "GET", path: "/q/health" },
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
        { name: "SELECT shop.PlacedOrder", attributes: { "db.system": "h2" } },
        {
          name: "checkout.charge",
          attributes: { "payment.method": "card", "order.item_count": "2" },
        },
        { name: "POST /api/charges" },
        { name: "INSERT shop.PlacedOrder" },
        {
          name: "GET /orders/boom",
          hasException: true,
          exceptionMessage: "Payment provider timed out",
        },
      ],
      metrics: [
        "http.server.request.duration",
        "jvm.gc.duration",
        "orders.placed",
      ],
      logs: [
        { body: "loading order 42", hasTraceContext: true },
        {
          body: "HTTP Request to /orders/boom failed",
          hasTraceContext: true,
          hasException: true,
        },
      ],
      resource: { "service.name": "checkout-api" },
      untracedPaths: ["/q/health"],
    },
  },
};
