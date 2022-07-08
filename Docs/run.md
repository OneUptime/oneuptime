# Running OneUptime

## Running this project for local environment

- Make sure Docker and Docker Compose is installed. 
- Make sure Node and NPM are installed. 
- Run: `npm run dev`
- Docker will build and run contaienrs. This will take some time. 
- You should see OneUptime Home Page on `http://localhost`
- The containers are hot reloadable, so any changes you do in local development, it should auto-restart. 
- However, containers dont auto-restart for chages made to `package.json` / `webpack.config.js` files. If you've made a change to those files, you should build the container again by running: 
```
npm run force-build-dev <application_name>

Example: 
npm run force-build-dev accounts
```
- After force build completes, you can run it again by running `npm run dev`

### Logs

- To check the logs of the application, you should: 

```
npm run logs-dev <application_name>

Example: 
npm run logs-dev accounts
```

### Debugging

- Debugging with breakpoints are supported. 
- You should use VSCode for the best debugging experience.
- Select the Debug item on the left menu of VS Code and then you should see list of various apps that you can debug. You can pick any and press the green button in VS Code which attaches the debugger. 
- If you make any chanegs to the file, container automatically restarts and the debugger connection is broken. so, you need to press that gren button again to debug. 

### Clear cache and Prune

- Sometimes you need a clean system for various reasons with a clean docker images and clean cache. 
- In those cases, you can prune docker by running `npm run prune`. Please note this will also delete images that are not related to OneUptime project. 

## Running on: on-prem, staging, or production.

### Running with Docker Compose: 
- Run `docker-compose up`

### Running with Kubernetes and Helm
-   Please check `README.md` in the `HelmChart` folder.
