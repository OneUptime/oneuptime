# Local Development

For local development you need to use docker-compose.dev.yml file. 

You need to make sure you have: 
- Docker and Docker compose installed. 
- Node.js and NPM installed.

```
# Clone this repo and cd into it.
git clone https://github.com/OneUptime/oneuptime.git
cd oneuptime

# Copy config.example.env to config.env
cp config.example.env config.env

# Since this is dev, you don't have to edit any of those values in config.env. You can, but that's optional.
npm run dev
```