/*
 * Portal bar module
 * - Closed state: one compact row with the 8 slots (element-coloured ring when occupied,
 *   dashed outline when empty) and an "n/8" counter. No text, nothing to remove by accident.
 * - Expanded state: a 4 x 2 sheet with bigger discs, images only.
 * - Tapping a figure (in either state) opens a floating window with all its info
 *   and the only "Remove from portal" button.
 * - Traps show their captured villain as a small badge on the slot and in the info window.
 * - Swap Force halves placed together share a coloured letter mark (A, B, ...) on both slots; the
 *   info window shows the other half and offers "Remove this half" / "Remove both".
 *
 * The state itself lives in app.js (`slots`, `slotOwners`, `deviceId`); this module only
 * draws it. app.js calls PortalBar.render() whenever that state changes.
 *
 * All user-facing strings live in PortalBar.T so they can be translated later.
 */
const PortalBar = (function () {
    'use strict';

    const SLOT_COUNT = 8;

    const T = {
        portal: 'Portal',
        expand: 'Show all slots',
        collapse: 'Hide slots',
        emptySlot: 'Empty slot',
        lockedSlot: 'In use by another player',
        close: 'Close',
        remove: 'Remove from portal',
        level: 'Lvl',
        game: 'Game',
        type: 'Type',
        element: 'Element',
        slot: 'Slot',
        villain: 'Captured villain',
        noVillain: 'Empty',
        part: 'Part',
        top: 'Top',
        bottom: 'Bottom',
        pairedWith: 'Paired with',
        removeHalf: 'Remove this half',
        removeBoth: 'Remove both',
        pairLabel: 'pair'
    };

    // One colour per pair (8 slots hold at most 4 pairs)
    const PAIR_COLORS = ['#ff4d8d', '#00e5ff', '#ffd400', '#7dff6b'];

    const cells = [];                       // [{ mini, big }] built once, updated in place
    const lastFile = Array(SLOT_COUNT).fill(null);
    let pairs = Array(SLOT_COUNT).fill(null);   // per slot: { letter, color, partner } or null
    let container, backdrop, miniRow, bigGrid, modal;
    let expanded = false;
    let infoSlot = null;                    // slot index shown in the info window, or null

    function el(tag, className, text) {
        const e = document.createElement(tag);
        if (className) e.className = className;
        if (text !== undefined) e.textContent = text;
        return e;
    }

    /* ------------------------------------------------------------------ */
    /* State helpers                                                       */
    /* ------------------------------------------------------------------ */
    // 'mine'   : a figure of this device is on the slot
    // 'locked' : another player is using it
    // 'empty'  : free
    function stateOf(i) {
        if (slots[i].file) return 'mine';
        const owner = slotOwners[i];
        if (owner && owner !== deviceId) return 'locked';
        return 'empty';
    }

    // Slots whose figure was placed together as a Swap Force pair (both halves still on the portal)
    function computePairs() {
        const result = Array(SLOT_COUNT).fill(null);
        const byPair = new Map();
        for (let i = 0; i < SLOT_COUNT; i++) {
            if (slots[i].file && slots[i].pair) {
                if (!byPair.has(slots[i].pair)) byPair.set(slots[i].pair, []);
                byPair.get(slots[i].pair).push(i);
            }
        }
        let n = 0;
        byPair.forEach(list => {
            if (list.length !== 2) return;
            const letter = String.fromCharCode(65 + n);
            const color = PAIR_COLORS[n % PAIR_COLORS.length];
            result[list[0]] = { letter, color, partner: list[1] };
            result[list[1]] = { letter, color, partner: list[0] };
            n++;
        });
        return result;
    }

    /* ------------------------------------------------------------------ */
    /* Cells                                                               */
    /* ------------------------------------------------------------------ */
    function buildCell(i) {
        const cell = el('button', 'pb-cell');
        cell.type = 'button';
        cell.dataset.slot = String(i);

        const disc = el('span', 'pb-disc');
        const img = document.createElement('img');
        img.className = 'pb-img';
        img.alt = '';
        img.draggable = false;
        disc.appendChild(img);
        disc.appendChild(el('span', 'pb-num', String(i + 1)));
        disc.appendChild(el('span', 'pb-lock', '🔒'));
        disc.appendChild(el('span', 'pb-badge'));
        disc.appendChild(el('span', 'pb-pair'));
        disc.appendChild(el('span', 'trap-badge pb-villain'));
        cell.appendChild(disc);

        cell.addEventListener('click', () => {
            if (stateOf(i) === 'mine') openInfo(i);
        });
        return cell;
    }

    function paintCell(cell, i, justPlaced) {
        const s = slots[i];
        const st = stateOf(i);
        const disc = cell.firstChild;
        const img = disc.querySelector('.pb-img');
        const badge = disc.querySelector('.pb-badge');
        const villain = disc.querySelector('.pb-villain');
        const mark = disc.querySelector('.pb-pair');
        const pair = st === 'mine' ? pairs[i] : null;

        mark.textContent = pair ? pair.letter : '';
        if (pair) mark.style.setProperty('--pair', pair.color);
        else mark.style.removeProperty('--pair');
        cell.classList.toggle('is-paired', !!pair);

        cell.dataset.state = st;
        cell.disabled = st !== 'mine';

        if (st === 'mine') {
            cell.style.setProperty('--ring', Library.describe(s.file).color);
            const src = s.img || '';
            if (img.getAttribute('src') !== src) img.setAttribute('src', src);
            badge.textContent = s.part === 'top' ? '🔼' : (s.part === 'bottom' ? '🔽' : '');
            villain.classList.toggle('on', !!s.captured);
            Traps.fillBadge(villain, s.captured);
            cell.setAttribute('aria-label', T.slot + ' ' + (i + 1) + ': ' + (s.name || '') +
                (s.captured ? ' (' + s.captured.name + ')' : '') +
                (pair ? ' (' + T.pairLabel + ' ' + pair.letter + ')' : ''));
        } else {
            cell.style.removeProperty('--ring');
            img.removeAttribute('src');
            badge.textContent = '';
            villain.classList.remove('on');
            villain.innerHTML = '';
            cell.setAttribute('aria-label',
                T.slot + ' ' + (i + 1) + ': ' + (st === 'locked' ? T.lockedSlot : T.emptySlot));
        }

        if (justPlaced) {
            disc.classList.remove('pop');
            void disc.offsetWidth; // restart the animation
            disc.classList.add('pop');
        }
    }

    function render() {
        if (!cells.length) return;
        pairs = computePairs();
        let used = 0;
        for (let i = 0; i < SLOT_COUNT; i++) {
            const st = stateOf(i);
            if (st !== 'empty') used++;
            const justPlaced = st === 'mine' && lastFile[i] !== slots[i].file;
            lastFile[i] = slots[i].file;
            paintCell(cells[i].mini, i, justPlaced);
            paintCell(cells[i].big, i, justPlaced);
        }
        const label = used + '/' + SLOT_COUNT;
        document.querySelectorAll('.pb-count').forEach(n => { n.textContent = label; });

        if (infoSlot !== null) fillInfo();
    }

    /* ------------------------------------------------------------------ */
    /* Expand / collapse                                                   */
    /* ------------------------------------------------------------------ */
    function setExpanded(value) {
        expanded = !!value;
        container.classList.toggle('open', expanded);
        backdrop.classList.toggle('show', expanded);
        document.querySelectorAll('.pb-head').forEach(h => {
            h.setAttribute('aria-expanded', String(expanded));
            h.setAttribute('aria-label', expanded ? T.collapse : T.expand);
        });
    }

    /* ------------------------------------------------------------------ */
    /* Info window                                                         */
    /* ------------------------------------------------------------------ */
    function infoRow(label, value, color) {
        const row = el('div', 'pb-info-row');
        row.appendChild(el('span', 'pb-info-label', label));
        const val = el('span', 'pb-info-value');
        if (color) {
            const dot = el('span', 'pb-dot');
            dot.style.background = color;
            val.appendChild(dot);
        }
        val.appendChild(document.createTextNode(value));
        row.appendChild(val);
        return row;
    }

    // Row for the villain held by a trap: small portrait + name, or "Empty"
    function villainRow(captured) {
        const row = el('div', 'pb-info-row');
        row.appendChild(el('span', 'pb-info-label', T.villain));
        const val = el('span', 'pb-info-value');
        if (captured) {
            const mini = el('span', 'trap-badge on pb-info-villain');
            Traps.fillBadge(mini, captured);
            val.appendChild(mini);
            val.appendChild(document.createTextNode(captured.name));
        } else {
            val.classList.add('pb-info-muted');
            val.appendChild(document.createTextNode(T.noVillain));
        }
        row.appendChild(val);
        return row;
    }

    function fillInfo() {
        const i = infoSlot;
        if (i === null || !slots[i] || !slots[i].file) { closeInfo(); return; }
        const s = slots[i];
        const meta = Library.describe(s.file);
        const nickname = s.stats && s.stats.nickname ? s.stats.nickname : '';
        const baseName = s.villainName || s.name || '';

        const ring = document.getElementById('slot-modal-ring');
        ring.style.setProperty('--ring-color', meta.color);
        const img = document.getElementById('slot-modal-img');
        const src = s.img || '';
        if (img.getAttribute('src') !== src) img.setAttribute('src', src);

        // Traps: villain badge on the big image too
        const isTrap = meta.game === 'Trap Team' && meta.type === 'Trap';
        const bigBadge = document.getElementById('slot-modal-villain');
        bigBadge.classList.toggle('on', isTrap && !!s.captured);
        Traps.fillBadge(bigBadge, isTrap ? s.captured : null);

        document.getElementById('slot-modal-name').textContent = nickname || baseName;
        const real = document.getElementById('slot-modal-realname');
        real.textContent = nickname ? baseName : '';
        real.style.display = nickname ? 'block' : 'none';

        const stats = document.getElementById('slot-modal-stats');
        stats.innerHTML = '';
        if (s.stats) {
            stats.appendChild(el('span', 'stat-badge stat-lvl', T.level + ' ' + s.stats.level));
            stats.appendChild(el('span', 'stat-badge stat-gold', '💰 ' + s.stats.gold));
            stats.style.display = 'flex';
        } else {
            stats.style.display = 'none';
        }

        const info = document.getElementById('slot-modal-info');
        info.innerHTML = '';
        info.appendChild(infoRow(T.game, meta.game));
        info.appendChild(infoRow(T.type, meta.typeLabel));
        if (meta.element) info.appendChild(infoRow(T.element, meta.element, meta.color));
        if (isTrap) info.appendChild(villainRow(s.captured));
        if (s.part) info.appendChild(infoRow(T.part, s.part === 'top' ? T.top : T.bottom));
        info.appendChild(infoRow(T.slot, String(i + 1)));

        // Swap Force pair: show the other half and offer to remove one half or both
        const pair = pairs[i];
        if (pair) {
            const other = slots[pair.partner];
            info.appendChild(infoRow(T.pairedWith, (other.name || '') + ' · ' + T.slot + ' ' + (pair.partner + 1), pair.color));
        }
        document.getElementById('slot-modal-remove').textContent = pair ? T.removeHalf : T.remove;
        document.getElementById('slot-modal-remove-both').style.display = pair ? 'block' : 'none';
    }

    function openInfo(i) {
        infoSlot = i;
        fillInfo();
        if (infoSlot !== null) modal.classList.remove('overlay-hidden');
    }

    function closeInfo() {
        infoSlot = null;
        if (modal) modal.classList.add('overlay-hidden');
    }

    async function removeFromInfo() {
        const i = infoSlot;
        if (i === null) return;
        closeInfo();
        await clearSlot(i);
    }

    async function removeBothFromInfo() {
        const i = infoSlot;
        if (i === null) return;
        const partner = pairs[i] ? pairs[i].partner : null; // read before clearing changes the pairs
        closeInfo();
        await clearSlot(i);
        if (partner !== null) await clearSlot(partner);
    }

    /* ------------------------------------------------------------------ */
    /* Navigation                                                          */
    /* ------------------------------------------------------------------ */
    // Android back button: close the info window first, then the expanded sheet
    function handleBack() {
        if (infoSlot !== null) { closeInfo(); return true; }
        if (expanded) { setExpanded(false); return true; }
        return false;
    }

    /* ------------------------------------------------------------------ */
    /* Init                                                                */
    /* ------------------------------------------------------------------ */
    function init() {
        container = document.getElementById('portal-container');
        backdrop = document.getElementById('portal-backdrop');
        miniRow = document.getElementById('portal-mini');
        bigGrid = document.getElementById('portal-grid');
        modal = document.getElementById('slot-modal');

        for (let i = 0; i < SLOT_COUNT; i++) {
            const mini = buildCell(i);
            const big = buildCell(i);
            miniRow.appendChild(mini);
            bigGrid.appendChild(big);
            cells.push({ mini, big });
        }

        document.querySelectorAll('.pb-head').forEach(h => {
            h.addEventListener('click', () => setExpanded(!expanded));
        });
        backdrop.addEventListener('click', () => setExpanded(false));

        modal.addEventListener('click', e => { if (e.target === modal) closeInfo(); });
        document.getElementById('slot-modal-close').addEventListener('click', closeInfo);
        document.getElementById('slot-modal-remove').addEventListener('click', removeFromInfo);
        document.getElementById('slot-modal-remove-both').addEventListener('click', removeBothFromInfo);
        document.getElementById('slot-modal-remove').textContent = T.remove;
        document.getElementById('slot-modal-remove-both').textContent = T.removeBoth;
        document.getElementById('slot-modal-close').setAttribute('aria-label', T.close);

        setExpanded(false);
        render();
    }

    return { T, init, render, handleBack, setExpanded, openInfo, closeInfo };
})();
