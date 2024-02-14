import Dictionary from "Common/Types/Dictionary";

export default interface RequestOptions {
    requestHeaders?: Dictionary<string> | undefined;
    overrideRequestUrl?: URL | undefined;
}