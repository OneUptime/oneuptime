import { GuideSnippet, InlineText } from "./GuideTypes";

/*
 * The Ruby guides' shared facts: the gems they add, at the versions the
 * end-to-end check ran (Verifications.json records the versions
 * Gemfile.lock resolved, and Tests/OpenTelemetryGuides holds every Gemfile
 * line to them), the requires that load the SDK for each signal, the hook
 * that sends what is left as Ruby exits, and the image the guides build.
 *
 * OpenTelemetry Ruby, October 2026: the API 1.11 and the SDK 1.13 are
 * stable for traces; the metrics SDK (0.22) and the logs SDK (0.8) are
 * still 0.x, each with an OTLP exporter of its own. Every gem needs Ruby
 * 3.3 or later.
 */
export const RUBY_PACKAGE_VERSIONS: Record<string, string> = {
  "opentelemetry-sdk": "1.13.1",
  "opentelemetry-exporter-otlp": "0.37.0",
  "opentelemetry-instrumentation-all": "0.99.0",
  "opentelemetry-metrics-sdk": "0.22.0",
  "opentelemetry-exporter-otlp-metrics": "0.15.0",
  "opentelemetry-logs-sdk": "0.8.1",
  "opentelemetry-exporter-otlp-logs": "0.7.0",
  "opentelemetry-instrumentation-logger": "0.5.0",
  // The apps' own gems, as the checks ran them.
  pg: "1.7.0",
  sinatra: "4.2.1",
  puma: "8.0.2",
  redis: "6.0.0",
  rails: "8.1.4",
  sidekiq: "8.1.7",
};

// The gems every Ruby guide adds, in the order its Gemfile lists them.
export const RUBY_OPENTELEMETRY_GEMS: ReadonlyArray<string> = [
  "opentelemetry-sdk",
  "opentelemetry-exporter-otlp",
  "opentelemetry-instrumentation-all",
  "opentelemetry-metrics-sdk",
  "opentelemetry-exporter-otlp-metrics",
  "opentelemetry-logs-sdk",
  "opentelemetry-exporter-otlp-logs",
  "opentelemetry-instrumentation-logger",
];

export const RUBY_VERSION: string = "4.0";

// Every Ruby guide's first prerequisite.
export const RUBY_PREREQUISITE: InlineText = `Ruby 3.3 or later, which OpenTelemetry Ruby 1.13 needs, and Bundler. These steps were checked with Ruby ${RUBY_VERSION}.`;

// A gem at its pinned version, as a Gemfile line: gem "pg", "1.7.0".
export function gemfileLine(name: string): string {
  const version: string | undefined = RUBY_PACKAGE_VERSIONS[name];

  if (!version) {
    throw new Error(`No pinned version for ${name}`);
  }

  return `gem "${name}", "${version}"`;
}

/*
 * The lines a Gemfile adds for OpenTelemetry: the SDK, the instrumentations,
 * and for metrics and logs the 0.x SDKs and their exporters.
 */
export function openTelemetryGemfileLines(): Array<string> {
  return RUBY_OPENTELEMETRY_GEMS.map(gemfileLine);
}

/*
 * The lines to add to an app's Gemfile, for a page whose readers keep a
 * Gemfile of their own, as a Rails app's is: the end-to-end check runs them
 * at the end of the app's Gemfile, so the snippet is a fragment of it.
 */
export function openTelemetryGemfileSnippet(): GuideSnippet {
  return {
    id: "gemfile",
    language: "ruby",
    title: "Gemfile",
    code: [
      "# OpenTelemetry: the SDK, every instrumentation, metrics and logs.",
      ...openTelemetryGemfileLines(),
    ].join("\n"),
    check: "contained",
  };
}

// A whole Gemfile: the app's own gems, then OpenTelemetry's.
export function gemfileSnippet(appGems: Array<string>): GuideSnippet {
  return {
    id: "gemfile",
    language: "ruby",
    title: "Gemfile",
    code: [
      'source "https://rubygems.org"',
      "",
      ...appGems.map(gemfileLine),
      "",
      ...openTelemetryGemfileLines(),
    ].join("\n"),
    check: "run",
  };
}

// What loads the SDK and every exporter, for a file that is not a Rails app's.
export const RUBY_SDK_REQUIRES: ReadonlyArray<string> = [
  'require "opentelemetry/sdk"',
  'require "opentelemetry/exporter/otlp"',
  'require "opentelemetry/instrumentation/all"',
  'require "opentelemetry-metrics-sdk"',
  'require "opentelemetry/exporter/otlp_metrics"',
  'require "opentelemetry-logs-sdk"',
  'require "opentelemetry/exporter/otlp_logs"',
  'require "opentelemetry/instrumentation/logger"',
];

/*
 * The hook that sends what is still buffered as Ruby exits: the SDK sends
 * in batches, on a timer, and has no exit hook of its own. With the SDK
 * off, or a configure block that raised, each provider is still the API's
 * stand-in, which has no shutdown: the hook skips it, so the program still
 * exits 0.
 */
export const RUBY_SHUTDOWN_LINES: ReadonlyArray<string> = [
  "at_exit do",
  "  [OpenTelemetry.tracer_provider, OpenTelemetry.meter_provider,",
  "   OpenTelemetry.logger_provider].each do |provider|",
  "    # With OTEL_SDK_DISABLED=true, each is a stand-in with nothing to send.",
  "    provider.shutdown if provider.respond_to?(:shutdown)",
  "  end",
  "end",
];

// `bundle install`, as every Ruby guide runs it once its Gemfile is written.
export const BUNDLE_INSTALL_SNIPPET: GuideSnippet = {
  id: "bundle-install",
  language: "bash",
  code: "bundle install",
  check: "run",
};

export interface RubyTelemetryOptions {
  // The libraries the program traces, required before the SDK: "net/http".
  libraries: Array<string>;
  // The configure block's lines, where use_all takes options of its own.
  configure?: Array<string> | undefined;
}

/*
 * The file that starts OpenTelemetry in a Ruby program that is not a Rails
 * app: the libraries it traces first, since use_all installs only for what
 * is loaded, then the SDK and every exporter, then the hook that sends
 * what is left as Ruby exits.
 */
export function rubyTelemetrySnippet(
  options: RubyTelemetryOptions,
): GuideSnippet {
  return {
    id: "telemetry",
    language: "ruby",
    title: "telemetry.rb",
    code: [
      "# The libraries to trace come first: an instrumentation installs only for a",
      "# library that is already loaded when OpenTelemetry starts.",
      ...options.libraries.map((library: string): string => {
        return `require "${library}"`;
      }),
      "",
      ...RUBY_SDK_REQUIRES,
      "",
      "# Traces, metrics and logs, to the endpoint the OTEL_* variables name.",
      "OpenTelemetry::SDK.configure do |c|",
      ...(options.configure || ["  c.use_all"]),
      "end",
      "",
      "# The SDK sends in batches, on a timer: send what is left as Ruby exits.",
      ...RUBY_SHUTDOWN_LINES,
    ].join("\n"),
    check: "run",
  };
}

export interface RubyDockerfileOptions {
  // The command the container runs, as JSON array parts.
  command: Array<string>;
  // The port it listens on; none for a job.
  port?: number | undefined;
  // ENV lines every environment needs: RAILS_ENV, APP_ENV.
  environment?: Record<string, string> | undefined;
}

// A Ruby image that installs the Gemfile's gems and runs the app.
export function rubyDockerfileSnippet(
  options: RubyDockerfileOptions,
): GuideSnippet {
  return {
    id: "dockerfile",
    language: "dockerfile",
    title: "Dockerfile",
    code: [
      `FROM ruby:${RUBY_VERSION}-slim`,
      "WORKDIR /app",
      "# A compiler, for the gems that build a C extension as they install.",
      "RUN apt-get update && apt-get install -y --no-install-recommends build-essential \\",
      "  && rm -rf /var/lib/apt/lists/*",
      "COPY Gemfile Gemfile.lock ./",
      'RUN bundle config set --local without "development test" && bundle install',
      "COPY . .",
      ...Object.entries(options.environment || {}).map(
        ([name, value]: [string, string]): string => {
          return `ENV ${name}=${value}`;
        },
      ),
      ...(options.port === undefined ? [] : [`EXPOSE ${options.port}`]),
      `CMD [${options.command
        .map((part: string): string => {
          return `"${part}"`;
        })
        .join(", ")}]`,
    ].join("\n"),
    check: "parse",
  };
}
