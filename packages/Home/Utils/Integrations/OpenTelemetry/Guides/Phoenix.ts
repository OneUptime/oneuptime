import {
  OpenTelemetryGuide,
  GuideSnippet,
  VerificationCommand,
} from "../GuideTypes";
import {
  DOCS,
  SCREENS,
  SERVER_KEY_PREREQUISITE,
  kubernetesManifestSnippet,
  otlpEnvironmentTabs,
  postgresService,
  validateKeyStep,
} from "../GuideShared";
import { blockOf } from "../GuideSnippets";
import {
  ELIXIR_EXPERIMENTAL_PACKAGES,
  ELIXIR_OPENTELEMETRY_PACKAGES,
  ELIXIR_PACKAGE_VERSIONS,
  ELIXIR_PREREQUISITE,
  METRIC_READER_CONFIG_LINES,
  MIX_DEPS_GET_SNIPPET,
  logHandlerLines,
  mixDependency,
  mixDependencyLines,
  releaseLines,
} from "../ElixirShared";

/*
 * A Phoenix 1.8 JSON API, as `mix phx.new --no-html` generates it, served
 * by Bandit, with Ecto on PostgreSQL: a storefront's orders, charged
 * through a payments API it calls with Req. Three setup calls attach the
 * instrumentation to Bandit's, Phoenix's and Ecto's :telemetry events; a
 * sampler of the app's own drops the health check. Checked in production
 * mode, as the release runs, stopped with SIGTERM.
 */

const install: GuideSnippet = {
  id: "install",
  language: "elixir",
  title: "mix.exs",
  code: [
    "      # OpenTelemetry: the API and SDK, the OTLP exporter, the spans of Bandit,",
    "      # Phoenix, Ecto and Req, and the experimental SDK that sends metrics and logs.",
    ...mixDependencyLines(
      [
        ...ELIXIR_OPENTELEMETRY_PACKAGES,
        "opentelemetry_bandit",
        "opentelemetry_phoenix",
        "opentelemetry_ecto",
        "opentelemetry_req",
        ...ELIXIR_EXPERIMENTAL_PACKAGES,
      ],
      { endsTheList: true },
    ),
  ].join("\n"),
  check: "contained",
};

const releases: GuideSnippet = {
  id: "releases",
  language: "elixir",
  title: "mix.exs",
  code: releaseLines("storefront").join("\n"),
  check: "contained",
};

// mix.exs as `mix phx.new` 1.8 writes it, with Req, the page's lines and the release.
const MIX_EXS: string = [
  "defmodule Storefront.MixProject do",
  "  use Mix.Project",
  "",
  "  def project do",
  "    [",
  "      app: :storefront,",
  '      version: "0.1.0",',
  '      elixir: "~> 1.17",',
  "      elixirc_paths: elixirc_paths(Mix.env()),",
  "      start_permanent: Mix.env() == :prod,",
  "      aliases: aliases(),",
  "      deps: deps(),",
  "      listeners: [Phoenix.CodeReloader],",
  releases.code,
  "    ]",
  "  end",
  "",
  "  def application do",
  "    [",
  "      mod: {Storefront.Application, []},",
  "      extra_applications: [:logger, :runtime_tools]",
  "    ]",
  "  end",
  "",
  "  def cli do",
  "    [",
  "      preferred_envs: [precommit: :test]",
  "    ]",
  "  end",
  "",
  '  defp elixirc_paths(:test), do: ["lib", "test/support"]',
  '  defp elixirc_paths(_), do: ["lib"]',
  "",
  "  defp deps do",
  "    [",
  '      {:phoenix, "~> 1.8.16"},',
  '      {:phoenix_ecto, "~> 4.5"},',
  '      {:ecto_sql, "~> 3.13"},',
  '      {:postgrex, ">= 0.0.0"},',
  '      {:telemetry_metrics, "~> 1.0"},',
  '      {:telemetry_poller, "~> 1.0"},',
  '      {:jason, "~> 1.2"},',
  '      {:dns_cluster, "~> 0.2.0"},',
  '      {:bandit, "~> 1.5"},',
  `      ${mixDependency("req")},`,
  install.code,
  "    ]",
  "  end",
  "",
  "  defp aliases do",
  "    [",
  '      setup: ["deps.get", "ecto.setup"],',
  '      "ecto.setup": ["ecto.create", "ecto.migrate", "run priv/repo/seeds.exs"],',
  '      "ecto.reset": ["ecto.drop", "ecto.setup"],',
  '      test: ["ecto.create --quiet", "ecto.migrate --quiet", "test"],',
  '      precommit: ["compile --warnings-as-errors", "deps.unlock --unused", "format", "test"]',
  "    ]",
  "  end",
  "end",
].join("\n");

const metricReader: GuideSnippet = {
  id: "metric-reader",
  language: "elixir",
  title: "config/runtime.exs",
  code: [
    "# Metrics through the experimental SDK, exported every minute unless the",
    "# standard variable says otherwise (the SDK does not read it itself).",
    ...METRIC_READER_CONFIG_LINES,
  ].join("\n"),
  check: "run",
};

const application: GuideSnippet = {
  id: "application",
  language: "elixir",
  title: "lib/storefront/application.ex",
  code: [
    "defmodule Storefront.Application do",
    "  @moduledoc false",
    "",
    "  use Application",
    "",
    "  @impl true",
    "  def start(_type, _args) do",
    ...logHandlerLines(
      "Logger's events as OpenTelemetry log records, with the request's trace IDs.",
    ),
    "",
    "    # A span per request from Bandit, named after its route by Phoenix, and a",
    "    # span per Ecto query beneath it.",
    "    OpentelemetryBandit.setup()",
    "    OpentelemetryPhoenix.setup(adapter: :bandit)",
    "    OpentelemetryEcto.setup([:storefront, :repo], db_statement: :enabled)",
    "    Storefront.Orders.create_instruments()",
    "",
    "    children = [",
    "      StorefrontWeb.Telemetry,",
    "      Storefront.Repo,",
    "      {DNSCluster,",
    "       query: Application.get_env(:storefront, :dns_cluster_query) || :ignore},",
    "      {Phoenix.PubSub, name: Storefront.PubSub},",
    "      StorefrontWeb.Endpoint",
    "    ]",
    "",
    "    opts = [strategy: :one_for_one, name: Storefront.Supervisor]",
    "    Supervisor.start_link(children, opts)",
    "  end",
    "",
    "  @impl true",
    "  def config_change(changed, _new, removed) do",
    "    StorefrontWeb.Endpoint.config_change(changed, removed)",
    "    :ok",
    "  end",
    "end",
  ].join("\n"),
  check: "run",
};

const ordersFile: string = [
  "defmodule Storefront.Orders do",
  '  @moduledoc "The storefront\'s orders, charged through the payments API."',
  "",
  "  require OpenTelemetry.Tracer, as: Tracer",
  "  require OpenTelemetryAPIExperimental.Counter, as: Counter",
  "",
  "  alias Storefront.Orders.Order",
  "  alias Storefront.Repo",
  "",
  "  def create_instruments do",
  '    Counter.create(:"orders.placed", %{',
  '      description: "Orders placed, by payment method",',
  '      unit: "{order}"',
  "    })",
  "  end",
  "",
  "  def get_order(id), do: Repo.get(Order, id)",
  "",
  '  def place_order(%{"items" => items, "payment_method" => method}) do',
  "    with :ok <- charge(items, method) do",
  "      changeset = Order.changeset(%{items: length(items), payment_method: method})",
  "      order = Repo.insert!(changeset)",
  '      Counter.add(:"orders.placed", 1, %{"payment.method" => method})',
  "      {:ok, order}",
  "    end",
  "  end",
  "",
  "  defp charge(items, method) do",
  '    attributes = %{"payment.method": method, "order.item_count": length(items)}',
  "",
  '    Tracer.with_span "checkout.charge", %{attributes: attributes} do',
  "      # Req's span for the call, and traceparent sent so the payments API joins in.",
  "      client =",
  '        Req.new(base_url: System.get_env("PAYMENTS_API_URL", "http://localhost:9000"))',
  "        |> OpentelemetryReq.attach(propagate_trace_headers: true)",
  "",
  '      case Req.post(client, url: "/api/charges", json: %{method: method}) do',
  "        {:ok, %Req.Response{status: 200}} -> :ok",
  '        {:ok, response} -> {:error, "the payments API answered #{response.status}"}',
  "        {:error, exception} -> {:error, Exception.message(exception)}",
  "      end",
  "    end",
  "  end",
  "end",
].join("\n");

const orders: GuideSnippet = {
  id: "orders",
  language: "elixir",
  title: "lib/storefront/orders.ex",
  code: ordersFile,
  check: "run",
};

const counter: GuideSnippet = {
  id: "counter",
  language: "elixir",
  title: "lib/storefront/orders.ex",
  code: blockOf(ordersFile, "def create_instruments do", "end"),
  check: "contained",
};

const controller: GuideSnippet = {
  id: "controller",
  language: "elixir",
  title: "lib/storefront_web/controllers/order_controller.ex",
  code: [
    "defmodule StorefrontWeb.OrderController do",
    "  use StorefrontWeb, :controller",
    "",
    "  require Logger",
    "",
    "  alias Storefront.Orders",
    "",
    '  def show(conn, %{"id" => id}) do',
    '    Logger.info("loading order #{id}", order_id: id)',
    "",
    "    case Orders.get_order(id) do",
    '      nil -> conn |> put_status(:not_found) |> json(%{error: "no such order"})',
    "      order -> json(conn, order)",
    "    end",
    "  end",
    "",
    "  def create(conn, params) do",
    "    case Orders.place_order(params) do",
    "      {:ok, order} -> conn |> put_status(:created) |> json(order)",
    "      {:error, reason} -> conn |> put_status(:bad_gateway) |> json(%{error: reason})",
    "    end",
    "  end",
    "",
    '  def receipt(_conn, %{"id" => id}) do',
    '    raise "the receipt printer is offline for order #{id}"',
    "  end",
    "end",
  ].join("\n"),
  check: "run",
};

const sampler: GuideSnippet = {
  id: "sampler",
  language: "elixir",
  title: "lib/storefront/sampler.ex",
  code: [
    "defmodule Storefront.Sampler do",
    '  @moduledoc """',
    "  Which requests start a trace: none of the paths in `untraced_paths`, such as",
    "  the health check, and `ratio` of the others, chosen by trace ID.",
    '  """',
    "",
    "  @behaviour :otel_sampler",
    "",
    "  @impl :otel_sampler",
    "  def setup(%{untraced_paths: paths, ratio: ratio}) do",
    "    %{untraced_paths: paths, by_ratio: :otel_sampler_trace_id_ratio_based.setup(ratio)}",
    "  end",
    "",
    "  @impl :otel_sampler",
    '  def description(_config), do: "Storefront.Sampler"',
    "",
    "  @impl :otel_sampler",
    "  def should_sample(ctx, trace_id, links, name, kind, attributes, config) do",
    '    if attributes[:"url.path"] in config.untraced_paths do',
    "      span_ctx = OpenTelemetry.Tracer.current_span_ctx(ctx)",
    "      {:drop, [], OpenTelemetry.Span.tracestate(span_ctx)}",
    "    else",
    "      :otel_sampler_trace_id_ratio_based.should_sample(",
    "        ctx,",
    "        trace_id,",
    "        links,",
    "        name,",
    "        kind,",
    "        attributes,",
    "        config.by_ratio",
    "      )",
    "    end",
    "  end",
    "end",
  ].join("\n"),
  check: "run",
};

const samplerConfig: GuideSnippet = {
  id: "sampler-config",
  language: "elixir",
  title: "config/runtime.exs",
  code: [
    "# The sampler above, asked only about a request that starts a trace.",
    "config :opentelemetry,",
    "  sampler:",
    "    {:parent_based,",
    '     %{root: {Storefront.Sampler, %{untraced_paths: ["/healthz"], ratio: 1.0}}}}',
  ].join("\n"),
  check: "run",
};

/*
 * The endpoint as `mix phx.new --no-html` writes it, its comments left
 * out, with the health check's request lines turned off.
 */
const ENDPOINT_TAIL: string = [
  "  plug Plug.RequestId",
  "",
  "  # No request log lines for the health check, whose spans the sampler drops.",
  "  plug Plug.Telemetry,",
  "    event_prefix: [:phoenix, :endpoint],",
  "    log: {__MODULE__, :log_level, []}",
  "",
  "  plug Plug.Parsers,",
  "    parsers: [:urlencoded, :multipart, :json],",
  '    pass: ["*/*"],',
  "    json_decoder: Phoenix.json_library()",
  "",
  "  plug Plug.MethodOverride",
  "  plug Plug.Head",
  "  plug Plug.Session, @session_options",
  "  plug StorefrontWeb.Router",
  "",
  '  def log_level(%{path_info: ["healthz"]}), do: false',
  "  def log_level(_conn), do: :info",
].join("\n");

const endpoint: GuideSnippet = {
  id: "endpoint",
  language: "elixir",
  title: "lib/storefront_web/endpoint.ex",
  code: ENDPOINT_TAIL,
  check: "contained",
};

const ENDPOINT_FILE: string = [
  "defmodule StorefrontWeb.Endpoint do",
  "  use Phoenix.Endpoint, otp_app: :storefront",
  "",
  "  @session_options [",
  "    store: :cookie,",
  '    key: "_storefront_key",',
  '    signing_salt: "Kq3TzW7b",',
  '    same_site: "Lax"',
  "  ]",
  "",
  "  plug Plug.Static,",
  '    at: "/",',
  "    from: :storefront,",
  "    gzip: not code_reloading?,",
  "    only: StorefrontWeb.static_paths(),",
  "    raise_on_missing_only: code_reloading?",
  "",
  "  if code_reloading? do",
  "    plug Phoenix.CodeReloader",
  "    plug Phoenix.Ecto.CheckRepoStatus, otp_app: :storefront",
  "  end",
  "",
  ENDPOINT_TAIL,
  "end",
].join("\n");

const run: GuideSnippet = {
  id: "run",
  language: "bash",
  code: "mix phx.server",
  check: "run",
};

const genRelease: GuideSnippet = {
  id: "gen-release",
  language: "bash",
  code: "mix phx.gen.release --docker",
  check: "parse",
};

// What the page's code runs on beside its own files: Phoenix's router, schema and migration.
const SCAFFOLDING: Array<{ path: string; content: string }> = [
  { path: "mix.exs", content: MIX_EXS },
  { path: "lib/storefront_web/endpoint.ex", content: ENDPOINT_FILE },
  {
    path: "lib/storefront_web/router.ex",
    content: [
      "defmodule StorefrontWeb.Router do",
      "  use StorefrontWeb, :router",
      "",
      "  pipeline :api do",
      '    plug :accepts, ["json"]',
      "  end",
      "",
      "  # The load balancer's health check, which the sampler leaves untraced.",
      '  get "/healthz", StorefrontWeb.HealthController, :show',
      "",
      '  scope "/api", StorefrontWeb do',
      "    pipe_through :api",
      "",
      '    get "/orders/:id", OrderController, :show',
      '    post "/orders", OrderController, :create',
      '    get "/orders/:id/receipt", OrderController, :receipt',
      "  end",
      "end",
    ].join("\n"),
  },
  {
    path: "lib/storefront_web/controllers/health_controller.ex",
    content: [
      "defmodule StorefrontWeb.HealthController do",
      "  use StorefrontWeb, :controller",
      "",
      '  def show(conn, _params), do: text(conn, "ok")',
      "end",
    ].join("\n"),
  },
  {
    path: "lib/storefront/orders/order.ex",
    content: [
      "defmodule Storefront.Orders.Order do",
      "  use Ecto.Schema",
      "  import Ecto.Changeset",
      "",
      "  @derive {Jason.Encoder, only: [:id, :items, :payment_method]}",
      '  schema "orders" do',
      "    field :items, :integer",
      "    field :payment_method, :string",
      "",
      "    timestamps(type: :utc_datetime)",
      "  end",
      "",
      "  def changeset(attrs) do",
      "    %__MODULE__{}",
      "    |> cast(attrs, [:items, :payment_method])",
      "    |> validate_required([:items, :payment_method])",
      "  end",
      "end",
    ].join("\n"),
  },
  {
    path: "priv/repo/migrations/20261028000000_create_orders.exs",
    content: [
      "defmodule Storefront.Repo.Migrations.CreateOrders do",
      "  use Ecto.Migration",
      "",
      "  def change do",
      "    create table(:orders) do",
      "      add :items, :integer, null: false",
      "      add :payment_method, :string, null: false",
      "",
      "      timestamps(type: :utc_datetime)",
      "    end",
      "  end",
      "end",
    ].join("\n"),
  },
  {
    path: "priv/repo/seeds.exs",
    content: [
      "Storefront.Repo.insert!(",
      '  %Storefront.Orders.Order{id: 42, items: 2, payment_method: "card"},',
      "  on_conflict: :nothing",
      ")",
    ].join("\n"),
  },
  // mix format at the page's width, for the files the page shows.
  {
    path: ".formatter.check.exs",
    content: "[import_deps: [:ecto, :ecto_sql, :phoenix], line_length: 87]",
  },
];

// Production, as the release runs: no code reloader, Logger at :info.
const PRODUCTION: Record<string, string> = {
  MIX_ENV: "prod",
  SECRET_KEY_BASE:
    "check-only-secret-key-base-check-only-secret-key-base-check-only-secret",
};

const PAGE_FILES: Array<string> = [
  "lib/storefront/application.ex",
  "lib/storefront/orders.ex",
  "lib/storefront/sampler.ex",
  "lib/storefront_web/controllers/order_controller.ex",
  "lib/storefront_web/endpoint.ex",
  "config/opentelemetry_metrics.exs",
  "config/opentelemetry_sampler.exs",
];

/*
 * A new Phoenix app around the page's files (the copy keeps them), the
 * page's two blocks added to the end of the runtime.exs it wrote, then
 * the page's steps.
 */
const COMMANDS: Array<VerificationCommand> = [
  {
    command: `cd /tmp && mix archive.install hex phx_new ${ELIXIR_PACKAGE_VERSIONS["phx_new"]} --force && mix phx.new storefront --no-assets --no-html --no-mailer --no-dashboard --no-gettext --no-install`,
  },
  { command: "cp -r --update=none /tmp/storefront/. ." },
  {
    command:
      "cat config/opentelemetry_metrics.exs config/opentelemetry_sampler.exs >> config/runtime.exs",
  },
  { snippet: "deps-get" },
  // The code shown is as mix format writes it, and compiles without a warning.
  {
    command: `mix format --check-formatted --dot-formatter .formatter.check.exs ${PAGE_FILES.join(" ")}`,
  },
  { command: "mix compile --warnings-as-errors", environment: PRODUCTION },
  { command: "mix ecto.migrate", environment: PRODUCTION },
  { command: "mix run priv/repo/seeds.exs", environment: PRODUCTION },
  { snippet: "run", isServer: true, environment: PRODUCTION },
];

export const PhoenixGuide: OpenTelemetryGuide = {
  slug: "phoenix",
  seo: {
    title: "Phoenix OpenTelemetry: Bandit, Ecto and Logger | OneUptime",
    description:
      "Trace a Phoenix app with OpenTelemetry: a span per request named after its route, Ecto queries and Req calls beneath it, Logger records with trace IDs.",
  },
  h1: "OpenTelemetry for Phoenix",
  lead: "Trace every request your Phoenix app serves, named after its route, with the Ecto queries and HTTP calls beneath it, and send traces, metrics and Logger's records to OneUptime. Three setup calls in `application.ex` attach the instrumentation to the `:telemetry` events Bandit, Phoenix and Ecto send, and a sampler of your own leaves the health check out.",
  cardDescription:
    "Phoenix 1.8 on Bandit: spans named after routes, Ecto queries and Req calls beneath them, Logger records with trace IDs.",
  searchTerms: [
    "bandit",
    "ecto",
    "plug",
    "liveview",
    "opentelemetry_phoenix",
    "telemetry",
    "health check",
  ],
  highlights: [
    "Spans named after routes",
    "Ecto queries with their SQL",
    "Phoenix 1.8 on Bandit",
  ],

  whatYouGet: {
    intro: `Each request becomes a trace under the service named by \`OTEL_SERVICE_NAME\`, which ${SCREENS.services} lists from the first request on. The example is a storefront's orders API on Phoenix 1.8, served by Bandit, keeping its orders in PostgreSQL through Ecto and charging them through a payments API it calls with Req.`,
    traces:
      "A server span per request, named after its route, such as `GET /api/orders/:id`, with the controller and action; beneath it, a span per Ecto query with its SQL, the spans your code opens, and a call to another service, which sends `traceparent` along.",
    metrics:
      "The instruments you create with the experimental metrics API, such as orders placed by payment method: the instrumentation of Phoenix, Bandit and Ecto records spans only.",
    logs: "Every Logger event, Phoenix's own request lines among them, with the trace and span IDs of the request it was written in, and Logger's metadata as attributes.",
    exceptions: `An exception a controller raises marks the request's span failed, with a 500, and is recorded on it with its message and stack trace; ${SCREENS.exceptions} lists it.`,
  },

  exampleTrace: {
    caption: "A POST /api/orders request, as its trace shows it",
    spans: [
      {
        name: "POST /api/orders",
        depth: 0,
        start: 0,
        duration: 100,
        source: "Bandit, Phoenix",
      },
      {
        name: "checkout.charge",
        depth: 1,
        start: 4,
        duration: 80,
        source: "your code",
      },
      { name: "POST", depth: 2, start: 6, duration: 76, source: "Req" },
      {
        name: "storefront.repo.query:orders",
        depth: 1,
        start: 87,
        duration: 9,
        source: "Ecto",
      },
    ],
  },

  prerequisites: [
    ELIXIR_PREREQUISITE,
    "A Phoenix 1.7 or later app served by Bandit 1.5 or later, as `mix phx.new` sets one up; on Cowboy, see the FAQ. Not a web app? The [Elixir](/integrations/opentelemetry/elixir) guide covers any OTP application.",
    SERVER_KEY_PREREQUISITE,
  ],

  install: {
    intro:
      "Add the OpenTelemetry packages to the deps in `mix.exs`, at the versions this guide was checked with, then fetch them:",
    snippets: [install, MIX_DEPS_GET_SNIPPET],
    notes: [
      "`opentelemetry_bandit` opens each request's span and `opentelemetry_phoenix` names it after the route: Phoenix 1.7 and later serve through Bandit, so both are needed.",
      "`opentelemetry_req` is for the HTTP calls your app makes with Req; leave it out if it makes none.",
    ],
  },

  configure: {
    intro:
      "Set the standard OpenTelemetry variables where the server starts, beside `DATABASE_URL` and `SECRET_KEY_BASE`: the SDK and the exporters read them, so nothing of OneUptime's is in `config/`:",
    tabs: otlpEnvironmentTabs({ serviceName: "storefront" }),
    notes: [
      "In development, export them in the shell that runs `mix phx.server`; a release reads them as it starts.",
    ],
  },

  setup: {
    intro:
      "The SDK starts as an application before yours and sends traces with no code. The setup calls in `start/2` attach the instrumentation, and the experimental SDK, set up in `config/runtime.exs`, sends metrics and logs.",
    steps: [
      {
        title: "Add the metric reader to the end of config/runtime.exs",
        body: "The experimental SDK's metric reader, exporting through OTLP over HTTP. Its interval comes from this configuration, not from `OTEL_METRIC_EXPORT_INTERVAL`, so the block reads the variable and passes it on:",
        snippets: [metricReader],
      },
      {
        title:
          "Attach the instrumentation, and send Logger's events, in application.ex",
        body: "Before the supervisor starts the endpoint: the log handler, one setup call each for Bandit, Phoenix and Ecto, and the counter. The children are as `mix phx.new` wrote them:",
        snippets: [application],
        notes: [
          "`[:storefront, :repo]` is the prefix of your repo's telemetry events, its module name in snake case: `MyApp.Repo` sends `[:my_app, :repo, :query]`.",
          "`db_statement: :enabled` records each query's SQL. Ecto sends values as parameters, `$1`, so the statement holds none of them.",
        ],
      },
      {
        title: "Run it",
        body: "With the variables above exported:",
        snippets: [run],
      },
    ],
  },

  autoInstrumentation: {
    intro:
      "Bandit, Phoenix and Ecto send `:telemetry` events as they work, and each instrumentation package turns its library's into spans. With this app, a request's trace holds:",
    rows: [
      {
        library: "`OpentelemetryBandit`",
        covers:
          "A server span per request, from the first byte read to the response sent, with the method, `url.path`, the status code and the client's address, its parent read from `traceparent`. A 5xx or an exception marks it failed.",
      },
      {
        library: "`OpentelemetryPhoenix`",
        covers:
          "The span renamed after the matched route, `GET /api/orders/:id`, with `http.route`, and `phoenix.plug` and `phoenix.action` for the controller and its action. LiveView's mounts and events become spans of their own.",
      },
      {
        library: "`OpentelemetryEcto`",
        covers:
          "A client span per query, named after the repo and the table, `storefront.repo.query:orders`, with `db.system`, `db.statement` and the query's queue, query and decode times.",
      },
      {
        library: "`OpentelemetryReq`",
        covers:
          "A client span for each call of a Req client it is attached to, with `url.full` and the status code; `propagate_trace_headers: true` adds `traceparent` to the call.",
      },
    ],
    snippets: [],
    notes: [
      "A request no route matched, such as a 404 on an unknown path, keeps the name Bandit gave it, the method alone.",
    ],
  },

  manualSpans: {
    intro:
      "Open spans with `Tracer.with_span` in your contexts. Here the order is charged inside a span of its own, with the payments API's call beneath it, before Ecto saves it:",
    snippets: [orders],
    notes: [
      "`with_span` makes its span current for the block, so Req's span, and any query run inside it, nest beneath it.",
      "Attributes with a handful of values, such as `payment.method`, are good filters: `@payment.method:card` in the **Traces** explorer.",
      "A span is current only in the process that opened it: a task started inside it needs `opentelemetry_process_propagator`'s wrapper, as the [Elixir](/integrations/opentelemetry/elixir) guide shows.",
    ],
  },

  logs: {
    intro:
      "Log with Logger in controllers and contexts. The handler sends each event with the IDs of the request's span, and the metadata you pass go along as attributes:",
    snippets: [controller],
    notes: [
      "`order_id: id` becomes the record's `order_id` attribute, beside Phoenix's `request_id`.",
      "Phoenix logs two lines a request, `GET /api/orders/42` and `Sent 200 in 2ms`, and both carry its trace ID, so a trace's logs show when it began and what it answered.",
      "An exception's report, `** (RuntimeError) the receipt printer is offline for order 42`, is a record of its own, in the trace of the request that raised it.",
    ],
  },

  metrics: {
    intro:
      "The instrumentation records spans only, so the app's metrics are the instruments it creates. `create_instruments`, called from `start/2`, creates the counter once:",
    builtIn: [],
    snippets: [counter],
    notes: [
      '`place_order` adds to it once the order is saved: `Counter.add(:"orders.placed", 1, %{"payment.method" => method})`.',
      "A request's duration is on its span, by route. For a duration metric of your own, record a histogram from Phoenix's `[:phoenix, :router_dispatch, :stop]` telemetry event.",
      "The reader exports every 60 seconds and sends nothing as the node stops.",
    ],
  },

  sampling: {
    intro:
      "Bandit opens a span for every request, the load balancer's health checks too. A sampler of your own decides as a request starts: this one drops the health check and keeps `ratio` of the rest, by trace ID. Add it, and name it at the end of `config/runtime.exs`:",
    snippets: [sampler, samplerConfig, endpoint],
    notes: [
      "`:parent_based` asks the sampler only about a request that starts a trace: one whose caller sent `traceparent` follows the caller's decision, and the spans beneath a request follow the request's.",
      "Lower `ratio` to keep a share: `0.25` keeps one request in four. The counter still counts every order, and every record is still sent.",
      "Leave `OTEL_TRACES_SAMPLER` unset: the SDK prefers it to the sampler in `config/`, and the health check would be traced again.",
      "The endpoint's `log_level` keeps the health check's request lines out of the logs too: `false` turns Phoenix's two lines off for that path.",
    ],
  },

  deploy: {
    intro:
      "`mix phx.gen.release --docker` writes the Dockerfile that builds the release, and OpenTelemetry needs nothing in it. In `mix.exs`, start the exporter before the SDK in the release:",
    snippets: [
      genRelease,
      releases,
      kubernetesManifestSnippet({
        name: "storefront",
        image: "registry.example.com/storefront:1.4.0",
        containerPort: 4000,
      }),
    ],
    notes: [
      "The release reads the variables as it starts: give the container `DATABASE_URL`, `SECRET_KEY_BASE` and `PHX_HOST` as well, from your own Secret.",
      "On SIGTERM the node stops your application, the endpoint with it, and then the SDK, whose batch processor sends its last spans as it stops.",
    ],
  },

  verify: {
    intro: "Check in this order: each step rules out one cause.",
    steps: [
      validateKeyStep("server"),
      {
        title: "Find the service",
        body: `Request \`curl localhost:4000/api/orders/42\`, then open ${SCREENS.services}: \`storefront\` is listed within a minute. No requests traced? Check that \`OpentelemetryBandit.setup()\` runs before the endpoint starts.`,
      },
      {
        title: "Open an order's trace",
        body: `Place an order with a \`POST\` to \`/api/orders\`, then search ${SCREENS.traces} for \`POST /api/orders\`: \`checkout.charge\` sits beneath it with the payments API's \`POST\`, and the insert beside it as \`storefront.repo.query:orders\`.`,
      },
      {
        title: "Find the exception",
        body: `Request \`/api/orders/42/receipt\`: ${SCREENS.exceptions} lists the \`RuntimeError\`, and its trace holds Phoenix's request lines and the exception's report.`,
      },
    ],
  },

  troubleshooting: [
    {
      question: "Requests are traced, but every span is named GET or POST",
      answer:
        "`OpentelemetryPhoenix.setup(adapter: :bandit)` did not run: it renames the span after the route once the router matches it. A request no route matched keeps the method alone.",
    },
    {
      question: "No request is traced at all",
      answer:
        "`OpentelemetryBandit.setup()` opens the spans: call it in `start/2`, before the supervisor starts the endpoint. An app served by Cowboy needs `opentelemetry_cowboy` instead, as the FAQ shows.",
    },
    {
      question: "The health check is traced again",
      answer:
        "`OTEL_TRACES_SAMPLER` is set where the app runs, and the SDK takes it over the sampler in `config/runtime.exs`. Unset it, and set the share with `ratio`.",
    },
    {
      question: "Ecto's spans arrive without their SQL",
      answer:
        "`OpentelemetryEcto` leaves the statement out unless asked: pass `db_statement: :enabled` to its setup, as above, or a function that returns the statement as it should be stored.",
    },
    {
      question: "The last log records before a deploy are missing",
      answer:
        "The log handler sends every second and sends nothing at shutdown, so up to a second's records are lost as the node stops; the metrics since the last export are lost the same way.",
    },
  ],

  faq: [
    {
      question: "My app runs on Cowboy, not Bandit",
      answer:
        "Add `opentelemetry_cowboy`, call `:opentelemetry_cowboy.setup()` in place of `OpentelemetryBandit.setup()`, and pass `adapter: :cowboy2` to `OpentelemetryPhoenix.setup`. The rest of this guide is the same.",
    },
    {
      question: "Are LiveView's events traced?",
      answer:
        "Yes: `OpentelemetryPhoenix.setup` also opens a span for each LiveView `mount`, `handle_params` and `handle_event`, named after the view, such as `StorefrontWeb.CartLive.handle_event#add`. `liveview: false` turns them off.",
    },
    {
      question: "Does the database password end up in the spans?",
      answer:
        "No: `OpentelemetryEcto` records the host in `db.url`, `ecto://127.0.0.1` here, and the database in `db.name`, but no user name or password, even with the repo configured from `DATABASE_URL`.",
    },
    {
      question: "Which versions were checked?",
      answer:
        "Phoenix 1.8.16 on Bandit 1.14 and Ecto SQL 3.14, with Elixir 1.20, `opentelemetry_phoenix` 2.0.1, `opentelemetry_bandit` 0.3.0, `opentelemetry_ecto` 1.2.0 and the SDK 1.7.0.",
    },
    {
      question: "Do I need an OpenTelemetry Collector?",
      answer:
        "No: each node sends straight to OneUptime. A Collector helps when many apps should share one exporter that holds the key and batches for them: see [OpenTelemetry](/docs/telemetry/open-telemetry).",
    },
  ],

  related: ["elixir", "rails", "django", "laravel"],
  docs: [DOCS.openTelemetry, DOCS.traces, DOCS.logs, DOCS.exceptions],

  verification: {
    runtime: "elixir",
    framework: { name: "Phoenix", package: "phoenix" },
    files: [
      { path: "lib/storefront/application.ex", snippet: "application" },
      { path: "lib/storefront/orders.ex", snippet: "orders" },
      { path: "lib/storefront/sampler.ex", snippet: "sampler" },
      {
        path: "lib/storefront_web/controllers/order_controller.ex",
        snippet: "controller",
      },
      // The page's two blocks for config/runtime.exs, added to its end below.
      { path: "config/opentelemetry_metrics.exs", snippet: "metric-reader" },
      { path: "config/opentelemetry_sampler.exs", snippet: "sampler-config" },
      ...SCAFFOLDING,
    ],
    stubApiPort: 9000,
    services: [
      postgresService({
        DATABASE_URL: "ecto://shop:shop@127.0.0.1:{port}/shop",
      }),
    ],
    commands: COMMANDS,
    port: 4000,
    requests: [
      { method: "GET", path: "/healthz" },
      { method: "GET", path: "/api/orders/42" },
      // A caller's request, whose trace the span continues.
      {
        method: "GET",
        path: "/api/orders/42",
        headers: {
          traceparent:
            "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        },
      },
      { method: "GET", path: "/api/orders/7" },
      {
        method: "POST",
        path: "/api/orders",
        body: { items: ["kettle", "mug"], payment_method: "card" },
      },
      { method: "GET", path: "/api/orders/42/receipt" },
      { method: "GET", path: "/nowhere" },
    ],
    expect: {
      spans: [
        {
          name: "GET /api/orders/:id",
          attributes: {
            "http.route": "/api/orders/:id",
            "http.response.status_code": "200",
            "phoenix.plug": "Elixir.StorefrontWeb.OrderController",
            "phoenix.action": "show",
          },
        },
        { name: "GET /api/orders/:id", parentSpanId: "00f067aa0ba902b7" },
        {
          name: "GET /api/orders/:id",
          attributes: { "http.response.status_code": "404" },
          hasException: false,
        },
        {
          name: "storefront.repo.query:orders",
          attributes: { "db.system": "postgresql", source: "orders" },
          parent: "GET /api/orders/:id",
        },
        {
          name: "checkout.charge",
          attributes: { "payment.method": "card", "order.item_count": "2" },
          parent: "POST /api/orders",
        },
        {
          name: "POST",
          attributes: {
            "url.full": "http://localhost:9000/api/charges",
            "http.response.status_code": "200",
          },
          parent: "checkout.charge",
        },
        { name: "storefront.repo.query:orders", parent: "POST /api/orders" },
        {
          name: "GET /api/orders/:id/receipt",
          attributes: { "http.response.status_code": "500" },
          hasException: true,
          exceptionMessage: "the receipt printer is offline for order 42",
        },
        {
          name: "GET",
          attributes: {
            "url.path": "/nowhere",
            "http.response.status_code": "404",
          },
        },
      ],
      metrics: ["orders.placed"],
      logs: [
        {
          body: "loading order 42",
          hasTraceContext: true,
          attributes: { order_id: "42" },
        },
        { body: "Sent 201", hasTraceContext: true },
        {
          body: "** (RuntimeError) the receipt printer is offline for order 42",
          hasTraceContext: true,
        },
      ],
      resource: { "service.name": "storefront" },
      untracedPaths: ["/healthz"],
      absentLogs: ["GET /healthz"],
    },
  },
};
