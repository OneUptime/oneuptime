# OneUptime Infrastructure Agent

The OneUptime Infrastructure Agent is a lightweight, open-source agent that collects system metrics and sends them to the OneUptime platform. It is designed to be easy to install and use, and to be extensible.

## Installation

```
npm i @oneuptime/infrastructure-agent -g

# You can change the host to your own host if you're self hosting the OneUptime platform. 
# You can find the secret key on OneUptime Dashboard. Click on "View Monitor" and go to "Settings" tab.

oneuptime-infrastructure-agent start --secret-key=YOUR_SECRET_KEY --oneuptime-url=https://oneuptime.com
```

Once its up and running you should see the metrics on the OneUptime Dashboard.


## Stopping the agent

```
oneuptime-infrastructure-agent stop
```

## Uninstalling the agent

```
npm uninstall -g @oneuptime/infrastructure-agent
```

## Supported Platforms

- Linux
- MacOS
- Windows

## Local Development

When you're developing locally, you can run the agent in development mode to send metrics to local oneuptime server. 

```
npm run start -- --secret-key=YOUR_SECRET_KEY --oneuptime-url=http://localhost
```
