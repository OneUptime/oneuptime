# AI Agents

AI Agents in OneUptime automatically fix errors, performance issues, and database queries in your code. Powered by OpenTelemetry observability data, AI Agents create pull requests with fixes—not just alerts.

## What Can AI Agents Do?

AI Agents analyze your observability data (traces, logs, and metrics) to detect and automatically fix issues in your codebase:

- **Fix Errors Automatically**: When AI Agent notices exceptions in your traces or logs, it automatically fixes the issue and creates a pull request.
- **Fix Performance Issues**: Analyzes traces that take the longest to execute and creates pull requests with performance optimizations.
- **Fix Database Queries**: Identifies slow or inefficient database queries and optimizes them with proper indexing and query rewrites.
- **Fix Frontend Issues**: Addresses frontend-specific performance problems, rendering issues, and JavaScript errors automatically.
- **Add Telemetry Automatically**: Add tracing, metrics, and logs to your codebase with a single click. No manual instrumentation needed.
- **GitHub & GitLab Integration**: Seamlessly integrates with your existing repositories. PRs are created directly in your workflow.
- **CI/CD Integration**: Integrates with your existing CI/CD pipelines. Fixes are tested and validated before PR creation.
- **Terraform Support**: Fix infrastructure issues automatically. Supports Terraform and OpenTofu for infrastructure-as-code.
- **Issue Tracker Integration**: Connects with Jira, Linear, and other issue trackers. Automatically links fixes to relevant issues.

## How It Works

1. **Collect Data**: OpenTelemetry collects traces, logs, and metrics from your application
2. **Detect Issues**: AI identifies errors, performance bottlenecks, and slow queries
3. **Generate Fix**: AI analyzes your codebase and creates the fix automatically
4. **Create PR**: Pull request with fix and detailed report ready for review

## LLM Provider Flexibility

OneUptime works with any LLM provider. You can use:

- **OpenAI GPT** models
- **Anthropic Claude** models
- **Meta Llama** (via Ollama or other providers)
- **Custom self-hosted** models

Self-host your AI model and keep your code completely private.

## Privacy

Regardless of your plan, OneUptime never sees, stores, or trains on your code:

- **No Code Access**: Your code stays on your infrastructure
- **No Data Storage**: Zero data retention policy
- **No Training**: Your code is never used for AI training

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
