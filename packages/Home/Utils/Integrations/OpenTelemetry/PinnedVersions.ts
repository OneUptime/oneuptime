import { PackageEcosystem } from "./GuideCodeChecks";
import { DOTNET_PACKAGE_VERSIONS } from "./DotNetShared";
import { ELIXIR_PACKAGE_VERSIONS } from "./ElixirShared";
import { GO_PACKAGE_VERSIONS } from "./GoShared";
import { JAVASCRIPT_PACKAGE_VERSIONS } from "./JavaScriptShared";
import { JVM_PACKAGE_VERSIONS } from "./JvmShared";
import { PECL_EXTENSION_VERSIONS, PHP_PACKAGE_VERSIONS } from "./PhpShared";
import { PYTHON_PACKAGE_VERSIONS } from "./PythonShared";
import { RUBY_PACKAGE_VERSIONS } from "./RubyShared";
import { RUST_CRATE_VERSIONS } from "./RustShared";

/*
 * The versions the guides pin, per registry: what a guide's install
 * command or build file must name, and what the end-to-end check must
 * have installed (Tests/OpenTelemetryGuides holds both).
 */
export const PINNED_PACKAGE_VERSIONS: Readonly<
  Record<PackageEcosystem, Readonly<Record<string, string>>>
> = {
  npm: JAVASCRIPT_PACKAGE_VERSIONS,
  pypi: PYTHON_PACKAGE_VERSIONS,
  maven: JVM_PACKAGE_VERSIONS,
  nuget: DOTNET_PACKAGE_VERSIONS,
  go: GO_PACKAGE_VERSIONS,
  rubygems: RUBY_PACKAGE_VERSIONS,
  packagist: PHP_PACKAGE_VERSIONS,
  pecl: PECL_EXTENSION_VERSIONS,
  crates: RUST_CRATE_VERSIONS,
  hex: ELIXIR_PACKAGE_VERSIONS,
};

/*
 * What an exact version looks like in each registry, so a check can be run
 * again and install the same thing: npm's 1.10.0, PyPI's 0.66b1 or
 * 2.0.30.post1, Maven's 2.33.1-alpha or 3.40.1.1, NuGet's 1.20.1-beta.1,
 * a Go module's v1.47.0, a gem's 1.13.1, Composer's 1.15.0, a PECL
 * release's 1.4.2, a crate's 0.33.1 and a Hex package's 1.7.0. A range a
 * package manager reads as one (Composer's ^1.15, a Gemfile's ~> 1.13) is
 * no exact version.
 */
const EXACT_VERSIONS: Readonly<Record<PackageEcosystem, RegExp>> = {
  npm: /^\d+\.\d+\.\d+$/,
  pypi: /^\d+(\.\d+)+((a|b|rc)\d+)?(\.post\d+)?$/,
  maven: /^\d+(\.\d+)+(-[A-Za-z0-9]+(\.\d+)?)?$/,
  nuget: /^\d+\.\d+\.\d+(-[a-z]+\.\d+)?$/,
  go: /^v\d+\.\d+\.\d+$/,
  rubygems: /^\d+(\.\d+)+$/,
  packagist: /^\d+\.\d+\.\d+$/,
  pecl: /^\d+\.\d+\.\d+$/,
  crates: /^\d+\.\d+\.\d+$/,
  hex: /^\d+\.\d+\.\d+$/,
};

export function isExactVersion(
  ecosystem: PackageEcosystem,
  version: string | undefined,
): boolean {
  return Boolean(version) && EXACT_VERSIONS[ecosystem].test(version || "");
}
