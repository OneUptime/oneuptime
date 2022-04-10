const createProgressReporter = require('./createProgressReporter')
const progress = createProgressReporter({ hookExit: true })
module.exports = progress.eslintPlugin
