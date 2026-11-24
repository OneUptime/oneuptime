/*
 * undici's agents need Node's web streams, which Common's jsdom environment
 * lacks: loading the package there fails with "ReadableStream is not
 * defined" before a single test runs. OutboundFetch (Server/Utils), which
 * every server request sent with fetch goes through (#10720), imports it, so
 * every suite that reaches such a sender - the AWS credential chain, the
 * meeting providers, the marketplaces, Google SecOps - would die at import.
 *
 * jsdom has no Node fetch to send with either: a Common suite stands in for
 * fetch (globalThis.fetch, or the sender's own seam), and its stand-in never
 * asks a dispatcher for anything. So the agents are stood in for here, and
 * say so if anything does ask. The requests themselves are sent, through
 * real proxies, by App's suites, which run in Node (App/Tests/OutboundProxy).
 */

class StandInDispatcher {
  constructor(options) {
    this.options = options;
  }

  dispatch() {
    throw new Error(
      "undici is stood in for in Common's jsdom suites (Tests/__mocks__/undici.js): send a real request with Node's fetch from a suite of App's, which runs in Node.",
    );
  }

  close() {
    return Promise.resolve();
  }

  destroy() {
    return Promise.resolve();
  }
}

class Agent extends StandInDispatcher {}

class ProxyAgent extends StandInDispatcher {}

module.exports = {
  Agent: Agent,
  Dispatcher: StandInDispatcher,
  ProxyAgent: ProxyAgent,
};
