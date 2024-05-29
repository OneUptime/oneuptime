import URL from 'Common/Types/API/URL';
import Dictionary from 'Common/Types/Dictionary';

export default interface RequestOptions {
    requestHeaders?: Dictionary<string> | undefined;
    overrideRequestUrl?: URL | undefined;
}
