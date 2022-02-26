const NumberFormatter = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

export default {
    formatBalance: (number: $TSFixMe) => parseFloat(NumberFormatter.format(number)),
};
