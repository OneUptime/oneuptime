export default {
    generateRandomString: function (length: $TSFixMe): void {
        if (!length) {
            length = 10;
        }
        let result: $TSFixMe = '';
        const characters: $TSFixMe =
            'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        const charactersLength: $TSFixMe = characters.length;
        for (let i: $TSFixMe = 0; i < length; i++) {
            result += characters.charAt(
                Math.floor(Math.random() * charactersLength)
            );
        }
        return result;
    },

    generateBulkEmails: function (numberOfEmails = 10): void {
        let emails: $TSFixMe = '';
        for (let i: $TSFixMe = 0; i < numberOfEmails; i++) {
            emails += this.generateRandomString(10) + '@oneuptime.com,';
        }
        // remove the last comma
        emails = emails.slice(0, emails.length - 1);
        return emails;
    },

    generateRandomDigits: function (): void {
        return Math.random().toString().slice(2, 11);
    },
};
