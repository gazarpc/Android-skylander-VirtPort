/*
 * Library module
 * - Derives game / type / element from each dump path (Game/Type/Element/Name.dump)
 * - Tabs: Library, Favorites, Recents
 * - "Browse by" Game / Element / Type on the home screen
 * - Combinable filters (one value per dimension) with counters
 * - Favorites and recents persisted in localStorage
 * - Traps: "All / With villain / Empty" filter row (shown when the view only has traps) and
 *   search by captured villain name (data comes from the Traps module)
 *
 * - Swap Force: the combinable halves (files ending in "Top" / "Bottom") form their own type,
 *   "Swap Force". Each one is shown as a COMBO (a bottom file + a top file). A combo is stored in
 *   favorites / recents as the string "sf:<bottom file>|<top file>", so custom pairs work too.
 *
 * All user-facing strings live in Library.T so they can be translated later.
 */
const Library = (function () {
    'use strict';

    const T = {
        tabLibrary: 'Library',
        tabFavorites: 'Favorites',
        tabRecents: 'Recents',
        browseBy: 'Browse by',
        byGame: 'Game',
        byElement: 'Element',
        byType: 'Type',
        game: 'Game',
        element: 'Element',
        type: 'Type',
        noElement: 'No element',
        clearAll: 'Clear all',
        emptyFavorites: 'No favorites yet.\nTap the star on any card to add it here.',
        emptyRecents: 'Nothing here yet.\nPlace a figure on the portal and it will show up here.',
        noMatches: 'No figures match these filters.',
        noSearchResults: 'No results for',
        addFav: 'Add to favorites',
        removeFav: 'Remove from favorites',
        villain: 'Villain',
        villainAll: 'All',
        villainWith: 'With villain',
        villainEmpty: 'Empty',
        noTraps: 'No traps match this filter.',
        createCombo: 'Create combo',
        createComboHint: 'Mix any top with any bottom'
    };

    const KEY_FAVS = 'lib_favorites';
    const KEY_RECENTS = 'lib_recents';
    const MAX_RECENTS = 24;
    const COMBO_PREFIX = 'sf:';

    const GAME_ORDER = ["Spyro's Adventure", 'Giants', 'Swap Force', 'Trap Team', 'SuperChargers', 'Imaginators'];
    const GAME_LOGOS = {
        "Spyro's Adventure": '1.png',
        'Giants': '2.png',
        'Swap Force': '3.png',
        'Trap Team': '4.png',
        'SuperChargers': '5.png',
        'Imaginators': '6.png'
    };
    const ELEMENT_ORDER = ['Air', 'Earth', 'Fire', 'Life', 'Magic', 'Tech', 'Undead', 'Water', 'Light', 'Dark', 'Kaos'];
    const NO_ELEMENT = '__none__';
    const ELEMENT_COLORS = {
        Fire: '#FF4500', Water: '#1E90FF', Earth: '#8B4513', Life: '#32CD32', Air: '#87CEFA',
        Tech: '#D2691E', Magic: '#9932CC', Undead: '#483D8B', Light: '#FFFFE0', Dark: '#2F4F4F',
        Kaos: '#000000'
    };
    const TYPE_ORDER = ['Skylanders', 'Swap Force', 'Vehicles', 'Trap', 'Creation Crystal', 'Magic Item', 'Special Villain'];
    const TYPE_LABELS = {
        'Skylanders': 'Skylanders',
        'Swap Force': 'Swap Force',
        'Vehicles': 'Vehicles',
        'Trap': 'Traps',
        'Creation Crystal': 'Creation Crystals',
        'Magic Item': 'Magic Items',
        'Special Villain': 'Special Villains'
    };
    const DIMS = ['game', 'element', 'type'];

    const state = {
        tab: 'library',      // 'library' | 'favorites' | 'recents'
        browseBy: 'game',    // 'game' | 'element' | 'type'
        filters: [],         // ordered stack of { dim, value }
        villain: 'all'       // trap status filter: 'all' | 'with' | 'empty' (only while the view is traps-only)
    };

    /* ------------------------------------------------------------------ */
    /* Persistence                                                         */
    /* ------------------------------------------------------------------ */
    function loadList(key) {
        try {
            const raw = localStorage.getItem(key);
            const arr = raw ? JSON.parse(raw) : [];
            return Array.isArray(arr) ? arr.filter(x => typeof x === 'string') : [];
        } catch (e) {
            return [];
        }
    }
    function saveList(key, list) {
        try { localStorage.setItem(key, JSON.stringify(list)); } catch (e) { /* storage full or blocked */ }
    }

    let favorites = loadList(KEY_FAVS);
    let recents = loadList(KEY_RECENTS);

    /* ------------------------------------------------------------------ */
    /* Swap Force helpers                                                  */
    /* ------------------------------------------------------------------ */
    // 'top' | 'bottom' | null. Only files under "Swap Force/" whose name ends in "Top" / "Bottom"
    // (optionally followed by a clone suffix " - Name") are combinable halves.
    function swapPart(file) {
        if (!file) return null;
        const norm = file.replace(/\\/g, '/');
        if (!norm.startsWith('Swap Force/')) return null;
        const base = norm.substring(norm.lastIndexOf('/') + 1).replace('.dump', '');
        const m = /\s(Top|Bottom)(\s-\s.*)?$/.exec(base);
        return m ? m[1].toLowerCase() : null;
    }

    function isTopPart(file) { return swapPart(file) === 'top'; }

    function fileSet() {
        // allFiles is a global `let` declared in app.js (not a window property)
        return new Set((typeof allFiles !== 'undefined' && allFiles) ? allFiles : []);
    }

    // The top that belongs to a bottom: same character and same clone suffix when that clone exists,
    // otherwise the original top. Returns null when there is none.
    function defaultTopFor(bottomFile, files) {
        const set = files || fileSet();
        const withTop = bottomFile.replace(/\sBottom(\s-\s.*)?\.dump$/, (m, suffix) => ' Top' + (suffix || '') + '.dump');
        if (set.has(withTop)) return withTop;
        const original = bottomFile.replace(/\sBottom(\s-\s.*)?\.dump$/, ' Top.dump');
        return set.has(original) ? original : null;
    }

    function comboKey(bottomFile, topFile) {
        return COMBO_PREFIX + bottomFile + '|' + (topFile || '');
    }

    function parseComboKey(key) {
        if (typeof key !== 'string' || !key.startsWith(COMBO_PREFIX)) return null;
        const body = key.substring(COMBO_PREFIX.length);
        const cut = body.lastIndexOf('|');
        if (cut < 0) return null;
        return { bottom: body.substring(0, cut), top: body.substring(cut + 1) || null };
    }

    function entryHasFile(entry, file) {
        if (entry === file) return true;
        const c = parseComboKey(entry);
        return !!c && (c.bottom === file || c.top === file);
    }

    function keyOf(item) { return item.key || item.file; }

    function isFavorite(key) { return favorites.includes(key); }

    function toggleFavorite(key) {
        if (isFavorite(key)) favorites = favorites.filter(f => f !== key);
        else favorites.push(key);
        saveList(KEY_FAVS, favorites);
        return isFavorite(key);
    }

    function pushRecent(key) {
        recents = [key].concat(recents.filter(f => f !== key)).slice(0, MAX_RECENTS);
        saveList(KEY_RECENTS, recents);
    }

    function addRecent(file) {
        if (!file || swapPart(file)) return; // Swap Force halves are recorded as a pair (addRecentCombo)
        pushRecent(file);
    }

    function addRecentCombo(bottomFile, topFile) {
        if (!bottomFile || !topFile) return;
        pushRecent(comboKey(bottomFile, topFile));
    }

    // Called when a clone is deleted so no dangling entries remain (combos that use it go too)
    function forget(file) {
        favorites = favorites.filter(f => !entryHasFile(f, file));
        recents = recents.filter(f => !entryHasFile(f, file));
        saveList(KEY_FAVS, favorites);
        saveList(KEY_RECENTS, recents);
    }

    // Older versions saved a lone Swap Force bottom; turn it into the pair it stood for
    function migrateLists() {
        const files = fileSet();
        const convert = list => {
            const out = [];
            list.forEach(entry => {
                let next = entry;
                const part = swapPart(entry);
                if (part === 'top') return;
                if (part === 'bottom') {
                    const top = defaultTopFor(entry, files);
                    if (!top) return;
                    next = comboKey(entry, top);
                }
                if (!out.includes(next)) out.push(next);
            });
            return out;
        };
        favorites = convert(favorites);
        recents = convert(recents);
        saveList(KEY_FAVS, favorites);
        saveList(KEY_RECENTS, recents);
    }

    /* ------------------------------------------------------------------ */
    /* Item metadata                                                       */
    /* ------------------------------------------------------------------ */
    function fileBaseName(name) {
        let base = name.substring(name.lastIndexOf('/') + 1).trim();
        return base.includes(' - ') ? base.split(' - ')[0].trim() : base;
    }

    // Builds the item object the grid cards expect, plus game/type/element.
    function itemFromFile(file) {
        const normalized = file.replace(/\\/g, '/');
        const parts = normalized.split('/');
        const fileName = parts.pop();
        const name = fileName.replace('.dump', '').replace(/\uFFFD/g, "'").trim();
        const originalName = fileBaseName(name);
        const path = parts.length ? parts : ['Uncategorized'];

        const game = path[0];
        let type = path.length > 1 ? path[1] : 'Other';
        const element = path.length > 2 ? path[2] : NO_ELEMENT;
        // Combinable Swap Force halves get their own type (the folder stays "Skylanders")
        if (swapPart(file)) type = 'Swap Force';

        return { file, name, originalName, path, game, type, element };
    }

    function elementColor(element) {
        return ELEMENT_COLORS[element] || '#FFD700';
    }

    // Human-readable metadata for a dump file (used by the portal bar and its info window)
    function describe(file) {
        const item = itemFromFile(file);
        const element = item.element === NO_ELEMENT ? null : item.element;
        return {
            game: item.game,
            type: item.type,
            typeLabel: TYPE_LABELS[item.type] || item.type,
            element: element,
            color: elementColor(element)
        };
    }

    /* ------------------------------------------------------------------ */
    /* Swap Force combos                                                   */
    /* ------------------------------------------------------------------ */
    // "Boom Jet Bottom - PVP" -> "Boom Jet - PVP"; "Boom Jet Top" -> "Boom Jet"
    function partLabel(name) {
        return name.replace(/\s(Top|Bottom)(?=\s-\s|$)/, '').replace(/\uFFFD/g, "'").trim();
    }

    // The artwork only exists per character (not per half): assets/SwapForceImage/BoomJet.png
    function imageFor(file) {
        const item = itemFromFile(file);
        const base = item.originalName.replace(/\s(Top|Bottom)$/, '').replace(/\s+/g, '');
        return 'assets/SwapForceImage/' + encodeURIComponent(base) + '.png';
    }

    // A combo is a bottom file + a top file; behaves like a card item (file = the bottom's file)
    function comboItem(bottomFile, topFile) {
        const b = itemFromFile(bottomFile);
        const t = topFile ? itemFromFile(topFile) : null;
        const bLabel = partLabel(b.name);
        const tLabel = t ? partLabel(t.name) : '';
        const isDefault = !!t && topFile === defaultTopFor(bottomFile);
        const name = (!t || isDefault) ? bLabel : tLabel + ' + ' + bLabel;
        const elements = [];
        [b, t].forEach(x => { if (x && x.element !== NO_ELEMENT && !elements.includes(x.element)) elements.push(x.element); });
        return {
            kind: 'combo',
            key: comboKey(bottomFile, topFile),
            file: bottomFile,
            bottom: bottomFile,
            top: topFile || null,
            isDefault,
            name,
            originalName: b.originalName,
            path: b.path,
            game: 'Swap Force',
            type: 'Swap Force',
            element: b.element,
            elements,
            topElement: t ? t.element : b.element,
            // text the search box looks at: both halves, with and without the word Top / Bottom
            search: [bLabel, tLabel, name, b.name, t ? t.name : ''].join(' ').toLowerCase()
        };
    }

    // Every combinable half, as plain items, for the combiner
    function swapParts() {
        const tops = [], bottoms = [];
        const seen = new Set();
        ((typeof allFiles !== 'undefined' && allFiles) ? allFiles : []).forEach(file => {
            if (seen.has(file)) return;
            seen.add(file);
            const part = swapPart(file);
            if (!part) return;
            const item = itemFromFile(file);
            item.label = partLabel(item.name);
            (part === 'top' ? tops : bottoms).push(item);
        });
        const rank = e => { const i = ELEMENT_ORDER.indexOf(e); return i === -1 ? 999 : i; };
        const sorter = (a, b) => (rank(a.element) - rank(b.element)) || a.label.localeCompare(b.label);
        tops.sort(sorter);
        bottoms.sort(sorter);
        return { tops, bottoms };
    }

    function dimValue(item, dim) { return item[dim]; }

    // Combos have two elements (one per half): they match a filter when either half matches
    function matchesDim(item, dim, value) {
        if (dim === 'element' && item.elements) return item.elements.includes(value);
        return item[dim] === value;
    }

    function dimLabel(dim, value) {
        if (dim === 'element') return value === NO_ELEMENT ? T.noElement : value;
        if (dim === 'type') return TYPE_LABELS[value] || value;
        return value;
    }

    function dimTitle(dim) { return T[dim]; }

    function orderValues(dim, values) {
        const order = dim === 'game' ? GAME_ORDER : dim === 'element' ? ELEMENT_ORDER : TYPE_ORDER;
        return values.slice().sort((a, b) => {
            let ia = order.indexOf(a), ib = order.indexOf(b);
            if (ia === -1) ia = 999;
            if (ib === -1) ib = 999;
            if (ia !== ib) return ia - ib;
            return String(a).localeCompare(String(b));
        });
    }

    /* ------------------------------------------------------------------ */
    /* Data selection                                                      */
    /* ------------------------------------------------------------------ */
    function allItems() {
        // allFiles is a global `let` declared in app.js (not a window property)
        const files = (typeof allFiles !== 'undefined' && allFiles) ? allFiles : [];
        const seen = new Set();
        const items = [];
        files.forEach(file => {
            if (seen.has(file)) return;
            seen.add(file);
            const part = swapPart(file);
            if (part === 'top') return; // tops only exist inside combos
            if (part === 'bottom') {
                items.push(comboItem(file, defaultTopFor(file, new Set(files))));
                return;
            }
            items.push(itemFromFile(file));
        });
        return items;
    }

    // Favorites / recents entries are plain files or combo keys
    function resolveEntries(list, byFile) {
        const files = fileSet();
        const out = [];
        list.forEach(entry => {
            const c = parseComboKey(entry);
            if (c) {
                if (files.has(c.bottom) && (!c.top || files.has(c.top))) out.push(comboItem(c.bottom, c.top));
                return;
            }
            const item = byFile.get(entry);
            if (item) out.push(item);
        });
        return out;
    }

    // Items belonging to the current tab (before filters)
    function tabItems() {
        const items = allItems();
        if (state.tab === 'favorites') {
            const byFile = new Map(items.map(i => [i.file, i]));
            return resolveEntries(favorites, byFile).sort((a, b) => a.name.localeCompare(b.name));
        }
        if (state.tab === 'recents') {
            const byFile = new Map(items.map(i => [i.file, i]));
            return resolveEntries(recents, byFile); // already most-recent first
        }
        return items;
    }

    function applyFilters(items, filters) {
        return items.filter(item => filters.every(f => matchesDim(item, f.dim, f.value)));
    }

    function applySearch(items, term) {
        if (!term) return items;
        return items.filter(item => {
            const display = item.name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
            if (item.name.toLowerCase().includes(term) || display.includes(term)) return true;
            if (item.search && item.search.includes(term)) return true;
            // Traps also match the villain they hold ("kaos" finds the trap that captured Kaos),
            // with or without the space ("mad lobs" / "madlobs")
            if (!isTrapItem(item)) return false;
            const v = Traps.villain(item.file);
            return !!v && (v.name.toLowerCase().includes(term) || (v.key || '').toLowerCase().includes(term));
        });
    }

    function isTrapItem(item) {
        return item.game === 'Trap Team' && item.type === 'Trap' && typeof Traps !== 'undefined';
    }

    function applyVillain(items, mode) {
        if (mode === 'with') return items.filter(i => Traps.status(i.file) === 'villain');
        if (mode === 'empty') return items.filter(i => Traps.status(i.file) === 'empty');
        return items;
    }

    function countBy(items, dim) {
        const map = new Map();
        items.forEach(i => {
            // a combo counts once under each of its elements
            const values = (dim === 'element' && i.elements && i.elements.length) ? i.elements : [dimValue(i, dim)];
            values.forEach(v => map.set(v, (map.get(v) || 0) + 1));
        });
        return map;
    }

    /* ------------------------------------------------------------------ */
    /* Rendering                                                           */
    /* ------------------------------------------------------------------ */
    function el(tag, className, text) {
        const e = document.createElement(tag);
        if (className) e.className = className;
        if (text !== undefined) e.textContent = text;
        return e;
    }

    function searchTerm() {
        const input = document.getElementById('search-bar');
        return input ? input.value.trim().toLowerCase() : '';
    }

    function renderTabs() {
        document.querySelectorAll('#lib-tabs .lib-tab').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === state.tab);
        });
    }

    function renderBrowseSwitch(visible) {
        const box = document.getElementById('lib-browse');
        if (!box) return;
        box.style.display = visible ? 'flex' : 'none';
        box.querySelectorAll('.lib-seg').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.by === state.browseBy);
        });
    }

    function makeChip(label, count, className) {
        const chip = el('button', 'lib-chip' + (className ? ' ' + className : ''));
        chip.appendChild(el('span', 'lib-chip-label', label));
        if (count !== undefined) chip.appendChild(el('span', 'lib-chip-count', String(count)));
        return chip;
    }

    function renderFilterArea(scopeItems, searchActive, showVillain, showCreate) {
        const box = document.getElementById('lib-filters');
        if (!box) return;
        box.innerHTML = '';

        // Swap Force section: entry point of the combiner
        if (showCreate && typeof Swap !== 'undefined') {
            const create = el('button', 'lib-create-combo');
            create.type = 'button';
            create.appendChild(el('span', 'lib-create-plus', '+'));
            const labels = el('span', 'lib-create-labels');
            labels.appendChild(el('span', 'lib-create-title', T.createCombo));
            labels.appendChild(el('span', 'lib-create-sub', T.createComboHint));
            create.appendChild(labels);
            create.onclick = () => Swap.open();
            box.appendChild(create);
        }

        // Active filters, removable with the "x"
        if (state.filters.length) {
            const active = el('div', 'lib-active-row');
            state.filters.forEach(f => {
                const chip = makeChip(dimLabel(f.dim, f.value), undefined, 'active');
                chip.appendChild(el('span', 'lib-chip-x', '×'));
                chip.onclick = () => {
                    state.filters = state.filters.filter(x => x !== f);
                    render();
                };
                active.appendChild(chip);
            });
            if (state.filters.length > 1) {
                const clear = makeChip(T.clearAll, undefined, 'clear');
                clear.onclick = () => { state.filters = []; state.villain = 'all'; render(); };
                active.appendChild(clear);
            }
            box.appendChild(active);
        }

        // Traps only: All / With villain / Empty
        if (showVillain) {
            const withN = scopeItems.filter(i => Traps.status(i.file) === 'villain').length;
            const emptyN = scopeItems.filter(i => Traps.status(i.file) === 'empty').length;
            const row = el('div', 'lib-row');
            row.appendChild(el('div', 'lib-row-title', T.villain));
            const scroller = el('div', 'lib-row-chips');
            [['all', T.villainAll, scopeItems.length],
             ['with', T.villainWith, withN],
             ['empty', T.villainEmpty, emptyN]].forEach(([key, label, count]) => {
                const chip = makeChip(label, count, state.villain === key ? 'on' : '');
                chip.onclick = () => { state.villain = key; render(); };
                scroller.appendChild(chip);
            });
            row.appendChild(scroller);
            box.appendChild(row);
        }

        // One row per dimension that is not filtered yet and has real choice
        const usedDims = state.filters.map(f => f.dim);
        DIMS.forEach(dim => {
            if (usedDims.includes(dim)) return;
            const counts = countBy(scopeItems, dim);
            if (counts.size < 2) return;
            const row = el('div', 'lib-row');
            row.appendChild(el('div', 'lib-row-title', dimTitle(dim)));
            const scroller = el('div', 'lib-row-chips');
            orderValues(dim, Array.from(counts.keys())).forEach(value => {
                const chip = makeChip(dimLabel(dim, value), counts.get(value));
                if (dim === 'element' && value !== NO_ELEMENT) {
                    chip.style.setProperty('--chip-color', elementColor(value));
                }
                chip.onclick = () => {
                    state.filters.push({ dim, value });
                    render();
                };
                scroller.appendChild(chip);
            });
            row.appendChild(scroller);
            box.appendChild(row);
        });

        box.style.display = box.childNodes.length ? 'block' : 'none';
    }

    function renderHome(items) {
        const drill = document.getElementById('drill-down-container');
        const dim = state.browseBy;
        const counts = countBy(items, dim);
        drill.style.display = 'grid';
        drill.innerHTML = '';

        orderValues(dim, Array.from(counts.keys())).forEach(value => {
            const tile = el('div', 'drill-btn premium-glass');
            const count = el('span', 'tile-count', String(counts.get(value)));

            if (dim === 'game' && GAME_LOGOS[value]) {
                const img = document.createElement('img');
                img.src = 'assets/logos/' + GAME_LOGOS[value];
                img.style.width = '90%';
                img.style.height = '90%';
                img.style.objectFit = 'contain';
                img.style.filter = 'drop-shadow(0 4px 6px rgba(0,0,0,0.6))';
                tile.appendChild(img);
            } else {
                const text = el('span', 'tile-label', dimLabel(dim, value));
                if (dim === 'element' && value !== NO_ELEMENT) {
                    tile.style.setProperty('--tile-color', elementColor(value));
                    tile.classList.add('element-tile');
                }
                tile.appendChild(text);
            }
            tile.appendChild(count);
            tile.onclick = () => {
                state.filters.push({ dim, value });
                render();
            };
            drill.appendChild(tile);
        });
    }

    function renderEmpty(message, withClear) {
        const box = document.getElementById('lib-empty');
        if (!box) return;
        box.innerHTML = '';
        message.split('\n').forEach((line, i) => {
            box.appendChild(el('div', i === 0 ? 'lib-empty-main' : 'lib-empty-sub', line));
        });
        if (withClear && (state.filters.length || state.villain !== 'all')) {
            const btn = el('button', 'lib-chip clear', T.clearAll);
            btn.onclick = () => { state.filters = []; state.villain = 'all'; render(); };
            box.appendChild(btn);
        }
        box.style.display = 'flex';
    }

    function render() {
        const drill = document.getElementById('drill-down-container');
        const grid = document.getElementById('skylanders-grid');
        const backBtn = document.getElementById('back-btn');
        const empty = document.getElementById('lib-empty');
        const term = searchTerm();

        const prevScroll = grid ? grid.scrollTop : 0;

        renderTabs();

        // The tabs and filter chips already say where you are; keep the title empty like before
        const crumb = document.getElementById('breadcrumb');
        if (crumb) crumb.textContent = '';

        drill.innerHTML = '';
        drill.style.display = 'none';
        grid.innerHTML = '';
        grid.style.display = 'none';
        if (empty) { empty.innerHTML = ''; empty.style.display = 'none'; }

        const base = tabItems();
        const filtered = applyFilters(base, state.filters);
        const atHome = state.tab === 'library' && state.filters.length === 0 && !term;

        if (atHome) state.villain = 'all'; // left the traps view: forget its status filter
        renderBrowseSwitch(atHome);
        if (backBtn) backBtn.style.display = (state.filters.length > 0 && !term) ? 'inline-block' : 'none';

        // Home screen: tiles for the chosen dimension
        if (atHome) {
            renderFilterArea([], false);
            renderHome(base);
            return;
        }

        const searched = applySearch(filtered, term);

        // The villain row only makes sense when everything in view is a trap
        const trapsOnly = searched.length > 0 && searched.every(isTrapItem);
        if (!trapsOnly) state.villain = 'all';
        const results = trapsOnly ? applyVillain(searched, state.villain) : searched;

        // The combiner button belongs to the Swap Force section (the "Swap Force" type filter is on)
        const inSwap = state.filters.some(f => f.dim === 'type' && f.value === 'Swap Force');

        // Counters follow the active search so chips never promise missing results
        renderFilterArea(searched, !!term, trapsOnly, inSwap);

        if (!results.length) {
            if (state.villain !== 'all') renderEmpty(T.noTraps, true);
            else if (term) renderEmpty(T.noSearchResults + ' "' + document.getElementById('search-bar').value.trim() + '"', false);
            else if (state.tab === 'favorites' && !state.filters.length) renderEmpty(T.emptyFavorites, false);
            else if (state.tab === 'recents' && !state.filters.length) renderEmpty(T.emptyRecents, false);
            else renderEmpty(T.noMatches, true);
            return;
        }

        if (state.tab === 'library') {
            results.sort((a, b) => a.name.localeCompare(b.name));
        } else if (state.tab === 'favorites') {
            results.sort((a, b) => a.name.localeCompare(b.name));
        } // recents keep recency order

        grid.style.display = 'grid';
        results.forEach(item => grid.appendChild(createCard(item)));
        grid.scrollTop = prevScroll;
    }

    /* ------------------------------------------------------------------ */
    /* Navigation                                                          */
    /* ------------------------------------------------------------------ */
    function setTab(tab) {
        if (state.tab === tab) return;
        state.tab = tab;
        state.filters = [];
        state.villain = 'all';
        render();
    }

    function setBrowseBy(by) {
        state.browseBy = by;
        render();
    }

    function goBack() {
        if (state.filters.length) {
            state.filters.pop();
            render();
            return true;
        }
        return false;
    }

    // Android back button: undo last filter, then return to the Library tab
    function handleBack() {
        if (goBack()) return;
        if (state.tab !== 'library') setTab('library');
    }

    function init() {
        migrateLists();
        document.querySelectorAll('#lib-tabs .lib-tab').forEach(btn => {
            btn.addEventListener('click', () => setTab(btn.dataset.tab));
        });
        document.querySelectorAll('#lib-browse .lib-seg').forEach(btn => {
            btn.addEventListener('click', () => setBrowseBy(btn.dataset.by));
        });
    }

    return {
        T, init, render, goBack, handleBack, setTab,
        isFavorite, toggleFavorite, addRecent, addRecentCombo, forget, keyOf,
        elementColor, itemFromFile, isTopPart, describe,
        swapPart, swapParts, partLabel, imageFor, comboItem, comboKey, defaultTopFor,
        ELEMENT_ORDER, NO_ELEMENT,
        state
    };
})();
