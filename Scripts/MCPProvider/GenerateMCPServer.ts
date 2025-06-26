import { generateOpenAPISpec } from "../OpenAPI/GenerateSpec";
import path from "path";
import fs from "fs";
import Logger from "Common/Server/Utils/Logger";
import { MCPServerGenerator } from "./Core/MCPServerGenerator";
import { OpenAPIParser } from "./Core/OpenAPIParser";

async function main(): Promise<void> {
  Logger.info("🚀 Starting MCP Server Generation Process...");

  // Define paths
  const mcpDir: string = path.resolve(__dirname, "../../MCP");
  const openApiSpecPath: string = path.resolve(mcpDir, "openapi.json");

  try {
    // Step 1: Clean up existing MCP directory
    if (fs.existsSync(mcpDir)) {
      Logger.info("🗑️ Removing existing MCP directory...");
      fs.rmSync(mcpDir, { recursive: true, force: true });
    }

    // Create MCP directory
    fs.mkdirSync(mcpDir, { recursive: true });

    // Step 2: Generate OpenAPI spec
    Logger.info("📄 Step 1: Generating OpenAPI specification...");
    await generateOpenAPISpec(openApiSpecPath);

    // Step 3: Parse OpenAPI spec
    Logger.info("🔍 Step 2: Parsing OpenAPI specification...");
    const parser: OpenAPIParser = new OpenAPIParser();
    const apiSpec: any = await parser.parseOpenAPISpec(openApiSpecPath);

    // Step 4: Initialize MCP server generator
    Logger.info("⚙️ Step 3: Initializing MCP server generator...");
    const generator: MCPServerGenerator = new MCPServerGenerator(
      {
        outputDir: mcpDir,
        serverName: "oneuptime-mcp",
        serverVersion: "1.0.0",
        npmPackageName: "@oneuptime/mcp-server",
        description:
          "OneUptime Model Context Protocol (MCP) Server - Provides access to OneUptime APIs for LLMs",
      },
      apiSpec,
    );

    // Step 5: Generate MCP server
    Logger.info("🏗️ Step 4: Generating MCP server files...");
    await generator.generateServer();

    // Step 6: Create additional documentation files
    Logger.info("📚 Step 5: Creating additional documentation...");
    await createAdditionalFiles(mcpDir);

    Logger.info("✅ MCP server generation completed successfully!");
    Logger.info(`📁 MCP server generated at: ${mcpDir}`);
    Logger.info("🎯 Next steps:");
    Logger.info("   1. cd MCP");
    Logger.info("   2. npm install");
    Logger.info("   3. Set up your environment variables");
    Logger.info("   4. npm run build");
    Logger.info("   5. Test with npm start");
  } catch (error) {
    Logger.error("💥 MCP server generation failed:");
    Logger.error(error instanceof Error ? error.message : "Unknown error");
    process.exit(1);
  }
}

async function createAdditionalFiles(mcpDir: string): Promise<void> {
  // Create .env.example
  const envExample: string = `# OneUptime MCP Server Configuration

# Required: Your OneUptime API key
ONEUPTIME_API_KEY=your-api-key-here

# Optional: Your OneUptime instance URL (defaults to https://oneuptime.com)
ONEUPTIME_URL=https://oneuptime.com

# Optional: Alternative environment variable names
# ONEUPTIME_API_URL=https://oneuptime.com/api
# API_KEY=your-api-key-here

# Development settings
NODE_ENV=development
`;

  fs.writeFileSync(path.join(mcpDir, ".env.example"), envExample);

  // Create .gitignore
  const gitignore: string = `# Dependencies
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Build output
build/
dist/

# Environment variables
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# Logs
logs
*.log

# Runtime data
pids
*.pid
*.seed
*.pid.lock

# Coverage directory used by tools like istanbul
coverage/

# IDE files
.vscode/
.idea/
*.swp
*.swo

# OS generated files
.DS_Store
.DS_Store?
._*
.Spotlight-V100
.Trashes
ehthumbs.db
Thumbs.db

# TypeScript
*.tsbuildinfo

# Optional npm cache directory
.npm

# Optional REPL history
.node_repl_history

# Output of 'npm pack'
*.tgz

# Yarn Integrity file
.yarn-integrity
`;

  fs.writeFileSync(path.join(mcpDir, ".gitignore"), gitignore);

  // Create CHANGELOG.md
  const changelog: string = `# Changelog

All notable changes to the OneUptime MCP Server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - ${new Date().toISOString().split("T")[0]}

### Added
- Initial release of OneUptime MCP Server
- Complete API coverage with auto-generated tools from OpenAPI specification
- Support for all OneUptime resources and operations
- Comprehensive error handling and validation
- Docker support for containerized deployment
- TypeScript support with full type safety
- Environment-based configuration
- Detailed documentation and examples

### Features
- Model Context Protocol (MCP) 1.12+ compatibility
- Automatic OpenAPI specification parsing
- Dynamic tool generation from API endpoints
- Secure API key authentication
- Request/response validation
- Comprehensive logging and error reporting
`;

  fs.writeFileSync(path.join(mcpDir, "CHANGELOG.md"), changelog);

  // Create LICENSE
  const license: string = `Apache License
Version 2.0, January 2004
http://www.apache.org/licenses/

TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

1. Definitions.

"License" shall mean the terms and conditions for use, reproduction,
and distribution as defined by Sections 1 through 9 of this document.

"Licensor" shall mean the copyright owner or entity granting the License.

"Legal Entity" shall mean the union of the acting entity and all
other entities that control, are controlled by, or are under common
control with that entity. For the purposes of this definition,
"control" means (i) the power, direct or indirect, to cause the
direction or management of such entity, whether by contract or
otherwise, or (ii) ownership of fifty percent (50%) or more of the
outstanding shares, or (iii) beneficial ownership of such entity.

"You" (or "Your") shall mean an individual or Legal Entity
exercising permissions granted by this License.

"Source" form shall mean the preferred form for making modifications,
including but not limited to software source code, documentation
source, and configuration files.

"Object" form shall mean any form resulting from mechanical
transformation or translation of a Source form, including but
not limited to compiled object code, generated documentation,
and conversions to other media types.

"Work" shall mean the work of authorship, whether in Source or
Object form, made available under the License, as indicated by a
copyright notice that is included in or attached to the work
(which shall not include Communication that is conspicuously
marked or otherwise designated in writing by the copyright owner
as "Not a Work of the License").

"Derivative Works" shall mean any work, whether in Source or Object
form, that is based upon (or derived from) the Work and for which the
editorial revisions, annotations, elaborations, or other modifications
represent, as a whole, an original work of authorship. For the purposes
of this License, Derivative Works shall not include works that remain
separable from, or merely link (or bind by name) to the interfaces of,
the Work and derivative works thereof.

"Contribution" shall mean any work of authorship, including
the original version of the Work and any modifications or additions
to that Work or Derivative Works thereof, that is intentionally
submitted to Licensor for inclusion in the Work by the copyright owner
or by an individual or Legal Entity authorized to submit on behalf of
the copyright owner. For the purposes of this definition, "submitted"
means any form of electronic, verbal, or written communication sent
to the Licensor or its representatives, including but not limited to
communication on electronic mailing lists, source code control
systems, and issue tracking systems that are managed by, or on behalf
of, the Licensor for the purpose of discussing and improving the Work,
but excluding communication that is conspicuously marked or otherwise
designated in writing by the copyright owner as "Not a Contribution."

2. Grant of Copyright License. Subject to the terms and conditions of
this License, each Contributor hereby grants to You a perpetual,
worldwide, non-exclusive, no-charge, royalty-free, irrevocable
copyright license to use, reproduce, modify, publicly display,
publicly perform, sublicense, and distribute the Work and such Derivative
Works in Source or Object form.

3. Grant of Patent License. Subject to the terms and conditions of
this License, each Contributor hereby grants to You a perpetual,
worldwide, non-exclusive, no-charge, royalty-free, irrevocable
(except as stated in this section) patent license to make, have made,
use, offer to sell, sell, import, and otherwise transfer the Work,
where such license applies only to those patent claims licensable
by such Contributor that are necessarily infringed by their
Contribution(s) alone or by combination of their Contribution(s)
with the Work to which such Contribution(s) was submitted. If You
institute patent litigation against any entity (including a
cross-claim or counterclaim in a lawsuit) alleging that the Work
or a Contribution incorporated within the Work constitutes direct
or contributory patent infringement, then any patent licenses
granted to You under this License for that Work shall terminate
as of the date such litigation is filed.

4. Redistribution. You may reproduce and distribute copies of the
Work or Derivative Works thereof in any medium, with or without
modifications, and in Source or Object form, provided that You
meet the following conditions:

(a) You must give any other recipients of the Work or
Derivative Works a copy of this License; and

(b) You must cause any modified files to carry prominent notices
stating that You changed the files; and

(c) You must retain, in the Source form of any Derivative Works
that You distribute, all copyright, patent, trademark, and
attribution notices from the Source form of the Work,
excluding those notices that do not pertain to any part of
the Derivative Works; and

(d) If the Work includes a "NOTICE" text file as part of its
distribution, then any Derivative Works that You distribute must
include a readable copy of the attribution notices contained
within such NOTICE file, excluding those notices that do not
pertain to any part of the Derivative Works, in at least one
of the following places: within a NOTICE text file distributed
as part of the Derivative Works; within the Source form or
documentation, if provided along with the Derivative Works; or,
within a display generated by the Derivative Works, if and
wherever such third-party notices normally appear. The contents
of the NOTICE file are for informational purposes only and
do not modify the License. You may add Your own attribution
notices within Derivative Works that You distribute, alongside
or as an addendum to the NOTICE text from the Work, provided
that such additional attribution notices cannot be construed
as modifying the License.

You may add Your own copyright notice to Your modifications and
may provide additional or different license terms and conditions
for use, reproduction, or distribution of Your modifications, or
for any such Derivative Works as a whole, provided Your use,
reproduction, and distribution of the Work otherwise complies with
the conditions stated in this License.

5. Submission of Contributions. Unless You explicitly state otherwise,
any Contribution intentionally submitted for inclusion in the Work
by You to the Licensor shall be under the terms and conditions of
this License, without any additional terms or conditions.
Notwithstanding the above, nothing herein shall supersede or modify
the terms of any separate license agreement you may have executed
with Licensor regarding such Contributions.

6. Trademarks. This License does not grant permission to use the trade
names, trademarks, service marks, or product names of the Licensor,
except as required for reasonable and customary use in describing the
origin of the Work and reproducing the content of the NOTICE file.

7. Disclaimer of Warranty. Unless required by applicable law or
agreed to in writing, Licensor provides the Work (and each
Contributor provides its Contributions) on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
implied, including, without limitation, any warranties or conditions
of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
PARTICULAR PURPOSE. You are solely responsible for determining the
appropriateness of using or redistributing the Work and assume any
risks associated with Your exercise of permissions under this License.

8. Limitation of Liability. In no event and under no legal theory,
whether in tort (including negligence), contract, or otherwise,
unless required by applicable law (such as deliberate and grossly
negligent acts) or agreed to in writing, shall any Contributor be
liable to You for damages, including any direct, indirect, special,
incidental, or consequential damages of any character arising as a
result of this License or out of the use or inability to use the
Work (including but not limited to damages for loss of goodwill,
work stoppage, computer failure or malfunction, or any and all
other commercial damages or losses), even if such Contributor
has been advised of the possibility of such damages.

9. Accepting Warranty or Support. You may choose to offer, and to
charge a fee for, warranty, support, indemnity or other liability
obligations and/or rights consistent with this License. However, in
accepting such obligations, You may act only on Your own behalf and on
Your sole responsibility, not on behalf of any other Contributor, and
only if You agree to indemnify, defend, and hold each Contributor
harmless for any liability incurred by, or claims asserted against,
such Contributor by reason of your accepting any such warranty or support.

END OF TERMS AND CONDITIONS

Copyright 2024 OneUptime, Inc.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
`;

  fs.writeFileSync(path.join(mcpDir, "LICENSE"), license);
}

main().catch((err: Error) => {
  Logger.error(`💥 Unexpected error: ${err.message}`);
  process.exit(1);
});
