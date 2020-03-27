# Description of the subprojects in this repo.

-   `accounts` - A React project used for Authentication (Log in, Sign up, Forgot Password, etc.)
-   `dashboard` - A React project for Fyipe user where user can interact with the Fyipe platform.
-   `admin-dashobard` - React Project where admin can block users, delete projects and more.
-   `api-docs` - HTML/CSS project. A public reference of Fyipe documentation.
-   `backend` - NodeJS Service. It's Fyipe API's.
-   `home` - HTML/CSS. Home Page / Marketing page of Fyipe.
-   `http-test-server` - A test server used to test website monitors for Fyipe.
-   `kubernetes` - yaml files to deploy fyipe on staging, production or any enterprise kubernetes cluster. This also contains DevOps/CI/CD scripts.
-   `marketing` - This is where you'll find logos, brief description of Fyipe, etc.
-   `certifications` - SOC/ISO/PCI certifications and more.
-   `postman-collection` - Postman collection for Fyipe API.
-   `probe` - Probe is an agent that gets insalled on a third party server on a thir party datacenter and it monitors users websites, services, from that data center. You can deploy multiple probes to monitor users resources - A probe in a datacenter in EU, in US, etc.
-   `server-monitor` - A probe that gets installed on a server and that monitors that particular server.
-   `smoke-test` - Smoke test that is executed after Fyipe is deployed to staging or production. If smoke test fails, the staging / production deployment will automatically be rolled back.
-   `status-page` - React project - Status page project of Fyipe.
-   `zapier` - Fyipe integrates with zapier. This is where integration code is. This gets deployed to zapier directly.
-   `init-script` - a container that runs schema migration script.
-   `helm-chart` - Helm Chart Scripts for installation of Fyipe into Kubernetes. 