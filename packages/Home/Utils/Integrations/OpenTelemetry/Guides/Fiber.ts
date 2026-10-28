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
 * A Fiber carts API on Redis, calling a pricing API. Fiber runs on
 * fasthttp, not net/http, so otelhttp cannot trace its requests: Fiber's
 * own middleware (gofiber/contrib) does. Two things are Fiber's own: its
 * values live in buffers reused once a handler returns, which corrupts
 * what telemetry exports later unless the app is Immutable (seen in a
 * run: a logged order id read "x2"), and every returned error is recorded,
 * a router 404's included. Fiber v3 is current and v2 deprecated but
 * widely run: both are shown and both run.
 */

const SHARED_MODULES: Array<string> = [
  ...GO_SDK_MODULES,
  "go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp",
  "github.com/redis/go-redis/extra/redisotel/v9",
];

const installV3: GuideSnippet = goGetSnippet("install-v3", [
  "github.com/gofiber/fiber/v3",
  "github.com/gofiber/contrib/v3/otel",
  ...SHARED_MODULES,
]);

const installV2: GuideSnippet = goGetSnippet("install-v2", [
  "github.com/gofiber/fiber/v2",
  "github.com/gofiber/contrib/otelfiber/v2",
  ...SHARED_MODULES,
]);

const otelSetup: GuideSnippet = goSetupSnippet();

const mainV3: GuideSnippet = {
  id: "main-v3",
  language: "go",
  title: "main.go",
  code: [
    "package main",
    "",
    "import (",
    '\t"context"',
    '\t"log/slog"',
    '\t"os"',
    '\t"os/signal"',
    '\t"syscall"',
    "",
    '\tfiberotel "github.com/gofiber/contrib/v3/otel"',
    '\t"github.com/gofiber/fiber/v3"',
    '\t"github.com/gofiber/fiber/v3/middleware/recover"',
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
    '\t\totelslog.NewHandler("carts"),',
    "\t)))",
    "",
    "\tcarts, err := newCarts()",
    "\tif err != nil {",
    '\t\tslog.Error("could not reach Redis", "error", err)',
    "\t\treturn",
    "\t}",
    "",
    "\tapp := fiber.New(fiber.Config{",
    "\t\t// Copies values out of Fiber's reused buffers: telemetry outlives the handler.",
    "\t\tImmutable: true,",
    "\t})",
    "\tapp.Use(fiberotel.Middleware(",
    '\t\tfiberotel.WithNext(func(c fiber.Ctx) bool { return c.Path() == "/healthz" }),',
    "\t))",
    "\tapp.Use(recover.New())",
    "",
    '\tapp.Get("/healthz", func(c fiber.Ctx) error { return c.SendString("ok") })',
    '\tapp.Get("/carts/:id", carts.get)',
    '\tapp.Post("/carts/:id/items", carts.addItem)',
    '\tapp.Get("/carts/:id/total", carts.total)',
    "\t// The last handler: a 404 sent, not returned, so it is no exception.",
    "\tapp.Use(func(c fiber.Ctx) error { return c.SendStatus(fiber.StatusNotFound) })",
    "",
    "\tgo func() {",
    "\t\t<-ctx.Done()",
    "\t\t// Finishes the requests in flight; the deferred shutdown then flushes.",
    "\t\tapp.Shutdown()",
    "\t}()",
    '\terr = app.Listen(":8080", fiber.ListenConfig{DisableStartupMessage: true})',
    "\tif err != nil {",
    '\t\tslog.Error("server stopped", "error", err)',
    "\t}",
    "}",
  ].join("\n"),
  check: "run",
};

const mainV2: GuideSnippet = {
  id: "main-v2",
  language: "go",
  title: "main.go",
  code: [
    "package main",
    "",
    "import (",
    '\t"context"',
    '\t"log/slog"',
    '\t"os"',
    '\t"os/signal"',
    '\t"syscall"',
    "",
    '\t"github.com/gofiber/contrib/otelfiber/v2"',
    '\t"github.com/gofiber/fiber/v2"',
    '\t"github.com/gofiber/fiber/v2/middleware/recover"',
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
    '\t\totelslog.NewHandler("carts"),',
    "\t)))",
    "",
    "\tcarts, err := newCarts()",
    "\tif err != nil {",
    '\t\tslog.Error("could not reach Redis", "error", err)',
    "\t\treturn",
    "\t}",
    "",
    "\tapp := fiber.New(fiber.Config{",
    "\t\t// Copies values out of Fiber's reused buffers: telemetry outlives the handler.",
    "\t\tImmutable:             true,",
    "\t\tDisableStartupMessage: true,",
    "\t})",
    "\tapp.Use(otelfiber.Middleware(",
    '\t\totelfiber.WithNext(func(c *fiber.Ctx) bool { return c.Path() == "/healthz" }),',
    "\t))",
    "\tapp.Use(recover.New())",
    "",
    '\tapp.Get("/healthz", func(c *fiber.Ctx) error { return c.SendString("ok") })',
    '\tapp.Get("/carts/:id", carts.get)',
    '\tapp.Post("/carts/:id/items", carts.addItem)',
    '\tapp.Get("/carts/:id/total", carts.total)',
    "\t// The last handler: a 404 sent, not returned, so it is no exception.",
    "\tapp.Use(func(c *fiber.Ctx) error { return c.SendStatus(fiber.StatusNotFound) })",
    "",
    "\tgo func() {",
    "\t\t<-ctx.Done()",
    "\t\t// Finishes the requests in flight; the deferred shutdown then flushes.",
    "\t\tapp.Shutdown()",
    "\t}()",
    '\tif err := app.Listen(":8080"); err != nil {',
    '\t\tslog.Error("server stopped", "error", err)',
    "\t}",
    "}",
  ].join("\n"),
  check: "run",
};

// The carts, kept in Redis hashes, on Fiber v3.
const cartsFile: string = [
  "package main",
  "",
  "import (",
  '\t"context"',
  '\t"fmt"',
  '\t"log/slog"',
  '\t"net/http"',
  '\t"os"',
  '\t"strconv"',
  "",
  '\t"github.com/gofiber/fiber/v3"',
  '\t"github.com/redis/go-redis/extra/redisotel/v9"',
  '\t"github.com/redis/go-redis/v9"',
  '\t"github.com/redis/go-redis/v9/maintnotifications"',
  '\t"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"',
  '\t"go.opentelemetry.io/otel"',
  '\t"go.opentelemetry.io/otel/attribute"',
  '\t"go.opentelemetry.io/otel/metric"',
  ")",
  "",
  'var tracer = otel.Tracer("carts")',
  "",
  "type carts struct {",
  "\tredis      *redis.Client",
  "\tpricing    *http.Client",
  "\tpricingURL string",
  "\titemsAdded metric.Int64Counter",
  "}",
  "",
  "func newCarts() (*carts, error) {",
  "\trdb := redis.NewClient(&redis.Options{",
  '\t\tAddr: os.Getenv("REDIS_ADDR"),',
  "\t\t// Open-source Redis refuses the client's maintenance handshake: without",
  "\t\t// this, every new connection records a failed CLIENT command.",
  "\t\tMaintNotificationsConfig: &maintnotifications.Config{",
  "\t\t\tMode: maintnotifications.ModeDisabled,",
  "\t\t},",
  "\t})",
  "\t// A span per command, and the connection pool's metrics.",
  "\tif err := redisotel.InstrumentTracing(rdb); err != nil {",
  "\t\treturn nil, err",
  "\t}",
  "\tif err := redisotel.InstrumentMetrics(rdb); err != nil {",
  "\t\treturn nil, err",
  "\t}",
  "",
  '\titemsAdded, err := otel.Meter("carts").Int64Counter("cart.items_added",',
  '\t\tmetric.WithDescription("Items added to carts"))',
  "\tif err != nil {",
  "\t\treturn nil, err",
  "\t}",
  "",
  '\tpricingURL := os.Getenv("PRICING_API_URL")',
  '\tif pricingURL == "" {',
  '\t\tpricingURL = "http://localhost:9000"',
  "\t}",
  "",
  "\treturn &carts{",
  "\t\tredis:      rdb,",
  "\t\tpricing:    &http.Client{Transport: otelhttp.NewTransport(http.DefaultTransport)},",
  "\t\tpricingURL: pricingURL,",
  "\t\titemsAdded: itemsAdded,",
  "\t}, nil",
  "}",
  "",
  "func (s *carts) get(c fiber.Ctx) error {",
  "\t// c.Context() holds the request's span: pass it to every call.",
  "\tctx := c.Context()",
  '\tslog.InfoContext(ctx, "loading cart", "cart.id", c.Params("id"))',
  "",
  '\titems, err := s.redis.HGetAll(ctx, "cart:"+c.Params("id")).Result()',
  "\tif err != nil {",
  "\t\treturn err",
  "\t}",
  '\treturn c.JSON(fiber.Map{"id": c.Params("id"), "items": items})',
  "}",
  "",
  "func (s *carts) addItem(c fiber.Ctx) error {",
  "\tvar item struct {",
  '\t\tSKU      string `json:"sku"`',
  '\t\tQuantity int    `json:"quantity"`',
  "\t}",
  "\tif err := c.Bind().JSON(&item); err != nil {",
  '\t\treturn fiber.NewError(fiber.StatusBadRequest, "not an item")',
  "\t}",
  "",
  "\t// A span of your own, under the request's: the calls below nest beneath it.",
  '\tctx, span := tracer.Start(c.Context(), "cart.add_item")',
  "\tdefer span.End()",
  "\tspan.SetAttributes(",
  '\t\tattribute.String("cart.id", c.Params("id")),',
  '\t\tattribute.String("item.sku", item.SKU),',
  "\t)",
  "",
  "\tif err := s.checkPrice(ctx, item.SKU); err != nil {",
  "\t\treturn err",
  "\t}",
  '\terr := s.redis.HIncrBy(ctx, "cart:"+c.Params("id"), item.SKU, int64(item.Quantity)).Err()',
  "\tif err != nil {",
  "\t\treturn err",
  "\t}",
  "",
  "\ts.itemsAdded.Add(ctx, int64(item.Quantity))",
  '\treturn c.Status(fiber.StatusCreated).JSON(fiber.Map{"status": "added"})',
  "}",
  "",
  "func (s *carts) total(c fiber.Ctx) error {",
  "\tctx := c.Context()",
  '\titems, err := s.redis.HGetAll(ctx, "cart:"+c.Params("id")).Result()',
  "\tif err != nil {",
  "\t\treturn err",
  "\t}",
  "\tif len(items) == 0 {",
  "\t\t// Returned, so the middleware records it on the request's span.",
  '\t\treturn fmt.Errorf("cart %s has no items to total", c.Params("id"))',
  "\t}",
  "\tcount := 0",
  "\tfor _, quantity := range items {",
  "\t\tn, _ := strconv.Atoi(quantity)",
  "\t\tcount += n",
  "\t}",
  '\treturn c.JSON(fiber.Map{"items": count})',
  "}",
  "",
  "func (s *carts) checkPrice(ctx context.Context, sku string) error {",
  '\treq, err := http.NewRequestWithContext(ctx, http.MethodGet, s.pricingURL+"/api/prices/"+sku, nil)',
  "\tif err != nil {",
  "\t\treturn err",
  "\t}",
  "\tresp, err := s.pricing.Do(req)",
  "\tif err != nil {",
  "\t\treturn err",
  "\t}",
  "\tdefer resp.Body.Close()",
  "\tif resp.StatusCode >= 300 {",
  '\t\treturn fmt.Errorf("pricing answered %d", resp.StatusCode)',
  "\t}",
  "\treturn nil",
  "}",
].join("\n");

/*
 * The same handlers on Fiber v2: a *fiber.Ctx, the span's context in
 * UserContext, and BodyParser for the request's JSON.
 */
const cartsFileV2: string = cartsFile
  .split("c fiber.Ctx")
  .join("c *fiber.Ctx")
  .split("c.Context()")
  .join("c.UserContext()")
  .split("c.Bind().JSON(&item)")
  .join("c.BodyParser(&item)")
  .split('"github.com/gofiber/fiber/v3"')
  .join('"github.com/gofiber/fiber/v2"');

const newCarts: GuideSnippet = {
  id: "new-carts",
  language: "go",
  title: "carts.go",
  code: goDeclaration(cartsFile, "func newCarts("),
  check: "contained",
};

const getCart: GuideSnippet = {
  id: "get-cart",
  language: "go",
  title: "carts.go",
  code: goDeclaration(cartsFile, "func (s *carts) get("),
  check: "contained",
};

const addItem: GuideSnippet = {
  id: "add-item",
  language: "go",
  title: "carts.go",
  code: goDeclaration(cartsFile, "func (s *carts) addItem("),
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

const corrupted: GuideSnippet = {
  id: "corrupted",
  language: "text",
  title: "One run without Immutable",
  code: [
    'Logged:   msg="loading order" order.id=42',
    'Exported: loading order {"order.id": "x2"}',
  ].join("\n"),
  check: "illustrative",
};

const redis: VerificationService = {
  name: "redis",
  image: "redis:8.10.3-alpine",
  containerPort: 6379,
  appEnvironment: { REDIS_ADDR: "127.0.0.1:{port}" },
  readyLog: { text: "Ready to accept connections", times: 1 },
};

function commandsFor(install: string): Array<VerificationCommand> {
  return [
    { command: "go mod init example.com/carts" },
    { snippet: install },
    { command: "go get github.com/redis/go-redis/v9@v9.23.0" },
    { command: 'test -z "$(gofmt -l .)" && go vet ./...' },
    { snippet: "run", isServer: true },
  ];
}

function filesFor(main: string, carts: string): Array<VerificationFile> {
  return [
    { path: "otel.go", snippet: "otel-setup" },
    { path: "main.go", snippet: main },
    { path: "carts.go", content: carts },
  ];
}

const REQUESTS: Array<VerificationRequest> = [
  { method: "GET", path: "/healthz" },
  {
    method: "POST",
    path: "/carts/c1/items",
    body: { sku: "KETTLE-1", quantity: 2 },
  },
  { method: "GET", path: "/carts/c1" },
  { method: "GET", path: "/carts/c2" },
  { method: "GET", path: "/carts/empty/total" },
  { method: "GET", path: "/no-such-page" },
];

export const FiberGuide: OpenTelemetryGuide = {
  slug: "fiber",
  seo: {
    title: "Fiber OpenTelemetry: Go Tracing, Metrics & Logs | OneUptime",
    description:
      "Instrument a Go Fiber app with OpenTelemetry: Fiber's middleware, Redis commands, outgoing calls and errors, with Immutable to keep logs intact, in OneUptime.",
  },
  h1: "OpenTelemetry for Fiber",
  lead: "Trace every route of your Fiber app with the Redis commands and HTTP calls it makes, and send traces, metrics and logs to OneUptime. Add Fiber's OpenTelemetry middleware, pass `c.Context()` to every call, and turn on `Immutable`: Fiber reuses its buffers once a handler returns, and telemetry is sent after.",
  cardDescription:
    "Fiber v3 and v2 with Fiber's own middleware, Redis commands, outgoing calls, and values kept intact for export.",
  searchTerms: ["gofiber", "fasthttp", "otelfiber", "redis", "go-redis"],
  highlights: ["Fiber v3 and v2", "Immutable values", "Redis commands"],

  whatYouGet: {
    intro: `Each request Fiber routes becomes a trace under the service named by \`OTEL_SERVICE_NAME\`, and ${SCREENS.services} lists it from the first one. The example is a carts API that keeps carts in Redis and calls a pricing API before it adds an item.`,
    traces:
      "A server span per request named after its route, such as `GET /carts/:id`, with a span for each Redis command (`hgetall`, `hincrby`) and each call to the pricing API beneath it.",
    metrics:
      "Request duration and requests in flight by `http.route`, method and status, the pricing calls' duration, Redis's connection pool, and the Go runtime's memory and goroutines.",
    logs: "Each `slog` record written with `c.Context()`, carrying its request's trace and span IDs, with every attribute as the handler logged it.",
    exceptions: `Every error a handler returns is recorded on the request's span by the middleware, with its message, and reaches ${SCREENS.exceptions}; so is a panic, once \`recover\` has turned it into an error.`,
  },

  exampleTrace: {
    caption: "A POST /carts/:id/items request, as its trace shows it",
    spans: [
      {
        name: "POST /carts/:id/items",
        depth: 0,
        start: 0,
        duration: 100,
        source: "fiber",
      },
      {
        name: "cart.add_item",
        depth: 1,
        start: 5,
        duration: 90,
        source: "your code",
      },
      {
        name: "HTTP GET",
        depth: 2,
        start: 8,
        duration: 55,
        source: "otelhttp",
      },
      {
        name: "hincrby",
        depth: 2,
        start: 68,
        duration: 22,
        source: "redis",
      },
    ],
  },

  prerequisites: [
    GO_PREREQUISITE,
    "A Fiber app, on Fiber v3 or v2. These steps were checked with Fiber 3.6 and 2.52, go-redis 9.23 and Redis 8.10.",
    SERVER_KEY_PREREQUISITE,
  ],

  install: {
    intro:
      "Add the SDK and its exporters, Fiber's OpenTelemetry middleware for your major version, `otelhttp` for outgoing calls and `redisotel` for Redis, at the versions this guide was checked with:",
    snippets: [],
    tabs: {
      group: "version",
      tabs: [
        {
          label: "Fiber v3",
          snippets: [installV3],
        },
        {
          label: "Fiber v2",
          snippets: [installV2],
          notes: [
            "Fiber v2 is deprecated in favour of v3: `go get` says so as it installs it. Its middleware still works, with the older names below.",
          ],
        },
      ],
    },
    notes: [
      "Fiber runs on fasthttp, so `otelhttp.NewHandler` cannot wrap it: the middleware is the Fiber team's own, in `gofiber/contrib`. `otelhttp` still traces the calls your handlers make with `net/http`.",
    ],
  },

  configure: {
    intro:
      "The endpoint, the key and the service's name come from the standard variables, which the exporters read at start:",
    tabs: otlpEnvironmentTabs({ serviceName: "carts-api" }),
    notes: [
      "Fiber's middleware, `otelhttp` and `redisotel` all send through the global providers `setupOpenTelemetry` sets: none of them needs an endpoint of its own.",
    ],
  },

  setup: {
    intro:
      "Start the SDK before the app, make Fiber's values immutable, and add the middleware before the routes.",
    steps: [
      {
        title: "Add a file that starts OpenTelemetry",
        body: "One provider and OTLP exporter per signal, set as the globals the middleware, `otelhttp` and `redisotel` use. Keep the shutdown it returns for the end of `main`:",
        snippets: [otelSetup],
      },
      {
        title: "Add the middleware, and make the app Immutable",
        body: "Start OpenTelemetry first and defer its shutdown. Then create the app with `Immutable: true`, add the middleware first, and end with a handler that answers 404 itself:",
        tabs: {
          group: "version",
          tabs: [
            {
              label: "Fiber v3",
              snippets: [mainV3],
            },
            {
              label: "Fiber v2",
              snippets: [mainV2],
              notes: [
                "Fiber v2's middleware names a span after its route alone, such as `/carts/:id`, and sends the older `http.server.duration`, in milliseconds, in place of `http.server.request.duration`.",
              ],
            },
          ],
        },
        notes: [
          "Without `Immutable`, a string from `c.Params` or the body points into a buffer Fiber hands to the next request once the handler returns, and the log record or span that holds it is exported later: in a run made for this guide, an id logged as `42` was exported as `x2`.",
          "The middleware records every error a handler returns, so the router's own `Not Found` would be an exception on every unknown address: the last handler answers 404 without one.",
        ],
      },
      {
        title: "Run it",
        body: "With the variables above exported and `REDIS_ADDR` set, start the app:",
        snippets: [run],
      },
    ],
  },

  autoInstrumentation: {
    intro: "Each layer is traced by the instrumentation you set up for it:",
    rows: [
      {
        library: "Fiber's middleware",
        covers:
          "A server span per request named after its route (`GET /carts/:id`), with `http.route` and the status, every returned error recorded, and `http.server.request.duration` with `http.server.active_requests`.",
      },
      {
        library: "`redisotel`",
        covers:
          "A span per command (`hgetall`, `hincrby`), and the pool as `db.client.connections.*` metrics. A new connection adds its `redis.dial` and handshake spans.",
      },
      {
        library: "`otelhttp.NewTransport`",
        covers:
          "A client span per call to the pricing API, with `traceparent` sent along, and `http.client.request.duration`.",
      },
      {
        library: "`otelslog` and `runtime`",
        covers:
          "Each `slog` record with the trace and span IDs of the context it was written with, and the runtime's `go.*` metrics.",
      },
    ],
    snippets: [newCarts],
    notes: [
      "Instrument the Redis client once, as you create it. With open-source Redis, also turn off go-redis's maintenance notifications: the server refuses their handshake, and each new connection would record a failed `client` span with an exception:",
    ],
  },

  manualSpans: {
    intro:
      "Wrap work of your own in a span. In Fiber v3, `c.Context()` holds the request's span; start from it, and pass the `ctx` you get back to the calls inside:",
    snippets: [addItem],
    notes: [
      "On Fiber v2, the request's span is in `c.UserContext()`, not `c.Context()`, which is fasthttp's own context: a span started from it begins a trace of its own.",
      "A returned error, such as `pricing answered 503`, is recorded on the request's span by the middleware: there is nothing to add.",
      "Search the attributes in the **Traces** explorer, such as `@item.sku:KETTLE-1`.",
    ],
  },

  logs: {
    intro:
      "Log with `slog` and the request's context. With `Immutable` on, each record arrives with the values the handler logged, and with the request's trace and span IDs:",
    snippets: [getCart],
    notes: [
      "A record written with `slog.Info`, without the context, carries no trace ID.",
      "Fiber's own `logger` middleware writes to the console only: the middleware's spans and metrics already hold each request's route, status and duration.",
    ],
  },

  metrics: {
    intro:
      "Sent every 60 seconds by the SDK's periodic reader, and once more as the app stops:",
    builtIn: [
      {
        name: "http.server.request.duration",
        description:
          "Each request's duration by `http.route`, method and status, from Fiber's middleware; v2's is `http.server.duration`, in milliseconds.",
      },
      {
        name: "http.server.active_requests",
        description:
          "Requests in flight: a number that climbs while latency does is a backlog.",
      },
      {
        name: "db.client.connections.usage",
        description:
          "Redis connections idle and in use, beside `db.client.connections.waits` and `db.client.connections.timeouts`.",
      },
      {
        name: "http.client.request.duration",
        description: "Each call to the pricing API, by method and status.",
      },
    ],
    snippets: [],
    notes: [
      "`cart.items_added` counts items as they are added, from a counter `newCarts` creates once.",
      "Each replica sends its own series, and OneUptime adds them up in charts.",
    ],
  },

  sampling: {
    intro:
      "`WithNext` keeps health checks out of the middleware. To keep a share of everything else:",
    snippets: [sampling],
    notes: [
      "`parentbased_traceidratio` keeps a quarter of new traces, and follows the caller's decision for a request that carries a `traceparent` header.",
      "Sampling never touches metrics: a dropped trace's request is still counted in `http.server.request.duration`.",
    ],
  },

  deploy: {
    intro:
      "Build the app in the Go image, run it from a distroless one, and give it the key from a Kubernetes Secret:",
    snippets: [
      goDockerfileSnippet({ build: ".", binary: "carts-api", port: 8080 }),
      kubernetesManifestSnippet({
        name: "carts-api",
        image: "registry.example.com/carts-api:3.1.0",
        containerPort: 8080,
        extraEnv: [{ name: "REDIS_ADDR", value: "redis.default.svc:6379" }],
      }),
    ],
    notes: [
      "`app.Shutdown` lets the requests in flight finish on SIGTERM; then the deferred OpenTelemetry shutdown sends what is left.",
      "Put the Redis address in the Deployment, or in a Secret when it holds a password, beside the ingestion key's.",
    ],
  },

  verify: {
    intro: "Check in this order: each step rules out one cause.",
    steps: [
      validateKeyStep("server"),
      {
        title: "Find the service",
        body: `After a request to any route, ${SCREENS.services} lists \`carts-api\` within a minute.`,
      },
      {
        title: "Open a request's trace",
        body: `In ${SCREENS.traces}, search \`@http.route:/carts/:id/items\`: \`cart.add_item\` holds the pricing call and the \`hincrby\`.`,
      },
      {
        title: "Check a logged value",
        body: `In ${SCREENS.logs}, the \`loading cart\` record of \`/carts/c1\` reads \`cart.id\` \`c1\`, as it was logged. A value from another request means \`Immutable\` is off.`,
      },
    ],
  },

  troubleshooting: [
    {
      question: "Log attributes hold another request's values, or garbage",
      answer:
        "`Immutable` is off. Fiber hands a handler's buffers to the next request once it returns, while the log record or span holding a string from them is exported later. Set `Immutable: true`, or copy each value with `strings.Clone` before you log it:",
      snippets: [corrupted],
    },
    {
      question: "Spans from my handlers start traces of their own",
      answer:
        "They started from a context without the request's span. On Fiber v3 use `c.Context()`; on v2 `c.UserContext()`, since v2's `c.Context()` is fasthttp's request context.",
    },
    {
      question: "Every 404 is an exception in OneUptime",
      answer:
        "The router's `Not Found` is an error returned through the middleware, which records it. End the app with a handler that answers 404 itself, as `main.go` does, and only your own errors are recorded.",
    },
    {
      question: "Each new Redis connection records a failed client command",
      answer:
        "go-redis asks the server for maintenance notifications as it connects, and open-source Redis answers `ERR unknown subcommand 'maint_notifications'`. Set `MaintNotificationsConfig` to `ModeDisabled`, as `newCarts` does.",
    },
    {
      question: "Nothing arrives, and the console shows export errors",
      answer:
        "`connection refused` on `localhost:4318` means `OTEL_EXPORTER_OTLP_ENDPOINT` did not reach the process; a `401 Unauthorized`, that OneUptime refused the key.",
    },
  ],

  faq: [
    {
      question: "Why not otelhttp, as for net/http?",
      answer:
        "Fiber is built on fasthttp, whose requests are not `net/http`'s: `otelhttp.NewHandler` has nothing to wrap. Fiber's middleware does the same job, with the same span and metric names on v3.",
    },
    {
      question: "Does Immutable cost much?",
      answer:
        "It copies each value Fiber hands a handler, where it would otherwise point into a reused buffer: a small allocation per value, and the price of telemetry that says what happened.",
    },
    {
      question: "Should I move to Fiber v3?",
      answer:
        "Fiber v2 is deprecated, and its middleware sends the older span names and metrics. Both tabs above ran end to end, so move when it suits you; the tracing moves with an import and the handlers' signatures.",
    },
    {
      question: "Do I need an OpenTelemetry Collector?",
      answer:
        "No: the app sends straight to OneUptime. A Collector helps when many services should send through one place: see [OpenTelemetry](/docs/telemetry/open-telemetry).",
    },
  ],

  related: ["go", "gin", "echo", "grpc"],
  docs: [DOCS.openTelemetry, DOCS.traces, DOCS.logs, DOCS.metrics],

  verification: {
    runtime: "go",
    framework: { name: "Fiber", package: "github.com/gofiber/fiber/v3" },
    services: [redis],
    files: filesFor("main-v3", cartsFile),
    stubApiPort: 9000,
    commands: commandsFor("install-v3"),
    port: 8080,
    requests: REQUESTS,
    expect: {
      spans: [
        {
          name: "POST /carts/:id/items",
          attributes: { "http.route": "/carts/:id/items" },
        },
        {
          name: "cart.add_item",
          attributes: { "cart.id": "c1", "item.sku": "KETTLE-1" },
          parent: "POST /carts/:id/items",
        },
        { name: "HTTP GET", parent: "cart.add_item" },
        { name: "hincrby", parent: "cart.add_item" },
        { name: "hgetall", parent: "GET /carts/:id" },
        {
          name: "GET /carts/:id/total",
          hasException: true,
          exceptionMessage: "cart empty has no items to total",
        },
        // The 404 the last handler sends: a span, and no exception.
        { name: "GET", hasException: false },
      ],
      metrics: [
        "http.server.request.duration",
        "http.server.active_requests",
        "http.client.request.duration",
        "db.client.connections.usage",
        "cart.items_added",
      ],
      logs: [
        {
          body: "loading cart",
          hasTraceContext: true,
          attributes: { "cart.id": "c1" },
        },
        {
          body: "loading cart",
          hasTraceContext: true,
          attributes: { "cart.id": "c2" },
        },
      ],
      resource: { "service.name": "carts-api" },
      untracedPaths: ["/healthz"],
      absentSpans: ["client"],
    },
    variants: [
      {
        name: "Fiber v2",
        services: [redis],
        files: filesFor("main-v2", cartsFileV2),
        stubApiPort: 9000,
        commands: commandsFor("install-v2"),
        port: 8080,
        requests: REQUESTS,
        expect: {
          spans: [
            {
              name: "/carts/:id/items",
              attributes: { "http.route": "/carts/:id/items" },
            },
            { name: "cart.add_item", parent: "/carts/:id/items" },
            { name: "hincrby", parent: "cart.add_item" },
            {
              name: "/carts/:id/total",
              hasException: true,
              exceptionMessage: "cart empty has no items to total",
            },
          ],
          metrics: ["http.server.duration", "cart.items_added"],
          logs: [
            {
              body: "loading cart",
              hasTraceContext: true,
              attributes: { "cart.id": "c1" },
            },
          ],
          resource: { "service.name": "carts-api" },
          untracedPaths: ["/healthz"],
        },
      },
    ],
  },
};
