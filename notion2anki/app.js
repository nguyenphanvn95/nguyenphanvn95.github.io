// Notion to Anki Web App
// Main application logic

class NotionToAnkiApp {
    constructor() {
        this.pages = [];
        this.notionData = null;
        this.selectedPageIndex = null;
        this.init();
    }

    init() {
        this.loadFromLocalStorage();
        this.bindEvents();
        this.updateUI();
    }

    bindEvents() {
        document.getElementById('addItemBtn').addEventListener('click', () => this.openAddModal());
        document.getElementById('deleteItemBtn').addEventListener('click', () => this.deleteSelectedPage());
        document.getElementById('loadFromNotionBtn').addEventListener('click', () => this.loadFromNotion());
        document.getElementById('exportApkgBtn').addEventListener('click', () => this.exportApkg());

        // Save configuration on change
        document.getElementById('notionToken').addEventListener('input', () => this.saveConfig());
        document.getElementById('notionNamespace').addEventListener('input', () => this.saveConfig());
        document.getElementById('deckName').addEventListener('input', () => this.saveConfig());
    }

    loadFromLocalStorage() {
        const saved = localStorage.getItem('notionToAnkiConfig');
        if (saved) {
            const config = JSON.parse(saved);
            document.getElementById('notionToken').value = config.token || '';
            document.getElementById('notionNamespace').value = config.namespace || '';
            document.getElementById('deckName').value = config.deckName || 'My Deck';
            this.pages = config.pages || [];
        }
    }

    saveConfig() {
        const config = {
            token: document.getElementById('notionToken').value,
            namespace: document.getElementById('notionNamespace').value,
            deckName: document.getElementById('deckName').value,
            pages: this.pages
        };
        localStorage.setItem('notionToAnkiConfig', JSON.stringify(config));
    }

    openAddModal() {
        document.getElementById('addPageModal').classList.add('active');
        document.getElementById('modalPageId').value = '';
        document.getElementById('modalTargetDeck').value = '';
        document.getElementById('modalPageId').focus();
    }

    addPage(pageId, targetDeck) {
        // Clean up pageId - remove hyphens if present
        pageId = pageId.replace(/-/g, '');
        
        const page = {
            pageId: pageId,
            targetDeck: targetDeck,
            recursive: true,
            absUpdate: false,
            incUpdate: true
        };

        this.pages.push(page);
        this.saveConfig();
        this.updateUI();
        this.showNotification('Đã thêm page thành công!', 'success');
    }

    deleteSelectedPage() {
        if (this.selectedPageIndex !== null) {
            if (confirm('Bạn có chắc muốn xóa page này?')) {
                this.pages.splice(this.selectedPageIndex, 1);
                this.selectedPageIndex = null;
                this.saveConfig();
                this.updateUI();
                this.showNotification('Đã xóa page!', 'success');
            }
        }
    }

    updateUI() {
        this.renderPagesTable();
        this.updateStats();
        document.getElementById('deleteItemBtn').disabled = this.selectedPageIndex === null;
        document.getElementById('exportApkgBtn').disabled = !this.notionData || this.pages.length === 0;
    }

    renderPagesTable() {
        const tbody = document.getElementById('pagesTableBody');
        
        if (this.pages.length === 0) {
            tbody.innerHTML = `
                <tr class="empty-state">
                    <td colspan="5">
                        <i class="fas fa-inbox"></i>
                        <p>Chưa có pages nào. Nhấn "Add Item" để thêm.</p>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = '';
        this.pages.forEach((page, index) => {
            const row = document.createElement('tr');
            row.style.cursor = 'pointer';
            
            if (index === this.selectedPageIndex) {
                row.style.background = '#e3f2fd';
            }

            row.addEventListener('click', () => {
                this.selectedPageIndex = index;
                this.updateUI();
            });

            row.innerHTML = `
                <td class="page-id-input">${page.pageId.substring(0, 12)}...</td>
                <td><span class="deck-badge">${page.targetDeck}</span></td>
                <td class="checkbox-cell">
                    <input type="checkbox" ${page.recursive ? 'checked' : ''} 
                           onchange="app.togglePageOption(${index}, 'recursive')">
                </td>
                <td class="checkbox-cell">
                    <input type="checkbox" ${page.absUpdate ? 'checked' : ''} 
                           onchange="app.togglePageOption(${index}, 'absUpdate')">
                </td>
                <td class="checkbox-cell">
                    <input type="checkbox" ${page.incUpdate ? 'checked' : ''} 
                           onchange="app.togglePageOption(${index}, 'incUpdate')">
                </td>
            `;

            tbody.appendChild(row);
        });
    }

    togglePageOption(index, option) {
        this.pages[index][option] = !this.pages[index][option];
        this.saveConfig();
    }

    updateStats() {
        document.getElementById('pagesCount').textContent = this.pages.length;
        const estimatedCards = this.pages.length * 10; // Rough estimate
        document.getElementById('cardsCount').textContent = estimatedCards;
    }

    async loadFromNotion() {
        const token = document.getElementById('notionToken').value.trim();
        
        if (!token) {
            this.showNotification('Vui lòng nhập Notion Token!', 'error');
            return;
        }

        if (this.pages.length === 0) {
            this.showNotification('Vui lòng thêm ít nhất một page!', 'error');
            return;
        }

        try {
            this.showLoading(true);
            this.notionData = await this.fetchNotionPages(token);
            this.showLoading(false);
            this.updateUI();
            this.showNotification('Tải dữ liệu thành công! Có thể xuất .apkg ngay.', 'success');
        } catch (error) {
            this.showLoading(false);
            this.showNotification('Lỗi: ' + error.message, 'error');
        }
    }

    async fetchNotionPages(token) {
        // Use simple API for demo (works without CORS issues)
        // For production, use NotionAPI class with proper CORS proxy
        const api = new NotionAPISimple();
        
        const data = {
            pages: []
        };

        // Process each page
        for (const page of this.pages) {
            try {
                this.showNotification(`Đang xử lý page: ${page.targetDeck}...`, 'info');
                
                // Export page from Notion
                const blob = await api.exportPage(
                    page.pageId, 
                    page.recursive,
                    (msg, progress) => {
                        console.log(`${page.targetDeck}: ${msg} (${progress}%)`);
                    }
                );

                // Parse export to cards
                const cards = await api.parseExportToCards(blob, page.targetDeck);
                
                data.pages.push({
                    id: page.pageId,
                    deck: page.targetDeck,
                    cards: cards
                });

                this.showNotification(`✓ Đã tải ${cards.length} thẻ từ ${page.targetDeck}`, 'success');
                
            } catch (error) {
                console.error(`Error processing page ${page.pageId}:`, error);
                this.showNotification(`Lỗi tải page ${page.targetDeck}: ${error.message}`, 'error');
            }
        }

        return data;
    }

    // Use real Notion API (requires CORS proxy or backend)
    async fetchNotionPagesReal(token) {
        const api = new NotionAPI(token);
        
        const data = {
            pages: []
        };

        // Test connection first
        try {
            await api.testConnection();
        } catch (error) {
            throw new Error('Không thể kết nối với Notion API. Vui lòng kiểm tra Token.');
        }

        // Process each page
        for (const page of this.pages) {
            try {
                this.showNotification(`Đang xử lý page: ${page.targetDeck}...`, 'info');
                
                // Export page from Notion
                const blob = await api.exportPage(
                    page.pageId, 
                    page.recursive,
                    (msg, progress) => {
                        console.log(`${page.targetDeck}: ${msg} (${progress}%)`);
                    }
                );

                // Parse export to cards
                const cards = await api.parseExportToCards(blob, page.targetDeck);
                
                data.pages.push({
                    id: page.pageId,
                    deck: page.targetDeck,
                    cards: cards
                });

                this.showNotification(`✓ Đã tải ${cards.length} thẻ từ ${page.targetDeck}`, 'success');
                
            } catch (error) {
                console.error(`Error processing page ${page.pageId}:`, error);
                this.showNotification(`Lỗi tải page ${page.targetDeck}: ${error.message}`, 'error');
            }
        }

        return data;
    }

    async exportApkg() {
        if (!this.notionData) {
            this.showNotification('Vui lòng tải dữ liệu từ Notion trước!', 'error');
            return;
        }

        try {
            this.showLoading(true);
            const deckName = document.getElementById('deckName').value || 'My Deck';
            await this.createApkgFile(deckName, this.notionData);
            this.showLoading(false);
            this.showNotification('Xuất file .apkg thành công!', 'success');
        } catch (error) {
            this.showLoading(false);
            this.showNotification('Lỗi khi tạo file: ' + error.message, 'error');
        }
    }

    async createApkgFile(deckName, data) {
        // Load SQL.js
        const SQL = await initSqlJs({
            locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}`
        });

        const db = new SQL.Database();

        // Create Anki database schema
        this.createAnkiSchema(db);

        // Generate deck ID and model ID
        const deckId = Date.now();
        const modelId = deckId + 1;

        // Insert deck
        this.insertDeck(db, deckId, deckName);

        // Insert note type (model)
        this.insertModel(db, modelId);

        // Insert cards
        let noteId = deckId + 2;
        data.pages.forEach(page => {
            page.cards.forEach(card => {
                this.insertNote(db, noteId, modelId, deckId, card);
                this.insertCard(db, noteId, noteId, deckId, 0);
                noteId++;
            });
        });

        // Export database
        const dbData = db.export();
        const dbBlob = new Blob([dbData], { type: 'application/octet-stream' });

        // Create media file (empty for now)
        const media = JSON.stringify({});

        // Create zip file
        const zip = new JSZip();
        zip.file('collection.anki2', dbBlob);
        zip.file('media', media);

        // Generate and download
        const content = await zip.generateAsync({ type: 'blob' });
        this.downloadFile(content, `${deckName}.apkg`);
    }

    createAnkiSchema(db) {
        // Create tables
        db.run(`
            CREATE TABLE col (
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
            )
        `);

        db.run(`
            CREATE TABLE notes (
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
            )
        `);

        db.run(`
            CREATE TABLE cards (
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
            )
        `);

        db.run(`
            CREATE TABLE revlog (
                id INTEGER PRIMARY KEY,
                cid INTEGER NOT NULL,
                usn INTEGER NOT NULL,
                ease INTEGER NOT NULL,
                ivl INTEGER NOT NULL,
                lastIvl INTEGER NOT NULL,
                factor INTEGER NOT NULL,
                time INTEGER NOT NULL,
                type INTEGER NOT NULL
            )
        `);

        db.run(`
            CREATE TABLE graves (
                usn INTEGER NOT NULL,
                oid INTEGER NOT NULL,
                type INTEGER NOT NULL
            )
        `);
    }

    insertDeck(db, deckId, deckName) {
        const now = Date.now();
        
        const decks = {
            [deckId]: {
                id: deckId,
                name: deckName,
                mod: Math.floor(now / 1000),
                usn: -1,
                collapsed: false,
                browserCollapsed: false,
                desc: '',
                dyn: 0,
                conf: 1,
                extendNew: 0,
                extendRev: 0
            }
        };

        const models = {
            [deckId + 1]: {
                id: deckId + 1,
                name: 'Basic',
                type: 0,
                mod: Math.floor(now / 1000),
                usn: -1,
                sortf: 0,
                did: deckId,
                tmpls: [{
                    name: 'Card 1',
                    ord: 0,
                    qfmt: this.getDefaultFrontTemplate(),
                    afmt: this.getDefaultBackTemplate(),
                    bqfmt: '',
                    bafmt: '',
                    did: null,
                    bfont: '',
                    bsize: 0
                }],
                flds: [
                    { name: 'Front', ord: 0, sticky: false, rtl: false, font: 'Arial', size: 20 },
                    { name: 'Back', ord: 1, sticky: false, rtl: false, font: 'Arial', size: 20 }
                ],
                css: this.getDefaultCSS(),
                latexPre: '\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n',
                latexPost: '\\end{document}',
                latexsvg: false,
                req: [[0, 'all', [0]]]
            }
        };

        db.run(`
            INSERT INTO col VALUES (
                1,
                ${Math.floor(now / 1000)},
                ${Math.floor(now / 1000)},
                ${Math.floor(now / 1000)},
                11,
                0,
                0,
                0,
                '{}',
                '${JSON.stringify(models).replace(/'/g, "''")}',
                '${JSON.stringify(decks).replace(/'/g, "''")}',
                '{"1":{"name":"Default","replayq":true,"lapse":{"delays":[10],"mult":0,"minInt":1,"leechFails":8,"leechAction":0},"rev":{"perDay":200,"ease4":1.3,"fuzz":0.05,"minSpace":1,"ivlFct":1,"maxIvl":36500},"timer":0,"maxTaken":60,"usn":0,"new":{"delays":[1,10],"ints":[1,4,7],"initialFactor":2500,"separate":true,"order":1,"perDay":20},"autoplay":true,"id":1,"mod":0}}',
                '{}'
            )
        `);
    }

    insertModel(db, modelId) {
        // Model is already inserted in the col table
    }

    insertNote(db, noteId, modelId, deckId, card) {
        const now = Date.now();
        const guid = this.generateGuid();
        const fields = `${card.front}\x1f${card.back}`;
        const tags = card.tags ? ' ' + card.tags.join(' ') + ' ' : '';

        db.run(`
            INSERT INTO notes VALUES (
                ${noteId},
                '${guid}',
                ${modelId},
                ${Math.floor(now / 1000)},
                -1,
                '${tags}',
                '${fields.replace(/'/g, "''")}',
                '${card.front.substring(0, 50).replace(/'/g, "''")}',
                0,
                0,
                ''
            )
        `);
    }

    insertCard(db, cardId, noteId, deckId, ord) {
        const now = Date.now();
        
        db.run(`
            INSERT INTO cards VALUES (
                ${cardId},
                ${noteId},
                ${deckId},
                ${ord},
                ${Math.floor(now / 1000)},
                -1,
                0,
                0,
                ${noteId},
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                ''
            )
        `);
    }

    generateGuid() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    getDefaultFrontTemplate() {
        return `<div class="prettify-flashcard">
    <div class="prettify-deck">{{Deck}}</div>
    <div class="prettify-field prettify-field--front">{{Front}}</div>
    {{#Tags}}
    <hr id="source">
    <div class="prettify-tags">{{Tags}}</div>
    {{/Tags}}
</div>`;
    }

    getDefaultBackTemplate() {
        return `<div class="prettify-flashcard">
    <div class="prettify-deck">{{Deck}}</div>
    <div class="prettify-field prettify-field--front">{{Front}}</div>
    <hr id="answer">
    <div class="prettify-field prettify-field--back">{{Back}}</div>
    {{#Tags}}
    <hr id="source">
    <div class="prettify-tags">{{Tags}}</div>
    {{/Tags}}
</div>`;
    }

    getDefaultCSS() {
        return `.card {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    font-size: 18px;
    text-align: center;
    color: #333;
    background-color: #fff;
}

.prettify-flashcard {
    padding: 20px;
}

.prettify-deck {
    font-size: 14px;
    color: #666;
    margin-bottom: 15px;
}

.prettify-field {
    margin: 15px 0;
    font-size: 22px;
    line-height: 1.5;
}

.prettify-field--front {
    font-weight: 600;
}

.prettify-tags {
    font-size: 12px;
    color: #999;
    margin-top: 15px;
}

hr {
    border: none;
    border-top: 1px solid #e0e0e0;
    margin: 20px 0;
}`;
    }

    downloadFile(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    showLoading(show) {
        const loading = document.getElementById('loadingIndicator');
        if (show) {
            loading.classList.add('active');
        } else {
            loading.classList.remove('active');
        }
    }

    showNotification(message, type = 'info') {
        const notification = document.getElementById('notification');
        const icon = document.getElementById('notificationIcon');
        const text = document.getElementById('notificationText');

        // Set icon based on type
        const icons = {
            success: 'fas fa-check-circle',
            error: 'fas fa-exclamation-circle',
            info: 'fas fa-info-circle'
        };

        notification.className = `notification ${type}`;
        icon.className = icons[type];
        text.textContent = message;

        notification.style.display = 'flex';

        setTimeout(() => {
            notification.style.display = 'none';
        }, 5000);
    }
}

// Global functions for modal
function closeAddModal() {
    document.getElementById('addPageModal').classList.remove('active');
}

function confirmAddPage() {
    const pageId = document.getElementById('modalPageId').value.trim();
    const targetDeck = document.getElementById('modalTargetDeck').value.trim();

    if (!pageId || !targetDeck) {
        app.showNotification('Vui lòng điền đầy đủ thông tin!', 'error');
        return;
    }

    app.addPage(pageId, targetDeck);
    closeAddModal();
}

// Close modal when clicking outside
document.addEventListener('click', (e) => {
    const modal = document.getElementById('addPageModal');
    if (e.target === modal) {
        closeAddModal();
    }
});

// Close modal with Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeAddModal();
    }
});

// Initialize app
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new NotionToAnkiApp();
});
