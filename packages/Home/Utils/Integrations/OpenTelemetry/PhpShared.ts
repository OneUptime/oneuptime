import { GuideSnippet, InlineText } from "./GuideTypes";

/*
 * The PHP guides' shared facts: the Composer packages and the PECL
 * extension they add, at the versions the end-to-end check ran
 * (Verifications.json records composer.lock's versions and the
 * extension's, and Tests/OpenTelemetryGuides holds every install to them),
 * the variables every PHP app needs, and the images the guides build.
 *
 * OpenTelemetry PHP, October 2026: the API 1.10 and the SDK 1.15 are
 * stable for traces, metrics and logs. Automatic instrumentation needs the
 * opentelemetry extension (1.4, from PECL), which lets the auto-* packages
 * hook into a library's functions without a change to its code.
 */
export const PHP_PACKAGE_VERSIONS: Record<string, string> = {
  "open-telemetry/sdk": "1.15.0",
  "open-telemetry/exporter-otlp": "1.4.0",
  "open-telemetry/opentelemetry-auto-pdo": "0.6.0",
  "open-telemetry/opentelemetry-auto-guzzle": "1.5.0",
  "open-telemetry/opentelemetry-logger-monolog": "1.3.1",
  "open-telemetry/opentelemetry-auto-laravel": "1.10.0",
  "open-telemetry/opentelemetry-auto-symfony": "1.7.0",
  "open-telemetry/opentelemetry-auto-slim": "1.5.1",
  "open-telemetry/opentelemetry-auto-psr18": "1.4.0",
  // The apps' own packages, as the checks ran them.
  "monolog/monolog": "3.12.1",
  "guzzlehttp/guzzle": "8.3.1",
  "laravel/laravel": "13.11.0",
  "symfony/skeleton": "8.1.99",
  "symfony/http-client": "8.1.10",
  "symfony/monolog-bundle": "4.1.0",
  "doctrine/doctrine-bundle": "3.3.3",
  "doctrine/dbal": "4.5.0",
  "slim/slim": "4.15.3",
  "slim/psr7": "1.8.0",
};

export const PECL_EXTENSION_VERSIONS: Record<string, string> = {
  opentelemetry: "1.4.2",
};

export const PHP_VERSION: string = "8.5";

// Every PHP guide's first prerequisite.
export const PHP_PREREQUISITE: InlineText = `PHP 8.2 or later with Composer, and PECL with a C compiler to build the OpenTelemetry extension, as the official PHP images have. These steps were checked with PHP ${PHP_VERSION}.`;

// A package at its pinned version, as Composer takes it: open-telemetry/sdk:1.15.0.
export function pinnedPhpPackage(name: string): string {
  const version: string | undefined = PHP_PACKAGE_VERSIONS[name];

  if (!version) {
    throw new Error(`No pinned version for ${name}`);
  }

  return `${name}:${version}`;
}

// `composer require` of the given packages at their pinned versions, one a line.
export function composerRequireSnippet(
  id: string,
  packages: ReadonlyArray<string>,
): GuideSnippet {
  return {
    id: id,
    language: "bash",
    code: `composer require ${packages.map(pinnedPhpPackage).join(" \\\n  ")}`,
    check: "run",
  };
}

// The SDK, the OTLP exporter, and what every PHP guide traces with them.
export const PHP_SDK_PACKAGES: ReadonlyArray<string> = [
  "open-telemetry/sdk",
  "open-telemetry/exporter-otlp",
];

/*
 * The extension every PHP guide builds first: from PECL, at its pinned
 * version, then loaded from the folder PHP reads its extra .ini files from.
 */
export function peclInstallSnippet(): GuideSnippet {
  return {
    id: "install-extension",
    language: "bash",
    code: [
      `pecl install opentelemetry-${PECL_EXTENSION_VERSIONS["opentelemetry"]}`,
      'echo "extension=opentelemetry" > "$(php-config --ini-dir)/opentelemetry.ini"',
    ].join("\n"),
    check: "run",
  };
}

/*
 * The variables every PHP app sets beside the standard three: the SDK
 * sets itself up from the environment only when told to, and a PHP-FPM
 * worker's counters start again with every request, so each export holds
 * what one request counted.
 */
export const PHP_ENVIRONMENT_LINES: Array<string> = [
  'export OTEL_PHP_AUTOLOAD_ENABLED="true"',
  'export OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE="delta"',
];

export interface PhpDockerfileOptions {
  // The folder Apache serves: "public" for a front controller.
  documentRoot: string;
  // Lines run after the code is copied, before the image's last step.
  extraLines?: Array<string> | undefined;
}

/*
 * Apache with mod_php, the extension built by the PHP image's own
 * installer of PECL extensions, and the app's packages from composer.lock.
 */
export function phpDockerfileSnippet(
  options: PhpDockerfileOptions,
): GuideSnippet {
  return {
    id: "dockerfile",
    language: "dockerfile",
    title: "Dockerfile",
    code: [
      `FROM php:${PHP_VERSION}-apache`,
      "COPY --from=mlocati/php-extension-installer:2 /usr/bin/install-php-extensions /usr/local/bin/",
      `RUN install-php-extensions opentelemetry-${PECL_EXTENSION_VERSIONS["opentelemetry"]}`,
      "COPY --from=composer:2 /usr/bin/composer /usr/local/bin/composer",
      "# Composer unpacks packages with unzip, which the image does not have.",
      "RUN apt-get update && apt-get install -y --no-install-recommends unzip \\",
      "  && rm -rf /var/lib/apt/lists/*",
      "WORKDIR /var/www/html",
      "COPY composer.json composer.lock ./",
      "RUN composer install --no-dev --no-interaction --optimize-autoloader --no-scripts",
      "COPY . .",
      `ENV APACHE_DOCUMENT_ROOT=/var/www/html/${options.documentRoot}`,
      "RUN sed -ri 's!/var/www/html!${APACHE_DOCUMENT_ROOT}!g' /etc/apache2/sites-available/*.conf",
      // Every path that is not a file goes to the front controller.
      'RUN echo "FallbackResource /index.php" > /etc/apache2/conf-enabled/front-controller.conf',
      ...(options.extraLines || []),
      "EXPOSE 80",
    ].join("\n"),
    check: "parse",
  };
}
