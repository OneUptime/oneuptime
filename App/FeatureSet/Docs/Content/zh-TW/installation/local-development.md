# 本機開發

進行本機開發時，你需要使用 docker-compose.dev.yml 檔案。

你需要確認你已經具備：

- 已安裝 Docker 與 Docker compose。
- 已安裝 Node.js 與 NPM。

```
# Clone this repo and cd into it.
git clone https://github.com/OneUptime/oneuptime.git
cd oneuptime

# Copy config.example.env to config.env
cp config.example.env config.env

# Since this is dev, you don't have to edit any of those values in config.env. You can, but that's optional.
npm run dev
```
