import { GuideSnippet, InlineText } from "./GuideTypes";

/*
 * The Elixir guides' shared facts: the Hex packages they add, at the
 * versions the end-to-end check ran (Verifications.json records the
 * versions mix.lock resolved, and Tests/OpenTelemetryGuides holds every
 * mix.exs line to them), the lines that send metrics and logs, and the
 * image the guides build.
 *
 * OpenTelemetry for Erlang and Elixir, October 2026: the API (1.5) and the
 * SDK (1.7) for traces are stable; metrics and logs come from the
 * experimental packages (0.6), set up in config/runtime.exs and as a
 * :logger handler. Neither experimental part sends at shutdown, so their
 * export intervals bound what a stopping node loses.
 */
export const ELIXIR_PACKAGE_VERSIONS: Record<string, string> = {
  opentelemetry_api: "1.5.0",
  opentelemetry: "1.7.0",
  opentelemetry_exporter: "1.11.0",
  opentelemetry_api_experimental: "0.6.0",
  opentelemetry_experimental: "0.6.0",
  opentelemetry_req: "1.0.0",
  opentelemetry_process_propagator: "0.3.0",
  opentelemetry_bandit: "0.3.0",
  opentelemetry_phoenix: "2.0.1",
  opentelemetry_ecto: "1.2.0",
  // The apps' own packages, as the checks ran them.
  req: "0.7.5",
  phx_new: "1.8.16",
};

export const ELIXIR_VERSION: string = "1.20";
export const ERLANG_OTP_VERSION: string = "29";

// Every Elixir guide's first prerequisite.
export const ELIXIR_PREREQUISITE: InlineText = `Elixir 1.15 or later with Mix, the oldest that Req supports. These steps were checked with Elixir ${ELIXIR_VERSION} on Erlang/OTP ${ERLANG_OTP_VERSION}.`;

// A dependency of mix.exs at its pinned version: {:opentelemetry, "1.7.0"}.
export function mixDependency(name: string): string {
  const version: string | undefined = ELIXIR_PACKAGE_VERSIONS[name];

  if (!version) {
    throw new Error(`No pinned version for ${name}`);
  }

  return `{:${name}, "${version}"}`;
}

/*
 * The packages every Elixir guide adds: the API and the SDK, the OTLP
 * exporter, and the experimental API and SDK that send metrics and logs.
 */
export const ELIXIR_OPENTELEMETRY_PACKAGES: ReadonlyArray<string> = [
  "opentelemetry_api",
  "opentelemetry",
  "opentelemetry_exporter",
];

export const ELIXIR_EXPERIMENTAL_PACKAGES: ReadonlyArray<string> = [
  "opentelemetry_api_experimental",
  "opentelemetry_experimental",
];

/*
 * Lines of a deps list as `mix new` indents them, a comma after each but
 * the last: the last line of the list ends without one.
 */
export function mixDependencyLines(
  names: ReadonlyArray<string>,
  options: { endsTheList: boolean },
): Array<string> {
  return names.map((name: string, index: number): string => {
    const isLast: boolean = index === names.length - 1;

    return `      ${mixDependency(name)}${isLast && options.endsTheList ? "" : ","}`;
  });
}

export const MIX_DEPS_GET_SNIPPET: GuideSnippet = {
  id: "deps-get",
  language: "bash",
  code: "mix deps.get",
  check: "run",
};

/*
 * The metric reader, in config/runtime.exs: the experimental SDK reads no
 * OTEL_METRIC_EXPORT_INTERVAL of its own, so the file reads it.
 */
export const METRIC_READER_CONFIG_LINES: ReadonlyArray<string> = [
  "config :opentelemetry_experimental,",
  "  readers: [",
  "    %{",
  "      module: :otel_metric_reader,",
  "      config: %{",
  "        exporter: {:otel_exporter_metrics_otlp, %{protocol: :http_protobuf}},",
  "        export_interval_ms:",
  '          String.to_integer(System.get_env("OTEL_METRIC_EXPORT_INTERVAL", "60000"))',
  "      }",
  "    }",
  "  ]",
];

/*
 * The :logger handler that sends Logger's events as log records, as the
 * first lines of an application's start/2, under the given comment.
 */
export function logHandlerLines(comment: string): Array<string> {
  return [
    `    # ${comment}`,
    "    :ok =",
    "      :logger.add_handler(:opentelemetry, :otel_log_handler, %{",
    "        exporter: {:otel_exporter_logs_otlp, %{protocol: :http_protobuf}},",
    "        scheduled_delay_ms: 1_000",
    "      })",
  ];
}

/*
 * The release's application list, in mix.exs's project/0: the exporter
 * must start before the SDK, and the SDK is temporary, so that a crash of
 * it stops nothing else.
 */
export function releaseLines(release: string): Array<string> {
  return [
    "      releases: [",
    `        ${release}: [`,
    "          # The exporter starts before the SDK; a crash of the SDK stops nothing else.",
    "          applications: [opentelemetry_exporter: :permanent, opentelemetry: :temporary]",
    "        ]",
    "      ]",
  ];
}

/*
 * The Dockerfile of an app with no Phoenix: the release built in the
 * Elixir image, run from Debian slim with the libraries the runtime links.
 */
export function elixirDockerfileSnippet(release: string): GuideSnippet {
  return {
    id: "dockerfile",
    language: "dockerfile",
    title: "Dockerfile",
    code: [
      `FROM elixir:${ELIXIR_VERSION}-otp-${ERLANG_OTP_VERSION} AS build`,
      "ENV MIX_ENV=prod",
      "WORKDIR /app",
      "RUN mix local.hex --force && mix local.rebar --force",
      "COPY mix.exs mix.lock ./",
      "RUN mix deps.get --only prod",
      "COPY config config",
      "COPY lib lib",
      "RUN mix release",
      "",
      "FROM debian:trixie-slim",
      "RUN apt-get update \\",
      "  && apt-get install -y --no-install-recommends \\",
      "    libstdc++6 openssl libncurses6 ca-certificates \\",
      "  && rm -rf /var/lib/apt/lists/*",
      "ENV LANG=C.UTF-8",
      "WORKDIR /app",
      "RUN chown nobody /app",
      `COPY --from=build --chown=nobody:root /app/_build/prod/rel/${release} ./`,
      "USER nobody",
      `CMD ["/app/bin/${release}", "start"]`,
    ].join("\n"),
    check: "parse",
  };
}
