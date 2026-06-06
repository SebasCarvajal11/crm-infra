const { test, expect } = require("@playwright/test");

test("should load login page and show credentials inputs", async ({ page }) => {
  await page.goto("/login");
  
  // Validate that 'Correo' and 'Contrasena' inputs are visible
  const emailInput = page.getByLabel("Correo");
  const passwordInput = page.getByLabel("Contrasena");
  const loginButton = page.getByRole("button", { name: "Entrar" });
  
  await expect(emailInput).toBeVisible();
  await expect(passwordInput).toBeVisible();
  await expect(loginButton).toBeVisible();
});
