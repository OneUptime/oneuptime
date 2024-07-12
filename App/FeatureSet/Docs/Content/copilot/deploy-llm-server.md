## Deploy LLM Server

This step is optional. You need to deploy LLM Server only if you want to use Copilot with LLM Server on your infrastructure for data privacy reasons. If you are comfortable with OpenAI's privacy policy, you can skip this step and use OpenAI directly.

### Pre-requisites

Before you deploy LLM Server, you need to make sure you have the following:

- **Docker**: You need to have Docker installed on your machine. 
- **Docker Compose**: You need to have Docker Compose installed on your machine.
- **System Requirements**: You need to have at least 64 GB of RAM, 32 GB GPU (compitable with CUDA & Docker), 8 CPU cores, and 100 GB of disk space. You could get away with less resources, but we recommend the above configuration for optimal performance. 
- **GPU is accessible by Docker**: You need to make sure that the GPU is accessible by Docker. Please read this [guide](https://docs.docker.com/compose/gpu-support/) for more information.

### Installation

To deploy LLM Server, you need to follow the following steps with docker-compose: 

Create a `docker-compose.yml` file with the following content:

```yaml
llm: 
    extends:
        file: ./docker-compose.base.yml
        service: llm
    ports:
        - '8547:8547'
    image: 'oneuptime/llm:release'
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
```

Run the following command to start the LLM Server:

```bash
docker-compose up -d
```

You can now access the LLM Server at `http://localhost:8547`. 


### TLS/SSL Configuration

You can set up TLS/SSL by having a reverse proxy in front of the LLM Server. This is recommended for production deployments and is beyond the scope of this document.

### Public Access

Please make sure this server is publicly accessible. So, it can be accessed by Copilot. 

### Security

Please also make sure to secure the server by setting up a firewall so only copilot can access it.