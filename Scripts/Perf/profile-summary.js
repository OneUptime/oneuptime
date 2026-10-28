// Reads a .cpuprofile (cpu-profile.js, node --cpu-prof, or an in-process
// inspector session) the way this folder's README uses it:
//
//   node profile-summary.js summary <profile> [top] [inclusivePattern]
//     self time by package and by function; each sample charged to the
//     deepest OneUptime frame on its stack (so time in a library counts for
//     the OneUptime code that called it); inclusive time per OneUptime file;
//     with a pattern, inclusive time of the functions it matches.
//   node profile-summary.js callers <profile> <functionPattern> [depth] [top]
//     the chains of callers above a function, by time.
//   node profile-summary.js timeline <profile> [bucketSeconds]
//     main-thread busy time per bucket: the once-a-minute bursts of the jobs.
//   node profile-summary.js window <profile> <fromSecond> <toSecond>
//     the top OneUptime frames inside one window of the timeline.
//
// OneUptime's code is what the images put under /usr/src/app and
// /usr/src/Common (stack.sh lays them out the same way); anything under
// node_modules is a library, named by its package.
"use strict";

const fs = require("fs");

const [mode, file, ...rest] = process.argv.slice(2);

if (!mode || !file) {
  console.log(
    fs.readFileSync(__filename, "utf8").split("\n").slice(0, 18).join("\n"),
  );
  process.exit(1);
}

const profile = JSON.parse(fs.readFileSync(file, "utf8"));
const nodes = new Map();
const parent = new Map();

for (const node of profile.nodes) {
  nodes.set(node.id, node);
}

for (const node of profile.nodes) {
  for (const child of node.children || []) {
    parent.set(child, node.id);
  }
}

const durationMs = (profile.endTime - profile.startTime) / 1000;
const msPerSample = durationMs / profile.samples.length;

function shortUrl(url) {
  if (!url) {
    return "(native)";
  }

  const at = url.lastIndexOf("node_modules/");

  if (at >= 0) {
    const parts = url.slice(at + "node_modules/".length).split("/");
    return (
      "nm:" + (parts[0].startsWith("@") ? parts[0] + "/" + parts[1] : parts[0])
    );
  }

  return url.split("file:///usr/src/").join("").split("/usr/src/").join("");
}

function isOwn(url) {
  return (
    Boolean(url) &&
    !url.includes("node_modules/") &&
    (url.includes("/usr/src/Common/") || url.includes("/usr/src/app/"))
  );
}

function label(callFrame) {
  return `${callFrame.functionName || "(anon)"} ${shortUrl(callFrame.url)}:${callFrame.lineNumber}`;
}

function selfSamples() {
  const counts = new Map();

  for (const id of profile.samples) {
    counts.set(id, (counts.get(id) || 0) + 1);
  }

  return counts;
}

function print(title, map, busy, top) {
  console.log(`\n== ${title} (percent of busy time)`);
  [...map.entries()]
    .sort((a, b) => {
      return b[1] - a[1];
    })
    .slice(0, top)
    .forEach(([key, count]) => {
      console.log(
        `${(count * msPerSample).toFixed(0).padStart(8)} ms ${((count / busy) * 100).toFixed(1).padStart(5)}%  ${key}`,
      );
    });
}

function summary() {
  const top = Number(rest[0] || "40");
  const pattern = rest[1] ? new RegExp(rest[1]) : null;
  const byFunction = new Map();
  const byPackage = new Map();
  const byOwnFrame = new Map();
  const byOwnFile = new Map();
  const inclusive = new Map();
  let idle = 0;
  let collecting = 0;

  for (const [id, count] of selfSamples()) {
    const callFrame = nodes.get(id).callFrame;

    if (callFrame.functionName === "(idle)") {
      idle += count;
      continue;
    }

    if (callFrame.functionName === "(garbage collector)") {
      collecting += count;
    }

    byFunction.set(
      label(callFrame),
      (byFunction.get(label(callFrame)) || 0) + count,
    );
    byPackage.set(
      shortUrl(callFrame.url),
      (byPackage.get(shortUrl(callFrame.url)) || 0) + count,
    );

    let current = id;
    let ownFrame = null;
    const files = new Set();
    const matched = new Set();

    while (current !== undefined) {
      const frame = nodes.get(current).callFrame;

      if (isOwn(frame.url)) {
        ownFrame = ownFrame || label(frame);
        files.add(shortUrl(frame.url));
      }

      const name = `${frame.functionName || "(anon)"} ${shortUrl(frame.url)}`;

      if (pattern && pattern.test(name) && !matched.has(name)) {
        matched.add(name);
        inclusive.set(name, (inclusive.get(name) || 0) + count);
      }

      current = parent.get(current);
    }

    const key = ownFrame || `(no OneUptime frame) ${shortUrl(callFrame.url)}`;
    byOwnFrame.set(key, (byOwnFrame.get(key) || 0) + count);

    for (const each of files) {
      byOwnFile.set(each, (byOwnFile.get(each) || 0) + count);
    }
  }

  const busy = profile.samples.length - idle;

  console.log(
    `${durationMs.toFixed(0)} ms profiled, ${((busy * msPerSample) / 1000).toFixed(1)} s busy on the main thread ` +
      `(${((busy / profile.samples.length) * 100).toFixed(1)}% of a core), garbage collection ${((collecting * msPerSample) / 1000).toFixed(1)} s`,
  );
  print("self time by package", byPackage, busy, top);
  print("self time by function", byFunction, busy, top);
  print("charged to the deepest OneUptime frame", byOwnFrame, busy, top);
  print("inclusive time per OneUptime file", byOwnFile, busy, top);

  if (pattern) {
    print(
      `inclusive time of functions matching ${pattern}`,
      inclusive,
      busy,
      top,
    );
  }
}

function callers() {
  const pattern = new RegExp(rest[0]);
  const depth = Number(rest[1] || "6");
  const top = Number(rest[2] || "15");
  const chains = new Map();
  let matched = 0;

  for (const id of profile.samples) {
    let current = id;
    let found = null;

    while (current !== undefined) {
      const frame = nodes.get(current).callFrame;

      if (
        pattern.test(`${frame.functionName || "(anon)"} ${shortUrl(frame.url)}`)
      ) {
        found = current;
      }

      current = parent.get(current);
    }

    if (found === null) {
      continue;
    }

    matched++;
    const chain = [];
    let up = found;

    for (let level = 0; level <= depth && up !== undefined; level++) {
      chain.push(label(nodes.get(up).callFrame));
      up = parent.get(up);
    }

    const key = chain.join("\n      <- ");
    chains.set(key, (chains.get(key) || 0) + 1);
  }

  console.log(`matched ${((matched * msPerSample) / 1000).toFixed(2)} s`);
  [...chains.entries()]
    .sort((a, b) => {
      return b[1] - a[1];
    })
    .slice(0, top)
    .forEach(([key, count]) => {
      console.log(
        `${((count * msPerSample) / 1000).toFixed(2).padStart(7)} s  ${key}\n`,
      );
    });
}

function timeline() {
  const bucket = Number(rest[0] || "5");
  const buckets = new Map();
  let time = profile.startTime;

  for (let index = 0; index < profile.samples.length; index++) {
    time += profile.timeDeltas[index];
    const frame = nodes.get(profile.samples[index]).callFrame;

    if (frame.functionName === "(idle)") {
      continue;
    }

    const at = Math.floor((time - profile.startTime) / 1e6 / bucket);
    buckets.set(
      at,
      (buckets.get(at) || 0) + (profile.timeDeltas[index + 1] || 0) / 1000,
    );
  }

  for (const at of [...buckets.keys()].sort((a, b) => {
    return a - b;
  })) {
    const ms = buckets.get(at);
    console.log(
      `${String(at * bucket).padStart(5)}s ${ms.toFixed(0).padStart(6)} ms ${"#".repeat(Math.min(100, Math.round(ms / (bucket * 10))))}`,
    );
  }
}

function window() {
  const from = Number(rest[0]);
  const to = Number(rest[1]);
  const frames = new Map();
  let time = profile.startTime;

  for (let index = 0; index < profile.samples.length; index++) {
    time += profile.timeDeltas[index];
    const second = (time - profile.startTime) / 1e6;
    const id = profile.samples[index];

    if (
      second < from ||
      second >= to ||
      nodes.get(id).callFrame.functionName === "(idle)"
    ) {
      continue;
    }

    const chain = [];
    let current = id;

    while (current !== undefined && chain.length < 3) {
      const frame = nodes.get(current).callFrame;

      if (isOwn(frame.url)) {
        chain.push(label(frame));
      }

      current = parent.get(current);
    }

    const key = chain.length
      ? chain.join(" <- ")
      : `(no OneUptime frame) ${label(nodes.get(id).callFrame)}`;
    frames.set(
      key,
      (frames.get(key) || 0) + (profile.timeDeltas[index + 1] || 0) / 1000,
    );
  }

  [...frames.entries()]
    .sort((a, b) => {
      return b[1] - a[1];
    })
    .slice(0, 40)
    .forEach(([key, ms]) => {
      console.log(`${ms.toFixed(0).padStart(7)} ms  ${key}`);
    });
}

const modes = { summary, callers, timeline, window };

if (!Object.prototype.hasOwnProperty.call(modes, mode)) {
  throw new Error(
    `unknown mode "${mode}": summary, callers, timeline or window`,
  );
}

modes[mode]();
