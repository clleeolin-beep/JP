class AppCore {
            constructor() {
                this.dataStore = [];
                this.colMap = {};
                this.headerRow = [];
                this.accessToken = null;
                this.tokenClient = null;
                this.isEditMode = false;
                this.hasWriteAccess = false;
                this.isSyncing = false;
                this.sortDir = 'desc';
                this.rulesRawData = [];
                this.lastRulesDiagnosticText = '';

                document.addEventListener('click', (e) => {
                    if (!document.getElementById('af-filter-container')?.contains(e.target)) {
                        const dd = document.getElementById('af-dropdown');
                        if (dd) dd.style.display = 'none';
                    }
                });

                document.getElementById('drop_area')?.addEventListener('click', () => {
                    document.getElementById('fileInputPhoto').click();
                });

                document.getElementById('drop_area')?.addEventListener('dragover', (e) => {
                    e.preventDefault();
                });

                document.getElementById('drop_area')?.addEventListener('drop', (e) => {
                    e.preventDefault();
                    if (e.dataTransfer.files?.[0]) cropperSvc.handleFile(e.dataTransfer.files[0], false);
                });

                document.addEventListener('paste', (e) => {
                    const item = [...(e.clipboardData?.items || [])].find(i => i.type.includes('image'));
                    if (item && this.isEditMode) {
                        cropperSvc.handleFile(item.getAsFile(), true);
                        return;
                    }

                    const activeTag = document.activeElement?.tagName;
                    if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;

                    const text = (e.clipboardData || window.clipboardData).getData('text');
                    const html = (e.clipboardData || window.clipboardData).getData('text/html') || '';
                    if (!text) return;

                    e.preventDefault();
                    if (!this.isEditMode) this.toggleMode();
                    document.getElementById('v_magic_paste').value = text;

                    if (/^https?:\/\/[^\s]+$/i.test(text.trim()) && /(list|cast|girls-list|schedule)/i.test(text)) {
                        this.fetchAndProcessList(text.trim());
                    } else {
                        this.processMagicPaste(text, html);
                    }
                });
            }

            populateTimeDropdowns() {
                const starts = document.getElementById('filterTimeStart');
                const ends = document.getElementById('filterTimeEnd');
                if (!starts || !ends) return;

                const opts = ['06:00','08:00','10:00','12:00','14:00','16:00','18:00','20:00','22:00','24:00'];
                starts.innerHTML = '<option value="">時間起</option>' + opts.map(t => `<option value="${t}">${t}</option>`).join('');
                ends.innerHTML = '<option value="">時間迄</option>' + opts.map(t => `<option value="${t}">${t}</option>`).join('');
            }

            toggleMode() {
                this.isEditMode = !this.isEditMode;
                document.getElementById('app-container').classList.toggle('view-mode', !this.isEditMode);
                document.getElementById('btn-mode-toggle').style.background = this.isEditMode ? '#2e7d32' : '#e91e63';
                this.renderCatalog();
                this.updateBatchActionsBar();
            }

            toggleAfDropdown() {
                const dd = document.getElementById('af-dropdown');
                if (!dd) return;
                dd.style.display = dd.style.display === 'flex' ? 'none' : 'flex';
            }

            buildAfFilterOptions() {
                const box = document.getElementById('af-checkboxes');
                if (!box) return;

                const allTags = new Set();
                this.dataStore.forEach(item => {
                    String(item._raw[this.colMap.af] || '')
                        .split(/[\/／]/)
                        .map(t => t.trim())
                        .filter(Boolean)
                        .forEach(t => allTags.add(t));
                });

                const selected = new Set(this.getSelectedAfValues());
                box.innerHTML = Array.from(allTags).sort().map(tag => `
                    <label>
                        <input type="checkbox" value="${tag}" ${selected.size === 0 || selected.has(tag) ? 'checked' : ''} onchange="app.renderCatalog()">
                        ${tag}
                    </label>
                `).join('');

                this.updateAfSelectBoxText();
            }

            updateAfSelectBoxText() {
                const box = document.querySelector('#af-filter-container .select-box');
                if (!box) return;
                const vals = this.getSelectedAfValues();
                box.textContent = vals.length ? `🏷️ 屬性篩選 (${vals.length})` : '🏷️ 屬性篩選 (全選)';
            }

            selectAllAf(isAll) {
                document.querySelectorAll('#af-checkboxes input[type="checkbox"]').forEach(cb => cb.checked = isAll);
                this.updateAfSelectBoxText();
                this.renderCatalog();
            }

            getSelectedAfValues() {
                return [...document.querySelectorAll('#af-checkboxes input[type="checkbox"]:checked')].map(cb => cb.value);
            }

            toggleSortDir() {
                this.sortDir = this.sortDir === 'desc' ? 'asc' : 'desc';
                document.getElementById('btn-sort-dir').innerText = this.sortDir === 'desc' ? '⬇ 降序' : '⬆ 升序';
                this.renderCatalog();
            }

            parseAdvancedQuery(query, item) {
                if (!query) return true;

                const parts = query.split('+').map(s => s.trim()).filter(Boolean);
                const raw = item._raw;
                const stats = Utility.parseStats(raw[this.colMap.stats] || '');
                const text = `${raw[this.colMap.name]||''} ${raw[this.colMap.store]||''} ${raw[this.colMap.af]||''} ${raw[this.colMap.level]||''} ${raw[this.colMap.age]||''}`.toLowerCase();

                return parts.every(cond => {
                    if (cond.startsWith('-')) {
                        return !text.includes(cond.substring(1).trim().toLowerCase());
                    }

                    const m = cond.match(/^(B|W|H|T|AGE|CUP)\s*(>=|<=|>|<|=)\s*([A-Z0-9]+)$/i);
                    if (m) {
                        const field = m[1].toUpperCase();
                        const op = m[2];
                        const val = m[3].toUpperCase();
                        let left = 0;

                        if (field === 'B') left = stats.bust;
                        if (field === 'W') left = stats.waist;
                        if (field === 'H') left = stats.hip;
                        if (field === 'T') left = stats.height;
                        if (field === 'AGE') left = parseInt(String(raw[this.colMap.age]||'').replace(/\D/g,''), 10) || 0;

                        if (field === 'CUP') {
                            left = (stats.cup || '?').charCodeAt(0);
                            const right = val.charCodeAt(0);
                            if (op === '>') return left > right;
                            if (op === '<') return left < right;
                            if (op === '>=') return left >= right;
                            if (op === '<=') return left <= right;
                            return left === right;
                        }

                        const right = parseFloat(val);
                        if (op === '>') return left > right;
                        if (op === '<') return left < right;
                        if (op === '>=') return left >= right;
                        if (op === '<=') return left <= right;
                        return left === right;
                    }

                    return text.includes(cond.toLowerCase());
                });
            }

            updateBatchActionsBar() {
                const checked = document.querySelectorAll('.card-checkbox:checked').length;
                const bar = document.getElementById('batch-actions-bar');
                document.getElementById('sel-count').innerText = `已選 ${checked} 張`;
                bar.style.display = this.isEditMode ? 'flex' : 'none';
            }

            selectAllCards() {
                document.querySelectorAll('.card-checkbox').forEach(cb => cb.checked = true);
                this.updateBatchActionsBar();
            }

            moveSelected(direction) {
                const checked = [...document.querySelectorAll('.card-checkbox:checked')].map(cb => cb.value);
                if (!checked.length) return;

                const selectedItems = [];
                const remaining = [];

                this.dataStore.forEach((item, idx) => {
                    (checked.includes(String(idx)) ? selectedItems : remaining).push(item);
                });

                this.dataStore = direction === 'top'
                    ? [...selectedItems, ...remaining]
                    : [...remaining, ...selectedItems];

                document.getElementById('btn-save-order').style.display = 'inline-flex';
                this.renderCatalog();
            }

            deleteSelected() {
                const checked = [...document.querySelectorAll('.card-checkbox:checked')]
                    .map(cb => Number(cb.value))
                    .sort((a,b) => b - a);

                if (!checked.length) return;
                if (!confirm(`確定刪除已選 ${checked.length} 筆資料？`)) return;

                checked.forEach(idx => {
                    if (this.dataStore[idx]) this.dataStore.splice(idx, 1);
                });

                document.getElementById('btn-save-order').style.display = 'inline-flex';
                this.renderCatalog();
            }

            populateFilterStores() {
                const sel = document.getElementById('filterStore');
                if (!sel) return;

                const current = sel.value;
                const stores = Array.from(
                    new Set(this.dataStore.map(r => r._raw[this.colMap.store]).filter(Boolean))
                ).sort();

                sel.innerHTML = '<option value="">🏪 所有店鋪</option>' + stores.map(s => `<option value="${s}">${s}</option>`).join('');
                sel.value = stores.includes(current) ? current : '';
            }

            renderCatalog() {
                const kw = document.getElementById('searchInput').value.trim();
                const grid = document.getElementById('catalogGrid');
                grid.innerHTML = '';

                const storeFilter = document.getElementById('filterStore')?.value || '';
                const statusFilter = document.getElementById('filterStatus')?.value || '';
                const afVals = this.getSelectedAfValues();
                const sortOption = document.getElementById('sortOption')?.value || '';
                const timeStart = document.getElementById('filterTimeStart')?.value || '';
                const timeEnd = document.getElementById('filterTimeEnd')?.value || '';

                let list = this.dataStore.filter(item => {
                    const raw = item._raw;
                    const itemStore = raw[this.colMap.store] || '';
                    const itemAf = String(raw[this.colMap.af] || '')
                        .split(/[\/／]/)
                        .map(t => t.trim())
                        .filter(Boolean);
                    const status = Utility.getWorkStatus(raw[this.colMap.schedule] || '');

                    if (storeFilter && itemStore !== storeFilter) return false;
                    if (statusFilter && status !== statusFilter) return false;
                    if (afVals.length && !afVals.some(v => itemAf.includes(v))) return false;
                    if (!Utility.filterByTimeRange(raw[this.colMap.schedule] || '', timeStart, timeEnd)) return false;

                    return this.parseAdvancedQuery(kw, item);
                });

                if (sortOption) {
                    list.sort((a, b) => {
                        let av = 0, bv = 0;

                        if (sortOption === 'cup') {
                            av = Utility.getCupScore(a._raw[this.colMap.stats]);
                            bv = Utility.getCupScore(b._raw[this.colMap.stats]);
                        } else if (sortOption === 'body') {
                            av = Utility.getBodyScore(a._raw[this.colMap.stats]);
                            bv = Utility.getBodyScore(b._raw[this.colMap.stats]);
                        } else if (sortOption === 'updateTime') {
                            av = new Date(a._raw[this.colMap.updateTime] || 0).getTime();
                            bv = new Date(b._raw[this.colMap.updateTime] || 0).getTime();
                        }

                        return this.sortDir === 'desc' ? bv - av : av - bv;
                    });
                } else {
                    list.sort((a, b) =>
                        (b._raw[this.colMap.favorite] === 'Y' ? 1 : 0) -
                        (a._raw[this.colMap.favorite] === 'Y' ? 1 : 0)
                    );
                }

                list.forEach(item => {
                    const idx = this.dataStore.indexOf(item);
                    const r = item._raw;
                    const stats = Utility.parseStats(r[this.colMap.stats]);
                    const cup = stats.cup;

                    let color = '#9e9e9e';
                    if (['A','B','C'].includes(cup)) color = '#4caf50';
                    else if (['D','E','F'].includes(cup)) color = '#ff9800';
                    else if (cup !== '?') color = '#e91e63';

                    const shape = Utility.getBodyShapeData(r[this.colMap.stats]);
                    const tags = String(r[this.colMap.af] || '')
                        .split(/[\/／]/)
                        .map(t => t.trim())
                        .filter(Boolean);

                    const card = document.createElement('div');
                    card.className = 'card';
                    card.onclick = (e) => {
                        if (!e.target.closest('.fav-btn') && !e.target.closest('.card-checkbox')) {
                            this.editRecord(idx);
                        }
                    };

                    card.innerHTML = `
                        ${this.isEditMode ? `<input type="checkbox" class="card-checkbox" value="${idx}" onchange="app.updateBatchActionsBar()">` : ''}
                        <div class="img-container">
                            <span class="badge">${r[this.colMap.location] || '未知'}</span>
                            <div class="fav-btn" onclick="app.toggleFavorite(event, ${idx})">
                                ${r[this.colMap.favorite] === 'Y' ? '❤️' : '🤍'}
                            </div>
                            <img src="${Utility.cleanDriveUrl(r[this.colMap.photo]) || PLACEHOLDER_URL}">
                        </div>
                        <div class="store-name">${r[this.colMap.store] || ''}</div>
                        <div class="tech-name">${r[this.colMap.name] || ''} ${r[this.colMap.age] ? '(' + r[this.colMap.age] + ')' : ''}</div>
                        ${tags.length ? `<div class="tags-row">${tags.map(t => `<span class="tag-item">${t}</span>`).join('')}</div>` : ''}
                        ${shape ? `<div class="score-row">
                            <span class="tag-item" style="background:#546e7a;color:white;">${shape.shapeIcon} ${shape.shapeType}</span>
                            <span class="tag-item">W/H=${shape.whr.toFixed(2)}</span>
                        </div>` : ''}
                        <div class="stats-row">
                            <span class="cup-badge" style="background:${color};">${cup}杯</span>
                            <span>${(r[this.colMap.stats] || '').replace(/\([A-Z]\)/ig, '').trim()}</span>
                        </div>
                        ${r[this.colMap.price] ? `<div class="price-col">${String(r[this.colMap.price]).split('\n').map(v => `<span>${v}</span>`).join('')}</div>` : ''}
                        ${Utility.generateScheduleHTML(r[this.colMap.schedule])}
                    `;

                    grid.appendChild(card);
                });

                this.buildAfFilterOptions();
                this.populateFilterStores();
                this.updateBatchActionsBar();
            }

            editRecord(i) {
                let r = this.dataStore[i]._raw;
                const setV = (id, val) => document.getElementById(id).value = val || '';

                setV('v_row_index', this.dataStore[i]._rowIndex);
                setV('v_location', r[this.colMap.location]);
                setV('v_store', r[this.colMap.store]);
                setV('v_tech_id', r[this.colMap.techId] ? r[this.colMap.techId].replace(/^'/, '') : '');

                let d = r[this.colMap.startDate] || "";
                setV('v_start_date',
                    d.match(/(\d{4})\s*[年\/\-.]\s*(\d{1,2})\s*[月\/\-.]\s*(\d{1,2})/)
                        ? d.replace(/(\d{4}).*?(\d{1,2}).*?(\d{1,2}).*/, (m,y,mo,da)=>`${y}-${mo.padStart(2,'0')}-${da.padStart(2,'0')}`)
                        : d
                );

                setV('v_name', r[this.colMap.name]);
                setV('v_age', r[this.colMap.age]);
                setV('v_stats', r[this.colMap.stats]);
                setV('v_price', r[this.colMap.price]);
                setV('v_url', r[this.colMap.url]);
                setV('v_af', r[this.colMap.af]);
                setV('v_level', r[this.colMap.level]);
                setV('v_schedule', r[this.colMap.schedule]);
                setV('v_photo_url', r[this.colMap.photo]);

                let cI = Utility.cleanDriveUrl(r[this.colMap.photo]);
                if (cI) {
                    document.getElementById('preview_photo').src = cI;
                    document.getElementById('preview_photo').style.display = 'block';
                    document.getElementById('text_photo').style.display = 'none';
                    document.getElementById('btn_del_photo').style.display = 'flex';
                } else {
                    document.getElementById('preview_photo').style.display = 'none';
                    document.getElementById('text_photo').style.display = 'block';
                    document.getElementById('btn_del_photo').style.display = 'none';
                }

                document.getElementById('btn-delete').style.display = 'inline-flex';

                if (!this.isEditMode) this.toggleMode();
                document.getElementById('panel-form').scrollIntoView();
            }

            deleteImage(e) {
                e.stopPropagation();
                document.getElementById('v_photo_url').value = '';
                document.getElementById('preview_photo').src = '';
                document.getElementById('preview_photo').style.display = 'none';
                document.getElementById('text_photo').style.display = 'block';
                document.getElementById('btn_del_photo').style.display = 'none';
                cropperSvc.pendingBlob = null;
            }

            deleteRecordForm() {
                const rowIndex = document.getElementById('v_row_index').value;
                if (!rowIndex) return;

                const idx = this.dataStore.findIndex(r => String(r._rowIndex) === String(rowIndex));
                if (idx === -1) return;
                if (!confirm('確定刪除此筆資料？')) return;

                this.dataStore.splice(idx, 1);
                document.getElementById('btn-save-order').style.display = 'inline-flex';
                this.clearForm();
                this.renderCatalog();
            }

            async fetchHtmlWithProxy(targetUrl) {
                const trimmedUrl = String(targetUrl || '').trim();
                const normalizedForJina = trimmedUrl.replace(/^https?:\/\//i, '');
                const proxies = [
                    { name: 'allorigins', url: `https://api.allorigins.win/get?url=${encodeURIComponent(trimmedUrl)}`, isJson: true },
                    { name: 'codetabs', url: `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(trimmedUrl)}`, isJson: false },
                    { name: 'corsproxy', url: `https://corsproxy.io/?${encodeURIComponent(trimmedUrl)}`, isJson: false },
                    { name: 'jina-http', url: `https://r.jina.ai/http://${normalizedForJina}`, isJson: false },
                    { name: 'jina-https', url: `https://r.jina.ai/http://https://${normalizedForJina}`, isJson: false }
                ];

                const looksUsable = (text = '') => {
                    const t = String(text || '');
                    if (!t) return false;
                    if (t.includes('<!DOCTYPE') || t.includes('<html') || t.includes('<body')) return true;
                    if (t.length > 600 && /(girls-list|\/cast\/|schedule|No\.\s*\d+)/i.test(t)) return true;
                    return false;
                };

                const fetchWithTimeout = async (url, timeoutMs = 12000) => {
                    const ctrl = new AbortController();
                    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
                    try {
                        const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
                        return res;
                    } finally {
                        clearTimeout(timer);
                    }
                };

                for (let proxy of proxies) {
                    try {
                        let res = await fetchWithTimeout(proxy.url);
                        if (!res.ok) throw new Error(`HTTP error ${res.status}`);

                        let html = '';
                        if (proxy.isJson) {
                            let data = await res.json();
                            html = data?.contents || '';
                        } else {
                            html = await res.text();
                        }

                        if (looksUsable(html)) {
                            return html;
                        }

                        throw new Error('內容不可用');
                    } catch (e) {
                        console.warn(`[Proxy Failed] ${proxy.name} ${proxy.url} - ${e.message}`);
                    }
                }

                throw new Error("所有跨域代理均已失效、超時或被目標網站封鎖。");
            }

            getSplitterRegex() {
                const splitterRule = window.ruleEngine.getRulesForField('System_Anchor')
                    .find(rule => rule.ruleType === 'Block_Splitter');
                const pattern = Utility.getSafePattern(splitterRule?.pattern || '收藏夾');
                try {
                    return new RegExp(pattern, 'g');
                } catch {
                    return /收藏夾/g;
                }
            }

            getSiteHandler(siteCode = '', sourceUrl = '', siteMatches = []) {
                return window.SiteSyncRegistry?.getHandler?.({ siteCode, sourceUrl, siteMatches }) || null;
            }

            inferSiteMatches(text = '', html = '', sourceUrl = '', preferredSiteCode = '') {
                return window.SiteSyncRegistry?.inferSiteMatches?.({
                    app: this,
                    text,
                    html,
                    sourceUrl,
                    preferredSiteCode
                }) || ['Common'];
            }

            parseBlocksFromMagicPaste(text, siteMatches = ['Common'], sourceUrl = '') {
                const primarySite = siteMatches.find(site => site && site !== 'Common') || '';
                const handler = this.getSiteHandler(primarySite, sourceUrl, siteMatches);
                const blocks = handler?.parseBlocks?.({
                    app: this,
                    text,
                    siteMatches,
                    sourceUrl
                });
                return blocks?.length ? blocks : [String(text)];
            }

            extractCommonRuleData(block, html = '', siteMatches = ['Common']) {
                const extractedName = window.ruleEngine.extractByRules(block, html, 'v_name', siteMatches);
                let rawName = extractedName.value || '';
                if (!rawName) {
                    const fallback = block.match(/(?:Name|姓名|名前)\s*[:：]?\s*([^\n]+)/i);
                    if (fallback?.[1]) rawName = fallback[1].trim();
                }

                const nameInfo = Utility.parseName(rawName, window.ruleEngine);
                const extractedStore = window.ruleEngine.extractByRules(block, html, 'v_store', siteMatches);
                const extractedStats = window.ruleEngine.extractByRules(block, html, 'v_stats', siteMatches);
                const extractedUrl = window.ruleEngine.extractByRules(block, html, 'v_url', siteMatches);
                const extractedAge = window.ruleEngine.extractByRules(block, html, 'v_age', siteMatches);
                const extractedDate = window.ruleEngine.extractByRules(block, html, 'v_start_date', siteMatches);
                const extractedPrice = window.ruleEngine.extractByRules(block, html, 'v_price', siteMatches);
                const extractedSchedule = window.ruleEngine.extractByRules(block, html, 'v_schedule', siteMatches);
                const extractedAf = window.ruleEngine.extractByRules(block, html, 'v_af', siteMatches);

                const urlFallback = block.match(/https?:\/\/[^\s"']+/);
                const statsFallback = block.match(/(T\s*\d{3}[^\n]*)/i);
                const ageFallback = block.match(/(?:Age|年齡|年齢)\s*[:：]?\s*(\d{1,2})/i);

                let scheduleText = extractedSchedule.value || '';
                const scheduleFallback = block.match(/(?:本周班表|週間?スケジュール|出勤|schedule)[\s\S]*/i);
                if (!scheduleText && scheduleFallback?.[0]) scheduleText = scheduleFallback[0];

                const formattedSchedule = Utility.parseAndFormatSchedule(scheduleText, window.ruleEngine);

                return {
                    rawName,
                    nameInfo,
                    extractedName,
                    extractedStore,
                    extractedStats,
                    extractedUrl,
                    extractedAge,
                    extractedDate,
                    extractedPrice,
                    extractedSchedule,
                    extractedAf,
                    urlFallback,
                    statsFallback,
                    ageFallback,
                    scheduleText,
                    formattedSchedule
                };
            }

            getRecordStoreName(commonData) {
                if (!commonData) return '';
                return Utility.cleanStoreNameDisplay(
                    commonData.extractedName.secondaryValue ||
                    commonData.extractedStore.value ||
                    document.getElementById('v_store')?.value || ''
                );
            }

            cleanStoreName(value) {
                return Utility.cleanStoreNameDisplay(value);
            }

            isSameStore(a, b) {
                return Utility.isSameStore(a, b);
            }

            extractRecordFromBlock(block, html = '', siteMatches = ['Common'], sourceUrl = '') {
                const primarySite = siteMatches.find(site => site && site !== 'Common') || '';
                const handler = this.getSiteHandler(primarySite, sourceUrl, siteMatches);
                return handler?.extractRecord?.({
                    app: this,
                    block,
                    html,
                    siteMatches,
                    sourceUrl
                }) || null;
            }

            findRecordIndex(record) {
                if (!record) return -1;
                if (record.url) {
                    const cleanIncoming = record.url.split('?')[0].replace(/\/$/, '');
                    const byUrl = this.dataStore.findIndex(item => {
                        const dbUrl = String(item._raw[this.colMap.url] || '').split('?')[0].replace(/\/$/, '');
                        return dbUrl && dbUrl === cleanIncoming;
                    });
                    if (byUrl !== -1) return byUrl;
                }

                return this.dataStore.findIndex(item => {
                    const dbName = Utility.parseName(item._raw[this.colMap.name] || '', window.ruleEngine).pureName;
                    const dbStore = item._raw[this.colMap.store] || '';
                    return dbName.toLowerCase() === String(record.name).toLowerCase() &&
                        Utility.isSameStore(dbStore, record.store);
                });
            }

            resolveBatchTechId(record, targetRow) {
                if (!record) return '';
                if (record.techId) return String(record.techId).trim();

                const noValue = String(record.listNo || '').trim();
                const noMatch = noValue.match(/\d+/);
                if (!noMatch) return '';

                const seq = noMatch[0].padStart(4, '0');
                const storeName = String(record.store || targetRow?.[this.colMap.store] || '').trim();
                const storeCode = Utility.getStoreCodeByName(storeName || 'UNKNOWN');
                if (!storeCode || storeCode === 'UNKNOWN') return '';

                return `${storeCode}_${seq}`;
            }

            buildPhotoFileName(techId, storeName, name) {
                const cleanTechId = String(techId || '').replace(/^'/, '').trim();
                if (cleanTechId) return `${cleanTechId}.jpg`;

                const storeCode = Utility.getStoreCodeByName(storeName || 'UNKNOWN');
                const pureName = Utility.parseName(name || '').pureName || String(name || '').trim();
                return `${storeCode}_${pureName}.jpg`;
            }

            applyRecordToRow(targetRow, record, isNew = false) {
                const setField = (key, value) => {
                    const idx = this.colMap[key];
                    if (idx !== -1 && idx !== undefined && value !== undefined && value !== null) {
                        targetRow[idx] = value;
                    }
                };

                if (isNew) {
                    const storeCode = Utility.getStoreCodeByName(record.store || 'UNKNOWN');
                    setField('techId', Utility.generateID(storeCode));
                    setField('favorite', '');
                }

                if (record.location) setField('location', record.location);
                if (record.store) setField('store', record.store);
                if (record.name) setField('name', record.name);
                if (record.stats) setField('stats', record.stats);
                if (record.url && !targetRow[this.colMap.url]) setField('url', record.url);
                if (record.price) setField('price', record.price);
                if (record.age) setField('age', /歲$/.test(record.age) ? record.age : `${record.age}歲`);
                if (record.startDate) setField('startDate', record.startDate);
                if (record.schedule && record.hasSchedule) setField('schedule', record.schedule);
                if (record.level) setField('level', record.level);

                const normalizedTechId = this.resolveBatchTechId(record, targetRow);
                if (normalizedTechId) setField('techId', normalizedTechId);

                const currentTags = String(targetRow[this.colMap.af] || '')
                    .split(/[\/／]/).map(tag => tag.trim()).filter(Boolean);
                const mergedTags = new Set([...currentTags, ...record.tags]);
                if (mergedTags.size) setField('af', Array.from(mergedTags).join(' / '));

                setField('updateTime', Utility.getCurrentTime());
            }

            async reconcileRecordWithDetail(record) {
                if (!record?.url) return record;

                const handler = this.getSiteHandler('', record.url, []);
                if (!handler) return record;
                if (handler.shouldFetchDetail && !handler.shouldFetchDetail(record)) return record;

                try {
                    const detailHtml = await this.fetchHtmlWithProxy(record.url);
                    const detailText = handler.buildPlainText ? handler.buildPlainText(detailHtml) : String(detailHtml || '');
                    const detailMatches = this.inferSiteMatches(detailText, detailHtml, record.url);
                    const detailRecord = this.extractRecordFromBlock(detailText, detailHtml, detailMatches, record.url);
                    if (!detailRecord) return record;

                    if (handler.mergeRecords) return handler.mergeRecords(record, detailRecord);
                    const mergedTags = new Set([...(record.tags || []), ...(detailRecord.tags || [])]);
                    return {
                        ...record,
                        ...detailRecord,
                        url: detailRecord.url || record.url,
                        tags: Array.from(mergedTags)
                    };
                } catch (error) {
                    console.warn(`[Detail Reconcile] ${record.url} - ${error.message}`);
                    return record;
                }
            }

            async processBatchData(createMissing = false) {
                const text = document.getElementById('v_magic_paste')?.value?.trim();
                if (!text) {
                    Utility.showToast('⚠️ 請先貼上要處理的內容。', true);
                    return;
                }

                const html = '';
                const sourceUrl = document.getElementById('v_url')?.value || '';
                const siteMatches = this.inferSiteMatches(text, html, sourceUrl);
                const blocks = this.parseBlocksFromMagicPaste(text, siteMatches, sourceUrl);

                let updated = 0;
                let created = 0;

                for (let i = 0; i < blocks.length; i++) {
                    const block = blocks[i];
                    let record = this.extractRecordFromBlock(block, html, siteMatches, sourceUrl);
                    if (!record || !record.name) continue;
                    record = await this.reconcileRecordWithDetail(record);
                    const existingIndex = this.findRecordIndex(record);

                    if (existingIndex !== -1) {
                        this.applyRecordToRow(this.dataStore[existingIndex]._raw, record, false);
                        updated++;
                    } else if (createMissing) {
                        const newRow = new Array(this.headerRow.length).fill('');
                        this.applyRecordToRow(newRow, record, true);
                        this.dataStore.push({
                            id: newRow[this.colMap.techId] || Utility.generateID('UNKNOWN'),
                            _raw: newRow,
                            _rowIndex: ''
                        });
                        created++;
                    }
                }

                if (!updated && !created) {
                    Utility.showToast('⚠️ 沒有找到可處理的有效資料。', true);
                    return;
                }

                this.renderCatalog();
                await this.saveOrderToGoogleSheet(true);
                Utility.showToast(createMissing
                    ? `✅ 批次完成：新增 ${created} 筆，更新 ${updated} 筆。`
                    : `✅ 批次完成：更新 ${updated} 筆。`);
            }

            processBatchDataInternally(text, html, siteMatches, statsObj, createMissing = false, sourceUrl = '') {
                const blocks = this.parseBlocksFromMagicPaste(text, siteMatches, sourceUrl);
                let updated = 0;
                let created = 0;

                blocks.forEach(block => {
                    const record = this.extractRecordFromBlock(block, html, siteMatches, sourceUrl);
                    if (!record || !record.name) return;
                    statsObj.total++;

                    const existingIndex = this.findRecordIndex(record);
                    if (existingIndex !== -1) {
                        this.applyRecordToRow(this.dataStore[existingIndex]._raw, record, false);
                        updated++;
                        statsObj.updated++;
                    } else if (createMissing) {
                        const newRow = new Array(this.headerRow.length).fill('');
                        this.applyRecordToRow(newRow, record, true);
                        this.dataStore.push({
                            id: newRow[this.colMap.techId] || Utility.generateID('UNKNOWN'),
                            _raw: newRow,
                            _rowIndex: ''
                        });
                        created++;
                        statsObj.updated++;
                    } else {
                        statsObj.missing++;
                    }
                });

                return { updated, created };
            }

            async startAutoSync() {
                if (!this.accessToken || !this.hasWriteAccess) {
                    Utility.showToast('⚠️ 請先完成具有寫入權限的 Google 授權。', true);
                    return;
                }

                const syncRules = window.ruleEngine.rules.filter(rule =>
                    rule.field === 'System_AutoSync' && String(rule.action || '').toUpperCase() === 'Y'
                );
                if (!syncRules.length) {
                    Utility.showToast('⚠️ Rules 中沒有啟用任何自動同步網址。', true);
                    return;
                }

                if (!confirm(`將依序同步 ${syncRules.length} 個來源站點，是否開始？`)) return;

                this.isSyncing = true;
                document.getElementById('btn-auto-sync').style.display = 'none';
                document.getElementById('btn-cancel-sync').style.display = 'inline-flex';

                const syncStats = {};

                try {
                    for (let i = 0; i < syncRules.length; i++) {
                        if (!this.isSyncing) break;
                        const rule = syncRules[i];
                        const siteCode = rule.siteMatch || `site-${i + 1}`;
                        const url = rule.pattern;
                        syncStats[siteCode] = syncStats[siteCode] || { total: 0, updated: 0, missing: 0 };

                        Utility.showLoading(`自動同步中... (${i + 1}/${syncRules.length})\n${siteCode}\n${url}`);

                        try {
                            const handler = this.getSiteHandler(siteCode, url, [siteCode]);
                            if (!handler?.syncAuto) throw new Error(`找不到 ${siteCode} 的同步處理器`);
                            await handler.syncAuto({
                                app: this,
                                rule,
                                statsObj: syncStats[siteCode]
                            });
                        } catch (error) {
                            console.error('[AutoSync]', siteCode, error);
                        }

                        if (this.isSyncing && i < syncRules.length - 1) {
                            await new Promise(resolve => setTimeout(resolve, 1200));
                        }
                    }

                    this.renderCatalog();
                    await this.saveOrderToGoogleSheet(true);
                    this.showSyncStatsModal(syncStats);
                    Utility.showToast('✅ 自動同步完成。');
                } catch (error) {
                    Utility.showToast(`❌ 自動同步失敗：${error.message}`, true);
                } finally {
                    this.isSyncing = false;
                    document.getElementById('btn-auto-sync').style.display = 'inline-flex';
                    document.getElementById('btn-cancel-sync').style.display = 'none';
                    Utility.hideLoading();
                }
            }

            cancelAutoSync() {
                this.isSyncing = false;
                Utility.showToast('⚠️ 已要求停止自動同步。', true);
            }

            showSyncStatsModal(stats) {
                const body = document.getElementById('syncStatsBody');
                if (!body) return;

                let total = 0;
                let updated = 0;
                let missing = 0;
                body.innerHTML = Object.entries(stats).map(([siteCode, value]) => {
                    total += value.total;
                    updated += value.updated;
                    missing += value.missing;
                    return `
                        <tr>
                            <td>${siteCode}</td>
                            <td>${value.total}</td>
                            <td style="color:var(--success); font-weight:700;">${value.updated}</td>
                            <td style="color:var(--warning); font-weight:700;">${value.missing}</td>
                        </tr>
                    `;
                }).join('') + `
                    <tr style="font-weight:700; background:#f5f5f5;">
                        <td>Total</td>
                        <td>${total}</td>
                        <td style="color:var(--success);">${updated}</td>
                        <td style="color:var(--warning);">${missing}</td>
                    </tr>
                `;
                document.getElementById('syncStatsModal').style.display = 'flex';
            }

            async cleanupDriveFolder() {
                if (!this.accessToken || !this.hasWriteAccess) {
                    Utility.showToast('⚠️ 請先完成具有寫入權限的 Google 授權。', true);
                    return;
                }
                if (!confirm('確認要比對 Sheets 與 Drive，刪除未使用圖片並修正檔名嗎？')) return;

                Utility.showLoading('清理 Drive 圖片中...');
                try {
                    const sheetRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?includeGridData=true`, {
                        headers: { 'Authorization': `Bearer ${this.accessToken}` }
                    });
                    const sheetData = await sheetRes.json();
                    if (sheetData.error) throw new Error(sheetData.error.message);

                    const usedFiles = new Map();
                    (sheetData.sheets || []).forEach(sheet => {
                        const rows = sheet?.data?.[0]?.rowData || [];
                        if (rows.length <= 1) return;

                        const headerRow = rows[0].values ? rows[0].values.map(v => v.formattedValue || '') : [];
                        const photoIdx = headerRow.findIndex(h => String(h).trim() === '技師照片');
                        const storeIdx = headerRow.findIndex(h => String(h).trim() === '店名');
                        const techIdIdx = headerRow.findIndex(h => String(h).trim() === '技師編號');
                        const nameIdx = headerRow.findIndex(h => String(h).trim() === '姓名');
                        if (photoIdx === -1) return;

                        for (let i = 1; i < rows.length; i++) {
                            if (!rows[i].values) continue;
                            const photoUrl = rows[i].values[photoIdx]?.formattedValue || '';
                            const fileId = Utility.extractDriveFileId(photoUrl);
                            if (!fileId) continue;
                            const storeVal = storeIdx !== -1 ? (rows[i].values[storeIdx]?.formattedValue || '') : '';
                            const techIdVal = techIdIdx !== -1 ? (rows[i].values[techIdIdx]?.formattedValue || '') : '';
                            const nameVal = nameIdx !== -1 ? (rows[i].values[nameIdx]?.formattedValue || '') : '';
                            const expectedName = this.buildPhotoFileName(techIdVal, storeVal, nameVal);
                            usedFiles.set(fileId, expectedName);
                        }
                    });

                    let files = [];
                    let pageToken = null;
                    do {
                        let url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${DRIVE_FOLDER_ID}' in parents and trashed=false`)}&fields=nextPageToken,files(id,name)&pageSize=100`;
                        if (pageToken) url += `&pageToken=${pageToken}`;
                        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${this.accessToken}` } });
                        const data = await res.json();
                        if (data.error) throw new Error(data.error.message);
                        files = files.concat(data.files || []);
                        pageToken = data.nextPageToken;
                    } while (pageToken);

                    let deleted = 0;
                    let renamed = 0;
                    for (const file of files) {
                        if (!usedFiles.has(file.id)) {
                            await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}`, {
                                method: 'DELETE',
                                headers: { 'Authorization': `Bearer ${this.accessToken}` }
                            });
                            deleted++;
                            continue;
                        }

                        const expectedName = usedFiles.get(file.id);
                        if (file.name !== expectedName) {
                            await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}`, {
                                method: 'PATCH',
                                headers: {
                                    'Authorization': `Bearer ${this.accessToken}`,
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify({ name: expectedName })
                            });
                            renamed++;
                        }
                    }

                    Utility.showToast(`✅ Drive 清理完成：刪除 ${deleted} 張，重新命名 ${renamed} 張。`);
                } catch (error) {
                    Utility.showToast(`❌ Drive 清理失敗：${error.message}`, true);
                } finally {
                    Utility.hideLoading();
                }
            }

            executeBatchUpdateOnly() {
                this.processBatchData(false);
            }

            executeBatchCreate() {
                if (!document.getElementById('v_store')?.value.trim()) {
                    Utility.showToast('⚠️ 批次建檔前請先填寫共同店名。', true);
                    return;
                }
                this.processBatchData(true);
            }

            async fetchAndProcessList(url) {
                Utility.showLoading('抓取清單頁面中...');
                try {
                    const html = await this.fetchHtmlWithProxy(url);
                    const handler = this.getSiteHandler('', url);
                    const extractedText = handler?.buildListText ? handler.buildListText(html) : String(html || '');
                    document.getElementById('v_magic_paste').value = extractedText;

                    const siteMatches = this.inferSiteMatches(extractedText, html, url);
                    const storeRule = window.ruleEngine.rules.find(rule =>
                        rule.field === 'v_store' &&
                        siteMatches.includes(rule.siteMatch) &&
                        rule.action
                    );
                    if (storeRule?.action) document.getElementById('v_store').value = storeRule.action;

                    Utility.hideLoading();
                    if (confirm('已抓到清單內容。要直接用這份內容執行批次建檔 / 更新嗎？')) {
                        await this.processBatchData(true);
                    } else {
                        Utility.showToast('✅ 清單已載入到魔法貼上欄，可再手動檢查。');
                    }
                } catch (error) {
                    Utility.hideLoading();
                    Utility.showToast(`❌ 清單抓取失敗：${error.message}`, true);
                }
            }

            processMagicPaste(text, html) {
                if (!text) return;

                const sourceUrl = (text.match(/https?:\/\/[^\s]+/) || [document.getElementById('v_url')?.value || ''])[0];
                const siteMatches = this.inferSiteMatches(text, html, sourceUrl);
                const record = this.extractRecordFromBlock(text, html, siteMatches, sourceUrl);

                if (!record) {
                    if (sourceUrl) {
                        document.getElementById('v_url').value = sourceUrl;
                        Utility.showToast('✨ 已填入網址，請再補充其他欄位。');
                    } else {
                        Utility.showToast('⚠️ 目前無法從這段內容解析出有效資料。', true);
                    }
                    return;
                }

                const existingIndex = this.findRecordIndex(record);
                if (existingIndex !== -1) this.editRecord(existingIndex);
                else {
                    document.getElementById('v_row_index').value = '';
                    document.getElementById('v_tech_id').value = Utility.generateID(Utility.getStoreCodeByName(record.store || 'UNKNOWN'));
                }

                const setField = (id, value) => {
                    const el = document.getElementById(id);
                    if (el && value) el.value = value;
                };

                setField('v_name', record.name);
                setField('v_store', record.store);
                setField('v_url', record.url || sourceUrl);
                setField('v_stats', record.stats);
                setField('v_price', record.price);
                setField('v_start_date', record.startDate);
                setField('v_level', record.level);
                setField('v_schedule', record.schedule);
                if (record.age) setField('v_age', /歲$/.test(record.age) ? record.age : `${record.age}歲`);
                if (record.tags.length) {
                    const afInput = document.getElementById('v_af');
                    const existingTags = String(afInput?.value || '').split(/[\/／]/).map(tag => tag.trim()).filter(Boolean);
                    afInput.value = Array.from(new Set([...existingTags, ...record.tags])).join(' / ');
                }

                Utility.showToast(existingIndex !== -1 ? '✨ 已載入並更新現有資料。' : '✨ 已解析內容並填入表單。');
            }

            get currentSheet() {
                return document.getElementById('v_sheet')?.value;
            }

            initGoogleAuth() {
                const storedToken = sessionStorage.getItem('gapi_access_token');
                const storedHasWrite = sessionStorage.getItem('gapi_has_write') === 'true';

                this.populateTimeDropdowns();

                if (!window.google || !google.accounts || !google.accounts.oauth2) {
                    setTimeout(() => this.initGoogleAuth(), 150);
                    return;
                }

                this.tokenClient = google.accounts.oauth2.initTokenClient({
                    client_id: CLIENT_ID,
                    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
                    callback: ''
                });

                if (storedToken) {
                    this.accessToken = storedToken;
                    this.hasWriteAccess = storedHasWrite;
                    this.onAuthSuccess();
                }
            }

            onAuthSuccess() {
                document.getElementById('auth-banner').style.display = 'none';
                this.fetchSheetNames();
            }

            triggerAuth() {
                if (!this.tokenClient) return;

                this.tokenClient.callback = (resp) => {
                    if (resp.error) return;

                    this.accessToken = resp.access_token;
                    this.hasWriteAccess = google.accounts.oauth2.hasGrantedAllScopes(
                        resp,
                        'https://www.googleapis.com/auth/spreadsheets',
                        'https://www.googleapis.com/auth/drive'
                    );

                    sessionStorage.setItem('gapi_access_token', resp.access_token);
                    sessionStorage.setItem('gapi_has_write', this.hasWriteAccess ? 'true' : 'false');
                    this.onAuthSuccess();
                };

                this.tokenClient.requestAccessToken({ prompt: 'consent' });
            }

            async fetchSheetNames() {
                if (!this.accessToken) return;

                try {
                    const res = await fetch(
                        `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties(title,sheetId)`,
                        { headers: { 'Authorization': `Bearer ${this.accessToken}` } }
                    );

                    const data = await res.json();
                    if (data.error) {
                        if (data.error.code === 401) return this.handleTokenExpired();
                        throw new Error(data.error.message);
                    }

                    if (data.sheets) {
                        const select = document.getElementById('v_sheet');
                        select.innerHTML = '';

                        data.sheets.forEach(s => {
                            const opt = document.createElement('option');
                            opt.value = s.properties.title;
                            opt.innerText = s.properties.title;
                            opt.dataset.sheetId = s.properties.sheetId;
                            select.appendChild(opt);
                        });

                        await this.fetchRulesSheet();
                        this.loadSheetData();
                    }
                } catch (e) {
                    Utility.showToast('❌ 讀取失敗', true);
                }
            }

            async fetchRulesSheet() {
                try {
                    const res = await fetch(
                        `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Rules!A:Z`,
                        { headers: { 'Authorization': `Bearer ${this.accessToken}` } }
                    );
                    const data = await res.json();
                    this.rulesRawData = data?.values || [];
                    if (this.rulesRawData.length) window.ruleEngine.setRules(this.rulesRawData);
                } catch(e) {}
            }

            buildRulesDiagnosticReport() {
                const rows = Array.isArray(this.rulesRawData) ? this.rulesRawData : [];
                const header = rows[0] || [];
                const body = rows.slice(1).filter(row => row.some(cell => String(cell || '').trim()));
                const fieldCounts = new Map();
                const typeCounts = new Map();
                const siteCounts = new Map();
                const issues = [];
                const duplicateMap = new Map();

                body.forEach((row, idx) => {
                    const lineNo = idx + 2;
                    const priority = String(row[0] || '').trim();
                    const siteMatch = String(row[1] || '').trim();
                    const field = String(row[2] || '').trim();
                    const ruleType = String(row[3] || '').trim();
                    const pattern = String(row[4] || '').trim();
                    const action = String(row[5] || '').trim();

                    if (!field || !ruleType) issues.push(`Row ${lineNo}: missing field or ruleType`);
                    if (priority && Number.isNaN(Number(priority))) issues.push(`Row ${lineNo}: priority is not numeric (${priority})`);
                    if (/^Regex_|^HTML_Img_Tag$/i.test(ruleType) && !pattern) issues.push(`Row ${lineNo}: ${ruleType} missing pattern`);
                    if (/^Set_Default$/i.test(ruleType) && !action) issues.push(`Row ${lineNo}: Set_Default missing action`);

                    if (field) fieldCounts.set(field, (fieldCounts.get(field) || 0) + 1);
                    if (ruleType) typeCounts.set(ruleType, (typeCounts.get(ruleType) || 0) + 1);
                    if (siteMatch) siteCounts.set(siteMatch, (siteCounts.get(siteMatch) || 0) + 1);

                    const dupKey = [siteMatch, field, ruleType, pattern, action].join(' | ');
                    duplicateMap.set(dupKey, [...(duplicateMap.get(dupKey) || []), lineNo]);
                });

                const duplicates = Array.from(duplicateMap.entries()).filter(([, lines]) => lines.length > 1);
                duplicates.forEach(([key, lines]) => issues.push(`Duplicate rule: ${key} (rows ${lines.join(', ')})`));

                const topEntries = (map) => Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
                return [
                    `Rules diagnostic time: ${Utility.getCurrentTime()}`,
                    `Header: ${header.join(' | ')}`,
                    `Total rows: ${rows.length}`,
                    `Active rules: ${body.length}`,
                    '',
                    '[Top fields]',
                    ...topEntries(fieldCounts).map(([name, count]) => `${name}: ${count}`),
                    '',
                    '[Top rule types]',
                    ...topEntries(typeCounts).map(([name, count]) => `${name}: ${count}`),
                    '',
                    '[Top siteMatch]',
                    ...topEntries(siteCounts).map(([name, count]) => `${name}: ${count}`),
                    '',
                    '[Issues]',
                    ...(issues.length ? issues : ['No obvious structural issues found.'])
                ].join('\n');
            }

            async openRulesDiagnostics(forceRefresh = false) {
                if (!this.accessToken) {
                    Utility.showToast('⚠️ 請先完成 Google 授權。', true);
                    return;
                }
                if (forceRefresh || !this.rulesRawData.length) await this.fetchRulesSheet();
                this.lastRulesDiagnosticText = this.buildRulesDiagnosticReport();
                document.getElementById('rulesDiagnosticOutput').value = this.lastRulesDiagnosticText;
                document.getElementById('rulesDiagnosticsModal').style.display = 'flex';
            }

            closeRulesDiagnostics() {
                document.getElementById('rulesDiagnosticsModal').style.display = 'none';
            }

            async copyRulesDiagnostics() {
                if (!this.lastRulesDiagnosticText) {
                    Utility.showToast('⚠️ 尚無可複製的 Rules 報告。', true);
                    return;
                }
                try {
                    await navigator.clipboard.writeText(this.lastRulesDiagnosticText);
                    Utility.showToast('✅ Rules 報告已複製。');
                } catch {
                    const output = document.getElementById('rulesDiagnosticOutput');
                    output.focus();
                    output.select();
                    Utility.showToast('⚠️ 自動複製失敗，已選取報告文字。', true);
                }
            }

            handleTokenExpired() {
                sessionStorage.clear();
                this.accessToken = null;
                this.hasWriteAccess = false;

                const b = document.getElementById('auth-banner');
                b.style.display = 'block';
                b.innerHTML = '⚠️ 登入過期，重新授權';
                b.style.background = '#f8d7da';
            }

            async loadSheetData() {
                if (!this.accessToken || !this.currentSheet) return;

                Utility.showLoading(`載入「${this.currentSheet}」...`);

                try {
                    const res = await fetch(
                        `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(this.currentSheet)}!A:Z`,
                        { headers: { 'Authorization': `Bearer ${this.accessToken}` } }
                    );

                    const data = await res.json();
                    if (data.error) {
                        if (data.error.code === 401) return this.handleTokenExpired();
                        throw new Error(data.error.message);
                    }

                    if (!data.values || data.values.length === 0) {
                        this.dataStore = [];
                        this.renderCatalog();
                        return Utility.hideLoading();
                    }

                    this.headerRow = data.values[0];
                    const getIdx = (n) => this.headerRow.findIndex(h => String(h).trim() === n);

                    this.colMap = {
                        location: getIdx('位置'),
                        store: getIdx('店名'),
                        techId: getIdx('技師編號'),
                        startDate: getIdx('到職日'),
                        name: getIdx('姓名'),
                        age: getIdx('年齡'),
                        stats: getIdx('數值'),
                        photo: getIdx('技師照片'),
                        price: getIdx('價金'),
                        url: getIdx('網址'),
                        af: getIdx('屬性') !== -1 ? getIdx('屬性') : getIdx('AF'),
                        level: getIdx('等級'),
                        schedule: getIdx('行事曆'),
                        favorite: getIdx('我的最愛') !== -1 ? getIdx('我的最愛') : (getIdx('最愛') !== -1 ? getIdx('最愛') : getIdx('Favorite')),
                        updateTime: getIdx('更新時間') !== -1 ? getIdx('更新時間') : getIdx('UpdateTime')
                    };

                    ['schedule', 'favorite', 'updateTime'].forEach((k, i) => {
                        if (this.colMap[k] === -1 || this.colMap[k] === undefined) {
                            this.colMap[k] = this.headerRow.length;
                            this.headerRow.push(['行事曆', '我的最愛', '更新時間'][i]);
                        }
                    });

                    document.getElementById('btn-save').disabled = !(this.colMap.name !== -1 && this.colMap.store !== -1);

                    this.dataStore = data.values.slice(1).map((r, i) => ({
                        id: String(r[this.colMap.techId] || `T-${i}`).trim(),
                        _raw: this.headerRow.map((_, idx) => r[idx] || ""),
                        _rowIndex: i + 2
                    })).filter(item => item._raw[this.colMap.name] && item._raw[this.colMap.name] !== '姓名');

                    this.renderCatalog();
                    Utility.hideLoading();
                } catch (e) {
                    Utility.hideLoading();
                    alert("❌ 錯誤：" + e.message);
                }
            }

            async saveOrderToGoogleSheet(isBg = false) {
                if (!this.accessToken) return;

                if (!isBg) Utility.showLoading("儲存排序...");

                try {
                    await fetch(
                        `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(this.currentSheet)}!A2?valueInputOption=USER_ENTERED`,
                        {
                            method: 'PUT',
                            headers: {
                                'Authorization': `Bearer ${this.accessToken}`,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({ values: this.dataStore.map(r => r._raw) })
                        }
                    );

                    this.dataStore.forEach((item, idx) => item._rowIndex = idx + 2);
                    document.getElementById('btn-save-order').style.display = 'none';

                    if (!isBg) {
                        Utility.showToast("✅ 變更儲存成功！");
                        this.renderCatalog();
                    }
                } catch (e) {
                    Utility.showToast('❌ 錯誤', true);
                } finally {
                    if (!isBg) Utility.hideLoading();
                }
            }

            async saveToGoogleSheet() {
                let st = document.getElementById('v_store').value.trim();
                let nm = document.getElementById('v_name').value.trim();
                if (!st || !nm) return Utility.showToast("⚠️ 請填寫店名與姓名！", true);

                Utility.showLoading("寫入中...");

                try {
                    let sc = Utility.getStoreCodeByName(st);
                    let tId = document.getElementById('v_tech_id').value.trim() || Utility.generateID(sc);

                    if (!tId.startsWith(sc + '_')) {
                        tId = `${sc}_${(tId.match(/\d{4}/)||[''])[0] || Utility.generateID(sc).split('_')[1]}`;
                    }

                    let fUrl = document.getElementById('v_photo_url').value || "";
                    if (cropperSvc.pendingBlob) {
                        const uploadFileName = this.buildPhotoFileName(tId, st, nm);
                        fUrl = await cropperSvc.uploadToDrive(
                            cropperSvc.pendingBlob,
                            uploadFileName,
                            this.accessToken
                        );
                    }

                    let nR = new Array(this.headerRow.length).fill("");
                    let tIdx = document.getElementById('v_row_index').value;

                    if (tIdx) {
                        let rec = this.dataStore.find(r => String(r._rowIndex) === String(tIdx));
                        if (rec) nR = [...rec._raw];
                    }

                    const setV = (k, v) => {
                        if (this.colMap[k] !== -1 && this.colMap[k] !== undefined) nR[this.colMap[k]] = v;
                    };

                    setV('location', document.getElementById('v_location').value);
                    setV('store', st);
                    setV('techId', /^\d+$/.test(tId) ? `'${tId}` : tId);
                    setV('startDate', document.getElementById('v_start_date').value);
                    setV('name', nm);
                    setV('age', document.getElementById('v_age').value);
                    setV('stats', document.getElementById('v_stats').value);
                    setV('price', document.getElementById('v_price').value);
                    setV('url', document.getElementById('v_url').value);
                    setV('af', document.getElementById('v_af').value);
                    setV('level', document.getElementById('v_level').value);
                    setV('schedule', document.getElementById('v_schedule').value);
                    setV('photo', fUrl);
                    setV('updateTime', Utility.getCurrentTime());

                    let wUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(this.currentSheet)}`;

                    await fetch(
                        `${wUrl}!A${tIdx || '1:append'}?valueInputOption=USER_ENTERED`,
                        {
                            method: tIdx ? 'PUT' : 'POST',
                            headers: {
                                'Authorization': `Bearer ${this.accessToken}`,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({ values: [nR] })
                        }
                    );

                    cropperSvc.pendingBlob = null;
                    Utility.showToast(`✅ 儲存成功！`);
                    await this.loadSheetData();
                } catch (e) {
                    Utility.showToast('❌ 錯誤', true);
                } finally {
                    Utility.hideLoading();
                }
            }

            toggleFavorite(e, i) {
                e.stopPropagation();
                let r = this.dataStore[i]._raw;
                r[this.colMap.favorite] = r[this.colMap.favorite] === 'Y' ? '' : 'Y';
                this.renderCatalog();
                this.saveOrderToGoogleSheet(true);
            }

            clearForm() {
                document.getElementById('v_row_index').value = '';
                ['v_location','v_store','v_tech_id','v_start_date','v_name','v_age','v_stats','v_price','v_url','v_af','v_level','v_schedule','v_photo_url']
                    .forEach(id => document.getElementById(id).value = '');

                document.getElementById('preview_photo').style.display = 'none';
                document.getElementById('text_photo').style.display = 'block';
                document.getElementById('btn_del_photo').style.display = 'none';
                document.getElementById('btn-delete').style.display = 'none';
                cropperSvc.pendingBlob = null;

                if (!this.isEditMode) this.toggleMode();
            }
        }
