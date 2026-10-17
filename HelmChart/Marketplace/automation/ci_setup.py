#!/usr/bin/env python3
"""
The one-time setup the Marketplace Release workflow needs, as shell scripts to read first and
then run: each prints the script it would run, and runs it with --apply. Each is safe to run
again: it creates what is missing and leaves what is there.

    ci_setup.py aws [--apply]
        In the AWS Marketplace seller account (AWS CLI signed in to it): GitHub's OIDC provider,
        and a role only the workflow's two environments can assume, which can push to this
        product's repositories and add versions to it - nothing else.
    ci_setup.py azure-registry [--location eastus] [--apply]
        In the HackerBay tenant (az signed in): the container registry (Basic, about USD 5 a
        month), Microsoft's ingestion app allowed to pull from it, and a weekly task that keeps
        each repository's 3 newest releases (Microsoft serves buyers from its own copy).
    ci_setup.py azure [--apply]
        An Entra app the workflow signs in as through federated credentials (no secret), with
        AcrPush on the registry. It must then be added to Partner Center as a Manager by hand.
    ci_setup.py google [--apply]
        In the oneuptime-marketplace project (gcloud signed in): the Artifact Registry
        repository with a cleanup policy keeping the 3 newest releases, a service account that
        can write to it, and Workload Identity Federation for the workflow's environments.
    ci_setup.py github --reviewer <login> [--reviewer <login>] [--set NAME=VALUE]... [--enable] [--apply]
        The two environments (marketplace-push: master only; marketplace-publish: master only,
        and every job waits for a reviewer), the repository variables the scripts above print,
        and with --enable, MARKETPLACE_RELEASES=enabled so the workflow runs after each release.
"""

import argparse
import json
import re
import shlex
import subprocess
import sys
from typing import Any, Dict, List, Optional

from release_common import ReleaseError, load_editions

REPOSITORY = "OneUptime/oneuptime"
ENVIRONMENTS = ("marketplace-push", "marketplace-publish")
GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com"
MARKETPLACE_ECR_ACCOUNT = "709825985650"
AWS_ROLE_NAME = "oneuptime-marketplace-release"
IDENTITY_NAME = "OneUptime Marketplace Release"
# Microsoft's ingestion app, which copies the bundle out of our registry when publishing.
AZURE_INGESTION_APP_ID = "32597670-3e15-4def-8851-614ff48c1efa"
GOOGLE_PROJECT = "oneuptime-marketplace"
GOOGLE_LOCATION = "us"
GOOGLE_REPOSITORY = "oneuptime"
GOOGLE_POOL = "github"
GOOGLE_SERVICE_ACCOUNT = "marketplace-release"
KEEP_RELEASES = 3

VARIABLES = (
    "MARKETPLACE_RELEASE_AWS_ROLE_ARN",
    "MARKETPLACE_RELEASE_AZURE_CLIENT_ID",
    "MARKETPLACE_RELEASE_AZURE_TENANT_ID",
    "MARKETPLACE_RELEASE_AZURE_SUBSCRIPTION_ID",
    "MARKETPLACE_RELEASE_GOOGLE_WORKLOAD_IDENTITY_PROVIDER",
    "MARKETPLACE_RELEASE_GOOGLE_SERVICE_ACCOUNT",
)
LOGIN = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$")


def subjects(repository: str = REPOSITORY) -> List[str]:
    """The OIDC subjects of the workflow's jobs: one per environment."""
    return [f"repo:{repository}:environment:{environment}" for environment in ENVIRONMENTS]


def json_block(value: Any) -> str:
    return json.dumps(value, indent=2)


def aws_trust_policy() -> Dict[str, Any]:
    return {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Principal": {
                    "Federated": "arn:aws:iam::${ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"
                },
                "Action": "sts:AssumeRoleWithWebIdentity",
                "Condition": {
                    "StringEquals": {
                        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
                        "token.actions.githubusercontent.com:sub": subjects(),
                    }
                },
            }
        ],
    }


def aws_permissions_policy(edition: Dict[str, Any]) -> Dict[str, Any]:
    product_id: str = (edition.get("productId") or "").strip()
    registry: str = edition.get("registry", "")
    prefix: str = registry.split("/", 1)[1] if "/" in registry else ""

    if not product_id:
        raise ReleaseError(
            "editions.json has no aws.productId: create the product first, then find its ID "
            "with `aws_catalog.py find-product`."
        )

    if not registry.startswith(f"{MARKETPLACE_ECR_ACCOUNT}.dkr.ecr.us-east-1.amazonaws.com/") or not prefix:
        raise ReleaseError(
            "editions.json's aws.registry is not the product's AWS Marketplace registry "
            f"({MARKETPLACE_ECR_ACCOUNT}.dkr.ecr.us-east-1.amazonaws.com/<seller prefix>)."
        )

    product: str = f"arn:aws:aws-marketplace:us-east-1:${{ACCOUNT_ID}}:AWSMarketplace/ContainerProduct/{product_id}"
    change_sets: str = "arn:aws:aws-marketplace:us-east-1:${ACCOUNT_ID}:AWSMarketplace/ChangeSet/*"
    return {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "PushToTheProductRepositories",
                "Effect": "Allow",
                "Action": [
                    "ecr:BatchCheckLayerAvailability",
                    "ecr:BatchGetImage",
                    "ecr:CompleteLayerUpload",
                    "ecr:DescribeImages",
                    "ecr:DescribeRepositories",
                    "ecr:GetDownloadUrlForLayer",
                    "ecr:InitiateLayerUpload",
                    "ecr:ListImages",
                    "ecr:PutImage",
                    "ecr:UploadLayerPart",
                ],
                "Resource": f"arn:aws:ecr:us-east-1:{MARKETPLACE_ECR_ACCOUNT}:repository/{prefix}/*",
            },
            {
                "Sid": "SignInToTheRegistry",
                "Effect": "Allow",
                "Action": "ecr:GetAuthorizationToken",
                "Resource": "*",
            },
            {
                "Sid": "AddVersionsOnly",
                "Effect": "Allow",
                "Action": "aws-marketplace:StartChangeSet",
                "Resource": [product, change_sets],
                "Condition": {"StringEquals": {"catalog:ChangeType": ["AddDeliveryOptions"]}},
            },
            {
                "Sid": "FollowTheChanges",
                "Effect": "Allow",
                "Action": ["aws-marketplace:DescribeChangeSet", "aws-marketplace:DescribeEntity"],
                "Resource": [product, change_sets],
            },
        ],
    }


def aws_script(edition: Dict[str, Any]) -> str:
    role: str = shlex.quote(AWS_ROLE_NAME)
    return f"""set -euo pipefail
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
echo "AWS account: ${{ACCOUNT_ID}}"
PROVIDER_ARN="arn:aws:iam::${{ACCOUNT_ID}}:oidc-provider/token.actions.githubusercontent.com"
if ! aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$PROVIDER_ARN" >/dev/null 2>&1; then
  aws iam create-open-id-connect-provider --url {GITHUB_OIDC_ISSUER} --client-id-list sts.amazonaws.com >/dev/null
fi
TRUST="$(mktemp)"
cat >"$TRUST" <<JSON
{json_block(aws_trust_policy())}
JSON
if aws iam get-role --role-name {role} >/dev/null 2>&1; then
  aws iam update-assume-role-policy --role-name {role} --policy-document "file://$TRUST"
else
  aws iam create-role --role-name {role} --max-session-duration 7200 \\
    --description "Pushes OneUptime releases to AWS Marketplace and adds them as versions (GitHub Actions)" \\
    --assume-role-policy-document "file://$TRUST" >/dev/null
fi
POLICY="$(mktemp)"
cat >"$POLICY" <<JSON
{json_block(aws_permissions_policy(edition))}
JSON
aws iam put-role-policy --role-name {role} --policy-name marketplace-release --policy-document "file://$POLICY"
rm -f "$TRUST" "$POLICY"
echo "MARKETPLACE_RELEASE_AWS_ROLE_ARN=$(aws iam get-role --role-name {role} --query Role.Arn --output text)"
"""


def azure_registry_name(edition: Dict[str, Any]) -> str:
    registry: str = edition.get("registry", "")

    if not registry.endswith(".azurecr.io"):
        raise ReleaseError("editions.json's azure.registry is not an Azure Container Registry (<name>.azurecr.io).")

    return registry.split(".", 1)[0]


def azure_purge_command(edition: Dict[str, Any]) -> str:
    """ACR's own purge, run weekly by an ACR task: each repository keeps its newest releases."""
    filters: List[str] = [
        f"--filter '{re.escape(edition['repositoryPrefix'])}/.*:.*'",
        f"--filter '{re.escape(edition['bundleRepository'])}:.*'",
    ]
    return f"acr purge {' '.join(filters)} --ago 7d --keep {KEEP_RELEASES} --untagged"


def azure_registry_script(edition: Dict[str, Any], location: str) -> str:
    name: str = shlex.quote(azure_registry_name(edition))
    group: str = shlex.quote(edition["resourceGroup"])
    return f"""set -euo pipefail
echo "Azure subscription: $(az account show --query name --output tsv)"
az group create --name {group} --location {shlex.quote(location)} >/dev/null
if ! az acr show --name {name} >/dev/null 2>&1; then
  az acr create --name {name} --resource-group {group} --sku Basic >/dev/null
fi
REGISTRY_ID="$(az acr show --name {name} --query id --output tsv)"
az ad sp show --id {AZURE_INGESTION_APP_ID} >/dev/null 2>&1 || az ad sp create --id {AZURE_INGESTION_APP_ID} >/dev/null
if [ -z "$(az role assignment list --assignee {AZURE_INGESTION_APP_ID} --role AcrPull --scope "$REGISTRY_ID" --query '[0].id' --output tsv)" ]; then
  az role assignment create --assignee {AZURE_INGESTION_APP_ID} --role AcrPull --scope "$REGISTRY_ID" >/dev/null
fi
az provider register --namespace Microsoft.PartnerCenterIngestion --wait
if ! az acr task show --registry {name} --name purge-old-releases >/dev/null 2>&1; then
  az acr task create --registry {name} --name purge-old-releases --schedule "0 3 * * 0" --context /dev/null \\
    --cmd {shlex.quote(azure_purge_command(edition))} >/dev/null
fi
echo "Registry ready: {azure_registry_name(edition)}.azurecr.io (Basic), keeping each repository's {KEEP_RELEASES} newest releases."
"""


def azure_script(edition: Dict[str, Any]) -> str:
    name: str = shlex.quote(azure_registry_name(edition))
    app: str = shlex.quote(IDENTITY_NAME)
    credentials: List[str] = []

    for environment, subject in zip(ENVIRONMENTS, subjects()):
        parameters: str = json.dumps(
            {
                "name": f"github-{environment}",
                "issuer": GITHUB_OIDC_ISSUER,
                "subject": subject,
                "audiences": ["api://AzureADTokenExchange"],
            }
        )
        credentials.append(
            f"""if [ -z "$(az ad app federated-credential list --id "$APP_ID" --query "[?name=='github-{environment}'].name" --output tsv)" ]; then
  az ad app federated-credential create --id "$APP_ID" --parameters {shlex.quote(parameters)} >/dev/null
fi"""
        )

    federated: str = "\n".join(credentials)
    return f"""set -euo pipefail
TENANT_ID="$(az account show --query tenantId --output tsv)"
SUBSCRIPTION_ID="$(az account show --query id --output tsv)"
APP_ID="$(az ad app list --display-name {app} --query '[0].appId' --output tsv)"
if [ -z "$APP_ID" ]; then
  APP_ID="$(az ad app create --display-name {app} --query appId --output tsv)"
fi
az ad sp show --id "$APP_ID" >/dev/null 2>&1 || az ad sp create --id "$APP_ID" >/dev/null
{federated}
REGISTRY_ID="$(az acr show --name {name} --query id --output tsv)"
if [ -z "$(az role assignment list --assignee "$APP_ID" --role AcrPush --scope "$REGISTRY_ID" --query '[0].id' --output tsv)" ]; then
  az role assignment create --assignee "$APP_ID" --role AcrPush --scope "$REGISTRY_ID" >/dev/null
fi
echo "MARKETPLACE_RELEASE_AZURE_CLIENT_ID=${{APP_ID}}"
echo "MARKETPLACE_RELEASE_AZURE_TENANT_ID=${{TENANT_ID}}"
echo "MARKETPLACE_RELEASE_AZURE_SUBSCRIPTION_ID=${{SUBSCRIPTION_ID}}"
echo "By hand, once: in Partner Center, Account settings > User management > Microsoft Entra applications, add the app ${{APP_ID}} with the Manager role."
"""


def google_cleanup_policy() -> List[Dict[str, Any]]:
    """Keep each image's newest releases; delete the rest once they are a month old."""
    return [
        {
            "name": "keep-the-newest-releases",
            "action": {"type": "Keep"},
            "mostRecentVersions": {"keepCount": KEEP_RELEASES},
        },
        {
            "name": "delete-older-releases",
            "action": {"type": "Delete"},
            "condition": {"olderThan": "30d"},
        },
    ]


def google_script(repository: str = REPOSITORY) -> str:
    project: str = shlex.quote(GOOGLE_PROJECT)
    service_account: str = f"{GOOGLE_SERVICE_ACCOUNT}@{GOOGLE_PROJECT}.iam.gserviceaccount.com"
    condition: str = (
        f'assertion.repository == "{repository}" && assertion.environment.startsWith("marketplace-")'
    )
    return f"""set -euo pipefail
PROJECT_NUMBER="$(gcloud projects describe {project} --format='value(projectNumber)')"
gcloud services enable artifactregistry.googleapis.com iamcredentials.googleapis.com sts.googleapis.com --project {project}
if ! gcloud artifacts repositories describe {GOOGLE_REPOSITORY} --location={GOOGLE_LOCATION} --project {project} >/dev/null 2>&1; then
  gcloud artifacts repositories create {GOOGLE_REPOSITORY} --repository-format=docker --location={GOOGLE_LOCATION} --project {project} \\
    --description "OneUptime Enterprise for Google Cloud Marketplace"
fi
CLEANUP="$(mktemp)"
cat >"$CLEANUP" <<'JSON'
{json_block(google_cleanup_policy())}
JSON
gcloud artifacts repositories set-cleanup-policies {GOOGLE_REPOSITORY} --location={GOOGLE_LOCATION} --project {project} --policy="$CLEANUP" --no-dry-run >/dev/null
rm -f "$CLEANUP"
if ! gcloud iam service-accounts describe {service_account} --project {project} >/dev/null 2>&1; then
  gcloud iam service-accounts create {GOOGLE_SERVICE_ACCOUNT} --project {project} --display-name {shlex.quote(IDENTITY_NAME)}
fi
gcloud artifacts repositories add-iam-policy-binding {GOOGLE_REPOSITORY} --location={GOOGLE_LOCATION} --project {project} \\
  --member serviceAccount:{service_account} --role roles/artifactregistry.writer >/dev/null
if ! gcloud iam workload-identity-pools describe {GOOGLE_POOL} --location=global --project {project} >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create {GOOGLE_POOL} --location=global --project {project} --display-name "GitHub Actions"
fi
if ! gcloud iam workload-identity-pools providers describe {GOOGLE_POOL} --workload-identity-pool={GOOGLE_POOL} --location=global --project {project} >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers create-oidc {GOOGLE_POOL} --workload-identity-pool={GOOGLE_POOL} --location=global --project {project} \\
    --issuer-uri={GITHUB_OIDC_ISSUER} \\
    --attribute-mapping=google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.environment=assertion.environment \\
    --attribute-condition={shlex.quote(condition)}
fi
gcloud iam service-accounts add-iam-policy-binding {service_account} --project {project} --role roles/iam.workloadIdentityUser \\
  --member "principalSet://iam.googleapis.com/projects/${{PROJECT_NUMBER}}/locations/global/workloadIdentityPools/{GOOGLE_POOL}/attribute.repository/{repository}" >/dev/null
echo "MARKETPLACE_RELEASE_GOOGLE_WORKLOAD_IDENTITY_PROVIDER=projects/${{PROJECT_NUMBER}}/locations/global/workloadIdentityPools/{GOOGLE_POOL}/providers/{GOOGLE_POOL}"
echo "MARKETPLACE_RELEASE_GOOGLE_SERVICE_ACCOUNT={service_account}"
"""


def parse_settings(settings: List[str]) -> Dict[str, str]:
    values: Dict[str, str] = {}

    for setting in settings:
        name, separator, value = setting.partition("=")

        if not separator or name not in VARIABLES:
            raise ReleaseError(f"--set takes NAME=VALUE, NAME one of: {', '.join(VARIABLES)}.")

        if not value.strip() or "\n" in value:
            raise ReleaseError(f"{name} needs a one-line value.")

        values[name] = value.strip()

    return values


def github_script(
    reviewers: List[str], settings: Dict[str, str], enable: bool, repository: str = REPOSITORY
) -> str:
    if not reviewers:
        raise ReleaseError("Name at least one --reviewer: every publish waits for one.")

    for login in reviewers:
        if not LOGIN.match(login):
            raise ReleaseError(f"\"{login}\" is not a GitHub login.")

    repo: str = shlex.quote(repository)
    lookups: str = "\n".join(
        f'REVIEWERS="${{REVIEWERS:+$REVIEWERS,}}{{\\"type\\":\\"User\\",\\"id\\":$(gh api users/{login} --jq .id)}}"'
        for login in reviewers
    )
    variables: str = "\n".join(
        f"gh variable set {name} --repo {repo} --body {shlex.quote(value)}"
        for name, value in settings.items()
    )
    enabling: str = (
        f"gh variable set MARKETPLACE_RELEASES --repo {repo} --body enabled" if enable else ""
    )
    branch_policies: str = "\n".join(
        f"""gh api --method POST "repos/${{REPO}}/environments/{environment}/deployment-branch-policies" -f name=master -f type=branch >/dev/null 2>&1 || true"""
        for environment in ENVIRONMENTS
    )
    return f"""set -euo pipefail
REPO={repo}
gh api --method PUT "repos/${{REPO}}/environments/marketplace-push" --input - >/dev/null <<'JSON'
{{"deployment_branch_policy": {{"protected_branches": false, "custom_branch_policies": true}}}}
JSON
REVIEWERS=""
{lookups}
gh api --method PUT "repos/${{REPO}}/environments/marketplace-publish" --input - >/dev/null <<JSON
{{"reviewers": [${{REVIEWERS}}], "deployment_branch_policy": {{"protected_branches": false, "custom_branch_policies": true}}}}
JSON
{branch_policies}
{variables}
{enabling}
echo "Environments ready: marketplace-push, and marketplace-publish with reviewers {', '.join(reviewers)}."
"""


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    commands = parser.add_subparsers(dest="command", required=True)

    for name in ("aws", "azure", "google"):
        commands.add_parser(name).add_argument("--apply", action="store_true")

    registry = commands.add_parser("azure-registry")
    registry.add_argument("--location", default="eastus")
    registry.add_argument("--apply", action="store_true")

    github = commands.add_parser("github")
    github.add_argument("--reviewer", action="append", default=[])
    github.add_argument("--set", action="append", default=[], dest="settings")
    github.add_argument("--enable", action="store_true")
    github.add_argument("--apply", action="store_true")

    arguments = parser.parse_args(argv)

    try:
        editions: Dict[str, Any] = load_editions()

        if arguments.command == "aws":
            script: str = aws_script(editions["aws"])
        elif arguments.command == "azure-registry":
            script = azure_registry_script(editions["azure"], arguments.location)
        elif arguments.command == "azure":
            script = azure_script(editions["azure"])
        elif arguments.command == "google":
            script = google_script()
        else:
            script = github_script(
                arguments.reviewer, parse_settings(arguments.settings), arguments.enable
            )
    except ReleaseError as error:
        print(error, file=sys.stderr)
        return 1

    if not arguments.apply:
        print(script)
        print("# Read it, then run it with --apply.", file=sys.stderr)
        return 0

    return subprocess.run(["bash", "-c", script], check=False).returncode


if __name__ == "__main__":
    sys.exit(main())
