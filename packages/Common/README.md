# @oneuptime/common

The types, utilities and data models that OneUptime's own services, apps and
CLI are built on, for Node.js and TypeScript: monitor and incident types, IDs
and dates as OneUptime's API sends them, the API client, and the data model of
every record.

```bash
npm install @oneuptime/common
```

It needs Node.js 22 or later, and works with `require` and with `import`.

## Use it

Import a module by its path, without an extension, the way OneUptime's own code
does:

```ts
import ObjectID from "@oneuptime/common/Types/ObjectID";
import MonitorType from "@oneuptime/common/Types/Monitor/MonitorType";
import Incident from "@oneuptime/common/Models/DatabaseModels/Incident";
```

```js
const ObjectID = require("@oneuptime/common/Types/ObjectID").default;
```

`import` and `require` hand out the same classes, so an `instanceof` holds
whichever way a value was made.

The package itself holds what a script that calls the OneUptime API needs
most: the API client, `API`, with `URL`, `Route`, `Hostname`, `Protocol`,
`HTTPMethod`, `HTTPResponse` and `HTTPErrorResponse`; `ObjectID` and
`OneUptimeDate`; `JSONFunctions`, which turns OneUptime's JSON, with its dates
and IDs, into values and back; `Exception` and `BadDataException`; and the
types `JSONObject`, `JSONArray`, `JSONValue`, `Dictionary` and `Headers`.

```ts
import { API, HTTPErrorResponse, URL } from "@oneuptime/common";

const response = await API.post({
  url: URL.fromString("https://oneuptime.com/api/incident/get-list"),
  headers: { APIKey: process.env["ONEUPTIME_API_KEY"] || "" },
  data: { query: {}, select: { title: true }, limit: 10 },
});

if (response instanceof HTTPErrorResponse) {
  throw new Error(response.message);
}

console.log(response.data);
```

To manage OneUptime from a terminal or a CI job, install the CLI,
[`@oneuptime/cli`](https://www.npmjs.com/package/@oneuptime/cli), instead.

## What it holds

- `Types/`, `Utils/` and `Models/`: every module there that runs in plain
  Node.js, as CommonJS and as an ES module, each with its TypeScript types.
- `ServiceRoute`: the paths OneUptime serves its parts under, such as `/api`.

A few modules under `Types/` and `Utils/` load code that needs a browser or
OneUptime's own servers. They are left out, and the package's exports map
names each of them with `null`. OneUptime's server and web app code, which
needs its databases, queues and configuration or a browser, is not in the
package: only the declarations of the few of their types the package's own
types refer to.

TypeScript resolves the types with any `moduleResolution` (`nodenext`,
`bundler` or `node10`), with or without `skipLibCheck`. Install `@types/node`
beside it, as any Node.js project has.

## In this repository

Every package of the [OneUptime repository](https://github.com/OneUptime/oneuptime)
imports this directory as `Common`, from its TypeScript sources. What npm
publishes is built from them:

```bash
cd packages/Common
npm run build-npm-package       # writes build/npm/package
npm run smoke-test-npm-package  # packs it, installs it in a new project and uses it
```

The release publishes `build/npm/package` (`Scripts/NPM/PublishAllPackages.sh`).
`Scripts/NpmPackage/BuildNpmPackage.js` says what goes in it and why.
