export default {
    deduplicate: async (arr: $TSFixMe = []) => {
        const map: $TSFixMe = {};

        let curr: $TSFixMe;

        for (let i: $TSFixMe = 0; i < arr.length; i++) {
            curr = arr[i];

            if (!map[curr.identification]) {
                map[curr.identification] = curr;
            } else if (curr.error && !map[curr.identification].error) {
                map[curr.identification].error = true;
            }
        }
        return Object.values(map);
    },

    rearrangeDuty: async (main: $TSFixMe = []) => {
        let closeStringId: $TSFixMe;
        for (let i: $TSFixMe = 0; i < main.length; i++) {
            if (typeof main[i].schedule === 'object') {
                closeStringId = i - 1;
            }
        }

        if (typeof closeStringId === 'number') {
            main.push(main[closeStringId]);
            main.splice(closeStringId, 1);
        }
        return main;
    },

    checkCallSchedule: async (arr: $TSFixMe) => {
        const isAllFalse: $TSFixMe = arr.every((a: $TSFixMe) => {
            return !a.isOnDuty;
        });

        if (isAllFalse) {
            return arr[0] ? [arr[0]] : [];
        }

        return arr.filter((a: $TSFixMe) => {
            return a.isOnDuty;
        });
    },
};
