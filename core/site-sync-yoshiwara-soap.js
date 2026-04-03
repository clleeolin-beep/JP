(function() {
    const CAST_BLOCK_MARKER = '@@YOSHI_CAST_BLOCK@@';

    const handler = {
        id: 'yoshiwara-soap',

        canHandle({ siteCode = '', sourceUrl = '', siteMatches = [] } = {}) {
            return siteCode === 'yoshiwara-soap' ||
                String(sourceUrl).includes('yoshiwara-soap.jp') ||
                siteMatches.includes('yoshiwara-soap');
        },

        inferSiteMatches() {
            return ['Common', 'yoshiwara-soap'];
        },

        parseBlocks({ text = '' } = {}) {
            const raw = String(text || '');
            if (raw.includes(CAST_BLOCK_MARKER)) {
                return raw
                    .split(CAST_BLOCK_MARKER)
                    .map(block => block.trim())
                    .filter(Boolean);
            }
            return [raw];
        },

        buildPlainText(html = '') {
            const tempDiv = document.createElement('div');
            const cleanHtml = String(html)
                .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
                .replace(/<br\s*[\/]?>/gi, '\n')
                .replace(/<\/p>/gi, '\n</p>')
                .replace(/<\/div>/gi, '\n</div>');
            tempDiv.innerHTML = cleanHtml;
            return tempDiv.innerText.replace(/\n\s*\n/g, '\n').trim();
        },

        buildListText(html = '') {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = String(html || '')
                .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

            const blocks = [];
            const seen = new Set();

            tempDiv.querySelectorAll('a[href*="/cast/"]').forEach(anchor => {
                const href = anchor.getAttribute('href') || '';
                const absUrl = new URL(href, 'https://yoshiwara-soap.jp').href;
                if (seen.has(absUrl)) return;
                seen.add(absUrl);

                const text = (anchor.textContent || '').replace(/\s+/g, ' ').trim();
                if (!text) return;

                const nameMatch = text.match(/^(.+?)\(\d{1,2}\D*?\)/);
                const ageMatch = text.match(/\((\d{1,2})\D*?\)/);
                const statsMatch = text.match(/(T\d{3}\s*B\d{2,3}\([A-Z]\)\s*W\d{2}\s*H\d{2})/i);

                blocks.push([
                    `NAME: ${(nameMatch?.[1] || '').trim()}`,
                    `AGE: ${(ageMatch?.[1] || '').trim()}`,
                    `STATS: ${(statsMatch?.[1] || '').trim()}`,
                    `URL: ${absUrl}`
                ].join('\n'));
            });

            if (!blocks.length) return this.buildPlainText(html);
            return blocks.join(`\n${CAST_BLOCK_MARKER}\n`);
        },

        extractRecord({ app, block, html = '', siteMatches = ['Common'] } = {}) {
            const storeRule = window.ruleEngine.rules.find(rule =>
                rule.siteMatch === 'yoshiwara-soap' &&
                rule.field === 'v_store' &&
                rule.ruleType === 'Set_Default'
            );
            const defaultStore = app.cleanStoreName(storeRule?.action || "コートダジュール COTE D'AZUR");

            const nameLine = String(block).match(/(?:^|\n)\s*NAME:\s*(.+)$/im);
            const ageLine = String(block).match(/(?:^|\n)\s*AGE:\s*(\d{1,2})/im);
            const statsLine = String(block).match(/(?:^|\n)\s*STATS:\s*(.+)$/im);
            const urlLine = String(block).match(/(?:^|\n)\s*URL:\s*(https?:\/\/[^\s]+)$/im);

            if (urlLine?.[1] && nameLine?.[1]) {
                return {
                    name: nameLine[1].trim(),
                    store: defaultStore,
                    stats: (statsLine?.[1] || '').trim(),
                    url: urlLine[1].trim(),
                    age: (ageLine?.[1] || '').trim(),
                    startDate: '',
                    price: '',
                    schedule: '',
                    hasSchedule: false,
                    tags: [],
                    level: '',
                    location: document.getElementById('v_location')?.value || '',
                    rawBlock: block
                };
            }

            const common = app.extractCommonRuleData(block, html, siteMatches);
            if (!common?.rawName) return null;

            const tags = new Set(common.nameInfo.tags);
            common.extractedAf.tags.forEach(tag => tags.add(tag));

            return {
                name: common.nameInfo.pureName || common.rawName.trim(),
                store: app.getRecordStoreName(common) || defaultStore,
                stats: common.extractedStats.value || (common.statsFallback?.[1]?.replace(/from.*/i, '').trim() || ''),
                url: common.extractedUrl.value || (common.urlFallback?.[0] || ''),
                age: common.extractedAge.value || (common.ageFallback?.[1] || ''),
                startDate: common.extractedDate.value || '',
                price: common.extractedPrice.value || document.getElementById('v_price')?.value || '',
                schedule: common.formattedSchedule,
                hasSchedule: /\d{1,2}\/\d{1,2}/.test(common.formattedSchedule),
                tags: Array.from(tags),
                level: common.nameInfo.level || common.extractedName.level || '',
                location: document.getElementById('v_location')?.value || '',
                rawBlock: block
            };
        },

        getScheduleUrls(baseUrl = 'https://yoshiwara-soap.jp/schedule/') {
            const root = String(baseUrl || 'https://yoshiwara-soap.jp/schedule/').replace(/\/+$/, '') + '/';
            return [
                root,
                `${root}tomorrow.html`,
                `${root}in-2-days.html`,
                `${root}in-3-days.html`,
                `${root}in-4-days.html`,
                `${root}in-5-days.html`,
                `${root}in-6-days.html`
            ];
        },

        formatScheduleLine(dateObj, value) {
            const dayMap = ['日', '一', '二', '三', '四', '五', '六'];
            return `${dateObj.getMonth() + 1}/${dateObj.getDate()} (${dayMap[dateObj.getDay()]}) ${value}`;
        },

        parseSchedulePage(html, dateObj) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = String(html || '')
                .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

            const results = [];
            const seen = new Set();

            tempDiv.querySelectorAll('a[href*="/cast/"]').forEach(anchor => {
                const href = anchor.getAttribute('href') || '';
                const absUrl = new URL(href, 'https://yoshiwara-soap.jp').href;
                const text = (anchor.textContent || '').replace(/\s+/g, ' ').trim();
                if (!text || !/\(\d{1,2}\D*?\)/.test(text) || !/\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}/.test(text)) return;
                if (seen.has(absUrl)) return;
                seen.add(absUrl);

                const nameMatch = text.match(/^(.+?)\(\d{1,2}\D*?\)/);
                const ageMatch = text.match(/\((\d{1,2})\D*?\)/);
                const statsMatch = text.match(/(T\d{3}\s*B\d{2,3}\([A-Z]\)\s*W\d{2}\s*H\d{2})/i);
                const timeMatch = text.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
                if (!nameMatch || !timeMatch) return;

                results.push({
                    name: nameMatch[1].trim(),
                    age: ageMatch?.[1] || '',
                    stats: statsMatch?.[1]?.replace(/\s+/g, ' ').trim() || '',
                    url: absUrl,
                    dayLine: this.formatScheduleLine(dateObj, `${timeMatch[1]}-${timeMatch[2]}`)
                });
            });

            return results;
        },

        async syncAuto({ app, rule, statsObj } = {}) {
            const scheduleUrls = this.getScheduleUrls(rule.pattern);
            const storeRule = window.ruleEngine.rules.find(candidate =>
                candidate.siteMatch === 'yoshiwara-soap' &&
                candidate.field === 'v_store' &&
                candidate.ruleType === 'Set_Default'
            );
            const storeName = app.cleanStoreName(storeRule?.action || "コートダジュール COTE D'AZUR");
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const storeIndexes = app.dataStore
                .map((item, index) => ({ item, index }))
                .filter(({ item }) => app.isSameStore(item._raw[app.colMap.store] || '', storeName));

            const scheduleMap = new Map();
            storeIndexes.forEach(({ item, index }) => {
                const lines = [];
                for (let offset = 0; offset < 7; offset++) {
                    const dateObj = new Date(today);
                    dateObj.setDate(today.getDate() + offset);
                    lines.push(this.formatScheduleLine(dateObj, '休息'));
                }
                scheduleMap.set(index, { row: item._raw, scheduleLines: lines });
            });

            const missingKeys = new Set();

            for (let offset = 0; offset < scheduleUrls.length; offset++) {
                if (!app.isSyncing) break;

                const url = scheduleUrls[offset];
                const dateObj = new Date(today);
                dateObj.setDate(today.getDate() + offset);
                Utility.showLoading(`自動同步中...\nyoshiwara-soap\n${url}`);

                const html = await app.fetchHtmlWithProxy(url);
                const records = this.parseSchedulePage(html, dateObj);

                records.forEach(record => {
                    const existingIndex = app.findRecordIndex({ ...record, store: storeName });
                    if (existingIndex === -1) {
                        missingKeys.add(record.url || `${storeName}:${record.name}`);
                        return;
                    }

                    if (!scheduleMap.has(existingIndex)) {
                        const row = app.dataStore[existingIndex]._raw;
                        const lines = [];
                        for (let innerOffset = 0; innerOffset < 7; innerOffset++) {
                            const innerDate = new Date(today);
                            innerDate.setDate(today.getDate() + innerOffset);
                            lines.push(this.formatScheduleLine(innerDate, '休息'));
                        }
                        scheduleMap.set(existingIndex, { row, scheduleLines: lines });
                    }

                    const entry = scheduleMap.get(existingIndex);
                    entry.scheduleLines[offset] = record.dayLine;

                    app.applyRecordToRow(entry.row, {
                        store: storeName,
                        name: record.name,
                        age: record.age,
                        stats: record.stats,
                        url: record.url,
                        schedule: entry.scheduleLines.join('\n'),
                        hasSchedule: true,
                        tags: []
                    }, false);
                });

                await new Promise(resolve => setTimeout(resolve, 800));
            }

            let updatedCount = 0;
            scheduleMap.forEach(entry => {
                entry.row[app.colMap.schedule] = entry.scheduleLines.join('\n');
                entry.row[app.colMap.updateTime] = Utility.getCurrentTime();
                updatedCount++;
            });

            statsObj.total += scheduleMap.size + missingKeys.size;
            statsObj.updated += updatedCount;
            statsObj.missing += missingKeys.size;
        }
    };

    window.SiteSyncRegistry?.register(handler);
})();
