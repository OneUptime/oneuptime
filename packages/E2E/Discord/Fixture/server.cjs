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
// Threads created by POST /channels/{parent}/threads persist across
// channels() calls so subsequent GET /channels/{id} and message posts can
// resolve them, like a real guild.
let createdThreads = [];
let threadCounter = 0;
let seededChannels = [];
let seededMessages = [];
let directMessages = [];
let reactionUsers = [];
let webhookDestinations = [];
let auditLogEntries = [];
let guildCommands = [];
let commandCounter = 0;
let fault = null;
const redactPath = (value) =>
  value.replace(/(\/webhooks\/\d+\/)[^/?]+/g, "$1[redacted]");
const snowflakeOrder = (a, b) =>
  BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0;
const takeFault = (method, route) => {
  if (
    !fault ||
    fault.remaining === 0 ||
    fault.method !== method ||
    fault.path !== route
  )
    return null;
  const selected = { ...fault };
  fault.remaining = Math.max(0, (fault.remaining ?? 1) - 1);
  return selected;
};
const snapshot = () => ({
  scenario,
  events,
  unhandled,
  postedMessages,
  createdThreads,
  seededMessages,
  directMessages,
  dmChannels: directMessages.map((channel) => ({
    id: channel.id,
    recipient_id: channel.recipients[0].id,
  })),
  auditLogEntries,
  guildCommands,
});
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

const channels = () =>
  [
    ...seededChannels,
    ...directMessages,
    ...createdThreads,
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
      owner_id: ids.botId,
      thread_metadata: { archived: false, locked: false },
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
  ]
    .filter(
      (channel, index, all) =>
        all.findIndex((item) => item.id === channel.id) === index,
    )
    .filter((channel) => !channel.deleted);

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
          createdThreads = [];
          seededChannels = [];
          seededMessages = [];
          directMessages = [];
          reactionUsers = [];
          webhookDestinations = [];
          auditLogEntries = [];
          guildCommands = [];
          commandCounter = 0;
          fault = null;
          return send(res, 200, snapshot());
        }
        if (pathname === "/__fixture/seed" && req.method === "POST") {
          const input = JSON.parse(await readBody(req));
          for (const key of [
            "channels",
            "messages",
            "reactions",
            "webhooks",
            "auditLogEntries",
          ]) {
            if (input[key] !== undefined && !Array.isArray(input[key]))
              return send(res, 400, {
                error: "Seed collections must be arrays",
              });
          }
          if (
            input.messages?.some(
              (message) =>
                message.pinned &&
                (typeof message.pinned_at !== "string" ||
                  Number.isNaN(Date.parse(message.pinned_at))),
            )
          )
            return send(res, 400, {
              error: "Pinned messages require explicit pinned_at metadata",
            });
          if (input.channels) seededChannels = input.channels;
          if (input.messages) seededMessages = input.messages;
          if (input.reactions) reactionUsers = input.reactions;
          if (input.webhooks) {
            for (const webhook of input.webhooks) {
              webhookDestinations = webhookDestinations.filter(
                (item) =>
                  item.id !== webhook.id || item.token !== webhook.token,
              );
              webhookDestinations.push(webhook);
            }
          }
          if (input.auditLogEntries) auditLogEntries = input.auditLogEntries;
          if (input.fault !== undefined) fault = input.fault;
          return send(res, 200, snapshot());
        }
        if (pathname === "/__fixture/threads" && req.method === "POST") {
          const input = JSON.parse(await readBody(req));
          if (!/^\d{17,20}$/.test(input.id || ""))
            return send(res, 400, { error: "Thread id required" });
          let thread =
            createdThreads.find((item) => item.id === input.id) ||
            seededChannels.find((item) => item.id === input.id) ||
            channels().find((item) => item.id === input.id);
          if (!thread)
            thread = {
              id: input.id,
              type: 11,
              name: "seeded-thread",
              guild_id: ids.guildId,
              parent_id: ids.channelId,
              owner_id: ids.botId,
              thread_metadata: { archived: false, locked: false },
            };
          for (const key of [
            "name",
            "type",
            "owner_id",
            "guild_id",
            "parent_id",
            "deleted",
          ])
            if (input[key] !== undefined) thread[key] = input[key];
          thread.thread_metadata = {
            ...thread.thread_metadata,
            ...(typeof input.archived === "boolean"
              ? {
                  archived: input.archived,
                  archive_timestamp: new Date().toISOString(),
                }
              : {}),
            ...(typeof input.locked === "boolean"
              ? { locked: input.locked }
              : {}),
          };
          if (
            !createdThreads.includes(thread) &&
            !seededChannels.includes(thread)
          )
            seededChannels.push(thread);
          return send(res, 200, snapshot());
        }
        if (pathname === "/__fixture/scenario" && req.method === "POST") {
          const input = JSON.parse(await readBody(req));
          const aliases = {
            "thread-create-timeout": "create-timeout",
            "thread-create-500": "create500",
            "thread-create-accepted-500": "create-accepted-500",
            "thread-create-slow": "create-slow3s",
            "audit-log-forbidden": "audit-forbidden",
          };
          const selected = aliases[input.scenario] || input.scenario;
          const delayed =
            typeof selected === "string" &&
            selected.match(
              /^(?:thread-create-slow|channel-get-slow|channel-patch-slow):(\d+)$/,
            );
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
            "dm-blocked",
            "second-user",
            "create-timeout",
            "create500",
            "create-accepted-500",
            "create-slow3s",
            "deleted",
            "rename",
            "audit-forbidden",
            "message-content-disabled",
          ];
          if (
            !allowed.includes(selected) &&
            !(delayed && Number(delayed[1]) <= 15000)
          )
            return send(res, 400, { error: "Unknown scenario" });
          scenario = selected;
          return send(res, 200, snapshot());
        }
        return send(res, 404, { error: "Unknown control operation" });
      } catch {
        return send(res, 400, { error: "Invalid control request" });
      }
    }

    const providerEvent = {
      method: req.method,
      path: redactPath(pathname),
      status: null,
    };
    events.push(providerEvent);
    res.on("finish", () => {
      providerEvent.status = res.statusCode;
    });
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
            userId: scenario === "second-user" ? ids.secondUserId : ids.userId,
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
      // Discord authenticates webhook calls with the URL capability, not a bot header.
      const webhookRoute = route.match(
        /^\/webhooks\/(\d+)\/([A-Za-z0-9_.-]+)(?:\/messages\/(?:@original|\d+))?$/,
      );
      if (["POST", "PATCH"].includes(req.method) && webhookRoute) {
        const destination = webhookDestinations.find(
          (item) =>
            item.id === webhookRoute[1] && item.token === webhookRoute[2],
        );
        // Existing interaction specs mint only this explicitly disposable prefix.
        const legacyInteraction =
          webhookRoute[1] === ids.applicationId &&
          webhookRoute[2].startsWith("fixture-interaction-");
        if (!destination && !legacyInteraction)
          return send(res, 401, { message: "Unknown webhook", code: 10015 });
        const webhookFault = takeFault(req.method, route);
        if (webhookFault?.status)
          return send(
            res,
            webhookFault.status,
            webhookFault.body || { message: "Injected webhook rejection" },
          );
        const body = JSON.parse(await readBody(req));
        const message = {
          id: `3000000000000${String(++messageCounter).padStart(4, "0")}`,
          channel_id: destination?.channelId || ids.channelId,
          content: body.content || "",
          embeds: body.embeds || [],
          components: body.components || [],
          flags: body.flags || 0,
          webhook_id: webhookRoute[1],
          webhook_kind: destination?.kind || "interaction",
          timestamp: new Date().toISOString(),
        };
        postedMessages.push(message);
        if (webhookFault?.dropAfterAccept) return res.destroy();
        return send(res, 200, message);
      }
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
      const requestFault = takeFault(req.method, route);
      if (requestFault) {
        if (requestFault.status)
          return send(
            res,
            requestFault.status,
            requestFault.body || { message: "Injected provider rejection" },
          );
      }
      if (req.method === "GET" && route === "/users/@me") {
        if (!bot && activeScenario === "identity-failure")
          return send(res, 500, { message: "Fixture identity failure" });
        return send(res, 200, {
          id: bot ? ids.botId : grant.userId,
          username: bot
            ? "oneuptime-e2e-bot"
            : grant.userId === ids.secondUserId
              ? "discord-e2e-second-user"
              : ids.username,
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
      const commandRoute = route.match(
        /^\/applications\/(\d+)\/guilds\/(\d+)\/commands(?:\/(\d+))?$/,
      );
      if (bot && commandRoute) {
        if (
          commandRoute[1] !== ids.applicationId ||
          commandRoute[2] !== ids.guildId
        )
          return send(res, 404, { message: "Unknown Application or Guild" });
        const command = guildCommands.find(
          (item) => item.id === commandRoute[3],
        );
        if (commandRoute[3] && !command)
          return send(res, 404, {
            message: "Unknown Application Command",
            code: 10063,
          });
        if (req.method === "GET")
          return send(res, 200, command || guildCommands);
        if (req.method === "DELETE" && command) {
          guildCommands = guildCommands.filter((item) => item !== command);
          return send(res, 204, null);
        }
        if (
          (req.method === "POST" && !commandRoute[3]) ||
          (req.method === "PATCH" && command)
        ) {
          const body = JSON.parse(await readBody(req));
          if (
            req.method === "POST" &&
            (typeof body.name !== "string" || !body.name)
          )
            return send(res, 400, { message: "Command name required" });
          const existing =
            command ||
            guildCommands.find(
              (item) =>
                item.name === body.name && item.type === (body.type || 1),
            );
          const result = {
            ...(existing || {}),
            ...body,
            id:
              existing?.id ||
              `7000000000000${String(++commandCounter).padStart(4, "0")}`,
            application_id: ids.applicationId,
            guild_id: ids.guildId,
            type: body.type || existing?.type || 1,
          };
          if (existing)
            guildCommands = guildCommands.filter((item) => item !== existing);
          guildCommands.push(result);
          return send(res, 200, result);
        }
      }
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
          user: { id: grant.userId, username: ids.username },
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
        // Linked workspace user: the notification-rule engine resolves the
        // "who did this" prefix via Discord.getUsernameFromUserId now that
        // Discord is in getAllWorkspaceTypes.
        if (
          [`/members/${ids.userId}`, `/members/${ids.secondUserId}`].includes(
            suffix,
          )
        )
          return send(res, 200, {
            user: {
              id: suffix.split("/").at(-1),
              username: ids.username,
              global_name: ids.username,
            },
          });
        if (suffix === "/threads/active")
          return send(res, 200, {
            threads: channels().filter(
              (channel) =>
                channel.guild_id === guildId &&
                [11, 12].includes(channel.type) &&
                !channel.thread_metadata?.archived,
            ),
            members: [],
          });
        if (suffix === "/audit-logs") {
          if (activeScenario === "audit-forbidden")
            return send(res, 403, {
              message: "Missing Permissions",
              code: 50013,
            });
          const entries = auditLogEntries
            .filter(
              (entry) =>
                !target.searchParams.has("action_type") ||
                String(entry.action_type) ===
                  target.searchParams.get("action_type"),
            )
            .filter(
              (entry) =>
                !target.searchParams.has("before") ||
                BigInt(entry.id) < BigInt(target.searchParams.get("before")),
            )
            .sort((a, b) => -snowflakeOrder(a, b))
            .slice(0, Number(target.searchParams.get("limit") || 50));
          return send(res, 200, {
            audit_log_entries: entries,
            users: [{ id: ids.botId, bot: true }, { id: ids.userId }],
          });
        }
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
        if (activeScenario === "deleted" && [11, 12].includes(channel?.type))
          return send(res, 404, { message: "Unknown Channel", code: 10003 });
        if (activeScenario === "rename" && [11, 12].includes(channel?.type))
          channel.name = "renamed-by-admin";
        if (activeScenario.startsWith("channel-get-slow:"))
          await new Promise((resolve) =>
            setTimeout(resolve, Number(activeScenario.split(":")[1])),
          );
        return send(
          res,
          channel ? 200 : 404,
          channel || { message: "Unknown Channel", code: 10003 },
        );
      }
      if (req.method === "PATCH" && bot && channelRoute) {
        const channel = channels().find((item) => item.id === channelRoute[1]);
        if (!channel || ![11, 12].includes(channel.type))
          return send(res, 404, { message: "Unknown Thread", code: 10003 });
        const body = JSON.parse(await readBody(req));
        if (typeof body.name === "string") channel.name = body.name;
        channel.thread_metadata = {
          ...channel.thread_metadata,
          ...(typeof body.archived === "boolean"
            ? {
                archived: body.archived,
                archive_timestamp: new Date().toISOString(),
              }
            : {}),
          ...(typeof body.locked === "boolean" ? { locked: body.locked } : {}),
        };
        if (
          !seededChannels.includes(channel) &&
          !createdThreads.includes(channel)
        )
          seededChannels.push(channel);
        if (activeScenario.startsWith("channel-patch-slow:"))
          await new Promise((resolve) =>
            setTimeout(resolve, Number(activeScenario.split(":")[1])),
          );
        return send(res, 200, channel);
      }
      const archivedRoute = route.match(
        /^\/channels\/(\d+)\/threads\/archived\/(public|private)$/,
      );
      if (req.method === "GET" && bot && archivedRoute) {
        const before = target.searchParams.get("before");
        const rows = channels()
          .filter(
            (channel) =>
              channel.parent_id === archivedRoute[1] &&
              channel.type === (archivedRoute[2] === "private" ? 12 : 11) &&
              channel.thread_metadata?.archived,
          )
          .filter(
            (channel) =>
              !before || channel.thread_metadata.archive_timestamp < before,
          )
          .sort((a, b) =>
            b.thread_metadata.archive_timestamp.localeCompare(
              a.thread_metadata.archive_timestamp,
            ),
          );
        const limit = Number(target.searchParams.get("limit") || 50);
        return send(res, 200, {
          threads: rows.slice(0, limit),
          members: [],
          has_more: rows.length > limit,
        });
      }
      if (req.method === "POST" && bot && route === "/users/@me/channels") {
        const body = JSON.parse(await readBody(req));
        if (!/^\d{17,20}$/.test(body.recipient_id || ""))
          return send(res, 400, { message: "Invalid recipient" });
        let channel = directMessages.find(
          (item) => item.recipients[0].id === body.recipient_id,
        );
        if (!channel) {
          channel = {
            id: `5000000000000${String(directMessages.length + 1).padStart(4, "0")}`,
            type: 1,
            recipients: [{ id: body.recipient_id }],
          };
          directMessages.push(channel);
        }
        return send(res, 200, channel);
      }
      const allMessages = () => [...seededMessages, ...postedMessages];
      const pinsRoute = route.match(/^\/channels\/(\d+)\/(messages\/)?pins$/);
      if (req.method === "GET" && bot && pinsRoute) {
        if (!channels().some((item) => item.id === pinsRoute[1]))
          return send(res, 404, { message: "Unknown Channel", code: 10003 });
        const pins = allMessages()
          .filter(
            (message) => message.channel_id === pinsRoute[1] && message.pinned,
          )
          .map((message) => ({
            pinned_at: message.pinned_at,
            message,
          }))
          .filter(
            (pin) =>
              !target.searchParams.has("before") ||
              pin.pinned_at < target.searchParams.get("before"),
          )
          .sort((a, b) => b.pinned_at.localeCompare(a.pinned_at));
        const limit = Number(target.searchParams.get("limit") || 50);
        if (!Number.isInteger(limit) || limit < 1 || limit > 50)
          return send(res, 400, { message: "Invalid limit" });
        return send(
          res,
          200,
          pinsRoute[2]
            ? { items: pins.slice(0, limit), has_more: pins.length > limit }
            : pins.slice(0, limit).map((pin) => pin.message),
        );
      }
      const reactionRoute = route.match(
        /^\/channels\/(\d+)\/messages\/(\d+)\/reactions\/(.+)$/,
      );
      if (req.method === "GET" && bot && reactionRoute) {
        if (!channels().some((item) => item.id === reactionRoute[1]))
          return send(res, 404, { message: "Unknown Channel", code: 10003 });
        const emoji = decodeURIComponent(reactionRoute[3]);
        const record = reactionUsers.find(
          (item) =>
            item.channelId === reactionRoute[1] &&
            item.messageId === reactionRoute[2] &&
            item.emoji === emoji &&
            (item.type || 0) === Number(target.searchParams.get("type") || 0),
        );
        const limit = Number(target.searchParams.get("limit") || 25);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100)
          return send(res, 400, { message: "Invalid limit" });
        return send(
          res,
          200,
          (record?.users || [])
            .filter(
              (user) =>
                !target.searchParams.has("after") ||
                BigInt(user.id) > BigInt(target.searchParams.get("after")),
            )
            .sort(snowflakeOrder)
            .slice(0, limit),
        );
      }
      const singleMessageRoute = route.match(
        /^\/channels\/(\d+)\/messages\/(\d+)$/,
      );
      if (req.method === "GET" && bot && singleMessageRoute) {
        const message = allMessages().find(
          (item) =>
            item.channel_id === singleMessageRoute[1] &&
            item.id === singleMessageRoute[2],
        );
        return send(
          res,
          message ? 200 : 404,
          message || { message: "Unknown Message", code: 10008 },
        );
      }
      // Bot message posts: record the body so lifecycle specs can assert on
      // message content, then model a successful Discord message response.
      const messageRoute = route.match(/^\/channels\/(\d+)\/messages$/);
      if (req.method === "GET" && bot && messageRoute) {
        if (!channels().some((item) => item.id === messageRoute[1]))
          return send(res, 404, { message: "Unknown Channel", code: 10003 });
        const limit = Number(target.searchParams.get("limit") || 50);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100)
          return send(res, 400, { message: "Invalid limit" });
        const messages = allMessages()
          .filter((message) => message.channel_id === messageRoute[1])
          .filter(
            (message) =>
              !target.searchParams.has("before") ||
              BigInt(message.id) < BigInt(target.searchParams.get("before")),
          )
          .filter(
            (message) =>
              !target.searchParams.has("after") ||
              BigInt(message.id) > BigInt(target.searchParams.get("after")),
          )
          .sort((a, b) => -snowflakeOrder(a, b))
          .slice(0, limit)
          .map((message) =>
            activeScenario === "message-content-disabled" &&
            !message.author?.bot
              ? {
                  ...message,
                  content: "",
                  embeds: [],
                  attachments: [],
                  components: [],
                }
              : message,
          );
        return send(res, 200, messages);
      }
      if (req.method === "POST" && bot && messageRoute) {
        const channel = channels().find((item) => item.id === messageRoute[1]);
        if (!channel)
          return send(res, 404, { message: "Unknown Channel", code: 10003 });
        if (channel.type === 1 && activeScenario === "dm-blocked")
          return send(res, 403, {
            message: "Cannot send messages to this user",
            code: 50007,
          });
        if (
          channel.id === ids.deniedChannelId ||
          channel.thread_metadata?.locked
        )
          return send(res, 403, {
            message: "Missing Permissions",
            code: 50013,
          });
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
          allowed_mentions: body.allowed_mentions,
          author: { id: ids.botId, username: "oneuptime-e2e-bot", bot: true },
          timestamp: new Date().toISOString(),
        };
        postedMessages.push(message);
        return send(res, 200, message);
      }
      // Thread creation: OneUptime creates incident threads under the
      // configured parent channel via POST /channels/{parent}/threads.
      const threadRoute = route.match(/^\/channels\/(\d+)\/threads$/);
      if (req.method === "POST" && bot && threadRoute) {
        if (activeScenario === "create500")
          return send(res, 500, { message: "Fixture create failure" });
        const parent = channels().find((item) => item.id === threadRoute[1]);
        if (!parent)
          return send(res, 404, { message: "Unknown Channel", code: 10003 });
        if (parent.type !== 0)
          return send(res, 400, {
            message: "Thread parent must be a text channel",
          });
        let body;
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          return send(res, 400, { message: "Malformed thread body" });
        }
        const thread = {
          id: `4000000000000${String(++threadCounter).padStart(4, "0")}`,
          guild_id: parent.guild_id,
          type: body.type === 12 ? 12 : 11,
          name: body.name || "",
          parent_id: parent.id,
          permission_overwrites: [],
          owner_id: ids.botId,
          audit_reason: req.headers["x-audit-log-reason"]
            ? decodeURIComponent(req.headers["x-audit-log-reason"])
            : null,
          thread_metadata: {
            archived: false,
            locked: false,
            auto_archive_duration: body.auto_archive_duration || 1440,
            archive_timestamp: new Date().toISOString(),
          },
        };
        createdThreads.push(thread);
        auditLogEntries.push({
          id: thread.id,
          action_type: 110,
          target_id: thread.id,
          user_id: ids.botId,
          reason: req.headers["x-audit-log-reason"]
            ? decodeURIComponent(req.headers["x-audit-log-reason"])
            : null,
        });
        if (activeScenario === "create-accepted-500") {
          return send(res, 500, { message: "Fixture create failure after accept" });
        }
        if (requestFault?.dropAfterAccept) {
          providerEvent.outcome = "accepted-response-lost";
          return res.destroy();
        }
        const delay =
          requestFault?.delayMs ||
          (activeScenario === "create-timeout"
            ? 15000
            : activeScenario.startsWith("thread-create-slow:")
              ? Number(activeScenario.split(":")[1])
              : activeScenario === "create-slow3s"
                ? 3000
                : 0);
        if (delay)
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(delay, 15000)),
          );
        return send(res, 200, thread);
      }
      unhandled.push(`${req.method} ${redactPath(pathname)}`);
      return send(res, 404, { message: "Unmodeled Discord fixture request" });
    } catch {
      unhandled.push(
        `${req.method} ${redactPath(pathname)}: malformed request`,
      );
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
