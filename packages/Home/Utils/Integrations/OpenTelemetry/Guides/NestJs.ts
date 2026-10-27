import { GuideSnippet, OpenTelemetryGuide } from "../GuideTypes";
import {
  DOCS,
  SCREENS,
  SERVER_KEY_PREREQUISITE,
  kubernetesManifestSnippet,
  otlpEnvironmentTabs,
  validateKeyStep,
} from "../GuideShared";
import {
  MINIMUM_NODE_VERSION,
  nodeInstrumentationFile,
  npmInstallSnippet,
} from "../JavaScriptShared";

/*
 * NestJS 12 (ES modules by default, Express 5 underneath). Checked on
 * NestJS 12.3; the Nest instrumentation's controller spans are for NestJS
 * 4 to 11, which the page says where it matters.
 */

const install: GuideSnippet = npmInstallSnippet("install", [
  "@opentelemetry/api",
  "@opentelemetry/sdk-node",
  "@opentelemetry/auto-instrumentations-node",
  "@opentelemetry/instrumentation",
]);

const installLogger: GuideSnippet = npmInstallSnippet("install-logger", [
  "nestjs-pino",
  "pino-http",
  "pino",
]);

const instrumentation: GuideSnippet = {
  id: "instrumentation",
  language: "javascript",
  title: "instrumentation.mjs",
  code: nodeInstrumentationFile({
    autoInstrumentationLines: [
      "// Nest runs on Express 5, which routes through the router package: one set of spans is enough.",
      '"@opentelemetry/instrumentation-router": { enabled: false },',
    ],
  }),
  check: "run",
};

const packageScripts: GuideSnippet = {
  id: "package-scripts",
  language: "json",
  title: "package.json",
  code: [
    "{",
    '  "scripts": {',
    '    "build": "nest build",',
    '    "start:prod": "node --import ./instrumentation.mjs dist/main"',
    "  }",
    "}",
  ].join("\n"),
  check: "parse",
};

const run: GuideSnippet = {
  id: "run",
  language: "bash",
  code: "node --import ./instrumentation.mjs dist/main",
  check: "run",
};

const exceptionFilter: GuideSnippet = {
  id: "exception-filter",
  language: "typescript",
  title: "src/telemetry-exception.filter.ts",
  code: [
    'import { ArgumentsHost, Catch, HttpException } from "@nestjs/common";',
    'import { BaseExceptionFilter } from "@nestjs/core";',
    'import { SpanStatusCode, trace } from "@opentelemetry/api";',
    "",
    "// Records every error that ends a request with a 5xx on the request's span.",
    "@Catch()",
    "export class TelemetryExceptionFilter extends BaseExceptionFilter {",
    "  override catch(exception: unknown, host: ArgumentsHost): void {",
    "    const isClientError: boolean =",
    "      exception instanceof HttpException && exception.getStatus() < 500;",
    "    const span = trace.getActiveSpan();",
    "",
    "    if (span && !isClientError) {",
    "      span.recordException(exception as Error);",
    "      span.setStatus({ code: SpanStatusCode.ERROR });",
    "    }",
    "",
    "    super.catch(exception, host);",
    "  }",
    "}",
  ].join("\n"),
  check: "run",
};

const main: GuideSnippet = {
  id: "main",
  language: "typescript",
  title: "src/main.ts",
  code: [
    'import { HttpAdapterHost, NestFactory } from "@nestjs/core";',
    'import { Logger } from "nestjs-pino";',
    'import { AppModule } from "./app.module.js";',
    'import { TelemetryExceptionFilter } from "./telemetry-exception.filter.js";',
    "",
    "async function bootstrap(): Promise<void> {",
    "  const app = await NestFactory.create(AppModule, { bufferLogs: true });",
    "  app.useLogger(app.get(Logger));",
    "  app.useGlobalFilters(new TelemetryExceptionFilter(app.get(HttpAdapterHost).httpAdapter));",
    "  app.enableShutdownHooks();",
    "  await app.listen(process.env.PORT ?? 3000);",
    "}",
    "await bootstrap();",
  ].join("\n"),
  check: "run",
};

const appModule: GuideSnippet = {
  id: "app-module",
  language: "typescript",
  title: "src/app.module.ts",
  code: [
    'import { Module } from "@nestjs/common";',
    'import { LoggerModule } from "nestjs-pino";',
    'import { OrdersController } from "./orders.controller.js";',
    'import { OrdersService } from "./orders.service.js";',
    "",
    "@Module({",
    "  imports: [",
    "    // Each request is already a span: no line per request on top.",
    "    LoggerModule.forRoot({ pinoHttp: { autoLogging: false } }),",
    "  ],",
    "  controllers: [OrdersController],",
    "  providers: [OrdersService],",
    "})",
    "export class AppModule {}",
  ].join("\n"),
  check: "run",
};

const manualSpan: GuideSnippet = {
  id: "manual-span",
  language: "typescript",
  title: "src/orders.service.ts",
  code: [
    "  async place(items: Array<string>, paymentMethod: string) {",
    '    return tracer.startActiveSpan("orders.place", async (span) => {',
    "      try {",
    '        span.setAttribute("order.item_count", items.length);',
    '        span.setAttribute("payment.method", paymentMethod);',
    "        const order = await this.payments.charge(items, paymentMethod);",
    '        ordersPlaced.add(1, { "payment.method": paymentMethod });',
    "        this.logger.log(`Placed order ${order.id}`);",
    "        return order;",
    "      } catch (error) {",
    "        span.recordException(error as Error);",
    "        span.setStatus({ code: SpanStatusCode.ERROR });",
    "        throw error;",
    "      } finally {",
    "        span.end();",
    "      }",
    "    });",
    "  }",
  ].join("\n"),
  check: "contained",
};

const serviceHeader: GuideSnippet = {
  id: "service-header",
  language: "typescript",
  title: "src/orders.service.ts",
  code: [
    'import { Injectable, Logger } from "@nestjs/common";',
    'import { metrics, SpanStatusCode, trace } from "@opentelemetry/api";',
    'import { PaymentsService } from "./payments.service.js";',
    "",
    'const tracer = trace.getTracer("orders");',
    'const ordersPlaced = metrics.getMeter("orders").createCounter("orders.placed", {',
    '  description: "Orders placed, by payment method",',
    "});",
  ].join("\n"),
  check: "contained",
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

const dockerfile: GuideSnippet = {
  id: "dockerfile",
  language: "dockerfile",
  title: "Dockerfile",
  code: [
    "FROM node:24-alpine AS build",
    "WORKDIR /app",
    "COPY package*.json ./",
    "RUN npm ci",
    "COPY . .",
    "RUN npm run build && npm prune --omit=dev",
    "",
    "FROM node:24-alpine",
    "WORKDIR /app",
    "ENV NODE_ENV=production",
    "COPY --from=build /app/package.json ./",
    "COPY --from=build /app/node_modules ./node_modules",
    "COPY --from=build /app/dist ./dist",
    "COPY --from=build /app/instrumentation.mjs ./",
    "EXPOSE 3000",
    'CMD ["node", "--import", "./instrumentation.mjs", "dist/main"]',
  ].join("\n"),
  check: "parse",
};

// The app the end-to-end check runs, around the page's own files.
const ordersService: string = [
  serviceHeader.code,
  "",
  "@Injectable()",
  "export class OrdersService {",
  "  private readonly logger = new Logger(OrdersService.name);",
  "",
  "  // The stand-in, made here so the page's module stays as it is.",
  "  private readonly payments = new PaymentsService();",
  "",
  manualSpan.code,
  "}",
].join("\n");

const paymentsService: string = [
  'import { Injectable } from "@nestjs/common";',
  "",
  "// A stand-in for the payment provider.",
  "@Injectable()",
  "export class PaymentsService {",
  "  async charge(items: Array<string>, paymentMethod: string) {",
  '    return { id: "ord_1001", items: items, paymentMethod: paymentMethod };',
  "  }",
  "}",
].join("\n");

const ordersController: string = [
  'import { Body, Controller, Get, NotFoundException, Param, Post } from "@nestjs/common";',
  'import { OrdersService } from "./orders.service.js";',
  "",
  '@Controller("orders")',
  "export class OrdersController {",
  "  constructor(private readonly orders: OrdersService) {}",
  "",
  "  @Post()",
  "  create(@Body() body: { items: Array<string>; paymentMethod: string }) {",
  "    return this.orders.place(body.items, body.paymentMethod);",
  "  }",
  "",
  '  @Get(":id/invoice")',
  '  invoice(@Param("id") id: string) {',
  "    throw new Error(`Invoice service timed out for order ${id}`);",
  "  }",
  "",
  '  @Get(":id/refund")',
  '  refund(@Param("id") id: string) {',
  "    throw new NotFoundException(`Order ${id} cannot be refunded`);",
  "  }",
  "}",
].join("\n");

const tsconfig: string = JSON.stringify(
  {
    compilerOptions: {
      module: "nodenext",
      moduleResolution: "nodenext",
      resolvePackageJsonExports: true,
      esModuleInterop: true,
      isolatedModules: true,
      emitDecoratorMetadata: true,
      experimentalDecorators: true,
      target: "ES2023",
      outDir: "./dist",
      rootDir: "./src",
      skipLibCheck: true,
      strict: false,
      types: [],
    },
    include: ["src"],
  },
  null,
  2,
);

export const NestJsGuide: OpenTelemetryGuide = {
  slug: "nestjs",
  seo: {
    title: "NestJS OpenTelemetry: Tracing, Logs & Errors | OneUptime",
    description:
      "Instrument NestJS 12 and 11 with OpenTelemetry: route spans, nestjs-pino logs with trace IDs, a filter that records 5xx errors, and metrics, sent to OneUptime.",
  },
  h1: "OpenTelemetry for NestJS",
  lead: "Trace every NestJS request from its route to the services and queries behind it, and send the traces, logs, metrics and errors to OneUptime. Written for NestJS 12, whose apps are ES modules on Express 5, with the differences for NestJS 11 where they matter.",
  cardDescription:
    "NestJS 12 and 11: route spans, Nest logs through pino with trace IDs, and 5xx errors recorded by a filter.",
  searchTerms: ["nest", "nest.js", "typescript", "decorators", "controllers"],
  highlights: [
    "NestJS 12 and 11",
    "ES modules",
    "nestjs-pino logs",
  ],

  whatYouGet: {
    intro: `Every request to the app becomes a trace under the service named by \`OTEL_SERVICE_NAME\`, listed under ${SCREENS.services}. Nest's own logs, errors and your services' spans join it.`,
    traces:
      "A server span per request named after the controller's route, such as `POST /orders`, with the Express layer that ran the handler beneath it, then your services' spans and the queries and HTTP calls they made. On NestJS 11 and earlier, the Nest instrumentation adds a span per controller method too, such as `OrdersController.create`.",
    metrics:
      "`http.server.request.duration` by `http.route` and status code, for every endpoint's latency and error rate, plus the Node.js runtime's event loop, heap and garbage collection.",
    logs: "Everything Nest's `Logger` writes, routed through pino by nestjs-pino, each line stamped with the trace and span of the request that wrote it: open a trace and read the request's logs.",
    exceptions: `An error that ends a request with a 5xx is recorded on its span by a small exception filter, and Nest's own error log carries the stack trace too. OneUptime groups both under ${SCREENS.exceptions} as one issue. A 4xx, such as a \`NotFoundException\`, is left out.`,
  },

  exampleTrace: {
    caption: "A POST /orders request, as its trace shows it",
    spans: [
      { name: "POST /orders", depth: 0, start: 0, duration: 100, source: "http" },
      {
        name: "request handler - /orders",
        depth: 1,
        start: 5,
        duration: 91,
        source: "express",
      },
      {
        name: "orders.place",
        depth: 2,
        start: 9,
        duration: 84,
        source: "your code",
      },
      {
        name: "pg.query:INSERT orders",
        depth: 3,
        start: 15,
        duration: 21,
        source: "pg",
      },
      {
        name: "POST",
        depth: 3,
        start: 42,
        duration: 46,
        source: "undici",
      },
    ],
  },

  prerequisites: [
    `Node.js ${MINIMUM_NODE_VERSION} or later, which the OpenTelemetry JS SDK 3.0 needs. NestJS 12 itself supports Node.js 20 and later.`,
    "A NestJS 12 or 11 app on the Express platform, built to `dist/` by `nest build` or `tsc`.",
    SERVER_KEY_PREREQUISITE,
  ],

  install: {
    intro:
      "Install the SDK, the automatic instrumentations and the API your services use for their own spans and metrics:",
    snippets: [install],
    notes: [
      "Keep them in `dependencies`, not `devDependencies`: the production image loads the instrumentation file at start.",
    ],
  },

  configure: {
    intro:
      "The SDK reads its endpoint, key and service name from the environment, the way Nest apps read the rest of their configuration. Set them where the app runs:",
    tabs: otlpEnvironmentTabs({
      serviceName: "orders-api",
      cloudNote:
        "With `@nestjs/config`, these can stay in your `.env` file, but the SDK reads them before Nest starts: export them in the shell or the container too, or load the file with `node --env-file=.env`.",
    }),
    notes: [
      "`OTEL_SERVICE_NAME` names the service in OneUptime. Give each Nest app in a monorepo its own.",
    ],
  },

  setup: {
    intro:
      "OpenTelemetry has to start before Nest imports Express and your libraries, so it loads from a file of its own, outside `src/`, and the app starts with it.",
    steps: [
      {
        title: "Create the instrumentation file",
        body: "Save `instrumentation.mjs` in the project's root, next to `package.json`. It is plain JavaScript, so it needs no build step, and the same file works for NestJS 12's ES modules and for a CommonJS app on NestJS 11.",
        snippets: [instrumentation],
        notes: [
          "NestJS 12 apps are ES modules: the `register` line is what lets the instrumentations patch the packages they import.",
          "The file flushes on SIGTERM and then waits for Nest: with `enableShutdownHooks()`, Nest closes the app, runs your `onApplicationShutdown` hooks, then exits.",
        ],
      },
      {
        title: "Start the built app with it",
        body: "Change the production start script so Node.js loads the file before `dist/main`:",
        snippets: [packageScripts, run],
        notes: [
          "Run `npm run build` first, as for any Nest deployment. The instrumentation file is not compiled: it stays in the root.",
        ],
      },
      {
        title: "Record server errors on their spans",
        body: "Nest catches every exception in its own exception layer, so no span sees it. This filter records each one that ends a request with a 5xx before Nest answers, and leaves `HttpException`s with a 4xx status alone:",
        snippets: [exceptionFilter],
      },
      {
        title: "Wire in the filter and the logger",
        body: "In `main.ts`, register the filter, hand Nest's logging to pino, and let Nest shut down cleanly:",
        snippets: [main, installLogger, appModule],
        notes: [
          "`bufferLogs: true` holds the startup logs until pino is in place, so they reach OneUptime too.",
          "`autoLogging: false` stops pino-http writing a line per request: the request's span already says it, and its error line would file a second, generic exception named after the status code.",
        ],
      },
    ],
  },

  autoInstrumentation: {
    intro:
      "What a NestJS app gets from the bundle, with nothing in its code:",
    rows: [
      {
        library: "`@nestjs/core`",
        covers:
          "On NestJS 4 to 11: `Create Nest App` at startup, a span per controller method (`OrdersController.create`) and per handler. The instrumentation does not cover NestJS 12 yet, which is why the filter above records errors.",
      },
      {
        library: "`express` (Nest's default platform)",
        covers:
          "A span per middleware and per handler (`request handler - /orders`), and the route as `http.route` on the request's span and its metrics.",
      },
      {
        library: "`http`, `fetch`",
        covers:
          "The server span of every request, and a client span for each call made with Nest's `HttpService`, `fetch()` or `http.request`.",
      },
      {
        library: "`pg`, `mysql2`, `mongodb`, `mongoose`, `ioredis`",
        covers:
          "Spans for the queries TypeORM, Prisma's driver adapters, Mongoose and Sequelize make through these drivers.",
      },
      {
        library: "`amqplib`, `kafkajs`, `@grpc/grpc-js`",
        covers:
          "Spans for messages and gRPC calls, including those of Nest microservice transports built on them.",
      },
      {
        library: "`pino`",
        covers:
          "Trace and span IDs on every log nestjs-pino writes, and the logs themselves sent to OneUptime.",
      },
    ],
    snippets: [],
    notes: [
      "On the Fastify platform (`@nestjs/platform-fastify`), add Fastify's own instrumentation as the [Fastify guide](/integrations/opentelemetry/fastify) shows, in place of the Express one.",
    ],
  },

  manualSpans: {
    intro:
      "Services are where the work no library knows about happens. Create a tracer and a meter once per file, and wrap the work in a span:",
    snippets: [serviceHeader, manualSpan],
    notes: [
      "The span becomes a child of the request's span, and the queries and calls made inside it become its children.",
      "Name spans after the domain operation (`orders.place`): the route is already on the request's span.",
      "A span ended in `finally` is never left open when the work throws.",
    ],
  },

  logs: {
    intro:
      "With nestjs-pino in place, keep logging the Nest way. `new Logger(OrdersService.name)` writes through pino, so every line carries its trace and lands in OneUptime with the service's other telemetry:",
    snippets: [],
    notes: [
      "The class name becomes the record's `context` attribute: filter by it in the **Logs** explorer with `@context:OrdersService`.",
      "Nest's own startup lines (routes mapped, modules loaded) arrive too, without a trace: they run before any request.",
      "Without nestjs-pino, Nest's default logger only writes to stdout, which the SDK does not read.",
    ],
  },

  metrics: {
    intro:
      "Request and runtime metrics arrive every 60 seconds with no code. Add your own counters and histograms from services, as above:",
    builtIn: [
      {
        name: "http.server.request.duration",
        description:
          "Each request's duration by `http.route`, method and status: a latency and error rate per endpoint.",
      },
      {
        name: "http.client.request.duration",
        description: "Calls to other services, by host and status.",
      },
      {
        name: "nodejs.eventloop.delay.p99",
        description:
          "Event loop delay: high values point at synchronous work blocking every request.",
      },
      {
        name: "orders.placed",
        description:
          "The counter from the service above, by `payment.method`: business numbers beside the technical ones.",
      },
    ],
    snippets: [],
    notes: [
      "Create instruments at module level, as above, not in a method: one instrument per name lives for the life of the process.",
    ],
  },

  sampling: {
    intro:
      "Traces are kept in full while you set things up. To keep a quarter of them on a busy API, while following the caller's decision for requests that arrive with one:",
    snippets: [sampling],
    notes: [
      "Health checks are dropped before sampling by the filter in `instrumentation.mjs`: point it at your health route, such as `/health` with `@nestjs/terminus`.",
      "Errors are not exempt from sampling: a dropped trace takes its exception event with it. Nest's error log is never sampled, so the exception still reaches OneUptime that way.",
    ],
  },

  deploy: {
    intro:
      "Build in one stage, run in another, and keep `instrumentation.mjs` beside `dist/` in the final image:",
    snippets: [
      dockerfile,
      kubernetesManifestSnippet({
        name: "orders-api",
        image: "registry.example.com/orders-api:3.0.2",
        containerPort: 3000,
      }),
    ],
    notes: [
      "The instrumentation file lives outside `src/`, so `nest build` never compiles or moves it: copy it into the image yourself, as above.",
      "With `enableShutdownHooks()`, Kubernetes' SIGTERM closes the app and runs its shutdown hooks before the process exits, and the buffered telemetry is sent first.",
    ],
  },

  verify: {
    intro: "Each step rules out one cause.",
    steps: [
      validateKeyStep("server"),
      {
        title: "Find the service",
        body: `Start the built app, call an endpoint, and open ${SCREENS.services}: \`orders-api\` appears within a minute.`,
      },
      {
        title: "Open a request's trace",
        body: `In ${SCREENS.traces}, search \`@http.route:/orders\`. The request's span holds the Express handler, your service's \`orders.place\` and the calls beneath it.`,
      },
      {
        title: "Throw an error",
        body: `Call a route that throws. The request's handler span shows the exception, and ${SCREENS.exceptions} lists it with its stack trace.`,
      },
    ],
  },

  troubleshooting: [
    {
      question: "There are no OrdersController.create spans",
      answer:
        "On NestJS 12 that is expected: the Nest instrumentation covers `@nestjs/core` 4 to 11. The route is still on the request's span (`POST /orders`) and the handler's Express span. On NestJS 11, check that the app is started with `--import ./instrumentation.mjs`, not by importing the file from `main.ts`.",
    },
    {
      question: "Errors show a 500 on the span but nothing under Exceptions",
      answer:
        "Nest's exception layer caught the error before any span saw it. Register the `TelemetryExceptionFilter` above with `app.useGlobalFilters`, or log errors through nestjs-pino, whose error lines carry the stack trace.",
    },
    {
      question: "Every 500 is filed twice, once as \"failed with status code 500\"",
      answer:
        "That is pino-http's request log: for a 5xx response it logs a synthetic error of its own. Pass `pinoHttp: { autoLogging: false }` to `LoggerModule.forRoot`, as above.",
    },
    {
      question: "Each layer appears twice",
      answer:
        "Nest 11 and 12 run on Express 5, which routes through the `router` package and its own instrumentation. Keep `\"@opentelemetry/instrumentation-router\": { enabled: false }` in the instrumentation file.",
    },
    {
      question: "`nest start` in development sends nothing",
      answer:
        "`nest start` runs `node dist/main` without the flag. Run the built app with `node --import ./instrumentation.mjs dist/main`, or watch with `nest start --watch --exec \"node --import ./instrumentation.mjs\"`.",
    },
    {
      question: "The configuration from .env is not used",
      answer:
        "The SDK starts before Nest, so `@nestjs/config` has not loaded `.env` yet. Export the variables in the environment, or start with `node --env-file=.env --import ./instrumentation.mjs dist/main`.",
    },
  ],

  faq: [
    {
      question: "Does OpenTelemetry support NestJS 12?",
      answer:
        "Yes. Requests, routes, database calls, logs and metrics are traced on NestJS 12 exactly as this guide shows; it was checked end to end on NestJS 12.3. What NestJS 12 does not have yet is the Nest instrumentation's controller-method spans, which cover NestJS 4 to 11.",
    },
    {
      question: "Should I use nestjs-otel or another Nest module?",
      answer:
        "You do not need one: the SDK and its automatic instrumentations trace a Nest app as it is. Community modules such as nestjs-otel add decorators for spans and metrics on top of the same SDK, so they fit with this setup if you like that style.",
    },
    {
      question: "Can the instrumentation live in src/ as TypeScript?",
      answer:
        "It can be compiled with the app, but it must still be loaded with `--import` before `dist/main`: importing it from `main.ts` runs too late for an ES module app. Keeping it as a plain `.mjs` file in the root avoids the build step and the path.",
    },
    {
      question: "Does it work with Nest microservices and queues?",
      answer:
        "Transports built on instrumented libraries are traced: gRPC, RabbitMQ through `amqplib`, Kafka through `kafkajs`. Message handlers continue the producer's trace when the library carries the context, as these do.",
    },
    {
      question: "How do I trace GraphQL resolvers?",
      answer:
        "`@nestjs/graphql` runs on the `graphql` package, whose instrumentation is in the bundle: each operation, its parsing and validation, and its resolvers get spans.",
    },
  ],

  related: ["express", "fastify", "nodejs", "nextjs"],
  docs: [DOCS.openTelemetry, DOCS.traces, DOCS.logs, DOCS.exceptions],

  verification: {
    runtime: "node",
    framework: { name: "NestJS", package: "@nestjs/core" },
    files: [
      {
        path: "package.json",
        content: '{ "name": "orders-api", "private": true, "type": "module" }',
      },
      { path: "tsconfig.json", content: tsconfig },
      { path: "instrumentation.mjs", snippet: "instrumentation" },
      { path: "src/main.ts", snippet: "main" },
      { path: "src/app.module.ts", snippet: "app-module" },
      { path: "src/telemetry-exception.filter.ts", snippet: "exception-filter" },
      { path: "src/orders.service.ts", content: ordersService },
      { path: "src/payments.service.ts", content: paymentsService },
      { path: "src/orders.controller.ts", content: ordersController },
    ],
    commands: [
      { snippet: "install" },
      { snippet: "install-logger" },
      {
        command:
          "npm install @nestjs/common@12.3.2 @nestjs/core@12.3.2 @nestjs/platform-express@12.3.2 reflect-metadata@0.2.2 rxjs@7.8.2 typescript@6.0.3",
      },
      { command: "npx tsc -p tsconfig.json" },
      { snippet: "run", isServer: true },
    ],
    port: 3000,
    requests: [
      { method: "GET", path: "/healthz" },
      {
        method: "POST",
        path: "/orders",
        body: { items: ["desk", "lamp"], paymentMethod: "card" },
      },
      { method: "GET", path: "/orders/1001/invoice" },
      { method: "GET", path: "/orders/1001/refund" },
    ],
    expect: {
      spans: [
        { name: "POST /orders", attributes: { "http.route": "/orders" } },
        { name: "request handler - /orders" },
        {
          name: "orders.place",
          attributes: { "order.item_count": "2", "payment.method": "card" },
        },
        {
          name: "request handler - /orders/:id/invoice",
          hasException: true,
        },
        {
          name: "GET /orders/:id/refund",
          attributes: { "http.response.status_code": "404" },
        },
      ],
      metrics: ["http.server.request.duration", "orders.placed"],
      logs: [
        { body: "Placed order ord_1001", hasTraceContext: true },
        { body: "Invoice service timed out", hasTraceContext: true },
        { body: "Nest application successfully started", hasTraceContext: false },
      ],
      resource: { "service.name": "orders-api" },
      untracedPaths: ["/healthz"],
    },
  },
};
