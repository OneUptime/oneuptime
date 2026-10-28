/*
 * The PHP guides' shared facts: the Composer packages and the PECL
 * extension they add, at the versions the end-to-end check ran
 * (Verifications.json records composer.lock's versions and the
 * extension's, and Tests/OpenTelemetryGuides holds every install to them).
 */
export const PHP_PACKAGE_VERSIONS: Record<string, string> = {};

export const PECL_EXTENSION_VERSIONS: Record<string, string> = {};
