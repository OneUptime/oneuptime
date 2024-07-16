import TechStack from "Common/Types/ServiceCatalog/TechStack";

export default interface CodeRepositoryFile {
  filePath: string;
  gitCommitHash: string;
  fileExtension: string;
  fileName: string;
  fileContent: string;
  fileLanguage: TechStack;
}
