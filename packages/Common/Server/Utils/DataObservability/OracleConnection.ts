import { JSONObject } from "../../../Types/JSON";

export interface OracleConnectAttributes {
  user: string;
  password: string;
  connectString: string;
}

const ORACLE_URL_PATTERN: RegExp = /^oracle:\/\//i;

/*
 * An Oracle connection: a URL - oracle://user:password@host:1521/SERVICE -
 * or JSON { user, password, connectString }, the connect string an Easy
 * Connect address (host:1521/SERVICE) or a TNS alias.
 */
export function readOracleConnection(value: string): OracleConnectAttributes {
  const text: string = (value || "").trim();
  let attributes: OracleConnectAttributes = {
    user: "",
    password: "",
    connectString: "",
  };

  try {
    if (text.startsWith("{")) {
      const raw: JSONObject = JSON.parse(text) as JSONObject;

      attributes = {
        user: String(raw["user"] ?? raw["username"] ?? "").trim(),
        password: String(raw["password"] ?? ""),
        connectString: String(
          raw["connectString"] ?? raw["connectionString"] ?? "",
        ).trim(),
      };
    } else if (ORACLE_URL_PATTERN.test(text)) {
      const url: URL = new URL(text);

      attributes = {
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        connectString: `${url.hostname}:${url.port || "1521"}/${decodeURIComponent(
          url.pathname.replace(/^\/+/, ""),
        )}`,
      };
    }
  } catch {
    // Neither JSON nor a URL: said below.
  }

  if (!attributes.user || !attributes.password || !attributes.connectString) {
    throw new Error(
      "The Oracle connection needs a user, a password and where to connect: oracle://reader:password@db.internal:1521/ORCLPDB1, or JSON { user, password, connectString }.",
    );
  }

  return attributes;
}
