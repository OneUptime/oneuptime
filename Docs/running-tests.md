# Running Tests

## Introduction

Tests are in the `/tests` folder.

There are two types of tests,

-   SaaS
-   Enterprise

### SaaS tests

This runs the application in SaaS mode. What is SaaS mode? SaaS mode enables plans and pricing with stripe. It runs the test as if its a hosted OneUptime service on oneuptime.com.

#### Running tests in SaaS mode

```
npm run docker-saas-test
```

This spins up a new local OneUptime cluster on Docker Compose and runs a test on it.

### Enterprise tests

This runs the application in Enterprise mode. What is Enterprise mode? Enterprise mode DISABLES plans and pricing. It runs the test as if its a hosted on an on-premise datacenter with an enterprise.

#### Running tests in Enterprise mode

```
npm run docker-enterprise-test
```

This spins up a new local OneUptime cluster on Docker Compose and runs a test on it.

### Debugging tests

To debug tests you first need to run the cluster and then run the tests seperately.

```
npm run docker-saas # Running a cluster in SaaS mode, or...
npm run docker-enterprise # Run a cluster in enterprise mode.
```

Once the cluster is running, you can run tests like:

```
export SLOMO=20
export HEADLESS=false
jest  ./saas-tests/StatusPage/StatusPage.test.js # or any file.
```

There's also a .vscode/launch.json in test folder which will help you to debug tests with vscode.
