# OneUptime Copilot

Copilot is a tool that helps you improve your codebase automatically. 

## Run Copilot with Docker

```bash
docker run -v $(pwd):/app -w /app oneuptime/copilot
```

### Volumes

 - `/repository` - The directory where your codebase is located.