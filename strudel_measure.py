from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.goto('https://strudel.cc/', timeout=60000)
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(3000)

    # Take initial screenshot
    page.screenshot(path='strudel_initial.png', full_page=False)

    # Try to find and click the "reference" tab at the bottom
    ref_tab = page.locator('text=reference')
    count = ref_tab.count()
    print(f"Found {count} elements with 'reference' text")

    if count > 0:
        ref_tab.first.click()
        page.wait_for_timeout(3000)
        page.screenshot(path='strudel_reference.png', full_page=False)

        # Now measure font sizes
        font_sizes = page.evaluate('''() => {
            const results = {};

            const h2s = document.querySelectorAll('h2');
            if (h2s.length > 0) {
                const style = window.getComputedStyle(h2s[0]);
                results.h2_fontSize = style.fontSize;
                results.h2_fontSize_px = parseFloat(style.fontSize);
            }

            const h3s = document.querySelectorAll('h3');
            if (h3s.length > 0) {
                const style = window.getComputedStyle(h3s[0]);
                results.h3_fontSize = style.fontSize;
                results.h3_fontSize_px = parseFloat(style.fontSize);
            }

            const ps = document.querySelectorAll('p');
            if (ps.length > 0) {
                const style = window.getComputedStyle(ps[0]);
                results.p_fontSize = style.fontSize;
                results.p_fontSize_px = parseFloat(style.fontSize);
            }

            const codes = document.querySelectorAll('code');
            if (codes.length > 0) {
                const style = window.getComputedStyle(codes[0]);
                results.code_fontSize = style.fontSize;
                results.code_fontSize_px = parseFloat(style.fontSize);
            }

            const pres = document.querySelectorAll('pre');
            if (pres.length > 0) {
                const style = window.getComputedStyle(pres[0]);
                results.pre_fontSize = style.fontSize;
                results.pre_fontSize_px = parseFloat(style.fontSize);
            }

            const lis = document.querySelectorAll('li');
            if (lis.length > 0) {
                const style = window.getComputedStyle(lis[0]);
                results.li_fontSize = style.fontSize;
                results.li_fontSize_px = parseFloat(style.fontSize);
            }

            return results;
        }''')

        print("Font sizes found:")
        for key, value in font_sizes.items():
            print(f"  {key}: {value}")

        # Check sidebar and search
        sidebar_info = page.evaluate('''() => {
            const results = {};

            const selectors = ['nav li', '.sidebar li', 'aside li', '[class*="sidebar"] li', '[class*="nav"] li', '[class*="list"] li'];
            for (const sel of selectors) {
                const items = document.querySelectorAll(sel);
                if (items.length > 0) {
                    const style = window.getComputedStyle(items[0]);
                    results[sel + '_fontSize'] = style.fontSize;
                    results[sel + '_fontSize_px'] = parseFloat(style.fontSize);
                }
            }

            const searchInputs = document.querySelectorAll('input[type="search"], input[placeholder*="search"], input[placeholder*="Search"], input[class*="search"]');
            if (searchInputs.length > 0) {
                const style = window.getComputedStyle(searchInputs[0]);
                results.search_fontSize = style.fontSize;
                results.search_fontSize_px = parseFloat(style.fontSize);
            }

            return results;
        }''')

        print("\nSidebar and search info:")
        for key, value in sidebar_info.items():
            print(f"  {key}: {value}")

        # Get page structure
        structure = page.evaluate('''() => {
            const results = {};
            const allElements = document.querySelectorAll('*');
            const classNames = new Set();
            for (const el of allElements) {
                if (el.className && typeof el.className === 'string') {
                    el.className.split(' ').forEach(c => {
                        if (c && (c.includes('ref') || c.includes('side') || c.includes('nav') || c.includes('panel') || c.includes('content') || c.includes('search') || c.includes('list'))) {
                            classNames.add(c);
                        }
                    });
                }
            }
            results.relevant_classes = Array.from(classNames);
            results.h2_texts = Array.from(document.querySelectorAll('h2')).slice(0, 5).map(el => el.textContent.trim());
            results.h3_texts = Array.from(document.querySelectorAll('h3')).slice(0, 5).map(el => el.textContent.trim());
            return results;
        }''')

        print("\nPage structure info:")
        for key, value in structure.items():
            print(f"  {key}: {value}")

    browser.close()
