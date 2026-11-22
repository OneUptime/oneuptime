"use strict";

/**
 * OneUptime's repository on GitHub, as the Terraform provider's release
 * notes read it (Scripts/TerraformProvider/GenerateReleaseNotes.js, through
 * Scripts/Release/GenerateReleaseNotes.js): the commits between two refs,
 * the pull requests that brought each, and the releases. Answered from what
 * a test gives it, as a fetcher for the notes run in the test's own process,
 * or over HTTP for the notes run by publish-terraform-provider.sh
 * (GITHUB_API_URL).
 */

const http = require("http");

function shaOf(number) {
  return number.toString(16).padStart(40, "0");
}

function commitNamed(number, subject, options = {}) {
  return {
    sha: shaOf(number),
    commit: { message: `${subject}\n\nThe rest of the message.` },
    parents: Array.from({ length: options.parents || 1 }, () => {
      return { sha: "parent" };
    }),
    author:
      options.author === undefined ? { login: "simlarsen" } : options.author,
  };
}

function pullRequest(number, title, options = {}) {
  return {
    number,
    title,
    merged: options.merged !== false,
    baseRefName: options.base || "main",
    author:
      options.author === undefined
        ? { __typename: "User", login: "simlarsen" }
        : options.author,
    labels: {
      nodes: (options.labels || []).map((name) => {
        return { name };
      }),
    },
  };
}

function answer(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      return body;
    },
    text: async () => {
      return JSON.stringify(body);
    },
  };
}

/**
 * @param {Object} world
 * @param {Object<string, Array>} world.ranges - "from...to" to its commits;
 *        a range that is not here answers 404, as GitHub does for a ref it
 *        does not have
 * @param {Object<string, Array>} [world.pullRequestsOf] - a commit's sha to
 *        the pull requests that brought it
 * @param {Array} [world.releases] - OneUptime's releases, as REST lists them
 * @param {Array<number|Error>} [world.failures] - the first answers: a
 *        status, or an error thrown
 * @returns {{fetcher: Function, requests: Array<{url: string, authorization: string}>}}
 */
function fakeOneUptimeGitHub({
  ranges,
  pullRequestsOf = {},
  releases = [],
  failures = [],
}) {
  const requests = [];
  const pending = [...failures];

  async function fetcher(url, init = {}) {
    const headers = init.headers || {};
    requests.push({
      url,
      authorization: headers.Authorization || headers.authorization || "",
    });

    if (pending.length > 0) {
      const failure = pending.shift();
      if (failure instanceof Error) {
        throw failure;
      }
      return answer(failure, { message: "Not this time" });
    }

    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/graphql")) {
      const query = JSON.parse(init.body).query;
      const repository = {};
      (query.match(/oid: "[0-9a-f]+"/g) || []).forEach((oid, index) => {
        repository[`commit${index}`] = {
          associatedPullRequests: {
            nodes: pullRequestsOf[oid.slice(6, -1)] || [],
          },
        };
      });
      return answer(200, { data: { repository } });
    }

    const compare = /\/repos\/OneUptime\/oneuptime\/compare\/(.+)$/.exec(
      parsed.pathname,
    );
    if (compare) {
      const range = decodeURIComponent(compare[1]);
      const commits = ranges[range];
      if (!commits) {
        return answer(404, { message: "Not Found" });
      }
      const page = Number(parsed.searchParams.get("page") || 1);
      return answer(200, {
        total_commits: commits.length,
        commits: commits.slice((page - 1) * 100, page * 100),
      });
    }

    if (parsed.pathname === "/repos/OneUptime/oneuptime/releases") {
      return answer(200, releases);
    }

    return answer(404, { message: `Nothing answers ${url}` });
  }

  return { fetcher, requests };
}

/**
 * The same, over HTTP on 127.0.0.1, for a process the test starts.
 * @param {ReturnType<typeof fakeOneUptimeGitHub>} fake
 * @returns {Promise<{url: string, close: Function}>}
 */
function serveFakeGitHub(fake) {
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => {
      chunks.push(chunk);
    });
    request.on("end", async () => {
      const url = `http://127.0.0.1${request.url}`;
      const answered = await fake.fetcher(url, {
        method: request.method,
        headers: { Authorization: request.headers.authorization || "" },
        body: Buffer.concat(chunks).toString("utf8") || undefined,
      });
      response.writeHead(answered.status, {
        "Content-Type": "application/json",
      });
      response.end(await answered.text());
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => {
          return new Promise((done) => {
            server.close(done);
          });
        },
      });
    });
  });
}

module.exports = {
  answer,
  commitNamed,
  fakeOneUptimeGitHub,
  pullRequest,
  serveFakeGitHub,
  shaOf,
};
