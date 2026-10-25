let serverIp = localStorage.getItem('serverIp');
if (!serverIp) {
    window.location.href = 'index.html';
}

const API_BASE = 'http://' + serverIp + ':5678';

// Generate a unique, persistent device ID for multi-player slot ownership
let deviceId = localStorage.getItem('deviceId');
if (!deviceId) {
    deviceId = 'dev_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now().toString(36);
    localStorage.setItem('deviceId', deviceId);
}

// One entry per portal slot. The portal bar (portal.js) draws everything from this state:
//   file: dump currently on the slot, name: display name, img: image shown for it,
//   stats: decoded { level, gold, nickname }, villainName: villain shown for Special Villain figures,
//   captured: villain held by a trap ({ id, known, name, img }, null when empty),
//   part: 'top' | 'bottom' for Swap Force halves,
//   pair: id shared by the two halves that were placed together (null when not part of a pair)
function newSlot() {
    return { file: null, syncInterval: null, isSyncing: false,
             name: null, img: null, stats: null, villainName: null, captured: null, part: null, pair: null };
}
let pairCounter = 0;
let slots = Array.from({length: 8}, newSlot);

// slotOwners[slotIndex] = deviceId string ('' = free)
let slotOwners = Array(8).fill('');

const VILLAIN_MAP = {
    1: 'ChompyMage', 2: 'DrKrankcase', 3: 'Wolfgang', 4: 'ChefPepperJack',  
    5: 'Nightshade', 6: 'Luminous', 7: 'GoldenQueen', 8: 'Dreamcatcher',  
    9: 'Gulper', 10: 'Kaos', 11: 'CuckooClocker', 12: 'BuzzerBeak', 
    13: 'ShieldShredder', 14: 'CrossCrow', 15: 'BoneChompy', 16: 'BrawlAndChain',
    17: 'BombShell', 18: 'MaskerMind', 19: 'ChillBill', 20: 'SheepCreep',
    21: 'Shrednaught', 22: 'ChompChest', 23: 'BroccoliGuy', 24: 'RageMage',
    25: 'LobGoblin', 26: 'Chompy', 27: 'Fisticuffs', 28: 'TrollingThunder',
    29: 'HoodSickle', 30: 'BruiserCruiser', 31: 'Brawlrus', 32: 'TussleSprout',
    33: 'Krankenstein', 34: 'ScrapShooter', 35: 'SlobberTrap', 36: 'Grinnade',
    37: 'BadJuju', 38: 'BlasterTron', 39: 'TaeKwonCrow', 40: 'Painyatta',
    41: 'SmokeScream', 42: 'EyeFive', 43: 'GraveClobber', 44: 'ThreatPack',
    45: 'MadLobs', 46: 'EyeScream'
};

function setScrollingName(element, nameText) {
    if (!element) return;
    if (nameText.length > 12) {
        element.innerHTML = `<marquee scrollamount="3">${nameText}</marquee>`;
    } else {
        element.textContent = nameText;
    }
}

let filePaths = {}; // originalName -> ["Giants", "Skylanders", "Air"]
let allFiles = [];

document.addEventListener('deviceready', init, false);
if (!window.cordova) {
    window.onload = init;
}

let initialized = false;
async function init() {
    if (initialized) return;
    initialized = true;

    // Native enhancements
    if (window.AndroidFullScreen) {
        window.AndroidFullScreen.immersiveMode(null, null);
    }
    if (window.plugins && window.plugins.insomnia) {
        window.plugins.insomnia.keepAwake();
    }
    document.addEventListener("backbutton", onBackKeyDown, false);

    // Game Map Tree is no longer needed because structures are identical!
    
    if (window.StorageManager) {
        await StorageManager.init();
    } else {
        alert("StorageManager not loaded!");
    }

    allFiles = StorageManager.fileList;
    Library.init();
    Swap.init();
    renderGrid();
    // Read every trap in the background so cards, search and filters know which villain each holds
    Traps.scanAll();

    // Connection failure tracking
    let consecutiveFailures = 0;
    const MAX_FAILURES = 3;

    let connectionPollInterval = null;

    function handlePortalDisconnect() {
        if (connectionPollInterval) {
            clearInterval(connectionPollInterval);
            connectionPollInterval = null;
        }
        // Stop all slot sync intervals
        slots.forEach((slot, i) => {
            if (slot.syncInterval) {
                clearInterval(slot.syncInterval);
                slot.syncInterval = null;
            }
            resetSlotInfo(slot);
            slot.isSyncing = false;
        });
        slotOwners.fill('');
        PortalBar.render();
        // Show disconnection message then go back to portal search
        const overlay = document.getElementById('loading-overlay');
        const txt = document.getElementById('loading-text');
        if (overlay && txt) {
            txt.textContent = 'Portal disconnected. Searching...';
            overlay.classList.add('show');
        }
        setTimeout(() => { window.location.href = 'index.html'; }, 2000);
    }

    // Heartbeat + slot status polling (every 2 seconds)
    connectionPollInterval = setInterval(async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1500);
        
        try {
            await fetch(API_BASE + '/heartbeat?deviceId=' + encodeURIComponent(deviceId), { signal: controller.signal });
        } catch(e) {}
        
        try {
            const r = await fetch(API_BASE + '/slots', { cache: 'no-store', signal: controller.signal });
            if (r.ok) {
                consecutiveFailures = 0;
                const data = await r.json();
                let changed = false;
                data.slots.forEach(s => {
                    if (slotOwners[s.slot] !== s.owner) {
                        slotOwners[s.slot] = s.owner;
                        changed = true;
                    }
                });
                if (changed) updateAllSlotLockUI();
            } else if (r.status !== 400 && r.status !== 404) {
                consecutiveFailures++;
                if (consecutiveFailures >= MAX_FAILURES) handlePortalDisconnect();
            }
        } catch(e) {
            consecutiveFailures++;
            if (consecutiveFailures >= MAX_FAILURES) handlePortalDisconnect();
        } finally {
            clearTimeout(timeoutId);
        }
    }, 2000);

    PortalBar.init();

    // Hide overlay
    document.getElementById('loading-overlay').classList.remove('show');

    // Search event
    document.getElementById('search-bar').addEventListener('input', renderGrid);
}

function getOriginalName(name) {
    let base = name.substring(name.lastIndexOf('/') + 1).trim();
    if (base.includes(' - ')) {
        return base.split(' - ')[0].trim();
    }
    return base;
}

function goBack() {
    Library.goBack();
}

function onBackKeyDown(e) {
    // Never exit the app with the back button: close the combiner / portal info window / expanded bar
    // first, then step back through filters/tabs
    e.preventDefault();
    if (Swap.handleBack()) return;
    if (PortalBar.handleBack()) return;
    Library.handleBack();
}

function renderGrid() {
    Library.render();
}

function createCard(item, opts = {}) {
    // Swap Force characters (a bottom + a top) have their own card, see swap.js
    if (item.kind === 'combo') return Swap.createCard(item);

    const card = document.createElement('div');
    card.className = 'sky-card premium-glass-card';

    const imgContainer = document.createElement('div');
    imgContainer.className = 'circle-img-container premium-glass-img';
    
    // Ring colour follows the element (third folder level); gold when there is none
    const element = item.element || (item.path.length > 2 ? item.path[2] : null);
    const ringColor = Library.elementColor(element);

    imgContainer.style.setProperty('--ring-color', ringColor);
    
    const img = document.createElement('img');
    let imgPath = [...item.path, item.originalName + '.png'].map(encodeURIComponent).join('/');
    img.src = 'assets/SkylandersImages/' + imgPath;
    
    img.onerror = () => { img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'; };

    imgContainer.appendChild(img);

    const nameEl = document.createElement('div');
    nameEl.className = 'sky-name';
    // Format name: Add spaces before uppercase letters and remove numbers
    setScrollingName(nameEl, item.name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[0-9]/g, ''));

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'card-actions';

    const isClone = item.name !== item.originalName;
    const virginPath = [...item.path, item.originalName + '.dump'].join('/');

    // Top-left: reset (originals) or trash (clones). Top-right: favourite star.
    // Bottom-left: small clone button. (Swap Force characters use the card in swap.js.)
    if (!opts.minimal) {
        const leftBtn = document.createElement('button');
        leftBtn.className = 'reset-btn action-pop';
        if (isClone) {
            leftBtn.innerHTML = '🗑️';
            leftBtn.style.background = 'rgba(255, 50, 50, 0.6)';
            leftBtn.onclick = (e) => {
                e.stopPropagation();
                showResetOverlay(item.file, item.name, 'delete');
            };
        } else {
            leftBtn.innerHTML = '↻';
            leftBtn.onclick = (e) => {
                e.stopPropagation();
                showResetOverlay(item.file, item.name, 'reset');
            };
        }
        actionsDiv.appendChild(leftBtn);

        const favBtn = document.createElement('button');
        favBtn.className = 'fav-btn action-pop';
        const favImg = document.createElement('img');
        favImg.alt = '';
        favBtn.appendChild(favImg);
        const paintFav = () => {
            const on = Library.isFavorite(item.file);
            favImg.src = on ? 'assets/fav-sm.png' : 'assets/unfav-sm.png';
            favBtn.classList.toggle('is-fav', on);
            favBtn.title = on ? Library.T.removeFav : Library.T.addFav;
        };
        paintFav();
        favBtn.onclick = (e) => {
            e.stopPropagation();
            Library.toggleFavorite(item.file);
            if (Library.state.tab === 'favorites') {
                renderGrid(); // the card leaves this tab when un-starred
            } else {
                paintFav();
            }
        };
        actionsDiv.appendChild(favBtn);

        const cloneBtn = document.createElement('button');
        cloneBtn.className = 'clone-btn action-pop';
        cloneBtn.innerHTML = '➕';
        cloneBtn.onclick = async (e) => {
            e.stopPropagation();
            let suffix = prompt("Variant Name (e.g. PVP):", "Clone");
            if (suffix) {
                let copyData = confirm("Do you want to copy the current progress?\n\nOK = Copy Progress\nCancel = Empty Level 1 Clone");
                const newFile = await StorageManager.cloneFile(virginPath, suffix, copyData ? item.file : null);
                allFiles = StorageManager.fileList;
                await Traps.scan([newFile]);
                renderGrid();
            }
        };
        card.appendChild(cloneBtn);
    }

    card.appendChild(actionsDiv);
    card.appendChild(imgContainer);
    card.appendChild(nameEl);

    const isStatable = item.file.includes('Skylanders') || item.file.includes('Creation Crystal');
    const isRealTrap = item.path[0] === 'Trap Team' && item.path[1] === 'Trap';
    const isTrap = item.file.includes('Special Villain'); // figures that show the villain itself

    if (isRealTrap) {
        // The trap stays the main image and name; the captured villain is a small badge + a status line
        Traps.decorateCard(card, item.file);
    } else if (isStatable) {
        const statsDiv = document.createElement('div');
        statsDiv.className = 'slot-stats';
        statsDiv.style.flexDirection = 'row';
        statsDiv.style.marginTop = '10px';
        statsDiv.dataset.file = item.file; // Added so it can be updated on sync
        card.appendChild(statsDiv);

        // Load stats asynchronously from local device storage
        StorageManager.getFileBlob(item.file).then(blob => {
            if (blob && window.SkylanderDecoder) {
                const isCrystal = item.file.toLowerCase().includes('crystal') || item.name.toLowerCase().includes('claw');
                window.SkylanderDecoder.decodeStats(blob, isCrystal).then(stats => {
                    if (stats) {
                        statsDiv.innerHTML = `<span class="stat-badge stat-lvl">Lvl ${stats.level}</span><span class="stat-badge stat-gold">💰 ${stats.gold}</span>`;
                        if (stats.nickname && stats.nickname.length > 0) {
                            setScrollingName(nameEl, stats.nickname);
                        }
                    }
                }).catch(err => console.error("Failed to decode stats for", item.name, err));
            }
        }).catch(err => console.error("Failed to load blob for", item.name, err));
    } else if (isTrap) {
        // Load villain asynchronously
        StorageManager.getFileBlob(item.file).then(blob => {
            if (blob && window.SkylanderDecoder) {
                window.SkylanderDecoder.decodeVillainId(blob).then(vid => {
                    if (vid > 0) {
                        const villainName = VILLAIN_MAP[vid];
                        if (villainName) {
                            img.src = 'assets/TrappedVillain/' + villainName + '.png';
                            setScrollingName(nameEl, villainName.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[0-9]/g, ''));
                        } else {
                            console.warn("Unknown Villain ID:", vid, "for file", item.file);
                            img.src = '';
                            setScrollingName(nameEl, 'Unknown (ID ' + vid + ')');
                        }
                    }
                }).catch(err => console.error("Failed to decode trap villain for", item.name, err));
            }
        }).catch(err => console.error("Failed to load trap blob for", item.name, err));
    }

    card.dataset.file = item.file; // Tag the card with the file path for real-time updates
    
    card.onclick = () => summon(item.file, item.name, img.src);

    return card;
}

// How many slots this device can still fill (free and not locked by another player)
function freeSlotCount() {
    let n = 0;
    for (let i = 0; i < slots.length; i++) {
        if (!slots[i].file && (!slotOwners[i] || slotOwners[i] === deviceId)) n++;
    }
    return n;
}

// Places a Swap Force pair (bottom + top) and marks the two slots as a pair on the portal bar.
// Nothing is placed unless both halves can be: not already on the portal and 2 free slots.
async function summonSwapForce(bFile, tFile) {
    const bItem = Library.itemFromFile(bFile);
    const bName = bItem.name, bImg = Library.imageFor(bFile);

    if (!tFile) {
        await summon(bFile, bName, bImg);
        return;
    }
    const tItem = Library.itemFromFile(tFile);
    const tName = tItem.name, tImg = Library.imageFor(tFile);

    if (slots.some(s => s.file === bFile || s.file === tFile)) {
        alert(Swap.T.alreadyOnPortal);
        return;
    }
    if (freeSlotCount() < 2) {
        alert(Swap.T.needSlots);
        return;
    }

    const bSlot = await summon(bFile, bName, bImg);
    if (bSlot < 0) return;
    // small delay to ensure slot locking works smoothly
    await new Promise(r => setTimeout(r, 500));
    const tSlot = await summon(tFile, tName, tImg);
    if (tSlot < 0) {
        await clearSlot(bSlot); // never leave a lone half behind
        alert(Swap.T.placeFailed);
        return;
    }

    const pair = ++pairCounter;
    slots[bSlot].pair = pair;
    slots[tSlot].pair = pair;
    Library.addRecentCombo(bFile, tFile);
    PortalBar.render();
}

// Redraw the portal bar (also reflects slots locked by other players)
function updateAllSlotLockUI() {
    PortalBar.render();
}

function formatName(name) {
    // Add spaces before uppercase letters and remove numbers (same as the cards)
    return name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[0-9]/g, '');
}

function resetSlotInfo(slot) {
    slot.file = null;
    slot.name = null;
    slot.img = null;
    slot.stats = null;
    slot.villainName = null;
    slot.captured = null;
    slot.part = null;
    slot.pair = null;
}

// Decode a dump (stats or captured villain) and publish it to the portal bar and the library cards
async function applySlotBlob(slotIndex, b) {
    const slot = slots[slotIndex];
    const file = slot.file;
    if (!file || !window.SkylanderDecoder) return;

    const lower = file.toLowerCase();
    const isStatable = file.includes('Skylanders') || file.includes('Creation Crystal') || lower.includes('claw');
    const meta = Library.itemFromFile(file);
    const isRealTrap = meta.game === 'Trap Team' && meta.type === 'Trap';
    const isTrap = file.includes('Special Villain'); // figures that show the villain itself

    if (isStatable) {
        const isCrystal = lower.includes('crystal') || lower.includes('claw');
        const stats = await window.SkylanderDecoder.decodeStats(b, isCrystal);
        if (stats && slots[slotIndex].file === file) {
            slot.stats = stats;
            PortalBar.render();

            // Update the card in the grid without needing to refresh the page
            document.querySelectorAll('.slot-stats').forEach(div => {
                if (div.dataset.file === file) {
                    div.innerHTML = `<span class="stat-badge stat-lvl">Lvl ${stats.level}</span><span class="stat-badge stat-gold">💰 ${stats.gold}</span>`;
                }
            });
        }
    } else if (isRealTrap) {
        // The slot keeps showing the trap; the captured villain goes in `captured` (badge + info window)
        const vid = await window.SkylanderDecoder.decodeVillainId(b);
        if (typeof vid === 'number' && slots[slotIndex].file === file) {
            slot.captured = Traps.villainInfo(vid); // null when the trap is empty
            Traps.set(file, vid);                   // updates cards, search and filters too
            PortalBar.render();
        }
    } else if (isTrap) {
        const vid = await window.SkylanderDecoder.decodeVillainId(b);
        // 0 = empty trap: keep the trap's own image and name
        if (vid && vid > 0 && slots[slotIndex].file === file) {
            console.log(`[POLL] Slot ${slotIndex} - Decoded vid: ${vid}`);
            const villainName = VILLAIN_MAP[vid];
            const card = document.querySelector('.sky-card[data-file="' + file.replace(/\\/g, '\\\\') + '"]');
            if (villainName) {
                const displayName = formatName(villainName);
                slot.img = 'assets/TrappedVillain/' + villainName + '.png';
                slot.villainName = displayName;
                if (card) {
                    const img = card.querySelector('img');
                    if (img) img.src = 'assets/TrappedVillain/' + villainName + '.png';
                    setScrollingName(card.querySelector('.sky-name'), displayName);
                }
            } else {
                slot.villainName = 'Unknown (ID ' + vid + ')';
                if (card) {
                    const img = card.querySelector('img');
                    if (img) img.src = '';
                    setScrollingName(card.querySelector('.sky-name'), 'Unknown (ID ' + vid + ')');
                }
            }
            PortalBar.render();
        }
    }
}

// Every figure dump is exactly 1 KB (MIFARE 1K layout)
const DUMP_SIZE = 1024;

// Downloads the dump of a slot from the emulator. Throws unless a complete dump arrives.
// cache: 'no-store' + a unique query string make sure the WebView never answers from its HTTP cache.
async function fetchSlotDump(slotIndex, timeoutMs = 4000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(API_BASE + '/download?slot=' + slotIndex + '&_=' + Date.now(),
                                { cache: 'no-store', signal: controller.signal });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const blob = await res.blob();
        if (blob.size !== DUMP_SIZE) throw new Error('Unexpected dump size: ' + blob.size);
        return blob;
    } finally {
        clearTimeout(timer);
    }
}

// Last chance to keep a figure's progress (called right before it is removed / on disconnect).
// Retries a few times and returns true only when a valid dump was stored on the phone.
async function forceManualSync(slotIndex) {
    const slot = slots[slotIndex];
    if (!slot.file) return true;

    while (slot.isSyncing) {
        await new Promise(r => setTimeout(r, 100));
    }
    slot.isSyncing = true;

    const file = slot.file;
    let saved = false;
    try {
        console.log("Final Sync for " + file + " on slot " + slotIndex);
        for (let attempt = 1; attempt <= 3 && !saved; attempt++) {
            try {
                const blob = await fetchSlotDump(slotIndex);
                await StorageManager.saveFromServer(file, blob);
                saved = true;
                try {
                    // Refresh the portal bar and the library card with what was just saved
                    await applySlotBlob(slotIndex, blob);
                    await Traps.scan([file]); // pick up a villain captured since the last poll
                } catch (e) {
                    console.warn("Saved, but could not refresh the UI for", file, e);
                }
            } catch (e) {
                console.error("Final sync attempt " + attempt + " failed for " + file, e);
                if (attempt < 3) await new Promise(r => setTimeout(r, 400));
            }
        }
    } finally {
        slot.isSyncing = false;
    }
    return saved;
}

// Returns the slot index the figure was placed on, or -1 when it could not be placed
async function summon(file, name, imgSrc) {
    let placedSlot = -1;
    if (slots.some(slot => slot.file === file)) {
        alert("This Skylander is already on the portal! Clone it (➕) if you want to place two of the same.");
        return -1;
    }

    const overlay = document.getElementById('loading-overlay');
    document.getElementById('loading-text').textContent = 'Summoning...';
    overlay.classList.add('show');

    try {
        let targetSlot = -1;
        for (let i = 0; i < slots.length; i++) {
            // Skip slots that are locally in use OR owned by another player
            if (!slots[i].file && (!slotOwners[i] || slotOwners[i] === deviceId)) {
                targetSlot = i;
                break;
            }
        }
        
        if (targetSlot === -1) {
            alert("No empty slots on the portal! Please remove a Skylander before adding another.");
            overlay.classList.remove('show');
            return -1;
        }

        if (slots[targetSlot].file) {
            if (slots[targetSlot].syncInterval) {
                clearInterval(slots[targetSlot].syncInterval);
                slots[targetSlot].syncInterval = null;
            }
            await forceManualSync(targetSlot);
        }

        const blob = await StorageManager.getFileBlob(file);

        // --- ATOMIC CLAIM: prenota lo slot prima di scrivere il file ---
        // Tenta il claim dello slot scelto; se 409, scala al prossimo libero
        let claimRes = await fetch(API_BASE + '/claim?slot=' + targetSlot + '&deviceId=' + encodeURIComponent(deviceId));
        if (claimRes.status === 409) {
            // Trova il prossimo slot libero non occupato da altri
            let fallbackSlot = -1;
            for (let i = 0; i < slots.length; i++) {
                if (i !== targetSlot && !slots[i].file && (!slotOwners[i] || slotOwners[i] === deviceId)) {
                    fallbackSlot = i;
                    break;
                }
            }
            if (fallbackSlot === -1) {
                alert('All available slots are occupied by other players!');
                overlay.classList.remove('show');
                return -1;
            }
            targetSlot = fallbackSlot;
            claimRes = await fetch(API_BASE + '/claim?slot=' + targetSlot + '&deviceId=' + encodeURIComponent(deviceId));
        }
        if (!claimRes.ok) {
            alert('Could not claim slot ' + targetSlot);
            overlay.classList.remove('show');
            return -1;
        }

        const res = await fetch(API_BASE + '/upload?slot=' + targetSlot, {
            method: 'POST',
            body: blob,
            headers: {
                'Content-Type': 'text/plain'
            }
        });

        // 409: slot taken by another player at the last moment → try next free slot
        if (res.status === 409) {
            let fallbackSlot = -1;
            for (let i = 0; i < slots.length; i++) {
                if (i !== targetSlot && !slots[i].file && (!slotOwners[i] || slotOwners[i] === deviceId)) {
                    fallbackSlot = i;
                    break;
                }
            }
            if (fallbackSlot === -1) {
                alert('All available slots are occupied by other players!');
                overlay.classList.remove('show');
                return -1;
            }
            targetSlot = fallbackSlot;
            const retryRes = await fetch(API_BASE + '/upload?slot=' + targetSlot, {
                method: 'POST',
                body: blob,
                headers: { 'Content-Type': 'text/plain' }
            });
            if (!retryRes.ok) {
                alert('Failed to send ' + name);
                overlay.classList.remove('show');
                return -1;
            }
        } else if (!res.ok) {
            alert('Failed to send ' + name);
            overlay.classList.remove('show');
            return -1;
        }

        if (res.ok || res.status === 409 /* già claimed da noi */) {
            // 409 sull'upload = slot già claimed da questo device = ok procedere col SUMMON
            // Trigger the Cemu USB emulated device to load the newly uploaded dump file
            const summonUrl = API_BASE + '/?cmd=SUMMON&slot=' + targetSlot + '&file=' + encodeURIComponent('SkylandersDumps/Slot' + targetSlot + '.dump') + '&deviceId=' + encodeURIComponent(deviceId);
            const summonRes = await fetch(summonUrl);
            if (!summonRes.ok) {
                console.warn("Upload succeeded but SUMMON trigger failed.");
            }
            // Mark slot as mine locally
            slotOwners[targetSlot] = deviceId;
            updateAllSlotLockUI();

            const placed = slots[targetSlot];
            placed.file = file;
            placed.isSyncing = false;
            placed.name = formatName(name);
            placed.img = imgSrc;
            placed.stats = null;
            placed.villainName = null;
            placed.captured = null;
            placed.pair = null;
            placedSlot = targetSlot;
            // Swap Force half (shown as a small marker on the slot)
            if (file.includes(' Top.dump') || file.includes(' Top - ')) placed.part = 'top';
            else if (file.includes(' Bottom.dump') || file.includes(' Bottom - ')) placed.part = 'bottom';
            else placed.part = null;
            Library.addRecent(file);

            // Show the figure on the bar right away, then fill in stats / captured villain
            PortalBar.render();
            try {
                await applySlotBlob(targetSlot, blob);
            } catch (e) {
                console.error('Initial decode failed for', file, e);
            }

            slots[targetSlot].syncInterval = setInterval(async () => {
                const slot = slots[targetSlot];
                if (!slot.file || slot.isSyncing) return;
                slot.isSyncing = true;
                try {
                    const b = await fetchSlotDump(targetSlot);
                    await StorageManager.saveFromServer(slot.file, b);
                    await applySlotBlob(targetSlot, b);
                } catch (e) {
                    console.warn('Periodic sync failed for slot ' + targetSlot, e);
                } finally {
                    slot.isSyncing = false;
                }
            }, 5000);
        } else {
            alert('Failed to send ' + name);
        }
    } catch (err) {
        alert('Connection error to Cemu');
    } finally {
        setTimeout(() => overlay.classList.remove('show'), 500);
    }
    return placedSlot;
}

async function clearSlot(slotIndex) {
    const slot = slots[slotIndex];
    if (!slot || !slot.file) return;

    document.getElementById('loading-overlay').classList.add('show');
    document.getElementById('loading-text').textContent = 'Removing...';

    if (slot.syncInterval) {
        clearInterval(slot.syncInterval);
        slot.syncInterval = null;
    }
    const saved = await forceManualSync(slotIndex);
    if (!saved) {
        // The dump could not be downloaded: removing now would lose whatever happened since the last sync
        const removeAnyway = confirm("Could not save the progress of this Skylander.\n\nOK = remove it anyway (progress since the last sync is lost)\nCancel = keep it on the portal");
        if (!removeAnyway) {
            // Resume periodic syncing for this slot
            slot.syncInterval = setInterval(async () => {
                if (!slot.file || slot.isSyncing) return;
                slot.isSyncing = true;
                try {
                    const b = await fetchSlotDump(slotIndex);
                    await StorageManager.saveFromServer(slot.file, b);
                    await applySlotBlob(slotIndex, b);
                } catch (e) {
                    console.warn('Periodic sync failed for slot ' + slotIndex, e);
                } finally {
                    slot.isSyncing = false;
                }
            }, 5000);
            document.getElementById('loading-overlay').classList.remove('show');
            return;
        }
    }
    resetSlotInfo(slot);

    try {
        await fetch(API_BASE + '/?cmd=CLEAR&slot=' + slotIndex + '&deviceId=' + encodeURIComponent(deviceId));
        slotOwners[slotIndex] = '';
    } catch (err) {
        console.error(err);
    } finally {
        PortalBar.render();
        document.getElementById('loading-overlay').classList.remove('show');
    }
}

async function disconnect() {
    document.getElementById('loading-overlay').classList.add('show');
    document.getElementById('loading-text').textContent = 'Saving...';

    for (let i = 0; i < 8; i++) {
        if (slots[i].syncInterval) clearInterval(slots[i].syncInterval);
    }

    await Promise.all(
        slots.map((slot, index) => slot.file ? forceManualSync(index) : Promise.resolve())
    );

    localStorage.removeItem('serverIp');
    window.location.href = 'index.html';
}

/* Reset Overlay Logic */
let resetTimeout = null;
let resetInterval = null;
let currentResetTarget = null;
let currentHoldAction = 'reset';

// itemFile is a file path, or an array of paths for a Swap Force pair (both halves at once)
function showResetOverlay(itemFile, itemName, action = 'reset') {
    currentResetTarget = itemFile;
    currentHoldAction = action;
    
    if (action === 'delete') {
        document.getElementById('reset-title').textContent = "Delete " + itemName + "?";
        document.getElementById('reset-hold-btn').querySelector('span').textContent = "Hold to Delete";
        document.getElementById('reset-hold-btn').style.background = "rgba(255, 50, 50, 0.8)";
    } else {
        document.getElementById('reset-title').textContent = "Reset " + itemName + " to Level 1?";
        document.getElementById('reset-hold-btn').querySelector('span').textContent = "Hold to Reset";
        document.getElementById('reset-hold-btn').style.background = "rgba(255, 50, 50, 0.8)";
    }
    
    document.getElementById('reset-progress').style.width = '0%';
    document.getElementById('reset-overlay').classList.remove('overlay-hidden');
}

function hideResetOverlay() {
    document.getElementById('reset-overlay').classList.add('overlay-hidden');
    currentResetTarget = null;
    clearResetTimers();
    document.getElementById('reset-progress').style.width = '0%';
}

function clearResetTimers() {
    if (resetTimeout) clearTimeout(resetTimeout);
    if (resetInterval) clearInterval(resetInterval);
    resetTimeout = null;
    resetInterval = null;
}

async function executeSafeReset(itemFile) {
    const files = Array.isArray(itemFile) ? itemFile : [itemFile];
    try {
        for (const file of files) {
            for (let i = 0; i < 8; i++) {
                if (slots[i] && slots[i].file === file) {
                    await clearSlot(i);
                }
            }
            await StorageManager.resetFile(file);
        }
        await Traps.scan(files);
        alert("Reset Completed!");
        renderGrid();
    } catch (err) {
        alert("Cannot find virgin file.");
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const holdBtn = document.getElementById('reset-hold-btn');
    const cancelBtn = document.getElementById('reset-cancel-btn');

    if (holdBtn) {
        holdBtn.addEventListener('mousedown', startResetHold);
        holdBtn.addEventListener('touchstart', startResetHold, {passive: false});
        holdBtn.addEventListener('mouseup', stopResetHold);
        holdBtn.addEventListener('mouseleave', stopResetHold);
        holdBtn.addEventListener('touchend', stopResetHold);
    }
    if (cancelBtn) {
        cancelBtn.addEventListener('click', hideResetOverlay);
    }
});

function startResetHold(e) {
    if (e.type === 'touchstart') e.preventDefault();
    if (!currentResetTarget) return;
    
    clearResetTimers();
    
    let progress = 0;
    const progressEl = document.getElementById('reset-progress');
    progressEl.style.transition = 'none';
    progressEl.style.width = '0%';
    
    const DURATION = 10000; // 10 seconds
    const INTERVAL = 50;
    const step = (INTERVAL / DURATION) * 100;
    
    resetInterval = setInterval(() => {
        progress += step;
        if (progress > 100) progress = 100;
        progressEl.style.width = progress + '%';
    }, INTERVAL);
    
    resetTimeout = setTimeout(async () => {
        clearResetTimers();
        const target = currentResetTarget;
        const action = currentHoldAction;
        hideResetOverlay();
        document.getElementById('loading-overlay').classList.add('show');
        
        if (action === 'delete') {
            document.getElementById('loading-text').textContent = 'Deleting...';
            const targets = Array.isArray(target) ? target : [target];
            for (const file of targets) {
                for (let i = 0; i < 8; i++) {
                    if (slots[i] && slots[i].file === file) {
                        await clearSlot(i);
                    }
                }
                await StorageManager.deleteClone(file);
                Library.forget(file);
                Traps.forget(file);
            }
            allFiles = StorageManager.fileList;
            renderGrid();
            alert("Delete Completed!");
        } else {
            document.getElementById('loading-text').textContent = 'Resetting...';
            await executeSafeReset(target);
        }
        
        document.getElementById('loading-overlay').classList.remove('show');
    }, DURATION);
}

function stopResetHold() {
    if (resetTimeout || resetInterval) {
        clearResetTimers();
        const progressEl = document.getElementById('reset-progress');
        progressEl.style.transition = 'width 0.3s ease-out';
        progressEl.style.width = '0%';
    }
}
