import Dictionary from 'Common/Types/Dictionary';
import URL from 'Common/Types/API/URL';

export default interface RequestOptions {
    requestHeaders?: Dictionary<string> | undefined;
    overrideRequestUrl?: URL | undefined;
}
