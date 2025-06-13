import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

interface InstallResult {
    success: boolean;
    message: string;
    version?: string;
}

class ToolInstaller {
    private static readonly OPENAPI_TOOL_NAME = 'tfplugingen-openapi';
    private static readonly OPENAPI_TOOL_PACKAGE = 'github.com/hashicorp/terraform-plugin-codegen-openapi/cmd/tfplugingen-openapi@latest';
    
    private static readonly FRAMEWORK_TOOL_NAME = 'tfplugingen-framework';
    private static readonly FRAMEWORK_TOOL_PACKAGE = 'github.com/hashicorp/terraform-plugin-codegen-framework/cmd/tfplugingen-framework@latest';

    public static async installTerraformPluginCodegenOpenAPI(): Promise<InstallResult> {
        try {
            console.log('🔧 Installing Terraform Plugin Codegen OpenAPI...');
            
            // Check if Go is installed
            if (!this.isGoInstalled()) {
                return {
                    success: false,
                    message: 'Go is not installed. Please install Go first.'
                };
            }

            // Install the tool
            console.log(`📦 Running: go install ${this.OPENAPI_TOOL_PACKAGE}`);
            execSync(`go install ${this.OPENAPI_TOOL_PACKAGE}`, {
                stdio: 'inherit',
                timeout: 300000 // 5 minutes timeout
            });

            // Verify installation
            const version = this.getToolVersion(this.OPENAPI_TOOL_NAME);
            if (version) {
                console.log('✅ Installation successful!');
                return {
                    success: true,
                    message: `Successfully installed ${this.OPENAPI_TOOL_NAME}`,
                    version: version
                };
            } else {
                return {
                    success: false,
                    message: `Installation completed but ${this.OPENAPI_TOOL_NAME} is not available in PATH`
                };
            }

        } catch (error) {
            console.error('❌ Installation failed:', error);
            return {
                success: false,
                message: `Installation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }

    public static async installTerraformPluginFrameworkGenerator(): Promise<InstallResult> {
        try {
            console.log('🔧 Installing Terraform Plugin Framework Generator...');
            
            // Check if Go is installed
            if (!this.isGoInstalled()) {
                return {
                    success: false,
                    message: 'Go is not installed. Please install Go first.'
                };
            }

            // Install the tool
            console.log(`📦 Running: go install ${this.FRAMEWORK_TOOL_PACKAGE}`);
            execSync(`go install ${this.FRAMEWORK_TOOL_PACKAGE}`, {
                stdio: 'inherit',
                timeout: 300000 // 5 minutes timeout
            });

            // Verify installation
            const version = this.getToolVersion(this.FRAMEWORK_TOOL_NAME);
            if (version) {
                console.log('✅ Framework Generator installation successful!');
                return {
                    success: true,
                    message: `Successfully installed ${this.FRAMEWORK_TOOL_NAME}`,
                    version: version
                };
            } else {
                return {
                    success: false,
                    message: `Installation completed but ${this.FRAMEWORK_TOOL_NAME} is not available in PATH`
                };
            }

        } catch (error) {
            console.error('❌ Framework Generator installation failed:', error);
            return {
                success: false,
                message: `Installation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }

    private static isGoInstalled(): boolean {
        try {
            execSync('go version', { stdio: 'pipe' });
            return true;
        } catch {
            return false;
        }
    }

    private static getToolVersion(toolName: string): string | null {
        try {
            execSync(`${toolName} --help`, { 
                encoding: 'utf8',
                stdio: 'pipe'
            });
            // The tool might not have a --version flag, so we check if it's available
            return 'latest';
        } catch {
            try {
                // Try to find the binary in GOPATH/bin or GOBIN
                const goPath = this.getGoPath();
                const binaryPath = path.join(goPath, 'bin', toolName);
                if (fs.existsSync(binaryPath)) {
                    return 'latest';
                }
            } catch {
                // Ignore error
            }
            return null;
        }
    }

    private static getGoPath(): string {
        try {
            const goPath = execSync('go env GOPATH', { encoding: 'utf8' }).trim();
            return goPath;
        } catch {
            // Default GOPATH
            const homeDir = process.env['HOME'] || process.env['USERPROFILE'] || '';
            return path.join(homeDir, 'go');
        }
    }

    public static printInstallationInfo(): void {
        console.log('📋 Installation Information:');
        console.log(`   OpenAPI Tool: ${this.OPENAPI_TOOL_NAME}`);
        console.log(`   OpenAPI Package: ${this.OPENAPI_TOOL_PACKAGE}`);
        console.log(`   Framework Tool: ${this.FRAMEWORK_TOOL_NAME}`);
        console.log(`   Framework Package: ${this.FRAMEWORK_TOOL_PACKAGE}`);
        console.log('   Prerequisites: Go must be installed');
        console.log('   Usage: Use different methods to install the specific tool needed');
        console.log('');
    }
}

// Main execution
async function main(): Promise<void> {
    try {
        ToolInstaller.printInstallationInfo();
        
        const result = await ToolInstaller.installTerraformPluginCodegenOpenAPI();
        
        if (result.success) {
            console.log(`🎉 ${result.message}`);
            if (result.version) {
                console.log(`📌 Version: ${result.version}`);
            }
            
            // Print usage instructions
            console.log('');
            console.log('📖 Usage Instructions:');
            console.log('   The tfplugingen-openapi tool is now available in your PATH');
            console.log('   You can use it to generate Terraform provider code from OpenAPI specs');
            console.log('   Example: tfplugingen-openapi generate --help');
        } else {
            console.error(`💥 ${result.message}`);
            process.exit(1);
        }
        
    } catch (error) {
        console.error('🚨 Unexpected error:', error);
        process.exit(1);
    }
}

// Export for potential reuse
export { ToolInstaller, InstallResult };

// Run if this file is executed directly
if (require.main === module) {
    main();
}