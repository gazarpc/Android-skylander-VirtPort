/*
 * Swap Force module
 * - Combo cards: how a Swap Force character (a bottom + a top) looks in the library, favorites and
 *   recents. The picture is the top half of the top character over the bottom half of the bottom
 *   character, so a custom mix really looks mixed.
 * - Combiner: full-screen window to pick any top and any bottom, filter by element, search, see the
 *   result and place it on the portal. Opened from the "Create combo" button of the Swap Force
 *   section, or from the swap button (🔀) of a card with that card's bottom already chosen.
 * - Reset / clone / delete on a combo act on the whole pair.
 *
 * Placing (summonSwapForce), recents and the pair marks on the portal bar live in app.js / portal.js.
 * All user-facing strings live in Swap.T so they can be translated later.
 */
const Swap = (function () {
    'use strict';

    const T = {
        title: 'Create combo',
        close: 'Close',
        top: 'Top',
        bottom: 'Bottom',
        chooseTop: 'Choose a top',
        chooseBottom: 'Choose a bottom',
        pickHint: 'Tap to choose',
        place: 'Place on portal',
        placeDisabled: 'Choose a top and a bottom',
        all: 'All',
        search: 'Search...',
        nothing: 'Nothing matches.',
        addFav: 'Add to favorites',
        removeFav: 'Remove from favorites',
        swapParts: 'Change the top',
        cloneName: 'Variant Name (e.g. PVP):',
        cloneCopy: 'Do you want to copy the current progress?\n\nOK = Copy Progress\nCancel = Empty Level 1 Clone',
        cloneBadName: 'The name cannot contain / \\ or |.',
        cloneExists: 'A clone with that name already exists for one of the halves. Pick another name.',
        cloneSaved: 'Clone created. Since it is a custom mix, it was saved in Favorites.',
        alreadyOnPortal: 'This Swap Force half is already on the portal! Clone the combo (➕) if you want to place it twice.',
        needSlots: 'A combo needs 2 free slots on the portal.',
        placeFailed: 'Could not place the second half, so the first one was removed.'
    };

    const state = { top: null, bottom: null, active: 'top', element: null, term: '' };
    let modal, grid, chips, search, favBtn, placeBtn, summary, title;

    function el(tag, className, text) {
        const e = document.createElement(tag);
        if (className) e.className = className;
        if (text !== undefined) e.textContent = text;
        return e;
    }

    function formatLabel(text) {
        return text.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[0-9]/g, '');
    }

    function isCloneFile(file) {
        const it = Library.itemFromFile(file);
        return it.name !== it.originalName;
    }

    // Path of the untouched original of a file (what a clone is made from)
    function virginPath(file) {
        const it = Library.itemFromFile(file);
        return [...it.path, it.originalName + '.dump'].join('/');
    }

    /* ------------------------------------------------------------------ */
    /* Library / favorites / recents card                                  */
    /* ------------------------------------------------------------------ */
    function buildHybridImage(item) {
        const ring = el('div', 'circle-img-container premium-glass-img combo-ring');
        const bColor = Library.elementColor(item.element);
        const tColor = Library.elementColor(item.topElement);
        ring.style.setProperty('--ring-color', bColor);
        if (tColor !== bColor) {
            ring.style.setProperty('--ring-color-2', tColor);
            ring.classList.add('two-tone');
        }

        const blank = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        const make = (file, cls) => {
            const img = document.createElement('img');
            img.className = 'combo-img ' + cls;
            img.alt = '';
            img.draggable = false;
            img.src = Library.imageFor(file);
            img.onerror = () => { img.src = blank; };
            return img;
        };
        // top half of the top character over the bottom half of the bottom character
        ring.appendChild(make(item.bottom, 'combo-img-bottom'));
        ring.appendChild(make(item.top || item.bottom, 'combo-img-top'));
        return ring;
    }

    function createCard(item) {
        const card = el('div', 'sky-card premium-glass-card combo-card');
        card.dataset.file = item.bottom;
        card.dataset.key = item.key;
        card.title = item.top ? Library.partLabel(Library.itemFromFile(item.top).name) + ' (top) + ' +
            Library.partLabel(Library.itemFromFile(item.bottom).name) + ' (bottom)' : '';

        const ring = buildHybridImage(item);

        const nameEl = el('div', 'sky-name');
        setScrollingName(nameEl, formatLabel(item.name));

        const actions = el('div', 'card-actions');
        const halves = [item.bottom, item.top].filter(Boolean);
        const cloneHalves = halves.filter(isCloneFile);

        // Top-left: reset (originals) or trash (any clone in the pair; only the clones are deleted)
        const leftBtn = el('button', 'reset-btn action-pop');
        if (cloneHalves.length) {
            leftBtn.innerHTML = '🗑️';
            leftBtn.style.background = 'rgba(255, 50, 50, 0.6)';
            leftBtn.onclick = e => {
                e.stopPropagation();
                showResetOverlay(cloneHalves, item.name, 'delete');
            };
        } else {
            leftBtn.innerHTML = '↻';
            leftBtn.onclick = e => {
                e.stopPropagation();
                showResetOverlay(halves, item.name, 'reset');
            };
        }
        actions.appendChild(leftBtn);

        // Top-right: favourite star (the pair is the favourite)
        const favBtn = el('button', 'fav-btn action-pop');
        const favImg = document.createElement('img');
        favImg.alt = '';
        favBtn.appendChild(favImg);
        const paintFav = () => {
            const on = Library.isFavorite(item.key);
            favImg.src = on ? 'assets/fav-sm.png' : 'assets/unfav-sm.png';
            favBtn.classList.toggle('is-fav', on);
            favBtn.title = on ? Library.T.removeFav : Library.T.addFav;
        };
        paintFav();
        favBtn.onclick = e => {
            e.stopPropagation();
            Library.toggleFavorite(item.key);
            if (Library.state.tab === 'favorites') renderGrid();
            else paintFav();
        };
        actions.appendChild(favBtn);

        // Bottom-left: clone the whole pair
        const cloneBtn = el('button', 'clone-btn action-pop', '➕');
        cloneBtn.onclick = e => {
            e.stopPropagation();
            cloneCombo(item);
        };
        card.appendChild(cloneBtn);

        // Bottom-right: open the combiner with this bottom already chosen
        const swapBtn = el('button', 'swap-btn action-pop', '🔀');
        swapBtn.title = T.swapParts;
        swapBtn.onclick = e => {
            e.stopPropagation();
            open({ bottom: item.bottom });
        };
        card.appendChild(swapBtn);

        card.appendChild(actions);
        card.appendChild(ring);
        card.appendChild(nameEl);

        // Level and gold of the bottom half (kept updated by the portal sync through data-file)
        const statsDiv = el('div', 'slot-stats');
        statsDiv.style.flexDirection = 'row';
        statsDiv.style.marginTop = '10px';
        statsDiv.dataset.file = item.bottom;
        card.appendChild(statsDiv);
        StorageManager.getFileBlob(item.bottom).then(blob => {
            if (blob && window.SkylanderDecoder) {
                window.SkylanderDecoder.decodeStats(blob, false).then(stats => {
                    if (stats) {
                        statsDiv.innerHTML = `<span class="stat-badge stat-lvl">Lvl ${stats.level}</span><span class="stat-badge stat-gold">💰 ${stats.gold}</span>`;
                    }
                }).catch(err => console.error('Failed to decode stats for', item.name, err));
            }
        }).catch(err => console.error('Failed to load blob for', item.name, err));

        card.onclick = () => summonSwapForce(item.bottom, item.top);
        return card;
    }

    // Clone both halves with the same suffix. A pair that is not the character's own pair would
    // be invisible in the library, so it is saved in Favorites.
    async function cloneCombo(item) {
        const raw = prompt(T.cloneName, 'Clone');
        if (!raw) return;
        const suffix = raw.trim();
        if (!suffix) return;
        if (/[\/\\|]/.test(suffix)) { alert(T.cloneBadName); return; }

        const copyData = confirm(T.cloneCopy);
        const halves = [item.bottom, item.top].filter(Boolean);
        const newNames = halves.map(f => virginPath(f).replace('.dump', '') + ' - ' + suffix + '.dump');
        if (newNames.some(n => allFiles.includes(n))) { alert(T.cloneExists); return; }

        const created = [];
        for (const f of halves) {
            created.push(await StorageManager.cloneFile(virginPath(f), suffix, copyData ? f : null));
        }
        allFiles = StorageManager.fileList;

        const nb = created[0];
        const nt = created[1] || null;
        let note = false;
        if (nt && nt !== Library.defaultTopFor(nb)) {
            const key = Library.comboKey(nb, nt);
            if (!Library.isFavorite(key)) Library.toggleFavorite(key);
            note = true;
        }
        renderGrid();
        if (note) alert(T.cloneSaved);
    }

    /* ------------------------------------------------------------------ */
    /* Combiner                                                            */
    /* ------------------------------------------------------------------ */
    function partsFor(part) {
        const all = Library.swapParts();
        return part === 'top' ? all.tops : all.bottoms;
    }

    function itemOf(file) { return file ? Library.itemFromFile(file) : null; }

    function paintSlot(part) {
        const slot = modal.querySelector('.combo-slot[data-part="' + part + '"]');
        const file = state[part];
        const disc = slot.querySelector('.combo-slot-disc');
        const img = slot.querySelector('img');
        const name = slot.querySelector('.combo-slot-name');
        slot.classList.toggle('active', state.active === part);
        slot.classList.toggle('filled', !!file);
        if (file) {
            const it = itemOf(file);
            disc.style.setProperty('--ring-color', Library.elementColor(it.element));
            img.src = Library.imageFor(file);
            name.textContent = formatLabel(Library.partLabel(it.name));
        } else {
            disc.style.removeProperty('--ring-color');
            img.removeAttribute('src');
            name.textContent = T.pickHint;
        }
    }

    function renderPreview() {
        paintSlot('top');
        paintSlot('bottom');
        const ready = !!(state.top && state.bottom);
        placeBtn.disabled = !ready;
        placeBtn.textContent = T.place;
        placeBtn.title = ready ? '' : T.placeDisabled;
        favBtn.disabled = !ready;
        if (ready) {
            const combo = Library.comboItem(state.bottom, state.top);
            summary.textContent = formatLabel(combo.name);
            const on = Library.isFavorite(combo.key);
            favBtn.querySelector('img').src = on ? 'assets/fav-sm.png' : 'assets/unfav-sm.png';
            favBtn.classList.toggle('is-fav', on);
            favBtn.title = on ? T.removeFav : T.addFav;
        } else {
            summary.textContent = state.active === 'top' ? T.chooseTop : T.chooseBottom;
            favBtn.querySelector('img').src = 'assets/unfav-sm.png';
            favBtn.classList.remove('is-fav');
            favBtn.title = T.addFav;
        }
        title.textContent = T.title;
    }

    function renderPicker() {
        const term = state.term.trim().toLowerCase();
        const all = partsFor(state.active);
        const searched = term
            ? all.filter(i => i.label.toLowerCase().includes(term) || i.name.toLowerCase().includes(term))
            : all;

        // Element chips (counts follow the search)
        const counts = new Map();
        searched.forEach(i => counts.set(i.element, (counts.get(i.element) || 0) + 1));
        if (state.element && !counts.has(state.element)) state.element = null;

        chips.innerHTML = '';
        const mk = (label, count, value, color) => {
            const chip = el('button', 'lib-chip' + (state.element === value ? ' on' : ''));
            chip.type = 'button';
            chip.appendChild(el('span', 'lib-chip-label', label));
            chip.appendChild(el('span', 'lib-chip-count', String(count)));
            if (color) chip.style.setProperty('--chip-color', color);
            chip.onclick = () => { state.element = value; renderPicker(); };
            chips.appendChild(chip);
        };
        mk(T.all, searched.length, null);
        Library.ELEMENT_ORDER.forEach(e => {
            if (counts.has(e)) mk(e, counts.get(e), e, Library.elementColor(e));
        });

        const list = state.element ? searched.filter(i => i.element === state.element) : searched;
        grid.innerHTML = '';
        if (!list.length) {
            grid.appendChild(el('div', 'combo-nothing', T.nothing));
            return;
        }
        const chosen = state[state.active];
        list.forEach(item => {
            const pick = el('button', 'combo-pick' + (item.file === chosen ? ' selected' : ''));
            pick.type = 'button';
            pick.dataset.file = item.file;
            const disc = el('span', 'combo-pick-disc');
            disc.style.setProperty('--ring-color', Library.elementColor(item.element));
            const img = document.createElement('img');
            img.alt = '';
            img.draggable = false;
            img.loading = 'lazy';
            img.src = Library.imageFor(item.file);
            disc.appendChild(img);
            disc.appendChild(el('span', 'combo-pick-check', '✓'));
            pick.appendChild(disc);
            pick.appendChild(el('span', 'combo-pick-name', formatLabel(item.label)));
            pick.onclick = () => choose(item.file);
            grid.appendChild(pick);
        });
    }

    function choose(file) {
        state[state.active] = file;
        // move on to the half that is still missing
        const other = state.active === 'top' ? 'bottom' : 'top';
        if (!state[other]) {
            state.active = other;
            state.element = null;
            state.term = '';
            search.value = '';
        }
        render();
    }

    function setActive(part) {
        if (state.active === part) return;
        state.active = part;
        state.element = null;
        state.term = '';
        search.value = '';
        render();
        grid.scrollTop = 0;
    }

    function render() {
        renderPreview();
        renderPicker();
    }

    function open(opts) {
        opts = opts || {};
        state.top = opts.top || null;
        state.bottom = opts.bottom || null;
        state.element = null;
        state.term = '';
        search.value = '';
        state.active = !state.top ? 'top' : (!state.bottom ? 'bottom' : 'top');
        render();
        grid.scrollTop = 0;
        modal.classList.remove('overlay-hidden');
    }

    function close() {
        if (modal) modal.classList.add('overlay-hidden');
    }

    function isOpen() {
        return !!modal && !modal.classList.contains('overlay-hidden');
    }

    function place() {
        if (!state.top || !state.bottom) return;
        const b = state.bottom, t = state.top;
        close();
        summonSwapForce(b, t);
    }

    function toggleFav() {
        if (!state.top || !state.bottom) return;
        Library.toggleFavorite(Library.comboKey(state.bottom, state.top));
        renderPreview();
        if (Library.state.tab === 'favorites') renderGrid();
    }

    // Android back button: close the combiner first
    function handleBack() {
        if (isOpen()) { close(); return true; }
        return false;
    }

    function init() {
        modal = document.getElementById('combo-modal');
        grid = document.getElementById('combo-grid');
        chips = document.getElementById('combo-elements');
        search = document.getElementById('combo-search');
        favBtn = document.getElementById('combo-fav');
        placeBtn = document.getElementById('combo-place');
        summary = document.getElementById('combo-summary');
        title = document.getElementById('combo-title');
        if (!modal) return;

        document.getElementById('combo-close').setAttribute('aria-label', T.close);
        document.getElementById('combo-close').addEventListener('click', close);
        modal.querySelectorAll('.combo-slot').forEach(slot => {
            slot.addEventListener('click', () => setActive(slot.dataset.part));
            slot.querySelector('.combo-slot-label').textContent = T[slot.dataset.part];
        });
        search.placeholder = T.search;
        search.addEventListener('input', () => { state.term = search.value; renderPicker(); });
        favBtn.addEventListener('click', toggleFav);
        placeBtn.addEventListener('click', place);
    }

    return { T, init, open, close, isOpen, handleBack, createCard };
})();
