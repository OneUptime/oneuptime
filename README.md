# Fyipe 

## Project Architecture
TODO

## Description of the projects in this repo. 
 - `accounts` - A React project used for Authentication (Log in, Sign up, Forgot Password, etc.)
 - `dashboard` - A React project for Fyipe user where user can interact with the Fyipe platform. 
 - `admin-dashobard` - React Project where admin can block users, delete projects and more. 
 - `api-docs` - HTML/CSS project. A public reference of Fyipe documentation. 
 - `backend` - NodeJS Service. It's Fyipe API's. 
 - `home` - HTML/CSS. Home Page / Marketing page of Fyipe.
 - `http-test-server` - A test server used to test website monitors for Fyipe.
 - `kubernetes` - yaml files to deploy fyipe on staging, production or any enterprise kubernetes cluster. This also contains DevOps/CI/CD scripts. 
 - `marketing` - This is where you'll find logos, brief description of Fyipe, etc. 
 - `certifications` - SOC/ISO/PCI certifications and more. 
 - `postman-collection` - Postman collection for Fyipe API. 
 - `probe` - Probe is an agent that gets insalled on a third party server on a thir party datacenter and it monitors users websites, services, from that data center. You can deploy multiple probes to monitor users resources - A probe in a datacenter in EU, in US, etc. 
 - `server-monitor` - A probe that gets installed on a server and that monitors that particular server. 
 - `smoke-test` - Smoke test that is executed after Fyipe is deployed to staging or production. If smoke test fails, the staging / production deployment will automatically be rolled back. 
 - `status-page` - React project  - Status page project of Fyipe. 
 - `zapier` - Fyipe integrates with zapier. This is where integration code is. This gets deployed to zapier directly. 
 - `init-script` - a container that runs schema migration script. 

## Running this project in local environment. 

- Before you run this project locally, please make sure you're on Ubuntu or on a Mac machine. 
- Install Docker and Docker Compose.
- Install Robomongo / Mongo Compass / or any other MongoDB UI Tool.
- Make sure MongoDB and Redis are NOT running (NO services should run on port 27017 and 6379)
- Run `sudo bash install.sh` - This will take some time (30 mins maybe or more) when you run this for the first time. 
- The above command runs the entire project in Docker Compose. 
- If you're working on particular sub-project (for ex: accounts, admin-dashboard or literally anything else), your changes will not be reflected in Docker Compose automatically. In this case
    - Delete the docker container of the project you're working on. (`sudo docker stop containerId` and `sudo docker rm containerId`)
    - Once the container is deleted, cd into that project run `npm install` and `npm run dev`.
    - Let other projects / containers run on docker. They will work perfectly fine with a project you're working on.

## LISENCE

Copyright (C) HackerBay, Inc - All Rights Reserved
Unauthorized copying of this project, via any medium is strictly prohibited
This project is proprietary and confidential

