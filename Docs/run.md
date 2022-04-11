# Running OneUptime

## Running this project in local environment

-   Watch https://youtu.be/erAxgSMkW58
-   You can run Enterprise mode by `npm run dev`. Enterprise runs OneUptime service without Stripe card payments.
-   You can run SaaS Mode by `npm run saas-dev`. SaaS mode will enable card payments by stripe.
-   You can run a parcular service by passing --service flag. For example `npm run dev --service="backend"` or multiple services by `npm run dev --service="backend accounts"`.

## Running on: on-prem, staging, or production.

-   We run this by using helm charts, please check `README.md` in the `HelmChart` folder.
