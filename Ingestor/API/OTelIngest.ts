import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
    NextFunction,
} from 'CommonServer/Utils/Express';
import Response from 'CommonServer/Utils/Response';
import logger from 'CommonServer/Utils/Logger';
import protobuf from 'protobufjs';
import zlib from 'zlib';
// Load proto file for OTel

// Create a root namespace
const LogsProto = protobuf.loadSync('/usr/src/app/ProtoFiles/Otel/v1/logs.proto');
const TracesProto = protobuf.loadSync('/usr/src/app/ProtoFiles/Otel/v1/traces.proto');
const MetricsProto = protobuf.loadSync('/usr/src/app/ProtoFiles/Otel/v1/metrics.proto');


// Lookup the message type
const LogsData = LogsProto.lookupType('LogsData');
const TracesData = TracesProto.lookupType('TracesData');
const MetricsData = MetricsProto.lookupType('MetricsData');

const router: ExpressRouter = Express.getRouter();

router.post(
    '/otel/*',
    async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): Promise<void> => {
        try {

            let buffers: any = [];
            req.on('data', (chunk) => {
                buffers.push(chunk);
            });


            req.on('end', () => {
                let buffer = Buffer.concat(buffers);
                zlib.gunzip(buffer, (err, decoded) => {
                    if (err) {
                        console.error(err);
                        res.status(500).send('Error decompressing data');
                        return;
                    }


                    if (req.url === '/otel/v1/traces') {
                        const traces = TracesData.decode(decoded);
        
                        logger.info('Traces: ', traces);
                    }
        
                    if (req.url === '/otel/v1/logs') {
                        const logs = LogsData.decode(decoded);
        
                        logger.info('Logs: ', logs);
                    }
        
                    if (req.url === '/otel/v1/metrics') {
                        const metrics = MetricsData.decode(decoded);
        
                        logger.info('Metrics: ', metrics);
                    }
        
                    // middleware marks the probe as alive.
                    // so we don't need to do anything here.
                    return Response.sendEmptyResponse(req, res);
        
                    
                });
            });

            logger.info('OTelIngest URL: ', req.url);

            
        } catch (err) {
            return next(err);
        }
    }
);

export default router;
