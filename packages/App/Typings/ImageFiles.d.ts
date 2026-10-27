/*
 * Image files, as the frontends' bundler hands them over: a module whose
 * default is the file's address.
 *
 * Each frontend declares these in its own index.d.ts, which App's own
 * program leaves out with the frontends. But App's tests import Dashboard
 * modules that use Common's forms, and through them the official logos'
 * loader (Common/UI/Components/ProviderLogo/ProviderLogoAssets.ts), which
 * names each logo's SVG file - so App's tsc meets image files too.
 */
declare module "*.svg";
declare module "*.png";
