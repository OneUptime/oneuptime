import ObjectID from 'Common/Types/ObjectID';
import PageComponentProps from '../PageComponentProps';
import { CategoryCheckboxOption, CheckboxCategory } from 'CommonUI/src/Components/CategoryCheckbox/CategoryCheckboxTypes';
import StatusPageResource from 'Model/Models/StatusPageResource';
import ModelAPI, { ListResult } from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import URL from 'Common/Types/API/URL';
import { STATUS_PAGE_API_URL } from '../../Utils/Config';
import StatusPageGroup from 'Model/Models/StatusPageGroup';
import { CategoryCheckboxOptionsAndCategories } from 'CommonUI/src/Components/CategoryCheckbox/Index';

export interface SubscribePageProps extends PageComponentProps {
    enableEmailSubscribers: boolean;
    enableSMSSubscribers: boolean;
}

export default class SubscriberUtils {
    public static async getCategoryCheckboxPropsBasedOnResources(statusPageId: ObjectID): Promise<CategoryCheckboxOptionsAndCategories> {
        const categories: Array<CheckboxCategory> = [];
        const options: Array<CategoryCheckboxOption> = [];

        let resources: Array<StatusPageResource> = await SubscriberUtils.getResources(statusPageId);

        let resourceGroups: Array<StatusPageGroup> = resources
            .map((resource: StatusPageResource) => resource.statusPageGroup)
            .filter((group: StatusPageGroup | undefined) => Boolean(group)) as Array<StatusPageGroup>;

            // now sort by order. 

        resourceGroups = resourceGroups.sort((a: StatusPageGroup, b: StatusPageGroup) => {
            return a.order! - b.order!;
        });

        // add categories. 

        resourceGroups.forEach((group: StatusPageGroup) => {
            categories.push({
                id: group._id!,
                title: group.name!,
            });
        });

        // sort resources by order. 

        resources = resources.sort((a: StatusPageResource, b: StatusPageResource) => {
            return a.order! - b.order!;
        });

        // add options.

        resources.forEach((resource: StatusPageResource) => {
            options.push({
                value: resource._id!,
                label: resource.displayName!,
                categoryId: resource.statusPageGroup?._id!,
            });
        });

        return {
            categories,
            options
        };
    }


    public static async getResources(statusPageId: ObjectID): Promise<Array<StatusPageResource>> {
        const resources: ListResult<StatusPageResource> = await ModelAPI.getList<StatusPageResource>(StatusPageResource, {}, 0, LIMIT_PER_PROJECT, {}, {}, {
            overrideRequestUrl: URL.fromString(
                STATUS_PAGE_API_URL.toString()
            ).addRoute(`/resources/${statusPageId.toString()}`)
        });

        return resources.data;
    }
}
