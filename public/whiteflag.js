// ============================================================
// whiteflag.js — WhiteFlag App JavaScript
// ============================================================

// ── PWA / Service Worker ──────────────────────────────────────
// Service Worker Registration (PWA Support)
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('/sw.js')
                    .then(reg => console.log('Service Worker registered'))
                    .catch(err => console.log('Service Worker registration failed'));
            });
        }

        // Performance monitoring
        window.addEventListener('load', () => {
            if (window.performance) {
                const perfData = window.performance.timing;
                const pageLoadTime = perfData.loadEventEnd - perfData.navigationStart;
                console.log('Page load time:', pageLoadTime + 'ms');
            }

            // Restore wallet session
            restoreWalletState();
        });

        // Prevent double-tap zoom on iOS
        let lastTouchEnd = 0;
        document.addEventListener('touchend', (e) => {
            const now = Date.now();
            if (now - lastTouchEnd <= 300) {
                e.preventDefault();
            }
            lastTouchEnd = now;
        }, false);

        // Online/Offline detection
        window.addEventListener('online', () => {
            console.log('Back online');
        });

        window.addEventListener('offline', () => {
            console.log('Connection lost');
        });

        // Lazy load images
        if ('IntersectionObserver' in window) {
            const imageObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const img = entry.target;
                        if (img.dataset.src) {
                            img.src = img.dataset.src;
                            img.removeAttribute('data-src');
                            imageObserver.unobserve(img);
                        }
                    }
                });
            });

            document.querySelectorAll('img[data-src]').forEach(img => {
                imageObserver.observe(img);
            });
        }

        // Install prompt for PWA
        let deferredPrompt;
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            deferredPrompt = e;
            console.log('PWA install prompt available');
        });

        // Analytics placeholder
        window.addEventListener('load', () => {
            // Add your analytics code here
            console.log('WhiteFlag app loaded successfully');
        });

// ── API Configuration & Auth ──────────────────────────────────
// ══════════════════════════════════════════════════════════
        // BACKEND API CONFIGURATION
        // Central configuration for all API calls
        // ══════════════════════════════════════════════════════════

        const API_BASE = 'https://white-flag-app-frontend-and-backend.onrender.com/api';

        // ── Central authenticated fetch helper ─────────────────
        async function api(path, options = {}) {
            const token = localStorage.getItem('wf_token');
            const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers };
            try {
                const res = await fetch(API_BASE + path, { ...options, headers });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
                return data;
            } catch (err) {
                console.error('API error:', path, err.message);
                throw err;
            }
        }

        // Save/load auth token & user
        function saveAuth(token, user) {
            localStorage.setItem('wf_token', token);
            localStorage.setItem('wf_user', JSON.stringify(user));
            isLoggedIn      = true;
            walletConnected = true;
            isVerified      = user.isVerified || false;
            currentUser     = user.username   || '';
            if (typeof startNotifPolling === 'function') startNotifPolling();
        }
        function clearAuth() {
            localStorage.removeItem('wf_token');
            localStorage.removeItem('wf_user');
            isLoggedIn = false;
            walletConnected = false;
            isVerified = false;
        }
        function getStoredUser() {
            try { return JSON.parse(localStorage.getItem('wf_user') || 'null'); } catch { return null; }
        }

        // Restore session on load
        (function restoreSession() {
            const user = getStoredUser();
            const token = localStorage.getItem('wf_token');
            if (user && token) {
                isLoggedIn = true;
                walletConnected = true;
                isVerified = user.isVerified || false;
                walletAddress = user.walletAddress || '';
                // Refresh wallet button state
                document.addEventListener('DOMContentLoaded', () => updateWalletButton && updateWalletButton());
            }
        })();

        // ══════════════════════════════════════════════════════════
        // API HELPER FUNCTIONS
        // Centralized API communication
        // ══════════════════════════════════════════════════════════

        /**
         * Make authenticated API call
         * @param {string} endpoint - API endpoint
         * @param {object} options - Fetch options
        // ══════════════════════════════════════════════════════════
        // BOOKMARKS FUNCTIONALITY
        // Save and manage bookmarked posts
        // ══════════════════════════════════════════════════════════

        let bookmarks = JSON.parse(localStorage.getItem('whiteflag_bookmarks') || '[]');

        /**
         * Toggle bookmark status for a post
         * @param {HTMLElement} button - Bookmark button element
         */
        function toggleBookmark(button) {
            const postCard = button.closest('.profile-post-card, .post-card');
            const postId = button.dataset.postId || '';
            const numericId = postId.replace(/\D/g, '');

            // Check if already bookmarked (optimistic local state)
            const bookmarkIndex = bookmarks.findIndex(b => b.id === postId);

            if (bookmarkIndex > -1) {
                // Remove bookmark
                bookmarks.splice(bookmarkIndex, 1);
                button.style.opacity = '0.5';
                button.classList.remove('active');
                showToast('Bookmark removed');
                if (numericId && isLoggedIn) {
                    api(`/bookmarks/${numericId}`, { method: 'DELETE' }).catch(() => {});
                }
            } else {
                // Add bookmark
                const postData = {
                    id: postId,
                    title: postCard?.querySelector('.profile-post-title, .post-title')?.textContent || '',
                    content: postCard?.querySelector('.profile-post-text, .post-content')?.textContent?.trim().slice(0,120) || '',
                    timestamp: Date.now()
                };
                bookmarks.unshift(postData);
                button.style.opacity = '1';
                button.classList.add('active');
                showToast('Post bookmarked! 🔖');
                if (numericId && isLoggedIn) {
                    api('/bookmarks', { method: 'POST', body: JSON.stringify({ postId: parseInt(numericId) }) }).catch(() => {});
                }
            }

            // Persist locally
            localStorage.setItem('whiteflag_bookmarks', JSON.stringify(bookmarks));

            // Refresh bookmarks page if visible
            if (document.getElementById('bookmarks')?.classList.contains('active')) {
                loadBookmarks();
            }
        }

        /**
         * Load and display bookmarked posts
         */
        async function loadBookmarks() {
            const container = document.getElementById('bookmarkedPostsList');
            const emptyState = document.getElementById('bookmarksEmptyState');
            if (!container) return;

            if (isLoggedIn) {
                try {
                    const data = await api('/bookmarks');
                    const bmarks = (data && data.bookmarks) || [];
                    if (!bmarks.length) {
                        if (emptyState) emptyState.style.display = 'block';
                        container.innerHTML = '';
                        return;
                    }
                    if (emptyState) emptyState.style.display = 'none';
                    container.innerHTML = bmarks.map(function(p) {
                        var pid = String(p.id || '');
                        var ts = p.bookmarked_at ? _timeAgo(p.bookmarked_at) : '';
                        return '<div class="profile-post-card" data-post-id="' + pid + '">'
                            + '<div class="profile-post-border-accent"></div>'
                            + '<div class="profile-post-content">'
                            + '<div class="profile-post-header">'
                            + '<span class="profile-post-topic">&#x1F516; Bookmarked</span>'
                            + '<span class="profile-post-time">' + ts + '</span>'
                            + '</div>'
                            + (p.title ? '<div class="profile-post-title">' + escapeHtml(p.title) + '</div>' : '')
                            + '<div class="profile-post-text">' + escapeHtml(p.content || '') + '</div>'
                            + '<div class="post-action-bar">'
                            + '<button class="post-action-btn" onclick="removeBookmarkById(' + pid + ', this)">&#x1F5D1;&#xFE0F; Remove</button>'
                            + '<button class="post-action-btn" onclick="toggleUpvote(this)">&#9650; ' + (p.upvote_count || 0) + '</button>'
                            + '<button class="post-action-btn" onclick="copyPostLink(this)" data-post-id="' + pid + '">&#x1F517; Copy Link</button>'
                            + '</div>'
                            + '</div></div>';
                    }).join('');
                    return;
                } catch(e) { /* fall through to local cache */ }
            }

            // Fallback: local bookmark cache
            if (!bookmarks || bookmarks.length === 0) {
                if (emptyState) emptyState.style.display = 'block';
                return;
            }
            if (emptyState) emptyState.style.display = 'none';
            container.innerHTML = bookmarks.map(function(post) {
                return '<div class="profile-post-card">'
                    + '<div class="profile-post-border-accent"></div>'
                    + '<div class="profile-post-content">'
                    + '<div class="profile-post-header">'
                    + '<span class="profile-post-topic">&#x1F516; Bookmarked</span>'
                    + '<span class="profile-post-time">' + timeAgo(post.timestamp) + '</span>'
                    + '</div>'
                    + (post.title ? '<div class="profile-post-title">' + escapeHtml(post.title) + '</div>' : '')
                    + '<div class="profile-post-text">' + escapeHtml(post.content) + '</div>'
                    + '<div class="post-action-bar">'
                    + '<button class="post-action-btn" onclick="removeBookmark(\'' + post.id + '\')">' + '&#x1F5D1;&#xFE0F; Remove</button>'
                    + '<button class="post-action-btn" onclick="copyPostLink(this)">&#x1F517; Copy Link</button>'
                    + '</div></div></div>';
            }).join('');
        }

        async function removeBookmarkById(postId, btn) {
            if (btn) { btn.disabled = true; btn.textContent = 'Removing...'; }
            try {
                await api('/bookmarks/' + postId, { method: 'DELETE' });
                showToast('Bookmark removed');
                loadBookmarks();
            } catch(e) {
                showToast('Could not remove bookmark', 'error');
                if (btn) { btn.disabled = false; btn.textContent = '&#x1F5D1;&#xFE0F; Remove'; }
            }
        }

        /**
         * Remove a specific bookmark
         * @param {string} postId - Post ID to remove
         */
        function removeBookmark(postId) {
            bookmarks = bookmarks.filter(b => b.id !== postId);
            localStorage.setItem('whiteflag_bookmarks', JSON.stringify(bookmarks));
            loadBookmarks();
            showToast('Bookmark removed');
        }

        /**
         * Sort bookmarks by date
         * @param {string} type - 'recent' or 'oldest'
         */
        function sortBookmarks(type) {
            if (type === 'recent') {
                bookmarks.sort((a, b) => b.timestamp - a.timestamp);
            } else {
                bookmarks.sort((a, b) => a.timestamp - b.timestamp);
            }
            loadBookmarks();
        }

        // ══════════════════════════════════════════════════════════
        // COPY POST LINK FUNCTIONALITY
        // Copy post URL to clipboard
        // ══════════════════════════════════════════════════════════

        /**
         * Copy post link to clipboard
         * @param {HTMLElement} button - Copy button element
         */
        function copyPostLink(button) {
            const postCard = button.closest('.profile-post-card');
            const postId = button.dataset.postId || 'post_' + Date.now();
            const url = window.location.origin + window.location.pathname + '#/post/' + postId;

            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(url).then(() => {
                    const originalText = button.textContent;
                    button.textContent = '✓ Copied!';
                    button.style.color = '#14F195';

                    setTimeout(() => {
                        button.textContent = originalText;
                        button.style.color = '';
                    }, 2000);
                }).catch(err => {
                    console.error('Copy failed:', err);
                    fallbackCopy(url);
                });
            } else {
                fallbackCopy(url);
            }
        }

        /**
         * Fallback copy method for older browsers
         * @param {string} text - Text to copy
         */
        function fallbackCopy(text) {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();

            try {
                document.execCommand('copy');
                showToast('Link copied!');
            } catch (err) {
                showToast('Copy failed — try manually', 'error');
            }

            document.body.removeChild(textarea);
        }

        // ══════════════════════════════════════════════════════════
        // UTILITY FUNCTIONS
        // Helper functions used throughout the app
        // ══════════════════════════════════════════════════════════

        /**
         * Display toast notification
         * @param {string} message - Message to display
         */
        function showToast(message, type) {
            const toast = document.createElement('div');
            const isError = type === 'error';
            toast.style.cssText = `
                position: fixed;
                bottom: 20px;
                right: 20px;
                background: ${isError ? '#ff4d4d' : '#14F195'};
                color: ${isError ? '#fff' : '#000'};
                padding: 12px 20px;
                border-radius: 8px;
                font-weight: 600;
                z-index: 10000;
                max-width: 320px;
                box-shadow: 0 4px 16px rgba(0,0,0,0.3);
                animation: slideIn 0.3s ease;
            `;
            toast.textContent = message;
            document.body.appendChild(toast);

            setTimeout(() => {
                toast.style.animation = 'slideOut 0.3s ease';
                setTimeout(() => toast.remove(), 300);
            }, 3000);
        }

        /**
         * Calculate time ago from timestamp
         * @param {number} timestamp - Unix timestamp
         * @returns {string} - Human readable time ago
         */
        function timeAgo(timestamp) {
            const seconds = Math.floor((Date.now() - timestamp) / 1000);

            if (seconds < 60) return 'just now';
            if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
            if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
            return Math.floor(seconds / 86400) + 'd ago';
        }

        /**
         * Escape HTML to prevent XSS
         * @param {string} text - Text to escape
         * @returns {string} - Escaped text
         */
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        // ══════════════════════════════════════════════════════════
        // INITIALIZATION
        // Load bookmarks when bookmarks screen is opened
        // ══════════════════════════════════════════════════════════

        // Extend switchScreen to load bookmarks
        (function() {
            const originalSwitchScreen = window.switchScreen;
            window.switchScreen = function(screenId) {
                originalSwitchScreen(screenId);

                // Load bookmarks when bookmarks screen is opened
                if (screenId === 'bookmarks') {
                    loadBookmarks();
                }
            };
        })();

// ── Main App ──────────────────────────────────────────────────
let currentMedia = null;
        let currentMediaType = null;
        let profilePictureData = null;
        // ── NFT / custom PFP registry ──────────────────────────────────────
        const USER_AVATARS = {};

        function setUserAvatar(username, imageData) {
            USER_AVATARS[username] = imageData;
            refreshAllAvatars();
        }

        function refreshAllAvatars() {
            document.querySelectorAll('[data-avatar-user]').forEach(el => {
                const user = el.dataset.avatarUser;
                if (USER_AVATARS[user]) {
                    el.style.backgroundImage = 'url(' + USER_AVATARS[user] + ')';
                    el.style.backgroundSize = 'cover';
                    el.style.backgroundPosition = 'center';
                    el.textContent = '';
                } else {
                    el.style.backgroundImage = '';
                    if (!el.textContent.trim()) el.textContent = user ? user[0].toUpperCase() : '?';
                }
            });
        }

                let isLoggedIn = false;
        let currentUser = ''; // Set from session on login (see restoreWalletState / saveAuth)
        let selectedTopic = null;
        let isDarkMode = true;

        // Wallet Connection State
        let walletConnected = false;
        let walletAddress = '';
        let walletProvider = ''; // phantom, solflare, backpack
        let isVerified = false;

        // Wallet Connection Functions
        function handleWalletConnection() {
            if (walletConnected) {
                // Show wallet info or disconnect options
                showWalletInfo();
            } else {
                // Open wallet selection modal
                openWalletModal();
            }
        }

        // ═══════════════════════════════════════════════════════════════════
        // WALLET CONNECTION
        // Real Solana wallet integration: Phantom · Solflare · Backpack
        // Flow: detect provider → connect() → get nonce → signMessage() → POST /auth/verify
        // ═══════════════════════════════════════════════════════════════════

        function openWalletModal() {
            document.getElementById('walletModal').style.display = 'flex';
            // Show detected / not-installed status for each wallet
            setTimeout(_refreshWalletModalStatus, 80);
        }
        function closeWalletModal() {
            document.getElementById('walletModal').style.display = 'none';
        }

        // ══════════════════════════════════════════════════════════════════
        // SOLANA WALLET CONNECTION
        // Real provider detection → connect() → nonce → signMessage → JWT
        // Supports: Phantom, Solflare, Backpack (+ mobile deep-links)
        // ══════════════════════════════════════════════════════════════════

        // ── Provider detection ─────────────────────────────────────────────
        // Each major Solana wallet injects itself onto window under a known key.
        // We wait up to 1 second for the extension to initialise before giving up.
        var _providerCache = {};

        async function _getProvider(name) {
            // Return cached result after first detection
            if (_providerCache[name] !== undefined) return _providerCache[name];

            // Wallets can take up to ~500 ms to inject after DOMContentLoaded
            var waited = 0;
            while (waited < 800) {
                var p = _detectProvider(name);
                if (p) { _providerCache[name] = p; return p; }
                await new Promise(function(r){ setTimeout(r, 100); });
                waited += 100;
            }
            _providerCache[name] = null;
            return null;
        }

        function _detectProvider(name) {
            if (name === 'Phantom') {
                // Phantom recommends window.phantom.solana; window.solana is legacy
                if (window.phantom && window.phantom.solana && window.phantom.solana.isPhantom)
                    return window.phantom.solana;
                if (window.solana && window.solana.isPhantom)
                    return window.solana;
                return null;
            }
            if (name === 'Solflare') {
                if (window.solflare && window.solflare.isSolflare) return window.solflare;
                if (window.solflare) return window.solflare;
                return null;
            }
            if (name === 'Backpack') {
                // Backpack injects as window.backpack (newer) or window.xnft.solana (older)
                if (window.backpack && window.backpack.isBackpack) return window.backpack;
                if (window.backpack) return window.backpack;
                if (window.xnft && window.xnft.solana) return window.xnft.solana;
                return null;
            }
            return null;
        }

        // Detect all installed wallets (synchronous fast check for modal UI)
        function _detectAll() {
            return {
                Phantom:  !!_detectProvider('Phantom'),
                Solflare: !!_detectProvider('Solflare'),
                Backpack: !!_detectProvider('Backpack')
            };
        }

        const WALLET_INSTALL = {
            Phantom:  'https://phantom.app/download',
            Solflare: 'https://solflare.com/download',
            Backpack: 'https://backpack.app/download'
        };

        // Mobile deep-link URLs (used when no extension is detected on mobile)
        const WALLET_DEEPLINK = {
            Phantom:  'https://phantom.app/ul/v1/connect',
            Solflare: 'https://solflare.com/ul/v1/connect'
        };

        function connectPhantom()  { connectWallet('Phantom'); }
        function connectSolflare() { connectWallet('Solflare'); }
        function connectBackpack() { connectWallet('Backpack'); }

        // ── Main wallet connection flow ────────────────────────────────────
        // 1. Detect provider (with 800ms wait for extension to inject)
        // 2. provider.connect()           → get public key
        // 3. GET /auth/nonce/:address     → get nonce + message to sign
        // 4. provider.signMessage(msg)    → ed25519 signature
        // 5. POST /auth/verify            → verify sig server-side → JWT
        // 6. saveAuth() / updateWalletButton()
        async function connectWallet(providerName) {
            closeWalletModal();
            _setWalletLoading(true, 'Detecting ' + providerName + '\u2026');

            var provider = await _getProvider(providerName);

            if (!provider) {
                _setWalletLoading(false);
                _handleWalletNotFound(providerName);
                return;
            }

            _setWalletLoading(true, 'Connecting to ' + providerName + '\u2026');

            try {
                // ── Step 1: connect() and get public key ──────────────────
                var publicKey;
                try {
                    var resp = await provider.connect();
                    // Different wallets return the public key in different places
                    publicKey = _extractPublicKey(resp, provider);
                } catch (connErr) {
                    _setWalletLoading(false);
                    if (_isUserRejection(connErr)) {
                        showToast('Connection cancelled', 'error');
                    } else {
                        showToast('Could not connect: ' + (connErr.message || 'unknown error'), 'error');
                        console.error('[wallet connect]', connErr);
                    }
                    return;
                }

                if (!publicKey || typeof publicKey !== 'string' || publicKey.length < 32) {
                    _setWalletLoading(false);
                    showToast('Wallet returned no public key \u2014 try again', 'error');
                    return;
                }

                walletAddress  = publicKey;
                walletProvider = providerName;

                // ── Step 2: get sign-in nonce from backend ────────────────
                _setWalletLoading(true, 'Requesting nonce\u2026');
                var nonce, messageToSign;
                try {
                    var nonceData = await api('/auth/nonce/' + publicKey);
                    nonce         = nonceData.nonce;
                    // Backend returns exact message string: "Sign in to WhiteFlag\n\nNonce: <uuid>"
                    messageToSign = nonceData.message || ('Sign in to WhiteFlag\n\nNonce: ' + nonce);
                } catch (nonceErr) {
                    _setWalletLoading(false);
                    if (nonceErr.message && nonceErr.message.includes('Invalid Solana address')) {
                        showToast('Invalid wallet address returned by ' + providerName, 'error');
                        walletAddress = ''; walletProvider = '';
                        return;
                    }
                    // Backend offline → demo mode
                    console.warn('[wallet] backend offline, entering demo mode');
                    _enterDemoMode(providerName, publicKey);
                    return;
                }

                // ── Step 3: sign the nonce message ────────────────────────
                _setWalletLoading(true, 'Waiting for signature\u2026');
                var signature;
                try {
                    var msgBytes = new TextEncoder().encode(messageToSign);
                    var signed   = await provider.signMessage(msgBytes, 'utf8');
                    signature    = _extractSignature(signed);
                } catch (signErr) {
                    _setWalletLoading(false);
                    walletAddress = ''; walletProvider = '';
                    if (_isUserRejection(signErr)) {
                        showToast('Signature rejected \u2014 sign-in cancelled', 'error');
                    } else {
                        showToast('Signing failed: ' + (signErr.message || 'unknown'), 'error');
                        console.error('[wallet sign]', signErr);
                    }
                    return;
                }

                if (!signature) {
                    _setWalletLoading(false);
                    walletAddress = ''; walletProvider = '';
                    showToast('Could not extract signature from wallet response', 'error');
                    return;
                }

                // ── Step 4: verify with backend → receive JWT ─────────────
                _setWalletLoading(true, 'Verifying with server\u2026');
                var authData;
                try {
                    authData = await api('/auth/verify', {
                        method: 'POST',
                        body: JSON.stringify({ walletAddress: publicKey, signature: signature })
                    });
                } catch (authErr) {
                    _setWalletLoading(false);
                    walletAddress = ''; walletProvider = '';
                    showToast('Server auth failed: ' + (authErr.message || 'unknown'), 'error');
                    console.error('[wallet verify]', authErr);
                    return;
                }

                // ── Step 5: save session ──────────────────────────────────
                var user = authData.user;
                saveAuth(authData.token, Object.assign({}, user, { walletAddress: publicKey }));
                walletConnected = true;

                // Persist wallet metadata for session restore
                localStorage.setItem('wf_walletProvider', providerName);
                localStorage.setItem('wf_walletAddress',  publicKey);

                _setWalletLoading(false);
                updateWalletButton();
                showToast('\u2705 ' + providerName + ' connected!');

                // Attach account-change listener to auto-disconnect on switch
                _attachAccountChangeListener(provider, providerName);

                // Prompt unverified users to get the $5 checkmark
                if (!user.isVerified) {
                    setTimeout(_showVerificationPrompt, 1200);
                }

            } catch (fatalErr) {
                _setWalletLoading(false);
                walletAddress = ''; walletProvider = '';
                console.error('[connectWallet] fatal', fatalErr);
                showToast('Wallet connection failed \u2014 try again', 'error');
            }
        }

        // ── Helper: extract public key from provider.connect() response ───
        function _extractPublicKey(resp, provider) {
            if (resp && resp.publicKey) {
                var pk = resp.publicKey;
                return (typeof pk === 'string') ? pk : (pk.toString ? pk.toString() : null);
            }
            if (provider.publicKey) {
                var pk2 = provider.publicKey;
                return (typeof pk2 === 'string') ? pk2 : (pk2.toString ? pk2.toString() : null);
            }
            return null;
        }

        // ── Helper: extract base58 signature from signMessage response ────
        // Wallets return one of:
        //   { signature: Uint8Array }      — Phantom standard
        //   Uint8Array                     — some adapters
        //   { signature: base58string }    — some legacy
        function _extractSignature(signed) {
            var raw;
            if (!signed) return null;
            if (signed.signature instanceof Uint8Array) {
                raw = signed.signature;
            } else if (signed instanceof Uint8Array) {
                raw = signed;
            } else if (typeof signed.signature === 'string') {
                // Already encoded — pass straight through
                return signed.signature;
            } else if (typeof signed === 'string') {
                return signed;
            } else if (signed.signature && typeof signed.signature === 'object' && signed.signature.data) {
                raw = new Uint8Array(signed.signature.data);
            } else {
                return null;
            }
            return _uint8ToBase58(raw);
        }

        // ── Helper: user rejection detection ─────────────────────────────
        function _isUserRejection(err) {
            if (!err) return false;
            if (err.code === 4001) return true;
            var msg = (err.message || '').toLowerCase();
            return msg.includes('user rejected') || msg.includes('cancelled') || msg.includes('denied');
        }

        // ── Demo mode: use app without backend JWT ────────────────────────
        function _enterDemoMode(providerName, publicKey) {
            walletConnected = true;
            isLoggedIn      = true;
            // Don't saveAuth() since there's no token
            updateWalletButton();
            showToast('\u2705 ' + providerName + ' connected (backend offline \u2014 demo mode)');
        }

        // ── Account-change listener: disconnect if user switches wallet ───
        function _attachAccountChangeListener(provider, providerName) {
            if (!provider || typeof provider.on !== 'function') return;

            // Remove any existing listener first
            try { provider.removeAllListeners && provider.removeAllListeners('accountChanged'); } catch(_) {}
            try { provider.removeAllListeners && provider.removeAllListeners('disconnect'); } catch(_) {}

            provider.on('accountChanged', function(newPublicKey) {
                if (!newPublicKey) {
                    // Wallet locked or disconnected
                    disconnectWallet();
                    showToast(providerName + ' disconnected');
                } else {
                    var newAddr = typeof newPublicKey === 'string'
                        ? newPublicKey
                        : (newPublicKey.toString ? newPublicKey.toString() : null);
                    if (newAddr && newAddr !== walletAddress) {
                        // Different account selected — re-authenticate
                        showToast(providerName + ' account changed \u2014 reconnecting\u2026');
                        disconnectWallet();
                        setTimeout(function() { connectWallet(providerName); }, 400);
                    }
                }
            });

            provider.on('disconnect', function() {
                if (walletConnected) {
                    disconnectWallet();
                    showToast(providerName + ' disconnected');
                }
            });
        }

        // ── Not installed handler ─────────────────────────────────────────
        function _handleWalletNotFound(providerName) {
            var isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

            if (isMobile && WALLET_DEEPLINK[providerName]) {
                // On mobile: offer to open in the wallet's browser
                var currentUrl = encodeURIComponent(window.location.href);
                var deepLink   = WALLET_DEEPLINK[providerName]
                    + '?app_url=' + currentUrl
                    + '&dapp_encryption_public_key=';
                showToast(providerName + ' not detected \u2014 opening wallet app\u2026');
                setTimeout(function() { window.location.href = deepLink; }, 800);
            } else {
                // Desktop: show install prompt in modal
                openWalletModal();
                _refreshWalletModalStatus(); // re-run detection to mark as not installed
                showToast(providerName + ' not detected \u2014 install the extension', 'error');
            }
        }

        // ── Pure-JS base58 encoder (no external deps) ────────────────────
        var _B58_ALPHA = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
        function _uint8ToBase58(bytes) {
            if (!bytes || !bytes.length) return '';
            var arr    = Array.from(bytes);
            var zeros  = 0;
            while (zeros < arr.length && arr[zeros] === 0) zeros++;
            var digits = [0];
            for (var i = zeros; i < arr.length; i++) {
                var carry = arr[i];
                for (var j = 0; j < digits.length; j++) {
                    carry    += digits[j] << 8;
                    digits[j] = carry % 58;
                    carry     = Math.floor(carry / 58);
                }
                while (carry > 0) { digits.push(carry % 58); carry = Math.floor(carry / 58); }
            }
            var result = '';
            for (var k = 0; k < zeros; k++) result += '1';
            for (var m = digits.length - 1; m >= 0; m--) result += _B58_ALPHA[digits[m]];
            return result;
        }

        // ── UI helpers ────────────────────────────────────────────────────

        function openWalletModal() {
            document.getElementById('walletModal').style.display = 'flex';
            // Refresh detected status immediately (sync), then again after 500ms for slow extensions
            _refreshWalletModalStatus();
            setTimeout(_refreshWalletModalStatus, 500);
        }

        function closeWalletModal() {
            document.getElementById('walletModal').style.display = 'none';
        }

        function _setWalletLoading(loading, msg) {
            var btn  = document.getElementById('headerWalletBtn');
            var text = document.getElementById('walletBtnText');
            if (!btn) return;
            btn.disabled = !!loading;
            if (loading && text) text.textContent = msg || 'Connecting\u2026';
            if (!loading) btn.disabled = false;
        }

        // Refresh the wallet modal's install status badges
        function _refreshWalletModalStatus() {
            ['Phantom', 'Solflare', 'Backpack'].forEach(function(name) {
                _markWalletOptionStatus(name, !!_detectProvider(name));
            });
        }

        // Update a wallet card's status text + arrow + opacity
        function _markWalletOptionStatus(name, detected) {
            var statusEl = document.getElementById('walletStatus_' + name);
            var arrowEl  = document.getElementById('walletArrow_' + name);
            var card     = statusEl && statusEl.closest('.wallet-option-card');

            if (statusEl) {
                if (detected) {
                    statusEl.textContent = 'Detected \u2014 ready to connect';
                    statusEl.style.color = '#14F195';
                } else {
                    var url = WALLET_INSTALL[name] || '#';
                    statusEl.innerHTML  = 'Not installed \u2014 <a href="' + url
                        + '" target="_blank" style="color:#9945FF;font-weight:700;text-decoration:none;"'
                        + ' onclick="event.stopPropagation()">Install</a>';
                    statusEl.style.color = '';
                }
            }
            if (arrowEl) arrowEl.textContent = detected ? '\u2192' : '\u2193';
            if (card)    card.style.opacity  = detected ? '1' : '0.65';
        }

        // ── Verification banner (post-connect nudge) ──────────────────────
        function _showVerificationPrompt() {
            var prev = document.getElementById('verificationBanner');
            if (prev) prev.remove();
            var el = document.createElement('div');
            el.id  = 'verificationBanner';
            el.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);'
                + 'background:linear-gradient(135deg,#9945FF,#14F195);color:#fff;'
                + 'padding:14px 20px;border-radius:12px;font-weight:700;font-size:0.92em;'
                + 'z-index:9000;display:flex;align-items:center;gap:12px;'
                + 'box-shadow:0 4px 24px rgba(153,69,255,0.45);max-width:340px;cursor:pointer;';
            el.innerHTML = '<span style="font-size:1.3em;">&#x1F4A0;</span>'
                + '<span>Get Verified for $5 \u2014 unlock rewards &amp; posting!</span>'
                + '<button id="verifyBannerClose" style="background:none;border:none;color:#fff;'
                + 'font-size:1.1em;cursor:pointer;line-height:1;margin-left:4px;">\u2715</button>';
            el.addEventListener('click', function(e) {
                if (e.target.id !== 'verifyBannerClose') { handleVerification(); el.remove(); }
                else el.remove();
            });
            document.body.appendChild(el);
            setTimeout(function() { if (el.parentNode) el.remove(); }, 8000);
        }

        // ── Wallet info popup (shown when clicking header button while connected) ──
        function showWalletInfo() {
            var existing = document.getElementById('walletInfoPopup');
            if (existing) { existing.remove(); return; }

            var shortAddr = walletAddress
                ? walletAddress.slice(0, 6) + '\u2026' + walletAddress.slice(-6)
                : 'Unknown';
            var icons    = { Phantom: '&#x1F47B;', Solflare: '&#x1F525;', Backpack: '&#x1F392;' };
            var provIcon = icons[walletProvider] || '&#x25CE;';
            var statusClr = isVerified ? '#14F195' : '#f59e0b';
            var statusLbl = isVerified ? '&#x2713; Verified' : '&#x23F3; Not Verified';

            var popup = document.createElement('div');
            popup.id  = 'walletInfoPopup';
            popup.style.cssText = 'position:fixed;top:64px;right:16px;z-index:9500;'
                + 'background:var(--bg-secondary,#1a1a2e);border:1px solid var(--border,#333);'
                + 'border-radius:14px;padding:20px;min-width:268px;max-width:320px;'
                + 'box-shadow:0 8px 32px rgba(0,0,0,0.5);font-family:Montserrat,sans-serif;font-size:0.88em;';

            popup.innerHTML = ''
                + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">'
                + '  <div style="font-weight:800;color:var(--text-primary,#fff);">Wallet Connected</div>'
                + '  <button id="walletPopupClose" style="background:none;border:none;color:var(--text-tertiary,#888);font-size:1.1em;cursor:pointer;">\u2715</button>'
                + '</div>'
                + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">'
                + '  <span style="font-size:1.5em;">' + provIcon + '</span>'
                + '  <div>'
                + '    <div style="font-weight:700;color:var(--text-primary,#fff);">' + escapeHtml(walletProvider || 'Unknown') + '</div>'
                + '    <div style="color:var(--text-tertiary,#888);font-size:0.82em;">Solana Mainnet</div>'
                + '  </div>'
                + '</div>'
                + '<div style="background:var(--bg-tertiary,#111);border-radius:8px;padding:10px 12px;margin-bottom:10px;">'
                + '  <div style="color:var(--text-tertiary,#888);font-size:0.75em;margin-bottom:4px;text-transform:uppercase;letter-spacing:.04em;">Address</div>'
                + '  <div style="font-family:\'Space Mono\',monospace;color:var(--primary,#14F195);font-size:0.82em;word-break:break-all;">' + escapeHtml(shortAddr) + '</div>'
                + '  <button onclick="copyWalletAddress()" style="background:none;border:none;color:var(--text-tertiary,#888);font-size:0.78em;cursor:pointer;padding:4px 0 0;">&#x29C9; Copy full address</button>'
                + '</div>'
                + '<div style="display:flex;align-items:center;gap:8px;padding:6px 0 14px;">'
                + '  <span style="width:8px;height:8px;border-radius:50%;background:' + statusClr + ';display:inline-block;"></span>'
                + '  <span style="color:' + statusClr + ';font-weight:600;">' + statusLbl + '</span>'
                + (isVerified ? '' :
                    '  <button id="walletPopupVerify" style="margin-left:auto;background:linear-gradient(135deg,#9945FF,#14F195);'
                    + '  border:none;color:#fff;padding:4px 12px;border-radius:6px;font-size:0.8em;font-weight:700;cursor:pointer;">Get Verified</button>')
                + '</div>'
                + '<div style="display:flex;gap:8px;">'
                + '  <button id="walletPopupDisconnect" style="flex:1;background:rgba(255,77,77,0.12);border:1px solid rgba(255,77,77,0.3);color:#ff4d4d;padding:8px;border-radius:8px;font-weight:700;cursor:pointer;font-size:0.85em;">Disconnect</button>'
                + '  <button id="walletPopupDone" style="flex:1;background:var(--bg-tertiary,#111);border:1px solid var(--border,#333);color:var(--text-primary,#fff);padding:8px;border-radius:8px;font-weight:700;cursor:pointer;font-size:0.85em;">Close</button>'
                + '</div>';

            document.body.appendChild(popup);

            document.getElementById('walletPopupClose').onclick      = function() { popup.remove(); };
            document.getElementById('walletPopupDone').onclick       = function() { popup.remove(); };
            document.getElementById('walletPopupDisconnect').onclick = function() { disconnectWallet(); popup.remove(); };
            var verifyBtn = document.getElementById('walletPopupVerify');
            if (verifyBtn) verifyBtn.onclick = function() { handleVerification(); popup.remove(); };

            // Dismiss when clicking outside the popup
            setTimeout(function() {
                function _outsideHandler(e) {
                    var walletBtn = document.getElementById('headerWalletBtn');
                    if (!popup.contains(e.target) && e.target !== walletBtn && !walletBtn.contains(e.target)) {
                        popup.remove();
                        document.removeEventListener('click', _outsideHandler);
                    }
                }
                document.addEventListener('click', _outsideHandler);
            }, 60);
        }

        function disconnectWallet() {
            // Remove account-change listener from current provider
            var provider = _detectProvider(walletProvider);
            if (provider) {
                try { provider.disconnect && provider.disconnect(); } catch(_) {}
                try { provider.removeAllListeners && provider.removeAllListeners('accountChanged'); } catch(_) {}
                try { provider.removeAllListeners && provider.removeAllListeners('disconnect');     } catch(_) {}
            }
            // Clear cache so next connect() re-detects
            _providerCache = {};

            walletConnected = false;
            walletAddress   = '';
            walletProvider  = '';
            isVerified      = false;
            isLoggedIn      = false;
            clearAuth();
            updateWalletButton();
            switchScreen('feed');
            showToast('Wallet disconnected');
        }

        function updateWalletButton() {
            var btn  = document.getElementById('headerWalletBtn');
            var text = document.getElementById('walletBtnText');
            if (!btn) return;

            if (walletConnected && walletAddress) {
                var short = walletAddress.slice(0, 4) + '\u2026' + walletAddress.slice(-4);
                btn.classList.add('connected');
                btn.disabled = false;
                if (isVerified) {
                    btn.innerHTML = '<span class="verified-badge" style="margin-right:5px;">VERIFIED</span>'
                        + '<span>' + short + '</span>';
                } else {
                    if (text) text.textContent = short;
                }
            } else {
                btn.classList.remove('connected');
                btn.disabled = false;
                if (text) text.textContent = 'Connect Wallet';
            }

            // Keep profile card wallet row in sync
            var profileAddr = document.getElementById('profileWalletAddress');
            var profileCopy = document.getElementById('profileWalletCopyBtn');
            if (profileAddr) {
                if (walletConnected && walletAddress) {
                    profileAddr.textContent = walletAddress.slice(0, 8) + '\u2026' + walletAddress.slice(-8);
                    profileAddr.title = walletAddress;
                    if (profileCopy) profileCopy.style.display = 'inline-flex';
                } else {
                    profileAddr.textContent = 'Not connected \u2014 connect wallet to show address';
                    if (profileCopy) profileCopy.style.display = 'none';
                }
            }
        }

        // ── Session persistence ───────────────────────────────────────────
        function saveWalletState() {
            if (walletConnected) {
                localStorage.setItem('wf_walletAddress',  walletAddress);
                localStorage.setItem('wf_walletProvider', walletProvider);
                localStorage.setItem('wf_isVerified',     String(isVerified));
                localStorage.setItem('wf_walletConnected','true');
            }
        }

        function restoreWalletState() {
            // Prefer JWT-backed session (restoreSession() runs at parse time)
            var storedUser = getStoredUser();
            if (storedUser && localStorage.getItem('wf_token')) {
                walletConnected = true;
                isLoggedIn      = true;
                walletAddress   = storedUser.walletAddress || localStorage.getItem('wf_walletAddress') || '';
                walletProvider  = localStorage.getItem('wf_walletProvider') || 'Phantom';
                isVerified      = storedUser.isVerified || false;
                currentUser     = storedUser.username || '';
                updateWalletButton();
                return;
            }
            // Fallback: legacy localStorage keys (demo-mode sessions)
            var saved        = localStorage.getItem('wf_walletAddress') || localStorage.getItem('walletAddress');
            var wasConnected = localStorage.getItem('wf_walletConnected') || localStorage.getItem('walletConnected');
            if (wasConnected === 'true' && saved) {
                walletConnected = true;
                walletAddress   = saved;
                walletProvider  = localStorage.getItem('wf_walletProvider') || localStorage.getItem('walletProvider') || 'Phantom';
                isVerified      = (localStorage.getItem('wf_isVerified') || localStorage.getItem('isVerified')) === 'true';
                isLoggedIn      = true;
                updateWalletButton();
            }
        }

        // ── Verification entry point ──────────────────────────────────────
        function handleVerification() {
            if (!walletConnected) { showToast('Connect your wallet first', 'error'); openWalletModal(); return; }
            if (isVerified)       { showToast('You are already verified! \u2713'); return; }
            openVerificationPaymentModal();
        }

        function openVerificationPaymentModal() {
            document.getElementById('verificationPaymentModal').style.display = 'flex';
            var addrEl = document.getElementById('verificationWalletAddress');
            if (addrEl) addrEl.textContent = walletAddress;

            // Fetch live SOL price to display accurate fee
            api('/verification/price').then(function(d) {
                var solEl  = document.querySelector('.payment-sol');
                var feeEl  = document.querySelector('.payment-amount');
                if (solEl && d.sol) solEl.textContent = '~' + Number(d.sol).toFixed(4) + ' SOL';
                if (feeEl && d.usd) feeEl.textContent = '$' + Number(d.usd).toFixed(2);
            }).catch(function(){});
        }

        function closeVerificationPaymentModal() {
            document.getElementById('verificationPaymentModal').style.display = 'none';
        }

        // ── $5 SOL verification payment ───────────────────────────────────
        // Flow:
        //   1. POST /verification/create-transaction → base64 serialised legacy Transaction
        //   2. Decode to Uint8Array → pass to wallet.signAndSendTransaction()
        //      (wallet signs + broadcasts, returns { signature } base58 txid)
        //   3. POST /verification/verify { transactionSignature, walletAddress }
        //      → backend confirms on-chain, marks user verified
        async function processVerificationPayment() {
            closeVerificationPaymentModal();

            if (!isLoggedIn) {
                showToast('Connect your wallet first', 'error');
                return;
            }

            var provider = await _getProvider(walletProvider);
            if (!provider) {
                showToast('Wallet provider not found \u2014 reconnect your wallet', 'error');
                return;
            }

            showToast('&#x1F4B8; Preparing $5 verification payment\u2026');

            try {
                // ── Step 1: backend builds the serialised Solana transaction ──
                var txData;
                try {
                    txData = await api('/verification/create-transaction', {
                        method: 'POST',
                        body: JSON.stringify({ walletAddress: walletAddress })
                    });
                } catch (txBuildErr) {
                    // Backend offline or PLATFORM_WALLET not configured → demo fallback
                    console.warn('[verification] backend unavailable:', txBuildErr.message);
                    _markVerifiedLocally();
                    showToast('\u2705 Verified (demo mode)! \uD83D\uDE80');
                    return;
                }

                var txSignature;

                if (txData.transaction && provider) {
                    showToast('&#x270D;&#xFE0F; Confirm the transaction in your wallet\u2026');
                    try {
                        // Decode base64 → raw bytes (legacy Transaction format from backend)
                        var txBytes = Uint8Array.from(atob(txData.transaction), function(c) {
                            return c.charCodeAt(0);
                        });

                        var sendResult;
                        if (typeof provider.signAndSendTransaction === 'function') {
                            // Phantom / Solflare: pass raw tx bytes — wallet handles deserialization
                            sendResult = await provider.signAndSendTransaction(txBytes);
                            txSignature = (sendResult && sendResult.signature)
                                ? sendResult.signature
                                : (typeof sendResult === 'string' ? sendResult : null);
                        } else if (typeof provider.signTransaction === 'function') {
                            // Backpack and some adapters: sign only, then we broadcast via backend
                            var signedResult = await provider.signTransaction(txBytes);
                            // signedResult is signed tx bytes or { signature, serialize() }
                            var signedBytes = (signedResult instanceof Uint8Array)
                                ? signedResult
                                : (signedResult.serialize ? signedResult.serialize() : null);
                            if (signedBytes) {
                                // Submit signed tx to backend for broadcast
                                var broadcastData = await api('/verification/broadcast', {
                                    method: 'POST',
                                    body: JSON.stringify({
                                        signedTransaction: btoa(String.fromCharCode.apply(null, signedBytes)),
                                        walletAddress: walletAddress
                                    })
                                });
                                txSignature = broadcastData.signature;
                            } else {
                                txSignature = 'demo_sig_' + Date.now();
                            }
                        } else {
                            // Provider doesn't support transaction signing — demo fallback
                            console.warn('[verification] provider has no signAndSendTransaction/signTransaction');
                            txSignature = 'demo_sig_' + Date.now();
                        }
                    } catch (signTxErr) {
                        if (_isUserRejection(signTxErr)) {
                            showToast('Transaction cancelled', 'error');
                            return;
                        }
                        console.warn('[verification] tx signing failed, falling back to demo sig:', signTxErr.message);
                        txSignature = 'demo_sig_' + Date.now();
                    }
                } else {
                    // No tx returned (backend not fully configured) — use demo sig
                    txSignature = txData.signature || ('demo_sig_' + Date.now());
                }

                // ── Step 3: server confirms on-chain ──────────────────────
                await api('/verification/verify', {
                    method: 'POST',
                    body: JSON.stringify({
                        transactionSignature: txSignature,
                        walletAddress: walletAddress
                    })
                });

                _markVerifiedLocally();
                showToast('\u2705 Verified! You now have the checkmark. \uD83D\uDE80');

            } catch (err) {
                // Final fallback for dev/demo environments
                console.warn('[verification] fallback to demo:', err.message);
                _markVerifiedLocally();
                showToast('\u2705 Verified (demo mode)! \uD83D\uDE80');
            }
        }

        function _markVerifiedLocally() {
            isVerified = true;
            var me = getStoredUser();
            if (me) { me.isVerified = true; localStorage.setItem('wf_user', JSON.stringify(me)); }
            updateWalletButton();
        }



        // Theme toggle function
        function toggleTheme() {
            isDarkMode = !isDarkMode;
            document.body.classList.toggle('light-mode');

            const themeIcon = document.getElementById('themeIcon');
            const themeText = document.getElementById('themeText');

            if (isDarkMode) {
                themeIcon.textContent = '🌙';
                themeText.textContent = 'Dark';
            } else {
                themeIcon.textContent = '☀️';
                themeText.textContent = 'Light';
            }

            // Save preference
            localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
        }

        // Load theme preference on page load
        window.addEventListener('DOMContentLoaded', () => {
            const savedTheme = localStorage.getItem('theme');
            if (savedTheme === 'light') {
                toggleTheme();
            }
            // Sync profile wallet display with current auth state
            updateWalletButton();
        });

        // Topics - Top 20 Cryptos + Categories
        // ══════════════════════════════════════════════════════════
        // TOPICS CONFIGURATION
        // Updated topic list for WhiteFlag platform
        // ══════════════════════════════════════════════════════════
        const TOPICS = [
            { rank: 0,  name: "Trends",        symbol: "🔥", category: true },  // Hot & trending content
            { rank: 0,  name: "General",       symbol: "💬", category: true },  // General discussion
            { rank: 0,  name: "Solana",        symbol: "◎",  category: true },  // Solana ecosystem
            { rank: 0,  name: "Meme Coins",    symbol: "🐕", category: true },  // Meme tokens
            { rank: 0,  name: "Lore",          symbol: "📖", category: true },  // Crypto stories
            { rank: 0,  name: "Utility",       symbol: "⚙️",  category: true },  // Practical use cases
            { rank: 0,  name: "News",          symbol: "📰", category: true }   // Latest updates
        ];

        // Render dropdown on load
        function renderTopicList(filter) {
            const list = document.getElementById('topicList');
            const data = filter
                ? TOPICS.filter(c =>
                    c.name.toLowerCase().includes(filter.toLowerCase()) ||
                    c.symbol.toLowerCase().includes(filter.toLowerCase())
                  )
                : TOPICS;

            list.innerHTML = data.map(c => `
                <div class="topic-option" onclick="selectTopic(${c.rank}, '${c.name}', '${c.symbol}')">
                    ${c.category ? '' : '<span class="topic-rank">#' + c.rank + '</span>'}
                    <span class="topic-name">${c.name}</span>
                    <span class="topic-symbol">${c.symbol}</span>
                </div>
            `).join('');
        }
        renderTopicList();

        function toggleTopicDropdown() {
            const btn  = document.querySelector('.topic-pick-btn');
            const drop = document.getElementById('topicDropdown');
            const isOpen = drop.classList.contains('open');

            drop.classList.toggle('open');
            btn.classList.toggle('open');

            if (!isOpen) {
                document.getElementById('topicSearchInput').value = '';
                renderTopicList();
                setTimeout(() => document.getElementById('topicSearchInput').focus(), 80);
            }
        }

        function filterTopics() {
            renderTopicList(document.getElementById('topicSearchInput').value);
        }

        function selectTopic(rank, name, symbol) {
            selectedTopic = { rank, name, symbol };

            // Update button label
            document.getElementById('selectedTopicLabel').textContent = `${symbol} ${name}`;

            // Show chosen tag
            const tag = document.getElementById('chosenTopicTag');
            tag.querySelector('.post-topic-text').textContent = `${symbol} ${name}`;
            tag.style.display = 'inline-flex';

            // Close dropdown
            document.getElementById('topicDropdown').classList.remove('open');
            document.querySelector('.topic-pick-btn').classList.remove('open');
        }

        function clearTopic() {
            selectedTopic = null;
            document.getElementById('selectedTopicLabel').textContent = 'Select Topic';
            document.getElementById('chosenTopicTag').style.display = 'none';
        }

        // Close dropdown when clicking outside
        document.addEventListener('click', function(e) {
            const wrap = document.querySelector('.topic-selector');
            if (wrap && !wrap.contains(e.target)) {
                document.getElementById('topicDropdown').classList.remove('open');
                document.querySelector('.topic-pick-btn').classList.remove('open');
            }
        }); // Track if user is logged in

        // Chat reply functionality
        let currentReply = null;

        function cancelChatReply() {
            currentReply = null;
            const replyPreview = document.getElementById('chatReplyActive');
            if (replyPreview) {
                replyPreview.style.display = 'none';
            }
        }

        // Vote/Like functionality
        function votePost(button, direction) {
            if (!isLoggedIn) {
                showToast('Connect your wallet to vote', 'error'); return;
                return;
            }

            const voteSection = button.closest('.vote-section');
            const voteCount = voteSection.querySelector('.vote-count');
            let currentCount = parseInt(voteCount.textContent.replace('+', '').replace('K', '000').replace('k', '000'));

            // Toggle vote
            if (direction === 'up') {
                currentCount += 1;
                voteCount.textContent = '+' + currentCount;
                button.style.color = 'var(--primary)';
            } else {
                currentCount -= 1;
                voteCount.textContent = '+' + currentCount;
                button.style.color = 'var(--error)';
            }

            console.log('Vote registered:', direction, currentCount);
        }

        function voteComment(button, direction) {
            if (!isLoggedIn) {
                showToast('Connect your wallet to vote', 'error'); return;
                return;
            }

            const voteSection = button.closest('.comment-votes');
            const voteCount = voteSection.querySelector('.comment-vote-count');
            let currentCount = parseInt(voteCount.textContent.replace('+', ''));

            if (direction === 'up') {
                currentCount += 1;
                button.style.color = 'var(--primary)';
            } else {
                currentCount -= 1;
                button.style.color = 'var(--error)';
            }

            voteCount.textContent = '+' + currentCount;
            console.log('Comment vote:', direction, currentCount);
        }

        // Wallet connection functionality
        // connectWallet (no-arg version unified above)

        function verifyWallet() {
            if (!walletConnected) { openWalletModal(); return; }
            handleVerification();
        }

        // Post deletion
        async function deletePost(button) {
            if (!confirm('Delete this post? This cannot be undone.')) return;
            var postCard = button.closest('.post-card, .profile-post-card');
            var postId = postCard && postCard.dataset.postId;
            postCard.style.transition = 'all 0.3s ease';
            postCard.style.opacity = '0';
            postCard.style.transform = 'translateX(-20px)';
            setTimeout(function() { if (postCard.parentNode) postCard.remove(); }, 300);
            if (postId && isLoggedIn) {
                try {
                    await api('/posts/' + postId, { method: 'DELETE' });
                    showToast('Post deleted');
                    // Remove from cached arrays
                    feedPosts    = feedPosts.filter(function(p){ return String(p.id) !== String(postId); });
                    profilePosts = profilePosts.filter(function(p){ return String(p.id) !== String(postId); });
                } catch(e) {
                    showToast('Could not delete post', 'error');
                }
            } else {
                showToast('Post removed');
            }
        }

        // Comment editing
        function editComment(button) {
            const commentItem = button.closest('.comment-item');
            const commentText = commentItem.querySelector('.comment-text');
            const commentActions = commentItem.querySelector('.comment-actions');

            // Create edit box if it doesn't exist
            let editBox = commentItem.querySelector('.comment-edit-box');
            if (!editBox) {
                editBox = document.createElement('div');
                editBox.className = 'comment-edit-box';
                editBox.innerHTML = `
                    <textarea class="comment-edit-input">${commentText.textContent}</textarea>
                    <div class="comment-edit-actions">
                        <button class="chat-save-btn" onclick="saveCommentEdit(this)">Save</button>
                        <button class="chat-cancel-btn" onclick="cancelCommentEdit(this)">Cancel</button>
                    </div>
                `;
                commentText.parentNode.insertBefore(editBox, commentText.nextSibling);
            }

            commentText.style.display = 'none';
            editBox.style.display = 'block';
            editBox.querySelector('textarea').focus();
        }

        function saveCommentEdit(button) {
            const editBox = button.closest('.comment-edit-box');
            const commentItem = editBox.closest('.comment-item');
            const commentText = commentItem.querySelector('.comment-text');
            const textarea = editBox.querySelector('.comment-edit-input');

            const newText = textarea.value.trim();
            if (!newText) {
                showToast('Comment cannot be empty', 'error');
                return;
            }

            commentText.textContent = newText;
            commentText.style.display = 'block';
            editBox.style.display = 'none';

            showToast('Comment updated &#x270F;&#xFE0F;');
        }

        function cancelCommentEdit(button) {
            const editBox = button.closest('.comment-edit-box');
            const commentItem = editBox.closest('.comment-item');
            const commentText = commentItem.querySelector('.comment-text');

            commentText.style.display = 'block';
            editBox.style.display = 'none';
        }

        // Voice chat interaction
        async function joinVoiceChat(roomId) {
            if (!isLoggedIn) { showToast('Connect your wallet to join voice chats', 'error'); return; }
            showToast('🎙️ Joining voice chat...');
            if (roomId && isLoggedIn) {
                api(`/voice/rooms/${roomId}/join`, { method: 'POST' }).catch(() => {});
            }
        }

        async function leaveVoiceChat() {
            showToast('👋 Left voice chat');
        }

        // Follower/Following lists
        async function showFollowersList() {
            document.getElementById('followersModal').style.display = 'flex';
            var list = document.getElementById('followersList');
            if (!list) return;
            var uid = (_viewingUserId || (getStoredUser() || {}).id);
            if (!uid) return;
            list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-tertiary);">Loading...</div>';
            try {
                var data = await api('/users/' + uid + '/followers');
                var users = (data && data.followers) || [];
                if (!users.length) {
                    list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-tertiary);">No followers yet.</div>';
                    return;
                }
                var titleEl = document.getElementById('followersModalTitle');
                if (titleEl) titleEl.textContent = 'Followers (' + users.length + ')';
                list.innerHTML = users.map(function(u) {
                    var ini  = (u.username || '?')[0].toUpperCase();
                    var vbdg = u.is_verified ? ' <span class="verified-mini">\u2713</span>' : '';
                    var pfp  = u.avatar_url ? ' style="background-image:url(' + u.avatar_url + ');background-size:cover;background-position:center;"' : '';
                    return '<div class="user-list-item" data-username="' + escapeHtml(u.username) + '">'
                        + '<div class="avatar" data-avatar-user="' + escapeHtml(u.username) + '"' + pfp + '>' + (u.avatar_url ? '' : ini) + '</div>'
                        + '<div class="user-list-info">'
                        + '<div class="user-list-name username-link" onclick="goToProfile(\'' + escapeHtml(u.username) + '\')">'
                        + escapeHtml(u.username) + vbdg + '</div>'
                        + '</div>'
                        + '<button class="btn-follow-small" onclick="toggleFollowUser(' + u.id + ', this)">Follow</button>'
                        + '</div>';
                }).join('');
            } catch(e) {
                list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-tertiary);">Could not load followers.</div>';
            }
        }

        function closeFollowersModal() {
            document.getElementById('followersModal').style.display = 'none';
        }

        async function showFollowingList() {
            document.getElementById('followingModal').style.display = 'flex';
            var list = document.getElementById('followingList');
            if (!list) return;
            var uid = (_viewingUserId || (getStoredUser() || {}).id);
            if (!uid) return;
            list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-tertiary);">Loading...</div>';
            try {
                var data = await api('/users/' + uid + '/following');
                var users = (data && data.following) || [];
                if (!users.length) {
                    list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-tertiary);">Not following anyone yet.</div>';
                    return;
                }
                var titleEl2 = document.getElementById('followingModalTitle');
                if (titleEl2) titleEl2.textContent = 'Following (' + users.length + ')';
                list.innerHTML = users.map(function(u) {
                    var ini  = (u.username || '?')[0].toUpperCase();
                    var vbdg = u.is_verified ? ' <span class="verified-mini">\u2713</span>' : '';
                    var pfp  = u.avatar_url ? ' style="background-image:url(' + u.avatar_url + ');background-size:cover;background-position:center;"' : '';
                    return '<div class="user-list-item" data-username="' + escapeHtml(u.username) + '">'
                        + '<div class="avatar" data-avatar-user="' + escapeHtml(u.username) + '"' + pfp + '>' + (u.avatar_url ? '' : ini) + '</div>'
                        + '<div class="user-list-info">'
                        + '<div class="user-list-name username-link" onclick="goToProfile(\'' + escapeHtml(u.username) + '\')">'
                        + escapeHtml(u.username) + vbdg + '</div>'
                        + '</div>'
                        + '<button class="btn-follow-small following" onclick="toggleFollowUser(' + u.id + ', this)">\u2713 Following</button>'
                        + '</div>';
                }).join('');
            } catch(e) {
                list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-tertiary);">Could not load following.</div>';
            }
        }

        function closeFollowingModal() {
            document.getElementById('followingModal').style.display = 'none';
        }

        // Notifications
        // ── Notification engine ────────────────────────────────────────────────

        var _notifPollTimer = null;

        const NOTIF_ICONS = {
            upvote:  '&#x1F44D;',
            comment: '&#x1F4AC;',
            repost:  '&#x1F501;',
            follow:  '&#x1F465;'
        };
        const NOTIF_TEXT = {
            upvote:  'liked your post',
            comment: 'commented on your post',
            repost:  'reposted your post',
            follow:  'started following you'
        };

        function showNotifications() {
            document.getElementById('notificationsPanel').style.display = 'flex';
            loadNotifications();
        }

        function closeNotifications() {
            document.getElementById('notificationsPanel').style.display = 'none';
        }

        async function loadNotifications() {
            var list = document.getElementById('notifList');
            if (!list) return;
            if (!isLoggedIn) {
                list.innerHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:40px;">'
                    + '<div style="font-size:2em;margin-bottom:8px;">&#x1F514;</div>'
                    + '<div>Connect your wallet to see notifications.</div></div>';
                return;
            }
            try {
                var data = await api('/notifications');
                var notifs = (data && data.notifications) || [];
                if (!notifs.length) {
                    list.innerHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:40px;">'
                        + '<div style="font-size:2em;margin-bottom:8px;">&#x2705;</div>'
                        + '<div>All caught up!</div></div>';
                    return;
                }
                list.innerHTML = notifs.map(function(n) {
                    var icon  = NOTIF_ICONS[n.type] || '&#x1F514;';
                    var label = NOTIF_TEXT[n.type]  || n.type;
                    var unreadCls = n.is_read ? '' : ' unread';
                    var preview = '';
                    if ((n.type === 'upvote' || n.type === 'comment' || n.type === 'repost') && (n.post_title || n.post_content)) {
                        var snip = (n.post_title || n.post_content || '').substring(0, 50);
                        preview = '<div class="notif-preview">&ldquo;' + escapeHtml(snip) + (snip.length >= 50 ? '&hellip;' : '') + '&rdquo;</div>';
                    }
                    return '<div class="notification-item' + unreadCls + '" data-notif-id="' + n.id + '" onclick="markNotifRead(' + n.id + ', this)">'
                        + '<div class="notif-icon">' + icon + '</div>'
                        + '<div class="notif-content">'
                        + '<div class="notif-text">'
                        + '<span class="username-link" data-profile-user="' + escapeHtml(n.actor_username || '') + '">'
                        + escapeHtml(n.actor_username || 'Someone')
                        + (n.actor_verified ? ' <span style="color:var(--primary);">&#x2713;</span>' : '')
                        + '</span> ' + label
                        + '</div>'
                        + preview
                        + '<div class="notif-time">' + _timeAgo(n.created_at) + '</div>'
                        + '</div>'
                        + '</div>';
                }).join('');
                // Mark all as read in background
                api('/notifications/mark-all-read', { method: 'PUT' }).catch(function(){});
                // Reset badge
                refreshNotifBadge();
            } catch(e) {
                list.innerHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:40px;">Could not load notifications.</div>';
            }
        }

        function markNotifRead(id, el) {
            if (el) el.classList.remove('unread');
            api('/notifications/' + id + '/read', { method: 'PUT' }).catch(function(){});
        }

        async function markAllNotifsRead() {
            document.querySelectorAll('#notifList .notification-item.unread').forEach(function(el) {
                el.classList.remove('unread');
            });
            try { await api('/notifications/mark-all-read', { method: 'PUT' }); } catch(e) {}
            refreshNotifBadge();
        }

        async function refreshNotifBadge() {
            var badge = document.getElementById('notifBadge');
            if (!badge || !isLoggedIn) return;
            try {
                var data = await api('/notifications/unread-count');
                var count = (data && data.count) || 0;
                if (count > 0) {
                    badge.textContent = count > 99 ? '99+' : count;
                    badge.style.display = 'flex';
                } else {
                    badge.style.display = 'none';
                }
            } catch(e) {
                badge.style.display = 'none';
            }
        }

        function startNotifPolling() {
            if (_notifPollTimer) clearInterval(_notifPollTimer);
            refreshNotifBadge();
            _notifPollTimer = setInterval(refreshNotifBadge, 30000); // every 30s
        }

        // Messages
        // Post Sharing Function
        function sharePost(button) {
            var postCard = button.closest('.post-card, .profile-post-card');
            var postId   = postCard && postCard.dataset.postId;
            var content  = postCard && (postCard.querySelector('.post-text, .profile-post-text') || {}).textContent || '';
            var postUrl  = 'https://whiteflag.app/post/' + (postId || Math.random().toString(36).substring(7));

            // Use Web Share API if available (mobile), else copy link
            if (navigator.share) {
                navigator.share({ title: 'WhiteFlag Post', text: content.substring(0,120), url: postUrl }).catch(function(){});
            } else {
                var cb = navigator.clipboard;
                if (cb) {
                    cb.writeText(postUrl).then(function() { showToast('&#x1F517; Link copied!'); });
                } else {
                    fallbackCopy(postUrl);
                }
            }
        }

        // Comment Deletion Function
        async function deleteComment(button) {
            if (!confirm('Delete this comment? This cannot be undone.')) return;
            var commentEl = button.closest('.post-comment, .comment-item, .reply-item');
            var commentId = commentEl && commentEl.dataset.commentId;
            var postEl    = commentEl && commentEl.closest('[data-post-id]');
            var postId    = postEl && postEl.dataset.postId;
            commentEl.style.transition = 'opacity 0.3s, transform 0.3s';
            commentEl.style.opacity = '0';
            commentEl.style.transform = 'translateX(-20px)';
            setTimeout(function() { if (commentEl.parentNode) commentEl.remove(); }, 300);
            if (commentId && postId && isLoggedIn) {
                api('/posts/' + postId + '/comments/' + commentId, { method: 'DELETE' })
                    .then(function() { showToast('Comment deleted'); })
                    .catch(function() { showToast('Could not delete comment', 'error'); });
            } else {
                showToast('Comment removed');
            }
        }

        // User Profile View Function
        function viewUserProfile(username) {
            // Navigate to profile screen and load that user's info
            switchScreen('profile');
            const nameEl = document.querySelector('.profile-name');
            if (nameEl && username) nameEl.childNodes[0].textContent = '@' + username + ' ';
        }

        // Messages Functions
        let currentConversationUser = '';

        // Sample users database for search
        const availableUsers = [
            { username: 'AlphaGrinder', verified: true, followers: 2341, posts: 892 },
            { username: 'MoonChaser', verified: true, followers: 1823, posts: 456 },
            { username: 'DeFiMaster', verified: true, followers: 3421, posts: 1234 },
            { username: 'CryptoNinja', verified: true, followers: 4521, posts: 2103 },
            { username: 'SolanaKing', verified: true, followers: 5234, posts: 3421 },
            { username: 'ETHMaxi', verified: true, followers: 1234, posts: 567 },
            { username: 'NFTCollector', verified: true, followers: 987, posts: 234 },
            { username: 'DeFiDegen', verified: false, followers: 456, posts: 123 },
            { username: 'CryptoWhale', verified: true, followers: 8901, posts: 4567 },
            { username: 'BlockchainDev', verified: true, followers: 2345, posts: 890 },
            { username: 'TokenTrader', verified: false, followers: 789, posts: 345 },
            { username: 'Web3Builder', verified: true, followers: 3456, posts: 1789 },
            { username: 'DAOVoter', verified: false, followers: 567, posts: 234 },
            { username: 'YieldFarmer', verified: true, followers: 2890, posts: 1234 },
            { username: 'SmartContractAuditor', verified: true, followers: 4123, posts: 2345 }
        ];

        // New Messages Search Functions
        function focusMessageSearch() {
            const searchArea = document.getElementById('messageSearchInputArea');
            const searchField = document.getElementById('messageSearchField');
            searchArea.style.display = 'block';
            searchField.focus();
        }

        function closeMessageSearch() {
            const searchArea = document.getElementById('messageSearchInputArea');
            const searchField = document.getElementById('messageSearchField');
            const resultsArea = document.getElementById('searchLiveResults');

            searchArea.style.display = 'none';
            searchField.value = '';
            resultsArea.innerHTML = '<div class="search-hint">Try searching: "crypto", "alpha", "defi", "moon"</div>';
        }

        // ── DM user search: queries real API, falls back to mock list ───────────
        let _dmSearchTimer = null;
        function searchUsersInMessages(query) {
            const resultsArea = document.getElementById('searchLiveResults');

            if (!query || !query.trim()) {
                resultsArea.innerHTML = '<div class="search-hint">Start typing a username to search</div>';
                return;
            }

            // Debounce — wait 300ms before firing
            clearTimeout(_dmSearchTimer);
            resultsArea.innerHTML = '<div class="search-hint">Searching...</div>';
            _dmSearchTimer = setTimeout(async function() {
                try {
                    const data = await api('/users/search?q=' + encodeURIComponent(query.trim()) + '&limit=8');
                    const users = (data && data.users) || [];
                    if (!users.length) {
                        resultsArea.innerHTML = '<div class="search-hint">No users found for "' + escapeHtml(query.trim()) + '"</div>';
                    } else {
                        renderDMSearchResults(users, resultsArea);
                    }
                } catch (e) {
                    resultsArea.innerHTML = '<div class="search-hint">Search unavailable — check connection</div>';
                }
            }, 300);
        }

        function renderDMSearchResults(users, resultsArea) {
            if (!users.length) {
                resultsArea.innerHTML = '<div class="search-hint">No users found</div>';
                return;
            }
            resultsArea.innerHTML = users.map(function(u) {
                const initial   = (u.username || '?')[0].toUpperCase();
                const verified  = u.is_verified ? ' <span class="verified-badge">✓</span>' : '';
                const followers = (u.followers_count || 0).toLocaleString();
                const posts     = (u.posts_count    || 0).toLocaleString();
                // Use data-dm-user to avoid onclick quote escaping issues
                return '<div class="search-user-result" data-dm-user="' + escapeHtml(u.username) + '" data-dm-uid="' + (u.id || '') + '">'
                     + '<div class="search-user-avatar">' + initial + '</div>'
                     + '<div class="search-user-info">'
                     + '<div class="search-user-name"><span class="search-username">' + escapeHtml(u.username) + '</span>' + verified + '</div>'
                     + '<div class="search-user-stats">' + followers + ' followers • ' + posts + ' posts</div>'
                     + '</div></div>';
            }).join('');
        }

        function startConversationWithUser(username) {
            // Close search
            closeMessageSearch();

            // Open conversation
            openConversation(username);
        }

        // ── Open a DM conversation and load message history from API ────────────
        // username: display name; userId: numeric DB id (null when only username known)
        let currentConversationUserId = null;  // numeric id for API calls

        async function openConversation(username, userId) {
            currentConversationUser   = username;
            currentConversationUserId = userId || null;

            // Update header
            document.getElementById('convUsername').textContent = username;
            document.getElementById('convAvatar').textContent = (username || '?')[0].toUpperCase();
            switchScreen('conversation');

            const messagesDiv = document.getElementById('conversationMessages');

            // Show loading placeholder
            messagesDiv.innerHTML = '<div style="text-align:center;color:var(--text-secondary);padding:40px 20px;">Loading messages...</div>';

            // Try to fetch real message history when we have a numeric userId
            if (isLoggedIn && currentConversationUserId) {
                try {
                    const data = await api('/messages/conversation/' + currentConversationUserId);
                    if (data && data.messages) {
                        renderConversationMessages(data.messages, data.otherUser);
                        // Store numeric id returned by server (in case we only had username before)
                        if (data.otherUser && data.otherUser.id) currentConversationUserId = data.otherUser.id;
                        return;
                    }
                } catch (e) {
                    // Fall through to placeholder
                }
            }

            // Fallback: show the static demo messages already in HTML (reset innerHTML)
            messagesDiv.innerHTML = [
                '<div class="message-bubble received"><div class="message-content">Hey! Want to join the voice chat?</div><div class="message-time">2:30 PM</div></div>',
                '<div class="message-bubble sent"><div class="message-content">Sure! Give me 5 minutes</div><div class="message-time">2:31 PM</div></div>',
                '<div class="message-bubble received"><div class="message-content">Sounds good! See you there</div><div class="message-time">2:32 PM</div></div>'
            ].join('');
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }

        // Render an array of message objects returned by GET /messages/conversation/:id
        function renderConversationMessages(messages, otherUser) {
            const messagesDiv = document.getElementById('conversationMessages');
            const myId = (getStoredUser ? getStoredUser() : null)?.id || null;
            if (!messages.length) {
                messagesDiv.innerHTML = '<div style="text-align:center;color:var(--text-secondary);padding:40px 20px;">No messages yet. Say hi!</div>';
                return;
            }
            messagesDiv.innerHTML = messages.map(function(m) {
                const isMine  = myId ? (m.user_id === myId) : false;
                const cls     = isMine ? 'sent' : 'received';
                const time    = new Date(m.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                return '<div class="message-bubble ' + cls + '">'
                     + '<div class="message-content">' + escapeHtml(m.content) + '</div>'
                     + '<div class="message-time">' + time + '</div>'
                     + '</div>';
            }).join('');
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }

        async function sendDirectMessage() {
            const input = document.getElementById('messageInput');
            const messageText = input?.value?.trim();
            if (!messageText) return;
            if (!isLoggedIn) { showToast('Connect your wallet to message', 'error'); return; }

            const messagesDiv = document.getElementById('conversationMessages');
            const now = new Date();
            const timeString = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
            const messageBubble = document.createElement('div');
            messageBubble.className = 'message-bubble sent';
            messageBubble.innerHTML = `<div class="message-content">${escapeHtml(messageText)}</div><div class="message-time">${timeString}</div>`;
            if (messagesDiv) { messagesDiv.appendChild(messageBubble); messagesDiv.scrollTop = messagesDiv.scrollHeight; }
            input.value = '';

            // API call — send to numeric userId (or username as fallback)
            const recipientId = currentConversationUserId || currentConversationUser;
            if (recipientId) {
                api('/messages/send', {
                    method: 'POST',
                    body: JSON.stringify({ recipientId: recipientId, content: messageText })
                }).catch(() => {});
            }
        }

        // ── Load conversation list from API → renders message thread cards ──────
        async function loadConversationsList() {
            const list = document.getElementById('messageThreadsList');
            if (!list) return;
            try {
                const data = await api('/messages/conversations');
                const convs = (data && data.conversations) || [];
                if (!convs.length) {
                    list.innerHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:40px;"><div style="font-size:2em;margin-bottom:8px;">\u1F4AC</div><div>No conversations yet</div><div style="font-size:0.85em;margin-top:8px;opacity:0.7;">Find someone to message using the search above</div></div>';
                    return;
                }

                list.innerHTML = convs.map(function(c) {
                    const name     = escapeHtml(c.other_user_name || 'Unknown');
                    const initial  = (c.other_user_name || '?')[0].toUpperCase();
                    const preview  = escapeHtml((c.last_message || '').substring(0, 60));
                    const verified = c.other_user_verified
                        ? ' <span class="verified-badge">✓</span>' : '';
                    const unread   = parseInt(c.unread_count) || 0;
                    const badge    = unread > 0
                        ? '<div class="thread-unread-badge">' + unread + '</div>' : '';
                    const ts       = c.last_message_at
                        ? _relativeTime(c.last_message_at) : '';
                    // Use data-dm-user so delegated handler opens the conversation
                    return '<div class="message-thread-card" data-dm-user="' + name + '" data-dm-uid="' + c.other_user_id + '">'
                         + '<div class="thread-avatar">' + initial + '</div>'
                         + '<div class="thread-info">'
                         + '<div class="thread-header-row">'
                         + '<div class="thread-name"><span class="thread-username">' + name + '</span>' + verified + '</div>'
                         + '<div class="thread-timestamp">' + ts + '</div>'
                         + '</div>'
                         + '<div class="thread-preview-text">' + preview + '</div>'
                         + '</div>'
                         + badge
                         + '</div>';
                }).join('');

                // Update conversation count badge
                const countEl = document.querySelector('.conversation-count');
                if (countEl) countEl.textContent = convs.length + ' active';
            } catch (e) {
                if (list) list.innerHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:30px;">Could not load conversations</div>';
            }
        }

        // ── Refresh unread message count badge in nav ─────────────────────────
        async function refreshUnreadCount() {
            try {
                const data = await api('/messages/unread-count');
                const count = (data && data.unreadCount) || 0;
                // Show/hide notification dot on messages nav button
                const msgBtn = document.querySelector('.header-icon-btn[onclick*="messages"]');
                if (msgBtn) {
                    let dot = msgBtn.querySelector('.unread-dot');
                    if (count > 0) {
                        if (!dot) {
                            dot = document.createElement('span');
                            dot.className = 'unread-dot';
                            dot.style.cssText = 'position:absolute;top:4px;right:4px;width:8px;height:8px;background:var(--accent);border-radius:50%;';
                            msgBtn.style.position = 'relative';
                            msgBtn.appendChild(dot);
                        }
                        dot.style.display = 'block';
                    } else if (dot) {
                        dot.style.display = 'none';
                    }
                }
            } catch (e) { /* silent — unread badge is cosmetic */ }
        }

        // Helper: convert ISO timestamp to relative time string ("2m ago", "3h ago")
        function _relativeTime(iso) {
            const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
            if (diff < 60)   return diff + 's ago';
            if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
            if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
            return Math.floor(diff / 86400) + 'd ago';
        }

        // Auto-resize textarea
        document.addEventListener('DOMContentLoaded', function() {
            const textarea = document.getElementById('messageInput');
            if (textarea) {
                textarea.addEventListener('input', function() {
                    this.style.height = 'auto';
                    this.style.height = (this.scrollHeight) + 'px';
                });

                // Send on Enter (Shift+Enter for new line)
                textarea.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        sendDirectMessage();
                    }
                });
            }
        });

        // Moderation tools
        function blockUser() {
            hidePostOptions();
            if (confirm('Block this user?\n\nYou won\'t see their posts or comments.')) {
                showToast('🚫 User blocked');
            }
        }

        function muteUser() {
            hidePostOptions();
            if (confirm('Mute this user?\n\nYou\'ll stop seeing their posts in your feed.')) {
                showToast('🔇 User muted');
            }
        }

        function hidePost() {
            hidePostOptions();
            showToast('👁️ Post hidden from your feed');
        }

        function showPostOptions(button, event) {
            event.stopPropagation();
            const menu = document.getElementById('postOptionsMenu');
            const rect = button.getBoundingClientRect();

            menu.style.display = 'block';
            menu.style.top = (rect.bottom + 5) + 'px';
            menu.style.left = (rect.left - 150) + 'px';

            // Close menu when clicking outside
            setTimeout(() => {
                document.addEventListener('click', hidePostOptions, { once: true });
            }, 10);
        }

        function hidePostOptions() {
            document.getElementById('postOptionsMenu').style.display = 'none';
        }

        // Media upload with preview
        // uploadImage defined below

        // uploadVideo defined below

        function clearMedia() {
            document.getElementById('mediaPreview').style.display = 'none';
            document.getElementById('mediaPreview').innerHTML = '';
            currentMedia = null;
            currentMediaType = null;
        }

        // Referral System Functions
        function copyReferralLink() {
            const input = document.getElementById('referralLinkInput');
            input.select();
            input.setSelectionRange(0, 99999); // For mobile devices

            // Copy to clipboard
            navigator.clipboard.writeText(input.value).then(() => {
                // Update button to show success
                const copyIcon = document.getElementById('copyIcon');
                const copyText = document.getElementById('copyText');

                copyIcon.textContent = '✓';
                copyText.textContent = 'Copied!';

                // Reset after 2 seconds
                setTimeout(() => {
                    copyIcon.textContent = '📋';
                    copyText.textContent = 'Copy';
                }, 2000);
            }).catch(err => {
                showToast('Copy failed — try manually', 'error');
            });
        }

        function shareOnTwitter() {
            const referralLink = document.getElementById('referralLinkInput').value;
            const text = encodeURIComponent('Join me on WhiteFlag! Earn crypto rewards by engaging with the community. 🚀');
            const url = encodeURIComponent(referralLink);
            window.open(`https://twitter.com/intent/tweet?text=${text}&url=${url}`, '_blank');
        }

        function shareOnTelegram() {
            const referralLink = document.getElementById('referralLinkInput').value;
            const text = encodeURIComponent('Join me on WhiteFlag! Earn crypto rewards by engaging with the community. 🚀 ' + referralLink);
            window.open(`https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${text}`, '_blank');
        }

        function shareOnDiscord() {
            var referralLink = document.getElementById('referralLinkInput') ? document.getElementById('referralLinkInput').value : '';
            if (navigator.clipboard) {
                navigator.clipboard.writeText(referralLink).then(function() {
                    showToast('&#x1F3AE; Link copied — paste it in Discord!');
                });
            } else {
                fallbackCopy(referralLink);
            }
        }

        // Claim Earnings Functions
        let claimSource = '';
        let claimAmount = 0;
        let walletConnectedForClaim = false;
        let connectedWalletAddress = '';

        function claimReferralEarnings() {
            claimSource = 'referral';
            claimAmount = 24.00;
            openClaimModal('Referral Earnings', claimAmount);
        }

        function claimCreatorEarnings() {
            claimSource = 'creator';
            claimAmount = 247.50;
            openClaimModal('Creator Earnings', claimAmount);
        }

        function openClaimModal(source, amount) {
            // Calculate SOL amount (example rate: $100 = 1 SOL)
            const solAmount = (amount / 100).toFixed(3);

            document.getElementById('claimModal').style.display = 'flex';
            document.getElementById('claimSourceLabel').textContent = source;
            document.getElementById('claimAmountDisplay').textContent = '$' + amount.toFixed(2);
            document.getElementById('claimSolAmount').textContent = '~' + solAmount + ' SOL';
            document.getElementById('breakdownAmount').textContent = '$' + amount.toFixed(2);
            document.getElementById('breakdownFee').textContent = '~$0.01';
            document.getElementById('breakdownTotal').textContent = '$' + (amount - 0.01).toFixed(2);

            // Reset wallet connection state
            walletConnectedForClaim = false;
            document.getElementById('connectWalletClaimBtn').style.display = 'flex';
            document.getElementById('connectedWalletInfo').style.display = 'none';
            document.getElementById('claimNowBtn').disabled = true;
        }

        function closeClaimModal() {
            document.getElementById('claimModal').style.display = 'none';
            walletConnectedForClaim = false;
            connectedWalletAddress = '';
        }

        function connectWalletForClaim() {
            // Simulate wallet connection
            showToast('Connecting to Solana wallet...');

            // Simulate successful connection
            setTimeout(() => {
                walletConnectedForClaim = true;
                // Generate fake Solana address (44 characters)
                connectedWalletAddress = Array.from({length: 44}, () =>
                    'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789'[Math.floor(Math.random() * 58)]
                ).join('');

                // Update UI
                document.getElementById('connectWalletClaimBtn').style.display = 'none';
                document.getElementById('connectedWalletInfo').style.display = 'block';
                document.getElementById('connectedWalletAddress').textContent = connectedWalletAddress;
                document.getElementById('claimNowBtn').disabled = false;

                // Update wallet status
                document.querySelector('.wallet-status-icon').textContent = '✓';
                document.querySelector('.wallet-status-label').textContent = 'Wallet Connected';
                document.querySelector('.wallet-status-desc').textContent = 'Ready to claim earnings';

                showToast('&#x2705; Wallet connected — ready to claim!');
            }, 1500);
        }

        function processClaim() {
            if (!walletConnectedForClaim) {
                showToast('Please connect your wallet first', 'error');
                return;
            }
            closeClaimModal();
            showToast(`💸 Processing claim of $${claimAmount.toFixed(2)}...`);
            // In production: create Solana transaction, request wallet signature
            setTimeout(() => {
                showToast(`✅ $${claimAmount.toFixed(2)} claimed successfully!`);
            }, 2000);
        }

        function requestSpeaker() {
            if (!isLoggedIn) { showToast('Connect your wallet first', 'error'); return; }
            showToast('✋ Speaker request sent — waiting for host approval');
        }

        // Chat reply functions
        function showReplyPreview(username, messageText) {
            const replyPreview = document.getElementById('chatReplyActive');
            if (replyPreview) {
                // Update the preview content
                const usernameSpan = replyPreview.querySelector('.reply-active-username');
                const textDiv = replyPreview.querySelector('.reply-active-text');

                if (usernameSpan) usernameSpan.textContent = username;
                if (textDiv) textDiv.textContent = messageText;

                // Show the preview
                replyPreview.style.display = 'flex';

                // Focus the input
                const input = document.querySelector('.chat-input-compact');
                if (input) input.focus();

                console.log('Replying to:', username, messageText);
            }
        }

        // Sort posts function for Feed, Following, and Profile
        function sortPosts(section, sortType) {
            var sb = event.target.closest('.posts-sort-buttons');
            if (sb) {
                sb.querySelectorAll('.post-sort-btn').forEach(function(b){ b.classList.remove('active'); });
                event.target.closest('.post-sort-btn').classList.add('active');
            }
            if (section === 'feed'      && feedPosts.length)
                renderPostsInto('feedPostsGrid',      feedPosts,      sortType, { showAuthor: true  });
            if (section === 'following' && followingPosts.length)
                renderPostsInto('followingPostsGrid', followingPosts, sortType, { showAuthor: true  });
            if (section === 'profile'   && profilePosts.length)
                renderPostsInto('profilePostsGrid',   profilePosts,   sortType, { showAuthor: false });
        }

        function toggleUpvote(btn) {
            const wasActive = btn.classList.contains('active');
            btn.classList.toggle('active');
            const countEl = btn.querySelector('.upvote-count');
            if (countEl) {
                let n = parseInt(countEl.textContent) || 0;
                countEl.textContent = wasActive ? Math.max(0, n - 1) : n + 1;
            } else {
                const match = btn.textContent.match(/\d+/);
                if (match) {
                    let n = parseInt(match[0]);
                    n = wasActive ? Math.max(0, n - 1) : n + 1;
                    btn.textContent = '▲ ' + n;
                }
            }
            // API call (fire-and-forget with rollback on error)
            const postCard = btn.closest('[data-post-id]');
            const commentEl = btn.closest('[data-comment-id]');
            const postId = postCard?.dataset?.postId;
            const commentId = commentEl?.dataset?.commentId;
            if (postId && !commentId && isLoggedIn) {
                api(`/posts/${postId}/upvote`, { method: 'POST' }).catch(() => {
                    // Rollback optimistic update
                    btn.classList.toggle('active');
                    const el = btn.querySelector('.upvote-count');
                    if (el) el.textContent = wasActive ? parseInt(el.textContent)+1 : Math.max(0,parseInt(el.textContent)-1);
                });
            }
            if (postId && commentId && isLoggedIn) {
                api(`/posts/${postId}/comments/${commentId}/upvote`, { method: 'POST' }).catch(() => {});
            }
        }

        function toggleComments(idOrElement) {
            // Supports both: toggleComments('feedPost1') and toggleComments(element)
            let section;
            if (typeof idOrElement === 'string') {
                section = document.getElementById(idOrElement);
            } else {
                const postCard = idOrElement.closest('.post-card, .profile-post-card');
                section = postCard && (postCard.querySelector('.post-comments-section') || postCard.querySelector('.comments-section'));
            }
            if (!section) return;
            const isHidden = section.style.display === 'none' || section.style.display === '';
            section.style.display = isHidden ? 'flex' : 'none';
            if (isHidden) section.style.flexDirection = 'column';
        }

        // ─── DYNAMIC REPLY SYSTEM ───────────────────────────────────────────────
        // Supports: reply-to-comment (Level 1) and reply-to-reply (Level 2+)
        // All reply boxes are created dynamically; no hardcoded IDs needed.

        // Seed data for the demo post
        const postCommentData = {
            feedPost1: {
                comments: [
                    {
                        id: 'c1', author: 'MoonChaser', avatar: 'M', verified: true,
                        time: '2h ago', text: 'Congrats! I\'m at 87 hours, closing in on you 👀',
                        votes: 18,
                        replies: [
                            {
                                id: 'c1r1', author: 'JohnDoe_Crypto', avatar: 'J', verified: true,
                                time: '1h ago', replyingTo: 'MoonChaser',
                                replyingToText: 'Congrats! I\'m at 87 hours...',
                                text: 'Let\'s gooo! May the best grinder win 🔥', votes: 7,
                                replies: []
                            }
                        ]
                    },
                    {
                        id: 'c2', author: 'DeFiMaster', avatar: 'D', verified: true,
                        time: '1h ago', text: 'This is the way. Consistency is key 💎',
                        votes: 11, replies: []
                    }
                ]
            }
        };

        // Render a single comment + its replies recursively
        function renderComment(comment, postId, isNested = false) {
            const replyItems = (comment.replies || []).map(r => renderComment(r, postId, true)).join('');
            const quoteHtml = comment.replyingTo ? `
                <div class="comment-reply-quote">
                    <span class="quote-icon">↩</span>
                    <span class="quote-user">${comment.replyingTo}:</span>
                    <span class="quote-text">${comment.replyingToText || ''}</span>
                </div>` : '';
            const nestClass = isNested ? 'comment-nested' : '';
            const avatarClass = isNested ? 'small' : '';
            const preview = (comment.text || '').substring(0, 40).replace(/"/g, '&quot;');
            return `
                <div class="post-comment ${nestClass}"
                     data-comment-id="${comment.id}"
                     data-comment-author="${comment.author}"
                     data-comment-preview="${preview}"
                     data-post-id="${postId}"
                     data-is-nested="${isNested}">
                    <div class="comment-avatar ${avatarClass}" data-avatar-user="${comment.author}">${USER_AVATARS[comment.author] ? '' : comment.avatar}</div>
                    <div class="comment-body">
                        <div class="comment-header">
                            <span class="comment-username">${comment.author}</span>
                            ${comment.verified ? '<span class="verified-mini">✓</span>' : ''}
                            <span class="comment-time">${comment.time}</span>
                        </div>
                        ${quoteHtml}
                        <div class="comment-text">${comment.text || ''}</div>
                        ${comment.gifUrl ? `<img class="comment-gif" src="${comment.gifUrl}" alt="GIF" loading="lazy" />` : ''}
                        <div class="comment-actions">
                            <button class="comment-upvote-btn" onclick="toggleUpvote(this)">▲ <span class="upvote-count">${comment.votes}</span></button>
                            <button class="comment-reply-btn" onclick="openReplyBox(this)">↩ Reply</button>
                        </div>
                    </div>
                </div>
                ${replyItems}`;
        }

        // Render all comments for a post section
        function renderPostComments(postId) {
            const section = document.getElementById(postId);
            if (!section) return;
            const data = postCommentData[postId];
            if (!data) return;

            const commentsHtml = (data.comments || []).map(c => renderComment(c, postId, false)).join('');

            section.innerHTML = commentsHtml + `
                <!-- New comment input -->
                <div class="post-new-comment-box">
                    <div class="reply-input-avatar">J</div>
                    <div style="flex:1; display:flex; flex-direction:column; gap:0;">
                        <div style="display:flex; gap:6px; align-items:center;">
                            <input class="reply-input-field" id="newComment_${postId}" placeholder="Add a comment..." onkeydown="if(event.key==='Enter')submitNewComment('${postId}')" style="flex:1;" />
                            <button class="reply-gif-btn" onclick="openGifPicker('comment:${postId}')" title="Add GIF">GIF</button>
                            <button class="reply-input-send" onclick="submitNewComment('${postId}')" title="Post comment">↑</button>
                        </div>
                        <img class="reply-gif-preview" id="gifPreview_comment:${postId}" onclick="clearCommentGif('comment:${postId}')" title="Click to remove" />
                    </div>
                </div>`;
        }

        // Opens a reply box right under the clicked comment/reply
        // Reads context from data-attributes on the parent .post-comment element
        function openReplyBox(btn) {
            const commentEl = btn.closest('.post-comment');
            if (!commentEl) return;
            const commentId      = commentEl.dataset.commentId;
            const authorName     = commentEl.dataset.commentAuthor;
            const previewText    = commentEl.dataset.commentPreview;
            const postId         = commentEl.dataset.postId;
            const isReplyToReply = commentEl.dataset.isNested === 'true';
            if (!commentId || !postId) return;

            // Remove any existing open reply boxes
            document.querySelectorAll('.post-reply-input-box').forEach(el => el.remove());

            const commentBody = commentEl.querySelector('.comment-body');

            // Badge shows whether this is a reply to a comment or a reply to a reply
            const badgeClass  = isReplyToReply ? 'badge-reply' : 'badge-comment';
            const badgeLabel  = isReplyToReply ? '↩ Reply to reply' : '💬 Reply to comment';

            const box = document.createElement('div');
            box.className = 'post-reply-input-box';
            box.dataset.replyingToId = commentId;
            box.dataset.replyingToAuthor = authorName;
            box.dataset.replyingToText = previewText;
            box.dataset.postId = postId;
            box.dataset.isReplyToReply = isReplyToReply ? 'true' : 'false';
            box.style.display = 'flex';
            box.innerHTML = `
                <div class="reply-input-quote">
                    <span class="reply-type-badge ${badgeClass}">${badgeLabel}</span>
                    <span class="quote-user" style="flex:1; font-size:0.85em; color:var(--primary);">@${authorName}</span>
                    <span class="quote-text" style="font-size:0.8em; color:var(--text-secondary); max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${previewText}</span>
                    <button class="reply-input-cancel" onclick="this.closest('.post-reply-input-box').remove()" title="Cancel">✕</button>
                </div>
                <div class="reply-input-row">
                    <div class="reply-input-avatar">J</div>
                    <div style="flex:1; display:flex; flex-direction:column; gap:0;">
                        <div style="display:flex; gap:6px; align-items:center;">
                            <input class="reply-input-field" placeholder="Write a reply to @${authorName}..."
                                   onkeydown="if(event.key==='Enter')sendDynamicReply(this)" style="flex:1;" />
                            <button class="reply-gif-btn" onclick="openGifPicker('reply:${commentId}')" title="Add GIF">GIF</button>
                            <button class="reply-input-send" onclick="sendDynamicReply(this.closest('.reply-input-row').querySelector('.reply-input-field'))" title="Send reply">↑</button>
                        </div>
                        <img class="reply-gif-preview" id="gifPreview_reply:${commentId}" onclick="clearCommentGif('reply:${commentId}')" title="Click to remove" />
                    </div>
                </div>`;

            // Insert the box after the comment-body inside the comment
            commentBody.appendChild(box);
            box.querySelector('.reply-input-field').focus();
        }

        // Sends a reply, updates the data, and re-renders
        function sendDynamicReply(inputEl) {
            if (!isLoggedIn) { showToast('Connect your wallet to reply!', 'error'); return; }
            const box = inputEl.closest('.post-reply-input-box');
            const text = inputEl.value.trim();
            const replyingToId     = box.dataset.replyingToId;
            const replyingToAuthor = box.dataset.replyingToAuthor;
            const replyingToText   = box.dataset.replyingToText;
            const postId           = box.dataset.postId;

            // Grab GIF if one was selected for this reply
            const gifKey = `reply:${replyingToId}`;
            const gifPreview = document.getElementById(`gifPreview_${gifKey}`);
            const gifUrl = (gifPreview && gifPreview.classList.contains('active')) ? gifPreview.src : null;

            if (!text && !gifUrl) { inputEl.focus(); return; }

            const storedUser = getStoredUser();
            const myName   = storedUser?.username || 'You';
            const myAvatar = myName[0].toUpperCase();

            const newReply = {
                id: 'r_' + Date.now(), author: myName, avatar: myAvatar,
                verified: storedUser?.isVerified || false,
                time: 'Just now', replyingTo: replyingToAuthor, replyingToText: replyingToText,
                text: text, gifUrl: gifUrl || null, votes: 0, replies: []
            };

            function insertReply(comments) {
                for (const c of comments) {
                    if (c.id === replyingToId) { c.replies.push(newReply); return true; }
                    if (insertReply(c.replies || [])) return true;
                }
                return false;
            }
            if (postCommentData[postId]) insertReply(postCommentData[postId].comments);

            // Clear GIF state before re-render
            gifPickerState.pendingGifs[gifKey] = null;
            renderPostComments(postId);

            if (isLoggedIn && postId) {
                const numericPostId = postId.replace(/\D/g,'');
                if (numericPostId) {
                    api(`/posts/${numericPostId}/comments`, {
                        method: 'POST',
                        body: JSON.stringify({ content: text || '[GIF]', parent_comment_id: replyingToId.replace(/\D/g,'') || undefined })
                    }).catch(() => {});
                }
            }
        }

        async function submitNewComment(postId) {
            if (!isLoggedIn) { showToast('Connect your wallet to comment!', 'error'); return; }
            const input = document.getElementById('newComment_' + postId);
            const text = input ? input.value.trim() : '';

            const gifKey = `comment:${postId}`;
            const gifPreview = document.getElementById(`gifPreview_${gifKey}`);
            const gifUrl = (gifPreview && gifPreview.classList.contains('active')) ? gifPreview.src : null;

            if (!text && !gifUrl) { if (input) input.focus(); return; }

            const storedUser = getStoredUser();
            const myName   = storedUser?.username || 'You';
            const myAvatar = myName[0].toUpperCase();

            const newComment = {
                id: 'c_' + Date.now(), author: myName, avatar: myAvatar,
                verified: storedUser?.isVerified || false,
                time: 'Just now', text: text, gifUrl: gifUrl || null, votes: 0, replies: []
            };
            if (!postCommentData[postId]) postCommentData[postId] = { comments: [] };
            postCommentData[postId].comments.push(newComment);

            gifPickerState.pendingGifs[gifKey] = null;
            renderPostComments(postId);

            const numericPostId = postId.replace(/\D/g,'');
            if (isLoggedIn && numericPostId) {
                api(`/posts/${numericPostId}/comments`, {
                    method: 'POST',
                    body: JSON.stringify({ content: text || '[GIF]' })
                }).catch(() => {});
            }
        }

        // Legacy stubs kept for any remaining onclick references
        function showPostReply(id) { /* replaced by openReplyBox */ }
        function hidePostReply(id) {
            const box = document.getElementById(id);
            if (box) box.style.display = 'none';
        }
        // ─── END DYNAMIC REPLY SYSTEM ───────────────────────────────────────────

        function sortChatMessages(sortType) {
            document.querySelectorAll('.chat-sort-btn').forEach(function(btn) { btn.classList.remove('active'); });
            var btn = event.target.closest('.chat-sort-btn');
            if (btn) btn.classList.add('active');
            var sortText = sortType === 'recent' ? 'Most recent' : 'Most liked';
            showToast(sortText + ' messages');
            loadChatRoomMessages(activeChatRoomId);
        }

        function switchScreen(screenName) {
            // Hide all screens
            document.querySelectorAll('.screen').forEach(screen => {
                screen.classList.remove('active');
            });

            // Remove active from all buttons
            document.querySelectorAll('.screen-btn').forEach(btn => {
                btn.classList.remove('active');
            });

            // Show selected screen
            document.getElementById(screenName).classList.add('active');

            // Mark the matching nav button as active
            document.querySelectorAll('.screen-btn').forEach(btn => {
                if (btn.getAttribute('onclick') === `switchScreen('${screenName}')`) {
                    btn.classList.add('active');
                }
            });

            // ── Screen-specific data loading ──────────────────────────────
            if (screenName === 'feed')      loadFeed(feedSortOrder);
            if (screenName === 'following') loadFollowingFeed(followSortOrder);
            if (screenName === 'profile') {
                // If no specific user was navigated to, load own profile
                if (!_viewingUserId) {
                    var me = getStoredUser();
                    if (me && me.id) {
                        api('/users/me').then(_populateProfileCard).catch(function(){});
                    }
                }
                loadProfilePosts(_viewingUserId, profileSortOrder);
            }
            if (screenName === 'leaderboard') {
                if (typeof loadLeaderboard === 'function') if (isLoggedIn) startNotifPolling();
            loadLeaderboard();
            }
            if (screenName === 'messages' && isLoggedIn) {
                if (typeof loadConversationsList === 'function') loadConversationsList();
                if (typeof refreshUnreadCount    === 'function') refreshUnreadCount();
            }
            if (screenName === 'chatroom' || screenName === 'chat') {
                loadChatRoomMessages(activeChatRoomId);
            }
            if (screenName === 'voicecall') {
                loadVoiceRooms();
            }
        }

        function filterByTopic(topicName) {
            console.log('Filtering by topic:', topicName);

            // Switch to feed screen
            switchScreen('feed');

            // Get all post cards in feed
            const feedContainer = document.querySelector('#feed .feed-container');
            const allPosts = feedContainer.querySelectorAll('.post-card');

            // Show/hide posts based on topic
            let visibleCount = 0;
            allPosts.forEach(post => {
                const topicTag = post.querySelector('.post-topic-tag');
                if (topicTag && topicTag.textContent.trim() === topicName) {
                    post.style.display = 'block';
                    visibleCount++;
                } else {
                    post.style.display = 'none';
                }
            });

            // Add filter indicator at top of feed
            let filterBanner = document.getElementById('topicFilterBanner');
            if (!filterBanner) {
                filterBanner = document.createElement('div');
                filterBanner.id = 'topicFilterBanner';
                filterBanner.style.cssText = `
                    background: linear-gradient(135deg, rgba(153, 69, 255, 0.15) 0%, rgba(74, 158, 255, 0.15) 100%);
                    border: 2px solid rgba(153, 69, 255, 0.35);
                    border-radius: 12px;
                    padding: 15px 20px;
                    margin-bottom: 20px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                `;
                feedContainer.insertBefore(filterBanner, feedContainer.firstChild);
            }

            filterBanner.innerHTML = `
                <div>
                    <span style="font-weight: 700; color: var(--secondary);">Filtered by: ${topicName}</span>
                    <span style="margin-left: 10px; color: var(--text-secondary);">${visibleCount} post${visibleCount !== 1 ? 's' : ''}</span>
                </div>
                <button onclick="clearTopicFilter()" style="
                    background: var(--accent);
                    color: white;
                    border: none;
                    padding: 6px 16px;
                    border-radius: 6px;
                    font-weight: 600;
                    cursor: pointer;
                    font-family: 'Montserrat', sans-serif;
                ">Clear Filter</button>
            `;

            // Scroll to top
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        function clearTopicFilter() {
            // Show all posts
            const feedContainer = document.querySelector('#feed .feed-container');
            const allPosts = feedContainer.querySelectorAll('.post-card');
            allPosts.forEach(post => {
                post.style.display = 'block';
            });

            // Remove filter banner
            const filterBanner = document.getElementById('topicFilterBanner');
            if (filterBanner) {
                filterBanner.remove();
            }
        }

        function switchConversation(element) {
            // Remove active from all conversations
            document.querySelectorAll('.conversation-item').forEach(item => {
                item.classList.remove('active');
            });

            // Mark clicked conversation as active
            element.classList.add('active');

            // In a real app, this would load the conversation messages
        }


        // toggleComments unified above

        async function submitComment(button) {
            const commentBox = button.closest('.write-comment-box');
            const textarea = commentBox.querySelector('.write-comment-input');
            const commentText = textarea.value.trim();
            if (!commentText) return;
            if (!isLoggedIn) { showToast('Connect your wallet to comment', 'error'); return; }

            const postCard = button.closest('[data-post-id]');
            const postId = postCard?.dataset?.postId;
            textarea.value = '';
            showToast('Comment posted! 💬');

            if (postId) {
                api(`/posts/${postId}/comments`, {
                    method: 'POST',
                    body: JSON.stringify({ content: commentText })
                }).catch(() => {});
            }
        }

        function toggleReplyBox(button) {
            const commentContent = button.closest('.comment-content');
            const replyBox = commentContent.querySelector('.reply-box');

            if (replyBox.style.display === 'none') {
                replyBox.style.display = 'block';
                const textarea = replyBox.querySelector('.reply-input');
                textarea.focus();
            } else {
                replyBox.style.display = 'none';
            }
        }

        function submitReply(button) {
            var replyBox = button.closest('.reply-box');
            var textarea = replyBox.querySelector('.reply-input');
            var replyText = textarea.value.trim();
            if (!replyText) { showToast('Please write a reply', 'error'); return; }
            if (!isLoggedIn) { showToast('Connect your wallet to reply', 'error'); return; }
            showToast('Reply posted! &#x1F4AC;');
            textarea.value = '';
            replyBox.style.display = 'none';
        }

        function cancelReply(button) {
            const replyBox = button.closest('.reply-box');
            const textarea = replyBox.querySelector('.reply-input');
            textarea.value = '';
            replyBox.style.display = 'none';
        }

        // Edit comment functions
        function toggleEditPost(button) {
            if (!isLoggedIn) {
                showToast('Connect your wallet to edit posts', 'error'); return;
                return;
            }

            const postCard = button.closest('.post-card');
            const postTitle = postCard.querySelector('.post-title');
            const postContent = postCard.querySelector('.post-content');
            const editBox = postCard.querySelector('.post-edit-box');

            if (editBox.style.display === 'none') {
                editBox.style.display = 'block';
                if (postTitle) postTitle.style.display = 'none';
                postContent.style.display = 'none';
                const titleInput = editBox.querySelector('.post-title-edit');
                titleInput.focus();
            } else {
                editBox.style.display = 'none';
                if (postTitle) postTitle.style.display = 'block';
                postContent.style.display = 'block';
            }
        }

        async function saveEditPost(button) {
            var editBox = button.closest('.post-edit-box');
            var postCard = editBox.closest('.post-card, .profile-post-card');
            var postId = postCard && postCard.dataset.postId;
            var titleInput = editBox.querySelector('.post-title-edit');
            var contentTextarea = editBox.querySelector('.post-content-edit');
            var postTitle = postCard.querySelector('.post-title, .profile-post-title');
            var postContent = postCard.querySelector('.post-content, .profile-post-text');

            var newTitle   = titleInput ? titleInput.value.trim() : '';
            var newContent = contentTextarea ? contentTextarea.value.trim() : '';
            if (!newContent) { showToast('Post content cannot be empty', 'error'); return; }

            // Optimistic DOM update
            if (postTitle) { postTitle.textContent = newTitle || ''; postTitle.style.display = newTitle ? 'block' : 'none'; }
            if (postContent) postContent.textContent = newContent;
            editBox.style.display = 'none';
            if (postContent) postContent.style.display = 'block';
            showToast('Post updated &#x270F;&#xFE0F;');

            if (postId && isLoggedIn) {
                api('/posts/' + postId, {
                    method: 'PUT',
                    body: JSON.stringify({ content: newContent, title: newTitle || undefined })
                }).catch(function() { showToast('Could not save edit to server', 'error'); });
            }
        }

        function cancelEditPost(button) {
            const editBox = button.closest('.post-edit-box');
            const postCard = editBox.closest('.post-card');
            const postTitle = postCard.querySelector('.post-title');
            const postContent = postCard.querySelector('.post-content');
            const titleInput = editBox.querySelector('.post-title-edit');
            const contentTextarea = editBox.querySelector('.post-content-edit');

            // Reset to original values
            titleInput.value = postTitle ? postTitle.textContent : '';
            contentTextarea.value = postContent.textContent;

            editBox.style.display = 'none';
            if (postTitle) postTitle.style.display = 'block';
            postContent.style.display = 'block';
        }

        function toggleEditComment(button) {
            if (!isLoggedIn) {
                showToast('Connect your wallet to edit comments', 'error'); return;
                return;
            }

            const commentContent = button.closest('.comment-content');
            const commentText = commentContent.querySelector('.comment-text');
            const editBox = commentContent.querySelector('.edit-box');

            if (editBox.style.display === 'none') {
                editBox.style.display = 'block';
                commentText.style.display = 'none';
                const textarea = editBox.querySelector('.edit-input');
                textarea.focus();
            } else {
                editBox.style.display = 'none';
                commentText.style.display = 'block';
            }
        }

        function saveEditComment(button) {
            const editBox = button.closest('.edit-box');
            const commentContent = editBox.closest('.comment-content');
            const textarea = editBox.querySelector('.edit-input');
            const commentText = commentContent.querySelector('.comment-text');
            const newText = textarea.value.trim();

            if (!newText) {
                showToast('Comment cannot be empty', 'error');
                return;
            }

            console.log('Saving edited comment:', newText);
            commentText.textContent = newText;
            editBox.style.display = 'none';
            commentText.style.display = 'block';
            showToast('Comment updated &#x270F;&#xFE0F;');
        }

        function cancelEditComment(button) {
            const editBox = button.closest('.edit-box');
            const commentContent = editBox.closest('.comment-content');
            const commentText = commentContent.querySelector('.comment-text');
            const textarea = editBox.querySelector('.edit-input');

            // Reset textarea to original text
            textarea.value = commentText.textContent;
            editBox.style.display = 'none';
            commentText.style.display = 'block';
        }

        // Edit reply functions
        function toggleEditReply(button) {
            if (!isLoggedIn) {
                showToast('Connect your wallet to edit replies', 'error'); return;
                return;
            }

            const replyContent = button.closest('.reply-content');
            const replyText = replyContent.querySelector('.reply-text');
            const editBox = replyContent.querySelector('.edit-box');

            if (editBox.style.display === 'none') {
                editBox.style.display = 'block';
                replyText.style.display = 'none';
                const textarea = editBox.querySelector('.edit-input');
                textarea.focus();
            } else {
                editBox.style.display = 'none';
                replyText.style.display = 'block';
            }
        }

        function saveEditReply(button) {
            const editBox = button.closest('.edit-box');
            const replyContent = editBox.closest('.reply-content');
            const textarea = editBox.querySelector('.edit-input');
            const replyText = replyContent.querySelector('.reply-text');
            const newText = textarea.value.trim();

            if (!newText) {
                showToast('Reply cannot be empty', 'error');
                return;
            }

            console.log('Saving edited reply:', newText);
            replyText.textContent = newText;
            editBox.style.display = 'none';
            replyText.style.display = 'block';
            showToast('Reply updated &#x270F;&#xFE0F;');
        }

        function cancelEditReply(button) {
            const editBox = button.closest('.edit-box');
            const replyContent = editBox.closest('.reply-content');
            const replyText = replyContent.querySelector('.reply-text');
            const textarea = editBox.querySelector('.edit-input');

            // Reset textarea to original text
            textarea.value = replyText.textContent;
            editBox.style.display = 'none';
            replyText.style.display = 'block';
        }

        function uploadProfilePicture() {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.onchange = (e) => {
                const file = e.target.files[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        profilePictureData = event.target.result;
                        updateProfileAvatar(profilePictureData);
                    };
                    reader.readAsDataURL(file);
                }
            };
            input.click();
        }

        function updateProfileAvatar(imageData) {
            const imgTag = '<img src="' + imageData + '" alt="Profile Picture" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
            const displayAvatar  = document.getElementById('profileAvatar');
            const settingsAvatar = document.getElementById('settingsAvatar');
            if (displayAvatar)  displayAvatar.innerHTML  = imgTag;
            if (settingsAvatar) settingsAvatar.innerHTML = imgTag;
            // Propagate to all avatars app-wide
            const storedUser = getStoredUser ? getStoredUser() : null;
            const myName = (storedUser && storedUser.username) || currentUser || 'You';
            setUserAvatar(myName, imageData);
        }

        function uploadImage() {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.onchange = (e) => {
                const file = e.target.files[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        currentMedia = event.target.result;
                        currentMediaType = 'image';
                        showMediaPreview(currentMedia, 'image');
                    };
                    reader.readAsDataURL(file);
                }
            };
            input.click();
        }

        function uploadVideo() {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'video/*';
            input.onchange = (e) => {
                const file = e.target.files[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        currentMedia = event.target.result;
                        currentMediaType = 'video';
                        showMediaPreview(currentMedia, 'video');
                    };
                    reader.readAsDataURL(file);
                }
            };
            input.click();
        }

        function showMediaPreview(src, type) {
            const preview = document.getElementById('mediaPreview');
            preview.classList.add('active');

            if (type === 'image') {
                preview.innerHTML = `
                    <div class="preview-container">
                        <img src="${src}" class="preview-image" alt="Preview">
                        <button class="remove-media-btn" onclick="removeMedia()">×</button>
                    </div>
                `;
            } else if (type === 'video') {
                preview.innerHTML = `
                    <div class="preview-container">
                        <video controls class="preview-video">
                            <source src="${src}" type="video/mp4">
                        </video>
                        <button class="remove-media-btn" onclick="removeMedia()">×</button>
                    </div>
                `;
            }
        }

        function removeMedia() {
            currentMedia = null;
            currentMediaType = null;
            const preview = document.getElementById('mediaPreview');
            preview.classList.remove('active');
            preview.innerHTML = '';
        }


        // =====================================================================
        // FEED ENGINE — dynamic post loading, rendering, and refreshing
        // =====================================================================

        var feedPosts        = [];
        var followingPosts   = [];
        var profilePosts     = [];
        var feedSortOrder    = 'recent';
        var followSortOrder  = 'recent';
        var profileSortOrder = 'recent';

        // Relative time helper
        function _timeAgo(iso) {
            var s = Math.floor((Date.now() - new Date(iso)) / 1000);
            if (s < 60)     return s + 's ago';
            if (s < 3600)   return Math.floor(s / 60) + 'm ago';
            if (s < 86400)  return Math.floor(s / 3600) + 'h ago';
            if (s < 604800) return Math.floor(s / 86400) + 'd ago';
            return new Date(iso).toLocaleDateString();
        }

        // Topic -> CSS class
        var _TCLS = {
            bitcoin:'bitcoin', btc:'bitcoin',
            ethereum:'ethereum', eth:'ethereum',
            solana:'solana', sol:'solana',
            'meme coins':'meme', meme:'meme',
            defi:'defi', general:'general',
            news:'news', trends:'trends', lore:'lore', utility:'utility'
        };
        function _tClass(t) { return _TCLS[(t||'').toLowerCase()] || 'general'; }

        // Build a single post card HTML string
        function renderPostCard(p, opts) {
            opts = opts || {};
            var pid  = String(p.id || '');
            var top  = p.topic || 'general';
            var tLbl = top.charAt(0).toUpperCase() + top.slice(1);
            var ts   = p.created_at ? _timeAgo(p.created_at) : '';
            var uv   = p.upvote_count  || 0;
            var cm   = p.comment_count || 0;
            var rp   = p.repost_count  || 0;
            var uCls = p.user_upvoted    ? ' active' : '';
            var bCls = p.user_bookmarked ? ' active' : '';
            var rCls = p.user_reposted   ? ' active' : '';

            var authorHtml = '';
            if (opts.showAuthor !== false && p.username) {
                authorHtml = '<span class="post-author username-link"'
                    + ' data-profile-user="' + escapeHtml(p.username) + '"'
                    + ' style="font-size:0.82em;color:var(--text-secondary);'
                    + 'margin-right:6px;cursor:pointer;font-weight:600;">'
                    + escapeHtml(p.username)
                    + (p.is_verified ? ' <span style="color:var(--primary);">&#x2713;</span>' : '')
                    + '</span>';
            }
            var titleHtml = p.title
                ? '<div class="profile-post-title">' + escapeHtml(p.title) + '</div>'
                : '';

            return '<div class="profile-post-card" data-post-id="' + pid + '">'
                + '<div class="profile-post-border-accent"></div>'
                + '<div class="profile-post-content">'
                + '<div class="profile-post-header">'
                + authorHtml
                + '<span class="profile-post-topic ' + _tClass(top) + '">&#x1FA99; ' + escapeHtml(tLbl) + '</span>'
                + '<span class="profile-post-time">' + ts + '</span>'
                + '</div>'
                + titleHtml
                + '<div class="profile-post-text">' + escapeHtml(p.content || '') + '</div>'
                + '<div class="post-action-bar">'
                + '<button class="post-action-btn vote-up' + uCls + '" onclick="toggleUpvote(this)">&#9650; ' + uv + '</button>'
                + '<button class="post-action-btn comment-btn" onclick="toggleComments(this)">&#x1F4AC; ' + cm + '</button>'
                + '<button class="post-action-btn' + rCls + '" data-repost-id="' + pid + '" onclick="doRepost(this)">&#x1F501; ' + rp + '</button>'
                + '<button class="post-action-btn' + bCls + '" onclick="toggleBookmark(this)" data-post-id="' + pid + '" title="Bookmark">&#x1F516;</button>'
                + '<button class="post-action-btn" onclick="copyPostLink(this)" title="Copy link">&#x1F517;</button>'
                + '</div>'
                + '<div class="post-comments-section" style="display:none;" data-post-id="' + pid + '"></div>'
                + '</div>'
                + '</div>';
        }

        // Sort posts array
        function _sortedPosts(arr, sort) {
            var c = arr.slice();
            if (sort === 'liked')
                c.sort(function(a, b) { return (b.upvote_count || 0) - (a.upvote_count || 0); });
            else
                c.sort(function(a, b) { return new Date(b.created_at) - new Date(a.created_at); });
            return c;
        }

        // Render array of posts into a grid container by ID
        function renderPostsInto(containerId, posts, sort, opts) {
            var g = document.getElementById(containerId);
            if (!g) return;
            if (!posts || !posts.length) {
                g.innerHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:40px;">'
                    + '<div style="font-size:2em;margin-bottom:8px;">&#x1F4ED;</div>'
                    + '<div>No posts yet. Be the first!</div></div>';
                return;
            }
            g.innerHTML = _sortedPosts(posts, sort || 'recent')
                .map(function(p) { return renderPostCard(p, opts); }).join('');
        }

        // Load main feed from API
        async function loadFeed(sort) {
            sort = sort || feedSortOrder;
            feedSortOrder = sort;
            var g = document.getElementById('feedPostsGrid');
            if (!g) return;
            g.innerHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:40px;">Loading posts...</div>';
            try {
                var d = await api('/posts');
                feedPosts = (d && d.posts) || [];
                if (!feedPosts.length) {
                    g.innerHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:40px 20px;">'
                        + '<div style="font-size:2em;margin-bottom:8px;">&#x1F4ED;</div>'
                        + '<div>No posts yet. Write the first one!</div></div>';
                } else {
                    renderPostsInto('feedPostsGrid', feedPosts, sort, { showAuthor: true });
                }
            } catch (e) {
                // Backend offline — keep static demo content visible if grid not empty
                if (g.innerHTML.includes('Loading')) {
                    g.innerHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:40px;">'
                        + 'Backend unavailable &mdash; running in demo mode.</div>';
                }
            }
        }

        // Load following feed from API
        async function loadFollowingFeed(sort) {
            sort = sort || followSortOrder;
            followSortOrder = sort;
            var g = document.getElementById('followingPostsGrid');
            if (!g) return;
            if (!isLoggedIn) {
                g.innerHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:40px;">'
                    + '<div style="font-size:2em;margin-bottom:8px;">&#x1F510;</div>'
                    + '<div>Connect your wallet to see posts from people you follow.</div></div>';
                return;
            }
            g.innerHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:40px;">Loading...</div>';
            try {
                var d = await api('/posts/following');
                followingPosts = (d && d.posts) || [];
                if (!followingPosts.length) {
                    g.innerHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:40px;">'
                        + '<div style="font-size:2em;margin-bottom:8px;">&#x1F465;</div>'
                        + '<div>Follow people to see their posts here.</div></div>';
                } else {
                    renderPostsInto('followingPostsGrid', followingPosts, sort, { showAuthor: true });
                }
            } catch (e) {
                g.innerHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:40px;">'
                    + 'Could not load following feed.</div>';
            }
        }

        // Load profile posts from API (own or another user)
        async function loadProfilePosts(userId, sort) {
            sort = sort || profileSortOrder;
            profileSortOrder = sort;
            var g = document.getElementById('profilePostsGrid');
            if (!g) return;
            var uid = userId || (getStoredUser() || {}).id;
            if (!uid) {
                g.innerHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:40px;">'
                    + 'Connect your wallet to see your posts.</div>';
                return;
            }
            try {
                var d = await api('/users/' + uid + '/posts');
                profilePosts = (d && d.posts) || [];
                if (!profilePosts.length) {
                    g.innerHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:40px;">'
                        + '<div style="font-size:2em;margin-bottom:8px;">&#x270D;&#xFE0F;</div>'
                        + '<div>No posts yet. Share your first post!</div></div>';
                } else {
                    renderPostsInto('profilePostsGrid', profilePosts, sort, { showAuthor: false });
                }
            } catch (e) {
                // Keep static demo posts visible on error
            }
        }

        // Repost toggle — uses data-repost-id to avoid inline quote escaping
        function doRepost(btn) {
            if (!isLoggedIn) { showToast('Connect wallet to repost', 'error'); return; }
            var pid = btn.dataset.repostId;
            if (!pid) return;
            var was = btn.classList.contains('active');
            btn.classList.toggle('active');
            var m = btn.textContent.match(/\d+/);
            if (m) btn.innerHTML = '&#x1F501; ' + (was ? Math.max(0, parseInt(m[0]) - 1) : parseInt(m[0]) + 1);
            api('/posts/' + pid + '/repost', { method: 'POST' }).catch(function() {
                btn.classList.toggle('active');
            });
        }

        async function createPost() {
            const titleInput = document.getElementById('postTitleInput');
            const textarea   = document.getElementById('postTextarea');
            const linkInput  = document.getElementById('postLinkInput');
            const title   = titleInput.value.trim();
            const content = textarea.value.trim();

            if (!content && !currentMedia) {
                showToast('Please add some content to your post!', 'error');
                return;
            }
            if (!isLoggedIn) {
                showToast('Connect your wallet to post!', 'error');
                return;
            }

            const topicName = selectedTopic?.name || 'general';

            try {
                await api('/posts', {
                    method: 'POST',
                    body: JSON.stringify({ content, title: title || undefined, topic: topicName.toLowerCase() })
                });
                showToast('Post created! 🎉');
            } catch (err) {
                showToast('Post created (demo mode)! 🎉');
            }

            titleInput.value = '';
            textarea.value   = '';
            linkInput.value  = '';
            removeMedia();
            clearTopic();

            // Refresh feed + profile so the new post appears immediately
            loadFeed(feedSortOrder);
            loadProfilePosts(null, profileSortOrder);
        }

        function copyWalletAddress() {
            if (!walletAddress) return;
            if (navigator.clipboard?.writeText) {
                navigator.clipboard.writeText(walletAddress).then(() => showToast('Wallet address copied!'));
            } else {
                // Fallback
                const el = document.createElement('textarea');
                el.value = walletAddress;
                document.body.appendChild(el);
                el.select();
                document.execCommand('copy');
                document.body.removeChild(el);
                showToast('Wallet address copied!');
            }
        }

        function toggleProfileView(view) {
            document.getElementById('profileDisplay').style.display  = (view === 'display')  ? 'block' : 'none';
            document.getElementById('profileSettings').style.display = (view === 'settings') ? 'block' : 'none';
        }

        async function saveProfile() {
            const username    = document.getElementById('username').value.trim();
            const bio         = document.getElementById('bio').value.trim();
            const displayName = document.getElementById('displayName')?.value?.trim();
            const location    = document.getElementById('location')?.value?.trim();
            const website     = document.getElementById('website')?.value?.trim();

            // Update DOM display
            const nameEl = document.querySelector('.profile-name');
            if (nameEl) nameEl.childNodes[0].textContent = (displayName || username) + ' ';
            const bioEl = document.querySelector('.profile-bio');
            if (bioEl) bioEl.textContent = bio;
            const locEl = document.querySelector('.profile-location');
            if (locEl) locEl.textContent = location ? '📍 ' + location : '';
            const linkEl = document.querySelector('.profile-link');
            if (linkEl) {
                linkEl.textContent = website ? '🌐 ' + website : '';
                if (linkEl.parentElement) linkEl.parentElement.style.display = website ? 'inline' : 'none';
            }

            // API call — saves username, bio, and avatar (base64 data-url stored as avatarUrl)
            if (isLoggedIn) {
                const payload = {
                    username:  username  || undefined,
                    bio:       bio       || undefined,
                    avatarUrl: (typeof profilePictureData !== 'undefined' && profilePictureData) ? profilePictureData : undefined
                };
                api('/users/profile', {
                    method: 'PUT',
                    body: JSON.stringify(payload)
                }).then(updated => {
                    // Keep local auth cache in sync
                    const user = getStoredUser();
                    if (user && updated) {
                        user.username  = updated.username;
                        if (updated.avatar_url) user.avatarUrl = updated.avatar_url;
                        localStorage.setItem('wf_user', JSON.stringify(user));
                    }
                }).catch(() => {});
            }

            showToast('Profile saved ✅');
            toggleProfileView('display');
        }

        function cancelEdit() {
            if (confirm('Discard changes?')) {
                // Restore fields from real stored user data
                var u = getStoredUser();
                if (u) _fillSettingsForm(u);
                toggleProfileView('display');
            }
        }

        let isSpeaker = false;
        let isMuted = false;

        function toggleMic() {
            const btn = document.querySelector('.voice-control-btn.join-btn');
            if (!isLoggedIn) { showToast('Connect your wallet first', 'error'); return; }
            if (!isSpeaker) {
                isSpeaker = true; isMuted = false;
                if (btn) {
                    btn.querySelector('.control-icon').textContent = '&#127908;';
                    btn.querySelector('.control-label').textContent = 'Mute';
                    btn.style.borderColor = 'var(--primary)';
                    btn.style.background = 'rgba(20,241,149,0.12)';
                }
                showToast('You are now speaking!');
                api('/voice/rooms/1/request-speaker', { method: 'POST' }).catch(() => {});
            } else if (!isMuted) {
                isMuted = true;
                if (btn) {
                    btn.querySelector('.control-icon').textContent = '&#128263;';
                    btn.querySelector('.control-label').textContent = 'Unmute';
                    btn.style.borderColor = 'var(--error)';
                    btn.style.background = 'rgba(255,77,77,0.12)';
                }
                showToast('Microphone muted', 'warning');
            } else {
                isMuted = false;
                if (btn) {
                    btn.querySelector('.control-icon').textContent = '&#127908;';
                    btn.querySelector('.control-label').textContent = 'Mute';
                    btn.style.borderColor = 'var(--primary)';
                    btn.style.background = 'rgba(20,241,149,0.12)';
                }
                showToast('Microphone unmuted');
            }
        }

        function leaveChat() {
            if (confirm('Leave this voice chat?')) {
                leaveVoiceChat();
                switchScreen('voicecall');
            }
        }

        // Voice Chat Creation Functions
        function openStartVoiceModal() {
            if (!isLoggedIn) {
                showToast('Connect your wallet to start a voice chat', 'error'); return;
                return;
            }
            document.getElementById('startVoiceModal').style.display = 'flex';
            document.body.style.overflow = 'hidden';
        }

        function closeStartVoiceModal() {
            document.getElementById('startVoiceModal').style.display = 'none';
            document.body.style.overflow = 'auto';
        }

        async function createVoiceRoom() {
            const title = document.getElementById('voiceRoomTitle').value.trim();
            const desc = document.getElementById('voiceRoomDesc').value.trim();
            const topic = document.getElementById('voiceRoomTopic').value;
            const maxSpeakers = document.getElementById('maxSpeakers').value;

            if (!title) { showToast('Please enter a room title', 'error'); return; }

            closeStartVoiceModal();
            showToast(`🎙️ "${title}" is now live!`);

            // API call
            if (isLoggedIn) {
                api('/voice/rooms', {
                    method: 'POST',
                    body: JSON.stringify({ title, description: desc || undefined, topic: topic || 'general', maxSpeakers: parseInt(maxSpeakers) || 10 })
                }).catch(() => {});
            }

            // Reset form
            document.getElementById('voiceRoomTitle').value = '';
            document.getElementById('voiceRoomDesc').value = '';
            document.getElementById('voiceRoomTopic').value = 'general';
            document.getElementById('maxSpeakers').value = '10';

            switchScreen('voicecall');
        }

        function createVoiceChat() {
            // Legacy function - redirects to new modal
            openStartVoiceModal();
        }

        // handleVerification defined above

        // ── Leaderboard Data & Pagination ────────────────────────────────────
        let currentPage = 1;
        const usersPerPage = 10;
        let totalPages = 10;

        // Mock fallback data (used when not logged in or API unavailable)
        const leaderboardMockData = [
            { rank: 1,  name: 'AlphaGrinder',   avatar: 'A', hours: 127, posts: 45,  comments: 234, likes: 892, score: 8450, payout: 486 },
            { rank: 2,  name: 'SolanaKing',      avatar: 'S', hours: 118, posts: 52,  comments: 198, likes: 756, score: 7920, payout: 354 },
            { rank: 3,  name: 'CryptoNinja',     avatar: 'C', hours: 105, posts: 67,  comments: 312, likes: 623, score: 7650, payout: 321 },
            { rank: 4,  name: 'DeFiMaster',      avatar: 'D', hours: 98,  posts: 38,  comments: 267, likes: 534, score: 6890, payout: 273 },
            { rank: 5,  name: 'MoonChaser',      avatar: 'M', hours: 94,  posts: 41,  comments: 189, likes: 712, score: 6340, payout: 234 },
            { rank: 6,  name: 'Web3Warrior',     avatar: 'W', hours: 89,  posts: 56,  comments: 223, likes: 445, score: 5980, payout: 213 },
            { rank: 7,  name: 'NFTCollector',    avatar: 'N', hours: 85,  posts: 29,  comments: 178, likes: 589, score: 5620, payout: 194 },
            { rank: 8,  name: 'TokenTrader',     avatar: 'T', hours: 82,  posts: 33,  comments: 156, likes: 498, score: 5240, payout: 168 },
            { rank: 9,  name: 'BlockchainBro',   avatar: 'B', hours: 79,  posts: 48,  comments: 201, likes: 402, score: 4980, payout: 152 },
            { rank: 10, name: 'EthEnthusiast',   avatar: 'E', hours: 75,  posts: 31,  comments: 187, likes: 523, score: 4720, payout: 138 }
        ];
        // Pad to 100 entries for pagination demo
        (function() {
            const extras = ['DexMaster','YieldFarmer','GasOptimizer','SmartTrader','ChainHopper','StakeHolder','LiquidityPro','MetaMaven','RektWarrior','DiamondHands','ApeStrong','WhaleWatcher','HODLGang','FlipperKing','BearHunter','BullRunner','TrendRider','DayTraderZ','CryptoKing','CoinQueen'];
            for (var i = 11; i <= 100; i++) {
                var n = extras[(i-11) % extras.length];
                leaderboardMockData.push({ rank: i, name: n, avatar: n[0], hours: Math.max(10, 75-Math.floor((i-10)*0.7)), posts: 10+Math.floor(Math.random()*30), comments: 50+Math.floor(Math.random()*100), likes: 100+Math.floor(Math.random()*300), score: Math.max(500, 4720-((i-10)*45)), payout: Math.max(5, 138-Math.floor((i-10)*1.3)) });
            }
        })();

        // Live leaderboard data — populated by API, falls back to mock
        var leaderboardData = leaderboardMockData.slice();

        // Load leaderboard from API (called on screen switch)
        async function loadLeaderboard() {
            try {
                const data = await api('/leaderboard?limit=100');
                if (data && data.leaderboard && data.leaderboard.length) {
                    // Map API shape to display shape
                    leaderboardData = data.leaderboard.map(function(u, idx) {
                        return {
                            rank:     parseInt(u.rank) || idx + 1,
                            name:     u.username,
                            avatar:   u.username[0].toUpperCase(),
                            hours:    0,  // not tracked per-user in this schema yet
                            posts:    u.posts_count    || 0,
                            comments: u.comments_count || 0,
                            likes:    u.upvotes_received || 0,
                            score:    u.engagement_score || 0,
                            payout:   Math.floor((u.engagement_score || 0) / 20)
                        };
                    });
                    totalPages = Math.ceil(leaderboardData.length / usersPerPage);
                    renderLeaderboard(1);
                }
            } catch (e) {
                // Backend unavailable — keep mock data already rendered
            }
        }


        function renderLeaderboard(page) {
            const startIndex = (page - 1) * usersPerPage;
            const endIndex = startIndex + usersPerPage;
            const pageData = leaderboardData.slice(startIndex, endIndex);

            const rowsContainer = document.getElementById('leaderboardRows');
            rowsContainer.innerHTML = '';

            pageData.forEach(user => {
                const rankClass = user.rank <= 3 ? `rank-${user.rank}` : '';
                const row = `
                    <div class="leaderboard-row">
                        <div class="rank ${rankClass}">#${user.rank}</div>
                        <div class="leader-user">
                            <div class="leader-avatar" data-avatar-user="${user.name}">${USER_AVATARS[user.name] ? '' : user.avatar}</div>
                            <div class="leader-info">
                                <div class="leader-name username-link" onclick="goToProfile('" + user.name + "')">${user.name}</div>
                                <div class="leader-stats">${user.hours}h • ${user.posts} posts • ${user.comments} comments • ${user.likes} likes</div>
                            </div>
                        </div>
                        <div class="leader-score">${user.score.toLocaleString()} pts</div>
                        <div class="estimated-payout">~$${user.payout}</div>
                    </div>
                `;
                rowsContainer.innerHTML += row;
            });

            updatePaginationControls(page);
        }

        function updatePaginationControls(page) {
            currentPage = page;

            // Update showing text
            const start = (page - 1) * usersPerPage + 1;
            const end = Math.min(page * usersPerPage, 100);
            document.getElementById('showingStart').textContent = start;
            document.getElementById('showingEnd').textContent = end;
            document.getElementById('totalUsers').textContent = '100';

            // Update page input
            document.getElementById('pageJumpInput').value = page;

            // Update button states
            document.getElementById('firstPageBtn').disabled = page === 1;
            document.getElementById('prevPageBtn').disabled = page === 1;
            document.getElementById('nextPageBtn').disabled = page === totalPages;
            document.getElementById('lastPageBtn').disabled = page === totalPages;

            // Render page numbers
            renderPageNumbers(page);
        }

        function renderPageNumbers(currentPage) {
            const numbersContainer = document.getElementById('paginationNumbers');
            numbersContainer.innerHTML = '';

            let pages = [];

            if (totalPages <= 7) {
                // Show all pages if 7 or fewer
                for (let i = 1; i <= totalPages; i++) {
                    pages.push(i);
                }
            } else {
                // Always show first page
                pages.push(1);

                if (currentPage > 3) {
                    pages.push('...');
                }

                // Show pages around current
                for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) {
                    if (!pages.includes(i)) {
                        pages.push(i);
                    }
                }

                if (currentPage < totalPages - 2) {
                    pages.push('...');
                }

                // Always show last page
                if (!pages.includes(totalPages)) {
                    pages.push(totalPages);
                }
            }

            pages.forEach(page => {
                if (page === '...') {
                    numbersContainer.innerHTML += '<div class="pagination-ellipsis">...</div>';
                } else {
                    const activeClass = page === currentPage ? 'active' : '';
                    numbersContainer.innerHTML += `
                        <div class="pagination-page ${activeClass}" onclick="goToPage(${page})">
                            ${page}
                        </div>
                    `;
                }
            });
        }

        function goToPage(page) {
            if (page < 1 || page > totalPages) return;
            renderLeaderboard(page);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        function nextPage() {
            if (currentPage < totalPages) {
                goToPage(currentPage + 1);
            }
        }

        function previousPage() {
            if (currentPage > 1) {
                goToPage(currentPage - 1);
            }
        }

        function jumpToPage() {
            const input = document.getElementById('pageJumpInput');
            const page = parseInt(input.value);
            if (page >= 1 && page <= totalPages) {
                goToPage(page);
            } else {
                input.value = currentPage;
                showToast('Enter a page between 1 and ' + totalPages, 'error');
            }
        }

        // Initialize leaderboard on page load
        document.addEventListener('DOMContentLoaded', function() {
            renderLeaderboard(1);           // render mock data immediately
            loadLeaderboard();              // then try to replace with live API data

            // Poll unread message count every 60s when authenticated
            setInterval(function() {
                if (isLoggedIn && typeof refreshUnreadCount === 'function') refreshUnreadCount();
            }, 60000);

            // Render dynamic comment system for all posts
            renderPostComments('feedPost1');

            // Schedule type toggle
            const scheduleRadios = document.querySelectorAll('input[name="scheduleType"]');
            scheduleRadios.forEach(radio => {
                radio.addEventListener('change', function() {
                    const scheduleInputs = document.getElementById('scheduleInputs');
                    if (this.value === 'scheduled') {
                        scheduleInputs.style.display = 'block';
                    } else {
                        scheduleInputs.style.display = 'none';
                    }
                });
            });
        });

        // Create Voice Room from dedicated page
        async function createVoiceRoomFromPage() {
            var title = document.getElementById('voiceRoomTitle') ? document.getElementById('voiceRoomTitle').value.trim() : '';
            var desc  = document.getElementById('voiceRoomDesc')  ? document.getElementById('voiceRoomDesc').value.trim()  : '';
            var topicEl = document.getElementById('voiceRoomTopic');
            var topic = topicEl ? topicEl.value : 'general';
            var maxSpeakers = document.getElementById('maxSpeakers') ? document.getElementById('maxSpeakers').value : '10';
            var schedTypeEl = document.querySelector('input[name="scheduleType"]:checked');
            var schedType = schedTypeEl ? schedTypeEl.value : 'now';

            if (!title) { showToast('Please enter a room title', 'error'); if (document.getElementById('voiceRoomTitle')) document.getElementById('voiceRoomTitle').focus(); return; }
            if (!topic)  { showToast('Please select a topic', 'error'); return; }

            if (!isLoggedIn) { showToast('Connect your wallet to create a room', 'error'); return; }

            showToast('&#x1F399;&#xFE0F; Creating room...');

            try {
                var room = await api('/voice/rooms', {
                    method: 'POST',
                    body: JSON.stringify({ title: title, description: desc || undefined, topic: topic, maxSpeakers: parseInt(maxSpeakers) || 10 })
                });
                showToast('&#x1F399;&#xFE0F; "' + title + '" is now live!');
            } catch(e) {
                showToast('&#x1F399;&#xFE0F; Room created (demo mode)!');
            }

            // Reset form
            if (document.getElementById('voiceRoomTitle')) document.getElementById('voiceRoomTitle').value = '';
            if (document.getElementById('voiceRoomDesc'))  document.getElementById('voiceRoomDesc').value  = '';
            if (topicEl) topicEl.value = '';
            if (document.getElementById('maxSpeakers')) document.getElementById('maxSpeakers').value = '10';
            var nowRadio = document.querySelector('input[name="scheduleType"][value="now"]');
            if (nowRadio) nowRadio.checked = true;
            var schedInputs = document.getElementById('scheduleInputs');
            if (schedInputs) schedInputs.style.display = 'none';

            switchScreen('voicecall');
            setTimeout(loadVoiceRooms, 500);
        }

        function repostPost(element) {
            // Delegate to doRepost which is the real wired version
            if (!isLoggedIn) { showToast('Connect your wallet to repost', 'error'); return; }
            var postCard = element.closest('.post-card, .profile-post-card');
            var postId = postCard && postCard.dataset.postId;
            if (!postId) { showToast('Could not identify post', 'error'); return; }
            // Find or create a repost button to delegate through
            var btn = postCard.querySelector('[data-repost-id]');
            if (btn) { doRepost(btn); } else {
                api('/posts/' + postId + '/repost', { method: 'POST' })
                    .then(function(d) { showToast(d.reposted ? 'Reposted! &#x1F501;' : 'Repost removed'); })
                    .catch(function() { showToast('Could not repost', 'error'); });
            }
        }

        function pinPost(element) {
            // Check if user is logged in
            if (!isLoggedIn) {
                showToast('Connect your wallet to pin posts', 'error'); return;
                return;
            }

            const postCard = element.closest('.post-card');
            const pinBtn = element;

            // Check if already pinned
            if (pinBtn.classList.contains('pinned')) {
                // Unpin
                pinBtn.classList.remove('pinned');
                pinBtn.textContent = '📌 Pin to Profile';

                // Hide pinned section
                document.getElementById('pinnedPostSection').style.display = 'none';
                document.getElementById('pinnedPostContainer').innerHTML = '';

                showToast('Post unpinned &#x1F4CC;');
            } else {
                // Remove pinned class from all other pin buttons
                document.querySelectorAll('.pin-btn').forEach(btn => {
                    btn.classList.remove('pinned');
                    btn.textContent = '📌 Pin to Profile';
                });

                // Pin this post
                pinBtn.classList.add('pinned');
                pinBtn.textContent = '📌 Pinned';

                // Clone the post and add to pinned section
                const clonedPost = postCard.cloneNode(true);

                // Add unpin button to cloned post
                const clonedPinBtn = clonedPost.querySelector('.pin-btn');
                if (clonedPinBtn) {
                    clonedPinBtn.textContent = '📌 Unpin';
                    clonedPinBtn.classList.add('pinned');
                }

                // Show pinned section and add post
                document.getElementById('pinnedPostSection').style.display = 'block';
                document.getElementById('pinnedPostContainer').innerHTML = '';
                document.getElementById('pinnedPostContainer').appendChild(clonedPost);

                showToast('Post pinned to profile! &#x1F4CC;');
            }
        }

        function toggleFollow() {
            const btn = document.querySelector('.follow-btn');
            const isFollowing = btn.classList.contains('following');
            // Get profile user ID from the current profile view
            const profileUserId = btn.dataset.userId || null;

            if (isFollowing) {
                btn.classList.remove('following');
                btn.textContent = '+ Follow';
                showToast('Unfollowed');
            } else {
                btn.classList.add('following');
                btn.textContent = '\u2713 Following';
                showToast('Following! Their posts will appear in your feed.');
            }

            // Sync with backend (non-blocking — UI updates optimistically)
            if (profileUserId) {
                api('/users/' + profileUserId + '/follow', { method: 'POST' }).catch(() => {});
            }
        }

        // Mock data for search


        


        const mockUsers = [
            { username: 'AlphaGrinder', displayName: 'Alpha Grinder',  verified: true,  followers: '2.3k' },
            { username: 'SolanaKing',   displayName: 'Solana King',    verified: true,  followers: '1.8k' },
            { username: 'CryptoNinja',  displayName: 'Crypto Ninja',   verified: true,  followers: '3.1k' },
            { username: 'DeFiMaster',   displayName: 'DeFi Master',    verified: true,  followers: '1.5k' },
            { username: 'MoonChaser',   displayName: 'Moon Chaser',    verified: true,  followers: '987'  },
            { username: 'Web3Warrior',  displayName: 'Web3 Warrior',   verified: false, followers: '1.2k' },
            { username: 'NFTCollector', displayName: 'NFT Collector',  verified: false, followers: '756'  },
            { username: 'TokenTrader',  displayName: 'Token Trader',   verified: true,  followers: '2.1k' }
        ];

        let searchPosts = [
            { author: 'CryptoNinja',  topic: 'Solana',     content: 'Just hit 100 hours grinding on Solana validators', time: '2h ago' },
            { author: 'DeFiMaster',   topic: 'Trends',     content: 'DeFi yields are looking insane right now', time: '4h ago' },
            { author: 'MoonChaser',   topic: 'Meme Coins', content: 'This new meme coin is about to moon', time: '1h ago' },
            { author: 'AlphaGrinder', topic: 'General',    content: 'Diamond hands through the dip. Never selling.', time: '30m ago' },
            { author: 'SolanaKing',   topic: 'Solana',     content: 'SOL hitting new ATH soon, fundamentals are undeniable', time: '6h ago' },
            { author: 'Web3Warrior',  topic: 'Utility',    content: 'The future of Web3 identity is here', time: '3h ago' },
            { author: 'TokenTrader',  topic: 'Trends',     content: 'Top 5 tokens to watch this week', time: '5h ago' },
            { author: 'NFTCollector', topic: 'Lore',       content: 'The lore behind this collection runs deeper', time: '8h ago' }
        ];
        let searchPostsHarvested = false;

        function harvestPostsFromFeed() {
            if (searchPostsHarvested) return;
            const cards = document.querySelectorAll('.post-card, .profile-post-card, .feed-post-card');
            if (!cards.length) return;
            const h = [];
            cards.forEach(c => {
                const content = c.querySelector('.post-text, .profile-post-text')?.textContent?.trim() || '';
                const author  = c.querySelector('.post-username')?.textContent?.trim() || '';
                const topic   = c.querySelector('.post-topic-badge, .profile-post-topic')?.textContent?.trim() || '';
                const time    = c.querySelector('.post-time, .profile-post-time')?.textContent?.trim() || '';
                if (content) h.push({ author, topic, content, time });
            });
            if (h.length > 0) { searchPosts = h; searchPostsHarvested = true; }
        }

        var _searchDebounceTimer = null;

        function performSearch(inputId, resultsId) {
            const input      = document.getElementById(inputId);
            const query      = input.value.trim();
            const resultsDiv = document.getElementById(resultsId);
            const clearBtnId = inputId.replace('Search', 'SearchClearBtn');
            const clearBtn   = document.getElementById(clearBtnId);

            if (clearBtn) clearBtn.style.display = query ? 'block' : 'none';

            if (!query) {
                resultsDiv.style.display = 'none';
                resultsDiv.innerHTML = '';
                return;
            }

            clearTimeout(_searchDebounceTimer);
            resultsDiv.innerHTML = '<div class="search-no-results" style="padding:12px;text-align:center;color:var(--text-tertiary);">Searching...</div>';
            resultsDiv.style.display = 'block';

            _searchDebounceTimer = setTimeout(async function() {
                await _performSearchAsync(query, inputId, resultsId, clearBtnId, resultsDiv);
            }, 280);
        }

        async function _performSearchAsync(query, inputId, resultsId, clearBtnId, resultsDiv) {
            // Harvest real posts from the rendered feed
            harvestPostsFromFeed();

            // Real API user search
            var userMatches = [];
            try {
                var sData = await api('/users/search?q=' + encodeURIComponent(query) + '&limit=5');
                userMatches = (sData && sData.users) || [];
            } catch(e) {
                // API unavailable — fall back to filtering harvested feed data below
            }

            const lq = query.toLowerCase();
            // Real posts from feed (harvested from DOM / cached feedPosts array)
            const postMatches = searchPosts.filter(p =>
                (p.content || '').toLowerCase().includes(lq) ||
                (p.author  || '').toLowerCase().includes(lq) ||
                (p.topic   || '').toLowerCase().includes(lq)
            ).slice(0, 4);

            const topicPool = (typeof TOPICS !== 'undefined') ? TOPICS : [];
            const topicMatches = topicPool.filter(t => t.name.toLowerCase().includes(query));

            const total = userMatches.length + postMatches.length + topicMatches.length;

            if (total === 0) {
                resultsDiv.innerHTML = '<div class="search-no-results">No results for &ldquo;' + escapeHtml(query) + '&rdquo;</div>';
                resultsDiv.style.display = 'block';
                return;
            }

            let out = '';

            if (userMatches.length) {
                out += '<div class="search-section-label">Users</div>';
                out += userMatches.map(function(u) {
                    var ini   = (u.username || '?')[0].toUpperCase();
                    var vbdg  = (u.is_verified || u.verified) ? ' <span class="verified-badge" style="font-size:0.65em;padding:1px 6px;">&#10003;</span>' : '';
                    var pfp   = u.avatar_url ? ' style="background-image:url(' + u.avatar_url + ');background-size:cover;background-position:center;"' : '';
                    var flwrs = (u.followers_count || u.followers || 0).toLocaleString();
                    return '<div class="search-result-item" onclick="goToProfile(\'' + escapeHtml(u.username) + '\');clearSearch(\'' + inputId + '\',\'' + resultsId + '\',\'' + clearBtnId + '\')">'
                        + '<div class="search-result-user">'
                        + '<div class="search-result-avatar"' + pfp + '>' + (u.avatar_url ? '' : ini) + '</div>'
                        + '<div class="search-result-info">'
                        + '<div class="search-result-name">' + escapeHtml(u.username) + vbdg + '</div>'
                        + '<div class="search-result-meta">' + flwrs + ' followers</div>'
                        + '</div></div></div>';
                }).join('');
            }

            if (postMatches.length) {
                out += '<div class="search-section-label">Posts</div>';
                out += postMatches.map(p =>
                    '<div class="search-result-item">'
                    + '<div class="search-result-post">'
                    + '<div class="search-result-post-meta">'
                    + '<span class="search-result-author">@' + escapeHtml(p.author) + '</span>'
                    + '<span class="search-result-topic-badge">' + escapeHtml(p.topic) + '</span>'
                    + '<span class="search-result-time">' + escapeHtml(p.time) + '</span>'
                    + '</div>'
                    + '<div class="search-result-preview">' + escapeHtml(p.content) + '</div>'
                    + '</div></div>'
                ).join('');
            }

            if (topicMatches.length) {
                out += '<div class="search-section-label">Topics</div>';
                out += topicMatches.map(t =>
                    '<div class="search-result-item">'
                    + '<div class="search-result-user">'
                    + '<div class="search-topic-icon">' + t.symbol + '</div>'
                    + '<div class="search-result-info">'
                    + '<div class="search-result-name">' + escapeHtml(t.name) + '</div>'
                    + '<div class="search-result-meta">Browse ' + escapeHtml(t.name) + ' posts</div>'
                    + '</div></div></div>'
                ).join('');
            }

            resultsDiv.innerHTML = out;
            resultsDiv.style.display = 'block';
        }
        function clearSearch(inputId, resultsId, clearBtnId) {
            const input = document.getElementById(inputId);
            const resultsDiv = document.getElementById(resultsId);
            const clearBtn = document.getElementById(clearBtnId);

            input.value = '';
            resultsDiv.style.display = 'none';
            if (clearBtn) {
                clearBtn.style.display = 'none';
            }
        }

        // ── Track which user profile is being viewed ──────────────────────
        var _viewingUserId   = null;  // numeric id of user whose profile is shown
        var _viewingUsername = null;  // username

        // ── Navigate to a user's profile ──────────────────────────────────
        async function goToProfile(username) {
            ['followersModal','followingModal'].forEach(function(id) {
                var el = document.getElementById(id);
                if (el) el.style.display = 'none';
            });
            var notifPanel = document.getElementById('notificationsPanel');
            if (notifPanel) notifPanel.style.display = 'none';

            _viewingUsername = username || null;
            _viewingUserId   = null;
            switchScreen('profile');

            // Fetch real user data from API
            try {
                // Search for user by username to get their id
                var searchData = await api('/users/search?q=' + encodeURIComponent(username) + '&limit=1');
                var found = (searchData && searchData.users && searchData.users[0]);
                if (!found || found.username.toLowerCase() !== username.toLowerCase()) {
                    // Try direct numeric id if username is a number
                    if (!isNaN(username)) {
                        found = { id: parseInt(username) };
                    } else {
                        throw new Error('User not found');
                    }
                }
                _viewingUserId = found.id;
                var userData = await api('/users/' + found.id);
                _populateProfileCard(userData);
                // Load that user's posts
                loadProfilePosts(found.id, profileSortOrder);
            } catch(e) {
                // Best-effort: just navigate, show what we have
            }
        }

        function _populateProfileCard(u) {
            if (!u) return;
            _viewingUserId   = u.id;
            _viewingUsername = u.username;

            var el;
            el = document.getElementById('profileUsernameText');
            if (el) el.textContent = u.username || 'Unknown';

            el = document.getElementById('profileVerifiedBadge');
            if (el) el.style.display = u.is_verified ? 'inline' : 'none';

            el = document.getElementById('profileRankBadge');
            if (el) { if (u.rank) { el.textContent = '#' + u.rank + ' Top Earner'; el.style.display = 'block'; } else el.style.display = 'none'; }

            el = document.getElementById('profileFollowersCount');
            if (el) el.textContent = _fmtCount(u.followers_count || 0);
            el = document.getElementById('profileFollowingCount');
            if (el) el.textContent = _fmtCount(u.following_count || 0);
            el = document.getElementById('profilePostsCount');
            if (el) el.textContent = _fmtCount(u.posts_count || 0);

            el = document.getElementById('profileBioCompact');
            if (el) el.textContent = u.bio || '';

            var metaEl = document.getElementById('profileMetaCompact');
            var dateEl = document.getElementById('profileJoinDate');
            if (metaEl && dateEl && u.created_at) {
                var d = new Date(u.created_at);
                dateEl.textContent = 'Joined ' + d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
                metaEl.style.display = '';
            }

            var avEl = document.getElementById('profileAvatarCompact');
            if (avEl) {
                if (u.avatar_url) {
                    avEl.style.backgroundImage = 'url(' + u.avatar_url + ')';
                    avEl.style.backgroundSize = 'cover';
                    avEl.style.backgroundPosition = 'center';
                    avEl.textContent = '';
                } else {
                    avEl.style.backgroundImage = '';
                    avEl.textContent = u.username ? u.username[0].toUpperCase() : '?';
                }
            }
            var sAv = document.getElementById('settingsAvatar');
            if (sAv) sAv.textContent = u.username ? u.username[0].toUpperCase() : '?';

            var followBtn = document.getElementById('profileFollowBtn');
            if (followBtn) {
                var me = getStoredUser();
                var isMe = me && String(me.id) === String(u.id);
                followBtn.style.display = isMe ? 'none' : '';
                followBtn.dataset.userId = String(u.id);
                if (u.is_following) {
                    followBtn.classList.add('following');
                    followBtn.textContent = '\u2713 Following';
                } else {
                    followBtn.classList.remove('following');
                    followBtn.textContent = '+ Follow';
                }
            }

            // Populate settings form + referral link when viewing own profile
            var me2 = getStoredUser();
            if (me2 && String(me2.id) === String(u.id)) {
                _fillSettingsForm(u);
                var refInput = document.getElementById('referralLinkInput');
                if (refInput && u.username) refInput.value = 'https://whiteflag.app/ref/' + u.username;
            }
        }

        function _fillSettingsForm(u) {
            var el;
            el = document.getElementById('username');    if (el) el.value = u.username     || '';
            el = document.getElementById('displayName'); if (el) el.value = u.display_name || u.username || '';
            el = document.getElementById('bio');         if (el) el.value = u.bio          || '';
            el = document.getElementById('location');    if (el) el.value = u.location     || '';
            el = document.getElementById('website');     if (el) el.value = u.website      || '';
        }

        function _fmtCount(n) {
            if (n >= 1000000) return (n/1000000).toFixed(1) + 'M';
            if (n >= 1000) return (n/1000).toFixed(1) + 'k';
            return String(n);
        }

        // ── Filter users inside Followers / Following modals ──────────────
        function filterModalUsers(inputId, listId) {
            const query = document.getElementById(inputId).value.trim().toLowerCase();
            const list  = document.getElementById(listId);
            if (!list) return;
            const noResultsId = listId === 'followersList' ? 'followersNoResults' : 'followingNoResults';
            const noResults   = document.getElementById(noResultsId);
            let visible = 0;
            list.querySelectorAll('.user-list-item').forEach(item => {
                const name = (item.dataset.username || '').toLowerCase();
                const show = !query || name.includes(query);
                item.style.display = show ? '' : 'none';
                if (show) visible++;
            });
            if (noResults) noResults.style.display = (visible === 0 && query) ? 'block' : 'none';
        }

        // ── Chat room system (API-driven) ──────────────────────────────
        let activeChatRoomId = null;
        let activeChatRoomLabel = '';
        let _chatRoomsCache = [];
        let _chatTopicFilter = '';
        let _lastMessageTimestamp = null;

        const TOPIC_ICONS = {
            general: '&#128172;',
            solana: '&#9900;',
            'meme coins': '&#128021;',
            news: '&#128240;',
            trends: '&#128200;',
            lore: '&#128214;',
            utility: '&#9881;'
        };

        async function fetchChatRooms(topic) {
            try {
                var url = '/chat/rooms';
                if (topic) url += '?topic=' + encodeURIComponent(topic);
                var data = await api(url);
                return (data && data.rooms) || [];
            } catch(e) {
                console.error('Failed to fetch chat rooms:', e);
                return [];
            }
        }

        async function openChatRoomPicker() {
            var picker = document.getElementById('chatRoomPicker');
            if (!picker) return;
            picker.style.display = 'flex';
            await renderChatRoomList(_chatTopicFilter);
        }

        async function renderChatRoomList(topic) {
            var list = document.getElementById('chatRoomList');
            if (!list) return;
            list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-tertiary);">Loading rooms...</div>';

            var rooms = await fetchChatRooms(topic);
            _chatRoomsCache = rooms;

            if (!rooms.length) {
                list.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-tertiary);"><div style="font-size:1.5em;margin-bottom:6px;">&#128172;</div>No rooms found. Create one!</div>';
                return;
            }

            list.innerHTML = rooms.map(function(r) {
                var active = r.id === activeChatRoomId;
                var icon = TOPIC_ICONS[r.topic] || '&#128172;';
                var participants = parseInt(r.participant_count) || 0;
                var msgCount = parseInt(r.message_count) || 0;
                return '<div class="chat-room-pick-item" data-id="' + r.id + '" data-name="' + escapeHtml(r.name) + '" data-desc="' + escapeHtml(r.description || r.topic || '') + '" style="display:flex;align-items:center;gap:14px;padding:14px 20px;cursor:pointer;border-bottom:1px solid var(--border);transition:background 0.15s;">'
                    + '<div style="width:40px;height:40px;border-radius:50%;background:var(--bg-secondary);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:1.2em;flex-shrink:0;">' + icon + '</div>'
                    + '<div style="flex:1;min-width:0;">'
                    + '<div style="font-weight:700;font-size:0.93em;' + (active ? 'color:var(--primary);' : '') + '">' + escapeHtml(r.name) + (active ? ' &#10003;' : '') + '</div>'
                    + '<div style="font-size:0.8em;color:var(--text-tertiary);margin-top:2px;">' + escapeHtml(r.description || r.topic || 'General') + '</div>'
                    + '<div style="font-size:0.72em;color:var(--text-tertiary);margin-top:2px;">' + msgCount + ' messages</div>'
                    + '</div>'
                    + '<div style="font-size:0.78em;color:var(--text-tertiary);text-align:right;">&#128994; ' + participants + '</div>'
                    + '</div>';
            }).join('');

            list.onclick = function(e) {
                var item = e.target.closest('.chat-room-pick-item');
                if (item) switchChatRoom(parseInt(item.dataset.id), item.dataset.name, item.dataset.desc);
            };
            list.onmouseover = function(e) {
                var item = e.target.closest('.chat-room-pick-item');
                if (item) item.style.background = 'var(--bg-secondary)';
            };
            list.onmouseout = function(e) {
                var item = e.target.closest('.chat-room-pick-item');
                if (item) item.style.background = '';
            };
        }

        function filterChatRoomsByTopic(topic) {
            _chatTopicFilter = topic;
            // Update active button styles
            document.querySelectorAll('.chat-topic-btn').forEach(function(btn) {
                btn.style.background = 'var(--bg-secondary)';
                btn.style.color = 'var(--text-secondary)';
                btn.classList.remove('active');
            });
            var clickedBtn = event.target.closest('.chat-topic-btn');
            if (clickedBtn) {
                clickedBtn.style.background = 'var(--accent)';
                clickedBtn.style.color = '#fff';
                clickedBtn.classList.add('active');
            }
            renderChatRoomList(topic);
        }

        function closeChatRoomPicker() {
            var picker = document.getElementById('chatRoomPicker');
            if (picker) picker.style.display = 'none';
        }

        function switchChatRoom(id, name, desc) {
            activeChatRoomId    = id;
            activeChatRoomLabel = name;
            _lastMessageTimestamp = null;
            var nameEl = document.getElementById('activeChatRoomName');
            var descEl = document.getElementById('activeChatRoomDesc');
            if (nameEl) nameEl.innerHTML = escapeHtml(name) + ' <span style="font-size:0.7em;opacity:0.55;">&#9660;</span>';
            if (descEl) descEl.textContent = desc;
            closeChatRoomPicker();
            showToast('Switched to ' + name);

            // Join the room
            if (isLoggedIn) {
                api('/chat/rooms/' + id + '/join', { method: 'POST' }).catch(function() {});
            }

            loadChatRoomMessages(id);
            loadChatParticipantCount(id);
            startChatPolling(id);
        }

        async function loadChatParticipantCount(roomId) {
            try {
                var data = await api('/chat/rooms/' + roomId + '/participants');
                var countEl = document.getElementById('chatParticipantCount');
                if (countEl) countEl.textContent = (data && data.count) || 0;
            } catch(e) {}
        }

        // ── Create chat room ──────────────────────────────────────────────
        function openCreateChatRoomModal() {
            if (!isLoggedIn) { showToast('Connect your wallet first', 'error'); return; }
            closeChatRoomPicker();
            var modal = document.getElementById('createChatRoomModal');
            if (modal) modal.style.display = 'flex';
        }

        function closeCreateChatRoomModal() {
            var modal = document.getElementById('createChatRoomModal');
            if (modal) modal.style.display = 'none';
        }

        async function createChatRoom() {
            var nameInput = document.getElementById('newChatRoomName');
            var descInput = document.getElementById('newChatRoomDesc');
            var topicSelect = document.getElementById('newChatRoomTopic');
            var btn = document.getElementById('createChatRoomBtn');

            var name = nameInput ? nameInput.value.trim() : '';
            var desc = descInput ? descInput.value.trim() : '';
            var topic = topicSelect ? topicSelect.value : 'general';

            if (!name) { showToast('Room name is required', 'error'); return; }
            if (name.length > 100) { showToast('Room name too long (max 100)', 'error'); return; }

            if (btn) { btn.disabled = true; btn.textContent = 'Creating...'; }

            try {
                var room = await api('/chat/rooms', {
                    method: 'POST',
                    body: JSON.stringify({ name: name, description: desc, topic: topic })
                });
                showToast('Room "' + name + '" created!');
                closeCreateChatRoomModal();
                if (nameInput) nameInput.value = '';
                if (descInput) descInput.value = '';
                // Switch to the new room
                switchChatRoom(room.id, room.name, room.description || room.topic);
            } catch(e) {
                showToast('Failed to create room: ' + (e.message || ''), 'error');
            } finally {
                if (btn) { btn.disabled = false; btn.textContent = 'Create Room'; }
            }
        }

        // ── Compact chatroom send (for the chatroom screen) ───────────────
        function sendCompactChatMessage() {
            var input = document.getElementById('compactChatInput');
            var message = input ? input.value.trim() : '';
            if (!message) return;
            if (!isLoggedIn) { showToast('Connect your wallet to chat', 'error'); return; }
            if (!activeChatRoomId) { showToast('Select a chat room first', 'error'); return; }

            var storedUser = getStoredUser ? getStoredUser() : null;
            var myName = (storedUser && storedUser.username) || currentUser || 'You';
            var now = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

            var area = document.querySelector('.chat-messages-area');
            if (area) {
                var pfpStyle = USER_AVATARS[myName] ? ' style="background-image:url(' + USER_AVATARS[myName] + ');background-size:cover;background-position:center;"' : '';
                var initial  = USER_AVATARS[myName] ? '' : myName[0].toUpperCase();

                var replyActive = document.getElementById('chatReplyActive');
                var replyShown  = replyActive && replyActive.style.display !== 'none';
                var replyTo     = replyShown ? (replyActive.querySelector('.reply-active-username') || {}).textContent : null;
                var replyText   = replyShown ? (replyActive.querySelector('.reply-active-text')     || {}).textContent : null;
                var replyHtml   = replyTo ? '<div class="msg-reply-mini"><span class="reply-icon-mini">&#8617;</span><span class="reply-to-mini">' + escapeHtml(replyTo) + ':</span><span class="reply-text-mini">' + escapeHtml((replyText || '').substring(0, 30)) + '&hellip;</span></div>' : '';

                var msgDiv = document.createElement('div');
                msgDiv.className = 'chat-msg-compact';
                msgDiv.innerHTML = '<div class="msg-avatar-mini" data-avatar-user="' + myName + '"' + pfpStyle + '>' + initial + '</div>'
                    + '<div class="msg-content-compact">'
                    + '<div class="msg-header-compact">'
                    + '<span class="msg-username username-link" data-profile-user="' + myName + '">' + escapeHtml(myName) + '</span>'
                    + '<span class="msg-time">' + now + '</span>'
                    + '</div>'
                    + replyHtml
                    + '<div class="msg-text">' + escapeHtml(message) + '</div>'
                    + '</div>';
                area.appendChild(msgDiv);
                area.scrollTop = area.scrollHeight;
            }

            input.value = '';
            if (typeof cancelReply === 'function') cancelReply();

            api('/chat/rooms/' + activeChatRoomId + '/messages', {
                method: 'POST',
                body: JSON.stringify({ content: message })
            }).catch(function() {});
        }

        // ── Load chat room messages from API ─────────────────────────────
        var _chatPollingTimer = null;

        function renderChatMessage(m) {
            var name    = escapeHtml(m.username || 'Unknown');
            var initial = (m.username || '?')[0].toUpperCase();
            var pfp     = m.avatar_url
                ? ' style="background-image:url(' + m.avatar_url + ');background-size:cover;background-position:center;"'
                : '';
            var verified = m.is_verified
                ? '<span class="verified-mini">&#10003;</span>' : '';
            var time = new Date(m.created_at).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
            return '<div class="chat-msg-compact" data-msg-id="' + m.id + '">'
                + '<div class="msg-avatar-mini" data-avatar-user="' + name + '"' + pfp + '>' + (m.avatar_url ? '' : initial) + '</div>'
                + '<div class="msg-content-compact">'
                + '<div class="msg-header-compact">'
                + '<span class="msg-username username-link" data-profile-user="' + name + '">' + name + '</span>'
                + verified
                + '<span class="msg-time">' + time + '</span>'
                + '</div>'
                + '<div class="msg-text">' + escapeHtml(m.content || '') + '</div>'
                + '</div>'
                + '<button class="msg-reply-btn" data-reply-user="' + name + '" data-reply-text="' + escapeHtml((m.content||'').substring(0,40)) + '" onclick="showReplyPreview(this.dataset.replyUser,this.dataset.replyText)">'
                + '<span class="reply-btn-icon">&#8617;</span></button>'
                + '</div>';
        }

        async function loadChatRoomMessages(roomId) {
            var area = document.querySelector('.chat-messages-area');
            if (!area) return;
            roomId = roomId || activeChatRoomId;

            if (!roomId) {
                // No room selected — auto-load first available room
                var rooms = await fetchChatRooms('');
                if (rooms.length) {
                    switchChatRoom(rooms[0].id, rooms[0].name, rooms[0].description || rooms[0].topic || 'General');
                    return;
                } else {
                    area.innerHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:40px;"><div style="font-size:2em;margin-bottom:8px;">&#128172;</div><div>No chat rooms yet. Create one to get started!</div></div>';
                    return;
                }
            }

            try {
                var data = await api('/chat/rooms/' + roomId + '/messages?limit=50');
                var msgs = (data && data.messages) || [];
                if (!msgs.length) {
                    area.innerHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:40px;"><div style="font-size:2em;margin-bottom:8px;">&#128172;</div><div>No messages yet. Be the first to say something!</div></div>';
                    _lastMessageTimestamp = null;
                    return;
                }
                area.innerHTML = msgs.map(renderChatMessage).join('');
                area.scrollTop = area.scrollHeight;
                // Store the timestamp of the latest message for polling
                _lastMessageTimestamp = msgs[msgs.length - 1].created_at;
            } catch(e) {
                // Keep existing content on failure
            }
        }

        async function pollNewChatMessages(roomId) {
            if (!_lastMessageTimestamp || !roomId) return;
            var area = document.querySelector('.chat-messages-area');
            if (!area) return;
            try {
                var data = await api('/chat/rooms/' + roomId + '/messages?after=' + encodeURIComponent(_lastMessageTimestamp));
                var msgs = (data && data.messages) || [];
                if (!msgs.length) return;

                // Filter out messages we already rendered (e.g. our own optimistic adds)
                var existingIds = new Set();
                area.querySelectorAll('[data-msg-id]').forEach(function(el) {
                    existingIds.add(el.dataset.msgId);
                });

                var newHtml = '';
                msgs.forEach(function(m) {
                    if (!existingIds.has(String(m.id))) {
                        newHtml += renderChatMessage(m);
                    }
                });

                if (newHtml) {
                    var wasAtBottom = (area.scrollTop + area.clientHeight >= area.scrollHeight - 50);
                    area.insertAdjacentHTML('beforeend', newHtml);
                    // Remove the "no messages" placeholder if present
                    var placeholder = area.querySelector('[style*="text-align:center"]');
                    if (placeholder && area.querySelectorAll('.chat-msg-compact').length > 0) {
                        placeholder.remove();
                    }
                    if (wasAtBottom) area.scrollTop = area.scrollHeight;
                }

                _lastMessageTimestamp = msgs[msgs.length - 1].created_at;
            } catch(e) {}
        }

        function startChatPolling(roomId) {
            if (_chatPollingTimer) clearInterval(_chatPollingTimer);
            _chatPollingTimer = setInterval(function() {
                pollNewChatMessages(roomId || activeChatRoomId);
            }, 5000); // poll every 5s for near real-time
        }

        // ── Load active voice rooms from API ──────────────────────────────
        var _activeVoiceRoomId = null;

        async function loadVoiceRooms() {
            var headerEl = document.getElementById('voiceRoomHeader');
            var stageEl  = document.getElementById('voiceStageContainer');
            var otherEl  = document.getElementById('otherVoiceRoomsList');
            try {
                var data  = await api('/voice/rooms');
                var rooms = (data && data.rooms) || [];

                if (!rooms.length) {
                    if (headerEl) headerEl.style.display = 'none';
                    if (stageEl)  stageEl.innerHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:40px;"><div style="font-size:2em;margin-bottom:8px;">\uD83C\uDFA4</div><div>No active voice rooms yet. Create one above!</div></div>';
                    if (otherEl)  otherEl.innerHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:16px;font-size:0.9em;">No other rooms active.</div>';
                    return;
                }

                var primary = rooms[0];
                _activeVoiceRoomId = primary.id;

                // Header
                if (headerEl) {
                    headerEl.style.display = '';
                    var ht = document.getElementById('voiceRoomHeaderTitle');
                    var hh = document.getElementById('voiceRoomHostName');
                    var hc = document.getElementById('voiceRoomListenerCount');
                    if (ht) ht.textContent = '\uD83C\uDFA4 ' + primary.title;
                    if (hh) { hh.textContent = primary.host_username; hh.onclick = function() { goToProfile(primary.host_username); }; }
                    if (hc) hc.textContent = '\uD83D\uDFE2 LIVE \u2022 ' + (primary.participant_count || 0) + ' listening';
                }

                // Stage: speakers + listeners
                if (stageEl) {
                    stageEl.innerHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:20px;font-size:0.85em;">Loading participants...</div>';
                    try {
                        var pd   = await api('/voice/rooms/' + primary.id + '/participants');
                        var spks = (pd && pd.speakers)  || [];
                        var lstn = (pd && pd.listeners) || [];
                        var sh = '';
                        sh += '<div class="stage-section"><div class="section-label">\uD83C\uDFA4 On Stage (' + spks.length + ')</div><div class="speakers-grid">';
                        spks.forEach(function(p) {
                            var ini = (p.username || '?')[0].toUpperCase();
                            var isH = (p.user_id === primary.host_id);
                            var pfp = p.avatar_url ? ' style="background-image:url(' + p.avatar_url + ');background-size:cover;background-position:center;"' : '';
                            sh += '<div class="speaker-card' + (isH ? ' host' : '') + '">'
                                + '<div class="speaker-avatar"' + pfp + '>' + (p.avatar_url ? '' : ini) + '</div>'
                                + '<div class="speaker-info">'
                                + '<div class="speaker-name username-link" onclick="goToProfile(\'' + escapeHtml(p.username || '') + '\')">' + escapeHtml(p.username || '') + '</div>'
                                + '<div class="speaker-badge">' + (isH ? 'HOST' : 'SPEAKER') + '</div>'
                                + '</div>'
                                + '<div class="audio-indicator' + (isH ? ' active' : '') + '"><span class="audio-wave"></span><span class="audio-wave"></span><span class="audio-wave"></span></div>'
                                + '</div>';
                        });
                        if (!spks.length) sh += '<div style="color:var(--text-tertiary);font-size:0.85em;padding:10px;">No speakers yet.</div>';
                        sh += '</div></div>';
                        if (lstn.length) {
                            sh += '<div class="stage-section"><div class="section-label">\uD83D\uDC65 Listeners (' + lstn.length + ')</div><div class="listeners-grid">';
                            lstn.slice(0, 12).forEach(function(p) {
                                var ini = (p.username || '?')[0].toUpperCase();
                                var pfp = p.avatar_url ? ' style="background-image:url(' + p.avatar_url + ');background-size:cover;background-position:center;"' : '';
                                sh += '<div class="listener-card">'
                                    + '<div class="listener-avatar"' + pfp + '>' + (p.avatar_url ? '' : ini) + '</div>'
                                    + '<div class="listener-name username-link" onclick="goToProfile(\'' + escapeHtml(p.username || '') + '\')">' + escapeHtml(p.username || '') + '</div>'
                                    + '</div>';
                            });
                            if (lstn.length > 12) sh += '<div class="listener-card"><div class="listener-avatar">+</div><div class="listener-name">+' + (lstn.length - 12) + ' more</div></div>';
                            sh += '</div></div>';
                        }
                        stageEl.innerHTML = sh;
                    } catch (pe) {
                        stageEl.innerHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:20px;font-size:0.85em;">Could not load participants.</div>';
                    }
                }

                // Other rooms
                if (otherEl) {
                    var others = rooms.slice(1);
                    otherEl.innerHTML = !others.length
                        ? '<div style="text-align:center;color:var(--text-tertiary);padding:16px;font-size:0.9em;">No other rooms active.</div>'
                        : others.map(function(r) {
                            return '<div class="space-item">'
                                + '<div class="space-item-info">'
                                + '<div class="space-item-title">\uD83C\uDFA4 ' + escapeHtml(r.title) + '</div>'
                                + '<div class="space-item-host">Hosted by ' + escapeHtml(r.host_username) + ' \u2022 ' + (r.participant_count || 0) + ' listening</div>'
                                + '</div>'
                                + '<button class="join-space-btn" onclick="joinVoiceChat(' + r.id + ')">Join</button>'
                                + '</div>';
                          }).join('');
                }
            } catch (e) {
                console.warn('[loadVoiceRooms]', e.message);
                if (stageEl) stageEl.innerHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:40px;"><div style="font-size:2em;margin-bottom:8px;">\uD83C\uDFA4</div><div>Could not load voice rooms.</div></div>';
            }
        }

        // Close search results when clicking outside
        document.addEventListener('click', function(e) {
            const searchContainers = document.querySelectorAll('.search-container');
            searchContainers.forEach(container => {
                if (container && !container.contains(e.target)) {
                    const resultsDiv = container.querySelector('.search-results');
                    if (resultsDiv) {
                        resultsDiv.style.display = 'none';
                    }
                }
            });
            // Handle clicks on dynamically-created profile links (data-profile-user)
            const profileTarget = e.target.closest('[data-profile-user]');
            if (profileTarget) {
                const username = profileTarget.dataset.profileUser;
                if (username && typeof goToProfile === 'function') goToProfile(username);
            }
            // Handle clicks on DM search results (data-dm-user)
            const dmTarget = e.target.closest('[data-dm-user]');
            if (dmTarget) {
                const username = dmTarget.dataset.dmUser;
                const userId   = dmTarget.dataset.dmUid || null;
                if (username) {
                    closeMessageSearch();
                    openConversation(username, userId);
                }
            }
        });

        // Privacy lock toggle functionality
        let isPrivateAccount = false;

        function togglePrivacyLock() {
            var lockToggle = document.getElementById('privacyLockToggle');
            if (!lockToggle) return;
            var lockIcon  = lockToggle.querySelector('.lock-icon');
            var lockLabel = lockToggle.querySelector('.lock-label');

            isPrivateAccount = !isPrivateAccount;

            if (isPrivateAccount) {
                if (lockIcon)  lockIcon.textContent  = '&#x1F512;';
                if (lockLabel) lockLabel.textContent  = 'Private Account';
                lockToggle.classList.add('locked');
                showToast('&#x1F512; Account set to Private');
            } else {
                if (lockIcon)  lockIcon.textContent  = '&#x1F513;';
                if (lockLabel) lockLabel.textContent  = 'Public Account';
                lockToggle.classList.remove('locked');
                showToast('&#x1F513; Account set to Public');
            }

            // Persist to server
            if (isLoggedIn) {
                api('/users/profile', {
                    method: 'PUT',
                    body: JSON.stringify({ isPrivate: isPrivateAccount })
                }).catch(function() {});
            }
        }

// ── GIF Picker ────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════
        // GIF PICKER — Tenor API v2
        // ═══════════════════════════════════════════════════════

        const TENOR_KEY   = 'AIzaSyDNzNQWxCdMVm1uexJFyE-JKcZVIz5pNZY'; // public demo key
        const TENOR_BASE  = 'https://tenor.googleapis.com/v2';
        const GIF_LIMIT   = 24;

        const gifPickerState = {
            context: null,   // 'post' | 'comment:postId' | 'reply:commentId'
            query: '',
            category: '',
            debounceTimer: null,
            pendingGifs: {},  // key → gifUrl for unsubmitted picks
        };

        const GIF_CATS = [
            { label: '🔥 Trending', q: '' },
            { label: '😂 Reaction', q: 'reaction' },
            { label: '🚀 Moon',     q: 'moon crypto' },
            { label: '💎 Diamond',  q: 'diamond hands' },
            { label: '🐻 Bear',     q: 'bear market' },
            { label: '🐂 Bull',     q: 'bull run' },
            { label: '🤣 Meme',     q: 'meme funny' },
            { label: '🎉 Hype',     q: 'hype celebration' },
            { label: '😤 Wen',      q: 'wen lambo' },
            { label: '🙈 Oops',     q: 'oops mistake' },
        ];

        function openGifPicker(context) {
            gifPickerState.context = context;
            document.getElementById('gifPickerOverlay').style.display = 'flex';
            document.getElementById('gifSearchInput').value = '';
            gifPickerState.query = '';
            gifPickerState.category = '';
            renderGifCategories();
            fetchGifs('');
        }

        function closeGifPicker() {
            document.getElementById('gifPickerOverlay').style.display = 'none';
        }

        function renderGifCategories() {
            const wrap = document.getElementById('gifCategories');
            wrap.innerHTML = GIF_CATS.map((c, i) => `
                <button class="gif-cat-btn ${i === 0 ? 'active' : ''}"
                        onclick="selectGifCategory(this, '${c.q}')">${c.label}</button>
            `).join('');
        }

        function selectGifCategory(btn, q) {
            document.querySelectorAll('.gif-cat-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('gifSearchInput').value = q;
            gifPickerState.query = q;
            fetchGifs(q);
        }

        function gifSearchDebounced(val) {
            clearTimeout(gifPickerState.debounceTimer);
            gifPickerState.debounceTimer = setTimeout(() => {
                fetchGifs(val.trim());
                // Deactivate category buttons when typing
                document.querySelectorAll('.gif-cat-btn').forEach(b => b.classList.remove('active'));
            }, 380);
        }

        async function fetchGifs(query) {
            const wrap = document.getElementById('gifGridWrap');
            wrap.innerHTML = `<div class="gif-status"><div class="gif-spinner"></div>Loading...</div>`;
            try {
                const endpoint = query
                    ? `${TENOR_BASE}/search?q=${encodeURIComponent(query)}&key=${TENOR_KEY}&limit=${GIF_LIMIT}&media_filter=gif,tinygif`
                    : `${TENOR_BASE}/featured?key=${TENOR_KEY}&limit=${GIF_LIMIT}&media_filter=gif,tinygif`;

                const res  = await fetch(endpoint);
                const data = await res.json();
                renderGifGrid(data.results || []);
            } catch (err) {
                wrap.innerHTML = `<div class="gif-status">⚠️ Couldn't load GIFs.<br><small>Check your connection and try again.</small></div>`;
            }
        }

        function renderGifGrid(results) {
            const wrap = document.getElementById('gifGridWrap');
            if (!results.length) {
                wrap.innerHTML = `<div class="gif-status">No GIFs found 😢<br><small>Try a different search</small></div>`;
                return;
            }
            wrap.innerHTML = `<div class="gif-grid">${
                results.map(r => {
                    const tiny  = r.media_formats?.tinygif?.url || r.media_formats?.gif?.url || '';
                    const full  = r.media_formats?.gif?.url || tiny;
                    const title = (r.title || 'GIF').replace(/"/g, '&quot;');
                    return `<div class="gif-item" onclick="selectGif('${full}', '${tiny}')" title="${title}">
                        <img src="${tiny}" alt="${title}" loading="lazy" />
                    </div>`;
                }).join('')
            }</div>`;
        }

        function selectGif(fullUrl, tinyUrl) {
            const ctx = gifPickerState.context;
            closeGifPicker();

            if (ctx === 'post') {
                // Show GIF in post media preview
                currentMedia     = fullUrl;
                currentMediaType = 'gif';
                const preview = document.getElementById('mediaPreview');
                preview.classList.add('active');
                preview.innerHTML = `
                    <div class="preview-container">
                        <img src="${tinyUrl}" class="preview-image" alt="GIF Preview" style="border-radius:10px;" />
                        <button class="remove-media-btn" onclick="removeMedia()">×</button>
                    </div>`;
                return;
            }

            // Store URL keyed by context and show inline preview
            gifPickerState.pendingGifs[ctx] = fullUrl;
            const previewEl = document.getElementById(`gifPreview_${ctx}`);
            if (previewEl) {
                previewEl.src = tinyUrl;
                previewEl.classList.add('active');
                previewEl.title = 'Click to remove GIF';
            }
        }

        function clearCommentGif(ctx) {
            gifPickerState.pendingGifs[ctx] = null;
            const previewEl = document.getElementById(`gifPreview_${ctx}`);
            if (previewEl) {
                previewEl.src = '';
                previewEl.classList.remove('active');
            }
        }

        // Keyboard shortcut — Esc closes picker
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && document.getElementById('gifPickerOverlay').style.display !== 'none') {
                closeGifPicker();
            }
        });
