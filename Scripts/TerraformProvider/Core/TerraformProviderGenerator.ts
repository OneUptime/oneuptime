import fs from "fs";
import path from "path";
import { TerraformProviderConfig } from "./Types";
import { FileGenerator } from "./FileGenerator";

export class TerraformProviderGenerator {
  public config: TerraformProviderConfig;
  private fileGenerator: FileGenerator;

  public constructor(config: TerraformProviderConfig) {
    this.config = config;
    this.fileGenerator = new FileGenerator(config.outputDir);
  }

  public async generateBuildScripts(): Promise<void> {
    await this.generateMakefile();
    await this.generateInstallScript();
    await this.generateBuildScript();
    await this.generateTestScript();
  }

  private async generateMakefile(): Promise<void> {
    const makefileContent: string = `
# Terraform Provider Makefile

HOSTNAME=registry.terraform.io
NAMESPACE=oneuptime
NAME=${this.config.providerName}
BINARY=terraform-provider-\${NAME}
VERSION=${this.config.providerVersion}
OS_ARCH=darwin_amd64

default: install

build:
	go build -o \${BINARY}

release:
	GOOS=darwin GOARCH=amd64 go build -o ./bin/\${BINARY}_\${VERSION}_darwin_amd64
	GOOS=freebsd GOARCH=386 go build -o ./bin/\${BINARY}_\${VERSION}_freebsd_386
	GOOS=freebsd GOARCH=amd64 go build -o ./bin/\${BINARY}_\${VERSION}_freebsd_amd64
	GOOS=freebsd GOARCH=arm go build -o ./bin/\${BINARY}_\${VERSION}_freebsd_arm
	GOOS=linux GOARCH=386 go build -o ./bin/\${BINARY}_\${VERSION}_linux_386
	GOOS=linux GOARCH=amd64 go build -o ./bin/\${BINARY}_\${VERSION}_linux_amd64
	GOOS=linux GOARCH=arm go build -o ./bin/\${BINARY}_\${VERSION}_linux_arm
	GOOS=openbsd GOARCH=386 go build -o ./bin/\${BINARY}_\${VERSION}_openbsd_386
	GOOS=openbsd GOARCH=amd64 go build -o ./bin/\${BINARY}_\${VERSION}_openbsd_amd64
	GOOS=solaris GOARCH=amd64 go build -o ./bin/\${BINARY}_\${VERSION}_solaris_amd64
	GOOS=windows GOARCH=386 go build -o ./bin/\${BINARY}_\${VERSION}_windows_386
	GOOS=windows GOARCH=amd64 go build -o ./bin/\${BINARY}_\${VERSION}_windows_amd64

install: build
	mkdir -p ~/.terraform.d/plugins/\${HOSTNAME}/\${NAMESPACE}/\${NAME}/\${VERSION}/\${OS_ARCH}
	mv \${BINARY} ~/.terraform.d/plugins/\${HOSTNAME}/\${NAMESPACE}/\${NAME}/\${VERSION}/\${OS_ARCH}

test:
	go test -i $(go list ./... | grep -v examples)
	go test $(go list ./... | grep -v examples) -v $(TESTARGS) -timeout 120m

testacc:
	TF_ACC=1 go test $(go list ./... | grep -v examples) -v $(TESTARGS) -timeout 120m

clean:
	rm -f \${BINARY}
	rm -rf ./bin/*

.PHONY: build release install test testacc clean
`.trim();

    await this.fileGenerator.writeFile("Makefile", makefileContent);
  }

  private async generateInstallScript(): Promise<void> {
    const scriptContent = `#!/bin/bash
set -e

# Install Terraform Provider locally
echo "Installing ${this.config.providerName} Terraform Provider..."

# Build the provider
echo "Building provider..."
go build -o terraform-provider-${this.config.providerName}

# Create plugin directory
PLUGIN_DIR="$HOME/.terraform.d/plugins/registry.terraform.io/oneuptime/${this.config.providerName}/${this.config.providerVersion}/darwin_amd64"
mkdir -p "$PLUGIN_DIR"

# Copy binary
echo "Installing provider to $PLUGIN_DIR"
cp terraform-provider-${this.config.providerName} "$PLUGIN_DIR/"

echo "✅ Provider installed successfully!"
echo "You can now use it in your Terraform configuration:"
echo ""
echo "terraform {"
echo "  required_providers {"
echo "    ${this.config.providerName} = {"
echo "      source = "oneuptime/${this.config.providerName}""
echo "      version = "${this.config.providerVersion}""
echo "    }"
echo "  }"
echo "}"
`;

    await this.fileGenerator.writeFile("install.sh", scriptContent);

    // Make script executable
    const scriptPath = path.join(this.config.outputDir, "install.sh");
    fs.chmodSync(scriptPath, "755");
  }

  private async generateBuildScript(): Promise<void> {
    const scriptContent = `#!/bin/bash
set -e

echo "Building ${this.config.providerName} Terraform Provider..."

# Clean previous builds
rm -f terraform-provider-${this.config.providerName}

# Build for current platform
go build -o terraform-provider-${this.config.providerName}

echo "✅ Build completed successfully!"
echo "Binary: terraform-provider-${this.config.providerName}"
`;

    await this.fileGenerator.writeFile("build.sh", scriptContent);

    // Make script executable
    const scriptPath = path.join(this.config.outputDir, "build.sh");
    fs.chmodSync(scriptPath, "755");
  }

  private async generateTestScript(): Promise<void> {
    const scriptContent = `#!/bin/bash
set -e

echo "Running tests for ${this.config.providerName} Terraform Provider..."

# Run unit tests
echo "Running unit tests..."
go test ./... -v

# Run acceptance tests if TF_ACC is set
if [ "$TF_ACC" = "1" ]; then
    echo "Running acceptance tests..."
    TF_ACC=1 go test ./... -v -timeout 120m
fi

echo "✅ Tests completed successfully!"
`;

    await this.fileGenerator.writeFile("test.sh", scriptContent);

    // Make script executable
    const scriptPath: string = path.join(this.config.outputDir, "test.sh");
    fs.chmodSync(scriptPath, "755");
  }
}
