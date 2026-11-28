"use strict";

/*
 * A stand-in for GitHub's releases API, for Scripts/Release/AttachReleaseAssets.js
 * (Tests/Ops/AttachReleaseAssets.test.js): a release by its id, deleting an
 * asset by its id, and uploading to a release's upload URL. Like GitHub, it
 * takes an upload to a published release too (a repository without immutable
 * releases does), keeps each asset's size, state and SHA-256 digest, and
 * refuses a second asset of the same name with 422.
 *
 * `faults` make it fail as GitHub does: a request answered with an error, an
 * answer lost after the upload was kept, an upload cut short (state
 * "starter"), other bytes kept than were sent, a release published by
 * someone else between two requests.
 */

const crypto = require("crypto");
const http = require("http");

const REPOSITORY = "OneUptime/oneuptime";

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

class FakeGitHubReleases {
  constructor() {
    this.releases = new Map();
    this.nextAssetId = 1000;
    this.requests = [];
    this.uploadedBytes = new Map();
    // Each a function (request) => answer | undefined, tried in order: the
    // first that answers wins, and is used up when it says `once`.
    this.faults = [];
    // Called after each request is answered, for faults that change state.
    this.afterRequest = [];
  }

  addRelease({ id, tag, draft = true, assets = [] }) {
    const release = {
      id,
      tag_name: tag,
      name: tag,
      draft,
      prerelease: false,
      upload_url: `https://uploads.github.com/repos/${REPOSITORY}/releases/${id}/assets{?name,label}`,
      assets: [],
    };
    this.releases.set(id, release);
    for (const asset of assets) {
      this.addAsset(id, asset);
    }
    return release;
  }

  addAsset(releaseId, { name, bytes, state = "uploaded", digest }) {
    const buffer = Buffer.from(bytes);
    const asset = {
      id: this.nextAssetId++,
      name,
      size: buffer.length,
      state,
      digest: digest === undefined ? `sha256:${sha256(buffer)}` : digest,
    };
    this.releases.get(releaseId).assets.push(asset);
    this.uploadedBytes.set(asset.id, buffer);
    return asset;
  }

  release(id) {
    return this.releases.get(id);
  }

  assetNamed(releaseId, name) {
    return (this.releases.get(releaseId).assets || []).find((asset) => {
      return asset.name === name;
    });
  }

  // The requests that change anything: method and path.
  writes() {
    return this.requests.filter((request) => {
      return request.method !== "GET";
    });
  }

  async start() {
    this.server = http.createServer((request, response) => {
      const chunks = [];
      request.on("data", (chunk) => {
        chunks.push(chunk);
      });
      request.on("end", () => {
        const body = Buffer.concat(chunks);
        const url = new URL(request.url, "http://localhost");
        const seen = {
          method: request.method,
          path: url.pathname,
          name: url.searchParams.get("name"),
          authorization: request.headers.authorization,
          contentType: request.headers["content-type"],
          size: body.length,
        };
        this.requests.push(seen);
        const answer = this.answer(seen, body) || {
          status: 500,
          body: { message: "the stand-in has no answer" },
        };
        for (const after of this.afterRequest) {
          after(seen, answer);
        }
        if (answer.destroy) {
          request.socket.destroy();
          return;
        }
        response.writeHead(answer.status, {
          "Content-Type": "application/json",
        });
        response.end(
          answer.body === undefined ? "" : JSON.stringify(answer.body),
        );
      });
    });
    await new Promise((resolve) => {
      this.server.listen(0, "127.0.0.1", resolve);
    });
    this.url = `http://127.0.0.1:${this.server.address().port}`;
    return this;
  }

  async stop() {
    if (this.server) {
      await new Promise((resolve) => {
        this.server.close(resolve);
      });
    }
  }

  answer(seen, body) {
    for (const fault of [...this.faults]) {
      const answered = fault(seen, body);
      if (answered) {
        if (answered.once) {
          this.faults.splice(this.faults.indexOf(fault), 1);
        }
        if (answered.passThrough) {
          // Do what GitHub would, then answer as the fault says.
          this.handle(seen, body, answered);
          return answered.answer;
        }
        return answered;
      }
    }
    return this.handle(seen, body, {});
  }

  handle(seen, body, { keptBytes, keptState }) {
    const releaseMatch = new RegExp(
      `^/repos/${REPOSITORY}/releases/(\\d+)$`,
    ).exec(seen.path);
    if (seen.method === "GET" && releaseMatch) {
      const release = this.releases.get(Number(releaseMatch[1]));
      return release
        ? { status: 200, body: JSON.parse(JSON.stringify(release)) }
        : { status: 404, body: { message: "Not Found" } };
    }

    const assetMatch = new RegExp(
      `^/repos/${REPOSITORY}/releases/assets/(\\d+)$`,
    ).exec(seen.path);
    if (seen.method === "DELETE" && assetMatch) {
      const id = Number(assetMatch[1]);
      for (const release of this.releases.values()) {
        const index = release.assets.findIndex((asset) => {
          return asset.id === id;
        });
        if (index >= 0) {
          release.assets.splice(index, 1);
          return { status: 204 };
        }
      }
      return { status: 404, body: { message: "Not Found" } };
    }

    const uploadMatch = new RegExp(
      `^/repos/${REPOSITORY}/releases/(\\d+)/assets$`,
    ).exec(seen.path);
    if (seen.method === "POST" && uploadMatch) {
      const release = this.releases.get(Number(uploadMatch[1]));
      if (!release) {
        return { status: 404, body: { message: "Not Found" } };
      }
      if (
        release.assets.some((asset) => {
          return asset.name === seen.name;
        })
      ) {
        return {
          status: 422,
          body: {
            message: "Validation Failed",
            errors: [
              {
                resource: "ReleaseAsset",
                code: "already_exists",
                field: "name",
              },
            ],
          },
        };
      }
      const kept = keptBytes === undefined ? body : Buffer.from(keptBytes);
      const asset = this.addAsset(release.id, {
        name: seen.name,
        bytes: kept,
        state: keptState || "uploaded",
      });
      return { status: 201, body: asset };
    }

    return undefined;
  }
}

module.exports = { FakeGitHubReleases, REPOSITORY, sha256 };
