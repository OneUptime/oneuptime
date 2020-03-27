# Running Fyipe

## Running this project in local environment.

-   Before you run this project locally, please make sure you're on Ubuntu or on a Mac machine.
-   Install Docker and Docker Compose.
-   Install Robomongo / Mongo Compass / or any other MongoDB UI Tool.
-   Make sure MongoDB and Redis are NOT running (NO services should run on port 27017 and 6379)
-   Run `sudo bash install.sh` - This will take some time (30 mins maybe or more) when you run this for the first time.
-   The above command runs the entire project in Docker Compose.
-   If you're working on particular sub-project (for ex: accounts, admin-dashboard or literally anything else), your changes will not be reflected in Docker Compose automatically. In this case
    -   Delete the docker container of the project you're working on. (`sudo docker stop containerId` and `sudo docker rm containerId`)
    -   Once the container is deleted, cd into that project run `npm install` and `npm run dev`.
    -   Let other projects / containers run on docker. They will work perfectly fine with a project you're working on.

## Alternative ways to run the project in development
- If Docker and Docker compose is not your thing, you can run `npm install` and `npm run dev` on projects you want to work on. Ideally you would need to run those commands in `accounts`, `backend`, `probe`, `dashboard`, and `status-page` in seperate terminal instances to run the basic app.

## Running on: on-prem, staging, or production.
- We run this by using helm charts, please check `README.md` in the `helm-chart` folder.