(function() {
    const handlers = [];

    function normalizeSiteMatches(siteMatches = []) {
        return Array.from(new Set(['Common', ...siteMatches.filter(Boolean)]));
    }

    window.SiteSyncRegistry = {
        register(handler) {
            if (!handler || !handler.id) return;
            handlers.push(handler);
        },

        getHandler({ siteCode = '', sourceUrl = '', siteMatches = [] } = {}) {
            const match = handlers.find(handler => handler.canHandle?.({ siteCode, sourceUrl, siteMatches }));
            if (match) return match;
            return handlers.find(handler => handler.id === 'yoasobi-heaven') || null;
        },

        inferSiteMatches({ app, text = '', html = '', sourceUrl = '', preferredSiteCode = '' } = {}) {
            const handler = this.getHandler({ siteCode: preferredSiteCode, sourceUrl, siteMatches: preferredSiteCode ? [preferredSiteCode] : [] });
            if (!handler?.inferSiteMatches) return normalizeSiteMatches(preferredSiteCode ? [preferredSiteCode] : []);
            return normalizeSiteMatches(handler.inferSiteMatches({ app, text, html, sourceUrl, preferredSiteCode }) || []);
        }
    };
})();
