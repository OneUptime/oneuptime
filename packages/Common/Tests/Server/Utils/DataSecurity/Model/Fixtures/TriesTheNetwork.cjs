"use strict";

/*
 * A worker thread that shuts the network as the names-and-addresses model's
 * thread does (NameAddressModelNetworkLockdown.cjs), then tries every way
 * out, and says which threw, with what, and what the lockdown reported.
 */

const { parentPort, workerData } = require("worker_threads");
const { lockDownNetwork, NETWORK_REFUSED } = require(workerData.lockdownPath);

const reported = [];

lockDownNetwork((api) => {
  reported.push(api);
});

const attempts = {
  fetch: () => {
    return fetch("https://example.com/");
  },
  "http.request": () => {
    return require("http").request("http://example.com/");
  },
  "http.get": () => {
    return require("http").get("http://example.com/");
  },
  "https.request": () => {
    return require("https").request("https://example.com/");
  },
  "https.get": () => {
    return require("https").get("https://example.com/");
  },
  "http2.connect": () => {
    return require("http2").connect("https://example.com/");
  },
  "net.connect": () => {
    return require("net").connect(443, "example.com");
  },
  "net.createConnection": () => {
    return require("net").createConnection(443, "example.com");
  },
  "net.Socket.connect": () => {
    const net = require("net");

    return new net.Socket().connect(443, "example.com");
  },
  "tls.connect": () => {
    return require("tls").connect(443, "example.com");
  },
  "dns.lookup": () => {
    return require("dns").lookup("example.com", () => {});
  },
  "dns.resolve4": () => {
    return require("dns").resolve4("example.com", () => {});
  },
  "dns.promises.lookup": () => {
    return require("dns").promises.lookup("example.com");
  },
  "dgram.createSocket": () => {
    return require("dgram").createSocket("udp4");
  },
  "child_process.spawn": () => {
    return require("child_process").spawn("curl", ["https://example.com/"]);
  },
  "child_process.execSync": () => {
    return require("child_process").execSync("curl https://example.com/");
  },
  WebSocket: () => {
    return new WebSocket("wss://example.com/");
  },
};

const results = {};

for (const [name, attempt] of Object.entries(attempts)) {
  try {
    attempt();
    results[name] = "not refused";
  } catch (error) {
    results[name] =
      error && error.message === NETWORK_REFUSED ? "refused" : String(error);
  }
}

parentPort.postMessage({ results, reported });
