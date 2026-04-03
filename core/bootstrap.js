window.app = null;
        const cropperSvc = new ImageCropperService();

        window.addEventListener('message', (event) => {
            const payload = event?.data || {};
            if (!payload || payload.type !== 'JP_AUTH_BRIDGE') return;
            try {
                if (payload.accessToken) sessionStorage.setItem('gapi_access_token', payload.accessToken);
                sessionStorage.setItem('gapi_has_write', payload.hasWriteAccess ? 'true' : 'false');
            } catch (_) {}
        });

        window.onload = () => {
            window.app = new AppCore();
            window.app.initGoogleAuth();
        };
