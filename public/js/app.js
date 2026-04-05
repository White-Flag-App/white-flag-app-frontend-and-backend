        let currentMedia = null;
        let currentMediaType = null;
        let currentMediaFiles = []; // actual File objects for upload (max 4)
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
        let currentUser = '';
        let selectedTopic = null;
        let isDarkMode = true;

        // Wallet Connection State
        let walletConnected = false;
        let walletAddress = '';
        let walletProvider = ''; // phantom, solflare, backpack, metamask
        let isVerified = false;
        let _activeWalletProvider = null; // reference to the live wallet provider object

        // ══════════════════════════════════════════════════════════
        // REAL WALLET CONNECTION — Solana + EVM (ethers.js)
        // No mocks, no demo addresses. Connects to real browser wallets.
        // ══════════════════════════════════════════════════════════

        // ── Wallet provider detection helpers ──────────────────────
        function _getSolanaProvider(name) {
            switch (name) {
                case 'Phantom':   return window.phantom?.solana || (window.solana?.isPhantom ? window.solana : null);
                case 'Solflare':  return window.solflare || (window.solana?.isSolflare ? window.solana : null);
                case 'Backpack':  return window.backpack || (window.xnft?.solana);
                default:          return null;
            }
        }

        function _getEvmProvider() {
            return window.ethereum || null;
        }

        function _detectInstalledWallets() {
            const wallets = [];
            if (_getSolanaProvider('Phantom'))  wallets.push({ name: 'Phantom',   icon: '👻', chain: 'solana',  desc: 'Solana wallet' });
            if (_getSolanaProvider('Solflare')) wallets.push({ name: 'Solflare',  icon: '🔥', chain: 'solana',  desc: 'Solana wallet' });
            if (_getSolanaProvider('Backpack')) wallets.push({ name: 'Backpack',  icon: '🎒', chain: 'solana',  desc: 'Solana wallet' });
            if (_getEvmProvider())             wallets.push({ name: 'MetaMask',  icon: '🦊', chain: 'evm',     desc: 'EVM wallet (Ethereum, Polygon, etc.)' });
            return wallets;
        }

        // ── Wallet modal ───────────────────────────────────────────
        function handleWalletConnection() {
            if (walletConnected) {
                showWalletInfo();
            } else {
                openWalletModal();
            }
        }

        function openWalletModal() {
            const modal = document.getElementById('walletModal');
            const optionsContainer = document.getElementById('walletOptionsContainer');

            // Detect installed wallets and render options dynamically
            const installed = _detectInstalledWallets();

            let html = '';
            if (installed.length > 0) {
                installed.forEach(w => {
                    html += `<button class="wallet-option-card" onclick="connectWallet('${w.name}')">
                        <div class="wallet-option-icon">${w.icon}</div>
                        <div class="wallet-option-info">
                            <div class="wallet-option-name">${w.name}</div>
                            <div class="wallet-option-desc">${w.desc}</div>
                        </div>
                        <div class="wallet-option-arrow">→</div>
                    </button>`;
                });
            } else {
                html = `<div style="text-align:center;padding:30px 10px;color:var(--text-secondary);">
                    <div style="font-size:2.5em;margin-bottom:12px;">🔍</div>
                    <div style="font-weight:700;margin-bottom:6px;">No Wallet Detected</div>
                    <div style="font-size:0.9em;">Install a browser wallet extension to continue.</div>
                </div>`;
            }
            optionsContainer.innerHTML = html;
            modal.style.display = 'flex';
        }

        function closeWalletModal() {
            document.getElementById('walletModal').style.display = 'none';
        }

        // ── Shortcut functions (called from legacy onclick attrs) ──
        function connectPhantom()  { connectWallet('Phantom'); }
        function connectSolflare() { connectWallet('Solflare'); }
        function connectBackpack() { connectWallet('Backpack'); }

        // ── Main wallet connection flow ────────────────────────────
        async function connectWallet(providerName) {
            closeWalletModal();
            showToast(`Connecting to ${providerName}…`);

            try {
                if (providerName === 'MetaMask') {
                    await _connectEvm();
                } else {
                    await _connectSolana(providerName);
                }
            } catch (err) {
                console.error('[connectWallet]', err);
                const msg = err.message || String(err);
                if (msg.includes('rejected') || msg.includes('denied') || msg.includes('cancelled')) {
                    showToast('Connection cancelled by user', 'error');
                } else {
                    showToast('Wallet connection failed — ' + msg, 'error');
                }
            }
        }

        // ── Backend authentication helper ──────────────────────────
        // 1. Get nonce from server
        // 2. Sign nonce message with wallet  
        // 3. Send signature to server for verification
        // 4. Server returns JWT + user data + isNewUser flag
        async function _authenticateWithBackend(address, chain, signFn) {
            // Step 1: Request nonce
            const nonceData = await api(`/auth/nonce/${address}?chain=${chain}`);
            const { message } = nonceData;

            // Step 2: Sign the message with the wallet
            const signature = await signFn(message);

            // Step 3: Verify with backend (include referrer if present)
            var referrer = getReferrerFromUrl();
            var authBody = { walletAddress: address, signature, chain };
            if (referrer) authBody.referrerId = referrer;
            const authResult = await api('/auth/verify', {
                method: 'POST',
                body: JSON.stringify(authBody)
            });

            // Step 4: Save auth token + user data
            saveAuth(authResult.token, {
                ...authResult.user,
                walletAddress: address
            });

            return authResult;
        }

        // ── Solana wallet connection (Phantom / Solflare / Backpack) ──
        async function _connectSolana(providerName) {
            const provider = _getSolanaProvider(providerName);
            if (!provider) {
                showToast(`${providerName} not found — please install the extension`, 'error');
                return;
            }

            // Request connection — opens the real wallet popup
            const resp = await provider.connect();
            const pubKey = resp.publicKey.toString();

            // Authenticate with backend (nonce → sign → verify)
            const authResult = await _authenticateWithBackend(pubKey, 'solana', async (message) => {
                const encodedMsg = new TextEncoder().encode(message);
                const signResult = await provider.signMessage(encodedMsg, 'utf8');
                // Return raw bytes as hex for transport
                const sigBytes = signResult.signature || signResult;
                return Array.from(sigBytes).map(b => b.toString(16).padStart(2, '0')).join('');
            });

            // Set local connection state
            walletAddress = pubKey;
            walletProvider = providerName;
            walletConnected = true;
            isLoggedIn = true;
            _activeWalletProvider = provider;
            currentUser = authResult.user.username || pubKey.substring(0, 8);

            // Store wallet session info
            localStorage.setItem('wf_wallet_address', pubKey);
            localStorage.setItem('wf_wallet_provider', providerName);
            localStorage.setItem('wf_wallet_chain', 'solana');
            localStorage.setItem('wf_wallet_connected', 'true');

            updateWalletButton();
            showToast(`✅ ${providerName} connected!`);
            console.log('[Wallet] Authenticated:', { provider: providerName, address: pubKey, isNew: authResult.isNewUser });

            // If new user, show profile setup modal
            if (authResult.isNewUser) {
                _showProfileSetup(pubKey);
            }

            // Listen for disconnect events
            if (provider.on) {
                provider.on('disconnect', () => {
                    console.log('[Wallet] Disconnected by wallet');
                    disconnectWallet();
                });
                provider.on('accountChanged', (newPubKey) => {
                    if (newPubKey) {
                        // Account changed — need to re-authenticate
                        disconnectWallet();
                        showToast('Wallet account changed — please reconnect');
                    } else {
                        disconnectWallet();
                    }
                });
            }
        }

        // ── EVM wallet connection (MetaMask / injected) via ethers.js ──
        async function _connectEvm() {
            const ethereum = _getEvmProvider();
            if (!ethereum) {
                showToast('No EVM wallet found — please install MetaMask', 'error');
                return;
            }

            const provider = new ethers.BrowserProvider(ethereum);
            const accounts = await provider.send('eth_requestAccounts', []);
            if (!accounts || accounts.length === 0) throw new Error('No accounts returned');

            const signer = await provider.getSigner();
            const address = await signer.getAddress();

            // Authenticate with backend (nonce → sign → verify)
            const authResult = await _authenticateWithBackend(address, 'evm', async (message) => {
                return await signer.signMessage(message);
            });

            // Set local connection state
            walletAddress = address;
            walletProvider = 'MetaMask';
            walletConnected = true;
            isLoggedIn = true;
            _activeWalletProvider = ethereum;
            currentUser = authResult.user.username || address.substring(0, 8);

            // Store wallet session info
            localStorage.setItem('wf_wallet_address', address);
            localStorage.setItem('wf_wallet_provider', 'MetaMask');
            localStorage.setItem('wf_wallet_chain', 'evm');
            localStorage.setItem('wf_wallet_connected', 'true');

            updateWalletButton();
            showToast('✅ MetaMask connected!');
            console.log('[Wallet] Authenticated:', { provider: 'MetaMask', address, isNew: authResult.isNewUser });

            // If new user, show profile setup modal
            if (authResult.isNewUser) {
                _showProfileSetup(address);
            }

            // Listen for account/chain changes
            ethereum.on('accountsChanged', (accts) => {
                if (accts.length === 0) {
                    disconnectWallet();
                } else {
                    // Account changed — re-auth needed
                    disconnectWallet();
                    showToast('Wallet account changed — please reconnect');
                }
            });
            ethereum.on('chainChanged', () => {
                showToast('Network changed — please verify your chain');
            });
        }

        // ── Profile Setup (new user registration) ──────────────────
        function _showProfileSetup(address) {
            const modal = document.getElementById('profileSetupModal');
            const addrDisplay = document.getElementById('setupWalletAddr');
            addrDisplay.textContent = address.substring(0, 6) + '...' + address.substring(address.length - 4);
            modal.style.display = 'flex';
            // Mark profile as incomplete so modal reappears on refresh
            localStorage.setItem('wf_profile_incomplete', '1');
        }

        async function saveProfileSetup() {
            const usernameInput = document.getElementById('setupUsername');
            const bioInput      = document.getElementById('setupBio');
            const saveBtn       = document.getElementById('saveProfileBtn');
            const usernameError = document.getElementById('setupUsernameError');

            // Reset errors
            usernameError.style.display = 'none';

            const username = usernameInput.value.trim();
            const bio      = bioInput.value.trim();

            // Validate username
            if (!username || username.length < 3) {
                usernameError.textContent = 'Username must be at least 3 characters';
                usernameError.style.display = 'block';
                usernameInput.focus();
                return;
            }
            if (!/^[a-zA-Z0-9_]+$/.test(username)) {
                usernameError.textContent = 'Only letters, numbers, and underscores allowed';
                usernameError.style.display = 'block';
                usernameInput.focus();
                return;
            }

            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving…';

            try {
                const updatedUser = await api('/users/profile', {
                    method: 'PUT',
                    body: JSON.stringify({ username, bio: bio || undefined })
                });

                // Update local state
                currentUser = updatedUser.username;
                const storedUser = getStoredUser();
                if (storedUser) {
                    Object.assign(storedUser, {
                        username: updatedUser.username,
                        displayName: updatedUser.displayName,
                        email: updatedUser.email,
                        bio: updatedUser.bio,
                        isProfileComplete: true,
                        location: updatedUser.location,
                        website: updatedUser.website
                    });
                    localStorage.setItem('wf_user', JSON.stringify(storedUser));
                }

                document.getElementById('profileSetupModal').style.display = 'none';
                localStorage.removeItem('wf_profile_incomplete');
                showToast('✅ Profile saved! Welcome to WhiteFlag!');
                // Refresh the profile display
                if (typeof loadMyProfile === 'function') loadMyProfile();
            } catch (err) {
                const msg = err.message || 'Failed to save profile';
                if (msg.toLowerCase().includes('username')) {
                    usernameError.textContent = msg;
                    usernameError.style.display = 'block';
                } else {
                    showToast(msg, 'error');
                }
            } finally {
                saveBtn.disabled = false;
                saveBtn.textContent = 'Save Profile';
            }
        }

        function skipProfileSetup() {
            // Modal is mandatory — cannot skip
            showToast('Please complete your profile to continue', 'error');
        }

        // ── UI update ──────────────────────────────────────────────
        function updateWalletButton() {
            const btn = document.getElementById('headerWalletBtn');
            const text = document.getElementById('walletBtnText');

            if (walletConnected && walletAddress) {
                btn.classList.add('connected');
                const short = walletAddress.substring(0, 4) + '...' + walletAddress.substring(walletAddress.length - 4);

                if (isVerified) {
                    btn.innerHTML = `<span class="verified-badge" style="margin-right:5px;">VERIFIED</span><span>${short}</span>`;
                } else {
                    text.textContent = short;
                }
            } else {
                btn.classList.remove('connected');
                btn.innerHTML = '<span id="walletBtnText">Connect Wallet</span>';
            }

            // Sync wallet address on profile card
            const profileAddr = document.getElementById('profileWalletAddress');
            const profileCopy = document.getElementById('profileWalletCopyBtn');
            if (profileAddr) {
                if (walletConnected && walletAddress) {
                    profileAddr.textContent = walletAddress.substring(0, 8) + '...' + walletAddress.substring(walletAddress.length - 8);
                    profileAddr.title = walletAddress;
                    if (profileCopy) profileCopy.style.display = 'inline-flex';
                } else {
                    profileAddr.textContent = 'Not connected — connect wallet to show address';
                    if (profileCopy) profileCopy.style.display = 'none';
                }
            }
        }

        // ── Wallet info popup ──────────────────────────────────────
        function showWalletInfo() {
            const chain = localStorage.getItem('wf_wallet_chain') || 'solana';
            const networkLabel = chain === 'evm' ? 'EVM Network' : 'Solana Mainnet';

            if (confirm(`Wallet Info\n\n━━━━━━━━━━━━━━━━━━━━━━\nProvider: ${walletProvider}\nAddress: ${walletAddress.substring(0, 10)}...${walletAddress.substring(walletAddress.length - 10)}\nNetwork: ${networkLabel}\nStatus: ${isVerified ? 'Verified ✓' : 'Not Verified'}\n━━━━━━━━━━━━━━━━━━━━━━\n\nWould you like to disconnect your wallet?`)) {
                disconnectWallet();
            }
        }

        // ── Disconnect ─────────────────────────────────────────────
        function disconnectWallet() {
            // Disconnect from the actual wallet provider
            try {
                if (_activeWalletProvider && typeof _activeWalletProvider.disconnect === 'function') {
                    _activeWalletProvider.disconnect();
                }
            } catch (e) { /* ignore */ }

            walletConnected = false;
            walletAddress = '';
            walletProvider = '';
            isVerified = false;
            isLoggedIn = false;
            _activeWalletProvider = null;
            currentUser = '';
            clearAuth();

            // Clear wallet session data
            localStorage.removeItem('wf_wallet_address');
            localStorage.removeItem('wf_wallet_provider');
            localStorage.removeItem('wf_wallet_chain');
            localStorage.removeItem('wf_wallet_connected');
            localStorage.removeItem('wf_wallet_signature');

            updateWalletButton();
            switchScreen('feed');
            showToast('Wallet disconnected');
        }

        // ── Session persistence ────────────────────────────────────
        function saveWalletState() {
            // State is saved in real-time during connection; this is a no-op for compat
        }

        // Session Persistence - Restore wallet state on page load
        function restoreWalletState() {
            const savedAddress   = localStorage.getItem('wf_wallet_address');
            const savedConnected = localStorage.getItem('wf_wallet_connected');
            const savedProvider  = localStorage.getItem('wf_wallet_provider');
            const savedChain     = localStorage.getItem('wf_wallet_chain');
            const savedToken     = localStorage.getItem('wf_token');
            const savedUser      = getStoredUser();

            // Need both wallet connection data AND a valid JWT token
            if (savedConnected !== 'true' || !savedAddress || !savedToken) {
                _clearWalletStorage();
                return;
            }

            // Restore user state from stored data
            function _restoreState(addr, prov, chain, providerObj) {
                walletAddress = addr;
                walletProvider = prov;
                walletConnected = true;
                isLoggedIn = true;
                _activeWalletProvider = providerObj;
                isVerified = savedUser?.isVerified || false;
                currentUser = savedUser?.username || addr.substring(0, 8);
                localStorage.setItem('wf_wallet_address', addr);
                updateWalletButton();
                console.log('[Wallet] Session restored:', { provider: prov, address: addr.substring(0, 10) + '...', user: currentUser });
            }

            if (savedChain === 'solana') {
                const provider = _getSolanaProvider(savedProvider);
                if (provider && provider.isConnected) {
                    _restoreState(savedAddress, savedProvider, 'solana', provider);
                    return;
                }
                if (provider) {
                    provider.connect({ onlyIfTrusted: true }).then(resp => {
                        _restoreState(resp.publicKey.toString(), savedProvider, 'solana', provider);
                    }).catch(() => {
                        console.log('[Wallet] Could not restore session — wallet locked');
                        _clearWalletStorage();
                        clearAuth();
                    });
                    return;
                }
            } else if (savedChain === 'evm') {
                const ethereum = _getEvmProvider();
                if (ethereum) {
                    ethereum.request({ method: 'eth_accounts' }).then(accts => {
                        if (accts && accts.length > 0) {
                            _restoreState(accts[0], 'MetaMask', 'evm', ethereum);
                        } else {
                            _clearWalletStorage();
                            clearAuth();
                        }
                    }).catch(() => {
                        _clearWalletStorage();
                        clearAuth();
                    });
                    return;
                }
            }
            // Provider not available — clear stale session
            _clearWalletStorage();
            clearAuth();
        }

        function _clearWalletStorage() {
            localStorage.removeItem('wf_wallet_address');
            localStorage.removeItem('wf_wallet_provider');
            localStorage.removeItem('wf_wallet_chain');
            localStorage.removeItem('wf_wallet_connected');
            localStorage.removeItem('wf_wallet_signature');
        }

        function handleVerification() {
            if (!walletConnected) {
                alert('⚠️ Please connect your wallet first!');
                openWalletModal();
                return;
            }

            if (isVerified) {
                alert('✓ You are already verified!');
                return;
            }

            // Show verification payment modal
            openVerificationPaymentModal();
        }

        async function openVerificationPaymentModal() {
            const modal = document.getElementById('verificationPaymentModal');
            modal.style.display = 'flex';
            document.getElementById('verificationWalletAddress').textContent = walletAddress;

            // Check wallet is Solana — payments are Solana only
            const chain = localStorage.getItem('wf_wallet_chain') || 'solana';
            if (chain !== 'solana') {
                document.getElementById('verifyPaymentToken').textContent = 'Solana wallet required';
                document.getElementById('verifyDisclaimer').textContent = 'Verification payments are only accepted via Solana. Please connect a Solana wallet (Phantom, Solflare, or Backpack).';
                document.getElementById('verifyPayBtn').disabled = true;
                return;
            }
            document.getElementById('verifyPayBtn').disabled = false;

            try {
                const d = await api('/verification/price');

                const usd = d.usd || 0.50;
                const half = (usd / 2).toFixed(2);

                document.getElementById('verifyPaymentAmount').textContent = '$' + usd.toFixed(2);
                document.getElementById('verifyPaymentToken').textContent = '~' + d.sol.toFixed(6) + ' SOL';
                document.getElementById('verifyBreakdownPlatform').textContent = '$' + half;
                document.getElementById('verifyBreakdownPool').textContent = '$' + half;
                document.getElementById('verifyBreakdownTotal').textContent = '$' + usd.toFixed(2);
                document.getElementById('verifyPayBtn').innerHTML = '<span>💎</span> Pay $' + usd.toFixed(2) + ' & Get Verified';
                document.getElementById('verifyDisclaimer').textContent = 'You\'ll be asked to approve the $' + usd.toFixed(2) + ' payment in your Solana wallet';
            } catch (e) {
                console.error('[Verification] Price fetch error:', e);
                document.getElementById('verifyPaymentToken').textContent = '~SOL';
            }
        }

        function closeVerificationPaymentModal() {
            document.getElementById('verificationPaymentModal').style.display = 'none';
        }

        // ── Verification payment: Solana only ──────────────────────────────
        // Step 1: Backend creates serialized Solana transaction
        // Step 2: Wallet signs & sends on-chain
        // Step 3: Backend verifies the on-chain transaction
        async function processVerificationPayment() {
            closeVerificationPaymentModal();

            if (!walletConnected || !_activeWalletProvider) {
                showToast('Please connect your wallet first', 'error');
                openWalletModal();
                return;
            }

            const chain = localStorage.getItem('wf_wallet_chain') || 'solana';
            if (chain !== 'solana') {
                showToast('Please connect a Solana wallet for verification payments', 'error');
                return;
            }

            showToast('💸 Preparing verification payment…');

            try {
                // Step 1: Backend creates a serialized Solana transaction
                const txData = await api('/verification/create-transaction', {
                    method: 'POST',
                    body: JSON.stringify({ walletAddress })
                });

                showToast('✍️ Please approve the transaction in your wallet…');

                // Step 2: Deserialize and sign with wallet
                const txBytes = Uint8Array.from(atob(txData.transaction), c => c.charCodeAt(0));
                const transaction = solanaWeb3.Transaction.from(txBytes);
                const result = await _activeWalletProvider.signAndSendTransaction(transaction);
                const txSignature = result.signature;

                // Wait for confirmation (poll with retry — mainnet can be slow)
                showToast('⏳ Waiting for confirmation (this may take a minute)…');
                const connection = new solanaWeb3.Connection(
                    txData.rpcUrl, 'confirmed'
                );

                // Retry confirmation check — the tx is already sent, just need to verify it landed
                let confirmed = false;
                for (let attempt = 0; attempt < 10; attempt++) {
                    try {
                        const status = await connection.getSignatureStatus(txSignature);
                        if (status && status.value && status.value.confirmationStatus === 'confirmed' || 
                            status && status.value && status.value.confirmationStatus === 'finalized') {
                            confirmed = true;
                            break;
                        }
                    } catch (e) {}
                    await new Promise(r => setTimeout(r, 5000)); // wait 5s between checks
                }

                if (!confirmed) {
                    // Even if we can't confirm client-side, the backend will verify on-chain
                    showToast('⏳ Tx sent — verifying with server…');
                }

                // Step 3: Verify with backend
                showToast('🔍 Verifying payment…');
                var verifyBody = {
                    transactionSignature: txSignature,
                    walletAddress
                };
                var referrer = getReferrerFromUrl();
                if (referrer) verifyBody.referrerId = referrer;
                await api('/verification/verify', {
                    method: 'POST',
                    body: JSON.stringify(verifyBody)
                });

                // Success — update local state
                isVerified = true;
                const user = getStoredUser();
                if (user) {
                    user.isVerified = true;
                    user.is_verified = true;
                    localStorage.setItem('wf_user', JSON.stringify(user));
                }
                updateWalletButton();
                showToast('✅ Verified! You now have the checkmark. 🚀', 'success');

            } catch (err) {
                console.error('[Verification]', err);
                if (err.message && (err.message.includes('rejected') || err.message.includes('denied') || err.message.includes('cancelled'))) {
                    showToast('Transaction cancelled by user', 'error');
                } else {
                    showToast('Verification failed — ' + (err.message || 'try again'), 'error');
                }
            }
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

        function replyToChat(button, username, messageText) {
            const textarea = document.getElementById('chatInput');
            const replyPreview = document.getElementById('chatReplyPreview');

            if (!textarea || !replyPreview) return;

            // Store reply data
            currentReply = { username, messageText };

            // Show reply preview
            replyPreview.innerHTML = `
                <div class="chat-reply-preview-header">
                    <div class="chat-reply-preview-content">
                        <div class="chat-reply-preview-label">
                            <span class="chat-reply-icon">↩</span>
                            <span class="chat-reply-to">${username}</span>
                        </div>
                        <div class="chat-reply-text">${messageText}</div>
                    </div>
                    <button class="chat-reply-cancel" onclick="cancelChatReply()">✕</button>
                </div>
            `;
            replyPreview.style.display = 'block';

            // Focus textarea
            textarea.focus();
        }

        function cancelChatReply() {
            currentReply = null;
            const replyPreview = document.getElementById('chatReplyPreview');
            if (replyPreview) {
                replyPreview.style.display = 'none';
                replyPreview.innerHTML = '';
            }
        }

        function scrollToChatMessage(previewElement) {
            // In a real app, this would scroll to the original message
            // For now, just provide visual feedback
            previewElement.style.background = 'var(--accent)';
            previewElement.style.color = 'white';

            setTimeout(() => {
                previewElement.style.background = '';
                previewElement.style.color = '';
            }, 300);

            console.log('Scrolling to original message...');
        }

        // Chat edit functionality
        function toggleChatEdit(button) {
            const chatMessage = button.closest('.chat-message');
            const chatText = chatMessage.querySelector('.chat-text');
            const editBox = chatMessage.querySelector('.chat-edit-box');

            if (editBox.style.display === 'none' || !editBox.style.display) {
                // Show edit box
                chatText.style.display = 'none';
                editBox.style.display = 'block';

                // Set textarea value to current text
                const textarea = editBox.querySelector('.chat-edit-input');
                textarea.value = chatText.textContent;
                textarea.focus();
            } else {
                // Hide edit box
                chatText.style.display = 'block';
                editBox.style.display = 'none';
            }
        }

        function saveChatEdit(button) {
            const editBox = button.closest('.chat-edit-box');
            const chatContent = editBox.closest('.chat-content');
            const chatText = chatContent.querySelector('.chat-text');
            const textarea = editBox.querySelector('.chat-edit-input');

            const newText = textarea.value.trim();

            if (!newText) {
                alert('Message cannot be empty!');
                return;
            }

            // Update the message
            chatText.textContent = newText;

            // Hide edit box, show message
            chatText.style.display = 'block';
            editBox.style.display = 'none';

            alert('✅ Message updated successfully!');

            console.log('Chat message updated:', newText);
        }

        function cancelChatEdit(button) {
            const editBox = button.closest('.chat-edit-box');
            const chatContent = editBox.closest('.chat-content');
            const chatText = chatContent.querySelector('.chat-text');

            // Hide edit box, show original message
            chatText.style.display = 'block';
            editBox.style.display = 'none';
        }

        // Vote/Like functionality
        function votePost(button, direction) {
            if (!isLoggedIn) {
                alert('Please connect your wallet to vote!');
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
                alert('Please connect your wallet to vote!');
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

        // Post deletion via API
        function deletePost(button) {
            deletePostApi(button);
        }

        async function deletePostApi(el) {
            var card = el.closest('.profile-post-card') || el.closest('.post-card');
            if (!card) return;
            var postId = card.dataset.postId;
            if (!postId || !confirm('Are you sure you want to delete this post?')) return;
            hideAllDropdowns();
            try {
                await api('/posts/' + postId, { method: 'DELETE' });
                card.style.transition = 'all 0.3s ease';
                card.style.opacity = '0';
                card.style.transform = 'translateX(-20px)';
                setTimeout(function() { card.remove(); }, 300);
                showToast('Post deleted');

                // Update post count in profile stats
                var postsVal = document.querySelector('.stat-compact-value[data-stat="posts"]');
                if (postsVal) {
                    var current = parseInt(postsVal.textContent) || 0;
                    postsVal.textContent = formatCount(Math.max(current - 1, 0));
                }
            } catch (err) {
                showToast(err.message || 'Failed to delete post', 'error');
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
                alert('Comment cannot be empty!');
                return;
            }

            commentText.textContent = newText;
            commentText.style.display = 'block';
            editBox.style.display = 'none';

            alert('✅ Comment updated!');
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
            var modal = document.getElementById('followersModal');
            var list  = document.getElementById('followersList');
            modal.style.display = 'flex';
            var profileUserId = _viewingProfileId || (getStoredUser() || {}).id;
            if (!profileUserId) return;
            list.innerHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:20px;">Loading...</div>';
            try {
                var data = await api('/users/' + profileUserId + '/followers');
                var followers = data.followers || [];
                document.querySelector('#followersModal .modal-title').textContent = 'Followers (' + followers.length + ')';
                if (!followers.length) {
                    list.innerHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:20px;">No followers yet</div>';
                    return;
                }
                list.innerHTML = followers.map(function(u) {
                    var avatar = u.avatar_url
                        ? '<div class="avatar" style="background-image:url(' + escapeHtml(u.avatar_url) + ');background-size:cover;background-position:center;">&nbsp;</div>'
                        : '<div class="avatar" data-avatar-user="' + escapeHtml(u.username) + '">' + (u.username || '?')[0].toUpperCase() + '</div>';
                    var verified = u.is_verified ? ' <span class="verified-badge">&#10003;</span>' : '';
                    var followBtn = '';
                    var me = getStoredUser();
                    if (me && u.id !== me.id) {
                        var isF = u.is_following;
                        followBtn = '<button class="btn-follow-small' + (isF ? '' : ' active') + '" onclick="toggleFollowInList(this,' + u.id + ')">' + (isF ? 'Following' : 'Follow') + '</button>';
                    }
                    return '<div class="user-list-item" data-username="' + escapeHtml(u.username) + '">'
                        + avatar
                        + '<div class="user-list-info">'
                        + '<div class="user-list-name username-link" onclick="goToProfile(\'' + escapeHtml(u.username) + '\')">' + escapeHtml(u.username || 'Unknown') + verified + '</div>'
                        + '<div class="user-list-meta">' + formatCount(u.followers_count || 0) + ' followers</div>'
                        + '</div>'
                        + followBtn
                        + '</div>';
                }).join('');
                refreshAllAvatars();
            } catch (e) {
                list.innerHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:20px;">Could not load followers</div>';
            }
        }

        function closeFollowersModal() {
            document.getElementById('followersModal').style.display = 'none';
        }

        async function showFollowingList() {
            var modal = document.getElementById('followingModal');
            var list  = document.getElementById('followingList');
            modal.style.display = 'flex';
            var profileUserId = _viewingProfileId || (getStoredUser() || {}).id;
            if (!profileUserId) return;
            list.innerHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:20px;">Loading...</div>';
            try {
                var data = await api('/users/' + profileUserId + '/following');
                var following = data.following || [];
                document.querySelector('#followingModal .modal-title').textContent = 'Following (' + following.length + ')';
                if (!following.length) {
                    list.innerHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:20px;">Not following anyone yet</div>';
                    return;
                }
                list.innerHTML = following.map(function(u) {
                    var avatar = u.avatar_url
                        ? '<div class="avatar" style="background-image:url(' + escapeHtml(u.avatar_url) + ');background-size:cover;background-position:center;">&nbsp;</div>'
                        : '<div class="avatar" data-avatar-user="' + escapeHtml(u.username) + '">' + (u.username || '?')[0].toUpperCase() + '</div>';
                    var verified = u.is_verified ? ' <span class="verified-badge">&#10003;</span>' : '';
                    var followBtn = '';
                    var me = getStoredUser();
                    if (me && u.id !== me.id) {
                        var isF = u.is_following;
                        followBtn = '<button class="btn-follow-small' + (isF ? '' : ' active') + '" onclick="toggleFollowInList(this,' + u.id + ')">' + (isF ? 'Following' : 'Follow') + '</button>';
                    }
                    return '<div class="user-list-item" data-username="' + escapeHtml(u.username) + '">'
                        + avatar
                        + '<div class="user-list-info">'
                        + '<div class="user-list-name username-link" onclick="goToProfile(\'' + escapeHtml(u.username) + '\')">' + escapeHtml(u.username || 'Unknown') + verified + '</div>'
                        + '<div class="user-list-meta">' + formatCount(u.followers_count || 0) + ' followers</div>'
                        + '</div>'
                        + followBtn
                        + '</div>';
                }).join('');
                refreshAllAvatars();
            } catch (e) {
                list.innerHTML = '<div style="text-align:center;color:var(--text-tertiary);padding:20px;">Could not load following</div>';
            }
        }

        function closeFollowingModal() {
            document.getElementById('followingModal').style.display = 'none';
        }

        // Toggle follow from inside modal lists
        async function toggleFollowInList(btn, userId) {
            try {
                var result = await api('/users/' + userId + '/follow', { method: 'POST' });
                if (result.following) {
                    btn.classList.remove('active');
                    btn.textContent = 'Following';
                } else {
                    btn.classList.add('active');
                    btn.textContent = 'Follow';
                }
            } catch (e) {
                showToast('Failed to update follow', 'error');
            }
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
            const post = button.closest('.post-card');
            const username = post.querySelector('.post-username').textContent;
            const content = post.querySelector('.post-text').textContent;

            // Generate share URL (in production, would be actual post URL)
            const postUrl = `https://whiteflag.app/post/${Math.random().toString(36).substring(7)}`;

            // Create share modal
            const shareOptions = `
                📤 Share Post

                1. Copy Link
                2. Share on Twitter
                3. Share on Telegram
                4. Share on Discord

                Post by @${username}
            `;

            const choice = prompt(shareOptions + '\n\nEnter choice (1-4):');

            if (choice === '1') {
                // Copy link
                navigator.clipboard.writeText(postUrl).then(() => {
                    alert('✅ Link copied to clipboard!\n\n' + postUrl);
                });
            } else if (choice === '2') {
                // Twitter
                const text = encodeURIComponent(`Check out this post on WhiteFlag!\n\n"${content.substring(0, 100)}${content.length > 100 ? '...' : ''}"`);
                window.open(`https://twitter.com/intent/tweet?text=${text}&url=${encodeURIComponent(postUrl)}`, '_blank');
            } else if (choice === '3') {
                // Telegram
                window.open(`https://t.me/share/url?url=${encodeURIComponent(postUrl)}&text=${encodeURIComponent(content.substring(0, 100))}`, '_blank');
            } else if (choice === '4') {
                // Discord - copy link
                navigator.clipboard.writeText(postUrl).then(() => {
                    alert('🎮 Link copied for Discord!\n\nPaste it in your Discord server:\n\n' + postUrl);
                });
            }
        }

        // Comment Deletion Function
        function deleteComment(button) {
            if (confirm('Delete this comment?\n\nThis action cannot be undone.')) {
                const comment = button.closest('.comment-item, .reply-item');
                const commentText = comment.querySelector('.comment-text').textContent;

                // Fade out and remove
                comment.style.transition = 'opacity 0.3s, transform 0.3s';
                comment.style.opacity = '0';
                comment.style.transform = 'translateX(-20px)';

                setTimeout(() => {
                    comment.remove();
                    alert('✅ Comment deleted successfully!');
                }, 300);
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
                        // Fall back to filtering mock list so demo always works
                        const mock = availableUsers.filter(u => u.username.toLowerCase().includes(query.toLowerCase()));
                        renderDMSearchResults(mock.map(u => ({ username: u.username, is_verified: u.verified, followers_count: u.followers, posts_count: u.posts })), resultsArea);
                    } else {
                        renderDMSearchResults(users, resultsArea);
                    }
                } catch (e) {
                    // API unavailable — use mock
                    const mock = availableUsers.filter(u => u.username.toLowerCase().includes(query.toLowerCase()));
                    renderDMSearchResults(mock.map(u => ({ username: u.username, is_verified: u.verified, followers_count: u.followers, posts_count: u.posts })), resultsArea);
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
                if (!convs.length) return;  // keep static demo cards if no real data

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
                // API unavailable — keep existing static HTML (demo mode)
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

            setTimeout(() => {
                document.addEventListener('click', hidePostOptions, { once: true });
            }, 10);
        }

        function hidePostOptions() {
            document.getElementById('postOptionsMenu').style.display = 'none';
        }

        // ── Post card dropdown menu ────────────────────────────
        function togglePostDropdown(btn, event) {
            event.stopPropagation();
            var menu = btn.nextElementSibling;
            var isOpen = menu.style.display === 'block';
            hideAllDropdowns();
            if (!isOpen) {
                menu.style.display = 'block';
                setTimeout(function() {
                    document.addEventListener('click', hideAllDropdowns, { once: true });
                }, 10);
            }
        }

        function hideAllDropdowns() {
            document.querySelectorAll('.post-dropdown-menu').forEach(function(m) {
                m.style.display = 'none';
            });
        }

        // ── Inline edit post ───────────────────────────────────
        function editPostInline(el) {
            hideAllDropdowns();
            var card = el.closest('.profile-post-card') || el.closest('.post-card');
            if (!card) return;
            var postId = card.dataset.postId;
            var textEl = card.querySelector('.profile-post-text');
            var titleEl = card.querySelector('.profile-post-title');
            if (!textEl) return;

            // Get current text
            var fullSpan = textEl.querySelector('.post-text-full');
            var currentText = fullSpan ? fullSpan.textContent : textEl.textContent;
            var currentTitle = titleEl ? titleEl.textContent : '';

            // Check if already in edit mode
            if (card.querySelector('.post-edit-inline')) return;

            // Hide original content
            textEl.style.display = 'none';
            if (titleEl) titleEl.style.display = 'none';

            var editHtml = '<div class="post-edit-inline">'
                + '<input type="text" class="post-edit-title-input" placeholder="Title (optional)" value="' + escapeHtml(currentTitle) + '">'
                + '<textarea class="post-edit-content-input" rows="4">' + escapeHtml(currentText) + '</textarea>'
                + '<div class="post-edit-actions">'
                + '<button class="post-edit-save-btn" onclick="savePostEdit(this)">Save</button>'
                + '<button class="post-edit-cancel-btn" onclick="cancelPostEdit(this)">Cancel</button>'
                + '</div></div>';

            textEl.insertAdjacentHTML('afterend', editHtml);
            card.querySelector('.post-edit-content-input').focus();
        }

        async function savePostEdit(btn) {
            var editBox = btn.closest('.post-edit-inline');
            var card = editBox.closest('.profile-post-card') || editBox.closest('.post-card');
            var postId = card.dataset.postId;
            var titleInput = editBox.querySelector('.post-edit-title-input');
            var contentInput = editBox.querySelector('.post-edit-content-input');
            var newTitle = titleInput.value.trim();
            var newContent = contentInput.value.trim();

            if (!newContent) { showToast('Content cannot be empty', 'error'); return; }

            try {
                await api('/posts/' + postId, {
                    method: 'PUT',
                    body: JSON.stringify({ content: newContent, title: newTitle || null })
                });

                // Update card content in-place
                var textEl = card.querySelector('.profile-post-text');
                var titleEl = card.querySelector('.profile-post-title');

                if (newContent.length > 150) {
                    textEl.innerHTML = '<span class="post-text-preview">' + escapeHtml(newContent.substring(0, 150)) + '…</span>'
                        + '<span class="post-text-full" style="display:none;">' + escapeHtml(newContent) + '</span> '
                        + '<button class="read-more-btn" onclick="toggleReadMore(this)">Read More</button>';
                } else {
                    textEl.textContent = newContent;
                }
                textEl.style.display = '';

                if (titleEl) {
                    if (newTitle) { titleEl.textContent = newTitle; titleEl.style.display = ''; }
                    else { titleEl.style.display = 'none'; }
                } else if (newTitle) {
                    textEl.insertAdjacentHTML('beforebegin', '<div class="profile-post-title">' + escapeHtml(newTitle) + '</div>');
                }

                editBox.remove();
                showToast('Post updated');
            } catch (err) {
                showToast(err.message || 'Failed to update post', 'error');
            }
        }

        function cancelPostEdit(btn) {
            var editBox = btn.closest('.post-edit-inline');
            var card = editBox.closest('.profile-post-card') || editBox.closest('.post-card');
            var textEl = card.querySelector('.profile-post-text');
            var titleEl = card.querySelector('.profile-post-title');
            textEl.style.display = '';
            if (titleEl) titleEl.style.display = '';
            editBox.remove();
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

        // Extract referrer from URL on page load
        (function() {
            var params = new URLSearchParams(window.location.search);
            var ref = params.get('ref');
            if (ref) {
                localStorage.setItem('wf_referrer', ref);
            }
        })();

        function getReferrerFromUrl() {
            return localStorage.getItem('wf_referrer') || '';
        }

        // Load real referral stats from API
        async function loadReferralStats() {
            try {
                var data = await api('/verification/status');
                if (!data) return;

                var totalReferrals = parseInt(data.referral_count) || 0;
                var totalEarned = parseFloat(data.total_earned) || 0;
                var thisMonth = parseInt(data.referrals_this_month) || 0;
                var earnedThisMonth = parseFloat(data.earned_this_month) || 0;

                var earningsAmountEl = document.querySelector('.earnings-amount');
                var earningsBreakdownEl = document.querySelector('.earnings-breakdown');
                if (earningsAmountEl) earningsAmountEl.textContent = '$' + totalEarned.toFixed(2);
                if (earningsBreakdownEl) earningsBreakdownEl.textContent = totalReferrals + ' verified referral' + (totalReferrals !== 1 ? 's' : '') + ' × $1.00 each';

                var statValues = document.querySelectorAll('.ref-stat-value');
                var statLabels = document.querySelectorAll('.ref-stat-label');
                if (statValues.length >= 4) {
                    statValues[0].textContent = totalReferrals;
                    statValues[1].textContent = thisMonth;
                    statValues[2].textContent = '$' + totalEarned.toFixed(0);
                    statValues[3].textContent = '$' + earnedThisMonth.toFixed(0);
                }
            } catch (e) {
                // Not logged in or API unavailable — leave defaults
            }
        }

        // Set referral link based on current user
        const WHITEFLAG_DOMAIN = 'https://whiteflag.app';
        function updateReferralLink() {
            var input = document.getElementById('referralLinkInput');
            if (input && currentUser) {
                input.value = WHITEFLAG_DOMAIN + '?ref=' + encodeURIComponent(currentUser);
            }
        }

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
                alert('Failed to copy link. Please copy manually.');
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
            const referralLink = document.getElementById('referralLinkInput').value;
            // Copy link and show instructions for Discord
            navigator.clipboard.writeText(referralLink).then(() => {
                alert('🎮 Referral link copied!\n\nPaste it in your Discord server to share.\n\nMessage: "Join me on WhiteFlag! Earn crypto rewards by engaging. ' + referralLink + '"');
            });
        }

        // Claim Earnings Functions
        let claimSource = '';
        let claimAmount = 0;
        let walletConnectedForClaim = false;
        let connectedWalletAddress = '';

        async function claimReferralEarnings() {
            claimSource = 'referral';
            try {
                var data = await api('/verification/status');
                claimAmount = parseFloat(data.total_earned) || 0;
            } catch (e) {
                claimAmount = 0;
            }
            if (claimAmount <= 0) {
                showToast('No referral earnings to claim yet', 'error');
                return;
            }
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
            if (walletConnected && walletAddress) {
                // Already connected — use existing wallet
                walletConnectedForClaim = true;
                connectedWalletAddress = walletAddress;

                document.getElementById('connectWalletClaimBtn').style.display = 'none';
                document.getElementById('connectedWalletInfo').style.display = 'block';
                document.getElementById('connectedWalletAddress').textContent = walletAddress;
                document.getElementById('claimNowBtn').disabled = false;

                document.querySelector('.wallet-status-icon').textContent = '✓';
                document.querySelector('.wallet-status-label').textContent = 'Wallet Connected';
                document.querySelector('.wallet-status-desc').textContent = 'Ready to claim earnings';
                return;
            }
            // Not connected — open wallet modal, then retry on next check
            showToast('Please connect your wallet first');
            closeClaimModal();
            openWalletModal();
        }

        function processClaim() {
            if (!walletConnectedForClaim || !walletConnected) {
                showToast('Please connect your wallet first', 'error');
                return;
            }
            closeClaimModal();
            showToast(`💸 Processing claim of $${claimAmount.toFixed(2)}...`);
            // Backend integration will handle the actual Solana transaction in the next phase
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

        function cancelChatReplyLegacy() {
            const replyPreview = document.getElementById('chatReplyActive');
            if (replyPreview) {
                replyPreview.style.display = 'none';
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

        async function toggleComments(idOrElement) {
            let section, postId;
            if (typeof idOrElement === 'string') {
                section = document.getElementById(idOrElement);
                postId = idOrElement;
            } else {
                const postCard = idOrElement.closest('.post-card, .profile-post-card');
                section = postCard && (postCard.querySelector('.post-comments-section') || postCard.querySelector('.comments-section'));
                postId = section?.dataset?.postId || postCard?.dataset?.postId;
            }
            if (!section) return;
            const isHidden = section.style.display === 'none' || section.style.display === '';
            if (isHidden) {
                section.style.display = 'flex';
                section.style.flexDirection = 'column';
                if (postId) await loadCommentsForPost(postId, section);
            } else {
                section.style.display = 'none';
            }
        }

        // Convert API comment to local format for renderComment()
        function apiCommentToLocal(c) {
            return {
                id: String(c.id),
                author: c.username || 'Unknown',
                avatar: (c.username || '?')[0].toUpperCase(),
                avatarUrl: c.avatar_url || null,
                verified: !!c.is_verified,
                time: c.created_at ? _timeAgo(c.created_at) : '',
                text: c.content || '',
                votes: c.upvote_count || 0,
                replies: (c.replies || []).map(apiCommentToLocal)
            };
        }

        // Load comments from API and render into a section
        async function loadCommentsForPost(postId, section) {
            if (!section) {
                const pc = document.querySelector('[data-post-id="' + postId + '"].post-comments-section');
                section = pc;
            }
            if (!section) return;
            section.innerHTML = '<div style="padding:12px;color:var(--text-tertiary);text-align:center;">Loading comments...</div>';
            try {
                const data = await api('/posts/' + postId + '/comments');
                const comments = (data && data.comments) || [];
                const localComments = comments.map(apiCommentToLocal);
                // Store in postCommentData for renderPostComments
                postCommentData[postId] = { comments: localComments };
                renderPostComments(postId, section);
            } catch (e) {
                section.innerHTML = '<div style="padding:12px;color:var(--text-tertiary);text-align:center;">Could not load comments.</div>';
            }
        }

        // ─── DYNAMIC REPLY SYSTEM ───────────────────────────────────────────────
        // Supports: reply-to-comment (Level 1) and reply-to-reply (Level 2+)
        // All reply boxes are created dynamically; no hardcoded IDs needed.

        // In-memory comment cache (populated from API)
        const postCommentData = {};

        // Render a single comment + its replies recursively
        function renderComment(comment, postId, isNested = false) {
            const replyItems = (comment.replies || []).map(r => renderComment(r, postId, true)).join('');
            const nestClass = isNested ? 'comment-nested' : '';
            const avatarClass = isNested ? 'small' : '';
            const safeAuthor = escapeHtml(comment.author || '');
            const safeText = escapeHtml(comment.text || '');
            const preview = safeText.substring(0, 40);
            const avatarInner = comment.avatarUrl
                ? '<img src="' + escapeHtml(comment.avatarUrl) + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">'
                : escapeHtml(comment.avatar || '?');
            return `
                <div class="post-comment ${nestClass}"
                     data-comment-id="${comment.id}"
                     data-comment-author="${safeAuthor}"
                     data-comment-preview="${preview}"
                     data-post-id="${postId}"
                     data-is-nested="${isNested}">
                    <div class="comment-avatar ${avatarClass}" data-profile-user="${safeAuthor}" style="cursor:pointer;">${avatarInner}</div>
                    <div class="comment-body">
                        <div class="comment-header">
                            <span class="comment-username username-link" data-profile-user="${safeAuthor}" style="cursor:pointer;">${safeAuthor}</span>
                            ${comment.verified ? '<span class="verified-mini">✓</span>' : ''}
                            <span class="comment-time">${escapeHtml(comment.time || '')}</span>
                        </div>
                        <div class="comment-text">${safeText.replace(/^@(\S+)/, '<span class="comment-mention">@$1</span>')}</div>
                        <div class="comment-actions">
                            <button class="comment-upvote-btn" onclick="toggleUpvote(this)">▲ <span class="upvote-count">${comment.votes || 0}</span></button>
                            <button class="comment-reply-btn" onclick="openReplyBox(this)">↩ Reply</button>
                        </div>
                    </div>
                </div>
                ${replyItems}`;
        }

        // Render all comments for a post section
        function renderPostComments(postId, sectionEl) {
            const section = sectionEl || document.querySelector('.post-comments-section[data-post-id="' + postId + '"]');
            if (!section) return;
            const data = postCommentData[postId];

            const storedUser = getStoredUser();
            const myAvatar = storedUser?.avatarUrl
                ? '<img src="' + escapeHtml(storedUser.avatarUrl) + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">'
                : (storedUser?.username ? storedUser.username[0].toUpperCase() : '?');
            const commentsHtml = (data && data.comments) ? data.comments.map(c => renderComment(c, postId, false)).join('') : '';

            section.innerHTML = commentsHtml + `
                <!-- New comment input -->
                <div class="post-new-comment-box">
                    <div class="reply-input-avatar">${myAvatar}</div>
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
        async function sendDynamicReply(inputEl) {
            if (!isLoggedIn) { showToast('Connect your wallet to reply!', 'error'); return; }
            const box = inputEl.closest('.post-reply-input-box');
            const text = inputEl.value.trim();
            const replyingToId     = box.dataset.replyingToId;
            const postId           = box.dataset.postId;

            if (!text) { inputEl.focus(); return; }
            inputEl.value = '';

            // Prepend @mention to reply content
            var replyAuthor = box.dataset.replyingToAuthor;
            var replyContent = replyAuthor ? '@' + replyAuthor + ' ' + text : text;

            try {
                await api('/posts/' + postId + '/comments', {
                    method: 'POST',
                    body: JSON.stringify({ content: replyContent, parent_comment_id: parseInt(replyingToId) || undefined })
                });
                showToast('Reply posted! 💬');
                // Reload comments from API
                const section = box.closest('.post-comments-section');
                if (section) await loadCommentsForPost(postId, section);
                // Update comment count
                const postCard = (section || box).closest('.profile-post-card, .post-card');
                if (postCard) {
                    const commentBtn = postCard.querySelector('.comment-btn');
                    if (commentBtn) {
                        const m = commentBtn.textContent.match(/\d+/);
                        if (m) commentBtn.innerHTML = '&#x1F4AC; ' + (parseInt(m[0]) + 1);
                    }
                }
            } catch (e) {
                showToast('Failed to post reply', 'error');
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

            if (input) input.value = '';

            try {
                await api('/posts/' + postId + '/comments', {
                    method: 'POST',
                    body: JSON.stringify({ content: text || '[GIF]' })
                });
                showToast('Comment posted! 💬');
                // Reload comments from API
                const section = input?.closest('.post-comments-section');
                if (section) await loadCommentsForPost(postId, section);
                // Update comment count in the post action bar
                const postCard = (section || document).querySelector('.profile-post-card[data-post-id="' + postId + '"], .post-card[data-post-id="' + postId + '"]')
                    || section?.closest('.profile-post-card, .post-card');
                if (postCard) {
                    const commentBtn = postCard.querySelector('.comment-btn');
                    if (commentBtn) {
                        const m = commentBtn.textContent.match(/\d+/);
                        if (m) commentBtn.innerHTML = '&#x1F4AC; ' + (parseInt(m[0]) + 1);
                    }
                }
            } catch (e) {
                showToast('Failed to post comment', 'error');
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
            // Update active button
            document.querySelectorAll('.chat-sort-btn').forEach(btn => {
                btn.classList.remove('active');
            });
            event.target.closest('.chat-sort-btn').classList.add('active');

            // Log sort type
            console.log('Sorting messages by:', sortType);

            // In a real app, this would reorder the messages
            // For now, just show a notification
            const sortText = sortType === 'recent' ? 'most recent' : 'most liked';
            alert(`Showing ${sortText} messages`);
        }

        async function sendChatMessage() {
            const textarea = document.getElementById('chatInput');
            const message = textarea?.value?.trim();
            if (!message) return;
            if (!isLoggedIn) { showToast('Connect your wallet to chat', 'error'); return; }

            // Optimistically add to UI
            const chatMessages = document.querySelector('.chat-messages-list');
            if (chatMessages) {
                const storedUser = getStoredUser();
                const myName = storedUser?.username || 'You';
                const div = document.createElement('div');
                div.className = 'chat-message-item own-message';
                div.innerHTML = `<div class="message-content">${escapeHtml(message)}</div><div class="message-time">${new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}</div>`;
                chatMessages.appendChild(div);
                chatMessages.scrollTop = chatMessages.scrollHeight;
            }

            textarea.value = '';
            cancelChatReply();

            // API call to default room id=1
            api('/chat/rooms/1/messages', {
                method: 'POST',
                body: JSON.stringify({ content: message })
            }).catch(() => {});
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
            if (screenName === 'profile')   loadProfilePosts(null, profileSortOrder);
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
            if (screenName === 'verification' && isLoggedIn) {
                updateReferralLink();
                loadReferralStats();
            }

            // Hide FAB on pages that don't need Create Post
            var fab = document.getElementById('fabCreatePost');
            var hideFabScreens = ['chatroom', 'chat', 'voicecall', 'verification', 'leaderboard', 'messages', 'conversation'];
            if (fab) fab.style.display = hideFabScreens.includes(screenName) ? 'none' : '';
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

            if (postId) {
                try {
                    await api('/posts/' + postId + '/comments', {
                        method: 'POST',
                        body: JSON.stringify({ content: commentText })
                    });
                    showToast('Comment posted! 💬');
                    const section = postCard.querySelector('.post-comments-section');
                    if (section) await loadCommentsForPost(postId, section);
                } catch (e) {
                    showToast('Failed to post comment', 'error');
                }
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
            const replyBox = button.closest('.reply-box');
            const textarea = replyBox.querySelector('.reply-input');
            const replyText = textarea.value.trim();

            if (!replyText) {
                alert('Please write a reply!');
                return;
            }

            if (!isLoggedIn) {
                alert('Please connect your wallet to reply!');
                return;
            }

            console.log('Submitting reply:', replyText);
            alert('Reply posted! 💬');

            // Clear and hide reply box
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
                alert('Please connect your wallet to edit posts!');
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

        function saveEditPost(button) {
            const editBox = button.closest('.post-edit-box');
            const postCard = editBox.closest('.post-card');
            const titleInput = editBox.querySelector('.post-title-edit');
            const contentTextarea = editBox.querySelector('.post-content-edit');
            const postTitle = postCard.querySelector('.post-title');
            const postContent = postCard.querySelector('.post-content');

            const newTitle = titleInput.value.trim();
            const newContent = contentTextarea.value.trim();

            if (!newContent) {
                alert('Post content cannot be empty!');
                return;
            }

            console.log('Saving edited post:', { title: newTitle, content: newContent });

            if (postTitle) {
                if (newTitle) {
                    postTitle.textContent = newTitle;
                    postTitle.style.display = 'block';
                } else {
                    postTitle.style.display = 'none';
                }
            }

            postContent.textContent = newContent;
            editBox.style.display = 'none';
            postContent.style.display = 'block';

            alert('Post updated! ✏️');
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
                alert('Please connect your wallet to edit comments!');
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
                alert('Comment cannot be empty!');
                return;
            }

            console.log('Saving edited comment:', newText);
            commentText.textContent = newText;
            editBox.style.display = 'none';
            commentText.style.display = 'block';
            alert('Comment updated! ✏️');
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
                alert('Please connect your wallet to edit replies!');
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
                alert('Reply cannot be empty!');
                return;
            }

            console.log('Saving edited reply:', newText);
            replyText.textContent = newText;
            editBox.style.display = 'none';
            replyText.style.display = 'block';
            alert('Reply updated! ✏️');
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
            input.onchange = async (e) => {
                const file = e.target.files[0];
                if (file) {
                    if (file.size > 2 * 1024 * 1024) {
                        showToast('Image must be under 2MB', 'error');
                        return;
                    }

                    // Show local preview immediately
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        updateProfileAvatar(event.target.result);
                    };
                    reader.readAsDataURL(file);

                    // Upload to server via Cloudinary
                    try {
                        showToast('Uploading profile picture…');
                        const formData = new FormData();
                        formData.append('avatar', file);

                        const token = localStorage.getItem('wf_token');
                        const res = await fetch(API_BASE + '/users/avatar', {
                            method: 'POST',
                            headers: token ? { Authorization: 'Bearer ' + token } : {},
                            body: formData
                        });
                        const data = await res.json();
                        if (!res.ok) throw new Error(data.error || 'Upload failed');

                        // Store the Cloudinary URL for saveProfile
                        profilePictureData = data.avatarUrl;
                        updateProfileAvatar(data.avatarUrl);

                        // Update stored user immediately
                        const user = getStoredUser();
                        if (user) {
                            user.avatarUrl = data.avatarUrl;
                            localStorage.setItem('wf_user', JSON.stringify(user));
                        }

                        showToast('Profile picture uploaded ✅');
                    } catch (err) {
                        showToast(err.message || 'Failed to upload picture', 'error');
                        profilePictureData = null;
                    }
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
            if (currentMediaFiles.length >= 4) {
                showToast('Maximum 4 images per post', 'error');
                return;
            }
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/jpeg,image/png,image/gif,image/webp';
            input.multiple = true;
            input.onchange = (e) => {
                const files = Array.from(e.target.files);
                for (const file of files) {
                    if (currentMediaFiles.length >= 4) {
                        showToast('Maximum 4 images per post', 'error');
                        break;
                    }
                    if (file.size > 5 * 1024 * 1024) {
                        showToast('Image must be under 5MB: ' + file.name, 'error');
                        continue;
                    }
                    if (!['image/jpeg','image/png','image/gif','image/webp'].includes(file.type)) {
                        showToast('Only JPEG, PNG, GIF, WebP allowed', 'error');
                        continue;
                    }
                    currentMediaFiles.push(file);
                }
                if (currentMediaFiles.length) {
                    currentMediaType = 'image';
                    currentMedia = true;
                    showMediaPreviewMulti();
                }
            };
            input.click();
        }

        function uploadVideo() {
            // Video upload placeholder — can be extended later
            showToast('Video upload coming soon!', 'info');
        }

        // Show preview grid for multiple images
        function showMediaPreviewMulti() {
            var preview = document.getElementById('mediaPreview');
            if (!currentMediaFiles.length) {
                preview.classList.remove('active');
                preview.innerHTML = '';
                return;
            }
            preview.classList.add('active');
            var html = '<div class="preview-grid" style="display:flex;flex-wrap:wrap;gap:8px;">';
            currentMediaFiles.forEach(function(file, idx) {
                var url = URL.createObjectURL(file);
                html += '<div class="preview-container" style="position:relative;width:calc(50% - 4px);aspect-ratio:1;border-radius:12px;overflow:hidden;">'
                    + '<img src="' + url + '" style="width:100%;height:100%;object-fit:cover;" alt="Preview">'
                    + '<button class="remove-media-btn" onclick="removeMediaAt(' + idx + ')" style="position:absolute;top:4px;right:4px;background:rgba(0,0,0,0.7);color:#fff;border:none;border-radius:50%;width:24px;height:24px;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;">×</button>'
                    + '</div>';
            });
            if (currentMediaFiles.length < 4) {
                html += '<div style="position:relative;width:calc(50% - 4px);aspect-ratio:1;border-radius:12px;border:2px dashed var(--border);display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--text-tertiary);font-size:1.5em;" onclick="uploadImage()">+</div>';
            }
            html += '</div>';
            preview.innerHTML = html;
        }

        function showMediaPreview(src, type) {
            var preview = document.getElementById('mediaPreview');
            preview.classList.add('active');
            if (type === 'image') {
                preview.innerHTML = '<div class="preview-container"><img src="' + src + '" class="preview-image" alt="Preview"><button class="remove-media-btn" onclick="removeMedia()">×</button></div>';
            } else if (type === 'video') {
                preview.innerHTML = '<div class="preview-container"><video controls class="preview-video"><source src="' + src + '" type="video/mp4"></video><button class="remove-media-btn" onclick="removeMedia()">×</button></div>';
            }
        }

        function removeMediaAt(index) {
            currentMediaFiles.splice(index, 1);
            if (!currentMediaFiles.length) {
                removeMedia();
            } else {
                showMediaPreviewMulti();
            }
        }

        function removeMedia() {
            currentMedia = null;
            currentMediaType = null;
            currentMediaFiles = [];
            var preview = document.getElementById('mediaPreview');
            preview.classList.remove('active');
            preview.innerHTML = '';
        }

        function openImageViewer(url) {
            var overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.9);z-index:100000;display:flex;align-items:center;justify-content:center;cursor:zoom-out;';
            overlay.onclick = function() { document.body.removeChild(overlay); };
            var img = document.createElement('img');
            img.src = url;
            img.style.cssText = 'max-width:90vw;max-height:90vh;object-fit:contain;border-radius:8px;';
            overlay.appendChild(img);
            document.body.appendChild(overlay);
            document.addEventListener('keydown', function handler(e) {
                if (e.key === 'Escape') {
                    if (overlay.parentNode) document.body.removeChild(overlay);
                    document.removeEventListener('keydown', handler);
                }
            });
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
            var d = new Date(iso);
            if (isNaN(d.getTime())) return '';
            var s = Math.floor((Date.now() - d.getTime()) / 1000);
            if (s < 0) s = 0;
            if (s < 10)     return 'just now';
            if (s < 60)     return s + 's ago';
            if (s < 3600)   return Math.floor(s / 60) + 'm ago';
            if (s < 86400)  return Math.floor(s / 3600) + 'h ago';
            if (s < 604800) return Math.floor(s / 86400) + 'd ago';
            return d.toLocaleDateString();
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
            var uCls = p.user_upvoted    ? ' active' : '';
            var bCls = p.user_bookmarked ? ' active' : '';

            var authorHtml = '';
            var followBtnHtml = '';
            if (opts.showAuthor !== false && p.username) {
                var currentUser = getStoredUser();
                var isOwnPost = currentUser && (currentUser.id === p.user_id || currentUser.username === p.username);
                var avatarHtml = '';
                if (p.avatar_url) {
                    avatarHtml = '<div class="post-author-avatar" data-profile-user="' + escapeHtml(p.username) + '"'
                        + ' style="width:28px;height:28px;min-width:28px;border-radius:50%;background-image:url(' + escapeHtml(p.avatar_url) + ');background-size:cover;background-position:center;cursor:pointer;"></div>';
                } else {
                    avatarHtml = '<div class="post-author-avatar" data-profile-user="' + escapeHtml(p.username) + '"'
                        + ' style="width:28px;height:28px;min-width:28px;border-radius:50%;background:var(--primary);color:#000;display:flex;align-items:center;justify-content:center;font-size:0.72em;font-weight:700;cursor:pointer;">'
                        + escapeHtml((p.username || '?')[0].toUpperCase()) + '</div>';
                }
                authorHtml = avatarHtml + '<span class="post-author username-link"'
                    + ' data-profile-user="' + escapeHtml(p.username) + '"'
                    + ' style="font-size:0.82em;color:var(--text-secondary);'
                    + 'margin-right:6px;cursor:pointer;font-weight:600;">'
                    + escapeHtml(p.username)
                    + (p.is_verified ? ' <span style="color:var(--primary);">&#x2713;</span>' : '')
                    + '</span>';
                if (!isOwnPost && isLoggedIn) {
                    var fCls = p.user_following ? 'following' : '';
                    var fTxt = p.user_following ? '&#x2713; Following' : '+ Follow';
                    followBtnHtml = '<button class="post-follow-btn ' + fCls + '"'
                        + ' data-user-id="' + (p.user_id || '') + '"'
                        + ' onclick="togglePostFollow(this, event)"'
                        + ' style="font-size:0.72em;padding:2px 8px;border-radius:10px;'
                        + 'border:1px solid var(--primary);background:' + (p.user_following ? 'var(--primary)' : 'transparent') + ';'
                        + 'color:' + (p.user_following ? '#fff' : 'var(--primary)') + ';cursor:pointer;font-weight:600;margin-left:4px;white-space:nowrap;">'
                        + fTxt + '</button>';
                }
            }
            var titleHtml = p.title
                ? '<div class="profile-post-title">' + escapeHtml(p.title) + '</div>'
                : '';

            // Build image gallery HTML
            var imagesHtml = '';
            if (p.images && p.images.length > 0) {
                var imgCount = p.images.length;
                var gridStyle = 'display:grid;gap:4px;border-radius:12px;overflow:hidden;margin:8px 0;';
                if (imgCount === 1) {
                    gridStyle += 'grid-template-columns:1fr;';
                } else if (imgCount === 2) {
                    gridStyle += 'grid-template-columns:1fr 1fr;';
                } else if (imgCount === 3) {
                    gridStyle += 'grid-template-columns:1fr 1fr;grid-template-rows:auto auto;';
                } else {
                    gridStyle += 'grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;';
                }
                imagesHtml += '<div class="post-images-grid" style="' + gridStyle + '">';
                p.images.forEach(function(url, idx) {
                    var spanStyle = '';
                    if (imgCount === 3 && idx === 0) spanStyle = 'grid-row:1/3;';
                    imagesHtml += '<div style="' + spanStyle + 'overflow:hidden;cursor:pointer;" onclick="openImageViewer(\'' + escapeHtml(url) + '\')">'
                        + '<img src="' + escapeHtml(url) + '" alt="Post image" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block;max-height:400px;min-height:120px;">'
                        + '</div>';
                });
                imagesHtml += '</div>';
            }

            // Link URL — CTA button style
            var linkHtml = '';
            if (p.link_url) {
                var linkDomain = '';
                try { linkDomain = new URL(p.link_url).hostname.replace('www.', ''); } catch(e) { linkDomain = 'Link'; }
                linkHtml = '<a href="' + escapeHtml(p.link_url) + '" target="_blank" rel="noopener noreferrer" class="post-link-cta">'
                    + '<span class="post-link-cta-icon">&#x1F517;</span>'
                    + '<span class="post-link-cta-text">'
                    + '<span class="post-link-cta-label">Visit Link</span>'
                    + '<span class="post-link-cta-domain">' + escapeHtml(linkDomain) + '</span>'
                    + '</span>'
                    + '<span class="post-link-cta-arrow">&#x2192;</span>'
                    + '</a>';
            }

            // Owner dropdown menu
            var currentUser = opts._currentUser || getStoredUser();
            var isOwner = currentUser && (currentUser.id === p.user_id || currentUser.username === p.username);
            var dropdownHtml = '<div class="post-dropdown-wrap" style="position:relative;margin-left:auto;">'
                + '<button class="post-dropdown-trigger" onclick="togglePostDropdown(this, event)" title="Options">&#x22EE;</button>'
                + '<div class="post-dropdown-menu" style="display:none;">'
                + (isOwner ? '<div class="post-dropdown-item" onclick="editPostInline(this)"><span>&#x270F;&#xFE0F;</span> Edit Post</div>' : '')
                + (isOwner ? '<div class="post-dropdown-item post-dropdown-danger" onclick="deletePostApi(this)"><span>&#x1F5D1;&#xFE0F;</span> Delete Post</div>' : '')
                + '<div class="post-dropdown-item" onclick="copyPostLink(this)"><span>&#x1F517;</span> Copy Link</div>'
                + '<div class="post-dropdown-item" onclick="dropdownToggleBookmark(this)" data-post-id="' + pid + '"><span>&#x1F516;</span> ' + (p.user_bookmarked ? 'Remove Bookmark' : 'Add to Bookmark') + '</div>'
                + '</div>'
                + '</div>';

            return '<div class="profile-post-card" data-post-id="' + pid + '">'
                + '<div class="profile-post-border-accent"></div>'
                + '<div class="profile-post-content">'
                + '<div class="profile-post-header" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">'
                + authorHtml
                + followBtnHtml
                + '<span class="profile-post-topic ' + _tClass(top) + '">&#x1FA99; ' + escapeHtml(tLbl) + '</span>'
                + '<span class="profile-post-time">' + ts + '</span>'
                + dropdownHtml
                + '</div>'
                + titleHtml
                + (function() {
                    var raw = escapeHtml(p.content || '');
                    var LIMIT = 150;
                    if (raw.length <= LIMIT) return '<div class="profile-post-text">' + raw + '</div>';
                    var truncated = raw.substring(0, LIMIT) + '…';
                    return '<div class="profile-post-text"><span class="post-text-preview">' + truncated + '</span>'
                        + '<span class="post-text-full" style="display:none;">' + raw + '</span> '
                        + '<button class="read-more-btn" onclick="toggleReadMore(this)">Read More</button></div>';
                })()
                + imagesHtml
                + linkHtml
                + '<div class="post-action-bar">'
                + '<button class="post-action-btn vote-up' + uCls + '" onclick="toggleUpvote(this)">&#9650; ' + uv + '</button>'
                + '<button class="post-action-btn comment-btn" onclick="toggleComments(this)">&#x1F4AC; ' + cm + '</button>'
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

        // ── Read More / Show Less toggle ──────────────────────────────
        function toggleReadMore(btn) {
            var container = btn.parentElement;
            var preview = container.querySelector('.post-text-preview');
            var full = container.querySelector('.post-text-full');
            if (full.style.display === 'none') {
                preview.style.display = 'none';
                full.style.display = 'inline';
                btn.textContent = 'Show Less';
            } else {
                preview.style.display = 'inline';
                full.style.display = 'none';
                btn.textContent = 'Read More';
            }
        }

        async function createPost() {
            const titleInput = document.getElementById('postTitleInput');
            const textarea   = document.getElementById('postTextarea');
            const linkInput  = document.getElementById('postLinkInput');
            const postBtn    = document.querySelector('.post-btn');
            const title   = titleInput.value.trim();
            const content = textarea.value.trim();
            const linkUrl = linkInput.value.trim();

            if (!content && !currentMediaFiles.length) {
                showToast('Please add some content to your post!', 'error');
                return;
            }
            if (!isLoggedIn) {
                showToast('Connect your wallet to post!', 'error');
                return;
            }

            const topicName = selectedTopic?.name || 'general';

            // Disable button to prevent double-submit
            if (postBtn) { postBtn.disabled = true; postBtn.textContent = 'Posting…'; }

            try {
                // Use FormData for multipart upload (images + fields)
                const formData = new FormData();
                formData.append('content', content);
                formData.append('topic', topicName.toLowerCase());
                if (title) formData.append('title', title);
                if (linkUrl) formData.append('linkUrl', linkUrl);

                // Attach image files
                currentMediaFiles.forEach(function(file) {
                    formData.append('images', file);
                });

                // Custom fetch — don't set Content-Type (browser sets multipart boundary)
                const token = localStorage.getItem('wf_token');
                const res = await fetch(API_BASE + '/posts', {
                    method: 'POST',
                    headers: token ? { Authorization: 'Bearer ' + token } : {},
                    body: formData
                });
                const data = await res.json().catch(function() { return {}; });
                if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);

                showToast('Post created! 🎉');

                // Clear inputs only on success
                titleInput.value = '';
                textarea.value   = '';
                linkInput.value  = '';
                removeMedia();
                clearTopic();

                // Refresh feeds so the new post appears immediately
                await loadFeed(feedSortOrder);
                loadProfilePosts(null, profileSortOrder);
            } catch (err) {
                if (err.message && err.message.includes('Verification required')) {
                    showToast('Verify your account to post — opening verification…', 'error');
                    setTimeout(function() { handleVerification(); }, 1200);
                } else {
                    showToast(err.message || 'Failed to create post', 'error');
                }
            } finally {
                if (postBtn) { postBtn.disabled = false; postBtn.textContent = 'Post'; }
            }
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

            if (username && (username.length < 3 || username.length > 50)) {
                showToast('Username must be 3-50 characters', 'error');
                return;
            }
            if (username && !/^[a-zA-Z0-9_]+$/.test(username)) {
                showToast('Username: letters, numbers, underscores only', 'error');
                return;
            }

            const saveBtn = document.querySelector('.save-profile-btn');
            if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

            try {
                const payload = {
                    username:    username    || undefined,
                    displayName: displayName || undefined,
                    bio:         bio         || undefined,
                    location:    location    || undefined,
                    website:     website     || undefined,
                    avatarUrl:   (typeof profilePictureData !== 'undefined' && profilePictureData) ? profilePictureData : undefined
                };
                const updated = await api('/users/profile', {
                    method: 'PUT',
                    body: JSON.stringify(payload)
                });

                // Sync local auth cache
                const user = getStoredUser();
                if (user && updated) {
                    Object.assign(user, {
                        username:    updated.username,
                        displayName: updated.displayName,
                        bio:         updated.bio,
                        avatarUrl:   updated.avatarUrl,
                        location:    updated.location,
                        website:     updated.website,
                        isProfileComplete: true
                    });
                    localStorage.setItem('wf_user', JSON.stringify(user));
                    currentUser = updated.username;
                }

                // Refresh profile display with new data
                renderProfileDisplay(updated);
                showToast('Profile saved ✅');
                toggleProfileView('display');
            } catch (err) {
                showToast(err.message || 'Failed to save profile', 'error');
            } finally {
                if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Changes'; }
            }
        }

        function cancelEdit() {
            if (confirm('Discard changes?')) {
                const user = getStoredUser();
                document.getElementById('username').value    = user?.username || '';
                document.getElementById('displayName').value = user?.displayName || '';
                document.getElementById('bio').value         = user?.bio || '';
                document.getElementById('location').value    = user?.location || '';
                document.getElementById('website').value     = user?.website || '';
                profilePictureData = null;
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
                alert('Please connect your wallet to start a voice chat!');
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
        let totalPages = 1;

        // Live leaderboard data — populated by API only (no mock/dummy data)
        var leaderboardData = [];

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
                            avatarUrl: u.avatar_url || null,
                            hours:    0,
                            posts:    u.posts_count    || 0,
                            comments: u.comments_count || 0,
                            likes:    u.upvotes_received || 0,
                            score:    u.engagement_score || 0,
                            payout:   Math.floor((u.engagement_score || 0) / 20)
                        };
                    });
                } else {
                    leaderboardData = [];
                }
            } catch (e) {
                leaderboardData = [];
            }
            totalPages = Math.max(1, Math.ceil(leaderboardData.length / usersPerPage));
            renderLeaderboard(1);
        }


        function renderLeaderboard(page) {
            const rowsContainer = document.getElementById('leaderboardRows');
            rowsContainer.innerHTML = '';

            if (leaderboardData.length === 0) {
                rowsContainer.innerHTML = '<div style="text-align:center;padding:60px 20px;color:var(--text-secondary);"><div style="font-size:3em;margin-bottom:16px;">🏆</div><div style="font-size:1.1em;font-weight:700;margin-bottom:8px;">No Users Yet</div><div style="font-size:0.9em;color:var(--text-tertiary);">Be the first to get verified and start climbing the leaderboard!</div></div>';
                updatePaginationControls(1);
                return;
            }

            const startIndex = (page - 1) * usersPerPage;
            const endIndex = startIndex + usersPerPage;
            const pageData = leaderboardData.slice(startIndex, endIndex);

            pageData.forEach(user => {
                const rankClass = user.rank <= 3 ? `rank-${user.rank}` : '';
                const avatarContent = user.avatarUrl
                    ? '<img src="' + escapeHtml(user.avatarUrl) + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">'
                    : (USER_AVATARS[user.name] ? '' : user.avatar);
                const avatarStyle = user.avatarUrl
                    ? ''
                    : (USER_AVATARS[user.name] ? ' style="background-image:url(' + USER_AVATARS[user.name] + ');background-size:cover;background-position:center;"' : '');
                const row = `
                    <div class="leaderboard-row">
                        <div class="rank ${rankClass}">#${user.rank}</div>
                        <div class="leader-user">
                            <div class="leader-avatar" data-avatar-user="${user.name}" data-profile-user="${user.name}" style="cursor:pointer;${user.avatarUrl ? '' : ''}"${avatarStyle}>${avatarContent}</div>
                            <div class="leader-info">
                                <div class="leader-name username-link" data-profile-user="${user.name}" style="cursor:pointer;">${user.name}</div>
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
            var total = leaderboardData.length;

            // Update showing text
            var start = total === 0 ? 0 : (page - 1) * usersPerPage + 1;
            var end = Math.min(page * usersPerPage, total);
            document.getElementById('showingStart').textContent = start;
            document.getElementById('showingEnd').textContent = end;
            document.getElementById('totalUsers').textContent = total;

            // Update page input
            document.getElementById('pageJumpInput').value = page;
            document.getElementById('pageJumpInput').max = totalPages;

            // Update button states
            document.getElementById('firstPageBtn').disabled = page === 1;
            document.getElementById('prevPageBtn').disabled = page === 1;
            document.getElementById('nextPageBtn').disabled = page >= totalPages;
            document.getElementById('lastPageBtn').disabled = page >= totalPages;

            // Update last page button onclick
            document.getElementById('lastPageBtn').setAttribute('onclick', 'goToPage(' + totalPages + ')');

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
                alert(`Please enter a page number between 1 and ${totalPages}`);
            }
        }

        // Initialize leaderboard on page load
        document.addEventListener('DOMContentLoaded', function() {
            loadLeaderboard();              // load live API data (renders empty state if none)

            // Load feed on startup
            loadFeed();

            // Poll unread message count every 60s when authenticated
            setInterval(function() {
                if (isLoggedIn && typeof refreshUnreadCount === 'function') refreshUnreadCount();
            }, 60000);

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
        function createVoiceRoomFromPage() {
            const title = document.getElementById('voiceRoomTitle').value.trim();
            const desc = document.getElementById('voiceRoomDesc').value.trim();
            const topic = document.getElementById('voiceRoomTopic').value;
            const privacy = document.querySelector('input[name="roomPrivacy"]:checked').value;
            const maxSpeakers = document.getElementById('maxSpeakers').value;
            const scheduleType = document.querySelector('input[name="scheduleType"]:checked').value;
            const record = document.getElementById('recordSession').checked;
            const allowRequests = document.getElementById('allowRequests').checked;
            const sendNotifications = document.getElementById('sendNotifications').checked;

            // Validation
            if (!title) {
                alert('❌ Please enter a room title!');
                document.getElementById('voiceRoomTitle').focus();
                return;
            }

            if (!topic) {
                alert('❌ Please select a topic category!');
                document.getElementById('voiceRoomTopic').focus();
                return;
            }

            let scheduleInfo = 'Now';
            if (scheduleType === 'scheduled') {
                const date = document.getElementById('scheduleDate').value;
                const time = document.getElementById('scheduleTime').value;
                if (date && time) {
                    scheduleInfo = `${date} at ${time}`;
                }
            }

            // Get topic display name
            const topicSelect = document.getElementById('voiceRoomTopic');
            const topicName = topicSelect.options[topicSelect.selectedIndex].text;

            console.log('Creating voice room:', {
                title,
                description: desc || 'No description',
                topic: topicName,
                privacy,
                maxSpeakers,
                schedule: scheduleInfo,
                settings: {
                    record,
                    allowRequests,
                    sendNotifications
                }
            });

            let settingsText = '';
            if (record) settingsText += '\n✓ Recording enabled';
            if (allowRequests) settingsText += '\n✓ Speaker requests allowed';
            if (sendNotifications) settingsText += '\n✓ Notifications will be sent';

            alert(`🎙️ Voice Chat Created Successfully!\n\n📝 ${title}\n📁 ${topicName}\n🔒 ${privacy.charAt(0).toUpperCase() + privacy.slice(1)}\n👥 Max ${maxSpeakers} speakers\n⏰ ${scheduleInfo}${settingsText}\n\n${scheduleType === 'now' ? 'Your voice chat is now live!' : 'Your voice chat has been scheduled!'}`);

            // Clear form
            document.getElementById('voiceRoomTitle').value = '';
            document.getElementById('voiceRoomDesc').value = '';
            document.getElementById('voiceRoomTopic').value = '';
            document.querySelector('input[name="roomPrivacy"][value="public"]').checked = true;
            document.getElementById('maxSpeakers').value = '10';
            document.querySelector('input[name="scheduleType"][value="now"]').checked = true;
            document.getElementById('scheduleInputs').style.display = 'none';
            document.getElementById('recordSession').checked = false;
            document.getElementById('allowRequests').checked = true;
            document.getElementById('sendNotifications').checked = true;

            // Navigate to voice chat screen
            switchScreen('voicecall');

            // In a real app, this would:
            // 1. Create the room in the database
            // 2. Initialize WebRTC connections
            // 3. Update the UI to show the new room
            // 4. Move user to host position
            // 5. Send notifications if enabled
            // 6. Set up scheduled task if needed
        }

        function repostPost(element) {
            // Check if user is logged in
            if (!isLoggedIn) {
                alert('Please connect your wallet to repost!');
                return;
            }

            // Get the post card
            const postCard = element.closest('.post-card');

            // In a real app, this would:
            // 1. Save the repost to the database
            // 2. Add it to the user's profile reposts section
            // 3. Add it to followers' Following feeds

            console.log('Reposting:', {
                postCard: postCard.innerHTML,
                user: 'JohnDoe_Crypto'
            });

            alert('✅ Reposted!\n\nThis post will now appear on:\n• Your Profile (reposts section)\n• Your followers\' Following feed');
        }

        function pinPost(element) {
            // Check if user is logged in
            if (!isLoggedIn) {
                alert('Please connect your wallet to pin posts!');
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

                alert('Post unpinned from profile! 📌');
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

                alert('Post pinned to profile! 📌\n\nThis post will now appear at the top of your profile.');
            }
        }

        async function toggleFollow() {
            if (!isLoggedIn) { showToast('Connect wallet to follow users', 'error'); return; }
            const btn = document.querySelector('.follow-btn-compact');
            const profileUserId = btn?.dataset?.userId;
            if (!profileUserId) { showToast('Cannot follow this user', 'error'); return; }

            const wasFollowing = btn.classList.contains('following');

            // Optimistic UI update
            if (wasFollowing) {
                btn.classList.remove('following');
                btn.textContent = '+ Follow';
            } else {
                btn.classList.add('following');
                btn.textContent = '✓ Following';
            }

            try {
                const result = await api('/users/' + profileUserId + '/follow', { method: 'POST' });
                // Update follower count display
                const followerEl = document.querySelector('.stat-compact-value[data-stat="followers"]');
                if (followerEl && result.followersCount !== undefined) {
                    followerEl.textContent = formatCount(result.followersCount);
                }
            } catch (err) {
                // Revert on failure
                if (wasFollowing) {
                    btn.classList.add('following');
                    btn.textContent = '✓ Following';
                } else {
                    btn.classList.remove('following');
                    btn.textContent = '+ Follow';
                }
                showToast('Failed to update follow status', 'error');
            }
        }

        // Follow button on post cards
        async function togglePostFollow(btn, event) {
            if (event) event.stopPropagation();
            if (!isLoggedIn) { showToast('Connect wallet to follow users', 'error'); return; }
            var userId = btn.dataset.userId;
            if (!userId) return;
            var wasFollowing = btn.classList.contains('following');

            // Optimistic UI
            if (wasFollowing) {
                btn.classList.remove('following');
                btn.innerHTML = '+ Follow';
                btn.style.background = 'transparent';
                btn.style.color = 'var(--primary)';
            } else {
                btn.classList.add('following');
                btn.innerHTML = '&#x2713; Following';
                btn.style.background = 'var(--primary)';
                btn.style.color = '#fff';
            }
            // Update all follow buttons for same user on page
            document.querySelectorAll('.post-follow-btn[data-user-id="' + userId + '"]').forEach(function(b) {
                if (b === btn) return;
                if (wasFollowing) {
                    b.classList.remove('following');
                    b.innerHTML = '+ Follow';
                    b.style.background = 'transparent';
                    b.style.color = 'var(--primary)';
                } else {
                    b.classList.add('following');
                    b.innerHTML = '&#x2713; Following';
                    b.style.background = 'var(--primary)';
                    b.style.color = '#fff';
                }
            });

            try {
                await api('/users/' + userId + '/follow', { method: 'POST' });
            } catch (err) {
                // Revert all
                document.querySelectorAll('.post-follow-btn[data-user-id="' + userId + '"]').forEach(function(b) {
                    if (wasFollowing) {
                        b.classList.add('following');
                        b.innerHTML = '&#x2713; Following';
                        b.style.background = 'var(--primary)';
                        b.style.color = '#fff';
                    } else {
                        b.classList.remove('following');
                        b.innerHTML = '+ Follow';
                        b.style.background = 'transparent';
                        b.style.color = 'var(--primary)';
                    }
                });
                showToast('Failed to update follow status', 'error');
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

        function performSearch(inputId, resultsId) {
            const input      = document.getElementById(inputId);
            const query      = input.value.trim().toLowerCase();
            const resultsDiv = document.getElementById(resultsId);
            const clearBtnId = inputId.replace('Search', 'SearchClearBtn');
            const clearBtn   = document.getElementById(clearBtnId);

            if (clearBtn) clearBtn.style.display = query ? 'block' : 'none';

            if (!query) {
                resultsDiv.style.display = 'none';
                resultsDiv.innerHTML = '';
                return;
            }

            harvestPostsFromFeed();

            const userMatches = mockUsers.filter(u =>
                u.username.toLowerCase().includes(query) ||
                u.displayName.toLowerCase().includes(query)
            );

            const postMatches = searchPosts.filter(p =>
                p.content.toLowerCase().includes(query) ||
                p.author.toLowerCase().includes(query) ||
                p.topic.toLowerCase().includes(query)
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
                out += userMatches.map(u =>
                    '<div class="search-result-item" onclick="goToProfile(\'' + u.username + '\');clearSearch(\'' + inputId + '\',\'' + resultsId + '\',\'' + clearBtnId + '\')">'
                    + '<div class="search-result-user">'
                    + '<div class="search-result-avatar">' + u.username[0].toUpperCase() + '</div>'
                    + '<div class="search-result-info">'
                    + '<div class="search-result-name">' + escapeHtml(u.username) + (u.verified ? ' <span class="verified-badge" style="font-size:0.65em;padding:1px 6px;">&#10003;</span>' : '') + '</div>'
                    + '<div class="search-result-meta">' + u.followers + ' followers</div>'
                    + '</div></div></div>'
                ).join('');
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

        // ── Navigate to a user's profile ──────────────────────────────────
        var _viewingProfileId = null;

        async function goToProfile(username) {
            ['followersModal','followingModal'].forEach(function(id) {
                var el = document.getElementById(id);
                if (el) el.style.display = 'none';
            });
            var notifPanel = document.getElementById('notificationsPanel');
            if (notifPanel) notifPanel.style.display = 'none';

            switchScreen('profile');

            var me = getStoredUser();
            // If viewing own profile (or no username given)
            if (!username || (me && me.username && username.toLowerCase() === me.username.toLowerCase())) {
                loadMyProfile();
                return;
            }

            // Loading state
            var nameEl = document.querySelector('.profile-username-text');
            if (nameEl) nameEl.textContent = username;

            try {
                var profileData = await api('/users/by-username/' + encodeURIComponent(username));
                _viewingProfileId = profileData.id;
                renderProfileDisplay(profileData);
                loadProfilePosts(profileData.id);
            } catch (e) {
                showToast('User not found', 'error');
            }
        }

        // ── Load own profile ────────────────────────────────────────────
        async function loadMyProfile() {
            if (!isLoggedIn) {
                renderProfileDisplay(null);
                return;
            }
            try {
                var profileData = await api('/users/me');
                _viewingProfileId = profileData.id;

                // Keep local cache in sync
                var user = getStoredUser();
                if (user) {
                    Object.assign(user, {
                        username:    profileData.username,
                        displayName: profileData.displayName,
                        bio:         profileData.bio,
                        avatarUrl:   profileData.avatarUrl,
                        location:    profileData.location,
                        website:     profileData.website,
                        isVerified:  profileData.isVerified,
                        isProfileComplete: profileData.isProfileComplete
                    });
                    localStorage.setItem('wf_user', JSON.stringify(user));
                }

                renderProfileDisplay(profileData);
                loadProfilePosts(profileData.id);
            } catch (e) {
                console.error('Failed to load profile:', e);
            }
        }

        // ── Render profile display from API data ─────────────────────
        function renderProfileDisplay(data) {
            var me = getStoredUser();
            var isOwn = !data || (me && data && data.id === me.id);

            // Username
            var nameEl = document.querySelector('.profile-username-text');
            if (nameEl) nameEl.textContent = data ? (data.displayName || data.username || 'Unknown') : (me?.username || 'Connect Wallet');

            // Verified badge
            var verBadge = document.querySelector('.verified-badge-compact');
            if (verBadge) verBadge.style.display = (data?.isVerified) ? 'inline-flex' : 'none';

            // Avatar
            var avatarEl = document.querySelector('.profile-avatar-compact');
            if (avatarEl) {
                if (data?.avatarUrl) {
                    avatarEl.innerHTML = '<img src="' + escapeHtml(data.avatarUrl) + '" alt="Avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
                } else {
                    avatarEl.innerHTML = '';
                    avatarEl.textContent = (data?.username || me?.username || '?')[0].toUpperCase();
                }
            }

            // Stats
            var followersVal = document.querySelector('.stat-compact-value[data-stat="followers"]');
            var followingVal = document.querySelector('.stat-compact-value[data-stat="following"]');
            var postsVal     = document.querySelector('.stat-compact-value[data-stat="posts"]');
            if (followersVal) followersVal.textContent = formatCount(data?.followersCount || 0);
            if (followingVal) followingVal.textContent = formatCount(data?.followingCount || 0);
            if (postsVal)     postsVal.textContent     = formatCount(data?.postsCount || 0);

            // Bio
            var bioEl = document.querySelector('.profile-bio-compact');
            if (bioEl) bioEl.textContent = data?.bio || '';

            // Meta — location, website, joined
            var metaEl = document.querySelector('.profile-meta-compact');
            if (metaEl) {
                var metaHtml = '';
                if (data?.location) metaHtml += '<span class="meta-item">📍 ' + escapeHtml(data.location) + '</span>';
                if (data?.website)  metaHtml += '<span class="meta-item">🌐 <a href="' + escapeHtml(data.website) + '" target="_blank" rel="noopener noreferrer" style="color:var(--primary);text-decoration:none;">' + escapeHtml(data.website) + '</a></span>';
                if (data?.createdAt) {
                    var d = new Date(data.createdAt);
                    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                    metaHtml += '<span class="meta-item">📅 ' + months[d.getMonth()] + ' ' + d.getFullYear() + '</span>';
                }
                metaEl.innerHTML = metaHtml || '<span class="meta-item">📅 Just joined</span>';
            }

            // Follow button — show/hide based on own vs other profile
            var followBtn = document.querySelector('.follow-btn-compact');
            if (followBtn) {
                if (isOwn) {
                    followBtn.style.display = 'none';
                } else {
                    followBtn.style.display = '';
                    followBtn.dataset.userId = data?.id || '';
                    if (data?.isFollowing) {
                        followBtn.classList.add('following');
                        followBtn.textContent = '✓ Following';
                    } else {
                        followBtn.classList.remove('following');
                        followBtn.textContent = '+ Follow';
                    }
                }
            }

            // Settings button — only visible on own profile
            var settingsBtn = document.querySelector('.profile-actions-row');
            if (settingsBtn) settingsBtn.style.display = isOwn ? '' : 'none';

            // Wallet address row
            if (data?.walletAddress) {
                var addrEl = document.getElementById('profileWalletAddress');
                var copyBtn = document.getElementById('profileWalletCopyBtn');
                if (addrEl) addrEl.textContent = data.walletAddress.substring(0, 6) + '...' + data.walletAddress.substring(data.walletAddress.length - 4);
                if (copyBtn) copyBtn.style.display = 'inline-flex';
            }

            // Populate settings form with current values (for own profile)
            if (isOwn && data) {
                var uEl = document.getElementById('username');
                var dEl = document.getElementById('displayName');
                var bEl = document.getElementById('bio');
                var lEl = document.getElementById('location');
                var wEl = document.getElementById('website');
                if (uEl) uEl.value = data.username || '';
                if (dEl) dEl.value = data.displayName || '';
                if (bEl) bEl.value = data.bio || '';
                if (lEl) lEl.value = data.location || '';
                if (wEl) wEl.value = data.website || '';

                // Settings avatar
                var settingsAvatar = document.getElementById('settingsAvatar');
                if (settingsAvatar) {
                    if (data.avatarUrl) {
                        settingsAvatar.innerHTML = '<img src="' + escapeHtml(data.avatarUrl) + '" alt="Avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
                    } else {
                        settingsAvatar.innerHTML = '';
                        settingsAvatar.textContent = (data.username || '?')[0].toUpperCase();
                    }
                }
            }

            // Show display view
            toggleProfileView('display');
        }

        // ── Format numbers (1234 → "1.2k") ──────────────────────────
        function formatCount(n) {
            n = parseInt(n) || 0;
            if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
            if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
            return '' + n;
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
                switchChatRoom(room.id, room.name, room.description || room.topic);
            } catch(e) {
                showToast('Failed to create room: ' + (e.message || ''), 'error');
            } finally {
                if (btn) { btn.disabled = false; btn.textContent = 'Create Room'; }
            }
        }

        // ── Compact chatroom send ─────────────────────────────────────────
        function sendCompactChatMessage() {
            var input = document.getElementById('compactChatInput');
            var message = input ? input.value.trim() : '';
            if (!message) return;
            if (!isLoggedIn) { showToast('Connect your wallet to chat', 'error'); return; }
            if (!activeChatRoomId) { showToast('Select a chat room first', 'error'); return; }

            var storedUser = getStoredUser ? getStoredUser() : null;
            var myName = (storedUser && storedUser.username) || currentUser || 'You';
            var now = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

            var area = document.getElementById('chatMessagesArea');
            if (area) {
                var myAvatarUrl = storedUser && storedUser.avatarUrl;
                var pfpStyle = myAvatarUrl ? ' style="background-image:url(' + myAvatarUrl + ');background-size:cover;background-position:center;"'
                    : (USER_AVATARS[myName] ? ' style="background-image:url(' + USER_AVATARS[myName] + ');background-size:cover;background-position:center;"' : '');
                var initial  = (myAvatarUrl || USER_AVATARS[myName]) ? '' : myName[0].toUpperCase();

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
            var area = document.getElementById('chatMessagesArea');
            if (!area) return;
            roomId = roomId || activeChatRoomId;

            if (!roomId) {
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
                _lastMessageTimestamp = msgs[msgs.length - 1].created_at;
            } catch(e) {
                // Keep existing content on failure
            }
        }

        async function pollNewChatMessages(roomId) {
            if (!_lastMessageTimestamp || !roomId) return;
            var area = document.getElementById('chatMessagesArea');
            if (!area) return;
            try {
                var data = await api('/chat/rooms/' + roomId + '/messages?after=' + encodeURIComponent(_lastMessageTimestamp));
                var msgs = (data && data.messages) || [];
                if (!msgs.length) return;

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
            }, 5000);
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
            const lockToggle = document.getElementById('privacyLockToggle');
            const lockIcon = lockToggle.querySelector('.lock-icon');
            const lockLabel = lockToggle.querySelector('.lock-label');

            // Toggle state
            isPrivateAccount = !isPrivateAccount;

            if (isPrivateAccount) {
                // LOCK IT (Private)
                lockIcon.textContent = '🔒';
                lockLabel.textContent = 'Private Account';
                lockToggle.classList.add('locked');

                alert('🔒 Account Locked (Private)\n\nYour profile and posts are now private. Only approved followers can see your content.');
            } else {
                // UNLOCK IT (Public)
                lockIcon.textContent = '🔓';
                lockLabel.textContent = 'Public Account';
                lockToggle.classList.remove('locked');

                alert('🔓 Account Unlocked (Public)\n\nYour profile and posts are now public. Anyone can see your content.');
            }

            console.log('Private account:', isPrivateAccount);
        }

        // ══════════════════════════════════════════════════════════
        // CREATE POST MODAL (FAB)
        // ══════════════════════════════════════════════════════════

        function openCreatePostModal() {
            var overlay = document.getElementById('createPostModalOverlay');
            if (overlay) {
                overlay.classList.add('active');
                document.body.style.overflow = 'hidden';
                // Focus textarea after animation
                setTimeout(function() {
                    var ta = document.getElementById('postTextarea');
                    if (ta) ta.focus();
                }, 400);
            }
        }

        function closeCreatePostModal() {
            var overlay = document.getElementById('createPostModalOverlay');
            if (overlay) {
                overlay.classList.remove('active');
                document.body.style.overflow = '';
            }
        }

        function handleCreatePostOverlayClick(e) {
            if (e.target === e.currentTarget) {
                closeCreatePostModal();
            }
        }

        // Close modal on Escape key
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                var overlay = document.getElementById('createPostModalOverlay');
                if (overlay && overlay.classList.contains('active')) {
                    closeCreatePostModal();
                }
            }
        });

        // ══════════════════════════════════════════════════════════
        // DEXSCREENER TICKER — Live Memecoin Feed (via server proxy)
        // ══════════════════════════════════════════════════════════

        var _tickerInterval = null;
        var _tickerCache = null;

        function formatTickerPrice(price) {
            var n = parseFloat(price);
            if (isNaN(n)) return '$0.00';
            if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
            if (n >= 1) return '$' + n.toFixed(2);
            if (n >= 0.01) return '$' + n.toFixed(4);
            return '$' + n.toFixed(6);
        }

        function renderTickerItems(tokens) {
            var track = document.getElementById('tickerTrack');
            if (!track) return;

            var items = '';
            tokens.forEach(function(t) {
                var changeVal = parseFloat(t.priceChange || 0);
                var changeClass = changeVal >= 0 ? 'positive' : 'negative';
                var changeStr = (changeVal >= 0 ? '+' : '') + changeVal.toFixed(1) + '%';
                var iconHtml = t.icon
                    ? '<img class="ticker-icon" src="' + t.icon + '" alt="" onerror="this.style.display=\'none\'">'
                    : '';
                var linkOpen = t.url ? '<a href="' + t.url + '" target="_blank" rel="noopener" style="text-decoration:none;color:inherit;">' : '';
                var linkClose = t.url ? '</a>' : '';
                items += '<div class="ticker-item">'
                    + linkOpen
                    + iconHtml
                    + '<span class="ticker-symbol">' + (t.symbol || '???') + '</span>'
                    + '<span class="ticker-price">' + formatTickerPrice(t.price) + '</span>'
                    + '<span class="ticker-change ' + changeClass + '">' + changeStr + '</span>'
                    + linkClose
                    + '</div>';
            });
            // Duplicate for seamless infinite scroll
            track.innerHTML = items + items;
            track.style.animation = 'none';
            track.offsetHeight;
            track.style.animation = '';
        }

        function showTickerLoading() {
            var loading = document.getElementById('tickerLoading');
            var error = document.getElementById('tickerError');
            if (loading) loading.style.display = 'flex';
            if (error) error.style.display = 'none';
        }

        function showTickerError() {
            var track = document.getElementById('tickerTrack');
            if (!track) return;
            track.innerHTML =
                '<div class="ticker-error">'
                + '<span>\u26A0\uFE0F Failed to load token data</span>'
                + '<button class="ticker-error-retry" onclick="fetchTickerData()">Retry</button>'
                + '</div>';
        }

        async function fetchTickerData() {
            showTickerLoading();
            try {
                var res = await fetch('/api/ticker');
                if (!res.ok) throw new Error('HTTP ' + res.status);
                var tokens = await res.json();

                if (tokens.error) throw new Error(tokens.error);
                if (!Array.isArray(tokens) || tokens.length === 0) throw new Error('No tokens');

                _tickerCache = tokens;
                renderTickerItems(tokens);
            } catch (err) {
                console.error('Ticker fetch error:', err);
                if (_tickerCache) {
                    renderTickerItems(_tickerCache);
                } else {
                    showTickerError();
                }
            }
        }

        function startTickerPolling() {
            fetchTickerData();
            if (_tickerInterval) clearInterval(_tickerInterval);
            _tickerInterval = setInterval(fetchTickerData, 120000);
        }

        // Start ticker on DOM ready
        document.addEventListener('DOMContentLoaded', function() {
            startTickerPolling();
        });
