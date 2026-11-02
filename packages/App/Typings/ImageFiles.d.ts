/*
 * Image files, as the frontends' bundler hands them over: a module whose
 * default is the file's address.
 *
 * Each frontend declares these in its own index.d.ts, which App's own
 * program leaves out with the frontends. But App's tests import Dashboard
 * modules, and through them Common components that import an image file of
 * their own (OneUptime's logo, the blank profile picture) - so App's tsc
 * meets image files too.
 */
declare module "*.svg";
declare module "*.png";
