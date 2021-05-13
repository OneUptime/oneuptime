# Running Tests

## Introduction

Tests are in the `/tests` folder.

There are two types of tests,

-   SaaS
-   Enterprise

### SaaS tests

This runs the application in SaaS mode. What is SaaS mode? SaaS mode enables plans and pricing with stripe. It runs the test as if its a hosted Fyipe service on Fyipe.com.

#### Running tests in SaaS mode

```
npm run docker-saas-test
```

This spins up a new local Fyipe cluster on Docker Compose and runs a test on it.

### Enterprise tests

This runs the application in Enterprise mode. What is Enterprise mode? Enterprise mode DISABLES plans and pricing. It runs the test as if its a hosted on an on-premise datacenter with an enterprise.

#### Running tests in SaaS mode

```
npm run docker-enterprise-test
```

This spins up a new local Fyipe cluster on Docker Compose and runs a test on it.
