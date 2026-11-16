"use strict";

/*
 * Starts SandboxWorker.ts from its TypeScript, through ts-node with the
 * Runner's own tsconfig: what a Runner run from its sources uses (the
 * development image, the Runner's tests). The Runner's image runs the
 * worker's bundle instead (Dockerfile.tpl builds it), which loads no
 * TypeScript and starts in a fraction of the time.
 *
 * Plain JavaScript, because it runs before ts-node can.
 */

const path = require("path");

require("ts-node").register({
  project: path.join(__dirname, "..", "..", "tsconfig.json"),
  transpileOnly: true,
});

require("./SandboxWorker.ts");
