# Load env values from config.env
export $(grep -v '^#' config.env | xargs)
npm run prerun
export DATABASE_HOST=$DATABASE_MIGRATIONS_HOST
export DATABASE_PORT=$DATABASE_MIGRATIONS_PORT

sudo npm i -g ts-node 
npx typeorm-ts-node-esm migration:run --dataSource=./CommonServer/Infrastructure/PostgresConfig.ts