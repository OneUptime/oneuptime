import { DropdownOption } from "CommonUI/src/Components/Dropdown/Dropdown";

const MonitoringIntrerval: Array<DropdownOption> = [
    {
        value: "* * * * *",
        label: "Every Minute"
    },
    {
        value: "*/5 * * * *",
        label: "Every 5 Minutes"
    },
    {
        value: "*/10 * * * *",
        label: "Every 10 Minutes"
    },
    {
        value: "*/15 * * * *",
        label: "Every 15 Minutes"
    },
    {
        value: "*/30 * * * *",
        label: "Every 30 Minutes"
    },
    {
        value: "0 * * * *",
        label: "Every Hour"
    },
    {
        value: "0 0 * * *",
        label: "Every Day"
    },
    {
        value: "0 0 * * 0",
        label: "Every Week"
    },
];


export default MonitoringIntrerval;