import {
  InstalledPackage,
  buildFileDependencies,
  installedPackages,
  isBuildFileSnippet,
} from "../Utils/Integrations/OpenTelemetry/GuideCodeChecks";
import {
  syntaxProblems,
  tomlProblems,
} from "../Utils/Integrations/OpenTelemetry/GuideSyntaxChecks";
import { blockOf } from "../Utils/Integrations/OpenTelemetry/GuideSnippets";
import {
  GuideSnippet,
  GuideVerificationRun,
} from "../Utils/Integrations/OpenTelemetry/GuideTypes";
import {
  cargoLockVersions,
  compareVersions,
  composerLockVersions,
  gemfileLockVersions,
  goModVersions,
  mixLockVersions,
} from "../Utils/Integrations/OpenTelemetry/GuideLockFiles";
import {
  Observed,
  checkObserved,
  observedFrom,
} from "../Utils/Integrations/OpenTelemetry/GuideObservations";
import {
  ELIXIR_PACKAGE_VERSIONS,
  METRIC_READER_CONFIG_LINES,
  logHandlerLines,
  mixDependency,
  mixDependencyLines,
  releaseLines,
} from "../Utils/Integrations/OpenTelemetry/ElixirShared";
import {
  RUST_CRATE_VERSIONS,
  cargoAddSnippet,
  pinnedCrate,
  rustTelemetrySnippet,
} from "../Utils/Integrations/OpenTelemetry/RustShared";
import {
  PHP_PACKAGE_VERSIONS,
  composerRequireSnippet,
  pinnedPhpPackage,
} from "../Utils/Integrations/OpenTelemetry/PhpShared";
import {
  RUBY_PACKAGE_VERSIONS,
  gemfileLine,
} from "../Utils/Integrations/OpenTelemetry/RubyShared";
import { kubernetesManifestSnippet } from "../Utils/Integrations/OpenTelemetry/GuideShared";
import { describe, expect, test } from "@jest/globals";

/*
 * What the guides for Go, Ruby, PHP, Rust and Elixir are checked with:
 * the installs and build files their pins are read from, the light reader
 * that holds their code to being well formed, the helpers that write
 * their shared snippets, the lock files the end-to-end check reads the
 * installed versions from, and the check that holds what arrived to what
 * a guide expects. Tests/OpenTelemetryGuides runs these over every guide;
 * here each is held to the cases that matter, one at a time.
 */

function named(packages: Array<InstalledPackage>): Array<string> {
  return packages.map((item: InstalledPackage): string => {
    return `${item.ecosystem} ${item.name}@${item.version || "managed"}`;
  });
}

function buildFile(
  title: string,
  language: GuideSnippet["language"],
  code: string,
): GuideSnippet {
  return {
    id: "b",
    title: title,
    language: language,
    code: code,
    check: "run",
  };
}

describe("the packages an install command adds, in the newer languages", () => {
  test("go get pins each module at its version, and names no package of the module's own", () => {
    expect(
      named(
        installedPackages(
          [
            "go get go.opentelemetry.io/otel@v1.47.0 \\",
            "  go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp@v0.72.0 ./...",
            "go install google.golang.org/protobuf/cmd/protoc-gen-go@v1.40.0",
          ].join("\n"),
        ),
      ),
    ).toEqual([
      "go go.opentelemetry.io/otel@v1.47.0",
      "go go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp@v0.72.0",
      "go google.golang.org/protobuf/cmd/protoc-gen-go@v1.40.0",
    ]);
  });

  test("gem install and bundle add take their version flags, quoted or not", () => {
    expect(
      named(
        installedPackages(
          [
            "gem install opentelemetry-sdk -v 1.13.1",
            'bundle add opentelemetry-exporter-otlp --version "0.37.0"',
          ].join("\n"),
        ),
      ),
    ).toEqual([
      "rubygems opentelemetry-sdk@1.13.1",
      "rubygems opentelemetry-exporter-otlp@0.37.0",
    ]);
  });

  test("composer require pins with a colon; a flag's value is no package", () => {
    expect(
      named(
        installedPackages(
          "composer require --working-dir app open-telemetry/sdk:1.15.0 \\\n  open-telemetry/exporter-otlp:1.4.0",
        ),
      ),
    ).toEqual([
      "packagist open-telemetry/sdk@1.15.0",
      "packagist open-telemetry/exporter-otlp@1.4.0",
    ]);
  });

  test("the PHP extension, from PECL or the image's installer", () => {
    expect(
      named(
        installedPackages(
          [
            "pecl install opentelemetry-1.4.2",
            "install-php-extensions opentelemetry-1.4.2",
          ].join("\n"),
        ),
      ),
    ).toEqual(["pecl opentelemetry@1.4.2", "pecl opentelemetry@1.4.2"]);
  });

  test("cargo add pins with @, and --features names features, not crates", () => {
    expect(
      named(
        installedPackages(
          [
            "cargo add opentelemetry@0.33.1 tracing@0.1.44",
            "cargo add axum-tracing-opentelemetry@0.42.1 --features tracing_level_info",
          ].join("\n"),
        ),
      ),
    ).toEqual([
      "crates opentelemetry@0.33.1",
      "crates tracing@0.1.44",
      "crates axum-tracing-opentelemetry@0.42.1",
    ]);
  });
});

describe("the dependencies a newer language's build file declares", () => {
  test("knows a Gemfile, a composer.json, a Cargo.toml and a mix.exs by their titles", () => {
    expect(isBuildFileSnippet(buildFile("Gemfile", "ruby", ""))).toBe(true);
    expect(isBuildFileSnippet(buildFile("composer.json", "json", ""))).toBe(
      true,
    );
    expect(isBuildFileSnippet(buildFile("Cargo.toml", "toml", ""))).toBe(true);
    expect(isBuildFileSnippet(buildFile("mix.exs", "elixir", ""))).toBe(true);
    expect(
      isBuildFileSnippet(buildFile("config/runtime.exs", "elixir", "")),
    ).toBe(false);
    expect(isBuildFileSnippet(buildFile("Rakefile", "ruby", ""))).toBe(false);
  });

  test("a Gemfile's gems, in either quote, a requirement kept as written", () => {
    const gemfile: string = [
      'source "https://rubygems.org"',
      "gem 'rails', \"8.1.4\"",
      'gem "opentelemetry-sdk", "1.13.1"',
      'gem "puma", ">= 6"',
      'gem "debug", group: :development',
    ].join("\n");

    expect(
      named(buildFileDependencies(buildFile("Gemfile", "ruby", gemfile))),
    ).toEqual([
      "rubygems rails@8.1.4",
      "rubygems opentelemetry-sdk@1.13.1",
      "rubygems puma@>= 6",
      "rubygems debug@managed",
    ]);
  });

  test("a mix.exs's dependencies: a pin, a requirement as written, and a path with no version", () => {
    const mixExs: string = [
      "  defp deps do",
      "    [",
      '      {:opentelemetry, "1.7.0"},',
      '      {:phoenix, "~> 1.8.16"},',
      '      {:opentelemetry_api_experimental, "0.6.0"},',
      '      {:storefront_core, path: "../core"}',
      "    ]",
      "  end",
    ].join("\n");

    expect(
      named(buildFileDependencies(buildFile("mix.exs", "elixir", mixExs))),
    ).toEqual([
      "hex opentelemetry@1.7.0",
      "hex phoenix@~> 1.8.16",
      "hex opentelemetry_api_experimental@0.6.0",
      "hex storefront_core@managed",
    ]);
  });
});

describe("the light reader of Go, Rust, PHP, Ruby and Elixir", () => {
  test("reads Elixir's do and fn blocks, never a keyword's do:, and its char literals and sigils", () => {
    const code: string = [
      "defmodule Payouts do",
      '  def label(%{path_info: ["healthz"]}), do: false',
      "  def sent(results), do: Enum.count(results, fn {:ok, sent?} -> sent? end)",
      "  def question, do: ?}",
      "  def pattern, do: ~r/[a-z]+(\\d)/",
      '  def body(id), do: "#{id} is below the minimum payout"',
      "end",
    ].join("\n");

    expect(syntaxProblems(code, "elixir")).toEqual([]);
    expect(
      syntaxProblems("defmodule Payouts do\n  def run do\n  end\n", "elixir"),
    ).not.toEqual([]);
  });

  test("reads Ruby's blocks and a statement's if, but not an if that ends a line", () => {
    const code: string = [
      "class OrdersController < ApplicationController",
      "  def show",
      "    return head(:not_found) if order.nil?",
      "    if order.paid?",
      '      render json: { id: order.id, note: "paid #{order.id}" }',
      "    end",
      "  end",
      "end",
    ].join("\n");

    expect(syntaxProblems(code, "ruby")).toEqual([]);
    expect(syntaxProblems("def show\n  if paid\nend", "ruby")).not.toEqual([]);
  });

  test("reads Rust's lifetimes, raw strings and attributes", () => {
    const code: string = [
      "#[derive(Clone)]",
      "struct Order<'a> {",
      "    id: &'a str,",
      "}",
      'const PATTERN: &str = r#"a "quoted" {brace"#;',
    ].join("\n");

    expect(syntaxProblems(code, "rust")).toEqual([]);
    expect(
      syntaxProblems("fn main() {\n    let x = (1;\n}", "rust"),
    ).not.toEqual([]);
  });

  test("reads PHP's attributes and Go's raw strings", () => {
    expect(
      syntaxProblems(
        [
          "<?php",
          "#[Route('/orders/{id}', name: 'orders_show')]",
          "function show(int $id): array { return ['id' => $id]; }",
        ].join("\n"),
        "php",
      ),
    ).toEqual([]);
    expect(
      syntaxProblems('package main\n\nvar pattern = `a {brace` + "}"\n', "go"),
    ).toEqual([]);
  });

  test("holds a Cargo.toml to TOML's lines", () => {
    expect(
      tomlProblems(
        [
          "[package]",
          'name = "orders-api"',
          "",
          "[dependencies]",
          'tokio = { version = "1.54.1", features = ["macros"] }',
          "features = [",
          '  "a",',
          "]",
        ].join("\n"),
      ),
    ).toEqual([]);
    expect(tomlProblems("not a toml line")).not.toEqual([]);
  });
});

describe("a fragment of a file the check ran", () => {
  const source: string = [
    "defmodule Payouts do",
    "  def create_instruments do",
    '    Counter.create(:"payouts.sent", %{})',
    "  end",
    "",
    "  def run do",
    "    :ok",
    "  end",
    "end",
  ].join("\n");

  test("runs from the line that starts it to the closing line at its indentation", () => {
    expect(blockOf(source, "def run do", "end")).toBe(
      ["  def run do", "    :ok", "  end"].join("\n"),
    );
    expect(blockOf(source, "def create_instruments do", "end")).toBe(
      [
        "  def create_instruments do",
        '    Counter.create(:"payouts.sent", %{})',
        "  end",
      ].join("\n"),
    );
  });

  test("fails loudly when the file no longer has the block", () => {
    expect(() => {
      return blockOf(source, "def missing do", "end");
    }).toThrow("No block starts with def missing do and ends with end");
  });
});

describe("the shared snippets of the newer languages", () => {
  test("cargo add: plain crates on one command, each crate with features on its own", () => {
    const snippet: GuideSnippet = cargoAddSnippet("install", [
      "opentelemetry",
      "tracing",
      { name: "tracing-subscriber", features: ["env-filter"] },
    ]);

    expect(snippet.code).toBe(
      [
        `cargo add opentelemetry@${RUST_CRATE_VERSIONS["opentelemetry"]} \\`,
        `  tracing@${RUST_CRATE_VERSIONS["tracing"]}`,
        `cargo add tracing-subscriber@${RUST_CRATE_VERSIONS["tracing-subscriber"]} --features env-filter`,
      ].join("\n"),
    );
    expect(() => {
      return pinnedCrate("left-pad");
    }).toThrow("No pinned version for left-pad");
  });

  test("the Rust telemetry file keeps the SDK's own crates quiet, and any the guide adds", () => {
    expect(rustTelemetrySnippet("orders-api").code).toContain(
      'EnvFilter::new("info,opentelemetry=off,hyper=off,reqwest=off")',
    );
    expect(
      rustTelemetrySnippet("orders-api", ["actix_server=warn"]).code,
    ).toContain("reqwest=off,actix_server=warn");
  });

  test("composer require: each package pinned, one a line", () => {
    expect(
      composerRequireSnippet("install", [
        "open-telemetry/sdk",
        "open-telemetry/exporter-otlp",
      ]).code,
    ).toBe(
      [
        `composer require open-telemetry/sdk:${PHP_PACKAGE_VERSIONS["open-telemetry/sdk"]} \\`,
        `  open-telemetry/exporter-otlp:${PHP_PACKAGE_VERSIONS["open-telemetry/exporter-otlp"]}`,
      ].join("\n"),
    );
    expect(() => {
      return pinnedPhpPackage("acme/unknown");
    }).toThrow("No pinned version for acme/unknown");
  });

  test("a Gemfile's line for a gem, at its pin", () => {
    expect(gemfileLine("opentelemetry-sdk")).toBe(
      `gem "opentelemetry-sdk", "${RUBY_PACKAGE_VERSIONS["opentelemetry-sdk"]}"`,
    );
    expect(() => {
      return gemfileLine("left_pad");
    }).toThrow("No pinned version for left_pad");
  });

  test("mix.exs's dependency lines: a comma after each, none after the list's last", () => {
    expect(mixDependency("opentelemetry")).toBe(
      `{:opentelemetry, "${ELIXIR_PACKAGE_VERSIONS["opentelemetry"]}"}`,
    );
    expect(
      mixDependencyLines(["opentelemetry_api", "opentelemetry"], {
        endsTheList: true,
      }),
    ).toEqual([
      `      {:opentelemetry_api, "${ELIXIR_PACKAGE_VERSIONS["opentelemetry_api"]}"},`,
      `      {:opentelemetry, "${ELIXIR_PACKAGE_VERSIONS["opentelemetry"]}"}`,
    ]);
    expect(
      mixDependencyLines(["opentelemetry"], { endsTheList: false }),
    ).toEqual([
      `      {:opentelemetry, "${ELIXIR_PACKAGE_VERSIONS["opentelemetry"]}"},`,
    ]);
    expect(() => {
      return mixDependency("left_pad");
    }).toThrow("No pinned version for left_pad");
  });

  test("an Elixir release starts the exporter first, and its metrics and logs go over HTTP", () => {
    expect(releaseLines("payouts").join("\n")).toContain(
      "applications: [opentelemetry_exporter: :permanent, opentelemetry: :temporary]",
    );
    expect(METRIC_READER_CONFIG_LINES.join("\n")).toContain(
      "{:otel_exporter_metrics_otlp, %{protocol: :http_protobuf}}",
    );
    // The SDK reads no export interval of its own: the configuration reads the variable.
    expect(METRIC_READER_CONFIG_LINES.join("\n")).toContain(
      'System.get_env("OTEL_METRIC_EXPORT_INTERVAL", "60000")',
    );
    expect(logHandlerLines("Logger's events.").join("\n")).toContain(
      "{:otel_exporter_logs_otlp, %{protocol: :http_protobuf}}",
    );
  });

  test("a Deployment runs two pods unless the app must run alone", () => {
    expect(
      kubernetesManifestSnippet({ name: "api", image: "api:1" }).code,
    ).toContain("  replicas: 2");
    expect(
      kubernetesManifestSnippet({ name: "payouts", image: "p:1", replicas: 1 })
        .code,
    ).toContain("  replicas: 1");
  });
});

describe("the versions a run's lock file says it installed", () => {
  test("go.mod: a require block and a require line, as the build left them", () => {
    expect(
      goModVersions(
        [
          "module example.com/orders",
          "",
          "go 1.26",
          "",
          "require go.opentelemetry.io/otel v1.47.0",
          "",
          "require (",
          "\tgithub.com/gin-gonic/gin v1.12.0",
          "\tgo.opentelemetry.io/otel/sdk v1.47.0 // indirect",
          ")",
        ].join("\n"),
      ),
    ).toEqual({
      "go.opentelemetry.io/otel": "v1.47.0",
      "github.com/gin-gonic/gin": "v1.12.0",
      "go.opentelemetry.io/otel/sdk": "v1.47.0",
    });
  });

  test("Gemfile.lock: a spec's version without its platform, never a dependency's requirement", () => {
    expect(
      gemfileLockVersions(
        [
          "GEM",
          "  specs:",
          "    opentelemetry-sdk (1.13.1)",
          "      opentelemetry-api (~> 1.1)",
          "    sqlite3 (2.10.2-x86_64-linux-gnu)",
        ].join("\n"),
      ),
    ).toEqual({ "opentelemetry-sdk": "1.13.1", sqlite3: "2.10.2" });
  });

  test("composer.lock: packages and dev packages, without a leading v", () => {
    expect(
      composerLockVersions(
        JSON.stringify({
          packages: [{ name: "laravel/framework", version: "v13.11.0" }],
          "packages-dev": [{ name: "phpunit/phpunit", version: "12.5.1" }],
        }),
      ),
    ).toEqual({
      "laravel/framework": "13.11.0",
      "phpunit/phpunit": "12.5.1",
    });
    expect(composerLockVersions("")).toEqual({});
  });

  test("Cargo.lock: a crate the build needs twice is recorded at the higher version", () => {
    expect(
      cargoLockVersions(
        [
          "[[package]]",
          'name = "hyper"',
          'version = "0.14.32"',
          "",
          "[[package]]",
          'name = "hyper"',
          'version = "1.9.0"',
          "",
          "[[package]]",
          'name = "opentelemetry"',
          'version = "0.33.1"',
        ].join("\n"),
      ),
    ).toEqual({ hyper: "1.9.0", opentelemetry: "0.33.1" });
    expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("0.33.1", "0.33.1")).toBe(0);
  });

  test("mix.lock: each Hex package's version, and nothing for one from git", () => {
    expect(
      mixLockVersions(
        [
          "%{",
          '  "opentelemetry": {:hex, :opentelemetry, "1.7.0", "abc", [:rebar3], [], "hexpm", "def"},',
          '  "req": {:hex, :req, "0.7.5", "abc", [:mix], [], "hexpm", "def"},',
          '  "internal": {:git, "https://example.com/internal.git", "1234", []},',
          "}",
        ].join("\n"),
      ),
    ).toEqual({ opentelemetry: "1.7.0", req: "0.7.5" });
  });
});

describe("what arrived, held to what a guide expects", () => {
  const CALLER_SPAN_ID: string = "00f067aa0ba902b7";

  // One export request of each signal, as the collector writes them.
  const observed: Observed = observedFrom({
    traces: [
      {
        resourceSpans: [
          {
            resource: {
              attributes: [
                { key: "service.name", value: { stringValue: "storefront" } },
              ],
            },
            scopeSpans: [
              {
                spans: [
                  {
                    name: "GET /api/orders/:id",
                    spanId: "aaaaaaaaaaaaaaaa",
                    parentSpanId: CALLER_SPAN_ID,
                    attributes: [
                      {
                        key: "http.route",
                        value: { stringValue: "/api/orders/:id" },
                      },
                      {
                        key: "http.response.status_code",
                        value: { intValue: "200" },
                      },
                    ],
                  },
                  {
                    name: "storefront.repo.query:orders",
                    spanId: "bbbbbbbbbbbbbbbb",
                    parentSpanId: "aaaaaaaaaaaaaaaa",
                    attributes: [
                      {
                        key: "db.system",
                        value: { stringValue: "postgresql" },
                      },
                    ],
                  },
                  {
                    name: "GET /api/orders/:id/receipt",
                    spanId: "cccccccccccccccc",
                    events: [
                      {
                        name: "exception",
                        attributes: [
                          {
                            key: "exception.message",
                            value: {
                              stringValue:
                                "the receipt printer is offline for order 42",
                            },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    metrics: [
      {
        resourceMetrics: [
          { scopeMetrics: [{ metrics: [{ name: "orders.placed" }] }] },
        ],
      },
    ],
    logs: [
      {
        resourceLogs: [
          {
            scopeLogs: [
              {
                logRecords: [
                  {
                    body: { stringValue: "loading order 42" },
                    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
                    attributes: [
                      { key: "order_id", value: { stringValue: "42" } },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });

  function run(
    expect: Partial<GuideVerificationRun["expect"]>,
  ): GuideVerificationRun {
    return {
      files: [],
      commands: [],
      requests: [],
      expect: { spans: [], metrics: [], logs: [], ...expect },
    };
  }

  test("reads spans, their parents, attributes and exception events, metrics and log records", () => {
    expect(observed.spans.length).toBe(3);
    expect(observed.spans[0]!.attributes["http.response.status_code"]).toBe(
      "200",
    );
    expect(observed.spans[2]!.hasException).toBe(true);
    expect(observed.metrics).toEqual(["orders.placed"]);
    expect(observed.logs[0]).toEqual({
      body: "loading order 42",
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      hasException: false,
      attributes: { order_id: "42" },
    });
    expect(observed.resources[0]).toEqual({ "service.name": "storefront" });
  });

  test("passes a run whose every span, metric, log and resource arrived", () => {
    expect(
      checkObserved(
        run({
          spans: [
            {
              name: "GET /api/orders/:id",
              attributes: { "http.route": "/api/orders/:id" },
              parentSpanId: CALLER_SPAN_ID,
              absentAttributes: ["db.statement"],
            },
            {
              name: "storefront.repo.query:orders",
              parent: "GET /api/orders/:id",
            },
            {
              name: "GET /api/orders/:id/receipt",
              hasException: true,
              exceptionMessage: "printer is offline",
            },
          ],
          metrics: ["orders.placed"],
          logs: [
            {
              body: "loading order",
              hasTraceContext: true,
              attributes: { order_id: "42" },
            },
          ],
          resource: { "service.name": "storefront" },
          untracedPaths: ["/healthz"],
          absentSpans: ["GET /healthz"],
          absentLogs: ["GET /healthz"],
        }),
        observed,
      ),
    ).toEqual([]);
  });

  test("fails a span whose caller is not the one that sent traceparent", () => {
    expect(
      checkObserved(
        run({
          spans: [
            { name: "GET /api/orders/:id", parentSpanId: "1111111111111111" },
          ],
        }),
        observed,
      ),
    ).toEqual([
      'no span {"name":"GET /api/orders/:id","parentSpanId":"1111111111111111"}',
    ]);
  });

  test("fails a span that carries an attribute the guide's options leave out", () => {
    expect(
      checkObserved(
        run({
          spans: [
            {
              name: "storefront.repo.query:orders",
              absentAttributes: ["db.system"],
            },
          ],
        }),
        observed,
      ),
    ).toEqual([
      'no span {"name":"storefront.repo.query:orders","absentAttributes":["db.system"]}',
    ]);
  });

  test("fails a missing parent, exception, metric, log, resource, and anything the guide leaves out", () => {
    expect(
      checkObserved(
        run({
          spans: [
            { name: "storefront.repo.query:orders", parent: "checkout.charge" },
            { name: "GET /api/orders/:id", hasException: true },
          ],
          metrics: ["http.server.request.duration"],
          logs: [{ body: "loading order 7", hasTraceContext: true }],
          resource: { "service.name": "payouts" },
          absentSpans: ["storefront.repo.query:orders"],
          absentMetrics: ["orders.placed"],
          absentLogs: ["loading order"],
        }),
        observed,
      ),
    ).toEqual([
      'no span {"name":"storefront.repo.query:orders","parent":"checkout.charge"}',
      'no span {"name":"GET /api/orders/:id","hasException":true}',
      "no metric http.server.request.duration",
      'no log {"body":"loading order 7","hasTraceContext":true}',
      "no resource with service.name=payouts",
      "a span named storefront.repo.query:orders, which the guide turns off",
      "a metric named orders.placed, which the guide leaves out",
      "a log line with loading order, which the guide leaves out: loading order 42",
    ]);
  });

  test("fails a span recorded for a path the guide leaves untraced", () => {
    const withHealthCheck: Observed = {
      ...observed,
      spans: [
        ...observed.spans,
        {
          name: "GET",
          spanId: "dddddddddddddddd",
          parentSpanId: "",
          attributes: { "url.path": "/healthz" },
          hasException: false,
          exceptionMessages: [],
        },
      ],
    };

    expect(
      checkObserved(run({ untracedPaths: ["/healthz"] }), withHealthCheck),
    ).toEqual(["a span for /healthz, which the guide leaves out: GET"]);
  });
});
