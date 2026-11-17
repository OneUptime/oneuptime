// Tells this OneUptime how a run of `npm run backup` went (backup.sh calls it).

const fs = require("fs");
const http = require("http");
const https = require("https");
const { ingressUrlOf } = require("./FollowIngressPort");
const { isPlaceholderValue } = require("./ReplacePlaceholderSecrets");

/*
 * WHY
 *
 * On the Community Edition a server's backups are `npm run backup`: a
 * pg_dump into the Backups folder. The server knew nothing of it, so the
 * Admin Dashboard's Server Setup could only take the admin's word that the
 * server is backed up (#7026). Now backup.sh, once pg_dump is done, runs
 * this with how it went, and the server keeps it: Server Setup then says
 * "Backed up with npm run backup", that the last backup failed, or that it
 * is more than a week old.
 *
 * WHAT IT SENDS, AND TO WHOM
 *
 * Whether pg_dump finished and wrote a dump that is not empty, and the
 * dump's size: { succeeded, sizeInBytes }. Never a path, a host or a
 * password. The server keeps the time it was told.
 *
 * It asks the ingress on this server (ONEUPTIME_HTTP_PORT, as `npm run
 * doctor` does), never HOST, with the cluster key from config.env
 * (ONEUPTIME_SECRET) in the clusterkey header, URI-encoded, as every request
 * that presents the key does: POST /api/admin/health/backup-run. Only the
 * server's operator holds that key, so nobody else can mark the server as
 * backed up. Node's http, which never follows a redirect, so the key's
 * header goes nowhere else.
 *
 * NEVER CHANGES HOW THE BACKUP WENT
 *
 * The backup is done before this runs, and backup.sh's exit status is the
 * backup's. A server that cannot be told - stopped, an older release that
 * answers 404, a key it does not take - is said in one line, and the backup
 * stays in its folder.
 *
 *   node Scripts/Install/BackupScriptRun.js <pg_dump's exit status> <the dump>
 *
 * backup.sh runs it through Scripts/Install/WithConfig.sh, so config.env's
 * settings are in its environment. CommonJS with no dependencies and no
 * syntax newer than Node.js 12, as the other install scripts. Every effect
 * is passed in to run(), so the tests run it without a server.
 */

// Where the server takes it: Common/Types/Backup/BackupScriptRun's BACKUP_SCRIPT_RUN_URL_PATH.
const BACKUP_SCRIPT_RUN_PATH = "/api/admin/health/backup-run";

const REQUEST_TIMEOUT_MS = 10 * 1000;

/*
 * Pure: how the run went, from pg_dump's exit status and the dump's size
 * (null when there is no dump to measure).
 */
const backupOutcomeOf = (exitStatus, sizeInBytes) => {
  const succeeded =
    String(exitStatus).trim() === "0" &&
    typeof sizeInBytes === "number" &&
    sizeInBytes > 0;

  return {
    succeeded: succeeded,
    sizeInBytes: succeeded ? sizeInBytes : null,
  };
};

// The size of the dump, or null when it is not there.
const defaultSizeOf = (file) => {
  try {
    return fs.statSync(file).size;
  } catch (_error) {
    return null;
  }
};

/*
 * Pure: the one line to print for the server's answer, and whether the
 * server was told.
 */
const describeAnswer = (answer, outcome, ingressUrl) => {
  if (!answer || answer.error) {
    return {
      told: false,
      line: `OneUptime did not answer at ${ingressUrl} (${(answer && answer.error) || "no answer"}), so it was not told about this backup. Start it with npm start, and the next backup tells it.`,
    };
  }

  if (answer.status === 200) {
    return {
      told: true,
      line: outcome.succeeded
        ? "OneUptime was told about this backup: Server Setup in the Admin Dashboard shows when the last one finished."
        : "OneUptime was told that this backup failed: Server Setup in the Admin Dashboard says so until a backup succeeds.",
    };
  }

  if (answer.status === 404) {
    return {
      told: false,
      line: "This OneUptime does not record backups yet, so Server Setup still asks whether the server is backed up. Update it with npm run update, and the next backup tells it.",
    };
  }

  if (answer.status >= 400 && answer.status < 500) {
    return {
      told: false,
      line: `OneUptime did not accept ONEUPTIME_SECRET from config.env (HTTP ${answer.status}), so it was not told about this backup. Run npm run doctor to see why.`,
    };
  }

  return {
    told: false,
    line: `OneUptime could not record this backup (HTTP ${answer.status}). Run npm run doctor to see why.`,
  };
};

/*
 * Sends options.body as JSON, with options.method: { status, json } or
 * { error } (an error code). It never follows a redirect and waits
 * REQUEST_TIMEOUT_MS at most.
 */
const defaultRequest = (url, options) => {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (answer) => {
      if (!settled) {
        settled = true;
        resolve(answer);
      }
    };

    let request;

    try {
      const client = url.indexOf("https:") === 0 ? https : http;
      const body = JSON.stringify(options.body);
      const headers = Object.assign(
        {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        options.headers || {},
      );

      request = client.request(
        url,
        {
          method: options.method || "POST",
          headers: headers,
          timeout: REQUEST_TIMEOUT_MS,
        },
        (response) => {
          let text = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => {
            if (text.length < 64 * 1024) {
              text += chunk;
            }
          });
          response.on("end", () => {
            let json = null;

            try {
              json = JSON.parse(text);
            } catch (_error) {
              json = null;
            }

            finish({ status: response.statusCode, json: json });
          });
        },
      );

      request.on("timeout", () => {
        request.destroy();
        finish({ error: "ETIMEDOUT" });
      });
      request.on("error", (error) => {
        finish({ error: (error && error.code) || "ERROR" });
      });
      request.end(body);
    } catch (error) {
      finish({ error: (error && error.code) || "EINVAL" });
    }
  });
};

/*
 * Tells the server, and prints what happened: 0 when it was told, 1 when it
 * was not. backup.sh ignores which.
 */
const run = async (given) => {
  const argv = given.argv || [];
  const env = given.env || {};
  const print = given.print || console.log;
  const request = given.request || defaultRequest;
  const sizeOf = given.sizeOf || defaultSizeOf;

  const file = argv[1] ? String(argv[1]) : "";
  const outcome = backupOutcomeOf(argv[0], file ? sizeOf(file) : null);
  const secret = String(env.ONEUPTIME_SECRET || "").trim();
  const ingress = ingressUrlOf(env.ONEUPTIME_HTTP_PORT);
  const ingressUrl = ingress ? ingress.url : "http://localhost";

  if (secret && !isPlaceholderValue(secret)) {
    /*
     * A POST, as every request that presents the cluster key, and the key
     * URI-encoded, as the app presents its own and compares what it is
     * sent (ClusterKeyAuthorization.getClusterKey). The body says only how
     * the run went.
     */
    const answer = await request(`${ingressUrl}${BACKUP_SCRIPT_RUN_PATH}`, {
      method: "POST",
      headers: { clusterkey: encodeURIComponent(secret) },
      body: outcome,
    });

    const said = describeAnswer(answer, outcome, ingressUrl);

    print(said.line);

    return said.told ? 0 : 1;
  }

  print(
    "config.env has no ONEUPTIME_SECRET of its own, so OneUptime was not told about this backup. npm start sets one.",
  );

  return 1;
};

module.exports = {
  BACKUP_SCRIPT_RUN_PATH,
  backupOutcomeOf,
  describeAnswer,
  run,
};

if (require.main === module) {
  run({ argv: process.argv.slice(2), env: process.env })
    .then((code) => {
      process.exit(code);
    })
    .catch((error) => {
      console.log(
        `OneUptime was not told about this backup: ${(error && error.message) || error}`,
      );
      process.exit(1);
    });
}
