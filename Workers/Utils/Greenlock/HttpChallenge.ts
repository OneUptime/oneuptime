import GreenlockChallenge from 'Model/Models/GreenlockChallenge';
import GreenlockChallengeService from 'CommonServer/Services/GreenlockChallengeService';
import logger from 'CommonServer/Utils/Logger';

// because greenlock package expects module.exports.
module.exports = {
    init: async (): Promise<null> => {
        logger.info("Greenlock HTTP Challenge Init");
        return Promise.resolve(null);
    },

    set: async (data: any): Promise<null> => {
        logger.info("Greenlock HTTP Challenge Set");
        logger.info(data);

        const ch: any = data.challenge;
        const key: string = ch.identifier.value + '#' + ch.token;

        let challenge: GreenlockChallenge | null =
            await GreenlockChallengeService.findOneBy({
                query: {
                    key: key,
                },
                select: {
                    _id: true,
                },
                props: {
                    isRoot: true,
                    ignoreHooks: true,
                },
            });

        if (!challenge) {
            challenge = new GreenlockChallenge();
            challenge.key = key;
            challenge.challenge = ch.keyAuthorization;

            await GreenlockChallengeService.create({
                data: challenge,
                props: {
                    isRoot: true,
                },
            });
        } else {
            challenge.challenge = ch.keyAuthorization;
            await GreenlockChallengeService.updateOneById({
                id: challenge.id!,
                data: challenge,
                props: {
                    isRoot: true,
                },
            });
        }

        //
        return null;
    },

    get: async (data: any): Promise<null | any> => {

        logger.info("Greenlock HTTP Challenge Get");
        logger.info(data);

        const ch: any = data.challenge;
        const key: string = ch.identifier.value + '#' + ch.token;

        const challenge: GreenlockChallenge | null =
            await GreenlockChallengeService.findOneBy({
                query: {
                    key: key,
                },
                select: {
                    _id: true,
                },
                props: {
                    isRoot: true,
                    ignoreHooks: true,
                },
            });

        if (!challenge) {
            return null;
        }

        return { keyAuthorization: challenge.challenge };
    },

    remove: async (data: any): Promise<null> => {
        logger.info("Greenlock HTTP Challenge Remove");
        logger.info(data);

        const ch: any = data.challenge;
        const key: string = ch.identifier.value + '#' + ch.token;
        await GreenlockChallengeService.deleteOneBy({
            query: {
                key: key,
            },
            props: {
                isRoot: true,
                ignoreHooks: true,
            },
        });

        return null;
    },
};
