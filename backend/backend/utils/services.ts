export default {
    deduplicate: async (arr = []) => {
        const map = {};

        let curr;

        for (let i = 0; i < arr.length; i++) {
            curr = arr[i];

            // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
            if (!map[curr.identification]) {
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                map[curr.identification] = curr;
            } else {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'error' does not exist on type 'never'.
                if (curr.error && !map[curr.identification].error) {
                    // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                    map[curr.identification].error = true;
                }
            }
        }
        return Object.values(map);
    },

    rearrangeDuty: async (main = []) => {
        let closeStringId;
        for (let i = 0; i < main.length; i++) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'schedule' does not exist on type 'never'... Remove this comment to see the full error message
            if (typeof main[i].schedule == 'object') {
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
        const isAllFalse = arr.every((a: $TSFixMe) => !a.isOnDuty);

        if (isAllFalse) return arr[0] ? [arr[0]] : [];

        return arr.filter((a: $TSFixMe) => a.isOnDuty);
    },
};
