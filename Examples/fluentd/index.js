// This app will log all the logs to the docker-container fluentd that's running in development.
// You can find the details of the docker container in this file: /docker-compose.dev.yml
// This docker container is not run in production because there is no need to, customers will run fluentd on their own side in production.

const express = require("express");
const FluentClient = require("@fluent-org/logger").FluentClient;
const app = express();

// The 2nd argument can be omitted. Here is a default value for options.
const logger = new FluentClient("fluentd.test", {
  socket: {
    host: "localhost",
    port: 24224,
    timeout: 3000, // 3 seconds
  },
});

app.get("/", (request, response) => {
  logger.emit("follow", { from: "userA", to: "userB" });
  response.send("Hello World!");
});

const port = 7856;

app.listen(port, () => {
  console.log("Listening on " + port);
});
