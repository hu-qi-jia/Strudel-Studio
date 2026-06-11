const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  console.log('Navigating to strudel.cc...');
  await page.goto('https://strudel.cc/', { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForTimeout(3000);

  // Take initial screenshot
  await page.screenshot({ path: 'strudel_initial.png', fullPage: false });

  // Find and click the reference tab
  const refTab = await page.$('text=reference');
  if (refTab) {
    console.log('Found reference tab, clicking...');
    await refTab.click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'strudel_reference.png', fullPage: false });

    // Measure font sizes in the right content area
    const fontSizes = await page.evaluate(() => {
      const results = {};

      // h2
      const h2s = document.querySelectorAll('h2');
      if (h2s.length > 0) {
        const style = window.getComputedStyle(h2s[0]);
        results.h2 = { fontSize: style.fontSize, px: parseFloat(style.fontSize) };
      }

      // h3
      const h3s = document.querySelectorAll('h3');
      if (h3s.length > 0) {
        const style = window.getComputedStyle(h3s[0]);
        results.h3 = { fontSize: style.fontSize, px: parseFloat(style.fontSize) };
      }

      // p
      const ps = document.querySelectorAll('p');
      if (ps.length > 0) {
        const style = window.getComputedStyle(ps[0]);
        results.p = { fontSize: style.fontSize, px: parseFloat(style.fontSize) };
      }

      // code
      const codes = document.querySelectorAll('code');
      if (codes.length > 0) {
        const style = window.getComputedStyle(codes[0]);
        results.code = { fontSize: style.fontSize, px: parseFloat(style.fontSize) };
      }

      // pre
      const pres = document.querySelectorAll('pre');
      if (pres.length > 0) {
        const style = window.getComputedStyle(pres[0]);
        results.pre = { fontSize: style.fontSize, px: parseFloat(style.fontSize) };
      }

      // li
      const lis = document.querySelectorAll('li');
      if (lis.length > 0) {
        const style = window.getComputedStyle(lis[0]);
        results.li = { fontSize: style.fontSize, px: parseFloat(style.fontSize) };
      }

      return results;
    });

    console.log('\n=== Right Content Area Font Sizes ===');
    for (const [key, value] of Object.entries(fontSizes)) {
      console.log(`  ${key}: ${value.fontSize} (${value.px}px)`);
    }

    // Check sidebar list items and search box
    const sidebarInfo = await page.evaluate(() => {
      const results = {};

      // Try various selectors for sidebar list items
      const selectors = [
        'nav li', '.sidebar li', 'aside li',
        '[class*="sidebar"] li', '[class*="nav"] li', '[class*="list"] li',
        '[class*="menu"] li', '[class*="item"]'
      ];
      for (const sel of selectors) {
        const items = document.querySelectorAll(sel);
        if (items.length > 0) {
          const style = window.getComputedStyle(items[0]);
          results[sel] = { fontSize: style.fontSize, px: parseFloat(style.fontSize), count: items.length };
        }
      }

      // Search input
      const searchInputs = document.querySelectorAll(
        'input[type="search"], input[placeholder*="search"], input[placeholder*="Search"], input[class*="search"]'
      );
      if (searchInputs.length > 0) {
        const style = window.getComputedStyle(searchInputs[0]);
        results.searchInput = { fontSize: style.fontSize, px: parseFloat(style.fontSize) };
      }

      return results;
    });

    console.log('\n=== Sidebar and Search Info ===');
    for (const [key, value] of Object.entries(sidebarInfo)) {
      console.log(`  ${key}: ${value.fontSize} (${value.px}px) count=${value.count || 'N/A'}`);
    }

    // Get more detailed page structure info
    const structureInfo = await page.evaluate(() => {
      const results = {};

      // Get relevant class names
      const allElements = document.querySelectorAll('*');
      const classNames = new Set();
      for (const el of allElements) {
        if (el.className && typeof el.className === 'string') {
          el.className.split(' ').forEach(c => {
            if (c && (c.includes('ref') || c.includes('side') || c.includes('nav') ||
              c.includes('panel') || c.includes('content') || c.includes('search') ||
              c.includes('list') || c.includes('menu') || c.includes('tab'))) {
              classNames.add(c);
            }
          });
        }
      }
      results.relevantClasses = Array.from(classNames);

      // Get h2, h3 text content
      results.h2Texts = Array.from(document.querySelectorAll('h2')).slice(0, 5).map(el => el.textContent.trim());
      results.h3Texts = Array.from(document.querySelectorAll('h3')).slice(0, 5).map(el => el.textContent.trim());

      // Get all input elements
      results.inputs = Array.from(document.querySelectorAll('input')).map(el => ({
        type: el.type,
        placeholder: el.placeholder,
        className: el.className,
        fontSize: window.getComputedStyle(el).fontSize
      }));

      return results;
    });

    console.log('\n=== Page Structure ===');
    console.log('Relevant classes:', structureInfo.relevantClasses.join(', '));
    console.log('H2 texts:', structureInfo.h2Texts);
    console.log('H3 texts:', structureInfo.h3Texts);
    console.log('Inputs:', JSON.stringify(structureInfo.inputs, null, 2));

  } else {
    console.log('Reference tab not found!');

    // Let's see what's on the page
    const pageText = await page.evaluate(() => {
      return document.body.innerText.substring(0, 2000);
    });
    console.log('Page text:', pageText);

    // Check for tabs or navigation
    const tabInfo = await page.evaluate(() => {
      const tabs = document.querySelectorAll('[role="tab"], .tab, [class*="tab"]');
      return Array.from(tabs).map(t => ({
        text: t.textContent.trim(),
        className: t.className,
        tagName: t.tagName
      }));
    });
    console.log('Tabs found:', JSON.stringify(tabInfo, null, 2));
  }

  await browser.close();
})().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
