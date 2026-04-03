(function() {
    const handler = {
        id: 'yoasobi-heaven',

        canHandle({ siteCode = '', sourceUrl = '', siteMatches = [] } = {}) {
            if (siteCode && siteCode !== 'yoshiwara-soap') return true;
            if (String(sourceUrl).includes('yoasobi-heaven.com')) return true;
            return siteMatches.some(site => site && site !== 'Common' && site !== 'yoshiwara-soap');
        },

        inferSiteMatches({ text = '', html = '', sourceUrl = '' } = {}) {
            const matches = new Set(['Common']);
            const haystacks = [String(text).toLowerCase(), String(html).toLowerCase(), String(sourceUrl).toLowerCase()];
            const joined = haystacks.join('\n');

            window.ruleEngine.rules.forEach(rule => {
                if (!rule.siteMatch || rule.siteMatch === 'Common' || rule.siteMatch === 'yoshiwara-soap') return;
                if (joined.includes(String(rule.siteMatch).toLowerCase())) matches.add(rule.siteMatch);
                if (rule.pattern && joined.includes(String(rule.pattern).toLowerCase())) matches.add(rule.siteMatch);
            });

            const urlMatch = String(sourceUrl).match(/\/tokyo\/[A-Za-z0-9_]+\/([^\/?#]+)/i);
            if (urlMatch?.[1]) matches.add(urlMatch[1].toLowerCase());
            return Array.from(matches);
        },

        parseBlocks({ app, text = '' } = {}) {
            const splitterRegex = app.getSplitterRegex();
            let blocks = String(text).split(splitterRegex).map(block => block.trim()).filter(Boolean);
            if (blocks.length <= 1) {
                blocks = String(text).split(/(?:^|\n)\s*No\.\s*\d+/i).map(block => block.trim()).filter(Boolean);
            }
            return blocks.length ? blocks : [String(text)];
        },

        buildListText(html = '') {
            const tempDiv = document.createElement('div');
            const cleanHtml = String(html)
                .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
                .replace(/<br\s*[\/]?>/gi, '\n')
                .replace(/<\/p>/gi, '\n</p>')
                .replace(/<\/div>/gi, '\n</div>');

            tempDiv.innerHTML = cleanHtml;
            tempDiv.querySelectorAll('a').forEach(anchor => {
                if (anchor.href && (anchor.href.includes('girlid') || anchor.href.includes('/cast/'))) {
                    anchor.innerText = `${anchor.innerText}\n${anchor.href}\n`;
                }
            });

            return tempDiv.innerText.replace(/\n\s*\n/g, '\n').trim();
        },

        extractRecord({ app, block, html = '', siteMatches = ['Common'] } = {}) {
            const common = app.extractCommonRuleData(block, html, siteMatches);
            if (!common?.rawName) return null;

            const tags = new Set(common.nameInfo.tags);
            common.extractedAf.tags.forEach(tag => tags.add(tag));

            return {
                name: common.nameInfo.pureName || common.rawName.trim(),
                store: app.getRecordStoreName(common),
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

        async syncAuto({ app, rule, statsObj } = {}) {
            const html = await app.fetchHtmlWithProxy(rule.pattern);
            const extractedText = this.buildListText(html);
            const siteMatches = app.inferSiteMatches(extractedText, html, rule.pattern, rule.siteMatch);
            if (!siteMatches.includes(rule.siteMatch)) siteMatches.push(rule.siteMatch);
            app.processBatchDataInternally(extractedText, html, siteMatches, statsObj, false, rule.pattern);
        }
    };

    window.SiteSyncRegistry?.register(handler);
})();
