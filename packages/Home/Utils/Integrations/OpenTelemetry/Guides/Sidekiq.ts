import {
  OpenTelemetryGuide,
  GuideSnippet,
  GuideVerificationRun,
} from "../GuideTypes";
import {
  DOCS,
  SCREENS,
  SERVER_KEY_PREREQUISITE,
  kubernetesManifestSnippet,
  otlpEnvironmentTabs,
  redisService,
  validateKeyStep,
} from "../GuideShared";
import { blockOf } from "../GuideSnippets";
import {
  BUNDLE_INSTALL_SNIPPET,
  RUBY_PREREQUISITE,
  gemfileSnippet,
  rubyDockerfileSnippet,
  rubyTelemetrySnippet,
} from "../RubyShared";

/*
 * A Sidekiq worker that sends order receipts through a mail service, and
 * a script that enqueues them. telemetry.rb starts the SDK in both, with
 * Sidekiq's spans in the trace that enqueued the job and Redis' polling
 * left out; a server middleware records each job's duration. Checked with
 * the worker stopped by SIGTERM, once with export delays longer than the
 * run, so what arrives is what each process sends as it ends.
 */

const gemfile: GuideSnippet = gemfileSnippet(["sidekiq"]);

const telemetry: GuideSnippet = rubyTelemetrySnippet({
  libraries: ["logger", "net/http", "sidekiq"],
  configure: [
    "  c.use_all(",
    "    # Each job's spans join the trace of the code that enqueued it.",
    '    "OpenTelemetry::Instrumentation::Sidekiq" => {',
    "      propagation_style: :child, span_naming: :job_class",
    "    },",
    "    # Sidekiq polls Redis all the time: keep only the commands sent within a span.",
    '    "OpenTelemetry::Instrumentation::Redis" => { trace_root_spans: false }',
    "  )",
  ],
});

const jobsFile: string = [
  'require_relative "telemetry"',
  'require_relative "job_duration"',
  'require "json"',
  "",
  "# Sidekiq's default formatter colors each severity with escape codes; Plain does not.",
  "Sidekiq.default_configuration.logger.formatter = Sidekiq::Logger::Formatters::Plain.new",
  "",
  "Sidekiq.configure_server do |config|",
  "  config.server_middleware { |chain| chain.add JobDuration }",
  "end",
  "",
  'TRACER = OpenTelemetry.tracer_provider.tracer("receipts")',
  'RECEIPTS_SENT = OpenTelemetry.meter_provider.meter("receipts").create_counter(',
  '  "receipts.sent", unit: "{receipt}", description: "Receipts sent to the mail service"',
  ")",
  "",
  "class ReceiptJob",
  "  include Sidekiq::Job",
  "  sidekiq_options retry: 3",
  "",
  "  def perform(order_id, email)",
  "    # Raised here, it is recorded on the job's span, and Sidekiq retries the job.",
  "    if email.to_s.empty?",
  '      raise ArgumentError, "order #{order_id} has no email address"',
  "    end",
  "",
  '    logger.info("sending the receipt for order #{order_id}")',
  '    body = TRACER.in_span("receipt.render", attributes: { "order.id" => order_id }) do',
  '      { order_id: order_id, to: email, lines: ["kettle", "mug"] }.to_json',
  "    end",
  '    mail = ENV.fetch("MAIL_API_URL", "http://localhost:9000")',
  '    Net::HTTP.post(URI("#{mail}/api/receipts"), body,',
  '                   "Content-Type" => "application/json")',
  '    RECEIPTS_SENT.add(1, attributes: { "receipt.channel" => "email" })',
  "  end",
  "end",
].join("\n");

const jobs: GuideSnippet = {
  id: "jobs",
  language: "ruby",
  title: "jobs.rb",
  code: jobsFile,
  check: "run",
};

const perform: GuideSnippet = {
  id: "perform",
  language: "ruby",
  title: "jobs.rb",
  code: blockOf(jobsFile, "def perform(", "end"),
  check: "contained",
};

const loggerSetup: GuideSnippet = {
  id: "logger",
  language: "ruby",
  title: "jobs.rb",
  code: [
    "# Sidekiq's default formatter colors each severity with escape codes; Plain does not.",
    "Sidekiq.default_configuration.logger.formatter = Sidekiq::Logger::Formatters::Plain.new",
  ].join("\n"),
  check: "contained",
};

const jobDuration: GuideSnippet = {
  id: "job-duration",
  language: "ruby",
  title: "job_duration.rb",
  code: [
    "# Ruby's instrumentations send no metrics: this server middleware records how",
    "# long each job takes, by class and outcome, as messaging.process.duration.",
    "OpenTelemetry.meter_provider.add_view(",
    '  "messaging.process.duration",',
    "  aggregation: OpenTelemetry::SDK::Metrics::Aggregation::ExplicitBucketHistogram.new(",
    "    boundaries: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]",
    "  )",
    ")",
    "",
    "class JobDuration",
    "  include Sidekiq::ServerMiddleware",
    "",
    '  DURATION = OpenTelemetry.meter_provider.meter("receipts").create_histogram(',
    '    "messaging.process.duration", unit: "s", description: "Duration of processing a job"',
    "  )",
    "",
    "  def call(_job_instance, job, queue)",
    "    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)",
    '    attributes = { "messaging.system" => "sidekiq", "messaging.destination.name" => queue,',
    '                   "messaging.sidekiq.job_class" => job["class"] }',
    "    yield",
    "  rescue StandardError => error",
    '    attributes["error.type"] = error.class.name',
    "    raise",
    "  ensure",
    "    elapsed = Process.clock_gettime(Process::CLOCK_MONOTONIC) - started",
    "    DURATION.record(elapsed, attributes: attributes)",
    "  end",
    "end",
  ].join("\n"),
  check: "run",
};

const enqueue: GuideSnippet = {
  id: "enqueue",
  language: "ruby",
  title: "enqueue.rb",
  code: [
    'require_relative "jobs"',
    "",
    "# What enqueues jobs is traced too: here a script, in a web app a request.",
    'OpenTelemetry.tracer_provider.tracer("receipts").in_span("receipts.enqueue") do',
    '  ReceiptJob.perform_async(42, "ada@example.com")',
    '  ReceiptJob.perform_async(43, "")',
    "end",
  ].join("\n"),
  check: "run",
};

const runWorker: GuideSnippet = {
  id: "run",
  language: "bash",
  code: "bundle exec sidekiq -r ./jobs.rb",
  check: "run",
};

const runEnqueue: GuideSnippet = {
  id: "run-enqueue",
  language: "bash",
  code: "bundle exec ruby enqueue.rb",
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

const exportFailed: GuideSnippet = {
  id: "export-failed",
  language: "text",
  title: "What the worker prints",
  code: [
    "OpenTelemetry error: Unable to export 6 spans",
    "OpenTelemetry error: Failed to open TCP connection to localhost:4318",
  ].join("\n"),
  check: "illustrative",
};

/*
 * Export intervals longer than the run: what arrives is what the worker
 * and the script each send from their at_exit hooks as they end.
 */
const SENT_AT_EXIT: Record<string, string> = {
  OTEL_BSP_SCHEDULE_DELAY: "30000",
  OTEL_BLRP_SCHEDULE_DELAY: "30000",
  OTEL_METRIC_EXPORT_INTERVAL: "60000",
};

function workerRun(
  environment: Record<string, string> | undefined,
): Pick<
  GuideVerificationRun,
  "files" | "commands" | "requests" | "stubApiPort" | "services"
> {
  return {
    files: [
      { path: "Gemfile", snippet: "gemfile" },
      { path: "telemetry.rb", snippet: "telemetry" },
      { path: "job_duration.rb", snippet: "job-duration" },
      { path: "jobs.rb", snippet: "jobs" },
      { path: "enqueue.rb", snippet: "enqueue" },
    ],
    stubApiPort: 9000,
    services: [redisService({ REDIS_URL: "redis://127.0.0.1:{port}/0" })],
    commands: [
      { snippet: "bundle-install" },
      {
        snippet: "run",
        isServer: true,
        readyText: "connecting to Redis",
        environment: environment,
      },
      { snippet: "run-enqueue", environment: environment },
    ],
    requests: [],
  };
}

export const SidekiqGuide: OpenTelemetryGuide = {
  slug: "sidekiq",
  seo: {
    title: "Sidekiq OpenTelemetry: Job Tracing and Metrics | OneUptime",
    description:
      "Trace Sidekiq jobs with OpenTelemetry: each job in the trace that enqueued it, its calls and errors, job duration by class, and Sidekiq's logs, in OneUptime.",
  },
  h1: "OpenTelemetry for Sidekiq",
  lead: "Trace every Sidekiq job in the trace of the code that enqueued it, with the calls the job makes and the exception that failed it, and send traces, metrics and logs to OneUptime. One file starts the SDK in the worker and wherever jobs are enqueued, and a server middleware records how long each job takes.",
  cardDescription:
    "Sidekiq 7 and later: each job in the trace that enqueued it, with its calls and exceptions, job duration by class, plain logs.",
  searchTerms: ["background jobs", "worker", "queue", "perform_async", "redis"],
  highlights: [
    "Jobs in the enqueuing trace",
    "Job duration by class",
    "Sidekiq 7 and later",
  ],

  whatYouGet: {
    intro: `Each Sidekiq process reports under the service named by \`OTEL_SERVICE_NAME\`, listed in ${SCREENS.services} once it first sends. The example is a worker that sends order receipts through a mail service, and a script that enqueues them; a web app enqueues the same way.`,
    traces:
      "A `publish` span where a job is enqueued and a `process` span where it runs, in one trace with the code that enqueued it, and beneath the job a span for each HTTP call and each Redis command it makes.",
    metrics:
      "`messaging.process.duration` for every job, by class, queue and error type, from a small server middleware, and counters of your own, such as receipts sent. Sidekiq's instrumentation records spans only.",
    logs: "Each line a job writes to `logger`, with the trace and span IDs of the job, and Sidekiq's own lines beside them.",
    exceptions: `An exception a job raises is recorded on its \`process\` span with its type, message and stack trace, and the span is marked failed. Sidekiq retries the job later, and ${SCREENS.exceptions} lists the exception.`,
  },

  exampleTrace: {
    caption: "One ReceiptJob run, as its process span shows it",
    spans: [
      {
        name: "ReceiptJob process",
        depth: 0,
        start: 0,
        duration: 100,
        source: "sidekiq",
      },
      {
        name: "receipt.render",
        depth: 1,
        start: 5,
        duration: 9,
        source: "your code",
      },
      { name: "connect", depth: 1, start: 17, duration: 8, source: "net_http" },
      { name: "POST", depth: 1, start: 27, duration: 66, source: "net_http" },
    ],
  },

  prerequisites: [
    RUBY_PREREQUISITE,
    "Sidekiq 7 or later, and the Redis it runs on. In a Rails app, the [Rails](/integrations/opentelemetry/rails) guide's initializer starts the SDK in the worker too: add the Sidekiq and Redis options below to it.",
    SERVER_KEY_PREREQUISITE,
  ],

  install: {
    intro:
      "Add OpenTelemetry's gems beside Sidekiq in your `Gemfile`, at the versions this guide was checked with, then install them:",
    snippets: [gemfile, BUNDLE_INSTALL_SNIPPET],
    notes: [
      "`opentelemetry-instrumentation-all` includes Sidekiq's instrumentation, and Redis', which also traces the `redis-client` Sidekiq talks to Redis with.",
    ],
  },

  configure: {
    intro:
      "Give the worker, and every process that enqueues jobs, the standard OpenTelemetry variables:",
    tabs: otlpEnvironmentTabs({ serviceName: "receipts" }),
    notes: [
      "A web app that enqueues jobs keeps its own service name: its traces and the worker's join up through each job, whatever each service is called.",
    ],
  },

  setup: {
    intro:
      "The same file starts the SDK in the worker and in what enqueues jobs. Sidekiq's instrumentation adds its client and server middleware by itself: jobs need no change.",
    steps: [
      {
        title: "Add a file that starts OpenTelemetry",
        body: "Require Sidekiq before the SDK, and give its instrumentation and Redis' the options a worker wants:",
        snippets: [telemetry],
        notes: [
          "`propagation_style: :child` runs each job in the trace of the code that enqueued it; the default, `:link`, starts a trace per job with a link back. `span_naming: :job_class` names the spans `ReceiptJob publish` and `ReceiptJob process`, not after the queue.",
          "Sidekiq's heartbeat and schedulers send Redis commands every few seconds, each a trace of its own unless `trace_root_spans: false` keeps only those sent inside a span.",
        ],
      },
      {
        title: "Require it from the jobs file",
        body: "The worker loads this file, and so does any code that enqueues: it starts the SDK, sets Sidekiq's log format, adds the duration middleware from the metrics section, and defines the job:",
        snippets: [jobs],
      },
      {
        title: "Start the worker",
        body: "With the variables above exported:",
        snippets: [runWorker],
        notes: [
          "On SIGTERM, Sidekiq finishes the jobs in progress, up to its shutdown timeout, and exits through the `at_exit` hook, which sends what the SDK still holds.",
        ],
      },
      {
        title: "Enqueue jobs",
        body: "This script enqueues two receipts inside a span of its own, one of them bound to fail; in a web app, the request's span plays that part:",
        snippets: [enqueue, runEnqueue],
      },
    ],
  },

  autoInstrumentation: {
    intro:
      "Sidekiq's instrumentation traces both ends of a job: where it is enqueued and where it runs. With the options above, one trace holds:",
    rows: [
      {
        library: "Sidekiq, enqueueing",
        covers:
          "A `ReceiptJob publish` span for each job enqueued, with the job's ID, class and queue; the trace's context travels to the worker inside the job.",
      },
      {
        library: "Sidekiq, running",
        covers:
          "A `ReceiptJob process` span for each run, beneath its `publish` span, with the exception of a job that raised.",
      },
      {
        library: "Redis",
        covers:
          "A span per command sent inside a span, such as the pipelined `SADD` and `LPUSH` that enqueue a job, with keys and values replaced by `?`.",
      },
      {
        library: "`Net::HTTP`",
        covers:
          "A client span per call a job makes, named after its method, with `traceparent` sent along.",
      },
      {
        library: "`Logger`",
        covers:
          "Sidekiq's logger is a Ruby `Logger`, so each line it writes is a record.",
      },
    ],
    snippets: [],
    notes: [
      "The spans carry the job's class, ID and queue, never its arguments.",
    ],
  },

  manualSpans: {
    intro:
      "Inside `perform`, the job's `process` span is current, so a span you open with `in_span` nests beneath it, as `receipt.render` does:",
    snippets: [perform],
    notes: [
      "The `ArgumentError` raised for a missing address leaves `perform`, so it is recorded on the `process` span, which is marked failed; Sidekiq then schedules the retry.",
      "Set attributes on your spans to find jobs by them, such as `@order.id:42` in the **Traces** explorer.",
    ],
  },

  logs: {
    intro:
      "Write through the job's `logger`, Sidekiq's own. Each line written while the job runs carries its trace and span IDs:",
    snippets: [loggerSetup],
    notes: [
      "The default formatter colors each severity with terminal escape codes, which would arrive in every body; `Plain` writes the same line, with the job's ID and class, without them.",
      "Sidekiq's `start`, `done` and `fail` lines are written around the job's span rather than inside it, so they carry no trace ID.",
      "When a job raises, Sidekiq logs `Job raised exception` with the job's payload, its arguments included: that line is sent like any other.",
    ],
  },

  metrics: {
    intro:
      "No Ruby instrumentation sends metrics, so job durations come from a server middleware of your own. It records every job under the name and attributes OpenTelemetry's messaging conventions use:",
    builtIn: [],
    snippets: [jobDuration],
    notes: [
      "`error.type` is set only on the runs that raised: the failure rate of each job class is the share of its durations that carry one.",
      "The view gives the histogram buckets in seconds, which the SDK's defaults, from 0 to 1000, do not suit.",
    ],
  },

  sampling: {
    intro:
      "A job follows the trace that enqueued it, so sampling is decided where that trace starts: in the web request, or in the script. Set the standard variables there:",
    snippets: [sampling],
    notes: [
      "With `parentbased_traceidratio`, a job is kept exactly when the trace that enqueued it is, so a kept trace always holds its jobs.",
      "`messaging.process.duration` and `receipts.sent` still count every job: sampling drops spans only.",
    ],
  },

  deploy: {
    intro:
      "Run the worker as the image's command, with no port to expose, and give the Deployment the key from a Secret:",
    snippets: [
      rubyDockerfileSnippet({
        command: ["bundle", "exec", "sidekiq", "-r", "./jobs.rb"],
      }),
      kubernetesManifestSnippet({
        name: "receipts",
        image: "registry.example.com/receipts:1.3.0",
        extraEnv: [{ name: "REDIS_URL", value: "redis://redis:6379/0" }],
      }),
    ],
    notes: [
      "Sidekiq waits up to 25 seconds for running jobs on SIGTERM, and Kubernetes 30 before it kills the pod: keep `terminationGracePeriodSeconds` above Sidekiq's timeout, so the `at_exit` hook gets to run.",
    ],
  },

  verify: {
    intro: "Check in this order: each step rules out one cause.",
    steps: [
      validateKeyStep("server"),
      {
        title: "Run a job",
        body: `Start the worker and enqueue, then open ${SCREENS.services}: \`receipts\` is listed once the first job has run.`,
      },
      {
        title: "Open the trace that enqueued it",
        body: `In ${SCREENS.traces}, search for \`receipts.enqueue\`: beneath it, each \`ReceiptJob publish\` holds the \`ReceiptJob process\` that ran it, with \`receipt.render\` and the mail service's \`POST\` inside.`,
      },
      {
        title: "Find the failed job",
        body: `${SCREENS.exceptions} lists the \`ArgumentError\` \`order 43 has no email address\`, and its \`process\` span is marked failed.`,
      },
    ],
  },

  troubleshooting: [
    {
      question: "Each job is a trace of its own",
      answer:
        "That is the instrumentation's default, `propagation_style: :link`: each run starts a trace, linked to the one that enqueued it. Set `:child`, as `telemetry.rb` does, to keep both in one trace.",
    },
    {
      question: "Redis spans arrive every few seconds, each a trace of its own",
      answer:
        "Those are Sidekiq's heartbeat and schedulers. Redis' instrumentation traces commands outside any span unless `trace_root_spans: false`, as above, leaves them out.",
    },
    {
      question: "Log bodies start with escape codes before INFO",
      answer:
        "Those are the terminal colors of Sidekiq's default formatter. Set the `Plain` formatter on `Sidekiq.default_configuration.logger`, as `jobs.rb` does, before the worker starts.",
    },
    {
      question: "The last jobs before a deploy never arrive",
      answer:
        "The worker was killed before Sidekiq's shutdown finished, so its `at_exit` hook never ran. Give the pod longer to stop than Sidekiq's shutdown timeout, and stop the worker with SIGTERM.",
    },
    {
      question: "Nothing arrives, and the worker prints “Unable to export”",
      answer:
        "Nothing answered at the endpoint: with `OTEL_EXPORTER_OTLP_ENDPOINT` missing from the worker's environment, the exporters try `localhost:4318`.",
      snippets: [exportFailed],
    },
  ],

  faq: [
    {
      question: "Does it work with Sidekiq inside a Rails app?",
      answer:
        "Yes. The worker boots Rails, so the [Rails](/integrations/opentelemetry/rails) guide's initializer starts the SDK in it: put the Sidekiq and Redis options above into that initializer's `use_all` map, and jobs enqueued in requests run in the requests' traces.",
    },
    {
      question: "Which Sidekiq versions are supported?",
      answer:
        "The instrumentation supports Sidekiq 4.2.10 and later. The middleware and logger settings above use the API of Sidekiq 7 and later; this guide was checked with Sidekiq 8.1 and Ruby 4.0.",
    },
    {
      question: "Are a job's arguments recorded?",
      answer:
        "Not on the spans, which carry the job's class, ID and queue. Sidekiq's own `Job raised exception` line does print a failed job's payload, arguments included, and that line is sent as a log record.",
    },
    {
      question: "Do I need an OpenTelemetry Collector?",
      answer:
        "No: the worker and whatever enqueues send straight to OneUptime. A Collector suits a fleet of workers that should share one exporter, holding the key and batching for all of them: see [OpenTelemetry](/docs/telemetry/open-telemetry).",
    },
  ],

  related: ["rails", "ruby", "celery", "dotnet-worker-service"],
  docs: [DOCS.openTelemetry, DOCS.traces, DOCS.metrics, DOCS.exceptions],

  verification: {
    runtime: "ruby",
    framework: { name: "Sidekiq", package: "sidekiq" },
    ...workerRun(undefined),
    expect: {
      spans: [
        { name: "receipts.enqueue" },
        {
          name: "ReceiptJob publish",
          attributes: { "messaging.sidekiq.job_class": "ReceiptJob" },
          parent: "receipts.enqueue",
        },
        {
          name: "ReceiptJob process",
          hasException: false,
          parent: "ReceiptJob publish",
        },
        {
          name: "receipt.render",
          attributes: { "order.id": "42" },
          parent: "ReceiptJob process",
        },
        {
          name: "POST",
          attributes: { "url.path": "/api/receipts" },
          parent: "ReceiptJob process",
        },
        {
          name: "ReceiptJob process",
          hasException: true,
          exceptionMessage: "order 43 has no email address",
        },
      ],
      metrics: ["messaging.process.duration", "receipts.sent"],
      logs: [
        { body: "sending the receipt for order 42", hasTraceContext: true },
      ],
      resource: { "service.name": "receipts" },
      // Sidekiq's polling, which trace_root_spans: false leaves out.
      absentSpans: ["INFO", "SSCAN"],
      absentLogs: ["\u001b[1;34m"],
    },
    variants: [
      {
        // The worker and the script each send what is left as they end.
        name: "Sent at exit",
        ...workerRun(SENT_AT_EXIT),
        expect: {
          spans: [
            { name: "ReceiptJob process", parent: "ReceiptJob publish" },
            { name: "receipt.render", parent: "ReceiptJob process" },
            { name: "ReceiptJob process", hasException: true },
          ],
          metrics: ["messaging.process.duration", "receipts.sent"],
          logs: [
            {
              body: "sending the receipt for order 42",
              hasTraceContext: true,
            },
          ],
        },
      },
    ],
  },
};
