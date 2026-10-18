#!/usr/bin/env python3
"""
What is left to do by hand for a Google Cloud Marketplace release, written to the run's
summary: Google offers no API to add a version to a Kubernetes app, so after the workflow has
pushed the images and the deployer, a person adds the version in Producer Portal and submits it.

    google_cloud_release.py summary --version X.Y.Z --deployer-digest sha256:...
"""

import argparse
import sys
from typing import Any, Dict, List, Optional

from release_common import ReleaseError, load_editions, track_of, write_summary

PRODUCER_PORTAL = "https://console.cloud.google.com/producer-portal?project=oneuptime-marketplace"


def deployer_reference(edition: Dict[str, Any], version: str) -> str:
    return f"{edition['registry']}/deployer:{version}"


def producer_portal_steps(edition: Dict[str, Any], version: str, deployer_digest: str) -> str:
    if deployer_digest and not deployer_digest.startswith("sha256:"):
        raise ReleaseError(f"\"{deployer_digest}\" is not an image digest (sha256:...).")

    track: str = track_of(version)
    deployer: str = deployer_reference(edition, version)
    digest: str = f" (digest `{deployer_digest}`)" if deployer_digest else ""
    lines: List[str] = [
        f"## Google Cloud Marketplace: add {version} in Producer Portal",
        "",
        f"The images and the deployer of {version} are in Artifact Registry, tagged `{version}` and "
        f"`{track}`, each annotated with the service `{edition['serviceName']}`. Google has no API "
        "for the rest:",
        "",
        f"1. Open [Producer Portal]({PRODUCER_PORTAL}) and the OneUptime Enterprise product.",
        f"2. Add the version `{version}` on the `{track}` track, from the deployer `{deployer}`{digest}.",
        "3. Submit it for review. Google tests it and publishes it as the default version for new "
        "deployments; deployments that exist stay on their version.",
        "",
        "To check the deployer on a GKE cluster of your own first:",
        "",
        "```bash",
        f"mpdev verify --deployer={deployer}",
        "```",
    ]
    return "\n".join(lines)


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    commands = parser.add_subparsers(dest="command", required=True)
    summary = commands.add_parser("summary")
    summary.add_argument("--version", required=True)
    summary.add_argument("--deployer-digest", default="")
    arguments = parser.parse_args(argv)

    try:
        write_summary(
            producer_portal_steps(
                load_editions()["google-cloud"], arguments.version, arguments.deployer_digest
            )
        )
        return 0
    except ReleaseError as error:
        print(f"::error title=Google Cloud Marketplace::{error}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
