import { JSONArray, JSONObject } from 'Common/Types/JSON';
import BadRequestException from 'Common/Types/Exception/BadRequestException';
import Email from 'Common/Types/Email';

export default class SSOUtil {
    public static isPayloadValid(payload: JSONObject): void {
        if (!payload['saml2p:Response']) {
            throw new BadRequestException('SAML Response not found.');
        }

        payload = payload['saml2p:Response'] as JSONObject;

        const issuers: JSONArray = payload['saml2:Issuer'] as JSONArray;

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

        const samlAssertion: JSONArray = payload[
            'saml2:Assertion'
        ] as JSONArray;

        if (!samlAssertion || samlAssertion.length === 0) {
            throw new BadRequestException('SAML Assertion not found');
        }

        const samlSubject: JSONArray = (samlAssertion[0] as JSONObject)[
            'saml2:Subject'
        ] as JSONArray;

        if (!samlSubject || samlSubject.length === 0) {
            throw new BadRequestException('SAML Subject not found');
        }

        const samlNameId: JSONArray = (samlSubject[0] as JSONObject)[
            'saml2:NameID'
        ] as JSONArray;

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
        payload: JSONObject,
        _certificate: string
    ): boolean {
        SSOUtil.isPayloadValid(payload);

        // TODO  add signature verification.
        return true;
    }

    public static getEmail(payload: JSONObject): Email {
        if (!payload['saml2p:Response']) {
            throw new BadRequestException('SAML Response not found.');
        }

        payload = payload['saml2p:Response'] as JSONObject;

        const samlAssertion: JSONArray = payload[
            'saml2:Assertion'
        ] as JSONArray;

        if (!samlAssertion || samlAssertion.length === 0) {
            throw new BadRequestException('SAML Assertion not found');
        }

        const samlSubject: JSONArray = (samlAssertion[0] as JSONObject)[
            'saml2:Subject'
        ] as JSONArray;

        if (!samlSubject || samlSubject.length === 0) {
            throw new BadRequestException('SAML Subject not found');
        }

        const samlNameId: JSONArray = (samlSubject[0] as JSONObject)[
            'saml2:NameID'
        ] as JSONArray;

        if (!samlNameId || samlNameId.length === 0) {
            throw new BadRequestException('SAML NAME ID not found');
        }

        const emailString: string = (samlNameId[0] as JSONObject)[
            '_'
        ] as string;

        return new Email(emailString);
    }

    public static getIssuer(payload: JSONObject): string {
        if (!payload['saml2p:Response']) {
            throw new BadRequestException('SAML Response not found.');
        }

        payload = payload['saml2p:Response'] as JSONObject;

        const issuers: JSONArray = payload['saml2:Issuer'] as JSONArray;

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
