# Running test

There are several components to running a test on a project. You need to have mongodb and redis install.

You can as well install docker and run mongodb and redis in containers.

## Initial Setup

To run test a few things need to be setup, including: probes, http-test-server.

```bash
cd init-scripts
npm install
NODE_ENV=development npm start
```

```bash
cd probe
npm install
PROBE_NAME=Probe 1 PROBE_KEY=test-key PORT=3020 npm start
PROBE_NAME=Probe 2 PROBE_KEY=test-key PORT=3021 npm start
```

```bash
cd http-test-server
npm install
npm start
```

## Backend

There are two types of tests, SaaS and enterprise test.

In order to run the backend SaaS tests locally, you'll need to uncomment the following line in the `.env` file from the backend project (`app/backend/.env`)

```
IS_SAAS_SERVICE=true
```

```bash
cd backend
npm install
npm test
```

To run enterprise test

```bash
cd backend
npm install
npm run enterprise-test
```

## Accounts

There are two types of tests, SaaS and enterprise test.

### Prerequisites

-   Backend
-   Dashboard
-   Admin Dashboard
-   Accounts

In order to run the accounts SaaS tests locally, you'll need to uncomment the following line in the `.env` file from the accounts project (`app/accounts/.env`)

```
IS_SAAS_SERVICE=true
```

```bash
cd accounts
npm install
npm test
```

To run enterprise test

```bash
cd accounts
npm install
npm run enterprise-test
```

## Dashboard

There are two types of tests, SaaS and enterprise test.

### Prerequisites

-   Backend
-   Http Test Server
-   Admin Dashboard
-   Accounts
-   Dashboard

In order to run the dashboard SaaS tests locally, you'll need to uncomment the following line in the `.env` file from the dashboard project (`app/dashboard/.env`)

```
IS_SAAS_SERVICE=true
```

```bash
cd dashboard
npm install
npm test
```

To run enterprise test

```bash
cd dashboard
npm install
npm run enterprise-test
```

## Admin Dashboard

There are two types of tests, SaaS and enterprise test.

### Prerequisites

-   Backend
-   Accounts
-   Admin Dashboard

In order to run the admin dashboard SaaS tests locally, you'll need to uncomment the following line in the `.env` file from the admin dashboard project (`app/admin-dashboard/.env`)

```
IS_SAAS_SERVICE=true
```

```bash
cd admin-dashboard
npm install
npm test
```

To run enterprise test

```bash
cd admin-dashboard
npm install
npm run enterprise-test
```

NB:- SaaS tests are saved like so _.test.js while enterprise tests are save like so, _.enterprise.js.

## Status Page

### Prerequisites

-   Backend
-   Accounts
-   Status Page

```bash
cd status-page
npm install
npm test
```

## Http Test Server

```bash
cd status-page
npm install
npm test
```

## Init Script

```bash
cd init-script
npm install
npm test
```

## Server Monitor

```bash
cd server-monitor
npm install
npm test
```

Please see [Fyipe Server Monitor](https://www.npmjs.com/package/fyipe-server-monitor) for more information on how to use this package.

## Zapier

```bash
cd zapier
npm install
npm test
```
