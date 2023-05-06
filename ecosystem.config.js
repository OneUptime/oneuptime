const apps = ["Accounts", "Dashboard", "Alert", "APIReference"];

module.exports = {
  apps : [apps.map((app) =>{
    return {
    name   : `${app}`,
    script : `${app}/Index.ts`
    }
  })]
}
