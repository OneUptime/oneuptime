# 本地開發

本地開發需要使用 docker-compose.dev.yml 文件。

您需要確保已安裝：
- Docker 和 Docker Compose
- Node.js 和 NPM

```
# 克隆此代碼倉庫並進入目錄
git clone https://github.com/OneUptime/oneuptime.git
cd oneuptime

# 將 config.example.env 複製爲 config.env
cp config.example.env config.env

# 由於這是開發環境，您不必編輯 config.env 中的任何值。您可以編輯，但這是可選的。
npm run dev
```
