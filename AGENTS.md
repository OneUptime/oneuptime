This is a local development server hosted at HOST env variable (please read config.env file). This project is hosted on docker compose for local development. When you make any changes to the codebase the container hot-reloads. Please make sure you wait for it to restart to test. If you need access to the database during development, credentials are in config.env file.

Things to keep in mind while developing:

Do not worry about circular dependencies. All the import should be on the top of the file.

### Migrations

#### Postgres

If you are doing any postgres migration. Please do not write migraton code manually, run npm run generate-postgres-migration instead.

After generating the migration file, you MUST also register it in `Common/Server/Infrastructure/Postgres/SchemaMigrations/Index.ts` — add the import at the top and append the class to the default export array. The migration will not run on app startup until it is registered there.

CI enforces this. The "Postgres Schema Drift" workflow migrates an empty database with every registered migration and then generates a migration against the result; anything it can still generate is drift and fails the job. Run the same check locally with `npm run check-postgres-schema-drift` — it prints the exact statements that are missing.

#### Clickhouse

Clickhouse migrations are written manually. Please write the migration code in DataMigrations and follow the same pattern as other migrations.

### After you make a change.

Please run "npm run fix" in root to fix all the lint issues. Please run "npm run compile" in projects that you made changes to make sure compile works.

### Helm chart

The chart lives in `HelmChart/Public/oneuptime`. It has cluster-free unit tests in
`HelmChart/Public/oneuptime/tests` (helm-unittest). Install the plugin once with
`helm plugin install https://github.com/helm-unittest/helm-unittest` and run them with
`npm run test-helm-chart`. CI runs them in the "Common Jobs" workflow alongside `helm lint`.

### Project docs

Internal roadmaps live in `Internal/Roadmap/` (see its README for the index).
