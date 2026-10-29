import {
  InstalledPackage,
  bracketProblems,
  buildFileDependencies,
  gradleReportVersions,
  installedPackages,
  isBuildFileSnippet,
  javaAgentDownload,
  mavenReportVersions,
} from "../Utils/Integrations/OpenTelemetry/GuideCodeChecks";
import { GuideSnippet } from "../Utils/Integrations/OpenTelemetry/GuideTypes";
import { FastestRun, fastestRun } from "Common/Tests/Helpers/FastestRun";
import { describe, expect, test } from "@jest/globals";

/*
 * How the guides' checks read code in the languages the guides added after
 * JavaScript: pip, Maven, Gradle and NuGet installs, a pom's and a
 * project file's dependencies, the reports Maven and Gradle print of what
 * they resolved, and C#'s and Kotlin's strings. Tests/OpenTelemetryGuides
 * runs these over every guide; here each is held to the cases that broke,
 * or would have, one at a time.
 */

function snippet(
  title: string,
  language: GuideSnippet["language"],
  code: string,
): GuideSnippet {
  return {
    id: "s",
    title: title,
    language: language,
    code: code,
    check: "parse",
  };
}

function named(packages: Array<InstalledPackage>): Array<string> {
  return packages.map((item: InstalledPackage): string => {
    return `${item.ecosystem} ${item.name}@${item.version || "managed"}`;
  });
}

describe("the packages an install command adds", () => {
  test("pip pins with ==, keeps a requirement's extras off its name, and never reads -r's file", () => {
    expect(
      named(
        installedPackages(
          [
            'pip install "celery[redis]==5.6.3" \\',
            "  opentelemetry-distro==0.66b1 -r requirements.txt django>=6",
          ].join("\n"),
        ),
      ),
    ).toEqual([
      "pypi celery@5.6.3",
      "pypi opentelemetry-distro@0.66b1",
      "pypi django@managed",
    ]);
  });

  test("dotnet add package, with or without a project and with either version flag", () => {
    expect(
      named(
        installedPackages(
          [
            "dotnet add package OpenTelemetry --version 1.20.1",
            "dotnet add Checkout.csproj package OpenTelemetry.Instrumentation.Http -v 1.20.1",
            "dotnet add package Microsoft.Extensions.Http",
          ].join("\n"),
        ),
      ),
    ).toEqual([
      "nuget OpenTelemetry@1.20.1",
      "nuget OpenTelemetry.Instrumentation.Http@1.20.1",
      "nuget Microsoft.Extensions.Http@managed",
    ]);
  });

  test("the Java agent, by the release its download names", () => {
    const url: string =
      "https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/download/v2.33.1/opentelemetry-javaagent.jar";

    expect(javaAgentDownload(url)).toEqual({
      name: "io.opentelemetry.javaagent:opentelemetry-javaagent",
      version: "2.33.1",
      ecosystem: "maven",
    });
    expect(
      named(
        installedPackages(
          `curl -L -o opentelemetry-javaagent.jar \\\n  ${url}`,
        ),
      ),
    ).toEqual([
      "maven io.opentelemetry.javaagent:opentelemetry-javaagent@2.33.1",
    ]);
    expect(
      javaAgentDownload("https://example.com/download/v1/other.jar"),
    ).toBeUndefined();
  });
});

describe("the dependencies a build file declares", () => {
  test("knows a pom, a Gradle build in Kotlin and a .csproj by their titles", () => {
    expect(isBuildFileSnippet(snippet("pom.xml", "xml", ""))).toBe(true);
    expect(isBuildFileSnippet(snippet("build.gradle.kts", "kotlin", ""))).toBe(
      true,
    );
    expect(isBuildFileSnippet(snippet("Checkout.csproj", "xml", ""))).toBe(
      true,
    );
    expect(isBuildFileSnippet(snippet("logback.xml", "xml", ""))).toBe(false);
    expect(isBuildFileSnippet(snippet("Telemetry.kt", "kotlin", ""))).toBe(
      false,
    );
  });

  test("reads a plugin's own version, never that of an annotation processor inside it", () => {
    const pom: string = [
      "<plugin>",
      "  <groupId>org.apache.maven.plugins</groupId>",
      "  <artifactId>maven-compiler-plugin</artifactId>",
      "  <configuration>",
      "    <annotationProcessorPaths>",
      "      <path>",
      "        <groupId>io.micronaut</groupId>",
      "        <artifactId>micronaut-inject-java</artifactId>",
      "        <version>${micronaut.core.version}</version>",
      "      </path>",
      "    </annotationProcessorPaths>",
      "  </configuration>",
      "</plugin>",
    ].join("\n");

    expect(
      named(buildFileDependencies(snippet("pom.xml", "xml", pom))),
    ).toEqual(["maven org.apache.maven.plugins:maven-compiler-plugin@managed"]);
  });

  test("puts the pom's own properties into coordinates and versions", () => {
    const pom: string = [
      "<project>",
      "  <properties>",
      "    <quarkus.platform.group-id>io.quarkus.platform</quarkus.platform.group-id>",
      "    <!-- the platform this guide was checked with -->",
      "    <quarkus.platform.version>3.40.1.1</quarkus.platform.version>",
      "  </properties>",
      "  <dependencyManagement>",
      "    <dependencies>",
      "      <dependency>",
      "        <groupId>${quarkus.platform.group-id}</groupId>",
      "        <artifactId>quarkus-bom</artifactId>",
      "        <version>${quarkus.platform.version}</version>",
      "        <type>pom</type>",
      "      </dependency>",
      "    </dependencies>",
      "  </dependencyManagement>",
      "  <dependencies>",
      "    <dependency>",
      "      <groupId>io.quarkus</groupId>",
      "      <artifactId>quarkus-opentelemetry</artifactId>",
      "    </dependency>",
      "    <dependency>",
      "      <groupId>io.example</groupId>",
      "      <artifactId>from-the-parent</artifactId>",
      "      <version>${parent.only.version}</version>",
      "    </dependency>",
      "  </dependencies>",
      "</project>",
    ].join("\n");

    expect(
      named(buildFileDependencies(snippet("pom.xml", "xml", pom))),
    ).toEqual([
      "maven io.quarkus.platform:quarkus-bom@3.40.1.1",
      "maven io.quarkus:quarkus-opentelemetry@managed",
      // A property the pom does not define stays as written.
      "maven io.example:from-the-parent@${parent.only.version}",
    ]);
  });

  test("reads a parent, and a plugin with no group as Maven's own", () => {
    const pom: string = [
      "<parent>",
      "  <groupId>io.micronaut.platform</groupId>",
      "  <artifactId>micronaut-parent</artifactId>",
      "  <version>5.2.4</version>",
      "</parent>",
      "<plugin>",
      "  <artifactId>maven-surefire-plugin</artifactId>",
      "  <version>3.5.4</version>",
      "</plugin>",
    ].join("\n");

    expect(
      named(buildFileDependencies(snippet("pom.xml", "xml", pom))),
    ).toEqual([
      "maven io.micronaut.platform:micronaut-parent@5.2.4",
      "maven org.apache.maven.plugins:maven-surefire-plugin@3.5.4",
    ]);
  });

  test("reads a Gradle build's platforms, libraries and plugins", () => {
    const build: string = [
      "plugins {",
      '    kotlin("jvm") version "2.4.21"',
      '    id("io.ktor.plugin") version "3.6.0"',
      "}",
      "dependencies {",
      "    // A comment naming io.example:commented-out:1.0 is not a dependency.",
      '    implementation(platform("io.opentelemetry:opentelemetry-bom:1.67.0"))',
      '    implementation("io.opentelemetry.instrumentation:opentelemetry-ktor-3.0")',
      "}",
    ].join("\n");

    expect(
      named(
        buildFileDependencies(snippet("build.gradle.kts", "kotlin", build)),
      ),
    ).toEqual([
      "maven org.jetbrains.kotlin.jvm@2.4.21",
      "maven io.ktor.plugin@3.6.0",
      "maven io.opentelemetry:opentelemetry-bom@1.67.0",
      "maven io.opentelemetry.instrumentation:opentelemetry-ktor-3.0@managed",
    ]);
  });

  test("reads a project file's package references", () => {
    const project: string = [
      '<Project Sdk="Microsoft.NET.Sdk.Web">',
      "  <ItemGroup>",
      '    <PackageReference Include="OpenTelemetry.Extensions.Hosting" Version="1.20.1" />',
      '    <PackageReference Include="Microsoft.EntityFrameworkCore.Sqlite" />',
      "  </ItemGroup>",
      "</Project>",
    ].join("\n");

    expect(
      named(buildFileDependencies(snippet("Checkout.csproj", "xml", project))),
    ).toEqual([
      "nuget OpenTelemetry.Extensions.Hosting@1.20.1",
      "nuget Microsoft.EntityFrameworkCore.Sqlite@managed",
    ]);
  });
});

describe("what Maven and Gradle report they resolved", () => {
  test("Maven's dependency:list: each jar or pom, a classifier's too, by group and artifact", () => {
    const report: string = [
      "",
      "The following files have been resolved:",
      "   io.quarkus:quarkus-opentelemetry:jar:3.40.1.1:compile -- module quarkus.opentelemetry (auto)",
      "   io.netty:netty-transport-native-epoll:jar:linux-x86_64:4.2.17.Final:runtime",
      "   io.quarkus.platform:quarkus-bom:pom:3.40.1.1:import",
      "   not:a:coordinate",
    ].join("\n");

    expect(mavenReportVersions(report)).toEqual({
      "io.quarkus:quarkus-opentelemetry": "3.40.1.1",
      "io.netty:netty-transport-native-epoll": "4.2.17.Final",
      "io.quarkus.platform:quarkus-bom": "3.40.1.1",
    });
  });

  test("Gradle's trees: the version a line names, or the one its arrow says Gradle picked", () => {
    const report: string = [
      "runtimeClasspath - Runtime classpath of 'main'.",
      "+--- org.jetbrains.kotlin:kotlin-stdlib:2.4.21",
      "|    \\--- org.jetbrains:annotations:13.0 -> 23.0.0",
      "+--- io.ktor:ktor-server-netty -> 3.6.0",
      "|    +--- io.ktor:ktor-server-core:3.6.0 (c)",
      "+--- project :shared",
      "\\--- io.ktor.plugin:io.ktor.plugin.gradle.plugin:3.6.0",
      "+--- nogroupdot:artifact:1.0",
    ].join("\n");

    expect(gradleReportVersions(report)).toEqual({
      "org.jetbrains.kotlin:kotlin-stdlib": "2.4.21",
      "org.jetbrains:annotations": "23.0.0",
      "io.ktor:ktor-server-netty": "3.6.0",
      "io.ktor:ktor-server-core": "3.6.0",
      // A plugin's marker artifact is the plugin, by its id.
      "io.ktor.plugin": "3.6.0",
    });
  });

  test("read a report in time that grows with its length, whatever is in it", () => {
    // What took the earlier patterns the square of their length: long runs that never finish a coordinate.
    const maven: string = `${"a".repeat(400000)}o:jar:r:m`;
    const gradle: string = `${".".repeat(400000)}.\u0000.:-`;

    for (const [read, report] of [
      [mavenReportVersions, maven],
      [gradleReportVersions, gradle],
    ] as Array<[(text: string) => Record<string, string>, string]>) {
      const timed: FastestRun<Record<string, string>> = fastestRun({
        run: (): Record<string, string> => {
          return read(report);
        },
        limitInMs: 2000,
      });

      expect(timed.inMs).toBeLessThan(2000);
    }
  });
});

describe("the strings of C# and Kotlin", () => {
  test("C#'s holes, verbatim strings and doubled braces parse", () => {
    expect(
      bracketProblems(
        [
          'var a = $"Synced {invoices.Items.Length} invoices";',
          'var b = @"C:\\logs\\""quoted""";',
          'var c = $"{{literal}} and {Format(new { id = 1 })}";',
        ].join("\n"),
        "csharp",
      ),
    ).toEqual([]);
    expect(bracketProblems('var d = $"{open";', "csharp")).not.toEqual([]);
  });

  test("Kotlin's templates with strings and braces inside parse", () => {
    expect(
      bracketProblems(
        [
          'val a = "SkipHealthChecks(${next.description})"',
          'val b = "${mapOf("id" to 1)["id"]} and $plain"',
        ].join("\n"),
        "kotlin",
      ),
    ).toEqual([]);
    expect(bracketProblems('val c = "${open"', "kotlin")).not.toEqual([]);
  });
});
