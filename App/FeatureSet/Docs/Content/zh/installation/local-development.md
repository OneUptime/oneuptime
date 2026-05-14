# 本地开发

本地开发需要使用 docker-compose.dev.yml 文件。

您需要确保已安装：
- Docker 和 Docker Compose
- Node.js 和 NPM

```
# 克隆此代码仓库并进入目录
git clone https://github.com/OneUptime/oneuptime.git
cd oneuptime

# 将 config.example.env 复制为 config.env
cp config.example.env config.env

# 由于这是开发环境，您不必编辑 config.env 中的任何值。您可以编辑，但这是可选的。
npm run dev
```
