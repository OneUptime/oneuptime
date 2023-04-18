import { test, expect } from '@playwright/test';


test.beforeEach(async ({ page }) => {
  await page.goto('http://localhost:1444/');
});
test.describe('check if pages loades with its title', () => {
test('has title', async ({ page }) => {
    await expect(page).toHaveTitle(/OneUptime | One Complete SRE and DevOps platform./);
});
test('oneUptime link navigate to homepage', async ({ page }) => {
  await page.getByRole('link', { name: 'OneUptime', exact: true }).click();

  await expect(page).toHaveURL(/.*test\.oneuptime\.com/);
});
  });
test.describe('navigation bar', () => {

  test('product page', async ({ page }) => {
   
  const product = page.getByRole('button', { name: 'Products' });
  await product.click()
    await product.hover()
    await expect(product).toHaveText(/Products/);
    await expect(product).toBeVisible();
    await expect(product).toBeInViewport();
  
  });
  test('pricing page', async ({ page }) => {
   
  const pricing = page.getByRole('link', { name: 'Pricing' });
  await pricing.click()
    await pricing.hover()
    await expect(pricing).toHaveText(/Pricing/);
    await expect(pricing).toBeVisible();
     await expect(pricing).toBeInViewport();
       await expect(page).toHaveURL(/.*pricing/);
  
  });
    test('Enterprise', async ({ page }) => {
   
  const enterprise = page.getByRole('link', { name: 'Enterprise' });
  await enterprise.click()
      await enterprise.hover()
      await expect(enterprise).toBeVisible()
       await expect(enterprise).toBeInViewport();
    await expect(enterprise).toHaveText(/Enterprise/);
      await expect(page).toHaveURL(/.*enterprise\/overview/);
      
  
    });
  test('Request Demo', async ({ page }) => {
  const requestDemo = await page.$("[data-testid='Request-demo']");
  if (requestDemo ) {
    await requestDemo .click();
    await requestDemo .hover();
    await expect(page).toHaveURL(/.*enterprise\/demo/);
  }
});
  test('More', async ({ page }) => {
   
  const more = page.getByRole('button', { name: 'More' });
  await more.click()
    await more.hover()
    await expect(more).toHaveText(/More/);
    await expect(more).toBeVisible();
    await expect(more).toBeInViewport();
  
  });


  
test('sign in button ', async ({ page }) => {
    await page.getByRole('link', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/.*accounts/);
})
  
// test('sign up button', async ({ page }) => {
//   const signUpButton = await page.$("[data-testid='Sign-up']");
//   if (signUpButton) {
//     await signUpButton.click();
//     await expect(page).toHaveURL(/.*accounts\/register/);
//   }
// });

})

test.describe("main page", () => {
  test('images', async ({ page }) => {
    const statusImage = page.getByRole('img', { name: 'Status Pages' }).first()
    const MonitoringImage = page.getByRole('img', { name: 'Monitoring' });
    const UserInterfaceImage= page.getByRole('img', { name: 'Inbox user interface' })
      await expect(statusImage).toBeVisible();
      await expect(MonitoringImage).toBeVisible();
    await expect(UserInterfaceImage).toBeVisible();
    await expect(page.getByTitle('open-source')).toHaveText('Open Source');
    await expect(statusImage).toBeInViewport();
  });


    });


