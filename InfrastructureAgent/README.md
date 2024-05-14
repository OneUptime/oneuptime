# OneUptime Infrastructure Agent

The OneUptime Infrastructure Agent is a lightweight, open-source agent that collects system metrics and sends them to the OneUptime platform. It is designed to be easy to install and use, and to be extensible.

## Installation

Download the Installation Script
```bash
curl -O https://raw.githubusercontent.com/anxuanzi/oneuptime-infrastructure-agent-go/main/install.sh
```

Run the Installation Script
```bash
chmod +x install.sh && ./install.sh
```

## Configure the agent

Configure the agent as a system service
- You can change the host to your own host if you're self hosting the OneUptime platform. 
- You can find the secret key on OneUptime Dashboard. Click on "View Monitor" and go to "Settings" tab.
```bash
oneuptime-infrastructure-agent configure --secret-key=YOUR_SECRET_KEY --oneuptime-url=https://oneuptime.com
```

## Starting the agent

```
oneuptime-infrastructure-agent start
```
Once its up and running you should see the metrics on the OneUptime Dashboard.

## Stopping the agent

```
oneuptime-infrastructure-agent stop
```

## Restarting the agent

```
oneuptime-infrastructure-agent restart
```

## Uninstalling the agent

```
oneuptime-infrastructure-agent uninstall && rm -rf /usr/bin/oneuptime-infrastructure-agent
```

## Supported Platforms

- Linux
- MacOS
- Windows