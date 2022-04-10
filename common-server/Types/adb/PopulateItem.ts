import Select from './Select';

export default interface PopulateItem {
    path: string;
    select: Select;
    populate: Array<PopulateItem>;
}
