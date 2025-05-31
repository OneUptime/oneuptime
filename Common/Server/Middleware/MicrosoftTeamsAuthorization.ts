import { ExpressRequest, ExpressResponse, NextFunction } from '../Utils/Express'; // Adjusted path
import { Response as OneUptimeResponse } from '../Utils/Response'; // Renamed to avoid conflict
import { UnauthorizedException } from '../Types/Exception/UnauthorizedException';
import jwt from 'jsonwebtoken';
import jwksRsa from 'jwks-rsa';
import Logger from '../Utils/Logger';
import { MS_TEAMS_APP_ID } from '../Config'; // Assuming MS_TEAMS_APP_ID is in Config

// It's common to export the function directly for middleware usage
export const MicrosoftTeamsAuthorization = {
    async isAuthorizedTeamsRequest(
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): Promise<void> {
        try {
            const authHeader: string | undefined = req.headers['authorization'];
            if (!authHeader) {
                Logger.warn('MicrosoftTeamsAuthorization: No Authorization header present.');
                const unauthException: UnauthorizedException = new UnauthorizedException('Authorization header is required.');
                return OneUptimeResponse.sendErrorResponse(req, res, unauthException);
            }

            const parts: string[] = authHeader.split(' ');
            if (parts.length !== 2 || parts[0]?.toLowerCase() !== 'bearer') {
                Logger.warn('MicrosoftTeamsAuthorization: Authorization header is not a Bearer token.');
                const unauthException: UnauthorizedException = new UnauthorizedException('Invalid token format. Bearer token expected.');
                return OneUptimeResponse.sendErrorResponse(req, res, unauthException);
            }

            const token: string = parts[1] as string;
            if (!token) {
                Logger.warn('MicrosoftTeamsAuthorization: No token found in Authorization header.');
                const unauthException: UnauthorizedException = new UnauthorizedException('Bearer token is required.');
                return OneUptimeResponse.sendErrorResponse(req, res, unauthException);
            }

            if (!MS_TEAMS_APP_ID) {
                Logger.error('MicrosoftTeamsAuthorization: MS_TEAMS_APP_ID is not configured in environment variables.');
                const unauthException: UnauthorizedException = new UnauthorizedException('Authentication configuration error on server.');
                return OneUptimeResponse.sendErrorResponse(req, res, unauthException);
            }

            const jwksClient = jwksRsa({
                jwksUri: 'https://login.botframework.com/v1/.well-known/keys', // As specified
                cache: true, // Enable caching of signing keys
                cacheMaxEntries: 5, // Cache up to 5 signing keys
                cacheMaxAge: 10 * 60 * 60 * 1000, // Cache for 10 hours
            });

            const getKey = (header: jwt.JwtHeader, callback: jwt.SigningKeyCallback): void => {
                if (!header.kid) {
                    Logger.warn('MicrosoftTeamsAuthorization: JWT header is missing "kid".');
                    return callback(new Error('JWT header is missing "kid".'));
                }
                jwksClient.getSigningKey(header.kid, (err, key) => {
                    if (err) {
                        Logger.error('MicrosoftTeamsAuthorization: Error fetching signing key.', err);
                        return callback(err);
                    }
                    // key object has a publicKey or rsaPublicKey property
                    const signingKey = key?.['publicKey'] || key?.['rsaPublicKey'];
                    callback(null, signingKey);
                });
            };

            jwt.verify(
                token,
                getKey,
                {
                    audience: MS_TEAMS_APP_ID.toString(),
                    issuer: 'https://api.botframework.com', // As specified
                    algorithms: ['RS256'], // As specified
                },
                (err: any, decoded: any) => {
                    if (err) {
                        Logger.warn('MicrosoftTeamsAuthorization: JWT verification failed.', err);
                        let message: string = 'Invalid token.';
                        if (err instanceof jwt.TokenExpiredError) {
                            message = 'Token expired.';
                        } else if (err instanceof jwt.JsonWebTokenError) {
                            message = `Token signature or structure is invalid: ${err.message}`;
                        }
                        const unauthException: UnauthorizedException = new UnauthorizedException(message);
                        return OneUptimeResponse.sendErrorResponse(req, res, unauthException);
                    }

                    Logger.info('MicrosoftTeamsAuthorization: JWT verified successfully.');
                    // Attach decoded token to request if needed, e.g., req.user = decoded;
                    (req as any).botIdentity = decoded; // Store bot identity from token
                    next();
                }
            );
        } catch (error: any) {
            Logger.error('MicrosoftTeamsAuthorization: Unexpected error during token validation.', error);
            const unauthException: UnauthorizedException = new UnauthorizedException('Authentication failed due to an unexpected error.');
            return OneUptimeResponse.sendErrorResponse(req, res, unauthException);
        }
    },
};

// If a class instance is preferred for some reason, it would be:
// class MicrosoftTeamsAuthorizationService {
//     public async isAuthorizedTeamsRequest(...) { /* ... */ }
// }
// export default new MicrosoftTeamsAuthorizationService();
// However, for middleware, exporting the function directly or an object with the method is more common.
// For direct use: export const isAuthorizedTeamsRequest = MicrosoftTeamsAuthorization.isAuthorizedTeamsRequest;
// Or if the class was not an object literal: export default MicrosoftTeamsAuthorization.isAuthorizedTeamsRequest
// For this case, the object MicrosoftTeamsAuthorization containing the static-like method is fine.

// To use in Express router:
// import { MicrosoftTeamsAuthorization } from './MicrosoftTeamsAuthorization';
// router.post('/msteams/events', MicrosoftTeamsAuthorization.isAuthorizedTeamsRequest, async (req, res) => { ... });
