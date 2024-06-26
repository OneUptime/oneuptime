import ServiceLanguage from "Common/Types/ServiceCatalog/ServiceLanguage";

export default interface CodeRepositoryFile {
  filePath: string;
  gitCommitHash: string;
  fileExtension: string;
  fileName: string;
  fileContent: string;
  fileLanguage: ServiceLanguage;
}
