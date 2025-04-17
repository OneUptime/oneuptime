const express = require("express");
const path = require("path");

const setUpWebpackDevServerMiddleware = (appName) => {
  const setupMiddleware = (middlewares, devServer) => {
    devServer.app.set("view engine", "ejs");

    devServer.app.get([`/${appName}/env.js`, "/env.js"], async (req, res) => {
      // ping api server for database config.

      const env = {
        ...process.env,
      };

      const script = `
          if(!window.process){
            window.process = {}
          }
      
          if(!window.process.env){
            window.process.env = {}
          }
          const envVars = '${JSON.stringify(env)}';
          window.process.env = JSON.parse(envVars);
        `;
      res.writeHead(200, { "Content-Type": "text/javascript" });
      res.end(script);
    });

    devServer.app.use(
      `/${appName}/assets`,
      express.static("/usr/src/app/public/assets/")
    );

    devServer.app.get(`/${appName}`, (_req, res) => {
      return res.render("/usr/src/app/views/index", {
        enableGoogleTagManager: false,
      });
    });

    devServer.app.get(`/${appName}/dist/:file`, (req, res) => {
      const fileName = req.params.file;
      res.sendFile("/usr/src/app/public/dist/" + fileName);
    });

    devServer.app.get(`/${appName}/*`, (_req, res) => {
      return res.render("/usr/src/app/views/index", {
        enableGoogleTagManager: false,
      });
    });

    devServer.app.get("/*", (_req, res) => {
      return res.render("/usr/src/app/views/index", {
        enableGoogleTagManager: false,
      });
    });

    return middlewares;
  };

  return setupMiddleware;
};


module.exports = setUpWebpackDevServerMiddleware;