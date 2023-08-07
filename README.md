<p align="center">
  <img width="300" alt="oneuptimelogo" src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/public/img/OneUptimePNG/7.png">
</p>
<p align="center">
  <a href='http://makeapullrequest.com'><img alt='PRs Welcome' src='https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=shields'/></a>
  <a href='https://join.slack.com/t/oneuptimedev/shared_invite/zt-17r8o7gkz-nITGan_PS9JYJV6WMm_TsQ'><img alt="Join Slack Community" src="https://img.shields.io/badge/slack%20community-join-blue"/></a>
  <img alt="Docker Pulls" src="https://img.shields.io/docker/pulls/oneuptime/backend"/>
  <img alt="GitHub commit activity" src="https://img.shields.io/github/commit-activity/m/oneuptime/app"/>
</p>

**OneUptime: The Complete Open-Source Observability Platform**

OneUptime is a comprehensive solution for monitoring and managing your online services. Whether you need to check the availability of your website, dashboard, API, or any other online resource, OneUptime can alert your team when downtime happens and keep your customers informed with a status page. OneUptime also helps you handle incidents, set up on-call rotations, run tests, secure your services, analyze logs, track performance, and debug errors.

OneUptime replaces multiple tools with one integrated platform:

-   **Uptime Monitoring**: Monitor the availability and response time of your online services from multiple locations around the world. Get notified via email, SMS, Slack, or other channels when something goes wrong. Replace tools like Pingdom.
-   **Status Page**: Communicate with your customers and stakeholders during downtime or maintenance. Create a custom-branded status page that shows the current status and history of your services. Replace tools like StatusPage.io.
-   **Incident Management**: Manage incidents from start to finish with a collaborative workflow. Create incident reports, assign tasks, update stakeholders, and document resolutions. Replace tools like Incident.io.
-   **On-call Rotation and Alerts**: Schedule on-call shifts for your team and define escalation policies. Ensure that the right person is notified at the right time when an incident occurs. Replace tools like PagerDuty.
-   **Tests** (Coming soon): Automate testing of your online services with scripts or scenarios. Verify the functionality and performance of your APIs, web pages, or workflows. Replace tools like Postman.
-   **Security** (Coming soon): Protect your online services from cyberattacks and vulnerabilities. Scan your code and dependencies for security issues and get recommendations for fixing them. Replace tools like Snyk.
-   **Logs Management** (Coming soon): Collect, store, and analyze logs from your online services. Search, filter, and visualize log data to gain insights and troubleshoot issues. Replace tools like Loggly.
-   **Performance Monitoring** (Coming soon): Measure and optimize the performance of your online services. Track key metrics such as response time, throughput, error rate, and user satisfaction. Replace tools like NewRelic.
-   **Error Tracking** (Coming soon): Detect and diagnose errors in your online services. Get detailed error reports with stack traces, context, and user feedback. Replace tools like Sentry.

All under one platform.

## Get Started for Free with OneUptime Cloud

OneUptime Cloud is the easiest and fastest way to monitor your website uptime and performance. You can sign up for free to [OneUptime Cloud](https://oneuptime.com) and enjoy the full benefits of OneUptime without any installation or maintenance hassle. 

By using OneUptime Cloud, you also support the development of OneUptime open source project, which is a powerful and flexible tool for website monitoring. You can find more information about OneUptime open source project on [GitHub](##Philosophy). The code of OneUptime is completely open source, which means you can access, modify, and distribute it freely. You can also contribute to the project by reporting issues, suggesting features, or submitting pull requests.

If you need advanced features, such as API Access, Advances Workflows, or Advanced Access Control, you can upgrade to a paid plan anytime. You can compare the different plans and pricing on [OneUptime Pricing](https://oneuptime.com/pricing) page.

### Deploy OneUptime completely free with Docker Compose

If you prefer to host OneUptime on your own server, you can use Docker Compose to deploy a single-server instance of OneUptime on Debian, Ubuntu, or RHEL. This option gives you more control and customization over your instance, but it also requires more technical skills and resources to deploy and maintain it.

#### Choose Your System Requirements
Depending on your usage and budget, you can choose from different system requirements for your server. For optimal performance, we suggest using OneUptime with:

- **Recommended System Requirements**
  - 16GB RAM
  - 8 Core
  - 400GB SSD
  - Ubuntu 22.04
  - Docker and Docker Compose installed
- **Homelab Requirements**
  - If you want to run OneUptime for personal or experimental use in a home environment, you can use the homelab requirements:
    - 12GB RAM
    - 4 Core
    - 100GB SSD
    - Docker and Docker Compose installed
- **Minimal Requirements**
  - If you don't have the recommended system requirements, you can still use the minimal requirements:
    - 8GB RAM
    - 2 Core
    - 100GB SSD
    - Docker and Docker Compose installed
  - However, please note that using the minimal requirements may affect the performance and stability of your instance. You may experience slower loading times, higher CPU usage, or unexpected errors.

#### Prerequisites for Single-Server Deployment
Before you start the deployment process, please make sure you have:

- A server running Debian, Ubuntu, or RHEL derivative
- Docker and Docker Compose installed on your server

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

If you don't like to use npm or do not have it installed, run this instead: 

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

OneUptime should run at: http://localhost. You need to register a new account for your instance to start using it. If you would like to use https, please use a reverse proxy like Nginx.

### Development

For local development you need to use docker-compose.dev.yml file. 

You need to make sure you have: 
- Docker and Docker compose installed. 
- Node.js and NPM installed.

```
# Clone this repo and cd into it.
git clone https://github.com/OneUptime/oneuptime.git
cd oneuptime

# Copy config.example.env to config.env
cp config.example.env config.env

# Since this is dev, you don't have to edit any of those values in config.env. You can, but that's optional.
npm run dev
```


## Philosophy

Our mission is to reduce downtime and increase the number of successful products in the world. To do that, we built a platform that helps you understand causes of the downtime, incidents and help reduce toil. Our product is open-source, free and available for everyone to use. 

## Contributing

We <3 contributions big and small. In priority order (although everything is appreciated) with the most helpful first:

- Give us feedback in our [Customer Slack community](https://oneuptimesupport.slack.com/join/shared_invite/zt-1kavkds2f-gegm_wePorvwvM3M_SaoCQ#/shared-invite/email)
- Talk to developers in our [Developer Slack community](https://join.slack.com/t/oneuptimedev/shared_invite/zt-17r8o7gkz-nITGan_PS9JYJV6WMm_TsQ)
- Write tests for some of our codebase. [See issues here](https://github.com/OneUptime/oneuptime/issues?q=is%3Aopen+is%3Aissue+label%3A%22write+tests%22)
- Work on any issue you like. [See issues here](https://github.com/OneUptime/oneuptime/issues)
- Open new issues and create new feature requests that you would like to see. [Open issues here](https://github.com/OneUptime/oneuptime/issues)

## Donate

If you like the project, please consider a small donation. Every single dollar will be used to ship new features or maintain existing ones. 100% of the work we do is open-source. [Please donate here](https://github.com/sponsors/OneUptime)
