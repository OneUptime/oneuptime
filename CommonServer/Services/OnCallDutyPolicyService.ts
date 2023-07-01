import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import DatabaseService from './DatabaseService';
import ObjectID from 'Common/Types/ObjectID';
import OnCallDutyPolicyExecutionLog from 'Model/Models/OnCallDutyPolicyExecutionLog';
import OnCallDutyPolicy from 'Model/Models/OnCallDutyPolicy';
import BadDataException from 'Common/Types/Exception/BadDataException';
import OnCallDutyPolicyExecutionLogService from './OnCallDutyPolicyExecutionLogService';

export class Service extends DatabaseService<OnCallDutyPolicy> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(OnCallDutyPolicy, postgresDatabase);
    }

    public async executePolicy(
        policyId: ObjectID,
        options: {
            triggeredByIncidentId: ObjectID;
        }
    ): Promise<void> {
        // execute this policy

        const policy: OnCallDutyPolicy | null = await this.findOneById({
            id: policyId,
            select: {
                _id: true,
                projectId: true,
            },
            props: {
                isRoot: true,
            },
        });

        if (!policy) {
            throw new BadDataException(
                `On Call Duty Policy with id ${policyId.toString()} not found`
            );
        }

        // add policy log.
        const log: OnCallDutyPolicyExecutionLog =
            new OnCallDutyPolicyExecutionLog();

        log.projectId = policy.projectId!;
        log.onCallDutyPolicyId = policyId;
        log.triggeredByIncidentId = options.triggeredByIncidentId;

        await OnCallDutyPolicyExecutionLogService.create({
            data: log,
            props: {
                isRoot: true,
            },
        });
    }
}
export default new Service();
