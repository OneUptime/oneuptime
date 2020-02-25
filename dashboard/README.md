# Fyipe Dashboard

## Stack

- Reactjs - UI Library
- Redux - State managment
- Redux Forms - Forms


## Start

To run the app:

In development.
Consider adding PORT=3002 to a .env in the project root because razzle and express server and webpack dev server will use port 3000 and 3002 causing port conflict with the backend that usually runs on port 3002

```
 npm run dev
```

In production:

```
 npm start
```


## Puppeteer Tests

To run puppeteer tests for this repo, follow these steps:

- Start the backend server
- Start the accounts application
- Start the dashboard application
- Then run ```npm run test``` from your terminal