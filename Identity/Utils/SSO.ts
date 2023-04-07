import { JSONArray, JSONObject } from 'Common/Types/JSON';
import BadRequestException from 'Common/Types/Exception/BadRequestException';
import Email from 'Common/Types/Email';
import xmldom from 'xmldom';
import xmlCrypto, { FileKeyInfo } from 'xml-crypto';

export default class SSOUtil {
    public static isPayloadValid(payload: JSONObject): void {
        if (
            !payload['saml2p:Response'] &&
            !payload['samlp:Response'] &&
            !payload['samlp:Response']
        ) {
            throw new BadRequestException('SAML Response not found.');
        }

        payload =
            (payload['saml2p:Response'] as JSONObject) ||
            (payload['samlp:Response'] as JSONObject) ||
            (payload['samlp:Response'] as JSONObject);

        const issuers: JSONArray =
            (payload['saml2:Issuer'] as JSONArray) ||
            (payload['saml:Issuer'] as JSONArray);

        if (issuers.length === 0) {
            throw new BadRequestException('Issuers not found');
        }

        const issuer: JSONObject | undefined = issuers[0];

        if (!issuer) {
            throw new BadRequestException('Issuer not found');
        }

        const issuerUrl: string = issuer['_'] as string;

        if (!issuerUrl) {
            throw new BadRequestException(
                'Issuer URL not found in SAML response'
            );
        }

        const samlAssertion: JSONArray =
            (payload['saml2:Assertion'] as JSONArray) ||
            (payload['saml:Assertion'] as JSONArray);

        if (!samlAssertion || samlAssertion.length === 0) {
            throw new BadRequestException('SAML Assertion not found');
        }

        const samlSubject: JSONArray =
            ((samlAssertion[0] as JSONObject)['saml2:Subject'] as JSONArray) ||
            ((samlAssertion[0] as JSONObject)['saml:Subject'] as JSONArray);

        if (!samlSubject || samlSubject.length === 0) {
            throw new BadRequestException('SAML Subject not found');
        }

        const samlNameId: JSONArray =
            ((samlSubject[0] as JSONObject)['saml2:NameID'] as JSONArray) ||
            ((samlSubject[0] as JSONObject)[
                'saml:NameIdentifier'
            ] as JSONArray);

        if (!samlNameId || samlNameId.length === 0) {
            throw new BadRequestException('SAML NAME ID not found');
        }

        const emailString: string = (samlNameId[0] as JSONObject)[
            '_'
        ] as string;

        if (!emailString) {
            if (!samlNameId || samlNameId.length === 0) {
                throw new BadRequestException('SAML Email not found');
            }
        }
    }

    public static isSignatureValid(
        samlPayload: string,
        certificate: string
    ): boolean {
        const dom: Document = new xmldom.DOMParser().parseFromString(
            samlPayload
        );
        const signature: Element | undefined = dom.getElementsByTagNameNS(
            'http://www.w3.org/2000/09/xmldsig#',
            'Signature'
        )[0];
        const sig: xmlCrypto.SignedXml = new xmlCrypto.SignedXml();

        sig.keyInfoProvider = {
            getKeyInfo: function (_key: any) {
                return `<X509Data><X509Certificate>${certificate}</X509Certificate></X509Data>`;
            },
            getKey: function () {
                return certificate;
            } as any,
        } as FileKeyInfo;

        sig.loadSignature(signature!.toString());
        const res: boolean = sig.checkSignature(samlPayload);

        return res;
    }

    public static getEmail(payload: JSONObject): Email {
        if (!payload['saml2p:Response'] && !payload['samlp:Response']) {
            throw new BadRequestException('SAML Response not found.');
        }

        payload =
            (payload['saml2p:Response'] as JSONObject) ||
            (payload['samlp:Response'] as JSONObject);

        const samlAssertion: JSONArray =
            (payload['saml2:Assertion'] as JSONArray) ||
            (payload['saml:Assertion'] as JSONArray);

        if (!samlAssertion || samlAssertion.length === 0) {
            throw new BadRequestException('SAML Assertion not found');
        }

        const samlSubject: JSONArray =
            ((samlAssertion[0] as JSONObject)['saml2:Subject'] as JSONArray) ||
            ((samlAssertion[0] as JSONObject)['saml:Subject'] as JSONArray);

        if (!samlSubject || samlSubject.length === 0) {
            throw new BadRequestException('SAML Subject not found');
        }

        const samlNameId: JSONArray =
            ((samlSubject[0] as JSONObject)['saml2:NameID'] as JSONArray) ||
            ((samlSubject[0] as JSONObject)[
                'saml:NameIdentifier'
            ] as JSONArray);

        if (!samlNameId || samlNameId.length === 0) {
            throw new BadRequestException('SAML NAME ID not found');
        }

        const emailString: string = (samlNameId[0] as JSONObject)[
            '_'
        ] as string;

        return new Email(emailString);
    }

    public static getIssuer(payload: JSONObject): string {
        if (!payload['saml2p:Response'] && !payload['samlp:Response']) {
            throw new BadRequestException('SAML Response not found.');
        }

        payload =
            (payload['saml2p:Response'] as JSONObject) ||
            (payload['samlp:Response'] as JSONObject);

        const issuers: JSONArray =
            (payload['saml2:Issuer'] as JSONArray) ||
            (payload['saml:Issuer'] as JSONArray);

        if (issuers.length === 0) {
            throw new BadRequestException('Issuers not found');
        }

        const issuer: JSONObject | undefined = issuers[0];

        if (!issuer) {
            throw new BadRequestException('Issuer not found');
        }

        const issuerUrl: string = issuer['_'] as string;

        if (!issuerUrl) {
            throw new BadRequestException(
                'Issuer URL not found in SAML response'
            );
        }

        return issuerUrl;
    }
}
