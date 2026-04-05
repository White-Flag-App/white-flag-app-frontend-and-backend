        // ══════════════════════════════════════════════════════════
        // BACKEND API CONFIGURATION
        // Central configuration for all API calls
        // ══════════════════════════════════════════════════════════

        // Use relative path so it works in both local dev and production (Render)
        const API_BASE = '/api';

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
            isLoggedIn = true;
            walletConnected = true;
            isVerified = user.isVerified || false;
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
                currentUser = user.username || (walletAddress ? walletAddress.substring(0, 8) : '');
                walletProvider = localStorage.getItem('wf_wallet_provider') || '';
                document.addEventListener('DOMContentLoaded', () => {
                    if (typeof updateWalletButton === 'function') updateWalletButton();
                    // Re-show mandatory profile setup modal if incomplete
                    if (localStorage.getItem('wf_profile_incomplete') === '1' || !user.isProfileComplete) {
                        var modal = document.getElementById('profileSetupModal');
                        if (modal) {
                            var addrDisplay = document.getElementById('setupWalletAddr');
                            if (addrDisplay) addrDisplay.textContent = walletAddress.substring(0, 6) + '...' + walletAddress.substring(walletAddress.length - 4);
                            modal.style.display = 'flex';
                        }
                    }
                });
            }
        })();

        // ══════════════════════════════════════════════════════════
        // API HELPER FUNCTIONS
        // Centralized API communication
        // ══════════════════════════════════════════════════════════

        // ══════════════════════════════════════════════════════════
        // BOOKMARKS FUNCTIONALITY
        // Save and manage bookmarked posts (API-driven)
        // ══════════════════════════════════════════════════════════

        let _bookmarkSort = 'recent';

        /**
         * Toggle bookmark status for a post
         */
        function toggleBookmark(button) {
            if (!isLoggedIn) { showToast('Connect wallet to bookmark', 'error'); return; }
            var postId = button.dataset.postId;
            if (!postId) return;

            var wasActive = button.classList.contains('active');

            // Optimistic UI
            button.classList.toggle('active');

            if (wasActive) {
                // Remove bookmark
                api('/bookmarks/' + postId, { method: 'DELETE' }).then(function() {
                    showToast('Bookmark removed');
                    if (document.getElementById('bookmarks')?.classList.contains('active')) loadBookmarks();
                }).catch(function() {
                    button.classList.add('active'); // revert
                    showToast('Failed to remove bookmark', 'error');
                });
            } else {
                // Add bookmark
                api('/bookmarks', { method: 'POST', body: JSON.stringify({ postId: parseInt(postId) }) }).then(function() {
                    showToast('Post bookmarked! 🔖');
                    if (document.getElementById('bookmarks')?.classList.contains('active')) loadBookmarks();
                }).catch(function(err) {
                    button.classList.remove('active'); // revert
                    if (err.message && err.message.includes('already')) {
                        showToast('Already bookmarked');
                    } else {
                        showToast('Failed to bookmark', 'error');
                    }
                });
            }
        }

        // Bookmark toggle from dropdown menu items
        function dropdownToggleBookmark(el) {
            if (!isLoggedIn) { showToast('Connect wallet to bookmark', 'error'); return; }
            var card = el.closest('.profile-post-card') || el.closest('.post-card');
            if (!card) return;
            var postId = el.dataset.postId || (card && card.dataset.postId);
            if (!postId) return;

            var label = el.querySelector('span') ? el.textContent.trim() : el.textContent.trim();
            var isBookmarked = label.includes('Remove');

            hideAllDropdowns();

            if (isBookmarked) {
                api('/bookmarks/' + postId, { method: 'DELETE' }).then(function() {
                    showToast('Bookmark removed');
                    // Also update the action bar button if present
                    var actionBtn = card.querySelector('.action-btn.bookmark-btn');
                    if (actionBtn) actionBtn.classList.remove('active');
                    if (document.getElementById('bookmarks')?.classList.contains('active')) loadBookmarks();
                }).catch(function() {
                    showToast('Failed to remove bookmark', 'error');
                });
            } else {
                api('/bookmarks', { method: 'POST', body: JSON.stringify({ postId: parseInt(postId) }) }).then(function() {
                    showToast('Post bookmarked! \uD83D\uDD16');
                    var actionBtn = card.querySelector('.action-btn.bookmark-btn');
                    if (actionBtn) actionBtn.classList.add('active');
                    if (document.getElementById('bookmarks')?.classList.contains('active')) loadBookmarks();
                }).catch(function(err) {
                    if (err.message && err.message.includes('already')) {
                        showToast('Already bookmarked');
                    } else {
                        showToast('Failed to bookmark', 'error');
                    }
                });
            }
        }

        /**
         * Load bookmarks from API and render using renderPostCard
         */
        async function loadBookmarks() {
            var container = document.getElementById('bookmarkedPostsList');
            var emptyState = document.getElementById('bookmarksEmptyState');
            if (!container) return;

            if (!isLoggedIn) {
                if (emptyState) emptyState.style.display = 'block';
                return;
            }

            container.innerHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:40px;">Loading bookmarks...</div>';

            try {
                var data = await api('/bookmarks');
                var posts = data.bookmarks || [];

                if (!posts.length) {
                    container.innerHTML = '';
                    if (emptyState) emptyState.style.display = 'block';
                    return;
                }

                if (emptyState) emptyState.style.display = 'none';

                // Sort
                if (_bookmarkSort === 'oldest') {
                    posts.sort(function(a, b) { return new Date(a.bookmarked_at) - new Date(b.bookmarked_at); });
                } else {
                    posts.sort(function(a, b) { return new Date(b.bookmarked_at) - new Date(a.bookmarked_at); });
                }

                // Mark all as bookmarked for rendering
                posts.forEach(function(p) { p.user_bookmarked = true; });

                container.innerHTML = posts.map(function(p) {
                    return renderPostCard(p);
                }).join('');
            } catch (err) {
                console.error('Load bookmarks error:', err);
                container.innerHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:40px;">Failed to load bookmarks</div>';
            }
        }

        /**
         * Remove a specific bookmark
         */
        function removeBookmark(postId) {
            if (!isLoggedIn) return;
            api('/bookmarks/' + postId, { method: 'DELETE' }).then(function() {
                showToast('Bookmark removed');
                loadBookmarks();
            }).catch(function() {
                showToast('Failed to remove bookmark', 'error');
            });
        }

        /**
         * Sort bookmarks
         */
        function sortBookmarks(type) {
            _bookmarkSort = type || 'recent';
            // Update active button
            document.querySelectorAll('#bookmarks .post-sort-btn').forEach(function(btn) {
                btn.classList.remove('active');
                if (btn.textContent.trim().toLowerCase().includes(type === 'oldest' ? 'oldest' : 'recent')) {
                    btn.classList.add('active');
                }
            });
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
                alert('Copy link: ' + text);
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
        // NOTE: profile loading is NOT done here — goToProfile() and loadMyProfile()
        // handle it themselves to avoid overriding another user's profile
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
