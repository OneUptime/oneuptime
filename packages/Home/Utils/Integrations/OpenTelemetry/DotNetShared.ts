import { GuideSnippet } from "./GuideTypes";

/*
 * The .NET guides' shared facts: the NuGet packages they add, at the
 * versions the end-to-end check ran (Verifications.json records the
 * versions the restore resolved, and Tests/OpenTelemetryGuides holds every
 * `dotnet add package` and project file to them).
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
  "OpenTelemetry.Instrumentation.SqlClient": "1.20.1",
  "OpenTelemetry.Instrumentation.EntityFrameworkCore": "1.20.1-beta.1",
  "OpenTelemetry.AutoInstrumentation": "1.18.0",
  // The Microsoft packages the guides' apps add beside them.
  "Microsoft.EntityFrameworkCore.Sqlite": "10.0.14",
  "Microsoft.Extensions.Http": "10.0.14",
  "Microsoft.Extensions.Logging.Console": "10.0.14",
};

// The .NET the guides were checked on, and the oldest the SDK 1.20 supports.
export const DOTNET_VERSION: string = "10";

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

export interface DotNetDockerfileOptions {
  // The assembly `dotnet publish` makes: "Checkout.dll".
  assembly: string;
  port: number;
  // The runtime image: aspnet for a web app, runtime for a worker or a job.
  runtimeImage: "aspnet" | "runtime";
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
    "RUN dotnet publish -c Release -o /app",
    "",
    `FROM mcr.microsoft.com/dotnet/${options.runtimeImage}:10.0`,
    "WORKDIR /app",
    "COPY --from=build /app .",
    ...(options.runtimeImage === "aspnet" ? [`EXPOSE ${options.port}`] : []),
    `ENTRYPOINT ["dotnet", "${options.assembly}"]`,
  ];

  return {
    id: "dockerfile",
    language: "dockerfile",
    title: "Dockerfile",
    code: lines.join("\n"),
    check: "parse",
  };
}
