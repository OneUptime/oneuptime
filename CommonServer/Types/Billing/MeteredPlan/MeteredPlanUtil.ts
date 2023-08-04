import MeteredPlan from 'Common/Types/Billing/MeteredPlan';
import BadDataException from 'Common/Types/Exception/BadDataException';
import { JSONObject } from 'Common/Types/JSON';

export default class MeteredPlanUtil {
    public static getMeteredPlan(
        name: string,
        env?: JSONObject | undefined
    ): MeteredPlan {
        if ((env || process.env)['METERED_PLAN_' + name]) {
            const content: string =
                ((env || process.env)['METERED_PLAN_' + name] as string) || '';
            const values: Array<string> = content.split(',');
            console.log('values', values);
            if (values.length > 0) {
                return new MeteredPlan(
                    values[0] as string,
                    parseInt(values[1] as string),
                    values[2] as string
                );
            }
        }

        throw new BadDataException('Plan with name ' + name + ' not found');
    }
}
