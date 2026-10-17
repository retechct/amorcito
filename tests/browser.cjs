const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const base = process.env.TEST_URL || "http://127.0.0.1:4173";
const screenshots = path.join(root, ".qa");
const errors = [];

async function unlock(page) {
  await page.locator("#lock-day").fill("14");
  await page.locator("#lock-month").fill("02");
  await page.locator("#lock-year").fill("26");
  await page.locator("#app").waitFor({ state: "visible" });
  await page.locator("#secret-gate").waitFor({ state: "hidden" });
  await page.waitForTimeout(1800);
}
async function noHorizontalOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }));
  assert.ok(
    dimensions.content <= dimensions.viewport + 1,
    label + ": horizontal overflow " + JSON.stringify(dimensions),
  );
}
async function observe(page) {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.url().startsWith(base) && response.status() >= 400)
      errors.push(response.status() + " " + response.url());
  });
}

(async () => {
  await fs.mkdir(screenshots, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    await observe(page);
    await page.goto(base);
    await page.evaluate(() => document.fonts.ready);
    await noHorizontalOverflow(page, "desktop gate");
    await page.screenshot({
      path: path.join(screenshots, "01-gate-desktop.png"),
    });
    assert.equal(await page.locator("#app").isVisible(), false);
    await page.getByRole("button", { name: "Abrir nuestro rincón" }).click();
    await page
      .getByText("Todavía no… prueba con nuestra fecha especial.")
      .waitFor();
    assert.equal(await page.locator("#app").isVisible(), false);
    await page
      .getByRole("button", { name: "Aumentar día", exact: true })
      .click();
    assert.equal(await page.locator("#lock-day").inputValue(), "02");
    await unlock(page);
    await noHorizontalOverflow(page, "desktop app");
    await page.screenshot({
      path: path.join(screenshots, "02-home-desktop.png"),
    });
    await page.locator("#albumes").scrollIntoViewIfNeeded();
    await page.waitForTimeout(850);
    await page.screenshot({
      path: path.join(screenshots, "03-albums-desktop.png"),
    });
    await page.locator("#cartas").scrollIntoViewIfNeeded();
    await page.waitForTimeout(850);
    await page.screenshot({
      path: path.join(screenshots, "04-letters-desktop.png"),
    });
    await page
      .getByRole("button", {
        name: "Abrir carta: Para un día cualquiera",
        exact: true,
      })
      .click();
    await page.locator("#letter-dialog").waitFor({ state: "visible" });
    assert.ok(
      (await page.locator("#letter-body").innerText()).includes(
        "Eres mi lugar seguro",
      ),
    );
    await page.screenshot({
      path: path.join(screenshots, "05-letter-open.png"),
    });
    await page.keyboard.press("Escape");

    await page.locator("#inicio").scrollIntoViewIfNeeded();
    const photo = page.locator(".photo-main");
    const bounds = await photo.boundingBox();
    await page.mouse.move(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      bounds.x + bounds.width / 2 + 45,
      bounds.y + bounds.height / 2 + 35,
      { steps: 10 },
    );
    await page.mouse.up();
    assert.equal(
      await page.locator("#memory-dialog").isVisible(),
      false,
      "Dragging must not open the lightbox",
    );
    assert.equal(await page.locator("#reset-desk").isVisible(), true);
    await page.locator("#reset-desk").click();
    await page.locator(".photo-main").click();
    await page.locator("#memory-dialog").waitFor({ state: "visible" });
    assert.equal(
      await page.locator("#memory-title").innerText(),
      "Nuestra noche de colores",
    );
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(screenshots, "06-photo-viewer.png"),
    });
    await page.locator("#favorite-memory").click();
    await page.waitForFunction(
      () =>
        document
          .querySelector("#favorite-memory")
          .getAttribute("aria-pressed") === "true",
    );
    await page.locator("#next-memory").click();
    assert.equal(
      await page.locator("#memory-title").innerText(),
      "Entre luces y corazones",
    );
    await page.keyboard.press("Escape");
    await page.reload();
    await page.locator("#app").waitFor({ state: "visible" });
    await page.locator('[data-filter="favorites"]').click();
    assert.equal(
      await page.locator("#photo-grid .memory-card").count(),
      1,
      "Favorite persists after reload",
    );

    await page
      .getByRole("button", { name: "Añadir un nuevo momento", exact: true })
      .click();
    await page
      .locator("#photo-files")
      .setInputFiles([
        path.join(root, "amorcito 1.jpg"),
        path.join(root, "amorcito2.JPG"),
      ]);
    await page.locator("#entry-title").fill("Prueba de recuerdo");
    await page.locator("#entry-album").fill("Nuestro nuevo álbum");
    await page.locator("#entry-date").fill("2026-10-15");
    await page
      .locator("#entry-note")
      .fill(
        "Este texto debe conservarse después de recargar. <b>Texto literal</b>",
      );
    await page.locator("#save-entry").click();
    await page.locator("#editor-dialog").waitFor({ state: "hidden" });
    await page.reload();
    await page.locator("#app").waitFor({ state: "visible" });
    assert.equal(
      await page.locator("#photo-grid .memory-card").count(),
      5,
      "Two uploads persist",
    );
    await page
      .getByRole("button", {
        name: "Abrir álbum Nuestro nuevo álbum",
        exact: true,
      })
      .click();
    assert.equal(
      await page.locator("#album-dialog-photos .memory-card").count(),
      2,
    );
    await page.locator("#album-dialog-photos [data-memory]").first().click();
    assert.ok(
      (await page.locator("#memory-note").innerText()).includes(
        "<b>Texto literal</b>",
      ),
    );
    await page.locator("#edit-memory").click();
    await page.locator("#entry-title").fill("Un recuerdo editado");
    await page.locator("#save-entry").click();
    await page.locator("#editor-dialog").waitFor({ state: "hidden" });
    assert.equal(
      await page.locator("#memory-title").innerText(),
      "Un recuerdo editado",
    );
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Escribir una carta", exact: true })
      .click();
    await page.locator("#entry-title").fill("Una carta nueva");
    await page
      .locator("#entry-note")
      .fill("Te quiero. Esta es una carta guardada de prueba.");
    await page.locator("#save-entry").click();
    await page.locator("#editor-dialog").waitFor({ state: "hidden" });
    assert.equal(await page.locator("#letter-grid .envelope-card").count(), 3);
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#export-archive").click();
    const download = await downloadPromise;
    const backupPath = path.join(screenshots, "test-backup.json");
    await download.saveAs(backupPath);
    const backup = JSON.parse(await fs.readFile(backupPath, "utf8"));
    assert.equal(backup.memories.length, 5);
    assert.ok(
      backup.memories.every((memory) => memory.src.startsWith("data:image/")),
      "Backup includes original photos",
    );

    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const mobile = await mobileContext.newPage();
    await observe(mobile);
    await mobile.goto(base);
    await mobile.evaluate(() => document.fonts.ready);
    await noHorizontalOverflow(mobile, "mobile gate");
    await mobile.screenshot({
      path: path.join(screenshots, "07-gate-mobile.png"),
      fullPage: true,
    });
    await unlock(mobile);
    await noHorizontalOverflow(mobile, "mobile app");
    await mobile.screenshot({
      path: path.join(screenshots, "08-home-mobile.png"),
    });
    await mobile.locator("#albumes").scrollIntoViewIfNeeded();
    await mobile.waitForTimeout(850);
    await mobile.screenshot({
      path: path.join(screenshots, "09-albums-mobile.png"),
    });
    await mobile.locator("#cartas").scrollIntoViewIfNeeded();
    await mobile.waitForTimeout(850);
    await mobile.screenshot({
      path: path.join(screenshots, "10-letters-mobile.png"),
    });
    await mobile.locator("#import-file").setInputFiles(backupPath);
    await mobile.waitForFunction(
      () => document.querySelectorAll("#photo-grid .memory-card").length === 5,
    );
    assert.equal(
      await mobile.locator("#letter-grid .envelope-card").count(),
      3,
      "Letters import on another device",
    );
    await mobile.reload();
    await mobile.locator("#app").waitFor({ state: "visible" });
    assert.equal(
      await mobile.locator("#photo-grid .memory-card").count(),
      5,
      "Import persists",
    );
    await mobile.locator("#random-memory").click();
    await mobile.locator("#memory-dialog").waitFor({ state: "visible" });
    await mobile.waitForTimeout(600);
    await mobile.screenshot({
      path: path.join(screenshots, "11-viewer-mobile.png"),
    });
    await mobile.keyboard.press("Escape");
    await mobile.locator("#lock-again").click();
    assert.equal(await mobile.locator("#app").isVisible(), false);

    for (const [width, height] of [
      [320, 568],
      [768, 1024],
      [1366, 600],
    ]) {
      const sizeContext = await browser.newContext({
        viewport: { width, height },
        reducedMotion: "reduce",
      });
      const sizePage = await sizeContext.newPage();
      await observe(sizePage);
      await sizePage.goto(base);
      await noHorizontalOverflow(sizePage, width + " gate");
      await unlock(sizePage);
      await noHorizontalOverflow(sizePage, width + " app");
      await sizePage.screenshot({
        path: path.join(screenshots, "size-" + width + ".png"),
      });
      await sizeContext.close();
    }
    assert.deepEqual(errors, [], "Browser JavaScript and asset errors");
    console.log(
      "PASS: lock, wrong date, dials, drag, dialogs, keyboard navigation, favorite persistence, uploads, edits, letters, portable backup/import, responsive layouts and reduced motion.",
    );
    console.log("Screenshots: " + screenshots);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
