const https = require("https");
const fs = require("fs");
const crypto = require("crypto");
const ids = require("./identities.json");

for (const key of [
  "DISCORD_APP_CLIENT_SECRET",
  "DISCORD_BOT_TOKEN",
  "DISCORD_FIXTURE_CONTROL_TOKEN",
]) {
  if (!process.env[key])
    throw new Error(`${key} is required for the disposable fixture`);
}

const requiredPermissions = [10n, 11n, 16n, 34n, 35n, 36n, 38n]
  .reduce((mask, bit) => mask | (1n << bit), 0n)
  .toString();
let scenario = "valid";
const codes = new Map();
const tokens = new Map();
let events = [];
let unhandled = [];
let postedMessages = [];
let messageCounter = 0;
const snapshot = () => ({ scenario, events, unhandled, postedMessages });
const send = (res, status, body) => {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
};

async function readBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 1024 * 1024)
      throw new Error("Request body exceeds fixture limit");
  }
  return body;
}

const channels = () => [
  {
    id: ids.channelId,
    guild_id: ids.guildId,
    type: 0,
    name: "incidents-e2e",
    permission_overwrites: [],
  },
  {
    id: ids.foreignChannelId,
    guild_id: ids.otherGuildId,
    type: 0,
    name: "foreign-guild",
    permission_overwrites: [],
  },
  {
    id: ids.voiceChannelId,
    guild_id: ids.guildId,
    type: 2,
    name: "voice",
    permission_overwrites: [],
  },
  {
    id: ids.threadChannelId,
    guild_id: ids.guildId,
    type: 11,
    name: "existing-thread",
    parent_id: ids.channelId,
    permission_overwrites: [],
  },
  {
    id: ids.deniedChannelId,
    guild_id: ids.guildId,
    type: 0,
    name: "thread-denied",
    permission_overwrites: [
      { id: ids.botRoleId, type: 0, allow: "0", deny: requiredPermissions },
    ],
  },
];

const server = https.createServer(
  {
    key: fs.readFileSync(
      process.env.DISCORD_FIXTURE_TLS_KEY || "/fixture-certs/server.key",
    ),
    cert: fs.readFileSync(
      process.env.DISCORD_FIXTURE_TLS_CERT || "/fixture-certs/server.crt",
    ),
  },
  async (req, res) => {
    const target = new URL(req.url, "https://discord.com");
    const pathname = target.pathname;
    if (pathname === "/__fixture/health")
      return send(res, 200, { ready: true });
    if (pathname.startsWith("/__fixture/")) {
      if (
        req.headers["x-fixture-control"] !==
        process.env.DISCORD_FIXTURE_CONTROL_TOKEN
      )
        return send(res, 403, { error: "Forbidden" });
      try {
        if (pathname === "/__fixture/state" && req.method === "GET")
          return send(res, 200, snapshot());
        if (pathname === "/__fixture/reset" && req.method === "POST") {
          await readBody(req);
          scenario = "valid";
          codes.clear();
          tokens.clear();
          events = [];
          unhandled = [];
          postedMessages = [];
          messageCounter = 0;
          return send(res, 200, snapshot());
        }
        if (pathname === "/__fixture/scenario" && req.method === "POST") {
          const input = JSON.parse(await readBody(req));
          const allowed = [
            "valid",
            "denied-consent",
            "forged-guild",
            "no-manage-guild",
            "bot-missing",
            "token-failure",
            "identity-failure",
            "different-guild",
            "user-not-in-guild",
            "guild-temporary",
          ];
          if (!allowed.includes(input.scenario))
            return send(res, 400, { error: "Unknown scenario" });
          scenario = input.scenario;
          return send(res, 200, snapshot());
        }
        return send(res, 404, { error: "Unknown control operation" });
      } catch {
        return send(res, 400, { error: "Invalid control request" });
      }
    }

    res.on("finish", () =>
      events.push({
        method: req.method,
        path: pathname,
        status: res.statusCode,
      }),
    );
    try {
      if (
        req.method === "GET" &&
        ["/oauth2/authorize", "/api/oauth2/authorize"].includes(pathname)
      ) {
        const redirect = new URL(target.searchParams.get("redirect_uri"));
        if (
          redirect.hostname !== "oneuptime.test" ||
          !["/api/discord/oauth/install", "/api/discord/oauth/user"].includes(
            redirect.pathname,
          )
        ) {
          return send(res, 400, {
            error: "Callback is outside the disposable test application",
          });
        }
        if (
          target.searchParams.get("client_id") !== ids.applicationId ||
          !target.searchParams.get("state")
        )
          return send(res, 400, { error: "Invalid authorization request" });
        redirect.searchParams.set("state", target.searchParams.get("state"));
        if (scenario === "denied-consent") {
          redirect.searchParams.set("error", "access_denied");
        } else {
          const code = crypto.randomBytes(20).toString("hex");
          codes.set(code, {
            scenario,
            redirectUri: target.searchParams.get("redirect_uri"),
            scope: target.searchParams.get("scope") || "",
            guildId:
              scenario === "different-guild" ? ids.otherGuildId : ids.guildId,
          });
          redirect.searchParams.set("code", code);
          redirect.searchParams.set(
            "guild_id",
            scenario === "forged-guild" || scenario === "different-guild"
              ? ids.otherGuildId
              : ids.guildId,
          );
        }
        res.writeHead(302, {
          location: redirect.toString(),
          "cache-control": "no-store",
        });
        return res.end();
      }

      const route = pathname.replace(/^\/api(?:\/v10)?/, "");
      if (req.method === "POST" && route === "/oauth2/token") {
        const form = new URLSearchParams(await readBody(req));
        const grant = codes.get(form.get("code"));
        if (grant) codes.delete(form.get("code"));
        if (
          !grant ||
          form.get("grant_type") !== "authorization_code" ||
          form.get("client_id") !== ids.applicationId ||
          form.get("client_secret") !== process.env.DISCORD_APP_CLIENT_SECRET ||
          form.get("redirect_uri") !== grant.redirectUri ||
          grant.scenario === "token-failure"
        ) {
          return send(res, 400, { error: "invalid_grant" });
        }
        const access =
          "fixture-access-" + crypto.randomBytes(16).toString("hex");
        tokens.set(access, grant);
        return send(res, 200, {
          access_token: access,
          token_type: "Bearer",
          expires_in: 604800,
          refresh_token:
            "fixture-refresh-" + crypto.randomBytes(16).toString("hex"),
          scope: grant.scope,
          guild: { id: grant.guildId, name: ids.guildName },
        });
      }

      const authorization = req.headers.authorization || "";
      const bot = authorization === `Bot ${process.env.DISCORD_BOT_TOKEN}`;
      const grant = authorization.startsWith("Bearer ")
        ? tokens.get(authorization.slice(7))
        : undefined;
      if (!bot && !grant)
        return send(res, 401, { message: "Unauthorized", code: 0 });
      const activeScenario = grant?.scenario || scenario;
      if (req.method === "GET" && route === "/users/@me") {
        if (!bot && activeScenario === "identity-failure")
          return send(res, 500, { message: "Fixture identity failure" });
        return send(res, 200, {
          id: bot ? ids.botId : ids.userId,
          username: bot ? "oneuptime-e2e-bot" : ids.username,
          global_name: bot ? "OneUptime E2E" : "Discord E2E User",
          bot,
          discriminator: "0",
        });
      }
      if (req.method === "GET" && bot && route === "/oauth2/applications/@me")
        return send(res, 200, {
          id: ids.applicationId,
          name: "OneUptime E2E",
          bot: { id: ids.botId, username: "oneuptime-e2e-bot", bot: true },
        });
      if (req.method === "GET" && grant && route === "/users/@me/guilds") {
        if (activeScenario === "user-not-in-guild") return send(res, 200, []);
        return send(res, 200, [
          {
            id: grant.guildId,
            name: ids.guildName,
            owner: activeScenario !== "no-manage-guild",
            permissions: activeScenario === "no-manage-guild" ? "0" : "32",
          },
        ]);
      }
      const userMembership = route.match(
        /^\/users\/@me\/guilds\/(\d+)\/member$/,
      );
      if (req.method === "GET" && grant && userMembership) {
        if (
          activeScenario === "user-not-in-guild" ||
          userMembership[1] !== grant.guildId
        )
          return send(res, 404, { message: "Unknown Member", code: 10007 });
        return send(res, 200, {
          user: { id: ids.userId, username: ids.username },
          roles: [],
          joined_at: "2026-01-01T00:00:00Z",
        });
      }
      const guildRoute = route.match(/^\/guilds\/(\d+)(.*)$/);
      if (req.method === "GET" && bot && guildRoute) {
        const guildId = guildRoute[1],
          suffix = guildRoute[2];
        if (
          ![ids.guildId, ids.otherGuildId].includes(guildId) ||
          activeScenario === "bot-missing"
        )
          return send(res, 404, { message: "Unknown Guild", code: 10004 });
        if (activeScenario === "guild-temporary")
          return send(res, 503, { message: "Guild temporarily unavailable" });
        if (!suffix)
          return send(res, 200, {
            id: guildId,
            name: ids.guildName,
            owner_id: ids.userId,
            features: [],
          });
        if (suffix === `/members/${ids.botId}`)
          return send(res, 200, {
            user: { id: ids.botId, bot: true },
            roles: [ids.botRoleId],
          });
        if (suffix === "/roles")
          return send(res, 200, [
            { id: guildId, name: "@everyone", permissions: "0" },
            {
              id: ids.botRoleId,
              name: "OneUptime",
              permissions: requiredPermissions,
            },
          ]);
        if (suffix === "/channels")
          return send(
            res,
            200,
            channels().filter((channel) => channel.guild_id === guildId),
          );
      }
      const channelRoute = route.match(/^\/channels\/(\d+)$/);
      if (req.method === "GET" && bot && channelRoute) {
        const channel = channels().find((item) => item.id === channelRoute[1]);
        return send(
          res,
          channel ? 200 : 404,
          channel || { message: "Unknown Channel", code: 10003 },
        );
      }
      // Bot message posts: record the body so lifecycle specs can assert on
      // message content, then model a successful Discord message response.
      const messageRoute = route.match(/^\/channels\/(\d+)\/messages$/);
      if (req.method === "POST" && bot && messageRoute) {
        const channel = channels().find(
          (item) => item.id === messageRoute[1],
        );
        if (!channel)
          return send(res, 404, { message: "Unknown Channel", code: 10003 });
        let body;
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          return send(res, 400, { message: "Malformed message body" });
        }
        const message = {
          id: `3000000000000${String(++messageCounter).padStart(4, "0")}`,
          channel_id: channel.id,
          content: body.content || "",
          embeds: body.embeds || [],
          components: body.components || [],
          timestamp: new Date().toISOString(),
        };
        postedMessages.push(message);
        return send(res, 200, message);
      }
      // Interaction followups use the interaction token as the resource id.
      const followupRoute = route.match(
        /^\/webhooks\/(\d+)\/([A-Za-z0-9_.-]+)$/,
      );
      if (req.method === "POST" && followupRoute) {
        let body;
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          return send(res, 400, { message: "Malformed followup body" });
        }
        postedMessages.push({
          id: `3000000000000${String(++messageCounter).padStart(4, "0")}`,
          channel_id: identities.channelId,
          content: body.content || "",
          embeds: body.embeds || [],
          components: body.components || [],
          interaction_token: followupRoute[2],
          timestamp: new Date().toISOString(),
        });
        return send(res, 200, { message: "Fixture followup accepted" });
      }
      unhandled.push(`${req.method} ${pathname}`);
      return send(res, 404, { message: "Unmodeled Discord fixture request" });
    } catch {
      unhandled.push(`${req.method} ${pathname}: malformed request`);
      return send(res, 400, { message: "Malformed fixture request" });
    }
  },
);

server.listen(
  Number(process.env.DISCORD_FIXTURE_PORT || 443),
  "0.0.0.0",
  () => {
    console.log(
      "Disposable Discord HTTPS fixture ready; credentials are never logged.",
    );
  },
);
