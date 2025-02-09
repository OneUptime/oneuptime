export default interface FileActionProp {
  filePath: string;

  // if startLineNumber and endLineNumber are not provided, the whole file will be considered
  startLineNumber?: number | undefined;
  endLineNumber?: number | undefined;
}
