[![npm](https://img.shields.io/npm/v/fyipe-server-monitor)](https://www.npmjs.com/package/fyipe-server-monitor)

# Fyipe Server Monitor

A fyipe shell package that monitor's server resources - disk, memory and CPU percentage - used.

## Installation

You can install to use on the CLI:

```bash
$ npm install -g fyipe-server-monitor
```

You can install to use in your project:

```bash
$ cd project
$ npm install fyipe-server-monitor
```

## CLI Usage

You can use on the CLI:

```bash
$ fyipe-server-monitor
```

-   Run `fyipe-server-monitor`.
-   Enter your Project ID, API URL, and API key - Get these from your Fyipe Dashboard.
-   Select Server Monitor from the list of Server Monitors.
-   Server will be pinged every minute and the data stored in your project.

You can also use it like this:

```bash
$ fyipe-server-monitor --project-id 5d64d59cae46131619708309 --api-url https://fyipe.com/api --api-key b02798c0-c898-11e9-9f14-4963dc67e2ab --monitor-id 5d7775e9f14a531364ba6917
```

Or run as a daemon (requires `sudo` or admin privileges):

```bash
$ fyipe-server-monitor --daemon --project-id 5d64d59cae46131619708309 --api-url https://fyipe.com/api --api-key b02798c0-c898-11e9-9f14-4963dc67e2ab --monitor-id 5d7775e9f14a531364ba6917
```

You can use the following commands with the daemon: `start`, `restart`, `stop`, and `uninstall`.

Run to start the stopped daemon (requires `sudo` or admin privileges):

```bash
$ fyipe-server-monitor --daemon start
```

Run to restart the running daemon (requires `sudo` or admin privileges):

```bash
$ fyipe-server-monitor --daemon restart
```

Run to stop the running daemon (requires `sudo` or admin privileges):

```bash
$ fyipe-server-monitor --daemon stop
```

Run to stop and uninstall the running daemon (requires `sudo` or admin privileges):

```bash
$ fyipe-server-monitor --daemon uninstall
```

Run to check for logs and errors:

```bash
$ fyipe-server-monitor --daemon logs
$ fyipe-server-monitor --daemon errors
```

A complete log of the daemon can be found in these directories:

```bash
# linux logs
/var/log/Fyipe Server Monitor/fyipeservermonitor.log
/var/log/Fyipe Server Monitor/fyipeservermonitor_error.log

# mac logs
/Library/Logs/Fyipe Server Monitor/fyipeservermonitor.log
/Library/Logs/Fyipe Server Monitor/fyipeservermonitor_error.log

# windows logs
<service_path>/fyipeservermonitor.out.log
<service_path>/fyipeservermonitor.err.log
```

NB:- In most cases, `sudo` or admin privileges are required to run the shell as a daemon.

### Services

#### Linux

Services created by the daemon are like other services running on Linux. It can be started/stopped using `service fyipeservermonitor start` or `service fyipeservermonitor stop` and logs are available. This file is created in /etc/init.d by default. Additionally, log files are generated in /var/log/Fyipe Server Monitor/ for general output and error logging.

#### Mac

Services created by the daemon are similar to most other services running on OSX. It can be stopped from the Activity Monitor and make logs available in the Console app. A plist file is created in /Library/LaunchDaemons by default. Additionally, two log files are generated in /Library/Logs/Fyipe Server Monitor/ for general output and error logging.

#### Windows

Services created by the daemon are similar to most other services running on Windows. It can be started/stopped from the windows service utility, via NET START or NET STOP commands, or even managed using the sc utility. A directory called daemon is created and populated with fyipeservermonitor.exe and fyipeservermonitor.xml. The XML file is a configuration for the executable. Additionally, logs are created in this directory (which are viewable in the Event log).

<a name="module_api"></a>

## Programmatic Usage

```javascript
const serverMonitor = require('fyipe-server-monitor');

const monitor = serverMonitor({
    projectId: '5d64d59cae46131619708309',
    // (optional) If you have installed Fyipe Platform on your server,
    // this should be your API URL
    apiUrl: 'https://fyipe.com/api',
    apiKey: 'b02798c0-c898-11e9-9f14-4963dc67e2ab',
    monitorId: '5d7775e9f14a531364ba6917',
    interval: '*/5 * * * * *', // cron job interval
    timeout: 10000, // milliseconds
});

monitor.start();
```

## Known Issues

#### Windows Temperature

`wmic` - is used to determine temperature and sometimes needs to be run with admin privileges. So if you do not get any values, try to run it again with according privileges. If you still do not get any values, your system might not support this feature.

#### Linux Temperature

In some cases you may need to install the linux `sensors` package to be able to measure temperature e.g. on DEBIAN based systems run `sudo apt-get install lm-sensors`.

See [system information](https://www.npmjs.com/package/systeminformation#known-issues) to learn more.

## API Documentation

Main API to authenticate user, start and stop server monitoring.

**See**

-   module:helpers
-   module:logger

**Author**: HackerBay, Inc.

-   [Fyipe Server Monitor](#fyipe-server-monitor)
    -   [Installation](#installation)
    -   [CLI Usage](#cli-usage)
    -   [Basic Usage](#basic-usage)
    -   [API Documentation](#api-documentation)
        -   [module.exports(config, apiUrl, apiKey, monitorId) ⇒ <code>Object</code> ⏏](#moduleexportsconfig-apiurl-apikey-monitorid--object-)
            -   [module.exports~ping(projectId, monitorId, apiUrl, apiKey, interval) ⇒ <code>Object</code>](#moduleexportspingprojectid-monitorid-apiurl-apikey-interval--object)
            -   [module.exports~start(id) ⇒ <code>Object</code> \| <code>number</code>](#moduleexportsstartid--object--number)
            -   [module.exports~stop() ⇒ <code>Object</code>](#moduleexportsstop--object)

<a name="exp_module_api--module.exports"></a>

### module.exports(config, apiUrl, apiKey, monitorId) ⇒ <code>Object</code> ⏏

Authenticate user and get list of server monitors if monitor id not provided.

**Kind**: Exported function
**Returns**: <code>Object</code> - The server monitor handlers.

| Param     | Type                                         | Description                                                             |
| --------- | -------------------------------------------- | ----------------------------------------------------------------------- |
| config    | <code>string</code> \| <code>Object</code>   | The project id or config of the project.                                |
| apiUrl    | <code>string</code>                          | The url of the api.                                                     |
| apiKey    | <code>string</code>                          | The api key of the project.                                             |
| monitorId | <code>string</code> \| <code>function</code> | The monitor id or function to resolve monitor id of the server monitor. |

<a name="module_api--module.exports..ping"></a>

#### module.exports~ping(projectId, monitorId, apiUrl, apiKey, interval) ⇒ <code>Object</code>

Get system information at interval and upload to server.

**Kind**: inner method of [<code>module.exports</code>](#exp_module_api--module.exports)
**Returns**: <code>Object</code> - The ping server cron job.

| Param     | Type                | Default                                 | Description                                                |
| --------- | ------------------- | --------------------------------------- | ---------------------------------------------------------- |
| projectId | <code>string</code> |                                         | The project id of the project.                             |
| monitorId | <code>string</code> |                                         | The monitor id of the server monitor.                      |
| apiUrl    | <code>string</code> |                                         | The url of the api.                                        |
| apiKey    | <code>string</code> |                                         | The api key of the project.                                |
| interval  | <code>string</code> | <code>&quot;\* \* \* \* \*&quot;</code> | The interval of the cron job, must ba a valid cron format. |

<a name="module_api--module.exports..start"></a>

#### module.exports~start(id) ⇒ <code>Object</code> \| <code>number</code>

Start server monitor.

**Kind**: inner method of [<code>module.exports</code>](#exp_module_api--module.exports)
**Returns**: <code>Object</code> \| <code>number</code> - The ping server cron job or the error code.

| Param | Type                | Description                           |
| ----- | ------------------- | ------------------------------------- |
| id    | <code>string</code> | The monitor id of the server monitor. |

<a name="module_api--module.exports..stop"></a>

#### module.exports~stop() ⇒ <code>Object</code>

Stop server monitor.

**Kind**: inner method of [<code>module.exports</code>](#exp_module_api--module.exports)
**Returns**: <code>Object</code> - The ping server cron job.
