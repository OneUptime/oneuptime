const NumberFormatter: $TSFixMe = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

export default {
    formatBalance: (number: $TSFixMe) => {
        return parseFloat(NumberFormatter.format(number));
    },
};
