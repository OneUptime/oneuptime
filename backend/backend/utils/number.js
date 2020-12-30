const NumberFormatter = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

module.exports = {
    formatBalance: number => parseFloat(NumberFormatter.format(number)),
};
