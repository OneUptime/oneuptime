import { GuideSnippet } from "./GuideTypes";

/*
 * The Java and Kotlin guides' shared facts: the Java agent and the
 * libraries they add, at the versions the end-to-end check ran
 * (Verifications.json records the versions the builds resolved, and
 * Tests/OpenTelemetryGuides holds every pinned version to them), keyed as
 * Maven names them - group:artifact - and Gradle plugins by their id.
 *
 * OpenTelemetry Java, October 2026: the API and SDK are 1.67.0, the agent
 * and the instrumentation libraries 2.33.1 (their unstable artifacts
 * 2.33.1-alpha). The agent runs on Java 8 or later.
 */
export const JAVA_AGENT_VERSION: string = "2.33.1";

export const JVM_PACKAGE_VERSIONS: Record<string, string> = {
  "io.opentelemetry.javaagent:opentelemetry-javaagent": JAVA_AGENT_VERSION,
  "io.opentelemetry.instrumentation:opentelemetry-instrumentation-annotations":
    "2.33.1",
  "io.opentelemetry.instrumentation:opentelemetry-instrumentation-bom":
    "2.33.1",
  "io.opentelemetry.instrumentation:opentelemetry-instrumentation-bom-alpha":
    "2.33.1-alpha",
  "io.opentelemetry:opentelemetry-bom": "1.67.0",
  "io.opentelemetry:opentelemetry-api": "1.67.0",
  // The frameworks' own build parents and plugins, as the checks built them.
  "org.springframework.boot:spring-boot-starter-parent": "4.1.2",
  "io.micronaut.platform:micronaut-parent": "5.2.4",
  "io.ktor.plugin": "3.6.0",
  "org.jetbrains.kotlin.jvm": "2.4.21",
  "org.jetbrains.kotlin.plugin.serialization": "2.4.21",
};

// Where a release of the agent is published.
export const JAVA_AGENT_URL: string = `https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/download/v${JAVA_AGENT_VERSION}/opentelemetry-javaagent.jar`;

// The agent, downloaded at the version the guides were checked with.
export function javaAgentDownloadSnippet(id: string = "agent"): GuideSnippet {
  return {
    id: id,
    language: "bash",
    title: "Download the agent",
    code: `curl -L -o opentelemetry-javaagent.jar \\\n  ${JAVA_AGENT_URL}`,
    check: "run",
  };
}

export interface JvmDockerfileOptions {
  // The jar the build makes, copied into the image: "target/checkout-api.jar".
  jar: string;
  port: number;
  /*
   * true: the image carries the agent, which the JVM loads through
   * JAVA_TOOL_OPTIONS, so neither the command nor the app changes.
   */
  withAgent: boolean;
}

/*
 * A Java 25 runtime image that runs the app's jar, with the agent where
 * the guide uses one. JAVA_TOOL_OPTIONS loads it for any java command the
 * container runs, and leaves it out by being unset.
 */
export function jvmDockerfileSnippet(
  options: JvmDockerfileOptions,
): GuideSnippet {
  const lines: Array<string> = [
    "FROM eclipse-temurin:25-jre",
    "WORKDIR /app",
    ...(options.withAgent
      ? [
          `ADD ${JAVA_AGENT_URL} /otel/opentelemetry-javaagent.jar`,
          'ENV JAVA_TOOL_OPTIONS="-javaagent:/otel/opentelemetry-javaagent.jar"',
        ]
      : []),
    `COPY ${options.jar} app.jar`,
    `EXPOSE ${options.port}`,
    'CMD ["java", "-jar", "app.jar"]',
  ];

  return {
    id: "dockerfile",
    language: "dockerfile",
    title: "Dockerfile",
    code: lines.join("\n"),
    check: "parse",
  };
}
