module.exports = {
  smokeTest: () => {
    const faker = require('faker')
    const puppeteer = require('puppeteer')

    const user = {
      name: faker.name.findName(),
      email: faker.internet.email(),
      website: 'www.testcompanyfyipe.com',
      company: faker.company.companyName(),
      companySize: 8,
      message: faker.company.catchPhraseDescriptor(),
    }

    let page
    let browser
    const baseURL = 'http://localhost:1444'

    // Enable for live viewing of tests.
    /* beforeAll(async () => {
      const width = 1200
      const height = 720
      browser = await puppeteer.launch(
        {
          headless: false,
          slowMo: 60,
          arg: [`--window-size=${width},${height}`],
        },
      )
      page = await browser.newPage()
      await page.setViewport({ width, height })
    }) */

    // Run this for headless testing with puppeteer.
    beforeAll(async () => {
      browser = await puppeteer.launch()
      page = await browser.newPage()
    })

    afterAll(() => {
      browser.close()
    })

    describe('Request demo', () => {
      test('user can submit request a demo form', async () => {
        await page.goto(`${baseURL}/enterprise/demo`)
        await page.waitForSelector('#form-section')
        await page.type('#fullname', user.name)
        await page.type('#email', user.email)
        await page.type('#website', user.website)
        await page.click('#country')
        await page.keyboard.press('ArrowDown')
        await page.keyboard.down('Enter')
        await page.click('#volume')
        await page.keyboard.press('ArrowDown')
        await page.keyboard.down('Enter')
        await page.type('#message', user.message)
        await page.click('#request-demo-btn')
        await page.waitForSelector('#success')
        // Check if user's email is submitted successfully
        const emailSubmitted = await page.evaluate(() => document.querySelector('.submitted-email').innerText)
        expect(emailSubmitted).toBe(user.email)
      }, 30000)
      test('user can request for website monitoring resource', async () => {
        await page.goto(`${baseURL}/enterprise/resources`)
        await page.waitForSelector('#website-monitoring')
        await Promise.all([
          page.waitForNavigation(),
          page.click('#website-monitoring'),
        ])
        await page.waitForSelector('#form-section')
        await page.type('#fullname', user.name)
        await page.type('#email', user.email)
        await page.type('#website', user.website)
        await page.click('#country')
        await page.keyboard.press('ArrowDown')
        await page.keyboard.down('Enter')
        await page.click('#volume')
        await page.keyboard.press('ArrowDown')
        await page.keyboard.down('Enter')
        await page.click('#request-resource-btn')
        // Check if user's email is submitted successfully
        const emailSubmitted = await page.evaluate(() => document.querySelector('.submitted-email').innerText)
        expect(emailSubmitted).toBe(user.email)
      }, 30000)
      test('user can request for speed equals revenue resource', async () => {
        await page.goto(`${baseURL}/enterprise/resources`)
        await page.waitForSelector('#speed-revenue')
        await Promise.all([
          page.waitForNavigation(),
          page.click('#speed-revenue'),
        ])
        await page.waitForSelector('#form-section')
        await page.type('#fullname', user.name)
        await page.type('#email', user.email)
        await page.type('#website', user.website)
        await page.click('#country')
        await page.keyboard.press('ArrowDown')
        await page.keyboard.down('Enter')
        await page.click('#volume')
        await page.keyboard.press('ArrowDown')
        await page.keyboard.down('Enter')
        await page.click('#request-resource-btn')
        // Check if user's email is submitted successfully
        const emailSubmitted = await page.evaluate(() => document.querySelector('.submitted-email').innerText)
        expect(emailSubmitted).toBe(user.email)
      }, 30000)
      test('user can request for best practices resource', async () => {
        await page.goto(`${baseURL}/enterprise/resources`)
        await page.waitForSelector('#best-practices')
        await Promise.all([
          page.waitForNavigation(),
          page.click('#best-practices'),
        ])
        await page.waitForSelector('#form-section')
        await page.type('#fullname', user.name)
        await page.type('#email', user.email)
        await page.type('#website', user.website)
        await page.click('#country')
        await page.keyboard.press('ArrowDown')
        await page.keyboard.down('Enter')
        await page.click('#volume')
        await page.keyboard.press('ArrowDown')
        await page.keyboard.down('Enter')
        await page.click('#request-resource-btn')
        // Check if user's email is submitted successfully
        const emailSubmitted = await page.evaluate(() => document.querySelector('.submitted-email').innerText)
        expect(emailSubmitted).toBe(user.email)
      }, 30000)
      test('user can request for peak performance resource', async () => {
        await page.goto(`${baseURL}/enterprise/resources`)
        await page.waitForSelector('#peak-performance')
        await Promise.all([
          page.waitForNavigation(),
          page.click('#peak-performance'),
        ])
        await page.waitForSelector('#form-section')
        await page.type('#fullname', user.name)
        await page.type('#email', user.email)
        await page.type('#website', user.website)
        await page.click('#country')
        await page.keyboard.press('ArrowDown')
        await page.keyboard.down('Enter')
        await page.click('#volume')
        await page.keyboard.press('ArrowDown')
        await page.keyboard.down('Enter')
        await page.click('#request-resource-btn')
        // Check if user's email is submitted successfully
        const emailSubmitted = await page.evaluate(() => document.querySelector('.submitted-email').innerText)
        expect(emailSubmitted).toBe(user.email)
      }, 30000)
      test('user can signup for a fyipe account and logout', async () => {
        await page.goto(baseURL)
        await page.waitForSelector('#create-account-top')
        await Promise.all([
          page.waitForNavigation(),
          page.click('#create-account-top'),
        ])
        await page.waitForSelector('#main-body')
        await page.type('#email', user.email)
        await page.type('#name', user.name)
        await page.type('#password', user.password)
        await page.type('#confirmPassword', user.password)
        await page.click('#create-account-button')
        await page.waitForSelector('#card-form')
        await page.type('#cardName', user.name)
        await page.type('#cardNumber', user.cardNumber)
        await page.type('#cvv', user.cvv)
        await page.type('#expiry', user.expiry)
        await page.type('#address1', user.address1)
        await page.type('#address2', user.address2)
        await page.type('#city', user.city)
        await page.type('#state', user.state)
        await page.type('#zipCode', user.zipCode)
        await page.click('#country')
        await page.keyboard.press('ArrowDown')
        await page.keyboard.down('Enter')
        await page.click('#create-account-button')
        await page.waitForSelector('#companyName')
        await page.type('#companyName', user.company)
        await page.type('#companyRole', user.companyRole)
        await page.click('#country')
        await page.keyboard.press('ArrowDown')
        await page.keyboard.down('Enter')
        await page.click('#companySize')
        await page.keyboard.press('ArrowDown')
        await page.keyboard.down('Enter')
        await page.type('#companyPhoneNumber', user.companyPhoneNumber)
        await page.type('#reference', user.reference)
        await page.click('#create-account-button')
        await page.waitForNavigation()
        await page.click('#profile-menu')
        await page.click('#logout-button')
        await page.waitForSelector('#login')
      }, 60000)
      test('user can login to and logout of fyipe', async () => {
        await page.goto(baseURL)
        await page.waitForSelector('#sign-in')
        await Promise.all([
          page.waitForNavigation(),
          page.click('#sign-in'),
        ])
        await page.waitFor(5000)
        await page.waitForSelector('#login')
        await page.type('#email', user.email)
        await page.type('#password', user.password)
        await page.click('#login-button')
        await page.waitForNavigation()
        await page.click('#profile-menu')
        await page.click('#logout-button')
        await page.waitForSelector('#login')
      }, 30000)
    })
  },
}
