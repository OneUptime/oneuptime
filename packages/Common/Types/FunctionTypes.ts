export type PromiseVoidFunction = () => Promise<void>;
export type VoidFunction = () => void;
export type ErrorFunction = (err: Error) => void;
export type PromiseRejectErrorFunction = (err: Error) => void;
