# OneUptime Enterprise Edition (`ee/`)

Everything in this directory is the OneUptime Enterprise Edition and is licensed
under [`ee/LICENSE`](./LICENSE), not under the Apache-2.0 license that covers the
rest of the repository.

The Community Edition image is built without this directory. The Enterprise
Edition image includes it, and the App loads it at boot
(`packages/App/Utils/EnterpriseLoader.ts`).

## Layout

- `Server/Index.ts` is the enterprise server module. It is assembled from the
  per-area modules in `Server/{Identity,TeamCompliance,AuditLog,License,LicenseServer,AdminHealth,Workers}/Index.ts`
  and implements `EnterpriseServerModule` from
  `packages/Common/Server/Enterprise/EnterpriseServerModule.ts`.
- `Server/License/LicenseToken.ts` holds the signed-license format: EdDSA
  compact JWS, a strict parser and the license classification.
- `Tests/Server` and `Tests/UI` are the two jest projects in `jest.config.js`.

## Working on ee/

```bash
cd ee
npm ci --ignore-scripts
npx tsc -p tsconfig.json
node node_modules/.bin/jest
```

ee/ imports core only as `Common/...` and `App/...`. Core never imports ee/.

_This README is a stub; the full contributor and licensing notes follow._
