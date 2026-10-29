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
  pinnedGoModule,
} from "../GoShared";

/*
 * A gRPC orders service in Go, and the checkout API that calls it. otelgrpc's
 * stats handlers trace both ends of every call, so one trace runs from the
 * HTTP request through the RPC into the server's own work; an interceptor
 * records the errors that are the server's fault and keeps a handler's
 * panic from stopping the server, which grpc-go does not.
 */

const install: GuideSnippet = goGetSnippet("install", [
  ...GO_SDK_MODULES,
  "google.golang.org/grpc",
  "go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc",
  "go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp",
]);

const otelSetup: GuideSnippet = goSetupSnippet({
  packageName: "telemetry",
  title: "telemetry/otel.go",
  functionName: "Setup",
});

const proto: GuideSnippet = {
  id: "proto",
  language: "protobuf",
  title: "proto/orders/v1/orders.proto",
  code: [
    'syntax = "proto3";',
    "",
    "package orders.v1;",
    "",
    'option go_package = "example.com/orders/gen/orders/v1;ordersv1";',
    "",
    "service Orders {",
    "  rpc GetOrder(GetOrderRequest) returns (Order);",
    "  rpc PlaceOrder(PlaceOrderRequest) returns (Order);",
    "}",
    "",
    "message GetOrderRequest {",
    "  int64 id = 1;",
    "}",
    "",
    "message PlaceOrderRequest {",
    "  repeated string items = 1;",
    "  string payment_method = 2;",
    "}",
    "",
    "message Order {",
    "  int64 id = 1;",
    "  int32 item_count = 2;",
    "  string status = 3;",
    "}",
  ].join("\n"),
  check: "run",
};

const generate: GuideSnippet = {
  id: "generate",
  language: "bash",
  code: [
    `go install ${pinnedGoModule("google.golang.org/protobuf/cmd/protoc-gen-go")}`,
    `go install ${pinnedGoModule("google.golang.org/grpc/cmd/protoc-gen-go-grpc")}`,
    "protoc -I proto --go_out=. --go_opt=module=example.com/orders \\",
    "  --go-grpc_out=. --go-grpc_opt=module=example.com/orders \\",
    "  proto/orders/v1/orders.proto",
  ].join("\n"),
  check: "run",
};

const serverMain: GuideSnippet = {
  id: "server-main",
  language: "go",
  title: "cmd/orders/main.go",
  code: [
    "package main",
    "",
    "import (",
    '\t"context"',
    '\t"log/slog"',
    '\t"net"',
    '\t"net/http"',
    '\t"os"',
    '\t"os/signal"',
    '\t"syscall"',
    "",
    '\tordersv1 "example.com/orders/gen/orders/v1"',
    '\t"example.com/orders/telemetry"',
    '\t"go.opentelemetry.io/contrib/bridges/otelslog"',
    '\t"go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc"',
    '\t"go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc/filters"',
    '\t"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"',
    '\t"google.golang.org/grpc"',
    '\t"google.golang.org/grpc/health"',
    '\t"google.golang.org/grpc/health/grpc_health_v1"',
    ")",
    "",
    "func main() {",
    "\tctx, stop := signal.NotifyContext(context.Background(),",
    "\t\tos.Interrupt, syscall.SIGTERM)",
    "\tdefer stop()",
    "",
    "\tshutdown, err := telemetry.Setup(ctx)",
    "\tif err != nil {",
    '\t\tslog.Error("could not start OpenTelemetry", "error", err)',
    "\t\tos.Exit(1)",
    "\t}",
    "\t// Deferred first, so it runs last: it sends what is still buffered.",
    "\tdefer shutdown(context.Background())",
    "",
    "\tslog.SetDefault(slog.New(slog.NewMultiHandler(",
    "\t\tslog.NewTextHandler(os.Stdout, nil),",
    '\t\totelslog.NewHandler("orders"),',
    "\t)))",
    "",
    "\tserver := grpc.NewServer(",
    "\t\t// A server span and the call metrics for every RPC, health checks aside.",
    "\t\tgrpc.StatsHandler(otelgrpc.NewServerHandler(",
    "\t\t\totelgrpc.WithFilter(filters.Not(filters.HealthCheck())),",
    "\t\t)),",
    "\t\tgrpc.ChainUnaryInterceptor(recordErrors),",
    "\t)",
    "\tordersv1.RegisterOrdersServer(server, &ordersServer{",
    "\t\tpayments: &http.Client{Transport: otelhttp.NewTransport(http.DefaultTransport)},",
    "\t})",
    "\tgrpc_health_v1.RegisterHealthServer(server, health.NewServer())",
    "",
    '\tlistener, err := net.Listen("tcp", ":50051")',
    "\tif err != nil {",
    '\t\tslog.Error("could not listen", "error", err)',
    "\t\treturn",
    "\t}",
    "\tgo func() {",
    "\t\t// On SIGTERM, finish the calls in flight; the deferred shutdown then flushes.",
    "\t\t<-ctx.Done()",
    "\t\tserver.GracefulStop()",
    "\t}()",
    '\tslog.Info("orders service listening on :50051")',
    "\tif err := server.Serve(listener); err != nil {",
    '\t\tslog.Error("server stopped", "error", err)',
    "\t}",
    "}",
  ].join("\n"),
  check: "run",
};

const interceptors: GuideSnippet = {
  id: "interceptors",
  language: "go",
  title: "cmd/orders/interceptors.go",
  code: [
    "package main",
    "",
    "import (",
    '\t"context"',
    '\t"fmt"',
    '\t"log/slog"',
    "",
    '\t"go.opentelemetry.io/otel/trace"',
    '\t"google.golang.org/grpc"',
    '\t"google.golang.org/grpc/codes"',
    '\t"google.golang.org/grpc/status"',
    ")",
    "",
    "// recordErrors records on the call's span the errors that are the server's",
    "// fault, so they reach OneUptime's Exceptions, and turns a handler's panic",
    "// into an Internal error: grpc-go recovers none, and one would stop the",
    "// whole server.",
    "func recordErrors(ctx context.Context, request any, info *grpc.UnaryServerInfo,",
    "\thandler grpc.UnaryHandler) (response any, err error) {",
    "\tspan := trace.SpanFromContext(ctx)",
    "\tdefer func() {",
    "\t\tif recovered := recover(); recovered != nil {",
    '\t\t\tpanicked := fmt.Errorf("panic: %v", recovered)',
    "\t\t\tspan.RecordError(panicked, trace.WithStackTrace(true))",
    '\t\t\tslog.ErrorContext(ctx, "call panicked", "rpc.method", info.FullMethod,',
    '\t\t\t\t"error", panicked)',
    "\t\t\terr = status.Error(codes.Internal, panicked.Error())",
    "\t\t}",
    "\t}()",
    "",
    "\tresponse, err = handler(ctx, request)",
    "\tswitch status.Code(err) {",
    "\tcase codes.Unknown, codes.Internal, codes.Unavailable, codes.DataLoss:",
    "\t\tspan.RecordError(err)",
    "\t}",
    "\treturn response, err",
    "}",
  ].join("\n"),
  check: "run",
};

// The service's methods: GetOrder, and PlaceOrder with a span of its own.
const serverFile: string = [
  "package main",
  "",
  "import (",
  '\t"context"',
  '\t"fmt"',
  '\t"log/slog"',
  '\t"net/http"',
  '\t"os"',
  "",
  '\tordersv1 "example.com/orders/gen/orders/v1"',
  '\t"go.opentelemetry.io/otel"',
  '\t"go.opentelemetry.io/otel/attribute"',
  '\t"go.opentelemetry.io/otel/metric"',
  '\t"google.golang.org/grpc/codes"',
  '\t"google.golang.org/grpc/status"',
  ")",
  "",
  "var (",
  '\ttracer          = otel.Tracer("orders")',
  '\tordersPlaced, _ = otel.Meter("orders").Int64Counter("orders.placed",',
  '\t\tmetric.WithDescription("Orders placed, by payment method"))',
  ")",
  "",
  "type ordersServer struct {",
  "\tordersv1.UnimplementedOrdersServer",
  "\tpayments *http.Client",
  "}",
  "",
  "func (s *ordersServer) GetOrder(ctx context.Context,",
  "\trequest *ordersv1.GetOrderRequest) (*ordersv1.Order, error) {",
  '\tslog.InfoContext(ctx, "loading order", "order.id", request.GetId())',
  "\tif request.GetId() != 42 {",
  "\t\t// The caller's mistake, not the server's: no exception for it.",
  '\t\treturn nil, status.Errorf(codes.NotFound, "no order %d", request.GetId())',
  "\t}",
  '\treturn &ordersv1.Order{Id: 42, ItemCount: 2, Status: "placed"}, nil',
  "}",
  "",
  "func (s *ordersServer) PlaceOrder(ctx context.Context,",
  "\trequest *ordersv1.PlaceOrderRequest) (*ordersv1.Order, error) {",
  "\t// A span of your own, under the call's: the payment below nests beneath it.",
  '\tctx, span := tracer.Start(ctx, "orders.charge")',
  "\tdefer span.End()",
  "\tspan.SetAttributes(",
  '\t\tattribute.Int("order.item_count", len(request.GetItems())),',
  '\t\tattribute.String("payment.method", request.GetPaymentMethod()),',
  "\t)",
  "",
  "\t// An order with no items panics here: recordErrors turns it into Internal.",
  '\tslog.InfoContext(ctx, "charging", "first.item", request.GetItems()[0])',
  "\tif err := s.charge(ctx); err != nil {",
  '\t\treturn nil, status.Errorf(codes.Unavailable, "charge failed: %v", err)',
  "\t}",
  "",
  "\tordersPlaced.Add(ctx, 1, metric.WithAttributes(",
  '\t\tattribute.String("payment.method", request.GetPaymentMethod())))',
  "\treturn &ordersv1.Order{Id: 43, ItemCount: int32(len(request.GetItems())),",
  '\t\tStatus: "placed"}, nil',
  "}",
  "",
  "func (s *ordersServer) charge(ctx context.Context) error {",
  '\tpaymentsURL := os.Getenv("PAYMENTS_API_URL")',
  '\tif paymentsURL == "" {',
  '\t\tpaymentsURL = "http://localhost:9000"',
  "\t}",
  "\treq, err := http.NewRequestWithContext(ctx, http.MethodPost,",
  '\t\tpaymentsURL+"/api/charges", nil)',
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
].join("\n");

// The client side: how the checkout API dials the orders service.
const clientLines: Array<string> = [
  "\t// A client span for every call, with the trace sent along to the server.",
  '\tconn, err := grpc.NewClient("localhost:50051",',
  "\t\tgrpc.WithTransportCredentials(insecure.NewCredentials()),",
  "\t\tgrpc.WithStatsHandler(otelgrpc.NewClientHandler()),",
  "\t)",
];

// The checkout API: an HTTP gateway in front of the service, not shown whole.
const gatewayFile: string = [
  "// The checkout API: an HTTP gateway in front of the orders service.",
  "package main",
  "",
  "import (",
  '\t"context"',
  '\t"encoding/json"',
  '\t"errors"',
  '\t"log/slog"',
  '\t"net/http"',
  '\t"os"',
  '\t"os/signal"',
  '\t"strconv"',
  '\t"syscall"',
  '\t"time"',
  "",
  '\tordersv1 "example.com/orders/gen/orders/v1"',
  '\t"example.com/orders/telemetry"',
  '\t"go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc"',
  '\t"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"',
  '\t"google.golang.org/grpc"',
  '\t"google.golang.org/grpc/credentials/insecure"',
  '\t"google.golang.org/grpc/status"',
  ")",
  "",
  "func main() {",
  "\tctx, stop := signal.NotifyContext(context.Background(),",
  "\t\tos.Interrupt, syscall.SIGTERM)",
  "\tdefer stop()",
  "",
  "\tshutdown, err := telemetry.Setup(ctx)",
  "\tif err != nil {",
  '\t\tslog.Error("could not start OpenTelemetry", "error", err)',
  "\t\tos.Exit(1)",
  "\t}",
  "\tdefer shutdown(context.Background())",
  "",
  ...clientLines,
  "\tif err != nil {",
  '\t\tslog.Error("could not reach the orders service", "error", err)',
  "\t\treturn",
  "\t}",
  "\tdefer conn.Close()",
  "\torders := ordersv1.NewOrdersClient(conn)",
  "",
  "\tmux := http.NewServeMux()",
  '\tmux.HandleFunc("GET /orders/{id}", func(w http.ResponseWriter, r *http.Request) {',
  '\t\tid, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)',
  "\t\torder, err := orders.GetOrder(r.Context(), &ordersv1.GetOrderRequest{Id: id})",
  "\t\tif err != nil {",
  "\t\t\thttp.Error(w, status.Convert(err).Message(), http.StatusNotFound)",
  "\t\t\treturn",
  "\t\t}",
  "\t\tjson.NewEncoder(w).Encode(order)",
  "\t})",
  '\tmux.HandleFunc("POST /orders", func(w http.ResponseWriter, r *http.Request) {',
  "\t\tvar request ordersv1.PlaceOrderRequest",
  "\t\tjson.NewDecoder(r.Body).Decode(&request)",
  "\t\torder, err := orders.PlaceOrder(r.Context(), &request)",
  "\t\tif err != nil {",
  "\t\t\thttp.Error(w, status.Convert(err).Message(), http.StatusBadGateway)",
  "\t\t\treturn",
  "\t\t}",
  "\t\tw.WriteHeader(http.StatusCreated)",
  "\t\tjson.NewEncoder(w).Encode(order)",
  "\t})",
  "",
  '\tserver := &http.Server{Addr: ":8080", Handler: otelhttp.NewHandler(mux, "checkout-api")}',
  "\tgo func() {",
  "\t\terr := server.ListenAndServe()",
  "\t\tif err != nil && !errors.Is(err, http.ErrServerClosed) {",
  '\t\t\tslog.Error("server stopped", "error", err)',
  "\t\t}",
  "\t}()",
  "\t<-ctx.Done()",
  "\tstopCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)",
  "\tdefer cancel()",
  "\tserver.Shutdown(stopCtx)",
  "}",
].join("\n");

const client: GuideSnippet = {
  id: "client",
  language: "go",
  title: "The client, in the service that calls it",
  code: clientLines.join("\n"),
  check: "contained",
};

const placeOrder: GuideSnippet = {
  id: "place-order",
  language: "go",
  title: "cmd/orders/server.go",
  code: goDeclaration(serverFile, "func (s *ordersServer) PlaceOrder("),
  check: "contained",
};

const getOrder: GuideSnippet = {
  id: "get-order",
  language: "go",
  title: "cmd/orders/server.go",
  code: goDeclaration(serverFile, "func (s *ordersServer) GetOrder("),
  check: "contained",
};

const run: GuideSnippet = {
  id: "run",
  language: "bash",
  code: "go run ./cmd/orders",
  check: "run",
};

const sampling: GuideSnippet = {
  id: "sampling",
  language: "bash",
  code: [
    'export OTEL_TRACES_SAMPLER="parentbased_traceidratio"',
    'export OTEL_TRACES_SAMPLER_ARG="0.5"',
  ].join("\n"),
  check: "parse",
};

export const GrpcGuide: OpenTelemetryGuide = {
  slug: "grpc",
  seo: {
    title: "gRPC Go OpenTelemetry: Tracing RPCs End to End | OneUptime",
    description:
      "Trace gRPC services in Go with OpenTelemetry's otelgrpc: one trace across client and server, call metrics, status codes, panics and errors, sent to OneUptime.",
  },
  h1: "OpenTelemetry for gRPC in Go",
  lead: "Follow every RPC from the service that calls it into the one that answers it, as one trace, and send both services' traces, metrics and logs to OneUptime. Add `otelgrpc`'s stats handler to your server and your client, and an interceptor that records server faults and keeps one panic from stopping the server.",
  cardDescription:
    "gRPC servers and clients in Go with otelgrpc: one trace across both ends, call metrics, and the server's faults as exceptions.",
  searchTerms: [
    "grpc-go",
    "otelgrpc",
    "protobuf",
    "rpc",
    "interceptor",
    "microservices",
  ],
  highlights: ["Client and server", "Stats handlers", "Panics recovered"],

  whatYouGet: {
    intro: `The service answering the calls and each service calling it report under their own \`OTEL_SERVICE_NAME\`, and ${SCREENS.services} lists them both, each call joining the two in one trace. The example is an orders service on gRPC and the checkout API in front of it.`,
    traces:
      "A client span in the caller and a server span in the service for each RPC, both named after its method (`orders.v1.Orders/PlaceOrder`) and joined in one trace, with your own spans and the calls the service makes beneath.",
    metrics:
      "`rpc.server.call.duration` and `rpc.client.call.duration` by method and status code, beside the HTTP calls the service makes and the Go runtime's memory and goroutines.",
    logs: "Each `slog` record a method writes with its call's context, with the call's trace and span IDs: one search shows the logs of the whole trace, across both services.",
    exceptions: `A status error that is the server's fault (\`Internal\`, \`Unknown\`, \`Unavailable\`, \`DataLoss\`) and a panic the interceptor recovers are recorded on the call's span, and land in ${SCREENS.exceptions}; a \`NotFound\` or \`InvalidArgument\` is the caller's.`,
  },

  exampleTrace: {
    caption:
      "A POST /orders request, through the gateway into the orders service",
    spans: [
      {
        name: "POST /orders",
        depth: 0,
        start: 0,
        duration: 100,
        source: "otelhttp",
      },
      {
        name: "orders.v1.Orders/PlaceOrder",
        depth: 1,
        start: 4,
        duration: 92,
        source: "client",
      },
      {
        name: "orders.v1.Orders/PlaceOrder",
        depth: 2,
        start: 8,
        duration: 84,
        source: "server",
      },
      {
        name: "orders.charge",
        depth: 3,
        start: 11,
        duration: 77,
        source: "your code",
      },
      {
        name: "HTTP POST",
        depth: 4,
        start: 14,
        duration: 70,
        source: "otelhttp",
      },
    ],
  },

  prerequisites: [
    GO_PREREQUISITE,
    "A gRPC service in Go, generated from its `.proto` with `protoc` and the Go plugins. These steps were checked with grpc-go 1.85 and `protoc` 3.21.",
    SERVER_KEY_PREREQUISITE,
  ],

  install: {
    intro:
      "Add the SDK and its exporters, grpc-go, `otelgrpc` for both ends of each call, and `otelhttp` for the HTTP calls the service makes, at the versions this guide was checked with:",
    snippets: [install],
    notes: [
      "`otelgrpc` instruments through grpc-go's stats handlers, the API grpc-go recommends; its older interceptors were removed, so a guide that adds `otelgrpc.UnaryServerInterceptor()` no longer builds.",
    ],
  },

  configure: {
    intro:
      "Each program reads the standard variables, so every service needs the same three, with its own name:",
    tabs: otlpEnvironmentTabs({ serviceName: "orders" }),
    notes: [
      "Give each service its own `OTEL_SERVICE_NAME`: the orders service is `orders`, the checkout API that calls it `checkout-api`. A trace then shows which service spent which part of the time.",
    ],
  },

  setup: {
    intro:
      "Generate the code as usual, start OpenTelemetry in each program, then add a stats handler to the server and to every client.",
    steps: [
      {
        title: "Generate the service from its .proto",
        body: "Nothing in the `.proto` or the generated code changes for OpenTelemetry: the stats handlers see every call whatever it carries.",
        snippets: [proto, generate],
      },
      {
        title: "Share one file that starts OpenTelemetry",
        body: "Every program in the module starts the SDK the same way: put the setup in a package of its own, `telemetry`, and call `telemetry.Setup` from each `main`:",
        snippets: [otelSetup],
      },
      {
        title: "Add the stats handler to the server",
        body: "`otelgrpc.NewServerHandler` makes a span and the call metrics for each RPC; the filter leaves out the health checks your load balancer sends. Chain the interceptor below beside it:",
        snippets: [serverMain],
      },
      {
        title: "Record server faults and recover panics",
        body: "A status code marks a call failed, but records no exception, and grpc-go never recovers a panic: a nil pointer in one handler would stop the server and every call in flight. This interceptor does both:",
        snippets: [interceptors],
      },
      {
        title: "Add the stats handler to every client",
        body: "In each service that calls this one, pass `otelgrpc.NewClientHandler()` as the connection's stats handler. It sends the trace along with each call, so the server's span joins the caller's trace:",
        snippets: [client],
      },
      {
        title: "Run it",
        body: "Start the service with the variables above exported:",
        snippets: [run],
      },
    ],
  },

  autoInstrumentation: {
    intro:
      "Between the two stats handlers and `otelhttp`, a call's trace holds:",
    rows: [
      {
        library: "`otelgrpc.NewServerHandler`",
        covers:
          "A server span per call named after the full method, with `rpc.method`, `rpc.system.name` and `rpc.response.status_code` (`OK`, `NOT_FOUND`, `INTERNAL`), and `rpc.server.call.duration`.",
      },
      {
        library: "`otelgrpc.NewClientHandler`",
        covers:
          "A client span per call in the caller, with the server's address, its trace context sent in the call's metadata, and `rpc.client.call.duration`.",
      },
      {
        library: "`otelhttp.NewTransport`",
        covers:
          "A client span for each HTTP call the service makes, such as the payments API, nested under the RPC that made it.",
      },
      {
        library: "`otelslog` and `runtime`",
        covers:
          "Each `slog` record with its call's trace and span IDs, and the Go runtime's `go.*` metrics.",
      },
    ],
    snippets: [],
    notes: [
      "A server span is failed only for codes that are the server's fault (`Unknown`, `DeadlineExceeded`, `Unimplemented`, `Internal`, `Unavailable`, `DataLoss`); the client's span is failed for any code but `OK`.",
    ],
  },

  manualSpans: {
    intro:
      "Inside a method, the call's context holds the server span: start your own spans from it, and pass the context they return on, as `PlaceOrder` does around its payment:",
    snippets: [placeOrder],
    notes: [
      "A panic inside your own span is recorded on that span too, as it unwinds through its deferred `span.End`: the trace shows where it happened.",
      "Search the attributes in the **Traces** explorer, such as `@payment.method:card`.",
    ],
  },

  logs: {
    intro:
      "Log with `slog`'s `...Context` functions and the method's context, and each record carries the call's trace and span IDs:",
    snippets: [getOrder],
    notes: [
      "A `NotFound` the method returns is the caller's mistake: the server span keeps an unset status, and nothing reaches Exceptions.",
      "The interceptor logs a panic with `slog.ErrorContext` and the error as an attribute, which arrives as `exception.message` and `exception.type`, with `rpc.method` beside them.",
    ],
  },

  metrics: {
    intro:
      "Exported every 60 seconds by each program, and once more as it shuts down:",
    builtIn: [
      {
        name: "rpc.server.call.duration",
        description:
          "Each call's duration on the server, by `rpc.method` and `rpc.response.status_code`: the latency and error rate of every method.",
      },
      {
        name: "rpc.client.call.duration",
        description:
          "The same calls as the caller saw them, the network included, with `error.type` for a failed one.",
      },
      {
        name: "http.client.request.duration",
        description:
          "The HTTP calls the service makes, such as the payments API.",
      },
      {
        name: "go.goroutine.count",
        description:
          "Goroutines the server runs: each open stream and call in flight holds some, so a count that keeps growing is calls that never end.",
      },
    ],
    snippets: [],
    notes: [
      "`orders.placed` counts placed orders by payment method, from a counter created once at package level.",
      "Each instance of a service sends its own series, which OneUptime adds up in charts.",
    ],
  },

  sampling: {
    intro:
      "Health checks are filtered out on the server. For a busy service, keep a share of new traces:",
    snippets: [sampling],
    notes: [
      "`parentbased_traceidratio` keeps half of the traces a service starts, and follows the caller for a call that arrives with a sampled trace, so a trace is kept or dropped as a whole, across services.",
      "The call metrics count every call, sampled or not.",
    ],
  },

  deploy: {
    intro:
      "Build the service from its `cmd/orders` package and run it from a distroless image, with the key in a Kubernetes Secret:",
    snippets: [
      goDockerfileSnippet({
        build: "./cmd/orders",
        binary: "orders",
        port: 50051,
      }),
      kubernetesManifestSnippet({
        name: "orders",
        image: "registry.example.com/orders:1.8.0",
        containerPort: 50051,
      }),
    ],
    notes: [
      "Point Kubernetes' gRPC probe (`grpc: { port: 50051 }`) at the health service the server registers: the filter keeps those checks out of the traces.",
      "`GracefulStop` waits for the calls in flight on SIGTERM; then the deferred shutdown sends the last spans, metrics and logs.",
    ],
  },

  verify: {
    intro: "Check in this order: each step rules out one cause.",
    steps: [
      validateKeyStep("server"),
      {
        title: "Find both services",
        body: `Make a call through the checkout API, then open ${SCREENS.services}: \`orders\` and \`checkout-api\` are listed within a minute.`,
      },
      {
        title: "Open one call's trace",
        body: `In ${SCREENS.traces}, search \`@rpc.method:orders.v1.Orders/PlaceOrder\`: the client's span and the server's sit in one trace, with \`orders.charge\` and the payments call beneath the server's.`,
      },
      {
        title: "Find the recovered panic",
        body: `Place an order with no items: ${SCREENS.exceptions} lists \`panic: runtime error: index out of range [0] with length 0\` on the call's span, and the caller got an \`Internal\` error instead of a broken connection.`,
      },
    ],
  },

  troubleshooting: [
    {
      question: "The client's and the server's spans are separate traces",
      answer:
        "One end has no stats handler: the client sends no trace context without `otelgrpc.NewClientHandler()`, and the server reads none without `NewServerHandler()`. Both ends also need the W3C propagator, which `telemetry.Setup` sets.",
    },
    {
      question: "A panic in one handler stopped the whole server",
      answer:
        "grpc-go does not recover panics in handlers: chain `recordErrors`, or another recovery interceptor, on the server, and a stream interceptor for streaming methods.",
    },
    {
      question: "Failed calls have no exception in OneUptime",
      answer:
        "A status error only sets the span's status. `recordErrors` records the codes that are the server's fault; add a code to its `switch` if your service uses another for its own failures.",
    },
    {
      question: "otelgrpc.UnaryServerInterceptor is undefined",
      answer:
        "The interceptors were removed from `otelgrpc` in favour of the stats handlers: use `grpc.StatsHandler(otelgrpc.NewServerHandler())` on the server and `grpc.WithStatsHandler(otelgrpc.NewClientHandler())` on clients.",
    },
    {
      question: "Nothing arrives, and the program logs export errors",
      answer:
        "Read the error: `connection refused` to `localhost:4318` means `OTEL_EXPORTER_OTLP_ENDPOINT` is not in that program's environment, and `401 Unauthorized` that OneUptime refused its key. Each service needs the variables of its own.",
    },
  ],

  faq: [
    {
      question: "Does the OTLP exporter use gRPC too?",
      answer:
        "Not here: the exporters send OTLP over HTTP to `/otlp`, whatever your service speaks. Your service's own gRPC traffic is unaffected by them.",
    },
    {
      question: "Can I see the request and response messages?",
      answer:
        "Not by default, and on purpose: messages often hold personal data. Set the attributes you need on the span yourself, as `PlaceOrder` sets the payment method.",
    },
    {
      question: "What about gRPC services in other languages?",
      answer:
        "Their OpenTelemetry SDKs instrument gRPC too, and the W3C trace context they send is the same, so a Go client and a Java or Python server share one trace.",
    },
    {
      question: "Do I need an OpenTelemetry Collector?",
      answer:
        "No: each service sends straight to OneUptime. A Collector helps when many services should export through one place: see [OpenTelemetry](/docs/telemetry/open-telemetry).",
    },
  ],

  related: ["go", "gin", "echo", "fiber"],
  docs: [DOCS.openTelemetry, DOCS.traces, DOCS.services, DOCS.exceptions],

  verification: {
    runtime: "go",
    framework: { name: "gRPC", package: "google.golang.org/grpc" },
    files: [
      { path: "proto/orders/v1/orders.proto", snippet: "proto" },
      { path: "telemetry/otel.go", snippet: "otel-setup" },
      { path: "cmd/orders/main.go", snippet: "server-main" },
      { path: "cmd/orders/interceptors.go", snippet: "interceptors" },
      { path: "cmd/orders/server.go", content: serverFile },
      { path: "cmd/gateway/main.go", content: gatewayFile },
    ],
    stubApiPort: 9000,
    commands: [
      // protoc itself, from Debian: what a gRPC project's machine already has.
      {
        command:
          "apt-get update -qq && apt-get install -y -qq protobuf-compiler > /dev/null",
      },
      { command: "go mod init example.com/orders" },
      { snippet: "generate" },
      { snippet: "install" },
      { command: 'test -z "$(gofmt -l cmd telemetry)" && go vet ./...' },
      {
        snippet: "run",
        isServer: true,
        readyText: "orders service listening",
      },
      {
        command: "go run ./cmd/gateway",
        isServer: true,
        environment: { OTEL_SERVICE_NAME: "checkout-api" },
      },
    ],
    port: 8080,
    requests: [
      { method: "GET", path: "/orders/42" },
      { method: "GET", path: "/orders/7" },
      {
        method: "POST",
        path: "/orders",
        body: { items: ["kettle", "mug"], payment_method: "card" },
      },
      {
        method: "POST",
        path: "/orders",
        body: { items: [], payment_method: "card" },
      },
      // The server still answers after the panic it recovered.
      { method: "GET", path: "/orders/42" },
    ],
    expect: {
      spans: [
        {
          name: "orders.v1.Orders/GetOrder",
          attributes: { "rpc.response.status_code": "NOT_FOUND" },
        },
        {
          name: "orders.v1.Orders/PlaceOrder",
          parent: "orders.v1.Orders/PlaceOrder",
        },
        {
          name: "orders.charge",
          attributes: { "payment.method": "card", "order.item_count": "2" },
          parent: "orders.v1.Orders/PlaceOrder",
        },
        { name: "HTTP POST", parent: "orders.charge" },
        {
          name: "orders.v1.Orders/PlaceOrder",
          hasException: true,
          exceptionMessage: "panic: runtime error: index out of range",
        },
        { name: "POST /orders" },
      ],
      metrics: [
        "rpc.server.call.duration",
        "rpc.client.call.duration",
        "http.client.request.duration",
        "go.goroutine.count",
        "orders.placed",
      ],
      logs: [
        {
          body: "loading order",
          hasTraceContext: true,
          attributes: { "order.id": "42" },
        },
        { body: "call panicked", hasTraceContext: true, hasException: true },
      ],
      resource: { "service.name": "orders" },
    },
  },
};
