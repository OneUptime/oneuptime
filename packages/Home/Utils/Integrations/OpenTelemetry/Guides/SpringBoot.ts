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
import { javaAgentDownloadSnippet, jvmDockerfileSnippet } from "../JvmShared";

const agent: GuideSnippet = javaAgentDownloadSnippet();

const runWithAgent: GuideSnippet = {
  id: "run-agent",
  language: "bash",
  code: "java -javaagent:opentelemetry-javaagent.jar -jar target/checkout.jar",
  check: "run",
};

const starterBom: GuideSnippet = {
  id: "starter-bom",
  language: "xml",
  title: "pom.xml",
  code: [
    "<dependencyManagement>",
    "  <dependencies>",
    "    <dependency>",
    "      <groupId>io.opentelemetry.instrumentation</groupId>",
    "      <artifactId>opentelemetry-instrumentation-bom</artifactId>",
    "      <version>2.33.1</version>",
    "      <type>pom</type>",
    "      <scope>import</scope>",
    "    </dependency>",
    "  </dependencies>",
    "</dependencyManagement>",
  ].join("\n"),
  check: "contained",
};

const starterDependency: GuideSnippet = {
  id: "starter-dependency",
  language: "xml",
  title: "pom.xml",
  code: [
    "<dependency>",
    "  <groupId>io.opentelemetry.instrumentation</groupId>",
    "  <artifactId>opentelemetry-spring-boot-starter</artifactId>",
    "</dependency>",
  ].join("\n"),
  check: "contained",
};

const starterGradle: GuideSnippet = {
  id: "starter-gradle",
  language: "kotlin",
  title: "build.gradle.kts",
  code: [
    "dependencies {",
    '    implementation(platform("io.opentelemetry.instrumentation:opentelemetry-instrumentation-bom:2.33.1"))',
    '    implementation("io.opentelemetry.instrumentation:opentelemetry-spring-boot-starter")',
    "}",
  ].join("\n"),
  check: "parse",
};

const runWithStarter: GuideSnippet = {
  id: "run-starter",
  language: "bash",
  code: "java -jar target/checkout.jar",
  check: "run",
};

// With the starter there is no global instance: the bean is injected.
const starterMeter: GuideSnippet = {
  id: "starter-meter",
  language: "java",
  title: "PaymentService.java",
  code: [
    "  PaymentService(RestClient.Builder restClient, OpenTelemetry openTelemetry) {",
    "    this.payments = restClient.baseUrl(PAYMENTS_URL).build();",
    "    this.ordersPlaced =",
    "        openTelemetry",
    '            .getMeter("checkout")',
    '            .counterBuilder("orders.placed")',
    '            .setDescription("Orders placed, by payment method")',
    "            .build();",
    "  }",
  ].join("\n"),
  check: "contained",
};

const mavenAnnotations: GuideSnippet = {
  id: "maven-annotations",
  language: "xml",
  title: "pom.xml",
  code: [
    "<dependency>",
    "  <groupId>io.opentelemetry.instrumentation</groupId>",
    "  <artifactId>opentelemetry-instrumentation-annotations</artifactId>",
    "  <version>2.33.1</version>",
    "</dependency>",
  ].join("\n"),
  check: "contained",
};

const gradleAnnotations: GuideSnippet = {
  id: "gradle-annotations",
  language: "kotlin",
  title: "build.gradle.kts",
  code: [
    "dependencies {",
    '    implementation("io.opentelemetry.instrumentation:opentelemetry-instrumentation-annotations:2.33.1")',
    "}",
  ].join("\n"),
  check: "parse",
};

const paymentService: GuideSnippet = {
  id: "payment-service",
  language: "java",
  title: "PaymentService.java",
  code: [
    "package com.example.checkout;",
    "",
    "import io.opentelemetry.api.GlobalOpenTelemetry;",
    "import io.opentelemetry.api.common.AttributeKey;",
    "import io.opentelemetry.api.common.Attributes;",
    "import io.opentelemetry.api.metrics.LongCounter;",
    "import io.opentelemetry.api.trace.Span;",
    "import io.opentelemetry.instrumentation.annotations.SpanAttribute;",
    "import io.opentelemetry.instrumentation.annotations.WithSpan;",
    "import java.util.Map;",
    "import org.springframework.stereotype.Service;",
    "import org.springframework.web.client.RestClient;",
    "",
    "@Service",
    "public class PaymentService {",
    "  static final String PAYMENTS_URL =",
    '      System.getenv().getOrDefault("PAYMENTS_API_URL", "http://localhost:9000");',
    "",
    "  private final RestClient payments;",
    "  private final LongCounter ordersPlaced =",
    '      GlobalOpenTelemetry.getMeter("checkout")',
    '          .counterBuilder("orders.placed")',
    '          .setDescription("Orders placed, by payment method")',
    "          .build();",
    "",
    "  PaymentService(RestClient.Builder restClient) {",
    "    this.payments = restClient.baseUrl(PAYMENTS_URL).build();",
    "  }",
    "",
    '  @WithSpan("checkout.charge")',
    '  public void charge(@SpanAttribute("payment.method") String paymentMethod, int itemCount) {',
    '    Span.current().setAttribute("order.item_count", itemCount);',
    '    payments.post().uri("/api/charges").body(Map.of("items", itemCount)).retrieve().toBodilessEntity();',
    '    ordersPlaced.add(1, Attributes.of(AttributeKey.stringKey("payment.method"), paymentMethod));',
    "  }",
    "}",
  ].join("\n"),
  check: "run",
};

const properties: GuideSnippet = {
  id: "properties",
  language: "properties",
  title: "application.properties",
  code: [
    "spring.application.name=checkout",
    "# The trace ID in every console line, beside the level.",
    "logging.pattern.level=%5p [trace_id=%X{trace_id}]",
  ].join("\n"),
  check: "contained",
};

const sampling: GuideSnippet = {
  id: "sampling",
  language: "bash",
  code: [
    'export OTEL_TRACES_SAMPLER="parentbased_traceidratio"',
    'export OTEL_TRACES_SAMPLER_ARG="0.2"',
  ].join("\n"),
  check: "parse",
};

/*
 * The app the end-to-end check builds: what Spring Initializr generates
 * for Spring Boot 4.1 with Spring MVC, Spring Data JPA, H2, the actuator
 * and the REST client, plus the page's fragments word for word.
 */
function pomFile(
  extraDependencies: string,
  dependencyManagement: string,
): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
    '  xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">',
    "  <modelVersion>4.0.0</modelVersion>",
    "  <parent>",
    "    <groupId>org.springframework.boot</groupId>",
    "    <artifactId>spring-boot-starter-parent</artifactId>",
    "    <version>4.1.2</version>",
    "    <relativePath/>",
    "  </parent>",
    "  <groupId>com.example</groupId>",
    "  <artifactId>checkout</artifactId>",
    "  <version>1.0.0</version>",
    "  <properties>",
    "    <java.version>25</java.version>",
    "  </properties>",
    dependencyManagement,
    "  <dependencies>",
    "    <dependency>",
    "      <groupId>org.springframework.boot</groupId>",
    "      <artifactId>spring-boot-starter-actuator</artifactId>",
    "    </dependency>",
    "    <dependency>",
    "      <groupId>org.springframework.boot</groupId>",
    "      <artifactId>spring-boot-starter-data-jpa</artifactId>",
    "    </dependency>",
    "    <dependency>",
    "      <groupId>org.springframework.boot</groupId>",
    "      <artifactId>spring-boot-starter-webmvc</artifactId>",
    "    </dependency>",
    "    <dependency>",
    "      <groupId>org.springframework.boot</groupId>",
    "      <artifactId>spring-boot-starter-restclient</artifactId>",
    "    </dependency>",
    "    <dependency>",
    "      <groupId>com.h2database</groupId>",
    "      <artifactId>h2</artifactId>",
    "      <scope>runtime</scope>",
    "    </dependency>",
    mavenAnnotations.code,
    extraDependencies,
    "  </dependencies>",
    "  <build>",
    "    <finalName>checkout</finalName>",
    "    <plugins>",
    "      <plugin>",
    "        <groupId>org.springframework.boot</groupId>",
    "        <artifactId>spring-boot-maven-plugin</artifactId>",
    "      </plugin>",
    "    </plugins>",
    "  </build>",
    "</project>",
  ].join("\n");
}

const source: string = "src/main/java/com/example/checkout/";

const sharedSources: Array<VerificationFile> = [
  {
    path: `${source}CheckoutApplication.java`,
    content: [
      "package com.example.checkout;",
      "",
      "import org.springframework.boot.SpringApplication;",
      "import org.springframework.boot.autoconfigure.SpringBootApplication;",
      "",
      "@SpringBootApplication",
      "public class CheckoutApplication {",
      "  public static void main(String[] args) {",
      "    SpringApplication.run(CheckoutApplication.class, args);",
      "  }",
      "}",
    ].join("\n"),
  },
  {
    path: `${source}OrderController.java`,
    content: [
      "package com.example.checkout;",
      "",
      "import jakarta.persistence.Entity;",
      "import jakarta.persistence.GeneratedValue;",
      "import jakarta.persistence.Id;",
      "import java.util.List;",
      "import java.util.Map;",
      "import org.slf4j.Logger;",
      "import org.slf4j.LoggerFactory;",
      "import org.springframework.data.jpa.repository.JpaRepository;",
      "import org.springframework.http.HttpStatus;",
      "import org.springframework.web.bind.annotation.GetMapping;",
      "import org.springframework.web.bind.annotation.PathVariable;",
      "import org.springframework.web.bind.annotation.PostMapping;",
      "import org.springframework.web.bind.annotation.RequestBody;",
      "import org.springframework.web.bind.annotation.ResponseStatus;",
      "import org.springframework.web.bind.annotation.RestController;",
      "",
      "@RestController",
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
      '  @GetMapping("/orders/{id}")',
      "  Map<String, Object> order(@PathVariable long id) {",
      '    logger.info("loading order {}", id);',
      '    return Map.of("id", id, "found", orders.findById(id).isPresent());',
      "  }",
      "",
      '  @PostMapping("/orders")',
      "  @ResponseStatus(HttpStatus.CREATED)",
      "  Map<String, Object> place(@RequestBody NewOrder order) {",
      "    payments.charge(order.paymentMethod(), order.items().size());",
      "    PlacedOrder saved = orders.save(new PlacedOrder(order.items().size()));",
      '    return Map.of("id", saved.getId());',
      "  }",
      "",
      '  @GetMapping("/boom")',
      "  String boom() {",
      '    throw new IllegalStateException("Payment provider timed out");',
      "  }",
      "",
      "  record NewOrder(List<String> items, String paymentMethod) {}",
      "}",
      "",
      "@Entity",
      "class PlacedOrder {",
      "  @Id @GeneratedValue private Long id;",
      "  private int itemCount;",
      "",
      "  protected PlacedOrder() {}",
      "",
      "  PlacedOrder(int itemCount) {",
      "    this.itemCount = itemCount;",
      "  }",
      "",
      "  Long getId() {",
      "    return id;",
      "  }",
      "}",
      "",
      "interface OrderRepository extends JpaRepository<PlacedOrder, Long> {}",
    ].join("\n"),
  },
  {
    path: "src/main/resources/application.properties",
    content: [
      properties.code,
      "spring.datasource.url=jdbc:h2:mem:shop",
      "spring.jpa.open-in-view=false",
    ].join("\n"),
  },
];

// The starter's PaymentService: the same, with the OpenTelemetry bean injected.
const starterPaymentService: string = paymentService.code
  .replace(
    "import io.opentelemetry.api.GlobalOpenTelemetry;",
    "import io.opentelemetry.api.OpenTelemetry;",
  )
  .replace(
    [
      "  private final LongCounter ordersPlaced =",
      '      GlobalOpenTelemetry.getMeter("checkout")',
      '          .counterBuilder("orders.placed")',
      '          .setDescription("Orders placed, by payment method")',
      "          .build();",
      "",
      "  PaymentService(RestClient.Builder restClient) {",
      "    this.payments = restClient.baseUrl(PAYMENTS_URL).build();",
      "  }",
    ].join("\n"),
    ["  private final LongCounter ordersPlaced;", "", starterMeter.code].join(
      "\n",
    ),
  );

const requests: Array<{
  method: "GET" | "POST";
  path: string;
  body?: Record<string, unknown>;
}> = [
  { method: "GET", path: "/actuator/health" },
  { method: "GET", path: "/orders/42" },
  {
    method: "POST",
    path: "/orders",
    body: { items: ["kettle", "mug"], paymentMethod: "card" },
  },
  { method: "GET", path: "/boom" },
];

export const SpringBootGuide: OpenTelemetryGuide = {
  slug: "spring-boot",
  seo: {
    title: "Spring Boot OpenTelemetry: Java Agent or Starter | OneUptime",
    description:
      "Instrument Spring Boot with OpenTelemetry: the Java agent or the Spring Boot starter, MVC routes, JPA and JDBC, RestClient, JVM metrics and logs, to OneUptime.",
  },
  h1: "OpenTelemetry for Spring Boot",
  lead: "Trace every Spring Boot request through its controller, its repository and the services it calls, and send the traces, metrics and logs to OneUptime. Start the app with the OpenTelemetry Java agent and change no code, or add the Spring Boot starter where an agent cannot go, such as a native image.",
  cardDescription:
    "The Java agent or the Spring Boot starter: MVC routes, JPA queries, RestClient calls, JVM metrics and logs.",
  searchTerms: [
    "spring",
    "spring mvc",
    "spring data jpa",
    "hibernate",
    "restclient",
    "actuator",
    "java agent",
    "spring boot starter",
  ],
  highlights: ["Java agent or starter", "Spring Boot 4", "Java 25"],

  whatYouGet: {
    intro: `A Spring Boot app started with the agent reports as one service, named by \`OTEL_SERVICE_NAME\`, in ${SCREENS.services} from its first request.`,
    traces:
      "A server span per request named after its mapping, such as `GET /orders/{id}`, then the Spring Data repository call, Hibernate's session work and each JDBC statement, and the calls your `RestClient` makes, all nested in order.",
    metrics:
      "JVM memory, garbage collection and threads, `http.server.request.duration` by route, the HikariCP pool's connections, and outgoing call durations, with no code.",
    logs: "Every Logback record, Spring's and Hibernate's included, with the trace and span IDs of the request that wrote it, and the trace ID in your console lines if you ask for it.",
    exceptions: `An exception that escapes a controller is recorded on the request's span, and Tomcat's \`Servlet.service() ... threw exception\` record carries it too. ${SCREENS.exceptions} groups them by type and place.`,
  },

  exampleTrace: {
    caption: "A POST /orders request, as its trace shows it",
    spans: [
      {
        name: "POST /orders",
        depth: 0,
        start: 0,
        duration: 100,
        source: "tomcat",
      },
      {
        name: "checkout.charge",
        depth: 1,
        start: 3,
        duration: 62,
        source: "@WithSpan",
      },
      {
        name: "POST",
        depth: 2,
        start: 6,
        duration: 54,
        source: "java-http-client",
      },
      {
        name: "OrderRepository.save",
        depth: 1,
        start: 68,
        duration: 28,
        source: "spring-data",
      },
      {
        name: "INSERT shop.placed_order",
        depth: 2,
        start: 80,
        duration: 9,
        source: "jdbc",
      },
    ],
  },

  prerequisites: [
    "Java 17 or later, which Spring Boot 4 needs. These steps were checked with Spring Boot 4.1 on Java 25.",
    "A Spring Boot app built into an executable jar, with Maven or Gradle.",
    SERVER_KEY_PREREQUISITE,
  ],

  install: {
    intro:
      "Download the OpenTelemetry Java agent, at the release this guide was checked with. The Spring Boot starter instead is a dependency, added in the next steps:",
    snippets: [agent],
    notes: [
      "The agent holds the SDK and every instrumentation in one jar, shaded so that nothing it carries clashes with your app's own dependencies.",
    ],
  },

  configure: {
    intro:
      "The agent and the starter both read the standard OpenTelemetry variables, so the endpoint and the key stay out of `application.properties`:",
    tabs: otlpEnvironmentTabs({
      serviceName: "checkout-api",
      cloudNote:
        "Both send OTLP over HTTP by default, which is what OneUptime's `/otlp` endpoint takes.",
    }),
    notes: [
      "Keep the key in the environment, never in `-D` flags on the command line: the agent reports the JVM's command line on every span as `process.command_args`.",
    ],
  },

  setup: {
    intro:
      "Choose how OpenTelemetry joins your app. The agent traces the most and needs no code; the starter is a dependency, for where a `-javaagent` flag cannot go.",
    steps: [
      {
        title: "Load OpenTelemetry",
        body: "Pick the Java agent unless you build a native image or cannot change the JVM's command line:",
        tabs: {
          group: "setup",
          tabs: [
            {
              label: "Java agent",
              body: "Start the jar with `-javaagent`, pointing at the agent you downloaded:",
              snippets: [runWithAgent],
              notes: [
                'Running with `mvn spring-boot:run`? Pass the agent with `-Dspring-boot.run.jvmArguments="-javaagent:opentelemetry-javaagent.jar"`.',
                "In a container, set `JAVA_TOOL_OPTIONS` instead, as the Docker section below does.",
              ],
            },
            {
              label: "Spring Boot starter",
              body: "Import the instrumentation BOM and add the starter, in Maven or Gradle:",
              snippets: [
                starterBom,
                starterDependency,
                starterGradle,
                runWithStarter,
              ],
              notes: [
                "The starter registers no global OpenTelemetry instance, so `GlobalOpenTelemetry` hands out no-op instruments: inject the `OpenTelemetry` bean instead, as here.",
                "Calls are traced only from `RestClient` and `WebClient` instances built from Spring's builder beans; `RestClient.create()` makes none.",
                "It traces less than the agent: requests, JDBC, Kafka, MongoDB and Logback, but no Hibernate or Spring Data spans.",
              ],
            },
          ],
        },
      },
      {
        title: "Add the annotations, for spans of your own",
        body: "Both ways turn `@WithSpan` into spans once the annotations are on the classpath:",
        tabs: {
          group: "buildTool",
          tabs: [
            { label: "Maven", snippets: [mavenAnnotations] },
            { label: "Gradle", snippets: [gradleAnnotations] },
          ],
        },
      },
      {
        title: "Send a few requests",
        body: "Spans and logs leave in batches every few seconds, metrics once a minute; whatever is still buffered leaves as the app shuts down.",
      },
    ],
  },

  autoInstrumentation: {
    intro:
      "With the agent, a typical Spring Boot app is traced at every layer:",
    rows: [
      {
        library: "Spring MVC on Tomcat",
        covers:
          "A server span per request named after its mapping (`GET /orders/{id}`), with `http.route`, and the exception a controller threw.",
      },
      {
        library: "Spring Data, Hibernate",
        covers:
          "A span per repository call (`OrderRepository.findById`) and Hibernate's session and transaction work (`Session.find`, `Transaction.commit`).",
      },
      {
        library: "JDBC, HikariCP",
        covers:
          "A span per statement (`SELECT shop.placed_order`), and the pool's connections, pending requests and wait times as metrics.",
      },
      {
        library: "`RestClient`, `WebClient`, `RestTemplate`",
        covers:
          "A client span per call, with `traceparent` sent along so the service called joins the trace.",
      },
      {
        library: "Kafka, RabbitMQ, `@Scheduled`",
        covers:
          "Producer and consumer spans with the trace carried in each message, and a span per scheduled run.",
      },
      {
        library: "Logback",
        covers:
          "Every record, with trace and span IDs, and those IDs in the MDC.",
      },
    ],
    snippets: [],
    notes: [
      "The actuator's endpoints, `/actuator/health` among them, are traced like any other request. Drop those spans with a [drop filter](/docs/telemetry/drop-filters-and-scrub-rules) in OneUptime.",
    ],
  },

  manualSpans: {
    intro:
      "Annotate a bean's method with `@WithSpan` and every call becomes a span, nested under the request's, with `@SpanAttribute` parameters as attributes:",
    snippets: [paymentService],
    notes: [
      "With the agent, a call from inside the same bean is traced too: the agent instruments the class itself. The starter works through Spring's proxies, so it traces only calls that come from another bean.",
      "`Span.current()` is the method's span: add attributes as you learn them, such as the item count here.",
      "Find spans by attribute in the **Traces** explorer: `@payment.method:card`.",
    ],
  },

  logs: {
    intro:
      "Spring Boot logs through Logback, whose records the agent and the starter both send. For the trace ID in your console lines too, add it to the level pattern:",
    snippets: [properties],
    notes: [
      "Records written at startup carry no trace ID: there is no request yet.",
      'Log an exception by passing it as the last argument, `logger.error("payment failed", error)`: the record carries its type, message and stack trace, and lands under **Exceptions**.',
      "Spring Boot's `logging.level.*` settings decide what is written, and so what is sent.",
    ],
  },

  metrics: {
    intro: "Exported every 60 seconds with the agent:",
    builtIn: [
      {
        name: "http.server.request.duration",
        description:
          "Each request's duration by route, method and status code: every mapping's latency and error rate.",
      },
      {
        name: "jvm.memory.used",
        description:
          "Heap and non-heap memory by pool, beside `jvm.gc.duration` and `jvm.thread.count`.",
      },
      {
        name: "db.client.connections.usage",
        description:
          "HikariCP's connections, used and idle, beside `db.client.connections.pending_requests`: a pool that runs out shows here first.",
      },
      {
        name: "http.client.request.duration",
        description: "The calls your `RestClient` makes, by server and status.",
      },
    ],
    snippets: [],
    notes: [
      "Custom instruments come from `GlobalOpenTelemetry.getMeter` with the agent, as `orders.placed` above; with the starter, from the injected `OpenTelemetry` bean.",
      "The agent leaves Spring Boot's Micrometer metrics out. To send those as well, set `OTEL_INSTRUMENTATION_MICROMETER_ENABLED=true`.",
    ],
  },

  sampling: {
    intro:
      "Every request is traced by default. Keep a share of new traces on a busy service:",
    snippets: [sampling],
    notes: [
      "`parentbased_traceidratio` keeps a fifth of new traces and follows the caller's decision when a request carries a `traceparent` header.",
      "Spring Boot's own `management.tracing.sampling.probability` belongs to Micrometer Tracing, not to the agent or the starter: these variables are what count here.",
      "Metrics and logs are not sampled.",
    ],
  },

  deploy: {
    intro:
      "Build the jar, put it in an image beside the agent, and load the agent through `JAVA_TOOL_OPTIONS`:",
    snippets: [
      jvmDockerfileSnippet({
        jar: "target/checkout.jar",
        port: 8080,
        withAgent: true,
      }),
      kubernetesManifestSnippet({
        name: "checkout-api",
        image: "registry.example.com/checkout-api:4.1.0",
        containerPort: 8080,
      }),
    ],
    notes: [
      "On SIGTERM, Spring Boot shuts down gracefully, and the agent sends what it holds as the JVM exits.",
      "Point Kubernetes' probes at `/actuator/health/liveness` and `/actuator/health/readiness`, and drop their spans with a drop filter: they arrive every few seconds from every pod.",
      "Building a native image with GraalVM? Use the starter: there is no JVM to load the agent into.",
    ],
  },

  verify: {
    intro: "Check in this order: each step rules out one cause.",
    steps: [
      validateKeyStep("server"),
      {
        title: "See OpenTelemetry start",
        body: "With the agent, the first line reads `opentelemetry-javaagent - version: 2.33.1`; with the starter, Spring logs `OpenTelemetry Spring Boot starter (2.33.1) has been started`.",
      },
      {
        title: "Open a request's trace",
        body: `Send a request, then search \`@http.route:/orders/{id}\` in ${SCREENS.traces}: the repository call and its \`SELECT\` sit under the request.`,
      },
      {
        title: "Follow a log line to its request",
        body: `In ${SCREENS.logs}, open a \`loading order\` line: its trace ID opens the request that wrote it.`,
      },
    ],
  },

  troubleshooting: [
    {
      question: "With the starter, my custom metrics never arrive",
      answer:
        "They were made from `GlobalOpenTelemetry`, which the starter leaves empty: instruments from it record nothing. Inject the `OpenTelemetry` bean and get the meter from it.",
    },
    {
      question: "With the starter, outgoing calls are not traced",
      answer:
        "The client was built with `RestClient.create()` or `new RestTemplate()`. Build it from Spring's `RestClient.Builder` bean, which Spring Boot 4 provides with `spring-boot-starter-restclient`.",
    },
    {
      question: "“No qualifying bean of type RestClient.Builder”",
      answer:
        "In Spring Boot 4, the builder comes from its own starter: add `spring-boot-starter-restclient`.",
    },
    {
      question: "Only one request in ten is traced",
      answer:
        "That is Spring Boot's own `spring-boot-starter-opentelemetry`, whose Micrometer Tracing samples 10% of requests unless `management.tracing.sampling.probability` says otherwise. Set it to `1.0`, or use the agent instead, and take Spring's starter out so the two do not both trace.",
    },
    {
      question: "Nothing arrives",
      answer:
        "With the agent, check that its version line is printed first, then set `OTEL_JAVAAGENT_DEBUG=true` to see each export. Check that `OTEL_EXPORTER_OTLP_ENDPOINT` ends in `/otlp`, and that the key is a **Server** key's **Secret Key**.",
    },
  ],

  faq: [
    {
      question: "Should I use the Java agent or the Spring Boot starter?",
      answer:
        "The agent, unless it cannot run: it traces more (Hibernate, Spring Data, every HTTP client) and needs no code. Choose the starter for GraalVM native images, or where the JVM's command line is out of your hands.",
    },
    {
      question: "What about Spring Boot's own OpenTelemetry starter?",
      answer:
        "`spring-boot-starter-opentelemetry` is Spring's own, built on Micrometer: it sends traces and metrics over OTLP, but names spans its own way (`http get /orders/{id}`), traces 10% of requests by default, sends no logs without an appender, and does not trace JDBC or `@WithSpan`. The agent gives the fuller picture.",
    },
    {
      question: "Does it work with Spring Boot 3?",
      answer:
        "Yes, the agent works with any Spring Boot version: it instruments the libraries underneath. This guide checked both the agent and the OpenTelemetry starter with Spring Boot 4.1.",
    },
    {
      question: "Does it work with WebFlux?",
      answer:
        "Yes: the agent traces WebFlux and Reactor Netty, and carries the context through Reactor's operators, so spans stay nested across asynchronous boundaries.",
    },
  ],

  related: ["java", "quarkus", "micronaut", "ktor"],
  docs: [DOCS.openTelemetry, DOCS.traces, DOCS.logs, DOCS.dropFilters],

  verification: {
    runtime: "jvm",
    framework: {
      name: "Spring Boot",
      package: "org.springframework.boot:spring-boot",
    },
    files: [
      { path: "pom.xml", content: pomFile("", "") },
      ...sharedSources,
      { path: `${source}PaymentService.java`, snippet: "payment-service" },
    ],
    stubApiPort: 9000,
    commands: [
      { snippet: "agent" },
      { command: "mvn -q -B package -DskipTests" },
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
        { name: "OrderRepository.findById" },
        { name: "SELECT shop.placed_order", attributes: { "db.system": "h2" } },
        {
          name: "checkout.charge",
          attributes: { "payment.method": "card", "order.item_count": "2" },
        },
        { name: "POST", attributes: { "http.request.method": "POST" } },
        { name: "INSERT shop.placed_order" },
        {
          name: "GET /boom",
          hasException: true,
          exceptionMessage: "Payment provider timed out",
        },
      ],
      metrics: [
        "http.server.request.duration",
        "jvm.memory.used",
        "db.client.connections.usage",
        "http.client.request.duration",
        "orders.placed",
      ],
      logs: [{ body: "loading order 42", hasTraceContext: true }],
      resource: { "service.name": "checkout-api" },
    },
    variants: [
      {
        name: "Spring Boot starter",
        files: [
          {
            path: "pom.xml",
            content: pomFile(starterDependency.code, starterBom.code),
          },
          ...sharedSources,
          {
            path: `${source}PaymentService.java`,
            content: starterPaymentService,
          },
        ],
        stubApiPort: 9000,
        commands: [
          { command: "mvn -q -B package -DskipTests" },
          { snippet: "run-starter", isServer: true },
        ],
        port: 8080,
        requests: requests,
        expect: {
          spans: [
            {
              name: "GET /orders/{id}",
              attributes: { "http.route": "/orders/{id}" },
            },
            { name: "SELECT shop.placed_order" },
            {
              name: "checkout.charge",
              attributes: { "payment.method": "card" },
            },
            { name: "POST", attributes: { "http.request.method": "POST" } },
            { name: "GET /boom", hasException: true },
          ],
          metrics: ["http.server.request.duration", "orders.placed"],
          logs: [{ body: "loading order 42", hasTraceContext: true }],
          resource: { "service.name": "checkout-api" },
        },
      },
      {
        // The Micrometer bridge the metrics section names, switched on.
        name: "Micrometer metrics",
        files: [
          { path: "pom.xml", content: pomFile("", "") },
          ...sharedSources,
          { path: `${source}PaymentService.java`, snippet: "payment-service" },
        ],
        stubApiPort: 9000,
        commands: [
          { snippet: "agent" },
          { command: "mvn -q -B package -DskipTests" },
          {
            snippet: "run-agent",
            isServer: true,
            environment: { OTEL_INSTRUMENTATION_MICROMETER_ENABLED: "true" },
          },
        ],
        port: 8080,
        requests: requests,
        expect: {
          spans: [{ name: "GET /orders/{id}" }],
          metrics: ["http.server.requests", "orders.placed"],
          logs: [],
        },
      },
    ],
  },
};
