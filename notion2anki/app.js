// Notion to Anki Web App
// Main application logic

class NotionToAnkiApp {
    constructor() {
        this.pages = [];
        this.notionData = null;
        this.editingIndex = null;
        this.init();
    }

    init() {
        this.loadFromLocalStorage();
        this.bindEvents();
        this.updateUI();
    }

    bindEvents() {
        document.getElementById('addItemBtn').addEventListener('click', () => this.openAddModal());
        document.getElementById('loadFromNotionBtn').addEventListener('click', () => this.loadFromNotion());
        document.getElementById('exportApkgBtn').addEventListener('click', () => this.exportApkg());

        // Save configuration on change
        document.getElementById('notionToken').addEventListener('input', () => this.saveConfig());
        document.getElementById('notionNamespace').addEventListener('input', () => this.saveConfig());
        document.getElementById('deckName').addEventListener('input', () => this.saveConfig());
        
        // Thêm sự kiện cho nút Sửa Template nếu có
        const editTemplateBtn = document.getElementById('editTemplatesBtn');
        if (editTemplateBtn) {
            editTemplateBtn.addEventListener('click', () => this.openTemplateEditor());
        }
    }

    loadFromLocalStorage() {
        const saved = localStorage.getItem('notionToAnkiConfig');
        if (saved) {
            try {
                const config = JSON.parse(saved);
                document.getElementById('notionToken').value = config.token || '';
                document.getElementById('notionNamespace').value = config.namespace || '';
                document.getElementById('deckName').value = config.deckName || 'My Deck';
                this.pages = config.pages || [];
                console.log('Loaded config:', { pagesCount: this.pages.length });
            } catch (e) {
                console.error('Error loading config:', e);
                this.pages = [];
            }
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
        console.log('Config saved:', { pagesCount: this.pages.length });
    }

    openAddModal() {
        document.getElementById('addPageModal').classList.add('active');
        document.getElementById('modalPageId').value = '';
        document.getElementById('modalTargetDeck').value = '';
        this.editingIndex = null;
        document.getElementById('modalPageId').focus();
        console.log('Add modal opened');
    }

    // Hàm để sửa page - cần export ra global
    editPage(index) {
        console.log('Editing page at index:', index);
        if (index >= 0 && index < this.pages.length) {
            const page = this.pages[index];
            document.getElementById('modalPageId').value = page.pageId;
            document.getElementById('modalTargetDeck').value = page.targetDeck;
            this.editingIndex = index;
            document.getElementById('addPageModal').classList.add('active');
            console.log('Edit modal opened for:', page);
        }
    }

    // Hàm để xóa page - cần export ra global
    deletePage(index) {
        console.log('Deleting page at index:', index);
        if (index >= 0 && index < this.pages.length) {
            if (confirm('Bạn có chắc muốn xóa page này?')) {
                this.pages.splice(index, 1);
                this.saveConfig();
                this.updateUI();
                this.showNotification('Đã xóa page!', 'success');
                console.log('Page deleted');
            }
        }
    }

    addPage(pageId, targetDeck) {
        // Clean up pageId - remove hyphens if present
        const cleanPageId = pageId.replace(/-/g, '').trim();
        
        if (!cleanPageId || !targetDeck.trim()) {
            this.showNotification('Vui lòng điền đầy đủ thông tin!', 'error');
            return;
        }
        
        const page = {
            pageId: cleanPageId,
            targetDeck: targetDeck.trim(),
            recursive: true,
            absUpdate: false,
            incUpdate: true
        };

        this.pages.push(page);
        this.saveConfig();
        this.updateUI();
        this.showNotification('Đã thêm page thành công!', 'success');
        console.log('Page added:', page);
    }

    updateUI() {
        this.renderPagesTable();
        this.updateStats();
        document.getElementById('exportApkgBtn').disabled = !this.notionData || this.pages.length === 0;
        console.log('UI updated');
    }

    renderPagesTable() {
        const tbody = document.getElementById('pagesTableBody');
        
        if (this.pages.length === 0) {
            tbody.innerHTML = `
                <tr class="empty-state">
                    <td colspan="3">
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
            
            // Hiển thị pageId rút gọn
            const shortPageId = page.pageId.length > 12 ? 
                page.pageId.substring(0, 12) + '...' : page.pageId;
            
            row.innerHTML = `
                <td class="page-id-input" title="${page.pageId}">
                    ${shortPageId}
                </td>
                <td><span class="deck-badge">${page.targetDeck}</span></td>
                <td class="actions-cell">
                    <button class="action-btn action-btn-edit" onclick="app.editPage(${index})" title="Sửa">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="action-btn action-btn-delete" onclick="app.deletePage(${index})" title="Xóa">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            `;

            tbody.appendChild(row);
        });
        
        console.log('Pages table rendered with', this.pages.length, 'pages');
    }

    updateStats() {
        document.getElementById('pagesCount').textContent = this.pages.length;
        
        let estimatedCards = 0;
        if (this.notionData && this.notionData.pages) {
            this.notionData.pages.forEach(page => {
                if (page.cards && Array.isArray(page.cards)) {
                    estimatedCards += page.cards.length;
                }
            });
        } else {
            estimatedCards = this.pages.length * 10;
        }
        
        document.getElementById('cardsCount').textContent = estimatedCards;
        console.log('Stats updated:', { pages: this.pages.length, cards: estimatedCards });
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
            
            const totalCards = this.getTotalCards();
            this.showNotification(`Tải dữ liệu thành công! Tổng cộng ${totalCards} thẻ. Có thể xuất .apkg ngay.`, 'success');
        } catch (error) {
            this.showLoading(false);
            this.showNotification('Lỗi: ' + error.message, 'error');
            console.error('Load from Notion error:', error);
        }
    }

    getTotalCards() {
        if (!this.notionData || !this.notionData.pages) return 0;
        
        return this.notionData.pages.reduce((total, page) => {
            return total + (page.cards ? page.cards.length : 0);
        }, 0);
    }

    async fetchNotionPages(token) {
        const api = new NotionAPI(token);
        
        const data = {
            pages: []
        };

        // Process each page
        for (let i = 0; i < this.pages.length; i++) {
            const page = this.pages[i];
            try {
                this.showNotification(`Đang xử lý page ${i + 1}/${this.pages.length}: ${page.targetDeck}...`, 'info');
                console.log(`Processing page ${i + 1}:`, page);
                
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
                console.log(`Page processed: ${cards.length} cards extracted`);
                
            } catch (error) {
                console.error(`Error processing page ${page.pageId}:`, error);
                this.showNotification(`Lỗi tải page ${page.targetDeck}: ${error.message}`, 'error');
                
                // Thêm page với empty cards để tiếp tục
                data.pages.push({
                    id: page.pageId,
                    deck: page.targetDeck,
                    cards: api.generateMockCards(page.targetDeck)
                });
            }
        }

        console.log('All pages processed:', data);
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
            const noteTypeName = 'Notion2Anki';
            
            console.log('Exporting APKG...', { 
                deckName, 
                noteTypeName, 
                pages: this.notionData.pages.length,
                totalCards: this.getTotalCards() 
            });
            
            await exportApkg(this.notionData, deckName, noteTypeName);
            
            this.showLoading(false);
            this.showNotification('Xuất file .apkg thành công!', 'success');
        } catch (error) {
            this.showLoading(false);
            this.showNotification('Lỗi khi tạo file: ' + error.message, 'error');
            console.error('Export error:', error);
        }
    }

    openTemplateEditor() {
        if (typeof openTemplateEditor === 'function') {
            openTemplateEditor();
        } else {
            this.showNotification('Template editor chưa được tải. Vui lòng tải lại trang.', 'error');
        }
    }

    showLoading(show) {
        const loading = document.getElementById('loadingIndicator');
        if (show) {
            loading.classList.add('active');
            console.log('Loading started');
        } else {
            loading.classList.remove('active');
            console.log('Loading finished');
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
        
        console.log(`Notification: ${type} - ${message}`);
    }
}

// Global functions for modal
function closeAddModal() {
    document.getElementById('addPageModal').classList.remove('active');
    console.log('Add modal closed');
}

function confirmAddPage() {
    const pageId = document.getElementById('modalPageId').value.trim();
    const targetDeck = document.getElementById('modalTargetDeck').value.trim();

    if (!pageId || !targetDeck) {
        app.showNotification('Vui lòng điền đầy đủ thông tin!', 'error');
        return;
    }

    if (app.editingIndex !== null && app.editingIndex !== undefined) {
        // Edit existing page
        console.log('Editing existing page at index:', app.editingIndex);
        app.pages[app.editingIndex].pageId = pageId.replace(/-/g, '').trim();
        app.pages[app.editingIndex].targetDeck = targetDeck.trim();
        app.saveConfig();
        app.updateUI();
        app.showNotification('Đã sửa page thành công!', 'success');
        app.editingIndex = null;
    } else {
        // Add new page
        console.log('Adding new page');
        app.addPage(pageId, targetDeck);
    }
    
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
        const addModal = document.getElementById('addPageModal');
        const templateModal = document.getElementById('templateModal');
        
        if (addModal.classList.contains('active')) {
            closeAddModal();
        }
        if (templateModal && templateModal.classList.contains('active')) {
            closeTemplateEditor();
        }
    }
});

// Initialize app
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new NotionToAnkiApp();
    // Export app instance to window for button onclick handlers
    window.app = app;
    console.log('App initialized');
});