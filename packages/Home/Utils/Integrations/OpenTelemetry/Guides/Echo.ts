import {
  OpenTelemetryGuide,
  GuideSnippet,
  VerificationCommand,
  VerificationFile,
  VerificationRequest,
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
 * An Echo catalog API on PostgreSQL through pgx, calling a warehouse API.
 * Echo's own OpenTelemetry middleware (labstack/echo-otel, which replaced
 * the contrib otelecho) traces the routes, otelpgx the queries, otelhttp
 * the calls; OnNextError records the errors handlers return, a recovered
 * panic's included. Echo v5 is the current major and v4 the one most apps
 * run: both are shown and both run.
 */

const SHARED_MODULES: Array<string> = [
  ...GO_SDK_MODULES,
  "go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp",
  "github.com/exaring/otelpgx",
];

const installV5: GuideSnippet = goGetSnippet("install-v5", [
  "github.com/labstack/echo/v5",
  "github.com/labstack/echo-otel/v5",
  ...SHARED_MODULES,
]);

const installV4: GuideSnippet = goGetSnippet("install-v4", [
  "github.com/labstack/echo/v4",
  "github.com/labstack/echo-otel/v4",
  ...SHARED_MODULES,
]);

const otelSetup: GuideSnippet = goSetupSnippet();

const mainV5: GuideSnippet = {
  id: "main-v5",
  language: "go",
  title: "main.go",
  code: [
    "package main",
    "",
    "import (",
    '\t"context"',
    '\t"log/slog"',
    '\t"net/http"',
    '\t"os"',
    '\t"os/signal"',
    '\t"syscall"',
    "",
    '\techootel "github.com/labstack/echo-otel/v5"',
    '\t"github.com/labstack/echo/v5"',
    '\t"github.com/labstack/echo/v5/middleware"',
    '\t"go.opentelemetry.io/contrib/bridges/otelslog"',
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
    '\t\totelslog.NewHandler("catalog"),',
    "\t)))",
    "",
    "\tcatalog, err := newCatalog(ctx)",
    "\tif err != nil {",
    '\t\tslog.Error("could not open the database", "error", err)',
    "\t\treturn",
    "\t}",
    "",
    "\te := echo.New()",
    "\t// Echo's own log lines go through slog, and so to OneUptime too.",
    "\te.Logger = slog.Default()",
    "\te.Use(echootel.NewMiddlewareWithConfig(echootel.Config{",
    '\t\tServerName:  "catalog-api",',
    '\t\tSkipper:     func(c *echo.Context) bool { return c.Path() == "/healthz" },',
    "\t\tOnNextError: recordServerError,",
    "\t}))",
    "\te.Use(middleware.Recover())",
    "",
    '\te.GET("/healthz", func(c *echo.Context) error {',
    '\t\treturn c.String(http.StatusOK, "ok")',
    "\t})",
    '\te.GET("/products/:sku", catalog.getProduct)',
    '\te.POST("/products/:sku/reservations", catalog.reserve)',
    '\te.GET("/products/:sku/unit-price", catalog.unitPrice)',
    "",
    "\t// Serves until SIGTERM, then lets the requests in flight finish.",
    '\terr = echo.StartConfig{Address: ":8080", HideBanner: true}.Start(ctx, e)',
    "\tif err != nil {",
    '\t\tslog.Error("server stopped", "error", err)',
    "\t}",
    "}",
  ].join("\n"),
  check: "run",
};

const mainV4: GuideSnippet = {
  id: "main-v4",
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
    '\techootel "github.com/labstack/echo-otel/v4"',
    '\t"github.com/labstack/echo/v4"',
    '\t"github.com/labstack/echo/v4/middleware"',
    '\t"go.opentelemetry.io/contrib/bridges/otelslog"',
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
    '\t\totelslog.NewHandler("catalog"),',
    "\t)))",
    "",
    "\tcatalog, err := newCatalog(ctx)",
    "\tif err != nil {",
    '\t\tslog.Error("could not open the database", "error", err)',
    "\t\treturn",
    "\t}",
    "",
    "\te := echo.New()",
    "\te.HideBanner = true",
    "\te.Use(echootel.NewMiddlewareWithConfig(echootel.Config{",
    '\t\tServerName:  "catalog-api",',
    '\t\tSkipper:     func(c echo.Context) bool { return c.Path() == "/healthz" },',
    "\t\tOnNextError: recordServerError,",
    "\t}))",
    "\t// Hands a panic on as an error, which OnNextError then records.",
    "\te.Use(middleware.RecoverWithConfig(middleware.RecoverConfig{",
    "\t\tDisableErrorHandler: true,",
    "\t}))",
    "",
    '\te.GET("/healthz", func(c echo.Context) error {',
    '\t\treturn c.String(http.StatusOK, "ok")',
    "\t})",
    '\te.GET("/products/:sku", catalog.getProduct)',
    '\te.POST("/products/:sku/reservations", catalog.reserve)',
    '\te.GET("/products/:sku/unit-price", catalog.unitPrice)',
    "",
    "\tgo func() {",
    '\t\terr := e.Start(":8080")',
    "\t\tif err != nil && !errors.Is(err, http.ErrServerClosed) {",
    '\t\t\tslog.Error("server stopped", "error", err)',
    "\t\t}",
    "\t}()",
    "",
    "\t// On SIGTERM, finish the requests in flight; the deferred shutdown then flushes.",
    "\t<-ctx.Done()",
    "\tstopCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)",
    "\tdefer cancel()",
    "\te.Shutdown(stopCtx)",
    "}",
  ].join("\n"),
  check: "run",
};

const errorsV5: GuideSnippet = {
  id: "errors-v5",
  language: "go",
  title: "errors.go",
  code: [
    "package main",
    "",
    "import (",
    '\t"errors"',
    '\t"fmt"',
    '\t"log/slog"',
    "",
    '\t"github.com/labstack/echo/v5"',
    '\t"github.com/labstack/echo/v5/middleware"',
    '\t"go.opentelemetry.io/otel/attribute"',
    '\t"go.opentelemetry.io/otel/trace"',
    ")",
    "",
    "// recordServerError records an error a handler returned on the request's",
    "// span, so it reaches OneUptime's Exceptions. A 4xx, such as a product that",
    "// does not exist, is the caller's mistake: it is left out.",
    "func recordServerError(c *echo.Context, err error) {",
    "\tvar coder echo.HTTPStatusCoder",
    "\tif errors.As(err, &coder) && coder.StatusCode() < 500 {",
    "\t\treturn",
    "\t}",
    "",
    "\tvar options []trace.EventOption",
    "\t// Recover hands a panic over with the stack in its message: record the",
    "\t// panic itself, with the stack where OneUptime shows one.",
    "\tvar panicked *middleware.PanicStackError",
    "\tif errors.As(err, &panicked) {",
    '\t\terr = fmt.Errorf("panic: %w", panicked.Err)',
    "\t\toptions = append(options, trace.WithAttributes(",
    '\t\t\tattribute.String("exception.stacktrace", string(panicked.Stack))))',
    "\t}",
    "",
    "\tctx := c.Request().Context()",
    "\ttrace.SpanFromContext(ctx).RecordError(err, options...)",
    '\tslog.ErrorContext(ctx, "request failed", "error", err)',
    "}",
  ].join("\n"),
  check: "run",
};

const errorsV4: GuideSnippet = {
  id: "errors-v4",
  language: "go",
  title: "errors.go",
  code: [
    "package main",
    "",
    "import (",
    '\t"errors"',
    '\t"log/slog"',
    "",
    '\t"github.com/labstack/echo/v4"',
    '\t"go.opentelemetry.io/otel/trace"',
    ")",
    "",
    "// recordServerError records an error a handler returned on the request's",
    "// span, so it reaches OneUptime's Exceptions. A 4xx, such as a product that",
    "// does not exist, is the caller's mistake: it is left out.",
    "func recordServerError(c echo.Context, err error) {",
    "\tvar httpError *echo.HTTPError",
    "\tif errors.As(err, &httpError) && httpError.Code < 500 {",
    "\t\treturn",
    "\t}",
    "",
    "\tctx := c.Request().Context()",
    "\ttrace.SpanFromContext(ctx).RecordError(err)",
    '\tslog.ErrorContext(ctx, "request failed", "error", err)',
    "}",
  ].join("\n"),
  check: "run",
};

// The products the API sells, in PostgreSQL through pgx.
const catalogFile: string = [
  "package main",
  "",
  "import (",
  '\t"context"',
  '\t"errors"',
  '\t"fmt"',
  '\t"log/slog"',
  '\t"net/http"',
  '\t"os"',
  "",
  '\t"github.com/exaring/otelpgx"',
  '\t"github.com/jackc/pgx/v5"',
  '\t"github.com/jackc/pgx/v5/pgxpool"',
  '\t"github.com/labstack/echo/v5"',
  '\t"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"',
  '\t"go.opentelemetry.io/otel"',
  '\t"go.opentelemetry.io/otel/attribute"',
  '\t"go.opentelemetry.io/otel/metric"',
  ")",
  "",
  'var tracer = otel.Tracer("catalog")',
  "",
  "type Product struct {",
  '\tSKU   string `json:"sku"`',
  '\tStock int    `json:"stock"`',
  '\tPrice int    `json:"price"`',
  "}",
  "",
  "type catalog struct {",
  "\tdb           *pgxpool.Pool",
  "\twarehouse    *http.Client",
  "\twarehouseURL string",
  "\treservations metric.Int64Counter",
  "}",
  "",
  "func newCatalog(ctx context.Context) (*catalog, error) {",
  '\tconfig, err := pgxpool.ParseConfig(os.Getenv("DATABASE_URL"))',
  "\tif err != nil {",
  "\t\treturn nil, err",
  "\t}",
  "\t// A span per query, under the request that ran it.",
  "\tconfig.ConnConfig.Tracer = otelpgx.NewTracer(otelpgx.WithDisableAcquireTracer())",
  "\tdb, err := pgxpool.NewWithConfig(ctx, config)",
  "\tif err != nil {",
  "\t\treturn nil, err",
  "\t}",
  "\t// The pool's connections, as metrics.",
  "\tif err := otelpgx.RecordStats(db); err != nil {",
  "\t\treturn nil, err",
  "\t}",
  "",
  '\treservations, err := otel.Meter("catalog").Int64Counter("products.reserved",',
  '\t\tmetric.WithDescription("Units reserved, by product"))',
  "\tif err != nil {",
  "\t\treturn nil, err",
  "\t}",
  "",
  "\treturn &catalog{",
  "\t\tdb:           db,",
  "\t\twarehouse:    &http.Client{Transport: otelhttp.NewTransport(http.DefaultTransport)},",
  '\t\twarehouseURL: envOr("WAREHOUSE_API_URL", "http://localhost:9000"),',
  "\t\treservations: reservations,",
  "\t}, nil",
  "}",
  "",
  "func (s *catalog) getProduct(c *echo.Context) error {",
  "\tctx := c.Request().Context()",
  '\tslog.InfoContext(ctx, "loading product", "product.sku", c.Param("sku"))',
  "",
  "\tvar product Product",
  "\terr := s.db.QueryRow(ctx,",
  '\t\t"SELECT sku, stock, price FROM products WHERE sku = $1", c.Param("sku"),',
  "\t).Scan(&product.SKU, &product.Stock, &product.Price)",
  "\tif errors.Is(err, pgx.ErrNoRows) {",
  '\t\treturn echo.NewHTTPError(http.StatusNotFound, "no such product")',
  "\t}",
  "\tif err != nil {",
  "\t\treturn err",
  "\t}",
  "\treturn c.JSON(http.StatusOK, product)",
  "}",
  "",
  "func (s *catalog) reserve(c *echo.Context) error {",
  "\tvar request struct {",
  '\t\tQuantity int `json:"quantity"`',
  "\t}",
  "\tif err := c.Bind(&request); err != nil {",
  "\t\treturn err",
  "\t}",
  "",
  "\t// A span of your own, under the request's: the calls below nest beneath it.",
  '\tctx, span := tracer.Start(c.Request().Context(), "catalog.reserve")',
  "\tdefer span.End()",
  "\tspan.SetAttributes(",
  '\t\tattribute.String("product.sku", c.Param("sku")),',
  '\t\tattribute.Int("reservation.quantity", request.Quantity),',
  "\t)",
  "",
  '\tif err := s.callWarehouse(ctx, "/api/reservations"); err != nil {',
  '\t\treturn fmt.Errorf("reserve %s: %w", c.Param("sku"), err)',
  "\t}",
  "\t_, err := s.db.Exec(ctx,",
  '\t\t"UPDATE products SET stock = stock - $1 WHERE sku = $2",',
  '\t\trequest.Quantity, c.Param("sku"),',
  "\t)",
  "\tif err != nil {",
  "\t\treturn err",
  "\t}",
  "",
  "\ts.reservations.Add(ctx, int64(request.Quantity),",
  '\t\tmetric.WithAttributes(attribute.String("product.sku", c.Param("sku"))))',
  '\treturn c.JSON(http.StatusCreated, map[string]string{"status": "reserved"})',
  "}",
  "",
  "func (s *catalog) unitPrice(c *echo.Context) error {",
  "\tctx := c.Request().Context()",
  "\tvar price, packSize int",
  "\terr := s.db.QueryRow(ctx,",
  '\t\t"SELECT price, pack_size FROM products WHERE sku = $1", c.Param("sku"),',
  "\t).Scan(&price, &packSize)",
  "\tif err != nil {",
  "\t\treturn err",
  "\t}",
  "\t// A product sold loose has a pack size of 0: the division panics.",
  '\treturn c.JSON(http.StatusOK, map[string]int{"unit_price": price / packSize})',
  "}",
  "",
  "func (s *catalog) callWarehouse(ctx context.Context, path string) error {",
  "\treq, err := http.NewRequestWithContext(ctx, http.MethodPost, s.warehouseURL+path, nil)",
  "\tif err != nil {",
  "\t\treturn err",
  "\t}",
  "\tresp, err := s.warehouse.Do(req)",
  "\tif err != nil {",
  "\t\treturn err",
  "\t}",
  "\tdefer resp.Body.Close()",
  "\tif resp.StatusCode >= 300 {",
  '\t\treturn fmt.Errorf("warehouse answered %d", resp.StatusCode)',
  "\t}",
  "\treturn nil",
  "}",
  "",
  "func envOr(name, fallback string) string {",
  '\tif value := os.Getenv(name); value != "" {',
  "\t\treturn value",
  "\t}",
  "\treturn fallback",
  "}",
].join("\n");

/*
 * The same handlers on Echo v4, which passes echo.Context, an interface,
 * where v5 passes *echo.Context: nothing else in them changes.
 */
const catalogFileV4: string = catalogFile
  .split("*echo.Context")
  .join("echo.Context")
  .split('"github.com/labstack/echo/v5"')
  .join('"github.com/labstack/echo/v4"');

// Creates and fills the products table the API reads: not part of the guide.
const seedFile: string = [
  "package main",
  "",
  "import (",
  '\t"context"',
  '\t"os"',
  "",
  '\t"github.com/jackc/pgx/v5"',
  ")",
  "",
  "func main() {",
  "\tctx := context.Background()",
  '\tconn, err := pgx.Connect(ctx, os.Getenv("DATABASE_URL"))',
  "\tif err != nil {",
  "\t\tpanic(err)",
  "\t}",
  "\tdefer conn.Close(ctx)",
  "",
  "\t_, err = conn.Exec(ctx, `",
  "\t\tCREATE TABLE IF NOT EXISTS products (",
  "\t\t\tsku TEXT PRIMARY KEY, stock INT, price INT, pack_size INT);",
  "\t\tINSERT INTO products VALUES",
  "\t\t\t('KETTLE-1', 12, 4500, 1), ('TEA-LOOSE', 40, 900, 0)",
  "\t\t\tON CONFLICT DO NOTHING;`)",
  "\tif err != nil {",
  "\t\tpanic(err)",
  "\t}",
  "}",
].join("\n");

const newCatalog: GuideSnippet = {
  id: "new-catalog",
  language: "go",
  title: "catalog.go",
  code: goDeclaration(catalogFile, "func newCatalog("),
  check: "contained",
};

const getProduct: GuideSnippet = {
  id: "get-product",
  language: "go",
  title: "catalog.go",
  code: goDeclaration(catalogFile, "func (s *catalog) getProduct("),
  check: "contained",
};

const reserve: GuideSnippet = {
  id: "reserve",
  language: "go",
  title: "catalog.go",
  code: goDeclaration(catalogFile, "func (s *catalog) reserve("),
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
    'export OTEL_TRACES_SAMPLER_ARG="0.1"',
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

function commandsFor(install: string): Array<VerificationCommand> {
  return [
    { command: "go mod init example.com/catalog" },
    { snippet: install },
    { command: "go get github.com/jackc/pgx/v5@v5.11.0" },
    { command: 'test -z "$(gofmt -l .)" && go vet ./...' },
    { command: "go run ./seed" },
    { snippet: "run", isServer: true },
  ];
}

function filesFor(
  main: string,
  errors: string,
  catalog: string,
): Array<VerificationFile> {
  return [
    { path: "otel.go", snippet: "otel-setup" },
    { path: "main.go", snippet: main },
    { path: "errors.go", snippet: errors },
    { path: "catalog.go", content: catalog },
    { path: "seed/main.go", content: seedFile },
  ];
}

const REQUESTS: Array<VerificationRequest> = [
  { method: "GET", path: "/healthz" },
  { method: "GET", path: "/products/KETTLE-1" },
  { method: "GET", path: "/products/NOPE" },
  {
    method: "POST",
    path: "/products/KETTLE-1/reservations",
    body: { quantity: 2 },
  },
  { method: "GET", path: "/products/TEA-LOOSE/unit-price" },
];

export const EchoGuide: OpenTelemetryGuide = {
  slug: "echo",
  seo: {
    title: "Echo OpenTelemetry: Go Tracing, Metrics & Logs | OneUptime",
    description:
      "Instrument Echo v5 or v4 with OpenTelemetry: echo-otel middleware, pgx queries, outgoing calls, returned errors and panics as exceptions, sent to OneUptime.",
  },
  h1: "OpenTelemetry for Echo",
  lead: "Trace every route of your Echo API with the pgx queries and HTTP calls it makes, and send traces, metrics and logs to OneUptime. Add Echo's own OpenTelemetry middleware, record the errors your handlers return in its `OnNextError`, and keep your handlers as they are, on Echo v5 or v4.",
  cardDescription:
    "Echo v5 and v4 with Echo's own echo-otel middleware, pgx queries, outgoing calls and returned errors as exceptions.",
  searchTerms: ["labstack", "echo-otel", "otelecho", "pgx", "postgres"],
  highlights: ["Echo v5 and v4", "echo-otel middleware", "pgx queries"],

  whatYouGet: {
    intro: `Each request Echo routes becomes a trace under the service named by \`OTEL_SERVICE_NAME\`, listed in ${SCREENS.services} from the first one. The example is a catalog API that keeps its products in PostgreSQL, through pgx, and calls a warehouse API to reserve stock.`,
    traces:
      "A server span per request named after its route, such as `GET /products/:sku`, with a span for each pgx query (`SELECT`, `UPDATE`) and each call to the warehouse API beneath it.",
    metrics:
      "Request duration by `http.route`, method, status and error type, the warehouse calls' duration, the time queries take, the pgx pool's connections, and the Go runtime.",
    logs: "Each `slog` record a handler writes with its request's context, with that request's trace and span IDs; on Echo v5, Echo's own log lines too.",
    exceptions: `An error a handler returns that ends in a 5xx, and a panic \`middleware.Recover\` catches, are recorded on the request's span by \`OnNextError\` and reach ${SCREENS.exceptions}; a 4xx such as a missing product is left out.`,
  },

  exampleTrace: {
    caption:
      "A POST /products/:sku/reservations request, as its trace shows it",
    spans: [
      {
        name: "POST /products/:sku/reservations",
        depth: 0,
        start: 0,
        duration: 100,
        source: "echo-otel",
      },
      {
        name: "catalog.reserve",
        depth: 1,
        start: 6,
        duration: 88,
        source: "your code",
      },
      {
        name: "HTTP POST",
        depth: 2,
        start: 9,
        duration: 47,
        source: "otelhttp",
      },
      {
        name: "UPDATE",
        depth: 2,
        start: 60,
        duration: 30,
        source: "otelpgx",
      },
    ],
  },

  prerequisites: [
    GO_PREREQUISITE,
    "An Echo app, on Echo v5 or v4. These steps were checked with Echo 5.4 and 4.16, pgx 5.11 and PostgreSQL 15.",
    SERVER_KEY_PREREQUISITE,
  ],

  install: {
    intro:
      "Add the SDK and its exporters, Echo's OpenTelemetry middleware for your major version, `otelhttp` for outgoing calls and `otelpgx` for the database, at the versions this guide was checked with:",
    snippets: [],
    tabs: {
      group: "version",
      tabs: [
        {
          label: "Echo v5",
          snippets: [installV5],
        },
        {
          label: "Echo v4",
          snippets: [installV4],
        },
      ],
    },
    notes: [
      "OpenTelemetry's contrib `otelecho` is deprecated in favour of the middleware Echo's maintainers publish, `github.com/labstack/echo-otel`, with a module for each major: `/v5` and `/v4`. Move to it when you next touch the tracing.",
    ],
  },

  configure: {
    intro:
      "The exporters take the endpoint, the key and the service's name from the standard variables, so none of them is in your code:",
    tabs: otlpEnvironmentTabs({ serviceName: "catalog-api" }),
    notes: [
      "The `ServerName` the middleware takes, `catalog-api` below, is the server's name on its spans (`server.address`); the service's name is `OTEL_SERVICE_NAME`.",
    ],
  },

  setup: {
    intro:
      "Start the SDK before Echo, add the middleware first, then record the errors Echo hands it.",
    steps: [
      {
        title: "Add a file that starts OpenTelemetry",
        body: "A provider and an OTLP exporter for each signal, set as the globals the middleware, `otelhttp` and `otelpgx` all use, and a function that flushes them:",
        snippets: [otelSetup],
      },
      {
        title: "Add echo-otel to Echo in main",
        body: "Start OpenTelemetry first and defer its shutdown, then add the middleware before any other, with a `Skipper` for health checks and `OnNextError` set:",
        tabs: {
          group: "version",
          tabs: [
            {
              label: "Echo v5",
              snippets: [mainV5],
              notes: [
                "`StartConfig.Start` serves until the context ends, on SIGTERM, then gives the requests in flight 10 seconds before the deferred shutdown flushes.",
                "`e.Logger = slog.Default()` sends Echo's own lines, such as `http(s) server started`, through the same handlers as yours.",
              ],
            },
            {
              label: "Echo v4",
              snippets: [mainV4],
              notes: [
                "`DisableErrorHandler` makes v4's `Recover` return the panic as an error, so `OnNextError` sees it; by default it answers the request itself and the middleware records no exception.",
              ],
            },
          ],
        },
      },
      {
        title: "Record the errors handlers return",
        body: "The middleware marks a request failed from its status, but records no exception: `OnNextError` gets each error a handler returns, so record it on the request's span there:",
        tabs: {
          group: "version",
          tabs: [
            {
              label: "Echo v5",
              snippets: [errorsV5],
            },
            {
              label: "Echo v4",
              snippets: [errorsV4],
            },
          ],
        },
      },
      {
        title: "Run it",
        body: "With the variables above exported and `DATABASE_URL` set, start the API:",
        snippets: [run],
      },
    ],
  },

  autoInstrumentation: {
    intro: "Each part of a request is traced where you set it up, once:",
    rows: [
      {
        library: "`echo-otel`",
        covers:
          "A server span per request named after its route (`GET /products/:sku`), with `http.route`, the status and `error.type`, and `http.server.request.duration`.",
      },
      {
        library: "`otelpgx`",
        covers:
          "A span per query, named after its operation (`SELECT`), with the SQL in `db.query.text`, its first run's prepare beneath it, and `db.client.operation.duration`.",
      },
      {
        library: "`otelpgx.RecordStats`",
        covers:
          "The pool as `pgxpool.*` metrics: connections idle and acquired, and the time spent waiting for one.",
      },
      {
        library: "`otelhttp.NewTransport`",
        covers:
          "A client span per call to the warehouse API, with `traceparent` sent along, and `http.client.request.duration`.",
      },
      {
        library: "`otelslog` and `runtime`",
        covers:
          "Each `slog` record as a log with the IDs of the span it was written in, and the Go runtime's own metrics.",
      },
    ],
    snippets: [newCatalog],
    notes: [
      "Give the pool's config `otelpgx.NewTracer()` before you create the pool, and `RecordStats` the pool after. `WithDisableAcquireTracer` leaves out the `pool.acquire` span each query would start with:",
    ],
  },

  manualSpans: {
    intro:
      "Put work of your own, such as reserving stock, in a span: the warehouse call and the `UPDATE` take the `ctx` it returns, and nest beneath it.",
    snippets: [reserve],
    notes: [
      "A handler's context is `c.Request().Context()`: the middleware put the request's span there. `c` itself is not a `context.Context` in Echo.",
      "On Echo v4, the handler takes `c echo.Context` in place of `c *echo.Context`; the code inside is the same.",
      "The error this returns, wrapped with the product, is what `OnNextError` records: wrap errors with what you would search for.",
    ],
  },

  logs: {
    intro:
      "Log with `slog`, through the `...Context` functions and the request's context, and each record carries its request's trace and span IDs:",
    snippets: [getProduct],
    notes: [
      "A 404 such as `no such product` is an `echo.HTTPError`, which `recordServerError` leaves out: the request's span still shows its status.",
      "Echo v5's logger is a `*slog.Logger`, so `e.Logger = slog.Default()` sends Echo's lines to OneUptime; v4's logger is Echo's own, and writes to the console.",
      "`recordServerError` logs each error it records with `slog.ErrorContext`, which sends it as `exception.message` and `exception.type`.",
    ],
  },

  metrics: {
    intro: "Exported every 60 seconds, and once more as the shutdown flushes:",
    builtIn: [
      {
        name: "http.server.request.duration",
        description:
          "Each request's duration by `http.route`, method, status and `error.type`, from the middleware.",
      },
      {
        name: "db.client.operation.duration",
        description:
          "How long each pgx query takes, by operation: the database's share of a route's latency.",
      },
      {
        name: "pgxpool.acquired_connections",
        description:
          "Connections the pool has handed out, beside `pgxpool.idle_connections` and `pgxpool.empty_acquire_wait_time`: waits that grow mean the pool is too small.",
      },
      {
        name: "http.client.request.duration",
        description:
          "The calls made to the warehouse API, by method and status.",
      },
    ],
    snippets: [],
    notes: [
      "`products.reserved` adds up the units reserved, by product: an `Int64Counter`, created once in `newCatalog` and added to in `reserve`.",
      "A product's SKU makes a good attribute while the catalog is small; for thousands of products, count by category instead, since each value is a series of its own.",
    ],
  },

  sampling: {
    intro:
      "The `Skipper` keeps health checks out of the traces altogether. For a busy API, keep a share of the rest:",
    snippets: [sampling],
    notes: [
      "`parentbased_traceidratio` keeps one new trace in ten, and keeps or drops a request that arrives with a `traceparent` as its caller did.",
      "A sampled-out request still counts in `http.server.request.duration`: metrics never go through the sampler.",
    ],
  },

  deploy: {
    intro:
      "Build the API in the Go image, run it from a distroless one, and keep the key in a Kubernetes Secret:",
    snippets: [
      goDockerfileSnippet({ build: ".", binary: "catalog-api", port: 8080 }),
      kubernetesManifestSnippet({
        name: "catalog-api",
        image: "registry.example.com/catalog-api:5.0.2",
        containerPort: 8080,
      }),
    ],
    notes: [
      "Add `DATABASE_URL` from a Secret of its own, beside the one that holds the ingestion key.",
      "Both majors stop on SIGTERM as shown: v5 through `StartConfig.Start`'s context, v4 through `e.Shutdown`; the deferred OpenTelemetry shutdown sends what is left.",
    ],
  },

  verify: {
    intro: "Check in this order: each step rules out one cause.",
    steps: [
      validateKeyStep("server"),
      {
        title: "Find the service",
        body: `Request a route, and \`catalog-api\` shows up in ${SCREENS.services} within a minute.`,
      },
      {
        title: "Open a reservation's trace",
        body: `In ${SCREENS.traces}, search \`@http.route:/products/:sku/reservations\`: \`catalog.reserve\` holds the warehouse call and the \`UPDATE\`.`,
      },
      {
        title: "Find the panic",
        body: `Ask \`/products/TEA-LOOSE/unit-price\`, a product sold loose: ${SCREENS.exceptions} lists \`panic: runtime error: integer divide by zero\` with the request it happened in.`,
      },
    ],
  },

  troubleshooting: [
    {
      question: "Requests are traced, but no exception reaches OneUptime",
      answer:
        "`OnNextError` is not set, or the error never reaches it. On Echo v4, `middleware.Recover` answers a panic itself unless `DisableErrorHandler` is true; and an error a handler writes with `c.JSON` instead of returning is no error to the middleware.",
    },
    {
      question: "Every exception's message holds a whole stack trace",
      answer:
        "Echo v5's `Recover` wraps a panic in a `PanicStackError`, whose message carries the stack: record `panicked.Err`, as `recordServerError` does, so panics of the same kind group together in **Exceptions**.",
    },
    {
      question: "Queries start traces of their own",
      answer:
        "The query ran with a context that holds no span, such as `context.Background()`. Pass `c.Request().Context()`, or the `ctx` your own span returned, to every pgx call.",
    },
    {
      question: "The build fails with an otelecho import",
      answer:
        "`go.opentelemetry.io/contrib/instrumentation/github.com/labstack/echo/otelecho` is deprecated and built for Echo v4 only. Replace it with `github.com/labstack/echo-otel/v5` (or `/v4`), whose `NewMiddleware` takes the same server name.",
    },
    {
      question: "Nothing arrives, and the console shows export errors",
      answer:
        "`connection refused` on `localhost:4318` means the process never got `OTEL_EXPORTER_OTLP_ENDPOINT`; a `401 Unauthorized` means OneUptime refused the key in `OTEL_EXPORTER_OTLP_HEADERS`.",
    },
  ],

  faq: [
    {
      question: "Should I move to Echo v5 first?",
      answer:
        "No: the middleware has a module for each major, and both tabs above were run end to end. Move to v5 when it suits you; the tracing moves with a changed import and handler signatures.",
    },
    {
      question: "Does the middleware record metrics?",
      answer:
        "Yes: `http.server.request.duration` and the request and response body sizes, by route, method, status and error type. Its `Metrics` field takes a recorder of your own to change them.",
    },
    {
      question: "Can I use database/sql or GORM instead of pgx?",
      answer:
        "Yes: `otelsql` wraps `database/sql`, as the [Go](/integrations/opentelemetry/go) guide shows, and GORM has a plugin of its own, in the [Gin](/integrations/opentelemetry/gin) guide.",
    },
    {
      question: "Do I need an OpenTelemetry Collector?",
      answer:
        "No: the API sends straight to OneUptime. A Collector helps when you want one place for many services' telemetry: see [OpenTelemetry](/docs/telemetry/open-telemetry).",
    },
  ],

  related: ["go", "gin", "fiber", "grpc"],
  docs: [DOCS.openTelemetry, DOCS.traces, DOCS.exceptions, DOCS.metrics],

  verification: {
    runtime: "go",
    framework: { name: "Echo", package: "github.com/labstack/echo/v5" },
    services: [postgres],
    files: filesFor("main-v5", "errors-v5", catalogFile),
    stubApiPort: 9000,
    commands: commandsFor("install-v5"),
    port: 8080,
    requests: REQUESTS,
    expect: {
      spans: [
        {
          name: "GET /products/:sku",
          attributes: { "http.route": "/products/:sku" },
        },
        { name: "SELECT", parent: "GET /products/:sku" },
        {
          name: "catalog.reserve",
          attributes: {
            "product.sku": "KETTLE-1",
            "reservation.quantity": "2",
          },
          parent: "POST /products/:sku/reservations",
        },
        { name: "HTTP POST", parent: "catalog.reserve" },
        { name: "UPDATE", parent: "catalog.reserve" },
        {
          name: "GET /products/:sku/unit-price",
          hasException: true,
          exceptionMessage: "panic: runtime error: integer divide by zero",
        },
      ],
      metrics: [
        "http.server.request.duration",
        "http.client.request.duration",
        "db.client.operation.duration",
        "pgxpool.acquired_connections",
        "products.reserved",
      ],
      logs: [
        {
          body: "loading product",
          hasTraceContext: true,
          attributes: { "product.sku": "KETTLE-1" },
        },
        { body: "request failed", hasTraceContext: true, hasException: true },
        { body: "http(s) server started", hasTraceContext: false },
      ],
      resource: { "service.name": "catalog-api" },
      untracedPaths: ["/healthz"],
      absentSpans: ["pool.acquire"],
    },
    variants: [
      {
        name: "Echo v4",
        services: [postgres],
        files: filesFor("main-v4", "errors-v4", catalogFileV4),
        stubApiPort: 9000,
        commands: commandsFor("install-v4"),
        port: 8080,
        requests: REQUESTS,
        expect: {
          spans: [
            {
              name: "GET /products/:sku",
              attributes: { "http.route": "/products/:sku" },
            },
            {
              name: "catalog.reserve",
              parent: "POST /products/:sku/reservations",
            },
            { name: "UPDATE", parent: "catalog.reserve" },
            {
              name: "GET /products/:sku/unit-price",
              hasException: true,
              exceptionMessage: "runtime error: integer divide by zero",
            },
          ],
          metrics: ["http.server.request.duration", "products.reserved"],
          logs: [
            { body: "loading product", hasTraceContext: true },
            {
              body: "request failed",
              hasTraceContext: true,
              hasException: true,
            },
          ],
          resource: { "service.name": "catalog-api" },
          untracedPaths: ["/healthz"],
        },
      },
    ],
  },
};
