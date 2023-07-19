<p align="center">
  <img width="300" alt="oneuptimelogo" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/public/img/OneUptimePNG/7.png">
</p>
<p align="center">
  <a href='http://makeapullrequest.com'><img alt='PRs Welcome' src='https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=shields'/></a>
  <a href='https://join.slack.com/t/oneuptimedev/shared_invite/zt-17r8o7gkz-nITGan_PS9JYJV6WMm_TsQ'><img alt="Join Slack Community" src="https://img.shields.io/badge/slack%20community-join-blue"/></a>
  <img alt="Docker Pulls" src="https://img.shields.io/docker/pulls/oneuptime/backend"/>
  <img alt="GitHub commit activity" src="https://img.shields.io/github/commit-activity/m/oneuptime/app"/>
</p>

**OneUptime is an open-source complete observability platform.**

OneUptime monitors your website, dashboards, API's, and more and alerts your team when downtime happens. We also give you a Status Page which keeps your customers looped in and improves transparency.

OneUptime does:

-   Uptime Monitoring, replaces tools like Pingdom
-   Status Page, replaces tools like StatusPage.io
-   Incident Management, replaces tools like Incident.io
-   On-call rotation and alerts, replaces tools like PagerDuty
-   Tests, replaces tools like Postman (Coming soon)
-   Security, replaces tools like Snyk (Coming soon)
-   Logs Management, replaces tools like Loggly (Coming soon)
-   Performance Monitoring, replaces tools like NewRelic (Coming soon)
-   Error Tracking, replaces tools like Sentry (Coming soon)

All under one platform.

## Get started for free

### OneUptime Cloud

The fastest and most reliable way to get started with OneUptime is signing up for free to [OneUptime Cloud](https://oneuptime.com). By using the hosted cloud service, you also support by funding OneUptime open source development. 

### Open-source hobby single-server deploy with Docker Compose.

Deploy a single-server instance with docker compose on Debian / Ubuntu (we only support Debian / Ubuntu as of today). We recommend OneUptime on 16 GB / 8 Core Ubuntu Server. However you can run an instance on a much smaller server.

Please make sure you have: 
- Docker and Docker Compose installed.

To install OneUptime: 

```
# Clone this repo and cd into it.
git clone https://github.com/OneUptime/oneuptime.git
cd oneuptime

# Please make sure you're on release branch.
git checkout release

# Copy config.example.env to config.env
cp config.example.env config.env

# IMPORTANT: Edit config.env file. Please make sure you have random secrets.

npm start
```

If you dont like to use npm or do not have it installed, run this instead: 

```
# Read env vars from config.env file and run docker-compose up.
export $(grep -v '^#' config.env | xargs) && docker compose up --remove-orphans -d
```

To update: 

```
git checkout release # Please make sure you're on release branch.
git pull
npm run update
```

OneUptime should run at: http://localhost. You need to register a new account for your instance to start using it.

### Development

For local development you need to use docker-compsed-dev.yml file. 

You need to make sure you have: 
- Docker and Docker compose installed. 
- Node.js and NPM installed.

```
# Clone this repo and cd into it.
git clone https://github.com/OneUptime/oneuptime.git
cd oneuptime

# Copy config.example.env to config.env
cp config.example.env config.env

# Since this is dev, you dont have to edit any of those values in config.env. You can, but that's optional.
npm run dev
```


## Philosophy

Our mission is to reduce downtime and increase the number of successful products in the world. To do that, we build a platform that help you understand causes of the downtime, incidents and help reduce toil. Our product is open-source, free and available for everyone to use. 

## Contributing

We <3 contributions big and small. In priority order (although everything is appreciated) with the most helpful first:

- Give us feedback in our [Customer Slack community](https://oneuptimesupport.slack.com/join/shared_invite/zt-1kavkds2f-gegm_wePorvwvM3M_SaoCQ#/shared-invite/email)
- Talk to developers in our [Developer Slack community](https://join.slack.com/t/oneuptimedev/shared_invite/zt-17r8o7gkz-nITGan_PS9JYJV6WMm_TsQ)
- Write tests for some of our codebase. [See issues here](https://github.com/OneUptime/oneuptime/issues?q=is%3Aopen+is%3Aissue+label%3A%22write+tests%22)
- Work on any issue you like. [See issues here](https://github.com/OneUptime/oneuptime/issues)
- Open new issues and create new feature requests that you would like to see. [Open issues here](https://github.com/OneUptime/oneuptime/issues)

## Donate

If you like the project, please consider a small donation. Every single dollar will be used to ship new features or maintain existing ones. 100% of the work we do is open-source. [Please donate here](https://github.com/sponsors/OneUptime)
