/*
 * Traps module (Trap Team)
 * - Keeps a cache "trap file -> captured villain id" so the library can show, search and filter
 *   traps by the villain they hold without opening each file on demand.
 * - Reads every trap dump in the background when the app starts (they are ~1 KB each) and again
 *   whenever a file changes: portal sync, clone, reset, delete.
 * - Paints the small villain badge and the "Captured: X" / "Empty" line on library cards.
 *   The portal bar and the info window reuse Traps.fillBadge() for the same badge.
 *
 * Only real traps (Trap Team / Trap) are handled here. "Special Villain" figures keep their
 * previous behaviour (the card shows the villain itself).
 *
 * All user-facing strings live in Traps.T so they can be translated later.
 */
const Traps = (function () {
    'use strict';

    const T = {
        captured: 'Captured',
        empty: 'Empty',
        unknown: 'Unknown'
    };

    // file -> villain id (0 = empty trap). Missing = not read yet, or the dump could not be decoded.
    const cache = new Map();
    let scanning = 0;   // number of scans running (a counter, scans can overlap)

    /* ------------------------------------------------------------------ */
    /* Helpers                                                             */
    /* ------------------------------------------------------------------ */
    function isTrapFile(file) {
        if (!file || typeof Library === 'undefined') return false;
        const meta = Library.itemFromFile(file);
        return meta.game === 'Trap Team' && meta.type === 'Trap';
    }

    function formatVillain(key) {
        return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[0-9]/g, '');
    }

    // { id, known, key, name, img } for a villain id, or null for 0 / invalid
    function villainInfo(vid) {
        if (!vid || vid < 1) return null;
        const map = (typeof VILLAIN_MAP !== 'undefined') ? VILLAIN_MAP : {};
        const key = map[vid];
        if (key) {
            return { id: vid, known: true, key, name: formatVillain(key), img: 'assets/TrappedVillain/' + key + '.png' };
        }
        return { id: vid, known: false, key: null, name: T.unknown + ' (ID ' + vid + ')', img: null };
    }

    /* ------------------------------------------------------------------ */
    /* Cache access                                                        */
    /* ------------------------------------------------------------------ */
    // 'villain' | 'empty' | null (null = not known yet)
    function status(file) {
        if (!cache.has(file)) return null;
        return cache.get(file) > 0 ? 'villain' : 'empty';
    }

    function villain(file) {
        return cache.has(file) ? villainInfo(cache.get(file)) : null;
    }

    function villainName(file) {
        const v = villain(file);
        return v ? v.name : '';
    }

    function isScanning() { return scanning > 0; }

    /* ------------------------------------------------------------------ */
    /* Card painting                                                       */
    /* ------------------------------------------------------------------ */
    // Fills a circular badge element with the villain image, or "?" when the villain is not in the list
    function fillBadge(badge, info) {
        badge.innerHTML = '';
        if (!info) return;
        if (info.img) {
            const img = document.createElement('img');
            img.alt = '';
            img.draggable = false;
            img.src = info.img;
            badge.appendChild(img);
        } else {
            badge.textContent = '?';
        }
        badge.title = info.name;
    }

    // Adds the (empty) badge and the status line to a trap card, then paints them from the cache
    function decorateCard(card, file) {
        const ring = card.querySelector('.circle-img-container');
        const nameEl = card.querySelector('.sky-name');
        if (!ring || !nameEl) return;

        const badge = document.createElement('div');
        badge.className = 'trap-badge';
        ring.appendChild(badge);

        const sub = document.createElement('div');
        sub.className = 'trap-sub';
        nameEl.insertAdjacentElement('afterend', sub);

        paintCard(card, file);
    }

    function paintCard(card, file) {
        const badge = card.querySelector('.trap-badge');
        const sub = card.querySelector('.trap-sub');
        if (!badge || !sub) return;

        const st = status(file);
        const info = villain(file);

        badge.classList.toggle('on', st === 'villain');
        fillBadge(badge, info);

        sub.innerHTML = '';
        sub.classList.toggle('is-empty', st === 'empty');
        sub.classList.toggle('is-pending', st === null);
        if (st === 'villain') {
            sub.appendChild(Object.assign(document.createElement('span'), { className: 'trap-sub-label', textContent: T.captured }));
            sub.appendChild(Object.assign(document.createElement('span'), { className: 'trap-sub-name', textContent: info.name }));
            sub.title = info.name;
        } else if (st === 'empty') {
            sub.appendChild(Object.assign(document.createElement('span'), { className: 'trap-sub-label', textContent: T.empty }));
            sub.title = '';
        }
    }

    // Repaint the cards of one file (or every trap card when file is omitted)
    function paintCards(file) {
        document.querySelectorAll('.sky-card[data-file]').forEach(card => {
            if (!card.querySelector('.trap-badge')) return;
            if (file === undefined || card.dataset.file === file) paintCard(card, card.dataset.file);
        });
    }

    /* ------------------------------------------------------------------ */
    /* Updating the cache                                                  */
    /* ------------------------------------------------------------------ */
    // Called by the portal sync with the id decoded from the live dump. Returns true when it changed.
    function set(file, vid) {
        if (typeof vid !== 'number' || vid < 0 || !isTrapFile(file)) return false;
        if (cache.get(file) === vid) return false;
        cache.set(file, vid);
        paintCards(file);
        refreshLibrary(true);
        return true;
    }

    function forget(file) {
        if (cache.delete(file)) refreshLibrary(true);
    }

    // Re-render the grid only when what is on screen depends on trap data
    function refreshLibrary(force) {
        if (typeof Library === 'undefined') return;
        const searching = !!(document.getElementById('search-bar') || {}).value;
        if (force || Library.state.villain !== 'all' || searching) Library.render();
    }

    // Reads the given files (only traps are looked at) and stores the villain id of each
    async function scan(files) {
        if (!window.SkylanderDecoder || typeof StorageManager === 'undefined') return;
        const list = files.filter(isTrapFile);
        if (!list.length) return;

        scanning++;
        let changed = false;
        try {
            for (let i = 0; i < list.length; i++) {
                const file = list[i];
                try {
                    const blob = await StorageManager.getFileBlob(file);
                    const vid = blob ? await window.SkylanderDecoder.decodeVillainId(blob) : null;
                    if (typeof vid === 'number' && vid >= 0 && cache.get(file) !== vid) {
                        cache.set(file, vid);
                        changed = true;
                    }
                } catch (e) {
                    console.warn('Could not read trap', file, e);
                }
                // Let the UI breathe between files
                if (i % 4 === 3) await new Promise(r => setTimeout(r, 0));
            }
        } finally {
            scanning--;
        }
        if (changed) {
            paintCards();
            refreshLibrary(true);
        }
    }

    function scanAll() {
        const files = (typeof allFiles !== 'undefined' && allFiles) ? allFiles : [];
        return scan(files);
    }

    return {
        T, isTrapFile, status, villain, villainName, villainInfo, isScanning,
        fillBadge, decorateCard, paintCard, paintCards,
        set, forget, scan, scanAll
    };
})();
