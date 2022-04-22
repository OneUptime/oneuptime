import SortOrder from './SortOrder';

export interface SortItem {
    [field: string]: SortOrder;
}

export default interface Sort extends Array<SortItem> {}
