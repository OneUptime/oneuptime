export default interface FunctionActionProp {
  filePath: string;
  className?: string | undefined; // some languages are not class based.
  functionName: string;
}
