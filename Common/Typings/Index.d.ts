declare module "*.png";
declare module "*.jpg";
declare module "*.gif";

/*
 * i18next-browser-languagedetector is an App-only browser dependency that a
 * few Common tests reach through imported App/FeatureSet sources (e.g. the
 * StatusPage detail pages via their Utils/i18n). It is not installed in
 * Common/node_modules — Common's jest moduleNameMapper mocks it at runtime —
 * so the type checker has nothing to resolve when it compiles those App files
 * from within the Common Test job (which installs Common alone). This ambient
 * shim gives the type checker an `any` module so the suite compiles; the mock
 * supplies the behaviour at runtime.
 */
declare module "i18next-browser-languagedetector";
