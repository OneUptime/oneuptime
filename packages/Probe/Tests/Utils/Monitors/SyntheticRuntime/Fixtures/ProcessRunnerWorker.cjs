"use strict";

let keepAlive;

function stop() {
  if (keepAlive) {
    clearInterval(keepAlive);
  }
  if (process.connected) {
    process.disconnect();
  }
  process.exit(0);
}

process.once("message", (message) => {
  process.stdout.write("real-worker-started\n");
  keepAlive = setInterval(() => {}, 1000);

  process.send(
    {
      type: "oneuptime.synthetic.result",
      version: 1,
      nonce: message.nonce,
      ok: true,
      result: { value: "real-fork-complete" },
    },
    (error) => {
      if (error) {
        stop();
      }
    },
  );
});

process.once("SIGTERM", stop);
process.once("SIGINT", stop);
