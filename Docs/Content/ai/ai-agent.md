# AI Agents

AI Agents in OneUptime are autonomous agents that can help you manage incidents, alerts, and other operational tasks. You can deploy AI agents within your infrastructure to provide intelligent assistance for your team.

## What Can AI Agents Do?

AI Agents help automate and enhance your incident management workflow:

- **Incident Management**: Automatically analyze and respond to incidents
- **Alert Triage**: Help categorize and prioritize alerts
- **Root Cause Analysis**: Assist in identifying the root cause of issues
- **Automated Responses**: Execute predefined actions based on incident patterns
- **Knowledge Base Integration**: Leverage your documentation and runbooks for contextual assistance

## Global AI Agents vs Self-Hosted AI Agents

### Global AI Agents

If you are using **OneUptime SaaS** (cloud-hosted version), Global AI Agents are provided by OneUptime and are pre-configured and ready to use. These agents are managed by OneUptime and require no additional setup.

Global AI Agents are automatically available to all projects unless disabled in your project settings.

### Self-Hosted AI Agents

For organizations that need to run AI agents within their own infrastructure (e.g., for security, compliance, or network access requirements), OneUptime supports self-hosted AI agents.

Self-hosted AI agents:
- Run within your private network
- Can access internal resources and systems
- Give you full control over the agent's environment
- Can be customized for your specific needs

## Setting Up a Self-Hosted AI Agent

### Step 1: Create an AI Agent in OneUptime

1. Log in to your OneUptime dashboard
2. Go to **Project Settings** > **AI Agents**
3. Click **Create AI Agent** to add a new agent
4. Fill in the required fields:
   - **Name**: A friendly name for your AI agent
   - **Description** (optional): A description of the agent's purpose
5. Once created, you will receive an `AI_AGENT_ID` and `AI_AGENT_KEY`

**Important**: Save your `AI_AGENT_KEY` securely. It will only be shown once and cannot be retrieved later.

### Step 2: Deploy the AI Agent

#### Docker

To run an AI agent, make sure you have Docker installed. Run the agent with:

```bash
docker run --name oneuptime-ai-agent --network host \
  -e AI_AGENT_KEY=<ai-agent-key> \
  -e AI_AGENT_ID=<ai-agent-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -d oneuptime/ai-agent:release
```

If you are self-hosting OneUptime, change `ONEUPTIME_URL` to your custom self-hosted instance URL.

#### Docker Compose

You can also run the AI agent using docker-compose. Create a `docker-compose.yml` file:

```yaml
version: "3"

services:
  oneuptime-ai-agent:
    image: oneuptime/ai-agent:release
    container_name: oneuptime-ai-agent
    environment:
      - AI_AGENT_KEY=<ai-agent-key>
      - AI_AGENT_ID=<ai-agent-id>
      - ONEUPTIME_URL=https://oneuptime.com
    network_mode: host
    restart: always
```

Then run:

```bash
docker compose up -d
```

#### Kubernetes

Create a `oneuptime-ai-agent.yaml` file:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oneuptime-ai-agent
spec:
  selector:
    matchLabels:
      app: oneuptime-ai-agent
  template:
    metadata:
      labels:
        app: oneuptime-ai-agent
    spec:
      containers:
      - name: oneuptime-ai-agent
        image: oneuptime/ai-agent:release
        env:
          - name: AI_AGENT_KEY
            value: "<ai-agent-key>"
          - name: AI_AGENT_ID
            value: "<ai-agent-id>"
          - name: ONEUPTIME_URL
            value: "https://oneuptime.com"
```

Apply the configuration:

```bash
kubectl apply -f oneuptime-ai-agent.yaml
```

### Environment Variables

The AI agent supports the following environment variables:

#### Required Variables

| Variable | Description |
|----------|-------------|
| `AI_AGENT_KEY` | The AI agent key from your OneUptime dashboard |
| `AI_AGENT_ID` | The AI agent ID from your OneUptime dashboard |
| `ONEUPTIME_URL` | The URL of your OneUptime instance (default: https://oneuptime.com) |

## Managing AI Agents

### Viewing Agent Status

You can view the status of your AI agents in **Project Settings** > **AI Agents**. Each agent shows:

- **Connection Status**: Whether the agent is connected or disconnected
- **Last Seen**: When the agent last communicated with OneUptime
- **Version**: The version of the AI agent

### Resetting Agent Key

If you need to reset an AI agent's key (e.g., if it was compromised):

1. Go to **Project Settings** > **AI Agents**
2. Click on the AI agent you want to reset
3. Click **Reset Secret Key**
4. Update your deployed agent with the new key

### Deleting an AI Agent

To delete an AI agent:

1. Go to **Project Settings** > **AI Agents**
2. Click on the AI agent you want to delete
3. Click **Delete AI Agent**
4. Confirm the deletion

**Note**: Deleting an AI agent will immediately disconnect any deployed instances using that agent's credentials.

## Owner Management

You can assign owners (users or teams) to AI agents. Owners will receive notifications when:

- The AI agent's connection status changes (connected/disconnected)
- They are added as an owner to an AI agent

To manage owners:

1. Go to **Project Settings** > **AI Agents**
2. Click on the AI agent
3. Use the **Owners (Users)** or **Owners (Teams)** sections to add or remove owners

## Global AI Agent Settings

By default, Global AI Agents are automatically enabled for new resources in your project. To change this behavior:

1. Go to **Project Settings** > **AI Agents**
2. Toggle **Enable Global AI Agents for New Resources**

When disabled, Global AI Agents will not be automatically assigned to new monitors, incidents, or other resources.

## Verifying Your AI Agent

After deploying your AI agent:

1. Go to **Project Settings** > **AI Agents** in your OneUptime dashboard
2. Your agent should show as **Connected** within a few minutes
3. If the status shows **Disconnected**, check the container logs for errors

To view container logs:

```bash
# Docker
docker logs oneuptime-ai-agent

# Kubernetes
kubectl logs deployment/oneuptime-ai-agent
```

## Troubleshooting

### Agent Not Connecting

1. **Verify credentials**: Ensure `AI_AGENT_KEY` and `AI_AGENT_ID` are correct
2. **Check network**: Ensure the agent can reach your OneUptime instance
3. **Review logs**: Check container logs for error messages
4. **Firewall rules**: Ensure outbound HTTPS (port 443) is allowed

### Agent Keeps Disconnecting

1. **Check resource limits**: Ensure the container has sufficient memory and CPU
2. **Network stability**: Verify network connectivity is stable
3. **Review logs**: Look for timeout or connection errors in the logs

## Need Help?

If you encounter issues with your AI agent:

1. Check the [OneUptime GitHub Issues](https://github.com/OneUptime/oneuptime/issues) for known problems
2. Create a new issue if your problem isn't already reported
3. Contact [support](https://oneuptime.com/support) if you're on an enterprise plan
