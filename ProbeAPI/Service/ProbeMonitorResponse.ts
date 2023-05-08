import BadDataException from 'Common/Types/Exception/BadDataException';
import { CheckOn, CriteriaFilter, FilterType } from 'Common/Types/Monitor/CriteriaFilter';
import MonitorCriteria from 'Common/Types/Monitor/MonitorCriteria';
import MonitorCriteriaInstance from 'Common/Types/Monitor/MonitorCriteriaInstance';
import MonitorStep from 'Common/Types/Monitor/MonitorStep';
import MonitorSteps from 'Common/Types/Monitor/MonitorSteps';
import ProbeApiIngestResponse from 'Common/Types/Probe/ProbeApiIngestResponse';
import ProbeMonitorResponse from 'Common/Types/Probe/ProbeMonitorResponse';
import Typeof from 'Common/Types/Typeof';
import MonitorService from 'CommonServer/Services/MonitorService';
import logger from 'CommonServer/Utils/Logger';
import Monitor from 'Model/Models/Monitor';

export default class ProbeMonitorResponseService {
    public static async processProbeResponse(
        probeMonitorResponse: ProbeMonitorResponse
    ): Promise<ProbeApiIngestResponse> {
    
        let response: ProbeApiIngestResponse = {
            monitorId: probeMonitorResponse.monitorId,
        }
       
        // fetch monitor

        const monitor: Monitor | null = await MonitorService.findOneById({
            id: probeMonitorResponse.monitorId,
            select: {
                monitorSteps: true,
                monitorType: true,
            },
            props: {
                isRoot: true,
            },
        });

        if (!monitor) {
            throw new BadDataException('Monitor not found');
        }

        // save data to Clickhouse.


        const monitorSteps: MonitorSteps = monitor.monitorSteps!;

        if(!monitorSteps.data?.monitorStepsInstanceArray) {
            // no steps, ignore everything. This happens when the monitor is updated shortly after the probing attempt.
            return response; 
        }

        const monitorStep = monitorSteps.data.monitorStepsInstanceArray.find((monitorStep) => {
            return monitorStep.id === probeMonitorResponse.monitorStepId;
        });

        if(!monitorStep) {
            // no steps, ignore everything. This happens when the monitor is updated shortly after the probing attempt.
            return response; 
        }

        // now process the monitor step

        response.ingestedMonitorStepId = monitorStep.id;

        //find next monitor step after this one. 
        const nextMonitorStepIndex: number = monitorSteps.data.monitorStepsInstanceArray.findIndex((step: MonitorStep) => {
            return step.id === monitorStep.id;
        });

        response.nextMonitorStepId = monitorSteps.data.monitorStepsInstanceArray[nextMonitorStepIndex + 1]?.id;        

        // now process probe response monitors

        response = await this.processMonitorStep({
            probeMonitorResponse: probeMonitorResponse, monitorStep: monitorStep, monitor: monitor, probeApiIngestResponse: response}
            );

        return response;
        
    }


    private static async processMonitorStep(input: { probeMonitorResponse: ProbeMonitorResponse; monitorStep: MonitorStep; monitor: Monitor; probeApiIngestResponse: ProbeApiIngestResponse; }): Promise<ProbeApiIngestResponse> {

        // process monitor step here.

        const criteria: MonitorCriteria | undefined = input.monitorStep.data?.monitorCriteria;

        if(!criteria || !criteria.data) {
            // do nothing as there's no criteria to process.
            return input.probeApiIngestResponse;
        }

        for(const criteriaInstance of criteria.data.monitorCriteriaInstanceArray) {
            await this.processMonitorCriteiaInstance({
                probeMonitorResponse: input.probeMonitorResponse, monitorStep: input.monitorStep, monitor: input.monitor, probeApiIngestResponse: input.probeApiIngestResponse, criteriaInstance: criteriaInstance
            });
        }

        return input.probeApiIngestResponse;
    }


    private static async processMonitorCriteiaInstance(input: { probeMonitorResponse: ProbeMonitorResponse; monitorStep: MonitorStep; monitor: Monitor; probeApiIngestResponse: ProbeApiIngestResponse; criteriaInstance: MonitorCriteriaInstance }): Promise<ProbeApiIngestResponse> {
        
        // process monitor criteria instance here.


        
        // do nothing as there's no criteria to process.
        return input.probeApiIngestResponse;
    }

    private static async isMonitorInstanceCriteriaFiltersMet(input: { probeMonitorResponse: ProbeMonitorResponse; monitorStep: MonitorStep; monitor: Monitor; probeApiIngestResponse: ProbeApiIngestResponse; criteriaInstance: MonitorCriteriaInstance }): Promise<boolean> {
        for(const criteriaFilter of input.criteriaInstance.data?.filters || []) {
            if(!await this.isMonitorInstanceCriteriaFilterMet({probeMonitorResponse: input.probeMonitorResponse, monitorStep: input.monitorStep, monitor: input.monitor, probeApiIngestResponse: input.probeApiIngestResponse, criteriaInstance: input.criteriaInstance, criteriaFilter: criteriaFilter})) {
                return false;
            }
        }

        return false; 
    }

    private static async isMonitorInstanceCriteriaFilterMet(input: { probeMonitorResponse: ProbeMonitorResponse; monitorStep: MonitorStep; monitor: Monitor; probeApiIngestResponse: ProbeApiIngestResponse; criteriaInstance: MonitorCriteriaInstance; criteriaFilter: CriteriaFilter }): Promise<boolean> {
        
        // process monitor criteria filter here.
        let value: number | string | undefined = input.criteriaFilter.value;
        //check is online filter
        if(input.criteriaFilter.checkOn === CheckOn.IsOnline && input.criteriaFilter.filterType === FilterType.True){
            if(input.probeMonitorResponse.isOnline){
                return true;
            }else{
                return false;
            }
        }


        // check response time filter
        if(input.criteriaFilter.checkOn === CheckOn.ResponseTime){
            
            if(!value){
                return false
            }

            if(typeof value === Typeof.String){
                try{
                    value = parseInt(value as string);
                }catch(err){
                    logger.error(err);
                    return false;
                }
            }


            if(typeof value !== Typeof.Number){
                return false;
            }

            if(input.criteriaFilter.filterType === FilterType.GreaterThan){
                if(input.probeMonitorResponse.responseTimeInMs && input.probeMonitorResponse.responseTimeInMs > (input.criteriaFilter.value as number)){
                    return true;
                }else{
                    return false;
                }
            } 

            if(input.criteriaFilter.filterType === FilterType.LessThan){
                if(input.probeMonitorResponse.responseTimeInMs && input.probeMonitorResponse.responseTimeInMs < (input.criteriaFilter.value as number)){
                    return true;
                }else{
                    return false;
                }
            }

            if(input.criteriaFilter.filterType === FilterType.EqualTo){
                if(input.probeMonitorResponse.responseTimeInMs && input.probeMonitorResponse.responseTimeInMs === (input.criteriaFilter.value as number)){
                    return true;
                }else{
                    return false;
                }
            }

            if(input.criteriaFilter.filterType === FilterType.NotEqualTo){
                if(input.probeMonitorResponse.responseTimeInMs && input.probeMonitorResponse.responseTimeInMs !== (input.criteriaFilter.value as number)){
                    return true;
                }else{
                    return false;
                }
            }

            if(input.criteriaFilter.filterType === FilterType.GreaterThanOrEqualTo){
                if(input.probeMonitorResponse.responseTimeInMs && input.probeMonitorResponse.responseTimeInMs >= (input.criteriaFilter.value as number)){
                    return true;
                }else{
                    return false;
                }
            }

            if(input.criteriaFilter.filterType === FilterType.LessThanOrEqualTo){
                if(input.probeMonitorResponse.responseTimeInMs && input.probeMonitorResponse.responseTimeInMs <= (input.criteriaFilter.value as number)){
                    return true;
                }else{
                    return false;
                }
            }
        }



        //check reponse code
        if(input.criteriaFilter.checkOn === CheckOn.ResponseCode){
            if(!value){
                return false
            }

            if(typeof value === Typeof.String){
                try{
                    value = parseInt(value as string);
                }catch(err){
                    logger.error(err);
                    return false;
                }
            }


            if(typeof value !== Typeof.Number){
                return false;
            }

            if(input.criteriaFilter.filterType === FilterType.GreaterThan){
                if(input.probeMonitorResponse.responseCode && input.probeMonitorResponse.responseCode > (input.criteriaFilter.value as number)){
                    return true;
                }else{
                    return false;
                }
            } 

            if(input.criteriaFilter.filterType === FilterType.LessThan){
                if(input.probeMonitorResponse.responseCode && input.probeMonitorResponse.responseCode < (input.criteriaFilter.value as number)){
                    return true;
                }else{
                    return false;
                }
            }

            if(input.criteriaFilter.filterType === FilterType.EqualTo){
                if(input.probeMonitorResponse.responseCode && input.probeMonitorResponse.responseCode === (input.criteriaFilter.value as number)){
                    return true;
                }else{
                    return false;
                }
            }

            if(input.criteriaFilter.filterType === FilterType.NotEqualTo){
                if(input.probeMonitorResponse.responseCode && input.probeMonitorResponse.responseCode !== (input.criteriaFilter.value as number)){
                    return true;
                }else{
                    return false;
                }
            }

            if(input.criteriaFilter.filterType === FilterType.GreaterThanOrEqualTo){
                if(input.probeMonitorResponse.responseCode && input.probeMonitorResponse.responseCode >= (input.criteriaFilter.value as number)){
                    return true;
                }else{
                    return false;
                }
            }

            if(input.criteriaFilter.filterType === FilterType.LessThanOrEqualTo){
                if(input.probeMonitorResponse.responseCode && input.probeMonitorResponse.responseCode <= (input.criteriaFilter.value as number)){
                    return true;
                }else{
                    return false;
                }
            }
        }

        if(input.criteriaFilter.checkOn === CheckOn.ResponseBody){
            
        }




        return false;


    }
}
