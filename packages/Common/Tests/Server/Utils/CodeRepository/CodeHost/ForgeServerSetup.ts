import CodeHostHttp, {
  CodeHostHttpResponse,
  CodeHostTransport,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostHttp";

/*
 * A REAL FORGEJO OR GITEA SERVER, FOR TESTS THAT ASK FOR ONE.
 *
 * The adapters' suites run against fakes everywhere; these run against a
 * real server too when one is named - a throwaway container, started with
 * the install already done:
 *
 *   docker run -d --rm --name code-git-providers-forgejo \
 *     -p 127.0.0.1:38930:3000 -e FORGEJO__security__INSTALL_LOCK=true \
 *     -e FORGEJO__database__DB_TYPE=sqlite3 codeberg.org/forgejo/forgejo:9.0.3
 *   docker exec -u 1000 code-git-providers-forgejo forgejo admin user create \
 *     --admin --username ouadmin --password <password> --email a@example.com
 *
 * and named with CODE_HOST_TEST_FORGES ("forgejo=http://127.0.0.1:38930,
 * gitea=http://127.0.0.1:38931") and CODE_HOST_TEST_FORGE_ADMIN
 * ("ouadmin:<password>"). Unnamed, those suites skip.
 */

export interface TestForge {
  // "forgejo", "gitea".
  name: string;
  hostUrl: string;
  adminUser: string;
  adminPassword: string;
}

export function readTestForges(): Array<TestForge> {
  const forges: string = process.env["CODE_HOST_TEST_FORGES"] || "";
  const admin: string = process.env["CODE_HOST_TEST_FORGE_ADMIN"] || "";
  const colon: number = admin.indexOf(":");

  if (!forges || colon <= 0) {
    return [];
  }

  return forges
    .split(",")
    .map((entry: string): string => {
      return entry.trim();
    })
    .filter((entry: string): boolean => {
      return entry.includes("=");
    })
    .map((entry: string): TestForge => {
      const equals: number = entry.indexOf("=");

      return {
        name: entry.substring(0, equals),
        hostUrl: entry.substring(equals + 1).replace(/\/+$/, ""),
        adminUser: admin.substring(0, colon),
        adminPassword: admin.substring(colon + 1),
      };
    });
}

// A request to the forge's API, signed in as a user with their password.
export class ForgeAdmin {
  private forge: TestForge;
  private transport: CodeHostTransport =
    CodeHostHttp.createUnguardedTransportForTests();

  public constructor(forge: TestForge) {
    this.forge = forge;
  }

  public async call(data: {
    method: "GET" | "POST" | "PUT" | "PATCH";
    path: string;
    body?: unknown;
    user?: { name: string; password: string } | undefined;
  }): Promise<CodeHostHttpResponse> {
    const user: { name: string; password: string } = data.user || {
      name: this.forge.adminUser,
      password: this.forge.adminPassword,
    };

    return await this.transport({
      method: data.method,
      url: `${this.forge.hostUrl}/api/v1${data.path}`,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${user.name}:${user.password}`).toString("base64")}`,
      },
      ...(data.body !== undefined ? { body: JSON.stringify(data.body) } : {}),
      timeoutInMs: 30000,
    });
  }

  // The same, failing the test on anything but a 2xx answer.
  public async ok(data: {
    method: "GET" | "POST" | "PUT" | "PATCH";
    path: string;
    body?: unknown;
    user?: { name: string; password: string } | undefined;
  }): Promise<CodeHostHttpResponse> {
    const response: CodeHostHttpResponse = await this.call(data);

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(
        `${data.method} ${data.path} answered ${response.statusCode}: ${response.bodyText.substring(0, 300)}`,
      );
    }

    return response;
  }

  // An access token of a user's, with these scopes.
  public async createToken(data: {
    user: { name: string; password: string };
    scopes: Array<string>;
  }): Promise<string> {
    const response: CodeHostHttpResponse = await this.ok({
      method: "POST",
      path: `/users/${encodeURIComponent(data.user.name)}/tokens`,
      body: {
        name: `oneuptime-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        scopes: data.scopes,
      },
      user: data.user,
    });

    const token: unknown = (response.bodyJson as Record<string, unknown>)[
      "sha1"
    ];

    if (typeof token !== "string" || !token) {
      throw new Error("The forge gave no token");
    }

    return token;
  }
}
