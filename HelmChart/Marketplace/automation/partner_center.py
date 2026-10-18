#!/usr/bin/env python3
"""
The Microsoft Marketplace offer, through Partner Center's Product Ingestion API
(https://graph.microsoft.com/rp/product-ingestion):

    partner_center.py plan --tag X.Y.Z --digest sha256:... --out configure.json
        the configure request that points the plan's technical configuration at the bundle
        (offline: product and plan named by their offer and plan IDs)
    partner_center.py shipped --tag X.Y.Z
        whether the offer's preview already has that bundle; writes shipped=true|false for the
        next steps, so a release is never published twice
    partner_center.py update-bundle --tag X.Y.Z --digest sha256:... [--wait-minutes 20]
        sets it on the draft, and waits for Partner Center to take it
    partner_center.py publish --target preview [--wait-minutes 60]
        publishes the draft to preview (Microsoft validates the bundle and scans its images)
    partner_center.py publish --target live [--wait-minutes 60]
        publishes the newest succeeded preview to live; minor and patch versions then reach
        every buyer's cluster by themselves

The offer, the plan and the cluster extension type come from editions.json (azure); the
registry's tenant, subscription and resource group from AZURE_TENANT_ID and
AZURE_SUBSCRIPTION_ID and editions.json. The access token is PARTNER_CENTER_TOKEN, for the
Entra app the workflow signs in as (scope https://graph.microsoft.com/.default); the app must
be a Manager in Partner Center. The token is never printed.
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from release_common import (
    ReleaseError,
    check_version,
    load_editions,
    wait_for,
    write_outputs,
    write_summary,
)

API = "https://graph.microsoft.com/rp/product-ingestion"
# The configure, status and submission requests.
API_VERSION = "2022-03-01-preview2"
# Product and plan queries, and the newest schema a resource tree may answer with.
QUERY_VERSION = "2022-03-01-preview3"
TREE_VERSION = "2022-03-01-preview5"
SCHEMA = "https://schema.mp.microsoft.com/schema"
CONFIGURE_SCHEMA = f"{SCHEMA}/configure/{API_VERSION}"
SUBMISSION_SCHEMA = f"{SCHEMA}/submission/{API_VERSION}"
TECHNICAL_CONFIGURATION_SCHEMA = f"{SCHEMA}/container-plan-technical-configuration/2022-03-01-preview3"
TECHNICAL_CONFIGURATION_TYPE = "container-plan-technical-configuration"
# What Partner Center says about a target (preview, live) the offer was never published to.
NEVER_PUBLISHED = "has no published submission"

Opener = Callable[[urllib.request.Request], Any]


class PartnerCenter:
    def __init__(self, token: str, opener: Opener = urllib.request.urlopen) -> None:
        if not token:
            raise ReleaseError("PARTNER_CENTER_TOKEN is not set.")
        self.token: str = token
        self.opener: Opener = opener

    def request(
        self,
        method: str,
        path: str,
        query: Optional[Dict[str, str]] = None,
        body: Optional[Dict[str, Any]] = None,
        missing_ok: bool = False,
    ) -> Optional[Dict[str, Any]]:
        url: str = f"{API}/{path}"

        if query:
            url += "?" + urllib.parse.urlencode(query, safe="$\"")

        request = urllib.request.Request(
            url,
            method=method,
            data=json.dumps(body).encode("utf-8") if body is not None else None,
            headers={
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )

        try:
            with self.opener(request) as response:
                text: str = response.read().decode("utf-8")
        except urllib.error.HTTPError as error:
            said: str = error.read().decode("utf-8", "replace")[-2000:]
            error.close()

            # A target the offer was never published to: 404, or 400 "...has no published
            # submission in Preview" (what Partner Center answers for a new offer).
            if missing_ok and (error.code == 404 or (error.code == 400 and NEVER_PUBLISHED in said)):
                return None

            raise ReleaseError(f"Partner Center answered {error.code} to {method} {path}: {said}")
        except urllib.error.URLError as error:
            raise ReleaseError(f"Partner Center could not be reached: {error.reason}")

        return json.loads(text) if text.strip() else {}

    def product_id(self, offer_id: str) -> str:
        found: Dict[str, Any] = self.request(
            "GET", "product", {"externalID": offer_id, "$version": QUERY_VERSION}
        )
        values: List[Dict[str, Any]] = found.get("value", [])

        if not values:
            raise ReleaseError(f"Partner Center has no offer with the ID {offer_id}.")

        return values[0]["id"]

    def resource_tree(self, product_id: str, target: str = "") -> List[Dict[str, Any]]:
        """The offer's resources: the draft, or the preview or live environment's."""
        query: Dict[str, str] = {"$version": TREE_VERSION}

        if target:
            query = {"targetType": target, "$version": TREE_VERSION}

        tree: Optional[Dict[str, Any]] = self.request(
            "GET", f"resource-tree/{product_id}", query, missing_ok=bool(target)
        )
        return (tree or {}).get("resources", [])

    def configure(self, resources: List[Dict[str, Any]]) -> Dict[str, Any]:
        return self.request(
            "POST",
            "configure",
            {"$version": API_VERSION},
            {"$schema": CONFIGURE_SCHEMA, "resources": resources},
        )

    def job_status(self, job_id: str) -> Dict[str, Any]:
        return self.request("GET", f"configure/{job_id}/status", {"$version": API_VERSION})

    def submissions(self, product_id: str, target: str) -> List[Dict[str, Any]]:
        guid: str = product_id.split("/", 1)[-1]
        found: Dict[str, Any] = self.request(
            "GET", f"submission/{guid}", {"targetType": target, "$version": API_VERSION}
        )
        return found.get("value", [])


def is_type(resource: Dict[str, Any], kind: str) -> bool:
    return f"/schema/{kind}/" in resource.get("$schema", "")


def external_id(resource: Dict[str, Any]) -> str:
    """A resource's own ID: externalId, as the schemas and the API spell it (the docs' examples
    say externalID)."""
    identity: Dict[str, Any] = resource.get("identity") or {}
    return str(identity.get("externalId") or identity.get("externalID") or "")


def find_plan(resources: List[Dict[str, Any]], plan_external_id: str) -> str:
    for resource in resources:
        if is_type(resource, "plan") and external_id(resource) == plan_external_id:
            return resource["id"]

    raise ReleaseError(f"The offer has no plan with the ID {plan_external_id}.")


def find_technical_configuration(
    resources: List[Dict[str, Any]], plan_id: str
) -> Optional[Dict[str, Any]]:
    for resource in resources:
        if is_type(resource, TECHNICAL_CONFIGURATION_TYPE) and resource.get("plan") == plan_id:
            return resource

    return None


def configured_tags(resources: List[Dict[str, Any]], plan_external_id: str) -> List[str]:
    """The bundle tags the plan's technical configuration names; empty with no such plan yet."""
    try:
        plan_id: str = find_plan(resources, plan_external_id)
    except ReleaseError:
        return []

    configuration: Optional[Dict[str, Any]] = find_technical_configuration(resources, plan_id)
    references: List[Dict[str, Any]] = (configuration or {}).get("cnabReferences", []) or []
    return [str(reference.get("tag", "")) for reference in references]


def cnab_reference(
    edition: Dict[str, Any], *, tenant_id: str, subscription_id: str, tag: str, digest: str
) -> Dict[str, str]:
    check_version(tag)

    if not digest.startswith("sha256:"):
        raise ReleaseError(f"\"{digest}\" is not a bundle digest (sha256:...).")

    for name, value in (("AZURE_TENANT_ID", tenant_id), ("AZURE_SUBSCRIPTION_ID", subscription_id)):
        if not (value or "").strip():
            raise ReleaseError(f"{name} is not set.")

    return {
        "tenantID": tenant_id,
        "subscriptionID": subscription_id,
        "resourceGroupName": edition["resourceGroup"],
        "registryName": edition["registry"].split(".", 1)[0],
        "repositoryName": edition["bundleRepository"],
        "tag": tag,
        "digest": digest,
    }


def technical_configuration(
    existing: Optional[Dict[str, Any]],
    *,
    product_id: str,
    plan_id: str,
    cluster_extension_type: str,
    reference: Dict[str, str],
) -> Dict[str, Any]:
    """
    The plan's technical configuration with the new bundle: the one Partner Center has, so
    every other field stays as it is, or a new one. The cluster extension type is permanent
    once the plan reaches preview: a different one there is refused, never overwritten.
    """
    resource: Dict[str, Any] = dict(existing) if existing else {
        "$schema": TECHNICAL_CONFIGURATION_SCHEMA,
        "product": product_id,
        "plan": plan_id,
    }
    current: str = resource.get("clusterExtensionType", "").strip()

    if current and current != cluster_extension_type:
        raise ReleaseError(
            f"The plan's cluster extension type is {current}, not {cluster_extension_type} as "
            "editions.json says. It cannot change: correct editions.json."
        )

    resource["payloadType"] = "cnab"
    resource["clusterExtensionType"] = cluster_extension_type
    resource["cnabReferences"] = [reference]
    return resource


def submission(product_id: str, target: str, submission_id: str = "") -> Dict[str, Any]:
    resource: Dict[str, Any] = {
        "$schema": SUBMISSION_SCHEMA,
        "product": product_id,
        "target": {"targetType": target},
    }

    if submission_id:
        resource["id"] = submission_id

    return resource


def job_state(status: Dict[str, Any]) -> Tuple[str, List[str]]:
    """running, succeeded, failed or cancelled, with Partner Center's errors."""
    if status.get("jobStatus") != "completed":
        return "running", []

    result: str = status.get("jobResult", "")
    errors: List[str] = []

    for error in status.get("errors", []) or []:
        details: str = "; ".join(
            str(detail.get("message", detail)) for detail in error.get("details", []) or []
        )
        errors.append(
            f"{error.get('code', 'error')}: {error.get('message', '')}" + (f" ({details})" if details else "")
        )

    if result == "succeeded":
        return "succeeded", errors

    return ("cancelled" if result == "cancelled" else "failed"), errors


def newest_succeeded(submissions: List[Dict[str, Any]], target: str) -> Optional[Dict[str, Any]]:
    done: List[Dict[str, Any]] = [
        entry
        for entry in submissions
        if (entry.get("target") or {}).get("targetType") == target
        and entry.get("status") == "completed"
        and entry.get("result") == "succeeded"
    ]
    done.sort(key=lambda entry: entry.get("created", ""))
    return done[-1] if done else None


def follow(
    center: PartnerCenter, job: Dict[str, Any], wait_minutes: float, sleep: Callable[[float], None] = None
) -> Tuple[str, List[str], str]:
    job_id: str = str(job.get("jobId") or job.get("jobID") or "")

    if not job_id:
        raise ReleaseError(f"Partner Center did not start a job: {json.dumps(job)[:500]}")

    def check() -> Tuple[bool, Tuple[str, List[str]]]:
        state: Tuple[str, List[str]] = job_state(center.job_status(job_id))
        return state[0] != "running", state

    kwargs: Dict[str, Any] = {"timeout_seconds": wait_minutes * 60, "interval_seconds": 30}

    if sleep is not None:
        kwargs["sleep"] = sleep

    _, (status, errors) = wait_for(check, **kwargs)
    return status, errors, job_id


def report(status: str, errors: List[str], job_id: str, what: str) -> int:
    if status == "succeeded":
        write_summary(f"Partner Center took {what} (job `{job_id}`).")
        return 0

    if status == "running":
        write_summary(
            f"Partner Center is still working on {what} (job `{job_id}`): publishing validates the "
            "bundle and scans its images, which can take hours. Its progress is on the offer's "
            "page in Partner Center."
        )
        return 0

    write_summary(
        f"Partner Center {status} {what} (job `{job_id}`):\n\n"
        + "\n".join(f"- {error}" for error in errors or ["no reason given"])
    )
    return 1


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    commands = parser.add_subparsers(dest="command", required=True)

    plan = commands.add_parser("plan")
    plan.add_argument("--tag", required=True)
    plan.add_argument("--digest", required=True)
    plan.add_argument("--out", required=True, type=Path)

    shipped = commands.add_parser("shipped")
    shipped.add_argument("--tag", required=True)

    update = commands.add_parser("update-bundle")
    update.add_argument("--tag", required=True)
    update.add_argument("--digest", required=True)
    update.add_argument("--wait-minutes", type=float, default=20)

    publish = commands.add_parser("publish")
    publish.add_argument("--target", required=True, choices=("preview", "live"))
    publish.add_argument("--wait-minutes", type=float, default=60)

    arguments = parser.parse_args(argv)

    try:
        edition: Dict[str, Any] = load_editions()["azure"]
        tenant_id: str = os.environ.get("AZURE_TENANT_ID", "")
        subscription_id: str = os.environ.get("AZURE_SUBSCRIPTION_ID", "")

        if arguments.command == "plan":
            reference: Dict[str, str] = cnab_reference(
                edition,
                tenant_id=tenant_id or "<tenant ID>",
                subscription_id=subscription_id or "<subscription ID>",
                tag=arguments.tag,
                digest=arguments.digest,
            )
            resource: Dict[str, Any] = technical_configuration(
                None,
                product_id=f"product/<the durable ID of {edition['offerId']}>",
                plan_id=f"plan/<the durable ID of {edition['planId']}>",
                cluster_extension_type=edition["clusterExtensionType"],
                reference=reference,
            )
            arguments.out.write_text(
                json.dumps({"$schema": CONFIGURE_SCHEMA, "resources": [resource]}, indent=2) + "\n",
                encoding="utf-8",
            )
            print(f"Wrote the configure request for bundle {arguments.tag} to {arguments.out}")
            return 0

        center = PartnerCenter(os.environ.get("PARTNER_CENTER_TOKEN", ""))
        product_id: str = center.product_id(edition["offerId"])

        if arguments.command == "shipped":
            tag: str = check_version(arguments.tag)
            has_it: bool = tag in configured_tags(
                center.resource_tree(product_id, "preview"), edition["planId"]
            )
            write_outputs({"shipped": "true" if has_it else "false"})

            if has_it:
                write_summary(f"Microsoft Marketplace's preview has bundle {tag} already: nothing to push or publish.")
            return 0

        if arguments.command == "update-bundle":
            resources: List[Dict[str, Any]] = center.resource_tree(product_id)
            plan_id: str = find_plan(resources, edition["planId"])
            resource = technical_configuration(
                find_technical_configuration(resources, plan_id),
                product_id=product_id,
                plan_id=plan_id,
                cluster_extension_type=edition["clusterExtensionType"],
                reference=cnab_reference(
                    edition,
                    tenant_id=tenant_id,
                    subscription_id=subscription_id,
                    tag=arguments.tag,
                    digest=arguments.digest,
                ),
            )
            status, errors, job_id = follow(center, center.configure([resource]), arguments.wait_minutes)
            what: str = f"bundle {arguments.tag} for the {edition['planId']} plan"
            return report(status, errors, job_id, what) if status != "running" else (
                report("failed", ["the draft update did not finish in time"], job_id, what)
            )

        if arguments.target == "preview":
            job: Dict[str, Any] = center.configure([submission(product_id, "preview")])
            status, errors, job_id = follow(center, job, arguments.wait_minutes)
            return report(status, errors, job_id, "the draft, published to preview")

        preview: Optional[Dict[str, Any]] = newest_succeeded(
            center.submissions(product_id, "preview"), "preview"
        )

        if preview is None:
            raise ReleaseError(
                "There is no succeeded preview to publish to live yet. Wait for the preview to "
                "pass Microsoft's checks, test it, then run this again."
            )

        job = center.configure([submission(product_id, "live", preview["id"])])
        status, errors, job_id = follow(center, job, arguments.wait_minutes)
        return report(status, errors, job_id, f"preview {preview['id']}, published to live")
    except ReleaseError as error:
        print(f"::error title=Microsoft Marketplace::{str(error).replace(chr(10), ' ')}")
        print(error, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
