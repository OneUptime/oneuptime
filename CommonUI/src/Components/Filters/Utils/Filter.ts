import GenericObject from "Common/Types/GenericObject";
import Filter from "../Types/Filter";
import FilterData from "../Types/FilterData";
import FieldType from "../../Types/FieldType";
import Search from "Common/Types/BaseDatabase/Search";


export default class FilterUtil {
    public static translateFilterToText<T extends GenericObject>(data: {
        filters: Array<Filter<T>>;
        filterData: FilterData<T>;
    }): Array<string> {

        const filterTexts: Array<string | null> = [];

        for (const filter of data.filters) {
            filterTexts.push(this.translateFilterItemToText({
                filter: filter,
                filterData: data.filterData
            }))
        }

        return filterTexts.filter((filterText) => filterText !== null) as Array<string>;
    }


    public static translateFilterItemToText<T extends GenericObject>(data: {
        filter: Filter<T>;
        filterData: FilterData<T>;
    }): null | string {
        let filterText = '';

        if (!data.filter.key) {
            return null;
        }

        if (data.filter.type === FieldType.Boolean) {
            filterText = `${data.filter.title} is ${data.filterData[data.filter.key] ? 'Yes' : 'No'}`;
            return filterText;
        }

        if (data.filter.type === FieldType.Text || data.filter.type === FieldType.Number || data.filter.type === FieldType.Email || data.filter.type === FieldType.Phone || data.filter.type === FieldType.URL || data.filter.type === FieldType.Hostname) {

            const key = data.filter.key;

            if ((data.filterData)[key] && data.filterData[key] instanceof Search) {
                filterText = `${data.filter.title} contains ${data.filterData[data.filter.key]?.toString()}`;
            } else if ((data.filterData)[key]) {
                filterText = `${data.filter.title} is ${data.filterData[data.filter.key]?.toString()}`;
            }
            return filterText;
        }

        return filterText;
    }
}