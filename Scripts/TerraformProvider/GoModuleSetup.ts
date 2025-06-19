import { execSync } from "child_process";
import path from "path";
import fs from "fs";

export class GoModuleSetup {
  // init the Go module in the specified directory
  public static initGoModule(data: {
    path: string;
    packageName: string;
  }): void {
    // go mod init terraform-provider-petstore

    const command: string = `cd ${data.path.toString()} && go mod init terraform-provider-${data.packageName}`;
    try {
      execSync(command, { stdio: "inherit" });
      // eslint-disable-next-line no-console
      console.log(`Go module initialized successfully at ${data.path}`);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`Failed to initialize Go module: ${error}`);
    }

   // read the main.go file content from ./main.go
    const mainGoContent: string = fs.readFileSync(
        path.join(__dirname, "../../Scripts/TerraformProvider/main.go"),
        "utf-8",
    );

    const mainGoPath: string = path.join(data.path, "main.go");
    fs.writeFileSync(mainGoPath, mainGoContent);
  }
}
