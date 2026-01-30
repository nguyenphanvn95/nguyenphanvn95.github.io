// APKG Builder Module - Corrected version based on working auto-apkg.html
// Generates proper Anki .apkg files

const APKG_MODEL_STORAGE_KEY = 'notion_anki_model_v2';
const APKG_DECKNAME_KEY = 'notion_anki_deckname_v2';
const APKG_NOTETYPE_KEY = 'notion_anki_notetype_v2';

let DEFAULT_MODEL = {
    globalCss: '',
    cards: [{
        name: "Card 1",
        front: '',
        back: ''
    }]
};

let SQL_INSTANCE = null;

// Load templates from external files
async function loadTemplatesFromFiles() {
    try {
        const [frontHtml, backHtml, cssText] = await Promise.all([
            fetch('templates/card1-front.html').then(r => r.text()),
            fetch('templates/card1-back.html').then(r => r.text()),
            fetch('templates/card1-style.css').then(r => r.text())
        ]);

        DEFAULT_MODEL = {
            globalCss: cssText,
            cards: [{
                name: "Card 1",
                front: frontHtml,
                back: backHtml
            }]
        };

        return true;
    } catch (error) {
        console.warn('Could not load template files, using defaults:', error);
        // Fallback to inline defaults
        DEFAULT_MODEL = {
            globalCss: `.card {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 20px;
    text-align: center;
    color: black;
    background-color: white;
}
img{max-width:100%;height:auto;border-radius:12px}`,
            cards: [{
                name: "Card 1",
                front: `{{Front}}`,
                back: `{{FrontSide}}<hr id="answer">{{Back}}`
            }]
        };
        return false;
    }
}

// Initialize templates on load
async function ensureDefaultTemplatesLoaded(force = false) {
    if (!force) {
        const existing = localStorage.getItem(APKG_MODEL_STORAGE_KEY);
        if (existing) return;
    } else {
        localStorage.removeItem(APKG_MODEL_STORAGE_KEY);
    }

    await loadTemplatesFromFiles();
    localStorage.setItem(APKG_MODEL_STORAGE_KEY, JSON.stringify(DEFAULT_MODEL));
}

function loadApkgModel() {
    try {
        const raw = localStorage.getItem(APKG_MODEL_STORAGE_KEY);
        if (!raw) return JSON.parse(JSON.stringify(DEFAULT_MODEL));
        
        const model = JSON.parse(raw);
        const cards = Array.isArray(model.cards) ? model.cards : [];
        
        return {
            globalCss: model.globalCss || DEFAULT_MODEL.globalCss,
            cards: cards.length ? cards : DEFAULT_MODEL.cards
        };
    } catch (e) {
        return JSON.parse(JSON.stringify(DEFAULT_MODEL));
    }
}

function saveApkgModel(model) {
    localStorage.setItem(APKG_MODEL_STORAGE_KEY, JSON.stringify(model));
}

async function resetApkgModel() {
    await ensureDefaultTemplatesLoaded(true);
}

function loadDeckName() {
    return localStorage.getItem(APKG_DECKNAME_KEY) || 'My Deck';
}

function saveDeckName(name) {
    localStorage.setItem(APKG_DECKNAME_KEY, name);
}

function loadNoteType() {
    return localStorage.getItem(APKG_NOTETYPE_KEY) || 'Notion2Anki';
}

function saveNoteType(name) {
    localStorage.setItem(APKG_NOTETYPE_KEY, name);
}

async function ensureSqlReady() {
    if (SQL_INSTANCE) return SQL_INSTANCE;
    if (typeof initSqlJs === 'undefined') {
        throw new Error('SQL.js not loaded');
    }
    SQL_INSTANCE = await initSqlJs({
        locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}`
    });
    return SQL_INSTANCE;
}

function sha1ish(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        h = ((h << 5) - h) + str.charCodeAt(i);
        h |= 0;
    }
    return Math.abs(h);
}

function buildFieldObjects(names) {
    return names.map((name, idx) => ({
        name,
        ord: idx,
        sticky: false,
        rtl: false,
        font: "Arial",
        size: 20,
        description: "",
        plainText: false,
        collapsed: false,
        excludeFromSearch: false,
        media: []
    }));
}

function escapeHtmlLite(s) {
    if (typeof s !== 'string') return s;
    return s.replace(/[&<>"]/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
    }[ch]));
}

// Main APKG export function - FIXED VERSION
async function exportApkg(notionData, deckName, noteTypeName) {
    if (!notionData || !notionData.pages || notionData.pages.length === 0) {
        throw new Error('No data to export');
    }

    saveDeckName(deckName);
    saveNoteType(noteTypeName);

    const model = loadApkgModel();
    const cards = model.cards || [];
    
    if (cards.length === 0) {
        throw new Error('No card types defined');
    }

    await ensureSqlReady();
    if (typeof JSZip === 'undefined') {
        throw new Error('JSZip not loaded');
    }

    // Collect all cards from all pages
    const allCards = [];
    notionData.pages.forEach(page => {
        if (page.cards && Array.isArray(page.cards)) {
            page.cards.forEach(card => {
                allCards.push({
                    ...card,
                    deck: page.deck || deckName
                });
            });
        }
    });

    if (allCards.length === 0) {
        throw new Error('No cards found in pages');
    }

    const nowMs = Date.now();
    const nowSec = Math.floor(nowMs / 1000);
    const modelId = nowMs;
    const deckId = nowMs + 1;

    const SQL = SQL_INSTANCE;
    const db = new SQL.Database();

    // Create Anki database schema
    db.run(`CREATE TABLE col (
        id INTEGER PRIMARY KEY,
        crt INTEGER NOT NULL,
        mod INTEGER NOT NULL,
        scm INTEGER NOT NULL,
        ver INTEGER NOT NULL,
        dty INTEGER NOT NULL,
        usn INTEGER NOT NULL,
        ls INTEGER NOT NULL,
        conf TEXT NOT NULL,
        models TEXT NOT NULL,
        decks TEXT NOT NULL,
        dconf TEXT NOT NULL,
        tags TEXT NOT NULL
    );`);

    db.run(`CREATE TABLE notes (
        id INTEGER PRIMARY KEY,
        guid TEXT NOT NULL,
        mid INTEGER NOT NULL,
        mod INTEGER NOT NULL,
        usn INTEGER NOT NULL,
        tags TEXT NOT NULL,
        flds TEXT NOT NULL,
        sfld TEXT NOT NULL,
        csum INTEGER NOT NULL,
        flags INTEGER NOT NULL,
        data TEXT NOT NULL
    );`);

    db.run(`CREATE TABLE cards (
        id INTEGER PRIMARY KEY,
        nid INTEGER NOT NULL,
        did INTEGER NOT NULL,
        ord INTEGER NOT NULL,
        mod INTEGER NOT NULL,
        usn INTEGER NOT NULL,
        type INTEGER NOT NULL,
        queue INTEGER NOT NULL,
        due INTEGER NOT NULL,
        ivl INTEGER NOT NULL,
        factor INTEGER NOT NULL,
        reps INTEGER NOT NULL,
        lapses INTEGER NOT NULL,
        left INTEGER NOT NULL,
        odue INTEGER NOT NULL,
        odid INTEGER NOT NULL,
        flags INTEGER NOT NULL,
        data TEXT NOT NULL
    );`);

    db.run(`CREATE TABLE revlog (
        id INTEGER PRIMARY KEY,
        cid INTEGER NOT NULL,
        usn INTEGER NOT NULL,
        ease INTEGER NOT NULL,
        ivl INTEGER NOT NULL,
        lastIvl INTEGER NOT NULL,
        factor INTEGER NOT NULL,
        time INTEGER NOT NULL,
        type INTEGER NOT NULL
    );`);

    db.run(`CREATE TABLE graves (
        usn INTEGER NOT NULL,
        oid INTEGER NOT NULL,
        type INTEGER NOT NULL
    );`);

    // Field names
    const fieldNames = ["Front", "Back", "Deck", "Tags"];

    // Build templates
    const tmpls = cards.map((c, i) => ({
        name: c.name || `Card ${i + 1}`,
        ord: i,
        qfmt: c.front || '',
        afmt: c.back || '',
        bqfmt: "",
        bafmt: "",
        did: null,
        bfont: "",
        bsize: 0
    }));

    // Build model (note type) - FIXED STRUCTURE
    const req = tmpls.map(t => [t.ord, "all", [0]]);

    const models = {};
    models[modelId] = {
        id: modelId,
        name: noteTypeName,
        type: 0,
        mod: nowSec,
        usn: -1,
        sortf: 0,
        did: deckId,
        tmpls: tmpls,
        flds: buildFieldObjects(fieldNames),
        css: model.globalCss || DEFAULT_MODEL.globalCss,
        latexPre: "",
        latexPost: "",
        latexsvg: false,
        req: req
    };

    // Build decks - FIXED STRUCTURE
    const decks = {
        "1": {
            id: 1,
            mod: 0,
            name: "Default",
            usn: 0,
            lrnToday: [0, 0],
            revToday: [0, 0],
            newToday: [0, 0],
            timeToday: [0, 0],
            collapsed: true,
            browserCollapsed: true,
            desc: "",
            dyn: 0,
            conf: 1,
            extendNew: 0,
            extendRev: 0
        }
    };

    decks[String(deckId)] = {
        id: deckId,
        mod: nowSec,
        name: deckName,
        usn: -1,
        lrnToday: [0, 0],
        revToday: [0, 0],
        newToday: [0, 0],
        timeToday: [0, 0],
        collapsed: false,
        browserCollapsed: false,
        desc: "",
        dyn: 0,
        conf: 1,
        extendNew: 0,
        extendRev: 0
    };

    // Build config
    const conf = {
        schedVer: 2,
        sched2021: true,
        addToCur: true,
        sortBackwards: false,
        dueCounts: true,
        collapseTime: 1200,
        estTimes: true,
        nextPos: 1,
        sortType: "noteFld",
        activeDecks: [deckId],
        newSpread: 0,
        timeLim: 0,
        curDeck: deckId,
        curModel: modelId,
        dayLearnFirst: false,
        creationOffset: -420
    };
    conf["_deck_1_lastNotetype"] = modelId;
    conf[`_nt_${modelId}_lastDeck`] = deckId;

    // Deck config
    const dconf = {
        1: {
            id: 1,
            mod: 0,
            name: "Default",
            usn: 0,
            maxTaken: 60,
            autoplay: true,
            timer: 0,
            replayq: true,
            new: {
                bury: false,
                delays: [1, 10],
                initialFactor: 2500,
                ints: [1, 4, 0],
                order: 1,
                perDay: 20
            },
            rev: {
                bury: false,
                ease4: 1.3,
                ivlFct: 1,
                maxIvl: 36500,
                perDay: 200,
                hardFactor: 1.2
            },
            lapse: {
                delays: [10],
                leechAction: 1,
                leechFails: 8,
                minInt: 1,
                mult: 0
            }
        }
    };

    // Insert collection row - USE PARAMETERIZED QUERY
    db.run(`INSERT INTO col VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        1,
        nowSec,
        nowSec,
        nowSec,
        11,
        0,
        -1,
        0,
        JSON.stringify(conf),
        JSON.stringify(models),
        JSON.stringify(decks),
        JSON.stringify(dconf),
        '{}'
    ]);

    // Insert notes and cards
    let noteId = deckId + 2;
    
    allCards.forEach((card, idx) => {
        const guid = generateGuid();
        const frontText = card.front || '';
        const backText = card.back || '';
        const deckText = card.deck || deckName;
        const tagsText = Array.isArray(card.tags) ? card.tags.join(' ') : (card.tags || '');
        
        const flds = `${escapeHtmlLite(frontText)}\x1f${escapeHtmlLite(backText)}\x1f${deckText}\x1f${tagsText}`;
        const sfld = frontText.substring(0, 50);
        const csum = sha1ish(sfld);

        // Insert note
        db.run(`INSERT INTO notes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
            noteId,
            guid,
            modelId,
            nowSec,
            -1,
            ' ' + tagsText + ' ',
            flds,
            sfld,
            csum,
            0,
            '{}'
        ]);

        // Insert cards for each template
        tmpls.forEach((tmpl, ord) => {
            const cardId = noteId * 1000 + ord;
            const due = noteId + ord;
            
            db.run(`INSERT INTO cards VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
                cardId,
                noteId,
                deckId,
                ord,
                nowSec,
                -1,
                0,  // type
                0,  // queue
                due,
                0,  // ivl
                0,  // factor
                0,  // reps
                0,  // lapses
                0,  // left
                0,  // odue
                0,  // odid
                0,  // flags
                '{}'
            ]);
        });

        noteId++;
    });

    // Export database to binary
    const dbData = db.export();
    
    // Create media file (empty JSON object)
    const media = JSON.stringify({});

    // Create ZIP file
    const zip = new JSZip();
    zip.file('collection.anki2', dbData);
    zip.file('media', media);

    // Generate and download
    const content = await zip.generateAsync({ 
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 3 }
    });
    
    // Use File API for better filename handling
    const stamp = new Date().toISOString().slice(0,10).replace(/-/g,'');
    const filename = `${deckName.replace(/[^\w\- ]+/g,'').replace(/\s+/g,'_')}_${stamp}.apkg`;
    const file = new File([content], filename, { type: 'application/octet-stream' });
    
    downloadBlob(file, filename);
}

function generateGuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 100);
}

// Initialize templates when module loads
ensureDefaultTemplatesLoaded();

// Export functions for template editor
window.APKG_BUILDER = {
    loadApkgModel,
    saveApkgModel,
    resetApkgModel,
    loadDeckName,
    saveDeckName,
    loadNoteType,
    saveNoteType,
    ensureDefaultTemplatesLoaded,
    exportApkg
};