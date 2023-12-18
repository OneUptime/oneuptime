import ObjectID from 'Common/Types/ObjectID';
import {
    CategoryCheckboxOption,
    CheckboxCategory,
} from '../Components/CategoryCheckbox/CategoryCheckboxTypes';
import StatusPageResource from 'Model/Models/StatusPageResource';
import ModelAPI, { ListResult } from '../Utils/ModelAPI/ModelAPI';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import URL from 'Common/Types/API/URL';
import StatusPageGroup from 'Model/Models/StatusPageGroup';
import { CategoryCheckboxOptionsAndCategories } from '../Components/CategoryCheckbox/Index';



export default class StatusPageUtil {
    public static async getCategoryCheckboxPropsBasedOnResources(
        statusPageId: ObjectID, overrideRequestUrl?: URL
    ): Promise<CategoryCheckboxOptionsAndCategories> {
        const categories: Array<CheckboxCategory> = [];
        const options: Array<CategoryCheckboxOption> = [];

        let resources: Array<StatusPageResource> =
            await StatusPageUtil.getResources(statusPageId, overrideRequestUrl);

        let resourceGroups: Array<StatusPageGroup> = resources
            .map((resource: StatusPageResource) => {
                return resource.statusPageGroup;
            })
            .filter((group: StatusPageGroup | undefined) => {
                return Boolean(group);
            }) as Array<StatusPageGroup>;

        // now sort by order.

        resourceGroups = resourceGroups.sort(
            (a: StatusPageGroup, b: StatusPageGroup) => {
                return a.order! - b.order!;
            }
        );

        // add categories.

        resourceGroups.forEach((group: StatusPageGroup) => {
            //before we add make sure it doesn't already exist.

            if (
                categories.find((category: CheckboxCategory) => {
                    return category.id === group._id;
                })
            ) {
                return;
            }

            categories.push({
                id: group._id!,
                title: group.name!,
            });
        });

        // sort resources by order.

        resources = resources.sort(
            (a: StatusPageResource, b: StatusPageResource) => {
                return a.order! - b.order!;
            }
        );

        // add options.

        resources.forEach((resource: StatusPageResource) => {
            options.push({
                value: resource._id!,
                label: resource.displayName!,
                categoryId: resource.statusPageGroup?._id || '',
            });
        });

        return {
            categories,
            options,
        };
    }

    public static async getResources(
        statusPageId: ObjectID, overrideRequestUrl?: URL
    ): Promise<Array<StatusPageResource>> {

        const resources: ListResult<StatusPageResource> =
            await ModelAPI.getList<StatusPageResource>(
                StatusPageResource,
                {
                    statusPageId: statusPageId,
                },
                0,
                LIMIT_PER_PROJECT,
                {
                    _id: true,
                    displayName: true,
                    order: true,
                    statusPageGroup: {
                        _id: true,
                        name: true,
                        order: true,
                    },
                },
                {},
                overrideRequestUrl ? {
                    overrideRequestUrl: overrideRequestUrl,
                } : undefined
            );

        return resources.data;

    }
}
