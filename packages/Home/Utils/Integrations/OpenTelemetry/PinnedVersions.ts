import { PackageEcosystem } from "./GuideCodeChecks";
import { DOTNET_PACKAGE_VERSIONS } from "./DotNetShared";
import { JAVASCRIPT_PACKAGE_VERSIONS } from "./JavaScriptShared";
import { JVM_PACKAGE_VERSIONS } from "./JvmShared";
import { PYTHON_PACKAGE_VERSIONS } from "./PythonShared";

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
};

/*
 * What an exact version looks like in each registry, so a check can be run
 * again and install the same thing: npm's 1.10.0, PyPI's 0.66b1 or
 * 2.0.30.post1, Maven's 2.33.1-alpha or 3.40.1.1, NuGet's 1.20.1-beta.1.
 */
const EXACT_VERSIONS: Readonly<Record<PackageEcosystem, RegExp>> = {
  npm: /^\d+\.\d+\.\d+$/,
  pypi: /^\d+(\.\d+)+((a|b|rc)\d+)?(\.post\d+)?$/,
  maven: /^\d+(\.\d+)+(-[A-Za-z0-9]+(\.\d+)?)?$/,
  nuget: /^\d+\.\d+\.\d+(-[a-z]+\.\d+)?$/,
};

export function isExactVersion(
  ecosystem: PackageEcosystem,
  version: string | undefined,
): boolean {
  return Boolean(version) && EXACT_VERSIONS[ecosystem].test(version || "");
}
