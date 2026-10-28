import { OpenTelemetryGuide, GuideSnippet } from "../GuideTypes";
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
 * Any Go service on the standard library: an orders API on net/http's
 * ServeMux, with SQLite through database/sql and a payments API it calls.
 * The SDK starts in otel.go, otelhttp wraps the mux and the HTTP client,
 * otelsql wraps the database, slog writes logs with trace IDs, and a small
 * middleware turns a handler's panic into a recorded 500.
 */

const install: GuideSnippet = goGetSnippet("install", [
  ...GO_SDK_MODULES,
  "go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp",
  "github.com/XSAM/otelsql",
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
    '\t"go.opentelemetry.io/contrib/bridges/otelslog"',
    '\t"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"',
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
    "\t// Each record goes to the console and, with its trace and span, to OneUptime.",
    "\tslog.SetDefault(slog.New(slog.NewMultiHandler(",
    "\t\tslog.NewTextHandler(os.Stdout, nil),",
    '\t\totelslog.NewHandler("orders"),',
    "\t)))",
    "",
    "\torders, err := newOrderService()",
    "\tif err != nil {",
    '\t\tslog.Error("could not open the database", "error", err)',
    "\t\treturn",
    "\t}",
    "",
    "\tmux := http.NewServeMux()",
    '\tmux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {',
    '\t\tw.Write([]byte("ok"))',
    "\t})",
    '\tmux.HandleFunc("GET /orders/{id}", orders.get)',
    '\tmux.HandleFunc("POST /orders", orders.create)',
    '\tmux.HandleFunc("GET /orders/{id}/receipt", orders.receipt)',
    "",
    "\t// A server span per request, named after the pattern that matched it.",
    '\thandler := otelhttp.NewHandler(recoverPanics(mux), "orders-api",',
    "\t\totelhttp.WithFilter(func(r *http.Request) bool {",
    '\t\t\treturn r.URL.Path != "/healthz"',
    "\t\t}),",
    "\t)",
    '\tserver := &http.Server{Addr: ":8080", Handler: handler}',
    "\tgo func() {",
    "\t\terr := server.ListenAndServe()",
    "\t\tif err != nil && !errors.Is(err, http.ErrServerClosed) {",
    '\t\t\tslog.Error("server stopped", "error", err)',
    "\t\t}",
    "\t}()",
    '\tslog.Info("listening on :8080")',
    "",
    "\t// On SIGTERM, finish the requests in flight; the deferred shutdown then flushes.",
    "\t<-ctx.Done()",
    "\tstopCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)",
    "\tdefer cancel()",
    "\tserver.Shutdown(stopCtx)",
    "}",
  ].join("\n"),
  check: "run",
};

const recoverFile: GuideSnippet = {
  id: "recover",
  language: "go",
  title: "recover.go",
  code: [
    "package main",
    "",
    "import (",
    '\t"fmt"',
    '\t"log/slog"',
    '\t"net/http"',
    "",
    '\t"go.opentelemetry.io/otel/trace"',
    ")",
    "",
    "// recoverPanics answers a handler's panic with a 500 and records it on the",
    "// request's span, which otelhttp then marks failed. Without it, net/http",
    "// recovers the panic itself: the client's connection closes with no answer,",
    "// and the span is left named GET, with no status at all.",
    "func recoverPanics(next http.Handler) http.Handler {",
    "\treturn http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {",
    "\t\tdefer func() {",
    "\t\t\trecovered := recover()",
    "\t\t\tif recovered == nil || recovered == http.ErrAbortHandler {",
    "\t\t\t\treturn",
    "\t\t\t}",
    '\t\t\terr := fmt.Errorf("panic: %v", recovered)',
    "\t\t\ttrace.SpanFromContext(r.Context()).RecordError(err, trace.WithStackTrace(true))",
    '\t\t\tslog.ErrorContext(r.Context(), "request panicked", "error", err)',
    '\t\t\thttp.Error(w, "Something went wrong", http.StatusInternalServerError)',
    "\t\t}()",
    "\t\tnext.ServeHTTP(w, r)",
    "\t})",
    "}",
  ].join("\n"),
  check: "run",
};

/*
 * The orders the API serves: its handlers, the database it opens through
 * otelsql, and the payments API its HTTP client calls. The page shows its
 * declarations one at a time, in the sections they belong to.
 */
const ordersFile: string = [
  "package main",
  "",
  "import (",
  '\t"context"',
  '\t"database/sql"',
  '\t"encoding/json"',
  '\t"fmt"',
  '\t"log/slog"',
  '\t"net/http"',
  '\t"os"',
  '\t"strings"',
  "",
  '\t"github.com/XSAM/otelsql"',
  '\t"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"',
  '\t"go.opentelemetry.io/otel"',
  '\t"go.opentelemetry.io/otel/attribute"',
  '\t"go.opentelemetry.io/otel/codes"',
  '\t"go.opentelemetry.io/otel/metric"',
  '\t_ "modernc.org/sqlite"',
  ")",
  "",
  'var tracer = otel.Tracer("orders")',
  "",
  "type orderService struct {",
  "\tdb           *sql.DB",
  "\tpayments     *http.Client",
  "\tpaymentsURL  string",
  "\tordersPlaced metric.Int64Counter",
  "}",
  "",
  "func newOrderService() (*orderService, error) {",
  "\t// A span for each statement, without the connection resets and row reads.",
  '\tdb, err := otelsql.Open("sqlite", "file:shop.db", otelsql.WithSpanOptions(',
  "\t\totelsql.SpanOptions{OmitConnResetSession: true, OmitRows: true},",
  "\t))",
  "\tif err != nil {",
  "\t\treturn nil, err",
  "\t}",
  "\t// The connection pool's metrics: open, idle and waiting connections.",
  "\tif _, err := otelsql.RegisterDBStatsMetrics(db); err != nil {",
  "\t\treturn nil, err",
  "\t}",
  "\tif err := createTables(db); err != nil {",
  "\t\treturn nil, err",
  "\t}",
  "",
  '\tordersPlaced, err := otel.Meter("orders").Int64Counter("orders.placed",',
  '\t\tmetric.WithDescription("Orders placed, by payment method"))',
  "\tif err != nil {",
  "\t\treturn nil, err",
  "\t}",
  "",
  "\treturn &orderService{",
  "\t\tdb: db,",
  "\t\t// A client span for each call, with traceparent sent along.",
  "\t\tpayments:     &http.Client{Transport: otelhttp.NewTransport(http.DefaultTransport)},",
  '\t\tpaymentsURL:  envOr("PAYMENTS_API_URL", "http://localhost:9000"),',
  "\t\tordersPlaced: ordersPlaced,",
  "\t}, nil",
  "}",
  "",
  "func (s *orderService) get(w http.ResponseWriter, r *http.Request) {",
  "\tctx := r.Context()",
  '\tid := r.PathValue("id")',
  '\tslog.InfoContext(ctx, "loading order", "order.id", id)',
  "",
  "\tvar items int",
  "\tvar method string",
  "\terr := s.db.QueryRowContext(ctx,",
  '\t\t"SELECT items, payment_method FROM orders WHERE id = ?", id,',
  "\t).Scan(&items, &method)",
  "\tif err != nil {",
  '\t\thttp.Error(w, "No such order", http.StatusNotFound)',
  "\t\treturn",
  "\t}",
  "\tjson.NewEncoder(w).Encode(map[string]any{",
  '\t\t"id": id, "items": items, "payment_method": method,',
  "\t})",
  "}",
  "",
  "func (s *orderService) create(w http.ResponseWriter, r *http.Request) {",
  "\tvar order struct {",
  '\t\tItems         []string `json:"items"`',
  '\t\tPaymentMethod string   `json:"payment_method"`',
  "\t}",
  "\tif err := json.NewDecoder(r.Body).Decode(&order); err != nil {",
  '\t\thttp.Error(w, "Not an order", http.StatusBadRequest)',
  "\t\treturn",
  "\t}",
  "",
  "\t// A span of your own, under the request's. Everything inside takes its ctx.",
  '\tctx, span := tracer.Start(r.Context(), "checkout.charge")',
  "\tdefer span.End()",
  "\tspan.SetAttributes(",
  '\t\tattribute.Int("order.item_count", len(order.Items)),',
  '\t\tattribute.String("payment.method", order.PaymentMethod),',
  "\t)",
  "",
  "\tif err := s.charge(ctx, order.PaymentMethod); err != nil {",
  "\t\tspan.RecordError(err)",
  '\t\tspan.SetStatus(codes.Error, "charge failed")',
  '\t\thttp.Error(w, "Payment failed", http.StatusBadGateway)',
  "\t\treturn",
  "\t}",
  "\t_, err := s.db.ExecContext(ctx,",
  '\t\t"INSERT INTO orders (items, payment_method) VALUES (?, ?)",',
  "\t\tlen(order.Items), order.PaymentMethod,",
  "\t)",
  "\tif err != nil {",
  "\t\tspan.RecordError(err)",
  '\t\thttp.Error(w, "Could not save the order", http.StatusInternalServerError)',
  "\t\treturn",
  "\t}",
  "",
  "\ts.ordersPlaced.Add(ctx, 1,",
  '\t\tmetric.WithAttributes(attribute.String("payment.method", order.PaymentMethod)))',
  "\tw.WriteHeader(http.StatusCreated)",
  '\tfmt.Fprint(w, `{"status":"placed"}`)',
  "}",
  "",
  "func (s *orderService) charge(ctx context.Context, method string) error {",
  '\tbody := strings.NewReader(fmt.Sprintf(`{"payment_method":%q}`, method))',
  "\treq, err := http.NewRequestWithContext(ctx, http.MethodPost,",
  '\t\ts.paymentsURL+"/api/charges", body)',
  "\tif err != nil {",
  "\t\treturn err",
  "\t}",
  "\tresp, err := s.payments.Do(req)",
  "\tif err != nil {",
  "\t\treturn err",
  "\t}",
  "\tdefer resp.Body.Close()",
  "\tif resp.StatusCode >= 300 {",
  '\t\treturn fmt.Errorf("payments answered %d", resp.StatusCode)',
  "\t}",
  "\treturn nil",
  "}",
  "",
  "type receipt struct{ Total int }",
  "",
  "func (s *orderService) receipt(w http.ResponseWriter, r *http.Request) {",
  '\treceipts := map[string]*receipt{"42": {Total: 120}}',
  "\t// An order with no receipt reads a nil pointer: a panic recoverPanics records.",
  '\tfmt.Fprintf(w, `{"total":%d}`, receipts[r.PathValue("id")].Total)',
  "}",
  "",
  "func createTables(db *sql.DB) error {",
  "\t_, err := db.Exec(`CREATE TABLE IF NOT EXISTS orders (",
  "        id INTEGER PRIMARY KEY, items INTEGER, payment_method TEXT);",
  "        INSERT OR IGNORE INTO orders VALUES (42, 2, 'card');`)",
  "\treturn err",
  "}",
  "",
  "func envOr(name, fallback string) string {",
  '\tif value := os.Getenv(name); value != "" {',
  "\t\treturn value",
  "\t}",
  "\treturn fallback",
  "}",
].join("\n");

const orderService: GuideSnippet = {
  id: "order-service",
  language: "go",
  title: "orders.go",
  code: goDeclaration(ordersFile, "func newOrderService("),
  check: "contained",
};

const getOrder: GuideSnippet = {
  id: "get-order",
  language: "go",
  title: "orders.go",
  code: goDeclaration(ordersFile, "func (s *orderService) get("),
  check: "contained",
};

const createOrder: GuideSnippet = {
  id: "create-order",
  language: "go",
  title: "orders.go",
  code: goDeclaration(ordersFile, "func (s *orderService) create("),
  check: "contained",
};

const run: GuideSnippet = {
  id: "run",
  language: "bash",
  code: "go run .",
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

const exportErrors: GuideSnippet = {
  id: "export-errors",
  language: "text",
  title: "What the program logs",
  code: [
    'traces export: Post "https://localhost:4318/v1/traces": dial tcp [::1]:4318:',
    "  connect: connection refused",
  ].join("\n"),
  check: "illustrative",
};

export const GoGuide: OpenTelemetryGuide = {
  slug: "go",
  seo: {
    title: "Go (Golang) OpenTelemetry: Traces, Metrics, Logs | OneUptime",
    description:
      "Instrument a Go service with OpenTelemetry: net/http and outgoing calls with otelhttp, database/sql, slog logs with trace IDs and runtime metrics, in OneUptime.",
  },
  h1: "OpenTelemetry for Go",
  lead: "Trace every request your Go service serves with `net/http`, with the SQL it runs and the HTTP calls it makes, and send traces, metrics and `slog` logs to OneUptime. One file starts the SDK, `otelhttp` wraps your mux and your HTTP client, and a deferred call flushes it all on SIGTERM.",
  cardDescription:
    "Any Go service on net/http: the SDK in one file, otelhttp for requests and calls, database/sql, slog and runtime metrics.",
  searchTerms: ["net/http", "servemux", "otelhttp", "slog", "otelsql", "sql"],
  highlights: [
    "net/http and ServeMux",
    "slog with trace IDs",
    "Go 1.26 and later",
  ],

  whatYouGet: {
    intro: `Each request your service serves becomes a trace under the service named by \`OTEL_SERVICE_NAME\`, which ${SCREENS.services} lists from its first request. The example is an orders API on Go's own \`net/http\`, keeping its orders in SQLite through \`database/sql\`.`,
    traces:
      "A server span per request, named after the ServeMux pattern that matched it, such as `GET /orders/{id}`, with a span for each SQL statement and each call your `http.Client` makes beneath it.",
    metrics:
      "Request duration by `http.route`, method and status, the duration of the calls you make and the queries you run, the connection pool, and the Go runtime: memory, goroutines and the garbage collector.",
    logs: "Each `slog` record written with a request's context, carrying that request's trace and span IDs and the record's attributes.",
    exceptions: `Go returns errors rather than throwing them: one you record with \`span.RecordError\` marks the span failed and reaches ${SCREENS.exceptions} with its message and type, and a panic is recorded the same way by the middleware below.`,
  },

  exampleTrace: {
    caption: "A POST /orders request, as its trace shows it",
    spans: [
      {
        name: "POST /orders",
        depth: 0,
        start: 0,
        duration: 100,
        source: "otelhttp",
      },
      {
        name: "checkout.charge",
        depth: 1,
        start: 4,
        duration: 92,
        source: "your code",
      },
      {
        name: "HTTP POST",
        depth: 2,
        start: 7,
        duration: 58,
        source: "otelhttp",
      },
      {
        name: "sql.conn.exec",
        depth: 2,
        start: 70,
        duration: 22,
        source: "otelsql",
      },
    ],
  },

  prerequisites: [
    GO_PREREQUISITE,
    "A service that serves HTTP with `net/http`, as Go's own ServeMux and most routers do. Building with Gin, Echo, Fiber or gRPC? Their guides cover what is particular to them.",
    SERVER_KEY_PREREQUISITE,
  ],

  install: {
    intro:
      "Add the API and SDK, an OTLP exporter for each signal, `slog`'s bridge, the runtime's metrics, and the instrumentations for `net/http` and `database/sql`, at the versions this guide was checked with:",
    snippets: [install],
    notes: [
      "The logs API and SDK are stable from v1.47.0, while the OTLP log exporter is still released as v0.x: pin it as above, beside the SDK it was released with.",
      "`github.com/XSAM/otelsql` instruments `database/sql`, whatever its driver. With `pgx` used directly, add `github.com/exaring/otelpgx` instead.",
    ],
  },

  configure: {
    intro:
      "The exporters and the resource read the standard OpenTelemetry variables, so the endpoint, the key and the service's name stay out of your code:",
    tabs: otlpEnvironmentTabs({ serviceName: "orders-api" }),
    notes: [
      "Go's OTLP exporters send protobuf over HTTP by default, which is what the `/otlp` endpoint takes, and add `/v1/traces`, `/v1/metrics` and `/v1/logs` to the endpoint themselves.",
    ],
  },

  setup: {
    intro:
      "Go has no agent to load at start: the program starts the SDK itself, wraps its handler and its HTTP client, and shuts the SDK down as it exits.",
    steps: [
      {
        title: "Add a file that starts OpenTelemetry",
        body: "One provider per signal, each with its OTLP exporter, set as the global ones that `otelhttp`, `otelsql` and `slog`'s bridge find by themselves. The function it returns flushes and stops them:",
        snippets: [otelSetup],
      },
      {
        title: "Start it in main, and flush it on SIGTERM",
        body: "Start OpenTelemetry before anything else, defer its shutdown, wrap the mux with `otelhttp.NewHandler`, and send `slog` through OpenTelemetry's handler as well as the console's:",
        snippets: [mainFile],
        notes: [
          "`os.Exit` and `log.Fatal` skip deferred calls: a program that leaves through them loses what it still holds. Return from `main` instead, as the database's error does here.",
          "`slog.NewMultiHandler` is in Go 1.26 and later; each record goes to every handler it holds.",
        ],
      },
      {
        title: "Record a handler's panic on its span",
        body: "Wrap the mux in a middleware that recovers a panic, records it on the request's span with its stack trace, and answers 500:",
        snippets: [recoverFile],
      },
      {
        title: "Run it",
        body: "With the variables above exported, start the service as usual:",
        snippets: [run],
      },
    ],
  },

  autoInstrumentation: {
    intro:
      "Each library is traced by its own wrapper, set up once where you create it. With the ones above, a request's trace holds:",
    rows: [
      {
        library: "`otelhttp.NewHandler`",
        covers:
          "A server span per request, named after the ServeMux pattern that matched (`GET /orders/{id}`), with the status code, and `http.server.request.duration` by `http.route`.",
      },
      {
        library: "`otelhttp.NewTransport`",
        covers:
          "A client span per call made through the `http.Client` (`HTTP POST`), with `traceparent` sent along so the service you call joins the trace, and `http.client.request.duration`.",
      },
      {
        library: "`otelsql` (`database/sql`)",
        covers:
          "A span per statement, `sql.conn.query` or `sql.conn.exec`, with the SQL in `db.query.text`, `db.client.operation.duration`, and the pool's metrics.",
      },
      {
        library: "`otelslog`",
        covers:
          "Each `slog` record as a log, with the trace and span IDs of the context it was written with.",
      },
      {
        library: "`runtime`",
        covers:
          "The runtime's memory, goroutines, garbage collector's goal and `GOMAXPROCS`, as `go.*` metrics.",
      },
    ],
    snippets: [orderService],
    notes: [
      "Wrap the database and the client where you create them, as `newOrderService` does: `otelsql.Open` in place of `sql.Open`, and `otelhttp.NewTransport` as the client's transport. `OmitConnResetSession` and `OmitRows` leave out two spans per query that say little:",
    ],
  },

  manualSpans: {
    intro:
      "Start a span of your own around work no library knows about, such as charging a card. Pass the context it returns to every call inside, and they nest beneath it:",
    snippets: [createOrder],
    notes: [
      "`span.RecordError` adds an `exception` event with the error's message and type; `span.SetStatus(codes.Error, ...)` marks the span failed. Go does neither for you: an error you return and never record leaves the span looking healthy.",
      "Set attributes your team searches by, then find them in the **Traces** explorer, such as `@payment.method:card`.",
      '`otel.Tracer("orders")` names the code that made the span, shown as its scope; create it once, at package level, as `tracer` is here.',
    ],
  },

  logs: {
    intro:
      "Log with `slog` as you already do. A record written with a request's context, through the `...Context` functions, carries that request's trace and span IDs:",
    snippets: [getOrder],
    notes: [
      "`slog.Info` without a context writes a record with no trace ID: use `slog.InfoContext(ctx, ...)` inside requests.",
      'An `error` value logged as an attribute, as `slog.ErrorContext(ctx, "request panicked", "error", err)` does, is sent as `exception.message` and `exception.type`: OneUptime files the record under **Exceptions**.',
      "Once `slog.SetDefault` has run, the standard `log` package writes through it too: `net/http`'s own messages and the SDK's export errors arrive as logs, at **INFO** and without a trace ID.",
    ],
  },

  metrics: {
    intro:
      "Exported every 60 seconds, and once more by the shutdown as the program exits:",
    builtIn: [
      {
        name: "http.server.request.duration",
        description:
          "Each request's duration by `http.route`, method and status: the latency and error rate of every route.",
      },
      {
        name: "http.client.request.duration",
        description:
          "Each call your `http.Client` makes, by server, method and status.",
      },
      {
        name: "db.client.operation.duration",
        description:
          "How long `database/sql` operations take, beside `db.sql.connection.open` for the pool's open and idle connections.",
      },
      {
        name: "go.memory.used",
        description:
          "The runtime's memory by type, beside `go.goroutine.count` and `go.memory.gc.goal`: a goroutine count that only grows is a leak.",
      },
    ],
    snippets: [],
    notes: [
      "Count what matters to the business, as `orders.placed` does: create the counter once with `otel.Meter`, then `Add` to it where it happens, with the request's context.",
      "Keep attribute values to a small set, such as the payment method: each distinct value is a series of its own.",
    ],
  },

  sampling: {
    intro:
      "Health checks are left out by `otelhttp.WithFilter` in `main.go`. Once traffic grows, keep a share of the rest; the SDK reads the standard variables:",
    snippets: [sampling],
    notes: [
      "`parentbased_traceidratio` keeps a quarter of new traces, and follows the caller's decision for a request that arrives with a `traceparent` header.",
      "Sampling drops whole traces only: `orders.placed` and the request duration still count every order and every request, and every log record is still sent.",
    ],
  },

  deploy: {
    intro:
      "Build a static binary in the Go image and run it in a distroless one, with the key in a Kubernetes Secret:",
    snippets: [
      goDockerfileSnippet({ build: ".", binary: "orders-api", port: 8080 }),
      kubernetesManifestSnippet({
        name: "orders-api",
        image: "registry.example.com/orders-api:1.4.0",
        containerPort: 8080,
      }),
    ],
    notes: [
      "`modernc.org/sqlite` is pure Go, so `CGO_ENABLED=0` builds; a driver that needs cgo needs a base image with a C library instead of `static`.",
      "Kubernetes sends SIGTERM before it stops a pod: `signal.NotifyContext` turns it into the shutdown that flushes the last spans, metrics and logs, well inside the 30 seconds it waits.",
    ],
  },

  verify: {
    intro: "Check in this order: each step rules out one cause.",
    steps: [
      validateKeyStep("server"),
      {
        title: "Find the service",
        body: `Send the service a request, then open ${SCREENS.services}: \`orders-api\` is listed within a minute.`,
      },
      {
        title: "Open a request's trace",
        body: `In ${SCREENS.traces}, search for \`POST /orders\`: its trace holds \`checkout.charge\`, the payments call and the \`INSERT\` beneath it.`,
      },
      {
        title: "Find the panic",
        body: `Request \`/orders/7/receipt\`, an order with no receipt: ${SCREENS.exceptions} lists the \`nil pointer dereference\` that \`recoverPanics\` recorded, with its stack trace.`,
      },
    ],
  },

  troubleshooting: [
    {
      question: "Every span is a trace of its own",
      answer:
        "The context did not travel. A span started with `context.Background()`, or a call made with a request built by `http.NewRequest`, has no parent: pass the request's `r.Context()`, or the `ctx` your own span returned, to everything inside the request.",
    },
    {
      question: "Server spans are named GET, with no route",
      answer:
        "The request matched no pattern, as for a 404, or a handler panicked with nothing to recover it. `otelhttp` names the span after `Request.Pattern`, which ServeMux sets on Go 1.22 and later; a router that does not set it leaves the name at the method.",
    },
    {
      question: "The last requests before a restart never arrive",
      answer:
        "The program exited without the shutdown: through `os.Exit` or `log.Fatal`, which skip deferred calls, or killed before SIGTERM reached `signal.NotifyContext`. Return from `main`, and give the container time to stop.",
    },
    {
      question: "Nothing arrives, and the program logs “connection refused”",
      answer:
        "`OTEL_EXPORTER_OTLP_ENDPOINT` is not in the program's environment, so the exporters fall back to `localhost:4318`:",
      snippets: [exportErrors],
    },
    {
      question: "The program logs “401 Unauthorized”",
      answer:
        "OneUptime refused the key: `failed to send to https://oneuptime.com/otlp/v1/traces: 401 Unauthorized`. `OTEL_EXPORTER_OTLP_HEADERS` must be `x-oneuptime-token=` and a **Server** key's **Secret Key**, from the project you are looking at.",
    },
  ],

  faq: [
    {
      question: "Is there zero-code instrumentation for Go?",
      answer:
        "Not in the process: Go compiles to one binary, so nothing loads into it at start as a Java or Python agent does. Instrumentation based on eBPF watches a binary from outside, with the privileges that needs; the SDK in code, as here, needs none and records your own spans and logs too.",
    },
    {
      question: "Does it work with chi, gorilla/mux or another router?",
      answer:
        "Yes: `otelhttp.NewHandler` wraps any `http.Handler`. Span names carry the route only where the router sets `Request.Pattern`, as ServeMux does; for Gin, Echo and Fiber, use their own middleware, in the [Gin](/integrations/opentelemetry/gin), [Echo](/integrations/opentelemetry/echo) and [Fiber](/integrations/opentelemetry/fiber) guides.",
    },
    {
      question: "Which Go versions are supported?",
      answer:
        "OpenTelemetry Go v1.47 supports the two newest Go releases, 1.26 and 1.27. This guide was checked with Go 1.27.",
    },
    {
      question: "Do I need an OpenTelemetry Collector?",
      answer:
        "No: the program sends straight to OneUptime. A Collector helps when many services should send through one place that batches, filters or adds attributes: see [OpenTelemetry](/docs/telemetry/open-telemetry).",
    },
  ],

  related: ["gin", "echo", "fiber", "grpc"],
  docs: [DOCS.openTelemetry, DOCS.traces, DOCS.logs, DOCS.metrics],

  verification: {
    runtime: "go",
    framework: { name: "Go" },
    files: [
      { path: "otel.go", snippet: "otel-setup" },
      { path: "main.go", snippet: "main" },
      { path: "recover.go", snippet: "recover" },
      { path: "orders.go", content: ordersFile },
    ],
    stubApiPort: 9000,
    commands: [
      { command: "go mod init example.com/orders" },
      { snippet: "install" },
      { command: "go get modernc.org/sqlite@v1.61.0" },
      // The code the page shows is as gofmt writes it, and passes go vet.
      { command: 'test -z "$(gofmt -l .)" && go vet ./...' },
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
        body: { items: ["kettle", "mug"], payment_method: "card" },
      },
      { method: "GET", path: "/orders/7/receipt" },
    ],
    expect: {
      spans: [
        {
          name: "GET /orders/{id}",
          attributes: { "http.response.status_code": "200" },
        },
        { name: "sql.conn.query", parent: "GET /orders/{id}" },
        {
          name: "checkout.charge",
          attributes: { "payment.method": "card", "order.item_count": "2" },
          parent: "POST /orders",
        },
        {
          name: "HTTP POST",
          attributes: { "http.request.method": "POST" },
          parent: "checkout.charge",
        },
        { name: "sql.conn.exec", parent: "checkout.charge" },
        {
          name: "GET /orders/{id}/receipt",
          hasException: true,
          exceptionMessage: "nil pointer dereference",
        },
      ],
      metrics: [
        "http.server.request.duration",
        "http.client.request.duration",
        "db.client.operation.duration",
        "db.sql.connection.open",
        "go.memory.used",
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
      resource: { "service.name": "orders-api" },
      untracedPaths: ["/healthz"],
      absentSpans: ["sql.conn.reset_session", "sql.rows"],
    },
  },
};
