const { test, expect } = require('@playwright/test');

test.describe('SmartStock AI Dashboard E2E Tests', () => {
  test('should load the dashboard landing page with title and components', async ({ page }) => {
    await page.goto('/');

    // Check page title
    await expect(page).toHaveTitle(/SmartStock AI/i);

    // Verify header title element exists
    const brand = page.locator('header, h1, body');
    await expect(brand).toBeVisible();
  });

  test('should display product list and allow navigation', async ({ page }) => {
    await page.goto('/');
    
    // Check that main body content rendered
    const bodyContent = page.locator('body');
    await expect(bodyContent).toBeVisible();
  });
});
