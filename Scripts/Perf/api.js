// The stack's API as the Dashboard calls it: a cookie session, the project
// in a tenantid header, an access token refreshed when it runs out.
"use strict";

const BASE = process.env.PERF_APP_URL || "http://localhost:3371";
const PASSWORD = "PerfLoad123!Pass";

class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

class Session {
  constructor() {
    this.cookies = {};
    this.projectId = null;
    this.email = "";
    this.refreshing = null;
  }

  cookieHeader() {
    return Object.entries(this.cookies)
      .map(([name, value]) => {
        return `${name}=${value}`;
      })
      .join("; ");
  }

  async refresh() {
    if (!this.refreshing) {
      this.refreshing = this.rawRequest(
        "POST",
        "/api/identity/refresh-token",
        {},
        false,
      ).finally(() => {
        this.refreshing = null;
      });
    }

    await this.refreshing;
  }

  async request(method, path, body) {
    try {
      return await this.rawRequest(method, path, body, true);
    } catch (error) {
      if (error.status === 401 && !path.includes("refresh-token")) {
        await this.refresh();
        return await this.rawRequest(method, path, body, true);
      }

      throw error;
    }
  }

  async rawRequest(method, path, body, withTenant) {
    const headers = { "content-type": "application/json" };
    const cookie = this.cookieHeader();

    if (cookie) {
      headers.cookie = cookie;
    }

    if (this.projectId && withTenant) {
      headers.tenantid = this.projectId;
    }

    const started = performance.now();
    const response = await fetch(BASE + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const ms = performance.now() - started;

    for (const setCookie of response.headers.getSetCookie
      ? response.headers.getSetCookie()
      : []) {
      const first = setCookie.split(";")[0];
      const equals = first.indexOf("=");

      if (equals > 0) {
        this.cookies[first.slice(0, equals)] = first.slice(equals + 1);
      }
    }

    let json = null;

    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }

    if (!response.ok) {
      throw new HttpError(
        `${method} ${path} -> ${response.status}: ${text.slice(0, 400)}`,
        response.status,
      );
    }

    return { json, ms, status: response.status };
  }
}

function idOf(value) {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object" && value.value) {
    return String(value.value);
  }

  if (typeof value === "object" && value._id) {
    return idOf(value._id);
  }

  return "";
}

async function getList(session, path, query, select, limit, sort) {
  const response = await session.request("POST", `${path}/get-list`, {
    query: query || {},
    select: select || { _id: true },
    limit: limit || 100,
    skip: 0,
    sort: sort || {},
  });

  return response.json.data || [];
}

async function create(session, path, data) {
  const response = await session.request("POST", path, {
    data,
    miscDataProps: {},
  });
  const item = (response.json && response.json.data) || response.json;

  return idOf(item._id);
}

// fn over items, `concurrency` at a time, results in the items' order.
async function pool(items, concurrency, fn) {
  let next = 0;
  const results = new Array(items.length);
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => {
      return worker();
    }),
  );

  return results;
}

async function signUp(email, name) {
  const session = new Session();

  await session.request("POST", "/api/identity/signup", {
    data: {
      email: { _type: "Email", value: email },
      name: { _type: "Name", value: name },
      password: { _type: "HashedString", value: PASSWORD },
    },
  });
  session.email = email;

  return session;
}

// A new session for a seeded user. Each refresh rotates the refresh token,
// so the cookies seed.js saved stop working once any run has refreshed
// them: a load run signs in afresh instead.
async function signIn(email) {
  const session = new Session();

  await session.request("POST", "/api/identity/login", {
    data: {
      email: { _type: "Email", value: email },
      password: { _type: "HashedString", value: PASSWORD },
    },
  });
  session.email = email;

  return session;
}

module.exports = {
  BASE,
  HttpError,
  Session,
  create,
  getList,
  idOf,
  pool,
  signIn,
  signUp,
};
