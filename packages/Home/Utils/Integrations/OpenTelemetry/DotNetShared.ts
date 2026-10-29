import { GuideSnippet, InlineText } from "./GuideTypes";

/*
 * The .NET guides' shared facts: the NuGet packages they add, at the
 * versions the end-to-end check ran (Verifications.json records the
 * versions the restore resolved, and Tests/OpenTelemetryGuides holds every
 * `dotnet add package` and project file to them), the projects the checks
 * start from, and the sentences every .NET guide states the same way.
 *
 * OpenTelemetry .NET, October 2026: the SDK, the exporter and the stable
 * instrumentations are 1.20.1; the Entity Framework Core instrumentation is
 * still a beta (1.20.1-beta.1); the zero-code automatic instrumentation is
 * 1.18.0. They were checked on .NET 10, the current long-term release.
 */
export const DOTNET_PACKAGE_VERSIONS: Record<string, string> = {
  OpenTelemetry: "1.20.1",
  "OpenTelemetry.Extensions.Hosting": "1.20.1",
  "OpenTelemetry.Exporter.OpenTelemetryProtocol": "1.20.1",
  "OpenTelemetry.Instrumentation.AspNetCore": "1.20.1",
  "OpenTelemetry.Instrumentation.Http": "1.20.1",
  "OpenTelemetry.Instrumentation.Runtime": "1.20.1",
  "OpenTelemetry.Instrumentation.EntityFrameworkCore": "1.20.1-beta.1",
  "OpenTelemetry.AutoInstrumentation": "1.18.0",
  // The Microsoft packages the guides' apps add beside them.
  "Microsoft.EntityFrameworkCore.Sqlite": "10.0.14",
  "Microsoft.Extensions.Http": "10.0.14",
  "Microsoft.Extensions.Logging.Console": "10.0.14",
};

// Every .NET guide's first prerequisite.
export const DOTNET_PREREQUISITE: InlineText =
  "The .NET SDK 8 or later, which OpenTelemetry .NET 1.20 supports. These steps were checked on .NET 10, the current long-term release.";

// Why the .NET guides set the protocol, the same fact on every page.
export const DOTNET_PROTOCOL_NOTE: InlineText =
  "The .NET OTLP exporter speaks gRPC unless `OTEL_EXPORTER_OTLP_PROTOCOL` says otherwise, and OneUptime's `/otlp` endpoint takes OTLP over HTTP: without the last line, nothing arrives, and the exporter does not say why.";

// A `dotnet add package` per package, at its pinned version.
export function dotnetAddPackageSnippet(
  id: string,
  packages: Array<string>,
): GuideSnippet {
  return {
    id: id,
    language: "bash",
    code: packages
      .map((name: string): string => {
        const version: string | undefined = DOTNET_PACKAGE_VERSIONS[name];

        if (!version) {
          throw new Error(`No pinned version for ${name}`);
        }

        return `dotnet add package ${name} --version ${version}`;
      })
      .join("\n"),
    check: "run",
  };
}

/*
 * The project files the checks start from, as `dotnet new console`, `web`
 * and `worker` write them for .NET 10; the guide's `dotnet add package`
 * commands then add the packages, as they would in the reader's project.
 */
function projectFile(sdk: string, properties: Array<string>): string {
  return [
    `<Project Sdk="${sdk}">`,
    "",
    "  <PropertyGroup>",
    ...properties.map((property: string): string => {
      return `    ${property}`;
    }),
    "  </PropertyGroup>",
    "",
    "</Project>",
  ].join("\n");
}

export function dotnetConsoleProjectFile(): string {
  return projectFile("Microsoft.NET.Sdk", [
    "<OutputType>Exe</OutputType>",
    "<TargetFramework>net10.0</TargetFramework>",
    "<ImplicitUsings>enable</ImplicitUsings>",
    "<Nullable>enable</Nullable>",
  ]);
}

export function dotnetWebProjectFile(): string {
  return projectFile("Microsoft.NET.Sdk.Web", [
    "<TargetFramework>net10.0</TargetFramework>",
    "<Nullable>enable</Nullable>",
    "<ImplicitUsings>enable</ImplicitUsings>",
  ]);
}

export function dotnetWorkerProjectFile(): string {
  return projectFile("Microsoft.NET.Sdk.Worker", [
    "<TargetFramework>net10.0</TargetFramework>",
    "<Nullable>enable</Nullable>",
    "<ImplicitUsings>enable</ImplicitUsings>",
  ]);
}

export interface DotNetDockerfileOptions {
  // The assembly `dotnet publish` makes: "Checkout.dll".
  assembly: string;
  port: number;
  // The runtime image: aspnet for a web app, runtime for a worker or a job.
  runtimeImage: "aspnet" | "runtime";
  /*
   * true: the app carries the zero-code instrumentation's NuGet package, so
   * it is published for Linux on x64 and started through instrument.sh.
   */
  zeroCode?: boolean | undefined;
}

/*
 * Two stages: the SDK image publishes the app, the runtime image runs it
 * (without the SDK, a quarter of the size).
 */
export function dotnetDockerfileSnippet(
  options: DotNetDockerfileOptions,
): GuideSnippet {
  const lines: Array<string> = [
    "FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build",
    "WORKDIR /src",
    "COPY . .",
    options.zeroCode
      ? "RUN dotnet publish -c Release -r linux-x64 -o /app"
      : "RUN dotnet publish -c Release -o /app",
    "",
    `FROM mcr.microsoft.com/dotnet/${options.runtimeImage}:10.0`,
    "WORKDIR /app",
    "COPY --from=build /app .",
    ...(options.runtimeImage === "aspnet" ? [`EXPOSE ${options.port}`] : []),
    options.zeroCode
      ? `ENTRYPOINT ["sh", "./instrument.sh", "dotnet", "${options.assembly}"]`
      : `ENTRYPOINT ["dotnet", "${options.assembly}"]`,
  ];

  return {
    id: "dockerfile",
    language: "dockerfile",
    title: "Dockerfile",
    code: lines.join("\n"),
    check: "parse",
  };
}
