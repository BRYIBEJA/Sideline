
// ==UserScript==
// @name         Poirot V3 - Auto Fill FNSKU & Auto Confirm
// @namespace    http://tampermonkey.net/
// @version      32.2
// @description  Full Poirot V3 automation + FC Research. SSCC by data-section-type. Settings menu. Shadow DOM aware page detection.
// @match        https://aft-poirot-website.na.aftx.amazonoperations.app/?tool=V3*
// @match        https://aft-poirot-website.na.aftx.amazonoperations.app/*tool=V3*
// @match        https://aft-poirot-website.na.aftx.amazonoperations.app/*
// @match        https://aft-poirot-website-iad.iad.proxy.amazon.com/?tool=V3*
// @match        https://aft-poirot-website-iad.iad.proxy.amazon.com/*tool=V3*
// @match        https://aft-poirot-website-iad.iad.proxy.amazon.com/*
// @match        https://qifcr.na.aftx.amazonoperations.app/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // =============================================
    // USER SETTINGS (persisted in localStorage)
    // =============================================
    const SETTINGS_KEY = 'poirot_v3_settings';

    function getSettings() {
        try {
            const raw = localStorage.getItem(SETTINGS_KEY);
            if (raw) return JSON.parse(raw);
        } catch(e) {}
        return { autoQuantity: true };
    }

    function saveSettings(settings) {
        try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch(e) {}
    }

    let settings = getSettings();

    // =============================================
    // SHARED: Cookie helpers
    // =============================================
    function setCrossCookie(name, value) {
        document.cookie = name + '=' + encodeURIComponent(value) + '; path=/; max-age=300';
        try { document.cookie = name + '=' + encodeURIComponent(value) + '; path=/; domain=.amazonoperations.app; max-age=300'; } catch(e) {}
        try { document.cookie = name + '=' + encodeURIComponent(value) + '; path=/; domain=.amazon.com; max-age=300'; } catch(e) {}
    }
    function getCrossCookie(name) {
        const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
        return m ? decodeURIComponent(m[1]) : null;
    }
    function clearCrossCookie(name) {
        document.cookie = name + '=; path=/; max-age=0';
        try { document.cookie = name + '=; path=/; domain=.amazonoperations.app; max-age=0'; } catch(e) {}
        try { document.cookie = name + '=; path=/; domain=.amazon.com; max-age=0'; } catch(e) {}
    }

    function isValidContainerId(id) {
        return id && /^cs[A-Za-z][A-Za-z0-9]+$/i.test(id.trim());
    }

    function buildFCResultsUrl(searchValue) {
        return 'https://qifcr.na.aftx.amazonoperations.app/KRB3/results?s=' + encodeURIComponent(searchValue);
    }

    // =============================================
    // DEEP TEXT SEARCH (pierces Shadow DOM)
    // =============================================
    function deepTextSearch(root, searchText) {
        if (!root) return false;
        const lower = searchText.toLowerCase();

        // Check text nodes
        if (root.nodeType === Node.TEXT_NODE) {
            return root.textContent.toLowerCase().includes(lower);
        }

        // Check this element's direct text
        if (root.textContent && root.textContent.toLowerCase().includes(lower)) return true;

        // Check shadow root
        if (root.shadowRoot) {
            if (deepTextSearch(root.shadowRoot, searchText)) return true;
        }

        // Check children
        const children = root.childNodes || root.children || [];
        for (const child of children) {
            if (deepTextSearch(child, searchText)) return true;
        }

        return false;
    }

    function deepFindText(searchText) {
        return deepTextSearch(document.body, searchText);
    }

    // =============================================
    // FC RESEARCH PAGE
    // =============================================
    if (window.location.hostname.includes('qifcr.na.aftx.amazonoperations.app')) {
        const params = new URLSearchParams(window.location.search);
        const containerId = params.get('autoSearch');

        if (containerId) {
            window.location.replace(buildFCResultsUrl(containerId));
            return;
        }

        let scrapeAttempts = 0;
        const MAX_SCRAPE_ATTEMPTS = 15;
        const SCRAPE_RETRY_DELAY = 1500;
        let scrapeDone = false;

        function isInventoryHistoryEmpty() {
            const section = document.querySelector('[data-section-type="inventory-history"]');
            if (section) {
                const text = section.textContent.trim().toLowerCase();
                if (/no matching records/i.test(text)) return true;
                if (/showing\s+0\s+to\s+0\s+of\s+0/i.test(text)) return true;
            }
            const invTable = document.getElementById('table-inventory-history');
            if (!invTable) return section ? true : null;
            const tbody = invTable.querySelector('tbody');
            if (tbody) {
                const text = tbody.textContent.trim().toLowerCase();
                if (text.includes('no matching records') || text.includes('no data') || text.includes('no results')) return true;
                const rows = tbody.querySelectorAll('tr');
                if (rows.length === 0) return true;
                if (rows.length === 1) {
                    const cells = rows[0].querySelectorAll('td');
                    if (cells.length <= 1) {
                        const cellText = cells[0] ? cells[0].textContent.trim().toLowerCase() : '';
                        if (cellText.includes('no matching') || cellText.includes('no data') || cellText === '') return true;
                    }
                }
            }
            return false;
        }

        function scrapeFromInventoryHistory() {
            let asin = null, quantity = null;
            const section = document.querySelector('[data-section-type="inventory-history"]');
            let invTable = null;
            if (section) invTable = section.querySelector('table');
            if (!invTable) invTable = document.getElementById('table-inventory-history');
            if (!invTable) return { asin: null, quantity: null };

            const firstRow = invTable.querySelector('tbody tr');
            if (!firstRow) return { asin: null, quantity: null };

            const asinLink = firstRow.querySelector('a[href*="/results"]');
            if (asinLink) asin = asinLink.textContent.trim();

            const headers = Array.from(invTable.querySelectorAll('thead th')).map(th => th.textContent.trim().toLowerCase());
            const cells = firstRow.querySelectorAll('td');
            const qtyIdx = headers.findIndex(h => h.includes('quantity') || h.includes('qty'));
            if (qtyIdx >= 0 && cells[qtyIdx]) {
                const qm = cells[qtyIdx].textContent.trim().match(/(\d+)/);
                if (qm) quantity = qm[1];
            }
            if (!quantity) {
                for (const cell of cells) {
                    const text = cell.textContent.trim();
                    if (/^\d+$/.test(text) && text !== '0') { quantity = text; break; }
                }
            }
            return { asin, quantity };
        }

        function isSSCCSectionLoaded() {
            return !!document.querySelector('[data-section-type="sscc-info"]');
        }

        function scrapeFromSSCC() {
            let asin = null, quantity = null;

            const ssccSection = document.querySelector('[data-section-type="sscc-info"]');
            if (!ssccSection) {
                console.log('[Poirot] SSCC section [data-section-type="sscc-info"] NOT found.');
                return { asin: null, quantity: null };
            }

            console.log('[Poirot] SSCC section FOUND.');

            const table = ssccSection.querySelector('table');
            if (!table) {
                console.log('[Poirot] No table inside SSCC section.');
                const sectionText = ssccSection.textContent;
                const asinMatch = sectionText.match(/\b([A-Z0-9]{10})\b/g);
                if (asinMatch) {
                    for (const candidate of asinMatch) {
                        if (/^\d{10}$/.test(candidate)) continue;
                        asin = candidate;
                        break;
                    }
                }
                const qtyMatch = sectionText.match(/quantity[:\s]*(\d+)/i);
                if (qtyMatch) quantity = qtyMatch[1];
                return { asin, quantity };
            }

            const allRows = Array.from(table.querySelectorAll('tr'));
            console.log('[Poirot] SSCC table: ' + allRows.length + ' rows');
            for (let r = 0; r < allRows.length; r++) {
                const cells = allRows[r].querySelectorAll('td, th');
                const vals = Array.from(cells).map(c => c.textContent.trim().substring(0, 60));
                console.log('[Poirot] SSCC row ' + r + ': ' + JSON.stringify(vals));
            }

            let headers = [];
            let dataRows = [];

            const theadThs = table.querySelectorAll('thead th');
            if (theadThs.length > 0) {
                headers = Array.from(theadThs).map(th => th.textContent.trim().toLowerCase());
                dataRows = Array.from(table.querySelectorAll('tbody tr'));
                if (dataRows.length === 0) {
                    dataRows = allRows.filter(row => !row.closest('thead'));
                }
            }

            if (headers.length === 0 && allRows.length > 0) {
                const firstThs = allRows[0].querySelectorAll('th');
                if (firstThs.length > 0) {
                    headers = Array.from(firstThs).map(th => th.textContent.trim().toLowerCase());
                    dataRows = allRows.slice(1);
                }
            }

            if (headers.length === 0 && allRows.length > 1) {
                const firstCells = allRows[0].querySelectorAll('td');
                headers = Array.from(firstCells).map(td => td.textContent.trim().toLowerCase());
                dataRows = allRows.slice(1);
            }

            console.log('[Poirot] SSCC headers: ' + JSON.stringify(headers));

            const asinIdx = headers.findIndex(h => h === 'asin' || h.includes('asin'));
            const qtyIdx = headers.findIndex(h =>
                h === 'quantity' || h === 'qty' ||
                h.includes('quantity') || h.includes('qty')
            );
            console.log('[Poirot] SSCC asinIdx=' + asinIdx + ', qtyIdx=' + qtyIdx);

            for (const row of dataRows) {
                const cells = row.querySelectorAll('td');
                const rowText = row.textContent.trim().toLowerCase();
                if (rowText.includes('no matching') || rowText.includes('no data')) continue;
                if (cells.length === 0) continue;

                if (asinIdx >= 0 && asinIdx < cells.length) {
                    const link = cells[asinIdx].querySelector('a');
                    const val = link ? link.textContent.trim() : cells[asinIdx].textContent.trim();
                    if (val && val.length > 0 && val !== '-') asin = val;
                }

                if (qtyIdx >= 0 && qtyIdx < cells.length) {
                    const raw = cells[qtyIdx].textContent.trim();
                    const qm = raw.match(/(\d+)/);
                    if (qm) quantity = qm[1];
                    console.log('[Poirot] SSCC qty cell raw: "' + raw + '" → ' + quantity);
                }

                if (!asin) {
                    for (const cell of cells) {
                        const link = cell.querySelector('a');
                        const val = link ? link.textContent.trim() : cell.textContent.trim();
                        if (/^[A-Z0-9]{10}$/.test(val)) { asin = val; break; }
                    }
                }

                if (asin && !quantity) {
                    for (let i = 0; i < cells.length; i++) {
                        if (i === asinIdx) continue;
                        const text = cells[i].textContent.trim();
                        if (/^\d+$/.test(text)) { quantity = text; break; }
                    }
                }

                if (asin) break;
            }

            if (!asin) {
                const allCells = ssccSection.querySelectorAll('td, th');
                let foundAsinCell = false;
                for (const cell of allCells) {
                    const link = cell.querySelector('a');
                    const val = link ? link.textContent.trim() : cell.textContent.trim();
                    if (/^[A-Z0-9]{10}$/.test(val) && !asin) {
                        asin = val;
                        foundAsinCell = true;
                    }
                    if (foundAsinCell && !quantity && /^\d+$/.test(val) && val !== '0') {
                        quantity = val;
                    }
                }
            }

            console.log('[Poirot] SSCC FINAL — ASIN: ' + (asin || 'null') + ', Qty: ' + (quantity || 'null'));
            return { asin, quantity };
        }

        function scrapeAndSend() {
            if (scrapeDone) return;
            scrapeAttempts++;

            let asin = null, quantity = null;

            const invEmpty = isInventoryHistoryEmpty();
            if (invEmpty === false) {
                const invData = scrapeFromInventoryHistory();
                asin = invData.asin;
                quantity = invData.quantity;
                console.log('[Poirot] InvHist (attempt ' + scrapeAttempts + ') — ASIN: ' + asin + ', Qty: ' + quantity);
            }

            if (!asin) {
                const ssccData = scrapeFromSSCC();
                if (ssccData.asin) {
                    asin = ssccData.asin;
                    quantity = ssccData.quantity;
                }
            }

            console.log('[Poirot] Result (attempt ' + scrapeAttempts + '/' + MAX_SCRAPE_ATTEMPTS + ') — ASIN: ' + asin + ', Qty: ' + quantity);

            if (asin && quantity) {
                scrapeDone = true;
                setCrossCookie('poirot_fc_asin', asin);
                setCrossCookie('poirot_fc_quantity', quantity);
                setCrossCookie('poirot_fc_ready', 'true');
                console.log('[Poirot] SUCCESS — ASIN: ' + asin + ', Qty: ' + quantity);
                setTimeout(() => { window.close(); }, 500);
                return;
            }

            if (asin && !quantity && scrapeAttempts < MAX_SCRAPE_ATTEMPTS) {
                setTimeout(scrapeAndSend, SCRAPE_RETRY_DELAY);
                return;
            }

            if (!asin && scrapeAttempts < MAX_SCRAPE_ATTEMPTS) {
                const ssccLoaded = isSSCCSectionLoaded();
                if (invEmpty === true && ssccLoaded && scrapeAttempts >= 5) {
                    scrapeDone = true;
                    setCrossCookie('poirot_fc_empty', 'true');
                    setTimeout(() => { window.close(); }, 500);
                    return;
                }
                setTimeout(scrapeAndSend, SCRAPE_RETRY_DELAY);
                return;
            }

            if (asin) {
                scrapeDone = true;
                setCrossCookie('poirot_fc_asin', asin);
                if (quantity) setCrossCookie('poirot_fc_quantity', quantity);
                setCrossCookie('poirot_fc_ready', 'true');
                setTimeout(() => { window.close(); }, 500);
            } else {
                scrapeDone = true;
                setCrossCookie('poirot_fc_empty', 'true');
                setTimeout(() => { window.close(); }, 500);
            }
        }

        const fcObs = new MutationObserver(() => {
            if (scrapeDone) return;
            setTimeout(scrapeAndSend, 1500);
        });
        fcObs.observe(document.body, { childList: true, subtree: true });

        setTimeout(scrapeAndSend, 2000);
        setTimeout(scrapeAndSend, 4000);
        setTimeout(scrapeAndSend, 7000);
        setTimeout(scrapeAndSend, 10000);
        setTimeout(scrapeAndSend, 15000);
        setTimeout(scrapeAndSend, 20000);

        return;
    }

    // =============================================
    // SIDELINE PAGE
    // =============================================

    const DELAY_BEFORE_FILL = 500;
    const DELAY_BEFORE_ENTER = 150;
    const DELAY_BEFORE_CONFIRM = 300;
    const DELAY_BEFORE_CHANGE_CONTAINER = 600;
    const DELAY_AFTER_SUCCESS_BANNER = 800;
    const SUCCESS_COOLDOWN_MS = 5000;

    let lastFilledFNSKU = '';
    let verifyHandled = false;
    let quantityHandled = false;
    let destinationListenerAttached = false;
    let sidelineSuccessHandled = false;
    let emptyContainerHandled = false;
    let fcDataHandled = false;
    let fbaPopupShown = false;
    let fcEmptyHandled = false;
    let waitingForFC = false;

    // =============================================
    // SUCCESS COOLDOWN
    // =============================================
    let lastSuccessTime = 0;

    function markSuccessFired() {
        lastSuccessTime = Date.now();
        console.log('[Poirot] Success fired — cooldown started (' + SUCCESS_COOLDOWN_MS + 'ms).');
    }

    function isInSuccessCooldown() {
        return (Date.now() - lastSuccessTime) < SUCCESS_COOLDOWN_MS;
    }

    // =============================================
    // PAGE DETECTION (Shadow DOM aware)
    // =============================================
    function findPageHeading() {
        // Method 1: Standard DOM selectors
        const selectors = 'span.text--size-xxl, h1, h2, h3, h4, h5, h6, [class*="title"], [class*="header"], [class*="heading"]';
        const els = document.querySelectorAll(selectors);
        for (const el of els) {
            const t = el.textContent.replace(/\s+/g, ' ').trim().toLowerCase();
            if (t.length > 0 && t.length < 100) return t;
        }
        return '';
    }

    function isScanPage() {
        // Method 1: Standard heading check
        const heading = findPageHeading();
        if (heading.includes('scan item')) return true;

        // Method 2: Deep text search (pierces Shadow DOM)
        if (deepFindText('Scan item')) return true;

        // Method 3: Check for scan-specific elements
        const changeBtn = document.getElementById('change-container-button') ||
            document.querySelector('[id="change-container-button"]') ||
            document.querySelector('alchemy-button#change-container-button');
        if (changeBtn) {
            // Has change container button — could be scan page
            // Make sure it's NOT destination, verify, or quantity
            if (!isDestinationPage() && !isVerifyPage() && !isQuantityPage()) {
                // If we see "No items found" or "Item quantity: 0" it's definitely scan page
                const bodyText = document.body.textContent.toLowerCase();
                if (bodyText.includes('no items found') || bodyText.includes('item quantity')) {
                    return true;
                }
                // If there's a scan input and no quantity/verify/destination indicators
                const input = getScanInput();
                if (input) {
                    const placeholder = (input.placeholder || '').toLowerCase();
                    if (placeholder.includes('scan') || placeholder === '') return true;
                }
            }
        }

        // Method 4: Body text contains scan-related indicators without other page indicators
        const bodyText = document.body.textContent.toLowerCase();
        if (bodyText.includes('scan item') && !bodyText.includes('enter quantity') && !bodyText.includes('scan destination') && !bodyText.includes('verify item')) {
            return true;
        }

        return false;
    }

    function isVerifyPage() {
        const heading = findPageHeading();
        if (heading.includes('verify item')) return true;
        if (deepFindText('Verify item')) return true;
        const bodyText = document.body.textContent.toLowerCase();
        if (bodyText.includes('verify item') && !bodyText.includes('scan item')) return true;
        return false;
    }

    function isQuantityPage() {
        const heading = findPageHeading();
        if (heading.includes('enter quantity')) return true;
        if (deepFindText('Enter quantity')) return true;
        const bodyText = document.body.textContent.toLowerCase();
        if (bodyText.includes('enter quantity')) return true;
        return false;
    }

    function isDestinationPage() {
        const heading = findPageHeading();
        if (heading.includes('scan destination') || heading.includes('destination container')) return true;
        if (deepFindText('Scan destination')) return true;
        if (deepFindText('Destination container')) return true;
        const bodyText = document.body.textContent.toLowerCase();
        if (bodyText.includes('scan destination') || bodyText.includes('destination container')) return true;
        return false;
    }

    function isEmptyContainer() {
        // Approach 1: Check specific span classes
        const spans = document.querySelectorAll('span.text--size-lg, span.text');
        for (const el of spans) {
            if (el.textContent.trim().toLowerCase().includes('no items found')) return true;
        }
        // Approach 2: Check item quantity = 0 AND number of rows = 0
        const bodyText = document.body.textContent.toLowerCase();
        if (bodyText.includes('item quantity') && bodyText.includes('number of rows')) {
            const qtyMatch = bodyText.match(/item\s*quantity[:\s]*(\d+)/i);
            const rowMatch = bodyText.match(/number\s*of\s*rows[:\s]*(\d+)/i);
            if (qtyMatch && rowMatch && qtyMatch[1] === '0' && rowMatch[1] === '0') {
                return true;
            }
        }
        // Approach 3: Broad text search
        if (bodyText.includes('no items found in this container')) return true;
        // Approach 4: Deep shadow DOM search
        if (deepFindText('No items found in this container')) return true;
        return false;
    }

    function getSourceContainerId() {
        // Approach 1: Direct ID lookup
        const label = document.getElementById('source-container-label');
        if (label) {
            const text = label.textContent.trim();
            if (isValidContainerId(text)) return text;
        }
        // Approach 2: Search all elements near "Source Container" text
        const allEls = document.querySelectorAll('span, div, p, label, h1, h2, h3, h4, h5, h6');
        for (const el of allEls) {
            const text = el.textContent.trim();
            if (isValidContainerId(text)) {
                const parent = el.parentElement;
                if (parent) {
                    const parentText = parent.textContent.toLowerCase();
                    if (parentText.includes('source container') || parentText.includes('change container')) {
                        return text;
                    }
                }
            }
        }
        // Approach 3: Deep shadow DOM search for csX pattern
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
        while (walker.nextNode()) {
            const match = walker.currentNode.textContent.trim().match(/^(cs[A-Za-z][A-Za-z0-9]+)$/);
            if (match && match[1].length < 20) return match[1];
        }
        return null;
    }

    // =============================================
    // SETTINGS MENU UI
    // =============================================
    function createSettingsMenu() {
        if (document.getElementById('poirot-settings-gear')) return;

        const gear = document.createElement('div');
        gear.id = 'poirot-settings-gear';
        gear.textContent = '\u2699\uFE0F';
        gear.title = 'Poirot V3 Settings';
        gear.style.cssText = 'position:fixed;bottom:20px;right:20px;width:48px;height:48px;background:#232f3e;color:#ff9900;font-size:26px;line-height:48px;text-align:center;border-radius:50%;cursor:pointer;z-index:99998;box-shadow:0 2px 12px rgba(0,0,0,0.3);transition:transform 0.2s,background 0.2s;user-select:none;';
        gear.addEventListener('mouseenter', () => { gear.style.transform = 'rotate(45deg) scale(1.1)'; gear.style.background = '#37475a'; });
        gear.addEventListener('mouseleave', () => { gear.style.transform = 'rotate(0deg) scale(1)'; gear.style.background = '#232f3e'; });

        const panel = document.createElement('div');
        panel.id = 'poirot-settings-panel';
        panel.style.cssText = 'position:fixed;bottom:80px;right:20px;width:300px;background:#fff;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.25);z-index:99999;overflow:hidden;display:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;transition:opacity 0.2s,transform 0.2s;transform:translateY(10px);opacity:0;';

        const header = document.createElement('div');
        header.style.cssText = 'background:#232f3e;color:#fff;padding:16px 20px;display:flex;align-items:center;justify-content:space-between;';
        const headerTitle = document.createElement('span');
        headerTitle.textContent = '\u2699\uFE0F Poirot V3 Settings';
        headerTitle.style.cssText = 'font-size:16px;font-weight:bold;';
        const headerVersion = document.createElement('span');
        headerVersion.textContent = 'v32.2';
        headerVersion.style.cssText = 'font-size:12px;color:#ff9900;background:#37475a;padding:2px 8px;border-radius:10px;';
        header.appendChild(headerTitle);
        header.appendChild(headerVersion);

        const body = document.createElement('div');
        body.style.cssText = 'padding:16px 20px;';

        const autoQtyRow = createToggleRow(
            'Auto Enter Quantity',
            'Automatically fills and confirms the quantity on the quantity page.',
            settings.autoQuantity,
            (checked) => {
                settings.autoQuantity = checked;
                saveSettings(settings);
            }
        );
        body.appendChild(autoQtyRow);

        const divider = document.createElement('div');
        divider.style.cssText = 'height:1px;background:#eee;margin:12px 0;';
        body.appendChild(divider);

        const statusRow = document.createElement('div');
        statusRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;';
        const statusLabel = document.createElement('span');
        statusLabel.textContent = 'Script Status';
        statusLabel.style.cssText = 'font-size:13px;color:#555;';
        const statusBadge = document.createElement('span');
        statusBadge.textContent = '\u2705 Active';
        statusBadge.style.cssText = 'font-size:12px;color:#067d06;background:#e6f9e6;padding:3px 10px;border-radius:10px;font-weight:600;';
        statusRow.appendChild(statusLabel);
        statusRow.appendChild(statusBadge);
        body.appendChild(statusRow);

        panel.appendChild(header);
        panel.appendChild(body);

        let panelOpen = false;
        gear.addEventListener('click', () => {
            panelOpen = !panelOpen;
            if (panelOpen) {
                panel.style.display = 'block';
                requestAnimationFrame(() => {
                    panel.style.opacity = '1';
                    panel.style.transform = 'translateY(0)';
                });
            } else {
                panel.style.opacity = '0';
                panel.style.transform = 'translateY(10px)';
                setTimeout(() => { panel.style.display = 'none'; }, 200);
            }
        });

        document.addEventListener('click', (e) => {
            if (panelOpen && !panel.contains(e.target) && e.target !== gear) {
                panelOpen = false;
                panel.style.opacity = '0';
                panel.style.transform = 'translateY(10px)';
                setTimeout(() => { panel.style.display = 'none'; }, 200);
            }
        });

        document.body.appendChild(gear);
        document.body.appendChild(panel);
    }

    function createToggleRow(label, description, initialState, onChange) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:4px;';

        const textCol = document.createElement('div');
        textCol.style.cssText = 'flex:1;';

        const labelEl = document.createElement('div');
        labelEl.textContent = label;
        labelEl.style.cssText = 'font-size:14px;font-weight:600;color:#111;margin-bottom:2px;';

        const descEl = document.createElement('div');
        descEl.textContent = description;
        descEl.style.cssText = 'font-size:12px;color:#888;line-height:1.3;';

        textCol.appendChild(labelEl);
        textCol.appendChild(descEl);

        const toggle = document.createElement('div');
        toggle.style.cssText = 'width:44px;min-width:44px;height:24px;border-radius:12px;cursor:pointer;position:relative;transition:background 0.2s;margin-top:2px;' +
            (initialState ? 'background:#ff9900;' : 'background:#ccc;');

        const knob = document.createElement('div');
        knob.style.cssText = 'width:20px;height:20px;border-radius:50%;background:#fff;position:absolute;top:2px;transition:left 0.2s;box-shadow:0 1px 3px rgba(0,0,0,0.2);' +
            (initialState ? 'left:22px;' : 'left:2px;');

        toggle.appendChild(knob);

        let state = initialState;
        toggle.addEventListener('click', () => {
            state = !state;
            toggle.style.background = state ? '#ff9900' : '#ccc';
            knob.style.left = state ? '22px' : '2px';
            onChange(state);
        });

        row.appendChild(textCol);
        row.appendChild(toggle);
        return row;
    }

    setTimeout(createSettingsMenu, 1000);

    // =============================================
    // CORE FUNCTIONS
    // =============================================

    function getFNSKU() {
        const alchemyTags = document.querySelectorAll('alchemy-tag');
        for (const tag of alchemyTags) {
            const root = tag.shadowRoot;
            if (root) {
                const textContent = root.textContent || '';
                const match = textContent.match(/FNSKU\s*:\s*([A-Z0-9]+)/i);
                if (match) return match[1];
            }
            const text = tag.textContent || '';
            const match = text.match(/FNSKU\s*:\s*([A-Z0-9]+)/i);
            if (match) return match[1];
        }
        return searchDeep(document.body);
    }

    function searchDeep(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            const match = node.textContent.match(/FNSKU\s*:\s*([A-Z0-9]+)/i);
            if (match) return match[1];
        }
        if (node.shadowRoot) {
            const result = searchDeep(node.shadowRoot);
            if (result) return result;
        }
        for (const child of (node.children || node.childNodes || [])) {
            const result = searchDeep(child);
            if (result) return result;
        }
        return null;
    }

    function getScanInput() {
        const inputs = document.querySelectorAll('input[type="text"], input:not([type]), input[type="search"]');
        for (const input of inputs) {
            if (input.offsetParent !== null) return input;
        }
        const alchemyInputs = document.querySelectorAll('alchemy-input, alchemy-text-field');
        for (const ai of alchemyInputs) {
            if (ai.shadowRoot) {
                const input = ai.shadowRoot.querySelector('input');
                if (input) return input;
            }
        }
        return null;
    }

    function setNativeValue(input, value) {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value'
        ).set;
        nativeInputValueSetter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function pressEnter(element) {
        ['keydown', 'keypress', 'keyup'].forEach((type) => {
            element.dispatchEvent(new KeyboardEvent(type, {
                key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true,
            }));
        });
    }

    function attemptAutoFill() {
        if (waitingForFC) return;
        const fnsku = getFNSKU();
        const input = getScanInput();
        if (fnsku && input) {
            if (input.value === '' && fnsku !== lastFilledFNSKU) {
                input.focus();
                setNativeValue(input, fnsku);
                lastFilledFNSKU = fnsku;
                setTimeout(() => { pressEnter(input); }, DELAY_BEFORE_ENTER);
            }
        }
    }

    function showFBALabelPopup() {
        if (document.getElementById('poirot-fba-overlay')) return;
        fbaPopupShown = true;
        waitingForFC = true;

        const overlay = document.createElement('div');
        overlay.id = 'poirot-fba-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:99999;display:flex;align-items:center;justify-content:center;';

        const modal = document.createElement('div');
        modal.style.cssText = 'background:#fff;border-radius:12px;padding:32px;max-width:460px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.3);text-align:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';

        const icon = document.createElement('div');
        icon.textContent = '\uD83D\uDCE6';
        icon.style.cssText = 'font-size:48px;margin-bottom:12px;';

        const title = document.createElement('h2');
        title.textContent = 'No Inventory Found';
        title.style.cssText = 'margin:0 0 8px 0;font-size:20px;color:#111;';

        const subtitle = document.createElement('p');
        subtitle.textContent = 'FC Research returned no inventory history. Scan or type the FBA shipping label barcode to look up this item.';
        subtitle.style.cssText = 'margin:0 0 20px 0;font-size:14px;color:#555;line-height:1.4;';

        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'Scan FBA label barcode...';
        input.autocomplete = 'off';
        input.style.cssText = 'width:100%;padding:14px 16px;font-size:18px;border:2px solid #ddd;border-radius:8px;outline:none;box-sizing:border-box;text-align:center;transition:border-color 0.2s;';
        input.addEventListener('focus', () => { input.style.borderColor = '#ff9900'; });
        input.addEventListener('blur', () => { input.style.borderColor = '#ddd'; });

        const searchBtn = document.createElement('button');
        searchBtn.textContent = '\uD83D\uDD0D Search FC Research';
        searchBtn.style.cssText = 'display:block;width:100%;margin-top:16px;padding:14px;background:#ff9900;color:#111;font-size:16px;font-weight:bold;border:none;border-radius:8px;cursor:pointer;transition:background 0.2s;';
        searchBtn.addEventListener('mouseenter', () => { searchBtn.style.background = '#e88a00'; });
        searchBtn.addEventListener('mouseleave', () => { searchBtn.style.background = '#ff9900'; });

        const skipBtn = document.createElement('button');
        skipBtn.textContent = 'Skip';
        skipBtn.style.cssText = 'display:block;width:100%;margin-top:8px;padding:10px;background:transparent;color:#666;font-size:14px;border:1px solid #ddd;border-radius:8px;cursor:pointer;transition:background 0.2s;';
        skipBtn.addEventListener('mouseenter', () => { skipBtn.style.background = '#f5f5f5'; });
        skipBtn.addEventListener('mouseleave', () => { skipBtn.style.background = 'transparent'; });

        const status = document.createElement('p');
        status.style.cssText = 'margin:12px 0 0 0;font-size:13px;color:#c00;display:none;';

        function submitFBALabel() {
            const val = input.value.trim();
            if (!val) { status.textContent = 'Please scan or enter a barcode.'; status.style.display = 'block'; input.focus(); return; }
            status.textContent = 'Opening FC Research...'; status.style.color = '#067d06'; status.style.display = 'block';
            searchBtn.disabled = true; searchBtn.style.background = '#ccc'; searchBtn.style.cursor = 'default';
            clearCrossCookie('poirot_fc_ready'); clearCrossCookie('poirot_fc_asin');
            clearCrossCookie('poirot_fc_quantity'); clearCrossCookie('poirot_fc_empty');
            fcDataHandled = false; fcEmptyHandled = false;
            window.open(buildFCResultsUrl(val), '_blank');
            setTimeout(() => { overlay.remove(); fbaPopupShown = false; }, 1000);
        }

        function closePopup() { overlay.remove(); fbaPopupShown = false; waitingForFC = false; }

        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitFBALabel(); } });
        searchBtn.addEventListener('click', submitFBALabel);
        skipBtn.addEventListener('click', closePopup);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) closePopup(); });

        modal.appendChild(icon); modal.appendChild(title); modal.appendChild(subtitle);
        modal.appendChild(input); modal.appendChild(status); modal.appendChild(searchBtn); modal.appendChild(skipBtn);
        overlay.appendChild(modal); document.body.appendChild(overlay);
        setTimeout(() => { input.focus(); }, 100);
    }

    function setupSuccessBannerObserver() {
        const obs = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== Node.ELEMENT_NODE) continue;
                    const successEl = node.classList && node.classList.contains('alert--success')
                        ? node : node.querySelector && node.querySelector('.alert--success');
                    if (successEl) {
                        markSuccessFired();
                        setTimeout(() => {
                            const btn = document.getElementById('change-container-button');
                            if (btn) { btn.click(); if (btn.shadowRoot) { const ib = btn.shadowRoot.querySelector('button'); if (ib) ib.click(); } }
                        }, DELAY_AFTER_SUCCESS_BANNER);
                    }
                }
            }
        });
        obs.observe(document.body, { childList: true, subtree: true });
    }
    setupSuccessBannerObserver();

    function isSidelineApp() {
        if (document.getElementById('change-container-button')) return true;
        if (document.querySelector('alchemy-button#change-container-button')) return true;
        const te = document.querySelectorAll('header, nav, [class*="app-bar"], [class*="toolbar"], [class*="nav"], [class*="title"]');
        for (const el of te) { if (el.textContent.toLowerCase().includes('sideline')) return true; }
        if (document.title.toLowerCase().includes('sideline')) return true;
        const btns = document.querySelectorAll('button, alchemy-button');
        for (const b of btns) { const t = b.textContent.trim().toLowerCase(); if (t.includes('change container') || t.includes('back to source container')) return true; }
        return false;
    }

    function hasSuccessBanner() {
        const all = document.querySelectorAll('[class*="success"], [class*="Success"], [class*="banner"], [class*="toast"], [class*="alert"], [class*="notification"], [class*="message"]');
        for (const el of all) { if (el.textContent.trim().toLowerCase().includes('success')) return true; }
        const spans = document.querySelectorAll('span, div, p');
        for (const el of spans) { const t = el.textContent.trim(); if ((t === 'Success' || t.startsWith('Success')) && (el.offsetParent !== null || el.offsetHeight > 0)) return true; }
        return false;
    }

    function clickChangeContainer() {
        let btn = document.getElementById('change-container-button') || document.querySelector('alchemy-button#change-container-button') || document.querySelector('[id="change-container-button"]');
        if (!btn) { const c = document.querySelectorAll('alchemy-button, button'); for (const el of c) { if ((el.textContent || '').trim().toLowerCase().includes('change container')) { btn = el; break; } } }
        if (btn) {
            const r = btn.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
            btn.focus();
            btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1 }));
            btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
            btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1 }));
            btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
            btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
            btn.click();
            if (btn.shadowRoot) { const ib = btn.shadowRoot.querySelector('button'); if (ib) ib.click(); }
            return true;
        }
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', code: 'KeyC', keyCode: 67, which: 67, bubbles: true }));
        document.body.dispatchEvent(new KeyboardEvent('keypress', { key: 'c', code: 'KeyC', keyCode: 67, which: 67, bubbles: true }));
        document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'c', code: 'KeyC', keyCode: 67, which: 67, bubbles: true }));
        return false;
    }

    function handleSidelineSuccess() {
        if (sidelineSuccessHandled) return;
        if (isSidelineApp() && isScanPage() && hasSuccessBanner()) {
            sidelineSuccessHandled = true;
            markSuccessFired();
            setTimeout(() => { clickChangeContainer(); }, DELAY_BEFORE_CHANGE_CONTAINER);
        }
    }

    function clickItemMatch() {
        if (waitingForFC) return false;
        const btn = document.getElementById('confirm-button') || document.querySelector('button#confirm-button') || document.querySelector('.confirm-button-container button') || document.querySelector('button.btn-primary');
        if (btn) {
            const r = btn.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
            btn.focus();
            btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1 }));
            btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
            btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1 }));
            btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
            btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
            btn.click();
            return true;
        }
        pressEnter(document.body);
        return false;
    }

    function attachDestinationPasteListener() {
        if (destinationListenerAttached) return;
        const input = getScanInput();
        if (!input) return;
        destinationListenerAttached = true;
        input.addEventListener('paste', () => { setTimeout(() => { clickItemMatch(); }, DELAY_BEFORE_ENTER); });
        input.addEventListener('change', () => { if (input.value.length > 0) setTimeout(() => { clickItemMatch(); }, DELAY_BEFORE_CONFIRM); });
    }

    function openFCResearch(containerId) {
        const existing = document.getElementById('poirot-fc-btn');
        if (existing) existing.remove();
        waitingForFC = true;

        const btn = document.createElement('a');
        btn.id = 'poirot-fc-btn';
        btn.href = buildFCResultsUrl(containerId);
        btn.target = '_blank';
        btn.textContent = '\uD83D\uDD0D Search "' + containerId + '" on FC Research';
        btn.style.cssText = 'display:block;margin:16px auto;padding:14px 28px;background:#ff9900;color:#111;font-size:16px;font-weight:bold;text-align:center;text-decoration:none;border-radius:8px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.2);max-width:500px;';

        const allSpans = document.querySelectorAll('span, div, p');
        let noItemsEl = null;
        for (const el of allSpans) { if (el.textContent.trim() === 'No items found in this container.') { noItemsEl = el; break; } }
        if (noItemsEl) noItemsEl.parentNode.insertBefore(btn, noItemsEl.nextSibling);
        else document.body.appendChild(btn);

        clearCrossCookie('poirot_fc_ready'); clearCrossCookie('poirot_fc_asin');
        clearCrossCookie('poirot_fc_quantity'); clearCrossCookie('poirot_fc_empty');
        btn.click();
    }

    function checkForFCData() {
        const empty = getCrossCookie('poirot_fc_empty');
        if (empty && !fcEmptyHandled) {
            fcEmptyHandled = true;
            clearCrossCookie('poirot_fc_empty');
            showFBALabelPopup();
            return true;
        }
        const ready = getCrossCookie('poirot_fc_ready');
        if (ready && !fcDataHandled) {
            const asin = getCrossCookie('poirot_fc_asin');
            const quantity = getCrossCookie('poirot_fc_quantity');
            console.log('[Poirot] FC data — ASIN: ' + asin + ', Qty: ' + quantity);
            if (asin) {
                fcDataHandled = true;
                waitingForFC = false;
                clearCrossCookie('poirot_fc_ready');
                clearCrossCookie('poirot_fc_asin');
                const input = getScanInput();
                if (input) {
                    input.focus();
                    setNativeValue(input, asin);
                    lastFilledFNSKU = asin;
                    setTimeout(() => { clickItemMatch(); }, DELAY_BEFORE_CONFIRM);
                }
                if (quantity) sessionStorage.setItem('poirot_fc_quantity', quantity);
                return true;
            }
        }
        return false;
    }

    function fillQuantityFromFC() {
        settings = getSettings();
        if (!settings.autoQuantity) {
            console.log('[Poirot] Auto-quantity DISABLED by user. Skipping.');
            sessionStorage.removeItem('poirot_fc_quantity');
            clearCrossCookie('poirot_fc_quantity');
            return true;
        }

        const quantity = sessionStorage.getItem('poirot_fc_quantity');
        if (quantity) {
            const input = getScanInput();
            if (input) {
                input.focus();
                setNativeValue(input, quantity);
                setTimeout(() => { clickItemMatch(); sessionStorage.removeItem('poirot_fc_quantity'); clearCrossCookie('poirot_fc_quantity'); }, DELAY_BEFORE_CONFIRM);
                return true;
            }
        }
        return false;
    }

    // =============================================
    // MAIN CHECK
    // =============================================
    function mainCheck() {
        if (checkForFCData()) return;
        if (waitingForFC) return;

        // Page detection
        const onScan = isScanPage();
        const onDest = isDestinationPage();
        const onVerify = isVerifyPage();
        const onQty = isQuantityPage();
        const empty = isEmptyContainer();
        const hasBanner = hasSuccessBanner();
        const cooldown = isInSuccessCooldown();
        console.log('[Poirot] mainCheck — scan:' + onScan + ' dest:' + onDest + ' verify:' + onVerify + ' qty:' + onQty + ' empty:' + empty + ' banner:' + hasBanner + ' cooldown:' + cooldown + ' emptyHandled:' + emptyContainerHandled);

        if (isSidelineApp() && onScan && hasBanner) { handleSidelineSuccess(); return; }

        // Empty container check — on Scan Item page, no success banner, not in cooldown
        if (onScan && !hasBanner) {
            const cid = getSourceContainerId();

            if (empty && !emptyContainerHandled) {
                if (cooldown) {
                    console.log('[Poirot] Empty container during success cooldown — skipping FC lookup.');
                    return;
                }
                emptyContainerHandled = true;
                console.log('[Poirot] TRIGGERING FC Research for container: ' + (cid || 'NONE — showing FBA popup'));
                if (cid) { openFCResearch(cid); } else { showFBALabelPopup(); }
                return;
            } else if (!empty) {
                emptyContainerHandled = false; fcDataHandled = false; fcEmptyHandled = false; fbaPopupShown = false;
            }
        }

        if (onVerify) {
            if (!verifyHandled) { verifyHandled = true; setTimeout(() => { clickItemMatch(); }, DELAY_BEFORE_CONFIRM); }
        } else if (onQty) {
            if (!quantityHandled) {
                quantityHandled = true;
                settings = getSettings();
                if (!settings.autoQuantity) {
                    console.log('[Poirot] Auto-quantity DISABLED. Waiting for manual input.');
                    const quantity = sessionStorage.getItem('poirot_fc_quantity');
                    if (quantity) {
                        const input = getScanInput();
                        if (input) {
                            input.focus();
                            setNativeValue(input, quantity);
                            sessionStorage.removeItem('poirot_fc_quantity');
                            clearCrossCookie('poirot_fc_quantity');
                        }
                    }
                } else {
                    if (!fillQuantityFromFC()) setTimeout(() => { clickItemMatch(); }, DELAY_BEFORE_CONFIRM);
                }
            }
        } else if (onDest) {
            verifyHandled = false; quantityHandled = false; attachDestinationPasteListener();
        } else if (onScan) {
            verifyHandled = false; quantityHandled = false; destinationListenerAttached = false;
            if (!hasBanner) sidelineSuccessHandled = false;
            attemptAutoFill();
        } else {
            verifyHandled = false; quantityHandled = false; destinationListenerAttached = false; sidelineSuccessHandled = false;
            attemptAutoFill();
        }
    }

    let debounceTimer = null;
    function debouncedMainCheck() { clearTimeout(debounceTimer); debounceTimer = setTimeout(mainCheck, DELAY_BEFORE_FILL); }

    setInterval(() => {
        if (!fcDataHandled && getCrossCookie('poirot_fc_ready')) mainCheck();
        if (!fcEmptyHandled && getCrossCookie('poirot_fc_empty')) mainCheck();
    }, 1000);

    const observer = new MutationObserver(debouncedMainCheck);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    setTimeout(mainCheck, 1500);

    console.log('[Poirot Auto-Enter] v32.2 loaded — Shadow DOM aware page detection.');
})();

