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
