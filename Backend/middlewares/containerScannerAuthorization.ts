import ContainerScannerService from '../Services/containerScannerService';
import { sendErrorResponse } from 'CommonServer/Utils/Response';
import BadDataException from 'Common/Types/Exception/BadDataException';
import {
    ExpressResponse,
    ExpressRequest,
    NextFunction,
} from 'CommonServer/Utils/Express';
const CLUSTER_KEY: $TSFixMe = process.env['CLUSTER_KEY'];
export default {
    isAuthorizedContainerScanner: async function (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): void {
        let containerScannerKey: $TSFixMe,
            containerScannerName: $TSFixMe,
            clusterKey: $TSFixMe,
            containerScannerVersion: $TSFixMe;

        if (req.params && req.params.containerscannerkey) {
            containerScannerKey = req.params.containerscannerkey;
        } else if (req.query && req.query.containerScannerKey) {
            containerScannerKey = req.query.containerscannerkey;
        } else if (req.headers && req.headers['containerscannerkey']) {
            containerScannerKey = req.headers['containerscannerkey'];
        } else if (req.body && req.body.containerScannerKey) {
            containerScannerKey = req.body.containerScannerKey;
        } else {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('containerScanner Key not found.')
            );
        }

        if (req.params && req.params.containerscannername) {
            containerScannerName = req.params.containerscannername;
        } else if (req.query && req.query.containerscannername) {
            containerScannerName = req.query.containerscannername;
        } else if (req.headers && req.headers['containerscannername']) {
            containerScannerName = req.headers['containerscannername'];
        } else if (req.body && req.body.containerscannerName) {
            containerScannerName = req.body.containerscannername;
        } else {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('containerScanner Name not found.')
            );
        }

        if (req.params && req.params['clusterKey']) {
            clusterKey = req.params['clusterKey'];
        } else if (req.query && req.query['clusterKey']) {
            clusterKey = req.query['clusterKey'];
        } else if (
            req.headers &&
            (req.headers['clusterKey'] || req.headers['clusterkey'])
        ) {
            clusterKey = req.headers['clusterKey'] || req.headers['clusterkey'];
        } else if (req.body && req.body.clusterKey) {
            clusterKey = req.body.clusterKey;
        }

        if (req.params && req.params.containerscannerversion) {
            containerScannerVersion = req.params.containerscannerversion;
        } else if (req.query && req.query.containerscannerversion) {
            containerScannerVersion = req.query.containerscannerversion;
        } else if (req.headers && req.headers['containerscannerversion']) {
            containerScannerVersion = req.headers['containerscannerversion'];
        } else if (req.body && req.body.containerscannerversion) {
            containerScannerVersion = req.body.containerscannerversion;
        }

        let containerScanner: $TSFixMe = null;

        if (clusterKey && clusterKey === CLUSTER_KEY) {
            // if cluster key matches then just query by containerScanner name,
            // because if the containerScanner key does not match, we can update containerScanner key later
            // without updating mongodb database manually.
            containerScanner = await ContainerScannerService.findOneBy({
                containerScannerName,
            });
        } else {
            containerScanner = await ContainerScannerService.findOneBy({
                containerScannerKey,
                containerScannerName,
            });
        }

        if (!containerScanner && (!clusterKey || clusterKey !== CLUSTER_KEY)) {
            return sendErrorResponse(req, res, {
                code: 400,
                message:
                    'containerScanner key and containerScanner name do not match.',
            });
        }

        if (!containerScanner) {
            //create a new containerScanner.
            containerScanner = await ContainerScannerService.create({
                containerScannerKey,
                containerScannerName,
                containerScannerVersion,
            });
        }

        if (containerScanner.containerScannerKey !== containerScannerKey) {
            //update containerScanner key becasue it does not match.
            await ContainerScannerService.updateOneBy(
                {
                    containerScannerName,
                },
                { containerScannerKey }
            );
        }
        req.containerScanner = {};
        req.containerScanner.id = containerScanner._id;

        const [containerScannerValue]: $TSFixMe = await Promise.all([
            ContainerScannerService.findOneBy({
                containerScannerKey,
                containerScannerName,
            }),
            ContainerScannerService.updateContainerScannerStatus(
                containerScanner._id
            ),
        ]);

        if (
            !containerScannerValue.version ||
            containerScannerValue.version !== containerScannerVersion
        ) {
            await ContainerScannerService.updateOneBy(
                {
                    containerScannerName,
                },
                { version: containerScannerVersion }
            );
        }

        return next();
    },
};
