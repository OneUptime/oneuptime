import TableColumnType from "./TableColumnType";

export default interface Column { 
    title: string; 
    disbaleSort?: boolean;
    type: TableColumnType;
    key: string
}