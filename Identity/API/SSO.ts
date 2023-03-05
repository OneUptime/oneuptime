
import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
    NextFunction,
} from 'CommonServer/Utils/Express';
import BadRequestException from 'Common/Types/Exception/BadRequestException';
import ServerException from 'Common/Types/Exception/ServerException';
import Response from 'CommonServer/Utils/Response';
import ProjectSSO from 'Model/Models/ProjectSso';
import ProjectSSOService from 'CommonServer/Services/ProjectSSOService';
import ObjectID from 'Common/Types/ObjectID';
import xml2js from 'xml2js';
import { JSONArray, JSONObject } from 'Common/Types/JSON';
import KJUR from 'jsrsasign';
import logger from 'CommonServer/Utils/Logger';
import XMLCrypto from 'xml-crypto';

const router: ExpressRouter = Express.getRouter();

router.get(
    '/sso/:projectId/:projectSsoId',
    async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): Promise<void> => {
        try {

            if (!req.params['projectId']) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('Project ID not found')
                );
            }

            if (!req.params['projectSsoId']) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('Project SSO ID not found')
                );
            }


            const projectSSO: ProjectSSO | null = await ProjectSSOService.findOneBy({
                query: {
                    projectId: new ObjectID(req.params['projectId']),
                    _id: req.params['projectSsoId'],
                    isEnabled: true
                },
                select: {
                    signOnURL: true,
                },
                props: {
                    isRoot: true,
                }
            });


            if (!projectSSO) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('SSO Config not found')
                );
            }

            // redirect to Identity Provider. 

            if (!projectSSO.signOnURL) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('Sign On URL not found')
                );
            }

            return Response.redirect(req, res, projectSSO.signOnURL);

        } catch (err) {
            return next(err);
        }
    }
);


router.post(
    '/idp-login/:projectId/:projectSsoId',
    async (
        req: ExpressRequest,
        res: ExpressResponse,
    ): Promise<void> => {

        try {

            const samlResponseBase64: string = req.body.SAMLResponse;

            const samlResponse = Buffer.from(samlResponseBase64, 'base64').toString();

            let response: JSONObject = await xml2js.parseStringPromise(samlResponse);

            if (!response["saml2p:Response"]) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('SAML Response not found.')
                );
            }


            response = response["saml2p:Response"] as JSONObject;

            const issuers = response["saml2:Issuer"] as JSONArray;

            if (issuers.length === 0) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('Issuers not found')
                );
            }

            const issuer = issuers[0];

            if (!issuer) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('Issuer not found')
                );
            }

            const issuerUrl = issuer["_"] as string;

            if (!issuerUrl) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('Issuer URL not found in SAML response')
                );
            }


            if (!req.params['projectId']) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('Project ID not found')
                );
            }

            if (!req.params['projectSsoId']) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('Project SSO ID not found')
                );
            }


            const projectSSO: ProjectSSO | null = await ProjectSSOService.findOneBy({
                query: {
                    projectId: new ObjectID(req.params['projectId']),
                    _id: req.params['projectSsoId'],
                    isEnabled: true
                },
                select: {
                    signOnURL: true,
                    issuerURL: true,
                    publicCertificate: true
                },
                props: {
                    isRoot: true,
                }
            });

            if (!projectSSO) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('SSO Config not found')
                );
            }

            // redirect to Identity Provider. 

            if (!projectSSO.issuerURL) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('Issuer URL not found')
                );
            }



            // redirect to Identity Provider. 

            if (!projectSSO.signOnURL) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('Sign on URL not found')
                );
            }


            if (projectSSO.issuerURL.toString() !== issuerUrl) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('Issuer URL does not match')
                );
            }


            if (!projectSSO.publicCertificate) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('Public Certificate not found')
                );
            }

            const signatureBlocks = response["ds:Signature"] as JSONArray;



            const signatureValueBlocks = (signatureBlocks[0] as any)["ds:SignatureValue"] as Array<string>;

            const signatureValue = signatureValueBlocks[0] as string;



            const certificate = projectSSO.publicCertificate;

            const signature = signatureValue;





            // Step 2: Extract the public key from the x509 certificate
            // Step 2: Extract the public key from the x509 certificate
            const cert = new KJUR.X509();
            cert.readCertPEM(certificate);
            const publicKey = cert.getPublicKey();

            var sig = new XMLCrypto.SignedXml()
            var isValid = sig.checkSignature(samlResponse)

            console.log(JSON.stringify(response, null, 2));


            Response.sendEmptyResponse(req, res);
        } catch (err) {
            logger.error(err);
            Response.sendErrorResponse(req, res, new ServerException());
        }
    }
);


export default router;
