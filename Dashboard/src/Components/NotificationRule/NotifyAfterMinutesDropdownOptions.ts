import { DropdownOption } from 'CommonUI/src/Components/Dropdown/Dropdown';

const NotifyAfterMinutesDropdownOptions: Array<DropdownOption> = [
    {
        value: 0,
        label: 'Immediately',
    },
    {
        value: 5,
        label: '5 minutes',
    },
    {
        value: 10,
        label: '10 minutes',
    },
    {
        value: 15,
        label: '15 minutes',
    },
    {
        value: 30,
        label: '30 minutes',
    },
    {
        value: 60,
        label: '1 hour',
    },
];

export default NotifyAfterMinutesDropdownOptions;
