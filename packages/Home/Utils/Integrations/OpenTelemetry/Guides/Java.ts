import { OpenTelemetryGuide, GuideSnippet } from "../GuideTypes";
import {
  DOCS,
  SCREENS,
  SERVER_KEY_PREREQUISITE,
  kubernetesManifestSnippet,
  otlpEnvironmentTabs,
  validateKeyStep,
} from "../GuideShared";
import {
  JAVA_AGENT_VERSION,
  javaAgentDownloadSnippet,
  jvmDockerfileSnippet,
} from "../JvmShared";

const agent: GuideSnippet = javaAgentDownloadSnippet();

const run: GuideSnippet = {
  id: "run",
  language: "bash",
  code: "java -javaagent:opentelemetry-javaagent.jar -jar target/checkout-api.jar",
  check: "run",
};

const toolOptions: GuideSnippet = {
  id: "tool-options",
  language: "bash",
  code: [
    'export JAVA_TOOL_OPTIONS="-javaagent:/opt/otel/opentelemetry-javaagent.jar"',
    "java -jar target/checkout-api.jar",
  ].join("\n"),
  check: "parse",
};

const mavenApi: GuideSnippet = {
  id: "maven-api",
  language: "xml",
  title: "pom.xml",
  code: [
    "<dependency>",
    "  <groupId>io.opentelemetry</groupId>",
    "  <artifactId>opentelemetry-api</artifactId>",
    "  <version>1.67.0</version>",
    "</dependency>",
    "<dependency>",
    "  <groupId>io.opentelemetry.instrumentation</groupId>",
    "  <artifactId>opentelemetry-instrumentation-annotations</artifactId>",
    "  <version>2.33.1</version>",
    "</dependency>",
  ].join("\n"),
  check: "contained",
};

const gradleApi: GuideSnippet = {
  id: "gradle-api",
  language: "kotlin",
  title: "build.gradle.kts",
  code: [
    "dependencies {",
    '    implementation("io.opentelemetry:opentelemetry-api:1.67.0")',
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
    "import java.io.IOException;",
    "import java.net.URI;",
    "import java.net.http.HttpClient;",
    "import java.net.http.HttpRequest;",
    "import java.net.http.HttpResponse;",
    "",
    "public class PaymentService {",
    "  private static final String PAYMENTS_API =",
    '      System.getenv().getOrDefault("PAYMENTS_API_URL", "http://localhost:9000");',
    "",
    "  private final HttpClient http = HttpClient.newHttpClient();",
    "  private final LongCounter ordersPlaced =",
    '      GlobalOpenTelemetry.getMeter("checkout")',
    '          .counterBuilder("orders.placed")',
    '          .setDescription("Orders placed, by payment method")',
    "          .build();",
    "",
    '  @WithSpan("checkout.charge")',
    '  public void charge(@SpanAttribute("payment.method") String paymentMethod, int itemCount)',
    "      throws IOException, InterruptedException {",
    '    Span.current().setAttribute("order.item_count", itemCount);',
    "    http.send(",
    '        HttpRequest.newBuilder(URI.create(PAYMENTS_API + "/api/charges"))',
    '            .POST(HttpRequest.BodyPublishers.ofString("{}"))',
    "            .build(),",
    "        HttpResponse.BodyHandlers.discarding());",
    "    ordersPlaced.add(",
    '        1, Attributes.of(AttributeKey.stringKey("payment.method"), paymentMethod));',
    "  }",
    "}",
  ].join("\n"),
  check: "run",
};

const logbackPattern: GuideSnippet = {
  id: "logback-pattern",
  language: "xml",
  title: "logback.xml",
  code: "<pattern>%d{HH:mm:ss.SSS} %-5level %logger{36} trace_id=%X{trace_id} - %msg%n</pattern>",
  check: "contained",
};

const selectiveInstrumentation: GuideSnippet = {
  id: "selective",
  language: "bash",
  code: [
    "# Turn one instrumentation off, by its name...",
    'export OTEL_INSTRUMENTATION_JDBC_ENABLED="false"',
    "# ...or turn them all off and name the ones to keep.",
    'export OTEL_INSTRUMENTATION_COMMON_DEFAULT_ENABLED="false"',
    'export OTEL_INSTRUMENTATION_JAVA_HTTP_SERVER_ENABLED="true"',
  ].join("\n"),
  check: "parse",
};

const sampling: GuideSnippet = {
  id: "sampling",
  language: "bash",
  code: [
    'export OTEL_TRACES_SAMPLER="parentbased_traceidratio"',
    'export OTEL_TRACES_SAMPLER_ARG="0.25"',
  ].join("\n"),
  check: "parse",
};

/*
 * The service the end-to-end check builds and runs: no framework, the
 * JDK's own HTTP server and client, JDBC on H2 and Logback.
 */
const pomFile: string = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<project xmlns="http://maven.apache.org/POM/4.0.0"',
  '         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
  '         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">',
  "  <modelVersion>4.0.0</modelVersion>",
  "  <groupId>com.example</groupId>",
  "  <artifactId>checkout-api</artifactId>",
  "  <version>1.0.0</version>",
  "  <properties>",
  "    <maven.compiler.release>25</maven.compiler.release>",
  "    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>",
  "  </properties>",
  "  <dependencies>",
  mavenApi.code,
  "    <dependency>",
  "      <groupId>com.h2database</groupId>",
  "      <artifactId>h2</artifactId>",
  "      <version>2.5.252</version>",
  "    </dependency>",
  "    <dependency>",
  "      <groupId>ch.qos.logback</groupId>",
  "      <artifactId>logback-classic</artifactId>",
  "      <version>1.6.6</version>",
  "    </dependency>",
  "  </dependencies>",
  "  <build>",
  "    <finalName>checkout-api</finalName>",
  "    <plugins>",
  "      <plugin>",
  "        <groupId>org.apache.maven.plugins</groupId>",
  "        <artifactId>maven-compiler-plugin</artifactId>",
  "        <version>3.15.0</version>",
  "      </plugin>",
  "      <plugin>",
  "        <groupId>org.apache.maven.plugins</groupId>",
  "        <artifactId>maven-shade-plugin</artifactId>",
  "        <version>3.6.2</version>",
  "        <executions>",
  "          <execution>",
  "            <phase>package</phase>",
  "            <goals><goal>shade</goal></goals>",
  "            <configuration>",
  "              <transformers>",
  '                <transformer implementation="org.apache.maven.plugins.shade.resource.ManifestResourceTransformer">',
  "                  <mainClass>com.example.checkout.App</mainClass>",
  "                </transformer>",
  "              </transformers>",
  "            </configuration>",
  "          </execution>",
  "        </executions>",
  "      </plugin>",
  "    </plugins>",
  "  </build>",
  "</project>",
].join("\n");

const appFile: string = [
  "package com.example.checkout;",
  "",
  "import com.sun.net.httpserver.HttpExchange;",
  "import com.sun.net.httpserver.HttpServer;",
  "import java.io.IOException;",
  "import java.io.OutputStream;",
  "import java.net.InetSocketAddress;",
  "import java.nio.charset.StandardCharsets;",
  "import java.sql.Connection;",
  "import java.sql.DriverManager;",
  "import java.sql.PreparedStatement;",
  "import java.sql.SQLException;",
  "import java.util.concurrent.Executors;",
  "import org.slf4j.Logger;",
  "import org.slf4j.LoggerFactory;",
  "",
  "public class App {",
  "  private static final Logger logger = LoggerFactory.getLogger(App.class);",
  '  private static final String DATABASE = "jdbc:h2:mem:shop;DB_CLOSE_DELAY=-1";',
  "  private static final PaymentService payments = new PaymentService();",
  "",
  "  public static void main(String[] args) throws Exception {",
  "    try (Connection connection = DriverManager.getConnection(DATABASE)) {",
  '      connection.createStatement().execute("CREATE TABLE users (id INT PRIMARY KEY, name VARCHAR(40))");',
  "      connection.createStatement().execute(\"INSERT INTO users VALUES (42, 'Ada')\");",
  '      connection.createStatement().execute("CREATE TABLE orders (id IDENTITY PRIMARY KEY, items INT)");',
  "    }",
  "",
  "    HttpServer server = HttpServer.create(new InetSocketAddress(8080), 0);",
  '    server.createContext("/healthz", exchange -> respond(exchange, 200, "ok"));',
  '    server.createContext("/users/", App::getUser);',
  '    server.createContext("/orders", App::placeOrder);',
  '    server.createContext("/boom", exchange -> {',
  '      throw new IllegalStateException("Payment provider timed out");',
  "    });",
  "    server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());",
  "    server.start();",
  '    logger.info("listening on http://localhost:8080");',
  "  }",
  "",
  "  static void getUser(HttpExchange exchange) throws IOException {",
  '    String id = exchange.getRequestURI().getPath().substring("/users/".length());',
  '    logger.info("loading user {}", id);',
  "    try (Connection connection = DriverManager.getConnection(DATABASE);",
  '        PreparedStatement query = connection.prepareStatement("SELECT name FROM users WHERE id = ?")) {',
  "      query.setInt(1, Integer.parseInt(id));",
  "      query.executeQuery();",
  "    } catch (SQLException error) {",
  "      throw new IOException(error);",
  "    }",
  '    respond(exchange, 200, "{\\"id\\":" + id + "}");',
  "  }",
  "",
  "  static void placeOrder(HttpExchange exchange) throws IOException {",
  "    try (Connection connection = DriverManager.getConnection(DATABASE);",
  '        PreparedStatement insert = connection.prepareStatement("INSERT INTO orders (items) VALUES (?)")) {',
  '      payments.charge("card", 2);',
  "      insert.setInt(1, 2);",
  "      insert.executeUpdate();",
  "    } catch (SQLException error) {",
  "      throw new IOException(error);",
  "    } catch (InterruptedException error) {",
  "      Thread.currentThread().interrupt();",
  "      throw new IOException(error);",
  "    }",
  '    respond(exchange, 201, "{\\"id\\":\\"ord_1001\\"}");',
  "  }",
  "",
  "  static void respond(HttpExchange exchange, int status, String body) throws IOException {",
  "    byte[] bytes = body.getBytes(StandardCharsets.UTF_8);",
  "    exchange.sendResponseHeaders(status, bytes.length);",
  "    try (OutputStream out = exchange.getResponseBody()) {",
  "      out.write(bytes);",
  "    }",
  "  }",
  "}",
].join("\n");

const logbackFile: string = [
  "<configuration>",
  '  <appender name="STDOUT" class="ch.qos.logback.core.ConsoleAppender">',
  "    <encoder>",
  `      ${logbackPattern.code}`,
  "    </encoder>",
  "  </appender>",
  '  <root level="INFO">',
  '    <appender-ref ref="STDOUT"/>',
  "  </root>",
  "</configuration>",
].join("\n");

export const JavaGuide: OpenTelemetryGuide = {
  slug: "java",
  seo: {
    title: "Java OpenTelemetry Agent: Traces, Metrics & Logs | OneUptime",
    description:
      "Add the OpenTelemetry Java agent to any JVM app: traces for HTTP, JDBC and messaging, JVM metrics and Logback or Log4j logs, sent to OneUptime with no code.",
  },
  h1: "OpenTelemetry for Java",
  lead: "Send traces, metrics and logs from any JVM application to OneUptime with the OpenTelemetry Java agent: one jar on the command line, no code change, and the libraries you already use traced from the first request. Add an annotation where you want spans of your own.",
  cardDescription:
    "Any JVM app with the Java agent: one jar, no code change; HTTP, JDBC, messaging, JVM metrics and logs.",
  searchTerms: [
    "javaagent",
    "java agent",
    "jvm",
    "jdbc",
    "logback",
    "log4j",
    "withspan",
    "zero-code",
  ],
  highlights: [
    "Zero-code with the Java agent",
    "Java 8 to 25",
    `Agent ${JAVA_AGENT_VERSION}`,
  ],

  whatYouGet: {
    intro: `Started with the agent, a JVM reports as one service, named by \`OTEL_SERVICE_NAME\`, in ${SCREENS.services} from its first request. The example is a service with no framework at all: the JDK's own HTTP server and client, JDBC and Logback.`,
    traces:
      "A server span per request, client spans for the JDK's `HttpClient`, OkHttp and Apache HttpClient, a span per JDBC statement, and spans for Kafka, RabbitMQ, gRPC and some 100 other libraries, all linked into one trace per request.",
    metrics:
      "The JVM's own health, from heap and non-heap memory by pool to garbage collection time, threads, classes and CPU, beside `http.server.request.duration` and `http.client.request.duration`.",
    logs: "Logback, Log4j 2 and `java.util.logging` records sent as they are written, each with the trace and span of the request that wrote it, and those IDs in the logger's MDC for your console pattern.",
    exceptions: `An exception that escapes a request is recorded on its span with the stack trace, which ${SCREENS.exceptions} groups by type and place. A log record written with an exception attached carries it too.`,
  },

  exampleTrace: {
    caption: "A POST /orders request, as its trace shows it",
    spans: [
      {
        name: "POST /orders",
        depth: 0,
        start: 0,
        duration: 100,
        source: "java-http-server",
      },
      {
        name: "checkout.charge",
        depth: 1,
        start: 4,
        duration: 88,
        source: "@WithSpan",
      },
      {
        name: "POST",
        depth: 2,
        start: 9,
        duration: 62,
        source: "java-http-client",
      },
      {
        name: "INSERT shop.orders",
        depth: 1,
        start: 93,
        duration: 5,
        source: "jdbc",
      },
    ],
  },

  prerequisites: [
    "Java 8 or later, which the agent supports. These steps were checked on Java 25 with Temurin.",
    "An application you start with `java`: a jar, a WAR in Tomcat or Jetty, or a framework with no guide here. Using Spring Boot, Quarkus, Micronaut or Ktor? Their guides cover what is particular to them.",
    SERVER_KEY_PREREQUISITE,
  ],

  install: {
    intro:
      "The agent is one jar. Download the release this guide was checked with, and keep it beside your application, or in your image:",
    snippets: [agent],
    notes: [
      "Pin the release in the URL, as here, rather than `latest`: an agent upgrade can rename spans and metrics, and should arrive in a change you review.",
      "The agent carries the OpenTelemetry SDK and every instrumentation inside it, shaded, so it never clashes with your application's own libraries.",
    ],
  },

  configure: {
    intro:
      "The agent reads the standard OpenTelemetry variables, so the endpoint and the key stay out of your command line:",
    tabs: otlpEnvironmentTabs({
      serviceName: "checkout-api",
      cloudNote:
        "The agent sends OTLP over HTTP by default, which is what OneUptime's `/otlp` endpoint takes: no protocol setting is needed.",
    }),
    notes: [
      "Keep the key in `OTEL_EXPORTER_OTLP_HEADERS`. The agent also takes `-Dotel.exporter.otlp.headers=...` on the command line, but it reports the JVM's command line as the `process.command_args` attribute of every span, so a key passed that way ends up in your telemetry.",
    ],
  },

  setup: {
    intro:
      "Load the agent when the JVM starts, with `-javaagent` on the command line or `JAVA_TOOL_OPTIONS` where you cannot change the command.",
    steps: [
      {
        title: "Start your application with the agent",
        body: "Add `-javaagent` before `-jar`, pointing at the jar you downloaded:",
        snippets: [run],
        notes: [
          "The agent loads before your `main` and instruments classes as they load. Expect startup to take a few seconds longer.",
          "The JVM may print `Sharing is only supported for boot loader classes because bootstrap classpath has been appended`: the agent turns part of class data sharing off. It is harmless.",
        ],
      },
      {
        title: "Or load it through JAVA_TOOL_OPTIONS",
        body: "Every JVM reads `JAVA_TOOL_OPTIONS` as it starts, so the agent loads without changing a launcher, a script or an image's command:",
        snippets: [toolOptions],
        notes: [
          "The JVM prints `Picked up JAVA_TOOL_OPTIONS` as it starts: a quick way to see the variable reached it.",
        ],
      },
      {
        title: "Add the API, for spans of your own",
        body: "The agent needs nothing in your build. To add spans and metrics of your own, as in the next sections, add the OpenTelemetry API and its annotations:",
        tabs: {
          group: "buildTool",
          tabs: [
            { label: "Maven", snippets: [mavenApi] },
            { label: "Gradle", snippets: [gradleApi] },
          ],
        },
        notes: [
          "Spans and logs leave in batches every few seconds, metrics once a minute, and the JVM sends what is still buffered as it shuts down.",
        ],
      },
    ],
  },

  autoInstrumentation: {
    intro:
      "The agent instruments what it finds, with nothing to configure. In a typical service:",
    rows: [
      {
        library: "HTTP servers",
        covers:
          "Servlet containers (Tomcat, Jetty, Undertow), Netty, the JDK's `HttpServer`, gRPC: a server span per request, with the route where the framework knows it.",
      },
      {
        library: "HTTP clients",
        covers:
          "The JDK's `HttpClient`, OkHttp, Apache HttpClient, gRPC: a client span per call, carrying `traceparent` to the service called.",
      },
      {
        library: "JDBC, R2DBC, Hibernate",
        covers:
          "A span per statement, named after the operation and the table (`SELECT shop.users`), with connection pool metrics for HikariCP and others.",
      },
      {
        library: "Kafka, RabbitMQ, JMS, SQS",
        covers:
          "Producer and consumer spans, with the trace carried in each message from the sender to the receiver.",
      },
      {
        library: "Logback, Log4j 2, `java.util.logging`",
        covers:
          "Every record sent as a log, with trace and span IDs, and those IDs in the MDC.",
      },
      {
        library: "Redis, MongoDB, Elasticsearch, AWS SDK",
        covers: "A client span per command, query or call.",
      },
    ],
    snippets: [selectiveInstrumentation],
    notes: [
      "Each instrumentation has a name you can turn it off by, such as `jdbc` or `logback-appender`:",
    ],
  },

  manualSpans: {
    intro:
      "Annotate a method with `@WithSpan`, and the agent makes a span of every call to it, wired to its own SDK at runtime:",
    snippets: [paymentService],
    notes: [
      "`@WithSpan` makes a span of every call to the method, named as you choose; `@SpanAttribute` adds a parameter's value as an attribute.",
      "`Span.current()` is the span the agent made for the method: set attributes on it, or record an exception with `recordException`.",
      "Find spans by those attributes in the **Traces** explorer, such as `@payment.method:card`.",
    ],
  },

  logs: {
    intro:
      "Logback, Log4j 2 and `java.util.logging` records are sent with no change. The agent also puts `trace_id` and `span_id` in the MDC, so your console lines can carry them too:",
    snippets: [logbackPattern],
    notes: [
      "A record written outside a request, at startup for instance, has no trace ID: there was no trace yet.",
      'Pass the exception to the logger, as `logger.error("payment failed", error)`: the record then carries its type, message and stack trace, and lands under **Exceptions**.',
      "Records go to OneUptime through the agent whatever your appenders are: keep your console or file appender as it is.",
    ],
  },

  metrics: {
    intro: "Exported every 60 seconds, with no code:",
    builtIn: [
      {
        name: "jvm.memory.used",
        description:
          "Memory used by pool, heap and non-heap: `jvm.memory.used_after_last_gc` beside it shows whether the heap really shrinks after a collection.",
      },
      {
        name: "jvm.gc.duration",
        description:
          "Time spent in garbage collection, by collector and action: long pauses explain slow requests with no slow code.",
      },
      {
        name: "jvm.thread.count",
        description:
          "Threads by state: daemon or not, runnable, blocked or waiting.",
      },
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
      "Your own instruments come from `GlobalOpenTelemetry.getMeter`, as `orders.placed` in `PaymentService` above: the agent sets the global instance up before your code runs.",
      "Keep attribute values to a small set: a value per customer makes a series per customer.",
    ],
  },

  sampling: {
    intro:
      "Everything is traced by default. On a busy service, keep a share of new traces:",
    snippets: [sampling],
    notes: [
      "`parentbased_traceidratio` keeps a quarter of new traces, and follows the caller's decision for requests that arrive with a `traceparent` header.",
      "Metrics and logs are not sampled.",
      "The agent has no switch to leave a path out, such as a health check: drop those spans with a [drop filter](/docs/telemetry/drop-filters-and-scrub-rules) in OneUptime.",
    ],
  },

  deploy: {
    intro:
      "Put the agent in the image and load it through `JAVA_TOOL_OPTIONS`, so the command stays as it is; give the container the key from a Kubernetes Secret:",
    snippets: [
      jvmDockerfileSnippet({
        jar: "target/checkout-api.jar",
        port: 8080,
        withAgent: true,
      }),
      kubernetesManifestSnippet({
        name: "checkout-api",
        image: "registry.example.com/checkout-api:1.8.0",
        containerPort: 8080,
      }),
    ],
    notes: [
      "On SIGTERM, the JVM runs its shutdown hooks, and the agent's sends what it still holds before the process exits.",
      "Give the container a little more memory: the agent adds tens of megabytes of classes and buffers.",
      "Pair it with the [Kubernetes agent](/docs/telemetry/kubernetes-agent) to watch each pod's memory beside the JVM's heap: a container killed for memory shows in both.",
    ],
  },

  verify: {
    intro: "Check in this order: each step rules out one cause.",
    steps: [
      validateKeyStep("server"),
      {
        title: "See the agent start",
        body: "The JVM's first lines include `opentelemetry-javaagent - version: 2.33.1`. No such line means the agent never loaded: check the path after `-javaagent`.",
      },
      {
        title: "Find the service and a trace",
        body: `Send a request, then open ${SCREENS.services}: \`checkout-api\` appears within a minute. In ${SCREENS.traces}, search \`checkout.charge\` to see the payment call beneath it.`,
      },
      {
        title: "Follow a log line to its request",
        body: `Open a \`loading user\` line in ${SCREENS.logs}: its trace ID opens the request that wrote it.`,
      },
    ],
  },

  troubleshooting: [
    {
      question:
        "The JVM will not start: “Error opening zip file or JAR manifest missing”",
      answer:
        "The path after `-javaagent:` does not point at the agent jar. Use an absolute path in scripts and images, such as `/otel/opentelemetry-javaagent.jar`.",
    },
    {
      question: "The ingestion key shows up in my spans",
      answer:
        "It was passed as `-Dotel.exporter.otlp.headers=...`, and the agent reports the command line as `process.command_args`. Move it to the `OTEL_EXPORTER_OTLP_HEADERS` environment variable, then rotate the key in OneUptime.",
    },
    {
      question: "Nothing arrives, and nothing is logged",
      answer:
        "Start with `OTEL_JAVAAGENT_DEBUG=true`: the agent logs each export and why one failed. Check that `OTEL_EXPORTER_OTLP_ENDPOINT` ends in `/otlp`, without `/v1/traces`: the agent adds that itself.",
    },
    {
      question: "Spans of my own methods are missing",
      answer:
        "`@WithSpan` works on methods of classes the agent sees load, called by your code. Check that `opentelemetry-instrumentation-annotations` is the agent's major version, and that `OTEL_INSTRUMENTATION_OPENTELEMETRY_INSTRUMENTATION_ANNOTATIONS_ENABLED` is not `false`.",
    },
    {
      question: "The exporter logs a 401",
      answer:
        "OneUptime refused the key: `OTEL_EXPORTER_OTLP_HEADERS` must be `x-oneuptime-token=` followed by a **Server** key's **Secret Key**, of the project you are looking at.",
    },
  ],

  faq: [
    {
      question: "Which Java versions does the agent support?",
      answer:
        "Java 8 and every later release; this guide was checked on Java 25. It works with any JVM language too, such as Kotlin and Scala.",
    },
    {
      question: "Does the agent work with virtual threads?",
      answer:
        "Yes: the trace follows a request onto the virtual thread that serves it, as the example's `Executors.newVirtualThreadPerTaskExecutor()` shows.",
    },
    {
      question: "Can I use it with a GraalVM native image?",
      answer:
        "No: a native image has no JVM to load an agent into. Use your framework's library instrumentation instead, such as the Spring Boot starter or Quarkus's extension, covered in the [Spring Boot](/integrations/opentelemetry/spring-boot) and [Quarkus](/integrations/opentelemetry/quarkus) guides.",
    },
    {
      question: "How much does it slow the application down?",
      answer:
        "Startup takes a few seconds longer while classes are instrumented; after that, each span costs microseconds and exports run on a background thread. Measure on your own traffic, and turn off instrumentations you do not need.",
    },
  ],

  related: ["spring-boot", "quarkus", "micronaut", "ktor"],
  docs: [DOCS.openTelemetry, DOCS.traces, DOCS.logs, DOCS.metrics],

  verification: {
    runtime: "jvm",
    framework: { name: "Java" },
    files: [
      { path: "pom.xml", content: pomFile },
      { path: "src/main/java/com/example/checkout/App.java", content: appFile },
      {
        path: "src/main/java/com/example/checkout/PaymentService.java",
        snippet: "payment-service",
      },
      { path: "src/main/resources/logback.xml", content: logbackFile },
    ],
    stubApiPort: 9000,
    commands: [
      { snippet: "agent" },
      { command: "mvn -q -B package -DskipTests" },
      { snippet: "run", isServer: true },
    ],
    port: 8080,
    requests: [
      { method: "GET", path: "/healthz" },
      { method: "GET", path: "/users/42" },
      { method: "POST", path: "/orders", body: { items: ["kettle"] } },
      { method: "GET", path: "/boom" },
    ],
    expect: {
      spans: [
        { name: "GET /users/", attributes: { "http.route": "/users/" } },
        { name: "SELECT shop.users", attributes: { "db.system": "h2" } },
        {
          name: "checkout.charge",
          attributes: { "payment.method": "card", "order.item_count": "2" },
        },
        { name: "POST", attributes: { "http.request.method": "POST" } },
        {
          name: "GET /boom",
          hasException: true,
          exceptionMessage: "Payment provider timed out",
        },
      ],
      metrics: [
        "jvm.memory.used",
        "jvm.gc.duration",
        "jvm.thread.count",
        "http.server.request.duration",
        "http.client.request.duration",
        "orders.placed",
      ],
      logs: [{ body: "loading user 42", hasTraceContext: true }],
      resource: { "service.name": "checkout-api" },
    },
    variants: [
      {
        // The instrumentation switches, as the page names them.
        name: "Instrumentations off",
        files: [
          { path: "pom.xml", content: pomFile },
          {
            path: "src/main/java/com/example/checkout/App.java",
            content: appFile,
          },
          {
            path: "src/main/java/com/example/checkout/PaymentService.java",
            snippet: "payment-service",
          },
          { path: "src/main/resources/logback.xml", content: logbackFile },
        ],
        stubApiPort: 9000,
        environmentSnippets: ["selective"],
        commands: [
          { snippet: "agent" },
          { command: "mvn -q -B package -DskipTests" },
          { snippet: "run", isServer: true },
        ],
        port: 8080,
        requests: [
          { method: "GET", path: "/users/42" },
          { method: "POST", path: "/orders", body: { items: ["kettle"] } },
        ],
        expect: {
          spans: [
            { name: "GET /users/", attributes: { "http.route": "/users/" } },
            { name: "POST /orders" },
          ],
          metrics: ["http.server.request.duration"],
          logs: [],
          absentSpans: ["SELECT shop.users", "INSERT shop.orders", "POST"],
        },
      },
    ],
  },
};
