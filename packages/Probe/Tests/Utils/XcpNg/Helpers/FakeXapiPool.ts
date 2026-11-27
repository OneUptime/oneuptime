import { XapiLab, XapiLabHost } from "./XapiLab";
import { TestCertificate, makeTestCertificate } from "./XcpNgCertificates";
import http from "http";
import https from "https";
import net, { AddressInfo } from "net";
import tls from "tls";

/*
 * A STAND-IN XCP-NG POOL: one HTTPS server per host, each with a
 * certificate of its own - an XCP-ng host signs its own - answering as XAPI
 * 24 (XCP-ng 8.3) does, for the XAPI recording of the lab (XapiLab):
 *
 *   POST /jsonrpc        JSON-RPC 2.0: {"jsonrpc":"2.0","result":...,"id":n}
 *                        or {"jsonrpc":"2.0","error":{"code":1,"message":
 *                        "<CODE>","data":[...]},"id":n}. A pool member
 *                        answers a login with HOST_IS_SLAVE and its
 *                        master's address; a session is good on every host
 *                        of the pool.
 *   GET /rrd_updates     the host's own rrd_updates, for a good session_id.
 *
 * The pool's Certificate records list each host's real fingerprint, as
 * XAPI lists the certificate it serves its API with - unless a test makes
 * the pool vouch for another one. Every call is recorded with the host it
 * reached, its password left out.
 */

export interface FakeXapiAccount {
  // root logs in as the local superuser; anyone else as an AD subject.
  isLocalSuperuser: boolean;
  authUserName: string;
  roles: Array<string>;
}

export interface FakeXapiMessage {
  uuid: string;
  name: string;
  priority: string;
  cls: string;
  obj_uuid: string;
  // An XAPI DateTime: "20261118T10:00:00Z".
  timestamp: string;
  body: string;
}

export interface FakeXapiSettings {
  masterKey: string;
  username: string;
  password: string;
  account: FakeXapiAccount;
  messages: Array<FakeXapiMessage>;
  // host.get_servertime, as XAPI writes it.
  serverTime: string;
  listCertificates: boolean;
  // The fingerprint the pool vouches for, by host key, in place of the real one.
  vouchedFingerprints: Record<string, string>;
  // Hosts that drop every connection, as a host that is down.
  downHosts: Array<string>;
  // The pool UUID a host answers with, by host key (a host ejected from it).
  answersForPool: Record<string, string>;
  // Calls answered RBAC_PERMISSION_DENIED.
  deniedMethods: Array<string>;
  // Hosts that answer as a web server, not XAPI.
  notXapiHosts: Array<string>;
}

export interface FakeXapiCall {
  hostKey: string;
  method: string;
  // Params, the password replaced with "***".
  params: Array<unknown>;
}

export interface FakeXapiHostServer {
  key: string;
  uuid: string;
  address: string;
  port: number;
  certificate: TestCertificate;
}

export interface FakeXapiPool {
  lab: XapiLab;
  settings: FakeXapiSettings;
  hosts: Array<FakeXapiHostServer>;
  calls: Array<FakeXapiCall>;
  // Every request any host received, as "<hostKey> <method> <path>".
  requests: Array<string>;
  hostByAddress: (address: string) => FakeXapiHostServer | undefined;
  close: () => Promise<void>;
}

export const FAKE_XAPI_USERNAME: string = "root";
export const FAKE_XAPI_PASSWORD: string = "fake-pool-root-password";

const NULL_REF: string = "OpaqueRef:NULL";

/*
 * Each host's certificate, made once per test file: making an RSA key takes
 * a while, and a host keeps its certificate from one pool start to the next,
 * as a real one does.
 */
const HOST_CERTIFICATES: Map<string, TestCertificate> = new Map();

function getHostCertificate(host: XapiLabHost): TestCertificate {
  let certificate: TestCertificate | undefined = HOST_CERTIFICATES.get(
    host.key,
  );

  if (!certificate) {
    certificate = makeTestCertificate(
      host.name,
      `IP:${host.address},DNS:${host.name}`,
    );
    HOST_CERTIFICATES.set(host.key, certificate);
  }

  return certificate;
}

export async function startFakeXapiPool(options: {
  lab: XapiLab;
  settings?: Partial<FakeXapiSettings> | undefined;
}): Promise<FakeXapiPool> {
  const lab: XapiLab = options.lab;
  const masterHost: XapiLabHost | undefined = lab.hosts.find(
    (host: XapiLabHost) => {
      return host.isMaster;
    },
  );
  const settings: FakeXapiSettings = {
    masterKey: masterHost ? masterHost.key : lab.hosts[0]!.key,
    username: FAKE_XAPI_USERNAME,
    password: FAKE_XAPI_PASSWORD,
    account: { isLocalSuperuser: true, authUserName: "root", roles: [] },
    messages: [],
    serverTime: "20261118T07:06:40Z",
    listCertificates: true,
    vouchedFingerprints: {},
    downHosts: [],
    answersForPool: {},
    deniedMethods: [],
    notXapiHosts: [],
    ...(options.settings || {}),
  };
  const calls: Array<FakeXapiCall> = [];
  const requests: Array<string> = [];
  const sessions: Set<string> = new Set();
  let sessionCount: number = 0;
  const servers: Array<https.Server> = [];
  const sockets: Set<net.Socket> = new Set();
  const hostServers: Array<FakeXapiHostServer> = [];

  const addressOf: (key: string) => string = (key: string): string => {
    return lab.hosts.find((host: XapiLabHost) => {
      return host.key === key;
    })!.address;
  };

  const recordsOf: (
    hostKey: string,
    xapiClass: string,
  ) => Record<string, unknown> = (
    hostKey: string,
    xapiClass: string,
  ): Record<string, unknown> => {
    if (xapiClass === "Certificate") {
      const certificates: Record<string, unknown> = {};

      for (const server of hostServers) {
        certificates[`OpaqueRef:Certificate-${server.key}`] = {
          uuid: `${server.uuid.slice(0, 8)}-ce00-4000-8000-000000000001`,
          name: "",
          type: "host",
          host: `OpaqueRef:host-${server.key}`,
          not_before: "20261117T00:00:00Z",
          not_after: "20271117T00:00:00Z",
          fingerprint_sha256:
            settings.vouchedFingerprints[server.key] ||
            server.certificate.fingerprint256,
        };
      }

      return certificates;
    }

    const records: Record<string, unknown> = JSON.parse(
      JSON.stringify(lab.records[xapiClass] || {}),
    );

    if (xapiClass === "pool") {
      for (const pool of Object.values(records) as Array<
        Record<string, unknown>
      >) {
        // The master the pool names now, after a failover.
        pool["master"] = `OpaqueRef:host-${settings.masterKey}`;

        if (settings.answersForPool[hostKey]) {
          pool["uuid"] = settings.answersForPool[hostKey];
        }
      }
    }

    return records;
  };

  const answerCall: (
    hostKey: string,
    method: string,
    params: Array<unknown>,
  ) => {
    result?: unknown;
    error?: { message: string; data: Array<string> };
  } = (
    hostKey: string,
    method: string,
    params: Array<unknown>,
  ): {
    result?: unknown;
    error?: { message: string; data: Array<string> };
  } => {
    const fail: (
      message: string,
      data?: Array<string>,
    ) => { error: { message: string; data: Array<string> } } = (
      message: string,
      data: Array<string> = [],
    ): { error: { message: string; data: Array<string> } } => {
      return { error: { message: message, data: data } };
    };

    if (method === "session.login_with_password") {
      if (hostKey !== settings.masterKey) {
        return fail("HOST_IS_SLAVE", [addressOf(settings.masterKey)]);
      }

      if (params[0] !== settings.username || params[1] !== settings.password) {
        return fail("SESSION_AUTHENTICATION_FAILED", [
          String(params[0]),
          "Authentication failure",
        ]);
      }

      const session: string = `OpaqueRef:session-${++sessionCount}`;
      sessions.add(session);
      return { result: session };
    }

    if (!sessions.has(String(params[0]))) {
      return fail("SESSION_INVALID", [String(params[0])]);
    }

    if (settings.deniedMethods.includes(method)) {
      return fail("RBAC_PERMISSION_DENIED", [method, "No permission"]);
    }

    if (method === "session.logout") {
      sessions.delete(String(params[0]));
      return { result: "" };
    }

    if (method === "session.get_is_local_superuser") {
      return { result: settings.account.isLocalSuperuser };
    }

    if (method === "session.get_subject") {
      return {
        result: settings.account.isLocalSuperuser
          ? NULL_REF
          : "OpaqueRef:subject-oneuptime",
      };
    }

    if (method === "session.get_auth_user_name") {
      return { result: settings.account.authUserName };
    }

    if (method === "subject.get_roles") {
      return {
        result: settings.account.roles.map((_role: string, index: number) => {
          return `OpaqueRef:role-${index}`;
        }),
      };
    }

    if (method === "role.get_name_label") {
      const index: number = Number(String(params[1]).split("-").pop());
      return { result: settings.account.roles[index] || "" };
    }

    if (method === "host.get_servertime") {
      return { result: settings.serverTime };
    }

    if (method === "message.get_since") {
      const since: string = String(params[1]);
      const result: Record<string, FakeXapiMessage> = {};

      settings.messages.forEach((message: FakeXapiMessage, index: number) => {
        // XAPI DateTimes of one shape compare as strings.
        if (message.timestamp > since) {
          result[`OpaqueRef:message-${index}`] = message;
        }
      });

      return { result: result };
    }

    const getAll: RegExpMatchArray | null = method.match(
      /^([A-Za-z_]+)\.get_all_records$/,
    );

    if (getAll) {
      // Before XCP-ng 8.2, XAPI has no Certificate class.
      if (getAll[1] === "Certificate" && !settings.listCertificates) {
        return fail("MESSAGE_METHOD_UNKNOWN", [method]);
      }

      return { result: recordsOf(hostKey, getAll[1]!) };
    }

    return fail("MESSAGE_METHOD_UNKNOWN", [method]);
  };

  for (const host of lab.hosts) {
    const certificate: TestCertificate = getHostCertificate(host);

    const handler: http.RequestListener = (
      request: http.IncomingMessage,
      response: http.ServerResponse,
    ): void => {
      const url: string = request.url || "/";
      requests.push(`${host.key} ${request.method} ${url.split("?")[0]}`);

      if (settings.notXapiHosts.includes(host.key)) {
        response.writeHead(200, { "Content-Type": "text/html" });
        response.end("<!doctype html><title>Welcome</title>");
        return;
      }

      if (request.method === "POST" && url === "/jsonrpc") {
        let body: string = "";
        request.setEncoding("utf8");
        request.on("data", (chunk: string) => {
          body += chunk;
        });
        request.on("end", () => {
          const parsed: {
            method?: string;
            params?: Array<unknown>;
            id?: unknown;
          } = JSON.parse(body || "{}");
          const method: string = String(parsed.method || "");
          const params: Array<unknown> = Array.isArray(parsed.params)
            ? parsed.params
            : [];

          calls.push({
            hostKey: host.key,
            method: method,
            params:
              method === "session.login_with_password"
                ? [params[0], "***", ...params.slice(2)]
                : params,
          });

          const answer: {
            result?: unknown;
            error?: { message: string; data: Array<string> };
          } = answerCall(host.key, method, params);

          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(
            JSON.stringify(
              answer.error
                ? {
                    jsonrpc: "2.0",
                    error: { code: 1, ...answer.error },
                    id: parsed.id,
                  }
                : { jsonrpc: "2.0", result: answer.result, id: parsed.id },
            ),
          );
        });
        return;
      }

      if (request.method === "GET" && url.startsWith("/rrd_updates?")) {
        const query: URLSearchParams = new URLSearchParams(url.split("?")[1]);

        if (!sessions.has(query.get("session_id") || "")) {
          response.writeHead(401, { "Content-Type": "text/plain" });
          response.end("Unauthorised");
          return;
        }

        const text: string | undefined = lab.rrds[host.uuid];
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(text || '{"meta":{"legend":[]},"data":[]}');
        return;
      }

      response.writeHead(404, { "Content-Type": "text/plain" });
      response.end("Not found");
    };

    const server: https.Server = https.createServer(
      { cert: certificate.cert, key: certificate.key },
      handler,
    );

    // A host that is down: every connection dropped at once.
    server.on("secureConnection", (socket: tls.TLSSocket) => {
      if (settings.downHosts.includes(host.key)) {
        socket.destroy();
      }
    });

    const port: number = await new Promise<number>(
      (resolve: (port: number) => void) => {
        server.listen(0, "127.0.0.1", () => {
          resolve((server.address() as AddressInfo).port);
        });
      },
    );

    server.on("connection", (socket: net.Socket) => {
      sockets.add(socket);
      socket.on("close", () => {
        sockets.delete(socket);
      });
    });

    servers.push(server);
    hostServers.push({
      key: host.key,
      uuid: host.uuid,
      address: host.address,
      port: port,
      certificate: certificate,
    });
  }

  return {
    lab: lab,
    settings: settings,
    hosts: hostServers,
    calls: calls,
    requests: requests,
    hostByAddress: (address: string): FakeXapiHostServer | undefined => {
      return hostServers.find((server: FakeXapiHostServer) => {
        return server.address === address;
      });
    },
    close: async (): Promise<void> => {
      await Promise.all(
        servers.map((server: https.Server) => {
          return new Promise<void>((resolve: () => void) => {
            server.close(() => {
              resolve();
            });
            server.closeAllConnections();
            // Sockets still in their handshake are not the HTTP server's to close.
            for (const socket of sockets) {
              socket.destroy();
            }
          });
        }),
      );
    },
  };
}
