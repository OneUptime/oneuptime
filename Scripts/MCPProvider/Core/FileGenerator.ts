import fs from "fs";
import path from "path";

export class FileGenerator {
  private outputDir: string;

  public constructor(outputDir: string) {
    this.outputDir = outputDir;
  }

  public async writeFile(filePath: string, content: string): Promise<void> {
    const fullPath: string = path.join(this.outputDir, filePath);
    const dir: string = path.dirname(fullPath);

    // Create directory if it doesn't exist
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(fullPath, content, "utf8");
  }

  public async writeFileInDir(
    subDir: string,
    fileName: string,
    content: string,
  ): Promise<void> {
    const fullDir: string = path.join(this.outputDir, subDir);

    // Create directory if it doesn't exist
    if (!fs.existsSync(fullDir)) {
      fs.mkdirSync(fullDir, { recursive: true });
    }

    const fullPath: string = path.join(fullDir, fileName);
    fs.writeFileSync(fullPath, content, "utf8");
  }

  public ensureDirectoryExists(dirPath: string): void {
    const fullPath: string = path.join(this.outputDir, dirPath);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  }
}
