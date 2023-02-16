
import Express, {
    ExpressRouter,
} from 'CommonServer/Utils/Express';
import Components from "CommonServer/Types/Workflow/Components/Index";
import ComponentCode, { ExecuteWorkflowType } from 'CommonServer/Types/Workflow/ComponentCode';
import QueueWorkflow from '../Services/QueueWorkflow';
import { JSONArray, JSONObject } from 'Common/Types/JSON';
import OneUptimeDate from 'Common/Types/Date';

export default class RunAPI {
    public router!: ExpressRouter;

    private logs: Array<string> = [];

    public constructor() {
        this.router = Express.getRouter();

        // init all component code. 
        /// Get all the components. 
        for (const key in Components) {
            const ComponentCodeItem: typeof ComponentCode | undefined = Components[key];
            if (ComponentCodeItem) {
                const instance = new ComponentCodeItem();
                instance.init({
                    router: this.router,
                    scheduleWorkflow: this.scheduleWorkflow,
                    executeWorkflow: this.executeWorkflow
                });
            }
        }
    }

    public log(data: string | JSONObject | JSONArray){
        if(typeof data === "string"){
            this.logs.push(OneUptimeDate.getCurrentDateAsFormattedString()+":"+data);
        }else{
            this.logs.push(OneUptimeDate.getCurrentDateAsFormattedString()+":"+JSON.stringify(data));
        }
    }
    

    public async scheduleWorkflow(executeWorkflow: ExecuteWorkflowType, scheduleAt: string) {
        /// add to queue. 
        await QueueWorkflow.addWorkflowToQueue(executeWorkflow, scheduleAt); 
    }

    public async executeWorkflow(executeWorkflow: ExecuteWorkflowType) {
        // add to queue.
        await QueueWorkflow.addWorkflowToQueue(executeWorkflow); 
    }
}
