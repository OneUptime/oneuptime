# Running Tests

To run tests on several projects, there are a few components required, mongodb and redis.

If you have docker installed on your local machine, you can as well run mongodb and redis in containers.

Run the following commands to start up mongodb and redis:

```bash
sudo docker run --name mongo -p 27017:27017 -d mongo
sudo docker run --name redis -p 6379:6379 -d redis
```

**Note** Running mongodb and redis in docker containers require you to have any previous running processes stopped or installation completely removed.

## Initial Setup

Some tests, including backend and dashboard, require you to have probes and http test server running.

Run the following commands to setup test probe records in mongodb:

```bash
cd init-scripts
npm install
NODE_ENV=development npm start
```

Run the following commands to start up the 2 test probes:

```bash
cd probe
npm install
PROBE_NAME="Probe 1" PROBE_KEY=test-key PORT=3024 npm start
PROBE_NAME="Probe 2" PROBE_KEY=test-key PORT=3025 npm start
```

Or in docker containers:

```bash
sudo docker build -t fyipeproject/probe ./probe
sudo docker run --name probe-1 --env-file ./probe/.env -e PORT=3024 -e PROBE_NAME="Probe 1" -e PROBE_KEY=test-key --net=host -d fyipeproject/probe
sudo docker run --name probe-2 --env-file ./probe/.env -e PORT=3025 -e PROBE_NAME="Probe 2" -e PROBE_KEY=test-key --net=host -d fyipeproject/probe
```

Run the following commands to start up http test server:

```bash
cd http-test-server
npm install
npm start
```

Or in a docker container:

```bash
sudo docker build -t fyipeproject/http-test-server ./http-test-server
sudo docker run --name test-server -p 3010:3010 -d fyipeproject/http-test-server
```

## Backend

There are two types of backend test, saas and enterprise test.

### Dependencies

-   Probes
-   Http Test Server

To run saas test, add the following line in the `.env` file in the backend project (`app/backend/.env`); this line is not required to run enterprise test:

```
IS_SAAS_SERVICE=true
```

Run the following commands to start saas test:

```bash
cd backend
npm install
npm test
```

Run the following commands to start enterprise test:

```bash
cd backend
npm install
npm run enterprise-test
```

## Accounts

There are two types of accounts test, saas and enterprise test.

### Dependencies

-   Backend
-   Accounts
-   Admin Dashboard
-   Dashboard

To run saas test, add the following line in the `.env` file in the backend project (`app/backend/.env`), accounts project (`app/accounts/.env`), dashboard project (`app/dashboard/.env`) and admin dashboard project (`app/admin-dashboard/.env`); this line is not required to run enterprise test:

```
IS_SAAS_SERVICE=true
```

Run the following commands to start up dependencies in docker containers:

```bash
sudo docker build -t fyipeproject/backend ./backend
sudo docker run --name backend --env-file ./backend/.env --net=host -d fyipeproject/backend
sudo docker build -t fyipeproject/accounts ./accounts
sudo docker run --name accounts --env-file ./accounts/.env -p 3003:3003 -d fyipeproject/accounts
sudo docker build -t fyipeproject/admin-dashboard ./admin-dashboard
sudo docker run --name admin-dashboard --env-file ./admin-dashboard/.env -p 3100:3100 -d fyipeproject/admin-dashboard
sudo docker build -t fyipeproject/dashboard ./dashboard
sudo docker run --name dashboard --env-file ./dashboard/.env -p 3000:3000 -d fyipeproject/dashboard
```

Run the following commands to start saas test:

```bash
cd accounts
npm install
npm test
```

Run the following commands to start enterprise test:

```bash
cd accounts
npm install
npm run enterprise-test
```

## Admin Dashboard

There are two types of admin dashboard test, saas and enterprise test.

### Dependencies

-   Backend
-   Accounts
-   Admin Dashboard

To run saas test, add the following line in the `.env` file in the backend project (`app/backend/.env`), accounts project (`app/accounts/.env`), and admin dashboard project (`app/admin-dashboard/.env`); this line is not required to run enterprise test:

```
IS_SAAS_SERVICE=true
```

Run the following commands to start up dependencies in docker containers:

```bash
sudo docker build -t fyipeproject/backend ./backend
sudo docker run --name backend --env-file ./backend/.env --net=host -d fyipeproject/backend
sudo docker build -t fyipeproject/accounts ./accounts
sudo docker run --name accounts --env-file ./accounts/.env -p 3003:3003 -d fyipeproject/accounts
sudo docker build -t fyipeproject/admin-dashboard ./admin-dashboard
sudo docker run --name admin-dashboard --env-file ./admin-dashboard/.env -p 3100:3100 -d fyipeproject/admin-dashboard
```

Run the following commands to start saas test:

```bash
cd admin-dashboard
npm install
npm test
```

Run the following commands to start enterprise test:

```bash
cd admin-dashboard
npm install
npm run enterprise-test
```

## Dashboard

There are two types of dashboard test, saas and enterprise test.

### Dependencies

-   Probes
-   Http Test Server
-   Backend
-   Accounts
-   Admin Dashboard
-   Dashboard

To run saas test, add the following line in the `.env` file in the backend project (`app/backend/.env`), accounts project (`app/accounts/.env`), dashboard project (`app/dashboard/.env`) and admin dashboard project (`app/admin-dashboard/.env`); this line is not required to run enterprise test:

```
IS_SAAS_SERVICE=true
```

Run the following commands to start up dependencies in docker containers:

```bash
sudo docker build -t fyipeproject/backend ./backend
sudo docker run --name backend --env-file ./backend/.env --net=host -d fyipeproject/backend
sudo docker build -t fyipeproject/accounts ./accounts
sudo docker run --name accounts --env-file ./accounts/.env -p 3003:3003 -d fyipeproject/accounts
sudo docker build -t fyipeproject/admin-dashboard ./admin-dashboard
sudo docker run --name admin-dashboard --env-file ./admin-dashboard/.env -p 3100:3100 -d fyipeproject/admin-dashboard
sudo docker build -t fyipeproject/dashboard ./dashboard
sudo docker run --name dashboard --env-file ./dashboard/.env -p 3000:3000 -d fyipeproject/dashboard
```

Run the following commands to start saas test:

```bash
cd dashboard
npm install
npm test
```

Run the following commands to start enterprise test:

```bash
cd dashboard
npm install
npm run enterprise-test
```

**Note** saas tests are saved like so \*.test.js while enterprise tests are saved like so, \*.test.enterprise.js.

## Status Page

### Dependencies

-   Backend
-   Accounts
-   Status Page

To run test, add the following line in the `.env` file in the backend project (`app/backend/.env`) and accounts project (`app/accounts/.env`):

```
IS_SAAS_SERVICE=true
```

Run the following commands to start up dependencies in docker containers:

```bash
sudo docker build -t fyipeproject/backend ./backend
sudo docker run --name backend --env-file ./backend/.env --net=host -d fyipeproject/backend
sudo docker build -t fyipeproject/accounts ./accounts
sudo docker run --name accounts --env-file ./accounts/.env -p 3003:3003 -d fyipeproject/accounts
sudo docker build -t fyipeproject/status-page ./status-page
sudo docker run --name status-page --env-file ./status-page/.env -p 3006:3006 -d fyipeproject/status-page
```

Run the following commands to start test:

```bash
cd status-page
npm install
npm test
```

## Http Test Server

Run the following commands to start test:

```bash
cd status-page
npm install
npm test
```

## Init Script

Run the following commands to start test:

```bash
cd init-script
npm install
npm test
```

## Server Monitor

Please see [Fyipe Server Monitor](https://www.npmjs.com/package/fyipe-server-monitor) for more information on how to use this package.

### Dependencies

-   Backend

To run saas test, add the following line in the `.env` file in the backend project (`app/backend/.env`):

```
IS_SAAS_SERVICE=true
```

Run the following commands to start up dependency in a docker container:

```bash
sudo docker build -t fyipeproject/backend ./backend
sudo docker run --name backend --env-file ./backend/.env --net=host -d fyipeproject/backend
```

Run the following commands to start test:

```bash
cd server-monitor
npm install
npm test
```

## Zapier

Run the following commands to start test:

```bash
cd zapier
npm install
npm test
```
