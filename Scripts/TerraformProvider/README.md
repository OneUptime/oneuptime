# OneUptime Terraform Provider Generator

## Overview

This project provides a **dynamic Terraform provider generator** that automatically creates a complete, production-ready Terraform provider from OneUptime's OpenAPI specification. The generator is written in TypeScript and produces Go code that follows Terraform provider best practices.

## 🚀 Features

### ✅ Dynamic Generation
- **Automatic resource discovery** from OpenAPI tags and endpoints
- **Schema generation** from API request/response models
- **CRUD operations** mapped from HTTP methods (POST→Create, GET→Read, PUT/PATCH→Update, DELETE→Delete)
- **Data sources** generated from GET endpoints
- **Type-safe** Go code generation

### ✅ Complete Provider Structure
- **Main provider file** with authentication configuration
- **HTTP client** with support for API key, username/password authentication
- **Resource files** for all discovered API endpoints
- **Data source files** for read-only operations
- **Documentation** auto-generated for Terraform Registry
- **Examples** and usage guides

### ✅ Build System
- **Go module** with proper dependencies
- **Makefile** for common operations
- **Build scripts** for multiple platforms
- **Installation scripts** for local development
- **Publishing scripts** for Terraform Registry

## 📁 Generated Structure

```
Terraform/terraform-provider-oneuptime/
├── main.go                          # Provider entry point
├── go.mod                           # Go module definition
├── Makefile                         # Build automation
├── README.md                        # Documentation
├── LICENSE                          # Apache License 2.0
├── build.sh                         # Build script
├── install.sh                       # Local installation
├── test.sh                          # Test runner
├── example.tf                       # Usage example
├── internal/provider/
│   ├── provider.go                  # Main provider implementation
│   ├── client.go                    # HTTP client
│   ├── config.go                    # Configuration management
│   ├── shards.go                    # Lists what every shard holds, in order
│   ├── resources.go                 # The resources written by hand, in their places
│   ├── data_sources.go              # The data sources written by hand, in theirs
│   ├── *.go                         # The helpers written by hand (StaticFiles/)
│   ├── shard00/ … shard31/          # The generated resources and data sources
│   │   ├── resources.go             # What the shard hands to the provider
│   │   ├── data_sources.go
│   │   ├── resource_*.go            # Individual resources
│   │   └── data_source_*.go         # Individual data sources
│   └── all/all.go                   # Imports every shard
├── docs/
│   ├── index.md                     # Provider documentation
│   ├── resources/                   # Resource documentation
│   └── data-sources/                # Data source documentation
└── examples/
    ├── provider.tf                  # Provider configuration
    ├── resources.tf                 # Resource examples
    └── data-sources.tf              # Data source examples
```

## 🔧 Usage

### Generate the Provider

```bash
# Generate the complete Terraform provider
npm run generate-terraform-provider
```

Generation compiles the provider twice: `go build`, then the test binary
the docs step runs. The generated resources and data sources are split into
32 packages, `internal/provider/shard00` to `shard31`, by the hash of each
file's name (`Core/ProviderShards.ts`): as one package of ~1,000 files, a
compile of them took the compiler ~11 GiB, and ~15 GB without a memory limit.
Split, Go compiles four shards at a time, each under 1 GiB. Each shard hands
what it holds to `internal/provider` from its `init`, and
`internal/provider/all` imports them all; the provider lists its resources
and data sources in the same order as before. Generation stops when a shard
grows past 6 MiB of Go: raise `SHARD_COUNT` then.

Go still runs with a soft memory limit, `GOMEMLIMIT`, set in
`Core/GoCommand.ts`, as a guard rail, unless you set your own
(`GOMEMLIMIT=off` turns it off). After each Go command, generation prints the
most memory it took with the generator (`📈 go build ...`), read from `/proc`
on Linux; in CI, more than 13 GiB is a warning.

Generation runs the generator without type-checking it (ts-node's
transpile-only mode), which keeps about 1 GiB of Node.js out of memory while
Go compiles. Type-check it with `npm run compile` (below).

### Build and Install Locally

```bash
# Navigate to the generated provider
cd Terraform/terraform-provider-oneuptime

# Install dependencies and build
go mod tidy
go build

# Install locally for testing
./install.sh
```

### Use in Terraform

```hcl
terraform {
  required_providers {
    oneuptime = {
      source = "oneuptime/oneuptime"
      version = "1.0.0"
    }
  }
}

provider "oneuptime" {
  oneuptime_url    = "https://oneuptime.com"
  api_key = var.oneuptime_api_key
}

# Create a project
resource "oneuptime_project" "example" {
  name        = "my-project"
  description = "Created with Terraform"
}

# Get project data
data "oneuptime_project_data" "example" {
  name = "my-project"
}
```

## 🏗️ Architecture

### Core Components

1. **OpenAPIParser** - Parses OpenAPI spec and extracts resource definitions
2. **ResourceGenerator** - Generates Terraform resource files with CRUD operations
3. **DataSourceGenerator** - Generates data source files for read operations
4. **ProviderGenerator** - Creates main provider file with authentication
5. **GoModuleGenerator** - Sets up Go module and dependencies
6. **DocumentationGenerator** - Creates docs and examples
7. **FileGenerator** - Handles file I/O operations
8. **StringUtils** - Utility functions for naming conversions

### Generation Flow

```
OpenAPI Spec → Parser → Resource Discovery → Code Generation → Build System
     ↓              ↓            ↓              ↓             ↓
JSON Schema → Operations → Resources/DataSources → Go Files → Terraform Provider
```

## 📋 Generated Resources

The generator automatically creates Terraform resources for all OneUptime API endpoints, including:

- **Projects** - Project management
- **Monitors** - Service monitoring
- **Alerts** - Alert management
- **Incidents** - Incident tracking
- **Status Pages** - Public status pages
- **Teams** - Team organization
- **Users** - User management
- **API Keys** - Authentication
- **Workflows** - Automation
- **And 100+ more resources**

## 🔐 Authentication

The provider supports multiple authentication methods:

```hcl
provider "oneuptime" {
  # Method 1: API Key
  host    = "https://oneuptime.com"
  api_key = var.api_key

  # Method 2: Username/Password
  host     = "https://oneuptime.com"
  username = var.username
  password = var.password
}
```

Environment variables are also supported:
- `ONEUPTIME_HOST`
- `ONEUPTIME_API_KEY`
- `ONEUPTIME_USERNAME`
- `ONEUPTIME_PASSWORD`

## 🧪 Testing

```bash
# Run unit tests
go test ./...

# Run acceptance tests
TF_ACC=1 go test ./... -v -timeout 120m

# Test with example configuration
terraform init
terraform plan
terraform apply
```

## 📦 Publishing

The release run publishes the provider (`publish-terraform-provider` in
`.github/workflows/release.yml`), with `publish-terraform-provider.sh`. It
generates the provider, syncs it into
[OneUptime/terraform-provider-oneuptime](https://github.com/OneUptime/terraform-provider-oneuptime),
vets and tests it, builds and signs every asset with GoReleaser, and only then
pushes the commit and its tag. Then it publishes the GitHub release, which the
Terraform and OpenTofu registries read.

**A published release is never changed.** The registries read a version's
assets once, when it is published, and keep each zip's SHA-256; `terraform
init` and `tofu init` check what GitHub serves against it. GoReleaser did not
make the same zip twice, so assets built again and uploaded over a published
release broke that version for everyone: that happened to 14.3.0, 16.0.0,
17.0.0, 17.1.0, 17.2.0 and older versions, when a release run was repeated
([#20](https://github.com/OneUptime/terraform-provider-oneuptime/issues/20)).
So the script:

- asks first whether its version is published. Published with every asset its
  `SHA256SUMS` lists, the run stops there, successfully, having generated and
  built nothing. Published without them, or with an asset that is not what its
  `SHA256SUMS` says, it fails and changes nothing (`--force` too);
- makes the release a draft, which no registry sees, uploads every asset to it
  once, checks the draft against what it built (names, sizes, SHA-256s), and
  only then publishes it. A run that stops halfway leaves a tag, which the next
  run builds from, or a draft, which the next run deletes, by its id, and makes
  again;
- calls GitHub by release id, never by tag: `gh release view` finds a draft of
  the tag too, and answers with whichever it finds first.

17.2.0 broke the same way two days after that fix merged
([#11016](https://github.com/OneUptime/oneuptime/issues/11016)): its release
branch was cut before it, so both of its release runs ran the old script. Since
then:

- every asset goes to the run's own draft by the draft's upload URL, one at a
  time, never by tag and never with `--clobber`. Before each one the script
  reads the draft again, by its id, and `ProviderRelease.js upload-plan` says
  what to do: keep an asset that is there already, upload one that is not, or
  replace an upload that did not finish (deleted by its asset id). It refuses a
  release that is not a draft, so a release published while a run uploads gets
  nothing more from it;
- the signature is checked against the `SHA256SUMS` it was built with, by the
  key GoReleaser signed with, before anything is pushed;
- a provider built again from the same commit is the same bytes: the
  generator's `.goreleaser.yml` stamps every file in a zip with the commit's
  time (`mod_timestamp`, and `mtime` for `LICENSE` and `README.md`), where
  GoReleaser used to stamp the build's, so a rebuild made other zips with the
  same files in them (`Tests/GoReleaserConfig.test.ts` builds one twice);
- after each publish, **Terraform Provider Registry Checksums**
  (`.github/workflows/terraform-provider-registry-checksums.yml`) compares what
  registry.terraform.io and registry.opentofu.org read with what the release
  serves, for every platform, as `terraform init` does: release.yml's
  `check-terraform-provider-registries` and the republish workflow call it, and
  it runs every day for every version since 17.3.0. By hand:

```bash
node Scripts/TerraformProvider/RegistryChecksums.js --version 17.2.0
node Scripts/TerraformProvider/RegistryChecksums.js --since 17.0.0 --platform linux_amd64
```

It reads public pages only (set `GITHUB_TOKEN` for more than 60 versions an
hour). A version whose assets agree with each other and not with what a
registry read had them built again after it was published: no registry reads a
version twice, so it is mended only by a new one.

The one guarantee GitHub itself gives is **immutable releases**: with it on,
GitHub refuses to add, replace or delete a published release's assets, or move
its tag, whatever runs. It is off for the provider repository. A maintainer
turns it on in the repository's Settings, under Releases, "Enable release
immutability"; it holds for releases published after that, and the draft,
upload, publish order above is the one it expects.

`ProviderRelease.js` holds those checks, and `GenerateReleaseNotes.js` writes
each release's notes: what breaks a configuration, new resources and data
sources with their registry pages, the attributes that changed, and
OneUptime's pull requests that changed the provider. It reads what changed
from both releases' pages in `docs/`, and the pull requests between the
OneUptime commits the two releases were generated from, which each release's
commit names in its `OneUptime-Commit` trailer. The notes go to the job's
summary too.

To mend a published version, publish its provider again as the next patch
version, from the same commit: run **Republish a Terraform provider version**
(`.github/workflows/terraform-provider-republish.yml`), which runs the script
with `--republish-from`:

```bash
gh workflow run terraform-provider-republish.yml -f from=17.1.0 -f version=17.1.1
```

The versions broken this way whose next patch is free, so that a range that
takes the broken one takes its mend: 14.3.0 (as 14.3.1), 16.0.0 (16.0.1),
17.0.0 (17.0.1), 17.1.0 (17.1.1) and 17.2.0 (17.2.1). The older ones
(11.3.16, 12.0.14, 12.0.20, 12.0.23, 12.0.25, 12.0.27, 12.0.30, 13.0.7,
14.0.29, 14.0.72, 14.0.76, 14.0.88, 14.0.94, 14.0.102 and 14.0.106, and
11.3.23, 11.3.28, 11.5.11 and 11.7.4 on registry.opentofu.org only) each have
a next patch already, which installs. Run one republish at a time (they share
a concurrency group), and check each with `RegistryChecksums.js` once the
registries list it. No registry re-reads a version: registry.terraform.io's
FAQ says there is no manual way to remove one, and to write to
terraform-registry@hashicorp.com if it is critical that a version be deleted.

Never re-run a release run from before 17.3.0: a re-run runs its own commit's
scripts, and every release branch before 17.3.0's has the old one, which
uploads a rebuild over the published release again. Release runs can be
re-run for 30 days.

To write a published release's notes again:

```bash
git clone https://github.com/OneUptime/terraform-provider-oneuptime provider
git -C provider fetch --tags
GH_TOKEN=$(gh auth token) node Scripts/TerraformProvider/GenerateReleaseNotes.js \
  --version 17.1.0 --provider-dir provider --previous v17.0.0 \
  --oneuptime-to 17.1.0 --output notes.md
gh release edit v17.1.0 --repo OneUptime/terraform-provider-oneuptime --notes-file notes.md
```

`Tests/Ops/TerraformProviderPublishedRelease.test.js` runs the script end to
end against a stand-in GitHub, git remote and GoReleaser;
`Tests/Ops/TerraformProviderReleaseNotes.test.js` tests the notes, and
`Tests/ReleaseNotesReadTheDocs.test.ts` that they read the pages this
generator writes.

## 🔄 Dynamic Updates

The generator is designed to be **completely dynamic**:

- **New API endpoints** are automatically discovered and added as resources
- **Schema changes** are reflected in the generated code
- **No manual updates** required when the API evolves
- **Regenerate anytime** with a single command

## 🎯 Benefits

1. **Always Up-to-Date** - Provider automatically includes new API features
2. **Type Safety** - Generated Go code is type-safe and follows best practices
3. **Complete Coverage** - All API endpoints become Terraform resources
4. **Production Ready** - Includes error handling, logging, and documentation
5. **Standards Compliant** - Follows Terraform provider conventions
6. **Easy Maintenance** - Single source of truth (OpenAPI spec)

## 🛠️ Development

To modify the generator:

1. Edit TypeScript files in `Scripts/TerraformProvider/Core/`
2. Run `npm run generate-terraform-provider` to test changes
3. Check generated Go code in `Terraform/terraform-provider-oneuptime/`
4. Iterate and improve

The Go written by hand, in `StaticFiles/`, goes into `internal/provider`, and
the generated resources and data sources into its shards, packages of their
own. So a helper, type, field or method that generated code uses must be
exported (`NumberFromAPI`, `PersonAttribute{ID: ...}`): the shards name them
through a dot import of `internal/provider`, and `go build` says "undefined"
for one that is not.

### Checking the generator

The generator has its own unit tests and type check. The Terraform Provider
Generation workflow runs both on every pull request, and its type check is
the only one: `npm run generate-terraform-provider` checks no types.

```bash
cd Scripts/TerraformProvider
npm test          # unit tests (jest)
npm run compile   # type check (tsc --noEmit)
```

Both need `npm install` in `packages/Common`, `Scripts` and
`Scripts/TerraformProvider`: the generator imports Common's sources and
`Scripts/OpenAPI/GenerateSpec.ts`, whose packages resolve from those folders.

`tsconfig.json` extends `packages/Common/tsconfig.json`, so the Common files
the generator imports are checked exactly as Common checks them, and the
generator's own files are held to the same strict rules. Change compiler
options in Common's tsconfig, not here; `Tests/TypeCheckConfig.test.ts` names
the few that differ and why.

## Attributes that change only together

A column can say it changes only together with a new value of another
(`changesOnlyWith` on its `@TableColumn`). A monitor secret's `secretType` is
one: OneUptime changes it only in the same write as a new `secretValue`, which
it reads for the new type, and refuses a type sent alone. The spec says it as
`x-oneuptime-changes-only-with`, and the generator:

- names the other attribute by its Terraform name
  (`OpenAPIParser.resolveChangesOnlyWith`), and adds to the attribute's
  documentation that a plan changing it alone fails;
- has the resource's `ModifyPlan` call `requireChangedTogether`
  (`StaticFiles/changestogether.go`). It refuses, at plan time and on the
  attribute, a plan that changes `secret_type` and keeps `secret_value` or
  leaves it empty, and says what to change. A value known only at apply is
  left to OneUptime to judge then;
- keeps both attributes updatable in place. A plan that changes both makes one
  update that carries both, so the secret keeps its ID.

The provider's `Update` sends only what changed, so before this such a plan
sent the type alone and failed half-way through the apply (#9814). Marking
`secret_type` as replacing the secret would have been the other way out, and
it is the wrong one here. OneUptime changes the type in place, and a
replacement would lose the secret's ID, its history, and the monitors and
labels it was shared with outside the configuration. A one-time code secret
replaced by a Text secret holding the same setup key would also send that key
where the code went, which OneUptime refuses in place for that reason.

`Tests/ChangesOnlyWith.test.ts` covers the generator.
`changestogether_test.go` covers the refusal on its own, and
`changestogether_plan_test.go` covers type-only, value-only and type-and-value
changes through the provider's protocol server against a fake API.

## 📚 Documentation

- **Provider docs** are auto-generated for each resource and data source
- **Examples** show common usage patterns
- **README** provides setup and usage instructions
- **Terraform Registry** compatible format

This generator provides a complete, maintainable solution for creating Terraform providers from OpenAPI specifications, ensuring that your infrastructure-as-code tooling stays synchronized with your API evolution.
