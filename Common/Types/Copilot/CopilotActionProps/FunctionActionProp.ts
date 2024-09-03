export default interface FileActionProp {
    filePath: string;
    className?: string | undefined; // some languages are not class based.
    functionName: string;
}
