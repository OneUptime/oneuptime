import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
} from 'CommonServer/Utils/Express';
import Response from 'CommonServer/Utils/Response';
import ObjectID from 'Common/Types/ObjectID';
import BadDataException from 'Common/Types/Exception/BadDataException';
import WorkflowService from 'CommonServer/Services/WorkflowService';
import Workflow from 'Model/Models/Workflow';
import ClusterKeyAuthorization from 'CommonServer/Middleware/ClusterKeyAuthorization';
import ComponentCode from 'CommonServer/Types/Workflow/ComponentCode';
import Components from 'CommonServer/Types/Workflow/Components/Index';

export default class WorkflowAPI {
    public router!: ExpressRouter;

    public constructor() {
        this.router = Express.getRouter();

        this.router.get(`/update/:workflowId`, ClusterKeyAuthorization.isAuthorizedServiceMiddleware,  this.updateWorkflow);

        this.router.post(`/update/:workflowId`, ClusterKeyAuthorization.isAuthorizedServiceMiddleware, this.updateWorkflow);
    }

    public async updateWorkflow(
        req: ExpressRequest,
        res: ExpressResponse
    ): Promise<void> {
        // add this workflow to the run queue and return the 200 response.

        if (!req.params['workflowId']) {
            return Response.sendErrorResponse(
                req,
                res,
                new BadDataException('workflowId not found in URL')
            );
        }

        const workflow: Workflow | null = await WorkflowService.findOneById({
            id: new ObjectID(req.params['workflowId']),
            select: {
                _id: true,
                triggerId: true,
            },
            props: {
                isRoot: true,
            }
        });

        if(!workflow){
            return Response.sendJsonObjectResponse(req, res, {
                status: 'Workflow not found',
            });
        }


        const componentCode: ComponentCode | undefined = Components[workflow.triggerId as string];

        if(!componentCode){
            return Response.sendJsonObjectResponse(req, res, {
                status: 'Component not found',
            });
        }

        await componentCode.update({
            workflowId: workflow.id!
        });
        
        return Response.sendJsonObjectResponse(req, res, {
            status: 'Updated',
        });
    }
}
