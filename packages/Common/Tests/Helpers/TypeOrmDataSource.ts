/*
 * Common's own typeorm, for a Postgres suite in a package that does not install it. The Probe
 * reaches typeorm only through Common, and its CI job installs nothing at the repository's root,
 * so `from "typeorm"` in one of its tests finds no package there while it does on a checkout with
 * the root's installed. A second copy would not help: Common's models and services were written
 * against this one.
 */
export { DataSource } from "typeorm";
