import {
  OpenTelemetryGuide,
  GuideSnippet,
  GuideVerificationRun,
  VerificationCommand,
  VerificationFile,
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
  BUNDLE_INSTALL_SNIPPET,
  RUBY_PACKAGE_VERSIONS,
  RUBY_PREREQUISITE,
  RUBY_SHUTDOWN_LINES,
  openTelemetryGemfileSnippet,
  rubyDockerfileSnippet,
} from "../RubyShared";

/*
 * A Rails 8 API app: a storefront's orders, kept in PostgreSQL, with a
 * payment provider called over HTTP and a receipt sent by a job. An
 * initializer starts the SDK once Bundler has loaded every gem, use_all
 * traces Rack, Action Pack, Active Record, Active Job, pg and Net::HTTP,
 * Rails' own logger sends its records, and a second initializer records
 * each request's duration from the event Rails sends as an action ends.
 * Checked in development, as the steps run it, and in production with
 * export delays longer than the run, so what arrives there is what the
 * at_exit hook sends as the server stops.
 */

const gemfile: GuideSnippet = openTelemetryGemfileSnippet();

// The app's own Gemfile, as the check runs it: OpenTelemetry's lines at its end.
const GEMFILE: string = [
  'source "https://rubygems.org"',
  "",
  `gem "rails", "${RUBY_PACKAGE_VERSIONS["rails"]}"`,
  `gem "pg", "${RUBY_PACKAGE_VERSIONS["pg"]}"`,
  `gem "puma", "${RUBY_PACKAGE_VERSIONS["puma"]}"`,
  "",
  gemfile.code,
].join("\n");

const initializer: GuideSnippet = {
  id: "initializer",
  language: "ruby",
  title: "config/initializers/opentelemetry.rb",
  code: [
    "# Bundler.require has loaded every gem by now, so use_all finds each library.",
    "OpenTelemetry::SDK.configure do |c|",
    "  c.use_all(",
    "    # The health check Rails answers at /up would be a trace of its own each time.",
    '    "OpenTelemetry::Instrumentation::Rack" => { untraced_endpoints: ["/up"] },',
    "    # A job's spans join the trace of the request that enqueued it.",
    '    "OpenTelemetry::Instrumentation::ActiveJob" => {',
    "      propagation_style: :child, span_naming: :job_class",
    "    }",
    "  )",
    "end",
    "",
    "# The SDK sends in batches, on a timer: send what is left as Rails exits.",
    ...RUBY_SHUTDOWN_LINES,
  ].join("\n"),
  check: "run",
};

const controllerFile: string = [
  'require "net/http"',
  "",
  "class OrdersController < ApplicationController",
  '  TRACER = OpenTelemetry.tracer_provider.tracer("storefront")',
  '  ORDERS_PLACED = OpenTelemetry.meter_provider.meter("storefront").create_counter(',
  '    "orders.placed", unit: "{order}", description: "Orders placed, by payment method"',
  "  )",
  "",
  "  # A missing order is the caller's mistake: a 404, not an exception to triage.",
  "  rescue_from ActiveRecord::RecordNotFound do",
  '    render json: { error: "no such order" }, status: :not_found',
  "  end",
  "",
  "  def show",
  '    Rails.logger.info("loading order #{params[:id]}")',
  "    render json: Order.find(params[:id])",
  "  end",
  "",
  "  def create",
  '    order = TRACER.in_span("checkout.charge") do |span|',
  '      span.set_attribute("payment.method", params[:payment_method])',
  '      span.set_attribute("order.item_count", params[:items].length)',
  "      charge(params[:payment_method])",
  "      Order.create!(items: params[:items].length, payment_method: params[:payment_method])",
  "    end",
  '    ORDERS_PLACED.add(1, attributes: { "payment.method" => order.payment_method })',
  "    ReceiptJob.perform_later(order.id)",
  "    render json: order, status: :created",
  "  end",
  "",
  "  def receipt",
  "    # Rails answers it with a 500, and the request's span records it.",
  '    raise IOError, "the receipt printer is offline"',
  "  end",
  "",
  "  private",
  "",
  "  def charge(method)",
  '    payments = ENV.fetch("PAYMENTS_API_URL", "http://localhost:9000")',
  '    Net::HTTP.post(URI("#{payments}/api/charges"), { payment_method: method }.to_json,',
  '                   "Content-Type" => "application/json")',
  "  end",
  "end",
].join("\n");

const createOrder: GuideSnippet = {
  id: "create-order",
  language: "ruby",
  title: "app/controllers/orders_controller.rb",
  code: blockOf(controllerFile, "def create", "end"),
  check: "contained",
};

const showOrder: GuideSnippet = {
  id: "show-order",
  language: "ruby",
  title: "app/controllers/orders_controller.rb",
  code: blockOf(controllerFile, "def show", "end"),
  check: "contained",
};

const rescueNotFound: GuideSnippet = {
  id: "rescue-not-found",
  language: "ruby",
  title: "app/controllers/orders_controller.rb",
  code: blockOf(controllerFile, "# A missing order is", "end"),
  check: "contained",
};

const receiptJob: GuideSnippet = {
  id: "receipt-job",
  language: "ruby",
  title: "app/jobs/receipt_job.rb",
  code: [
    "class ReceiptJob < ApplicationJob",
    "  def perform(order_id)",
    '    Rails.logger.info("sending the receipt for order #{order_id}")',
    "  end",
    "end",
  ].join("\n"),
  check: "run",
};

const requestDuration: GuideSnippet = {
  id: "request-duration",
  language: "ruby",
  title: "config/initializers/request_duration.rb",
  code: [
    "# Ruby's instrumentations send no metrics: each request's duration, by route,",
    "# from the event Rails sends as each action completes.",
    "OpenTelemetry.meter_provider.add_view(",
    '  "http.server.request.duration",',
    "  aggregation: OpenTelemetry::SDK::Metrics::Aggregation::ExplicitBucketHistogram.new(",
    "    boundaries: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]",
    "  )",
    ")",
    'request_duration = OpenTelemetry.meter_provider.meter("storefront").create_histogram(',
    '  "http.server.request.duration", unit: "s", description: "Duration of HTTP server requests"',
    ")",
    "",
    'ActiveSupport::Notifications.subscribe("process_action.action_controller") do |event|',
    "  request = event.payload[:request]",
    "  request_duration.record(event.duration / 1000.0, attributes: {",
    '    "http.request.method" => request.request_method,',
    '    "http.route" => request.route_uri_pattern.to_s.delete_suffix("(.:format)"),',
    "    # No status yet when the action raised: Rails answers that with a 500.",
    '    "http.response.status_code" => event.payload[:status] || 500',
    "  })",
    "end",
  ].join("\n"),
  check: "run",
};

const ROUTES: string = [
  "Rails.application.routes.draw do",
  '  get "up" => "rails/health#show", as: :rails_health_check',
  "  resources :orders, only: [:show, :create] do",
  "    get :receipt, on: :member",
  "  end",
  "end",
].join("\n");

const ORDER_MODEL: string = ["class Order < ApplicationRecord", "end"].join(
  "\n",
);

const MIGRATION: string = [
  "class CreateOrders < ActiveRecord::Migration[8.1]",
  "  def change",
  "    create_table :orders do |t|",
  "      t.integer :items",
  "      t.string :payment_method",
  "      t.timestamps",
  "    end",
  "  end",
  "end",
].join("\n");

const run: GuideSnippet = {
  id: "run",
  language: "bash",
  code: "bin/rails server",
  check: "run",
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

const keyRefused: GuideSnippet = {
  id: "key-refused",
  language: "text",
  title: "What the server prints",
  code: [
    "OpenTelemetry error: unexpected error decoding rpc.Status in",
    "  OTLP::Exporter#log_status - Error occurred during parsing",
    "OpenTelemetry error: Unable to export 9 spans",
  ].join("\n"),
  check: "illustrative",
};

/*
 * The app the check builds: Rails' own files, from `rails new` with the
 * page's files already in place (--skip keeps them), then the page's
 * steps. The folder is named after the guide, so the app is given a name.
 */
const FILES: Array<VerificationFile> = [
  { path: "Gemfile", content: GEMFILE },
  { path: "config/initializers/opentelemetry.rb", snippet: "initializer" },
  {
    path: "config/initializers/request_duration.rb",
    snippet: "request-duration",
  },
  { path: "app/controllers/orders_controller.rb", content: controllerFile },
  { path: "app/jobs/receipt_job.rb", snippet: "receipt-job" },
  { path: "app/models/order.rb", content: ORDER_MODEL },
  { path: "db/migrate/20261028000000_create_orders.rb", content: MIGRATION },
  { path: "config/routes.rb", content: ROUTES },
];

const NEW_APP: Array<VerificationCommand> = [
  {
    command: `gem install rails -v ${RUBY_PACKAGE_VERSIONS["rails"]} --no-document`,
  },
  {
    command:
      "rails new . --name=storefront --api --minimal --no-skip-active-job --database=postgresql --skip-git --skip-docker --skip-test --skip-bundle --skip --quiet",
  },
];

// Production as the Dockerfile runs it: plain HTTP behind the check, a secret.
const PRODUCTION: Record<string, string> = {
  RAILS_ENV: "production",
  SECRET_KEY_BASE: "only-for-the-end-to-end-check",
};

/*
 * Export intervals longer than the run: what arrives from the production
 * server is what its at_exit hook sends as it stops.
 */
const SENT_AT_EXIT: Record<string, string> = {
  ...PRODUCTION,
  OTEL_BSP_SCHEDULE_DELAY: "30000",
  OTEL_BLRP_SCHEDULE_DELAY: "30000",
  OTEL_METRIC_EXPORT_INTERVAL: "60000",
};

function appRun(
  environment: Record<string, string> | undefined,
): Pick<
  GuideVerificationRun,
  "files" | "commands" | "port" | "requests" | "stubApiPort" | "services"
> {
  const setup: Array<VerificationCommand> = environment
    ? [
        ...NEW_APP,
        // The check speaks plain HTTP to the server: no redirect to HTTPS.
        {
          command:
            "sed -i 's/config.force_ssl = true/config.force_ssl = false/; s/config.assume_ssl = true/config.assume_ssl = false/' config/environments/production.rb",
        },
      ]
    : NEW_APP;

  return {
    files: FILES,
    stubApiPort: 9000,
    services: [
      postgresService({
        DATABASE_URL:
          "postgres://shop:shop@127.0.0.1:{port}/shop?sslmode=disable",
      }),
    ],
    commands: [
      ...setup,
      { snippet: "bundle-install" },
      { command: "bin/rails db:prepare", environment: environment },
      {
        command:
          "bin/rails runner 'Order.create!(id: 42, items: 2, payment_method: \"card\")'",
        environment: environment,
      },
      { snippet: "run", isServer: true, environment: environment },
    ],
    port: 3000,
    requests: [
      { method: "GET", path: "/up" },
      { method: "GET", path: "/orders/42" },
      { method: "GET", path: "/orders/7" },
      {
        method: "POST",
        path: "/orders",
        body: { items: ["kettle", "mug"], payment_method: "card" },
      },
      { method: "GET", path: "/orders/42/receipt" },
    ],
  };
}

export const RailsGuide: OpenTelemetryGuide = {
  slug: "rails",
  seo: {
    title: "Ruby on Rails OpenTelemetry: Tracing and Logs | OneUptime",
    description:
      "Add OpenTelemetry to a Rails app: spans named after routes, Active Record and Active Job, Rails.logger with trace IDs, and request duration, sent to OneUptime.",
  },
  h1: "OpenTelemetry for Ruby on Rails",
  lead: "Trace every request your Rails app serves, named after its route, with the Active Record queries, the HTTP calls and the jobs beneath it, and send traces, metrics and `Rails.logger`'s records to OneUptime. An initializer starts the SDK once Bundler has loaded your gems, and `use_all` finds Rails and every library it uses by itself.",
  cardDescription:
    "Rails 7.1 and later: spans named after routes, Active Record and Active Job beneath them, Rails.logger with trace IDs.",
  searchTerms: [
    "ruby on rails",
    // Rails to many who type it: RoR finds this guide, not every Ruby one.
    "ror",
    "actionpack",
    "activerecord",
    "activejob",
    "initializer",
    "rails.logger",
  ],
  highlights: [
    "One initializer",
    "Active Record and Active Job",
    "Rails 7.1 and later",
  ],

  whatYouGet: {
    intro: `Each request becomes a trace under the service named by \`OTEL_SERVICE_NAME\`, which ${SCREENS.services} lists after its first request. The example is a storefront's orders API on Rails 8, keeping its orders in PostgreSQL, charging a payment provider over HTTP and sending each receipt from a job.`,
    traces:
      "A server span per request, named after the route, such as `GET /orders/:id`, with the controller and action; beneath it, Active Record's operations with their SQL, `Net::HTTP` calls, and the job a request enqueues, run in the same trace.",
    metrics:
      "`http.server.request.duration` by route, method and status, from the event Rails sends as each action completes, and instruments of your own, such as orders placed by payment method.",
    logs: "Every `Rails.logger` record, Rails' own request lines among them, at its severity and with the trace and span IDs of the request or job that wrote it.",
    exceptions: `An exception an action raises is answered with a 500 and recorded on the request's span with its type, message and stack trace, so ${SCREENS.exceptions} lists it. One that \`rescue_from\` handles, such as a missing record answered with a 404, is not.`,
  },

  exampleTrace: {
    caption: "A POST /orders request, as its trace shows it",
    spans: [
      {
        name: "POST /orders",
        depth: 0,
        start: 0,
        duration: 100,
        source: "rack",
      },
      {
        name: "checkout.charge",
        depth: 1,
        start: 4,
        duration: 76,
        source: "your code",
      },
      { name: "POST", depth: 2, start: 7, duration: 34, source: "net_http" },
      {
        name: "Order.create!",
        depth: 2,
        start: 45,
        duration: 32,
        source: "active_record",
      },
      {
        name: "INSERT shop",
        depth: 3,
        start: 50,
        duration: 22,
        source: "pg",
      },
      {
        name: "ReceiptJob publish",
        depth: 1,
        start: 84,
        duration: 8,
        source: "active_job",
      },
    ],
  },

  prerequisites: [
    RUBY_PREREQUISITE,
    "A Rails app on Rails 7.1 or later, the oldest the Rails instrumentation supports. Not on Rails? The [Ruby](/integrations/opentelemetry/ruby) and [Sinatra](/integrations/opentelemetry/sinatra) guides start the SDK without it.",
    SERVER_KEY_PREREQUISITE,
  ],

  install: {
    intro:
      "Add OpenTelemetry's gems at the end of your app's `Gemfile`, at the versions this guide was checked with, then install them:",
    snippets: [gemfile, BUNDLE_INSTALL_SNIPPET],
    notes: [
      "`opentelemetry-instrumentation-all` carries the Rails instrumentation, which installs Action Pack's, Action View's, Active Record's and Active Job's, and those for `pg`, `mysql2`, Redis and `Net::HTTP` beside them.",
      "Leave the gems without `require: false`: `Bundler.require` in `config/application.rb` loads them, which is what lets the initializer below start the SDK with no `require` of its own.",
    ],
  },

  configure: {
    intro:
      "The SDK takes its endpoint, its key and the service's name from the standard OpenTelemetry variables, so nothing of OneUptime's lands in `config/` or in your credentials:",
    tabs: otlpEnvironmentTabs({ serviceName: "storefront" }),
    notes: [
      "Set them where the server's environment comes from: your host's settings, a Kubernetes Secret as below, or an `.env` file your tooling loads. They apply in every Rails environment alike.",
    ],
  },

  setup: {
    intro:
      "One initializer is the whole setup: Rails runs it after `Bundler.require` has loaded every gem, so `use_all` finds Rails and the libraries around it. Your controllers, models and jobs need no change.",
    steps: [
      {
        title: "Add an initializer that starts OpenTelemetry",
        body: "Configure the SDK with every instrumentation, give Rack's and Active Job's the options this app wants, and send what is left as the server exits:",
        snippets: [initializer],
        notes: [
          "`propagation_style: :child` runs each job's spans in the trace of the request that enqueued it; the default, `:link`, starts a trace per job, linked to the request's. `span_naming: :job_class` names them `ReceiptJob publish` and `ReceiptJob process`, rather than after the queue.",
          "Rails' health check, `/up`, is called every few seconds by a load balancer: leaving it out of `untraced_endpoints` makes a trace of each call.",
        ],
      },
      {
        title: "Write jobs as usual",
        body: "A job enqueued while a request is served is traced in that request's trace, and its log records carry the same trace ID:",
        snippets: [receiptJob],
      },
      {
        title: "Start the server",
        body: "With the variables above exported, start Rails, in development as here or with `RAILS_ENV=production`, as the image below does:",
        snippets: [run],
        notes: [
          "As Rails starts, the SDK prints a line for each instrumentation it installed, from `ActionPack` to `PG`.",
        ],
      },
    ],
  },

  autoInstrumentation: {
    intro:
      "The Rails instrumentation installs those of the frameworks inside Rails, and `use_all` adds the ones for the libraries your app loads. With this app, a request's trace holds:",
    rows: [
      {
        library: "Rack and Action Pack",
        covers:
          "A server span per request, named after its route (`GET /orders/:id`), with `http.route`, `code.namespace` and `code.function` for the controller and action, the status code, and the exception of an action that raised.",
      },
      {
        library: "Active Record and `pg`",
        covers:
          "A span per model operation, such as `Order query` or `Order.create!`, with the SQL beneath it as `pg` spans named after the operation and database (`INSERT shop`), values replaced by `?`.",
      },
      {
        library: "Active Job",
        covers:
          "A `publish` span where a job is enqueued and a `process` span where it runs, with the job's ID and queue adapter; with the options above, both in the request's trace.",
      },
      {
        library: "`Net::HTTP`",
        covers:
          "A client span per call, named after its method (`POST`), with `traceparent` sent along so the payment provider's service, if traced, joins the trace.",
      },
      {
        library: "`Logger`",
        covers:
          "Every `Rails.logger` record, with the IDs of the span that was current: Rails' `Started`, `Processing` and `Completed` lines among them.",
      },
    ],
    snippets: [],
    notes: [
      "Each instrumentation takes its options under its own name in `use_all`'s map, as Rack's and Active Job's do in the initializer.",
    ],
  },

  manualSpans: {
    intro:
      "Open a span of your own around work no library names, such as a charge, with `in_span` from a tracer created once. Active Record's and `Net::HTTP`'s spans inside the block nest beneath it:",
    snippets: [createOrder],
    notes: [
      "`in_span` returns what its block returns: here, the order the block created.",
      "An exception raised in the block is recorded on the span, which is marked failed, and goes on up to the action, which Rails answers with a 500.",
      "Find the attributes you set in the **Traces** explorer, such as `@payment.method:card`.",
    ],
  },

  logs: {
    intro:
      "Keep writing to `Rails.logger`. The Logger instrumentation sends each record, with the trace and span IDs of the request or job that wrote it:",
    snippets: [showOrder],
    notes: [
      "The body is the line Rails writes, its tags included: in production, Rails' default `log_tags` put the request ID in front, as `[7f35ee1a-...] loading order 42`.",
      "Rails logs an action's exception at **ERROR** as several lines of one record; the exception itself, with its type and stack trace, reaches OneUptime on the request's span.",
      "In development, Rails colors its SQL lines with terminal escape codes, which arrive in those records' bodies as written; production, at its default level, logs no SQL lines.",
      "Rails 8's production configuration silences its lines for the health check, with `config.silence_healthcheck_path`, so `/up` sends no records there.",
    ],
  },

  metrics: {
    intro:
      "Ruby's instrumentations send no metrics, but Rails sends an event as each action completes, with its request, status and duration. One subscriber turns it into the request duration other OpenTelemetry SDKs send:",
    builtIn: [],
    snippets: [requestDuration],
    notes: [
      "Initializers run in the order of their names, so `opentelemetry.rb` has configured the SDK before `request_duration.rb` creates its histogram. The view sets its buckets in seconds; the Ruby SDK's defaults, up to 1000, suit milliseconds.",
      "`route_uri_pattern` is the route as `config/routes.rb` declares it, with Rails' optional `(.:format)` taken off: `/orders/:id`.",
      "`ORDERS_PLACED`, in the controller, counts orders by payment method: a few values each, so a few series.",
    ],
  },

  sampling: {
    intro:
      "The health check is left out by `untraced_endpoints` already. Once traffic grows, keep a share of the other traces with the standard variables:",
    snippets: [sampling],
    notes: [
      "Of the requests that start a trace, `parentbased_traceidratio` keeps a quarter; a request whose caller sent `traceparent` follows that caller, and a job follows the request that enqueued it.",
      "Measurements are not sampled: the duration histogram and `orders.placed` count every request.",
    ],
  },

  deploy: {
    intro:
      "Build the image with the gems installed and Rails in production, and give the Deployment the key from a Secret:",
    snippets: [
      rubyDockerfileSnippet({
        command: ["bin/rails", "server"],
        port: 3000,
        environment: { RAILS_ENV: "production" },
      }),
      kubernetesManifestSnippet({
        name: "storefront",
        image: "registry.example.com/storefront:3.2.0",
        containerPort: 3000,
      }),
    ],
    notes: [
      "Give the container its `DATABASE_URL` and `SECRET_KEY_BASE` the way your other Rails settings reach it, from a Secret of their own.",
      "Kubernetes sends SIGTERM before it stops a pod: Puma finishes the requests in flight and Rails exits through the initializer's `at_exit` hook, which sends the last spans, metrics and records.",
    ],
  },

  verify: {
    intro: "Check in this order: each step rules out one cause.",
    steps: [
      validateKeyStep("server"),
      {
        title: "Find the service",
        body: `Load an order, with \`curl localhost:3000/orders/42\`, then open ${SCREENS.services}: \`storefront\` is listed within a minute.`,
      },
      {
        title: "Open a request's trace",
        body: `Look up \`POST /orders\` in ${SCREENS.traces}: its trace holds \`checkout.charge\` with the payment call and \`Order.create!\` beneath it, then \`ReceiptJob publish\` and the job's \`ReceiptJob process\`.`,
      },
      {
        title: "Find the exception and the logs",
        body: `Request \`/orders/42/receipt\`: ${SCREENS.exceptions} lists its \`IOError\`, and in ${SCREENS.logs} the request's \`Started GET\` line opens the same trace.`,
      },
    ],
  },

  troubleshooting: [
    {
      question: "Every 404 shows up under Exceptions",
      answer:
        "Rails answers `ActiveRecord::RecordNotFound` with a 404, and the span records the exception all the same. Handle it in the controller with `rescue_from`, as above, and the request ends as an ordinary 404 with no exception:",
      snippets: [rescueNotFound],
    },
    {
      question: "Spans named rake.execute arrive with every deploy",
      answer:
        "The Rake instrumentation traces each task run with the variables set, such as `bin/rails db:migrate` in a release step, along with the SQL it sends. Leave the variables out of that step's environment, or set `OTEL_RUBY_INSTRUMENTATION_RAKE_ENABLED=false` there.",
    },
    {
      question: "A job's spans are in a trace of their own",
      answer:
        "That is Active Job's default, `propagation_style: :link`: the job's trace links back to the request's. Set `:child`, as the initializer does, to keep both in one trace.",
    },
    {
      question:
        "The first request after a start holds a dozen SET and SELECT spans",
      answer:
        "Active Record opened its first connection inside that request, and read the database's types and tables as it did: `SET shop`, `SHOW shop` and `SELECT shop` spans against `pg_type` and `pg_class`. The requests after it reuse the connection.",
    },
    {
      question:
        "Nothing arrives, and the server prints “unexpected error decoding rpc.Status”",
      answer:
        "OneUptime refused the key, and the exporter reports the JSON answer it could not decode. `OTEL_EXPORTER_OTLP_HEADERS` must be `x-oneuptime-token=` followed by a **Server** key's **Secret Key**:",
      snippets: [keyRefused],
    },
    {
      question:
        "Rails stops at boot with “uninitialized constant OpenTelemetry”",
      answer:
        "The initializer ran before anything loaded the gems: they are in the `Gemfile` with `require: false`, or in a group that `Bundler.require` leaves out in this environment. List them outside any group, without `require: false`, as above.",
    },
  ],

  faq: [
    {
      question: "Which Rails versions are supported?",
      answer:
        "Rails 7.1 and later: the Rails instrumentation installs for nothing older. This guide was checked with Rails 8.1, Puma 8 and Ruby 4.0.",
    },
    {
      question: "Does it trace Sidekiq or Solid Queue jobs?",
      answer:
        "Active Job's spans cover every queue adapter, Solid Queue and Sidekiq included, wherever the job runs; start the SDK in the worker too, which a Rails initializer does by itself. `use_all` adds Sidekiq's own instrumentation when the `sidekiq` gem is loaded.",
    },
    {
      question: "Can I keep a Rails environment from sending?",
      answer:
        "Yes: set `OTEL_SDK_DISABLED=true` in that environment, such as your test suite's. The SDK then sets nothing up, and the `at_exit` hook finds nothing to send.",
    },
    {
      question: "Do I need an OpenTelemetry Collector?",
      answer:
        "No: Rails sends straight to OneUptime. A Collector pays off when many apps should share one exporter that holds the key and batches or filters for all of them: see [OpenTelemetry](/docs/telemetry/open-telemetry).",
    },
  ],

  related: ["ruby", "sidekiq", "phoenix", "django"],
  docs: [DOCS.openTelemetry, DOCS.traces, DOCS.logs, DOCS.exceptions],

  verification: {
    runtime: "ruby",
    framework: { name: "Rails", package: "rails" },
    ...appRun(undefined),
    expect: {
      spans: [
        {
          name: "GET /orders/:id",
          attributes: {
            "http.route": "/orders/:id",
            "code.namespace": "OrdersController",
            "code.function": "show",
            "http.response.status_code": "200",
          },
        },
        {
          name: "GET /orders/:id",
          attributes: { "http.response.status_code": "404" },
          hasException: false,
        },
        { name: "Order query", parent: "GET /orders/:id" },
        {
          name: "checkout.charge",
          attributes: { "payment.method": "card", "order.item_count": "2" },
          parent: "POST /orders",
        },
        {
          name: "POST",
          attributes: { "url.path": "/api/charges" },
          parent: "checkout.charge",
        },
        { name: "Order.create!", parent: "checkout.charge" },
        { name: "INSERT shop", parent: "Order#save!" },
        { name: "ReceiptJob publish", parent: "POST /orders" },
        { name: "ReceiptJob process", parent: "ReceiptJob publish" },
        {
          name: "GET /orders/:id/receipt",
          attributes: { "http.response.status_code": "500" },
          hasException: true,
          exceptionMessage: "the receipt printer is offline",
        },
      ],
      metrics: ["http.server.request.duration", "orders.placed"],
      logs: [
        { body: "loading order 42", hasTraceContext: true },
        { body: "sending the receipt for order", hasTraceContext: true },
      ],
      resource: { "service.name": "storefront" },
      untracedPaths: ["/up"],
    },
    variants: [
      {
        // Production, as the image runs it, sending what is left at exit.
        name: "Production",
        ...appRun(SENT_AT_EXIT),
        expect: {
          spans: [
            {
              name: "GET /orders/:id",
              attributes: { "http.route": "/orders/:id" },
            },
            { name: "checkout.charge", parent: "POST /orders" },
            { name: "ReceiptJob process", parent: "ReceiptJob publish" },
            { name: "GET /orders/:id/receipt", hasException: true },
          ],
          metrics: ["http.server.request.duration", "orders.placed"],
          logs: [
            { body: "loading order 42", hasTraceContext: true },
            { body: "Completed 201 Created", hasTraceContext: true },
          ],
          untracedPaths: ["/up"],
          absentLogs: ['Started GET "/up"'],
        },
      },
    ],
  },
};
