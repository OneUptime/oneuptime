const NumberFormatter = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

export default {
    formatBalance: number => parseFloat(NumberFormatter.format(number)),
};
