// What grew between two heap snapshots, from the tables heap-summary.js
// writes with --json:
//
//   node heap-summary.js a.heapsnapshot 40 --json a.json
//   node heap-summary.js b.heapsnapshot 40 --json b.json
//   node heap-diff.js a.json b.json [top]
//
// Prints the change in total self size, by node type, and the constructors
// (or string kinds) that grew or shrank most, with their counts - the first
// place to look for something that grows with uptime. heap-summary.js
// --chains <constructor> on the later snapshot then says what holds them.
"use strict";

const fs = require("fs");

const [beforeFile, afterFile, topArgument] = process.argv.slice(2);
const top = Number(topArgument) > 0 ? Number(topArgument) : 30;

if (!beforeFile || !afterFile) {
  console.log(
    fs.readFileSync(__filename, "utf8").split("\n").slice(0, 12).join("\n"),
  );
  process.exit(1);
}

const before = JSON.parse(fs.readFileSync(beforeFile, "utf8"));
const after = JSON.parse(fs.readFileSync(afterFile, "utf8"));

function mb(bytes) {
  return (bytes / 1048576).toFixed(2).padStart(9);
}

function signed(value, digits) {
  const text = value.toFixed(digits);
  return (value >= 0 ? "+" + text : text).padStart(10);
}

console.log(
  `self size ${mb(before.total).trim()} -> ${mb(after.total).trim()} MB (${signed((after.total - before.total) / 1048576, 2).trim()} MB); nodes ${before.nodes} -> ${after.nodes}`,
);

console.log("\nBy node type (MB):");
const types = new Set([...Object.keys(before.byType), ...Object.keys(after.byType)]);
for (const type of [...types].sort((a, b) => {
  return (
    Math.abs((after.byType[b] || 0) - (before.byType[b] || 0)) -
    Math.abs((after.byType[a] || 0) - (before.byType[a] || 0))
  );
})) {
  const was = before.byType[type] || 0;
  const now = after.byType[type] || 0;
  console.log(`${mb(was)} ${mb(now)} ${signed((now - was) / 1048576, 2)}  ${type}`);
}

const names = new Set([...Object.keys(before.byName), ...Object.keys(after.byName)]);
const changes = [...names].map((name) => {
  const was = before.byName[name] || { size: 0, count: 0 };
  const now = after.byName[name] || { size: 0, count: 0 };
  return {
    name: name,
    size: now.size - was.size,
    count: now.count - was.count,
    now: now,
  };
});

console.log(`\nGrew most (MB, count change, count now):`);
for (const change of changes
  .filter((change) => change.size > 0)
  .sort((a, b) => b.size - a.size)
  .slice(0, top)) {
  console.log(
    `${signed(change.size / 1048576, 3)} ${signed(change.count, 0)} ${String(change.now.count).padStart(9)}  ${change.name}`,
  );
}

console.log(`\nShrank most (MB, count change):`);
for (const change of changes
  .filter((change) => change.size < 0)
  .sort((a, b) => a.size - b.size)
  .slice(0, Math.ceil(top / 3))) {
  console.log(
    `${signed(change.size / 1048576, 3)} ${signed(change.count, 0)}  ${change.name}`,
  );
}
