"use strict";

/*
 * Replies and exits at once, as a worker that fails before it launches a
 * browser does: nothing is left to close, so nothing stands between its reply
 * and its exit. The config chooses the reply, or none.
 */
process.once("message", (message) => {
  const reply = message.config.reply;

  if (reply === "none") {
    process.exit(3);
  }

  const envelope = {
    type: "oneuptime.synthetic.result",
    version: 1,
    nonce: message.nonce,
  };

  process.send(
    reply === "failure"
      ? {
          ...envelope,
          ok: false,
          error: {
            message: "Synthetic worker run directory is unavailable.",
          },
        }
      : {
          ...envelope,
          ok: true,
          result: { value: "replied-then-exited" },
        },
    () => {
      process.exit(0);
    },
  );
});
