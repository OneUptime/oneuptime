"use strict";

/*
 * NO NETWORK FOR THE NAMES-AND-ADDRESSES MODEL'S THREAD.
 *
 * The model's thread (NameAddressModelWorker.cjs) holds the values the
 * scanner reads. Before it loads anything, it calls lockDownNetwork: from
 * then on fetch and the other web APIs, the net, tls, http, https, http2,
 * dns and dgram modules, and child processes all throw in that thread, and
 * each attempt is reported (by API, never with anything it was given) to
 * the scanner, which logs it. A worker thread has modules of its own, so
 * the process's other threads are untouched.
 *
 * NameAddressModelNetwork.test.ts runs this in a thread of its own and tries
 * every way out; the real model's test checks the model never tries one.
 */

const NETWORK_REFUSED =
  "The names-and-addresses model may not use the network.";

function lockDownNetwork(report) {
  function refuse(api) {
    return function refused() {
      report(api);
      throw new Error(NETWORK_REFUSED);
    };
  }

  function shut(target, names, prefix) {
    for (const name of names) {
      if (target && typeof target[name] === "function") {
        target[name] = refuse(prefix + name);
      }
    }
  }

  for (const name of ["fetch", "WebSocket", "EventSource", "XMLHttpRequest"]) {
    if (name in globalThis) {
      globalThis[name] = refuse(name);
    }
  }

  const net = require("net");

  shut(net, ["connect", "createConnection", "createServer"], "net.");
  shut(net.Socket.prototype, ["connect"], "net.Socket.");
  shut(require("tls"), ["connect", "createServer"], "tls.");
  shut(require("http"), ["request", "get", "createServer"], "http.");
  shut(require("https"), ["request", "get", "createServer"], "https.");
  shut(require("http2"), ["connect", "createServer"], "http2.");

  const dns = require("dns");
  const lookups = [
    "lookup",
    "lookupService",
    "resolve",
    "resolve4",
    "resolve6",
    "resolveAny",
    "resolveCaa",
    "resolveCname",
    "resolveMx",
    "resolveNaptr",
    "resolveNs",
    "resolvePtr",
    "resolveSoa",
    "resolveSrv",
    "resolveTxt",
    "reverse",
  ];

  shut(dns, lookups, "dns.");
  shut(dns.promises, lookups, "dns.promises.");
  shut(require("dgram"), ["createSocket"], "dgram.");
  shut(
    require("child_process"),
    [
      "spawn",
      "spawnSync",
      "exec",
      "execSync",
      "execFile",
      "execFileSync",
      "fork",
    ],
    "child_process.",
  );
}

module.exports = { lockDownNetwork, NETWORK_REFUSED };
