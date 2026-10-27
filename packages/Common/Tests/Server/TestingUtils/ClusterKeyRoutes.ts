import { listProductFiles } from "../../Helpers/CodeScanning";
import { REPOSITORY_DIRECTORY } from "../../Helpers/TagStripScan";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * Every route of the product that takes OneUptime's cluster key, read from
 * the source: a router call (get, post, put, patch, delete, all, use) that
 * hands it ClusterKeyAuthorization's check, isAuthorizedServiceMiddleware
 * (the key in a request header). No Runner registers with the cluster key:
 * the check that let the shared Runner do so is gone with that Runner.
 *
 * The over-HTTP suites in App (Tests/ClusterKey/ClusterKeyRoutesOverHttp.test.ts
 * and WrongClusterKeysOverHttp.test.ts) hold their own lists of routes to
 * this one, so a new route that takes the cluster key is noticed: one sends
 * every value this repository ships to every route, the other too many
 * different wrong keys. ClusterKeyGuard checks every use of a check is such a
 * route, and that each route is called by OneUptime's own code
 * (CLUSTER_KEY_ROUTE_CALLERS below).
 */

export interface ClusterKeyRoute {
  // The file, from the repository root.
  file: string;
  // The router method, upper-cased (GET, POST, ...).
  method: string;
  // The source text of the path argument, as written.
  path: string;
  // The check the route is handed (one of CLUSTER_KEY_MIDDLEWARES).
  middleware: string;
}

export interface ClusterKeyMiddlewareUse {
  file: string;
  line: number;
  // The check used (one of CLUSTER_KEY_MIDDLEWARES).
  middleware: string;
  // Whether this use is an argument of a router call (a route).
  isRouteArgument: boolean;
}

// The key in a request header: every route that takes the cluster key.
export const SERVICE_MIDDLEWARE: string = "isAuthorizedServiceMiddleware";

export const CLUSTER_KEY_MIDDLEWARES: Array<string> = [SERVICE_MIDDLEWARE];

const ROUTER_METHODS: Array<string> = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "all",
  "use",
];

const CODE_FILE: RegExp = /\.(?:ts|tsx)$/;

const MIDDLEWARE_OBJECT: string = "ClusterKeyAuthorization";

const NOTIFICATION_API: string = "packages/App/FeatureSet/Notification/API";

/*
 * Who calls each cluster-key route: the product file that presents the key
 * to it, and the address it calls, as that file writes it. A route takes
 * the cluster key only because one of OneUptime's own services calls it;
 * a route nothing calls is removed, and a caller presents the key to these
 * routes alone.
 */
export interface ClusterKeyRouteCaller {
  route: {
    file: string;
    method: string;
    path: string;
  };
  // The file that calls it, from the repository root.
  caller: string;
  // What in the caller's code names the address it calls.
  calls: string;
}

export const CLUSTER_KEY_ROUTE_CALLERS: Array<ClusterKeyRouteCaller> = [
  {
    route: {
      file: `${NOTIFICATION_API}/Call.ts`,
      method: "POST",
      path: '"/make-call"',
    },
    caller: "packages/Common/Server/Services/CallService.ts",
    calls: '"/api/notification/call/make-call"',
  },
  {
    route: {
      file: `${NOTIFICATION_API}/CallAndSmsGateway.ts`,
      method: "POST",
      path: '"/test"',
    },
    caller: "packages/Common/Server/Utils/CallAndSmsGatewayTest.ts",
    calls: '"/api/notification/call-and-sms-gateway/test"',
  },
  /*
   * The Enterprise Edition's custom channels: core hands each request to
   * the route ee/ serves, under "/api".
   */
  {
    route: {
      file: "ee/Server/CustomNotificationChannels/API/CustomChannelSendAPI.ts",
      method: "POST",
      path: "CUSTOM_CHANNEL_SEND_PATH",
    },
    caller:
      "packages/Common/Server/Services/CustomNotificationChannelDeliveryService.ts",
    calls: '"/api/notification/custom-channel/send"',
  },
  {
    route: {
      file: `${NOTIFICATION_API}/Mail.ts`,
      method: "POST",
      path: '"/send"',
    },
    caller: "packages/Common/Server/Services/MailService.ts",
    calls: '"/api/notification/email/send"',
  },
  {
    route: {
      file: `${NOTIFICATION_API}/PhoneNumber.ts`,
      method: "POST",
      path: '"/internal/release"',
    },
    caller: "packages/Common/Server/Utils/IncomingCallPhoneNumber.ts",
    calls: '"/api/notification/phone-number/internal/release"',
  },
  {
    route: {
      file: `${NOTIFICATION_API}/SMS.ts`,
      method: "POST",
      path: '"/send"',
    },
    caller: "packages/Common/Server/Services/SmsService.ts",
    calls: '"/api/notification/sms/send"',
  },
  {
    route: {
      file: `${NOTIFICATION_API}/Telegram.ts`,
      method: "POST",
      path: '"/send"',
    },
    caller: "packages/Common/Server/Services/TelegramService.ts",
    calls: '"/api/notification/telegram/send"',
  },
  {
    route: {
      file: `${NOTIFICATION_API}/Webhook.ts`,
      method: "POST",
      path: '"/send"',
    },
    caller: "packages/Common/Server/Services/WebhookService.ts",
    calls: '"/api/notification/webhook/send"',
  },
  {
    route: {
      file: `${NOTIFICATION_API}/WhatsApp.ts`,
      method: "POST",
      path: '"/send"',
    },
    caller: "packages/Common/Server/Services/WhatsAppService.ts",
    calls: '"/api/notification/whatsapp/send"',
  },
  {
    route: {
      file: "packages/App/FeatureSet/Telemetry/API/TelemetryWriter.ts",
      method: "POST",
      path: '"/telemetry-writer/insert"',
    },
    caller: "packages/Common/Server/Utils/Telemetry/TelemetryWriterClient.ts",
    calls: '"/telemetry-writer/insert"',
  },
  {
    route: {
      file: "packages/App/FeatureSet/Workflow/API/Workflow.ts",
      method: "POST",
      path: "`/update/:workflowId`",
    },
    caller: "packages/Common/Server/Services/WorkflowService.ts",
    calls: '"/workflow/update/"',
  },
  {
    route: {
      file: "packages/Common/Server/Types/Workflow/Components/BaseModel/OnTriggerBaseModel.ts",
      method: "POST",
      path: "`/model/:projectId/${this.modelId}/${this.type}`",
    },
    caller: "packages/Common/Server/Services/DatabaseService.ts",
    calls: "/model/${projectId.toString()}/",
  },
  {
    route: {
      file: "packages/Common/Server/Types/Workflow/Components/IncomingEmail.ts",
      method: "POST",
      path: "INCOMING_EMAIL_TRIGGER_DELIVERY_PATH",
    },
    caller:
      "packages/App/FeatureSet/Telemetry/Services/IncomingEmailWorkflowDelivery.ts",
    calls: "INCOMING_EMAIL_TRIGGER_DELIVERY_PATH",
  },
];

function parse(relativePath: string): ts.SourceFile {
  return ts.createSourceFile(
    path.basename(relativePath),
    fs.readFileSync(path.join(REPOSITORY_DIRECTORY, relativePath), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

// The check a node references, when it is ClusterKeyAuthorization.<check>.
function middlewareReferencedBy(node: ts.Node): string | null {
  if (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === MIDDLEWARE_OBJECT &&
    CLUSTER_KEY_MIDDLEWARES.includes(node.name.text)
  ) {
    return node.name.text;
  }

  return null;
}

// The router method a call is, when it is `<anything>.<router method>(...)`.
function routerMethodOf(call: ts.CallExpression): string | null {
  if (!ts.isPropertyAccessExpression(call.expression)) {
    return null;
  }

  const name: string = call.expression.name.text;

  return ROUTER_METHODS.includes(name) ? name : null;
}

/*
 * Product files (packages/ and, when checked out, ee/) whose text mentions
 * a check at all: the cheap first pass.
 */
export function filesMentioningClusterKeyMiddleware(): Array<string> {
  return listProductFiles(REPOSITORY_DIRECTORY, ["packages", "ee"])
    .filter((relativePath: string): boolean => {
      return CODE_FILE.test(relativePath);
    })
    .filter((relativePath: string): boolean => {
      const text: string = fs.readFileSync(
        path.join(REPOSITORY_DIRECTORY, relativePath),
        "utf8",
      );

      return CLUSTER_KEY_MIDDLEWARES.some((middleware: string): boolean => {
        return text.includes(middleware);
      });
    });
}

// Every use of one of ClusterKeyAuthorization's checks in code.
export function findClusterKeyMiddlewareUses(): Array<ClusterKeyMiddlewareUse> {
  const uses: Array<ClusterKeyMiddlewareUse> = [];

  for (const relativePath of filesMentioningClusterKeyMiddleware()) {
    const sourceFile: ts.SourceFile = parse(relativePath);

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      const middleware: string | null = middlewareReferencedBy(node);

      if (middleware) {
        const parent: ts.Node = node.parent;
        const isRouteArgument: boolean =
          ts.isCallExpression(parent) &&
          parent.arguments.some((argument: ts.Expression): boolean => {
            return argument === node;
          }) &&
          routerMethodOf(parent) !== null;

        // The middleware's own definition site is not a use.
        if (!relativePath.endsWith("Middleware/ClusterKeyAuthorization.ts")) {
          uses.push({
            file: relativePath,
            line:
              sourceFile.getLineAndCharacterOfPosition(node.getStart()).line +
              1,
            middleware: middleware,
            isRouteArgument: isRouteArgument,
          });
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  return uses;
}

// Every route that takes the cluster key, sorted by file, then path, then method.
export function findClusterKeyRoutes(): Array<ClusterKeyRoute> {
  const routes: Array<ClusterKeyRoute> = [];

  for (const relativePath of filesMentioningClusterKeyMiddleware()) {
    const sourceFile: ts.SourceFile = parse(relativePath);

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const method: string | null = routerMethodOf(node);
        const middlewares: Array<string> = node.arguments
          .map(middlewareReferencedBy)
          .filter((middleware: string | null): middleware is string => {
            return middleware !== null;
          });

        if (method && middlewares.length > 0) {
          routes.push({
            file: relativePath,
            method: method.toUpperCase(),
            path: node.arguments[0]!.getText(sourceFile),
            middleware: middlewares.join(","),
          });
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  return routes.sort((a: ClusterKeyRoute, b: ClusterKeyRoute): number => {
    return (
      a.file.localeCompare(b.file) ||
      a.path.localeCompare(b.path) ||
      a.method.localeCompare(b.method)
    );
  });
}
