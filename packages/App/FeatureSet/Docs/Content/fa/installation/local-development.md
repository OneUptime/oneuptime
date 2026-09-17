# توسعه محلی

برای توسعه محلی باید از فایل docker-compose.dev.yml استفاده کنید.

باید مطمئن شوید که این‌ها را دارید:

- Docker و Docker Compose نصب شده باشد.
- Node.js و NPM نصب شده باشد.

```
# Clone this repo and cd into it.
git clone https://github.com/OneUptime/oneuptime.git
cd oneuptime

# Copy config.example.env to config.env
cp config.example.env config.env

# Since this is dev, you don't have to edit any of those values in config.env. You can, but that's optional.
npm run dev
```
