// Renders ../report.html to ../Task1_QA_Report_SumitGoyal.pdf
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + path.resolve(__dirname, '../report.html'));
  await page.pdf({ path: path.resolve(__dirname, '../Task1_QA_Report_SumitGoyal.pdf'), format: 'A4', landscape: true, margin: { top: '10mm', bottom: '10mm', left: '8mm', right: '8mm' }, printBackground: true });
  await browser.close();
  console.log('PDF written');
})();
