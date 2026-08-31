
// ==UserScript==
// @name         Poirot V3 - Auto Fill FNSKU & Auto Confirm
// @namespace    http://tampermonkey.net/
// @version      33.4
// @description  Split-table SSCC fix (headers table + data table). GM_setValue cross-tab. Settings menu.
// @match        https://aft-poirot-website.na.aftx.amazonoperations.app/?tool=V3*
// @match        https://aft-poirot-website.na.aftx.amazonoperations.app/*tool=V3*
// @match        https://aft-poirot-website.na.aftx.amazonoperations.app/*
// @match        https://aft-poirot-website-iad.iad.proxy.amazon.com/?tool=V3*
// @match        https://aft-poirot-website-iad.iad.proxy.amazon.com/*tool=V3*
// @match        https://aft-poirot-website-iad.iad.proxy.amazon.com/*
// @match        https://qifcr.na.aftx.amazonoperations.app/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // =============================================
    // CROSS-TAB DATA — GM_setValue
    // =============================================
    var useGM = (typeof GM_setValue === 'function' && typeof GM_getValue === 'function');
    function setData(key, val) {
        if (useGM) { try { GM_setValue(key, String(val)); return; } catch(e) {} }
        try { localStorage.setItem(key, val); } catch(e) {}
    }
    function getData(key) {
        if (useGM) { try { var v = GM_getValue(key, ''); return v || ''; } catch(e) {} }
        try { var v2 = localStorage.getItem(key); return v2 || ''; } catch(e) {}
        return '';
    }
    function clearData(key) {
        if (useGM) { try { GM_setValue(key, ''); } catch(e) {} }
        try { localStorage.removeItem(key); } catch(e) {}
    }

    var SETTINGS_KEY = 'poirot_v3_settings';
    function getSettings() { try { var r = localStorage.getItem(SETTINGS_KEY); if (r) return JSON.parse(r); } catch(e) {} return { autoQuantity: true }; }
    function saveSettings(s) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch(e) {} }
    var settings = getSettings();

    function isValidCid(id) { return id && /^cs[A-Za-z][A-Za-z0-9]+$/i.test(id.trim()); }
    function buildUrl(s) { return 'https://qifcr.na.aftx.amazonoperations.app/KRB3/results?s=' + encodeURIComponent(s); }

    function isValidASIN(val) {
        if (!val) return false;
        val = val.trim();
        if (val.length !== 10) return false;
        if (!/^[A-Z0-9]{10}$/i.test(val)) return false;
        if (/^\d+$/.test(val)) return false;
        return true;
    }
    function isValidQty(val) {
        if (!val) return false;
        var n = parseInt(val, 10);
        return !isNaN(n) && n > 0 && n <= 9999;
    }

    // =============================================
    // FC RESEARCH PAGE
    // =============================================
    if (window.location.hostname.includes('qifcr.na.aftx.amazonoperations.app')) {
        var params = new URLSearchParams(window.location.search);
        if (params.get('autoSearch')) { window.location.replace(buildUrl(params.get('autoSearch'))); return; }

        var attempts = 0, MAX = 25, SDELAY = 1500, done = false, bestAsin = null, bestQty = null;

        function isInvHistEmpty() {
            var sec = document.querySelector('[data-section-type="inventory-history"]');
            if (sec) { var t = sec.textContent.toLowerCase(); if (/no matching records/i.test(t) || /showing\s+0\s+to\s+0/i.test(t)) return true; }
            var tbl = document.getElementById('table-inventory-history');
            if (!tbl) return sec ? true : null;
            var tb = tbl.querySelector('tbody');
            if (tb) {
                var bt = tb.textContent.toLowerCase();
                if (bt.includes('no matching') || bt.includes('no data')) return true;
                var rows = tb.querySelectorAll('tr');
                if (rows.length === 0) return true;
                if (rows.length === 1 && rows[0].querySelectorAll('td').length <= 1) return true;
            }
            return false;
        }

        function scrapeInvHist() {
            var asin = null, qty = null;
            var sec = document.querySelector('[data-section-type="inventory-history"]');
            var tbl = sec ? sec.querySelector('table') : null;
            if (!tbl) tbl = document.getElementById('table-inventory-history');
            if (!tbl) return { asin: null, quantity: null };
            var row = tbl.querySelector('tbody tr');
            if (!row) return { asin: null, quantity: null };
            var link = row.querySelector('a[href*="/results"]');
            if (link) { var v = link.textContent.trim(); if (isValidASIN(v)) asin = v; }
            var ths = Array.from(tbl.querySelectorAll('thead th')).map(function(th) { return th.textContent.trim().toLowerCase(); });
            var tds = row.querySelectorAll('td');
            var qi = ths.findIndex(function(h) { return h.includes('quantity') || h.includes('qty'); });
            if (qi >= 0 && tds[qi]) { var qm = tds[qi].textContent.trim().match(/(\d+)/); if (qm && isValidQty(qm[1])) qty = qm[1]; }
            return { asin: asin, quantity: qty };
        }

        // =============================================
        // SSCC SCRAPER — handles split tables
        // Table 1 = headers only (ASIN, Quantity, Title)
        // Table 2 = data only (empty TH + TD rows)
        // =============================================
        function scrapeSSCC() {
            var asin = null, qty = null;
            console.log('[Poirot] === SSCC Scraper Start ===');

            var sec = document.querySelector('[data-section-type="sscc-info"]');
            if (!sec) {
                var allEls = document.querySelectorAll('span, h1, h2, h3, h4, h5, h6, div');
                for (var h = 0; h < allEls.length; h++) {
                    var ht = allEls[h].textContent.trim().toLowerCase();
                    if (ht === 'sscc information' || ht === 'sscc info') {
                        sec = allEls[h].closest('[data-section-type]') || allEls[h].closest('section');
                        if (!sec) { var p = allEls[h].parentElement; for (var w = 0; w < 10 && p; w++) { if (p.querySelector('table')) { sec = p; break; } p = p.parentElement; } }
                        if (sec) break;
                    }
                }
            }

            if (!sec) { console.log('[Poirot] SSCC section NOT found'); return { asin: null, quantity: null }; }
            console.log('[Poirot] SSCC section found: ' + sec.tagName + '.' + (sec.className || '').substring(0, 50));

            var tables = sec.querySelectorAll('table');
            console.log('[Poirot] SSCC tables found: ' + tables.length);

            // Strategy: find the header table (has ASIN/Quantity TH) and the data table (next one)
            var headerCols = null; // { ai: index, qi: index }
            var dataTable = null;

            for (var t = 0; t < tables.length; t++) {
                var tbl = tables[t];

                // Get all TH text from this table
                var allTH = Array.from(tbl.querySelectorAll('th')).map(function(th) { return th.textContent.trim().toLowerCase(); });
                // Get all TD elements
                var allTD = tbl.querySelectorAll('td');

                console.log('[Poirot] Table #' + t + ' TH: ' + JSON.stringify(allTH) + ' TD count: ' + allTD.length);

                var ai = allTH.findIndex(function(x) { return x === 'asin' || x.includes('asin'); });
                var qi = allTH.findIndex(function(x) { return x === 'quantity' || x === 'qty' || x.includes('quantity') || x.includes('qty'); });

                // Case A: Table has ASIN header AND has TD data rows → complete table
                if (ai >= 0) {
                    // Check if this table has actual TD data
                    var dataRows = Array.from(tbl.querySelectorAll('tr')).filter(function(row) {
                        return row.querySelectorAll('td').length > 0;
                    });

                    if (dataRows.length > 0) {
                        // Complete table — headers and data in same table
                        console.log('[Poirot] Table #' + t + ' — complete table with ASIN col=' + ai + ' Qty col=' + qi);
                        for (var r = 0; r < dataRows.length; r++) {
                            var cells = dataRows[r].querySelectorAll('td');
                            var rv = Array.from(cells).map(function(c) { return c.textContent.trim().substring(0, 50); });
                            console.log('[Poirot] Table #' + t + ' data row ' + r + ': ' + JSON.stringify(rv));

                            if (ai < cells.length) {
                                var val = cells[ai].textContent.trim();
                                var lnk = cells[ai].querySelector('a');
                                if (lnk) val = lnk.textContent.trim();
                                if (isValidASIN(val)) asin = val;
                            }
                            if (qi >= 0 && qi < cells.length) {
                                var raw = cells[qi].textContent.trim();
                                if (/^\d+$/.test(raw) && isValidQty(raw)) qty = raw;
                            }
                            if (asin) break;
                        }
                    } else {
                        // Header-only table — save column positions, data is in next table
                        console.log('[Poirot] Table #' + t + ' — header-only (ASIN col=' + ai + ' Qty col=' + qi + ')');
                        headerCols = { ai: ai, qi: qi };
                    }
                }

                // Case B: Table has no meaningful headers but has TD data — check if previous table had headers
                if (ai < 0 && headerCols && allTD.length > 0) {
                    dataTable = tbl;
                    console.log('[Poirot] Table #' + t + ' — using as data table for previous headers');

                    var dRows = Array.from(tbl.querySelectorAll('tr')).filter(function(row) {
                        return row.querySelectorAll('td').length > 0;
                    });

                    for (var r2 = 0; r2 < dRows.length; r2++) {
                        var cells2 = dRows[r2].querySelectorAll('td');
                        var rv2 = Array.from(cells2).map(function(c) { return c.textContent.trim().substring(0, 50); });
                        console.log('[Poirot] Data row ' + r2 + ': ' + JSON.stringify(rv2));

                        if (headerCols.ai >= 0 && headerCols.ai < cells2.length) {
                            var val2 = cells2[headerCols.ai].textContent.trim();
                            var lnk2 = cells2[headerCols.ai].querySelector('a');
                            if (lnk2) val2 = lnk2.textContent.trim();
                            console.log('[Poirot] ASIN candidate: "' + val2 + '" valid: ' + isValidASIN(val2));
                            if (isValidASIN(val2)) asin = val2;
                        }
                        if (headerCols.qi >= 0 && headerCols.qi < cells2.length) {
                            var raw2 = cells2[headerCols.qi].textContent.trim();
                            console.log('[Poirot] Qty candidate: "' + raw2 + '" valid: ' + isValidQty(raw2));
                            if (/^\d+$/.test(raw2) && isValidQty(raw2)) qty = raw2;
                        }

                        // Fallback: scan cells
                        if (!asin) {
                            for (var c = 0; c < cells2.length; c++) {
                                var cv = cells2[c].textContent.trim();
                                if (isValidASIN(cv)) { asin = cv; console.log('[Poirot] ASIN fallback cell ' + c + ': ' + cv); break; }
                            }
                        }
                        if (asin && !qty) {
                            for (var c2 = 0; c2 < cells2.length; c2++) {
                                var tx = cells2[c2].textContent.trim();
                                if (/^\d+$/.test(tx) && isValidQty(tx)) { qty = tx; console.log('[Poirot] Qty fallback cell ' + c2 + ': ' + tx); break; }
                            }
                        }
                        if (asin) break;
                    }
                }

                if (asin) break;
            }

            // Text fallback
            if (!asin || !qty) {
                var secText = sec.textContent;
                console.log('[Poirot] SSCC text fallback (500 chars): ' + secText.substring(0, 500));
                if (!asin) {
                    var am = secText.match(/ASIN[\s:]*([A-Z0-9]{10})/i);
                    if (am && isValidASIN(am[1])) { asin = am[1]; console.log('[Poirot] ASIN from text: ' + asin); }
                }
                if (!asin) {
                    var allM = secText.match(/[A-Z][A-Z0-9]{9}/g);
                    if (allM) { for (var x = 0; x < allM.length; x++) { if (isValidASIN(allM[x])) { asin = allM[x]; console.log('[Poirot] ASIN from text scan: ' + asin); break; } } }
                }
                if (!qty) {
                    var qm = secText.match(/Quantity[\s:]*(\d+)/i);
                    if (qm && isValidQty(qm[1])) { qty = qm[1]; console.log('[Poirot] Qty from text: ' + qty); }
                }
                if (asin && !qty) {
                    var idx = secText.indexOf(asin);
                    if (idx >= 0) { var after = secText.substring(idx + asin.length, idx + asin.length + 50); var qm2 = after.match(/(\d+)/); if (qm2 && isValidQty(qm2[1])) { qty = qm2[1]; console.log('[Poirot] Qty after ASIN: ' + qty); } }
                }
            }

            console.log('[Poirot] === SSCC Result: ASIN=' + (asin || 'null') + ', Qty=' + (qty || 'null') + ' ===');
            return { asin: asin, quantity: qty };
        }

        function scrapeAndSend() {
            if (done) return;
            attempts++;
            var asin = null, qty = null;

            if (isInvHistEmpty() === false) {
                var inv = scrapeInvHist();
                if (inv.asin) asin = inv.asin;
                if (inv.quantity) qty = inv.quantity;
                if (asin) console.log('[Poirot] InvHist: ASIN=' + asin + ' Qty=' + (qty || 'null'));
            }

            if (!asin || !qty) {
                var sscc = scrapeSSCC();
                if (sscc.asin) asin = sscc.asin;
                if (sscc.quantity) qty = sscc.quantity;
            }

            if (asin && isValidASIN(asin)) bestAsin = asin;
            if (qty && isValidQty(qty)) bestQty = qty;

            console.log('[Poirot] Attempt ' + attempts + '/' + MAX + ' — Best: ASIN=' + (bestAsin || 'null') + ', Qty=' + (bestQty || 'null'));

            if (bestAsin && bestQty) {
                done = true;
                setData('poirot_fc_asin', bestAsin);
                setData('poirot_fc_quantity', bestQty);
                setData('poirot_fc_ready', 'true');
                console.log('[Poirot] SUCCESS — ASIN: ' + bestAsin + ', Qty: ' + bestQty);
                setTimeout(function() { window.close(); }, 500);
                return;
            }

            if (attempts < MAX) { setTimeout(scrapeAndSend, SDELAY); return; }

            done = true;
            if (bestAsin) {
                setData('poirot_fc_asin', bestAsin);
                if (bestQty) setData('poirot_fc_quantity', bestQty);
                setData('poirot_fc_ready', 'true');
            } else {
                setData('poirot_fc_empty', 'true');
            }
            setTimeout(function() { window.close(); }, 500);
        }

        new MutationObserver(function() { if (!done) setTimeout(scrapeAndSend, 1500); }).observe(document.body, { childList: true, subtree: true });
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
    var D_FILL = 500, D_ENTER = 150, D_CONFIRM = 300, D_CHANGE = 600, D_BANNER = 800, COOL_MS = 5000;
    var lastFN = '', verifyH = false, qtyH = false, destH = false, successH = false, emptyH = false;
    var fcDataH = false, fbaShown = false, fcEmptyH = false, waitFC = false, lastSucc = 0, lastCid = '';

    function markSucc() { lastSucc = Date.now(); }
    function inCool() { return (Date.now() - lastSucc) < COOL_MS; }

    function getVisibleHeading() {
        var candidates = document.querySelectorAll(
            'span.text--size-xxl, span.a-size-extra-large, main h1, main h2, main h3, ' +
            '[class*="content"] h1, [class*="content"] h2, h1, h2, h3'
        );
        for (var i = 0; i < candidates.length; i++) {
            var el = candidates[i];
            var rect = el.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) continue;
            var style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
            var t = el.textContent.replace(/\s+/g, ' ').trim().toLowerCase();
            if (t.length > 0 && t.length < 120) return t;
        }
        var shadowEls = document.querySelectorAll('alchemy-heading, [class*="heading"], [class*="title"]');
        for (var j = 0; j < shadowEls.length; j++) {
            var sr = shadowEls[j].shadowRoot;
            if (sr) { var sh = sr.querySelector('h1, h2, h3, span'); if (sh) { var st = sh.textContent.replace(/\s+/g, ' ').trim().toLowerCase(); if (st.length > 0 && st.length < 120) return st; } }
            var rect2 = shadowEls[j].getBoundingClientRect();
            if (rect2.width === 0 && rect2.height === 0) continue;
            var t2 = shadowEls[j].textContent.replace(/\s+/g, ' ').trim().toLowerCase();
            if (t2.length > 0 && t2.length < 120) return t2;
        }
        return '';
    }

    function getPageState() {
        var h = getVisibleHeading();
        console.log('[Poirot] heading: "' + h + '"');
        if (h.includes('verify item') || h.includes('verify the item')) return 'verify';
        if (h.includes('enter quantity') || h === 'quantity') return 'quantity';
        if (h.includes('scan destination') || h.includes('destination container')) return 'destination';
        if (h.includes('scan item') || h.includes('scan the item')) return 'scan';
        var inp = getInput();
        if (inp) {
            var ph = (inp.placeholder || '').toLowerCase();
            if (ph.includes('destination') || ph.includes('dest')) return 'destination';
            if (ph.includes('quantity') || ph.includes('qty')) return 'quantity';
            if (ph.includes('verify')) return 'verify';
            if (ph.includes('scan')) return 'scan';
        }
        var cb = document.getElementById('change-container-button') || document.querySelector('alchemy-button#change-container-button');
        if (cb) return 'scan';
        return 'unknown';
    }

    function isEmp() {
        if (getFNSKU()) return false;
        var candidates = document.querySelectorAll('span, p, div');
        for (var i = 0; i < candidates.length; i++) {
            var el = candidates[i];
            var t = el.textContent.trim().toLowerCase();
            if (t !== 'no items found' && t !== 'no items found in this container' && t !== 'no items found in this container.') continue;
            var rect = el.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) continue;
            var style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') continue;
            return true;
        }
        return false;
    }

    function hasBan() {
        var all = document.querySelectorAll('[class*="alert--success"], [class*="success-banner"], [class*="toast"]');
        for (var i = 0; i < all.length; i++) {
            var rect = all[i].getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) continue;
            var style = window.getComputedStyle(all[i]);
            if (style.display === 'none' || style.visibility === 'hidden') continue;
            if (all[i].textContent.trim().toLowerCase().includes('success')) return true;
        }
        return false;
    }

    function getCid() {
        var lbl = document.getElementById('source-container-label');
        if (lbl) { var t = lbl.textContent.trim(); if (isValidCid(t)) return t; }
        var els = document.querySelectorAll('span, div, p, label');
        for (var i = 0; i < els.length; i++) {
            var t2 = els[i].textContent.trim();
            if (isValidCid(t2)) {
                var par = els[i].parentElement;
                if (par) { var pt = par.textContent.toLowerCase(); if (pt.includes('source container') || pt.includes('change container')) return t2; }
            }
        }
        return null;
    }

    // =============================================
    // SETTINGS MENU
    // =============================================
    function createMenu() {
        if (document.getElementById('poirot-gear')) return;
        var gear = document.createElement('div'); gear.id = 'poirot-gear'; gear.textContent = '\u2699\uFE0F'; gear.title = 'Poirot V3 Settings';
        gear.style.cssText = 'position:fixed;bottom:20px;right:20px;width:48px;height:48px;background:#232f3e;color:#ff9900;font-size:26px;line-height:48px;text-align:center;border-radius:50%;cursor:pointer;z-index:99998;box-shadow:0 2px 12px rgba(0,0,0,0.3);transition:transform 0.2s,background 0.2s;user-select:none;';
        gear.addEventListener('mouseenter', function() { gear.style.transform = 'rotate(45deg) scale(1.1)'; gear.style.background = '#37475a'; });
        gear.addEventListener('mouseleave', function() { gear.style.transform = 'rotate(0deg) scale(1)'; gear.style.background = '#232f3e'; });
        var panel = document.createElement('div'); panel.id = 'poirot-panel';
        panel.style.cssText = 'position:fixed;bottom:80px;right:20px;width:300px;background:#fff;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.25);z-index:99999;overflow:hidden;display:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;transition:opacity 0.2s,transform 0.2s;transform:translateY(10px);opacity:0;';
        var hdr = document.createElement('div'); hdr.style.cssText = 'background:#232f3e;color:#fff;padding:16px 20px;display:flex;align-items:center;justify-content:space-between;';
        var ht = document.createElement('span'); ht.textContent = '\u2699\uFE0F Poirot V3 Settings'; ht.style.cssText = 'font-size:16px;font-weight:bold;';
        var hv = document.createElement('span'); hv.textContent = 'v33.4'; hv.style.cssText = 'font-size:12px;color:#ff9900;background:#37475a;padding:2px 8px;border-radius:10px;';
        hdr.appendChild(ht); hdr.appendChild(hv);
        var body = document.createElement('div'); body.style.cssText = 'padding:16px 20px;';
        body.appendChild(mkToggle('Auto Enter Quantity', 'Automatically fills and confirms the quantity.', settings.autoQuantity, function(v) { settings.autoQuantity = v; saveSettings(settings); }));
        var dv = document.createElement('div'); dv.style.cssText = 'height:1px;background:#eee;margin:12px 0;'; body.appendChild(dv);
        var sr = document.createElement('div'); sr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;';
        var sl = document.createElement('span'); sl.textContent = 'Script Status'; sl.style.cssText = 'font-size:13px;color:#555;';
        var sb = document.createElement('span'); sb.textContent = '\u2705 Active'; sb.style.cssText = 'font-size:12px;color:#067d06;background:#e6f9e6;padding:3px 10px;border-radius:10px;font-weight:600;';
        sr.appendChild(sl); sr.appendChild(sb); body.appendChild(sr);
        panel.appendChild(hdr); panel.appendChild(body);
        var open = false;
        gear.addEventListener('click', function() {
            open = !open;
            if (open) { panel.style.display = 'block'; requestAnimationFrame(function() { panel.style.opacity = '1'; panel.style.transform = 'translateY(0)'; }); }
            else { panel.style.opacity = '0'; panel.style.transform = 'translateY(10px)'; setTimeout(function() { panel.style.display = 'none'; }, 200); }
        });
        document.addEventListener('click', function(e) {
            if (open && !panel.contains(e.target) && e.target !== gear) {
                open = false; panel.style.opacity = '0'; panel.style.transform = 'translateY(10px)';
                setTimeout(function() { panel.style.display = 'none'; }, 200);
            }
        });
        document.body.appendChild(gear); document.body.appendChild(panel);
    }
    function mkToggle(label, desc, init, onChange) {
        var row = document.createElement('div'); row.style.cssText = 'display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:4px;';
        var tc = document.createElement('div'); tc.style.cssText = 'flex:1;';
        var lb = document.createElement('div'); lb.textContent = label; lb.style.cssText = 'font-size:14px;font-weight:600;color:#111;margin-bottom:2px;';
        var ds = document.createElement('div'); ds.textContent = desc; ds.style.cssText = 'font-size:12px;color:#888;line-height:1.3;';
        tc.appendChild(lb); tc.appendChild(ds);
        var tg = document.createElement('div'); tg.style.cssText = 'width:44px;min-width:44px;height:24px;border-radius:12px;cursor:pointer;position:relative;transition:background 0.2s;margin-top:2px;' + (init ? 'background:#ff9900;' : 'background:#ccc;');
        var kn = document.createElement('div'); kn.style.cssText = 'width:20px;height:20px;border-radius:50%;background:#fff;position:absolute;top:2px;transition:left 0.2s;box-shadow:0 1px 3px rgba(0,0,0,0.2);' + (init ? 'left:22px;' : 'left:2px;');
        tg.appendChild(kn);
        var st = init;
        tg.addEventListener('click', function() { st = !st; tg.style.background = st ? '#ff9900' : '#ccc'; kn.style.left = st ? '22px' : '2px'; onChange(st); });
        row.appendChild(tc); row.appendChild(tg); return row;
    }
    setTimeout(createMenu, 1000);

    function getFNSKU() {
        var tags = document.querySelectorAll('alchemy-tag');
        for (var i = 0; i < tags.length; i++) {
            var r = tags[i].shadowRoot; if (r) { var m = (r.textContent || '').match(/FNSKU\s*:\s*([A-Z0-9]+)/i); if (m) return m[1]; }
            var m2 = (tags[i].textContent || '').match(/FNSKU\s*:\s*([A-Z0-9]+)/i); if (m2) return m2[1];
        }
        return sDeep(document.body);
    }
    function sDeep(n) {
        if (n.nodeType === Node.TEXT_NODE) { var m = n.textContent.match(/FNSKU\s*:\s*([A-Z0-9]+)/i); if (m) return m[1]; }
        if (n.shadowRoot) { var r = sDeep(n.shadowRoot); if (r) return r; }
        var ch = n.children || n.childNodes || [];
        for (var i = 0; i < ch.length; i++) { var r2 = sDeep(ch[i]); if (r2) return r2; }
        return null;
    }

    function getInput() {
        var inps = document.querySelectorAll('input[type="text"], input:not([type]), input[type="search"]');
        for (var i = 0; i < inps.length; i++) { if (inps[i].offsetParent !== null) return inps[i]; }
        var ai = document.querySelectorAll('alchemy-input, alchemy-text-field');
        for (var j = 0; j < ai.length; j++) { if (ai[j].shadowRoot) { var inp = ai[j].shadowRoot.querySelector('input'); if (inp) return inp; } }
        return null;
    }

    function setVal(inp, v) {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(inp, v);
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function pressEnter(el) {
        ['keydown', 'keypress', 'keyup'].forEach(function(t) {
            el.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        });
    }

    function autoFill() {
        if (waitFC) return;
        var fn = getFNSKU(), inp = getInput();
        console.log('[Poirot] autoFill — FNSKU:' + (fn || 'null') + ' input:' + (inp ? 'found' : 'null') + ' val:"' + (inp ? inp.value : '') + '"');
        if (!fn || !inp || inp.value !== '') return;
        console.log('[Poirot] autoFill FILLING: ' + fn);
        inp.focus(); setVal(inp, fn); lastFN = fn;
        setTimeout(function() { pressEnter(inp); }, D_ENTER);
    }

    function showFBA() {
        if (document.getElementById('poirot-fba')) return;
        fbaShown = true; waitFC = true;
        var ov = document.createElement('div'); ov.id = 'poirot-fba';
        ov.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:99999;display:flex;align-items:center;justify-content:center;';
        var md = document.createElement('div');
        md.style.cssText = 'background:#fff;border-radius:12px;padding:32px;max-width:460px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.3);text-align:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';
        var ic = document.createElement('div'); ic.textContent = '\uD83D\uDCE6'; ic.style.cssText = 'font-size:48px;margin-bottom:12px;';
        var ti = document.createElement('h2'); ti.textContent = 'No Inventory Found'; ti.style.cssText = 'margin:0 0 8px 0;font-size:20px;color:#111;';
        var su = document.createElement('p'); su.textContent = 'FC Research returned no inventory history. Scan or type the FBA shipping label barcode.';
        su.style.cssText = 'margin:0 0 20px 0;font-size:14px;color:#555;line-height:1.4;';
        var inp = document.createElement('input'); inp.type = 'text'; inp.placeholder = 'Scan FBA label barcode...'; inp.autocomplete = 'off';
        inp.style.cssText = 'width:100%;padding:14px 16px;font-size:18px;border:2px solid #ddd;border-radius:8px;outline:none;box-sizing:border-box;text-align:center;transition:border-color 0.2s;';
        inp.addEventListener('focus', function() { inp.style.borderColor = '#ff9900'; });
        inp.addEventListener('blur', function() { inp.style.borderColor = '#ddd'; });
        var sBtn = document.createElement('button'); sBtn.textContent = '\uD83D\uDD0D Search FC Research';
        sBtn.style.cssText = 'display:block;width:100%;margin-top:16px;padding:14px;background:#ff9900;color:#111;font-size:16px;font-weight:bold;border:none;border-radius:8px;cursor:pointer;';
        var sk = document.createElement('button'); sk.textContent = 'Skip';
        sk.style.cssText = 'display:block;width:100%;margin-top:8px;padding:10px;background:transparent;color:#666;font-size:14px;border:1px solid #ddd;border-radius:8px;cursor:pointer;';
        var st = document.createElement('p'); st.style.cssText = 'margin:12px 0 0 0;font-size:13px;color:#c00;display:none;';
        function submit() {
            var v = inp.value.trim();
            if (!v) { st.textContent = 'Please enter a barcode.'; st.style.display = 'block'; inp.focus(); return; }
            st.textContent = 'Opening FC Research...'; st.style.color = '#067d06'; st.style.display = 'block';
            sBtn.disabled = true; sBtn.style.background = '#ccc';
            clearData('poirot_fc_ready'); clearData('poirot_fc_asin'); clearData('poirot_fc_quantity'); clearData('poirot_fc_empty');
            fcDataH = false; fcEmptyH = false;
            window.open(buildUrl(v), '_blank');
            setTimeout(function() { ov.remove(); fbaShown = false; }, 1000);
        }
        function close() { ov.remove(); fbaShown = false; waitFC = false; }
        inp.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
        sBtn.addEventListener('click', submit); sk.addEventListener('click', close);
        ov.addEventListener('click', function(e) { if (e.target === ov) close(); });
        md.appendChild(ic); md.appendChild(ti); md.appendChild(su); md.appendChild(inp); md.appendChild(st); md.appendChild(sBtn); md.appendChild(sk);
        ov.appendChild(md); document.body.appendChild(ov);
        setTimeout(function() { inp.focus(); }, 100);
    }

    new MutationObserver(function(muts) {
        for (var i = 0; i < muts.length; i++) {
            for (var j = 0; j < muts[i].addedNodes.length; j++) {
                var n = muts[i].addedNodes[j]; if (n.nodeType !== 1) continue;
                var se = (n.classList && n.classList.contains('alert--success')) ? n : (n.querySelector ? n.querySelector('.alert--success') : null);
                if (se) { markSucc(); setTimeout(function() { clickCh(); }, D_BANNER); }
            }
        }
    }).observe(document.body, { childList: true, subtree: true });

    function isSL() {
        if (document.getElementById('change-container-button') || document.querySelector('alchemy-button#change-container-button')) return true;
        if (document.title.toLowerCase().includes('sideline')) return true;
        return false;
    }

    function clickCh() {
        var btn = document.getElementById('change-container-button') || document.querySelector('alchemy-button#change-container-button');
        if (!btn) { var c = document.querySelectorAll('alchemy-button, button'); for (var i = 0; i < c.length; i++) { if ((c[i].textContent || '').trim().toLowerCase().includes('change container')) { btn = c[i]; break; } } }
        if (btn) { btn.focus(); btn.click(); if (btn.shadowRoot) { var ib = btn.shadowRoot.querySelector('button'); if (ib) ib.click(); } return true; }
        return false;
    }

    function clickConf() {
        if (waitFC) return false;
        var btn = document.getElementById('confirm-button') || document.querySelector('button#confirm-button') || document.querySelector('.confirm-button-container button') || document.querySelector('button.btn-primary');
        if (btn) { btn.focus(); btn.click(); return true; }
        pressEnter(document.body); return false;
    }

    function attachDest() {
        if (destH) return; var inp = getInput(); if (!inp) return; destH = true;
        inp.addEventListener('paste', function() { setTimeout(function() { clickConf(); }, D_ENTER); });
        inp.addEventListener('change', function() { if (inp.value.length > 0) setTimeout(function() { clickConf(); }, D_CONFIRM); });
    }

    function openFC(cid) {
        var ex = document.getElementById('poirot-fc-btn'); if (ex) ex.remove();
        waitFC = true;
        clearData('poirot_fc_ready'); clearData('poirot_fc_asin'); clearData('poirot_fc_quantity'); clearData('poirot_fc_empty');
        var btn = document.createElement('a'); btn.id = 'poirot-fc-btn'; btn.href = buildUrl(cid); btn.target = '_blank';
        btn.textContent = '\uD83D\uDD0D Search "' + cid + '" on FC Research';
        btn.style.cssText = 'display:block;margin:16px auto;padding:14px 28px;background:#ff9900;color:#111;font-size:16px;font-weight:bold;text-align:center;text-decoration:none;border-radius:8px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.2);max-width:500px;';
        var spans = document.querySelectorAll('span, div, p'); var noEl = null;
        for (var i = 0; i < spans.length; i++) { if (spans[i].textContent.trim() === 'No items found in this container.') { noEl = spans[i]; break; } }
        if (noEl) noEl.parentNode.insertBefore(btn, noEl.nextSibling); else document.body.appendChild(btn);
        btn.click();
    }

    function checkFC() {
        var emp = getData('poirot_fc_empty');
        if (emp === 'true' && !fcEmptyH) { fcEmptyH = true; clearData('poirot_fc_empty'); showFBA(); return true; }
        var rdy = getData('poirot_fc_ready');
        if (rdy === 'true' && !fcDataH) {
            var asin = getData('poirot_fc_asin');
            var qty = getData('poirot_fc_quantity');
            console.log('[Poirot] FC ready — ASIN:' + asin + ' Qty:' + qty + ' validASIN:' + isValidASIN(asin) + ' validQty:' + isValidQty(qty));
            if (asin && isValidASIN(asin)) {
                fcDataH = true; waitFC = false;
                clearData('poirot_fc_ready'); clearData('poirot_fc_asin'); clearData('poirot_fc_quantity');
                lastFN = '';
                var inp = getInput();
                if (inp) { inp.focus(); setVal(inp, asin); lastFN = asin; setTimeout(function() { clickConf(); }, D_CONFIRM); }
                if (qty && isValidQty(qty)) sessionStorage.setItem('poirot_fc_quantity', qty);
                return true;
            } else if (asin && !isValidASIN(asin)) {
                console.log('[Poirot] Invalid ASIN: "' + asin + '" — showing FBA popup');
                fcDataH = true; waitFC = false;
                clearData('poirot_fc_ready'); clearData('poirot_fc_asin'); clearData('poirot_fc_quantity');
                showFBA();
                return true;
            }
        }
        return false;
    }

    function fillQty() {
        settings = getSettings();
        if (!settings.autoQuantity) { sessionStorage.removeItem('poirot_fc_quantity'); return true; }
        var qty = sessionStorage.getItem('poirot_fc_quantity');
        if (qty && isValidQty(qty)) {
            var inp = getInput();
            if (inp) { inp.focus(); setVal(inp, qty); setTimeout(function() { clickConf(); sessionStorage.removeItem('poirot_fc_quantity'); }, D_CONFIRM); return true; }
        }
        return false;
    }

    function mainCheck() {
        if (checkFC()) return;
        if (waitFC) return;

        var state = getPageState();
        var emp = isEmp();
        var ban = hasBan();
        var cool = inCool();
        var cid = getCid();

        if (cid && cid !== lastCid) {
            console.log('[Poirot] Container: ' + lastCid + ' → ' + cid);
            lastCid = cid; lastFN = '';
            emptyH = false; fcDataH = false; fcEmptyH = false; fbaShown = false;
            successH = false; verifyH = false; qtyH = false; destH = false;
        }

        console.log('[Poirot] state:' + state + ' empty:' + emp + ' ban:' + ban + ' cool:' + cool + ' cid:' + (cid || 'null'));

        if (state === 'scan' && ban && isSL()) {
            if (!successH) { successH = true; markSucc(); setTimeout(function() { clickCh(); }, D_CHANGE); }
            return;
        }

        switch (state) {
            case 'scan':
                successH = false; verifyH = false; qtyH = false; destH = false;
                if (emp && !emptyH) {
                    if (cool) return;
                    emptyH = true;
                    console.log('[Poirot] TRIGGER FC: ' + (cid || 'NONE'));
                    if (cid) openFC(cid); else showFBA();
                } else if (!emp) {
                    emptyH = false; fcDataH = false; fcEmptyH = false; fbaShown = false;
                    autoFill();
                }
                break;
            case 'verify':
                if (!verifyH) { verifyH = true; setTimeout(function() { clickConf(); }, D_CONFIRM); }
                break;
            case 'quantity':
                if (!qtyH) {
                    qtyH = true; settings = getSettings();
                    if (!settings.autoQuantity) {
                        var q = sessionStorage.getItem('poirot_fc_quantity');
                        if (q) { var inp2 = getInput(); if (inp2) { inp2.focus(); setVal(inp2, q); sessionStorage.removeItem('poirot_fc_quantity'); } }
                    } else { if (!fillQty()) setTimeout(function() { clickConf(); }, D_CONFIRM); }
                }
                break;
            case 'destination':
                verifyH = false; qtyH = false; attachDest();
                break;
            default:
                autoFill();
                break;
        }
    }

    var deb = null;
    function debCheck() { clearTimeout(deb); deb = setTimeout(mainCheck, D_FILL); }
    setInterval(function() {
        var rdy = getData('poirot_fc_ready');
        var emp2 = getData('poirot_fc_empty');
        if (rdy === 'true' && !fcDataH) mainCheck();
        if (emp2 === 'true' && !fcEmptyH) mainCheck();
    }, 500);
    new MutationObserver(debCheck).observe(document.body, { childList: true, subtree: true, characterData: true });
    setTimeout(mainCheck, 1500);

    console.log('[Poirot] v33.4 loaded — split-table SSCC + GM_setValue + ASIN validation.');
})();

