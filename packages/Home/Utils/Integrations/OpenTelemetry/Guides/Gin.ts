import {
  OpenTelemetryGuide,
  GuideSnippet,
  VerificationService,
} from "../GuideTypes";
import {
  DOCS,
  SCREENS,
  SERVER_KEY_PREREQUISITE,
  kubernetesManifestSnippet,
  otlpEnvironmentTabs,
  validateKeyStep,
} from "../GuideShared";
import {
  GO_PREREQUISITE,
  GO_SDK_MODULES,
  goDeclaration,
  goDockerfileSnippet,
  goGetSnippet,
  goSetupSnippet,
} from "../GoShared";

/*
 * A Gin checkout API on PostgreSQL through GORM, calling a billing API.
 * otelgin traces the router, GORM's own plugin the queries, otelhttp the
 * outgoing calls; two small middlewares send what Gin keeps to itself -
 * the errors handlers add with c.Error, and the panics its recovery
 * catches - to OneUptime's Exceptions.
 */

const install: GuideSnippet = goGetSnippet("install", [
  ...GO_SDK_MODULES,
  "go.opentelemetry.io/contrib/instrumentation/github.com/gin-gonic/gin/otelgin",
  "go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp",
  "gorm.io/plugin/opentelemetry",
]);

const otelSetup: GuideSnippet = goSetupSnippet();

const mainFile: GuideSnippet = {
  id: "main",
  language: "go",
  title: "main.go",
  code: [
    "package main",
    "",
    "import (",
    '\t"context"',
    '\t"errors"',
    '\t"log/slog"',
    '\t"net/http"',
    '\t"os"',
    '\t"os/signal"',
    '\t"syscall"',
    '\t"time"',
    "",
    '\t"github.com/gin-gonic/gin"',
    '\t"go.opentelemetry.io/contrib/bridges/otelslog"',
    '\t"go.opentelemetry.io/contrib/instrumentation/github.com/gin-gonic/gin/otelgin"',
    ")",
    "",
    "func main() {",
    "\tctx, stop := signal.NotifyContext(context.Background(),",
    "\t\tos.Interrupt, syscall.SIGTERM)",
    "\tdefer stop()",
    "",
    "\tshutdown, err := setupOpenTelemetry(ctx)",
    "\tif err != nil {",
    '\t\tslog.Error("could not start OpenTelemetry", "error", err)',
    "\t\tos.Exit(1)",
    "\t}",
    "\t// Deferred first, so it runs last: it sends what is still buffered.",
    "\tdefer shutdown(context.Background())",
    "",
    "\tslog.SetDefault(slog.New(slog.NewMultiHandler(",
    "\t\tslog.NewTextHandler(os.Stdout, nil),",
    '\t\totelslog.NewHandler("checkout"),',
    "\t)))",
    "",
    "\tshop, err := newShop()",
    "\tif err != nil {",
    '\t\tslog.Error("could not open the database", "error", err)',
    "\t\treturn",
    "\t}",
    "",
    "\trouter := gin.New()",
    "\t// A handler can pass c wherever a context goes, the request's span with it.",
    "\trouter.ContextWithFallback = true",
    '\trouter.Use(otelgin.Middleware("checkout-api",',
    "\t\totelgin.WithGinFilter(func(c *gin.Context) bool {",
    '\t\t\treturn c.FullPath() != "/healthz"',
    "\t\t}),",
    "\t))",
    "\trouter.Use(recordErrors, gin.CustomRecovery(recordPanic))",
    "",
    '\trouter.GET("/healthz", func(c *gin.Context) { c.String(http.StatusOK, "ok") })',
    '\trouter.GET("/orders/:id", shop.getOrder)',
    '\trouter.POST("/orders", shop.createOrder)',
    '\trouter.GET("/orders/:id/invoice", shop.invoice)',
    '\trouter.GET("/me/orders", shop.myOrders)',
    "",
    '\tserver := &http.Server{Addr: ":8080", Handler: router}',
    "\tgo func() {",
    "\t\terr := server.ListenAndServe()",
    "\t\tif err != nil && !errors.Is(err, http.ErrServerClosed) {",
    '\t\t\tslog.Error("server stopped", "error", err)',
    "\t\t}",
    "\t}()",
    "",
    "\t<-ctx.Done()",
    "\tstopCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)",
    "\tdefer cancel()",
    "\tserver.Shutdown(stopCtx)",
    "}",
  ].join("\n"),
  check: "run",
};

const errorsFile: GuideSnippet = {
  id: "errors",
  language: "go",
  title: "errors.go",
  code: [
    "package main",
    "",
    "import (",
    '\t"fmt"',
    '\t"log/slog"',
    '\t"net/http"',
    "",
    '\t"github.com/gin-gonic/gin"',
    '\t"go.opentelemetry.io/otel/trace"',
    ")",
    "",
    "// recordErrors records the errors a handler added with c.Error on the",
    "// request's span. otelgin marks the span failed for them but records none,",
    "// so without this they never reach OneUptime's Exceptions.",
    "func recordErrors(c *gin.Context) {",
    "\tc.Next()",
    "\tspan := trace.SpanFromContext(c)",
    "\tfor _, err := range c.Errors {",
    "\t\tspan.RecordError(err.Err)",
    "\t}",
    "}",
    "",
    "// recordPanic is the router's recovery: it records a handler's panic on the",
    "// request's span, with its stack trace, and answers 500.",
    "func recordPanic(c *gin.Context, recovered any) {",
    '\terr := fmt.Errorf("panic: %v", recovered)',
    "\ttrace.SpanFromContext(c).RecordError(err, trace.WithStackTrace(true))",
    '\tslog.ErrorContext(c, "request panicked", "error", err)',
    "\tc.AbortWithStatus(http.StatusInternalServerError)",
    "}",
  ].join("\n"),
  check: "run",
};

// The orders the API serves, kept by GORM in PostgreSQL.
const shopFile: string = [
  "package main",
  "",
  "import (",
  '\t"context"',
  '\t"fmt"',
  '\t"log/slog"',
  '\t"net/http"',
  '\t"os"',
  "",
  '\t"github.com/gin-gonic/gin"',
  '\t"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"',
  '\t"go.opentelemetry.io/otel"',
  '\t"go.opentelemetry.io/otel/attribute"',
  '\t"go.opentelemetry.io/otel/metric"',
  '\t"gorm.io/driver/postgres"',
  '\t"gorm.io/gorm"',
  '\t"gorm.io/plugin/opentelemetry/tracing"',
  ")",
  "",
  'var tracer = otel.Tracer("checkout")',
  "",
  "type Order struct {",
  '\tID            uint   `json:"id"`',
  '\tItems         int    `json:"items"`',
  '\tPaymentMethod string `json:"payment_method"`',
  "}",
  "",
  "type shop struct {",
  "\tdb           *gorm.DB",
  "\tbilling      *http.Client",
  "\tbillingURL   string",
  "\tordersPlaced metric.Int64Counter",
  "}",
  "",
  "func newShop() (*shop, error) {",
  '\tdb, err := gorm.Open(postgres.Open(os.Getenv("DATABASE_URL")))',
  "\tif err != nil {",
  "\t\treturn nil, err",
  "\t}",
  "\tif err := db.AutoMigrate(&Order{}); err != nil {",
  "\t\treturn nil, err",
  "\t}",
  '\tdb.FirstOrCreate(&Order{ID: 42, Items: 2, PaymentMethod: "card"})',
  "\t// A span per query from here on, with $1 where your users' values would be.",
  "\tif err := db.Use(tracing.NewPlugin(tracing.WithoutQueryVariables())); err != nil {",
  "\t\treturn nil, err",
  "\t}",
  "",
  '\tordersPlaced, err := otel.Meter("checkout").Int64Counter("orders.placed",',
  '\t\tmetric.WithDescription("Orders placed, by payment method"))',
  "\tif err != nil {",
  "\t\treturn nil, err",
  "\t}",
  "",
  '\tbillingURL := os.Getenv("BILLING_API_URL")',
  '\tif billingURL == "" {',
  '\t\tbillingURL = "http://localhost:9000"',
  "\t}",
  "",
  "\treturn &shop{",
  "\t\tdb:           db,",
  "\t\tbilling:      &http.Client{Transport: otelhttp.NewTransport(http.DefaultTransport)},",
  "\t\tbillingURL:   billingURL,",
  "\t\tordersPlaced: ordersPlaced,",
  "\t}, nil",
  "}",
  "",
  "func (s *shop) getOrder(c *gin.Context) {",
  '\tslog.InfoContext(c, "loading order", "order.id", c.Param("id"))',
  "",
  "\tvar order Order",
  "\t// WithContext puts the query's span under the request's.",
  '\tif err := s.db.WithContext(c).First(&order, c.Param("id")).Error; err != nil {',
  '\t\tc.JSON(http.StatusNotFound, gin.H{"error": "no such order"})',
  "\t\treturn",
  "\t}",
  "\tc.JSON(http.StatusOK, order)",
  "}",
  "",
  "func (s *shop) createOrder(c *gin.Context) {",
  "\tvar order Order",
  "\tif err := c.ShouldBindJSON(&order); err != nil {",
  '\t\tc.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})',
  "\t\treturn",
  "\t}",
  "",
  "\t// A span of your own: the charge and the INSERT below nest beneath it.",
  '\tctx, span := tracer.Start(c, "checkout.charge")',
  "\tdefer span.End()",
  "\tspan.SetAttributes(",
  '\t\tattribute.Int("order.items", order.Items),',
  '\t\tattribute.String("payment.method", order.PaymentMethod),',
  "\t)",
  "",
  '\tif err := s.call(ctx, http.MethodPost, "/api/charges"); err != nil {',
  "\t\t_ = c.Error(err)",
  '\t\tc.JSON(http.StatusBadGateway, gin.H{"error": "payment failed"})',
  "\t\treturn",
  "\t}",
  "\tif err := s.db.WithContext(ctx).Create(&order).Error; err != nil {",
  "\t\t_ = c.Error(err)",
  '\t\tc.JSON(http.StatusInternalServerError, gin.H{"error": "could not save the order"})',
  "\t\treturn",
  "\t}",
  "",
  "\ts.ordersPlaced.Add(ctx, 1,",
  '\t\tmetric.WithAttributes(attribute.String("payment.method", order.PaymentMethod)))',
  "\tc.JSON(http.StatusCreated, order)",
  "}",
  "",
  "func (s *shop) invoice(c *gin.Context) {",
  "\t// The billing API has no invoice for this order: an error for c.Error.",
  '\tif err := s.call(c, http.MethodGet, "/v2/invoices/"+c.Param("id")); err != nil {',
  '\t\t_ = c.Error(fmt.Errorf("invoice for order %s: %w", c.Param("id"), err))',
  '\t\tc.JSON(http.StatusBadGateway, gin.H{"error": "no invoice"})',
  "\t\treturn",
  "\t}",
  '\tc.JSON(http.StatusOK, gin.H{"order": c.Param("id")})',
  "}",
  "",
  "func (s *shop) myOrders(c *gin.Context) {",
  '\t// No middleware set "user" on this route: MustGet panics, recordPanic records it.',
  '\tuser := c.MustGet("user").(string)',
  '\tc.JSON(http.StatusOK, gin.H{"user": user})',
  "}",
  "",
  "func (s *shop) call(ctx context.Context, method, path string) error {",
  "\treq, err := http.NewRequestWithContext(ctx, method, s.billingURL+path, nil)",
  "\tif err != nil {",
  "\t\treturn err",
  "\t}",
  "\tresp, err := s.billing.Do(req)",
  "\tif err != nil {",
  "\t\treturn err",
  "\t}",
  "\tdefer resp.Body.Close()",
  "\tif resp.StatusCode >= 300 {",
  '\t\treturn fmt.Errorf("billing answered %d", resp.StatusCode)',
  "\t}",
  "\treturn nil",
  "}",
].join("\n");

const newShop: GuideSnippet = {
  id: "new-shop",
  language: "go",
  title: "shop.go",
  code: goDeclaration(shopFile, "func newShop("),
  check: "contained",
};

const getOrder: GuideSnippet = {
  id: "get-order",
  language: "go",
  title: "shop.go",
  code: goDeclaration(shopFile, "func (s *shop) getOrder("),
  check: "contained",
};

const createOrder: GuideSnippet = {
  id: "create-order",
  language: "go",
  title: "shop.go",
  code: goDeclaration(shopFile, "func (s *shop) createOrder("),
  check: "contained",
};

const run: GuideSnippet = {
  id: "run",
  language: "bash",
  code: ["go mod tidy", "GIN_MODE=release go run ."].join("\n"),
  check: "run",
};

const missingSum: GuideSnippet = {
  id: "missing-sum",
  language: "text",
  title: "What go build or go vet prints",
  code: [
    "missing go.sum entry for module providing package gorm.io/driver/clickhouse",
    "  (imported by gorm.io/plugin/opentelemetry/tracing)",
  ].join("\n"),
  check: "illustrative",
};

const sampling: GuideSnippet = {
  id: "sampling",
  language: "bash",
  code: [
    'export OTEL_TRACES_SAMPLER="parentbased_traceidratio"',
    'export OTEL_TRACES_SAMPLER_ARG="0.2"',
  ].join("\n"),
  check: "parse",
};

const postgres: VerificationService = {
  name: "postgres",
  image: "postgres:15",
  containerPort: 5432,
  environment: {
    POSTGRES_USER: "shop",
    POSTGRES_PASSWORD: "shop",
    POSTGRES_DB: "shop",
  },
  appEnvironment: {
    DATABASE_URL: "postgres://shop:shop@127.0.0.1:{port}/shop?sslmode=disable",
  },
  readyLog: {
    text: "database system is ready to accept connections",
    times: 2,
  },
};

export const GinGuide: OpenTelemetryGuide = {
  slug: "gin",
  seo: {
    title: "Gin OpenTelemetry: Tracing, Metrics & Logs | OneUptime",
    description:
      "Instrument a Gin API with OpenTelemetry: otelgin routes, GORM queries, outgoing calls, c.Error and panics as exceptions, and slog logs, sent to OneUptime.",
  },
  h1: "OpenTelemetry for Gin",
  lead: "Trace every route of your Gin API with the GORM queries and HTTP calls it makes, and send traces, metrics and logs to OneUptime. Add `otelgin` to the router and GORM's plugin to the database, and record what Gin keeps to itself: the errors your handlers add with `c.Error`, and the panics its recovery catches.",
  cardDescription:
    "Gin routes with otelgin, GORM queries, outgoing calls, and the errors and panics Gin catches recorded as exceptions.",
  searchTerms: ["gin-gonic", "otelgin", "gorm", "postgres", "middleware"],
  highlights: ["otelgin middleware", "GORM plugin", "c.Error as exceptions"],

  whatYouGet: {
    intro: `Each request Gin routes becomes a trace under the service named by \`OTEL_SERVICE_NAME\`, and ${SCREENS.services} lists it from its first request. The example is a checkout API that keeps its orders in PostgreSQL through GORM and calls a billing API.`,
    traces:
      "A server span per request named after the route that matched, such as `GET /orders/:id`, with a span for each GORM query (`select orders`, `insert orders`) and each call to the billing API beneath it.",
    metrics:
      "Request duration by `http.route`, method and status, from `otelgin`, outgoing call duration, the connection pool GORM holds, and the Go runtime's memory and goroutines.",
    logs: "Each `slog` record written in a handler, with the request's trace and span IDs: with `ContextWithFallback` on, the `*gin.Context` itself carries them.",
    exceptions: `An error a handler adds with \`c.Error\`, and a panic Gin's recovery catches, are recorded on the request's span by the two middlewares below, and reach ${SCREENS.exceptions} with their messages.`,
  },

  exampleTrace: {
    caption: "A POST /orders request, as its trace shows it",
    spans: [
      {
        name: "POST /orders",
        depth: 0,
        start: 0,
        duration: 100,
        source: "otelgin",
      },
      {
        name: "checkout.charge",
        depth: 1,
        start: 5,
        duration: 90,
        source: "your code",
      },
      {
        name: "HTTP POST",
        depth: 2,
        start: 8,
        duration: 52,
        source: "otelhttp",
      },
      {
        name: "insert orders",
        depth: 2,
        start: 64,
        duration: 28,
        source: "gorm",
      },
    ],
  },

  prerequisites: [
    GO_PREREQUISITE,
    "A Gin app, Gin 1.10 or later. These steps were checked with Gin 1.12, GORM 1.31 and PostgreSQL 15.",
    SERVER_KEY_PREREQUISITE,
  ],

  install: {
    intro:
      "Add the SDK and its OTLP exporters, `otelgin` for the router, `otelhttp` for outgoing calls and GORM's OpenTelemetry plugin, at the versions this guide was checked with:",
    snippets: [install],
    notes: [
      "`otelgin` is part of OpenTelemetry's own contrib modules, released with the SDK; the GORM plugin, `gorm.io/plugin/opentelemetry`, is GORM's.",
    ],
  },

  configure: {
    intro:
      "The exporters read the standard variables, so the key and the endpoint never reach your code or your config files:",
    tabs: otlpEnvironmentTabs({ serviceName: "checkout-api" }),
    notes: [
      "Name the service once, here. The name `otelgin.Middleware` takes is the server's name on its spans and metrics (`server.address`), not the service's.",
    ],
  },

  setup: {
    intro:
      "Start the SDK before the router, add `otelgin` as the router's first middleware, then catch what Gin handles on its own.",
    steps: [
      {
        title: "Add a file that starts OpenTelemetry",
        body: "It creates a provider and an OTLP exporter for each signal and sets them as the globals `otelgin`, `otelhttp` and GORM's plugin use. Keep the function it returns, to flush on the way out:",
        snippets: [otelSetup],
      },
      {
        title: "Add otelgin to the router in main",
        body: "Start OpenTelemetry first, defer its shutdown, then add `otelgin.Middleware` before anything else on the router, with a filter that leaves health checks out:",
        snippets: [mainFile],
        notes: [
          "`router.ContextWithFallback = true` lets a handler pass `c` itself to `tracer.Start`, `slog.InfoContext` and GORM's `WithContext`. Without it, a `*gin.Context` carries no span, and each call starts a trace of its own.",
        ],
      },
      {
        title: "Record c.Error and panics on the request's span",
        body: "`otelgin` marks a request failed when a handler adds an error with `c.Error`, or when it answers 5xx, but records no exception. These two send the error itself:",
        snippets: [errorsFile],
      },
      {
        title: "Run it",
        body: "With the variables above and `DATABASE_URL` exported, record every module the code imports with `go mod tidy`, then start the API; `GIN_MODE=release` drops the route table and the debug warnings Gin prints at start:",
        snippets: [run],
      },
    ],
  },

  autoInstrumentation: {
    intro:
      "Each layer of the request is traced by its own instrumentation, set up once:",
    rows: [
      {
        library: "`otelgin`",
        covers:
          "A server span per request named after the route (`GET /orders/:id`), with `http.route` and the status code, the error type for `c.Error`, and `http.server.request.duration`.",
      },
      {
        library: "GORM's plugin",
        covers:
          "A span per query named after its operation and table (`select orders`), with the SQL in `db.query.text`, and the pool's metrics as `go.sql.connections_*`.",
      },
      {
        library: "`otelhttp.NewTransport`",
        covers:
          "A client span per call to the billing API (`HTTP POST`), failed for a status of 400 or more, with `traceparent` sent along.",
      },
      {
        library: "`otelslog` and `runtime`",
        covers:
          "Each `slog` record as a log with its trace and span IDs, and the runtime's memory, goroutines and garbage collector as `go.*` metrics.",
      },
    ],
    snippets: [newShop],
    notes: [
      "Add GORM's plugin with `db.Use`, after `AutoMigrate`: installed before it, every start sends each schema check as a trace of its own. `WithoutQueryVariables` keeps the values out of `db.query.text`, which otherwise holds them as sent, `'card'` and all:",
    ],
  },

  manualSpans: {
    intro:
      "Wrap work of your own, such as charging a card, in a span; the billing call and the `INSERT` take its `ctx` and nest beneath it:",
    snippets: [createOrder],
    notes: [
      "With `ContextWithFallback` on, `tracer.Start(c, ...)` finds the request's span through `c`. The `ctx` it returns is what the calls inside need: pass it, not `c`, so they nest under `checkout.charge`.",
      "An error added with `c.Error` is recorded on the request's span by `recordErrors`, wherever the handler adds it.",
      "`payment.method` and `order.items` are searchable in the **Traces** explorer, as `@payment.method:card`.",
    ],
  },

  logs: {
    intro:
      "Write with `slog` in the handlers. With `ContextWithFallback` on, `c` is a context that holds the request's span, so a record written with it carries the trace and span IDs:",
    snippets: [getOrder],
    notes: [
      "`slog.Info`, with no context, sends a record with no trace ID: use the `...Context` functions in handlers.",
      "Gin's own request log, `gin.Logger()`, writes to the console only. Leave it out in production: `otelgin`'s spans and metrics already hold each request's route, status and duration.",
      "`recordPanic` logs the panic with `slog.ErrorContext` and the error as an attribute, which arrives as `exception.message` and `exception.type`.",
    ],
  },

  metrics: {
    intro:
      "Exported every 60 seconds, without a line of code beyond the setup:",
    builtIn: [
      {
        name: "http.server.request.duration",
        description:
          "Each request's duration by `http.route`, method, status and `error.type`, from `otelgin`.",
      },
      {
        name: "http.client.request.duration",
        description:
          "The calls the API makes to the billing API, by server, method and status.",
      },
      {
        name: "go.sql.connections_in_use",
        description:
          "Connections GORM's pool has in use, beside `go.sql.connections_idle` and `go.sql.connections_wait_count`: waits that climb mean the pool is too small.",
      },
      {
        name: "go.goroutine.count",
        description:
          "Goroutines running, beside `go.memory.used`: a count that climbs with traffic and never comes back down is a leak.",
      },
    ],
    snippets: [],
    notes: [
      "`orders.placed` counts orders by payment method: a counter created once with `otel.Meter`, added to in `createOrder`.",
      "Every replica sends its own series; OneUptime adds them up in charts.",
    ],
  },

  sampling: {
    intro:
      "Health checks never reach `otelgin`'s tracer, thanks to `WithGinFilter`. For the rest, keep a share of new traces once traffic grows:",
    snippets: [sampling],
    notes: [
      "`parentbased_traceidratio` keeps one new trace in five, and follows the caller's decision when a request arrives with a `traceparent` header.",
      "Only traces are sampled: `otelgin`'s request metrics are recorded for every request, the sampled ones and the rest.",
    ],
  },

  deploy: {
    intro:
      "Build the API in the Go image and run it in a distroless one, with `GIN_MODE` and the database in the Deployment and the key in a Secret:",
    snippets: [
      goDockerfileSnippet({ build: ".", binary: "checkout-api", port: 8080 }),
      kubernetesManifestSnippet({
        name: "checkout-api",
        image: "registry.example.com/checkout-api:2.3.0",
        containerPort: 8080,
        extraEnv: [{ name: "GIN_MODE", value: "release" }],
      }),
    ],
    notes: [
      "Put `DATABASE_URL` in a Secret of its own beside `oneuptime-otlp`, the way the ingestion key is kept out of the image.",
      "The server's `Shutdown` lets Gin finish its requests in flight before the deferred OpenTelemetry shutdown sends the last batches.",
    ],
  },

  verify: {
    intro: "Check in this order: each step rules out one cause.",
    steps: [
      validateKeyStep("server"),
      {
        title: "Find the service",
        body: `Send the API a request, then look in ${SCREENS.services}: \`checkout-api\` appears there within a minute.`,
      },
      {
        title: "Open a request's trace",
        body: `In ${SCREENS.traces}, search \`@http.route:/orders/:id\`: each request holds its \`select orders\` query, its \`$1\` in place of the order's id.`,
      },
      {
        title: "Find an error and a panic",
        body: `${SCREENS.exceptions} lists the \`billing answered 404\` that \`/orders/42/invoice\` added with \`c.Error\`, and the \`key user does not exist\` panic of \`/me/orders\`.`,
      },
    ],
  },

  troubleshooting: [
    {
      question: "Spans from my handlers start traces of their own",
      answer:
        "`c` was passed as the context with `ContextWithFallback` off: a `*gin.Context` then knows nothing of the request's span, and `tracer.Start(c, ...)` starts a new trace. Turn it on, as `main.go` does, or pass `c.Request.Context()`, which holds the span whatever the setting.",
    },
    {
      question: "Failed requests have no exception in OneUptime",
      answer:
        "`otelgin` records the failure, not the error: add `recordErrors` after it, and recover with `gin.CustomRecovery(recordPanic)` instead of `gin.Recovery()`.",
    },
    {
      question: "Queries arrive as traces of their own, or not at all",
      answer:
        "Pass the request's context to GORM with `db.WithContext(c)` (or `ctx` inside your own span): a query without one has no parent. No query spans at all means the plugin was never installed with `db.Use`.",
    },
    {
      question: "The build fails with “missing go.sum entry”",
      answer:
        "GORM's plugin imports the MySQL and ClickHouse drivers too, which `go get` does not record for you. Run `go mod tidy` once the code is in place, as above:",
      snippets: [missingSum],
    },
    {
      question: "Every request's span is named GET or POST",
      answer:
        "No route matched, as for a 404: `otelgin` names a span after `c.FullPath()`, which is empty until a route matches. Requests that reach a handler carry its route.",
    },
    {
      question: "Nothing arrives, and the console shows export errors",
      answer:
        "Read the error: `connection refused` to `localhost:4318` means `OTEL_EXPORTER_OTLP_ENDPOINT` never reached the process, and `401 Unauthorized` that the key in `OTEL_EXPORTER_OTLP_HEADERS` is not a **Server** key of this project.",
    },
  ],

  faq: [
    {
      question: "Does otelgin record request metrics too?",
      answer:
        "Yes: `http.server.request.duration` and the request and response body sizes, by route, method and status, with no option to set.",
    },
    {
      question: "Can I use database/sql instead of GORM?",
      answer:
        "Yes: open the database with `otelsql`, as the [Go](/integrations/opentelemetry/go) guide shows. GORM can also run on such a connection, with `postgres.New(postgres.Config{Conn: db})`.",
    },
    {
      question: "Which Gin versions are supported?",
      answer:
        "`otelgin` v0.72 is built against Gin 1.12 and needs Go 1.26 or later; this guide was checked with Gin 1.12.0.",
    },
    {
      question: "Do I need an OpenTelemetry Collector?",
      answer:
        "No: the API exports straight to OneUptime. A Collector is worth running when many services should send through one place: see [OpenTelemetry](/docs/telemetry/open-telemetry).",
    },
  ],

  related: ["go", "echo", "fiber", "grpc"],
  docs: [DOCS.openTelemetry, DOCS.traces, DOCS.exceptions, DOCS.logs],

  verification: {
    runtime: "go",
    framework: { name: "Gin", package: "github.com/gin-gonic/gin" },
    services: [postgres],
    files: [
      { path: "otel.go", snippet: "otel-setup" },
      { path: "main.go", snippet: "main" },
      { path: "errors.go", snippet: "errors" },
      { path: "shop.go", content: shopFile },
    ],
    stubApiPort: 9000,
    commands: [
      { command: "go mod init example.com/checkout" },
      { snippet: "install" },
      {
        command:
          "go get github.com/gin-gonic/gin@v1.12.0 gorm.io/gorm@v1.31.2 gorm.io/driver/postgres@v1.6.3",
      },
      { command: 'go mod tidy && test -z "$(gofmt -l .)" && go vet ./...' },
      { snippet: "run", isServer: true },
    ],
    port: 8080,
    requests: [
      { method: "GET", path: "/healthz" },
      { method: "GET", path: "/orders/42" },
      { method: "GET", path: "/orders/7" },
      {
        method: "POST",
        path: "/orders",
        body: { items: 2, payment_method: "card" },
      },
      { method: "GET", path: "/orders/42/invoice" },
      { method: "GET", path: "/me/orders" },
    ],
    expect: {
      spans: [
        {
          name: "GET /orders/:id",
          attributes: { "http.route": "/orders/:id" },
        },
        { name: "select orders", parent: "GET /orders/:id" },
        {
          name: "checkout.charge",
          attributes: { "payment.method": "card", "order.items": "2" },
          parent: "POST /orders",
        },
        { name: "HTTP POST", parent: "checkout.charge" },
        { name: "insert orders", parent: "checkout.charge" },
        {
          name: "GET /orders/:id/invoice",
          hasException: true,
          exceptionMessage: "billing answered 404",
        },
        {
          name: "GET /me/orders",
          hasException: true,
          exceptionMessage: "key user does not exist",
        },
      ],
      metrics: [
        "http.server.request.duration",
        "http.client.request.duration",
        "go.sql.connections_in_use",
        "go.goroutine.count",
        "orders.placed",
      ],
      logs: [
        {
          body: "loading order",
          hasTraceContext: true,
          attributes: { "order.id": "42" },
        },
        { body: "request panicked", hasTraceContext: true, hasException: true },
      ],
      resource: { "service.name": "checkout-api" },
      untracedPaths: ["/healthz"],
      absentSpans: ["gorm.Row"],
    },
  },
};
