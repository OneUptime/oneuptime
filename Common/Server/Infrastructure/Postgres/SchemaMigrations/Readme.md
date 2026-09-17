To create a new migration, run this from the repository root and then register
the generated class in `Index.ts` (import it and append it to the exported array):

```
npm run generate-postgres-migration
```

Registered migrations run when the app starts. To check that the registered
migrations match the models:

```
npm run check-postgres-schema-drift
```
