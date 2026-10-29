// Reads a V8 heap snapshot (heap-snapshot.js, Chrome DevTools, or
// node --heapsnapshot-signal) and says what holds the memory:
//
//   node --max-old-space-size=32000 heap-summary.js <file.heapsnapshot> [top]
//        [--modules] [--strings] [--chains <constructor or type>] [--json <out.json>]
//
// - self size by node type (objects, strings, code, arrays ...);
// - self size by constructor (or string kind: script sources, source maps,
//   JSON, other text);
// - retained sizes from the dominator tree (weak edges do not retain), and
//   for the <top> biggest retainers (default 40) the chain of dominators from
//   the root, each step named by the edge that reaches it; a Node Module on
//   the way is named by its file, so a cache shows which module keeps it;
// - with --modules, the retained size of every module's exports and of its
//   module object, summed by package (node_modules) or by OneUptime folder;
// - with --children, under each of the biggest retainers its five biggest
//   children in the dominator tree, each with the edge that reaches it;
// - with --strings, strings by what holds them (their first retainer);
// - with --chains, the nodes of one constructor (or node type) grouped by
//   their first five retainers;
// - with --scripts, the text of every script V8 keeps (its source), summed
//   by package (node_modules) or by OneUptime folder: what each part of the
//   module graph costs to hold;
// - with --json, the tables as JSON, which heap-diff.js compares;
// - with --find <prefix>, for each node whose name (a string's text, an
//   object's constructor) starts with the prefix, its shortest path of
//   strong retainers from the root (what keeps it alive), each step with
//   the closure or object it belongs to.
//
// A snapshot of the App is 1-3 GB: it is read whole into one Buffer, so the
// machine needs about three times the file in free memory.
"use strict";

const fs = require("fs");

const file = process.argv[2];
const top = Number(process.argv[3]) > 0 ? Number(process.argv[3]) : 40;
const showModules = process.argv.includes("--modules");

if (!file) {
  console.log(
    fs.readFileSync(__filename, "utf8").split("\n").slice(0, 18).join("\n"),
  );
  process.exit(1);
}

const buffer = fs.readFileSync(file);
let position = 0;

function find(text, from) {
  const at = buffer.indexOf(text, from);
  if (at < 0) {
    throw new Error(`${text} not found in ${file}`);
  }
  return at;
}

// The header: {"snapshot":{...meta...},\n"nodes":[
const nodesAt = find('"nodes":[', 0);
const header = buffer.toString("utf8", 0, nodesAt).replace(/,\s*$/u, "") + "}";
const snapshot = JSON.parse(header).snapshot;
const meta = snapshot.meta;
const NODE_FIELDS = meta.node_fields.length;
const EDGE_FIELDS = meta.edge_fields.length;
const NODE_TYPES = meta.node_types[0];
const EDGE_TYPES = meta.edge_types[0];
const nodeCount = snapshot.node_count;
const edgeCount = snapshot.edge_count;

function readNumbers(count, from) {
  // A JSON array of unsigned integers, from just after its "[".
  const values = new Float64Array(count);
  let index = 0;
  let current = 0;
  let inNumber = false;
  let at = from;
  for (; index < count; at++) {
    const byte = buffer[at];
    if (byte >= 48 && byte <= 57) {
      current = current * 10 + (byte - 48);
      inNumber = true;
    } else if (inNumber) {
      values[index++] = current;
      current = 0;
      inNumber = false;
    }
  }
  return { values, end: at };
}

const nodesRead = readNumbers(nodeCount * NODE_FIELDS, nodesAt + 9);
const nodes = nodesRead.values;
const edgesAt = find('"edges":[', nodesRead.end);
const edgesRead = readNumbers(edgeCount * EDGE_FIELDS, edgesAt + 9);
const edges = edgesRead.values;
position = find('"strings":[', edgesRead.end) + 11;

// The strings: a JSON array of JSON strings.
const strings = [];
while (position < buffer.length) {
  const byte = buffer[position];
  if (byte === 0x22) {
    let end = position + 1;
    for (;;) {
      const next = buffer[end];
      if (next === 0x5c) {
        end += 2;
        continue;
      }
      if (next === 0x22) {
        break;
      }
      end++;
    }
    strings.push(JSON.parse(buffer.toString("utf8", position, end + 1)));
    position = end + 1;
  } else if (byte === 0x5d) {
    break;
  } else {
    position++;
  }
}

const TYPE = meta.node_fields.indexOf("type");
const NAME = meta.node_fields.indexOf("name");
const ID = meta.node_fields.indexOf("id");
const SELF = meta.node_fields.indexOf("self_size");
const EDGE_COUNT = meta.node_fields.indexOf("edge_count");
const EDGE_TYPE = meta.edge_fields.indexOf("type");
const EDGE_NAME = meta.edge_fields.indexOf("name_or_index");
const EDGE_TO = meta.edge_fields.indexOf("to_node");
const WEAK = EDGE_TYPES.indexOf("weak");
const SHORTCUT = EDGE_TYPES.indexOf("shortcut");
const ELEMENT = EDGE_TYPES.indexOf("element");
const HIDDEN = EDGE_TYPES.indexOf("hidden");
const STRING_TYPES = new Set(
  ["string", "concatenated string", "sliced string"].map((name) => {
    return NODE_TYPES.indexOf(name);
  }),
);

const firstEdge = new Uint32Array(nodeCount + 1);
for (let node = 0, edge = 0; node < nodeCount; node++) {
  firstEdge[node] = edge;
  edge += nodes[node * NODE_FIELDS + EDGE_COUNT] * EDGE_FIELDS;
  firstEdge[node + 1] = edge;
}

function typeOf(node) {
  return NODE_TYPES[nodes[node * NODE_FIELDS + TYPE]];
}

function nameOf(node) {
  return strings[nodes[node * NODE_FIELDS + NAME]];
}

function selfOf(node) {
  return nodes[node * NODE_FIELDS + SELF];
}

function edgeName(edge) {
  const type = edges[edge + EDGE_TYPE];
  const name = edges[edge + EDGE_NAME];
  if (type === ELEMENT || type === HIDDEN) {
    return `[${name}]`;
  }
  return String(strings[name]);
}

function mb(bytes) {
  return (bytes / 1048576).toFixed(1).padStart(8);
}

function stringKind(text) {
  if (text.includes("sourceMappingURL=data:application/json")) {
    return "(script source with an inline source map)";
  }
  if (text.startsWith('{"version":3') || text.includes('"mappings":"')) {
    return "(source map JSON)";
  }
  if (text.startsWith("(function (exports, require, module")) {
    return "(script source)";
  }
  if (/^\s*[{[]/u.test(text)) {
    return "(JSON-like text)";
  }
  if (/^(import|export|"use strict"|\/\*|\/\/)/u.test(text)) {
    return "(source text)";
  }
  return "(other strings)";
}

// Self size by type, and by constructor (or string kind).
const byType = new Map();
const byName = new Map();
let total = 0;
for (let node = 0; node < nodeCount; node++) {
  const self = selfOf(node);
  total += self;
  const type = typeOf(node);
  byType.set(type, (byType.get(type) || 0) + self);
  const typeIndex = nodes[node * NODE_FIELDS + TYPE];
  const key = STRING_TYPES.has(typeIndex)
    ? stringKind(String(nameOf(node)))
    : `${type}: ${String(nameOf(node)).slice(0, 80)}`;
  const entry = byName.get(key) || { size: 0, count: 0 };
  entry.size += self;
  entry.count++;
  byName.set(key, entry);
}

console.log(
  `${file}: ${nodeCount} nodes, ${edgeCount} edges, ${mb(total).trim()} MB of self size`,
);
console.log("\nSelf size by node type (MB):");
for (const [type, size] of [...byType].sort((a, b) => b[1] - a[1])) {
  console.log(`${mb(size)}  ${type}`);
}
console.log("\nSelf size by constructor or string kind (MB, count):");
for (const [name, entry] of [...byName]
  .sort((a, b) => b[1].size - a[1].size)
  .slice(0, top)) {
  console.log(`${mb(entry.size)}  ${String(entry.count).padStart(9)}  ${name}`);
}

// Dominators (Cooper, Harvey and Kennedy), over every edge but weak ones,
// from the synthetic root (node 0).
const retainersCount = new Uint32Array(nodeCount + 1);
for (let edge = 0; edge < edges.length; edge += EDGE_FIELDS) {
  if (edges[edge + EDGE_TYPE] === WEAK) {
    continue;
  }
  retainersCount[edges[edge + EDGE_TO] / NODE_FIELDS]++;
}
const firstRetainer = new Uint32Array(nodeCount + 1);
for (let node = 0, sum = 0; node < nodeCount; node++) {
  firstRetainer[node] = sum;
  sum += retainersCount[node];
  firstRetainer[node + 1] = sum;
}
const retainers = new Uint32Array(firstRetainer[nodeCount]);
const filled = new Uint32Array(nodeCount);
for (let node = 0; node < nodeCount; node++) {
  for (
    let edge = firstEdge[node];
    edge < firstEdge[node + 1];
    edge += EDGE_FIELDS
  ) {
    if (edges[edge + EDGE_TYPE] === WEAK) {
      continue;
    }
    const to = edges[edge + EDGE_TO] / NODE_FIELDS;
    retainers[firstRetainer[to] + filled[to]++] = node;
  }
}

// Post-order from the root, iteratively.
const UNVISITED = 0xffffffff;
const postOrder = new Uint32Array(nodeCount).fill(UNVISITED);
const nodeAtOrder = new Uint32Array(nodeCount);
const stackNode = new Uint32Array(nodeCount);
const stackEdge = new Float64Array(nodeCount);
const visited = new Uint8Array(nodeCount);
let order = 0;
let depth = 0;
stackNode[0] = 0;
stackEdge[0] = firstEdge[0];
visited[0] = 1;
while (depth >= 0) {
  const node = stackNode[depth];
  let edge = stackEdge[depth];
  let pushed = false;
  for (; edge < firstEdge[node + 1]; edge += EDGE_FIELDS) {
    if (edges[edge + EDGE_TYPE] === WEAK) {
      continue;
    }
    const to = edges[edge + EDGE_TO] / NODE_FIELDS;
    if (!visited[to]) {
      visited[to] = 1;
      stackEdge[depth] = edge + EDGE_FIELDS;
      depth++;
      stackNode[depth] = to;
      stackEdge[depth] = firstEdge[to];
      pushed = true;
      break;
    }
  }
  if (!pushed) {
    postOrder[node] = order;
    nodeAtOrder[order] = node;
    order++;
    depth--;
  }
}
const reachable = order;
const rootOrder = postOrder[0];
const dominator = new Uint32Array(reachable).fill(UNVISITED);
dominator[rootOrder] = rootOrder;
let changed = true;
while (changed) {
  changed = false;
  for (let at = rootOrder - 1; at >= 0 && at !== UNVISITED; at--) {
    const node = nodeAtOrder[at];
    let candidate = UNVISITED;
    for (let r = firstRetainer[node]; r < firstRetainer[node + 1]; r++) {
      const retainerOrder = postOrder[retainers[r]];
      if (
        retainerOrder === UNVISITED ||
        dominator[retainerOrder] === UNVISITED
      ) {
        continue;
      }
      if (candidate === UNVISITED) {
        candidate = retainerOrder;
        continue;
      }
      let a = retainerOrder;
      let b = candidate;
      while (a !== b) {
        while (a < b) {
          a = dominator[a];
        }
        while (b < a) {
          b = dominator[b];
        }
      }
      candidate = a;
    }
    if (candidate !== UNVISITED && dominator[at] !== candidate) {
      dominator[at] = candidate;
      changed = true;
    }
  }
}

const retained = new Float64Array(reachable);
for (let at = 0; at < reachable; at++) {
  retained[at] += selfOf(nodeAtOrder[at]);
  if (at !== rootOrder) {
    retained[dominator[at]] += retained[at];
  }
}

// A Node Module object: named by its "id" (its file).
function moduleFile(node) {
  if (nameOf(node) !== "Module") {
    return null;
  }
  for (
    let edge = firstEdge[node];
    edge < firstEdge[node + 1];
    edge += EDGE_FIELDS
  ) {
    if (edgeName(edge) === "id" || edgeName(edge) === "filename") {
      return String(nameOf(edges[edge + EDGE_TO] / NODE_FIELDS));
    }
  }
  return null;
}

// A closure's script: shared -> (shared function info) -> script.
function closureFile(node) {
  for (
    let edge = firstEdge[node];
    edge < firstEdge[node + 1];
    edge += EDGE_FIELDS
  ) {
    if (edgeName(edge) !== "shared") {
      continue;
    }
    const shared = edges[edge + EDGE_TO] / NODE_FIELDS;
    for (
      let inner = firstEdge[shared];
      inner < firstEdge[shared + 1];
      inner += EDGE_FIELDS
    ) {
      const name = edgeName(inner);
      if (name === "script" || name === "script_or_debug_info") {
        const script = String(nameOf(edges[inner + EDGE_TO] / NODE_FIELDS));
        return script.replace(/^.*\/(node_modules|src)\//u, "");
      }
    }
  }
  return "";
}

function label(node) {
  const file = moduleFile(node);
  if (file) {
    return `Module ${file.replace(/^.*\/(node_modules|src)\//u, "")}`;
  }
  const type = typeOf(node);
  const name = String(nameOf(node)).replace(/\s+/gu, " ");
  if (type === "closure") {
    const script = closureFile(node);
    return `closure ${name.slice(0, 40) || "(anonymous)"}${script ? " in " + script : ""}`;
  }
  if (type === "object" && name === "system / Context") {
    // The scope of a closure: name one closure that has it as its context.
    for (let r = firstRetainer[node]; r < firstRetainer[node + 1]; r++) {
      const holder = retainers[r];
      if (typeOf(holder) === "closure") {
        const script = closureFile(holder);
        return `scope of ${String(nameOf(holder)).slice(0, 30) || "(anonymous)"}${script ? " in " + script : ""}`;
      }
    }
  }
  if (STRING_TYPES.has(nodes[node * NODE_FIELDS + TYPE])) {
    return `${type} "${name.slice(0, 50)}"`;
  }
  return `${type} ${name.slice(0, 60)}`;
}

function reachingEdge(from, to) {
  for (
    let edge = firstEdge[from];
    edge < firstEdge[from + 1];
    edge += EDGE_FIELDS
  ) {
    if (
      edges[edge + EDGE_TO] / NODE_FIELDS === to &&
      edges[edge + EDGE_TYPE] !== SHORTCUT
    ) {
      return edgeName(edge);
    }
  }
  return null;
}

function chain(at) {
  const steps = [];
  let current = at;
  while (current !== rootOrder && steps.length < 40) {
    const node = nodeAtOrder[current];
    const parent = nodeAtOrder[dominator[current]];
    const via = reachingEdge(parent, node);
    steps.push(`${via === null ? "~" : "." + via} -> ${label(node)}`);
    current = dominator[current];
  }
  return steps.reverse();
}

console.log(
  `\nRetained sizes: ${reachable} of ${nodeCount} nodes reachable, ${mb(retained[rootOrder]).trim()} MB retained by the root.`,
);
console.log(
  `\nThe biggest retainers (MB retained, MB self), with their dominator chains:`,
);
// The largest nodes whose retained size is not mostly one child's.
const candidates = [];
for (let at = 0; at < reachable; at++) {
  if (retained[at] > 1048576) {
    candidates.push(at);
  }
}
candidates.sort((a, b) => retained[b] - retained[a]);
const biggestChild = new Float64Array(reachable);
for (const at of candidates) {
  if (at !== rootOrder) {
    const parent = dominator[at];
    biggestChild[parent] = Math.max(biggestChild[parent], retained[at]);
  }
}
const showChildren = process.argv.includes("--children");
// The dominator tree's children of each big node, biggest first.
const childrenOf = new Map();
if (showChildren) {
  for (let at = 0; at < reachable; at++) {
    if (at === rootOrder || retained[at] < 65536) {
      continue;
    }
    const parent = dominator[at];
    if (!childrenOf.has(parent)) {
      childrenOf.set(parent, []);
    }
    childrenOf.get(parent).push(at);
  }
  for (const list of childrenOf.values()) {
    list.sort((a, b) => retained[b] - retained[a]);
  }
}
let shown = 0;
for (const at of candidates) {
  if (shown >= top) {
    break;
  }
  // Skip a step that only passes one big child on.
  if (biggestChild[at] > retained[at] * 0.8) {
    continue;
  }
  shown++;
  const node = nodeAtOrder[at];
  console.log(`\n${mb(retained[at])} ${mb(selfOf(node))}  ${label(node)}`);
  const steps = chain(at);
  for (const step of steps.slice(-8)) {
    console.log(`            ${step}`);
  }
  if (showChildren) {
    for (const child of (childrenOf.get(at) || []).slice(0, 5)) {
      const via = reachingEdge(node, nodeAtOrder[child]);
      console.log(
        `              ${mb(retained[child]).trim()} MB  ${via === null ? "~" : "." + via} -> ${label(nodeAtOrder[child])}`,
      );
    }
  }
}

if (process.argv.includes("--scripts")) {
  const byOwner = new Map();
  let scripts = 0;
  for (let node = 0; node < nodeCount; node++) {
    if (typeOf(node) !== "code") {
      continue;
    }
    const url = String(nameOf(node));
    if (
      !url.startsWith("/") &&
      !url.startsWith("file://") &&
      !url.startsWith("node:")
    ) {
      continue;
    }
    for (
      let edge = firstEdge[node];
      edge < firstEdge[node + 1];
      edge += EDGE_FIELDS
    ) {
      if (edgeName(edge) !== "source") {
        continue;
      }
      // A concatenated source counts its parts.
      let size = 0;
      const stack = [edges[edge + EDGE_TO] / NODE_FIELDS];
      while (stack.length > 0) {
        const part = stack.pop();
        size += selfOf(part);
        if (typeOf(part) === "concatenated string") {
          for (
            let inner = firstEdge[part];
            inner < firstEdge[part + 1];
            inner += EDGE_FIELDS
          ) {
            stack.push(edges[inner + EDGE_TO] / NODE_FIELDS);
          }
        }
      }
      let owner;
      const nm = url.lastIndexOf("node_modules/");
      if (nm >= 0) {
        const parts = url.slice(nm + 13).split("/");
        owner =
          "nm:" +
          (parts[0].startsWith("@") ? parts[0] + "/" + parts[1] : parts[0]);
      } else if (url.startsWith("node:")) {
        owner = "(node internals)";
      } else {
        owner = url
          .replace(/^file:\/\//u, "")
          .replace(/^\/usr\/src\//u, "")
          .split("/")
          .slice(0, 3)
          .join("/");
      }
      const entry = byOwner.get(owner) || { size: 0, count: 0 };
      entry.size += size;
      entry.count++;
      byOwner.set(owner, entry);
      scripts++;
      break;
    }
  }
  let all = 0;
  for (const entry of byOwner.values()) {
    all += entry.size;
  }
  console.log(
    `\nScript text by package or folder: ${scripts} scripts, ${mb(all).trim()} MB (MB, scripts):`,
  );
  for (const [owner, entry] of [...byOwner]
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, top)) {
    console.log(
      `${mb(entry.size)}  ${String(entry.count).padStart(6)}  ${owner}`,
    );
  }
}

const findAt = process.argv.indexOf("--find");
if (findAt >= 0) {
  const prefix = process.argv[findAt + 1];
  let found = 0;
  for (let node = 0; node < nodeCount && found < top; node++) {
    if (!String(nameOf(node)).startsWith(prefix)) {
      continue;
    }
    found++;
    console.log(`\n${label(node)}  self ${mb(selfOf(node)).trim()} MB`);
    // Breadth first up the retainers until the root: the shortest path.
    const cameFrom = new Map([[node, -1]]);
    const queue = [node];
    let reached = -1;
    for (let head = 0; head < queue.length && reached < 0; head++) {
      const current = queue[head];
      for (
        let r = firstRetainer[current];
        r < firstRetainer[current + 1];
        r++
      ) {
        const holder = retainers[r];
        if (cameFrom.has(holder)) {
          continue;
        }
        cameFrom.set(holder, current);
        if (holder === 0) {
          reached = holder;
          break;
        }
        queue.push(holder);
      }
    }
    const path = [];
    for (
      let step = reached;
      step >= 0 && step !== node;
      step = cameFrom.get(step)
    ) {
      path.push(step);
    }
    // path runs root -> ... -> the node's holder; print from the node up.
    let current = node;
    for (
      let index = path.length - 1;
      index >= 0 && index >= path.length - 40;
      index--
    ) {
      const holder = path[index];
      let via = "";
      for (
        let edge = firstEdge[holder];
        edge < firstEdge[holder + 1];
        edge += EDGE_FIELDS
      ) {
        if (edges[edge + EDGE_TO] / NODE_FIELDS === current) {
          via = edgeName(edge);
          break;
        }
      }
      // A context: name the closure that owns it, when one points at it.
      let owner = "";
      if (
        typeOf(holder) === "object" &&
        String(nameOf(holder)) === "system / Context"
      ) {
        for (
          let r = firstRetainer[holder];
          r < firstRetainer[holder + 1];
          r++
        ) {
          if (typeOf(retainers[r]) === "closure") {
            owner = ` (${label(retainers[r])})`;
            break;
          }
        }
      }
      console.log(`    <- .${via} of ${label(holder)}${owner}`);
      current = holder;
    }
  }
}

const jsonAt = process.argv.indexOf("--json");
if (jsonAt >= 0) {
  const retainersOut = [];
  for (const at of candidates.slice(0, 200)) {
    retainersOut.push({
      label: label(nodeAtOrder[at]),
      retained: retained[at],
      self: selfOf(nodeAtOrder[at]),
      chain: chain(at).slice(-8),
    });
  }
  fs.writeFileSync(
    process.argv[jsonAt + 1],
    JSON.stringify({
      file: file,
      nodes: nodeCount,
      total: total,
      byType: Object.fromEntries(byType),
      byName: Object.fromEntries(byName),
      retainers: retainersOut,
    }),
  );
  console.log(`\nwrote ${process.argv[jsonAt + 1]}`);
}

if (process.argv.includes("--strings")) {
  // Who holds the strings: each string's first strong retainer, as
  // "<retainer type> <retainer name> .<edge>".
  const holders = new Map();
  for (let node = 0; node < nodeCount; node++) {
    if (!STRING_TYPES.has(nodes[node * NODE_FIELDS + TYPE])) {
      continue;
    }
    let key = "(no retainer)";
    for (let r = firstRetainer[node]; r < firstRetainer[node + 1]; r++) {
      const holder = retainers[r];
      let via = "";
      for (
        let edge = firstEdge[holder];
        edge < firstEdge[holder + 1];
        edge += EDGE_FIELDS
      ) {
        if (edges[edge + EDGE_TO] / NODE_FIELDS === node) {
          via = edgeName(edge);
          if (
            edges[edge + EDGE_TYPE] === ELEMENT ||
            edges[edge + EDGE_TYPE] === HIDDEN
          ) {
            via = "[n]";
          }
          break;
        }
      }
      const holderType = typeOf(holder);
      const holderName =
        holderType === "code" ||
        STRING_TYPES.has(nodes[holder * NODE_FIELDS + TYPE])
          ? ""
          : String(nameOf(holder)).slice(0, 40);
      key = `${holderType} ${holderName} .${via}`;
      break;
    }
    const entry = holders.get(key) || { size: 0, count: 0, sample: "" };
    entry.size += selfOf(node);
    entry.count++;
    if (!entry.sample) {
      entry.sample = String(nameOf(node)).replace(/\s+/gu, " ").slice(0, 60);
    }
    holders.set(key, entry);
  }
  console.log("\nStrings by their first retainer (MB, count, a sample):");
  for (const [key, entry] of [...holders]
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, top)) {
    console.log(
      `${mb(entry.size)}  ${String(entry.count).padStart(8)}  ${key}  "${entry.sample}"`,
    );
  }
}

const chainsFor = process.argv.indexOf("--chains");
if (chainsFor >= 0) {
  // Group the nodes of one constructor (or type) by their first retainers,
  // five steps up: who holds them.
  const wanted = process.argv[chainsFor + 1];
  const groups = new Map();
  for (let node = 0; node < nodeCount; node++) {
    if (String(nameOf(node)) !== wanted && typeOf(node) !== wanted) {
      continue;
    }
    const steps = [];
    let current = node;
    for (let depth = 0; depth < 5; depth++) {
      let holder = -1;
      let via = "";
      for (
        let r = firstRetainer[current];
        r < firstRetainer[current + 1];
        r++
      ) {
        const candidate = retainers[r];
        if (candidate === current) {
          continue;
        }
        holder = candidate;
        for (
          let edge = firstEdge[holder];
          edge < firstEdge[holder + 1];
          edge += EDGE_FIELDS
        ) {
          if (edges[edge + EDGE_TO] / NODE_FIELDS === current) {
            via = edgeName(edge);
            if (
              edges[edge + EDGE_TYPE] === ELEMENT ||
              edges[edge + EDGE_TYPE] === HIDDEN
            ) {
              via = "[n]";
            }
            break;
          }
        }
        break;
      }
      if (holder < 0) {
        break;
      }
      steps.push(`${label(holder)}.${via}`);
      current = holder;
    }
    const key = steps.join(" <- ");
    const entry = groups.get(key) || { size: 0, count: 0 };
    entry.size += selfOf(node);
    entry.count++;
    groups.set(key, entry);
  }
  console.log(`\nWho holds ${wanted} (MB, count, first five retainers):`);
  for (const [key, entry] of [...groups]
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, top)) {
    console.log(
      `${mb(entry.size)}  ${String(entry.count).padStart(8)}  ${key}`,
    );
  }
}

if (showModules) {
  // What each module object retains (its exports and its own fields).
  const byPackage = new Map();
  const perModule = [];
  for (let at = 0; at < reachable; at++) {
    const node = nodeAtOrder[at];
    const file = moduleFile(node);
    if (!file) {
      continue;
    }
    perModule.push([file, retained[at]]);
    let key;
    const nm = file.lastIndexOf("node_modules/");
    if (nm >= 0) {
      const parts = file.slice(nm + 13).split("/");
      key =
        "nm:" +
        (parts[0].startsWith("@") ? parts[0] + "/" + parts[1] : parts[0]);
    } else {
      key = file
        .replace(/^\/usr\/src\//u, "")
        .split("/")
        .slice(0, 3)
        .join("/");
    }
    byPackage.set(key, (byPackage.get(key) || 0) + retained[at]);
  }
  console.log("\nRetained by module objects, by package or folder (MB):");
  for (const [key, size] of [...byPackage]
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)) {
    console.log(`${mb(size)}  ${key}`);
  }
  console.log("\nThe modules retaining the most (MB):");
  for (const [name, size] of perModule
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)) {
    console.log(`${mb(size)}  ${name}`);
  }
}
