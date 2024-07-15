## OneUptime Copilot

OneUptime Copilot is a tool that helps you improve your codebase automatically. Copilot can fix following issues automatically: 

-   **Performance Issues**: Improve database queries, optimize code, reduce memory usage, decrease API response time, etc. 
-   **Security Issues**: Fix security vulnerabilities, prevent SQL injection, XSS, CSRF, etc.
-   **Code Quality Issues**: Improve code readability, maintainability, and scalability. Improve comments, naming conventions, refactor code, etc.
-   **Error Handling Issues**: Improve error handling, exception handling, logging, etc.
-   **Testing Issues**: Improve test coverage, test quality, test performance, etc.
-   **Documentation Issues**: Improve documentation quality, comments, README, etc.

### Architecture

Copilot can be installed as a CI/CD tool and can be run on every merge to master / main branch. Copilot can also be scheduled to run as a cron on the CI/CD pipeline. We recommend you run Copilot atleast once/day. 

There are three services when running copilot: 

- **OneUptime**: You need to deploy or use OneUptime Cloud (https://oneuptime.com) to run Copilot. When you deploy OneUptime, url should be publicily accessible.
- **Copilot**: Copilot is the main service that runs the Copilot engine. Copilot engine is responsible for analyzing the codebase and fixing issues.
- **LLM Server** (Optional): Copilot sends your code to LLM Server to analyze and fix issues. The source-code and docker-image is [open-source](https://github.com/OneUptime/oneuptime/tree/master/LLM) and can be found at [Docker Hub](https://hub.docker.com/r/oneuptime/llm). This can be self-deployed if you want to run Copilot on-premises or you can use the hosted version.

### FAQ

**Is my code sent to OneUptime?**

No, your code is not sent to OneUptime. Copilot runs on your CI/CD pipeline and sends the code to LLM Server for analysis. LLM Server can be self-hosted. 

**Is my code sent to Self-Hosted LLM Server?**

Yes, but you can self host LLM server so code is not sent outside of your infrastructure. Your code is sent to LLM Server for analysis. LLM Server is responsible for analyzing the code and fixing issues.

**Is my code sent to any third-party?**

No. We strictly do not send any telemetry data or code to any third-party.

**Is my code sent to OpenAI?**

No, If you host LLM Server yourself. 

Yes, if you choose to use OpenAI by setting `OPENAI_API_KEY`. We recommend you to use OpenAI only if you are comfortable with OpenAI's privacy policy. We're not responsible for any data sent to OpenAI or how your code is analyzed / used by OpenAI.

### Pre-requisites

Before you install Copilot, you need to make sure you have the following:

- **OneUptime Account**: You need to have a OneUptime account to use Copilot. You can sign up for a free account at [OneUptime](https://oneuptime.com). You can either use OneUptime Cloud or deploy OneUptime on your infrastructure.
- **GitHub Account**: You need to have a GitHub account to use Copilot. You can sign up for a free account at [GitHub](https://github.com). You can also use GitLab, Bitbucket, etc.

You also need either of the following:

- **LLM Server** (Optional): You need to have LLM Server to run Copilot. [Please check this guide to deploy LLM Server](https://oneuptime.com/docs/copilot/deploy-llm-server).

or

- **OpenAI** (Optional): You need to have OpenAI API Key and Model to run Copilot. Please check env vars for more information.


### Installation

To install Copilot, you need to follow the following steps:

#### Environment Variables

You need to set the following environment variables to run Copilot:

**Required Environment Variables**:

- **ONEUPTIME_REPOSITORY_SECRET_KEY**: The secret key of the repository. You can get this key from OneUptime Dashboard -> Reliability Copilot -> View Repository. If you don't have a repository, you can create a new repository, then click on "View Repository" to get the secret key.

- **CODE_REPOSITORY_USERNAME**: OneUptime uses this username to commit and push changes to GitHub / GitLab / etc. This should be the username of the existing user on GitHub that has access to the repository.

- **CODE_REPOSITORY_PASSWORD**: OneUptime uses this password to commit and push changes to GitHub / GitLab / etc. This should be the password of the existing user on GitHub that has access to the repository. You can also use Personal Access Tokens instead of Password. Please make sure the token has write permissions to the repo. 

**Optional Environment Variables**:

- **ONEUPTIME_URL**: The URL of OneUptime Cloud. If left empty, Copilot will default to `https://oneuptime.com`.

If you are using LLM Server, you need to set the following environment variables:

- **ONEUPTIME_LLM_SERVER_URL**: The URL of LLM Server. (For example: https://your-llm-server.com:8547)

If you are using OpenAI, you need to set the following environment variables:

- **OPENAI_API_KEY**: The API key of OpenAI. You can get this key from OpenAI Dashboard.

**Important**: You need to provide either `ONEUPTIME_LLM_SERVER_URL` or `OPENAI_API_KEY` in order to use Copilot.

#### GitHub Actions 

You can use GitHub Actions to run Copilot on every merge to master / main branch.

```yaml
name: "OneUptime Reliability Copilot"

on:
  push:
    # change this to main if you are using main branch.
    branches: [ master ]
  schedule:
    # Run every day at midnight UTC
    - cron: '0 0 * * *'

jobs:
  analyze:
    name: Analyze Code
    runs-on: ubuntu-latest

    steps:
      
    # Run Reliability Copilot in Doker Container
    - name: Run Copilot
      run: |
        docker run --rm  \ 
            -e CODE_REPOSITORY_PASSWORD='<YOUR_GITHUB_PASSWORD>' \ # Required. Please make sure to use GitHub secrets. 
            -e CODE_REPOSITORY_USERNAME='<YOUR_GITHUB_USERNAME>' \ # Required.
            -e ONEUPTIME_URL='https://oneuptime.com' \ # Optional. Leave empty to use OneUptime Cloud. 
            -e ONEUPTIME_REPOSITORY_SECRET_KEY='<ONEUPTIME_REPOSITORY_SECRET_KEY>' \ # Required. Please make sure to use GitHub secrets. 
            -e ONEUPTIME_LLM_SERVER_URL='<YOUR_ONEUPTIME_LLM_SERVER>' \ # Optional. Leave empty to use OneUptime LLM Server. 
            -e OPENAI_API_KEY='<YOUR_OPENAI_API_KEY>' \ # Optional. Leave empty to not use OpenAI.
            oneuptime/copilot:release
```

#### Docker

You can also run Copilot using docker. You can run this in any CI/CD of your choice. 

```bash
docker run --rm \ 
    -e CODE_REPOSITORY_PASSWORD='<YOUR_GITHUB_PASSWORD>' \ # Required. Please make sure to use GitHub secrets. 
    -e CODE_REPOSITORY_USERNAME='<YOUR_GITHUB_USERNAME>' \ # Required.
    -e ONEUPTIME_URL='https://oneuptime.com' \ # Optional. Leave empty to use OneUptime Cloud. 
    -e ONEUPTIME_REPOSITORY_SECRET_KEY='<ONEUPTIME_REPOSITORY_SECRET_KEY>' \ # Required. Please make sure to use GitHub secrets. 
    -e ONEUPTIME_LLM_SERVER_URL='<YOUR_ONEUPTIME_LLM_SERVER>' \ # Optional. Leave empty to use OneUptime LLM Server. 
    -e OPENAI_API_KEY='<YOUR_OPENAI_API_KEY>' \ # Optional. Leave empty to not use OpenAI.
    oneuptime/copilot:release
```

### Support

If you have any questions or need help, please contact us at support@oneuptime.com